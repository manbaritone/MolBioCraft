// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

mod fold_params;
mod fold_params_h;
pub mod nn_fold;
pub mod action_vectors_data;
pub mod batch_ops;
pub mod bio_pipelines;
pub mod cloning_crispr;
pub mod cloning_sim;
pub use cloning_sim::simulate_molecular_cloning;
pub mod modular_parts_data;
pub mod plasmid_features;
pub mod reaction_buffers;
pub mod rebase_catalog;
pub mod sample_alignments_data;
pub mod sample_genomes_data;
pub mod sample_library_data;
pub mod sample_structures;
pub mod systems_strains_data;
pub mod thermodynamics;
pub mod vector_architect;
pub mod vector_catalog_data;
pub mod workbench_table_and_lineage;

pub use workbench_table_and_lineage::{
    build_construct_lineage_dag_rust, compute_document_table_metrics_rust,
    export_table_delimited_csv_rust, extract_region_with_annotations_rust,
    get_builtin_workflow_macros_rust, infer_document_icon_kind_rust, infer_document_type_label_rust,
    splice_modular_part_into_document_rust, BuiltinWorkflowMacroDef, ComputedDocumentRowMetricsRust,
    ConstructLineageDagReport, LineageDagEdgeView, LineageDagNodeView,
};

pub use action_vectors_data::{get_cloning_action_vector_presets, CloningActionVectorPreset};
pub use bio_pipelines::{
    execute_bio_pipeline_rust, get_bio_pipeline_catalog, BioPipelineExecutionReport,
    BioPipelineStepResult, PipelineDefinition, PipelineHighlightRange, PipelineMetricKV,
    PipelineSequenceArtifact, PipelineVisualZone,
};
pub use reaction_buffers::{
    analyze_gibson_overlap_junction, evaluate_golden_gate_overhang_fidelity,
    evaluate_multi_digest_buffer_plan, execute_builtin_rust_workflow_macro,
    EnzymeBufferActivityRow, GibsonJunctionThermodynamics, GoldenGateFidelityReport,
    GoldenGateOverhangPairRisk, MultiDigestBufferPlan,
};
pub use batch_ops::{
    add_attb_sites_to_sequence, annotate_gateway_att_sites, batch_modify_annotation_intervals,
    batch_set_cds_translation_property, concatenate_sequence_documents,
    convert_selection_to_oligo_primer, export_lineage_bundle_genbank,
    extract_annotated_features_to_documents, generate_consensus_document,
    group_documents_by_prefix, mask_sequence_regions, randomly_sample_documents, MAX_MASK_RUN_FEATURES, AnnotateAttResult,
    ConvertOligoResult, GroupByPrefixResult, LineageBundleGenBankResult, MaskSequenceResult,
    SelectionRange1Based,
};
pub use cloning_crispr::{
    audit_sequence_alerts, find_crispr_guides, set_circular_origin,
    CloningOutcome, CrisprGuideRecord, SequenceAlertItem,
};
pub use modular_parts_data::{get_modular_vector_parts, ModularVectorPart};
pub use plasmid_features::{
    detect_common_features, get_common_plasmid_features, CommonFeatureTemplate,
};
pub use rebase_catalog::{
    analyze_silent_mutations, analyze_silent_mutations_in_cds, compute_agarose_gel_band_physics,
    find_non_cutting_enzymes, find_non_cutting_enzymes_for_topology, CodingRegion1Based,
    find_restriction_cut_sites, get_rebase_enzymes, simulate_restriction_digest,
    AgaroseGelBandPhysics, DigestFragment, SilentMutationCandidate,
};
pub use sample_library_data::{
    generate_large_genome_benchmark, generate_large_protein_benchmark, get_sample_library,
};
pub use systems_strains_data::{
    get_host_strain_guides, get_origin_compatibility_groups, get_twist_antibiotic_standards,
    get_vector_system_guides, HostStrainGuide, OriginCompatibilityGroup, TwistAntibioticStandard,
    VectorSystemGuide,
};
pub use thermodynamics::{
    anneal_complementary_oligos, calculate_primer_metrics,
    calculate_primer_thermodynamics_santalucia, compute_dna_and_ligation_calculations,
    design_pcr_primers, design_pcr_primers_with_slack, predict_secondary_structure, predict_secondary_structure_with,
    simulate_site_directed_mutagenesis,
    test_saved_primers_on_sequence, AnnealedOligoResult, DnaLigationCalculations,
    LigationRatioRow, MutagenesisSimulationResult, PcrPrimerDesignResult, PrimerMetricsReport,
    SavedPrimerBindingHit, SecondaryStructureReport, SecondaryStructureStemLoop,
};
pub use vector_architect::{
    assemble_modular_custom_vector, audit_twist_custom_vector_onboarding,
    build_catalog_vector_document, build_cloning_action_vector_document, build_mcs_polylinker,
    check_cotransformation_compatibility, export_vector_catalog_csv, generate_catalog_circular_svg,
    generate_safe_backbone_spacer, simulate_twist_clonal_gene_insertion,
    CoTransformationCompatibility, ModularAssemblyResult, ModularAssemblySpec,
    TwistOnboardingCheckItem, TwistOnboardingReport,
};
pub use vector_catalog_data::{get_vector_catalog, CatalogVectorEntry};

#[cfg(test)]
mod tests {
    use super::*;
    use molbiocraft_core::Topology;

    #[test]
    fn rebase_catalog_digest_and_silent_mutations_work() {
        let enzymes = get_rebase_enzymes();
        assert!(enzymes.len() >= 120);
        assert_eq!(enzymes[0].name, "EcoRI");

        let sample_docs = get_sample_library();
        assert!(sample_docs.len() >= 20);
        let pet28 = &sample_docs[0];
        let cuts = find_restriction_cut_sites(&pet28.sequence, pet28.topology, None);
        assert!(!cuts.is_empty());

        let frags =
            simulate_restriction_digest(pet28, &["EcoRI".to_string(), "BamHI".to_string()]);
        assert!(!frags.is_empty());

        let silent = analyze_silent_mutations("ATGGTGAGCAAGGGCGAGGAGCTGTTCACC", 1);
        assert!(!silent.is_empty());
    }

    #[test]
    fn thermodynamics_pcr_zuker_nussinov_and_crispr_work() {
        let pm = calculate_primer_metrics("ATGGTGAGCAAGGGCGAGGAG", 50.0, 1.5, 250.0);
        assert!(pm.tm_c > 52.0 && pm.tm_c < 75.0);
        assert!(pm.gc_clamp3_prime);

        let sample_docs = get_sample_library();
        let pet28 = &sample_docs[0];
        let pcr = design_pcr_primers(pet28, 100, 600, 60.0, "GAATTC", "GGATCC");
        assert!(pcr.amplicon_length > 500);
        assert_eq!(pcr.forward.strand, 1);
        assert_eq!(pcr.reverse.strand, -1);

        // Authentic hairpin stem-loop: GGGAAACCC + GCGCAAGGC -> negative MFE and balanced dot-bracket!
        let mfe = predict_secondary_structure("GCGCGCGAAACGCGCGCATGCGAAAGCATG", "RNA");
        assert_eq!(mfe.dot_bracket.len(), 30);
        assert!(mfe.paired_bases_count >= 8);
        assert!(mfe.minimum_free_energy_kcal_mol < -2.0);

        let guides = find_crispr_guides(&pet28.sequence, "SpCas9 (NGG)", 15);
        assert!(!guides.is_empty());
        assert!(guides.iter().all(|g| g.on_target_score > 0));
    }

    #[test]
    fn vector_catalog_modular_architect_cloning_and_large_benchmarks_work() {
        let catalog = get_vector_catalog();
        assert_eq!(catalog.len(), 69);
        let vec_doc = build_catalog_vector_document(&catalog[0]);
        assert_eq!(vec_doc.topology, Topology::Circular);
        assert!(vec_doc.sequence.len() >= 2000);

        let report = audit_twist_custom_vector_onboarding(&vec_doc, 100, 120.0, 150.0);
        assert_eq!(report.checks.len(), 9);

        let gibson = simulate_molecular_cloning(
            &vec_doc,
            &sample_docs_insert(),
            "gibson",
            "EcoRI",
            "BamHI",
            "BsaI",
        );
        assert!(gibson.construct_document.sequence.len() > vec_doc.sequence.len());

        let chr = generate_large_genome_benchmark(200_000, "Escherichia coli K-12");
        assert_eq!(chr.sequence.len(), 200_000);
        assert!(chr.features.len() > 80);

        let titin = generate_large_protein_benchmark(8_000, "Titin_Ig_Polyprotein");
        assert_eq!(titin.sequence.len(), 8_000);
        assert!(titin.features.len() > 40);
    }

    fn sample_docs_insert() -> molbiocraft_core::SequenceDocument {
        let docs = get_sample_library();
        docs.into_iter()
            .find(|d| d.topology == Topology::Linear)
            .unwrap()
    }
}
