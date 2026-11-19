// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! A Rust port of genbank_to 0.54's `--bakta-json` (Rob Edwards, MIT licence,
//! https://github.com/linsalrob/genbank_to; GenBankToLib/genbank_to_json.py and bacteria.py), with
//! its `--gram` and `--translation-table` options (EP-01M7RC9C, D0227, D0228, D0240):
//! [`genbank_to_bakta_json`] writes the genome, stats, features, sequences and version objects
//! 0.54 writes, equal to 0.54's as parsed JSON.
//!
//! Three pieces have no Rust equivalent in the workspace and are written here: [`md5_hex`]
//! (RFC 1321), so the conversion takes no new dependency; [`protein_molecular_weight`], Biopython
//! 1.88's `Bio.SeqUtils.molecular_weight(seq, seq_type="protein")`, summed as Python 3.12's
//! compensated `sum()` sums; and [`protein_isoelectric_point`], Biopython 1.88's
//! `Bio.SeqUtils.IsoelectricPoint.IsoelectricPoint(seq).pi()`, with its pK tables and bisection
//! (Biopython License Agreement). `molbiocraft-protein` computes a molecular weight and a pI for
//! the Protein studio with its own constants; those are not reused here, because Bakta's values
//! must be Biopython's, and they are not changed.
//!
//! Where 0.54 differs from Bakta's own rules this follows 0.54 (D0227), including:
//! - a CDS carrying /pseudo is always kept, marked truncated 'unknown' when nothing else marks it
//!   (D0227 (1));
//! - only the translation tables 0.54 accepts, {1-6, 9-14, 16, 21-31, 33}, are taken (D0227 (10));
//! - a CDS's own /transl_table is ignored: its protein is the genome table's (the option, else 11);
//! - every feature of the five types, not only a CDS, carries its `nt`;
//! - 'truncated' is read from the protein, as 0.54 reads it: '5-prime' when it does not start
//!   with M, '3-prime' when the frame's translation does not end in '*'. The import keeps no
//!   partial marks (D0227 (8)), and 0.54 does not read them either.
//!
//! The version object is `{"genbank_to": "0.54", "molbiocraft": <crate version>}` (D0227 (10)).
//! 0.54 stops with Biopython's TranslationError on a CDS with no /translation whose DNA holds a
//! letter that is no IUPAC nucleotide code; this refuses the same input, naming the CDS.

use crate::genbank_to::{
    dedup, extract, genbank_to_feature_id, metadata, py_space, selected, span, values,
    GenbankToOptions, GenbankToText,
};
use molbiocraft_core::genetic_codes::translate_codon;
use molbiocraft_core::{SequenceDocument, SequenceFeature, Topology};
use serde::Serialize;

/// The translation tables 0.54's `validate_translation_table` accepts (D0227 (10)).
const TABLES: [u32; 25] = [
    1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33,
];

/// The feature types 0.54 writes.
const TYPES: [&str; 5] = ["CDS", "tRNA", "rRNA", "tmRNA", "ncRNA"];

/// What the app's GenBank reader puts in a record's description when it has no DEFINITION text;
/// Biopython's description is then ''.
const NO_DEFINITION: &str = "Imported GenBank document (";

// genbank_to 0.54's bacteria.py (Rob Edwards, MIT licence, https://github.com/linsalrob/genbank_to),
// the genera it takes from Wikipedia's Category:Gram-positive_bacteria and
// Category:Gram-negative_bacteria, copied as data and sorted.
const GRAM_POSITIVE: [&str; 94] = [
    "Absicoccus",
    "Acetatifactor",
    "Acetivibrio",
    "Acetoanaerobium",
    "Actinomyces",
    "Actinomycetota",
    "Aerococcus",
    "Alicyclobacillus",
    "Anaerobutyricum",
    "Anaerostipes",
    "Bacillales",
    "Bacillus",
    "Bavariicoccus",
    "Bifidobacterium",
    "Blautia",
    "Carnobacteriaceae",
    "Catenibacterium",
    "Christensenella",
    "Clostridioides",
    "Clostridium",
    "Coriobacteriia",
    "Corynebacterium",
    "Cutibacterium",
    "Deinococcus",
    "Desulfitobacterium",
    "Effusibacillus",
    "Ellagibacter",
    "Enterocloster",
    "Enterococcus",
    "Faecalicoccus",
    "Fervidobacterium",
    "Floccifex",
    "Fodinibacter",
    "Frisingicoccus",
    "Fusicatenibacter",
    "Granulicatella",
    "Halobacillus",
    "Hathewaya",
    "Hornefia",
    "Inconstantimicrobium",
    "Intestinibaculum",
    "Kribbia",
    "Kyrpidia",
    "Lacrimispora",
    "Lacticaseibacillus",
    "Lactiplantibacillus",
    "Lactobacillus",
    "Lactococcus",
    "Latilactobacillus",
    "Lawsonibacter",
    "Lentilactobacillus",
    "Ligilactobacillus",
    "Limosilactobacillus",
    "Listeriaceae",
    "Macrococcus",
    "Mesobacillus",
    "Microbispora",
    "Mobiluncus",
    "Nocardia",
    "Oceanobacillus",
    "Oliverpabstia",
    "Ornithinibacter",
    "Paraclostridium",
    "Paratractidigestivibacter",
    "Pasteuria",
    "Pauljensenia",
    "Peptoniphilus",
    "Peptostreptococcales",
    "Pilibacter",
    "Propionibacterium",
    "Rhodococcus",
    "Robertmurraya",
    "Roseburia",
    "Rossellomorea",
    "Rothia",
    "Ruminiclostridium",
    "Sarcina",
    "Schaalia",
    "Sharpea",
    "Solibacillus",
    "Sporosarcina",
    "Staphylococcus",
    "Streptococcus",
    "Syntrophomonas",
    "Tepidibacter",
    "Terrisporobacter",
    "Thermoclostridium",
    "Thomasclavelia",
    "Trueperella",
    "Tumebacillus",
    "Turicibacter",
    "Weissella",
    "Winkia",
    "Zhenhengia",
];

const GRAM_NEGATIVE: [&str; 88] = [
    "Acinetobacter",
    "Actinobacillus",
    "Agrobacterium",
    "Akkermansia",
    "Anaerobiospirillum",
    "Anaerolinea",
    "Arcobacter",
    "Azotobacter",
    "Bacteroides",
    "Bartonella",
    "Bibersteinia",
    "Bradyrhizobium",
    "Caldilinea",
    "Cardiobacterium",
    "Chryseobacterium",
    "Coxiella",
    "Dehalogenimonas",
    "Desulfurobacterium",
    "Devosia",
    "Dinoroseobacter",
    "Dysosmobacter",
    "Ekhidna",
    "Enterobacter",
    "Escherichia",
    "Flavobacterium",
    "Fusobacterium",
    "Glaesserella",
    "Gluconacetobacter",
    "Haemophilus",
    "Helicobacter",
    "Kingella",
    "Klebsiella",
    "Kluyvera",
    "Kosakonia",
    "Kozakia",
    "Legionella",
    "Leptonema",
    "Leptotrichia",
    "Levilinea",
    "Lonepinella",
    "Luteimonas",
    "Mannheimia",
    "Meiothermus",
    "Methylobacterium",
    "Methylomirabilis",
    "Mixta",
    "Moraxella",
    "Morganella",
    "Mycoplasma",
    "Neisseria",
    "Nitrosomonas",
    "Novosphingobium",
    "Otariodibacter",
    "Oxalobacter",
    "Paucimonas",
    "Pelistega",
    "Phocaeicola",
    "Pluralibacter",
    "Proteus",
    "Protochlamydia",
    "Pseudoalteromonas",
    "Pseudomonas",
    "Pseudoxanthomonas",
    "Pyramidobacter",
    "Raineya",
    "Rhizorhabdus",
    "Rickettsia",
    "Ruthenibacterium",
    "Salinibacter",
    "Salinicola",
    "Salmonella",
    "Serratia",
    "Sodaliphilus",
    "Solobacterium",
    "Sorangium",
    "Sphaerotilus",
    "Sphingobacterium",
    "Sphingomonas",
    "Sphingosinicella",
    "Stenotrophomonas",
    "Thalassolituus",
    "Thermotoga",
    "Thiomargarita",
    "Tomasiella",
    "Trinickia",
    "Veillonella",
    "Vibrio",
    "Victivallis",
];
#[derive(Serialize)]
struct Bakta {
    genome: Genome,
    stats: Stats,
    features: Vec<Feature>,
    sequences: Vec<Sequence>,
    version: Version,
}

#[derive(Serialize)]
struct Genome {
    genus: String,
    species: String,
    strain: String,
    complete: bool,
    gram: String,
    translation_table: u32,
}

#[derive(Serialize)]
struct Stats {
    no_sequences: usize,
    size: usize,
    gc: f64,
    n_ratio: f64,
    n50: usize,
    coding_ratio: f64,
}

#[derive(Serialize)]
struct SeqStats {
    molecular_weight: f64,
    isoelectric_point: f64,
}

/// One feature, its keys in 0.54's order; an absent key is one 0.54 does not write.
#[derive(Serialize, Default)]
struct Feature {
    #[serde(rename = "type")]
    kind: String,
    contig: String,
    start: usize,
    stop: usize,
    strand: i8,
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gene: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locus: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    db_xrefs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aa: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aa_hexdigest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq_stats: Option<SeqStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hypothetical: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rbs_motif: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    amino_acid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    anti_codon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    anti_codon_pos: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(rename = "class", skip_serializing_if = "Option::is_none")]
    note_class: Option<String>,
}

#[derive(Serialize)]
struct Sequence {
    id: String,
    description: String,
    sequence: String,
    length: usize,
    complete: bool,
    #[serde(rename = "type")]
    kind: String,
    topology: String,
    simple_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Serialize)]
struct Version {
    genbank_to: &'static str,
    molbiocraft: &'static str,
}

/// 0.54's `--bakta-json` over the records the filter keeps, as 0.54's indented JSON text, with the
/// record-id warnings and one for a Gram stain left '?'. It refuses, writing nothing, a Gram stain
/// other than '+' or '-', a translation table outside 0.54's set, no records, and a CDS Biopython
/// cannot translate.
pub fn genbank_to_bakta_json(
    docs: &[SequenceDocument],
    opts: &GenbankToOptions,
) -> Result<GenbankToText, String> {
    if let Some(g) = opts.gram.filter(|g| !matches!(g, '+' | '-')) {
        return Err(format!(
            "Gram stain {g} is not one genbank_to accepts: give '+' or '-'."
        ));
    }
    let table = opts.translation_table.unwrap_or(11);
    if !TABLES.contains(&table) {
        return Err(format!(
            "Translation table {table} is not one genbank_to accepts."
        ));
    }
    let mut warnings = Vec::new();
    let records = selected(docs, opts, &mut warnings);
    if records.is_empty() {
        return Err("No GenBank records to write as Bakta JSON.".to_string());
    }
    let genome = genome(&records, opts, table, &mut warnings);
    let sequences = records
        .iter()
        .map(|(rid, doc)| sequence(rid, doc))
        .collect();
    let mut features = Vec::new();
    for (rid, doc) in &records {
        for f in doc
            .features
            .iter()
            .filter(|f| TYPES.contains(&f.feature_type.as_str()))
        {
            features.push(feature(rid, doc, f, table as u8)?);
        }
    }
    features.sort_by(|a, b| (&a.contig, a.start, a.stop).cmp(&(&b.contig, b.start, b.stop)));
    let bakta = Bakta {
        genome,
        stats: stats(&records),
        features,
        sequences,
        version: Version {
            genbank_to: "0.54",
            molbiocraft: env!("CARGO_PKG_VERSION"),
        },
    };
    let mut text = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(
        &mut text,
        serde_json::ser::PrettyFormatter::with_indent(b"    "),
    );
    bakta.serialize(&mut ser).map_err(|e| e.to_string())?;
    Ok(GenbankToText {
        text: String::from_utf8(text).map_err(|e| e.to_string())?,
        warnings: dedup(warnings),
    })
}

/// Python's `str.split()`: the runs of non-space text.
fn py_words(s: &str) -> Vec<&str> {
    s.split(py_space).filter(|w| !w.is_empty()).collect()
}

/// Python's `int(text)` for ASCII digits: surrounding space, an optional sign, and '_' between
/// digits; none where Python raises ValueError.
fn py_int(text: &str) -> Option<i64> {
    let t = text.trim_matches(py_space);
    let (neg, digits) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    let ok = !digits.is_empty()
        && !digits.starts_with('_')
        && !digits.ends_with('_')
        && !digits.contains("__")
        && digits.bytes().all(|b| b.is_ascii_digit() || b == b'_');
    if !ok {
        return None;
    }
    let n: i64 = digits.replace('_', "").parse().ok()?;
    Some(if neg { -n } else { n })
}

/// Python's `s[start:end]` over characters, negative indices counting from the end.
fn py_slice(s: &str, start: i64, end: Option<i64>) -> String {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len() as i64;
    let clamp = |i: i64| if i < 0 { (i + len).max(0) } else { i.min(len) };
    let (a, b) = (clamp(start), clamp(end.unwrap_or(len)));
    if a >= b {
        return String::new();
    }
    chars[a as usize..b as usize].iter().collect()
}

/// Biopython's `record.description`: the DEFINITION text, '' without one.
fn description(doc: &SequenceDocument) -> &str {
    let d = doc.description.as_str();
    if d.starts_with(NO_DEFINITION) && d.ends_with(')') {
        ""
    } else {
        d
    }
}

/// Biopython's `record.name`, the LOCUS name (D0240).
fn locus_name(doc: &SequenceDocument) -> &str {
    metadata(doc, "LOCUS name").unwrap_or(&doc.name)
}

/// Whether a record's COMMENT holds 'complete' in any case.
fn comment_complete(doc: &SequenceDocument) -> bool {
    metadata(doc, "Comment").is_some_and(|c| c.to_lowercase().contains("complete"))
}

/// 0.54's `extract_genome_metadata`: the organism, completeness and Gram stain of the first record,
/// any circular record making the genome complete.
fn genome(
    records: &[(String, &SequenceDocument)],
    opts: &GenbankToOptions,
    table: u32,
    warnings: &mut Vec<String>,
) -> Genome {
    let first = records[0].1;
    let words = metadata(first, "Organism")
        .map(py_words)
        .unwrap_or_default();
    let word = |i: usize| words.get(i).map_or("NA".to_string(), |w| w.to_string());
    let strain = if words.len() >= 3 {
        words[2..].join(" ")
    } else {
        "NA".to_string()
    };
    let genus = word(0);
    let complete = comment_complete(first)
        || description(first)
            .to_lowercase()
            .contains("complete genome")
        || records
            .iter()
            .any(|(_, d)| d.topology == Topology::Circular);
    let gram = match opts.gram {
        Some(g) => g.to_string(),
        None if GRAM_POSITIVE.contains(&genus.as_str()) => "+".to_string(),
        None if GRAM_NEGATIVE.contains(&genus.as_str()) => "-".to_string(),
        None => {
            warnings.push(if words.is_empty() {
                "The first record names no organism, so the Gram stain is '?'.".to_string()
            } else {
                format!("Genus {genus} is in neither of genbank_to's Gram stain lists, so the Gram stain is '?'.")
            });
            "?".to_string()
        }
    };
    Genome {
        species: word(1),
        genus,
        strain,
        complete,
        gram,
        translation_table: table,
    }
}

/// 0.54's `create_sequence_object`.
fn sequence(rid: &str, doc: &SequenceDocument) -> Sequence {
    let circular = doc.topology == Topology::Circular;
    let d = description(doc).to_lowercase();
    let kind = if d.contains("chromosome") {
        "chromosome"
    } else if d.contains("plasmid") {
        "plasmid"
    } else if d.contains("contig") {
        "contig"
    } else {
        "sequence"
    };
    let name = locus_name(doc);
    Sequence {
        id: rid.to_string(),
        description: description(doc).to_string(),
        sequence: doc.sequence.to_ascii_uppercase(),
        length: doc.sequence.len(),
        complete: comment_complete(doc) || circular,
        kind: kind.to_string(),
        topology: if circular { "circular" } else { "linear" }.to_string(),
        simple_id: rid.split('.').next().unwrap_or(rid).to_string(),
        name: (!name.is_empty() && name != rid && name != "<unknown name>")
            .then(|| name.to_string()),
    }
}

/// 0.54's `calculate_stats`: GC over A, C, G and T only, N over every base, n50, and the share of
/// bases inside any CDS's start..end, pseudogenes included.
fn stats(records: &[(String, &SequenceDocument)]) -> Stats {
    let (mut gc, mut acgt, mut n, mut total, mut coding) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut lengths = Vec::new();
    for (_, doc) in records {
        let seq = doc.sequence.to_ascii_uppercase();
        let count = |c: u8| seq.bytes().filter(|&b| b == c).count();
        gc += count(b'G') + count(b'C');
        acgt += count(b'A') + count(b'C') + count(b'G') + count(b'T');
        n += count(b'N');
        total += seq.len();
        lengths.push(seq.len());
        let mut mask = vec![false; seq.len()];
        for f in doc.features.iter().filter(|f| f.feature_type == "CDS") {
            let (start, end) = span(f);
            for m in mask.iter_mut().take(end).skip(start.saturating_sub(1)) {
                *m = true;
            }
        }
        coding += mask.iter().filter(|&&m| m).count();
    }
    let ratio = |a: usize, b: usize| if b > 0 { a as f64 / b as f64 } else { 0.0 };
    Stats {
        no_sequences: records.len(),
        size: total,
        gc: ratio(gc, acgt),
        n_ratio: ratio(n, total),
        n50: n50(&lengths),
        coding_ratio: ratio(coding, total),
    }
}

/// 0.54's `calculate_n50`: the length at which the longest-first running total reaches half.
fn n50(lengths: &[usize]) -> usize {
    let mut sorted = lengths.to_vec();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    let half = sorted.iter().sum::<usize>() as f64 / 2.0;
    let mut running = 0usize;
    for &l in &sorted {
        running += l;
        if running as f64 >= half {
            return l;
        }
    }
    sorted.last().copied().unwrap_or(0)
}

/// Biopython's `Seq(nt).translate(table)` over whole codons (a partial last codon is dropped, as
/// Biopython drops it), or the first codon holding a letter that is no IUPAC nucleotide code,
/// where Biopython raises TranslationError.
fn translate(nt: &str, table: u8) -> Result<String, String> {
    let bytes = nt.as_bytes();
    let mut aa = String::with_capacity(bytes.len() / 3);
    for codon in bytes.as_chunks::<3>().0 {
        if !codon
            .iter()
            .all(|b| b"ACGTURYSWKMBDHVN".contains(&b.to_ascii_uppercase()))
        {
            return Err(String::from_utf8_lossy(codon).into_owned());
        }
        aa.push(translate_codon(codon, table) as char);
    }
    Ok(aa)
}

/// The first value of a qualifier.
fn first(f: &SequenceFeature, key: &str) -> Option<String> {
    values(f, key).map(|v| v[0].to_string())
}

/// 0.54's `create_feature_object` for one feature of the five types.
fn feature(
    rid: &str,
    doc: &SequenceDocument,
    f: &SequenceFeature,
    table: u8,
) -> Result<Feature, String> {
    let (start, stop) = span(f);
    let nt = extract(doc, f);
    let mut o = Feature {
        kind: f.feature_type.clone(),
        contig: rid.to_string(),
        start,
        stop,
        strand: if f.strand < 0 { -1 } else { 1 },
        product: first(f, "product"),
        gene: first(f, "gene"),
        locus: ["locus_tag", "protein_id", "old_locus_tag"]
            .iter()
            .find_map(|k| first(f, k))
            .filter(|l| !l.is_empty()),
        db_xrefs: values(f, "db_xref").map(|v| {
            let mut x: Vec<String> = v.iter().map(|s| s.to_string()).collect();
            x.sort();
            x
        }),
        nt: (!nt.is_empty()).then(|| nt.clone()),
        ..Feature::default()
    };
    if f.feature_type == "CDS" {
        cds_fields(&mut o, rid, f, &nt, table)?;
    }
    if f.feature_type == "tRNA" {
        trna_fields(&mut o, f);
    }
    o.label = first(f, "label");
    o.note_class = f
        .notes
        .as_deref()
        .and_then(|n| n.split('\n').next())
        .filter(|n| n.to_lowercase().contains("class:"))
        .map(String::from);
    Ok(o)
}

/// The CDS keys: frame, aa, aa_hexdigest, seq_stats, hypothetical, start_type, rbs_motif and
/// truncated, as 0.54 reads them.
fn cds_fields(
    o: &mut Feature,
    rid: &str,
    f: &SequenceFeature,
    nt: &str,
    table: u8,
) -> Result<(), String> {
    o.frame = values(f, "codon_start")
        .and_then(|v| py_int(v[0]))
        .map(|c| c - 1);
    let frame = o.frame.unwrap_or(0);
    let framed = py_slice(nt, frame, None);
    let aa = match first(f, "translation") {
        Some(t) => t,
        None if !nt.is_empty() => translate(&framed, table)
            .map_err(|codon| {
                format!(
                    "CDS {} in {rid} holds the codon '{codon}', which Biopython cannot translate, so genbank_to writes no Bakta JSON.",
                    genbank_to_feature_id(rid, f)
                )
            })?
            .trim_end_matches('*')
            .to_string(),
        None => String::new(),
    };
    if !aa.is_empty() {
        o.aa_hexdigest = Some(md5_hex(aa.as_bytes()));
        o.seq_stats = protein_molecular_weight(&aa).map(|molecular_weight| SeqStats {
            molecular_weight,
            isoelectric_point: protein_isoelectric_point(&aa),
        });
    }
    if o.product
        .as_deref()
        .unwrap_or("")
        .to_lowercase()
        .contains("hypothetical")
    {
        o.hypothetical = Some(true);
    }
    o.start_type = Some(
        if !nt.is_empty() && nt.chars().count() as i64 >= frame + 3 {
            py_slice(nt, frame, Some(frame + 3)).to_uppercase()
        } else {
            "NA".to_string()
        },
    );
    o.rbs_motif = Some(first(f, "ribosome_binding_site").unwrap_or_else(|| "NA".to_string()));
    // The frame's translation, every '*' kept; none when there is no DNA or Biopython raises.
    let raw = (!nt.is_empty())
        .then(|| translate(&framed, table).ok())
        .flatten();
    let mut parts = Vec::new();
    if !aa.is_empty() {
        if !aa.starts_with('M') {
            parts.push("5-prime");
        }
        let three = match &raw {
            Some(r) => !r.ends_with('*'),
            None => aa.ends_with('*'),
        };
        if three {
            parts.push("3-prime");
        }
        if !parts.is_empty() {
            o.truncated = Some(parts.join("-"));
        }
    }
    if o.truncated.is_none() && (values(f, "truncated").is_some() || values(f, "pseudo").is_some())
    {
        o.truncated = Some("unknown".to_string());
    }
    o.aa = (!aa.is_empty()).then_some(aa);
    Ok(())
}

/// The tRNA keys, in 0.54's order; 0.54's parse stops at the first IndexError or ValueError, so the
/// keys after it are left out (a 'tRNA-' product with no word after it, a position such as
/// 'complement(130' that is no integer).
fn trna_fields(o: &mut Feature, f: &SequenceFeature) {
    if let Some(product) = first(f, "product") {
        if product.contains("tRNA-") {
            let after = product.split("tRNA-").nth(1).unwrap_or("");
            match py_words(after).first() {
                Some(aa) => o.amino_acid = Some(aa.to_string()),
                None => return,
            }
        }
    }
    let Some(info) = first(f, "anticodon") else {
        return;
    };
    if info.contains("seq:") {
        let seq = info.split("seq:").nth(1).unwrap_or("");
        o.anti_codon = Some(seq.trim_end_matches(')').to_string());
    }
    if info.contains("pos:") {
        let pos = info
            .split("pos:")
            .nth(1)
            .unwrap_or("")
            .split(',')
            .next()
            .unwrap_or("");
        if pos.contains("..") {
            o.anti_codon_pos = py_int(pos.split("..").next().unwrap_or(""));
        }
    }
}

/// MD5 (RFC 1321) of `bytes`, as 32 lower-case hex digits: Python's `hashlib.md5(b).hexdigest()`.
pub fn md5_hex(bytes: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    // T[i] = floor(2^32 * |sin(i + 1)|), RFC 1321 section 3.4.
    let t: Vec<u32> = (0..64)
        .map(|i| ((i as f64 + 1.0).sin().abs() * 4_294_967_296.0) as u32)
        .collect();
    let mut msg = bytes.to_vec();
    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    let (mut a0, mut b0, mut c0, mut d0) = (
        0x6745_2301u32,
        0xefcd_ab89u32,
        0x98ba_dcfeu32,
        0x1032_5476u32,
    );
    for block in msg.as_chunks::<64>().0 {
        let m: Vec<u32> = block
            .as_chunks::<4>()
            .0
            .iter()
            .map(|w| u32::from_le_bytes(*w))
            .collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a
                .wrapping_add(f)
                .wrapping_add(t[i])
                .wrapping_add(m[g])
                .rotate_left(S[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    [a0, b0, c0, d0]
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Biopython 1.88's average amino-acid weights (`Bio.Data.IUPACData.protein_weights`).
fn protein_weight(c: char) -> Option<f64> {
    Some(match c {
        'A' => 89.0932,
        'C' => 121.1582,
        'D' => 133.1027,
        'E' => 147.1293,
        'F' => 165.1891,
        'G' => 75.0666,
        'H' => 155.1546,
        'I' => 131.1729,
        'K' => 146.1876,
        'L' => 131.1729,
        'M' => 149.2113,
        'N' => 132.1179,
        'O' => 255.3134,
        'P' => 115.1305,
        'Q' => 146.1445,
        'R' => 174.201,
        'S' => 105.0926,
        'T' => 119.1192,
        'U' => 168.0532,
        'V' => 117.1463,
        'W' => 204.2252,
        'Y' => 181.1885,
        _ => return None,
    })
}

/// Biopython 1.88's `molecular_weight(seq, seq_type="protein")`: white space removed, upper case,
/// the weights summed as Python 3.12's `sum()` sums floats (Neumaier's compensated summation),
/// less one water (18.0153) per peptide bond. None where Biopython raises ValueError, a letter
/// outside its weights (X, B, Z, J, '*').
pub fn protein_molecular_weight(aa: &str) -> Option<f64> {
    let seq: String = aa
        .chars()
        .filter(|&c| !py_space(c))
        .flat_map(char::to_uppercase)
        .collect();
    let (mut sum, mut comp) = (0.0f64, 0.0f64);
    let mut len = 0usize;
    for c in seq.chars() {
        let x = protein_weight(c)?;
        let t = sum + x;
        if sum.abs() >= x.abs() {
            comp += (sum - t) + x;
        } else {
            comp += (x - t) + sum;
        }
        sum = t;
        len += 1;
    }
    if comp != 0.0 && comp.is_finite() {
        sum += comp;
    }
    Some(sum - (len as f64 - 1.0) * 18.0153)
}

/// Biopython 1.88's `IsoelectricPoint(seq).pi()` (Bjellqvist's pKs): the charge of the upper-case
/// sequence's K, R, H, D, E, C and Y and its termini, the N-terminal pK set by the first residue
/// and the C-terminal by the last, bisected from 7.775 in [4.05, 12] until the interval is 0.0001
/// or less wide.
pub fn protein_isoelectric_point(aa: &str) -> f64 {
    let seq: Vec<char> = aa.chars().flat_map(char::to_uppercase).collect();
    let count = |c: char| seq.iter().filter(|&&x| x == c).count() as f64;
    let n_term = match seq.first() {
        Some('A') => 7.59,
        Some('M') => 7.0,
        Some('S') => 6.93,
        Some('P') => 8.36,
        Some('T') => 6.82,
        Some('V') => 7.44,
        Some('E') => 7.7,
        _ => 7.5,
    };
    let c_term = match seq.last() {
        Some('D') => 4.55,
        Some('E') => 4.75,
        _ => 3.55,
    };
    // Biopython's dict order: Nterm, K, R, H; then Cterm, D, E, C, Y.
    let positive = [
        (1.0, n_term),
        (count('K'), 10.0),
        (count('R'), 12.0),
        (count('H'), 5.98),
    ];
    let negative = [
        (1.0, c_term),
        (count('D'), 4.05),
        (count('E'), 4.45),
        (count('C'), 9.0),
        (count('Y'), 10.0),
    ];
    let charge = |ph: f64| {
        let mut pos = 0.0;
        for (n, pk) in positive {
            pos += n * (1.0 / (10f64.powf(ph - pk) + 1.0));
        }
        let mut neg = 0.0;
        for (n, pk) in negative {
            neg += n * (1.0 / (10f64.powf(pk - ph) + 1.0));
        }
        pos - neg
    };
    let (mut ph, mut lo, mut hi) = (7.775f64, 4.05f64, 12.0f64);
    while hi - lo > 0.0001 {
        if charge(ph) > 0.0 {
            lo = ph;
        } else {
            hi = ph;
        }
        ph = (lo + hi) / 2.0;
    }
    ph
}
