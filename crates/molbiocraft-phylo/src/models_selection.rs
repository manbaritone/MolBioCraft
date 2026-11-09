// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Maximum-likelihood model selection (24 GTR-family models, BIC/AICc), marginal ML and Fitch
//! parsimony ancestral reconstruction, Nei–Gojobori dN/dS with bootstrap Z-tests, Tajima's D,
//! empirical-Bayes discrete-Γ site rates, the ML molecular-clock likelihood-ratio test with a
//! strict-clock timetree, Tajima's relative-rate test, and alignment-based missense diagnosis
//! (Grantham 1974, BLOSUM62).
//!
//! All likelihoods come from [`crate::likelihood`] on the Neighbor-Joining topology with
//! ML-optimised branch lengths, every candidate model fitted on that one topology.

use crate::distances::translate_standard_codon;
use crate::likelihood::{Engine, Family, LkTree, ModelSpec, NucModel, Patterns};
use crate::trees::{is_nucleotide_alignment, nj_likelihood_tree};
use bio::scores::blosum62::blosum62;
use molbiocraft_core::SplitMix64;
use serde::{Deserialize, Serialize};
use statrs::distribution::{ChiSquared, ContinuousCDF, Normal};

fn r(v: f64, dp: i32) -> f64 {
    let f = 10f64.powi(dp);
    (v * f).round() / f
}

fn placeholder_names(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("T{i}")).collect()
}

/// NJ (JC69 distances) starting tree; falls back to p-distance when JC69 saturates.
fn starting_tree(names: &[String], seqs: &[String]) -> Option<LkTree> {
    nj_likelihood_tree(names, seqs, "Jukes-Cantor (JC69)").or_else(|| nj_likelihood_tree(names, seqs, "p-distance"))
}

fn fit_model(tree: LkTree, pats: &Patterns, spec: ModelSpec) -> Engine<'_> {
    let model = NucModel::new(spec, pats.base_frequencies());
    let mut e = Engine::new(tree, pats, model);
    e.fit(40);
    e
}

// ============================================================================
// 1. Model selection
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelectionRankingRow {
    pub model: String,
    pub parameters_k: usize,
    pub log_likelihood: f64,
    pub bic: f64,
    pub aicc: f64,
    pub aic: f64,
    pub gamma_shape_alpha: String,
    pub invariant_sites_i: String,
    pub ti_tv_ratio_r: f64,
}

const FAMILIES: [Family; 6] = [Family::Gtr, Family::Tn93, Family::Hky, Family::T92, Family::K2p, Family::Jc69];

/// Best-fit DNA model search (ML): every model is fitted by ML on the same NJ topology
/// (branch lengths and model parameters optimised; Γ with 4 categories) and ranked by BIC.
/// The parameter count is 2n−3 branch lengths plus the model's free parameters.
/// Returns an empty list for non-nucleotide alignments or fewer than three sequences.
pub fn find_best_substitution_models(aligned_seqs: &[String]) -> Vec<ModelSelectionRankingRow> {
    let n = aligned_seqs.len();
    if n < 3 {
        return Vec::new();
    }
    if !is_nucleotide_alignment(aligned_seqs) {
        return find_best_protein_models(aligned_seqs);
    }
    let names = placeholder_names(n);
    let Some(tree0) = starting_tree(&names, aligned_seqs) else { return Vec::new() };
    let pats = Patterns::from_alignment(aligned_seqs);
    // Sites with data in at least one sequence count as the sample size.
    let n_sites = pats
        .cols
        .iter()
        .zip(&pats.weights)
        .filter(|(c, _)| c.iter().any(|&m| m != 15))
        .map(|(_, w)| *w)
        .sum::<f64>()
        .max(1.0);

    let pi = pats.base_frequencies();
    let spec_of = |family, gamma, invariant| ModelSpec { family, gamma, invariant, n_cat: if gamma { 4 } else { 1 } };
    let run = |tree: &LkTree, model: NucModel| {
        let mut e = Engine::new(tree.clone(), &pats, model);
        let l = e.fit_to(40, 0.01);
        (l, e.tree.clone(), e.model.clone())
    };
    let mut rows = Vec::with_capacity(24);
    let mut push = |spec: ModelSpec, ln_l: f64, model: &NucModel| {
        let k = (2 * n - 3) + spec.free_params();
        let kf = k as f64;
        let aic = 2.0 * kf - 2.0 * ln_l;
        let aicc = if n_sites - kf - 1.0 > 0.0 { aic + 2.0 * kf * (kf + 1.0) / (n_sites - kf - 1.0) } else { f64::NAN };
        rows.push(ModelSelectionRankingRow {
            model: spec.name(),
            parameters_k: k,
            log_likelihood: r(ln_l, 3),
            bic: r(kf * n_sites.ln() - 2.0 * ln_l, 3),
            aicc: r(aicc, 3),
            aic: r(aic, 3),
            gamma_shape_alpha: if spec.gamma { format!("{:.4}", model.alpha) } else { "n/a".into() },
            invariant_sites_i: if spec.invariant { format!("{:.4}", model.pinv) } else { "n/a".into() },
            ti_tv_ratio_r: r(model.ts_tv_ratio(), 3),
        });
    };
    // Simplest to richest so every fit is warm-started from a nested special case; the +G+I fit
    // starts from both the +G and the +I optimum, so it is never worse than either.
    let mut prev_tree = tree0;
    let mut prev_model: Option<NucModel> = None;
    for fam in FAMILIES.iter().rev().copied() {
        let base_spec = spec_of(fam, false, false);
        let seed = |spec: ModelSpec, from: &Option<NucModel>, pinv: f64| match from {
            Some(m) => NucModel::seeded_from(spec, pi, m, pinv),
            None => NucModel::new(spec, pi),
        };
        let (l0, t0, m0) = run(&prev_tree, seed(base_spec, &prev_model, 0.0));
        push(base_spec, l0, &m0);
        let g_spec = spec_of(fam, true, false);
        let (lg, tg, mg) = run(&t0, NucModel::seeded_from(g_spec, pi, &m0, 0.0));
        push(g_spec, lg, &mg);
        let i_spec = spec_of(fam, false, true);
        let (li, ti, mi) = run(&t0, NucModel::seeded_from(i_spec, pi, &m0, 0.05));
        push(i_spec, li, &mi);
        let gi_spec = spec_of(fam, true, true);
        let (la, _, ma) = run(&tg, NucModel::seeded_from(gi_spec, pi, &mg, 0.001));
        let mut from_i = NucModel::seeded_from(gi_spec, pi, &mi, mi.pinv);
        from_i.set_params(&{
            let mut p = from_i.params();
            let ai = p.len() - 2;
            p[ai] = (999.0f64).ln(); // +I is the α → ∞ limit of +G+I
            p
        });
        let (lb, _, mb) = run(&ti, from_i);
        if la >= lb {
            push(gi_spec, la, &ma);
        } else {
            push(gi_spec, lb, &mb);
        }
        prev_tree = t0;
        prev_model = Some(m0);
    }
    rows.sort_by(|a, b| a.bic.partial_cmp(&b.bic).unwrap_or(std::cmp::Ordering::Equal));
    rows
}

/// Protein alignments: LG, WAG and JTT, each with and without Γ (4 categories), fitted by ML on
/// the NJ (Poisson) topology and ranked by BIC. The empirical models have no free rate or
/// frequency parameters; +G adds one.
fn find_best_protein_models(aligned_seqs: &[String]) -> Vec<ModelSelectionRankingRow> {
    use crate::protein_ml::{AaEngine, AaModel, AaPatterns};
    let n = aligned_seqs.len();
    let names = placeholder_names(n);
    let Some(tree0) = nj_likelihood_tree(&names, aligned_seqs, "Jukes-Cantor (JC69)") else { return Vec::new() };
    let tree0 = crate::ml_search::unroot(&tree0);
    let pats = AaPatterns::from_alignment(aligned_seqs);
    let n_sites = pats.weights.iter().sum::<f64>().max(1.0);
    let mut rows = Vec::new();
    for spec in ["LG", "LG+G", "WAG", "WAG+G", "JTT", "JTT+G"] {
        let Some(m) = AaModel::parse(spec) else { continue };
        let gamma = m.gamma;
        let mut e = AaEngine::new(tree0.clone(), &pats, m);
        let ln_l = e.fit(10, 0.01);
        let k = (2 * n - 3) + usize::from(gamma);
        let kf = k as f64;
        let aic = 2.0 * kf - 2.0 * ln_l;
        let aicc = if n_sites - kf - 1.0 > 0.0 { aic + 2.0 * kf * (kf + 1.0) / (n_sites - kf - 1.0) } else { f64::NAN };
        rows.push(ModelSelectionRankingRow {
            model: spec.to_string(),
            parameters_k: k,
            log_likelihood: r(ln_l, 3),
            bic: r(kf * n_sites.ln() - 2.0 * ln_l, 3),
            aicc: r(aicc, 3),
            aic: r(aic, 3),
            gamma_shape_alpha: if gamma { format!("{:.4}", e.model.alpha) } else { "n/a".into() },
            invariant_sites_i: "n/a".into(),
            ti_tv_ratio_r: f64::NAN,
        });
    }
    rows.sort_by(|a, b| a.bic.partial_cmp(&b.bic).unwrap_or(std::cmp::Ordering::Equal));
    rows
}

// ============================================================================
// 2. Ancestral sequence reconstruction
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AncestralNodeRow {
    pub node_name: String,
    pub descendants: String,
    pub ancestral_sequence: String,
    pub mean_posterior_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteEvolutionaryProbability {
    pub position: usize,
    #[serde(rename = "consensusState")]
    pub consensus_state: String,
    #[serde(rename = "probA")]
    pub prob_a: f64,
    #[serde(rename = "probC")]
    pub prob_c: f64,
    #[serde(rename = "probG")]
    pub prob_g: f64,
    #[serde(rename = "probT")]
    pub prob_t: f64,
    #[serde(rename = "ancestralStateRoot")]
    pub ancestral_state_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AncestralReconstructionReport {
    pub method: String,
    /// Every internal node of the tree, root first (preorder).
    pub nodes: Vec<AncestralNodeRow>,
    /// Every alignment column, in order.
    pub site_evolutionary_probabilities: Vec<SiteEvolutionaryProbability>,
    /// How many internal nodes the tree has: the length of the complete `nodes` list.
    #[serde(default)]
    pub total_internal_nodes: usize,
    /// How many columns the alignment has: the length of the complete per-site list.
    #[serde(default)]
    pub total_sites: usize,
}

const BASES: [char; 4] = ['A', 'C', 'G', 'T'];

fn majority_state(col: &[u8]) -> String {
    let mut c = [0usize; 4];
    for &m in col {
        if m.count_ones() == 1 {
            c[m.trailing_zeros() as usize] += 1;
        }
    }
    let (i, &best) = c.iter().enumerate().max_by_key(|(_, v)| **v).unwrap();
    if best == 0 { "-".into() } else { BASES[i].to_string() }
}

fn describe_clade(names: &[String], taxa: &[usize]) -> String {
    taxa.iter().map(|&t| names[t].as_str()).collect::<Vec<_>>().join(", ")
}

/// Ancestral states at every internal node of the NJ tree.
///
/// * ML (default): marginal reconstruction (Yang, Kumar & Nei 1995) under TN93+G (4 categories)
///   with ML branch lengths; confidence is the mean posterior of the most probable state.
/// * Parsimony (`method` contains "Parsimony"): Fitch (1971) down-pass sets with the standard
///   top-down resolution; "confidence" is the percentage of sites whose state set is unique.
pub fn infer_ancestral_sequences(names: &[String], aligned_seqs: &[String], method: &str) -> AncestralReconstructionReport {
    let n = names.len().min(aligned_seqs.len());
    let empty = |m: String| AncestralReconstructionReport {
        method: m,
        nodes: Vec::new(),
        site_evolutionary_probabilities: Vec::new(),
        total_internal_nodes: 0,
        total_sites: 0,
    };
    if n < 3 || !is_nucleotide_alignment(&aligned_seqs[..n]) {
        return empty(format!("{method}: needs ≥ 3 aligned nucleotide sequences"));
    }
    let (names, seqs) = (&names[..n], &aligned_seqs[..n]);
    let Some(tree) = starting_tree(names, seqs) else {
        return empty(format!("{method}: pairwise distances are undefined (no shared sites)"));
    };
    let pats = Patterns::from_alignment(seqs);
    let parsimony = method.to_ascii_lowercase().contains("parsimony");

    // Per node, per pattern: posterior (ML) or uniform-over-Fitch-set (MP) state probabilities.
    let (tree, node_probs, label): (LkTree, Vec<Vec<[f64; 4]>>, String) = if parsimony {
        let probs = fitch_reconstruction(&tree, &pats);
        (tree, probs, "Maximum Parsimony (Fitch 1971) on the NJ tree".into())
    } else {
        let spec = ModelSpec { family: Family::Tn93, gamma: true, invariant: false, n_cat: 4 };
        let e = fit_model(tree, &pats, spec);
        let probs = e.marginal_states();
        let label = format!(
            "Maximum Likelihood marginal reconstruction, TN93+G (α = {:.3}), NJ topology with ML branch lengths, lnL = {:.2}",
            e.model.alpha,
            e.log_likelihood()
        );
        (e.tree.clone(), probs, label)
    };

    let all_missing: Vec<bool> = pats.cols.iter().map(|c| c.iter().all(|&m| m == 15)).collect();
    // Every internal node is listed: the states of all of them are already computed above, and a
    // row is one pass over the sites.
    let internal: Vec<usize> = tree.preorder().into_iter().filter(|&v| !tree.nodes[v].children.is_empty()).collect();
    let total_internal_nodes = internal.len();
    let nodes = internal
        .iter()
        .enumerate()
        .map(|(k, &v)| {
            let mut seq = String::with_capacity(pats.n_sites);
            let mut conf = 0.0;
            let mut counted = 0.0;
            for &p in &pats.site_pattern {
                if all_missing[p] {
                    seq.push('-');
                    continue;
                }
                let pr = node_probs[v][p];
                let (i, &best) = pr.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap();
                seq.push(BASES[i]);
                conf += if parsimony { if best > 0.999 { 1.0 } else { 0.0 } } else { best };
                counted += 1.0;
            }
            let taxa = tree.leaves_below(v);
            AncestralNodeRow {
                node_name: if v == tree.root { "Root (midpoint-rooted NJ tree)".into() } else { format!("Node {}", k + 1) },
                descendants: describe_clade(names, &taxa),
                ancestral_sequence: seq,
                mean_posterior_confidence: if counted > 0.0 { r(100.0 * conf / counted, 1) } else { f64::NAN },
            }
        })
        .collect();

    let root = tree.root;
    let site_evolutionary_probabilities: Vec<SiteEvolutionaryProbability> = pats
        .site_pattern
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            let pr = node_probs[root][p];
            let (bi, _) = pr.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap();
            SiteEvolutionaryProbability {
                position: i + 1,
                consensus_state: majority_state(&pats.cols[p]),
                prob_a: r(pr[0], 3),
                prob_c: r(pr[1], 3),
                prob_g: r(pr[2], 3),
                prob_t: r(pr[3], 3),
                ancestral_state_root: if all_missing[p] { "-".into() } else { BASES[bi].to_string() },
            }
        })
        .collect();

    AncestralReconstructionReport {
        method: label,
        nodes,
        site_evolutionary_probabilities,
        total_internal_nodes,
        total_sites: pats.site_pattern.len(),
    }
}

fn fitch_reconstruction(tree: &LkTree, pats: &Patterns) -> Vec<Vec<[f64; 4]>> {
    let nn = tree.nodes.len();
    let np = pats.len();
    let mut down = vec![vec![15u8; np]; nn];
    for v in tree.postorder() {
        let node = &tree.nodes[v];
        if node.children.is_empty() {
            if let Some(t) = node.taxon {
                for p in 0..np {
                    down[v][p] = pats.cols[p][t];
                }
            }
            continue;
        }
        for p in 0..np {
            let mut set = 15u8;
            let mut first = true;
            for &c in &node.children {
                let cs = down[c][p];
                if first {
                    set = cs;
                    first = false;
                } else if set & cs != 0 {
                    set &= cs;
                } else {
                    set |= cs;
                }
            }
            down[v][p] = set;
        }
    }
    // Top-down: keep the parent's state when the node's set allows it.
    let mut fin = down.clone();
    for v in tree.preorder() {
        if let Some(par) = tree.nodes[v].parent {
            for p in 0..np {
                let ps = fin[par][p];
                if ps.count_ones() == 1 && down[v][p] & ps != 0 {
                    fin[v][p] = ps;
                }
            }
        }
    }
    fin.iter()
        .map(|row| {
            row.iter()
                .map(|&m| {
                    let k = m.count_ones() as f64;
                    let mut out = [0.0; 4];
                    for (s, o) in out.iter_mut().enumerate() {
                        if m >> s & 1 == 1 {
                            *o = 1.0 / k;
                        }
                    }
                    out
                })
                .collect()
        })
        .collect()
}

// ============================================================================
// 3. Selection (Nei–Gojobori) & Tajima's D
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZTestOutcome {
    pub z_stat: f64,
    pub p_value: f64,
    pub significant: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TajimaNeutralitySummary {
    #[serde(rename = "sampleSizeM")]
    pub sample_size_m: usize,
    #[serde(rename = "segregatingSitesS")]
    pub segregating_sites_s: usize,
    #[serde(rename = "psProportion")]
    pub ps_proportion: f64,
    #[serde(rename = "thetaWatterson")]
    pub theta_watterson: f64,
    #[serde(rename = "nucleotideDiversityPi")]
    pub nucleotide_diversity_pi: f64,
    #[serde(rename = "tajimaD")]
    pub tajima_d: f64,
    pub interpretation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodonSiteSelectionRow {
    #[serde(rename = "codonIndex")]
    pub codon_index: usize,
    #[serde(rename = "codonsObserved")]
    pub codons_observed: String,
    #[serde(rename = "aminoAcidsObserved")]
    pub amino_acids_observed: String,
    #[serde(rename = "dNMinusDS")]
    pub dn_minus_ds: f64,
    #[serde(rename = "selectionRegime")]
    pub selection_regime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionAndNeutralityReport {
    #[serde(rename = "dN")]
    pub dn: f64,
    #[serde(rename = "dS")]
    pub ds: f64,
    #[serde(rename = "omegaDnDs")]
    pub omega_dn_ds: f64,
    #[serde(rename = "zTestNeutrality")]
    pub z_test_neutrality: ZTestOutcome,
    #[serde(rename = "zTestPositive")]
    pub z_test_positive: ZTestOutcome,
    #[serde(rename = "zTestPurifying")]
    pub z_test_purifying: ZTestOutcome,
    #[serde(rename = "fisherExactPValue")]
    pub fisher_exact_p_value: f64,
    #[serde(rename = "tajimaNeutrality")]
    pub tajima_neutrality: TajimaNeutralitySummary,
    /// Every variable codon (two or more distinct A/C/G/T triplets), in alignment order.
    #[serde(rename = "codonSiteSelection")]
    pub codon_site_selection: Vec<CodonSiteSelectionRow>,
    /// How many codons are variable: the length of the complete `codon_site_selection` list.
    #[serde(rename = "totalVariableCodons", default)]
    pub total_variable_codons: usize,
    #[serde(default)]
    pub notes: Vec<String>,
}

fn clean_codon(s: &[u8]) -> Option<[u8; 3]> {
    if s.len() < 3 {
        return None;
    }
    let c = [s[0].to_ascii_uppercase(), s[1].to_ascii_uppercase(), s[2].to_ascii_uppercase()].map(|b| if b == b'U' { b'T' } else { b });
    if c.iter().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T')) {
        Some(c)
    } else {
        None
    }
}

fn aa(c: &[u8; 3]) -> &'static str {
    translate_standard_codon(std::str::from_utf8(c).unwrap_or("NNN"))
}

/// Nei & Gojobori (1986) synonymous and nonsynonymous sites of a sense codon, as PAML counts
/// them: each of the nine single-base changes adds 1/3 of a site to its class, changes to stop
/// codons add to neither (the pair's totals are then rescaled to 3 sites per codon, see
/// [`pair_codon_counts`]). This reproduces PAML yn00 / codeml NG86 dN and dS exactly.
fn ng_sites(c: &[u8; 3]) -> (f64, f64) {
    let a0 = aa(c);
    let (mut syn, mut non) = (0.0, 0.0);
    for pos in 0..3 {
        for alt in [b'A', b'C', b'G', b'T'] {
            if alt == c[pos] {
                continue;
            }
            let mut m = *c;
            m[pos] = alt;
            let a1 = aa(&m);
            if a1 == "*" {
                continue;
            }
            if a1 == a0 { syn += 1.0 } else { non += 1.0 }
        }
    }
    (syn / 3.0, non / 3.0)
}

#[cfg(test)]
fn ng_syn_sites(c: &[u8; 3]) -> f64 {
    ng_sites(c).0
}

/// Synonymous and nonsynonymous differences between two sense codons, averaged over all
/// mutational pathways that avoid stop codons (Nei & Gojobori 1986).
fn ng_differences(a: &[u8; 3], b: &[u8; 3]) -> (f64, f64) {
    let diff: Vec<usize> = (0..3).filter(|&i| a[i] != b[i]).collect();
    if diff.is_empty() {
        return (0.0, 0.0);
    }
    let perms: Vec<Vec<usize>> = match diff.len() {
        1 => vec![diff.clone()],
        2 => vec![vec![diff[0], diff[1]], vec![diff[1], diff[0]]],
        _ => vec![vec![0, 1, 2], vec![0, 2, 1], vec![1, 0, 2], vec![1, 2, 0], vec![2, 0, 1], vec![2, 1, 0]],
    };
    let (mut sd, mut nd, mut paths) = (0.0, 0.0, 0.0);
    for order in perms {
        let mut cur = *a;
        let (mut s, mut nn) = (0.0, 0.0);
        let mut ok = true;
        for &pos in &order {
            let mut next = cur;
            next[pos] = b[pos];
            let (x, y) = (aa(&cur), aa(&next));
            if y == "*" {
                ok = false;
                break;
            }
            if x == y {
                s += 1.0;
            } else {
                nn += 1.0;
            }
            cur = next;
        }
        if ok {
            sd += s;
            nd += nn;
            paths += 1.0;
        }
    }
    if paths == 0.0 {
        return (0.0, diff.len() as f64);
    }
    (sd / paths, nd / paths)
}

fn jc_from_p(p: f64) -> f64 {
    let x = 1.0 - 4.0 / 3.0 * p;
    if x <= 0.0 {
        f64::NAN
    } else {
        -0.75 * x.ln()
    }
}

/// Per-codon contributions for one sequence pair: (S, N, Sd, Nd).
type CodonCounts = Vec<Option<(f64, f64, f64, f64)>>;

fn pair_codon_counts(a: &[u8], b: &[u8], n_codons: usize) -> CodonCounts {
    let mut out: CodonCounts = (0..n_codons)
        .map(|k| {
            let (ca, cb) = (clean_codon(&a[3 * k..]), clean_codon(&b[3 * k..]));
            match (ca, cb) {
                (Some(x), Some(y)) if aa(&x) != "*" && aa(&y) != "*" => {
                    let (sx, nx) = ng_sites(&x);
                    let (sy, ny) = ng_sites(&y);
                    let (sd, nd) = ng_differences(&x, &y);
                    Some((0.5 * (sx + sy), 0.5 * (nx + ny), sd, nd))
                }
                _ => None,
            }
        })
        .collect();
    // rescale for the changes to stop codons that were not counted: S + N = 3 per codon (PAML)
    let (mut s, mut n, mut l) = (0.0, 0.0, 0.0);
    for (a, b, _, _) in out.iter().flatten() {
        s += a;
        n += b;
        l += 1.0;
    }
    if s + n > 0.0 {
        let y = 3.0 * l / (s + n);
        for c in out.iter_mut().flatten() {
            c.0 *= y;
            c.1 *= y;
        }
    }
    out
}

fn mean_dn_ds(pairs: &[CodonCounts], codons: &[usize]) -> (f64, f64) {
    let (mut dn, mut ds, mut m) = (0.0, 0.0, 0.0);
    for pc in pairs {
        let (mut s, mut nn, mut sd, mut nd) = (0.0, 0.0, 0.0, 0.0);
        for &k in codons {
            if let Some((a, b, c, d)) = pc[k] {
                s += a;
                nn += b;
                sd += c;
                nd += d;
            }
        }
        if s <= 0.0 || nn <= 0.0 {
            continue;
        }
        dn += jc_from_p(nd / nn);
        ds += jc_from_p(sd / s);
        m += 1.0;
    }
    if m == 0.0 {
        (f64::NAN, f64::NAN)
    } else {
        (dn / m, ds / m)
    }
}

fn ln_factorial(n: u64) -> f64 {
    statrs::function::factorial::ln_factorial(n)
}

/// One-tailed Fisher exact P that nonsynonymous changes are in excess (Zhang, Kumar & Nei 1997).
/// Table rows: changed (Sd, Nd) and unchanged (S−Sd, N−Nd); P(X ≥ Nd) with all margins fixed.
fn fisher_positive_selection(sd: u64, nd: u64, s_same: u64, n_same: u64) -> f64 {
    let ln_choose = |n: u64, k: u64| ln_factorial(n) - ln_factorial(k) - ln_factorial(n - k);
    let changed = sd + nd;
    let col_n = nd + n_same;
    let col_s = sd + s_same;
    let total = col_n + col_s;
    let lo = nd;
    let hi = changed.min(col_n);
    (lo..=hi)
        .filter(|&x| changed - x <= col_s)
        .map(|x| (ln_choose(col_n, x) + ln_choose(col_s, changed - x) - ln_choose(total, changed)).exp())
        .sum::<f64>()
        .min(1.0)
}

/// Codon-based selection tests and Tajima's (1989) D.
///
/// dN and dS are Nei–Gojobori (1986) proportions with the Jukes–Cantor correction, averaged over
/// all sequence pairs (pairwise deletion of codons with gaps, ambiguity or stops). Z-tests use the
/// bootstrap variance of dN − dS over codons (500 replicates). Fisher's exact test is
/// applied to the pair-averaged counts. Per-codon rows give the pair-averaged pN − pS.
pub fn run_selection_and_neutrality_tests(aligned_seqs: &[String]) -> SelectionAndNeutralityReport {
    let m = aligned_seqs.len();
    let mut notes = Vec::new();
    let tajima = tajima_d(aligned_seqs);
    let nan_z = || ZTestOutcome { z_stat: f64::NAN, p_value: f64::NAN, significant: false };
    let len = aligned_seqs.iter().map(|s| s.len()).min().unwrap_or(0);
    let n_codons = len / 3;
    if m < 2 || n_codons == 0 || !is_nucleotide_alignment(aligned_seqs) {
        notes.push("Codon tests need ≥ 2 aligned nucleotide (coding) sequences.".into());
        return SelectionAndNeutralityReport {
            dn: f64::NAN,
            ds: f64::NAN,
            omega_dn_ds: f64::NAN,
            z_test_neutrality: nan_z(),
            z_test_positive: nan_z(),
            z_test_purifying: nan_z(),
            fisher_exact_p_value: f64::NAN,
            tajima_neutrality: tajima,
            codon_site_selection: Vec::new(),
            total_variable_codons: 0,
            notes,
        };
    }
    if len % 3 != 0 {
        notes.push(format!("Alignment length {len} is not a multiple of 3; the last {} column(s) are ignored. Codons are read from column 1.", len % 3));
    }
    let bytes: Vec<&[u8]> = aligned_seqs.iter().map(|s| s.as_bytes()).collect();
    let mut pairs: Vec<CodonCounts> = Vec::new();
    for i in 0..m {
        for j in (i + 1)..m {
            pairs.push(pair_codon_counts(bytes[i], bytes[j], n_codons));
        }
    }
    let all: Vec<usize> = (0..n_codons).collect();
    let (dn, ds) = mean_dn_ds(&pairs, &all);
    if dn.is_nan() || ds.is_nan() {
        notes.push("dN or dS is not computable (saturated: p ≥ 0.75, or no comparable codons).".into());
    }

    // Bootstrap variance of dN − dS over codons.
    let mut rng = SplitMix64::new(0x00C0_D0B5);
    let reps = 500;
    let mut diffs = Vec::with_capacity(reps);
    for _ in 0..reps {
        let pick: Vec<usize> = (0..n_codons).map(|_| rng.next_usize(n_codons)).collect();
        let (a, b) = mean_dn_ds(&pairs, &pick);
        if (a - b).is_finite() {
            diffs.push(a - b);
        }
    }
    let var = if diffs.len() > 1 {
        let mu = diffs.iter().sum::<f64>() / diffs.len() as f64;
        diffs.iter().map(|d| (d - mu).powi(2)).sum::<f64>() / (diffs.len() - 1) as f64
    } else {
        f64::NAN
    };
    let se = var.sqrt();
    let z = if se > 0.0 { (dn - ds) / se } else { f64::NAN };
    let normal = Normal::new(0.0, 1.0).unwrap();
    let upper = |x: f64| if x.is_finite() { 1.0 - normal.cdf(x) } else { f64::NAN };
    let z_test_neutrality = ZTestOutcome { z_stat: r(z, 3), p_value: r(2.0 * upper(z.abs()), 4), significant: z.abs() >= 1.96 };
    let z_test_positive = ZTestOutcome { z_stat: r(z, 3), p_value: r(upper(z), 4), significant: z >= 1.645 };
    let z_test_purifying = ZTestOutcome { z_stat: r(-z, 3), p_value: r(upper(-z), 4), significant: -z >= 1.645 };
    if se.is_nan() || se == 0.0 {
        notes.push("Bootstrap variance of dN − dS is zero or undefined; Z-tests are not informative.".into());
    }

    // Fisher's exact test on pair-averaged counts.
    let np = pairs.len() as f64;
    let (mut s_t, mut n_t, mut sd_t, mut nd_t) = (0.0, 0.0, 0.0, 0.0);
    for pc in &pairs {
        for (s, nn, sd, nd) in pc.iter().flatten() {
            s_t += s;
            n_t += nn;
            sd_t += sd;
            nd_t += nd;
        }
    }
    let (s_t, n_t, sd_t, nd_t) = (s_t / np, n_t / np, sd_t / np, nd_t / np);
    let fisher = fisher_positive_selection(
        sd_t.round() as u64,
        nd_t.round() as u64,
        (s_t - sd_t).round().max(0.0) as u64,
        (n_t - nd_t).round().max(0.0) as u64,
    );

    // Per-codon pair-averaged pN − pS, for every variable codon: each row reuses the pair counts
    // above, so the whole list is one pass over the pairs per codon, as one of the 500 bootstrap
    // replicates is.
    let mut codon_site_selection = Vec::new();
    for k in 0..n_codons {
        let mut uniq: Vec<[u8; 3]> = Vec::new();
        for b in &bytes {
            if let Some(c) = clean_codon(&b[3 * k..]) {
                if !uniq.contains(&c) {
                    uniq.push(c);
                }
            }
        }
        if uniq.len() < 2 {
            continue;
        }
        let (mut s, mut nn, mut sd, mut nd) = (0.0, 0.0, 0.0, 0.0);
        for pc in &pairs {
            if let Some((a, b, c, d)) = pc[k] {
                s += a;
                nn += b;
                sd += c;
                nd += d;
            }
        }
        let p_n = if nn > 0.0 { nd / nn } else { 0.0 };
        let p_s = if s > 0.0 { sd / s } else { 0.0 };
        let d = p_n - p_s;
        let mut aas: Vec<&str> = uniq.iter().map(aa).collect();
        aas.dedup();
        let mut aas_u: Vec<&str> = Vec::new();
        for a in aas {
            if !aas_u.contains(&a) {
                aas_u.push(a);
            }
        }
        codon_site_selection.push(CodonSiteSelectionRow {
            codon_index: k + 1,
            codons_observed: uniq.iter().map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join(" / "),
            amino_acids_observed: aas_u.join(" / "),
            dn_minus_ds: r(d, 3),
            selection_regime: if d > 0.0 {
                "pN > pS (nonsynonymous excess)".into()
            } else if d < 0.0 {
                "pN < pS (synonymous excess)".into()
            } else {
                "pN = pS".into()
            }
        });
    }
    let total_variable_codons = codon_site_selection.len();

    SelectionAndNeutralityReport {
        dn: r(dn, 5),
        ds: r(ds, 5),
        omega_dn_ds: if ds > 0.0 { r(dn / ds, 4) } else { f64::NAN },
        z_test_neutrality,
        z_test_positive,
        z_test_purifying,
        fisher_exact_p_value: r(fisher, 4),
        tajima_neutrality: tajima,
        codon_site_selection,
        total_variable_codons,
        notes,
    }
}

/// Tajima (1989) D with complete deletion of columns containing gaps or ambiguity codes.
fn tajima_d(seqs: &[String]) -> TajimaNeutralitySummary {
    let m = seqs.len();
    let len = seqs.iter().map(|s| s.len()).min().unwrap_or(0);
    let mut cols = Vec::new();
    for c in 0..len {
        let col: Vec<u8> = seqs.iter().map(|s| s.as_bytes()[c].to_ascii_uppercase()).collect();
        if col.iter().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T' | b'U')) {
            cols.push(col);
        }
    }
    let l = cols.len();
    let s = cols.iter().filter(|c| c.iter().any(|&b| b != c[0])).count();
    let mut k = 0.0;
    if m >= 2 {
        for col in &cols {
            let mut cnt = std::collections::HashMap::new();
            for &b in col {
                *cnt.entry(b).or_insert(0usize) += 1;
            }
            let same: usize = cnt.values().map(|&x| x * (x - 1) / 2).sum();
            k += (m * (m - 1) / 2 - same) as f64;
        }
        k /= (m * (m - 1) / 2) as f64;
    }
    let mf = m as f64;
    let a1: f64 = (1..m).map(|i| 1.0 / i as f64).sum();
    let a2: f64 = (1..m).map(|i| 1.0 / (i * i) as f64).sum();
    let b1 = (mf + 1.0) / (3.0 * (mf - 1.0));
    let b2 = 2.0 * (mf * mf + mf + 3.0) / (9.0 * mf * (mf - 1.0));
    let c1 = b1 - 1.0 / a1;
    let c2 = b2 - (mf + 2.0) / (a1 * mf) + a2 / (a1 * a1);
    let e1 = c1 / a1;
    let e2 = c2 / (a1 * a1 + a2);
    let sf = s as f64;
    let d = if m >= 4 && s > 0 { (k - sf / a1) / (e1 * sf + e2 * sf * (sf - 1.0)).sqrt() } else { f64::NAN };
    let lf = l.max(1) as f64;
    let interpretation = if d.is_nan() {
        if m < 4 { "Tajima's D needs at least 4 sequences" } else { "No segregating sites" }.to_string()
    } else {
        // Tajima (1989) beta-distribution 95% limits are about ±2 for moderate m.
        format!(
            "D = {:.3}. {}",
            d,
            if d <= -2.0 {
                "Below about −2: excess of rare variants (purifying selection or population expansion)."
            } else if d >= 2.0 {
                "Above about +2: excess of intermediate-frequency variants (balancing selection or population structure)."
            } else {
                "Within about ±2: no significant departure from neutral equilibrium."
            }
        )
    };
    TajimaNeutralitySummary {
        sample_size_m: m,
        segregating_sites_s: s,
        ps_proportion: r(sf / lf, 6),
        theta_watterson: r(if a1 > 0.0 { sf / lf / a1 } else { f64::NAN }, 6),
        nucleotide_diversity_pi: r(k / lf, 6),
        tajima_d: r(d, 4),
        interpretation,
    }
}

// ============================================================================
// 4. Discrete Γ site rates
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GammaCategoryRate {
    pub category: usize,
    pub relative_rate: f64,
    pub probability: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteRateRow {
    pub position: usize,
    pub relative_rate: f64,
    pub entropy_bits: f64,
    pub rate_category: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteRatesReport {
    pub gamma_shape_alpha: f64,
    pub num_categories: usize,
    pub category_rates: Vec<GammaCategoryRate>,
    /// Every alignment column, in order.
    pub site_rates: Vec<SiteRateRow>,
    /// How many columns the alignment has: the length of the complete `site_rates` list.
    #[serde(default)]
    pub total_sites: usize,
    #[serde(default)]
    pub note: String,
}

fn column_entropy(seqs: &[String], c: usize) -> f64 {
    let mut freq = [0u32; 128];
    let mut valid = 0u32;
    for row in seqs {
        let b = row.as_bytes().get(c).copied().unwrap_or(b'-').to_ascii_uppercase();
        if b != b'-' && b != b'?' && b != b'N' && b != b'.' {
            freq[(b as usize) & 127] += 1;
            valid += 1;
        }
    }
    if valid == 0 {
        return 0.0;
    }
    -freq.iter().filter(|&&x| x > 0).map(|&x| {
        let p = x as f64 / valid as f64;
        p * p.log2()
    }).sum::<f64>()
}

/// ML estimate of the Γ shape (TN93+G, NJ topology, ML branch lengths) and empirical-Bayes
/// relative rate of every site (posterior mean over the discrete categories; Yang 1994).
pub fn estimate_gamma_and_site_rates(aligned_seqs: &[String], num_categories: usize) -> SiteRatesReport {
    let k_cat = num_categories.clamp(2, 16);
    let n = aligned_seqs.len();
    let empty = |note: &str| SiteRatesReport {
        gamma_shape_alpha: f64::NAN,
        num_categories: k_cat,
        category_rates: Vec::new(),
        site_rates: Vec::new(),
        total_sites: 0,
        note: note.into(),
    };
    if n < 3 || !is_nucleotide_alignment(aligned_seqs) {
        return empty("Γ estimation needs ≥ 3 aligned nucleotide sequences.");
    }
    let names = placeholder_names(n);
    let Some(tree) = starting_tree(&names, aligned_seqs) else { return empty("Pairwise distances are undefined.") };
    let pats = Patterns::from_alignment(aligned_seqs);
    let spec = ModelSpec { family: Family::Tn93, gamma: true, invariant: false, n_cat: k_cat };
    let e = fit_model(tree, &pats, spec);
    let rates = e.model.cat_rates().to_vec();
    let post = e.category_posteriors();
    let category_rates = rates
        .iter()
        .enumerate()
        .map(|(i, &rr)| GammaCategoryRate { category: i + 1, relative_rate: r(rr, 4), probability: r(1.0 / k_cat as f64, 4) })
        .collect();
    let site_rates: Vec<SiteRateRow> = pats
        .site_pattern
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            let pr = &post[p];
            let mean: f64 = pr.iter().zip(&rates).map(|(a, b)| a * b).sum();
            let best = pr.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).map(|x| x.0).unwrap_or(0);
            SiteRateRow { position: i + 1, relative_rate: r(mean, 4), entropy_bits: r(column_entropy(aligned_seqs, i), 3), rate_category: best + 1 }
        })
        .collect();
    SiteRatesReport {
        gamma_shape_alpha: r(e.model.alpha, 4),
        num_categories: k_cat,
        category_rates,
        site_rates,
        total_sites: pats.site_pattern.len(),
        note: format!(
            "TN93+G ({k_cat} categories, mean rates) fitted by ML on the NJ topology, lnL = {:.2}. Site rate = posterior mean over categories (empirical Bayes).",
            e.log_likelihood()
        ),
    }
}

// ============================================================================
// 5. Molecular clock
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClockTestMlSummary {
    #[serde(rename = "lnLWithClock")]
    pub ln_l_with_clock: f64,
    #[serde(rename = "lnLWithoutClock")]
    pub ln_l_without_clock: f64,
    #[serde(rename = "twoDeltaLnL")]
    pub two_delta_ln_l: f64,
    #[serde(rename = "degreesOfFreedom")]
    pub degrees_of_freedom: usize,
    #[serde(rename = "pValue")]
    pub p_value: f64,
    #[serde(rename = "clockRejected")]
    pub clock_rejected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TajimaRelativeRateSummary {
    #[serde(rename = "taxonA")]
    pub taxon_a: String,
    #[serde(rename = "taxonB")]
    pub taxon_b: String,
    #[serde(rename = "outgroupC")]
    pub outgroup_c: String,
    #[serde(rename = "identicalSites")]
    pub identical_sites: usize,
    #[serde(rename = "uniqueToA_m1")]
    pub unique_to_a_m1: usize,
    #[serde(rename = "uniqueToB_m2")]
    pub unique_to_b_m2: usize,
    #[serde(rename = "chiSquare")]
    pub chi_square: f64,
    #[serde(rename = "pValue")]
    pub p_value: f64,
    #[serde(rename = "equalRatesAccepted")]
    pub equal_rates_accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrTestSummary {
    pub rho_correlation_score: f64,
    pub p_value: f64,
    pub autocorrelated_rates: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DivergenceNodeRow {
    #[serde(rename = "nodeLabel")]
    pub node_label: String,
    #[serde(rename = "relativeRate")]
    pub relative_rate: f64,
    #[serde(rename = "divergenceTimeMya")]
    pub divergence_time_mya: f64,
    #[serde(rename = "ci95LowMya")]
    pub ci95_low_mya: f64,
    #[serde(rename = "ci95HighMya")]
    pub ci95_high_mya: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MolecularClockAndTimetreeReport {
    pub method: String,
    #[serde(rename = "calibrationNodeName")]
    pub calibration_node_name: String,
    #[serde(rename = "calibrationAgeMya")]
    pub calibration_age_mya: f64,
    #[serde(rename = "clockTestML")]
    pub clock_test_ml: ClockTestMlSummary,
    #[serde(rename = "tajimaRelativeRate")]
    pub tajima_relative_rate: TajimaRelativeRateSummary,
    #[serde(rename = "corrTest")]
    pub corr_test: CorrTestSummary,
    /// Every internal node of the timetree, root first (preorder).
    #[serde(rename = "divergenceNodes")]
    pub divergence_nodes: Vec<DivergenceNodeRow>,
    /// How many internal nodes the timetree has: the length of the complete `divergence_nodes` list.
    #[serde(rename = "totalInternalNodes", default)]
    pub total_internal_nodes: usize,
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Tajima (1993) 1D relative-rate test: m1 = sites where only A differs, m2 = only B differs.
fn tajima_relative_rate(names: &[String], seqs: &[String], a: usize, b: usize, c: usize) -> TajimaRelativeRateSummary {
    let (sa, sb, sc) = (seqs[a].as_bytes(), seqs[b].as_bytes(), seqs[c].as_bytes());
    let (mut ident, mut m1, mut m2) = (0, 0, 0);
    let lim = sa.len().min(sb.len()).min(sc.len());
    let ok = |x: u8| matches!(x, b'A' | b'C' | b'G' | b'T');
    for i in 0..lim {
        let norm = |x: u8| if x.to_ascii_uppercase() == b'U' { b'T' } else { x.to_ascii_uppercase() };
        let (x, y, o) = (norm(sa[i]), norm(sb[i]), norm(sc[i]));
        if !(ok(x) && ok(y) && ok(o)) {
            continue;
        }
        if x == y && y == o {
            ident += 1;
        } else if y == o {
            m1 += 1;
        } else if x == o {
            m2 += 1;
        }
    }
    let chi = if m1 + m2 > 0 { ((m1 as f64 - m2 as f64).powi(2)) / (m1 + m2) as f64 } else { 0.0 };
    let p = 1.0 - ChiSquared::new(1.0).unwrap().cdf(chi);
    TajimaRelativeRateSummary {
        taxon_a: names[a].clone(),
        taxon_b: names[b].clone(),
        outgroup_c: names[c].clone(),
        identical_sites: ident,
        unique_to_a_m1: m1,
        unique_to_b_m2: m2,
        chi_square: r(chi, 4),
        p_value: r(p, 4),
        equal_rates_accepted: p >= 0.05,
    }
}

/// ML molecular-clock test (likelihood ratio, df = n − 2) under TN93+G on the midpoint-rooted NJ
/// topology, a strict-clock timetree scaled so the root equals the calibration
/// age, and Tajima's relative-rate test with sequence 1 and 2 as ingroups and the last as outgroup.
/// RelTime and CorrTest are not implemented: divergence times are strict-clock estimates without
/// confidence intervals, and the CorrTest fields are NaN.
pub fn run_molecular_clock_and_timetree(
    names: &[String],
    aligned_seqs: &[String],
    method: &str,
    calibration_age_mya: f64,
) -> MolecularClockAndTimetreeReport {
    let n = names.len().min(aligned_seqs.len());
    let mut notes = Vec::new();
    let nan_clock = ClockTestMlSummary {
        ln_l_with_clock: f64::NAN,
        ln_l_without_clock: f64::NAN,
        two_delta_ln_l: f64::NAN,
        degrees_of_freedom: n.saturating_sub(2),
        p_value: f64::NAN,
        clock_rejected: false,
    };
    let rrt = if n >= 3 {
        tajima_relative_rate(names, aligned_seqs, 0, 1, n - 1)
    } else {
        TajimaRelativeRateSummary {
            taxon_a: String::new(),
            taxon_b: String::new(),
            outgroup_c: String::new(),
            identical_sites: 0,
            unique_to_a_m1: 0,
            unique_to_b_m2: 0,
            chi_square: f64::NAN,
            p_value: f64::NAN,
            equal_rates_accepted: false,
        }
    };
    let corr_test = CorrTestSummary { rho_correlation_score: f64::NAN, p_value: f64::NAN, autocorrelated_rates: false };
    let mut report = MolecularClockAndTimetreeReport {
        method: format!("{method} requested; computed: strict-clock ML (TN93+G) timetree"),
        calibration_node_name: "Root".into(),
        calibration_age_mya,
        clock_test_ml: nan_clock,
        tajima_relative_rate: rrt,
        corr_test,
        divergence_nodes: Vec::new(),
        total_internal_nodes: 0,
        notes: Vec::new(),
    };
    if n < 3 || !is_nucleotide_alignment(&aligned_seqs[..n]) {
        notes.push("The clock test needs ≥ 3 aligned nucleotide sequences.".into());
        report.notes = notes;
        return report;
    }
    let (names, seqs) = (&names[..n], &aligned_seqs[..n]);
    let Some(tree) = starting_tree(names, seqs) else {
        notes.push("Pairwise distances are undefined (no shared sites).".into());
        report.notes = notes;
        return report;
    };
    let pats = Patterns::from_alignment(seqs);
    let spec = ModelSpec { family: Family::Tn93, gamma: true, invariant: false, n_cat: 4 };
    let mut e = fit_model(tree, &pats, spec);
    let ln_free = e.log_likelihood();
    let free_tree = e.tree.clone();
    let ln_clock = e.fit_clock(200);
    let two_delta = (2.0 * (ln_free - ln_clock)).max(0.0);
    let df = n - 2;
    let p = 1.0 - ChiSquared::new(df as f64).unwrap().cdf(two_delta);
    report.clock_test_ml = ClockTestMlSummary {
        ln_l_with_clock: r(ln_clock, 3),
        ln_l_without_clock: r(ln_free, 3),
        two_delta_ln_l: r(two_delta, 3),
        degrees_of_freedom: df,
        p_value: r(p, 4),
        clock_rejected: p < 0.05,
    };

    // Strict-clock node heights → ages.
    let t = &e.tree;
    let mut h = vec![0.0; t.nodes.len()];
    for v in t.postorder() {
        if let Some(&c) = t.nodes[v].children.first() {
            h[v] = h[c] + t.nodes[c].t;
        }
    }
    let root_h = h[t.root];
    // Relative lineage rate of a clade: unconstrained / clock-constrained subtree length.
    let subtree_len = |tree: &LkTree, v: usize| -> f64 {
        let mut s = 0.0;
        let mut st = vec![v];
        while let Some(x) = st.pop() {
            for &c in &tree.nodes[x].children {
                s += tree.nodes[c].t;
                st.push(c);
            }
        }
        s
    };
    let global = subtree_len(&free_tree, free_tree.root) / subtree_len(t, t.root).max(1e-12);
    let all = t.leaves_below(t.root);
    report.calibration_node_name = format!("Root ({})", describe_clade(names, &all));
    // Every internal node is listed: a row walks its own subtree, far less work than the clock fit.
    report.divergence_nodes = t
        .preorder()
        .into_iter()
        .filter(|&v| !t.nodes[v].children.is_empty())
        .map(|v| {
            let taxa = t.leaves_below(v);
            let rel = subtree_len(&free_tree, v) / subtree_len(t, v).max(1e-12) / global;
            DivergenceNodeRow {
                node_label: if v == t.root { "Root (calibration)".into() } else { describe_clade(names, &taxa) },
                relative_rate: r(rel, 3),
                divergence_time_mya: if root_h > 0.0 { r(h[v] / root_h * calibration_age_mya, 3) } else { f64::NAN },
                ci95_low_mya: f64::NAN,
                ci95_high_mya: f64::NAN,
            }
        })
        .collect();
    report.total_internal_nodes = t.nodes.iter().filter(|nd| !nd.children.is_empty()).count();
    notes.push("The tree is the midpoint-rooted Neighbor-Joining topology; use an outgroup-rooted tree for publication analyses.".into());
    notes.push("Relative rate = clade length without the clock ÷ with the clock, normalised to the whole tree.".into());
    report.notes = notes;
    report
}

// ============================================================================
// 6. Missense mutation diagnosis
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationDiagnosisResult {
    pub position_aa: usize,
    pub wild_type_aa: String,
    pub mutant_aa: String,
    pub substitution_label: String,
    pub evolutionary_probability_mutant: f64,
    pub site_conservation_score: f64,
    pub relative_site_rate: f64,
    pub grantham_distance: i32,
    pub blosum62_score: i32,
    pub clinical_impact: String,
    pub rationale: String,
    #[serde(default)]
    pub homologs_compared: usize,
}

/// Grantham (1974) composition, polarity and volume.
fn aa_physicochem(aa: u8) -> Option<(f64, f64, f64)> {
    Some(match aa.to_ascii_uppercase() {
        b'S' => (1.42, 9.2, 32.0),
        b'R' => (0.65, 10.5, 124.0),
        b'L' => (0.00, 4.9, 111.0),
        b'P' => (0.39, 8.0, 32.5),
        b'T' => (0.71, 8.6, 61.0),
        b'A' => (0.00, 8.1, 31.0),
        b'V' => (0.00, 5.9, 84.0),
        b'G' => (0.74, 9.0, 3.0),
        b'I' => (0.00, 5.2, 111.0),
        b'F' => (0.00, 5.2, 132.0),
        b'Y' => (0.20, 6.2, 136.0),
        b'C' => (2.75, 5.5, 55.0),
        b'H' => (0.58, 10.4, 96.0),
        b'Q' => (0.89, 10.5, 85.0),
        b'N' => (1.33, 11.6, 56.0),
        b'K' => (0.33, 11.3, 119.0),
        b'D' => (1.38, 13.0, 54.0),
        b'E' => (0.92, 12.3, 83.0),
        b'M' => (0.00, 5.7, 105.0),
        b'W' => (0.13, 5.4, 170.0),
        _ => return None,
    })
}

/// Residue of every aligned sequence at amino-acid `position` (1-based) of sequence 1.
/// Protein alignments are read directly, at sequence 1's `position`-th ungapped residue.
/// Nucleotide alignments are read as codons by alignment column, in triplets from column 1 (as
/// codon usage reads them), so a translation alignment's lead or trail padding never shifts the
/// frame: a slot is a codon position of sequence 1 only where all three of its columns hold a
/// non-gap character, and a gapped slot takes no codon position with it.
fn homolog_residues(aligned: &[String], position: usize) -> Option<(char, Vec<char>)> {
    let first = aligned.first()?.as_bytes();
    let protein = !is_nucleotide_alignment(aligned);
    let filled = |b: u8| b != b'-' && b != b'.';
    // A plain index, never an offset multiplied by the codon width: on wasm32 (32-bit usize) that
    // product wrapped and read a frame-shifted codon instead of reporting 'beyond sequence 1'.
    let index = position.checked_sub(1)?;
    let cols: Vec<usize> = if protein {
        let col = first.iter().enumerate().filter(|(_, &b)| filled(b)).nth(index).map(|(c, _)| c)?;
        vec![col]
    } else {
        let start = first
            .chunks_exact(3)
            .enumerate()
            .filter(|(_, slot)| slot.iter().all(|&b| filled(b)))
            .nth(index)
            .map(|(slot, _)| slot * 3)?;
        vec![start, start + 1, start + 2]
    };
    let residue = |s: &[u8]| -> Option<char> {
        if protein {
            let b = s.get(cols[0])?.to_ascii_uppercase();
            (b.is_ascii_alphabetic() && b != b'X').then_some(b as char)
        } else {
            let codon: Vec<u8> = cols.iter().map(|&c| s.get(c).copied().unwrap_or(b'-')).collect();
            let c = clean_codon(&codon)?;
            let a = aa(&c);
            (a != "*" && a != "X").then(|| a.chars().next().unwrap())
        }
    };
    let reference = residue(first)?;
    let others = aligned[1..].iter().filter_map(|s| residue(s.as_bytes())).collect();
    Some((reference, others))
}

/// Grantham distance, BLOSUM62 and — when an alignment of homologs is given — the observed
/// frequency of the wild-type and mutant residues at that site.
///
/// `evolutionary_probability_mutant` is the unweighted frequency of the mutant residue among the
/// other aligned sequences (evolutionary-probability methods also weight by a timetree; that is not done here).
/// `relative_site_rate` is the site's Shannon entropy relative to the alignment mean.
pub fn diagnose_missense_mutation(position_aa: usize, wild_type_aa: &str, mutant_aa: &str, aligned_seqs: &[String]) -> MutationDiagnosisResult {
    // blosum62() indexes its table by (byte - 'A'): anything that is not an
    // amino-acid code (a digit, space, accented letter typed in the UI) used to
    // index out of bounds and trap the WASM engine. Map those to 'X'.
    let residue = |s: &str| -> u8 {
        let b = s.bytes().next().unwrap_or(b'X').to_ascii_uppercase();
        if b.is_ascii_uppercase() || b == b'*' {
            b
        } else {
            b'X'
        }
    };
    let wt = residue(wild_type_aa);
    let mt = residue(mutant_aa);
    let position_aa = position_aa.max(1);
    let grantham = match (aa_physicochem(wt), aa_physicochem(mt)) {
        (Some((c1, p1, v1)), Some((c2, p2, v2))) => {
            let d = 1.833 * (c1 - c2).powi(2) + 0.1018 * (p1 - p2).powi(2) + 0.000399 * (v1 - v2).powi(2);
            (50.723 * d.sqrt()).round() as i32
        }
        _ => -1,
    };
    let blosum = blosum62(wt, mt);
    let label = format!("p.{}{}{}", wt as char, position_aa, mt as char);

    let mut notes = Vec::new();
    let (mut ep, mut conservation, mut rel_rate, mut homologs) = (f64::NAN, f64::NAN, f64::NAN, 0usize);
    if let Some((reference, others)) = homolog_residues(aligned_seqs, position_aa) {
        if reference != wt as char {
            notes.push(format!("Sequence 1 has {reference} (not {}) at position {position_aa}.", wt as char));
        }
        homologs = others.len();
        if homologs > 0 {
            let f = |x: u8| others.iter().filter(|&&c| c == x as char).count() as f64 / homologs as f64;
            ep = r(f(mt), 4);
            conservation = r(f(wt), 4);
        }
        let len = aligned_seqs.iter().map(|s| s.len()).min().unwrap_or(0);
        if len > 0 && !is_nucleotide_alignment(aligned_seqs) {
            let mean_h = (0..len).map(|c| column_entropy(aligned_seqs, c)).sum::<f64>() / len as f64;
            let first = aligned_seqs[0].as_bytes();
            let col = first.iter().enumerate().filter(|(_, &b)| b != b'-' && b != b'.').nth(position_aa - 1).map(|(c, _)| c);
            if let (Some(c), true) = (col, mean_h > 0.0) {
                rel_rate = r(column_entropy(aligned_seqs, c) / mean_h, 3);
            }
        }
    } else if !aligned_seqs.is_empty() {
        notes.push(format!("Position {position_aa} is beyond sequence 1 or not a complete codon/residue."));
    }

    // Grantham classes (Li, Wu & Luo 1984): ≤50 conservative, 51–100 moderately conservative,
    // 101–150 moderately radical, >150 radical.
    let impact = if ep > 0.0 {
        "Neutral / Benign"
    } else if conservation >= 0.9 && homologs >= 3 && grantham > 100 {
        "Pathogenic / Damaging"
    } else if grantham > 100 || blosum < 0 || conservation >= 0.9 {
        "Moderately Disruptive"
    } else {
        "Neutral / Benign"
    };
    let class = match grantham {
        g if g < 0 => "unknown residue",
        0..=50 => "conservative",
        51..=100 => "moderately conservative",
        101..=150 => "moderately radical",
        _ => "radical",
    };
    let mut rationale = format!("Grantham {grantham} ({class}), BLOSUM62 {blosum}.");
    if homologs > 0 {
        rationale.push_str(&format!(
            " Among {homologs} aligned homolog(s), {} carry the wild-type {} and {} carry the mutant {} (unweighted frequency, not a timetree-weighted evolutionary probability).",
            (conservation * homologs as f64).round(),
            wt as char,
            (ep * homologs as f64).round(),
            mt as char
        ));
    } else {
        rationale.push_str(" No aligned homologs were available, so the call rests on physicochemistry alone.");
    }
    for n in notes {
        rationale.push(' ');
        rationale.push_str(&n);
    }

    MutationDiagnosisResult {
        position_aa,
        wild_type_aa: (wt as char).to_string(),
        mutant_aa: (mt as char).to_string(),
        substitution_label: label,
        evolutionary_probability_mutant: ep,
        site_conservation_score: conservation,
        relative_site_rate: rel_rate,
        grantham_distance: grantham,
        blosum62_score: blosum,
        clinical_impact: impact.into(),
        rationale,
        homologs_compared: homologs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nei_gojobori_sites_and_pathways_match_published_examples() {
        // Nei & Kumar (2000) p. 54: TTA (Leu) has s = 2/3... first position TTA→CTA syn (1/3),
        // third position TTG syn (1/3).
        assert!((ng_syn_sites(b"TTA") - 2.0 / 3.0).abs() < 1e-12);
        // CCC (Pro): third position fully synonymous.
        assert!((ng_syn_sites(b"CCC") - 1.0).abs() < 1e-12);
        // ATG (Met) and TGG (Trp): no synonymous sites.
        assert_eq!(ng_syn_sites(b"ATG"), 0.0);
        // TTT→GTA: two differences; pathways TTT→GTT→GTA (N,S) and TTT→TTA→GTA (N,N) → Sd 0.5, Nd 1.5
        let (sd, nd) = ng_differences(b"TTT", b"GTA");
        assert!((sd - 0.5).abs() < 1e-12 && (nd - 1.5).abs() < 1e-12, "{sd} {nd}");
    }

    #[test]
    fn tajima_d_matches_hand_computation() {
        // m = 4, S = 2, k̂ = (2+2+1+... ) computed by hand below.
        let seqs: Vec<String> = ["AAAA", "AAAT", "AATA", "AATT"].iter().map(|s| s.to_string()).collect();
        let t = tajima_d(&seqs);
        assert_eq!(t.segregating_sites_s, 2);
        // pairwise differences: 1,1,2,2,1,1 → k = 8/6
        assert!((t.nucleotide_diversity_pi - (8.0 / 6.0) / 4.0).abs() < 1e-6);
        let a1 = 1.0 + 0.5 + 1.0 / 3.0;
        let a2 = 1.0 + 0.25 + 1.0 / 9.0;
        let (m, s) = (4.0f64, 2.0f64);
        let b1 = (m + 1.0) / (3.0 * (m - 1.0));
        let b2 = 2.0 * (m * m + m + 3.0) / (9.0 * m * (m - 1.0));
        let c1 = b1 - 1.0 / a1;
        let c2 = b2 - (m + 2.0) / (a1 * m) + a2 / (a1 * a1);
        let d = (8.0 / 6.0 - s / a1) / ((c1 / a1) * s + (c2 / (a1 * a1 + a2)) * s * (s - 1.0)).sqrt();
        assert!((t.tajima_d - d).abs() < 1e-4, "{} vs {d}", t.tajima_d);
    }

    #[test]
    fn missense_uses_the_alignment_and_published_grantham_values() {
        let aln: Vec<String> = ["MKYW", "MKYW", "MKFW", "MKYW"].iter().map(|s| s.to_string()).collect();
        let d = diagnose_missense_mutation(3, "Y", "F", &aln);
        assert_eq!(d.grantham_distance, 22); // Grantham (1974) Y–F = 22
        assert_eq!(d.homologs_compared, 3);
        assert!((d.evolutionary_probability_mutant - 1.0 / 3.0).abs() < 1e-3);
        assert_eq!(d.clinical_impact, "Neutral / Benign");
        let w = diagnose_missense_mutation(4, "W", "G", &aln);
        assert_eq!(w.grantham_distance, 184); // Grantham W–G = 184
        assert_eq!(w.clinical_impact, "Pathogenic / Damaging");
    }

    #[test]
    fn model_selection_prefers_the_generating_model_family_over_jc() {
        // Transition-rich data: K2P-family models must beat JC69 by BIC and report R > 0.5.
        let base = "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGAAAACTTACC";
        let ts = |s: &str, pos: &[usize]| -> String {
            s.bytes()
                .enumerate()
                .map(|(i, b)| {
                    if pos.contains(&i) {
                        match b {
                            b'A' => 'G',
                            b'G' => 'A',
                            b'C' => 'T',
                            _ => 'C',
                        }
                    } else {
                        b as char
                    }
                })
                .collect()
        };
        let seqs = vec![
            base.to_string(),
            ts(base, &[3, 17, 29, 44, 60, 75, 91, 102]),
            ts(base, &[5, 22, 38, 51, 66, 80, 99, 110, 121]),
            ts(base, &[3, 17, 29, 44, 61, 77, 93, 105, 118, 125]),
            ts(base, &[8, 26, 47, 70, 96, 115]),
        ];
        let rows = find_best_substitution_models(&seqs);
        assert_eq!(rows.len(), 24);
        let jc = rows.iter().find(|r| r.model == "JC").unwrap();
        let k2 = rows.iter().find(|r| r.model == "K2").unwrap();
        assert!(k2.log_likelihood > jc.log_likelihood);
        assert!(k2.ti_tv_ratio_r > 2.0, "{}", k2.ti_tv_ratio_r);
        assert!((jc.ti_tv_ratio_r - 0.5).abs() < 1e-9);
        // Nested models never fit worse than their special cases.
        let gtr = rows.iter().find(|r| r.model == "GTR").unwrap();
        assert!(gtr.log_likelihood >= k2.log_likelihood - 0.05);
        assert!(rows.windows(2).all(|w| w[0].bic <= w[1].bic));

        // The log-likelihood comparison above holds by nesting alone, so it says nothing about
        // the ranking. Pin the criteria and the ranking itself. Gap-free, so n = 132 sites.
        assert_criteria_follow_their_formulas(&rows, 5, 132.0);
        assert_family_outranks_jc(&rows, "K2");

        // Data simulated under K2P itself (kappa = 4, so R = kappa / 2 = 2 with equal base
        // frequencies), 1000 sites down ((A:0.08,B:0.12):0.06,(C:0.10,D:0.07):0.05,E:0.15).
        let sim = simulate_k2p(0x00C0_FFEE, 1000, 4.0);
        let rows = find_best_substitution_models(&sim);
        assert_eq!(rows.len(), 24);
        assert_criteria_follow_their_formulas(&rows, 5, 1000.0);
        assert_family_outranks_jc(&rows, "K2");
        // BIC charges ln(1000) = 6.9 per extra parameter, which none of the richer models
        // nesting K2P earns back on this data, so BIC picks the generating model itself.
        assert_eq!(rows[0].model, "K2", "BIC winner {} over {:?}", rows[0].model, rows.iter().map(|r| &r.model).collect::<Vec<_>>());
        let k2 = rows.iter().find(|r| r.model == "K2").unwrap();
        assert!((k2.ti_tv_ratio_r - 2.0).abs() < 0.5, "K2 R {}", k2.ti_tv_ratio_r);
        // One BIC worked through by hand: k = 2*5 - 3 = 7 branch lengths + kappa = 8.
        assert_eq!(k2.parameters_k, 8);
        let bic_by_hand = -2.0 * k2.log_likelihood + 8.0 * 1000f64.ln();
        assert!((k2.bic - bic_by_hand).abs() < 2e-3, "K2 BIC {} vs {bic_by_hand}", k2.bic);
    }

    /// Kimura (1980) two-parameter evolution down a fixed five-taxon tree. Over a branch of `d`
    /// expected substitutions per site with transition/transversion rate ratio kappa, the
    /// closed-form probabilities are P(transition) = 1/4 + 1/4 e^(-4d/(kappa+2)) - 1/2
    /// e^(-2d(kappa+1)/(kappa+2)) and P(each transversion) = 1/4 - 1/4 e^(-4d/(kappa+2)).
    fn simulate_k2p(seed: u64, sites: usize, kappa: f64) -> Vec<String> {
        let mut rng = SplitMix64::new(seed);
        let evolve = |parent: &[u8], d: f64, rng: &mut SplitMix64| -> Vec<u8> {
            let e1 = (-4.0 * d / (kappa + 2.0)).exp();
            let e2 = (-2.0 * d * (kappa + 1.0) / (kappa + 2.0)).exp();
            let p_ts = 0.25 + 0.25 * e1 - 0.5 * e2;
            let p_tv = 0.25 - 0.25 * e1;
            parent
                .iter()
                .map(|&b| {
                    let (ts, tv1, tv2) = match b {
                        b'A' => (b'G', b'C', b'T'),
                        b'G' => (b'A', b'C', b'T'),
                        b'C' => (b'T', b'A', b'G'),
                        _ => (b'C', b'A', b'G'),
                    };
                    let u = rng.next_f64();
                    if u < p_ts {
                        ts
                    } else if u < p_ts + p_tv {
                        tv1
                    } else if u < p_ts + 2.0 * p_tv {
                        tv2
                    } else {
                        b
                    }
                })
                .collect()
        };
        let root: Vec<u8> = (0..sites).map(|_| b"ACGT"[rng.next_usize(4)]).collect();
        let x = evolve(&root, 0.06, &mut rng);
        let y = evolve(&root, 0.05, &mut rng);
        let tips = [
            evolve(&x, 0.08, &mut rng),
            evolve(&x, 0.12, &mut rng),
            evolve(&y, 0.10, &mut rng),
            evolve(&y, 0.07, &mut rng),
            evolve(&root, 0.15, &mut rng),
        ];
        tips.iter().map(|t| String::from_utf8(t.clone()).unwrap()).collect()
    }

    /// BIC = -2 lnL + k ln(n) and AIC = 2k - 2 lnL (Schwarz 1978; Akaike 1974), with n the
    /// number of alignment sites (jModelTest 2 fixes its sample size to the alignment size) and
    /// k the 2N - 3 branch lengths of N taxa plus the model's free parameters (ModelTest-NG's
    /// `n_free_variables + n_branches_params`), base frequencies included: JC 0, K2 1, T92 2,
    /// HKY 4, TN93 5, GTR 8, and +G and +I one each. lnL, BIC and AIC are printed to 3
    /// decimals, so they are recomputed to 2e-3.
    fn assert_criteria_follow_their_formulas(rows: &[ModelSelectionRankingRow], taxa: usize, n_sites: f64) {
        for row in rows {
            let mut parts = row.model.split('+');
            let base = match parts.next().unwrap() {
                "JC" => 0,
                "K2" => 1,
                "T92" => 2,
                "HKY" => 4,
                "TN93" => 5,
                "GTR" => 8,
                other => panic!("unexpected model {other}"),
            };
            let k = 2 * taxa - 3 + base + parts.count();
            assert_eq!(row.parameters_k, k, "{}: k", row.model);
            let kf = k as f64;
            let bic = -2.0 * row.log_likelihood + kf * n_sites.ln();
            assert!((row.bic - bic).abs() < 2e-3, "{}: BIC {} vs {bic}", row.model, row.bic);
            let aic = 2.0 * kf - 2.0 * row.log_likelihood;
            assert!((row.aic - aic).abs() < 2e-3, "{}: AIC {} vs {aic}", row.model, row.aic);
        }
    }

    /// The generating family's base model ranks above every JC-family model, by BIC (the order
    /// the rows come in) and by AIC.
    fn assert_family_outranks_jc(rows: &[ModelSelectionRankingRow], family: &str) {
        assert!(rows.windows(2).all(|w| w[0].bic <= w[1].bic), "rows are not in BIC order");
        let mut by_aic: Vec<&ModelSelectionRankingRow> = rows.iter().collect();
        by_aic.sort_by(|a, b| a.aic.partial_cmp(&b.aic).unwrap());
        let is_jc = |m: &str| m.split('+').next() == Some("JC");
        for (criterion, order) in [("BIC", rows.iter().collect::<Vec<_>>()), ("AIC", by_aic)] {
            let pos = |m: &str| order.iter().position(|r| r.model == m).unwrap();
            let best_jc = order.iter().position(|r| is_jc(&r.model)).unwrap();
            assert!(
                pos(family) < best_jc,
                "{criterion}: {family} ranks {} but {} ranks {best_jc}",
                pos(family),
                order[best_jc].model
            );
            assert!(pos(family) < pos("JC"), "{criterion}: {family} below JC");
        }
    }
}
