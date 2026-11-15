// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use molbiocraft_core::{
    clean_alpha_sequence, format_thousands, reverse_complement_iupac, HistoryTreeNode,
    RestrictionCutSite, SequenceDocument,
};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloningOutcome {
    pub success: bool,
    pub method: String,
    pub construct_document: SequenceDocument,
    pub summary: String,
    pub left_junction_seq: String,
    pub right_junction_seq: String,
    pub overhang_or_homology_left: String,
    pub overhang_or_homology_right: String,
    pub warnings: Vec<String>,
}

/// A nuclease this engine can scan for (US-01M7DV29): what its site looks like and where it cuts.
/// The scan reads these facts rather than a name, so no sequence is screened by a rule the caller
/// did not ask for and no result is labelled with a nuclease that did not produce it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NucleasePreset {
    /// The id a caller sends in the `nuclease` payload key, and the label a result carries.
    pub id: String,
    /// The side of the spacer the PAM sits on, as a reader says it: `5'` or `3'`.
    pub pam_side: String,
    /// The PAM pattern in IUPAC letters, 5' -> 3' (`NGG`, `TTTV`).
    pub pam_pattern: String,
    /// The bases of the spacer.
    pub spacer_length_bp: usize,
    /// The bases the whole site occupies, PAM and spacer together.
    pub site_span_bp: usize,
    /// Where this nuclease cuts, in words, naming the convention a position follows (D0131).
    pub cut_convention: String,
}

/// The one place the presets are written down: id, PAM side, PAM pattern, spacer length, the
/// 1-based site base the reported cut follows, the second staggered cut (Cas12a, D0131) and the
/// convention in words. `site_span_bp` is the PAM and the spacer together.
const NUCLEASE_PRESETS: &[(&str, &str, &str, usize, usize, Option<usize>, &str)] = &[
    (
        "SpCas9 (NGG)",
        "3'",
        "NGG",
        20,
        17,
        None,
        "Blunt cut 3 bp 5' of the PAM, between spacer nt 17 and nt 18 (SpCas9 convention); the reported position is the last plus-strand base before the cut, on either strand.",
    ),
    (
        "Cas12a / Cpf1 (TTTV)",
        "5'",
        "TTTV",
        20,
        22,
        Some(27),
        "Staggered cut leaving a 5-nt 5' overhang, by the AsCas12a/LbCas12a convention: the PAM strand is cut after spacer nt 18 and the target strand after nt 23. Both positions are this convention, not a measured value for the ortholog in hand.",
    ),
];

fn preset_of(row: &(&str, &str, &str, usize, usize, Option<usize>, &str)) -> NucleasePreset {
    NucleasePreset {
        id: row.0.to_string(),
        pam_side: row.1.to_string(),
        pam_pattern: row.2.to_string(),
        spacer_length_bp: row.3,
        site_span_bp: row.2.len() + row.3,
        cut_convention: row.6.to_string(),
    }
}

/// Which bases of a returned `pam` are an IUPAC ambiguity letter, and so were never read as a base
/// (US-01M7DV29 AC5). A pattern's constrained positions are screened by the scan, so only an
/// unconstrained one - SpCas9's `N` - can hold such a letter; naming the position and the letter
/// keeps an `N` in the record from reading as a confirmed base. `None` where the PAM is all A, C,
/// G and T.
fn pam_ambiguity_note(pam: &[u8], pattern: &str) -> Option<String> {
    let flagged: Vec<String> = pam
        .iter()
        .enumerate()
        .filter(|(_, &b)| !matches!(b.to_ascii_uppercase(), b'A' | b'C' | b'G' | b'T'))
        .map(|(i, &b)| {
            format!(
                "{} at PAM position {} ({} in {})",
                (b as char).to_ascii_uppercase(),
                i + 1,
                pattern.chars().nth(i).unwrap_or('N'),
                pattern
            )
        })
        .collect();
    if flagged.is_empty() {
        return None;
    }
    Some(format!(
        "The sequence holds an IUPAC ambiguity letter where this PAM is unconstrained, so the base there is not known: {}.",
        flagged.join("; ")
    ))
}

/// Every nuclease a scan can be asked for, in the order a chooser offers them (US-01M7DV29 AC1).
pub fn supported_nuclease_presets() -> Vec<NucleasePreset> {
    NUCLEASE_PRESETS.iter().map(preset_of).collect()
}

/// The preset `id` names, or why it names none: an id that is not a preset, and an empty one, are
/// refused with the id as given and the supported ids (D0130). An id is matched without regard to
/// surrounding space or letter case, and to nothing else: a name that merely holds "Cas12a" is not
/// a preset, which is how an unknown nuclease used to be scanned as SpCas9 and labelled as it.
pub fn resolve_nuclease_preset(id: &str) -> Result<NucleasePreset, String> {
    let wanted = id.trim();
    if let Some(row) = NUCLEASE_PRESETS
        .iter()
        .find(|row| row.0.eq_ignore_ascii_case(wanted))
    {
        return Ok(preset_of(row));
    }
    let supported = NUCLEASE_PRESETS
        .iter()
        .map(|row| format!("\"{}\"", row.0))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Unsupported nuclease \"{id}\": this engine scans for {supported} only, so no guide was searched for. Ask for one of those ids, or leave the nuclease out for the default \"{}\".",
        NUCLEASE_PRESETS[0].0
    ))
}

/// The cut offsets of a preset: the reported cut, and the second staggered one where the nuclease
/// has one. Both are 1-based bases of the site, counted from its first base.
fn cut_offsets(id: &str) -> (usize, Option<usize>) {
    NUCLEASE_PRESETS
        .iter()
        .find(|row| row.0 == id)
        .map(|row| (row.4, row.5))
        .unwrap_or((17, None))
}

/// The 1-based inclusive interval a scan searched (US-01M7DVAS), as a reader reads it: on a
/// circular record `start > end` runs across the origin — the convention this workbench already
/// uses for a site that straddles it — and `length_bp` then counts both sides of the origin. It is
/// the interval that was really searched, which is not always the one asked for: an interval longer
/// than [`GUIDE_SCAN_MAX_BP`] is searched from its start for that many bases, and this names the
/// shorter one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchedInterval {
    pub start: usize,
    pub end: usize,
    /// The bases the interval holds, counting both bounds and both sides of the origin.
    pub length_bp: usize,
    /// Whether the interval runs across the origin of a circular record (`start > end`).
    pub crosses_origin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrisprGuideRecord {
    pub id: String,
    pub name: String,
    pub spacer_seq: String,
    pub pam_seq: String,
    pub nuclease: String,
    pub start: usize,
    pub end: usize,
    pub cut_position: usize,
    pub strand: i8,
    pub gc_percent: f64,
    pub on_target_score: i32,
    pub specificity_score: i32,
    pub off_target_count: usize,
    /// How many candidate guides the scan found over the range it read, this one among them
    /// (BG-01M6S15R). A guide list shorter than this holds the highest-scoring of them, not all of
    /// them: a reader that gives a total reads this field, never the length of the list it was
    /// handed. The Primer & PCR studio's guide tab does; `bio_pipelines.rs`'s gRNA ranking step
    /// still counts its own list and is a defect of its own.
    #[serde(default)]
    pub candidate_count: usize,
    /// The bases of the sequence the scan read, from base 1, on both strands: the range the
    /// off-target count was counted over and the guides were looked for in.
    #[serde(default)]
    pub scanned_length_bp: usize,
    /// The length of the whole sequence. Equal to `scanned_length_bp` whenever the scan read it all.
    #[serde(default)]
    pub sequence_length_bp: usize,
    /// Whether the scan read the record as the circle it is (BG-01M6T6GQ): both strands continued
    /// past the last base at base 1, so a guide across the origin is in this result and its seed
    /// matches were counted across the origin too. False for a linear record, and for a circular one
    /// a bound stopped short of — that scan read a straight range and says so in `warnings`.
    #[serde(default)]
    pub scanned_circular: bool,
    /// The bases across the origin a circular scan read: one less than the site it looks for (22 for
    /// SpCas9's 23-base site, 23 for Cas12a's 24-base one), and 0 when the scan did not wrap.
    #[serde(default)]
    pub origin_span_bp: usize,
    /// The scan's own warnings (D0005), repeated on every guide it returns because the
    /// `find_crispr_guides` RPC replies with the guide list alone: one plain sentence per range or
    /// list the scan could not report whole.
    #[serde(default)]
    pub warnings: Vec<String>,
    /// The side of the spacer this nuclease's PAM sits on, `5'` or `3'` (US-01M7DV29 AC6), so a
    /// 5'-PAM and a 3'-PAM guide are told apart without reading the bases. Absent on a record saved
    /// before it.
    #[serde(default)]
    pub pam_side: String,
    /// The preset's PAM pattern in IUPAC letters (`NGG`, `TTTV`).
    #[serde(default)]
    pub pam_pattern: String,
    /// Where this nuclease cuts, in words, naming the convention `cut_position` follows (D0131).
    #[serde(default)]
    pub cut_convention: String,
    /// The second cut of a staggered nuclease, as a plus-strand coordinate: Cas12a's target-strand
    /// cut after spacer nt 23, beside `cut_position`'s PAM-strand cut after nt 18 (D0131). `None`
    /// for a blunt cutter, so a single position is never read as a staggered one or the other way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cut_position_target_strand: Option<usize>,
    /// Why a staggered nuclease's second cut has no coordinate (US-01M7DV29 AC4): on a range the
    /// scan read straight (a linear molecule, or a circle read only part-way) a cut past either end
    /// of that range falls on no base, so `cut_position_target_strand` is left empty and this says
    /// so, rather than a position wrapped round a molecule that has no origin to wrap across.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cut_position_target_strand_note: Option<String>,
    /// Which bases of `pam_seq` are an IUPAC ambiguity letter rather than a base this scan read as
    /// A, C, G or T (US-01M7DV29 AC5): the pattern's unconstrained positions are not screened, so an
    /// `N` there is reported as the letter it is and never as a confirmed base. `None` where every
    /// base of the PAM is one of A, C, G and T.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pam_ambiguity_note: Option<String>,
    /// The interval this guide was searched for in (US-01M7DVAS), or `None` where the scan read the
    /// whole sequence (or a prefix bound of it, which `scanned_length_bp` names). It is what says
    /// that the specificity on this row was counted over an interval and is an interval
    /// specificity, never a sequence-wide one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub searched_interval: Option<SearchedInterval>,
    /// What this guide read outside the interval searched (US-01M7DVAS AC2): its spacer is inside
    /// the interval — nothing else is returned — so only its PAM can be outside, and this names
    /// that PAM's own bases. `None` for a whole-sequence scan, and for a site that lies wholly
    /// inside the interval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_context_note: Option<String>,
}

/// A CRISPR guide scan: the guides it kept, how many candidates it found, and the range of the
/// sequence it read (BG-01M6S15R). The number of candidate guides is read from `candidate_count`,
/// never from the length of `guides`, which holds only the highest-scoring `max_results` of them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrisprGuideScan {
    /// The highest-scoring candidates, best first.
    pub guides: Vec<CrisprGuideRecord>,
    /// Every candidate guide over the scanned range, kept or not.
    pub candidate_count: usize,
    /// The bases read, from base 1, on both strands.
    pub scanned_length_bp: usize,
    /// The length of the whole sequence.
    pub sequence_length_bp: usize,
    /// Whether both strands were read across the origin, as a circle (BG-01M6T6GQ).
    #[serde(default)]
    pub scanned_circular: bool,
    /// The bases across the origin a circular scan read, or 0 when it did not wrap.
    #[serde(default)]
    pub origin_span_bp: usize,
    /// The interval this scan searched, or `None` where it read the whole sequence or a prefix bound
    /// of it (US-01M7DVAS): the range `scanned_length_bp` counts, and what says that the seed counts
    /// behind these specificities cover an interval alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub searched_interval: Option<SearchedInterval>,
    /// Why no interval was searched although one was asked for (US-01M7DVAS AC6): bounds outside
    /// the sequence, an interval shorter than the nuclease's site span, or an across-origin interval
    /// on a linear record. The reason echoes the interval as it was asked for, and such a scan
    /// returns no guide and claims no range (`scanned_length_bp` is 0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_refusal: Option<String>,
    /// The bases outside the interval the scan read as PAM context, and for nothing else; 0 for a
    /// whole-sequence scan and for an interval that is the whole of a circle.
    #[serde(default)]
    pub context_outside_interval_bp: usize,
    /// One plain sentence per range or list this scan could not report whole (D0005).
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most bases of a sequence a guide scan reads when it is given no bound of its own
/// (BG-01M6S15R). Every molecule this workbench is built for — a plasmid, a BAC, a 5 Mb bacterial
/// genome — is read whole, on both strands, with exact seed counts; past this a scan reads the first
/// `GUIDE_SCAN_MAX_BP` bases of both strands and names that range in its `warnings`.
///
/// The bound is where memory, not time, stops the exact scan, measured on this code rather than
/// guessed. Both are linear in the bases read. Release native: 1 Mb in 0.043 s, 5 Mb in 0.279 s, at
/// 47 MB resident (about 6.5 bytes per base). Through the WASM RPC in Node: 1 Mb in 0.054 s at
/// 15 MB of linear memory, 5 Mb in 0.256 s at 56 MB, this bound's 8 Mb in 0.466 s at 94 MB — about
/// 12 bytes per base, a third of it the RPC's own JSON scratch, which holds the sequence three
/// times over. A human chromosome at 50 to 250 Mb would ask for 0.6 to 3 GB of linear memory, which
/// is why the bound exists and why a scan that hits it says so.
pub const GUIDE_SCAN_MAX_BP: usize = 8_000_000;

/// The lowest and the highest heuristic rank `score_guide` can report (BG-01M7E61C).
///
/// Three surfaces inside this crate read the range here rather than writing a number of their own:
/// the floor in `score_guide`, the rank description the plugin reply and the studio callout print
/// ([`crate::reaction_buffers::crispr_heuristic_rank_description`]), and the label of the guided
/// CRISPR pipeline's rank readout. Change the scorer and those three move with it.
///
/// One surface does not read it, and is held to it by a test instead (BG-01M7E69W AC3): the
/// studio's `Heuristic Rank (8-98)` column header is a TSX literal in `PrimerAndPCRStudio.tsx`,
/// checked by `src/__tests__/crisprScoreProvenance.test.tsx` against the range the engine reports.
/// (The studio's `held to 8 to 98` sentence was a second such literal until BG-01M7EYED; the rank
/// callout now states the engine's own description, so it reads this constant too.) The plugin's
/// per-guide field states no range at all - it is the bare rank.
///
/// What that vitest calls is the **committed wasm** (`public/molbiocraft_wasm.wasm`, reaching it as
/// `virtual:molbiocraft-wasm-bytes`), never this source file. So a change here moves the Rust
/// surfaces, and reaches the TSX guard only once `npm run wasm:build` has put the new range into
/// that artifact - which is why the same vitest also reads this declaration out of this file and
/// asserts the committed wasm agrees with it. An edit to the pair below with no rebuild is
/// therefore red on a developer's machine, not only in CI where the wasm build runs before vitest
/// (BG-01M7EKMJ AC1). The header literal is then edited by hand.
///
/// The floor is enforced and the ceiling is arithmetic. The top is the sum of every raise the scorer
/// can apply at once - 68 + 14 (GC inside 40-65 %) + 8 (G at spacer position 20) + 5 (C at position
/// 16) + 3 (A or G at position 4) = 98 - so no score ever needs capping and `score_guide` has no
/// ceiling arm to do it with; the floor is what any lower total is reported as: the worst spacer the
/// scorer can read (all-T, so GC outside 30-75 %, a T at position 20, a TTTT run, and a PAM ending
/// GGG) totals 68 - 22 - 6 - 30 - 5 = 5 and is reported as 8. The ranks were printed "/ 100" under
/// a header that said 8-99, and neither bound was the one a reader could reach: 99 was unreachable
/// by construction.
pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (8, 98);

/// The PAM-proximal seed length whose exact matches elsewhere are counted as off-targets.
const SEED_LEN: usize = 12;
/// A `SEED_LEN`-mer packed two bits per base.
const SEED_MASK: u32 = (1 << (2 * SEED_LEN as u32)) - 1;

/// The two-bit code of an unambiguous base, or `None` for any other letter (`N`, `R`, `Y`, …),
/// which no seed of A, C, G and T can match.
#[inline]
fn base_code(b: u8) -> Option<u32> {
    match b {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    }
}

/// `seed` (exactly `SEED_LEN` unambiguous bases) packed two bits per base, or `None` if it holds an
/// ambiguity code.
#[inline]
fn pack_seed(seed: &[u8]) -> Option<u32> {
    let mut packed = 0u32;
    for &b in seed {
        packed = (packed << 2) | base_code(b)?;
    }
    Some(packed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceAlertItem {
    pub id: String,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_bp: Option<usize>,
}

/// Rotate a circular plasmid sequence and all annotated features so `new_origin_1based` becomes coordinate 1.
pub fn set_circular_origin(
    doc: &SequenceDocument,
    new_origin_1based: usize,
) -> SequenceDocument {
    let s = &doc.sequence;
    let l = s.len();
    if l == 0 {
        return doc.clone();
    }
    let clamped = new_origin_1based.clamp(1, l);
    let offset = (clamped - 1) % l;
    if offset == 0 {
        return doc.clone();
    }

    let (rotated_seq, rotated_features) = crate::cloning_sim::rotate_features(s, &doc.features, offset);

    let mut updated = doc.clone();
    updated.sequence = rotated_seq;
    updated.features = rotated_features;
    // Primer binding sites move with the sequence. A site that would straddle
    // the new origin is re-expressed with bind_start > bind_end (wrapping), the
    // same convention circular coordinates use; callers normally refuse such an
    // origin before rotating.
    let rotate_pos = |p: usize| -> usize {
        if p == 0 || p > l {
            p
        } else {
            (p - 1 + l - offset) % l + 1
        }
    };
    for primer in updated.primers.iter_mut() {
        primer.bind_start = rotate_pos(primer.bind_start);
        primer.bind_end = rotate_pos(primer.bind_end);
    }
    updated.updated_at = "2026-10-31T00:00:00Z".to_string();
    updated.history.push(HistoryTreeNode {
        id: format!("h-origin-{}", new_origin_1based),
        timestamp: "2026-10-31 00:00".to_string(),
        operation: format!("Set Circular Origin to {} bp", new_origin_1based),
        description: format!(
            "Rotated circular coordinate system of {} so base {} is now position 1",
            doc.name, new_origin_1based
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: l,
        topology: doc.topology,
        history_color: None,
        inserted_range: None,
    });
    updated
}

/// SpCas9 (NGG) and Cas12a (TTTV) guide finder, over the whole sequence. The on-target value is a
/// rule-of-thumb rank over six features of the spacer (its GC content, a G or a T at position 20,
/// a C at position 16, an A or a G at position 4, a TTTT run) and over its PAM (one ending GGG),
/// reported inside [`CRISPR_HEURISTIC_RANK_RANGE`] (a clamped floor, an arithmetic ceiling — see
/// `score_guide`) — not a trained Doench score, and not a measured or predicted cutting
/// efficiency. [`crate::reaction_buffers::crispr_heuristic_rank_description`] is
/// the same rule in the words a label shows, so read the two together. Specificity reflects only
/// exact matches of the 12-nt PAM-proximal seed elsewhere in the same sequence, not a genome-wide
/// search.
///
/// Every guide this returns carries the scan's `candidate_count`, the range read and the scan's
/// `warnings`, so the reply to the `find_crispr_guides` RPC — the guide list alone — still says what
/// was searched. Call [`scan_crispr_guides`] for the scan itself.
///
/// The sequence is read as a straight line, end to end. A plasmid is a circle: call
/// [`find_crispr_guides_for_topology`] for it, or the guides across its origin are missing.
pub fn find_crispr_guides(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
) -> Vec<CrisprGuideRecord> {
    scan_crispr_guides(raw_seq, nuclease, rows_wanted(max_results), None, false).guides
}

/// The rows [`find_crispr_guides`] and [`find_crispr_guides_for_topology`] keep: their documented
/// default of 30 for a `max_results` of 0, which they have always answered that way. The scan
/// itself reads `max_results` as the number it is, so a caller that wants the scan's report with no
/// rows asks for 0 (US-01M7DVH2).
fn rows_wanted(max_results: usize) -> usize {
    if max_results == 0 {
        30
    } else {
        max_results
    }
}

/// [`find_crispr_guides`] told which molecule it is reading (BG-01M6T6GQ): with `circular` the whole
/// record is read as the circle it is, so the guides across its origin — up to `span - 1` positions
/// per strand — are found, reported inside 1..length, and counted in `candidate_count`.
pub fn find_crispr_guides_for_topology(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
    circular: bool,
) -> Vec<CrisprGuideRecord> {
    scan_crispr_guides(raw_seq, nuclease, rows_wanted(max_results), None, circular).guides
}

/// [`find_crispr_guides`] as the scan it is (BG-01M6S15R): both strands of the same range read base
/// by base for candidate guides, every candidate's PAM-proximal seed counted exactly over that
/// range, and the highest-scoring `max_results` kept.
///
/// `scan_limit_bp` bounds the bases read, from base 1 of both strands; `None` is
/// [`GUIDE_SCAN_MAX_BP`]. A bound shorter than the sequence is named in `warnings` — it is never
/// left for the reader to discover, because a seed matched over part of a sequence is not a
/// specificity over the whole of it.
///
/// Counting is exact: the seeds of the candidates found are the keys of one count table, which a
/// single pass over both strands fills, so no match between two sampled positions is missed (the
/// sampled index this replaces made a repeated seed read as unique — a specificity of 100 for a
/// guide with nine other copies). Cost is linear in the bases read; see [`GUIDE_SCAN_MAX_BP`] for
/// the measured time and memory.
///
/// `max_results` is the rows kept, as the number it is: 0 keeps none, so a caller that wants the
/// scan's own report — the candidate count, the range read, how the record was read and the
/// warnings — asks for 0 and gets that report with an empty `guides` (US-01M7DVH2). A request for
/// no rows is not a capped list, so it raises no cap warning; `find_crispr_guides` and
/// `find_crispr_guides_for_topology` keep their own default of 30 for 0.
///
/// `circular` reads the record as the circle it is (BG-01M6T6GQ): every base of both strands is the
/// start of a candidate, a site that runs off the last base continues at base 1, and the seeds are
/// counted over the same circle. Starts, ends and cut sites stay inside 1..length, so a site across
/// the origin reads `start > end`, and no site is listed twice. A bound shorter than the sequence
/// cannot wrap — bases 1 to `scanned` are not a circle — so such a scan reads the range straight and
/// reports it in `warnings`; `scanned_circular` says which of the two happened.
///
/// This reads the sequence from base 1 and no other arc of it. Call
/// [`scan_crispr_guides_in_interval`] to search the interval on screen instead (US-01M7DVAS),
/// including one that runs across the origin of a plasmid.
pub fn scan_crispr_guides(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
    scan_limit_bp: Option<usize>,
    circular: bool,
) -> CrisprGuideScan {
    scan_guides(raw_seq, nuclease, max_results, scan_limit_bp, None, circular)
}

/// [`scan_crispr_guides`] over one interval of the record rather than all of it (US-01M7DVAS): the
/// 1-based inclusive `interval` Adaeze has on screen, which on a circular record may run
/// `start > end` across the origin. `None` is the whole sequence, exactly as [`scan_crispr_guides`]
/// reads it.
///
/// What an interval changes, and what it does not:
///
/// - A candidate is returned only when its **whole spacer** lies inside the interval. A candidate
///   whose spacer is inside but whose PAM is not is returned and carries
///   [`CrisprGuideRecord::interval_context_note`], which names the PAM's own bases: the PAM was read
///   from `pam_pattern.len()` bases of context either side of the interval — a whole PAM, which is
///   where such a PAM can be — and those bases are read for a PAM and for nothing else. A candidate
///   whose spacer crosses a bound is not a candidate of that interval at all.
/// - On a circle that context runs round the origin, so an interval leaving less than a PAM's
///   length outside it still has its PAMs read and its guides returned: the context then reaches
///   back over the interval's own far bases, which are read again and searched for nothing new.
///   `context_outside_interval_bp` counts the bases **outside** the interval that this read, each
///   once, however many times they were read and whichever side of the interval they were read on.
/// - Seed matches are counted over the interval alone, on both strands, so the specificity of a
///   guide found this way is an **interval** specificity. `searched_interval` is what says so, and
///   the scan's `warnings` say it in words.
/// - Coordinates do not move: every start, end and cut position is in `1..=length` of the whole
///   record, and a site across the origin reads `start > end` — the same guide, in either scope.
/// - [`GUIDE_SCAN_MAX_BP`] still bounds the bases an interval asks for; an interval longer than it
///   is read from its start for that many bases, and `searched_interval` then names the shorter
///   interval that was really searched.
/// - An interval that is not inside the sequence, that is shorter than the nuclease's site span, or
///   that runs `start > end` on a linear record (which has no origin to run across) is refused:
///   `interval_refusal` and `warnings` carry the reason with the interval echoed, no guide is
///   returned, and `scanned_length_bp` is 0 — a refused scan claims no range.
pub fn scan_crispr_guides_in_interval(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
    interval: Option<(usize, usize)>,
    circular: bool,
) -> CrisprGuideScan {
    scan_guides(raw_seq, nuclease, max_results, None, interval, circular)
}

/// The interval a scan may search, or why it may search none (US-01M7DVAS AC3, AC6). Every refusal
/// echoes the interval as it was asked for, so a reader is never left guessing which bounds were
/// rejected. `max_bp` is the cap the caller applies ([`GUIDE_SCAN_MAX_BP`] in the scan itself): an
/// interval longer than it is searched from its start for that many bases, and the plan then names
/// the shorter interval rather than the one asked for.
fn plan_interval(
    start: usize,
    end: usize,
    seq_len: usize,
    circular: bool,
    span: usize,
    nuclease: &str,
    max_bp: usize,
) -> Result<IntervalPlan, String> {
    let asked = format!(
        "{}..{}",
        format_thousands(start),
        format_thousands(end)
    );
    if start < 1 || end < 1 || start > seq_len || end > seq_len {
        return Err(format!(
            "The interval {asked} is not inside this sequence: both bounds must be between 1 and {}, so no guide was searched for.",
            format_thousands(seq_len)
        ));
    }
    let crosses_origin = start > end;
    if crosses_origin && !circular {
        return Err(format!(
            "The interval {asked} runs from a start past its end, which is an interval across the origin of a circle; this sequence is linear and has no origin to run across, so no guide was searched for. Ask for {asked_low}..{} or 1..{} instead.",
            format_thousands(seq_len),
            format_thousands(end),
            asked_low = format_thousands(start)
        ));
    }
    let length_bp = if crosses_origin {
        seq_len - start + 1 + end
    } else {
        end - start + 1
    };
    if length_bp < span {
        return Err(format!(
            "The interval {asked} is {} bp, shorter than the {}-bp site of {nuclease}, so it holds no whole site and no guide was searched for.",
            format_thousands(length_bp),
            format_thousands(span)
        ));
    }
    if length_bp > max_bp {
        let capped_end = (start - 1 + max_bp - 1) % seq_len + 1;
        return Ok(IntervalPlan {
            interval: SearchedInterval {
                start,
                end: capped_end,
                length_bp: max_bp,
                crosses_origin: start > capped_end,
            },
            cap_note: Some(format!(
                "The interval {asked} asks for {} bases, more than the {} a guide scan reads at once, so guides were searched for in bases {}..{} — its first {} bases — on both strands, and seed matches counted there.",
                format_thousands(length_bp),
                format_thousands(max_bp),
                format_thousands(start),
                format_thousands(capped_end),
                format_thousands(max_bp)
            )),
        });
    }
    Ok(IntervalPlan {
        interval: SearchedInterval {
            start,
            end,
            length_bp,
            crosses_origin,
        },
        cap_note: None,
    })
}

/// A planned interval: the interval that will really be searched, and the sentence owed where that
/// is not the one asked for.
struct IntervalPlan {
    interval: SearchedInterval,
    cap_note: Option<String>,
}

/// [`scan_crispr_guides`] and [`scan_crispr_guides_in_interval`] are this one scan: `scan_limit_bp`
/// bounds a whole-sequence scan from base 1, `interval` searches one arc of the record, and the two
/// are not combined — an interval carries its own bound ([`GUIDE_SCAN_MAX_BP`]).
fn scan_guides(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
    scan_limit_bp: Option<usize>,
    interval: Option<(usize, usize)>,
    circular: bool,
) -> CrisprGuideScan {
    let s = clean_alpha_sequence(raw_seq).replace('U', "T");
    let seq_len = s.len();
    // The nuclease asked for, as a preset rather than a name (US-01M7DV29): an id that is not a
    // preset is refused here with the supported ids, and no sequence is screened by another
    // nuclease's rule. The refusal is this scan's own warning and an error at the op, so an
    // in-process caller is never handed SpCas9's guides for a name it did not send (D0130). It is
    // resolved before the interval is planned, because the refusal of an interval shorter than a
    // whole site names that nuclease's own span.
    let preset = match resolve_nuclease_preset(nuclease) {
        Ok(p) => p,
        Err(reason) => return refused_scan(seq_len, reason, None),
    };
    let is_spcas9 = preset.pam_side == "3'";
    let (cut_offset, cut_offset_target) = cut_offsets(&preset.id);
    // SpCas9: 20-nt spacer then a 3-nt PAM. Cas12a: a 4-nt PAM then a 20-nt spacer. The bases a
    // candidate occupies, and so the last start position each strand has: the loop once read
    // `0..=(len - 24)` for both, which never examined SpCas9's last start (BG-01M6T6GQ).
    let span = preset.site_span_bp;
    let spacer_len = preset.spacer_length_bp;
    let pam_len = span - spacer_len;

    // The interval asked for, as the interval that can be searched — or the refusal, which returns
    // no guides and claims no range (US-01M7DVAS AC6).
    let plan = match interval {
        None => None,
        Some((from, to)) => {
            match plan_interval(from, to, seq_len, circular, span, &preset.id, GUIDE_SCAN_MAX_BP) {
                Ok(plan) => Some(plan),
                Err(reason) => return refused_scan(seq_len, reason.clone(), Some(reason)),
            }
        }
    };
    let searched_interval = plan.as_ref().map(|p| p.interval);
    // The bases searched: an interval's own, or the prefix bound's.
    let scanned = match &plan {
        Some(p) => p.interval.length_bp,
        None => seq_len.min(scan_limit_bp.unwrap_or(GUIDE_SCAN_MAX_BP)),
    };
    // A prefix bound shorter than the sequence is named in `warnings`; an interval has its own
    // sentence below, so this one is never raised for it (it would read as bases 1 to N).
    let bounded_warning = |scanned: usize| -> Vec<String> {
        if plan.is_none() && scanned < seq_len {
            vec![format!(
                "Guides were searched for in bases 1 to {} of the {} bases of this sequence, on both strands, and seed matches counted there: a guide or a seed match outside that range is not in this result.",
                format_thousands(scanned),
                format_thousands(seq_len)
            )]
        } else {
            Vec::new()
        }
    };
    if scanned < span {
        return CrisprGuideScan {
            guides: Vec::new(),
            candidate_count: 0,
            scanned_length_bp: scanned,
            sequence_length_bp: seq_len,
            scanned_circular: false,
            origin_span_bp: 0,
            searched_interval,
            interval_refusal: None,
            context_outside_interval_bp: 0,
            warnings: bounded_warning(scanned),
        };
    }
    let limit = max_results;
    let nuc_label = preset.id.clone();
    // A circular record is read as a circle only where the searched range closes on itself: bases 1
    // to a bound shorter than the sequence do not meet, and neither do the ends of a proper arc, so
    // such a range is read straight.
    let wraps = circular && scanned == seq_len;
    // An interval that is a proper arc reads `pam_len` bases either side of it as PAM context, and
    // for nothing else (US-01M7DVAS AC2). A whole PAM either side is what the rule needs, because a
    // candidate whose spacer is inside the interval may have its PAM anywhere in the `pam_len` bases
    // past a bound; a context shorter than that leaves such a candidate off the end of the bases
    // read, and it is then dropped with nothing said — which is what a clamp to the bases outside
    // the interval did to every selection leaving less than a PAM outside it, on a circle.
    // On a circle the context runs round the origin, so there is always a whole PAM of it to read:
    // where the interval leaves less than that outside, the context reaches back over the
    // interval's own far bases, which are read a second time and searched for nothing new (no
    // candidate can be found twice, as the bases read are shorter than one turn of the circle plus
    // a site). `context_outside_interval_bp` below counts the bases outside the interval that this
    // reads, each once. On a linear record the context stops at either end (AC3): a line has no
    // base before its first or after its last.
    let (ctx_left, ctx_right) = match &plan {
        Some(p) if !wraps => {
            if circular {
                (pam_len, pam_len)
            } else {
                (
                    pam_len.min(p.interval.start - 1),
                    pam_len.min(seq_len - p.interval.end),
                )
            }
        }
        _ => (0, 0),
    };
    // The bases outside the interval the scan really read, counted once each (US-01M7DVAS AC4): the
    // two context windows meet on a near-full circle, so a base read before the interval and again
    // after it is one base of context and not two, and no base of the interval is counted as its own
    // context. There are `seq_len - length_bp` bases outside an interval, and the context cannot
    // read more of them than that.
    let context_outside_interval_bp = match &plan {
        Some(p) if !wraps => (seq_len - p.interval.length_bp).min(ctx_left + ctx_right),
        _ => 0,
    };
    // Where the searched range begins, as a 1-based coordinate of the whole record: base 1 for a
    // whole-sequence scan, the interval's own start for an interval.
    let core_start = plan.as_ref().map(|p| p.interval.start).unwrap_or(1);

    // Both strands of the same bases. For a whole-sequence scan those are the first `scanned` bases
    // of each strand — the reverse complement is taken of the scanned bases only, so a bounded scan
    // does not read the first of one strand and the last of the other, which left a forward guide
    // past the bound and a reverse guide before it invisible. For an interval they are the
    // interval's own bases with its context either side of them, read round the origin where the
    // interval runs across it.
    let interval_bases: Option<String> = plan.as_ref().map(|_| {
        let bytes = s.as_bytes();
        let first =
            (core_start as isize - 1 - ctx_left as isize).rem_euclid(seq_len as isize) as usize;
        let read: Vec<u8> = (0..ctx_left + scanned + ctx_right)
            .map(|k| bytes[(first + k) % seq_len])
            .collect();
        String::from_utf8(read).expect("a cleaned sequence is ASCII")
    });
    let top: &str = match &interval_bases {
        Some(bases) => bases.as_str(),
        None => &s[..scanned],
    };
    let rc = reverse_complement_iupac(top, false);
    // Reading a circle: each strand is followed by a copy of its own first `span - 1` bases, so a
    // window that runs off the last base continues at base 1 — on the reverse strand too, whose own
    // origin junction is the other side of the same one. The copy is `span - 1` bases and not one
    // base more, so no window starts inside it and no site is read twice. A linear scan borrows the
    // bases it already has; a circular one holds one further copy of each strand, which is two more
    // bytes per base — 16 MB for a record of [`GUIDE_SCAN_MAX_BP`] bases, the largest circle read
    // whole.
    fn extended(strand: &[u8], wraps: bool, span: usize) -> Cow<'_, [u8]> {
        if wraps {
            Cow::Owned([strand, &strand[..span - 1]].concat())
        } else {
            Cow::Borrowed(strand)
        }
    }
    let s_ext = extended(top.as_bytes(), wraps, span);
    let rc_ext = extended(rc.as_bytes(), wraps, span);
    let s_bytes: &[u8] = &s_ext;
    let rc_bytes: &[u8] = &rc_ext;
    // The bases read on each strand before any circular copy: the searched range, plus an
    // interval's context either side of it.
    let base_len = top.len();
    // Where the searched range sits inside them, and how long it is.
    let core_at = ctx_left;
    let core_len = scanned;
    // Every start position of each strand: all `core_len` of them on a circle read whole, where
    // every base begins a site, and `base_len - span + 1` on a range read straight, where the last
    // site ends at its last base.
    let starts = if wraps { core_len } else { base_len - span + 1 };

    /// A candidate guide's spacer and PAM on one strand, by the rule of the chosen nuclease, or
    /// `None` where that strand carries no candidate at `i` (no PAM, or an ambiguity code in the
    /// spacer, which cannot be scored or counted).
    fn candidate_at(strand_b: &[u8], i: usize, is_spcas9: bool) -> Option<(&[u8], &[u8])> {
        if is_spcas9 {
            let pam = &strand_b[i + 20..i + 23];
            if pam[1] != b'G' || pam[2] != b'G' {
                return None;
            }
            let spacer = &strand_b[i..i + 20];
            if spacer.iter().any(|&b| base_code(b).is_none()) {
                return None;
            }
            Some((spacer, pam))
        } else {
            let pam = &strand_b[i..i + 4];
            if &pam[..3] != b"TTT" || !matches!(pam[3], b'A' | b'C' | b'G') {
                return None;
            }
            let spacer = &strand_b[i + 4..i + 24];
            if spacer.iter().any(|&b| base_code(b).is_none()) {
                return None;
            }
            Some((spacer, pam))
        }
    }
    /// The PAM-proximal `SEED_LEN` bases of a spacer: the 3' end for SpCas9's 3' PAM, the 5' end for
    /// Cas12a's 5' one.
    fn seed_of(spacer: &[u8], is_spcas9: bool) -> &[u8] {
        if is_spcas9 {
            &spacer[spacer.len() - SEED_LEN..]
        } else {
            &spacer[..SEED_LEN]
        }
    }

    // Where a candidate's own bases sit among the bases read, as an offset from the first base of
    // the searched range: negative inside the context before it, `core_len` or more inside the
    // context after it or across the origin of a circle read whole. The site's bases ascend in
    // plus-strand order from here, on either strand, because a reverse-strand position `j` is the
    // plus base `base_len - 1 - j`.
    let site_core_rel = |i: usize, strand: i8| -> isize {
        if strand == 1 {
            i as isize - core_at as isize
        } else {
            base_len as isize - i as isize - span as isize - core_at as isize
        }
    };
    // Where the spacer begins among them, and where the PAM does: in plus-strand order the PAM
    // leads exactly when the nuclease's PAM side and the strand disagree, so SpCas9's forward site
    // opens with its spacer and its reverse site opens with its PAM.
    let spacer_leads = |strand: i8| is_spcas9 == (strand == 1);
    let spacer_core_rel = |i: usize, strand: i8| -> isize {
        site_core_rel(i, strand) + if spacer_leads(strand) { 0 } else { pam_len as isize }
    };
    let pam_core_rel = |i: usize, strand: i8| -> isize {
        site_core_rel(i, strand) + if spacer_leads(strand) { spacer_len as isize } else { 0 }
    };
    // Whether `[from, from + len)` lies inside the searched range.
    let inside_core = |from: isize, len: usize| -> bool {
        from >= 0 && from + len as isize <= core_len as isize
    };
    // A candidate of the searched range: its whole spacer is in it. On a circle read whole every
    // base of the record is in it, including the bases a site wraps onto, so nothing is excluded
    // there; an interval keeps a candidate whose PAM is outside it and drops one whose spacer
    // crosses a bound (US-01M7DVAS AC2).
    let spacer_in_core = |i: usize, strand: i8| -> bool {
        wraps || inside_core(spacer_core_rel(i, strand), spacer_len)
    };
    let site_in_core =
        |i: usize, strand: i8| -> bool { wraps || inside_core(site_core_rel(i, strand), span) };

    // ── Pass 1: every candidate guide, and the set of seeds whose matches must be counted. ──
    let mut candidates: Vec<(u32, i8)> = Vec::new();
    let mut seed_counts: FxHashMap<u32, u32> = FxHashMap::default();
    for (strand_b, strand) in [(s_bytes, 1i8), (rc_bytes, -1i8)] {
        for i in 0..starts {
            if !spacer_in_core(i, strand) {
                continue;
            }
            if let Some((spacer, _)) = candidate_at(strand_b, i, is_spcas9) {
                // The spacer is unambiguous, so its seed always packs.
                if let Some(key) = pack_seed(seed_of(spacer, is_spcas9)) {
                    candidates.push((i as u32, strand));
                    seed_counts.entry(key).or_insert(0);
                }
            }
        }
    }

    // ── Pass 2: the exact number of matches of each of those seeds, over both strands of the
    // searched range. A window holding an ambiguity code matches no seed of A, C, G and T, so the
    // run of unambiguous bases is restarted there. On a circle read whole the pass reads
    // `SEED_LEN - 1` bases into the copy of the start, which is every window that crosses the
    // origin and no window twice: a seed match across the origin is counted once, like any other.
    // An interval counts the windows that lie inside it, and not the context either side of it: a
    // specificity counted over an interval is an interval specificity. ──
    let counted: [&[u8]; 2] = if wraps {
        let to = core_len + SEED_LEN - 1;
        [&s_bytes[..to], &rc_bytes[..to]]
    } else {
        [
            &s_bytes[core_at..core_at + core_len],
            &rc_bytes[base_len - core_at - core_len..base_len - core_at],
        ]
    };
    for strand_b in counted {
        let mut packed = 0u32;
        let mut run = 0usize;
        for &b in strand_b {
            match base_code(b) {
                Some(code) => {
                    packed = ((packed << 2) | code) & SEED_MASK;
                    run += 1;
                }
                None => {
                    run = 0;
                    continue;
                }
            }
            if run >= SEED_LEN {
                if let Some(n) = seed_counts.get_mut(&packed) {
                    *n += 1;
                }
            }
        }
    }

    let score_guide = |spacer: &[u8], pam: &[u8]| -> (i32, i32, usize, f64) {
        let gc_count = spacer
            .iter()
            .filter(|&&b| b == b'G' || b == b'C')
            .count();
        let gc_pct = ((gc_count as f64) / (spacer.len() as f64)) * 100.0;

        // The heuristic rank in full, and the engine's only scorer of it: from a base of 68, raised
        // for GC content inside 40–65 % and lowered outside 30–75 %, raised for a G and lowered for
        // a T at spacer position 20, raised for a C at position 16 and for an A or a G at position
        // 4, lowered for a TTTT run (Pol III terminator) and for a PAM ending GGG. Six features of
        // the spacer and one of the PAM — SpCas9 rules of thumb, read off a Cas12a spacer
        // unchanged. NOT Doench Rule Set 1/2, which are trained models, and not a measured or
        // predicted cutting efficiency. Every line below must stay the rule that
        // [`crate::reaction_buffers::crispr_heuristic_rank_description`] states in words, which is
        // what the user reads: the oracle in `workbench_table_and_lineage.rs`
        // (`us_01m7dvvr_ac2_the_rank_the_engine_reports_is_the_rule_its_description_names`)
        // re-derives this rule from those words and fails if the two part.
        let mut on_target = 68i32;
        if (40.0..=65.0).contains(&gc_pct) {
            on_target += 14;
        } else if !(30.0..=75.0).contains(&gc_pct) {
            on_target -= 22;
        }
        if spacer.len() >= 20 {
            if spacer[19] == b'G' {
                on_target += 8;
            } else if spacer[19] == b'T' {
                on_target -= 6;
            }
            if spacer[15] == b'C' {
                on_target += 5;
            }
            if spacer[3] == b'A' || spacer[3] == b'G' {
                on_target += 3;
            }
        }
        if spacer.windows(4).any(|w| w == b"TTTT") {
            on_target -= 30;
        }
        if pam.ends_with(b"GGG") {
            on_target -= 5;
        }
        // The scorer's own floor, which every label that states the range reads (BG-01M7E61C).
        // There is no ceiling to apply, and no ceiling arm here: every raise above at once is
        // 68 + 14 + 8 + 5 + 3 = 98, which is [`CRISPR_HEURISTIC_RANK_RANGE`].1, so a `clamp` upper
        // arm could never cap a score and a reviewer could widen it to 1000 unnoticed. The ceiling
        // is the arithmetic, held by a test that scores a broad sample and reads the top it reaches
        // (BG-01M7E69W AC1); only the floor is enforced here, over a raw total as low as 5.
        on_target = on_target.max(CRISPR_HEURISTIC_RANK_RANGE.0);

        // Other exact occurrences of the 12-nt PAM-proximal seed over the searched range (both
        // strands), counted in full. Specificity = 100 / (1 + seed matches): 100 for a seed with no
        // other copy; it does not search a genome.
        let seed_hits = pack_seed(seed_of(spacer, is_spcas9))
            .and_then(|key| seed_counts.get(&key))
            .map(|&n| n as usize)
            // Every candidate's own seed was counted, so a miss here is unreachable; 1 keeps the
            // honest direction (no off-target claimed that was not counted).
            .unwrap_or(1)
            .max(1);
        let off_targets = seed_hits - 1;
        let specificity = (100.0 / (1.0 + off_targets as f64)).round() as i32;
        let gc_rounded = (gc_pct * 10.0).round() / 10.0;
        (on_target, specificity, off_targets, gc_rounded)
    };

    // ── Pass 3: rank the candidates on their exact scores, keeping only the best `limit`. The
    // ranking is a total order — score, then position, then strand — so which guides a truncated
    // list holds does not depend on how often it was trimmed. ──
    #[derive(Clone, Copy)]
    struct Ranked {
        score: i32,
        start: usize,
        strand: i8,
        offset: u32,
    }
    let by_rank = |a: &Ranked, b: &Ranked| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.start.cmp(&b.start))
            .then_with(|| b.strand.cmp(&a.strand))
    };
    // How long the ranking list may grow before it is trimmed back to `limit`: bounded, so a
    // megabase scan with hundreds of thousands of candidates holds only the best of them at once.
    let trim_at = limit.saturating_mul(2).max(64);
    // The 1-based coordinate of the record's own base `core_rel` bases into the searched range,
    // counting on round the origin: every position the scan reports is one of these, so a site
    // across the origin reads `start > end` — the convention this workbench already uses for a
    // primer binding site that straddles it — and nothing is reported outside `1..=length`. On a
    // range read straight no offset reaches the modulus.
    let plus_pos = |core_rel: isize| -> usize {
        (core_start as isize - 1 + core_rel).rem_euclid(seq_len as isize) as usize + 1
    };
    // Whether the record holds the base `core_rel` bases into the searched range *and the scan read
    // it*: every base of a circle read whole, every base of the molecule for an interval on a
    // circle, and only the bases of the range itself where it was read straight from base 1.
    let readable = |core_rel: isize| -> bool {
        if wraps || (plan.is_some() && circular) {
            true
        } else if plan.is_some() {
            let abs = core_start as isize - 1 + core_rel;
            abs >= 0 && abs < seq_len as isize
        } else {
            core_rel >= 0 && core_rel < core_len as isize
        }
    };
    // Where the reported cut falls, and the staggered second one where the preset has it: both are
    // the preset's own offsets (D0131), never a rule chosen from the nuclease's name. The base
    // reported is the last plus-strand base before the break, so on the reverse strand it is the
    // base one position below the site base the cut follows.
    let cut_core_rel = |i: usize, strand: i8, cut_off: usize| -> isize {
        if strand == 1 {
            site_core_rel(i, strand) + cut_off as isize - 1
        } else {
            site_core_rel(i, strand) + span as isize - cut_off as isize - 1
        }
    };
    let cut_at = |offset: u32, strand: i8, cut_off: usize| -> usize {
        plus_pos(cut_core_rel(offset as usize, strand, cut_off))
    };
    // The same cut, or nothing where it falls on no base the scan read: the break lies between the
    // two bases either side of it, so both must be there. On a linear molecule read to its end a
    // cut past that end has no plus-strand base before it and is not given one by the modulus
    // (US-01M7DV29 AC4); on a circle every position exists.
    let cut_in_range = |offset: u32, strand: i8, cut_off: usize| -> Option<usize> {
        let before = cut_core_rel(offset as usize, strand, cut_off);
        if readable(before) && readable(before + 1) {
            Some(cut_at(offset, strand, cut_off))
        } else {
            None
        }
    };
    let coords = |offset: u32, strand: i8| -> (usize, usize, usize) {
        let from = site_core_rel(offset as usize, strand);
        (
            plus_pos(from),
            plus_pos(from + span as isize - 1),
            cut_at(offset, strand, cut_offset),
        )
    };
    // What a guide read outside the interval searched, where it read anything (US-01M7DVAS AC2):
    // its spacer is inside the interval, so only its PAM can be outside, and the note names that
    // PAM's own bases. `None` for a whole-sequence scan and for a site wholly inside the interval.
    let interval_context_note = |offset: u32, strand: i8| -> Option<String> {
        let iv = searched_interval?;
        let i = offset as usize;
        if site_in_core(i, strand) {
            return None;
        }
        let from = pam_core_rel(i, strand);
        Some(format!(
            "The spacer lies inside the interval searched ({}..{}), but its {} PAM at {}..{} does not lie wholly inside it: that PAM was read from context outside the interval, which was read for a PAM and for nothing else — no base of it was searched for a guide of its own, or counted as a seed match.",
            format_thousands(iv.start),
            format_thousands(iv.end),
            preset.pam_side,
            format_thousands(plus_pos(from)),
            format_thousands(plus_pos(from + pam_len as isize - 1))
        ))
    };
    let mut ranking: Vec<Ranked> = Vec::new();
    for &(offset, strand) in &candidates {
        let strand_b = if strand == 1 { s_bytes } else { rc_bytes };
        let (spacer, pam) = candidate_at(strand_b, offset as usize, is_spcas9)
            .expect("a candidate found in pass 1 is a candidate in pass 3");
        let (on_t, spec, _, _) = score_guide(spacer, pam);
        ranking.push(Ranked {
            score: on_t + spec,
            start: coords(offset, strand).0,
            strand,
            offset,
        });
        if ranking.len() >= trim_at {
            ranking.sort_by(by_rank);
            ranking.truncate(limit);
        }
    }
    ranking.sort_by(by_rank);
    ranking.truncate(limit);

    let mut warnings = bounded_warning(scanned);
    // The interval searched, said in words beside the numbers (US-01M7DVAS AC4): what was searched,
    // how long it is, how long the whole sequence is, and that the seed counts cover that interval
    // alone — so an interval scan is never read as a scan of the whole sequence.
    if let Some(p) = &plan {
        let iv = p.interval;
        warnings.push(format!(
            "Guides were searched for in bases {}..{} — the {} bp interval asked for{}, of the {} bases of this sequence — on both strands, and seed matches counted in that interval alone: a guide or a seed match outside it is not in this result, so a specificity here is an interval specificity and not one over the whole sequence.",
            format_thousands(iv.start),
            format_thousands(iv.end),
            format_thousands(iv.length_bp),
            if iv.crosses_origin {
                ", across the origin"
            } else {
                ""
            },
            format_thousands(seq_len)
        ));
        if let Some(note) = &p.cap_note {
            warnings.push(note.clone());
        }
        if context_outside_interval_bp > 0 {
            // The bases *outside* the interval each context window reads: a whole PAM of them,
            // unless the interval leaves fewer than that outside it, where the window reads the
            // rest of its own bases back over the interval and those are not context of anything.
            let outside = seq_len - iv.length_bp;
            let before = ctx_left.min(outside);
            let after = ctx_right.min(outside);
            if before + after > context_outside_interval_bp {
                // A near-full circle: the two windows meet, so some of those bases were read on
                // both sides of the interval. They are one base of context each, not two.
                warnings.push(format!(
                    "{} bases outside that interval were read as PAM context only — all of the bases outside it: {} before it and {} after it, {} of them read on both sides, because the interval leaves less of the sequence outside it than a PAM either side of it reads. A candidate whose spacer is inside the interval but whose PAM is not is listed and says so on its own row, and no base of that context was searched for a guide of its own or counted as a seed match.",
                    format_thousands(context_outside_interval_bp),
                    format_thousands(before),
                    format_thousands(after),
                    format_thousands(before + after - context_outside_interval_bp)
                ));
            } else {
                warnings.push(format!(
                    "{} bases outside that interval were read as PAM context only — {} before it and {} after it: a candidate whose spacer is inside the interval but whose PAM is not is listed and says so on its own row, and no base of that context was searched for a guide of its own or counted as a seed match.",
                    format_thousands(context_outside_interval_bp),
                    format_thousands(before),
                    format_thousands(after)
                ));
            }
        }
    }
    // A caller that asked for no rows was not capped: it asked for the report alone (US-01M7DVH2).
    if limit > 0 && ranking.len() < candidates.len() {
        warnings.push(format!(
            "Guide list capped: it shows the {} highest-scoring of the {} candidate guides found.",
            format_thousands(ranking.len()),
            format_thousands(candidates.len())
        ));
    }

    // Whether the searched range itself was read across the origin, and how many of its bases lie
    // the other side of it: a circle read whole continues `span - 1` bases past its last base, and
    // an interval that runs across the origin holds its `end` bases after it.
    let scanned_circular = wraps || searched_interval.is_some_and(|iv| iv.crosses_origin);
    let origin_span_bp = match searched_interval {
        Some(iv) if !wraps => {
            if iv.crosses_origin {
                iv.end
            } else {
                0
            }
        }
        _ => {
            if wraps {
                span - 1
            } else {
                0
            }
        }
    };

    // ── The records themselves, built only for the candidates that were kept. ──
    let guides: Vec<CrisprGuideRecord> = ranking
        .iter()
        .map(|r| {
            let strand_b = if r.strand == 1 { s_bytes } else { rc_bytes };
            let i = r.offset as usize;
            let (spacer, pam) = candidate_at(strand_b, i, is_spcas9)
                .expect("a candidate found in pass 1 is a candidate when its record is built");
            let (on_t, spec, off_cnt, gc) = score_guide(spacer, pam);
            let (_, end1, cut_pos) = coords(r.offset, r.strand);
            let target_cut = cut_offset_target.map(|off| cut_in_range(r.offset, r.strand, off));
            CrisprGuideRecord {
                id: format!(
                    "{}-{}-{}",
                    if is_spcas9 { "crispr" } else { "cas12a" },
                    if r.strand > 0 { "f" } else { "r" },
                    r.start
                ),
                name: format!(
                    "{}_{}_{}",
                    if is_spcas9 { "gRNA" } else { "crRNA" },
                    r.start,
                    if r.strand > 0 { "F" } else { "R" }
                ),
                spacer_seq: String::from_utf8_lossy(spacer).to_string(),
                pam_seq: String::from_utf8_lossy(pam).to_string(),
                nuclease: nuc_label.clone(),
                start: r.start,
                end: end1,
                cut_position: cut_pos,
                strand: r.strand,
                gc_percent: gc,
                on_target_score: on_t,
                specificity_score: spec,
                off_target_count: off_cnt,
                candidate_count: candidates.len(),
                scanned_length_bp: scanned,
                sequence_length_bp: seq_len,
                scanned_circular,
                origin_span_bp,
                warnings: warnings.clone(),
                pam_side: preset.pam_side.clone(),
                pam_pattern: preset.pam_pattern.clone(),
                cut_convention: preset.cut_convention.clone(),
                cut_position_target_strand: target_cut.flatten(),
                cut_position_target_strand_note: match target_cut {
                    Some(None) => Some(
                        "The target-strand cut falls past the end of the sequence read, so it has no position here."
                            .to_string(),
                    ),
                    _ => None,
                },
                pam_ambiguity_note: pam_ambiguity_note(pam, &preset.pam_pattern),
                searched_interval,
                interval_context_note: interval_context_note(r.offset, r.strand),
            }
        })
        .collect();

    CrisprGuideScan {
        guides,
        candidate_count: candidates.len(),
        scanned_length_bp: scanned,
        sequence_length_bp: seq_len,
        scanned_circular,
        origin_span_bp,
        searched_interval,
        interval_refusal: None,
        context_outside_interval_bp,
        warnings,
    }
}

/// A scan that searched nothing, and says why: the nuclease was not a preset (D0130), or the
/// interval could not be searched (US-01M7DVAS AC6). No range is claimed and no guide is returned,
/// because none was looked for.
fn refused_scan(
    sequence_length_bp: usize,
    reason: String,
    interval_refusal: Option<String>,
) -> CrisprGuideScan {
    CrisprGuideScan {
        guides: Vec::new(),
        candidate_count: 0,
        scanned_length_bp: 0,
        sequence_length_bp,
        scanned_circular: false,
        origin_span_bp: 0,
        searched_interval: None,
        interval_refusal,
        context_outside_interval_bp: 0,
        warnings: vec![reason],
    }
}

/// Audit a `SequenceDocument` for Dam/Dcm methylation blocks, internal Type IIS sites in CDS features,
/// reading-frame phase errors, and paired primer $\Delta T_m$ spreads, reading `cut_sites` as every
/// site of the enzymes scanned. See [`audit_sequence_alerts_for_scan`] for a scan that kept only
/// some of its sites.
pub fn audit_sequence_alerts(
    doc: &SequenceDocument,
    cut_sites: &[RestrictionCutSite],
    strain: &str,
) -> Vec<SequenceAlertItem> {
    audit_sequence_alerts_for_scan(doc, cut_sites, strain, false)
}

/// [`audit_sequence_alerts`] on the sites a restriction scan kept, where `scan_stopped_early` is
/// the scan's own report that it kept fewer sites than it found (BG-01M6S1K2). The blocked sites
/// counted are then only those it kept, so the methylation alert says "At least N", and no
/// all-clear line claims restriction sites the scan did not keep.
pub fn audit_sequence_alerts_for_scan(
    doc: &SequenceDocument,
    cut_sites: &[RestrictionCutSite],
    strain: &str,
    scan_stopped_early: bool,
) -> Vec<SequenceAlertItem> {
    let mut alerts: Vec<SequenceAlertItem> = Vec::new();
    let eff_strain = if strain.trim().is_empty() {
        "DH5α (dam+ dcm+)"
    } else {
        strain
    };
    let is_dam_minus = eff_strain.contains("dam-");

    let blocked: Vec<&RestrictionCutSite> = cut_sites
        .iter()
        .filter(|c| c.methylation_blocked)
        .collect();
    if !blocked.is_empty() && !is_dam_minus {
        let mut labels: Vec<String> = Vec::new();
        let mut seen: FxHashSet<String> = FxHashSet::default();
        for b in &blocked {
            let lbl = format!("{}@{}", b.enzyme.name, b.position);
            if seen.insert(lbl.clone()) && labels.len() < 12 {
                labels.push(lbl);
            }
        }
        alerts.push(SequenceAlertItem {
            id: "alert-methylation".to_string(),
            severity: "warning".to_string(),
            category: "Methylation".to_string(),
            title: format!(
                "{}{} Restriction Site(s) Blocked by Dam/Dcm Methylation in {}",
                if scan_stopped_early { "At least " } else { "" },
                blocked.len(),
                eff_strain
            ),
            detail: format!(
                "Sites ({}) overlap Dam (GATC) or Dcm (CCWGG) motifs. Propagate in a dam-/dcm- strain (e.g. JM110 / SCS110) if cleavage is required.",
                labels.join(", ")
            ),
            position_bp: Some(blocked[0].position),
        });
    }

    let type2s: Vec<&RestrictionCutSite> =
        cut_sites.iter().filter(|c| c.enzyme.is_type_iis).collect();
    for cds in doc.features.iter().filter(|f| f.feature_type == "CDS") {
        if let Some(first_2s) = type2s
            .iter()
            .find(|c| c.position >= cds.start && c.position <= cds.end)
        {
            alerts.push(SequenceAlertItem {
                id: format!("alert-type2s-{}", cds.id),
                severity: "warning".to_string(),
                category: "Type IIS Cloning".to_string(),
                title: format!(
                    "Internal Type IIS Site ({}) Inside CDS \"{}\"",
                    first_2s.enzyme.name, cds.name
                ),
                detail: format!(
                    "{} cuts at {} bp inside {}. Use \"Analyze Silent Mutations\" to domesticate this internal site prior to Golden Gate / Parts assembly.",
                    first_2s.enzyme.name, first_2s.position, cds.name
                ),
                position_bp: Some(first_2s.position),
            });
        }

        if cds.end >= cds.start {
            // A spliced CDS codes for the sum of its exons, not its genomic span: measuring the
            // span would report every intron-containing gene as a frameshift.
            let cds_len = match cds.segments.as_ref() {
                Some(segs) if segs.len() > 1 => segs
                    .iter()
                    .filter(|seg| seg.end >= seg.start)
                    .map(|seg| seg.end - seg.start + 1)
                    .sum(),
                _ => cds.end - cds.start + 1,
            };
            if cds_len % 3 != 0 {
                alerts.push(SequenceAlertItem {
                    id: format!("alert-frame-{}", cds.id),
                    severity: "critical".to_string(),
                    category: "Reading Frame".to_string(),
                    title: format!(
                        "Non-Triplet Reading Frame Length in CDS \"{}\" ({} bp)",
                        cds.name, cds_len
                    ),
                    detail: format!(
                        "Coding sequence length ({} bp) is not a multiple of 3 bases, indicating a potential frameshift or truncated annotation.",
                        cds_len
                    ),
                    position_bp: Some(cds.start),
                });
            }
        }
    }

    if doc.primers.len() >= 2 {
        let mut min_tm = f64::INFINITY;
        let mut max_tm = f64::NEG_INFINITY;
        for p in &doc.primers {
            min_tm = min_tm.min(p.tm_anneal_c);
            max_tm = max_tm.max(p.tm_anneal_c);
        }
        if max_tm - min_tm > 5.0 {
            alerts.push(SequenceAlertItem {
                id: "alert-primer-tm".to_string(),
                severity: "info".to_string(),
                category: "Primer Hybridization".to_string(),
                title: format!(
                    "Primer Melting Temperature Spread (ΔTm = {:.1} °C)",
                    max_tm - min_tm
                ),
                detail: format!(
                    "Saved primers on {} span {:.1} °C to {:.1} °C. For optimal PCR specificity, keep paired primer ΔTm within 5.0 °C.",
                    doc.name, min_tm, max_tm
                ),
                position_bp: None,
            });
        }
    }

    if alerts.is_empty() && !scan_stopped_early {
        alerts.push(SequenceAlertItem {
            id: "alert-clean".to_string(),
            severity: "info".to_string(),
            category: "Reading Frame".to_string(),
            title: "All Reading Frames, Restriction Sites & Primer Duplexes Verified".to_string(),
            detail: format!(
                "No methylation conflicts, frameshifts, or primer hybridization issues detected in {}.",
                doc.name
            ),
            position_bp: None,
        });
    }

    alerts
}

#[cfg(test)]
mod crispr_tests {
    use super::*;

    #[test]
    fn spcas9_cut_is_three_bp_upstream_of_the_pam_on_both_strands() {
        // The nuclease is named by its preset id: a name that is not a preset is refused rather
        // than scanned as SpCas9 (US-01M7DV29, D0130).
        // forward protospacer at 6..25 with AGG PAM at 26..28 → cut after base 22
        let spacer = "GACGTTACCGATTGCAATCG";
        let seq = format!("TTTTT{spacer}AGGTTTTT");
        let g = find_crispr_guides(&seq, "SpCas9 (NGG)", 50);
        let f = g.iter().find(|g| g.strand == 1 && g.spacer_seq == spacer).unwrap();
        assert_eq!((f.start, f.cut_position), (6, 22));
        assert_eq!(&seq[f.cut_position - 3..f.cut_position + 3], &format!("{}{}", &spacer[14..17], &spacer[17..20]));
        // the same site on the reverse strand: cut after base len - 22
        let rc = reverse_complement_iupac(&seq, false);
        let r = find_crispr_guides(&rc, "SpCas9 (NGG)", 50);
        let rg = r.iter().find(|g| g.strand == -1 && g.spacer_seq == spacer).unwrap();
        assert_eq!(rg.cut_position, seq.len() - 22);
    }
}

#[cfg(test)]
mod interval_plan_tests {
    use super::*;

    /// US-01M7DVAS AC6, and the interaction with [`GUIDE_SCAN_MAX_BP`]: the cap still bounds the
    /// bases an *interval* asks for, and the interval the scan then reports is the one it really
    /// searched rather than the one it was asked for. The cap is a parameter here so the rule is
    /// read at a hundred bases instead of allocating eight million of them; the scan itself passes
    /// [`GUIDE_SCAN_MAX_BP`], which is asserted below so the two cannot drift apart.
    ///
    /// Wrong implementations this kills: a cap applied to the whole sequence but not to the bases an
    /// interval asks for (the 800-bp interval comes back whole); a cap that refuses such an interval
    /// instead of reading its first bases (it comes back as an error); a cap that truncates the
    /// bases but leaves `searched_interval` naming the interval asked for (its end stays 900); and
    /// one that counts an across-origin interval's length as `end - start` (the 901-bp interval
    /// round the origin is then not capped at all).
    #[test]
    fn us_01m7dvas_ac6_the_scan_cap_still_bounds_the_bases_an_interval_asks_for() {
        let spcas9 = resolve_nuclease_preset("SpCas9 (NGG)").expect("a preset");
        let plan = |start, end, circular, max_bp| {
            plan_interval(
                start,
                end,
                1_000,
                circular,
                spcas9.site_span_bp,
                &spcas9.id,
                max_bp,
            )
        };
        // Inside the cap: searched as asked for, with nothing to say about it.
        let asked = plan(101, 200, false, 500).expect("an interval inside the cap is searchable");
        assert_eq!(
            (
                asked.interval.start,
                asked.interval.end,
                asked.interval.length_bp
            ),
            (101, 200, 100)
        );
        assert!(asked.cap_note.is_none());
        // Longer than the cap: read from its start for the cap's own bases, and said in words.
        let capped = plan(101, 900, false, 500).expect("a long interval is bounded, not refused");
        assert_eq!(
            (
                capped.interval.start,
                capped.interval.end,
                capped.interval.length_bp
            ),
            (101, 600, 500)
        );
        let note = capped.cap_note.expect("the bound is named");
        assert!(
            note.contains("101..900") && note.contains("101..600") && note.contains("500"),
            "the sentence names the interval asked for and the bases really searched: {note}"
        );
        // Across the origin of a circle the cap counts the same bases, round the origin.
        let across = plan(900, 800, true, 500).expect("an across-origin interval is bounded too");
        assert_eq!(
            (
                across.interval.start,
                across.interval.end,
                across.interval.length_bp,
                across.interval.crosses_origin
            ),
            (900, 399, 500, true)
        );
        assert!(across.cap_note.is_some());
        // The cap the scan itself applies, so this test and the scan read one number.
        assert_eq!(GUIDE_SCAN_MAX_BP, 8_000_000);
        let whole = plan(1, 1_000, false, GUIDE_SCAN_MAX_BP).expect("the whole record");
        assert!(whole.cap_note.is_none() && whole.interval.length_bp == 1_000);
    }
}
