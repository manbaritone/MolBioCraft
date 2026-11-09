// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1P2: a genome scan's count is the number it found, not the length of a capped list.
//! The STR scan reports every locus, and the repeat scan ranks direct and inverted repeats
//! together before it cuts its list, reporting the total it found and saying when it cut.
//! BG-01M6SQ9T: the repeat scan stops after comparing 10,000,000 copy pairs (D0055), so it no
//! longer compares the more than a hundred million that 250 kb of a diverged simple satellite,
//! such as HSat3's (GGAAT)n, holds; past that bound its total is a lower bound and it says so, and
//! under it the scan is exact. The bound is checked on
//! the scan's own count of the pairs it visited, and on which pairs its list came from, not on wall
//! time.
//! Every sequence is generated here from a fixed seed.

use molbiocraft_core::genome_index::scan_genomic_repeats_with_visit_bound;
use molbiocraft_core::{
    reverse_complement_iupac, scan_genomic_repeats, scan_microsatellite_strs, GenomicRepeatHit,
    GenomicRepeatScan,
};

/// `n` pseudo-random bases (xorshift64), the same for the same seed.
fn random_bases(n: usize, seed: u64) -> Vec<u8> {
    let mut x = seed;
    (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x % 4) as usize]
        })
        .collect()
}

/// 400 (CA)6 loci, one every 300 bp of a 120 kb sequence: the old scan stopped at its 250th locus,
/// about 73 kb in, so the rest were never reported. Each locus is flanked by GG and TT, which
/// no dinucleotide unit of the locus continues into, so it is found at exactly its 12 bases.
#[test]
fn str_scan_reports_all_planted_loci_or_the_total() {
    let mut bases = random_bases(120_000, 0x57a1_0c15);
    let planted: Vec<usize> = (0..400).map(|t| 150 + 300 * t).collect();
    for &s in &planted {
        bases[s - 2..s].copy_from_slice(b"GG");
        bases[s..s + 12].copy_from_slice(b"CACACACACACA");
        bases[s + 12..s + 14].copy_from_slice(b"TT");
    }
    let seq = String::from_utf8(bases).unwrap();
    // the Genomics studio's call: loci of four or more units, homopolymers left out
    let loci = scan_microsatellite_strs(&seq, 4, 1_000_000);
    for &s in &planted {
        assert!(
            loci.iter().any(|l| l.motif == "CA" && l.period_bp == 2 && l.repeat_units == 6 && l.start_bp == s + 1 && l.end_bp == s + 12),
            "the (CA)6 planted at base {} is not reported ({} loci)",
            s + 1,
            loci.len()
        );
    }
    assert!(loci.len() >= planted.len(), "{} loci", loci.len());
    // the list runs to the end of the sequence, in order, numbered from 1
    assert!(loci.windows(2).all(|w| w[0].end_bp < w[1].start_bp));
    assert!(loci.iter().enumerate().all(|(i, l)| l.id == format!("str-{}", i + 1)));
    // fixture: the old scan's 250th locus came before the one planted at base 73,051, so it lost
    // that one and the 156 after it
    assert_eq!(planted.iter().filter(|&&s| s + 1 >= 73_051).count(), 157);
}

/// One planted repeat: its arms' 0-based starts, and whether the second arm is the reverse
/// complement of the first.
struct Planted {
    arm1: usize,
    arm2: usize,
    inverted: bool,
}

/// The planted repeat a hit reports, when it covers both of its 30-bp arms.
fn planted_of<'a>(hit: &GenomicRepeatHit, planted: &'a [Planted]) -> Option<&'a Planted> {
    planted.iter().find(|p| {
        hit.arm1_start_bp <= p.arm1 + 1 && hit.arm1_end_bp >= p.arm1 + 30 && hit.arm2_start_bp <= p.arm2 + 1 && hit.arm2_end_bp >= p.arm2 + 30
    })
}

/// 100 direct and 20 inverted repeats with 30-bp arms, an inverted one every sixth pair along a
/// 24 kb sequence. With an 80-hit list the old scan filled the list with direct repeats before it
/// looked for an inverted one, and reported each inverted repeat as many 20-bp seeds; ranked on
/// equal terms by arm length and position, the 80 longest hold both kinds, and the scan reports
/// the 120 it found and that it listed only 80.
#[test]
fn repeat_scan_reports_direct_and_inverted_repeats() {
    let mut bases = random_bases(24_200, 0x9e37_79b9);
    let mut planted = Vec::new();
    for t in 0..120usize {
        let arm = random_bases(30, 0x1234_5678 + t as u64 * 0x1000_0001);
        let (arm1, arm2, inverted) = (200 * t + 20, 200 * t + 110, t % 6 == 5);
        bases[arm1..arm1 + 30].copy_from_slice(&arm);
        let mate = if inverted {
            reverse_complement_iupac(std::str::from_utf8(&arm).unwrap(), false).into_bytes()
        } else {
            arm
        };
        bases[arm2..arm2 + 30].copy_from_slice(&mate);
        planted.push(Planted { arm1, arm2, inverted });
    }
    assert_eq!(planted.iter().filter(|p| p.inverted).count(), 20);
    let seq = String::from_utf8(bases).unwrap();
    let kind = |h: &GenomicRepeatHit| h.repeat_type == "Inverted Repeat";

    // every repeat listed, when the list holds them all: each planted repeat once, as its kind,
    // the inverted ones with their whole 30-bp arms
    let all = scan_genomic_repeats(&seq, 20, 200);
    assert_eq!((all.hits.len(), all.total_hits), (120, 120), "{:?}", all.hits);
    assert!(all.warnings.is_empty(), "{:?}", all.warnings);
    let mut seen = vec![false; planted.len()];
    for h in &all.hits {
        let p = planted_of(h, &planted).unwrap_or_else(|| panic!("not a planted repeat: {h:?}"));
        let idx = planted.iter().position(|q| std::ptr::eq(q, p)).unwrap();
        assert!(!seen[idx], "reported twice: {h:?}");
        seen[idx] = true;
        assert_eq!(kind(h), p.inverted, "{h:?}");
        assert!(h.arm_length_bp >= 30, "{h:?}");
    }

    // the Genomics studio's 80-hit list: both kinds, ranked together, and it says it was capped
    let capped = scan_genomic_repeats(&seq, 20, 80);
    assert_eq!((capped.hits.len(), capped.total_hits), (80, 120));
    let inverted = capped.hits.iter().filter(|h| kind(h)).count();
    assert!(inverted > 0 && inverted < 80, "{inverted} inverted of 80");
    assert!(capped.hits.iter().all(|h| planted_of(h, &planted).is_some()), "{:?}", capped.hits);
    assert!(capped.hits.windows(2).all(|w| (w[0].arm_length_bp, std::cmp::Reverse(w[0].arm1_start_bp)) >= (w[1].arm_length_bp, std::cmp::Reverse(w[1].arm1_start_bp))));
    // the 80 listed are the 80 longest the full list holds
    let mut lengths: Vec<usize> = all.hits.iter().map(|h| h.arm_length_bp).collect();
    lengths.sort_unstable_by(|a, b| b.cmp(a));
    let mut listed: Vec<usize> = capped.hits.iter().map(|h| h.arm_length_bp).collect();
    listed.sort_unstable_by(|a, b| b.cmp(a));
    assert_eq!(listed, lengths[..80]);
    assert_eq!(
        capped.warnings,
        ["Repeat list capped: it shows the 80 longest of the 120 repeats found."]
    );
    assert!(capped.hits.iter().enumerate().all(|(i, h)| h.id == format!("rep-{}", i + 1)));

    // Many copies of one element, and low-complexity runs: every copy pair of every k-mer counts,
    // so the total is the number of repeats there are and the list holds the longest of them. The
    // round-1 scan indexed each k-mer at its first 8 positions, so it missed most pairs between
    // later copies and most of a low-complexity run's own repeats, yet called its list the longest.
    let element_copies = high_copy_fixture();
    let runs = maximal_runs(&element_copies);
    // fixture: more than 150 pairs of copies share an arm of at least 290 bases (the 300-bp
    // element; a pair with the copy holding an N is cut there), far more than the list's 80, and
    // the poly-A's 20-mer occurs more than 100 times, far more than 8
    let long_pairs = expected_repeats(&runs, 20).iter().filter(|r| r.0 .0 >= 290).count();
    assert!(long_pairs > 150, "fixture: {long_pairs} long copy pairs");
    let poly_a = element_copies.windows(20).filter(|w| w.iter().all(|&b| b == b'A')).count();
    assert!(poly_a > 100, "fixture: A x 20 occurs {poly_a} times");
    for (min_arm, max_hits) in [(20, 80), (20, 200), (10, 80)] {
        let scan = scan_genomic_repeats(std::str::from_utf8(&element_copies).unwrap(), min_arm, max_hits);
        assert_same_as_brute_force(&scan, &runs, min_arm, max_hits, "many copies of one element");
        if (min_arm, max_hits) == (20, 80) {
            // the reviewer's case: the 80 listed are pairs of copies, at arms of 290 bases or more
            assert!(scan.hits.iter().all(|h| h.arm_length_bp >= 290), "{:?}", scan.hits);
        }
    }

    // long low-complexity runs (a homopolymer, a dinucleotide that is its own reverse complement,
    // another that is not) and a 1,000-bp assembly gap, whose N bases match nothing
    let low = low_complexity_fixture();
    let low_runs = maximal_runs(&low);
    let a_mers = low.windows(20).filter(|w| w.iter().all(|&b| b == b'A')).count();
    assert!(a_mers > 2_000, "fixture: A x 20 occurs {a_mers} times");
    for (min_arm, max_hits) in [(20, 80), (20, 200), (10, 80)] {
        let scan = scan_genomic_repeats(std::str::from_utf8(&low).unwrap(), min_arm, max_hits);
        assert_same_as_brute_force(&scan, &low_runs, min_arm, max_hits, "low-complexity runs");
        assert!(scan.hits.iter().all(|h| !h.sequence_motif.contains('N')), "{:?}", scan.hits);
    }
}

/// A maximal run of the dot plot. Direct: bases `a + t` and `b + t` match for `t < len` and not
/// one base before (or there is none). Inverted: bases `a + t` and `b - t` pair for `t < len`
/// while `a + t < b - t`, and not one base further out (or there is none).
struct DotPlotRun {
    inverted: bool,
    a: usize,
    b: usize,
    len: usize,
}

/// Every maximal run of `s`'s dot plot, found by walking each diagonal (bases `d` apart that are
/// the same known base) and each anti-diagonal (bases that pair): a count of the sequence's
/// repeats that uses no k-mer index and no seed, to check the scan against. Only A, C, G and T
/// match or pair: `same[t]` is base t, and `mate[t]` the base it pairs with, or 0 (which no base
/// equals) when base t is not one of them.
fn maximal_runs(s: &[u8]) -> Vec<DotPlotRun> {
    let n = s.len();
    let pair = |b: u8| match b {
        b'A' => b'T',
        b'C' => b'G',
        b'G' => b'C',
        b'T' => b'A',
        _ => 0,
    };
    let mate: Vec<u8> = s.iter().map(|&b| pair(b)).collect();
    let same: Vec<u8> = s.iter().map(|&b| if pair(b) != 0 { b } else { 0 }).collect();
    let mut runs = Vec::new();
    for d in 1..n {
        let mut start = usize::MAX;
        for a in 0..=(n - d) {
            let hit = a + d < n && same[a] == s[a + d];
            if hit && start == usize::MAX {
                start = a;
            } else if !hit && start != usize::MAX {
                runs.push(DotPlotRun { inverted: false, a: start, b: start + d, len: a - start });
                start = usize::MAX;
            }
        }
    }
    for sum in 1..(2 * n - 2) {
        let (mut start, mut len) = (usize::MAX, 0);
        let mut a = sum.saturating_sub(n - 1);
        while a < sum - a {
            if mate[sum - a] == s[a] {
                if start == usize::MAX {
                    (start, len) = (a, 0);
                }
                len += 1;
            } else if start != usize::MAX {
                runs.push(DotPlotRun { inverted: true, a: start, b: sum - start, len });
                start = usize::MAX;
            }
            a += 1;
        }
        if start != usize::MAX {
            runs.push(DotPlotRun { inverted: true, a: start, b: sum - start, len });
        }
    }
    runs
}

/// The repeats with a minimum arm of `k` (8 to 32) among `runs`, as (arm length, 0-based arm 1
/// start, 0-based arm 2 start, inverted), best first. A direct run is a repeat when it is at least
/// `k` long and its arms are more than `k` bases apart, its arm cut where arm 1 would reach arm
/// 2; an inverted run is one when it is at least `k` long and its outer arms of `k` do not overlap.
#[allow(clippy::type_complexity)]
fn expected_repeats(runs: &[DotPlotRun], k: usize) -> Vec<(std::cmp::Reverse<usize>, usize, usize, bool)> {
    let mut out: Vec<_> = runs
        .iter()
        .filter_map(|r| {
            if !r.inverted && r.b - r.a > k && r.len >= k {
                Some((std::cmp::Reverse(r.len.min(r.b - r.a)), r.a, r.b, false))
            } else if r.inverted && r.len >= k && r.b + 1 >= r.a + 2 * k {
                Some((std::cmp::Reverse(r.len), r.a, r.b + 1 - r.len, true))
            } else {
                None
            }
        })
        .collect();
    out.sort_unstable();
    out
}

/// `n` written with its digits grouped in threes, as the scan's warnings write a count.
fn grouped(n: usize) -> String {
    let digits = n.to_string();
    digits.chars().enumerate().fold(String::new(), |mut out, (i, c)| {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
        out
    })
}

/// The scan reports the dot plot's total and lists exactly its `max_hits` best repeats, each at
/// its whole arm and named for its kind, and says when the list holds fewer than it found.
fn assert_same_as_brute_force(scan: &molbiocraft_core::GenomicRepeatScan, runs: &[DotPlotRun], min_arm: usize, max_hits: usize, what: &str) {
    let expected = expected_repeats(runs, min_arm);
    assert!(expected.len() > max_hits, "fixture ({what}, {min_arm} bp): {} repeats", expected.len());
    assert_eq!(scan.total_hits, expected.len(), "{what}, {min_arm} bp: total");
    let listed: Vec<_> = scan
        .hits
        .iter()
        .map(|h| (std::cmp::Reverse(h.arm_length_bp), h.arm1_start_bp - 1, h.arm2_start_bp - 1, h.repeat_type != "Direct Repeat"))
        .collect();
    assert_eq!(listed, expected[..max_hits], "{what}, {min_arm} bp, {max_hits} listed");
    for h in &scan.hits {
        assert_eq!((h.arm1_end_bp, h.arm2_end_bp), (h.arm1_start_bp + h.arm_length_bp - 1, h.arm2_start_bp + h.arm_length_bp - 1), "{h:?}");
        let spacer = h.arm2_start_bp - h.arm1_end_bp - 1;
        let kind = match h.repeat_type.as_str() {
            "Direct Repeat" => true,
            "Palindromic Stem" => spacer <= 4,
            "Inverted Repeat" => spacer > 4,
            _ => false,
        };
        assert!(kind, "{h:?}");
    }
    assert_eq!(
        scan.warnings,
        [format!("Repeat list capped: it shows the {max_hits} longest of the {} repeats found.", grouped(expected.len()))],
        "{what}, {min_arm} bp"
    );
}

/// 9,600 bp holding 20 copies of a 300-bp element, every fourth one reverse-complemented, so 190
/// pairs of copies are repeats (115 direct, 75 inverted): the first copy at base 1 and the last,
/// reverse-complemented, ending at the last base, an N after each of the first three copies and
/// before the second and third, an N at the middle of the sixth, and a 150-bp poly-A and a (CA)60
/// between the last two copies.
fn high_copy_fixture() -> Vec<u8> {
    let n = 9_600;
    let mut s = random_bases(n, 0x0e1e_3e47);
    let element = random_bases(300, 0x0a1e_0300);
    let rc = reverse_complement_iupac(std::str::from_utf8(&element).unwrap(), false).into_bytes();
    for c in 0..20usize {
        let at = if c == 19 { n - 300 } else { 450 * c };
        s[at..at + 300].copy_from_slice(if c % 4 == 3 { &rc } else { &element });
        if (1..=2).contains(&c) {
            s[at - 1] = b'N';
        }
        if c <= 2 {
            s[at + 300] = b'N';
        }
    }
    s[5 * 450 + 150] = b'N';
    s[8_599] = b'C';
    s[8_600..8_750].fill(b'A');
    s[8_750] = b'G';
    let ca: Vec<u8> = b"CA".iter().copied().cycle().take(120).collect();
    s[8_800..8_920].copy_from_slice(&ca);
    s
}

/// The visit bound the studio's scan runs under (D0055), a number of copy pairs compared. It was set
/// from a 250 ms budget at the 46.5 million pairs per second the Sprint 5 goal-review seats
/// measured on the HSat3-like array; it bounds pairs, not time.
const STUDIO_VISIT_BOUND: usize = 10_000_000;

/// The sentence a scan that stopped at `visits` copy pairs, at arms of `arm` bases, warns with.
fn stop_sentence(visits: usize, arm: usize) -> String {
    format!(
        "The repeat scan stopped after comparing {} copy pairs at arms of {arm} bp; the total is a lower bound and the list holds the longest repeats found before it stopped.",
        grouped(visits)
    )
}

/// The sentence that follows the stop sentence when the scan stopped before it compared any
/// inverted pair: the list, captioned "Direct, Inverted & Palindromic Repeats", holds no inverted or
/// palindromic repeat because none was compared, not because the sequence has none.
const NOT_COMPARED: &str = "Inverted and palindromic repeats were not compared: the scan compares direct repeats first and stopped before it reached them, so the list holds direct repeats only.";

/// The direct repeats of `s`, a sequence of A, C, G and T only, with arms of at least `k` bases, as
/// (arm length, 0-based arm 1 start, 0-based arm 2 start), in order of arm 1's start: every pair of
/// starts more than `k` apart of the same k-mer whose bases before differ (or arm 1 starts the
/// sequence), the arm extended while the bases match, as far as arm 1 can go before it reaches arm
/// 2 and arm 2 before the end. Found from a plain map of each k-mer's positions, with no flank
/// classes and no bound, to check which pairs a bounded scan compared: the scan compares the direct
/// repeats first, in order of arm 1's start.
fn direct_repeats_by_arm1(s: &[u8], k: usize) -> Vec<(usize, usize, usize)> {
    assert!(s.iter().all(|b| b"ACGT".contains(b)), "fixture: A, C, G and T only");
    let mut at: std::collections::HashMap<&[u8], Vec<usize>> = std::collections::HashMap::new();
    for i in 0..=s.len() - k {
        at.entry(&s[i..i + k]).or_default().push(i);
    }
    let mut out = Vec::new();
    for i in 0..=s.len() - k {
        for &j in &at[&s[i..i + k]] {
            if j > i + k && (i == 0 || s[i - 1] != s[j - 1]) {
                let reach = (j - i).min(s.len() - j);
                out.push(((0..reach).take_while(|&t| s[i + t] == s[j + t]).count(), i, j));
            }
        }
    }
    out
}

/// A scan's list as (arm length, 0-based arm 1 start, 0-based arm 2 start, inverted), best first.
#[allow(clippy::type_complexity)]
fn listed(scan: &GenomicRepeatScan) -> Vec<(std::cmp::Reverse<usize>, usize, usize, bool)> {
    scan.hits
        .iter()
        .map(|h| (std::cmp::Reverse(h.arm_length_bp), h.arm1_start_bp - 1, h.arm2_start_bp - 1, h.repeat_type != "Direct Repeat"))
        .collect()
}

/// The best `m` of some direct repeats, as [`listed`] gives a list.
#[allow(clippy::type_complexity)]
fn best_direct(repeats: &[(usize, usize, usize)], m: usize) -> Vec<(std::cmp::Reverse<usize>, usize, usize, bool)> {
    let mut out: Vec<_> = repeats.iter().map(|&(len, i, j)| (std::cmp::Reverse(len), i, j, false)).collect();
    out.sort_unstable();
    out.truncate(m);
    out
}

/// `bases` with each base, at the given rate, replaced by one of the three others (xorshift64).
fn substituted(mut bases: Vec<u8>, rate_per_mille: u64, seed: u64) -> Vec<u8> {
    let mut x = seed;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    for b in bases.iter_mut() {
        if next() % 1000 < rate_per_mille {
            let at = b"ACGT".iter().position(|c| c == b).unwrap_or(0) as u64;
            *b = b"ACGT"[((at + 1 + next() % 3) % 4) as usize];
        }
    }
    bases
}

/// `n` bases of `unit` copied end to end, with `rate_per_mille` of them substituted: a satellite
/// array such as HSat3's diverged (GGAAT)n.
fn satellite_array(unit: &[u8], n: usize, rate_per_mille: u64, seed: u64) -> Vec<u8> {
    substituted(unit.iter().copied().cycle().take(n).collect(), rate_per_mille, seed)
}

/// The fraction of bases at which `a` and `b` differ.
fn divergence(a: &[u8], b: &[u8]) -> f64 {
    a.iter().zip(b).filter(|(x, y)| x != y).count() as f64 / a.len().min(b.len()) as f64
}

/// The JSON a scan replies with, to compare two scans field by field.
fn json(scan: &GenomicRepeatScan) -> serde_json::Value {
    serde_json::to_value(scan).unwrap()
}

/// Whether a listed repeat is one the sequence holds: its arms the same bases (direct) or each
/// other's reverse complement (inverted), and not one base longer at its outer ends.
fn holds_repeat(s: &[u8], h: &GenomicRepeatHit) -> bool {
    let (a, b, len) = (h.arm1_start_bp - 1, h.arm2_start_bp - 1, h.arm_length_bp);
    let (arm1, arm2) = (&s[a..a + len], &s[b..b + len]);
    if h.repeat_type == "Direct Repeat" {
        arm1 == arm2 && (a == 0 || s[a - 1] != s[b - 1])
    } else {
        let rc = reverse_complement_iupac(std::str::from_utf8(arm2).unwrap(), false).into_bytes();
        let pairs = |x: u8, y: u8| matches!((x, y), (b'A', b'T') | (b'T', b'A') | (b'C', b'G') | (b'G', b'C'));
        arm1 == rc.as_slice() && (a == 0 || b + len >= s.len() || !pairs(s[a - 1], s[b + len]))
    }
}

/// BG-01M6SQ9T AC1: on satellite arrays whose copy pairs number over a hundred million the scan
/// stops at the bound, counted as it visits each pair, and says that its total is a lower
/// bound and its list the longest found before it stopped. The bound is enforced in the pair loops:
/// lowered to 1,000, the list is the best of the first 1,000 pairs the scan visits, found here
/// without the scan, not the best of every pair. A scan that visited every pair and only cut the
/// number it reports afterwards lists the best of every pair, and fails here.
#[test]
fn repeat_scan_bounds_its_visits_on_satellite_arrays() {
    // the bound is enforced as the scan counts, on any sequence: lowered to 1,000 on 60 kb of
    // random bases, which hold more than 2,000 repeats of a 10-bp arm, the count stops at 1,000
    let random = random_bases(60_000, 0x60_0000_5eed);
    let text = std::str::from_utf8(&random).unwrap();
    let (whole, all_visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, usize::MAX);
    assert!(!whole.total_is_lower_bound && whole.total_hits == all_visits, "{}", whole.total_hits);
    assert!(all_visits > 2_000, "fixture: {all_visits} repeats");
    let (low, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, 1_000);
    assert_eq!((visits, low.total_hits, low.total_is_lower_bound), (1_000, 1_000, true));
    assert_eq!(low.warnings, [stop_sentence(1_000, 10), NOT_COMPARED.to_string()]);
    assert_eq!(low.hits.len(), 80);
    assert!(low.hits.iter().all(|h| holds_repeat(&random, h)), "{:?}", low.hits);
    // which pairs the list came from: the scan visits direct repeats first, in order of arm 1's
    // start, and the 1,000th and 1,001st of them start at different bases, so the first 1,000 it
    // visits are these, whatever order it takes among the pairs of one arm 1. Its list is their
    // best 80, every repeat in it among them, not the best 80 of the whole sequence
    let direct = direct_repeats_by_arm1(&random, 10);
    assert!(direct.len() > 1_000 && direct[999].1 != direct[1_000].1, "fixture: {} direct repeats", direct.len());
    let first = &direct[..1_000];
    assert_eq!(listed(&low), best_direct(first, 80), "the list is not the best 80 of the first 1,000 pairs visited");
    assert!(low.hits.iter().all(|h| first.iter().any(|&(len, i, j)| (len, i, j) == (h.arm_length_bp, h.arm1_start_bp - 1, h.arm2_start_bp - 1))));
    assert_ne!(listed(&low), listed(&whole), "the bounded list is the unbounded one");
    // a bound the scan reaches exactly, with no pair left to compare, leaves the total exact; one
    // pair short of it, the scan stops among the inverted repeats, having compared some of them
    let (exact, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, all_visits);
    assert_eq!(json(&exact), json(&whole));
    assert_eq!(visits, all_visits);
    assert!(!json(&exact).as_object().unwrap().contains_key("totalIsLowerBound"), "an exact reply keeps its five fields");
    let (short, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, all_visits - 1);
    assert_eq!((visits, short.total_hits, short.total_is_lower_bound), (all_visits - 1, all_visits - 1, true));
    assert_eq!(short.warnings, [stop_sentence(all_visits - 1, 10)]);

    let hsat3 = satellite_array(b"GGAAT", 250_000, 100, 0x45a7_3000);
    let ca = satellite_array(b"CA", 250_000, 50, 0x0ca0_0005);
    // fixture: diverged as the arrays the data seat measured (10% and 5% of bases substituted)
    let plain = |unit: &[u8]| unit.iter().copied().cycle().take(250_000).collect::<Vec<u8>>();
    let (d_hsat3, d_ca) = (divergence(&hsat3, &plain(b"GGAAT")), divergence(&ca, &plain(b"CA")));
    assert!((0.09..0.11).contains(&d_hsat3) && (0.045..0.055).contains(&d_ca), "fixture: {d_hsat3}, {d_ca}");
    let capped = "Repeat list capped";
    for (what, seq, arm) in [("HSat3-like", &hsat3, 10), ("HSat3-like", &hsat3, 8), ("(CA)n", &ca, 10)] {
        let text = std::str::from_utf8(seq).unwrap();
        let (scan, visits) = scan_genomic_repeats_with_visit_bound(text, arm, 80, STUDIO_VISIT_BOUND);
        assert_eq!(visits, STUDIO_VISIT_BOUND, "{what}, {arm} bp: copy pairs visited");
        assert_eq!(scan.total_hits, STUDIO_VISIT_BOUND, "{what}, {arm} bp: total");
        assert!(scan.total_is_lower_bound, "{what}, {arm} bp: the total is not marked a lower bound");
        // it stops among the direct repeats, which it compares first, so it says it compared no
        // inverted ones, and lists none
        assert_eq!(scan.warnings, [stop_sentence(STUDIO_VISIT_BOUND, arm), NOT_COMPARED.to_string()], "{what}, {arm} bp");
        assert!(scan.warnings.iter().all(|w| !w.contains(capped)), "{what}, {arm} bp: {:?}", scan.warnings);
        assert!(scan.hits.iter().all(|h| h.repeat_type == "Direct Repeat"), "{what}, {arm} bp: {:?}", scan.hits);
        // the list still holds 80 repeats, longest first, each one the array holds at its whole arm
        assert_eq!(scan.hits.len(), 80, "{what}, {arm} bp");
        assert!(scan.hits.iter().all(|h| h.arm_length_bp >= arm && holds_repeat(seq, h)), "{what}, {arm} bp: {:?}", scan.hits);
        assert!(scan.hits.windows(2).all(|w| w[0].arm_length_bp >= w[1].arm_length_bp), "{what}, {arm} bp");
        // the studio's scan is this one: it runs under the same bound
        assert_eq!(json(&scan_genomic_repeats(text, arm, 80)), json(&scan), "{what}, {arm} bp: the studio's scan");
        // the reply marks its total a lower bound by name
        assert_eq!(json(&scan)["totalIsLowerBound"], serde_json::json!(true));
    }
}

/// BG-01M6SQ9T: the scan compares every direct repeat before any inverted one, so a scan that stops
/// first lists no inverted or palindromic repeat, under a caption that names all three kinds. It
/// then says that it compared none, and only then: on 60 kb of random bases, a bound of exactly
/// the direct repeats' number stops it before its first inverted pair, and one more lets it compare
/// that pair.
#[test]
fn repeat_scan_says_when_it_compared_no_inverted_repeat() {
    let random = random_bases(60_000, 0x60_0000_5eed);
    let text = std::str::from_utf8(&random).unwrap();
    let direct = direct_repeats_by_arm1(&random, 10);
    let d = direct.len();
    let (whole, all_visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, usize::MAX);
    // fixture: inverted repeats follow the direct ones, and some are among the 80 longest, so a
    // list of direct repeats only is not the sequence's list
    assert!(all_visits > d + 1, "fixture: {all_visits} repeats, {d} direct");
    assert!(whole.hits.iter().any(|h| h.repeat_type != "Direct Repeat"), "fixture: {:?}", whole.hits);

    // every direct pair compared and no inverted one: the list is the best 80 direct repeats, and
    // the scan says it compared no inverted repeat
    let (all_direct, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, d);
    assert_eq!((visits, all_direct.total_is_lower_bound), (d, true));
    assert_eq!(all_direct.warnings, [stop_sentence(d, 10), NOT_COMPARED.to_string()]);
    assert_eq!(listed(&all_direct), best_direct(&direct, 80));
    // one inverted pair compared: the scan no longer says it compared none
    let (one_inverted, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, d + 1);
    assert_eq!((visits, one_inverted.total_is_lower_bound), (d + 1, true));
    assert_eq!(one_inverted.warnings, [stop_sentence(d + 1, 10)]);
    // an exact scan says neither
    assert!(whole.warnings.iter().all(|w| w != NOT_COMPARED && !w.starts_with("The repeat scan stopped")), "{:?}", whole.warnings);
}

/// BG-01M6SQ9T AC2: an alpha-satellite-like higher-order-repeat array, the satellite class the data
/// seat measured as interactive (120 ms), compares fewer copy pairs than the bound, so its total and
/// list are those of the scan with no bound at all.
#[test]
fn alpha_satellite_hor_array_stays_exact_under_the_visit_bound() {
    // a 12-monomer HOR of 171-bp monomers: each monomer 14% substituted from one consensus, so two
    // monomers differ at about 25% of bases; each HOR copy 1% substituted from the HOR, so two
    // copies differ at about 2%
    let consensus = random_bases(171, 0xa15a_7171);
    let hor: Vec<u8> = (0..12u64).flat_map(|m| substituted(consensus.clone(), 140, 0x0e0e_0100 + m)).collect();
    let copies = 250_000usize.div_ceil(hor.len());
    let mut array: Vec<u8> = (0..copies as u64).flat_map(|c| substituted(hor.clone(), 10, 0x0c09_1000 + c)).collect();
    array.truncate(250_000);
    let monomer_gap = divergence(&hor[..171], &hor[171..342]);
    let copy_gap = divergence(&array[..hor.len()], &array[hor.len()..2 * hor.len()]);
    assert!((0.20..0.30).contains(&monomer_gap), "fixture: monomers {monomer_gap} apart");
    assert!((0.01..0.03).contains(&copy_gap), "fixture: HOR copies {copy_gap} apart");

    let text = std::str::from_utf8(&array).unwrap();
    let (lifted, visits) = scan_genomic_repeats_with_visit_bound(text, 10, 80, usize::MAX);
    let studio = scan_genomic_repeats(text, 10, 80);
    // fixture: a satellite array, millions of copy pairs, but fewer than the bound
    assert!(visits > 1_000_000 && visits < STUDIO_VISIT_BOUND, "fixture: {visits} copy pairs");
    assert_eq!(lifted.total_hits, visits);
    assert_eq!(json(&studio), json(&lifted), "the bounded scan differs from the scan with no bound");
    assert!(!studio.total_is_lower_bound);
    assert_eq!(studio.warnings, [format!("Repeat list capped: it shows the 80 longest of the {} repeats found.", grouped(visits))]);
    assert_eq!(studio.hits.len(), 80);
}

/// 10,000 random bases holding a 2,500-bp poly-A, a 1,200-bp (AT)n (its own reverse complement,
/// so it is an inverted repeat of itself), an 800-bp (CA)n and a 1,000-bp run of N.
fn low_complexity_fixture() -> Vec<u8> {
    let mut s = random_bases(10_000, 0x10c0_4e11);
    s[999] = b'C';
    s[1_000..3_500].fill(b'A');
    s[3_500] = b'G';
    let at: Vec<u8> = b"AT".iter().copied().cycle().take(1_200).collect();
    s[4_000..5_200].copy_from_slice(&at);
    s[6_000..7_000].fill(b'N');
    let ca: Vec<u8> = b"CA".iter().copied().cycle().take(800).collect();
    s[7_500..8_300].copy_from_slice(&ca);
    s
}
