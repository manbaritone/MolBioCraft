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

/// BG-01M7MQP8: a protein report echoed the requested nucleotide model ('Jukes-Cantor (JC69)')
/// over the Poisson distance it computed. The report names the protein distance computed, says why
/// when a nucleotide name was asked for, and the tree label follows the same single rule.
#[test]
fn protein_report_label_names_the_distance_computed() {
    use molbiocraft_phylo::distances::protein_distance_name;
    use molbiocraft_phylo::trees::construct_phylogenetic_tree;
    let names: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
    let seqs: Vec<String> = [POISSON_A, POISSON_B].iter().map(|s| s.to_string()).collect();
    let note = |m: &str| format!("{m} does not apply to proteins: the Poisson correction was computed instead.");
    let cases: [(&str, &str, Option<String>, f64, f64); 7] = [
        ("Jukes-Cantor (JC69)", DIALOG_POISSON, Some(note("Jukes-Cantor (JC69)")), 0.2877, 0.1291),
        ("Maximum Composite Likelihood (MCL)", DIALOG_POISSON, Some(note("Maximum Composite Likelihood (MCL)")), 0.2877, 0.1291),
        ("Tamura-Nei (TN93)", DIALOG_POISSON, Some(note("Tamura-Nei (TN93)")), 0.2877, 0.1291),
        (DIALOG_POISSON, DIALOG_POISSON, None, 0.2877, 0.1291),
        ("poisson CORRECTION", DIALOG_POISSON, None, 0.2877, 0.1291),
        ("p-distance", "p-distance", None, 0.25, 0.0968),
        ("P-Distance", "p-distance", None, 0.25, 0.0968),
    ];
    for (requested, computed, expected_note, d, se) in cases {
        assert_eq!(protein_distance_name(requested), computed, "{requested}: the shared rule");
        let report = compute_evolutionary_distances(&names, &seqs, requested, &[]);
        assert_eq!(report.model, computed, "{requested}: the report names the distance computed");
        assert_eq!(report.model_note, expected_note, "{requested}: note");
        assert_eq!(report.pairwise_matrix[1][0], d, "{requested}: distance unchanged");
        assert_eq!(report.pairwise_matrix[0][1], se, "{requested}: SE unchanged");
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["model"], computed, "{requested}: JSON model");
        match &expected_note {
            Some(n) => assert_eq!(json["modelNote"], n.as_str(), "{requested}: JSON modelNote"),
            None => assert!(json.get("modelNote").is_none(), "{requested}: modelNote must be absent: {json}"),
        }
    }

    // A nucleotide alignment keeps the requested model's name, its own distance and no note.
    let dna: Vec<String> = ["ACGTACGTACGTACGTACGT", "ACGTACGAACGTACGTTCGT"].iter().map(|s| s.to_string()).collect();
    let report = compute_evolutionary_distances(&names, &dna, "Jukes-Cantor (JC69)", &[]);
    assert_eq!(report.model, "Jukes-Cantor (JC69)");
    assert_eq!(report.model_note, None);
    assert!(serde_json::to_value(&report).unwrap().get("modelNote").is_none());
    // JC69 of p = 2/20: d = -3/4 ln(1 - 4p/3) = 0.1073.
    assert_eq!(report.pairwise_matrix[1][0], 0.1073, "nucleotide JC69 distance unchanged");

    // The tree label follows the same rule, for any case of the name.
    let three: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let prot: Vec<String> = [POISSON_A, POISSON_B, "MKTAWIAKERDEFGHVNPTW-M"].iter().map(|s| s.to_string()).collect();
    for (requested, label) in [
        ("P-Distance", "on amino-acid p-distance distances"),
        ("Jukes-Cantor (JC69)", "on Poisson-corrected amino-acid distances"),
        (DIALOG_POISSON, "on Poisson-corrected amino-acid distances"),
    ] {
        let tree = construct_phylogenetic_tree(&three, &prot, "Neighbor-Joining (NJ)", requested, 0);
        assert!(tree.method_note.contains(label), "{requested}: {}", tree.method_note);
    }

    // The rule exists once: distances.rs holds the only "p-distance" name test and trees.rs asks it.
    let rule = "to_ascii_lowercase().contains(\"p-distance\")";
    assert_eq!(include_str!("../src/distances.rs").matches(rule).count(), 1, "one rule in distances.rs");
    let trees = include_str!("../src/trees.rs");
    assert!(!trees.contains("\"p-distance\""), "trees.rs must not restate the rule");
    assert!(trees.contains("protein_distance_name("), "trees.rs must ask the shared rule");
}

/// BG-01M7MW9R: the diversity report carried no model, so the runner printed the requested nucleotide
/// model ('Maximum Composite Likelihood (MCL)' by default) over the protein distance it averaged. The
/// report now carries the `model` and `modelNote` of the distance report it already computes.
#[test]
fn diversity_report_label_names_the_distance_computed() {
    use molbiocraft_phylo::distances::compute_population_diversity;
    let names: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let prot: Vec<String> = [POISSON_A, POISSON_B, "MKTAWIAKERDEFGHVNPTW-M"].iter().map(|s| s.to_string()).collect();
    let note = |m: &str| format!("{m} does not apply to proteins: the Poisson correction was computed instead.");
    let mcl = "Maximum Composite Likelihood (MCL)";
    let cases: [(&str, &str, Option<String>); 4] = [
        (mcl, DIALOG_POISSON, Some(note(mcl))),
        ("Jukes-Cantor (JC69)", DIALOG_POISSON, Some(note("Jukes-Cantor (JC69)"))),
        ("p-distance", "p-distance", None),
        (DIALOG_POISSON, DIALOG_POISSON, None),
    ];
    let dna: Vec<String> =
        ["ACGTACGTACGTACGTACGT", "ACGTACGAACGTACGTTCGT", "ACGAACGTACGTACCTTCGT"].iter().map(|s| s.to_string()).collect();
    let mut all: Vec<(&[String], &str, &str, Option<String>)> =
        cases.iter().map(|(r, c, n)| (prot.as_slice(), *r, *c, n.clone())).collect();
    // A nucleotide alignment keeps the requested model's name and no note.
    all.push((dna.as_slice(), mcl, mcl, None));
    for (seqs, requested, computed, expected_note) in all {
        let dist = compute_evolutionary_distances(&names, seqs, requested, &[]);
        let div = compute_population_diversity(&names, seqs, requested, &[]);
        assert_eq!(div.model, computed, "{requested}: the diversity report names the distance computed");
        assert_eq!(div.model_note, expected_note, "{requested}: note");
        assert_eq!((div.model.as_str(), &div.model_note), (dist.model.as_str(), &dist.model_note), "{requested}: copied from the distance report");
        // The statistics are unchanged: pi_T is the distance report's overall mean.
        assert!(dist.overall_mean_distance.is_finite() && dist.overall_mean_distance > 0.0, "{requested}: a real distance");
        assert_eq!(div.entire_population_pi_t, dist.overall_mean_distance, "{requested}: pi_T unchanged");
        let json = serde_json::to_value(&div).unwrap();
        assert_eq!(json["model"], computed, "{requested}: JSON model");
        match &expected_note {
            Some(n) => assert_eq!(json["modelNote"], n.as_str(), "{requested}: JSON modelNote"),
            None => assert!(json.get("modelNote").is_none(), "{requested}: modelNote must be absent: {json}"),
        }
    }
    // Three distinct sequences: Hd = 3/2 * (1 - 3/9) = 1.
    assert_eq!(compute_population_diversity(&names, &prot, mcl, &[]).haplotype_diversity_hd, 1.0);

    // Copied, not re-derived: the diversity function makes one distance pass and states no protein rule.
    let src = include_str!("../src/distances.rs");
    let body = src.split("pub fn compute_population_diversity(").nth(1).expect("the diversity function");
    let body = &body[..body.find("\n}\n").expect("its end")];
    assert_eq!(body.matches("compute_evolutionary_distances(").count(), 1, "one distance pass");
    for rule in ["protein_distance_name", "does not apply", "is_nucleotide_alignment", "PROTEIN_"] {
        assert!(!body.contains(rule), "diversity must not restate the protein rule ({rule})");
    }
    assert_eq!(src.matches("does not apply to proteins").count(), 1, "one note in distances.rs");
}

/// BG-01M7MW0Z: the protein note was decided by an exact name, so 'p-distance (Uncorrected
/// Proportion)' computed and was labelled the p-distance yet carried a note saying the Poisson
/// correction was computed. The note now follows the one rule: only when the Poisson correction
/// was computed for a request not named 'Poisson correction' (in any case).
#[test]
fn protein_note_only_when_poisson_was_computed() {
    use molbiocraft_phylo::distances::{compute_population_diversity, protein_distance_name};
    let names: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
    let seqs: Vec<String> = [POISSON_A, POISSON_B].iter().map(|s| s.to_string()).collect();
    let note = |m: &str| format!("{m} does not apply to proteins: the Poisson correction was computed instead.");
    let cases: [(&str, &str, Option<String>, f64, f64); 6] = [
        ("p-distance (Uncorrected Proportion)", "p-distance", None, 0.25, 0.0968),
        ("P-DISTANCE (uncorrected)", "p-distance", None, 0.25, 0.0968),
        ("p-distance", "p-distance", None, 0.25, 0.0968),
        ("Jukes-Cantor (JC69)", DIALOG_POISSON, Some(note("Jukes-Cantor (JC69)")), 0.2877, 0.1291),
        (DIALOG_POISSON, DIALOG_POISSON, None, 0.2877, 0.1291),
        ("poisson CORRECTION", DIALOG_POISSON, None, 0.2877, 0.1291),
    ];
    for (requested, computed, expected_note, d, se) in cases {
        assert_eq!(protein_distance_name(requested), computed, "{requested}: the shared rule");
        let dist = compute_evolutionary_distances(&names, &seqs, requested, &[]);
        assert_eq!(dist.model, computed, "{requested}: distance report model");
        assert_eq!(dist.model_note, expected_note, "{requested}: distance report note");
        assert_eq!(dist.pairwise_matrix[1][0], d, "{requested}: distance");
        assert_eq!(dist.pairwise_matrix[0][1], se, "{requested}: SE");
        let div = compute_population_diversity(&names, &seqs, requested, &[]);
        assert_eq!(div.model, computed, "{requested}: diversity report model");
        assert_eq!(div.model_note, expected_note, "{requested}: diversity report note");
        assert_eq!(div.entire_population_pi_t, d, "{requested}: pi_T is the distance computed");
        for (which, json) in [("distances", serde_json::to_value(&dist).unwrap()), ("diversity", serde_json::to_value(&div).unwrap())] {
            assert_eq!(json["model"], computed, "{requested}: {which} JSON model");
            match &expected_note {
                Some(n) => assert_eq!(json["modelNote"], n.as_str(), "{requested}: {which} JSON modelNote"),
                None => assert!(json.get("modelNote").is_none(), "{requested}: {which} modelNote must be absent: {json}"),
            }
        }
    }
}

/// BG-01M7MW0Z: a direct call with a model check_distance_model refuses (HKY, GTR) labelled the
/// all-NaN protein matrix 'Poisson correction' with a note saying that distance was computed. A
/// refused model's report names the request and carries the refusal itself, on proteins and on
/// nucleotides, as the tree report does (trees.rs, "No tree: ... is not a distance model").
#[test]
fn refused_model_report_names_the_refusal_not_a_distance() {
    use molbiocraft_phylo::distances::{check_distance_model, compute_population_diversity};
    let names: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let prot: Vec<String> = [POISSON_A, POISSON_B, "MKTAWIAKERDEFGHVNPTW-M"].iter().map(|s| s.to_string()).collect();
    let dna: Vec<String> =
        ["ACGTACGTACGTACGTACGT", "ACGTACGAACGTACGTTCGT", "ACGAACGTACGTACCTTCGT"].iter().map(|s| s.to_string()).collect();
    for (kind, seqs) in [("protein", &prot), ("nucleotide", &dna)] {
        for requested in ["Hasegawa-Kishino-Yano (HKY85)", "General Time Reversible (GTR+G+I)"] {
            let refusal = check_distance_model(requested).expect_err("a refused model");
            let dist = compute_evolutionary_distances(&names, seqs, requested, &[]);
            assert_eq!(dist.model, requested, "{kind} {requested}: the report names the request verbatim");
            assert_eq!(dist.model_note.as_deref(), Some(refusal.as_str()), "{kind} {requested}: the note is the refusal");
            for (i, row) in dist.pairwise_matrix.iter().enumerate() {
                for (j, v) in row.iter().enumerate() {
                    if i != j {
                        assert!(v.is_nan(), "{kind} {requested}: entry {i},{j} must be NaN, got {v}");
                    }
                }
            }
            assert!(dist.overall_mean_distance.is_nan(), "{kind} {requested}: mean {}", dist.overall_mean_distance);
            let div = compute_population_diversity(&names, seqs, requested, &[]);
            assert_eq!(div.model, requested, "{kind} {requested}: diversity model");
            assert_eq!(div.model_note.as_deref(), Some(refusal.as_str()), "{kind} {requested}: diversity note");
            for (which, json) in [("distances", serde_json::to_value(&dist).unwrap()), ("diversity", serde_json::to_value(&div).unwrap())] {
                assert_eq!(json["model"], requested, "{kind} {requested}: {which} JSON model");
                assert_eq!(json["modelNote"], refusal.as_str(), "{kind} {requested}: {which} JSON modelNote");
                let label = json["model"].as_str().unwrap();
                assert!(label != "Poisson correction" && label != "p-distance", "{kind} {requested}: {which} labelled {label}");
                assert!(!json["modelNote"].as_str().unwrap().contains("was computed"), "{kind} {requested}: {which} note claims a distance");
            }
        }
    }
}
