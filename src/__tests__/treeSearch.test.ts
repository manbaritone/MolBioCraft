// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { parseNewick, toNewick } from '../core/treeConsensus';
import {
  balancedBranchLengths, balancedLength, fromTreeNode, neighborJoining, nniSearch, parsimonyData,
  parsimonyLength, searchTree, splitsOf, sprSearch, type Matrix,
} from '../core/treeSearch';

// True tree ((A:1,B:2):3,(C:1,(D:2,E:1):1):1) on 5 taxa → additive distances.
const NAMES = ['A', 'B', 'C', 'D', 'E'];
const TRUE = '((A:1,B:2):3,(C:1,(D:2,E:1):1):1);';
function pathMatrix(newick: string): Matrix {
  const root = parseNewick(newick);
  // pairwise distance = path length through the last common ancestor
  const paths = new Map<string, { node: unknown; len: number }[]>();
  const walk = (n: ReturnType<typeof parseNewick>, acc: { node: unknown; len: number }[]) => {
    const here = [...acc, { node: n, len: n.length ?? 0 }];
    if (!n.children.length) paths.set(n.name, here);
    n.children.forEach((c) => walk(c, here));
  };
  walk(root, []);
  return NAMES.map((a) => NAMES.map((b) => {
    if (a === b) return 0;
    const pa = paths.get(a)!;
    const pb = paths.get(b)!;
    let k = 0;
    while (k < pa.length && k < pb.length && pa[k].node === pb[k].node) k++;
    return pa.slice(k).reduce((s, x) => s + x.len, 0) + pb.slice(k).reduce((s, x) => s + x.len, 0);
  }));
}

describe('minimum evolution', () => {
  const D = pathMatrix(TRUE);
  const truth = fromTreeNode(parseNewick(TRUE), 5, (s) => NAMES.indexOf(s));
  it('balanced length of the true tree equals the sum of its branch lengths', () => {
    expect(balancedLength(truth, D)).toBeCloseTo(1 + 2 + 3 + 1 + 1 + 2 + 1 + 1, 9);
  });
  it('NJ recovers the true topology and balanced branch lengths recover the true lengths', () => {
    const nj = neighborJoining(D);
    expect([...splitsOf(nj)].sort()).toEqual([...splitsOf(truth)].sort());
    const total = [...balancedBranchLengths(nj, D).values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(12, 9);
  });
  it('NNI moves a wrong starting tree to the true tree', () => {
    const wrong = fromTreeNode(parseNewick('((A,C),(B,(D,E)));'), 5, (s) => NAMES.indexOf(s));
    expect(balancedLength(wrong, D)).toBeGreaterThan(12);
    const r = nniSearch(wrong, D);
    expect(r.length).toBeCloseTo(12, 9);
    expect([...splitsOf(r.tree)].sort()).toEqual([...splitsOf(truth)].sort());
  });
});

describe('maximum parsimony', () => {
  // informative sites support AB | CDE and DE | ABC
  const seqs = [
    'AAAAACCCCGT',
    'AAAAACCCCTG',
    'GGGGACCCCAA',
    'GGGGTTTTTCC',
    'GGGGTTTTTAG',
  ];
  const data = parsimonyData(seqs, false);
  it('Fitch length is the same whatever the rooting and SPR finds the shortest tree', () => {
    const idx = (s: string) => NAMES.indexOf(s);
    const truth = fromTreeNode(parseNewick('((A,B),(C,(D,E)));'), 5, idx);
    const rerooted = fromTreeNode(parseNewick('(A,(B,(C,(D,E))));'), 5, idx);
    expect(parsimonyLength(truth, data)).toBe(parsimonyLength(rerooted, data));
    const wrong = fromTreeNode(parseNewick('((A,D),(C,(B,E)));'), 5, idx);
    const best = parsimonyLength(truth, data);
    expect(parsimonyLength(wrong, data)).toBeGreaterThan(best);
    const r = sprSearch(wrong, data);
    expect(r.length).toBe(best);
    expect([...splitsOf(r.tree)].sort()).toEqual([...splitsOf(truth)].sort());
  });
  it('full search with bootstrap gives strong support to the true clades', async () => {
    const pd = (s: string[]) => s.map((a) => s.map((b) => [...a].filter((c, i) => c !== b[i]).length / a.length));
    const r = await searchTree({ method: 'MP', labels: NAMES, seqs, protein: false, distances: pd, randomAdditions: 5, resampling: 'bootstrap', replicates: 50, jackknifePct: 50 });
    const nw = toNewick(r.tree);
    expect(r.score).toBe(parsimonyLength(fromTreeNode(parseNewick('((A,B),(C,(D,E)));'), 5, (s) => NAMES.indexOf(s)), data));
    expect(nw).toMatch(/A/);
    const labels = (nw.match(/\)(\d+)/g) ?? []).map((x) => Number(x.slice(1)));
    expect(labels.length).toBeGreaterThan(0);
    expect(Math.max(...labels)).toBeGreaterThanOrEqual(70);
  });
});

describe('little bootstraps and the interior-branch test', () => {
  // 8 taxa, two clear clades of 4 plus noise sites
  const base = 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT';
  const mut = (s: string, cols: number[], ch: string) => [...s].map((c, i) => (cols.includes(i) ? ch : c)).join('');
  const cladeA = [0, 3, 6, 9, 12, 15, 18, 21];
  const seqs = [
    mut(base, cladeA, 'T'), mut(mut(base, cladeA, 'T'), [30], 'G'), mut(mut(base, cladeA, 'T'), [33], 'A'), mut(mut(base, cladeA, 'T'), [36], 'C'),
    base, mut(base, [31], 'T'), mut(base, [34], 'G'), mut(base, [37], 'A'),
  ];
  const names = seqs.map((_, i) => `t${i}`);
  const pd = (s: string[]) => s.map((a) => s.map((b) => [...a].filter((c, i) => c !== b[i]).length / a.length));
  const cladeKey = '00001111';
  it('little bootstraps strongly support the true split', async () => {
    const r = await searchTree({ method: 'NJ', labels: names, seqs, protein: false, distances: pd, randomAdditions: 0, resampling: 'little', replicates: 20, jackknifePct: 50, littleSamples: 5, littleSize: 30 });
    expect(r.supportResult!.replicatesDone).toBe(100);
    expect(r.supportResult!.support.get(cladeKey)).toBeGreaterThan(90);
    expect(r.supportResult!.label).toMatch(/5 little samples of 30 sites/);
  });
  it('interior-branch test: long branch has CP ≈ 100%, CP lies in [0, 100]', async () => {
    const r = await searchTree({ method: 'ME', labels: names, seqs, protein: false, distances: pd, randomAdditions: 0, resampling: 'interior', replicates: 100, jackknifePct: 50 });
    const sup = r.supportResult!.support;
    expect(sup.get(cladeKey)).toBeGreaterThan(99);
    for (const v of sup.values()) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
  it('normal CDF matches known values', async () => {
    const { normalCdf } = await import('../core/treeSearch');
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 4);
  });
});
