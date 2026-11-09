// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1C1: the minimizer chainer's result names the bases it compared and says whether its
//! seed-anchor cap or its chain-list cap was reached. Coverage, identity and the inversion count
//! are over every chain counted, so a capped list does not shrink them; the anchor cap stops the
//! seeding at a query base, which the result names, and no chain reaches past it.
//!
//! Round 2: a chain counts only when it holds more anchors than chance seed matches between
//! genomes of the lengths and base compositions compared are expected to chain, so a related pair
//! with no rearrangement is one chain at every size while a planted 5 kb inversion and duplication
//! are still reported; and the predecessor search has no bound that splits or drops a true chain.
//!
//! The genomes are built from fixed seeds, so what they hold is known by construction: which
//! blocks of the target the query copies, in what order and on which strand.

use molbiocraft_align::{align_large_genomes_minimizer_chain, LargeGenomeMinimizerChainReport};

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

fn revcomp(s: &[u8]) -> Vec<u8> {
    s.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'G' => b'C',
            _ => b'G',
        })
        .collect()
}

fn text(s: &[u8]) -> String {
    String::from_utf8(s.to_vec()).unwrap()
}

fn group(n: usize) -> String {
    let d = n.to_string();
    d.chars()
        .enumerate()
        .flat_map(|(i, c)| (i > 0 && (d.len() - i) % 3 == 0).then_some(',').into_iter().chain([c]))
        .collect()
}

/// The studio's settings: w = 8, k = 13, at most 64 target copies of a seed.
fn chain(target: &[u8], query: &[u8]) -> LargeGenomeMinimizerChainReport {
    align_large_genomes_minimizer_chain(&text(target), &text(query), 8, 13, 64)
}

/// SplitMix64: a second, independent stream for substitutions and composition.
struct SplitMix(u64);
impl SplitMix {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// `s` with one base in `per` (on average) replaced by a different base, and nothing else.
fn substitute(s: &[u8], seed: u64, per: u64) -> Vec<u8> {
    let mut r = SplitMix(seed);
    s.iter()
        .map(|&b| {
            let z = r.next();
            if z % per != 0 {
                return b;
            }
            let i = b"ACGT".iter().position(|&c| c == b).unwrap();
            b"ACGT"[(i + 1 + ((z >> 32) % 3) as usize) % 4]
        })
        .collect()
}

/// Random bases with `gc` per mille G + C, split evenly within each pair.
fn bases_with_gc(n: usize, gc: u64, seed: u64) -> Vec<u8> {
    let mut r = SplitMix(seed);
    (0..n)
        .map(|_| {
            let u = r.next() % 1000;
            if u < gc / 2 {
                b'C'
            } else if u < gc {
                b'G'
            } else if u < gc + (1000 - gc) / 2 {
                b'A'
            } else {
                b'T'
            }
        })
        .collect()
}

/// The identity of a substitution-only pair, from its alignment: base `i` against base `i`.
fn ungapped_identity_pct(a: &[u8], b: &[u8]) -> f64 {
    100.0 * a.iter().zip(b).filter(|(x, y)| x == y).count() as f64 / a.len() as f64
}

#[test]
fn reports_compared_range_and_caps() {
    // 1. Two 200 kb genomes 1% apart: both compared whole, neither cap reached, nothing to warn.
    let target = random_bases(200_000, 0x5eed_c4a1);
    let mut x = 0x1234_5678u64;
    let query: Vec<u8> = target
        .iter()
        .map(|&b| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            if x % 100 == 0 { b"ACGT"[((x >> 8) % 4) as usize] } else { b }
        })
        .collect();
    let whole = chain(&target, &query);
    assert_eq!((whole.target_length_bp, whole.target_compared_bp), (200_000, 200_000));
    assert_eq!((whole.query_length_bp, whole.query_compared_bp), (200_000, 200_000));
    assert!(!whole.anchor_cap_reached && !whole.chain_cap_reached);
    assert_eq!(whole.total_chains, whole.chains.len());
    assert!(whole.target_covered_pct > 99.0 && whole.query_covered_pct > 99.0, "{} {}", whole.target_covered_pct, whole.query_covered_pct);
    assert!(whole.warnings.is_empty(), "{:?}", whole.warnings);
    let json = serde_json::to_value(&whole).unwrap();
    for key in ["targetComparedBp", "queryComparedBp", "anchorCapReached", "totalChains", "chainCapReached"] {
        assert!(json.get(key).is_some(), "{key} in the reply");
    }
    assert_eq!(json["warnings"], serde_json::json!([]));

    // 2. More chains than the list holds. The target is 100 blocks of 4 kb. The query copies 3 kb
    //    of 90 of them in reverse block order, then the other 10 (every tenth block) as 2 kb
    //    reverse complements in forward order, so no two blocks are co-linear and none chain
    //    together: 100 block chains, 10 of them inverted and the lowest-scoring. A random seed
    //    match or two can add a 3-anchor chain. The list holds 64; coverage and the inversion
    //    count are over every chain.
    let target = random_bases(400_000, 0x0b10_c4ed);
    let mut query = Vec::new();
    for b in (0..100).rev().filter(|b| b % 10 != 0) {
        query.extend_from_slice(&target[b * 4_000..b * 4_000 + 3_000]);
    }
    for b in (0..100).filter(|b| b % 10 == 0) {
        query.extend(revcomp(&target[b * 4_000..b * 4_000 + 2_000]));
    }
    assert_eq!(query.len(), 90 * 3_000 + 10 * 2_000);
    let many = chain(&target, &query);
    assert!(many.chain_cap_reached && !many.anchor_cap_reached);
    assert_eq!(many.chains.len(), 64);
    assert!((100..=105).contains(&many.total_chains), "every block is a chain: {}", many.total_chains);
    // the 64 listed blocks cover 192 kb of the 290 kb query (66%); all 100 cover nearly all of it
    assert!(many.query_covered_pct > 97.0, "query coverage over every chain: {}", many.query_covered_pct);
    // 90 x 3 kb + 10 x 2 kb of the 400 kb target is 72.5% (the 64 listed: 48%)
    assert!(many.target_covered_pct >= 72.0, "target coverage: {}", many.target_covered_pct);
    assert!(many.inversion_chains >= 10, "every inverted block is counted: {}", many.inversion_chains);
    assert!(many.chains.iter().all(|c| c.strand == 1), "the listed 64 are 3 kb forward blocks");
    assert_eq!(
        many.warnings,
        [format!(
            "Chain list capped: it lists the 64 highest-scoring of the {0} chains found; coverage, identity and the inversion count use all {0}.",
            group(many.total_chains)
        )]
    );

    // 3. More seed anchors than the cap of 2,000,000. The target is 60 copies of a 20 kb unit and
    //    the query 20 copies, so each query seed hits 60 target copies, and the seeding stops part
    //    of the way along the query. The result names where; every chain ends there or earlier,
    //    and the chains cover that range, not the whole query.
    let unit = random_bases(20_000, 0x00ca_9000);
    let target: Vec<u8> = unit.iter().copied().cycle().take(60 * 20_000).collect();
    let query: Vec<u8> = unit.iter().copied().cycle().take(20 * 20_000).collect();
    let dense = chain(&target, &query);
    assert!(dense.anchor_cap_reached);
    // a query seed brings at most 64 hits (more is a repeat and is skipped), all or none
    assert!(dense.raw_seed_matches <= 2_000_000 && dense.raw_seed_matches > 2_000_000 - 64, "{}", dense.raw_seed_matches);
    assert_eq!((dense.target_compared_bp, dense.query_length_bp), (1_200_000, 400_000));
    let seeded = dense.query_compared_bp;
    assert!(seeded > 20_000 && seeded < 400_000, "the seeding stops inside the query: {seeded}");
    assert!(dense.chains.iter().all(|c| c.query_end_bp <= seeded), "no chain reaches past base {seeded}");
    assert!(dense.query_covered_pct > 90.0, "the coverage is of query bases 1-{seeded}: {}", dense.query_covered_pct);
    let expected_cut = format!(
        "Seed anchor cap reached: the chainer stopped at {} seed anchors, so it compared only query bases 1-{} of 400,000; query bases past {} are not chained, and both coverage figures count only chains from bases 1-{}.",
        group(dense.raw_seed_matches),
        group(seeded),
        group(seeded),
        group(seeded)
    );
    assert_eq!(dense.warnings.first(), Some(&expected_cut), "{:?}", dense.warnings);
}

/// BG-01M6S1C1 round 2. Two genomes 1% apart by substitution alone, with no rearrangement, are one
/// co-linear chain at every size: no chain of chance seed matches is counted, so there is no
/// inversion, and the identity is that chain's, within 0.2 points of the identity their alignment
/// gives (base against base, as nothing moved). Round 1 counted every chain of 3 anchors or more:
/// on these two 5 Mb genomes 34 chains, 31 of them "inversions" of 3 or 4 chance anchors, most at
/// 69.9%, for an identity of 97.0. The fewest anchors a chain needs grows with the genomes
/// compared.
#[test]
fn colinear_pairs_count_one_chain_at_every_size() {
    for (bases, needs) in [(120_000, 6), (1_000_000, 8), (5_000_000, 10)] {
        let target = random_bases(bases, 0x5eed_0001);
        let query = substitute(&target, 0x77, 100);
        let truth = ungapped_identity_pct(&target, &query);
        assert!((98.9..99.1).contains(&truth), "fixture: 1% substituted, {truth}");
        let report = chain(&target, &query);
        let shown: Vec<_> = report.chains.iter().map(|c| (c.strand, c.anchor_count, c.target_start_bp, c.target_end_bp, c.structural_event.clone())).collect();
        assert_eq!((report.total_chains, report.inversion_chains), (1, 0), "{bases} bp: {shown:?}");
        assert_eq!(report.chains.len(), 1);
        let only = &report.chains[0];
        assert_eq!((only.strand, only.structural_event.as_str()), (1, "colinear"));
        assert!(only.target_start_bp <= 20 && only.target_end_bp + 20 >= bases, "{bases} bp: {shown:?}");
        assert!(report.target_covered_pct >= 99.9 && report.query_covered_pct >= 99.9);
        assert!(
            (report.weighted_identity_pct - truth).abs() <= 0.2,
            "{bases} bp: identity {} against the alignment's {truth:.3}",
            report.weighted_identity_pct
        );
        assert_eq!(report.min_chain_anchors, needs, "{bases} bp");
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    }
    // two unrelated 1 Mb genomes of even composition: no chain, and nothing covered
    let unrelated = chain(&random_bases(1_000_000, 0x0dd1), &random_bases(1_000_000, 0x0dd2));
    let shown: Vec<_> = unrelated.chains.iter().map(|c| (c.strand, c.anchor_count, c.target_start_bp, c.target_end_bp)).collect();
    assert_eq!(unrelated.total_chains, 0, "{shown:?}");
    assert_eq!((unrelated.target_covered_pct, unrelated.query_covered_pct), (0.0, 0.0));
}

/// Two genomes of uneven base composition agree by chance more often, so a chain needs more
/// anchors before chance is ruled out: a 25%-GC pair 1% apart is one chain, and two unrelated
/// 25%-GC genomes are none. Taken at 25% per base, the anchor count (8 at 1 Mb) lets five
/// "inversions" of 8 or 9 chance anchors through on this related pair.
#[test]
fn uneven_base_composition_raises_the_anchors_a_chain_needs() {
    let target = bases_with_gc(1_000_000, 250, 0x6c25);
    let query = substitute(&target, 0x6c26, 100);
    let related = chain(&target, &query);
    let shown: Vec<_> = related.chains.iter().map(|c| (c.strand, c.anchor_count, c.structural_event.clone())).collect();
    assert_eq!((related.total_chains, related.inversion_chains), (1, 0), "{shown:?}");
    assert!(related.target_covered_pct >= 99.9);
    assert!((related.weighted_identity_pct - ungapped_identity_pct(&target, &query)).abs() <= 0.2, "{}", related.weighted_identity_pct);

    let unrelated = chain(&target, &bases_with_gc(1_000_000, 250, 0x6c27));
    let shown: Vec<_> = unrelated.chains.iter().map(|c| (c.strand, c.anchor_count, c.target_start_bp, c.target_end_bp)).collect();
    assert_eq!(unrelated.total_chains, 0, "{shown:?}");
    assert_eq!((unrelated.target_covered_pct, unrelated.query_covered_pct), (0.0, 0.0));
    // at 25% GC two bases agree by chance at 0.3125, not 0.25, so more anchors are needed
    assert!(related.min_chain_anchors >= 2 * 8, "{}", related.min_chain_anchors);
}

/// A true 5 kb inversion and a true 5 kb duplication in two 5 Mb genomes 1% apart are each
/// reported, where they were planted, beside the one co-linear chain; nothing else is.
#[test]
fn planted_inversion_and_duplication_are_reported_where_they_are() {
    let target = random_bases(5_000_000, 0x91a7);
    // query: target[..2 Mb], the next 5 kb reverse-complemented, the target on to 3.5 Mb, a copy
    // of target 1,000,001-1,005,000, then the rest of the target
    let mut planted = target[..2_000_000].to_vec();
    planted.extend(revcomp(&target[2_000_000..2_005_000]));
    planted.extend_from_slice(&target[2_005_000..3_500_000]);
    planted.extend_from_slice(&target[1_000_000..1_005_000]);
    planted.extend_from_slice(&target[3_500_000..]);
    let query = substitute(&planted, 0x91a8, 100);
    assert_eq!(query.len(), 5_005_000);

    let report = chain(&target, &query);
    let shown: Vec<_> = report
        .chains
        .iter()
        .map(|c| (c.strand, c.anchor_count, c.target_start_bp, c.target_end_bp, c.query_start_bp, c.query_end_bp, c.structural_event.clone()))
        .collect();
    assert_eq!((report.total_chains, report.inversion_chains), (3, 1), "{shown:?}");
    // 1-based spans, to within the first and last minimizer of each 5 kb block
    let near = |got: usize, want: usize| got.abs_diff(want) <= 60;
    let inversion = report.chains.iter().find(|c| c.strand == -1).expect("an inversion chain");
    assert_eq!(inversion.structural_event, "inversion");
    assert!(
        near(inversion.target_start_bp, 2_000_001) && near(inversion.target_end_bp, 2_005_000)
            && near(inversion.query_start_bp, 2_000_001) && near(inversion.query_end_bp, 2_005_000),
        "{shown:?}"
    );
    let duplication = report.chains.iter().find(|c| c.structural_event == "duplication").expect("a duplication chain");
    assert_eq!(duplication.strand, 1);
    assert!(
        near(duplication.target_start_bp, 1_000_001) && near(duplication.target_end_bp, 1_005_000)
            && near(duplication.query_start_bp, 3_500_001) && near(duplication.query_end_bp, 3_505_000),
        "{shown:?}"
    );
    let main = report.chains.iter().find(|c| c.structural_event == "colinear").expect("the co-linear chain");
    assert!(main.target_start_bp <= 20 && main.target_end_bp + 20 >= 5_000_000, "{shown:?}");
    // each 5 kb block 1% diverged seeds about 1,000 anchors, far above the 10 a chain needs
    for c in [inversion, duplication] {
        assert!((800..1_200).contains(&c.anchor_count), "{shown:?}");
    }
    assert_eq!(report.min_chain_anchors, 10);
}

/// BG-01M6S1C1 round 2: a 2 kb segment moved from between two co-linear blocks to the end (target
/// A-D-B-C, query A-B-C-D) leaves A, B and C one chain across the gap D leaves, as the exhaustive
/// predecessor search finds it, and D a chain of its own. Round 1 examined at most 256 earlier
/// anchors for each, and D's 459 anchors stood between A and B on the target, so A (7-29,996) and
/// B-C (32,001-202,000) were two chains.
#[test]
fn a_moved_segment_leaves_its_neighbours_one_chain() {
    let a = random_bases(30_000, 0xa0);
    let d = random_bases(2_000, 0xd0);
    let b = random_bases(130_000, 0xb0);
    let c = random_bases(40_000, 0xc0);
    let target = [a.clone(), d.clone(), b.clone(), c.clone()].concat();
    let query = [a, b, c, d].concat();
    let report = chain(&target, &query);
    let shown: Vec<_> = report.chains.iter().map(|c| (c.target_start_bp, c.target_end_bp, c.query_start_bp, c.query_end_bp, c.anchor_count)).collect();
    assert_eq!(report.total_chains, 2, "{shown:?}");
    // A-B-C: target 1-30,000 and 32,001-202,000 against query 1-200,000
    let abc = &report.chains[0];
    assert!(abc.target_start_bp <= 20 && abc.target_end_bp + 20 >= 202_000, "{shown:?}");
    assert!(abc.query_start_bp <= 20 && abc.query_end_bp + 20 >= 200_000, "{shown:?}");
    // D: target 30,001-32,000 against query 200,001-202,000
    let moved = &report.chains[1];
    assert!(moved.target_start_bp.abs_diff(30_001) <= 30 && moved.target_end_bp.abs_diff(32_000) <= 30, "{shown:?}");
    assert!(moved.query_start_bp.abs_diff(200_001) <= 30 && moved.query_end_bp.abs_diff(202_000) <= 30, "{shown:?}");
}

/// BG-01M6S1C1 round 2: a 3 kb unit once in the target and 300 times in tandem in the query. Each
/// query copy is a chain on the unit, and the coverage of both genomes is whole. Round 1 examined
/// at most 256 earlier anchors for each, and the 300 copies stack 300 anchors at each target
/// position of the unit, so no chain covered the unit (98.5% of the target); a copy that hangs
/// from another through a 3 kb diagonal shift is cut there and counted on its own.
#[test]
fn every_copy_of_a_tandem_array_finds_its_unit() {
    let (left, unit, right) = (random_bases(100_000, 0x1e), random_bases(3_000, 0x0e), random_bases(100_000, 0x2e));
    let target = [left.clone(), unit.clone(), right.clone()].concat();
    let query = [left, unit.repeat(300), right].concat();
    let report = chain(&target, &query);
    assert!(report.target_covered_pct >= 99.9, "target {}", report.target_covered_pct);
    assert!(report.query_covered_pct >= 99.5, "query {}", report.query_covered_pct);
    assert_eq!(report.inversion_chains, 0);
    // The list holds the 64 best chains: the two flanks, each with the copy beside it, and 62
    // copies, each on the unit (target 100,001-103,000) and inside one copy of the query. A
    // chain may run a base or two past a copy's end, where a junction k-mer matches by chance.
    let shown: Vec<_> = report.chains.iter().map(|c| (c.target_start_bp, c.target_end_bp, c.query_start_bp, c.query_end_bp, c.anchor_count)).collect();
    let on_unit: Vec<_> = report.chains.iter().filter(|c| c.target_start_bp + 30 >= 100_001 && c.target_end_bp <= 103_000 + 30).collect();
    assert_eq!(on_unit.len(), 62, "{shown:?}");
    for c in on_unit.iter().filter(|c| c.query_start_bp > 103_000 && c.query_end_bp <= 1_000_000) {
        let copy = (c.query_start_bp - 100_001) / 3_000;
        assert!(c.query_end_bp <= 100_000 + (copy + 1) * 3_000 + 30, "a chain stays inside one copy: {:?}", (c.query_start_bp, c.query_end_bp));
        assert!(c.anchor_count >= 600, "a copy's chain holds its unit's anchors: {:?}", (c.query_start_bp, c.anchor_count));
    }
    // the copies of the query: 300 of them, each lying in at least one counted chain's span (the
    // query coverage above), so no copy is left out
    assert!(report.total_chains >= 300, "{} chains", report.total_chains);
}
