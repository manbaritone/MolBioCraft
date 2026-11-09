// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Tree Explorer layout and edits: rectangular phylogram / cladogram,
 * circular and radial (equal-angle) layouts, compressed subtrees, and the node operations
 * flip, ladderize, root on branch and rename. Nodes are addressed by path ("0.1.0" = second
 * child's first child of the root's first child; "" = root), which stays valid for display
 * state until the topology changes.
 */

import { rerootOnBranch, type TreeNode } from './treeConsensus';

export type TreeStyle = 'rectangular' | 'cladogram' | 'circular' | 'radial';

export interface LaidNode {
  path: string;
  x: number;
  y: number;
  isTip: boolean;
  /** Tip name, or the compressed-subtree caption. */
  label: string;
  support: number | null;
  length: number | null;
  /** Distance from the root along branches (phylogram units). */
  depth: number;
  tips: number;
  compressed: boolean;
  /** Label angle in degrees (circular / radial), 0 = to the right. */
  angle: number;
  /** For compressed subtrees: the triangle. */
  triangle?: string;
}

export interface LaidBranch {
  /** Path of the child node at the end of the branch. */
  path: string;
  d: string;
  /** Midpoint, for branch-length labels. */
  mx: number;
  my: number;
  length: number | null;
}

export interface TreeLayout {
  nodes: LaidNode[];
  branches: LaidBranch[];
  width: number;
  height: number;
  /** Pixels per unit of branch length (0 for the cladogram). */
  scale: number;
  maxDepth: number;
  /** x of the root (rectangular) or centre (circular / radial). */
  originX: number;
  originY: number;
}

export interface LayoutOptions {
  style: TreeStyle;
  /** Paths of compressed subtrees. */
  compressed: Set<string>;
  width: number;
  rowHeight: number;
  /** Space reserved for tip labels. */
  labelWidth: number;
}

export const childPath = (path: string, i: number) => (path ? `${path}.${i}` : String(i));

export function nodeAt(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  let n: TreeNode | undefined = root;
  for (const k of path.split('.')) {
    n = n?.children[Number(k)];
    if (!n) return null;
  }
  return n;
}

export function tipNames(n: TreeNode): string[] {
  return n.children.length ? n.children.flatMap(tipNames) : [n.name];
}

/** Immutable update of the node at `path`. */
export function updateAt(root: TreeNode, path: string, fn: (n: TreeNode) => TreeNode): TreeNode {
  if (!path) return fn(root);
  const [head, ...rest] = path.split('.');
  const i = Number(head);
  return { ...root, children: root.children.map((c, j) => (j === i ? updateAt(c, rest.join('.'), fn) : c)) };
}

export const flipAt = (root: TreeNode, path: string) => updateAt(root, path, (n) => ({ ...n, children: [...n.children].reverse() }));

export const renameAt = (root: TreeNode, path: string, name: string) => updateAt(root, path, (n) => ({ ...n, name }));

/** Orders every node's children by size (smallest first when `ascending`). */
export function ladderize(root: TreeNode, ascending = true): TreeNode {
  const size = (n: TreeNode): number => (n.children.length ? n.children.reduce((s, c) => s + size(c), 0) : 1);
  const walk = (n: TreeNode): TreeNode => ({
    ...n,
    children: n.children.map(walk).sort((a, b) => (ascending ? size(a) - size(b) : size(b) - size(a))),
  });
  return walk(root);
}

export function rootOnPath(root: TreeNode, path: string): TreeNode {
  const target = nodeAt(root, path);
  if (!target || !path) return root;
  return rerootOnBranch(root, (n) => n === target);
}

/** Midpoint root: the middle of the longest tip-to-tip path. */
export function midpointRoot(root: TreeNode): TreeNode {
  type P = { node: TreeNode; parent: P | null; d: number };
  const all: P[] = [];
  const walk = (n: TreeNode, parent: P | null, d: number) => {
    const p: P = { node: n, parent, d };
    all.push(p);
    n.children.forEach((c) => walk(c, p, d + Math.max(0, c.length ?? 0)));
  };
  walk(root, null, 0);
  const tips = all.filter((p) => !p.node.children.length);
  let best = { a: tips[0], b: tips[0], len: -1 };
  const ancestors = (p: P) => { const out: P[] = []; for (let q: P | null = p; q; q = q.parent) out.push(q); return out; };
  for (let i = 0; i < tips.length; i++) {
    const ai = ancestors(tips[i]);
    const set = new Set(ai);
    for (let j = i + 1; j < tips.length; j++) {
      let lca: P | null = tips[j];
      while (lca && !set.has(lca)) lca = lca.parent;
      const len = tips[i].d + tips[j].d - 2 * (lca?.d ?? 0);
      if (len > best.len) best = { a: tips[i], b: tips[j], len };
    }
  }
  if (best.len <= 0) return root;
  const far = best.a.d >= best.b.d ? best.a : best.b;
  // walk up from the farther tip until half the path length is covered
  let q: P = far;
  let covered = 0;
  while (q.parent && covered + (q.node.length ?? 0) < best.len / 2) { covered += Math.max(0, q.node.length ?? 0); q = q.parent; }
  const target = q.node;
  const rooted = rerootOnBranch(root, (n) => n === target);
  // shift the root along the branch so both sides are best.len / 2 from it
  const [side, rest] = rooted.children;
  const total = (side.length ?? 0) + (rest.length ?? 0);
  const fromSide = best.len / 2 - covered;
  if (fromSide < 0 || fromSide > total) return rooted;
  return { ...rooted, children: [{ ...side, length: fromSide }, { ...rest, length: total - fromSide }] };
}

// ───────────────────────────── layout ─────────────────────────────

export function layoutTree(root: TreeNode, o: LayoutOptions): TreeLayout {
  const useLengths = o.style !== 'cladogram' && hasLengths(root);
  // depth (phylogram) / height (cladogram), tip order
  interface W { node: TreeNode; path: string; depth: number; height: number; tipIndex: number; tips: number; compressed: boolean; children: W[]; maxDepthBelow: number }
  let tipCounter = 0;
  const build = (n: TreeNode, path: string, depth: number): W => {
    const compressed = o.compressed.has(path) && n.children.length > 0;
    const kids = compressed ? [] : n.children.map((c, i) => build(c, childPath(path, i), depth + (useLengths ? Math.max(0, c.length ?? 0) : 1)));
    const w: W = {
      node: n, path, depth,
      height: kids.length ? Math.max(...kids.map((k) => k.height)) + 1 : 0,
      tipIndex: kids.length ? -1 : tipCounter++,
      tips: compressed ? tipNames(n).length : kids.length ? kids.reduce((s, k) => s + k.tips, 0) : 1,
      compressed, children: kids,
      maxDepthBelow: depth,
    };
    if (compressed) {
      const deepest = (m: TreeNode, d: number): number => (m.children.length ? Math.max(...m.children.map((c) => deepest(c, d + (useLengths ? Math.max(0, c.length ?? 0) : 1)))) : d);
      w.maxDepthBelow = deepest(n, depth);
      w.height = useLengths ? 0 : Math.max(1, Math.round(w.maxDepthBelow - depth));
    } else if (kids.length) w.maxDepthBelow = Math.max(...kids.map((k) => k.maxDepthBelow));
    return w;
  };
  const top = build(root, '', 0);
  const nTips = Math.max(1, tipCounter);
  const maxDepth = useLengths ? top.maxDepthBelow : top.height;
  const nodes: LaidNode[] = [];
  const branches: LaidBranch[] = [];
  const supportOf = (n: TreeNode) => {
    const v = Number(n.label);
    return n.children.length && n.label !== undefined && n.label !== '' && Number.isFinite(v) ? v : null;
  };
  const caption = (w: W) => (w.compressed ? `${w.node.name || tipNames(w.node)[0]} … (${w.tips} taxa)` : w.node.name);

  if (o.style === 'rectangular' || o.style === 'cladogram') {
    const margin = 16;
    const plotW = Math.max(120, o.width - o.labelWidth - 2 * margin);
    const scale = maxDepth > 0 ? plotW / maxDepth : 0;
    const xOf = (w: W) => margin + (useLengths ? w.depth : maxDepth - w.height) * scale;
    const height = nTips * o.rowHeight + 2 * margin;
    const yOf = new Map<W, number>();
    const placeAll = (w: W): number => {
      if (!w.children.length) { const y = margin + (w.tipIndex + 0.5) * o.rowHeight; yOf.set(w, y); return y; }
      const ys = w.children.map(placeAll);
      const y = (ys[0] + ys[ys.length - 1]) / 2;
      yOf.set(w, y);
      return y;
    };
    placeAll(top);
    const emit = (w: W, parent: W | null) => {
      const x = xOf(w);
      const y = yOf.get(w)!;
      let triangle: string | undefined;
      if (w.compressed) {
        const x2 = margin + (useLengths ? w.maxDepthBelow : maxDepth) * scale;
        const h = o.rowHeight * 0.42;
        triangle = `M${x},${y} L${Math.max(x + 8, x2)},${y - h} L${Math.max(x + 8, x2)},${y + h} Z`;
      }
      nodes.push({ path: w.path, x, y, isTip: !w.children.length, label: caption(w), support: supportOf(w.node), length: w.node.length, depth: w.depth, tips: w.tips, compressed: w.compressed, angle: 0, triangle });
      if (parent) {
        const px = xOf(parent);
        branches.push({ path: w.path, d: `M${px},${y} H${x}`, mx: (px + x) / 2, my: y, length: w.node.length });
      }
      if (w.children.length > 1) {
        const ys = w.children.map((c) => yOf.get(c)!);
        branches.push({ path: `${w.path}#v`, d: `M${x},${Math.min(...ys)} V${Math.max(...ys)}`, mx: x, my: y, length: null });
      }
      w.children.forEach((c) => emit(c, w));
    };
    emit(top, null);
    return { nodes, branches, width: o.width, height, scale: useLengths ? scale : 0, maxDepth, originX: margin, originY: margin };
  }

  if (o.style === 'circular') {
    const size = Math.max(320, Math.min(o.width, 1400));
    const R = size / 2 - o.labelWidth;
    const cx = size / 2;
    const cy = size / 2;
    const scale = maxDepth > 0 ? Math.max(40, R) / maxDepth : 0;
    const angleOf = new Map<W, number>();
    const placeAll = (w: W): number => {
      if (!w.children.length) { const a = ((w.tipIndex + 0.5) / nTips) * 2 * Math.PI; angleOf.set(w, a); return a; }
      const as = w.children.map(placeAll);
      const a = (as[0] + as[as.length - 1]) / 2;
      angleOf.set(w, a);
      return a;
    };
    placeAll(top);
    const rOf = (w: W) => (useLengths ? w.depth : maxDepth - w.height) * scale;
    const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const emit = (w: W, parent: W | null) => {
      const a = angleOf.get(w)!;
      const r = rOf(w);
      const [x, y] = pt(r, a);
      let triangle: string | undefined;
      if (w.compressed) {
        const r2 = Math.max(r + 8, (useLengths ? w.maxDepthBelow : maxDepth) * scale);
        const da = Math.PI / nTips * 0.8;
        const [x1, y1] = pt(r2, a - da);
        const [x2, y2] = pt(r2, a + da);
        triangle = `M${x},${y} L${x1},${y1} L${x2},${y2} Z`;
      }
      nodes.push({ path: w.path, x, y, isTip: !w.children.length, label: caption(w), support: supportOf(w.node), length: w.node.length, depth: w.depth, tips: w.tips, compressed: w.compressed, angle: (a * 180) / Math.PI, triangle });
      if (parent) {
        const [px, py] = pt(rOf(parent), a);
        branches.push({ path: w.path, d: `M${px},${py} L${x},${y}`, mx: (px + x) / 2, my: (py + y) / 2, length: w.node.length });
      }
      if (w.children.length > 1) {
        const as = w.children.map((c) => angleOf.get(c)!);
        const a0 = Math.min(...as);
        const a1 = Math.max(...as);
        const [x0, y0] = pt(r, a0);
        const [x1, y1] = pt(r, a1);
        branches.push({ path: `${w.path}#v`, d: `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`, mx: x, my: y, length: null });
      }
      w.children.forEach((c) => emit(c, w));
    };
    emit(top, null);
    return { nodes, branches, width: size, height: size, scale: useLengths ? scale : 0, maxDepth, originX: cx, originY: cy };
  }

  // radial: equal-angle (Felsenstein's unrooted layout)
  const lengthOf = (w: W) => (useLengths ? Math.max(0, w.node.length ?? 0) : 1);
  const pos = new Map<W, [number, number]>();
  const wedge = (w: W, x: number, y: number, a0: number, a1: number) => {
    pos.set(w, [x, y]);
    let a = a0;
    for (const c of w.children) {
      const span = ((a1 - a0) * c.tips) / w.tips;
      const mid = a + span / 2;
      const l = lengthOf(c);
      wedge(c, x + l * Math.cos(mid), y + l * Math.sin(mid), a, a + span);
      a += span;
    }
  };
  wedge(top, 0, 0, 0, 2 * Math.PI);
  const xs = [...pos.values()].map((p) => p[0]);
  const ys = [...pos.values()].map((p) => p[1]);
  const spanX = Math.max(1e-9, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
  const size = Math.max(320, Math.min(o.width, 1400));
  const scale = (size - 2 * o.labelWidth) / Math.max(spanX, spanY);
  const ox = o.labelWidth - Math.min(...xs) * scale + ((Math.max(spanX, spanY) - spanX) * scale) / 2;
  const oy = o.labelWidth - Math.min(...ys) * scale + ((Math.max(spanX, spanY) - spanY) * scale) / 2;
  const P = (w: W) => { const [x, y] = pos.get(w)!; return [ox + x * scale, oy + y * scale]; };
  const emit = (w: W, parent: W | null) => {
    const [x, y] = P(w);
    let angle = 0;
    if (parent) {
      const [px, py] = P(parent);
      angle = (Math.atan2(y - py, x - px) * 180) / Math.PI;
      branches.push({ path: w.path, d: `M${px},${py} L${x},${y}`, mx: (px + x) / 2, my: (py + y) / 2, length: w.node.length });
    }
    let triangle: string | undefined;
    if (w.compressed) {
      const a = (angle * Math.PI) / 180;
      const l = 24;
      triangle = `M${x},${y} L${x + l * Math.cos(a - 0.35)},${y + l * Math.sin(a - 0.35)} L${x + l * Math.cos(a + 0.35)},${y + l * Math.sin(a + 0.35)} Z`;
    }
    nodes.push({ path: w.path, x, y, isTip: !w.children.length, label: caption(w), support: supportOf(w.node), length: w.node.length, depth: w.depth, tips: w.tips, compressed: w.compressed, angle, triangle });
    w.children.forEach((c) => emit(c, w));
  };
  emit(top, null);
  return { nodes, branches, width: size, height: size, scale: useLengths ? scale : 0, maxDepth, originX: ox, originY: oy };
}

export function hasLengths(root: TreeNode): boolean {
  let any = false;
  const walk = (n: TreeNode) => { if ((n.length ?? 0) > 0) any = true; n.children.forEach(walk); };
  walk(root);
  return any;
}

/** A "nice" scale-bar length (1, 2 or 5 × 10^k) close to `target`. */
export function niceLength(target: number): number {
  if (!(target > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}
