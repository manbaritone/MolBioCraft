// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6P2JB through the RPC dispatcher (the WASM, IPC and REST contract): an engine op stamps
//! the document it makes or edits with the caller's `nowIso`, never a fixed date. A creator gives
//! `createdAt` and `updatedAt` = `nowIso` and its new history entry the minute "YYYY-MM-DD HH:MM";
//! an edit keeps the input's `createdAt`. Called without `nowIso`, every one of those fields is
//! the empty string (D0203), never a fabricated date.
//!
//! Every expected value is written here from the fixture, never read from the op.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

const NOW: &str = "2027-01-02T03:04:05.000Z";
const NOW_MINUTE: &str = "2027-01-02 03:04";
/// The input documents' own dates, which no creator may copy and no edit may lose.
const INPUT_CREATED: &str = "2025-05-05T05:05:05.000Z";
const INPUT_UPDATED: &str = "2025-06-06T06:06:06.000Z";
const INPUT_HISTORY: &str = "2025-05-05 05:05";

/// One EcoRI site (G^AATTC after base 21) and one XhoI site, as custom_enzyme_cloning.rs uses.
const VEC: &str = "ACGTTGCAAGCTAGCTTACGGAATTCAAAACTCGAGTTGACCATGCATGCAGTTACCGGA";
const INS: &str = "GGGAATTCATGAAAGGGTTTTAACTCGAGCC";

fn doc(id: &str, sequence: &str, topology: &str) -> Value {
    json!({
        "id": id, "name": id, "accession": "", "description": "", "moleculeType": "DNA",
        "topology": topology, "sequence": sequence, "features": [], "primers": [],
        "history": [{ "id": format!("h-{id}"), "timestamp": INPUT_HISTORY, "operation": "Imported",
                      "description": "", "parentIds": [], "lengthBp": sequence.len(), "topology": topology }],
        "createdAt": INPUT_CREATED, "updatedAt": INPUT_UPDATED, "folder": ""
    })
}

/// The studio's initial Modular Vector Architect state (VectorLibraryAndDesignStudio.tsx:88-103).
fn spec() -> Value {
    json!({
        "vectorName": "pMBC-EF1A-3xFLAG-mScarlet3-P2A-Puro", "systemGuideId": "sys-plv-exp",
        "promoterPartId": "prom-ef1a", "signalOrInitPartId": "sig-kozak", "nTagPartId": "tag-3xflag",
        "proteasePartId": "prot-tev", "cargoMode": "part", "cargoPartId": "orf-mscarlet3",
        "linker2APartId": "lnk-p2a", "eukaryoticMarkerPartId": "sel-puror", "regulatoryWprePartId": "reg-wpre",
        "polyAOrTermPartId": "reg-bghpa", "originPartId": "ori-puc", "bacterialMarkerPartId": "sel-ampr"
    })
}

fn call(op: &str, mut payload: Value, now: Option<&str>) -> Value {
    if let Some(n) = now {
        payload["nowIso"] = json!(n);
    }
    dispatch_bio_rpc(op, payload).unwrap_or_else(|e| panic!("{op}: {e}"))
}

/// The document each op returns, under the key its reply puts it.
fn made(op: &str, now: Option<&str>) -> Value {
    match op {
        "simulate_molecular_cloning" => {
            let out = call(
                op,
                json!({ "vectorDoc": doc("vec", VEC, "circular"), "insertDoc": doc("ins", INS, "linear"),
                        "method": "Restriction Ligation", "enzyme5Prime": "EcoRI", "enzyme3Prime": "XhoI",
                        "goldenGateEnzyme": "" }),
                now,
            );
            assert_eq!(out["success"], json!(true), "the fixture clones: {out}");
            out["constructDocument"].clone()
        }
        "concatenate_documents" => call(
            op,
            json!({ "docs": [doc("a", "ATGCATGCATGC", "linear"), doc("b", "GGGCCCAAATTT", "linear")], "spacer": "" }),
            now,
        ),
        "assemble_modular_custom_vector" => call(op, json!({ "spec": spec() }), now)["document"].clone(),
        "mask_sequence_regions" => call(
            op,
            json!({ "doc": doc("m", "ACGTACGTACGTACGTACGT", "linear"), "mode": "selection",
                    "range": { "start": 3, "end": 8 } }),
            now,
        )["updated"]
            .clone(),
        other => panic!("no fixture for {other}"),
    }
}

/// The history entry the op added: the last one, which no input carries.
fn new_entry(d: &Value) -> &Value {
    let last = d["history"].as_array().and_then(|h| h.last()).expect("a history entry");
    assert_ne!(last["timestamp"], json!(INPUT_HISTORY), "the op added an entry: {last}");
    last
}

#[test]
fn results_use_the_callers_timestamp() {
    for op in ["simulate_molecular_cloning", "concatenate_documents", "assemble_modular_custom_vector"] {
        let d = made(op, Some(NOW));
        assert_eq!(d["createdAt"], json!(NOW), "{op} createdAt");
        assert_eq!(d["updatedAt"], json!(NOW), "{op} updatedAt");
        assert_eq!(new_entry(&d)["timestamp"], json!(NOW_MINUTE), "{op} new history timestamp");

        let bare = made(op, None);
        assert_eq!(bare["createdAt"], json!(""), "{op} without nowIso: createdAt (D0203)");
        assert_eq!(bare["updatedAt"], json!(""), "{op} without nowIso: updatedAt (D0203)");
        let last = bare["history"].as_array().and_then(|h| h.last()).expect("a history entry");
        assert_eq!(last["timestamp"], json!(""), "{op} without nowIso: new history timestamp (D0203)");
    }

    // An edit keeps the input's creation date and its older history, and restamps only the rest.
    let op = "mask_sequence_regions";
    let d = made(op, Some(NOW));
    assert_eq!(d["createdAt"], json!(INPUT_CREATED), "{op} keeps the input's createdAt");
    assert_eq!(d["updatedAt"], json!(NOW), "{op} updatedAt");
    assert_eq!(d["history"][0]["timestamp"], json!(INPUT_HISTORY), "{op} keeps older history");
    assert_eq!(new_entry(&d)["timestamp"], json!(NOW_MINUTE), "{op} new history timestamp");

    let bare = made(op, None);
    assert_eq!(bare["createdAt"], json!(INPUT_CREATED), "{op} without nowIso keeps createdAt");
    assert_eq!(bare["updatedAt"], json!(""), "{op} without nowIso: updatedAt (D0203)");
    let last = bare["history"].as_array().and_then(|h| h.last()).expect("a history entry");
    assert_eq!(last["timestamp"], json!(""), "{op} without nowIso: new history timestamp (D0203)");
}

/// The LOCUS line's date, its last field.
fn locus_dates(genbank: &str) -> Vec<String> {
    genbank
        .lines()
        .filter(|l| l.starts_with("LOCUS"))
        .map(|l| l.split_whitespace().last().unwrap_or_default().to_string())
        .collect()
}

/// R4 / D0200: the lineage bundle is an export, so every record carries the export date the caller
/// sends. Without one, a record falls back to the undated export's date: its own `updatedAt` when it
/// parses, else 01-JAN-1970 - which is what a document made by an op called without `nowIso`
/// (D0203, blank dates) writes.
#[test]
fn lineage_bundle_is_dated_by_the_export() {
    let parent = doc("a", "ATGCATGCATGC", "linear"); // one of the concatenation's inputs
    let child = made("concatenate_documents", None);
    assert_eq!(child["updatedAt"], json!(""));
    let payload = json!({ "targetDoc": child, "allDocs": [parent, child] });

    let dated = call("export_lineage_bundle_genbank", payload.clone(), Some(NOW));
    assert_eq!(locus_dates(dated["content"].as_str().unwrap()), ["02-JAN-2027", "02-JAN-2027"]);

    let undated = call("export_lineage_bundle_genbank", payload, None);
    assert_eq!(locus_dates(undated["content"].as_str().unwrap()), ["06-JUN-2025", "01-JAN-1970"]);
}
