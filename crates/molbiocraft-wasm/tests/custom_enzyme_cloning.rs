// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7HRV4 through the RPC dispatcher (the WASM, IPC and REST contract): `simulate_molecular_cloning`
//! keeps its name, its reply and its three enzyme fields and takes ONE optional key, `customEnzymes`
//! (D0153). With the key absent the op is what it is today; with it, an enzyme field's `custom:` id
//! is the definition sent under it, and a NAME is still never matched against those definitions.
//!
//! Every expected value is written here from the fixture's construction, never read from the op.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

/// Poly-A filler: it holds no motif below, no reverse complement of one, and no Dam, Dcm or CpG
/// context, so no site planted beside it is methylation-blocked.
fn fill(n: usize) -> String {
    "A".repeat(n)
}

fn doc(id: &str, sequence: &str, topology: &str) -> Value {
    json!({
        "id": id, "name": id, "accession": "", "description": "", "moleculeType": "DNA",
        "topology": topology, "sequence": sequence, "features": [], "primers": [],
        "history": [], "createdAt": "", "updatedAt": "", "folder": ""
    })
}

/// Adaeze's own "EcoRI": the built-in's name over another motif and other offsets (5' TGGT).
fn mine() -> Value {
    json!({ "id": "custom:mine", "source": "custom", "name": "EcoRI", "recognitionSeq": "TGGTGGTGA", "cutFwd": 3, "cutRev": 7,
            "suppliers": [], "methylationSensitivity": [], "bufferNEB": "", "tempC": 37, "provenance": "", "notes": "" })
}

/// A Type IIS definition of Adaeze's own, for the Golden Gate call site.
fn mine_iis() -> Value {
    json!({ "id": "custom:iis", "source": "custom", "name": "AdaIIS", "recognitionSeq": "TGGTGGTGA", "cutFwd": 5, "cutRev": 9,
            "isTypeIIS": true, "suppliers": [], "methylationSensitivity": [], "bufferNEB": "", "tempC": 37, "provenance": "", "notes": "" })
}

/// The vector of the catalogue pins: one EcoRI site (G^AATTC after base 21), one XhoI site.
const VEC: &str = "ACGTTGCAAGCTAGCTTACGGAATTCAAAACTCGAGTTGACCATGCATGCAGTTACCGGA";
const INS: &str = "GGGAATTCATGAAAGGGTTTTAACTCGAGCC";

/// The op with `customEnzymes` left out, exactly as every shipped caller sent it before this story.
fn clone_bare(v: &Value, i: &Value, method: &str, e5: &str, e3: &str, gg: &str) -> Value {
    dispatch_bio_rpc(
        "simulate_molecular_cloning",
        json!({ "vectorDoc": v, "insertDoc": i, "method": method, "enzyme5Prime": e5, "enzyme3Prime": e3, "goldenGateEnzyme": gg }),
    )
    .expect("simulate_molecular_cloning")
}

/// The op with the new key.
fn clone_with(v: &Value, i: &Value, method: &str, e5: &str, e3: &str, gg: &str, defs: Value) -> Value {
    dispatch_bio_rpc(
        "simulate_molecular_cloning",
        json!({ "vectorDoc": v, "insertDoc": i, "method": method, "enzyme5Prime": e5, "enzyme3Prime": e3,
                "goldenGateEnzyme": gg, "customEnzymes": defs }),
    )
    .expect("simulate_molecular_cloning")
}

/// The reply's own fields, as the UI reads them.
fn shape(r: &Value) -> (bool, String, String, String, String, Vec<String>) {
    (
        r["success"].as_bool().expect("success"),
        r["summary"].as_str().unwrap().to_string(),
        r["constructDocument"]["sequence"].as_str().unwrap().to_string(),
        r["overhangOrHomologyLeft"].as_str().unwrap().to_string(),
        r["overhangOrHomologyRight"].as_str().unwrap().to_string(),
        r["warnings"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()).collect(),
    )
}

/// The op takes the key and resolves a `custom:` id against what it holds, and the reply keeps its
/// shape: a definition's own sites, overhangs and marked labels come back through the dispatcher.
#[test]
fn us_01m7hrv4_ac2_rpc_resolves_a_custom_id_against_the_sent_definitions() {
    // One `mine` site (top cut after base 33) and one built-in EcoRI site (after base 31) in 105 bp;
    // the backbone is the 67 bp outside them, the insert's released fragment 28 bp.
    let v = doc("pTwin", &format!("{}GAATTC{}TGGTGGTGA{}", fill(30), fill(30), fill(30)), "circular");
    let i = doc("iTwin", &format!("{}GAATTC{}TGGTGGTGA{}", fill(20), fill(20), fill(20)), "linear");
    let r = clone_with(&v, &i, "Restriction Ligation", "EcoRI", "custom:mine", "", json!([mine()]));
    let (ok, summary, seq, left, right, warnings) = shape(&r);
    assert!(ok, "{summary} {warnings:?}");
    assert_eq!(seq.len(), 67 + 28);
    assert_eq!(left, "EcoRI 5'-AATT-3' (5prime)");
    assert_eq!(right, "EcoRI (custom) 5'-TGGT-3' (5prime)");
    assert_eq!(
        summary,
        "EcoRI/EcoRI (custom)-cut insert (28 bp) ligated into the EcoRI/EcoRI (custom)-opened pTwin backbone (67 bp): 95 bp circular construct."
    );
    assert!(!warnings.iter().any(|w| w.contains("Single-enzyme")), "{warnings:?}");
    // The reply's keys are the ones it had.
    assert_eq!(r["method"].as_str(), Some("Restriction Ligation"));
    assert!(r.get("unresolvedEnzymes").is_none(), "the reply gained no key");
}

/// With the key absent, or sent as JSON null, the op is today's op; with definitions sent, a NAME
/// still never matches one, and an unknown name is still unknown.
#[test]
fn us_01m7hrv4_ac2_rpc_the_by_name_path_is_untouched() {
    let v = doc("pVec", VEC, "circular");
    let i = doc("pIns", INS, "linear");
    let bare = clone_bare(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "");
    let (ok, summary, seq, left, _r, _w) = shape(&bare);
    assert!(ok, "{summary}");
    assert_eq!(seq, format!("{}{}{}", &VEC[..21], "AATTCATGAAAGGGTTTTAAC", &VEC[31..]));
    assert_eq!(left, "EcoRI 5'-AATT-3' (5prime)");
    assert_eq!(
        summary,
        "EcoRI/XhoI-cut insert (21 bp) ligated into the EcoRI/XhoI-opened pVec backbone (50 bp): 71 bp circular construct."
    );
    // Null, and a same-named definition sent: the same reply, byte for byte.
    assert_eq!(shape(&clone_with(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "", Value::Null)), shape(&bare));
    assert_eq!(shape(&clone_with(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "", json!([mine()]))), shape(&bare));

    let unknown = clone_with(&v, &i, "Restriction Ligation", "NotARealEnzyme", "XhoI", "", json!([mine()]));
    assert_eq!(unknown["warnings"][0].as_str(), Some("Unknown enzyme \"NotARealEnzyme\"."));
}

/// A `custom:` id the sent definitions do not hold fails naming that id, and is never the built-in
/// of the definition's name.
#[test]
fn us_01m7hrv4_ac2_rpc_a_custom_id_with_no_definition_fails_by_its_id() {
    let v = doc("pVec", VEC, "circular");
    let i = doc("pIns", INS, "linear");
    for defs in [Value::Null, json!([]), json!([mine()])] {
        let r = clone_with(&v, &i, "Restriction Ligation", "custom:gone", "XhoI", "", defs.clone());
        assert_eq!(r["success"].as_bool(), Some(false), "{defs}");
        assert_eq!(r["warnings"][0].as_str(), Some("Unknown enzyme \"custom:gone\"."), "{defs}");
        assert_eq!(r["constructDocument"]["sequence"].as_str(), Some(VEC), "{defs}");
    }
}

/// Golden Gate's enzyme field takes a `custom:` id too, and its messages name the definition.
#[test]
fn us_01m7hrv4_ac2_rpc_a_custom_type_iis_id_is_resolved_for_golden_gate() {
    let v = doc("pIIS", &format!("{}TGGTGGTGA{}TGGTGGTGA{}TGGTGGTGA{}", fill(20), fill(20), fill(20), fill(20)), "circular");
    let i = doc("pPart", &format!("{}TGGTGGTGA{}", fill(10), fill(10)), "linear");
    let r = clone_with(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis", json!([mine_iis()]));
    assert_eq!(r["success"].as_bool(), Some(false));
    assert_eq!(
        r["warnings"][0].as_str(),
        Some("The vector has 3 AdaIIS (custom) sites; Golden Gate needs exactly two.")
    );
    // Without the definition the id is unknown, so that count came from the definition.
    assert_eq!(
        clone_bare(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis")["warnings"][0].as_str(),
        Some("Unknown enzyme \"custom:iis\".")
    );
}
