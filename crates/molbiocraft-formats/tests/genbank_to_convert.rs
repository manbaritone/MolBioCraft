// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The Convert GenBank entry (US-01M7RCCA AC1, D0228): `genbank_to_convert` reads the records from
//! text, bytes (gzip found by its 1f8b magic bytes, whatever the name) or open documents, writes
//! each chosen output under D0228's file name with exactly the text of the formats function that
//! writes it (US-01M7RC3P, US-01M7RC56, US-01M7RCMJ), and packs more than one file into one deflate
//! zip. The zip is read back here through its local headers with flate2 and crc32fast only, so a
//! writer that stored the files, misnamed one, dropped one or wrote a wrong CRC-32 fails.

use std::io::{Read, Write};

use flate2::read::DeflateDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use molbiocraft_core::SequenceDocument;
use molbiocraft_formats::genbank_to::{
    genbank_to_amrfinder, genbank_to_convert, genbank_to_faa, genbank_to_fna, genbank_to_functions,
    genbank_to_gbk_files, genbank_to_gff3, genbank_to_orfs, genbank_to_phage_finder,
    genbank_to_ptt, genbank_to_separate, split_genbank_records, GenbankToOptions, GenbankToOutput,
    GenbankToRequest, GenbankToResponse, GenbankToSequenceOutput, GenbankToSource,
};
use molbiocraft_formats::genbank_to_bakta::genbank_to_bakta_json;
use molbiocraft_formats::parse_genbank_flatfile;

const ORACLE: &str = include_str!("fixtures/genbank_to/oracle.gbk");
const FNA: &str = include_str!("fixtures/genbank_to/expected/oracle.fna");
const ORFS: &str = include_str!("fixtures/genbank_to/expected/oracle.orfs");
const FAA: &str = include_str!("fixtures/genbank_to/expected/oracle.faa");
const FUNCTIONS: &str = include_str!("fixtures/genbank_to/expected/oracle.functions.tsv");
const PTT: &str = include_str!("fixtures/genbank_to/expected/oracle.ptt");
const PHAGE_FINDER: &str = include_str!("fixtures/genbank_to/expected/oracle.phage_finder.tsv");

const ALL: [GenbankToOutput; 9] = [
    GenbankToOutput::Nucleotides,
    GenbankToOutput::CdsDna,
    GenbankToOutput::Proteins,
    GenbankToOutput::Functions,
    GenbankToOutput::Ptt,
    GenbankToOutput::PhageFinder,
    GenbankToOutput::Gff3,
    GenbankToOutput::AmrFinderPlus,
    GenbankToOutput::BaktaJson,
];

fn docs() -> Vec<SequenceDocument> {
    split_genbank_records(ORACLE)
        .iter()
        .map(|r| parse_genbank_flatfile(r, "oracle"))
        .collect()
}

fn request(source: GenbankToSource, outputs: &[GenbankToOutput]) -> GenbankToRequest {
    GenbankToRequest {
        source,
        base_name: "oracle".to_string(),
        outputs: outputs.to_vec(),
        include_pseudogenes: false,
        complex_headers: false,
        separate: false,
        records: Vec::new(),
        gram: None,
        translation_table: None,
    }
}

fn text() -> GenbankToSource {
    GenbankToSource::Text {
        text: ORACLE.to_string(),
    }
}

fn pairs(r: &GenbankToResponse) -> Vec<(String, String)> {
    r.files
        .iter()
        .map(|f| (f.name.clone(), f.text.clone()))
        .collect()
}

/// Every file each formats function writes for the oracle under `opts`, in D0228's output order,
/// and the warnings they owe.
fn expected(opts: &GenbankToOptions) -> (Vec<(String, String)>, Vec<String>) {
    let d = docs();
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut one = |name: &str, t: molbiocraft_formats::genbank_to::GenbankToText| {
        files.push((name.to_string(), t.text));
        warnings.extend(t.warnings);
    };
    one("oracle.fna", genbank_to_fna(&d, opts));
    one("oracle.orfs", genbank_to_orfs(&d, opts));
    one("oracle.faa", genbank_to_faa(&d, opts));
    one("oracle.functions.tsv", genbank_to_functions(&d, opts));
    one("oracle.ptt", genbank_to_ptt(&d, opts));
    one("oracle.phage_finder.tsv", genbank_to_phage_finder(&d, opts));
    one("oracle.gff3", genbank_to_gff3(&d, opts));
    let amr = genbank_to_amrfinder(&d, "oracle", opts);
    one(
        "oracle.bakta.json",
        genbank_to_bakta_json(&d, opts).expect("Bakta JSON of the oracle"),
    );
    let bakta = files.pop().unwrap();
    files.extend(amr.files);
    warnings.extend(amr.warnings);
    files.push(bakta);
    let mut seen = std::collections::HashSet::new();
    warnings.retain(|w| seen.insert(w.clone()));
    (files, warnings)
}

/// The entries of a zip, read through its local headers: each one's name and inflated bytes, its
/// method 8 (deflate), its CRC-32 checked against the bytes and its sizes against the header.
/// The central directory must then name the same entries, in the same order.
fn read_zip(zip: &[u8]) -> Vec<(String, Vec<u8>)> {
    let u16_at = |at: usize| u16::from_le_bytes([zip[at], zip[at + 1]]) as usize;
    let u32_at = |at: usize| u32::from_le_bytes(zip[at..at + 4].try_into().unwrap());
    let mut entries = Vec::new();
    let mut at = 0;
    while u32_at(at) == 0x0403_4b50 {
        assert_eq!(u16_at(at + 8), 8, "entry {} is not deflated", entries.len());
        let crc = u32_at(at + 14);
        let csize = u32_at(at + 18) as usize;
        let usize_ = u32_at(at + 22) as usize;
        let name_len = u16_at(at + 26);
        let extra_len = u16_at(at + 28);
        let name = String::from_utf8(zip[at + 30..at + 30 + name_len].to_vec()).unwrap();
        let data_at = at + 30 + name_len + extra_len;
        let mut bytes = Vec::new();
        DeflateDecoder::new(&zip[data_at..data_at + csize])
            .read_to_end(&mut bytes)
            .unwrap_or_else(|e| panic!("{name} does not inflate: {e}"));
        assert_eq!(bytes.len(), usize_, "{name}: uncompressed size");
        assert_eq!(crc32fast::hash(&bytes), crc, "{name}: CRC-32");
        entries.push((name, bytes));
        at = data_at + csize;
    }
    assert_eq!(
        u32_at(at),
        0x0201_4b50,
        "the local entries end at the central directory"
    );
    let mut central = Vec::new();
    while u32_at(at) == 0x0201_4b50 {
        let name_len = u16_at(at + 28);
        let extra_len = u16_at(at + 30);
        let comment_len = u16_at(at + 32);
        central.push(String::from_utf8(zip[at + 46..at + 46 + name_len].to_vec()).unwrap());
        at += 46 + name_len + extra_len + comment_len;
    }
    assert_eq!(
        u32_at(at),
        0x0605_4b50,
        "the central directory ends at its end record"
    );
    assert_eq!(u16_at(at + 10), entries.len(), "end record's entry count");
    assert_eq!(at + 22, zip.len(), "nothing after the end record");
    let names: Vec<String> = entries.iter().map(|(n, _)| n.clone()).collect();
    assert_eq!(central, names, "central directory names");
    entries
}

#[test]
fn each_output_is_the_formats_function_under_its_d0228_name() {
    let got = genbank_to_convert(&request(text(), &ALL)).expect("the oracle converts");
    let (files, warnings) = expected(&GenbankToOptions::default());
    let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [
            "oracle.fna",
            "oracle.orfs",
            "oracle.faa",
            "oracle.functions.tsv",
            "oracle.ptt",
            "oracle.phage_finder.tsv",
            "oracle.gff3",
            "oracle.amr.gff",
            "oracle.amr.faa",
            "oracle.amr.fna",
            "oracle.bakta.json",
        ]
    );
    assert_eq!(pairs(&got), files);
    assert_eq!(got.warnings, warnings);
    assert!(!got.warnings.is_empty(), "the fixture owes warnings");
    // and the text outputs are 0.54's own (the oracle's expected files)
    let text_of = |n: &str| files.iter().find(|(f, _)| f == n).unwrap().1.clone();
    assert_eq!(text_of("oracle.fna"), FNA);
    assert_eq!(text_of("oracle.orfs"), ORFS);
    assert_eq!(text_of("oracle.faa"), FAA);
    assert_eq!(text_of("oracle.functions.tsv"), FUNCTIONS);
    assert_eq!(text_of("oracle.ptt"), PTT);
    assert_eq!(text_of("oracle.phage_finder.tsv"), PHAGE_FINDER);
}

#[test]
fn the_outputs_come_in_d0228_order_once_each_whatever_order_they_are_asked_in() {
    let asked = [
        GenbankToOutput::BaktaJson,
        GenbankToOutput::Proteins,
        GenbankToOutput::Nucleotides,
        GenbankToOutput::Proteins,
    ];
    let got = genbank_to_convert(&request(text(), &asked)).unwrap();
    let names: Vec<&str> = got.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["oracle.fna", "oracle.faa", "oracle.bakta.json"]);
}

#[test]
fn the_options_reach_every_output() {
    let mut req = request(text(), &ALL);
    req.include_pseudogenes = true;
    req.complex_headers = true;
    req.records = vec!["OR000001".to_string(), "OR000003".to_string()];
    req.gram = Some("-".to_string());
    req.translation_table = Some(4);
    let got = genbank_to_convert(&req).unwrap();
    let opts = GenbankToOptions {
        include_pseudogenes: true,
        complex_headers: true,
        records: req.records.clone(),
        gram: Some('-'),
        translation_table: Some(4),
    };
    let (files, warnings) = expected(&opts);
    assert_eq!(pairs(&got), files);
    assert_eq!(got.warnings, warnings);
    // the options changed something: the default run differs
    assert_ne!(files, expected(&GenbankToOptions::default()).0);
}

#[test]
fn gzipped_bytes_give_the_same_files_and_plain_bytes_read_as_text() {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(ORACLE.as_bytes()).unwrap();
    let gz = gz.finish().unwrap();
    assert_eq!(&gz[..2], [0x1f, 0x8b]);
    let from_text = genbank_to_convert(&request(text(), &ALL)).unwrap();
    // the request carries no file name: gzip is found by the bytes alone
    let from_gz = genbank_to_convert(&request(GenbankToSource::Bytes { bytes: gz }, &ALL)).unwrap();
    assert_eq!(pairs(&from_gz), pairs(&from_text));
    assert_eq!(from_gz.warnings, from_text.warnings);
    let from_plain = genbank_to_convert(&request(
        GenbankToSource::Bytes {
            bytes: ORACLE.as_bytes().to_vec(),
        },
        &ALL,
    ))
    .unwrap();
    assert_eq!(pairs(&from_plain), pairs(&from_text));
}

#[test]
fn open_documents_give_the_same_files_as_their_text() {
    let from_text = genbank_to_convert(&request(text(), &ALL)).unwrap();
    let from_docs = genbank_to_convert(&request(
        GenbankToSource::Documents { documents: docs() },
        &ALL,
    ))
    .unwrap();
    assert_eq!(pairs(&from_docs), pairs(&from_text));
    assert_eq!(from_docs.warnings, from_text.warnings);
}

#[test]
fn several_files_are_one_deflate_zip_holding_exactly_them() {
    let got = genbank_to_convert(&request(text(), &ALL)).unwrap();
    let zip = got.zip.as_ref().expect("eleven files are zipped");
    let entries = read_zip(zip);
    let want: Vec<(String, Vec<u8>)> = got
        .files
        .iter()
        .map(|f| (f.name.clone(), f.text.clone().into_bytes()))
        .collect();
    assert_eq!(entries, want);
    // deflated, not stored: the zip is smaller than the files it holds
    let raw: usize = want.iter().map(|(_, b)| b.len()).sum();
    assert!(
        zip.len() < raw,
        "zip {} bytes for {raw} bytes of files",
        zip.len()
    );
    // two files are zipped too
    let two = genbank_to_convert(&request(
        text(),
        &[GenbankToOutput::Proteins, GenbankToOutput::Functions],
    ))
    .unwrap();
    let names: Vec<String> = read_zip(two.zip.as_ref().unwrap())
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    assert_eq!(names, ["oracle.faa", "oracle.functions.tsv"]);
}

#[test]
fn one_file_is_not_zipped() {
    let got = genbank_to_convert(&request(text(), &[GenbankToOutput::Proteins])).unwrap();
    assert_eq!(pairs(&got), [("oracle.faa".to_string(), FAA.to_string())]);
    assert_eq!(got.zip, None);
}

#[test]
fn one_file_per_record_splits_the_sequence_outputs_only() {
    let mut req = request(
        text(),
        &[
            GenbankToOutput::Nucleotides,
            GenbankToOutput::Proteins,
            GenbankToOutput::Functions,
        ],
    );
    req.separate = true;
    let got = genbank_to_convert(&req).unwrap();
    let d = docs();
    let o = GenbankToOptions::default();
    let mut want =
        genbank_to_separate(&d, GenbankToSequenceOutput::Nucleotides, "oracle", &o).files;
    want.extend(genbank_to_separate(&d, GenbankToSequenceOutput::Proteins, "oracle", &o).files);
    want.push(("oracle.functions.tsv".to_string(), FUNCTIONS.to_string()));
    assert_eq!(pairs(&got), want);
    assert!(
        want.iter().any(|(n, _)| n == "oracle.OR000001.1.fna"),
        "{want:?}"
    );
    // with no output, one file per record is each record's GenBank export
    req.outputs.clear();
    let gbk = genbank_to_convert(&req).unwrap();
    let want = genbank_to_gbk_files(&d, &o);
    assert_eq!(pairs(&gbk), want.files);
    assert_eq!(gbk.warnings, want.warnings);
    assert_eq!(gbk.files.len(), 3);
}

#[test]
fn refusals_name_what_is_wrong() {
    let err = |req: GenbankToRequest| genbank_to_convert(&req).unwrap_err();
    // no record in the text, the bytes, gzipped or not, or the documents
    let none = "No GenBank record was found in oracle.";
    let prose = GenbankToSource::Text {
        text: "just some prose\n".to_string(),
    };
    assert_eq!(err(request(prose, &ALL)), none);
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(b">fasta\nACGT\n").unwrap();
    let gz = gz.finish().unwrap();
    assert_eq!(
        err(request(GenbankToSource::Bytes { bytes: gz }, &ALL)),
        none
    );
    assert_eq!(
        err(request(
            GenbankToSource::Documents { documents: vec![] },
            &ALL
        )),
        none
    );
    // bytes that are neither gzip nor UTF-8, and gzip that does not inflate
    assert_eq!(
        err(request(
            GenbankToSource::Bytes {
                bytes: vec![0xff, 0xfe, 0x00, 0x4c]
            },
            &ALL
        )),
        "oracle is not UTF-8 text or gzip, so it cannot be read as GenBank."
    );
    let broken = err(request(
        GenbankToSource::Bytes {
            bytes: vec![0x1f, 0x8b, 0x08, 0x00, 0x01],
        },
        &ALL,
    ));
    assert!(
        broken.starts_with("oracle is gzip but cannot be inflated: "),
        "{broken}"
    );
    // no output, unless one file per record
    assert_eq!(err(request(text(), &[])), "Choose at least one output.");
    // Gram stain or translation table without Bakta JSON, as 0.54 refuses them
    let gram_only = "Gram stain and translation table apply only to Bakta JSON.";
    let mut req = request(text(), &[GenbankToOutput::Proteins]);
    req.gram = Some("+".to_string());
    assert_eq!(err(req), gram_only);
    let mut req = request(text(), &[GenbankToOutput::Proteins]);
    req.translation_table = Some(11);
    assert_eq!(err(req), gram_only);
    // Bakta's own refusals come through
    let mut req = request(text(), &[GenbankToOutput::BaktaJson]);
    req.translation_table = Some(15);
    assert_eq!(
        err(req),
        "Translation table 15 is not one genbank_to accepts."
    );
    let mut req = request(text(), &[GenbankToOutput::BaktaJson]);
    req.gram = Some("+-".to_string());
    assert_eq!(
        err(req),
        "Gram stain +- is not one genbank_to accepts: give '+' or '-'."
    );
    // a record filter that keeps nothing
    let mut req = request(text(), &[GenbankToOutput::Proteins]);
    req.records = vec!["NOPE1".to_string(), "NOPE2.3".to_string()];
    assert_eq!(err(req), "No record in oracle is named NOPE1 or NOPE2.3.");
}
