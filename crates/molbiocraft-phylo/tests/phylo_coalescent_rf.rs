// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-phylo`:
//! - Hudson & Kaplan (1985) Four-Gamete Test & minimum recombination events ($R_m$)
//! - Pairwise Linkage Disequilibrium ($D, |D'|, r^2, \chi^2$ p-value)
//! - Fu & Li's $D^* / F^*$, Fay & Wu's $H$, Haplotype Diversity ($H_d$), Watterson's $\theta_W$, and $\pi$
//! - McDonald-Kreitman ($MK$) $2 \times 2$ Neutrality Index ($\text{NI}$), Direction of Selection ($\text{DoS}$), and $\alpha$
//! - `petgraph` Robinson-Foulds ($RF$) symmetric clade topology distance & normalized $nRF$
//! - Ancestral sequence reconstruction, RSCU, user-tree inspection, and molecular clock timetree.

use molbiocraft_phylo::{
    analyze_recombination_and_ld, analyze_user_tree, compare_tree_topologies_robinson_foulds,
    compute_nucleotide_composition_by_codon_pos, compute_population_diversity,
    compute_relative_synonymous_codon_usage, compute_substitution_rate_matrix,
    infer_ancestral_sequences, run_mcdonald_kreitman_test,
};

#[test]
fn hudson_kaplan_four_gamete_rm_linkage_disequilibrium_and_fu_li_neutrality() {
    // Construct 8 haplotypes where SNP pair (pos 4 vs pos 16) exhibits all 4 gametes (AA, AG, GA, GG)
    // AND disjoint SNP pair (pos 28 vs pos 40) also exhibits all 4 gametes -> exact R_m >= 2!
    let haplotypes = vec![
        "ATGAACCCCCCCCCCACCCCCCCCCCCACCCCCCCCCCCACC".to_string(), // 0,0 | 0,0
        "ATGAACCCCCCCCCCACCCCCCCCCCCACCCCCCCCCCCGCC".to_string(), // 0,0 | 0,1
        "ATGAACCCCCCCCCCGCCCCCCCCCCCGCCCCCCCCCCCACC".to_string(), // 0,1 | 1,0
        "ATGAACCCCCCCCCCGCCCCCCCCCCCGCCCCCCCCCCCGCC".to_string(), // 0,1 | 1,1
        "ATGGACCCCCCCCCCACCCCCCCCCCCACCCCCCCCCCCACC".to_string(), // 1,0 | 0,0
        "ATGGACCCCCCCCCCACCCCCCCCCCCACCCCCCCCCCCGCC".to_string(), // 1,0 | 0,1
        "ATGGACCCCCCCCCCGCCCCCCCCCCCGCCCCCCCCCCCACC".to_string(), // 1,1 | 1,0
        "ATGGACCCCCCCCCCGCCCCCCCCCCCTCCCCCCCCCCCGCC".to_string(), // 1,1 + singleton T
    ];

    let rep = analyze_recombination_and_ld(&haplotypes);
    assert_eq!(rep.num_sequences, 8);
    assert!(rep.segregating_sites_s >= 4);
    assert!(rep.distinct_haplotypes >= 7);
    assert!(rep.haplotype_diversity_hd > 0.90);
    assert!(
        rep.four_gamete_incompatible_pairs >= 2,
        "Expected >= 2 four-gamete violations, got {}",
        rep.four_gamete_incompatible_pairs
    );
    assert!(
        rep.minimum_recombination_events_rm >= 2,
        "Expected Hudson-Kaplan R_m >= 2 disjoint recombination intervals, got {}",
        rep.minimum_recombination_events_rm
    );
    assert!(!rep.ld_pairs.is_empty());
    for pair in &rep.ld_pairs {
        assert!((0.0..=1.0).contains(&pair.r_squared));
        assert!((0.0..=1.0).contains(&pair.d_prime_abs));
    }
}

#[test]
fn mcdonald_kreitman_detects_adaptive_nonsynonymous_divergence() {
    // 10-codon ingroup (4 sequences) with 3 synonymous polymorphisms (Ps = 3, Pn = 0)
    // Outgroup differs by 5 fixed nonsynonymous substitutions and 1 fixed synonymous substitution (Dn = 5, Ds = 1)
    // => Strong positive Darwinian selection (DoS > 0, NI < 1, alpha > 0)!
    let ingroup = vec![
        "ATGGTGAGCAAGGGCGAGGAGCTGTTCACC".to_string(),
        "ATGGTAAGCAAGGGCGAGGAGCTGTTCACC".to_string(), // GTG->GTA (Val->Val, Ps #1)
        "ATGGTGAGTAAGGGCGAGGAGCTGTTTACC".to_string(), // AGC->AGT (Ser->Ser, Ps #2), TTC->TTT (Phe->Phe, Ps #3)
        "ATGGTAAGTAAGGGCGAGGAGCTGTTTACC".to_string(),
    ];
    // Outgroup has fixed missense codons at codons 4 (AAA->Gln CAA), 5 (GGC->Asp GAC), 6 (GAG->Lys AAG),
    // 7 (GAG->Ala GCG), 8 (CTG->Phe TTG->Phe!), 10 (ACC->Arg CGC) + 1 synonymous at codon 1
    let outgroup = "ATG---".replace(
        "---",
        "GTGAGCCAAGACAAGGCGATGTTCCGC", // Q(4), D(5), K(6), A(7), M(8), R(10) = 6 fixed Dn!
    );

    let mk = run_mcdonald_kreitman_test(&ingroup, &outgroup);
    assert_eq!(mk.ingroup_count, 4);
    assert_eq!(mk.codons_analyzed, 10);
    assert_eq!(mk.polymorphic_synonymous_ps, 3);
    assert_eq!(mk.polymorphic_nonsynonymous_pn, 0);
    assert!(mk.fixed_nonsynonymous_dn >= 5);
    assert!(mk.neutrality_index_ni < 0.35);
    assert!(mk.alpha_adaptive_fraction > 0.65);
    assert!(mk.direction_of_selection_dos > 0.50);
}

#[test]
fn robinson_foulds_petgraph_clade_bipartition_distance_is_exact() {
    // Identical unrooted topologies with different rootings & branch lengths -> RF = 0, nRF = 0.0!
    let tree_1 = "((TaxonA:0.12,TaxonB:0.15)98:0.08,(TaxonC:0.21,(TaxonD:0.05,TaxonE:0.07)95:0.11):0.09);";
    let tree_1_rerooted = "(TaxonA:0.06,TaxonB:0.15,((TaxonD:0.05,TaxonE:0.07):0.11,TaxonC:0.21):0.17);";

    let rf_same = compare_tree_topologies_robinson_foulds(tree_1, tree_1_rerooted);
    assert_eq!(rf_same.shared_taxa_count, 5);
    assert_eq!(rf_same.robinson_foulds_distance, 0);
    assert_eq!(rf_same.normalized_rf, 0.0);
    assert_eq!(rf_same.clade_concordance_pct, 100.0);

    // Swap TaxonB with TaxonD -> destroys both non-trivial splits {A,B} and {D,E} -> RF = 4, nRF = 1.0!
    let tree_2 = "((TaxonA:0.1,TaxonD:0.1):0.1,(TaxonC:0.2,(TaxonB:0.1,TaxonE:0.1):0.1):0.1);";
    let rf_diff = compare_tree_topologies_robinson_foulds(tree_1, tree_2);
    assert_eq!(rf_diff.shared_taxa_count, 5);
    assert_eq!(rf_diff.tree_a_nontrivial_splits, 2);
    assert_eq!(rf_diff.tree_b_nontrivial_splits, 2);
    assert_eq!(rf_diff.shared_splits, 0);
    assert_eq!(rf_diff.robinson_foulds_distance, 4);
    assert_eq!(rf_diff.normalized_rf, 1.0);
}

#[test]
fn rscu_codon_composition_rate_matrix_ancestors_and_user_tree_work() {
    let names = vec![
        "Alpha".to_string(),
        "Beta".to_string(),
        "Gamma".to_string(),
        "Delta".to_string(),
    ];
    let seqs = vec![
        "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC".to_string(),
        "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAT".to_string(),
        "ATGGTGAGCAAGGGCGAGGAGCTGTTTACCGGGGTGGTGCCCATCCTGGTCGAACTGGAT".to_string(),
        "ATGGTAAGCAAGGGCGAGGAGCTGTTTACCGGGGTAGTGCCCATCCTGGTCGAACTGGAT".to_string(),
    ];

    let comp = compute_nucleotide_composition_by_codon_pos(&names, &seqs);
    assert_eq!(comp.len(), 4);

    let rscu = compute_relative_synonymous_codon_usage(&seqs);
    assert_eq!(rscu.len(), 64);

    let rate_mat = compute_substitution_rate_matrix(&names, &seqs);
    assert!(rate_mat.overall_ti_tv_ratio_r > 0.2);

    let div = compute_population_diversity(&names, &seqs, "Tamura-Nei (TN93)", &[]);
    assert!(div.entire_population_pi_t > 0.0);

    let anc = infer_ancestral_sequences(&names, &seqs, "Maximum Likelihood (Empirical Bayes)");
    assert!(!anc.nodes.is_empty());

    let ut = analyze_user_tree(
        "((Alpha:0.02,Beta:0.03):0.04,(Gamma:0.05,Delta:0.06):0.04);",
        &names,
        &seqs,
    );
    assert!(ut.ml_log_likelihood < 0.0);
    assert!(!ut.newick.is_empty());
}

/// Codon counts keyed by codon, for the codons that occur.
fn rscu_counts(seqs: &[String]) -> std::collections::BTreeMap<String, usize> {
    compute_relative_synonymous_codon_usage(seqs)
        .into_iter()
        .filter(|r| r.count > 0)
        .map(|r| (r.codon, r.count))
        .collect()
}

#[test]
fn rscu_reads_codons_by_alignment_column() {
    // Four 5-codon CDSs, each with one base before the frame, as translationAlign lays them out
    // in frame 2: a lead slot "--X", the five codons, and a trail slot (two rows carry two bases
    // past the last codon). Reading the bases with the gaps removed shifts every codon and also
    // counts lead+trail as a sixth codon: 22 codons instead of 20.
    let bodies = ["ATGAAACCCGGGTTT", "ATGAAGCCAGGGTTC", "ATGAAACCCGGATTT", "ATGCAACCCGGGTAT"];
    let leads = ["C", "T", "G", "A"];
    let trails = ["GC-", "---", "TA-", "---"];
    let frame2: Vec<String> = (0..4).map(|i| format!("--{}{}{}", leads[i], bodies[i], trails[i])).collect();
    let frame1: Vec<String> = bodies.iter().map(|b| b.to_string()).collect();

    let counts = rscu_counts(&frame2);
    assert_eq!(counts.values().sum::<usize>(), 20);
    assert_eq!(counts, rscu_counts(&frame1));
    assert_eq!(counts.get("ATG"), Some(&4));
    assert_eq!(counts.get("CCC"), Some(&3));
    // RSCU and per-thousand follow the counts: Pro is 3 CCC + 1 CCA over its 4 synonyms.
    let rows = compute_relative_synonymous_codon_usage(&frame2);
    let ccc = rows.iter().find(|r| r.codon == "CCC").unwrap();
    assert_eq!(ccc.rscu, 3.0);
    assert_eq!(ccc.frequency_per_thousand, 150.0);
}

#[test]
fn rscu_counts_no_codon_in_a_gapped_slot() {
    // Seven 3-column slots: a lead slot, five codon slots and a trail slot. A slot counts a codon
    // for a row only when all three of its columns hold a base; a gap or an ambiguity code in a
    // slot drops that one codon without shifting the codons after it.
    let seqs = vec![
        "--CATGAAA---CCCGGGTA-".to_string(), // whole-codon gap; lead and trail bases
        "---ATGA-ATTTCCCGGG---".to_string(), // gap inside a codon slot
        "-TCATGAANTTTCCCgggA--".to_string(), // ambiguity code in a slot; lower case
        "---AUGAAAUUUCCCGGG---".to_string(), // RNA
    ];
    let counts = rscu_counts(&seqs);
    let expected: std::collections::BTreeMap<String, usize> =
        [("ATG", 4), ("AAA", 2), ("TTT", 3), ("CCC", 4), ("GGG", 4)]
            .into_iter()
            .map(|(c, n)| (c.to_string(), n))
            .collect();
    assert_eq!(counts, expected);
}

#[test]
fn missense_reads_codons_by_alignment_column() {
    use molbiocraft_phylo::diagnose_missense_mutation;

    // Four 5-codon CDSs (M K P G F, M K P G F, M K P G F, M Q P G Y), each with one base before
    // the frame, as translationAlign lays them out in frame 2: a lead slot "--X", the five codon
    // slots, and a trail slot (two rows carry two bases past the last codon). Locating codon N by
    // counting sequence 1's non-gap characters from the row start instead reads codon 1 as "CAT"
    // (H, conservation 0) and every codon after it one base out of frame.
    let bodies = ["ATGAAACCCGGGTTT", "ATGAAGCCAGGGTTC", "ATGAAACCCGGATTT", "ATGCAACCCGGGTAT"];
    let leads = ["C", "T", "G", "A"];
    let trails = ["GC-", "---", "TA-", "---"];
    let frame2: Vec<String> = (0..4).map(|i| format!("--{}{}{}", leads[i], bodies[i], trails[i])).collect();
    let frame1: Vec<String> = bodies.iter().map(|b| b.to_string()).collect();

    // The note sequence 1's own residue earns when it is not the wild type, the conservation
    // score, the mutant frequency and the homolog count. Formatted, so a NaN compares equal.
    let readout = |pos: usize, wt: &str, seqs: &[String]| {
        let d = diagnose_missense_mutation(pos, wt, "V", seqs);
        let note = d.rationale.rfind("Sequence 1 has ").map(|i| d.rationale[i..].to_string());
        (
            note,
            format!("{:.4}", d.site_conservation_score),
            format!("{:.4}", d.evolutionary_probability_mutant),
            d.homologs_compared,
        )
    };

    // Sequence 1 is the wild type at every codon, so no note is raised and conservation is the
    // wild-type residue's frequency among the other three rows.
    for (pos, wt, conservation) in [
        (1, "M", "1.0000"),
        (2, "K", "0.6667"),
        (3, "P", "1.0000"),
        (4, "G", "1.0000"),
        (5, "F", "0.6667"),
    ] {
        let got = readout(pos, wt, &frame2);
        assert_eq!(got, readout(pos, wt, &frame1), "frame 2 differs from frame 1 at codon {pos}");
        assert_eq!(got, (None, conservation.to_string(), "0.0000".to_string(), 3), "codon {pos}");
    }

    // A wild type no row carries: the note names sequence 1's own residue, which pins the residue
    // read at each codon and not only its conservation score.
    for (pos, residue) in [(1, 'M'), (2, 'K'), (3, 'P'), (4, 'G'), (5, 'F')] {
        let got = readout(pos, "W", &frame2);
        assert_eq!(got, readout(pos, "W", &frame1), "frame 2 differs from frame 1 at codon {pos}");
        assert_eq!(got.0, Some(format!("Sequence 1 has {residue} (not W) at position {pos}.")), "codon {pos}");
        assert_eq!(got.1, "0.0000", "codon {pos}");
    }

    // Five codon slots either way: the lead and trail padding are not codon positions.
    for (frame, seqs) in [(2, &frame2), (1, &frame1)] {
        let d = diagnose_missense_mutation(6, "M", "V", seqs);
        assert!(d.rationale.contains("beyond sequence 1"), "frame {frame}: {}", d.rationale);
    }
}

#[test]
fn missense_reads_protein_residues_by_ungapped_position() {
    use molbiocraft_phylo::diagnose_missense_mutation;

    // Why this path differs from the nucleotide one above, and must keep differing. A nucleotide
    // alignment is read as codons by alignment column, because a gap there is frame padding and
    // the frame has to be anchored to the column grid. A protein alignment is read at sequence 1's
    // Nth *ungapped* residue, because a gap there is a deletion in that sequence: residue N of the
    // protein the user typed is its Nth residue however many deletions precede it. Reading this
    // path by alignment column - the defect fixed on the nucleotide path (BG-01M6XBAC,
    // BG-01M6XPNY) - renumbers every residue after a deletion, so do not "fix" the protein branch
    // of homolog_residues to match the nucleotide one. This fixture is the gapped protein
    // alignment that tells the two readings apart; every protein fixture before it was gap-free.
    //
    //   column  1 2 3 4 5 6 7 8 9 10
    //   seq 1   M K - Q W L Y P F H   <- a one-residue deletion, so 9 residues in 10 columns
    //   seq 2   M K T Q W L Y P F H
    //   seq 3   M K T Q W L Y P F N
    //   seq 4   M K T Q G L Y S F H
    //
    // Position 5 is sequence 1's fifth ungapped residue: L in column 6, carried by all three
    // homologs. By alignment column it would be W in column 5, carried by two of them - so the
    // residue's identity and its conservation both move when the reading does.
    let gapped: Vec<String> = ["MK-QWLYPFH", "MKTQWLYPFH", "MKTQWLYPFN", "MKTQGLYSFH"].iter().map(|s| s.to_string()).collect();
    // The same alignment with the deletion's column dropped. Sequence 1 is unchanged residue for
    // residue, so every readout must match: a deletion does not renumber sequence 1's residues.
    let degapped: Vec<String> = ["MKQWLYPFH", "MKQWLYPFH", "MKQWLYPFN", "MKQGLYSFH"].iter().map(|s| s.to_string()).collect();

    // The note sequence 1's own residue earns when it is not the wild type, the conservation
    // score, the mutant frequency and the homolog count. Formatted, so a NaN compares equal.
    let readout = |pos: usize, wt: &str, seqs: &[String]| {
        let d = diagnose_missense_mutation(pos, wt, "V", seqs);
        let note = d.rationale.rfind("Sequence 1 has ").map(|i| d.rationale[i..].to_string());
        (note, format!("{:.4}", d.site_conservation_score), format!("{:.4}", d.evolutionary_probability_mutant), d.homologs_compared)
    };

    // Sequence 1 is the wild type at every position, so no note is raised and conservation is the
    // wild-type residue's frequency among the other three rows.
    for (pos, wt, conservation) in [
        (1, "M", "1.0000"),
        (2, "K", "1.0000"),
        (3, "Q", "1.0000"),
        (4, "W", "0.6667"),
        (5, "L", "1.0000"),
        (6, "Y", "1.0000"),
        (7, "P", "0.6667"),
        (8, "F", "1.0000"),
        (9, "H", "0.6667"),
    ] {
        let got = readout(pos, wt, &gapped);
        assert_eq!(got, readout(pos, wt, &degapped), "the deletion renumbered sequence 1 at residue {pos}");
        assert_eq!(got, (None, conservation.to_string(), "0.0000".to_string(), 3), "residue {pos}");
    }

    // A wild type no row carries: the note names sequence 1's own residue, which pins the residue
    // read at each position and not only its conservation score.
    for (pos, residue) in [(1, 'M'), (2, 'K'), (3, 'Q'), (4, 'W'), (5, 'L'), (6, 'Y'), (7, 'P'), (8, 'F'), (9, 'H')] {
        let got = readout(pos, "C", &gapped);
        assert_eq!(got, readout(pos, "C", &degapped), "the deletion renumbered sequence 1 at residue {pos}");
        assert_eq!(got.0, Some(format!("Sequence 1 has {residue} (not C) at position {pos}.")), "residue {pos}");
    }

    // Nine residues either way: the deletion's column is not a residue position of sequence 1.
    for (label, seqs) in [("gapped", &gapped), ("degapped", &degapped)] {
        let d = diagnose_missense_mutation(10, "M", "V", seqs);
        assert!(d.rationale.contains("beyond sequence 1"), "{label}: {}", d.rationale);
    }
}

#[test]
fn missense_counts_an_ambiguous_codon_as_a_codon_position() {
    use molbiocraft_phylo::diagnose_missense_mutation;

    // A codon slot of sequence 1 is three non-gap columns, not three A/C/G/T columns. The two
    // guards look interchangeable and are not: an IUPAC ambiguity code (a mixed base call from
    // Sanger or population consensus data) is a codon the aligner laid down and a position the
    // user counts, it just cannot be translated. Requiring A/C/G/T there instead - the sibling
    // guard the RSCU counter uses, where an untranslatable codon genuinely is skipped - would
    // silently renumber every residue after the ambiguous codon.
    //
    //   codon      1    2    3    4    5
    //   seq 1     ATG  AAA  CRC  GGG  TTT   <- codon 3 is ambiguous: a position, but no residue
    //   seq 2     ATG  AAA  CCC  GGG  TTT
    //   seq 3     ATG  AAG  CCC  GGG  TTC
    //   seq 4     ATG  CAA  CCC  GGA  TAT
    //
    // So position 3 reports no residue, position 4 is G and position 5 is F. Skipping the
    // ambiguous slot would make position 3 report G (really codon 4), position 4 report F, and
    // position 5 fall beyond sequence 1 - the assertions below are taken after codon 3, where the
    // two guards disagree.
    let seqs: Vec<String> = ["ATGAAACRCGGGTTT", "ATGAAACCCGGGTTT", "ATGAAGCCCGGGTTC", "ATGCAACCCGGATAT"].iter().map(|s| s.to_string()).collect();

    let readout = |pos: usize, wt: &str| {
        let d = diagnose_missense_mutation(pos, wt, "V", &seqs);
        let note = d.rationale.rfind("Sequence 1 has ").map(|i| d.rationale[i..].to_string());
        (note, format!("{:.4}", d.site_conservation_score), d.homologs_compared)
    };

    for (pos, wt, conservation) in [(1, "M", "1.0000"), (2, "K", "0.6667"), (4, "G", "1.0000"), (5, "F", "0.6667")] {
        assert_eq!(readout(pos, wt), (None, conservation.to_string(), 3), "codon {pos}");
    }

    // A wild type no row carries, which pins the residue read at each codon by its identity.
    for (pos, residue) in [(1, 'M'), (2, 'K'), (4, 'G'), (5, 'F')] {
        assert_eq!(readout(pos, "W").0, Some(format!("Sequence 1 has {residue} (not W) at position {pos}.")), "codon {pos}");
    }

    // The ambiguous codon holds position 3: it reports no residue rather than handing position 3
    // to the codon after it.
    let ambiguous = diagnose_missense_mutation(3, "P", "V", &seqs);
    assert!(
        ambiguous.rationale.contains("Position 3 is beyond sequence 1 or not a complete codon/residue."),
        "position 3 is the ambiguous codon, so it has no residue: {}",
        ambiguous.rationale
    );
    assert_eq!(ambiguous.homologs_compared, 0, "no homolog residue is read at an ambiguous codon");

    // Five codon positions, the ambiguous one included.
    let beyond = diagnose_missense_mutation(6, "M", "V", &seqs);
    assert!(beyond.rationale.contains("beyond sequence 1"), "{}", beyond.rationale);
}
