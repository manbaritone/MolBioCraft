// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Large-Genome $(w, k)$ Canonical Minimizer Sketcher, Mash Mutation Distance & ANI Estimator,
//! Seed-Chain-Extend Long-Read (ONT / HiFi) Mapper, and Multi-Genome Pangenome Core/Accessory
//! Openness (Heap's Law) Profiler.

use std::collections::VecDeque;

use molbiocraft_core::clean_alpha_sequence;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};

use crate::pairwise::{align_pairwise_gotoh, PairwiseMode};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimizerAnchor {
    pub hash: u64,
    pub pos_0: usize,
    pub strand: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MashMinimizerReport {
    pub kmer_size: usize,
    pub window_size: usize,
    pub sketch_capacity: usize,
    pub seq_a_length_bp: usize,
    pub seq_b_length_bp: usize,
    pub sketch_a_size: usize,
    pub sketch_b_size: usize,
    pub shared_sketch_hashes: usize,
    pub union_sketch_hashes: usize,
    pub jaccard_index: f64,
    pub mash_distance: f64,
    pub estimated_ani_pct: f64,
    pub containment_a_in_b: f64,
    pub containment_b_in_a: f64,
    pub p_value: f64,
    pub evolutionary_relationship: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainedReadAlignment {
    pub read_name: String,
    pub read_length_bp: usize,
    pub mapped: bool,
    pub strand: i8,
    pub ref_start_bp: usize, // 1-based
    pub ref_end_bp: usize,   // 1-based
    pub query_start_bp: usize,
    pub query_end_bp: usize,
    pub chained_anchors: usize,
    pub chain_dp_score: i64,
    pub estimated_identity_pct: f64,
    pub mapq: u8,
    pub cigar_summary: String,
    pub structural_indel_bp: isize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongReadMappingSummary {
    pub reference_length_bp: usize,
    pub total_reads: usize,
    pub mapped_reads: usize,
    pub mean_identity_pct: f64,
    pub mean_mapq: f64,
    pub reference_breadth_covered_pct: f64,
    pub alignments: Vec<ChainedReadAlignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PangenomeGenomeInput {
    pub id: String,
    pub name: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PangenomeCurvePoint {
    pub genomes_sampled: usize,
    pub cumulative_pan_loci: usize,
    pub conserved_core_loci: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PangenomeProfileReport {
    pub genome_count: usize,
    pub kmer_size: usize,
    pub total_pan_loci: usize,
    pub core_loci: usize,
    pub soft_core_shell_loci: usize,
    pub cloud_strain_specific_loci: usize,
    pub core_fraction_pct: f64,
    pub heaps_law_gamma: f64,
    pub openness_classification: String,
    pub accumulation_curve: Vec<PangenomeCurvePoint>,
    pub strain_unique_counts: Vec<(String, usize)>,
}

#[inline]
fn base_to_2bit(b: u8) -> Option<u64> {
    match b {
        b'A' | b'a' => Some(0),
        b'C' | b'c' => Some(1),
        b'G' | b'g' => Some(2),
        b'T' | b't' | b'U' | b'u' => Some(3),
        _ => None,
    }
}

/// Invertible 64-bit integer avalanche hash (`minimap2` / SplitMix64 family) preventing
/// poly-A/poly-G homopolymer hash clustering during minimizer selection.
#[inline]
fn hash64_avalanche(mut key: u64, mask: u64) -> u64 {
    key = (!key).wrapping_add(key << 21) & mask;
    key ^= key >> 24;
    key = (key.wrapping_add(key << 3)).wrapping_add(key << 8) & mask;
    key ^= key >> 14;
    key = (key.wrapping_add(key << 2)).wrapping_add(key << 4) & mask;
    key ^= key >> 28;
    key = key.wrapping_add(key << 31) & mask;
    key
}

/// Extracts canonical $(w, k)$ minimizers in strict $O(N)$ linear time using a monotonic deque.
/// Scales effortlessly to 5–50 Mbp bacterial/eukaryotic chromosomes.
pub fn extract_canonical_minimizers(raw_seq: &str, k: usize, w: usize) -> Vec<MinimizerAnchor> {
    let k = k.clamp(7, 31);
    let w = w.clamp(1, 64);
    let bytes = raw_seq.as_bytes();
    if bytes.len() < k {
        return Vec::new();
    }

    let shift = 2 * (k - 1);
    let mask = if k == 32 { u64::MAX } else { (1u64 << (2 * k)) - 1 };

    let mut fwd = 0u64;
    let mut rev = 0u64;
    let mut valid_run = 0usize;

    // Monotonic queue of (kmer_index, MinimizerAnchor)
    let mut deque: VecDeque<(usize, MinimizerAnchor)> = VecDeque::with_capacity(w + 2);
    let mut out: Vec<MinimizerAnchor> = Vec::with_capacity(bytes.len() / ((w + 1) / 2).max(1));
    let mut last_emitted_pos = usize::MAX;
    let mut kmer_counter = 0usize;

    for (idx, &ch) in bytes.iter().enumerate() {
        if let Some(code) = base_to_2bit(ch) {
            fwd = ((fwd << 2) | code) & mask;
            rev = (rev >> 2) | ((3 - code) << shift);
            valid_run += 1;

            if valid_run >= k {
                let start_pos = idx + 1 - k;
                // Skip symmetrical palindromic k-mers where fwd == rev to match minimap2 tie-breaking
                let (canon, strand) = if fwd < rev {
                    (fwd, 1i8)
                } else if rev < fwd {
                    (rev, -1i8)
                } else {
                    (fwd, 1i8)
                };
                let h = hash64_avalanche(canon, mask);
                let cand = MinimizerAnchor {
                    hash: h,
                    pos_0: start_pos,
                    strand,
                };

                while let Some(&(_, back)) = deque.back() {
                    if back.hash >= cand.hash {
                        deque.pop_back();
                    } else {
                        break;
                    }
                }
                deque.push_back((kmer_counter, cand));

                let min_kmer_idx = kmer_counter.saturating_sub(w - 1);
                while let Some(&(front_idx, _)) = deque.front() {
                    if front_idx < min_kmer_idx {
                        deque.pop_front();
                    } else {
                        break;
                    }
                }

                if valid_run >= k + w - 1 {
                    if let Some(&(_, front)) = deque.front() {
                        if front.pos_0 != last_emitted_pos {
                            out.push(front);
                            last_emitted_pos = front.pos_0;
                        }
                    }
                } else if bytes.len() < k + w - 1 && idx + 1 == bytes.len() {
                    if let Some(&(_, front)) = deque.front() {
                        out.push(front);
                    }
                }
                kmer_counter += 1;
            }
        } else {
            valid_run = 0;
            fwd = 0;
            rev = 0;
            deque.clear();
        }
    }

    if out.is_empty() {
        if let Some(&(_, front)) = deque.front() {
            out.push(front);
        }
    }
    out
}

fn build_sorted_minimizer_hashes(raw_seq: &str, k: usize, w: usize) -> Vec<u64> {
    let mins = extract_canonical_minimizers(raw_seq, k, w);
    let mut hashes: Vec<u64> = mins.into_iter().map(|m| m.hash).collect();
    hashes.sort_unstable();
    hashes.dedup();
    hashes
}

/// Computes Ondov et al. (2016) Mash Evolutionary Mutation Distance, Average Nucleotide Identity
/// (ANI), and Ondov et al. (2019) Mash Screen asymmetric Containment Index using bottom-$s$
/// canonical $(w, k)$ minimizer sketches.
pub fn compute_mash_minimizer_distance(
    seq_a: &str,
    seq_b: &str,
    k: usize,
    w: usize,
    sketch_capacity: usize,
) -> MashMinimizerReport {
    let clean_a = clean_alpha_sequence(seq_a);
    let clean_b = clean_alpha_sequence(seq_b);
    let k = k.clamp(9, 29);
    let w = w.clamp(1, 32);
    let s_cap = sketch_capacity.clamp(64, 8192);

    let all_a = build_sorted_minimizer_hashes(&clean_a, k, w);
    let all_b = build_sorted_minimizer_hashes(&clean_b, k, w);
    let sk_a = &all_a[..all_a.len().min(s_cap)];
    let sk_b = &all_b[..all_b.len().min(s_cap)];

    // Merge-intersect the two sorted bottom-s sketches up to union size `s_cap`
    let mut i = 0usize;
    let mut j = 0usize;
    let mut shared_bottom_s = 0usize;
    let mut union_drawn = 0usize;

    while i < sk_a.len() && j < sk_b.len() && union_drawn < s_cap {
        let ha = sk_a[i];
        let hb = sk_b[j];
        if ha == hb {
            shared_bottom_s += 1;
            union_drawn += 1;
            i += 1;
            j += 1;
        } else if ha < hb {
            union_drawn += 1;
            i += 1;
        } else {
            union_drawn += 1;
            j += 1;
        }
    }
    while i < sk_a.len() && union_drawn < s_cap {
        union_drawn += 1;
        i += 1;
    }
    while j < sk_b.len() && union_drawn < s_cap {
        union_drawn += 1;
        j += 1;
    }

    let jaccard = if union_drawn > 0 {
        (shared_bottom_s as f64) / (union_drawn as f64)
    } else {
        0.0
    };

    let mash_dist = if jaccard <= 0.0 {
        1.0
    } else if jaccard >= 1.0 {
        0.0
    } else {
        let ratio = (2.0 * jaccard) / (1.0 + jaccard);
        ((-1.0 / (k as f64)) * ratio.ln()).clamp(0.0, 1.0)
    };

    let ani_pct = ((1.0 - mash_dist).clamp(0.0, 1.0) * 10000.0).round() / 100.0;

    // Mash Screen asymmetric containment: |S_s(A) ∩ AllMinimizers(B)| / |S_s(A)|
    let cont_a = if !sk_a.is_empty() {
        let hits = sk_a
            .iter()
            .filter(|&&h| all_b.binary_search(&h).is_ok())
            .count();
        (hits as f64 / sk_a.len() as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let cont_b = if !sk_b.is_empty() {
        let hits = sk_b
            .iter()
            .filter(|&&h| all_a.binary_search(&h).is_ok())
            .count();
        (hits as f64 / sk_b.len() as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Ondov et al. (2016) Eq. 5-6 random k-mer collision probability p-value:
    // p_A = 1 - exp(-L_A / 4^k), p_B = 1 - exp(-L_B / 4^k), r = (p_A * p_B) / (p_A + p_B - p_A * p_B)
    let sigma = 4.0f64.powi(k as i32);
    let p_a = 1.0 - (-(clean_a.len() as f64) / sigma).exp();
    let p_b = 1.0 - (-(clean_b.len() as f64) / sigma).exp();
    let denom = (p_a + p_b - p_a * p_b).max(1e-18);
    let p_single = ((p_a * p_b) / denom).clamp(1e-15, 0.999);
    // Upper tail Poisson/Chernoff bound on observing `shared_bottom_s` collisions out of `union_drawn`
    let expected = (union_drawn as f64) * p_single;
    let p_val = if shared_bottom_s == 0 {
        1.0
    } else if (shared_bottom_s as f64) <= expected {
        0.5
    } else {
        let obs = shared_bottom_s as f64;
        let kl = obs * (obs / expected.max(1e-18)).ln() - (obs - expected);
        (-kl).exp().clamp(0.0, 1.0)
    };

    let rel = if ani_pct >= 99.5 {
        "Clonal / Near-Identical Strain (>= 99.5% ANI)"
    } else if ani_pct >= 95.0 {
        "Conspecific Prokaryotic / Viral Species (>= 95% ANI boundary)"
    } else if ani_pct >= 85.0 {
        "Closely Related Sister Species / Same Genus (85-95% ANI)"
    } else if cont_a.max(cont_b) >= 0.65 {
        "Sub-Genomic Containment Detected (Plasmid / Prophage / Locus Embedded)"
    } else {
        "Divergent Taxa (< 85% ANI)"
    };

    let r4 = |x: f64| (x * 10000.0).round() / 10000.0;

    MashMinimizerReport {
        kmer_size: k,
        window_size: w,
        sketch_capacity: s_cap,
        seq_a_length_bp: clean_a.len(),
        seq_b_length_bp: clean_b.len(),
        sketch_a_size: sk_a.len(),
        sketch_b_size: sk_b.len(),
        shared_sketch_hashes: shared_bottom_s,
        union_sketch_hashes: union_drawn,
        jaccard_index: r4(jaccard),
        mash_distance: r4(mash_dist),
        estimated_ani_pct: ani_pct,
        containment_a_in_b: r4(cont_a),
        containment_b_in_a: r4(cont_b),
        p_value: p_val,
        evolutionary_relationship: rel.into(),
    }
}

/// Maps long reads or assembled contigs (Oxford Nanopore / PacBio HiFi) onto a reference genome
/// via `minimap2`-style $(w, k)$ minimizer seed indexing + colinear dynamic-programming chaining.
pub fn map_long_read_minimizer_chains(
    reference_seq: &str,
    reads: &[(String, String)],
    k: usize,
    w: usize,
) -> LongReadMappingSummary {
    let ref_clean = clean_alpha_sequence(reference_seq);
    let ref_len = ref_clean.len();
    let k = k.clamp(9, 21);
    let w = w.clamp(2, 16);

    if ref_len < k || reads.is_empty() {
        return LongReadMappingSummary {
            reference_length_bp: ref_len,
            total_reads: reads.len(),
            mapped_reads: 0,
            mean_identity_pct: 0.0,
            mean_mapq: 0.0,
            reference_breadth_covered_pct: 0.0,
            alignments: Vec::new(),
        };
    }

    // Build minimizer hash table over reference genome (filtering ultra-repetitive seeds > 64 hits)
    let ref_mins = extract_canonical_minimizers(&ref_clean, k, w);
    let mut index: FxHashMap<u64, Vec<(usize, i8)>> = FxHashMap::default();
    for m in ref_mins {
        let bucket = index.entry(m.hash).or_default();
        if bucket.len() <= 64 {
            bucket.push((m.pos_0, m.strand));
        }
    }

    let cov_bins = 1000usize.min(ref_len.max(1));
    let mut covered_bins = vec![false; cov_bins];
    let mut alignments = Vec::with_capacity(reads.len());
    let mut mapped_cnt = 0usize;
    let mut id_sum = 0.0;
    let mut mapq_sum = 0.0;

    for (name, raw_read) in reads {
        let q_clean = clean_alpha_sequence(raw_read);
        let q_len = q_clean.len();
        if q_len < k {
            alignments.push(ChainedReadAlignment {
                read_name: name.clone(),
                read_length_bp: q_len,
                mapped: false,
                strand: 1,
                ref_start_bp: 0,
                ref_end_bp: 0,
                query_start_bp: 0,
                query_end_bp: 0,
                chained_anchors: 0,
                chain_dp_score: 0,
                estimated_identity_pct: 0.0,
                mapq: 0,
                cigar_summary: "*".into(),
                structural_indel_bp: 0,
            });
            continue;
        }

        let q_mins = extract_canonical_minimizers(&q_clean, k, w);
        // Anchor tuple: (strand: +1/-1, ref_pos, query_effective_pos)
        // For reverse-complement (-1) matches, query_effective_pos = q_len - k - q_pos so colinear matches increase together!
        let mut anchors_fwd: Vec<(usize, usize)> = Vec::new();
        let mut anchors_rev: Vec<(usize, usize)> = Vec::new();

        for qm in q_mins {
            if let Some(hits) = index.get(&qm.hash) {
                if hits.len() > 64 {
                    continue;
                }
                for &(r_pos, r_strand) in hits {
                    if r_strand == qm.strand {
                        anchors_fwd.push((r_pos, qm.pos_0));
                    } else {
                        let q_eff = q_len.saturating_sub(k + qm.pos_0);
                        anchors_rev.push((r_pos, q_eff));
                    }
                }
            }
        }

        let chain_strand = |mut pts: Vec<(usize, usize)>| -> (i64, Vec<(usize, usize)>, i64) {
            if pts.is_empty() {
                return (0, Vec::new(), 0);
            }
            pts.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            pts.dedup();
            let m = pts.len();
            let mut f = vec![k as i64; m];
            let mut pred = vec![usize::MAX; m];
            let max_band_lookback = 48usize;
            let max_dist = (q_len * 2).max(5000);

            for i in 0..m {
                let (ri, qi) = pts[i];
                let lo = i.saturating_sub(max_band_lookback);
                for j in (lo..i).rev() {
                    let (rj, qj) = pts[j];
                    if ri <= rj || qi <= qj {
                        continue;
                    }
                    let dr = ri - rj;
                    let dq = qi - qj;
                    if dr > max_dist {
                        break;
                    }
                    if dq > max_dist {
                        continue;
                    }
                    let alpha = dr.min(dq).min(k) as i64;
                    let gap = dr.abs_diff(dq) as f64;
                    let beta = if gap == 0.0 {
                        0
                    } else {
                        (0.01 * (k as f64) * gap + 0.5 * gap.log2().max(0.0)).round() as i64
                    };
                    let cand = f[j] + alpha - beta;
                    if cand > f[i] {
                        f[i] = cand;
                        pred[i] = j;
                    }
                }
            }

            let mut best_idx = 0usize;
            let mut second_score = 0i64;
            for i in 1..m {
                if f[i] > f[best_idx] {
                    second_score = f[best_idx];
                    best_idx = i;
                } else if f[i] > second_score && pred[best_idx] != i {
                    second_score = f[i];
                }
            }

            let best_score = f[best_idx];
            let mut chain = Vec::new();
            let mut cur = best_idx;
            while cur != usize::MAX {
                chain.push(pts[cur]);
                cur = pred[cur];
            }
            chain.reverse();
            (best_score, chain, second_score)
        };

        let (score_f, chain_f, sec_f) = chain_strand(anchors_fwd);
        let (score_r, chain_r, sec_r) = chain_strand(anchors_rev);

        let (best_strand, best_score, best_chain, runner_up) = if score_f >= score_r {
            (1i8, score_f, chain_f, sec_f.max(score_r))
        } else {
            (-1i8, score_r, chain_r, sec_r.max(score_f))
        };

        if best_chain.len() < 2 && q_len >= k * 3 {
            alignments.push(ChainedReadAlignment {
                read_name: name.clone(),
                read_length_bp: q_len,
                mapped: false,
                strand: best_strand,
                ref_start_bp: 0,
                ref_end_bp: 0,
                query_start_bp: 0,
                query_end_bp: 0,
                chained_anchors: best_chain.len(),
                chain_dp_score: best_score,
                estimated_identity_pct: 0.0,
                mapq: 0,
                cigar_summary: "*".into(),
                structural_indel_bp: 0,
            });
            continue;
        }

        let (r0, q0) = best_chain[0];
        let (r_last, q_last) = best_chain[best_chain.len() - 1];
        let r_start = r0 + 1;
        let r_end = (r_last + k).min(ref_len);
        let q_start = q0 + 1;
        let q_end = (q_last + k).min(q_len);

        let ref_span = r_end.saturating_sub(r_start) + 1;
        let q_span = q_end.saturating_sub(q_start) + 1;
        let indel_bp = (q_span as isize) - (ref_span as isize);

        // Estimate base-level identity via Gotoh extension on bounded locus (<= 1,500 bp) or anchor density
        let identity_pct = if ref_span <= 1500 && q_span <= 1500 {
            let q_oriented = if best_strand == 1 {
                q_clean.clone()
            } else {
                molbiocraft_core::reverse_complement_iupac(&q_clean, false)
            };
            let r_sub = &ref_clean[(r_start - 1)..r_end];
            let q_sub = &q_oriented[(q_start - 1)..q_end];
            align_pairwise_gotoh(
                r_sub,
                q_sub,
                PairwiseMode::Global,
                None,
                2,
                -2,
                -4,
                -1,
                1600,
            )
            .identity_pct
        } else {
            let covered_est = ((best_chain.len() * ((w + 1) / 2).max(1) * k / 2) as f64)
                / (q_span.max(1) as f64);
            let mash_j = covered_est.clamp(0.05, 1.0);
            let d = ((-1.0 / (k as f64)) * ((2.0 * mash_j) / (1.0 + mash_j)).ln()).clamp(0.0, 0.35);
            (((1.0 - d) * 100.0) * 10.0).round() / 10.0
        };

        let score_ratio = if best_score > 0 {
            1.0 - ((runner_up.max(0) as f64) / (best_score as f64))
        } else {
            0.0
        };
        let mapq = ((40.0 * score_ratio * (best_chain.len().min(10) as f64 / 10.0).sqrt())
            .round() as u8)
            .min(60);

        let cigar = if indel_bp == 0 {
            format!("{}M", q_span)
        } else if indel_bp > 0 {
            format!("{}M{}I", ref_span, indel_bp)
        } else {
            format!("{}M{}D", q_span, -indel_bp)
        };

        let bin_s = ((r_start - 1) * cov_bins) / ref_len;
        let bin_e = ((r_end * cov_bins) / ref_len).min(cov_bins);
        for flag in covered_bins.iter_mut().take(bin_e.max(bin_s + 1).min(cov_bins)).skip(bin_s) {
            *flag = true;
        }

        mapped_cnt += 1;
        id_sum += identity_pct;
        mapq_sum += mapq as f64;

        alignments.push(ChainedReadAlignment {
            read_name: name.clone(),
            read_length_bp: q_len,
            mapped: true,
            strand: best_strand,
            ref_start_bp: r_start,
            ref_end_bp: r_end,
            query_start_bp: q_start,
            query_end_bp: q_end,
            chained_anchors: best_chain.len(),
            chain_dp_score: best_score,
            estimated_identity_pct: (identity_pct * 10.0).round() / 10.0,
            mapq,
            cigar_summary: cigar,
            structural_indel_bp: indel_bp,
        });
    }

    let breadth = (covered_bins.iter().filter(|&&b| b).count() as f64 / cov_bins as f64) * 100.0;
    let r1 = |v: f64| (v * 10.0).round() / 10.0;

    LongReadMappingSummary {
        reference_length_bp: ref_len,
        total_reads: reads.len(),
        mapped_reads: mapped_cnt,
        mean_identity_pct: if mapped_cnt > 0 {
            r1(id_sum / mapped_cnt as f64)
        } else {
            0.0
        },
        mean_mapq: if mapped_cnt > 0 {
            r1(mapq_sum / mapped_cnt as f64)
        } else {
            0.0
        },
        reference_breadth_covered_pct: r1(breadth),
        alignments,
    }
}

/// Profiles multi-isolate pangenome core, shell, and strain-specific cloud genomic loci via
/// canonical $(w, k)$ minimizers and fits Heap's Law ($P = \kappa N^\gamma$) pangenome openness.
pub fn profile_pangenome_core_accessory(
    genomes: &[PangenomeGenomeInput],
    k: usize,
    w: usize,
) -> PangenomeProfileReport {
    let n = genomes.len();
    let k = k.clamp(11, 25);
    let w = w.clamp(2, 16);

    if n == 0 {
        return PangenomeProfileReport {
            genome_count: 0,
            kmer_size: k,
            total_pan_loci: 0,
            core_loci: 0,
            soft_core_shell_loci: 0,
            cloud_strain_specific_loci: 0,
            core_fraction_pct: 0.0,
            heaps_law_gamma: 0.0,
            openness_classification: "Empty Dataset".into(),
            accumulation_curve: Vec::new(),
            strain_unique_counts: Vec::new(),
        };
    }

    let mut per_genome_sets: Vec<FxHashSet<u64>> = Vec::with_capacity(n);
    let mut freq_map: FxHashMap<u64, usize> = FxHashMap::default();

    for g in genomes {
        let clean = clean_alpha_sequence(&g.sequence);
        let mins = extract_canonical_minimizers(&clean, k, w);
        let set: FxHashSet<u64> = mins.into_iter().map(|m| m.hash).collect();
        for &h in &set {
            *freq_map.entry(h).or_insert(0) += 1;
        }
        per_genome_sets.push(set);
    }

    let total_pan = freq_map.len();
    let core_threshold = ((n as f64) * 0.95).ceil() as usize;
    let mut core_loci = 0usize;
    let mut shell_loci = 0usize;
    let mut cloud_loci = 0usize;

    for &cnt in freq_map.values() {
        if cnt >= core_threshold.max(1) {
            core_loci += 1;
        } else if cnt == 1 {
            cloud_loci += 1;
        } else {
            shell_loci += 1;
        }
    }

    let mut strain_unique_counts = Vec::with_capacity(n);
    for (idx, g) in genomes.iter().enumerate() {
        let uniq = per_genome_sets[idx]
            .iter()
            .filter(|h| freq_map.get(h).copied().unwrap_or(0) == 1)
            .count();
        strain_unique_counts.push((g.name.clone(), uniq));
    }

    // Build accumulation curve P(m) and C(m) for m = 1..=n
    let mut union_running: FxHashSet<u64> = FxHashSet::default();
    let mut inter_running: FxHashSet<u64> = per_genome_sets[0].clone();
    let mut curve = Vec::with_capacity(n);

    for (idx, set) in per_genome_sets.iter().enumerate() {
        for &h in set {
            union_running.insert(h);
        }
        if idx > 0 {
            inter_running.retain(|h| set.contains(h));
        }
        curve.push(PangenomeCurvePoint {
            genomes_sampled: idx + 1,
            cumulative_pan_loci: union_running.len(),
            conserved_core_loci: inter_running.len(),
        });
    }

    // Log-log ordinary least squares fit of ln(P(m)) = ln(kappa) + gamma * ln(m) (Tettelin et al. 2008)
    let gamma = if n >= 2 && curve[0].cumulative_pan_loci > 0 {
        let mut sx = 0.0;
        let mut sy = 0.0;
        let mut sxx = 0.0;
        let mut sxy = 0.0;
        let nf = n as f64;
        for pt in &curve {
            let x = (pt.genomes_sampled as f64).ln();
            let y = (pt.cumulative_pan_loci.max(1) as f64).ln();
            sx += x;
            sy += y;
            sxx += x * x;
            sxy += x * y;
        }
        let denom = nf * sxx - sx * sx;
        if denom.abs() > 1e-12 {
            ((nf * sxy - sx * sy) / denom).clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else {
        0.0
    };

    let openness = if gamma <= 0.05 {
        "Closed Clonal Pangenome (gamma <= 0.05)"
    } else if gamma < 0.35 {
        "Moderately Open Species Pangenome (0.05 < gamma < 0.35)"
    } else {
        "Highly Open Horizontal-Gene-Transfer Pangenome (gamma >= 0.35)"
    };

    let core_pct = if total_pan > 0 {
        ((core_loci as f64 / total_pan as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    PangenomeProfileReport {
        genome_count: n,
        kmer_size: k,
        total_pan_loci: total_pan,
        core_loci,
        soft_core_shell_loci: shell_loci,
        cloud_strain_specific_loci: cloud_loci,
        core_fraction_pct: core_pct,
        heaps_law_gamma: (gamma * 1000.0).round() / 1000.0,
        openness_classification: openness.into(),
        accumulation_curve: curve,
        strain_unique_counts,
    }
}
