// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Read mapping, variant calling, de novo assembly and structural variants on simulated Illumina
 * reads (wgsim) from the real phiX174 / lambda genomes, with known truth and BWA-MEM + bcftools /
 * SPAdes results for comparison (`scripts/outside-data/ref_ngs.py`). Skipped without test-data.
 */

import { describe, expect, it } from 'vitest';
import { mapReadsToReference } from '../core/referenceMapping';
import { runDeNovoAssembly } from '../core/genomicsAndStructureSuite';
import { findStructuralVariants } from '../core/structuralVariants';
import type { SequenceDocument } from '../types/bio';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string, e: string) => string }
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
const REF = dataPath('reference/ngs.json');
const have = haveTestData(REF);
const doc = (id: string, sequence: string): SequenceDocument => ({ id, name: id, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence, features: [], primers: [], history: [], createdAt: 0, updatedAt: 0 } as unknown as SequenceDocument);
const fastq = (p: string) => { const l = fs!.readFileSync(p, 'utf8').split('\n'); const out: { name: string; seq: string }[] = []; for (let i = 0; i + 3 < l.length; i += 4) out.push({ name: l[i].slice(1).split(/\s/)[0], seq: l[i + 1] }); return out; };
const fasta = (p: string) => fs!.readFileSync(p, 'utf8').split('>').filter(Boolean).map((b) => { const [h, ...s] = b.split('\n'); return { name: h.trim(), seq: s.join('').trim() }; });

describe.skipIf(!have)('NGS against wgsim truth, BWA-MEM + bcftools and SPAdes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const R: any = have ? JSON.parse(fs!.readFileSync(REF, 'utf8')) : null;

  it('maps the reads where wgsim drew them and calls the true variants', () => {
    const ref = doc('phiX174', fasta(dataPath('sim/phix_ref.fa'))[0].seq);
    const reads = fastq(dataPath('sim/phix_r1.fq')).slice(0, 600);
    const c = mapReadsToReference(ref, reads.map((r) => doc(r.name, r.seq)), { minIdentityPct: 80, minAlignedLength: 50, minVariantFrequencyPct: 20, minVariantCoverage: 4 });
    // wgsim names: <chr>_<start>_<end>_... (1-based outer fragment coordinates)
    let placed = 0;
    for (const m of c.mapped) {
      const f = m.doc.name.split('_');
      const a = Number(f[1]), b = Number(f[2]);
      if ((Math.abs(m.refStart - a) <= 5 || Math.abs(m.refEnd - b) <= 5)) placed++;
    }
    const mappedPct = (100 * c.mapped.length) / reads.length;
    const placedPct = (100 * placed) / Math.max(1, c.mapped.length);
    const found = (pos: number, type: string) => c.variants.some((v) => Math.abs(v.refPosition - pos) <= 1 && (type === 'SNP' ? v.type === 'SNP' : v.type !== 'SNP'));
    const hom = R.phix.truth.filter((t: { het: boolean }) => !t.het);
    const het = R.phix.truth.filter((t: { het: boolean }) => t.het);
    const homFound = hom.filter((t: { pos: number; ref: string }) => found(t.pos, t.ref === '-' ? 'Ins' : 'SNP')).length;
    const hetFound = het.filter((t: { pos: number }) => found(t.pos, 'SNP')).length;
    const truthPos = new Set(R.phix.truth.map((t: { pos: number }) => t.pos));
    const falsePos = c.variants.filter((v) => ![...truthPos].some((p) => Math.abs((p as number) - v.refPosition) <= 1));
    const bcfFound = R.phix.bcftools.length;
    const summary = `mapped ${mappedPct.toFixed(1)}% (BWA ${(100 * R.phix.bwa_mapped / R.phix.reads).toFixed(1)}%), at the simulated position ${placedPct.toFixed(1)}%; homozygous ${homFound}/${hom.length}, heterozygous ${hetFound}/${het.length} (bcftools ploidy 1 called ${bcfFound} of ${R.phix.truth.length}); false positives ${falsePos.length}: ${falsePos.slice(0, 5).map((v) => `${v.refPosition}${v.type} ${v.frequencyPct.toFixed(0)}%`).join(', ')}`;
    console.log('NGS', summary);
    expect(mappedPct, summary).toBeGreaterThan(98);
    expect(placedPct, summary).toBeGreaterThan(98);
    expect(homFound, summary).toBe(hom.length);
    expect(hetFound, summary).toBeGreaterThanOrEqual(het.length - 1);
    expect(falsePos.length, summary).toBeLessThanOrEqual(2);
  }, 300000);

  it('de novo assembly reconstructs phiX174 as SPAdes does', () => {
    const reads = fastq(dataPath('sim/phix_r1.fq'));
    const rep = runDeNovoAssembly(reads.map((r) => ({ name: r.name, sequence: r.seq })), 'CAP3', 30);
    const longest = Math.max(...rep.contigs.map((c) => c.lengthBp));
    const spades = Math.max(...R.phix.spades_contigs.map((s: string) => s.length));
    // identity of the longest contig to the genome (either strand), at the offset of its first 25-mer
    const genome = fasta(dataPath('sim/phix_ref.fa'))[0].seq;
    const comp: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
    const rcs = (x: string) => [...x].reverse().map((ch) => comp[ch] ?? 'N').join('');
    const best = rep.contigs.reduce((a, b) => (b.lengthBp > a.lengthBp ? b : a));
    let identity = 0;
    for (const c of [best.sequence, rcs(best.sequence)]) {
      if (!genome.includes(c.slice(0, 25)) && !genome.includes(c.slice(-25))) continue;
      // the simulated sample carries wgsim's indels, so compare by semi-global alignment
      const a = invokeRustBioSync<{ matches: number; alignedSeq2: string }>('align_pairwise_gotoh', { seq1: genome, seq2: c, mode: 'semiglobal', matrix: 'nucleotide', matchScore: 2, mismatchPenalty: -3, gapOpen: -5, gapExtend: -2 });
      identity = Math.max(identity, a.matches / c.length);
    }
    const summary = `app longest contig ${longest} bp of ${R.phix.genome_length} (N50 ${rep.n50Bp}, ${rep.contigs.length} contigs, identity ${(100 * identity).toFixed(2)}%); SPAdes longest ${spades}`;
    console.log('NGS', summary);
    expect(longest / R.phix.genome_length, summary).toBeGreaterThan(0.98);
    expect(rep.contigs.length, summary).toBeLessThanOrEqual(3);
    expect(identity, summary).toBeGreaterThan(0.995);
  }, 300000);

  it('finds the engineered deletion, insertion and inversion', () => {
    const ref = fasta(dataPath('sim/sv_ref.fa'))[0].seq;
    const reads = fasta(dataPath('sim/sv_reads.fa')).map((r) => ({ name: r.name, sequence: r.seq }));
    const r = findStructuralVariants(ref, reads, { minClip: 20, minSize: 30, minSupport: 3, tolerance: 15 });
    const report: string[] = [];
    for (const t of R.sv.truth as { type: string; start: number; end: number; size: number }[]) {
      const hit = r.calls.find((c) => c.type === t.type && Math.abs(c.start - t.start) <= 15 && (t.type === 'Insertion' || Math.abs(c.end - t.end) <= 15));
      report.push(`${t.type} ${t.start}-${t.end}: ${hit ? `found ${hit.start}-${hit.end} (${hit.size} bp, ${hit.support} reads)` : 'MISSED'}`);
    }
    const extra = r.calls.filter((c) => !R.sv.truth.some((t: { type: string; start: number }) => t.type === c.type && Math.abs(c.start - t.start) <= 15));
    console.log('NGS', report.join('; '), `extra calls: ${extra.length}`);
    expect(report.filter((x) => x.includes('MISSED')), report.join('\n')).toEqual([]);
    expect(extra.length, JSON.stringify(extra.slice(0, 5))).toBeLessThanOrEqual(1);
  }, 300000);
});
