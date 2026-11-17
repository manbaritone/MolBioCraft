// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFRY AC7: `classify_sequence_alphabet` answers the alphabet rule's call through the
//! dispatcher every transport shares, and refuses a payload it cannot read rather than
//! classifying nothing. Wrong implementations, and the case that catches each:
//! - an op that classifies rows one at a time, or only the first: the two-row set below is DNA
//!   only when both rows are read together;
//! - the uncertain sentence counting only the shared letters, or listing them out of order:
//!   MKVAGCATNG must name K, M, V and count 3;
//! - a missing `rows` read as an empty list: it must be refused, not answered with null;
//! - a no-letter set answered with a default molecule: it must be null with its own note.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

fn classify(rows: &[&str]) -> Value {
    dispatch_bio_rpc("classify_sequence_alphabet", json!({ "rows": rows })).expect("the op answers")
}

const DNA_DOUBT: &str = "are also amino-acid letters: set the molecule type to Protein if this is a protein.";

#[test]
fn classify_sequence_alphabet_answers_and_refuses() {
    let cases: [(&str, Value, bool, Value); 13] = [
        ("ACGTBDHVACGTACGT", json!("DNA"), true, json!(format!("Read as DNA, though 4 of 16 letters (B, D, H, V) {DNA_DOUBT}"))),
        ("GCIGCIACIGGNAAYGG", json!("DNA"), true, json!(format!("Read as DNA, though 4 of 17 letters (I, Y) {DNA_DOUBT}"))),
        ("MKV*", json!("Protein"), false, Value::Null),
        ("GAGAGTCCAN", json!("DNA"), false, Value::Null),
        (
            "ACGTXXXACGT",
            json!("Protein"),
            true,
            json!("Read as protein, though 8 of 11 letters are A, C, G, T, U or N: set the molecule type to DNA or RNA if this is a nucleotide sequence."),
        ),
        ("ACGTACGTACGTRYRYRY", json!("DNA"), true, json!(format!("Read as DNA, though 6 of 18 letters (R, Y) {DNA_DOUBT}"))),
        ("MKVAGCATNG", json!("DNA"), true, json!(format!("Read as DNA, though 3 of 10 letters (K, M, V) {DNA_DOUBT}"))),
        ("ACGTACGTACGTACGTACXX", json!("DNA"), false, Value::Null),
        ("ACGTACGTACGTACGTRYX", json!("DNA"), true, json!(format!("Read as DNA, though 3 of 19 letters (R, X, Y) {DNA_DOUBT}"))),
        ("ACGUACGUAC", json!("RNA"), false, Value::Null),
        ("", Value::Null, false, json!("No residue letters to classify.")),
        ("---", Value::Null, false, json!("No residue letters to classify.")),
        ("*", Value::Null, false, json!("No residue letters to classify.")),
    ];
    for (row, molecule, uncertain, note) in cases {
        assert_eq!(classify(&[row]), json!({ "molecule": molecule, "uncertain": uncertain, "note": note }), "{row:?}");
    }
    // Rows are read together: ACGTXXXACGT alone is protein, beside a clean row it is DNA.
    assert_eq!(classify(&["ACGTXXXACGT"])["molecule"], json!("Protein"));
    assert_eq!(classify(&["ACGTXXXACGT", "ACGTACGTACGTACGTACGTACGT"])["molecule"], json!("DNA"));
    assert_eq!(classify(&[])["molecule"], Value::Null);
    assert_eq!(classify(&[])["note"], json!("No residue letters to classify."));

    assert_eq!(
        dispatch_bio_rpc("classify_sequence_alphabet", json!({})).unwrap_err(),
        "Missing required field 'rows' in RPC payload"
    );
    for bad in [json!("ACGT"), json!([1, 2]), json!({ "a": "ACGT" }), json!(["ACGT", null])] {
        let err = dispatch_bio_rpc("classify_sequence_alphabet", json!({ "rows": bad.clone() })).unwrap_err();
        assert!(err.starts_with("Invalid 'rows' payload field: "), "{bad}: {err}");
    }
}
