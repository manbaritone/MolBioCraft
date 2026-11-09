// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Where the sample alignments' members come from (US-01M6TGKH). Every member of every sample
 * alignment, and of every tree built from one, cites the public NCBI record it was identified as,
 * by exact match: its accession.version, and when the member is a region of that record, an
 * `extracted region` feature named for the record whose note gives the record's 1-based, inclusive
 * coordinates (`start -> end`) and whose strand is the record strand. Its ungapped sequence equals
 * that record or region exactly, as scripts/outside-data/fetch.sh fetches it.
 *
 * scripts/outside-data/identify_alignment_members.py made the identification once (efetch of the
 * records a member names, UniParc for proteins, NCBI BLAST for the rest) and records it in RESULTS;
 * this suite checks the library against that record and every citation against the fetched
 * record. It runs no search.
 *
 * The aligned samples' rows are MolBioCraft's own MSA of those records (US-01M6TDSV): the check
 * below aligns the fetched records again and compares row by row.
 */

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { MSA_ALGORITHMS, normalizeMsaPresetId } from '../core/operationRunners';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { MSA_MAX_RESIDUES } from '../core/bioEngine';
import { translationAlign } from '../core/alignmentTools';
import type { AlignmentMemberSequence, SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

interface NodeFsRead { readFileSync: (p: string | URL, e: string) => string }
const fsSpec: string = 'node:fs';
const fsP = import(/* @vite-ignore */ fsSpec) as Promise<NodeFsRead>;
const repoText = async (rel: string) => (await fsP).readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** The sample alignments the library ships, by document id, after US-01M6TGKH. */
const ALIGNMENTS = [
  'doc-aln-coxii-cds', 'doc-aln-hiv-env', 'doc-aln-ig-variable', 'doc-aln-lysr-family',
  'doc-aln-pairwise-protein', 'doc-aln-three-kingdoms', 'doc-aln-transcript-variants',
];
/** The placeholder ids the members carried before they were identified. */
const PLACEHOLDER = /^(3K|COX2|PWPROT|TXVAR|PEOPLE)_\d+$/;
/**
 * An INSDC or RefSeq accession with its version, or a PDB chain as NCBI Protein versions it (1BP4_A:
 * entry and chain, which NCBI gives as the accession.version).
 */
const ACCESSION_VERSION = /^(?:(?:[A-Z]{1,2}\d{5,6}|[A-Z]{3}\d{5,7}|[A-Z]{2}_\d{6,9}|[A-Z]{2}_[A-Z]{4}\d{8,10})\.\d+|\d[A-Z0-9]{3}_[A-Z0-9]{1,4})$/;
const PDB_CHAIN = /^(\d[A-Z0-9]{3})_([A-Z0-9]{1,4})$/;
/** The id E-utilities' FASTA header gives the record: `pdb|1BP4|A` for a PDB chain. */
const fastaId = (record: string) => {
  const pdb = PDB_CHAIN.exec(record);
  return pdb ? `pdb|${pdb[1]}|${pdb[2]}` : record;
};

/** The documents whose members are alignment members: the alignments and the trees built from them. */
const memberDocs = SAMPLE_LIBRARY.filter((d) => d.alignmentMeta?.sequences?.length && (d.folder === 'Alignments' || d.folder === 'Tree Documents'));
const alignments = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments' && d.documentKind === 'alignment');
const isProtein = (d: SequenceDocument) => d.moleculeType === 'Protein';

interface Citation { record: string; start?: number; end?: number; strand?: 1 | -1; replaces?: string }
/** The record a member cites, and the region of it when the member is one. */
function citationOf(m: AlignmentMemberSequence): Citation {
  const regions = (m.features ?? []).filter((f) => String(f.type) === 'extracted region');
  expect(regions.length, `${m.id} has at most one extracted region`).toBeLessThanOrEqual(1);
  const record = m.accession ?? '';
  if (regions.length === 0) return { record };
  const [f] = regions;
  expect(f.name, `${m.id} region names its record`).toBe(`Extracted region from ${record}`);
  const at = /^([\d,]+) -> ([\d,]+)$/.exec(f.notes ?? '');
  expect(at, `${m.id} region note "${f.notes}"`).not.toBeNull();
  const [start, end] = [Number(at![1].replace(/,/g, '')), Number(at![2].replace(/,/g, ''))];
  expect(start, `${m.id} region runs forward`).toBeLessThanOrEqual(end);
  expect([1, -1], `${m.id} region strand`).toContain(f.strand);
  return { record, start, end, strand: f.strand as 1 | -1 };
}
const recordFile = (record: string, protein: boolean) => (protein ? `ncbi/protein/${record}.fasta` : `ncbi/${record}.fasta`);
const ungapped = (s: string, protein: boolean) => {
  const u = s.replace(/[-.]/g, '').toUpperCase();
  return protein ? u : u.replace(/U/g, 'T');
};
const rc = (s: string) =>
  s.split('').reverse().map((c) => ({ A: 'T', T: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', N: 'N' } as Record<string, string>)[c] ?? '?').join('');
const cited = memberDocs.flatMap((d) => (d.alignmentMeta?.sequences ?? []).map((m) => ({ doc: d, m, protein: isProtein(d) })));
const citedFiles = [...new Set(cited.map(({ m, protein }) => recordFile(m.accession ?? '', protein)))];

/** RESULTS from identify_alignment_members.py: per set, per member, a citation or the reason it was dropped. */
async function recordedResults(): Promise<Record<string, Record<string, Citation | string>>> {
  const py = await repoText('scripts/outside-data/identify_alignment_members.py');
  const at = py.indexOf('\nRESULTS = ');
  expect(at, 'identify_alignment_members.py records RESULTS').toBeGreaterThan(0);
  const end = py.indexOf('\n}\n', at);
  return JSON.parse(py.slice(at + '\nRESULTS = '.length, end + 2));
}

describe('sample alignment members are public NCBI records', () => {
  it('ships the sample alignments, and their trees carry their members', () => {
    expect(alignments.map((d) => d.id).sort()).toEqual([...ALIGNMENTS].sort());
    for (const d of memberDocs.filter((x) => x.folder === 'Tree Documents')) {
      const source = alignments.find((a) => d.history.some((h) => h.parentIds?.includes(a.id)));
      expect(source, `${d.name} names the alignment it was built from`).toBeDefined();
      expect(d.alignmentMeta?.sequences, `${d.name} carries ${source!.id}'s members`).toEqual(source!.alignmentMeta?.sequences);
    }
  });

  const haveRecords = haveTestData(...citedFiles);
  it.skipIf(!haveRecords)('alignment members are their NCBI records', async () => {
    const fs = await fsP;
    const records = new Map<string, { header: string; seq: string }>();
    const read = (file: string) => {
      if (!records.has(file)) {
        const lines = fs.readFileSync(dataPath(file), 'utf8').split(/\r?\n/);
        expect(lines.filter((l) => l.startsWith('>')).length, `${file} holds one record`).toBe(1);
        records.set(file, { header: lines[0], seq: lines.slice(1).join('').replace(/\s/g, '').toUpperCase() });
      }
      return records.get(file)!;
    };
    let checked = 0;
    for (const { doc, m, protein } of cited) {
      const c = citationOf(m);
      const rec = read(recordFile(c.record, protein));
      // The fetched record is the version cited, not a later one.
      expect(rec.header.split(/\s/)[0], `${doc.id}/${m.id} record header`).toBe(`>${fastaId(c.record)}`);
      const want = c.start === undefined ? rec.seq : rec.seq.slice(c.start - 1, c.end);
      expect(c.end ?? 0, `${doc.id}/${m.id} region lies inside ${c.record}`).toBeLessThanOrEqual(rec.seq.length);
      const region = c.strand === -1 ? rc(want) : want;
      expect(ungapped(m.sequence, protein), `${doc.id}/${m.id} (${m.name}) equals ${c.record}${c.start ? `:${c.start}-${c.end}` : ''}`).toBe(region);
      // A region citation is used only where the member is not the whole record.
      if (c.start !== undefined) expect(region.length, `${doc.id}/${m.id} cites a region shorter than ${c.record}`).toBeLessThan(rec.seq.length);
      checked++;
    }
    expect(checked).toBe(cited.length);
    expect(checked).toBeGreaterThan(0);
  });

  // US-01M6TDSV AC1: the aligned samples are MolBioCraft's MSA of the members' fetched records (COXII,
  // a coding set, its Translation Alignment: D0095), run with the preset and residue cap (and for
  // COXII the frame and genetic code) each alignment's metadata names; the unaligned samples hold the
  // records ungapped. No other aligner's output is stored: rows from any other aligner, or from
  // MolBioCraft with another preset, differ in their gaps and fail.
  it.skipIf(!haveRecords)("each sample alignment is MolBioCraft's alignment of its fetched members", async () => {
    const fs = await fsP;
    const fetched = (m: AlignmentMemberSequence, protein: boolean) => {
      const c = citationOf(m);
      const lines = fs.readFileSync(dataPath(recordFile(c.record, protein)), 'utf8').split(/\r?\n/);
      const seq = lines.slice(1).join('').replace(/\s/g, '').toUpperCase();
      const want = c.start === undefined ? seq : seq.slice(c.start - 1, c.end);
      return c.strand === -1 ? rc(want) : want;
    };
    const aligned = alignments.filter((d) => d.alignmentMeta?.isAligned);
    expect(aligned.map((d) => d.id).sort()).toEqual(['doc-aln-coxii-cds', 'doc-aln-pairwise-protein', 'doc-aln-three-kingdoms', 'doc-aln-transcript-variants']);
    const presets = MSA_ALGORITHMS.map((o) => o.value).filter(Boolean);
    const methods: string[] = [];
    for (const d of aligned) {
      const meta = d.docMetadata ?? {};
      const method = String(meta['Alignment method']);
      methods.push(method);
      expect(['MolBioCraft MSA', 'MolBioCraft Translation Alignment'], `${d.id} alignment method`).toContain(method);
      const preset = String(meta['Alignment preset']);
      expect(presets, `${d.id} names a MolBioCraft MSA preset`).toContain(normalizeMsaPresetId(preset));
      const maxSeqLen = Number(meta['Alignment max residues']);
      expect(Number.isInteger(maxSeqLen) && maxSeqLen > 0, `${d.id} names its residue cap`).toBe(true);
      expect(d.history.map((h) => h.operation), `${d.id} history`).toEqual([`${method} (${preset})`]);
      const members = d.alignmentMeta!.sequences!;
      const protein = isProtein(d);
      const inputs = members.map((m) => ({ id: m.id, name: m.name, sequence: fetched(m, protein) }));
      let rows: { id: string; row: string }[];
      if (method === 'MolBioCraft Translation Alignment') {
        // Align > Translation Alignment, with the frame and code the metadata names. Its protein
        // alignment runs at the engine's own residue cap, which the metadata must name.
        expect(maxSeqLen, `${d.id} residue cap`).toBe(MSA_MAX_RESIDUES);
        const frame = Number(meta['Translation frame']) as 1 | 2 | 3;
        expect([1, 2, 3], `${d.id} names its frame`).toContain(frame);
        const res = translationAlign(inputs, frame, String(meta['Genetic Code']), preset);
        expect(res.error, `${d.id} translation alignment`).toBeNull();
        rows = res.rows.map((r) => ({ id: r.id, row: r.nucleotide }));
        // A codon alignment: every codon starts at a column that is a multiple of 3.
        expect(rows[0].row.length % 3, `${d.id} width`).toBe(0);
      } else {
        expect(meta['Translation frame'], `${d.id} names no frame`).toBeUndefined();
        const result = invokeRustBioSync<{ rows: { id: string; alignedSeq: string }[]; warnings: string[] }>('run_msa', {
          docs: inputs,
          maxSeqLen,
          algorithm: preset,
        });
        expect(result.warnings, `${d.id} aligns every residue`).toEqual([]);
        rows = result.rows.map((r) => ({ id: r.id, row: r.alignedSeq }));
      }
      expect(rows.map((r) => r.id), `${d.id} rows`).toEqual(members.map((m) => m.id));
      members.forEach((m, i) => {
        // RNA samples store U where the fetched record has T.
        const stored = d.moleculeType === 'RNA' ? m.sequence.replace(/U/g, 'T') : m.sequence;
        expect(stored, `${d.id}/${m.id} (${m.name}) is MolBioCraft's row`).toBe(rows[i].row);
      });
    }
    // The coding set is the codon alignment; the others are plain MSAs.
    expect(methods).toEqual(aligned.map((d) => (d.id === 'doc-aln-coxii-cds' ? 'MolBioCraft Translation Alignment' : 'MolBioCraft MSA')));
    for (const d of alignments.filter((x) => !x.alignmentMeta?.isAligned)) {
      expect(d.docMetadata?.['Alignment method'], `${d.id} stores no alignment`).toBeUndefined();
      for (const m of d.alignmentMeta?.sequences ?? []) expect(m.sequence, `${d.id}/${m.id} is ungapped`).not.toMatch(/[-.]/);
    }
  }, 180_000);

  it('no sample alignment member keeps a placeholder accession', async () => {
    expect(SAMPLE_LIBRARY.some((d) => /fictitious/i.test(`${d.docMetadata?.Organism ?? ''} ${d.description}`)), 'the fictitious-character set is dropped').toBe(false);
    for (const d of alignments) expect(d.alignmentMeta?.sequences?.length ?? 0, `${d.id} keeps at least two members`).toBeGreaterThanOrEqual(2);
    for (const { doc, m } of cited) {
      expect(m.accession ?? '', `${doc.id}/${m.id}`).not.toMatch(PLACEHOLDER);
      expect(m.accession ?? '', `${doc.id}/${m.id} cites accession.version`).toMatch(ACCESSION_VERSION);
    }
    // The library holds exactly what the identification recorded: every identified member, with its
    // citation, and no dropped member or set.
    const results = await recordedResults();
    const src = await repoText('crates/molbiocraft-cloning/src/sample_alignments_data.rs');
    const docComment = src.slice(src.indexOf('//! '), src.indexOf('\nuse '));
    for (const [setId, rows] of Object.entries(results)) {
      const kept = Object.entries(rows).filter(([, r]) => typeof r !== 'string') as [string, Citation][];
      const dropped = Object.entries(rows).filter(([, r]) => typeof r === 'string').map(([id]) => id);
      const doc = alignments.find((d) => d.id === setId);
      if (kept.length < 2) {
        expect(doc, `${setId} is dropped`).toBeUndefined();
        expect(docComment, `the doc comment lists ${setId} as dropped`).toContain(`${setId}: dropped`);
        continue;
      }
      expect(doc, `${setId} ships`).toBeDefined();
      const members = doc!.alignmentMeta!.sequences!;
      expect(members.map((m) => m.id), `${setId} members`).toEqual(kept.map(([id]) => id));
      expect(doc!.alignmentMeta!.sequenceCount, `${setId} sequence count`).toBe(members.length);
      const line = docComment.split('\n').find((l) => l.includes(`${setId}:`)) ?? '';
      for (const [id, want] of kept) {
        const m = members.find((x) => x.id === id)!;
        const { replaces, ...cite } = want;
        expect(citationOf(m), `${setId}/${id} citation`).toEqual(cite);
        if (replaces) expect(line, `the doc comment lists ${setId}'s replaced ${id}`).toContain(`replaced ${id}`);
      }
      const droppedPart = line.slice(line.indexOf('dropped'));
      for (const id of dropped) expect(droppedPart, `the doc comment lists ${setId}'s dropped ${id}`).toMatch(new RegExp(`\\b${id}\\b`));
      if (dropped.length === 0) expect(line, `the doc comment says ${setId} dropped none`).toContain('none dropped');
    }
    expect(Object.keys(results).sort(), 'RESULTS covers every set').toEqual([...ALIGNMENTS, 'doc-aln-people'].sort());
  });

  it('fetch.sh fetches every cited alignment member record', async () => {
    const sh = await repoText('scripts/outside-data/fetch.sh');
    const list = (name: string) => {
      const at = new RegExp(`^${name}="([^"]*)"$`, 'm').exec(sh);
      expect(at, `fetch.sh sets ${name}`).not.toBeNull();
      return at![1].split(/\s+/).filter(Boolean).sort();
    };
    const nuc = list('ALIGNMENT_MEMBERS_NUCCORE');
    const prot = list('ALIGNMENT_MEMBERS_PROTEIN');
    const want = (protein: boolean) => [...new Set(cited.filter((c) => c.protein === protein).map((c) => c.m.accession ?? ''))].sort();
    expect(nuc, 'nucleotide records fetched').toEqual(want(false));
    expect(prot, 'protein records fetched').toEqual(want(true));
    // Each list is fetched as the FASTA file the check above reads.
    expect(sh).toContain('for a in $ALIGNMENT_MEMBERS_NUCCORE; do\n  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"');
    expect(sh).toContain('for a in $ALIGNMENT_MEMBERS_PROTEIN; do\n  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=$a&rettype=fasta&retmode=text" "ncbi/protein/$a.fasta"');
  });
});
