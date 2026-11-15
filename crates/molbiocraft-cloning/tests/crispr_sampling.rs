// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S15R: over 300 kb the guide finder counted seed matches from a sampled 12-mer index
//! (stride `len / 150,000`), and it looked for guides on the forward strand in the first 500 kb and
//! on the reverse strand in the *last* 500 kb. A guide between two sampled positions read as a
//! unique seed when it had copies, which is the worst direction for a specificity, and half the
//! planted guides were never listed.
//!
//! Every number here is checked against a direct search written in this file: the seed matched base
//! by base over both strands, and the candidate guides found by reading the engine's own rule (a
//! 20-nt all-ACGT spacer followed by NGG) off the bases. Nothing is taken from the engine's index.
//!
//! The fixtures are built from a fixed seed over A and T only, so they hold no `GG` and therefore no
//! NGG PAM but the ones planted: the candidate list is then known exactly, and a count that drifts
//! has nowhere to hide. Seed copies sit at offsets that are not multiples of the old stride, and
//! guides sit in the ranges each strand's old scan never reached.

use molbiocraft_cloning::cloning_crispr::{
    find_crispr_guides, resolve_nuclease_preset, scan_crispr_guides, supported_nuclease_presets,
    CrisprGuideRecord, CRISPR_HEURISTIC_RANK_RANGE, GUIDE_SCAN_MAX_BP,
};

// ───────────────────────────── fixtures, from a fixed seed ─────────────────────────────

/// `len` bases of A and T from `seed` (the same bases on every run). A and T alone cannot spell
/// `GG` or `CC`, so neither strand of this background carries an NGG PAM.
fn at_background(len: usize, seed: u32) -> Vec<u8> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            if x >> 31 == 0 {
                b'A'
            } else {
                b'T'
            }
        })
        .collect()
}

/// Writes `block` over `seq` at the 0-based offset `at`.
fn plant(seq: &mut [u8], at: usize, block: &str) {
    seq[at..at + block.len()].copy_from_slice(block.as_bytes());
}

fn complement(b: u8) -> u8 {
    match b {
        b'A' => b'T',
        b'T' => b'A',
        b'C' => b'G',
        b'G' => b'C',
        other => other,
    }
}

fn revcomp(seq: &[u8]) -> Vec<u8> {
    seq.iter().rev().copied().map(complement).collect()
}

/// A 20-nt spacer with no `GG` and no `CC`, so planting it adds no PAM of its own on either strand,
/// and 40 % GC, so it scores inside the heuristic's preferred band.
const SPACER: &str = "ATCGTACTGATCAGTCATGA";
/// `SPACER`'s PAM-proximal 12-mer — the seed the engine counts matches of for SpCas9.
const SEED: &str = "GATCAGTCATGA";
/// A second spacer, also `GG`/`CC`-free, whose seed appears nowhere else.
const LONE_SPACER: &str = "TAGCATCGATACGTATCAGT";

/// `SPACER` followed by an NGG PAM: one candidate guide on the forward strand, none on the reverse
/// (its reverse complement spells `CCT` + a `GG`-free spacer).
fn block(spacer: &str) -> String {
    format!("{spacer}AGG")
}

// ───────────────────────────── the direct search ─────────────────────────────

/// Every exact occurrence of `seed` over `scanned` bases of both strands, matched base by base: the
/// same question the engine's seed index answers, asked without the index.
fn direct_seed_hits(seq: &[u8], scanned: usize, seed: &str) -> usize {
    let needle = seed.as_bytes();
    let top = &seq[..scanned];
    let bottom = revcomp(top);
    [top, &bottom[..]]
        .iter()
        .map(|strand| {
            strand
                .windows(needle.len())
                .filter(|w| *w == needle)
                .count()
        })
        .sum()
}

/// Every SpCas9 candidate over `scanned` bases of both strands, read off the bases by the engine's
/// own rule (20 all-ACGT spacer bases, then N G G), as `(start1, end1, strand, spacer)` in the
/// coordinates of the whole sequence.
fn direct_spcas9_candidates(seq: &[u8], scanned: usize) -> Vec<(usize, usize, i8, String)> {
    let top = &seq[..scanned];
    let bottom = revcomp(top);
    let mut out = Vec::new();
    for (strand_bytes, strand) in [(top, 1i8), (&bottom[..], -1i8)] {
        // A 23-base SpCas9 site: the last start of each strand is `len - 23`, which this search
        // (and the engine) once stopped one base short of (BG-01M6T6GQ).
        for i in 0..=(strand_bytes.len() - 23) {
            let pam = &strand_bytes[i + 20..i + 23];
            if pam[1] != b'G' || pam[2] != b'G' {
                continue;
            }
            let spacer = &strand_bytes[i..i + 20];
            if spacer
                .iter()
                .any(|b| !matches!(b, b'A' | b'C' | b'G' | b'T'))
            {
                continue;
            }
            let (start1, end1) = if strand == 1 {
                (i + 1, i + 23)
            } else {
                (scanned - (i + 23) + 1, scanned - i)
            };
            out.push((
                start1,
                end1,
                strand,
                String::from_utf8(spacer.to_vec()).unwrap(),
            ));
        }
    }
    out.sort();
    out
}

/// Each guide as `(start, end, strand, spacer)`, in the same shape the direct search returns.
fn as_tuples(guides: &[CrisprGuideRecord]) -> Vec<(usize, usize, i8, String)> {
    let mut out: Vec<_> = guides
        .iter()
        .map(|g| (g.start, g.end, g.strand, g.spacer_seq.clone()))
        .collect();
    out.sort();
    out
}

/// Asserts every guide's off-target count is the direct count of its seed over the scanned range,
/// less its own occurrence.
fn assert_counts_match_direct_search(
    guides: &[CrisprGuideRecord],
    seq: &[u8],
    scanned: usize,
) {
    for g in guides {
        let seed = &g.spacer_seq[8..20];
        let direct = direct_seed_hits(seq, scanned, seed);
        assert!(direct >= 1, "the guide's own seed is not in the sequence");
        assert_eq!(
            g.off_target_count,
            direct - 1,
            "{} ({}): the engine counts {} other copies of seed {seed}, the direct search {}",
            g.name,
            g.spacer_seq,
            g.off_target_count,
            direct - 1
        );
        assert_eq!(
            g.specificity_score,
            (100.0 / (1.0 + g.off_target_count as f64)).round() as i32,
            "{}: the specificity does not follow its own off-target count",
            g.name
        );
    }
}

// ───────────────────────────── AC1 ─────────────────────────────

/// AC1. A 1 Mb sequence holding one guide whose seed has 9 other copies, and one whose seed is
/// unique. The copies sit at offsets that are not multiples of the old stride (`1,000,000 /
/// 150,000 = 6`), so a sampled index read none of them and the repeated seed reported itself as
/// unique — a specificity of 100 for a guide with 9 other seed matches. Three decoys one, two and
/// three bases from the seed are planted too: the engine's rule is an exact match, so a count that
/// has crept to near-matches reads 10, 11 or 12 here instead of 9.
#[test]
fn seed_counts_are_exact_at_1mb() {
    const LEN: usize = 1_000_000;
    let mut seq = at_background(LEN, 0x15_6ead);
    plant(&mut seq, 1_000, &block(SPACER));
    // 9 more copies of the seed, none at an offset the old stride-6 index sampled, spread over the
    // whole megabase (five of them past the 500 kb the forward scan stopped at).
    let copies = [
        50_003, 150_005, 250_001, 400_007, 520_001, 650_005, 750_007, 880_001, 990_001,
    ];
    for off in copies {
        assert_ne!(off % 6, 0, "offset {off} is one the old index sampled");
        plant(&mut seq, off, SEED);
    }
    // Near-matches, which an exact-seed rule does not count.
    plant(&mut seq, 60_001, "TATCAGTCATGA"); // 1 base from SEED
    plant(&mut seq, 160_001, "TATCAGTCATGT"); // 2 bases
    plant(&mut seq, 260_001, "TATCAGTCATTT"); // 3 bases
    // A guide whose seed has no other copy, so a count that is simply always high fails here.
    plant(&mut seq, 700_001, &block(LONE_SPACER));

    let text = String::from_utf8(seq.clone()).unwrap();
    assert_eq!(
        direct_seed_hits(&seq, LEN, SEED),
        10,
        "the fixture plants 10 copies of the seed"
    );
    assert_eq!(
        direct_seed_hits(&seq, LEN, &LONE_SPACER[8..20]),
        1,
        "and one copy of the lone seed"
    );

    let guides = find_crispr_guides(&text, "SpCas9 (NGG)", 25);
    assert_eq!(
        as_tuples(&guides),
        direct_spcas9_candidates(&seq, LEN),
        "the guides listed are the candidates the direct search finds"
    );

    let repeated = guides
        .iter()
        .find(|g| g.spacer_seq == SPACER)
        .expect("the planted guide with a repeated seed is listed");
    assert_eq!(
        (repeated.off_target_count, repeated.specificity_score),
        (9, 10),
        "a seed with 9 other copies is counted as 9 other copies"
    );
    let lone = guides
        .iter()
        .find(|g| g.spacer_seq == LONE_SPACER)
        .expect("the planted guide with a unique seed is listed");
    assert_eq!(
        (lone.off_target_count, lone.specificity_score),
        (0, 100),
        "a seed with no other copy is still unique"
    );
    assert_counts_match_direct_search(&guides, &seq, LEN);
}

// ───────────────────────────── AC2 ─────────────────────────────

/// AC2. A 1 Mb sequence with ten identical guides, five on each strand, spread over the whole
/// megabase. The old scan read the forward strand in the first 500 kb and the reverse strand in the
/// last 500 kb, so a forward guide past 500 kb and a reverse guide before it were never listed; here
/// each strand has guides in both halves. The scan covers the whole sequence, so it says so rather
/// than naming a shorter range.
#[test]
fn finds_every_planted_guide_on_both_strands() {
    const LEN: usize = 1_000_000;
    let mut seq = at_background(LEN, 0x15_6eb2);
    let forward = [1_000usize, 240_000, 480_000, 720_000, 960_000];
    let reverse = [120_000usize, 360_000, 600_000, 840_000, 975_000];
    let fwd_block = block(SPACER);
    let rev_block = String::from_utf8(revcomp(fwd_block.as_bytes())).unwrap();
    for off in forward {
        plant(&mut seq, off, &fwd_block);
    }
    for off in reverse {
        plant(&mut seq, off, &rev_block);
    }
    let text = String::from_utf8(seq.clone()).unwrap();

    let mut expected: Vec<(usize, usize, i8, String)> = forward
        .iter()
        .map(|&o| (o + 1, o + 23, 1i8, SPACER.to_string()))
        .chain(
            reverse
                .iter()
                .map(|&o| (o + 1, o + 23, -1i8, SPACER.to_string())),
        )
        .collect();
    expected.sort();
    assert_eq!(
        direct_spcas9_candidates(&seq, LEN),
        expected,
        "the fixture holds exactly the ten planted guides, five per strand"
    );
    assert!(
        forward.iter().any(|&o| o > 500_000) && reverse.iter().any(|&o| o < 500_000),
        "and puts guides in the half each strand's old scan never read"
    );

    let scan = scan_crispr_guides(&text, "SpCas9 (NGG)", 25, None, false);
    assert_eq!(
        as_tuples(&scan.guides),
        expected,
        "all ten planted guides are found, on both strands"
    );
    assert_eq!(
        (scan.candidate_count, scan.scanned_length_bp, scan.sequence_length_bp),
        (10, LEN, LEN),
        "the whole sequence was searched"
    );
    assert_eq!(
        scan.warnings,
        Vec::<String>::new(),
        "nothing was left out, so nothing is warned about"
    );
    for g in &scan.guides {
        assert_eq!(
            &text[g.start - 1..g.end],
            if g.strand == 1 { &fwd_block } else { &rev_block },
            "{} does not sit where it is reported",
            g.name
        );
    }
    assert_eq!(
        as_tuples(&find_crispr_guides(&text, "SpCas9 (NGG)", 25)),
        expected,
        "the guide list the RPC replies with holds them too"
    );
    assert_counts_match_direct_search(&scan.guides, &seq, LEN);
}

// ───────────────────────────── what the scan reports ─────────────────────────────

/// A bound that remains is reported, and it bounds both strands alike. Asked to search 400 kb of a
/// 1 Mb sequence, the scan finds the guides in bases 1..400,000 of *both* strands — never the last
/// 400 kb of one of them — and says which range it read; the guides carry that sentence, because the
/// `find_crispr_guides` RPC replies with the guide list alone.
#[test]
fn a_bounded_scan_names_the_range_it_read_on_both_strands() {
    const LEN: usize = 1_000_000;
    const BOUND: usize = 400_000;
    let mut seq = at_background(LEN, 0x15_6ec4);
    let fwd_block = block(SPACER);
    let rev_block = String::from_utf8(revcomp(fwd_block.as_bytes())).unwrap();
    plant(&mut seq, 1_000, &fwd_block); // inside the bound, forward
    plant(&mut seq, 200_000, &rev_block); // inside the bound, reverse
    plant(&mut seq, 700_000, &fwd_block); // outside it
    plant(&mut seq, 900_000, &rev_block); // outside it, in the half the old reverse scan read
    let text = String::from_utf8(seq.clone()).unwrap();

    let scan = scan_crispr_guides(&text, "SpCas9 (NGG)", 25, Some(BOUND), false);
    assert_eq!(
        as_tuples(&scan.guides),
        direct_spcas9_candidates(&seq, BOUND),
        "a bounded scan reads the first bases of both strands"
    );
    assert_eq!(
        as_tuples(&scan.guides),
        vec![
            (1_001, 1_023, 1i8, SPACER.to_string()),
            (200_001, 200_023, -1i8, SPACER.to_string()),
        ],
        "the two guides inside the bound, one per strand"
    );
    assert_eq!(
        (scan.candidate_count, scan.scanned_length_bp, scan.sequence_length_bp),
        (2, BOUND, LEN)
    );
    let range = format!("bases 1 to 400,000 of the 1,000,000");
    assert!(
        scan.warnings.iter().any(|w| w.contains(&range)),
        "the scan names the range it read: {:?}",
        scan.warnings
    );
    for g in &scan.guides {
        assert_eq!(
            g.scanned_length_bp, BOUND,
            "each guide carries the range searched"
        );
        assert_eq!(g.sequence_length_bp, LEN);
        assert_eq!(g.candidate_count, 2);
        assert_eq!(g.warnings, scan.warnings, "and the scan's warnings");
    }
    assert_counts_match_direct_search(&scan.guides, &seq, BOUND);
}

/// A guide list shorter than the candidates found says how many there were, on every size: the
/// Primer & PCR studio reads this to say "top 25 of N" instead of calling 25 the whole answer.
#[test]
fn a_truncated_guide_list_reports_how_many_candidates_were_found() {
    const LEN: usize = 60_000;
    let mut seq = at_background(LEN, 0x15_6ed1);
    // 40 identical guides, so there are more candidates than a list of 25 holds.
    let fwd_block = block(SPACER);
    for k in 0..40usize {
        plant(&mut seq, 1_000 + k * 1_000, &fwd_block);
    }
    let text = String::from_utf8(seq.clone()).unwrap();
    assert_eq!(direct_spcas9_candidates(&seq, LEN).len(), 40);

    let scan = scan_crispr_guides(&text, "SpCas9 (NGG)", 25, None, false);
    assert_eq!(scan.guides.len(), 25);
    assert_eq!(scan.candidate_count, 40);
    assert_eq!(scan.scanned_length_bp, LEN);
    assert!(
        scan.warnings
            .iter()
            .any(|w| w.contains("25") && w.contains("40")),
        "the cap on the list is reported: {:?}",
        scan.warnings
    );
    for g in &scan.guides {
        assert_eq!(g.candidate_count, 40);
        assert_eq!(g.warnings, scan.warnings);
    }
    // Nothing was cut when the list holds every candidate.
    let whole = scan_crispr_guides(&text, "SpCas9 (NGG)", 100, None, false);
    assert_eq!((whole.guides.len(), whole.candidate_count), (40, 40));
    assert_eq!(whole.warnings, Vec::<String>::new());
}

/// The names the Primer & PCR studio reads these facts by, in the JSON the RPC replies with.
#[test]
fn guide_records_carry_the_scan_facts_in_json() {
    let seq = format!("{}{}", block(SPACER), "ATATATATATATATATATAT");
    let guides = find_crispr_guides(&seq, "SpCas9 (NGG)", 1);
    let json = serde_json::to_value(&guides[0]).unwrap();
    for key in [
        "candidateCount",
        "scannedLengthBp",
        "sequenceLengthBp",
        "warnings",
        "offTargetCount",
        "specificityScore",
    ] {
        assert!(json.get(key).is_some(), "the guide JSON has no {key}: {json}");
    }
    assert_eq!(json["sequenceLengthBp"], seq.len());
    assert_eq!(json["scannedLengthBp"], seq.len());
    assert_eq!(json["warnings"], serde_json::json!([]));
    // A reply written before this field existed still parses.
    let mut bare = json.clone();
    bare.as_object_mut().unwrap().remove("warnings");
    let parsed: CrisprGuideRecord = serde_json::from_value(bare).unwrap();
    assert!(parsed.warnings.is_empty());
}

/// The default bound `find_crispr_guides` runs with leaves every size the workbench is built for
/// searched whole: a megabase record, and a 5 Mb bacterial genome.
#[test]
fn the_default_bound_searches_a_bacterial_genome_whole() {
    assert!(
        GUIDE_SCAN_MAX_BP >= 5_000_000,
        "a 5 Mb genome must be searched whole, not {GUIDE_SCAN_MAX_BP}"
    );
    let seq = String::from_utf8(at_background(400_000, 0x15_6ee3)).unwrap();
    let scan = scan_crispr_guides(&seq, "SpCas9 (NGG)", 25, None, false);
    assert_eq!(
        (scan.scanned_length_bp, scan.sequence_length_bp),
        (400_000, 400_000),
        "400 kb is past the 300 kb that once started sampling, and is read whole"
    );
    assert_eq!(scan.warnings, Vec::<String>::new());
}

// ───────── BG-01M6T6GQ: the record's own topology, and the last start of each strand ─────────
//
// A plasmid is a circle, and the scan read the string straight: the guides whose site straddles the
// origin — up to span - 1 start positions per strand — were absent from a tab that said every base
// of both strands had been read. SpCas9's loop also stopped one start short of each strand's end
// (`0..=(len - 24)` for a 23-base site), so the last candidate of each strand was never examined.
//
// The oracle below is written from each nuclease's PAM rule and from the plus-strand coordinate of
// every base of a window, not from `direct_spcas9_candidates` above (which repeated the engine's own
// bound) and not from the engine's arithmetic.

/// A candidate guide as these tests compare them: `(start, end, strand, spacer, cut)`, 1-based and
/// in the coordinates of the record itself.
type Candidate = (usize, usize, i8, String, usize);

/// Every candidate of the chosen nuclease over the record, read off the bases at **every** start of
/// each strand, the last included, and — when `circular` — with every position taken modulo the
/// record length, so a site that runs off the last base continues at base 1 and no start is read
/// twice.
///
/// The rule is the nuclease's own: SpCas9 reads 20 unambiguous spacer bases then `N G G`, Cas12a
/// reads `T T T V` then 20 unambiguous bases. The coordinates come from the plus-strand position of
/// each base of the window, so a reverse-strand site is placed by its own geometry; `start` is the
/// plus coordinate of the window's last base on that strand and `end` the first, which is why a site
/// across the origin reads `start > end`. The cut is the plus-strand base the cut follows: SpCas9
/// cuts bluntly between spacer bases 17 and 18, Cas12a after spacer base 18, and of the two bases
/// that flank it the one reported is the one the other follows.
fn oracle_candidates(seq: &[u8], is_spcas9: bool, circular: bool) -> Vec<Candidate> {
    let l = seq.len();
    let span = if is_spcas9 { 23usize } else { 24 };
    let cut_index = if is_spcas9 { 17usize } else { 22 };
    let bottom = revcomp(seq);
    let starts = if circular { l } else { l - span + 1 };
    let mut out: Vec<Candidate> = Vec::new();
    for (strand_bytes, strand) in [(seq, 1i8), (&bottom[..], -1i8)] {
        for i in 0..starts {
            let window: Vec<u8> = (0..span).map(|k| strand_bytes[(i + k) % l]).collect();
            // The plus-strand 1-based coordinate of each base of the window, in the order this
            // strand reads them. Reverse-strand position j is plus base l - j.
            let plus: Vec<usize> = (0..span)
                .map(|k| {
                    let j = (i + k) % l;
                    if strand == 1 {
                        j + 1
                    } else {
                        l - j
                    }
                })
                .collect();
            let (spacer, has_pam) = if is_spcas9 {
                (&window[..20], window[21] == b'G' && window[22] == b'G')
            } else {
                (
                    &window[4..24],
                    &window[..3] == b"TTT" && matches!(window[3], b'A' | b'C' | b'G'),
                )
            };
            if !has_pam
                || spacer
                    .iter()
                    .any(|b| !matches!(b, b'A' | b'C' | b'G' | b'T'))
            {
                continue;
            }
            let (start1, end1) = if strand == 1 {
                (plus[0], plus[span - 1])
            } else {
                (plus[span - 1], plus[0])
            };
            let (one, other) = (plus[cut_index - 1], plus[cut_index]);
            let cut1 = if one % l + 1 == other { one } else { other };
            out.push((
                start1,
                end1,
                strand,
                String::from_utf8(spacer.to_vec()).unwrap(),
                cut1,
            ));
        }
    }
    out.sort();
    out
}

/// How many times each 12-mer of A, C, G and T occurs over both strands of the record, read as a
/// circle when `circular`: the exact seed count every specificity must follow.
fn oracle_seed_counts(seq: &[u8], circular: bool) -> std::collections::HashMap<Vec<u8>, usize> {
    let l = seq.len();
    let bottom = revcomp(seq);
    let starts = if circular { l } else { l - 12 + 1 };
    let mut counts: std::collections::HashMap<Vec<u8>, usize> = std::collections::HashMap::new();
    for strand_bytes in [seq, &bottom[..]] {
        for i in 0..starts {
            let w: Vec<u8> = (0..12).map(|k| strand_bytes[(i + k) % l]).collect();
            if w.iter().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T')) {
                *counts.entry(w).or_insert(0) += 1;
            }
        }
    }
    counts
}

/// The PAM-proximal 12-mer the specificity counts matches of: the spacer's 3' end for SpCas9's 3'
/// PAM, its 5' end for Cas12a's 5' one.
fn seed_bytes(spacer: &str, is_spcas9: bool) -> Vec<u8> {
    let b = spacer.as_bytes();
    if is_spcas9 {
        b[b.len() - 12..].to_vec()
    } else {
        b[..12].to_vec()
    }
}

/// Each guide in the shape `oracle_candidates` returns.
fn as_candidates(guides: &[CrisprGuideRecord]) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = guides
        .iter()
        .map(|g| {
            (
                g.start,
                g.end,
                g.strand,
                g.spacer_seq.clone(),
                g.cut_position,
            )
        })
        .collect();
    out.sort();
    out
}

/// Writes `block` over `seq` starting at the 0-based offset `at`, wrapping past the last base.
fn plant_wrapping(seq: &mut [u8], at: usize, block: &str) {
    let l = seq.len();
    for (k, b) in block.bytes().enumerate() {
        seq[(at + k) % l] = b;
    }
}

// ───────────────────────────── AC1 ─────────────────────────────

/// AC1. A 4,990-bp circular record carrying a 23-base site that straddles its origin and is a
/// candidate on *both* strands, an ordinary site in the middle that shares its seed, an SpCas9 site
/// at the last start of each strand, and a minus-strand site whose seed is the 12 bases that strand
/// opens with. For SpCas9 and for Cas12a the engine's whole candidate set is the exhaustive circular
/// oracle's — positions modulo the record, every start of each strand, nothing twice — with the same
/// candidate count and the same seed count behind every specificity.
///
/// Wrong implementations this reaches: the shipped straight read (it lists none of the origin
/// sites); a wrap of the forward strand alone (it misses the reverse-strand ones); a wrap whose
/// coordinates stay in the extended string (its ends run past base 4,990); a wrap of the candidate
/// search that leaves the seed counting straight (the origin site's own seed is then not counted, so
/// its specificity comes out the wrong way); a circular scan that stops one start, or ten, short of
/// each strand's end (it misses the site at that strand's last start); a seed pass that reads 12
/// bases into the copy of each strand's start instead of 11 (it counts each strand's first 12-mer
/// twice, and the minus strand's is the seed of the site 4,976..8); and the obvious fix of appending
/// the first 22 bases before a straight scan. That fix is run here: modulo the length it finds the
/// oracle's sites, each once, so as a candidate set its fault is placement alone: it puts the sites
/// across the origin past the record's end.
#[test]
fn a_circular_scan_lists_every_guide_across_the_origin_on_both_strands() {
    const LEN: usize = 4_990;
    let mut seq = at_background(LEN, 0x15_6f01);
    // A site that is a candidate on both strands over the same bases: it ends in GG (the plus
    // strand's NGG PAM) and opens with CC, whose complement is the GG of the PAM the minus strand
    // reads over those same bases. Planted across the origin: bases 4,980..4,990 then 1..12.
    let both_strands = format!("CC{}AGG", &SPACER[2..]);
    assert_eq!(both_strands.len(), 23, "an SpCas9 site is 23 bases");
    plant_wrapping(&mut seq, LEN - 11, &both_strands);
    // An ordinary site in the middle, with the same PAM-proximal seed as the one at the origin, so a
    // seed count that does not wrap gets this one's copies and not the origin one's.
    plant(&mut seq, 2_000, &block(SPACER));
    // The last start of each strand, where a circular scan's loop ends. On the plus strand that is
    // base 4,990: GG at bases 21..22 is the PAM of the site 4,990..22. On the minus strand it is the
    // start that reads plus base 1 first: CC at bases 4,969..4,970 is the complement of its PAM's
    // GG, giving the site 4,969..1. A scan that stops one start short of either strand's end, or
    // ten, does not list that strand's site.
    plant(&mut seq, 20, "GG");
    plant(&mut seq, LEN - 22, "CC");
    // A minus-strand site whose seed is the first 12 bases of the minus strand (the complement of
    // bases 4,990 down to 4,979): CC at 4,976..4,977 is the complement of its PAM's GG, and the site
    // is 4,976..8. Each strand's seed pass reads 11 bases into the copy of that strand's start, which
    // is every 12-mer across the origin once; a pass that reads one base further counts this
    // 12-mer, the strand's first, a second time.
    plant(&mut seq, LEN - 15, "CC");
    let text = String::from_utf8(seq.clone()).unwrap();

    // The fixture reaches each of those, by the oracle's own reading of the bases.
    {
        let oracle = oracle_candidates(&seq, true, true);
        let sites = |strand: i8| -> Vec<(usize, usize)> {
            oracle
                .iter()
                .filter(|c| c.2 == strand)
                .map(|c| (c.0, c.1))
                .collect()
        };
        assert!(
            sites(1).contains(&(LEN, 22)),
            "no plus-strand site at that strand's last start, base 4,990: {:?}",
            sites(1)
        );
        assert!(
            sites(-1).contains(&(4_969, 1)),
            "no minus-strand site at that strand's last start, the one that reads plus base 1 first: {:?}",
            sites(-1)
        );
        let minus_opening_12: Vec<u8> = revcomp(&seq)[..12].to_vec();
        assert!(
            oracle
                .iter()
                .any(|c| (c.0, c.1, c.2) == (4_976, 8, -1)
                    && seed_bytes(&c.3, true) == minus_opening_12),
            "no site 4,976..8 whose seed is the minus strand's first 12 bases"
        );
        // That 12-mer occurs once on the circle, as the site's own seed: a count of it that reads
        // the strand's first window twice, in the engine or in the oracle, cannot agree with this.
        assert_eq!(
            oracle_seed_counts(&seq, true)[&minus_opening_12],
            1,
            "the minus strand's opening 12-mer occurs once on the circle"
        );
        // The origin site's own seed crosses the origin (bases 4,988..4,990 then 1..9) and has a
        // copy in the middle, so a count that misses the window across the origin reads it wrong.
        let origin_seed = seed_bytes(&both_strands[..20], true);
        assert_eq!(
            origin_seed,
            SEED.as_bytes(),
            "the origin site's seed is SEED"
        );
        assert_eq!(
            oracle_seed_counts(&seq, true)[&origin_seed],
            2,
            "SEED occurs across the origin and once in the middle"
        );
    }

    for is_spcas9 in [true, false] {
        let nuclease = if is_spcas9 {
            "SpCas9 (NGG)"
        } else {
            "Cas12a / Cpf1 (TTTV)"
        };
        let span = if is_spcas9 { 23usize } else { 24 };
        let oracle = oracle_candidates(&seq, is_spcas9, true);
        let mut once = oracle.clone();
        once.dedup();
        assert_eq!(
            once.len(),
            oracle.len(),
            "{nuclease}: the oracle lists a candidate twice"
        );
        assert!(
            oracle.iter().any(|c| c.0 > c.1),
            "{nuclease}: the fixture holds no site across the origin, so there is nothing to find"
        );
        assert!(
            oracle.iter().any(|c| c.0 <= c.1),
            "{nuclease}: and none inside the record, so a scan that wraps everything would pass"
        );
        for c in &oracle {
            assert!(
                (1..=LEN).contains(&c.0) && (1..=LEN).contains(&c.1) && (1..=LEN).contains(&c.4),
                "{nuclease}: the oracle itself leaves the record at {c:?}"
            );
        }

        // Every candidate is listed, so the sets can be compared whole.
        let scan = scan_crispr_guides(&text, nuclease, oracle.len() + 8, None, true);
        assert_eq!(
            as_candidates(&scan.guides),
            oracle,
            "{nuclease}: the candidates found are not the circular oracle's"
        );
        assert_eq!(
            (
                scan.candidate_count,
                scan.scanned_length_bp,
                scan.sequence_length_bp
            ),
            (oracle.len(), LEN, LEN),
            "{nuclease}: the candidate count is not the oracle's"
        );
        assert_eq!(
            (scan.scanned_circular, scan.origin_span_bp),
            (true, span - 1),
            "{nuclease}: the scan does not report reading the record as a circle"
        );
        assert_eq!(
            scan.warnings,
            Vec::<String>::new(),
            "{nuclease}: nothing was left out"
        );

        // Each candidate's seed matches, counted over the circle.
        let counts = oracle_seed_counts(&seq, true);
        for g in &scan.guides {
            let direct = counts[&seed_bytes(&g.spacer_seq, is_spcas9)];
            assert_eq!(
                g.off_target_count,
                direct - 1,
                "{nuclease}: {} ({}..{} strand {}) counts {} other copies of its seed, the circular oracle {}",
                g.name,
                g.start,
                g.end,
                g.strand,
                g.off_target_count,
                direct - 1
            );
            assert_eq!(
                g.specificity_score,
                (100.0 / (1.0 + g.off_target_count as f64)).round() as i32,
                "{nuclease}: {}'s specificity does not follow its own count",
                g.name
            );
        }

        // The planted site, on both strands, read as the one 23-base site it is: the forward guide
        // is 4,980..12 and cuts after base 6, the reverse one 4,980..12 and cuts after base 4,985.
        if is_spcas9 {
            // The minus strand reads the same 23 bases the other way: its spacer is the site's
            // reverse complement less the GGG its PAM is.
            let minus_spacer: String =
                String::from_utf8(revcomp(both_strands.as_bytes())).unwrap()[..20].to_string();
            assert_eq!(
                oracle
                    .iter()
                    .filter(|c| c.0 == 4_980 && c.1 == 12)
                    .map(|c| (c.2, c.3.clone(), c.4))
                    .collect::<Vec<_>>(),
                vec![
                    (-1i8, minus_spacer, 4_985),
                    (1i8, both_strands[..20].to_string(), 6),
                ],
                "the site at the origin is read on both strands, with its cut inside the record"
            );
        }
    }

    // A bound shorter than the record cannot wrap: bases 1 to the bound are not a circle, so that
    // scan reads the range straight, says which range it read, and claims no origin.
    let bounded = scan_crispr_guides(&text, "SpCas9 (NGG)", 64, Some(LEN - 100), true);
    assert_eq!(
        (bounded.scanned_circular, bounded.origin_span_bp),
        (false, 0),
        "a bound shorter than the record is not a circle"
    );
    assert!(
        bounded
            .warnings
            .iter()
            .any(|w| w.contains("bases 1 to 4,890 of the 4,990")),
        "and it names the range it read: {:?}",
        bounded.warnings
    );
    assert!(
        as_candidates(&bounded.guides).iter().all(|c| c.0 < c.1),
        "a straight range holds no site across the origin: {:?}",
        as_candidates(&bounded.guides)
    );

    // ── The obvious fix: append the first 22 bases and scan the string straight. ──
    //
    // It finds the right sites. A straight scan of the 5,012 bases starts at each of the first 4,990,
    // which on the plus strand is every start of the circle once. Its minus strand is the reverse
    // complement of the longer string: the record's own minus strand read from 22 bases before that
    // strand's end, so it too starts at every minus start of the circle once, the ones across the
    // origin included. Taken modulo the length, its candidate set is the oracle's, with no site twice.
    //
    // As a candidate set, then, its one fault is placement. It reports a site across the origin where
    // that site sits in the longer string, ending past base 4,990, a base the record does not have,
    // where the oracle reads start > end inside 1..4,990. That is asserted directly: the sites it
    // places past the end are exactly the oracle's sites across the origin, and every other site is
    // where the oracle puts it.
    let spcas9_oracle = oracle_candidates(&seq, true, true);
    let appended = format!("{text}{}", &text[..22]);
    let naive = scan_crispr_guides(
        &appended,
        "SpCas9 (NGG)",
        spcas9_oracle.len() + 8,
        None,
        false,
    );
    let naive_set = as_candidates(&naive.guides);
    assert_eq!(
        naive.candidate_count,
        naive_set.len(),
        "every candidate of the appended scan is listed"
    );
    let on_record = |p: usize| (p - 1) % LEN + 1;
    let fold = |c: &Candidate| -> Candidate {
        (
            on_record(c.0),
            on_record(c.1),
            c.2,
            c.3.clone(),
            on_record(c.4),
        )
    };
    let mut folded: Vec<Candidate> = naive_set.iter().map(fold).collect();
    folded.sort();
    assert_eq!(
        folded, spcas9_oracle,
        "modulo the length, the appended scan's sites are the circular oracle's, each once"
    );
    let (past_end, inside): (Vec<Candidate>, Vec<Candidate>) = naive_set
        .iter()
        .cloned()
        .partition(|c| c.0 > LEN || c.1 > LEN || c.4 > LEN);
    let across: Vec<Candidate> = spcas9_oracle
        .iter()
        .filter(|c| c.0 > c.1)
        .cloned()
        .collect();
    assert!(
        across.iter().any(|c| c.2 == 1) && across.iter().any(|c| c.2 == -1),
        "the fixture has origin sites on both strands for the appended scan to place: {across:?}"
    );
    let mut past_end_folded: Vec<Candidate> = past_end.iter().map(fold).collect();
    past_end_folded.sort();
    assert_eq!(
        past_end_folded, across,
        "the sites the appended scan places past base 4,990 are not exactly the sites across the origin"
    );
    for c in &past_end {
        assert!(
            c.0 <= LEN && c.0 < c.1 && c.1 > LEN && c.1 <= LEN + 22,
            "{c:?} is not read straight in the longer string, ending past base 4,990"
        );
    }
    assert_eq!(
        inside,
        spcas9_oracle
            .iter()
            .filter(|c| c.0 <= c.1)
            .cloned()
            .collect::<Vec<_>>(),
        "every site inside the record is placed where the oracle places it"
    );
    assert_ne!(
        naive_set, spcas9_oracle,
        "so the set it reports is not the circular scan's"
    );
    // Its seed counts are a separate matter. Its seed pass reads the longer string straight too, so
    // each strand's 11 12-mers inside bases 1..22 are counted twice. The seed of the plus strand's
    // last-start site, bases 8..19, is one of them: that guide reports one more copy of its seed than
    // the circle holds. No other guide's seed is among those 12-mers here, so every other count is
    // the circle's.
    let circle_counts = oracle_seed_counts(&seq, true);
    let miscounted: Vec<(usize, usize, i8, isize)> = naive
        .guides
        .iter()
        .filter_map(|g| {
            let circle = circle_counts[&seed_bytes(&g.spacer_seq, true)] - 1;
            let excess = g.off_target_count as isize - circle as isize;
            (excess != 0).then_some((g.start, g.end, g.strand, excess))
        })
        .collect();
    assert_eq!(
        miscounted,
        vec![(LEN, LEN + 22, 1i8, 1isize)],
        "the appended scan's seed counts differ from the circle's only at the plus strand's last start, by the one copy it reads twice"
    );
}

// ───────────────────────────── AC2 ─────────────────────────────

/// AC2. A linear record whose only SpCas9 candidate on each strand ends at that strand's last base:
/// the forward one at 978..1,000, the reverse one at 1..23. Both sit at start `len - 23`, the start
/// the engine's `0..=(len - 24)` bound never examined, so both were missing.
///
/// A linear record also gains nothing across its ends: the scan is the linear oracle's exactly, and
/// no candidate spans base 1 and the last base. That claim is not vacuous here — the same bases read
/// as a circle do hold a site across the junction, and the linear scan must not list it.
#[test]
fn a_linear_scan_reads_the_last_start_of_each_strand_and_nothing_across_its_ends() {
    const LEN: usize = 1_000;
    let mut seq = at_background(LEN, 0x15_6f1b);
    // CC at bases 1..2: on the minus strand those are the GG of a PAM, giving the reverse-strand
    // candidate that covers bases 23..1 and ends at that strand's last base.
    plant(&mut seq, 0, "CC");
    // GG at bases 999..1,000: the PAM of the forward candidate that ends at the last base.
    plant(&mut seq, LEN - 2, "GG");
    // GG at bases 3..4: a PAM whose own site starts 20 bases before base 2 — only a circle has
    // those bases, so that candidate exists across the junction and nowhere else.
    plant(&mut seq, 2, "GG");
    let text = String::from_utf8(seq.clone()).unwrap();

    let oracle = oracle_candidates(&seq, true, false);
    assert_eq!(
        oracle.iter().map(|c| (c.0, c.1, c.2)).collect::<Vec<_>>(),
        vec![(1, 23, -1i8), (978, 1_000, 1i8)],
        "the fixture's only linear candidates are one per strand, each ending at that strand's last base"
    );
    assert!(
        oracle.iter().all(|c| c.0 < c.1),
        "and neither of them spans base 1 and base 1,000"
    );

    let scan = scan_crispr_guides(&text, "SpCas9 (NGG)", 64, None, false);
    assert_eq!(
        as_candidates(&scan.guides),
        oracle,
        "the linear scan is not the linear oracle's candidate set"
    );
    assert_eq!(
        (
            scan.candidate_count,
            scan.scanned_circular,
            scan.origin_span_bp
        ),
        (2, false, 0),
        "a linear record is not read as a circle"
    );
    let counts = oracle_seed_counts(&seq, false);
    for g in &scan.guides {
        assert_eq!(
            g.off_target_count,
            counts[&seed_bytes(&g.spacer_seq, true)] - 1,
            "{}: its seed count is not the straight-read count",
            g.name
        );
    }

    // The same bases as a circle: the junction site is there, and the linear scan listed none of it.
    let linear_set = as_candidates(&scan.guides);
    let circular = scan_crispr_guides(&text, "SpCas9 (NGG)", 64, None, true);
    let across: Vec<Candidate> = as_candidates(&circular.guides)
        .into_iter()
        .filter(|c| c.0 > c.1)
        .collect();
    assert_eq!(
        across,
        oracle_candidates(&seq, true, true)
            .into_iter()
            .filter(|c| c.0 > c.1)
            .collect::<Vec<_>>(),
        "the circular scan's sites across the junction are not the oracle's"
    );
    assert!(
        !across.is_empty(),
        "the fixture holds no site across the junction, so the linear claim proves nothing"
    );
    for c in &across {
        assert!(
            !linear_set.contains(c),
            "the linear scan lists {c:?}, a site that exists only across its ends"
        );
    }
}

// ───────────────────────────── BG-01M6TGKG AC1 ─────────────────────────────

/// BG-01M6TGKG AC1. The circular scan's last start, read for Cas12a. A Cas12a site is 24 bases,
/// one more than SpCas9's 23, so the copy of each strand's start that lets a window run off the
/// last base has to be `span - 1` bases of *that* nuclease's span. A hard-coded 22 — SpCas9's copy
/// — leaves the window at a strand's last start one base short of the bases it reads, and the AC1
/// fixture above never asks for it: its only sites at a strand's last start are SpCas9's, because
/// the origin site there fixes the bases a `T T T V` PAM would need.
///
/// One record cannot carry a Cas12a site at *both* strands' last starts. The plus strand's last
/// window opens `T T T` over bases l, 1 and 2; the minus strand's opens over the complements of
/// bases 1, l and l - 1, so the same base 1 would have to be T and A at once. Each strand's last
/// start therefore gets its own circular record here.
///
/// Wrong implementations this reaches: a circular scan that stops one start, or ten, short of each
/// strand's end (it lists no site at that strand's last start); and a wrap that copies a fixed 22
/// bases of the start instead of `span - 1` (reading a 24-base Cas12a window at the last start
/// then runs off the copy).
#[test]
fn a_circular_cas12a_scan_reads_the_last_start_of_each_strand() {
    const LEN: usize = 300;
    const NUCLEASE: &str = "Cas12a / Cpf1 (TTTV)";

    // The whole record read as a circle: the candidate set is the exhaustive circular oracle's, and
    // `wanted` — the site at the strand's last start, which crosses the origin — is in it.
    let read_whole = |seq: &[u8], wanted: (usize, usize, i8), what: &str| {
        let text = String::from_utf8(seq.to_vec()).unwrap();
        let oracle = oracle_candidates(seq, false, true);
        let triples = |cs: &[Candidate]| -> Vec<(usize, usize, i8)> {
            cs.iter().map(|c| (c.0, c.1, c.2)).collect()
        };
        assert!(
            wanted.0 > wanted.1,
            "{what}: {wanted:?} does not cross the origin, so it is not at the last start"
        );
        assert!(
            triples(&oracle).contains(&wanted),
            "{what}: the fixture holds no Cas12a site at {wanted:?}, so there is nothing to find: {:?}",
            triples(&oracle)
        );

        let scan = scan_crispr_guides(&text, NUCLEASE, oracle.len() + 8, None, true);
        let found = as_candidates(&scan.guides);
        assert!(
            triples(&found).contains(&wanted),
            "{what}: the scan does not list the site at that strand's last start, {wanted:?}: {:?}",
            triples(&found)
        );
        assert_eq!(
            found, oracle,
            "{what}: the candidates found are not the circular oracle's"
        );
        assert_eq!(
            (
                scan.candidate_count,
                scan.scanned_length_bp,
                scan.scanned_circular,
                scan.origin_span_bp
            ),
            (oracle.len(), LEN, true, 23),
            "{what}: the scan does not report reading all {LEN} bases as a circle"
        );
        assert_eq!(
            scan.warnings,
            Vec::<String>::new(),
            "{what}: nothing was left out"
        );
    };

    // The plus strand's last start, base 300: `T T T C` over bases 300, 1, 2 and 3 is the PAM of
    // the site 300..23, whose 20 spacer bases are bases 4 to 23.
    let mut plus = at_background(LEN, 0x15_6f2d);
    plant_wrapping(&mut plus, LEN - 1, "TTTC");
    read_whole(&plus, (LEN, 23, 1), "the plus strand's last start");

    // The minus strand's last start, the one that reads plus base 1 first: that strand opens with
    // the complements of bases 1, 300 and 299, so `A A A` over those three is its `T T T`, and base
    // 298 = G completes the PAM as a C. The site is 278..1 on the minus strand.
    let mut minus = at_background(LEN, 0x15_6f3b);
    plant(&mut minus, 0, "A");
    plant(&mut minus, LEN - 3, "GAA");
    read_whole(&minus, (LEN - 22, 1, -1), "the minus strand's last start");
}

// ───────────────────────────── BG-01M6TGKG AC2 ─────────────────────────────

/// BG-01M6TGKG AC2. The closing edge of the circular seed window. Reading a circle, the seed pass
/// counts matches over each strand followed by 11 bases of its own start, which is every 12-mer
/// that crosses the origin and no 12-mer twice. The last two of those windows open at the record's
/// last base and the one before it, so a pass that reads one base less into the copy, or two, drops
/// them — and the AC1 fixture above holds no candidate whose seed is either, so it only catches an
/// under-read of four bases or more.
///
/// Here each of the two closing 12-mers is the PAM-proximal seed of a site planted in the middle of
/// the record, and exactly one copy of each crosses the origin. Reading one base less into the copy
/// therefore makes the guide seeded by the 12-mer at the last base count one copy too few, and two
/// bases less makes the other one wrong as well.
#[test]
fn a_circular_seed_count_reads_the_closing_12_mers_across_the_origin() {
    const LEN: usize = 400;
    let mut seq = at_background(LEN, 0x15_6f4d);
    let closing =
        |seq: &[u8], from: usize| -> Vec<u8> { (0..12).map(|k| seq[(from + k) % LEN]).collect() };
    // The record's last two 12-mers: bases 400 then 1..11, and bases 399, 400 then 1..10.
    let last = closing(&seq, LEN - 1);
    let last_but_one = closing(&seq, LEN - 2);
    assert_ne!(
        last, last_but_one,
        "the two closing 12-mers are the same, so one planted site would pin both"
    );
    // A mid-record SpCas9 site for each: eight bases of its own, then the 12-mer as the site's
    // PAM-proximal seed, then an NGG PAM. The background is A and T alone, so it spells no NGG and
    // no CC, and these two planted sites are the record's only candidates on either strand.
    let site = |seed: &[u8]| format!("ATATATAT{}AGG", String::from_utf8(seed.to_vec()).unwrap());
    plant(&mut seq, 150, &site(&last));
    plant(&mut seq, 250, &site(&last_but_one));
    assert_eq!(
        (closing(&seq, LEN - 1), closing(&seq, LEN - 2)),
        (last.clone(), last_but_one.clone()),
        "planting in the middle moved the closing 12-mers"
    );
    let text = String::from_utf8(seq.clone()).unwrap();

    let oracle = oracle_candidates(&seq, true, true);
    assert_eq!(
        oracle.iter().map(|c| (c.0, c.1, c.2)).collect::<Vec<_>>(),
        vec![(151, 173, 1i8), (251, 273, 1i8)],
        "the fixture's only candidates are the two planted mid-record sites"
    );
    let circle = oracle_seed_counts(&seq, true);
    let straight = oracle_seed_counts(&seq, false);
    for (seed, which) in [
        (&last, "the 12-mer that opens at base 400"),
        (&last_but_one, "the 12-mer that opens at base 399"),
    ] {
        assert_eq!(
            circle[seed],
            straight.get(seed).copied().unwrap_or(0) + 1,
            "{which} has one copy across the origin and no other, or the seed pass has nothing to miss"
        );
    }

    let scan = scan_crispr_guides(&text, "SpCas9 (NGG)", oracle.len() + 8, None, true);
    assert_eq!(
        as_candidates(&scan.guides),
        oracle,
        "the candidates found are not the circular oracle's"
    );
    for (seed, start, which) in [
        (&last, 151usize, "base 400"),
        (&last_but_one, 251usize, "base 399"),
    ] {
        let guide = scan
            .guides
            .iter()
            .find(|g| g.start == start)
            .unwrap_or_else(|| {
                panic!("no guide at {start}, the site seeded by the 12-mer at {which}")
            });
        assert_eq!(
            seed_bytes(&guide.spacer_seq, true),
            *seed,
            "the guide at {start} is not seeded by the 12-mer that opens at {which}"
        );
        assert_eq!(
            guide.off_target_count,
            circle[seed] - 1,
            "{}: it counts {} other copies of the 12-mer that opens at {which}, the circular oracle {}",
            guide.name,
            guide.off_target_count,
            circle[seed] - 1
        );
        assert_eq!(
            guide.specificity_score,
            (100.0 / (1.0 + guide.off_target_count as f64)).round() as i32,
            "{}'s specificity does not follow its own count",
            guide.name
        );
    }
}


// ───────────── US-01M7DV29: each preset's own site rule, cut convention and ambiguity ─────────────
//
// The engine used to pick its model with `!nuclease.contains("Cas12a")`, so every unknown name was
// scanned by SpCas9's rule and labelled "SpCas9 (NGG)". The presets below are read as the facts they
// are: the PAM on its own side of the spacer, the spacer's length, and where the cut falls by the
// convention the record names (D0131).
//
// Every fixture holds A and T only but for the site planted in it, so the candidate list is known
// exactly and a rule read off the wrong side of the spacer has nowhere to hide.

/// A 20-nt spacer free of GG and CC: one candidate per planted site, and no accidental PAM.
const SPACER20: &str = "GACGTTACCGATTGCAATCG";

/// The one guide of `scan`, or a panic naming what came back instead.
fn only_guide(scan: &molbiocraft_cloning::cloning_crispr::CrisprGuideScan) -> &CrisprGuideRecord {
    assert_eq!(
        scan.guides.len(),
        1,
        "one site was planted; the scan returned {} guides and {} candidates, warnings {:?}",
        scan.guides.len(),
        scan.candidate_count,
        scan.warnings
    );
    &scan.guides[0]
}

#[test]
fn us_01m7dv29_ac3_spcas9_reads_its_spacer_pam_and_blunt_cut_on_both_strands() {
    // 5' ... TTTTT [spacer 20] AGG TTTTT ... 3': the spacer at 6..25, its PAM at 26..28.
    let seq = format!("TTTTT{SPACER20}AGGTTTTT");
    let preset = resolve_nuclease_preset("SpCas9 (NGG)").expect("a supported preset");
    assert_eq!(
        (preset.pam_side.as_str(), preset.pam_pattern.as_str(), preset.spacer_length_bp, preset.site_span_bp),
        ("3'", "NGG", 20, 23)
    );

    let scan = scan_crispr_guides(&seq, "SpCas9 (NGG)", 25, None, false);
    let g = only_guide(&scan);
    // The spacer is the 20 bases 5' of the PAM, and the PAM is those three bases.
    assert_eq!(g.spacer_seq, SPACER20);
    assert_eq!(g.pam_seq, "AGG");
    assert_eq!(&seq[g.start - 1..g.start - 1 + 20], SPACER20);
    assert_eq!(&seq[g.start + 19..g.start + 22], "AGG");
    assert_eq!((g.start, g.end, g.strand), (6, 28, 1));
    // Blunt, 3 bp 5' of the PAM: the cut follows base 22, between spacer nt 17 and nt 18.
    assert_eq!(g.cut_position, 22);
    assert_eq!(g.cut_position, g.start + 20 - 1 - 3, "3 bp 5' of the PAM");
    assert_eq!(g.cut_position_target_strand, None, "SpCas9 cuts bluntly, so there is no second cut");
    assert!(
        g.cut_convention.contains("Blunt") && g.cut_convention.contains("nt 17 and nt 18"),
        "{}",
        g.cut_convention
    );
    assert_eq!((g.nuclease.as_str(), g.pam_side.as_str()), ("SpCas9 (NGG)", "3'"));

    // The same site read on the reverse strand: the mirrored base, by the same rule.
    let rc = molbiocraft_core::reverse_complement_iupac(&seq, false);
    let rscan = scan_crispr_guides(&rc, "SpCas9 (NGG)", 25, None, false);
    let r = only_guide(&rscan);
    assert_eq!((r.spacer_seq.as_str(), r.pam_seq.as_str(), r.strand), (SPACER20, "AGG", -1));
    assert_eq!(r.cut_position, seq.len() - 22, "the plus-strand coordinate of the mirrored cut");
    assert_eq!(r.cut_position_target_strand, None);
}

#[test]
fn us_01m7dv29_ac4_cas12a_reads_its_five_prime_pam_and_both_staggered_cuts() {
    // 5' ... TTTTT TTTA [spacer 20] TTTTT ... 3': the PAM at 6..9, the spacer at 10..29.
    let seq = format!("TTTTTTTTA{SPACER20}TTTTT");
    let preset = resolve_nuclease_preset("Cas12a / Cpf1 (TTTV)").expect("a supported preset");
    assert_eq!(
        (preset.pam_side.as_str(), preset.pam_pattern.as_str(), preset.spacer_length_bp, preset.site_span_bp),
        ("5'", "TTTV", 20, 24)
    );

    let scan = scan_crispr_guides(&seq, "Cas12a / Cpf1 (TTTV)", 25, None, false);
    let g = only_guide(&scan);
    // The PAM is the four TTTV bases 5' of the spacer, and the spacer the 20 bases that follow.
    assert_eq!(g.pam_seq, "TTTA");
    assert_eq!(g.spacer_seq, SPACER20);
    assert_eq!(&seq[g.start - 1..g.start + 3], "TTTA");
    assert_eq!(&seq[g.start + 3..g.start + 23], SPACER20);
    assert_eq!((g.start, g.end, g.strand), (6, 29, 1));
    // The reported cut is the PAM strand's, after spacer nt 18: site base 22, record base 27.
    // The site's PAM is 4 bases, so spacer nt 18 is the record's base `start + 4 + 18 - 1`.
    assert_eq!(g.cut_position, g.start + 4 + 18 - 1, "after spacer nt 18 on the PAM strand");
    assert_eq!(g.cut_position, 27);
    // The staggered target-strand cut is a field of its own, after spacer nt 23 - five bases on.
    assert_eq!(g.cut_position_target_strand, Some(32));
    assert_eq!(
        g.cut_position_target_strand.unwrap() - g.cut_position,
        5,
        "a 5-nt 5' overhang"
    );
    // And it is labelled as the convention it is, not as a measured value.
    assert!(
        g.cut_convention.contains("Staggered")
            && g.cut_convention.contains("5-nt 5' overhang")
            && g.cut_convention.contains("AsCas12a/LbCas12a")
            && g.cut_convention.contains("not a measured value"),
        "{}",
        g.cut_convention
    );
    assert_eq!((g.nuclease.as_str(), g.pam_side.as_str()), ("Cas12a / Cpf1 (TTTV)", "5'"));
    // The PAM is not read off SpCas9's side: the same bases hold no SpCas9 candidate at all.
    assert_eq!(
        scan_crispr_guides(&seq, "SpCas9 (NGG)", 25, None, false).candidate_count,
        0,
        "the Cas12a fixture spells no NGG, so a scan by SpCas9's rule finds nothing"
    );
}

#[test]
fn us_01m7dv29_ac5_ambiguity_is_screened_where_the_pam_constrains_it_and_marked_where_it_does_not() {
    // A spacer holding one N: no guide, and the window is not a candidate.
    let ambiguous_spacer = format!("TTTTT{}NAGGTTTTT", &SPACER20[..19]);
    let spacer_scan = scan_crispr_guides(&ambiguous_spacer, "SpCas9 (NGG)", 25, None, false);
    assert_eq!(
        (spacer_scan.guides.len(), spacer_scan.candidate_count),
        (0, 0),
        "a spacer base that is not A, C, G or T cannot be scored or counted"
    );

    // A constrained PAM base as an ambiguity letter: not a PAM match. SpCas9's PAM constrains its
    // last two bases, so an ambiguity letter in either is no match. None of these planted PAMs
    // spells a `GG` of its own, so the fixture holds no other candidate to be found instead.
    for pam in ["AGN", "ANG", "NNN"] {
        let seq = format!("TTTTT{SPACER20}{pam}TTTTT");
        let scan = scan_crispr_guides(&seq, "SpCas9 (NGG)", 25, None, false);
        assert_eq!(
            (scan.guides.len(), scan.candidate_count),
            (0, 0),
            "{pam} does not match NGG's constrained G G"
        );
    }
    // Cas12a's PAM constrains all four of its bases.
    for pam in ["TTTN", "TTNA", "NTTA"] {
        let seq = format!("TTTTT{pam}{SPACER20}TTTTT");
        let scan = scan_crispr_guides(&seq, "Cas12a / Cpf1 (TTTV)", 25, None, false);
        assert_eq!(
            (scan.guides.len(), scan.candidate_count),
            (0, 0),
            "{pam} does not match TTTV's constrained bases"
        );
    }

    // A region of nothing but such bases is reported as searched, with 0 candidates: an absence of
    // candidates in unreadable bases is not an absence of sites.
    let unreadable = "N".repeat(200);
    let scan = scan_crispr_guides(&unreadable, "SpCas9 (NGG)", 25, None, false);
    assert_eq!(
        (scan.candidate_count, scan.scanned_length_bp, scan.sequence_length_bp),
        (0, 200, 200),
        "the range was read; it holds no candidate"
    );
    assert_eq!(scan.guides.len(), 0);
    assert_eq!(scan.warnings, Vec::<String>::new(), "a region read whole warns about nothing");

    // An ambiguity letter where the PAM is unconstrained - SpCas9's first base - is returned, and
    // the record marks it, so the N is never shown as a confirmed base.
    let unconstrained = format!("TTTTT{SPACER20}NGGTTTTT");
    let scan = scan_crispr_guides(&unconstrained, "SpCas9 (NGG)", 25, None, false);
    let g = only_guide(&scan);
    assert_eq!(g.pam_seq, "NGG");
    let note = g
        .pam_ambiguity_note
        .as_deref()
        .expect("the N in the PAM is marked");
    assert!(
        note.contains("N at PAM position 1") && note.contains("not known"),
        "{note}"
    );
    // A PAM read base by base carries no such mark.
    let plain = scan_crispr_guides(&format!("TTTTT{SPACER20}AGGTTTTT"), "SpCas9 (NGG)", 25, None, false);
    assert_eq!(only_guide(&plain).pam_ambiguity_note, None);
}

#[test]
fn us_01m7dv29_ac3_every_preset_is_scanned_by_its_own_rule() {
    // Each fixture holds one planted site of its own nuclease. The flanks alternate A and C, so
    // neither strand spells a run of three T - and so no second site of either nuclease is planted
    // by accident; an incidental site elsewhere in the bases is not what this check is about, so it
    // asks about the planted spacer itself.
    let sites = [
        ("SpCas9 (NGG)", format!("ACACA{SPACER20}AGGACACA")),
        ("Cas12a / Cpf1 (TTTV)", format!("ACACATTTA{SPACER20}ACACA")),
    ];
    for preset in supported_nuclease_presets() {
        for (owner, seq) in &sites {
            let scan = scan_crispr_guides(seq, &preset.id, 25, None, false);
            let planted: Vec<&CrisprGuideRecord> = scan
                .guides
                .iter()
                .filter(|g| g.spacer_seq == SPACER20)
                .collect();
            if &preset.id == owner {
                assert_eq!(planted.len(), 1, "{} on its own site: {:?}", preset.id, scan.guides);
                let g = planted[0];
                assert_eq!(g.nuclease, preset.id);
                assert_eq!(g.pam_side, preset.pam_side);
                assert_eq!(g.pam_pattern, preset.pam_pattern);
                assert_eq!(g.spacer_seq.len(), preset.spacer_length_bp);
                assert_eq!(
                    g.end + 1 - g.start,
                    preset.site_span_bp,
                    "{} site span",
                    preset.id
                );
                assert_eq!(
                    g.cut_position_target_strand.is_some(),
                    preset.cut_convention.contains("Staggered"),
                    "{}: a staggered cut carries its second coordinate and a blunt one does not",
                    preset.id
                );
            } else {
                assert!(
                    planted.is_empty(),
                    "{} reported the {owner} site as its own: {:?}",
                    preset.id,
                    planted
                );
            }
        }
    }
}

fn revcomp_acgt(s: &str) -> String {
    s.bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            b'T' => 'A',
            other => other as char,
        })
        .collect()
}

#[test]
fn us_01m7dv29_ac4_a_target_strand_cut_past_a_linear_end_has_no_position() {
    // The Cas12a site ends the molecule: 5' TTTTT TTTA [spacer 20] 3', 29 bases. Its target-strand
    // cut, after spacer nt 23, is site base 27, record base 32 - past the end of a linear molecule.
    let seq = format!("TTTTTTTTA{SPACER20}");
    assert_eq!(seq.len(), 29);
    let scan = scan_crispr_guides(&seq, "Cas12a / Cpf1 (TTTV)", 25, None, false);
    let g = only_guide(&scan);
    assert_eq!((g.start, g.end, g.strand), (6, 29, 1));
    assert_eq!(g.cut_position, 27, "the PAM-strand cut still falls inside the molecule");
    assert_eq!(
        g.cut_position_target_strand, None,
        "a cut past the end of a linear molecule is never wrapped to its start"
    );
    assert!(
        g.cut_position_target_strand_note
            .as_deref()
            .is_some_and(|n| n.contains("past the end")),
        "and the row says why it has no position: {:?}",
        g.cut_position_target_strand_note
    );

    // The same site read on the reverse strand of the reverse-complemented molecule sits at its
    // start, plus 1..24, and its target-strand cut lies before base 1: again no position.
    let rev = revcomp_acgt(&seq);
    let scan = scan_crispr_guides(&rev, "Cas12a / Cpf1 (TTTV)", 25, None, false);
    let g = only_guide(&scan);
    assert_eq!(g.strand, -1);
    assert_eq!((g.start.min(g.end), g.start.max(g.end)), (1, 24), "the site at plus 1..24");
    assert_eq!(g.cut_position_target_strand, None, "never wrapped to the far end");
    assert!(g.cut_position_target_strand_note.is_some());

    // A blunt cutter has neither a second coordinate nor a note.
    let sp = format!("{SPACER20}TGG");
    let scan = scan_crispr_guides(&sp, "SpCas9 (NGG)", 25, None, false);
    for g in &scan.guides {
        assert_eq!(g.cut_position_target_strand, None);
        assert_eq!(g.cut_position_target_strand_note, None);
    }
}

#[test]
fn us_01m7dv29_ac4_a_circle_read_whole_wraps_the_target_strand_cut_across_its_origin() {
    // The same 29 bases as a circle read whole: base 32 is base 3 across the origin.
    let seq = format!("TTTTTTTTA{SPACER20}");
    let scan = scan_crispr_guides(&seq, "Cas12a / Cpf1 (TTTV)", 25, None, true);
    let g = scan
        .guides
        .iter()
        .find(|g| g.strand == 1 && g.start == 6)
        .expect("the forward site at 6");
    assert!(scan.scanned_circular, "a circle read whole");
    assert_eq!(g.cut_position_target_strand, Some(3), "32 taken round a 29-base circle");
    assert_eq!(g.cut_position_target_strand_note, None);
}

// ───────────────── BG-01M7E69W: the guards over the heuristic rank, made able to fail ─────────────────

/// A 20-nt spacer the scorer raises every way it can: 40 % GC (8 of 20), a G at position 20, a C at
/// position 16 and an A at position 4, no TTTT run — 68 + 14 + 8 + 5 + 3 = 98, the stated ceiling.
/// It holds no `GG` and no `CC`, so planting it adds no PAM of its own on either strand.
const RANK_98_SPACER: &str = "ACAACACACACACAACAAAG";
/// `RANK_98_SPACER`'s PAM-proximal 12-mer, the seed SpCas9 counts matches of. A second bare copy of
/// it is planted in the A/T background, which gives it one other exact copy and no new candidate.
const RANK_98_SEED: &str = "CACACAACAAAG";
/// A second spacer the scorer raises every way but one: a C at position 4 rather than an A or a G,
/// so it misses that +3 and scores 95. 45 % GC (9 of 20), so it is inside the same band; still
/// `GG`/`CC`-free, and its own seed appears nowhere else in the fixture.
const RANK_95_SPACER: &str = "ACACACACACACACACAAAG";
/// `RANK_95_SPACER`'s PAM-proximal 12-mer.
const RANK_95_SEED: &str = "ACACACACAAAG";

/// Two planted SpCas9 guides whose rank and whose seed count disagree about which is the better
/// guide: the 98 has one other copy of its seed (specificity 50) and the 95 has none (100), so the
/// list the engine returns is 95-then-98 by the rank plus the seed score, and 98-then-95 by the rank
/// alone. The background is A and T only, so the two planted PAMs are the only ones in it.
fn rank_and_seed_disagree_fixture() -> String {
    let mut seq = at_background(600, 0x5EED_0F01);
    plant(&mut seq, 100, &block(RANK_98_SPACER));
    plant(&mut seq, 300, &block(RANK_95_SPACER));
    // A bare second copy of the 98's seed: 12 bases with no `GG` and no `CC`, so it is a seed match
    // and not a candidate guide.
    plant(&mut seq, 500, RANK_98_SEED);
    String::from_utf8(seq).expect("ASCII bases")
}

/// BG-01M7E69W AC2: the guide list is ordered by the heuristic rank **plus** the seed-match score —
/// the claim the plugin, the studio callout and the rank description all make — checked over a
/// fixture in which the two formulas disagree.
///
/// US-01M7DVVR's order assertion ran over the pET-28a sample library, where every listed guide has
/// `specificity_score == 100`, so the sum it read was a constant 100 above the rank and the oracle
/// could not tell the two formulas apart: mutating the sort key from `on_t + spec` to `on_t`
/// survived it. The fixture here plants that disagreement — and states it as a precondition, so a
/// fixture that later loses it fails loudly instead of passing vacuously (LC-002).
///
/// Wrong implementations this kills: `score: on_t` in `scan_crispr_guides`'s pass 3 (the rank
/// alone), and any sort key that ignores the seed term or reverses the order.
#[test]
fn bg_01m7e69w_ac2_the_guide_list_is_ordered_by_the_rank_plus_the_seed_match_score() {
    let seq = rank_and_seed_disagree_fixture();

    // ── The fixture, checked by a direct search of both strands rather than by the engine. ──
    assert_eq!(
        direct_seed_hits(seq.as_bytes(), seq.len(), RANK_98_SEED),
        2,
        "the 98's seed must have one other exact copy, or its specificity is not 50"
    );
    assert_eq!(
        direct_seed_hits(seq.as_bytes(), seq.len(), RANK_95_SEED),
        1,
        "the 95's seed must be unique, or its specificity is not 100"
    );

    let scan = scan_crispr_guides(&seq, "SpCas9 (NGG)", usize::MAX, None, false);
    assert_eq!(
        scan.guides.len(),
        scan.candidate_count,
        "every candidate is listed, so the order read here is the whole of it"
    );
    assert_eq!(scan.guides.len(), 2, "the A/T background plants exactly the two guides: {:?}",
        scan.guides.iter().map(|g| g.spacer_seq.clone()).collect::<Vec<_>>());

    // ── Precondition: the fixture can reach the wrong implementation. ──
    let specificities: Vec<i32> = scan.guides.iter().map(|g| g.specificity_score).collect();
    let distinct: std::collections::BTreeSet<i32> = specificities.iter().copied().collect();
    assert!(
        distinct.len() >= 2,
        "at least two listed guides must differ in specificity_score, or this order check cannot \
         tell the rank from the rank plus the seed score: {specificities:?}"
    );
    // And they disagree by more than the ranks do: ordering these same guides by the rank alone —
    // the engine's own total order with the seed term dropped — breaks the order asserted below.
    let mut by_rank_alone = scan.guides.clone();
    by_rank_alone.sort_by(|a, b| {
        b.on_target_score
            .cmp(&a.on_target_score)
            .then_with(|| a.start.cmp(&b.start))
            .then_with(|| b.strand.cmp(&a.strand))
    });
    let mutant_keys: Vec<i32> = by_rank_alone
        .iter()
        .map(|g| g.on_target_score + g.specificity_score)
        .collect();
    assert!(
        !mutant_keys.windows(2).all(|w| w[0] >= w[1]),
        "the rank alone orders this fixture the same way as the rank plus the seed score, so the \
         assertion below cannot kill `score: on_t`: {mutant_keys:?}"
    );

    // ── The order the engine actually returns. ──
    let keys: Vec<i32> = scan
        .guides
        .iter()
        .map(|g| g.on_target_score + g.specificity_score)
        .collect();
    assert!(
        keys.windows(2).all(|w| w[0] >= w[1]),
        "the guides are not in the order every surface claims — the rank plus the seed-match \
         score, best first: {keys:?}"
    );

    // ── Named, so the numbers behind the order are legible. ──
    let by_spacer = |spacer: &str| -> &CrisprGuideRecord {
        scan.guides
            .iter()
            .find(|g| g.spacer_seq == spacer)
            .unwrap_or_else(|| panic!("the planted spacer {spacer} is listed"))
    };
    let high_rank = by_spacer(RANK_98_SPACER);
    let high_specificity = by_spacer(RANK_95_SPACER);
    assert_eq!(
        (high_rank.on_target_score, high_rank.specificity_score, high_rank.off_target_count),
        (98, 50, 1),
        "the 98-ranked guide has one other seed copy"
    );
    assert_eq!(
        (
            high_specificity.on_target_score,
            high_specificity.specificity_score,
            high_specificity.off_target_count
        ),
        (95, 100, 0),
        "the 95-ranked guide has none"
    );
    assert_eq!(
        scan.guides[0].spacer_seq, RANK_95_SPACER,
        "the lower rank with the unique seed is listed first, because 95 + 100 beats 98 + 50"
    );
}

/// BG-01M7E69W AC1: the rank's floor is clamped and its ceiling is arithmetic.
///
/// `score_guide` had `clamp(RANGE.0, RANGE.1)`, whose upper arm could never fire: the scorer's
/// maximum raw score is 68 + 14 (GC inside 40–65 %) + 8 (G at position 20) + 5 (C at position 16)
/// + 3 (A or G at position 4) = 98, and the stated ceiling is 98 too, so a reviewer's
/// `.clamp(RANGE.0, 1000)` passed every criterion BG-01M7E61C added. The dead arm is gone (LC-008)
/// and this test records which of the two arms was load-bearing: the floor, which turns the worst
/// spacer's 5 raw into the stated 8, and no ceiling, which nothing needs because no spacer scores
/// above it.
///
/// Wrong implementations this kills: any raise or base the scorer grows past the stated ceiling,
/// which the removed arm used to cap silently (e.g. the GC raise at +24, which reports 108); and a
/// floor removed or moved, which reports the worst spacer as its raw 5.
#[test]
fn bg_01m7e69w_ac1_the_rank_floor_is_clamped_and_its_ceiling_is_the_arithmetic() {
    let (lo, hi) = CRISPR_HEURISTIC_RANK_RANGE;
    // The arithmetic the removal rests on, written out.
    assert_eq!(
        68 + 14 + 8 + 5 + 3,
        hi,
        "the scorer's maximum raw score is no longer the stated ceiling, so the ceiling now needs \
         an arm of its own rather than the arithmetic"
    );

    // ── No candidate of a 40 kb random sequence scores above the ceiling, on either preset, with
    // nothing capping it; and one planted spacer reaches it exactly. ──
    let mut seq = acgt_background(40_000, 0x5EED_0AC1);
    plant(&mut seq, 1_000, &block(RANK_98_SPACER));
    let seq = String::from_utf8(seq).expect("ASCII bases");
    let mut measured_max = i32::MIN;
    let mut scored = 0usize;
    for nuclease in ["SpCas9 (NGG)", "Cas12a / Cpf1 (TTTV)"] {
        let scan = scan_crispr_guides(&seq, nuclease, usize::MAX, None, false);
        assert!(scan.guides.len() > 500, "{nuclease} finds a broad sample in 40 kb of random bases: {}", scan.guides.len());
        for g in &scan.guides {
            assert!(
                g.on_target_score <= hi,
                "{nuclease} guide {} ({}+{}) ranks {}, above the stated ceiling {hi}, and nothing \
                 caps it: the stated range and the scorer's arithmetic have parted",
                g.id,
                g.spacer_seq,
                g.pam_seq,
                g.on_target_score
            );
            assert!(g.on_target_score >= lo, "a rank below the clamped floor {lo}: {}", g.on_target_score);
            measured_max = measured_max.max(g.on_target_score);
            scored += 1;
        }
    }
    assert!(scored > 1_000, "the sweep scored {scored} candidates");
    assert_eq!(
        measured_max, hi,
        "the stated ceiling is reached by the arithmetic alone, with no arm to cap anything"
    );

    // ── The floor is the arm that does the work: all T, so GC outside 30–75 % (−22), a T at
    // position 20 (−6), a TTTT run (−30) and a PAM ending GGG (−5) — 68 − 63 = 5 raw, reported as
    // the stated floor. ──
    let worst_spacer = "T".repeat(20);
    let worst = format!("{}{}GGG{}", "A".repeat(12), worst_spacer, "A".repeat(12));
    let scan = scan_crispr_guides(&worst, "SpCas9 (NGG)", usize::MAX, None, false);
    let guide = scan
        .guides
        .iter()
        .find(|g| g.spacer_seq == worst_spacer)
        .expect("the worst spacer is a candidate of its own sequence");
    assert_eq!(
        guide.on_target_score, lo,
        "the worst spacer totals 5 raw and only the floor arm reports it as the stated {lo}"
    );
}

/// `len` bases of A, C, G and T from `seed` (the same bases on every run): a background that spells
/// PAMs of its own, unlike [`at_background`], so a scan of it reads thousands of unplanned spacers
/// across the features the rank weighs.
fn acgt_background(len: usize, seed: u32) -> Vec<u8> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            b"ACGT"[((x >> 24) & 0b11) as usize]
        })
        .collect()
}
