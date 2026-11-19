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
//! - [`genbank_to_separate`] and [`genbank_to_gbk_files`], `--separate`: one file per record;
//! - [`genbank_to_ptt`], `-p`: the NCBI ptt protein table;
//! - [`genbank_to_phage_finder`], `--phage_finder`: phage_finder's gene table;
//! - [`genbank_to_gff3`], `--gff3`, and [`genbank_to_amrfinder`], `--amr`: built from the app's own
//!   GFF3 export, [`export_gff3_noodles`], not from 0.54's BCBio writer (D0227 (7)).
//!
//! Each follows 0.54 byte for byte except D0227's named differences: a CDS carrying /pseudo is left
//! out of every output here unless [`GenbankToOptions::include_pseudogenes`], and out of the
//! AMRFinderPlus files always (1); ptt and phage_finder starts are 1-based (2); the ptt length is an
//! integer (3); the record filter selects records for every output and does not imply one file per
//! record (4); the complex header is written as D0227 (5) states, since 0.54 crashes there; a de novo
//! translation uses the CDS's /transl_table (6); GFF3 and the AMRFinderPlus .gff are the app's export
//! with record ids (7); positions carry no partial marks and order() reads as join{} (8); and one
//! file per record with no output chosen writes each record's GenBank export (9).
//!
//! The records are the app's own [`SequenceDocument`]s, read by [`crate::parse_genbank_flatfile`]
//! from text [`split_genbank_records`] splits; the record id is [`genbank_record_id`] (D0229).

use crate::flatfiles::{ends_record, export_genbank_flatfile, record_length};
use crate::noodles_io::export_gff3_noodles;
use molbiocraft_core::genetic_codes::{resolve_genetic_code, translate_codon};
use molbiocraft_core::{reverse_complement, SequenceDocument, SequenceFeature};

/// What the app's GenBank reader puts in a record's accession when it has no ACCESSION line.
const NO_ACCESSION: &str = "GB_IMPORT_001";

/// The conversion's options (D0228).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GenbankToOptions {
    /// Keep CDS features carrying /pseudo in the ORF, protein, functions, ptt and phage_finder
    /// outputs (D0227 (1)); the AMRFinderPlus files leave them out whatever this says.
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

/// A qualifier's values joined by a space, 0.54's `feat_to_text` without its '-' default.
fn spaced(f: &SequenceFeature, key: &str) -> Option<String> {
    values(f, key).map(|v| v.join(" "))
}

/// Python's `str.isspace`, which the `\S` of 0.54's regexes negates: Unicode White_Space and the
/// four separators U+001C-U+001F.
fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// 0.54's ptt GI: `re.match('GI:(\d+)')` on the db_xrefs joined by a space, so only when that text
/// starts 'GI:' and a digit; else '-'. The digits are ASCII, as GenBank text is.
fn ptt_gi(f: &SequenceFeature) -> String {
    spaced(f, "db_xref")
        .as_deref()
        .and_then(|x| x.strip_prefix("GI:"))
        .map(|rest| {
            rest.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
        })
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| "-".to_string())
}

/// 0.54's ptt COG: `re.match('(COG\S+)')` on the products joined by a space, so a product starting
/// 'COG' and at least one non-space character, punctuation kept; else '-'.
fn ptt_cog(f: &SequenceFeature) -> String {
    spaced(f, "product")
        .and_then(|p| {
            let rest = p.strip_prefix("COG")?;
            let run: String = rest.chars().take_while(|&c| !py_space(c)).collect();
            (!run.is_empty()).then(|| format!("COG{run}"))
        })
        .unwrap_or_else(|| "-".to_string())
}

/// The feature's 1-based start and its end, lowest part start to highest part end (Biopython's
/// `location.start + 1` and `location.end`, D0227 (2)).
fn span(f: &SequenceFeature) -> (usize, usize) {
    let p = parts(f);
    let start = p.iter().map(|&(a, _)| a).min().unwrap_or(f.start);
    let end = p.iter().map(|&(_, b)| b).max().unwrap_or(f.end);
    (start, end)
}

/// 0.54's `-p`: per CDS, `<start>..<end>`, '+' or '-', length, GI, gene (else the location text),
/// feature id, COG and product (else '-'), tab-separated with no header. Starts are 1-based (D0227
/// (2)); the length is the nucleotide length over every part, integer-divided by 3, minus 1 (3).
pub fn genbank_to_ptt(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    let mut warnings = Vec::new();
    let records = selected(docs, opts, &mut warnings);
    let mut text = String::new();
    for c in cds(&records, opts) {
        let f = c.feature;
        let (start, end) = span(f);
        let nt: usize = parts(f)
            .iter()
            .map(|&(a, b)| (b + 1).saturating_sub(a))
            .sum();
        let length = (nt / 3) as i64 - 1;
        text.push_str(&format!(
            "{start}..{end}\t{}\t{length}\t{}\t{}\t{}\t{}\t{}\n",
            if f.strand >= 0 { "+" } else { "-" },
            ptt_gi(f),
            spaced(f, "gene").unwrap_or_else(|| location_text(f)),
            c.fid,
            ptt_cog(f),
            spaced(f, "product").unwrap_or_else(|| "-".to_string()),
        ));
    }
    GenbankToText {
        text,
        warnings: dedup(warnings),
    }
}

/// 0.54's `--phage_finder`: per CDS, `<record id>\t<record length>\t<feature id>\t<start>\t<end>\t
/// <product>`, the products joined by a space, 'Hypothetical protein' without one, the start 1-based
/// (D0227 (2)).
pub fn genbank_to_phage_finder(
    docs: &[SequenceDocument],
    opts: &GenbankToOptions,
) -> GenbankToText {
    let mut warnings = Vec::new();
    let records = selected(docs, opts, &mut warnings);
    let mut text = String::new();
    for c in cds(&records, opts) {
        let (start, end) = span(c.feature);
        let product =
            spaced(c.feature, "product").unwrap_or_else(|| "Hypothetical protein".to_string());
        text.push_str(&format!(
            "{}\t{}\t{}\t{start}\t{end}\t{product}\n",
            c.rid,
            record_length(c.doc),
            c.fid
        ));
    }
    GenbankToText {
        text,
        warnings: dedup(warnings),
    }
}

/// A GFF3 column-9 value with its reserved characters (';', '=', '&', ',', '%' and controls)
/// percent-encoded, as GFF3 requires.
fn gff_encode(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        if matches!(c, ';' | '=' | '&' | ',' | '%') || c.is_control() {
            let mut b = [0u8; 4];
            for byte in c.encode_utf8(&mut b).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// A percent-encoded GFF3 value decoded; an incomplete escape is kept as written.
fn gff_decode(v: &str) -> String {
    let b = v.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = (b[i] == b'%')
            .then(|| v.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One line of a record's GFF3 and the feature its ID names (none for a directive).
struct GffLine<'a> {
    columns: Vec<String>,
    feature: Option<&'a SequenceFeature>,
}

impl GffLine<'_> {
    fn text(&self) -> String {
        format!("{}\n", self.columns.join("\t"))
    }
}

/// One record's [`export_gff3_noodles`] lines after its '##gff-version 3' (D0227 (7)): column 1 and
/// ##sequence-region become the record id, and each ID becomes `<record id>.<export ID>`, by which
/// the line is mapped back to its feature.
fn gff3_lines<'a>(rid: &str, doc: &'a SequenceDocument) -> Vec<GffLine<'a>> {
    let mut out = Vec::new();
    for line in export_gff3_noodles(doc).lines().skip(1) {
        if let Some(region) = line.strip_prefix("##sequence-region ") {
            let rest = region.split_once(' ').map_or("", |(_, r)| r);
            out.push(GffLine {
                columns: vec![format!("##sequence-region {rid} {rest}")],
                feature: None,
            });
            continue;
        }
        let mut columns: Vec<String> = line.split('\t').map(String::from).collect();
        let mut feature = None;
        if columns.len() == 9 && !line.starts_with('#') {
            columns[0] = rid.to_string();
            let attrs: Vec<String> = columns[8]
                .split(';')
                .map(|kv| match kv.strip_prefix("ID=") {
                    Some(id) => {
                        let fid = gff_decode(id);
                        feature = doc.features.iter().find(|f| f.id == fid);
                        format!("ID={}.{id}", gff_encode(rid))
                    }
                    None => kv.to_string(),
                })
                .collect();
            columns[8] = attrs.join(";");
        }
        out.push(GffLine { columns, feature });
    }
    out
}

/// `--gff3` (D0227 (7)): '##gff-version 3' once, then each selected record's lines of the app's GFF3
/// export after its first, as [`gff3_lines`] rewrites them, in record order.
pub fn genbank_to_gff3(docs: &[SequenceDocument], opts: &GenbankToOptions) -> GenbankToText {
    let mut warnings = Vec::new();
    let mut text = String::from("##gff-version 3\n");
    for (rid, doc) in selected(docs, opts, &mut warnings) {
        for l in gff3_lines(&rid, doc) {
            text.push_str(&l.text());
        }
    }
    GenbankToText {
        text,
        warnings: dedup(warnings),
    }
}

/// `--amr` (D0227 (7)): `<base>.amr.gff`, `<base>.amr.faa` and `<base>.amr.fna`, in that order.
/// The .faa is [`genbank_to_faa`] with simple headers and no pseudogenes, whatever the options say;
/// the .fna is [`genbank_to_fna`]. The .gff is [`genbank_to_gff3`]'s text with no ##FASTA section:
/// a CDS line is kept only when its feature's protein_id heads an .faa record, with its Name value
/// replaced by that protein_id; every other CDS line is dropped and every non-CDS line kept. Each CDS
/// without a protein_id, pseudogenes aside, warns that the .gff has no line for it.
pub fn genbank_to_amrfinder(
    docs: &[SequenceDocument],
    base: &str,
    opts: &GenbankToOptions,
) -> GenbankToFiles {
    let amr = GenbankToOptions {
        records: opts.records.clone(),
        ..GenbankToOptions::default()
    };
    let faa = genbank_to_faa(docs, &amr);
    let fna = genbank_to_fna(docs, &amr);
    let heads: std::collections::HashSet<&str> = faa
        .text
        .lines()
        .filter_map(|l| l.strip_prefix('>'))
        .collect();
    let mut warnings = Vec::new();
    let mut id_warnings = Vec::new();
    let records = selected(docs, &amr, &mut id_warnings);
    for c in cds(&records, &amr) {
        if values(c.feature, "protein_id").is_none() {
            warnings.push(format!(
                "CDS {} has no protein_id, so the AMRFinderPlus .gff has no line for it.",
                c.fid
            ));
        }
    }
    let mut gff = String::from("##gff-version 3\n");
    for (rid, doc) in &records {
        for mut l in gff3_lines(rid, doc) {
            if !l.feature.is_some_and(|f| f.feature_type == "CDS") {
                gff.push_str(&l.text());
                continue;
            }
            let pid = l
                .feature
                .and_then(|f| values(f, "protein_id"))
                .map(|v| v.join("|"))
                .filter(|p| heads.contains(p.as_str()));
            let Some(pid) = pid else { continue };
            let name = format!("Name={}", gff_encode(&pid));
            let mut attrs: Vec<String> = l.columns[8].split(';').map(String::from).collect();
            match attrs.iter_mut().find(|kv| kv.starts_with("Name=")) {
                Some(kv) => *kv = name,
                None => attrs.push(name),
            }
            l.columns[8] = attrs.join(";");
            gff.push_str(&l.text());
        }
    }
    warnings.extend(faa.warnings);
    warnings.extend(fna.warnings);
    GenbankToFiles {
        files: vec![
            (format!("{base}.amr.gff"), gff),
            (format!("{base}.amr.faa"), faa.text),
            (format!("{base}.amr.fna"), fna.text),
        ],
        warnings: dedup(warnings),
    }
}
