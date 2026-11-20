// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! NGS Read QC & Adapter Trimming (`Myers` + k-mer), Minimizer/FM-seed Reference Read Mapping,
//! Overlap-Layout-Consensus & de Bruijn Contig Assembly, Whole-Genome Synteny LCB Discovery,
//! and Bayesian Haplotype Variant Calling (SNPs, MNPs, Indels + VCFv4.2).

use crate::pairwise::{align_pairwise_gotoh, PairwiseAlignmentResult, PairwiseMode};
use crate::poa_and_banded::{align_along_chain, align_within_band_ceiling};
use bio::alignment::pairwise::Scoring;
use bio::alignment::sparse::sdpkpp;
use bio::alignment::{Alignment, AlignmentOperation};
use bio::pattern_matching::myers::Myers;
use molbiocraft_core::{clean_sequence, format_thousands, reverse_complement_iupac, SequenceFeature};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

// ============================================================================
// 1. Adapter & Phred Quality Read Trimming
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTrimOptions {
    pub kmer_len: Option<usize>,
    pub min_phred_quality: Option<u8>,
    pub trim_adapters: Option<bool>,
    pub trim_low_complexity_ends: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterMatchHit {
    pub adapter_name: String,
    pub position_bp: usize,
    pub matched_kmer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BbdukTrimReport {
    pub original_length_bp: usize,
    pub trimmed_length_bp: usize,
    pub bases_removed5_prime: usize,
    pub bases_removed3_prime: usize,
    pub retained_percent: f64,
    pub gc_percent: f64,
    pub adapter_matches: Vec<AdapterMatchHit>,
    pub trimmed_sequence: String,
}

const SEQUENCING_ADAPTERS: &[(&str, &str)] = &[
    (
        "Illumina Universal TruSeq",
        "AGATCGGAAGAGCACACGTCTGAACTCCAGTCAC",
    ),
    (
        "Illumina Nextera Transposase",
        "CTGTCTCTTATACACATCTCCGAGCCCACGAGAC",
    ),
    ("Illumina Small RNA 3p", "TGGAATTCTCGGGTGCCAAGG"),
    (
        "Oxford Nanopore Ligation SQK",
        "CAGCACCTCTTACAAATGTTTTA",
    ),
];

pub fn run_bbduk_read_trimming(
    raw_seq: &str,
    qualities: Option<&[u8]>,
    opts: &ReadTrimOptions,
) -> BbdukTrimReport {
    let seq = clean_sequence(raw_seq);
    let bytes = seq.as_bytes();
    let k = opts.kmer_len.unwrap_or(11).clamp(8, 19);
    let min_q = opts.min_phred_quality.unwrap_or(20);
    let trim_adapters = opts.trim_adapters.unwrap_or(true);
    let trim_low_comp = opts.trim_low_complexity_ends.unwrap_or(true);

    let mut left = 0usize;
    let mut right = bytes.len();
    let mut adapter_matches = Vec::new();

    if let Some(q) = qualities {
        if q.len() == bytes.len() {
            while left < right && q[left] < min_q {
                left += 1;
            }
            while right > left && q[right - 1] < min_q {
                right -= 1;
            }
        }
    }

    if trim_adapters && right.saturating_sub(left) >= k {
        for &(adp_name, adp_seq) in SEQUENCING_ADAPTERS {
            let mut found = false;
            // Exact k-mer scan first, then Myers 1-mismatch fallback on 13-mer adapter prefix
            for offset in 0..=adp_seq.len().saturating_sub(k) {
                let kmer = &adp_seq[offset..offset + k];
                if let Some(rel_idx) = seq[left..right].find(kmer) {
                    let hit_idx = left + rel_idx;
                    adapter_matches.push(AdapterMatchHit {
                        adapter_name: adp_name.to_string(),
                        position_bp: hit_idx + 1,
                        matched_kmer: kmer.to_string(),
                    });
                    if hit_idx >= (bytes.len() * 45) / 100 {
                        right = right.min(hit_idx);
                    } else if hit_idx <= bytes.len() / 4 {
                        left = left.max(hit_idx + k);
                    }
                    found = true;
                    break;
                }
            }
            if !found && adp_seq.len() >= 13 && right.saturating_sub(left) >= 13 {
                let seed13 = &adp_seq.as_bytes()[..13];
                let mut myers = Myers::<u64>::new(seed13);
                if let Some((s, e, _dist)) = myers.find_all(&bytes[left..right], 1).next() {
                    let hit_idx = left + s;
                    let end_idx = (left + e).min(right);
                    adapter_matches.push(AdapterMatchHit {
                        adapter_name: adp_name.to_string(),
                        position_bp: hit_idx + 1,
                        matched_kmer: seq[hit_idx..end_idx].to_string(),
                    });
                    if hit_idx >= (bytes.len() * 45) / 100 {
                        right = right.min(hit_idx);
                    }
                }
            }
        }
    }

    if trim_low_comp {
        while left < right && bytes[left] == b'N' {
            left += 1;
        }
        while right > left && bytes[right - 1] == b'N' {
            right -= 1;
        }
        // Trim 8+ homopolymer tails and heads
        if right > left {
            let tail_b = bytes[right - 1];
            let mut run = 0usize;
            while right > left + run && bytes[right - 1 - run] == tail_b {
                run += 1;
            }
            if run >= 8 && matches!(tail_b, b'A' | b'C' | b'G' | b'T') {
                right -= run;
            }
        }
        if right > left {
            let head_b = bytes[left];
            let mut run = 0usize;
            while left + run < right && bytes[left + run] == head_b {
                run += 1;
            }
            if run >= 8 && matches!(head_b, b'A' | b'C' | b'G' | b'T') {
                left += run;
            }
        }
    }

    let safe_right = right.max(left);
    let trimmed = &seq[left..safe_right];
    let gc_count = trimmed
        .as_bytes()
        .iter()
        .filter(|&&b| b == b'G' || b == b'C')
        .count();

    BbdukTrimReport {
        original_length_bp: bytes.len(),
        trimmed_length_bp: trimmed.len(),
        bases_removed5_prime: left,
        bases_removed3_prime: bytes.len() - safe_right,
        retained_percent: if bytes.is_empty() {
            0.0
        } else {
            ((trimmed.len() as f64 / bytes.len() as f64) * 1000.0).round() / 10.0
        },
        gc_percent: if trimmed.is_empty() {
            0.0
        } else {
            ((gc_count as f64 / trimmed.len() as f64) * 1000.0).round() / 10.0
        },
        adapter_matches,
        trimmed_sequence: trimmed.to_string(),
    }
}

// ============================================================================
// 2. Minimizer / Seed-Vote NGS Reference Read Mapper
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NgsReferenceMappingReport {
    pub mapper: String,
    pub strand: String,
    pub ref_start_bp: usize,
    pub ref_end_bp: usize,
    pub mapped_read_bases: usize,
    pub seed_hits: usize,
    pub identity_percent: f64,
    pub coverage_breadth_percent: f64,
    pub mapq_score: u8,
    pub cigar: String,
    pub merged_consensus_preview: String,
    /// D0005: one sentence when the mapper value was unknown and the default mapped instead.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The read mapper a caller gets without naming one (D0204).
pub const NGS_MAPPER_DEFAULT: &str = "seed-13";

/// D0204: the seed length and seed step of each mapper value. The report's `mapper` names them.
fn ngs_mapper_seeds(mapper: &str) -> Option<(usize, usize)> {
    match mapper {
        "seed-13" => Some((13, 3)),
        "seed-11" => Some((11, 2)),
        "seed-9" => Some((9, 2)),
        _ => None,
    }
}

fn ngs_mapper_label(seed_len: usize, step: usize) -> String {
    format!("Built-in seed mapper ({seed_len}-mer seeds, step {step})")
}

/// Maps `read_seq` onto `reference_seq` by voting exact-seed diagonals, on both strands. `mapper`
/// is one of `seed-13` (13-mer seeds every 3rd read base), `seed-11` or `seed-9` (every 2nd); any
/// other value maps with [`NGS_MAPPER_DEFAULT`] and says so in `warnings` (D0204, D0005).
pub fn run_ngs_reference_mapping(
    reference_seq: &str,
    read_seq: &str,
    mapper: &str,
) -> NgsReferenceMappingReport {
    let ref_clean: String = reference_seq
        .bytes()
        .filter_map(|b| {
            let u = b.to_ascii_uppercase();
            matches!(u, b'A' | b'C' | b'G' | b'T' | b'N').then_some(u as char)
        })
        .collect();
    let read_clean: String = read_seq
        .bytes()
        .filter_map(|b| {
            let u = b.to_ascii_uppercase();
            matches!(u, b'A' | b'C' | b'G' | b'T' | b'N').then_some(u as char)
        })
        .collect();

    let mut warnings = Vec::new();
    let (seed_len, step) = ngs_mapper_seeds(mapper).unwrap_or_else(|| {
        let (k, s) = ngs_mapper_seeds(NGS_MAPPER_DEFAULT).expect("the default is a mapper value");
        warnings.push(format!(
            "Unknown mapper \"{mapper}\"; mapped with the default, {NGS_MAPPER_DEFAULT} ({}).",
            ngs_mapper_label(k, s)
        ));
        (k, s)
    });
    let mapper = ngs_mapper_label(seed_len, step);

    if ref_clean.len() < seed_len || read_clean.len() < seed_len {
        return NgsReferenceMappingReport {
            mapper,
            strand: "+".to_string(),
            ref_start_bp: 1,
            ref_end_bp: ref_clean.len().min(read_clean.len()),
            mapped_read_bases: 0,
            seed_hits: 0,
            identity_percent: 0.0,
            coverage_breadth_percent: 0.0,
            mapq_score: 0,
            cigar: format!("{}S", read_clean.len()),
            merged_consensus_preview: read_clean.chars().take(120).collect(),
            warnings,
        };
    }

    let ref_bytes = ref_clean.as_bytes();
    let idx_stride = (ref_bytes.len() / 250_000).max(1) * 2;
    let mut ref_index: FxHashMap<&[u8], Vec<isize>> = FxHashMap::default();
    let mut i = 0usize;
    while i + seed_len <= ref_bytes.len() {
        let arr = ref_index.entry(&ref_bytes[i..i + seed_len]).or_default();
        if arr.len() < 12 {
            arr.push(i as isize);
        }
        i += idx_stride.min(2);
    }

    let score_candidate = |query: &[u8]| -> (isize, usize) {
        let mut diag_votes: FxHashMap<isize, usize> = FxHashMap::default();
        let mut j = 0usize;
        while j + seed_len <= query.len() {
            if let Some(hits) = ref_index.get(&query[j..j + seed_len]) {
                for &h in hits {
                    let diag = h - (j as isize);
                    *diag_votes.entry(diag).or_insert(0) += 1;
                }
            }
            j += step;
        }
        let mut best_diag = 0isize;
        let mut best_votes = 0usize;
        for (d, v) in diag_votes {
            if v > best_votes {
                best_votes = v;
                best_diag = d;
            }
        }
        (best_diag, best_votes)
    };

    let (fwd_diag, fwd_votes) = score_candidate(read_clean.as_bytes());
    let rc_read = reverse_complement_iupac(&read_clean, false);
    let (rev_diag, rev_votes) = score_candidate(rc_read.as_bytes());

    let use_rev = rev_votes > fwd_votes;
    let oriented = if use_rev {
        rc_read.as_bytes()
    } else {
        read_clean.as_bytes()
    };
    let (best_diag, best_votes) = if use_rev {
        (rev_diag, rev_votes)
    } else {
        (fwd_diag, fwd_votes)
    };

    let ref_start0 = best_diag.max(0).min((ref_bytes.len() - 1) as isize) as usize;
    let soft_clip5 = if best_diag < 0 {
        (-best_diag as usize).min(oriented.len())
    } else {
        0
    };
    let compare_len = (ref_bytes.len() - ref_start0).min(oriented.len().saturating_sub(soft_clip5));
    let soft_clip3 = oriented.len().saturating_sub(soft_clip5 + compare_len);

    let mut matches = 0usize;
    let mut mismatches = 0usize;
    let mut consensus = Vec::with_capacity(compare_len.min(140));
    for idx in 0..compare_len {
        let rb = ref_bytes[ref_start0 + idx];
        let qb = oriented[soft_clip5 + idx];
        if rb == qb {
            matches += 1;
            if consensus.len() < 140 {
                consensus.push(rb);
            }
        } else {
            mismatches += 1;
            if consensus.len() < 140 {
                consensus.push(qb);
            }
        }
    }

    let mut cigar = String::new();
    if soft_clip5 > 0 {
        cigar.push_str(&format!("{soft_clip5}S"));
    }
    if compare_len > 0 {
        cigar.push_str(&format!("{compare_len}M"));
    }
    if soft_clip3 > 0 {
        cigar.push_str(&format!("{soft_clip3}S"));
    }
    if cigar.is_empty() {
        cigar = format!("{}M", oriented.len());
    }

    let identity_pct = if compare_len > 0 {
        ((matches as f64 / compare_len as f64) * 10000.0).round() / 100.0
    } else {
        0.0
    };
    let breadth_pct = ((compare_len as f64 / ref_bytes.len().max(1) as f64) * 10000.0).round()
        / 100.0;
    let mapq = if best_votes == 0 {
        0
    } else {
        (identity_pct * 0.6 - mismatches as f64 * 0.5)
            .round()
            .clamp(12.0, 60.0) as u8
    };

    NgsReferenceMappingReport {
        mapper,
        strand: if use_rev { "-".to_string() } else { "+".to_string() },
        ref_start_bp: ref_start0 + 1,
        ref_end_bp: ref_start0 + compare_len.max(1),
        mapped_read_bases: compare_len,
        seed_hits: best_votes,
        identity_percent: identity_pct,
        coverage_breadth_percent: breadth_pct,
        mapq_score: mapq,
        cigar,
        merged_consensus_preview: String::from_utf8_lossy(&consensus).into_owned(),
        warnings,
    }
}

// ============================================================================
// 3. Sanger / Single-Read Variant Calling
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantCall {
    pub position: usize,
    pub ref_base: String,
    pub alt_base: String,
    #[serde(rename = "type")]
    pub variant_type: String,
    pub phred_quality: u8,
    pub read_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codon_impact: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadVariantMappingResult {
    pub alignment: PairwiseAlignmentResult,
    pub ref_start_pos: usize,
    pub variants: Vec<VariantCall>,
    /// The read was aligned as its reverse complement.
    #[serde(default)]
    pub reverse: bool,
}

pub fn map_read_and_call_variants(
    ref_seq_raw: &str,
    read_seq_raw: &str,
    read_name: &str,
    phred_scores: Option<&[u8]>,
) -> ReadVariantMappingResult {
    let ref_seq = clean_sequence(ref_seq_raw);
    let read_seq = clean_sequence(read_seq_raw);
    if ref_seq.is_empty() || read_seq.is_empty() {
        return ReadVariantMappingResult {
            alignment: align_pairwise_gotoh("", "", PairwiseMode::Local, None, 2, -1, -3, -1, 100),
            ref_start_pos: 1,
            variants: Vec::new(),
            reverse: false,
        };
    }

    // Orientation and placement by voting: shared 15-mers sampled along the read, in both
    // orientations, vote for a diagonal (reference start). An exact 18-mer at the read start
    // decided this before, so a sequencing error there flipped or misplaced the read.
    let rc_read = reverse_complement_iupac(&read_seq, false);
    let place = |r: &str| -> Option<(usize, usize)> {
        const K: usize = 15;
        if r.len() < K || ref_seq.len() < K {
            return None;
        }
        let rb = ref_seq.as_bytes();
        let mut votes: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();
        let step = ((r.len() - K) / 12).max(1);
        let mut j = 0;
        while j + K <= r.len() {
            let kmer = &r.as_bytes()[j..j + K];
            let mut hits = 0;
            for i in memchr::memmem::find_iter(rb, kmer) {
                *votes.entry(i as i64 - j as i64).or_default() += 1;
                hits += 1;
                if hits > 8 {
                    break; // repetitive k-mer
                }
            }
            j += step;
        }
        // neighbouring diagonals (indels) add up
        let mut best: Option<(i64, usize)> = None;
        for (&d, _) in votes.iter() {
            let v: usize = (-3..=3).map(|o| votes.get(&(d + o)).copied().unwrap_or(0)).sum();
            if best.map_or(true, |b| v > b.1 || (v == b.1 && d < b.0)) {
                best = Some((d, v));
            }
        }
        best.map(|(d, v)| (d.max(0) as usize, v))
    };
    let fwd = place(&read_seq);
    let rev = place(&rc_read);
    let reverse_hits = match (fwd, rev) {
        (Some(f), Some(r)) => r.1 > f.1,
        (None, Some(_)) => true,
        _ => false,
    };
    let reversed_quals: Option<Vec<u8>> =
        phred_scores.map(|q| q.iter().rev().copied().collect());
    let (read_seq, phred_scores): (String, Option<&[u8]>) = if reverse_hits {
        (rc_read, reversed_quals.as_deref())
    } else {
        (read_seq, phred_scores)
    };
    let seed_idx = (if reverse_hits { rev } else { fwd }).map(|p| p.0.saturating_sub(24)).unwrap_or(0).min(ref_seq.len().saturating_sub(1));
    let win_end = (seed_idx + read_seq.len() + 48).min(ref_seq.len());
    let ref_window = &ref_seq[seed_idx..win_end];
    let alignment = align_pairwise_gotoh(
        ref_window,
        &read_seq,
        PairwiseMode::Local,
        None,
        2,
        -1,
        -3,
        -1,
        2400,
    );

    let mut variants = Vec::new();
    let mut ref_pos = seed_idx + alignment.xstart.max(1);
    let mut read_pos = alignment.ystart.saturating_sub(1);

    let a1 = alignment.aligned_seq1.as_bytes();
    let a2 = alignment.aligned_seq2.as_bytes();
    for k in 0..a1.len().min(a2.len()) {
        let rb = a1[k];
        let qb = a2[k];
        // Quality is the called base's Phred score; 0 means "not available" (never invented).
        let q_at = |i: usize| phred_scores.and_then(|s| s.get(i).copied());
        let phred = q_at(read_pos).unwrap_or(0);
        // A deletion has no base of its own: use the weaker of the two flanking read bases.
        let del_phred = match (q_at(read_pos.wrapping_sub(1)), q_at(read_pos)) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) | (None, Some(a)) => a,
            _ => 0,
        };
        if rb != b'-' && qb != b'-' && rb != qb {
            variants.push(VariantCall {
                position: ref_pos,
                ref_base: (rb as char).to_string(),
                alt_base: (qb as char).to_string(),
                variant_type: "SNP".to_string(),
                phred_quality: phred,
                read_name: read_name.to_string(),
                codon_impact: Some(format!("Substitution ({} -> {})", rb as char, qb as char)),
            });
        } else if rb == b'-' && qb != b'-' {
            variants.push(VariantCall {
                position: ref_pos,
                ref_base: "-".to_string(),
                alt_base: (qb as char).to_string(),
                variant_type: "Insertion".to_string(),
                phred_quality: phred,
                read_name: read_name.to_string(),
                codon_impact: None,
            });
        } else if rb != b'-' && qb == b'-' {
            variants.push(VariantCall {
                position: ref_pos,
                ref_base: (rb as char).to_string(),
                alt_base: "-".to_string(),
                variant_type: "Deletion".to_string(),
                phred_quality: del_phred,
                read_name: read_name.to_string(),
                codon_impact: None,
            });
        }
        if rb != b'-' {
            ref_pos += 1;
        }
        if qb != b'-' {
            read_pos += 1;
        }
    }

    ReadVariantMappingResult {
        ref_start_pos: seed_idx + alignment.xstart.max(1),
        alignment,
        variants,
        reverse: reverse_hits,
    }
}

// ============================================================================
// 4. De Novo & Contig Assembly (OLC & De Bruijn Modes)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyReadInput {
    pub name: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssembledContigRecord {
    pub id: String,
    pub name: String,
    pub length_bp: usize,
    pub gc_percent: f64,
    pub read_count: usize,
    pub mean_coverage_depth: f64,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeNovoAssemblyReport {
    pub assembler: String,
    pub kmer_or_overlap_bp: usize,
    pub input_read_count: usize,
    pub contig_count: usize,
    pub total_assembled_bp: usize,
    pub largest_contig_bp: usize,
    pub n50_bp: usize,
    pub l50_count: usize,
    pub contigs: Vec<AssembledContigRecord>,
    /// D0005: one sentence when the assembler value was unknown and the default assembled instead.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The assembler a caller gets without naming one (D0204).
pub const ASSEMBLER_DEFAULT: &str = "overlap";

/// D0204: whether an assembler value takes its de Bruijn k from the minimum overlap, and the word
/// its contigs are named with. `overlap` picks k from the read length when it builds a de Bruijn
/// graph (200+ reads of at most 400 bp); `debruijn` uses the minimum overlap, odd and within 15-31.
/// Fewer or longer reads are joined by greedy overlap either way.
fn assembler_method(assembler: &str) -> Option<(bool, &'static str)> {
    match assembler {
        "overlap" => Some((false, "Overlap")),
        "debruijn" => Some((true, "DeBruijn")),
        _ => None,
    }
}

const MAX_ASSEMBLY_OVERLAP_BP: usize = 2000;

fn find_exact_or_tolerant_overlap(a: &str, b: &str, min_ov: usize) -> Option<String> {
    if a.contains(b) {
        return Some(a.to_string());
    }
    if b.contains(a) {
        return Some(b.to_string());
    }
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    // Overlaps up to the shorter sequence's length are considered (bounded for speed); a
    // 260-bp cap used to leave reads whose true overlap was longer unassembled.
    let max_ov = ab.len().min(bb.len()).min(MAX_ASSEMBLY_OVERLAP_BP);
    for len in (min_ov..=max_ov).rev() {
        // Allow up to 1 mismatch on overlaps >= 24 bp for realistic sequencing noise tolerance
        let max_mm = usize::from(len >= 24);
        let tail_a = &ab[ab.len() - len..];
        let head_b = &bb[..len];
        let mm1 = tail_a
            .iter()
            .zip(head_b.iter())
            .filter(|(x, y)| x != y)
            .take(max_mm + 1)
            .count();
        if mm1 <= max_mm {
            let mut out = String::with_capacity(a.len() + b.len() - len);
            out.push_str(a);
            out.push_str(&b[len..]);
            return Some(out);
        }

        let tail_b = &bb[bb.len() - len..];
        let head_a = &ab[..len];
        let mm2 = tail_b
            .iter()
            .zip(head_a.iter())
            .filter(|(x, y)| x != y)
            .take(max_mm + 1)
            .count();
        if mm2 <= max_mm {
            let mut out = String::with_capacity(b.len() + a.len() - len);
            out.push_str(b);
            out.push_str(&a[len..]);
            return Some(out);
        }
    }
    None
}

/// Assembles `inputs` into contigs. `assembler` is `overlap` or `debruijn` ([`assembler_method`]);
/// any other value assembles with [`ASSEMBLER_DEFAULT`] and says so in `warnings` (D0204, D0005).
/// The report's `assembler` names the method that ran: a de Bruijn graph and its k, or greedy
/// overlap and its minimum.
pub fn run_de_novo_assembly(
    inputs: &[AssemblyReadInput],
    assembler: &str,
    min_overlap_bp: usize,
) -> DeNovoAssemblyReport {
    let mut warnings = Vec::new();
    let (assembler, (k_from_overlap, contig_word)) = match assembler_method(assembler) {
        Some(method) => (assembler, method),
        None => {
            warnings.push(format!("Unknown assembler \"{assembler}\"; assembled with the default, {ASSEMBLER_DEFAULT}."));
            (ASSEMBLER_DEFAULT, assembler_method(ASSEMBLER_DEFAULT).expect("the default is an assembler value"))
        }
    };
    #[derive(Clone)]
    struct PoolItem {
        seq: String,
        members: usize,
        total_input_bases: usize,
    }
    let mut pool_from_dbg: Option<Vec<PoolItem>> = None;
    let mut used_k = 0usize;

    let clean_reads: Vec<String> = inputs
        .iter()
        .map(|d| {
            d.sequence
                .bytes()
                .filter_map(|b| {
                    let u = b.to_ascii_uppercase();
                    matches!(u, b'A' | b'C' | b'G' | b'T').then_some(u as char)
                })
                .collect::<String>()
        })
        .filter(|s| s.len() >= 12)
        .collect();

    let overlap_param = if k_from_overlap {
        (min_overlap_bp | 1).clamp(15, 31)
    } else {
        min_overlap_bp.max(12)
    };

    let input_read_count = clean_reads.len();
    let mean_len = clean_reads.iter().map(|r| r.len()).sum::<usize>() / input_read_count.max(1);
    // Short-read sets (Illumina-like): de Bruijn graph assembly with error k-mer filtering, tip
    // clipping and bubble popping. The greedy overlap merger below suits a few long (Sanger) reads.
    if input_read_count >= 200 && mean_len <= 400 {
        let k = if k_from_overlap { overlap_param } else { ((mean_len * 7 / 20) | 1).clamp(21, 63) };
        used_k = k.clamp(15, 63) | 1;
        let dbg = crate::debruijn::assemble_debruijn(&clean_reads, k);
        let per_read_kmers = (mean_len.saturating_sub(k) + 1).max(1) as f64;
        pool_from_dbg = Some(
            dbg.into_iter()
                .map(|c| {
                    let members = ((c.kmer_coverage * c.seq.len() as f64) / per_read_kmers).round().max(1.0) as usize;
                    PoolItem { total_input_bases: members * mean_len, members, seq: c.seq }
                })
                .collect(),
        );
    }
    let mut pool: Vec<PoolItem> = if let Some(p) = pool_from_dbg.take() { p } else { clean_reads
        .into_iter()
        .map(|s| {
            let l = s.len();
            PoolItem {
                seq: s,
                members: 1,
                total_input_bases: l,
            }
        })
        .collect() };
    let dbg_done = input_read_count >= 200 && mean_len <= 400;

    // Every successful pass merges two pool items, so at most `input_read_count - 1` passes
    // can merge anything. (A fixed cap of 64 used to stop larger read sets half-assembled.)
    let mut merged_any = true;
    let mut guard = 0usize;
    let max_passes = input_read_count.saturating_sub(1).max(1);
    while !dbg_done && merged_any && pool.length_gt_one() && guard < max_passes {
        merged_any = false;
        guard += 1;
        'outer: for i in 0..pool.len() {
            for j in (i + 1)..pool.len() {
                let joined = find_exact_or_tolerant_overlap(&pool[i].seq, &pool[j].seq, overlap_param)
                    .or_else(|| {
                        let rc = reverse_complement_iupac(&pool[j].seq, false);
                        find_exact_or_tolerant_overlap(&pool[i].seq, &rc, overlap_param)
                    });
                if let Some(merged_seq) = joined {
                    pool[i] = PoolItem {
                        seq: merged_seq,
                        members: pool[i].members + pool[j].members,
                        total_input_bases: pool[i].total_input_bases + pool[j].total_input_bases,
                    };
                    pool.remove(j);
                    merged_any = true;
                    break 'outer;
                }
            }
        }
    }

    pool.sort_by(|a, b| b.seq.len().cmp(&a.seq.len()));

    let contigs: Vec<AssembledContigRecord> = pool
        .into_iter()
        .enumerate()
        .map(|(idx, item)| {
            let gc = item
                .seq
                .as_bytes()
                .iter()
                .filter(|&&b| b == b'G' || b == b'C')
                .count();
            let len = item.seq.len();
            AssembledContigRecord {
                id: format!("contig-{}-{}", assembler, idx + 1),
                name: format!("{}_Contig_{}", contig_word, idx + 1),
                length_bp: len,
                gc_percent: ((gc as f64 / len.max(1) as f64) * 1000.0).round() / 10.0,
                read_count: item.members,
                mean_coverage_depth: ((item.total_input_bases as f64 / len.max(1) as f64) * 100.0)
                    .round()
                    / 100.0,
                sequence: item.seq,
            }
        })
        .collect();

    let total_bp: usize = contigs.iter().map(|c| c.length_bp).sum();
    let mut cum = 0usize;
    let mut n50 = 0usize;
    let mut l50 = 0usize;
    for (idx, c) in contigs.iter().enumerate() {
        cum += c.length_bp;
        if cum * 2 >= total_bp {
            n50 = c.length_bp;
            l50 = idx + 1;
            break;
        }
    }

    DeNovoAssemblyReport {
        assembler: if used_k > 0 { format!("de Bruijn graph (k = {used_k})") } else { format!("Greedy overlap (≥ {overlap_param} bp)") },
        kmer_or_overlap_bp: if used_k > 0 { used_k } else { overlap_param },
        input_read_count,
        contig_count: contigs.len(),
        total_assembled_bp: total_bp,
        largest_contig_bp: contigs.first().map(|c| c.length_bp).unwrap_or(0),
        n50_bp: n50,
        l50_count: l50,
        contigs,
        warnings,
    }
}

trait VecLenExt {
    fn length_gt_one(&self) -> bool;
}
impl<T> VecLenExt for Vec<T> {
    fn length_gt_one(&self) -> bool {
        self.len() > 1
    }
}

// ============================================================================
// 5. Whole-Genome Alignment & Synteny LCB Discovery
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntenyLcbBlock {
    pub block_id: String,
    pub strand: String,
    pub event_class: String,
    pub genome_a_start: usize,
    pub genome_a_end: usize,
    pub genome_b_start: usize,
    pub genome_b_end: usize,
    pub length_bp: usize,
    pub identity_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeGenomeSyntenyReport {
    pub engine: String,
    pub total_aligned_bp: usize,
    /// The A/C/G/T bases of genome A the blocks cover, as a percentage of A's A/C/G/T bases.
    pub genome_a_coverage_pct: f64,
    pub inversion_count: usize,
    pub blocks: Vec<SyntenyLcbBlock>,
    /// True when the scan indexed genome B at a stride above 1: a seed whose match in B starts
    /// between the indexed positions finds nothing, so the coverage is a lower bound.
    #[serde(default)]
    pub genome_a_coverage_is_lower_bound: bool,
    /// D0005: what qualifies the coverage, one sentence each: each genome's N and other ambiguity
    /// bases (which no block crosses), then any sampling. Empty for an N-free pair with B indexed
    /// at every base.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The code of N, another IUPAC ambiguity letter or any other byte: it matches nothing, so no
/// seed holds it and an extension stops at it.
const SYNTENY_NOT_ACGT: u8 = 4;

/// The low bits of an index key hold the k-mer's position in genome B, the high bits its code.
const SYNTENY_POS_BITS: u32 = 36;

/// How far from the diagonal of the block before it (in either direction, so across an indel of
/// up to this many bases) a seed's k-mer that genome B holds more than once may resume a block;
/// and how far apart the diagonals of two linked blocks of one chain may lie.
const SYNTENY_RESUME_WINDOW: usize = 32;

/// How far from the diagonal of the block before it a k-mer that genome B holds more than once is
/// still taken, when it is the only copy that near (BG-01M6TAB2): a repeat's copy that follows an
/// insertion or deletion of up to this many bases is resumed on, where every other copy lies
/// farther off. Past it, or with a second copy within it, which copy the seed belongs to is unknown.
const SYNTENY_LONE_COPY_WINDOW: usize = 1_000;

/// How many k-mers of genome A past a seed, one after another inside its run, are looked up before
/// the scan jumps to a hit off the diagonal of the block before it (BG-01M6TAB2). Where one of them
/// lies near that diagonal, the seed belongs there and the jump is not taken. Such a seed starts
/// where B has lost the bases before a repeat's copy, with its first bases matching the bases before
/// another copy by chance, or holds a base its own copy lacks, so B holds it once, on another copy.
const SYNTENY_JUMP_CHECKS: usize = 3;

/// The least score a block must reach, at +1 per matched base and -2 per mismatched one. Beyond a
/// seed matched by chance each base matches with probability 1/4, and such a seed's extension
/// reaches 24 with probability about 1.4e-8 for an 11-base seed and 2.1e-7 for a 13-base one, so
/// two unrelated 5 Mb genomes give about one chance block or none. The 16-base length floor it
/// replaces passed 37% and 53% of chance seeds: with B indexed at every base, two unrelated 2 Mb
/// genomes read as 7.7% covered (Mauve). A 99.5%-identical block passes alone from about 25 bp;
/// a shorter one is kept when it is part of a chain that reaches the floor (BG-01M6TAB2).
const SYNTENY_MIN_BLOCK_SCORE: isize = 24;

/// How many bases of genome A may lie between two blocks of one chain: the scan seeds the block
/// after an indel where the block before it ends, unless a substitution or a segment too short to
/// hold a seed between two close indels sits there, which this spans. It is also how far before
/// the end of the block before it the block after it is extended back.
const SYNTENY_CHAIN_GAP: usize = 32;

/// What a link of a chain costs its score, at the score's -2 per mismatched base: 2 for the
/// junction and 2 per base of the insertion or deletion between its two blocks. Two chance 13-base
/// seeds on diagonals within [`SYNTENY_RESUME_WINDOW`] of each other score 26 between them, over
/// the floor; less the 4 or more a link across an indel costs, they are under it.
fn synteny_link_cost(shift: usize) -> isize {
    2 + 2 * shift as isize
}

/// A base's 2-bit code: A 0, C 1, G 2, T 3, in either case; [`SYNTENY_NOT_ACGT`] for any other.
fn synteny_base_code(base: u8) -> u8 {
    match base {
        b'A' | b'a' => 0,
        b'C' | b'c' => 1,
        b'G' | b'g' => 2,
        b'T' | b't' => 3,
        _ => SYNTENY_NOT_ACGT,
    }
}

/// Calls `visit(position, code)` for each k-mer of `codes` that starts at a multiple of `stride`
/// and holds only A/C/G/T, in position order.
fn for_each_acgt_kmer(codes: &[u8], k: usize, stride: usize, mut visit: impl FnMut(usize, u64)) {
    let mask = (1u64 << (2 * k)) - 1;
    let (mut code, mut run) = (0u64, 0usize);
    for (j, &c) in codes.iter().enumerate() {
        if c == SYNTENY_NOT_ACGT {
            run = 0;
            continue;
        }
        code = ((code << 2) | u64::from(c)) & mask;
        run += 1;
        if run >= k && (j + 1 - k) % stride == 0 {
            visit(j + 1 - k, code);
        }
    }
}

/// Genome B's k-mers that hold only A/C/G/T, at every `stride`th position, sorted by code and then
/// position, and bucketed by the top bits of the code so a lookup searches one small bucket. It
/// keeps 8 bytes per k-mer, every occurrence of a repeated one included.
struct SyntenyKmerIndex {
    /// `code << SYNTENY_POS_BITS | position`, in ascending order.
    keys: Vec<u64>,
    /// `keys[bucket_start[p]..bucket_start[p + 1]]` hold the k-mers whose code has top bits `p`.
    bucket_start: Vec<usize>,
    prefix_shift: u32,
}

impl SyntenyKmerIndex {
    fn build(codes: &[u8], k: usize, stride: usize) -> Self {
        let code_bits = 2 * k as u32;
        // up to two buckets per base of B, and at most 2^20
        let prefix_bits = code_bits.min(usize::BITS - codes.len().leading_zeros()).min(20);
        let prefix_shift = code_bits - prefix_bits;
        let mut bucket_start = vec![0usize; (1usize << prefix_bits) + 1];
        for_each_acgt_kmer(codes, k, stride, |_, code| bucket_start[(code >> prefix_shift) as usize + 1] += 1);
        for p in 1..bucket_start.len() {
            bucket_start[p] += bucket_start[p - 1];
        }
        let mut next = bucket_start.clone();
        let mut keys = vec![0u64; bucket_start[bucket_start.len() - 1]];
        for_each_acgt_kmer(codes, k, stride, |pos, code| {
            let p = (code >> prefix_shift) as usize;
            keys[next[p]] = (code << SYNTENY_POS_BITS) | pos as u64;
            next[p] += 1;
        });
        // each bucket is filled in position order; sorting it by key orders it by code, then position
        for p in 0..bucket_start.len() - 1 {
            keys[bucket_start[p]..bucket_start[p + 1]].sort_unstable();
        }
        Self { keys, bucket_start, prefix_shift }
    }

    /// The position in genome B of the k-mer `code` nearest `expected`, the position on the
    /// diagonal of the block before it, and whether it lies near that diagonal: within
    /// [`SYNTENY_RESUME_WINDOW`] of it, or the only copy within [`SYNTENY_LONE_COPY_WINDOW`].
    /// With no expectation, its first position, not near. `None` when B does not hold it, and
    /// when B holds it more than once with none near: which copy such a seed belongs to is
    /// unknown, and taking the nearest would put a block on another copy of a repeat whose own
    /// copy differs at the seed. A k-mer B holds once is returned wherever it lies; past the
    /// lone-copy window it is not near, and the scan takes it only as a confirmed jump (see
    /// [`SYNTENY_JUMP_CHECKS`]).
    fn nearest(&self, code: u64, expected: Option<isize>) -> Option<(usize, bool)> {
        let p = (code >> self.prefix_shift) as usize;
        let bucket = &self.keys[self.bucket_start[p]..self.bucket_start[p + 1]];
        let lo = bucket.partition_point(|&key| key >> SYNTENY_POS_BITS < code);
        let hits = &bucket[lo..lo + bucket[lo..].partition_point(|&key| key >> SYNTENY_POS_BITS == code)];
        let pos = |key: u64| (key & ((1u64 << SYNTENY_POS_BITS) - 1)) as usize;
        let first = pos(*hits.first()?);
        let Some(e) = expected else { return Some((first, false)) };
        // hits are in position order, so the nearest two to `e` are among the two on either side
        let at = hits.partition_point(|&key| (pos(key) as isize) < e);
        let off = |h: usize| hits.get(h).map(|&key| ((pos(key) as isize - e).unsigned_abs(), pos(key)));
        let around = [at.checked_sub(2), at.checked_sub(1), Some(at), Some(at + 1)].map(|h| h.and_then(off));
        let (near_off, near) = around.iter().flatten().min()?.to_owned();
        // None: B holds it once
        let next_off = around.iter().flatten().filter(|&&(_, q)| q != near).map(|&(d, _)| d).min();
        let lone_copy = near_off <= SYNTENY_LONE_COPY_WINDOW && next_off.is_none_or(|next| next > SYNTENY_LONE_COPY_WINDOW);
        let is_near = near_off <= SYNTENY_RESUME_WINDOW || lone_copy;
        (is_near || next_off.is_none()).then_some((near, is_near))
    }
}

/// How far an ungapped extension of a seed at `a0` in genome A and `t0` in the target matches:
/// its length, trimmed of trailing mismatches, and its matched bases. It stops at the fourth
/// mismatch in a row, at either sequence's end, or before a base other than A/C/G/T in either.
fn extend_synteny_seed(a: &[u8], a0: usize, target: impl Fn(usize) -> u8, t0: usize, target_len: usize, k: usize) -> (usize, usize) {
    let (mut len, mut matches, mut consec_mm) = (k, k, 0usize);
    while a0 + len < a.len() && t0 + len < target_len && consec_mm < 4 {
        let (x, y) = (a[a0 + len], target(t0 + len));
        if x == SYNTENY_NOT_ACGT || y == SYNTENY_NOT_ACGT {
            break;
        }
        if x == y {
            matches += 1;
            consec_mm = 0;
        } else {
            consec_mm += 1;
        }
        len += 1;
    }
    (len - consec_mm, matches)
}

/// +1 per matched base and -2 per mismatched one.
fn synteny_score(len: usize, matches: usize) -> isize {
    matches as isize - 2 * (len - matches) as isize
}

/// A block as the scan holds it until the report is written: its strand, its start in genome A and
/// in the target (genome B on the + strand, B's reverse complement on the - strand), its length
/// and its matched bases.
#[derive(Debug, Clone, Copy)]
struct SyntenyRun {
    fwd: bool,
    a0: usize,
    t0: usize,
    len: usize,
    matches: usize,
}

impl SyntenyRun {
    fn a_end(&self) -> usize {
        self.a0 + self.len
    }

    /// Target position less A position.
    fn diagonal(&self) -> isize {
        self.t0 as isize - self.a0 as isize
    }

    fn score(&self) -> isize {
        synteny_score(self.len, self.matches)
    }

    /// Whether `next` is this run seen again from a later seed: on its strand and diagonal,
    /// starting inside it.
    fn holds(&self, next: &SyntenyRun) -> bool {
        next.fwd == self.fwd && next.diagonal() == self.diagonal() && (self.a0..self.a_end()).contains(&next.a0)
    }

    /// How far `next`'s diagonal lies from this run's, when `next` can be the run after it in one
    /// chain: on the same strand, starting after this run starts and at most
    /// [`SYNTENY_CHAIN_GAP`] bases of A after it ends, its diagonal within
    /// [`SYNTENY_RESUME_WINDOW`] of this run's, and not this run itself. It may start inside this
    /// run, among the bases past an indel that this run's extension took by chance.
    fn link_to(&self, next: &SyntenyRun) -> Option<usize> {
        let shift = (next.diagonal() - self.diagonal()).unsigned_abs();
        (next.fwd == self.fwd
            && next.a0 > self.a0
            && next.a0 <= self.a_end() + SYNTENY_CHAIN_GAP
            && shift <= SYNTENY_RESUME_WINDOW
            && !self.holds(next))
            .then_some(shift)
    }

    /// Whether `next`, a block after this one that does not link to it, starts where this one
    /// ends in both genomes, across an insertion into B or a deletion from B of up to
    /// [`SYNTENY_LONE_COPY_WINDOW`] bases: on the same strand, and at most [`SYNTENY_CHAIN_GAP`]
    /// bases of A after this one ends, past the bases B lacks (BG-01M6TAB2).
    fn abuts(&self, next: &SyntenyRun) -> bool {
        let shift = next.diagonal() - self.diagonal();
        let lacks = (-shift).max(0) as usize;
        next.fwd == self.fwd
            && next.a0 > self.a0
            && shift.unsigned_abs() <= SYNTENY_LONE_COPY_WINDOW
            && next.a0 <= self.a_end() + lacks + SYNTENY_CHAIN_GAP
    }
}

/// Moves the boundary between `e` and `c`, consecutive runs of one chain or a block and the one
/// that abuts it ([`SyntenyRun::abuts`]), to where their two diagonals together align best. The
/// ungapped extension of `e` runs past the indel between them on bases that match its diagonal
/// only by chance (about 4.6 bases on average before the fourth mismatch in a row stops it), and
/// `c`'s seed starts after them. So `c` is first extended back along its own diagonal, as an
/// extension stops: at the fourth mismatch in a row, before a base other than A/C/G/T, or
/// [`SYNTENY_CHAIN_GAP`] bases before `e` ends. Where the two then overlap,
/// the boundary goes where the score of the two together is highest, at its leftmost such place.
/// Where genome B lacks bases A holds (a deletion from B: `e`'s diagonal above `c`'s), `c` starts
/// that many bases after `e` ends, so the two never share a base of either genome. `pair(fwd, i,
/// t)` is whether A's base `i` matches the target's base `t` on that strand, `None` where either
/// is not A/C/G/T or `t` is outside the target.
fn join_synteny_runs(e: &mut SyntenyRun, c: &mut SyntenyRun, pair: impl Fn(bool, usize, isize) -> Option<bool>) {
    let (de, dc) = (e.diagonal(), c.diagonal());
    let gap = (de - dc).max(0) as usize;
    let s = |run_fwd: bool, d: isize, i: usize| pair(run_fwd, i, i as isize + d);
    let score_of = |m: Option<bool>| if m == Some(true) { 1 } else { -2 };
    // c back along its own diagonal, no lower than one base into e (and the A gap past it)
    let floor = (e.a0 + 1 + gap).max(e.a_end().saturating_sub(SYNTENY_CHAIN_GAP));
    let (mut back, mut i, mut mm) = (c.a0, c.a0, 0usize);
    while i > floor && mm < 4 {
        i -= 1;
        match s(c.fwd, dc, i) {
            None => break,
            Some(true) => {
                mm = 0;
                back = i;
            }
            Some(false) => mm += 1,
        }
    }
    let c_end = c.a_end();
    // x1: e's new end; x2 = x1 + gap: c's new start, never before `back`, never c's last base
    let hi = e.a_end().min((c_end - 1).saturating_sub(gap));
    let lo = (e.a0 + 1).max(back.saturating_sub(gap));
    let (x1, x2) = if back >= e.a_end() + gap {
        (e.a_end(), back)
    } else if hi < lo {
        return;
    } else {
        // score of e on [x1, e's end) and of c from x2 to its old start (or less its trimmed
        // bases past it), relative to each run as found
        let mut e_tail: isize = (hi..e.a_end()).map(|i| score_of(s(e.fwd, de, i))).sum();
        let x2_hi = hi + gap;
        let mut c_head: isize = if x2_hi <= c.a0 {
            (x2_hi..c.a0).map(|i| score_of(s(c.fwd, dc, i))).sum()
        } else {
            -(c.a0..x2_hi).map(|i| score_of(s(c.fwd, dc, i))).sum::<isize>()
        };
        let (mut best, mut best_x1) = (c_head - e_tail, hi);
        for x1 in (lo..hi).rev() {
            e_tail += score_of(s(e.fwd, de, x1));
            c_head += score_of(s(c.fwd, dc, x1 + gap));
            if c_head - e_tail >= best {
                (best, best_x1) = (c_head - e_tail, x1);
            }
        }
        (best_x1, best_x1 + gap)
    };
    let matched = |run_fwd: bool, d: isize, from: usize, to: usize| (from..to).filter(|&i| s(run_fwd, d, i) == Some(true)).count();
    e.matches -= matched(e.fwd, de, x1, e.a_end());
    e.len = x1 - e.a0;
    if x2 <= c.a0 {
        c.matches += matched(c.fwd, dc, x2, c.a0);
    } else {
        c.matches -= matched(c.fwd, dc, c.a0, x2);
    }
    c.t0 = (x2 as isize + dc) as usize;
    c.a0 = x2;
    c.len = c_end - x2;
}

/// Where the scan seeds after a block: just past the last base at which the block's score, counted
/// from its start, is highest. Past an indel the ungapped extension runs on bases that match its
/// diagonal only by chance, and a block can end there after a stretch shorter than those bases
/// between two close indels: seeding from the block's end would skip that stretch (BG-01M6TAB2).
/// `pair` is as for [`join_synteny_runs`].
fn synteny_reseed_at(run: &SyntenyRun, pair: impl Fn(bool, usize, isize) -> Option<bool>) -> usize {
    let d = run.diagonal();
    let (mut score, mut best, mut at) = (0isize, 0isize, run.a0);
    for i in run.a0..run.a_end() {
        score += if pair(run.fwd, i, i as isize + d) == Some(true) { 1 } else { -2 };
        if score >= best {
            (best, at) = (score, i + 1);
        }
    }
    at
}

/// A stride or step as the warnings write it: `every base`, `every 2nd base`, `every 11th base`.
fn every_nth_base(n: usize) -> String {
    if n == 1 {
        return "every base".to_string();
    }
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("every {}{suffix} base", format_thousands(n))
}

/// How far the scan moves along genome A after a seed that does not extend into a block. With
/// every base of genome B indexed, a seed at any A-to-B offset finds its hit, so the step costs
/// only the bases between a block's start and the first seed on the step's grid that extends
/// there. Where no seed extends (an unrelated stretch) the scan looks up a quarter of A's bases,
/// which cut its time on two unrelated 5 Mb genomes four- to fivefold against seeding at every base.
const SYNTENY_SEED_STEP: usize = 4;

/// The synteny engine a caller gets without naming one (D0204).
pub const SYNTENY_DEFAULT_ENGINE: &str = "seed-13";

/// D0204: the seed length of each synteny engine value. The report's `engine` names it.
fn synteny_seed_len(engine: &str) -> Option<usize> {
    match engine {
        "seed-13" => Some(13),
        "seed-11" => Some(11),
        _ => None,
    }
}

fn synteny_engine_label(seed_k: usize) -> String {
    format!("Built-in seed-and-extend synteny ({seed_k}-mer seeds)")
}

/// Collinear blocks of genome A in genome B, forward or inverted, found by k-mer seed and ungapped
/// extension along the whole of A, with A's coverage by every block found. Genome B is indexed at
/// every base, so after an indel the scan reaches the new A-to-B offset whatever it is
/// (BG-01M6SKKV), and A is seeded every [`SYNTENY_SEED_STEP`] bases after a seed that does not
/// extend. A block is kept when it scores at least [`SYNTENY_MIN_BLOCK_SCORE`], or when it links to
/// the blocks beside it in a chain that does, less what its links cost (BG-01M6TAB2).
///
/// Every byte of each sequence is a position, so blocks are in each genome's own 1-based
/// numbering. A base other than A/C/G/T (N, another IUPAC ambiguity code) stays in place: no seed
/// holds one and no block crosses one, the coverage is of A's A/C/G/T bases, and the warnings say
/// how many each genome holds.
///
/// `engine` is `seed-13` or `seed-11`, the seed length; any other value seeds with
/// [`SYNTENY_DEFAULT_ENGINE`] and says so in the warnings (D0204, D0005). The report's `engine`
/// names the seed length used.
pub fn run_whole_genome_synteny(
    seq_a: &str,
    seq_b: &str,
    engine: &str,
) -> WholeGenomeSyntenyReport {
    run_whole_genome_synteny_with_sampling(seq_a, seq_b, engine, 1, SYNTENY_SEED_STEP)
}

/// [`run_whole_genome_synteny`] with its sampling chosen: genome B indexed at every `b_stride`th
/// position, and genome A seeded every `a_step`th base after a seed that does not extend (each
/// taken as at least 1). A stride above 1 marks the coverage as a lower bound and says so in the
/// warnings. The synteny tests run it at stride 2, the stride the public scan used on a 700 kb
/// genome B before BG-01M6SKKV, with A's step of 4.
#[doc(hidden)]
pub fn run_whole_genome_synteny_with_sampling(
    seq_a: &str,
    seq_b: &str,
    engine: &str,
    b_stride: usize,
    a_step: usize,
) -> WholeGenomeSyntenyReport {
    let (b_stride, a_step) = (b_stride.max(1), a_step.max(1));
    let a: Vec<u8> = seq_a.bytes().map(synteny_base_code).collect();
    let b: Vec<u8> = seq_b.bytes().map(synteny_base_code).collect();
    let acgt = |codes: &[u8]| codes.iter().filter(|&&c| c != SYNTENY_NOT_ACGT).count();
    let (acgt_a, acgt_b) = (acgt(&a), acgt(&b));

    // D0204, D0005: an engine value other than seed-13 or seed-11 is the default, with a warning
    let mut warnings = Vec::new();
    let seed_k = synteny_seed_len(engine).unwrap_or_else(|| {
        let k = synteny_seed_len(SYNTENY_DEFAULT_ENGINE).expect("the default is an engine value");
        warnings.push(format!(
            "Unknown synteny engine \"{engine}\"; aligned with the default, {SYNTENY_DEFAULT_ENGINE} ({}).",
            synteny_engine_label(k)
        ));
        k
    });
    for (genome, codes, bases) in [("A", &a, acgt_a), ("B", &b, acgt_b)] {
        let other = codes.len() - bases;
        if other > 0 {
            let (noun, pronoun) = if other == 1 { ("base", "it") } else { ("bases", "them") };
            warnings.push(format!(
                "Genome {genome} holds {} N or other ambiguity {noun}; no block crosses {pronoun}, and coverage is of its {} A/C/G/T bases.",
                format_thousands(other),
                format_thousands(bases)
            ));
        }
    }
    if b_stride > 1 {
        warnings.push(format!(
            "Synteny indexed {} of genome B and seeded {} of genome A; coverage is a lower bound.",
            every_nth_base(b_stride),
            every_nth_base(a_step)
        ));
    }

    let index = SyntenyKmerIndex::build(&b, seed_k, b_stride);
    let fwd_target = |t: usize| b[t];
    let rc_target = |t: usize| match b[b.len() - 1 - t] {
        SYNTENY_NOT_ACGT => SYNTENY_NOT_ACGT,
        c => 3 - c,
    };

    // whether A's base i matches the target's base t on a strand, None where either is not
    // A/C/G/T or t is outside the target
    let pair = |fwd: bool, i: usize, t: isize| -> Option<bool> {
        let y = usize::try_from(t).ok().filter(|&t| t < b.len()).map(|t| if fwd { fwd_target(t) } else { rc_target(t) })?;
        (a[i] != SYNTENY_NOT_ACGT && y != SYNTENY_NOT_ACGT).then_some(a[i] == y)
    };

    // The blocks kept, in A order, and the chain the scan is building after the latest kept block:
    // runs that link to each other but have not yet reached the floor together, with what their
    // links cost. A run that links to the latest kept block is kept at once: that chain has
    // reached the floor.
    let mut kept: Vec<SyntenyRun> = Vec::new();
    let mut pending: Vec<SyntenyRun> = Vec::new();
    let mut pending_cost = 0isize;
    let mut cursor_a = 0usize;

    // Every block to the end of A: coverage and the inversion count are of the whole genome.
    while cursor_a + seed_k <= a.len() {
        if pending.last().is_some_and(|run| cursor_a > run.a_end() + SYNTENY_CHAIN_GAP) {
            pending.clear();
        }
        if let Some(last) = a[cursor_a..cursor_a + seed_k].iter().rposition(|&c| c == SYNTENY_NOT_ACGT) {
            cursor_a += last + 1;
            continue;
        }
        // The strand and diagonal of the latest kept block, or before any is kept of the chain
        // the scan is building. Of a seed's hits on that strand, the one nearest the diagonal is
        // taken: it continues the block past an indel, where a repeated k-mer's first hit can lie
        // in another copy of the repeat. Once a block is kept, a run under the floor sets no
        // diagonal: it may be a chance seed's, such as one in bases B lacks (BG-01M6TAB2).
        let latest = kept.last().or(pending.last()).copied();
        // The hit in a strand's target of A's k-mer at p, nearest the latest block's diagonal,
        // and whether it lies near it; `None` where the k-mer holds a base other than A/C/G/T.
        // Where B holds the k-mer's reverse complement at q, B's reverse complement holds the
        // k-mer at b.len() - q - k.
        let lookup = |fwd: bool, p: usize| -> Option<(usize, bool)> {
            let kmer = &a[p..p + seed_k];
            if kmer.contains(&SYNTENY_NOT_ACGT) {
                return None;
            }
            let expected = latest.filter(|run| run.fwd == fwd).map(|run| p as isize + run.diagonal());
            if fwd {
                index.nearest(kmer.iter().fold(0u64, |acc, &c| (acc << 2) | u64::from(c)), expected)
            } else {
                let rc_code = kmer.iter().rev().fold(0u64, |acc, &c| (acc << 2) | u64::from(3 - c));
                let last = b.len() as isize - seed_k as isize;
                index.nearest(rc_code, expected.map(|e| last - e)).map(|(q, near)| (b.len() - q - seed_k, near))
            }
        };
        let run_at = |fwd: bool, t: usize| {
            let (len, matches) = if fwd {
                extend_synteny_seed(&a, cursor_a, fwd_target, t, b.len(), seed_k)
            } else {
                extend_synteny_seed(&a, cursor_a, rc_target, t, b.len(), seed_k)
            };
            SyntenyRun { fwd, a0: cursor_a, t0: t, len, matches }
        };
        // a run goes on when it reaches the floor alone or links to a chain before it
        let goes_on = |run: &SyntenyRun| {
            run.score() >= SYNTENY_MIN_BLOCK_SCORE || [kept.last(), pending.last()].into_iter().flatten().any(|prev| prev.link_to(run).is_some())
        };
        // A seed's hit is a candidate unless it is a jump the bases past the seed do not
        // confirm: off the latest block's diagonal (or on the other strand), with one of the next
        // SYNTENY_JUMP_CHECKS k-mers inside its run near that diagonal. Such a seed belongs to
        // the copy beside the block before; it is skipped, and the scan's next seed resumes on
        // that copy. A run too short to hold a k-mer past its seed is not checked.
        let candidate = |fwd: bool| -> Option<SyntenyRun> {
            let (t, near) = lookup(fwd, cursor_a)?;
            let run = run_at(fwd, t);
            let unconfirmed = |prev: SyntenyRun| {
                (1..=SYNTENY_JUMP_CHECKS)
                    .map(|m| cursor_a + m * seed_k)
                    .take_while(|&p| p + seed_k <= run.a_end())
                    .any(|p| lookup(prev.fwd, p).is_some_and(|(_, near)| near))
            };
            (near || !latest.is_some_and(unconfirmed)).then_some(run)
        };

        // The forward hit, or the reverse one when the forward hit does not go on (so a k-mer that
        // also occurs forward by chance does not hide an inversion).
        let fwd = candidate(true);
        let found = match fwd {
            Some(run) if goes_on(&run) => Some(run),
            _ => {
                let rev = candidate(false);
                // where neither goes on, the better one may start a chain
                [fwd, rev].into_iter().flatten().max_by_key(|run| (goes_on(run), run.score()))
            }
        };
        // a seed inside the latest kept block, on its diagonal, only sees that block again
        let Some(mut run) = found.filter(|run| !kept.last().is_some_and(|prev| prev.holds(run))) else {
            cursor_a += a_step;
            continue;
        };

        let to_kept = kept.last().and_then(|prev| prev.link_to(&run));
        let to_pending = pending.last().and_then(|prev| prev.link_to(&run));
        if let (Some(prev), Some(_)) = (kept.last_mut(), to_kept) {
            // the latest kept block's chain goes on, past any chain started since
            pending.clear();
            join_synteny_runs(prev, &mut run, pair);
            kept.push(run);
        } else if let (Some(prev), Some(shift)) = (pending.last_mut(), to_pending) {
            join_synteny_runs(prev, &mut run, pair);
            pending.push(run);
            pending_cost += synteny_link_cost(shift);
            if pending.iter().map(SyntenyRun::score).sum::<isize>() - pending_cost >= SYNTENY_MIN_BLOCK_SCORE {
                kept.append(&mut pending);
            }
        } else if run.score() >= SYNTENY_MIN_BLOCK_SCORE {
            pending.clear();
            if let Some(prev) = kept.last_mut().filter(|prev| prev.abuts(&run)) {
                join_synteny_runs(prev, &mut run, pair);
            }
            kept.push(run);
        } else {
            // A run under the floor that links to nothing may start a chain. The scan goes on
            // seeding at the step, as it would past a seed that makes no block, so a better run
            // starting inside this one is still found; a later seed that only sees this run again
            // leaves it standing.
            if !pending.last().is_some_and(|prev| prev.holds(&run)) {
                pending.clear();
                pending.push(run);
                pending_cost = 0;
            }
            cursor_a += a_step;
            continue;
        }
        cursor_a = synteny_reseed_at(&run, pair).max(cursor_a + 1);
    }

    let mut blocks: Vec<SyntenyLcbBlock> = Vec::with_capacity(kept.len());
    for run in &kept {
        let (b_coord_start, b_coord_end) = if run.fwd {
            (run.t0 + 1, run.t0 + run.len)
        } else {
            (b.len() - (run.t0 + run.len) + 1, b.len() - run.t0)
        };
        let is_rearranged = run.fwd
            && blocks
                .last()
                .map(|prev| prev.strand == "+" && b_coord_start < prev.genome_b_start)
                .unwrap_or(false);
        let event_class = if !run.fwd {
            "Inversion"
        } else if is_rearranged {
            "Translocation / Rearrangement"
        } else {
            "Collinear Synteny"
        };
        blocks.push(SyntenyLcbBlock {
            block_id: format!("LCB_{}", blocks.len() + 1),
            strand: if run.fwd { "+".to_string() } else { "-".to_string() },
            event_class: event_class.to_string(),
            genome_a_start: run.a0 + 1,
            genome_a_end: run.a_end(),
            genome_b_start: b_coord_start,
            genome_b_end: b_coord_end,
            length_bp: run.len,
            identity_percent: ((run.matches as f64 / run.len.max(1) as f64) * 1000.0).round() / 10.0,
        });
    }

    let total_aligned_bp: usize = blocks.iter().map(|blk| blk.length_bp).sum();
    let inversion_count = blocks.iter().filter(|blk| blk.strand == "-").count();

    WholeGenomeSyntenyReport {
        engine: synteny_engine_label(seed_k),
        total_aligned_bp,
        genome_a_coverage_pct: (((total_aligned_bp as f64 / acgt_a.max(1) as f64) * 100.0)
            .min(100.0)
            * 10.0)
            .round()
            / 10.0,
        inversion_count,
        blocks,
        genome_a_coverage_is_lower_bound: b_stride > 1,
        warnings,
    }
}

// ============================================================================
// 6. Bayesian Haplotype Variant Caller (SNPs, MNPs & Indels + VCFv4.2)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeBayesVariantRecord {
    pub id: String,
    pub position_bp: usize,
    pub ref_allele: String,
    pub alt_allele: String,
    pub variant_type: String,
    pub mutation_class: String,
    pub phred_qual: f64,
    pub genotype: String,
    pub allele_observation_balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeBayesVariantReport {
    pub total_variants: usize,
    pub snp_count: usize,
    pub mnp_or_indel_count: usize,
    pub ti_tv_ratio: f64,
    /// Every variant called, in reference order.
    pub variants: Vec<FreeBayesVariantRecord>,
    /// One VCF row per variant.
    pub vcf_text: String,
    /// One feature per variant, at its reference position.
    pub annotations: Vec<SequenceFeature>,
    /// D0005: what the call left out, one sentence each; empty when the whole sample was aligned
    /// and compared.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Reference bases the caller's window reaches past each end of the mapped sample.
const CALL_FLANK_BP: usize = 200;
/// How much of the sample the caller aligns and calls: its first 100,000 bases as it maps to the
/// reference (of its reverse complement, for a sample on the reverse strand). A longer sample is
/// called over those only, and the report's `warnings` says how much was aligned, where calling
/// stopped and how much of the sample was not compared (BG-01M6S1ED). The cap stays because the
/// Genomics studio calls variants while its variants tab renders, on the UI thread.
const CALL_ALIGNED_CAP_BP: usize = 100_000;
/// The most traceback the caller lets one alignment of a whole sample keep: 256 MiB (2^28 bytes).
/// A sample whose one-shot alignment would keep more is aligned in segments.
///
/// rust-bio's aligners keep a traceback of (|x| + 1) x (|y| + 1) two-byte cells whatever the band
/// (bio 2.3 `Traceback::init`), in one allocation. A wasm32 engine cannot request one allocation
/// over `isize::MAX` (2 GiB - 1), and its linear memory, at most 4 GiB, never shrinks once it has
/// grown: one alignment of a whole 40 kb sample asked for 3.2 GB and trapped the engine
/// (BG-01M6S1QP). 256 MiB is an eighth of that single-allocation ceiling, and with the 128 MiB the
/// engine's resident store may hold comes to 384 MiB. A sample aligned to a window 400 bases longer
/// than itself is within it up to 11,385 bases, and is aligned exactly as the caller aligned every
/// sample before segments.
pub const CALL_ONE_SHOT_MAX_BYTES: usize = 256 << 20;
/// The most traceback one segment of [`align_sample_in_segments`] may keep: 64 MiB. A segment
/// normally keeps about 2 MB, and grows toward this only where no seam is near: past an indel of
/// thousands of bases, or across a stretch with no long matched run on the chain.
const CALL_SEGMENT_MAX_BYTES: usize = 64 << 20;
/// The k-mer length and band width of the caller's banded alignment.
const CALL_K: usize = 11;
const CALL_BAND_W: usize = 64;
/// Sample bases from one seam of [`align_sample_in_segments`] to the next, where the sample matches
/// the reference there.
const CALL_SEGMENT_BP: usize = 1_000;
/// Bases the sample matches the reference exactly, along the chain, on each side of a seam.
const CALL_SEAM_FLANK_BP: usize = 16;
/// The most 11-mer matches the segments' chain is found among: 2,000,000, so each of sdpkpp's
/// lists stays under 64 MiB. A random 100 kb sample has about 100,000.
const CALL_CHAIN_MAX_MATCHES: usize = 2_000_000;
/// The most cells of one piece of a stretch with no chain match that one segment cannot span
/// within [`CALL_SEGMENT_MAX_BYTES`] (2,000 x 2,000 bases, 8 MB of traceback).
const CALL_UNANCHORED_CELLS: usize = 4_000_000;

/// Bytes of rust-bio traceback one alignment of `m` against `n` bases keeps.
fn traceback_bytes(m: usize, n: usize) -> usize {
    (m + 1).saturating_mul(n + 1).saturating_mul(2)
}

/// The bases of `seq` as the caller reads them, each in its place: every letter, in upper case,
/// with U read as T. Spaces, digits and gap or stop marks are not bases and are left out. A letter
/// other than A, C, G or T (N or another ambiguity code) stays where it is, as a base the caller
/// does not know (BG-01M6T6GK); removing it moved every base after it.
fn call_bases(seq: &str) -> String {
    seq.bytes()
        .filter(u8::is_ascii_alphabetic)
        .map(|b| match b.to_ascii_uppercase() {
            b'U' => 'T',
            u => u as char,
        })
        .collect()
}

/// Whether the caller knows base `b`: A, C, G or T.
fn call_known(b: u8) -> bool {
    matches!(b, b'A' | b'C' | b'G' | b'T')
}

/// The caller's score for an alignment column: match 2, mismatch -3, and 1 where either base is not
/// A, C, G or T. Nothing is called at a column holding such a base whatever its score.
///
/// An unknown base scores between the two (BG-01M6TE8J), so moving a base onto or off a run of N
/// is never free: a known base moved off its match onto an N loses 1, and a sample base moved off
/// a reference N onto a known base gains 1 by a chance match and loses 4 by a mismatch.
///
/// Scored 0, as BG-01M6T6GK first scored it, a sample base moved off a reference N run lost
/// nothing, so a chance match of a few moved bases paid for moving them. Beside a 10-N run, a
/// deletion of 1 to 10 bases 0 to 30 bases after it was then split into a dropped part and a
/// called one, or shifted so that a moved base was called as a SNP: in 5 of the data seat's 73
/// probes, and in 2 of the 73 of the test no_false_call_beside_a_reference_n_run_with_a_real_deletion.
/// Scored 2, as a match (BG-01M6TE8J's first fix), a known base moved onto an N lost nothing, so
/// beside a run of more N than the bases it stands for, the bases next to the run slid into its
/// spare N: a SNP 5 to 9 bases from a run of 20 N standing for 10 bases was hidden in a deletion
/// left out beside the run, and a SNP a few bases from such a run gave way to a false deletion
/// that took in its base, at times with a false SNP (the test
/// no_false_call_beside_an_n_run_longer_than_its_bases). Scored 1, a placement against unknown
/// bases can still tie with one among known bases, or come close to it; there the known bases
/// decide where the indel lies, or it is left out ([`place_indels_on_known_bases`],
/// [`indel_placements`]).
/// Scored as a mismatch, a run of N opposite real bases beside a deletion would make deleting the
/// run (and pairing those bases with the deleted ones) score higher, and call SNPs that are not
/// there.
fn call_score(a: u8, b: u8) -> i32 {
    if !call_known(a) || !call_known(b) {
        1
    } else if a == b {
        2
    } else {
        -3
    }
}

/// Whether each `k`-mer of `s`, by its offset, holds only A, C, G and T.
fn known_kmers(s: &[u8], k: usize) -> Vec<bool> {
    let mut known_run = 0usize;
    s.iter()
        .enumerate()
        .filter_map(|(i, &b)| {
            known_run = if call_known(b) { known_run + 1 } else { 0 };
            (i + 1 >= k).then_some(known_run >= k)
        })
        .collect()
}

/// The least sdpkpp score a chain of the 11-mer matches beyond an end of [`call_chain`]'s chain must
/// reach to be added to it: that of 32 matched bases on one diagonal (sdpkpp scores 2 a matched base),
/// a stretch a seam can fall in (2 x [`CALL_SEAM_FLANK_BP`]). A chance 11-mer match alone scores at
/// most 22, and a chance match of 32 bases between two random sequences of 100 kb is expected about
/// once in two billion such pairs. The rounds of [`with_chains_beyond_its_ends`] so add only
/// anchored stretches, each of 32 bases or more.
const CALL_CHAIN_JOIN_SCORE: u32 = 4 * CALL_SEAM_FLANK_BP as u32;

/// The chain of 11-mer matches between `query` and `reference` that [`align_sample_in_segments`]
/// bands along: rust-bio's sdpkpp sparse DP (match 2, gap open 5, gap extend 2, as the one-shot
/// banded alignment chains a pair) over every 11-mer match of the whole pair, with the chains of the
/// matches it leaves out beyond either end ([`with_chains_beyond_its_ends`]). Where the matches
/// would number more than [`CALL_CHAIN_MAX_MATCHES`], as a long low-complexity run makes them
/// (4,000 bases of poly-A match 16 million times), the 11-mers with the most copies in `reference`
/// are left out until they do not. Positions increase in both sequences. An 11-mer that holds a
/// base other than A, C, G or T matches nothing.
fn call_chain(query: &[u8], reference: &[u8]) -> Vec<(u32, u32)> {
    let k = CALL_K;
    if query.len() < k || reference.len() < k {
        return Vec::new();
    }
    let code = |s: &[u8]| {
        s.iter().fold(0u32, |c, &b| {
            (c << 2)
                | match b {
                    b'A' => 0,
                    b'C' => 1,
                    b'G' => 2,
                    _ => 3,
                }
        })
    };
    let (query_known, reference_known) = (known_kmers(query, k), known_kmers(reference, k));
    let mut index: Vec<(u32, u32)> = (0..=reference.len() - k)
        .filter(|&y| reference_known[y])
        .map(|y| (code(&reference[y..y + k]), y as u32))
        .collect();
    index.sort_unstable();
    // where each query 11-mer's copies start in `index`, and how many there are
    let copies: Vec<(u32, u32)> = (0..=query.len() - k)
        .map(|x| {
            if !query_known[x] {
                return (0, 0);
            }
            let c = code(&query[x..x + k]);
            let lo = index.partition_point(|&(v, _)| v < c);
            (lo as u32, index[lo..].partition_point(|&(v, _)| v == c) as u32)
        })
        .collect();
    // the most copies an 11-mer may have and stay in: all of them, unless that is too many matches
    let mut counts: Vec<u32> = copies.iter().map(|&(_, n)| n).collect();
    counts.sort_unstable();
    let (mut most, mut total, mut i) = (u32::MAX, 0usize, 0usize);
    while i < counts.len() {
        // the 11-mers with n copies go in or stay out together
        let n = counts[i];
        let alike = counts[i..].partition_point(|&c| c == n);
        total += n as usize * alike;
        if total > CALL_CHAIN_MAX_MATCHES {
            most = n - 1;
            break;
        }
        i += alike;
    }
    let mut matches = Vec::new();
    for (x, &(lo, n)) in copies.iter().enumerate() {
        if n <= most {
            matches.extend(index[lo as usize..(lo + n) as usize].iter().map(|&(_, y)| (x as u32, y)));
        }
    }
    if matches.is_empty() {
        return matches;
    }
    let chain = sdpkpp(&matches, k, 2, -5, -2).path.iter().map(|&i| matches[i]).collect();
    with_chains_beyond_its_ends(query, reference, &matches, chain)
}

/// The 11-mer matches beyond one end of a piece of [`call_chain`]'s chain: those wholly before its
/// first 11-mer in both sequences (`before`), or wholly after its last; and that 11-mer (`end`).
struct Beyond {
    matches: Vec<(u32, u32)>,
    before: bool,
    end: (u32, u32),
}

/// `chain`, sdpkpp's chain of `matches` (sorted by query then reference offset), with a chain of the
/// matches that lie wholly before its first 11-mer in both sequences, and one of those wholly after
/// its last, wherever sdpkpp's chain of them scores at least [`CALL_CHAIN_JOIN_SCORE`]
/// ([`chain_beside`] says which); and so on outwards from each chain added. Positions still
/// increase in both sequences.
///
/// sdpkpp charges a gap between two 11-mers 5 + 2 a base of its longer side, so it ends its chain
/// short of an anchored stretch that scores less than the gap before it costs: past a run of 30,000
/// N, one of 30,000 bases or fewer, which is what a 101,000-bp sample's tail is once the cap cuts it
/// to 100,000. The alignment scores a run of bases the caller does not know 1 a base it pairs, and
/// charges a gap only for its difference in length from the bases it stands for, so the chain
/// stopped where the alignment does not. With no chain 11-mer past the run, [`segment_seams`] cut
/// the rest of the sample on the diagonal of the end of both sequences, which the cap's cut (or the
/// window's 200-base flank) puts off the sample's own, and every base after the run was aligned off
/// by that much: thousands of false calls (BG-01M6VMNF). Where the stretch before the run was the
/// shorter, the chain began after the run, and the bases before it were aligned on the diagonal of
/// the bases after it.
fn with_chains_beyond_its_ends(query: &[u8], reference: &[u8], matches: &[(u32, u32)], chain: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    let k = CALL_K as u32;
    // the matches wholly before the first 11-mer of `piece` and wholly after its last
    let beyond = |ms: &[(u32, u32)], piece: &[(u32, u32)]| -> [Beyond; 2] {
        let (first, last) = (piece[0], piece[piece.len() - 1]);
        [
            Beyond { matches: ms.iter().copied().filter(|&(x, y)| x + k <= first.0 && y + k <= first.1).collect(), before: true, end: first },
            Beyond { matches: ms.iter().copied().filter(|&(x, y)| x >= last.0 + k && y >= last.1 + k).collect(), before: false, end: last },
        ]
    };
    if chain.is_empty() {
        return chain;
    }
    let mut todo: Vec<Beyond> = beyond(matches, &chain).into();
    let mut pieces = vec![chain];
    while let Some(b) = todo.pop() {
        let Some(piece) = chain_beside(query, reference, &b) else {
            continue;
        };
        todo.extend(beyond(&b.matches, &piece));
        pieces.push(piece);
    }
    pieces.sort_unstable_by_key(|p| p[0]);
    pieces.concat()
}

/// What the caller's alignment charges for the indel between a cell on diagonal `a` and one on
/// diagonal `b` (a diagonal is the reference offset less the query offset): 5 + 2n for a gap of n
/// bases, which it scores -5 - 2n ([`call_score`]'s scoring); nothing when they are on one diagonal.
fn indel_cost(a: i64, b: i64) -> i64 {
    match (a - b).unsigned_abs() {
        0 => 0,
        n => 5 + 2 * n as i64,
    }
}

/// Whether a base the caller does not know lies between 11-mer `a` and a later 11-mer `b` (after
/// `a`'s last base and before `b`'s first), in the query or in the reference.
fn unknown_between(query: &[u8], reference: &[u8], a: (u32, u32), b: (u32, u32)) -> bool {
    let between = |s: &[u8], from: u32, to: u32| s[(from as usize + CALL_K).min(to as usize)..to as usize].iter().any(|&c| !call_known(c));
    between(query, a.0, b.0) || between(reference, a.1, b.1)
}

/// The chain [`with_chains_beyond_its_ends`] adds for the matches `b.matches` beyond one end of a
/// piece, or none where sdpkpp's chain of them scores less than [`CALL_CHAIN_JOIN_SCORE`].
///
/// sdpkpp's chain of them is added unless a base the caller does not know lies between its 11-mer
/// next to the piece and the piece's `end`. Across such bases, the chain added is the one that
/// covers the query span of sdpkpp's own chain and scores best once the indel between it and the
/// piece is charged as the alignment charges it: of sdpkpp's best chains reaching outwards from
/// each match (ending there before the piece, starting there after it) that score
/// [`CALL_CHAIN_JOIN_SCORE`] or more and span at least `[chain[0].0, chain[chain.len() - 1].0]` in
/// the query, the one whose score less [`indel_cost`] between that match and `end` is highest;
/// sdpkpp's own chain unless another is strictly higher. A run of N stands for some number of
/// reference bases, and the alignment pairs it with as many and charges a gap only for the rest.
/// An exact repeat copy of the stretch beside the run scores as the stretch itself does, and
/// sdpkpp's tie took the later copy, so a stretch beside a run of the right size was put on a copy
/// inside the bases the run stands for, or just past the sample's tail: its SNPs were called at the
/// copy, and the run was named as an indel as long as the copy's distance (BG-01M6VMNF). Charged
/// only that indel, a partial or near repeat copy that sits closer to `end`'s diagonal (an exact
/// copy of the stretch's first 1 kb, a 97%-identical copy of its first 300 bases, a (CA)25
/// microsatellite) took the near end of the stretch, and the rest of it was aligned off its
/// diagonal: 1,400 or more false calls a path. Its chain reaches only part of the stretch, and
/// the bases it leaves out cost it nothing, so a candidate must span at least sdpkpp's query span
/// (BG-01M6VZXE): a chain that reaches only the near end of the stretch is never weighed against
/// sdpkpp's own, and neither is charged for bases it leaves out.
///
/// With no unknown base between, sdpkpp's chain stands, as it did before. Where the stretch has an
/// exact copy there, a deletion of either length leaves the same sample, and sdpkpp's tie still
/// takes the later copy.
fn chain_beside(query: &[u8], reference: &[u8], b: &Beyond) -> Option<Vec<(u32, u32)>> {
    let ms = &b.matches;
    if ms.is_empty() {
        return None;
    }
    let found = sdpkpp(ms, CALL_K, 2, -5, -2);
    if found.score < CALL_CHAIN_JOIN_SCORE {
        return None;
    }
    let chain: Vec<(u32, u32)> = found.path.iter().map(|&i| ms[i]).collect();
    let near = if b.before { chain[chain.len() - 1] } else { chain[0] };
    let unknown = if b.before { unknown_between(query, reference, near, b.end) } else { unknown_between(query, reference, b.end, near) };
    if !unknown {
        return Some(chain);
    }
    let diagonal = |(x, y): (u32, u32)| y as i64 - x as i64;
    let to_end = diagonal(b.end);
    // `dp[i]` is sdpkpp's best chain ending at `cand[i]` and reaching outwards from the piece:
    // before it, of the matches as given; after it, of the matches with both offsets reversed,
    // where a chain ending at a reversed match is one starting at that match. `near_i` is where
    // sdpkpp's own chain meets the piece.
    let (cand, dp, near_i) = if b.before {
        (ms.clone(), found.dp_vector, found.path[found.path.len() - 1])
    } else {
        let (xm, ym) = ms.iter().fold((0, 0), |(xm, ym), &(x, y)| (xm.max(x), ym.max(y)));
        let mut reversed: Vec<(u32, u32)> = ms.iter().map(|&(x, y)| (xm - x, ym - y)).collect();
        reversed.sort_unstable();
        let Ok(first) = reversed.binary_search(&(xm - near.0, ym - near.1)) else {
            return Some(chain);
        };
        let dp = sdpkpp(&reversed, CALL_K, 2, -5, -2).dp_vector;
        (reversed.iter().map(|&(x, y)| (xm - x, ym - y)).collect(), dp, first)
    };
    let mut far_x = Vec::with_capacity(cand.len());
    for i in 0..cand.len() {
        let p = dp[i].1;
        far_x.push(if p < 0 { cand[i].0 } else { far_x[p as usize] });
    }
    let (q_first, q_last) = (chain[0].0, chain[chain.len() - 1].0);
    let covers = |i: usize| {
        let (lo, hi) = if b.before { (far_x[i], cand[i].0) } else { (cand[i].0, far_x[i]) };
        lo <= q_first && hi >= q_last
    };
    let net = |i: usize| dp[i].0 as i64 - indel_cost(diagonal(cand[i]), to_end);
    let best = (0..cand.len())
        .filter(|&i| dp[i].0 >= CALL_CHAIN_JOIN_SCORE && covers(i))
        .max_by_key(|&i| (net(i), i == near_i));
    let Some(best) = best.filter(|&i| i != near_i && net(i) > net(near_i)) else {
        return Some(chain);
    };
    // the chain through sdpkpp's pointers from `best`, outwards from the piece
    let mut path = Vec::new();
    let mut i = best as i32;
    while i >= 0 {
        path.push(cand[i as usize]);
        i = dp[i as usize].1;
    }
    if b.before {
        path.reverse();
    }
    Some(path)
}

/// Where [`align_sample_in_segments`] cuts the pair: cells (query offset, reference offset), the
/// query offset rising from each to the next and the reference offset never falling. A seam is a
/// cell inside a stretch where the chain has the sample equal to the reference, with at least
/// [`CALL_SEAM_FLANK_BP`] equal bases on each side of it, so it never falls in or beside an
/// insertion, deletion or mismatch on the chain.
///
/// Each cut is the first seam [`CALL_SEGMENT_BP`] or more sample bases past the cut before, so a
/// segment runs on past an indel to the matched stretch after it, whatever the indel's length,
/// while the segment keeps at most [`CALL_SEGMENT_MAX_BYTES`] of traceback. A segment that would
/// keep more is cut short at the farthest seam that keeps it within that limit; failing one, just
/// after the farthest chain 11-mer that does; failing both (no chain 11-mer within the limit), on
/// the diagonal of the next chain 11-mer (or, with none ahead, of the cut before, as far as the
/// reference reaches), in pieces of at most [`CALL_UNANCHORED_CELLS`] cells. Every segment between
/// two cuts therefore keeps at most [`CALL_SEGMENT_MAX_BYTES`] of traceback.
fn segment_seams(chain: &[(u32, u32)], qn: usize, rn: usize) -> Vec<(usize, usize)> {
    let (k, h) = (CALL_K, CALL_SEAM_FLANK_BP);
    let mut runs = chain_stretches(chain);
    runs.retain(|r| r.2 >= 2 * h);
    let fits = |s: (usize, usize), e: (usize, usize)| traceback_bytes(e.0 - s.0, e.1 - s.1) <= CALL_SEGMENT_MAX_BYTES;
    let mut seams = Vec::new();
    let mut s = (0usize, 0usize);
    let mut first_run = 0usize;
    loop {
        while first_run < runs.len() && runs[first_run].0 + runs[first_run].2 - h <= s.0 {
            first_run += 1;
        }
        let target = s.0 + CALL_SEGMENT_BP;
        let next = runs[first_run..]
            .iter()
            .filter(|r| r.0 + r.2 - h >= target)
            .map(|&(rx, ry, _)| {
                let x = target.max(rx + h);
                (x, ry + (x - rx))
            })
            .find(|c| c.1 > s.1);
        match next {
            Some(c) if fits(s, c) => {
                seams.push(c);
                s = c;
                continue;
            }
            None if fits(s, (qn, rn)) => break,
            _ => {}
        }
        // The next seam is out of reach: the farthest seam cell within the limit. Cells further
        // along the chain are further in both sequences, so the ones within the limit come first.
        let mut cut = None;
        'runs: for &(rx, ry, len) in &runs[first_run..] {
            let cell = |x: usize| (x, ry + (x - rx));
            let (mut lo, mut hi) = ((rx + h).max(s.0 + 1), rx + len - h);
            if lo > hi || cell(lo).1 <= s.1 {
                continue;
            }
            if !fits(s, cell(lo)) {
                break;
            }
            let whole = fits(s, cell(hi));
            while lo < hi {
                let mid = (lo + hi).div_ceil(2);
                if fits(s, cell(mid)) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            cut = Some(cell(lo));
            if !whole {
                break 'runs;
            }
        }
        // failing that, after the farthest chain 11-mer within the limit
        if cut.is_none() {
            let from = chain.partition_point(|&(x, _)| (x as usize) < s.0);
            cut = chain[from..]
                .iter()
                .map(|&(x, y)| (x as usize + k, y as usize + k))
                .filter(|c| c.1 > s.1)
                .take_while(|&c| fits(s, c))
                .last();
        }
        let cut = cut.unwrap_or_else(|| {
            // failing both, on the diagonal of the next chain match (or, with none ahead, of the cut
            // before), in a piece of at most CALL_UNANCHORED_CELLS cells. The piece holds no chain
            // match, so it is aligned over its full matrix; on that diagonal, a stretch left out of
            // the chain as too repetitive (an array of one unit, say, shortened by one copy) is cut
            // where the sample is in step with the reference after it, so the indel falls in the
            // first piece and the pieces after it match. With no chain match ahead nothing anchors
            // a shift, and the pieces stay on the cut's diagonal as far as the reference reaches.
            // The end of both sequences is no anchor: the window runs 200 bases past where the
            // aligned sample ends, so pieces cut on its diagonal named a 200-bp deletion beside a
            // run of N that ends the aligned sample (BG-01M6VMNF).
            let from = chain.partition_point(|&(x, _)| (x as usize) < s.0);
            let to = chain[from..]
                .iter()
                .map(|&(x, y)| (x as usize, y as usize))
                .find(|c| c.1 >= s.1)
                .unwrap_or((qn, rn.min(s.1 + (qn - s.0))));
            // reference bases the sample is behind `to`'s diagonal at `s`: a cut d sample bases on
            // is d - behind reference bases on
            let behind = (s.1 as isize - s.0 as isize) - (to.1 as isize - to.0 as isize);
            let cells = |d: usize| (d + 1).saturating_mul((d as isize - behind) as usize + 1);
            let (mut lo, mut hi) = ((behind.max(1)) as usize, (to.0 - s.0).max(1));
            while lo < hi {
                let mid = (lo + hi).div_ceil(2);
                if cells(mid) <= CALL_UNANCHORED_CELLS {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            (s.0 + lo, (s.1 as isize + lo as isize - behind) as usize)
        });
        if cut.0 >= qn {
            // a cut after a chain 11-mer that ends the sample: the segment ends there, within the
            // limit, rather than running on through the reference after it
            if cut.1 < rn {
                seams.push(cut);
            }
            break;
        }
        seams.push(cut);
        s = cut;
    }
    seams
}

/// The stretches of equal bases along `chain`: (query offset, reference offset, length). 11-mers on
/// one diagonal that overlap or abut are one stretch.
fn chain_stretches(chain: &[(u32, u32)]) -> Vec<(usize, usize, usize)> {
    let mut runs: Vec<(usize, usize, usize)> = Vec::new();
    for &(x, y) in chain {
        let (x, y) = (x as usize, y as usize);
        match runs.last_mut() {
            Some((rx, ry, len)) if x - *rx == y - *ry && x <= *rx + *len => *len = (*len).max(x + CALL_K - *rx),
            _ => runs.push((x, y, CALL_K)),
        }
    }
    runs
}

/// Aligns all of `query` to `reference` under the scoring of the caller's one-shot alignment (the
/// whole query aligned, the reference before and after it free; match 2, mismatch -3, a gap of n
/// bases -5 - 2n) with rust-bio's banded aligner at width 64, in segments that each keep at most
/// [`CALL_SEGMENT_MAX_BYTES`] of traceback, about 2 MB for a segment of 1,000 matched bases.
/// Returns the alignment columns (query row, reference row, `-` for a gap) and the offset in
/// `reference` of the first reference base aligned.
///
/// The 11-mer chain, `chain`, is found once over the whole pair ([`call_chain`]); while the pair has at most
/// [`CALL_CHAIN_MAX_MATCHES`] 11-mer matches it is the chain the one-shot alignment bands along.
/// The pair is cut where [`segment_seams`] says, and each segment is aligned end to end between its
/// two cuts (only the first may start anywhere in the reference, and only the last end anywhere),
/// in the band along the part of the chain inside it. A seam has the sample equal to the reference
/// for [`CALL_SEAM_FLANK_BP`] bases on each side of it, so a segment between seams holds each indel
/// the chain bridges whole, with matched bases fixed at both ends; the chain bridges an indel of n
/// bases roughly where the matched bases on each side of it outscore its gap (more than about n of
/// them). This is not the one-shot alignment: the two differ wherever the one-shot alignment would
/// not pass through a cut, and in what each band holds near a cut. Every gap is then moved as far
/// left as it goes without changing a base ([`left_align_gaps`]), so where a cut falls in a repeat
/// does not decide where an indel in it is reported.
fn align_sample_in_segments(query: &[u8], reference: &[u8], chain: &[(u32, u32)]) -> (Vec<u8>, Vec<u8>, usize) {
    let mut bounds = vec![(0usize, 0usize)];
    bounds.extend(segment_seams(chain, query.len(), reference.len()));
    bounds.push((query.len(), reference.len()));
    let last = bounds.len() - 2;
    let mut qa = Vec::with_capacity(query.len() + 64);
    let mut ra = Vec::with_capacity(query.len() + 64);
    let mut ystart = 0usize;
    for (i, pair) in bounds.windows(2).enumerate() {
        let ((sx, sy), (ex, ey)) = (pair[0], pair[1]);
        let (x, y) = (&query[sx..ex], &reference[sy..ey]);
        if x.is_empty() {
            // only the last segment, after a cut at the end of the sample: its reference is free
            continue;
        }
        if y.is_empty() {
            // no reference bases between these cuts (the window ends, or a piece of a long
            // insertion): the segment's query bases are inserted
            qa.extend_from_slice(x);
            ra.resize(qa.len(), b'-');
            continue;
        }
        let scoring = Scoring::new(-5, -2, call_score);
        let scoring = if i == 0 { scoring.yclip_prefix(0) } else { scoring };
        let scoring = if i == last { scoring.yclip_suffix(0) } else { scoring };
        let from = chain.partition_point(|&(cx, _)| (cx as usize) < sx);
        let points: Vec<(u32, u32)> = chain[from..]
            .iter()
            .take_while(|&&(cx, _)| cx as usize + CALL_K <= ex)
            .filter(|&&(_, cy)| cy as usize >= sy && cy as usize + CALL_K <= ey)
            .map(|&(cx, cy)| (cx - sx as u32, cy - sy as u32))
            .collect();
        let Some(mut aln) = align_along_chain(x, y, scoring, CALL_K, CALL_BAND_W, &points) else {
            // not reached: every segment keeps at most CALL_SEGMENT_MAX_BYTES of traceback, so it is
            // within EXACT_CELLS and align_along_chain aligns it over the full matrix when no band
            // fits; pair the bases off rather than allocate more
            let n = x.len().max(y.len());
            qa.extend((0..n).map(|j| x.get(j).copied().unwrap_or(b'-')));
            ra.extend((0..n).map(|j| y.get(j).copied().unwrap_or(b'-')));
            continue;
        };
        aln.filter_clip_operations();
        if i == 0 {
            ystart = aln.ystart;
        }
        push_columns(&aln, x, y, &mut qa, &mut ra);
    }
    left_align_gaps(&mut qa, &mut ra);
    (qa, ra, ystart)
}

/// Appends the columns of rust-bio alignment `aln` of `x` against `y` (its clip operations filtered
/// out) to the query row `qa` and the reference row `ra`, `-` for a gap.
fn push_columns(aln: &Alignment, x: &[u8], y: &[u8], qa: &mut Vec<u8>, ra: &mut Vec<u8>) {
    let (mut xi, mut yi) = (aln.xstart, aln.ystart);
    for op in &aln.operations {
        let (q, r) = match *op {
            AlignmentOperation::Match | AlignmentOperation::Subst => {
                xi += 1;
                yi += 1;
                (x[xi - 1], y[yi - 1])
            }
            AlignmentOperation::Ins => {
                xi += 1;
                (x[xi - 1], b'-')
            }
            AlignmentOperation::Del => {
                yi += 1;
                (b'-', y[yi - 1])
            }
            AlignmentOperation::Xclip(_) | AlignmentOperation::Yclip(_) => continue,
        };
        qa.push(q);
        ra.push(r);
    }
}

/// Aligns all of `query` to `reference` in one rust-bio banded alignment, as the caller aligned
/// every sample before BG-01M6S1QP: semi-global (the whole query aligned, the reference before and
/// after it free), banded at width 64 along the sdpkpp chain of the pair's 11-mer matches (k is the
/// shorter sequence's length below 11), a gap of n bases -5 - 2n, with the fallbacks
/// [`align_within_band_ceiling`] takes past rust-bio's band limit. On A, C, G and T this is the
/// alignment the `align_pairwise_banded_sparse` op gives in semi-global mode, which the caller used
/// to call. That op scores a column holding another IUPAC code as a match wherever the two codes
/// share a base, so N matched every base; here such a column scores [`call_score`]'s 1. Returns the
/// alignment columns and the offset in `reference` of the first reference base aligned, and no
/// columns when either sequence is empty or no band fits.
fn align_sample_in_one_piece(query: &[u8], reference: &[u8]) -> (Vec<u8>, Vec<u8>, usize) {
    if query.is_empty() || reference.is_empty() {
        return (Vec::new(), Vec::new(), 0);
    }
    let k = CALL_K.min(query.len()).min(reference.len());
    let scoring = Scoring::new(-5, -2, call_score).yclip(0);
    let Some((mut aln, _)) = align_within_band_ceiling(query, reference, scoring, k, CALL_BAND_W, false) else {
        return (Vec::new(), Vec::new(), 0);
    };
    aln.filter_clip_operations();
    let (mut qa, mut ra) = (Vec::with_capacity(query.len() + 64), Vec::with_capacity(query.len() + 64));
    push_columns(&aln, query, reference, &mut qa, &mut ra);
    (qa, ra, aln.ystart)
}

/// Whether `bases` hold a run of bases the caller does not know, with bases on both sides of it,
/// that is longer than the bases on its shorter side. [`align_sample_in_one_piece`] bands along
/// sdpkpp's own chain, which charges a gap 2 a base of its longer side and so ends short of an
/// anchored stretch that scores less than the gap before it costs: past a run of N the wrong size,
/// one shorter than the run's error. The band then ran on along the near stretch's diagonal and
/// the far stretch was aligned off its own: 165 to 434 false calls on the test's draws of a sample
/// run of 6,000 or 7,000 N between stretches of 800 to 3,000 bases (BG-01M6W0BZ). Such a pair is
/// aligned in segments, whose chain reaches past the run ([`with_chains_beyond_its_ends`]). A run no
/// longer than the bases on either side of it is aligned in one piece as before: a sample run's
/// surplus is at most its length, so no longer than those bases. A run standing for many more
/// bases than it holds is not caught by this length test.
fn an_unknown_run_outlasts_its_flanks(bases: &[u8]) -> bool {
    let mut i = 0usize;
    while i < bases.len() {
        if call_known(bases[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bases.len() && !call_known(bases[i]) {
            i += 1;
        }
        if start > 0 && i < bases.len() && i - start > start.min(bases.len() - i) {
            return true;
        }
    }
    false
}

/// The fewest sample bases compared with known reference bases that a stretch must hold to be
/// soft-clipped ([`soft_clipped_columns`]); shorter ones (a cluster of a few SNPs, an MNP) are
/// read off the alignment as they lie.
const CALL_SOFT_CLIP_BP: usize = 64;

/// What the bases at the edge of a soft-clipped stretch may gain back and still be clipped with it.
/// Unrelated bases match the reference by chance one time in four, so a chance mismatch followed by
/// three chance matches gains back 3 and is taken in, where it would be called; a related SNP gains
/// 2 a matched base after it, so one with 4 or more matched bases between it and the unrelated bases
/// gains 5 and is called. The alignment may open a gap there that leaves fewer: a SNP 7 bases before
/// 2,000 unrelated bases, 4 of them matched before an insertion, was lost at an allowance of 5 or 6.
const CALL_CLIP_EDGE_GAIN: i32 = 4;

/// What the bases left between a soft-clipped stretch and an anchored one (or another clip) may gain
/// back on their own and still be clipped: two mismatches' cost ([`call_score`]'s 3 each). The
/// alignment is free to take the path that scores best through unrelated bases, so it lines up a
/// few chance matches, around a chance mismatch or a short gap, just before the anchored bases. In
/// BG-01M6W0BZ's second-round probe, 880 reports of 440 samples, such remnants and edges left 1 to
/// 4 false calls beside a clip in 3 samples with [`CALL_CLIP_EDGE_GAIN`] alone (5 at an allowance
/// of 3); taking in remnants that gain 6 or less left 1 (2 false calls after a 1-bp gap at 8%
/// divergence). Related bases gain 2 a matched base, so a remnant of 5 or more matched bases and a
/// SNP is kept.
const CALL_CLIP_REMNANT_GAIN: i32 = 6;

/// What a stretch inside the lowest-scoring stretch of a run must score more than to be kept out of
/// the clip, as related bases: what a chain stretch of 32 matched bases scores (2 a base), the least
/// that anchors bases. 100 bases with a SNP every 16 between two stretches of 300 unrelated bases
/// score about +170, less than either side loses, and were clipped with them; inside the clips of
/// unrelated bases in BG-01M6W0BZ's second-round probe (880 reports), no stretch scored above 28.
/// A long gap is kept out of a clip the same way: beside the 10,000-bp deletion the alignment puts
/// 700 bases before H1's sample run of N, the 65 matched bases after it score 130 and are kept,
/// and the SNP before it is too few known bases to clip.
const CALL_CLIP_KEEP_SCORE: i32 = 4 * CALL_SEAM_FLANK_BP as i32;

/// The alignment columns, as `[start, end)`, of each stretch of the sample the alignment scores as
/// unrelated to the reference, which is soft-clipped. Such a stretch lies in a run of the sample
/// that no stretch of the chain of [`CALL_CHAIN_JOIN_SCORE`]'s 32 or more matched bases on one
/// diagonal pairs (`ra`'s first base is `reference[ystart]`), compares at least
/// [`CALL_SOFT_CLIP_BP`] known sample bases with known reference bases, and scores below zero as
/// the alignment scores its bases ([`call_score`]: a base that matches scores 2 and one that does
/// not -3, so related bases gain and unrelated ones, which match one time in four, lose about 1.75
/// a base; a gap of n bases -5 - 2n). The caller aligns the whole sample, so unrelated bases at a
/// sample end, or in a stretch replaced by unrelated bases, were paired base by base with the
/// reference opposite them and every chance mismatch was called: 622, 587 and 1,516 false calls on
/// the test's draws of 2,000 unrelated bases before or after 60,000 and of 5,000 replaced
/// (BG-01M6W0BZ).
///
/// A run with no anchored stretch also holds related bases that differ too often for 32 of them to
/// match in a row (a SNP every 16 bases, or 8-12% at random), so the whole run is not clipped: the
/// related bases beside unrelated ones were lost with them, every true SNP among them (38 of 38 at
/// one in 16 before 2,000 unrelated bases, in the data seat's round-2 review). The clip is the
/// run's lowest-scoring stretch ([`lowest_scoring_stretch`]); where related bases are followed by
/// unrelated ones to the sample's end, it starts near the highest point of the score's running sum,
/// as the data seat proposed. It takes
/// in the bases beside it that gain back little (chance matches of unrelated bases,
/// [`CALL_CLIP_EDGE_GAIN`] and [`CALL_CLIP_REMNANT_GAIN`]), and at a sample end the few bases past
/// it, but not a stretch inside it that scores as related bases do ([`CALL_CLIP_KEEP_SCORE`]); and
/// what is left of the run on either side is looked at in the same way, for a second unrelated
/// stretch. Related bases score above zero over any 64 compared bases unless 40% or more
/// of them differ (a SNP every 3 bases still gains 1 every 3), so they are compared and called as
/// they lie; a stretch where one base in two differs scores below zero, as unrelated bases do, and
/// is clipped.
///
/// A deletion column belongs to a run where the sample bases on both sides of it do. A clipped
/// stretch takes in the insertion or deletion columns that touch it: an indel there has no anchor
/// on the clipped side, and was called beside the clip.
fn soft_clipped_columns(qa: &[u8], ra: &[u8], ystart: usize, chain: &[(u32, u32)], qn: usize) -> Vec<(usize, usize)> {
    // each query base's reference offset on the chain stretch that holds it
    let mut on_chain: Vec<Option<usize>> = vec![None; qn];
    for (x, y, len) in chain_stretches(chain).into_iter().filter(|r| r.2 >= 2 * CALL_SEAM_FLANK_BP) {
        for (i, cell) in on_chain[x..(x + len).min(qn)].iter_mut().enumerate() {
            *cell = Some(y + i);
        }
    }
    let n = qa.len().min(ra.len());
    let mut covered = vec![false; qn];
    let mut unsupported = vec![false; n];
    let (mut q, mut r) = (0usize, ystart);
    for c in 0..n {
        if qa[c] != b'-' {
            covered[q] = ra[c] != b'-' && on_chain[q] == Some(r);
            unsupported[c] = !covered[q];
            q += 1;
        }
        if ra[c] != b'-' {
            r += 1;
        }
    }
    let mut q = 0usize;
    for (c, cell) in unsupported.iter_mut().enumerate() {
        if qa[c] != b'-' {
            q += 1;
        } else {
            *cell = (q == 0 || !covered[q - 1]) && (q >= qn || !covered[q]);
        }
    }
    let (Some(first), Some(last)) = (qa[..n].iter().position(|&b| b != b'-'), qa[..n].iter().rposition(|&b| b != b'-')) else {
        return Vec::new();
    };
    // the running sums of the columns' scores as [`columns_score`] scores them, and of the known
    // bases compared: sum[c] and known[c] over columns 0..c
    let gap = |i: usize| qa[i] == b'-' || ra[i] == b'-';
    let (mut sum, mut known) = (vec![0i32; n + 1], vec![0usize; n + 1]);
    for c in 0..n {
        let score = if !gap(c) {
            call_score(qa[c], ra[c])
        } else if c > 0 && gap(c - 1) {
            -2
        } else {
            -(CALL_GAP_OPEN + 2)
        };
        sum[c + 1] = sum[c] + score;
        known[c + 1] = known[c] + usize::from(call_known(qa[c]) && call_known(ra[c]));
    }
    let mut clipped: Vec<(usize, usize)> = Vec::new();
    let mut c = 0usize;
    while c < n {
        if !unsupported[c] {
            c += 1;
            continue;
        }
        let start = c;
        while c < n && unsupported[c] {
            c += 1;
        }
        // the run's columns from the sample's first aligned base to its last, with the indel columns
        // that touch it: a gap the alignment opened beside the run, to put a chance match of the
        // run's first or last unrelated base in place, is scored with it
        let (mut from, mut to) = (start.max(first), c.min(last + 1));
        while from > first && gap(from - 1) {
            from -= 1;
        }
        while to <= last && gap(to) {
            to += 1;
        }
        // (lo, hi, whether lo is the sample's first aligned base, whether hi follows its last)
        let mut todo = vec![(from, to, start <= first, c > last)];
        while let Some((lo, hi, head, tail)) = todo.pop() {
            let Some((i, j)) = lowest_scoring_stretch(&sum, &known, lo, hi, head, tail) else {
                continue;
            };
            // the highest-scoring stretch inside it: related bases kept out of the clip, and what
            // lies on either side of them looked at again
            let (mut low, mut kept) = (i, (0i32, i, i));
            for q in i..=j {
                if sum[q] < sum[low] {
                    low = q;
                }
                if sum[q] - sum[low] > kept.0 {
                    kept = (sum[q] - sum[low], low, q);
                }
            }
            if kept.0 > CALL_CLIP_KEEP_SCORE {
                todo.push((lo, kept.1, head, false));
                todo.push((kept.2, hi, false, tail));
                continue;
            }
            let mut a = if i == from { start.min(from) } else { i };
            while a > 0 && gap(a - 1) {
                a -= 1;
            }
            let mut b = if j == to { c.max(to) } else { j };
            while b < n && gap(b) {
                b += 1;
            }
            clipped.push((a, b));
            if lo < i {
                todo.push((lo, i, head, false));
            }
            if j < hi {
                todo.push((j, hi, false, tail));
            }
        }
    }
    clipped.sort_unstable();
    let mut joined: Vec<(usize, usize)> = Vec::with_capacity(clipped.len());
    for (a, b) in clipped {
        match joined.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => joined.push((a, b)),
        }
    }
    joined
}

/// The lowest-scoring stretch `[i, j)` of alignment columns `lo..hi` that compares at least
/// [`CALL_SOFT_CLIP_BP`] known bases, if it scores below zero (`sum` and `known` are the running
/// sums [`soft_clipped_columns`] keeps). It is widened over the bases beside it that gain back no
/// more than [`CALL_CLIP_EDGE_GAIN`]: its start moved back to the first column from which the score
/// never climbs more than that before it, its end on to the last at which the score has climbed no
/// more than that since. The bases then left between it and `lo`, and between it and `hi`, are
/// taken in with it where they gain back no more than [`CALL_CLIP_REMNANT_GAIN`]; but where `lo` is
/// the sample's first aligned base (`head`), or `hi` follows its last (`tail`), those left at that
/// end are taken in unless they compare [`CALL_SOFT_CLIP_BP`] known bases: no anchored base lies
/// past them, and fewer are not enough to tell related bases from chance matches of unrelated ones.
fn lowest_scoring_stretch(sum: &[i32], known: &[usize], lo: usize, hi: usize, head: bool, tail: bool) -> Option<(usize, usize)> {
    // for each end j, the start at or before the last that leaves CALL_SOFT_CLIP_BP known bases with
    // the highest running sum: the stretch from it to j scores lowest
    let (mut next, mut top) = (lo, None::<usize>);
    let mut best: Option<(i32, usize, usize)> = None;
    for j in lo..=hi {
        while next <= j && known[j] - known[next] >= CALL_SOFT_CLIP_BP {
            if top.is_none_or(|t| sum[next] > sum[t]) {
                top = Some(next);
            }
            next += 1;
        }
        if let Some(t) = top {
            let score = sum[j] - sum[t];
            if best.is_none_or(|(s, _, _)| score < s) {
                best = Some((score, t, j));
            }
        }
    }
    let (score, i, j) = best?;
    if score >= 0 {
        return None;
    }
    let i = (lo..=i).find(|&k| sum[k] >= sum[i] - CALL_CLIP_EDGE_GAIN).unwrap_or(i);
    let j = (j..=hi).rev().find(|&k| sum[k] <= sum[j] + CALL_CLIP_EDGE_GAIN).unwrap_or(j);
    // what is left before lo or after hi: at a sample end, too few bases to judge; beside anchored
    // bases or another clip, a remnant that gains back too little
    let i = if if head { known[i] - known[lo] < CALL_SOFT_CLIP_BP } else { sum[i] - sum[lo] <= CALL_CLIP_REMNANT_GAIN } { lo } else { i };
    let j = if if tail { known[hi] - known[j] < CALL_SOFT_CLIP_BP } else { sum[hi] - sum[j] <= CALL_CLIP_REMNANT_GAIN } { hi } else { j };
    Some((i, j))
}

/// The most runs of unknown bases, and the most indels left out beside them, the caller's
/// `warnings` name one by one. The rest of each are counted in one sentence after them, so a sample
/// with an R every 20 bases does not give one sentence per base (BG-01M6TE8J).
const CALL_LISTED_WARNINGS: usize = 20;

/// One sentence for each run of one letter other than A, C, G or T in `bases` (`whose` they are,
/// numbered from 1) between positions `from` and `to`, in order, each given with `whose`: "The
/// reference holds 10 N at 4,990-4,999; no variant is called there." Nothing is called at a column
/// holding such a base.
fn unknown_base_runs(bases: &[u8], from: usize, to: usize, whose: &'static str) -> Vec<(&'static str, String)> {
    let mut sentences = Vec::new();
    let mut pos = from.max(1);
    while pos <= to.min(bases.len()) {
        let letter = bases[pos - 1];
        if call_known(letter) {
            pos += 1;
            continue;
        }
        let start = pos;
        while pos <= to.min(bases.len()) && bases[pos - 1] == letter {
            pos += 1;
        }
        let (n, end) = (pos - start, pos - 1);
        let at = if n == 1 {
            format_thousands(start)
        } else {
            format!("{}-{}", format_thousands(start), format_thousands(end))
        };
        sentences.push((
            whose,
            format!("The {whose} holds {} {} at {at}; no variant is called there.", format_thousands(n), letter as char),
        ));
    }
    sentences
}

/// The first [`CALL_LISTED_WARNINGS`] of `sentences`, each given with what it is about ("reference"
/// or "sample", "deletion" or "insertion"), then, if there are more, one sentence counting the
/// rest: `rest` writes it from how many of each are left, in the order they first appear.
fn listed_warnings(sentences: Vec<(&'static str, String)>, rest: impl Fn(&[(&'static str, usize)]) -> String) -> Vec<String> {
    let mut left: Vec<(&'static str, usize)> = Vec::new();
    for (about, _) in sentences.iter().skip(CALL_LISTED_WARNINGS) {
        match left.iter_mut().find(|(a, _)| a == about) {
            Some((_, n)) => *n += 1,
            None => left.push((about, 1)),
        }
    }
    let tail = (!left.is_empty()).then(|| rest(&left));
    sentences.into_iter().take(CALL_LISTED_WARNINGS).map(|(_, s)| s).chain(tail).collect()
}

/// `n` and the noun for one or for more: "1 run", "12 runs".
fn counted(n: usize, one: &str, more: &str) -> String {
    format!("{} {}", format_thousands(n), if n == 1 { one } else { more })
}

/// An indel the caller leaves out beside bases it does not know: whether it is a deletion, its
/// length, the 1-based reference bases it is named with (a deletion's first and last; for an
/// insertion, the two it lies between, the first 0 when it lies before reference base 1), whether it
/// may lie elsewhere among them, and the alignment column after its last.
///
/// Indels of one kind with nothing between them but columns holding a base either sequence does not
/// know, where one moves onto the other without pairing a known base with a different one
/// ([`fitting_reach`]), are one indel the alignment split, and are named as one, with their whole
/// length and every reference base the parts cover. A segment's band from the last chain 11-mer
/// before a run of N to the first after it is a straight line, so the alignment holds a run's
/// surplus as a staircase of insertions between pairings of N with reference bases: 12,000 N
/// standing for 2,000 bases were twelve, eleven of about 900 bases, and named as twelve
/// (BG-01M6VMNF). An indel apart from the run by a known base is not one of them, and neither are
/// two deletions of known bases on either side of a reference run: such a deletion moves across the
/// run only where each sample base opposite the run equals the deleted base it would then face, so
/// 5 bases deleted before 50 N and 10 after them are two deletions, which were named as one 15-bp
/// deletion (BG-01M6W0BZ).
struct LeftOutIndel {
    is_del: bool,
    len: usize,
    lo: usize,
    hi: usize,
    moved: bool,
    end_col: usize,
    /// the alignment column its last part reaches to the right without pairing a known base with
    /// a different one ([`fitting_reach`])
    reach_col: usize,
}

impl LeftOutIndel {
    /// What it is ("deletion" or "insertion"), and the sentence naming it: "A 10-bp deletion of
    /// reference bases 5,000-5,009 lies beside bases that are not known and is not called."
    fn sentence(&self) -> (&'static str, String) {
        let (len, lo, hi) = (self.len, self.lo, self.hi);
        if self.is_del {
            let bases = if lo == hi {
                format!("reference base {}", format_thousands(lo))
            } else {
                format!("reference bases {}-{}", format_thousands(lo), format_thousands(hi))
            };
            let sentence = if self.moved {
                format!("A {len}-bp deletion, somewhere in {bases}, lies beside bases that are not known and is not called.")
            } else {
                format!("A {len}-bp deletion of {bases} lies beside bases that are not known and is not called.")
            };
            return ("deletion", sentence);
        }
        let at = if lo == 0 && self.moved {
            // it may lie anywhere before its farthest base, not just before that one
            format!("somewhere before reference base {}", format_thousands(hi))
        } else if lo == 0 {
            format!("before reference base {}", format_thousands(hi))
        } else if self.moved {
            format!("somewhere between reference bases {} and {}", format_thousands(lo), format_thousands(hi))
        } else {
            format!("after reference base {}", format_thousands(lo))
        };
        let at = if self.moved { format!(", {at},") } else { format!(" {at}") };
        ("insertion", format!("A {len}-bp insertion{at} lies beside bases that are not known and is not called."))
    }
}

/// The most columns past an indel's own length [`indel_placements`] moves it each way.
const CALL_REACH_SCAN: usize = 64;

/// An alignment column's score counting only what is known: 2 for two equal bases, -3 for two
/// different ones, and 0 where either is not A, C, G or T, since such a base says nothing of the
/// base it faces.
fn known_score(a: u8, b: u8) -> i32 {
    if !call_known(a) || !call_known(b) {
        0
    } else if a == b {
        2
    } else {
        -3
    }
}

/// How far an indel at alignment columns `start..end` (a deletion when `is_del`) moves left and
/// right without pairing a known base with a different one: it moves one column at a time while
/// the base it moves past, in the row that holds its gap, fits the base of the indel it then faces,
/// the last (first) one. Two bases fit when they are the same base, or when either is a base the
/// caller does not know (which may be any base). Two unknown bases fit too: the alignment scores a
/// column holding one 1 whatever faces it ([`call_score`]), so an indel moved past N in both
/// sequences at the same columns scores as it did. Stopped beside such a column, as it once was, a
/// deletion the alignment put on the far side of N shared by both sequences was named over bases
/// that missed it (BG-01M6W02V).
///
/// An insertion never moves past a column of two known bases by putting an unknown base of it
/// opposite one of them: the sample holds and matches those bases where they are, and the move
/// would read a base the sample holds as inserted and pair the reference base with one the sample
/// does not know. Moved so, a sample run's surplus of N reached its own length into the known bases
/// on each side: 30,000 N standing for 20,000 bases after 40,000 were named as an insertion
/// somewhere between reference bases 30,000 and 70,001, where it lies between 40,000 and 60,001
/// (BG-01M6W0BZ). A deletion keeps that reach: the alignment deletes a reference run's N where the
/// sample lost the known bases beside the run, and its warning names those bases (BG-01M6W02V).
fn fitting_reach(qa: &[u8], ra: &[u8], start: usize, end: usize, is_del: bool) -> (usize, usize) {
    let n = qa.len().min(ra.len());
    let (gap_row, indel_row) = if is_del { (qa, ra) } else { (ra, qa) };
    let paired = |c: usize| qa[c] != b'-' && ra[c] != b'-';
    // the indel moved past column c, with base `moved` of it then facing the gap row's base there
    let fits = |c: usize, moved: u8| {
        let g = gap_row[c];
        let clamped = !is_del && call_known(g) && call_known(indel_row[c]) && !call_known(moved);
        paired(c) && !clamped && (g == moved || !call_known(g) || !call_known(moved))
    };
    let left = (1..=start).take_while(|&k| fits(start - k, indel_row[end - k])).count();
    let right = (1..=n - end).take_while(|&k| fits(end + k - 1, indel_row[start + k - 1])).count();
    (left, right)
}

/// One placement of an indel that [`indel_placements`] reaches: how many columns it moved (negative
/// to the left); what the move gains under the alignment's own score ([`call_score`]) and counting
/// the known bases only ([`known_score`]); and whether the indel's bases, its anchor or its next
/// column there hold a base either sequence does not know.
struct Placement {
    offset: isize,
    aligned: i32,
    known: i32,
    against_unknown: bool,
}

/// Every placement an indel at alignment columns `start..end` (a deletion when `is_del`) reaches
/// when the bases it moves past may then differ. It moves one column at a time while the column it
/// moves past holds a base in both rows, as far as [`CALL_REACH_SCAN`] columns past its length or
/// until its bases are all unknown. Moved past column c, the indel's last (first) base pairs with
/// the base of the gap's row at c, which is the only column whose score changes.
fn indel_placements(qa: &[u8], ra: &[u8], start: usize, end: usize, is_del: bool) -> Vec<Placement> {
    let n = qa.len().min(ra.len());
    let (gap_row, indel_row) = if is_del { (qa, ra) } else { (ra, qa) };
    let unknown = |b: u8| b != b'-' && !call_known(b);
    let unknown_col = |c: usize| c < n && (unknown(qa[c]) || unknown(ra[c]));
    let paired = |c: usize| qa[c] != b'-' && ra[c] != b'-';
    let scan = end - start + CALL_REACH_SCAN;
    let mut placements = Vec::new();
    // left: at offset j the indel's bases are indel_row[c..end - j] and column c - 1 is its anchor;
    // the base of the gap's row at c faces indel_row[end - j] in its next column
    let (mut aligned, mut known) = (0i32, 0i32);
    for j in 1..=scan.min(start) {
        let c = start - j;
        if !paired(c) {
            break;
        }
        let (g, moved, was) = (gap_row[c], indel_row[end - j], indel_row[c]);
        aligned += call_score(g, moved) - call_score(g, was);
        known += known_score(g, moved) - known_score(g, was);
        let bases = &indel_row[c..end - j];
        let against_unknown = bases.iter().any(|&b| unknown(b)) || (c > 0 && unknown_col(c - 1)) || unknown(g) || unknown(moved);
        placements.push(Placement { offset: -(j as isize), aligned, known, against_unknown });
        if bases.iter().all(|&b| unknown(b)) {
            break;
        }
    }
    // right: at offset j the indel's bases are indel_row[start + j..=c] and column c + 1 is its
    // next; the base of the gap's row at c faces indel_row[start + j - 1] in its anchor
    let (mut aligned, mut known) = (0i32, 0i32);
    for j in 1..=scan {
        let c = end + j - 1;
        if c >= n || !paired(c) {
            break;
        }
        let (g, moved, was) = (gap_row[c], indel_row[start + j - 1], indel_row[c]);
        aligned += call_score(g, moved) - call_score(g, was);
        known += known_score(g, moved) - known_score(g, was);
        let bases = &indel_row[start + j..=c];
        let against_unknown = bases.iter().any(|&b| unknown(b)) || unknown_col(c + 1) || unknown(g) || unknown(moved);
        placements.push(Placement { offset: j as isize, aligned, known, against_unknown });
        if bases.iter().all(|&b| unknown(b)) {
            break;
        }
    }
    placements
}

/// The indels inside the alignment columns, as (start, end, is_del): every run of gaps in one row
/// between the sample's first and last aligned base.
fn interior_indels(qa: &[u8], ra: &[u8]) -> Vec<(usize, usize, bool)> {
    let n = qa.len().min(ra.len());
    let (Some(first), Some(last)) = (qa[..n].iter().position(|&b| b != b'-'), qa[..n].iter().rposition(|&b| b != b'-')) else {
        return Vec::new();
    };
    let mut indels = Vec::new();
    let mut col = first;
    while col < last {
        let is_del = qa[col] == b'-' && ra[col] != b'-';
        if !is_del && !(ra[col] == b'-' && qa[col] != b'-') {
            col += 1;
            continue;
        }
        let start = col;
        while col < last && ((is_del && qa[col] == b'-' && ra[col] != b'-') || (!is_del && ra[col] == b'-' && qa[col] != b'-')) {
            col += 1;
        }
        indels.push((start, col, is_del));
    }
    indels
}

/// Moves each indel the alignment places among known bases to a placement against unknown bases
/// that the alignment scores no lower and the known bases score higher: the one the known bases
/// score highest, the nearest of those. The alignment scores an unknown base 1 ([`call_score`]), so
/// moving 5 known bases off their matches onto N (each losing 1) ties with turning a mismatch into
/// a chance match (gaining 5). Beside a run of 15 N standing for 10 bases, a SNP 5 bases before the
/// run, whose base happens to equal the reference base 5 bases on, then ties with a deletion of the
/// SNP's reference base and the 4 after it, the sample's 5 bases between the SNP and the run moved
/// into the run's spare N. The known bases decide: the deletion goes back into the run, where it is
/// left out, and the SNP is called (BG-01M6TE8J).
fn place_indels_on_known_bases(qa: &mut [u8], ra: &mut [u8]) {
    let n = qa.len().min(ra.len());
    for (start, end, is_del) in interior_indels(qa, ra) {
        let (left, right) = fitting_reach(qa, ra, start, end, is_del);
        let unknown_at = |c: usize| c < n && [qa[c], ra[c]].iter().any(|&b| b != b'-' && !call_known(b));
        if (start.saturating_sub(left + 1)..=end + right).any(unknown_at) {
            // already beside unknown bases, where it is left out as it lies
            continue;
        }
        let best = indel_placements(qa, ra, start, end, is_del)
            .into_iter()
            .filter(|p| p.against_unknown && p.aligned >= 0 && p.known > 0)
            .max_by_key(|p| (p.known, -(p.offset.abs())));
        let Some(best) = best else { continue };
        let gap_row = if is_del { &mut *qa } else { &mut *ra };
        let (len, j) = (end - start, best.offset.unsigned_abs());
        if best.offset > 0 {
            gap_row[start..end + j].rotate_left(len);
        } else {
            gap_row[start - j..end].rotate_right(len);
        }
    }
}

/// What the caller's alignment charges to open a gap, on top of 2 a base of its length
/// ([`align_sample_in_one_piece`]'s scoring, -5 - 2n for a gap of n bases).
const CALL_GAP_OPEN: i32 = 5;

/// The score of alignment columns `qa` and `ra` under [`call_score`] (each gap -5 - 2 a base), and
/// counting the known bases only ([`known_score`]).
fn columns_score(qa: &[u8], ra: &[u8]) -> (i32, i32) {
    let (mut aligned, mut known, mut in_gap) = (0i32, 0i32, false);
    for (&q, &r) in qa.iter().zip(ra) {
        if q == b'-' || r == b'-' {
            aligned -= if in_gap { 2 } else { CALL_GAP_OPEN + 2 };
            in_gap = true;
        } else {
            (aligned, known, in_gap) = (aligned + call_score(q, r), known + known_score(q, r), false);
        }
    }
    (aligned, known)
}

/// Parts a deletion the alignment merged with the spare N of a reference run beside it. Beside a
/// run of more N than the bases it stands for, a deletion a few bases from the run can be joined
/// to the run's surplus: the sample bases between them are paired with spare N instead of their own
/// reference bases, and the two gaps become one. Each base so moved loses 1 and the gap opened once
/// less gains 5, so a deletion 5 bases from such a run ties with its merged reading, and one of 4
/// or fewer loses to it; the merged gap was named, or called, as one deletion of both lengths (a
/// 9-bp deletion 6 bases before 15 N standing for 10 was called as a 14-bp deletion, its repeat
/// letting it lie a base nearer the run). Where the sample bases paired with
/// the run next to such a gap, with any matched between, can be paired equal with the gap's known
/// bases and those after it, the gap shortened by as many and as many more of the run's N deleted,
/// and the alignment scores that reading no lower, the most of them that can are paired so, the
/// shortened gap wherever the bases around it are equal (a repeat lets it lie a base along)
/// (BG-01M6W02V). Only a deletion of known bases beside a reference run is parted, and one the
/// alignment scores higher merged (4 bases or fewer from the run, or nearer through a repeat) stays
/// merged.
fn part_deletions_from_unknown_runs(qa: &mut [u8], ra: &mut [u8]) {
    part_deletions_before_unknown_runs(qa, ra);
    qa.reverse();
    ra.reverse();
    part_deletions_before_unknown_runs(qa, ra);
    qa.reverse();
    ra.reverse();
}

/// [`part_deletions_from_unknown_runs`] for each deletion before a reference run (a gap of known
/// reference bases, perhaps ending in unknown ones, then any matched known bases, then sample bases
/// paired with unknown reference bases).
fn part_deletions_before_unknown_runs(qa: &mut [u8], ra: &mut [u8]) {
    let n = qa.len().min(ra.len());
    let known_pair = |q: u8, r: u8| q != b'-' && r != b'-';
    for (start, end, is_del) in interior_indels(qa, ra) {
        if !is_del {
            continue;
        }
        // the gap's unknown reference bases at its end (j), its known ones before them (m)
        let j = ra[start..end].iter().rev().take_while(|&&b| !call_known(b)).count();
        let m = end - start - j;
        if m < 2 || ra[start..start + m].iter().any(|&b| !call_known(b)) {
            continue;
        }
        // matched known columns after the gap (t), then sample bases paired with unknown reference bases (p)
        let t = if j > 0 { 0 } else { (end..n).take_while(|&c| known_pair(qa[c], ra[c]) && call_known(qa[c]) && qa[c] == ra[c]).count() };
        let p = (end + t..n).take_while(|&c| known_pair(qa[c], ra[c]) && call_known(qa[c]) && !call_known(ra[c])).count();
        let region = start..end + t + p;
        let (old_aligned, old_known) = columns_score(&qa[region.clone()], &ra[region.clone()]);
        // k more N deleted, and the shortened gap after the first o of the sample bases moved
        let parted = |k: usize, o: usize| -> Vec<u8> {
            let mut q = qa[end..end + o].to_vec();
            q.extend(std::iter::repeat_n(b'-', m - k));
            q.extend_from_slice(&qa[end + o..end + t + k]);
            q.extend(std::iter::repeat_n(b'-', j + k));
            q.extend_from_slice(&qa[end + t + k..end + t + p]);
            q
        };
        let fits = |k: usize, o: usize| {
            let q = parted(k, o);
            let equal = (start..start + m + t).all(|c| q[c - start] == b'-' || (call_known(ra[c]) && q[c - start] == ra[c]));
            let (aligned, known) = columns_score(&q, &ra[region.clone()]);
            (equal && aligned >= old_aligned && known > old_known).then_some(q)
        };
        if let Some(q) = (1..m.min(p)).rev().find_map(|k| (0..=t + k).find_map(|o| fits(k, o))) {
            qa[region].copy_from_slice(&q);
        }
    }
}

/// The deletions the caller leaves out because a deletion it leaves out beside bases it does not
/// know may be the same deletion (BG-01M6W02V), by first column, with how many more columns each
/// one's warning names to the left and right. A deletion beside unknown bases, moved past the
/// bases between it and another deletion, joins it, and one gap is opened less: where the alignment
/// scores that no lower, the sample does not say which reading holds, and the other deletion is left
/// out too, with its own length, each warning naming the bases of both. Beside a run of 10 N
/// standing for 10 bases, a 7-bp deletion just after the run was aligned as 5 of the run's N
/// deleted, 5 sample bases matched by chance to the 5 reference bases after the run, and a 2-bp
/// deletion after them, which was called though the sample does not hold it.
///
/// The deletion is moved one column at a time while the column it moves past holds a base in both
/// rows, as [`indel_placements`] moves it, but on past a run of unknown bases: N deleted from a run
/// lie anywhere in it.
fn deletions_left_out_together(qa: &[u8], ra: &[u8]) -> std::collections::HashMap<usize, (usize, usize)> {
    let n = qa.len().min(ra.len());
    let unknown_at = |c: usize| c < n && [qa[c], ra[c]].iter().any(|&b| b != b'-' && !call_known(b));
    let paired = |c: usize| qa[c] != b'-' && ra[c] != b'-';
    let deletions: Vec<(usize, usize)> = interior_indels(qa, ra).into_iter().filter(|d| d.2).map(|(s, e, _)| (s, e)).collect();
    let mut out: std::collections::HashMap<usize, (usize, usize)> = std::collections::HashMap::new();
    for &(start, end) in &deletions {
        let (left, right) = fitting_reach(qa, ra, start, end, true);
        if !(start.saturating_sub(left + 1)..=end + right).any(unknown_at) {
            continue;
        }
        let scan = end - start + CALL_REACH_SCAN;
        // right: moved j columns, its first base faces the sample base of column end + j - 1
        let (mut j, mut aligned) = (0usize, 0i32);
        while j < scan && end + j < n && paired(end + j) {
            let c = end + j;
            aligned += call_score(qa[c], ra[start + j]) - call_score(qa[c], ra[c]);
            j += 1;
        }
        let met_right = (j > 0 && end + j < n && qa[end + j] == b'-' && ra[end + j] != b'-' && aligned + CALL_GAP_OPEN >= 0).then_some(j);
        // left: moved j columns, its last base faces the sample base of column start - j
        let (mut j, mut aligned) = (0usize, 0i32);
        while j < scan && j < start && paired(start - j - 1) {
            let c = start - j - 1;
            aligned += call_score(qa[c], ra[end - j - 1]) - call_score(qa[c], ra[c]);
            j += 1;
        }
        let met_left = (j > 0 && j < start && qa[start - j - 1] == b'-' && ra[start - j - 1] != b'-' && aligned + CALL_GAP_OPEN >= 0).then_some(j);
        for (met, to_right) in [(met_right, true), (met_left, false)] {
            let Some(j) = met else { continue };
            let next = if to_right { end + j } else { start - j - 1 };
            let Some(&(os, oe)) = deletions.iter().find(|&&(s, e)| (s..e).contains(&next)) else { continue };
            let mine = out.entry(start).or_insert((0, 0));
            if to_right {
                mine.1 = mine.1.max(j + oe - os);
            } else {
                mine.0 = mine.0.max(j + oe - os);
            }
            let theirs = out.entry(os).or_insert((0, 0));
            if to_right {
                theirs.0 = theirs.0.max(j + end - start);
            } else {
                theirs.1 = theirs.1.max(j + end - start);
            }
        }
    }
    out
}

/// Moves every insertion and deletion in the alignment columns as far left as it goes without
/// changing a base: while the column before a run of gaps matches and its base equals the last base
/// of the run, the run moves one column left, to VCF's left-normalised placement. A deletion that
/// runs to the last column is the end of the sample, which the caller does not call, and stays. A
/// column holding a base other than A, C, G or T never matches (the caller aligns the sample's in
/// lower case, the reference's in upper), so no gap moves past one.
fn left_align_gaps(qa: &mut [u8], ra: &mut [u8]) {
    let n = qa.len().min(ra.len());
    let mut col = 0usize;
    while col < n {
        let del = qa[col] == b'-' && ra[col] != b'-';
        let ins = ra[col] == b'-' && qa[col] != b'-';
        if !del && !ins {
            col += 1;
            continue;
        }
        let mut end = col;
        while end < n && ((del && qa[end] == b'-' && ra[end] != b'-') || (ins && ra[end] == b'-' && qa[end] != b'-')) {
            end += 1;
        }
        let (mut s, mut e) = (col, end);
        while !(del && end == n) && s > 0 && qa[s - 1] != b'-' && qa[s - 1] == ra[s - 1] {
            let b = qa[s - 1];
            let (gap, bases) = if del { (&mut *qa, &*ra) } else { (&mut *ra, &*qa) };
            if bases[e - 1] != b {
                break;
            }
            gap[e - 1] = b;
            gap[s - 1] = b'-';
            s -= 1;
            e -= 1;
        }
        col = end;
    }
}

/// The reference window, as `[start, end)` offsets in `reference`, the caller aligns `query` in:
/// [`CALL_FLANK_BP`] bases past each end of where the mapper places it (`mapped0`, the reference
/// offset of its first base on the diagonal most of its seeds vote for), widened where the sample
/// runs on past that.
///
/// The mapper places the whole sample on one diagonal, so a sample with a net deletion spans the
/// deletion's length more reference than that: past its mapped end when its longer part lies before
/// the deletion, before its mapped start when that part lies after it. Over the flank, the window
/// cut that reference off, and the sample's end there was aligned as an insertion. The 11-mer chain
/// of `query` against the reference ([`call_chain`]), searched a sample's length past each end of
/// the mapper's window (an alignment bridges a deletion of n bases only with more than about n
/// matched bases, so never one longer than the sample), gives where the sample's first and last
/// anchored bases lie. The window is widened to [`CALL_FLANK_BP`] past those only where they lie
/// outside it, so a sample whose chain runs inside the mapper's window keeps that window, the one
/// the caller always gave it (which, before BG-01M6S1ED, it also cut to its first 100,000 bases).
fn call_window(reference: &[u8], query: &[u8], mapped0: usize) -> (usize, usize) {
    let n = reference.len();
    let start = mapped0.saturating_sub(CALL_FLANK_BP).min(n);
    let end = (mapped0 + query.len() + CALL_FLANK_BP).min(n);
    let (lo, hi) = (start.saturating_sub(query.len()), end.saturating_add(query.len()).min(n));
    let chain = call_chain(query, &reference[lo..hi]);
    let (Some(&(fx, fy)), Some(&(lx, ly))) = (chain.first(), chain.last()) else {
        return (start, end);
    };
    // the reference offsets of the sample's first base, and of the base after its last, on the
    // diagonals of its first and last chain 11-mers
    let head = (lo + fy as usize).saturating_sub(fx as usize);
    let tail = lo + ly as usize + (query.len() - lx as usize);
    let start = if head < start { head.saturating_sub(CALL_FLANK_BP) } else { start };
    let end = if tail > end { (tail + CALL_FLANK_BP).min(n) } else { end };
    (start, end)
}

/// The caller's VCF: its header, with the reference as the one contig (`contig_len` bases), and one
/// row per variant.
fn variant_vcf(ref_name: &str, contig_len: usize, variants: &[FreeBayesVariantRecord]) -> String {
    let safe_chr = if ref_name.is_empty() {
        "REF_CONTIG"
    } else {
        ref_name
    };
    let mut vcf_lines = vec![
        "##fileformat=VCFv4.2".to_string(),
        "##source=MolBioCraft sequence-vs-reference difference caller (single consensus sequence; no read depth, so QUAL is not estimated)".to_string(),
        format!("##contig=<ID={},length={}>", safe_chr, contig_len),
        "##INFO=<ID=TYPE,Number=1,Type=String,Description=\"SNP, MNP, INS or DEL\">".to_string(),
        "##FORMAT=<ID=GT,Number=1,Type=String,Description=\"Haploid genotype of the compared sequence\">".to_string(),
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE".to_string(),
    ];
    for v in variants {
        vcf_lines.push(format!(
            "{}\t{}\t.\t{}\t{}\t.\t.\tTYPE={}\tGT\t{}",
            safe_chr, v.position_bp, v.ref_allele, v.alt_allele, v.variant_type, v.genotype
        ));
    }
    vcf_lines.join("\n")
}

/// Calls the differences between a sample sequence and its reference (SNPs, MNPs, insertions and
/// deletions, as VCF records) off one alignment of the whole sample, up to its first
/// [`CALL_ALIGNED_CAP_BP`] bases, to the reference window it maps to ([`call_window`]). Every
/// difference in the aligned part is reported, in the VCF, the counts, Ti/Tv and the annotations;
/// a longer sample's report says in its `warnings` where calling stopped (BG-01M6S1ED). A sample
/// whose one-shot alignment keeps at most [`CALL_ONE_SHOT_MAX_BYTES`] of traceback (up to about
/// 11.4 kb) is aligned in one rust-bio banded alignment, as every sample was before BG-01M6S1QP; a
/// longer one is aligned in segments that each keep at most [`CALL_SEGMENT_MAX_BYTES`] of
/// traceback ([`align_sample_in_segments`]).
///
/// Every base of both sequences is kept in its place ([`call_bases`]), so positions are the
/// reference's own and lengths count every base (BG-01M6T6GK). A base other than A, C, G or T (N
/// or another ambiguity code) is aligned as unknown ([`call_score`]), and nothing is called where
/// either sequence holds one: no SNP or MNP base, and no insertion or deletion whose bases, anchor
/// or next column hold one, or would in a placement it moves to with the known bases still
/// fitting, since where an indel lies against bases that are not known is not known. Nor is an
/// indel called that, moved past bases that then differ, lies against such bases in a placement
/// the known bases score no lower; and an indel the alignment scores no lower there, where the
/// known bases score it higher, is moved there first ([`place_indels_on_known_bases`],
/// [`indel_placements`]; BG-01M6TE8J). The
/// `warnings` name each run of such bases the call passed over, in the reference's numbering and
/// in the sample's own, as the sample was given, and then each indel left out beside them, with
/// the reference bases its placements cover (the parts of one indel the alignment split among
/// unknown bases named as one, [`LeftOutIndel`]); the first [`CALL_LISTED_WARNINGS`] runs and the first
/// as many indels, each followed by one sentence counting the rest (BG-01M6TE8J). An empty
/// reference or sample is compared with nothing: no variant is called, and the warnings say which
/// input is empty.
pub fn call_freebayes_variants(
    ref_name: &str,
    ref_seq: &str,
    sample_seq: &str,
) -> FreeBayesVariantReport {
    call_freebayes_variants_with_one_shot_limit(ref_name, ref_seq, sample_seq, CALL_ONE_SHOT_MAX_BYTES)
}

/// [`call_freebayes_variants`] with the one-shot limit chosen: a sample whose one-shot alignment
/// would keep more than `one_shot_max_traceback_bytes` of traceback is aligned in segments, as is
/// one where a run of unknown bases outlasts its flanks ([`an_unknown_run_outlasts_its_flanks`]). The
/// variant caller's tests pass 0 to align a short sample in segments, so they can check the segment
/// path against an exact alignment of a pair small enough to align exactly.
#[doc(hidden)]
pub fn call_freebayes_variants_with_one_shot_limit(
    ref_name: &str,
    ref_seq: &str,
    sample_seq: &str,
    one_shot_max_traceback_bytes: usize,
) -> FreeBayesVariantReport {
    let ref_clean = call_bases(ref_seq);
    let samp_clean = call_bases(sample_seq);

    // An empty reference or sample leaves nothing to compare. Before BG-01M6TE8J the call went on,
    // read no difference, and its report of no variants read as a perfect match; it now says which
    // input is empty, and calls nothing.
    let empty: Vec<String> = [("reference", &ref_clean), ("sample", &samp_clean)]
        .iter()
        .filter(|(_, bases)| bases.is_empty())
        .map(|(whose, _)| format!("The {whose} is empty, so there is nothing to compare and no variant is called."))
        .collect();
    if !empty.is_empty() {
        return FreeBayesVariantReport {
            total_variants: 0,
            snp_count: 0,
            mnp_or_indel_count: 0,
            ti_tv_ratio: 0.0,
            variants: Vec::new(),
            vcf_text: variant_vcf(ref_name, ref_clean.len(), &[]),
            annotations: Vec::new(),
            warnings: empty,
        };
    }

    // The mapper reads A, C, G, T and N and leaves any other letter out, which would move it off
    // the reference's numbering, so it is handed every unknown base as N.
    let as_n = |s: &str| -> String { s.bytes().map(|b| if call_known(b) { b as char } else { 'N' }).collect() };
    let mapping = run_ngs_reference_mapping(&as_n(&ref_clean), &as_n(&samp_clean), NGS_MAPPER_DEFAULT);
    let reverse = mapping.strand == "-";
    let aligned_query = if reverse {
        reverse_complement_iupac(&samp_clean, false)
    } else {
        samp_clean.clone()
    };

    let rb = ref_clean.as_bytes();
    // Align the sample, up to the aligned cap, to the reference window it maps to (semi-global: the
    // whole of it is aligned, reference flanks are free) and read every difference off the
    // alignment columns. The window is the aligned part's, flanks and all, and is not cut short
    // (before BG-01M6S1ED it was cut to its first 100,000 bases, which left the last bases of a
    // sample of more than about 99,800 with no reference, so they were called as an insertion).
    // The sample's unknown bases are aligned in lower case and the reference's in upper, so no
    // k-mer holding one is ever the same in both and no column of two of them is ever a match.
    let query: Vec<u8> = aligned_query.as_bytes()[..aligned_query.len().min(CALL_ALIGNED_CAP_BP)]
        .iter()
        .map(|&b| if call_known(b) { b } else { b.to_ascii_lowercase() })
        .collect();
    let (win_start, win_end) = call_window(rb, &query, mapping.ref_start_bp.saturating_sub(1));
    let reference = &rb[win_start..win_end];
    let chain = call_chain(&query, reference);
    let one_piece = traceback_bytes(query.len(), reference.len()) <= one_shot_max_traceback_bytes
        && !an_unknown_run_outlasts_its_flanks(&query)
        && !an_unknown_run_outlasts_its_flanks(reference);
    let (mut qa, mut ra, ystart) = if one_piece {
        // one alignment of the whole sample, as the caller aligned every sample before BG-01M6S1QP,
        // unless a run of N outlasts the bases beside it (BG-01M6W0BZ)
        align_sample_in_one_piece(&query, reference)
    } else {
        align_sample_in_segments(&query, reference, &chain)
    };
    part_deletions_from_unknown_runs(&mut qa, &mut ra);
    place_indels_on_known_bases(&mut qa, &mut ra);
    let together = deletions_left_out_together(&qa, &ra);
    // the stretches of the sample soft-clipped as unrelated to the reference ([`soft_clipped_columns`])
    let clips = soft_clipped_columns(&qa, &ra, ystart, &chain, query.len());
    let mut clip_at = vec![false; qa.len().min(ra.len())];
    for &(a, b) in &clips {
        clip_at[a..b].fill(true);
    }
    // a clip that holds the sample's last aligned base: calling stops where it starts
    let last_q_col = qa.iter().rposition(|&b| b != b'-');
    let tail_clip = clips.iter().find(|&&(a, b)| last_q_col.is_some_and(|l| (a..b).contains(&l))).map(|&(a, _)| a);

    let mut variants = Vec::new();
    let mut transitions = 0usize;
    let mut transversions = 0usize;
    let is_transition = |r: u8, q: u8| -> bool {
        matches!((r, q), (b'A', b'G') | (b'G', b'A') | (b'C', b'T') | (b'T', b'C'))
    };
    let n = qa.len().min(ra.len());
    // whether column c holds a base other than A, C, G or T in either row (a gap holds none)
    let unknown_at = |c: usize| c < n && [qa[c], ra[c]].iter().any(|&b| b != b'-' && !call_known(b));
    // ref_pos = 1-based reference coordinate of the last reference base consumed.
    let mut ref_pos = win_start + ystart;
    let mut started = false;
    // each indel not called because it lies beside unknown bases
    let mut left_out: Vec<LeftOutIndel> = Vec::new();
    // the first reference base the call passed over, opposite the sample or deleted from it
    let mut span_from = 0usize;
    let mut col = 0usize;
    while col < n {
        let (q, r) = (qa[col], ra[col]);
        // A soft-clipped stretch: its reference bases are passed over and nothing is called there; one
        // at the sample's end ends the call, and one at its start is passed over as the flank is.
        if tail_clip == Some(col) {
            break;
        }
        if clip_at[col] {
            if r != b'-' {
                ref_pos += 1;
            }
            col += 1;
            continue;
        }
        // Ignore the unaligned reference flanks before/after the sample.
        if q == b'-' && !started {
            if r != b'-' {
                ref_pos += 1;
            }
            col += 1;
            continue;
        }
        if !started {
            started = true;
            span_from = ref_pos + 1;
        }
        if q != b'-' && r != b'-' {
            // a match, or a base either sequence does not know, where nothing is called
            if q == r || unknown_at(col) {
                ref_pos += 1;
                col += 1;
                continue;
            }
            // SNP / MNP: a run of adjacent mismatches of known bases.
            let start_col = col;
            while col < n && qa[col] != b'-' && ra[col] != b'-' && qa[col] != ra[col] && !unknown_at(col) {
                col += 1;
            }
            let ref_allele: String = ra[start_col..col].iter().map(|&b| b as char).collect();
            let alt_allele: String = qa[start_col..col].iter().map(|&b| b as char).collect();
            let span = col - start_col;
            let class = if span == 1 {
                if is_transition(ra[start_col], qa[start_col]) {
                    transitions += 1;
                    "Transition"
                } else {
                    transversions += 1;
                    "Transversion"
                }
            } else {
                "Multi-Nucleotide"
            };
            variants.push(FreeBayesVariantRecord {
                id: format!("var-{}", ref_pos + 1),
                position_bp: ref_pos + 1,
                ref_allele,
                alt_allele,
                variant_type: if span == 1 { "SNP" } else { "MNP" }.to_string(),
                mutation_class: class.to_string(),
                phred_qual: 0.0,
                genotype: "1".to_string(),
                allele_observation_balance: 1.0,
            });
            ref_pos += span;
            continue;
        }
        // Indel: VCF anchors it on the preceding reference base.
        let start_col = col;
        let is_del = q == b'-';
        while col < n
            && ((is_del && qa[col] == b'-' && ra[col] != b'-') || (!is_del && ra[col] == b'-' && qa[col] != b'-'))
        {
            col += 1;
        }
        // A trailing deletion is just the end of the sample, not a variant.
        if is_del && qa[col..n].iter().all(|&b| b == b'-') {
            break;
        }
        let anchor_idx = ref_pos.saturating_sub(1).min(rb.len().saturating_sub(1));
        let anchor = rb.get(anchor_idx).copied().unwrap_or(b'N');
        // Where else the indel may lie without pairing a known base with a different one
        // ([`fitting_reach`]). No placement it reaches pairs a known base with a different one that
        // this placement does not.
        let (left, right) = fitting_reach(&qa, &ra, start_col, col, is_del);
        let fitting = (left, right);
        // An indel is not called where any placement it reaches has a base either sequence does not
        // know in its bases, its anchor or its next column: where it lies against bases that are
        // not known is not known. It is named, with every reference base those placements cover.
        let beside_unknown = !call_known(anchor) || (start_col.saturating_sub(left + 1)..=col + right).any(unknown_at);
        // a deletion that may be one with another left out beside unknown bases ([`deletions_left_out_together`])
        let together_with = if is_del { together.get(&start_col).copied() } else { None };
        let beside_unknown = beside_unknown || together_with.is_some();
        let (left, right) = together_with.map_or((left, right), |(l, r)| (left.max(l), right.max(r)));
        // Nor is it called where, moved past bases that then differ, it lies against such bases in
        // a placement the known bases score no lower ([`indel_placements`]): the known bases do not
        // say where it lies (BG-01M6TE8J). It is named with every reference base it moves past to
        // the farthest placements the known bases score no lower.
        let (mut joint_left, mut joint_right, mut joint) = (0usize, 0usize, false);
        if !beside_unknown {
            for p in indel_placements(&qa, &ra, start_col, col, is_del).iter().filter(|p| p.known >= 0) {
                joint |= p.against_unknown;
                if p.offset < 0 {
                    joint_left = joint_left.max(p.offset.unsigned_abs());
                } else {
                    joint_right = joint_right.max(p.offset.unsigned_abs());
                }
            }
        }
        if beside_unknown || joint {
            let (left, right) = if joint { (left.max(joint_left), right.max(joint_right)) } else { (left, right) };
            let len = col - start_col;
            let (lo, hi) = if is_del { (ref_pos + 1 - left, ref_pos + len + right) } else { (ref_pos - left, ref_pos + right + 1) };
            // whether one of them moves onto the other without pairing a known base with a different one
            let meets = |prev: &LeftOutIndel| prev.reach_col >= start_col || start_col - fitting.0 <= prev.end_col;
            match left_out.last_mut() {
                // the next step of a staircase the alignment split one indel into (LeftOutIndel)
                Some(prev) if prev.is_del == is_del && (prev.end_col..start_col).all(unknown_at) && meets(prev) => {
                    prev.len += len;
                    prev.lo = prev.lo.min(lo);
                    prev.hi = prev.hi.max(hi);
                    prev.moved = true;
                    prev.end_col = col;
                    prev.reach_col = col + fitting.1;
                }
                _ => left_out.push(LeftOutIndel { is_del, len, lo, hi, moved: left + right > 0, end_col: col, reach_col: col + fitting.1 }),
            }
        } else {
            let anchor = anchor as char;
            let run: String = if is_del { &ra[start_col..col] } else { &qa[start_col..col] }
                .iter()
                .map(|&b| b as char)
                .collect();
            let (ref_allele, alt_allele) = if is_del {
                (format!("{anchor}{run}"), anchor.to_string())
            } else {
                (anchor.to_string(), format!("{anchor}{run}"))
            };
            variants.push(FreeBayesVariantRecord {
                id: format!("{}-{}", if is_del { "del" } else { "ins" }, ref_pos.max(1)),
                position_bp: ref_pos.max(1),
                ref_allele,
                alt_allele,
                variant_type: if is_del { "DEL" } else { "INS" }.to_string(),
                mutation_class: "Indel".to_string(),
                phred_qual: 0.0,
                genotype: "1".to_string(),
                allele_observation_balance: 1.0,
            });
        }
        if is_del {
            ref_pos += col - start_col;
        }
    }

    let annotations: Vec<SequenceFeature> = variants
        .iter()
        .map(|v| SequenceFeature {
            id: v.id.clone(),
            name: format!("{} {}>{}", v.variant_type, v.ref_allele, v.alt_allele),
            feature_type: "misc_feature".to_string(),
            start: v.position_bp,
            end: (v.position_bp + v.ref_allele.len().saturating_sub(1)).min(rb.len().max(1)),
            strand: 1,
            color: if v.variant_type == "SNP" {
                "#e11d48".to_string()
            } else {
                "#9333ea".to_string()
            },
            notes: Some(format!("{} ({}) relative to the reference", v.variant_type, v.mutation_class)),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        })
        .collect();

    let vcf_text = variant_vcf(ref_name, rb.len(), &variants);
    let snp_count = variants.iter().filter(|v| v.variant_type == "SNP").count();
    let total = variants.len();
    let mut warnings = Vec::new();
    if query.len() < aligned_query.len() {
        // how much was aligned and of how much, where the variant loop stopped (`ref_pos`, the last
        // reference base the sample's aligned part reached) and how much of the sample was left
        let (done, whole, cap) =
            (format_thousands(query.len()), format_thousands(aligned_query.len()), format_thousands(CALL_ALIGNED_CAP_BP));
        let (stop, left) = (format_thousands(ref_pos), format_thousands(aligned_query.len() - query.len()));
        // the sample read as its reverse complement is aligned from its last base back
        warnings.push(if mapping.strand == "-" {
            format!(
                "Variants were called over the last {done} bp of the {whole}-bp sample only, read as its reverse complement \
                 (the caller aligns at most {cap} bp): calling stopped at reference base {stop}, and the first {left} bp of \
                 the sample were not compared."
            )
        } else {
            format!(
                "Variants were called over the first {done} bp of the {whole}-bp sample only (the caller aligns at most \
                 {cap} bp): calling stopped at reference base {stop}, and the last {left} bp of the sample were not compared."
            )
        });
    }
    // Each run of bases one sequence does not know, where the call passed over it: in the reference,
    // from the first reference base it reached to the last (`ref_pos`); in the sample, its aligned
    // part, numbered as the sample was given (its last bases, read as its reverse complement). The
    // first CALL_LISTED_WARNINGS runs of both are named, the rest counted; then the indels left
    // out beside them, the same way.
    let mut runs = Vec::new();
    if started {
        runs.extend(unknown_base_runs(rb, span_from, ref_pos, "reference"));
    }
    let (sample_from, sample_to) = if reverse {
        (samp_clean.len() - query.len() + 1, samp_clean.len())
    } else {
        (1, query.len())
    };
    runs.extend(unknown_base_runs(samp_clean.as_bytes(), sample_from, sample_to, "sample"));
    warnings.extend(listed_warnings(runs, |rest| {
        let total = rest.iter().map(|&(_, n)| n).sum::<usize>();
        let by = rest.iter().map(|&(whose, n)| format!("{} in the {whose}", format_thousands(n))).collect::<Vec<_>>();
        let (noun, verb) = if total == 1 { ("run", "is") } else { ("runs", "are") };
        format!(
            "{} more {noun} of bases other than A, C, G or T ({}) {verb} not listed; no variant is called there.",
            format_thousands(total),
            by.join(", ")
        )
    }));
    warnings.extend(listed_warnings(left_out.iter().map(LeftOutIndel::sentence).collect(), |rest| {
        let total = rest.iter().map(|&(_, n)| n).sum::<usize>();
        let by = rest.iter().map(|&(kind, n)| counted(n, kind, &format!("{kind}s"))).collect::<Vec<_>>();
        let (noun, verb, called) = if total == 1 { ("indel", "is", "it is not") } else { ("indels", "are", "none of them is") };
        format!(
            "{} more {noun} beside bases that are not known ({}) {verb} not listed; {called} called.",
            format_thousands(total),
            by.join(", ")
        )
    }));
    // Each soft-clipped stretch, by the sample bases it holds (numbered as the sample was given) and,
    // where it lies between anchored bases, the reference bases it was aligned against.
    let mut clip_sentences = Vec::new();
    for &(a, b) in &clips {
        let q_before = qa[..a].iter().filter(|&&c| c != b'-').count();
        let q_in = qa[a..b].iter().filter(|&&c| c != b'-').count();
        if q_in == 0 {
            continue;
        }
        let (first, last) = (q_before, q_before + q_in - 1);
        let (from, to) = if reverse { (samp_clean.len() - last, samp_clean.len() - first) } else { (first + 1, last + 1) };
        let span = format!("{}-{}", format_thousands(from), format_thousands(to));
        let end = if from == 1 {
            Some("start")
        } else if to == samp_clean.len() {
            Some("end")
        } else {
            None
        };
        let r_before = win_start + ystart + ra[..a].iter().filter(|&&c| c != b'-').count();
        let r_in = ra[a..b].iter().filter(|&&c| c != b'-').count();
        clip_sentences.push((
            "clip",
            match end {
                Some(end) => format!(
                    "The sample's bases {span}, at its {end}, score as unrelated bases where they align (no anchored stretch holds them), so they are soft-clipped and no variant is called there."
                ),
                None => format!(
                    "The sample's bases {span}, aligned against reference bases {}-{}, score as unrelated bases there (no anchored stretch holds them), so they are soft-clipped and no variant is called there.",
                    format_thousands(r_before + 1),
                    format_thousands(r_before + r_in.max(1))
                ),
            },
        ));
    }
    warnings.extend(listed_warnings(clip_sentences, |rest| {
        let total = rest.iter().map(|&(_, n)| n).sum::<usize>();
        format!("{} more soft-clipped {} of the sample {} not listed; no variant is called there.", format_thousands(total), if total == 1 { "stretch" } else { "stretches" }, if total == 1 { "is" } else { "are" })
    }));

    FreeBayesVariantReport {
        total_variants: total,
        snp_count,
        mnp_or_indel_count: total - snp_count,
        // Ti/Tv is undefined without transversions; report 0 rather than dividing by a fake 1.
        ti_tv_ratio: if transversions > 0 {
            ((transitions as f64 / transversions as f64) * 100.0).round() / 100.0
        } else {
            0.0
        },
        variants,
        vcf_text,
        annotations,
        warnings,
    }
}

#[cfg(test)]
mod de_novo_tests {
    use super::*;

    fn genome(len: usize) -> String {
        // Deterministic pseudo-random sequence (LCG) with no long repeats.
        let mut x: u64 = 0x2545F4914F6CDD1D;
        (0..len)
            .map(|_| {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                b"ACGT"[((x >> 33) % 4) as usize] as char
            })
            .collect()
    }

    /// More than 64 overlapping reads must still assemble into one contig.
    #[test]
    fn assembles_more_than_sixty_four_tiled_reads() {
        let g = genome(12_400);
        let reads: Vec<AssemblyReadInput> = (0..120)
            .map(|i| AssemblyReadInput { name: format!("r{i}"), sequence: g[i * 100..i * 100 + 500].to_string() })
            .collect();
        let rep = run_de_novo_assembly(&reads, "overlap", 30);
        assert_eq!(rep.contig_count, 1, "contigs: {:?}", rep.contigs.iter().map(|c| c.length_bp).collect::<Vec<_>>());
        assert_eq!(rep.contigs[0].sequence, g[..11_900 + 500]);
        assert_eq!(rep.contigs[0].read_count, 120);
    }
}

#[cfg(test)]
mod segment_tests {
    use super::left_align_gaps;

    /// Left-aligns the alignment `query` / `reference` (rows of equal length, `-` for a gap).
    fn left_aligned(query: &str, reference: &str) -> (String, String) {
        let (mut qa, mut ra) = (query.as_bytes().to_vec(), reference.as_bytes().to_vec());
        left_align_gaps(&mut qa, &mut ra);
        (String::from_utf8(qa).unwrap(), String::from_utf8(ra).unwrap())
    }

    /// A gap a seam left at the right of a repeat moves to the repeat's left end, and no further than
    /// a base that differs (BG-01M6S1QP). The integration test of tandem repeats reaches this pass
    /// only where a seam falls inside a repeat before the chain's jump; these cases pin each rule.
    #[test]
    fn moves_gaps_in_a_repeat_to_its_left_end() {
        // a deletion of one ACG from (ACG)3
        assert_eq!(left_aligned("TTACGACG---TT", "TTACGACGACGTT"), ("TT---ACGACGTT".into(), "TTACGACGACGTT".into()));
        // an insertion of one ACG into (ACG)3
        assert_eq!(
            left_aligned("TTACGACGACGACGTT", "TTACGACGACG---TT"),
            ("TTACGACGACGACGTT".into(), "TT---ACGACGACGTT".into())
        );
        // a mismatch in the repeat stops the deletion beside it
        assert_eq!(left_aligned("TTAGGACG---TT", "TTACGACGACGTT"), ("TTAG---GACGTT".into(), "TTACGACGACGTT".into()));
        // a mismatch just before a gap stops it even where its sample base equals the gap's last
        // base: moving the deletion past it would turn the mismatch into a match, and moving the
        // insertion past it would drop the reference base it pairs with
        assert_eq!(left_aligned("TTA--TT", "TTCAATT"), ("TTA--TT".into(), "TTCAATT".into()));
        assert_eq!(left_aligned("TTCACTT", "TTA--TT"), ("TTCACTT".into(), "TTA--TT".into()));
        // a deletion running to the last column is the end of the sample, and stays there
        assert_eq!(left_aligned("ACGA--", "ACGAGA"), ("ACGA--".into(), "ACGAGA".into()));
    }
}
