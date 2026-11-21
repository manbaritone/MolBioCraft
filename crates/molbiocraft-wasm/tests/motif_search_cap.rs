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

// ─── BG-01M6SKTM: one IUPAC motif grammar on both paths, and a reply that names the path ───
//
// D0265: an IUPAC code in the motif matches each base it stands for, a record letter outside
// A/C/G/T/U (N, R, ...) matches nothing, and the reply names the search that ran ("fm-index" or
// "scan"). The wrong implementations these fixtures reach: the FM index reading the motif's N as
// the record's N (the defect at or below 262,144 bp: GANTC hit a GANTC written in the record and
// missed GAATC), the scan reading IUPAC letters literally (the defect past it: GANTC found only the
// letters G, A, N, T, C), a record N or R matching a motif N, the reverse strand dropped, a
// palindrome such as GANTC counted on both strands, and a reply that names the FM index whatever
// ran.

/// The bases each IUPAC nucleotide code stands for, as a set of A=1, C=2, G=4, T=8, written out by
/// hand from the IUPAC-IUB table (Cornish-Bowden 1985). U is T. Any other letter stands for none.
fn hand_code_bases(c: u8) -> u8 {
    match c {
        b'A' => 1,
        b'C' => 2,
        b'G' => 4,
        b'T' | b'U' => 8,
        b'R' => 1 | 4,
        b'Y' => 2 | 8,
        b'S' => 2 | 4,
        b'W' => 1 | 8,
        b'K' => 4 | 8,
        b'M' => 1 | 2,
        b'B' => 2 | 4 | 8,
        b'D' => 1 | 4 | 8,
        b'H' => 1 | 2 | 8,
        b'V' => 1 | 2 | 4,
        b'N' => 1 | 2 | 4 | 8,
        _ => 0,
    }
}

/// The base a record letter is: A, C, G, T or U (as T). Every other letter, an N or an R in the
/// record included, is no base, so it matches nothing.
fn hand_record_base(c: u8) -> u8 {
    match c {
        b'A' => 1,
        b'C' => 2,
        b'G' => 4,
        b'T' | b'U' => 8,
        _ => 0,
    }
}

/// The IUPAC reverse complement of a motif by a hand table: each code becomes the code of its
/// complementary bases (R <-> Y, K <-> M, B <-> V, D <-> H; S, W and N are their own).
fn hand_iupac_revcomp(pat: &str) -> String {
    pat.bytes()
        .rev()
        .map(|c| match c {
            b'A' => 'T',
            b'T' | b'U' => 'A',
            b'G' => 'C',
            b'C' => 'G',
            b'R' => 'Y',
            b'Y' => 'R',
            b'K' => 'M',
            b'M' => 'K',
            b'B' => 'V',
            b'V' => 'B',
            b'D' => 'H',
            b'H' => 'D',
            b'S' => 'S',
            b'W' => 'W',
            b'N' => 'N',
            other => other as char,
        })
        .collect()
}

/// Every IUPAC hit of `pat` in `seq`, overlapping ones included, by a base-by-base scan: a window
/// matches when each of its record bases is one the motif's code there stands for. 1-based, in
/// position order, the forward hit first at a shared start; a motif whose reverse complement
/// stands for the same bases at every place (GANTC) is one hit per site, on the forward strand.
fn hand_iupac_hits(seq: &str, pat: &str) -> Vec<(u64, u64, i64)> {
    let fwd: Vec<u8> = pat.bytes().map(hand_code_bases).collect();
    let rev: Vec<u8> = hand_iupac_revcomp(pat).bytes().map(hand_code_bases).collect();
    let (s, n) = (seq.as_bytes(), pat.len());
    let mut out = Vec::new();
    if n == 0 || n > s.len() {
        return out;
    }
    let fits = |w: &[u8], codes: &[u8]| w.iter().zip(codes).all(|(&b, &c)| hand_record_base(b) & c != 0);
    for i in 0..=s.len() - n {
        let w = &s[i..i + n];
        let (start, end) = ((i + 1) as u64, (i + n) as u64);
        if fits(w, &fwd) {
            out.push((start, end, 1));
        }
        if rev != fwd && fits(w, &rev) {
            out.push((start, end, -1));
        }
    }
    out
}

fn search_path_of(reply: &Value) -> &str {
    reply["searchPath"]
        .as_str()
        .expect("the reply names the search that ran (searchPath)")
}

/// `seq` written at the head of `length` bases whose tail is an unsequenced gap of N. The gap is no
/// base, so the longer record holds exactly the hits of the shorter one, read by the scan.
fn padded_with_gap(seq: &str, length: usize) -> String {
    let mut out = String::with_capacity(length);
    out.push_str(seq);
    out.extend(std::iter::repeat('N').take(length - seq.len()));
    out
}

/// The hits of `pat` on resident `doc_id` with a list long enough for all of them.
fn search_all(doc_id: &str, pat: &str) -> Value {
    search(doc_id, pat, 1_000_000)
}

#[test]
fn an_iupac_motif_matches_its_bases_on_both_paths() {
    // A seeded 10 kb record with one planted GAATC (a HinfI site), one GACTC (a HinfI site), one
    // GARTC (R in the record: no base, so not a site) and one GANTC written in the record (N: no
    // base, the letters the old FM index matched).
    let mut short = seeded_dna(10_000, 53).into_bytes();
    let planted = [(1_000usize, "GAATC"), (3_000, "GACTC"), (5_000, "GARTC"), (7_000, "GANTC")];
    for (at, word) in planted {
        short[at..at + 5].copy_from_slice(word.as_bytes());
    }
    let short = String::from_utf8(short).unwrap();
    let long = padded_with_gap(&short, 300_000);

    let expected = hand_iupac_hits(&short, "GANTC");
    assert_eq!(hand_iupac_hits(&long, "GANTC"), expected, "the gap holds no site");
    let starts: Vec<u64> = expected.iter().map(|h| h.0).collect();
    assert!(starts.contains(&1_001), "the hand scan finds the planted GAATC");
    assert!(starts.contains(&3_001), "the hand scan finds the planted GACTC");
    assert!(!starts.contains(&5_001), "a record R is not a base");
    assert!(!starts.contains(&7_001), "a record N is not a base");
    assert!(expected.iter().all(|h| h.2 == 1), "GANTC is its own reverse complement");

    for (id, seq, fm, path) in [
        ("bg-sktm-iupac-fm", &short, true, "fm-index"),
        ("bg-sktm-iupac-scan", &long, false, "scan"),
    ] {
        let ack = make_resident(id, seq);
        assert_eq!(ack["hasPrebuiltFmIndex"], fm, "{id}: the path this record pins");
        let reply = search_all(id, "GANTC");
        assert_eq!(reply["totalHits"].as_u64(), Some(expected.len() as u64), "{id}: the count");
        assert_eq!(hits_of(&reply), expected, "{id}: GAATC and GACTC, not GARTC or a record GANTC");
        assert_eq!(search_path_of(&reply), path, "{id}: the reply names the search that ran");
        assert_eq!(warnings_of(&reply), Vec::<String>::new(), "{id}");
    }
}

#[test]
fn a_degenerate_site_is_found_on_plain_dna_on_both_paths() {
    for (id, length, seed, fm, path) in [
        ("bg-sktm-plain-fm", 10_000usize, 59u32, true, "fm-index"),
        ("bg-sktm-plain-scan", 300_000, 61, false, "scan"),
    ] {
        let seq = seeded_dna(length, seed);
        let ack = make_resident(id, &seq);
        assert_eq!(ack["hasPrebuiltFmIndex"], fm, "{id}: the path this record pins");

        // HinfI: GANTC, each site once (it is its own reverse complement).
        let sites = hand_iupac_hits(&seq, "GANTC");
        assert!(sites.len() > 10, "{id}: plain DNA holds HinfI sites: {}", sites.len());
        let reply = search_all(id, "GANTC");
        assert_eq!(reply["totalHits"].as_u64(), Some(sites.len() as u64), "{id}: HinfI's count");
        assert_eq!(hits_of(&reply), sites, "{id}: HinfI's sites");
        assert_eq!(search_path_of(&reply), path, "{id}");

        // A motif of A/C/G/T only matches as it did: CACA on both strands, overlapping hits each
        // counted, and the EcoRI palindrome once per site.
        for motif in ["CACA", "GAATTC"] {
            let expected = hand_hits(&seq, motif);
            assert_eq!(hand_iupac_hits(&seq, motif), expected, "{motif}: the two hand scans agree");
            assert!(!expected.is_empty(), "{id}: the fixture holds {motif}");
            let reply = search_all(id, motif);
            assert_eq!(search_path_of(&reply), path, "{id} {motif}");
            assert_eq!(reply["totalHits"].as_u64(), Some(expected.len() as u64), "{id} {motif}");
            assert_eq!(hits_of(&reply), expected, "{id} {motif}");
        }
    }
}

/// Seeded record letters over `alphabet`, by the same LCG.
fn seeded_letters(length: usize, seed: u32, alphabet: &[u8]) -> String {
    let mut x = seed;
    (0..length)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            alphabet[((x >> 8) as usize) % alphabet.len()] as char
        })
        .collect()
}

#[test]
fn random_iupac_motifs_give_one_hit_set_on_both_paths() {
    // Seeded records holding N and R (and, in two of them, U beside T), each searched as a short
    // record (the FM index) and as the same bases followed by an unsequenced gap past 262,144 bp
    // (the scan), with seeded IUPAC motifs of 1 to 12 letters. Both replies equal the hand IUPAC
    // scan, hit for hit. The motifs reach the FM index's word bound (8 or more N-heavy places): the
    // reply then says the scan ran, and its count is still the hand count, never 0 for want of a
    // word.
    let codes = b"ACGTRYSWKMBDHVNACGTACGT";
    let records: [(&[u8], u32); 6] = [
        (b"ACGTACGTACGTACGTNR", 71),
        (b"ACGTACGTACGTNNNNRR", 73),
        (b"AACCGGTTNRYU", 79),
        (b"ACGTACGTACGTACGTACGTACGTN", 83),
        (b"ACGUACGUACGTRN", 89),
        (b"GGGGCCCCAATTNR", 97),
    ];
    let mut scan_reached_on_fm_record = false;
    let mut fm_answered_degenerate = false;
    for (k, (alphabet, seed)) in records.iter().enumerate() {
        let short = seeded_letters(3_000, *seed, alphabet);
        let long = padded_with_gap(&short, 262_145);
        let fm_id = format!("bg-sktm-prop-fm-{k}");
        let scan_id = format!("bg-sktm-prop-scan-{k}");
        assert_eq!(make_resident(&fm_id, &short)["hasPrebuiltFmIndex"], true);
        assert_eq!(make_resident(&scan_id, &long)["hasPrebuiltFmIndex"], false);
        let mut x = seed.wrapping_mul(7);
        for _ in 0..24 {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let len = 1 + ((x >> 16) as usize) % 12;
            let motif: String = (0..len)
                .map(|_| {
                    x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    codes[((x >> 8) as usize) % codes.len()] as char
                })
                .collect();
            let expected = hand_iupac_hits(&short, &motif);
            let fm_reply = search_all(&fm_id, &motif);
            let scan_reply = search_all(&scan_id, &motif);
            assert_eq!(hits_of(&fm_reply), expected, "record {k}, motif {motif}: the short record");
            assert_eq!(hits_of(&scan_reply), expected, "record {k}, motif {motif}: the scan");
            assert_eq!(fm_reply["totalHits"].as_u64(), Some(expected.len() as u64), "{motif}");
            assert_eq!(scan_reply["totalHits"].as_u64(), Some(expected.len() as u64), "{motif}");
            assert_eq!(search_path_of(&scan_reply), "scan", "{motif}: past 262,144 bp");
            match search_path_of(&fm_reply) {
                "scan" => scan_reached_on_fm_record = true,
                "fm-index" => {
                    if motif.bytes().any(|c| hand_code_bases(c).count_ones() > 1) {
                        fm_answered_degenerate = true;
                    }
                }
                other => panic!("an unknown search path {other:?}"),
            }
            // The first 100, both strands merged before the cut, on both paths.
            if expected.len() > 100 {
                assert_eq!(hits_of(&search(&fm_id, &motif, 100)), expected[..100], "{motif}");
                assert_eq!(hits_of(&search(&scan_id, &motif, 100)), expected[..100], "{motif}");
            }
        }
    }
    assert!(fm_answered_degenerate, "the FM index answers some degenerate motifs");
    assert!(scan_reached_on_fm_record, "some motifs pass the FM index's word bound");
}

#[test]
fn a_motif_past_the_word_bound_is_scanned_and_named_so() {
    // Ten N stand for 4^10 words: past the FM index's bound, so the short record is scanned, the
    // reply says so, and the count is every window of ten bases (each site once: N's reverse
    // complement is N), not 0.
    let seq = seeded_dna(5_000, 101);
    make_resident("bg-sktm-bound", &seq);
    let reply = search("bg-sktm-bound", "NNNNNNNNNN", 100);
    assert_eq!(search_path_of(&reply), "scan");
    assert_eq!(reply["totalHits"].as_u64(), Some(5_000 - 10 + 1));
    assert_eq!(warnings_of(&reply), vec!["Showing the first 100 of 4,991 hits.".to_string()]);
    // Four N (256 words) are within the bound: the FM index answers.
    let reply = search("bg-sktm-bound", "NNNN", 10_000);
    assert_eq!(search_path_of(&reply), "fm-index");
    assert_eq!(reply["totalHits"].as_u64(), Some(5_000 - 4 + 1));
}

#[test]
fn a_motif_longer_than_64_places_is_scanned_window_by_window() {
    // 70 places, past the 64 one state word holds: the scan checks each window. The motif is a
    // stretch of the record with two places made N, and its reverse complement is planted further
    // on, so the hand scan holds a hit on each strand.
    let mut seq = seeded_dna(300_000, 103).into_bytes();
    let mut motif = seq[1_000..1_070].to_vec();
    motif[10] = b'N';
    motif[50] = b'N';
    let motif = String::from_utf8(motif).unwrap();
    let rc = hand_iupac_revcomp(&seq[1_000..1_070].iter().map(|&b| b as char).collect::<String>());
    seq[200_000..200_070].copy_from_slice(rc.as_bytes());
    let seq = String::from_utf8(seq).unwrap();
    let expected = hand_iupac_hits(&seq, &motif);
    assert!(expected.iter().any(|h| h.2 == 1) && expected.iter().any(|h| h.2 == -1), "{expected:?}");
    assert_eq!(make_resident("bg-sktm-long-motif", &seq)["hasPrebuiltFmIndex"], false);
    let reply = search_all("bg-sktm-long-motif", &motif);
    assert_eq!(search_path_of(&reply), "scan");
    assert_eq!(hits_of(&reply), expected);
}

#[test]
fn a_letter_that_is_no_iupac_code_matches_nothing_and_says_so() {
    // X is no IUPAC nucleotide code: the motif stands for no base on either path, and the reply
    // says why its count is 0 rather than reporting an absence it never searched for.
    let seq = seeded_dna(10_000, 107);
    for (id, s) in [("bg-sktm-x-fm", seq.clone()), ("bg-sktm-x-scan", padded_with_gap(&seq, 300_000))] {
        make_resident(id, &s);
        let reply = search_all(id, "GAXTC");
        assert_eq!(reply["totalHits"].as_u64(), Some(0), "{id}");
        assert_eq!(
            warnings_of(&reply),
            vec!["The motif holds X, which is no IUPAC nucleotide code, so it matches no base.".to_string()],
            "{id}"
        );
    }
}
