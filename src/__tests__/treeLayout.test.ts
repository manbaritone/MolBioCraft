// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { parseNewick, toNewick } from '../core/treeConsensus';
import { flipAt, ladderize, layoutTree, midpointRoot, niceLength, nodeAt, rootOnPath, tipNames, type TreeStyle } from '../core/treeLayout';

const T = '((A:1,B:2)90:3,(C:1,(D:2,E:1)75:1)60:1);';
const opts = (style: TreeStyle, compressed: string[] = []) => ({ style, compressed: new Set(compressed), width: 800, rowHeight: 20, labelWidth: 120 });

describe('tree explorer layout', () => {
  it.each(['rectangular', 'cladogram', 'circular', 'radial'] as TreeStyle[])('%s: one node per tree node, one branch per non-root node', (style) => {
    const L = layoutTree(parseNewick(T), opts(style));
    expect(L.nodes).toHaveLength(9);
    expect(L.nodes.filter((n) => n.isTip).map((n) => n.label).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(L.branches.filter((b) => !b.path.endsWith('#v'))).toHaveLength(8);
    for (const n of L.nodes) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true); }
  });
  it('phylogram x is proportional to depth; support labels are read', () => {
    const L = layoutTree(parseNewick(T), opts('rectangular'));
    const at = (p: string) => L.nodes.find((n) => n.path === p)!;
    expect(at('0.1').x - at('').x).toBeCloseTo(5 * L.scale, 6); // B: 3 + 2
    expect(at('0').support).toBe(90);
    expect(at('1.1').support).toBe(75);
  });
  it('compressing a subtree draws it as one triangle', () => {
    const L = layoutTree(parseNewick(T), opts('rectangular', ['1']));
    const c = L.nodes.find((n) => n.path === '1')!;
    expect(c.compressed).toBe(true);
    expect(c.triangle).toMatch(/^M/);
    expect(c.label).toMatch(/3 taxa/);
    expect(L.nodes.filter((n) => n.isTip)).toHaveLength(3);
  });
  it('flip, ladderize and rerooting keep the taxa and the support on the right clades', () => {
    const t = parseNewick(T);
    expect(tipNames(flipAt(t, '1'))).toEqual(['A', 'B', 'D', 'E', 'C']);
    expect(tipNames(ladderize(t))).toEqual(['A', 'B', 'C', 'D', 'E']);
    const r = rootOnPath(t, '1.1'); // root on the branch above (D,E)
    expect(tipNames(r).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(tipNames(r.children[0]).sort()).toEqual(['D', 'E']);
    expect(r.children[0].label).toBe('75');
    expect((r.children[0].length ?? 0) + (r.children[1].length ?? 0)).toBeCloseTo(1, 9);
    expect(toNewick(r)).toMatch(/90/); // the (A,B) clade keeps its support
  });
  it('midpoint rooting puts the root halfway along the longest path', () => {
    // longest path B–D: 2 + 3 + 1 + 1 + 2 = 9 → midpoint 4.5 from B
    const r = midpointRoot(parseNewick(T));
    const dist = (n: ReturnType<typeof parseNewick>, name: string, d = 0): number | null => {
      if (!n.children.length) return n.name === name ? d : null;
      for (const c of n.children) { const x = dist(c, name, d + (c.length ?? 0)); if (x !== null) return x; }
      return null;
    };
    expect(dist(r, 'B')).toBeCloseTo(4.5, 9);
    expect(dist(r, 'D')).toBeCloseTo(4.5, 9);
  });
  it('nodeAt and niceLength', () => {
    expect(nodeAt(parseNewick(T), '1.1.0')!.name).toBe('D');
    expect(niceLength(0.037)).toBeCloseTo(0.02, 9);
    expect(niceLength(7)).toBe(5);
  });
});
