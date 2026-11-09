// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-align`:
//! - $(w, k)$ canonical minimizer extraction, Mash mutation distance, ANI, and plasmid-in-chromosome containment
//! - `minimap2`-style seed-chain-extend long-read mapping (+ and - strands, structural indel detection)
//! - Multi-isolate pangenome Core / Shell / Strain-Specific Cloud locus partitioning & Heap's Law $\gamma$
//! - Pairwise Gotoh global/local/semi-global DNA & BLOSUM62/PAM250 protein alignments, MSA, BLAST, & Synteny.

use molbiocraft_align::{
    align_pairwise_gotoh, classify_sequence_taxonomy, compute_dotplot_hits,
    compute_mash_minimizer_distance, extract_canonical_minimizers, map_long_read_minimizer_chains,
    profile_pangenome_core_accessory, run_bbduk_read_trimming, run_local_blast_search,
    run_ngs_reference_mapping, run_whole_genome_synteny, BlastSubjectDoc, PairwiseMode,
    PangenomeGenomeInput, ReadTrimOptions, ScoringMatrixKind,
};
use molbiocraft_core::{mutate_or_shuffle_sequence, reverse_complement_iupac};

fn generate_reference_chromosome(len_bp: usize, seed: u64) -> String {
    let base_motif = "ATGCGATCGATCGCTAGCTAGCATCGGCTAGCTAGCGATCGATGCTAGCTAGCGATCGTACGTAGCTAGCG";
    let mut raw = String::with_capacity(len_bp + 128);
    while raw.len() < len_bp {
        raw.push_str(base_motif);
    }
    raw.truncate(len_bp);
    // Apply deterministic 35% point diversification so every window has unique non-repetitive k-mers!
    mutate_or_shuffle_sequence(&raw, "point-mutate", 35.0, seed).output_sequence
}

#[test]
fn canonical_minimizers_mash_distance_ani_and_plasmid_containment() {
    let genome_wt = generate_reference_chromosome(40_000, 1001);
    // 2% point-mutated conspecific strain (~98% true ANI)
    let genome_strain2 =
        mutate_or_shuffle_sequence(&genome_wt, "point-mutate", 2.0, 2002).output_sequence;
    // Unrelated diverged genome (~25% random identity)
    let genome_diverged = generate_reference_chromosome(40_000, 99999);

    let mins = extract_canonical_minimizers(&genome_wt, 15, 5);
    assert!(mins.len() > 4_000 && mins.len() < 20_000);

    // Identical genomes -> Jaccard = 1.0, Mash D = 0.0, ANI = 100.0%
    let self_mash = compute_mash_minimizer_distance(&genome_wt, &genome_wt, 15, 5, 2048);
    assert_eq!(self_mash.jaccard_index, 1.0);
    assert_eq!(self_mash.mash_distance, 0.0);
    assert_eq!(self_mash.estimated_ani_pct, 100.0);

    // Reverse complement of identical genome produces identical canonical minimizer sketch!
    let rc_wt = reverse_complement_iupac(&genome_wt, false);
    let rc_mash = compute_mash_minimizer_distance(&genome_wt, &rc_wt, 15, 5, 2048);
    assert!(rc_mash.estimated_ani_pct >= 99.8);

    // 2% diverged strain -> Mash ANI in [96.0%, 99.2%] (Conspecific >= 95% ANI boundary)
    let close_mash = compute_mash_minimizer_distance(&genome_wt, &genome_strain2, 15, 5, 2048);
    assert!(
        close_mash.estimated_ani_pct >= 95.5 && close_mash.estimated_ani_pct <= 99.5,
        "Expected ~98% ANI for 2% point mutant, got {}%",
        close_mash.estimated_ani_pct
    );
    assert!(close_mash.p_value < 1e-10);

    // Divergent sequence has much lower ANI than conspecific strain
    let far_mash = compute_mash_minimizer_distance(&genome_wt, &genome_diverged, 15, 5, 2048);
    assert!(far_mash.estimated_ani_pct < close_mash.estimated_ani_pct - 5.0);

    // Embedded 3,500 bp prophage / plasmid locus inside 40 kbp chromosome -> high asymmetric containment!
    let embedded_prophage = &genome_wt[12_000..15_500];
    let cont_report =
        compute_mash_minimizer_distance(embedded_prophage, &genome_wt, 15, 5, 4096);
    assert!(
        cont_report.containment_a_in_b >= 0.85,
        "Expected embedded prophage containment_a_in_b >= 0.85, got {}",
        cont_report.containment_a_in_b
    );
}

#[test]
fn seed_chain_extend_long_read_mapper_handles_both_strands_and_structural_indels() {
    let ref_chr = generate_reference_chromosome(30_000, 7777);

    // Read 1: + strand 1,200 bp HiFi read from 5,000..6,200 with 1% sequencing noise
    let r1_raw =
        mutate_or_shuffle_sequence(&ref_chr[5_000..6_200], "point-mutate", 1.0, 11).output_sequence;

    // Read 2: - strand (reverse-complemented) 1,400 bp ONT read from 18,000..19,400
    let r2_raw = reverse_complement_iupac(&ref_chr[18_000..19_400], false);

    // Read 3: + strand read carrying a 45 bp transposon insertion in the middle of 10,000..11,000
    let mut r3_raw = String::from(&ref_chr[10_000..10_500]);
    r3_raw.push_str("TTAACCGGTTAACCGGTTAACCGGTTAACCGGTTAACCGGTTAAC"); // +45 bp insertion
    r3_raw.push_str(&ref_chr[10_500..11_000]);

    let reads = vec![
        ("HiFi_Fwd_5k".to_string(), r1_raw),
        ("ONT_RevComp_18k".to_string(), r2_raw),
        ("HiFi_Ins45bp_10k".to_string(), r3_raw),
    ];

    let summary = map_long_read_minimizer_chains(&ref_chr, &reads, 13, 4);
    assert_eq!(summary.total_reads, 3);
    assert_eq!(summary.mapped_reads, 3);
    assert!(summary.mean_identity_pct >= 94.0);

    let aln1 = &summary.alignments[0];
    assert!(aln1.mapped);
    assert_eq!(aln1.strand, 1);
    assert!(aln1.ref_start_bp >= 4_990 && aln1.ref_start_bp <= 5_040);
    assert!(aln1.ref_end_bp >= 6_160 && aln1.ref_end_bp <= 6_210);

    let aln2 = &summary.alignments[1];
    assert!(aln2.mapped);
    assert_eq!(aln2.strand, -1);
    assert!(aln2.ref_start_bp >= 17_990 && aln2.ref_start_bp <= 18_050);

    let aln3 = &summary.alignments[2];
    assert!(aln3.mapped);
    assert!(
        (aln3.structural_indel_bp - 45).abs() <= 6,
        "Expected ~+45 bp structural insertion call, got {}",
        aln3.structural_indel_bp
    );
}

#[test]
fn pangenome_core_shell_cloud_and_heaps_law_openness_work() {
    let core_backbone = generate_reference_chromosome(12_000, 3030);
    let acc_a = generate_reference_chromosome(3_500, 4041);
    let acc_b = generate_reference_chromosome(3_500, 5052);
    let acc_c = generate_reference_chromosome(3_500, 6063);
    let shared_shell = generate_reference_chromosome(2_500, 7074);

    let genomes = vec![
        PangenomeGenomeInput {
            id: "g1".into(),
            name: "Isolate_K12".into(),
            sequence: format!("{}{}{}", core_backbone, shared_shell, acc_a),
        },
        PangenomeGenomeInput {
            id: "g2".into(),
            name: "Isolate_BL21".into(),
            sequence: format!("{}{}{}", core_backbone, shared_shell, acc_b),
        },
        PangenomeGenomeInput {
            id: "g3".into(),
            name: "Isolate_Nissle".into(),
            sequence: format!("{}{}", core_backbone, acc_c),
        },
    ];

    let pan = profile_pangenome_core_accessory(&genomes, 13, 4);
    assert_eq!(pan.genome_count, 3);
    assert!(pan.core_loci > 1_000);
    assert!(pan.soft_core_shell_loci > 200);
    assert!(pan.cloud_strain_specific_loci > 600);
    assert!(pan.heaps_law_gamma > 0.05);
    assert_eq!(pan.accumulation_curve.len(), 3);
    assert!(
        pan.accumulation_curve[2].cumulative_pan_loci
            > pan.accumulation_curve[0].cumulative_pan_loci
    );
}

#[test]
fn blast_synteny_ngs_trimming_reference_mapping_and_taxonomy_work() {
    let subj = generate_reference_chromosome(6_000, 8888);
    let query = &subj[2_200..2_650];

    let blast_hits = run_local_blast_search(
        query,
        &[BlastSubjectDoc {
            id: "s1".into(),
            name: "Subject_Chr".into(),
            accession: "NC_TEST_01".into(),
            description: "Synthetic test chromosome".into(),
            sequence: subj.clone(),
            organism: String::new(),
        }],
        "blastn",
        "Local Project Sequences",
    );
    assert!(!blast_hits.is_empty());
    assert!(blast_hits[0].identity_pct >= 99.0);
    // Karlin-Altschul: a 450-bp exact match scores 900 raw -> ~564 bits, E effectively 0.
    assert!(blast_hits[0].bit_score > 500.0);
    assert_eq!(blast_hits[0].organism, "-");
    // A random 450-mer with no homology is not reported (E > 10), and no score floor applies.
    let unrelated = generate_reference_chromosome(450, 4242);
    let none = run_local_blast_search(&unrelated, &[BlastSubjectDoc {
        id: "s1".into(), name: "Subject_Chr".into(), accession: String::new(),
        description: String::new(), sequence: subj.clone(), organism: String::new(),
    }], "blastn", "Local");
    assert!(none.iter().all(|h| h.e_value.parse::<f64>().map(|e| e <= 10.0).unwrap_or(true)));

    let synteny = run_whole_genome_synteny(&subj, &subj, "Mauve-LCB");
    assert!(!synteny.blocks.is_empty());

    let dot = compute_dotplot_hits(query, query, 11, 10);
    assert!(!dot.is_empty());

    // BBDuk adapter trimming + NGS reference mapping
    let raw_read_with_adapter =
        format!("{}AGATCGGAAGAGCACACGTCTGAACTCCAGTCAC", &subj[1_000..1_150]);
    let trimmed = run_bbduk_read_trimming(
        &raw_read_with_adapter,
        None,
        &ReadTrimOptions {
            kmer_len: Some(11),
            min_phred_quality: Some(20),
            trim_adapters: Some(true),
            trim_low_complexity_ends: Some(true),
        },
    );
    assert!(trimmed.trimmed_length_bp >= 145);
    assert!(!trimmed.adapter_matches.is_empty());

    let ngs = run_ngs_reference_mapping(&subj, &trimmed.trimmed_sequence, "Minimap2");
    assert!(ngs.mapped_read_bases >= 140);

    // Semi-global Gotoh alignment & PAM250 protein alignment
    let semi = align_pairwise_gotoh(
        &subj[500..700],
        &subj[560..640],
        PairwiseMode::Semiglobal,
        None,
        2,
        -2,
        -5,
        -1,
        500,
    );
    assert_eq!(semi.matches, 80);
    assert_eq!(semi.mismatches, 0);

    let pam = align_pairwise_gotoh(
        "MVSKGEELFTGVVPILVELDGDVNGHKFSV",
        "MVSKGEELFTGIVPILVELDGDVNGHKFSV",
        PairwiseMode::Local,
        Some(ScoringMatrixKind::Pam250),
        0,
        0,
        -10,
        -1,
        500,
    );
    assert!(pam.score > 100);

    let tax = classify_sequence_taxonomy(&subj);
    assert!(!tax.is_empty());
}
