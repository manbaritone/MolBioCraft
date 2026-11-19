// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The Convert GenBank RPC (US-01M7RCCA AC2, AC3, D0228): `genbank_to_convert` hands the payload the
//! dialog sends to `molbiocraft_formats::genbank_to::genbank_to_convert` and returns its files, zip
//! bytes and warnings as they are, and its refusals by name. The zip writer and the gzip reader are
//! tested where they are written (molbiocraft-formats' genbank_to_convert.rs); this checks the wiring.

use molbiocraft_formats::genbank_to::{
    genbank_to_convert, split_genbank_records, GenbankToRequest,
};
use molbiocraft_formats::parse_genbank_flatfile;
use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

const ORACLE: &str =
    include_str!("../../molbiocraft-formats/tests/fixtures/genbank_to/oracle.gbk");
const NO_VERSION_WARNING: &str =
    "Record OR000003 has no VERSION line, so its accession is used as its id.";

const ALL: [&str; 9] = [
    "nucleotides",
    "cdsDna",
    "proteins",
    "functions",
    "ptt",
    "phageFinder",
    "gff3",
    "amrFinderPlus",
    "baktaJson",
];

/// The payload the dialog sends: every key, as the TypeScript wrapper sends them.
fn payload(source: Value, outputs: &[&str]) -> Value {
    json!({
        "source": source,
        "baseName": "oracle",
        "outputs": outputs,
        "includePseudogenes": false,
        "complexHeaders": false,
        "separate": false,
        "records": [],
        "gram": null,
        "translationTable": null,
    })
}

fn with(mut p: Value, key: &str, v: Value) -> Value {
    p[key] = v;
    p
}

/// The formats entry called directly on the same payload, as JSON.
fn direct(p: &Value) -> Result<Value, String> {
    let req: GenbankToRequest = serde_json::from_value(p.clone()).expect("the payload is a request");
    genbank_to_convert(&req).map(|r| serde_json::to_value(r).unwrap())
}

fn rpc(p: &Value) -> Result<Value, String> {
    dispatch_bio_rpc("genbank_to_convert", p.clone())
}

#[test]
fn rpc_returns_the_formats_conversion() {
    let text = json!({ "text": ORACLE });
    let p = payload(text.clone(), &ALL);
    let got = rpc(&p).expect("the oracle converts");
    assert_eq!(got, direct(&p).unwrap());
    assert_eq!(got["files"].as_array().unwrap().len(), 11, "{got}");
    assert_eq!(got["files"][0]["name"], "oracle.fna");
    assert_eq!(got["files"][10]["name"], "oracle.bakta.json");
    let zip = got["zip"].as_array().expect("eleven files come with a zip");
    assert_eq!(&zip[..4], [json!(0x50), json!(0x4b), json!(3), json!(4)]);
    assert!(got["warnings"]
        .as_array()
        .unwrap()
        .contains(&json!(NO_VERSION_WARNING)));

    // every option reaches the conversion: each one changes the reply, as it changes the direct call
    let options = [
        ("includePseudogenes", json!(true)),
        ("complexHeaders", json!(true)),
        ("separate", json!(true)),
        ("records", json!(["OR000002"])),
        ("gram", json!("+")),
        ("translationTable", json!(4)),
        ("baseName", json!("lambda")),
    ];
    for (key, v) in options {
        let p2 = with(p.clone(), key, v);
        let got2 = rpc(&p2).unwrap_or_else(|e| panic!("{key}: {e}"));
        assert_eq!(got2, direct(&p2).unwrap(), "{key}");
        assert_ne!(got2, got, "{key} made no difference");
    }

    // one file: no zip
    let one = payload(text, &["proteins"]);
    let got = rpc(&one).unwrap();
    assert_eq!(got, direct(&one).unwrap());
    assert_eq!(got["zip"], Value::Null);
    assert_eq!(got["files"][0]["name"], "oracle.faa");

    // the open documents the app sends, as the app holds them
    let docs: Vec<Value> = split_genbank_records(ORACLE)
        .iter()
        .map(|r| serde_json::to_value(parse_genbank_flatfile(r, "oracle")).unwrap())
        .collect();
    let from_docs = payload(json!({ "documents": docs }), &ALL);
    assert_eq!(rpc(&from_docs).unwrap(), rpc(&p).unwrap());
    // a file's bytes, as the dialog reads them
    let bytes: Vec<u8> = ORACLE.as_bytes().to_vec();
    let from_bytes = payload(json!({ "bytes": bytes }), &ALL);
    assert_eq!(rpc(&from_bytes).unwrap(), rpc(&p).unwrap());
}

#[test]
fn rpc_refuses_and_warns_by_name() {
    let text = json!({ "text": ORACLE });
    let refused = |p: Value| rpc(&p).expect_err("refused");

    assert_eq!(
        refused(payload(json!({ "text": "plain prose, no record\n" }), &ALL)),
        "No GenBank record was found in oracle."
    );
    assert_eq!(
        refused(payload(text.clone(), &[])),
        "Choose at least one output."
    );
    let gram_only = "Gram stain and translation table apply only to Bakta JSON.";
    assert_eq!(
        refused(with(payload(text.clone(), &["proteins", "gff3"]), "gram", json!("+"))),
        gram_only
    );
    assert_eq!(
        refused(with(
            payload(text.clone(), &["proteins"]),
            "translationTable",
            json!(11)
        )),
        gram_only
    );

    // one file per record with no output: '<record id>.gbk' per record
    let gbk = rpc(&with(payload(text.clone(), &[]), "separate", json!(true))).unwrap();
    let names: Vec<&str> = gbk["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["OR000001.1.gbk", "OR000002.1.gbk", "OR000003.gbk"]);

    // the formats functions' warnings come back: the record with no VERSION, the CDS left out
    let p = payload(text, &["proteins"]);
    let warnings = rpc(&p).unwrap()["warnings"].clone();
    assert_eq!(warnings, direct(&p).unwrap()["warnings"]);
    let warnings: Vec<&str> = warnings
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap())
        .collect();
    assert!(warnings.contains(&NO_VERSION_WARNING), "{warnings:?}");
    assert!(warnings.len() >= 2, "{warnings:?}");
}
