// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod aa_models;
pub mod coalescent_recombination;
pub mod distances;
#[cfg(not(target_arch = "wasm32"))]
pub mod external;
pub mod likelihood;
pub mod ml_search;
pub mod models_selection;
pub mod newick_layout;
pub mod protein_ml;
pub mod trees;

pub use newick_layout::{
    layout_newick_phylogenetic_tree, NewickLayoutNode, NewickScaleBar, NewickSvgBranchPath,
    NewickTreeLayoutReport,
};

pub use coalescent_recombination::{
    analyze_recombination_and_ld, compare_tree_topologies_robinson_foulds,
    run_mcdonald_kreitman_test, LinkageDisequilibriumPair, McDonaldKreitmanReport,
    RecombinationAndLdReport, RecombinationInterval, RobinsonFouldsReport,
};
pub use distances::{
    calc_pair_distance_and_se, codon_site_degeneracy, compute_evolutionary_distances,
    compute_nucleotide_composition_by_codon_pos, compute_population_diversity,
    compute_relative_synonymous_codon_usage, compute_substitution_rate_matrix,
    explore_active_alignment_data, translate_standard_codon, ActiveDataExplorationReport,
    BetweenGroupMeanRow, CodonUsageRow, DisparityPairRecord, DistanceAnalysisReport,
    DiversityAnalysisReport, NucleotideCompositionRow, RateMatrixRow4x4,
    SubstitutionRateMatrixReport, WithinGroupMeanRow, STANDARD_CODONS,
};
pub use models_selection::{
    diagnose_missense_mutation, estimate_gamma_and_site_rates, find_best_substitution_models,
    infer_ancestral_sequences, run_molecular_clock_and_timetree,
    run_selection_and_neutrality_tests, AncestralNodeRow, AncestralReconstructionReport,
    ClockTestMlSummary, CodonSiteSelectionRow, CorrTestSummary, DivergenceNodeRow,
    GammaCategoryRate, ModelSelectionRankingRow, MolecularClockAndTimetreeReport,
    MutationDiagnosisResult, SelectionAndNeutralityReport, SiteEvolutionaryProbability,
    SiteRateRow, SiteRatesReport, TajimaNeutralitySummary, TajimaRelativeRateSummary,
    ZTestOutcome,
};
pub use trees::{
    analyze_user_tree, construct_phylogenetic_tree, construct_phylogenetic_tree_with_resampling, CladeBootstrapRow, DuplicationNodeRecord,
    PhyloTreeInferenceReport, SiteCoverageBin, UserTreeAnalysisReport,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evolutionary_distances_phylo_trees_models_and_selection_work() {
        let names = vec![
            "eGFP_WT".to_string(),
            "EYFP_T203Y".to_string(),
            "ECFP_Y66W".to_string(),
            "BFP_Y66H".to_string(),
        ];
        let seqs = vec![
            "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC".to_string(),
            "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAT".to_string(),
            "ATGGTGAGCAAGGGCGAGGAGCTGTTTACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAT".to_string(),
            "ATGGTGAGCAAGGGCGAGGAGCTGTTTACCGGGGTAGTGCCCATCCTGGTCGAACTGGAT".to_string(),
        ];

        let data = explore_active_alignment_data(&seqs);
        assert_eq!(data.num_taxa, 4);
        assert_eq!(data.num_sites, 60);
        assert!(data.variable_sites >= 3);

        let models = find_best_substitution_models(&seqs);
        assert_eq!(models.len(), 24);
        assert!(models[0].bic <= models[23].bic);

        let dist = compute_evolutionary_distances(&names, &seqs, "Tamura-Nei (TN93)", &[]);
        assert!(dist.overall_mean_distance > 0.0);

        let tree = construct_phylogenetic_tree(
            &names,
            &seqs,
            "Maximum Likelihood (ML)",
            "Tamura-Nei (TN93)",
            200,
        );
        assert!(tree.newick.ends_with(';'));
        assert!(tree.log_likelihood < 0.0);
        assert_eq!(tree.clade_bootstraps.len(), 1); // one non-trivial split for 4 taxa

        let sel = run_selection_and_neutrality_tests(&seqs);
        // Every difference here is synonymous (GAC/GAT, TTC/TTT, GTG/GTA, GAG/GAA).
        assert!(sel.ds > 0.0);
        assert_eq!(sel.dn, 0.0);

        let rates = estimate_gamma_and_site_rates(&seqs, 5);
        assert_eq!(rates.category_rates.len(), 5);

        let clock = run_molecular_clock_and_timetree(&names, &seqs, "RelTime-ML", 45.0);
        assert_eq!(clock.calibration_age_mya, 45.0);

        let diag = diagnose_missense_mutation(66, "Y", "W", &[]);
        assert!(diag.grantham_distance > 0);
        assert_eq!(diag.blosum62_score, 2); // Exact Henikoff BLOSUM62(Y, W) == +2
    }
}
