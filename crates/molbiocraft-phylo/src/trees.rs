// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Phylogenetic tree inference (NJ, Minimum-Evolution, UPGMA, Fitch Maximum Parsimony,
//! and Felsenstein Pruning Maximum Likelihood), `petgraph` tree representation, non-parametric
//! Bootstrap column resampling, and User Tree topology evaluation.

use molbiocraft_align::sanitize_newick_label;
use molbiocraft_core::SplitMix64;
use petgraph::graph::{DiGraph, NodeIndex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CladeBootstrapRow {
    pub clade_label: String,
    pub support_pct: u32,
    pub branch_length: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhyloTreeInferenceReport {
    pub algorithm: String,
    pub model: String,
    #[serde(rename = "bootstrapReplicates")]
    pub bootstrap_replicates: usize,
    pub newick: String,
    #[serde(rename = "logLikelihood")]
    pub log_likelihood: f64,
    #[serde(rename = "totalTreeLengthS")]
    pub total_tree_length_s: f64,
    #[serde(rename = "parsimonySteps")]
    pub parsimony_steps: usize,
    #[serde(rename = "consistencyIndexCI")]
    pub consistency_index_ci: f64,
    #[serde(rename = "retentionIndexRI")]
    pub retention_index_ri: f64,
    #[serde(rename = "cladeBootstraps")]
    pub clade_bootstraps: Vec<CladeBootstrapRow>,
    /// What was actually computed: the topology search, distance model, likelihood model,
    /// and how many bootstrap replicates ran (the request may be reduced to keep the UI responsive).
    #[serde(rename = "methodNote", default)]
    pub method_note: String,
    /// The pair of taxa whose distance could not be computed (saturated or no shared sites), if any.
    #[serde(rename = "warnings", default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct PhyloNodeData {
    #[allow(dead_code)]
    label: String,
    taxon_idx: Option<usize>,
    branch_len: f64,
}

type TreeGraph = DiGraph<PhyloNodeData, f64>;

fn leaf_node(graph: &mut TreeGraph, names: &[String], i: usize) -> NodeIndex {
    graph.add_node(PhyloNodeData {
        label: sanitize_newick_label(&names[i]),
        taxon_idx: Some(i),
        branch_len: 0.0,
    })
}

fn join_nodes(graph: &mut TreeGraph, a: NodeIndex, la: f64, b: NodeIndex, lb: f64) -> NodeIndex {
    graph[a].branch_len = la;
    graph[b].branch_len = lb;
    let parent = graph.add_node(PhyloNodeData {
        label: String::new(),
        taxon_idx: None,
        branch_len: 0.0,
    });
    graph.add_edge(parent, a, la);
    graph.add_edge(parent, b, lb);
    parent
}

/// Build a Neighbor-Joining (Saitou & Nei 1987, Studier & Keppler 1988) or UPGMA tree from a
/// complete, finite distance matrix.
///
/// NJ is unrooted; the returned tree is rooted at the midpoint of the last edge joined. Negative
/// NJ branch estimates are set to zero and the difference is given to the sister branch (as in
/// MEGA/PHYLIP); the reduced distance matrix itself is never altered.
fn build_distance_tree_graph(names: &[String], dist_mat: &[Vec<f64>], upgma: bool) -> (TreeGraph, NodeIndex) {
    let n = names.len();
    let mut graph = TreeGraph::new();
    if n == 0 {
        let root = graph.add_node(PhyloNodeData {
            label: "Root".into(),
            taxon_idx: None,
            branch_len: 0.0,
        });
        return (graph, root);
    }
    if n == 1 {
        let leaf = leaf_node(&mut graph, names, 0);
        return (graph, leaf);
    }

    if upgma {
        struct UCluster {
            node: NodeIndex,
            height: f64,
            members: Vec<usize>,
        }
        let mut clusters: Vec<UCluster> = (0..n)
            .map(|i| UCluster {
                node: leaf_node(&mut graph, names, i),
                height: 0.0,
                members: vec![i],
            })
            .collect();
        while clusters.len() > 1 {
            let m = clusters.len();
            let (mut best_i, mut best_j, mut best_d) = (0usize, 1usize, f64::INFINITY);
            for i in 0..m {
                for j in (i + 1)..m {
                    let mut sum = 0.0;
                    for &mi in &clusters[i].members {
                        for &mj in &clusters[j].members {
                            sum += dist_mat[mi][mj];
                        }
                    }
                    let avg = sum / ((clusters[i].members.len() * clusters[j].members.len()) as f64);
                    if avg < best_d {
                        best_d = avg;
                        best_i = i;
                        best_j = j;
                    }
                }
            }
            // Average linkage is monotone, so the new height is never below a child's height;
            // `max(0.0)` only absorbs floating-point rounding.
            let new_h = best_d * 0.5;
            let bi = (new_h - clusters[best_i].height).max(0.0);
            let bj = (new_h - clusters[best_j].height).max(0.0);
            let parent = join_nodes(&mut graph, clusters[best_i].node, bi, clusters[best_j].node, bj);
            let mut members = std::mem::take(&mut clusters[best_i].members);
            members.extend_from_slice(&clusters[best_j].members);
            clusters.remove(best_j);
            clusters[best_i] = UCluster {
                node: parent,
                height: new_h,
                members,
            };
        }
        return (graph, clusters[0].node);
    }

    let mut d = dist_mat.to_vec();
    let mut nodes: Vec<NodeIndex> = (0..n).map(|i| leaf_node(&mut graph, names, i)).collect();
    let mut active: Vec<usize> = (0..n).collect();

    while active.len() > 2 {
        let r = active.len();
        let u: Vec<f64> = active
            .iter()
            .map(|&ii| active.iter().map(|&jj| d[ii][jj]).sum())
            .collect();
        let (mut best_a, mut best_b, mut min_q) = (0usize, 1usize, f64::INFINITY);
        for i in 0..r {
            for j in (i + 1)..r {
                let q = ((r - 2) as f64) * d[active[i]][active[j]] - u[i] - u[j];
                if q < min_q {
                    min_q = q;
                    best_a = i;
                    best_b = j;
                }
            }
        }
        let (ia, ib) = (active[best_a], active[best_b]);
        let dab = d[ia][ib];
        let mut la = 0.5 * dab + (u[best_a] - u[best_b]) / (2.0 * (r - 2) as f64);
        let mut lb = dab - la;
        if la < 0.0 {
            la = 0.0;
            lb = dab.max(0.0);
        } else if lb < 0.0 {
            lb = 0.0;
            la = dab.max(0.0);
        }
        nodes[ia] = join_nodes(&mut graph, nodes[ia], la, nodes[ib], lb);
        for &ik in &active {
            if ik != ia && ik != ib {
                let dnew = 0.5 * (d[ia][ik] + d[ib][ik] - dab);
                d[ia][ik] = dnew;
                d[ik][ia] = dnew;
            }
        }
        active.remove(best_b);
    }

    let (ia, ib) = (active[0], active[1]);
    let br = (d[ia][ib] * 0.5).max(0.0);
    let root = join_nodes(&mut graph, nodes[ia], br, nodes[ib], br);
    graph[root].label = "Root".into();
    (graph, root)
}

/// Re-root a tree at the midpoint of its longest tip-to-tip path (midpoint rooting).
/// The old root is dissolved when it has two children; topology and path lengths are unchanged.
fn midpoint_reroot(g: &TreeGraph, root: NodeIndex) -> (TreeGraph, NodeIndex) {
    let n = g.node_count();
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for v in g.node_indices() {
        for c in g.neighbors(v) {
            adj[v.index()].push((c.index(), g[c].branch_len));
            adj[c.index()].push((v.index(), g[c].branch_len));
        }
    }
    let r = root.index();
    let mut alive = vec![true; n];
    if adj[r].len() == 2 && g[root].taxon_idx.is_none() {
        let (a, ta) = adj[r][0];
        let (b, tb) = adj[r][1];
        adj[a].retain(|&(x, _)| x != r);
        adj[b].retain(|&(x, _)| x != r);
        adj[a].push((b, ta + tb));
        adj[b].push((a, ta + tb));
        adj[r].clear();
        alive[r] = false;
    }
    let leaves: Vec<usize> = g.node_indices().filter(|&v| g[v].taxon_idx.is_some()).map(|v| v.index()).collect();
    if leaves.len() < 3 {
        return (g.clone(), root);
    }
    let sweep = |from: usize| -> (Vec<f64>, Vec<usize>) {
        let mut dist = vec![f64::NAN; n];
        let mut par = vec![usize::MAX; n];
        dist[from] = 0.0;
        let mut stack = vec![from];
        while let Some(v) = stack.pop() {
            for &(w, t) in &adj[v] {
                if dist[w].is_nan() {
                    dist[w] = dist[v] + t;
                    par[w] = v;
                    stack.push(w);
                }
            }
        }
        (dist, par)
    };
    let farthest = |dist: &[f64]| *leaves.iter().max_by(|&&x, &&y| dist[x].partial_cmp(&dist[y]).unwrap()).unwrap();
    let (d0, _) = sweep(leaves[0]);
    let a = farthest(&d0);
    let (da, par) = sweep(a);
    let b = farthest(&da);
    let half = da[b] / 2.0;
    // Walk from b towards a until the edge (w = closer to a, v) that contains the midpoint.
    let mut v = b;
    while par[v] != usize::MAX && da[par[v]] > half {
        v = par[v];
    }
    let w = par[v];
    if w == usize::MAX {
        return (g.clone(), root);
    }
    let edge_t = da[v] - da[w];
    let to_w = (half - da[w]).clamp(0.0, edge_t);
    adj[v].retain(|&(x, _)| x != w);
    adj[w].retain(|&(x, _)| x != v);
    let new_root = n;
    adj.push(vec![(w, to_w), (v, edge_t - to_w)]);
    adj[w].push((new_root, to_w));
    adj[v].push((new_root, edge_t - to_w));
    alive.push(true);

    let mut out = TreeGraph::new();
    let mut map = vec![None; n + 1];
    let root_data = PhyloNodeData { label: "Root".into(), taxon_idx: None, branch_len: 0.0 };
    let nr = out.add_node(root_data);
    map[new_root] = Some(nr);
    let mut stack = vec![new_root];
    while let Some(x) = stack.pop() {
        let px = map[x].unwrap();
        let kids: Vec<(usize, f64)> = adj[x].iter().copied().filter(|&(y, _)| map[y].is_none() && alive[y]).collect();
        let mut added = Vec::new();
        for (y, t) in kids {
            let old = NodeIndex::new(y);
            let ny = out.add_node(PhyloNodeData { label: g[old].label.clone(), taxon_idx: g[old].taxon_idx, branch_len: t });
            map[y] = Some(ny);
            added.push((ny, t, y));
        }
        // add edges in reverse so neighbours iterate in insertion order
        for &(ny, t, _) in added.iter().rev() {
            out.add_edge(px, ny, t);
        }
        for &(_, _, y) in &added {
            stack.push(y);
        }
    }
    (out, nr)
}

fn postorder(graph: &TreeGraph, root: NodeIndex) -> Vec<NodeIndex> {
    let mut out = Vec::with_capacity(graph.node_count());
    let mut stack = vec![(root, false)];
    while let Some((node, visited)) = stack.pop() {
        if visited {
            out.push(node);
        } else {
            stack.push((node, true));
            // petgraph iterates neighbours newest-first; push in that order so children are
            // visited oldest-first (left-to-right as they were joined).
            for succ in graph.neighbors(node) {
                stack.push((succ, false));
            }
        }
    }
    out
}

/// Leaf bitset for every node, as `Vec<u64>` words.
fn node_leaf_sets(graph: &TreeGraph, root: NodeIndex, n: usize) -> Vec<Vec<u64>> {
    let words = n.div_ceil(64).max(1);
    let mut sets = vec![vec![0u64; words]; graph.node_count()];
    for node in postorder(graph, root) {
        if let Some(t) = graph[node].taxon_idx {
            sets[node.index()][t / 64] |= 1u64 << (t % 64);
        }
        let children: Vec<NodeIndex> = graph.neighbors(node).collect();
        for ch in children {
            let child = sets[ch.index()].clone();
            for (w, c) in sets[node.index()].iter_mut().zip(child) {
                *w |= c;
            }
        }
    }
    sets
}

/// Canonical form of the bipartition induced by a leaf set: the side that excludes taxon 0.
fn canonical_split(set: &[u64], n: usize) -> Vec<u64> {
    if set[0] & 1 == 0 {
        return set.to_vec();
    }
    let mut out: Vec<u64> = set.iter().map(|w| !w).collect();
    let rem = n % 64;
    if rem != 0 {
        let last = out.len() - 1;
        out[last] &= (1u64 << rem) - 1;
    }
    out
}

fn popcount(set: &[u64]) -> usize {
    set.iter().map(|w| w.count_ones() as usize).sum()
}

/// Non-trivial bipartitions (2 ≤ size ≤ n−2) of the tree, with the internal node that induces each.
fn tree_splits(graph: &TreeGraph, root: NodeIndex, n: usize) -> Vec<(NodeIndex, Vec<u64>)> {
    let sets = node_leaf_sets(graph, root, n);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for node in postorder(graph, root) {
        if node == root || graph[node].taxon_idx.is_some() {
            continue;
        }
        let split = canonical_split(&sets[node.index()], n);
        let k = popcount(&split);
        if k >= 2 && k + 2 <= n && seen.insert(split.clone()) {
            out.push((node, split));
        }
    }
    out
}

/// Branch lengths below this are treated as zero: no site backs the split (e.g. an arbitrary
/// resolution of identical sequences or of tied distances).
const ZERO_BRANCH_EPS: f64 = 1e-9;

/// Non-trivial splits whose total branch length is positive. A split's length is the sum over
/// every non-root node inducing it, so the two halves of a root edge count together.
fn resolved_tree_splits(graph: &TreeGraph, root: NodeIndex, n: usize) -> std::collections::HashSet<Vec<u64>> {
    split_lengths(graph, root, n)
        .into_iter()
        .filter(|(_, len)| *len > ZERO_BRANCH_EPS)
        .map(|(s, _)| s)
        .collect()
}

/// Total branch length of each non-trivial split of the tree.
fn split_lengths(graph: &TreeGraph, root: NodeIndex, n: usize) -> std::collections::HashMap<Vec<u64>, f64> {
    let sets = node_leaf_sets(graph, root, n);
    let mut out: std::collections::HashMap<Vec<u64>, f64> = std::collections::HashMap::new();
    for node in postorder(graph, root) {
        if node == root || graph[node].taxon_idx.is_some() {
            continue;
        }
        let split = canonical_split(&sets[node.index()], n);
        let k = popcount(&split);
        if k >= 2 && k + 2 <= n {
            *out.entry(split).or_insert(0.0) += graph[node].branch_len.max(0.0);
        }
    }
    out
}

fn graph_to_newick(graph: &TreeGraph, root: NodeIndex, support: &std::collections::HashMap<NodeIndex, u32>) -> String {
    fn rec(
        graph: &TreeGraph,
        node: NodeIndex,
        root: NodeIndex,
        support: &std::collections::HashMap<NodeIndex, u32>,
        out: &mut String,
    ) {
        let mut children: Vec<NodeIndex> = graph.neighbors(node).collect();
        children.reverse();
        if children.is_empty() {
            out.push_str(&graph[node].label);
        } else {
            out.push('(');
            for (k, ch) in children.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                rec(graph, *ch, root, support, out);
            }
            out.push(')');
            if let Some(s) = support.get(&node) {
                out.push_str(&s.to_string());
            }
        }
        if node != root {
            out.push_str(&format!(":{:.5}", graph[node].branch_len));
        }
    }
    let mut out = String::new();
    rec(graph, root, root, support, &mut out);
    out.push(';');
    out
}

/// Pairwise model distances for the given site columns; the first undefined pair is returned as `Err`.
fn distance_matrix(aligned_seqs: &[String], model: &str, cols: Option<&[usize]>) -> Result<Vec<Vec<f64>>, (usize, usize)> {
    let n = aligned_seqs.len();
    let resampled: Vec<String>;
    let seqs: &[String] = match cols {
        Some(c) => {
            resampled = aligned_seqs
                .iter()
                .map(|s| {
                    let b = s.as_bytes();
                    c.iter().map(|&i| *b.get(i).unwrap_or(&b'-') as char).collect()
                })
                .collect();
            &resampled
        }
        None => aligned_seqs,
    };
    let mut m = vec![vec![0.0f64; n]; n];
    // Molecule class is decided on the full alignment (not the resample).
    let protein = !is_nucleotide_alignment(aligned_seqs);
    let pi_all = if protein { None } else { crate::distances::alignment_base_frequencies(seqs) };
    for i in 0..n {
        for j in (i + 1)..n {
            let (d, _) = crate::distances::pair_distance_and_se_with_freqs(&seqs[i], &seqs[j], model, protein, pi_all);
            if !d.is_finite() {
                return Err((i, j));
            }
            m[i][j] = d;
            m[j][i] = d;
        }
    }
    Ok(m)
}

fn evaluate_tree_fitch_and_felsenstein(
    graph: &DiGraph<PhyloNodeData, f64>,
    root: NodeIndex,
    aligned_seqs: &[String],
) -> (usize, f64, f64, f64) {
    let n_taxa = aligned_seqs.len();
    let n_sites = aligned_seqs.first().map(|s| s.len()).unwrap_or(0);
    if n_taxa < 2 || n_sites == 0 {
        return (0, 1.0, 1.0, -10.0);
    }

    // Post-order traversal of `graph` from `root`
    let mut postorder = Vec::with_capacity(graph.node_count());
    let mut stack = vec![(root, false)];
    while let Some((node, visited)) = stack.pop() {
        if visited {
            postorder.push(node);
        } else {
            stack.push((node, true));
            for succ in graph.neighbors(node) {
                stack.push((succ, false));
            }
        }
    }

    let mut total_fitch_steps = 0usize;
    let mut min_possible_steps = 0usize;
    let mut max_possible_steps = 0usize;
    let mut total_ln_l = 0.0f64;

    let mut fitch_masks = vec![0u8; graph.node_count()];
    let mut cond_l = vec![[1.0f64; 4]; graph.node_count()];

    for col in 0..n_sites {
        let mut counts = [0usize; 4];
        let mut valid_taxa = 0usize;
        for row in aligned_seqs {
            match row.as_bytes().get(col).copied().unwrap_or(b'-').to_ascii_uppercase() {
                b'A' => {
                    counts[0] += 1;
                    valid_taxa += 1;
                }
                b'C' => {
                    counts[1] += 1;
                    valid_taxa += 1;
                }
                b'G' => {
                    counts[2] += 1;
                    valid_taxa += 1;
                }
                b'T' | b'U' => {
                    counts[3] += 1;
                    valid_taxa += 1;
                }
                _ => {}
            }
        }

        let distinct_states = counts.iter().filter(|&&c| c > 0).count();
        if distinct_states > 1 {
            let max_freq = counts.iter().copied().max().unwrap_or(0);
            min_possible_steps += distinct_states - 1;
            max_possible_steps += valid_taxa.saturating_sub(max_freq);
        }

        // Fitch down-pass + Felsenstein pruning under JC69/K80 transition probability P_ij(t)
        let mut col_steps = 0usize;
        for &node in &postorder {
            let ni = node.index();
            let children: Vec<NodeIndex> = graph.neighbors(node).collect();
            if children.is_empty() {
                let b = graph[node]
                    .taxon_idx
                    .and_then(|ti| aligned_seqs.get(ti))
                    .and_then(|s| s.as_bytes().get(col).copied())
                    .unwrap_or(b'-')
                    .to_ascii_uppercase();
                match b {
                    b'A' => {
                        fitch_masks[ni] = 0b0001;
                        cond_l[ni] = [1.0, 0.0, 0.0, 0.0];
                    }
                    b'C' => {
                        fitch_masks[ni] = 0b0010;
                        cond_l[ni] = [0.0, 1.0, 0.0, 0.0];
                    }
                    b'G' => {
                        fitch_masks[ni] = 0b0100;
                        cond_l[ni] = [0.0, 0.0, 1.0, 0.0];
                    }
                    b'T' | b'U' => {
                        fitch_masks[ni] = 0b1000;
                        cond_l[ni] = [0.0, 0.0, 0.0, 1.0];
                    }
                    _ => {
                        fitch_masks[ni] = 0b1111;
                        cond_l[ni] = [1.0, 1.0, 1.0, 1.0];
                    }
                }
            } else {
                // Fitch intersection / union across children
                let mut cur_mask = fitch_masks[children[0].index()];
                for &ch in &children[1..] {
                    let cm = fitch_masks[ch.index()];
                    let inter = cur_mask & cm;
                    if inter != 0 {
                        cur_mask = inter;
                    } else {
                        cur_mask |= cm;
                        col_steps += 1;
                    }
                }
                fitch_masks[ni] = cur_mask;

                // Felsenstein conditional likelihood L_v(s) = prod_c sum_u P_{s->u}(t_c) L_c(u)
                let mut lv = [1.0f64; 4];
                for &ch in &children {
                    let ci = ch.index();
                    let t = graph[ch].branch_len.max(1e-8);
                    let e = (-4.0 / 3.0 * t).exp();
                    let p_same = 0.25 + 0.75 * e;
                    let p_diff = (0.25 - 0.25 * e).max(1e-9);
                    let lc = cond_l[ci];
                    for s in 0..4 {
                        let mut sum_u = 0.0;
                        for u in 0..4 {
                            sum_u += if s == u { p_same } else { p_diff } * lc[u];
                        }
                        lv[s] *= sum_u;
                    }
                }
                cond_l[ni] = lv;
            }
        }

        total_fitch_steps += col_steps;
        let root_l: f64 = cond_l[root.index()].iter().map(|&x| 0.25 * x).sum();
        total_ln_l += root_l.max(1e-300).ln();
    }

    let ci = if total_fitch_steps > 0 {
        (min_possible_steps as f64 / total_fitch_steps as f64).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let ri = if max_possible_steps > min_possible_steps {
        ((max_possible_steps.saturating_sub(total_fitch_steps)) as f64
            / (max_possible_steps - min_possible_steps) as f64)
            .clamp(0.0, 1.0)
    } else {
        1.0
    };

    (
        total_fitch_steps,
        (ci * 1000.0).round() / 1000.0,
        (ri * 1000.0).round() / 1000.0,
        (total_ln_l * 100.0).round() / 100.0,
    )
}

/// Neighbor-Joining tree for the alignment as a likelihood-engine tree (NJ branch lengths as the
/// starting point). `None` when a pairwise distance is undefined under `model`.
pub fn nj_likelihood_tree(names: &[String], seqs: &[String], model: &str) -> Option<crate::likelihood::LkTree> {
    let n = names.len().min(seqs.len());
    if n < 2 {
        return None;
    }
    let m = distance_matrix(&seqs[..n], model, None).ok()?;
    let (g, root) = build_distance_tree_graph(&names[..n], &m, false);
    let (g, root) = midpoint_reroot(&g, root);
    Some(graph_to_lk_tree(&g, root))
}

/// A tree graph as a likelihood tree rooted at `root`.
fn graph_to_lk_tree(g: &TreeGraph, root: NodeIndex) -> crate::likelihood::LkTree {
    use crate::likelihood::{LkNode, LkTree};
    let mut map = std::collections::HashMap::new();
    let mut nodes = Vec::with_capacity(g.node_count());
    for v in postorder(g, root).into_iter().rev() {
        map.insert(v, nodes.len());
        nodes.push(LkNode { parent: None, children: Vec::new(), taxon: g[v].taxon_idx, t: g[v].branch_len.max(1e-6) });
    }
    for v in g.node_indices() {
        if !map.contains_key(&v) {
            continue;
        }
        let mut kids: Vec<NodeIndex> = g.neighbors(v).collect();
        kids.reverse();
        let pv = map[&v];
        for c in kids {
            let ci = map[&c];
            nodes[ci].parent = Some(pv);
            nodes[pv].children.push(ci);
        }
    }
    let r = map[&root];
    nodes[r].t = 0.0;
    LkTree { nodes, root: r }
}

/// Jukes–Cantor (JC69) log-likelihood of a fixed topology with maximum-likelihood branch lengths
/// (as IQ-TREE `-te` and phangorn `optim.pml(optEdge = TRUE)`).
/// Gaps and ambiguity codes are treated as missing data.
fn jc_ml_log_likelihood(g: &TreeGraph, root: NodeIndex, seqs: &[String]) -> Option<(f64, f64)> {
    use crate::likelihood::{Engine, NucModel, Patterns};
    let spec = crate::ml_search::parse_model("JC")?;
    let tree = crate::ml_search::unroot(&graph_to_lk_tree(g, root));
    let pats = Patterns::from_alignment(seqs);
    let mut eng = Engine::new(tree, &pats, NucModel::new(spec, [0.25; 4]));
    let mut ln_l = eng.optimize_branches();
    for _ in 0..30 {
        let next = eng.optimize_branches();
        let done = (next - ln_l).abs() < 1e-5;
        ln_l = next;
        if done {
            break;
        }
    }
    Some((ln_l, eng.tree_length()))
}

/// Fraction of non-gap characters that are nucleotides; Felsenstein pruning here is a 4-state model.
pub(crate) fn is_nucleotide_alignment(aligned_seqs: &[String]) -> bool {
    // Unambiguous bases, plus IUPAC ambiguity codes (mixed-base calls in
    // population / Sanger consensus data). Ambiguity letters are also amino
    // acids, so they only count when unambiguous bases still dominate: a
    // protein has only ~25% A/C/G/T/N residues.
    let (mut core, mut ambiguous, mut total) = (0usize, 0usize, 0usize);
    for s in aligned_seqs {
        for b in s.bytes() {
            let b = b.to_ascii_uppercase();
            if b == b'-' || b == b'?' || b == b'.' {
                continue;
            }
            total += 1;
            if matches!(b, b'A' | b'C' | b'G' | b'T' | b'U' | b'N') {
                core += 1;
            } else if matches!(
                b,
                b'R' | b'Y' | b'S' | b'W' | b'K' | b'M' | b'B' | b'D' | b'H' | b'V'
            ) {
                ambiguous += 1;
            }
        }
    }
    total > 0 && core * 10 >= total * 6 && (core + ambiguous) * 10 >= total * 9
}

fn short_clade_label(names: &[String], split: &[u64], n: usize) -> String {
    let members: Vec<&str> = (0..n)
        .filter(|&t| split[t / 64] >> (t % 64) & 1 == 1)
        .map(|t| names[t].as_str())
        .collect();
    if members.len() <= 3 {
        members.join(", ")
    } else {
        format!("{}, {} … (+{} taxa)", members[0], members[1], members.len() - 2)
    }
}

/// Approximate work of one distance-matrix + tree build, used to cap interactive bootstrap runs.
const BOOTSTRAP_WORK_BUDGET: f64 = 1.5e8;

/// Distance-based phylogeny with a real non-parametric bootstrap (Felsenstein 1985), Fitch (1971)
/// parsimony length / CI / RI and the JC69 Felsenstein (1981) log-likelihood of the resulting tree.
///
/// Topology comes from NJ (or UPGMA). The ML/Bayesian/parsimony algorithm names select how the
/// tree is *described*; no ML, Bayesian or parsimony tree search is performed, and `method_note`
/// says so explicitly.
pub fn construct_phylogenetic_tree(
    names: &[String],
    aligned_seqs: &[String],
    algorithm: &str,
    model: &str,
    bootstrap_replicates: usize,
) -> PhyloTreeInferenceReport {
    construct_phylogenetic_tree_with_resampling(names, aligned_seqs, algorithm, model, bootstrap_replicates, None)
}

/// Like [`construct_phylogenetic_tree`], but `jackknife_keep_pct = Some(p)` resamples by the
/// delete-d jackknife instead of the bootstrap: each replicate keeps `p`% of the alignment
/// columns, drawn without replacement.
pub fn construct_phylogenetic_tree_with_resampling(
    names: &[String],
    aligned_seqs: &[String],
    algorithm: &str,
    model: &str,
    bootstrap_replicates: usize,
    jackknife_keep_pct: Option<f64>,
) -> PhyloTreeInferenceReport {
    let n = names.len().min(aligned_seqs.len());
    let empty = |note: String, warnings: Vec<String>| PhyloTreeInferenceReport {
        algorithm: algorithm.to_string(),
        model: model.to_string(),
        bootstrap_replicates: 0,
        newick: "();".into(),
        log_likelihood: f64::NAN,
        total_tree_length_s: 0.0,
        parsimony_steps: 0,
        consistency_index_ci: f64::NAN,
        retention_index_ri: f64::NAN,
        clade_bootstraps: Vec::new(),
        method_note: note,
        warnings,
    };
    if n < 2 {
        return empty("A tree needs at least two sequences.".into(), Vec::new());
    }
    let names = &names[..n];
    let seqs = &aligned_seqs[..n];
    let n_sites = seqs.iter().map(|s| s.len()).max().unwrap_or(0);

    let dist_mat = match distance_matrix(seqs, model, None) {
        Ok(m) => m,
        Err((i, j)) => {
            return empty(
                format!("No tree: the {model} distance is undefined for at least one pair."),
                vec![format!(
                    "{} vs {}: distance undefined (no shared sites, or too divergent for {model}). Use p-distance or remove the sequence.",
                    names[i], names[j]
                )],
            )
        }
    };

    let is_upgma = algorithm == "UPGMA";
    let (graph, root) = build_distance_tree_graph(names, &dist_mat, is_upgma);
    let (mut graph, root) = if is_upgma { (graph, root) } else { midpoint_reroot(&graph, root) };
    let splits = tree_splits(&graph, root, n);

    // Non-parametric bootstrap over alignment columns.
    let per_rep = (n * n) as f64 * 0.5 * n_sites.max(1) as f64 + (n * n * n) as f64;
    let affordable = (BOOTSTRAP_WORK_BUDGET / per_rep.max(1.0)).floor() as usize;
    let reps = if n >= 4 && n_sites > 0 { bootstrap_replicates.min(affordable).min(1000) } else { 0 };
    let mut hits = vec![0usize; splits.len()];
    let mut done = 0usize;
    let mut failed = 0usize;
    let mut rng = SplitMix64::new(0x517C_C1B7_2722_0A95);
    for _ in 0..reps {
        let cols: Vec<usize> = match jackknife_keep_pct {
            Some(pct) => {
                // Partial Fisher-Yates: the first `keep` indices are a uniform sample without replacement.
                let keep = ((n_sites as f64 * pct.clamp(1.0, 99.0) / 100.0).round() as usize).clamp(1, n_sites);
                let mut idx: Vec<usize> = (0..n_sites).collect();
                for i in 0..keep {
                    let j = i + rng.next_usize(n_sites - i);
                    idx.swap(i, j);
                }
                let mut kept = idx[..keep].to_vec();
                kept.sort_unstable();
                kept
            }
            None => (0..n_sites).map(|_| rng.next_usize(n_sites)).collect(),
        };
        let Ok(m) = distance_matrix(seqs, model, Some(&cols)) else {
            failed += 1;
            continue;
        };
        let (g, r) = build_distance_tree_graph(names, &m, is_upgma);
        // Zero-length branches are collapsed: a replicate supports a clade only when it resolves
        // it with positive length, never through an arbitrary tie-break (e.g. identical sequences).
        let rep = resolved_tree_splits(&g, r, n);
        for (k, (_, s)) in splits.iter().enumerate() {
            if rep.contains(s) {
                hits[k] += 1;
            }
        }
        done += 1;
    }

    let mut support = std::collections::HashMap::new();
    let mut clade_bootstraps = Vec::with_capacity(splits.len());
    let ref_lengths = split_lengths(&graph, root, n);
    let mut zero_length_clades = 0usize;
    for (k, (node, split)) in splits.iter().enumerate() {
        let total_len = ref_lengths.get(split).copied().unwrap_or(0.0);
        if total_len <= ZERO_BRANCH_EPS {
            zero_length_clades += 1;
        }
        let branch_length = (total_len * 1e5).round() / 1e5;
        let pct = if done > 0 { ((hits[k] as f64 * 100.0) / done as f64).round() as u32 } else { 0 };
        if done > 0 {
            support.insert(*node, pct);
        }
        clade_bootstraps.push(CladeBootstrapRow {
            clade_label: short_clade_label(names, split, n),
            support_pct: pct,
            branch_length,
        });
    }
    let newick = graph_to_newick(&graph, root, &support);

    let (parsimony_steps, ci, ri, _fixed_ln_l) = evaluate_tree_fitch_and_felsenstein(&graph, root, seqs);
    let felsenstein_ln_l = if is_nucleotide_alignment(seqs) && n >= 3 {
        jc_ml_log_likelihood(&graph, root, seqs).map(|x| (x.0 * 1000.0).round() / 1000.0).unwrap_or(f64::NAN)
    } else {
        _fixed_ln_l
    };
    let total_s: f64 = graph.edge_weights().copied().sum();
    graph[root].branch_len = 0.0;

    let nucleotide = is_nucleotide_alignment(seqs);
    // Proteins use amino-acid distances (see distances::calc_protein_pair_distance_and_se).
    let model_label = if nucleotide {
        model.to_string()
    } else if model.to_ascii_lowercase().contains("p-distance") {
        "amino-acid p-distance".to_string()
    } else {
        "Poisson-corrected amino-acid".to_string()
    };
    let topology = match algorithm {
        "UPGMA" => format!("UPGMA (average linkage, assumes a molecular clock) on {model_label} distances."),
        "Neighbor-Joining (NJ)" => format!("Neighbor-Joining (Saitou & Nei 1987) on {model_label} distances, midpoint-rooted."),
        "Minimum-Evolution (ME)" => format!("Neighbor-Joining tree on {model_label} distances (the starting tree of an ME search); no ME branch-swapping is performed."),
        "Maximum Parsimony (MP)" => format!("Fitch parsimony length, CI and RI of the Neighbor-Joining tree on {model_label} distances; no parsimony tree search is performed."),
        other => format!("{other} is not run here: the topology is Neighbor-Joining on {model_label} distances and lnL is evaluated on that fixed tree, not optimised."),
    };
    let lnl_note = if nucleotide {
        " lnL: Jukes–Cantor (JC69) likelihood of this topology with maximum-likelihood branch lengths."
    } else {
        " lnL not computed: the likelihood model here is for nucleotides only."
    };
    let boot_note = if reps == 0 {
        if bootstrap_replicates > 0 && n < 4 {
            " Bootstrap needs at least 4 taxa.".to_string()
        } else {
            " No bootstrap replicates were run.".to_string()
        }
    } else {
        let mut s = match jackknife_keep_pct {
            Some(pct) => format!(
                " Jackknife: {done} replicates, each keeping {:.0}% of the columns drawn without replacement; support = % of replicate trees containing each clade.",
                pct.clamp(1.0, 99.0)
            ),
            None => format!(
                " Bootstrap: {done} non-parametric replicates (Felsenstein 1985); support = % of replicate trees containing each clade."
            ),
        };
        if reps < bootstrap_replicates {
            s.push_str(&format!(" {bootstrap_replicates} were requested; reduced to {reps} to keep the analysis interactive."));
        }
        if failed > 0 {
            s.push_str(&format!(" {failed} replicates were dropped because a resampled distance was undefined."));
        }
        s.push_str(" Zero-length branches are collapsed in every replicate, so a clade counts only when a replicate resolves it with positive length.");
        if zero_length_clades > 0 {
            s.push_str(&format!(
                " {zero_length_clades} clade(s) have a zero-length branch (identical or tied sequences): their resolution is arbitrary, not supported by any site."
            ));
        }
        s
    };

    PhyloTreeInferenceReport {
        algorithm: algorithm.to_string(),
        model: model.to_string(),
        bootstrap_replicates: done,
        newick,
        log_likelihood: if nucleotide { felsenstein_ln_l } else { f64::NAN },
        total_tree_length_s: (total_s * 1e5).round() / 1e5,
        parsimony_steps,
        consistency_index_ci: ci,
        retention_index_ri: ri,
        clade_bootstraps,
        method_note: format!("{topology}{lnl_note}{boot_note}"),
        warnings: Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicationNodeRecord {
    pub node_id: String,
    pub event_type: String,
    pub descendant_taxa: Vec<String>,
    pub confidence_pct: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteCoverageBin {
    pub threshold_label: String,
    pub site_count: usize,
    pub pct_of_alignment: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTreeAnalysisReport {
    pub newick: String,
    #[serde(rename = "mlLogLikelihood")]
    pub ml_log_likelihood: f64,
    #[serde(rename = "mlAicc")]
    pub ml_aicc: f64,
    #[serde(rename = "olsSumOfSquaresSSE")]
    pub ols_sum_of_squares_sse: f64,
    #[serde(rename = "olsRSquared")]
    pub ols_r_squared: f64,
    #[serde(rename = "parsimonyLengthSteps")]
    pub parsimony_length_steps: usize,
    #[serde(rename = "consistencyIndex")]
    pub consistency_index: f64,
    #[serde(rename = "retentionIndex")]
    pub retention_index: f64,
    #[serde(rename = "duplicationNodes")]
    pub duplication_nodes: Vec<DuplicationNodeRecord>,
    #[serde(rename = "siteCoverageBins")]
    pub site_coverage_bins: Vec<SiteCoverageBin>,
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Parse a Newick string into a tree whose leaves are matched to `names` (exactly, after Newick
/// label sanitising, or with underscores read as spaces). Internal labels are ignored.
fn parse_newick_tree(newick: &str, names: &[String]) -> Result<(TreeGraph, NodeIndex, bool), String> {
    struct P<'a> {
        s: &'a [u8],
        pos: usize,
    }
    impl P<'_> {
        fn skip(&mut self) {
            while self.pos < self.s.len() {
                match self.s[self.pos] {
                    b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                    b'[' => {
                        while self.pos < self.s.len() && self.s[self.pos] != b']' {
                            self.pos += 1;
                        }
                        self.pos += 1;
                    }
                    _ => break,
                }
            }
        }
        fn peek(&mut self) -> Option<u8> {
            self.skip();
            self.s.get(self.pos).copied()
        }
        fn label(&mut self) -> String {
            self.skip();
            if self.s.get(self.pos) == Some(&b'\'') {
                self.pos += 1;
                let start = self.pos;
                while self.pos < self.s.len() && self.s[self.pos] != b'\'' {
                    self.pos += 1;
                }
                let out = String::from_utf8_lossy(&self.s[start..self.pos]).into_owned();
                self.pos += 1;
                return out;
            }
            let start = self.pos;
            while self.pos < self.s.len() && !matches!(self.s[self.pos], b'(' | b')' | b',' | b':' | b';' | b'[') {
                self.pos += 1;
            }
            String::from_utf8_lossy(&self.s[start..self.pos]).trim().to_string()
        }
    }
    let lookup = |raw: &str| -> Option<usize> {
        names
            .iter()
            .position(|n| n == raw)
            .or_else(|| names.iter().position(|n| sanitize_newick_label(n) == raw))
            .or_else(|| names.iter().position(|n| n == &raw.replace('_', " ")))
    };
    fn node(
        p: &mut P,
        g: &mut TreeGraph,
        lookup: &dyn Fn(&str) -> Option<usize>,
        all_lengths: &mut bool,
        depth: usize,
    ) -> Result<NodeIndex, String> {
        if depth > 4000 {
            return Err("Newick nesting too deep".into());
        }
        let mut children = Vec::new();
        if p.peek() == Some(b'(') {
            p.pos += 1;
            loop {
                children.push(node(p, g, lookup, all_lengths, depth + 1)?);
                match p.peek() {
                    Some(b',') => p.pos += 1,
                    Some(b')') => {
                        p.pos += 1;
                        break;
                    }
                    _ => return Err("Unbalanced parentheses in Newick".into()),
                }
            }
        }
        let label = p.label();
        let mut len = None;
        if p.peek() == Some(b':') {
            p.pos += 1;
            let raw = p.label();
            len = Some(raw.parse::<f64>().map_err(|_| format!("Bad branch length '{raw}'"))?);
        }
        let taxon_idx = if children.is_empty() {
            Some(lookup(&label).ok_or_else(|| format!("Tip '{label}' is not a sequence in the alignment"))?)
        } else {
            None
        };
        let nx = g.add_node(PhyloNodeData {
            label: label.clone(),
            taxon_idx,
            branch_len: len.unwrap_or(0.0).max(0.0),
        });
        // Children are added in reverse so `neighbors` (newest first) yields them left to right.
        for &ch in children.iter().rev() {
            let w = g[ch].branch_len;
            g.add_edge(nx, ch, w);
        }
        if len.is_none() && depth > 0 {
            *all_lengths = false;
        }
        Ok(nx)
    }
    let mut p = P { s: newick.as_bytes(), pos: 0 };
    let mut g = TreeGraph::new();
    let mut all_lengths = true;
    let root = node(&mut p, &mut g, &lookup, &mut all_lengths, 0)?;
    let mut seen = vec![false; names.len()];
    for nx in g.node_indices() {
        if let Some(t) = g[nx].taxon_idx {
            if std::mem::replace(&mut seen[t], true) {
                return Err(format!("Tip '{}' appears more than once", names[t]));
            }
        }
    }
    if let Some(missing) = seen.iter().position(|s| !s) {
        return Err(format!("Sequence '{}' is not in the tree", names[missing]));
    }
    Ok((g, root, all_lengths))
}

/// Path length between every pair of leaves (patristic distances).
fn patristic_distances(graph: &TreeGraph, root: NodeIndex, n: usize) -> Vec<Vec<f64>> {
    let mut depth = vec![0.0f64; graph.node_count()];
    let mut parent = vec![None; graph.node_count()];
    let mut order = vec![root];
    let mut k = 0;
    while k < order.len() {
        let v = order[k];
        for ch in graph.neighbors(v) {
            depth[ch.index()] = depth[v.index()] + graph[ch].branch_len;
            parent[ch.index()] = Some(v);
            order.push(ch);
        }
        k += 1;
    }
    let mut leaf_of = vec![root; n];
    for nx in graph.node_indices() {
        if let Some(t) = graph[nx].taxon_idx {
            leaf_of[t] = nx;
        }
    }
    let ancestors = |mut v: NodeIndex| {
        let mut set = std::collections::HashSet::new();
        set.insert(v);
        while let Some(p) = parent[v.index()] {
            set.insert(p);
            v = p;
        }
        set
    };
    let mut out = vec![vec![0.0; n]; n];
    for i in 0..n {
        let anc = ancestors(leaf_of[i]);
        for j in (i + 1)..n {
            let mut v = leaf_of[j];
            while !anc.contains(&v) {
                v = parent[v.index()].unwrap_or(root);
            }
            let d = depth[leaf_of[i].index()] + depth[leaf_of[j].index()] - 2.0 * depth[v.index()];
            out[i][j] = d;
            out[j][i] = d;
        }
    }
    out
}

/// Evaluate a user-supplied (or the inferred) tree on the alignment: JC69 log-likelihood with the
/// tree's own branch lengths, AICc with 2n−3 branch-length parameters, Fitch parsimony, and the
/// ordinary-least-squares fit of patristic distances to TN93 pairwise distances.
///
/// Gene-duplication inference needs a species tree to reconcile against; none is available here,
/// so `duplication_nodes` is empty and `notes` explains why.
pub fn analyze_user_tree(user_newick: &str, names: &[String], aligned_seqs: &[String]) -> UserTreeAnalysisReport {
    let n = names.len().min(aligned_seqs.len());
    let names = &names[..n];
    let seqs = &aligned_seqs[..n];
    let n_sites = seqs.iter().map(|s| s.len()).max().unwrap_or(0).max(1);
    let n_taxa = n.max(1);
    let mut notes = Vec::new();

    let cutoffs = [1.0f64, 0.9, 0.75, 0.5];
    let site_coverage_bins: Vec<SiteCoverageBin> = cutoffs
        .iter()
        .map(|&thr| {
            let count = (0..n_sites)
                .filter(|&c| {
                    let valid = seqs
                        .iter()
                        .filter(|row| {
                            let ch = row.as_bytes().get(c).copied().unwrap_or(b'-').to_ascii_uppercase();
                            ch != b'-' && ch != b'N' && ch != b'?'
                        })
                        .count();
                    (valid as f64 / n_taxa as f64) >= thr
                })
                .count();
            SiteCoverageBin {
                threshold_label: format!("≥ {}% Taxon Coverage", (thr * 100.0).round() as usize),
                site_count: count,
                pct_of_alignment: (((count as f64 / n_sites as f64) * 100.0) * 10.0).round() / 10.0,
            }
        })
        .collect();

    let newick = if user_newick.trim().is_empty() {
        construct_phylogenetic_tree(names, seqs, "Neighbor-Joining (NJ)", "Tamura-Nei (TN93)", 0).newick
    } else {
        user_newick.trim().to_string()
    };
    let nan_report = |notes: Vec<String>| UserTreeAnalysisReport {
        newick: newick.clone(),
        ml_log_likelihood: f64::NAN,
        ml_aicc: f64::NAN,
        ols_sum_of_squares_sse: f64::NAN,
        ols_r_squared: f64::NAN,
        parsimony_length_steps: 0,
        consistency_index: f64::NAN,
        retention_index: f64::NAN,
        duplication_nodes: Vec::new(),
        site_coverage_bins: site_coverage_bins.clone(),
        notes,
    };
    let (graph, root, all_lengths) = match parse_newick_tree(&newick, names) {
        Ok(t) => t,
        Err(e) => return nan_report(vec![format!("Tree not evaluated: {e}.")]),
    };

    let (steps, ci, ri, given_ln_l) = evaluate_tree_fitch_and_felsenstein(&graph, root, seqs);
    // IQ-TREE and phangorn evaluate a user topology with optimised branch lengths; the
    // likelihood with the tree's own lengths is kept as a note.
    let ln_l = if is_nucleotide_alignment(seqs) && n >= 3 {
        match jc_ml_log_likelihood(&graph, root, seqs) {
            Some((l, _)) => {
                if all_lengths {
                    notes.push(format!("lnL with the tree's own branch lengths: {given_ln_l:.3}; reported lnL uses maximum-likelihood branch lengths (JC69)."));
                }
                (l * 1000.0).round() / 1000.0
            }
            None => given_ln_l,
        }
    } else {
        given_ln_l
    };
    let k = (2 * n).saturating_sub(3).max(1) as f64;
    let (ml_log_likelihood, ml_aicc) = if !is_nucleotide_alignment(seqs) {
        notes.push("lnL / AICc use a nucleotide (JC69) model and are not computed for protein alignments.".into());
        (f64::NAN, f64::NAN)
    } else {
        let aic = 2.0 * k - 2.0 * ln_l;
        let denom = n_sites as f64 - k - 1.0;
        let aicc = if denom > 0.0 { aic + (2.0 * k * (k + 1.0)) / denom } else { f64::NAN };
        (ln_l, (aicc * 100.0).round() / 100.0)
    };

    let (mut sse, mut ss_tot) = (f64::NAN, f64::NAN);
    match distance_matrix(seqs, "Tamura-Nei (TN93)", None) {
        Ok(obs) if all_lengths && n >= 3 => {
            let pat = patristic_distances(&graph, root, n);
            let pairs: Vec<(f64, f64)> = (0..n)
                .flat_map(|i| ((i + 1)..n).map(move |j| (i, j)))
                .map(|(i, j)| (obs[i][j], pat[i][j]))
                .collect();
            let mean = pairs.iter().map(|p| p.0).sum::<f64>() / pairs.len() as f64;
            sse = pairs.iter().map(|(o, p)| (o - p).powi(2)).sum();
            ss_tot = pairs.iter().map(|(o, _)| (o - mean).powi(2)).sum();
        }
        Ok(_) => notes.push("OLS fit needs ≥ 3 taxa and branch lengths on every edge.".into()),
        Err((i, j)) => notes.push(format!("OLS fit not computed: TN93 distance undefined for {} vs {}.", names[i], names[j])),
    }
    let r2 = if ss_tot > 0.0 { 1.0 - sse / ss_tot } else { f64::NAN };
    notes.push("Gene duplication / speciation nodes need a species tree to reconcile against; none is inferred.".into());

    UserTreeAnalysisReport {
        newick,
        ml_log_likelihood,
        ml_aicc,
        ols_sum_of_squares_sse: (sse * 1e6).round() / 1e6,
        ols_r_squared: (r2 * 1e4).round() / 1e4,
        parsimony_length_steps: steps,
        consistency_index: ci,
        retention_index: ri,
        duplication_nodes: Vec::new(),
        site_coverage_bins,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// Saitou & Nei (1987) / Wikipedia five-taxon example.
    #[test]
    fn neighbor_joining_recovers_the_textbook_tree() {
        let names = s(&["a", "b", "c", "d", "e"]);
        let d = vec![
            vec![0.0, 5.0, 9.0, 9.0, 8.0],
            vec![5.0, 0.0, 10.0, 10.0, 9.0],
            vec![9.0, 10.0, 0.0, 8.0, 7.0],
            vec![9.0, 10.0, 8.0, 0.0, 3.0],
            vec![8.0, 9.0, 7.0, 3.0, 0.0],
        ];
        let (g, root) = build_distance_tree_graph(&names, &d, false);
        let leaf = |t: usize| g.node_indices().find(|&x| g[x].taxon_idx == Some(t)).unwrap();
        let bl: Vec<f64> = (0..4).map(|t| g[leaf(t)].branch_len).collect();
        assert_eq!(bl, vec![2.0, 3.0, 4.0, 2.0]);
        // e (length 1) is the last join, so its edge is split by the root: 0.5 + 0.5.
        let total: f64 = g.edge_weights().sum();
        assert!((total - 17.0).abs() < 1e-12, "{total}");
        // Patristic distances reproduce the (additive) input matrix exactly.
        let pat = patristic_distances(&g, root, 5);
        for i in 0..5 {
            for j in 0..5 {
                assert!((pat[i][j] - d[i][j]).abs() < 1e-12);
            }
        }
        let splits: Vec<usize> = tree_splits(&g, root, 5).iter().map(|(_, sp)| popcount(sp)).collect();
        assert_eq!(splits.len(), 2);
    }

    #[test]
    fn upgma_heights_are_half_the_average_linkage_distance() {
        let names = s(&["a", "b", "c"]);
        let d = vec![vec![0.0, 2.0, 6.0], vec![2.0, 0.0, 6.0], vec![6.0, 6.0, 0.0]];
        let (g, root) = build_distance_tree_graph(&names, &d, true);
        let newick = graph_to_newick(&g, root, &Default::default());
        assert_eq!(newick, "((a:1.00000,b:1.00000):2.00000,c:3.00000);");

        // Above, d(a,c) = d(b,c), so complete or single linkage would give the same tree. The
        // Wikipedia "UPGMA" worked example (JC69 distances from a 5S rRNA alignment of five
        // bacteria, Erdmann & Wolters 1986) has unequal distances between the clusters it
        // merges, so only the average sets these heights. By hand:
        //   join a,b at 17                -> height 8.5
        //   d(ab,e) = (23+21)/2 = 22      -> height 11   (complete: max 23; single: min 21)
        //   d(c,d)  = 28                  -> height 14
        //   d(abe,cd) = (21+30+39+31+34+43)/6 = 198/6 = 33 -> height 16.5 (complete: 43)
        // SciPy 1.18.1 `scipy.cluster.hierarchy.average` merges at [17, 22, 28, 33]; its
        // cophenetic matrix (`cophenet`) is the patristic distance, twice the shared height.
        let names = s(&["a", "b", "c", "d", "e"]);
        let d = vec![
            vec![0.0, 17.0, 21.0, 31.0, 23.0],
            vec![17.0, 0.0, 30.0, 34.0, 21.0],
            vec![21.0, 30.0, 0.0, 28.0, 39.0],
            vec![31.0, 34.0, 28.0, 0.0, 43.0],
            vec![23.0, 21.0, 39.0, 43.0, 0.0],
        ];
        let (g, root) = build_distance_tree_graph(&names, &d, true);
        assert_eq!(
            graph_to_newick(&g, root, &Default::default()),
            "(((a:8.50000,b:8.50000):2.50000,e:11.00000):5.50000,(c:14.00000,d:14.00000):2.50000);"
        );
        let scipy_cophenetic = [
            [0.0, 17.0, 33.0, 33.0, 22.0],
            [17.0, 0.0, 33.0, 33.0, 22.0],
            [33.0, 33.0, 0.0, 28.0, 33.0],
            [33.0, 33.0, 28.0, 0.0, 33.0],
            [22.0, 22.0, 33.0, 33.0, 0.0],
        ];
        let pat = patristic_distances(&g, root, 5);
        for i in 0..5 {
            for j in 0..5 {
                assert!((pat[i][j] - scipy_cophenetic[i][j]).abs() < 1e-12, "{i},{j}: {}", pat[i][j]);
            }
        }
    }

    #[test]
    fn bootstrap_is_real_and_user_tree_is_actually_evaluated() {
        // Two well-separated pairs: {A,B} vs {C,D,E}; the split must have high support.
        let base = "ACGTACGTTGCAAGCTTGACCATGGATCCGAATTCGGTACCAGTCTAGAGCTCGCATGCAAGCTT";
        let mutate = |pos: &[usize]| -> String {
            base.bytes()
                .enumerate()
                .map(|(i, b)| if pos.contains(&i) { if b == b'A' { 'G' } else { 'A' } } else { b as char })
                .collect()
        };
        let names = s(&["A", "B", "C", "D", "E"]);
        let seqs = vec![
            mutate(&[1, 5, 9, 13, 17, 21, 25, 29]),
            mutate(&[1, 5, 9, 13, 17, 21, 25, 33]),
            mutate(&[40, 44, 48]),
            mutate(&[40, 44, 52]),
            mutate(&[40, 56]),
        ];
        let rep = construct_phylogenetic_tree(&names, &seqs, "Neighbor-Joining (NJ)", "Jukes-Cantor (JC69)", 200);
        assert_eq!(rep.bootstrap_replicates, 200);
        let ab = rep.clade_bootstraps.iter().find(|c| c.clade_label == "A, B" || c.clade_label == "C, D, E").unwrap();
        assert!(ab.support_pct >= 90, "{:?}", rep.clade_bootstraps);

        // The replicates must be resampled alignments. C,D is backed by a single site (44: C and
        // D carry it, E does not) and the NJ tree of the original alignment resolves it with a
        // positive branch, so replicates that copy the original columns (or permute them) all
        // resolve C,D (100%), and replicates that all draw the same columns resolve it in none
        // or all of them (0% or 100%). A support strictly between 0 and 100 means some replicates
        // differ from the original alignment and from each other.
        //
        // The seeded value, derived outside this crate: a Python re-implementation of the
        // resampler - SplitMix64 (Steele, Lea & Flood 2014) seeded 0x517CC1B727220A95, each
        // replicate drawing 65 columns as next_u64() % 65, with replacement - feeding textbook
        // JC69 distances d = -3/4 ln(1 - 4p/3), rounded half-up to 4 dp as this crate reports
        // them, to Biopython 1.85's Neighbor-Joining (Bio.Phylo.TreeConstruction.
        // DistanceTreeConstructor().nj) and counting C,D when its split has branch length > 1e-9,
        // resolves C,D in 137 of 200 replicates: 68.5%, reported as 69. All 118 replicates that
        // draw site 44 resolve it (branch >= 0.0125); a replicate without site 44 leaves the C, D,
        // E distances tied up to the curvature of the JC69 correction, and NJ resolves 19 of those
        // ties as C,D with a short (<= 0.0064) positive branch. Which ones depends on the 4-dp
        // rounding: on unrounded distances 7 of those 19 lose C,D and 5 other replicates without
        // site 44 gain it, so the oracle gives 135 (68%).
        // Without the seed: over 20,000 replicates drawn from another seed the oracle resolves
        // C,D in 73.1% (standard error 0.3%), whose 99.9% binomial interval for 200 replicates
        // is 125-166 hits (62.5-83%, reported 63-83), and 69 lies inside it.
        let cd = rep.clade_bootstraps.iter().find(|c| c.clade_label == "C, D").expect("C,D clade");
        assert!(cd.branch_length > 0.0, "{:?}", rep.clade_bootstraps);
        assert!(cd.support_pct > 0 && cd.support_pct < 100, "C,D support {} - replicates are not resampled", cd.support_pct);
        assert!((63..=83).contains(&cd.support_pct), "C,D support {} outside the bootstrap's 99.9% range", cd.support_pct);
        assert_eq!(cd.support_pct, 69, "seeded C,D support");
        // Replicate by replicate: the same oracle resolves C,D in replicates 1-20 as below, so
        // replicate 3 differs from replicate 1 and from the original alignment, and so on. A run
        // of k replicates repeats the first k of the seeded stream, so its support is the share of
        // ones in the first k digits.
        let mut hits = 0u32;
        for (k, digit) in "11001101111011111000".bytes().enumerate() {
            hits += u32::from(digit == b'1');
            let reps = k as u32 + 1;
            let r = construct_phylogenetic_tree(&names, &seqs, "Neighbor-Joining (NJ)", "Jukes-Cantor (JC69)", reps as usize);
            let got = r.clade_bootstraps.iter().find(|c| c.clade_label == "C, D").expect("C,D clade").support_pct;
            assert_eq!(got, (f64::from(hits * 100) / f64::from(reps)).round() as u32, "C,D support after {reps} replicates");
        }
        assert!(rep.log_likelihood < 0.0);
        assert!(rep.method_note.contains("Neighbor-Joining"));

        let u = analyze_user_tree(&rep.newick, &names, &seqs);
        assert!((u.ml_log_likelihood - rep.log_likelihood).abs() < 1e-9);
        assert_eq!(u.parsimony_length_steps, rep.parsimony_steps);
        assert!(u.ols_r_squared > 0.9, "{}", u.ols_r_squared);
        assert!(u.duplication_nodes.is_empty());

        // A topology that breaks the A+B clade must be worse by parsimony.
        let bad = analyze_user_tree("((A:0.1,C:0.1):0.1,(B:0.1,D:0.1):0.1,E:0.1);", &names, &seqs);
        assert!(bad.parsimony_length_steps > u.parsimony_length_steps);
        // Unknown tips are reported, not silently scored.
        let err = analyze_user_tree("((A,B),(C,X));", &names, &seqs);
        assert!(err.ml_log_likelihood.is_nan() && err.notes[0].contains("'X'"));
    }
}

#[cfg(test)]
mod jackknife_tests {
    use super::*;

    #[test]
    fn jackknife_runs_and_says_so() {
        let names: Vec<String> = ["A", "B", "C", "D", "E"].iter().map(|s| s.to_string()).collect();
        let seqs: Vec<String> = [
            "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT",
            "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGA",
            "ACGTACGAACGTTCGTACGTACCTACGTACGAACGTTCGT",
            "ACGTACGAACGTTCGTACGTACCTACGTACGAACGTTCGA",
            "TCGAACGAACGTTGGTACCTACCTACGAACGAACGTTGGA",
        ].iter().map(|s| s.to_string()).collect();
        let r = construct_phylogenetic_tree_with_resampling(&names, &seqs, "Neighbor-Joining (NJ)", "Jukes-Cantor (JC69)", 100, Some(50.0));
        assert_eq!(r.bootstrap_replicates, 100);
        assert!(r.method_note.contains("Jackknife: 100 replicates, each keeping 50%"), "{}", r.method_note);
        assert!(r.clade_bootstraps.iter().any(|c| c.support_pct > 0));
        let b = construct_phylogenetic_tree(&names, &seqs, "Neighbor-Joining (NJ)", "Jukes-Cantor (JC69)", 100);
        assert!(b.method_note.contains("Bootstrap: 100"));
    }
}
