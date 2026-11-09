// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Large-Genome Co-Linear Minimizer Chaining & Whole-Proteome Reduced-Alphabet HSP Search
//! powered by `rust-bio` (`bio::pattern_matching::myers`, `bio::scores::blosum62`),
//! `rustc-hash` (`FxHashMap`), and `statrs`.
//!
//! Specifically engineered for multi-megabase chromosomes (`500 kbp – 5+ Mbp`) and
//! giant proteins / multi-thousand-entry proteomes (`10,000+ aa`) where dense $O(N \cdot M)$
//! dynamic programming matrices are intractable:
//! 1. `align_large_genomes_minimizer_chain`: Symmetric $(w, k)$-minimizer sketching with
//!    invertible 64-bit integer hashing, repetitive-seed filtering, Minimap2-style concave
//!    gap-penalty sparse DP chaining on both `+` and `-` strands, structural rearrangement
//!    classification (`colinear`, `inversion`, `translocation`, `indel_gap`), and
//!    `bio::pattern_matching::myers::Myers::<u64>` bit-parallel gap edit-distance refinement.
//! 2. `search_proteome_blosum62_hsps`: Murphy-10 reduced amino-acid alphabet $k$-mer index,
//!    two-hit diagonal filter, ungapped & X-drop gapped `bio::scores::blosum62` HSP extension,
//!    Wootton-Federhen SEG compositional entropy complexity check, and Karlin-Altschul
//!    gapped bit-score ($S'$) and E-value ($E$) statistics.

use bio::pattern_matching::myers::Myers;
use bio::scores::blosum62::blosum62;
use molbiocraft_core::{clean_alpha_sequence, clean_sequence, format_thousands};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

// ============================================================================
// 1. Large-Genome Minimizer Anchor Extraction & Concave-Gap Sparse DP Chaining
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntenicMinimizerChain {
    pub chain_id: usize,
    pub is_primary: bool,
    pub strand: i8, // +1 or -1
    pub target_start_bp: usize,
    pub target_end_bp: usize,
    pub query_start_bp: usize,
    pub query_end_bp: usize,
    pub anchor_count: usize,
    pub chain_score: i64,
    pub aligned_span_bp: usize,
    pub estimated_identity_pct: f64,
    pub mash_divergence: f64,
    pub structural_event: String, // "colinear" | "inversion" | "translocation" | "duplication"
    pub myers_refined_gap_edits: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeGenomeMinimizerChainReport {
    /// The length of the target given, in bases after cleaning.
    pub target_length_bp: usize,
    /// The length of the query given, in bases after cleaning.
    pub query_length_bp: usize,
    /// The target bases compared, from base 1: the whole target, or its first
    /// [`MINIMIZER_CHAIN_MAX_BP`]. The target coverage is a share of these bases.
    pub target_compared_bp: usize,
    /// The query bases compared, from base 1: the whole query, or its first
    /// [`MINIMIZER_CHAIN_MAX_BP`], or fewer when the anchor cap stopped the seeding there. The
    /// query coverage is a share of these bases, and no chain reaches past them.
    pub query_compared_bp: usize,
    pub window_w: usize,
    pub kmer_k: usize,
    pub target_minimizer_count: usize,
    pub query_minimizer_count: usize,
    pub raw_seed_matches: usize,
    /// Whether the seeding stopped at [`MINIMIZER_CHAIN_MAX_ANCHORS`] seed anchors, short of the
    /// end of the query's compared bases.
    pub anchor_cap_reached: bool,
    /// The fewest anchors a chain needs to be counted: the fewest that chance seed matches
    /// between genomes of the compared lengths and base compositions are expected to chain less
    /// than once in a hundred comparisons (see `chance_chain_anchors`). It grows with the genome
    /// lengths: at w = 8, k = 13 and even base composition, 6 for two 120 kb genomes and 10 for
    /// two 5 Mb genomes.
    pub min_chain_anchors: usize,
    /// Every chain counted: at least `min_chain_anchors` anchors; `chains` lists the best
    /// [`MINIMIZER_CHAINS_LISTED`] of them. A shorter chain is not counted, listed, or used in
    /// the coverage, the identity or the inversion count.
    pub total_chains: usize,
    /// Whether more chains were found than `chains` lists.
    pub chain_cap_reached: bool,
    /// Coverage, identity and the inversion count are over every chain counted, not only the
    /// listed ones.
    pub target_covered_pct: f64,
    pub query_covered_pct: f64,
    pub weighted_identity_pct: f64,
    pub inversion_chains: usize,
    pub chains: Vec<SyntenicMinimizerChain>,
    /// What the chainer left out of its input or its list, one plain sentence per event (D0005):
    /// a genome compared only up to the length cap, the seeding stopped by the anchor cap, and
    /// the list holding fewer chains than were found. Always serialised, as an empty list when
    /// nothing was left out.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most bases of each genome [`align_large_genomes_minimizer_chain`] compares, from base 1:
/// 12 Mb, so each of two bacterial genomes is indexed whole; the anchor cap can still stop the
/// seeding of a long related query sooner.
pub const MINIMIZER_CHAIN_MAX_BP: usize = 12_000_000;

/// The most seed anchors [`align_large_genomes_minimizer_chain`] collects, in query order. Two
/// 5 Mb genomes 1% apart seed 1,139,036 at w = 8, k = 13 (the studio's settings), so the cap is
/// reached past about 8.8 Mb of related sequence, or sooner on dense repeats; then the seeding
/// stops at a query base, and the result names it.
pub const MINIMIZER_CHAIN_MAX_ANCHORS: usize = 2_000_000;

/// The most chains a report lists: the highest-scoring of every chain found.
pub const MINIMIZER_CHAINS_LISTED: usize = 64;

#[derive(Clone, Copy, Debug)]
struct RawMinimizer {
    hash: u64,
    end_pos: u32,
    strand_bit: u8, // 0 = forward canonical, 1 = revcomp canonical
}

#[derive(Clone, Copy, Debug)]
struct SeedAnchor {
    strand: i8,       // +1 if target & query canonical orientations match, -1 if inverted
    target_pos: u32,  // 0-based k-mer end on target
    query_diag_pos: u32, // for +1: query_pos; for -1: (query_len - 1 - query_pos) so co-linear = monotonically increasing!
    raw_query_pos: u32,
}

#[inline]
fn nt_2bit(b: u8) -> Option<u64> {
    match b {
        b'A' | b'a' => Some(0),
        b'C' | b'c' => Some(1),
        b'G' | b'g' => Some(2),
        b'T' | b't' | b'U' | b'u' => Some(3),
        _ => None,
    }
}

/// Invertible 64-bit integer hash (Li 2018 Minimap2 / Wang hash) avoiding poly-A hash collisions.
#[inline]
fn hash64_invertible(mut key: u64, mask: u64) -> u64 {
    key = (!key).wrapping_add(key << 21) & mask;
    key ^= key >> 24;
    key = (key.wrapping_add(key << 3)).wrapping_add(key << 8) & mask;
    key ^= key >> 14;
    key = (key.wrapping_add(key << 2)).wrapping_add(key << 4) & mask;
    key ^= key >> 28;
    key = key.wrapping_add(key << 31) & mask;
    key
}

fn sketch_sequence_minimizers(seq_bytes: &[u8], w: usize, k: usize) -> Vec<RawMinimizer> {
    if seq_bytes.len() < k || k == 0 || k > 31 {
        return Vec::new();
    }
    let w = w.clamp(1, 128);
    let mask: u64 = if k == 32 { u64::MAX } else { (1u64 << (2 * k)) - 1 };
    let shift = 2 * (k - 1);

    let mut fwd = 0u64;
    let mut rev = 0u64;
    let mut valid_run = 0usize;
    let mut window_buf = vec![
        RawMinimizer {
            hash: u64::MAX,
            end_pos: 0,
            strand_bit: 0
        };
        w
    ];
    let mut buf_pos = 0usize;
    let mut min_entry = RawMinimizer {
        hash: u64::MAX,
        end_pos: u32::MAX,
        strand_bit: 0,
    };
    let mut out: Vec<RawMinimizer> = Vec::with_capacity((seq_bytes.len() * 2) / (w + 1) + 8);

    for (i, &b) in seq_bytes.iter().enumerate() {
        if let Some(c) = nt_2bit(b) {
            fwd = ((fwd << 2) | c) & mask;
            rev = (rev >> 2) | ((3u64 ^ c) << shift);
            valid_run += 1;
        } else {
            valid_run = 0;
            fwd = 0;
            rev = 0;
            min_entry.hash = u64::MAX;
            continue;
        }

        if valid_run < k {
            continue;
        }
        // Skip homopolymer-identical canonical ties (fwd == rev palindrome)
        if fwd == rev {
            continue;
        }
        let (canon, sbit) = if fwd < rev { (fwd, 0u8) } else { (rev, 1u8) };
        let info = RawMinimizer {
            hash: hash64_invertible(canon, mask),
            end_pos: i as u32,
            strand_bit: sbit,
        };

        let evicted = window_buf[buf_pos];
        window_buf[buf_pos] = info;
        buf_pos = (buf_pos + 1) % w;

        if info.hash <= min_entry.hash {
            if valid_run >= k + w - 1 && info.end_pos != min_entry.end_pos {
                out.push(info);
            }
            min_entry = info;
        } else if evicted.end_pos == min_entry.end_pos && valid_run >= k + w - 1 {
            // Re-scan tiny circular buffer of size w
            let mut best = RawMinimizer {
                hash: u64::MAX,
                end_pos: u32::MAX,
                strand_bit: 0,
            };
            for &cand in &window_buf {
                if cand.hash <= best.hash {
                    best = cand;
                }
            }
            if best.hash < u64::MAX && out.last().map(|x| x.end_pos) != Some(best.end_pos) {
                out.push(best);
            }
            min_entry = best;
        }
    }

    if out.is_empty() && min_entry.hash < u64::MAX {
        out.push(min_entry);
    }
    out
}

/// Align two large genomes (`50 kbp – 5+ Mbp`) via $(w, k)$-minimizer indexing,
/// Minimap2 concave-gap sparse DP chaining, and `rust-bio` Myers bit-parallel gap refinement.
/// Compares the first [`MINIMIZER_CHAIN_MAX_BP`] bases of each genome (each whole when shorter)
/// and seeds at most [`MINIMIZER_CHAIN_MAX_ANCHORS`] anchors, in query order; the report names
/// the bases compared, says when either cap was reached, and lists the best
/// [`MINIMIZER_CHAINS_LISTED`] of every chain counted, with coverage, identity and the inversion
/// count taken over them all. A chain counts only when it holds more anchors than chance seed
/// matches between genomes of these lengths and compositions are expected to chain
/// (`min_chain_anchors` in the report).
pub fn align_large_genomes_minimizer_chain(
    target_seq: &str,
    query_seq: &str,
    window_w: usize,
    kmer_k: usize,
    max_seed_occurrences: usize,
) -> LargeGenomeMinimizerChainReport {
    align_large_genomes_minimizer_chain_within(
        target_seq,
        query_seq,
        window_w,
        kmer_k,
        max_seed_occurrences,
        MINIMIZER_CHAIN_MAX_BP,
        MINIMIZER_CHAIN_MAX_ANCHORS,
    )
}

/// [`align_large_genomes_minimizer_chain`] with the length and anchor caps given, so the capped
/// paths can be tested on short genomes.
fn align_large_genomes_minimizer_chain_within(
    target_seq: &str,
    query_seq: &str,
    window_w: usize,
    kmer_k: usize,
    max_seed_occurrences: usize,
    max_bp: usize,
    max_anchors: usize,
) -> LargeGenomeMinimizerChainReport {
    let clean_t = clean_sequence(target_seq);
    let clean_q = clean_sequence(query_seq);
    let (target_length_bp, query_length_bp) = (clean_t.len(), clean_q.len());
    let t_bytes = &clean_t.as_bytes()[..target_length_bp.min(max_bp)];
    let q_bytes = &clean_q.as_bytes()[..query_length_bp.min(max_bp)];
    let t_len = t_bytes.len();
    let q_len = q_bytes.len();

    let k = kmer_k.clamp(7, 25).min(t_len.min(q_len).max(1));
    let w = window_w.clamp(1, 64);
    let max_occ = max_seed_occurrences.clamp(4, 500);

    let mut warnings = Vec::new();
    for (genome, compared, whole) in [("target", t_len, target_length_bp), ("query", q_len, query_length_bp)] {
        if compared < whole {
            let (compared, whole) = (format_thousands(compared), format_thousands(whole));
            warnings.push(format!(
                "Minimizer chaining compared only the first {compared} bp of the {whole}-bp {genome}; {genome} bases past {compared} are not chained."
            ));
        }
    }
    // A chain counts when its own score is at least `floor_anchors` anchors' worth and it holds at
    // least `min_chain_anchors(query bases seeded)` anchors: the fewest that chance seed matches
    // between genomes of these lengths and base compositions are not expected to chain
    // (`chance_chain_anchors`), and never fewer than `floor_anchors`.
    let floor_anchors: usize = if t_len.min(q_len) < 250 { 2 } else { 3 };
    let min_chain_anchors = |query_compared_bp: usize| {
        floor_anchors.max(significant_chain_anchors(t_bytes, &q_bytes[..query_compared_bp], w, k))
    };
    let empty = |target_minimizer_count: usize, query_minimizer_count: usize, query_compared_bp: usize, anchor_cap_reached: bool, warnings: Vec<String>| {
        LargeGenomeMinimizerChainReport {
            target_length_bp,
            query_length_bp,
            target_compared_bp: t_len,
            query_compared_bp,
            window_w: w,
            kmer_k: k,
            target_minimizer_count,
            query_minimizer_count,
            raw_seed_matches: 0,
            anchor_cap_reached,
            min_chain_anchors: min_chain_anchors(query_compared_bp),
            total_chains: 0,
            chain_cap_reached: false,
            target_covered_pct: 0.0,
            query_covered_pct: 0.0,
            weighted_identity_pct: 0.0,
            inversion_chains: 0,
            chains: Vec::new(),
            warnings,
        }
    };

    if t_len < k || q_len < k {
        return empty(0, 0, q_len, false, warnings);
    }

    let t_mins = sketch_sequence_minimizers(t_bytes, w, k);
    let mut q_mins = sketch_sequence_minimizers(q_bytes, w, k);
    // Seeds are taken in query order, so the anchor cap stops the seeding at one query base.
    if !q_mins.is_sorted_by_key(|m| m.end_pos) {
        q_mins.sort_by_key(|m| m.end_pos);
    }
    q_mins.dedup_by_key(|m| m.end_pos);

    // Index target minimizers as one vector sorted by hash, then position: a seed's target copies
    // are the run of its hash, in target order. A directory on the hash's top bits (the hash has
    // 2k bits) narrows each lookup to a few entries. It finds the same copies as a map of one
    // small vector per hash, in 16 bytes an entry instead of a map slot, a vector and a heap
    // block for each.
    let target_minimizer_count = t_mins.len();
    let mut index: Vec<(u64, u32, u8)> = t_mins.iter().map(|m| (m.hash, m.end_pos, m.strand_bit)).collect();
    drop(t_mins);
    index.sort_unstable();
    let hash_bits = 2 * k as u32;
    let shift = hash_bits - hash_bits.min(20);
    let mut directory = vec![0u32; (1usize << (hash_bits - shift)) + 1];
    for e in &index {
        directory[(e.0 >> shift) as usize + 1] += 1;
    }
    for i in 1..directory.len() {
        directory[i] += directory[i - 1];
    }

    // A query minimizer's target copies: the entries of its hash, or none when there are more than
    // `max_occ` (a high-copy repetitive k-mer, filtered).
    let copies_of = |hash: u64| -> &[(u64, u32, u8)] {
        let slot = (hash >> shift) as usize;
        let bucket = &index[directory[slot] as usize..directory[slot + 1] as usize];
        let first = bucket.partition_point(|e| e.0 < hash);
        let run = &bucket[first..first + bucket[first..].partition_point(|e| e.0 == hash)];
        if run.len() > max_occ { &[] } else { run }
    };

    // Seed anchors, a query minimizer's hits all or none, counted first so the list is allocated
    // once. When the next minimizer's hits would pass the cap, the seeding stops: the query is
    // compared up to the base before that minimizer's last base, and every anchor ends there or
    // earlier.
    let mut seeded_minimizers = q_mins.len();
    let mut anchor_count = 0usize;
    for (i, qm) in q_mins.iter().enumerate() {
        let copies = copies_of(qm.hash).len();
        if anchor_count + copies > max_anchors {
            seeded_minimizers = i;
            break;
        }
        anchor_count += copies;
    }
    let anchor_cap_reached = seeded_minimizers < q_mins.len();
    let query_compared_bp = if anchor_cap_reached { q_mins[seeded_minimizers].end_pos as usize } else { q_len };
    let mut anchors: Vec<SeedAnchor> = Vec::with_capacity(anchor_count);
    for qm in &q_mins[..seeded_minimizers] {
        for &(_, t_pos, t_sbit) in copies_of(qm.hash) {
            let same_orient = t_sbit == qm.strand_bit;
            let (strand, q_diag) = if same_orient {
                (1i8, qm.end_pos)
            } else {
                (-1i8, (q_len as u32).saturating_sub(1 + qm.end_pos))
            };
            anchors.push(SeedAnchor {
                strand,
                target_pos: t_pos,
                query_diag_pos: q_diag,
                raw_query_pos: qm.end_pos,
            });
        }
    }
    if anchor_cap_reached {
        let (kept, seeded, compared) = (
            format_thousands(anchors.len()),
            format_thousands(query_compared_bp),
            format_thousands(q_len),
        );
        warnings.push(format!(
            "Seed anchor cap reached: the chainer stopped at {kept} seed anchors, so it compared only query bases 1-{seeded} of {compared}; query bases past {seeded} are not chained, and both coverage figures count only chains from bases 1-{seeded}."
        ));
    }

    let raw_seed_matches = anchors.len();
    if anchors.is_empty() {
        return empty(target_minimizer_count, q_mins.len(), query_compared_bp, anchor_cap_reached, warnings);
    }

    // Sort anchors by (strand, target_pos, query_diag_pos) for sparse co-linear DP chaining
    anchors.sort_unstable_by_key(|a| (a.strand, a.target_pos, a.query_diag_pos));

    let n = anchors.len();
    let (f_score, parent) = chain_anchor_scores(&anchors, k);
    let k_i64 = k as i64;

    // Backtrack non-overlapping chains in descending score order: every chain, so the coverage,
    // the identity and the inversion count describe them all; the list keeps the best.
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_unstable_by(|&a, &b| f_score[b].cmp(&f_score[a]));

    let mut used = vec![false; n];
    let mut extracted_chains: Vec<(i64, Vec<usize>)> = Vec::new();
    let score_floor = floor_anchors as i64 * (k_i64 / 2).max(2);
    let min_chain_anchors = min_chain_anchors(query_compared_bp);

    for &end_idx in &order {
        if used[end_idx] || f_score[end_idx] < score_floor {
            continue;
        }
        // Trace back from end_idx to the chain's first anchor or to one an earlier chain holds, and
        // keep the stretch from end_idx back that scores best on its own: its score less that of
        // the anchor it extends (minimap2's backtrack; ties keep the longer). A trace can cross a
        // costly gap into anchors whose score it inherits, so a cumulative score says nothing
        // about the anchors after the gap: a run of chance anchors beside a long chain inherits
        // that chain's score and adds about k or less of its own, and a copy of a tandem unit can
        // hang from the copy before it through a 3 kb diagonal shift. The anchors before the gap
        // stay free for a chain of their own.
        let mut chain_indices = Vec::new();
        let (mut own_score, mut kept) = (i64::MIN, 0);
        let mut cur = end_idx;
        while cur != usize::MAX && !used[cur] {
            chain_indices.push(cur);
            cur = parent[cur];
            let own = f_score[end_idx] - if cur == usize::MAX { 0 } else { f_score[cur] };
            if own >= own_score {
                (own_score, kept) = (own, chain_indices.len());
            }
        }
        chain_indices.truncate(kept);
        if chain_indices.len() < min_chain_anchors || own_score < score_floor {
            continue;
        }
        for &idx in &chain_indices {
            used[idx] = true;
        }
        chain_indices.reverse();
        extracted_chains.push((own_score.max(k_i64), chain_indices));
    }

    // Highest score first; chains of equal score keep the order they were found in.
    extracted_chains.sort_by(|a, b| b.0.cmp(&a.0));
    let total_chains = extracted_chains.len();
    let chain_cap_reached = total_chains > MINIMIZER_CHAINS_LISTED;
    if chain_cap_reached {
        let (listed, found) = (format_thousands(MINIMIZER_CHAINS_LISTED), format_thousands(total_chains));
        warnings.push(format!(
            "Chain list capped: it lists the {listed} highest-scoring of the {found} chains found; coverage, identity and the inversion count use all {found}."
        ));
    }

    let mut chains = Vec::with_capacity(total_chains.min(MINIMIZER_CHAINS_LISTED));
    let mut t_intervals: Vec<(usize, usize)> = Vec::with_capacity(total_chains);
    let mut q_intervals: Vec<(usize, usize)> = Vec::with_capacity(total_chains);
    let mut weighted_id_num = 0.0;
    let mut weighted_id_den = 0.0;
    let mut inversion_chains = 0usize;

    for (cid, (score, idxs)) in extracted_chains.iter().enumerate() {
        let first = anchors[idxs[0]];
        let last = anchors[*idxs.last().unwrap()];
        let strand = first.strand;

        let t_start = (first.target_pos as usize + 1).saturating_sub(k).max(1);
        let t_end = (last.target_pos as usize + 1).min(t_len);

        let (q_start, q_end) = if strand >= 0 {
            let qs = (first.raw_query_pos as usize + 1).saturating_sub(k).max(1);
            let qe = (last.raw_query_pos as usize + 1).min(q_len);
            (qs.min(qe), qe.max(qs))
        } else {
            let qs = (last.raw_query_pos as usize + 1).saturating_sub(k).max(1);
            let qe = (first.raw_query_pos as usize + 1).min(q_len);
            (qs.min(qe), qe.max(qs))
        };

        let t_span = t_end.saturating_sub(t_start) + 1;
        let q_span = q_end.saturating_sub(q_start) + 1;
        let mean_span = ((t_span + q_span) / 2).max(k);

        // Mash-Jaccard chain sequence identity estimate from anchor density
        let expected_mins = ((mean_span as f64) * 2.0 / ((w + 1) as f64)).max(1.0);
        let anchor_ratio = ((idxs.len() as f64) / expected_mins).clamp(0.02, 1.0);
        let mash_div = (-(anchor_ratio.ln()) / (k as f64)).clamp(0.0, 0.35);
        let est_id = ((1.0 - mash_div) * 100.0).clamp(65.0, 100.0);

        if strand < 0 {
            inversion_chains += 1;
        }
        weighted_id_num += est_id * (mean_span as f64);
        weighted_id_den += mean_span as f64;

        if cid < MINIMIZER_CHAINS_LISTED {
            // Refine small inter-anchor gaps on forward chains using `rust-bio` Myers::<u64>
            let mut myers_gap_edits = 0usize;
            if strand >= 0 {
                for win in idxs.windows(2).take(24) {
                    let a0 = anchors[win[0]];
                    let a1 = anchors[win[1]];
                    let gs_t = (a0.target_pos as usize) + 1;
                    let ge_t = (a1.target_pos as usize + 1).saturating_sub(k);
                    let gs_q = (a0.raw_query_pos as usize) + 1;
                    let ge_q = (a1.raw_query_pos as usize + 1).saturating_sub(k);
                    if ge_t > gs_t && ge_q > gs_q {
                        let gt_len = ge_t - gs_t;
                        let gq_len = ge_q - gs_q;
                        if gt_len <= 64 && gq_len <= 64 && ge_t <= t_len && ge_q <= q_len {
                            let pat = &q_bytes[gs_q..ge_q];
                            let txt = &t_bytes[gs_t..ge_t];
                            if pat.len() <= txt.len() {
                                let myers = Myers::<u64>::new(pat);
                                if let Some((_, dist)) =
                                    myers.find_all_end(txt, (pat.len() as u8) / 2 + 4).min_by_key(|x| x.1)
                                {
                                    myers_gap_edits += dist as usize;
                                }
                            }
                        }
                    }
                }
            }

            // Every chain before this one is listed too, so `t_intervals` holds exactly them.
            let is_dup = t_intervals
                .iter()
                .any(|&(s, e)| t_start < e && t_end > s && (t_end.min(e) - t_start.max(s)) > t_span / 2);
            let event = if strand < 0 {
                "inversion"
            } else if is_dup {
                "duplication"
            } else if cid > 0
                && (t_start as isize - q_start as isize).unsigned_abs() > (t_len.max(q_len) / 5).max(500)
            {
                "translocation"
            } else {
                "colinear"
            };

            chains.push(SyntenicMinimizerChain {
                chain_id: cid + 1,
                is_primary: !is_dup,
                strand,
                target_start_bp: t_start,
                target_end_bp: t_end,
                query_start_bp: q_start,
                query_end_bp: q_end,
                anchor_count: idxs.len(),
                chain_score: *score,
                aligned_span_bp: mean_span,
                estimated_identity_pct: (est_id * 100.0).round() / 100.0,
                mash_divergence: (mash_div * 10000.0).round() / 10000.0,
                structural_event: event.to_string(),
                myers_refined_gap_edits: myers_gap_edits,
            });
        }

        t_intervals.push((t_start, t_end));
        q_intervals.push((q_start, q_end));
    }

    let t_cov_bp = union_interval_span(t_intervals);
    let q_cov_bp = union_interval_span(q_intervals);

    LargeGenomeMinimizerChainReport {
        target_length_bp,
        query_length_bp,
        target_compared_bp: t_len,
        query_compared_bp,
        window_w: w,
        kmer_k: k,
        target_minimizer_count,
        query_minimizer_count: q_mins.len(),
        raw_seed_matches,
        anchor_cap_reached,
        min_chain_anchors,
        total_chains,
        chain_cap_reached,
        target_covered_pct: ((t_cov_bp as f64 / t_len as f64) * 1000.0).round() / 10.0,
        query_covered_pct: ((q_cov_bp as f64 / query_compared_bp.max(1) as f64) * 1000.0).round() / 10.0,
        weighted_identity_pct: if weighted_id_den > 0.0 {
            ((weighted_id_num / weighted_id_den) * 100.0).round() / 100.0
        } else {
            0.0
        },
        inversion_chains,
        chains,
        warnings,
    }
}

/// The furthest a chain reaches back for an anchor's predecessor, on the target and on the query.
const CHAIN_MAX_GAP_BP: u32 = 25_000;

/// The most predecessors weighed for an anchor: earlier anchors on the same strand, in order on
/// both genomes and within [`CHAIN_MAX_GAP_BP`] on each, nearest first.
const CHAIN_MAX_PREDECESSORS: usize = 64;

/// The minimap2 concave gap cost of chaining across a target step `dx` and a query step `dy`:
/// `0.01 k g + 0.5 log2 g` for a diagonal shift `g = |dx - dy|`, rounded, and 0 on the diagonal.
#[inline]
fn chain_gap_cost(dx: u32, dy: u32, k: usize) -> i64 {
    let g = dx.abs_diff(dy) as f64;
    if g == 0.0 {
        0
    } else {
        (0.01 * (k as f64) * g + 0.5 * g.log2()).round() as i64
    }
}

/// The best chain score ending at each anchor and the predecessor it extends (`usize::MAX` for
/// none), over anchors sorted by (strand, target position, query diagonal position).
///
/// Each anchor weighs, nearest first, up to [`CHAIN_MAX_PREDECESSORS`] earlier anchors on its
/// strand that lie before it on both genomes and within [`CHAIN_MAX_GAP_BP`] on each, and extends
/// the best. That is the exhaustive backward walk with no further bound: it would visit every
/// earlier anchor within [`CHAIN_MAX_GAP_BP`] on the target, in sorted order, skipping those that
/// are not candidates. A candidate's diagonal (target position less query position) differs from
/// the anchor's by less than [`CHAIN_MAX_GAP_BP`], so the anchors are filed by diagonal in bands of
/// that width, and the walk merges, in sorted order, only the anchor's own band and the two beside
/// it. It visits a subsequence of the exhaustive walk that holds every candidate, so the
/// candidates weighed, their order and the chains are the exhaustive walk's, while a chance anchor
/// far from any chain no longer visits the thousands of anchors of a chain 25 kb away.
///
/// Round 1 of BG-01M6S1C1 bounded the walk at 256 anchors visited instead, which kept a dense
/// satellite interactive but could drop or split a true chain: 300 query copies of a 3 kb target
/// unit stack 300 anchors at each of the unit's target positions, so no unit anchor reached a
/// predecessor and the unit went unchained, and the 450-odd anchors of a 2 kb segment moved from
/// between two co-linear blocks of the target split those blocks into two chains.
fn chain_anchor_scores(anchors: &[SeedAnchor], k: usize) -> (Vec<i64>, Vec<usize>) {
    /// An anchor as its band holds it: positions, its index in `anchors`, and its chain score.
    #[derive(Clone, Copy, Default)]
    struct Filed {
        target_pos: u32,
        query_diag_pos: u32,
        index: u32,
        // at most k per anchor, so 2,000,000 anchors of k <= 25 stay under 2^31
        score: i32,
    }
    let n = anchors.len();
    let k_i64 = k as i64;
    let band = CHAIN_MAX_GAP_BP as i64;
    // the gap cost of every diagonal shift a candidate can have (both its steps are at most D)
    let gap_cost: Vec<i64> = (0..=CHAIN_MAX_GAP_BP).map(|g| chain_gap_cost(g, 0, k)).collect();
    // Band of each anchor: its strand's bands side by side, each the diagonals [b D, (b + 1) D)
    // after shifting by the largest query position, so every diagonal is filed at 0 or above.
    let max_qd = anchors.iter().map(|a| a.query_diag_pos as i64).max().unwrap_or(0);
    let max_t = anchors.iter().map(|a| a.target_pos as i64).max().unwrap_or(0);
    let per_strand = ((max_t + max_qd) / band + 1) as usize;
    let band_of = |a: &SeedAnchor| -> usize {
        let strand = usize::from(a.strand > 0);
        strand * per_strand + ((a.target_pos as i64 - a.query_diag_pos as i64 + max_qd) / band) as usize
    };
    // Each band's anchors lie side by side in sorted order, from band_from[b]; they are filed as
    // the scores are computed, in sorted order, so when anchor i is reached a band's filed
    // anchors are exactly its anchors before i, and its next free slot is where i's walk begins.
    let mut band_from = vec![0u32; 2 * per_strand + 1];
    for a in anchors {
        band_from[band_of(a) + 1] += 1;
    }
    for b in 1..band_from.len() {
        band_from[b] += band_from[b - 1];
    }
    let mut next_free = band_from.clone();
    let mut filed = vec![Filed::default(); n];

    let mut f_score = vec![k_i64; n];
    let mut parent = vec![usize::MAX; n];
    for i in 0..n {
        let ai = anchors[i];
        let b = band_of(&ai);
        let strand_first = b / per_strand * per_strand;
        // One cursor per band walked: the last filed slot, counting down to the band's first, and
        // the anchor index there (-1 once the band is walked; a missing band starts walked).
        let cursor = |nb: usize| -> (i64, i64, i64) {
            if nb < strand_first || nb >= strand_first + per_strand {
                return (-1, 0, -1);
            }
            let (slot, first) = (next_free[nb] as i64 - 1, band_from[nb] as i64);
            (slot, first, if slot >= first { filed[slot as usize].index as i64 } else { -1 })
        };
        let (mut s0, f0, mut h0) = cursor(b.wrapping_sub(1));
        let (mut s1, f1, mut h1) = cursor(b);
        let (mut s2, f2, mut h2) = cursor(b + 1);
        let step = |slot: &mut i64, first: i64, head: &mut i64| -> Filed {
            let aj = filed[*slot as usize];
            *slot -= 1;
            *head = if *slot >= first { filed[*slot as usize].index as i64 } else { -1 };
            aj
        };

        let mut best_f = k_i64;
        let mut best_p = usize::MAX;
        let mut weighed = 0usize;
        while weighed < CHAIN_MAX_PREDECESSORS {
            // the latest anchor in sorted order among the bands' next ones
            let aj = if h1 >= h0 && h1 >= h2 {
                if h1 < 0 {
                    break;
                }
                step(&mut s1, f1, &mut h1)
            } else if h0 >= h2 {
                step(&mut s0, f0, &mut h0)
            } else {
                step(&mut s2, f2, &mut h2)
            };
            let dx = ai.target_pos - aj.target_pos;
            if dx > CHAIN_MAX_GAP_BP {
                break;
            }
            if dx == 0 || aj.query_diag_pos >= ai.query_diag_pos {
                continue;
            }
            let dy = ai.query_diag_pos - aj.query_diag_pos;
            if dy > CHAIN_MAX_GAP_BP {
                continue;
            }
            weighed += 1;
            // Minimap2 concave gap penalty: alpha(j, i) - beta(j, i)
            let alpha = dx.min(dy).min(k as u32) as i64;
            let cand = aj.score as i64 + alpha - gap_cost[dx.abs_diff(dy) as usize];
            if cand > best_f {
                best_f = cand;
                best_p = aj.index as usize;
            }
        }
        f_score[i] = best_f;
        parent[i] = best_p;
        filed[next_free[b] as usize] = Filed {
            target_pos: ai.target_pos,
            query_diag_pos: ai.query_diag_pos,
            index: i as u32,
            score: best_f as i32,
        };
        next_free[b] += 1;
    }
    (f_score, parent)
}

/// The most chance chains a comparison is expected to count: a chain counts only when chance
/// alone is expected to chain that many anchors less often than this.
const CHANCE_CHAINS_ALLOWED: f64 = 0.01;

/// The largest chance of a chance successor the anchor count is derived for (see
/// [`chance_chain_anchors`]).
const CHANCE_SUCCESSOR_MAX: f64 = 0.5;

/// [`chance_chain_anchors`] for the bases compared: the chance that two bases agree is taken from
/// the base frequencies of `target` and `query` (A, C, G and T only), the larger of its value on
/// the same strand and with the query complemented.
fn significant_chain_anchors(target: &[u8], query: &[u8], w: usize, k: usize) -> usize {
    let freq = |s: &[u8]| {
        let mut c = [0f64; 4];
        for &b in s {
            if let Some(x) = nt_2bit(b) {
                c[x as usize] += 1.0;
            }
        }
        let total: f64 = c.iter().sum::<f64>().max(1.0);
        c.map(|v| v / total)
    };
    let (ft, fq) = (freq(target), freq(query));
    // A=0, C=1, G=2, T=3: the complement of base x is 3 - x
    let same: f64 = (0..4).map(|x| ft[x] * fq[x]).sum();
    let opposite: f64 = (0..4).map(|x| ft[x] * fq[3 - x]).sum();
    chance_chain_anchors(target.len(), query.len(), same.max(opposite), w, k)
}

/// The fewest anchors a chain needs before chance seed matches are not expected to have chained
/// it, for genomes of `t_len` and `q_len` bases compared, whose bases agree by chance with
/// probability `base_agree`, sketched with window `w` and k-mer length `k`.
///
/// Derivation. Take the two genomes as unrelated sequences of their own base composition. A seed
/// anchor joins target base `i` to query base `j` on one strand when the two k-mers agree in that
/// orientation and both are chosen as minimizers.
/// - Two bases agree with chance `pi` (`base_agree`), so two k-mers agree with chance `pi^k`:
///   `4^-k` at 25% per base, about 18 times that for a 25%-GC pair at k = 13.
/// - A k-mer whose hash has quantile `u` is a minimizer, the least of some window of `w`
///   consecutive k-mers, with chance `s(v) = v^(w-1) (w - (w-1) v)`, `v = 1 - u` (the runs of
///   larger hashes on its left and right must together fill a window). The mean of `s` is the
///   minimizer density `2/(w+1)`; two equal k-mers share `u`, so both are chosen with chance
///   `sigma_w = mean of s^2 = w^2/(2w-1) - (w-1) + (w-1)^2/(2w+1)`: 0.149 at w = 8, three times
///   the square of the density.
/// - Chance anchors on a strand number about `N = sigma_w pi^k T Q` (T, Q the bases compared),
///   at density `sigma_w pi^k` per target base and query base.
/// - An anchor extends a chain from a predecessor at most `D = 25,000` bp back (or the shorter
///   genome's length), and one anchor's gain of `k` pays the gap cost of a diagonal shift of at
///   most `G` bp (72 at k = 13). So an anchor has a chance successor with chance
///   `p = sigma_w pi^k D (2G + 1)`: 0.008 for w = 8, k = 13 at 25% per base.
/// - Chance chains of `e` independent coincidences or more then number about
///   `E(e) = 2 N p^(e-1) / (1 - p)` over both strands.
///
/// A chain of `m` anchors is credited with `m / 2` coincidences, rounded down: one chance match
/// can bring two anchors, since a chance inverted repeat `(i, j)` in two related genomes seeds both
/// `(i, j)` and `(j, i)` on the minus strand, on one diagonal with no gap between them, and a
/// chance match some bases longer than `k` holds two overlapping minimizers. The chain counts when
/// `E(m / 2) <= 0.01` ([`CHANCE_CHAINS_ALLOWED`]), that is when
/// `m >= 2 (1 + ceil(ln(2 N / (0.01 (1 - p))) / ln(1 / p)))`, or `m >= 2` when that logarithm is
/// not positive. The count grows with `ln(T Q) / ln(1 / p)`: for w = 8, k = 13 and 25% per
/// base it is 6 anchors for two 120 kb genomes, 8 for two 1 Mb genomes and 10 for two 5 Mb or
/// two 12 Mb genomes, where a real 5 kb block 1% diverged seeds about 1,000.
///
/// The model leaves out the k-mer structure beyond base composition and the chains that spend a
/// predecessor's spare score on a wider shift; on the seeded genomes the tests compare (even
/// composition at 120 kb, 1 Mb and 5 Mb, 25% GC at 1 Mb) the halving and the 1-in-100 allowance
/// leave no chance chain, and without the halving a 4-anchor chance "inversion" is counted at
/// 120 kb and 1 Mb.
///
/// Where `p` reaches 0.5 (a short `k` on long or AT-rich genomes) it is taken as 0.5
/// ([`CHANCE_SUCCESSOR_MAX`]): the count stays finite (58 anchors for two 1 Mb genomes at k = 9)
/// but is no longer derived.
fn chance_chain_anchors(t_len: usize, q_len: usize, base_agree: f64, w: usize, k: usize) -> usize {
    let wf = w as f64;
    let sigma_w = wf * wf / (2.0 * wf - 1.0) - (wf - 1.0) + (wf - 1.0) * (wf - 1.0) / (2.0 * wf + 1.0);
    let density = sigma_w * base_agree.powi(k as i32);
    let chance_anchors = density * t_len as f64 * q_len as f64;
    // the widest diagonal shift one anchor's gain of k pays for
    let max_shift = (1..).take_while(|&g: &u32| chain_gap_cost(g, 0, k) < k as i64).last().unwrap_or(0);
    let reach = (CHAIN_MAX_GAP_BP as usize).min(t_len).min(q_len) as f64;
    let p = (density * reach * (2 * max_shift + 1) as f64).min(CHANCE_SUCCESSOR_MAX);
    let excess = 2.0 * chance_anchors / (CHANCE_CHAINS_ALLOWED * (1.0 - p));
    let coincidences = if excess > 1.0 && p > 0.0 { 1 + (excess.ln() / (1.0 / p).ln()).ceil() as usize } else { 1 };
    2 * coincidences
}

fn union_interval_span(mut ivs: Vec<(usize, usize)>) -> usize {
    if ivs.is_empty() {
        return 0;
    }
    ivs.sort_unstable();
    let (mut cs, mut ce) = ivs[0];
    let mut total = 0usize;
    for &(s, e) in &ivs[1..] {
        if s <= ce + 1 {
            ce = ce.max(e);
        } else {
            total += ce - cs + 1;
            cs = s;
            ce = e;
        }
    }
    total + (ce - cs + 1)
}

// ============================================================================
// 2. Whole-Proteome Reduced-Alphabet Seed-and-Extend BLOSUM62 HSP Homology Engine
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteomeTargetRecord {
    pub id: String,
    pub name: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteomeBlosumHspHit {
    pub target_id: String,
    pub target_name: String,
    pub target_length_aa: usize,
    pub query_start_aa: usize,
    pub query_end_aa: usize,
    pub target_start_aa: usize,
    pub target_end_aa: usize,
    pub alignment_length_aa: usize,
    pub identical_aa: usize,
    pub positive_similar_aa: usize,
    pub identity_pct: f64,
    pub positives_pct: f64,
    pub raw_blosum62_score: i32,
    pub bit_score: f64,
    pub e_value: f64,
    pub query_complexity_entropy: f64,
    pub aligned_query: String,
    pub midline: String,
    pub aligned_target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteomeHomologySearchReport {
    pub query_length_aa: usize,
    pub database_sequences: usize,
    pub database_total_residues: usize,
    pub reduced_word_length: usize,
    pub hits: Vec<ProteomeBlosumHspHit>,
}

/// Murphy et al. (2000) *Protein Eng.* 13:149-152 10-letter reduced amino-acid alphabet
/// maximizing BLOSUM62 mutual information for sensitive distant-homolog seeding.
#[inline]
fn murphy10_code(aa: u8) -> Option<u32> {
    Some(match aa.to_ascii_uppercase() {
        b'L' | b'V' | b'I' | b'M' => 0,
        b'C' => 1,
        b'A' => 2,
        b'G' => 3,
        b'S' | b'T' => 4,
        b'P' => 5,
        b'F' | b'Y' | b'W' => 6,
        b'E' | b'D' | b'N' | b'Q' => 7,
        b'K' | b'R' => 8,
        b'H' => 9,
        _ => return None,
    })
}

#[inline]
fn safe_blosum62(a: u8, b: u8) -> i32 {
    let ua = a.to_ascii_uppercase();
    let ub = b.to_ascii_uppercase();
    let valid = |c: u8| {
        matches!(
            c,
            b'A'
                | b'R'
                | b'N'
                | b'D'
                | b'C'
                | b'Q'
                | b'E'
                | b'G'
                | b'H'
                | b'I'
                | b'L'
                | b'K'
                | b'M'
                | b'F'
                | b'P'
                | b'S'
                | b'T'
                | b'W'
                | b'Y'
                | b'V'
        )
    };
    if valid(ua) && valid(ub) {
        blosum62(ua, ub)
    } else if ua == ub {
        1
    } else {
        -2
    }
}

fn encode_murphy10_word(slice: &[u8]) -> Option<u32> {
    let mut code = 0u32;
    for &b in slice {
        code = code * 10 + murphy10_code(b)?;
    }
    Some(code)
}

fn shannon_aa_entropy(seq: &[u8]) -> f64 {
    if seq.is_empty() {
        return 0.0;
    }
    let mut counts = [0u32; 26];
    let mut total = 0u32;
    for &b in seq {
        let u = b.to_ascii_uppercase();
        if u.is_ascii_uppercase() {
            counts[(u - b'A') as usize] += 1;
            total += 1;
        }
    }
    if total == 0 {
        return 0.0;
    }
    let denom = total as f64;
    let mut h = 0.0;
    for &c in &counts {
        if c > 0 {
            let p = c as f64 / denom;
            h -= p * p.log2();
        }
    }
    (h * 1000.0).round() / 1000.0
}

/// Search a protein query (including `10,000+ aa` giant proteins) against a multi-protein
/// database using Murphy-10 reduced-alphabet seeding, two-hit diagonal filtering, X-drop
/// `bio::scores::blosum62` extension, and Karlin-Altschul gapped E-value statistics.
pub fn search_proteome_blosum62_hsps(
    query_protein: &str,
    targets: &[ProteomeTargetRecord],
    word_len: usize,
    evalue_cutoff: f64,
) -> ProteomeHomologySearchReport {
    let clean_q = clean_alpha_sequence(query_protein);
    let q_bytes = clean_q.as_bytes();
    let q_len = q_bytes.len();
    let w = word_len.clamp(3, 5);

    let db_total_aa: usize = targets
        .iter()
        .map(|t| clean_alpha_sequence(&t.sequence).len())
        .sum();

    if q_len < w || targets.is_empty() || db_total_aa == 0 {
        return ProteomeHomologySearchReport {
            query_length_aa: q_len,
            database_sequences: targets.len(),
            database_total_residues: db_total_aa,
            reduced_word_length: w,
            hits: Vec::new(),
        };
    }

    // Build Murphy-10 k-mer lookup table on the query protein
    let mut q_index: FxHashMap<u32, Vec<usize>> = FxHashMap::default();
    for qi in 0..=(q_len - w) {
        if let Some(code) = encode_murphy10_word(&q_bytes[qi..qi + w]) {
            let bucket = q_index.entry(code).or_default();
            if bucket.len() < 128 {
                bucket.push(qi);
            }
        }
    }

    // Standard gapped BLOSUM62 (gap open 11, extend 1) Karlin-Altschul parameters (Altschul & Gish 1996)
    let lambda = 0.267_f64;
    let kappa = 0.041_f64;
    let ln2 = std::f64::consts::LN_2;
    let eff_m = (q_len as f64).max(15.0);
    let eff_n = (db_total_aa as f64).max(15.0);
    let x_drop: i32 = 22;

    let mut hits = Vec::new();

    for target in targets {
        let clean_t = clean_alpha_sequence(&target.sequence);
        let t_bytes = clean_t.as_bytes();
        let t_len = t_bytes.len();
        if t_len < w {
            continue;
        }

        // Diagonal state: diag -> (last_ti, best_covered_end_ti)
        let mut diag_tracker: FxHashMap<isize, (usize, usize)> = FxHashMap::default();
        let mut best_target_hsp: Option<ProteomeBlosumHspHit> = None;

        for ti in 0..=(t_len - w) {
            let Some(code) = encode_murphy10_word(&t_bytes[ti..ti + w]) else {
                continue;
            };
            let Some(q_positions) = q_index.get(&code) else {
                continue;
            };

            for &qi in q_positions {
                let diag = (ti as isize) - (qi as isize);
                let trigger_ext = if let Some(&(last_ti, cov_end)) = diag_tracker.get(&diag) {
                    if ti < cov_end {
                        false
                    } else {
                        let step = ti.saturating_sub(last_ti);
                        // Two-hit rule on short/medium proteins, or exact k-mer confirmation
                        (step >= w && step <= 40) || q_bytes[qi..qi + w] == t_bytes[ti..ti + w]
                    }
                } else {
                    q_bytes[qi..qi + w] == t_bytes[ti..ti + w] || q_len < 60 || t_len < 60
                };

                let prev_cov = diag_tracker.get(&diag).map(|x| x.1).unwrap_or(0);
                diag_tracker.insert(diag, (ti, prev_cov));

                if !trigger_ext {
                    continue;
                }

                // Bidirectional X-drop ungapped BLOSUM62 HSP extension
                let seed_score: i32 = (0..w)
                    .map(|off| safe_blosum62(q_bytes[qi + off], t_bytes[ti + off]))
                    .sum();
                if seed_score <= 0 {
                    continue;
                }

                // Extend left
                let mut cur = seed_score;
                let mut best_left_score = seed_score;
                let mut q_left = qi;
                let mut t_left = ti;
                let mut ql = qi;
                let mut tl = ti;
                while ql > 0 && tl > 0 {
                    ql -= 1;
                    tl -= 1;
                    cur += safe_blosum62(q_bytes[ql], t_bytes[tl]);
                    if cur > best_left_score {
                        best_left_score = cur;
                        q_left = ql;
                        t_left = tl;
                    } else if best_left_score - cur >= x_drop {
                        break;
                    }
                }

                // Extend right
                cur = best_left_score;
                let mut best_total_score = best_left_score;
                let mut q_right = qi + w;
                let mut t_right = ti + w;
                let mut qr = qi + w;
                let mut tr = ti + w;
                while qr < q_len && tr < t_len {
                    cur += safe_blosum62(q_bytes[qr], t_bytes[tr]);
                    qr += 1;
                    tr += 1;
                    if cur > best_total_score {
                        best_total_score = cur;
                        q_right = qr;
                        t_right = tr;
                    } else if best_total_score - cur >= x_drop {
                        break;
                    }
                }

                diag_tracker.insert(diag, (ti, t_right));

                let bit_score = ((lambda * (best_total_score as f64) - kappa.ln()) / ln2).max(0.0);
                let e_val = eff_m * eff_n * (-bit_score * ln2).exp();
                if e_val > evalue_cutoff || best_total_score < 18 {
                    continue;
                }

                let is_better = best_target_hsp
                    .as_ref()
                    .map(|prev| best_total_score > prev.raw_blosum62_score)
                    .unwrap_or(true);
                if is_better {
                    let q_seg = &q_bytes[q_left..q_right];
                    let t_seg = &t_bytes[t_left..t_right];
                    let aln_len = q_seg.len().min(t_seg.len()).max(1);
                    let mut ident = 0usize;
                    let mut pos_sim = 0usize;
                    let mut midline = String::with_capacity(aln_len.min(180));
                    for idx in 0..aln_len {
                        let qa = q_seg[idx].to_ascii_uppercase();
                        let ta = t_seg[idx].to_ascii_uppercase();
                        let sc = safe_blosum62(qa, ta);
                        if qa == ta {
                            ident += 1;
                            pos_sim += 1;
                            if idx < 180 {
                                midline.push(qa as char);
                            }
                        } else if sc > 0 {
                            pos_sim += 1;
                            if idx < 180 {
                                midline.push('+');
                            }
                        } else if idx < 180 {
                            midline.push(' ');
                        }
                    }

                    best_target_hsp = Some(ProteomeBlosumHspHit {
                        target_id: target.id.clone(),
                        target_name: target.name.clone(),
                        target_length_aa: t_len,
                        query_start_aa: q_left + 1,
                        query_end_aa: q_right,
                        target_start_aa: t_left + 1,
                        target_end_aa: t_right,
                        alignment_length_aa: aln_len,
                        identical_aa: ident,
                        positive_similar_aa: pos_sim,
                        identity_pct: ((ident as f64 / aln_len as f64) * 1000.0).round() / 10.0,
                        positives_pct: ((pos_sim as f64 / aln_len as f64) * 1000.0).round() / 10.0,
                        raw_blosum62_score: best_total_score,
                        bit_score: (bit_score * 10.0).round() / 10.0,
                        e_value: e_val,
                        query_complexity_entropy: shannon_aa_entropy(q_seg),
                        aligned_query: String::from_utf8_lossy(&q_seg[..aln_len.min(180)])
                            .into_owned(),
                        midline,
                        aligned_target: String::from_utf8_lossy(&t_seg[..aln_len.min(180)])
                            .into_owned(),
                    });
                }
            }
        }

        if let Some(hit) = best_target_hsp {
            hits.push(hit);
        }
    }

    hits.sort_unstable_by(|a, b| {
        b.bit_score
            .partial_cmp(&a.bit_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    ProteomeHomologySearchReport {
        query_length_aa: q_len,
        database_sequences: targets.len(),
        database_total_residues: db_total_aa,
        reduced_word_length: w,
        hits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use molbiocraft_core::reverse_complement_iupac;

    /// BG-01M6S1C1: past the length cap each genome is compared up to the cap, the result names
    /// both lengths, and no chain reaches past the compared bases; the anchor cap stops the
    /// seeding at a query base it names. Shown with small caps on short genomes, which take the
    /// same path as the 12 Mb and 2,000,000-anchor caps.
    #[test]
    fn compares_only_up_to_the_caps_and_says_so() {
        let mut s = 0x2468_ace0_1357_9bdf_u64;
        let genome: String = (0..30_000)
            .map(|_| {
                s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                ['A', 'C', 'G', 'T'][((s >> 62) & 3) as usize]
            })
            .collect();
        let query = format!("{}{}", &genome[..27_000], "ACGT".repeat(1_000));

        let capped = align_large_genomes_minimizer_chain_within(&genome, &query, 8, 13, 64, 20_000, 2_000_000);
        assert_eq!((capped.target_length_bp, capped.target_compared_bp), (30_000, 20_000));
        assert_eq!((capped.query_length_bp, capped.query_compared_bp), (31_000, 20_000));
        assert!(!capped.anchor_cap_reached);
        assert!(capped.chains.iter().all(|c| c.target_end_bp <= 20_000 && c.query_end_bp <= 20_000), "{:?}", capped.chains);
        assert!(capped.target_covered_pct > 99.0, "coverage is of the compared bases: {}", capped.target_covered_pct);
        assert_eq!(
            capped.warnings,
            [
                "Minimizer chaining compared only the first 20,000 bp of the 30,000-bp target; target bases past 20,000 are not chained.",
                "Minimizer chaining compared only the first 20,000 bp of the 31,000-bp query; query bases past 20,000 are not chained.",
            ]
        );
        // the same genomes under the real caps are compared whole
        let whole = align_large_genomes_minimizer_chain(&genome, &query, 8, 13, 64);
        assert_eq!((whole.target_compared_bp, whole.query_compared_bp), (30_000, 31_000));
        assert!(whole.warnings.is_empty(), "{:?}", whole.warnings);

        // 1,000 anchors: a genome against itself seeds one anchor per minimizer, in query order,
        // so the seeding stops at the 1,001st query minimizer
        let seeded = align_large_genomes_minimizer_chain_within(&genome, &genome, 8, 13, 64, 12_000_000, 1_000);
        assert!(seeded.anchor_cap_reached);
        assert_eq!(seeded.raw_seed_matches, 1_000);
        let minimizers = sketch_sequence_minimizers(genome.as_bytes(), 8, 13);
        assert_eq!(seeded.query_compared_bp, minimizers[1_000].end_pos as usize, "stops before the 1,001st seed's last base");
        assert!(seeded.chains.iter().all(|c| c.query_end_bp <= seeded.query_compared_bp));
        assert!(seeded.query_covered_pct > 99.0, "{}", seeded.query_covered_pct);
        assert!(seeded.warnings[0].starts_with("Seed anchor cap reached: the chainer stopped at 1,000 seed anchors, so it compared only query bases 1-"), "{:?}", seeded.warnings);
    }

    /// The base's predecessor walk, verbatim: every earlier anchor in sorted order, back to
    /// 25 kb on the target, weighing up to 64 candidates and no other bound.
    fn exhaustive_chain_scores(anchors: &[SeedAnchor], k: usize) -> (Vec<i64>, Vec<usize>) {
        let (n, k_i64) = (anchors.len(), k as i64);
        let (mut f_score, mut parent) = (vec![k_i64; n], vec![usize::MAX; n]);
        for i in 0..n {
            let ai = anchors[i];
            let (mut best_f, mut best_p, mut checked) = (k_i64, usize::MAX, 0usize);
            let mut j = i;
            while j > 0 && checked < 64 {
                j -= 1;
                let aj = anchors[j];
                if aj.strand != ai.strand {
                    break;
                }
                let dx = ai.target_pos.saturating_sub(aj.target_pos);
                if dx > 25_000 {
                    break;
                }
                if ai.query_diag_pos <= aj.query_diag_pos || dx == 0 {
                    continue;
                }
                let dy = ai.query_diag_pos - aj.query_diag_pos;
                if dy > 25_000 {
                    continue;
                }
                checked += 1;
                let alpha = dx.min(dy).min(k as u32) as i64;
                let gap_diff = dx.abs_diff(dy) as f64;
                let beta = if gap_diff == 0.0 { 0 } else { (0.01 * (k as f64) * gap_diff + 0.5 * gap_diff.log2()).round() as i64 };
                let cand = f_score[j] + alpha - beta;
                if cand > best_f {
                    best_f = cand;
                    best_p = j;
                }
            }
            f_score[i] = best_f;
            parent[i] = best_p;
        }
        (f_score, parent)
    }

    /// BG-01M6S1C1 round 2: the predecessor search has no bound beyond the 64 candidates weighed
    /// and the 25 kb reach. Filing anchors by diagonal band only skips anchors that cannot be
    /// candidates, so every score and predecessor equals the exhaustive walk's: on co-linear
    /// chains with jumps over gaps, chance anchors on both strands, stacks of 300 anchors at one
    /// target position (a tandem array's copies) and a dense box (a satellite), with diagonals on
    /// both sides of the band edges. Round 1's 256-anchor bound differs on the stacks.
    #[test]
    fn predecessor_search_weighs_what_the_exhaustive_walk_weighs() {
        let mut s = 0x0c4a_17ed_u64;
        let mut next = move |m: u64| {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (s >> 33) % m
        };
        let mut anchors = Vec::new();
        let mut push = |strand: i8, t: u64, q: u64| {
            anchors.push(SeedAnchor { strand, target_pos: t as u32, query_diag_pos: q as u32, raw_query_pos: q as u32 });
        };
        // co-linear chains with jitter and the odd jump across a gap
        for _ in 0..40 {
            let strand = if next(2) == 0 { 1 } else { -1 };
            let (mut t, mut q) = (next(400_000), next(400_000));
            for _ in 0..next(400) + 50 {
                let dt = 1 + next(9);
                t += dt;
                q = (q + dt + next(5)).saturating_sub(2);
                if next(100) == 0 {
                    t += next(3_000);
                }
                push(strand, t, q);
            }
        }
        // chance anchors on both strands
        for _ in 0..4_000 {
            push(if next(2) == 0 { 1 } else { -1 }, next(420_000), next(420_000));
        }
        // stacks: 300 copies, 3 kb apart on the query, at each of 60 target positions
        for p in 0..60 {
            for c in 0..300 {
                push(1, 500_000 + p * 5, 450_000 + c * 3_000 + p * 5);
            }
        }
        // and 300 copies 50 bp apart, all in one band: 300 anchors at a target position before
        // the one that extends a copy, so a walk bounded at 256 visits finds none
        for p in 0..20 {
            for c in 0..300 {
                push(1, 600_000 + p * 5, 650_000 + c * 50 + p * 5);
            }
        }
        // a dense box: a satellite's anchors on many diagonals
        for _ in 0..6_000 {
            push(1, 100_000 + next(40_000), 200_000 + next(40_000));
        }
        anchors.sort_unstable_by_key(|a| (a.strand, a.target_pos, a.query_diag_pos));
        for k in [13, 19] {
            let (f, p) = chain_anchor_scores(&anchors, k);
            let (ef, ep) = exhaustive_chain_scores(&anchors, k);
            let differ = (0..anchors.len()).filter(|&i| f[i] != ef[i] || p[i] != ep[i]).count();
            assert_eq!(differ, 0, "k = {k}: {differ} of {} anchors differ from the exhaustive walk", anchors.len());
        }
    }

    /// The anchor count a chain needs, as `chance_chain_anchors` derives it: the numbers its
    /// documentation gives.
    #[test]
    fn chance_chain_anchors_grows_with_the_genomes_compared() {
        let uniform = |t: usize, q: usize| chance_chain_anchors(t, q, 0.25, 8, 13);
        assert_eq!(
            [uniform(120_000, 120_000), uniform(1_000_000, 1_000_000), uniform(5_000_000, 5_000_000), uniform(12_000_000, 12_000_000)],
            [6, 8, 10, 10]
        );
        // a 25%-GC pair agrees by chance at 2 (0.375^2) + 2 (0.125^2) = 0.3125 a base
        assert_eq!(chance_chain_anchors(1_000_000, 1_000_000, 0.3125, 8, 13), 20);
        // a short k: p is taken as 0.5
        assert_eq!(chance_chain_anchors(1_000_000, 1_000_000, 0.25, 8, 9), 58);
        // genomes too short to hold a chance anchor pair: 2
        assert_eq!(chance_chain_anchors(200, 200, 0.25, 8, 13), 2);
        // the widest shift one anchor's gain pays for at k = 13
        assert_eq!((1..).take_while(|&g: &u32| chain_gap_cost(g, 0, 13) < 13).last(), Some(72));
    }

    #[test]
    fn large_genome_minimizer_chaining_detects_colinear_and_inverted_synteny() {
        // Synthesize a deterministic non-repetitive 12,000 bp bacterial segment using SplitMix-like PRNG
        let bases = [b'A', b'C', b'G', b'T'];
        let mut s = 0x9E37_79B9_7F4A_7C15_u64;
        let mut target_bytes = Vec::with_capacity(12_000);
        for _ in 0..12_000 {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            target_bytes.push(bases[((s >> 62) & 3) as usize]);
        }
        let target_genome = String::from_utf8(target_bytes).unwrap();

        // Build query genome with 0..5000 colinear, 5000..9000 INVERTED, 9000..12000 colinear
        let inverted_mid = reverse_complement_iupac(&target_genome[5000..9000], false);
        let query_genome = format!(
            "{}{}{}",
            &target_genome[0..5000],
            inverted_mid,
            &target_genome[9000..12000]
        );

        let report = align_large_genomes_minimizer_chain(&target_genome, &query_genome, 10, 15, 50);
        assert!(report.target_covered_pct > 90.0);
        assert!(report.query_covered_pct > 90.0);
        assert!(report.inversion_chains >= 1);
        assert!(report.chains.iter().any(|c| c.structural_event == "inversion" && c.strand == -1));
        assert!(report.chains.iter().any(|c| c.structural_event == "colinear" && c.strand == 1));
    }

    #[test]
    fn proteome_murphy10_blosum62_hsp_search_recovers_distant_homologs() {
        let egfp = "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK";
        // Divergent fluorescent homolog (~68% identity, conservative V/I, L/M, K/R, E/D substitutions)
        let mcherry_like = "MVSKGEEDNMAIIKEFMRFKVHMEGSVNGHEFEIEGEGEGRPYEGTQTAKLKVTKGGPLPFAWDILSPQFMYGSKAYVKHPADIPDYLKLSFPEGFKWERVMNFEDGGVVTVTQDSSLQDGEFIYKVKLRGTNFPSDGPVMQKKTMGWEASSERMYPEDGALKGEIKQRLKLKDGGHYDAEVKTTYKAKKPVQLPGAYNVNIKLDITSHNEDYTIVEQYERAEGRHSTGGMDELYK";
        let unrelated = "MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAGVWPAAVRESVPSLL";

        let targets = vec![
            ProteomeTargetRecord {
                id: "p1".into(),
                name: "eGFP_WildType".into(),
                sequence: egfp.into(),
            },
            ProteomeTargetRecord {
                id: "p2".into(),
                name: "mCherry_Divergent_FP".into(),
                sequence: mcherry_like.into(),
            },
            ProteomeTargetRecord {
                id: "p3".into(),
                name: "LacI_Unrelated".into(),
                sequence: unrelated.into(),
            },
        ];

        let report = search_proteome_blosum62_hsps(egfp, &targets, 3, 1e-3);
        assert!(report.hits.len() >= 2);
        assert_eq!(report.hits[0].target_name, "eGFP_WildType");
        assert_eq!(report.hits[0].identity_pct, 100.0);
        assert_eq!(report.hits[1].target_name, "mCherry_Divergent_FP");
        assert!(report.hits[1].positives_pct > report.hits[1].identity_pct);
        assert!(report.hits[1].e_value < 1e-4);
    }
}
