// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { runFindStructuralVariants } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

function randomDna(n: number, seed: number): string {
  let x = seed;
  return Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) % 2147483648; return 'ACGT'[(x >>> 16) % 4]; }).join('');
}
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const rc = (s: string) => [...s].reverse().map((c) => COMP[c]).join('');

const ref = randomDna(4000, 17);
const refDoc = { id: 'ref', name: 'ref', accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence: ref, features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Contig Assembly' } as unknown as SequenceDocument;

/** Reads tiled across a sample genome (150 bp, step 25), half of them reverse-complemented. */
function readsFrom(sample: string): SequenceDocument[] {
  const out: SequenceDocument[] = [];
  for (let s = 0, k = 0; s + 150 <= sample.length; s += 25, k++) {
    const seq = sample.slice(s, s + 150);
    out.push({ ...refDoc, id: `r${k}`, name: `read${k}`, sequence: k % 2 ? rc(seq) : seq });
  }
  return out;
}

const run = (sample: string) => runFindStructuralVariants(refDoc, readsFrom(sample), { minSupport: 2 }, { sourceLabel: 'x' }).created[0].features
  .map((f) => ({ type: f.qualifiers?.sv_type, start: f.start, end: f.end, support: Number(f.qualifiers?.supporting_reads) }));

describe('structural variants from split reads', () => {
  it('finds a 300-bp deletion', () => {
    const calls = run(ref.slice(0, 1500) + ref.slice(1800));
    const d = calls.find((c) => c.type === 'Deletion')!;
    expect(d).toBeTruthy();
    expect(Math.abs(d.start - 1501)).toBeLessThanOrEqual(5);
    expect(Math.abs(d.end - 1800)).toBeLessThanOrEqual(5);
    expect(d.support).toBeGreaterThanOrEqual(2);
  });
  it('finds an insertion of novel sequence', () => {
    const calls = run(ref.slice(0, 2000) + randomDna(80, 99) + ref.slice(2000));
    const i = calls.find((c) => c.type === 'Insertion')!;
    expect(i).toBeTruthy();
    expect(Math.abs(i.start - 2000)).toBeLessThanOrEqual(5);
  });
  it('finds an inversion breakpoint', () => {
    const calls = run(ref.slice(0, 1200) + rc(ref.slice(1200, 1700)) + ref.slice(1700));
    expect(calls.some((c) => c.type === 'Inversion' && (Math.abs(c.start - 1200) <= 10 || Math.abs(c.end - 1700) <= 10))).toBe(true);
  });
  it('finds a tandem duplication', () => {
    const calls = run(ref.slice(0, 2600) + ref.slice(2400, 2600) + ref.slice(2600));
    const t = calls.find((c) => c.type === 'Tandem duplication')!;
    expect(t).toBeTruthy();
    expect(Math.abs(t.start - 2401)).toBeLessThanOrEqual(5);
    expect(Math.abs(t.end - 2600)).toBeLessThanOrEqual(5);
  });
  it('still finds the deletion with ~1% sequencing errors in the reads', () => {
    let y = 5;
    const noisy = readsFrom(ref.slice(0, 1500) + ref.slice(1800)).map((r) => ({
      ...r, sequence: [...r.sequence].map((c) => { y = (y * 1103515245 + 12345) % 2147483648; return (y >>> 16) % 100 === 0 ? (c === 'A' ? 'C' : 'A') : c; }).join(''),
    }));
    const calls = runFindStructuralVariants(refDoc, noisy, { minSupport: 2 }, { sourceLabel: 'x' }).created[0].features;
    const d = calls.find((f) => f.qualifiers?.sv_type === 'Deletion')!;
    expect(d).toBeTruthy();
    expect(Math.abs(d.start - 1501)).toBeLessThanOrEqual(5);
    expect(calls.filter((f) => f.qualifiers?.sv_type !== 'Deletion')).toHaveLength(0);
  });
  it('a circular reference: reads across the origin are not mistaken for duplications', () => {
    const circ = { ...refDoc, topology: 'circular' } as SequenceDocument;
    const rotated = ref.slice(3000) + ref.slice(0, 3000);
    const calls = runFindStructuralVariants(circ, readsFrom(rotated), { minSupport: 2 }, { sourceLabel: 'x' }).created[0].features;
    expect(calls).toHaveLength(0);
    // a deletion next to the origin is still found
    const del = runFindStructuralVariants(circ, readsFrom((ref.slice(3000) + ref.slice(0, 3000)).replace(ref.slice(100, 400), '')), { minSupport: 2 }, { sourceLabel: 'x' }).created[0].features;
    expect(del.some((f) => f.qualifiers?.sv_type === 'Deletion' && Math.abs(f.start - 101) <= 5)).toBe(true);
  });
  it('reports nothing for a sample identical to the reference', () => {
    expect(run(ref)).toEqual([]);
  });
});
