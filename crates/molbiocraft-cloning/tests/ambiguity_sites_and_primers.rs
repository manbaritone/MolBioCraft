// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VF1T: a restriction site or a saved primer that may lie under N, R, Y or another IUPAC
//! code is read by D0181's set rule (motif_search.rs): a sequence letter matches a site letter
//! definitely when its set is a subset of the site letter's set, and possibly when the two sets
//! only meet. A restriction site that only possibly matches is a possible site, counted apart from
//! the cuts and never a noncutter; a degenerate primer binds wherever every template letter under
//! it lies inside the primer letter's set.
//!
//! The calls are the ones `dispatch_bio_rpc` makes for `scan_restriction_sites` (each enzyme's
//! first RESTRICTION_POSITIONS_PER_ENZYME positions kept), `find_non_cutting_enzymes` (with
//! `topology: "linear"`) and `test_saved_primers`, and each reply is read as the JSON the
//! dispatcher sends, so the `possibleSites` key is the one the UI reads. Every expected number is
//! written out by hand.
//!
//! Wrong implementations this catches: a sequence N that still matches only a site N, so EcoRI on
//! GAANTC is a noncutter (today's scan); a possible site counted as a cut or positioned in `sites`;
//! the rule turned round (site set inside the sequence set), which makes site N over sequence R
//! possible and site R over sequence N definite; a possible site found by the spelled-out pass but
//! not by the base-by-base pass of a highly degenerate site; a primer still compared byte by byte;
//! inosine read as {A, C, T} (its partners) rather than {G, T, A} (their complements) on the
//! primer's own strand; and a primer letter whose set only meets the template letter's (Y over A)
//! counted as a match.

use molbiocraft_cloning::rebase_catalog::{
    find_non_cutting_enzymes_for_topology, scan_restriction_sites, RestrictionPositionLimit,
    RESTRICTION_POSITIONS_PER_ENZYME,
};
use molbiocraft_cloning::thermodynamics::test_saved_primers_on_sequence;
use molbiocraft_core::types::{EnzymeSource, PrimerRecord, RestrictionEnzyme, Topology};
use serde_json::Value;

fn custom(name: &str, rec: &str) -> RestrictionEnzyme {
    RestrictionEnzyme {
        id: name.to_string(),
        source: EnzymeSource::Custom,
        name: name.to_string(),
        recognition_seq: rec.to_string(),
        cut_fwd: 1,
        cut_rev: 5,
        is_type_iis: false,
        suppliers: Vec::new(),
        methylation_sensitivity: Vec::new(),
        buffer_standard: String::new(),
        temp_c: 37,
        provenance: String::new(),
        notes: String::new(),
    }
}

fn t(n: usize) -> String {
    "T".repeat(n)
}

/// The `scan_restriction_sites` reply for a linear molecule, as the dispatcher serialises it.
fn scan(seq: &str, enzymes: &[RestrictionEnzyme]) -> Value {
    serde_json::to_value(scan_restriction_sites(
        seq,
        Topology::Linear,
        Some(enzymes),
        RestrictionPositionLimit::PerEnzyme(RESTRICTION_POSITIONS_PER_ENZYME),
    ))
    .unwrap()
}

/// (sites, possibleSites) of `name` in a scan reply; `possibleSites` must be a number.
fn counts(reply: &Value, name: &str) -> (u64, u64) {
    let row = reply["siteCounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["enzyme"] == name)
        .unwrap_or_else(|| panic!("{name} has a site count"));
    (
        row["sites"].as_u64().unwrap(),
        row["possibleSites"].as_u64().unwrap_or_else(|| panic!("{name} has a possibleSites count: {row}")),
    )
}

fn positioned(reply: &Value, name: &str) -> Vec<u64> {
    reply["sites"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["enzyme"]["name"] == name)
        .map(|s| s["position"].as_u64().unwrap())
        .collect()
}

fn warnings(reply: &Value) -> Vec<String> {
    reply["warnings"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()).collect()
}

fn noncutters(seq: &str, enzymes: &[RestrictionEnzyme]) -> Vec<String> {
    find_non_cutting_enzymes_for_topology(seq, Topology::Linear, Some(enzymes))
        .into_iter()
        .map(|e| e.name)
        .collect()
}

const ONE_POSSIBLE: &str =
    "1 enzyme may cut at 1 site where the sequence holds N or another ambiguity code; these are counted as possible sites, not cuts.";

#[test]
fn ambiguity_bases_make_possible_sites_not_noncutters() {
    let list = [custom("EcoRI", "GAATTC"), custom("BamHI", "GGATCC")];

    // The exact site: one cut, no possible site, no ambiguity sentence.
    let exact = format!("{}GAATTC{}", t(10), t(10));
    let reply = scan(&exact, &list);
    assert_eq!(counts(&reply, "EcoRI"), (1, 0));
    assert_eq!(counts(&reply, "BamHI"), (0, 0));
    assert_eq!(positioned(&reply, "EcoRI"), vec![11]);
    assert!(
        warnings(&reply).iter().all(|w| !w.contains("ambiguity code")),
        "no ambiguity sentence on an exact sequence: {:?}",
        warnings(&reply)
    );
    assert_eq!(noncutters(&exact, &list), vec!["BamHI"]);

    // N and R in the site: a possible site, never a cut, never a noncutter.
    for masked in [format!("{}GAANTC{}", t(10), t(10)), format!("{}GARTTC{}", t(10), t(10))] {
        let reply = scan(&masked, &list);
        assert_eq!(counts(&reply, "EcoRI"), (0, 1), "{masked}");
        assert_eq!(counts(&reply, "BamHI"), (0, 0), "{masked}");
        assert!(positioned(&reply, "EcoRI").is_empty(), "a possible site is not positioned: {masked}");
        assert!(warnings(&reply).contains(&ONE_POSSIBLE.to_string()), "{masked}: {:?}", warnings(&reply));
        assert_eq!(noncutters(&masked, &list), vec!["BamHI"], "{masked}");
    }

    // Two enzymes, each with one possible site: the plural sentence, and no noncutter at all.
    let both = format!("{}GAANTC{}GGANCC{}", t(10), t(10), t(10));
    let reply = scan(&both, &list);
    assert_eq!((counts(&reply, "EcoRI"), counts(&reply, "BamHI")), ((0, 1), (0, 1)));
    assert!(warnings(&reply).contains(
        &"2 enzymes may cut at 2 sites where the sequence holds N or another ambiguity code; these are counted as possible sites, not cuts."
            .to_string()
    ));
    assert!(noncutters(&both, &list).is_empty());

    // A possible site is a site only where it would cut the molecule: one whose cuts fall past the
    // end of a linear molecule is no possible site there, as it would be no site, but on a circle it
    // is one.
    let far = [custom("Far", "GAATTC")].map(|mut e| {
        e.cut_fwd = 30;
        e.cut_rev = 34;
        e
    });
    let masked = format!("{}GAANTC{}", t(10), t(10));
    assert_eq!(counts(&scan(&masked, &far), "Far"), (0, 0));
    assert_eq!(noncutters(&masked, &far), vec!["Far"]);
    let circular = serde_json::to_value(scan_restriction_sites(
        &masked,
        Topology::Circular,
        Some(&far),
        RestrictionPositionLimit::PerEnzyme(RESTRICTION_POSITIONS_PER_ENZYME),
    ))
    .unwrap();
    assert_eq!(counts(&circular, "Far"), (0, 1));

    // The direction of the rule. A site code meeting a sequence code is possible: site R over
    // sequence N (GARYTC, a palindrome, scanned once). A sequence code inside a site code is
    // definite: sequence R and T under site N (GANNTC, a palindrome).
    let site_r = [custom("SiteR", "GARYTC")];
    let on_n = format!("{}GANTTC{}", t(10), t(10));
    assert_eq!(counts(&scan(&on_n, &site_r), "SiteR"), (0, 1));
    assert!(noncutters(&on_n, &site_r).is_empty());
    let site_n = [custom("SiteN", "GANNTC")];
    let on_r = format!("{}GARTTC{}", t(10), t(10));
    let reply = scan(&on_r, &site_n);
    assert_eq!(counts(&reply, "SiteN"), (1, 0));
    assert_eq!(positioned(&reply, "SiteN"), vec![11]);
    assert!(warnings(&reply).iter().all(|w| !w.contains("ambiguity code")));

    // A site too degenerate to spell out (4,096 spellings) is matched base by base, by the same
    // rule: N under its N is definite, R under its A only possible.
    let wide = [custom("Wide", "GAANNNNNNTTC")];
    let n_under_n = format!("{}GAAACGNNNTTC{}", t(10), t(10));
    assert_eq!(counts(&scan(&n_under_n, &wide), "Wide"), (1, 0));
    let r_under_a = format!("{}GARACGTACTTC{}", t(10), t(10));
    let reply = scan(&r_under_a, &wide);
    assert_eq!(counts(&reply, "Wide"), (0, 1));
    assert!(warnings(&reply).contains(&ONE_POSSIBLE.to_string()));
    assert!(noncutters(&r_under_a, &wide).is_empty());
}

fn primer(name: &str, seq: &str) -> PrimerRecord {
    PrimerRecord {
        id: name.to_string(),
        name: name.to_string(),
        sequence: seq.to_string(),
        anneal_sequence: seq.to_string(),
        length: seq.len(),
        ..Default::default()
    }
}

/// (bindStart, bindEnd, strand, mismatches) of every hit of one primer, as the reply gives them.
fn binds(template: &str, seq: &str, max_mismatches: usize) -> Vec<(u64, u64, i64, u64)> {
    let hits = test_saved_primers_on_sequence(template, &[primer("p", seq)], max_mismatches);
    let reply = serde_json::to_value(hits).unwrap();
    reply
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            (
                h["bindStart"].as_u64().unwrap(),
                h["bindEnd"].as_u64().unwrap(),
                h["strand"].as_i64().unwrap(),
                h["mismatches"].as_u64().unwrap(),
            )
        })
        .collect()
}

#[test]
fn degenerate_primers_bind_by_iupac_sets() {
    let template = format!("{}GGATCCAAGCTTGCATGC{}", t(20), t(20));
    let at21 = |mm: u64| vec![(21u64, 38u64, 1i64, mm)];

    // The exact primer binds as today.
    assert_eq!(binds(&template, "GGATCCAAGCTTGCATGC", 0), at21(0));
    // R over A, a 3' N over C, inosine ({G, T, A} on its own strand) over T and over G.
    for p in ["GGATCCRAGCTTGCATGC", "GGATCCAAGCTTGCATGN", "GGATCCAAGCITGCATGC", "GGATCCAAICTTGCATGC"] {
        assert_eq!(binds(&template, p, 0), at21(0), "{p} binds at 21 with 0 mismatches");
    }
    // Inosine over C, and Y over A: a mismatch each.
    for p in ["GGATCCAAGITTGCATGC", "GGATCCYAGCTTGCATGC"] {
        assert_eq!(binds(&template, p, 0), vec![], "{p} does not bind at 0 mismatches");
        assert_eq!(binds(&template, p, 1), at21(1), "{p} binds with 1 mismatch");
    }
    // A reverse primer is read against the strand it is identical to, the bottom one: inosine over
    // that strand's T binds, over its C does not.
    let rev = |mm: u64| vec![(21u64, 38u64, -1i64, mm)];
    assert_eq!(binds(&template, "GCATGCAAGCTTGGATCC", 0), rev(0));
    assert_eq!(binds(&template, "GCAIGCAAGCTTGGATCC", 0), rev(0));
    assert_eq!(binds(&template, "GIATGCAAGCTTGGATCC", 0), vec![]);
    assert_eq!(binds(&template, "GIATGCAAGCTTGGATCC", 1), rev(1));
    // The 3' pentamer must match definitely: R over the template's T there is no binding at all,
    // at any mismatch allowance, while the same R in the 5' body is one mismatch.
    assert_eq!(binds(&template, "GGATCCAAGCTTGCARGC", 5), vec![]);
    assert_eq!(binds(&template, "GGARCCAAGCTTGCATGC", 1), at21(1));
}
