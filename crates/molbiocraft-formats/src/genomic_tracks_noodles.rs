// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! High-Throughput Genomic Track Analytics, CIGAR Pileup Engine, VCF Functional Consequence
//! Annotator, and BED/GFF3 Interval Algebra powered by `noodles` and `rust-bio`.
//!
//! Designed for large bacterial, viral, plastid, and eukaryotic chromosome segments:
//! 1. `compute_sam_pileup_and_coverage_noodles`: Streams SAM records via `noodles_sam`, decodes
//!    CIGAR operations (`M`, `=`, `X`, `I`, `D`, `N`, `S`, `H`), computes per-window coverage tracks,
//!    breadth of coverage (`>=1x`, `>=10x`, `>=30x`), MAPQ & insert-size distributions (`statrs`),
//!    binomial strand-bias p-values, and high-confidence pileup SNV/Indel calls.
//! 2. `annotate_vcf_coding_consequences_noodles`: Streams VCF records via `noodles_vcf`, queries
//!    annotated genomic features in $O(\log F + k)$ via `bio::data_structures::interval_tree::IntervalTree`,
//!    translates affected codons on forward and reverse strands (NCBI Genetic Codes 1 & 11),
//!    formats HGVS `c.` / `p.` coordinates, computes Grantham (1974) physicochemical distance,
//!    and summarizes Sequence Ontology impact tiers and Ts/Tv ratios.
//! 3. `intersect_genomic_intervals_noodles`: Parses BED3+ and GFF3 genomic intervals via
//!    `noodles_bed` / `noodles_gff`, sweeps & merges intervals, computes exact base-pair
//!    intersection $|A \cap B|$, union $|A \cup B|$, Jaccard similarity $J(A, B)$, fold-enrichment,
//!    and optional flanked FASTA subsequence extraction (`noodles_fasta`).

use crate::noodles_io::{parse_bed_noodles, parse_fasta_noodles, parse_gff3_noodles, parse_vcf_noodles};
use crate::pdb_mmcif::one_to_three_aa;
use bio::data_structures::interval_tree::IntervalTree;
use molbiocraft_core::{clean_sequence, reverse_complement_iupac, SequenceFeature};
use noodles_sam as sam;
use noodles_sam::alignment::record::cigar::op::Kind as CigarKind;
use serde::{Deserialize, Serialize};
use statrs::distribution::{ContinuousCDF, Normal};
use std::io::{BufReader, Cursor};

// ============================================================================
// 1. Noodles SAM CIGAR Pileup, Depth Coverage & Strand-Bias Variant Caller
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageTrackWindow {
    pub window_index: usize,
    pub start_bp: usize,
    pub end_bp: usize,
    pub mean_depth: f64,
    pub max_depth: u32,
    pub min_depth: u32,
    pub gc_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PileupVariantCall {
    pub position_bp: usize,
    pub ref_base: String,
    pub alt_allele: String,
    pub variant_class: String, // "SNV" | "Insertion" | "Deletion"
    pub total_depth: u32,
    pub alt_count: u32,
    pub allele_frequency: f64,
    pub forward_alt: u32,
    pub reverse_alt: u32,
    pub strand_bias_p_value: f64,
    pub shannon_entropy_bits: f64,
    pub phred_qual_estimate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamPileupCoverageReport {
    pub reference_length_bp: usize,
    pub total_reads: usize,
    pub mapped_reads: usize,
    pub unmapped_reads: usize,
    pub forward_strand_reads: usize,
    pub reverse_strand_reads: usize,
    pub proper_pair_reads: usize,
    pub mean_mapq: f64,
    pub mean_insert_size_bp: f64,
    pub std_insert_size_bp: f64,
    pub mean_coverage_depth: f64,
    pub median_coverage_depth: f64,
    pub std_coverage_depth: f64,
    pub max_coverage_depth: u32,
    pub breadth_1x_pct: f64,
    pub breadth_10x_pct: f64,
    pub breadth_30x_pct: f64,
    pub soft_clipped_bases: usize,
    pub aligned_bases: usize,
    pub mismatched_bases: usize,
    pub empirical_error_rate_pct: f64,
    pub coverage_windows: Vec<CoverageTrackWindow>,
    pub pileup_variants: Vec<PileupVariantCall>,
}

#[derive(Clone, Copy, Default)]
struct PileupColumn {
    depth: u32,
    a_fwd: u16,
    a_rev: u16,
    c_fwd: u16,
    c_rev: u16,
    g_fwd: u16,
    g_rev: u16,
    t_fwd: u16,
    t_rev: u16,
    del_fwd: u16,
    del_rev: u16,
    ins_fwd: u16,
    ins_rev: u16,
    q_sum: u32,
}

impl PileupColumn {
    #[inline]
    fn record_base(&mut self, base: u8, is_rev: bool, qual: u8) {
        self.depth = self.depth.saturating_add(1);
        self.q_sum = self.q_sum.saturating_add(qual as u32);
        match (base.to_ascii_uppercase(), is_rev) {
            (b'A', false) => self.a_fwd = self.a_fwd.saturating_add(1),
            (b'A', true) => self.a_rev = self.a_rev.saturating_add(1),
            (b'C', false) => self.c_fwd = self.c_fwd.saturating_add(1),
            (b'C', true) => self.c_rev = self.c_rev.saturating_add(1),
            (b'G', false) => self.g_fwd = self.g_fwd.saturating_add(1),
            (b'G', true) => self.g_rev = self.g_rev.saturating_add(1),
            (b'T' | b'U', false) => self.t_fwd = self.t_fwd.saturating_add(1),
            (b'T' | b'U', true) => self.t_rev = self.t_rev.saturating_add(1),
            _ => {}
        }
    }

    #[inline]
    fn record_deletion(&mut self, is_rev: bool) {
        self.depth = self.depth.saturating_add(1);
        if is_rev {
            self.del_rev = self.del_rev.saturating_add(1);
        } else {
            self.del_fwd = self.del_fwd.saturating_add(1);
        }
    }

    #[inline]
    fn record_insertion(&mut self, is_rev: bool) {
        if is_rev {
            self.ins_rev = self.ins_rev.saturating_add(1);
        } else {
            self.ins_fwd = self.ins_fwd.saturating_add(1);
        }
    }

    fn shannon_entropy(&self) -> f64 {
        let counts = [
            (self.a_fwd as u32 + self.a_rev as u32) as f64,
            (self.c_fwd as u32 + self.c_rev as u32) as f64,
            (self.g_fwd as u32 + self.g_rev as u32) as f64,
            (self.t_fwd as u32 + self.t_rev as u32) as f64,
            (self.del_fwd as u32 + self.del_rev as u32) as f64,
        ];
        let total: f64 = counts.iter().sum();
        if total <= 0.0 {
            return 0.0;
        }
        let mut h = 0.0;
        for &c in &counts {
            if c > 0.0 {
                let p = c / total;
                h -= p * p.log2();
            }
        }
        round3(h)
    }
}

#[inline]
fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[inline]
fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

#[inline]
fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}

/// Normal-approximated two-sided binomial p-value for strand balance ($p_0 = 0.5$)
/// using `statrs::distribution::Normal` with continuity correction.
fn binomial_strand_bias_pvalue(fwd: u32, rev: u32, global_fwd_fraction: f64) -> f64 {
    let n = (fwd + rev) as f64;
    if n < 4.0 {
        return 1.0;
    }
    let p0 = global_fwd_fraction.clamp(0.15, 0.85);
    let expected = n * p0;
    let variance = (n * p0 * (1.0 - p0)).max(1e-6);
    let diff = ((fwd as f64 - expected).abs() - 0.5).max(0.0);
    let z = diff / variance.sqrt();
    if let Ok(std_norm) = Normal::new(0.0, 1.0) {
        let p_two_sided = 2.0 * (1.0 - std_norm.cdf(z));
        round4(p_two_sided.clamp(0.0, 1.0))
    } else {
        1.0
    }
}

/// Stream SAM alignment text via `noodles_sam::io::Reader`, decode CIGAR strings onto a
/// reference genome of arbitrary size, and compute depth windows + strand-aware pileup variants.
pub fn compute_sam_pileup_and_coverage_noodles(
    reference_seq: &str,
    sam_text: &str,
    window_count: usize,
) -> SamPileupCoverageReport {
    let clean_ref = clean_sequence(reference_seq);
    let ref_bytes = clean_ref.as_bytes();
    let ref_len = ref_bytes.len();

    let cursor = Cursor::new(sam_text.as_bytes());
    let mut reader = sam::io::Reader::new(BufReader::new(cursor));
    let Ok(header) = reader.read_header() else {
        return empty_pileup_report(ref_len);
    };

    // Determine effective pileup array span (from reference sequence or SAM @SQ LN tag)
    let header_ref_len = header
        .reference_sequences()
        .values()
        .next()
        .map(|rs| usize::from(rs.length()))
        .unwrap_or(0);
    let effective_len = ref_len.max(header_ref_len).min(2_500_000);
    if effective_len == 0 {
        return empty_pileup_report(0);
    }

    let mut pileup = vec![PileupColumn::default(); effective_len];
    let mut total_reads = 0usize;
    let mut mapped_reads = 0usize;
    let mut unmapped_reads = 0usize;
    let mut forward_reads = 0usize;
    let mut reverse_reads = 0usize;
    let mut proper_pairs = 0usize;
    let mut mapq_sum = 0u64;
    let mut insert_sizes: Vec<f64> = Vec::new();
    let mut soft_clipped_bases = 0usize;
    let mut aligned_bases = 0usize;
    let mut mismatched_bases = 0usize;

    for res in reader.record_bufs(&header) {
        let Ok(rec) = res else {
            continue;
        };
        total_reads += 1;
        let flags = rec.flags();
        if flags.is_unmapped() || flags.is_secondary() || flags.is_supplementary() {
            if flags.is_unmapped() {
                unmapped_reads += 1;
            }
            continue;
        }

        mapped_reads += 1;
        let is_rev = flags.is_reverse_complemented();
        if is_rev {
            reverse_reads += 1;
        } else {
            forward_reads += 1;
        }
        if flags.is_properly_segmented() {
            proper_pairs += 1;
        }
        if let Some(mq) = rec.mapping_quality() {
            mapq_sum += u8::from(mq) as u64;
        }
        let tlen = rec.template_length();
        if tlen > 0 && tlen < 100_000 {
            insert_sizes.push(tlen as f64);
        }

        let Some(align_start) = rec.alignment_start().map(usize::from) else {
            continue;
        };
        let mut ref_idx = align_start.saturating_sub(1); // 0-based reference index
        let mut read_idx = 0usize;
        let seq_slice = rec.sequence().as_ref();
        let qual_slice = rec.quality_scores().as_ref();

        for op in rec.cigar().as_ref() {
            let op_len = op.len();
            match op.kind() {
                CigarKind::Match | CigarKind::SequenceMatch | CigarKind::SequenceMismatch => {
                    for _ in 0..op_len {
                        if ref_idx < effective_len && read_idx < seq_slice.len() {
                            let base = seq_slice[read_idx].to_ascii_uppercase();
                            let raw_q = qual_slice.get(read_idx).copied().unwrap_or(30);
                            let phred_q = if raw_q > 60 { raw_q.saturating_sub(33) } else { raw_q };
                            pileup[ref_idx].record_base(base, is_rev, phred_q);
                            aligned_bases += 1;
                            if ref_idx < ref_len && base != ref_bytes[ref_idx] && base != b'N' {
                                mismatched_bases += 1;
                            }
                        }
                        ref_idx += 1;
                        read_idx += 1;
                    }
                }
                CigarKind::Insertion => {
                    let anchor_idx = ref_idx.saturating_sub(1).min(effective_len.saturating_sub(1));
                    if anchor_idx < effective_len {
                        pileup[anchor_idx].record_insertion(is_rev);
                    }
                    read_idx += op_len;
                }
                CigarKind::Deletion => {
                    for _ in 0..op_len {
                        if ref_idx < effective_len {
                            pileup[ref_idx].record_deletion(is_rev);
                        }
                        ref_idx += 1;
                    }
                }
                CigarKind::Skip => {
                    ref_idx += op_len;
                }
                CigarKind::SoftClip => {
                    soft_clipped_bases += op_len;
                    read_idx += op_len;
                }
                CigarKind::HardClip | CigarKind::Pad => {}
            }
        }
    }

    // Coverage summary metrics
    let mut depth_sum = 0u64;
    let mut max_depth = 0u32;
    let mut covered_1x = 0usize;
    let mut covered_10x = 0usize;
    let mut covered_30x = 0usize;
    let mut sampled_depths: Vec<u32> = Vec::with_capacity(effective_len.min(65_536));
    let sample_stride = (effective_len / 65_536).max(1);

    for (i, col) in pileup.iter().enumerate() {
        let d = col.depth;
        depth_sum += d as u64;
        if d > max_depth {
            max_depth = d;
        }
        if d >= 1 {
            covered_1x += 1;
        }
        if d >= 10 {
            covered_10x += 1;
        }
        if d >= 30 {
            covered_30x += 1;
        }
        if i % sample_stride == 0 {
            sampled_depths.push(d);
        }
    }

    let mean_cov = depth_sum as f64 / effective_len as f64;
    sampled_depths.sort_unstable();
    let median_cov = if sampled_depths.is_empty() {
        0.0
    } else {
        sampled_depths[sampled_depths.len() / 2] as f64
    };
    let var_cov = if sampled_depths.len() > 1 {
        sampled_depths
            .iter()
            .map(|&d| {
                let diff = d as f64 - mean_cov;
                diff * diff
            })
            .sum::<f64>()
            / (sampled_depths.len() - 1) as f64
    } else {
        0.0
    };

    // Insert size statistics
    let (mean_ins, std_ins) = if insert_sizes.is_empty() {
        (0.0, 0.0)
    } else {
        let m = insert_sizes.iter().sum::<f64>() / insert_sizes.len() as f64;
        let v = if insert_sizes.len() > 1 {
            insert_sizes.iter().map(|&x| (x - m) * (x - m)).sum::<f64>()
                / (insert_sizes.len() - 1) as f64
        } else {
            0.0
        };
        (round1(m), round1(v.sqrt()))
    };

    // Build fixed-count coverage windows across chromosome
    let bins = window_count.clamp(8, 512).min(effective_len);
    let mut coverage_windows = Vec::with_capacity(bins);
    for b in 0..bins {
        let s = (b * effective_len) / bins;
        let e = (((b + 1) * effective_len) / bins).max(s + 1).min(effective_len);
        let span = (e - s) as f64;
        let mut w_sum = 0u64;
        let mut w_max = 0u32;
        let mut w_min = u32::MAX;
        let mut gc = 0usize;
        for idx in s..e {
            let d = pileup[idx].depth;
            w_sum += d as u64;
            if d > w_max {
                w_max = d;
            }
            if d < w_min {
                w_min = d;
            }
            if idx < ref_len && matches!(ref_bytes[idx], b'G' | b'C') {
                gc += 1;
            }
        }
        coverage_windows.push(CoverageTrackWindow {
            window_index: b,
            start_bp: s + 1,
            end_bp: e,
            mean_depth: round2(w_sum as f64 / span),
            max_depth: w_max,
            min_depth: if w_min == u32::MAX { 0 } else { w_min },
            gc_percent: if ref_len >= e {
                round1((gc as f64 / span) * 100.0)
            } else {
                0.0
            },
        });
    }

    // Call high-confidence pileup SNVs and Indels
    let global_fwd_frac = if mapped_reads > 0 {
        forward_reads as f64 / mapped_reads as f64
    } else {
        0.5
    };
    let mut pileup_variants = Vec::new();
    for (idx, col) in pileup.iter().enumerate() {
        if col.depth < 3 || pileup_variants.len() >= 256 {
            continue;
        }
        let ref_b = if idx < ref_len { ref_bytes[idx] } else { b'N' };
        let candidates: [(u8, &str, u32, u32, &str); 5] = [
            (b'A', "A", col.a_fwd as u32, col.a_rev as u32, "SNV"),
            (b'C', "C", col.c_fwd as u32, col.c_rev as u32, "SNV"),
            (b'G', "G", col.g_fwd as u32, col.g_rev as u32, "SNV"),
            (b'T', "T", col.t_fwd as u32, col.t_rev as u32, "SNV"),
            (b'-', "-", col.del_fwd as u32, col.del_rev as u32, "Deletion"),
        ];

        let mut best_alt: Option<(&str, u32, u32, &str)> = None;
        for (b_code, label, fwd, rev, vclass) in candidates {
            if b_code == ref_b {
                continue;
            }
            let cnt = fwd + rev;
            if cnt >= 2 && (cnt as f64 / col.depth as f64) >= 0.18 {
                if best_alt.map(|(_, bf, br, _)| cnt > bf + br).unwrap_or(true) {
                    best_alt = Some((label, fwd, rev, vclass));
                }
            }
        }

        // Also check anchored insertions
        let ins_cnt = col.ins_fwd as u32 + col.ins_rev as u32;
        if ins_cnt >= 2 && (ins_cnt as f64 / col.depth as f64) >= 0.20 {
            if best_alt.map(|(_, bf, br, _)| ins_cnt > bf + br).unwrap_or(true) {
                best_alt = Some(("+INS", col.ins_fwd as u32, col.ins_rev as u32, "Insertion"));
            }
        }

        if let Some((alt_str, fwd_alt, rev_alt, vclass)) = best_alt {
            let alt_cnt = fwd_alt + rev_alt;
            let af = (alt_cnt as f64 / col.depth as f64).clamp(0.0, 1.0);
            let mean_q = (col.q_sum as f64 / col.depth.max(1) as f64).clamp(10.0, 42.0);
            let phred_est = ((alt_cnt as f64) * (mean_q * 0.28) * af).clamp(12.0, 99.0);
            pileup_variants.push(PileupVariantCall {
                position_bp: idx + 1,
                ref_base: (ref_b as char).to_string(),
                alt_allele: alt_str.to_string(),
                variant_class: vclass.to_string(),
                total_depth: col.depth,
                alt_count: alt_cnt,
                allele_frequency: round3(af),
                forward_alt: fwd_alt,
                reverse_alt: rev_alt,
                strand_bias_p_value: binomial_strand_bias_pvalue(
                    fwd_alt,
                    rev_alt,
                    global_fwd_frac,
                ),
                shannon_entropy_bits: col.shannon_entropy(),
                phred_qual_estimate: round1(phred_est),
            });
        }
    }

    let denom_len = effective_len as f64;
    SamPileupCoverageReport {
        reference_length_bp: effective_len,
        total_reads,
        mapped_reads,
        unmapped_reads,
        forward_strand_reads: forward_reads,
        reverse_strand_reads: reverse_reads,
        proper_pair_reads: proper_pairs,
        mean_mapq: if mapped_reads > 0 {
            round1(mapq_sum as f64 / mapped_reads as f64)
        } else {
            0.0
        },
        mean_insert_size_bp: mean_ins,
        std_insert_size_bp: std_ins,
        mean_coverage_depth: round2(mean_cov),
        median_coverage_depth: round2(median_cov),
        std_coverage_depth: round2(var_cov.sqrt()),
        max_coverage_depth: max_depth,
        breadth_1x_pct: round1((covered_1x as f64 / denom_len) * 100.0),
        breadth_10x_pct: round1((covered_10x as f64 / denom_len) * 100.0),
        breadth_30x_pct: round1((covered_30x as f64 / denom_len) * 100.0),
        soft_clipped_bases,
        aligned_bases,
        mismatched_bases,
        empirical_error_rate_pct: if aligned_bases > 0 {
            round3((mismatched_bases as f64 / aligned_bases as f64) * 100.0)
        } else {
            0.0
        },
        coverage_windows,
        pileup_variants,
    }
}

fn empty_pileup_report(ref_len: usize) -> SamPileupCoverageReport {
    SamPileupCoverageReport {
        reference_length_bp: ref_len,
        total_reads: 0,
        mapped_reads: 0,
        unmapped_reads: 0,
        forward_strand_reads: 0,
        reverse_strand_reads: 0,
        proper_pair_reads: 0,
        mean_mapq: 0.0,
        mean_insert_size_bp: 0.0,
        std_insert_size_bp: 0.0,
        mean_coverage_depth: 0.0,
        median_coverage_depth: 0.0,
        std_coverage_depth: 0.0,
        max_coverage_depth: 0,
        breadth_1x_pct: 0.0,
        breadth_10x_pct: 0.0,
        breadth_30x_pct: 0.0,
        soft_clipped_bases: 0,
        aligned_bases: 0,
        mismatched_bases: 0,
        empirical_error_rate_pct: 0.0,
        coverage_windows: Vec::new(),
        pileup_variants: Vec::new(),
    }
}

// ============================================================================
// 2. VCF Coding Consequence Annotator (`noodles-vcf` + `rust-bio` IntervalTree)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotatedVcfConsequence {
    pub chrom: String,
    pub position_bp: usize,
    pub ref_allele: String,
    pub alt_allele: String,
    pub quality: Option<f32>,
    pub consequence_term: String,
    pub impact_tier: String, // "HIGH" | "MODERATE" | "LOW" | "MODIFIER"
    pub feature_name: Option<String>,
    pub feature_type: Option<String>,
    pub strand: i8,
    pub hgvs_coding: String,
    pub hgvs_protein: Option<String>,
    pub ref_codon: Option<String>,
    pub alt_codon: Option<String>,
    pub grantham_distance: Option<u16>,
    pub is_transition: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcfConsequenceSummaryReport {
    pub total_variants: usize,
    pub snv_count: usize,
    pub indel_count: usize,
    pub transitions: usize,
    pub transversions: usize,
    pub ts_tv_ratio: f64,
    pub high_impact_count: usize,
    pub moderate_impact_count: usize,
    pub low_impact_count: usize,
    pub modifier_impact_count: usize,
    pub annotated_variants: Vec<AnnotatedVcfConsequence>,
}

/// Translates one codon with the NCBI table the caller resolved (`resolve_genetic_code`): the same
/// tables `translate_sequence` reads, so every NCBI code gives the same amino acids here (BG-01M6SC3D).
fn translate_dna_triplet(codon: &[u8], genetic_code_id: u8) -> u8 {
    molbiocraft_core::genetic_codes::translate_codon(codon, genetic_code_id)
}

/// Grantham (1974) amino-acid physicochemical properties `(composition c, polarity p, volume v)`.
fn grantham_props(aa: u8) -> Option<(f64, f64, f64)> {
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

/// Compute Grantham (1974) *Science* 185:862-864 chemical distance $D_{ij} \in [5, 215]$.
pub fn compute_grantham_distance(aa1: u8, aa2: u8) -> Option<u16> {
    if aa1 == aa2 {
        return Some(0);
    }
    let (c1, p1, v1) = grantham_props(aa1)?;
    let (c2, p2, v2) = grantham_props(aa2)?;
    let dc = c1 - c2;
    let dp = p1 - p2;
    let dv = v1 - v2;
    // Grantham constants: alpha = 1.833, beta = 0.1018, gamma = 0.000399, scale = 50.723
    let dist = 50.723 * (1.833 * dc * dc + 0.1018 * dp * dp + 0.000399 * dv * dv).sqrt();
    Some(dist.round() as u16)
}

#[inline]
fn is_purine_pyrimidine_transition(r: &str, a: &str) -> Option<bool> {
    if r.len() != 1 || a.len() != 1 {
        return None;
    }
    let rb = r.as_bytes()[0].to_ascii_uppercase();
    let ab = a.as_bytes()[0].to_ascii_uppercase();
    if rb == ab {
        return None;
    }
    Some(matches!(
        (rb, ab),
        (b'A', b'G') | (b'G', b'A') | (b'C', b'T') | (b'T', b'C')
    ))
}

/// Annotate VCF variants against reference sequence and `SequenceFeature` annotations
/// using `noodles_vcf` + `bio::data_structures::interval_tree::IntervalTree`.
pub fn annotate_vcf_coding_consequences_noodles(
    reference_seq: &str,
    features: &[SequenceFeature],
    vcf_text: &str,
    genetic_code_id: u8,
) -> VcfConsequenceSummaryReport {
    let clean_ref = clean_sequence(reference_seq);
    let ref_bytes = clean_ref.as_bytes();
    let ref_len = ref_bytes.len();
    let parsed_vcf = parse_vcf_noodles(vcf_text);

    // Build rust-bio IntervalTree over 1-based inclusive feature intervals (+200 bp promoter neighborhood)
    let mut tree: IntervalTree<usize, usize> = IntervalTree::new();
    for (idx, feat) in features.iter().enumerate() {
        let s = feat.start.min(feat.end).max(1);
        let e = feat.end.max(feat.start).max(s);
        tree.insert(s..e.saturating_add(1), idx);
    }

    let mut snv_count = 0usize;
    let mut indel_count = 0usize;
    let mut transitions = 0usize;
    let mut transversions = 0usize;
    let mut high_impact = 0usize;
    let mut moderate_impact = 0usize;
    let mut low_impact = 0usize;
    let mut modifier_impact = 0usize;
    let mut annotated_variants = Vec::new();

    for var in parsed_vcf {
        let pos = var.position.max(1);
        let ref_allele = var.ref_bases.to_ascii_uppercase();
        let alts = if var.alt_bases.is_empty() {
            vec!["N".to_string()]
        } else {
            var.alt_bases.clone()
        };

        for raw_alt in alts {
            let alt_allele = raw_alt.to_ascii_uppercase();
            let is_snv = ref_allele.len() == 1 && alt_allele.len() == 1;
            let mut is_ti = false;
            if is_snv {
                snv_count += 1;
                if let Some(ti) = is_purine_pyrimidine_transition(&ref_allele, &alt_allele) {
                    is_ti = ti;
                    if ti {
                        transitions += 1;
                    } else {
                        transversions += 1;
                    }
                }
            } else {
                indel_count += 1;
            }

            // Query overlapping features via rust-bio IntervalTree
            let hits: Vec<usize> = tree
                .find(pos..pos.saturating_add(ref_allele.len().max(1)))
                .map(|e| *e.data())
                .collect();

            // Prefer CDS > promoter/regulatory > other overlapping feature
            let chosen_feat = hits
                .iter()
                .copied()
                .max_by_key(|&fi| match features[fi].feature_type.as_str() {
                    "CDS" => 4,
                    "exon" | "gene" | "mRNA" => 3,
                    "promoter" | "regulatory" | "RBS" => 2,
                    _ => 1,
                })
                .map(|fi| &features[fi]);

            if let Some(feat) = chosen_feat {
                if feat.feature_type.eq_ignore_ascii_case("CDS")
                    && feat.end <= ref_len
                    && feat.start >= 1
                    && feat.end >= feat.start + 2
                {
                    let (conseq, impact, hgvs_c, hgvs_p, r_cod, a_cod, grantham) =
                        evaluate_cds_variant_effect(
                            ref_bytes,
                            feat,
                            pos,
                            &ref_allele,
                            &alt_allele,
                            genetic_code_id,
                        );
                    match impact.as_str() {
                        "HIGH" => high_impact += 1,
                        "MODERATE" => moderate_impact += 1,
                        "LOW" => low_impact += 1,
                        _ => modifier_impact += 1,
                    }
                    annotated_variants.push(AnnotatedVcfConsequence {
                        chrom: var.chrom.clone(),
                        position_bp: pos,
                        ref_allele: ref_allele.clone(),
                        alt_allele,
                        quality: var.quality,
                        consequence_term: conseq,
                        impact_tier: impact,
                        feature_name: Some(feat.name.clone()),
                        feature_type: Some(feat.feature_type.clone()),
                        strand: feat.strand,
                        hgvs_coding: hgvs_c,
                        hgvs_protein: hgvs_p,
                        ref_codon: r_cod,
                        alt_codon: a_cod,
                        grantham_distance: grantham,
                        is_transition: is_ti,
                    });
                    continue;
                }

                // Non-CDS annotated feature (promoter, RBS, terminator, regulatory, UTR)
                let conseq = if feat.feature_type.eq_ignore_ascii_case("promoter")
                    || feat.feature_type.eq_ignore_ascii_case("RBS")
                {
                    "regulatory_region_variant"
                } else {
                    "non_coding_transcript_variant"
                };
                modifier_impact += 1;
                annotated_variants.push(AnnotatedVcfConsequence {
                    chrom: var.chrom.clone(),
                    position_bp: pos,
                    ref_allele: ref_allele.clone(),
                    alt_allele: alt_allele.clone(),
                    quality: var.quality,
                    consequence_term: conseq.into(),
                    impact_tier: "MODIFIER".into(),
                    feature_name: Some(feat.name.clone()),
                    feature_type: Some(feat.feature_type.clone()),
                    strand: feat.strand,
                    hgvs_coding: format!("n.{}{}>{}", pos, ref_allele, alt_allele),
                    hgvs_protein: None,
                    ref_codon: None,
                    alt_codon: None,
                    grantham_distance: None,
                    is_transition: is_ti,
                });
            } else {
                // Check if within 150 bp upstream of any feature
                let upstream_feat = features.iter().find(|f| {
                    if f.strand >= 0 {
                        pos < f.start && f.start.saturating_sub(pos) <= 150
                    } else {
                        pos > f.end && pos.saturating_sub(f.end) <= 150
                    }
                });
                modifier_impact += 1;
                annotated_variants.push(AnnotatedVcfConsequence {
                    chrom: var.chrom.clone(),
                    position_bp: pos,
                    ref_allele: ref_allele.clone(),
                    alt_allele: alt_allele.clone(),
                    quality: var.quality,
                    consequence_term: if upstream_feat.is_some() {
                        "upstream_gene_variant".into()
                    } else {
                        "intergenic_variant".into()
                    },
                    impact_tier: "MODIFIER".into(),
                    feature_name: upstream_feat.map(|f| f.name.clone()),
                    feature_type: upstream_feat.map(|f| f.feature_type.clone()),
                    strand: upstream_feat.map(|f| f.strand).unwrap_or(1),
                    hgvs_coding: format!("g.{}{}>{}", pos, ref_allele, alt_allele),
                    hgvs_protein: None,
                    ref_codon: None,
                    alt_codon: None,
                    grantham_distance: None,
                    is_transition: is_ti,
                });
            }
        }
    }

    let ts_tv = if transversions > 0 {
        round2(transitions as f64 / transversions as f64)
    } else {
        transitions as f64
    };

    VcfConsequenceSummaryReport {
        total_variants: annotated_variants.len(),
        snv_count,
        indel_count,
        transitions,
        transversions,
        ts_tv_ratio: ts_tv,
        high_impact_count: high_impact,
        moderate_impact_count: moderate_impact,
        low_impact_count: low_impact,
        modifier_impact_count: modifier_impact,
        annotated_variants,
    }
}

fn evaluate_cds_variant_effect(
    ref_bytes: &[u8],
    feat: &SequenceFeature,
    pos_bp: usize,
    ref_allele: &str,
    alt_allele: &str,
    genetic_code_id: u8,
) -> (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<u16>,
) {
    let f_start = feat.start;
    let f_end = feat.end;
    let len_delta = alt_allele.len() as isize - ref_allele.len() as isize;

    // Indel inside CDS
    if ref_allele.len() != 1 || alt_allele.len() != 1 {
        let cds_offset = if feat.strand >= 0 {
            pos_bp.saturating_sub(f_start) + 1
        } else {
            f_end.saturating_sub(pos_bp) + 1
        };
        let aa_pos = ((cds_offset.saturating_sub(1)) / 3) + 1;
        if len_delta.rem_euclid(3) != 0 {
            return (
                "frameshift_variant".into(),
                "HIGH".into(),
                format!("c.{}del{}ins{}", cds_offset, ref_allele, alt_allele),
                Some(format!("p.AA{}fs", aa_pos)),
                None,
                None,
                None,
            );
        }
        let term = if len_delta > 0 {
            "inframe_insertion"
        } else {
            "inframe_deletion"
        };
        return (
            term.into(),
            "MODERATE".into(),
            format!("c.{}del{}ins{}", cds_offset, ref_allele, alt_allele),
            Some(format!("p.AA{}delins", aa_pos)),
            None,
            None,
            None,
        );
    }

    // Single-nucleotide substitution in CDS
    let cds_raw = &ref_bytes[(f_start - 1)..f_end];
    let (cds_coding_seq, cds_offset_0, coding_alt_byte) = if feat.strand >= 0 {
        let off = pos_bp.saturating_sub(f_start);
        (
            String::from_utf8_lossy(cds_raw).into_owned(),
            off,
            alt_allele.as_bytes()[0],
        )
    } else {
        let rc_cds = reverse_complement_iupac(&String::from_utf8_lossy(cds_raw), false);
        let rc_alt = reverse_complement_iupac(alt_allele, false);
        let off = f_end.saturating_sub(pos_bp);
        (rc_cds, off, rc_alt.as_bytes()[0])
    };

    let cds_bytes = cds_coding_seq.as_bytes();
    let codon_idx = cds_offset_0 / 3;
    let codon_start = codon_idx * 3;
    if codon_start + 3 > cds_bytes.len() {
        return (
            "coding_sequence_variant".into(),
            "MODIFIER".into(),
            format!("c.{}{}>{}", cds_offset_0 + 1, ref_allele, alt_allele),
            None,
            None,
            None,
            None,
        );
    }

    let ref_codon = [
        cds_bytes[codon_start],
        cds_bytes[codon_start + 1],
        cds_bytes[codon_start + 2],
    ];
    let mut alt_codon = ref_codon;
    let frame_pos = cds_offset_0 % 3;
    let coding_ref_char = ref_codon[frame_pos] as char;
    alt_codon[frame_pos] = coding_alt_byte;

    let ref_aa = translate_dna_triplet(&ref_codon, genetic_code_id);
    let alt_aa = translate_dna_triplet(&alt_codon, genetic_code_id);
    let aa_num = codon_idx + 1;
    let hgvs_aa3 = |aa: u8| -> String {
        if aa == b'*' {
            return "Ter".to_string();
        }
        let upper = one_to_three_aa(aa);
        let mut chars = upper.chars();
        match chars.next() {
            Some(first) => format!("{}{}", first, chars.as_str().to_ascii_lowercase()),
            None => "Xaa".to_string(),
        }
    };
    let ref_aa3 = hgvs_aa3(ref_aa);
    let alt_aa3 = hgvs_aa3(alt_aa);

    let hgvs_c = format!(
        "c.{}{}>{}",
        cds_offset_0 + 1,
        coding_ref_char,
        coding_alt_byte as char
    );
    let ref_codon_str = String::from_utf8_lossy(&ref_codon).into_owned();
    let alt_codon_str = String::from_utf8_lossy(&alt_codon).into_owned();

    if ref_aa == alt_aa {
        (
            "synonymous_variant".into(),
            "LOW".into(),
            hgvs_c,
            Some(format!("p.{}{}=", ref_aa3, aa_num)),
            Some(ref_codon_str),
            Some(alt_codon_str),
            Some(0),
        )
    } else if alt_aa == b'*' {
        (
            "stop_gained".into(),
            "HIGH".into(),
            hgvs_c,
            Some(format!("p.{}{}Ter", ref_aa3, aa_num)),
            Some(ref_codon_str),
            Some(alt_codon_str),
            None,
        )
    } else if ref_aa == b'*' {
        (
            "stop_lost".into(),
            "HIGH".into(),
            hgvs_c,
            Some(format!("p.Ter{}{}ext*?", aa_num, alt_aa3)),
            Some(ref_codon_str),
            Some(alt_codon_str),
            None,
        )
    } else if aa_num == 1 && ref_aa == b'M' {
        (
            "start_lost".into(),
            "HIGH".into(),
            hgvs_c,
            Some(format!("p.Met1? ({})", alt_aa3)),
            Some(ref_codon_str),
            Some(alt_codon_str),
            compute_grantham_distance(ref_aa, alt_aa),
        )
    } else {
        (
            "missense_variant".into(),
            "MODERATE".into(),
            hgvs_c,
            Some(format!("p.{}{}{}", ref_aa3, aa_num, alt_aa3)),
            Some(ref_codon_str),
            Some(alt_codon_str),
            compute_grantham_distance(ref_aa, alt_aa),
        )
    }
}

// ============================================================================
// 3. BED / GFF3 Interval Algebra, Jaccard Overlap & Flanked FASTA Extraction
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntersectedIntervalRecord {
    pub chrom: String,
    pub start_bp: usize,
    pub end_bp: usize,
    pub overlap_length_bp: usize,
    pub track_a_label: String,
    pub track_b_label: String,
    pub extracted_sequence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenomicIntervalAlgebraReport {
    pub track_a_interval_count: usize,
    pub track_b_interval_count: usize,
    pub track_a_covered_bp: usize,
    pub track_b_covered_bp: usize,
    pub intersection_bp: usize,
    pub union_bp: usize,
    pub jaccard_similarity: f64,
    pub overlap_fraction_of_a: f64,
    pub overlap_fraction_of_b: f64,
    pub fold_enrichment_vs_genome: f64,
    pub intersected_intervals: Vec<IntersectedIntervalRecord>,
}

#[derive(Clone, Debug)]
struct RawTrackInterval {
    chrom: String,
    start: usize, // 1-based inclusive
    end: usize,   // 1-based inclusive
    label: String,
}

fn parse_bed_or_gff_intervals(text: &str) -> Vec<RawTrackInterval> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let is_gff = trimmed.starts_with("##gff")
        || trimmed
            .lines()
            .find(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .map(|l| l.split('\t').count() >= 8)
            .unwrap_or(false);

    if is_gff {
        parse_gff3_noodles(trimmed)
            .into_iter()
            .map(|f| {
                let chrom = f
                    .notes
                    .as_deref()
                    .and_then(|n| n.rsplit('(').next())
                    .map(|s| s.trim_end_matches(')').to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "chr1".into());
                RawTrackInterval {
                    chrom,
                    start: f.start.min(f.end).max(1),
                    end: f.end.max(f.start).max(1),
                    label: f.name,
                }
            })
            .collect()
    } else {
        parse_bed_noodles(trimmed)
            .into_iter()
            .map(|f| {
                let chrom = f
                    .notes
                    .as_deref()
                    .and_then(|n| n.strip_prefix("BED interval on "))
                    .unwrap_or("chr1")
                    .to_string();
                RawTrackInterval {
                    chrom,
                    start: f.start.min(f.end).max(1),
                    end: f.end.max(f.start).max(1),
                    label: f.name,
                }
            })
            .collect()
    }
}

fn merge_sorted_intervals(mut intervals: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    if intervals.is_empty() {
        return Vec::new();
    }
    intervals.sort_unstable_by_key(|&(s, e)| (s, e));
    let mut merged = Vec::with_capacity(intervals.len());
    let (mut cur_s, mut cur_e) = intervals[0];
    for &(s, e) in &intervals[1..] {
        if s <= cur_e + 1 {
            cur_e = cur_e.max(e);
        } else {
            merged.push((cur_s, cur_e));
            cur_s = s;
            cur_e = e;
        }
    }
    merged.push((cur_s, cur_e));
    merged
}

/// Compute exact multi-chromosome BED/GFF3 interval intersection, union, Jaccard similarity,
/// genome enrichment fold-change, and optional flanked FASTA subsequence extraction.
pub fn intersect_genomic_intervals_noodles(
    track_a_text: &str,
    track_b_text: &str,
    reference_fasta_opt: Option<&str>,
    flank_bp: usize,
) -> GenomicIntervalAlgebraReport {
    let track_a = parse_bed_or_gff_intervals(track_a_text);
    let track_b = parse_bed_or_gff_intervals(track_b_text);

    // Optional reference sequences parsed via `noodles_fasta`
    let ref_docs = reference_fasta_opt
        .filter(|s| !s.trim().is_empty())
        .map(|s| parse_fasta_noodles(s, "chr1"))
        .unwrap_or_default();
    let genome_size_bp: usize = if ref_docs.is_empty() {
        let max_coord = track_a
            .iter()
            .chain(track_b.iter())
            .map(|iv| iv.end)
            .max()
            .unwrap_or(1);
        max_coord.max(1)
    } else {
        ref_docs.iter().map(|d| d.sequence.len()).sum::<usize>().max(1)
    };

    // Collect distinct chromosomes
    let mut chroms: Vec<String> = track_a
        .iter()
        .chain(track_b.iter())
        .map(|iv| iv.chrom.clone())
        .collect();
    chroms.sort();
    chroms.dedup();

    let mut total_a_bp = 0usize;
    let mut total_b_bp = 0usize;
    let mut total_inter_bp = 0usize;
    let mut intersected_intervals = Vec::new();

    for chrom in &chroms {
        let a_chr: Vec<&RawTrackInterval> = track_a.iter().filter(|iv| &iv.chrom == chrom).collect();
        let b_chr: Vec<&RawTrackInterval> = track_b.iter().filter(|iv| &iv.chrom == chrom).collect();

        let merged_a = merge_sorted_intervals(a_chr.iter().map(|iv| (iv.start, iv.end)).collect());
        let merged_b = merge_sorted_intervals(b_chr.iter().map(|iv| (iv.start, iv.end)).collect());

        total_a_bp += merged_a.iter().map(|&(s, e)| e - s + 1).sum::<usize>();
        total_b_bp += merged_b.iter().map(|&(s, e)| e - s + 1).sum::<usize>();

        // Exact merged base-pair intersection via two-pointer sweep
        let mut ia = 0usize;
        let mut ib = 0usize;
        while ia < merged_a.len() && ib < merged_b.len() {
            let (as0, ae0) = merged_a[ia];
            let (bs0, be0) = merged_b[ib];
            let os = as0.max(bs0);
            let oe = ae0.min(be0);
            if os <= oe {
                total_inter_bp += oe - os + 1;
            }
            if ae0 < be0 {
                ia += 1;
            } else {
                ib += 1;
            }
        }

        // Feature-level pairwise overlap queries via rust-bio IntervalTree
        if !a_chr.is_empty() && !b_chr.is_empty() {
            let mut b_tree: IntervalTree<usize, usize> = IntervalTree::new();
            for (b_idx, biv) in b_chr.iter().enumerate() {
                b_tree.insert(biv.start..biv.end.saturating_add(1), b_idx);
            }
            let ref_seq_for_chrom = ref_docs
                .iter()
                .find(|d| d.name.eq_ignore_ascii_case(chrom))
                .or_else(|| ref_docs.first())
                .map(|d| d.sequence.as_str());

            for aiv in &a_chr {
                for hit in b_tree.find(aiv.start..aiv.end.saturating_add(1)) {
                    let biv = b_chr[*hit.data()];
                    let os = aiv.start.max(biv.start);
                    let oe = aiv.end.min(biv.end);
                    if os <= oe && intersected_intervals.len() < 256 {
                        let extracted = ref_seq_for_chrom.and_then(|seq| {
                            let s0 = os.saturating_sub(1 + flank_bp);
                            let e0 = (oe + flank_bp).min(seq.len());
                            if s0 < e0 && e0 <= seq.len() {
                                Some(seq[s0..e0].to_string())
                            } else {
                                None
                            }
                        });
                        intersected_intervals.push(IntersectedIntervalRecord {
                            chrom: chrom.clone(),
                            start_bp: os,
                            end_bp: oe,
                            overlap_length_bp: oe - os + 1,
                            track_a_label: aiv.label.clone(),
                            track_b_label: biv.label.clone(),
                            extracted_sequence: extracted,
                        });
                    }
                }
            }
        }
    }

    let union_bp = (total_a_bp + total_b_bp).saturating_sub(total_inter_bp);
    let jaccard = if union_bp > 0 {
        round4(total_inter_bp as f64 / union_bp as f64)
    } else {
        0.0
    };
    let expected_inter =
        (total_a_bp as f64 * total_b_bp as f64) / (genome_size_bp as f64).max(1.0);
    let fold_enrichment = if expected_inter > 1e-6 {
        round2(total_inter_bp as f64 / expected_inter)
    } else {
        0.0
    };

    GenomicIntervalAlgebraReport {
        track_a_interval_count: track_a.len(),
        track_b_interval_count: track_b.len(),
        track_a_covered_bp: total_a_bp,
        track_b_covered_bp: total_b_bp,
        intersection_bp: total_inter_bp,
        union_bp,
        jaccard_similarity: jaccard,
        overlap_fraction_of_a: if total_a_bp > 0 {
            round4(total_inter_bp as f64 / total_a_bp as f64)
        } else {
            0.0
        },
        overlap_fraction_of_b: if total_b_bp > 0 {
            round4(total_inter_bp as f64 / total_b_bp as f64)
        } else {
            0.0
        },
        fold_enrichment_vs_genome: fold_enrichment,
        intersected_intervals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sam_pileup_decodes_cigar_coverage_and_calls_snvs() {
        let ref_seq = "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAG";
        let sam = "\
@HD\tVN:1.6\tSO:coordinate
@SQ\tSN:chr1\tLN:60
r1\t0\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGTGAGCAAGGGCGAGGAGCTG\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
r2\t16\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGTGAGCAAGGGCGAGGAGCTG\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
r3\t0\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGCTG\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
r4\t16\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGCTG\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
r5\t0\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGCTG\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
";
        let report = compute_sam_pileup_and_coverage_noodles(ref_seq, sam, 10);
        assert_eq!(report.mapped_reads, 5);
        assert_eq!(report.forward_strand_reads, 3);
        assert_eq!(report.reverse_strand_reads, 2);
        assert_eq!(report.max_coverage_depth, 5);
        assert_eq!(report.breadth_1x_pct, 50.0);
        // Position 11 has T -> C in 3 of 5 reads (AF = 0.60, balanced strands)
        let snv = report
            .pileup_variants
            .iter()
            .find(|v| v.position_bp == 11)
            .expect("Expected T11C SNV call");
        assert_eq!(snv.ref_base, "T");
        assert_eq!(snv.alt_allele, "C");
        assert_eq!(snv.alt_count, 3);
        assert!(snv.strand_bias_p_value > 0.2);
    }

    #[test]
    fn vcf_consequence_annotator_classifies_missense_synonymous_nonsense_and_frameshift() {
        // CDS at 7..30: ATG GTG AGC AAG GGC GAG GAG TAA (M V S K G E E *)
        let ref_seq = "GAATTCATGGTGAGCAAGGGCGAGGAGTAACTCGAG";
        let feats = vec![SequenceFeature {
            id: "cds-1".into(),
            name: "miniGFP".into(),
            feature_type: "CDS".into(),
            start: 7,
            end: 30,
            strand: 1,
            color: "#10b981".into(),
            notes: None,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }];
        // pos 12: G->A => GTG(Val) -> GTA(Val) synonymous
        // pos 16: A->G => AAG(Lys) -> GAG(Glu) missense
        // pos 22: G->T => GAG(Glu) -> TAG(Ter) stop_gained
        // pos 19: G->GA => frameshift
        let vcf = "\
##fileformat=VCFv4.3
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO
chr1\t12\t.\tG\tA\t99\tPASS\t.
chr1\t16\t.\tA\tG\t99\tPASS\t.
chr1\t22\t.\tG\tT\t99\tPASS\t.
chr1\t19\t.\tG\tGA\t99\tPASS\t.
";
        let rep = annotate_vcf_coding_consequences_noodles(ref_seq, &feats, vcf, 11);
        assert_eq!(rep.total_variants, 4);
        assert_eq!(rep.annotated_variants[0].consequence_term, "synonymous_variant");
        assert_eq!(rep.annotated_variants[1].consequence_term, "missense_variant");
        assert_eq!(
            rep.annotated_variants[1].hgvs_protein.as_deref(),
            Some("p.Lys4Glu")
        );
        assert!(rep.annotated_variants[1].grantham_distance.unwrap_or(0) > 40);
        assert_eq!(rep.annotated_variants[2].consequence_term, "stop_gained");
        assert_eq!(rep.annotated_variants[3].consequence_term, "frameshift_variant");
        assert_eq!(rep.high_impact_count, 2);
        assert_eq!(rep.moderate_impact_count, 1);
        assert_eq!(rep.low_impact_count, 1);
    }

    /// BG-01M6SC3D: the annotator kept its own codon table, which knew TGA = Trp only for codes 2
    /// and 4, ATA = Met only for 2 and AGA/AGG = Arg always, so codes 3, 5, 9, 13 and others were
    /// read as the Standard code with no warning. Every NCBI table must now give the consequence
    /// its own translation implies.
    #[test]
    fn vcf_consequences_use_each_ncbi_table() {
        use molbiocraft_core::genetic_codes::{translate_codon, NCBI_GENETIC_CODES};
        // CDS at 1..21: ATG TGG AGA ATA CTG AAA TAA
        let ref_seq = "ATGTGGAGAATACTGAAATAA";
        let feats = vec![SequenceFeature {
            id: "cds-1".into(),
            name: "probe".into(),
            feature_type: "CDS".into(),
            start: 1,
            end: 21,
            strand: 1,
            color: "#10b981".into(),
            notes: None,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }];
        // (1-based position, ref, alt, ref codon, alt codon)
        let snvs: [(usize, char, char, &[u8; 3], &[u8; 3]); 5] = [
            (6, 'G', 'A', b"TGG", b"TGA"),  // Trp -> Ter (1) / Trp (2, 3, 4, 5, 9, 13, ...)
            (9, 'A', 'C', b"AGA", b"AGC"),  // Arg -> Ser (1) / Ser = (5, 9) / Ter -> Ser (2) / Gly -> Ser (13)
            (12, 'A', 'T', b"ATA", b"ATT"), // Ile = (1) / Met -> Ile (2, 3, 5, 13)
            (13, 'C', 'T', b"CTG", b"TTG"), // Leu = (1) / Thr -> Leu (3)
            (20, 'A', 'G', b"TAA", b"TGA"), // Ter = (1) / Ter -> Trp (2, 3, 4, 5, ...)
        ];
        let mut vcf = String::from("##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n");
        for (pos, r, a, ..) in snvs {
            vcf.push_str(&format!("chr1\t{pos}\t.\t{r}\t{a}\t99\tPASS\t.\n"));
        }
        let implied = |table: u8, rc: &[u8; 3], ac: &[u8; 3]| {
            let (r, a) = (translate_codon(rc, table), translate_codon(ac, table));
            if r == a {
                "synonymous_variant"
            } else if a == b'*' {
                "stop_gained"
            } else if r == b'*' {
                "stop_lost"
            } else {
                "missense_variant"
            }
        };
        for &(table, ..) in NCBI_GENETIC_CODES {
            let rep = annotate_vcf_coding_consequences_noodles(ref_seq, &feats, &vcf, table);
            let got: Vec<&str> = rep.annotated_variants.iter().map(|v| v.consequence_term.as_str()).collect();
            let want: Vec<&str> = snvs.iter().map(|(_, _, _, rc, ac)| implied(table, rc, ac)).collect();
            assert_eq!(got, want, "table {table}");
        }
        // the cases the bug was filed on, pinned by name
        let term = |table: u8, i: usize| annotate_vcf_coding_consequences_noodles(ref_seq, &feats, &vcf, table).annotated_variants[i].consequence_term.clone();
        assert_eq!(term(1, 0), "stop_gained");
        for table in [2, 3, 4, 5, 9, 13] {
            assert_eq!(term(table, 0), "synonymous_variant", "TGG>TGA under table {table}");
        }
        assert_eq!((term(5, 1), term(9, 1), term(13, 1), term(2, 1)), ("synonymous_variant".into(), "synonymous_variant".into(), "missense_variant".into(), "stop_lost".into()));
        assert_eq!((term(3, 2), term(3, 3)), ("missense_variant".into(), "missense_variant".into()));
    }

    #[test]
    fn genomic_interval_algebra_computes_exact_jaccard_and_extracts_fasta() {
        let bed_a = "chr1\t10\t30\nchr1\t50\t70\n"; // 1-based: 11..=30 (20 bp) + 51..=70 (20 bp) = 40 bp
        let bed_b = "chr1\t20\t60\n"; // 1-based: 21..=60 (40 bp); overlaps: 21..=30 (10 bp) + 51..=60 (10 bp) = 20 bp
        let fasta = format!(">chr1\n{}\n", "ACGT".repeat(25)); // 100 bp
        let rep = intersect_genomic_intervals_noodles(bed_a, bed_b, Some(&fasta), 0);
        assert_eq!(rep.track_a_covered_bp, 40);
        assert_eq!(rep.track_b_covered_bp, 40);
        assert_eq!(rep.intersection_bp, 20);
        assert_eq!(rep.union_bp, 60);
        assert!((rep.jaccard_similarity - 0.3333).abs() < 0.001);
        assert_eq!(rep.intersected_intervals.len(), 2);
        assert_eq!(
            rep.intersected_intervals[0]
                .extracted_sequence
                .as_ref()
                .map(|s| s.len()),
            Some(10)
        );
    }
}
