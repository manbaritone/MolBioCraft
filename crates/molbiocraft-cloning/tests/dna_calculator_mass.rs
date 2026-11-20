// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6SCYG: the DNA calculator weighed a dsDNA as `617.96 Da x bp + 36.04`, so a GC-rich and an
//! AT-rich sequence of one length read the same mass, and the insert's pmol in the ligation table
//! came from the same composition-blind figure. It now weighs both sequences from their composition.
//!
//! Reference values come from a real Biopython 1.88 run (`Bio.__version__ == "1.88"`), with
//!     Bio.SeqUtils.molecular_weight(Seq(s), seq_type="DNA", double_stranded=True,
//!                                   circular=False, monoisotopic=False)
//! (and `double_stranded=False` for the single strand): average masses of a linear chain with a 5'
//! phosphate and a 3' OH. The calculator's vector and insert are the linear pieces a ligation joins.

use molbiocraft_cloning::thermodynamics::{compute_dna_and_ligation_calculations, compute_dna_and_ligation_calculations_for_sequences};

const GC_RICH: &str = "GCGGCCGCGCGCGGCCGCGCGCGGCCGCGCGCGGCCGCGCGCGGCCGCGCGCGGCCGCGC";
const AT_RICH: &str = "ATTAAATATTATTAAATATTATTAAATATTATTAAATATTATTAAATATTATTAAATATT";
const SKEW: &str = "AAAAAAAAAAAAAAAAAAAAGGGGGGGGGG";
const VECTOR: &str = "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATG";
const INSERT: &str =
    "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTC";

/// (sequence, Biopython 1.88 dsDNA Da, ssDNA Da, RNA Da). RNA is
/// `molecular_weight(Seq(s).transcribe(), seq_type="RNA", double_stranded=False, circular=False,
/// monoisotopic=False)`.
const BIOPYTHON_1_88: [(&str, f64, f64, f64); 5] = [
    (GC_RICH, 37139.2926, 18569.6463, 19529.6103),
    (AT_RICH, 37080.0126, 18540.0063, 19079.1723),
    (SKEW, 18567.9016, 9574.2043, 10054.1863),
    (VECTOR, 50090.8543, 25120.9687, 26164.4413),
    (INSERT, 55636.5836, 27975.8670, 28995.0150),
];

fn ds(seq: &str) -> f64 {
    BIOPYTHON_1_88.iter().find(|(s, _, _, _)| *s == seq).unwrap().1
}

#[test]
fn dna_calculator_mass_matches_biopython() {
    // Each mass is Biopython's, printed to the whole dalton: an average mass from standard atomic
    // weights carries no sub-dalton digit worth reading (so neither 0.1 Da nor 0.01 Da is shown).
    for (seq, bio_ds, bio_ss, bio_rna) in BIOPYTHON_1_88 {
        for (label, input) in [("as written", seq.to_string()), ("lowercase, wrapped", seq.to_lowercase().replace("gc", "g c\n"))] {
            let calc = compute_dna_and_ligation_calculations_for_sequences(&input, 50.0, 20.0, 100.0, INSERT)
                .unwrap_or_else(|e| panic!("{seq} ({label}): {e}"));
            assert_eq!(calc.length_bp, seq.len(), "{seq} ({label}): length");
            assert_eq!(calc.mw_ds_dna_da, bio_ds.round(), "{seq} ({label}): dsDNA vs Biopython 1.88 {bio_ds}");
            assert_eq!(calc.mw_ss_dna_da, bio_ss.round(), "{seq} ({label}): ssDNA vs Biopython 1.88 {bio_ss}");
            assert_eq!(calc.mw_rna_da, bio_rna.round(), "{seq} ({label}): RNA vs Biopython 1.88 {bio_rna}");
            // The derived quantities read the composition's mass, not a length estimate.
            let pmol = 50.0 * 20.0 * 1000.0 / bio_ds;
            assert!((calc.pmol_ds_dna - pmol).abs() < 6e-4, "{seq} ({label}): pmol {} vs {pmol}", calc.pmol_ds_dna);
            let nm = 50.0 * 1e6 / bio_ds;
            assert!((calc.molarity_nanomolar - nm).abs() < 6e-3, "{seq} ({label}): nM {} vs {nm}", calc.molarity_nanomolar);
        }
    }
    // The repro: one length, two compositions, two masses.
    assert_ne!(ds(GC_RICH).round(), ds(AT_RICH).round());

    // The insert row: the mass of insert for a vector:insert MOLAR ratio is the vector's mass times
    // the insert's dsDNA mass over the vector's, and its pmol is that mass over the insert's mass.
    for (vector, insert) in [(VECTOR, INSERT), (GC_RICH, AT_RICH), (AT_RICH, GC_RICH), (SKEW, VECTOR)] {
        let calc = compute_dna_and_ligation_calculations_for_sequences(vector, 50.0, 20.0, 100.0, insert).unwrap();
        assert_eq!(calc.ligation_ratios.len(), 4);
        for (row, mult) in calc.ligation_ratios.iter().zip([1.0, 3.0, 5.0, 7.0]) {
            assert_eq!(row.insert_length_bp, insert.len());
            let ng = 100.0 * ds(insert) / ds(vector) * mult;
            assert!((row.required_insert_mass_ng - ng).abs() < 6e-3, "{vector}/{insert} 1:{mult}: {} ng vs {ng}", row.required_insert_mass_ng);
            let pmol = row.required_insert_mass_ng * 1000.0 / ds(insert);
            assert!((row.required_insert_pmol - pmol).abs() < 6e-4, "{vector}/{insert} 1:{mult}: {} pmol vs {pmol}", row.required_insert_pmol);
        }
    }

    // No bases, or a letter that is no nucleotide, is no mass: the calculator names which input.
    for (vector, insert, names) in [("", INSERT, "vector"), ("  \n", INSERT, "vector"), (VECTOR, "", "insert"), (VECTOR, "MKVLE", "insert"), ("ACGTXACGT", INSERT, "vector")] {
        let err = compute_dna_and_ligation_calculations_for_sequences(vector, 50.0, 20.0, 100.0, insert)
            .expect_err(&format!("{vector:?}/{insert:?} weighed"));
        assert!(err.contains(names), "{vector:?}/{insert:?}: {err}");
    }
}

/// The GC-rich record with its last 10 bases N. Biopython 1.88 refuses it ("'N' is not a valid
/// unambiguous letter for DNA"), as it refuses R, I, U, '-' and '1' for DNA; it takes lowercase
/// letters and whitespace.
const GC_RICH_10N: &str = "GCGGCCGCGCGCGGCCGCGCGCGGCCGCGCGCGGCCGCGCGCGGCCGCGCNNNNNNNNNN";

#[test]
fn dna_calculator_marks_masses_biopython_refuses_as_approximate() {
    // An exact record carries no mark, for the vector or the insert, written either way.
    for input in [GC_RICH.to_string(), GC_RICH.to_lowercase().replace("gc", "g c\n")] {
        let exact = compute_dna_and_ligation_calculations_for_sequences(&input, 50.0, 20.0, 100.0, &input).unwrap();
        assert!(!exact.masses_approximate, "{input:?}: marked approximate");
        assert_eq!(exact.masses_approximate_note, None, "{input:?}");
        assert!(!exact.insert_mass_approximate, "{input:?}: insert marked approximate");
        assert_eq!(exact.insert_mass_approximate_note, None, "{input:?}");
    }

    // N, the other IUPAC codes and inosine each weigh the mean of the four NMPs, an estimate, and
    // the calculator says so in the Statistics panel's words (massesApproximateNote, App.tsx). The
    // values are that mean taken with Biopython 1.88's own weights (IUPACData.unambiguous_dna_weights,
    // unambiguous_rna_weights, 18.0153 per bond): GC_RICH_10N ssDNA 18567.1763, dsDNA 37134.3526,
    // RNA 19492.0738; ACGTN RNA 1625.2133; ACGTRYI RNA 2268.0925; ACGTNI RNA 1946.6529.
    let n = compute_dna_and_ligation_calculations_for_sequences(GC_RICH_10N, 50.0, 20.0, 100.0, INSERT).unwrap();
    assert!(n.masses_approximate);
    assert_eq!(
        n.masses_approximate_note.as_deref(),
        Some("Masses are approximate: 10 bases are N or another IUPAC code, weighed as the mean of A, C, G and T.")
    );
    assert_eq!((n.mw_ds_dna_da, n.mw_ss_dna_da, n.mw_rna_da), (37134.0, 18567.0, 19492.0));
    assert!(!n.insert_mass_approximate);
    for (seq, rna, note) in [
        ("ACGTN", 1625.0, "Masses are approximate: 1 base is N or another IUPAC code, weighed as the mean of A, C, G and T."),
        (
            "ACGTRYI",
            2268.0,
            "Masses are approximate: 2 bases are other IUPAC codes and 1 is inosine (I); each is weighed as the mean of A, C, G and T.",
        ),
        (
            "ACGTNI",
            1947.0,
            "Masses are approximate: 1 base is N and 1 is inosine (I); each is weighed as the mean of A, C, G and T.",
        ),
    ] {
        let calc = compute_dna_and_ligation_calculations_for_sequences(seq, 50.0, 20.0, 100.0, INSERT).unwrap();
        assert_eq!(calc.mw_rna_da, rna, "{seq}: RNA");
        assert!(calc.masses_approximate, "{seq}");
        assert_eq!(calc.masses_approximate_note.as_deref(), Some(note), "{seq}");
    }

    // U is weighed as T and a character that is no letter is left out: Biopython refuses both for
    // DNA, so both mark the masses and the note names them.
    let acgt = compute_dna_and_ligation_calculations_for_sequences("ACGTACGT", 50.0, 20.0, 100.0, INSERT).unwrap();
    for (seq, note) in [
        ("ACGUACGU", "Masses are approximate: 2 bases are U, weighed as T."),
        ("ACGT-ACGT", "Masses are approximate: 1 character is no base (-) and is left out."),
        ("AC-GT1ACG-T", "Masses are approximate: 3 characters are no base (-, 1) and are left out."),
    ] {
        let calc = compute_dna_and_ligation_calculations_for_sequences(seq, 50.0, 20.0, 100.0, INSERT).unwrap();
        assert_eq!((calc.length_bp, calc.mw_ds_dna_da), (8, acgt.mw_ds_dna_da), "{seq}");
        assert!(calc.masses_approximate, "{seq}");
        assert_eq!(calc.masses_approximate_note.as_deref(), Some(note), "{seq}");
    }
    let both = compute_dna_and_ligation_calculations_for_sequences("ACGUN-", 50.0, 20.0, 100.0, INSERT).unwrap();
    assert_eq!(
        both.masses_approximate_note.as_deref(),
        Some("Masses are approximate: 1 base is N or another IUPAC code, weighed as the mean of A, C, G and T. 1 base is U, weighed as T. 1 character is no base (-) and is left out.")
    );

    // An estimated insert marks the ligation rows' masses, the vector's staying exact.
    let ins = compute_dna_and_ligation_calculations_for_sequences(VECTOR, 50.0, 20.0, 100.0, GC_RICH_10N).unwrap();
    assert!(!ins.masses_approximate);
    assert!(ins.insert_mass_approximate);
    assert_eq!(
        ins.insert_mass_approximate_note.as_deref(),
        Some("The insert's mass is approximate: 10 bases are N or another IUPAC code, weighed as the mean of A, C, G and T.")
    );

    // The length-only function's masses are estimates, and say so.
    let by_length = compute_dna_and_ligation_calculations(60, 50.0, 20.0, 100.0, 60);
    assert!(by_length.masses_approximate && by_length.insert_mass_approximate);
    assert!(by_length.masses_approximate_note.as_deref().is_some_and(|t| t.contains("length alone")));
}
