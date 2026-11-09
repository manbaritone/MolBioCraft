// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Tree searches for the Minimum-Evolution and Maximum-Parsimony methods.
 *
 *  - Maximum Parsimony: Fitch (1971) length; starting trees from Neighbor-Joining and from
 *    random stepwise addition; Subtree-Pruning-Regrafting (SPR) until no move shortens the
 *    tree. Each regraft is scored exactly in O(patterns) from directional Fitch sets, so a
 *    full SPR pass costs O(n² · patterns).
 *  - Minimum Evolution: balanced ME criterion (Pauplin 2000; Desper & Gascuel 2002, as in
 *    FastME), starting from Neighbor-Joining, improved by nearest-neighbour interchanges
 *    (close-neighbour interchange).
 *
 * Branch lengths are balanced least-squares estimates from the distance matrix (negative
 * values set to 0); trees are midpoint-rooted for display.
 */

import type { TreeNode } from './treeConsensus';

/** Unrooted binary tree: leaves are nodes 0..n-1, internal nodes n..2n-3 (degree 3). */
export interface UTree {
  n: number;
  adj: number[][];
}

export type Matrix = number[][];

// ───────────────────────────── helpers ─────────────────────────────

/** Small seeded PRNG (mulberry32) so searches are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cloneTree = (t: UTree): UTree => ({ n: t.n, adj: t.adj.map((a) => [...a]) });

function link(t: UTree, a: number, b: number) {
  t.adj[a].push(b);
  t.adj[b].push(a);
}
function unlink(t: UTree, a: number, b: number) {
  t.adj[a] = t.adj[a].filter((x) => x !== b);
  t.adj[b] = t.adj[b].filter((x) => x !== a);
}

/** All undirected edges reachable from `start`, each once as [a, b]. */
function edgesFrom(t: UTree, start: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of t.adj[u]) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push([u, v]);
      stack.push(v);
    }
  }
  return out;
}

/** Leaves on v's side of edge u–v. */
function sideLeaves(t: UTree, u: number, v: number): number[] {
  const out: number[] = [];
  const stack: [number, number][] = [[u, v]];
  while (stack.length) {
    const [from, x] = stack.pop()!;
    if (x < t.n) out.push(x);
    for (const y of t.adj[x]) if (y !== from) stack.push([x, y]);
  }
  return out;
}

// ───────────────────────────── Neighbor-Joining ─────────────────────────────

/** Saitou & Nei (1987) NJ topology on a full symmetric distance matrix. */
export function neighborJoining(D: Matrix): UTree {
  const n = D.length;
  const t: UTree = { n, adj: Array.from({ length: Math.max(2 * n - 2, n) }, () => []) };
  if (n < 3) {
    if (n === 2) link(t, 0, 1);
    return t;
  }
  let active = Array.from({ length: n }, (_, i) => i);
  const d = new Map<number, Map<number, number>>();
  const get = (a: number, b: number) => (a === b ? 0 : d.get(Math.min(a, b))!.get(Math.max(a, b))!);
  const put = (a: number, b: number, v: number) => {
    const lo = Math.min(a, b);
    if (!d.has(lo)) d.set(lo, new Map());
    d.get(lo)!.set(Math.max(a, b), v);
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) put(i, j, D[i][j]);
  let next = n;
  while (active.length > 3) {
    const m = active.length;
    const r = new Map<number, number>();
    for (const i of active) r.set(i, active.reduce((s, j) => s + get(i, j), 0));
    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let x = 0; x < m; x++) {
      for (let y = x + 1; y < m; y++) {
        const i = active[x];
        const j = active[y];
        const q = (m - 2) * get(i, j) - r.get(i)! - r.get(j)!;
        if (q < best - 1e-12) { best = q; bi = i; bj = j; }
      }
    }
    const u = next++;
    link(t, u, bi);
    link(t, u, bj);
    for (const k of active) if (k !== bi && k !== bj) put(u, k, 0.5 * (get(bi, k) + get(bj, k) - get(bi, bj)));
    active = active.filter((k) => k !== bi && k !== bj);
    active.push(u);
  }
  const c = next++;
  for (const k of active) link(t, c, k);
  return t;
}

// ───────────────────────────── conversion ─────────────────────────────

/** Unrooted binary tree from a (rooted) Newick tree; `indexOf` maps tip labels to 0..n-1. */
export function fromTreeNode(root: TreeNode, n: number, indexOf: (name: string) => number): UTree {
  const t: UTree = { n, adj: Array.from({ length: 2 * n }, () => []) };
  let next = n;
  const build = (node: TreeNode): number => {
    if (!node.children.length) {
      const i = indexOf(node.name);
      if (i < 0 || i >= n) throw new Error(`Tree tip "${node.name}" is not in the alignment.`);
      return i;
    }
    let kids = node.children.map(build);
    // resolve multifurcations into a caterpillar
    while (kids.length > 2) {
      const v = next++;
      link(t, v, kids[0]);
      link(t, v, kids[1]);
      kids = [v, ...kids.slice(2)];
    }
    if (kids.length === 1) return kids[0];
    const v = next++;
    link(t, v, kids[0]);
    link(t, v, kids[1]);
    return v;
  };
  const top = build(root);
  // The root is a degree-2 node: suppress it.
  if (top >= n && t.adj[top].length === 2) {
    const [a, b] = t.adj[top];
    unlink(t, top, a);
    unlink(t, top, b);
    link(t, a, b);
    // move the last internal node into the freed slot so ids stay contiguous
    const last = next - 1;
    if (last !== top) {
      t.adj[top] = t.adj[last];
      for (const x of t.adj[top]) t.adj[x] = t.adj[x].map((y) => (y === last ? top : y));
      t.adj[last] = [];
    }
    next--;
  }
  t.adj.length = Math.max(next, n);
  return t;
}

// ───────────────────────────── Fitch parsimony ─────────────────────────────

const NUC: Record<string, number> = {
  A: 1, C: 2, G: 4, T: 8, U: 8, R: 5, Y: 10, S: 6, W: 9, K: 12, M: 3, B: 14, D: 13, H: 11, V: 7,
};
const AA = 'ACDEFGHIKLMNPQRSTVWY';

function stateMask(ch: string, protein: boolean): number {
  const c = ch.toUpperCase();
  if (!protein) return NUC[c] ?? 15;
  const i = AA.indexOf(c);
  if (i >= 0) return 1 << i;
  if (c === 'B') return (1 << AA.indexOf('D')) | (1 << AA.indexOf('N'));
  if (c === 'Z') return (1 << AA.indexOf('E')) | (1 << AA.indexOf('Q'));
  if (c === 'J') return (1 << AA.indexOf('I')) | (1 << AA.indexOf('L'));
  return (1 << 20) - 1;
}

export interface ParsimonyData {
  /** leafSets[i][k]: state set of leaf i at pattern k. */
  leafSets: Int32Array[];
  weights: Float64Array;
  /** Steps contributed by patterns that cost the same on every tree (dropped from the search). */
  constantSteps: number;
}

/** Site patterns with weights; constant (always 0-step) patterns are dropped. */
export function parsimonyData(seqs: string[], protein: boolean, siteWeights?: number[]): ParsimonyData {
  const L = Math.max(0, ...seqs.map((s) => s.length));
  const map = new Map<string, number>();
  const cols: number[][] = [];
  const w: number[] = [];
  for (let c = 0; c < L; c++) {
    const wt = siteWeights ? siteWeights[c] : 1;
    if (!wt) continue;
    const masks = seqs.map((s) => stateMask(s[c] ?? '-', protein));
    if (masks.reduce((a, b) => a & b) !== 0) continue; // a common state: 0 steps on any tree
    const key = masks.join(',');
    const k = map.get(key);
    if (k === undefined) {
      map.set(key, cols.length);
      cols.push(masks);
      w.push(wt);
    } else w[k] += wt;
  }
  const leafSets = seqs.map((_, i) => Int32Array.from(cols.map((m) => m[i])));
  return { leafSets, weights: Float64Array.from(w), constantSteps: 0 };
}

interface Dir { set: Int32Array; cost: number }

function fitchJoin(a: Dir, b: Dir, w: Float64Array): Dir {
  const P = w.length;
  const set = new Int32Array(P);
  let cost = a.cost + b.cost;
  for (let k = 0; k < P; k++) {
    const x = a.set[k] & b.set[k];
    if (x) set[k] = x;
    else { set[k] = a.set[k] | b.set[k]; cost += w[k]; }
  }
  return { set, cost };
}

/** Lazily computed directional Fitch sets: dir(u, v) = subtree on v's side of u–v. */
function fitchDirs(t: UTree, data: ParsimonyData) {
  const memo = new Map<number, Dir>();
  const M = t.adj.length + 1;
  const dir = (u: number, v: number): Dir => {
    const key = u * M + v;
    const hit = memo.get(key);
    if (hit) return hit;
    let out: Dir;
    if (v < t.n) out = { set: data.leafSets[v], cost: 0 };
    else {
      const kids = t.adj[v].filter((x) => x !== u);
      out = kids.length === 1 ? dir(v, kids[0]) : fitchJoin(dir(v, kids[0]), dir(v, kids[1]), data.weights);
    }
    memo.set(key, out);
    return out;
  };
  return dir;
}

export function parsimonyLength(t: UTree, data: ParsimonyData): number {
  const [[u, v]] = edgesFrom(t, 0);
  const dir = fitchDirs(t, data);
  return fitchJoin(dir(u, v), dir(v, u), data.weights).cost + data.constantSteps;
}

/** Steps added by joining a subtree with state sets `s` on edge u–v (given directional sets). */
function insertionCost(dir: (a: number, b: number) => Dir, u: number, v: number, s: Int32Array, w: Float64Array): number {
  const a = dir(u, v).set;
  const b = dir(v, u).set;
  let cost = 0;
  for (let k = 0; k < w.length; k++) {
    const x = a[k] & b[k];
    const root = x || a[k] | b[k];
    if ((root & s[k]) === 0) cost += w[k];
  }
  return cost;
}

/** Random stepwise addition (each taxon added where it costs the fewest steps). */
export function stepwiseAddition(n: number, data: ParsimonyData, rand: () => number): UTree {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const t: UTree = { n, adj: Array.from({ length: 2 * n - 2 }, () => []) };
  let next = n;
  const c = next++;
  for (const k of order.slice(0, 3)) link(t, c, k);
  for (const leaf of order.slice(3)) {
    const dir = fitchDirs(t, data);
    let best = Infinity;
    let picks: [number, number][] = [];
    for (const [u, v] of edgesFrom(t, order[0])) {
      const cost = insertionCost(dir, u, v, data.leafSets[leaf], data.weights);
      if (cost < best - 1e-9) { best = cost; picks = [[u, v]]; }
      else if (Math.abs(cost - best) <= 1e-9) picks.push([u, v]);
    }
    const [u, v] = picks[Math.floor(rand() * picks.length)];
    const q = next++;
    unlink(t, u, v);
    link(t, u, q);
    link(t, q, v);
    link(t, q, leaf);
  }
  return t;
}

/** SPR hill-climbing on the Fitch length. Returns the improved tree and its length. */
export function sprSearch(start: UTree, data: ParsimonyData, maxPasses = 100): { tree: UTree; length: number; moves: number; examined: number } {
  const t = cloneTree(start);
  let moves = 0;
  let examined = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let p = t.n; p < t.adj.length; p++) {
      for (const s of [...t.adj[p]]) {
        if (!t.adj[p].includes(s) || t.adj[p].length !== 3) continue;
        const sSet = fitchDirs(t, data)(p, s).set;
        const [x, y] = t.adj[p].filter((z) => z !== s);
        // remaining tree R: p removed, x–y joined
        unlink(t, p, x);
        unlink(t, p, y);
        link(t, x, y);
        const dir = fitchDirs(t, data);
        const here = insertionCost(dir, x, y, sSet, data.weights);
        let best = here;
        let bestEdge: [number, number] = [x, y];
        for (const [u, v] of edgesFrom(t, x)) {
          if (u === p || v === p) continue;
          examined++;
          const c = insertionCost(dir, u, v, sSet, data.weights);
          if (c < best - 1e-9) { best = c; bestEdge = [u, v]; }
        }
        const [u, v] = bestEdge;
        unlink(t, u, v);
        link(t, u, p);
        link(t, p, v);
        if (best < here - 1e-9) { moves++; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { tree: t, length: parsimonyLength(t, data), moves, examined };
}

// ───────────────────────────── balanced minimum evolution ─────────────────────────────

/** Pauplin (2000) balanced tree length: Σ_{i<j} 2^(1−τij) dij, τ = edges on the path. */
export function balancedLength(t: UTree, D: Matrix): number {
  let total = 0;
  for (let i = 0; i < t.n; i++) {
    const depth = new Map<number, number>([[i, 0]]);
    const stack = [i];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of t.adj[u]) {
        if (depth.has(v)) continue;
        depth.set(v, depth.get(u)! + 1);
        stack.push(v);
        if (v < t.n && v > i) total += Math.pow(2, 1 - depth.get(v)!) * D[i][v];
      }
    }
  }
  return total;
}

/** Nearest-neighbour interchanges until the balanced ME length stops decreasing. */
export function nniSearch(start: UTree, D: Matrix, maxPasses = 200): { tree: UTree; length: number; moves: number; examined: number } {
  const t = cloneTree(start);
  let length = balancedLength(t, D);
  let moves = 0;
  let examined = 0;
  const swap = (u: number, v: number, b: number, c: number) => {
    unlink(t, u, b);
    unlink(t, v, c);
    link(t, u, c);
    link(t, v, b);
  };
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let u = t.n; u < t.adj.length; u++) {
      for (const v of [...t.adj[u]]) {
        if (v < t.n || v < u || !t.adj[u].includes(v)) continue;
        const [, b] = t.adj[u].filter((x) => x !== v);
        for (const c of t.adj[v].filter((x) => x !== u)) {
          swap(u, v, b, c);
          examined++;
          const l = balancedLength(t, D);
          if (l < length - 1e-10) {
            length = l;
            moves++;
            improved = true;
            break;
          }
          swap(u, v, c, b);
        }
      }
    }
    if (!improved) break;
  }
  return { tree: t, length, moves, examined };
}

// ───────────────────────────── branch lengths, splits, output ─────────────────────────────

/** Balanced (Desper & Gascuel 2002) branch lengths for every edge; key `min*M+max`. */
export function balancedBranchLengths(t: UTree, D: Matrix, clampNegative = true): Map<number, number> {
  const M = t.adj.length + 1;
  const memo = new Map<number, Map<number, number>>();
  const weights = (u: number, v: number): Map<number, number> => {
    const key = u * M + v;
    const hit = memo.get(key);
    if (hit) return hit;
    let out: Map<number, number>;
    if (v < t.n) out = new Map([[v, 1]]);
    else {
      out = new Map();
      const kids = t.adj[v].filter((x) => x !== u);
      for (const k of kids) for (const [leaf, w] of weights(v, k)) out.set(leaf, (out.get(leaf) ?? 0) + w / kids.length);
    }
    memo.set(key, out);
    return out;
  };
  const avg = (X: Map<number, number>, Y: Map<number, number>) => {
    let s = 0;
    for (const [i, wi] of X) for (const [j, wj] of Y) s += wi * wj * D[i][j];
    return s;
  };
  const lengths = new Map<number, number>();
  for (const [u, v] of edgesFrom(t, 0)) {
    let l: number;
    const sideOf = (a: number, b: number) => t.adj[a].filter((x) => x !== b).map((x) => weights(a, x));
    if (t.n === 2) l = D[0][1];
    else if (u < t.n || v < t.n) {
      const [leaf, inner] = u < t.n ? [u, v] : [v, u];
      const [A, B] = sideOf(inner, leaf);
      const me = new Map([[leaf, 1]]);
      l = 0.5 * (avg(me, A) + avg(me, B) - avg(A, B));
    } else {
      const [A, B] = sideOf(u, v);
      const [C, Dd] = sideOf(v, u);
      l = 0.25 * (avg(A, C) + avg(A, Dd) + avg(B, C) + avg(B, Dd)) - 0.5 * (avg(A, B) + avg(C, Dd));
    }
    lengths.set(Math.min(u, v) * M + Math.max(u, v), clampNegative ? Math.max(0, l) : l);
  }
  return lengths;
}

/** Bipartition keys of the internal edges (the side without leaf 0, as a '0'/'1' string). */
export function splitsOf(t: UTree): Set<string> {
  const out = new Set<string>();
  for (const [u, v] of edgesFrom(t, 0)) {
    if (u < t.n || v < t.n) continue;
    out.add(splitKey(t.n, sideLeaves(t, u, v)));
  }
  return out;
}

function splitKey(n: number, side: number[]): string {
  const bits = new Array<string>(n).fill('0');
  for (const i of side) bits[i] = '1';
  if (bits[0] === '1') for (let i = 0; i < n; i++) bits[i] = bits[i] === '1' ? '0' : '1';
  return bits.join('');
}

/**
 * Midpoint-rooted Newick tree. `support` (split key → %) labels internal nodes.
 */
export function toRootedTree(t: UTree, labels: string[], lengths: Map<number, number>, support?: Map<string, number>): TreeNode {
  const M = t.adj.length + 1;
  const len = (a: number, b: number) => lengths.get(Math.min(a, b) * M + Math.max(a, b)) ?? 0;
  // farthest pair of leaves → midpoint
  const far = (from: number) => {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const stack = [from];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of t.adj[u]) {
        if (dist.has(v)) continue;
        dist.set(v, dist.get(u)! + len(u, v));
        prev.set(v, u);
        stack.push(v);
      }
    }
    let best = from;
    for (let i = 0; i < t.n; i++) if ((dist.get(i) ?? -1) > (dist.get(best) ?? -1)) best = i;
    return { best, dist, prev };
  };
  const a = far(0).best;
  const { best: b, dist, prev } = far(a);
  const half = dist.get(b)! / 2;
  // walk from b towards a until the midpoint edge
  let x = b;
  let ru = b;
  let rv = prev.get(b) ?? t.adj[b][0];
  while (prev.has(x)) {
    const p = prev.get(x)!;
    if (dist.get(p)! <= half) { ru = p; rv = x; break; }
    x = p;
  }
  const edgeLen = len(ru, rv);
  const fromU = Math.min(edgeLen, Math.max(0, half - dist.get(ru)!));
  const build = (from: number, v: number, l: number): TreeNode => {
    if (v < t.n) return { name: labels[v], length: l, children: [] };
    const kids = t.adj[v].filter((y) => y !== from).map((y) => build(v, y, len(v, y)));
    const s = support?.get(splitKey(t.n, sideLeaves(t, from, v)));
    return { name: '', length: l, label: s === undefined ? undefined : String(Math.round(s)), children: kids };
  };
  return { name: '', length: null, children: [build(rv, ru, fromU), build(ru, rv, edgeLen - fromU)] };
}

/** Whether a lower-triangular report has a pair that is not computable (null or not finite). */
export function hasUndefinedDistance(lower: (number | null)[][], n: number): boolean {
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const v = lower[i]?.[j]; if (!(typeof v === 'number' && Number.isFinite(v))) return true; }
  return false;
}

/**
 * Full symmetric matrix from a lower-triangular report (null = not computable). A pair that is not
 * computable gets twice the largest finite distance: callers must refuse or warn when
 * hasUndefinedDistance is true (BG-01M6SB24).
 */
export function fullMatrix(lower: (number | null)[][], n: number): Matrix {
  const finite: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const v = lower[i]?.[j]; if (typeof v === 'number' && Number.isFinite(v)) finite.push(v); }
  const fill = finite.length ? Math.max(...finite) * 2 || 1 : 1;
  const D: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const v = lower[i]?.[j];
      D[i][j] = D[j][i] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fill;
    }
  }
  return D;
}

// ───────────────────────────── branch support ─────────────────────────────

export type Resampling = 'none' | 'bootstrap' | 'jackknife' | 'little' | 'interior';

export interface ResamplingOptions {
  resampling: Resampling;
  /** Bootstrap / jackknife / interior-branch test replicates; little bootstraps: per little sample. */
  replicates: number;
  jackknifePct: number;
  /** Little bootstraps (Sharma & Kumar 2021): number of little samples. */
  littleSamples?: number;
  /** Sites drawn (without replacement) into each little sample; 0 = L^0.7. */
  littleSize?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface SupportResult {
  /** split key → % (bootstrap-type support, or interior-branch confidence probability). */
  support: Map<string, number>;
  replicatesDone: number;
  /** Human-readable description of the support values. */
  label: string;
  warning?: string;
}

/** Below this many sites per little sample, little-bootstrap support is noticeably low. */
export const LITTLE_MIN_SITES = 1000;

export const littleSampleSize = (L: number, requested = 0) => Math.max(4, Math.min(L, requested || Math.round(Math.pow(L, 0.7))));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function shuffled(L: number, rand: () => number): number[] {
  const idx = Array.from({ length: L }, (_, i) => i);
  for (let i = L - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

/** Column weights: bootstrap (multinomial over `pool`, `draws` draws) or jackknife (keep pct %). */
function columnWeights(L: number, mode: 'bootstrap' | 'jackknife', pct: number, rand: () => number, pool?: number[], draws = L): number[] {
  const w = new Array<number>(L).fill(0);
  if (mode === 'bootstrap') {
    const from = pool ?? null;
    for (let i = 0; i < draws; i++) w[from ? from[Math.floor(rand() * from.length)] : Math.floor(rand() * L)]++;
  } else for (const i of shuffled(L, rand).slice(0, Math.max(1, Math.round((L * pct) / 100)))) w[i] = 1;
  return w;
}

/** The alignment with every column repeated by its weight. */
export function weightedColumns(seqs: string[], w: number[]): string[] {
  const cols: number[] = [];
  w.forEach((k, c) => { for (let i = 0; i < k; i++) cols.push(c); });
  return seqs.map((s) => cols.map((c) => s[c] ?? '-').join(''));
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Support for the internal branches of `target` from trees rebuilt on resampled columns
 * (bootstrap, jackknife, little bootstraps). `replicateTree` receives the column weights
 * and the alignment with columns repeated by weight.
 */
export async function resampledSupport(
  target: UTree,
  seqs: string[],
  replicateTree: (w: number[], resampled: string[]) => UTree,
  o: ResamplingOptions,
  rand: () => number,
): Promise<SupportResult> {
  const L = Math.max(...seqs.map((s) => s.length));
  const keys = [...splitsOf(target)];
  const tally = (counts: Map<string, number>, t: UTree) => { for (const k of splitsOf(t)) if (counts.has(k)) counts.set(k, counts.get(k)! + 1); };
  const fresh = () => new Map(keys.map((k) => [k, 0]));
  let done = 0;
  const step = async (total: number) => {
    done++;
    o.onProgress?.(done, total);
    if (o.signal?.aborted) throw new Error('Cancelled.');
    if (done % 5 === 0) await tick();
  };
  if (o.resampling === 'little') {
    const samples = Math.max(1, o.littleSamples ?? 10);
    const size = littleSampleSize(L, o.littleSize);
    const reps = Math.max(1, o.replicates);
    const sum = fresh();
    for (let s = 0; s < samples; s++) {
      const pool = shuffled(L, rand).slice(0, size);
      const counts = fresh();
      for (let r = 0; r < reps; r++) {
        const w = columnWeights(L, 'bootstrap', 0, rand, pool, L);
        tally(counts, replicateTree(w, weightedColumns(seqs, w)));
        await step(samples * reps);
      }
      for (const k of keys) sum.set(k, sum.get(k)! + (100 * counts.get(k)!) / reps);
    }
    return {
      support: new Map(keys.map((k) => [k, sum.get(k)! / samples])),
      replicatesDone: done,
      label: `little bootstraps: ${samples} little samples of ${size.toLocaleString()} sites × ${reps} replicates, averaged (%)`,
      warning: size < LITTLE_MIN_SITES
        ? `Little samples of ${size.toLocaleString()} sites are small: support is underestimated on short alignments. Little bootstraps are meant for long (genome-scale) alignments; the standard bootstrap is more reliable here.`
        : undefined,
    };
  }
  const mode = o.resampling === 'jackknife' ? 'jackknife' : 'bootstrap';
  const counts = fresh();
  for (let r = 0; r < o.replicates; r++) {
    const w = columnWeights(L, mode, o.jackknifePct, rand);
    tally(counts, replicateTree(w, weightedColumns(seqs, w)));
    await step(o.replicates);
  }
  return {
    support: new Map(keys.map((k) => [k, (100 * counts.get(k)!) / Math.max(1, done)])),
    replicatesDone: done,
    label: `${mode === 'jackknife' ? `jackknife (${o.jackknifePct}% of columns kept)` : 'bootstrap'}, ${done} replicates (%)`,
  };
}

/**
 * Interior-branch test (Rzhetsky & Nei 1992): each interior branch length of the fixed
 * topology is re-estimated on bootstrap resamples; CP = Φ(b / SE) is the confidence that
 * the branch is longer than zero.
 */
export async function interiorBranchTest(target: UTree, seqs: string[], distances: (s: string[]) => Matrix, o: ResamplingOptions, rand: () => number): Promise<SupportResult & { lengths: Map<string, number>; se: Map<string, number> }> {
  const L = Math.max(...seqs.map((s) => s.length));
  const M = target.adj.length + 1;
  const edges: { key: string; ek: number }[] = [];
  for (const [u, v] of edgesFrom(target, 0)) {
    if (u < target.n || v < target.n) continue;
    edges.push({ key: splitKey(target.n, sideLeaves(target, u, v)), ek: Math.min(u, v) * M + Math.max(u, v) });
  }
  const raw = (D: Matrix) => balancedBranchLengths(target, D, false);
  const b0 = raw(distances(seqs));
  const sums = edges.map(() => 0);
  const sq = edges.map(() => 0);
  let done = 0;
  for (let r = 0; r < o.replicates; r++) {
    const w = columnWeights(L, 'bootstrap', 0, rand);
    const lens = raw(distances(weightedColumns(seqs, w)));
    edges.forEach((e, i) => { const b = lens.get(e.ek) ?? 0; sums[i] += b; sq[i] += b * b; });
    done++;
    o.onProgress?.(done, o.replicates);
    if (o.signal?.aborted) throw new Error('Cancelled.');
    if (done % 5 === 0) await tick();
  }
  const support = new Map<string, number>();
  const lengths = new Map<string, number>();
  const se = new Map<string, number>();
  edges.forEach((e, i) => {
    const mean = sums[i] / done;
    const sd = Math.sqrt(Math.max(0, sq[i] / done - mean * mean) * (done / Math.max(1, done - 1)));
    const b = b0.get(e.ek) ?? 0;
    lengths.set(e.key, b);
    se.set(e.key, sd);
    support.set(e.key, sd > 0 ? 100 * normalCdf(b / sd) : b > 0 ? 100 : 50);
  });
  return { support, lengths, se, replicatesDone: done, label: `interior-branch test, ${done} bootstrap replicates (confidence probability %)` };
}

/** Writes support values onto the internal nodes of a rooted tree (matched by clade). */
export function labelRootedSupport(root: TreeNode, indexOf: (name: string) => number, n: number, support: Map<string, number>): TreeNode {
  const walk = (node: TreeNode, isRoot: boolean): { node: TreeNode; leaves: number[] } => {
    if (!node.children.length) return { node, leaves: [indexOf(node.name)] };
    const kids = node.children.map((c) => walk(c, false));
    const leaves = kids.flatMap((k) => k.leaves);
    const s = isRoot || leaves.length < 2 || leaves.length > n - 2 ? undefined : support.get(splitKey(n, leaves));
    return { node: { ...node, children: kids.map((k) => k.node), label: s === undefined ? undefined : String(Math.round(s)) }, leaves };
  };
  return walk(root, true).node;
}

// ───────────────────────────── full search ─────────────────────────────

export type SearchMethod = 'ME' | 'MP' | 'NJ';

export interface TreeSearchOptions extends ResamplingOptions {
  method: SearchMethod;
  labels: string[];
  seqs: string[];
  protein: boolean;
  /** Distance matrix for any (resampled) alignment, under the chosen model. */
  distances: (seqs: string[]) => Matrix;
  /** MP: random-addition starting trees in addition to the NJ tree. */
  randomAdditions: number;
  seed?: number;
}

export interface TreeSearchResult {
  tree: TreeNode;
  unrooted: UTree;
  /** MP: Fitch steps; ME: balanced tree length; NJ: balanced length of the NJ tree. */
  score: number;
  /** MP: number of distinct starting trees that reached the best length. */
  bestHits: number;
  startingTrees: number;
  moves: number;
  examined: number;
  supportResult?: SupportResult;
}

function bestMpTree(seqs: string[], D: Matrix, protein: boolean, rand: () => number, additions: number, siteWeights?: number[]) {
  const data = parsimonyData(seqs, protein, siteWeights);
  const starts = [neighborJoining(D)];
  for (let i = 0; i < additions; i++) starts.push(stepwiseAddition(seqs.length, data, rand));
  let best: ReturnType<typeof sprSearch> | null = null;
  let hits = 0;
  let moves = 0;
  let examined = 0;
  for (const s of starts) {
    const r = sprSearch(s, data);
    moves += r.moves;
    examined += r.examined;
    if (!best || r.length < best.length - 1e-9) { best = r; hits = 1; }
    else if (Math.abs(r.length - best.length) <= 1e-9) hits++;
  }
  return { ...best!, hits, starts: starts.length, moves, examined };
}

/** Support for any target tree, rebuilding replicate trees with `method`. */
export async function supportFor(target: UTree, o: TreeSearchOptions, rand: () => number): Promise<SupportResult | undefined> {
  if (o.resampling === 'none' || o.replicates <= 0) return undefined;
  if (o.resampling === 'interior') {
    if (o.method === 'MP') throw new Error('The interior-branch test needs a distance method (Neighbor-Joining or Minimum Evolution).');
    return interiorBranchTest(target, o.seqs, o.distances, o, rand);
  }
  const rebuild = (w: number[], rs: string[]): UTree => {
    if (o.method === 'MP') return bestMpTree(o.seqs, o.distances(rs), o.protein, rand, 1, w).tree;
    const Dr = o.distances(rs);
    return o.method === 'ME' ? nniSearch(neighborJoining(Dr), Dr).tree : neighborJoining(Dr);
  };
  return resampledSupport(target, o.seqs, rebuild, o, rand);
}

export async function searchTree(o: TreeSearchOptions): Promise<TreeSearchResult> {
  const n = o.seqs.length;
  if (n < 3) throw new Error('Tree search needs at least 3 sequences.');
  const rand = rng(o.seed ?? 20260101);
  const D = o.distances(o.seqs);
  let tree: UTree;
  let score: number;
  let bestHits = 1;
  let startingTrees = 1;
  let moves = 0;
  let examined = 0;
  if (o.method === 'MP') {
    const r = bestMpTree(o.seqs, D, o.protein, rand, o.randomAdditions);
    ({ tree, length: score, moves, examined } = r);
    bestHits = r.hits;
    startingTrees = r.starts;
  } else if (o.method === 'ME') {
    ({ tree, length: score, moves, examined } = nniSearch(neighborJoining(D), D));
  } else {
    tree = neighborJoining(D);
    score = balancedLength(tree, D);
  }
  const supportResult = await supportFor(tree, o, rand);
  const lengths = balancedBranchLengths(tree, D);
  return {
    tree: toRootedTree(tree, o.labels, lengths, supportResult?.support),
    unrooted: tree,
    score, bestHits, startingTrees, moves, examined, supportResult,
  };
}

/** Clade key by tip names: the side of the split without the alphabetically first tip. */
export function namedSplitKey(side: string[], all: string[]): string {
  const set = new Set(side);
  const ref = [...all].sort()[0];
  const pick = set.has(ref) ? all.filter((x) => !set.has(x)) : side;
  return [...pick].sort().join('\u0001');
}

/** Balanced least-squares length of every edge of `t`, keyed by `namedSplitKey`. */
export function splitLengths(t: UTree, D: Matrix, labels: string[]): Map<string, number> {
  const lens = balancedBranchLengths(t, D);
  const M = t.adj.length + 1;
  const out = new Map<string, number>();
  for (const [u, v] of edgesFrom(t, 0)) {
    const side = sideLeaves(t, u, v).map((i) => labels[i]);
    out.set(namedSplitKey(side, labels), lens.get(Math.min(u, v) * M + Math.max(u, v)) ?? 0);
  }
  return out;
}
