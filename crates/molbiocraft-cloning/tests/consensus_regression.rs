// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regressions for Generate / Export Consensus:
//! - inputs longer than the realignment limit were silently truncated to
//!   3000 residues (the consensus covered only the first 3 kb);
//! - already-aligned rows were realigned, discarding the user's alignment;
//! - RNA consensus ignored U when building ambiguity codes.

use molbiocraft_cloning::{generate_consensus_document, get_sample_library};
use molbiocraft_core::types::SequenceDocument;

fn doc_with(seq: &str, id: &str) -> SequenceDocument {
    let mut d = get_sample_library().into_iter().next().expect("sample");
    d.id = id.to_string();
    d.name = id.to_string();
    d.sequence = seq.to_string();
    d.features.clear();
    d.primers.clear();
    d.alignment_meta = None;
    d
}

#[test]
fn long_unaligned_inputs_are_refused_not_truncated() {
    let long: String = "ACGT".repeat(1000); // 4000 nt
    let a = doc_with(&long, "a");
    let mut b_seq = long.clone();
    b_seq.replace_range(10..11, "G");
    let b = doc_with(&b_seq, "b");
    let mut c = doc_with(&long[..3990], "c");
    c.sequence.push_str("TTTTTTTTTTTT");
    let err = generate_consensus_document(&[a, b, c], 60.0).unwrap_err();
    assert!(err.contains("limited to 3000"), "{err}");
}

#[test]
fn aligned_rows_are_used_as_is_over_their_full_length() {
    let row1: String = "ACGT".repeat(1200); // 4800 columns, already aligned
    let mut row2 = row1.clone();
    row2.replace_range(100..104, "----");
    let cons = generate_consensus_document(&[doc_with(&row1, "r1"), doc_with(&row2, "r2")], 50.0)
        .expect("consensus of aligned rows");
    assert_eq!(
        cons.sequence.len(),
        4800,
        "consensus must span every aligned column"
    );
    assert_eq!(&cons.sequence[..100], &row1[..100]);
}

#[test]
fn rna_ambiguity_codes_include_uracil() {
    // Column 3 is a 50/50 C/U split -> Y (C or T/U), not C.
    let a = doc_with("AUCGA", "a");
    let b = doc_with("AUUGA", "b");
    let mut a2 = a.clone();
    let mut b2 = b.clone();
    // Flag as aligned so the rows are compared column by column.
    for d in [&mut a2, &mut b2] {
        d.sequence = d.sequence.clone();
        d.alignment_meta = Some(molbiocraft_core::types::DocumentAlignmentMeta {
            sequence_count: Some(2),
            pairwise_identity_pct: None,
            identical_sites_pct: None,
            genetic_code_label: None,
            mean_coverage_x: None,
            tree_builder: None,
            is_aligned: Some(true),
            sequences: None,
        });
    }
    let cons = generate_consensus_document(&[a2, b2], 75.0).expect("consensus");
    assert_eq!(cons.sequence.as_bytes()[2], b'Y', "{}", cons.sequence);
}
