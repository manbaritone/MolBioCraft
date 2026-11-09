// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-formats`:
//! - Reference Database Explorer catalog, `aho-corasick` multi-keyword query, document materialization,
//!   and remote NCBI/UniProt FASTA & GenBank payload parsing via `noodles-fasta`
//! - Bit-identical streaming UTF-16 `.mbc` FNV-1a 32-bit payload checksum verification
//! - Sanger 4-dye `.ab1` chromatogram viewport SVG polyline/area generator, Phred Q20/Q30 trim bounds,
//!   signal-to-noise ratio (SNR), and IUPAC mixed-base heterozygote peak calling
//! - GenBank, EMBL, GFF3, FASTA, FASTQ, BED, VCF, SAM, PDB, and mmCIF round-trip parsing.

use molbiocraft_core::{ChromatogramData, MoleculeType, Topology};
use molbiocraft_formats::{
    build_curated_database_document, compute_chromatogram_viewport, compute_mbc_payload_checksum,
    export_embl_flatfile, export_fasta_noodles, export_genbank_flatfile, export_gff3_noodles,
    get_curated_database_records, get_reference_database_categories,
    parse_pdb_or_mmcif_ca_coordinates, parse_remote_database_payload,
    prepare_genbank_submission_package, query_curated_database_records,
    synthesize_folded_pdb_from_protein, synthesize_sanger_chromatogram, CuratedDatabaseRecord,
    GenBankSubmissionMeta, MbcChecksumDocInput,
};

/// The record fields the reference-record search covers, lower-cased: an independent oracle for
/// "this record matches that term".
fn searchable_text(r: &CuratedDatabaseRecord) -> String {
    [&r.accession, &r.title, &r.organism, &r.metadata_badge, &r.summary]
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("\n")
}

/// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320): the checksum Python's `zlib.crc32`
/// computes, so a pinned value is derived outside this workspace.
fn crc32_ieee(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn sorted_ids(recs: &[CuratedDatabaseRecord]) -> Vec<String> {
    let mut ids: Vec<String> = recs.iter().map(|r| r.id.clone()).collect();
    ids.sort();
    ids
}

#[test]
fn reference_database_categories_aho_corasick_search_and_document_materialization() {
    let cats = get_reference_database_categories();
    assert_eq!(cats.len(), 8);
    assert!(cats.iter().any(|c| c.id == "ncbi-nucleotide" && c.label == "NCBI Nucleotide"));
    assert!(cats.iter().any(|c| c.id == "uniprot" && c.label == "UniProtKB"));
    assert!(cats.iter().any(|c| c.id == "ncbi-structure" && c.label == "NCBI Structure (PDB)"));

    let all_recs = get_curated_database_records();
    assert!(all_recs.len() >= 14);

    // Multi-token case-insensitive Aho-Corasick intersection query
    let cas9_hits = query_curated_database_records("", "cas9 pyogenes");
    assert!(!cas9_hits.is_empty());
    assert!(cas9_hits
        .iter()
        .any(|r| r.title.to_ascii_lowercase().contains("cas9")));

    // A query narrows the list: every hit carries every term, and the hits are exactly the
    // matching records, strictly fewer than the unfiltered list.
    let unfiltered = query_curated_database_records("", "");
    assert_eq!(unfiltered.len(), all_recs.len());
    assert!(cas9_hits.len() < unfiltered.len());
    assert!(cas9_hits.iter().all(|r| {
        let text = searchable_text(r);
        text.contains("cas9") && text.contains("pyogenes")
    }));
    assert_eq!(
        sorted_ids(&cas9_hits),
        ["db-nucl-spcas9", "db-pubmed-jinek2012", "db-struct-4oo8", "db-uniprot-cas9"]
    );

    // Terms combine with AND, case-insensitively: each term alone matches records the pair excludes.
    let crystal_hits = query_curated_database_records("", "crystal");
    let pyogenes_hits = query_curated_database_records("", "pyogenes");
    assert!(crystal_hits.iter().all(|r| searchable_text(r).contains("crystal")));
    assert!(pyogenes_hits.iter().all(|r| searchable_text(r).contains("pyogenes")));
    assert!(crystal_hits.iter().any(|r| r.id == "db-nucl-gfp-wt"));
    assert!(pyogenes_hits.iter().any(|r| r.id == "db-nucl-spcas9"));
    let both_terms = query_curated_database_records("", "CRYSTAL Pyogenes");
    assert_eq!(sorted_ids(&both_terms), ["db-struct-4oo8"]);
    assert!(both_terms.len() < crystal_hits.len());
    assert!(both_terms.len() < pyogenes_hits.len());

    // A query that matches nothing returns nothing, alone or beside a term that does match.
    assert!(query_curated_database_records("", "zzqx").is_empty());
    assert!(query_curated_database_records("", "cas9 zzqx").is_empty());

    // A category with no query lists that category's records, and only those.
    let uniprot_all = query_curated_database_records("uniprot", "");
    assert_eq!(
        uniprot_all.len(),
        all_recs.iter().filter(|r| r.category == "uniprot").count()
    );
    assert!(uniprot_all.iter().all(|r| r.category == "uniprot"));
    assert!(uniprot_all.len() < unfiltered.len());

    let uniprot_only = query_curated_database_records("uniprot", "fluorescent");
    assert!(!uniprot_only.is_empty());
    assert!(uniprot_only.iter().all(|r| r.category == "uniprot"));
    // Category and query together: the query narrows the category, the category narrows the query.
    assert_eq!(sorted_ids(&uniprot_only), ["db-uniprot-gfp"]);
    assert!(uniprot_only.len() < uniprot_all.len());
    assert!(uniprot_only.len() < query_curated_database_records("", "fluorescent").len());

    // Materialise one DNA record and two Protein records - by id, and by accession in another case -
    // into SequenceDocuments that carry that record's identity and its own sequence. Oracle: the
    // record literals in get_curated_database_records(), read from the source text by Python 3
    // (re; zlib.crc32 for the checksum). The two protein sequences are also the UniProtKB canonical
    // P04637 and P42212 sequences (rest.uniprot.org, fetched 2026-11-06), and the TP53 DNA
    // translates (Biopython 1.85) to P04637 residues 94-393 and a stop.
    assert_eq!(crc32_ieee(b"123456789"), 0xCBF4_3926); // the CRC-32 check value
    assert_eq!(all_recs[0].id, "db-gene-tp53");
    let expected = [
        // (lookup, record id, doc id, doc name, accession, molecule, document kind, length, CRC-32)
        (
            all_recs[0].id.as_str(),
            "db-gene-tp53",
            "doc-db-db-gene-tp53-903",
            "TP53_GeneID_7157",
            "GeneID:7157",
            MoleculeType::DNA,
            "linear-dna",
            903,
            0xBDE1_3988u32,
        ),
        (
            "db-prot-p53",
            "db-prot-p53",
            "doc-db-db-prot-p53-393",
            "Cellular_Tumor_Antigen_p53_Isoform_a__Homo_sapiens_NP_000537.3",
            "NP_000537.3",
            MoleculeType::Protein,
            "protein",
            393,
            0x8119_E675,
        ),
        (
            "p42212",
            "db-uniprot-gfp",
            "doc-db-db-uniprot-gfp-238",
            "GFP_AEQVI_P42212",
            "P42212",
            MoleculeType::Protein,
            "protein",
            238,
            0x116E_ED47,
        ),
    ];
    for (lookup, record_id, doc_id, name, accession, molecule, kind, len, crc) in expected {
        let doc = build_curated_database_document(lookup, "2026-10-31T08:00:00Z")
            .unwrap_or_else(|| panic!("curated record {lookup} did not materialise"));
        assert_eq!(doc.id, doc_id, "{lookup}");
        assert_eq!(doc.name, name, "{lookup}");
        assert_eq!(doc.accession, accession, "{lookup}");
        assert_eq!(doc.molecule_type, molecule, "{lookup}");
        assert_eq!(doc.document_kind.as_deref(), Some(kind), "{lookup}");
        assert_eq!(doc.sequence.len(), len, "{lookup}");
        assert_eq!(crc32_ieee(doc.sequence.as_bytes()), crc, "{lookup}");
        let rec = all_recs.iter().find(|r| r.id == record_id).unwrap();
        assert_eq!(doc.sequence, rec.sequence, "{lookup}");
        assert!(!doc.features.is_empty());
        assert!(!doc.history.is_empty());
        assert!(doc.doc_metadata.is_some());
    }
    assert!(build_curated_database_document("db-no-such-record", "").is_none());

    // Remote payload parsing for both GenBank flatfile and multi-record FASTA
    let remote_fasta = ">NP_000537.3 cellular tumor antigen p53 [Homo sapiens]\nMEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP\n";
    let parsed_prot =
        parse_remote_database_payload(remote_fasta, "NP_000537.3", true, "Protein Documents");
    assert_eq!(parsed_prot.len(), 1);
    assert_eq!(parsed_prot[0].molecule_type, MoleculeType::Protein);
    assert_eq!(parsed_prot[0].folder, "Protein Documents");

    let remote_gb = concat!(
        "LOCUS       NM_001126112              42 bp    mRNA    linear   PRI 31-OCT-2026\n",
        "DEFINITION  Homo sapiens TP53 transcript variant.\n",
        "FEATURES             Location/Qualifiers\n",
        "     CDS             1..42\n",
        "                     /gene=\"TP53\"\n",
        "ORIGIN\n",
        "        1 atggaggagc cgcagtcaga tcctagcgtc gagccccctc tg\n",
        "//\n"
    );
    let parsed_gb =
        parse_remote_database_payload(remote_gb, "NM_001126112", false, "Sample Documents");
    assert_eq!(parsed_gb.len(), 1);
    assert_eq!(parsed_gb[0].sequence.len(), 42);
    assert_eq!(parsed_gb[0].features.len(), 1);
}

#[test]
fn mbc_payload_fnv1a_checksum_matches_reference_utf16_implementation() {
    let docs = vec![
        MbcChecksumDocInput {
            id: "doc-pet28".into(),
            name: "pET-28a(+)-eGFP".into(),
            topology: "circular".into(),
            molecule_type: "DNA".into(),
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTG".into(),
            feature_count: 9,
            primer_count: 2,
        },
        MbcChecksumDocInput {
            id: "doc-prot-α".into(),
            name: "Subunit_α_Chain".into(),
            topology: "linear".into(),
            molecule_type: "Protein".into(),
            sequence: "MVSKGEELFTGVVPILVELDGDVNGHKFSV".into(),
            feature_count: 1,
            primer_count: 0,
        },
    ];

    let rust_hex = compute_mbc_payload_checksum(&docs);
    assert_eq!(rust_hex.len(), 8);

    // Reference JS-equivalent UTF-16 FNV-1a over joined signature string
    let joined: String = docs
        .iter()
        .map(|d| {
            format!(
                "{}|{}|{}|{}|{}|{}|{}|{}",
                d.id,
                d.name,
                d.topology,
                d.molecule_type,
                d.sequence.encode_utf16().count(),
                d.feature_count,
                d.primer_count,
                d.sequence
            )
        })
        .collect();
    let mut ref_hash: u32 = 0x811c_9dc5;
    for cu in joined.encode_utf16() {
        ref_hash ^= u32::from(cu);
        ref_hash = ref_hash.wrapping_mul(0x0100_0193);
    }
    assert_eq!(rust_hex, format!("{:08x}", ref_hash));

    // Mutating 1 single nucleotide must change the FNV-1a checksum
    let mut mutated = docs.clone();
    mutated[0].sequence.replace_range(5..6, "T");
    assert_ne!(compute_mbc_payload_checksum(&mutated), rust_hex);
}

#[test]
fn chromatogram_viewport_polylines_quality_trim_and_heterozygote_caller() {
    let base_seq = "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAG";
    let mut chrom: ChromatogramData = synthesize_sanger_chromatogram(base_seq);
    assert_eq!(chrom.base_calls.len(), base_seq.len());

    // Inject a genuine heterozygous A/G ('R') mixed peak at base index 12 (peak sample = 12*10 + 5 = 125)
    let het_pt = chrom.peak_locations[12];
    chrom.trace_a[het_pt] = 920.0;
    chrom.trace_g[het_pt] = 680.0; // secondary ratio = 680/920 = 0.74 >= 0.30!
    chrom.trace_c[het_pt] = 15.0;
    chrom.trace_t[het_pt] = 12.0;

    let report = compute_chromatogram_viewport(&chrom, 0, 50, false, true, 1.0, 175.0, 145.0);
    assert_eq!(report.start_base, 0);
    assert_eq!(report.end_base, 50);
    assert!(!report.path_a.is_empty());
    assert!(!report.path_c.is_empty());
    assert!(!report.path_g.is_empty());
    assert!(!report.path_t.is_empty());
    assert!(!report.area_a.is_empty());
    assert!(report.mean_phred > 25.0);
    assert!(report.q20_pct > 80.0);
    assert!(report.hq_trim_end_1based > report.hq_trim_start_1based);
    assert!(report.signal_to_noise_ratio > 2.0);

    let het = report
        .heterozygote_peaks
        .iter()
        .find(|p| p.base_index == 12)
        .expect("Expected heterozygous A/G peak at base_index 12");
    assert_eq!(het.position_1based, 13);
    assert_eq!(het.iupac_code, "R");
    assert!(het.secondary_ratio >= 0.70);
}

#[test]
fn genbank_embl_gff3_submission_and_mmcif_coordinate_parsing() {
    let doc = build_curated_database_document(
        &get_curated_database_records()[0].id,
        "2026-10-31T00:00:00Z",
    )
    .unwrap();
    let gb = export_genbank_flatfile(&doc);
    assert!(gb.contains("LOCUS"));
    assert!(gb.contains("ORIGIN"));

    let embl = export_embl_flatfile(&doc);
    assert!(embl.starts_with("ID   "));
    assert!(embl.contains("SQ   Sequence"));

    let fasta = export_fasta_noodles(&doc);
    assert!(fasta.starts_with('>'));

    let gff3 = export_gff3_noodles(&doc);
    assert!(gff3.starts_with("##gff-version 3"));

    if doc.molecule_type == MoleculeType::DNA {
        let pkg = prepare_genbank_submission_package(
            &doc,
            &GenBankSubmissionMeta {
                organism: "Escherichia coli".into(),
                strain_or_isolate: "K-12 MG1655".into(),
                mol_type: "genomic DNA".into(),
                genetic_code_id: 11,
            },
        );
        assert!(pkg.fasta_fsa_text.starts_with('>'));
        assert!(pkg.feature_table_tbl_text.contains(">Feature"));
    }

    // Verify both PDB ATOM and mmCIF `_atom_site.` parsing produce valid 3D C-alpha traces
    let pdb = synthesize_folded_pdb_from_protein("MVSKGEELFTGVVPILVELDGDVNGHKFSV", "A", 0.0);
    let pdb_atoms = parse_pdb_or_mmcif_ca_coordinates(&pdb);
    assert_eq!(pdb_atoms.len(), 30);

    let mmcif = concat!(
        "data_TEST\n",
        "loop_\n",
        "_atom_site.group_PDB\n",
        "_atom_site.id\n",
        "_atom_site.type_symbol\n",
        "_atom_site.label_atom_id\n",
        "_atom_site.label_alt_id\n",
        "_atom_site.label_comp_id\n",
        "_atom_site.label_asym_id\n",
        "_atom_site.label_entity_id\n",
        "_atom_site.label_seq_id\n",
        "_atom_site.pdbx_PDB_ins_code\n",
        "_atom_site.Cartn_x\n",
        "_atom_site.Cartn_y\n",
        "_atom_site.Cartn_z\n",
        "_atom_site.occupancy\n",
        "_atom_site.B_iso_or_equiv\n",
        "ATOM 1 C CA . MET A 1 1 ? 10.120 12.450 8.300 1.00 92.4\n",
        "ATOM 2 C CA . VAL A 1 2 ? 13.710 13.520 9.110 1.00 94.1\n",
        "ATOM 3 C CA . SER A 1 3 ? 16.920 11.880 10.220 1.00 90.8\n"
    );
    let cif_atoms = parse_pdb_or_mmcif_ca_coordinates(mmcif);
    assert_eq!(cif_atoms.len(), 3);
    assert_eq!(cif_atoms[0].res_name, "MET");
    assert_eq!(cif_atoms[1].res_seq, 2);
    assert_eq!(Topology::Circular.to_string_check(), "circular");
}

trait TopologyExt {
    fn to_string_check(&self) -> &'static str;
}
impl TopologyExt for Topology {
    fn to_string_check(&self) -> &'static str {
        match self {
            Topology::Circular => "circular",
            Topology::Linear => "linear",
        }
    }
}

// ------------------------------------------------------------------------------------------------
// BG-01M6PXDT: a query term that contains another term (`cas` inside `cas9`) still has to match.
// ------------------------------------------------------------------------------------------------

/// A plain substring-AND oracle: the sorted ids of the records in `category` (every record when it
/// is empty) whose searchable text contains every whitespace-separated term of `query`,
/// case-insensitively.
fn substring_and_oracle(category: &str, query: &str) -> Vec<String> {
    let terms: Vec<String> = query.split_whitespace().map(str::to_ascii_lowercase).collect();
    let hits: Vec<CuratedDatabaseRecord> = get_curated_database_records()
        .into_iter()
        .filter(|r| category.is_empty() || r.category == category)
        .filter(|r| {
            let text = searchable_text(r);
            terms.iter().all(|t| text.contains(t.as_str()))
        })
        .collect();
    sorted_ids(&hits)
}

#[test]
fn overlapping_query_terms_all_match() {
    const CAS9: &[&str] = &[
        "db-nucl-spcas9",
        "db-pubmed-jinek2012",
        "db-struct-4oo8",
        "db-uniprot-cas9",
    ];
    // (category, query, the ids both the oracle and the search must return)
    let probes: &[(&str, &str, &[&str])] = &[
        // The two reported probes: a term that is a prefix of another.
        ("", "cas cas9", CAS9),
        ("", "lac lacz", &["db-gene-lacz"]),
        // One more prefix pair.
        ("", "poly polymerase", &["db-prot-taq", "db-pubmed-gibson2009"]),
        // Term order and case do not matter; a repeated term is still one term.
        ("", "CAS9 Cas", CAS9),
        ("", "cas9 cas9", CAS9),
        // A term that is a suffix of another.
        ("", "lactamase beta-lactamase", &["db-uniprot-bla"]),
        // A third, unrelated term still narrows: the containing term alone is not the answer.
        ("", "cas cas9 crystal", &["db-struct-4oo8"]),
        // The category still narrows an overlapping query.
        ("ncbi-protein", "poly polymerase", &["db-prot-taq"]),
        ("ncbi-pubmed", "POLY polymerase", &["db-pubmed-gibson2009"]),
    ];

    let mut failures = Vec::new();
    for &(category, query, expected) in probes {
        let oracle = substring_and_oracle(category, query);
        if oracle != expected {
            failures.push(format!("oracle {category:?} {query:?}: {oracle:?} != {expected:?}"));
        }
        let got = sorted_ids(&query_curated_database_records(category, query));
        if got != oracle {
            failures.push(format!("search {category:?} {query:?}: {got:?} != {oracle:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));

    // AND, not OR: each shorter term alone reaches records its pair excludes, so a search that
    // keeps a record matching either term fails the probes above.
    for (short, pair) in [("cas", "cas cas9"), ("lac", "lac lacz"), ("poly", "poly polymerase")] {
        let alone = sorted_ids(&query_curated_database_records("", short));
        assert_eq!(alone, substring_and_oracle("", short), "search {short:?}");
        assert!(alone.len() > substring_and_oracle("", pair).len(), "{short:?} vs {pair:?}");
    }
}
