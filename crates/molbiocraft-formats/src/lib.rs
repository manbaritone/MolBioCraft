// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod bam;
pub mod chromatogram_mbc;
pub mod flatfiles;
pub mod genomic_tracks_noodles;
pub mod noodles_io;
pub mod pdb_mmcif;
pub mod reference_databases;
pub mod scf;

pub use bam::bam_to_sam_text;
pub use scf::{parse_scf_chromatogram, ScfTrace};

pub use chromatogram_mbc::{
    build_ncbi_reference_preset_document, compute_chromatogram_viewport,
    compute_mbc_crc32_checksum_docs, compute_mbc_payload_checksum, is_mbc_file_or_payload_rust,
    parse_mbc_workbench_bytes_rust, parse_mbc_workbench_rust, serialize_mbc_workbench_rust,
    trim_sanger_trace_mott_phred, ChromatogramViewportReport, HeterozygotePeakCall,
    MbcChecksumDocInput, MbcDisplaySettingsRust, MbcSelectedRangeRust,
    MbcWorkbenchFileEnvelopeRust, MbcWorkbenchSnapshotInput, MbcWorkspaceUiStateRust,
    MottPhredTrimReport, ParsedMbcWorkbenchResultRust, MBC_FORMAT_MAGIC, MBC_SCHEMA_VERSION,
};
pub use genomic_tracks_noodles::{
    annotate_vcf_coding_consequences_noodles, compute_grantham_distance,
    compute_sam_pileup_and_coverage_noodles, intersect_genomic_intervals_noodles,
    AnnotatedVcfConsequence, CoverageTrackWindow, GenomicIntervalAlgebraReport,
    IntersectedIntervalRecord, PileupVariantCall, SamPileupCoverageReport,
    VcfConsequenceSummaryReport,
};

pub use flatfiles::{
    encode_abif_chromatogram_bytes, export_embl_flatfile, export_genbank_flatfile, parse_embl_flatfile,
    parse_abif_chromatogram, parse_binary_sequence_packet, parse_genbank_flatfile,
    prepare_genbank_submission_package, synthesize_sanger_chromatogram, GenBankSubmissionMeta,
    GenBankSubmissionPackage, GenBankValidationIssue,
};
pub use noodles_io::{
    color_for_feature_type, export_fasta_noodles, export_gff3_noodles, parse_bed_noodles,
    parse_fasta_noodles, parse_fastq_noodles, parse_gff3_noodles, parse_sam_noodles,
    parse_vcf_noodles, FastqParseSummary, FastqReadRecord, ParsedVcfVariant, SamAlignmentSummary,
};
pub use pdb_mmcif::{
    one_to_three_aa, parse_pdb_or_mmcif_ca_coordinates, synthesize_folded_pdb_from_protein,
    three_to_one_aa, PdbCaAtom,
};
pub use reference_databases::{
    build_curated_database_document, get_curated_database_records,
    get_reference_database_categories, parse_remote_database_payload,
    query_curated_database_records, CuratedDatabaseRecord, ReferenceDatabaseCategoryMeta,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_exports_fasta_fastq_gff3_bed_vcf_and_sam_via_noodles() {
        let fasta_in = ">pUC19_Test circular cloning plasmid\nGAATTCATGGTGAGCAAGGGCGAGGAG\nCTGTTCACCGGGGTGGTG\n";
        let docs = parse_fasta_noodles(fasta_in, "Fallback");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "pUC19_Test");
        assert_eq!(docs[0].sequence.len(), 45);

        let fasta_out = export_fasta_noodles(&docs[0]);
        assert!(fasta_out.starts_with(">pUC19_Test"));

        // FASTA export on a record longer than one FASTA line, so a dropped, truncated or
        // reordered sequence fails. Biopython 1.88 is the oracle: `SeqIO.read` of this export
        // gives id "pUC19_Test" and the same 130 bases, and `FastaWriter(handle, wrap=80)`
        // (noodles' default width) writes exactly this text when handed the same id, sequence
        // and the header MolBioCraft writes ("<accession> | <description> | <length> bp"), so
        // the comparison checks the layout and the bases, not the header wording.
        const SEQ130: &str = "ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTA";
        let long_in = format!(">pUC19_Test circular cloning plasmid\n{}\n{}\n{}\n", &SEQ130[..60], &SEQ130[60..120], &SEQ130[120..]);
        let long_doc = parse_fasta_noodles(&long_in, "Fallback").remove(0);
        assert_eq!(long_doc.sequence, SEQ130);
        let long_out = export_fasta_noodles(&long_doc);
        assert_eq!(
            long_out,
            ">pUC19_Test FASTA_001 | circular cloning plasmid | 130 bp\n\
             ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGC\n\
             CGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTA\n"
        );
        // Read back the way Biopython's SimpleFastaParser reads FASTA (title after '>', id up
        // to the first space, the bases every following line joined), not through noodles.
        let mut fasta_lines = long_out.lines();
        let title = fasta_lines.next().and_then(|l| l.strip_prefix('>')).expect("FASTA title line");
        assert_eq!(title.split_whitespace().next(), Some("pUC19_Test"));
        assert_eq!(fasta_lines.collect::<String>(), SEQ130);
        // And through MolBioCraft's own reader: export then import loses nothing.
        let again = parse_fasta_noodles(&long_out, "Fallback");
        assert_eq!((again.len(), again[0].name.as_str(), again[0].sequence.as_str()), (1, "pUC19_Test", SEQ130));

        let fastq_in = "@read1 flowcell\nGAATTCATGGTG\n+\nIIIIIIIIIIII\n@read2 flowcell\nATGGTGAGCAAG\n+\nFFFFFFFFFFFF\n";
        let fq = parse_fastq_noodles(fastq_in, 10);
        assert_eq!(fq.read_count, 2);
        assert!(fq.q30_base_pct > 99.0);

        let gff_out = export_gff3_noodles(&parse_genbank_flatfile(
            "LOCUS       pTEST        24 bp    ds-DNA  circular SYN 31-OCT-2026\nFEATURES             Location/Qualifiers\n     CDS             4..21\n                     /label=\"MiniORF\"\nORIGIN\n        1 gaattcatgg tgagcaagta agga\n//\n",
            "pTEST",
        ));
        let gff_feats = parse_gff3_noodles(&gff_out);
        assert_eq!(gff_feats.len(), 1);
        assert_eq!(gff_feats[0].start, 4);
        assert_eq!(gff_feats[0].end, 21);

        // GFF3 export carries annotations only (no ##FASTA section), so pin what it carries:
        // every feature, its segments, strand and CDS phase. Expected lines derived by hand from
        // the GFF3 specification (v1.26): seqid, source, type, 1-based inclusive start and end,
        // score ".", strand, phase, attributes; one line per segment of a multi-segment feature,
        // all sharing its ID. Phase is the number of bases to skip from the start of a CDS
        // segment, in the direction of transcription, to reach the next codon: the minus-strand
        // CDS is read from 58 down, so 46..58 (13 bases) has phase 0 and 30..40 starts
        // 13 mod 3 = 1 base into a codon, phase (3 - 1) mod 3 = 2. BCBio-GFF 0.7.1 reads this
        // export as CDS [3:21](+) phase 0, [29:40](-) phase 2 and [45:58](-) phase 0.
        let two_cds = parse_genbank_flatfile(
            "LOCUS       pTEST                     60 bp    DNA     linear   SYN 31-OCT-2026\nFEATURES             Location/Qualifiers\n     CDS             4..21\n                     /label=\"MiniORF\"\n     CDS             complement(join(30..40,46..58))\n                     /label=\"RevCDS\"\nORIGIN\n        1 gaattcatgg tgagcaagta aggagaattc atggtgagca agtaaggaga attcatggtg\n//\n",
            "pTEST",
        );
        let two_out = export_gff3_noodles(&two_cds);
        assert_eq!(
            two_out,
            "##gff-version 3\n\
             ##sequence-region GB_IMPORT_001 1 60\n\
             GB_IMPORT_001\tMolBioCraft\tCDS\t4\t21\t.\t+\t0\tID=gb-feat-1;Name=MiniORF\n\
             GB_IMPORT_001\tMolBioCraft\tCDS\t30\t40\t.\t-\t2\tID=gb-feat-2;Name=RevCDS\n\
             GB_IMPORT_001\tMolBioCraft\tCDS\t46\t58\t.\t-\t0\tID=gb-feat-2;Name=RevCDS\n"
        );
        let back = parse_gff3_noodles(&two_out);
        assert_eq!(back.len(), 2);
        let rev = back.iter().find(|f| f.name == "RevCDS").expect("RevCDS");
        assert_eq!((rev.start, rev.end, rev.strand), (30, 58, -1));
        let segs: Vec<(usize, usize)> = rev.segments.as_ref().expect("two segments").iter().map(|s| (s.start, s.end)).collect();
        assert_eq!(segs, vec![(30, 40), (46, 58)]);

        let bed_feats = parse_bed_noodles("chr1\t100\t250\nchr1\t500\t900\n");
        assert_eq!(bed_feats.len(), 2);
        assert_eq!(bed_feats[0].start, 101); // 0-based BED -> 1-based Position!
        assert_eq!(bed_feats[0].end, 250);

        let vcf_text = "##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t142\t.\tA\tG\t99\tPASS\t.\n";
        let vars = parse_vcf_noodles(vcf_text);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].position, 142);
        assert_eq!(vars[0].ref_bases, "A");
        assert_eq!(vars[0].alt_bases, vec!["G".to_string()]);

        let sam_text = "@HD\tVN:1.6\tSO:coordinate\n@SQ\tSN:chr1\tLN:1000\nr1\t0\tchr1\t10\t60\t12M\t*\t0\t0\tGAATTCATGGTG\tIIIIIIIIIIII\n";
        let sam = parse_sam_noodles(sam_text);
        assert_eq!(sam.mapped_records, 1);
        assert_eq!(sam.mean_mapq, 60.0);
    }

    #[test]
    fn synthesizes_and_parses_3d_pdb_backbone_coordinates() {
        let pdb = synthesize_folded_pdb_from_protein(
            "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK",
            "A",
            0.0,
        );
        let atoms = parse_pdb_or_mmcif_ca_coordinates(&pdb);
        assert_eq!(atoms.len(), 239);
        assert!(atoms.iter().any(|a| a.secondary_structure == "H" || a.secondary_structure == "E"));
    }

    #[test]
    fn encodes_and_decodes_abif_v1_chromatogram_binary_tags_losslessly() {
        let orig_seq = "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACC";
        let synth = synthesize_sanger_chromatogram(orig_seq);
        let abif_bytes = encode_abif_chromatogram_bytes(&synth);
        assert!(abif_bytes.starts_with(b"ABIF"));

        let decoded = parse_abif_chromatogram(&abif_bytes).expect("ABIF v1.0 directory should parse");
        assert_eq!(decoded.base_calls, orig_seq);
        assert_eq!(decoded.phred_scores, synth.phred_scores);
        assert_eq!(decoded.peak_locations, synth.peak_locations);
        assert_eq!(decoded.trace_a.len(), synth.trace_a.len());

        let doc = parse_binary_sequence_packet(&abif_bytes, "SangerRead_Forward.ab1");
        assert_eq!(doc.sequence, orig_seq);
        assert!(doc.chromatogram.is_some());
        assert!(doc.history[0].operation.contains("ABIF"));
        assert_eq!(doc.name, "SangerRead_Forward");
    }
}
