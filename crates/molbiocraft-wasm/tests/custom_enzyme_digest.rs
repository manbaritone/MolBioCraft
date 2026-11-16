// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7DVD5 through the RPC dispatcher (the WASM, IPC and REST contract): the digest by id,
//! `simulate_enzyme_digest`, names every selected enzyme it cannot use and is never the uncut
//! molecule then; the digest by name, `simulate_restriction_digest`, replies exactly as before.
//!
//! Expected fragments are written from each fixture's construction, never read from either op.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

/// C filler: no site below (each motif, and its reverse complement, holds an A, G or T beside
/// another letter) is found in it or across its junction with a planted motif.
fn fill(n: usize) -> String {
    "C".repeat(n)
}

fn doc(id: &str, sequence: &str, topology: &str) -> Value {
    json!({
        "id": id, "name": id, "accession": "", "description": "", "moleculeType": "DNA",
        "topology": topology, "sequence": sequence, "features": [], "primers": [],
        "history": [], "createdAt": "", "updatedAt": "", "folder": ""
    })
}

fn by_id(d: &Value, selection: Value) -> Value {
    dispatch_bio_rpc("simulate_enzyme_digest", json!({ "doc": d, "selection": selection })).expect("simulate_enzyme_digest")
}

fn by_name(d: &Value, names: &[&str]) -> Value {
    dispatch_bio_rpc("simulate_restriction_digest", json!({ "doc": d, "selectedEnzymeNames": names }))
        .expect("simulate_restriction_digest")
}

/// Adaeze's own "EcoRI": another motif and other offsets, under the built-in's name.
fn mine() -> Value {
    json!({ "id": "custom:mine", "source": "custom", "name": "EcoRI", "recognitionSeq": "TGGTGGTGA", "cutFwd": 3, "cutRev": 7,
            "suppliers": [], "methylationSensitivity": [], "bufferNEB": "", "tempC": 37, "provenance": "", "notes": "" })
}

/// A 300 bp circle: the built-in EcoRI's GAATTC at 51..56 and 201..206, the custom "EcoRI"'s motif
/// at 121..129 (its top cut 3 bases in, before base 124).
fn twin_circle() -> Value {
    let seq = format!("{}GAATTC{}TGGTGGTGA{}GAATTC{}", fill(50), fill(64), fill(71), fill(94));
    assert_eq!(seq.len(), 300);
    doc("twin", &seq, "circular")
}

/// (start, end, lengthBp, leftEnzyme, rightEnzyme) of each fragment.
fn spans(reply: &Value) -> Vec<(u64, u64, u64, String, String)> {
    reply.as_array().expect("fragments").iter()
        .map(|f| (f["start"].as_u64().unwrap(), f["end"].as_u64().unwrap(), f["lengthBp"].as_u64().unwrap(),
                  f["leftEnzyme"].as_str().unwrap().to_string(), f["rightEnzyme"].as_str().unwrap().to_string()))
        .collect()
}

fn kinds(reply: &Value) -> Vec<(String, String)> {
    reply["unresolvedEnzymes"].as_array().unwrap().iter()
        .map(|u| (u["name"].as_str().unwrap().to_string(), u["kind"].as_str().unwrap().to_string()))
        .collect()
}

#[test]
fn us_01m7dvd5_ac2_the_custom_twin_cuts_at_its_own_site_and_its_ends_carry_its_id_and_source() {
    let r = by_id(&twin_circle(), json!([mine()]));
    assert_eq!(r["complete"], json!(true));
    assert_eq!(r["unresolvedEnzymes"], json!([]));
    // One cut, before base 124: one fragment of the whole circle, 124..123, never the built-in's two.
    assert_eq!(spans(&r["fragments"]), vec![(124, 123, 300, "EcoRI".into(), "EcoRI".into())]);
    let f = &r["fragments"][0];
    assert_eq!((f["leftEnzymeId"].clone(), f["leftEnzymeSource"].clone()), (json!("custom:mine"), json!("custom")));
    assert_eq!((f["rightEnzymeId"].clone(), f["rightEnzymeSource"].clone()), (json!("custom:mine"), json!("custom")));
    assert_eq!((f["leftOverhang"].clone(), f["leftOverhangType"].clone()), (json!("TGGT"), json!("5prime")));

    // The built-in by its id: its two sites, and ends with no id or source key at all.
    let b = by_id(&twin_circle(), json!(["EcoRI"]));
    assert_eq!(spans(&b["fragments"]), vec![(52, 201, 150, "EcoRI".into(), "EcoRI".into()), (202, 51, 150, "EcoRI".into(), "EcoRI".into())]);
    for f in b["fragments"].as_array().unwrap() {
        for key in ["leftEnzymeId", "leftEnzymeSource", "rightEnzymeId", "rightEnzymeSource"] {
            assert!(f.get(key).is_none(), "a built-in end has no {key}");
        }
    }
}

#[test]
fn us_01m7dvd5_ac2_every_enzyme_it_cannot_resolve_is_listed_with_its_name_and_reason_and_the_digest_is_not_complete() {
    let d = twin_circle();
    // An id the catalogue does not hold, beside one it does: EcoRI still cuts, the digest says what it left out.
    let r = by_id(&d, json!(["EcoRI", "NoSuchI"]));
    assert_eq!(r["complete"], json!(false));
    assert_eq!(kinds(&r), vec![("NoSuchI".to_string(), "unknownId".to_string())]);
    assert!(r["unresolvedEnzymes"][0]["reason"].as_str().unwrap().contains("NoSuchI"));
    assert_eq!(r["fragments"].as_array().unwrap().len(), 2);

    // Unresolved and nothing cut: no fragments, never the single uncut molecule.
    let r = by_id(&d, json!(["NoSuchI"]));
    assert_eq!((r["complete"].clone(), r["fragments"].clone()), (json!(false), json!([])));

    // A definition whose motif the scan cannot read, and one that does not read as a definition at all.
    let mut bad_motif = mine();
    bad_motif["id"] = json!("custom:bad");
    bad_motif["name"] = json!("BadI");
    bad_motif["recognitionSeq"] = json!("GAXTTC");
    let r = by_id(&d, json!([bad_motif, { "id": "custom:half", "name": "HalfI", "cutFwd": 1 }]));
    assert_eq!(kinds(&r), vec![("BadI (custom)".into(), "unreadableDefinition".into()), ("HalfI (custom)".into(), "unreadableDefinition".into())]);
    assert!(r["unresolvedEnzymes"][0]["reason"].as_str().unwrap().contains('X'));
    assert!(r["unresolvedEnzymes"][1]["reason"].as_str().unwrap().contains("recognitionSeq"));
    assert_eq!((r["complete"].clone(), r["fragments"].clone()), (json!(false), json!([])));
}

#[test]
fn us_01m7dvd5_ac2_a_definition_without_a_custom_id_is_unresolved_never_filled_as_the_built_in() {
    let d = twin_circle();
    // Without an id the payload reader fills the name as the id ("EcoRI"), the built-in's id: the
    // digest refuses it rather than cutting as either EcoRI.
    let mut no_id = mine();
    no_id.as_object_mut().unwrap().remove("id");
    no_id.as_object_mut().unwrap().remove("source");
    let mut builtin_id = mine();
    builtin_id["id"] = json!("EcoRI");
    builtin_id["source"] = json!("builtin");
    for def in [no_id, builtin_id] {
        let r = by_id(&d, json!([def]));
        assert_eq!(kinds(&r), vec![("EcoRI (custom)".to_string(), "noCustomId".to_string())]);
        assert_eq!((r["complete"].clone(), r["fragments"].clone()), (json!(false), json!([])), "no cut at all, the built-in's GAATTC included");
    }
    // Beside a built-in that cuts nothing here.
    let mut no_id = mine();
    no_id.as_object_mut().unwrap().remove("id");
    let r = by_id(&d, json!(["BamHI", no_id]));
    assert_eq!(r["complete"], json!(false));
    assert_eq!(r["fragments"], json!([]), "BamHI does not cut: the uncut molecule is never reported while an enzyme is unresolved");
}

#[test]
fn us_01m7dvd5_ac2_an_empty_selection_is_an_uncut_complete_digest() {
    let r = by_id(&twin_circle(), json!([]));
    assert_eq!(r["complete"], json!(true));
    assert_eq!(r["unresolvedEnzymes"], json!([]));
    assert_eq!(spans(&r["fragments"]), vec![(1, 300, 300, "Supercoiled/Uncut".into(), "Supercoiled/Uncut".into())]);
}

#[test]
fn us_01m7dvd5_ac2_the_old_op_replies_byte_for_byte_as_before_for_catalogue_names() {
    // A 12 bp line, EcoRI (G^AATTC) at 4..9: 1..4 and 5..12, the longer first. Written out in full,
    // as the dispatcher serializes it (keys sorted), so a new key fails.
    let d = doc("d", "CCCGAATTCCCC", "linear");
    let reply = serde_json::to_string(&by_name(&d, &["EcoRI"])).unwrap();
    assert_eq!(
        reply,
        concat!(
            r#"[{"end":12,"id":"d-frag-2","index":2,"leftEnzyme":"EcoRI","leftOverhang":"AATT","leftOverhangType":"5prime","lengthBp":8,"#,
            r#""rightEnzyme":"3' Terminus","rightOverhang":"","rightOverhangType":"blunt","sequence":"AATTCCCC","start":5},"#,
            r#"{"end":4,"id":"d-frag-1","index":1,"leftEnzyme":"5' Terminus","leftOverhang":"","leftOverhangType":"blunt","lengthBp":4,"#,
            r#""rightEnzyme":"EcoRI","rightOverhang":"AATT","rightOverhangType":"5prime","sequence":"CCCG","start":1}]"#
        )
    );
    // Its uncut reply, and a name the catalogue does not hold, as before: the uncut molecule.
    let uncut = r#"[{"end":12,"id":"d-uncut","index":1,"leftEnzyme":"5' End","leftOverhang":"","leftOverhangType":"blunt","lengthBp":12,"rightEnzyme":"3' End","rightOverhang":"","rightOverhangType":"blunt","sequence":"CCCGAATTCCCC","start":1}]"#;
    assert_eq!(serde_json::to_string(&by_name(&d, &[])).unwrap(), uncut);
    assert_eq!(serde_json::to_string(&by_name(&d, &["NoSuchI"])).unwrap(), uncut);
    // The old op still reads catalogue names only: a custom twin's name is the built-in.
    let t = by_name(&twin_circle(), &["EcoRI"]);
    assert_eq!(t.as_array().unwrap().len(), 2);
}

#[test]
fn us_01m7dvd5_ac2_a_catalogue_only_digest_by_id_is_the_digest_by_name() {
    let lib = dispatch_bio_rpc("get_sample_library", json!({})).expect("sample library");
    let sets: [&[&str]; 5] = [&["EcoRI"], &["BamHI", "XhoI"], &["EcoRI", "BamHI", "HindIII", "NotI", "XhoI", "PstI"], &["SmaI", "KpnI", "SacI"], &["ApaI", "PspOMI", "BsaI-HFv2", "XbaI", "ClaI"]];
    let mut checked = 0;
    for d in lib.as_array().unwrap().iter().filter(|d| d["moleculeType"] == json!("DNA")).take(6) {
        for set in sets {
            let r = by_id(d, json!(set));
            assert_eq!(r["fragments"], by_name(d, set), "{} {:?}", d["name"], set);
            checked += 1;
        }
    }
    assert!(checked >= 10);
}

#[test]
fn us_01m7dvd5_ac6_cuts_at_one_position_keep_the_old_order_and_a_differing_overhang_is_a_clash() {
    // A custom twin with the built-in's motif and cuts: the shared cut is the built-in's (it leads a
    // same-named custom), whatever order the selection gives, and nothing clashes.
    let mut same = mine();
    same["recognitionSeq"] = json!("GAATTC");
    same["cutFwd"] = json!(1);
    same["cutRev"] = json!(5);
    let d = twin_circle();
    let a = by_id(&d, json!([same.clone(), "EcoRI"]));
    let b = by_id(&d, json!(["EcoRI", same.clone()]));
    assert_eq!(a, b, "the selection's order does not decide");
    assert_eq!(a["complete"], json!(true));
    assert_eq!(a["fragments"], by_name(&d, &["EcoRI"]), "the built-in's ends, no custom id");

    // The built-in's motif and top cut with another bottom cut: listed as a clash naming both.
    let mut clash = same.clone();
    clash["cutRev"] = json!(3);
    let r = by_id(&d, json!([clash.clone(), "EcoRI"]));
    assert_eq!(r["complete"], json!(false));
    assert_eq!(kinds(&r), vec![("EcoRI and EcoRI (custom)".into(), "clash".into()), ("EcoRI and EcoRI (custom)".into(), "clash".into())]);
    let reason = r["unresolvedEnzymes"][0]["reason"].as_str().unwrap();
    assert!(reason.contains("AATT 5prime") && reason.contains("AA 5prime"), "{reason}");
    assert_eq!(r["unresolvedEnzymes"][0]["enzymeIds"], json!(["EcoRI", "custom:mine"]));
    assert_eq!(by_id(&d, json!(["EcoRI", clash])), r);
}
