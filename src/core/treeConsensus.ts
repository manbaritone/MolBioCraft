// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Newick utilities for the Phylogenetics chapter: parse/write, outgroup rooting, and the
 * majority-rule consensus of a set of trees with the same taxa (support = % of trees
 * containing each clade).
 */

export interface TreeNode {
  name: string;
  length: number | null;
  /** Internal-node label (support value) as written in the Newick string. */
  label?: string;
  children: TreeNode[];
}

export function parseNewick(text: string): TreeNode {
  const s = text.replace(/\[[^\]]*\]/g, '').trim().replace(/;\s*$/, '');
  let i = 0;
  const readName = () => {
    if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      const n = s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
      return n;
    }
    const start = i;
    while (i < s.length && !'(),:;'.includes(s[i])) i++;
    return s.slice(start, i).trim();
  };
  const readLength = () => {
    if (s[i] !== ':') return null;
    i++;
    const start = i;
    while (i < s.length && !'(),;'.includes(s[i])) i++;
    const v = Number(s.slice(start, i).trim());
    return Number.isFinite(v) ? v : null;
  };
  const node = (): TreeNode => {
    if (s[i] === '(') {
      i++;
      const children: TreeNode[] = [node()];
      while (s[i] === ',') {
        i++;
        children.push(node());
      }
      if (s[i] !== ')') throw new Error(`Malformed Newick near position ${i + 1}.`);
      i++;
      const label = readName();
      return { name: '', label: label || undefined, length: readLength(), children };
    }
    const name = readName();
    return { name, length: readLength(), children: [] };
  };
  const root = node();
  if (i < s.length && s.slice(i).trim()) throw new Error(`Unexpected text after the tree: "${s.slice(i, i + 20)}".`);
  return root;
}

const fmtLen = (v: number) => {
  const t = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};
const quote = (n: string) => (/[\s(),:;'[\]]/.test(n) ? `'${n.replace(/'/g, "''")}'` : n);

export function toNewick(n: TreeNode): string {
  const own = (x: TreeNode): string =>
    (x.children.length ? `(${x.children.map(own).join(',')})${x.label ?? ''}` : quote(x.name)) +
    (x.length !== null ? `:${fmtLen(x.length)}` : '');
  return `${own(n)};`;
}

export function leafNames(n: TreeNode): string[] {
  return n.children.length ? n.children.flatMap(leafNames) : [n.name];
}

/**
 * Reroots the tree on the branch leading to `outgroup`, placing the root halfway along
 * that branch. Branch support labels stay with their branches (a label written on a node
 * describes the branch above it, so it moves when that branch's direction flips).
 */
export function rerootAtOutgroup(tree: TreeNode, outgroup: string): TreeNode {
  return rerootOnBranch(tree, (n) => !n.children.length && n.name === outgroup, `Outgroup "${outgroup}" is not a tip of this tree.`);
}

/**
 * Reroots the tree on the middle of the branch above the first node matching `isTarget`
 * (a tip or an internal node). Support labels stay with their branches.
 */
export function rerootOnBranch(tree: TreeNode, isTarget: (n: TreeNode) => boolean, notFound = 'Node not found in this tree.'): TreeNode {
  type Edge = { to: number; len: number; label?: string };
  const nodes: TreeNode[] = [];
  const adj: Edge[][] = [];
  const add = (n: TreeNode, parent: number | null): number => {
    const id = nodes.push(n) - 1;
    adj[id] = [];
    if (parent !== null) {
      adj[id].push({ to: parent, len: n.length ?? 0, label: n.label });
      adj[parent].push({ to: id, len: n.length ?? 0, label: n.label });
    }
    n.children.forEach((c) => add(c, id));
    return id;
  };
  add(tree, null);
  const targetId = nodes.findIndex(isTarget);
  if (targetId < 0) throw new Error(notFound);
  if (targetId === 0) return tree;
  // the edge towards the original root is the first one recorded for every non-root node
  const up = adj[targetId][0];
  const build = (id: number, from: number, len: number, label?: string): TreeNode => {
    const n = nodes[id];
    const kids = adj[id].filter((e) => e.to !== from).map((e) => build(e.to, id, e.len, e.label));
    return kids.length
      ? { name: n.name, label, length: len, children: kids }
      : { name: n.name, length: len, children: [] };
  };
  const side = build(targetId, up.to, up.len / 2, up.label);
  const rest = build(up.to, targetId, up.len / 2, up.label);
  return collapseUnary({ name: '', length: null, children: [side, rest] });
}

/** Removes internal nodes with a single child, adding their branch lengths together. */
function collapseUnary(n: TreeNode): TreeNode {
  const kids = n.children.map(collapseUnary);
  if (kids.length === 1 && n.length !== null) {
    const only = kids[0];
    return { ...only, length: (only.length ?? 0) + (n.length ?? 0), label: only.label ?? n.label };
  }
  return { ...n, children: kids };
}

// ───────────────────────────── consensus ─────────────────────────────

/** Non-trivial bipartitions, keyed by the sorted taxa of one side (see below). */
function bipartitions(tree: TreeNode, taxa: string[]): Map<string, number> {
  const ref = taxa[0];
  const all = new Set(taxa);
  const out = new Map<string, number>();
  const walk = (n: TreeNode): string[] => {
    if (!n.children.length) return [n.name];
    const under = n.children.flatMap(walk);
    if (under.length > 1 && under.length < taxa.length - 1) {
      // Record each split by its smaller side (ties: the side without `ref`). For compatible
      // splits these sides are always nested or disjoint, so the consensus can be built.
      const other = taxa.filter((t) => !under.includes(t));
      const side = under.length < other.length ? under
        : other.length < under.length ? other
        : under.includes(ref) ? other : under;
      if (side.length > 1 && side.length < taxa.length - 1 && side.every((t) => all.has(t))) {
        out.set([...side].sort().join('\u0001'), n.length ?? 0);
      }
    }
    return under;
  };
  walk(tree);
  return out;
}

export interface ConsensusResult {
  newick: string;
  /** Trees used after burn-in. */
  used: number;
  clades: { taxa: string[]; supportPct: number }[];
}

/**
 * Majority-rule (or stricter) consensus. Clades in at least `thresholdPct` of the trees
 * are kept (thresholds ≥ 50% always give a compatible set). Branch lengths are the mean
 * length of the clade across the trees that contain it; support labels are percentages.
 */
export function consensusTree(newicks: string[], thresholdPct: number, burninPct = 0): ConsensusResult {
  if (thresholdPct < 50 || thresholdPct > 100) throw new Error('The support threshold must be between 50% and 100%.');
  const skip = Math.floor((newicks.length * burninPct) / 100);
  const trees = newicks.slice(skip).map(parseNewick);
  if (trees.length < 2) throw new Error('A consensus needs at least two trees after burn-in.');
  const taxa = [...new Set(leafNames(trees[0]))].sort();
  for (const [i, t] of trees.entries()) {
    const names = [...new Set(leafNames(t))].sort();
    if (names.join('\u0001') !== taxa.join('\u0001')) throw new Error(`Tree ${i + skip + 1} has different tips from the first tree; consensus needs the same taxa in every tree.`);
  }
  const counts = new Map<string, { n: number; len: number }>();
  for (const t of trees) {
    for (const [k, len] of bipartitions(t, taxa)) {
      const c = counts.get(k) ?? { n: 0, len: 0 };
      c.n += 1;
      c.len += len;
      counts.set(k, c);
    }
  }
  const kept = [...counts.entries()]
    .map(([k, c]) => ({ taxa: k.split('\u0001'), supportPct: Math.round((1000 * c.n) / trees.length) / 10, len: c.len / c.n }))
    .filter((c) => (thresholdPct === 100 ? c.supportPct >= 100 : c.supportPct >= thresholdPct && c.supportPct > 50))
    .sort((a, b) => b.taxa.length - a.taxa.length);
  // Mean terminal branch lengths.
  const tipLen = new Map<string, number>();
  for (const t of trees) {
    const walk = (n: TreeNode) => {
      if (!n.children.length) tipLen.set(n.name, (tipLen.get(n.name) ?? 0) + (n.length ?? 0) / trees.length);
      n.children.forEach(walk);
    };
    walk(t);
  }
  // Build: start from a star tree, nest each clade (largest first) under its smallest container.
  type Build = { taxa: Set<string>; node: TreeNode };
  const root: Build = { taxa: new Set(taxa), node: { name: '', length: null, children: taxa.map((t) => ({ name: t, length: tipLen.get(t) ?? null, children: [] })) } };
  const built: Build[] = [root];
  for (const c of kept) {
    const set = new Set(c.taxa);
    const parent = built.filter((b) => c.taxa.every((t) => b.taxa.has(t))).sort((a, b) => a.taxa.size - b.taxa.size)[0];
    const moved = parent.node.children.filter((ch) => leafNames(ch).every((t) => set.has(t)));
    parent.node.children = parent.node.children.filter((ch) => !moved.includes(ch));
    const node: TreeNode = { name: '', label: String(Math.round(c.supportPct)), length: Math.round(c.len * 1e6) / 1e6, children: moved };
    parent.node.children.push(node);
    built.push({ taxa: set, node });
  }
  return { newick: toNewick(root.node), used: trees.length, clades: kept.map(({ taxa: t, supportPct }) => ({ taxa: t, supportPct })) };
}

// ───────────────────────────── condensed trees ─────────────────────────────

/**
 * Collapses every interior branch whose numeric support label is below `cutoffPct`,
 * giving a multifurcating tree. Labels on 0–1 scales are read as fractions. Branch
 * lengths of collapsed branches are added to their children so tip depths are kept.
 */
export function condenseTree(tree: TreeNode, cutoffPct: number): { tree: TreeNode; collapsed: number } {
  let collapsed = 0;
  const labels: number[] = [];
  const scan = (n: TreeNode) => { if (n.children.length && n.label && Number.isFinite(Number(n.label))) labels.push(Number(n.label)); n.children.forEach(scan); };
  scan(tree);
  const scale = labels.length && labels.every((x) => x <= 1) ? 100 : 1;
  const walk = (n: TreeNode, isRoot: boolean): TreeNode[] => {
    if (!n.children.length) return [n];
    const kids = n.children.flatMap((c) => walk(c, false));
    const sup = n.label !== undefined && Number.isFinite(Number(n.label)) ? Number(n.label) * scale : null;
    if (!isRoot && sup !== null && sup < cutoffPct) {
      collapsed++;
      return kids.map((k) => ({ ...k, length: k.length !== null || n.length !== null ? (k.length ?? 0) + (n.length ?? 0) : null }));
    }
    return [{ ...n, children: kids }];
  };
  return { tree: walk(tree, true)[0], collapsed };
}

// ───────────────────────────── gene duplication inference ─────────────────────────────

export interface DuplicationResult {
  /** Gene tree with interior labels "D" (duplication) or "S" (speciation). */
  newick: string;
  duplications: { tips: string[]; species: string }[];
  speciations: number;
  unmapped: string[];
}

/**
 * Infers duplication nodes by reconciling a rooted gene tree with a rooted species tree
 * (LCA mapping, Goodman et al. 1979; Page 1994). A gene-tree node is a duplication when
 * it maps to the same species-tree node as one of its children.
 */
export function inferDuplications(gene: TreeNode, species: TreeNode, speciesOf: (tip: string) => string | null): DuplicationResult {
  // Species tree: each node's set of species and depth, for LCA by set inclusion.
  type SNode = { node: TreeNode; set: Set<string>; depth: number };
  const sNodes: SNode[] = [];
  const index = (n: TreeNode, depth: number): Set<string> => {
    const set = n.children.length ? new Set(n.children.flatMap((c) => [...index(c, depth + 1)])) : new Set([n.name]);
    sNodes.push({ node: n, set, depth });
    return set;
  };
  index(species, 0);
  const lca = (sp: Set<string>): SNode | null => {
    let best: SNode | null = null;
    for (const s of sNodes) if ([...sp].every((x) => s.set.has(x)) && (!best || s.depth > best.depth)) best = s;
    return best;
  };
  const unmapped: string[] = [];
  const duplications: { tips: string[]; species: string }[] = [];
  let speciations = 0;
  const walk = (n: TreeNode): { map: SNode | null; tips: string[]; out: TreeNode } => {
    if (!n.children.length) {
      const sp = speciesOf(n.name);
      const m = sp ? lca(new Set([sp])) : null;
      if (!m) unmapped.push(n.name);
      return { map: m, tips: [n.name], out: n };
    }
    const kids = n.children.map(walk);
    const known = kids.filter((k) => k.map);
    const sp = new Set(known.flatMap((k) => [...k.map!.set]));
    const m = sp.size ? lca(sp) : null;
    const isDup = !!m && known.some((k) => k.map === m);
    const tips = kids.flatMap((k) => k.tips);
    if (isDup) duplications.push({ tips, species: [...m!.set].sort().join(', ') });
    else if (m) speciations++;
    return { map: m, tips, out: { ...n, label: m ? (isDup ? 'D' : 'S') : n.label, children: kids.map((k) => k.out) } };
  };
  const res = walk(gene);
  return { newick: toNewick(res.out), duplications, speciations, unmapped };
}

/** Tries every branch as the gene-tree root and keeps the one with the fewest duplications. */
export function rootMinimizingDuplications(gene: TreeNode, species: TreeNode, speciesOf: (tip: string) => string | null): { tree: TreeNode; result: DuplicationResult } {
  let best = { tree: gene, result: inferDuplications(gene, species, speciesOf) };
  for (const tip of leafNames(gene)) {
    const t = rerootAtOutgroup(gene, tip);
    const r = inferDuplications(t, species, speciesOf);
    if (r.duplications.length < best.result.duplications.length) best = { tree: t, result: r };
  }
  return best;
}
