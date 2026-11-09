// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression: protein alignments were scored with nucleotide distances that
//! only count A/C/G/T letters, so trees were refused ("No tree") or collapsed
//! to zero-length stars. Proteins now use amino-acid p / Poisson distances.

use molbiocraft_phylo::distances::{
    calc_protein_pair_distance_and_se, compute_evolutionary_distances,
};

#[test]
fn poisson_and_p_distances_for_proteins() {
    // 2 differences over 10 comparable residues; the gap column is skipped.
    let a = "MKTAYIAKQR-";
    let b = "MKTAWIAKER-";
    let (p, _) = calc_protein_pair_distance_and_se(a, b, "p-distance");
    assert!((p - 0.2).abs() < 1e-9, "{p}");
    let (d, se) = calc_protein_pair_distance_and_se(a, b, "Tamura-Nei (TN93)");
    assert!((d - (-(0.8f64).ln())).abs() < 1e-4, "{d}");
    assert!(se > 0.0);
}

#[test]
fn protein_distance_matrix_is_not_degenerate() {
    let names: Vec<String> = ["h", "m", "z"].iter().map(|s| s.to_string()).collect();
    let seqs: Vec<String> = [
        "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF",
        "MVLSGEDKSNIKAAWGKIGGHGAEYGAEALERMFASFPTTKTYFPHF",
        "MSLSDKDKAAVRALWSKIGKSADAIGNDALSRMIVVYPQTKTYFSHW",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let report = compute_evolutionary_distances(&names, &seqs, "Tamura-Nei (TN93)", &[]);
    let json = serde_json::to_value(&report).unwrap();
    let text = json.to_string();
    // Every pairwise distance is a positive finite number (no nulls, no zeros).
    let m = json["pairwiseMatrix"].as_array();
    if let Some(rows) = m {
        for (i, row) in rows.iter().enumerate() {
            for (j, v) in row.as_array().unwrap().iter().enumerate() {
                if j < i {
                    let d = v
                        .as_f64()
                        .unwrap_or_else(|| panic!("null distance at {i},{j}: {text}"));
                    assert!(d > 0.0, "zero distance at {i},{j}");
                }
            }
        }
    } else {
        panic!("unexpected report shape: {text}");
    }
}

/// Regression: a digit / space / punctuation typed into the Variant Impact
/// residue fields trapped the WASM engine (blosum62 index out of bounds).
#[test]
fn missense_diagnosis_accepts_any_typed_character() {
    use molbiocraft_phylo::models_selection::diagnose_missense_mutation;
    let aln: Vec<String> = vec!["MKTAYIAKQR".into(), "MKTAWIAKQR".into()];
    for (wt, mt) in [("1", "Y"), (" ", "W"), ("?", "É"), ("", ""), ("Y", "W")] {
        let r = diagnose_missense_mutation(5, wt, mt, &aln);
        assert!(
            r.substitution_label.starts_with("p."),
            "{wt:?}->{mt:?}: {}",
            r.substitution_label
        );
    }
    // Position 0 must not underflow.
    let _ = diagnose_missense_mutation(0, "M", "V", &aln);
}


/// Regression: DNA rows with >=10% IUPAC ambiguity codes (mixed-base calls)
/// were classified as protein and scored with amino-acid Poisson distances.
#[test]
fn dna_with_ambiguity_codes_uses_nucleotide_distances() {
    let names: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    // a and b differ only at ambiguous sites, which nucleotide models skip.
    let seqs: Vec<String> = [
        "ACGTRACGTYACGTWACGTSACGTACGTA",
        "ACGTYACGTRACGTSACGTWACGTACGTA",
        "ACGTRACGTYACGTWACGTSACGTACGTT",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let report = compute_evolutionary_distances(&names, &seqs, "Kimura 2-parameter", &[]);
    let json = serde_json::to_value(&report).unwrap();
    let d_ab = json["pairwiseMatrix"][1][0]
        .as_f64()
        .expect("finite distance");
    assert!(
        d_ab.abs() < 1e-9,
        "ambiguous-only differences must not count: {d_ab}"
    );
}

/// Regression: a huge codon position must be reported as beyond sequence 1,
/// not wrap (32-bit usize on wasm32) onto a frame-shifted codon.
#[test]
fn missense_position_beyond_the_sequence_is_reported_as_such() {
    use molbiocraft_phylo::models_selection::diagnose_missense_mutation;
    let aligned: Vec<String> = vec!["ATGGTGAGCAAGGGCGAGGAG".into(), "ATGGTGAGCAAGGGCGAGGAG".into()];
    for pos in [8usize, 1_431_655_767, usize::MAX / 2] {
        let r = diagnose_missense_mutation(pos, "M", "V", &aligned);
        let json = serde_json::to_value(&r).unwrap();
        let rationale = json["rationale"].as_str().unwrap_or_default().to_string();
        assert!(rationale.contains("beyond sequence 1"), "pos {pos}: {rationale}");
    }
}
