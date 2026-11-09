// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Pairwise sequence alignment powered by `rust-bio` (`bio::alignment::pairwise::Aligner`).
//! Supports Gotoh affine-gap Global (Needleman-Wunsch), Local (Smith-Waterman), and
//! Semi-Global (free end-gap overlap) modes for DNA/RNA (IUPAC-aware) and Protein
//! (`BLOSUM62` / `PAM250`).

use crate::poa_and_banded::{align_within_band_ceiling, band_description, BandRun, BANDED_HEURISTIC};
use bio::alignment::pairwise::{Aligner, MatchFunc, Scoring};
use bio::alignment::AlignmentOperation;
use bio::scores::{blosum62, pam250};
use molbiocraft_core::clean_alpha_sequence;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairwiseMode {
    Global,
    Local,
    Semiglobal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScoringMatrixKind {
    DnaIupac,
    Blosum62,
    Pam250,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairwiseAlignmentResult {
    pub aligned_seq1: String,
    pub aligned_seq2: String,
    pub midline: String,
    pub score: i32,
    pub matches: usize,
    pub mismatches: usize,
    pub gaps: usize,
    pub identity_pct: f64,
    pub similarity_pct: f64,
    pub xstart: usize,
    pub xend: usize,
    pub ystart: usize,
    pub yend: usize,
    pub cigar: String,
    pub algorithm: String,
    pub engine_used: String,
}

/// A pairwise alignment requested by the names of its mode and scoring matrix, as an RPC payload
/// gives them ([`align_pairwise_named`]): the alignment's own fields, and `warnings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedPairwiseAlignment {
    #[serde(flatten)]
    pub alignment: PairwiseAlignmentResult,
    /// What the alignment substituted for its request (D0005), one plain sentence per event: an
    /// unknown mode or scoring-matrix name replaced by its default. Always serialised, as an empty
    /// list when every name was known.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Heuristic detector for protein sequences when caller does not specify matrix explicitly.
pub fn looks_like_protein_sequence(seq: &str) -> bool {
    seq.bytes().any(|b| !b"ACGTURYSWKMBDHVN-.".contains(&b.to_ascii_uppercase()))
}

/// The residues [`align_pairwise_gotoh`] aligns: alphabetic characters, upper case. Translated
/// sequences keep their stop codons ('*', BLOSUM62 −4) so residue positions stay put.
fn alignment_residues(raw: &str) -> String {
    if raw.contains('*') {
        raw.chars().filter(|c| c.is_ascii_alphabetic() || *c == '*').map(|c| c.to_ascii_uppercase()).collect()
    } else {
        clean_alpha_sequence(raw)
    }
}

/// The matrix chosen when none is named: BLOSUM62 when either sequence looks like protein, the
/// IUPAC nucleotide matrix otherwise.
fn default_matrix(s1: &str, s2: &str) -> ScoringMatrixKind {
    if looks_like_protein_sequence(s1) || looks_like_protein_sequence(s2) {
        ScoringMatrixKind::Blosum62
    } else {
        ScoringMatrixKind::DnaIupac
    }
}

/// [`align_pairwise_gotoh`] with its mode and scoring matrix given by name, as an RPC payload gives
/// them (any case, surrounding spaces ignored): mode `global`, `local` or `semiglobal`; matrix
/// `auto` (the [`default_matrix`] for the pair), `blosum62`, `pam250`, or `nucleotide` /
/// `dnaiupac`. An unknown mode aligns globally and an unknown matrix with the default for the pair,
/// and `warnings` names each, with what was used in its place (D0005).
#[allow(clippy::too_many_arguments)]
pub fn align_pairwise_named(
    raw_seq1: &str,
    raw_seq2: &str,
    mode: &str,
    matrix: &str,
    match_score: i32,
    mismatch_penalty: i32,
    gap_open: i32,
    gap_extend: i32,
    max_bases: usize,
) -> NamedPairwiseAlignment {
    let mut warnings = Vec::new();
    let mode_kind = match mode.trim().to_ascii_lowercase().as_str() {
        "global" => PairwiseMode::Global,
        "local" => PairwiseMode::Local,
        "semiglobal" => PairwiseMode::Semiglobal,
        _ => {
            warnings.push(format!("Unknown alignment mode '{mode}': aligned in global mode (Needleman-Wunsch)."));
            PairwiseMode::Global
        }
    };
    let matrix_kind = match matrix.trim().to_ascii_lowercase().as_str() {
        "auto" => None,
        "blosum62" => Some(ScoringMatrixKind::Blosum62),
        "pam250" => Some(ScoringMatrixKind::Pam250),
        "nucleotide" | "dnaiupac" => Some(ScoringMatrixKind::DnaIupac),
        _ => {
            let used = default_matrix(&alignment_residues(raw_seq1), &alignment_residues(raw_seq2));
            let (label, alphabet) = match used {
                ScoringMatrixKind::Blosum62 => ("BLOSUM62", "protein"),
                ScoringMatrixKind::Pam250 => ("PAM250", "protein"),
                ScoringMatrixKind::DnaIupac => ("the IUPAC nucleotide matrix", "nucleotide"),
            };
            warnings.push(format!(
                "Unknown scoring matrix '{matrix}': aligned with {label}, the default for {alphabet} sequences."
            ));
            Some(used)
        }
    };
    NamedPairwiseAlignment {
        alignment: align_pairwise_gotoh(
            raw_seq1,
            raw_seq2,
            mode_kind,
            matrix_kind,
            match_score,
            mismatch_penalty,
            gap_open,
            gap_extend,
            max_bases,
        ),
        warnings,
    }
}

/// Symmetric ambiguity compatibility for two aligned residues (not motif matching).
pub(crate) fn compatible_nucleotides(a: u8, b: u8) -> bool {
    fn mask(b: u8) -> u8 {
        match b.to_ascii_uppercase() {
            b'A' => 1, b'C' => 2, b'G' => 4, b'T' | b'U' => 8,
            b'R' => 5, b'Y' => 10, b'S' => 6, b'W' => 9, b'K' => 12,
            b'M' => 3, b'B' => 14, b'D' => 13, b'H' => 11, b'V' => 7,
            b'N' => 15, _ => 0,
        }
    }
    mask(a) & mask(b) != 0
}

/// Core Gotoh affine-gap pairwise alignment via `rust-bio`.
pub fn align_pairwise_gotoh(
    raw_seq1: &str,
    raw_seq2: &str,
    mode: PairwiseMode,
    matrix: Option<ScoringMatrixKind>,
    match_score: i32,
    mismatch_penalty: i32,
    gap_open: i32,
    gap_extend: i32,
    max_bases: usize,
) -> PairwiseAlignmentResult {
    // Sequences are never truncated (an earlier cap silently aligned only the first 2.4–4 kb).
    // `max_bases` is kept for API compatibility; the exact dynamic programme is used while the
    // matrix stays within EXACT_CELLS, a k-mer-banded one beyond that.
    let _ = max_bases;
    let s1_clean = alignment_residues(raw_seq1);
    let s2_clean = alignment_residues(raw_seq2);
    let s1 = s1_clean.as_str();
    let s2 = s2_clean.as_str();
    let banded = s1.len().saturating_mul(s2.len()) > EXACT_CELLS;

    let mut algo_label = match mode {
        PairwiseMode::Local => "Smith-Waterman (Local)".to_string(),
        PairwiseMode::Global => "Needleman-Wunsch (Global)".to_string(),
        PairwiseMode::Semiglobal => "Semi-global (free end gaps)".to_string(),
    };

    if s1.is_empty() && s2.is_empty() {
        return PairwiseAlignmentResult {
            aligned_seq1: String::new(),
            aligned_seq2: String::new(),
            midline: String::new(),
            score: 0,
            matches: 0,
            mismatches: 0,
            gaps: 0,
            identity_pct: 0.0,
            similarity_pct: 0.0,
            xstart: 0,
            xend: 0,
            ystart: 0,
            yend: 0,
            cigar: String::new(),
            algorithm: algo_label,
            engine_used: "C++ Native / Rust FFI".to_string(),
        };
    }

    let matrix_kind = matrix.unwrap_or_else(|| default_matrix(s1, s2));

    // Note: rust-bio uses negative gap_open and gap_extend penalties.
    let go = if gap_open > 0 { -gap_open } else { gap_open };
    let ge = if gap_extend > 0 { -gap_extend } else { gap_extend };
    let mm = if mismatch_penalty > 0 {
        -mismatch_penalty
    } else {
        mismatch_penalty
    };
    let ms = match_score.abs().max(1);

    let x = s1.as_bytes();
    let y = s2.as_bytes();

    let k = if matrix_kind == ScoringMatrixKind::DnaIupac { 11 } else { 3 };
    let ran = match matrix_kind {
        ScoringMatrixKind::Blosum62 => run_modes(Scoring::new(go, ge, blosum62), x, y, mode, banded, k),
        ScoringMatrixKind::Pam250 => run_modes(Scoring::new(go, ge, pam250), x, y, mode, banded, k),
        ScoringMatrixKind::DnaIupac => {
            let score_fn = move |a: u8, b: u8| -> i32 {
                if a == b {
                    ms
                } else if compatible_nucleotides(a, b) {
                    (ms / 2).max(1)
                } else {
                    mm
                }
            };
            run_modes(Scoring::new(go, ge, score_fn), x, y, mode, banded, k)
        }
    };
    let Some((alignment, band_run)) = ran else {
        return not_aligned(format!(
            "Not aligned: no band this aligner can build through the {} x {} matrix fits rust-bio's 5,000,000-cell \
             band limit, and the matrix is too large to align in full; align shorter sequences",
            x.len() + 1,
            y.len() + 1
        ));
    };
    match band_run {
        // the full matrix, which is exact, so the plain label stands
        None | Some(BandRun::FullMatrix) => {}
        Some(BandRun::Diagonal { w }) => algo_label.push_str(&format!(
            " — banded along the main diagonal (sequences too long for the full matrix, sharing no {k}-mer; w={w}): {BANDED_HEURISTIC}"
        )),
        Some(run) => algo_label.push_str(&format!(
            " — banded around shared k-mers (sequences too long for the full matrix; {}): {BANDED_HEURISTIC}",
            band_description(run, k, band_width(x, y))
        )),
    }

    reconstruct_alignment_columns(x, y, &alignment, mode, matrix_kind, algo_label)
}

/// A result that aligned nothing, saying why in `algorithm`: no rows, no columns, score 0.
pub(crate) fn not_aligned(reason: String) -> PairwiseAlignmentResult {
    PairwiseAlignmentResult {
        aligned_seq1: String::new(),
        aligned_seq2: String::new(),
        midline: String::new(),
        score: 0,
        matches: 0,
        mismatches: 0,
        gaps: 0,
        identity_pct: 0.0,
        similarity_pct: 0.0,
        xstart: 0,
        xend: 0,
        ystart: 0,
        yend: 0,
        cigar: String::new(),
        algorithm: reason,
        engine_used: "none (not aligned)".to_string(),
    }
}

/// Largest dynamic-programming matrix aligned exactly (cells): about 50 M (7 kb × 7 kb), a few
/// hundred MB of traceback at most. Larger pairs use rust-bio's k-mer banded aligner.
pub(crate) const EXACT_CELLS: usize = 50_000_000;

/// Width of the k-mer band for a pair past [`EXACT_CELLS`]: 64, or 1/200 of the longer sequence up
/// to 512.
fn band_width(x: &[u8], y: &[u8]) -> usize {
    64.max((x.len().max(y.len()) / 200).min(512))
}

/// Run the requested alignment mode over the full matrix, or with `banded` in a k-mer band of
/// [`band_width`] (see [`align_within_band_ceiling`], which never hands back rust-bio's ceiling
/// sentinel). Local mode bands along the sdpkpp chain extended by the LCSk++ path, as banded local
/// does (BG-01M6PX3B); global and semi-global along rust-bio's sdpkpp chain. Returns how a band
/// ran, and `None` when `align_within_band_ceiling` finds no band that fits rust-bio's ceiling.
///
/// "Semi-global" means free end gaps, the way EMBOSS `needle` aligns by default, where end gaps
/// carry no penalty unless end-gap penalties are switched on: an overlap alignment in which, at
/// each end, the overhanging residues of **one** sequence are left unaligned at no cost. It is
/// the best of four clip combinations (x or y prefix × x or y suffix). Clipping both prefixes at
/// once would turn it into a local alignment, which earlier versions did; rust-bio's own
/// `semiglobal` frees only the second sequence's ends.
fn run_modes<F: MatchFunc + Clone>(
    scoring: Scoring<F>,
    x: &[u8],
    y: &[u8],
    mode: PairwiseMode,
    banded: bool,
    k: usize,
) -> Option<(bio::alignment::Alignment, Option<BandRun>)> {
    use bio::alignment::pairwise::MIN_SCORE;
    use bio::alignment::AlignmentMode;
    let band_w = band_width(x, y);
    // the clip penalties pick the mode: `Scoring::new` leaves them at MIN_SCORE (global)
    let custom = |sc: Scoring<F>| -> Option<(bio::alignment::Alignment, Option<BandRun>)> {
        if banded {
            align_within_band_ceiling(x, y, sc, k, band_w, false).map(|(aln, run)| (aln, Some(run)))
        } else {
            Some((Aligner::with_capacity_and_scoring(x.len(), y.len(), sc).custom(x, y), None))
        }
    };
    match mode {
        PairwiseMode::Global if !banded => Some((Aligner::with_capacity_and_scoring(x.len(), y.len(), scoring).global(x, y), None)),
        PairwiseMode::Local if !banded => Some((Aligner::with_capacity_and_scoring(x.len(), y.len(), scoring).local(x, y), None)),
        PairwiseMode::Global => {
            let (mut aln, run) = align_within_band_ceiling(x, y, scoring, k, band_w, false)?;
            aln.mode = AlignmentMode::Global;
            Some((aln, Some(run)))
        }
        PairwiseMode::Local => {
            let (mut aln, run) = align_within_band_ceiling(x, y, scoring.xclip(0).yclip(0), k, band_w, true)?;
            aln.mode = AlignmentMode::Local;
            aln.filter_clip_operations();
            Some((aln, Some(run)))
        }
        PairwiseMode::Semiglobal => {
            let free = |on: bool| if on { 0 } else { MIN_SCORE };
            let mut best: Option<(bio::alignment::Alignment, Option<BandRun>)> = None;
            for (start_x, end_x) in [(true, true), (true, false), (false, true), (false, false)] {
                let sc = scoring
                    .clone()
                    .xclip_prefix(free(start_x))
                    .yclip_prefix(free(!start_x))
                    .xclip_suffix(free(end_x))
                    .yclip_suffix(free(!end_x));
                if let Some(candidate) = custom(sc) {
                    if best.as_ref().map_or(true, |b| candidate.0.score > b.0.score) {
                        best = Some(candidate);
                    }
                }
            }
            let (mut aln, run) = best?;
            aln.mode = AlignmentMode::Semiglobal;
            aln.filter_clip_operations();
            Some((aln, run))
        }
    }
}

fn encode_cigar_from_columns(a1: &[u8], a2: &[u8]) -> String {
    let mut cigar = String::new();
    let mut cur_op = 0u8;
    let mut cur_len = 0usize;
    for (&bx, &by) in a1.iter().zip(a2.iter()) {
        let op = if bx == b'-' {
            b'D'
        } else if by == b'-' {
            b'I'
        } else if bx == by {
            b'='
        } else {
            b'X'
        };
        if op == cur_op {
            cur_len += 1;
        } else {
            if cur_len > 0 {
                cigar.push_str(&format!("{cur_len}{}", cur_op as char));
            }
            cur_op = op;
            cur_len = 1;
        }
    }
    if cur_len > 0 {
        cigar.push_str(&format!("{cur_len}{}", cur_op as char));
    }
    cigar
}
/// Convenience wrapper matching the historical 7-parameter Needleman-Wunsch / Smith-Waterman signature.
pub fn align_pairwise_standard(
    raw_seq1: &str,
    raw_seq2: &str,
    local: bool,
    match_score: i32,
    mismatch_penalty: i32,
    gap_open: i32,
    gap_extend: i32,
) -> PairwiseAlignmentResult {
    align_pairwise_gotoh(
        raw_seq1,
        raw_seq2,
        if local {
            PairwiseMode::Local
        } else {
            PairwiseMode::Global
        },
        None,
        match_score,
        mismatch_penalty,
        gap_open,
        gap_extend,
        2400,
    )
}

fn reconstruct_alignment_columns(
    x: &[u8],
    y: &[u8],
    aln: &bio::alignment::Alignment,
    mode: PairwiseMode,
    matrix_kind: ScoringMatrixKind,
    algorithm: String,
) -> PairwiseAlignmentResult {
    let cap = aln.operations.len().max(x.len().max(y.len()));
    let mut a1 = Vec::with_capacity(cap);
    let mut a2 = Vec::with_capacity(cap);
    let mut mid = Vec::with_capacity(cap);

    let mut matches = 0usize;
    let mut similar = 0usize;
    let mut mismatches = 0usize;
    let mut gaps = 0usize;

    let mut ix = match mode {
        PairwiseMode::Local => aln.xstart,
        PairwiseMode::Global => 0,
        PairwiseMode::Semiglobal => {
            // Prepend unaligned prefix of x before xstart in semiglobal
            0
        }
    };
    let mut iy = match mode {
        PairwiseMode::Local | PairwiseMode::Semiglobal => aln.ystart,
        PairwiseMode::Global => 0,
    };

    if mode == PairwiseMode::Semiglobal {
        // Free end gaps: show unaligned flanks of both sequences instead of dropping them.
        while ix < aln.xstart && ix < x.len() {
            a1.push(x[ix]);
            a2.push(b'-');
            mid.push(b' ');
            gaps += 1;
            ix += 1;
        }
        let mut jy = 0usize;
        while jy < aln.ystart && jy < y.len() {
            a1.push(b'-');
            a2.push(y[jy]);
            mid.push(b' ');
            gaps += 1;
            jy += 1;
        }
    }

    for &op in &aln.operations {
        match op {
            AlignmentOperation::Match => {
                let bx = x.get(ix).copied().unwrap_or(b'N');
                let by = y.get(iy).copied().unwrap_or(b'N');
                a1.push(bx);
                a2.push(by);
                mid.push(b'|');
                matches += 1;
                similar += 1;
                ix += 1;
                iy += 1;
            }
            AlignmentOperation::Subst => {
                let bx = x.get(ix).copied().unwrap_or(b'N');
                let by = y.get(iy).copied().unwrap_or(b'N');
                a1.push(bx);
                a2.push(by);
                if bx == by {
                    mid.push(b'|');
                    matches += 1;
                    similar += 1;
                } else {
                    let pos_sub = match matrix_kind {
                        ScoringMatrixKind::Blosum62 => blosum62(bx, by) > 0,
                        ScoringMatrixKind::Pam250 => pam250(bx, by) > 0,
                        ScoringMatrixKind::DnaIupac => compatible_nucleotides(bx, by),
                    };
                    if pos_sub {
                        mid.push(b':');
                        similar += 1;
                    } else {
                        mid.push(b'.');
                    }
                    mismatches += 1;
                }
                ix += 1;
                iy += 1;
            }
            // Note on rust-bio convention:
            // In `bio::alignment::pairwise::Aligner`, `Del` advances y (target) while x stays,
            // and `Ins` advances x (query) while y stays. Let's inspect `xend - xstart` vs op counts
            // to be 100% faithful to rust-bio's exact semantics!
            AlignmentOperation::Ins => {
                let bx = x.get(ix).copied().unwrap_or(b'-');
                a1.push(bx);
                a2.push(b'-');
                mid.push(b' ');
                gaps += 1;
                ix += 1;
            }
            AlignmentOperation::Del => {
                let by = y.get(iy).copied().unwrap_or(b'-');
                a1.push(b'-');
                a2.push(by);
                mid.push(b' ');
                gaps += 1;
                iy += 1;
            }
            AlignmentOperation::Xclip(len) => {
                if mode == PairwiseMode::Global {
                    for _ in 0..len {
                        if let Some(&bx) = x.get(ix) {
                            a1.push(bx);
                            a2.push(b'-');
                            mid.push(b' ');
                            gaps += 1;
                        }
                        ix += 1;
                    }
                } else {
                    ix += len;
                }
            }
            AlignmentOperation::Yclip(len) => {
                if mode == PairwiseMode::Global {
                    for _ in 0..len {
                        if let Some(&by) = y.get(iy) {
                            a1.push(b'-');
                            a2.push(by);
                            mid.push(b' ');
                            gaps += 1;
                        }
                        iy += 1;
                    }
                } else {
                    iy += len;
                }
            }
        }
    }

    if mode == PairwiseMode::Semiglobal {
        while ix < x.len() {
            a1.push(x[ix]);
            a2.push(b'-');
            mid.push(b' ');
            gaps += 1;
            ix += 1;
        }
        while iy < y.len() {
            a1.push(b'-');
            a2.push(y[iy]);
            mid.push(b' ');
            gaps += 1;
            iy += 1;
        }
    }

    let total_cols = a1.len().max(1);
    let identity_pct = ((matches as f64 / total_cols as f64) * 10000.0).round() / 100.0;
    let similarity_pct = ((similar as f64 / total_cols as f64) * 10000.0).round() / 100.0;

    PairwiseAlignmentResult {
        aligned_seq1: String::from_utf8_lossy(&a1).into_owned(),
        aligned_seq2: String::from_utf8_lossy(&a2).into_owned(),
        midline: String::from_utf8_lossy(&mid).into_owned(),
        score: if mode == PairwiseMode::Local {
            aln.score.max(0)
        } else {
            aln.score
        },
        matches,
        mismatches,
        gaps,
        identity_pct,
        similarity_pct,
        xstart: aln.xstart + 1,
        xend: aln.xend,
        ystart: aln.ystart + 1,
        yend: aln.yend,
        cigar: encode_cigar_from_columns(&a1, &a2),
        algorithm,
        engine_used: "C++ Native / Rust FFI".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // W-W and C-C score 11 and 9 under BLOSUM62 but 17 and 12 under PAM250
    const PROTEIN: (&str, &str) = ("MKWCTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ", "MKWCTAYLAKQRQVSFVKAHFSREWEDRLGIVEAQ");
    // spaced and numbered as a pasted record is: the default is chosen from the residues, not the text
    const NUCLEOTIDE: (&str, &str) = ("1 ACGTTGCAAG GCTTACGATC GA", "ACGTAGCAAGGCTACGATCGTA");

    fn aligned(pair: (&str, &str), mode: PairwiseMode, matrix: Option<ScoringMatrixKind>) -> serde_json::Value {
        serde_json::to_value(align_pairwise_gotoh(pair.0, pair.1, mode, matrix, 2, -1, -5, -1, 0)).unwrap()
    }

    fn named(pair: (&str, &str), mode: &str, matrix: &str) -> NamedPairwiseAlignment {
        align_pairwise_named(pair.0, pair.1, mode, matrix, 2, -1, -5, -1, 0)
    }

    /// D0005 / TD-06: a scoring-matrix name that names no matrix aligns with the default for the
    /// pair - BLOSUM62 for protein, the IUPAC nucleotide matrix otherwise, as `auto` does - and the
    /// warning names the matrix asked for and the one used. On these pairs every matrix aligns
    /// differently, so a fallback to any other would show. Every known name, in any case, aligns
    /// with its own matrix and warns of nothing.
    #[test]
    fn unknown_matrix_warns_and_uses_the_default() {
        use ScoringMatrixKind::{Blosum62, DnaIupac, Pam250};
        assert_eq!((blosum62(b'W', b'W'), blosum62(b'C', b'C'), pam250(b'W', b'W'), pam250(b'C', b'C')), (11, 9, 17, 12));
        for (pair, default, warning) in [
            (PROTEIN, Blosum62, "Unknown scoring matrix 'blosum80': aligned with BLOSUM62, the default for protein sequences."),
            (NUCLEOTIDE, DnaIupac, "Unknown scoring matrix 'blosum80': aligned with the IUPAC nucleotide matrix, the default for nucleotide sequences."),
        ] {
            for kind in [Blosum62, Pam250, DnaIupac] {
                if kind != default {
                    assert_ne!(aligned(pair, PairwiseMode::Global, Some(kind)), aligned(pair, PairwiseMode::Global, Some(default)), "fixture: {kind:?} aligns {pair:?} as {default:?} does");
                }
            }
            let r = named(pair, "global", "blosum80");
            assert_eq!(serde_json::to_value(&r.alignment).unwrap(), aligned(pair, PairwiseMode::Global, Some(default)), "{pair:?}");
            assert_eq!(serde_json::to_value(&r.alignment).unwrap(), aligned(pair, PairwiseMode::Global, None), "{pair:?}: auto");
            assert_eq!(r.warnings, [warning]);
            // the reply every transport serialises: the alignment's own fields, flat, and the warning
            let json = serde_json::to_value(&r).unwrap();
            let mut want = aligned(pair, PairwiseMode::Global, Some(default));
            want["warnings"] = serde_json::json!([warning]);
            assert_eq!(json, want);
        }
        // the name asked for is quoted as given, an empty one included
        assert_eq!(named(PROTEIN, "local", "").warnings, ["Unknown scoring matrix '': aligned with BLOSUM62, the default for protein sequences."]);

        for (name, kind) in [("auto", None), ("blosum62", Some(Blosum62)), ("pam250", Some(Pam250)), ("nucleotide", Some(DnaIupac)), ("dnaiupac", Some(DnaIupac))] {
            for variant in [name.to_string(), name.to_ascii_uppercase(), format!(" {name} ")] {
                let r = named(PROTEIN, "local", &variant);
                assert!(r.warnings.is_empty(), "{variant:?}: {:?}", r.warnings);
                assert_eq!(serde_json::to_value(&r.alignment).unwrap(), aligned(PROTEIN, PairwiseMode::Local, kind), "{variant:?}");
                assert_eq!(serde_json::to_value(&r).unwrap()["warnings"], serde_json::json!([]));
            }
        }
    }

    /// D0005 / TD-06: a mode name that names no mode aligns globally and says so; the three known
    /// modes, in any case, align as asked and warn of nothing. Global, local and semi-global align
    /// this pair differently, so a fallback to another mode would show.
    #[test]
    fn unknown_mode_warns_and_aligns_globally() {
        let pair = ("GGGGGGACGTTGCAAGGCTTACGATCGA", "ACGTAGCAAGGCTACGATCGTACCCCCC");
        let modes = [("global", PairwiseMode::Global), ("local", PairwiseMode::Local), ("semiglobal", PairwiseMode::Semiglobal)];
        for (i, (_, a)) in modes.iter().enumerate() {
            for (_, b) in &modes[i + 1..] {
                assert_ne!(aligned(pair, *a, None), aligned(pair, *b, None), "fixture: {a:?} aligns as {b:?}");
            }
        }
        for unknown in ["glocal", "semi-global", ""] {
            let r = named(pair, unknown, "auto");
            assert_eq!(serde_json::to_value(&r.alignment).unwrap(), aligned(pair, PairwiseMode::Global, None), "{unknown:?}");
            assert_eq!(r.warnings, [format!("Unknown alignment mode '{unknown}': aligned in global mode (Needleman-Wunsch).")]);
        }
        for (name, mode) in modes {
            for variant in [name.to_string(), name.to_ascii_uppercase(), format!(" {name} ")] {
                let r = named(pair, &variant, "auto");
                assert!(r.warnings.is_empty(), "{variant:?}: {:?}", r.warnings);
                assert_eq!(serde_json::to_value(&r.alignment).unwrap(), aligned(pair, mode, None), "{variant:?}");
            }
        }
        // two unknown names, two warnings, mode first
        assert_eq!(
            named(PROTEIN, "glocal", "blosum80").warnings,
            [
                "Unknown alignment mode 'glocal': aligned in global mode (Needleman-Wunsch).",
                "Unknown scoring matrix 'blosum80': aligned with BLOSUM62, the default for protein sequences.",
            ]
        );
    }
}
