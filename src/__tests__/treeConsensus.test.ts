// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { consensusTree, leafNames, parseNewick, rerootAtOutgroup, toNewick, type TreeNode } from '../core/treeConsensus';

const clades = (n: TreeNode): string[] => {
  const out: string[] = [];
  const walk = (x: TreeNode): string[] => {
    if (!x.children.length) return [x.name];
    const u = x.children.flatMap(walk).sort();
    if (x !== n) out.push(u.join(''));
    return u;
  };
  walk(n);
  return out.sort();
};
const totalLength = (n: TreeNode): number => (n.length ?? 0) + n.children.reduce((a, c) => a + totalLength(c), 0);

describe('newick', () => {
  it('round-trips names, quotes, lengths and support labels', () => {
    const t = parseNewick("((A:0.1,'B c':0.2)95:0.3,(C:0.4,D:0.5)80:0.6);");
    expect(leafNames(t)).toEqual(['A', 'B c', 'C', 'D']);
    expect(toNewick(t)).toBe("((A:0.1,'B c':0.2)95:0.3,(C:0.4,D:0.5)80:0.6);");
    expect(() => parseNewick('((A,B);')).toThrow(/Malformed/);
  });
});

describe('outgroup rooting', () => {
  const t = parseNewick('((A:1,B:2)90:3,C:4,(D:5,E:6)70:7);');
  it('puts the outgroup at the root and keeps total branch length', () => {
    const r = rerootAtOutgroup(t, 'E');
    expect(r.children).toHaveLength(2);
    expect(r.children.some((c) => c.name === 'E' && c.length === 3)).toBe(true);
    expect(totalLength(r)).toBeCloseTo(totalLength(t), 6);
    expect(leafNames(r).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('keeps the unrooted topology and support with its branch', () => {
    const r = rerootAtOutgroup(t, 'A');
    // The A+B split (support 90) is still there, as its complement C,D,E.
    expect(clades(r)).toContain('CDE');
    expect(toNewick(r)).toContain(')90:');
    expect(() => rerootAtOutgroup(t, 'Z')).toThrow(/not a tip/);
  });
});

describe('majority-rule consensus', () => {
  const trees = [
    '((A:1,B:1):1,(C:1,D:1):1,E:1);',
    '((A:1,B:1):3,(C:1,E:1):1,D:1);',
    '((A:1,B:1):2,(C:1,D:1):1,E:1);',
    '((A:1,C:1):1,(B:1,D:1):1,E:1);',
  ];
  it('keeps clades above the threshold with % support and mean lengths', () => {
    const r = consensusTree(trees, 50);
    const sup = Object.fromEntries(r.clades.map((c) => [c.taxa.join(''), c.supportPct]));
    expect(sup.AB).toBe(75);
    expect(sup.CD).toBeUndefined(); // 2/4 = 50% is not a majority
    expect(r.newick).toContain('(A:1,B:1)75:2');
    const t = parseNewick(r.newick);
    expect(leafNames(t).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('applies burn-in and a strict 100% threshold, and rejects different tip sets', () => {
    expect(consensusTree(trees.slice(0, 3), 100).clades.map((c) => c.taxa.join(''))).toEqual(['AB']);
    const burned = consensusTree(trees, 50, 50);
    expect(burned.used).toBe(2);
    expect(burned.clades).toEqual([]);
    expect(() => consensusTree(['(A,B,C);', '(A,B,D);'], 50)).toThrow(/different tips/);
    expect(() => consensusTree(['(A,B,C);'], 50)).toThrow(/at least two trees/);
  });
});

describe('tree runners', async () => {
  const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
  const { phylogenySourceDocuments } = await import('../core/documentViews');
  const { runBuildTree, runConsensusTree, sanitizeNewickLabel, newickOf } = await import('../core/operationRunners');
  const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
  const rows = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 8);

  it('Build Tree roots on the chosen outgroup', async () => {
    const out = rows[3].name;
    const r = await runBuildTree(rows, { method: 'Neighbor-Joining (NJ)', outgroup: out }, { sourceLabel: 'x' });
    const t = parseNewick(newickOf(r.created[0])!);
    expect(t.children.some((c) => !c.children.length && c.name === sanitizeNewickLabel(out))).toBe(true);
    expect(r.created[0].docMetadata?.Outgroup).toBe(out);
  });

  it('builds a consensus of tree documents', async () => {
    const a = await runBuildTree(rows, { method: 'Neighbor-Joining (NJ)' }, { sourceLabel: 'a' });
    const b = await runBuildTree(rows, { method: 'UPGMA' }, { sourceLabel: 'b' });
    const c = runConsensusTree([a.created[0], b.created[0]], { threshold: 50 }, { sourceLabel: 'ab' });
    expect(leafNames(parseNewick(newickOf(c.created[0])!)).sort()).toEqual(leafNames(parseNewick(newickOf(a.created[0])!)).sort());
    expect(c.created[0].docMetadata?.['Trees used']).toBe(2);
  });
});

describe('jackknife resampling', async () => {
  const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
  const { phylogenySourceDocuments } = await import('../core/documentViews');
  const { runBuildTree } = await import('../core/operationRunners');
  it('Build Tree runs a jackknife and labels the support as such', async () => {
    const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const rows = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 8);
    const r = await runBuildTree(rows, { method: 'Neighbor-Joining (NJ)', resampling: 'jackknife', replicates: 50, jackknifePct: 50 }, { sourceLabel: 'x' });
    expect(String(r.created[0].docMetadata?.['Branch support'])).toBe('jackknife (50% of columns kept), 50 replicates (%)');
  });
});

describe('condensed tree and gene duplications', async () => {
  const { condenseTree, inferDuplications, rootMinimizingDuplications } = await import('../core/treeConsensus');
  it('collapses interior branches below the cutoff', () => {
    const t = parseNewick('((A:1,B:1)95:1,((C:1,D:1)40:1,E:1)70:1);');
    const c = condenseTree(t, 50);
    expect(c.collapsed).toBe(1);
    expect(toNewick(c.tree)).toBe('((A:1,B:1)95:1,(C:2,D:2,E:1)70:1);');
    expect(condenseTree(parseNewick('((A,B)0.3,(C,D)0.9);'), 50).collapsed).toBe(1);
  });
  it('finds a duplication before speciation (alpha/beta globin style)', () => {
    // Two paralogues (a, b), each present in human, mouse and chicken.
    const gene = parseNewick('(((a_Human,a_Mouse),a_Chicken),((b_Human,b_Mouse),b_Chicken));');
    const species = parseNewick('((Human,Mouse),Chicken);');
    const sp = (t: string) => t.split('_')[1] ?? null;
    const r = inferDuplications(gene, species, sp);
    expect(r.duplications).toHaveLength(1);
    expect(r.duplications[0].tips).toHaveLength(6);
    expect(r.speciations).toBe(4);
    expect(r.newick.endsWith(')D;')).toBe(true);
    const none = inferDuplications(parseNewick('((x_Human,x_Mouse),x_Chicken);'), species, sp);
    expect(none.duplications).toHaveLength(0);
  });
  it('can choose the root that minimises duplications and reports unmapped tips', () => {
    const species = parseNewick('((Human,Mouse),Chicken);');
    const sp = (t: string) => t.split('_')[1] ?? null;
    const badlyRooted = parseNewick('(x_Human,(x_Mouse,x_Chicken));');
    expect(inferDuplications(badlyRooted, species, sp).duplications.length).toBeGreaterThan(0);
    expect(rootMinimizingDuplications(badlyRooted, species, sp).result.duplications).toHaveLength(0);
    expect(inferDuplications(parseNewick('(x_Human,x_Dog);'), species, sp).unmapped).toEqual(['x_Dog']);
  });
});
