// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression: an MSA of all-empty sequences (e.g. two blank "New Sequence"
//! documents) indexed an empty row through an inclusive 0..=0 range and trapped
//! the WASM engine.

use molbiocraft_align::{run_multiple_sequence_alignment, MsaInputDoc};

#[test]
fn msa_of_empty_sequences_does_not_panic() {
    let docs = vec![
        MsaInputDoc {
            id: "a".into(),
            name: "a".into(),
            sequence: String::new(),
        },
        MsaInputDoc {
            id: "b".into(),
            name: "b".into(),
            sequence: String::new(),
        },
    ];
    let res = run_multiple_sequence_alignment(&docs, 3000);
    assert!(res.rows.iter().all(|r| r.aligned_seq.is_empty()));
}

/// Regression: the taxonomy classifier reported four taxa at ≥ 34% "confidence"
/// for any sequence, including ones with no marker signature at all.
#[test]
fn taxonomy_reports_only_taxa_with_matched_signatures() {
    let no_markers = "AAAAAAAAAACCCCCCCCCCAAAAAAAAAACCCCCCCCCC".repeat(10);
    assert!(molbiocraft_align::classify_sequence_taxonomy(&no_markers).is_empty());
    for hit in molbiocraft_align::classify_sequence_taxonomy(&"ACGTTGCAGGCCTAGCTAGG".repeat(50)) {
        assert!(!hit.matched_signatures.is_empty(), "{hit:?}");
    }
}
