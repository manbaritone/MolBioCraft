// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { compareAnnotations, mateOf, mergePair } from '../core/annotationReadTools';
import { reverseComplement } from '../core/bioEngine';
import type { SequenceFeature } from '../types/bio';

const f = (name: string, type: string, start: number, end: number, strand: 1 | -1 = 1) =>
  ({ id: name, name, type, start, end, strand, color: '#000' } as SequenceFeature);

describe('compare annotations', () => {
  it('classifies identical, overlapping and unique features of the same type', () => {
    const A = [f('gene1', 'CDS', 10, 100), f('gene2', 'CDS', 200, 300), f('p', 'promoter', 1, 9), f('src', 'source', 1, 1000)];
    const B = [f('g1', 'CDS', 10, 100), f('g2', 'CDS', 210, 300), f('t', 'terminator', 400, 450), f('src', 'source', 1, 1000)];
    const r = compareAnnotations(A, B, 50);
    const by = (s: string) => r.filter((x) => x.status === s).map((x) => (x.a ?? x.b)!.name);
    expect(by('identical')).toEqual(['gene1']);
    expect(by('overlapping')).toEqual(['gene2']);
    expect(by('only-a')).toEqual(['p']);
    expect(by('only-b')).toEqual(['t']);
    expect(r.find((x) => x.status === 'overlapping')!.overlapPct).toBeCloseTo(90.1, 1);
  });
});

describe('paired reads', () => {
  it('recognises common mate naming styles', () => {
    expect(mateOf('S1_R1')).toEqual({ key: 'S1', mate: 1 });
    expect(mateOf('S1_R2_001.fastq')).toEqual({ key: 'S1', mate: 2 });
    expect(mateOf('clone7/1')).toEqual({ key: 'clone7', mate: 1 });
    expect(mateOf('COI fwd read')).toBeNull();
    expect(mateOf('M13-F')).toEqual({ key: 'M13', mate: 1 });
  });
  it('merges overlapping mates into the fragment and resolves conflicts by quality', () => {
    let x = 99;
    const frag = Array.from({ length: 300 }, () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return 'ACGT'[(x >>> 16) & 3]; }).join('');
    const r1 = frag.slice(0, 180);
    const r2 = reverseComplement(frag.slice(140));
    expect(mergePair(r1, r2, undefined, undefined, 20, 10)).toMatchObject({ merged: frag, overlap: 40, mismatches: 0 });
    // one error in read 1's low-quality tail is corrected by read 2's high-quality base
    const bad = r1.slice(0, 170) + (r1[170] === 'A' ? 'C' : 'A') + r1.slice(171);
    const q1 = new Array(180).fill(40); q1[170] = 5;
    const q2 = new Array(160).fill(40);
    const m = mergePair(bad, r2, q1, q2, 20, 10);
    expect(m.merged).toBe(frag);
    expect(m.conflicts).toBe(1);
  });
  it('refuses pairs that do not overlap', () => {
    expect(mergePair('ACGTACGTACGTACGTACGTACGT', 'TTTTTTTTTTTTTTTTTTTTTTTT', undefined, undefined, 20, 10).merged).toBeNull();
  });
});

describe('runners', async () => {
  const { runCompareAnnotations, runMergePairedReads } = await import('../core/operationRunners');
  const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
  const base = { ...EMPTY_WORKSPACE_DOCUMENT, moleculeType: 'DNA' as const, sequence: 'A'.repeat(500) };
  it('compare annotations makes an annotated copy with counts', () => {
    const a = { ...base, id: 'a', name: 'v1', features: [f('g1', 'CDS', 10, 100), f('g2', 'CDS', 200, 300)] };
    const b = { ...base, id: 'b', name: 'v2', features: [f('g1', 'CDS', 10, 100), f('g3', 'CDS', 400, 450)] };
    const r = runCompareAnnotations(a, b, { minOverlap: 50 });
    const d = r.created[0];
    expect(d.features).toHaveLength(3);
    expect(d.docMetadata).toMatchObject({ Identical: 1, 'Only in v1': 1, 'Only in v2': 1 });
    expect(d.features.map((x) => x.qualifiers?.comparison)).toEqual(['identical in both', 'only in first', 'only in second']);
  });
  it('merge paired reads pairs by name and reports reads without mates', () => {
    let x = 7;
    const frag = Array.from({ length: 260 }, () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return 'ACGT'[(x >>> 16) & 3]; }).join('');
    const r1 = { ...base, id: 'r1', name: 'S1_R1', sequence: frag.slice(0, 160) };
    const r2 = { ...base, id: 'r2', name: 'S1_R2', sequence: reverseComplement(frag.slice(110)) };
    const lone = { ...base, id: 'r3', name: 'S2_R1', sequence: frag.slice(0, 100) };
    const r = runMergePairedReads([r1, r2, lone], {}, { sourceLabel: 'x' });
    expect(r.created).toHaveLength(1);
    expect(r.created[0].sequence).toBe(frag);
    expect(r.created[0].name).toBe('S1 (merged)');
    expect(r.summary).toMatch(/1 reads without a mate/);
  });
});
