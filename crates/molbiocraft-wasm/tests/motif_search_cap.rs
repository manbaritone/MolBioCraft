// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S17C: the resident motif search (`search_resident_motif_fmindex`, the op the Sequence
//! View's search box runs) replies `{ hits, totalHits, warnings }`: the first `maxHits` hits by
//! position with both strands merged before the cut, the exact number of hits in the whole
//! sequence, and one D0005 warning when the list holds fewer hits than that.
//!
//! Every expectation is a hand scan of the fixture written here, base by base, not the engine's
//! own search. The fixtures are seeded and generated in the test (rule 16). Over 262,144 bp the
//! engine scans; at or below that it reads its prebuilt FM index. Both paths are pinned, and each
//! test checks which path it reached.
//!
//! The wrong implementations each fixture reaches:
//! - the forward strand fills the cap first and the reverse strand is never read (the defect: the
//!   first 100 hits of the fixtures hold reverse-strand hits, so an all-forward list fails);
//! - the total is the length of the capped list, or the forward strand's count alone;
//! - each strand is cut to the cap and the two lists are not cut again after the merge;
//! - the scan skips overlapping hits (memmem's `find_iter` is non-overlapping): CACA overlaps
//!   itself every 2 bases, and the fixtures hold CACACA runs, so a non-overlapping count is short;
//! - a palindrome (GAATTC, also typed as GAAUUC) is counted on both strands;
//! - the warning is missing, written for an uncapped list, or names the numbers without commas;
//! - the cut or the warning starts only two or more hits past the cap (`hits.len() + 1 <
//!   total_hits`), or a list of exactly 100 hits warns: the cut tests plant exactly 99, 100 and 101
//!   hits on each path.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

/// Seeded ACGT (an LCG's top two bits), so every run searches the same bases.
fn seeded_dna(length: usize, seed: u32) -> String {
    let mut x = seed;
    (0..length)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            b"ACGT"[(x >> 30) as usize] as char
        })
        .collect()
}

/// Watson-Crick reverse complement by a hand table; fixture motifs are plain ACGT.
fn hand_revcomp(pat: &str) -> String {
    pat.chars()
        .rev()
        .map(|c| match c {
            'A' => 'T',
            'T' => 'A',
            'G' => 'C',
            'C' => 'G',
            other => panic!("fixture motif holds a non-ACGT base {other:?}"),
        })
        .collect()
}

/// Every hit, overlapping ones included, by a base-by-base scan: (start, end, strand), 1-based,
/// in position order with the forward hit first at a shared start. A palindrome, whose reverse
/// complement is itself, is one hit per site, on the forward strand.
fn hand_hits(seq: &str, pat: &str) -> Vec<(u64, u64, i64)> {
    let rc = hand_revcomp(pat);
    let (s, n) = (seq.as_bytes(), pat.len());
    let mut out = Vec::new();
    for i in 0..=s.len() - n {
        let w = &s[i..i + n];
        let (start, end) = ((i + 1) as u64, (i + n) as u64);
        if w == pat.as_bytes() {
            out.push((start, end, 1));
        }
        if rc != pat && w == rc.as_bytes() {
            out.push((start, end, -1));
        }
    }
    out
}

/// How many times `pat` occurs when each match resumes after the last one ends (memmem's count).
fn non_overlapping_count(seq: &str, pat: &str) -> usize {
    seq.matches(pat).count()
}

/// A count with a comma every three digits, written out by hand.
fn with_commas(n: usize) -> String {
    let d = n.to_string();
    let mut out = String::new();
    for (i, c) in d.chars().enumerate() {
        if i > 0 && (d.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn make_resident(doc_id: &str, seq: &str) -> Value {
    dispatch_bio_rpc(
        "ensure_resident_sequence",
        json!({ "docId": doc_id, "revisionKey": "r1", "seq": seq, "features": [], "isRna": false, "isProtein": false }),
    )
    .expect("ensure_resident_sequence")
}

fn search(doc_id: &str, pattern: &str, max_hits: usize) -> Value {
    dispatch_bio_rpc(
        "search_resident_motif_fmindex",
        json!({ "docId": doc_id, "pattern": pattern, "bothStrands": true, "maxHits": max_hits }),
    )
    .expect("search_resident_motif_fmindex")
}

fn hits_of(reply: &Value) -> Vec<(u64, u64, i64)> {
    reply["hits"]
        .as_array()
        .expect("the reply holds a hits list")
        .iter()
        .map(|h| {
            (
                h["start"].as_u64().unwrap(),
                h["end"].as_u64().unwrap(),
                h["strand"].as_i64().unwrap(),
            )
        })
        .collect()
}

fn warnings_of(reply: &Value) -> Vec<String> {
    reply["warnings"]
        .as_array()
        .expect("the reply always holds a warnings list (D0005)")
        .iter()
        .map(|w| w.as_str().unwrap().to_string())
        .collect()
}

/// The capped and uncapped replies for CACA, and a palindrome's, on the resident `doc_id`.
fn assert_both_strands_and_total(doc_id: &str, seq: &str) {
    // CACA: not a palindrome (its reverse complement is TGTG), and it overlaps itself.
    let expected = hand_hits(seq, "CACA");
    let first_100 = &expected[..100];
    // The fixture reaches each wrong implementation named above.
    assert!(
        expected.len() > 1_000,
        "the total needs a comma: {}",
        expected.len()
    );
    assert!(
        first_100.iter().any(|h| h.2 == -1),
        "the first 100 hold reverse-strand hits"
    );
    assert!(
        non_overlapping_count(seq, "CACA") < expected.iter().filter(|h| h.2 == 1).count(),
        "the fixture holds overlapping CACA hits"
    );
    assert!(
        non_overlapping_count(seq, "TGTG") < expected.iter().filter(|h| h.2 == -1).count(),
        "the fixture holds overlapping TGTG hits"
    );

    let capped = search(doc_id, "CACA", 100);
    assert_eq!(
        capped["totalHits"].as_u64(),
        Some(expected.len() as u64),
        "the exact total of hits"
    );
    assert_eq!(
        hits_of(&capped),
        first_100,
        "the first 100 hits by position, both strands merged"
    );
    assert_eq!(
        warnings_of(&capped),
        vec![format!(
            "Showing the first 100 of {} hits.",
            with_commas(expected.len())
        )]
    );

    // A list that holds every hit says nothing.
    let whole = search(doc_id, "CACA", expected.len());
    assert_eq!(whole["totalHits"].as_u64(), Some(expected.len() as u64));
    assert_eq!(hits_of(&whole), expected);
    assert_eq!(warnings_of(&whole), Vec::<String>::new());

    // A palindrome is one hit per site, typed with T or with U.
    let sites = hand_hits(seq, "GAATTC");
    assert!(!sites.is_empty(), "the fixture holds EcoRI sites");
    assert!(sites.iter().all(|h| h.2 == 1));
    for typed in ["GAATTC", "GAAUUC"] {
        let reply = search(doc_id, typed, 10_000);
        assert_eq!(
            reply["totalHits"].as_u64(),
            Some(sites.len() as u64),
            "{typed}: each site once"
        );
        assert_eq!(hits_of(&reply), sites, "{typed}");
        assert_eq!(warnings_of(&reply), Vec::<String>::new(), "{typed}");
    }
}

/// A 20-base motif that is not a palindrome (its reverse complement differs), planted below.
const PLANTED: &str = "ACGGTCATTGCAGTCCATGA";

/// Seeded ACGT of `length` bases holding `copies` of [`PLANTED`], evenly spaced and never
/// overlapping, alternately as the motif (+ strand) and as its reverse complement (- strand).
fn planted_dna(length: usize, seed: u32, copies: usize) -> String {
    let mut seq = seeded_dna(length, seed).into_bytes();
    let rc = hand_revcomp(PLANTED);
    let spacing = length / copies;
    assert!(spacing > 2 * PLANTED.len(), "the copies do not touch");
    for k in 0..copies {
        let at = k * spacing + 7;
        let word = if k % 2 == 0 { PLANTED } else { rc.as_str() };
        seq[at..at + PLANTED.len()].copy_from_slice(word.as_bytes());
    }
    String::from_utf8(seq).unwrap()
}

/// At the cap of 100 the list is cut at exactly one hit past it: 101 hits list the first 100 and
/// warn, while 100 and 99 hits list them all and say nothing. The wrong implementations these
/// fixtures reach: a cut or warning only once the total is two or more past the list (`len + 1 <
/// total`), a warning for a list that holds every hit (`len <= total`), a list cut to 101, and a
/// total of the list's length.
fn assert_cut_at_one_past_the_cap(doc_id: &str, length: usize, seed: u32, fm_index: bool) {
    for copies in [101usize, 100, 99] {
        let seq = planted_dna(length, seed, copies);
        let id = format!("{doc_id}-{copies}");
        let ack = make_resident(&id, &seq);
        assert_eq!(ack["hasPrebuiltFmIndex"], fm_index, "{length} bp: the path this test pins");
        let expected = hand_hits(&seq, PLANTED);
        assert_eq!(expected.len(), copies, "the fixture holds exactly {copies} hits");
        assert!(
            expected[..copies.min(100)].iter().any(|h| h.2 == -1),
            "the listed hits hold - strand hits"
        );

        let reply = search(&id, PLANTED, 100);
        assert_eq!(reply["totalHits"].as_u64(), Some(copies as u64), "{copies} hits: the total");
        let listed = hits_of(&reply);
        assert_eq!(listed, expected[..copies.min(100)], "{copies} hits: the first 100 by position");
        if copies > 100 {
            assert_eq!(
                warnings_of(&reply),
                vec![format!("Showing the first 100 of {copies} hits.")],
                "{copies} hits: the cut list says so"
            );
        } else {
            assert_eq!(
                warnings_of(&reply),
                Vec::<String>::new(),
                "{copies} hits: the whole list says nothing"
            );
        }
    }
}

#[test]
fn scan_search_cuts_at_one_hit_past_the_cap() {
    assert_cut_at_one_past_the_cap("bg-s17c-scan-cut", 300_000, 29, false);
}

#[test]
fn indexed_search_cuts_at_one_hit_past_the_cap() {
    assert_cut_at_one_past_the_cap("bg-s17c-indexed-cut", 10_000, 31, true);
}

#[test]
fn long_sequence_search_returns_both_strands_and_total() {
    let seq = seeded_dna(300_000, 17);
    let ack = make_resident("bg-s17c-long", &seq);
    assert_eq!(
        ack["hasPrebuiltFmIndex"], false,
        "300,000 bp is past the FM index: the scan path"
    );
    assert_both_strands_and_total("bg-s17c-long", &seq);
}

#[test]
fn indexed_search_returns_both_strands_and_total() {
    let seq = seeded_dna(200_000, 23);
    let ack = make_resident("bg-s17c-indexed", &seq);
    assert_eq!(
        ack["hasPrebuiltFmIndex"], true,
        "200,000 bp is read through the FM index"
    );
    assert_both_strands_and_total("bg-s17c-indexed", &seq);
}
