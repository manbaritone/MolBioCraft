// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod aa_params;
pub mod backbone;
pub mod codon_usage;
pub mod biophysics_3d;
pub mod disorder_aggregation_epitopes;
pub mod genetic_codes;
pub mod motifs_domains;
pub mod proteomics_mass_spec;
pub mod structure_align;
pub mod translation_orf;

pub use backbone::{backbone_torsions, BackboneTorsionReport, RamachandranClass, RamachandranRegion, ResidueTorsions};
pub use biophysics_3d::{
    align_pdb_structures_kabsch, analyze_protein_sequence, kyte_doolittle,
    predict_coiled_coils_and_transmembrane, AntigenicDeterminant, CoiledCoilDomain, ContactPair3D,
    HydrophobicityPoint, PdbStructureAlignmentReport, PerResidueDeviation, ProteinAnalysisReport,
    ProteinTopologyAndCoilsReport, SecondaryStructureSummary, TransmembraneHelix,
};
pub use proteomics_mass_spec::{
    scan_post_translational_modifications, simulate_peptide_ms2_spectrum,
    simulate_proteolytic_digest_ms, DigestedPeptideIon, DisulfideBondPrediction,
    Ms2FragmentIonPeak, PeptideMs2SpectrumReport, PestDegradationSegment,
    ProteinPtmAndTopologyReport, ProteolyticDigestMsReport, PtmAndTraffickingSite,
};
pub use structure_align::{align_structures_tm, tm_score_d0, TmAlignmentReport};
pub use disorder_aggregation_epitopes::{
    analyze_protein_disorder_aggregation_epitopes, AggregationHotspot, AmphipathicHelixSegment,
    IntrinsicallyDisorderedRegion, MhcClassIPeptideCandidate,
    ProteinDisorderAggregationEpitopeReport,
};
pub use motifs_domains::{
    analyze_pdb_3d_geometry, predict_signal_peptide_von_heijne, scan_protein_functional_motifs,
    Pdb3dGeometryReport, ProteinMotifHit, ProteinMotifScanReport, ResidueGeometryProfile,
    SignalPeptidePrediction, StructuralDomainSegment,
};
pub use translation_orf::{
    find_orfs, optimize_codons_for_host, predict_glimmer_microbial_genes, residue_mass_da,
    translate_codon_ncbi, translate_codon_standard, translate_sequence, CodonOptimizationReport,
    GlimmerPredictedGene, GlimmerPredictionReport,
};

#[cfg(test)]
mod tests {
    use super::*;
    use molbiocraft_formats::{parse_pdb_or_mmcif_ca_coordinates, synthesize_folded_pdb_from_protein};

    #[test]
    fn kabsch_svd_recovers_zero_rmsd_under_arbitrary_3d_rotation_and_translation() {
        let pdb_a = synthesize_folded_pdb_from_protein(
            "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTL",
            "A",
            0.0,
        );
        let atoms_orig = parse_pdb_or_mmcif_ca_coordinates(&pdb_a);
        assert_eq!(atoms_orig.len(), 45);

        // Apply a 90-degree rotation around Z (x' = -y, y' = x, z' = z) + large translation (+35, -22, +19)
        let mut lines_b = vec!["HEADER    ROTATED MODEL B".to_string()];
        for (idx, a) in atoms_orig.iter().enumerate() {
            let xr = -a.y + 35.0;
            let yr = a.x - 22.0;
            let zr = a.z + 19.0;
            lines_b.push(format!(
                "ATOM  {:>5}  CA  {:>3} A{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 88.00           C",
                idx + 1,
                a.res_name,
                a.res_seq,
                xr,
                yr,
                zr
            ));
        }
        lines_b.push("END".into());
        let pdb_b = lines_b.join("\n");

        let report = align_pdb_structures_kabsch(&pdb_a, &pdb_b);
        assert_eq!(report.aligned_residue_pairs, 45);
        assert!(
            report.rmsd_angstrom < 0.01,
            "Expected Kabsch SVD RMSD < 0.01 Å, got {}",
            report.rmsd_angstrom
        );
        assert!(report.tm_score > 0.99);
    }

    #[test]
    fn orf_finder_biophysics_and_codon_optimization_work() {
        let opt = optimize_codons_for_host(
            "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT",
            false,
            "Escherichia coli K-12",
        );
        let orfs = find_orfs(&opt.optimized_dna, 40, false, 11);
        assert_eq!(orfs.len(), 1);
        assert_eq!(orfs[0].length_aa, 60);

        let bio = analyze_protein_sequence(&opt.protein_sequence, false, 9);
        assert_eq!(bio.length_aa, 60);
        assert!(bio.molecular_weight_kda > 6.0);
        assert!(bio.isoelectric_point_pi > 4.0 && bio.isoelectric_point_pi < 9.0);
    }
}
