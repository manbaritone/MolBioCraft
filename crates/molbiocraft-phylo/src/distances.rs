// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Alignment data exploration, codon-position nucleotide composition, 64-codon RSCU,
//! Kumar-Gadagkar Disparity Index & 4x4 substitution rate matrix, analytical evolutionary
//! distances (p-distance, JC69, K2P, T92, HKY85, TN93, MCL, GTR), and Nei population diversity.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const STANDARD_CODONS: &[(&str, &str)] = &[
    ("TTT", "F"), ("TTC", "F"), ("TTA", "L"), ("TTG", "L"),
    ("CTT", "L"), ("CTC", "L"), ("CTA", "L"), ("CTG", "L"),
    ("ATT", "I"), ("ATC", "I"), ("ATA", "I"), ("ATG", "M"),
    ("GTT", "V"), ("GTC", "V"), ("GTA", "V"), ("GTG", "V"),
    ("TCT", "S"), ("TCC", "S"), ("TCA", "S"), ("TCG", "S"),
    ("CCT", "P"), ("CCC", "P"), ("CCA", "P"), ("CCG", "P"),
    ("ACT", "T"), ("ACC", "T"), ("ACA", "T"), ("ACG", "T"),
    ("GCT", "A"), ("GCC", "A"), ("GCA", "A"), ("GCG", "A"),
    ("TAT", "Y"), ("TAC", "Y"), ("TAA", "*"), ("TAG", "*"),
    ("CAT", "H"), ("CAC", "H"), ("CAA", "Q"), ("CAG", "Q"),
    ("AAT", "N"), ("AAC", "N"), ("AAA", "K"), ("AAG", "K"),
    ("GAT", "D"), ("GAC", "D"), ("GAA", "E"), ("GAG", "E"),
    ("TGT", "C"), ("TGC", "C"), ("TGA", "*"), ("TGG", "W"),
    ("CGT", "R"), ("CGC", "R"), ("CGA", "R"), ("CGG", "R"),
    ("AGT", "S"), ("AGC", "S"), ("AGA", "R"), ("AGG", "R"),
    ("GGT", "G"), ("GGC", "G"), ("GGA", "G"), ("GGG", "G"),
];

pub fn translate_standard_codon(codon: &str) -> &'static str {
    let bytes = codon.as_bytes();
    if bytes.len() < 3 {
        return "X";
    }
    let norm = [
        match bytes[0].to_ascii_uppercase() {
            b'U' => b'T',
            b => b,
        },
        match bytes[1].to_ascii_uppercase() {
            b'U' => b'T',
            b => b,
        },
        match bytes[2].to_ascii_uppercase() {
            b'U' => b'T',
            b => b,
        },
    ];
    for &(c, aa) in STANDARD_CODONS {
        if c.as_bytes() == norm {
            return aa;
        }
    }
    "X"
}

/// Fold degeneracy (0, 2 or 4) of position `pos` (0, 1, 2) within a 3-base codon; 3-fold sites
/// (Ile third position) count as 2-fold, as in Li (1993). Returns `u8::MAX` when the codon is
/// incomplete or ambiguous.
pub fn codon_site_degeneracy(codon: &[u8], pos: usize) -> u8 {
    if codon.len() < 3 || pos > 2 {
        return u8::MAX;
    }
    let bases = [b'A', b'C', b'G', b'T'];
    let mut probe = [
        codon[0].to_ascii_uppercase(),
        codon[1].to_ascii_uppercase(),
        codon[2].to_ascii_uppercase(),
    ];
    for b in &mut probe {
        if *b == b'U' {
            *b = b'T';
        }
    }
    if !probe.iter().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T')) {
        return u8::MAX;
    }
    let ref_aa = translate_standard_codon(std::str::from_utf8(&probe).unwrap_or("NNN"));
    let mut same_aa = 0u8;
    for alt in bases {
        let mut mutated = probe;
        mutated[pos] = alt;
        let aa = translate_standard_codon(std::str::from_utf8(&mutated).unwrap_or("NNN"));
        if aa == ref_aa {
            same_aa += 1;
        }
    }
    match same_aa {
        4 => 4,
        2 | 3 => 2,
        _ => 0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDataExplorationReport {
    pub num_taxa: usize,
    pub num_sites: usize,
    pub conserved_sites: usize,
    pub variable_sites: usize,
    pub parsimony_informative_sites: usize,
    pub singleton_sites: usize,
    pub zero_fold_degenerate_sites: usize,
    pub two_fold_degenerate_sites: usize,
    pub four_fold_degenerate_sites: usize,
    pub gap_or_missing_sites: usize,
}

/// Site counts. Gaps and missing data are ignored within a column (a column is
/// conserved when all observed residues agree). For nucleotide data IUPAC ambiguity codes are
/// treated as missing. Degeneracy (codons read from column 1) is counted only where every
/// sequence with a complete codon gives the same fold class; other sites are left unclassified.
pub fn explore_active_alignment_data(aligned_seqs: &[String]) -> ActiveDataExplorationReport {
    let num_taxa = aligned_seqs.len();
    let num_sites = aligned_seqs.iter().map(|s| s.len()).max().unwrap_or(0);
    let nucleotide = crate::trees::is_nucleotide_alignment(aligned_seqs);
    let (mut conserved, mut variable, mut parsimony_inf, mut singleton, mut gap_or_missing) = (0, 0, 0, 0, 0);
    let (mut zero_fold, mut two_fold, mut four_fold) = (0, 0, 0);

    for col in 0..num_sites {
        let mut counts = [0u32; 128];
        let mut has_gap = false;
        for row in aligned_seqs {
            let mut ch = row.as_bytes().get(col).copied().unwrap_or(b'-').to_ascii_uppercase();
            if nucleotide && ch == b'U' {
                ch = b'T';
            }
            let missing = matches!(ch, b'-' | b'?' | b'.')
                || (nucleotide && !matches!(ch, b'A' | b'C' | b'G' | b'T'))
                || (!nucleotide && ch == b'X');
            if missing {
                has_gap = true;
            } else {
                counts[(ch as usize) & 127] += 1;
            }
        }
        if has_gap {
            gap_or_missing += 1;
        }
        let distinct = counts.iter().filter(|&&c| c > 0).count();
        let at_least_two = counts.iter().filter(|&&c| c >= 2).count();
        if distinct == 1 {
            conserved += 1;
        } else if distinct > 1 {
            variable += 1;
            if at_least_two >= 2 {
                parsimony_inf += 1;
            } else {
                singleton += 1;
            }
        }

        if nucleotide {
            let start = (col / 3) * 3;
            let mut class: Option<u8> = None;
            let mut consistent = true;
            for row in aligned_seqs {
                let b = row.as_bytes();
                if start + 3 > b.len() {
                    continue;
                }
                let d = codon_site_degeneracy(&b[start..start + 3], col % 3);
                if d == u8::MAX {
                    continue;
                }
                match class {
                    None => class = Some(d),
                    Some(c) if c != d => consistent = false,
                    _ => {}
                }
            }
            match (consistent, class) {
                (true, Some(0)) => zero_fold += 1,
                (true, Some(2)) => two_fold += 1,
                (true, Some(4)) => four_fold += 1,
                _ => {}
            }
        }
    }

    ActiveDataExplorationReport {
        num_taxa,
        num_sites,
        conserved_sites: conserved,
        variable_sites: variable,
        parsimony_informative_sites: parsimony_inf,
        singleton_sites: singleton,
        zero_fold_degenerate_sites: zero_fold,
        two_fold_degenerate_sites: two_fold,
        four_fold_degenerate_sites: four_fold,
        gap_or_missing_sites: gap_or_missing,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NucleotideCompositionRow {
    #[serde(rename = "taxonName")]
    pub taxon_name: String,
    #[serde(rename = "lengthBp")]
    pub length_bp: usize,
    #[serde(rename = "pctT")]
    pub pct_t: f64,
    #[serde(rename = "pctC")]
    pub pct_c: f64,
    #[serde(rename = "pctA")]
    pub pct_a: f64,
    #[serde(rename = "pctG")]
    pub pct_g: f64,
    #[serde(rename = "pctGC")]
    pub pct_gc: f64,
    #[serde(rename = "pctGC1")]
    pub pct_gc1: f64,
    #[serde(rename = "pctGC2")]
    pub pct_gc2: f64,
    #[serde(rename = "pctGC3")]
    pub pct_gc3: f64,
}

pub fn compute_nucleotide_composition_by_codon_pos(
    names: &[String],
    aligned_seqs: &[String],
) -> Vec<NucleotideCompositionRow> {
    let n = names.len().min(aligned_seqs.len());
    (0..n)
        .map(|idx| {
            // Codon position = alignment column modulo 3, so gaps do not shift the frame.
            let clean: Vec<(usize, u8)> = aligned_seqs[idx]
                .bytes()
                .enumerate()
                .filter_map(|(col, b)| {
                    let u = b.to_ascii_uppercase();
                    matches!(u, b'A' | b'C' | b'G' | b'T' | b'U').then_some((col, u))
                })
                .collect();
            let len = clean.len().max(1) as f64;
            let (mut nt, mut nc, mut na, mut ng) = (0usize, 0usize, 0usize, 0usize);
            let (mut gc1, mut tot1, mut gc2, mut tot2, mut gc3, mut tot3) =
                (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);

            for &(col, b) in &clean {
                match b {
                    b'T' | b'U' => nt += 1,
                    b'C' => nc += 1,
                    b'A' => na += 1,
                    b'G' => ng += 1,
                    _ => {}
                }
                let is_gc = usize::from(b == b'G' || b == b'C');
                match col % 3 {
                    0 => {
                        tot1 += 1;
                        gc1 += is_gc;
                    }
                    1 => {
                        tot2 += 1;
                        gc2 += is_gc;
                    }
                    _ => {
                        tot3 += 1;
                        gc3 += is_gc;
                    }
                }
            }

            let r1 = |v: f64| (v * 10.0).round() / 10.0;
            NucleotideCompositionRow {
                taxon_name: names[idx].clone(),
                length_bp: clean.len(),
                pct_t: r1((nt as f64 / len) * 100.0),
                pct_c: r1((nc as f64 / len) * 100.0),
                pct_a: r1((na as f64 / len) * 100.0),
                pct_g: r1((ng as f64 / len) * 100.0),
                pct_gc: r1(((ng + nc) as f64 / len) * 100.0),
                pct_gc1: r1((gc1 as f64 / tot1.max(1) as f64) * 100.0),
                pct_gc2: r1((gc2 as f64 / tot2.max(1) as f64) * 100.0),
                pct_gc3: r1((gc3 as f64 / tot3.max(1) as f64) * 100.0),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodonUsageRow {
    pub codon: String,
    pub amino_acid: String,
    pub count: usize,
    pub frequency_per_thousand: f64,
    pub rscu: f64,
}

/// Codon usage of an aligned coding alignment. Codons are read by alignment column, in triplets
/// from column 1, so gaps never shift the frame; a row counts a codon in a slot only when all
/// three of its columns hold A/C/G/T (U read as T). A slot holding a gap, an ambiguity code, or
/// translation-alignment lead/trail padding counts no codon for that row.
pub fn compute_relative_synonymous_codon_usage(aligned_seqs: &[String]) -> Vec<CodonUsageRow> {
    let mut codon_counts = [0usize; 64];
    let mut total_codons = 0usize;

    for raw in aligned_seqs {
        for slot in raw.as_bytes().chunks_exact(3) {
            let mut trip = [0u8; 3];
            for (t, &b) in trip.iter_mut().zip(slot) {
                *t = match b.to_ascii_uppercase() {
                    b'U' => b'T',
                    u => u,
                };
            }
            if let Some(pos) = STANDARD_CODONS
                .iter()
                .position(|&(c, _)| c.as_bytes() == trip)
            {
                codon_counts[pos] += 1;
                total_codons += 1;
            }
        }
    }

    let denom = total_codons.max(1) as f64;
    STANDARD_CODONS
        .iter()
        .enumerate()
        .map(|(idx, &(codon, aa))| {
            let count = codon_counts[idx];
            let mut aa_total = 0usize;
            let mut aa_deg = 0usize;
            for (j, &(_, other_aa)) in STANDARD_CODONS.iter().enumerate() {
                if other_aa == aa {
                    aa_total += codon_counts[j];
                    aa_deg += 1;
                }
            }
            let expected = aa_total as f64 / aa_deg.max(1) as f64;
            let rscu = if expected > 0.0 {
                count as f64 / expected
            } else {
                0.0
            };
            CodonUsageRow {
                codon: codon.to_string(),
                amino_acid: aa.to_string(),
                count,
                frequency_per_thousand: (((count as f64 / denom) * 1000.0) * 10.0).round() / 10.0,
                rscu: (rscu * 100.0).round() / 100.0,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateMatrixRow4x4 {
    pub from: String,
    #[serde(rename = "toA")]
    pub to_a: f64,
    #[serde(rename = "toT")]
    pub to_t: f64,
    #[serde(rename = "toC")]
    pub to_c: f64,
    #[serde(rename = "toG")]
    pub to_g: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisparityPairRecord {
    pub taxon_a: String,
    pub taxon_b: String,
    pub disparity_index_id: f64,
    pub p_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubstitutionRateMatrixReport {
    pub matrix4x4: Vec<RateMatrixRow4x4>,
    pub purine_kappa1: f64,
    pub pyrimidine_kappa2: f64,
    pub overall_ti_tv_ratio_r: f64,
    pub disparity_pairs: Vec<DisparityPairRecord>,
}

/// Kumar & Gadagkar (2001) disparity index over sites where both sequences have A/C/G/T:
/// I_D = (Σ_i (x_iA − x_iB)² / 2 − n_d) / n.
fn disparity_index(a: &[u8], b: &[u8]) -> (f64, Vec<(usize, usize)>) {
    let idx = |x: u8| match x.to_ascii_uppercase() {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' | b'U' => Some(3),
        _ => None,
    };
    let pairs: Vec<(usize, usize)> = a.iter().zip(b).filter_map(|(&x, &y)| Some((idx(x)?, idx(y)?))).collect();
    let id = disparity_of(&pairs);
    (id, pairs)
}

fn disparity_of(pairs: &[(usize, usize)]) -> f64 {
    if pairs.is_empty() {
        return f64::NAN;
    }
    let (mut fa, mut fb, mut nd) = ([0.0f64; 4], [0.0f64; 4], 0.0);
    for &(x, y) in pairs {
        fa[x] += 1.0;
        fb[y] += 1.0;
        if x != y {
            nd += 1.0;
        }
    }
    let sq: f64 = fa.iter().zip(&fb).map(|(p, q)| (p - q).powi(2)).sum();
    (0.5 * sq - nd) / pairs.len() as f64
}

/// ML estimate of the nucleotide substitution pattern under TN93+G (4 categories) on the
/// Neighbor-Joining tree, reported as r_ij = π_j × exchangeability, scaled so the 12
/// off-diagonal entries sum to 100; k1 and k2 are the purine and pyrimidine transition /
/// transversion rate ratios and R = (π_Aπ_G k1 + π_Tπ_C k2) / ((π_A+π_G)(π_T+π_C)).
///
/// Pairwise disparity indices are tested with a Monte Carlo test (1000 replicates) that swaps the
/// two sequences' bases at random at each compared site — exchangeable when both sequences evolved
/// under the same pattern.
pub fn compute_substitution_rate_matrix(names: &[String], aligned_seqs: &[String]) -> SubstitutionRateMatrixReport {
    use crate::likelihood::{Engine, Family, ModelSpec, NucModel, Patterns};
    let n = names.len().min(aligned_seqs.len());
    let r2 = |v: f64| (v * 100.0).round() / 100.0;
    let nan_row = |from: &str| RateMatrixRow4x4 { from: from.into(), to_a: f64::NAN, to_t: f64::NAN, to_c: f64::NAN, to_g: f64::NAN };
    let mut report = SubstitutionRateMatrixReport {
        matrix4x4: ["A", "T/U", "C", "G"].iter().map(|f| nan_row(f)).collect(),
        purine_kappa1: f64::NAN,
        pyrimidine_kappa2: f64::NAN,
        overall_ti_tv_ratio_r: f64::NAN,
        disparity_pairs: Vec::new(),
    };
    if n < 2 || !crate::trees::is_nucleotide_alignment(&aligned_seqs[..n]) {
        return report;
    }
    let seqs = &aligned_seqs[..n];
    if n >= 3 {
        if let Some(tree) = crate::trees::nj_likelihood_tree(&names[..n], seqs, "Jukes-Cantor (JC69)") {
            let pats = Patterns::from_alignment(seqs);
            let spec = ModelSpec { family: Family::Tn93, gamma: true, invariant: false, n_cat: 4 };
            let mut e = Engine::new(tree, &pats, NucModel::new(spec, pats.base_frequencies()));
            e.fit(40);
            let m = &e.model;
            let pi = m.pi; // A C G T
            // exchangeabilities AC AG AT CG CT GT
            let ex = |i: usize, j: usize| -> f64 {
                let (a, b) = if i < j { (i, j) } else { (j, i) };
                let k = match (a, b) {
                    (0, 1) => 0,
                    (0, 2) => 1,
                    (0, 3) => 2,
                    (1, 2) => 3,
                    (1, 3) => 4,
                    _ => 5,
                };
                m.rates[k]
            };
            let mut raw = [[0.0f64; 4]; 4];
            let mut tot = 0.0;
            for i in 0..4 {
                for j in 0..4 {
                    if i != j {
                        raw[i][j] = pi[j] * ex(i, j);
                        tot += raw[i][j];
                    }
                }
            }
            let v = |i: usize, j: usize| if i == j { f64::NAN } else { r2(100.0 * raw[i][j] / tot) };
            // Row/column order in the report: A, T, C, G  (internal order A, C, G, T)
            let row = |from: &str, i: usize| RateMatrixRow4x4 { from: from.into(), to_a: v(i, 0), to_t: v(i, 3), to_c: v(i, 1), to_g: v(i, 2) };
            report.matrix4x4 = vec![row("A", 0), row("T/U", 3), row("C", 1), row("G", 2)];
            report.purine_kappa1 = r2(m.rates[1] / m.rates[0]);
            report.pyrimidine_kappa2 = r2(m.rates[4] / m.rates[0]);
            report.overall_ti_tv_ratio_r = r2(m.ts_tv_ratio());
        }
    }

    let mut rng = molbiocraft_core::SplitMix64::new(0xD15B_A517);
    for i in 0..n {
        for j in (i + 1)..n {
            let (id, mut pairs) = disparity_index(seqs[i].as_bytes(), seqs[j].as_bytes());
            let reps = 1000;
            let mut ge = 0usize;
            if id.is_finite() {
                for _ in 0..reps {
                    for p in pairs.iter_mut() {
                        if rng.next_u64() & 1 == 1 {
                            *p = (p.1, p.0);
                        }
                    }
                    if disparity_of(&pairs) >= id - 1e-12 {
                        ge += 1;
                    }
                }
            }
            report.disparity_pairs.push(DisparityPairRecord {
                taxon_a: names[i].clone(),
                taxon_b: names[j].clone(),
                disparity_index_id: (id * 1e4).round() / 1e4,
                p_value: if id.is_finite() { (ge as f64 + 1.0) / (reps as f64 + 1.0) } else { f64::NAN },
            });
        }
    }
    report
}

/// Amino-acid pairwise distance and standard error.
///
/// Nucleotide substitution models (JC69, K2P, TN93, ...) do not apply to
/// proteins, and counting only A/C/G/T letters made protein alignments produce
/// "no tree" or zero-length star trees. Proteins use the p-distance when that
/// model is requested and the Poisson correction d = -ln(1 - p) otherwise
/// (Nei & Kumar 2000). Gaps and ambiguity symbols (X, B, Z, J, *, ?) are skipped.
pub fn calc_protein_pair_distance_and_se(s1: &str, s2: &str, model: &str) -> (f64, f64) {
    let is_residue = |b: u8| b.is_ascii_alphabetic() && !matches!(b, b'X' | b'B' | b'Z' | b'J');
    let (mut valid, mut diff) = (0usize, 0usize);
    for (&x, &y) in s1.as_bytes().iter().zip(s2.as_bytes()) {
        let (a, b) = (x.to_ascii_uppercase(), y.to_ascii_uppercase());
        if !is_residue(a) || !is_residue(b) {
            continue;
        }
        valid += 1;
        if a != b {
            diff += 1;
        }
    }
    if valid == 0 {
        return (f64::NAN, f64::NAN);
    }
    let l = valid as f64;
    let p = diff as f64 / l;
    let (d, var) = if distance_model_kind(model) == DistanceModelKind::PDistance {
        (p, p * (1.0 - p) / l)
    } else {
        if p >= 1.0 {
            return (f64::NAN, f64::NAN);
        }
        (-(1.0 - p).ln(), p / ((1.0 - p) * l))
    };
    let round4 = |x: f64| (x * 10000.0).round() / 10000.0;
    (round4(d.max(0.0)), round4(var.max(0.0).sqrt()))
}

/// Pairwise distance for an alignment of the given molecule class.
pub fn pair_distance_and_se(s1: &str, s2: &str, model: &str, protein: bool) -> (f64, f64) {
    pair_distance_and_se_with_freqs(s1, s2, model, protein, None)
}

/// As [`pair_distance_and_se`], with the alignment's base composition for the models that use one
/// (T92 GC content, TN93 frequencies), as ape `dist.dna` and the likelihood models do.
pub fn pair_distance_and_se_with_freqs(s1: &str, s2: &str, model: &str, protein: bool, pi: Option<[f64; 4]>) -> (f64, f64) {
    if protein {
        calc_protein_pair_distance_and_se(s1, s2, model)
    } else {
        calc_pair_distance_and_se_with_freqs(s1, s2, model, pi)
    }
}

/// A, C, G, T frequencies over every unambiguous base of the alignment.
pub fn alignment_base_frequencies(seqs: &[String]) -> Option<[f64; 4]> {
    let mut c = [0usize; 4];
    for s in seqs {
        for b in s.bytes() {
            match b.to_ascii_uppercase() {
                b'A' => c[0] += 1,
                b'C' => c[1] += 1,
                b'G' => c[2] += 1,
                b'T' | b'U' => c[3] += 1,
                _ => {}
            }
        }
    }
    let t: usize = c.iter().sum();
    (t > 0).then(|| [c[0] as f64 / t as f64, c[1] as f64 / t as f64, c[2] as f64 / t as f64, c[3] as f64 / t as f64])
}

/// Exact analytical pairwise evolutionary distance and delta-method standard error, with the
/// base composition of the pair itself.
pub fn calc_pair_distance_and_se(s1: &str, s2: &str, model: &str) -> (f64, f64) {
    calc_pair_distance_and_se_with_freqs(s1, s2, model, None)
}

/// Exact analytical pairwise distance and delta-method SE; `pi` (alignment-wide A, C, G, T
/// frequencies) replaces the pair's own composition when given.
pub fn calc_pair_distance_and_se_with_freqs(s1: &str, s2: &str, model: &str, pi_all: Option<[f64; 4]>) -> (f64, f64) {
    let b1 = s1.as_bytes();
    let b2 = s2.as_bytes();
    let len = b1.len().min(b2.len());
    let mut valid = 0usize;
    let mut ti_pur = 0usize;
    let mut ti_pyr = 0usize;
    let mut tv = 0usize;
    let mut base_counts = [0usize; 4]; // A, C, G, T

    for k in 0..len {
        let a = match b1[k].to_ascii_uppercase() {
            b'U' => b'T',
            u => u,
        };
        let b = match b2[k].to_ascii_uppercase() {
            b'U' => b'T',
            u => u,
        };
        if !matches!(a, b'A' | b'C' | b'G' | b'T') || !matches!(b, b'A' | b'C' | b'G' | b'T') {
            continue;
        }
        valid += 1;
        for &nuc in &[a, b] {
            match nuc {
                b'A' => base_counts[0] += 1,
                b'C' => base_counts[1] += 1,
                b'G' => base_counts[2] += 1,
                _ => base_counts[3] += 1,
            }
        }
        if a != b {
            match (a, b) {
                (b'A', b'G') | (b'G', b'A') => ti_pur += 1,
                (b'C', b'T') | (b'T', b'C') => ti_pyr += 1,
                _ => tv += 1,
            }
        }
    }

    if valid == 0 {
        return (f64::NAN, f64::NAN);
    }
    let l = valid as f64;
    let p1 = ti_pur as f64 / l;
    let p2 = ti_pyr as f64 / l;
    let q = tv as f64 / l;

    let two_l = 2.0 * l;
    let pi = pi_all.unwrap_or([
        base_counts[0] as f64 / two_l,
        base_counts[1] as f64 / two_l,
        base_counts[2] as f64 / two_l,
        base_counts[3] as f64 / two_l,
    ]);
    let model_kind = distance_model_kind(model);
    // Distance as a function of the observed proportions (P1 = A<->G, P2 = C<->T, Q = transversions).
    let dist = |p1: f64, p2: f64, q: f64| -> f64 { model_distance(model_kind, p1, p2, q, &pi) };
    let d = dist(p1, p2, q);
    if !d.is_finite() {
        // Saturated: the correction is undefined (reported as n/c: not computable).
        return (f64::NAN, f64::NAN);
    }
    // Delta-method variance for multinomial proportions:
    // Var(d) = [sum c_i^2 x_i - (sum c_i x_i)^2] / L, with c_i = dd/dx_i.
    let h = 1e-6;
    let grad = [
        (dist(p1 + h, p2, q) - dist(p1 - h.min(p1), p2, q)) / (h + h.min(p1)),
        (dist(p1, p2 + h, q) - dist(p1, p2 - h.min(p2), q)) / (h + h.min(p2)),
        (dist(p1, p2, q + h) - dist(p1, p2, q - h.min(q))) / (h + h.min(q)),
    ];
    let xs = [p1, p2, q];
    let s2: f64 = grad.iter().zip(&xs).map(|(c, x)| c * c * x).sum();
    let s1: f64 = grad.iter().zip(&xs).map(|(c, x)| c * x).sum();
    let var = ((s2 - s1 * s1) / l).max(0.0);
    let se = if var.is_finite() { var.sqrt() } else { f64::NAN };

    (
        (d.max(0.0) * 10000.0).round() / 10000.0,
        (se * 10000.0).round() / 10000.0,
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DistanceModelKind {
    PDistance,
    Jc69,
    K2p,
    T92,
    Tn93,
}

fn distance_model_kind(model: &str) -> DistanceModelKind {
    if model.contains("JC69") || model.contains("Jukes-Cantor") {
        DistanceModelKind::Jc69
    } else if model.contains("K2P") || model.contains("Kimura") {
        DistanceModelKind::K2p
    } else if model.contains("T92") || model.contains("Tamura 3") {
        DistanceModelKind::T92
    } else if model.contains("TN93") || model.contains("Tamura-Nei") || model.contains("MCL") {
        // The Maximum Composite Likelihood distance (Tamura, Nei and Kumar 2004) is the TN93 distance.
        DistanceModelKind::Tn93
    } else if model.contains("HKY") || model.contains("GTR") {
        // No separate closed form is implemented: these use the TN93 distance (HKY is TN93 with
        // equal transition rates; TN93 is the closest analytic model to GTR).
        DistanceModelKind::Tn93
    } else {
        DistanceModelKind::PDistance
    }
}

/// Analytic distances; returns +inf when the log argument is not positive (saturation).
fn model_distance(kind: DistanceModelKind, p1: f64, p2: f64, q: f64, pi: &[f64; 4]) -> f64 {
    let ln = |x: f64| if x > 0.0 { x.ln() } else { f64::NEG_INFINITY };
    let p = p1 + p2 + q;
    let big_p = p1 + p2;
    match kind {
        DistanceModelKind::PDistance => p,
        // Jukes & Cantor (1969)
        DistanceModelKind::Jc69 => -0.75 * ln(1.0 - 4.0 / 3.0 * p),
        // Kimura (1980)
        DistanceModelKind::K2p => -0.5 * ln(1.0 - 2.0 * big_p - q) - 0.25 * ln(1.0 - 2.0 * q),
        // Tamura (1992): h = 2 theta (1 - theta), theta = G+C content
        DistanceModelKind::T92 => {
            let theta = pi[1] + pi[2];
            let hh = 2.0 * theta * (1.0 - theta);
            if hh <= 0.0 {
                return f64::INFINITY;
            }
            -hh * ln(1.0 - big_p / hh - q) - 0.5 * (1.0 - hh) * ln(1.0 - 2.0 * q)
        }
        // Tamura & Nei (1993)
        DistanceModelKind::Tn93 => {
            let (pa, pc, pg, pt) = (pi[0], pi[1], pi[2], pi[3]);
            let pr = pa + pg;
            let py = pc + pt;
            if pa * pg <= 0.0 || pc * pt <= 0.0 || pr <= 0.0 || py <= 0.0 {
                return f64::INFINITY;
            }
            let k_r = 2.0 * pa * pg / pr;
            let k_y = 2.0 * pc * pt / py;
            -k_r * ln(1.0 - p1 / k_r - q / (2.0 * pr))
                - k_y * ln(1.0 - p2 / k_y - q / (2.0 * py))
                - 2.0 * (pr * py - pa * pg * py / pr - pc * pt * pr / py) * ln(1.0 - q / (2.0 * pr * py))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithinGroupMeanRow {
    pub group_name: String,
    pub taxon_count: usize,
    pub mean_distance: f64,
    pub se: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetweenGroupMeanRow {
    pub group_a: String,
    pub group_b: String,
    pub mean_distance: f64,
    pub net_distance_da: f64,
    pub se: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistanceAnalysisReport {
    pub model: String,
    #[serde(rename = "taxaNames")]
    pub taxa_names: Vec<String>,
    #[serde(rename = "pairwiseMatrix")]
    pub pairwise_matrix: Vec<Vec<f64>>,
    #[serde(rename = "overallMeanDistance")]
    pub overall_mean_distance: f64,
    #[serde(rename = "overallMeanSE")]
    pub overall_mean_se: f64,
    #[serde(rename = "withinGroupMeans")]
    pub within_group_means: Vec<WithinGroupMeanRow>,
    #[serde(rename = "betweenGroupMeans")]
    pub between_group_means: Vec<BetweenGroupMeanRow>,
}

pub fn compute_evolutionary_distances(
    names: &[String],
    aligned_seqs: &[String],
    model: &str,
    groups: &[String],
) -> DistanceAnalysisReport {
    let n = names.len().min(aligned_seqs.len());
    // Lower triangle holds distances, upper triangle standard errors.
    // Non-computable (saturated / no comparable sites) entries are NaN -> JSON null.
    let mut mat = vec![vec![0.0f64; n]; n];
    let mut sum_d = 0.0f64;
    let mut sum_se = 0.0f64;
    let mut pair_count = 0usize;
    let protein = !crate::trees::is_nucleotide_alignment(&aligned_seqs[..n]);
    let pi_all = if protein { None } else { alignment_base_frequencies(&aligned_seqs[..n]) };

    for i in 0..n {
        for j in (i + 1)..n {
            let (d, se) = pair_distance_and_se_with_freqs(&aligned_seqs[i], &aligned_seqs[j], model, protein, pi_all);
            mat[j][i] = d;
            mat[i][j] = se;
            if d.is_finite() {
                sum_d += d;
                sum_se += if se.is_finite() { se } else { 0.0 };
                pair_count += 1;
            }
        }
    }
    let round4 = |x: f64| (x * 10000.0).round() / 10000.0;
    let mean_over = |pairs: &[(usize, usize)]| -> (f64, f64) {
        let vals: Vec<(f64, f64)> = pairs
            .iter()
            .map(|&(a, b)| (mat[a.max(b)][a.min(b)], mat[a.min(b)][a.max(b)]))
            .filter(|(d, _)| d.is_finite())
            .collect();
        if vals.is_empty() {
            return (f64::NAN, f64::NAN);
        }
        let k = vals.len() as f64;
        (
            round4(vals.iter().map(|v| v.0).sum::<f64>() / k),
            round4(vals.iter().map(|v| if v.1.is_finite() { v.1 } else { 0.0 }).sum::<f64>() / k),
        )
    };

    // Group statistics only for groups actually defined on the taxa (e.g. "Group: …" in each sequence's description).
    let mut group_names: Vec<String> = Vec::new();
    for g in groups.iter().take(n) {
        if !g.trim().is_empty() && !group_names.contains(g) {
            group_names.push(g.clone());
        }
    }
    let members = |g: &String| -> Vec<usize> { (0..n).filter(|&i| groups.get(i) == Some(g)).collect() };
    let mut within_group_means = Vec::new();
    let mut within_d: Vec<f64> = Vec::new();
    for g in &group_names {
        let m = members(g);
        let pairs: Vec<(usize, usize)> = m.iter().enumerate().flat_map(|(x, &a)| m[x + 1..].iter().map(move |&b| (a, b))).collect();
        let (d, se) = if pairs.is_empty() { (f64::NAN, f64::NAN) } else { mean_over(&pairs) };
        within_d.push(d);
        within_group_means.push(WithinGroupMeanRow { group_name: g.clone(), taxon_count: m.len(), mean_distance: d, se });
    }
    let mut between_group_means = Vec::new();
    for x in 0..group_names.len() {
        for y in (x + 1)..group_names.len() {
            let (ma, mb) = (members(&group_names[x]), members(&group_names[y]));
            let pairs: Vec<(usize, usize)> = ma.iter().flat_map(|&a| mb.iter().map(move |&b| (a, b))).collect();
            let (dxy, se) = mean_over(&pairs);
            // Nei & Li net distance d_A = d_XY - (d_X + d_Y) / 2 (needs both within-group means).
            let net = if within_d[x].is_finite() && within_d[y].is_finite() {
                round4(dxy - 0.5 * (within_d[x] + within_d[y]))
            } else {
                f64::NAN
            };
            between_group_means.push(BetweenGroupMeanRow {
                group_a: group_names[x].clone(),
                group_b: group_names[y].clone(),
                mean_distance: dxy,
                net_distance_da: net,
                se,
            });
        }
    }

    let pc = pair_count.max(1) as f64;
    DistanceAnalysisReport {
        model: model.to_string(),
        taxa_names: names[..n].to_vec(),
        pairwise_matrix: mat,
        overall_mean_distance: if pair_count > 0 { round4(sum_d / pc) } else { f64::NAN },
        overall_mean_se: if pair_count > 0 { round4(sum_se / pc) } else { f64::NAN },
        within_group_means,
        between_group_means,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiversityAnalysisReport {
    #[serde(rename = "withinSubpopulationPiS")]
    pub within_subpopulation_pi_s: f64,
    #[serde(rename = "withinSubpopulationSE")]
    pub within_subpopulation_se: f64,
    #[serde(rename = "entirePopulationPiT")]
    pub entire_population_pi_t: f64,
    #[serde(rename = "entirePopulationSE")]
    pub entire_population_se: f64,
    #[serde(rename = "interpopulationDiversityDeltaST")]
    pub interpopulation_diversity_delta_st: f64,
    #[serde(rename = "interpopulationSE")]
    pub interpopulation_se: f64,
    #[serde(rename = "coefficientOfDifferentiationGst")]
    pub coefficient_of_differentiation_gst: f64,
    #[serde(rename = "coefficientSE")]
    pub coefficient_se: f64,
    #[serde(rename = "haplotypeDiversityHd")]
    pub haplotype_diversity_hd: f64,
    /// Nei (1987, eq. 8.12) sampling standard error of Hd.
    #[serde(rename = "haplotypeDiversitySE", default)]
    pub haplotype_diversity_se: f64,
}

pub fn compute_population_diversity(
    names: &[String],
    aligned_seqs: &[String],
    model: &str,
    groups: &[String],
) -> DiversityAnalysisReport {
    // Nei (1987): pi_T = mean distance over all pairs; pi_S = mean of within-subpopulation means;
    // delta_ST = pi_T - pi_S; G_ST (N_ST) = delta_ST / pi_T. Subpopulation statistics need group
    // labels; analytical standard errors are not available (they need a bootstrap), so they are NaN.
    let dist_rep = compute_evolutionary_distances(names, aligned_seqs, model, groups);
    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;
    let within: Vec<f64> = dist_rep
        .within_group_means
        .iter()
        .map(|g| g.mean_distance)
        .filter(|d| d.is_finite())
        .collect();
    let pi_t = dist_rep.overall_mean_distance;
    let pi_s = if within.len() >= 2 { r4(within.iter().sum::<f64>() / within.len() as f64) } else { f64::NAN };
    let delta_st = if pi_s.is_finite() && pi_t.is_finite() { r4(pi_t - pi_s) } else { f64::NAN };
    let gst = if delta_st.is_finite() && pi_t > 0.0 { r4(delta_st / pi_t) } else { f64::NAN };

    // Haplotype diversity Hd = n/(n-1) * (1 - sum x_i^2) over distinct sequences.
    let n_seq = aligned_seqs.len();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for s in aligned_seqs {
        *counts.entry(s.to_ascii_uppercase()).or_insert(0) += 1;
    }
    let (hd, hd_se) = if n_seq >= 2 {
        let n = n_seq as f64;
        let sum_sq: f64 = counts.values().map(|&c| (c as f64 / n).powi(2)).sum();
        let sum_cu: f64 = counts.values().map(|&c| (c as f64 / n).powi(3)).sum();
        // V(Hd) = 2/(n(n−1)) · [2(n−2)(Σx³ − (Σx²)²) + Σx² − (Σx²)²]
        let var = 2.0 / (n * (n - 1.0)) * (2.0 * (n - 2.0) * (sum_cu - sum_sq * sum_sq) + sum_sq - sum_sq * sum_sq);
        (r4(n / (n - 1.0) * (1.0 - sum_sq)), r4(var.max(0.0).sqrt()))
    } else {
        (f64::NAN, f64::NAN)
    };

    DiversityAnalysisReport {
        within_subpopulation_pi_s: pi_s,
        within_subpopulation_se: f64::NAN,
        entire_population_pi_t: pi_t,
        entire_population_se: f64::NAN,
        interpopulation_diversity_delta_st: delta_st,
        interpopulation_se: f64::NAN,
        coefficient_of_differentiation_gst: gst,
        coefficient_se: f64::NAN,
        haplotype_diversity_hd: hd,
        haplotype_diversity_se: hd_se,
    }
}
