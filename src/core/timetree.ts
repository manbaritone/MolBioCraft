// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Timetree from a tree with branch lengths (Compute Timetree, with calibrations).
 *
 * Relative node ages (choose one):
 *  - RelTime-style (Tamura et al. 2012, default): bottom-up, a node's depth is the geometric
 *    mean of its descendant lineage lengths (branch + depth below); top-down, sister lineages
 *    get rates in the ratio of their lineage lengths with the ancestral rate as their geometric
 *    mean. Node time = depth / rate, so every lineage reaches the tips together.
 *  - Mean path length (Britton et al. 2002): mean path length to the descendant tips divided
 *    by the root's, ages capped at the parent's.
 * Calibrations (the MRCA of two taxa with a minimum and/or maximum age) then set one scale
 * factor: the midpoint of the range allowed by every calibration, or — when they conflict —
 * the median of each calibration's own midpoint, with a warning. `timetreeConfidence` adds
 * bootstrap 95% intervals. The outgroup is used for
 * rooting and then left out of the timetree.
 */

import { leafNames, rerootAtOutgroup, type TreeNode } from './treeConsensus';
import { fromTreeNode, namedSplitKey, rng, splitLengths, weightedColumns, type Matrix } from './treeSearch';

export interface Calibration {
  taxonA: string;
  taxonB: string;
  /** Mya; null = unbounded. */
  minAge: number | null;
  maxAge: number | null;
}

export interface TimetreeNode {
  /** "A – B": the first and last descendant tips. */
  label: string;
  /** Sorted descendant tip names joined by U+0001 (stable clade identity). */
  key: string;
  /** 95% interval from bootstrap replicates (set by `timetreeConfidence`). */
  ciLow?: number;
  ciHigh?: number;
  tips: number;
  relativeAge: number;
  /** Absolute age (Mya) when calibrated, else relative (root = 1). */
  age: number;
  /** Substitution rate on the branch above the node, relative to the tree mean. */
  relativeRate: number | null;
}

export interface TimetreeResult {
  tree: TreeNode;
  nodes: TimetreeNode[];
  scale: number;
  calibrated: boolean;
  warnings: string[];
  calibrationReport: { calibration: Calibration; nodeLabel: string; relativeAge: number; impliedAge: number; satisfied: boolean }[];
}

interface Work { node: TreeNode; tips: string[]; mpl: number; d: number; rate: number; rel: number; parent: Work | null; children: Work[]; length: number }

export type TimetreeMethod = 'reltime' | 'mpl';

export interface TimetreeOptions {
  /** 'reltime' (default): RelTime-style relative rates; 'mpl': mean path length. */
  method?: TimetreeMethod;
  /** Multiplier for the branch above the clade with these tips (bootstrap replicates). */
  lengthFactor?: (tips: string[]) => number;
  /** When given, the time scale is drawn uniformly within the range the calibrations allow. */
  random?: () => number;
}

export const TIMETREE_METHODS: Record<TimetreeMethod, string> = {
  reltime: 'RelTime-style relative rates (Tamura et al. 2012)',
  mpl: 'Mean path length (Britton et al. 2002)',
};

export function computeTimetree(input: TreeNode, outgroup: string, calibrations: Calibration[], opts: TimetreeOptions = {}): TimetreeResult {
  const method = opts.method ?? 'reltime';
  const warnings: string[] = [];
  let root = input;
  if (outgroup) {
    root = rerootAtOutgroup(input, outgroup);
    // drop the outgroup: the root's other child becomes the ingroup root
    const ingroup = root.children.find((c) => !(c.children.length === 0 && c.name === outgroup)) ?? root;
    if (ingroup === root) warnings.push(`Outgroup "${outgroup}" not found next to the root; the whole tree is used.`);
    root = { ...ingroup, length: null };
  } else if (root.children.length > 2) {
    warnings.push('The tree is unrooted (the root has more than two branches): ages are measured from that root. Choose an outgroup for a proper root.');
  }
  if (leafNames(root).length < 2) throw new Error('The timetree needs at least two ingroup sequences.');

  const build = (n: TreeNode, parent: Work | null): Work => {
    const w: Work = { node: n, tips: [], mpl: 0, d: 0, rate: 1, rel: 0, parent, children: [], length: Math.max(0, n.length ?? 0) };
    if (!n.children.length) w.tips = [n.name];
    else {
      w.children = n.children.map((c) => build(c, w));
      w.tips = w.children.flatMap((c) => c.tips);
      // mean path length: average over tips of (branch to child + child's mean path)
      w.mpl = w.children.reduce((s, c) => s + c.tips.length * (c.length + c.mpl), 0) / w.tips.length;
      // RelTime depth: geometric mean of the descendant lineage lengths (branch + depth below)
      w.d = Math.exp(w.children.reduce((s, c) => s + Math.log(Math.max(1e-12, c.length + c.d)), 0) / w.children.length);
    }
    if (parent && opts.lengthFactor) w.length *= Math.max(0, opts.lengthFactor(w.tips));
    return w;
  };
  const top = build(root, null);
  if (top.mpl <= 0) throw new Error('The tree has no branch lengths: a timetree needs a tree with branch lengths (for example from Build Tree).');
  const all: Work[] = [];
  const assign = (w: Work) => {
    if (method === 'mpl') w.rel = w.parent ? Math.min(w.parent.rel, w.mpl / top.mpl) : 1;
    else {
      // Sister lineages' rates are in the ratio of their lineage lengths and their geometric
      // mean is the ancestral rate: r_c = R_parent · x_c / d_parent. Node time = d / R, which
      // makes every lineage reach the tips at the same time.
      if (w.parent) w.rate = (w.parent.rate * Math.max(1e-12, w.length + w.d)) / Math.max(1e-12, w.parent.d);
      w.rel = w.children.length ? w.d / w.rate / top.d : 0;
      if (w.parent) w.rel = Math.min(w.parent.rel, w.rel);
    }
    all.push(w);
    w.children.forEach(assign);
  };
  assign(top);

  const mrca = (a: string, b: string): Work | null => {
    let best: Work | null = null;
    for (const w of all) if (w.tips.includes(a) && w.tips.includes(b) && (!best || w.tips.length < best.tips.length)) best = w;
    return best;
  };
  const labelOf = (w: Work) => (w.tips.length === 1 ? w.tips[0] : `${w.tips[0]} – ${w.tips[w.tips.length - 1]}`);

  // scale factor from calibrations
  const ranges: { lo: number; hi: number; mid: number }[] = [];
  const cals: { calibration: Calibration; w: Work }[] = [];
  for (const c of calibrations) {
    if (c.minAge === null && c.maxAge === null) continue;
    const w = mrca(c.taxonA, c.taxonB);
    if (!w) { warnings.push(`Calibration ${c.taxonA} + ${c.taxonB}: taxon not in the ingroup; ignored.`); continue; }
    if (w.tips.length < 2) { warnings.push(`Calibration ${c.taxonA} + ${c.taxonB}: the two taxa must differ; ignored.`); continue; }
    if (w.rel <= 0) { warnings.push(`Calibration on ${labelOf(w)}: the node has zero relative age; ignored.`); continue; }
    const lo = c.minAge !== null ? c.minAge / w.rel : 0;
    const hi = c.maxAge !== null ? c.maxAge / w.rel : Infinity;
    if (lo > hi) { warnings.push(`Calibration on ${labelOf(w)}: minimum age is above the maximum; ignored.`); continue; }
    ranges.push({ lo, hi, mid: Number.isFinite(hi) ? (lo + hi) / 2 : lo });
    cals.push({ calibration: c, w });
  }
  let scale = 1;
  const calibrated = ranges.length > 0;
  if (calibrated) {
    const lo = Math.max(...ranges.map((r) => r.lo));
    const hi = Math.min(...ranges.map((r) => r.hi));
    if (lo <= hi) scale = Number.isFinite(hi) ? (opts.random ? lo + opts.random() * (hi - lo) : (lo + hi) / 2) : lo;
    else {
      const mids = ranges.map((r) => r.mid).sort((a, b) => a - b);
      scale = mids[Math.floor(mids.length / 2)];
      warnings.push('The calibrations conflict with each other under these relative ages; the median of their implied scales is used and some calibrations are not met.');
    }
  } else warnings.push('No calibrations: ages are relative (root = 1).');

  // relative rates: substitutions per unit time on each branch, relative to the tree mean
  const totalLen = all.reduce((s, w) => s + (w.parent ? w.length : 0), 0);
  const totalTime = all.reduce((s, w) => s + (w.parent ? w.parent.rel - w.rel : 0), 0);
  const meanRate = totalTime > 0 ? totalLen / totalTime : 0;
  const rateOf = (w: Work) => {
    if (!w.parent) return null;
    const dt = w.parent.rel - w.rel;
    return dt > 0 && meanRate > 0 ? w.length / dt / meanRate : null;
  };

  const toTree = (w: Work): TreeNode => ({
    name: w.node.children.length ? '' : w.node.name,
    length: w.parent ? (w.parent.rel - w.rel) * scale : null,
    children: w.children.map(toTree),
  });
  const nodes: TimetreeNode[] = all
    .filter((w) => w.tips.length > 1)
    .map((w) => ({ label: labelOf(w), key: [...w.tips].sort().join('\u0001'), tips: w.tips.length, relativeAge: w.rel, age: w.rel * scale, relativeRate: rateOf(w) }))
    .sort((a, b) => b.age - a.age);
  const calibrationReport = cals.map(({ calibration, w }) => {
    const implied = w.rel * scale;
    const ok = (calibration.minAge === null || implied >= calibration.minAge - 1e-9) && (calibration.maxAge === null || implied <= calibration.maxAge + 1e-9);
    return { calibration, nodeLabel: labelOf(w), relativeAge: w.rel, impliedAge: implied, satisfied: ok };
  });
  return { tree: toTree(top), nodes, scale, calibrated, warnings, calibrationReport };
}

// ───────────────────────────── bootstrap confidence intervals ─────────────────────────────

export interface TimetreeCiOptions {
  method: TimetreeMethod;
  replicates: number;
  /** Aligned sequences in the order of `labels` (the tree's tip names). */
  labels: string[];
  seqs: string[];
  distances: (seqs: string[]) => Matrix;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Point estimate plus 95% intervals: sites are bootstrapped, each branch length is scaled by
 * its replicate / full-data ratio (balanced least-squares lengths on the fixed topology), the
 * time scale is drawn within the calibration range, and node ages are recomputed.
 */
export async function timetreeConfidence(input: TreeNode, outgroup: string, calibrations: Calibration[], o: TimetreeCiOptions): Promise<TimetreeResult & { replicatesDone: number }> {
  const point = computeTimetree(input, outgroup, calibrations, { method: o.method });
  const tips = leafNames(input);
  const index = new Map(o.labels.map((l, i) => [l, i]));
  const missing = tips.filter((t) => !index.has(t));
  if (missing.length) throw new Error(`Tree tips not in the alignment: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
  const target = fromTreeNode(input, o.labels.length, (nm) => index.get(nm) ?? -1);
  const base = splitLengths(target, o.distances(o.seqs), o.labels);
  const rand = rng(o.seed ?? 20260105);
  const L = Math.max(...o.seqs.map((s) => s.length));
  const ages = new Map<string, number[]>(point.nodes.map((n) => [n.key, []]));
  let done = 0;
  for (let r = 0; r < o.replicates; r++) {
    if (o.signal?.aborted) throw new Error('Cancelled.');
    const w = new Array<number>(L).fill(0);
    for (let i = 0; i < L; i++) w[Math.floor(rand() * L)]++;
    const rep = splitLengths(target, o.distances(weightedColumns(o.seqs, w)), o.labels);
    const factor = (below: string[]) => {
      const k = namedSplitKey(below, o.labels);
      const b = base.get(k) ?? 0;
      return b > 1e-9 ? (rep.get(k) ?? b) / b : 1;
    };
    const res = computeTimetree(input, outgroup, calibrations, { method: o.method, lengthFactor: factor, random: rand });
    for (const n of res.nodes) ages.get(n.key)?.push(n.age);
    done++;
    o.onProgress?.(done, o.replicates);
    if (done % 5 === 0) await new Promise((res2) => setTimeout(res2, 0));
  }
  const nodes = point.nodes.map((n) => {
    const a = (ages.get(n.key) ?? []).sort((x, y) => x - y);
    return a.length ? { ...n, ciLow: quantile(a, 0.025), ciHigh: quantile(a, 0.975) } : n;
  });
  return { ...point, nodes, replicatesDone: done };
}
