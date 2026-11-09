// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1B3: the document table's record checks report what they found or that they did not
//! run, never an empty list read as clear; and a chromatogram's mean coverage is a measured value
//! or nothing.

use molbiocraft_cloning::audit_sequence_alerts;
use molbiocraft_cloning::compute_document_table_metrics_rust;
use molbiocraft_cloning::rebase_catalog::{
    find_restriction_cut_sites, get_rebase_enzymes, scan_restriction_sites, RestrictionPositionLimit,
};
use molbiocraft_cloning::workbench_table_and_lineage::RecordChecksState;
use molbiocraft_core::types::{
    ChromatogramData, DocumentAlignmentMeta, MoleculeType, SequenceDocument, SequenceFeature,
    Topology,
};

/// A reproducible pseudo-random DNA sequence (xorshift64*, fixed seed).
fn random_dna(len: usize, seed: u64) -> String {
    let mut s = seed;
    (0..len)
        .map(|_| {
            s ^= s >> 12;
            s ^= s << 25;
            s ^= s >> 27;
            b"ACGT"[(s.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 62) as usize] as char
        })
        .collect()
}

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

/// A reproducible pseudo-random sequence over `alphabet`.
fn random_from(len: usize, seed: u64, alphabet: &[u8]) -> String {
    let mut next = draws(seed);
    (0..len).map(|_| alphabet[((next() >> 33) % alphabet.len() as u64) as usize] as char).collect()
}

/// A reproducible pseudo-random DNA sequence whose bases are G or C with probability `gc`.
fn random_gc_dna(len: usize, gc: f64, seed: u64) -> String {
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

/// The count in the record's methylation alert ("N Restriction Site(s) Blocked by Dam/Dcm
/// Methylation ..."), or 0 when it has none.
fn blocked_sites_reported(alerts_summary: &str) -> usize {
    alerts_summary
        .split(" | ")
        .find_map(|a| a.strip_prefix("Methylation: "))
        .map(|t| t.split(' ').next().unwrap_or("").parse().expect("the alert opens with its count"))
        .unwrap_or(0)
}

/// A direct count of the record's methylation-blocked sites: each Dam- or Dcm-sensitive catalogue
/// enzyme scanned on its own, keeping every one of its sites (BG-01M6S1K2 keeps the default list to
/// a number of positions per enzyme, which one enzyme alone can reach).
fn blocked_sites_counted_enzyme_by_enzyme(seq: &str, topology: Topology) -> usize {
    get_rebase_enzymes()
        .into_iter()
        .filter(|e| e.methylation_sensitivity.iter().any(|m| m == "Dam" || m == "Dcm"))
        .map(|e| {
            scan_restriction_sites(seq, topology, Some(std::slice::from_ref(&e)), RestrictionPositionLimit::All)
                .sites
                .iter()
                .filter(|c| c.methylation_blocked)
                .count()
        })
        .sum()
}

/// The text the table states for a record over the scan's length limit.
const NOT_RUN_OVER_50_KB: &str = "Not run: the methylation and Type IIS site checks, which need a restriction-site scan that the document table runs only on sequences up to 50,000 bp";

fn dna_doc(id: &str, sequence: String, features: Vec<SequenceFeature>) -> SequenceDocument {
    SequenceDocument {
        id: id.into(),
        name: id.into(),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence,
        features,
        folder: "Cloning".into(),
        ..Default::default()
    }
}

fn cds(id: &str, start: usize, end: usize) -> SequenceFeature {
    SequenceFeature {
        id: id.into(),
        name: id.into(),
        feature_type: "CDS".into(),
        start,
        end,
        strand: 1,
        color: "#000000".into(),
        notes: None,
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    }
}

/// A 60 kb linear record (a BAC-sized insert) with a Dam-blocked BclI site (TGATCA) and an
/// out-of-frame CDS (1,001 bp), both inside its first 6,000 bp.
fn bac_with_problems(len: usize) -> SequenceDocument {
    let mut seq = random_dna(len, 0x5EED_B1B3);
    seq.replace_range(2_999..3_005, "TGATCA");
    dna_doc("bac-60k", seq, vec![cds("cds-out-of-frame", 1_001, 2_001)])
}

#[test]
fn long_dna_alerts_are_run_or_reported_skipped() {
    // The control: the same record cut to 6,000 bp runs every check, so the fixture does hold a
    // Dam-blocked site and an out-of-frame CDS that the checks find when they run.
    let short = compute_document_table_metrics_rust(&bac_with_problems(6_000));
    assert_eq!(short.checks_state, RecordChecksState::Complete, "a 6 kb record runs every check");
    assert!(short.checks_not_run.is_empty(), "nothing is named as not run: {}", short.checks_not_run);
    assert!(short.alerts_summary.contains("Methylation:"), "the control finds the Dam-blocked site: {}", short.alerts_summary);
    assert!(short.alerts_summary.contains("Reading Frame:"), "the control finds the out-of-frame CDS: {}", short.alerts_summary);

    // Over 50,000 bp: the reading-frame check reads only the annotations and runs at any length,
    // so the out-of-frame CDS is reported; the methylation check is reported or named as not run.
    let long_doc = bac_with_problems(60_000);
    assert!(long_doc.sequence.len() > 50_000);
    let long = compute_document_table_metrics_rust(&long_doc);
    assert!(long.alerts_summary.contains("Reading Frame: Non-Triplet Reading Frame Length in CDS \"cds-out-of-frame\" (1001 bp)"),
        "the reading-frame check runs on long DNA: {}", long.alerts_summary);
    let methylation_reported = long.alerts_summary.contains("Methylation:");
    let methylation_named_not_run = long.checks_state != RecordChecksState::Complete
        && long.checks_not_run.contains("methylation")
        && long.alerts_summary.contains(&long.checks_not_run);
    assert!(methylation_reported || methylation_named_not_run,
        "the methylation check is reported or named as not run, beside the alerts: {} / {}", long.alerts_summary, long.checks_not_run);
    assert!(long.alerts_count >= 1, "the alert it found is counted");

    // A long record with nothing for the annotation checks to find (its CDS is 1,002 bp, in frame):
    // a methylation check that ran finds the Dam-blocked site the control found; one that did not
    // run is named, with why. Either way an empty alert list is never read as every check run.
    let mut clean_long = long_doc.clone();
    clean_long.features = vec![cds("cds-in-frame", 1_001, 2_002)];
    let c = compute_document_table_metrics_rust(&clean_long);
    assert!(!c.alerts_summary.contains("Reading Frame:"), "the fixture's CDS is in frame: {}", c.alerts_summary);
    if c.checks_state == RecordChecksState::Complete {
        assert!(c.alerts_summary.contains("Methylation:"), "a scan that ran reports the blocked site: {}", c.alerts_summary);
    } else {
        assert!(c.checks_not_run.contains("methylation"), "the skipped check is named: {}", c.checks_not_run);
        assert!(c.checks_not_run.contains("50,000 bp"), "the reason is given in plain words: {}", c.checks_not_run);
        assert!(c.alerts_summary.contains(&c.checks_not_run), "and stated beside the status: {}", c.alerts_summary);
        // What the summary says did run must not name the checks that did not.
        let ran = c.alerts_summary.replace(&c.checks_not_run, "").to_lowercase();
        assert!(!ran.contains("methylation") && !ran.contains("type iis"), "no claim the skipped checks ran: {}", c.alerts_summary);
    }
    assert!(c.alerts_count > 0 || c.checks_state != RecordChecksState::Complete, "an empty list is not read as clear");
    let lower = c.alerts_summary.to_lowercase();
    assert!(!lower.contains("clear") && !lower.contains("verified"), "no all-clear text: {}", c.alerts_summary);

    // A clean short record ran every check and found nothing: that, and only that, is clear, and
    // the audit's own all-clear line is not counted as an alert.
    let clean_short = dna_doc("clean-short", "ACGT".repeat(300), vec![cds("cds-ok", 1, 300)]);
    let s = compute_document_table_metrics_rust(&clean_short);
    assert_eq!((s.alerts_count, s.checks_state), (0, RecordChecksState::Complete), "{}", s.alerts_summary);
    assert!(s.checks_not_run.is_empty());

    // A record with no bases ran no check, whatever annotations it carries.
    let no_bases = dna_doc("summary-record", String::new(), vec![cds("cds-out-of-frame", 1, 1_001)]);
    let n = compute_document_table_metrics_rust(&no_bases);
    assert_eq!(n.checks_state, RecordChecksState::NotRun);
    assert!(n.checks_not_run.contains("no bases"), "{}", n.checks_not_run);
    assert!(!n.alerts_summary.to_lowercase().contains("verified") && !n.alerts_summary.to_lowercase().contains("clear"), "{}", n.alerts_summary);

    // "No bases" means no base the restriction scan can read: it matches A, C, G and T (U read as
    // T) in either case, and an N or another ambiguity code matches no site's fixed base. A 5 kb run
    // of N, or a sequence of only whitespace, holds none, so no check ran on it; a lower-case record,
    // an all-U one and a gapped scaffold with a few bases do hold bases and are checked.
    for (what, sequence) in [("a 5 kb run of N", "N".repeat(5_000)), ("only whitespace", " \n\t ".repeat(40)), ("only ambiguity codes", "NRYKMSWBDHV".repeat(100))] {
        let d = compute_document_table_metrics_rust(&dna_doc("unreadable", sequence, vec![cds("cds-out-of-frame", 1, 1_001)]));
        assert_eq!((d.checks_state, d.alerts_count), (RecordChecksState::NotRun, 0), "{what}: no check ran: {}", d.alerts_summary);
        assert!(d.checks_not_run.contains("no bases"), "{what}: {}", d.checks_not_run);
        assert!(!d.alerts_summary.to_lowercase().contains("nothing found"), "{what}: no claim a check found nothing: {}", d.alerts_summary);
    }
    let lower = dna_doc("lower-case", random_dna(3_000, 0x10_3E).to_lowercase(), Vec::new());
    let all_u = SequenceDocument { molecule_type: MoleculeType::RNA, ..dna_doc("all-u", "U".repeat(600), Vec::new()) };
    let gapped = dna_doc("gapped", format!("{}{}{}", "N".repeat(2_000), "TGATCA", "N".repeat(2_000)), Vec::new());
    for d in [&lower, &all_u, &gapped] {
        let m = compute_document_table_metrics_rust(d);
        assert_eq!(m.checks_state, RecordChecksState::Complete, "{}: its bases are checked: {}", d.id, m.checks_not_run);
    }
    assert!(compute_document_table_metrics_rust(&lower).alerts_summary.contains("Methylation:"), "lower-case bases are scanned");
    assert_eq!(blocked_sites_reported(&compute_document_table_metrics_rust(&gapped).alerts_summary), 3, "the scaffold's one BclI site (and the MboI and DpnII GATC in it) is found");

    // The scan runs up to and including 50,000 bp, and not past it: a record of 49,999 or 50,000 bp
    // runs every check, one of 50,001 bp names the scan-based checks as not run, with the limit.
    for (len, state) in [(49_999, RecordChecksState::Complete), (50_000, RecordChecksState::Complete), (50_001, RecordChecksState::Partial)] {
        let edge = dna_doc("edge", random_dna(len, 0x50_000), vec![cds("cds-in-frame", 1_001, 2_002)]);
        let m = compute_document_table_metrics_rust(&edge);
        assert_eq!(m.checks_state, state, "{len} bp: {}", m.alerts_summary);
        if state == RecordChecksState::Complete {
            assert!(m.checks_not_run.is_empty(), "{len} bp: nothing named as not run: {}", m.checks_not_run);
            assert_eq!(blocked_sites_reported(&m.alerts_summary), blocked_sites_counted_enzyme_by_enzyme(&edge.sequence, Topology::Linear),
                "{len} bp: the methylation check read the whole record");
        } else {
            assert_eq!(m.checks_not_run, NOT_RUN_OVER_50_KB, "{len} bp: the limit is stated");
            assert!(!m.alerts_summary.contains("Methylation:"), "{len} bp: no scan ran: {}", m.alerts_summary);
        }
    }

    // A protein runs none of these DNA checks.
    let mut protein = dna_doc("protein", "MVSKGEELFTGVVPILVELDGDVNGHKFSV".into(), Vec::new());
    protein.molecule_type = MoleculeType::Protein;
    let p = compute_document_table_metrics_rust(&protein);
    assert_eq!((p.alerts_count, p.checks_state), (0, RecordChecksState::NotRun));
    assert!(p.checks_not_run.contains("protein"), "{}", p.checks_not_run);
}

/// A 5 kb tail of A and T holding one Dam-blocked BclI site (TGATCA) at base 2,500.
fn at_tail_with_bcli() -> String {
    let mut tail = random_from(5_000, 0xA7A7, b"AT");
    tail.replace_range(2_499..2_505, "TGATCA");
    tail
}

#[test]
fn a_record_the_full_catalogue_scan_stops_short_on_is_checked_whole() {
    // The product review's two records. The restriction scan once stopped when it held 12,000 sites
    // (BG-01M6S1K2 made its counts complete), and the full catalogue reaches that inside each of
    // them; a check that read such a scan called them complete. The record checks read only the
    // enzymes they check, and those sites are far fewer, so they read each record whole.
    //
    // 13 kb: 8 kb of (GCGC)n, then the AT tail and its BclI site.
    let thirteen = dna_doc("gcgc-8k-at-5k", "GCGC".repeat(2_000) + &at_tail_with_bcli(), Vec::new());
    let full = scan_restriction_sites(&thirteen.sequence, Topology::Linear, None, RestrictionPositionLimit::Total(12_000));
    assert!(full.stopped_early && full.sites.iter().all(|c| c.position <= 8_100), "the fixture stops a full-catalogue scan kept to 12,000 sites inside the repeat, before the tail");
    let m = compute_document_table_metrics_rust(&thirteen);
    assert_eq!(m.checks_state, RecordChecksState::Complete, "{}", m.alerts_summary);
    assert_eq!(blocked_sites_reported(&m.alerts_summary), 3, "the tail's BclI site and the MboI and DpnII GATC inside it are found: {}", m.alerts_summary);
    assert_eq!(m.alerts_count, 1);

    // 48 kb at 72 % GC: a full-catalogue scan kept to 12,000 sites stops before the end, so it
    // lists fewer blocked sites for the whole record than the record holds.
    let gc = random_gc_dna(48_000, 0.72, 0x72_6C_48);
    let blocked_full = |s: &str| scan_restriction_sites(s, Topology::Linear, None, RestrictionPositionLimit::Total(12_000)).sites.iter().filter(|c| c.methylation_blocked).count();
    assert!(blocked_full(&gc) < blocked_sites_counted_enzyme_by_enzyme(&gc, Topology::Linear), "the fixture reaches the cap: {} < {}", blocked_full(&gc), blocked_sites_counted_enzyme_by_enzyme(&gc, Topology::Linear));
    let whole = compute_document_table_metrics_rust(&dna_doc("gc72-48k", gc.clone(), Vec::new()));
    let prefix = compute_document_table_metrics_rust(&dna_doc("gc72-31k", gc[..31_000].to_string(), Vec::new()));
    assert_eq!((whole.checks_state, prefix.checks_state), (RecordChecksState::Complete, RecordChecksState::Complete));
    let (w, p) = (blocked_sites_reported(&whole.alerts_summary), blocked_sites_reported(&prefix.alerts_summary));
    assert_eq!(w, blocked_sites_counted_enzyme_by_enzyme(&gc, Topology::Linear), "every blocked site of the 48 kb record is counted");
    assert_eq!(p, blocked_sites_counted_enzyme_by_enzyme(&gc[..31_000], Topology::Linear));
    assert!(w > p, "the whole record holds more blocked sites than its first 31 kb: {w} vs {p}");
}

#[test]
fn a_scan_stopped_at_its_cap_is_partial_never_clear() {
    // 25 kb of (GTCTC)n then the AT tail: each repeat holds a BsmAI and a BsmBI/Esp3I Type IIS site,
    // so the Type IIS sites alone, which any scan for the Type IIS check must list, fill the scan's
    // 12,000-site cap at base 20,000 and the tail's blocked BclI site is never reached.
    let tail = at_tail_with_bcli();
    let doc = dna_doc("gtctc-25k-at-5k", "GTCTC".repeat(5_000) + &tail, Vec::new());
    assert_eq!(doc.sequence.len(), 30_000, "under the 50,000 bp limit, so the scan runs");
    let type_iis: Vec<_> = get_rebase_enzymes().into_iter().filter(|e| e.is_type_iis).collect();
    let listed = find_restriction_cut_sites(&doc.sequence, Topology::Linear, Some(&type_iis));
    assert!(listed.iter().all(|c| c.position <= 25_000), "the fixture stops the scan inside the repeat");

    let m = compute_document_table_metrics_rust(&doc);
    assert_eq!((m.checks_state, m.alerts_count), (RecordChecksState::Partial, 0), "a scan that stopped is not a complete check: {}", m.alerts_summary);
    assert_eq!(m.checks_not_run,
        "Not finished: the methylation and Type IIS site checks read a restriction-site scan that stopped at its 12,000-site cap before the end of the record, so they may have missed sites");
    assert!(m.alerts_summary.contains(&m.checks_not_run), "the reason is stated beside the status: {}", m.alerts_summary);
    let ran = m.alerts_summary.replace(&m.checks_not_run, "").to_lowercase();
    assert!(!ran.contains("methylation") && !ran.contains("type iis"), "no claim the unfinished checks found nothing: {}", m.alerts_summary);

    // The control: the tail alone is checked whole and its blocked site is found.
    let t = compute_document_table_metrics_rust(&dna_doc("at-tail", tail, Vec::new()));
    assert_eq!(t.checks_state, RecordChecksState::Complete);
    assert_eq!(blocked_sites_reported(&t.alerts_summary), 3, "{}", t.alerts_summary);

    // A stop with alerts found before it: 12 kb of (GATC)n, every repeat a Dam-blocked MboI and DpnII
    // site. The blocked sites it did list are reported, and the check is still not complete.
    let gatc = compute_document_table_metrics_rust(&dna_doc("gatc-12k", "GATC".repeat(3_000), Vec::new()));
    assert_eq!(gatc.checks_state, RecordChecksState::Partial, "{}", gatc.alerts_summary);
    assert!(gatc.alerts_summary.contains("Methylation:") && gatc.alerts_count == 1, "{}", gatc.alerts_summary);
    assert!(gatc.checks_not_run.contains("12,000-site cap"), "{}", gatc.checks_not_run);

    // A stop in the degenerate-site pass: 50,000 bp of (GGCC)n holds an EaeI site (YGGCCR) in
    // every repeat, more than 12,000 in all, and nothing else the checks read.
    let ggcc = compute_document_table_metrics_rust(&dna_doc("ggcc-50k", "GGCC".repeat(12_500), Vec::new()));
    assert_eq!(ggcc.checks_state, RecordChecksState::Partial, "{}", ggcc.alerts_summary);
    assert!(ggcc.checks_not_run.contains("12,000-site cap"), "{}", ggcc.checks_not_run);
}

/// The alerts the full-catalogue audit gives a record, written the way the table's summary writes
/// them, without the audit's own all-clear line.
fn full_catalogue_alerts(doc: &SequenceDocument) -> (usize, String) {
    let cuts = find_restriction_cut_sites(&doc.sequence, doc.topology, None);
    let alerts: Vec<_> = audit_sequence_alerts(doc, &cuts, "DH5α (dam+ dcm+)").into_iter().filter(|a| a.id != "alert-clean").collect();
    (alerts.len(), alerts.iter().map(|a| format!("{}: {}", a.category, a.title)).collect::<Vec<_>>().join(" | "))
}

#[test]
fn record_checks_find_what_the_full_catalogue_finds() {
    // On a record the full-catalogue scan lists whole, the record checks report exactly what an
    // audit of that scan reports. The record holds a site of each kind the checks read: a BclI site
    // that only Dam blocks, a StuI site that only Dcm blocks (AGGCCTGG), CCWGG sites of the
    // degenerate ScrFI (CCNGG), and a BbsI Type IIS site, which neither Dam nor Dcm blocks, as the
    // only Type IIS site inside an A/T CDS.
    let mut cds_region = random_from(1_200, 0xC0_D5, b"AT");
    cds_region.replace_range(599..605, "GAAGAC");
    let mut seq = random_dna(6_000, 0x5EED_0E0E);
    seq.replace_range(999..1_005, "TGATCA");
    seq.replace_range(1_999..2_007, "AGGCCTGG");
    seq.replace_range(3_000..4_200, &cds_region);
    let doc = dna_doc("checks-6k", seq, vec![cds("cds-a-t", 3_001, 4_200)]);
    let cuts = find_restriction_cut_sites(&doc.sequence, Topology::Linear, None);
    let blocked = |name: &str| cuts.iter().any(|c| c.enzyme.name == name && c.methylation_blocked);
    assert!(blocked("BclI") && blocked("StuI") && blocked("ScrFI"), "the fixture holds a Dam-only, a Dcm-only and a degenerate blocked site");
    for topology in [Topology::Linear, Topology::Circular] {
        let d = SequenceDocument { topology, ..doc.clone() };
        let m = compute_document_table_metrics_rust(&d);
        let (count, summary) = full_catalogue_alerts(&d);
        assert!(summary.contains("Type IIS Cloning: Internal Type IIS Site (BbsI-HF) Inside CDS \"cds-a-t\""), "{topology:?}: the fixture's Type IIS site is in its CDS: {summary}");
        assert_eq!(m.checks_state, RecordChecksState::Complete, "{topology:?}");
        assert_eq!((m.alerts_count, m.alerts_summary.as_str()), (count, summary.as_str()), "{topology:?}");
    }
}

fn chromatogram(phred: Vec<u8>, traces: bool) -> ChromatogramData {
    let n = phred.len();
    let trace = |v: f64| if traces { vec![v; n * 4] } else { Vec::new() };
    ChromatogramData {
        trace_a: trace(10.0),
        trace_c: trace(20.0),
        trace_g: trace(30.0),
        trace_t: trace(40.0),
        peak_locations: (0..n).map(|i| i * 4 + 2).collect(),
        phred_scores: phred,
        base_calls: "ACGT".repeat(n / 4),
    }
}

#[test]
fn chromatogram_coverage_is_absent_unless_computed() {
    // A Sanger trace and an NGS read, each with Phred scores and no alignment metadata: nothing
    // measured a coverage, so none is reported.
    for traces in [true, false] {
        let mut read = dna_doc("read", "ACGT".repeat(25), Vec::new());
        read.chromatogram = Some(chromatogram(vec![40; 100], traces));
        let m = compute_document_table_metrics_rust(&read);
        assert_eq!(m.mean_coverage_x, None, "traces={traces}: no coverage was computed");
        assert_eq!(m.mean_coverage_label, "—", "traces={traces}");
    }

    // A coverage that an assembly or mapping measured is reported as measured.
    let mut contig = dna_doc("contig", "ACGT".repeat(25), Vec::new());
    contig.chromatogram = Some(chromatogram(vec![40; 100], true));
    contig.alignment_meta = Some(DocumentAlignmentMeta { mean_coverage_x: Some(37.5), ..Default::default() });
    let m = compute_document_table_metrics_rust(&contig);
    assert_eq!(m.mean_coverage_x, Some(37.5));
    assert_eq!(m.mean_coverage_label, "37.5×");
}
