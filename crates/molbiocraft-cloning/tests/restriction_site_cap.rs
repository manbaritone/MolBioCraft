// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1K2: the restriction scan once stopped at 12,000 sites in all and skipped its
//! degenerate-site pass once it got there, so past about 75 kb frequent cutters were listed as
//! single cutters and enzymes that do cut as noncutters. Every count is now complete; only the
//! list of positions is limited, per enzyme, and the scan says when it limited it.
//!
//! Every count here is checked against a direct count written in this file: each recognition site
//! matched base by base on both strands, a sequence letter matching a site letter when its base set
//! lies inside the site letter's (D0181's subset rule, which US-01M6VF1T makes the scan's), with
//! nothing taken from the engine's scanner.

use molbiocraft_align::align_pairwise_standard;
use molbiocraft_align::pairwise::PAIRWISE_ENGINE_LABEL;
use molbiocraft_cloning::compute_document_table_metrics_rust;
use molbiocraft_cloning::rebase_catalog::{
    find_non_cutting_enzymes_for_topology, find_restriction_cut_sites, get_rebase_enzymes,
    scan_restriction_sites, simulate_restriction_digest, RestrictionPositionLimit,
    RestrictionSiteScan, CORE_CATALOG_LEN, RESTRICTION_POSITIONS_PER_ENZYME,
};
use molbiocraft_cloning::workbench_table_and_lineage::RecordChecksState;
use molbiocraft_core::types::{MoleculeType, RestrictionEnzyme, SequenceDocument, Topology};
use std::collections::BTreeMap;

/// xorshift64* draws from a fixed seed.
fn draws(seed: u64) -> impl FnMut() -> u64 {
    let mut s = seed;
    move || {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        s.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
}

/// A reproducible pseudo-random DNA sequence, each base G or C with probability `gc`.
fn random_dna(len: usize, gc: f64, seed: u64) -> String {
    let mut next = draws(seed);
    (0..len)
        .map(|_| {
            let x = next();
            let strong = ((x >> 11) as f64 / (1u64 << 53) as f64) < gc;
            match (strong, x & 1) {
                (true, 0) => 'G',
                (true, _) => 'C',
                (false, 0) => 'A',
                (false, _) => 'T',
            }
        })
        .collect()
}

/// Random DNA of `len` bases with `repeats` copies of GATC from base 20,001: every copy is a site of
/// DpnI, MboI, Sau3AI and DpnII, and every junction one of ClaI, BspDI, TaqI-v2 and PvuI-HF, so
/// those enzymes cut more often than the scan keeps positions for.
fn dna_with_gatc_block(len: usize, repeats: usize, seed: u64) -> String {
    let mut s = random_dna(len, 0.5, seed);
    s.replace_range(20_000..20_000 + 4 * repeats, &"GATC".repeat(repeats));
    s
}

/// `s` with bases a recognition site can match only through its own N (an N in the sequence lies
/// inside a site's N and no other site letter): five copies each of HinfI, DdeI, Sau96I, ScrFI,
/// BlpI, Bsu36I and PflFI/Tth111I sites spelled with an N, from base 70,001; a 300 bp run of N;
/// and R and Y bases every 37 bases from base 86,001, each a definite match only for a site letter
/// whose set holds both its bases (R under R, D, V or N; Y under Y, B, H or N). A scan that spells
/// a site's N out as A, C, G and T only finds none of the planted sites.
fn with_ambiguous_bases(mut s: String) -> String {
    let planted = ["GANTC", "CTNAG", "GGNCC", "CCNGG", "GCTNAGC", "CCTNAGG", "GACNNNGTC"];
    for (k, site) in planted.iter().enumerate() {
        for copy in 0..5 {
            let at = 70_000 + k * 1_000 + copy * 150;
            s.replace_range(at..at + site.len(), site);
        }
    }
    s.replace_range(85_000..85_300, &"N".repeat(300));
    for (k, at) in (86_000..89_000).step_by(37).enumerate() {
        s.replace_range(at..at + 1, if k % 2 == 0 { "R" } else { "Y" });
    }
    s
}

fn dna_doc(id: &str, sequence: String, topology: Topology) -> SequenceDocument {
    SequenceDocument {
        id: id.into(),
        name: id.into(),
        molecule_type: MoleculeType::DNA,
        topology,
        sequence,
        folder: "Cloning".into(),
        ..Default::default()
    }
}

// ─── The direct count ───

/// Whether a sequence letter is a definite match for a site letter, by D0181's subset rule
/// (US-01M6VF1T, re-pinned by D0197): the sequence letter's base set lies inside the site letter's,
/// so an R in the sequence is a definite match for a site R, D or N, and an N only for a site N. A
/// letter outside the IUPAC codes stands for no base and matches nothing. The sets are written here,
/// not taken from the engine.
fn base_matches(seq_base: u8, site_base: u8) -> bool {
    fn bases(letter: u8) -> &'static [u8] {
        match letter {
            b'A' => b"A",
            b'C' => b"C",
            b'G' => b"G",
            b'T' => b"T",
            b'R' => b"AG",
            b'Y' => b"CT",
            b'S' => b"CG",
            b'W' => b"AT",
            b'K' => b"GT",
            b'M' => b"AC",
            b'B' => b"CGT",
            b'D' => b"AGT",
            b'H' => b"ACT",
            b'V' => b"ACG",
            b'N' => b"ACGT",
            _ => b"",
        }
    }
    let (seq, site) = (bases(seq_base), bases(site_base));
    !seq.is_empty() && seq.iter().all(|b| site.contains(b))
}

fn reverse_complement(site: &str) -> String {
    site.bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            b'T' => 'A',
            b'R' => 'Y',
            b'Y' => 'R',
            b'S' => 'S',
            b'W' => 'W',
            b'K' => 'M',
            b'M' => 'K',
            b'B' => 'V',
            b'V' => 'B',
            b'D' => 'H',
            b'H' => 'D',
            _ => 'N',
        })
        .collect()
}

/// The sites of `e` in `seq`, up to `stop_at`: a recognition site read on the top strand, and on
/// the bottom strand too when it is not its own reverse complement. A circular molecule's sites may
/// run across the origin; on a linear one both strands' cuts must fall inside the molecule.
fn direct_sites(seq: &str, e: &RestrictionEnzyme, topology: Topology, stop_at: usize) -> usize {
    let s = seq.as_bytes();
    let len = s.len();
    let site = e.recognition_seq.to_ascii_uppercase();
    let rc = reverse_complement(&site);
    let m = site.len();
    let mut strands = vec![(site.clone().into_bytes(), 1i8)];
    if rc != site {
        strands.push((rc.into_bytes(), -1));
    }
    let mut n = 0;
    for (motif, strand) in &strands {
        for i in 0..len {
            if topology == Topology::Linear && i + m > len {
                break;
            }
            if !(0..m).all(|k| base_matches(s[(i + k) % len], motif[k])) {
                continue;
            }
            if topology == Topology::Linear {
                let (top, bottom) = if *strand == 1 {
                    (i as i64 + e.cut_fwd as i64, i as i64 + e.cut_rev as i64)
                } else {
                    (i as i64 + m as i64 - e.cut_rev as i64, i as i64 + m as i64 - e.cut_fwd as i64)
                };
                let inside = |c: i64| (0..=len as i64).contains(&c);
                if !(inside(top) && inside(bottom)) {
                    continue;
                }
            }
            n += 1;
            if n >= stop_at {
                return n;
            }
        }
    }
    n
}

fn counts_of(scan: &RestrictionSiteScan) -> BTreeMap<String, usize> {
    scan.site_counts.iter().map(|c| (c.enzyme.clone(), c.sites)).collect()
}

fn names(enzymes: &[RestrictionEnzyme]) -> Vec<String> {
    enzymes.iter().map(|e| e.name.clone()).collect()
}

fn default_scan(seq: &str, topology: Topology) -> RestrictionSiteScan {
    scan_restriction_sites(seq, topology, None, RestrictionPositionLimit::PerEnzyme(RESTRICTION_POSITIONS_PER_ENZYME))
}

#[test]
fn every_scanned_enzyme_count_is_complete() {
    let catalog = get_rebase_enzymes();
    // 90 kb with the whole catalogue, of A, C, G and T only and again with bases matched only by a
    // site's N, and 150 kb with the core enzymes the scan reads above 100,000 bp. Each holds 2,500
    // GATC repeats, so the full-catalogue sites run past 12,000 (where the scan once stopped) and
    // DpnI, ClaI and their kin have more sites than the scan keeps positions for: a count taken
    // from the kept positions is short for them. A sequence holding an N reads a site with three
    // Ns base by base rather than in the one-pass automaton, so both ways of matching are counted.
    let ninety = dna_with_gatc_block(90_000, 2_500, 0x90_0000);
    let cases = [
        (ninety.clone(), &catalog[..]),
        (with_ambiguous_bases(ninety), &catalog[..]),
        (dna_with_gatc_block(150_000, 2_500, 0x150_0000), &catalog[..CORE_CATALOG_LEN]),
    ];
    // The planted sites are sites only through their N, five of each.
    let planted_region = &cases[1].0[70_000..77_000];
    for (name, site) in [("HinfI", "GANTC"), ("BlpI", "GCTNAGC"), ("PflFI", "GACNNNGTC")] {
        let e = catalog.iter().find(|e| e.name == name).unwrap();
        let direct = direct_sites(planted_region, e, Topology::Linear, usize::MAX);
        assert_eq!((planted_region.matches(site).count(), direct >= 5), (5, true), "the fixture plants five {name} sites with an N: {direct}");
    }
    // The subset rule at work on the R and Y bases: BstYI (RGATCY) has 91 sites on the linear
    // record with them, one of them a window whose sequence R lies under the site's R (or Y under
    // its Y), which a rule matching an R in the sequence to no site letter does not count.
    let bst = catalog.iter().find(|e| e.name == "BstYI").unwrap();
    assert_eq!(direct_sites(&cases[1].0, bst, Topology::Linear, usize::MAX), 91, "BstYI by the subset rule");
    let seq = cases[1].0.as_bytes();
    let through_r_or_y = (0..seq.len() - 5)
        .filter(|&i| (0..6).all(|k| base_matches(seq[i + k], b"RGATCY"[k])) && seq[i..i + 6].iter().any(|b| matches!(b, b'R' | b'Y')))
        .count();
    assert_eq!(through_r_or_y, 1, "one BstYI site is definite only through an R or Y in the sequence");
    for (seq, scanned) in &cases {
        for topology in [Topology::Linear, Topology::Circular] {
            let scan = default_scan(seq, topology);
            let what = format!("{} bp {:?}", seq.len(), topology);
            let listed: Vec<String> = scan.site_counts.iter().map(|c| c.enzyme.clone()).collect();
            assert_eq!(listed, names(scanned), "{what}: every enzyme of the scope is counted, in catalogue order");
            let total: usize = scan.site_counts.iter().map(|c| c.sites).sum();
            if scanned.len() == catalog.len() {
                assert!(total > 12_000, "{what}: the fixture holds more sites than the scan once stopped at: {total}");
            }
            assert!(!scan.capped_enzymes.is_empty(), "{what}: the fixture holds enzymes cutting more often than positions are kept for");
            let counts = counts_of(&scan);
            for e in scanned.iter() {
                assert_eq!(counts[&e.name], direct_sites(seq, e, topology, usize::MAX), "{what}: {} ({})", e.name, e.recognition_seq);
            }
        }
    }
}

#[test]
fn no_false_single_cutters_or_noncutters() {
    let catalog = get_rebase_enzymes();
    let ascii = catalog.iter().find(|e| e.name == "AscI").unwrap().clone();
    let noti = catalog.iter().find(|e| e.name == "NotI").unwrap().clone();
    // 90 kb and 100 kb of random DNA, scanned with the whole catalogue. And 1 Mb at 30 % GC, read
    // with the core enzymes: an AscI site before 24 kb of GATC repeats (24,000 sites of the core
    // DpnI and ClaI, past the 12,000 where the scan once stopped) and another near the end, and one
    // NotI site at 600 kb. A scan that stopped would call AscI a single cutter and NotI a noncutter.
    let mut mb = random_dna(1_000_000, 0.3, 0x1_000_002);
    mb.replace_range(100..108, "GGCGCGCC");
    mb.replace_range(1_000..25_000, &"GATC".repeat(6_000));
    mb.replace_range(600_000..600_008, "GCGGCCGC");
    mb.replace_range(990_000..990_008, "GGCGCGCC");
    assert_eq!(direct_sites(&mb, &ascii, Topology::Linear, usize::MAX), 2, "the fixture's AscI cuts twice");
    assert_eq!(direct_sites(&mb, &noti, Topology::Linear, usize::MAX), 1, "the fixture's NotI cuts once");
    let cases = [random_dna(90_000, 0.5, 0x90), random_dna(100_000, 0.5, 0x100), mb];
    for seq in &cases {
        let topology = Topology::Linear;
        let scan = default_scan(seq, topology);
        let scanned: Vec<&RestrictionEnzyme> = catalog.iter().filter(|e| scan.site_counts.iter().any(|c| c.enzyme == e.name)).collect();
        let what = format!("{} bp", seq.len());

        // Single cutters read from the complete counts, and from the kept positions as the App's
        // other readers count them: each is a single cutter by a direct count.
        let counts = counts_of(&scan);
        let mut kept: BTreeMap<String, usize> = BTreeMap::new();
        for c in find_restriction_cut_sites(seq, topology, None) {
            *kept.entry(c.enzyme.name).or_default() += 1;
        }
        for e in &scanned {
            let direct = direct_sites(seq, e, topology, 2);
            assert_eq!(counts[&e.name] == 1, direct == 1, "{what}: {} is a single cutter by its count only if it cuts once", e.name);
            assert_eq!(kept.get(&e.name).copied().unwrap_or(0) == 1, direct == 1, "{what}: {} cuts once in the list only if it cuts once", e.name);
            assert_eq!(counts[&e.name] == 0, direct == 0, "{what}: {} is a noncutter by its count only if it has no site", e.name);
        }
        // The Noncutters list reads the whole catalogue at any length.
        let noncutters = names(&find_non_cutting_enzymes_for_topology(seq, topology, None));
        for e in &catalog {
            let has_site = direct_sites(seq, e, topology, 1) > 0;
            assert_eq!(noncutters.contains(&e.name), !has_site, "{what}: {} in the Noncutters list", e.name);
        }
    }
    let mb_counts = counts_of(&default_scan(&cases[2], Topology::Linear));
    assert_eq!((mb_counts["AscI"], mb_counts["NotI"]), (2, 1), "1 Mb: the sites past the GATC repeats are counted");
}

#[test]
fn digest_uses_every_cut_or_refuses() {
    // 5 Mb with AluI (AGCT), a four-cutter Dam and Dcm do not block: about 19,500 sites, more
    // than the scan once stopped at and far more than it keeps positions for per enzyme.
    let seq = random_dna(5_000_000, 0.5, 0x5_000_000);
    let alui = get_rebase_enzymes().into_iter().find(|e| e.name == "AluI").unwrap();
    assert!(alui.methylation_sensitivity.is_empty());
    let cuts = direct_sites(&seq, &alui, Topology::Linear, usize::MAX);
    assert!(cuts > 12_000, "the fixture: {cuts} AluI sites");
    let fragments = simulate_restriction_digest(&dna_doc("genome-5mb", seq.clone(), Topology::Linear), &["AluI".to_string()]);
    // A refusal would be no fragments and a message; this digest lists every cut instead.
    assert_eq!(fragments.len(), cuts + 1, "a linear digest has one fragment more than it has cuts");
    assert_eq!(fragments.iter().map(|f| f.length_bp).sum::<usize>(), seq.len(), "the fragments make up the whole molecule");
    let mut starts: Vec<usize> = fragments.iter().map(|f| f.start).collect();
    starts.sort_unstable();
    // AluI cuts AG^CT: every fragment but the first starts at the C of an AGCT site.
    let expected: Vec<usize> = std::iter::once(1)
        .chain(seq.as_bytes().windows(4).enumerate().filter(|(_, w)| *w == b"AGCT").map(|(i, _)| i + 3))
        .collect();
    assert_eq!(starts, expected, "each fragment starts at a cut");
    assert!(fragments.iter().all(|f| f.length_bp < 20_000), "no band stands in for uncut sites: the longest is {}", fragments[0].length_bp);
}

#[test]
fn capped_site_positions_carry_a_warning() {
    let catalog = get_rebase_enzymes();
    let seq = dna_with_gatc_block(90_000, 2_500, 0xCA9);
    let scan = default_scan(&seq, Topology::Linear);
    let counts = counts_of(&scan);
    let cap = RESTRICTION_POSITIONS_PER_ENZYME;
    assert_eq!(scan.positions_per_enzyme_cap, Some(cap));
    // The capped enzymes are exactly those with more sites than positions are kept for.
    let over: Vec<String> = catalog.iter().filter(|e| counts[&e.name] > cap).map(|e| e.name.clone()).collect();
    assert!(over.iter().any(|n| n == "DpnI") && over.iter().any(|n| n == "ClaI"), "the fixture: {over:?}");
    assert_eq!(scan.capped_enzymes, over);
    assert!(scan.stopped_early);
    // Each keeps its first `cap` positions; every other enzyme keeps all of its sites.
    for e in &catalog {
        let mut kept: Vec<usize> = scan.sites.iter().filter(|c| c.enzyme.name == e.name).map(|c| c.position).collect();
        assert_eq!(kept.len(), counts[&e.name].min(cap), "{} positions kept", e.name);
        if over.contains(&e.name) {
            let mut all: Vec<usize> = scan_restriction_sites(&seq, Topology::Linear, Some(std::slice::from_ref(e)), RestrictionPositionLimit::All)
                .sites
                .iter()
                .map(|c| c.position)
                .collect();
            all.sort_unstable();
            kept.sort_unstable();
            assert_eq!(kept, all[..cap], "{}: its first {cap} sites by position", e.name);
        }
    }
    // One sentence names the cap and every capped enzyme with its complete count.
    assert_eq!(scan.warnings.len(), 1, "{:?}", scan.warnings);
    let w = &scan.warnings[0];
    assert!(w.contains("2,000"), "{w}");
    for name in &over {
        assert!(w.contains(&format!("{} ({} sites)", name, molbiocraft_core::format_thousands(counts[name]))), "{name}: {w}");
    }
    let named = catalog.iter().filter(|e| w.contains(&format!("{} (", e.name))).count();
    assert_eq!(named, over.len(), "no other enzyme is named: {w}");

    // A scan that kept every site says nothing.
    let quiet = default_scan(&random_dna(20_000, 0.5, 0x20), Topology::Linear);
    assert_eq!((quiet.warnings.len(), quiet.capped_enzymes.len(), quiet.stopped_early), (0, 0, false));
    assert_eq!(quiet.sites.len(), quiet.site_counts.iter().map(|c| c.sites).sum::<usize>());
}

/// The enzymes the record checks read: those Dam or Dcm block, and the Type IIS ones.
fn record_check_enzymes() -> Vec<RestrictionEnzyme> {
    get_rebase_enzymes()
        .into_iter()
        .filter(|e| e.is_type_iis || e.methylation_sensitivity.iter().any(|m| m == "Dam" || m == "Dcm"))
        .collect()
}

/// The methylation alert's title in a record's alerts summary.
fn methylation_title(summary: &str) -> Option<&str> {
    summary.split(" | ").find_map(|a| a.strip_prefix("Methylation: "))
}

#[test]
fn record_checks_read_the_scan_stop_report() {
    let checked = record_check_enzymes();
    // The scan reports a stop: kept fewer sites than it found, under either kind of limit.
    let gatc_12k = "GATC".repeat(3_000);
    let total = scan_restriction_sites(&gatc_12k, Topology::Linear, Some(&checked), RestrictionPositionLimit::Total(12_000));
    let found: usize = total.site_counts.iter().map(|c| c.sites).sum();
    assert!(found > 12_000, "the fixture: {found} sites of the checked enzymes");
    assert_eq!((total.stopped_early, total.sites.len(), total.positions_total_cap), (true, 12_000, Some(12_000)));
    let all = scan_restriction_sites(&gatc_12k, Topology::Linear, Some(&checked), RestrictionPositionLimit::All);
    assert_eq!((all.stopped_early, all.sites.len()), (false, found));
    assert!(!default_scan(&random_dna(20_000, 0.5, 0x21), Topology::Linear).stopped_early);

    // A record whose scan kept every site it found is checked whole, however many it lists:
    // 4 kb of (GATC)n, 1,000 sites each of MboI, DpnII, ClaI, BspDI and TaqI-v2. The GATC probe
    // read the length of a list kept to 2,000 positions per enzyme and called this record
    // stopped; the scan's own report says it is complete.
    let gatc_4k = dna_doc("gatc-4k", "GATC".repeat(1_000), Topology::Linear);
    let listed = scan_restriction_sites(&gatc_4k.sequence, Topology::Linear, Some(&checked), RestrictionPositionLimit::Total(12_000));
    assert!(!listed.stopped_early && listed.sites.len() > RESTRICTION_POSITIONS_PER_ENZYME, "the fixture: {} sites, all kept", listed.sites.len());
    let m = compute_document_table_metrics_rust(&gatc_4k);
    assert_eq!(m.checks_state, RecordChecksState::Complete, "{} / {}", m.alerts_summary, m.checks_not_run);
    let dam: Vec<RestrictionEnzyme> = checked.iter().filter(|e| e.methylation_sensitivity.iter().any(|s| s == "Dam")).cloned().collect();
    let dam_sites = |seq: &str| dam.iter().map(|e| direct_sites(seq, e, Topology::Linear, usize::MAX)).sum::<usize>();
    // In (GATC)n every Dam-sensitive site overlaps a GATC, so every one is blocked.
    let exact = methylation_title(&m.alerts_summary).expect("the blocked sites are reported");
    assert!(exact.starts_with(&format!("{} Restriction Site(s) Blocked", dam_sites(&gatc_4k.sequence))), "an exact count: {exact}");

    // A record whose scan stopped is partly checked, and its methylation alert counts only the
    // sites the scan kept, so it says at least that many.
    let stopped = compute_document_table_metrics_rust(&dna_doc("gatc-12k", gatc_12k.clone(), Topology::Linear));
    assert_eq!(stopped.checks_state, RecordChecksState::Partial, "{}", stopped.alerts_summary);
    assert!(stopped.checks_not_run.contains("12,000-site cap"), "{}", stopped.checks_not_run);
    let title = methylation_title(&stopped.alerts_summary).expect("the blocked sites it kept are reported");
    let kept_blocked = total.sites.iter().filter(|c| c.methylation_blocked).count();
    assert!(title.starts_with(&format!("At least {kept_blocked} Restriction Site(s) Blocked by Dam/Dcm Methylation")), "{title}");
    assert!(kept_blocked < dam_sites(&gatc_12k), "the record holds more blocked sites than the stopped scan kept: {kept_blocked}");
}

// ─── Readers of the cut sites ───
//
// The scan keeps 2,000 positions per enzyme, so a reader that counts an enzyme's kept positions as
// its sites stops at 2,000. Each reader below is checked on an enzyme that cuts more often.

/// Where each site of `e` in `seq` starts (0-based) and on which strand, read as `direct_sites`
/// reads them.
fn direct_site_starts(seq: &str, e: &RestrictionEnzyme, topology: Topology) -> Vec<(usize, i8)> {
    let s = seq.as_bytes();
    let len = s.len();
    let site = e.recognition_seq.to_ascii_uppercase();
    let rc = reverse_complement(&site);
    let m = site.len();
    let mut strands = vec![(site.clone().into_bytes(), 1i8)];
    if rc != site {
        strands.push((rc.into_bytes(), -1));
    }
    let mut out = Vec::new();
    for (motif, strand) in &strands {
        for i in 0..len {
            if topology == Topology::Linear && i + m > len {
                break;
            }
            if !(0..m).all(|k| base_matches(s[(i + k) % len], motif[k])) {
                continue;
            }
            if topology == Topology::Linear {
                let (top, bottom) = if *strand == 1 {
                    (i as i64 + e.cut_fwd as i64, i as i64 + e.cut_rev as i64)
                } else {
                    (i as i64 + m as i64 - e.cut_rev as i64, i as i64 + m as i64 - e.cut_fwd as i64)
                };
                let inside = |c: i64| (0..=len as i64).contains(&c);
                if !(inside(top) && inside(bottom)) {
                    continue;
                }
            }
            out.push((i, *strand));
        }
    }
    out
}

/// The sites of `e` on a linear `seq` that a dam+ dcm+ host's methylation blocks: `e` is Dam
/// sensitive and a GATC, or Dcm sensitive and a CCAGG or CCTGG, lies within the site or the three
/// bases either side of it.
fn direct_blocked_linear(seq: &str, e: &RestrictionEnzyme) -> usize {
    let dam = e.methylation_sensitivity.iter().any(|m| m == "Dam");
    let dcm = e.methylation_sensitivity.iter().any(|m| m == "Dcm");
    let m = e.recognition_seq.len();
    direct_site_starts(seq, e, Topology::Linear)
        .into_iter()
        .filter(|&(i, _)| {
            let ctx = &seq[i.saturating_sub(3)..(i + m + 3).min(seq.len())];
            (dam && ctx.contains("GATC")) || (dcm && (ctx.contains("CCAGG") || ctx.contains("CCTGG")))
        })
        .count()
}

fn enzyme(name: &str) -> RestrictionEnzyme {
    get_rebase_enzymes().into_iter().find(|e| e.name == name).unwrap_or_else(|| panic!("{name} is in the catalogue"))
}

/// Random bases with no CTAG, so no NheI, XbaI or BfaI site.
fn random_dna_without_ctag(len: usize, seed: u64) -> String {
    random_dna(len, 0.5, seed).replace("CTAG", "CAAG")
}

#[test]
fn the_scan_counts_every_methylation_blocked_site() {
    // 20 kb, linear: 2,100 GATC repeats, every one a site of MboI and DpnII that Dam blocks and of
    // Sau3AI, which Dam does not block; their junctions are TaqI-v2 and ClaI sites Dam blocks too.
    // Each has more sites than the scan keeps positions for, so a blocked count read from the kept
    // positions stops at 2,000.
    let seq = format!("{}{}{}", random_dna(6_000, 0.5, 0xB10C), "GATC".repeat(2_100), random_dna(5_600, 0.5, 0xB10D));
    let scan = default_scan(&seq, Topology::Linear);
    let cap = RESTRICTION_POSITIONS_PER_ENZYME;
    for name in ["MboI", "DpnII", "TaqI-v2", "ClaI"] {
        assert!(direct_blocked_linear(&seq, &enzyme(name)) > cap, "the fixture: Dam blocks more {name} sites than are kept");
    }
    for e in get_rebase_enzymes() {
        let c = scan.site_counts.iter().find(|c| c.enzyme == e.name).unwrap();
        assert_eq!(
            (c.sites, c.methylation_blocked),
            (direct_sites(&seq, &e, Topology::Linear, usize::MAX), direct_blocked_linear(&seq, &e)),
            "{} ({}): its sites and its blocked sites",
            e.name,
            e.recognition_seq
        );
    }
    let sau3ai = scan.site_counts.iter().find(|c| c.enzyme == "Sau3AI").unwrap();
    assert!(sau3ai.sites > cap && sau3ai.methylation_blocked == 0, "Dam does not block Sau3AI: {sau3ai:?}");
}

#[test]
fn cloning_messages_count_every_cut() {
    use molbiocraft_cloning::simulate_molecular_cloning;
    let nhei = enzyme("NheI");
    let xbai = enzyme("XbaI");
    let bsai = enzyme("BsaI-HFv2");
    assert!(nhei.methylation_sensitivity.iter().all(|m| m != "Dam" && m != "Dcm"), "Dam and Dcm block no NheI site");

    // A vector of random bases and 2,500 AGCT repeats, each junction an NheI site: NheI cuts it
    // about 2,500 times, more often than the scan keeps positions for.
    let agct = format!("{}{}", random_dna_without_ctag(10_000, 0xA6C7), "AGCT".repeat(2_500));
    let circular_cuts = direct_sites(&agct, &nhei, Topology::Circular, usize::MAX);
    assert!(circular_cuts > RESTRICTION_POSITIONS_PER_ENZYME, "the fixture: {circular_cuts} NheI sites");
    let vector = dna_doc("agct-vector", agct.clone(), Topology::Circular);
    let small_insert = dna_doc("insert", random_dna_without_ctag(1_200, 0x1A5), Topology::Linear);
    let out = simulate_molecular_cloning(&vector, &small_insert, "Restriction Ligation", "NheI", "XbaI", "");
    assert!(!out.success);
    assert_eq!(
        out.warnings[0],
        format!("NheI cuts the vector {circular_cuts} times; choose an enzyme with a unique site."),
        "the vector message counts every cut"
    );

    // The insert holds the AGCT repeats: it is read once a vector with one NheI and one XbaI site
    // opens, and its message counts every NheI site.
    let mut plain = random_dna_without_ctag(4_000, 0x7EC7);
    plain.replace_range(1_000..1_016, "AAAAAGCTAGCAAAAA");
    plain.replace_range(2_500..2_516, "AAAAATCTAGAAAAAA");
    assert_eq!(
        (direct_sites(&plain, &nhei, Topology::Circular, usize::MAX), direct_sites(&plain, &xbai, Topology::Circular, usize::MAX)),
        (1, 1),
        "the fixture's vector has one NheI and one XbaI site"
    );
    let one_each = dna_doc("one-each", plain, Topology::Circular);
    let insert = dna_doc("agct-insert", agct.clone(), Topology::Linear);
    let out = simulate_molecular_cloning(&one_each, &insert, "Restriction Ligation", "NheI", "XbaI", "");
    assert!(!out.success);
    let linear_cuts = direct_sites(&agct, &nhei, Topology::Linear, usize::MAX);
    let tail = "; add them with PCR primer tails.";
    let either = [
        format!("The insert needs one NheI and one XbaI site (found {linear_cuts} and 0){tail}"),
        format!("The insert needs one XbaI and one NheI site (found 0 and {linear_cuts}){tail}"),
    ];
    assert!(either.contains(&out.warnings[0]), "the insert message counts every cut: {}", out.warnings[0]);

    // Golden Gate: a vector of random bases and 2,100 GGTCTCA repeats has more BsaI-HFv2 sites than
    // the scan keeps positions for; its message counts every one Dcm does not block.
    let gg = format!("{}{}{}", random_dna(3_000, 0.5, 0x6060), "GGTCTCA".repeat(2_100), random_dna(3_000, 0.5, 0x6061));
    let bsai_cuts = direct_sites(&gg, &bsai, Topology::Linear, usize::MAX) - direct_blocked_linear(&gg, &bsai);
    assert!(bsai_cuts > RESTRICTION_POSITIONS_PER_ENZYME, "the fixture: {bsai_cuts} BsaI-HFv2 cuts");
    let gg_vector = dna_doc("gg-vector", gg, Topology::Linear);
    let out = simulate_molecular_cloning(&gg_vector, &small_insert, "Golden Gate", "", "", "BsaI-HFv2");
    assert!(!out.success);
    assert_eq!(
        out.warnings[0],
        format!("The vector has {bsai_cuts} BsaI-HFv2 sites; Golden Gate needs exactly two."),
        "the Golden Gate message counts every cut"
    );
}

#[test]
fn linearization_search_reads_every_site_near_the_insertion_point() {
    use molbiocraft_cloning::audit_twist_custom_vector_onboarding;
    // 12 kb, circular: 2,500 AGCT repeats from base 1,001, and the insertion point at bp 10,601,
    // 400 bp before their end. Every site within 50 bp of it comes after the 2,000th site of its
    // enzyme, so a search of the kept positions finds none of them.
    let seq = format!("{}{}{}", random_dna(1_000, 0.5, 0x7111), "AGCT".repeat(2_500), random_dna(1_000, 0.5, 0x7112));
    let len = seq.len();
    let site = 10_601usize;
    let near = |p: usize| p.abs_diff(site).min(len - p.abs_diff(site)) <= 50;
    let catalog = get_rebase_enzymes();
    let nearby: Vec<&RestrictionEnzyme> = catalog
        .iter()
        .filter(|e| direct_site_starts(&seq, e, Topology::Circular).iter().any(|&(i, _)| near(i + 1)))
        .collect();
    assert!(nearby.len() >= 3, "the fixture: AluI, NheI and BfaI cut near the insertion point: {}", nearby.len());
    for e in &nearby {
        let before = direct_site_starts(&seq, e, Topology::Circular).iter().filter(|&&(i, _)| i + 1 < site - 50).count();
        assert!(before >= RESTRICTION_POSITIONS_PER_ENZYME, "the fixture: {} has {before} sites before the window", e.name);
    }
    let doc = dna_doc("twist-agct", seq, Topology::Circular);
    let report = audit_twist_custom_vector_onboarding(&doc, site, 100.0, 100.0);
    let check = report.checks.iter().find(|c| c.id == "linearization").expect("the linearization check");
    assert_eq!(check.status, "pass", "{}", check.detail);
    let (count, listed) = check.detail.split_once(" linearization enzyme(s) within ±50 bp: ").expect("a list of enzymes");
    assert_eq!(count, nearby.len().to_string(), "every enzyme with a site within 50 bp: {}", check.detail);
    assert!(listed.split(", ").all(|n| nearby.iter().any(|e| e.name == n)), "{}", check.detail);
}

#[test]
fn a_stopped_scan_gives_no_all_clear_line() {
    use molbiocraft_cloning::cloning_crispr::audit_sequence_alerts_for_scan;
    // 20 kb, linear, no features or primers: random bases and 2,500 AGCT repeats, audited for a
    // dam- dcm- strain, so no check of the audit finds anything. The scan keeps 2,000 of AluI's
    // sites and has not checked the rest, so the audit may not say they were verified.
    let doc = dna_doc("agct-20kb", format!("{}{}", random_dna(10_000, 0.5, 0xC1EA), "AGCT".repeat(2_500)), Topology::Linear);
    let strain = "JM110 (dam- dcm-)";
    let ids = |alerts: Vec<molbiocraft_cloning::SequenceAlertItem>| alerts.into_iter().map(|a| a.id).collect::<Vec<_>>();
    let stopped = default_scan(&doc.sequence, Topology::Linear);
    assert!(stopped.stopped_early, "the fixture: the scan keeps only some sites");
    assert_eq!(ids(audit_sequence_alerts_for_scan(&doc, &stopped.sites, strain, true)), Vec::<String>::new(), "no all-clear line");
    // The same record with every site kept is verified, so the line is the audit's to give.
    let whole = scan_restriction_sites(&doc.sequence, Topology::Linear, None, RestrictionPositionLimit::All);
    assert!(!whole.stopped_early);
    assert_eq!(ids(audit_sequence_alerts_for_scan(&doc, &whole.sites, strain, false)), vec!["alert-clean".to_string()]);
}

/// The doc comment above `get_rebase_enzymes`, read from the source text, its lines joined and its
/// whitespace collapsed.
fn rebase_enzymes_doc() -> String {
    let source = include_str!("../src/rebase_catalog.rs");
    let fn_at = source.find("pub fn get_rebase_enzymes()").expect("get_rebase_enzymes is in the source");
    let doc: Vec<&str> = source[..fn_at]
        .lines()
        .rev()
        .skip_while(|l| l.trim().is_empty())
        .take_while(|l| l.trim_start().starts_with("///"))
        .collect();
    assert!(!doc.is_empty(), "get_rebase_enzymes carries a doc comment");
    let doc = doc.into_iter().rev().map(|l| l.trim_start().trim_start_matches("///")).collect::<Vec<_>>().join(" ");
    doc.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Every count `doc` gives, with its byte offset; a site length written as `6-bp` is not a count.
fn doc_counts(doc: &str) -> Vec<(usize, usize)> {
    let bytes = doc.as_bytes();
    let mut numbers = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric()) {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if !doc[i..].starts_with("-bp") {
                numbers.push((start, doc[start..i].parse::<usize>().unwrap()));
            }
        } else {
            i += 1;
        }
    }
    numbers
}

/// What is wrong with the counts `doc` gives for a catalogue of `total` enzymes, `core` of them the
/// core set; empty when every count is right. Each count is read by the phrase that names its role -
/// `catalog of N enzymes` the whole catalogue, `` `CORE_CATALOG_LEN` (N) `` the core set, `the other N`
/// the rest - each phrase is given once, and a count no phrase names is a finding, so a doc that swaps
/// two counts fails although each number is one of the catalogue's.
fn rebase_doc_count_findings(doc: &str, total: usize, core: usize) -> Vec<String> {
    let roles = [
        ("the whole catalogue", "catalog of ", " enzymes", total),
        ("the core set", "`CORE_CATALOG_LEN` (", ")", core),
        ("the rest", "the other ", "", total - core),
    ];
    let numbers = doc_counts(doc);
    let mut placed = Vec::new();
    let mut findings = Vec::new();
    for (role, before, after, want) in roles {
        let named: Vec<(usize, usize)> = numbers
            .iter()
            .copied()
            .filter(|&(at, n)| doc[..at].ends_with(before) && doc[at + n.to_string().len()..].starts_with(after))
            .collect();
        match named.as_slice() {
            [(at, n)] => {
                placed.push(*at);
                if *n != want {
                    findings.push(format!("the doc gives {role} as {before}{n}{after}, but it holds {want}"));
                }
            }
            [] => findings.push(format!("the doc does not give {role} as {before}{want}{after}")),
            _ => findings.push(format!("the doc gives {role} {} times: {named:?}", named.len())),
        }
    }
    for (at, n) in &numbers {
        if !placed.contains(at) {
            findings.push(format!("the doc gives {n} where no phrase names its role"));
        }
    }
    findings
}

/// US-01M6P2WJ AC3, BG-01M7V0Z9: every number the doc comment above `get_rebase_enzymes` gives is
/// the catalogue count its phrase names - the whole catalogue, its core set (`CORE_CATALOG_LEN`) or
/// the rest - read from the source text, so a count left behind when enzymes are added fails here.
/// A site length written as `6-bp` is not a count and is passed over.
#[test]
fn catalogue_doc_count_matches() {
    let doc = rebase_enzymes_doc();
    let total = get_rebase_enzymes().len();
    let findings = rebase_doc_count_findings(&doc, total, CORE_CATALOG_LEN);
    assert!(findings.is_empty(), "get_rebase_enzymes doc: {findings:?}: {doc}");
}

/// BG-01M7V0Z9: the count check reads each number by the role its phrase names, not against the
/// set of the catalogue's counts. A copy of the doc with the core and the other counts swapped, with
/// one count changed, or with no count of the whole catalogue fails it; the doc as written passes.
#[test]
fn bg_01m7v0z9_rebase_doc_counts_are_read_by_role() {
    let doc = rebase_enzymes_doc();
    let total = get_rebase_enzymes().len();
    let (core, rest) = (CORE_CATALOG_LEN, total - CORE_CATALOG_LEN);
    assert_ne!(core, rest, "the fixture: a swap of the two counts is visible");
    assert_eq!(rebase_doc_count_findings(&doc, total, core), Vec::<String>::new(), "the doc as written: {doc}");

    let core_phrase = format!("`CORE_CATALOG_LEN` ({core})");
    let rest_phrase = format!("the other {rest}");
    let total_phrase = format!("catalog of {total} enzymes");
    for phrase in [&core_phrase, &rest_phrase, &total_phrase] {
        assert_eq!(doc.matches(phrase.as_str()).count(), 1, "the doc names {phrase:?} once: {doc}");
    }
    let swapped = doc
        .replace(&core_phrase, "\u{0}CORE\u{0}")
        .replace(&rest_phrase, &format!("the other {core}"))
        .replace("\u{0}CORE\u{0}", &format!("`CORE_CATALOG_LEN` ({rest})"));
    let mutants = [
        ("the core and the other counts swapped", swapped),
        ("the core count off by one", doc.replace(&core_phrase, &format!("`CORE_CATALOG_LEN` ({})", core + 1))),
        ("the other count off by one", doc.replace(&rest_phrase, &format!("the other {}", rest + 1))),
        ("the other count given the catalogue's total", doc.replace(&rest_phrase, &format!("the other {total}"))),
        ("the total off by one", doc.replace(&total_phrase, &format!("catalog of {} enzymes", total + 1))),
        ("the total given the other count", doc.replace(&total_phrase, &format!("catalog of {rest} enzymes"))),
        ("a count no phrase names", doc.replace(&rest_phrase, &format!("{rest_phrase} (of {core} more)"))),
    ];
    for (what, mutant) in &mutants {
        assert_ne!(mutant, &doc, "{what}: the mutant differs from the doc");
        assert!(!rebase_doc_count_findings(mutant, total, core).is_empty(), "{what}: the count check passes {mutant}");
    }
}

/// BG-01M7V0Z9: a native (non-WebAssembly) build names its pairwise results "Rust engine (desktop)",
/// the label `cmd_rust_bio_invoke` would carry back from the `align_pairwise` and
/// `align_pairwise_gotoh` ops - global, local and the empty pair alike.
#[test]
fn bg_01m7v0z9_native_pairwise_label_names_the_desktop_build() {
    assert!(!cfg!(target_arch = "wasm32"), "this test runs a native build");
    assert_eq!(PAIRWISE_ENGINE_LABEL, "Rust engine (desktop)");
    for (what, local, s1, s2) in [("global", false, "ACGTACGTAC", "ACGTTCGTAC"), ("local", true, "TTACGTACGT", "ACGTACG"), ("empty", false, "", "")] {
        let r = align_pairwise_standard(s1, s2, local, 2, -1, -5, -1);
        assert_eq!(r.engine_used, "Rust engine (desktop)", "{what}: {r:?}");
    }
}
