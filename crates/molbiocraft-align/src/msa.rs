// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Progressive & Iterative Multiple Sequence Alignment (MSA) + Consensus + Shannon Conservation
//! + Neighbor-Joining / UPGMA Newick Guide Trees powered by `rust-bio`.

use crate::pairwise::{align_pairwise_gotoh, looks_like_protein_sequence, PairwiseMode};
use molbiocraft_core::{clean_alpha_sequence, format_thousands};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsaInputDoc {
    pub id: String,
    pub name: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsaRow {
    pub id: String,
    pub name: String,
    pub aligned_seq: String,
    pub identity_to_consensus_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsaAlignmentResult {
    pub rows: Vec<MsaRow>,
    pub consensus: String,
    pub conservation: Vec<f64>,
    pub shannon_entropy_bits: Vec<f64>,
    pub newick_tree: String,
    pub mean_pairwise_identity_pct: f64,
    pub identical_sites_pct: f64,
    /// What the alignment left out of its input (D0005), one plain sentence per event: the residue
    /// cap cutting one or more sequences. Always serialised, as an empty list when every input was
    /// aligned whole.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Fast 5-mer Jaccard similarity between two sequences for center-star / guide-tree ordering.
fn kmer_similarity_fast(a: &[u8], b: &[u8], k: usize) -> f64 {
    if a.len() < k || b.len() < k {
        return 0.0;
    }
    let mut set_a: FxHashMap<&[u8], u16> = FxHashMap::default();
    for w in a.windows(k).step_by(2) {
        *set_a.entry(w).or_insert(0) += 1;
    }
    let mut shared = 0usize;
    let mut total_b = 0usize;
    for w in b.windows(k).step_by(2) {
        total_b += 1;
        if set_a.contains_key(w) {
            shared += 1;
        }
    }
    let denom = (set_a.len() + total_b).saturating_sub(shared).max(1);
    shared as f64 / denom as f64
}

/// Empty MSA result used for empty inputs.
fn empty_msa_result() -> MsaAlignmentResult {
    MsaAlignmentResult {
        rows: Vec::new(),
        consensus: String::new(),
        conservation: Vec::new(),
        shannon_entropy_bits: Vec::new(),
        newick_tree: "();".to_string(),
        mean_pairwise_identity_pct: 0.0,
        identical_sites_pct: 0.0,
        warnings: Vec::new(),
    }
}

/// The warning owed when the residue cap of [`clean_msa_inputs`] cut any input (D0005), naming the
/// cap and each cut sequence with its whole length; none when every input was aligned whole.
///
/// Every preset aligns all the residues it is given, so a row holding fewer residues than its
/// cleaned input was cut at the cap, and the cap is the residue count of a cut row. Reading it off
/// the rows lets every route through [`finalize_msa`] report the cut without being told the cap.
fn truncation_warnings(docs: &[MsaInputDoc], rows: &[Vec<u8>]) -> Vec<String> {
    let mut cap = 0usize;
    let mut cut: Vec<String> = Vec::new();
    for (d, row) in docs.iter().zip(rows) {
        let whole = clean_alpha_sequence(&d.sequence).len();
        let aligned = row.iter().filter(|&&b| b != b'-').count();
        if aligned < whole {
            cap = cap.max(aligned);
            let name = if d.name.trim().is_empty() { &d.id } else { &d.name };
            cut.push(format!("{name} ({} residues)", format_thousands(whole)));
        }
    }
    if cut.is_empty() {
        return Vec::new();
    }
    let cap = format_thousands(cap);
    vec![format!(
        "MSA input truncated to the length cap of {cap} residues: {}. Only the first {cap} residues of each were aligned.",
        cut.join(", ")
    )]
}

/// Guide-tree builder attached to a finished alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MsaTreeBuilder {
    NeighborJoining,
    Upgma,
}

/// Cleans every input (alphabetic residues, upper case) and applies the residue cap: `max_seq_len`
/// residues, at most 6,000 (1,600 when `max_seq_len` is 0). A cut input is named in the result's
/// `warnings` by [`finalize_msa`].
pub(crate) fn clean_msa_inputs(docs: &[MsaInputDoc], max_seq_len: usize) -> Vec<String> {
    let cap = if max_seq_len == 0 {
        1600
    } else {
        max_seq_len.min(6000)
    };
    docs.iter()
        .map(|d| {
            let s = clean_alpha_sequence(&d.sequence);
            if s.len() > cap {
                s[..cap].to_string()
            } else {
                s
            }
        })
        .collect()
}

/// Gotoh affine-gap parameters used to align each member against the star centre.
/// Protein uses BLOSUM62 with BLAST-like gap costs (open 10 + extend 1 per residue); nucleotides
/// use +2 / -1 IUPAC-aware scoring with open 4 + extend 1.
fn star_gap_costs(is_protein: bool) -> (i32, i32) {
    if is_protein {
        (-10, -1)
    } else {
        (-4, -1)
    }
}

/// Center-star merge: aligns every sequence globally to `center` and merges the pairwise
/// alignments so that insertions in any member widen the shared profile. When `center_member`
/// is `Some(i)`, `seqs[i]` *is* the centre and is copied verbatim; otherwise the centre is an
/// external backbone (e.g. a consensus) that does not appear in the output.
///
/// Every residue of every input is preserved, in order. Columns that end up gap-only are removed.
pub(crate) fn center_star_rows(
    center: &str,
    seqs: &[String],
    center_member: Option<usize>,
    is_protein: bool,
) -> Vec<Vec<u8>> {
    let n = seqs.len();
    let center_bytes = center.as_bytes();
    let center_len = center_bytes.len();
    let (gap_open, gap_extend) = star_gap_costs(is_protein);
    let pw_cap = seqs
        .iter()
        .map(|s| s.len())
        .chain(std::iter::once(center_len))
        .max()
        .unwrap_or(0)
        .max(1);

    let mut max_ins_before = vec![0usize; center_len + 1];
    let mut per_seq_insertions: Vec<Vec<Vec<u8>>> = vec![vec![Vec::new(); center_len + 1]; n];
    let mut per_seq_at_center: Vec<Vec<u8>> = vec![vec![b'-'; center_len]; n];

    for idx in 0..n {
        if Some(idx) == center_member {
            per_seq_at_center[idx].copy_from_slice(center_bytes);
            continue;
        }
        if seqs[idx].is_empty() {
            continue;
        }
        if center_len == 0 {
            per_seq_insertions[idx][0].extend_from_slice(seqs[idx].as_bytes());
        } else {
            let pw = align_pairwise_gotoh(
                center,
                &seqs[idx],
                PairwiseMode::Global,
                None,
                2,
                -1,
                gap_open,
                gap_extend,
                pw_cap,
            );
            let a_center = pw.aligned_seq1.as_bytes();
            let a_other = pw.aligned_seq2.as_bytes();
            let mut c_pos = 0usize;
            for col in 0..a_center.len().min(a_other.len()) {
                let bc = a_center[col];
                let bo = a_other[col];
                if bc == b'-' {
                    if bo != b'-' {
                        per_seq_insertions[idx][c_pos.min(center_len)].push(bo);
                    }
                } else {
                    if c_pos < center_len {
                        per_seq_at_center[idx][c_pos] = bo;
                    }
                    c_pos += 1;
                }
            }
        }
        for slot in 0..=center_len {
            max_ins_before[slot] = max_ins_before[slot].max(per_seq_insertions[idx][slot].len());
        }
    }

    let total_cols: usize = center_len + max_ins_before.iter().sum::<usize>();
    let mut matrix: Vec<Vec<u8>> = vec![Vec::with_capacity(total_cols); n];
    for idx in 0..n {
        for slot in 0..=center_len {
            let width = max_ins_before[slot];
            if width > 0 {
                let ins = &per_seq_insertions[idx][slot];
                let row = &mut matrix[idx];
                row.extend_from_slice(ins);
                let padded = row.len() + (width - ins.len());
                row.resize(padded, b'-');
            }
            if slot < center_len {
                matrix[idx].push(per_seq_at_center[idx][slot]);
            }
        }
    }
    drop_gap_only_columns(matrix)
}

/// Removes columns in which every row is a gap (they carry no information).
pub(crate) fn drop_gap_only_columns(matrix: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let cols = matrix.iter().map(|r| r.len()).max().unwrap_or(0);
    let keep: Vec<bool> = (0..cols)
        .map(|c| matrix.iter().any(|r| r.get(c).copied().unwrap_or(b'-') != b'-'))
        .collect();
    if keep.iter().all(|&k| k) && matrix.iter().all(|r| r.len() == cols) {
        return matrix;
    }
    matrix
        .into_iter()
        .map(|r| {
            (0..cols)
                .filter(|&c| keep[c])
                .map(|c| r.get(c).copied().unwrap_or(b'-'))
                .collect()
        })
        .collect()
}

/// Sum-of-pairs objective (+2 identical, -1 substitution, -1 residue/gap, 0 gap/gap) used to
/// decide whether a refinement pass actually improved the alignment.
pub(crate) fn sum_of_pairs_score(matrix: &[Vec<u8>]) -> i64 {
    let n = matrix.len() as i64;
    let cols = matrix.first().map(|r| r.len()).unwrap_or(0);
    let mut total = 0i64;
    for c in 0..cols {
        let mut counts = [0i64; 128];
        let mut residues = 0i64;
        for row in matrix {
            let b = row.get(c).copied().unwrap_or(b'-');
            if b != b'-' {
                counts[(b.to_ascii_uppercase() as usize) & 127] += 1;
                residues += 1;
            }
        }
        let identical: i64 = counts.iter().map(|&k| k * (k - 1) / 2).sum();
        let residue_pairs = residues * (residues - 1) / 2;
        total += 2 * identical - (residue_pairs - identical) - residues * (n - residues);
    }
    total
}

/// Public sum-of-pairs score for validation tooling and tests.
pub fn sum_of_pairs_score_public(matrix: &[Vec<u8>]) -> i64 {
    sum_of_pairs_score(matrix)
}

/// Picks the member with the highest summed k-mer similarity to all others (Gusfield star centre).
pub(crate) fn choose_star_center(cleaned: &[String], is_protein: bool) -> usize {
    let n = cleaned.len();
    let k = if is_protein { 3 } else { 5 };
    let mut center_idx = 0usize;
    let mut best_sim_sum = -1.0f64;
    for i in 0..n {
        let mut sim_sum = 0.0;
        for j in 0..n {
            if i != j {
                sim_sum += kmer_similarity_fast(cleaned[i].as_bytes(), cleaned[j].as_bytes(), k);
            }
        }
        if sim_sum > best_sim_sum {
            best_sim_sum = sim_sum;
            center_idx = i;
        }
    }
    center_idx
}

/// Builds the public result (consensus, conservation, entropy, identity statistics, guide tree and
/// the truncation warning) from finished aligned rows. All statistics are always derived from the
/// rows returned.
pub(crate) fn finalize_msa(
    docs: &[MsaInputDoc],
    aligned_matrix: Vec<Vec<u8>>,
    tree: MsaTreeBuilder,
) -> MsaAlignmentResult {
    let n = docs.len().min(aligned_matrix.len());
    if n == 0 {
        return empty_msa_result();
    }
    let aligned_matrix = drop_gap_only_columns(aligned_matrix);
    let warnings = truncation_warnings(&docs[..n], &aligned_matrix[..n]);
    let col_count = aligned_matrix.first().map(|r| r.len()).unwrap_or(0);
    let mut consensus_bytes = Vec::with_capacity(col_count);
    let mut conservation = Vec::with_capacity(col_count);
    let mut entropy_bits = Vec::with_capacity(col_count);

    for col in 0..col_count {
        let mut counts = [0u32; 128];
        let mut best_b = b'-';
        let mut best_c = 0u32;
        for row in aligned_matrix.iter().take(n) {
            let b = row[col].to_ascii_uppercase();
            let slot = (b as usize) & 127;
            counts[slot] += 1;
            // Deterministic tie-break: higher count, then alphabetical residue.
            if b != b'-' && (counts[slot] > best_c || (counts[slot] == best_c && b < best_b)) {
                best_c = counts[slot];
                best_b = b;
            }
        }
        consensus_bytes.push(best_b);
        conservation.push(((best_c as f64 / n as f64) * 100.0).round() / 100.0);
        // Shannon entropy over residue states and the gap state.
        let mut h = 0.0f64;
        for &cnt in counts.iter() {
            if cnt > 0 {
                let p = cnt as f64 / n as f64;
                h -= p * p.log2();
            }
        }
        entropy_bits.push(((h * 1000.0).round() / 1000.0).max(0.0));
    }

    let aligned_strings: Vec<String> = aligned_matrix
        .iter()
        .take(n)
        .map(|r| String::from_utf8_lossy(r).into_owned())
        .collect();

    let rows: Vec<MsaRow> = docs
        .iter()
        .take(n)
        .enumerate()
        .map(|(idx, d)| {
            let row_bytes = &aligned_matrix[idx];
            let mut id_matches = 0usize;
            let mut residues = 0usize;
            for c in 0..col_count {
                let b = row_bytes[c].to_ascii_uppercase();
                if b != b'-' {
                    residues += 1;
                    if b == consensus_bytes[c] {
                        id_matches += 1;
                    }
                }
            }
            // Identity of this member's residues to the consensus (terminal gaps are not mismatches).
            let pct = ((id_matches as f64 / residues.max(1) as f64) * 1000.0).round() / 10.0;
            MsaRow {
                id: d.id.clone(),
                name: d.name.clone(),
                aligned_seq: aligned_strings[idx].clone(),
                identity_to_consensus_pct: pct,
            }
        })
        .collect();

    let names: Vec<String> = docs.iter().take(n).map(|d| d.name.clone()).collect();
    let newick_tree = match tree {
        MsaTreeBuilder::NeighborJoining => build_neighbor_joining_newick(&names, &aligned_strings),
        MsaTreeBuilder::Upgma => build_upgma_newick(&names, &aligned_strings),
    };

    // Pairwise identity: pooled over all pairs, comparing only the region
    // where both sequences are present (end gaps ignored); gap/gap skipped, gap/residue differs.
    let spans: Vec<(usize, usize)> = aligned_matrix
        .iter()
        .take(n)
        .map(|r| {
            let first = r.iter().position(|&b| b != b'-').unwrap_or(r.len());
            let last = r.iter().rposition(|&b| b != b'-').unwrap_or(0);
            (first, last)
        })
        .collect();
    let mut pw_same = 0usize;
    let mut pw_compared = 0usize;
    for i in 0..n {
        for j in (i + 1)..n {
            let lo = spans[i].0.max(spans[j].0);
            let hi = spans[i].1.min(spans[j].1);
            if lo > hi {
                continue;
            }
            // Half-open upper bound: with col_count == 0 (all-empty input) the
            // old inclusive range 0..=0 indexed an empty row and trapped.
            for c in lo..(hi + 1).min(col_count) {
                let a = aligned_matrix[i][c].to_ascii_uppercase();
                let b = aligned_matrix[j][c].to_ascii_uppercase();
                if a == b'-' && b == b'-' {
                    continue;
                }
                pw_compared += 1;
                if a == b {
                    pw_same += 1;
                }
            }
        }
    }
    // Identical sites: every sequence spanning the column carries the same residue.
    let identical_cols = (0..col_count)
        .filter(|&c| {
            let mut residue = 0u8;
            let mut spanning = 0usize;
            for (r, row) in aligned_matrix.iter().take(n).enumerate() {
                if c < spans[r].0 || c > spans[r].1 {
                    continue;
                }
                let b = row[c].to_ascii_uppercase();
                if b == b'-' || (residue != 0 && b != residue) {
                    return false;
                }
                residue = b;
                spanning += 1;
            }
            spanning > 0
        })
        .count();

    MsaAlignmentResult {
        rows,
        consensus: String::from_utf8_lossy(&consensus_bytes).into_owned(),
        conservation,
        shannon_entropy_bits: entropy_bits,
        newick_tree,
        mean_pairwise_identity_pct: if pw_compared > 0 {
            ((pw_same as f64 / pw_compared as f64) * 1000.0).round() / 10.0
        } else {
            100.0
        },
        identical_sites_pct: ((identical_cols as f64 / col_count.max(1) as f64) * 1000.0).round()
            / 10.0,
        warnings,
    }
}

/// Progressive center-star Multiple Sequence Alignment using `rust-bio` Gotoh DP.
/// Insertions in any sequence expand the global MSA profile, so no residues are dropped.
pub fn run_multiple_sequence_alignment(
    docs: &[MsaInputDoc],
    max_seq_len: usize,
) -> MsaAlignmentResult {
    run_center_star_msa(docs, max_seq_len, MsaTreeBuilder::NeighborJoining)
}

/// Center-star alignment with an explicit guide-tree builder.
pub fn run_center_star_msa(
    docs: &[MsaInputDoc],
    max_seq_len: usize,
    tree: MsaTreeBuilder,
) -> MsaAlignmentResult {
    if docs.is_empty() {
        return empty_msa_result();
    }
    let cleaned = clean_msa_inputs(docs, max_seq_len);
    let is_prot = cleaned.iter().any(|s| looks_like_protein_sequence(s));
    let center_idx = choose_star_center(&cleaned, is_prot);
    let matrix = center_star_rows(&cleaned[center_idx], &cleaned, Some(center_idx), is_prot);
    finalize_msa(docs, matrix, tree)
}

pub fn sanitize_newick_label(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "Taxon".to_string()
    } else {
        out
    }
}

fn compute_jc69_distance_matrix(aligned_seqs: &[String]) -> Vec<Vec<f64>> {
    let n = aligned_seqs.len();
    let mut dist = vec![vec![0.0f64; n]; n];
    let is_prot = aligned_seqs.iter().any(|s| looks_like_protein_sequence(s));
    for i in 0..n {
        let a = aligned_seqs[i].as_bytes();
        for j in (i + 1)..n {
            let b = aligned_seqs[j].as_bytes();
            let len = a.len().min(b.len());
            let mut diff = 0usize;
            let mut valid = 0usize;
            for k in 0..len {
                let ca = a[k];
                let cb = b[k];
                if ca == b'-' || cb == b'-' {
                    continue;
                }
                valid += 1;
                if !ca.eq_ignore_ascii_case(&cb) {
                    diff += 1;
                }
            }
            let d_val = if is_prot {
                // Kimura (1983) / Jukes-Cantor 20-state amino-acid substitution distance:
                // d = -0.95 * ln(1 - (20/19) * p), saturation threshold p < 0.95 (clamped to 0.94)
                let p = if valid > 0 {
                    (diff as f64 / valid as f64).min(0.94)
                } else {
                    0.25
                };
                (-0.95 * (1.0 - (20.0 / 19.0) * p).ln()).max(0.0005)
            } else {
                // Jukes-Cantor (1969) 4-state nucleotide substitution distance:
                // d = -0.75 * ln(1 - (4/3) * p), saturation threshold p < 0.75 (clamped to 0.74)
                let p = if valid > 0 {
                    (diff as f64 / valid as f64).min(0.74)
                } else {
                    0.25
                };
                (-0.75 * (1.0 - (4.0 / 3.0) * p).ln()).max(0.0005)
            };
            dist[i][j] = d_val;
            dist[j][i] = d_val;
        }
    }
    dist
}

/// Saitou-Nei (1987) Neighbor-Joining phylogenetic tree builder returning Newick string.
pub fn build_neighbor_joining_newick(names: &[String], aligned_seqs: &[String]) -> String {
    let n = names.len().min(aligned_seqs.len());
    if n == 0 {
        return "();".to_string();
    }
    if n == 1 {
        return format!("({}:0.0010);", sanitize_newick_label(&names[0]));
    }

    let mut labels: Vec<String> = names[..n]
        .iter()
        .map(|nm| sanitize_newick_label(nm))
        .collect();
    let mut dist = compute_jc69_distance_matrix(&aligned_seqs[..n]);
    let mut active: Vec<usize> = (0..n).collect();

    while active.len() > 2 {
        let r = active.len();
        let u: Vec<f64> = active
            .iter()
            .map(|&idx_i| active.iter().map(|&idx_j| dist[idx_i][idx_j]).sum())
            .collect();

        let mut min_q = f64::INFINITY;
        let mut best_a = 0usize;
        let mut best_b = 1usize;
        for i in 0..r {
            for j in (i + 1)..r {
                let q = ((r - 2) as f64) * dist[active[i]][active[j]] - u[i] - u[j];
                if q < min_q {
                    min_q = q;
                    best_a = i;
                    best_b = j;
                }
            }
        }

        let idx_a = active[best_a];
        let idx_b = active[best_b];
        let d_ab = dist[idx_a][idx_b];
        let limb_a = (0.5 * d_ab + (u[best_a] - u[best_b]) / (2.0 * (r - 2) as f64)).max(0.0005);
        let limb_b = (d_ab - limb_a).max(0.0005);
        labels[idx_a] = format!("({}:{limb_a:.4},{}:{limb_b:.4})", labels[idx_a], labels[idx_b]);

        for &idx_k in &active {
            if idx_k == idx_a || idx_k == idx_b {
                continue;
            }
            let d_new = (0.5 * (dist[idx_a][idx_k] + dist[idx_b][idx_k] - d_ab)).max(0.0005);
            dist[idx_a][idx_k] = d_new;
            dist[idx_k][idx_a] = d_new;
        }
        active.remove(best_b);
    }

    if active.len() == 2 {
        let d = (dist[active[0]][active[1]] * 0.5).max(0.0005);
        return format!("({}:{d:.4},{}:{d:.4});", labels[active[0]], labels[active[1]]);
    }
    format!("{};", labels[active[0]])
}

/// Sokal-Michener UPGMA ultrametric hierarchical clustering phylogenetic tree builder.
pub fn build_upgma_newick(names: &[String], aligned_seqs: &[String]) -> String {
    let n = names.len().min(aligned_seqs.len());
    if n == 0 {
        return "();".to_string();
    }
    if n == 1 {
        return format!("({}:0.0010);", sanitize_newick_label(&names[0]));
    }

    #[derive(Clone)]
    struct Cluster {
        label: String,
        height: f64,
        size: usize,
        members: Vec<usize>,
    }

    let base_dist = compute_jc69_distance_matrix(&aligned_seqs[..n]);
    let mut clusters: Vec<Cluster> = (0..n)
        .map(|i| Cluster {
            label: sanitize_newick_label(&names[i]),
            height: 0.0,
            size: 1,
            members: vec![i],
        })
        .collect();

    while clusters.len() > 1 {
        let m = clusters.len();
        let mut best_d = f64::INFINITY;
        let mut best_i = 0usize;
        let mut best_j = 1usize;

        for i in 0..m {
            for j in (i + 1)..m {
                let mut sum = 0.0;
                for &mi in &clusters[i].members {
                    for &mj in &clusters[j].members {
                        sum += base_dist[mi][mj];
                    }
                }
                let avg = sum / ((clusters[i].size * clusters[j].size) as f64);
                if avg < best_d {
                    best_d = avg;
                    best_i = i;
                    best_j = j;
                }
            }
        }

        let new_h = (best_d * 0.5).max(
            clusters[best_i]
                .height
                .max(clusters[best_j].height)
                + 0.0005,
        );
        let br_i = (new_h - clusters[best_i].height).max(0.0005);
        let br_j = (new_h - clusters[best_j].height).max(0.0005);
        let merged_label = format!(
            "({}:{br_i:.4},{}:{br_j:.4})",
            clusters[best_i].label, clusters[best_j].label
        );
        let mut merged_members = clusters[best_i].members.clone();
        merged_members.extend_from_slice(&clusters[best_j].members);
        let merged = Cluster {
            label: merged_label,
            height: new_h,
            size: clusters[best_i].size + clusters[best_j].size,
            members: merged_members,
        };
        clusters.remove(best_j);
        clusters[best_i] = merged;
    }

    format!("{};", clusters[0].label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run_multiple_sequence_alignment_with_algorithm;

    fn random_dna(n: usize, seed: u64) -> String {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize] as char
            })
            .collect()
    }

    fn doc(id: &str, name: &str, sequence: String) -> MsaInputDoc {
        MsaInputDoc { id: id.into(), name: name.into(), sequence }
    }

    fn residues(row: &MsaRow) -> String {
        row.aligned_seq.chars().filter(|&c| c != '-').collect()
    }

    /// D0005: an input longer than the residue cap is aligned on its first cap residues, and the
    /// result says so in `warnings`, naming the cap applied and each cut sequence with its whole
    /// length, on every alignment route. Inputs at the cap, under it, or whose text is longer than
    /// the cap only by spacing, digits and gaps, are not cut and not named.
    #[test]
    fn truncation_is_reported_as_a_warning() {
        let base = random_dna(120, 0x0a5e_ed01);
        // 50 residues written with position numbers, spaces, gaps and line breaks: 50 residues in
        // more than 50 characters
        let spaced: String = base[..50]
            .as_bytes()
            .chunks(10)
            .enumerate()
            .map(|(k, c)| format!("{} {}-\n", k * 10 + 1, std::str::from_utf8(c).unwrap()))
            .collect();
        assert!(spaced.len() > 50 && clean_alpha_sequence(&spaced).len() == 50, "fixture: {spaced:?}");
        let docs = vec![
            doc("a", "seqA", base[..80].to_string()),
            doc("b", "seqB", base[10..71].to_string()),
            doc("c", "atCap", base[5..55].to_string()),
            doc("d", "short", base[20..50].to_string()),
            doc("e", "spaced", spaced),
            doc("doc-6", "", base[30..115].to_string()),
        ];
        let expected = "MSA input truncated to the length cap of 50 residues: seqA (80 residues), seqB (61 residues), doc-6 (85 residues). Only the first 50 residues of each were aligned.";
        let mut routes = vec![("center-star", run_multiple_sequence_alignment(&docs, 50))];
        for algorithm in ["MAFFT", "MUSCLE", "Clustal", "POA"] {
            routes.push((algorithm, run_multiple_sequence_alignment_with_algorithm(&docs, 50, algorithm)));
        }
        for (route, r) in &routes {
            assert_eq!(r.warnings, [expected], "{route}");
            // the warning describes the cut the alignment made: each cut row holds its first 50
            // residues, every other row all of its own
            let kept: Vec<String> = r.rows.iter().map(residues).collect();
            let want = [&base[..50], &base[10..60], &base[5..55], &base[20..50], &base[..50], &base[30..80]];
            assert_eq!(kept, want, "{route}");
            // the field crosses the JSON boundary every transport serialises through
            assert_eq!(serde_json::to_value(r).unwrap()["warnings"], serde_json::json!([expected]), "{route}");
        }

        // the same inputs under a cap none of them exceeds: nothing is cut, and the JSON still
        // carries the field, as an empty list
        for r in [run_multiple_sequence_alignment(&docs, 100), run_multiple_sequence_alignment_with_algorithm(&docs, 100, "MAFFT")] {
            assert!(r.warnings.is_empty(), "{:?}", r.warnings);
            assert_eq!(serde_json::to_value(&r).unwrap()["warnings"], serde_json::json!([]));
        }

        // the warning names the cap applied, not the one asked for: 10,000 is held to 6,000, and a
        // cap of 0 means 1,600
        let long = random_dna(6_500, 0x0a5e_ed02);
        let pair = [doc("l", "long", long.clone()), doc("s", "probe", long[100..140].to_string())];
        let r = run_multiple_sequence_alignment(&pair, 10_000);
        assert_eq!(residues(&r.rows[0]), long[..6_000]);
        assert_eq!(r.warnings, ["MSA input truncated to the length cap of 6,000 residues: long (6,500 residues). Only the first 6,000 residues of each were aligned."]);
        let r = run_multiple_sequence_alignment(&pair, 0);
        assert_eq!(residues(&r.rows[0]), long[..1_600]);
        assert_eq!(r.warnings, ["MSA input truncated to the length cap of 1,600 residues: long (6,500 residues). Only the first 1,600 residues of each were aligned."]);
    }
}
