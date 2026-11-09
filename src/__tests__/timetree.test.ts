// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { parseNewick, leafNames } from '../core/treeConsensus';
import { computeTimetree } from '../core/timetree';

// Clock-like tree: AB split at 1, CD split at 2, root at 3 (substitution units).
const CLOCK = '((A:1,B:1):2,(C:2,D:2):1);';

describe('timetree', () => {
  it('recovers ages of a clock-like tree from one fixed calibration', () => {
    const r = computeTimetree(parseNewick(CLOCK), '', [{ taxonA: 'C', taxonB: 'D', minAge: 20, maxAge: 20 }]);
    const age = (l: string) => r.nodes.find((n) => n.label === l)!.age;
    expect(age('C – D')).toBeCloseTo(20, 9);
    expect(age('A – B')).toBeCloseTo(10, 9);
    expect(age('A – D')).toBeCloseTo(30, 9);
    expect(r.calibrationReport[0].satisfied).toBe(true);
    // equal rates everywhere on a clock-like tree
    for (const n of r.nodes) if (n.relativeRate !== null) expect(n.relativeRate).toBeCloseTo(1, 9);
  });
  it('uses the midpoint of the range allowed by all calibrations', () => {
    const r = computeTimetree(parseNewick(CLOCK), '', [
      { taxonA: 'A', taxonB: 'B', minAge: 8, maxAge: null }, // scale ≥ 24
      { taxonA: 'A', taxonB: 'C', minAge: null, maxAge: 36 }, // scale ≤ 36
    ]);
    expect(r.scale).toBeCloseTo(30, 9);
    expect(r.calibrationReport.every((c) => c.satisfied)).toBe(true);
  });
  it('warns about conflicting calibrations', () => {
    const r = computeTimetree(parseNewick(CLOCK), '', [
      { taxonA: 'A', taxonB: 'B', minAge: 50, maxAge: 60 },
      { taxonA: 'C', taxonB: 'D', minAge: 5, maxAge: 6 },
    ]);
    expect(r.warnings.join(' ')).toMatch(/conflict/);
    expect(r.calibrationReport.some((c) => !c.satisfied)).toBe(true);
  });
  it('roots on the outgroup and leaves it out of the timetree', () => {
    const r = computeTimetree(parseNewick('(((A:1,B:1):2,(C:2,D:2):1):4,O:4);'), 'O', []);
    expect(leafNames(r.tree).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(r.calibrated).toBe(false);
    expect(r.nodes[0].age).toBeCloseTo(1, 9);
  });
  it('a node is never older than its parent, even with fast lineages', () => {
    const r = computeTimetree(parseNewick('((A:5,B:0.1):0.1,(C:1,D:1):1);'), '', []);
    const ab = r.nodes.find((n) => n.label === 'A – B')!;
    expect(ab.age).toBeLessThanOrEqual(1);
  });
  it('refuses a tree without branch lengths', () => {
    expect(() => computeTimetree(parseNewick('((A,B),(C,D));'), '', [])).toThrow(/branch lengths/);
  });
});

describe('RelTime-style rates', () => {
  // A evolves twice as fast as B; CD at clock rate.
  const T = '((A:2,B:1):1,(C:1,D:1):1);';
  it('gives a time-consistent tree with the expected relative ages', () => {
    const r = computeTimetree(parseNewick(T), '', []);
    // depths: AB = √2, CD = 1, root = √((1+√2)·2); ages relative to the root
    const dRoot = Math.sqrt((1 + Math.SQRT2) * 2);
    const rAB = (1 + Math.SQRT2) / dRoot;
    const rCD = 2 / dRoot;
    const age = (l: string) => r.nodes.find((n) => n.label === l)!.age;
    expect(age('A – B')).toBeCloseTo(Math.SQRT2 / rAB / dRoot, 9);
    expect(age('C – D')).toBeCloseTo(1 / rCD / dRoot, 9);
    expect(age('A – D')).toBeCloseTo(1, 9);
    // ultrametric: every tip at depth 1 (root age) in time units
    const depth = (n: ReturnType<typeof parseNewick>, d = 0): number[] => (n.children.length ? n.children.flatMap((c) => depth(c, d + (c.length ?? 0))) : [d]);
    for (const d of depth(r.tree)) expect(d).toBeCloseTo(1, 9);
  });
  it('differs from mean path length when rates vary, matches it on a clock', () => {
    const rt = computeTimetree(parseNewick(T), '', [], { method: 'reltime' });
    const mp = computeTimetree(parseNewick(T), '', [], { method: 'mpl' });
    expect(rt.nodes.find((n) => n.label === 'A – B')!.age).not.toBeCloseTo(mp.nodes.find((n) => n.label === 'A – B')!.age, 3);
    const c1 = computeTimetree(parseNewick(CLOCK), '', [], { method: 'reltime' });
    const c2 = computeTimetree(parseNewick(CLOCK), '', [], { method: 'mpl' });
    c1.nodes.forEach((n, i) => expect(n.age).toBeCloseTo(c2.nodes[i].age, 9));
  });
});

describe('timetree confidence intervals', () => {
  it('brackets the point estimate and follows the calibration range', async () => {
    const { timetreeConfidence } = await import('../core/timetree');
    // simulated alignment on ((A,B),(C,D)) with random sites
    let x = 12345;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const L = 400;
    const pick = () => 'ACGT'[Math.floor(rand() * 4)];
    const anc = Array.from({ length: L }, pick);
    const mut = (s: string[], p: number) => s.map((c) => (rand() < p ? pick() : c));
    const ab = mut(anc, 0.15);
    const cd = mut(anc, 0.15);
    const seqs = [mut(ab, 0.08), mut(ab, 0.08), mut(cd, 0.08), mut(cd, 0.08)].map((s) => s.join(''));
    const labels = ['A', 'B', 'C', 'D'];
    const pd = (s: string[]) => s.map((a) => s.map((b) => [...a].filter((c, i) => c !== b[i]).length / a.length));
    const D = pd(seqs);
    const tree = parseNewick(`((A:${D[0][1] / 2},B:${D[0][1] / 2}):0.1,(C:${D[2][3] / 2},D:${D[2][3] / 2}):0.1);`);
    const r = await timetreeConfidence(tree, '', [{ taxonA: 'A', taxonB: 'C', minAge: 90, maxAge: 110 }], { method: 'reltime', replicates: 60, labels, seqs, distances: pd });
    expect(r.replicatesDone).toBe(60);
    const root = r.nodes.find((n) => n.label === 'A – D')!;
    expect(root.ciLow!).toBeGreaterThanOrEqual(90 - 1e-9);
    expect(root.ciHigh!).toBeLessThanOrEqual(110 + 1e-9);
    const ab2 = r.nodes.find((n) => n.label === 'A – B')!;
    expect(ab2.ciLow!).toBeLessThan(ab2.age);
    expect(ab2.ciHigh!).toBeGreaterThan(ab2.age);
  });
});
