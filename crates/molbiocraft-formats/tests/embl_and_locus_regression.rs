// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regressions for flatfile import:
//! - EMBL records used to be fed to the GenBank reader, which (finding no LOCUS
//!   line) read every letter of the file — headers included — as sequence.
//! - A LOCUS *name* containing "rna" / "circular" changed the molecule type /
//!   topology of a DNA record.

use molbiocraft_core::{MoleculeType, Topology};
use molbiocraft_formats::{export_embl_flatfile, parse_embl_flatfile, parse_genbank_flatfile};

const GB: &str = "LOCUS       pRNA_circularTest      120 bp    DNA     linear   SYN 01-JAN-2026
DEFINITION  Test construct.
ACCESSION   TST001
FEATURES             Location/Qualifiers
     CDS             complement(10..39)
                     /gene=\"lacZa\"
                     /note=\"alpha fragment\"
     misc_feature    join(50..60,70..80)
                     /label=\"split\"
ORIGIN
        1 atgaccatga ttacgccaag cttgcatgcc tgcaggtcga ctctagagga tccccgggta
       61 ccgagctcga attcactggc cgtcgtttta caacgtcgtg actgggaaaa ccctggcgtt
//
";

#[test]
fn locus_name_does_not_change_molecule_type_or_topology() {
    let doc = parse_genbank_flatfile(GB, "fallback");
    assert_eq!(doc.name, "pRNA_circularTest");
    assert_eq!(doc.molecule_type, MoleculeType::DNA);
    assert_eq!(doc.topology, Topology::Linear);

    let rna = parse_genbank_flatfile(
        &GB.replace("bp    DNA     linear", "bp    mRNA    circular"),
        "x",
    );
    assert_eq!(rna.molecule_type, MoleculeType::RNA);
    assert_eq!(rna.topology, Topology::Circular);
}

#[test]
fn embl_export_round_trips_through_the_embl_reader() {
    let original = parse_genbank_flatfile(GB, "fallback");
    let embl = export_embl_flatfile(&original);
    assert!(embl.starts_with("ID   "));

    let back = parse_embl_flatfile(&embl, "fallback");
    assert_eq!(
        back.sequence, original.sequence,
        "sequence must not absorb header text"
    );
    assert_eq!(back.sequence.len(), 120);
    assert_eq!(back.accession, "TST001");
    assert_eq!(back.molecule_type, MoleculeType::DNA);
    assert_eq!(back.topology, original.topology);
    assert_eq!(back.features.len(), original.features.len());
    for (a, b) in back.features.iter().zip(original.features.iter()) {
        assert_eq!(
            (a.start, a.end, a.strand),
            (b.start, b.end, b.strand),
            "{}",
            a.name
        );
        assert_eq!(a.feature_type, b.feature_type);
    }
}

#[test]
fn embl_reader_handles_a_standard_ena_record() {
    let ena = "ID   X56734; SV 1; circular; mRNA; STD; PLN; 30 BP.
XX
AC   X56734; S46826;
XX
DE   Trifolium repens mRNA for non-cyanogenic beta-glucosidase
XX
FH   Key             Location/Qualifiers
FT   source          1..30
FT                   /organism=\"Trifolium repens\"
FT   CDS             <1..>30
FT                   /product=\"beta-glucosidase\"
XX
SQ   Sequence 30 BP; 8 A; 7 C; 8 G; 7 T; 0 other;
     aaacaaacca aatatggatt ttattgtagc        30
//
";
    let doc = parse_embl_flatfile(ena, "fallback");
    assert_eq!(doc.name, "X56734");
    assert_eq!(doc.accession, "X56734");
    assert_eq!(doc.sequence, "AAACAAACCAAATATGGATTTTATTGTAGC");
    assert_eq!(doc.molecule_type, MoleculeType::RNA);
    assert_eq!(doc.topology, Topology::Circular);
    assert!(doc.description.starts_with("Trifolium repens mRNA"));
    let cds = doc
        .features
        .iter()
        .find(|f| f.feature_type == "CDS")
        .expect("CDS");
    assert_eq!((cds.start, cds.end), (1, 30));
    assert_eq!(cds.name, "beta-glucosidase");
}


#[test]
fn embl_entry_name_containing_rna_keeps_a_dna_record_dna() {
    let mut doc = parse_genbank_flatfile(GB, "fallback");
    doc.accession = "pRNA_vec".into();
    doc.name = "pRNA_vec".into();
    let back = parse_embl_flatfile(&export_embl_flatfile(&doc), "fallback");
    assert_eq!(back.molecule_type, MoleculeType::DNA);
}

#[test]
fn embl_protein_export_round_trips_as_protein() {
    let mut doc = parse_genbank_flatfile(GB, "fallback");
    doc.molecule_type = MoleculeType::Protein;
    doc.sequence = "MKTAYIAKQRQISFVKSHFSRQ".into();
    doc.features.clear();
    let embl = export_embl_flatfile(&doc);
    let back = parse_embl_flatfile(&embl, "fallback");
    assert_eq!(back.molecule_type, MoleculeType::Protein, "{embl}");
    assert_eq!(back.sequence, "MKTAYIAKQRQISFVKSHFSRQ");
}

#[test]
fn fasta_comment_lines_are_not_read_as_sequence() {
    let docs = molbiocraft_formats::parse_fasta_noodles(";classic comment\nACGTACGTACGT\n", "raw");
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].sequence, "ACGTACGTACGT");
}

/// Annotation-only (contig summary) records: exports keep the declared length
/// so features stay inside the record, and re-import as summary records.
#[test]
fn annotation_only_records_export_with_their_declared_length() {
    let summary_gb = "LOCUS       NC_000913            4641652 bp    DNA     circular CON 01-JAN-2026
DEFINITION  Escherichia coli K-12 summary.
ACCESSION   NC_000913
FEATURES             Location/Qualifiers
     source          1..4641652
                     /organism=\"Escherichia coli\"
     gene            190..255
                     /gene=\"thrL\"
//
";
    let doc = parse_genbank_flatfile(summary_gb, "fallback");
    assert!(doc.sequence.is_empty());
    assert_eq!(doc.features.len(), 2);

    let embl = export_embl_flatfile(&doc);
    assert!(embl.lines().next().unwrap().contains("4641652 BP."), "{embl}");
    assert!(!embl.contains("SQ   Sequence"), "no SQ block without bases: {embl}");
    let back = parse_embl_flatfile(&embl, "fallback");
    assert!(back.sequence.is_empty());
    assert_eq!(back.features.len(), 2);
    assert_eq!(back.features[0].end, 4_641_652);

    let gff = molbiocraft_formats::export_gff3_noodles(&doc);
    assert!(gff.contains("##sequence-region NC_000913 1 4641652"), "{gff}");
}
