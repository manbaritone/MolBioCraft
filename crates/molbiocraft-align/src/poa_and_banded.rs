// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Multi-Read Overlap-Layout Partial-Order Graph Alignment Contig Assembler,
//! Sparse K-mer Banded Dynamic Programming (`bio::alignment::pairwise::banded::Aligner`), and
//! Algorithm-Aware Multiple Sequence Alignment Refinement (`MAFFT` / `Clustal Omega` / `MUSCLE` / `POA`).

use crate::msa::{
    center_star_rows, choose_star_center, clean_msa_inputs, finalize_msa,
    run_multiple_sequence_alignment, sum_of_pairs_score, MsaAlignmentResult, MsaInputDoc,
    MsaTreeBuilder,
};
use crate::pairwise::{
    align_pairwise_gotoh, compatible_nucleotides, looks_like_protein_sequence, not_aligned, PairwiseAlignmentResult,
    PairwiseMode, EXACT_CELLS,
};
use bio::alignment::pairwise::banded::Aligner as BandedAligner;
use bio::alignment::pairwise::{Aligner as FullAligner, MatchFunc, Scoring, MIN_SCORE};
use bio::alignment::poa::Aligner as PoaAligner;
use bio::alignment::sparse::find_kmer_matches;
use bio::alignment::{Alignment, AlignmentMode, AlignmentOperation};
use bio::stats::probs::{PHREDProb, Prob};
use molbiocraft_core::{
    clean_alpha_sequence, clean_sequence, format_thousands, iupac_complement_byte, reverse_complement_iupac,
    DocumentAlignmentMeta, HistoryTreeNode, MoleculeType, SequenceDocument, SequenceFeature,
    Topology,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoaReadInput {
    pub id: String,
    pub name: String,
    pub sequence: String,
    #[serde(default)]
    pub phred_scores: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoaAlignedReadRow {
    pub id: String,
    pub name: String,
    pub strand: i8,
    pub raw_length_bp: usize,
    pub post_trim_length_bp: usize,
    pub aligned_row: String,
    pub poa_score: i32,
    pub identity_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoaGraphBubbleSite {
    pub consensus_pos_1based: usize,
    pub consensus_base: String,
    pub alt_bases: Vec<String>,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoaContigAssemblyReport {
    pub contig_name: String,
    pub consensus_sequence: String,
    pub consensus_length_bp: usize,
    pub read_count: usize,
    pub forward_reads: usize,
    pub reverse_complemented_reads: usize,
    pub graph_node_count: usize,
    pub graph_edge_count: usize,
    pub graph_branch_bubbles: usize,
    pub mean_coverage_x: f64,
    pub pairwise_identity_pct: f64,
    pub disagreements_count: usize,
    pub coverage_per_base: Vec<usize>,
    pub aligned_reads: Vec<PoaAlignedReadRow>,
    pub polymorphic_sites: Vec<PoaGraphBubbleSite>,
    pub contig_document: SequenceDocument,
    /// Which reads the contig left out or cut (D0005), one plain sentence per read: a read with no
    /// bases, a read the quality pre-trim kept none of, and a read longer than
    /// [`POA_MAX_READ_BP`] after the trim; then one sentence naming, in input order, the reads that
    /// could not be placed in the layout (BG-01M6SQ2Y); then one sentence per repeat naming the
    /// reads left out because they fit the layout in more than one place and the contig bases the
    /// repeat covers, with its unit when the placements' bases repeat with one ("a tandem repeat
    /// of a 2-bp unit"), or as "a repeat" when they do not, as for two copies of a longer
    /// sequence (BG-01M6TD2N). Always serialised, as an empty list when every read was assembled
    /// over its whole (trimmed) length.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most bases of one read the contig assembler aligns. Each read is aligned on the calling
/// thread, which over WASM is the UI thread: in a band of [`POA_BAND`] around where the overlap
/// layout placed it, or over a full (consensus length x read length) matrix should it fall outside
/// that band, so a read longer than this after the quality pre-trim is cut to its first this-many
/// bases and named in the report's warnings.
pub const POA_MAX_READ_BP: usize = 2_500;

/// The error-probability cutoff of the contig assembler's Mott pre-trim.
const POA_PRETRIM_CUTOFF: f64 = 0.05;

fn mott_trim_read(seq: &str, phred: &[u8], cutoff: f64) -> String {
    let clean = clean_sequence(seq);
    let chars: Vec<char> = clean.chars().collect();
    let n = chars.len();
    if n == 0 || phred.is_empty() {
        return clean;
    }
    let mut best_score = 0.0_f64;
    let mut cur_score = 0.0_f64;
    let mut cur_start = 0usize;
    let mut best_start = 0usize;
    let mut best_end = n - 1;

    for i in 0..n {
        let q = phred.get(i).copied().unwrap_or(25);
        let p_err = *Prob::from(PHREDProb(f64::from(q)));
        let delta = cutoff - p_err;
        if cur_score + delta <= 0.0 {
            cur_score = 0.0;
            cur_start = i + 1;
        } else {
            cur_score += delta;
            if cur_score > best_score {
                best_score = cur_score;
                best_start = cur_start;
                best_end = i;
            }
        }
    }
    // No stretch scores above zero when no base's error probability is below the cutoff: the read
    // has no high-quality region and keeps none of its bases, so it takes no part in the contig.
    if best_score <= 0.0 || best_start > best_end || best_start >= n {
        return String::new();
    }
    chars[best_start..=best_end].iter().collect()
}

/// A read joins the contig only where it overlaps the layout of the reads already placed by at
/// least this many bases, counted on both the read and the layout (BG-01M6SQ2Y), and called on
/// both: a column with an N on either side counts on neither, so an N run cannot stand in for
/// bases that agree (BG-01M6TD2N).
pub const POA_MIN_OVERLAP_BP: usize = 50;

/// The least identity of that overlap, in percent: identical columns over its columns (matches,
/// mismatches and gap columns), where a column with an N on either side counts as neither a match
/// nor a mismatch (BG-01M6TD2N).
pub const POA_MIN_OVERLAP_IDENTITY_PCT: usize = 90;

/// The k-mer length that proposes where a read may overlap the layout. An overlap with no N that
/// meets [`POA_MIN_OVERLAP_BP`] at [`POA_MIN_OVERLAP_IDENTITY_PCT`] has at most one error per ten
/// columns, so at least 45 identical bases in at most 6 runs, one of them at least 8 long: it
/// always shares an 8-mer with the layout.
const LAYOUT_K: usize = 8;
/// How far an overlap may drift off the diagonal its shared k-mers propose (net indels).
const LAYOUT_BAND: i64 = 64;
/// How many of a read's proposed diagonals, best first, are aligned per strand whatever their
/// votes, unless [`best_placement`] has already found the read ambiguous.
const LAYOUT_CANDIDATES: usize = 3;
/// A further diagonal is aligned when at least this many of the read's k-mers vote for it (summed
/// over its neighbours, as the ranking does), up to [`LAYOUT_MAX_CANDIDATES`] in all: in a tandem
/// repeat whose unit is longer than the band, each copy proposes a diagonal of its own, and the
/// true overlap can rank below longer, collapsed ones (BG-01M6TD2N). An overlap that places a read
/// without errors shares at least 43 k-mers with the draft; a read's chance hits on a diagonal of
/// unrelated sequence average under 0.04 for a read of 2,500 bases (1 in 4^8 per k-mer).
const LAYOUT_RIVAL_VOTES: u32 = 16;
/// The most diagonals aligned per read and strand.
const LAYOUT_MAX_CANDIDATES: usize = 12;
/// What a read's overlap alignment pays, once per end, for running past that end of the draft
/// (the bases past it are then left unaligned, and extend the draft). Free, a read whose first or
/// last two bases are errors, the second matching the draft's end base by chance, scores better as
/// a base past the draft plus a gap (+2 - 4) than as two mismatches (-4), and the draft would be
/// extended by an error; at -3 the mismatches win, and a real overhang of any length still does.
const LAYOUT_OVERHANG: i32 = -3;
/// A k-mer found more often than this in the layout (a repeat or a low-complexity run such as
/// (CA)n or poly-A) votes for an evenly spaced sample of at most this many of its hits, so it still
/// proposes where the read may lie and costs no more than a rarer k-mer (BG-01M6TD2N: it used to
/// propose nothing, and a read whose overlap was all such k-mers was left out).
const LAYOUT_KMER_MAX_OCCURRENCES: usize = 32;
/// Two placements of a read whose diagonals come within this many bases of each other are one
/// placement: the drift its own indels give, or the shift a short homopolymer allows, which moves
/// the contig's bases by at most this many.
const LAYOUT_SAME_PLACEMENT_BP: i64 = 2;
/// A second placement of a read elsewhere (more than [`LAYOUT_SAME_PLACEMENT_BP`] off the best's
/// diagonals, or on the other strand) with at most this many more errors than the best, that would
/// give the draft different bases, leaves the read ambiguous: inside an exact tandem repeat a
/// unit's shift matches as well as the best, so the reads cannot tell how many copies it holds.
/// A placement inside a tandem repeat is no rival to a best fixed by bases outside that repeat
/// (see [`best_placement`]).
const LAYOUT_RIVAL_EXTRA_ERRORS: usize = 2;
/// How far a read's partial-order alignment may stray from where the layout placed it.
const POA_BAND: i64 = 64;

const CONTIG_MATCH: i32 = 2;
const CONTIG_MISMATCH: i32 = -2;
const CONTIG_GAP: i32 = -4;
/// A score no alignment reaches; adding a few thousand gap penalties to it cannot overflow.
const UNREACHED: i32 = i32::MIN / 4;

/// An N on either side scores 0: it is neither a match nor a mismatch (BG-01M6TD2N). Scored as a
/// mismatch, a read's 140 Ns sink its exact place inside the draft (60 called bases, 120) to -160,
/// below a 93% copy of those 60 bases at the draft's end, and the read is left out as fitting in
/// two places; that it may not place on N columns alone is [`DraftOverlap::places`]'s rule.
fn contig_score(a: u8, b: u8) -> i32 {
    if a == b'N' || b == b'N' {
        0
    } else if a == b {
        CONTIG_MATCH
    } else {
        CONTIG_MISMATCH
    }
}

fn kmer_code(window: &[u8]) -> Option<usize> {
    let mut code = 0usize;
    for &b in window {
        code = (code << 2)
            | match b {
                b'A' => 0,
                b'C' => 1,
                b'G' => 2,
                b'T' => 3,
                _ => return None,
            };
    }
    Some(code)
}

/// Where each [`LAYOUT_K`]-mer of the layout draft occurs (counts, then positions, by code).
struct KmerIndex {
    start: Vec<u32>,
    pos: Vec<u32>,
}

impl KmerIndex {
    fn new(seq: &[u8]) -> Self {
        let codes: Vec<Option<usize>> =
            if seq.len() >= LAYOUT_K { seq.windows(LAYOUT_K).map(kmer_code).collect() } else { Vec::new() };
        let mut start = vec![0u32; (1usize << (2 * LAYOUT_K)) + 1];
        for &c in codes.iter().flatten() {
            start[c + 1] += 1;
        }
        for i in 1..start.len() {
            start[i] += start[i - 1];
        }
        let mut next = start.clone();
        let mut pos = vec![0u32; start[start.len() - 1] as usize];
        for (p, c) in codes.iter().enumerate() {
            if let Some(c) = *c {
                pos[next[c] as usize] = p as u32;
                next[c] += 1;
            }
        }
        KmerIndex { start, pos }
    }

    fn hits(&self, code: usize) -> &[u32] {
        &self.pos[self.start[code] as usize..self.start[code + 1] as usize]
    }
}

/// The diagonals (draft position minus read position) on which `read` shares the most k-mers with
/// the draft, each more than a band apart, best first: the first [`LAYOUT_CANDIDATES`], then any
/// with [`LAYOUT_RIVAL_VOTES`] votes, [`LAYOUT_MAX_CANDIDATES`] at most.
fn candidate_diagonals(index: &KmerIndex, draft_len: usize, read: &[u8]) -> Vec<i64> {
    let m = read.len();
    if m < LAYOUT_K || draft_len < LAYOUT_K {
        return Vec::new();
    }
    let mut votes = vec![0u32; draft_len + m + 1];
    for (i, w) in read.windows(LAYOUT_K).enumerate() {
        let Some(code) = kmer_code(w) else { continue };
        let hits = index.hits(code);
        for &p in hits.iter().step_by(hits.len().div_ceil(LAYOUT_KMER_MAX_OCCURRENCES).max(1)) {
            votes[p as usize + m - i] += 1;
        }
    }
    // Votes summed over 9 neighbouring diagonals, so the hits an indel splits count together.
    let mut prefix = vec![0u32; votes.len() + 1];
    for (d, v) in votes.iter().enumerate() {
        prefix[d + 1] = prefix[d] + v;
    }
    let near = |d: usize| prefix[(d + 5).min(votes.len())] - prefix[d.saturating_sub(4)];
    let mut voted: Vec<usize> = (0..votes.len()).filter(|&d| votes[d] > 0).collect();
    voted.sort_by(|&a, &b| near(b).cmp(&near(a)).then(votes[b].cmp(&votes[a])).then(a.cmp(&b)));
    let mut picked: Vec<usize> = Vec::new();
    for d in voted {
        if picked.len() >= LAYOUT_CANDIDATES && near(d) < LAYOUT_RIVAL_VOTES {
            break;
        }
        if picked.iter().all(|&q| (q as i64 - d as i64).abs() > LAYOUT_BAND) {
            picked.push(d);
            if picked.len() == LAYOUT_MAX_CANDIDATES {
                break;
            }
        }
    }
    picked.into_iter().map(|d| d as i64 - m as i64).collect()
}

/// A read's overlap with the layout draft: where it lies on each, and how well they agree.
#[derive(Clone, Copy, Debug)]
struct DraftOverlap {
    score: i32,
    read_from: usize,
    read_to: usize,
    draft_from: usize,
    draft_to: usize,
    columns: usize,
    identities: usize,
    /// Columns with an N on either side: neither a match nor a mismatch (BG-01M6TD2N).
    unknown: usize,
}

impl DraftOverlap {
    /// Whether the overlap places the read: at least [`POA_MIN_OVERLAP_BP`] called bases on both
    /// sequences (a column with an N on either side holds a base of each, and counts on neither)
    /// at [`POA_MIN_OVERLAP_IDENTITY_PCT`] identity or better, over the columns that hold no N.
    /// Counted with the N columns, a read of 42 Ns and 8 bases matching the draft's end placed.
    fn places(&self) -> bool {
        let called = self.columns - self.unknown;
        let sides = (self.read_to - self.read_from).min(self.draft_to - self.draft_from);
        sides.saturating_sub(self.unknown) >= POA_MIN_OVERLAP_BP
            && self.identities * 100 >= called * POA_MIN_OVERLAP_IDENTITY_PCT
    }

    /// Its mismatches and gap columns.
    fn errors(&self) -> usize {
        self.columns - self.unknown - self.identities
    }

    /// The least and greatest diagonal (draft index minus read index) it lies on, at its ends.
    fn diagonals(&self) -> (i64, i64) {
        let start = self.draft_from as i64 - self.read_from as i64;
        let end = self.draft_to as i64 - self.read_to as i64;
        (start.min(end), start.max(end))
    }
}

/// The best path into one cell of the overlap alignment, with what it holds so far.
#[derive(Clone, Copy)]
struct OverlapPath {
    score: i32,
    /// The diagonal of the cell it starts in, on the first row or column.
    start: i64,
    columns: u32,
    identities: u32,
    unknown: u32,
}

/// Every overlap (dovetail) alignment of `read` to `draft` within [`LAYOUT_BAND`] of `diag`, one
/// per cell where it can end, in fill order: each starts where the read or the draft starts and
/// ends where one of them ends, so it never clips an end of the overlap; each end where the read
/// runs past the draft costs [`LAYOUT_OVERHANG`]. Each cell keeps its best path's start and counts
/// as it is filled, so no traceback is needed (BG-01M6TD2N); the fill visits each band cell once.
fn dovetail_overlaps(draft: &[u8], read: &[u8], diag: i64) -> Vec<DraftOverlap> {
    let (m, n) = (read.len(), draft.len() as i64);
    let w = (2 * LAYOUT_BAND + 1) as usize;
    let first = |i: usize| i as i64 + diag - LAYOUT_BAND;
    let none = OverlapPath { score: UNREACHED, start: 0, columns: 0, identities: 0, unknown: 0 };
    // Row i holds draft indices j = first(i) + k: in row i - 1, (i - 1, j - 1) is at k and
    // (i - 1, j) at k + 1.
    let (mut prev, mut row) = (vec![none; w], vec![none; w]);
    let mut ends = Vec::new();
    for i in 0..=m {
        for k in 0..w {
            let j = first(i) + k as i64;
            row[k] = none;
            if j < 0 || j > n {
                continue;
            }
            if i == 0 || j == 0 {
                // The read's first i bases lie before the draft (an overhang) when j == 0 < i.
                let score = if i > 0 { LAYOUT_OVERHANG } else { 0 };
                row[k] = OverlapPath { score, start: j - i as i64, ..none };
                continue;
            }
            let (a, b) = (read[i - 1], draft[j as usize - 1]);
            let mut best = none;
            let p = prev[k];
            if p.score > UNREACHED {
                let unknown = a == b'N' || b == b'N';
                best = OverlapPath {
                    score: p.score + contig_score(a, b),
                    columns: p.columns + 1,
                    identities: p.identities + u32::from(a == b && !unknown),
                    unknown: p.unknown + u32::from(unknown),
                    ..p
                };
            }
            // A read base against a gap, then a draft base against a gap.
            for p in [prev.get(k + 1).copied(), k.checked_sub(1).map(|q| row[q])].into_iter().flatten() {
                if p.score > UNREACHED && p.score + CONTIG_GAP > best.score {
                    best = OverlapPath { score: p.score + CONTIG_GAP, columns: p.columns + 1, ..p };
                }
            }
            row[k] = best;
            if best.score > UNREACHED && (i == m || j == n) {
                ends.push(DraftOverlap {
                    // Ending at the draft's end with read bases left over is an overhang past it.
                    score: if i < m { best.score + LAYOUT_OVERHANG } else { best.score },
                    read_from: (-best.start).max(0) as usize,
                    read_to: i,
                    draft_from: best.start.max(0) as usize,
                    draft_to: j as usize,
                    columns: best.columns as usize,
                    identities: best.identities as usize,
                    unknown: best.unknown as usize,
                });
            }
        }
        std::mem::swap(&mut prev, &mut row);
    }
    ends
}

/// Where a read left out of the layout fits it in more than one place (BG-01M6TD2N).
#[derive(Clone, Copy, Debug)]
struct Ambiguity {
    /// The strand of its best placement.
    strand: i8,
    /// The repeat's unit, in bases: when a rival lies on the best's strand, the least period no
    /// longer than that rival's shift (plus [`LAYOUT_SAME_PLACEMENT_BP`]) with which the draft
    /// bases of one of its placements repeat; when the rivals all lie on the other strand, the
    /// least period of the best's draft bases. None when no placement's bases repeat.
    unit: Option<usize>,
    /// The draft bases that placement covers, or every placement when there is no unit:
    /// `draft_from..draft_to`.
    draft_from: usize,
    draft_to: usize,
}

/// How a read fits the draft.
enum Placement {
    /// In one place: its best overlap, on strand +1 or -1.
    Placed(DraftOverlap, i8),
    /// About as well (within [`LAYOUT_RIVAL_EXTRA_ERRORS`] errors) in more than one place, which
    /// would give the draft different bases.
    Ambiguous(Ambiguity),
    /// Nowhere: no overlap meets [`DraftOverlap::places`].
    Unplaced,
}

impl Placement {
    fn placed(self) -> Option<(DraftOverlap, i8)> {
        match self {
            Placement::Placed(ov, strand) => Some((ov, strand)),
            _ => None,
        }
    }
}

/// The least period of `draft[from..to]` up to `most`, over at least [`POA_MIN_OVERLAP_BP`] pairs
/// of bases a period apart, at most one pair in ten unlike (a tandem repeat's unit), if any.
fn repeat_unit(draft: &[u8], from: usize, to: usize, most: usize) -> Option<usize> {
    period(draft, from, to, most, POA_MIN_OVERLAP_BP)
}

/// The least period of `draft[from..to]` up to `most` over at least `pairs` pairs of bases a
/// period apart, at most one pair in ten unlike, if any.
fn period(draft: &[u8], from: usize, to: usize, most: usize, pairs: usize) -> Option<usize> {
    (1..=most).take_while(|p| from + p + pairs <= to).find(|&p| {
        let allowed = (to - p - from) / 10;
        let mut unlike = 0usize;
        // Stops at the first unlike pair past the one in ten allowed, so a period the stretch does
        // not have is given up early rather than counted over every pair.
        (from..to - p).all(|x| {
            unlike += usize::from(draft[x] != draft[x + p]);
            unlike <= allowed
        })
    })
}

/// How many bases of `seq[from..to]` lie outside every tandem repeat of unit `p`: every run of at
/// least [`LAYOUT_K`] consecutive pairs of bases `p` apart that are alike covers its pairs' bases,
/// so a substitution breaks a repeat only where it lies, and a chance run of that length is about
/// 1 in 4^8 a base.
fn outside_repeat(seq: &[u8], from: usize, to: usize, p: usize) -> usize {
    let mut covered = vec![false; to - from];
    let end = (to + LAYOUT_K).min(seq.len().saturating_sub(p));
    let mut x = from.saturating_sub(p + LAYOUT_K);
    while x < end {
        let run = x;
        while x < end && seq[x] == seq[x + p] {
            x += 1;
        }
        if x - run >= LAYOUT_K {
            for c in &mut covered[run.max(from).min(to) - from..(x + p).min(to).max(from) - from] {
                *c = true;
            }
        }
        x += usize::from(x == run);
    }
    covered.iter().filter(|c| !**c).count()
}

/// Whether an overlap of `read` (on the strand it was aligned) to `draft` is fixed by bases outside
/// a tandem repeat of unit `p`: at least [`POA_MIN_OVERLAP_BP`] of its bases lie outside it on
/// both the read and the draft, enough to place the read at [`POA_MIN_OVERLAP_IDENTITY_PCT`]% were
/// every error of the overlap among them. Bases past the repeat matched only by chance are
/// mostly errors, which that budget counts against them.
fn fixed_outside_repeat(draft: &[u8], read: &[u8], ov: &DraftOverlap, p: usize) -> bool {
    let outside = outside_repeat(draft, ov.draft_from, ov.draft_to, p).min(outside_repeat(read, ov.read_from, ov.read_to, p));
    outside >= POA_MIN_OVERLAP_BP && ov.errors() * 100 <= outside * (100 - POA_MIN_OVERLAP_IDENTITY_PCT)
}

/// How a read fits the draft, on either strand. Its best overlap is, as before, the
/// highest-scoring of the bands' best overlaps (the highest score, then the furthest end) that
/// place it; a band whose best does not place proposes nothing, so an overlap is not padded to
/// [`POA_MIN_OVERLAP_BP`] by gap columns at its ends, which only lower its score. It is ambiguous
/// when a rival, any overlap that places it elsewhere (another strand, or diagonals more than
/// [`LAYOUT_SAME_PLACEMENT_BP`] from the best's) with at most [`LAYOUT_RIVAL_EXTRA_ERRORS`] more
/// errors, would put different bases before or after the draft: in an exact tandem repeat that
/// holds the whole overlap, an overlap shifted by a unit matches as well, and taking the longest
/// silently drops copies (BG-01M6TD2N).
///
/// An overlap whose draft bases lie in a tandem repeat, holding its unit at least twice, is no
/// rival, on either strand, to a best that holds at least [`POA_MIN_OVERLAP_BP`] bases outside
/// that repeat on both the read and the draft, enough to place the read at
/// [`POA_MIN_OVERLAP_IDENTITY_PCT`]% even were every error of the best among them: the best is then
/// fixed by bases the repeat does not hold, the rival only by the repeat, which the end of any
/// read holding it matches. A unit that is its own reverse complement, as in (AT)n or (ACGT)n,
/// puts such a rival on the other strand: turned round, a read ending in the repeat runs off the
/// draft's end in it, and forward replicates ending in an (AT)60 were all left out but the first.
/// Bases past the repeat that the best matches only by chance do not fix it: a read whose overlap
/// is all (TG)n, laid past the draft's 91 bases of (TG)n onto the 17 before them with 7 errors,
/// still has its rivals.
///
/// The bands are aligned best first, and once those aligned hold a best and a rival of it the
/// read is ambiguous without aligning the rest: a read of one repeated base against a draft of it
/// stops after its first band, which already holds overlaps shifted by every few bases, rather
/// than aligning up to [`LAYOUT_MAX_CANDIDATES`].
fn best_placement(index: &KmerIndex, draft: &[u8], fwd: &[u8], rc: &[u8]) -> Placement {
    let seq_of = |s: i8| if s == 1 { fwd } else { rc };
    let added = |o: &DraftOverlap, s: i8| (&seq_of(s)[..o.read_from], &seq_of(s)[o.read_to..]);
    // Whether a best is fixed by bases outside a repeat of unit p, kept per best and unit, since
    // each band asks again.
    type Key = (usize, usize, usize, usize, i8, usize);
    let fixed: std::cell::RefCell<Vec<(Key, bool)>> = Default::default();
    let fixed_outside = |ov: &DraftOverlap, strand: i8, p: usize| {
        let key = (ov.draft_from, ov.draft_to, ov.read_from, ov.read_to, strand, p);
        if let Some(&(_, f)) = fixed.borrow().iter().find(|(k, _)| *k == key) {
            return f;
        }
        let f = fixed_outside_repeat(draft, seq_of(strand), ov, p);
        fixed.borrow_mut().push((key, f));
        f
    };
    let rival = |(o, s): (DraftOverlap, i8), (ov, strand): (DraftOverlap, i8)| {
        let (lo, hi) = ov.diagonals();
        let (olo, ohi) = o.diagonals();
        let elsewhere = s != strand || ohi < lo - LAYOUT_SAME_PLACEMENT_BP || olo > hi + LAYOUT_SAME_PLACEMENT_BP;
        // A placing overlap may be as short as POA_MIN_OVERLAP_BP, too short to compare that many
        // pairs a unit apart, so its unit need only fit twice.
        let len = o.draft_to - o.draft_from;
        elsewhere
            && o.errors() <= ov.errors() + LAYOUT_RIVAL_EXTRA_ERRORS
            && added(&o, s) != added(&ov, strand)
            && !period(draft, o.draft_from, o.draft_to, len, len.div_ceil(2)).is_some_and(|p| fixed_outside(&ov, strand, p))
    };
    let reach = |o: &DraftOverlap| (o.score, o.read_to + o.draft_to);
    let mut placing: Vec<(DraftOverlap, i8)> = Vec::new();
    let mut best: Option<(DraftOverlap, i8)> = None;
    'bands: for (seq, strand) in [(fwd, 1i8), (rc, -1i8)] {
        for diag in candidate_diagonals(index, draft.len(), seq) {
            let ends = dovetail_overlaps(draft, seq, diag);
            let band_best = ends.iter().copied().reduce(|b, o| if reach(&o) > reach(&b) { o } else { b });
            if let Some(o) = band_best.filter(DraftOverlap::places) {
                if best.is_none_or(|(b, _)| o.score > b.score) {
                    best = Some((o, strand));
                }
            }
            placing.extend(ends.into_iter().filter(DraftOverlap::places).map(|o| (o, strand)));
            if best.is_some_and(|b| placing.iter().any(|&o| rival(o, b))) {
                break 'bands;
            }
        }
    }
    let Some((ov, strand)) = best else { return Placement::Unplaced };
    let rivals: Vec<(DraftOverlap, i8)> = placing.iter().copied().filter(|&o| rival(o, (ov, strand))).collect();
    if rivals.is_empty() {
        return Placement::Placed(ov, strand);
    }
    // The repeat's unit: a rival on the best's strand lies a whole number of units off, give or
    // take an end gap, and the unit is the least period of a placement's draft bases (one of
    // them may run into the flank past the repeat by chance matches). With rivals on the other
    // strand only, no shift bounds the unit, and it is the least period of the best's draft
    // bases, if they have one. The bases named are that placement's, or every placement's when
    // no unit is found: two copies of a longer sequence, or a sequence and its reverse complement.
    let lo = ov.diagonals().0;
    let shift = rivals.iter().filter(|(_, s)| *s == strand).map(|(o, _)| (o.diagonals().0 - lo).unsigned_abs() as usize).max();
    let periodic = match shift {
        Some(d) => std::iter::once(ov)
            .chain(rivals.iter().map(|(o, _)| *o))
            .filter_map(|o| repeat_unit(draft, o.draft_from, o.draft_to, d + LAYOUT_SAME_PLACEMENT_BP as usize).map(|p| (p, o.draft_from, o.draft_to)))
            .min_by_key(|&(p, from, to)| (p, std::cmp::Reverse(to - from))),
        None => repeat_unit(draft, ov.draft_from, ov.draft_to, ov.draft_to - ov.draft_from).map(|p| (p, ov.draft_from, ov.draft_to)),
    };
    let (unit, draft_from, draft_to) = match periodic {
        Some((p, from, to)) => (Some(p), from, to),
        None => (
            None,
            rivals.iter().map(|(o, _)| o.draft_from).fold(ov.draft_from, usize::min),
            rivals.iter().map(|(o, _)| o.draft_to).fold(ov.draft_to, usize::max),
        ),
    };
    Placement::Ambiguous(Ambiguity { strand, unit, draft_from, draft_to })
}

/// A read placed in the layout: which read, on which strand, and the draft column of its first
/// base.
struct PlacedRead {
    idx: usize,
    strand: i8,
    seq: Vec<u8>,
    start: i64,
}

/// Grows a layout from the read `pool[0]`: each round aligns every read not yet placed to the
/// draft (the union of the placed reads), places those whose overlap passes
/// [`DraftOverlap::places`] in one place only, best first, and extends the draft by the bases a
/// read adds past either end, so the draft spans every placed read and no read later aligns past
/// its ends. A read that fits in more than one place waits, since a read placed later may extend
/// the draft past a repeat and fix where it goes (BG-01M6TD2N). Every round places at least its
/// best read, and the layout ends when a round finds none.
fn lay_out(reads: &[(Vec<u8>, Vec<u8>)], pool: &[usize]) -> (Vec<u8>, Vec<PlacedRead>) {
    let seed = pool[0];
    let mut draft = reads[seed].0.clone();
    let mut placed = vec![PlacedRead { idx: seed, strand: 1, seq: draft.clone(), start: 0 }];
    let mut pending: Vec<usize> = pool[1..].to_vec();
    loop {
        let index = KmerIndex::new(&draft);
        let mut found: Vec<(usize, DraftOverlap, i8)> = pending
            .iter()
            .filter_map(|&r| best_placement(&index, &draft, &reads[r].0, &reads[r].1).placed().map(|(o, s)| (r, o, s)))
            .collect();
        if found.is_empty() {
            break;
        }
        found.sort_by(|a, b| b.1.score.cmp(&a.1.score).then(a.0.cmp(&b.0)));
        // An overlap found this round stands while the draft is unchanged; once a read extends the
        // draft, each later read is aligned again to the draft as it now is.
        let mut unchanged = true;
        for (r, ov, strand) in found {
            let placement = if unchanged {
                Some((ov, strand))
            } else {
                best_placement(&KmerIndex::new(&draft), &draft, &reads[r].0, &reads[r].1).placed()
            };
            let Some((ov, strand)) = placement else { continue };
            let seq = if strand == 1 { reads[r].0.clone() } else { reads[r].1.clone() };
            // A dovetail starts at the start of the read or of the draft and ends at the end of
            // one of them, so the read's bases before `read_from` lie before the draft and those
            // after `read_to` past its end.
            let (prepend, append) = (ov.read_from, seq.len() - ov.read_to);
            if prepend > 0 {
                draft.splice(0..0, seq[..prepend].iter().copied());
                for p in &mut placed {
                    p.start += prepend as i64;
                }
            }
            if append > 0 {
                draft.extend_from_slice(&seq[ov.read_to..]);
            }
            let start = (ov.draft_from + prepend) as i64 - ov.read_from as i64;
            placed.push(PlacedRead { idx: r, strand, seq, start });
            pending.retain(|&x| x != r);
            unchanged &= prepend == 0 && append == 0;
        }
    }
    (draft, placed)
}

/// The layout with the most reads: one is grown from the longest read, another from the longest
/// read it left out, and so on while the reads left could still outnumber the best layout. Ties go
/// to the layout grown first.
fn largest_layout(reads: &[(Vec<u8>, Vec<u8>)]) -> (Vec<u8>, Vec<PlacedRead>) {
    let mut pool: Vec<usize> = (0..reads.len()).collect();
    let mut best: Option<(Vec<u8>, Vec<PlacedRead>)> = None;
    while !pool.is_empty() && best.as_ref().is_none_or(|(_, b)| pool.len() > b.len()) {
        let (draft, placed) = lay_out(reads, &pool);
        pool.retain(|i| placed.iter().all(|p| p.idx != *i));
        if best.as_ref().is_none_or(|(_, b)| placed.len() > b.len()) {
            best = Some((draft, placed));
        }
    }
    best.unwrap_or_default()
}

/// One step of a read's path through the partial-order graph: a read base aligned to a node (of
/// the same base or not), or a read base inserted after the one before it.
#[derive(Clone, Copy, Debug)]
enum GraphStep {
    Aligned { node: usize, base: usize },
    Inserted { base: usize },
}

/// The contig's partial-order graph (Lee, Grasso & Sharlow 2002): one node per base, one edge per
/// pair of consecutive bases of a read, weighted by the reads through it. It starts as the layout
/// draft chained by edges of weight 0, which fix where each read aligns but give the draft no vote
/// of its own; each read then adds its path. `pos` is each node's draft column.
struct ContigGraph {
    base: Vec<u8>,
    pos: Vec<usize>,
    inn: Vec<Vec<usize>>,
    out: Vec<Vec<(usize, u32)>>,
}

impl ContigGraph {
    fn backbone(draft: &[u8]) -> Self {
        let n = draft.len();
        let mut g = ContigGraph {
            base: draft.to_vec(),
            pos: (0..n).collect(),
            inn: vec![Vec::new(); n],
            out: vec![Vec::new(); n],
        };
        for v in 1..n {
            g.out[v - 1].push((v, 0));
            g.inn[v].push(v - 1);
        }
        g
    }

    fn add_node(&mut self, base: u8, pos: usize) -> usize {
        self.base.push(base);
        self.pos.push(pos);
        self.inn.push(Vec::new());
        self.out.push(Vec::new());
        self.base.len() - 1
    }

    fn weight(&self, from: usize, to: usize) -> u32 {
        self.out[from].iter().find(|e| e.0 == to).map_or(0, |e| e.1)
    }

    /// One more read through the edge `from -> to`, made if absent.
    fn traverse(&mut self, from: usize, to: usize) {
        if let Some(e) = self.out[from].iter_mut().find(|e| e.0 == to) {
            e.1 += 1;
        } else {
            self.out[from].push((to, 1));
            self.inn[to].push(from);
        }
    }

    fn node_count(&self) -> usize {
        self.base.len()
    }

    fn edge_count(&self) -> usize {
        self.out.iter().map(Vec::len).sum()
    }

    /// Nodes with more than one successor: where reads branch.
    fn branch_bubbles(&self) -> usize {
        self.out.iter().filter(|o| o.len() > 1).count()
    }

    /// The nodes in topological order (Kahn), the ready node of the lowest draft column first.
    fn topological_order(&self) -> Vec<usize> {
        use std::cmp::Reverse;
        let mut indegree: Vec<usize> = self.inn.iter().map(Vec::len).collect();
        let mut ready: std::collections::BinaryHeap<Reverse<(usize, usize)>> =
            (0..self.base.len()).filter(|&v| indegree[v] == 0).map(|v| Reverse((self.pos[v], v))).collect();
        let mut order = Vec::with_capacity(self.base.len());
        while let Some(Reverse((_, v))) = ready.pop() {
            order.push(v);
            for &(t, _) in &self.out[v] {
                indegree[t] -= 1;
                if indegree[t] == 0 {
                    ready.push(Reverse((self.pos[t], t)));
                }
            }
        }
        order
    }

    /// The best alignment of the whole of `read` to a path of the graph (free to start and end at
    /// any node), within [`POA_BAND`] of where the layout placed it (its first base at draft
    /// column `start`): (score, path). Each traceback step lowers the read index or moves to a
    /// predecessor, which comes earlier in the topological order, so it ends within read length +
    /// node count steps, and the loop is bounded by that count.
    fn align(&self, read: &[u8], start: i64) -> Option<(i32, Vec<GraphStep>)> {
        const START: u32 = 0;
        const DIAGONAL: u32 = 1;
        const SKIP_NODE: u32 = 2;
        const INSERT: u32 = 3;
        let m = read.len();
        let (lo, hi) = (start - POA_BAND, start + m as i64 + POA_BAND);
        let rows: Vec<usize> = self
            .topological_order()
            .into_iter()
            .filter(|&v| (lo..=hi).contains(&(self.pos[v] as i64)))
            .collect();
        if m == 0 || rows.is_empty() {
            return None;
        }
        let mut row_of = vec![usize::MAX; self.base.len()];
        for (r, &v) in rows.iter().enumerate() {
            row_of[v] = r;
        }
        let w = (2 * POA_BAND + 1) as usize;
        // Row r holds the read columns j = 1..=m near the read base the layout puts at its node.
        let first: Vec<i64> = rows.iter().map(|&v| self.pos[v] as i64 - start + 1 - POA_BAND).collect();
        let cell = |r: usize, j: usize| -> Option<usize> {
            let k = j as i64 - first[r];
            (j >= 1 && j <= m && k >= 0 && k < w as i64).then(|| r * w + k as usize)
        };
        let mut h = vec![UNREACHED; rows.len() * w];
        let mut back = vec![START; rows.len() * w];
        for (r, &v) in rows.iter().enumerate() {
            for j in first[r].max(1)..=(first[r] + w as i64 - 1).min(m as i64) {
                let j = j as usize;
                let s = contig_score(self.base[v], read[j - 1]);
                // The path starts at this node, with the read bases before `j - 1` inserted.
                let mut best = (j as i32 - 1) * CONTIG_GAP + s;
                let mut mv = START;
                for (slot, &p) in self.inn[v].iter().enumerate() {
                    let pr = row_of[p];
                    if pr == usize::MAX {
                        continue;
                    }
                    if let Some(pc) = cell(pr, j - 1) {
                        if h[pc] + s > best {
                            best = h[pc] + s;
                            mv = DIAGONAL | (slot as u32) << 2;
                        }
                    }
                    if let Some(pc) = cell(pr, j) {
                        if h[pc] + CONTIG_GAP > best {
                            best = h[pc] + CONTIG_GAP;
                            mv = SKIP_NODE | (slot as u32) << 2;
                        }
                    }
                }
                if let Some(pc) = cell(r, j - 1) {
                    if h[pc] + CONTIG_GAP > best {
                        best = h[pc] + CONTIG_GAP;
                        mv = INSERT;
                    }
                }
                let c = cell(r, j)?;
                h[c] = best;
                back[c] = mv;
            }
        }
        let (mut r, score) = (0..rows.len())
            .filter_map(|r| cell(r, m).map(|c| (r, h[c])))
            .filter(|&(_, s)| s > UNREACHED)
            .fold(None, |best: Option<(usize, i32)>, x| match best {
                Some(b) if b.1 >= x.1 => Some(b),
                _ => Some(x),
            })?;
        let mut j = m;
        let mut path = Vec::with_capacity(m + 8);
        for _ in 0..=(m + rows.len()) {
            let v = rows[r];
            let mv = back[cell(r, j)?];
            let pred = || row_of[self.inn[v][(mv >> 2) as usize]];
            match mv & 3 {
                START => {
                    path.push(GraphStep::Aligned { node: v, base: j - 1 });
                    path.extend((0..j - 1).rev().map(|base| GraphStep::Inserted { base }));
                    path.reverse();
                    return Some((score, path));
                }
                DIAGONAL => {
                    path.push(GraphStep::Aligned { node: v, base: j - 1 });
                    r = pred();
                    j -= 1;
                }
                SKIP_NODE => r = pred(),
                _ => {
                    path.push(GraphStep::Inserted { base: j - 1 });
                    j -= 1;
                }
            }
        }
        None
    }

    /// Adds a read's path: a base aligned to a node of the same base goes through that node, any
    /// other base becomes a new node, and each pair of consecutive bases adds one to its edge.
    fn add(&mut self, read: &[u8], path: &[GraphStep], start: i64) {
        let mut prev: Option<usize> = None;
        let mut column = start.max(0) as usize;
        for step in path {
            let node = match *step {
                GraphStep::Aligned { node, base } => {
                    column = self.pos[node];
                    if self.base[node] == read[base] {
                        node
                    } else {
                        self.add_node(read[base], column)
                    }
                }
                GraphStep::Inserted { base } => self.add_node(read[base], column),
            };
            if let Some(p) = prev {
                self.traverse(p, node);
            }
            prev = Some(node);
        }
    }

    /// The heaviest path (Lee 2002), as its nodes: each node follows its heaviest incoming edge
    /// (ties to the higher-scoring predecessor, then to the one added first), and the path ends at
    /// the node of the highest score. Only reads weigh the edges, so where reads tie the draft's
    /// base stands.
    fn consensus(&self) -> Vec<usize> {
        let order = self.topological_order();
        let mut score = vec![0u64; self.base.len()];
        let mut from = vec![usize::MAX; self.base.len()];
        for &v in &order {
            let mut best: Option<(u32, u64, usize)> = None;
            for &p in &self.inn[v] {
                let key = (self.weight(p, v), score[p]);
                if best.is_none_or(|(w, s, _)| key > (w, s)) {
                    best = Some((key.0, key.1, p));
                }
            }
            if let Some((w, s, p)) = best {
                score[v] = s + u64::from(w);
                from[v] = p;
            }
        }
        let Some(mut v) = order.iter().copied().fold(None, |best: Option<usize>, x| match best {
            Some(b) if score[b] >= score[x] => Some(b),
            _ => Some(x),
        }) else {
            return Vec::new();
        };
        let mut path = vec![v];
        while from[v] != usize::MAX {
            v = from[v];
            path.push(v);
        }
        path.reverse();
        path
    }
}

/// Assembles forward and reverse Sanger `.ab1`/FASTA sequencing reads into a consensus contig:
/// the reads are laid out by their pairwise overlaps (each read placed on the strand and at the
/// offset where it overlaps the reads already placed by at least [`POA_MIN_OVERLAP_BP`] bases at
/// [`POA_MIN_OVERLAP_IDENTITY_PCT`]% identity), then aligned to a partial-order graph (Lee, Grasso
/// & Sharlow 2002) seeded with that layout, whose heaviest path is the consensus. The largest
/// layout is kept; a read outside it is left out and named in `warnings`, and so is a read that
/// fits it in more than one place, such as one whose whole overlap lies inside a tandem repeat
/// (BG-01M6TD2N). The contig reads along the first read given that it holds, or that it left out
/// in more than one place, and its document's notes name that read; each read's identity is over
/// the span it covers.
pub fn assemble_sanger_contig_poa(
    reads: &[PoaReadInput],
    contig_name: &str,
    trim_low_quality: bool,
) -> PoaContigAssemblyReport {
    let clean_title = if contig_name.trim().is_empty() {
        "POA_Consensus_Contig"
    } else {
        contig_name.trim()
    };

    // Prepare & trim reads. Every read is assembled over its whole trimmed length up to
    // POA_MAX_READ_BP; each read left out or cut is named in `warnings`, in input order.
    let mut warnings: Vec<String> = Vec::new();
    // (id, name, raw length, trimmed bases, input position)
    let mut prepared: Vec<(String, String, usize, String, usize)> = Vec::with_capacity(reads.len());
    for (input_pos, r) in reads.iter().enumerate() {
        let label = if r.name.trim().is_empty() { r.id.as_str() } else { r.name.trim() };
        let raw_clean = clean_sequence(&r.sequence);
        if raw_clean.is_empty() {
            warnings.push(format!("{label} has no bases, so it was left out of the contig."));
            continue;
        }
        let raw_len = raw_clean.len();
        let pretrimmed = trim_low_quality && !r.phred_scores.is_empty();
        let trimmed = if pretrimmed {
            mott_trim_read(&raw_clean, &r.phred_scores, POA_PRETRIM_CUTOFF)
        } else {
            raw_clean
        };
        if trimmed.is_empty() {
            warnings.push(format!(
                "{label}: the Mott quality pre-trim at P(err) {POA_PRETRIM_CUTOFF} kept none of its {} bases, so it was left out of the contig.",
                format_thousands(raw_len)
            ));
            continue;
        }
        let kept = if trimmed.len() > POA_MAX_READ_BP {
            warnings.push(format!(
                "{label}: only the first {} of its {} bases{} were assembled; the assembler aligns at most {} bases of a read.",
                format_thousands(POA_MAX_READ_BP),
                format_thousands(trimmed.len()),
                if pretrimmed { " after the quality pre-trim" } else { "" },
                format_thousands(POA_MAX_READ_BP)
            ));
            trimmed[..POA_MAX_READ_BP].to_string()
        } else {
            trimmed
        };
        prepared.push((r.id.clone(), r.name.clone(), raw_len, kept, input_pos));
    }

    if prepared.is_empty() {
        return PoaContigAssemblyReport {
            contig_name: clean_title.to_string(),
            consensus_sequence: String::new(),
            consensus_length_bp: 0,
            read_count: 0,
            forward_reads: 0,
            reverse_complemented_reads: 0,
            graph_node_count: 0,
            graph_edge_count: 0,
            graph_branch_bubbles: 0,
            mean_coverage_x: 0.0,
            pairwise_identity_pct: 0.0,
            disagreements_count: 0,
            coverage_per_base: Vec::new(),
            aligned_reads: Vec::new(),
            polymorphic_sites: Vec::new(),
            contig_document: SequenceDocument::default(),
            warnings,
        };
    }

    // Longest trimmed read first: the layout grows from it (ties keep the input order).
    prepared.sort_by(|a, b| b.3.len().cmp(&a.3.len()));

    // Lay the reads out by their overlaps, then align each placed read to a partial-order graph
    // seeded with that layout (BG-01M6SQ2Y). rust-bio 2.3's POA cannot take this case: it charges
    // its gap-open penalty (-4) for every gap base and -2 for a mismatch, so when a read runs past
    // the graph built so far, an end-to-end (`global`) alignment that leaves the overhang as end
    // gaps scores far below one that aligns it to unrelated graph bases (for a reverse read with a
    // 400-base overhang on a 1,000-node graph, about -2,000 against the -280 it picks), and partly
    // overlapping forward and reverse reads gave a short, garbled contig (1,065 bp, 517 edits from
    // a 1,400 bp amplicon); its `semiglobal` traceback can loop for ever (BG-01M6S17N, D0049,
    // D0052). Here every read is aligned within the layout's span, and every traceback lowers an
    // index at each step.
    let strands: Vec<(Vec<u8>, Vec<u8>)> = prepared
        .iter()
        .map(|p| (p.3.as_bytes().to_vec(), reverse_complement_iupac(&p.3, false).into_bytes()))
        .collect();
    let (mut draft, mut layout) = largest_layout(&strands);

    // Each read the layout left out that fits it in more than one place: it is named with the
    // repeat, never placed at a guess (BG-01M6TD2N).
    let index = KmerIndex::new(&draft);
    let mut ambiguous: Vec<(usize, Ambiguity)> = (0..prepared.len())
        .filter(|i| layout.iter().all(|p| p.idx != *i))
        .filter_map(|i| match best_placement(&index, &draft, &strands[i].0, &strands[i].1) {
            Placement::Ambiguous(a) => Some((i, a)),
            _ => None,
        })
        .collect();

    // The contig reads along the first read given (in input order) whose strand on the layout is
    // known: placed, or left out in more than one place. The longest read's strand no longer
    // decides it, which turned the contig round whenever the reverse reads were the longer
    // (BG-01M6TD2N).
    let first_known = layout
        .iter()
        .map(|p| (p.idx, p.strand))
        .chain(ambiguous.iter().map(|(i, a)| (*i, a.strand)))
        .min_by_key(|&(i, _)| prepared[i].4);
    if first_known.is_some_and(|(_, strand)| strand == -1) {
        let n = draft.len();
        draft = draft.iter().rev().map(|&b| iupac_complement_byte(b, false)).collect();
        for p in &mut layout {
            p.strand = -p.strand;
            p.seq = if p.strand == 1 { strands[p.idx].0.clone() } else { strands[p.idx].1.clone() };
            p.start = n as i64 - (p.start + p.seq.len() as i64);
        }
        for (_, a) in &mut ambiguous {
            a.strand = -a.strand;
            (a.draft_from, a.draft_to) = (n - a.draft_to, n - a.draft_from);
        }
    }

    let mut graph = ContigGraph::backbone(&draft);
    let mut poa_scores: HashMap<usize, i32> = HashMap::new();
    layout.retain(|p| match graph.align(&p.seq, p.start) {
        Some((score, path)) => {
            graph.add(&p.seq, &path, p.start);
            poa_scores.insert(p.idx, score);
            true
        }
        None => false,
    });

    // The reads the contig was not built from, named in input order (D0005): those it could not
    // place here; those that fit in more than one place follow, with the repeat, once the
    // consensus gives its bases.
    let label = |i: usize| {
        let (id, name) = (&prepared[i].0, &prepared[i].1);
        if name.trim().is_empty() { id.clone() } else { name.trim().to_string() }
    };
    let mut left_out: Vec<usize> = (0..prepared.len())
        .filter(|i| layout.iter().all(|p| p.idx != *i) && ambiguous.iter().all(|(a, _)| a != i))
        .collect();
    left_out.sort_by_key(|&i| prepared[i].4);
    if !left_out.is_empty() {
        let names: Vec<String> = left_out.iter().map(|&i| label(i)).collect();
        warnings.push(format!(
            "Reads {} could not be placed in one contig with the others and were left out; the contig is built from the other {} read{}.",
            names.join(", "),
            format_thousands(layout.len()),
            if layout.len() == 1 { "" } else { "s" }
        ));
    }

    // The placed reads, each on the strand the layout put it, longest first as before.
    layout.sort_by_key(|p| p.idx);
    let oriented: Vec<(String, String, usize, String, i8)> = layout
        .iter()
        .map(|p| {
            let (id, name, raw_len, _, _) = &prepared[p.idx];
            (id.clone(), name.clone(), *raw_len, String::from_utf8_lossy(&p.seq).into_owned(), p.strand)
        })
        .collect();
    let read_poa_scores: Vec<i32> = layout.iter().map(|p| poa_scores.get(&p.idx).copied().unwrap_or(0)).collect();
    let fwd_cnt = layout.iter().filter(|p| p.strand == 1).count();
    let rev_cnt = layout.len() - fwd_cnt;

    // The consensus bases, each with the draft column of its node.
    let consensus: Vec<(u8, usize)> = graph
        .consensus()
        .into_iter()
        .map(|v| (graph.base[v], graph.pos[v]))
        .filter(|(b, _)| b.is_ascii_alphabetic())
        .collect();
    let cons_bytes_owned: Vec<u8> = consensus.iter().map(|&(b, _)| b).collect();
    let consensus_sequence = String::from_utf8_lossy(&cons_bytes_owned).into_owned();
    let cons_len = consensus_sequence.len();
    let graph_node_count = graph.node_count();
    let graph_edge_count = graph.edge_count();
    let graph_branch_bubbles = graph.branch_bubbles();

    // The reads left out because they fit in more than one place, one sentence per repeat, which
    // is named by its unit and the contig bases it covers: those its placements cover, widened
    // while the consensus repeats with that unit; reads with one unit whose bases meet share a
    // sentence (BG-01M6TD2N).
    let mut repeats: Vec<(Option<usize>, usize, usize, Vec<usize>)> = Vec::new();
    ambiguous.sort_by_key(|(i, _)| prepared[*i].4);
    for (i, a) in &ambiguous {
        let mut from = consensus.partition_point(|&(_, col)| col < a.draft_from);
        let mut to = consensus.partition_point(|&(_, col)| col < a.draft_to).max(from);
        if let Some(p) = a.unit {
            while from > 0 && from - 1 + p < cons_len && cons_bytes_owned[from - 1] == cons_bytes_owned[from - 1 + p] {
                from -= 1;
            }
            while to < cons_len && to >= p && cons_bytes_owned[to] == cons_bytes_owned[to - p] {
                to += 1;
            }
        }
        match repeats.iter_mut().find(|r| r.0 == a.unit && r.1 <= to && from <= r.2) {
            Some(r) => {
                (r.1, r.2) = (r.1.min(from), r.2.max(to));
                r.3.push(*i);
            }
            None => repeats.push((a.unit, from, to, vec![*i])),
        }
    }
    for (unit, from, to, reads) in &repeats {
        let names: Vec<String> = reads.iter().map(|&i| label(i)).collect();
        let one = reads.len() == 1;
        warnings.push(format!(
            "{} {} {} the other reads only inside {} (contig bases {}-{}), where {} fits in more than one place, so how many copies the contig holds there cannot be told from these reads; {} left out and the contig is built from the other {} read{}.",
            if one { "Read" } else { "Reads" },
            names.join(", "),
            if one { "overlaps" } else { "overlap" },
            unit.map_or("a repeat".to_string(), |p| format!("a tandem repeat of a {}-bp unit", format_thousands(p))),
            format_thousands(from + 1),
            format_thousands(*to),
            if one { "it" } else { "each" },
            if one { "it was" } else { "they were" },
            format_thousands(layout.len()),
            if layout.len() == 1 { "" } else { "s" }
        ));
    }

    // Map each read onto the consensus to build the pileup. The whole read is aligned within
    // POA_BAND of where the layout placed it, the consensus beyond its ends left free, so a read
    // costs (read length x band) cells rather than (consensus length x read length): a primer walk
    // of 20 reads of 900 bp over 8 kb took about 19 s in the WASM engine with the full matrix, and
    // 0.3 s banded. Identity counts the columns of the read's own span, from its first base to its
    // last: its matches, mismatches, inserted bases and the consensus bases it lacks between its
    // ends, never the consensus beyond its ends (BG-01M6TD2N: a perfect 1,000 bp read on a 1,400 bp
    // contig showed about 71%).
    let consensus_line = ContigGraph::backbone(&cons_bytes_owned);
    let mut coverage_per_base = vec![0usize; cons_len];
    let mut base_pileup: Vec<[u16; 4]> = vec![[0u16; 4]; cons_len];
    let mut aligned_reads = Vec::with_capacity(oriented.len());
    let mut id_sum = 0.0_f64;
    let mut tally = |c: usize, br: u8, row: &mut [char]| {
        row[c] = br as char;
        coverage_per_base[c] += 1;
        if let Some(k) = b"ACGT".iter().position(|&x| x == br) {
            base_pileup[c][k] += 1;
        }
    };

    for (idx, ((id, name, raw_len, seq, strand), placed)) in oriented.iter().zip(&layout).enumerate() {
        let read = seq.as_bytes();
        let mut row_chars = vec!['-'; cons_len];
        // The consensus index of the read's first base: the consensus bases left of its draft column.
        let first = consensus.partition_point(|&(_, col)| (col as i64) < placed.start) as i64;
        let identity_pct = match consensus_line.align(read, first) {
            Some((_, path)) => {
                let (mut span, mut inserted, mut matches) = (None::<(usize, usize)>, 0usize, 0usize);
                for step in &path {
                    match *step {
                        GraphStep::Aligned { node, base } => {
                            tally(node, read[base], &mut row_chars);
                            span = Some(span.map_or((node, node), |(a, b)| (a.min(node), b.max(node))));
                            matches += usize::from(read[base] == cons_bytes_owned[node]);
                        }
                        GraphStep::Inserted { .. } => inserted += 1,
                    }
                }
                let columns = (span.map_or(0, |(a, b)| b - a + 1) + inserted).max(1);
                ((matches as f64 / columns as f64) * 10000.0).round() / 100.0
            }
            // Out of the band: the semiglobal alignment over the whole consensus, which does not
            // depend on where the layout placed the read, its identity over the columns from the
            // read's first base to its last.
            None => {
                let pw = align_pairwise_gotoh(&consensus_sequence, seq, PairwiseMode::Semiglobal, None, 2, -2, -5, -1, 0);
                let (cons_row, read_row) = (pw.aligned_seq1.as_bytes(), pw.aligned_seq2.as_bytes());
                let mut c_idx = 0usize;
                for (&bc, &br) in cons_row.iter().zip(read_row) {
                    if bc != b'-' {
                        if c_idx < cons_len && br != b'-' {
                            tally(c_idx, br, &mut row_chars);
                        }
                        c_idx += 1;
                    }
                }
                match (read_row.iter().position(|&b| b != b'-'), read_row.iter().rposition(|&b| b != b'-')) {
                    (Some(a), Some(b)) => {
                        let matches = (a..=b).filter(|&k| read_row[k] != b'-' && cons_row.get(k) == Some(&read_row[k])).count();
                        ((matches as f64 / (b - a + 1) as f64) * 10000.0).round() / 100.0
                    }
                    _ => 0.0,
                }
            }
        };
        id_sum += identity_pct;

        aligned_reads.push(PoaAlignedReadRow {
            id: id.clone(),
            name: name.clone(),
            strand: *strand,
            raw_length_bp: *raw_len,
            post_trim_length_bp: seq.len(),
            aligned_row: row_chars.into_iter().collect(),
            poa_score: read_poa_scores[idx],
            identity_pct,
        });
    }

    let cons_bytes = consensus_sequence.as_bytes();
    let mut polymorphic_sites = Vec::new();
    let mut disagreements_count = 0usize;

    for pos in 0..cons_len {
        let cb = cons_bytes[pos];
        let counts = base_pileup[pos];
        let mut alts = Vec::new();
        for (bi, &letter) in [b'A', b'C', b'G', b'T'].iter().enumerate() {
            if letter != cb && counts[bi] > 0 {
                alts.push(format!("{}:{}", letter as char, counts[bi]));
            }
        }
        if !alts.is_empty() {
            disagreements_count += 1;
            if polymorphic_sites.len() < 48 {
                polymorphic_sites.push(PoaGraphBubbleSite {
                    consensus_pos_1based: pos + 1,
                    consensus_base: (cb as char).to_string(),
                    alt_bases: alts,
                    depth: coverage_per_base[pos],
                });
            }
        }
    }

    let mean_cov = if cons_len > 0 {
        let tot_cov: usize = coverage_per_base.iter().sum();
        ((tot_cov as f64 / cons_len as f64) * 10.0).round() / 10.0
    } else {
        0.0
    };
    let mean_id = ((id_sum / aligned_reads.len().max(1) as f64) * 10.0).round() / 10.0;

    let mut doc_meta: HashMap<String, serde_json::Value> = HashMap::new();
    doc_meta.insert(
        "# Disagreements".into(),
        serde_json::json!(disagreements_count),
    );
    doc_meta.insert("% HQ".into(), serde_json::json!(format!("{mean_id:.1}%")));
    doc_meta.insert(
        "Post-Trim Length".into(),
        serde_json::json!(format!("{cons_len} bp")),
    );
    doc_meta.insert(
        "Read Technology".into(),
        serde_json::json!("Sanger Capillary POA Contig"),
    );
    // Which read the contig's orientation follows (BG-01M6TD2N): traces carry no strand of their
    // own, so a reverse read listed first turns the contig round, and the notes say so.
    if let Some((i, _)) = first_known {
        doc_meta.insert(
            "Notes".into(),
            serde_json::json!(format!(
                "Orientation: the contig reads along {}, the first read listed whose strand on the layout is known; reads on the other strand are reverse-complemented onto it.",
                label(i)
            )),
        );
    }

    let parent_ids: Vec<String> = oriented.iter().map(|r| r.0.clone()).collect();
    let contig_document = SequenceDocument {
        id: format!("doc-poa-contig-{}", cons_len),
        name: clean_title.to_string(),
        accession: format!("MBC_POA_{}", oriented.len()),
        description: format!(
            "Partial-Order Alignment (POA) consensus contig assembled from {} reads laid out by their overlaps ({} fwd, {} rev-comp; {:.1}x mean coverage).",
            oriented.len(),
            fwd_cnt,
            rev_cnt,
            mean_cov
        ),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence: consensus_sequence.clone(),
        features: vec![SequenceFeature {
            id: "feat-poa-consensus".into(),
            name: "POA Consensus Region".into(),
            feature_type: "misc_feature".into(),
            start: 1,
            end: cons_len.max(1),
            strand: 1,
            color: "#0ea5e9".into(),
            notes: Some(format!(
                "POA DAG: {} nodes, {} edges, {} disagreements",
                graph_node_count, graph_edge_count, disagreements_count
            )),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }],
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: "hist-poa-assembly".into(),
            timestamp: "2026-10-31 08:30".into(),
            operation: "Partial-Order Alignment (POA) Contig Assembly".into(),
            description: format!(
                "Assembled {} reads by partial-order alignment on their overlap layout ({} nodes, {} edges)",
                oriented.len(),
                graph_node_count,
                graph_edge_count
            ),
            parent_ids,
            length_bp: cons_len,
            topology: Topology::Linear,
            history_color: Some("#0ea5e9".into()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: Some(DocumentAlignmentMeta {
            sequence_count: Some(oriented.len()),
            pairwise_identity_pct: Some(mean_id),
            identical_sites_pct: Some(if cons_len > 0 {
                (((cons_len.saturating_sub(disagreements_count)) as f64 / cons_len as f64) * 1000.0)
                    .round()
                    / 10.0
            } else {
                100.0
            }),
            genetic_code_label: Some("Standard (1)".into()),
            mean_coverage_x: Some(mean_cov),
            tree_builder: None,
            is_aligned: Some(true),
            sequences: None,
        }),
        document_kind: Some("contig".into()),
        doc_metadata: Some(doc_meta),
        created_at: "2026-10-31T08:30:00.000Z".into(),
        updated_at: "2026-10-31T08:30:00.000Z".into(),
        folder: "Contig Assembly".into(),
    };

    PoaContigAssemblyReport {
        contig_name: clean_title.to_string(),
        consensus_sequence,
        consensus_length_bp: cons_len,
        read_count: oriented.len(),
        forward_reads: fwd_cnt,
        reverse_complemented_reads: rev_cnt,
        graph_node_count,
        graph_edge_count,
        graph_branch_bubbles,
        mean_coverage_x: mean_cov,
        pairwise_identity_pct: mean_id,
        disagreements_count,
        coverage_per_base,
        aligned_reads,
        polymorphic_sites,
        contig_document,
        warnings,
    }
}

/// Largest full matrix, `(|x| + 1) * (|y| + 1)` cells, that local and global mode align exactly
/// rather than banding (local since BG-01M6PX3B, global since BG-01M6Q2R6). rust-bio's banded aligner
/// returns an empty alignment for a band larger than this (`MAX_CELLS` in bio 2.3 `banded.rs`), so
/// the full matrix is never more cells than the largest band it would fill.
const EXACT_CELL_BUDGET: usize = 5_000_000;

/// What a banded result's label says when its band may have missed the optimum.
pub(crate) const BANDED_HEURISTIC: &str = "a heuristic that can score below the optimum";

/// How [`align_within_band_ceiling`] aligned a pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BandRun {
    /// In the k-mer band of the width asked for.
    Band,
    /// In the k-mer band at width `w`: the width asked for was halved until the band fitted
    /// rust-bio's 5,000,000-cell limit.
    Narrowed { w: usize },
    /// The sequences share no k-mer, for which rust-bio bands the whole matrix at any width, so in a
    /// band of width `w` around the straight line from the first cell to the last.
    Diagonal { w: usize },
    /// Over the full matrix, which is exact: the band exceeded rust-bio's limit and the matrix is
    /// within the [`EXACT_CELLS`] the full-matrix entry point aligns exactly.
    FullMatrix,
}

/// The band part of a banded result's label: the k-mer length, the width used, and why that is not
/// the width `w` asked for.
pub(crate) fn band_description(run: BandRun, k: usize, w: usize) -> String {
    match run {
        BandRun::Band => format!("k={k}, w={w}"),
        BandRun::Narrowed { w: used } => {
            format!("k={k}, w={used}, narrowed from w={w} to fit rust-bio's 5,000,000-cell band limit")
        }
        BandRun::Diagonal { w: used } => format!("no shared {k}-mer, so along the main diagonal at w={used}"),
        BandRun::FullMatrix => "full matrix".to_string(),
    }
}

/// Aligns `x` against `y` in a k-mer band of width `w` under `scoring`, whose clip penalties choose
/// the mode (zero for local, `MIN_SCORE` for global, as rust-bio's own `local()` and `global()` set
/// them), and returns rust-bio's alignment with its clip operations still in. The band runs along
/// the sdpkpp k-mer chain, or, with `extended`, along that chain extended past each end by the
/// LCSk++ path where that path runs through the end (BG-01M6PX3B). `x` and `y` must not be empty.
///
/// rust-bio's banded aligner fills at most 5,000,000 band cells (`MAX_CELLS` in bio 2.3
/// `banded.rs`) and returns an empty alignment scored `MIN_SCORE` (-858,993,459) for a larger band.
/// That sentinel is never returned (BG-01M6Q0K7): over the limit the pair is aligned over the full
/// matrix if it is within [`EXACT_CELLS`], otherwise in the band halved in width until it fits, and
/// around the main diagonal when the sequences share no k-mer. `None` means no such band fits even
/// at width 1, or a diagonal band was needed and the matrix is too narrow (or a side too long) for one.
pub(crate) fn align_within_band_ceiling<F: MatchFunc + Clone>(
    x: &[u8],
    y: &[u8],
    scoring: Scoring<F>,
    k: usize,
    w: usize,
    extended: bool,
) -> Option<(Alignment, BandRun)> {
    let (m, n) = (x.len(), y.len());
    let matches = find_kmer_matches(x, y, k);
    let band = |w: usize, line: Option<&[(u32, u32)]>| -> Option<Alignment> {
        let mut aligner = BandedAligner::with_scoring(scoring.clone(), k, w);
        let aln = match line {
            Some(points) => aligner.custom_with_match_path(x, y, points, &(0..points.len()).collect::<Vec<_>>()),
            None if extended => aligner.custom_with_expanded_matches(x, y, matches.clone(), None, true),
            None => aligner.custom_with_matches(x, y, &matches),
        };
        // the limit's empty alignment; a real one spans both sequences (xlen = m, ylen = n)
        let over_limit = aln.score == MIN_SCORE && aln.operations.is_empty() && aln.xlen == 0 && aln.ylen == 0;
        (!over_limit).then_some(aln)
    };
    if let Some(aln) = band(w, None) {
        return Some((aln, BandRun::Band));
    }
    if m.saturating_mul(n) <= EXACT_CELLS {
        return Some((FullAligner::with_capacity_and_scoring(m, n, scoring).custom(x, y), BandRun::FullMatrix));
    }
    // With no shared k-mer rust-bio bands the whole matrix at every width, so the band follows the
    // main diagonal instead, from the width asked for; otherwise the k-mer band is halved.
    let line = if matches.is_empty() { Some(diagonal_points(m, n, k)?) } else { None };
    let mut width = if line.is_some() { w } else { w / 2 };
    while width >= 1 {
        if let Some(aln) = band(width, line.as_deref()) {
            let run = if line.is_some() { BandRun::Diagonal { w: width } } else { BandRun::Narrowed { w: width } };
            return Some((aln, run));
        }
        width /= 2;
    }
    None
}

/// Aligns `x` against `y` under `scoring` in a band of width `w` along `chain`, the positions of
/// k-mer matches (`k` bases equal in `x` and `y` from each), increasing in both sequences, that the
/// caller chose, where [`align_within_band_ceiling`] bands along the chain sdpkpp finds in this pair
/// alone. The variant caller passes each segment of a sample the part of the chain it found over
/// the whole sample (BG-01M6S1QP), so a segment is banded along the whole sample's chain.
///
/// Like [`align_within_band_ceiling`] it never returns rust-bio's over-limit sentinel: a band over
/// rust-bio's 5,000,000-cell limit is aligned over the full matrix when that is within
/// [`EXACT_CELLS`], otherwise in the band halved in width until it fits. With no chain, rust-bio
/// would band the whole matrix, so the pair is aligned over the full matrix when that is within
/// [`EXACT_CELLS`], otherwise along the main diagonal. `None` only when no band fits even at width
/// 1, or the chain is empty and the matrix is over [`EXACT_CELLS`] and too narrow for a diagonal
/// band. `x` and `y` must not be empty.
pub(crate) fn align_along_chain<F: MatchFunc + Clone>(
    x: &[u8],
    y: &[u8],
    scoring: Scoring<F>,
    k: usize,
    w: usize,
    chain: &[(u32, u32)],
) -> Option<Alignment> {
    let (m, n) = (x.len(), y.len());
    let band = |w: usize, points: &[(u32, u32)]| -> Option<Alignment> {
        let path: Vec<usize> = (0..points.len()).collect();
        let aln = BandedAligner::with_scoring(scoring.clone(), k, w).custom_with_match_path(x, y, points, &path);
        let over_limit = aln.score == MIN_SCORE && aln.operations.is_empty() && aln.xlen == 0 && aln.ylen == 0;
        (!over_limit).then_some(aln)
    };
    if !chain.is_empty() {
        if let Some(aln) = band(w, chain) {
            return Some(aln);
        }
    }
    if m.saturating_mul(n) <= EXACT_CELLS {
        return Some(FullAligner::with_capacity_and_scoring(m, n, scoring).custom(x, y));
    }
    let line;
    let (points, mut width) = if chain.is_empty() {
        line = diagonal_points(m, n, k)?;
        (line.as_slice(), w)
    } else {
        (chain, w / 2)
    };
    while width >= 1 {
        if let Some(aln) = band(width, points) {
            return Some(aln);
        }
        width /= 2;
    }
    None
}

/// Pseudo k-mer positions on the straight line from (0, 0) to (m - k, n - k), the path of a band
/// along the main diagonal of an m x n matrix. Consecutive points are at most 4,096 cells apart, so
/// rust-bio's interpolation of the line between them (a u32 product of the two spans) cannot
/// overflow, and at least `k` apart in both sequences, so each pseudo k-mer starts past the end of
/// the one before. `None` when the matrix is too narrow for that, or a side is longer than u32.
fn diagonal_points(m: usize, n: usize, k: usize) -> Option<Vec<(u32, u32)>> {
    let longest = u32::try_from(m.max(n)).ok()? as u64;
    let (mk, nk, k) = ((m.checked_sub(k)?) as u64, (n.checked_sub(k)?) as u64, k as u64);
    let steps = longest.div_ceil(4096).max(1);
    if mk / steps < k || nk / steps < k {
        return None;
    }
    Some((0..=steps).map(|i| ((i * mk / steps) as u32, (i * nk / steps) as u32)).collect())
}

/// The most residues of each sequence [`align_pairwise_banded_sparse`] aligns for a `max_len`: 25,000
/// when it is 0, otherwise `max_len` up to 100,000.
const BANDED_DEFAULT_CAP: usize = 25_000;
const BANDED_CEILING: usize = 100_000;
fn banded_input_cap(max_len: usize) -> usize {
    if max_len == 0 {
        BANDED_DEFAULT_CAP
    } else {
        max_len.min(BANDED_CEILING)
    }
}

/// A banded pairwise alignment as the `align_pairwise_banded_sparse` RPC op replies with it
/// ([`align_pairwise_banded_sparse_with_warnings`], BG-01M6S17Y): the alignment's own fields, and
/// `warnings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandedPairwiseAlignment {
    #[serde(flatten)]
    pub alignment: PairwiseAlignmentResult,
    /// What the input cap cut (D0005): one sentence naming each sequence whose residues are over the
    /// cap, with its whole length, and the length aligned. Always serialised, as an empty list when
    /// neither sequence was cut.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// [`align_pairwise_banded_sparse`], with the warning its reply owes when the cap of
/// [`banded_input_cap`] cut either sequence: the cap, each cut sequence with its whole length in
/// residues (the letters the aligner reads, as [`clean_alpha_sequence`] keeps them), and, when
/// `max_len` was over the 100,000-residue ceiling, the `max_len` asked for. No warning when both
/// sequences were aligned whole.
#[allow(clippy::too_many_arguments)]
pub fn align_pairwise_banded_sparse_with_warnings(
    seq1: &str,
    seq2: &str,
    mode: &str,
    k: usize,
    w: usize,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    max_len: usize,
) -> BandedPairwiseAlignment {
    let cap = banded_input_cap(max_len);
    let cut: Vec<String> = [seq1, seq2]
        .iter()
        .enumerate()
        .filter_map(|(i, raw)| {
            let whole = clean_alpha_sequence(raw).len();
            (whole > cap).then(|| format!("sequence {} ({} residues)", i + 1, format_thousands(whole)))
        })
        .collect();
    let warnings = if cut.is_empty() {
        Vec::new()
    } else {
        let ceiling = if max_len > BANDED_CEILING {
            format!(" (the most it aligns; maxLen {} was asked for)", format_thousands(max_len))
        } else {
            String::new()
        };
        let cap = format_thousands(cap);
        let aligned = if cut.len() == 1 {
            format!("Only its first {cap} residues were aligned.")
        } else {
            format!("Only the first {cap} residues of each were aligned.")
        };
        vec![format!(
            "Banded alignment input truncated to the length cap of {cap} residues{ceiling}: {}. {aligned}",
            cut.join(", ")
        )]
    };
    BandedPairwiseAlignment {
        alignment: align_pairwise_banded_sparse(
            seq1, seq2, mode, k, w, match_score, mismatch_score, gap_open, gap_extend, max_len,
        ),
        warnings,
    }
}

/// Pairwise alignment for multi-kilobase / large-construct sequences: dynamic programming in a band
/// of width `w` around a sparse k-mer backbone (`bio::alignment::pairwise::banded::Aligner`), except
/// that local and global mode align a matrix within [`EXACT_CELL_BUDGET`] in full. Semi-global mode
/// bands at every size. Every banded result is labelled a heuristic that can score below the
/// optimum; a full-matrix result is labelled as exact.
///
/// Local mode (BG-01M6PX3B): the band covers only the chain of shared k-mers ±`w` (and `2k` past
/// its ends), and a local optimum may lie on another diagonal or run past the chain's ends, so any
/// band short of the whole matrix can miss it. Local mode therefore runs full-matrix
/// Smith-Waterman (exact) while the matrix is within [`EXACT_CELL_BUDGET`]. Above that it bands
/// along the sdpkpp chain extended past each end by the LCSk++ (longest k-mer chain) path where
/// that path runs through the end, so in a divergent homolog the band carries on past the best
/// gap-penalised fragment instead of stopping `2k` beyond it. That band is still a heuristic: it
/// can miss a short optimum in unrelated sequence, or one that runs through unrelated flanks under
/// scoring so lenient that local alignments of unrelated DNA grow with length.
///
/// Global mode (BG-01M6Q2R6): a band can miss the global optimum the same way, by thousands on
/// divergent homologs, so global mode runs full-matrix Needleman-Wunsch-Gotoh (exact) within the same
/// budget. Above it, when the sdpkpp chain's band fits it also aligns in the LCSk++-extended band and
/// keeps the better alignment: on long homologs between random flanks the extension rescues some
/// pairs the chain band loses and loses others the chain band gets right.
///
/// In every mode a band larger than rust-bio's 5,000,000-cell limit goes through the fallbacks of
/// [`align_within_band_ceiling`] (BG-01M6Q0K7) instead of returning rust-bio's empty sentinel; a pair
/// none of them can align comes back with no rows and a label that starts "Not aligned".
pub fn align_pairwise_banded_sparse(
    seq1: &str,
    seq2: &str,
    mode: &str,
    k: usize,
    w: usize,
    match_score: i32,
    mismatch_score: i32,
    gap_open: i32,
    gap_extend: i32,
    max_len: usize,
) -> PairwiseAlignmentResult {
    let cap = banded_input_cap(max_len);
    let s1 = {
        let c = clean_alpha_sequence(seq1);
        if c.len() > cap {
            c[..cap].to_string()
        } else {
            c
        }
    };
    let s2 = {
        let c = clean_alpha_sequence(seq2);
        if c.len() > cap {
            c[..cap].to_string()
        } else {
            c
        }
    };

    if s1.is_empty() || s2.is_empty() {
        let mode_lower = mode.to_ascii_lowercase();
        let pairwise_mode = if mode_lower.contains("local") || mode_lower.contains("sw") {
            PairwiseMode::Local
        } else if mode_lower.contains("semi") {
            PairwiseMode::Semiglobal
        } else {
            PairwiseMode::Global
        };
        return align_pairwise_gotoh(
            &s1, &s2, pairwise_mode, None, match_score, mismatch_score,
            gap_open, gap_extend, cap,
        );
    }

    let is_prot = looks_like_protein_sequence(&s1) || looks_like_protein_sequence(&s2);
    let k_eff = k.clamp(3, 15).min(s1.len().min(s2.len()).max(1));
    let w_eff = w.clamp(8, 256);
    let m_sc = if match_score == 0 { 2 } else { match_score };
    let mm_sc = if mismatch_score == 0 {
        -1
    } else {
        -mismatch_score.abs()
    };
    let go = -gap_open.abs().max(1);
    let ge = -gap_extend.abs().max(1);

    let match_fn = move |a: u8, b: u8| -> i32 {
        if a == b || (!is_prot && compatible_nucleotides(a, b)) {
            m_sc
        } else {
            mm_sc
        }
    };

    let x = s1.as_bytes();
    let y = s2.as_bytes();
    let mode_lower = mode.to_ascii_lowercase();
    let is_local = mode_lower.contains("local") || mode_lower.contains("sw");
    let is_semi = !is_local && mode_lower.contains("semi");
    let exact = !is_semi && (x.len() + 1).saturating_mul(y.len() + 1) <= EXACT_CELL_BUDGET;
    let (aln, band_run) = if exact {
        let mut full = FullAligner::with_capacity(x.len(), y.len(), go, ge, match_fn);
        (if is_local { full.local(x, y) } else { full.global(x, y) }, None)
    } else {
        // The clip penalties rust-bio's own `local()`, `semiglobal()` and `global()` set: free clips
        // of both sequences, free clips of the second only (all of the first is aligned), no free
        // clips. Local mode bands along the sdpkpp ∪ LCSk++ chain, semi-global along the sdpkpp
        // chain, and global along both, keeping the better alignment.
        let scoring = Scoring::new(go, ge, match_fn);
        let scoring = if is_local { scoring.xclip(0).yclip(0) } else if is_semi { scoring.yclip(0) } else { scoring };
        let ran = match align_within_band_ceiling(x, y, scoring.clone(), k_eff, w_eff, is_local) {
            // a full-matrix fallback is already exact, and with no shared k-mer the extension is the
            // same diagonal band, so only a k-mer band is worth a second, extended try
            Some((chain, run @ (BandRun::Band | BandRun::Narrowed { .. }))) if !is_local && !is_semi => {
                match align_within_band_ceiling(x, y, scoring, k_eff, w_eff, true) {
                    Some(extended) if extended.0.score > chain.score => Some(extended),
                    _ => Some((chain, run)),
                }
            }
            other => other,
        };
        let Some((mut aln, run)) = ran else {
            return not_aligned(format!(
                "Not aligned: no band this aligner can build through the {} x {} matrix fits rust-bio's \
                 5,000,000-cell band limit, and the matrix is too large to align in full; align shorter sequences",
                x.len() + 1,
                y.len() + 1
            ));
        };
        aln.mode = if is_local {
            AlignmentMode::Local
        } else if is_semi {
            AlignmentMode::Semiglobal
        } else {
            AlignmentMode::Global
        };
        if is_local || is_semi {
            aln.filter_clip_operations();
        }
        (aln, Some(run))
    };

    let mut aligned1 = Vec::with_capacity(aln.operations.len());
    let mut aligned2 = Vec::with_capacity(aln.operations.len());
    let mut midline = Vec::with_capacity(aln.operations.len());
    let mut xi = aln.xstart;
    let mut yi = aln.ystart;
    let mut matches = 0usize;
    let mut mismatches = 0usize;
    let mut gaps = 0usize;
    let mut similar = 0usize;

    for op in &aln.operations {
        match *op {
            AlignmentOperation::Match | AlignmentOperation::Subst => {
                let bx = x.get(xi).copied().unwrap_or(b'N');
                let by = y.get(yi).copied().unwrap_or(b'N');
                xi += 1;
                yi += 1;
                aligned1.push(bx);
                aligned2.push(by);
                if bx == by {
                    matches += 1;
                    similar += 1;
                    midline.push(b'|');
                } else {
                    mismatches += 1;
                    if !is_prot && compatible_nucleotides(bx, by) {
                        similar += 1;
                        midline.push(b':');
                    } else {
                        midline.push(b'.');
                    }
                }
            }
            // In `rust-bio`, Ins consumes query x (gap in reference y); Del consumes reference y (gap in query x)
            AlignmentOperation::Ins => {
                let bx = x.get(xi).copied().unwrap_or(b'N');
                xi += 1;
                gaps += 1;
                aligned1.push(bx);
                aligned2.push(b'-');
                midline.push(b' ');
            }
            AlignmentOperation::Del => {
                let by = y.get(yi).copied().unwrap_or(b'N');
                yi += 1;
                gaps += 1;
                aligned1.push(b'-');
                aligned2.push(by);
                midline.push(b' ');
            }
            AlignmentOperation::Xclip(len) => {
                if !is_local {
                    for _ in 0..len {
                        let bx = x.get(xi).copied().unwrap_or(b'N');
                        xi += 1;
                        gaps += 1;
                        aligned1.push(bx);
                        aligned2.push(b'-');
                        midline.push(b' ');
                    }
                } else {
                    xi += len;
                }
            }
            AlignmentOperation::Yclip(len) => {
                if !is_local {
                    for _ in 0..len {
                        let by = y.get(yi).copied().unwrap_or(b'N');
                        yi += 1;
                        gaps += 1;
                        aligned1.push(b'-');
                        aligned2.push(by);
                        midline.push(b' ');
                    }
                } else {
                    yi += len;
                }
            }
        }
    }

    let cols = aligned1.len().max(1);
    let id_pct = ((matches as f64 / cols as f64) * 1000.0).round() / 10.0;
    let method = if is_local {
        "Smith-Waterman"
    } else if is_semi {
        "semi-global (second sequence's end gaps free)"
    } else {
        "Needleman-Wunsch"
    };

    // Build run-length encoded CIGAR directly from `aln.operations` (since `bio-types` `aln.cigar()`
    // panics on `AlignmentMode::Global`).
    let mut cigar = String::new();
    let mut run_ch: Option<char> = None;
    let mut run_len = 0usize;
    let flush_cigar = |out: &mut String, ch: Option<char>, len: usize| {
        if let Some(c) = ch {
            if len > 0 {
                out.push_str(&format!("{len}{c}"));
            }
        }
    };
    for op in &aln.operations {
        let (ch, step) = match *op {
            AlignmentOperation::Match => ('=', 1usize),
            AlignmentOperation::Subst => ('X', 1usize),
            AlignmentOperation::Ins => ('I', 1usize),
            AlignmentOperation::Del => ('D', 1usize),
            AlignmentOperation::Xclip(n) | AlignmentOperation::Yclip(n) => ('S', n),
        };
        if run_ch == Some(ch) {
            run_len += step;
        } else {
            flush_cigar(&mut cigar, run_ch, run_len);
            run_ch = Some(ch);
            run_len = step;
        }
    }
    flush_cigar(&mut cigar, run_ch, run_len);

    PairwiseAlignmentResult {
        aligned_seq1: String::from_utf8_lossy(&aligned1).into_owned(),
        aligned_seq2: String::from_utf8_lossy(&aligned2).into_owned(),
        midline: String::from_utf8_lossy(&midline).into_owned(),
        score: aln.score,
        matches,
        mismatches,
        gaps,
        identity_pct: id_pct,
        similarity_pct: ((similar as f64 / cols as f64) * 1000.0).round() / 10.0,
        xstart: aln.xstart,
        xend: aln.xend,
        ystart: aln.ystart,
        yend: aln.yend,
        cigar,
        algorithm: match band_run {
            None => format!("{method} (full matrix: small enough to align exactly, no k-mer band)"),
            Some(BandRun::FullMatrix) => format!(
                "{method} (full matrix: the k-mer band would exceed rust-bio's 5,000,000-cell band limit, \
                 and the matrix is small enough to align exactly)"
            ),
            Some(run) => format!(
                "Banded Sparse {method} ({}) — {BANDED_HEURISTIC}",
                band_description(run, k_eff, w_eff)
            ),
        },
        engine_used: match band_run {
            None | Some(BandRun::FullMatrix) => "rust-bio::alignment::pairwise::Aligner".into(),
            Some(_) => "rust-bio::alignment::pairwise::banded::Aligner".into(),
        },
    }
}

/// Partial-order alignment consensus (rust-bio `poa::Aligner`) over the inputs in their original
/// orientation and order. It is used only as a backbone; members are then merged by center-star so
/// that every residue (including insertions relative to the consensus) is kept.
fn poa_backbone(cleaned: &[String]) -> String {
    let mut order: Vec<usize> = (0..cleaned.len()).filter(|&i| !cleaned[i].is_empty()).collect();
    if order.is_empty() {
        return String::new();
    }
    order.sort_by(|&a, &b| cleaned[b].len().cmp(&cleaned[a].len()).then(a.cmp(&b)));
    let scoring = Scoring::new(-4, -2, |a: u8, b: u8| if a == b { 2i32 } else { -2i32 });
    let mut aligner = PoaAligner::new(scoring, cleaned[order[0]].as_bytes());
    for &i in order.iter().skip(1) {
        let aln = aligner.global(cleaned[i].as_bytes()).alignment();
        aligner.add_alignment(&aln);
    }
    String::from_utf8_lossy(&aligner.consensus())
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect()
}

/// Maps a preset identifier (`consistency-nj`, `consistency-upgma`, `progressive-upgma`,
/// `graph-backbone`) or a legacy saved preset label (`MAFFT …`, `MUSCLE …`, `Clustal …`, `POA …`)
/// to the canonical uppercase dispatch key used by
/// [`run_multiple_sequence_alignment_with_algorithm`].
pub fn canonical_msa_preset_key(algorithm: &str) -> &'static str {
    let upper = algorithm.trim().to_ascii_uppercase();
    if upper.contains("CONSISTENCY-NJ") || upper.contains("MAFFT") {
        "CONSISTENCY-NJ"
    } else if upper.contains("CONSISTENCY-UPGMA") || upper.contains("MUSCLE") {
        "CONSISTENCY-UPGMA"
    } else if upper.contains("PROGRESSIVE-UPGMA") || upper.contains("CLUSTAL") {
        "PROGRESSIVE-UPGMA"
    } else if upper.contains("GRAPH-BACKBONE") || upper.contains("POA") {
        "GRAPH-BACKBONE"
    } else {
        ""
    }
}

/// Runs Multiple Sequence Alignment with explicit preset dispatch. These are built-in presets that
/// follow the *strategy* of well-known tools; they do not run the external programs:
///
/// * `consistency-nj` (legacy `MAFFT`) – consistency-based progressive alignment (L-INS-i-like
///   library of all pairwise alignments) with 2 tree-dependent refinement passes and an NJ tree.
/// * `consistency-upgma` (legacy `MUSCLE`) – the same consistency route (as MUSCLE 5) with 3
///   refinement passes and a UPGMA tree.
/// * `progressive-upgma` (legacy `Clustal`) – profile progressive alignment (BLOSUM62 / affine
///   gaps, Henikoff weights), guide tree rebuilt from the first alignment, 2 refinement passes,
///   UPGMA tree.
/// * `graph-backbone` (legacy `POA`) – rust-bio partial-order graph consensus as the alignment
///   backbone, NJ guide tree.
///
/// The output tree is the guide tree type named for the preset (NJ or UPGMA).
///
/// Refinement passes are accepted only if they improve the sum-of-pairs score. Every preset keeps
/// all input residues in order and never emits gap-only columns.
pub fn run_multiple_sequence_alignment_with_algorithm(
    docs: &[MsaInputDoc],
    max_seq_len: usize,
    algorithm: &str,
) -> MsaAlignmentResult {
    let algo_upper = canonical_msa_preset_key(algorithm);
    if docs.len() <= 1 {
        return run_multiple_sequence_alignment(docs, max_seq_len);
    }
    let cleaned = clean_msa_inputs(docs, max_seq_len);
    let is_prot = cleaned.iter().any(|s| looks_like_protein_sequence(s));
    let tree = if algo_upper.contains("PROGRESSIVE-UPGMA") || algo_upper.contains("CONSISTENCY-UPGMA") {
        MsaTreeBuilder::Upgma
    } else {
        MsaTreeBuilder::NeighborJoining
    };

    let center_idx = choose_star_center(&cleaned, is_prot);
    let star = center_star_rows(&cleaned[center_idx], &cleaned, Some(center_idx), is_prot);

    let matrix = if algo_upper.contains("GRAPH-BACKBONE") {
        let backbone = poa_backbone(&cleaned);
        let candidate = center_star_rows(&backbone, &cleaned, None, is_prot);
        // Fall back to the plain center-star result if the POA backbone scores worse.
        if !backbone.is_empty() && sum_of_pairs_score(&candidate) >= sum_of_pairs_score(&star) {
            candidate
        } else {
            star
        }
    } else {
        // progressive alignment up a guide tree (the ClustalW / MUSCLE / MAFFT method family);
        // the old center-star result is kept only if it scores better (it never did on the Pfam
        // seed benchmark, where progressive alignment is ~0.05–0.24 Q closer to the reference)
        let upper: Vec<Vec<u8>> = cleaned.iter().map(|s| s.to_ascii_uppercase().into_bytes()).collect();
        // progressive-upgma preset: progressive + tree rebuilt from the first alignment + refinement.
        // consistency-nj / consistency-upgma presets: consistency-based (as L-INS-i and MUSCLE 5),
        // falling back to the same progressive route when the pairwise library would be too large.
        let opts = crate::progressive::ProgressiveOptions { second_pass: true, refine_passes: 2 };
        let _ = star;
        let n = upper.len();
        let mean = upper.iter().map(|s| s.len()).sum::<usize>() / n.max(1);
        // consistency-nj / consistency-upgma presets: consistency-based (L-INS-i-like) while the library stays affordable
        let consistency = algo_upper.contains("CONSISTENCY-NJ") || algo_upper.contains("CONSISTENCY-UPGMA");
        if consistency && n <= 120 && n * n * mean <= 30_000_000 {
            crate::progressive::consistency_msa(&upper, is_prot, if algo_upper.contains("CONSISTENCY-UPGMA") { 3 } else { 2 })
        } else {
            crate::progressive::progressive_msa(&upper, is_prot, opts)
        }
    };
    finalize_msa(docs, matrix, tree)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The first 129 bp of an EcoRI-eGFP amplicon. The contig tests read stretches of it that
    /// overlap by at least POA_MIN_OVERLAP_BP, as a read must to join a contig (BG-01M6SQ2Y); the
    /// reads were 36 to 48 bp, overlapping by 36 to 39, before that rule.
    const EGFP: &str = "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGC";

    #[test]
    fn assembles_forward_and_reverse_reads_via_rust_bio_poa_and_banded_dp() {
        let reads = vec![
            PoaReadInput {
                id: "r1".into(),
                name: "Clone1_Fwd.ab1".into(),
                sequence: EGFP[..90].into(),
                phred_scores: vec![40; 90],
            },
            PoaReadInput {
                id: "r2".into(),
                name: "Clone1_Mid_Fwd.ab1".into(),
                sequence: EGFP[6..120].into(),
                phred_scores: vec![38; 114],
            },
            PoaReadInput {
                id: "r3".into(),
                name: "Clone1_Rev.ab1".into(),
                sequence: reverse_complement_iupac(&EGFP[18..], false),
                phred_scores: vec![36; 111],
            },
        ];

        let rep = assemble_sanger_contig_poa(&reads, "eGFP_Amplicon_Contig", true);
        assert_eq!(rep.read_count, 3);
        assert_eq!(rep.forward_reads, 2);
        assert_eq!(rep.reverse_complemented_reads, 1);
        assert!(rep.consensus_length_bp >= 45);
        assert!(rep.graph_node_count >= 45);
        assert!(rep.mean_coverage_x >= 2.0);

        let banded = align_pairwise_banded_sparse(
            "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC",
            "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTTACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC",
            "global",
            6,
            16,
            2,
            -1,
            -5,
            -1,
            5000,
        );
        assert_eq!(banded.mismatches, 1);
        assert!(banded.identity_pct > 97.0);
    }

    /// BG-01M6RPCA: contig assembly pre-trims each read with Mott's trim at P(err) 0.05. A read with
    /// no base whose error probability is below the cutoff keeps none of its bases, so it takes no
    /// part in the contig; it used to be kept whole. A read with good bases keeps its best stretch,
    /// and a read with no quality values is not trimmed. Wrong implementations, and the case that
    /// catches each: the whole-read fallback (the bug), the Q0 and Q13 reads; no region only when
    /// every quality is 0, the Q13 read (P(err) 0.0501, just over 0.05); no region whenever some base
    /// misses the cutoff, the read with Q2 ends; no region whenever the trim keeps the whole read, the
    /// Q14 read; the cutoff fixed at 0.05, the Q17 read; a read with no qualities trimmed to nothing,
    /// the unscored read; the assembler putting the raw read back when the trim keeps nothing, the
    /// assembly below, whose Q0 read is the longest, overlaps the good reads and runs 60 bases
    /// past them, so kept it would seed the layout and lengthen the contig. (Before BG-01M6SQ2Y it
    /// was unrelated to them; a read that overlaps no other is now left out whether trimmed or not.)
    #[test]
    fn contig_pretrim_keeps_nothing_of_an_all_bad_read() {
        let read30 = "ACGT".repeat(8)[..30].to_string();
        assert_eq!(mott_trim_read(&read30, &[0; 30], 0.05), "");
        assert_eq!(mott_trim_read(&read30, &[13; 30], 0.05), "");
        assert_eq!(mott_trim_read(&read30, &[14; 30], 0.05), read30);
        assert_eq!(mott_trim_read(&read30, &[17; 30], 0.05), read30);
        assert_eq!(mott_trim_read(&read30, &[17; 30], 0.01), "");
        assert_eq!(mott_trim_read(&read30, &[], 0.05), read30);
        let ends = [vec![2u8; 6], vec![40; 13], vec![2; 6]].concat();
        assert_eq!(mott_trim_read(&read30[..25], &ends, 0.05), read30[6..19]);

        let read = |id: &str, sequence: String, phred_scores: Vec<u8>| PoaReadInput {
            id: id.into(),
            name: format!("{id}.ab1"),
            sequence,
            phred_scores,
        };
        let good = vec![
            read("fwd", EGFP[..90].into(), vec![40; 90]),
            read("mid", EGFP[6..120].into(), vec![38; 114]),
            read("rev", reverse_complement_iupac(&EGFP[18..], false), vec![36; 111]),
        ];
        // Longer than every good read: 89 bases of theirs, then 60 they do not have.
        let bad_seq = format!("{}{}", &EGFP[40..], &"CGTACGATTGCAAGCTTGACCTAGGATCCGATATCTCGAGTTAACTGCAGCATGCAAGCTTACGTAGCTAGCTAGGTTC"[..60]);
        let bad = read("bad", bad_seq.clone(), vec![0; bad_seq.len()]);
        let with_bad: Vec<PoaReadInput> = good.iter().cloned().chain([bad]).collect();

        let alone = assemble_sanger_contig_poa(&good, "contig", true);
        let trimmed = assemble_sanger_contig_poa(&with_bad, "contig", true);
        assert_eq!(trimmed.read_count, 3);
        assert!(trimmed.aligned_reads.iter().all(|r| r.id != "bad"));
        assert_eq!(trimmed.consensus_sequence, alone.consensus_sequence);
        // The good reads keep every base, so the trim changes nothing else.
        assert!(trimmed.aligned_reads.iter().all(|r| r.post_trim_length_bp == r.raw_length_bp));
        // The fixture reaches it: kept, the Q0 read seeds the graph and changes the contig.
        let untrimmed = assemble_sanger_contig_poa(&with_bad, "contig", false);
        assert_eq!(untrimmed.read_count, 4);
        assert_ne!(untrimmed.consensus_sequence, alone.consensus_sequence);
    }

    /// A fixed-seed generator for the BG-01M6S17N reads (rule 16: large inputs are made in the test).
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0 >> 33
        }
        fn base(&mut self) -> u8 {
            b"ACGT"[(self.next() % 4) as usize]
        }
    }

    fn hq_read(id: &str, sequence: String) -> PoaReadInput {
        let phred_scores = vec![40; sequence.len()];
        PoaReadInput { id: id.into(), name: format!("{id}.ab1"), sequence, phred_scores }
    }

    /// Runs the assembly on a worker thread and fails the test when it has not returned by the
    /// deadline, so a traceback that never ends is reported rather than left running.
    fn assemble_within(reads: Vec<PoaReadInput>, secs: u64) -> PoaContigAssemblyReport {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(assemble_sanger_contig_poa(&reads, "contig", true));
        });
        rx.recv_timeout(std::time::Duration::from_secs(secs))
            .unwrap_or_else(|_| panic!("the contig assembly did not finish within {secs} s"))
    }

    /// BG-01M6S17N, root cause of the hang: rust-bio 2.3's `poa::Aligner::semiglobal` fills its
    /// score matrix with a free query-prefix clip, then restores the aligner's own (global) clip
    /// penalties before `alignment()` traces it back. A cell whose score came from that clip
    /// matches no move the traceback knows, so it jumps to graph node 0 without consuming a base;
    /// once node 0 has a predecessor it can re-enter the same cell for ever, pushing one operation
    /// each turn until memory runs out (natively the process is killed near 4 GB; over WASM the
    /// engine traps). The assembler aligns each read with `global`, whose fill and traceback agree.
    /// The fixture is a layout that hung: four forward reads over the first 1,000 bases of a
    /// 1,400 bp amplicon and four reverse reads over its last 1,000, each with 1% of its bases
    /// redrawn at random and 0.3% each inserted and deleted.
    #[test]
    fn contig_assembles_partly_overlapping_forward_and_reverse_reads_without_hanging() {
        let mut r = Lcg(1);
        let template: Vec<u8> = (0..1400).map(|_| r.base()).collect();
        let reads: Vec<PoaReadInput> = (0..8)
            .map(|i| {
                let (start, end) = if i % 2 == 0 { (0, 1000) } else { (400, 1400) };
                let mut s = Vec::new();
                for &b in &template[start..end] {
                    let x = r.next() % 1000;
                    if x < 10 {
                        s.push(r.base());
                    } else if x < 13 {
                        s.push(b);
                        s.push(r.base());
                    } else if x >= 16 {
                        s.push(b);
                    }
                }
                let s = String::from_utf8(s).unwrap();
                let s = if i % 2 == 0 { s } else { reverse_complement_iupac(&s, false) };
                hq_read(&format!("read{i}"), s)
            })
            .collect();
        let lengths: Vec<usize> = reads.iter().map(|r| r.sequence.len()).collect();
        let rep = assemble_within(reads, 45);
        assert_eq!(rep.read_count, 8);
        assert_eq!(rep.forward_reads, 4);
        assert_eq!(rep.reverse_complemented_reads, 4);
        for (i, len) in lengths.iter().enumerate() {
            let row = rep.aligned_reads.iter().find(|a| a.id == format!("read{i}")).expect("every read is in the contig");
            assert_eq!((row.raw_length_bp, row.post_trim_length_bp), (*len, *len));
        }
        assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    }

    /// BG-01M6S17N: the assembler takes every read it is given over its whole trimmed length. Eight
    /// 1,400 bp reads of one amplicon, half of them reverse reads, each with about 1%
    /// substitutions: all eight are in the contig at 1,400 bp, and their consensus is the amplicon
    /// end to end. Wrong implementations, and what catches each: a read cap such as the studio's
    /// old first 6 (the read count and the rows), a length cap below 1,400 such as its old 1,200
    /// (the post-trim lengths, and the warning it would owe).
    #[test]
    fn contig_uses_every_read_over_its_whole_length() {
        let mut r = Lcg(0x5EED);
        let template: Vec<u8> = (0..1400).map(|_| r.base()).collect();
        let reads: Vec<PoaReadInput> = (0..8)
            .map(|i| {
                let substitute = |b: u8| match b {
                    b'A' => b'C',
                    b'C' => b'G',
                    b'G' => b'T',
                    _ => b'A',
                };
                let s: Vec<u8> = template.iter().map(|&b| if r.next() % 100 == 0 { substitute(b) } else { b }).collect();
                let s = String::from_utf8(s).unwrap();
                let s = if i % 2 == 0 { s } else { reverse_complement_iupac(&s, false) };
                hq_read(&format!("read{i}"), s)
            })
            .collect();
        let rep = assemble_within(reads, 45);
        assert_eq!(rep.read_count, 8);
        assert_eq!(rep.aligned_reads.len(), 8);
        assert!(rep.aligned_reads.iter().all(|a| a.raw_length_bp == 1400 && a.post_trim_length_bp == 1400));
        assert_eq!(rep.consensus_sequence.as_bytes(), &template[..]);
        assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
        assert_eq!(rep.contig_document.alignment_meta.as_ref().and_then(|m| m.sequence_count), Some(8));
    }

    /// BG-01M6SQ2Y, natively (the studio's cases run over the WASM build): four forward reads over
    /// the first 1,000 bases of a 1,400 bp amplicon and four reverse reads over its last 1,000, and
    /// the same over 1-750 and 651-1,400, each read with about 1% of its bases substituted. The
    /// contig is the amplicon's 1,400 bases, right at every position where more than half the
    /// reads over it carry the amplicon's base (the generator knows which), and an unrelated read
    /// is left out by name without changing it. Wrong implementations, and what catches each: the
    /// old end-to-end POA, which folds an overhang onto unrelated graph bases (the length: about
    /// 1,060 and 800 bp); a junction that drops or repeats bases (the length, and every base after
    /// it); a contig grown from the unrelated read, ticked first (the read count).
    #[test]
    fn contig_of_partly_overlapping_reads_is_the_amplicon() {
        for (seed, (fwd, rev)) in [(11u64, ((0, 1000), (400, 1400))), (12, ((0, 750), (650, 1400)))] {
            let mut r = Lcg(seed);
            let template: Vec<u8> = (0..1400).map(|_| r.base()).collect();
            let (mut depth, mut carriers) = (vec![0usize; 1400], vec![0usize; 1400]);
            let mut reads: Vec<PoaReadInput> = (0..8)
                .map(|i| {
                    let (start, end) = if i % 2 == 0 { fwd } else { rev };
                    let s: Vec<u8> = template[start..end]
                        .iter()
                        .map(|&b| if r.next() % 100 == 0 { b"ACGT"[(b"ACGT".iter().position(|&x| x == b).unwrap() + 1) % 4] } else { b })
                        .collect();
                    for (k, &b) in s.iter().enumerate() {
                        depth[start + k] += 1;
                        carriers[start + k] += usize::from(b == template[start + k]);
                    }
                    let s = String::from_utf8(s).unwrap();
                    hq_read(&format!("read{i}"), if i % 2 == 0 { s } else { reverse_complement_iupac(&s, false) })
                })
                .collect();
            let rep = assemble_within(reads.clone(), 45);
            assert_eq!((rep.read_count, rep.forward_reads, rep.reverse_complemented_reads), (8, 4, 4));
            assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
            assert_eq!(rep.consensus_length_bp, 1400, "seed {seed}");
            let wrong: Vec<usize> = (0..1400)
                .filter(|&p| 2 * carriers[p] > depth[p] && rep.consensus_sequence.as_bytes()[p] != template[p])
                .collect();
            assert!(wrong.is_empty(), "seed {seed}: decided positions miscalled {wrong:?}");

            let foreign: String = (0..1000).map(|_| r.base() as char).collect();
            reads.insert(0, hq_read("foreign", foreign));
            let with = assemble_within(reads, 45);
            assert_eq!(with.read_count, 8);
            assert_eq!(with.consensus_sequence, rep.consensus_sequence);
            assert_eq!(
                with.warnings,
                vec!["Reads foreign.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 8 reads.".to_string()]
            );
        }
    }

    /// BG-01M6SQ2Y: a read that runs only a few bases past an end of the layout still extends it,
    /// and those bases join the contig: the contig is the union of the reads. Wrong
    /// implementation, and what catches it: a contig of only the bases two or more reads carry
    /// (its ends, 10 and 12 bases from one read each). Leaving a short overhang to be aligned as
    /// inserted bases, where a homopolymer can put it on a side branch the consensus drops, is
    /// caught by the studio case whose bases 1,388 and 1,400 are both A
    /// (chromatogramPoaInput.test.tsx).
    #[test]
    fn contig_keeps_a_short_overhang_of_one_read() {
        let mut r = Lcg(21);
        let template: String = (0..800).map(|_| r.base() as char).collect();
        let reads = vec![
            hq_read("seed", template[20..720].to_string()),
            hq_read("past_end", template[60..732].to_string()),
            hq_read("before_start", reverse_complement_iupac(&template[10..680], false)),
        ];
        let rep = assemble_within(reads, 45);
        assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
        assert_eq!(rep.read_count, 3);
        assert_eq!(rep.consensus_sequence, template[10..732]);
    }

    /// BG-01M6S17N: each read the contig leaves out or cuts is named, in input order, with its
    /// lengths: a read with no bases, a read the pre-trim keeps none of (BG-01M6RPCA drops it), and
    /// a read over POA_MAX_READ_BP after the trim. A read of exactly POA_MAX_READ_BP is whole and
    /// unnamed. Wrong implementations, and what catches each: the silent drop and silent cut (the
    /// bug), a cap at `>=` (the 2,500 bp read), a different cap (its post-trim length), the trim
    /// wording when the trim is off, a warning when nothing was cut (the eight-read test above).
    /// The Q0 read is 79 bases of the template, so with the trim off it overlaps the others and
    /// joins the contig (BG-01M6SQ2Y leaves out a read that overlaps no other).
    #[test]
    fn contig_names_each_read_it_left_out_or_cut() {
        let mut r = Lcg(7);
        let template: String = (0..2600).map(|_| r.base() as char).collect();
        let bad_seq = &template[100..179];
        let reads = vec![
            hq_read("whole", template[..POA_MAX_READ_BP].to_string()),
            hq_read("empty", String::new()),
            hq_read("long", template.clone()),
            PoaReadInput { id: "bad".into(), name: "bad.ab1".into(), sequence: bad_seq.into(), phred_scores: vec![0; bad_seq.len()] },
        ];
        let trimmed = assemble_within(reads.clone(), 45);
        assert_eq!(
            trimmed.warnings,
            vec![
                "empty.ab1 has no bases, so it was left out of the contig.".to_string(),
                "long.ab1: only the first 2,500 of its 2,600 bases after the quality pre-trim were assembled; the assembler aligns at most 2,500 bases of a read.".to_string(),
                "bad.ab1: the Mott quality pre-trim at P(err) 0.05 kept none of its 79 bases, so it was left out of the contig.".to_string(),
            ]
        );
        assert_eq!(trimmed.read_count, 2);
        let row = |rep: &PoaContigAssemblyReport, id: &str| {
            rep.aligned_reads.iter().find(|a| a.id == id).map(|a| (a.raw_length_bp, a.post_trim_length_bp))
        };
        assert_eq!(row(&trimmed, "whole"), Some((2500, 2500)));
        assert_eq!(row(&trimmed, "long"), Some((2600, 2500)));
        assert_eq!(row(&trimmed, "bad"), None);

        let raw = assemble_sanger_contig_poa(&reads, "contig", false);
        assert_eq!(
            raw.warnings,
            vec![
                "empty.ab1 has no bases, so it was left out of the contig.".to_string(),
                "long.ab1: only the first 2,500 of its 2,600 bases were assembled; the assembler aligns at most 2,500 bases of a read.".to_string(),
            ]
        );
        assert_eq!(row(&raw, "bad"), Some((79, 79)));
        // With every read dropped the report still says why.
        let none = assemble_sanger_contig_poa(&reads[1..2], "contig", true);
        assert_eq!((none.read_count, none.warnings.len()), (0, 1));
    }

    /// A best overlap discounts a rival inside a tandem repeat only when it is fixed by bases
    /// outside that repeat, on both the read and the draft, enough to place the read at 90% were
    /// all its errors among them (BG-01M6TD2N). Wrong implementations, and the case that catches
    /// each: the read's side not counted (a read all (AT)n against a draft of unique bases and
    /// (AT)n); no error budget (70 bases outside with 8 errors); fewer than 50 bases outside
    /// enough (40 bases outside, no errors).
    #[test]
    fn a_best_is_fixed_outside_a_repeat_only_by_enough_bases_on_both_sides() {
        let mut x = 0x2545_f491_u32;
        let mut unique = |n: usize| -> Vec<u8> {
            (0..n)
                .map(|_| {
                    x ^= x << 13;
                    x ^= x >> 17;
                    x ^= x << 5;
                    b"ACGT"[(x >> 30) as usize]
                })
                .collect()
        };
        let at = |n: usize| b"AT".repeat(n);
        let whole = |len: usize, errors: usize| DraftOverlap {
            score: 0,
            read_from: 0,
            read_to: len,
            draft_from: 0,
            draft_to: len,
            columns: len,
            identities: len - errors,
            unknown: 0,
        };
        // 900 unique bases then (AT)45 on both: the replicate of a read ending in (AT)n.
        let draft = [unique(900), at(45)].concat();
        let outside = outside_repeat(&draft, 0, 990, 2);
        assert!((898..=900).contains(&outside), "{outside}");
        assert!(fixed_outside_repeat(&draft, &draft, &whole(990, 16), 2));
        // The same counts for a read that is (AT)n throughout: its side holds no base outside.
        assert!(!fixed_outside_repeat(&draft, &at(495), &whole(990, 16), 2));
        // 70 unique bases then (AT)65: 6 errors are within what 70 bases outside allow, 8 not.
        let short = [unique(70), at(65)].concat();
        let outside = outside_repeat(&short, 0, 200, 2);
        assert!((68..=70).contains(&outside), "{outside}");
        assert!(fixed_outside_repeat(&short, &short, &whole(200, 6), 2));
        assert!(!fixed_outside_repeat(&short, &short, &whole(200, 8), 2));
        // 40 unique bases then (AT)80, with no error at all: too few outside the repeat.
        let few = [unique(40), at(80)].concat();
        assert!(!fixed_outside_repeat(&few, &few, &whole(200, 0), 2));
    }

    /// BG-01M6XRYR: Each stable preset identifier selects its intended alignment route and guide
    /// tree in `run_multiple_sequence_alignment_with_algorithm`, legacy saved preset labels map to
    /// the identical route, and no preset silently falls onto the default progressive-NJ route.
    #[test]
    fn msa_preset_route_selects_each_engine_branch_and_preserves_legacy_names() {
        let pairs = [
            ("consistency-nj", "MAFFT (FFT-NS-i / L-INS-i)", "CONSISTENCY-NJ"),
            ("consistency-upgma", "MUSCLE (Iterative)", "CONSISTENCY-UPGMA"),
            ("progressive-upgma", "Clustal Omega (HMM)", "PROGRESSIVE-UPGMA"),
            ("graph-backbone", "POA (rust-bio Partial-Order Graph)", "GRAPH-BACKBONE"),
        ];
        for (id, legacy, key) in pairs {
            assert_eq!(canonical_msa_preset_key(id), key, "identifier {id}");
            assert_eq!(canonical_msa_preset_key(legacy), key, "legacy {legacy}");
        }
        assert_eq!(canonical_msa_preset_key(""), "");
        assert_eq!(canonical_msa_preset_key("unknown-preset"), "");

        let alphabet = b"ACDEFGHIKLMNPQRSTVWY";
        let mut s = 7_u64;
        let base: String = (0..90)
            .map(|_| {
                s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                alphabet[((s >> 33) % alphabet.len() as u64) as usize] as char
            })
            .collect();
        let mutate = |seed: u64| -> String {
            let mut st = seed;
            let mut out = String::new();
            for ch in base.chars() {
                st = st.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let r = (st >> 33) % 100;
                let pick = alphabet[((st >> 40) % alphabet.len() as u64) as usize] as char;
                match r {
                    0..=9 => {}
                    10..=18 => {
                        out.push(ch);
                        out.push(pick);
                    }
                    19..=38 => out.push(pick),
                    _ => out.push(ch),
                }
            }
            out
        };
        let docs: Vec<MsaInputDoc> = (0..6)
            .map(|i| MsaInputDoc {
                id: format!("s{}", i + 1),
                name: format!("taxon_{}", i + 1),
                sequence: if i == 0 { base.clone() } else { mutate(31 * i as u64 + 5) },
            })
            .collect();
        let cleaned = clean_msa_inputs(&docs, 2400);
        let is_prot = cleaned.iter().any(|s| looks_like_protein_sequence(s));
        let upper: Vec<Vec<u8>> = cleaned.iter().map(|s| s.to_ascii_uppercase().into_bytes()).collect();
        let opts = crate::progressive::ProgressiveOptions { second_pass: true, refine_passes: 2 };

        let want_consistency_nj = finalize_msa(
            &docs,
            crate::progressive::consistency_msa(&upper, is_prot, 2),
            MsaTreeBuilder::NeighborJoining,
        );
        let want_consistency_upgma = finalize_msa(
            &docs,
            crate::progressive::consistency_msa(&upper, is_prot, 3),
            MsaTreeBuilder::Upgma,
        );
        let want_progressive_upgma = finalize_msa(
            &docs,
            crate::progressive::progressive_msa(&upper, is_prot, opts),
            MsaTreeBuilder::Upgma,
        );
        let default_prog_nj = finalize_msa(
            &docs,
            crate::progressive::progressive_msa(&upper, is_prot, opts),
            MsaTreeBuilder::NeighborJoining,
        );
        let center_idx = choose_star_center(&cleaned, is_prot);
        let star = center_star_rows(&cleaned[center_idx], &cleaned, Some(center_idx), is_prot);
        let backbone = poa_backbone(&cleaned);
        let candidate = center_star_rows(&backbone, &cleaned, None, is_prot);
        let poa_matrix = if !backbone.is_empty() && sum_of_pairs_score(&candidate) >= sum_of_pairs_score(&star) {
            candidate
        } else {
            star
        };
        let want_poa = finalize_msa(&docs, poa_matrix, MsaTreeBuilder::NeighborJoining);

        let sig = |r: &MsaAlignmentResult| -> (Vec<String>, String, String) {
            (
                r.rows.iter().map(|row| row.aligned_seq.clone()).collect(),
                r.consensus.clone(),
                r.newick_tree.clone(),
            )
        };

        // The fixture distinguishes the routes: consistency != progressive, POA != progressive and
        // consistency, and NJ guide tree != UPGMA guide tree.
        assert_ne!(
            sig(&want_consistency_nj).0,
            sig(&default_prog_nj).0,
            "fixture must separate consistency_msa from progressive_msa"
        );
        assert_ne!(
            sig(&want_poa).0,
            sig(&default_prog_nj).0,
            "fixture must separate POA from progressive_msa"
        );
        assert_ne!(
            sig(&want_poa).0,
            sig(&want_consistency_nj).0,
            "fixture must separate POA from consistency_msa"
        );
        assert_ne!(
            want_progressive_upgma.newick_tree,
            default_prog_nj.newick_tree,
            "fixture must separate UPGMA from Neighbor-Joining tree"
        );

        let expected_by_id = [
            ("consistency-nj", "MAFFT (FFT-NS-i / L-INS-i)", &want_consistency_nj),
            ("consistency-upgma", "MUSCLE (Iterative)", &want_consistency_upgma),
            ("progressive-upgma", "Clustal Omega (HMM)", &want_progressive_upgma),
            ("graph-backbone", "POA (rust-bio Partial-Order Graph)", &want_poa),
        ];

        for (id, legacy, want) in expected_by_id {
            let got_id = run_multiple_sequence_alignment_with_algorithm(&docs, 2400, id);
            let got_legacy = run_multiple_sequence_alignment_with_algorithm(&docs, 2400, legacy);
            assert_eq!(sig(&got_id), sig(want), "preset {id} must take its intended route");
            assert_eq!(
                sig(&got_legacy),
                sig(&got_id),
                "legacy preset {legacy} must take the same route as {id}"
            );
            assert_ne!(
                sig(&got_id),
                sig(&default_prog_nj),
                "preset {id} must not silently fall onto the default progressive-NJ route"
            );
        }
    }
}
