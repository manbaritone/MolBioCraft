// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! End-to-end integration test suite for `molbiocraft-wasm` Resident Sequence Store & Unified RPC:
//! - Verifies `ensure_resident_sequence`, `slice_resident_viewport`, `get_resident_track_overview`,
//!   `search_resident_motif_fmindex`, `evict_resident_sequence`, and `resident_store_stats` on both
//!   multi-hundred-kilobase chromosomes and 10,000+ aa giant proteins
//! - Verifies all new RPC operations across pipelines, reference databases, `.mbc` checksums,
//!   chromatogram viewports, reaction buffers, Golden Gate overhang fidelity, protein motifs,
//!   3D geometry, Mash minimizers, and coalescent recombination/Robinson-Foulds.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

/// Watson-Crick complement by a hand table, base for base and unreversed: the strand a viewer draws
/// 3'->5' beneath the top strand. Fixture windows are plain ACGT, so anything else is a fixture error.
fn hand_complement_dna(top: &str) -> String {
    top.chars()
        .map(|c| match c {
            'A' => 'T',
            'T' => 'A',
            'G' => 'C',
            'C' => 'G',
            other => panic!("fixture window holds a non-ACGT base {other:?}"),
        })
        .collect()
}

#[test]
fn resident_sequence_store_handles_large_chromosomes_and_giant_proteins_with_cache_hits() {
    // 1. Generate 500 kbp bacterial chromosome via RPC
    let big_chr = dispatch_bio_rpc(
        "generate_large_genome_benchmark",
        json!({ "lengthBp": 500_000 }),
    )
    .expect("generate_large_genome_benchmark failed");
    let chr_id = big_chr["id"].as_str().unwrap();
    let chr_seq = big_chr["sequence"].as_str().unwrap();
    let chr_feats = big_chr["features"].clone();
    assert_eq!(chr_seq.len(), 500_000);

    // First registration -> cacheHit == false
    let ack1 = dispatch_bio_rpc(
        "ensure_resident_sequence",
        json!({
            "docId": chr_id,
            "revisionKey": "rev-500k-v1",
            "seq": chr_seq,
            "features": chr_feats,
            "isRna": false,
            "isProtein": false,
            "bins": 180
        }),
    )
    .unwrap();
    assert_eq!(ack1["cacheHit"], false);
    assert_eq!(ack1["sequenceLength"], 500_000);

    // Second registration with same revisionKey -> instant cacheHit == true even with empty seq!
    let ack2 = dispatch_bio_rpc(
        "ensure_resident_sequence",
        json!({
            "docId": chr_id,
            "revisionKey": "rev-500k-v1",
            "seq": "",
            "isRna": false,
            "isProtein": false
        }),
    )
    .unwrap();
    assert_eq!(ack2["cacheHit"], true);
    assert_eq!(ack2["sequenceLength"], 500_000);

    // Slice 1,200 bp page in middle of 500 kbp chromosome WITHOUT passing `seq`!
    let vp = dispatch_bio_rpc(
        "slice_resident_viewport",
        json!({
            "docId": chr_id,
            "startPos": 240_001,
            "endPos": 241_200
        }),
    )
    .unwrap();
    assert_eq!(vp["totalLength"], 500_000);
    assert_eq!(vp["topStrand"].as_str().unwrap().len(), 1_200);
    assert_eq!(vp["bottomStrand"].as_str().unwrap().len(), 1_200);

    // The page carries the window's own bases. Oracles independent of slice_resident_viewport:
    // - the 1-based inclusive window 240001..=241200 is the 0-based half-open chr_seq[240_000..241_200]
    //   of the sequence this test registered;
    // - its first and last 64 bases, and their complements, as Python 3 + Biopython 1.85 give them
    //   from the same benchmark written to FASTA (SeqIO.parse, rec.seq[240000:241200],
    //   .complement()). The generator is seeded, so these stay fixed while it is unchanged;
    // - the bottom strand is the base-for-base complement, unreversed, by the hand table below.
    const CHR_TOP_HEAD: &str = "AGTTCCATGGCAGCAAGACCGTCTGGTACCGTTTTAAAGGGGAAGCGGTGGCTACACCTAAAAA";
    const CHR_TOP_TAIL: &str = "AAAATTGGGAGACGCATGCACGAGGCATGGTAAATGGATGAAGCCAGAGAGTAGAGCTGACGCC";
    const CHR_BOTTOM_HEAD: &str = "TCAAGGTACCGTCGTTCTGGCAGACCATGGCAAAATTTCCCCTTCGCCACCGATGTGGATTTTT";
    const CHR_BOTTOM_TAIL: &str = "TTTTAACCCTCTGCGTACGTGCTCCGTACCATTTACCTACTTCGGTCTCTCATCTCGACTGCGG";
    let top = vp["topStrand"].as_str().unwrap();
    let bottom = vp["bottomStrand"].as_str().unwrap();
    assert_eq!(top, &chr_seq[240_000..241_200]);
    assert_eq!(&top[..64], CHR_TOP_HEAD);
    assert_eq!(&top[1_136..], CHR_TOP_TAIL);
    assert_eq!(bottom, hand_complement_dna(&chr_seq[240_000..241_200]));
    assert_eq!(&bottom[..64], CHR_BOTTOM_HEAD);
    assert_eq!(&bottom[1_136..], CHR_BOTTOM_TAIL);

    // Cached track overview returns 180 bins instantly
    let ov = dispatch_bio_rpc(
        "get_resident_track_overview",
        json!({ "docId": chr_id }),
    )
    .unwrap();
    assert_eq!(ov["binCount"], 180);
    assert_eq!(ov["sequenceLengthBp"], 500_000);

    // Resident motif search finds EcoRI / 6-mer hits without re-transferring 500 kbp
    let probe = &chr_seq[12_340..12_350];
    let found = dispatch_bio_rpc(
        "search_resident_motif_fmindex",
        json!({
            "docId": chr_id,
            "pattern": probe,
            "bothStrands": true,
            "maxHits": 100
        }),
    )
    .unwrap();
    // The reply is { hits, totalHits, warnings } (BG-01M6S17C); the hits are its list.
    let hits = &found["hits"];
    assert!(!hits.as_array().unwrap().is_empty());

    // 2. Register a 10,000 aa giant protein and verify secondary-structure & biochemical class tracks
    let big_prot = dispatch_bio_rpc(
        "generate_large_protein_benchmark",
        json!({ "lengthAa": 10_000 }),
    )
    .unwrap();
    let prot_id = big_prot["id"].as_str().unwrap();
    let prot_seq = big_prot["sequence"].as_str().unwrap();

    dispatch_bio_rpc(
        "ensure_resident_sequence",
        json!({
            "docId": prot_id,
            "revisionKey": "rev-prot-10k",
            "seq": prot_seq,
            "features": big_prot["features"],
            "isRna": false,
            "isProtein": true
        }),
    )
    .unwrap();

    let prot_vp = dispatch_bio_rpc(
        "slice_resident_viewport",
        json!({
            "docId": prot_id,
            "startPos": 1,
            "endPos": 600
        }),
    )
    .unwrap();
    assert_eq!(prot_vp["topStrand"].as_str().unwrap().len(), 600);
    assert_eq!(prot_vp["bottomStrand"].as_str().unwrap().len(), 0);
    // Residues 1..=600 are prot_seq[0..600]; first and last 64 as Biopython reads them from the
    // same benchmark FASTA (rec.seq[0:600]).
    const PROT_HEAD: &str = "MLIEVEKPLYGVEVFVGETAHFEIELSEPDVHGQWKLKGQPLAASPDCEIIEDGKKHILILHNC";
    const PROT_TAIL: &str = "TGEVSFQAANAKSAANLKVKELEAAAKALEAEKAAKEAAAKALEAEKAAKLIEVEKPLYGVEVF";
    let prot_top = prot_vp["topStrand"].as_str().unwrap();
    assert_eq!(prot_top, &prot_seq[..600]);
    assert_eq!(&prot_top[..64], PROT_HEAD);
    assert_eq!(&prot_top[536..], PROT_TAIL);
    assert_eq!(
        prot_vp["proteinSecondaryStates"].as_str().unwrap().len(),
        600
    );
    assert_eq!(
        prot_vp["proteinResidueClasses"].as_str().unwrap().len(),
        600
    );

    let stats = dispatch_bio_rpc("resident_store_stats", Value::Null).unwrap();
    assert!(stats["residentDocCount"].as_u64().unwrap() >= 2);

    // Evict and confirm RESIDENT_MISS error on evicted docId
    let evicted = dispatch_bio_rpc(
        "evict_resident_sequence",
        json!({ "docId": prot_id }),
    )
    .unwrap();
    assert_eq!(evicted, true);
    let miss = dispatch_bio_rpc(
        "slice_resident_viewport",
        json!({ "docId": prot_id, "startPos": 1, "endPos": 60 }),
    );
    assert!(miss.is_err());
    assert!(miss.unwrap_err().starts_with("RESIDENT_MISS:"));
}

#[test]
fn unified_rpc_dispatches_all_new_domain_operations_cleanly() {
    // Reference Databases
    let db_cats = dispatch_bio_rpc("get_reference_database_categories", Value::Null).unwrap();
    assert_eq!(db_cats.as_array().unwrap().len(), 8);

    let db_hits = dispatch_bio_rpc(
        "query_curated_database_records",
        json!({ "category": "", "query": "GFP" }),
    )
    .unwrap();
    assert!(!db_hits.as_array().unwrap().is_empty());
    let first_rec_id = db_hits[0]["id"].as_str().unwrap();

    let db_doc = dispatch_bio_rpc(
        "build_curated_database_document",
        json!({ "recordId": first_rec_id, "timestampIso": "2026-10-31T09:00:00Z" }),
    )
    .unwrap();
    assert!(!db_doc["sequence"].as_str().unwrap().is_empty());

    // Guided Bio Pipelines
    let pipe_cat = dispatch_bio_rpc("get_bio_pipeline_catalog", Value::Null).unwrap();
    assert_eq!(pipe_cat.as_array().unwrap().len(), 4);

    let samples = dispatch_bio_rpc("get_sample_library", Value::Null).unwrap();
    let sample0 = &samples.as_array().unwrap()[0];
    let pipe_run = dispatch_bio_rpc(
        "execute_bio_pipeline_rust",
        json!({
            "doc": sample0,
            "pipelineId": "cloning-expression-qc",
            "hostOS": "macos",
            "completedAtIso": "2026-10-31T09:00:00Z"
        }),
    )
    .unwrap();
    assert_eq!(pipe_run["pipelineId"], "cloning-expression-qc");
    assert_eq!(pipe_run["steps"].as_array().unwrap().len(), 5);

    // .mbc Checksum & Chromatogram Viewport
    let checksum = dispatch_bio_rpc(
        "compute_mbc_payload_checksum",
        json!({
            "docs": [{
                "id": "d1",
                "name": "pTEST",
                "topology": "circular",
                "moleculeType": "DNA",
                "sequence": "GAATTCATGGTGAGCAAG",
                "featureCount": 2,
                "primerCount": 1
            }]
        }),
    )
    .unwrap();
    assert_eq!(checksum.as_str().unwrap().len(), 8);

    let chrom = dispatch_bio_rpc(
        "synthesize_chromatogram",
        json!({ "seq": "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACC" }),
    )
    .unwrap();
    let chrom_vp = dispatch_bio_rpc(
        "compute_chromatogram_viewport",
        json!({
            "chromatogram": chrom,
            "baseOffset": 0,
            "windowBases": 36,
            "rawMode": false,
            "autoscaled": true,
            "verticalScale": 1.0
        }),
    )
    .unwrap();
    assert!(!chrom_vp["pathA"].as_str().unwrap().is_empty());

    // Reaction Buffers, Golden Gate Fidelity & Protein Motifs / 3D / Mash / RF
    let buf_plan = dispatch_bio_rpc(
        "evaluate_multi_digest_buffer_plan",
        json!({ "enzymes": ["EcoRI", "BamHI"] }),
    )
    .unwrap();
    assert!(buf_plan["minimumSharedActivityPct"].as_u64().unwrap() >= 50);

    let gg = dispatch_bio_rpc(
        "evaluate_golden_gate_overhang_fidelity",
        json!({ "overhangs": ["GGAG", "TACT", "AATG", "GCTT"] }),
    )
    .unwrap();
    // Rule-based screen: no numeric fidelity (NaN serialises to null) and no flags for a clean set.
    assert!(gg["overallFidelityPct"].is_null());
    assert_eq!(gg["riskyPairs"].as_array().unwrap().len(), 0);
    assert_eq!(gg["palindromicOverhangs"].as_array().unwrap().len(), 0);

    let motifs = dispatch_bio_rpc(
        "scan_protein_functional_motifs",
        json!({ "proteinSeq": "MGSHHHHHHGSENLYFQGMVSKGEELFTGVVPILKDEL" }),
    )
    .unwrap();
    assert!(motifs["totalHits"].as_u64().unwrap() >= 3);

    let mash = dispatch_bio_rpc(
        "compute_mash_minimizer_distance",
        json!({
            "seqA": "ATGCGATCGCTAGCTAGCATGCGTACGTAGCTGATCGCATGCTAGCGATCGTAGCTAGCTAGCG",
            "seqB": "ATGCGATCGCTAGCTAGCATGCGTACGTAGCTGATCGCATGCTAGCGATCGTAGCTAGCTAGCG"
        }),
    )
    .unwrap();
    assert_eq!(mash["estimatedAniPct"], 100.0);

    let rf = dispatch_bio_rpc(
        "compare_tree_topologies_robinson_foulds",
        json!({
            "newickA": "((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1);",
            "newickB": "((A:0.2,B:0.3):0.1,(C:0.4,D:0.1):0.2);"
        }),
    )
    .unwrap();
    assert_eq!(rf["robinsonFouldsDistance"], 0);
}
