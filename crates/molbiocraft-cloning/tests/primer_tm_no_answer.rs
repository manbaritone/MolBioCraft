// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6SHQ0: a span or oligo holding N, or any base other than A, C, G or T in either case
//! (U reads as T), has no Tm. primer3-py 2.4.0 `calc_tm` raises ValueError ("Sequence contains
//! non-ACGT base") for every ambiguity fixture below; Biopython 1.88 `Tm_GC(strict=True)` refuses
//! each but the W, which it reads as A or T.
//! The engine keeps `tm_c` a finite number, so no reader of it breaks, and adds the reason beside
//! it; every reader of that Tm shows the reason, never the number.

use molbiocraft_cloning::{
    analyze_gibson_overlap_junction, anneal_complementary_oligos, calculate_primer_metrics,
    convert_selection_to_oligo_primer, design_pcr_primers, simulate_molecular_cloning,
    simulate_site_directed_mutagenesis, test_saved_primers_on_sequence, SelectionRange1Based,
};
use molbiocraft_core::{PrimerRecord, SequenceDocument, Topology};

/// The shared reason, written out here from the product seat's wording (not from the engine), so a
/// change to the engine's sentence, its count or its plural fails these tests.
fn reason(k: &str, plural: bool) -> String {
    format!(
        "Tm n/a: the span holds {k} N or other ambiguity base{}; Tm is computed on A/C/G/T only, as Primer3 does",
        if plural { "s" } else { "" }
    )
}

/// A fixed-seed A/C/G/T run, so the tests carry no fixture files.
fn acgt(len: usize, seed: u32) -> String {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            b"ACGT"[(x >> 30) as usize] as char
        })
        .collect()
}

fn doc(name: &str, sequence: &str, topology: Topology) -> SequenceDocument {
    SequenceDocument {
        id: format!("doc-{name}"),
        name: name.to_string(),
        sequence: sequence.to_string(),
        topology,
        ..Default::default()
    }
}

#[test]
fn primer_metrics_give_no_tm_for_a_span_holding_an_ambiguity_code() {
    // The fixtures sit on both sides of the 14-base rule (the Wallace path below 14, the %GC path
    // from 14 up) and on the nearest-neighbour path. Wrong implementations, each caught here: a rule
    // keyed to N alone (the R, Y and W fixtures); one on upper case only (the lower-case n); the old
    // "14 bases or more with fewer than 14 A/C/G/T" rule (every fixture with 14 or more A/C/G/T, and
    // 12 N + A below 14 bases); k counted as the N alone, as distinct codes, or capped (the 4,000).
    let fixtures: Vec<(String, String)> = vec![
        (format!("{}A", "N".repeat(12)), reason("12", true)),
        ("ACGTRACGTACGT".into(), reason("1", false)),
        (format!("{}A", "N".repeat(13)), reason("13", true)),
        ("ACGTACGTYACGTACGTA".into(), reason("1", false)),
        ("ACGTACGTACGWACGTACGTAC".into(), reason("1", false)),
        ("acgtacgtnacgtacgtac".into(), reason("1", false)),
        (format!("{}ACGTACGTACGTAC", "N".repeat(26)), reason("26", true)),
        (format!("{}ACGTACGTACGTAC", "N".repeat(86)), reason("86", true)),
        // The criterion's 4,000 N + 1,000 A/C/G/T, shrunk to 1,000 N + 1,000 A/C/G/T: one call on
        // the full fixture takes 76 s in a debug build (the hairpin scan pairs N with N, so it is
        // cubic over an N run), past the 60 s a test may take. This one still needs the thousands
        // separator in k; the App's four readouts read the full fixture (accessibilityFloor.test.tsx).
        (format!("{}{}", "N".repeat(1_000), "ACGT".repeat(250)), reason("1,000", true)),
        // Two different codes in one oligo count together.
        ("ACGTRYACGTACGTACGT".into(), reason("2", true)),
    ];
    assert_eq!(
        reason("1", false),
        "Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does"
    );
    assert_eq!(
        reason("26", true),
        "Tm n/a: the span holds 26 N or other ambiguity bases; Tm is computed on A/C/G/T only, as Primer3 does"
    );
    for (seq, want) in &fixtures {
        for (na, mg, nm) in [(50.0, 1.5, 250.0), (50.0, 10.0, 50.0)] {
            let m = calculate_primer_metrics(seq, na, mg, nm);
            assert!(m.tm_c.is_finite(), "{} bases at {na}/{mg}/{nm}: tm_c stays a finite number, {}", seq.len(), m.tm_c);
            assert_eq!(m.tm_no_answer_reason.as_deref(), Some(want.as_str()), "{} bases at {na}/{mg}/{nm}", seq.len());
        }
    }
    // The reply the REST server and Tauri IPC send carries it under its camelCase key.
    let n26 = format!("{}ACGTACGTACGTAC", "N".repeat(26));
    let wire = serde_json::to_value(calculate_primer_metrics(&n26, 50.0, 1.5, 250.0)).unwrap();
    assert_eq!(wire["tmNoAnswerReason"], serde_json::json!(reason("26", true)));
    assert!(wire["tmC"].as_f64().is_some_and(f64::is_finite), "tmC stays a number on the wire: {}", wire["tmC"]);
    // An oligo too short for a Tm (tm_c 0.0) that holds N says why as well.
    assert_eq!(calculate_primer_metrics("ANNC", 50.0, 1.5, 250.0).tm_no_answer_reason, Some(reason("2", true)));
    // The criterion's 4,000 N fixture's sentence, from the one function that writes it.
    assert_eq!(molbiocraft_cloning::thermodynamics::tm_no_answer_reason(4_000), reason("4,000", true));

    // Controls keep their Tm and have no reason: A/C/G/T, lower case, and U read as T. The values are
    // primer3-py 2.4.0 calc_tm(seq, mv_conc, dv_conc, dntp_conc=0, dna_conc, tm_method="santalucia",
    // salt_corrections_method="santalucia") on the T form of each sequence (calc_tm refuses U), run
    // 2026-11-07 in a throwaway venv: ACGTACGTACGTA 44.9667 (50/1.5/250) and 45.2162 (50/10/50);
    // ACGTACGTACGTAC, its lower case and ACGUACGUACGUAC 48.1533 and 48.6536. The engine rounds to
    // 0.1 °C and gives each, as it did before this change: 45.0, 45.2, 48.2, 48.7.
    let controls = [
        ("ACGTACGTACGTA", 44.9667, 45.2162),
        ("ACGTACGTACGTAC", 48.1533, 48.6536),
        ("acgtacgtacgtac", 48.1533, 48.6536),
        ("ACGUACGUACGUAC", 48.1533, 48.6536),
    ];
    for (seq, p3_default, p3_gibson) in controls {
        for ((na, mg, nm), p3) in [((50.0, 1.5, 250.0), p3_default), ((50.0, 10.0, 50.0), p3_gibson)] {
            let m = calculate_primer_metrics(seq, na, mg, nm);
            assert_eq!(m.tm_no_answer_reason, None, "{seq} at {na}/{mg}/{nm} has a Tm");
            assert_eq!(m.tm_c, (p3 * 10.0_f64).round() / 10.0, "{seq} at {na}/{mg}/{nm}: primer3 {p3}");
            assert!((m.tm_c - p3).abs() <= 0.05, "{seq} at {na}/{mg}/{nm}: {} vs primer3 {p3}", m.tm_c);
        }
        let wire = serde_json::to_value(calculate_primer_metrics(seq, 50.0, 1.5, 250.0)).unwrap();
        assert!(wire.get("tmNoAnswerReason").is_none(), "{seq}: no reason key on the wire");
    }
}

#[test]
fn cloning_tm_readers_say_n_a_for_an_ambiguity_code() {
    let one = reason("1", false);

    // ── The Gibson junction analyzer ──
    // Wrong implementation: judging the arm from its computed Tm anyway. Without the rule the first
    // reads "Junction meets optimal ..." (68.5 °C) and the second "AT-rich junction (Tm < 48°C) ..."
    // (42.2 °C), both with one N.
    for overlap in ["GTCCAGGAGCNCACCATCTTCTTCA", "ATATATATATATNTATATATATATA"] {
        let g = analyze_gibson_overlap_junction(overlap);
        assert!(g.tm_c.is_finite(), "{overlap}: tm_c stays a number");
        assert_eq!(g.tm_no_answer_reason.as_deref(), Some(one.as_str()), "{overlap}: the junction carries the reason");
        assert!(!g.isothermal_50c_optimal, "{overlap}: not judged optimal from a Tm it has not got");
        assert!(g.recommendation.starts_with(&one), "{overlap}: the recommendation gives the reason: {}", g.recommendation);
        for judged in ["AT-rich", "optimal"] {
            assert!(!g.recommendation.contains(judged), "{overlap}: not judged {judged}: {}", g.recommendation);
        }
    }
    let clean = analyze_gibson_overlap_junction("GTCCAGGAGCGCACCATCTTCTTCA");
    assert_eq!(clean.tm_no_answer_reason, None);
    assert!(clean.isothermal_50c_optimal, "an A/C/G/T arm is still judged");
    assert!(clean.recommendation.contains("optimal"));

    // ── The cloning simulator ──
    // Gibson on a linear vector: the left arm is the vector's last 25 bases, here holding one N.
    let insert = doc("insert", &acgt(300, 7), Topology::Linear);
    let tail = "GTCCAGGAGCNCACCATCTTCTTCA";
    let vector = doc("vector", &format!("{}{tail}", acgt(400, 11)), Topology::Linear);
    let gibson = simulate_molecular_cloning(&vector, &insert, "Gibson Assembly", "", "", "");
    assert!(gibson.success, "{:?}", gibson.warnings);
    assert_eq!(gibson.overhang_or_homology_left, format!("25 bp: 5'-{tail}-3' ({one})"));
    let clean_vector = doc("vector", &format!("{}GTCCAGGAGCGCACCATCTTCTTCA", acgt(400, 11)), Topology::Linear);
    let clean_gibson = simulate_molecular_cloning(&clean_vector, &insert, "Gibson Assembly", "", "", "");
    assert!(
        clean_gibson.overhang_or_homology_left.starts_with("25 bp: 5'-GTCCAGGAGCGCACCATCTTCTTCA-3' (Tm ")
            && clean_gibson.overhang_or_homology_left.ends_with(" °C)"),
        "an A/C/G/T arm keeps its Tm: {}",
        clean_gibson.overhang_or_homology_left
    );

    // Overlap extension: the 24-nt junction is fragment A's last 12 and fragment B's first 12.
    let frag_b = doc("fragB", &format!("ACGTNACGTACG{}", acgt(200, 5)), Topology::Linear);
    let frag_a = doc("fragA", &acgt(200, 3), Topology::Linear);
    let soe = simulate_molecular_cloning(&frag_a, &frag_b, "Overlap Extension PCR", "", "", "");
    assert!(soe.success, "{:?}", soe.warnings);
    let junction = format!("{}ACGTNACGTACG", &frag_a.sequence[188..]);
    assert!(
        soe.warnings.contains(&format!("Chimeric primers share the 24-nt junction {junction} ({one}).")),
        "{:?}",
        soe.warnings
    );
    let clean_soe = simulate_molecular_cloning(&frag_a, &insert, "Overlap Extension PCR", "", "", "");
    assert!(
        clean_soe.warnings.iter().any(|w| w.starts_with("Chimeric primers share") && w.ends_with("at 50 mM Na⁺, 1.5 mM Mg²⁺).")),
        "an A/C/G/T junction keeps its Tm: {:?}",
        clean_soe.warnings
    );

    // ── Primer records ──
    // Convert a selection holding one N to an oligo primer, on either strand.
    let template = format!("{}N{}", acgt(30, 13), acgt(60, 17));
    let tdoc = doc("template", &template, Topology::Linear);
    for strand in [1i8, -1] {
        let conv = convert_selection_to_oligo_primer(&tdoc, Some(SelectionRange1Based { start: 21, end: 42 }), strand);
        assert_eq!(conv.primer.tm_no_answer_reason.as_deref(), Some(one.as_str()), "strand {strand}");
        assert!(conv.primer.tm_anneal_c.is_finite() && conv.primer.tm_full_c.is_finite(), "strand {strand}: numeric Tm fields");
        assert_eq!(conv.updated_doc.primers.last().and_then(|p| p.tm_no_answer_reason.clone()), Some(one.clone()));
    }
    let clean_conv = convert_selection_to_oligo_primer(&tdoc, Some(SelectionRange1Based { start: 40, end: 61 }), 1);
    assert_eq!(clean_conv.primer.tm_no_answer_reason, None, "an A/C/G/T oligo: {}", clean_conv.primer.sequence);

    // Design PCR primers where the region starts on an N: every forward candidate holds it.
    let pcr_doc = doc("pcr", &format!("N{}", acgt(399, 19)), Topology::Linear);
    let pcr = design_pcr_primers(&pcr_doc, 1, 400, 60.0, "", "");
    assert_eq!(pcr.forward.tm_no_answer_reason.as_deref(), Some(one.as_str()), "{}", pcr.forward.anneal_sequence);
    assert!(pcr.forward.tm_anneal_c.is_finite() && pcr.forward.tm_full_c.is_finite());
    assert_eq!(pcr.reverse.tm_no_answer_reason, None, "the reverse primer is A/C/G/T: {}", pcr.reverse.anneal_sequence);
    assert!(pcr.warnings.contains(&format!("Forward primer: {one}.")), "{:?}", pcr.warnings);
    assert!(
        !pcr.warnings.iter().any(|w| w.starts_with("Forward primer Tm is")),
        "no Tm is set beside the target for it: {:?}",
        pcr.warnings
    );
    // And where the region ends on an N: every reverse candidate holds it, as its 5′ base, and the
    // forward primer is A/C/G/T. Wrong implementations, each caught by one of the two templates: the
    // reverse record given no reason (`None`) or the forward primer's; and the forward record given
    // the reverse primer's.
    let rev_doc = doc("pcr-rev", &format!("{}N", acgt(399, 19)), Topology::Linear);
    let rev = design_pcr_primers(&rev_doc, 1, 400, 60.0, "", "");
    assert!(rev.reverse.anneal_sequence.starts_with('N'), "the reverse primer holds the N: {}", rev.reverse.anneal_sequence);
    assert_eq!(rev.reverse.tm_no_answer_reason.as_deref(), Some(one.as_str()), "{}", rev.reverse.anneal_sequence);
    assert!(rev.reverse.tm_anneal_c.is_finite() && rev.reverse.tm_full_c.is_finite());
    assert_eq!(rev.forward.tm_no_answer_reason, None, "the forward primer is A/C/G/T: {}", rev.forward.anneal_sequence);
    assert!(rev.warnings.contains(&format!("Reverse primer: {one}.")), "{:?}", rev.warnings);
    assert!(
        !rev.warnings.iter().any(|w| w.starts_with("Reverse primer Tm is")),
        "no Tm is set beside the target for it: {:?}",
        rev.warnings
    );
    assert_eq!(serde_json::to_value(&rev.reverse).unwrap()["tmNoAnswerReason"], serde_json::json!(one));
    // The field is serde default: a record saved without it reads as no reason, and an A/C/G/T
    // record writes no key.
    let mut saved = serde_json::to_value(&pcr.reverse).unwrap();
    assert!(saved.get("tmNoAnswerReason").is_none());
    assert_eq!(serde_json::to_value(&pcr.forward).unwrap()["tmNoAnswerReason"], serde_json::json!(one));
    saved.as_object_mut().unwrap().remove("tmNoAnswerReason");
    assert_eq!(serde_json::from_value::<PrimerRecord>(saved).unwrap().tm_no_answer_reason, None);

    // ── The other engine readers of the Tm ──
    // Site-directed mutagenesis with an N introduced: the history and the warnings say n/a.
    let sdm_doc = doc("sdm", &acgt(120, 23), Topology::Linear);
    let sdm = simulate_site_directed_mutagenesis(&sdm_doc, "Substitution", 60, "N", 0);
    assert!(sdm.primer_tm_c.is_finite());
    assert!(sdm.warnings.contains(&format!("Mutagenic primer: {one}.")), "{:?}", sdm.warnings);
    let sdm_history = &sdm.mutant_document.history.last().unwrap().description;
    assert!(sdm_history.ends_with(&format!("({one})")), "{sdm_history}");
    let clean_sdm = simulate_site_directed_mutagenesis(&sdm_doc, "Substitution", 60, "G", 0);
    assert!(clean_sdm.mutant_document.history.last().unwrap().description.contains("(Tm = "));
    // Annealed oligos whose paired region holds N.
    let top = "AATTCGACGTNCGATCGTAG";
    let bottom: String = top
        .bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'T' => 'A',
            b'C' => 'G',
            b'G' => 'C',
            _ => 'N',
        })
        .collect();
    let annealed = anneal_complementary_oligos("duplex", top, &bottom, false);
    assert_eq!(annealed.paired_length_bp, top.len());
    assert!(annealed.warnings.contains(&format!("Duplex: {one}.")), "{:?}", annealed.warnings);
    assert!(annealed.annealed_document.history[0].description.ends_with(&format!("({one})")));
    // A saved primer holding N, tested on a target holding the same oligo: the hit carries the reason.
    let probe = format!("{}N{}", acgt(10, 29), acgt(9, 31));
    let target = format!("{}{probe}{}", acgt(40, 37), acgt(40, 41));
    let saved_primer = PrimerRecord { sequence: probe.clone(), anneal_sequence: probe.clone(), ..Default::default() };
    let hits = test_saved_primers_on_sequence(&target, &[saved_primer], 0);
    assert!(!hits.is_empty(), "the oligo binds where it was copied from");
    for h in &hits {
        assert_eq!(h.primer.tm_no_answer_reason.as_deref(), Some(one.as_str()));
        assert!(h.effective_tm_c.is_finite());
    }
}
