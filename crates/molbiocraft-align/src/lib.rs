// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod debruijn;
pub mod large_scale_seed_chain;
pub mod long_read_pangenome;
pub mod msa;
pub mod ngs_assembly;
pub mod pairwise;
pub mod poa_and_banded;
pub mod progressive;
pub mod search_blast;

pub use poa_and_banded::{
    align_pairwise_banded_sparse, assemble_sanger_contig_poa,
    run_multiple_sequence_alignment_with_algorithm, PoaAlignedReadRow, PoaContigAssemblyReport,
    PoaGraphBubbleSite, PoaReadInput,
};

pub use large_scale_seed_chain::{
    align_large_genomes_minimizer_chain, search_proteome_blosum62_hsps,
    LargeGenomeMinimizerChainReport, ProteomeBlosumHspHit, ProteomeHomologySearchReport,
    ProteomeTargetRecord, SyntenicMinimizerChain,
};

pub use long_read_pangenome::{
    compute_mash_minimizer_distance, extract_canonical_minimizers, map_long_read_minimizer_chains,
    profile_pangenome_core_accessory, ChainedReadAlignment, LongReadMappingSummary,
    MashMinimizerReport, MinimizerAnchor, PangenomeCurvePoint, PangenomeGenomeInput,
    PangenomeProfileReport,
};
pub use msa::{
    build_neighbor_joining_newick, build_upgma_newick, run_multiple_sequence_alignment,
    sanitize_newick_label, MsaAlignmentResult, MsaInputDoc, MsaRow,
};
pub use ngs_assembly::{
    call_freebayes_variants, map_read_and_call_variants, run_bbduk_read_trimming,
    run_de_novo_assembly, run_ngs_reference_mapping, run_whole_genome_synteny, AdapterMatchHit,
    AssembledContigRecord, AssemblyReadInput, BbdukTrimReport, DeNovoAssemblyReport,
    FreeBayesVariantRecord, FreeBayesVariantReport, NgsReferenceMappingReport, ReadTrimOptions,
    ReadVariantMappingResult, SyntenyLcbBlock, VariantCall, WholeGenomeSyntenyReport,
};
pub use pairwise::{
    align_pairwise_gotoh, align_pairwise_standard, looks_like_protein_sequence,
    PairwiseAlignmentResult, PairwiseMode, ScoringMatrixKind,
};
pub use search_blast::{
    classify_sequence_taxonomy, compute_dotplot_hits, run_local_blast_search,
    search_approximate_myers, BlastHitRecord, BlastSubjectDoc, DotplotHit, MyersPatternHit,
    TaxonomicClassificationHit,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairwise_gotoh_global_local_and_protein_blosum62_work() {
        let nw = align_pairwise_standard(
            "GAATTCATGGTGAGCAAGGGCGAGGAG",
            "GAATTCATGGTGTGCAAGGGCGAGGAG",
            false,
            2,
            -1,
            -3,
            -1,
        );
        assert_eq!(nw.aligned_seq1.len(), nw.aligned_seq2.len());
        assert_eq!(nw.mismatches, 1);
        assert!(nw.identity_pct > 95.0);

        let prot = align_pairwise_gotoh(
            "MVSKGEELFTGVVPILVELDGDVNGHKFSV",
            "MVSKGEELFTGIVPILVELDGDVNGHKFSV",
            PairwiseMode::Global,
            Some(ScoringMatrixKind::Blosum62),
            0,
            0,
            -11,
            -1,
            500,
        );
        // V -> I in BLOSUM62 is a positive conservative substitution (':')
        assert!(prot.midline.contains(':'));
        assert!(prot.similarity_pct >= 99.0);
    }

    #[test]
    fn msa_myers_ngs_assembly_and_variant_caller_work() {
        let docs = vec![
            MsaInputDoc {
                id: "1".into(),
                name: "WT_eGFP".into(),
                sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACC".into(),
            },
            MsaInputDoc {
                id: "2".into(),
                name: "Insertion_Variant".into(),
                sequence: "ATGGTGAGCAAGAAAGGCCGAGGAGCTGTTCACC".into(),
            },
            MsaInputDoc {
                id: "3".into(),
                name: "Point_Mutant".into(),
                sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTTACC".into(),
            },
        ];
        let msa_res = run_multiple_sequence_alignment(&docs, 1000);
        assert_eq!(msa_res.rows.len(), 3);
        assert_eq!(msa_res.rows[0].aligned_seq.len(), msa_res.consensus.len());
        assert_eq!(
            msa_res.rows[0].aligned_seq.replace('-', ""),
            "ATGGTGAGCAAGGGCGAGGAGCTGTTCACC"
        );
        assert_eq!(
            msa_res.rows[1].aligned_seq.replace('-', ""),
            "ATGGTGAGCAAGAAAGGCCGAGGAGCTGTTCACC"
        );
        assert!(msa_res.newick_tree.ends_with(';'));

        let myers_hits = search_approximate_myers(
            "AAACCCGAATTCATGGTGAGCAAGGGCGAGGAGTTT",
            "GAATTCATGGTGTGCAAG",
            1,
            true,
            10,
        );
        assert!(!myers_hits.is_empty());
        assert!(myers_hits[0].edit_distance <= 1);

        let reads = vec![
            AssemblyReadInput {
                name: "R1".into(),
                sequence: "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACC".into(),
            },
            AssemblyReadInput {
                name: "R2".into(),
                sequence: "GGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTG".into(),
            },
        ];
        let asm = run_de_novo_assembly(&reads, "CAP3", 16);
        assert_eq!(asm.contig_count, 1);
        assert!(asm.largest_contig_bp > 45);

        let vc = call_freebayes_variants(
            "pTEST",
            "GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTG",
            "GAATTCATGGTGCGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTG",
        );
        assert_eq!(vc.snp_count, 1);
        assert!(vc.vcf_text.contains("##fileformat=VCFv4.2"));
    }
}
