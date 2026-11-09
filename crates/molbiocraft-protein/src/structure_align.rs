// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Sequence-independent structure alignment by a TM-score search, written from the published
//! method of TM-align (Zhang & Skolnick, Nucleic Acids Res 2005) and the TM-score (Zhang &
//! Skolnick, Proteins 2004), with the search settings noted below and the fragment lengths of
//! Fr-TM-align's aligned fragment pairs (Pandit & Skolnick, BMC Bioinformatics 2008). It is a
//! re-implementation, labelled **TM-align-style**: no TM-align code is used or run.
//!
//! Two $C_\alpha$ traces are aligned without looking at their sequences:
//!
//! 1. **Initial alignments.** (a) Gapless threading: every relative offset of the two chains that
//!    overlaps at least half the shorter one, keeping the offset whose pairs superpose to the best
//!    TM-score (offsets searched best estimate first, at most 200 of them). (b) Dynamic
//!    programming on a secondary-structure match matrix (1 for the same state, 0 otherwise; gap
//!    opening -1), with each residue assigned helix, strand, turn or coil from the $C_\alpha$
//!    distances of its five-residue window (ideal helix and strand distances within a
//!    tolerance). (c) Dynamic programming (gap opening -1) on half that matrix plus half the
//!    distance score $1/(1 + (d_{ij}/d_0)^2)$ of the threading superposition. (d) Local
//!    superposition: fragments of 8 residues (12 when the shorter chain has 100 or more), one
//!    every half fragment along each chain, superposed pair by pair; B moved by the motion of each
//!    of the 24 best-fitting pairs (fewer for long chains) is aligned with A by dynamic
//!    programming on the distance score (gap opening -0.6), and the alignment scoring best is the
//!    start.
//! 2. **Refinement.** Each initial alignment is superposed by the TM-score search below, the
//!    distance score matrix of that superposition is aligned by dynamic programming (gap opening
//!    -0.6 as in the 2005 paper, and in a second pass none; extension and end gaps free), and the
//!    two steps repeat until an alignment comes round again (at most 30 rounds). Of the
//!    alignments met, the one with the best search score is the start's refined alignment.
//! 3. **Final alignment.** Each refined alignment is superposed by the full search (every seed
//!    start); its pairs within $d_8 = 1.5 L_{min}^{0.3} + 3.5$ Å of each other under that
//!    superposition are its final pairs, and their TM-score normalised by the shorter chain (with
//!    its $d_0$) its final score. The start whose final score is best wins: that score is the one
//!    reported, so adding a start can only raise it.
//! 4. **TM-score search.** For fixed pairs the superposition that maximises the TM-score is
//!    searched for heuristically (Zhang & Skolnick 2004): seed fragments of the pairs (all of
//!    them, then halves, quarters and so on down to four) are superposed by Kabsch (1976) SVD,
//!    then re-superposed on the pairs closer than a cut-off ($d_0$ clamped to 4.5-8 Å, less 1 Å
//!    after the seed and plus 1 Å after that) until the set stops changing (at most 20 rounds);
//!    the best TM-score met is the score.
//!
//! While alignments are searched (steps 1-3) the score is normalised by the shorter chain with a
//! slightly wider scale than the reported one, $d_0(L_{min}) + 0.8$ Å, and counts only pairs
//! within $d_8$. These search settings, the 1 Å margins of the cut-off and a local-superposition
//! start are not in the 2004 and 2005 papers: they are TM-align's search as it is known (the
//! round-1 data review named the wider scale and the local superposition), implemented here
//! without TM-align's code; the fragment lengths are Pandit & Skolnick's. The reported TM-scores
//! are searched on the final pairs, one normalised by chain A with $d_0(L_A)$ and one by chain B
//! with $d_0(L_B)$, every final pair counted. `aligned_length`, the alignment strings, the
//! identity and the RMSD are over the final pairs: the pairs TM-align's "Aligned length" counts
//! (pairs closer than 5 Å are a subset).

use crate::biophysics_3d::{read_superposition_input, select_chain, ChainTrace};
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

type V3 = Vector3<f64>;

/// How the alignment is made, as the report states it.
pub const TM_ALIGNMENT_METHOD: &str = "TM-align-style sequence-independent alignment (after Zhang & \
     Skolnick 2005): initial alignments from gapless threading, Cα secondary structure, their \
     combination and local fragment superposition, refined by dynamic programming on the \
     distances of the best TM-score superposition; TM-score (Zhang & Skolnick 2004) normalised \
     by each chain's length";

/// A sequence-independent alignment of two protein chains and its TM-scores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmAlignmentReport {
    /// The chain aligned from each structure: the author chain id for mmCIF (the id a PDB file
    /// shows), the chain column for PDB (a blank column reads as `A`).
    pub chain_a: String,
    pub chain_b: String,
    /// Residues with a polymer $C_\alpha$ in each chain; each TM-score is normalised by one of
    /// these.
    pub length_a: usize,
    pub length_b: usize,
    /// TM-score normalised by chain A: $\max \frac{1}{L_A}\sum_i 1/(1 + (d_i/d_{0A})^2)$ over
    /// superpositions, the sum over the aligned pairs. 1 for identical chains.
    pub tm_score_a: f64,
    /// TM-score normalised by chain B, with $L_B$ and $d_{0B}$.
    pub tm_score_b: f64,
    /// $d_0 = 1.24 (L - 15)^{1/3} - 1.8$ Å, at least 0.5, for $L$ = `length_a` and `length_b`.
    pub d0_a: f64,
    pub d0_b: f64,
    /// Aligned residue pairs: the pairs of the final alignment within
    /// $1.5 L_{min}^{0.3} + 3.5$ Å of each other on the best superposition, as TM-align counts
    /// its "Aligned length".
    pub aligned_length: usize,
    /// RMSD of the `aligned_length` $C_\alpha$ pairs after their own optimal (Kabsch)
    /// superposition, Å. This is TM-align's reported RMSD; it is not the RMSD under
    /// `transformation_matrix`, which maximises the TM-score instead.
    pub rmsd_angstrom: f64,
    /// Fraction of the aligned pairs whose two residues have the same one-letter code (a
    /// modified residue has its parent's, so `MSE` matches `MET`; two residues coded `X` count as
    /// the same).
    pub sequence_identity: f64,
    /// Each chain's whole one-letter sequence as aligned, `-` for a gap; a column without a gap
    /// is one of the aligned pairs.
    pub aligned_sequence_a: String,
    pub aligned_sequence_b: String,
    /// Row-major 4x4 homogeneous matrix `[R t; 0 0 0 1]` mapping structure **B onto A** (a point
    /// `x` of B lands at `R x + t`): the superposition `tm_score_a` is the score of.
    pub transformation_matrix: [[f64; 4]; 4],
    /// How the alignment was made, in words.
    pub method: String,
}

/// The TM-score's distance scale for a chain of `length` residues (Zhang & Skolnick 2004):
/// $d_0 = 1.24 (L - 15)^{1/3} - 1.8$ Å, floored at 0.5 Å (the formula falls below that under
/// $L = 22$, and has no positive value under $L = 15$).
pub fn tm_score_d0(length: usize) -> f64 {
    (1.24 * (length as f64 - 15.0).cbrt() - 1.8).max(0.5)
}

/// Align chain `chain_a` of structure A with chain `chain_b` of structure B (PDB or mmCIF text;
/// each the first protein chain when `None` or blank) by their $C_\alpha$ geometry alone, and
/// report the TM-score normalised by each chain.
///
/// The chains are read by the reader `align_pdb_chains_kabsch` uses, not a copy of it, so the
/// two read the same residues from either format: PDB and mmCIF alike through the full-atom
/// model, its first model only, a chain being the residues with a polymer $C_\alpha$ (an `ATOM`
/// residue, or a `HETATM` amino acid such as selenomethionine; not a calcium ion, whose atom is
/// also named `CA`, nor a `HETATM` ligand), selected by author chain id, then mmCIF label chain
/// id. A modified residue carries its parent's one-letter code (`MSE` as `M`). Errors name what
/// is missing: a structure with no $C_\alpha$ atoms or no protein chain, a named chain that is
/// not there (with the chains that are), PDB or mmCIF text that cannot be read, or a chain of
/// fewer than three residues, which has no unique superposition.
pub fn align_structures_tm(
    text_a: &str,
    text_b: &str,
    chain_a: Option<&str>,
    chain_b: Option<&str>,
) -> Result<TmAlignmentReport, String> {
    let input_a = read_superposition_input(text_a, 'A')?;
    let input_b = read_superposition_input(text_b, 'B')?;
    let a = ChainCa::of(select_chain(&input_a, chain_a, 'A')?);
    let b = ChainCa::of(select_chain(&input_b, chain_b, 'B')?);
    for (chain, which) in [(&a, 'A'), (&b, 'B')] {
        if chain.ca.len() < 3 {
            return Err(format!(
                "Structure {which}: chain {} has {} residue(s) with a Cα; a structure alignment needs at least 3",
                chain.id,
                chain.ca.len()
            ));
        }
    }

    let found = align_traces(&a.ca, &b.ca);
    let (aligned_sequence_a, aligned_sequence_b) = alignment_strings(&a.seq, &b.seq, &found.pairs);
    let identical = found.pairs.iter().filter(|&&(i, j)| a.seq[i] == b.seq[j]).count();
    let n = found.pairs.len();
    let (r, t) = (found.motion_a.rot, found.motion_a.shift);
    Ok(TmAlignmentReport {
        length_a: a.ca.len(),
        length_b: b.ca.len(),
        tm_score_a: found.tm_a,
        tm_score_b: found.tm_b,
        d0_a: tm_score_d0(a.ca.len()),
        d0_b: tm_score_d0(b.ca.len()),
        aligned_length: n,
        rmsd_angstrom: found.rmsd,
        sequence_identity: if n == 0 { 0.0 } else { identical as f64 / n as f64 },
        aligned_sequence_a,
        aligned_sequence_b,
        transformation_matrix: [
            [r[(0, 0)], r[(0, 1)], r[(0, 2)], t.x],
            [r[(1, 0)], r[(1, 1)], r[(1, 2)], t.y],
            [r[(2, 0)], r[(2, 1)], r[(2, 2)], t.z],
            [0.0, 0.0, 0.0, 1.0],
        ],
        method: TM_ALIGNMENT_METHOD.into(),
        chain_a: a.id,
        chain_b: b.id,
    })
}

// ---------------------------------------------------------------------------------------------
// The chains
// ---------------------------------------------------------------------------------------------

/// One protein chain as aligned: the chain [`read_superposition_input`] read, as the one-letter
/// code and $C_\alpha$ of each residue in chain order.
struct ChainCa {
    /// Author chain id (mmCIF) or the chain column (PDB; blank reads as `A`).
    id: String,
    seq: Vec<u8>,
    ca: Vec<V3>,
}

impl ChainCa {
    fn of(trace: &ChainTrace) -> Self {
        let (seq, ca) = trace.residues.iter().map(|r| (r.code, r.pos)).unzip();
        ChainCa { id: trace.id.clone(), seq, ca }
    }
}

// ---------------------------------------------------------------------------------------------
// Superposition
// ---------------------------------------------------------------------------------------------

/// A rigid motion `x -> rot x + shift`.
#[derive(Clone, Copy, Debug)]
struct Motion {
    rot: Matrix3<f64>,
    shift: V3,
}

impl Motion {
    fn identity() -> Self {
        Motion { rot: Matrix3::identity(), shift: V3::zeros() }
    }

    fn apply(&self, p: &V3) -> V3 {
        self.rot * p + self.shift
    }
}

/// The motion of B that best fits B's residue `j` onto A's residue `i` over `pairs` in the
/// least-squares sense: Kabsch SVD of the cross-covariance, with the reflection correction
/// ($\det(V U^T) = +1$). The identity when there are no pairs.
fn kabsch(a: &[V3], b: &[V3], pairs: &[(usize, usize)]) -> Motion {
    if pairs.is_empty() {
        return Motion::identity();
    }
    let n = pairs.len() as f64;
    let (mut ca, mut cb) = (V3::zeros(), V3::zeros());
    for &(i, j) in pairs {
        ca += a[i];
        cb += b[j];
    }
    ca /= n;
    cb /= n;
    let mut h = Matrix3::<f64>::zeros();
    for &(i, j) in pairs {
        h += (b[j] - cb) * (a[i] - ca).transpose();
    }
    let svd = h.svd(true, true);
    let rot = match (svd.u, svd.v_t) {
        (Some(u), Some(v_t)) => {
            let (v, u_t) = (v_t.transpose(), u.transpose());
            let d = if (v * u_t).determinant() < 0.0 { -1.0 } else { 1.0 };
            v * Matrix3::from_diagonal(&V3::new(1.0, 1.0, d)) * u_t
        }
        _ => Matrix3::identity(),
    };
    Motion { rot, shift: ca - rot * cb }
}

/// RMSD of `pairs` after their own optimal superposition; 0 for no pairs.
fn rmsd_after_kabsch(a: &[V3], b: &[V3], pairs: &[(usize, usize)]) -> f64 {
    if pairs.is_empty() {
        return 0.0;
    }
    let m = kabsch(a, b, pairs);
    let sum: f64 = pairs.iter().map(|&(i, j)| (a[i] - m.apply(&b[j])).norm_squared()).sum();
    (sum / pairs.len() as f64).sqrt()
}

/// Extension rounds of one seed in [`tm_superposition`].
const EXTENSION_ROUNDS: usize = 20;

/// How a TM-score is summed and searched for by [`tm_superposition`].
#[derive(Clone, Copy, Debug)]
struct Scoring {
    /// The distance scale $d_0$ of the score, Å.
    d0: f64,
    /// The length the score is normalised by.
    l_norm: usize,
    /// A pair farther apart than this adds nothing to the score (infinite: every pair adds).
    score_cut: f64,
    /// The pairs re-superposed after a seed's own superposition are those closer than
    /// `first_cut`; in each later round, those closer than `extend_cut`.
    first_cut: f64,
    extend_cut: f64,
}

/// How far the cut-offs that collect pairs for re-superposition lie inside and outside $d_0$
/// clamped to 4.5-8 Å: `first_cut` is that less this, `extend_cut` that plus this, Å.
const CUT_MARGIN: f64 = 1.0;

impl Scoring {
    /// The TM-score of a chain of `length` residues as reported: $d_0$ of that length, normalised
    /// by that length, every pair counted.
    fn for_length(length: usize) -> Self {
        Scoring::with_d0(tm_score_d0(length), length, f64::INFINITY)
    }

    /// A score with distance scale `d0`, normalised by `l_norm`, counting the pairs within
    /// `score_cut`; pairs are collected within `d0` clamped to 4.5-8 Å, less [`CUT_MARGIN`] after
    /// a seed and plus it after that.
    fn with_d0(d0: f64, l_norm: usize, score_cut: f64) -> Self {
        let cut = d0.clamp(4.5, 8.0);
        Scoring { d0, l_norm, score_cut, first_cut: cut - CUT_MARGIN, extend_cut: cut + CUT_MARGIN }
    }
}

/// The search scale: during the search, alignments are scored with $d_0(L_{min})$ plus this, a
/// slightly wider distance scale than the reported score's, Å.
const SEARCH_D0_EXTRA: f64 = 0.8;

/// $d_8 = 1.5 L^{0.3} + 3.5$ Å for the shorter chain's length $L$: the distance past which a pair
/// is not aligned, and adds nothing to a search score.
fn d8(l_min: usize) -> f64 {
    1.5 * (l_min as f64).powf(0.3) + 3.5
}

/// The superposition of B onto A that maximises the TM-score of `pairs` under `scoring`, by the
/// seed-and-extend search of Zhang & Skolnick (2004): seeds of `n`, `n/2`, `n/4`, ... (at least
/// 4) consecutive pairs starting every `step` pairs (and at the last start), each superposed by
/// Kabsch, then re-superposed on the pairs closer than `first_cut` and from then on on those
/// closer than `extend_cut` (the three closest pairs when fewer are), until that set repeats or
/// for at most [`EXTENSION_ROUNDS`] rounds. A set already superposed with at least as many rounds
/// left, from this seed or an earlier one, is not followed again: it leads where it led before.
/// Returns the best TM-score met and its motion; (0, identity) for no pairs.
fn tm_superposition(a: &[V3], b: &[V3], pairs: &[(usize, usize)], scoring: &Scoring, step: usize) -> (f64, Motion) {
    let n = pairs.len();
    if n == 0 || scoring.l_norm == 0 {
        return (0.0, Motion::identity());
    }
    let inv_d0_sq = 1.0 / (scoring.d0 * scoring.d0);
    let score_cut_sq = scoring.score_cut * scoring.score_cut;
    let (first_cut_sq, extend_cut_sq) = (scoring.first_cut.powi(2), scoring.extend_cut.powi(2));
    let min_seed = n.min(4);
    let at_least = n.min(3);
    let step = step.max(1);
    let mut best = (f64::NEG_INFINITY, Motion::identity());
    let mut d2 = vec![0.0f64; n];
    let mut chosen: Vec<usize> = Vec::with_capacity(n);
    let mut used: Vec<usize> = Vec::with_capacity(n);
    let mut subset: Vec<(usize, usize)> = Vec::with_capacity(n);
    // The paired coordinates in pair order, read once.
    let pa: Vec<V3> = pairs.iter().map(|&(i, _)| a[i]).collect();
    let pb: Vec<V3> = pairs.iter().map(|&(_, j)| b[j]).collect();
    // Each set superposed so far (by a hash of its pair indices) and the rounds it had left.
    let mut followed: HashMap<(u64, u64), usize> = HashMap::new();
    let mut seed_len = n;
    loop {
        let last_start = n - seed_len;
        let mut start = 0;
        loop {
            used.clear();
            used.extend(start..start + seed_len);
            let mut motion = kabsch(a, b, &pairs[start..start + seed_len]);
            for round in 0..=EXTENSION_ROUNDS {
                let mut sum = 0.0;
                for ((d, p), q) in d2.iter_mut().zip(&pa).zip(&pb) {
                    *d = (p - motion.apply(q)).norm_squared();
                    if *d <= score_cut_sq {
                        sum += 1.0 / (1.0 + *d * inv_d0_sq);
                    }
                }
                let tm = sum / scoring.l_norm as f64;
                if tm > best.0 {
                    best = (tm, motion);
                }
                if round == EXTENSION_ROUNDS {
                    break;
                }
                let cut_sq = if round == 0 { first_cut_sq } else { extend_cut_sq };
                chosen.clear();
                chosen.extend((0..n).filter(|&k| d2[k] < cut_sq));
                if chosen.len() < at_least {
                    let mut order: Vec<usize> = (0..n).collect();
                    order.sort_by(|&x, &y| d2[x].total_cmp(&d2[y]));
                    chosen.clear();
                    chosen.extend_from_slice(&order[..at_least]);
                    chosen.sort_unstable();
                }
                // Superposing the set just superposed would repeat this round. (Not so after the
                // seed: the next set is collected with the other cut-off.)
                if round > 0 && chosen == used {
                    break;
                }
                let left = EXTENSION_ROUNDS - round;
                let key = set_key(&chosen);
                match followed.get(&key) {
                    Some(&had) if had >= left => break,
                    _ => {
                        followed.insert(key, left);
                    }
                }
                subset.clear();
                subset.extend(chosen.iter().map(|&k| pairs[k]));
                motion = kabsch(a, b, &subset);
                std::mem::swap(&mut chosen, &mut used);
            }
            if start == last_start {
                break;
            }
            start = (start + step).min(last_start);
        }
        if seed_len == min_seed {
            break;
        }
        seed_len = (seed_len / 2).max(min_seed);
    }
    best
}

/// A 128-bit key for a list of indices: two independent multiply-rotate streams seeded apart,
/// one of them with the length, so that two different lists sharing a key is not a practical
/// concern.
fn set_key(set: &[usize]) -> (u64, u64) {
    let (mut h1, mut h2) = (set.len() as u64, 0x9E37_79B9_7F4A_7C15u64);
    for &k in set {
        h1 = (h1.rotate_left(5) ^ k as u64).wrapping_mul(0x517C_C1B7_2722_0A95);
        h2 = (h2 ^ k as u64).wrapping_mul(0xBF58_476D_1CE4_E5B9).rotate_left(29);
    }
    (h1, h2)
}

/// The seed spacing of the quick searches made while alignments are still changing; the final
/// scores are searched with every start (step 1).
fn quick_step(pairs: usize) -> usize {
    (pairs / 6).max(1)
}

// ---------------------------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------------------------

/// For each residue of A, the residue of B it is paired with.
type ResidueMap = Vec<Option<usize>>;

fn pairs_of(map: &ResidueMap) -> Vec<(usize, usize)> {
    map.iter().enumerate().filter_map(|(i, j)| j.map(|j| (i, j))).collect()
}

/// The alignment of A's `la` residues with B's `lb` maximising the summed `score(i, j)` of its
/// pairs, where each gap costs `gap_open` however long it is, and a gap at either end of either
/// chain costs nothing. Three-state dynamic programming (pair, A residue against a gap, B residue
/// against a gap); ties prefer a pair, then a gap in B.
fn dp_align(la: usize, lb: usize, gap_open: f64, score: impl Fn(usize, usize) -> f64) -> ResidueMap {
    dp_align_rows(la, lb, gap_open, |i, row| {
        for (j, s) in row.iter_mut().enumerate() {
            *s = score(i, j);
        }
    })
}

/// [`dp_align`] with the scores given a row at a time: `fill(i, row)` writes `score(i, j)` to
/// `row[j]` for every residue `j` of B.
fn dp_align_rows(la: usize, lb: usize, gap_open: f64, mut fill: impl FnMut(usize, &mut [f64])) -> ResidueMap {
    const PAIR: u8 = 0;
    const GAP_IN_B: u8 = 1;
    const GAP_IN_A: u8 = 2;
    const NONE: f64 = f64::NEG_INFINITY;
    fn best3(pair: f64, gap_b: f64, gap_a: f64) -> (f64, u8) {
        if pair >= gap_b && pair >= gap_a {
            (pair, PAIR)
        } else if gap_b >= gap_a {
            (gap_b, GAP_IN_B)
        } else {
            (gap_a, GAP_IN_A)
        }
    }
    let w = lb + 1;
    // For every cell, the state each of the three states was reached from, two bits apiece.
    let mut from = vec![0u8; (la + 1) * w];
    let (mut pm, mut px, mut py) = (vec![NONE; w], vec![NONE; w], vec![NONE; w]);
    let (mut cm, mut cx, mut cy) = (vec![NONE; w], vec![NONE; w], vec![NONE; w]);
    pm[0] = 0.0;
    for j in 1..=lb {
        py[j] = 0.0;
        from[j] = (if j == 1 { PAIR } else { GAP_IN_A }) << 4;
    }
    let mut row = vec![0.0f64; lb];
    for i in 1..=la {
        cm[0] = NONE;
        cy[0] = NONE;
        cx[0] = 0.0;
        from[i * w] = (if i == 1 { PAIR } else { GAP_IN_B }) << 2;
        // A gap in A along the last row is a trailing gap: free.
        let open_a = if i == la { 0.0 } else { gap_open };
        fill(i - 1, &mut row);
        for j in 1..=lb {
            let (m, sm) = best3(pm[j - 1], px[j - 1], py[j - 1]);
            cm[j] = m + row[j - 1];
            let open_b = if j == lb { 0.0 } else { gap_open };
            let (x, sx) = best3(pm[j] + open_b, px[j], py[j] + open_b);
            cx[j] = x;
            let (y, sy) = best3(cm[j - 1] + open_a, cx[j - 1] + open_a, cy[j - 1]);
            cy[j] = y;
            from[i * w + j] = sm | (sx << 2) | (sy << 4);
        }
        std::mem::swap(&mut pm, &mut cm);
        std::mem::swap(&mut px, &mut cx);
        std::mem::swap(&mut py, &mut cy);
    }
    let (_, mut state) = best3(pm[lb], px[lb], py[lb]);
    let mut map = vec![None; la];
    let (mut i, mut j) = (la, lb);
    while i > 0 || j > 0 {
        let f = from[i * w + j];
        match state {
            PAIR => {
                map[i - 1] = Some(j - 1);
                state = f & 3;
                i -= 1;
                j -= 1;
            }
            GAP_IN_B => {
                state = (f >> 2) & 3;
                i -= 1;
            }
            _ => {
                state = (f >> 4) & 3;
                j -= 1;
            }
        }
    }
    map
}

/// Helix (`H`), strand (`E`), turn (`T`) or coil (`C`) for each residue, from the six
/// $C_\alpha$ distances of its window $i-2 \ldots i+2$: helix when the $(i, i+2)$, $(i, i+3)$ and
/// $(i, i+4)$ distances are all within 2.1 Å of 5.45, 5.18 and 6.37 Å; strand when within 1.42 Å
/// of 6.1, 10.4 and 13.0 Å; turn when the window's ends are closer than 8 Å; the two residues at
/// each end are coil.
fn ca_secondary_structure(ca: &[V3]) -> Vec<u8> {
    let n = ca.len();
    let mut ss = vec![b'C'; n];
    for i in 2..n.saturating_sub(2) {
        let d = |p: usize, q: usize| (ca[p] - ca[q]).norm();
        let skip2 = [d(i - 2, i), d(i - 1, i + 1), d(i, i + 2)];
        let skip3 = [d(i - 2, i + 1), d(i - 1, i + 2)];
        let skip4 = d(i - 2, i + 2);
        let near = |ideal: [f64; 3], tol: f64| {
            skip2.iter().all(|x| (x - ideal[0]).abs() < tol)
                && skip3.iter().all(|x| (x - ideal[1]).abs() < tol)
                && (skip4 - ideal[2]).abs() < tol
        };
        ss[i] = if near([5.45, 5.18, 6.37], 2.1) {
            b'H'
        } else if near([6.1, 10.4, 13.0], 1.42) {
            b'E'
        } else if skip4 < 8.0 {
            b'T'
        } else {
            b'C'
        };
    }
    ss
}

/// One structure pair as it is searched: the two traces, their secondary structure, the shorter
/// chain's length and $d_8$, and the scoring the search uses.
struct Search<'t> {
    a: &'t [V3],
    b: &'t [V3],
    ss_a: Vec<u8>,
    ss_b: Vec<u8>,
    l_min: usize,
    d8: f64,
    /// $d_0(L_{min})$ plus [`SEARCH_D0_EXTRA`], normalised by $L_{min}$, pairs past $d_8$ not
    /// counted.
    scoring: Scoring,
}

impl<'t> Search<'t> {
    fn new(a: &'t [V3], b: &'t [V3]) -> Self {
        let l_min = a.len().min(b.len());
        let d8 = d8(l_min);
        Search {
            a,
            b,
            ss_a: ca_secondary_structure(a),
            ss_b: ca_secondary_structure(b),
            l_min,
            d8,
            scoring: Scoring::with_d0(tm_score_d0(l_min) + SEARCH_D0_EXTRA, l_min, d8),
        }
    }

    fn same_ss(&self, i: usize, j: usize) -> f64 {
        if self.ss_a[i] == self.ss_b[j] {
            1.0
        } else {
            0.0
        }
    }

    /// The quick search score of an alignment and its superposition.
    fn quick(&self, pairs: &[(usize, usize)]) -> (f64, Motion) {
        tm_superposition(self.a, self.b, pairs, &self.scoring, quick_step(pairs.len()))
    }

    /// Dynamic programming on the distance score $1/(1 + (d_{ij}/d_0)^2)$ of B moved by `motion`.
    fn align_on(&self, motion: &Motion, gap_open: f64) -> ResidueMap {
        let inv_d0_sq = 1.0 / (self.scoring.d0 * self.scoring.d0);
        let moved: Vec<V3> = self.b.iter().map(|p| motion.apply(p)).collect();
        dp_align_rows(self.a.len(), self.b.len(), gap_open, |i, row| {
            let p = self.a[i];
            for (s, q) in row.iter_mut().zip(&moved) {
                let (dx, dy, dz) = (p.x - q.x, p.y - q.y, p.z - q.z);
                *s = 1.0 / (1.0 + (dx * dx + dy * dy + dz * dz) * inv_d0_sq);
            }
        })
    }
}

/// Offsets whose TM-score [`gapless_threading`] searches for, at most: a bound on its work for
/// long chains, which have more offsets than this.
const THREADING_SEARCHED: usize = 200;

/// A quick estimate of the TM-score of `pairs` under `scoring`, the first steps of the search in
/// [`tm_superposition`] from its first seed alone: every pair superposed, then twice
/// re-superposed on the pairs within the cut-offs. The best score met. It orders the offsets
/// [`gapless_threading`] searches, and so picks them when there are more than it searches.
fn tm_estimate(a: &[V3], b: &[V3], pairs: &[(usize, usize)], scoring: &Scoring) -> f64 {
    let inv_d0_sq = 1.0 / (scoring.d0 * scoring.d0);
    let score_cut_sq = scoring.score_cut * scoring.score_cut;
    let mut motion = kabsch(a, b, pairs);
    let mut best = f64::NEG_INFINITY;
    let mut near = Vec::with_capacity(pairs.len());
    for cut in [scoring.first_cut, scoring.extend_cut, f64::NAN] {
        let mut sum = 0.0;
        near.clear();
        for &(i, j) in pairs {
            let d2 = (a[i] - motion.apply(&b[j])).norm_squared();
            if d2 <= score_cut_sq {
                sum += 1.0 / (1.0 + d2 * inv_d0_sq);
            }
            if d2 < cut * cut {
                near.push((i, j));
            }
        }
        best = best.max(sum / scoring.l_norm as f64);
        if cut.is_nan() || near.len() < 3 {
            break;
        }
        motion = kabsch(a, b, &near);
    }
    best
}

/// Gapless threading: of every offset at which the chains overlap by at least half the shorter
/// one (rounded down), the pairing whose superposition scores the best TM-score, with that
/// superposition; of equal scores the lowest offset. The offsets are searched best estimate
/// first ([`tm_estimate`]), at most [`THREADING_SEARCHED`] of them, and an offset is passed over
/// when it cannot win: each pair adds at most 1 to a TM-score, so `k` pairs score at most `k / L`
/// (identical chains need one search, not one per offset). Below that many offsets (chains of up
/// to about 200 residues) the result is the one searching every offset gives.
fn gapless_threading(s: &Search) -> (ResidueMap, Motion) {
    let (la, lb) = (s.a.len(), s.b.len());
    let min_overlap = (s.l_min / 2).max(1);
    // A residue i pairs with B residue i - offset.
    let pairs_at = |offset: isize| -> Vec<(usize, usize)> {
        let first = offset.max(0) as usize;
        let last = (lb as isize + offset).min(la as isize) as usize;
        (first..last).map(|i| (i, (i as isize - offset) as usize)).collect()
    };
    let mut estimated: Vec<(f64, isize)> = (-(lb as isize - 1)..=(la as isize - 1))
        .filter_map(|offset| {
            let pairs = pairs_at(offset);
            (pairs.len() >= min_overlap).then(|| (tm_estimate(s.a, s.b, &pairs, &s.scoring), offset))
        })
        .collect();
    estimated.sort_by(|x, y| y.0.total_cmp(&x.0).then(x.1.cmp(&y.1)));
    let mut best = (f64::NEG_INFINITY, isize::MAX, Vec::new(), Motion::identity());
    for &(_, offset) in estimated.iter().take(THREADING_SEARCHED) {
        let pairs = pairs_at(offset);
        let bound = pairs.len() as f64 / s.scoring.l_norm as f64;
        if bound < best.0 || (bound == best.0 && offset > best.1) {
            continue;
        }
        let (tm, motion) = s.quick(&pairs);
        if tm > best.0 || (tm == best.0 && offset < best.1) {
            best = (tm, offset, pairs, motion);
        }
    }
    let mut map = vec![None; la];
    for (i, j) in best.2 {
        map[i] = Some(j);
    }
    (map, best.3)
}

/// The fragment length of the local-superposition start: 8 residues when the shorter chain has
/// fewer than 100, else 12, as Pandit & Skolnick (2008) choose their aligned fragment pairs.
fn fragment_length(l_min: usize) -> usize {
    if l_min < 100 {
        8
    } else {
        12
    }
}

/// Fragment pairs whose superposition is followed in the local-superposition start, at most.
const LOCAL_SEEDS: usize = 24;
/// The dynamic-programming cells the local-superposition start fills, at most (24 seeds of
/// 250 x 250); longer chains follow fewer seeds, never fewer than [`LOCAL_SEEDS_LONG`].
const LOCAL_CELLS: usize = 24 * 250 * 250;
const LOCAL_SEEDS_LONG: usize = 4;

/// Local superposition: fragments of [`fragment_length`] consecutive residues, starting every
/// half fragment along each chain, are superposed pair by pair (Kabsch); for each of the
/// [`LOCAL_SEEDS`] pairs that fit best (lowest RMSD; fewer for long chains, [`LOCAL_CELLS`]), B
/// moved by the pair's motion is aligned with A by dynamic programming on the distance score
/// (gap opening -0.6), and the alignment whose quick TM-score search scores best is the start.
/// None when a chain is shorter than a fragment.
fn local_superposition(s: &Search) -> Option<ResidueMap> {
    let f = fragment_length(s.l_min);
    if s.l_min < f {
        return None;
    }
    let starts = |len: usize| (0..=len - f).step_by((f / 2).max(1));
    let mut fits: Vec<(f64, usize, usize)> = Vec::new();
    let mut frag = Vec::with_capacity(f);
    for i in starts(s.a.len()) {
        for j in starts(s.b.len()) {
            frag.clear();
            frag.extend((0..f).map(|k| (i + k, j + k)));
            fits.push((rmsd_after_kabsch(s.a, s.b, &frag), i, j));
        }
    }
    fits.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut best: Option<(f64, ResidueMap)> = None;
    let seeds = LOCAL_SEEDS.min((LOCAL_CELLS / (s.a.len() * s.b.len())).max(LOCAL_SEEDS_LONG));
    for &(_, i, j) in fits.iter().take(seeds) {
        frag.clear();
        frag.extend((0..f).map(|k| (i + k, j + k)));
        let map = s.align_on(&kabsch(s.a, s.b, &frag), -0.6);
        let (tm, _) = s.quick(&pairs_of(&map));
        if best.as_ref().is_none_or(|(b, _)| tm > *b) {
            best = Some((tm, map));
        }
    }
    best.map(|(_, map)| map)
}

/// The initial alignments, each refined in turn.
struct Starts {
    /// Gapless threading ([`gapless_threading`]).
    threading: ResidueMap,
    /// Dynamic programming on the secondary-structure match (gap opening -1).
    secondary_structure: ResidueMap,
    /// Dynamic programming (gap opening -1) on half the secondary-structure match plus half the
    /// distance score of the threading superposition.
    combined: ResidueMap,
    /// Local superposition ([`local_superposition`]), when the chains are long enough.
    local: Option<ResidueMap>,
}

impl Starts {
    fn all(self) -> Vec<ResidueMap> {
        let mut all = vec![self.threading, self.secondary_structure, self.combined];
        all.extend(self.local);
        all
    }
}

fn initial_alignments(s: &Search) -> Starts {
    let (la, lb) = (s.a.len(), s.b.len());
    let (threading, threading_motion) = gapless_threading(s);
    let secondary_structure = dp_align(la, lb, -1.0, |i, j| s.same_ss(i, j));
    let inv_d0_sq = 1.0 / (s.scoring.d0 * s.scoring.d0);
    let moved: Vec<V3> = s.b.iter().map(|p| threading_motion.apply(p)).collect();
    let combined = dp_align(la, lb, -1.0, |i, j| {
        0.5 * s.same_ss(i, j) + 0.5 / (1.0 + (s.a[i] - moved[j]).norm_squared() * inv_d0_sq)
    });
    Starts { threading, secondary_structure, combined, local: local_superposition(s) }
}

/// The gap-opening penalties the refinement's dynamic programming is run with, each from every
/// initial alignment: -0.6 (Zhang & Skolnick 2005), and none.
const REFINE_GAP_OPENS: [f64; 2] = [-0.6, 0.0];
/// Refinement rounds at most, should an alignment keep changing.
const REFINE_ROUNDS: usize = 30;

/// Alternate the quick TM-score search and dynamic programming on its distance scores from
/// `start` until an alignment comes round again (at most [`REFINE_ROUNDS`] rounds), once per
/// gap-opening penalty; the alignment with the best search score met.
fn refine(s: &Search, start: ResidueMap) -> ResidueMap {
    let mut best = (f64::NEG_INFINITY, start.clone());
    for gap_open in REFINE_GAP_OPENS {
        let mut current = start.clone();
        // Each alignment leads to one next alignment, so one met before in this run means the
        // rounds have begun to cycle through alignments already scored.
        let mut met = vec![map_key(&current)];
        for _ in 0..REFINE_ROUNDS {
            let (tm, motion) = s.quick(&pairs_of(&current));
            if tm > best.0 {
                best = (tm, current.clone());
            }
            let next = s.align_on(&motion, gap_open);
            let key = map_key(&next);
            if met.contains(&key) {
                break;
            }
            met.push(key);
            current = next;
        }
    }
    best.1
}

/// A 128-bit key for an alignment, as [`set_key`] gives one for a set.
fn map_key(map: &ResidueMap) -> (u64, u64) {
    let coded: Vec<usize> = map.iter().map(|j| j.map_or(usize::MAX, |j| j)).collect();
    set_key(&coded)
}

/// A refined alignment as it is reported: the pairs within $d_8$ of each other under the best
/// search-scale superposition of the whole alignment (searched from every start), and the
/// TM-score of those pairs normalised by the shorter chain with its $d_0$, with the superposition
/// that score is found on.
#[derive(Clone)]
struct Finished {
    score: f64,
    motion: Motion,
    kept: Vec<(usize, usize)>,
}

fn finish(s: &Search, map: &ResidueMap) -> Finished {
    let pairs = pairs_of(map);
    let (_, motion) = tm_superposition(s.a, s.b, &pairs, &s.scoring, 1);
    let kept: Vec<(usize, usize)> =
        pairs.into_iter().filter(|&(i, j)| (s.a[i] - motion.apply(&s.b[j])).norm() <= s.d8).collect();
    let (score, motion) = tm_superposition(s.a, s.b, &kept, &Scoring::for_length(s.l_min), 1);
    Finished { score, motion, kept }
}

/// Of `starts`, each refined and finished, the one whose finished score is the highest (the
/// first of equals): the very score that is reported, so another start can only raise it. Starts
/// that refine to the same alignment are finished once.
fn best_finished(s: &Search, starts: Vec<ResidueMap>) -> Finished {
    let mut done: Vec<(ResidueMap, Finished)> = Vec::new();
    let mut best: Option<Finished> = None;
    for start in starts {
        let refined = refine(s, start);
        let finished = match done.iter().find(|(map, _)| *map == refined) {
            Some((_, f)) => f.clone(),
            None => {
                let f = finish(s, &refined);
                done.push((refined, f.clone()));
                f
            }
        };
        if best.as_ref().is_none_or(|b| finished.score > b.score) {
            best = Some(finished);
        }
    }
    best.unwrap_or(Finished { score: 0.0, motion: Motion::identity(), kept: Vec::new() })
}

/// What [`align_traces`] finds.
struct TraceAlignment {
    /// The aligned pairs `(i in A, j in B)`, in chain order.
    pairs: Vec<(usize, usize)>,
    tm_a: f64,
    tm_b: f64,
    /// The superposition `tm_a` is the score of (B onto A).
    motion_a: Motion,
    rmsd: f64,
}

/// The TM-score alignment of two $C_\alpha$ traces of at least three residues each. The score
/// normalised by the shorter chain is the finished score itself; the other chain's is searched
/// on the same pairs.
fn align_traces(a: &[V3], b: &[V3]) -> TraceAlignment {
    let s = Search::new(a, b);
    let found = best_finished(&s, initial_alignments(&s).all());
    let other = |length: usize| tm_superposition(a, b, &found.kept, &Scoring::for_length(length), 1);
    let ((tm_a, motion_a), tm_b) = match a.len().cmp(&b.len()) {
        std::cmp::Ordering::Equal => ((found.score, found.motion), found.score),
        std::cmp::Ordering::Less => ((found.score, found.motion), other(b.len()).0),
        std::cmp::Ordering::Greater => (other(a.len()), found.score),
    };
    TraceAlignment { rmsd: rmsd_after_kabsch(a, b, &found.kept), pairs: found.kept, tm_a, tm_b, motion_a }
}

/// The two whole sequences as aligned by `pairs` (in chain order), `-` for a gap. Between two
/// pairs, A's unpaired residues come before B's.
fn alignment_strings(seq_a: &[u8], seq_b: &[u8], pairs: &[(usize, usize)]) -> (String, String) {
    let (la, lb) = (seq_a.len(), seq_b.len());
    let (mut row_a, mut row_b) = (String::with_capacity(la + lb), String::with_capacity(la + lb));
    let (mut i, mut j) = (0usize, 0usize);
    for &(pi, pj) in pairs.iter().chain(std::iter::once(&(la, lb))) {
        while i < pi {
            row_a.push(seq_a[i] as char);
            row_b.push('-');
            i += 1;
        }
        while j < pj {
            row_a.push('-');
            row_b.push(seq_b[j] as char);
            j += 1;
        }
        if pi < la && pj < lb {
            row_a.push(seq_a[pi] as char);
            row_b.push(seq_b[pj] as char);
            i += 1;
            j += 1;
        }
    }
    (row_a, row_b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::biophysics_3d::align_pdb_chains_kabsch;
    use molbiocraft_formats::one_to_three_aa;
    use nalgebra::{Matrix3, Rotation3, Unit};

    /// An irregular Cα trace: a seeded random walk of 3.8 Å steps. A walk has no screw symmetry,
    /// so no pairing but the true one superposes it onto a rigidly moved copy of itself.
    fn walk(n: usize, seed: u64) -> Vec<V3> {
        let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64 - 0.5
        };
        let mut pos = V3::new(10.0, -4.0, 6.0);
        (0..n)
            .map(|_| {
                pos += V3::new(next(), next(), next()).normalize() * 3.8;
                pos
            })
            .collect()
    }

    /// Each point displaced by exactly `amp` Å in a seeded random direction.
    fn jittered(points: &[V3], amp: f64, seed: u64) -> Vec<V3> {
        let steps = walk(points.len() + 1, seed);
        points.iter().zip(steps.windows(2)).map(|(p, w)| p + (w[1] - w[0]) * (amp / 3.8)).collect()
    }

    /// The rigid motion structure B is built with: B = Q A + S.
    fn q() -> Matrix3<f64> {
        *Rotation3::from_axis_angle(&Unit::new_normalize(V3::new(1.0, 2.0, 3.0)), 1.1).matrix()
    }
    fn s() -> V3 {
        V3::new(12.5, -7.25, 30.0)
    }
    fn moved(points: &[V3]) -> Vec<V3> {
        points.iter().map(|p| q() * p + s()).collect()
    }

    fn pdb(chains: &[(&str, &[u8], &[V3])]) -> String {
        let mut out = String::from("HEADER    SYNTHETIC\n");
        let mut serial = 0;
        for (id, seq, points) in chains {
            for (k, (aa, p)) in seq.iter().zip(points.iter()).enumerate() {
                serial += 1;
                out.push_str(&format!(
                    "ATOM  {:>5}  CA  {:>3} {}{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00           C\n",
                    serial,
                    one_to_three_aa(*aa),
                    id,
                    k + 1,
                    p.x,
                    p.y,
                    p.z
                ));
            }
        }
        out.push_str("END\n");
        out
    }

    /// The same points as `pdb` writes them, to the 3 decimals a PDB file keeps.
    fn as_written(points: &[V3]) -> Vec<V3> {
        let r = |v: f64| format!("{v:.3}").parse::<f64>().unwrap();
        points.iter().map(|p| V3::new(r(p.x), r(p.y), r(p.z))).collect()
    }

    fn apply(t: &[[f64; 4]; 4], p: &V3) -> V3 {
        V3::new(
            t[0][0] * p.x + t[0][1] * p.y + t[0][2] * p.z + t[0][3],
            t[1][0] * p.x + t[1][1] * p.y + t[1][2] * p.z + t[1][3],
            t[2][0] * p.x + t[2][1] * p.y + t[2][2] * p.z + t[2][3],
        )
    }

    /// The (A index, B index) pairs of two alignment strings: the columns where neither is a gap.
    fn pairs_of_strings(a: &str, b: &str) -> Vec<(usize, usize)> {
        assert_eq!(a.len(), b.len(), "alignment strings of unequal length");
        let (mut i, mut j) = (0usize, 0usize);
        let mut pairs = Vec::new();
        for (x, y) in a.bytes().zip(b.bytes()) {
            if x != b'-' && y != b'-' {
                pairs.push((i, j));
            }
            i += usize::from(x != b'-');
            j += usize::from(y != b'-');
        }
        pairs
    }

    /// TM-score of `t` (B onto A) over `pairs`, normalised by `l` with this `d0`, from scratch.
    fn tm_under(t: &[[f64; 4]; 4], a: &[V3], b: &[V3], pairs: &[(usize, usize)], d0: f64, l: usize) -> f64 {
        pairs.iter().map(|&(i, j)| 1.0 / (1.0 + (a[i] - apply(t, &b[j])).norm_squared() / (d0 * d0))).sum::<f64>()
            / l as f64
    }

    /// d0 = 1.24 (L - 15)^(1/3) - 1.8 (Zhang & Skolnick 2004), floored at 0.5, with L the length of
    /// the chain the score is normalised by: not the shorter chain, not the number of aligned pairs.
    #[test]
    fn d0_matches_zhang_skolnick() {
        let formula = |l: f64| 1.24 * (l - 15.0).powf(1.0 / 3.0) - 1.8;
        for l in [22usize, 30, 45, 60, 76, 103, 141, 146, 153, 300, 1000] {
            let got = tm_score_d0(l);
            assert!((got - formula(l as f64)).abs() < 1e-12, "L = {l}: d0 {got}, formula {}", formula(l as f64));
        }
        // The formula falls below 0.5 under L = 22 (and has no real value under L = 15 with powf).
        assert!(formula(21.0) < 0.5 && formula(22.0) > 0.5);
        for l in [1usize, 3, 10, 14, 15, 16, 19, 21] {
            assert_eq!(tm_score_d0(l), 0.5, "L = {l}");
        }

        // In a report, each TM-score is normalised by its own chain with that chain's d0. B is 45
        // of A's 60 residues, moved and displaced by 1.5 Å each, so distances are not zero and d0
        // matters.
        let a = walk(60, 3);
        let b = jittered(&moved(&a[8..53]), 1.5, 11);
        let seq = vec![b'A'; 60];
        let r = align_structures_tm(&pdb(&[("A", &seq, &a)]), &pdb(&[("B", &seq[..45], &b)]), None, None)
            .expect("alignment");
        assert_eq!((r.length_a, r.length_b), (60, 45));
        assert_eq!((r.d0_a, r.d0_b), (tm_score_d0(60), tm_score_d0(45)));
        let (a, b) = (as_written(&a), as_written(&b));
        let pairs = pairs_of_strings(&r.aligned_sequence_a, &r.aligned_sequence_b);
        assert_eq!(pairs.len(), r.aligned_length);
        assert_eq!(pairs, (0..45).map(|k| (k + 8, k)).collect::<Vec<_>>(), "the construction's pairing");
        // The reported transform is the superposition tm_score_a was found on.
        let t = &r.transformation_matrix;
        let tm_a = tm_under(t, &a, &b, &pairs, r.d0_a, 60);
        assert!((tm_a - r.tm_score_a).abs() < 1e-9, "TM-score A {} recomputed {tm_a}", r.tm_score_a);
        // The same transform scored with the other chain's d0 is a different number, so the
        // check above tells the two d0 values apart.
        let with_d0_b = tm_under(t, &a, &b, &pairs, r.d0_b, 60);
        assert!((with_d0_b - r.tm_score_a).abs() > 1e-3, "d0_a and d0_b give the same score");
        // tm_score_b is a maximum over superpositions, so at least what A's transform gives it.
        assert!(r.tm_score_b + 1e-9 >= tm_under(t, &a, &b, &pairs, r.d0_b, 45));
        assert!(r.tm_score_b > r.tm_score_a, "45 aligned of 45 scores above 45 of 60");
    }

    /// 40 residues; B keeps all but A's residues 15..20, is rigidly moved, and has its own
    /// sequence: only every fifth residue it keeps has A's letter, so the pairing can only come
    /// from the structure.
    #[test]
    fn reports_alignment_identity_and_transform() {
        const SEQ: &[u8] = b"MKTLVAGHEDWQRSFYPCINLKEGAVTRWPDHMQSYFCEN";
        const ALPHABET: &[u8] = b"ACDEFGHIKLMNPQRSTVWY";
        let a = walk(40, 7);
        let kept: Vec<usize> = (0..40).filter(|i| !(15..20).contains(i)).collect();
        let b: Vec<V3> = moved(&kept.iter().map(|&i| a[i]).collect::<Vec<_>>());
        let seq_b: Vec<u8> = kept
            .iter()
            .enumerate()
            .map(|(k, &i)| {
                if k % 5 == 0 {
                    SEQ[i]
                } else {
                    let at = ALPHABET.iter().position(|&c| c == SEQ[i]).unwrap();
                    ALPHABET[(at + 7) % 20]
                }
            })
            .collect();
        let r = align_structures_tm(&pdb(&[("A", SEQ, &a)]), &pdb(&[("B", &seq_b, &b)]), None, None)
            .expect("alignment");

        let text = |s: &[u8]| String::from_utf8(s.to_vec()).unwrap();
        assert_eq!(r.aligned_sequence_a, text(SEQ));
        assert_eq!(r.aligned_sequence_b, format!("{}-----{}", text(&seq_b[..15]), text(&seq_b[15..])));
        assert_eq!(r.aligned_length, 35);
        assert_eq!(r.sequence_identity, 7.0 / 35.0, "identity over the 35 aligned pairs, not the 40 columns");
        assert!((r.tm_score_a - 35.0 / 40.0).abs() < 1e-6, "TM-score A {}", r.tm_score_a);
        assert!((r.tm_score_b - 1.0).abs() < 1e-6, "TM-score B {}", r.tm_score_b);
        assert!(r.rmsd_angstrom < 2e-3, "RMSD {}", r.rmsd_angstrom);
        assert!(r.method.starts_with("TM-align-style"), "{}", r.method);

        // The 4x4 matrix is [R t; 0 0 0 1] and maps B onto A: it undoes B = Q A + S.
        let t = &r.transformation_matrix;
        assert_eq!(t[3], [0.0, 0.0, 0.0, 1.0]);
        let qt = q().transpose();
        let undo = -(qt * s());
        for row in 0..3 {
            for col in 0..3 {
                assert!((t[row][col] - qt[(row, col)]).abs() < 1e-4, "R[{row}][{col}]");
            }
            assert!((t[row][3] - undo[row]).abs() < 1e-3, "t[{row}]");
        }
        for (k, &i) in kept.iter().enumerate() {
            assert!((apply(t, &b[k]) - a[i]).norm() < 2e-3, "B residue {k} does not land on A residue {i}");
        }

        // Where both chains have unpaired residues between two pairs, A's come first.
        let (row_a, row_b) = alignment_strings(b"ABCDE", b"VWXYZ", &[(0, 0), (3, 3)]);
        assert_eq!((row_a.as_str(), row_b.as_str()), ("ABC--DE-", "V--WXY-Z"));
    }

    /// The TM-score alignment and the sequence-paired superposition run on the same text and
    /// return the same chain ids and the same residues, coded alike; the TM-score report.
    fn read_alike(text_a: &str, text_b: &str, ca: Option<&str>, cb: Option<&str>) -> TmAlignmentReport {
        let tm = align_structures_tm(text_a, text_b, ca, cb).expect("tm alignment");
        let kabsch = align_pdb_chains_kabsch(text_a, text_b, ca, cb).expect("kabsch");
        assert_eq!((tm.chain_a.as_str(), tm.chain_b.as_str()), (kabsch.chain_a.as_str(), kabsch.chain_b.as_str()));
        let residues = |s: &str| s.replace('-', "");
        assert_eq!(residues(&tm.aligned_sequence_a), residues(&kabsch.aligned_sequence_a), "chain A residues");
        assert_eq!(residues(&tm.aligned_sequence_b), residues(&kabsch.aligned_sequence_b), "chain B residues");
        assert_eq!(
            (tm.length_a, tm.length_b),
            (residues(&tm.aligned_sequence_a).len(), residues(&tm.aligned_sequence_b).len())
        );
        tm
    }

    /// Every methionine of a `pdb` text written as a `HETATM` selenomethionine (`MSE`), as the
    /// wwPDB files a SeMet crystal structure.
    fn semet_pdb(text: &str) -> String {
        text.lines()
            .map(|l| match l.get(17..20) {
                Some("MET") if l.starts_with("ATOM  ") => format!("HETATM{}MSE{}\n", &l[6..17], &l[20..]),
                _ => format!("{l}\n"),
            })
            .collect()
    }

    /// The chain read for the alignment is the chain the sequence-paired superposition reads, by
    /// the one reader both use: the same selection by author id, then mmCIF label id, the same
    /// residues and one-letter codes, the same errors. The fixtures hold what a reader of its own
    /// once read differently from PDB and from mmCIF: a `HETATM` selenomethionine in a PDB chain
    /// and in an mmCIF chain (a residue, coded `M`), and a calcium ion, whose atom is also named
    /// `CA`, written as an `ATOM` record (as molecular-dynamics packages write ions) and as a
    /// `HETATM` record (never a residue).
    #[test]
    fn reads_the_chain_the_kabsch_superposition_reads() {
        let gfp = b"MVSKGEELFTGVVPILVELDGDVNGHKFSV";
        let lyz = b"KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKF";
        let text = |s: &[u8]| String::from_utf8(s.to_vec()).unwrap();
        let (wa, wb) = (walk(gfp.len(), 1), walk(lyz.len(), 2));
        // gfp's Met 1 and lyz's Met 12 as HETATM MSE; two calcium ions in chain A, 2 A from residue 5.
        let ion = |record: &str, serial: usize, p: V3| {
            format!("{record}{serial:>5} CA    CA A{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00          CA\n", 900 + serial, p.x, p.y, p.z)
        };
        let ions = ion("ATOM  ", 91, wa[4] + V3::new(2.0, 0.0, 0.0)) + &ion("HETATM", 92, wa[9] + V3::new(0.0, 2.0, 0.0));
        let two = semet_pdb(&pdb(&[("A", gfp, &wa), ("B", lyz, &wb)])).replace("END\n", &format!("{ions}END\n"));
        assert_eq!((two.matches("HETATM").count(), two.matches(" CA  MSE ").count()), (3, 2), "the fixture's MSE and ions");
        assert!(two.contains("ATOM     91 CA    CA A 991"), "the ATOM-record ion");
        let one = pdb(&[("Q", lyz, &moved(&wb))]);
        for (ca, cb, seq) in [(None, None, &gfp[..]), (Some("B"), Some("Q"), lyz), (Some("A"), None, gfp), (Some(""), Some(" "), gfp)] {
            let tm = read_alike(&two, &one, ca, cb);
            assert_eq!(tm.aligned_sequence_a.replace('-', ""), text(seq), "MSE reads as M, no ion is a residue");
        }
        // Chain B, its Met 12 a selenomethionine, against the methionine chain it was made from.
        let tm = read_alike(&two, &one, Some("B"), None);
        assert_eq!((tm.aligned_length, tm.sequence_identity), (lyz.len(), 1.0));
        for (ca, cb, text_a) in [(Some("Z"), None, two.as_str()), (None, None, ""), (None, None, "HEADER\nEND\n")] {
            let tm = align_structures_tm(text_a, &one, ca, cb).unwrap_err();
            let kabsch = align_pdb_chains_kabsch(text_a, &one, ca, cb).unwrap_err();
            assert_eq!(tm, kabsch);
        }

        // mmCIF: author id A is label chain C, its Met 12 a HETATM MSE; a calcium ion under author
        // chain A, as a HETATM and as an ATOM record, is not a residue.
        let mut cif = String::from(
            "data_SYN\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.label_atom_id\n\
             _atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n\
             _atom_site.auth_asym_id\n_atom_site.auth_seq_id\n_atom_site.Cartn_x\n\
             _atom_site.Cartn_y\n_atom_site.Cartn_z\n",
        );
        for (k, (aa, p)) in lyz.iter().zip(&wb).enumerate() {
            let (record, name) = if *aa == b'M' { ("HETATM", "MSE") } else { ("ATOM", one_to_three_aa(*aa)) };
            cif.push_str(&format!("{record} {} CA {name} C {} A {} {:.3} {:.3} {:.3}\n", k + 1, k + 1, k + 1, p.x, p.y, p.z));
        }
        cif.push_str("HETATM 900 CA CA Z . A 901 0.000 0.000 0.000\n");
        let with_atom_ion = format!("{cif}ATOM 901 CA CA Y . A 902 1.000 0.000 0.000\n");
        assert_eq!(cif.matches(" CA MSE C ").count(), 1, "the fixture's MSE");
        for source in [&cif, &with_atom_ion] {
            for wanted in [None, Some("A"), Some("C")] {
                let tm = read_alike(source, &one, wanted, None);
                assert_eq!(tm.chain_a, "A");
                assert_eq!(tm.aligned_sequence_a.replace('-', ""), text(lyz), "MSE reads as M, the ion is not a residue");
                assert!(tm.tm_score_a > 0.999, "{}", tm.tm_score_a);
            }
        }
        // The PDB chain and the mmCIF chain with the same MSE read alike.
        let tm = read_alike(&two, &cif, Some("B"), None);
        assert_eq!((tm.length_a, tm.length_b, tm.sequence_identity), (lyz.len(), lyz.len(), 1.0));

        // The ion's own label chain listed first, under the same author id: still not a chain.
        let (header, atoms) = cif.split_at(cif.find("ATOM ").unwrap());
        let ion_first = format!("{header}HETATM 900 CA CA Z . A 901 0.000 0.000 0.000\n{}", atoms.replace("HETATM 900 CA CA Z . A 901 0.000 0.000 0.000\n", ""));
        let tm = read_alike(&ion_first, &one, Some("A"), None);
        assert_eq!(tm.length_a, lyz.len());

        // An author id that is another chain's label id names the author chain: label chain P
        // (author A, the 30 gfp residues) and label chain A (author Q, the 34 lyz residues).
        let mut swapped = String::from(header);
        for (label, auth, seq, points) in [("P", "A", &gfp[..], &wa), ("A", "Q", &lyz[..], &wb)] {
            for (k, (aa, p)) in seq.iter().zip(points.iter()).enumerate() {
                swapped.push_str(&format!(
                    "ATOM {} CA {} {label} {} {auth} {} {:.3} {:.3} {:.3}\n",
                    k + 1,
                    one_to_three_aa(*aa),
                    k + 1,
                    k + 1,
                    p.x,
                    p.y,
                    p.z
                ));
            }
        }
        let by_author = read_alike(&swapped, &one, Some("A"), None);
        assert_eq!((by_author.chain_a.as_str(), by_author.length_a), ("A", gfp.len()));
        let by_label = read_alike(&swapped, &one, Some("P"), None);
        assert_eq!((by_label.chain_a.as_str(), by_label.length_a), ("A", gfp.len()));
    }

    /// A chain of fewer than three residues has no unique superposition and is refused by name.
    #[test]
    fn refuses_a_chain_too_short_to_superpose() {
        let w = walk(20, 5);
        let long = pdb(&[("A", &[b'G'; 20], &w)]);
        let short = pdb(&[("B", b"GG", &w[..2])]);
        let err = align_structures_tm(&long, &short, None, None).unwrap_err();
        assert!(err.contains("Structure B") && err.contains("chain B") && err.contains('2'), "{err}");
    }

    /// The final pairs are those within d8 = 1.5 L_min^0.3 + 3.5 A, L_min the shorter chain:
    /// B holds A's 30 residues (one of them displaced by 9 A) and 170 more, so the displaced pair
    /// lies between d8(30) = 7.66 A and d8(200) = 10.85 A, and past 5 A.
    #[test]
    fn keeps_the_pairs_within_d8_of_the_shorter_chain() {
        let a = walk(30, 21);
        let mut b = moved(&a);
        let push = (walk(2, 9)[1] - walk(2, 9)[0]).normalize() * 9.0;
        b[12] += q() * push;
        let tail = walk(171, 33);
        let last = b[29];
        b.extend(tail.windows(2).scan(last, |p, w| {
            *p += w[1] - w[0];
            Some(*p)
        }));
        let seq_b = vec![b'G'; 200];
        let r = align_structures_tm(&pdb(&[("A", &[b'G'; 30], &a)]), &pdb(&[("B", &seq_b, &b)]), None, None)
            .expect("alignment");
        let pairs = pairs_of_strings(&r.aligned_sequence_a, &r.aligned_sequence_b);
        let expected: Vec<(usize, usize)> = (0..30).filter(|&k| k != 12).map(|k| (k, k)).collect();
        assert_eq!(pairs, expected, "the pair 9 A apart is past d8(30) and is not aligned");
        assert_eq!(r.aligned_length, 29);
    }

    /// `rmsd_angstrom` is the RMSD of the aligned pairs after their own least-squares
    /// superposition, which a TM-score superposition only matches when every pair fits: B is A
    /// with its last 12 of 50 residues shifted 3 A together, so the two superpositions differ.
    #[test]
    fn rmsd_is_over_the_aligned_pairs_own_superposition() {
        let a = walk(50, 4);
        let mut b = moved(&a);
        for p in b.iter_mut().skip(38) {
            *p += q() * V3::new(3.0, 0.0, 0.0);
        }
        let seq = vec![b'A'; 50];
        let r = align_structures_tm(&pdb(&[("A", &seq, &a)]), &pdb(&[("B", &seq, &b)]), None, None).expect("alignment");
        let (a, b) = (as_written(&a), as_written(&b));
        let pairs = pairs_of_strings(&r.aligned_sequence_a, &r.aligned_sequence_b);
        assert!(pairs.len() >= 45, "{} pairs", pairs.len());
        let under = |t: &[[f64; 4]; 4]| {
            (pairs.iter().map(|&(i, j)| (a[i] - apply(t, &b[j])).norm_squared()).sum::<f64>() / pairs.len() as f64).sqrt()
        };
        // The least-squares fit, by our own Kabsch, is the minimum over rigid motions.
        let m = kabsch(&a, &b, &pairs);
        let r_ls = m.rot;
        let fit = [
            [r_ls[(0, 0)], r_ls[(0, 1)], r_ls[(0, 2)], m.shift.x],
            [r_ls[(1, 0)], r_ls[(1, 1)], r_ls[(1, 2)], m.shift.y],
            [r_ls[(2, 0)], r_ls[(2, 1)], r_ls[(2, 2)], m.shift.z],
            [0.0, 0.0, 0.0, 1.0],
        ];
        assert!((r.rmsd_angstrom - under(&fit)).abs() < 1e-9, "RMSD {} least squares {}", r.rmsd_angstrom, under(&fit));
        assert!(under(&r.transformation_matrix) > r.rmsd_angstrom + 0.05, "the TM-score superposition is a different one");
    }

    /// A mirror image cannot be superposed by a rotation: the transform stays a proper rotation
    /// (determinant +1) and the TM-score stays well below 1.
    #[test]
    fn a_mirror_image_is_not_superposed() {
        let a = walk(40, 13);
        let mirror: Vec<V3> = a.iter().map(|p| V3::new(-p.x, p.y, p.z)).collect();
        let seq = vec![b'A'; 40];
        let r = align_structures_tm(&pdb(&[("A", &seq, &a)]), &pdb(&[("B", &seq, &mirror)]), None, None)
            .expect("alignment");
        let t = &r.transformation_matrix;
        let rot = Matrix3::new(t[0][0], t[0][1], t[0][2], t[1][0], t[1][1], t[1][2], t[2][0], t[2][1], t[2][2]);
        assert!((rot.determinant() - 1.0).abs() < 1e-9, "determinant {}", rot.determinant());
        assert!(r.tm_score_a < 0.9, "a mirror image scored {}", r.tm_score_a);
    }

    /// Gaps at either end of either chain cost nothing; a gap inside costs its opening once.
    #[test]
    fn dp_leaves_end_gaps_free() {
        // One residue of B against three of A: with free end gaps the best-scoring pair wins,
        // though it leaves an A residue on either side unpaired.
        let scores = [0.2, 0.9, 0.5];
        assert_eq!(dp_align(3, 1, -0.6, |i, _| scores[i]), vec![None, Some(0), None]);
        assert_eq!(dp_align(1, 3, -0.6, |_, j| scores[j]), vec![Some(1)]);
        // An internal gap is taken when it gains more than its opening costs, and only then.
        let s = |i: usize, j: usize| match (i, j) {
            (0, 0) | (1, 1) | (3, 2) => 1.0,
            (2, 2) => 0.1,
            _ => 0.0,
        };
        assert_eq!(dp_align(4, 3, -0.6, s), vec![Some(0), Some(1), None, Some(2)], "0.9 gained for an opening of 0.6");
        assert_eq!(dp_align(4, 3, -2.5, s), vec![Some(0), Some(1), Some(2), None], "not worth an opening of 2.5");
    }

    /// Helix and strand from Cα distances alone: an ideal α-helix trace (100° and 1.5 Å per
    /// residue, radius 2.3 Å) and a β-strand zigzag (3.3 Å rise, ±0.9 Å), two coil residues at
    /// each end.
    #[test]
    fn assigns_helix_and_strand_from_ca_distances() {
        let helix: Vec<V3> = (0..12)
            .map(|i| {
                let t = (i as f64) * 100f64.to_radians();
                V3::new(2.3 * t.cos(), 2.3 * t.sin(), 1.5 * i as f64)
            })
            .collect();
        assert_eq!(ca_secondary_structure(&helix), b"CCHHHHHHHHCC");
        let strand: Vec<V3> =
            (0..10).map(|i| V3::new(3.3 * i as f64, if i % 2 == 0 { 0.9 } else { -0.9 }, 0.0)).collect();
        assert_eq!(ca_secondary_structure(&strand), b"CCEEEEEECC");

        // The tolerances are wide: a helix of radius 2.8 Å, its (i, i+2) distances 0.83 Å off the
        // ideal 5.45, is still a helix (within 2.1 Å), and a strand rising 3.5 Å a residue, its
        // (i, i+4) distances 1 Å off the ideal 13.0, still a strand (within 1.42 Å).
        let wide_helix: Vec<V3> = (0..12)
            .map(|i| {
                let t = (i as f64) * 100f64.to_radians();
                V3::new(2.8 * t.cos(), 2.8 * t.sin(), 1.5 * i as f64)
            })
            .collect();
        assert_eq!(ca_secondary_structure(&wide_helix), b"CCHHHHHHHHCC");
        let long_strand: Vec<V3> =
            (0..10).map(|i| V3::new(3.5 * i as f64, if i % 2 == 0 { 0.9 } else { -0.9 }, 0.0)).collect();
        assert_eq!(ca_secondary_structure(&long_strand), b"CCEEEEEECC");
    }

    /// When fewer than three pairs lie within the cut-off, the search re-superposes on the three
    /// closest, the fewest that fix a rotation. Four pairs 12 Å apart, the fourth 25 Å out of
    /// place: their own least-squares fit leaves every pair farther apart than the first cut-off,
    /// and only the three closest, re-superposed, put the three good pairs on each other (TM 3/4
    /// with d0 0.5 Å). One pair fixes no rotation: superposed on it alone, the other two good
    /// pairs stay about 12 Å apart, past every cut-off, and the search ends there.
    #[test]
    fn too_few_close_pairs_are_widened_to_the_three_closest() {
        let a = vec![V3::new(0.0, 0.0, 0.0), V3::new(12.0, 0.0, 0.0), V3::new(0.0, 12.0, 0.0), V3::new(6.0, 6.0, 9.0)];
        let mut b = moved(&a);
        b[3] += q() * V3::new(0.0, 0.0, 25.0);
        let pairs: Vec<(usize, usize)> = (0..4).map(|k| (k, k)).collect();
        let scoring = Scoring::for_length(4);
        let fit = kabsch(&a, &b, &pairs);
        assert!(
            pairs.iter().all(|&(i, j)| (a[i] - fit.apply(&b[j])).norm() >= scoring.first_cut),
            "the fixture: a pair within the first cut-off of the four-pair fit"
        );
        let (tm, motion) = tm_superposition(&a, &b, &pairs, &scoring, 1);
        assert!(tm > 0.75 - 1e-3, "TM-score {tm}");
        for k in 0..3 {
            assert!((motion.apply(&b[k]) - a[k]).norm() < 1e-6, "pair {k}");
        }
    }

    /// The secondary-structure start is dynamic programming on the state match with a gap
    /// opening of -1 (Zhang & Skolnick 2005); on this pair a free gap gives another alignment.
    #[test]
    fn the_secondary_structure_start_opens_gaps_at_minus_one() {
        let (a, b) = two_domains(595);
        let search = Search::new(&a, &b);
        let same = |i: usize, j: usize| search.same_ss(i, j);
        let st = initial_alignments(&search);
        assert_eq!(st.secondary_structure, dp_align(a.len(), b.len(), -1.0, same));
        assert_ne!(st.secondary_structure, dp_align(a.len(), b.len(), 0.0, same), "the fixture");
    }

    /// Two domains of 36 and 24 residues moved by different motions: the TM-score search must
    /// find the motion of the larger one, which superposing every pair at once does not give.
    #[test]
    fn tm_search_finds_the_larger_domain() {
        let a = walk(60, 17);
        let other = *Rotation3::from_axis_angle(&Unit::new_normalize(V3::new(0.0, 1.0, -1.0)), 1.9).matrix();
        let b: Vec<V3> = a
            .iter()
            .enumerate()
            .map(|(k, p)| if k < 36 { q() * p + s() } else { other * p + V3::new(-20.0, 4.0, 9.0) })
            .collect();
        let pairs: Vec<(usize, usize)> = (0..60).map(|k| (k, k)).collect();
        let all_at_once = kabsch(&a, &b, &pairs);
        assert!((all_at_once.apply(&b[0]) - a[0]).norm() > 0.5, "the fixture does not separate the two");
        let (tm, motion) = tm_superposition(&a, &b, &pairs, &Scoring::for_length(60), 1);
        assert!(tm >= 36.0 / 60.0 - 1e-9, "TM-score {tm}: the larger domain was not found");
        for k in 0..36 {
            assert!((motion.apply(&b[k]) - a[k]).norm() < 1e-6, "residue {k}");
        }
    }

    /// Two chains that share their fold in parts, seeded by `seed`: A is an irregular trace of
    /// 36 to 60 residues; B is A with its residues from about the middle on turned by a second
    /// rotation (two domains), every residue displaced by 1 to 2.5 Å, and nine residues more.
    /// Such pairs have competing alignments, one per domain or a compromise, which different
    /// starts reach.
    fn two_domains(seed: u64) -> (Vec<V3>, Vec<V3>) {
        let n = 36 + (seed % 5) as usize * 6;
        let a = walk(n, 100 + seed);
        let axis = Unit::new_normalize(V3::new(0.3, 1.0, -0.7));
        let other = *Rotation3::from_axis_angle(&axis, 0.4 + (seed % 7) as f64 * 0.2).matrix();
        let cut = n / 2 + (seed % 3) as usize * 3;
        let b: Vec<V3> =
            a.iter().enumerate().map(|(k, p)| if k < cut { q() * p + s() } else { q() * (other * p) + s() }).collect();
        let mut b = jittered(&b, 1.0 + (seed % 4) as f64 * 0.5, seed + 7);
        let tail = walk(10, seed + 900);
        let last = b[b.len() - 1];
        b.extend(tail.windows(2).scan(last, |p, w| {
            *p += w[1] - w[0];
            Some(*p)
        }));
        (a, b)
    }

    /// The finished score of one start alone: refined, then finished.
    fn finished_alone(search: &Search, start: &ResidueMap) -> f64 {
        best_finished(search, vec![start.clone()]).score
    }

    /// The winning start is the one whose finished score, the very score reported, is best; so no
    /// start alone scores above all of them together, and adding a start to any set of starts
    /// never lowers its score. The fixture is one where the refinement's own (search-scale)
    /// score ranks the local-superposition start first, though it finishes 0.015 below the
    /// threading start: picked by that score, all four starts would report less than threading
    /// alone.
    #[test]
    fn adding_a_start_never_lowers_the_score() {
        let (a, b) = two_domains(364);
        let search = Search::new(&a, &b);
        let st = initial_alignments(&search);
        let named = [&st.threading, &st.secondary_structure, &st.combined, st.local.as_ref().expect("local start")];
        let quick: Vec<f64> = named.iter().map(|m| search.quick(&pairs_of(&refine(&search, (*m).clone()))).0).collect();
        let alone: Vec<f64> = named.iter().map(|m| finished_alone(&search, m)).collect();
        assert!(quick[3] > quick[0] && alone[0] > alone[3] + 0.01, "the fixture: quick {quick:?}, finished {alone:?}");

        // Every subset of the four starts, and every start added to it.
        let score_of = |mask: usize| {
            let chosen: Vec<ResidueMap> = (0..4).filter(|k| mask & (1 << k) != 0).map(|k| named[k].clone()).collect();
            best_finished(&search, chosen).score
        };
        let scores: Vec<f64> = (0..16).map(score_of).collect();
        for mask in 1..16usize {
            for k in (0..4).filter(|k| mask & (1 << k) == 0) {
                let more = mask | (1 << k);
                assert!(scores[more] >= scores[mask], "adding start {k} to {mask:04b}: {} < {}", scores[more], scores[mask]);
            }
        }
        let best_alone = alone.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(scores[15], best_alone);
        // The reported TM-score normalised by the shorter chain (A) is that score.
        let found = align_traces(&a, &b);
        assert_eq!(found.tm_a, scores[15]);
    }

    /// Each of the four starts is, on some pair, the only one that leads to the best alignment
    /// found, by more than 0.003 of TM-score, and that alignment is the one reported; so none of
    /// them can be dropped without the result changing. The pairs are two-domain fixtures.
    #[test]
    fn each_start_alone_reaches_an_alignment_the_others_miss() {
        for (seed, winner) in [(71u64, 0usize), (595, 1), (1359, 2), (1452, 3)] {
            let (a, b) = two_domains(seed);
            let search = Search::new(&a, &b);
            let st = initial_alignments(&search);
            let named = [&st.threading, &st.secondary_structure, &st.combined, st.local.as_ref().expect("local start")];
            let alone: Vec<f64> = named.iter().map(|m| finished_alone(&search, m)).collect();
            for (k, &score) in alone.iter().enumerate().filter(|&(k, _)| k != winner) {
                assert!(alone[winner] > score + 3e-3, "seed {seed}: start {winner} {alone:?} does not beat start {k}");
            }
            let found = align_traces(&a, &b);
            assert_eq!(found.tm_a, alone[winner], "seed {seed}: the reported score is start {winner}'s");
        }
    }

    /// Gapless threading tries every offset that overlaps at least half the shorter chain: B's
    /// first 20 residues are A's last 20 moved, the rest of each chain unrelated, so the one
    /// threading that superposes is an overlap of exactly half of 40.
    #[test]
    fn gapless_threading_tries_offsets_overlapping_half_the_shorter_chain() {
        let a = walk(40, 41);
        let mut b = moved(&a[20..]);
        let last = b[19];
        let tail = walk(21, 43);
        b.extend(tail.windows(2).scan(last, |p, w| {
            *p += w[1] - w[0];
            Some(*p)
        }));
        let (map, _) = gapless_threading(&Search::new(&a, &b));
        let expected: Vec<Option<usize>> = (0..40).map(|i| (i >= 20).then(|| i - 20)).collect();
        assert_eq!(map, expected);
    }

    /// Chains long enough to have more offsets than are searched (251 against 200): the offsets
    /// searched are those estimated best, which include the one that superposes. B's first 130
    /// residues are A's last 130 moved; the rest of each chain is unrelated.
    #[test]
    fn gapless_threading_of_long_chains_searches_the_best_estimated_offsets() {
        let a = walk(250, 51);
        let mut b = moved(&a[120..]);
        let last = b[129];
        let tail = walk(121, 53);
        b.extend(tail.windows(2).scan(last, |p, w| {
            *p += w[1] - w[0];
            Some(*p)
        }));
        let search = Search::new(&a, &b);
        let offsets = (0..2 * 250 - 1).filter(|k| 250 - (*k as isize - 249).unsigned_abs() >= 125).count();
        assert!(offsets > THREADING_SEARCHED, "{offsets} offsets");
        let (map, _) = gapless_threading(&search);
        let expected: Vec<Option<usize>> = (0..250).map(|i| (i >= 120).then(|| i - 120)).collect();
        assert_eq!(map, expected);
    }
}
