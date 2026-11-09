// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The contig-assembly sample reads are seeded simulations of their NCBI references (US-01M6TDSV
 * AC5): the two COI Sanger reads of NC_001709.1 (Drosophila melanogaster COX1) and the yghJ Ion
 * Torrent and Illumina read sets of the E. coli K-12 yghJ CDS (YP_026189.1). Each read document
 * stores the seed and the reference region it was drawn with, and is labelled as simulated.
 *
 * The simulator below is written from the description in sample_alignments_data.rs, not imported
 * from it: it reads the reference as scripts/outside-data/fetch.sh fetches it, draws every read set
 * again from the stored seed, and must give the stored reads (and, for the Sanger reads, the
 * stored qualities) exactly. Reads relabelled from any other source, or drawn from another
 * reference, region or seed, cannot pass.
 */

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

interface NodeFsRead { readFileSync: (p: string, e: string) => string }
const fsSpec: string = 'node:fs';
const fsP = import(/* @vite-ignore */ fsSpec) as Promise<NodeFsRead>;

const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
const revcomp = (s: string) => s.split('').reverse().map((c) => COMP[c] ?? '?').join('');

/** mulberry32: one 32-bit draw per call; below(n) is next() % n. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { below: (n: number) => next() % n };
}
type Rng = ReturnType<typeof rng>;
/** An error base: one draw picks one of the three other bases in ACGT order. */
const substitute = (b: string, r: Rng) => {
  const pick = r.below(3);
  const others = 'ACGT'.split('').filter((x) => x !== b);
  return others.length === 3 ? others[pick] : b;
};
const template = (ref: string, start: number, len: number, reverse: boolean) => {
  const s = ref.slice(start, start + len).toUpperCase();
  return reverse ? revcomp(s) : s;
};
const withErrors = (t: string, perMille: number, r: Rng) => t.split('').map((b) => (r.below(1000) < perMille ? substitute(b, r) : b)).join('');

function sangerRead(ref: string, start: number, len: number, reverse: boolean, seed: number) {
  const r = rng(seed);
  const profile = (i: number) => (i < 30 ? 12 + Math.floor((i * 46) / 30) : i + 90 >= len ? 58 - Math.floor(((i + 90 - len) * 48) / 90) : 58);
  const errPerMille = (q: number) => (q < 10 ? 250 : q < 20 ? 60 : q < 30 ? 8 : 1);
  const calls: string[] = [];
  const quals: number[] = [];
  template(ref, start, len, reverse).split('').forEach((b, i) => {
    const q = Math.min(60, Math.max(6, profile(i) + r.below(9) - 4));
    calls.push(r.below(1000) < errPerMille(q) ? substitute(b, r) : b);
    quals.push(q);
  });
  return { calls: calls.join(''), quals };
}
function ionTorrentReads(ref: string, count: number, seed: number) {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const len = 196 + r.below(33);
    const start = r.below(ref.length - len + 1);
    const reverse = r.below(2) === 1;
    return { start, len, reverse, read: withErrors(template(ref, start, len, reverse), 5, r) };
  });
}
function illuminaPairs(ref: string, pairs: number, seed: number) {
  const r = rng(seed);
  return Array.from({ length: pairs }, () => {
    const insert = 250 + r.below(101);
    const start = r.below(ref.length - insert + 1);
    const r1 = withErrors(template(ref, start, 90, false), 2, r);
    const r2 = withErrors(template(ref, start + insert - 90, 90, true), 2, r);
    return { start, insert, r1, r2 };
  });
}

const byId = (id: string) => {
  const d = SAMPLE_LIBRARY.find((x) => x.id === id);
  expect(d, id).toBeDefined();
  return d as SequenceDocument;
};
const meta = (d: SequenceDocument, key: string) => {
  const v = d.docMetadata?.[key];
  expect(v, `${d.id} ${key}`).toBeDefined();
  return v;
};
/** The read sets this check covers: every document of the Contig Assembly folder that holds reads. */
const SANGER = ['doc-contig-coi-fwd', 'doc-contig-coi-rev'];
const READ_SETS = ['doc-contig-yghj-ion-torrent', 'doc-contig-yghj-illumina'];
const REFERENCES = ['ncbi/NC_001709.1.fasta', 'ncbi/protein/YP_026189.1.cds.fasta'];

async function fastaSeq(rel: string) {
  const lines = (await fsP).readFileSync(dataPath(rel), 'utf8').split(/\r?\n/);
  expect(lines.filter((l) => l.startsWith('>')).length, `${rel} holds one record`).toBe(1);
  return { header: lines[0], seq: lines.slice(1).join('').replace(/\s/g, '').toUpperCase() };
}

describe('sample assembly reads', () => {
  it('every read sample is labelled as simulated, and nothing else in the folder holds reads', () => {
    const folder = SAMPLE_LIBRARY.filter((d) => d.folder === 'Contig Assembly');
    const readDocs = folder.filter((d) => d.documentKind === 'trace' || (d.documentKind === 'contig' && d.alignmentMeta?.isAligned === false));
    expect(readDocs.map((d) => d.id).sort()).toEqual([...SANGER, ...READ_SETS].sort());
    for (const d of [...readDocs, byId('doc-contig-coi-assembly')]) {
      expect(d.docMetadata?.Simulated, `${d.id} is labelled as simulated`).toBe('yes');
      expect(`${d.description} ${d.docMetadata?.['Read Technology']}`, d.id).toMatch(/simulated/i);
      // No claim of a sequencing run or a trace file it is not.
      expect(`${d.accession} ${d.description}`, d.id).not.toMatch(/SRR\d|\.ab1/);
    }
  });

  const haveRefs = haveTestData(...REFERENCES);
  it.skipIf(!haveRefs)('the sample reads are the seeded simulation of their NCBI reference', async () => {
    const coi = await fastaSeq('ncbi/NC_001709.1.fasta');
    expect(coi.header.split(/\s/)[0]).toBe('>NC_001709.1');
    const yghj = await fastaSeq('ncbi/protein/YP_026189.1.cds.fasta');
    expect(yghj.header).toContain('[protein_id=YP_026189.1]');

    for (const id of SANGER) {
      const d = byId(id);
      expect(meta(d, 'Simulation model')).toBe('sanger');
      expect(meta(d, 'Simulation reference')).toBe('NC_001709.1');
      const at = /^([\d,]+) -> ([\d,]+)$/.exec(String(meta(d, 'Simulation region')));
      expect(at, `${id} region`).not.toBeNull();
      const [from, to] = [Number(at![1].replace(/,/g, '')), Number(at![2].replace(/,/g, ''))];
      const strand = meta(d, 'Simulation strand');
      expect([1, -1]).toContain(strand);
      const { calls, quals } = sangerRead(coi.seq, from - 1, to - from + 1, strand === -1, Number(meta(d, 'Simulation seed')));
      expect(d.sequence, `${id} reads as simulated`).toBe(calls);
      expect(d.chromatogram?.baseCalls, `${id} trace base calls`).toBe(calls);
      expect(d.chromatogram?.phredScores, `${id} trace qualities`).toEqual(quals);
      // The simulation makes errors where the quality is low, so the read is not the bare reference.
      expect(calls).not.toBe(template(coi.seq, from - 1, to - from + 1, strand === -1));
    }

    const ion = byId('doc-contig-yghj-ion-torrent');
    expect(meta(ion, 'Simulation model')).toBe('ion-torrent');
    expect(meta(ion, 'Simulation reference')).toBe('YP_026189.1');
    const ionMembers = ion.alignmentMeta?.sequences ?? [];
    const ionSim = ionTorrentReads(yghj.seq, ionMembers.length, Number(meta(ion, 'Simulation seed')));
    expect(ionMembers.length).toBe(24);
    expect(ion.alignmentMeta?.sequenceCount).toBe(ionMembers.length);
    ionMembers.forEach((m, i) => {
      expect(m.sequence, `${m.name} reads as simulated`).toBe(ionSim[i].read);
      expect(m.strand, `${m.name} strand`).toBe(ionSim[i].reverse ? -1 : 1);
    });

    const ill = byId('doc-contig-yghj-illumina');
    expect(meta(ill, 'Simulation model')).toBe('illumina-paired');
    expect(meta(ill, 'Simulation reference')).toBe('YP_026189.1');
    const illMembers = ill.alignmentMeta?.sequences ?? [];
    expect(illMembers.length).toBe(24);
    expect(ill.alignmentMeta?.sequenceCount).toBe(illMembers.length);
    const illSim = illuminaPairs(yghj.seq, illMembers.length / 2, Number(meta(ill, 'Simulation seed')));
    illSim.forEach((p, i) => {
      expect(illMembers[2 * i].sequence, `pair ${i + 1} read 1`).toBe(p.r1);
      expect(illMembers[2 * i + 1].sequence, `pair ${i + 1} read 2`).toBe(p.r2);
    });
  });

  it('the COI contig is MolBioCraft\'s assembly of the two simulated reads', () => {
    const contig = byId('doc-contig-coi-assembly');
    const members = contig.alignmentMeta?.sequences ?? [];
    expect(members.map((m) => m.id).sort()).toEqual([...SANGER].sort());
    for (const m of members) {
      const read = byId(m.id);
      const bases = m.sequence.replace(/-/g, '');
      // A contig row is its read (reverse-complemented onto the contig when on the other strand),
      // less the ends the assembler's quality trim removed.
      const oriented = m.strand === -1 ? revcomp(read.sequence) : read.sequence;
      expect(oriented, `${m.name} row is a stretch of its read`).toContain(bases);
      expect(bases.length, `${m.name} keeps most of its read`).toBeGreaterThan(read.sequence.length * 0.8);
      expect(m.sequence.length, `${m.name} spans the contig`).toBe(contig.sequence.length);
    }
    expect(contig.history.flatMap((h) => h.parentIds).sort()).toEqual([...SANGER].sort());
  });
});
