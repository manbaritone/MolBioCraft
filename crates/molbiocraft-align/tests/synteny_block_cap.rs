// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1P2: the whole-genome synteny scan runs to the end of genome A. It used to stop at its
//! 48th block, so two near-identical genomes split by more than 48 small indels read as partly
//! syntenic. The genomes are generated here from a fixed seed.
//!
//! BG-01M6SKKV: the scan indexes every base of genome B, so after an indel a seed in A reaches the
//! new A-to-B offset whatever its residue. It used to index B every b.len()/300,000 bases and seed
//! A every max(a.len()/200,000, 4), and read 81.9% on the 700 kb pair here and 47% on the 3 Mb one
//! (Mauve). N and the other ambiguity bases stay in place: blocks are in each genome's own
//! numbering, no block crosses one, and coverage is over A's A/C/G/T bases. Each pair carries a
//! truth map, the B position each base of A was copied to, so every block is checked at the B
//! coordinate it was planted at, not only for its length. With every base indexed, the checks on
//! unrelated genomes, a repeated element and an inversion pin how a seed's hit is chosen and when
//! a chance hit is a block.
//!
//! BG-01M6TAB2: a block too short to reach the score floor alone, between two close indels, is
//! kept when it links to the blocks beside it and the chain reaches the floor, and a repeat's copy
//! that follows an indel larger than the resume window is placed on its own copy, on either strand.
//! Round 2: so is a copy that follows a deletion from B, where the scan first seeds the deleted
//! bases of A; and the link cost's junction term is pinned.

use molbiocraft_align::ngs_assembly::run_whole_genome_synteny_with_sampling;
use molbiocraft_align::{run_whole_genome_synteny, WholeGenomeSyntenyReport};

/// A seeded genome A and its copy B, with the B position each base of A was copied to.
struct RelatedPair {
    a: String,
    b: String,
    /// `truth[i]`: the 0-based position in B that base `i` of A was copied to (substituted or
    /// not), `None` for a base deleted from B or an N run put in A.
    truth: Vec<Option<usize>>,
    /// Differences planted: substitutions, and indels that shift the A-to-B offset by an odd and
    /// by an even number of bases.
    substitutions: usize,
    odd_shifts: usize,
    even_shifts: usize,
    /// B holds the copy reverse-complemented: base `i` of A pairs, on the - strand, with the
    /// complement of B's base `truth[i]`.
    reversed: bool,
}

/// A random genome A of `len` bases, and a copy B about 99.5% identical: one difference every
/// 200 bp on average, nine in ten a substitution (about 0.45%) and one in ten a one- to three-base
/// insertion into B or deletion from B. Each indel ends a collinear block.
fn related_pair(len: usize, seed: u64) -> RelatedPair {
    related_pair_shaped(len, seed, |_, _| {})
}

/// [`related_pair`] with A reshaped by `shape` (given the generator) before B is copied from it.
fn related_pair_shaped(len: usize, seed: u64, shape: impl FnOnce(&mut Vec<u8>, &mut dyn FnMut() -> u64)) -> RelatedPair {
    let mut x = seed;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let mut a: Vec<u8> = (0..len).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
    shape(&mut a, &mut next);
    let mut b: Vec<u8> = Vec::with_capacity(a.len() + a.len() / 1_000);
    let mut truth = vec![None; a.len()];
    let (mut substitutions, mut odd_shifts, mut even_shifts) = (0usize, 0usize, 0usize);
    let mut i = 0usize;
    while i < a.len() {
        // one difference every 200 bp on average, one in ten of them an indel
        if i > 0 && next() % 200 == 0 {
            let roll = next();
            if roll % 10 == 0 {
                let size = 1 + (next() % 3) as usize;
                if size % 2 == 1 { odd_shifts += 1 } else { even_shifts += 1 }
                if roll % 20 == 0 {
                    i += size; // deletion from B
                    continue;
                }
                for _ in 0..size {
                    b.push(b"ACGT"[(next() % 4) as usize]); // insertion into B
                }
            } else {
                let base = a[i];
                let other = b"ACGT"[((next() % 3) as usize + 1 + b"ACGT".iter().position(|&c| c == base).unwrap()) % 4];
                truth[i] = Some(b.len());
                b.push(other);
                substitutions += 1;
                i += 1;
                continue;
            }
        }
        truth[i] = Some(b.len());
        b.push(a[i]);
        i += 1;
    }
    RelatedPair {
        a: String::from_utf8(a).unwrap(),
        b: String::from_utf8(b).unwrap(),
        truth,
        substitutions,
        odd_shifts,
        even_shifts,
        reversed: false,
    }
}

/// A 200 kb genome, and a copy about 99.5% identical: about 900 substitutions and about 100 one-
/// to three-base insertions or deletions, spread along it. Each indel ends a collinear block.
fn near_identical_pair() -> (String, String) {
    let pair = related_pair(200_000, 0x5e17_e17a);
    let events = pair.substitutions + pair.odd_shifts + pair.even_shifts;
    assert!((900..=1_100).contains(&events), "fixture: {events} differences");
    (pair.a, pair.b)
}

/// `pair` with a run of `run` N put into A before its base `at_a` and into B before its base
/// `at_b`; the truth map stays in each genome's own numbering, N included.
fn with_n_runs(pair: RelatedPair, at_a: usize, at_b: usize, run: usize) -> RelatedPair {
    let n_run = "N".repeat(run);
    let a = format!("{}{n_run}{}", &pair.a[..at_a], &pair.a[at_a..]);
    let b = format!("{}{n_run}{}", &pair.b[..at_b], &pair.b[at_b..]);
    let shift_b = |p: Option<usize>| p.map(|j| if j >= at_b { j + run } else { j });
    let mut truth: Vec<Option<usize>> = pair.truth[..at_a].iter().map(|&p| shift_b(p)).collect();
    truth.extend(std::iter::repeat_n(None, run));
    truth.extend(pair.truth[at_a..].iter().map(|&p| shift_b(p)));
    RelatedPair { a, b, truth, ..pair }
}

/// `len` random bases from a fixed seed, drawn as [`related_pair`] draws A.
fn random_genome(len: usize, seed: u64) -> String {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x % 4) as usize] as char
        })
        .collect()
}

/// A random genome A of `len` bases, and a copy B with a one- to three-base insertion into B or
/// deletion from B before each base of A with probability 1/`every` (one indel every `every` bp
/// on average, many of them closer), and about 0.45% of the bases copied substituted.
fn indel_dense_pair(len: usize, every: u64, seed: u64) -> RelatedPair {
    let mut x = seed;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let a: Vec<u8> = (0..len).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
    let mut b: Vec<u8> = Vec::with_capacity(len + len / every as usize);
    let mut truth = vec![None; len];
    let (mut substitutions, mut odd_shifts, mut even_shifts) = (0usize, 0usize, 0usize);
    let mut i = 0usize;
    while i < len {
        if i > 0 && next() % every == 0 {
            let size = 1 + (next() % 3) as usize;
            if size % 2 == 1 { odd_shifts += 1 } else { even_shifts += 1 }
            if next() % 2 == 0 {
                i += size; // deletion from B
                continue;
            }
            for _ in 0..size {
                b.push(b"ACGT"[(next() % 4) as usize]); // insertion into B
            }
        }
        truth[i] = Some(b.len());
        if next() % 222 == 0 {
            let at = b"ACGT".iter().position(|&c| c == a[i]).unwrap();
            b.push(b"ACGT"[(at + 1 + (next() % 3) as usize) % 4]);
            substitutions += 1;
        } else {
            b.push(a[i]);
        }
        i += 1;
    }
    RelatedPair {
        a: String::from_utf8(a).unwrap(),
        b: String::from_utf8(b).unwrap(),
        truth,
        substitutions,
        odd_shifts,
        even_shifts,
        reversed: false,
    }
}

/// For each base of A, the length of the collinear stretch it lies in: the bases on either side
/// copied to B at the same A-to-B offset, with no indel between them; 0 for a base deleted from B.
fn stretch_lengths(pair: &RelatedPair) -> Vec<usize> {
    let offset = |i: usize| pair.truth[i].map(|j| j as isize - i as isize);
    let mut lengths = vec![0usize; pair.truth.len()];
    let mut start = 0usize;
    while start < lengths.len() {
        let end = (start + 1..lengths.len()).find(|&i| offset(i).is_none() || offset(i) != offset(start)).unwrap_or(lengths.len());
        if offset(start).is_some() {
            lengths[start..end].fill(end - start);
        }
        start = end;
    }
    lengths
}

/// `pair` with `bases` inserted into B before its base `at_b`; the truth map follows.
fn with_insertion_in_b(pair: RelatedPair, at_b: usize, bases: &str) -> RelatedPair {
    let b = format!("{}{bases}{}", &pair.b[..at_b], &pair.b[at_b..]);
    let truth = pair.truth.iter().map(|p| p.map(|j| if j >= at_b { j + bases.len() } else { j })).collect();
    RelatedPair { b, truth, ..pair }
}

/// `pair` with the bases of B copied from A's bases `from_a..to_a` deleted from B, and any B bases
/// between them; the truth map follows.
fn with_deletion_from_b(pair: RelatedPair, from_a: usize, to_a: usize) -> RelatedPair {
    let lo = (from_a..to_a).find_map(|i| pair.truth[i]).expect("fixture: a deleted base is copied");
    let hi = (to_a..pair.truth.len()).find_map(|i| pair.truth[i]).expect("fixture: a base after the deletion is copied");
    let b = format!("{}{}", &pair.b[..lo], &pair.b[hi..]);
    let truth = pair
        .truth
        .iter()
        .map(|p| p.and_then(|j| if j >= hi { Some(j - (hi - lo)) } else { (j < lo).then_some(j) }))
        .collect();
    RelatedPair { b, truth, ..pair }
}

/// `pair` with B reverse-complemented, so every base of A is planted on the - strand.
fn reversed(pair: &RelatedPair) -> RelatedPair {
    let n = pair.b.len();
    RelatedPair {
        a: pair.a.clone(),
        b: pair.b.bytes().rev().map(|c| complement(c) as char).collect(),
        truth: pair.truth.iter().map(|p| p.map(|j| n - 1 - j)).collect(),
        reversed: !pair.reversed,
        ..*pair
    }
}

fn is_acgt(c: u8) -> bool {
    matches!(c.to_ascii_uppercase(), b'A' | b'C' | b'G' | b'T')
}

fn complement(c: u8) -> u8 {
    match c.to_ascii_uppercase() {
        b'A' => b'T',
        b'C' => b'G',
        b'G' => b'C',
        b'T' => b'A',
        other => other,
    }
}

/// What a report's blocks hold, read against the pair's sequences and truth map.
struct Measured {
    /// A bases the blocks cover, and of those the ones at the B coordinate they were planted at.
    covered: usize,
    on_planted: usize,
    /// The union of the blocks' B intervals over B's A/C/G/T bases.
    b_coverage: f64,
    /// Matched bases over aligned bases, pooled over every block.
    pooled_identity: f64,
    /// Blocks that hold an N or another ambiguity base in A or in B.
    blocks_over_ambiguity: usize,
}

/// Each block's bases read from the sequences: base `i` of A sits at B position
/// `genome_b_start + (i - genome_a_start)` on the + strand, and pairs with the complement of B's
/// base at `genome_b_end - (i - genome_a_start)` on the - strand. A block is on its planted
/// coordinate on the strand the pair was planted on (the - strand where B is reversed, the + strand
/// otherwise). `on_side` picks the A bases counted.
fn measure(pair: &RelatedPair, report: &WholeGenomeSyntenyReport, on_side: impl Fn(usize) -> bool) -> Measured {
    let (a, b) = (pair.a.as_bytes(), pair.b.as_bytes());
    let mut b_covered = vec![false; b.len()];
    let (mut covered, mut on_planted, mut matched, mut aligned, mut blocks_over_ambiguity) = (0, 0, 0, 0, 0);
    for blk in &report.blocks {
        assert_eq!(blk.genome_a_end + 1 - blk.genome_a_start, blk.length_bp, "{}: A span", blk.block_id);
        assert_eq!(blk.genome_b_end + 1 - blk.genome_b_start, blk.length_bp, "{}: B span", blk.block_id);
        let (a0, b0) = (blk.genome_a_start - 1, blk.genome_b_start - 1);
        let mut over_ambiguity = false;
        for off in 0..blk.length_bp {
            let i = a0 + off;
            let (j, paired) = if blk.strand == "+" {
                (b0 + off, b[b0 + off])
            } else {
                let j = blk.genome_b_end - 1 - off;
                (j, complement(b[j]))
            };
            b_covered[j] = true;
            over_ambiguity |= !is_acgt(a[i]) || !is_acgt(b[j]);
            aligned += 1;
            matched += usize::from(a[i].eq_ignore_ascii_case(&paired));
            if on_side(i) {
                covered += 1;
                on_planted += usize::from((blk.strand == "-") == pair.reversed && pair.truth[i] == Some(j));
            }
        }
        blocks_over_ambiguity += usize::from(over_ambiguity);
    }
    let b_acgt = b.iter().filter(|&&c| is_acgt(c)).count();
    let b_union = (0..b.len()).filter(|&j| b_covered[j] && is_acgt(b[j])).count();
    Measured {
        covered,
        on_planted,
        b_coverage: b_union as f64 / b_acgt as f64,
        pooled_identity: matched as f64 / aligned.max(1) as f64,
        blocks_over_ambiguity,
    }
}

/// The four checks of a related pair: A coverage at least 99%, at least 99% of covered A bases
/// at their planted B coordinate, B coverage at least 99%, pooled identity at least 99%.
fn assert_covers_at_planted_coordinates(pair: &RelatedPair, report: &WholeGenomeSyntenyReport, what: &str) {
    let m = measure(pair, report, |_| true);
    assert!(report.genome_a_coverage_pct >= 99.0, "{what}: A coverage {}%", report.genome_a_coverage_pct);
    let planted = m.on_planted as f64 / m.covered as f64;
    assert!(planted >= 0.99, "{what}: {} of {} covered A bases on their planted B coordinate", m.on_planted, m.covered);
    assert!(m.b_coverage >= 0.99, "{what}: B coverage {:.4}", m.b_coverage);
    assert!(m.pooled_identity >= 0.99, "{what}: pooled identity {:.4}", m.pooled_identity);
    // coverage is of every block, over A's A/C/G/T bases
    let summed: usize = report.blocks.iter().map(|blk| blk.length_bp).sum();
    assert_eq!(report.total_aligned_bp, summed, "{what}");
    let a_acgt = pair.a.bytes().filter(|&c| is_acgt(c)).count();
    assert_eq!(report.genome_a_coverage_pct, ((summed as f64 / a_acgt as f64) * 1000.0).round() / 10.0, "{what}");
}

/// A base other than `c`: the next of A, C, G, T after it.
fn differ(c: u8) -> u8 {
    b"ACGT"[(b"ACGT".iter().position(|&x| x == c).unwrap() + 1) % 4]
}

/// A random 2 kb genome A and an unrelated random 2 kb genome B holding copies of A: each
/// `(at_a, at_b, len)` puts A's `len` bases from `at_a` at B's `at_b`, flanked by four bases on
/// each side that differ from A's, so a copy is a run of exactly its length, scoring as much.
fn planted_copies(copies: &[(usize, usize, usize)]) -> (String, String) {
    let a = random_genome(2_000, 0x2a_c0de).into_bytes();
    let mut b = random_genome(2_000, 0x2b_c0de).into_bytes();
    for &(at_a, at_b, len) in copies {
        b[at_b..at_b + len].copy_from_slice(&a[at_a..at_a + len]);
        for f in 1..=4 {
            b[at_b - f] = differ(a[at_a - f]);
            b[at_b + len - 1 + f] = differ(a[at_a + len - 1 + f]);
        }
    }
    (String::from_utf8(a).unwrap(), String::from_utf8(b).unwrap())
}

/// Each block's 1-based A start and end and B start and end.
fn spans(report: &WholeGenomeSyntenyReport) -> Vec<(usize, usize, usize, usize)> {
    report.blocks.iter().map(|blk| (blk.genome_a_start, blk.genome_a_end, blk.genome_b_start, blk.genome_b_end)).collect()
}

const SAMPLING_SENTENCE_2_4: &str =
    "Synteny indexed every 2nd base of genome B and seeded every 4th base of genome A; coverage is a lower bound.";

fn assert_unsampled(report: &WholeGenomeSyntenyReport, what: &str) {
    assert!(!report.genome_a_coverage_is_lower_bound, "{what}: coverage marked as a lower bound");
    assert!(
        report.warnings.iter().all(|w| !w.contains("indexed every") && !w.contains("lower bound")),
        "{what}: {:?}",
        report.warnings
    );
}

/// The 3 Mb pair of AC1 and AC3, and the 700 kb pair of AC2 and AC3.
fn pair_3mb() -> RelatedPair {
    let pair = related_pair(3_000_000, 0x3_3b_5e17);
    assert!((13_000..=14_000).contains(&pair.substitutions), "fixture: {} substitutions", pair.substitutions);
    assert!(pair.odd_shifts + pair.even_shifts > 1_300, "fixture: {} indels", pair.odd_shifts + pair.even_shifts);
    pair
}

fn pair_700kb() -> RelatedPair {
    let pair = related_pair(700_000, 0x700_5e17);
    // indels shift the A-to-B offset by odd and by even amounts, so a stride-2 index of B paired
    // with a step-4 seeding of A leaves some offsets unreachable
    assert!(pair.odd_shifts > 100 && pair.even_shifts > 50, "fixture: {} odd and {} even shifts", pair.odd_shifts, pair.even_shifts);
    pair
}

#[test]
fn near_identical_genomes_reach_full_coverage_or_warn() {
    let (a, b) = near_identical_pair();
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&a, &b, engine);
        // the scan ran past the old 48-block stop, to the end of A
        assert!(report.blocks.len() > 48, "{engine}: {} blocks", report.blocks.len());
        let last = report.blocks.last().unwrap();
        assert!(last.genome_a_end > 199_000, "{engine}: last block ends at {}", last.genome_a_end);
        // coverage is of all of A, from every block
        assert!(report.genome_a_coverage_pct > 95.0, "{engine}: {}% from {} blocks", report.genome_a_coverage_pct, report.blocks.len());
        let summed: usize = report.blocks.iter().map(|blk| blk.length_bp).sum();
        assert_eq!(report.total_aligned_bp, summed, "{engine}");
        assert_eq!(report.genome_a_coverage_pct, ((summed as f64 / 200_000.0) * 1000.0).round() / 10.0, "{engine}");
        assert!(report.blocks.iter().all(|blk| blk.strand == "+"), "{engine}: no inversion was planted");
        assert!(report.blocks.windows(2).all(|w| w[0].genome_a_end < w[1].genome_a_start), "{engine}: blocks follow A in order");
    }
}

/// AC1: two 3 Mb genomes about 99.5% identical read as about fully covered, at the coordinates
/// they were planted at, with no sampling sentence. The old sampled scan read 47% (Mauve).
#[test]
fn synteny_covers_a_related_3mb_pair_at_its_planted_coordinates() {
    let pair = pair_3mb();
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
        assert_covers_at_planted_coordinates(&pair, &report, engine);
        assert_unsampled(&report, engine);
        assert_eq!(report.warnings, Vec::<String>::new(), "{engine}: an N-free pair scanned at every base");
    }
}

/// AC2: after an indel shifts the A-to-B offset by an odd or an even amount, the scan reaches the
/// new offset. The old scan (B every 2nd base, A every 4th) read 81.9% on this pair (Mauve).
#[test]
fn synteny_reaches_every_offset_after_an_indel() {
    let pair = pair_700kb();
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
        assert_covers_at_planted_coordinates(&pair, &report, engine);
    }
}

/// AC3: a scan that indexes B at a stride above 1 marks its coverage as a lower bound and says
/// which bases it indexed and seeded; the public scan, at stride 1, says neither.
#[test]
fn synteny_names_any_sampling_in_its_warnings() {
    let pair = pair_700kb();
    for engine in ["Mauve", "LASTZ"] {
        let sampled = run_whole_genome_synteny_with_sampling(&pair.a, &pair.b, engine, 2, 4);
        assert!(sampled.genome_a_coverage_is_lower_bound, "{engine}: stride 2 is a lower bound");
        assert_eq!(sampled.warnings, vec![SAMPLING_SENTENCE_2_4.to_string()], "{engine}");
        let full = run_whole_genome_synteny(&pair.a, &pair.b, engine);
        assert_unsampled(&full, engine);
        // the fixture reaches the failure sampling causes: offsets the stride and step cannot meet
        assert!(
            sampled.genome_a_coverage_pct + 1.0 < full.genome_a_coverage_pct,
            "fixture: {engine} sampled {}% against {}% at every base",
            sampled.genome_a_coverage_pct,
            full.genome_a_coverage_pct
        );
    }
    // the ordinals are the stride and step the scan used
    let other = run_whole_genome_synteny_with_sampling(&pair.a[..100_000], &pair.b[..100_000], "Mauve", 3, 11);
    assert!(other.genome_a_coverage_is_lower_bound);
    assert_eq!(
        other.warnings,
        vec!["Synteny indexed every 3rd base of genome B and seeded every 11th base of genome A; coverage is a lower bound.".to_string()]
    );
    let big = pair_3mb();
    for engine in ["Mauve", "LASTZ"] {
        assert_unsampled(&run_whole_genome_synteny(&big.a, &big.b, engine), engine);
    }
}

/// AC4: an N run in each genome stays in place. Blocks keep each genome's own numbering on both
/// sides of each run, never cover an N, coverage is over A's A/C/G/T bases, and the warnings name
/// each genome's N count and that denominator.
#[test]
fn synteny_keeps_original_coordinates_across_an_n_gap() {
    // 2,999,900 bases of A with 100 N put in before its base 1,234,567, and 100 N in B before its
    // base 2,111,111: A is 3,000,000 long
    const GAP_A: usize = 1_234_567;
    const GAP_B: usize = 2_111_111;
    let pair = with_n_runs(related_pair(2_999_900, 0x4e_9a95), GAP_A, GAP_B, 100);
    assert_eq!(pair.a.len(), 3_000_000);
    assert_eq!(&pair.a[GAP_A..GAP_A + 100], "N".repeat(100));
    assert_eq!(&pair.b[GAP_B..GAP_B + 100], "N".repeat(100));
    let b_acgt = pair.b.len() - 100;
    let planted_b = |i: usize| pair.truth[i];
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
        assert_eq!(measure(&pair, &report, |_| true).blocks_over_ambiguity, 0, "{engine}: a block covers an N");
        let sides: [(&str, Box<dyn Fn(usize) -> bool>); 4] = [
            ("A before its N run", Box::new(|i| i < GAP_A)),
            ("A after its N run", Box::new(|i| i >= GAP_A + 100)),
            ("planted before B's N run", Box::new(move |i| planted_b(i).is_some_and(|j| j < GAP_B))),
            ("planted after B's N run", Box::new(move |i| planted_b(i).is_some_and(|j| j >= GAP_B + 100))),
        ];
        for (side, on_side) in sides {
            let m = measure(&pair, &report, on_side);
            assert!(m.covered > 500_000, "fixture: {engine} covers {} bases of {side}", m.covered);
            assert!(
                m.on_planted as f64 / m.covered as f64 >= 0.99,
                "{engine}: {} of {} covered bases of {side} on their planted B coordinate",
                m.on_planted,
                m.covered
            );
        }
        let summed: usize = report.blocks.iter().map(|blk| blk.length_bp).sum();
        assert_eq!(report.genome_a_coverage_pct, ((summed as f64 / 2_999_900.0) * 1000.0).round() / 10.0, "{engine}");
        assert!(report.genome_a_coverage_pct >= 99.0, "{engine}: {}%", report.genome_a_coverage_pct);
        assert_eq!(
            report.warnings,
            vec![
                "Genome A holds 100 N or other ambiguity bases; no block crosses them, and coverage is of its 2,999,900 A/C/G/T bases.".to_string(),
                format!(
                    "Genome B holds 100 N or other ambiguity bases; no block crosses them, and coverage is of its {} A/C/G/T bases.",
                    group_digits(b_acgt)
                ),
            ],
            "{engine}"
        );
        assert_unsampled(&report, engine);
    }

    // The denominator is A's A/C/G/T bases, not its length: 40 kb of lower-case bases split by
    // 20,000 ambiguity bases (N, n and other IUPAC codes) read as fully covered by a copy of the
    // 40 kb, where A's length would give 66.7%. The N-free copy against itself gives no sentence.
    let flank = related_pair(40_000, 0x0f1a_4e).a.to_ascii_lowercase();
    let ambiguity: String = "NnRYKMSWBDHV".chars().cycle().take(20_000).collect();
    let gapped = format!("{}{ambiguity}{}", &flank[..20_000], &flank[20_000..]);
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&gapped, &flank, engine);
        assert!(report.genome_a_coverage_pct >= 99.0, "{engine}: {}% of the gapped genome", report.genome_a_coverage_pct);
        assert!(report.blocks.iter().all(|blk| blk.genome_a_end <= 20_000 || blk.genome_a_start > 40_000), "{engine}: a block crosses the ambiguity run");
        assert_eq!(
            report.warnings,
            vec!["Genome A holds 20,000 N or other ambiguity bases; no block crosses them, and coverage is of its 40,000 A/C/G/T bases.".to_string()],
            "{engine}"
        );
        let clean = run_whole_genome_synteny(&flank, &flank, engine);
        assert_eq!(clean.warnings, Vec::<String>::new(), "{engine}: an N-free pair");
        assert!(clean.genome_a_coverage_pct >= 99.9, "{engine}: {}%", clean.genome_a_coverage_pct);
    }

    // A lone ambiguity base ends a block as a run does, not as one mismatch the extension runs
    // past: an N at every 1,000th base of A and an R at every 1,500th base of B, the 40 kb copy.
    let mut spotted_a = flank.clone().into_bytes();
    let mut spotted_b = flank.into_bytes();
    let n_at: Vec<usize> = (999..spotted_a.len()).step_by(1_000).collect();
    let r_at: Vec<usize> = (1_499..spotted_b.len()).step_by(1_500).collect();
    n_at.iter().for_each(|&i| spotted_a[i] = b'N');
    r_at.iter().for_each(|&j| spotted_b[j] = b'R');
    let spotted = RelatedPair {
        truth: (0..spotted_a.len()).map(|i| (!n_at.contains(&i)).then_some(i)).collect(),
        a: String::from_utf8(spotted_a).unwrap(),
        b: String::from_utf8(spotted_b).unwrap(),
        substitutions: 0,
        odd_shifts: 0,
        even_shifts: 0,
        reversed: false,
    };
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&spotted.a, &spotted.b, engine);
        let m = measure(&spotted, &report, |_| true);
        assert_eq!(m.blocks_over_ambiguity, 0, "{engine}: a block runs past a lone N or R");
        assert!(report.genome_a_coverage_pct >= 99.0, "{engine}: {}%", report.genome_a_coverage_pct);
        assert_eq!(m.on_planted, m.covered, "{engine}");
        assert_eq!(
            report.warnings,
            vec![
                format!("Genome A holds {} N or other ambiguity bases; no block crosses them, and coverage is of its {} A/C/G/T bases.", n_at.len(), group_digits(40_000 - n_at.len())),
                format!("Genome B holds {} N or other ambiguity bases; no block crosses them, and coverage is of its {} A/C/G/T bases.", r_at.len(), group_digits(40_000 - r_at.len())),
            ],
            "{engine}"
        );
    }
}

/// LC-012: indexing every base of B makes every chance k-mer match a candidate block. Two
/// unrelated 2 Mb genomes share no block: under the 16-base length floor the score floor replaced,
/// about half of the chance hits became blocks, and Mauve read this pair as 7.7% syntenic.
#[test]
fn synteny_finds_no_chance_blocks_between_unrelated_genomes() {
    let a = related_pair(2_000_000, 0x0a_11ce).a;
    let b = related_pair(2_000_000, 0x0b_0b0b).a;
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&a, &b, engine);
        assert!(report.total_aligned_bp < 100, "{engine}: {} bp in {} blocks", report.total_aligned_bp, report.blocks.len());
        assert_eq!(report.genome_a_coverage_pct, 0.0, "{engine}");
        assert_eq!(report.inversion_count, 0, "{engine}");
    }
}

/// Of a seed's hits, the one on the diagonal of the block before it is taken. A 4 kb element at
/// six places in A (and so in B) gives a seed inside one copy hits in the other copies of B. The
/// block resumed after an indel inside a copy stays on that copy's own planted coordinates, where
/// the first hit would put it on the first copy; and a seed whose own copy in B differs from it is
/// skipped, where the nearest other copy would take it.
#[test]
fn synteny_keeps_a_repeated_element_on_its_own_copy() {
    const COPIES: [usize; 6] = [20_000, 70_000, 120_000, 170_000, 220_000, 270_000];
    const ELEMENT: usize = 4_000;
    let pair = related_pair_shaped(300_000, 0x2e_9ea7, |a, next| {
        let element: Vec<u8> = (0..ELEMENT).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
        for at in COPIES {
            a[at..at + ELEMENT].copy_from_slice(&element);
        }
    });
    let in_later_copy = |i: usize| COPIES[1..].iter().any(|&at| (at..at + ELEMENT).contains(&i));
    // the fixture: indels inside the later copies, where a seed must choose among the copies
    let offset = |i: usize| pair.truth[i].map(|j| j as isize - i as isize);
    let shifts = (1..pair.a.len()).filter(|&i| in_later_copy(i) && in_later_copy(i - 1) && offset(i).is_some() && offset(i - 1).is_some() && offset(i) != offset(i - 1)).count();
    assert!(shifts >= 4, "fixture: {shifts} indels inside the later copies");
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
        let m = measure(&pair, &report, in_later_copy);
        assert!(m.covered as f64 >= 0.99 * (5 * ELEMENT) as f64, "{engine}: {} bases of the later copies covered", m.covered);
        assert!(m.on_planted as f64 >= 0.99 * m.covered as f64, "{engine}: {} of {} covered bases of the later copies on their own copy", m.on_planted, m.covered);
        let odd: Vec<_> = report.blocks.iter().enumerate().filter(|(_, blk)| blk.event_class != "Collinear Synteny").map(|(i, blk)| (&report.blocks[i.saturating_sub(1)], blk, report.blocks.get(i + 1))).collect();
        assert!(odd.is_empty(), "{engine}: no rearrangement was planted: {odd:?}");
    }
}

/// An inverted segment is found even where each of its k-mers also occurs forward in B by chance:
/// B holds the segment's reverse complement, then every k-mer of the segment, each followed by
/// four bases that differ from the segment's next four, so no forward hit makes a block. The
/// reverse hit is tried when the forward one makes no block, not only when there is none.
#[test]
fn synteny_finds_an_inversion_whose_kmers_also_occur_forward() {
    let segment = related_pair(5_000, 0x1a_0e75).a.into_bytes();
    let rc = |s: &[u8]| -> Vec<u8> { s.iter().rev().map(|&c| complement(c)).collect() };
    for (engine, k) in [("Mauve", 13usize), ("LASTZ", 11)] {
        let mut b = rc(&segment);
        for p in 0..=segment.len() - k {
            b.extend_from_slice(&segment[p..p + k]);
            for j in 0..4 {
                let next = segment.get(p + k + j).copied().unwrap_or(b'A');
                b.push(b"ACGT"[(b"ACGT".iter().position(|&c| c == next).unwrap() + 1) % 4]);
            }
        }
        let report = run_whole_genome_synteny(std::str::from_utf8(&segment).unwrap(), std::str::from_utf8(&b).unwrap(), engine);
        assert!(report.genome_a_coverage_pct >= 99.0, "{engine}: {}% in {} blocks", report.genome_a_coverage_pct, report.blocks.len());
        assert!(report.inversion_count >= 1, "{engine}");
        for blk in &report.blocks {
            assert_eq!(blk.strand, "-", "{engine}: {} is forward", blk.block_id);
            // base i of A pairs with base len - i + 1 of B, B's leading reverse complement
            assert_eq!(blk.genome_a_start + blk.genome_b_end, segment.len() + 1, "{engine}: {} off its planted coordinate", blk.block_id);
        }
    }
}

/// AC1 (BG-01M6TAB2): between two close indels lies a collinear block too short to reach the
/// score floor alone (a 99.5%-identical block passes alone from about 25 bp). Such a block is kept
/// when it links to the blocks beside it, on a diagonal within the resume window and within 32
/// bases of A, and the chain reaches the floor together; the bases past each indel that the block
/// before took by chance go to the block after it. On 300 kb pairs with an indel every 40 and
/// every 25 bp the coverage at planted coordinates is at least what the engine before BG-01M6SKKV
/// read on the data seat's pairs (84.7% and 75.5%, Mauve), where the score floor alone read 78.0%
/// and 63.1%. A lone chance seed still makes no block: unrelated 300 kb and 5 Mb pairs read 0%.
#[test]
fn synteny_keeps_short_blocks_between_close_indels() {
    for (every, seed, previous) in [(40u64, 0x40_1de1u64, 84.7), (25, 0x25_1de1, 75.5)] {
        let pair = indel_dense_pair(300_000, every, seed);
        let (indels, expected) = (pair.odd_shifts + pair.even_shifts, 300_000 / every as usize);
        assert!(indels.abs_diff(expected) < expected / 20, "fixture: {indels} indels");
        // the fixture holds what the floor alone drops: a tenth or more of A in stretches under 25 bp
        let stretch = stretch_lengths(&pair);
        let short = stretch.iter().filter(|&&len| (1..25).contains(&len)).count() as f64 / pair.a.len() as f64;
        assert!(short > 0.1, "fixture: {:.1}% of A in stretches under 25 bp", 100.0 * short);
        for engine in ["Mauve", "LASTZ"] {
            let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
            let m = measure(&pair, &report, |_| true);
            let planted = 100.0 * m.on_planted as f64 / pair.a.len() as f64;
            assert!(planted >= previous, "{engine}, an indel every {every} bp: {planted:.1}% of A at its planted coordinates");
            // the bases past an indel go to the block after it: where both blocks are seeded (a
            // stretch of 25 bp or more), almost none is covered off its planted coordinate, where
            // the extension of the block before puts about 4.6 bases past each indel
            let long = measure(&pair, &report, |i| stretch[i] >= 25);
            let off = 100.0 * (long.covered - long.on_planted) as f64 / pair.a.len() as f64;
            assert!(off < 1.0, "{engine}, an indel every {every} bp: {off:.1}% of A covered off its planted coordinates");
            assert!(report.blocks.iter().all(|blk| blk.strand == "+"), "{engine}: no inversion was planted");
            // blocks follow A and B in order: past a deletion from B the block after starts as
            // many bases of A later, so no two blocks share a base of B
            let unordered: Vec<_> = report
                .blocks
                .windows(2)
                .filter(|w| w[0].genome_a_end >= w[1].genome_a_start || w[0].genome_b_end >= w[1].genome_b_start)
                .collect();
            assert!(unordered.is_empty(), "{engine}, an indel every {every} bp: {} pairs out of order, {:?}", unordered.len(), unordered.first());
        }
    }

    // Copies of A planted in an unrelated B, each flanked by four bases that differ from A's, so a
    // copy is a run of exactly its length, scoring as much; every base of A is seeded. A copy of 24
    // bases is a block alone and one of 23 is not. Two copies of 20 bases, 20 bases apart in A on
    // diagonals 3 apart (an insertion of 3 bases into B), are blocks together, 40 less the link's 8,
    // though neither is alone; the second copy is also planted earlier in B, so only the diagonal of
    // the first puts it beside it. Two copies of 13 bases at the same places, the pair of chance
    // seeds a chain must not make, are not: 26 less 8. And a run under the floor does not hide a
    // block that starts inside it: 20 bases copied, and 32 bases from their 13th copied elsewhere.
    for engine in ["Mauve", "LASTZ"] {
        let run = |copies: &[(usize, usize, usize)]| {
            let (a, b) = planted_copies(copies);
            run_whole_genome_synteny_with_sampling(&a, &b, engine, 1, 1)
        };
        assert_eq!(spans(&run(&[(500, 900, 24)])), vec![(501, 524, 901, 924)], "{engine}: a lone 24-base copy");
        assert_eq!(spans(&run(&[(500, 900, 23)])), vec![], "{engine}: a lone 23-base copy");
        assert_eq!(
            spans(&run(&[(540, 200, 20), (500, 900, 20), (540, 943, 20)])),
            vec![(501, 520, 901, 920), (541, 560, 944, 963)],
            "{engine}: two 20-base copies across an insertion"
        );
        assert_eq!(spans(&run(&[(500, 900, 13), (533, 936, 13)])), vec![], "{engine}: two 13-base copies across an insertion");
        assert_eq!(spans(&run(&[(500, 900, 20), (512, 1_500, 32)])), vec![(513, 544, 1_501, 1_532)], "{engine}: a block inside a short run");
    }
    // Where two blocks of a chain meet. A 20-base copy is followed in B by A's next two bases and
    // one that differs, then by 20 bases from A's 21st (an insertion of 3 bases into B): the first
    // run's extension takes the second copy's first two bases by chance, 22 bases that still score
    // under the floor. A seed of the second copy starts inside that run and is linked to it, and
    // the two meet where the second copy begins, the leftmost of the three places where they score
    // the same.
    let overshoot = {
        let mut a = random_genome(2_000, 0x2a_c0de).into_bytes();
        for i in 523..526 {
            a[i] = differ(a[i - 3]); // so the first run stops after the second copy's first two bases
        }
        let mut b = random_genome(2_000, 0x2b_c0de).into_bytes();
        for f in 1..=4 {
            b[900 - f] = differ(a[500 - f]);
            b[942 + f] = differ(a[539 + f]);
        }
        b[900..920].copy_from_slice(&a[500..520]);
        b[920..922].copy_from_slice(&a[520..522]);
        b[922] = *b"ACGT".iter().find(|&&c| c != a[522] && c != a[519]).unwrap();
        b[923..943].copy_from_slice(&a[520..540]);
        (String::from_utf8(a).unwrap(), String::from_utf8(b).unwrap())
    };
    for engine in ["Mauve", "LASTZ"] {
        let report = run_whole_genome_synteny_with_sampling(&overshoot.0, &overshoot.1, engine, 1, 1);
        assert_eq!(spans(&report), vec![(501, 520, 901, 920), (521, 540, 924, 943)], "{engine}: two blocks meeting at an insertion");
    }

    // a chain is never a pair of chance seeds: unrelated genomes share no block
    for (len, seed_a, seed_b) in [(300_000usize, 0x3a_11ceu64, 0x3b_0b0bu64), (5_000_000, 0x5a_11ce, 0x5b_0b0b)] {
        let (a, b) = (random_genome(len, seed_a), random_genome(len, seed_b));
        for engine in ["Mauve", "LASTZ"] {
            let report = run_whole_genome_synteny(&a, &b, engine);
            let what = format!("{engine}, {len} bp: {} bp in {} blocks", report.total_aligned_bp, report.blocks.len());
            assert_eq!(report.genome_a_coverage_pct, 0.0, "{what}");
            assert!(report.total_aligned_bp < 100, "{what}");
        }
    }
}

/// AC2 (BG-01M6TAB2): a seed in a repeat's copy is resumed on its own copy after an indel larger
/// than the resume window. A 2 kb element lies at four places in A, and B holds 100 bases inserted
/// before its third copy: the block before ends at the insertion, and each seed in that copy has
/// four hits in B, the planted one 100 bases off the diagonal and the others tens of kb off, so
/// the lone copy within 1,000 bases is taken. The engine before skipped every such seed (LASTZ
/// covered none of the copy), or took another copy where a substitution left only it holding the
/// seed, and labelled it a rearrangement (Mauve). A 100 bp unit in ten tandem copies, with 10
/// bases inserted into B in the fourth, needs the 32-base window: there the next copy lies 90
/// bases off, so the planted one is not alone within 1,000 bases. The same pair with B
/// reverse-complemented asks both rules on the - strand, through the diagonal of the block before
/// mapped onto B's reverse complement; every block there is on the - strand and reads Inversion.
#[test]
fn synteny_places_a_repeat_after_an_indel_on_its_own_copy() {
    const COPIES: [usize; 4] = [30_000, 100_000, 170_000, 240_000];
    const ELEMENT: usize = 2_000;
    const TANDEM: usize = 60_000;
    const UNIT: usize = 100;
    const UNITS: usize = 10;
    let pair = related_pair_shaped(300_000, 0x2c_09e5, |a, next| {
        let element: Vec<u8> = (0..ELEMENT).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
        for at in COPIES {
            a[at..at + ELEMENT].copy_from_slice(&element);
        }
        let unit: Vec<u8> = (0..UNIT).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
        for u in 0..UNITS {
            a[TANDEM + u * UNIT..TANDEM + (u + 1) * UNIT].copy_from_slice(&unit);
        }
    });
    let after_insertion = COPIES[2];
    let cut = TANDEM + 3 * UNIT + 50;
    let at_copy = pair.truth[after_insertion].expect("fixture: the copy's first base is copied");
    let pair = with_insertion_in_b(pair, at_copy, &random_genome(100, 0x100_1a5e));
    let at_cut = pair.truth[cut].expect("fixture: the tandem's cut base is copied");
    let pair = with_insertion_in_b(pair, at_cut, &random_genome(10, 0x10_1a5e));
    // the fixture: the copy is planted 100 bases off the diagonal before it, the tandem 10 bases
    let offset = |i: usize| pair.truth[i].map(|j| j as isize - i as isize).expect("fixture: base copied");
    assert_eq!(offset(after_insertion) - offset(after_insertion - 1), 100, "fixture");
    assert_eq!(offset(cut) - offset(cut - 1), 10, "fixture");

    let repeats: Vec<(String, std::ops::Range<usize>)> = COPIES
        .iter()
        .enumerate()
        .map(|(n, &at)| (format!("copy {} of the element", n + 1), at..at + ELEMENT))
        .chain([("the tandem past its insertion".to_string(), cut..TANDEM + UNITS * UNIT)])
        .collect();
    let mirrored = reversed(&pair);
    for (strand, pair) in [("+", &pair), ("-", &mirrored)] {
        for engine in ["Mauve", "LASTZ"] {
            let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
            for (what, range) in &repeats {
                let m = measure(pair, &report, |i| range.contains(&i));
                assert!(m.covered as f64 >= 0.99 * range.len() as f64, "{engine}, {strand} strand: {} bases of {what} covered", m.covered);
                assert!(
                    m.on_planted as f64 >= 0.99 * m.covered as f64,
                    "{engine}, {strand} strand: {} of {} covered bases of {what} on their own copy",
                    m.on_planted,
                    m.covered
                );
            }
            let class = if strand == "+" { "Collinear Synteny" } else { "Inversion" };
            let odd: Vec<_> = report.blocks.iter().filter(|blk| blk.strand != strand || blk.event_class != class).collect();
            assert!(odd.is_empty(), "{engine}, {strand} strand: no rearrangement was planted: {odd:?}");
        }
    }
}

/// AC5 (BG-01M6TAB2, data seat round 1): a copy of a repeated element that follows a deletion from
/// B is placed on its own copy, on either strand, by both engines. A 2 kb element lies at four
/// places in A, about 99.5% identical in B, and B lacks the 30 or the 100 bases of A before its
/// third copy, so the scan seeds those deleted bases on its way to the copy. Two things put the copy
/// elsewhere before: a chance hit of a deleted base's seed, kept as a run under the floor, set the
/// diagonal a repeated k-mer was placed by (on the other strand none, so its first copy was taken);
/// and a seed holding the last one to three deleted bases and the copy's first, which B holds only
/// where the bases before another copy match them by chance, was taken there as a k-mer B holds
/// once (LASTZ: the copy on its own copy in 11 of 30 trials, labelled a rearrangement in 15). Over
/// 30 seeded 300 kb trials per deletion, on each strand with each engine, the copy is covered and on
/// its planted coordinates, and every block reads as the pair was planted.
///
/// Five planted pairs pin the rules this rests on. A seed held once in B, on the other strand, is
/// not placed there where the k-mers past it lie on the diagonal of the block before. Across an
/// insertion of 100 bases into B and a deletion of 100 bases from B, the first block's extension
/// takes the 3 bases past the indel that match by chance, and they go to the block after it.
/// Between two insertions 24 bases apart, where the first block's extension runs on through the
/// 24-base stretch, the scan seeds that stretch from where the first block's score peaks; and a
/// seed past that peak inside the block, on its diagonal, does not split it.
#[test]
fn synteny_places_a_repeat_after_a_deletion_on_its_own_copy() {
    const COPIES: [usize; 4] = [30_000, 100_000, 170_000, 240_000];
    const ELEMENT: usize = 2_000;
    const TRIALS: u64 = 30;
    let copy = COPIES[2]..COPIES[2] + ELEMENT;
    for deleted in [30usize, 100] {
        let mut exact = 0;
        for trial in 0..TRIALS {
            let pair = related_pair_shaped(300_000, 0x7ab2_0000 + trial * 7_919 + deleted as u64, |a, next| {
                let element: Vec<u8> = (0..ELEMENT).map(|_| b"ACGT"[(next() % 4) as usize]).collect();
                for at in COPIES {
                    a[at..at + ELEMENT].copy_from_slice(&element);
                }
            });
            let pair = with_deletion_from_b(pair, copy.start - deleted, copy.start);
            // the fixture: the copy is planted `deleted` bases below the diagonal of the bases
            // before the deletion, give or take a one- to three-base indel of the generator's
            let offset = |i: usize| pair.truth[i].map(|j| j as isize - i as isize);
            let before = (0..copy.start - deleted).rev().find_map(offset).unwrap();
            let after = copy.clone().find_map(offset).unwrap();
            assert!((before - after).abs_diff(deleted as isize) <= 3, "fixture, trial {trial}: {} bases between the diagonals", before - after);
            exact += usize::from(before - after == deleted as isize);
            assert!(pair.truth[copy.start - deleted..copy.start].iter().all(Option::is_none), "fixture, trial {trial}");

            let mirrored = reversed(&pair);
            for (strand, pair) in [("+", &pair), ("-", &mirrored)] {
                let class = if strand == "+" { "Collinear Synteny" } else { "Inversion" };
                for engine in ["Mauve", "LASTZ"] {
                    let report = run_whole_genome_synteny(&pair.a, &pair.b, engine);
                    let what = format!("{engine}, {strand} strand, {deleted} bases deleted, trial {trial}");
                    let m = measure(pair, &report, |i| copy.contains(&i));
                    assert!(m.covered as f64 >= 0.99 * ELEMENT as f64, "{what}: {} bases of the copy covered", m.covered);
                    assert!(
                        m.on_planted as f64 >= 0.99 * m.covered as f64,
                        "{what}: {} of {} covered bases of the copy on their own copy",
                        m.on_planted,
                        m.covered
                    );
                    let odd: Vec<_> = report.blocks.iter().filter(|blk| blk.strand != strand || blk.event_class != class).collect();
                    assert!(odd.is_empty(), "{what}: no rearrangement was planted: {odd:?}");
                }
            }
        }
        assert!(exact >= 25, "fixture: {exact} of {TRIALS} trials with exactly {deleted} bases between the diagonals");
    }

    let genomes = || (random_genome(2_000, 0x2a_c0de).into_bytes(), random_genome(2_000, 0x2b_c0de).into_bytes());
    let unlike = |avoid: [u8; 2]| *b"ACGT".iter().find(|c| !avoid.contains(c)).unwrap();
    // 100 bases inserted into B: A's 500..600 at B's 900, B's next 3 bases A's 600..603 by
    // chance, and A's 600..700 at B's 1,100
    let inserted = {
        let (a, mut b) = genomes();
        b[900..1_000].copy_from_slice(&a[500..600]);
        b[1_000..1_003].copy_from_slice(&a[600..603]);
        b[1_100..1_200].copy_from_slice(&a[600..700]);
        for f in 0..4 {
            b[896 + f] = differ(a[496 + f]);
            b[1_003 + f] = differ(a[603 + f]); // the first block's extension stops past the 3
            b[1_096 + f] = differ(a[596 + f]); // the second's, back along its diagonal, at 600
            b[1_200 + f] = differ(a[700 + f]);
        }
        (a, b)
    };
    // 100 bases of A deleted from B: A's 500..600 at B's 900 and A's 700..800 at B's 1,000, where
    // A's 600..603 match B's next 3 bases, A's 700..703, by chance
    let deleted = {
        let (mut a, mut b) = genomes();
        for f in 0..4 {
            a[603 + f] = differ(a[703 + f]); // the first block's extension stops past the 3
            a[696 + f] = differ(a[596 + f]); // the second's, back along its diagonal, at 700
        }
        a.copy_within(700..703, 600);
        b[900..1_000].copy_from_slice(&a[500..600]);
        b[1_000..1_100].copy_from_slice(&a[700..800]);
        for f in 0..4 {
            b[896 + f] = differ(a[496 + f]);
            b[1_100 + f] = differ(a[800 + f]);
        }
        (a, b)
    };
    // Insertions of 3 and 5 bases into B, 24 bases apart in A: A's 500..560 at B's 900, 560..584
    // at B's 963 and 584..640 at B's 992. A's 563..584 repeat the base 3 before them at every 4th
    // base and differ from it elsewhere, so the first block's extension runs on through the
    // 24-base stretch, never four mismatches in a row, to 584; its score peaks at 560.
    let close = {
        let (mut a, mut b) = genomes();
        for i in 563..584 {
            a[i] = if (i - 563) % 4 == 0 { a[i - 3] } else { differ(a[i - 3]) };
        }
        for f in 0..3 {
            a[584 + f] = differ(a[581 + f]);
        }
        a[556] = differ(a[559]);
        b[900..960].copy_from_slice(&a[500..560]);
        b[963..987].copy_from_slice(&a[560..584]);
        b[992..1_048].copy_from_slice(&a[584..640]);
        // the inserted bases match no diagonal that reaches them: 400, 403 or 408
        for f in 0..3 {
            b[960 + f] = unlike([a[560 + f], a[557 + f]]);
        }
        for (j, avoid) in [(987, [a[587], a[584]]), (988, [a[585], a[580]]), (989, [a[586], a[581]]), (990, [a[587], a[582]]), (991, [a[583], a[583]])] {
            b[j] = unlike(avoid);
        }
        for f in 0..4 {
            b[896 + f] = differ(a[496 + f]);
            b[1_048 + f] = differ(a[640 + f]);
        }
        (a, b)
    };
    // A seed whose own copy differs from it, where B holds it once, inverted: A's 400..700 at B's
    // 800 but for B's 1,000..1,004, four mismatches in a row, and A's 600..700 also at B's
    // 1,500..1,600 reverse-complemented. The seeds at A's 600..603 are held only by the inverted
    // copy, and the k-mers past each lie on the forward diagonal of the block before, so no
    // inversion is placed there.
    let held_inverted = {
        let (a, mut b) = genomes();
        b[800..1_100].copy_from_slice(&a[400..700]);
        let rc: Vec<u8> = a[600..700].iter().rev().map(|&c| complement(c)).collect();
        b[1_500..1_600].copy_from_slice(&rc);
        for f in 0..4 {
            b[796 + f] = differ(a[396 + f]);
            b[1_000 + f] = differ(a[600 + f]);
            b[1_100 + f] = differ(a[700 + f]);
            // the inverted copy's flanks, read on B's reverse complement
            b[1_600 + f] = complement(differ(a[599 - f]));
            b[1_499 - f] = complement(differ(a[700 + f]));
        }
        (a, b)
    };
    // One block with a divergent patch inside it: A's 500..574 at B's 900, but B's 530..550 differ
    // from A's at three bases of every four. Its score peaks (30) where the patch starts and ends
    // under it (29), so the scan seeds the patch and the 24 bases after it again: those seeds only
    // see the block again, and it stays one block.
    let patched = {
        let (a, mut b) = genomes();
        b[900..974].copy_from_slice(&a[500..574]);
        for i in 530..550 {
            if (i - 530) % 4 != 3 {
                b[i + 400] = differ(a[i]);
            }
        }
        for f in 0..4 {
            b[896 + f] = differ(a[496 + f]);
            b[974 + f] = differ(a[574 + f]);
        }
        (a, b)
    };
    let text = |s: &[u8]| String::from_utf8(s.to_vec()).unwrap();
    for engine in ["Mauve", "LASTZ"] {
        let run = |(a, b): &(Vec<u8>, Vec<u8>)| spans(&run_whole_genome_synteny_with_sampling(&text(a), &text(b), engine, 1, 1));
        assert_eq!(run(&held_inverted), vec![(401, 600, 801, 1_000), (605, 700, 1_005, 1_100)], "{engine}: a seed held only by an inverted copy");
        assert_eq!(run(&patched), vec![(501, 574, 901, 974)], "{engine}: a block seeded again past where its score peaks");
        assert_eq!(run(&inserted), vec![(501, 600, 901, 1_000), (601, 700, 1_101, 1_200)], "{engine}: blocks meeting at a 100-base insertion");
        assert_eq!(run(&deleted), vec![(501, 600, 901, 1_000), (701, 800, 1_001, 1_100)], "{engine}: blocks meeting at a 100-base deletion");
        assert_eq!(
            run(&close),
            vec![(501, 560, 901, 960), (561, 584, 964, 987), (585, 640, 993, 1_048)],
            "{engine}: a 24-base stretch between two insertions"
        );
    }
}

/// AC6 (BG-01M6TAB2, data seat round 1): a link of a chain costs 2 for its junction and 2 per base
/// of the indel it spans. Two planted 15-base copies 20 bases apart in A, across an insertion of 3
/// bases into B, score 30 less the link's 8: 22, under the floor, so neither is a block, where 2 per
/// base alone (24) would keep both. Two 16-base copies across the same insertion score 32 less 8,
/// on the floor, and are both blocks, where a junction term of 4 would drop them.
#[test]
fn synteny_link_cost_charges_its_junction_term() {
    for engine in ["Mauve", "LASTZ"] {
        let run = |copies: &[(usize, usize, usize)]| {
            let (a, b) = planted_copies(copies);
            spans(&run_whole_genome_synteny_with_sampling(&a, &b, engine, 1, 1))
        };
        assert_eq!(run(&[(500, 900, 15), (535, 938, 15)]), vec![], "{engine}: two 15-base copies across a 3-base insertion");
        assert_eq!(
            run(&[(500, 900, 16), (536, 939, 16)]),
            vec![(501, 516, 901, 916), (537, 552, 940, 955)],
            "{engine}: two 16-base copies across a 3-base insertion"
        );
    }
}

/// `n` with its digits grouped in threes, as the report's warnings write a count.
fn group_digits(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (idx, ch) in digits.chars().enumerate() {
        if idx > 0 && (digits.len() - idx) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}
