// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7DVY6: a caller-supplied (custom) enzyme definition is scanned exactly as a built-in one:
//! both strands with mirrored signed offsets, a palindrome once, offsets outside the motif kept,
//! across the origin of a circle and never past the end of a linear molecule. Its motif is matched
//! the same whichever path the scan takes, and a motif holding a letter the scan cannot read is
//! named rather than counted as a noncutter.
//!
//! Every expected coordinate here is written out by hand or drawn from the brute-force oracle in
//! this file, which matches each strand base by base with its own base table and nothing taken
//! from the engine's scanner.

use molbiocraft_cloning::rebase_catalog::{
    find_non_cutting_enzymes, find_non_cutting_enzymes_for_topology, get_rebase_enzymes, scan_restriction_sites,
    RestrictionPositionLimit, RestrictionSiteScan, ORIGIN_WRAP_BASES,
};
use molbiocraft_core::types::{RestrictionCutSite, RestrictionEnzyme, Topology};

/// A custom definition: a name, a motif and its signed cut offsets, nothing from the catalogue.
fn custom(name: &str, rec: &str, cut_fwd: i32, cut_rev: i32) -> RestrictionEnzyme {
    RestrictionEnzyme {
        name: name.to_string(),
        recognition_seq: rec.to_string(),
        cut_fwd,
        cut_rev,
        is_type_iis: false,
        suppliers: Vec::new(),
        methylation_sensitivity: Vec::new(),
        buffer_standard: String::new(),
        temp_c: 37,
    }
}

fn scan(seq: &str, topology: Topology, enzymes: &[RestrictionEnzyme]) -> RestrictionSiteScan {
    scan_restriction_sites(seq, topology, Some(enzymes), RestrictionPositionLimit::All)
}

fn count(scan: &RestrictionSiteScan, name: &str) -> Option<usize> {
    scan.site_counts.iter().find(|c| c.enzyme == name).map(|c| c.sites)
}

/// (position, strand, cutTop, cutBottom, overhang, overhang type) of every site of `name`.
fn reading(scan: &RestrictionSiteScan, name: &str) -> Vec<(usize, i8, usize, usize, String, String)> {
    scan.sites
        .iter()
        .filter(|s| s.enzyme.name == name)
        .map(|s: &RestrictionCutSite| {
            (s.position, s.strand, s.cut_top, s.cut_bottom, s.overhang_seq.clone(), s.overhang_type.clone())
        })
        .collect()
}

fn site(p: usize, strand: i8, top: usize, bottom: usize, oh: &str, kind: &str) -> (usize, i8, usize, usize, String, String) {
    (p, strand, top, bottom, oh.to_string(), kind.to_string())
}

fn a(n: usize) -> String {
    "A".repeat(n)
}

fn revcomp(s: &str) -> String {
    s.bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            b'T' => 'A',
            b'N' => 'N',
            other => other as char,
        })
        .collect()
}

/// xorshift64* bases from a fixed seed.
fn bases(n: usize, seed: u64) -> String {
    let mut s = seed;
    (0..n)
        .map(|_| {
            s ^= s >> 12;
            s ^= s << 25;
            s ^= s >> 27;
            b"ACGT"[(s.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 33) as usize % 4] as char
        })
        .collect()
}

/// The oracle's own IUPAC table: the sequence bases a motif letter matches (an N matches an N).
fn oracle_matches(seq_base: u8, motif_base: u8) -> bool {
    let set: &[u8] = match motif_base {
        b'A' => b"A",
        b'C' => b"C",
        b'G' => b"G",
        b'T' => b"T",
        b'N' => b"ACGTN",
        _ => panic!("the oracle reads only A, C, G, T and N"),
    };
    set.contains(&seq_base)
}

/// Every site of a custom definition by brute force, as (position, strand, cutTop, cutBottom):
/// each start on each strand, each base compared, the cuts from the signed offsets mirrored for a
/// reverse match, a circle read modulo its length and a linear site kept only when both cuts lie
/// in the molecule. A motif equal to its own reverse complement is read on one strand.
fn oracle(seq: &str, circular: bool, e: &RestrictionEnzyme) -> Vec<(usize, i8, usize, usize)> {
    let s = seq.as_bytes();
    let n = s.len() as isize;
    let fwd = e.recognition_seq.clone();
    let rev = revcomp(&fwd);
    let m = fwd.len() as isize;
    let mut strands = vec![(fwd.clone(), 1i8)];
    if rev != fwd {
        strands.push((rev, -1));
    }
    let mut out = Vec::new();
    for (motif, strand) in &strands {
        let motif = motif.as_bytes();
        for i in 0..n {
            if !circular && i + m > n {
                break;
            }
            if !(0..m).all(|k| oracle_matches(s[((i + k) % n) as usize], motif[k as usize])) {
                continue;
            }
            let (top, bottom) = if *strand == 1 {
                (i + e.cut_fwd as isize, i + e.cut_rev as isize)
            } else {
                (i + m - e.cut_rev as isize, i + m - e.cut_fwd as isize)
            };
            if circular {
                out.push((i as usize + 1, *strand, top.rem_euclid(n) as usize + 1, bottom.rem_euclid(n) as usize + 1));
            } else if (0..=n).contains(&top) && (0..=n).contains(&bottom) {
                out.push((i as usize + 1, *strand, top as usize + 1, bottom as usize + 1));
            }
        }
    }
    out.sort();
    out
}

fn engine_sites(scan: &RestrictionSiteScan, name: &str) -> Vec<(usize, i8, usize, usize)> {
    let mut v: Vec<_> = scan
        .sites
        .iter()
        .filter(|s| s.enzyme.name == name)
        .map(|s| (s.position, s.strand, s.cut_top, s.cut_bottom))
        .collect();
    v.sort();
    v
}

/// AC1: a non-palindromic custom motif is found forward and reverse-complemented, with strand +1
/// and -1, and the reverse match's cuts mirror the signed offsets, so each site's cuts sit at the
/// same distances from the motif on the strand it was found on.
#[test]
fn us_01m7dvy6_ac1_a_custom_motif_is_found_on_both_strands_with_mirrored_offsets() {
    // GACTTC (2/5): forward at 0-based 8, reverse-complemented (GAAGTC) at 0-based 26.
    let e = custom("MyGac", "GACTTC", 2, 5);
    let seq = format!("{}GACTTC{}GAAGTC{}", a(8), a(12), a(8));
    assert_eq!(seq.len(), 40);
    for topology in [Topology::Linear, Topology::Circular] {
        let s = scan(&seq, topology, std::slice::from_ref(&e));
        // Forward: raw cuts 8+2 = 10 and 8+5 = 13, reported as the first base after each.
        // Reverse: raw cuts 26+6-5 = 27 and 26+6-2 = 30, the top-strand bases between them AAG.
        assert_eq!(
            reading(&s, "MyGac"),
            vec![site(9, 1, 11, 14, "CTT", "5prime"), site(27, -1, 28, 31, "AAG", "5prime")],
            "{topology:?}"
        );
        assert_eq!(count(&s, "MyGac"), Some(2), "{topology:?}");
        for c in s.sites.iter() {
            let start = c.position as isize - 1;
            let m = c.enzyme.recognition_seq.len() as isize;
            let (top, bottom) = (c.cut_top as isize - 1, c.cut_bottom as isize - 1);
            // Read on the strand the motif was found on, from that strand's 5' end of the motif.
            let (from_motif_top, from_motif_bottom) = if c.strand == 1 {
                (top - start, bottom - start)
            } else {
                (start + m - bottom, start + m - top)
            };
            assert_eq!((from_motif_top, from_motif_bottom), (2, 5), "{} on {topology:?}", c.id);
        }
    }
}

/// AC2: a custom motif equal to its own reverse complement is reported once per occurrence, by
/// either matching path, and its count is the number of occurrences, not twice it.
#[test]
fn us_01m7dvy6_ac2_a_custom_palindrome_is_reported_once_per_occurrence() {
    // GCTAGC and GANTC go through the spelled-out pass; GCNNNNGC (256 spellings) base by base.
    let cases = [
        (custom("MyNhe", "GCTAGC", 1, 5), ["GCTAGC", "GCTAGC", "GCTAGC"]),
        (custom("MyHin", "GANTC", 1, 4), ["GAATC", "GACTC", "GATTC"]),
        (custom("MyBgl", "GCNNNNGC", 4, 4), ["GCTTTTGC", "GCACGTGC", "GCTGCAGC"]),
    ];
    for (e, planted) in &cases {
        let seq = format!("{}{}{}{}{}{}{}", a(6), planted[0], a(9), planted[1], a(9), planted[2], a(6));
        for topology in [Topology::Linear, Topology::Circular] {
            let s = scan(&seq, topology, std::slice::from_ref(e));
            let found = reading(&s, &e.name);
            assert_eq!(found.len(), 3, "{} on {topology:?}: {found:?}", e.name);
            assert!(found.iter().all(|r| r.1 == 1), "{} read on one strand: {found:?}", e.name);
            assert_eq!(count(&s, &e.name), Some(3), "{} on {topology:?}", e.name);
            assert_eq!(engine_sites(&s, &e.name), oracle(&seq, topology == Topology::Circular, e), "{}", e.name);
        }
    }
}

/// AC3: offsets outside the motif are kept, never clamped. On a circle both cuts read through the
/// origin inside 1..=len, the overhang read across it; on a linear molecule a site whose cut falls
/// before base 1 or past the last base is not reported and the enzyme counts 0 sites.
#[test]
fn us_01m7dvy6_ac3_offsets_outside_the_motif_are_kept_across_the_origin_and_never_past_a_linear_end() {
    // A Type IIS pair past the motif, GGTCTA (7/11), and a pair before it, CTTGAG (-9/-5).
    let iis = custom("MyIIS", "GGTCTA", 7, 11);
    let neg = custom("MyNeg", "CTTGAG", -9, -5);
    // 40 bases: ACGT at 36..40 and at 0..4 marks the bases read across the origin.
    let ring = |at: usize, motif: &str| {
        let mut b: Vec<u8> = format!("{}{}", a(36), "ACGT").into_bytes();
        b[0..4].copy_from_slice(b"TGCA");
        b[at..at + motif.len()].copy_from_slice(motif.as_bytes());
        String::from_utf8(b).unwrap()
    };
    struct Case {
        e: RestrictionEnzyme,
        seq: String,
        circular: (usize, i8, usize, usize, String, String),
    }
    let cases = [
        // Forward IIS at 0-based 30: raw cuts 37 and 41, the bottom one past the last base.
        Case { e: iis.clone(), seq: ring(30, "GGTCTA"), circular: site(31, 1, 38, 2, "CGTT", "5prime") },
        // Reverse IIS (TAGACC) at 0-based 2: raw cuts 2+6-11 = -3 and 2+6-7 = 1, the top one before base 1.
        Case { e: iis.clone(), seq: ring(2, "TAGACC"), circular: site(3, -1, 38, 2, "CGTT", "5prime") },
        // Forward negative at 0-based 4: raw cuts -5 and -1, both before base 1.
        Case { e: neg.clone(), seq: ring(4, "CTTGAG"), circular: site(5, 1, 36, 40, "AACG", "5prime") },
        // Reverse negative (CTCAAG) at 0-based 30: raw cuts 30+6+5 = 41 and 30+6+9 = 45, past the end.
        Case { e: neg.clone(), seq: ring(30, "CTCAAG"), circular: site(31, -1, 2, 6, "GCAA", "5prime") },
    ];
    for c in &cases {
        let circ = scan(&c.seq, Topology::Circular, std::slice::from_ref(&c.e));
        assert_eq!(reading(&circ, &c.e.name), vec![c.circular.clone()], "{} on the circle {}", c.e.name, c.seq);
        let r = &circ.sites[0];
        assert!((1..=c.seq.len()).contains(&r.cut_top) && (1..=c.seq.len()).contains(&r.cut_bottom));
        let lin = scan(&c.seq, Topology::Linear, std::slice::from_ref(&c.e));
        assert!(lin.sites.is_empty(), "{} on the linear {}: {:?}", c.e.name, c.seq, reading(&lin, &c.e.name));
        assert_eq!(count(&lin, &c.e.name), Some(0), "{} on the linear {}", c.e.name, c.seq);
    }

    // Inside a linear molecule the same offsets are kept as they are: a cut 9 bases before the motif
    // at 0-based 9 is the cut before base 1 (raw 0, reported 1), and one base further left is gone.
    let edge = |at: usize| {
        let mut b = a(40).into_bytes();
        b[at..at + 6].copy_from_slice(b"CTTGAG");
        String::from_utf8(b).unwrap()
    };
    let at9 = scan(&edge(9), Topology::Linear, std::slice::from_ref(&neg));
    assert_eq!(reading(&at9, "MyNeg"), vec![site(10, 1, 1, 5, "AAAA", "5prime")]);
    let at8 = scan(&edge(8), Topology::Linear, std::slice::from_ref(&neg));
    assert_eq!((at8.sites.len(), count(&at8, "MyNeg")), (0, Some(0)));
    // And the Type IIS pair at 0-based 29 cuts 11 past the motif exactly after the last base (raw
    // 40, reported 41); one base further right it is gone.
    let iis_at = |at: usize| {
        let mut b = a(40).into_bytes();
        b[at..at + 6].copy_from_slice(b"GGTCTA");
        scan(&String::from_utf8(b).unwrap(), Topology::Linear, std::slice::from_ref(&iis))
    };
    assert_eq!(reading(&iis_at(29), "MyIIS"), vec![site(30, 1, 37, 41, "AAAA", "5prime")]);
    let at30 = iis_at(30);
    assert_eq!((at30.sites.len(), count(&at30, "MyIIS")), (0, Some(0)));
}

/// AC4: a custom motif across the origin of a circle is found once; the longest such motif the
/// scan supports is `ORIGIN_WRAP_BASES` + 1 = 37 bases; a cut offset of any size is read through
/// the origin and is not bounded by the wrap.
#[test]
fn us_01m7dvy6_ac4_a_motif_across_the_origin_is_found_once_up_to_the_wrap_plus_one() {
    assert_eq!(ORIGIN_WRAP_BASES, 36, "the wrap a circle's search reads again past its end");
    assert_eq!(ORIGIN_WRAP_BASES + 1, 37, "the longest motif the scan finds across the origin");

    // A 37-base motif, written out here rather than drawn from the constant, cut 3/7.
    let long = "GACCTGAATTCCAGGTCGATCCTAGCATGCAACGTTG";
    assert_eq!(long.len(), 37);
    assert_ne!(revcomp(long), long);
    // The same length with four N letters (256 spellings), so it is matched base by base.
    let degenerate = "GACCTGNATTCCAGGTCGANCCTAGCATNCAACGNTG";
    let len = 80;
    let filler = a(len);
    for (name, motif, plant) in [("MyLong", long, long.to_string()), ("MyLongN", degenerate, long.to_string())] {
        let e = custom(name, motif, 3, 7);
        for planted in [plant.clone(), revcomp(&plant)] {
            // The motif's first k bases close the molecule and the rest open it: every split
            // through k = 1, which needs all 36 wrapped bases.
            for k in 1..37 {
                let seq = format!("{}{}{}", &planted[k..], &filler[..len - 37], &planted[..k]);
                let s = scan(&seq, Topology::Circular, std::slice::from_ref(&e));
                let strand = if planted == plant { 1 } else { -1 };
                let found: Vec<(usize, i8)> = s.sites.iter().map(|c| (c.position, c.strand)).collect();
                assert_eq!(found, vec![(len - k + 1, strand)], "{name} split {k}");
                assert_eq!(count(&s, name), Some(1), "{name} split {k}");
                assert!(s.sites.iter().all(|c| (1..=len).contains(&c.cut_top) && (1..=len).contains(&c.cut_bottom)));
            }
        }
    }

    // One base past the wrap: a 38-base motif starting at the last base is not reachable.
    let past = format!("{long}C");
    let e = custom("MyPast", &past, 3, 7);
    let seq = format!("{}{}{}", &past[1..], a(len - 38), &past[..1]);
    assert_eq!(count(&scan(&seq, Topology::Circular, std::slice::from_ref(&e)), "MyPast"), Some(0));

    // A motif at base 1 lies in the molecule and again in its wrap: it is found once, on a circle
    // longer than the wrap and on one shorter than it (whose wrap is the whole molecule).
    let e = custom("MyGac", "GACTTC", 2, 5);
    for n in [80, 20, 7] {
        let seq = format!("GACTTC{}", a(n - 6));
        let s = scan(&seq, Topology::Circular, std::slice::from_ref(&e));
        assert_eq!(reading(&s, "MyGac").iter().map(|r| (r.0, r.1)).collect::<Vec<_>>(), vec![(1, 1)], "{n}-bp circle");
        assert_eq!(count(&s, "MyGac"), Some(1), "{n}-bp circle");
    }

    // Cuts 100 past the motif and 110 before it, on a 50-bp circle: read modulo its length.
    let mut b = a(50).into_bytes();
    b[10..16].copy_from_slice(b"GACTTC");
    b[40..44].copy_from_slice(b"CGTA");
    let seq = String::from_utf8(b).unwrap();
    let far = custom("MyFar", "GACTTC", 100, 104);
    // Raw cuts 110 and 114: 110 mod 50 = 10, so the first bases after them are 11 and 15.
    assert_eq!(reading(&scan(&seq, Topology::Circular, &[far]), "MyFar"), vec![site(11, 1, 11, 15, "GACT", "5prime")]);
    let behind = custom("MyBehind", "GACTTC", -110, -106);
    // Raw cuts -100 and -96: -100 mod 50 = 0 and -96 mod 50 = 4, the overhang the bases 1..=4.
    assert_eq!(reading(&scan(&seq, Topology::Circular, &[behind]), "MyBehind"), vec![site(11, 1, 1, 5, "AAAA", "5prime")]);
    let early = custom("MyEarly", "GACTTC", -70, -66);
    // Raw cuts -60 and -56: -60 mod 50 = 40, the overhang CGTA at 41..=44.
    assert_eq!(reading(&scan(&seq, Topology::Circular, &[early]), "MyEarly"), vec![site(11, 1, 41, 45, "CGTA", "5prime")]);
}

/// AC5: the same degenerate motif gives the same sites whether it is spelled out into exact motifs
/// (no N in the sequence: 4 x 4 x 4 = 64) or matched base by base (an N in the sequence: 5 x 5 x 5
/// = 125, past the 64 the scan spells out), and both agree with the brute-force oracle. A motif
/// holding a letter the scan cannot read is named in one warning, has no site count, and is not
/// listed as a noncutter.
#[test]
fn us_01m7dvy6_ac5_both_matching_paths_agree_and_an_unreadable_motif_is_named() {
    // GCNNNAT (2/5) and its reverse complement ATNNNGC, planted in a random background.
    let e = custom("MyDeg", "GCNNNAT", 2, 5);
    let mut b = bases(400, 0x5eed_01e7).into_bytes();
    for (at, motif) in [(0usize, "GCAAAAT"), (50, "ATCGTGC"), (120, "GCTGCAT"), (250, "ATGGGGC"), (393, "GCTTTAT")] {
        b[at..at + 7].copy_from_slice(motif.as_bytes());
    }
    let exact = String::from_utf8(b).unwrap();
    assert!(!exact.contains('N'));

    let spelled = scan(&exact, Topology::Linear, std::slice::from_ref(&e));
    let truth = oracle(&exact, false, &e);
    assert!(truth.len() >= 5 && truth.iter().any(|r| r.1 == -1), "the fixture reaches both strands: {truth:?}");
    assert_eq!(engine_sites(&spelled, "MyDeg"), truth, "spelled out");
    assert_eq!(count(&spelled, "MyDeg"), Some(truth.len()));

    // One N after the last base: no site of either strand can hold it (both end in a fixed base),
    // so the sites are the same, now found base by base.
    let with_n = format!("{exact}N");
    let by_base = scan(&with_n, Topology::Linear, std::slice::from_ref(&e));
    assert_eq!(engine_sites(&by_base, "MyDeg"), truth, "base by base");
    assert_eq!(count(&by_base, "MyDeg"), Some(truth.len()));
    assert_eq!(oracle(&with_n, false, &e), truth);

    // N letters inside sites, where the motif's own N reads them: base by base against the oracle,
    // linear and circular, the planted sites still found.
    let mut b = exact.clone().into_bytes();
    b[2] = b'N';
    b[123] = b'N';
    b[253] = b'N';
    let holding_n = String::from_utf8(b).unwrap();
    for circular in [false, true] {
        let topology = if circular { Topology::Circular } else { Topology::Linear };
        let s = scan(&holding_n, topology, std::slice::from_ref(&e));
        let truth = oracle(&holding_n, circular, &e);
        for planted in [(1usize, 1i8), (121, 1), (251, -1)] {
            assert!(truth.iter().any(|r| (r.0, r.1) == planted), "{planted:?} holds an N and is a site");
        }
        assert_eq!(engine_sites(&s, "MyDeg"), truth, "holding N, circular {circular}");
        assert_eq!(count(&s, "MyDeg"), Some(truth.len()));
    }

    // A letter the scan cannot read: no sites, one warning naming it and the letter, no site count.
    let unread = custom("MyOdd", "GAXTC", 1, 4);
    let unread_two = custom("MyOdder", "GJ1TC", 1, 4);
    let known = custom("MyGac", "GACTTC", 2, 5);
    let absent = custom("MyNone", "CCCCCC", 1, 5);
    let enzymes = [unread.clone(), known.clone(), unread_two.clone(), absent.clone()];
    let seq = format!("{}GACTTC{}GAATCGAGTC{}", a(8), a(8), a(8));
    for topology in [Topology::Linear, Topology::Circular] {
        let s = scan(&seq, topology, &enzymes);
        assert!(s.sites.iter().all(|c| c.enzyme.name != "MyOdd" && c.enzyme.name != "MyOdder"));
        let names: Vec<&str> = s.site_counts.iter().map(|c| c.enzyme.as_str()).collect();
        assert_eq!(names, vec!["MyGac", "MyNone"], "{topology:?}");
        assert_eq!((count(&s, "MyGac"), count(&s, "MyNone")), (Some(1), Some(0)));
        for (name, letters) in [("MyOdd", vec!["X"]), ("MyOdder", vec!["J", "1"])] {
            let said: Vec<&String> = s.warnings.iter().filter(|w| w.contains(&format!("{name} "))).collect();
            assert_eq!(said.len(), 1, "one sentence names {name}: {:?}", s.warnings);
            for l in &letters {
                assert!(said[0].contains(&format!("'{l}'")), "{name}'s sentence names {l}: {}", said[0]);
            }
            let plural = if letters.len() == 1 { "which is not a base code" } else { "which are not base codes" };
            assert!(said[0].contains(plural), "{}", said[0]);
        }
        assert_eq!(s.warnings.len(), 2, "{:?}", s.warnings);
        assert!(s.capped_enzymes.is_empty() && !s.stopped_early);
    }
    // The noncutter list reads the same pass: it names the enzyme that does not cut, not the ones
    // it could not read.
    let names = |v: Vec<RestrictionEnzyme>| v.into_iter().map(|e| e.name).collect::<Vec<_>>();
    assert_eq!(names(find_non_cutting_enzymes(&seq, Some(&enzymes))), vec!["MyNone"]);
    assert_eq!(names(find_non_cutting_enzymes_for_topology(&seq, Topology::Linear, Some(&enzymes))), vec!["MyNone"]);
}

// BG-01M7GN42: the scan reads U as T in a motif, so a motif that equals its own reverse complement
// once U is read as T is a palindrome, found once per occurrence on the forward strand, and every
// other U motif is read exactly as its T spelling. A site keeps the motif as the user typed it.

/// The bug's reproduction: EcoRI's site twice in a pUC-like stretch, at 1 and 64.
const GN42_SEQ: &str =
    "GAATTCGGATCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTG";

/// Every reading of `name` plus its site count and blocked count, so two enzymes compare whole.
fn whole(scan: &RestrictionSiteScan, name: &str) -> (Vec<(usize, i8, usize, usize, String, String, bool)>, Option<(usize, usize)>) {
    let sites = scan
        .sites
        .iter()
        .filter(|s| s.enzyme.name == name)
        .map(|s| (s.position, s.strand, s.cut_top, s.cut_bottom, s.overhang_seq.clone(), s.overhang_type.clone(), s.methylation_blocked))
        .collect();
    let counted = scan.site_counts.iter().find(|c| c.enzyme == name).map(|c| (c.sites, c.methylation_blocked));
    (sites, counted)
}

/// AC1: GAAUUC, gaauuc and GaAuUc report EcoRI-shaped GAATTC's two sites and count, each once on
/// the forward strand, linear and circular, and each site keeps the motif as it was typed.
#[test]
fn bg_01m7gn42_ac1_a_u_spelled_palindrome_reports_the_sites_and_count_of_its_t_spelling() {
    let t = custom("Thymine", "GAATTC", 1, 5);
    let spellings = [custom("Uracil", "GAAUUC", 1, 5), custom("Lower", "gaauuc", 1, 5), custom("Mixed", "GaAuUc", 1, 5)];
    let expected = vec![site(1, 1, 2, 6, "AATT", "5prime"), site(64, 1, 65, 69, "AATT", "5prime")];
    for topology in [Topology::Linear, Topology::Circular] {
        let mut enzymes = vec![t.clone()];
        enzymes.extend(spellings.iter().cloned());
        let s = scan(GN42_SEQ, topology, &enzymes);
        assert_eq!(reading(&s, "Thymine"), expected, "{topology:?}: the T spelling, by hand");
        assert_eq!(count(&s, "Thymine"), Some(2));
        for u in &spellings {
            assert_eq!(reading(&s, &u.name), expected, "{topology:?}: {} {}", u.name, u.recognition_seq);
            assert_eq!(whole(&s, &u.name), whole(&s, "Thymine"), "{topology:?}: {}", u.name);
            assert_eq!(count(&s, &u.name), Some(2), "{topology:?}: {} counted once per occurrence", u.name);
            for c in s.sites.iter().filter(|c| c.enzyme.name == u.name) {
                assert_eq!(c.enzyme.recognition_seq, u.recognition_seq, "a site shows the motif as typed");
                assert_eq!(c.strand, 1);
            }
        }
        assert!(s.warnings.is_empty(), "{:?}", s.warnings);
        // Alone, each spelling counts the same two sites, and none is listed as a noncutter.
        for u in &spellings {
            let alone = scan(GN42_SEQ, topology, std::slice::from_ref(u));
            assert_eq!(count(&alone, &u.name), Some(2), "{topology:?}: {} alone", u.name);
        }
    }
    assert!(find_non_cutting_enzymes_for_topology(GN42_SEQ, Topology::Linear, Some(&spellings)).is_empty());

    // A degenerate U palindrome is matched base by base (4,096 spellings): its sites are the T
    // spelling's and the oracle's, forward only, linear and circular.
    let mut b = bases(300, 0x6e42_0001).into_bytes();
    for at in [0usize, 90, 200, 291] {
        b[at + 3..at + 9].copy_from_slice(b"GAATTC");
    }
    let planted = String::from_utf8(b).unwrap();
    let t_deg = custom("ThyDeg", "NNNGAATTCNNN", 4, 8);
    let u_deg = custom("UraDeg", "NNNgaAUuCNNN", 4, 8);
    for circular in [false, true] {
        let topology = if circular { Topology::Circular } else { Topology::Linear };
        let s = scan(&planted, topology, &[t_deg.clone(), u_deg.clone()]);
        let truth = oracle(&planted, circular, &t_deg);
        assert!(truth.len() >= if circular { 4 } else { 3 } && truth.iter().all(|r| r.1 == 1), "{truth:?}");
        assert_eq!(engine_sites(&s, "UraDeg"), truth, "circular {circular}");
        assert_eq!(whole(&s, "UraDeg"), whole(&s, "ThyDeg"), "circular {circular}");
        assert_eq!(count(&s, "UraDeg"), Some(truth.len()));
    }
}

/// AC1's boundary: a U motif that is not its own reverse complement (GACUUC, gacuuc) is still read
/// on both strands, exactly as GACTTC is, so U alone never makes a motif a palindrome.
#[test]
fn bg_01m7gn42_ac1_u_spelled_palindrome_rule_leaves_a_non_palindrome_on_both_strands() {
    let seq = format!("{}GACTTC{}GAAGTC{}", a(4), a(4), a(4));
    let expected = vec![site(5, 1, 6, 10, "ACTT", "5prime"), site(15, -1, 16, 20, "AAGT", "5prime")];
    let t = custom("Thymine", "GACTTC", 1, 5);
    let us = [custom("Uracil", "GACUUC", 1, 5), custom("Lower", "gacuuc", 1, 5)];
    for topology in [Topology::Linear, Topology::Circular] {
        let s = scan(&seq, topology, &[t.clone(), us[0].clone(), us[1].clone()]);
        assert_eq!(reading(&s, "Thymine"), expected, "{topology:?}");
        for u in &us {
            assert_eq!(reading(&s, &u.name), expected, "{topology:?}: {}", u.name);
            assert_eq!(count(&s, &u.name), Some(2), "{topology:?}: {}", u.name);
        }
    }
}

/// AC1 for the catalogue: no built-in motif holds a U, so the scan reads each as before; and every
/// built-in holding a T, copied with each T written U (upper, then lower case), reports exactly the
/// built-in's sites, counts and blocked counts, palindromes and non-palindromes alike.
#[test]
fn bg_01m7gn42_ac1_u_spelled_palindrome_fix_reads_every_built_in_as_its_u_spelling() {
    let catalog = get_rebase_enzymes();
    assert!(catalog.iter().all(|e| !e.recognition_seq.contains(['U', 'u'])), "a built-in holds a U");
    let seq = bases(6000, 0x6e42_0002);
    let mut enzymes = Vec::new();
    for e in catalog.iter().filter(|e| e.recognition_seq.contains('T')) {
        for (tag, rec) in [("T", e.recognition_seq.clone()), ("U", e.recognition_seq.replace('T', "U")), ("u", e.recognition_seq.replace('T', "u"))] {
            let mut c = e.clone();
            c.name = format!("{tag}:{}", e.name);
            c.recognition_seq = rec;
            enzymes.push(c);
        }
    }
    assert!(enzymes.len() >= 3 * 100, "{} copies", enzymes.len());
    let (mut palindromes, mut reverse_sites) = (0usize, 0usize);
    for topology in [Topology::Linear, Topology::Circular] {
        let s = scan(&seq, topology, &enzymes);
        assert!(s.warnings.is_empty(), "{:?}", s.warnings);
        for e in catalog.iter().filter(|e| e.recognition_seq.contains('T')) {
            let t = whole(&s, &format!("T:{}", e.name));
            assert!(t.1.is_some(), "{} counted", e.name);
            assert_eq!(whole(&s, &format!("U:{}", e.name)), t, "{topology:?}: {} as U", e.name);
            assert_eq!(whole(&s, &format!("u:{}", e.name)), t, "{topology:?}: {} as u", e.name);
            if revcomp(&e.recognition_seq) == e.recognition_seq && !t.0.is_empty() {
                palindromes += 1;
            }
            reverse_sites += t.0.iter().filter(|r| r.1 == -1).count();
        }
    }
    assert!(palindromes >= 20 && reverse_sites >= 20, "the fixture reaches both: {palindromes} {reverse_sites}");
}
