// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Maximum-likelihood tree search: Neighbor-Joining
//! starting tree, model parameters fitted on it, nearest-neighbour-interchange hill climbing
//! with branch lengths re-optimised after every accepted move, and a final joint fit of
//! branch lengths and model parameters. Nucleotide data, GTR-family models with optional
//! discrete Γ (4 categories) and invariable sites.

use crate::likelihood::{Engine, Family, LkNode, LkTree, ModelSpec, NucModel, Patterns};
use crate::trees::{is_nucleotide_alignment, nj_likelihood_tree};
use molbiocraft_align::sanitize_newick_label;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlSearchReport {
    pub newick: String,
    pub model: String,
    #[serde(rename = "logLikelihood")]
    pub log_likelihood: f64,
    #[serde(rename = "startLogLikelihood")]
    pub start_log_likelihood: f64,
    #[serde(rename = "nniSwaps")]
    pub nni_swaps: usize,
    #[serde(rename = "nniRounds")]
    pub nni_rounds: usize,
    #[serde(rename = "nniEvaluated")]
    pub nni_evaluated: usize,
    #[serde(rename = "treeLength")]
    pub tree_length: f64,
    /// Fitted parameters, e.g. "Ts/Tv = 3.21; Γ α = 0.52; π(A,C,G,T) = …".
    pub parameters: String,
}

/// "GTR+G+I", "HKY+G", "K2", "JC", "T92", "TN93" (case-insensitive).
pub fn parse_model(name: &str) -> Option<ModelSpec> {
    let up = name.to_ascii_uppercase();
    let base = up.split('+').next().unwrap_or("").trim();
    let family = match base {
        "JC" | "JC69" => Family::Jc69,
        "K2" | "K2P" | "K80" => Family::K2p,
        "T92" => Family::T92,
        "HKY" | "HKY85" => Family::Hky,
        "TN93" | "TN" => Family::Tn93,
        "GTR" => Family::Gtr,
        _ => return None,
    };
    let gamma = up.contains("+G");
    let invariant = up.contains("+I");
    Some(ModelSpec { family, gamma, invariant, n_cat: if gamma { 4 } else { 1 } })
}

/// Rebuilds the tree from `new_root` (dropping unreachable nodes) with fresh, contiguous ids.
fn reindex(nodes: &[LkNode], adj: &[Vec<(usize, f64)>], new_root: usize) -> LkTree {
    let mut out: Vec<LkNode> = Vec::with_capacity(nodes.len());
    let mut stack = vec![(new_root, usize::MAX, None::<usize>, 0.0)];
    while let Some((v, from, parent, t)) = stack.pop() {
        let id = out.len();
        out.push(LkNode { parent, children: Vec::new(), taxon: nodes[v].taxon, t });
        if let Some(p) = parent {
            out[p].children.push(id);
        }
        for &(w, len) in adj[v].iter().rev() {
            if w != from {
                stack.push((w, v, Some(id), len));
            }
        }
    }
    LkTree { nodes: out, root: 0 }
}

/// Turns a bifurcating root into a trifurcation (the rooted position has no meaning under a
/// reversible model, and NNI needs every internal edge to be a real edge).
pub fn unroot(tree: &LkTree) -> LkTree {
    let r = tree.root;
    let n = tree.nodes.len();
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for (v, node) in tree.nodes.iter().enumerate() {
        for &c in &node.children {
            adj[v].push((c, tree.nodes[c].t));
            adj[c].push((v, tree.nodes[c].t));
        }
    }
    if tree.nodes[r].children.len() == 2 {
        let (a, b) = (tree.nodes[r].children[0], tree.nodes[r].children[1]);
        let len = tree.nodes[a].t + tree.nodes[b].t;
        adj[a].retain(|&(w, _)| w != r);
        adj[b].retain(|&(w, _)| w != r);
        adj[r].clear();
        adj[a].push((b, len));
        adj[b].push((a, len));
        let new_root = if !tree.nodes[a].children.is_empty() { a } else { b };
        return reindex(&tree.nodes, &adj, new_root);
    }
    reindex(&tree.nodes, &adj, r)
}

pub(crate) fn newick_of(tree: &LkTree, labels: &[String]) -> String {
    fn rec(t: &LkTree, v: usize, labels: &[String], out: &mut String) {
        let node = &t.nodes[v];
        if node.children.is_empty() {
            out.push_str(node.taxon.and_then(|i| labels.get(i)).map(String::as_str).unwrap_or("?"));
        } else {
            out.push('(');
            for (i, &c) in node.children.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                rec(t, c, labels, out);
            }
            out.push(')');
        }
        if node.parent.is_some() {
            out.push_str(&format!(":{:.6}", node.t.max(0.0)));
        }
    }
    let mut s = String::new();
    rec(tree, tree.root, labels, &mut s);
    s.push(';');
    s
}

/// Sanitised tip labels; repeated names get "_2", "_3", …
pub fn unique_labels(names: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashMap::new();
    names
        .iter()
        .map(|n| {
            let base = sanitize_newick_label(n);
            let k = seen.entry(base.clone()).or_insert(0usize);
            *k += 1;
            if *k == 1 { base } else { format!("{base}_{k}") }
        })
        .collect()
}

pub fn ml_tree_search(names: &[String], seqs: &[String], model: &str) -> Result<MlSearchReport, String> {
    let n = names.len().min(seqs.len());
    if n < 4 {
        return Err("Maximum-likelihood search needs at least 4 sequences.".into());
    }
    if !is_nucleotide_alignment(&seqs[..n]) {
        // proteins: empirical amino-acid models (LG / WAG / JTT); nucleotide model names map to LG
        let up = model.to_ascii_uppercase();
        let aa = if up.starts_with("WAG") || up.starts_with("JTT") || up.starts_with("LG") { model.to_string() } else { format!("LG{}", if up.contains("+G") { "+G" } else { "" }) };
        return crate::protein_ml::protein_ml_tree_search(names, seqs, &aa);
    }
    let w = seqs[0].len();
    if seqs[..n].iter().any(|s| s.len() != w) {
        return Err("Sequences must be aligned (equal length).".into());
    }
    let spec = parse_model(model).ok_or_else(|| format!("Unknown model \"{model}\"."))?;
    let start = nj_likelihood_tree(&names[..n], &seqs[..n], "Tamura-Nei (TN93)")
        .or_else(|| nj_likelihood_tree(&names[..n], &seqs[..n], "p-distance"))
        .ok_or("Could not build a starting tree (some pairwise distances are undefined).")?;
    let tree = unroot(&start);
    let pats = Patterns::from_alignment(&seqs[..n]);
    let nuc = NucModel::new(spec, pats.base_frequencies());
    let mut eng = Engine::new(tree, &pats, nuc);
    let start_l = eng.fit(5);
    let (mut swaps, mut rounds, mut evaluated) = (0, 0, 0);
    let mut ln_l = start_l;
    for _ in 0..4 {
        let st = eng.nni_search(200);
        swaps += st.swaps;
        rounds += st.rounds;
        evaluated += st.evaluated;
        ln_l = eng.fit(3);
        if st.swaps == 0 {
            break;
        }
    }
    let m = &eng.model;
    let mut params = Vec::new();
    if spec.family != Family::Jc69 {
        params.push(format!("Ts/Tv = {:.3}", m.ts_tv_ratio()));
    }
    if spec.gamma {
        params.push(format!("Γ shape α = {:.3} (4 categories)", m.alpha));
    }
    if spec.invariant {
        params.push(format!("invariable sites = {:.3}", m.pinv));
    }
    params.push(format!("π(A, C, G, T) = {:.3}, {:.3}, {:.3}, {:.3}", m.pi[0], m.pi[1], m.pi[2], m.pi[3]));
    let labels = unique_labels(&names[..n]);
    Ok(MlSearchReport {
        newick: newick_of(&eng.tree, &labels),
        model: spec.name(),
        log_likelihood: (ln_l * 1000.0).round() / 1000.0,
        start_log_likelihood: (start_l * 1000.0).round() / 1000.0,
        nni_swaps: swaps,
        nni_rounds: rounds,
        nni_evaluated: evaluated,
        tree_length: eng.tree_length(),
        parameters: params.join("; "),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic sequences evolved down a known tree ((A,B),(C,D)),(E,F) with long
    /// internal branches, so the true topology is clear.
    fn simulated() -> (Vec<String>, Vec<String>) {
        let mut rng = molbiocraft_core::SplitMix64::new(7);
        let bases = [b'A', b'C', b'G', b'T'];
        let len = 600;
        let root: Vec<u8> = (0..len).map(|_| bases[(rng.next_u64() % 4) as usize]).collect();
        let mutate = |s: &[u8], p: f64, rng: &mut molbiocraft_core::SplitMix64| -> Vec<u8> {
            s.iter()
                .map(|&b| if (rng.next_u64() % 10_000) as f64 / 10_000.0 < p { bases[(rng.next_u64() % 4) as usize] } else { b })
                .collect()
        };
        let x = mutate(&root, 0.15, &mut rng);
        let y = mutate(&root, 0.15, &mut rng);
        let ab = mutate(&x, 0.12, &mut rng);
        let cd = mutate(&x, 0.12, &mut rng);
        let ef = y.clone();
        let seqs = [
            mutate(&ab, 0.05, &mut rng),
            mutate(&ab, 0.05, &mut rng),
            mutate(&cd, 0.05, &mut rng),
            mutate(&cd, 0.05, &mut rng),
            mutate(&ef, 0.05, &mut rng),
            mutate(&ef, 0.05, &mut rng),
        ];
        let names = ["A", "B", "C", "D", "E", "F"].iter().map(|s| s.to_string()).collect();
        (names, seqs.iter().map(|s| String::from_utf8(s.clone()).unwrap()).collect())
    }

    /// A Felsenstein-zone quartet: the unrooted tree ((A,B),(C,D)) with long pendant branches to
    /// A and C (1.0 substitutions/site), short ones to B and D (0.05) and a short internal branch
    /// (0.1), evolved under JC69 with four equal-probability Γ rate categories for α = 0.5 (the
    /// category means 0.0334, 0.2519, 0.8203, 2.8944 are Yang's 1994 table, typed in, not
    /// computed by `discrete_gamma_rates`). Distances that ignore rate variation - the TN93
    /// distances of the NJ starting tree - underestimate the two long paths, so NJ joins A with C
    /// (long-branch attraction, Felsenstein 1978), while ML under a Γ model is consistent here:
    /// the search can only recover the generating tree by moving off its starting tree.
    fn felsenstein_zone(seed: u64) -> (Vec<String>, Vec<String>) {
        let mut rng = molbiocraft_core::SplitMix64::new(seed);
        let bases = [b'A', b'C', b'G', b'T'];
        let rates = [0.0334, 0.2519, 0.8203, 2.8944];
        // JC69 along a branch of length t at rate r: with probability 1 - exp(-4rt/3) the base is
        // replaced by a uniformly drawn one (possibly itself), so P(unchanged) = 1/4 + 3/4 exp(-4rt/3).
        let evolve = |b: u8, r: f64, t: f64, rng: &mut molbiocraft_core::SplitMix64| -> u8 {
            if rng.next_f64() < 1.0 - (-4.0 / 3.0 * r * t).exp() { bases[(rng.next_u64() % 4) as usize] } else { b }
        };
        let mut seqs = vec![Vec::new(); 4];
        for _ in 0..2000 {
            let r = rates[(rng.next_u64() % 4) as usize];
            let x = bases[(rng.next_u64() % 4) as usize]; // the (A,B) end of the internal branch
            let y = evolve(x, r, 0.1, &mut rng); // the (C,D) end
            seqs[0].push(evolve(x, r, 1.0, &mut rng));
            seqs[1].push(evolve(x, r, 0.05, &mut rng));
            seqs[2].push(evolve(y, r, 1.0, &mut rng));
            seqs[3].push(evolve(y, r, 0.05, &mut rng));
        }
        let names = ["A", "B", "C", "D"].iter().map(|s| s.to_string()).collect();
        (names, seqs.into_iter().map(|s| String::from_utf8(s).unwrap()).collect())
    }

    fn splits(newick: &str) -> Vec<String> {
        // clades as sorted tip sets, from the parenthesis structure
        let mut stack: Vec<Vec<String>> = vec![Vec::new()];
        let mut out = Vec::new();
        let mut name = String::new();
        let mut in_len = false;
        for ch in newick.chars() {
            match ch {
                '(' => stack.push(Vec::new()),
                ',' | ')' | ';' => {
                    if !name.is_empty() {
                        stack.last_mut().unwrap().push(name.clone());
                        name.clear();
                    }
                    in_len = false;
                    if ch == ')' {
                        let mut clade = stack.pop().unwrap();
                        clade.sort();
                        out.push(clade.join(""));
                        stack.last_mut().unwrap().extend(clade);
                    }
                }
                ':' => in_len = true,
                _ if !in_len => name.push(ch),
                _ => {}
            }
        }
        out
    }

    #[test]
    fn model_names_parse() {
        let m = parse_model("gtr+g+i").unwrap();
        assert_eq!(m.family, Family::Gtr);
        assert!(m.gamma && m.invariant && m.n_cat == 4);
        assert_eq!(parse_model("K2").unwrap().family, Family::K2p);
        assert!(parse_model("WAG").is_none());
    }

    #[test]
    fn unroot_makes_a_trifurcation_and_keeps_length() {
        let (names, seqs) = simulated();
        let t = nj_likelihood_tree(&names, &seqs, "Tamura-Nei (TN93)").unwrap();
        let total: f64 = t.nodes.iter().enumerate().filter(|(i, _)| *i != t.root).map(|(_, n)| n.t).sum();
        let u = unroot(&t);
        assert_eq!(u.nodes[u.root].children.len(), 3);
        assert_eq!(u.nodes.len(), t.nodes.len() - 1);
        let total_u: f64 = u.nodes.iter().enumerate().filter(|(i, _)| *i != u.root).map(|(_, n)| n.t).sum();
        assert!((total - total_u).abs() < 1e-9);
    }

    #[test]
    fn search_recovers_the_simulated_tree_and_never_lowers_likelihood() {
        let (names, seqs) = simulated();
        let r = ml_tree_search(&names, &seqs, "HKY+G").unwrap();
        assert!(r.log_likelihood >= r.start_log_likelihood - 1e-6, "{r:?}");
        let s = splits(&r.newick);
        // the unrooted tree must contain the AB and CD clades (or their complements) and EF
        let has = |a: &str, b: &str| s.iter().any(|x| x == a) || s.iter().any(|x| x == b);
        assert!(has("AB", "CDEF"), "{}", r.newick);
        assert!(has("CD", "ABEF"), "{}", r.newick);
        assert!(has("EF", "ABCD"), "{}", r.newick);

        // The fixture above is already resolved by the NJ starting tree, so it cannot tell a
        // search from no search. In the Felsenstein zone the start tree is wrong, and the
        // reported tree must be the generating one, reached by at least one NNI swap.
        for seed in 1..=3u64 {
            let (names, seqs) = felsenstein_zone(seed);
            let start = nj_likelihood_tree(&names, &seqs, "Tamura-Nei (TN93)").unwrap();
            let s0 = splits(&newick_of(&start, &names));
            let joined = |a: &str, b: &str| s0.iter().any(|x| x == a || x == b);
            assert!(joined("AC", "BD") && !joined("AB", "CD"), "seed {seed}: NJ start tree {s0:?} is not the long-branch-attraction tree");
            let r = ml_tree_search(&names, &seqs, "HKY+G").unwrap();
            let s = splits(&r.newick);
            assert!(s.iter().any(|x| x == "AB" || x == "CD"), "seed {seed}: {}", r.newick);
            assert!(r.nni_swaps >= 1, "seed {seed}: {r:?}");
            assert!(r.log_likelihood > r.start_log_likelihood, "seed {seed}: {r:?}");
        }
    }

    #[test]
    fn nni_escapes_a_wrong_starting_tree() {
        let (names, seqs) = simulated();
        let pats = Patterns::from_alignment(&seqs);
        let spec = parse_model("JC").unwrap();
        // wrong tree: ((A,C),(B,E),(D,F)) as a trifurcating root
        let mut nodes: Vec<LkNode> = Vec::new();
        let mut node = |parent: Option<usize>, taxon: Option<usize>| {
            nodes.push(LkNode { parent, children: Vec::new(), taxon, t: 0.1 });
            nodes.len() - 1
        };
        let r = node(None, None);
        let i1 = node(Some(r), None);
        let i2 = node(Some(r), None);
        let i3 = node(Some(r), None);
        let leaves = [(i1, 0), (i1, 2), (i2, 1), (i2, 4), (i3, 3), (i3, 5)];
        let mut ids = Vec::new();
        for (p, t) in leaves {
            ids.push((p, node(Some(p), Some(t))));
        }
        drop(node);
        nodes[r].children = vec![i1, i2, i3];
        for (p, c) in ids {
            nodes[p].children.push(c);
        }
        let mut eng = Engine::new(LkTree { nodes, root: r }, &pats, NucModel::new(spec, [0.25; 4]));
        let before = eng.fit(2);
        let st = eng.nni_search(50);
        let after = eng.fit(2);
        assert!(st.swaps >= 1);
        assert!(after > before + 1.0, "{before} -> {after}");
        let s = splits(&newick_of(&eng.tree, &names));
        let has = |a: &str, b: &str| s.iter().any(|x| x == a) || s.iter().any(|x| x == b);
        assert!(has("AB", "CDEF") && has("CD", "ABEF") && has("EF", "ABCD"), "{s:?}");
    }
}
