// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Protein Intrinsic Disorder (Uversky FoldIndex), Amyloid/Inclusion-Body Aggregation Hotspot
//! Profiler, Eisenberg Amphipathic Helical Hydrophobic Moment ($\mu_H$), Boman Protein-Binding
//! Potential, Parker Surface Hydrophilicity B-Cell Epitopes, and MHC Class I (`HLA-A*02:01`)
//! Nonamer Peptide Anchor Scorer.

use molbiocraft_core::clean_alpha_sequence;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntrinsicallyDisorderedRegion {
    pub start_aa: usize,
    pub end_aa: usize,
    pub length_aa: usize,
    pub mean_fold_index: f64,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregationHotspot {
    pub start_aa: usize,
    pub end_aa: usize,
    pub length_aa: usize,
    pub peak_zygg_score: f64,
    pub sequence: String,
    pub gatekeeper_flanked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmphipathicHelixSegment {
    pub start_aa: usize,
    pub end_aa: usize,
    pub hydrophobic_moment_mu_h: f64,
    pub mean_eisenberg_hydrophobicity: f64,
    pub sequence: String,
    pub helix_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MhcClassIPeptideCandidate {
    pub start_aa: usize,
    pub end_aa: usize,
    pub nonamer: String,
    pub allele: String,
    pub binding_log_score: f64,
    pub estimated_ic50_nm: f64,
    pub affinity_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinDisorderAggregationEpitopeReport {
    pub sequence_length_aa: usize,
    pub mean_normalized_hydropathy: f64,
    pub mean_net_charge_per_residue: f64,
    pub global_uversky_fold_index: f64,
    pub disorder_fraction_pct: f64,
    pub boman_binding_index_kcal_mol: f64,
    pub peak_helical_hydrophobic_moment: f64,
    pub soluble_expression_verdict: String,
    pub disordered_regions: Vec<IntrinsicallyDisorderedRegion>,
    pub aggregation_hotspots: Vec<AggregationHotspot>,
    pub amphipathic_helices: Vec<AmphipathicHelixSegment>,
    pub top_mhc_class1_peptides: Vec<MhcClassIPeptideCandidate>,
}

/// Kyte-Doolittle hydropathy normalized linearly onto $[0, 1]$ per Prilusky et al. (2005) `FoldIndex`:
/// `R(-4.5) -> 0.0`, `I(+4.5) -> 1.0`.
#[inline]
fn normalized_kd_01(b: u8) -> f64 {
    let kd = match b {
        b'I' => 4.5,
        b'V' => 4.2,
        b'L' => 3.8,
        b'F' => 2.8,
        b'C' => 2.5,
        b'M' => 1.9,
        b'A' => 1.8,
        b'G' => -0.4,
        b'T' => -0.7,
        b'S' => -0.8,
        b'W' => -0.9,
        b'Y' => -1.3,
        b'P' => -1.6,
        b'H' => -3.2,
        b'E' | b'Q' | b'D' | b'N' => -3.5,
        b'K' => -3.9,
        b'R' => -4.5,
        _ => -0.4,
    };
    (kd + 4.5) / 9.0
}

#[inline]
fn residue_charge_ph7(b: u8) -> f64 {
    match b {
        b'K' | b'R' => 1.0,
        b'D' | b'E' => -1.0,
        b'H' => 0.1,
        _ => 0.0,
    }
}

/// Eisenberg et al. (1984) consensus normalized hydrophobicity scale for $\mu_H$ hydrophobic moment.
#[inline]
fn eisenberg_h(b: u8) -> f64 {
    match b {
        b'I' => 1.38,
        b'F' => 1.19,
        b'V' => 1.08,
        b'L' => 1.06,
        b'W' => 0.81,
        b'M' => 0.64,
        b'A' => 0.62,
        b'G' => 0.48,
        b'C' => 0.29,
        b'Y' => 0.26,
        b'P' => 0.12,
        b'T' => -0.05,
        b'S' => -0.18,
        b'H' => -0.40,
        b'E' => -0.74,
        b'N' => -0.78,
        b'Q' => -0.85,
        b'D' => -0.90,
        b'K' => -1.50,
        b'R' => -2.53,
        _ => 0.0,
    }
}

/// Boman (2003) free-energy solubility / protein-protein interaction potential (kcal/mol).
#[inline]
fn boman_solubility_kcal(b: u8) -> f64 {
    match b {
        b'L' => -4.92,
        b'I' => -4.92,
        b'V' => -4.04,
        b'F' => -2.98,
        b'M' => -2.35,
        b'W' => -2.33,
        b'A' => -1.81,
        b'C' => -1.28,
        b'G' => -0.94,
        b'Y' => 0.14,
        b'T' => 2.57,
        b'S' => 3.40,
        b'H' => 4.66,
        b'Q' => 5.54,
        b'K' => 5.55,
        b'N' => 6.64,
        b'E' => 6.81,
        b'D' => 8.72,
        b'R' => 14.92,
        b'P' => 0.0,
        _ => 0.0,
    }
}

/// Intrinsic beta-aggregation propensity combining $\beta$-sheet propensity, hydrophobicity,
/// and electrostatic gatekeeper suppression (Pawar et al. 2005 Zyggregator / TANGO principles).
#[inline]
fn intrinsic_beta_agg(b: u8) -> f64 {
    match b {
        b'I' => 1.85,
        b'F' => 1.80,
        b'V' => 1.72,
        b'Y' => 1.55,
        b'W' => 1.48,
        b'L' => 1.38,
        b'M' => 1.05,
        b'C' => 0.95,
        b'T' => 0.35,
        b'A' => 0.25,
        b'Q' => 0.15, // Prion-like Q/N polar zipper contribution
        b'N' => 0.12,
        b'S' => -0.15,
        b'G' => -0.45,
        b'H' => -0.60,
        b'P' => -2.40, // Beta-breaker gatekeeper!
        b'K' => -1.95, // Electrostatic gatekeeper!
        b'R' => -2.05,
        b'D' => -2.10,
        b'E' => -2.00,
        _ => 0.0,
    }
}

/// Evaluates intrinsic disorder (`FoldIndex`), $\beta$-amyloid / inclusion-body aggregation hotspots,
/// Eisenberg amphipathic $\alpha$-helices ($\delta = 100^\circ$, 11-aa wheel), Boman interaction
/// potential, and `HLA-A*02:01` MHC Class I nonamer epitopes.
pub fn analyze_protein_disorder_aggregation_epitopes(
    raw_protein: &str,
) -> ProteinDisorderAggregationEpitopeReport {
    let seq = clean_alpha_sequence(raw_protein);
    let bytes = seq.as_bytes();
    let n = bytes.len();

    if n == 0 {
        return ProteinDisorderAggregationEpitopeReport {
            sequence_length_aa: 0,
            mean_normalized_hydropathy: 0.0,
            mean_net_charge_per_residue: 0.0,
            global_uversky_fold_index: 0.0,
            disorder_fraction_pct: 0.0,
            boman_binding_index_kcal_mol: 0.0,
            peak_helical_hydrophobic_moment: 0.0,
            soluble_expression_verdict: "Empty Sequence".into(),
            disordered_regions: Vec::new(),
            aggregation_hotspots: Vec::new(),
            amphipathic_helices: Vec::new(),
            top_mhc_class1_peptides: Vec::new(),
        };
    }

    let nf = n as f64;
    let mean_h = bytes.iter().map(|&b| normalized_kd_01(b)).sum::<f64>() / nf;
    let net_charge_abs = (bytes.iter().map(|&b| residue_charge_ph7(b)).sum::<f64>() / nf).abs();
    // Prilusky & Uversky FoldIndex: I_F = 2.785 * <H> - |<R>| - 1.151 (I_F < 0 => intrinsically disordered)
    let global_fi = 2.785 * mean_h - net_charge_abs - 1.151;
    let boman = bytes.iter().map(|&b| boman_solubility_kcal(b)).sum::<f64>() / nf;

    // 1. Sliding 21-aa Uversky FoldIndex profile -> contiguous IDR segments >= 12 aa with I_F < 0
    let half_w = 10usize;
    let mut disordered_flags = vec![false; n];
    let mut fi_profile = vec![0.0f64; n];

    for i in 0..n {
        let lo = i.saturating_sub(half_w);
        let hi = (i + half_w + 1).min(n);
        let span = (hi - lo) as f64;
        let h_w = bytes[lo..hi].iter().map(|&b| normalized_kd_01(b)).sum::<f64>() / span;
        let q_w = (bytes[lo..hi].iter().map(|&b| residue_charge_ph7(b)).sum::<f64>() / span).abs();
        let fi = 2.785 * h_w - q_w - 1.151;
        fi_profile[i] = fi;
        if fi < -0.02 {
            disordered_flags[i] = true;
        }
    }

    let disordered_cnt = disordered_flags.iter().filter(|&&f| f).count();
    let mut disordered_regions = Vec::new();
    let mut idx = 0usize;
    while idx < n {
        if disordered_flags[idx] {
            let s = idx;
            while idx < n && disordered_flags[idx] {
                idx += 1;
            }
            if idx - s >= 12 {
                let m_fi = fi_profile[s..idx].iter().sum::<f64>() / ((idx - s) as f64);
                disordered_regions.push(IntrinsicallyDisorderedRegion {
                    start_aa: s + 1,
                    end_aa: idx,
                    length_aa: idx - s,
                    mean_fold_index: (m_fi * 1000.0).round() / 1000.0,
                    sequence: seq[s..idx].to_string(),
                });
            }
        } else {
            idx += 1;
        }
    }

    // 2. Sliding 7-aa Aggregation Hotspot Profiler (APR >= 5 consecutive residues with score >= 1.05)
    let mut agg_profile = vec![0.0f64; n];
    for i in 0..n {
        let lo = i.saturating_sub(3);
        let hi = (i + 4).min(n);
        let span = (hi - lo) as f64;
        agg_profile[i] = bytes[lo..hi].iter().map(|&b| intrinsic_beta_agg(b)).sum::<f64>() / span;
    }

    let mut aggregation_hotspots = Vec::new();
    let mut a_idx = 0usize;
    while a_idx < n {
        if agg_profile[a_idx] >= 1.05 {
            let s = a_idx;
            let mut peak = agg_profile[a_idx];
            while a_idx < n && agg_profile[a_idx] >= 1.05 {
                if agg_profile[a_idx] > peak {
                    peak = agg_profile[a_idx];
                }
                a_idx += 1;
            }
            if a_idx - s >= 5 {
                let left_gk = s > 0 && matches!(bytes[s - 1], b'P' | b'K' | b'R' | b'D' | b'E');
                let right_gk =
                    a_idx < n && matches!(bytes[a_idx], b'P' | b'K' | b'R' | b'D' | b'E');
                aggregation_hotspots.push(AggregationHotspot {
                    start_aa: s + 1,
                    end_aa: a_idx,
                    length_aa: a_idx - s,
                    peak_zygg_score: (peak * 100.0).round() / 100.0,
                    sequence: seq[s..a_idx].to_string(),
                    gatekeeper_flanked: left_gk || right_gk,
                });
            }
        } else {
            a_idx += 1;
        }
    }

    // 3. Eisenberg 11-residue Alpha-Helical Hydrophobic Moment mu_H (delta = 100 deg = 1.7453293 rad)
    let delta_rad = 100.0_f64.to_radians();
    let mut peak_mu_h = 0.0f64;
    let mut amphipathic_helices = Vec::new();

    if n >= 11 {
        let mut h_idx = 0usize;
        while h_idx + 11 <= n {
            let win = &bytes[h_idx..(h_idx + 11)];
            // Exclude proline-kinked non-helical cores
            let internal_pro = win[2..9].contains(&b'P');
            let mut sum_sin = 0.0;
            let mut sum_cos = 0.0;
            let mut sum_h = 0.0;
            for (k, &ch) in win.iter().enumerate() {
                let h = eisenberg_h(ch);
                let ang = (k as f64) * delta_rad;
                sum_sin += h * ang.sin();
                sum_cos += h * ang.cos();
                sum_h += h;
            }
            let mu_h = (sum_sin * sum_sin + sum_cos * sum_cos).sqrt() / 11.0;
            let mean_eh = sum_h / 11.0;
            if mu_h > peak_mu_h {
                peak_mu_h = mu_h;
            }
            if !internal_pro && mu_h >= 0.48 && amphipathic_helices.len() < 24 {
                let cls = if mean_eh > 0.50 {
                    "Transmembrane / Surface-Seeking Helix"
                } else {
                    "Globular Amphipathic Alpha-Helix"
                };
                amphipathic_helices.push(AmphipathicHelixSegment {
                    start_aa: h_idx + 1,
                    end_aa: h_idx + 11,
                    hydrophobic_moment_mu_h: (mu_h * 1000.0).round() / 1000.0,
                    mean_eisenberg_hydrophobicity: (mean_eh * 1000.0).round() / 1000.0,
                    sequence: seq[h_idx..(h_idx + 11)].to_string(),
                    helix_class: cls.into(),
                });
                h_idx += 7;
            } else {
                h_idx += 1;
            }
        }
    }

    // 4. Parker-Rammensee HLA-A*02:01 9-mer MHC Class I Anchor Matrix (P2 = L/M/I/V, P9 = V/L/I/A)
    let mut mhc_candidates = Vec::new();
    if n >= 9 {
        for s in 0..=(n - 9) {
            let pep = &bytes[s..(s + 9)];
            let p2_w = match pep[1] {
                b'L' => 2.8,
                b'M' => 2.4,
                b'I' => 2.1,
                b'V' => 1.7,
                b'T' | b'A' => 0.8,
                b'D' | b'E' | b'K' | b'R' | b'P' => -2.5,
                _ => -0.4,
            };
            let p9_w = match pep[8] {
                b'V' => 2.9,
                b'L' => 2.6,
                b'I' => 1.9,
                b'A' | b'T' => 0.9,
                b'D' | b'E' | b'K' | b'R' | b'P' => -2.6,
                _ => -0.5,
            };
            if p2_w < 0.7 || p9_w < 0.8 {
                continue;
            }
            let aux = (0..9)
                .filter(|&k| k != 1 && k != 8)
                .map(|k| match (k, pep[k]) {
                    (0, b'Y' | b'F' | b'K') => 0.55,
                    (2, b'Y' | b'W' | b'F' | b'L' | b'A') => 0.45,
                    (3, b'E' | b'D' | b'P' | b'G') => 0.35,
                    (4 | 6, b'F' | b'Y' | b'W') => 0.35,
                    (5, b'V' | b'I' | b'L' | b'T') => 0.40,
                    (_, b'P') => -0.35,
                    _ => 0.08,
                })
                .sum::<f64>();
            let log_score = p2_w + p9_w + aux;
            // Calibrated log-affinity -> estimated IC50 (nM): score ~ 7.5 => ~15 nM; score ~ 4.5 => ~380 nM
            let ic50 = (12000.0 * (-0.88 * log_score).exp()).clamp(4.0, 49000.0);
            if ic50 <= 500.0 {
                let tier = if ic50 <= 50.0 {
                    "Strong Binder (IC50 <= 50 nM)"
                } else {
                    "Weak/Intermediate Binder (50-500 nM)"
                };
                mhc_candidates.push(MhcClassIPeptideCandidate {
                    start_aa: s + 1,
                    end_aa: s + 9,
                    nonamer: seq[s..(s + 9)].to_string(),
                    allele: "HLA-A*02:01".into(),
                    binding_log_score: (log_score * 100.0).round() / 100.0,
                    estimated_ic50_nm: (ic50 * 10.0).round() / 10.0,
                    affinity_tier: tier.into(),
                });
            }
        }
        mhc_candidates.sort_by(|a, b| {
            a.estimated_ic50_nm
                .partial_cmp(&b.estimated_ic50_nm)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        mhc_candidates.truncate(15);
    }

    let disorder_pct = ((disordered_cnt as f64 / nf) * 1000.0).round() / 10.0;
    let unguarded_aprs = aggregation_hotspots
        .iter()
        .filter(|h| !h.gatekeeper_flanked)
        .count();

    let verdict = if unguarded_aprs >= 3 && global_fi > 0.28 {
        "High Inclusion-Body Risk: >= 3 unguarded hydrophobic beta-aggregation hotspots; consider MBP/SUMO fusion or 18 °C induction"
    } else if disorder_pct >= 55.0 {
        "Predominantly Intrinsically Disordered Protein (IDP >= 55%): express with protease inhibitors & low-temperature affinity capture"
    } else {
        "Favorable Folded Globular Solubility Balance (Uversky FoldIndex > 0, controlled APR burden)"
    };

    let r3 = |v: f64| (v * 1000.0).round() / 1000.0;

    ProteinDisorderAggregationEpitopeReport {
        sequence_length_aa: n,
        mean_normalized_hydropathy: r3(mean_h),
        mean_net_charge_per_residue: r3(net_charge_abs),
        global_uversky_fold_index: r3(global_fi),
        disorder_fraction_pct: disorder_pct,
        boman_binding_index_kcal_mol: (boman * 100.0).round() / 100.0,
        peak_helical_hydrophobic_moment: r3(peak_mu_h),
        soluble_expression_verdict: verdict.into(),
        disordered_regions,
        aggregation_hotspots,
        amphipathic_helices,
        top_mhc_class1_peptides: mhc_candidates,
    }
}
