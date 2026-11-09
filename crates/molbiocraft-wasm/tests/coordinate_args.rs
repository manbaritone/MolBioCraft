// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Coordinate arguments are no longer capped at 50,000,000 (that clamp moved
//! requests past 50 Mbp to the wrong region). Every operation that takes a
//! coordinate must therefore bound it itself: out-of-range coordinates may be
//! refused or clamped, but must never panic (a panic aborts the WASM engine).

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::json;

#[test]
fn out_of_range_coordinates_never_panic() {
    let lib = dispatch_bio_rpc("get_sample_library", json!({})).expect("sample library");
    let doc = lib[0].clone();
    let seq = doc["sequence"].as_str().unwrap().to_string();
    let features = doc["features"].clone();
    for huge in [60_000_000u64, 4_000_000_000u64, 1_000_000_000_000u64, u64::MAX - 1] {
        let coords = json!({
            "startPos": huge, "endPos": huge.saturating_add(1200), "positionBp": huge, "positionAa": huge,
            "insertionSiteBp": huge, "startBp": huge, "endBp": huge.saturating_add(10),
            "start1Based": huge, "end1Based": huge.saturating_add(10), "regionStart": huge, "regionEnd": huge.saturating_add(500),
            "newOrigin1Based": huge, "baseOffset": huge, "frameOffset": huge,
        });
        let ops = [
            "slice_genome_viewport",
            "query_features_in_viewport",
            "diagnose_missense_mutation",
            "translate_sequence",
            "design_pcr_primers",
            "simulate_mutagenesis",
            "set_circular_origin",
            "audit_twist_onboarding",
            "simulate_twist_clonal_insertion",
            "extract_region_with_annotations_rust",
        ];
        for op in ops {
            let mut payload = coords.clone();
            let obj = payload.as_object_mut().unwrap();
            obj.insert("doc".into(), doc.clone());
            obj.insert("seq".into(), json!(seq));
            obj.insert("dna".into(), json!(seq));
            obj.insert("features".into(), features.clone());
            let result = std::panic::catch_unwind(|| dispatch_bio_rpc(op, payload.clone()));
            assert!(result.is_ok(), "{op} panicked with coordinate {huge}");
        }
    }
}

#[test]
fn float_and_maximal_coordinates_do_not_overflow_the_viewport_query() {
    let lib = dispatch_bio_rpc("get_sample_library", json!({})).expect("sample library");
    let features = lib[0]["features"].clone();
    for end in [json!(1e20), json!(1e300), json!(u64::MAX)] {
        let r = std::panic::catch_unwind(|| {
            dispatch_bio_rpc(
                "query_features_in_viewport",
                json!({ "features": features, "startBp": 1, "endBp": end }),
            )
        });
        assert!(r.is_ok(), "query_features_in_viewport panicked for endBp={end}");
    }
}
