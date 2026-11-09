// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Non-B DNA Secondary Structure, Epigenetic Methylation, Prokaryotic Regulatory Element,
//! and Karlin-Mrázek Compositional Genomic Island Anomaly Engine:
//! - G-Quadruplex (`G4Hunter` / `QuadParser` $G_{3+}N_{1-7}G_{3+}N_{1-7}G_{3+}N_{1-7}G_{3+}$) & i-Motif Scanner
//! - Alternating Purine-Pyrimidine Z-DNA Propensity Scanner
//! - Dam (`GATC`), Dcm (`CCWGG`), CpG (`CG`), and EcoKI (`AACN6GTGC` / `GCACN6GTT`) Methylation Profiler
//! - Prokaryotic $\sigma^{70}$ `-35` / `-10` Promoter PWM + Rho-Independent Intrinsic Terminator Finder
//! - Karlin-Mrázek Dinucleotide Relative Abundance ($\rho_{XY}^*$) & Horizontal Gene Transfer (HGT)
//!   Genomic Island Detector ($\delta^*$ compositional distance).

use crate::iupac::{clean_alpha_sequence, reverse_complement_iupac};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonBDnaMotifHit {
    pub motif_class: String, // "G-Quadruplex", "i-Motif", "Z-DNA"
    pub strand: i8,
    pub start_bp: usize, // 1-based
    pub end_bp: usize,   // 1-based
    pub length_bp: usize,
    pub sequence: String,
    pub stability_score: f64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpigeneticMethylationSummary {
    pub sequence_length_bp: usize,
    pub dam_gatc_sites: usize,
    pub dcm_ccwgg_sites: usize,
    pub cpg_dinucleotides: usize,
    pub cpg_observed_expected_ratio: f64,
    pub ecoki_type_i_sites: usize,
    pub dam_positions_sample: Vec<usize>,
    pub dcm_positions_sample: Vec<usize>,
    pub ecoki_positions_sample: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProkaryoticPromoterHit {
    pub strand: i8,
    pub minus35_start_bp: usize,
    pub minus35_hexamer: String,
    pub spacer_bp: usize,
    pub minus10_start_bp: usize,
    pub minus10_hexamer: String,
    pub predicted_tss_bp: usize,
    pub has_extended_tg_minus10: bool,
    pub pwm_log_odds_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntrinsicTerminatorHit {
    pub strand: i8,
    pub start_bp: usize,
    pub end_bp: usize,
    pub stem_left: String,
    pub loop_seq: String,
    pub stem_right: String,
    pub poly_u_tail: String,
    pub estimated_delta_g_kcal: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenomicIslandWindow {
    pub start_bp: usize,
    pub end_bp: usize,
    pub window_gc_pct: f64,
    pub gc_deviation_pct: f64,
    pub karlin_delta_star_milli: f64,
    pub is_anomalous_hgt_island: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KarlinDinucleotideReport {
    pub sequence_length_bp: usize,
    pub genome_gc_pct: f64,
    pub rho_star_16: Vec<(String, f64)>,
    pub cpg_suppression_rho: f64,
    pub tpa_suppression_rho: f64,
    pub mean_window_delta_star_milli: f64,
    pub anomalous_island_count: usize,
    pub windows: Vec<GenomicIslandWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KmerSpectrumReport {
    pub k: usize,
    pub total_kmers: usize,
    pub distinct_canonical_kmers: usize,
    pub singleton_kmers: usize,
    pub repetitive_kmers_gt2: usize,
    pub shannon_kmer_entropy_bits: f64,
    pub linguistic_complexity: f64,
    pub top_enriched_kmers: Vec<(String, usize)>,
}

/// Scans a nucleotide sequence for Non-B DNA secondary structures:
/// 1. Canonical G-quadruplexes ($G_{\ge 3} N_{1..7} G_{\ge 3} N_{1..7} G_{\ge 3} N_{1..7} G_{\ge 3}$) scored via Bedrat et al. (2016) `G4Hunter`
/// 2. Cytosine-rich i-Motifs on the complementary C-tract strand
/// 3. Left-handed Z-DNA alternating purine-pyrimidine (`(CG/GC/CA/TG) >= 12 bp`) tracts.
pub fn scan_non_b_dna_structures(raw_seq: &str, max_hits: usize) -> Vec<NonBDnaMotifHit> {
    let seq = clean_alpha_sequence(raw_seq);
    let bytes = seq.as_bytes();
    let n = bytes.len();
    let cap = max_hits.max(1);
    let mut hits = Vec::new();
    if n < 12 {
        return hits;
    }

    // Helper for G4Hunter mean skewness score over a candidate interval
    let g4hunter_score = |slice: &[u8], target_base: u8, opp_base: u8| -> f64 {
        if slice.is_empty() {
            return 0.0;
        }
        let mut sum = 0.0f64;
        let mut i = 0usize;
        while i < slice.len() {
            let b = slice[i];
            if b == target_base {
                let mut run = 1usize;
                while i + run < slice.len() && slice[i + run] == target_base {
                    run += 1;
                }
                let weight = (run.min(4)) as f64;
                sum += weight * (run as f64);
                i += run;
            } else if b == opp_base {
                let mut run = 1usize;
                while i + run < slice.len() && slice[i + run] == opp_base {
                    run += 1;
                }
                let weight = (run.min(4)) as f64;
                sum -= weight * (run as f64);
                i += run;
            } else {
                i += 1;
            }
        }
        (sum / (slice.len() as f64)).abs()
    };

    // Scan four-tract G-runs (G-Quadruplex on + strand) and C-runs (G4 on - strand / i-Motif on + strand)
    for &(tract_ch, opp_ch, strand, label) in &[
        (b'G', b'C', 1i8, "G-Quadruplex"),
        (b'C', b'G', -1i8, "i-Motif / Antisense G4"),
    ] {
        // Collect runs of >= 3 `tract_ch`
        let mut runs: Vec<(usize, usize)> = Vec::new(); // (start_0, end_0_excl)
        let mut idx = 0usize;
        while idx < n {
            if bytes[idx] == tract_ch {
                let s = idx;
                while idx < n && bytes[idx] == tract_ch {
                    idx += 1;
                }
                if idx - s >= 3 {
                    runs.push((s, idx));
                }
            } else {
                idx += 1;
            }
        }

        let mut r_idx = 0usize;
        while r_idx + 3 < runs.len() && hits.len() < cap {
            let (s0, e0) = runs[r_idx];
            let (s1, e1) = runs[r_idx + 1];
            let (s2, e2) = runs[r_idx + 2];
            let (s3, e3) = runs[r_idx + 3];
            let l1 = s1.saturating_sub(e0);
            let l2 = s2.saturating_sub(e1);
            let l3 = s3.saturating_sub(e2);
            if (1..=7).contains(&l1) && (1..=7).contains(&l2) && (1..=7).contains(&l3) {
                let sub = &bytes[s0..e3];
                let g4_score = g4hunter_score(sub, tract_ch, opp_ch);
                if g4_score >= 1.2 {
                    hits.push(NonBDnaMotifHit {
                        motif_class: label.into(),
                        strand,
                        start_bp: s0 + 1,
                        end_bp: e3,
                        length_bp: e3 - s0,
                        sequence: seq[s0..e3].to_string(),
                        stability_score: (g4_score * 100.0).round() / 100.0,
                        description: format!(
                            "4-tract Hoogsteen quartet (loops {}, {}, {} nt; G4Hunter = {:.2})",
                            l1, l2, l3, g4_score
                        ),
                    });
                    r_idx += 4;
                    continue;
                }
            }
            r_idx += 1;
        }
    }

    // Alternating Purine-Pyrimidine Z-DNA scanner (>= 12 bp strict R-Y alternation enriched in CG/GC/CA/TG)
    let is_purine = |b: u8| matches!(b, b'A' | b'G');
    let is_pyrimidine = |b: u8| matches!(b, b'C' | b'T' | b'U');

    let mut pos = 0usize;
    while pos + 12 <= n && hits.len() < cap {
        let b0 = bytes[pos];
        if !is_purine(b0) && !is_pyrimidine(b0) {
            pos += 1;
            continue;
        }
        let mut end = pos + 1;
        while end < n {
            let prev = bytes[end - 1];
            let cur = bytes[end];
            let alternates =
                (is_purine(prev) && is_pyrimidine(cur)) || (is_pyrimidine(prev) && is_purine(cur));
            if alternates {
                end += 1;
            } else {
                break;
            }
        }
        let span = end - pos;
        if span >= 12 {
            let sub = &bytes[pos..end];
            // Ho et al. Z-DNA dinucleotide free-energy weight (CG steps strongly favor syn-G Z-DNA)
            let mut cg_steps = 0usize;
            for w in sub.windows(2) {
                if w == b"CG" || w == b"GC" {
                    cg_steps += 1;
                }
            }
            let z_score = (span as f64) * 0.25 + (cg_steps as f64) * 0.65;
            if cg_steps >= 3 || span >= 16 {
                hits.push(NonBDnaMotifHit {
                    motif_class: "Z-DNA".into(),
                    strand: 1,
                    start_bp: pos + 1,
                    end_bp: end,
                    length_bp: span,
                    sequence: seq[pos..end].to_string(),
                    stability_score: (z_score * 100.0).round() / 100.0,
                    description: format!(
                        "Left-handed Z-DNA alternating purine-pyrimidine tract ({} bp, {} CpG/GpC steps)",
                        span, cg_steps
                    ),
                });
            }
        }
        pos = end.max(pos + 1);
    }

    hits.sort_by(|a, b| a.start_bp.cmp(&b.start_bp));
    hits
}

/// Profiles bacterial and eukaryotic DNA methylation motifs across an entire plasmid or chromosome:
/// - **Dam** (`GATC`, $N^6$-methyladenine at A)
/// - **Dcm** (`CCWGG`, $C^5$-methylcytosine at internal C)
/// - **CpG** (`CG`, vertebrate DNMT1/3A/3B methylation + CpG O/E suppression ratio)
/// - **EcoKI** (`AACN6GTGC` and reverse complement `GCACN6GTT`, Type I restriction-modification).
pub fn profile_epigenetic_methylation_sites(raw_seq: &str) -> EpigeneticMethylationSummary {
    let seq = clean_alpha_sequence(raw_seq);
    let bytes = seq.as_bytes();
    let n = bytes.len();

    let mut c_count = 0usize;
    let mut g_count = 0usize;
    let mut cpg_count = 0usize;
    let mut dam_count = 0usize;
    let mut dcm_count = 0usize;
    let mut ecoki_count = 0usize;

    let mut dam_sample = Vec::new();
    let mut dcm_sample = Vec::new();
    let mut ecoki_sample = Vec::new();

    for i in 0..n {
        let b = bytes[i];
        if b == b'C' {
            c_count += 1;
            if i + 1 < n && bytes[i + 1] == b'G' {
                cpg_count += 1;
            }
        } else if b == b'G' {
            g_count += 1;
        }

        if i + 4 <= n && &bytes[i..(i + 4)] == b"GATC" {
            dam_count += 1;
            if dam_sample.len() < 64 {
                dam_sample.push(i + 1);
            }
        }
        if i + 5 <= n
            && bytes[i] == b'C'
            && bytes[i + 1] == b'C'
            && matches!(bytes[i + 2], b'A' | b'T' | b'U')
            && bytes[i + 3] == b'G'
            && bytes[i + 4] == b'G'
        {
            dcm_count += 1;
            if dcm_sample.len() < 64 {
                dcm_sample.push(i + 1);
            }
        }
        if i + 13 <= n {
            let w = &bytes[i..(i + 13)];
            let fwd_match = &w[0..3] == b"AAC" && &w[9..13] == b"GTGC";
            let rev_match = &w[0..4] == b"GCAC" && &w[10..13] == b"GTT";
            if fwd_match || rev_match {
                ecoki_count += 1;
                if ecoki_sample.len() < 64 {
                    ecoki_sample.push(i + 1);
                }
            }
        }
    }

    let cpg_oe = if c_count > 0 && g_count > 0 && n > 1 {
        ((cpg_count as f64) * (n as f64)) / ((c_count as f64) * (g_count as f64))
    } else {
        0.0
    };

    EpigeneticMethylationSummary {
        sequence_length_bp: n,
        dam_gatc_sites: dam_count,
        dcm_ccwgg_sites: dcm_count,
        cpg_dinucleotides: cpg_count,
        cpg_observed_expected_ratio: (cpg_oe * 1000.0).round() / 1000.0,
        ecoki_type_i_sites: ecoki_count,
        dam_positions_sample: dam_sample,
        dcm_positions_sample: dcm_sample,
        ecoki_positions_sample: ecoki_sample,
    }
}

/// Scans prokaryotic DNA for *E. coli* $\sigma^{70}$ (`RpoD`) promoters using Harley-Reynolds / Lisser-Margalit
/// position weight matrices over the `-35` (`TTGACA`) and `-10` Pribnow box (`TATAAT`) separated by a
/// `15..=19 bp` spacer (optimal `17 bp`) plus extended `-10` `TGn` recognition.
pub fn scan_sigma70_promoters(raw_seq: &str, max_hits: usize) -> Vec<ProkaryoticPromoterHit> {
    let seq = clean_alpha_sequence(raw_seq);
    if seq.len() < 36 {
        return Vec::new();
    }

    // Log-odds weights for -35 consensus TTGACA (rows: pos 0..6, cols: A, C, G, T)
    const PWM_M35: [[f64; 4]; 6] = [
        [-0.9, -0.8, -0.9, 1.45], // T (78%)
        [-1.1, -0.9, -1.0, 1.55], // T (82%)
        [-0.8, -0.9, 1.40, -0.8], // G (75%)
        [1.15, -0.6, -0.7, -0.6], // A (62%)
        [-0.5, 1.05, -0.7, -0.5], // C (56%)
        [1.00, -0.6, -0.6, -0.4], // A (54%)
    ];
    // Log-odds weights for -10 Pribnow consensus TATAAT
    const PWM_M10: [[f64; 4]; 6] = [
        [-1.0, -0.9, -1.0, 1.50], // T (80%)
        [1.65, -1.2, -1.2, -1.1], // A (91%)
        [-0.4, -0.5, -0.6, 0.90], // T (49%)
        [1.10, -0.5, -0.5, -0.5], // A (59%)
        [0.95, -0.5, -0.5, -0.3], // A (53%)
        [-1.3, -1.2, -1.3, 1.75], // T (95%)
    ];

    let base_idx = |b: u8| -> Option<usize> {
        match b {
            b'A' => Some(0),
            b'C' => Some(1),
            b'G' => Some(2),
            b'T' | b'U' => Some(3),
            _ => None,
        }
    };

    let score_hex = |slice: &[u8], pwm: &[[f64; 4]; 6]| -> Option<f64> {
        let mut s = 0.0;
        for i in 0..6 {
            let bi = base_idx(slice[i])?;
            s += pwm[i][bi];
        }
        Some(s)
    };

    let mut candidates = Vec::new();
    let total_len = seq.len();

    for &(strand, ref strand_seq) in &[
        (1i8, seq.clone()),
        (-1i8, reverse_complement_iupac(&seq, false)),
    ] {
        let b = strand_seq.as_bytes();
        let n = b.len();
        let mut i = 0usize;
        while i + 31 <= n {
            if let Some(s35) = score_hex(&b[i..(i + 6)], &PWM_M35) {
                if s35 >= 2.2 {
                    let mut best_local: Option<ProkaryoticPromoterHit> = None;
                    for spacer in 15usize..=19usize {
                        let m10_pos = i + 6 + spacer;
                        if m10_pos + 6 > n {
                            break;
                        }
                        if let Some(s10) = score_hex(&b[m10_pos..(m10_pos + 6)], &PWM_M10) {
                            let spacer_pen = match spacer {
                                17 => 0.90,
                                16 | 18 => 0.35,
                                _ => -0.45,
                            };
                            let ext_tg = m10_pos >= 3
                                && b[m10_pos - 3] == b'T'
                                && b[m10_pos - 2] == b'G';
                            let tg_bonus = if ext_tg { 0.85 } else { 0.0 };
                            let total = s35 + s10 + spacer_pen + tg_bonus;
                            if total >= 8.2
                                && best_local
                                    .as_ref()
                                    .map(|prev| total > prev.pwm_log_odds_score)
                                    .unwrap_or(true)
                            {
                                let tss_0 = (m10_pos + 6 + 6).min(n - 1);
                                let (m35_1b, m10_1b, tss_1b) = if strand == 1 {
                                    (i + 1, m10_pos + 1, tss_0 + 1)
                                } else {
                                    (
                                        total_len - (i + 5),
                                        total_len - (m10_pos + 5),
                                        total_len - tss_0,
                                    )
                                };
                                best_local = Some(ProkaryoticPromoterHit {
                                    strand,
                                    minus35_start_bp: m35_1b,
                                    minus35_hexamer: strand_seq[i..(i + 6)].to_string(),
                                    spacer_bp: spacer,
                                    minus10_start_bp: m10_1b,
                                    minus10_hexamer: strand_seq[m10_pos..(m10_pos + 6)].to_string(),
                                    predicted_tss_bp: tss_1b,
                                    has_extended_tg_minus10: ext_tg,
                                    pwm_log_odds_score: (total * 100.0).round() / 100.0,
                                });
                            }
                        }
                    }
                    if let Some(hit) = best_local {
                        candidates.push(hit);
                        i += 12;
                        continue;
                    }
                }
            }
            i += 1;
        }
    }

    candidates.sort_by(|a, b| {
        b.pwm_log_odds_score
            .partial_cmp(&a.pwm_log_odds_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(max_hits.max(1));
    candidates
}

/// Scans prokaryotic DNA for Rho-independent (intrinsic) transcriptional terminators consisting
/// of a GC-rich palindromic RNA hairpin (`6..=11 bp` stem, `3..=8 nt` loop) immediately followed
/// by a 3' poly-U (`T`-tract on coding DNA) slippage tail (`>= 4 T` within 7 nt).
pub fn scan_rho_independent_terminators(
    raw_seq: &str,
    max_hits: usize,
) -> Vec<IntrinsicTerminatorHit> {
    let seq = clean_alpha_sequence(raw_seq);
    if seq.len() < 24 {
        return Vec::new();
    }

    let wc_pair = |a: u8, b: u8| -> Option<f64> {
        match (a, b) {
            (b'G', b'C') | (b'C', b'G') => Some(-2.4),
            (b'A', b'T') | (b'T', b'A') | (b'A', b'U') | (b'U', b'A') => Some(-1.1),
            (b'G', b'T') | (b'T', b'G') | (b'G', b'U') | (b'U', b'G') => Some(-0.5),
            _ => None,
        }
    };

    let total_len = seq.len();
    let mut hits = Vec::new();

    for &(strand, ref strand_seq) in &[
        (1i8, seq.clone()),
        (-1i8, reverse_complement_iupac(&seq, false)),
    ] {
        let b = strand_seq.as_bytes();
        let n = b.len();
        let mut tail_pos = 18usize;
        while tail_pos + 7 <= n {
            // Fast filter: check 7-nt poly-T tail (>= 5 T/U residues) first!
            let tail = &b[tail_pos..(tail_pos + 7)];
            let t_cnt = tail.iter().filter(|&&c| c == b'T' || c == b'U').count();
            if t_cnt >= 5 {
                let mut best_local: Option<IntrinsicTerminatorHit> = None;
                for stem_len in 6usize..=11usize {
                    for loop_len in 3usize..=7usize {
                        let span = 2 * stem_len + loop_len;
                        if tail_pos < span {
                            continue;
                        }
                        let s_left = tail_pos - span;
                        let left = &b[s_left..(s_left + stem_len)];
                        let lp = &b[(s_left + stem_len)..(s_left + stem_len + loop_len)];
                        let right = &b[(tail_pos - stem_len)..tail_pos];

                        let mut dg = 3.8 + (loop_len as f64) * 0.25; // Loop initiation entropy
                        let mut mismatches = 0usize;
                        let mut gc_pairs = 0usize;
                        for k in 0..stem_len {
                            let l_ch = left[k];
                            let r_ch = right[stem_len - 1 - k];
                            if let Some(e) = wc_pair(l_ch, r_ch) {
                                dg += e;
                                if matches!((l_ch, r_ch), (b'G', b'C') | (b'C', b'G')) {
                                    gc_pairs += 1;
                                }
                            } else {
                                mismatches += 1;
                                dg += 2.1;
                                if mismatches > 1 {
                                    break;
                                }
                            }
                        }

                        if mismatches <= 1
                            && gc_pairs >= 4
                            && dg <= -7.5
                            && best_local
                                .as_ref()
                                .map(|p| dg < p.estimated_delta_g_kcal)
                                .unwrap_or(true)
                        {
                            let end_0 = tail_pos + 7;
                            let (start_1b, end_1b) = if strand == 1 {
                                (s_left + 1, end_0)
                            } else {
                                (total_len - end_0 + 1, total_len - s_left)
                            };
                            best_local = Some(IntrinsicTerminatorHit {
                                strand,
                                start_bp: start_1b,
                                end_bp: end_1b,
                                stem_left: String::from_utf8_lossy(left).into_owned(),
                                loop_seq: String::from_utf8_lossy(lp).into_owned(),
                                stem_right: String::from_utf8_lossy(right).into_owned(),
                                poly_u_tail: String::from_utf8_lossy(tail)
                                    .replace('T', "U"),
                                estimated_delta_g_kcal: (dg * 100.0).round() / 100.0,
                            });
                        }
                    }
                }
                if let Some(h) = best_local {
                    hits.push(h);
                    tail_pos += 14;
                    continue;
                }
            }
            tail_pos += 1;
        }
    }

    hits.sort_by(|a, b| {
        a.estimated_delta_g_kcal
            .partial_cmp(&b.estimated_delta_g_kcal)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(max_hits.max(1));
    hits
}

/// Computes Karlin & Mrázek (1997) symmetrized double-stranded dinucleotide relative abundances
/// ($\rho_{XY}^* = f_{XY}^* / (f_X^* f_Y^*)$) and scans sliding windows for Horizontally Transferred
/// Genomic Islands / Pathogenicity Islands ($\delta^*$ compositional distance > $2\sigma$).
pub fn analyze_karlin_dinucleotide_islands(
    raw_seq: &str,
    window_bp: usize,
) -> KarlinDinucleotideReport {
    let seq = clean_alpha_sequence(raw_seq);
    let bytes = seq.as_bytes();
    let n = bytes.len();

    let base_code = |b: u8| -> Option<usize> {
        match b {
            b'A' => Some(0),
            b'C' => Some(1),
            b'G' => Some(2),
            b'T' | b'U' => Some(3),
            _ => None,
        }
    };
    const LABELS: [&str; 4] = ["A", "C", "G", "T"];
    // Complement index: A(0)<->T(3), C(1)<->G(2)
    let comp_idx = |i: usize| -> usize { 3 - i };

    let compute_rho16 = |slice: &[u8]| -> ([f64; 16], f64) {
        let mut mono = [0usize; 4];
        let mut di = [[0usize; 4]; 4];
        let mut di_tot = 0usize;

        for (idx, &ch) in slice.iter().enumerate() {
            if let Some(c1) = base_code(ch) {
                mono[c1] += 1;
                if idx + 1 < slice.len() {
                    if let Some(c2) = base_code(slice[idx + 1]) {
                        di[c1][c2] += 1;
                        di_tot += 1;
                    }
                }
            }
        }

        let mono_tot = (mono[0] + mono[1] + mono[2] + mono[3]).max(1) as f64;
        let gc_pct = (((mono[1] + mono[2]) as f64) / mono_tot) * 100.0;

        // Symmetrized double-stranded frequencies f_X* and f_XY*
        let mut f_star = [0.25f64; 4];
        for x in 0..4 {
            f_star[x] = ((mono[x] + mono[comp_idx(x)]) as f64) / (2.0 * mono_tot);
        }

        let mut rho = [1.0f64; 16];
        if di_tot > 0 {
            let denom_di = (2 * di_tot) as f64;
            for x in 0..4 {
                for y in 0..4 {
                    let sym_di =
                        ((di[x][y] + di[comp_idx(y)][comp_idx(x)]) as f64) / denom_di;
                    let prod = f_star[x] * f_star[y];
                    rho[x * 4 + y] = if prod > 1e-9 { sym_di / prod } else { 1.0 };
                }
            }
        }
        (rho, gc_pct)
    };

    if n < 16 {
        return KarlinDinucleotideReport {
            sequence_length_bp: n,
            genome_gc_pct: 0.0,
            rho_star_16: Vec::new(),
            cpg_suppression_rho: 1.0,
            tpa_suppression_rho: 1.0,
            mean_window_delta_star_milli: 0.0,
            anomalous_island_count: 0,
            windows: Vec::new(),
        };
    }

    let (genome_rho, genome_gc) = compute_rho16(bytes);
    let mut rho_pairs = Vec::with_capacity(16);
    for x in 0..4 {
        for y in 0..4 {
            let r = (genome_rho[x * 4 + y] * 1000.0).round() / 1000.0;
            rho_pairs.push((format!("{}{}", LABELS[x], LABELS[y]), r));
        }
    }

    let win = window_bp.clamp(250, 25_000).min(n);
    let step = (win / 2).max(125);
    let mut raw_windows: Vec<(usize, usize, f64, f64)> = Vec::new();

    let mut s = 0usize;
    while s < n {
        let e = (s + win).min(n);
        if e - s >= (win / 2).max(16) {
            let (w_rho, w_gc) = compute_rho16(&bytes[s..e]);
            // Karlin delta* = (1/16) * sum |rho_XY*(window) - rho_XY*(genome)| * 1000 (in milli-units)
            let delta_milli = (genome_rho
                .iter()
                .zip(w_rho.iter())
                .map(|(a, b)| (a - b).abs())
                .sum::<f64>()
                / 16.0)
                * 1000.0;
            raw_windows.push((s + 1, e, w_gc, delta_milli));
        }
        if e == n {
            break;
        }
        s += step;
    }

    let wf = raw_windows.len().max(1) as f64;
    let mean_delta = raw_windows.iter().map(|w| w.3).sum::<f64>() / wf;
    let var_delta = raw_windows
        .iter()
        .map(|w| (w.3 - mean_delta).powi(2))
        .sum::<f64>()
        / wf;
    let sd_delta = var_delta.sqrt();
    let threshold = (mean_delta + 1.85 * sd_delta).max(65.0);

    let mut anomalous_cnt = 0usize;
    let mut windows = Vec::with_capacity(raw_windows.len());
    for (ws, we, wgc, dm) in raw_windows {
        let gc_dev = wgc - genome_gc;
        let is_island = dm >= threshold || gc_dev.abs() >= 9.5;
        if is_island {
            anomalous_cnt += 1;
        }
        windows.push(GenomicIslandWindow {
            start_bp: ws,
            end_bp: we,
            window_gc_pct: (wgc * 100.0).round() / 100.0,
            gc_deviation_pct: (gc_dev * 100.0).round() / 100.0,
            karlin_delta_star_milli: (dm * 100.0).round() / 100.0,
            is_anomalous_hgt_island: is_island,
        });
    }

    KarlinDinucleotideReport {
        sequence_length_bp: n,
        genome_gc_pct: (genome_gc * 100.0).round() / 100.0,
        rho_star_16: rho_pairs,
        cpg_suppression_rho: (genome_rho[1 * 4 + 2] * 1000.0).round() / 1000.0, // CG
        tpa_suppression_rho: (genome_rho[3 * 4 + 0] * 1000.0).round() / 1000.0, // TA
        mean_window_delta_star_milli: (mean_delta * 100.0).round() / 100.0,
        anomalous_island_count: anomalous_cnt,
        windows,
    }
}

/// Computes canonical k-mer frequency spectrum, Shannon k-mer entropy, and Trifonov linguistic
/// complexity ($U_k = \text{distinct}(k) / \min(4^k, L - k + 1)$).
pub fn compute_kmer_spectrum(raw_seq: &str, k: usize) -> KmerSpectrumReport {
    let seq = clean_alpha_sequence(raw_seq);
    let bytes = seq.as_bytes();
    let k = k.clamp(3, 13);
    if bytes.len() < k {
        return KmerSpectrumReport {
            k,
            total_kmers: 0,
            distinct_canonical_kmers: 0,
            singleton_kmers: 0,
            repetitive_kmers_gt2: 0,
            shannon_kmer_entropy_bits: 0.0,
            linguistic_complexity: 0.0,
            top_enriched_kmers: Vec::new(),
        };
    }

    let b2 = |b: u8| -> Option<u32> {
        match b {
            b'A' => Some(0),
            b'C' => Some(1),
            b'G' => Some(2),
            b'T' | b'U' => Some(3),
            _ => None,
        }
    };
    let mask = (1u32 << (2 * k)) - 1;
    let shift = 2 * (k - 1);

    let mut counts: FxHashMap<u32, usize> = FxHashMap::default();
    let mut fwd = 0u32;
    let mut rev = 0u32;
    let mut run = 0usize;
    let mut total = 0usize;

    for &ch in bytes {
        if let Some(c) = b2(ch) {
            fwd = ((fwd << 2) | c) & mask;
            rev = (rev >> 2) | ((3 - c) << shift);
            run += 1;
            if run >= k {
                let canon = fwd.min(rev);
                *counts.entry(canon).or_insert(0) += 1;
                total += 1;
            }
        } else {
            run = 0;
            fwd = 0;
            rev = 0;
        }
    }

    let distinct = counts.len();
    let mut singletons = 0usize;
    let mut rep_gt2 = 0usize;
    let mut entropy = 0.0f64;
    let tot_f = total.max(1) as f64;

    for &c in counts.values() {
        if c == 1 {
            singletons += 1;
        } else if c > 2 {
            rep_gt2 += 1;
        }
        let p = (c as f64) / tot_f;
        entropy -= p * p.log2();
    }

    // Max possible canonical k-mers <= min(total, (4^k + 4^(k/2)) / 2)
    let four_k = 4usize.saturating_pow(k as u32);
    let canon_vocab = if k % 2 == 0 {
        (four_k + 4usize.saturating_pow((k / 2) as u32)) / 2
    } else {
        four_k / 2
    };
    let max_possible = total.min(canon_vocab).max(1);
    let complexity = ((distinct as f64) / (max_possible as f64)).clamp(0.0, 1.0);

    let decode_kmer = |mut code: u32| -> String {
        let mut buf = vec![b'A'; k];
        for idx in (0..k).rev() {
            buf[idx] = [b'A', b'C', b'G', b'T'][(code & 3) as usize];
            code >>= 2;
        }
        unsafe { String::from_utf8_unchecked(buf) }
    };

    let mut ranked: Vec<(u32, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let top_enriched_kmers: Vec<(String, usize)> = ranked
        .into_iter()
        .take(16)
        .map(|(code, cnt)| (decode_kmer(code), cnt))
        .collect();

    KmerSpectrumReport {
        k,
        total_kmers: total,
        distinct_canonical_kmers: distinct,
        singleton_kmers: singletons,
        repetitive_kmers_gt2: rep_gt2,
        shannon_kmer_entropy_bits: (entropy * 1000.0).round() / 1000.0,
        linguistic_complexity: (complexity * 10000.0).round() / 10000.0,
        top_enriched_kmers,
    }
}
