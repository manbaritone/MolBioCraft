// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6P2HD (D0003, D0206): `construct_phylogenetic_tree` builds distance trees only. It used
//! to default to 'Maximum Likelihood (ML)' and answer that name, and each external program's name,
//! with a Neighbor-Joining tree carrying the requested name. Maximum Likelihood is built by
//! `ml_tree_search`, and FastTree, PhyML, RAxML and MrBayes run only through `runExternalTree`, so
//! the op refuses all five, and a request naming no algorithm gets Neighbor-Joining.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

const NAMES: [&str; 4] = ["a", "b", "c", "d"];
const DNA: [&str; 4] = [
    "ACGTACGTTGCAACGTAGCTAGCTAGGATCCAGTACGATCGA",
    "ACGTACGTTGCAACGTAGCTGGCTAGGATCCAGTACGATCGA",
    "ACGTTCGTTGCAACCTAGCTAGCTAGGATTCAGTACGATCGT",
    "ACCTACGATGCAACGTAGCTAGCAAGGATCCAGTTCGATCGA",
];
const EXTERNAL: [&str; 4] = ["FastTree (Approx-ML)", "PhyML (ML + SH-aLRT)", "RAxML (GTR+G Rapid ML)", "MrBayes (Bayesian MCMC)"];
const DISTANCE_TREES: [&str; 4] = ["Neighbor-Joining (NJ)", "UPGMA", "Minimum-Evolution (ME)", "Maximum Parsimony (MP)"];

fn payload(algorithm: Option<&str>) -> Value {
    let mut p = json!({ "names": NAMES, "alignedSeqs": DNA, "model": "Tamura-Nei (TN93)", "bootstrapReplicates": 0 });
    if let Some(a) = algorithm {
        p["algorithm"] = json!(a);
    }
    p
}

#[test]
fn tree_op_rejects_ml_and_defaults_to_nj() {
    // Maximum Likelihood: refused, pointing to the op that builds it.
    let err = dispatch_bio_rpc("construct_phylogenetic_tree", payload(Some("Maximum Likelihood (ML)")))
        .expect_err("the op refuses Maximum Likelihood rather than answer it with a Neighbor-Joining tree");
    assert!(err.contains("ml_tree_search"), "the refusal names ml_tree_search: {err}");
    assert!(err.contains("Maximum Likelihood"), "the refusal names the method it refuses: {err}");

    // Each external program: refused, naming the program and the path that runs it.
    for algorithm in EXTERNAL {
        let err = dispatch_bio_rpc("construct_phylogenetic_tree", payload(Some(algorithm)))
            .expect_err(&format!("the op refuses {algorithm} rather than answer it with a Neighbor-Joining tree"));
        assert!(err.contains(algorithm), "the refusal names {algorithm}: {err}");
        assert!(err.contains("runExternalTree"), "{algorithm}: the refusal names runExternalTree: {err}");
        assert!(!err.contains("ml_tree_search"), "{algorithm}: an external program is not sent to ml_tree_search: {err}");
    }

    // No algorithm: Neighbor-Joining, named as such, with Neighbor-Joining's own method note.
    let r = dispatch_bio_rpc("construct_phylogenetic_tree", payload(None)).expect("a request naming no algorithm builds a tree");
    assert_eq!(r["algorithm"], json!("Neighbor-Joining (NJ)"), "the default is Neighbor-Joining");
    let note = r["methodNote"].as_str().unwrap_or_default();
    assert!(note.starts_with("Neighbor-Joining (Saitou & Nei 1987)"), "the default's note is Neighbor-Joining's: {note}");
    assert!(!note.contains("is not run here"), "the default is not a method the op does not run: {note}");
    let nj = dispatch_bio_rpc("construct_phylogenetic_tree", payload(Some("Neighbor-Joining (NJ)"))).unwrap();
    assert_eq!(r["newick"], nj["newick"], "the default draws the Neighbor-Joining tree");

    // The distance trees the op does build are still built, under their own names.
    for algorithm in DISTANCE_TREES {
        let r = dispatch_bio_rpc("construct_phylogenetic_tree", payload(Some(algorithm)))
            .unwrap_or_else(|e| panic!("{algorithm} is a distance tree the op builds: {e}"));
        assert_eq!(r["algorithm"], json!(algorithm));
        assert_ne!(r["newick"], json!("();"), "{algorithm}: a tree is built");
    }
}

#[test]
fn the_tree_function_builds_no_tree_under_a_refused_name() {
    // A Rust caller of the function behind the op gets no tree under a refused name either: the
    // empty tree, with the op's refusal as its only warning.
    use molbiocraft_phylo::construct_phylogenetic_tree;
    let names: Vec<String> = NAMES.iter().map(|s| s.to_string()).collect();
    let seqs: Vec<String> = DNA.iter().map(|s| s.to_string()).collect();
    for algorithm in std::iter::once("Maximum Likelihood (ML)").chain(EXTERNAL) {
        let refusal = dispatch_bio_rpc("construct_phylogenetic_tree", payload(Some(algorithm))).unwrap_err();
        let r = construct_phylogenetic_tree(&names, &seqs, algorithm, "Tamura-Nei (TN93)", 100);
        assert_eq!(r.newick, "();", "{algorithm}: no tree");
        assert_eq!(r.warnings, vec![refusal], "{algorithm}: the refusal is the only warning");
        assert!(r.clade_bootstraps.is_empty() && r.log_likelihood.is_nan(), "{algorithm}: no support and no lnL");
    }
}
