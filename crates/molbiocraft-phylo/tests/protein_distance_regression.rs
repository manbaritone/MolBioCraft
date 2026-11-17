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

/// BG-01M7MM62: the protein dialog offers 'Poisson correction' (DISTANCE_MODELS_PROT), but that
/// name matched no model and fell through to the p-distance, so the report said "Poisson
/// correction" over a p-distance. 5 differences over 20 comparable residues (p = 0.25); the gap
/// and the X column are skipped.
const POISSON_A: &str = "MKTAYIAKQRDEFGHLNPSW-X";
const POISSON_B: &str = "MKTAWIAKERDEFGHVNPTA-M";
const DIALOG_POISSON: &str = "Poisson correction";

#[test]
fn poisson_correction_is_minus_ln_one_minus_p_with_its_delta_method_se() {
    let (d, se) = calc_protein_pair_distance_and_se(POISSON_A, POISSON_B, DIALOG_POISSON);
    // d = -ln(1 - 0.25) = 0.2877; Var(d) = p(1-p) / (L (1-p)^2) = 0.25 / (0.75 * 20), SE = 0.1291.
    assert_eq!(d, 0.2877, "Poisson d");
    assert_eq!(se, 0.1291, "Poisson SE (delta method), not the p-distance SE 0.0968");
    let (p, p_se) = calc_protein_pair_distance_and_se(POISSON_A, POISSON_B, "p-distance");
    assert_eq!(p, 0.25, "p-distance d");
    assert_eq!(p_se, 0.0968, "p-distance SE sqrt(p(1-p)/L)");
    // The tree report labels a protein distance "amino-acid p-distance" for any case of the name.
    let (p, _) = calc_protein_pair_distance_and_se(POISSON_A, POISSON_B, "P-Distance");
    assert_eq!(p, 0.25, "P-Distance is the p-distance, as its tree label says");
}

#[test]
fn poisson_correction_report_carries_the_label_of_the_distance_it_computed() {
    let names: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
    let seqs: Vec<String> = [POISSON_A, POISSON_B].iter().map(|s| s.to_string()).collect();
    for (model, d, se) in [(DIALOG_POISSON, 0.2877, 0.1291), ("p-distance", 0.25, 0.0968)] {
        let report = compute_evolutionary_distances(&names, &seqs, model, &[]);
        assert_eq!(report.model, model, "the report names the model it computed");
        assert_eq!(report.pairwise_matrix[1][0], d, "{model} distance");
        assert_eq!(report.pairwise_matrix[0][1], se, "{model} SE");
        assert_eq!(report.overall_mean_distance, d, "{model} mean");
    }
}

#[test]
fn poisson_correction_saturates_to_not_computable_like_the_other_corrected_models() {
    // Every comparable residue differs (p = 1): -ln(0) is undefined, so the pair is NaN (JSON
    // null, shown as n/c) as a saturated JC69 / K2P / TN93 nucleotide pair is, never a number.
    let (d, se) = calc_protein_pair_distance_and_se("MKTAY", "WWWWW", DIALOG_POISSON);
    assert!(d.is_nan() && se.is_nan(), "saturated Poisson must be not computable: {d} {se}");
    let (p, _) = calc_protein_pair_distance_and_se("MKTAY", "WWWWW", "p-distance");
    assert_eq!(p, 1.0, "the p-distance has no saturation");
}

#[test]
fn poisson_correction_leaves_the_nucleotide_p_distance_and_the_hky_gtr_refusal_alone() {
    use molbiocraft_phylo::distances::pair_distance_and_se;
    // 2 differences over 8 bases: the nucleotide p-distance stays p, not -ln(1 - p).
    let (p, _) = pair_distance_and_se("ACGTACGT", "ACGTACAA", "p-distance", false);
    assert_eq!(p, 0.25, "nucleotide p-distance");
    for model in ["Hasegawa-Kishino-Yano (HKY85)", "General Time Reversible (GTR+G+I)"] {
        let (d, se) = calc_protein_pair_distance_and_se(POISSON_A, POISSON_B, model);
        assert!(d.is_nan() && se.is_nan(), "{model} stays refused for proteins: {d}");
    }
}
