// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFRY AC1: the one alphabet rule (`classify_molecule`) on the alphabet audit's inputs
//! (F1 and F7), and the counts `alphabet_warnings` turns into import sentences. Wrong
//! implementations, and the case that catches each:
//! - B, D, H, V or I read as protein letters (the old FASTA reader): ACGTBDHVACGTACGT and
//!   GCIGCIACIGGNAAYGG turn Protein;
//! - inosine left out of the shared group: GCIGCIACIGGNAAYGG turns Protein (asserted directly with
//!   the shared group minus I);
//! - ambiguity read as protein (the old external.rs rule, under 90% ACGTUN): ACGTACGTACGTRYRYRY
//!   turns Protein;
//! - the 90% core+shared bound loosened or tightened: ACGTACGTACGTACGTACXX (exactly 90%) turns
//!   Protein, or its one-more-X neighbour stays DNA;
//! - the stop counted as a residue: MKV* is uncertain or nucleotide-looking, and `*` gets a call;
//! - no-letter input given a default call: '', '---' and '*' get one;
//! - RNA from any U: ACGUACGUAC is the only U-without-T case and must be RNA, GAGAGTCCAN DNA.

use molbiocraft_core::iupac::{
    alphabet_warnings, classify_molecule, classify_molecule_with_shared, NUCLEOTIDE_SHARED_LETTERS,
};
use molbiocraft_core::MoleculeType;

fn call(s: &str) -> (Option<MoleculeType>, bool) {
    let c = classify_molecule(&[s]);
    (c.molecule, c.uncertain)
}

#[test]
fn the_alphabet_rule_classifies_the_audit_inputs() {
    use MoleculeType::{Protein, DNA, RNA};
    let cases: [(&str, Option<MoleculeType>, bool); 12] = [
        ("ACGTBDHVACGTACGT", Some(DNA), true),
        ("GCIGCIACIGGNAAYGG", Some(DNA), true),
        ("MKV*", Some(Protein), false),
        ("GAGAGTCCAN", Some(DNA), false),
        ("ACGTXXXACGT", Some(Protein), true),
        ("ACGTACGTACGTRYRYRY", Some(DNA), true),
        ("MKVAGCATNG", Some(DNA), true),
        ("ACGTACGTACGTACGTACXX", Some(DNA), false),
        ("ACGUACGUAC", Some(RNA), false),
        ("", None, false),
        ("---", None, false),
        ("*", None, false),
    ];
    for (input, molecule, uncertain) in cases {
        assert_eq!(call(input), (molecule, uncertain), "{input:?}");
    }

    // The rule reads every row together, case-blind, and skips gaps and missing data.
    let rows = ["acgt-acgt", "ACGT.ACGT?", "~bdhv"];
    let c = classify_molecule(&rows);
    assert_eq!((c.molecule, c.uncertain, c.letters, c.core), (Some(DNA), true, 20, 16));

    // ACGTACGTACGTACGTACXX: DNA with the foreign letter X twice; one more X makes it Protein.
    let c = classify_molecule(&["ACGTACGTACGTACGTACXX"]);
    assert_eq!(c.foreign.iter().map(|(k, v)| (*k, *v)).collect::<Vec<_>>(), vec![('X', 2)]);
    assert_eq!(call("ACGTACGTACGTACGTACXXX"), (Some(Protein), true));

    // Inosine is in the shared group, and is what makes GCIGCIACIGGNAAYGG DNA.
    assert!(NUCLEOTIDE_SHARED_LETTERS.contains(&b'I'));
    let without_i: Vec<u8> = NUCLEOTIDE_SHARED_LETTERS.iter().copied().filter(|&b| b != b'I').collect();
    assert_eq!(classify_molecule_with_shared(&["GCIGCIACIGGNAAYGG"], &without_i).molecule, Some(Protein));

    // Each other case flips when its decisive letter changes.
    assert_eq!(call("ACGTBDHVACGTACGT".replace("BDHV", "ACGT").as_str()), (Some(DNA), false));
    assert_eq!(call("MKVAGCATNG"), (Some(DNA), true));
    assert_eq!(call("EEVAGCATNG"), (Some(Protein), true), "E is no nucleotide code: 70% core, 80% with V");
    assert_eq!(call("ACGTACGTACGTRYRYRYRYRY"), (Some(Protein), false), "core under 60%");
    assert_eq!(call("ACGTACGACGT"), (Some(DNA), false), "ACGTXXXACGT with ACG for XXX");
    assert_eq!(call("GAGAGTCCANRY"), (Some(DNA), true), "two ambiguity codes take the core under 90%");
    assert_eq!(call("ACGUACGUACT"), (Some(DNA), false), "a T makes U-bearing input DNA");
    assert_eq!(call("MKVE*"), (Some(Protein), false));
    assert_eq!(call("ACGTACXXXX"), (Some(Protein), true), "a protein call with exactly 60% core is uncertain");
    assert_eq!(call("ACGTAXXXXX"), (Some(Protein), false), "50% core");
    assert_eq!(call("ACGTACGTACGTRYRYRYRY"), (Some(DNA), true), "exactly 60% core is nucleotide");
    assert_eq!(call("MKV*").0, Some(Protein));
    assert_eq!(call("A*").0, Some(DNA), "a stop is not a letter");
    assert_eq!(classify_molecule(&["", "---"]).note().as_deref(), Some("No residue letters to classify."));
}

#[test]
fn the_rule_writes_the_uncertain_sentence_from_its_counts() {
    let note = |s: &str| classify_molecule(&[s]).note();
    assert_eq!(
        note("ACGTBDHVACGTACGT").as_deref(),
        Some("Read as DNA, though 4 of 16 letters (B, D, H, V) are also amino-acid letters: set the molecule type to Protein if this is a protein.")
    );
    assert_eq!(
        note("GCIGCIACIGGNAAYGG").as_deref(),
        Some("Read as DNA, though 4 of 17 letters (I, Y) are also amino-acid letters: set the molecule type to Protein if this is a protein.")
    );
    assert_eq!(
        note("MKVAGCATNG").as_deref(),
        Some("Read as DNA, though 3 of 10 letters (K, M, V) are also amino-acid letters: set the molecule type to Protein if this is a protein.")
    );
    assert_eq!(
        note("ACGTXXXACGT").as_deref(),
        Some("Read as protein, though 8 of 11 letters are A, C, G, T, U or N: set the molecule type to DNA or RNA if this is a nucleotide sequence.")
    );
    assert_eq!(
        note("ACGUACGUACGUACGUACRYRY").as_deref(),
        Some("Read as RNA, though 4 of 22 letters (R, Y) are also amino-acid letters: set the molecule type to Protein if this is a protein.")
    );
    assert_eq!(
        note("ACGTACGTACGTACGTRYX").as_deref(),
        Some("Read as DNA, though 3 of 19 letters (R, X, Y) are also amino-acid letters: set the molecule type to Protein if this is a protein."),
        "the count and the list are every letter other than A, C, G, T, U and N, foreign ones included"
    );
    for certain in ["GAGAGTCCAN", "MKV*", "ACGTACGTACGTACGTACXX", "ACGUACGUAC"] {
        assert_eq!(note(certain), None, "{certain}");
    }
}

#[test]
fn alphabet_warnings_counts_what_the_reader_leaves_out_or_changes() {
    use MoleculeType::{Protein, DNA};
    assert_eq!(
        alphabet_warnings("ACGTA-CGTAC.GTACG~TACGTXX", DNA),
        vec![
            "2 letters are not nucleotide codes and were kept: X at 21 and 22.".to_string(),
            "3 gap characters (-, ., ~) were left out; positions count the letters kept.".to_string(),
        ]
    );
    assert_eq!(
        alphabet_warnings("ACGTA-CGTAC.GTACG~TACGTXX-", DNA)[1],
        "4 gap characters (-, ., ~) were left out; positions count the letters kept."
    );
    assert_eq!(
        alphabet_warnings("MKWVUTFIS*LLFX-XX*", Protein),
        vec![
            "1 internal stop (*) after residue 9 was left out, so the residues on either side read as one chain.".to_string(),
            "1 gap character (-) was left out; positions count the letters kept.".to_string(),
        ]
    );
    assert_eq!(
        alphabet_warnings("MK*W*VU*", Protein),
        vec!["2 internal stops (*) after residues 2 and 3 were left out, so the residues on either side read as one chain.".to_string()]
    );
    assert!(alphabet_warnings("MKV*", Protein).is_empty(), "a protein's final stop ends its chain");
    assert_eq!(
        alphabet_warnings("MKWVUTFIS*LLF", Protein),
        vec!["1 internal stop (*) after residue 9 was left out, so the residues on either side read as one chain.".to_string()],
        "a stop that letters follow is internal, even when it is the record's last stop: only a stop with no letter after it is final"
    );
    assert_eq!(
        alphabet_warnings("ACGTACGT*", DNA),
        vec!["1 internal stop (*) after residue 8 was left out, so the residues on either side read as one chain.".to_string()],
        "only a protein's final stop is its chain's end"
    );
    assert_eq!(
        alphabet_warnings("ACGTacgtACGT", DNA),
        vec!["4 lower-case (soft-masked) letters were read as upper case; the soft-mask is not kept.".to_string()]
    );
    assert!(alphabet_warnings("acgtacgt", DNA).is_empty(), "all lower case carries no mask");
    assert_eq!(
        alphabet_warnings("ACGT?ACGT", DNA),
        vec!["1 gap character (?) was left out; positions count the letters kept.".to_string()],
        "missing data is left out like a gap"
    );
    assert_eq!(
        alphabet_warnings("ACGTE", DNA),
        vec!["1 letter is not a nucleotide code and was kept: E at 5.".to_string()]
    );
    assert_eq!(
        alphabet_warnings("EACGTXXACGTJ", DNA),
        vec!["4 letters are not nucleotide codes and were kept: E at 1; X at 6 and 7; J at 12.".to_string()]
    );
    assert_eq!(
        alphabet_warnings(&format!("ACGT{}", "X".repeat(12)), DNA),
        vec!["12 letters are not nucleotide codes and were kept: X at 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, and 2 more.".to_string()]
    );
    assert!(alphabet_warnings("GCIGCIACIGGNAAYGGBDHVRSWKM", DNA).is_empty(), "IUPAC codes and inosine are nucleotide codes");
    assert!(alphabet_warnings("MKVXBZJOU", Protein).is_empty(), "every letter is an amino-acid code");
}
