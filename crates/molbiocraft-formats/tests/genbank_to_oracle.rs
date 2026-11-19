// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The genbank_to port (US-01M7RC3P, D0227-D0229) against genbank_to 0.54's own output on the
//! hand-written fixture `fixtures/genbank_to/oracle.gbk`. The expected files, the command lines that
//! wrote them and every line changed by hand (with its D0227 item) are in that folder's README.md.

use molbiocraft_core::SequenceDocument;
use molbiocraft_formats::genbank_to::{
    genbank_record_id, genbank_to_faa, genbank_to_fna, genbank_to_functions, genbank_to_gbk_files,
    genbank_to_orfs, genbank_to_separate, split_genbank_records, GenbankToOptions,
    GenbankToSequenceOutput,
};
use molbiocraft_formats::{export_genbank_flatfile, parse_genbank_flatfile};

const ORACLE: &str = include_str!("fixtures/genbank_to/oracle.gbk");
const FNA: &str = include_str!("fixtures/genbank_to/expected/oracle.fna");
const ORFS: &str = include_str!("fixtures/genbank_to/expected/oracle.orfs");
const PSEUDO_ORFS: &str = include_str!("fixtures/genbank_to/expected/oracle.pseudo.orfs");
const FAA: &str = include_str!("fixtures/genbank_to/expected/oracle.faa");
const PSEUDO_FAA: &str = include_str!("fixtures/genbank_to/expected/oracle.pseudo.faa");
const FUNCTIONS: &str = include_str!("fixtures/genbank_to/expected/oracle.functions.tsv");
const PSEUDO_FUNCTIONS: &str =
    include_str!("fixtures/genbank_to/expected/oracle.pseudo.functions.tsv");

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
