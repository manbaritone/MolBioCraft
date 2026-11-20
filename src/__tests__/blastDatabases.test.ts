// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { localBlastDbDocuments, queryCentricRows } from '../core/localBlastDb';
import { runLocalBlastSearch } from '../core/bioEngine';
import { queryCentricCutNote, runQueryCentricAlignment } from '../core/operationRunners';
import type { BlastHitRecord } from '../types/bio';

describe('custom BLAST databases', () => {
  it('a selection database contains exactly its documents of the chosen type', () => {
    const picks = SAMPLE_LIBRARY.filter((d) => d.sequence.length > 0).slice(0, 5);
    const ids = picks.map((d) => d.id);
    const docs = localBlastDbDocuments({ moleculeType: 'Nucleotide', sourceFolder: 'Selected documents', docIds: ids }, SAMPLE_LIBRARY);
    expect(docs.map((d) => d.id).sort()).toEqual(picks.filter((d) => d.moleculeType !== 'Protein').map((d) => d.id).sort());
  });
});

describe('query-centric alignment', () => {
  const hit = (aq: string, as: string, qs: number, qe: number): BlastHitRecord => ({
    id: 'blast-hit-x', accession: 'X1', description: 'x', organism: '', program: 'blastn', queryCoveragePct: 100, identityPct: 90, eValue: '1e-5',
    bitScore: 50, alignLength: aq.length, queryStart: qs, queryEnd: qe, subjectStart: 1, subjectEnd: 10, alignedQuery: aq, alignedMidline: '', alignedSubject: as,
  });
  it('places a hit in query coordinates, dropping subject insertions and keeping deletions as gaps', () => {
    //           query 3..10:  A C G T - A C G T T   (subject has an extra G; subject lacks query T at the end)
    const rows = queryCentricRows('NNACGTACGTNN', [hit('ACGT-ACGTT', 'ACGTGACG-T', 3, 11)]);
    expect(rows[0].sequence).toBe('--ACGTACG-T-');
    expect(rows[0].sequence.length).toBe(12);
  });
  it('builds an alignment document from a real local BLAST search', () => {
    const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;
    const query = puc.sequence.slice(200, 900);
    const db = SAMPLE_LIBRARY.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0 && d.sequence.length < 20000).slice(0, 40);
    const hits = runLocalBlastSearch(query, db, 'blastn', 'test').slice(0, 5);
    expect(hits.length).toBeGreaterThan(0);
    const r = runQueryCentricAlignment({ ...puc, name: 'q' }, query, hits, { sourceLabel: 'q' }, db);
    const rows = r.created[0].alignmentMeta!.sequences!;
    expect(rows).toHaveLength(hits.length + 1);
    expect(rows.every((x) => x.sequence.length === query.length)).toBe(true);
    // the first row is the query itself, letter for letter
    expect(rows[0].sequence).toBe(query.toUpperCase());
    // The best hit is pUC19 itself. The query is pUC19's 0-based slice 200..900, so by construction it
    // is the plus-strand HSP query 1-700 on subject 201-900, of which the engine keeps only the first 120
    // columns for display.
    const best = hits[0];
    expect(best.bitScore).toBe(Math.max(...hits.map((x) => x.bitScore)));
    expect(best.id).toBe('blast-hit-doc-puc19');
    expect([best.queryStart, best.queryEnd, best.subjectStart, best.subjectEnd]).toEqual([1, 700, 201, 900]);
    expect(best.alignedQuery.length).toBe(120);
    // Every hit's row holds its subject's own bases over the query span the hit reports (reverse-
    // complemented on the minus strand), at column queryStart-1+i for HSP base i, and gaps elsewhere.
    // All five HSPs here are gapless (both spans equal the alignment length), so the expected row follows
    // from the hit's coordinates and the subject document alone. Hit 4 (99.26%) is the row where a
    // subject base differs from the query's; hits 3 and 5 are on the minus strand.
    const comp: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
    hits.forEach((h, k) => {
      const [qs, qe] = [Math.min(h.queryStart, h.queryEnd), Math.max(h.queryStart, h.queryEnd)];
      const [ss, se] = [Math.min(h.subjectStart, h.subjectEnd), Math.max(h.subjectStart, h.subjectEnd)];
      expect([qe - qs + 1, se - ss + 1], `${h.id} is gapless`).toEqual([h.alignLength, h.alignLength]);
      const subject = db.find((d) => `blast-hit-${d.id}` === h.id.replace(/~hsp\d+$/, ''))!;
      const forward = subject.sequence.toUpperCase().slice(ss - 1, se);
      const bases = h.subjectStart <= h.subjectEnd ? forward : [...forward].reverse().map((c) => comp[c]).join('');
      expect(rows[k + 1].sequence, `${h.id} row`).toBe('-'.repeat(qs - 1) + bases + '-'.repeat(query.length - qe));
    });
    expect(hits.map((h) => h.subjectStart > h.subjectEnd)).toEqual([false, false, true, false, true]);
    const [q4s, q4e] = [hits[3].queryStart, hits[3].queryEnd];
    expect(rows[4].sequence.slice(q4s - 1, q4e)).not.toBe(query.slice(q4s - 1, q4e));

    // The boundary of the full fill. The document realigns a blastn hit the engine cut to 120 display
    // columns only while its HSP spans at most 6,001 query letters; protein programs and longer HSPs keep
    // the engine's 120 columns, and the document says so (BG-01M6Q5ZR, pinned by the next test). The fixture is a
    // seeded 7,001-nt record and a 6,001-nt query cut from its 0-based 500..6501 with a substitution every
    // 1,000 letters inside, so by construction the best hit is the gapless plus-strand HSP query 1-6001 on
    // subject 501-6501 and its row is the record's own bases there, which differ from the query's at the
    // five substituted columns.
    let seed = 20261106;
    const nextBase = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 'ACGT'[seed >>> 30]; };
    const record = Array.from({ length: 7001 }, nextBase).join('');
    const substituted = [1000, 2000, 3000, 4000, 5000];
    const longQuery = [...record.slice(500, 6501)].map((c, i) => (substituted.includes(i) ? comp[c] : c)).join('');
    const recordDoc = { ...puc, id: 'doc-seeded-6001', name: 'seeded 6001', accession: 'SEED6001', sequence: record, features: [], primers: [] };
    const longHits = runLocalBlastSearch(longQuery, [recordDoc], 'blastn', 'test');
    const top = longHits[0];
    expect(top.bitScore).toBe(Math.max(...longHits.map((x) => x.bitScore)));
    expect(top.id).toBe('blast-hit-doc-seeded-6001');
    expect([top.queryStart, top.queryEnd, top.subjectStart, top.subjectEnd]).toEqual([1, 6001, 501, 6501]);
    // the engine's own alignment is cut to 120 columns, so the full row below can only come from the realign
    expect(top.alignedQuery.length).toBe(120);
    const longRows = runQueryCentricAlignment({ ...recordDoc, name: 'q6001' }, longQuery, longHits, { sourceLabel: 'q6001' }, [recordDoc]).created[0].alignmentMeta!.sequences!;
    expect(longRows[0].sequence).toBe(longQuery);
    expect(longRows[1].sequence, 'best hit row over all 6,001 columns').toBe(record.slice(top.subjectStart - 1, top.subjectEnd));
    expect(substituted.map((i) => longRows[1].sequence[i] !== longQuery[i])).toEqual([true, true, true, true, true]);
  });

  // BG-01M6Q5ZR (D0005): the engine keeps only the first 120 display columns of an HSP. The document
  // fills the best hit over its whole HSP where it realigns it (blastn, an HSP of at most 6,001 query
  // letters); for every other program and for a longer blastn HSP the row cannot be filled, so the
  // document's Notes and the save's summary say which row is truncated, with its counts. Every case
  // is built so the best HSP spans more than 120 query positions. Wrong implementations, and the case
  // that catches each: no note at all (every truncated case); a note for protein programs only (the
  // 6,002-nt blastn case); a note on every document (the 6,001-nt blastn case must carry none); a
  // note with the wrong counts or row (each note is compared word for word with the counts the hit
  // reports); a note in the Notes but not in the summary App shows on saving (the summary is read).
  it("every program's best hit is filled or marked truncated", () => {
    let seed = 20261120;
    const next = (alphabet: string) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return alphabet[(seed >>> 16) % alphabet.length]; };
    const AA = 'ACDEFGHIKLMNPQRSTVWY';
    const CODON: Record<string, string> = {
      A: 'GCT', C: 'TGT', D: 'GAT', E: 'GAA', F: 'TTT', G: 'GGT', H: 'CAT', I: 'ATT', K: 'AAA', L: 'CTG',
      M: 'ATG', N: 'AAT', P: 'CCT', Q: 'CAA', R: 'CGT', S: 'TCT', T: 'ACT', V: 'GTT', W: 'TGG', Y: 'TAT',
    };
    const protein = 'M' + Array.from({ length: 299 }, () => next(AA)).join('');
    const coding = [...protein].map((a) => CODON[a]).join('');
    const nt = (n: number) => Array.from({ length: n }, () => next('ACGT')).join('');
    const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;
    const subject = (id: string, sequence: string, moleculeType: 'DNA' | 'Protein') =>
      ({ ...puc, id, name: id, accession: id.toUpperCase(), sequence, moleculeType, features: [], primers: [] });
    const long = nt(7002);
    const cases = [
      { label: 'blastn 6,001 nt', program: 'blastn', query: long.slice(500, 6501), db: subject('nt6001', long, 'DNA'), filled: true },
      { label: 'blastn 6,002 nt', program: 'blastn', query: long.slice(500, 6502), db: subject('nt6002', long, 'DNA'), filled: false },
      { label: 'blastp 300 aa', program: 'blastp', query: protein, db: subject('aa300', protein, 'Protein'), filled: false },
      { label: 'blastx', program: 'blastx', query: coding, db: subject('aa300x', protein, 'Protein'), filled: false },
      { label: 'tblastn', program: 'tblastn', query: protein, db: subject('nt900', nt(60) + coding + nt(60), 'DNA'), filled: false },
    ] as const;
    for (const c of cases) {
      const hits = runLocalBlastSearch(c.query, [c.db], c.program, 'test');
      expect(hits.length, `${c.label}: a hit`).toBeGreaterThan(0);
      const best = hits[0];
      expect(best.id, `${c.label}: the best hit is its subject`).toBe(`blast-hit-${c.db.id}`);
      const [qs, qe] = [Math.min(best.queryStart, best.queryEnd), Math.max(best.queryStart, best.queryEnd)];
      const span = qe - qs + 1;
      const kept = [...best.alignedQuery].filter((x) => x !== '-').length;
      expect(span, `${c.label}: the HSP spans more than the 120 display columns`).toBeGreaterThan(120);
      expect(kept, `${c.label}: the engine kept fewer query letters than the HSP spans`).toBeLessThan(span);
      const r = runQueryCentricAlignment({ ...c.db, name: 'q' }, c.query, hits, { sourceLabel: 'q' }, [c.db]);
      const doc = r.created[0];
      const row = doc.alignmentMeta!.sequences![1];
      const notes = String(doc.docMetadata?.Notes ?? '');
      const note = queryCentricCutNote(`Row "${row.name}"`, `${kept.toLocaleString('en-US')} of the ${span.toLocaleString('en-US')} query positions its HSP spans`);
      if (c.filled) {
        const filled = [...row.sequence.slice(qs - 1, qe)].filter((x) => x !== '-').length;
        expect(filled, `${c.label}: the best hit is filled over its whole HSP`).toBe(span);
        expect(notes, `${c.label}: no truncation note`).not.toContain('truncated');
        expect(r.summary, `${c.label}: the summary names no truncated row`).not.toContain('truncated');
      } else {
        expect(notes, `${c.label}: the Notes name the truncated row`).toContain(`Warnings:\n- ${note}`);
        const listed = notes.split('\n').filter((l) => / is truncated; it shows only /.test(l)).length;
        expect(r.summary, `${c.label}: the summary App shows on saving counts the truncated rows`).toBe(`Query-centric alignment of ${hits.length} hits; ${listed === 1 ? '1 row is' : `${listed} rows are`} truncated (see the document's Notes)`);
      }
    }
  });
});
