// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-core`:
//! - Large-genome (500 kbp – 2 Mbp) `rust-bio` `IntervalTree`, `FMIndex`, SIMD `memchr`, and strided track downsampling
//! - Non-B DNA secondary structures (G-Quadruplex `G4Hunter`, i-Motif, alternating R-Y Z-DNA)
//! - Epigenetic methylation profiling (`Dam GATC`, `Dcm CCWGG`, `CpG O/E`, `EcoKI`)
//! - Prokaryotic $\sigma^{70}$ `-35`/`-10` PWM promoter & Rho-independent terminator scanning
//! - Karlin-Mrázek dinucleotide relative abundance ($\rho_{XY}^*$) & HGT pathogenicity island detection
//! - Canonical k-mer frequency spectrum & Trifonov linguistic complexity
//! - Cross-platform path validation (macOS NFC, Windows `\\?\` & reserved stems, Linux XDG/Flatpak).

use molbiocraft_core::{
    analyze_karlin_dinucleotide_islands, analyze_sequence_composition, clean_alpha_sequence,
    clean_sequence, complement_sequence, compute_batch_sequence_stats,
    compute_genome_track_overview, compute_kmer_spectrum, compute_sequence_stats, convert_dna_rna,
    find_cpg_islands, find_genomic_repeats, mutate_or_shuffle_sequence,
    profile_epigenetic_methylation_sites, query_features_in_viewport, reverse_complement,
    reverse_complement_iupac, reverse_only_sequence, scan_microsatellite_strs,
    scan_non_b_dna_structures, scan_rho_independent_terminators, scan_sigma70_promoters,
    search_genome_motif_fmindex, slice_genome_viewport, sanitize_workspace_path,
    BatchSequenceItem, BioEngineError, SequenceFeature,
};

fn build_synthetic_chromosome_with_island(total_bp: usize) -> (String, Vec<SequenceFeature>) {
    let mut seq = String::with_capacity(total_bp + 256);
    // Host background ~52% GC balanced bacterial chromosome
    let host_unit = "ATGCGATCGCTAGCTAGCATGCGTACGTAGCTGATCGCATGCTAGCGATCGTAGCTAGCTAGCG";
    // AT-rich (~25% GC) horizontally transferred pathogenicity island inserted at 120,000..136,000 bp
    let island_unit = "AATTATAATTAATATAATATTAATAAATATTAGCGTAATTATAATATTAATAATATTAATAATT";

    while seq.len() < total_bp {
        if seq.len() >= 120_000 && seq.len() < 136_000 {
            seq.push_str(island_unit);
        } else {
            seq.push_str(host_unit);
        }
    }
    seq.truncate(total_bp);

    let mut features = Vec::new();
    for idx in 0..120usize {
        let start = idx * 4_000 + 101;
        let end = (start + 1_199).min(total_bp);
        if start >= total_bp {
            break;
        }
        features.push(SequenceFeature {
            id: format!("feat-chr-{}", idx + 1),
            name: format!("orf_{:04}", idx + 1),
            feature_type: if idx % 5 == 0 {
                "promoter".into()
            } else {
                "CDS".into()
            },
            start,
            end,
            strand: if idx % 2 == 0 { 1 } else { -1 },
            color: "#2563eb".into(),
            notes: Some("Synthetic chromosome benchmark locus".into()),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
    }
    (seq, features)
}

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
fn iupac_cleaning_complement_rna_conversion_and_deterministic_shuffle() {
    let dirty = "  1 ATGC-rymkswbdhvn 99 \n\t uacg ";
    assert_eq!(clean_sequence(dirty), "ATGC-RYMKSWBDHVNUACG");
    assert_eq!(clean_alpha_sequence(dirty), "ATGCRYMKSWBDHVNUACG");

    // Verify full IUPAC degenerate complement involution: RC(RC(seq)) == seq
    let all_iupac = "ACGTMRWSYKVHDBN";
    let rc1 = reverse_complement_iupac(all_iupac, false);
    let rc2 = reverse_complement_iupac(&rc1, false);
    assert_eq!(rc2, all_iupac);

    let rna = convert_dna_rna("ATGGTGAGCAAG", true);
    assert_eq!(rna, "AUGGUGAGCAAG");
    let back_dna = convert_dna_rna(&rna, false);
    assert_eq!(back_dna, "ATGGTGAGCAAG");

    assert_eq!(complement_sequence("GAATTC", false), "CTTAAG");
    assert_eq!(reverse_only_sequence("GAATTC"), "CTTAAG");
    assert_eq!(reverse_complement("GAATTCATGGTG"), "CACCATGAATTC");

    // Deterministic SplitMix64 Fisher-Yates shuffle preserves exact mononucleotide composition
    let orig = "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC";
    let comp_orig = analyze_sequence_composition(orig);
    let shuf = mutate_or_shuffle_sequence(orig, "shuffle", 0.0, 20261031);
    let comp_shuf = analyze_sequence_composition(&shuf.output_sequence);
    assert_eq!(comp_orig.counts.a, comp_shuf.counts.a);
    assert_eq!(comp_orig.counts.c, comp_shuf.counts.c);
    assert_eq!(comp_orig.counts.g, comp_shuf.counts.g);
    assert_eq!(comp_orig.counts.t, comp_shuf.counts.t);
    assert_ne!(shuf.output_sequence, orig);

    // Point substitution mutation mode changes bases at controllable rate
    let mut_res = mutate_or_shuffle_sequence(orig, "substitute", 0.15, 42);
    assert_eq!(mut_res.output_sequence.len(), orig.len());
    assert!(mut_res.mutations_applied >= 1);
}

#[test]
fn large_500kbp_chromosome_viewport_interval_tree_fmindex_and_tracks() {
    let (chr_seq, features) = build_synthetic_chromosome_with_island(500_000);
    assert_eq!(chr_seq.len(), 500_000);
    assert!(features.len() >= 120);

    // 1. Bounded 1,200 bp viewport slice without full-chromosome complement allocation
    let slice = slice_genome_viewport(&chr_seq, &features, 4_001, 5_200, false, false);
    assert_eq!(slice.total_length, 500_000);
    assert_eq!(slice.start_pos, 4_001);
    assert_eq!(slice.end_pos, 5_200);
    assert_eq!(slice.top_strand.len(), 1_200);
    assert_eq!(slice.bottom_strand.len(), 1_200);
    assert!(!slice.overlapping_feature_indices.is_empty());

    // The slice carries the window's own bases. Oracles independent of slice_genome_viewport:
    // - the 1-based inclusive window 4001..=5200 is the 0-based half-open chr_seq[4_000..5_200];
    // - its first and last 64 bases, and their complements, as Python 3 + Biopython 1.85 give them
    //   for the same construction (64 bp host unit repeated, island at 120,000..136,000, cut to
    //   500,000 bp; top = seq[4000:5200], bottom = str(Bio.Seq.Seq(top).complement())). The window
    //   starts 32 bases into the host unit, so a window shifted by one base differs at its first base;
    // - the bottom strand is the base-for-base complement, unreversed, by the hand table below.
    const TOP_HEAD: &str = "GATCGCATGCTAGCGATCGTAGCTAGCTAGCGATGCGATCGCTAGCTAGCATGCGTACGTAGCT";
    const TOP_TAIL: &str = "GCATGCGTACGTAGCTGATCGCATGCTAGCGATCGTAGCTAGCTAGCGATGCGATCGCTAGCTA";
    const BOTTOM_HEAD: &str = "CTAGCGTACGATCGCTAGCATCGATCGATCGCTACGCTAGCGATCGATCGTACGCATGCATCGA";
    const BOTTOM_TAIL: &str = "CGTACGCATGCATCGACTAGCGTACGATCGCTAGCATCGATCGATCGCTACGCTAGCGATCGAT";
    assert_eq!(slice.top_strand, chr_seq[4_000..5_200]);
    assert_eq!(&slice.top_strand[..64], TOP_HEAD);
    assert_eq!(&slice.top_strand[1_136..], TOP_TAIL);
    assert_eq!(slice.bottom_strand, hand_complement_dna(&chr_seq[4_000..5_200]));
    assert_eq!(&slice.bottom_strand[..64], BOTTOM_HEAD);
    assert_eq!(&slice.bottom_strand[1_136..], BOTTOM_TAIL);

    // Direct IntervalTree query agrees with viewport slice feature indices
    let direct_hits = query_features_in_viewport(&features, 4_001, 5_200);
    assert_eq!(direct_hits, slice.overlapping_feature_indices);

    // 2. Multi-resolution track overview detects GC% dip across the 120..136 kbp AT-rich island
    let overview = compute_genome_track_overview(&chr_seq, 200);
    assert_eq!(overview.sequence_length_bp, 500_000);
    assert_eq!(overview.bin_count, 200);
    assert!(overview.mean_gc_percent > 45.0 && overview.mean_gc_percent < 56.0);
    let min_gc_bin = overview
        .gc_fraction_bins
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    assert!(
        min_gc_bin < 0.30,
        "Expected AT-rich island bin < 30% GC, got {}",
        min_gc_bin
    );

    // 3. FM-Index (<= 262 kbp) and SIMD memmem (> 262 kbp) return identical motif coordinates
    let sub_200k = &chr_seq[..200_000];
    let fm_hits = search_genome_motif_fmindex(sub_200k, "GCGTACGTAG", true, 50);
    assert!(!fm_hits.is_empty());
    for h in &fm_hits {
        assert_eq!(h.end - h.start + 1, 10);
    }

    let simd_hits = search_genome_motif_fmindex(&chr_seq, "GCGTACGTAG", true, 50);
    assert_eq!(simd_hits.len(), 50);
    assert_eq!(simd_hits[0].start, fm_hits[0].start);
}

#[test]
fn non_b_dna_g4_quadruplex_imotif_and_zdna_detection() {
    // Embed canonical human telomeric G-quadruplex (TTAGGG)4, C-rich i-Motif (CCCTAA)4, and (CGCG)5 Z-DNA
    let locus = format!(
        "AAATGC{}ATCGTAGC{}TTAGCG{}AAACCC",
        "GGGTTAGGGTTAGGGTTAGGG",
        "CCCTAACCCTAACCCTAACCC",
        "CGCGCGCGCGCGCGCGCGCG"
    );
    let hits = scan_non_b_dna_structures(&locus, 50);
    assert!(
        hits.iter().any(|h| h.motif_class == "G-Quadruplex" && h.strand == 1),
        "Expected + strand G-Quadruplex hit in {:?}",
        hits
    );
    assert!(
        hits.iter()
            .any(|h| h.motif_class.contains("i-Motif") && h.strand == -1),
        "Expected i-Motif / antisense G4 hit in {:?}",
        hits
    );
    assert!(
        hits.iter().any(|h| h.motif_class == "Z-DNA" && h.length_bp >= 18),
        "Expected Z-DNA alternating CpG tract hit in {:?}",
        hits
    );
}

#[test]
fn epigenetic_methylation_sigma70_promoters_and_intrinsic_terminators() {
    // Construct synthetic bacterial operon with Dam (GATC), Dcm (CCAGG & CCTGG), EcoKI (AACNNNNNNGTGC),
    // strong consensus TTGACA-(17bp)-TGn-TATAAT sigma70 promoter, and GC-rich stem-loop + TTTTTTT terminator
    let operon = concat!(
        "AAAGGATCCCAGGTTCCTGGAACATGCTAGTGCAAA",
        "TTGACACTGACGGAGCTGAGTGGTATAATGGGAGACCACAACGGTTTCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACAT",
        "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTAA",
        "AAAGGGCCCGCGCAAAAAGCGCGGGCCCTTTTTTTATA"
    );

    let meth = profile_epigenetic_methylation_sites(operon);
    assert!(meth.dam_gatc_sites >= 1);
    assert!(meth.dcm_ccwgg_sites >= 2);
    assert!(meth.ecoki_type_i_sites >= 1);
    assert!(meth.cpg_dinucleotides >= 5);

    let promoters = scan_sigma70_promoters(operon, 10);
    assert!(
        !promoters.is_empty(),
        "Expected strong sigma70 TTGACA..TATAAT promoter hit"
    );
    let top_p = &promoters[0];
    assert_eq!(top_p.minus35_hexamer, "TTGACA");
    assert_eq!(top_p.minus10_hexamer, "TATAAT");
    assert_eq!(top_p.spacer_bp, 17);
    assert!(top_p.has_extended_tg_minus10);
    assert!(top_p.pwm_log_odds_score > 14.0);

    let terms = scan_rho_independent_terminators(operon, 10);
    assert!(
        !terms.is_empty(),
        "Expected strong Rho-independent GC hairpin + poly-U terminator"
    );
    assert!(terms[0].estimated_delta_g_kcal <= -12.0);
    assert!(terms[0].poly_u_tail.contains("UUUUU"));
}

#[test]
fn karlin_dinucleotide_islands_cpg_strs_repeats_and_kmer_spectrum() {
    let (chr_seq, _) = build_synthetic_chromosome_with_island(180_000);
    let karlin = analyze_karlin_dinucleotide_islands(&chr_seq, 4_000);
    assert_eq!(karlin.rho_star_16.len(), 16);
    assert!(
        karlin.anomalous_island_count >= 2,
        "Expected HGT pathogenicity island windows at 120..136 kbp, got {}",
        karlin.anomalous_island_count
    );

    let spec = compute_kmer_spectrum(&chr_seq[..20_000], 6);
    assert_eq!(spec.k, 6);
    assert!(spec.total_kmers > 19_900);
    assert!(!spec.top_enriched_kmers.is_empty());

    // CpG island + STR microsatellite + palindromic repeat scanners
    let cpg_locus = format!(
        "{}{}{}",
        "ATATATATATATATATATATATATATAT",
        "CGCGCGCGCGGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCG",
        "AACACACACACACACACACACACACATGGAATTCATGGTGAGCAAGCACCATGAATTCTT"
    );
    let islands = find_cpg_islands(&cpg_locus, 150, 50.0, 0.60);
    assert!(!islands.is_empty());
    assert!(islands[0].obs_exp_cpg >= 0.65);

    let strs = scan_microsatellite_strs(&cpg_locus, 2, 6);
    assert!(strs.iter().any(|s| s.repeat_units >= 8));

    let reps = find_genomic_repeats(&cpg_locus, 10, 50);
    assert!(!reps.is_empty());
}

#[test]
fn batch_sequence_stats_and_cross_platform_path_guards() {
    let stats = compute_sequence_stats("ATGGTGAGCAAGGGCGAGGAGCTGTTCACC");
    assert_eq!(stats.length, 30);
    assert!(stats.gc_percent > 55.0);
    assert!(stats.mw_dsdna_da > 18_000.0);

    let batch = compute_batch_sequence_stats(&[
        BatchSequenceItem {
            id: "b1".into(),
            name: "Seq1".into(),
            sequence: "GAATTCATGGTG".into(),
        },
        BatchSequenceItem {
            id: "b2".into(),
            name: "Seq2".into(),
            sequence: "GGATCCATGGTG".into(),
        },
    ])
    .unwrap();
    assert_eq!(batch.len(), 2);
    assert_eq!(batch[0].stats.length, 12);

    // Windows reserved device name must be rejected across OS portability checks
    let reserved = sanitize_workspace_path("CON.fasta");
    assert!(matches!(
        reserved,
        Err(BioEngineError::WindowsReservedDeviceName(_))
    ));
}
