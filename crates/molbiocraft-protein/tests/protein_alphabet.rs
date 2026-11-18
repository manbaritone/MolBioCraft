// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VF2M: the protein calculators weigh and charge U, O, B, Z, J and X, and read stops, as
//! ExPASy Compute pI/Mw and Biopython do, say so in the report's warnings, and ProtParam and the
//! digest weigh from one table.
//!
//! The expected figures are the story's, worked by hand from the masses it cites:
//! - U: Biopython IUPACData.protein_weights 168.0532 minus ExPASy's water 18.01524 = 150.0380 Da.
//! - O: Biopython IUPACData.protein_weights 255.3134 minus 18.01524 = 237.2982 Da.
//! - B = mean(D, N) = 114.5962, Z = mean(E, Q) = 128.6231, J = mean(I, L) = 113.1594, and
//!   X = the unweighted mean of the 20 ExPASy residue masses = 118.8860 Da.
//! - U titrates as an acid of pKa 5.2 (D0188); O, B, Z, J and X carry no ionisable group.
//! GRAVY, the aliphatic index and the instability index read the 20 standard residues only, in
//! numerator and denominator, so a non-standard letter appended changes none of them.

use molbiocraft_protein::{
    analyze_protein_sequence, residue_mass_da, simulate_peptide_ms2_spectrum, simulate_proteolytic_digest_ms,
};

const BASE: &str = "MKWVTFISLLFLFSSAYS";

fn protein(seq: &str) -> molbiocraft_protein::ProteinAnalysisReport {
    analyze_protein_sequence(seq, false, 9)
}

fn round4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

#[test]
fn nonstandard_residues_weigh_and_stay_out_of_the_indices() {
    let base = protein(BASE);
    assert_eq!(base.molecular_weight_da, 2140.57, "the base weighs as it did");
    assert_eq!(base.gravy_hydropathy, 1.233);
    assert_eq!(base.aliphatic_index, 108.3);
    assert_eq!(base.instability_index, 17.57);

    // The residue values are the ones the story cites, to 4 decimals.
    for (letter, mass) in [(b'U', 150.0380), (b'O', 237.2982), (b'B', 114.5962), (b'Z', 128.6231), (b'J', 113.1594), (b'X', 118.8860)] {
        assert_eq!(round4(residue_mass_da(letter)), mass, "{} residue mass", letter as char);
    }
    // Lower case weighs the same.
    assert_eq!(residue_mass_da(b'u'), residue_mass_da(b'U'));

    for (letter, mw) in [("U", 2290.61), ("O", 2377.87), ("B", 2255.16), ("Z", 2269.19), ("J", 2253.73), ("X", 2259.45)] {
        let r = protein(&format!("{BASE}{letter}"));
        assert_eq!(r.molecular_weight_da, mw, "MW of the base + {letter}");
        assert_eq!(r.length_aa, 19, "+{letter} is a residue of the chain");
        assert_eq!(r.gravy_hydropathy, 1.233, "GRAVY of the base + {letter}");
        assert_eq!(r.aliphatic_index, 108.3, "aliphatic index of the base + {letter}");
        assert_eq!(r.instability_index, 17.57, "instability index of the base + {letter}");
    }
    let ten_x = protein(&format!("{BASE}XXXXXXXXXX"));
    assert_eq!(
        (ten_x.gravy_hydropathy, ten_x.aliphatic_index, ten_x.instability_index),
        (1.233, 108.3, 17.57),
        "ten X appended change no index"
    );

    let xs = protein("XXXX");
    assert_eq!(xs.molecular_weight_da, 493.56);
    assert!(xs.gravy_hydropathy.is_nan() && xs.aliphatic_index.is_nan() && xs.instability_index.is_nan());
    let json = serde_json::to_value(&xs).unwrap();
    for key in ["gravyHydropathy", "aliphaticIndex", "instabilityIndex"] {
        assert!(json[key].is_null(), "{key} of XXXX is null: no standard residue");
    }
}

#[test]
fn selenocysteine_titrates_and_the_others_add_no_charge() {
    let base = protein(BASE);
    assert_eq!((base.isoelectric_point_pi, base.charge_at_ph7), (8.34, 0.5));

    let u = protein(&format!("{BASE}U"));
    assert_eq!(u.isoelectric_point_pi, 6.11, "pI with U an acid of pKa 5.2");
    assert_eq!(u.charge_at_ph7, -0.49, "charge at pH 7 with U an acid of pKa 5.2");
    assert_eq!(protein("MKUW").isoelectric_point_pi, 6.11);

    for letter in ["O", "B", "Z", "J", "X"] {
        let r = protein(&format!("{BASE}{letter}"));
        assert_eq!((r.isoelectric_point_pi, r.charge_at_ph7), (8.34, 0.5), "+{letter} adds no charge");
    }
}

#[test]
fn the_report_names_every_nonstandard_letter() {
    let base = protein(BASE);
    assert!(base.warnings.is_empty());
    let json = serde_json::to_value(&base).unwrap();
    assert_eq!(json["warnings"], serde_json::json!([]), "warnings is always serialised");

    let r = protein("MKUO*BXW*");
    assert_eq!(r.length_aa, 7, "the stops are not residues");
    assert_eq!(
        r.warnings,
        vec![
            "1 selenocysteine (U): weighed as 150.04 Da and charged with a selenol pKa of 5.2; it has no GRAVY, aliphatic or instability value, so those indices leave it out.",
            "1 pyrrolysine (O): weighed as 237.30 Da with no charge; it has no GRAVY, aliphatic or instability value, so those indices leave it out.",
            "2 ambiguous or unknown residues (B, X): weighed as the mean of the residues each may be, with no charge, as ExPASy Compute pI/Mw does; the GRAVY, aliphatic and instability indices leave them out.",
            "1 internal stop (*) after residue 4: the residues on either side are measured as one chain.",
        ]
    );
    // The final stop alone is dropped without a word, and the chain weighs as its letters do.
    assert_eq!(protein("MKUOBXW").molecular_weight_da, r.molecular_weight_da);
    assert!(protein(&format!("{BASE}*")).warnings.is_empty());

    // The counts and letters come from the input.
    assert_eq!(
        protein("MKUUW").warnings,
        vec!["2 selenocysteines (U): weighed as 150.04 Da and charged with a selenol pKa of 5.2; they have no GRAVY, aliphatic or instability value, so those indices leave them out."]
    );
    assert_eq!(
        protein("MKOOW").warnings,
        vec!["2 pyrrolysines (O): weighed as 237.30 Da with no charge; they have no GRAVY, aliphatic or instability value, so those indices leave them out."]
    );
    // The ambiguity letters are named in alphabet order, whatever order the chain holds them in.
    let mixed = protein("MXZBW");
    assert_eq!(mixed.warnings.len(), 1);
    assert!(mixed.warnings[0].starts_with("3 ambiguous or unknown residues (B, X, Z): "), "{}", mixed.warnings[0]);
    let z = protein("MKZW");
    assert_eq!(z.warnings.len(), 1);
    assert!(z.warnings[0].starts_with("1 ambiguous or unknown residue (Z): "), "{}", z.warnings[0]);
    let stops = protein("MK*W*AY");
    assert_eq!(stops.warnings, vec!["2 internal stops (*) after residues 2 and 3: the residues on either side are measured as one chain."]);
    // Two stops in a row follow one residue, named once.
    assert_eq!(
        protein("MK**W").warnings,
        vec!["2 internal stops (*) after residue 2: the residues on either side are measured as one chain."]
    );
    // A stop before the first residue ends no chain and joins none: it is left out without a word,
    // as a final stop is.
    let leading = protein("*MKW");
    assert_eq!((leading.length_aa, leading.warnings.len()), (3, 0), "{:?}", leading.warnings);
}

/// The intact average mass the digest gives `seq`, from its elemental composition.
fn digest_average(seq: &str) -> f64 {
    simulate_proteolytic_digest_ms(seq, "Trypsin", 0, 0.0, 100_000.0, false).intact_average_da
}

#[test]
fn digest_and_protparam_weigh_from_one_table() {
    // Each residue's average mass from the digest's composition: a 101-mer less a 1-mer is 100
    // residues, the terminal water cancelling.
    for letter in "ACDEFGHIKLMNPQRSTVWYUO".chars() {
        let one = letter.to_string();
        let from_composition = (digest_average(&one.repeat(101)) - digest_average(&one)) / 100.0;
        let from_table = residue_mass_da(letter as u8);
        assert!(
            (from_composition - from_table).abs() < 0.01,
            "{letter}: digest {from_composition:.4} vs ProtParam {from_table:.4}"
        );
    }

    let sec = "GGGGGGUK";
    let digest = digest_average(sec);
    let protparam = protein(sec).molecular_weight_da;
    assert_eq!(protparam, 638.54, "U weighs as selenocysteine, not the 110 Da fallback");
    assert!((digest - protparam).abs() < 0.02, "digest {digest} vs ProtParam {protparam}");

    let only = |seq: &str| {
        let r = simulate_proteolytic_digest_ms(seq, "Trypsin", 0, 0.0, 100_000.0, false);
        assert_eq!(r.peptides.len(), 1, "{seq} is one tryptic peptide");
        r
    };
    let j = only("GGGGGGJK");
    let i = only("GGGGGGIK");
    assert_eq!(j.peptides[0].monoisotopic_neutral_da, i.peptides[0].monoisotopic_neutral_da);
    assert_eq!(j.peptides[0].average_neutral_da, i.peptides[0].average_neutral_da);
    assert_eq!((j.intact_monoisotopic_da, j.intact_average_da), (i.intact_monoisotopic_da, i.intact_average_da));
    assert!(j.warnings.is_empty(), "J has the composition of I and L");

    let x = only("GGGGGGXK");
    let pep = &x.peptides[0];
    assert!(pep.monoisotopic_neutral_da.is_nan(), "no monoisotopic mass for X (was weighed as Pro)");
    assert!(pep.mz_charge_1.is_nan() && pep.mz_charge_2.is_nan() && pep.mz_charge_3.is_nan());
    let json = serde_json::to_value(pep).unwrap();
    for key in ["monoisotopicNeutralDa", "mzCharge1", "mzCharge2", "mzCharge3"] {
        assert!(json[key].is_null(), "{key} serialises as null");
    }
    assert!((pep.average_neutral_da - 585.61).abs() > 1.0, "X is no longer weighed as Pro");
    assert!(
        (pep.average_neutral_da - protein("GGGGGGXK").molecular_weight_da).abs() < 0.02,
        "the average reads X from the one table"
    );
    assert_eq!(
        x.warnings,
        vec!["Peptide GGGGGGXK holds X, which has no single elemental composition: its monoisotopic mass and m/z are not given."]
    );
    assert!(x.intact_monoisotopic_da.is_nan(), "nor has the intact protein");
    assert!(
        (x.intact_average_da - protein("GGGGGGXK").molecular_weight_da).abs() < 0.02,
        "the intact average of a protein holding X reads the one table"
    );
    // A peptide with no monoisotopic mass is kept or dropped on its average (607.38 Da here).
    let windowed = |max: f64| simulate_proteolytic_digest_ms("GGGGGGXK", "Trypsin", 0, 250.0, max, false).peptides.len();
    assert_eq!((windowed(700.0), windowed(500.0)), (1, 0), "the mass window reads the average");
    // Carbamidomethyl cysteine adds C2H3NO (57.05 Da average) to such a peptide's average too.
    let cam = |on: bool| simulate_proteolytic_digest_ms("GGGGCGXK", "Trypsin", 0, 0.0, 100_000.0, on).peptides[0].average_neutral_da;
    let added = 2.0 * 12.0107 + 3.0 * 1.00794 + 14.0067 + 15.9994;
    assert!((cam(true) - cam(false) - added).abs() < 0.001, "{} vs {}", cam(true) - cam(false), added);
    let two = simulate_proteolytic_digest_ms("GGBGGZXK", "Trypsin", 0, 0.0, 100_000.0, false);
    assert_eq!(
        two.warnings,
        vec!["Peptide GGBGGZXK holds B, X and Z, which have no single elemental composition: its monoisotopic mass and m/z are not given."]
    );
    // Its MS2 spectrum has no precursor and no fragment m/z either; J fragments as I does.
    let ms2 = simulate_peptide_ms2_spectrum("GGGGGGXK", false);
    assert!(ms2.precursor_mz_2plus.is_nan() && ms2.peaks.is_empty());
    let (msj, msi) = (simulate_peptide_ms2_spectrum("GGGGGGJK", false), simulate_peptide_ms2_spectrum("GGGGGGIK", false));
    assert_eq!(msj.precursor_mz_2plus, msi.precursor_mz_2plus);
    assert_eq!(msj.peaks.iter().map(|p| p.mz).collect::<Vec<_>>(), msi.peaks.iter().map(|p| p.mz).collect::<Vec<_>>());
}
