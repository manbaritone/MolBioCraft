// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The genbank_to port (US-01M7RC3P, US-01M7RC56, D0227, D0228, D0240) against genbank_to 0.54's own output on the
//! hand-written fixture `fixtures/genbank_to/oracle.gbk`. The expected files, the command lines that
//! wrote them and every line changed by hand (with its D0227 item) are in that folder's README.md.

use molbiocraft_core::SequenceDocument;
use molbiocraft_formats::genbank_to::{
    genbank_record_id, genbank_to_amrfinder, genbank_to_faa, genbank_to_fna, genbank_to_functions,
    genbank_to_gbk_files, genbank_to_gff3, genbank_to_orfs, genbank_to_phage_finder,
    genbank_to_ptt, genbank_to_separate, split_genbank_records, GenbankToOptions,
    GenbankToSequenceOutput,
};
use molbiocraft_formats::{export_genbank_flatfile, export_gff3_noodles, parse_genbank_flatfile};

const ORACLE: &str = include_str!("fixtures/genbank_to/oracle.gbk");
const FNA: &str = include_str!("fixtures/genbank_to/expected/oracle.fna");
const ORFS: &str = include_str!("fixtures/genbank_to/expected/oracle.orfs");
const PSEUDO_ORFS: &str = include_str!("fixtures/genbank_to/expected/oracle.pseudo.orfs");
const FAA: &str = include_str!("fixtures/genbank_to/expected/oracle.faa");
const PSEUDO_FAA: &str = include_str!("fixtures/genbank_to/expected/oracle.pseudo.faa");
const FUNCTIONS: &str = include_str!("fixtures/genbank_to/expected/oracle.functions.tsv");
const PSEUDO_FUNCTIONS: &str =
    include_str!("fixtures/genbank_to/expected/oracle.pseudo.functions.tsv");
const PTT: &str = include_str!("fixtures/genbank_to/expected/oracle.ptt");
const PHAGE_FINDER: &str = include_str!("fixtures/genbank_to/expected/oracle.phage_finder.tsv");

const NO_VERSION_WARNING: &str =
    "Record OR000003 has no VERSION line, so its accession is used as its id.";

fn records() -> Vec<SequenceDocument> {
    split_genbank_records(ORACLE)
        .iter()
        .map(|r| parse_genbank_flatfile(r, "oracle"))
        .collect()
}

fn opts() -> GenbankToOptions {
    GenbankToOptions::default()
}

fn pseudo() -> GenbankToOptions {
    GenbankToOptions {
        include_pseudogenes: true,
        ..GenbankToOptions::default()
    }
}

fn complex() -> GenbankToOptions {
    GenbankToOptions {
        complex_headers: true,
        ..GenbankToOptions::default()
    }
}

fn keep(ids: &[&str]) -> GenbankToOptions {
    GenbankToOptions {
        records: ids.iter().map(|s| s.to_string()).collect(),
        ..GenbankToOptions::default()
    }
}

/// The FASTA record headed `>header` in `fasta`: its one sequence line.
fn fasta_seq<'a>(fasta: &'a str, header: &str) -> Option<&'a str> {
    let lines: Vec<&str> = fasta.lines().collect();
    lines
        .iter()
        .position(|l| *l == format!(">{header}"))
        .and_then(|i| lines.get(i + 1).copied())
}

fn headers(fasta: &str) -> Vec<&str> {
    fasta.lines().filter_map(|l| l.strip_prefix('>')).collect()
}

/// The lines of `text` that belong to record `id`: FASTA records whose header follows that record's,
/// or functions lines starting with it.
fn record_lines(
    text: &str,
    all: &[SequenceDocument],
    id: &str,
    out: GenbankToSequenceOutput,
) -> String {
    let doc = all
        .iter()
        .find(|d| genbank_record_id(d) == id)
        .expect("record");
    let one = std::slice::from_ref(doc);
    match out {
        GenbankToSequenceOutput::Nucleotides => genbank_to_fna(one, &opts()).text,
        GenbankToSequenceOutput::CdsDna => genbank_to_orfs(one, &opts()).text,
        GenbankToSequenceOutput::Proteins => genbank_to_faa(one, &opts()).text,
    }
    .lines()
    .inspect(|l| assert!(text.contains(l), "{l} is a line of the joined output"))
    .map(|l| format!("{l}\n"))
    .collect()
}

#[test]
fn nucleotides_match_genbank_to() {
    let docs = records();
    let out = genbank_to_fna(&docs, &opts());
    assert_eq!(out.text, FNA);
    assert_eq!(headers(&out.text), ["OR000001.1", "OR000002.1", "OR000003"]);
    // Upper case and unwrapped: one line per record, longer than any FASTA wrap.
    assert_eq!(fasta_seq(&out.text, "OR000001.1").map(str::len), Some(720));
    assert!(out
        .text
        .lines()
        .all(|l| l.starts_with('>') || l.bytes().all(|b| b.is_ascii_uppercase())));
    assert_eq!(out.warnings, [NO_VERSION_WARNING]);
}

#[test]
fn orfs_match_genbank_to_with_and_without_pseudogenes() {
    let docs = records();
    let plain = genbank_to_orfs(&docs, &opts());
    assert_eq!(plain.text, ORFS);
    assert!(
        fasta_seq(&plain.text, "ORP00006.1").is_none(),
        "CDS (f), /pseudo, is left out (D0227 (1))"
    );
    let with_pseudo = genbank_to_orfs(&docs, &pseudo());
    assert_eq!(with_pseudo.text, PSEUDO_ORFS);
    assert_eq!(
        fasta_seq(&with_pseudo.text, "ORP00006.1"),
        Some("ATGACCCAGCCGCTGCTGCATCGTGCTTAA")
    );
    // complement(41..70), join(81..110,121..150) and complement(join(161..190,201..230)).
    assert_eq!(
        fasta_seq(&plain.text, "ORT_0002"),
        Some("ATGGCNAAANNNGGCTGCCATGAAACCTAA")
    );
    assert_eq!(
        fasta_seq(&plain.text, "GeneID:3"),
        Some("ATGTCTGATGAATTTGGCCATATTAAACTGATGAACCCGCAGCGTTCTACCGTGTGGTAA")
    );
    assert_eq!(
        fasta_seq(&plain.text, "OR000001.1.join{[200:230](-), [160:190](-)}"),
        Some("ATGGATAACCCGCAGCGTTCTACCGTGTGGTATGCTTGCGATGAATTTGGCCATATTTAA")
    );
    // The CDS of OR000002.1 on the complement strand.
    assert_eq!(
        fasta_seq(&plain.text, "ORT2_0002"),
        Some("ATGAACGATCTGAAAGCTGGCGTGTTTTAA")
    );
}

#[test]
fn proteins_match_genbank_to() {
    let docs = records();
    let plain = genbank_to_faa(&docs, &opts());
    assert_eq!(plain.text, FAA);
    assert_eq!(genbank_to_faa(&docs, &pseudo()).text, PSEUDO_FAA);
    // /translation is the protein as written (it has no '*'; the extract's translation would).
    assert_eq!(fasta_seq(&plain.text, "ORP00001.1"), Some("MKTAYIAKQR"));
    // GCN reads A and NNN reads X; every '*' is kept.
    assert_eq!(fasta_seq(&plain.text, "ORT_0002"), Some("MAKXGCHET*"));
    // /transl_table=4 reads TGA as W (D0227 (6)); table 1 would give MK*PG*.
    assert_eq!(fasta_seq(&plain.text, "ORT_0008"), Some("MKWPG*"));
    // /codon_start=2 is ignored: the whole extract is translated from its first base.
    assert_eq!(fasta_seq(&plain.text, "ORT_0009"), Some("MRTDKGFLH*"));
    // CDS (g), 20 bp with no /translation, is left out with its warning.
    assert!(fasta_seq(&plain.text, "ORT_0007").is_none());
    assert_eq!(
        plain.warnings,
        [
            "CDS ORT_0007 in OR000001.1 was left out of the proteins: its length (20 bp) is not a multiple of 3 and it has no /translation.",
            NO_VERSION_WARNING,
        ]
    );
}

#[test]
fn functions_and_feature_ids_match_genbank_to() {
    let docs = records();
    let plain = genbank_to_functions(&docs, &opts());
    assert_eq!(plain.text, FUNCTIONS);
    assert_eq!(
        genbank_to_functions(&docs, &pseudo()).text,
        PSEUDO_FUNCTIONS
    );
    let lines: Vec<&str> = plain.text.lines().collect();
    // The two fallback ids: 0-based start, and a minus-strand join's parts in transcription order.
    assert!(lines.contains(&"OR000001.1\tOR000001.1.[240:270](+)\tEpsilon test protein"));
    assert!(lines
        .contains(&"OR000001.1\tOR000001.1.join{[200:230](-), [160:190](-)}\tDelta test protein"));
    // A CDS with no product, and one with two.
    assert!(lines.contains(&"OR000001.1\tGeneID:3\tHypothetical protein"));
    assert!(lines.contains(&"OR000001.1\tORP00010.1\tKappa test protein|Kappa alternative name"));
    // protein_id > locus_tag > db_xref, repeated db_xrefs joined by '|'.
    assert!(lines.contains(&"OR000001.1\tGeneID:9|GI:55\tMu test protein"));
    assert!(lines.contains(&"OR000001.1\tORT_0002\tBeta test protein"));
    assert!(
        !plain.text.contains("ORP00006.1"),
        "CDS (f) is left out as 0.54's -f leaves it out"
    );
}

#[test]
fn complex_headers_follow_d0227() {
    let docs = records();
    let org = "[Escherichia coli K-12]";
    let want = [
        format!("ORP00001.1 [OR000001.1] {org} [OR000001.1_1_33] Alpha test protein [GI:123456; GeneID:7]"),
        format!("ORT_0002 [OR000001.1] {org} [OR000001.1_70_41] Beta test protein"),
        format!("GeneID:3 [OR000001.1] {org} [OR000001.1_81_150] [hypothetical protein] [GeneID:3]"),
        format!("OR000001.1.join{{[200:230](-), [160:190](-)}} [OR000001.1] {org} [OR000001.1_230_161] Delta test protein"),
        format!("OR000001.1.[240:270](+) [OR000001.1] {org} [OR000001.1_241_270] Epsilon test protein"),
        format!("ORT_0007 [OR000001.1] {org} [OR000001.1_321_340] Eta short protein"),
        format!("ORT_0008 [OR000001.1] {org} [OR000001.1_351_368] Theta table four protein"),
        format!("ORT_0009 [OR000001.1] {org} [OR000001.1_381_410] Iota frame protein"),
        format!("ORP00010.1 [OR000001.1] {org} [OR000001.1_421_450] Kappa test protein"),
        format!("ORP00011.1 [OR000001.1] {org} [OR000001.1_461_490] hypothetical protein"),
        format!("ORP00012.1 [OR000001.1] {org} [OR000001.1_501_530] COG0001 test family."),
        format!("GeneID:9|GI:55 [OR000001.1] {org} [OR000001.1_541_570] Mu test protein [GeneID:9; GI:55]"),
        "ORP20001.1 [OR000002.1] [OR000002.1_11_40] Plasmid replication protein".to_string(),
        "ORT2_0002 [OR000002.1] [OR000002.1_80_51] Plasmid partition protein".to_string(),
        "ORP30001.1 [OR000003] [OR000003_1_30] Contig protein".to_string(),
    ];
    let orfs = genbank_to_orfs(&docs, &complex()).text;
    assert_eq!(
        headers(&orfs),
        want.iter().map(String::as_str).collect::<Vec<_>>()
    );
    // The same records as the plain ORFs, only the headers differ.
    let plain_seqs: Vec<&str> = ORFS.lines().filter(|l| !l.starts_with('>')).collect();
    assert_eq!(
        orfs.lines()
            .filter(|l| !l.starts_with('>'))
            .collect::<Vec<_>>(),
        plain_seqs
    );
    let faa = genbank_to_faa(&docs, &complex()).text;
    let without_g: Vec<&str> = want
        .iter()
        .map(String::as_str)
        .filter(|h| !h.starts_with("ORT_0007 "))
        .collect();
    assert_eq!(headers(&faa), without_g);
    assert_eq!(fasta_seq(&faa, &want[0]), Some("MKTAYIAKQR"));
}

#[test]
fn record_filter_and_separate_files() {
    let docs = records();
    let all = |o: &GenbankToOptions| {
        [
            genbank_to_fna(&docs, o).text,
            genbank_to_orfs(&docs, o).text,
            genbank_to_faa(&docs, o).text,
            genbank_to_functions(&docs, o).text,
        ]
    };
    let two = all(&keep(&["OR000002.1"]));
    assert_eq!(
        two,
        [
            format!(">OR000002.1\n{}\n", fasta_seq(FNA, "OR000002.1").unwrap()),
            ">ORP20001.1\nATGTCTACCCGTAAACCGCAGGAAGCTTAA\n>ORT2_0002\nATGAACGATCTGAAAGCTGGCGTGTTTTAA\n".to_string(),
            ">ORP20001.1\nMSTRKPQEA\n>ORT2_0002\nMNDLKAGVF*\n".to_string(),
            "OR000002.1\tORP20001.1\tPlasmid replication protein\nOR000002.1\tORT2_0002\tPlasmid partition protein\n".to_string(),
        ]
    );
    // The id without its version selects the same record.
    assert_eq!(all(&keep(&["OR000002"])), two);
    // A filter that leaves OR000003 out leaves out its warning too.
    assert!(genbank_to_fna(&docs, &keep(&["OR000002"]))
        .warnings
        .is_empty());
    assert_eq!(
        genbank_to_fna(&docs, &keep(&["OR000003"])).text,
        format!(">OR000003\n{}\n", fasta_seq(FNA, "OR000003").unwrap())
    );

    // One file per record: '<base>.<record id>.<ext>', each that record's lines of the joined output.
    for (out, ext, joined) in [
        (GenbankToSequenceOutput::Nucleotides, "fna", FNA),
        (GenbankToSequenceOutput::Proteins, "faa", FAA),
        (GenbankToSequenceOutput::CdsDna, "orfs", ORFS),
    ] {
        let files = genbank_to_separate(&docs, out, "oracle", &opts());
        let names: Vec<&str> = files.files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            [
                format!("oracle.OR000001.1.{ext}"),
                format!("oracle.OR000002.1.{ext}"),
                format!("oracle.OR000003.{ext}")
            ]
        );
        for ((_, text), id) in files
            .files
            .iter()
            .zip(["OR000001.1", "OR000002.1", "OR000003"])
        {
            assert_eq!(
                text,
                &record_lines(joined, &docs, id, out),
                "{ext} file of {id}"
            );
            assert!(!text.is_empty());
        }
        assert_eq!(
            files
                .files
                .iter()
                .map(|(_, t)| t.as_str())
                .collect::<String>(),
            joined,
            "{ext}: the files together are the joined output"
        );
        // The record filter applies to one file per record too.
        let kept = genbank_to_separate(&docs, out, "oracle", &keep(&["OR000002"]));
        assert_eq!(kept.files.len(), 1);
        assert_eq!(kept.files[0].0, format!("oracle.OR000002.1.{ext}"));
    }

    // A record with no CDS has no ORF or protein file, as 0.54 opens none for it.
    let mut no_cds = docs[2].clone();
    no_cds.features.clear();
    let pair = [docs[1].clone(), no_cds];
    for out in [
        GenbankToSequenceOutput::CdsDna,
        GenbankToSequenceOutput::Proteins,
    ] {
        let names: Vec<String> = genbank_to_separate(&pair, out, "b", &opts())
            .files
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        assert_eq!(
            names,
            [format!(
                "b.OR000002.1.{}",
                if out == GenbankToSequenceOutput::CdsDna {
                    "orfs"
                } else {
                    "faa"
                }
            )]
        );
    }

    // One file per record with no output chosen: '<record id>.gbk', the app's own GenBank export.
    let gbk = genbank_to_gbk_files(&docs, &opts());
    let want: Vec<(String, String)> = docs
        .iter()
        .zip(["OR000001.1", "OR000002.1", "OR000003"])
        .map(|(d, id)| (format!("{id}.gbk"), export_genbank_flatfile(d)))
        .collect();
    assert_eq!(gbk.files, want);
    assert_eq!(gbk.warnings, [NO_VERSION_WARNING]);
    assert_eq!(
        genbank_to_gbk_files(&docs, &keep(&["OR000001.1"])).files,
        want[..1].to_vec()
    );
}

#[test]
fn import_keeps_version_organism_and_comment() {
    let texts = split_genbank_records(ORACLE);
    assert_eq!(texts.len(), 3);
    assert!(texts
        .iter()
        .all(|t| t.starts_with("LOCUS") && t.ends_with("//\n")));
    assert_eq!(texts.concat(), ORACLE, "the split keeps every line");
    // Text after the last "//" with no LOCUS line is no record.
    assert_eq!(
        split_genbank_records(&format!("{ORACLE}\nnot a record\n")).len(),
        3
    );
    let docs = records();
    let meta = |d: &SequenceDocument, k: &str| {
        d.doc_metadata
            .as_ref()
            .and_then(|m| m.get(k))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    assert_eq!(meta(&docs[0], "Version").as_deref(), Some("OR000001.1"));
    assert_eq!(
        meta(&docs[0], "Organism").as_deref(),
        Some("Escherichia coli K-12")
    );
    assert_eq!(
        meta(&docs[0], "Comment").as_deref(),
        Some("Hand-written test record for the MolBioCraft genbank_to port;\nit holds no third-party data. Complete test genome.")
    );
    assert_eq!(meta(&docs[1], "Version").as_deref(), Some("OR000002.1"));
    assert_eq!(
        (meta(&docs[1], "Organism"), meta(&docs[1], "Comment")),
        (None, None)
    );
    assert_eq!(meta(&docs[2], "Version"), None);
    // Record ids: Version, else the ACCESSION token, else the LOCUS name.
    assert_eq!(
        docs.iter().map(genbank_record_id).collect::<Vec<_>>(),
        ["OR000001.1", "OR000002.1", "OR000003"]
    );
    assert_eq!(
        genbank_to_functions(&docs, &opts()).warnings,
        [NO_VERSION_WARNING]
    );
    let bare = parse_genbank_flatfile(
        "LOCUS       BARE1                     30 bp    DNA     linear   BCT 19-NOV-2026\nDEFINITION  No accession.\nFEATURES             Location/Qualifiers\n     CDS             1..30\n                     /locus_tag=\"B_1\"\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n",
        "bare",
    );
    assert_eq!(genbank_record_id(&bare), "BARE1");
    let bare_out = genbank_to_functions(std::slice::from_ref(&bare), &opts());
    assert_eq!(bare_out.text, "BARE1\tB_1\tHypothetical protein\n");
    assert_eq!(
        bare_out.warnings,
        ["Record BARE1 has no VERSION or ACCESSION line, so its LOCUS name is used as its id."]
    );

    // US-01M6P2KY's 'MolBioCraft name:' line is a COMMENT line like any other: Comment keeps it, as
    // Biopython does, and it still names the document.
    let named = parse_genbank_flatfile(
        "LOCUS       Long_name                 30 bp    DNA     linear   BCT 19-NOV-2026\nACCESSION   AB000001\nVERSION     AB000001.2\nCOMMENT     MolBioCraft name: Long name with spaces\n            A second line.\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n",
        "named",
    );
    assert_eq!(named.name, "Long name with spaces");
    assert_eq!(
        meta(&named, "Comment").as_deref(),
        Some("MolBioCraft name: Long name with spaces\nA second line.")
    );
    assert_eq!(genbank_record_id(&named), "AB000001.2");

    // A structured comment table is kept out of Comment, and a second COMMENT block follows the
    // first: Biopython 1.88 reads this record's comment as exactly this text.
    let structured = parse_genbank_flatfile(
        "LOCUS       SC000001                  30 bp    DNA     linear   BCT 19-NOV-2026\nACCESSION   SC000001\nVERSION     SC000001.1\nCOMMENT     PROVISIONAL REFSEQ: plain line one.\n            ##Genome-Assembly-Data-START##\n            Assembly Method       :: SPAdes v. 3.15\n            Genome Representation :: Full\n            ##Genome-Assembly-Data-END##\n            A plain line after the table.\nCOMMENT     A second COMMENT block.\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n",
        "structured",
    );
    assert_eq!(
        meta(&structured, "Comment").as_deref(),
        Some("PROVISIONAL REFSEQ: plain line one.\nA plain line after the table.\nA second COMMENT block.")
    );
    // An organism name continued on a second line, before the lineage, as Biopython reads it.
    let long_org = parse_genbank_flatfile(
        "LOCUS       LO000001                  30 bp    DNA     linear   BCT 19-NOV-2026\nACCESSION   LO000001\nVERSION     LO000001.1 GI:42\nSOURCE      x\n  ORGANISM  Escherichia coli str. K-12\n            substr. MG1655\n            Bacteria; Pseudomonadota.\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n",
        "long",
    );
    assert_eq!(
        meta(&long_org, "Organism").as_deref(),
        Some("Escherichia coli str. K-12 substr. MG1655")
    );
    assert_eq!(meta(&long_org, "Version").as_deref(), Some("LO000001.1"));

    // The document's accession, name and GenBank export are what the parser gave before this story
    // (captured on main at dd46ec3: length and CRC-32 of each export), and the new keys do not reach
    // the export: VERSION is still written from the accession.
    let before = [
        ("OR000001", 4746usize, 0xe416_3193u32),
        ("OR000002", 882, 0xbabb_29d5),
        ("OR000003", 515, 0x7934_4d5a),
    ];
    for (d, (acc, len, crc)) in docs.iter().zip(before) {
        assert_eq!((d.accession.as_str(), d.name.as_str()), (acc, acc));
        let e = export_genbank_flatfile(d);
        assert_eq!(
            (e.len(), crc32fast::hash(e.as_bytes())),
            (len, crc),
            "{acc} export"
        );
        assert!(e.contains(&format!("\nVERSION     {acc}\n")));
        let mut cleared = d.clone();
        cleared.doc_metadata = None;
        assert_eq!(export_genbank_flatfile(&cleared), e);
    }
}

fn comment_of(d: &SequenceDocument) -> Option<&str> {
    d.doc_metadata
        .as_ref()
        .and_then(|m| m.get("Comment"))
        .and_then(|v| v.as_str())
}

/// D0229's Comment where the COMMENT holds a blank line: Biopython 1.88 drops every empty header
/// line before it reads the header (Bio/GenBank/Scanner.py, `lines = [_f for _f in lines if _f]`
/// on lines it has already right-stripped), so a 12-space line and a truly empty line are both
/// dropped and neither ends the COMMENT; the first line is `line[12:]`, so spaces after column 12
/// are kept. The expected string is Biopython 1.88's `annotations["comment"]` of this record.
#[test]
fn import_comment_drops_blank_lines_as_biopython_does() {
    let record = "LOCUS       BL000001                  30 bp    DNA     linear   BCT 19-NOV-2026\nACCESSION   BL000001\nVERSION     BL000001.1\nCOMMENT       Two spaces after column 12 are kept.  \n            The line after it.\n            \n\n            After a blank line and an empty one.\n            ##Assembly-Data-START##\n            Assembly Method :: SPAdes\n            ##Assembly-Data-END##\n               Indented three.\n\nCOMMENT     A second block.\nFEATURES             Location/Qualifiers\n     source          1..30\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n";
    let doc = parse_genbank_flatfile(record, "blank");
    assert_eq!(
        comment_of(&doc),
        Some("  Two spaces after column 12 are kept.\nThe line after it.\nAfter a blank line and an empty one.\n   Indented three.\nA second block.")
    );
}

/// The reference-data folder: `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo
/// root), else `<repo>/test-data`, as `real_resource_files.rs` reads it.
fn test_data_file(rel: &str) -> Option<String> {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
        Some(d) if !d.is_empty() => repo.join(d),
        _ => repo.join("test-data"),
    };
    let required = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").is_some_and(|v| v == "1");
    let p = dir.join(rel);
    match std::fs::read_to_string(&p) {
        Ok(s) => Some(s),
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            assert!(
                !required,
                "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}",
                p.display()
            );
            eprintln!("skipped: reference data absent ({})", p.display());
            None
        }
        Err(e) => panic!("{}: unreadable: {e}", p.display()),
    }
}

/// Biopython 1.88's `annotations["comment"]` of the first record of each test-data GenBank file whose
/// COMMENT holds a blank or empty line, written by `SeqIO.parse(path, "genbank")` on 2026-11-19.
const BIOPYTHON_COMMENTS: [(&str, &str); 7] = [
    (
        "ncbi/NC_045512.gb",
        "REVIEWED REFSEQ: This record has been curated by NCBI staff. The\nreference sequence is identical to MN908947.\nOn Jan 17, 2020 this sequence version replaced NC_045512.1.\nAnnotation was added using homology to SARSr-CoV NC_004718.3. ###\nFormerly called 'Wuhan seafood market pneumonia virus.' If you have\nquestions or suggestions, please email us at info@ncbi.nlm.nih.gov\nand include the accession number NC_045512.### Protein structures\ncan be found at\nhttps://www.ncbi.nlm.nih.gov/structure/?term=sars-cov-2.### Find\nall other Severe acute respiratory syndrome coronavirus 2\n(SARS-CoV-2) sequences at\nhttps://www.ncbi.nlm.nih.gov/genbank/sars-cov-2-seqs/\nCOMPLETENESS: full length.",
    ),
    (
        "ncbi/V01555.gb",
        "On May 5, 2006 this sequence version replaced V01555.1.\nCDS\nListed under this feature are all known protein coding regions as\nwell as all the major open reading frames in the sequence. In\ngeneral the term major is taken as the longest frame in a\nparticular region taking into account the adjacent longest frames\nand likely transcription signals. Note that on this basis some long\noverlapping frames have been excluded and on the other hand some\nsmall frames have been included which might represent exons or\ngenes because they occur in a logical combination with other\nfeatures or because of some other experimental data. The reading\nframes are named according to the Bam H1 fragment in which they\nstart. eg BALF3 is the third leftward frame starting in Bam H1\nfragment A. BORF1 is the first rightward frame in Bam H1 fragment\nO. If there is an obvious TATA sequence followed by an in frame Met\ncodon that satisfies the rules of Kozak [12] in that there is a\npurine at -3 and/or a G at +4 then the reading frame is numbered\nfrom the A of the ATG to the base preceding the termination codon.\nIf there is no obvious initiation codon or there is a substantial\nreading frame in phase before the ATG then the reading frame is\nnumbered from the first base of the first codon.\nSITEs of POLYA signals\nThis feature lists all occurences of the sequence AATAAA which is\nfound normally approximately 20 bases upstream of the mRNA\nprocessing/polyA addition site. The rarely used homolog ATTAAA is\nonly listed when it is found in a position close to the end of a\nmajor reading frame.\nSITEs of DONOR and ACCEPT sequences\nThis is not a comprehensive listing of all such sequences and only\nthe positions of a few have been noted because they occur in\npotentially interesting positions. The number quoted in the table\nis the position of the terminal base in the intron in each case.\nRestriction enzyme SITEs.\nOnly the positions of the sites Bam HI (BAM) are listed.\nRPT\nThis feature is used to define repetitive sequences.\nSITE DEL\nThis feature defines deletions in B95-8 with respect to other\nstrains such as RAJI and also to deletions in other strains such as\nP3HR1 and DAUDI with respect to B95-8.\nSITE HPN\nDenotes sequences with twofold symmetry ie could form hairpin\nloops. This is not a comprehensive list - only a few occurences\nnoted.\nORGRPL\nDenotes the region that encompasses an origin of replication (ori\nP).[13].\nNUMBERING\nThe DNA sequence of B95-8 EBV has been revised [19]. The original\n(Baer et al, 1984) base 359 has been deleted so the new sequence\naround that position reads TCAGTCTTT. To avoid renumbering the\nentire sequence, position 1 has benn moved 1 base to the left of\nthe EcoRI site separating EcoRI Dhet from EcoRI I\n(ie the first A of AGAATTC).",
    ),
    (
        "biopython-tests/GenBank/protein_refseq2.gb",
        "VALIDATED REFSEQ: This record has undergone preliminary review of\nthe sequence, but has not yet been subject to final review. The\nreference sequence was derived from K00020.1.\nPublication Note:  This RefSeq record includes a subset of the\npublications that are available for this gene. Please see the\nEntrez Gene record to access additional publications.",
    ),
    (
        "biopython-tests/GenBank/tsa_acropora.gb",
        "The Acropora millepora transcriptome shotgun assembly (TSA) project\nhas the project accession GHGH00000000.  This version of the\nproject (01) has the accession number GHGH01000000, and consists of\nsequences GHGH01000001-GHGH01126539.\nRaw RNA-seq reads were trimmed using libngs with minimum quality of\n20 and minimum read size of 80 nt. Trinity r2013-02-16 was then\nemployed for de novo transcriptome assembly.",
    ),
    (
        "biopython-tests/GenBank/DS830848.gb",
        "\nThis Wikel tick colony was established in 1996 using field\ncollected ticks from New York, Oklahoma and a Lyme Disease endemic\narea of Connecticut.  This colony has been continuously in-bred\nsince establishment and has not been supplemented with field\ncollected material.  The colony is known to be a competent vector\nof various Borrelia and Babesia isolates. Genomic DNA was prepared\nfrom embryonated eggs.\nThe Ixodes scapularis Genome Project (IGP) is a community-based\neffort initiated in early 2004 to sequence the I. scapularis\ngenome.  The IGP is funded by the National Institute of Allergy and\nInfectious Diseases (NIAID)/National Institute of Health as part of\nthe NIAID-funded Microbial Sequencing Centers (MSCs) at The J.\nCraig Venter Institute (http://www.jcvi.org) and The Broad\nInstitute (http://www.broad.mit.edu/).  The genome sequencing was\nperformed at both MSCs and the assembly at JCVI. The sum of all\nreads equals 6X based on an estimated genome size of 2.1 Gbp, while\nthe coverage on assembled contigs is 3.8X.  The scaffolds are\ncomprised of 570637 contigs; the other 570958 contigs in the 01\nversion of this project represent degenerate contigs that were not\nincorporated into scaffolds.  The annotation for this assembly will\nbe produced jointly by the MSCs and VectorBase\n(http://www.vectorbase.org).  Data release and use follow NIAID\nguidelines\n(http://www.niaid.nih.gov/dmid/genomes/mscs/data_release.htm).\nVectorBase (www.vectorbase.org), a NIAID Bioinformatics Resource\nCenter, is responsible for the long-term curation of the assembled\ngenome sequence  and its annotation.  For more information, contact\ninfo@vectorbase.org.\nAssembly name: JCVI_ISG_i3_1.0\nCoverage: 3.8x on assembled contigs; 6x based on an estimated\ngenome size of 2.1 Gbp\nAnnotation was added to the scaffolds in December 2008.",
    ),
    (
        "biopython-tests/GenBank/HM138502.gbk",
        "Swine influenza A (H1N1) virus isolated during human swine flu\noutbreak of 2009.",
    ),
    (
        "biopython-tests/GenBank/bad_origin_wrap_fuzzy.gb",
        "On Apr 11, 2002 this sequence version replaced L09137.1. These data\nand their annotation were supplied to GenBank by Will    Gilbert\nunder the auspices of the GenBank Currator Program. pUC19c  -\nCloning vector (beta-galactosidase mRNA on complementary strand)\nENTRY PUC19C                    #TYPE DNA CIRCULAR TITLE pUC19c -\nCloning vector\n              (beta-galactosidase mRNA on complementary strand)\nDATE      03-FEB-1986\n   #sequence  16-DEC-1986\nACCESSION VB0033\nSOURCE    artificial\nCOLLECTION  ATCC 37254\nREFERENCE\n   #number\n   #authors  Norrander J., Kempe T., Messing J.\n   #journal Gene (1983) 26: 101-106\nREFERENCE\n   #number  1\n   #authors  Yanisch-Perron C., Vieira J., Messing J.\n   #journal Gene (1985) 33: 103-119\n   #comment shows the complete compiled sequence\nREFERENCE\n   #number  2\n   #authors  Chambers,S.P., et al.\n   #journal Gene (1988) 68: 139-149\n   #describes mutation at nt1308 and its effect on copy number\nREFERENCE\n   #number\n   #authors Pouwels P.H., Enger-Valk B.E., Brammar W.J.\n   #book    Cloning Vectors, Elsvier 1985 and supplements\n   #comment  vector I-A-iv-20\nCOMMENT\n   This Sequence was obtained 3-MAR-1986 from J. Messing, Waksman\n   Institute, NJ on floppy disk.\n   Revised 16-DEC-1986 by F. Pfeiffer:\n   1062/3 'AT' to 'TA' to match revised sequence of PBR322\n   The beta-galactosidase mRNA sequence including the multiple\n   cloning site of M13mp19 is on the strand complementary to that\n   shown.\nKEYWORDS\nCROSSREFERENCE\n   #complement\n     VecBase(3):pUC19\n   #prerevised\n     GenBank(50):M11662, EMBL(11):ARPuc19\n   #parent\n     VecBase(3):pUC13, VecBase(3):M13mp19, VecSource(3):bGal19\nPARENT\n   Features of pUC19c (2686 bp)\n     residue     source\n      1- 137  2074-2210 pBR322\n    138- 237  2252-2351 pBR322\n    238- 395  1461-1304 (c) Lac-Operon\n    396- 452    57-   1 (c) polylinker of M13mp19\n    455- 682  1298-1071 (c) Lac-Operon\n    683-2686  2352-4355 pBR322\n   Conflict (cfl) and Mutations (mut):\n        pUC19c  source\n   mut 1308  A  G  2977   pBR322   linked to increased copy number\n   mut 1942  A  G  3611   pBR322\n   mut 2243  T  C  3912   pBR322\nFEATURE\n   1629-2417 789-1 (c) Ap-R\nb-lactamase                            POLYLINKER\nHindIII-SphI-PstI-SalI-XbaI-BamHI-SmaI-KpnI-SacI-EcoRI  SELECTION\n#resistance  Ap\n#indicator beta-galactosidase\nSUMMARY  pUC19c    #length 2686   #checksum 4465.",
    ),
];

/// The seven real files: Comment equals Biopython 1.88's comment exactly. Skipped, per file, when
/// the git-ignored reference data is absent.
#[test]
fn import_comment_matches_biopython_on_real_files() {
    let mut differ = Vec::new();
    for (rel, want) in BIOPYTHON_COMMENTS {
        let Some(text) = test_data_file(rel) else {
            continue;
        };
        let doc = parse_genbank_flatfile(&text, rel);
        if comment_of(&doc) != Some(want) {
            differ.push(rel);
        }
    }
    assert!(
        differ.is_empty(),
        "Comment differs from Biopython 1.88 on {differ:?}"
    );
}

fn organism_of(d: &SequenceDocument) -> Option<&str> {
    d.doc_metadata
        .as_ref()
        .and_then(|m| m.get("Organism"))
        .and_then(|v| v.as_str())
}

/// One record whose SOURCE block's ORGANISM line reads `  ORGANISM  ` followed by `organism`
/// (its own text, then its continuation lines, each ending in "\n").
fn organism_record(organism: &str) -> SequenceDocument {
    let text = format!(
        "LOCUS       KL000001                  30 bp    DNA     linear   BCT 19-NOV-2026\nACCESSION   KL000001\nVERSION     KL000001.1\nSOURCE      x\n  ORGANISM  {organism}FEATURES             Location/Qualifiers\n     source          1..30\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n"
    );
    parse_genbank_flatfile(&text, "organism")
}

/// D0229's Organism is the ORGANISM name as Biopython 1.88 reads it (Bio/GenBank/Scanner.py,
/// the ORGANISM branch): a continuation line starts the lineage when it holds a ';' or, stripped,
/// is exactly one of eight kingdom-only lines; every later line is lineage too; a lone '.' before
/// the lineage is a placeholder; and an empty header line is no line. Each expected value is
/// Biopython 1.88's `annotations["organism"]` of that record (SeqIO.parse, 2026-11-19).
#[test]
fn import_organism_matches_biopython() {
    let cases: [(&str, &str); 16] = [
        ("Unknown.\n            Bacteria.\n", "Unknown."),
        ("Unknown.\n            Archaea.\n", "Unknown."),
        ("Unknown.\n            Eukaryota.\n", "Unknown."),
        ("Unknown.\n            Unclassified.\n", "Unknown."),
        ("Unknown.\n            Viruses.\n", "Unknown."),
        ("Unknown.\n            cellular organisms.\n", "Unknown."),
        ("Unknown.\n            other sequences.\n", "Unknown."),
        ("Unknown.\n            unclassified sequences.\n", "Unknown."),
        // A name continued on a second line, then a kingdom-only lineage.
        (
            "Escherichia coli str. K-12\n            substr. MG1655\n            Bacteria.\n",
            "Escherichia coli str. K-12 substr. MG1655",
        ),
        // A line after a kingdom-only line is lineage, semicolon or not.
        ("Unknown.\n            Viruses.\n            Riboviria\n", "Unknown."),
        // The kingdom line is compared stripped.
        ("Unknown.\n               Archaea.   \n", "Unknown."),
        // Only the exact line starts the lineage: no stop, another case or more words are the name.
        ("Unknown.\n            Bacteria\n", "Unknown. Bacteria"),
        ("Unknown.\n            BACTERIA.\n", "Unknown. BACTERIA."),
        ("Unknown.\n            Bacteria. strain X\n", "Unknown. Bacteria. strain X"),
        ("Unknown.\n            Bacteria; Pseudomonadota.\n", "Unknown."),
        // An empty line and a 12-space line are no lines and do not end the name.
        (
            "Escherichia coli\n\n            \n            str. K-12\n            Bacteria; Pseudomonadota.\n",
            "Escherichia coli str. K-12",
        ),
    ];
    for (organism, want) in cases {
        assert_eq!(
            organism_of(&organism_record(organism)),
            Some(want),
            "{organism:?}"
        );
    }

    // The reviewer's file: '  ORGANISM  Unknown.' then '            Unclassified.'.
    if let Some(text) = test_data_file("ncbi/X02514.gb") {
        assert_eq!(
            organism_of(&parse_genbank_flatfile(&text, "X02514")),
            Some("Unknown.")
        );
    }

    // Every record of every test-data GenBank file: Organism is Biopython's organism, and absent
    // where Biopython's is '' (D0229 keeps no empty value; pBAD30.gb's ORGANISM line is empty).
    let mut differ = Vec::new();
    for (rel, want) in BIOPYTHON_ORGANISMS {
        let Some(text) = test_data_file(rel) else {
            continue;
        };
        let got: Vec<Option<String>> = split_genbank_records(&text)
            .iter()
            .map(|r| organism_of(&parse_genbank_flatfile(r, rel)).map(str::to_string))
            .collect();
        let want: Vec<Option<String>> = want
            .iter()
            .map(|o| (!o.is_empty()).then(|| o.to_string()))
            .collect();
        if got != want {
            differ.push((rel, got, want));
        }
    }
    assert!(
        differ.is_empty(),
        "Organism differs from Biopython 1.88: {differ:?}"
    );
}

/// Biopython 1.88's `annotations["organism"]` of each record of each GenBank file in test-data (each
/// file whose first line is a LOCUS line), in record order, written by `SeqIO.parse(path,
/// "genbank")` on 2026-11-19. Biopython refuses two of them past the header (invalid_product.gb and
/// no_origin_no_end.gb, in their features), so theirs is what its GenBankScanner's header reading
/// (`_feed_header_lines`) gives.
const BIOPYTHON_ORGANISMS: [(&str, &[&str]); 59] = [
    ("biopython-tests/GenBank/1MRR_A.gp", &["Escherichia coli"]),
    (
        "biopython-tests/GenBank/DS830848.gb",
        &["Ixodes scapularis"],
    ),
    (
        "biopython-tests/GenBank/EU851978.gbk",
        &["Influenza A virus (A/Wisconsin/36/2007(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/EU851978_output.gbk",
        &["Influenza A virus (A/Wisconsin/36/2007(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/EZ116220.gb",
        &["Rhagoletis pomonella"],
    ),
    (
        "biopython-tests/GenBank/GU949562.1.gb",
        &["Shewanella sp. MAR_280_P06_2010-01-20"],
    ),
    (
        "biopython-tests/GenBank/HM138502.gbk",
        &["Influenza A virus (A/California/07/2009(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/HM138502_output.gbk",
        &["Influenza A virus (A/California/07/2009(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/KF527485.gbk",
        &["Influenza A virus (A/California/07/2009(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/KF527485_output.gbk",
        &["Influenza A virus (A/California/07/2009(H1N1))"],
    ),
    (
        "biopython-tests/GenBank/NC_000932.gb",
        &["Arabidopsis thaliana"],
    ),
    (
        "biopython-tests/GenBank/NC_005816.gb",
        &["Yersinia pestis biovar Microtus str. 91001"],
    ),
    (
        "biopython-tests/GenBank/NP_416719.gbwithparts",
        &["Escherichia coli str. K-12 substr. MG1655"],
    ),
    ("biopython-tests/GenBank/NT_019265.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/addgene-plasmid-11664-sequence-180430.gbk",
        &["synthetic DNA construct"],
    ),
    (
        "biopython-tests/GenBank/addgene-plasmid-39296-sequence-49545.gbk",
        &["synthetic DNA construct"],
    ),
    (
        "biopython-tests/GenBank/arab1.gb",
        &["Arabidopsis thaliana"],
    ),
    ("biopython-tests/GenBank/bad_loc_wrap.gb", &["."]),
    (
        "biopython-tests/GenBank/bad_origin_wrap.gb",
        &["Mesorhizobium loti"],
    ),
    (
        "biopython-tests/GenBank/bad_origin_wrap_CDS.gb",
        &["synthetic DNA construct"],
    ),
    (
        "biopython-tests/GenBank/bad_origin_wrap_fuzzy.gb",
        &["Cloning vector pUC19c"],
    ),
    (
        "biopython-tests/GenBank/bad_origin_wrap_linear.gb",
        &["Mesorhizobium loti"],
    ),
    ("biopython-tests/GenBank/blank_seq.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/cor6_6.gb",
        &[
            "Arabidopsis thaliana",
            "Arabidopsis thaliana",
            "Brassica napus",
            "Armoracia rusticana",
            "Brassica rapa",
            "Brassica napus",
        ],
    ),
    (
        "biopython-tests/GenBank/dbsource_wrap.gb",
        &["Buthus occitanus tunetanus"],
    ),
    (
        "biopython-tests/GenBank/empty_accession.gbk",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/empty_feature_qualifier.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/empty_version.gbk",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/extra_keywords.gb",
        &["Drosophila melanogaster"],
    ),
    (
        "biopython-tests/GenBank/invalid_locus_line_spacing.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/invalid_misc_feature.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/invalid_product.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/invalid_structured_comment.gb",
        &["Mucambo virus"],
    ),
    ("biopython-tests/GenBank/iro.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/negative_location.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/no_end_marker.gb",
        &["Streptomyces avermitilis"],
    ),
    (
        "biopython-tests/GenBank/no_origin_no_end.gb",
        &["Streptomyces avermitilis"],
    ),
    ("biopython-tests/GenBank/noref.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/noref_date_warning.gb",
        &["Homo sapiens"],
    ),
    ("biopython-tests/GenBank/one_of.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/origin_line.gb",
        &["Mesorhizobium loti"],
    ),
    ("biopython-tests/GenBank/pBAD30.gb", &[""]),
    ("biopython-tests/GenBank/pri1.gb", &["Homo sapiens"]),
    (
        "biopython-tests/GenBank/protein_refseq.gb",
        &["Mus musculus"],
    ),
    (
        "biopython-tests/GenBank/protein_refseq2.gb",
        &["Mus musculus"],
    ),
    (
        "biopython-tests/GenBank/qualifier_escaping_read.gb",
        &["Mus musculus"],
    ),
    (
        "biopython-tests/GenBank/qualifier_escaping_write.gb",
        &["Mus musculus"],
    ),
    (
        "biopython-tests/GenBank/tls_KDHP01000000.gb",
        &["soil metagenome"],
    ),
    (
        "biopython-tests/GenBank/tsa_acropora.gb",
        &["Acropora millepora"],
    ),
    (
        "biopython-tests/GenBank/wrong_sequence_indent.gb",
        &["Streptomyces avermitilis"],
    ),
    ("ncbi/J01749.gb", &["Cloning vector pBR322"]),
    ("ncbi/J02459.gb", &["Escherichia phage Lambda"]),
    ("ncbi/L09137.gb", &["Cloning vector pUC19c"]),
    ("ncbi/M77789.gb", &["Cloning vector pUC19"]),
    ("ncbi/NC_001416.gb", &["Escherichia phage Lambda"]),
    ("ncbi/NC_001422.gb", &["Escherichia phage phiX174"]),
    (
        "ncbi/NC_045512.gb",
        &["Severe acute respiratory syndrome coronavirus 2"],
    ),
    ("ncbi/V01555.gb", &["human gammaherpesvirus 4"]),
    ("ncbi/X02514.gb", &["Unknown."]),
];

/// D0229: with no VERSION and no ACCESSION line the record id is the LOCUS name, as Biopython's
/// SeqRecord.id is, even when a D0202 'MolBioCraft name:' COMMENT line names the document. The
/// functions and nucleotide texts and the `--separate -n` file name are genbank_to 0.54's for this
/// record (`-f`, `-n` and `--separate -n`, run 2026-11-19): 'Long_name', not the document's name
/// 'Long name'. The `.gbk` file is D0227 (9)'s, where 0.54 crashes, named by the same id.
#[test]
fn record_id_falls_back_to_the_locus_name() {
    let record = |locus: &str, name: &str| {
        parse_genbank_flatfile(
            &format!("LOCUS       {locus:<16}          30 bp    DNA     linear   BCT 19-NOV-2026\nDEFINITION  No accession.\nCOMMENT     MolBioCraft name: {name}\nFEATURES             Location/Qualifiers\n     CDS             1..30\n                     /locus_tag=\"LN_1\"\n                     /product=\"Test protein\"\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n"),
            "named",
        )
    };
    let doc = record("Long_name", "Long name");
    assert_eq!(
        doc.name, "Long name",
        "the COMMENT line still names the document (D0202)"
    );
    assert_eq!(genbank_record_id(&doc), "Long_name");
    let docs = std::slice::from_ref(&doc);
    let warning =
        "Record Long_name has no VERSION or ACCESSION line, so its LOCUS name is used as its id.";
    let functions = genbank_to_functions(docs, &opts());
    assert_eq!(functions.text, "Long_name\tLN_1\tTest protein\n");
    assert_eq!(functions.warnings, [warning]);
    assert_eq!(
        genbank_to_fna(docs, &opts()).text,
        ">Long_name\nATGGCTGGCAAACGTACCGAACCGCTGTAA\n"
    );
    let separate = genbank_to_separate(docs, GenbankToSequenceOutput::Nucleotides, "ln", &opts());
    assert_eq!(
        separate.files,
        [(
            "ln.Long_name.fna".to_string(),
            ">Long_name\nATGGCTGGCAAACGTACCGAACCGCTGTAA\n".to_string()
        )]
    );
    assert_eq!(separate.warnings, [warning]);
    let gbk: Vec<String> = genbank_to_gbk_files(docs, &opts())
        .files
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    assert_eq!(gbk, ["Long_name.gbk"]);
    // The filter selects the record by that id.
    assert_eq!(
        genbank_to_fna(docs, &keep(&["Long_name"]))
            .text
            .lines()
            .count(),
        2
    );
    assert!(genbank_to_fna(docs, &keep(&["Long name"])).text.is_empty());

    // A LOCUS name the document's name would not make (a hand-edited file) is still the id.
    let other = record("AB12", "Something else");
    assert_eq!(other.name, "Something else");
    assert_eq!(genbank_record_id(&other), "AB12");
    // The same record without the COMMENT line: the LOCUS name is both the name and the id.
    let plain = parse_genbank_flatfile(
        "LOCUS       AB12                      30 bp    DNA     linear   BCT 19-NOV-2026\nORIGIN\n        1 atggctggca aacgtaccga accgctgtaa\n//\n",
        "plain",
    );
    assert_eq!(
        (plain.name.as_str(), genbank_record_id(&plain)),
        ("AB12", "AB12".to_string())
    );
    // Only a document the COMMENT renames keeps its LOCUS name as a key of its own.
    let locus_key = |d: &SequenceDocument| {
        d.doc_metadata
            .as_ref()
            .and_then(|m| m.get("LOCUS name"))
            .cloned()
    };
    assert_eq!(locus_key(&doc), Some(serde_json::json!("Long_name")));
    assert_eq!(locus_key(&plain), None);
    assert_eq!(locus_key(&record("Same_name", "Same_name")), None);
}

/// Biopython's ORGANISM branch passes over a continuation line that is a lone '.' before the
/// lineage, "No lineage data, just . place holder". An empty ORGANISM line with that placeholder is
/// '' in Biopython, which D0229 keeps as no Organism; after a name the placeholder adds nothing.
/// Each value is Biopython 1.88's `annotations["organism"]` of that record.
#[test]
fn organism_placeholder_is_not_a_name() {
    let empty = organism_record("\n            .\n");
    assert_eq!(organism_of(&empty), None);
    assert!(empty
        .doc_metadata
        .as_ref()
        .is_some_and(|m| !m.contains_key("Organism")));
    assert_eq!(
        organism_of(&organism_record("Homo sapiens\n            .\n")),
        Some("Homo sapiens")
    );
    // After the lineage has begun the '.' is lineage, not the name.
    assert_eq!(
        organism_of(&organism_record(
            "Homo sapiens\n            Eukaryota; Metazoa.\n            .\n"
        )),
        Some("Homo sapiens")
    );
    // The ORGANISM line's own '.' is the name, as Biopython reads it.
    assert_eq!(
        organism_of(&organism_record(".\n            .\n")),
        Some(".")
    );
}

/// An inline record for the ptt and phage_finder rules the fixture cannot reach: a partial CDS
/// (`<1..>30`, D0227 (8)) whose 'GI:' and 'COG' are not at the start of its db_xrefs and product, a
/// 20 bp CDS with two /gene values and a product 'COG0003, ...', and a minus-strand order() with no
/// product. 0.54 writes for it (2026-11-19, the README's command lines on this text):
/// `<0..>30 + 9.0 - [<0:>30](+) EDP00001.1 - Family COG0002 member`,
/// `30..50 + 5.666666666666667 77 edgA edgB EDP00002.1 COG0003, COG0003, partial family` and
/// `50..60 - 2.0 - order{[54:60](-), [50:53](-)} ED000001.1.order{...} - -`.
const EDGE: &str = "LOCUS       ED000001                  60 bp    DNA     linear   BCT 19-NOV-2026
DEFINITION  Edge cases for ptt and phage_finder.
ACCESSION   ED000001
VERSION     ED000001.1
FEATURES             Location/Qualifiers
     CDS             <1..>30
                     /product=\"Family COG0002 member\"
                     /db_xref=\"GeneID:1\"
                     /db_xref=\"GI:2\"
                     /protein_id=\"EDP00001.1\"
                     /translation=\"MAGKRTEPL\"
     CDS             31..50
                     /gene=\"edgA\"
                     /gene=\"edgB\"
                     /product=\"COG0003, partial family\"
                     /db_xref=\"GI:77\"
                     /protein_id=\"EDP00002.1\"
     CDS             complement(order(51..53,55..60))
ORIGIN
        1 atggctggca aacgtaccga accgctgtaa gggggtagta tagaccaagt ctgtaggttt
//
";

fn edge() -> Vec<SequenceDocument> {
    vec![parse_genbank_flatfile(EDGE, "edge")]
}

#[test]
fn ptt_matches_genbank_to_with_named_fixes() {
    let docs = records();
    let plain = genbank_to_ptt(&docs, &opts());
    assert_eq!(plain.text, PTT);
    assert_eq!(plain.warnings, [NO_VERSION_WARNING]);
    let lines: Vec<&str> = plain.text.lines().collect();
    assert!(
        lines.iter().all(|l| l.split('\t').count() == 8),
        "eight columns, no header"
    );
    // CDS (a): 1-based start (D0227 (2)), integer length (3), GI from 'GI:123456 GeneID:7'.
    assert_eq!(
        lines[0],
        "1..33\t+\t10\t123456\tabcA\tORP00001.1\t-\tAlpha test protein"
    );
    // The complement CDS reads '<low>..<high>' with '-'; no /gene gives the location text.
    assert_eq!(
        lines[1],
        "41..70\t-\t9\t-\t[40:70](-)\tORT_0002\t-\tBeta test protein"
    );
    // CDS (d), a minus-strand join: lowest start to highest end, length over both parts.
    assert!(lines.contains(
        &"161..230\t-\t19\t-\tjoin{[200:230](-), [160:190](-)}\tOR000001.1.join{[200:230](-), [160:190](-)}\t-\tDelta test protein"
    ));
    // CDS (g), 20 bp: 20 // 3 - 1 = 5, where 0.54 writes 5.666666666666667.
    assert!(lines.contains(&"321..340\t+\t5\t-\t[320:340](+)\tORT_0007\t-\tEta short protein"));
    // CDS (j): two products joined by a space, not '|'.
    assert!(lines.contains(
        &"421..450\t+\t9\t-\t[420:450](+)\tORP00010.1\t-\tKappa test protein Kappa alternative name"
    ));
    // CDS (l): COG; CDS (m): 'GeneID:9 GI:55' does not start 'GI:', so GI is '-'.
    assert!(lines
        .contains(&"501..530\t+\t9\t-\t[500:530](+)\tORP00012.1\tCOG0001\tCOG0001 test family."));
    assert!(lines.contains(&"541..570\t+\t9\t-\t[540:570](+)\tGeneID:9|GI:55\t-\tMu test protein"));
    // CDS (f), /pseudo, only with Include pseudogenes (D0227 (1)), after CDS (e).
    assert!(!plain.text.contains("ORP00006.1"));
    let with = genbank_to_ptt(&docs, &pseudo()).text;
    let mut want: Vec<&str> = lines.clone();
    want.insert(
        5,
        "281..310\t+\t9\t-\t[280:310](+)\tORP00006.1\t-\tZeta pseudo protein",
    );
    assert_eq!(
        with,
        want.iter().map(|l| format!("{l}\n")).collect::<String>()
    );
    // The record filter (D0227 (4)).
    assert_eq!(
        genbank_to_ptt(&docs, &keep(&["OR000002"])).text,
        "11..40\t+\t9\t-\t[10:40](+)\tORP20001.1\t-\tPlasmid replication protein\n51..80\t-\t9\t-\t[50:80](-)\tORT2_0002\t-\tPlasmid partition protein\n"
    );
    // The inline record: re.match, not re.search, for GI and COG; COG keeps its punctuation;
    // repeated /gene joined by a space; no partial marks and join{} for order() (D0227 (8)).
    assert_eq!(
        genbank_to_ptt(&edge(), &opts()).text,
        "1..30\t+\t9\t-\t[0:30](+)\tEDP00001.1\t-\tFamily COG0002 member\n\
         31..50\t+\t5\t77\tedgA edgB\tEDP00002.1\tCOG0003,\tCOG0003, partial family\n\
         51..60\t-\t2\t-\tjoin{[54:60](-), [50:53](-)}\tED000001.1.join{[54:60](-), [50:53](-)}\t-\t-\n"
    );
    // A feature of an open record with strand 0 is '+', as 0.54's `strand >= 0` reads it.
    let mut unstranded = edge();
    unstranded[0].features[0].strand = 0;
    assert!(genbank_to_ptt(&unstranded, &opts())
        .text
        .starts_with("1..30\t+\t9\t"));
}

#[test]
fn phage_finder_matches_genbank_to_with_named_fixes() {
    let docs = records();
    let plain = genbank_to_phage_finder(&docs, &opts());
    assert_eq!(plain.text, PHAGE_FINDER);
    assert_eq!(plain.warnings, [NO_VERSION_WARNING]);
    let lines: Vec<&str> = plain.text.lines().collect();
    assert!(lines.iter().all(|l| l.split('\t').count() == 6));
    assert_eq!(
        lines[0],
        "OR000001.1\t720\tORP00001.1\t1\t33\tAlpha test protein"
    );
    assert!(lines.contains(&"OR000001.1\t720\tORT_0002\t41\t70\tBeta test protein"));
    assert!(lines.contains(&"OR000001.1\t720\tGeneID:3\t81\t150\tHypothetical protein"));
    assert!(lines.contains(
        &"OR000001.1\t720\tORP00010.1\t421\t450\tKappa test protein Kappa alternative name"
    ));
    assert!(lines.contains(&"OR000002.1\t120\tORT2_0002\t51\t80\tPlasmid partition protein"));
    assert!(lines.contains(&"OR000003\t60\tORP30001.1\t1\t30\tContig protein"));
    assert!(!plain.text.contains("ORP00006.1"));
    let with = genbank_to_phage_finder(&docs, &pseudo()).text;
    let mut want = lines.clone();
    want.insert(
        5,
        "OR000001.1\t720\tORP00006.1\t281\t310\tZeta pseudo protein",
    );
    assert_eq!(
        with,
        want.iter().map(|l| format!("{l}\n")).collect::<String>()
    );
    assert_eq!(
        genbank_to_phage_finder(&docs, &keep(&["OR000003"])).text,
        "OR000003\t60\tORP30001.1\t1\t30\tContig protein\n"
    );
    assert_eq!(
        genbank_to_phage_finder(&edge(), &opts()).text,
        "ED000001.1\t60\tEDP00001.1\t1\t30\tFamily COG0002 member\n\
         ED000001.1\t60\tEDP00002.1\t31\t50\tCOG0003, partial family\n\
         ED000001.1\t60\tED000001.1.join{[54:60](-), [50:53](-)}\t51\t60\tHypothetical protein\n"
    );
}

/// The value of attribute `key` in a GFF3 line's column 9.
fn attr<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.split('\t')
        .nth(8)?
        .split(';')
        .find_map(|kv| kv.strip_prefix(key)?.strip_prefix('='))
}

/// The record ids, in order, with each record's export (US-01M7RC3P's feature ids are `gb-feat-<n>`).
fn exports(docs: &[SequenceDocument]) -> Vec<(String, String)> {
    docs.iter()
        .map(|d| (genbank_record_id(d), export_gff3_noodles(d)))
        .collect()
}

#[test]
fn gff3_is_the_app_export_with_record_ids() {
    let docs = records();
    let out = genbank_to_gff3(&docs, &opts());
    assert_eq!(out.warnings, [NO_VERSION_WARNING]);
    let text = &out.text;
    assert!(text.starts_with("##gff-version 3\n"));
    assert_eq!(text.matches("##gff-version").count(), 1);
    assert!(!text.contains("##FASTA"));
    // Each record's export lines after its first, in record order: the same lines, one for one,
    // with only column 1, the ##sequence-region id and the ID changed.
    let mut want_len = 1;
    let mut lines = text.lines().skip(1);
    for (rid, export) in exports(&docs) {
        for e in export.lines().skip(1) {
            want_len += 1;
            let got = lines.next().expect("a line for every export line");
            if let Some(region) = e.strip_prefix("##sequence-region ") {
                let rest = region.split_once(' ').unwrap().1;
                assert_eq!(got, format!("##sequence-region {rid} {rest}"));
                continue;
            }
            let (g, w): (Vec<&str>, Vec<&str>) =
                (got.split('\t').collect(), e.split('\t').collect());
            assert_eq!(g.len(), 9, "{got}");
            assert_eq!(g[0], rid, "column 1 is the record id: {got}");
            assert_eq!(g[1..8], w[1..8], "columns 2-8 are the export's: {got}");
            assert_eq!(
                attr(got, "ID").unwrap(),
                format!("{rid}.{}", attr(e, "ID").unwrap())
            );
            assert_eq!(attr(got, "Name"), attr(e, "Name"));
        }
    }
    assert!(lines.next().is_none());
    assert_eq!(text.lines().count(), want_len);
    // Stated literally: the sequence regions, and CDS (a)'s and the contig's lines.
    for region in [
        "##sequence-region OR000001.1 1 720",
        "##sequence-region OR000002.1 1 120",
        "##sequence-region OR000003 1 60",
    ] {
        assert!(text.lines().any(|l| l == region), "{region}");
    }
    assert!(text
        .lines()
        .any(|l| l
            == "OR000001.1\tMolBioCraft\tCDS\t1\t33\t.\t+\t0\tID=OR000001.1.gb-feat-3;Name=abcA"));
    assert!(text.lines().any(|l| {
        l == "OR000003\tMolBioCraft\tCDS\t1\t30\t.\t+\t0\tID=OR000003.gb-feat-1;Name=Contig protein"
    }));
    // No two lines of different features share an ID: lines sharing one are one feature's parts
    // (same record, type and strand), as CDS (c) and (d)'s joins are.
    let mut by_id: std::collections::HashMap<&str, Vec<Vec<&str>>> = Default::default();
    for l in text.lines().filter(|l| !l.starts_with('#')) {
        by_id
            .entry(attr(l, "ID").unwrap())
            .or_default()
            .push(l.split('\t').collect());
    }
    for (id, ls) in &by_id {
        assert!(
            ls.iter()
                .all(|c| c[0] == ls[0][0] && c[2] == ls[0][2] && c[6] == ls[0][6]),
            "{id} names lines of different features"
        );
    }
    assert_eq!(by_id["OR000001.1.gb-feat-5"].len(), 2);
    assert_eq!(by_id["OR000001.1.gb-feat-6"].len(), 2);
    assert!(by_id.contains_key("OR000002.1.gb-feat-1") && by_id.contains_key("OR000003.gb-feat-1"));
    // Non-CDS features are kept.
    let types: Vec<&str> = text.lines().filter_map(|l| l.split('\t').nth(2)).collect();
    for t in ["source", "gene", "tRNA", "rRNA", "ncRNA"] {
        assert!(types.contains(&t), "{t} is kept");
    }
    // The record filter (D0227 (4)).
    let one = genbank_to_gff3(&docs, &keep(&["OR000002.1"])).text;
    assert_eq!(
        one,
        "##gff-version 3\n##sequence-region OR000002.1 1 120\n\
         OR000002.1\tMolBioCraft\tCDS\t11\t40\t.\t+\t0\tID=OR000002.1.gb-feat-1;Name=Plasmid replication protein\n\
         OR000002.1\tMolBioCraft\tCDS\t51\t80\t.\t-\t0\tID=OR000002.1.gb-feat-2;Name=Plasmid partition protein\n"
    );
}

#[test]
fn amrfinder_files_follow_d0227() {
    let docs = records();
    let out = genbank_to_amrfinder(&docs, "oracle", &opts());
    let names: Vec<&str> = out.files.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        ["oracle.amr.gff", "oracle.amr.faa", "oracle.amr.fna"]
    );
    let (gff, faa, fna) = (&out.files[0].1, &out.files[1].1, &out.files[2].1);
    // .amr.faa: simple headers and no pseudogenes, whatever the options say; .amr.fna: -n.
    assert_eq!(faa, FAA);
    assert_eq!(fna, FNA);
    let both = GenbankToOptions {
        include_pseudogenes: true,
        complex_headers: true,
        ..GenbankToOptions::default()
    };
    assert_eq!(
        genbank_to_amrfinder(&docs, "oracle", &both).files,
        out.files
    );
    // .amr.gff: the GFF3 with no ##FASTA, its non-CDS lines all kept.
    let gff3 = genbank_to_gff3(&docs, &opts()).text;
    assert!(gff.starts_with("##gff-version 3\n") && !gff.contains("##FASTA"));
    let non_cds = |t: &str| -> Vec<String> {
        t.lines()
            .filter(|l| l.split('\t').nth(2) != Some("CDS"))
            .map(String::from)
            .collect()
    };
    assert_eq!(non_cds(gff), non_cds(&gff3));
    let faa_heads = headers(faa);
    let fna_heads = headers(fna);
    // Each CDS of the fixture, by its feature: kept with Name = protein_id when that protein_id heads
    // an .amr.faa record, else no line.
    let mut kept_ids = Vec::new();
    for d in &docs {
        let rid = genbank_record_id(d);
        for f in d.features.iter().filter(|f| f.feature_type == "CDS") {
            let id = format!("{rid}.{}", f.id);
            let lines: Vec<&str> = gff
                .lines()
                .filter(|l| attr(l, "ID") == Some(id.as_str()))
                .collect();
            let gff3_lines: Vec<&str> = gff3
                .lines()
                .filter(|l| attr(l, "ID") == Some(id.as_str()))
                .collect();
            assert!(!gff3_lines.is_empty(), "{id} is in the GFF3");
            let pid = f
                .qualifiers
                .as_ref()
                .and_then(|q| q.get("protein_id"))
                .cloned();
            match pid {
                Some(p) if faa_heads.contains(&p.as_str()) => {
                    assert_eq!(lines.len(), gff3_lines.len(), "{p}");
                    for (l, g) in lines.iter().zip(&gff3_lines) {
                        let want = g.replace(
                            &format!(";Name={}", attr(g, "Name").unwrap()),
                            &format!(";Name={p}"),
                        );
                        assert_eq!(*l, want, "{p}'s line has Name={p}");
                        assert_eq!(l.matches("Name=").count(), 1);
                        assert!(fna_heads.contains(&l.split('\t').next().unwrap()));
                    }
                    kept_ids.push(p);
                }
                _ => assert!(lines.is_empty(), "{id} ({pid:?}) has no .amr.gff line"),
            }
        }
    }
    assert_eq!(
        kept_ids,
        [
            "ORP00001.1",
            "ORP00010.1",
            "ORP00011.1",
            "ORP00012.1",
            "ORP20001.1",
            "ORP30001.1"
        ]
    );
    assert!(gff.lines().any(|l| {
        l == "OR000001.1\tMolBioCraft\tCDS\t1\t33\t.\t+\t0\tID=OR000001.1.gb-feat-3;Name=ORP00001.1"
    }));
    assert!(
        !gff.contains("ORP00006.1") && !gff.contains("Zeta pseudo"),
        "CDS (f) is dropped"
    );
    let no_pid = |id: &str| {
        format!("CDS {id} has no protein_id, so the AMRFinderPlus .gff has no line for it.")
    };
    let mut want: Vec<String> = [
        "ORT_0002",
        "GeneID:3",
        "OR000001.1.join{[200:230](-), [160:190](-)}",
        "OR000001.1.[240:270](+)",
        "ORT_0007",
        "ORT_0008",
        "ORT_0009",
        "GeneID:9|GI:55",
        "ORT2_0002",
    ]
    .iter()
    .map(|id| no_pid(id))
    .collect();
    want.push("CDS ORT_0007 in OR000001.1 was left out of the proteins: its length (20 bp) is not a multiple of 3 and it has no /translation.".into());
    want.push(NO_VERSION_WARNING.into());
    let mut got = out.warnings.clone();
    got.sort();
    want.sort();
    assert_eq!(got, want);
    // A CDS with a protein_id that heads no .amr.faa record (20 bp, no /translation) has no line
    // and no 'no protein_id' warning; the record filter selects records for all three files.
    let e = genbank_to_amrfinder(&edge(), "edge", &opts());
    assert!(e.files[0]
        .1
        .contains("ID=ED000001.1.gb-feat-1;Name=EDP00001.1"));
    assert!(!e.files[0].1.contains("ED000001.1.gb-feat-2"));
    assert!(!e
        .warnings
        .iter()
        .any(|w| w.contains("EDP00002.1 has no protein_id")));
    let k = genbank_to_amrfinder(&docs, "oracle", &keep(&["OR000003"]));
    assert_eq!(
        k.files[2].1,
        ">OR000003\nATGGCTGGCAAACGTACCGAACCGCTGTAAGGGGGTAGTATAGACCAAGTCTGTAGGTTT\n"
    );
    assert_eq!(
        k.files[1].1,
        ">ORP30001.1\nMAGKRTEPL*\n".replace("MAGKRTEPL*", fasta_seq(FAA, "ORP30001.1").unwrap())
    );
    assert!(k.files[0]
        .1
        .lines()
        .all(|l| l.starts_with('#') || l.starts_with("OR000003\t")));
}

/// A record with no VERSION or ACCESSION line, so its id is its name: a pseudogene CDS with no
/// protein_id, and a CDS with one.
const RESERVED: &str =
    "LOCUS       AE000001                  60 bp    DNA     linear   BCT 19-NOV-2026
DEFINITION  Reserved characters in GFF3 ids.
FEATURES             Location/Qualifiers
     CDS             1..30
                     /pseudo
                     /locus_tag=\"AET_0001\"
     CDS             31..60
                     /protein_id=\"AEP00002.1\"
                     /translation=\"MKTAYIAKQR\"
ORIGIN
        1 atggctggca aacgtaccga accgctgtaa gggggtagta tagaccaagt ctgtaggttt
//
";

#[test]
fn gff3_and_amrfinder_ids_keep_reserved_characters_encoded() {
    // An open record the app renamed, and a feature id with GFF3-reserved characters: the record id
    // is percent-encoded inside ID, and the line still maps back to its feature by the decoded ID.
    let mut doc = parse_genbank_flatfile(RESERVED, "reserved");
    doc.name = "AE;1=x".to_string();
    doc.features[1].id = "f;2".to_string();
    let docs = [doc];
    assert_eq!(genbank_record_id(&docs[0]), "AE;1=x");
    let gff3 = genbank_to_gff3(&docs, &opts()).text;
    let cds: Vec<&str> = gff3.lines().filter(|l| l.contains("\tCDS\t")).collect();
    assert_eq!(cds.len(), 2, "{gff3}");
    assert_eq!(attr(cds[1], "ID"), Some("AE%3B1%3Dx.f%3B2"));
    assert!(cds.iter().all(|l| l.starts_with("AE;1=x\t")));
    let amr = genbank_to_amrfinder(&docs, "r", &opts());
    let gff: Vec<&str> = amr.files[0]
        .1
        .lines()
        .filter(|l| l.contains("\tCDS\t"))
        .collect();
    // The protein_id CDS keeps its line, found through the decoded ID; the pseudogene has none, and,
    // being left out of the AMRFinderPlus files, no 'no protein_id' warning either.
    assert_eq!(gff.len(), 1, "{}", amr.files[0].1);
    assert_eq!(attr(gff[0], "Name"), Some("AEP00002.1"));
    assert_eq!(attr(gff[0], "ID"), Some("AE%3B1%3Dx.f%3B2"));
    assert_eq!(
        amr.warnings,
        ["Record AE;1=x has no VERSION or ACCESSION line, so its LOCUS name is used as its id."]
    );
}
