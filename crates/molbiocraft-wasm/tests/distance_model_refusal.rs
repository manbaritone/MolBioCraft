// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! HKY85 and GTR leave the distance-model list (US-01M6P2HY, D0003). They used to be computed as
//! the TN93 distance under their own names; deleting that mapping alone would have sent them to
//! the p-distance (an unknown name's fallback). Every distance entry point a saved option profile
//! or workflow step can reach must therefore refuse them loudly and point to the Maximum
//! Likelihood tree, which fits HKY and GTR, while TN93 keeps returning the matrix it returned.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

const REFUSED: [&str; 4] = ["Hasegawa-Kishino-Yano (HKY85)", "General Time Reversible (GTR+G+I)", "HKY", "GTR"];
const SUPPORTED: [&str; 6] = [
    "p-distance",
    "Jukes-Cantor (JC69)",
    "Kimura 2-parameter (K2P)",
    "Tamura 3-parameter (T92)",
    "Tamura-Nei (TN93)",
    "Maximum Composite Likelihood (MCL)",
];

const NAMES: [&str; 4] = ["a", "b", "c", "d"];
const DNA: [&str; 4] = [
    "ACGTACGTTGCAACGTAGCTAGCTAGGATCCAGTACGATCGA",
    "ACGTACGTTGCAACGTAGCTGGCTAGGATCCAGTACGATCGA",
    "ACGTTCGTTGCAACCTAGCTAGCTAGGATTCAGTACGATCGT",
    "ACCTACGATGCAACGTAGCTAGCAAGGATCCAGTTCGATCGA",
];
const PROTEIN: [&str; 4] = ["MKLVWEQRSTFHPAG", "MKLVWEQRSTFHPAN", "MKIVWEQRDTFHPAG", "MRLVWEQKSTYHPAG"];

/// The TN93 matrix this fixture returned at 1cea010, before the change (lower triangle distances,
/// upper triangle standard errors).
const TN93_MATRIX: [[f64; 4]; 4] = [
    [0.0, 0.0259, 0.053, 0.053],
    [0.0249, 0.0, 0.0595, 0.0602],
    [0.1029, 0.1298, 0.0, 0.0844],
    [0.1029, 0.1305, 0.2235, 0.0],
];

fn payload(seqs: &[&str], model: &str) -> Value {
    json!({ "names": NAMES, "alignedSeqs": seqs, "model": model })
}

fn assert_refusal(err: &str, model: &str) {
    assert!(err.contains(&format!("'{model}'")), "the error names the requested model {model}: {err}");
    for s in SUPPORTED {
        assert!(err.contains(s), "the error names the supported distance model {s}: {err}");
    }
    assert!(
        err.contains("HKY and GTR are fitted by the Maximum Likelihood tree"),
        "the error points HKY and GTR to the Maximum Likelihood tree: {err}"
    );
}

fn matrix(v: &Value) -> Vec<Vec<f64>> {
    serde_json::from_value(v["pairwiseMatrix"].clone()).expect("pairwiseMatrix")
}

#[test]
fn the_distances_op_refuses_hky_and_gtr_for_dna_and_protein() {
    for seqs in [&DNA[..], &PROTEIN[..]] {
        for model in REFUSED {
            match dispatch_bio_rpc("compute_evolutionary_distances", payload(seqs, model)) {
                Ok(v) => panic!("{model} must be refused, not answered with {}", v["pairwiseMatrix"]),
                Err(e) => assert_refusal(&e, model),
            }
        }
    }
}

#[test]
fn any_name_holding_hky_or_gtr_is_refused_not_sent_to_the_p_distance() {
    // An unknown name falls back to the p-distance, so a refusal by exact name would let these through.
    for model in ["HKY+G", "GTR+G", "Hasegawa-Kishino-Yano (HKY)", "General Time Reversible (GTR)"] {
        match dispatch_bio_rpc("compute_evolutionary_distances", payload(&DNA, model)) {
            Ok(v) => panic!("{model} must be refused, not answered with {}", v["pairwiseMatrix"]),
            Err(e) => assert_refusal(&e, model),
        }
    }
}

#[test]
fn the_diversity_op_refuses_hky_and_gtr() {
    for seqs in [&DNA[..], &PROTEIN[..]] {
        for model in REFUSED {
            let mut p = payload(seqs, model);
            p["groups"] = json!(["x", "x", "y", "y"]);
            match dispatch_bio_rpc("compute_population_diversity", p) {
                Ok(v) => panic!("{model} must be refused, not answered with {v}"),
                Err(e) => assert_refusal(&e, model),
            }
        }
    }
}

#[test]
fn the_tree_op_returns_the_empty_tree_with_the_refusal_as_its_only_warning() {
    let algorithms = ["Neighbor-Joining (NJ)", "UPGMA", "Minimum-Evolution (ME)", "Maximum Parsimony (MP)"];
    for model in REFUSED {
        let same = dispatch_bio_rpc("compute_evolutionary_distances", payload(&DNA, model)).unwrap_err();
        for algorithm in algorithms {
            for (reps, jack) in [(0, 0.0), (100, 0.0), (100, 50.0)] {
                let mut p = payload(&DNA, model);
                p["algorithm"] = json!(algorithm);
                p["bootstrapReplicates"] = json!(reps);
                p["jackknifePct"] = json!(jack);
                let r = dispatch_bio_rpc("construct_phylogenetic_tree", p).expect("the tree op reports, it does not throw");
                assert_eq!(r["newick"], json!("();"), "{model} / {algorithm}: no tree is built");
                let warnings: Vec<String> = serde_json::from_value(r["warnings"].clone()).unwrap();
                assert_eq!(warnings, vec![same.clone()], "{model} / {algorithm}: the refusal is the only warning");
            }
        }
        // A one-sequence request meets the refusal too, not the two-sequence note with no warning.
        let one = json!({ "names": ["a"], "alignedSeqs": [DNA[0]], "algorithm": "Neighbor-Joining (NJ)", "model": model });
        let r = dispatch_bio_rpc("construct_phylogenetic_tree", one).unwrap();
        assert_eq!(r["warnings"], json!([same]), "{model}: refused before any other check");
    }
}

#[test]
fn tn93_and_mcl_still_return_todays_matrix_and_tree() {
    for model in ["Tamura-Nei (TN93)", "Maximum Composite Likelihood (MCL)"] {
        let v = dispatch_bio_rpc("compute_evolutionary_distances", payload(&DNA, model)).expect("TN93 is supported");
        assert_eq!(matrix(&v), TN93_MATRIX.iter().map(|r| r.to_vec()).collect::<Vec<_>>(), "{model}");
        let d = dispatch_bio_rpc("compute_population_diversity", payload(&DNA, model));
        assert!(d.is_ok(), "{model}: diversity still answers");
    }
    let mut p = payload(&DNA, "Tamura-Nei (TN93)");
    p["algorithm"] = json!("Neighbor-Joining (NJ)");
    p["bootstrapReplicates"] = json!(0);
    let r = dispatch_bio_rpc("construct_phylogenetic_tree", p).unwrap();
    assert_eq!(r["newick"], json!("((a:0.00000,(b:0.02215,c:0.10765):0.00000):0.00017,d:0.10783);"));
    assert_eq!(r["warnings"], json!([]));
}

#[test]
fn the_pair_distance_never_answers_a_refused_model_with_a_tn93_or_p_distance_value() {
    use molbiocraft_phylo::distances::pair_distance_and_se;
    for model in REFUSED {
        for (a, b, protein) in [(DNA[0], DNA[2], false), (PROTEIN[0], PROTEIN[2], true)] {
            let (d, se) = pair_distance_and_se(a, b, model, protein);
            assert!(d.is_nan() && se.is_nan(), "{model} (protein {protein}): got {d} / {se}");
        }
    }
    let (d, _) = pair_distance_and_se(DNA[0], DNA[2], "Tamura-Nei (TN93)", false);
    assert!(d.is_finite() && d > 0.0);
}

#[test]
fn the_maximum_likelihood_tree_still_fits_hky_and_gtr() {
    for model in ["HKY", "HKY+G", "GTR", "GTR+G+I"] {
        let v = dispatch_bio_rpc("ml_tree_search", payload(&DNA, model)).unwrap_or_else(|e| panic!("{model}: {e}"));
        assert!(v["newick"].as_str().unwrap().contains('a'), "{model}: a tree");
        assert!(v["model"].as_str().unwrap().starts_with(&model[..3]), "{model}: fitted as {}", v["model"]);
    }
}
