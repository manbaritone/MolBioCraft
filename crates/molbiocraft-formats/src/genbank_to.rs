// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! A Rust port of genbank_to 0.54's sequence outputs (Rob Edwards, MIT licence,
//! https://github.com/linsalrob/genbank_to; GenBankToLib/genbank.py and main.py), so a GenBank
//! record converts with no Python at runtime (EP-01M7RC9C, D0227-D0229):
//!
//! - [`genbank_to_fna`], 0.54's `-n`: each record's whole sequence, `>id\nSEQUENCE\n`;
//! - [`genbank_to_orfs`], `-o`: each CDS's extracted DNA;
//! - [`genbank_to_faa`], `-a`: each CDS's protein;
//! - [`genbank_to_functions`], `-f`: `<record id>\t<feature id>\t<product>`;
//! - [`genbank_to_separate`] and [`genbank_to_gbk_files`], `--separate`: one file per record.
//!
//! Each follows 0.54 byte for byte except D0227's named differences: a CDS carrying /pseudo is left
//! out of every output here unless [`GenbankToOptions::include_pseudogenes`] (1); the record filter
//! selects records for every output and does not imply one file per record (4); the complex header
//! is written as D0227 (5) states, since 0.54 crashes there; a de novo translation uses the CDS's
//! /transl_table (6); positions carry no partial marks and order() reads as join{} (8); and one file
//! per record with no output chosen writes each record's GenBank export (9).
//!
//! The records are the app's own [`SequenceDocument`]s, read by [`crate::parse_genbank_flatfile`]
//! from text [`split_genbank_records`] splits; the record id is [`genbank_record_id`] (D0229).

use crate::flatfiles::{ends_record, export_genbank_flatfile};
use molbiocraft_core::genetic_codes::{resolve_genetic_code, translate_codon};
use molbiocraft_core::{reverse_complement, SequenceDocument, SequenceFeature};

/// What the app's GenBank reader puts in a record's accession when it has no ACCESSION line.
const NO_ACCESSION: &str = "GB_IMPORT_001";

/// The conversion's options (D0228).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GenbankToOptions {
    /// Keep CDS features carrying /pseudo in the ORF, protein and functions outputs (D0227 (1)).
    pub include_pseudogenes: bool,
    /// Head each ORF and protein record with D0227 (5)'s complex header.
    pub complex_headers: bool,
    /// The record ids to keep, each with or without its `.version`; empty keeps every record.
    pub records: Vec<String>,
}

/// One output's text and the warnings the conversion owes for it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GenbankToText {
    pub text: String,
    pub warnings: Vec<String>,
}

/// One file per record: (file name, text) in record order, and the warnings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GenbankToFiles {
    pub files: Vec<(String, String)>,
    pub warnings: Vec<String>,
}

/// The outputs 0.54's `--separate` writes one file per record for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenbankToSequenceOutput {
    /// `<base>.<record id>.fna`
    Nucleotides,
    /// `<base>.<record id>.orfs`
    CdsDna,
    /// `<base>.<record id>.faa`
    Proteins,
}

impl GenbankToSequenceOutput {
    fn extension(self) -> &'static str {
        match self {
            Self::Nucleotides => "fna",
            Self::CdsDna => "orfs",
            Self::Proteins => "faa",
        }
    }
}

/// Splits GenBank text into its records by the parser's own rule: a record ends at a "//" line in
/// column 1, trailing space aside (`ends_record`, Biopython 1.88's rule too). Each record keeps its
/// lines, its "//" line included, each ending in "\n". A piece with no LOCUS line, such as blank
/// lines between records, is no record; text after the last "//" is one when it has a LOCUS line.
pub fn split_genbank_records(text: &str) -> Vec<String> {
    let mut records = Vec::new();
    let mut current = String::new();
    let push = |current: &mut String, records: &mut Vec<String>| {
        if current.lines().any(|l| l.starts_with("LOCUS")) {
            records.push(std::mem::take(current));
        }
        current.clear();
    };
    for line in text.lines() {
        current.push_str(line);
        current.push('\n');
        if ends_record(line) {
            push(&mut current, &mut records);
        }
    }
    push(&mut current, &mut records);
    records
}

/// A document metadata key's value, as text, when it holds some.
fn metadata<'a>(doc: &'a SequenceDocument, key: &str) -> Option<&'a str> {
    doc.doc_metadata
        .as_ref()?
        .get(key)?
        .as_str()
        .filter(|v| !v.is_empty())
}

/// The record id, Biopython's `SeqRecord.id` (D0229): the VERSION line's first token
/// (`doc_metadata["Version"]`), else the ACCESSION token when the record has an ACCESSION line, else
/// the LOCUS name. The last is `doc_metadata["LOCUS name"]` when a D0202 `COMMENT MolBioCraft name:`
/// line renamed the record, else the document's name, which is then the LOCUS name.
pub fn genbank_record_id(doc: &SequenceDocument) -> String {
    record_id(doc).0
}

/// [`genbank_record_id`] and the warning owed when it is not the VERSION.
fn record_id(doc: &SequenceDocument) -> (String, Option<String>) {
    if let Some(v) = metadata(doc, "Version") {
        return (v.to_string(), None);
    }
    if !doc.accession.is_empty() && doc.accession != NO_ACCESSION {
        let id = doc.accession.clone();
        let w = format!("Record {id} has no VERSION line, so its accession is used as its id.");
        return (id, Some(w));
    }
    let id = metadata(doc, "LOCUS name").unwrap_or(&doc.name).to_string();
    let w = format!(
        "Record {id} has no VERSION or ACCESSION line, so its LOCUS name is used as its id."
    );
    (id, Some(w))
}

/// Whether the record filter keeps `id`: an empty filter keeps every record, and an id is kept when
/// the filter names it with or without its `.version` (D0227 (4)).
fn kept(id: &str, filter: &[String]) -> bool {
    let unversioned = id
        .rsplit_once('.')
        .filter(|(_, v)| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        .map_or(id, |(a, _)| a);
    filter.is_empty()
        || filter
            .iter()
            .map(|f| f.trim())
            .any(|f| f == id || f == unversioned)
}

/// The records the filter keeps, each with its id, adding the record-id warnings for those.
fn selected<'a>(
    docs: &'a [SequenceDocument],
    opts: &GenbankToOptions,
    warnings: &mut Vec<String>,
) -> Vec<(String, &'a SequenceDocument)> {
    let mut out = Vec::new();
    for doc in docs {
        let (id, warning) = record_id(doc);
        if kept(&id, &opts.records) {
            warnings.extend(warning);
            out.push((id, doc));
        }
    }
    out
}

/// A qualifier's values, in file order (the reader keeps repeats "\n"-separated).
fn values<'a>(f: &'a SequenceFeature, key: &str) -> Option<Vec<&'a str>> {
    f.qualifiers
        .as_ref()?
        .get(key)
        .map(|v| v.split('\n').collect())
}

/// The feature's parts, 1-based and inclusive, in stored order (plus-strand order).
fn parts(f: &SequenceFeature) -> Vec<(usize, usize)> {
    match f.segments.as_ref().filter(|s| s.len() > 1) {
        Some(segs) => segs.iter().map(|s| (s.start, s.end)).collect(),
        None => vec![(f.start, f.end)],
    }
}

/// Biopython's `str(feature.location)` without partial marks (D0227 (8)): `[a:b](+)` with a 0-based
/// start, or `join{[a:b](-), [c:d](-)}` with a minus-strand join's parts in transcription order,
/// the reverse of the order the app stores them in.
fn location_text(f: &SequenceFeature) -> String {
    let strand = match f.strand {
        s if s > 0 => "(+)",
        s if s < 0 => "(-)",
        _ => "",
    };
    let mut p = parts(f);
    if f.strand < 0 {
        p.reverse();
    }
    let texts: Vec<String> = p
        .iter()
        .map(|&(a, b)| format!("[{}:{}]{strand}", a.saturating_sub(1), b))
        .collect();
    if texts.len() == 1 {
        texts[0].clone()
    } else {
        format!("join{{{}}}", texts.join(", "))
    }
}

/// 0.54's feature id: protein_id, else locus_tag, else db_xref, repeats joined by '|', else
/// `<record id>.<location text>`.
pub fn genbank_to_feature_id(record_id: &str, f: &SequenceFeature) -> String {
    ["protein_id", "locus_tag", "db_xref"]
        .iter()
        .find_map(|k| values(f, k).map(|v| v.join("|")))
        .unwrap_or_else(|| format!("{record_id}.{}", location_text(f)))
}

/// The CDS's extracted DNA, upper case: its parts joined, reverse-complemented on the minus strand.
fn extract(doc: &SequenceDocument, f: &SequenceFeature) -> String {
    let seq = doc.sequence.as_bytes();
    let plus: String = parts(f)
        .iter()
        .filter_map(|&(a, b)| seq.get(a.saturating_sub(1)..b.min(seq.len())))
        .map(|s| String::from_utf8_lossy(s).to_ascii_uppercase())
        .collect();
    if f.strand < 0 {
        reverse_complement(&plus).to_ascii_uppercase()
    } else {
        plus
    }
}

/// D0227 (5)'s complex header: `<feature id> [<record id>] [<organism>] [<record id>_<start>_<stop>]
/// <product> [<db_xrefs joined by "; ">]`, 1-based, start greater than stop on the minus strand.
/// The organism part needs the record's ORGANISM, the db_xref part a /db_xref; a CDS with no
/// /product reads `[hypothetical protein]`, and one with several gives its first.
fn complex_header(fid: &str, rid: &str, doc: &SequenceDocument, f: &SequenceFeature) -> String {
    let mut h = format!("{fid} [{rid}]");
    if let Some(org) = metadata(doc, "Organism") {
        h.push_str(&format!(" [{org}]"));
    }
    let (start, stop) = if f.strand < 0 {
        (f.end, f.start)
    } else {
        (f.start, f.end)
    };
    h.push_str(&format!(" [{rid}_{start}_{stop}]"));
    match values(f, "product") {
        Some(p) => h.push_str(&format!(" {}", p[0])),
        None => h.push_str(" [hypothetical protein]"),
    }
    if let Some(x) = values(f, "db_xref") {
        h.push_str(&format!(" [{}]", x.join("; ")));
    }
    h
}

/// One CDS the outputs write: its record, ids and feature.
struct Cds<'a> {
    rid: &'a str,
    doc: &'a SequenceDocument,
    fid: String,
    header: String,
    feature: &'a SequenceFeature,
}

/// Each CDS of the selected records in record and feature order, /pseudo ones only with Include
/// pseudogenes (D0227 (1)).
fn cds<'a>(records: &'a [(String, &'a SequenceDocument)], opts: &GenbankToOptions) -> Vec<Cds<'a>> {
    let mut out = Vec::new();
    for (rid, doc) in records {
        for f in doc.features.iter().filter(|f| f.feature_type == "CDS") {
            if !opts.include_pseudogenes && values(f, "pseudo").is_some() {
                continue;
            }
            let fid = genbank_to_feature_id(rid, f);
            let header = if opts.complex_headers {
                complex_header(&fid, rid, doc, f)
            } else {
                fid.clone()
            };
            out.push(Cds {
                rid,
                doc,
                fid,
                header,
                feature: f,
            });
        }
    }
    out
}

/// The CDS's protein: its first /translation when it has one; else the whole extract translated with
/// its /transl_table (table 1 without one), every '*' kept and /codon_start ignored (D0227 (6));
/// none when the extract is not a multiple of 3, with the warning naming it.
fn protein(c: &Cds, warnings: &mut Vec<String>) -> Option<String> {
    if let Some(t) = values(c.feature, "translation") {
        return Some(t[0].to_string());
    }
    let dna = extract(c.doc, c.feature);
    if !dna.len().is_multiple_of(3) {
        warnings.push(format!(
            "CDS {} in {} was left out of the proteins: its length ({} bp) is not a multiple of 3 and it has no /translation.",
            c.fid,
            c.rid,
            dna.len()
        ));
        return None;
    }
    let table =
        match values(c.feature, "transl_table").and_then(|v| v[0].trim().parse::<u64>().ok()) {
            Some(requested) => {
                let (id, warning) = resolve_genetic_code(requested);
                warnings.extend(warning);
                id
            }
            None => 1,
        };
    Some(
        dna.as_bytes()
            .chunks(3)
            .map(|codon| translate_codon(codon, table) as char)
            .collect(),
    )
}

/// One record's lines of one sequence output.
fn sequence_lines(
    out: GenbankToSequenceOutput,
    rid: &str,
    doc: &SequenceDocument,
    opts: &GenbankToOptions,
    warnings: &mut Vec<String>,
) -> String {
    let one = [(rid.to_string(), doc)];
    let mut text = String::new();
    match out {
        GenbankToSequenceOutput::Nucleotides => {
            text.push_str(&format!(">{rid}\n{}\n", doc.sequence.to_ascii_uppercase()))
        }
        GenbankToSequenceOutput::CdsDna => {
            for c in cds(&one, opts) {
                text.push_str(&format!(">{}\n{}\n", c.header, extract(c.doc, c.feature)));
            }
        }
        GenbankToSequenceOutput::Proteins => {
            for c in cds(&one, opts) {
                if let Some(p) = protein(&c, warnings) {
                    text.push_str(&format!(">{}\n{p}\n", c.header));
                }
            }
        }
    }
    text
}

/// Each selected record's lines of `out`, as one file or one per record, with the CDS warnings
/// first and then the record-id warnings, each once.
fn per_record(
    docs: &[SequenceDocument],
    out: GenbankToSequenceOutput,
    opts: &GenbankToOptions,
) -> (Vec<(String, String)>, Vec<String>) {
    let mut id_warnings = Vec::new();
    let records = selected(docs, opts, &mut id_warnings);
    let mut warnings = Vec::new();
    let texts = records
        .iter()
        .map(|(rid, doc)| {
            (
                rid.clone(),
                sequence_lines(out, rid, doc, opts, &mut warnings),
            )
        })
        .collect();
    warnings.extend(id_warnings);
    (texts, dedup(warnings))
}

fn dedup(warnings: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    warnings
        .into_iter()
        .filter(|w| seen.insert(w.clone()))
        .collect()
}

fn joined(
    docs: &[SequenceDocument],
    out: GenbankToSequenceOutput,
    opts: &GenbankToOptions,
) -> GenbankToText {
    let (texts, warnings) = per_record(docs, out, opts);
    GenbankToText {
        text: texts.into_iter().map(|(_, t)| t).collect(),
        warnings,
    }
}

/// 0.54's `-n`: `>record id\nSEQUENCE\n` per record, upper case and unwrapped.
pub fn genbank_to_fna(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    joined(docs, GenbankToSequenceOutput::Nucleotides, opts)
}

/// 0.54's `-o`: `>header\nDNA\n` per CDS, the DNA extracted as the location reads it.
pub fn genbank_to_orfs(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    joined(docs, GenbankToSequenceOutput::CdsDna, opts)
}

/// 0.54's `-a`: `>header\nPROTEIN\n` per CDS, the protein as `protein` reads it.
pub fn genbank_to_faa(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    joined(docs, GenbankToSequenceOutput::Proteins, opts)
}

/// 0.54's `-f`: `<record id>\t<feature id>\t<product>\n` per CDS, repeated products joined by '|',
/// 'Hypothetical protein' without one. The feature id is never the complex header, as in 0.54.
pub fn genbank_to_functions(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    let mut warnings = Vec::new();
    let records = selected(docs, opts, &mut warnings);
    let mut text = String::new();
    for c in cds(&records, opts) {
        let product = values(c.feature, "product")
            .map_or_else(|| "Hypothetical protein".to_string(), |p| p.join("|"));
        text.push_str(&format!("{}\t{}\t{product}\n", c.rid, c.fid));
    }
    GenbankToText {
        text,
        warnings: dedup(warnings),
    }
}

/// 0.54's `--separate` with `-n`, `-o` or `-a`: `<base>.<record id>.<fna|orfs|faa>` per selected
/// record that has lines in that output, each file that record's lines of the joined output.
pub fn genbank_to_separate(
    docs: &[SequenceDocument],
    out: GenbankToSequenceOutput,
    base: &str,
    opts: &GenbankToOptions,
) -> GenbankToFiles {
    let (texts, warnings) = per_record(docs, out, opts);
    let files = texts
        .into_iter()
        .filter(|(_, t)| !t.is_empty())
        .map(|(rid, t)| (format!("{base}.{rid}.{}", out.extension()), t))
        .collect();
    GenbankToFiles { files, warnings }
}

/// `--separate` with no output chosen (D0227 (9)): `<record id>.gbk` per selected record, written
/// by the app's own [`export_genbank_flatfile`].
pub fn genbank_to_gbk_files(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToFiles {
    let mut warnings = Vec::new();
    let files = selected(docs, opts, &mut warnings)
        .into_iter()
        .map(|(rid, doc)| (format!("{rid}.gbk"), export_genbank_flatfile(doc)))
        .collect();
    GenbankToFiles {
        files,
        warnings: dedup(warnings),
    }
}
