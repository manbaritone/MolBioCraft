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
/// rule-of-thumb heuristic (GC content, 3' G, poly-T) — not a trained Doench score — and
/// specificity reflects only exact matches of the 12-nt PAM-proximal seed elsewhere in the same
/// sequence, not a genome-wide search.
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
    scan_crispr_guides(raw_seq, nuclease, max_results, None, false).guides
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
    scan_crispr_guides(raw_seq, nuclease, max_results, None, circular).guides
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
/// `circular` reads the record as the circle it is (BG-01M6T6GQ): every base of both strands is the
/// start of a candidate, a site that runs off the last base continues at base 1, and the seeds are
/// counted over the same circle. Starts, ends and cut sites stay inside 1..length, so a site across
/// the origin reads `start > end`, and no site is listed twice. A bound shorter than the sequence
/// cannot wrap — bases 1 to `scanned` are not a circle — so such a scan reads the range straight and
/// reports it in `warnings`; `scanned_circular` says which of the two happened.
pub fn scan_crispr_guides(
    raw_seq: &str,
    nuclease: &str,
    max_results: usize,
    scan_limit_bp: Option<usize>,
    circular: bool,
) -> CrisprGuideScan {
    let s = clean_alpha_sequence(raw_seq).replace('U', "T");
    let seq_len = s.len();
    let scanned = seq_len.min(scan_limit_bp.unwrap_or(GUIDE_SCAN_MAX_BP));
    let bounded_warning = |scanned: usize| -> Vec<String> {
        if scanned < seq_len {
            vec![format!(
                "Guides were searched for in bases 1 to {} of the {} bases of this sequence, on both strands, and seed matches counted there: a guide or a seed match outside that range is not in this result.",
                format_thousands(scanned),
                format_thousands(seq_len)
            )]
        } else {
            Vec::new()
        }
    };
    let is_spcas9 = !nuclease.contains("Cas12a");
    // SpCas9: 20-nt spacer then a 3-nt PAM. Cas12a: a 4-nt PAM then a 20-nt spacer. The bases a
    // candidate occupies, and so the last start position each strand has: the loop once read
    // `0..=(len - 24)` for both, which never examined SpCas9's last start (BG-01M6T6GQ).
    let span = if is_spcas9 { 23usize } else { 24 };
    if scanned < span {
        return CrisprGuideScan {
            guides: Vec::new(),
            candidate_count: 0,
            scanned_length_bp: scanned,
            sequence_length_bp: seq_len,
            scanned_circular: false,
            origin_span_bp: 0,
            warnings: bounded_warning(scanned),
        };
    }
    let limit = if max_results == 0 { 30 } else { max_results };
    let nuc_label = if is_spcas9 {
        "SpCas9 (NGG)"
    } else {
        "Cas12a / Cpf1 (TTTV)"
    };
    // A circular record is read as a circle only when the whole of it was read: bases 1 to a bound
    // shorter than the sequence do not meet, so that range is read straight.
    let wraps = circular && scanned == seq_len;

    // Both strands of the same range. The reverse complement is taken of the scanned bases only, so
    // a bounded scan reads the first `scanned` bases of each strand — not the first of one and the
    // last of the other, which left a forward guide past the bound and a reverse guide before it
    // invisible.
    let top = &s[..scanned];
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
    // Every start position of each strand: all `scanned` of them on a circle, where every base
    // begins a site, and `scanned - span + 1` on a line, where the last site ends at the last base.
    let starts = if wraps { scanned } else { scanned - span + 1 };

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

    // ── Pass 1: every candidate guide, and the set of seeds whose matches must be counted. ──
    let mut candidates: Vec<(u32, i8)> = Vec::new();
    let mut seed_counts: FxHashMap<u32, u32> = FxHashMap::default();
    for (strand_b, strand) in [(s_bytes, 1i8), (rc_bytes, -1i8)] {
        for i in 0..starts {
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
    // scanned range. A window holding an ambiguity code matches no seed of A, C, G and T, so the
    // run of unambiguous bases is restarted there. On a circle the pass reads `SEED_LEN - 1` bases
    // into the copy of the start, which is every window that crosses the origin and no window
    // twice: a seed match across the origin is counted once, like any other. ──
    let counted = if wraps { scanned + SEED_LEN - 1 } else { scanned };
    for strand_b in [&s_bytes[..counted], &rc_bytes[..counted]] {
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

        // Rule-of-thumb activity heuristic (NOT Doench Rule Set 1/2, which are trained models):
        // GC content 40–65 %, G at spacer position 20, no TTTT (Pol III terminator).
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
        on_target = on_target.clamp(8, 99);

        // Other exact occurrences of the 12-nt PAM-proximal seed over the scanned range (both
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
    // SpCas9 cuts bluntly 3 bp 5' of the PAM; Cas12a after spacer nt 18 on the PAM strand
    // (staggered; 23 on the target strand). Reported as the 1-based base it cuts after.
    let cut_offset = if is_spcas9 { 17 } else { 22 };
    // Where a candidate at `offset` on `strand` sits in the record: `(start, end, cut)`, 1-based and
    // inside 1..scanned. A circular scan reads offsets past the last base, so every position is
    // taken modulo the record: a site across the origin reads `start > end`, the convention this
    // workbench already uses for a primer binding site that straddles the origin. On a linear scan
    // no offset reaches the modulus, so the three numbers are the ones a straight read gives.
    let coords = |offset: u32, strand: i8| -> (usize, usize, usize) {
        let i = offset as usize;
        if strand == 1 {
            (
                i % scanned + 1,
                (i + span - 1) % scanned + 1,
                (i + cut_offset - 1) % scanned + 1,
            )
        } else {
            // The 1-based plus-strand coordinate of reverse-strand position `j`: the two strands run
            // in opposite directions, so the site's last base is its lowest plus coordinate.
            let plus = |j: usize| scanned - j % scanned;
            (plus(i + span - 1), plus(i), plus(i + cut_offset))
        }
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
    if ranking.len() < candidates.len() {
        warnings.push(format!(
            "Guide list capped: it shows the {} highest-scoring of the {} candidate guides found.",
            format_thousands(ranking.len()),
            format_thousands(candidates.len())
        ));
    }

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
                nuclease: nuc_label.to_string(),
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
                scanned_circular: wraps,
                origin_span_bp: if wraps { span - 1 } else { 0 },
                warnings: warnings.clone(),
            }
        })
        .collect();

    CrisprGuideScan {
        guides,
        candidate_count: candidates.len(),
        scanned_length_bp: scanned,
        sequence_length_bp: seq_len,
        scanned_circular: wraps,
        origin_span_bp: if wraps { span - 1 } else { 0 },
        warnings,
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
        // forward protospacer at 6..25 with AGG PAM at 26..28 → cut after base 22
        let spacer = "GACGTTACCGATTGCAATCG";
        let seq = format!("TTTTT{spacer}AGGTTTTT");
        let g = find_crispr_guides(&seq, "SpCas9", 50);
        let f = g.iter().find(|g| g.strand == 1 && g.spacer_seq == spacer).unwrap();
        assert_eq!((f.start, f.cut_position), (6, 22));
        assert_eq!(&seq[f.cut_position - 3..f.cut_position + 3], &format!("{}{}", &spacer[14..17], &spacer[17..20]));
        // the same site on the reverse strand: cut after base len - 22
        let rc = reverse_complement_iupac(&seq, false);
        let r = find_crispr_guides(&rc, "SpCas9", 50);
        let rg = r.iter().find(|g| g.strand == -1 && g.spacer_seq == spacer).unwrap();
        assert_eq!(rg.cut_position, seq.len() - 22);
    }
}
