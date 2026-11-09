// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6Q0VH: BLAST's query-truncation warning reaches the researcher (D0005).
 *
 * The engine searches a query past its program's cap (blastn, blastp, tblastn 10,000 letters;
 * blastx 30,000 nt) on its first cap letters only and puts a warning on every hit. These tests
 * render the real BLAST window and run the real annotate-by-BLAST runner over the real WASM engine,
 * and read annotate-by-BLAST's cap note where it stays readable: each truncated document's History.
 * A FASTA query is read as the engine reads it (BG-01M6QHDJ): header and comment lines are
 * dropped, text before the first header is ignored and only the first headed record is searched;
 * the WASM parity test feeds the same queries to the engine and to the window's helpers. The
 * sequences are generated here from a fixed seed, plus the bundled pUC19 sample, so no reference
 * data is needed.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { BlastSearchModal } from '../components/MenusPreferencesAndBlastModal';
import { HybridToolsAndHistoryStudio } from '../components/HybridToolsAndHistoryStudio';
import { runLocalBlastSearch } from '../core/bioEngine';
import { blastQueryCut, blastQueryLetters, blastQueryTextWarnings, runAnnotateByBlast } from '../core/operationRunners';
import { saveLastUsed } from '../core/optionProfiles';
import type { BlastHitRecord, SequenceDocument } from '../types/bio';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const noop = () => undefined;
const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;

/** Deterministic pseudo-random letters (LCG), so every run searches the same sequences. */
function randomLetters(n: number, seed: number, alphabet: string): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}
const randomDna = (n: number, seed: number) => randomLetters(n, seed, 'ACGT');
const randomProtein = (n: number, seed: number) => randomLetters(n, seed, 'ACDEFGHIKLMNPQRSTVWY');
const CODON: Record<string, string> = {
  A: 'GCT', C: 'TGT', D: 'GAT', E: 'GAA', F: 'TTT', G: 'GGT', H: 'CAT', I: 'ATT', K: 'AAA', L: 'CTG',
  M: 'ATG', N: 'AAT', P: 'CCG', Q: 'CAA', R: 'CGT', S: 'TCT', T: 'ACC', V: 'GTT', W: 'TGG', Y: 'TAT',
};
const backTranslate = (protein: string) => [...protein].map((a) => CODON[a]).join('');

const doc = (id: string, name: string, sequence: string, moleculeType: SequenceDocument['moleculeType'] = 'DNA'): SequenceDocument => ({
  ...puc, id, name, accession: id.toUpperCase(), description: name, moleculeType, topology: 'linear', sequence, features: [], primers: [], history: [],
});

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
/** The text a reader sees: tags stripped, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const notices = (html: string) => [...html.matchAll(/data-mbc-blast-truncation[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
const hitRows = (html: string) => count(html, '>Open Hit<');
/** The step descriptions of a document's History tab timeline, as rendered. */
const historySteps = (html: string) => [...html.matchAll(/<div class="history-content">[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
/** `letters` as FASTA residue lines of `width`, joined by `eol`. */
const wrap = (letters: string, eol = '\n', width = 60) => letters.match(new RegExp(`.{1,${width}}`, 'g'))!.join(eol);
/** The whole-query length the engine says it cut, read off every hit's warnings; null when no hit says it cut. */
function engineCut(hits: BlastHitRecord[]): number | null {
  const cutOf = (h: BlastHitRecord) => {
    for (const w of h.warnings ?? []) {
      const m = /^Query truncated: \w+ has a query cap of \d+ (?:nt|residues), so only query 1-\d+ of (\d+) (?:nt|residues) was searched/.exec(w);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const lengths = [...new Set(hits.map(cutOf))];
  expect(lengths, 'every hit reports the same cut').toHaveLength(1);
  return lengths[0];
}

function renderBlast(program: BlastHitRecord['program'], activeDoc: SequenceDocument, allDocs: SequenceDocument[]): string {
  saveLastUsed('blast', { program, database: 'nr / nt (Curated Local + NCBI Reference Index)' });
  return renderToStaticMarkup(<BlastSearchModal activeDoc={activeDoc} allDocs={allDocs} onClose={noop} onSelectHitDoc={noop} />);
}

/** A query of exactly `letters` letters laid out as GenBank ORIGIN lines (position numbers, spaces, lower case). */
function originText(letters: string): string {
  const lines: string[] = [];
  for (let i = 0; i < letters.length; i += 60) {
    const row = letters.slice(i, i + 60).toLowerCase().match(/.{1,10}/g)!.join(' ');
    lines.push(`${String(i + 1).padStart(9)} ${row}`);
  }
  return lines.join('\n');
}

describe('BLAST window', () => {
  const subject = doc('subj', 'subject-14kb', randomDna(14_000, 7));

  it('the BLAST modal shows the truncation warning on the hits of a cut query, once, above the hit table', () => {
    // 12,000 nt cut from the subject: blastn searches query 1-10,000, coverage 10,000 / 12,000
    const query = doc('qry', 'query-12kb', subject.sequence.slice(1000, 13_000));
    const html = renderBlast('blastn', query, [query, subject]);
    // several hits (the query itself and the subject at 10,000 / 12,000 coverage, plus chance HSPs),
    // every one carrying the engine's warning ...
    const hits = runLocalBlastSearch(query.sequence, [query, subject], 'blastn', 'db');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(h.warnings).toEqual(['Query truncated: blastn has a query cap of 10000 nt, so only query 1-10000 of 12000 nt was searched; query coverage is against all 12000 nt.']);
    }
    expect(hitRows(html)).toBe(hits.length);
    expect(count(html, '<td>83.3%</td>')).toBeGreaterThanOrEqual(2);
    // ... shown as one Caution Amber notice, before the hit table, in the engine's words with its
    // lengths grouped as the window's captions group them
    expect(notices(html)).toEqual(['Query truncated: blastn has a query cap of 10,000 nt, so only query 1-10,000 of 12,000 nt was searched; query coverage is against all 12,000 nt.']);
    expect(html).toContain('hits on the query (12,000 residues)');
    expect(html).toMatch(/<div class="cloning-warning-note" role="status" data-mbc-blast-truncation/);
    expect(html.indexOf('data-mbc-blast-truncation')).toBeLessThan(html.indexOf('<table'));

    // at the cap the whole query is searched: the same hits at full coverage, and no notice
    const atCap = doc('qry', 'query-10kb', subject.sequence.slice(1000, 11_000));
    const whole = renderBlast('blastn', atCap, [atCap, subject]);
    expect(hitRows(whole)).toBeGreaterThanOrEqual(2);
    expect(count(whole, '<td>100%</td>')).toBeGreaterThanOrEqual(2);
    expect(notices(whole)).toEqual([]);
    expect(whole).not.toContain('Query truncated');
    expect(whole).toContain('hits on the query (10,000 residues)');
  });

  it('the BLAST modal shows the truncation warning for a cut query that has no hits', () => {
    // the subject matches only query 10,501-13,500, past the cap, so the search finds nothing
    const target = doc('t', 'target-3kb', randomDna(3_000, 11));
    const query = doc('qry', 'query-13.5kb', randomDna(10_500, 13) + target.sequence);
    const html = renderBlast('blastn', query, [target]);
    expect(hitRows(html)).toBe(0);
    expect(notices(html)).toEqual(['Query truncated: blastn has a query cap of 10,000 nt, so only query 1-10,000 of 13,500 nt was searched, and no hit was found there.']);
    // the same search on the uncut tail finds the subject, so the notice is what explains the empty table
    const tail = doc('qry', 'query-tail', query.sequence.slice(10_000));
    expect(hitRows(renderBlast('blastn', tail, [target]))).toBeGreaterThan(0);
  });

  it("the BLAST modal shows the truncation warning only past each program's cap, counting letters as the engine does", () => {
    const cases: { program: BlastHitRecord['program']; cap: number; unit: string; capText: string; overText: string; letters: (n: number) => string }[] = [
      { program: 'blastn', cap: 10_000, unit: 'nt', capText: '10,000', overText: '10,001', letters: (n) => randomDna(n, 3) },
      { program: 'blastp', cap: 10_000, unit: 'residues', capText: '10,000', overText: '10,001', letters: (n) => randomProtein(n, 5) },
      { program: 'tblastn', cap: 10_000, unit: 'residues', capText: '10,000', overText: '10,001', letters: (n) => randomProtein(n, 5) },
      { program: 'blastx', cap: 30_000, unit: 'nt', capText: '30,000', overText: '30,001', letters: (n) => randomDna(n, 3) },
    ];
    for (const { program, cap, unit, capText, overText, letters } of cases) {
      // GenBank ORIGIN layout: position numbers, spaces and line breaks are not query letters
      const atCap = doc('q', 'q', originText(letters(cap)));
      expect(atCap.sequence.length).toBeGreaterThan(cap);
      expect(notices(renderBlast(program, atCap, [])), `${program} at its cap`).toEqual([]);
      const over = doc('q', 'q', originText(letters(cap + 1)));
      expect(notices(renderBlast(program, over, [])), `${program} one past its cap`).toEqual([
        `Query truncated: ${program} has a query cap of ${capText} ${unit}, so only query 1-${capText} of ${overText} ${unit} was searched, and no hit was found there.`,
      ]);
    }
    // blastx's cap is 30,000 nt: a 12,000-nt query is searched whole
    expect(notices(renderBlast('blastx', doc('q', 'q', randomDna(12_000, 3)), []))).toEqual([]);
  });

  it('the cut the BLAST window predicts for a query with no hits is the cut the engine reports on hits, for every program', () => {
    const protein = randomProtein(10_001, 17);
    const dna = backTranslate(protein); // 30,003 nt, stop-free in frame +1
    // each subject is a short stretch of the searched part of the query, so the search hits it
    const cases: { program: BlastHitRecord['program']; query: string; subject: SequenceDocument }[] = [
      { program: 'blastn', query: dna.slice(0, 10_001), subject: doc('s', 's', dna.slice(2_000, 3_000)) },
      { program: 'blastp', query: protein, subject: doc('s', 's', protein.slice(2_000, 2_300), 'Protein') },
      { program: 'tblastn', query: protein, subject: doc('s', 's', backTranslate(protein.slice(2_000, 2_300))) },
      { program: 'blastx', query: dna, subject: doc('s', 's', protein.slice(2_000, 2_300), 'Protein') },
    ];
    for (const { program, query, subject } of cases) {
      const cut = blastQueryCut(query, program)!;
      expect(cut, program).not.toBeNull();
      const hits = runLocalBlastSearch(query, [subject], program, 'db');
      expect(hits.length, program).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.warnings, program).toHaveLength(1);
        for (const needle of [`${program} has a query cap of ${cut.cap} ${cut.unit}`, `1-${cut.cap} of ${cut.length} ${cut.unit}`]) {
          expect(h.warnings![0], program).toContain(needle);
        }
      }
      // cut to exactly the cap, the engine searches the query whole and the window predicts no cut
      const whole = query.slice(0, cut.cap);
      expect(blastQueryCut(whole, program), program).toBeNull();
      expect(runLocalBlastSearch(whole, [subject], program, 'db').every((h) => h.warnings === undefined), program).toBe(true);
      // the same queries as FASTA, under a header with letters in it: the header is not query letters
      const headed = `>${program} query ACGT MKV\r\n${wrap(query, '\r\n')}\r\n`;
      expect(blastQueryCut(headed, program), program).toEqual(cut);
      expect(engineCut(runLocalBlastSearch(headed, [subject], program, 'db')), program).toBe(cut.length);
      const headedWhole = `>${program} query ACGT MKV\n${wrap(whole)}`;
      expect(blastQueryCut(headedWhole, program), program).toBeNull();
      const wholeHits = runLocalBlastSearch(headedWhole, [subject], program, 'db');
      expect(wholeHits.length, program).toBeGreaterThan(0);
      expect(engineCut(wholeHits), program).toBeNull();
    }
  });

  describe('a FASTA query', () => {
    const first = randomDna(12_000, 31);
    const other = randomDna(8_000, 37);
    const subject = doc('s', 's', first.slice(2_000, 3_000)); // in the searched part of the first record
    const BOM = String.fromCharCode(0xfeff);
    const records = (n: number, len: number) => `Query holds ${n} FASTA records: blastn searched only the first (${len} nt); query coordinates and coverage are against that record.`;
    const ignored = 'Text before the first FASTA header was ignored.';
    // the same text goes to the real engine and to the window's helpers: `cut` is the whole-query
    // length the engine must report cutting (null: searched whole), `warnings` its other warnings
    const cases: { shape: string; query: string; cut: number | null; warnings: string[] }[] = [
      { shape: 'a 10,000-nt record under a header', query: `>my query 10 kb ACGT\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
      { shape: 'a 12,000-nt record under a header', query: `>my query 12 kb ACGT\n${wrap(first)}`, cut: 12_000, warnings: [] },
      { shape: 'CRLF line endings', query: `>my query ACGT\r\n${wrap(first, '\r\n')}\r\n`, cut: 12_000, warnings: [] },
      { shape: 'lone CR line endings', query: `>my query ACGT\r${wrap(first, '\r')}`, cut: 12_000, warnings: [] },
      { shape: 'lone CR line endings, 10,000 nt', query: `>my query ACGT\r${wrap(first.slice(0, 10_000), '\r')}`, cut: null, warnings: [] },
      { shape: 'comment lines', query: `;exported by a tool ACGT\n>my query\n;note GATTACA\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
      { shape: 'an indented header', query: ` \t\u00a0>my query ACGT\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
      // U+0085 is Unicode whitespace that JS's \s lacks
      { shape: 'a header after a NEL', query: `\u0085>my query ACGT\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
      { shape: 'a BOM before the header', query: `${BOM}>my query ACGT\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
      { shape: 'a label before the header', query: `Sequence from the lab ACGT\n>my query\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [ignored] },
      { shape: 'residues before the header', query: `${wrap(other)}\n>my query\n${wrap(first)}`, cut: 12_000, warnings: [ignored] },
      { shape: 'two records, the first past the cap', query: `>r1\n${wrap(first)}\n>r2\n${wrap(other)}`, cut: 12_000, warnings: [records(2, 12_000)] },
      { shape: 'two records, the first within the cap', query: `>r1\n${wrap(first.slice(0, 10_000))}\n>r2\n${wrap(other)}`, cut: null, warnings: [records(2, 10_000)] },
      { shape: 'three records after a label', query: `label\n>r1\n${wrap(first.slice(0, 6_000))}\n>r2\n${wrap(other)}\n>r3\n${wrap(first)}`, cut: null, warnings: [records(3, 6_000), ignored] },
      { shape: 'no header', query: `${wrap(first.slice(0, 6_000))}\n\n${wrap(first.slice(6_000))}`, cut: 12_000, warnings: [] },
      { shape: 'a comment before residues, no header', query: `;exported by a tool ACGT\n${wrap(first)}`, cut: 12_000, warnings: [] },
      { shape: 'a BOM before a later header', query: `>my query\n${wrap(first.slice(0, 10_000))}\n${BOM}>second record\n${wrap(other)}`, cut: null, warnings: [records(2, 10_000)] },
      { shape: 'digits-only text before the header', query: `12345\n>my query\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [ignored] },
      { shape: 'blank lines before the header', query: ` \t\n\u00a0${BOM}\u0085\n\n>my query\n${wrap(first.slice(0, 10_000))}`, cut: null, warnings: [] },
    ];
    const empty = `>r1\n>r2\n${wrap(first)}`; // an empty first record
    const fasta = `>query-12kb from a FASTA file\r\n${wrap(first, '\r\n')}\r\n>second record\r\n${wrap(other, '\r\n')}\r\n`;

    it('the BLAST window reads a FASTA query by the engine rule: headers, comments, text before the header, line endings, the first headed record only', () => {
      for (const { shape, query, cut, warnings } of cases) {
        expect(blastQueryCut(query, 'blastn')?.length ?? null, shape).toBe(cut);
        expect(blastQueryTextWarnings(query, 'blastn'), shape).toEqual(warnings);
      }
      // an empty first record is searched as empty, never as the next record
      expect(blastQueryLetters(empty)).toBe(0);
      expect(blastQueryTextWarnings(empty, 'blastn')).toEqual([records(2, 0)]);
      expect(blastQueryLetters(fasta)).toBe(12_000);

      // with hits, the window's strip and ruler count the record, not its header: 4,990 nt rules a
      // tick every 100 nt, where the header's 11 letters counted too would step it every 1,000
      const headed = renderBlast('blastn', doc('q', 'q', `>query 4,990 nt ACGT\n${wrap(first.slice(0, 4_990))}`), [subject]);
      expect(hitRows(headed)).toBeGreaterThan(0);
      expect(headed).toContain('hits on the query (4,990 residues)');
      expect(headed).toContain('>4900</text>');
      expect(headed).not.toContain('>5000</text>');

      // with no hit the window's own notices read the query by that rule, lengths grouped, and a
      // header alone never raises one
      expect(notices(renderBlast('blastn', doc('q', 'q', fasta), []))).toEqual([
        'Query holds 2 FASTA records: blastn searched only the first (12,000 nt); query coordinates and coverage are against that record.',
        'Query truncated: blastn has a query cap of 10,000 nt, so only query 1-10,000 of 12,000 nt was searched, and no hit was found there.',
      ]);
      expect(notices(renderBlast('blastn', doc('q', 'q', `Sequence from the lab\n>my query\n${wrap(first.slice(0, 10_000))}`), []))).toEqual([ignored]);
      expect(notices(renderBlast('blastn', doc('q', 'q', cases.find((c) => c.shape === 'three records after a label')!.query), []))).toEqual([
        'Query holds 3 FASTA records: blastn searched only the first (6,000 nt); query coordinates and coverage are against that record.',
        ignored,
      ]);
      expect(notices(renderBlast('blastn', doc('q', 'q', empty), []))).toEqual([records(2, 0)]);
      expect(notices(renderBlast('blastn', doc('q', 'q', `>my query 10 kb ACGT\n${wrap(first.slice(0, 10_000))}`), []))).toEqual([]);
    });

    it('the engine reads a FASTA query as the BLAST window does: the same cut and the same warnings on every hit', () => {
      // the same text goes to the real engine as to the window's helpers above
      for (const { shape, query, cut, warnings } of cases) {
        const hits = runLocalBlastSearch(query, [subject], 'blastn', 'db');
        expect(hits.length, shape).toBeGreaterThan(0);
        expect(engineCut(hits), shape).toBe(cut);
        // in the engine's order: several records, then text before the header, then the cap
        const capped = cut === null ? [] : [`Query truncated: blastn has a query cap of 10000 nt, so only query 1-10000 of ${cut} nt was searched; query coverage is against all ${cut} nt.`];
        for (const h of hits) {
          expect(h.warnings ?? [], shape).toEqual([...warnings, ...capped]);
        }
      }
      // an empty first record: no hit, so the window's own notice says why
      expect(runLocalBlastSearch(empty, [subject], 'blastn', 'db'), 'an empty first record').toEqual([]);
      expect(notices(renderBlast('blastn', doc('q', 'q', empty), [subject]))).toEqual([records(2, 0)]);
      // with hits, the window's caption counts the first record and its notices are the engine's, lengths grouped
      const html = renderBlast('blastn', doc('q', 'q', fasta), [subject]);
      expect(hitRows(html)).toBeGreaterThan(0);
      expect(html).toContain('hits on the query (12,000 residues)');
      expect(notices(html)).toEqual([
        'Query holds 2 FASTA records: blastn searched only the first (12,000 nt); query coordinates and coverage are against that record.',
        'Query truncated: blastn has a query cap of 10,000 nt, so only query 1-10,000 of 12,000 nt was searched; query coverage is against all 12,000 nt.',
      ]);
    });
  });
});

describe('annotate by BLAST', () => {
  it('annotate-by-BLAST reports a truncated target, naming it and the cap', () => {
    const filler = randomDna(12_314, 26);
    // pUC19 inside the searched first 10,000 nt / past it / a target short enough to search whole
    const early = doc('early', 'early-15kb', puc.sequence + filler);
    const late = doc('late', 'late-14.7kb', filler.slice(0, 12_000) + puc.sequence);
    const short = doc('short', 'short-4.7kb', puc.sequence + filler.slice(0, 2_000));
    expect([early, late, short].map((d) => d.sequence.length)).toEqual([15_000, 14_686, 4_686]);
    // fixture: the late target's searched part holds no chance pUC19 HSP at the 90% identity the run asks for
    expect(runLocalBlastSearch(late.sequence.slice(0, 10_000), [puc], 'blastn', 'db').filter((h) => h.identityPct >= 90)).toEqual([]);

    const r = runAnnotateByBlast([early, late, short], [puc], { maxHits: 3, minHitIdentity: 90, minIdentity: 95 });
    const capNote = (len: string) => `Searched only nt 1-10,000 of this ${len}-nt sequence: blastn's query cap is 10,000 nt, so no hit past nt 10,000 could be found.`;
    const [earlyU, lateU, shortU] = ['early', 'late', 'short'].map((id) => r.updated.find((d) => d.id === id)!);
    // the late target is searched (its pUC19 lies past the cap, so nothing is found) and gets no
    // annotation, but its History still records the run and why it found nothing
    expect(r.updated.map((d) => d.id)).toEqual(['early', 'late', 'short']);
    const added = earlyU.features.length + shortU.features.length;
    expect(added).toBeGreaterThan(0);

    // the full note lives in each truncated document's History, where it is not clipped and stays put
    const earlyStep = earlyU.history.at(-1)!;
    expect(earlyStep.operation).toBe('Annotate by BLAST');
    expect(earlyStep.description).toBe(`${earlyU.features.length} annotations from top hits: ${puc.name}. ${capNote('15,000')}`);
    expect(lateU.history).toHaveLength(1);
    expect(lateU.history[0]).toMatchObject({
      operation: 'Annotate by BLAST',
      description: `No annotated hits ≥ 90% identity. ${capNote('14,686')}`,
      parentIds: ['late'], lengthBp: 14_686, topology: 'linear',
    });
    expect(lateU.features).toEqual([]);
    expect(lateU.sequence).toBe(late.sequence);
    // a target searched whole carries no note
    expect(shortU.history.at(-1)!.description).toBe(`${shortU.features.length} annotations from top hits: ${puc.name}`);
    // read where the researcher reads it: the document's History tab timeline, one step per entry
    for (const d of [earlyU, lateU]) {
      const steps = historySteps(renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={d} allDocuments={[d]} />));
      expect(steps.at(-1), d.name).toBe(d.history.at(-1)!.description);
      expect(steps.at(-1), d.name).toContain(capNote(d.sequence.length.toLocaleString()));
    }

    // the status toast is one line that the reviewer saw clip after 77 characters ("3 annotations
    // added to 2 sequences. The blastn query cap is 10000 nt, so only"): it now carries a pointer to
    // History inside them, ahead of the per-target lines
    expect(r.summary).toBe(
      `${added} annotations added to 2 sequences; 2 targets partly searched, see History — ` +
      [`early-15kb (nt 1-10,000 of 15,000 searched): hits ${puc.name}`, 'late-14.7kb (nt 1-10,000 of 14,686 searched): no annotated hits ≥ 90% identity', `short-4.7kb: hits ${puc.name}`].join('; '),
    );
    expect(r.summary.indexOf('see History') + 'see History'.length).toBeLessThanOrEqual(77);

    // one cut target: singular, recorded in its History
    const one = runAnnotateByBlast([late], [puc], { maxHits: 3, minHitIdentity: 90 });
    expect(one.summary).toBe('0 annotations added to 0 sequences; 1 target partly searched, see History — late-14.7kb (nt 1-10,000 of 14,686 searched): no annotated hits ≥ 90% identity');
    expect(one.updated.map((d) => d.history.at(-1)!.description)).toEqual([`No annotated hits ≥ 90% identity. ${capNote('14,686')}`]);
    // hits, but nothing new to transfer: the History still records the cut
    const again = runAnnotateByBlast([earlyU], [puc], { maxHits: 3, minHitIdentity: 90, minIdentity: 95, replace: false });
    expect(again.summary).toBe(`0 annotations added to 0 sequences; 1 target partly searched, see History — early-15kb (nt 1-10,000 of 15,000 searched): hits ${puc.name}`);
    expect(again.updated).toHaveLength(1);
    expect(again.updated[0].features).toEqual(earlyU.features);
    expect(again.updated[0].history.map((h) => h.description)).toEqual([earlyStep.description, `0 annotations from top hits: ${puc.name}. ${capNote('15,000')}`]);
    // a run with no cut target carries no note
    const none = runAnnotateByBlast([short], [puc], { maxHits: 3, minHitIdentity: 90, minIdentity: 95 });
    expect(none.summary).toBe(`${shortU.features.length} annotations added to 1 sequence — short-4.7kb: hits ${puc.name}`);
    expect(none.updated[0].history.at(-1)!.description).toBe(`${shortU.features.length} annotations from top hits: ${puc.name}`);
  });
});
