// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7DVD5: a digest by id (`simulate_enzyme_digest`) cuts with a custom definition's own
//! sites and offsets, under the end rules already pinned for catalogue enzymes (BG-01M7CDM1), and
//! applies the methylation rule to it only when the user marked it sensitive.
//!
//! Every expected value is written here from the fixture's construction (segment lengths and the
//! definition's offsets), never read from either digest op.

use molbiocraft_cloning::rebase_catalog::{
    get_rebase_enzymes, scan_restriction_sites, simulate_enzyme_digest, simulate_restriction_digest,
    DigestEnzymeChoice, DigestFragment, RestrictionPositionLimit,
};
use molbiocraft_core::types::{EnzymeSource, MoleculeType, RestrictionEnzyme, SequenceDocument, Topology};

/// A/C filler: no G and no T, so no motif below (each holds a G or a T) is ever found in it.
fn fill(n: usize) -> String {
    (0..n).map(|i| if i % 3 == 0 { 'A' } else { 'C' }).collect()
}

fn doc(id: &str, sequence: String, topology: Topology) -> SequenceDocument {
    SequenceDocument {
        id: id.into(),
        name: id.into(),
        molecule_type: MoleculeType::DNA,
        topology,
        sequence,
        ..Default::default()
    }
}

fn custom(id: &str, name: &str, motif: &str, cut_fwd: i32, cut_rev: i32, meth: &[&str]) -> RestrictionEnzyme {
    RestrictionEnzyme {
        id: format!("custom:{id}"),
        source: EnzymeSource::Custom,
        name: name.into(),
        recognition_seq: motif.into(),
        cut_fwd,
        cut_rev,
        is_type_iis: false,
        suppliers: vec![],
        methylation_sensitivity: meth.iter().map(|m| (*m).to_string()).collect(),
        buffer_standard: String::new(),
        temp_c: 37,
        provenance: String::new(),
        notes: String::new(),
    }
}

const MINE: &str = "TGGTGGTGA";

/// (start, end, length, left enzyme, left overhang, right enzyme, right overhang) of each fragment.
fn shape(f: &[DigestFragment]) -> Vec<(usize, usize, usize, String, String, String, String)> {
    f.iter()
        .map(|f| (f.start, f.end, f.length_bp, f.left_enzyme.clone(), f.left_overhang.clone(), f.right_enzyme.clone(), f.right_overhang.clone()))
        .collect()
}

fn digest(d: &SequenceDocument, defs: &[RestrictionEnzyme]) -> molbiocraft_cloning::rebase_catalog::EnzymeDigest {
    let choice: Vec<DigestEnzymeChoice> = defs.iter().cloned().map(DigestEnzymeChoice::Definition).collect();
    simulate_enzyme_digest(d, &choice)
}

#[test]
fn us_01m7dvd5_ac3_a_circular_digest_with_one_custom_cut_is_one_full_length_fragment_ending_before_the_cut() {
    // The motif at bases 51..59 of a 100 bp circle; a cut 3 bases into it on top and 7 on the
    // bottom: the first base after the top cut is 54, the overhang bases 54..57 (TGGT, 5').
    let seq = format!("{}{}{}", fill(50), MINE, fill(41));
    assert_eq!(seq.len(), 100);
    let d = doc("c1", seq.clone(), Topology::Circular);
    let r = digest(&d, &[custom("mine", "MineI", MINE, 3, 7, &[])]);
    assert!(r.complete, "{:?}", r.unresolved_enzymes);
    assert!(r.unresolved_enzymes.is_empty());
    assert_eq!(
        shape(&r.fragments),
        vec![(54, 53, 100, "MineI".into(), "TGGT".into(), "MineI".into(), "TGGT".into())]
    );
    let f = &r.fragments[0];
    assert_eq!((f.left_overhang_type.as_str(), f.right_overhang_type.as_str()), ("5prime", "5prime"));
    assert_eq!(f.sequence, format!("{}{}", &seq[53..], &seq[..53]));
    // The end carries the custom definition's id and source, never the name alone.
    assert_eq!(f.left_enzyme_id.as_deref(), Some("custom:mine"));
    assert_eq!(f.right_enzyme_id.as_deref(), Some("custom:mine"));
    assert_eq!(f.left_enzyme_source, Some(EnzymeSource::Custom));
    assert_eq!(f.right_enzyme_source, Some(EnzymeSource::Custom));

    // A cut after the circle's last base is before base 1: the fragment is 1..100.
    let at_origin = doc("c2", format!("{}{}", fill(91), MINE), Topology::Circular);
    let r = digest(&at_origin, &[custom("o", "OriI", MINE, 9, 9, &[])]);
    assert_eq!(shape(&r.fragments), vec![(1, 100, 100, "OriI".into(), "".into(), "OriI".into(), "".into())]);

    // A signed offset: 2 bases before a motif at base 1 is a cut before base 99 (through the origin).
    let upstream = doc("c3", format!("{}{}", MINE, fill(91)), Topology::Circular);
    let r = digest(&upstream, &[custom("u", "UpI", MINE, -2, -2, &[])]);
    assert_eq!(shape(&r.fragments), vec![(99, 98, 100, "UpI".into(), "".into(), "UpI".into(), "".into())]);
}

#[test]
fn us_01m7dvd5_ac3_a_linear_digest_with_a_custom_cut_at_an_end_reports_no_empty_fragment() {
    // A blunt cut before base 1 separates nothing: the molecule is one 100 bp fragment.
    let at_start = doc("l1", format!("{}{}", MINE, fill(91)), Topology::Linear);
    let r = digest(&at_start, &[custom("s", "StartI", MINE, 0, 0, &[])]);
    assert!(r.complete);
    assert_eq!(
        shape(&r.fragments),
        vec![(1, 100, 100, "5' Terminus".into(), "".into(), "3' Terminus".into(), "".into())]
    );
    assert_eq!(r.fragments[0].left_enzyme_id, None, "a terminus is no enzyme's end");

    // A blunt cut after the last base, with an internal cut 30 bases in (motif at 21..29, cut 9 in):
    // two fragments, 1..29 and 30..100, and no empty one.
    let seq = format!("{}{}{}{}", fill(20), "TGTGTGTGA", fill(62), MINE);
    assert_eq!(seq.len(), 100);
    let ends = doc("l2", seq, Topology::Linear);
    let r = digest(&ends, &[custom("e", "EndI", MINE, 9, 9, &[]), custom("i", "InI", "TGTGTGTGA", 9, 9, &[])]);
    assert!(r.complete);
    assert_eq!(
        shape(&r.fragments),
        vec![
            (30, 100, 71, "InI".into(), "".into(), "3' Terminus".into(), "".into()),
            (1, 29, 29, "5' Terminus".into(), "".into(), "InI".into(), "".into()),
        ]
    );
    assert!(r.fragments.iter().all(|f| !f.sequence.is_empty()));
}

/// ClaI's motif and cuts (ATCGAT, 2/4): one site inside a GATC (ATCGATC, bases 51..57) and one with
/// none within three bases (bases 108..113 of a 200 bp molecule).
fn dam_fixture() -> SequenceDocument {
    let seq = format!("{}{}{}{}{}", fill(50), "ATCGATC", fill(50), "ATCGAT", fill(87));
    assert_eq!(seq.len(), 200);
    doc("dam", seq, Topology::Linear)
}

/// AlwNI's motif and cuts (CAGNNNCTG, 6/3): one site whose first base ends a CCAGG (CCAGGAACTG,
/// the site at bases 52..60) and one with none near it (bases 121..129 of a 200 bp molecule).
fn dcm_fixture() -> SequenceDocument {
    let seq = format!("{}{}{}{}{}", fill(50), "CCAGGAACTG", fill(60), "CAGAAACTG", fill(71));
    assert_eq!(seq.len(), 200);
    doc("dcm", seq, Topology::Linear)
}

#[test]
fn us_01m7dvd5_ac4_a_custom_definition_with_no_methylation_set_is_never_methylation_blocked() {
    let d = dam_fixture();
    let plain = custom("cla", "MyCla", "ATCGAT", 2, 4, &[]);
    // ClaI's cuts: 2 bases into each motif, so the first bases after them are 53 and 110.
    let r = digest(&d, &[plain.clone()]);
    assert!(r.complete);
    let mut starts: Vec<usize> = r.fragments.iter().map(|f| f.start).collect();
    starts.sort();
    assert_eq!(starts, vec![1, 53, 110], "both sites cut, the one inside a GATC included");
    let scan = scan_restriction_sites(&d.sequence, d.topology, Some(&[plain]), RestrictionPositionLimit::All);
    assert_eq!(scan.sites.len(), 2);
    assert!(scan.sites.iter().all(|s| !s.methylation_blocked));

    let d = dcm_fixture();
    let r = digest(&d, &[custom("alw", "MyAlw", "CAGNNNCTG", 6, 3, &[])]);
    let mut starts: Vec<usize> = r.fragments.iter().map(|f| f.start).collect();
    starts.sort();
    assert_eq!(starts, vec![1, 58, 127], "both sites cut, the one inside a CCAGG included");
}

#[test]
fn us_01m7dvd5_ac4_a_custom_definition_marked_dam_or_dcm_blocks_exactly_the_sites_the_rule_blocks() {
    let cla = get_rebase_enzymes().into_iter().find(|e| e.name == "ClaI").unwrap();
    assert!(cla.methylation_sensitivity.iter().any(|m| m == "Dam"));
    let d = dam_fixture();
    let r = digest(&d, &[custom("cla", "MyCla", "ATCGAT", 2, 4, &["Dam"])]);
    // Only the site with no GATC near it cuts: 1..109 and 110..200.
    assert_eq!(
        shape(&r.fragments),
        vec![
            (1, 109, 109, "5' Terminus".into(), "".into(), "MyCla".into(), "CG".into()),
            (110, 200, 91, "MyCla".into(), "CG".into(), "3' Terminus".into(), "".into()),
        ]
    );
    // ... the same cuts as the built-in ClaI, which the catalogue marks Dam-sensitive.
    let builtin: Vec<(usize, usize)> = simulate_restriction_digest(&d, &["ClaI".to_string()]).iter().map(|f| (f.start, f.end)).collect();
    assert_eq!(r.fragments.iter().map(|f| (f.start, f.end)).collect::<Vec<_>>(), builtin);

    let alw = get_rebase_enzymes().into_iter().find(|e| e.name == "AlwNI").unwrap();
    assert_eq!(alw.methylation_sensitivity, vec!["Dcm".to_string()]);
    let d = dcm_fixture();
    let r = digest(&d, &[custom("alw", "MyAlw", "CAGNNNCTG", 6, 3, &["Dcm"])]);
    assert_eq!(
        r.fragments.iter().map(|f| (f.start, f.end, f.length_bp)).collect::<Vec<_>>(),
        vec![(1, 126, 126), (127, 200, 74)]
    );
    let builtin: Vec<(usize, usize)> = simulate_restriction_digest(&d, &["AlwNI".to_string()]).iter().map(|f| (f.start, f.end)).collect();
    assert_eq!(r.fragments.iter().map(|f| (f.start, f.end)).collect::<Vec<_>>(), builtin);

    // A sensitivity the rule does not read (CpG) blocks nothing.
    let r = digest(&dam_fixture(), &[custom("cpg", "MyCpg", "ATCGAT", 2, 4, &["CpG"])]);
    assert_eq!(r.fragments.len(), 3);
}
