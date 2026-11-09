// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Zero-import WebAssembly & native Rust RPC gateway exposing all 6 MolBioCraft bioinformatics
//! domain crates (`core`, `formats`, `align`, `phylo`, `cloning`, `protein`) through a single
//! unified JSON-over-linear-memory dispatcher (`dispatch_bio_rpc`).

pub mod resident_store;

use std::alloc::{alloc, dealloc, Layout};
use std::cell::{Cell, RefCell};

use molbiocraft_align::pairwise::align_pairwise_named;
use molbiocraft_align::poa_and_banded::align_pairwise_banded_sparse_with_warnings;
use molbiocraft_align::{
    align_large_genomes_minimizer_chain,
    align_pairwise_standard, assemble_sanger_contig_poa, build_neighbor_joining_newick,
    build_upgma_newick, call_freebayes_variants, classify_sequence_taxonomy, compute_dotplot_hits,
    compute_mash_minimizer_distance, map_long_read_minimizer_chains, map_read_and_call_variants,
    profile_pangenome_core_accessory, run_bbduk_read_trimming, run_de_novo_assembly,
    run_local_blast_search, run_multiple_sequence_alignment,
    run_multiple_sequence_alignment_with_algorithm, run_ngs_reference_mapping,
    run_whole_genome_synteny, search_approximate_myers, search_proteome_blosum62_hsps,
    AssemblyReadInput, BlastSubjectDoc, MsaInputDoc, PangenomeGenomeInput,
    PoaReadInput, ProteomeTargetRecord, ReadTrimOptions,
};
use molbiocraft_cloning::{
    add_attb_sites_to_sequence, analyze_gibson_overlap_junction, analyze_silent_mutations,
    analyze_silent_mutations_in_cds, CodingRegion1Based,
    anneal_complementary_oligos, annotate_gateway_att_sites, assemble_modular_custom_vector,
    audit_twist_custom_vector_onboarding, batch_modify_annotation_intervals,
    batch_set_cds_translation_property, build_catalog_vector_document,
    build_cloning_action_vector_document, build_construct_lineage_dag_rust, build_mcs_polylinker,
    calculate_primer_metrics, calculate_primer_thermodynamics_santalucia,
    check_cotransformation_compatibility, compute_agarose_gel_band_physics,
    compute_dna_and_ligation_calculations, compute_document_table_metrics_rust,
    concatenate_sequence_documents, convert_selection_to_oligo_primer, design_pcr_primers_with_slack,
    detect_common_features, evaluate_golden_gate_overhang_fidelity,
    evaluate_multi_digest_buffer_plan, execute_bio_pipeline_rust,
    execute_builtin_rust_workflow_macro, export_lineage_bundle_genbank,
    export_table_delimited_csv_rust, export_vector_catalog_csv,
    extract_annotated_features_to_documents, extract_region_with_annotations_rust,
    find_non_cutting_enzymes_for_topology, find_restriction_cut_sites,
    generate_catalog_circular_svg, generate_consensus_document, generate_large_genome_benchmark,
    generate_large_protein_benchmark, generate_safe_backbone_spacer, get_bio_pipeline_catalog,
    get_builtin_workflow_macros_rust, get_cloning_action_vector_presets,
    get_common_plasmid_features, get_host_strain_guides, get_modular_vector_parts,
    get_origin_compatibility_groups, get_rebase_enzymes, get_sample_library,
    get_twist_antibiotic_standards, get_vector_catalog, get_vector_system_guides,
    group_documents_by_prefix, mask_sequence_regions, predict_secondary_structure_with,
    randomly_sample_documents, set_circular_origin, simulate_molecular_cloning,
    simulate_restriction_digest, simulate_site_directed_mutagenesis,
    simulate_twist_clonal_gene_insertion, splice_modular_part_into_document_rust,
    test_saved_primers_on_sequence, CatalogVectorEntry, CloningActionVectorPreset,
    ModularAssemblySpec, ModularVectorPart, SelectionRange1Based,
};
use molbiocraft_cloning::cloning_crispr::{
    audit_sequence_alerts_for_scan, find_crispr_guides_for_topology,
};
use molbiocraft_cloning::rebase_catalog::{
    scan_restriction_sites, RestrictionPositionLimit, RESTRICTION_POSITIONS_PER_ENZYME,
};
use molbiocraft_core::{
    analyze_karlin_dinucleotide_islands, analyze_sequence_composition, clean_alpha_sequence,
    clean_sequence, complement_sequence, compute_batch_sequence_stats, compute_genome_track_overview,
    compute_kmer_spectrum, compute_sequence_stats, convert_dna_rna, find_cpg_islands,
    scan_genomic_repeats, mutate_or_shuffle_sequence, profile_epigenetic_methylation_sites,
    query_features_in_viewport, reverse_complement, reverse_complement_iupac,
    reverse_only_sequence, scan_fuzzy_subsequence_simd, scan_jaspar_pssm_motifs,
    scan_microsatellite_strs, scan_non_b_dna_structures, scan_rho_independent_terminators,
    scan_sigma70_promoters, search_genome_motif_fmindex, segment_genome_hmm_viterbi,
    slice_genome_viewport, BatchSequenceItem, ChromatogramData, PrimerRecord, RestrictionCutSite,
    RestrictionEnzyme, SequenceDocument, SequenceFeature, Topology,
};
use molbiocraft_formats::{
    annotate_vcf_coding_consequences_noodles, build_curated_database_document,
    build_ncbi_reference_preset_document, compute_chromatogram_viewport,
    compute_mbc_payload_checksum, compute_sam_pileup_and_coverage_noodles, export_embl_flatfile,
    parse_embl_flatfile,
    export_fasta_noodles, export_genbank_flatfile, export_gff3_noodles,
    get_curated_database_records, get_reference_database_categories,
    intersect_genomic_intervals_noodles, is_mbc_file_or_payload_rust, parse_bed_noodles,
    parse_binary_sequence_packet, parse_fasta_noodles, parse_fastq_noodles, parse_genbank_flatfile,
    parse_gff3_noodles, parse_mbc_workbench_rust,
    pdb_mmcif::{parse_mmcif_structure, try_parse_pdb_or_mmcif_ca_coordinates},
    parse_remote_database_payload, parse_sam_noodles, parse_vcf_noodles,
    prepare_genbank_submission_package, query_curated_database_records,
    serialize_mbc_workbench_rust, synthesize_folded_pdb_from_protein,
    synthesize_sanger_chromatogram, trim_sanger_trace_mott_phred, GenBankSubmissionMeta,
    MbcChecksumDocInput, MbcWorkbenchSnapshotInput, PdbCaAtom,
};
use molbiocraft_phylo::{
    analyze_recombination_and_ld, analyze_user_tree, compare_tree_topologies_robinson_foulds,
    compute_evolutionary_distances, compute_nucleotide_composition_by_codon_pos,
    compute_population_diversity, compute_relative_synonymous_codon_usage,
    compute_substitution_rate_matrix, construct_phylogenetic_tree_with_resampling, diagnose_missense_mutation,
    estimate_gamma_and_site_rates, explore_active_alignment_data, find_best_substitution_models,
    infer_ancestral_sequences, layout_newick_phylogenetic_tree, run_mcdonald_kreitman_test,
    run_molecular_clock_and_timetree, run_selection_and_neutrality_tests,
};
use molbiocraft_protein::biophysics_3d::align_pdb_chains_kabsch;
use molbiocraft_protein::genetic_codes::{resolve_genetic_code, unknown_genetic_code_warning};
use molbiocraft_protein::translation_orf::{OrfSearchReport, TranslationReport};
use molbiocraft_protein::{
    analyze_pdb_3d_geometry,
    analyze_protein_disorder_aggregation_epitopes, analyze_protein_sequence,
    optimize_codons_for_host, predict_coiled_coils_and_transmembrane,
    predict_glimmer_microbial_genes, predict_signal_peptide_von_heijne,
    scan_post_translational_modifications, scan_protein_functional_motifs,
    simulate_peptide_ms2_spectrum, simulate_proteolytic_digest_ms, translate_sequence,
};
use resident_store::{
    ensure_resident_sequence, evict_resident_sequence, get_resident_track_overview,
    resident_store_stats, search_resident_motif_fmindex, slice_resident_viewport,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

// Records which payload keys an RPC arm actually reads, so a test can catch a key the
// TypeScript side sends under a name the Rust side never looks at (the two have drifted before).
// Recording is off unless a test turns it on, so production dispatch is unaffected.
thread_local! {
    static READ_KEYS: std::cell::RefCell<Option<Vec<String>>> = const { std::cell::RefCell::new(None) };
}

#[inline]
fn note_key(key: &str) {
    READ_KEYS.with(|k| {
        if let Some(v) = k.borrow_mut().as_mut() {
            v.push(key.to_string());
        }
    });
}

/// Run `f`, returning the payload keys the dispatcher read while it ran. Recording is off until
/// this is called, so normal dispatch only pays one thread-local check per argument.
#[doc(hidden)]
pub fn keys_read_by<T>(f: impl FnOnce() -> T) -> (T, Vec<String>) {
    READ_KEYS.with(|k| *k.borrow_mut() = Some(Vec::new()));
    let out = f();
    let keys = READ_KEYS.with(|k| k.borrow_mut().take()).unwrap_or_default();
    (out, keys)
}

#[inline]
fn str_arg<'a>(v: &'a Value, key: &str, default: &'a str) -> &'a str {
    note_key(key);
    v.get(key).and_then(Value::as_str).unwrap_or(default)
}

#[inline]
fn bool_arg(v: &Value, key: &str, default: bool) -> bool {
    note_key(key);
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Upper bound for any size/length/count argument accepted over RPC. Without it
/// a single request such as `generate_safe_backbone_spacer {lengthBp: 1e12}`
/// requested a terabyte allocation and aborted the whole process.
pub const MAX_RPC_SIZE_ARG: usize = 50_000_000;

/// Arguments that address a position in a sequence rather than size an
/// allocation. They are not capped at [`MAX_RPC_SIZE_ARG`]: a chromosome longer
/// than 50 Mbp is valid input, and clamping its coordinates silently acted on
/// the wrong region. Callees clamp them against the real sequence length.
const COORDINATE_ARGS: &[&str] = &[
    "startPos",
    "endPos",
    "positionBp",
    "positionAa",
    "insertionSiteBp",
    "startBp",
    "endBp",
    "start1Based",
    "end1Based",
    "regionStart",
    "regionEnd",
    "newOrigin1Based",
    "baseOffset",
    "frameOffset",
];

#[inline]
fn usize_arg(v: &Value, key: &str, default: usize) -> usize {
    note_key(key);
    // Coordinates are capped at u32::MAX, far beyond any sequence the
    // workbench holds. On 64-bit hosts this keeps `+ 1`-style arithmetic in
    // callees from overflowing; on wasm32 usize is already 32-bit, so callees
    // that multiply coordinates must use checked arithmetic themselves.
    let cap = if COORDINATE_ARGS.contains(&key) {
        u32::MAX as u64
    } else {
        MAX_RPC_SIZE_ARG as u64
    };
    v.get(key)
        .and_then(|x| {
            x.as_u64().map(|n| n.min(cap) as usize).or_else(|| {
                x.as_f64()
                    .filter(|f| f.is_finite())
                    .map(|f| f.max(0.0).min(cap as f64).round() as usize)
            })
        })
        .unwrap_or(default)
}

/// The NCBI genetic code a payload's `key` selects, and the warnings owed when it selects none
/// (D0005, TD-06). An absent or null key selects `default`, with no warning. Otherwise the id is
/// read as sent, not through [`usize_arg`] (which clamps, rounds and reads a negative as 0):
/// a whole, non-negative number goes to [`resolve_genetic_code`], so 300 is named 300 rather than
/// clamped to 255, 258 does not wrap to table 2, and 0 is the unset id (table 1, no warning); any
/// other value (-2, 2.5, "2") selects no table, reads as the Standard code (table 1), and the
/// warning names the value sent.
fn genetic_code_arg(v: &Value, key: &str, default: u8) -> (u8, Vec<String>) {
    note_key(key);
    let Some(raw) = v.get(key).filter(|x| !x.is_null()) else {
        return (default, Vec::new());
    };
    // a whole float below 2^64 is that id (`u64::MAX as f64` is 2^64, which does not fit)
    let id = raw.as_u64().or_else(|| {
        raw.as_f64().filter(|f| *f >= 0.0 && f.fract() == 0.0 && *f < u64::MAX as f64).map(|f| f as u64)
    });
    let (table, warning) = match id {
        Some(id) => resolve_genetic_code(id),
        None => (resolve_genetic_code(0).0, Some(unknown_genetic_code_warning(raw))),
    };
    (table, warning.into_iter().collect())
}

#[inline]
fn isize_arg(v: &Value, key: &str, default: isize) -> isize {
    note_key(key);
    v.get(key)
        .and_then(|x| {
            x.as_i64()
                .map(|n| n as isize)
                .or_else(|| x.as_f64().map(|f| f.round() as isize))
        })
        .unwrap_or(default)
}

#[inline]
fn i32_arg(v: &Value, key: &str, default: i32) -> i32 {
    note_key(key);
    v.get(key)
        .and_then(|x| {
            x.as_i64()
                .map(|n| n as i32)
                .or_else(|| x.as_f64().map(|f| f.round() as i32))
        })
        .unwrap_or(default)
}

#[inline]
fn u64_arg(v: &Value, key: &str, default: u64) -> u64 {
    note_key(key);
    v.get(key)
        .and_then(|x| {
            x.as_u64()
                .or_else(|| x.as_f64().map(|f| f.max(0.0).round() as u64))
        })
        .unwrap_or(default)
}

#[inline]
fn f64_arg(v: &Value, key: &str, default: f64) -> f64 {
    note_key(key);
    v.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn parse_field<T: DeserializeOwned>(v: &Value, key: &str) -> Result<T, String> {
    note_key(key);
    let sub = v
        .get(key)
        .ok_or_else(|| format!("Missing required field '{}' in RPC payload", key))?;
    serde_json::from_value(sub.clone())
        .map_err(|e| format!("Invalid '{}' payload field: {}", key, e))
}

fn parse_opt_field<T: DeserializeOwned>(v: &Value, key: &str) -> Result<Option<T>, String> {
    note_key(key);
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(sub) => serde_json::from_value(sub.clone())
            .map(Some)
            .map_err(|e| format!("Invalid optional '{}' payload field: {}", key, e)),
    }
}

fn to_val<T: Serialize>(item: T) -> Result<Value, String> {
    serde_json::to_value(item).map_err(|e| format!("Serialization error: {}", e))
}

fn parse_topology_str(raw: &str) -> Topology {
    if raw.eq_ignore_ascii_case("circular") {
        Topology::Circular
    } else {
        Topology::Linear
    }
}

/// Unified Rust Bioinformatics RPC dispatcher shared across WebAssembly (`wasm32-unknown-unknown`)
/// and Tauri v2 native IPC (`src-tauri`).
pub fn dispatch_bio_rpc(op: &str, payload: Value) -> Result<Value, String> {
    match op {
        "engine_diagnostics" => Ok(json!({
            "engine": "MolBioCraft Rust Bioinformatics Workspace",
            "version": env!("CARGO_PKG_VERSION"),
            "libraries": [
                "rust-bio 2.3.0 (FMIndex, SuffixArray, BWT, IntervalTree, Gotoh Aligner, Banded Sparse DP, POA Contig Graph, Viterbi HMM, JASPAR PSSM/PWM, PHREDProb, Myers, BLOSUM62/PAM250, ORF)",
                "noodles (FASTA, FASTQ, GFF3, BED, VCF, SAM)",
                "nalgebra 0.33 (3x3 SVD Kabsch 3D Superposition)",
                "statrs 0.18 (Chi-Square, Normal, Gamma CDFs)",
                "petgraph 0.6 (Newick Phylogenetic Layout, Construct Lineage DAG, Disulfide Graphs)",
                "triple_accel 0.4 (SIMD Levenshtein & Hamming Edit Distance)",
                "csv 1.4 + crc32fast 1.5 + flate2 1.1 + ndarray 0.16",
                "aho-corasick 1.1 + memchr 2.8 + rustc-hash 2.1"
            ],
            "targetArch": std::env::consts::ARCH,
            "isWasm": cfg!(target_arch = "wasm32"),
        })),

        // ─── 1. Core Sequence & Large Genome Index (`molbiocraft-core`) ───
        "clean_sequence" => {
            let alpha_only = bool_arg(&payload, "alphaOnly", false);
            let raw = str_arg(&payload, "seq", "");
            Ok(Value::String(if alpha_only {
                clean_alpha_sequence(raw)
            } else {
                clean_sequence(raw)
            }))
        }
        "complement_sequence" => {
            let seq = str_arg(&payload, "seq", "");
            let is_rna = bool_arg(&payload, "isRna", false);
            Ok(Value::String(complement_sequence(seq, is_rna)))
        }
        "reverse_complement" => {
            let seq = str_arg(&payload, "seq", "");
            let is_rna = bool_arg(&payload, "isRna", false);
            Ok(Value::String(if is_rna {
                reverse_complement_iupac(seq, true)
            } else {
                reverse_complement(seq)
            }))
        }
        "reverse_only_sequence" => {
            let seq = str_arg(&payload, "seq", "");
            Ok(Value::String(reverse_only_sequence(seq)))
        }
        "convert_dna_rna" => {
            let seq = str_arg(&payload, "seq", "");
            let to_rna = bool_arg(&payload, "toRna", true);
            Ok(Value::String(convert_dna_rna(seq, to_rna)))
        }
        "analyze_sequence_composition" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(analyze_sequence_composition(seq))
        }
        "compute_sequence_stats" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(compute_sequence_stats(seq))
        }
        "compute_batch_sequence_stats" => {
            let items: Vec<BatchSequenceItem> = parse_field(&payload, "items")?;
            let out = compute_batch_sequence_stats(&items).map_err(|e| e.to_string())?;
            to_val(out)
        }
        "mutate_or_shuffle_sequence" => {
            let seq = str_arg(&payload, "seq", "");
            let mode = str_arg(&payload, "mode", "shuffle-dinucleotide");
            let rate = f64_arg(&payload, "mutationRatePct", 5.0);
            let seed = u64_arg(&payload, "seed", 42);
            to_val(mutate_or_shuffle_sequence(seq, mode, rate, seed))
        }
        "slice_genome_viewport" => {
            let seq = str_arg(&payload, "seq", "");
            let features: Vec<SequenceFeature> =
                parse_opt_field(&payload, "features")?.unwrap_or_default();
            let start_pos = usize_arg(&payload, "startPos", 1);
            let end_pos = usize_arg(&payload, "endPos", 1200);
            let is_rna = bool_arg(&payload, "isRna", false);
            let is_protein = bool_arg(&payload, "isProtein", false);
            to_val(slice_genome_viewport(
                seq, &features, start_pos, end_pos, is_rna, is_protein,
            ))
        }
        "compute_genome_track_overview" => {
            let seq = str_arg(&payload, "seq", "");
            let bins = usize_arg(&payload, "bins", 180);
            to_val(compute_genome_track_overview(seq, bins))
        }
        "query_features_in_viewport" => {
            let features: Vec<SequenceFeature> = parse_field(&payload, "features")?;
            let start_bp = usize_arg(&payload, "startBp", 1);
            let end_bp = usize_arg(&payload, "endBp", 1000);
            to_val(query_features_in_viewport(&features, start_bp, end_bp))
        }
        "search_genome_motif_fmindex" => {
            let seq = str_arg(&payload, "seq", "");
            let pattern = str_arg(&payload, "pattern", "");
            let both = bool_arg(&payload, "searchBothStrands", true);
            let max_hits = usize_arg(&payload, "maxHits", 250);
            to_val(search_genome_motif_fmindex(seq, pattern, both, max_hits))
        }
        "find_cpg_islands" => {
            let seq = str_arg(&payload, "seq", "");
            let min_len = usize_arg(&payload, "minLengthBp", 200);
            let min_gc = f64_arg(&payload, "minGcPct", 50.0);
            let min_oe = f64_arg(&payload, "minObsExp", 0.6);
            to_val(find_cpg_islands(seq, min_len, min_gc, min_oe))
        }
        "scan_microsatellite_strs" => {
            let seq = str_arg(&payload, "seq", "");
            let min_units = usize_arg(&payload, "minUnitsDiPlus", 4);
            let min_homo = usize_arg(&payload, "minHomopolymerBp", 8);
            to_val(scan_microsatellite_strs(seq, min_units, min_homo))
        }
        "find_genomic_repeats" => {
            let seq = str_arg(&payload, "seq", "");
            let min_arm = usize_arg(&payload, "minArmBp", 10);
            let max_hits = usize_arg(&payload, "maxHits", 80);
            to_val(scan_genomic_repeats(seq, min_arm, max_hits))
        }

        // ─── 2. File Formats, `noodles` I/O & 3D PDB/mmCIF (`molbiocraft-formats`) ───
        "parse_fasta" => {
            let text = str_arg(&payload, "text", "");
            let default_name = str_arg(&payload, "defaultName", "Imported_FASTA");
            to_val(parse_fasta_noodles(text, default_name))
        }
        "export_fasta" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            Ok(Value::String(export_fasta_noodles(&doc)))
        }
        "parse_fastq" => {
            let text = str_arg(&payload, "text", "");
            let max_reads = usize_arg(&payload, "maxReads", 500);
            to_val(parse_fastq_noodles(text, max_reads))
        }
        "parse_gff3" => {
            let text = str_arg(&payload, "text", "");
            to_val(parse_gff3_noodles(text))
        }
        "export_gff3" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            Ok(Value::String(export_gff3_noodles(&doc)))
        }
        "parse_bed" => {
            let text = str_arg(&payload, "text", "");
            to_val(parse_bed_noodles(text))
        }
        "parse_vcf" => {
            let text = str_arg(&payload, "text", "");
            to_val(parse_vcf_noodles(text))
        }
        "bam_to_sam" => {
            let bytes: Vec<u8> = parse_field(&payload, "bytes")?;
            let max = payload.get("maxRecords").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            Ok(Value::String(molbiocraft_formats::bam_to_sam_text(&bytes, max).map_err(|e| e.to_string())?))
        }
        "parse_sam" => {
            let text = str_arg(&payload, "text", "");
            to_val(parse_sam_noodles(text))
        }
        "parse_genbank" => {
            let text = str_arg(&payload, "text", "");
            let fallback_name = str_arg(&payload, "fallbackName", "Imported_GenBank");
            to_val(parse_genbank_flatfile(text, fallback_name))
        }
        "export_genbank" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            Ok(Value::String(export_genbank_flatfile(&doc)))
        }
        "parse_embl" => {
            let text = str_arg(&payload, "text", "");
            let fallback_name = str_arg(&payload, "fallbackName", "Imported_EMBL");
            to_val(parse_embl_flatfile(text, fallback_name))
        }
        "export_embl" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            Ok(Value::String(export_embl_flatfile(&doc)))
        }
        "parse_binary_packet" => {
            let bytes: Vec<u8> = parse_field(&payload, "bytes")?;
            let file_name = str_arg(&payload, "fileName", "Imported_Binary.ab1");
            to_val(parse_binary_sequence_packet(&bytes, file_name))
        }
        "synthesize_chromatogram" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(synthesize_sanger_chromatogram(seq))
        }
        "prepare_genbank_submission" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let meta: GenBankSubmissionMeta = parse_field(&payload, "meta")?;
            to_val(prepare_genbank_submission_package(&doc, &meta))
        }
        "parse_pdb_ca" => {
            let pdb_text = str_arg(&payload, "pdbText", "");
            // An mmCIF that cannot be read says why (e.g. which _atom_site column is missing)
            // rather than arriving as an empty atom list.
            try_parse_pdb_or_mmcif_ca_coordinates(pdb_text)
                .map_err(|e| e.to_string())
                .and_then(to_val)
        }
        "parse_structure" => {
            note_key("text");
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .ok_or("Missing required field 'text' in RPC payload")?;
            parse_mmcif_structure(text)
                .map_err(|e| e.to_string())
                .and_then(to_val)
        }
        "synthesize_folded_pdb" => {
            let protein_seq = str_arg(&payload, "proteinSeq", "");
            let chain_id = str_arg(&payload, "chainId", "A");
            let perturb = f64_arg(&payload, "perturbationAngstrom", 0.0);
            Ok(Value::String(synthesize_folded_pdb_from_protein(
                protein_seq,
                chain_id,
                perturb,
            )))
        }

        // ─── 3. Alignment, BLAST, Myers & NGS Assembly (`molbiocraft-align`) ───
        "align_pairwise" => {
            let seq1 = str_arg(&payload, "seq1", "");
            let seq2 = str_arg(&payload, "seq2", "");
            // `mode` ("global" | "local" | "semiglobal") takes precedence over the older `local`
            // flag, which cannot express semiglobal. An unknown mode aligns globally and the
            // reply's `warnings` says so (D0005).
            let local = match payload.get("mode").and_then(Value::as_str) {
                Some(m) => {
                    note_key("mode");
                    return to_val(align_pairwise_named(
                        seq1,
                        seq2,
                        m,
                        "auto",
                        i32_arg(&payload, "matchScore", 2),
                        i32_arg(&payload, "mismatchPenalty", -1),
                        i32_arg(&payload, "gapOpen", -3),
                        i32_arg(&payload, "gapExtend", -1),
                        usize_arg(&payload, "maxLen", 2400),
                    ));
                }
                None => bool_arg(&payload, "local", false),
            };
            let match_score = i32_arg(&payload, "matchScore", 2);
            let mismatch_penalty = i32_arg(&payload, "mismatchPenalty", -1);
            let gap_open = i32_arg(&payload, "gapOpen", -3);
            let gap_extend = i32_arg(&payload, "gapExtend", -1);
            to_val(align_pairwise_standard(
                seq1,
                seq2,
                local,
                match_score,
                mismatch_penalty,
                gap_open,
                gap_extend,
            ))
        }
        "align_pairwise_gotoh" => {
            let seq1 = str_arg(&payload, "seq1", "");
            let seq2 = str_arg(&payload, "seq2", "");
            // an unknown mode or matrix name aligns with its default, and the reply's `warnings`
            // names it (D0005)
            let mode = str_arg(&payload, "mode", "global");
            let matrix = str_arg(&payload, "matrix", "auto");
            let match_score = i32_arg(&payload, "matchScore", 2);
            let mismatch_penalty = i32_arg(&payload, "mismatchPenalty", -1);
            let gap_open = i32_arg(&payload, "gapOpen", -5);
            let gap_extend = i32_arg(&payload, "gapExtend", -1);
            let max_len = usize_arg(&payload, "maxLen", 4000);
            to_val(align_pairwise_named(
                seq1,
                seq2,
                mode,
                matrix,
                match_score,
                mismatch_penalty,
                gap_open,
                gap_extend,
                max_len,
            ))
        }
        "run_msa" => {
            let docs: Vec<MsaInputDoc> = parse_field(&payload, "docs")?;
            let max_seq_len = usize_arg(&payload, "maxSeqLen", 2400);
            let algorithm = str_arg(&payload, "algorithm", "");
            if algorithm.is_empty() {
                to_val(run_multiple_sequence_alignment(&docs, max_seq_len))
            } else {
                to_val(run_multiple_sequence_alignment_with_algorithm(
                    &docs,
                    max_seq_len,
                    algorithm,
                ))
            }
        }
        "build_nj_newick" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            Ok(Value::String(build_neighbor_joining_newick(
                &names,
                &aligned_seqs,
            )))
        }
        "build_upgma_newick" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            Ok(Value::String(build_upgma_newick(&names, &aligned_seqs)))
        }
        "compute_dotplot_hits" => {
            let seq1 = str_arg(&payload, "seq1", "");
            let seq2 = str_arg(&payload, "seq2", "");
            let window_size = usize_arg(&payload, "windowSize", 11);
            let min_matches = usize_arg(&payload, "minMatches", 9);
            to_val(compute_dotplot_hits(seq1, seq2, window_size, min_matches))
        }
        "search_approximate_myers" => {
            let seq = str_arg(&payload, "seq", "");
            let pattern = str_arg(&payload, "pattern", "");
            let max_dist = usize_arg(&payload, "maxEditDist", 2).min(15) as u8;
            let revcomp = bool_arg(&payload, "searchRevcomp", true);
            let max_hits = usize_arg(&payload, "maxHits", 100);
            to_val(search_approximate_myers(
                seq, pattern, max_dist, revcomp, max_hits,
            ))
        }
        "run_local_blast" => {
            let query_seq = str_arg(&payload, "querySeq", "");
            let docs: Vec<BlastSubjectDoc> = parse_field(&payload, "docs")?;
            let program = str_arg(&payload, "program", "blastn");
            let database_name = str_arg(&payload, "databaseName", "Local Workbench Documents");
            to_val(run_local_blast_search(
                query_seq,
                &docs,
                program,
                database_name,
            ))
        }
        "classify_taxonomy" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(classify_sequence_taxonomy(seq))
        }
        "run_bbduk_trim" => {
            let seq = str_arg(&payload, "seq", "");
            let qualities: Option<Vec<u8>> = parse_opt_field(&payload, "qualities")?;
            let opts: ReadTrimOptions = parse_field(&payload, "options")?;
            to_val(run_bbduk_read_trimming(seq, qualities.as_deref(), &opts))
        }
        "run_ngs_mapping" => {
            let reference_seq = str_arg(&payload, "referenceSeq", "");
            let read_seq = str_arg(&payload, "readSeq", "");
            let mapper = str_arg(&payload, "mapper", "Minimap2");
            to_val(run_ngs_reference_mapping(reference_seq, read_seq, mapper))
        }
        "map_read_and_call_variants" => {
            let ref_seq = str_arg(&payload, "refSeq", "");
            let read_seq = str_arg(&payload, "readSeq", "");
            let read_name = str_arg(&payload, "readName", "Read");
            let phred: Option<Vec<u8>> = parse_opt_field(&payload, "phredScores")?;
            to_val(map_read_and_call_variants(
                ref_seq,
                read_seq,
                read_name,
                phred.as_deref(),
            ))
        }
        "run_de_novo_assembly" => {
            let inputs: Vec<AssemblyReadInput> = parse_field(&payload, "inputs")?;
            let assembler = str_arg(&payload, "assembler", "CAP3");
            let min_overlap_bp = usize_arg(&payload, "minOverlapBp", 16);
            to_val(run_de_novo_assembly(&inputs, assembler, min_overlap_bp))
        }
        "run_whole_genome_synteny" => {
            let seq_a = str_arg(&payload, "seqA", "");
            let seq_b = str_arg(&payload, "seqB", "");
            let engine = str_arg(&payload, "engine", "LastZ");
            to_val(run_whole_genome_synteny(seq_a, seq_b, engine))
        }
        "call_freebayes_variants" => {
            let ref_name = str_arg(&payload, "refName", "REF_SEQ");
            let ref_seq = str_arg(&payload, "refSeq", "");
            let sample_seq = str_arg(&payload, "sampleSeq", "");
            to_val(call_freebayes_variants(ref_name, ref_seq, sample_seq))
        }

        // ─── 4. Phylogenetics & Molecular Evolution (`molbiocraft-phylo`) ───
        "explore_alignment_data" => {
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(explore_active_alignment_data(&aligned_seqs))
        }
        "find_best_substitution_models" => {
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(find_best_substitution_models(&aligned_seqs))
        }
        "compute_substitution_rate_matrix" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(compute_substitution_rate_matrix(&names, &aligned_seqs))
        }
        "compute_nucleotide_composition_by_codon_pos" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(compute_nucleotide_composition_by_codon_pos(
                &names,
                &aligned_seqs,
            ))
        }
        "compute_rscu" => {
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(compute_relative_synonymous_codon_usage(&aligned_seqs))
        }
        "compute_evolutionary_distances" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let model = str_arg(&payload, "model", "Tamura-Nei (TN93)");
            let groups: Vec<String> = parse_field(&payload, "groups").unwrap_or_default();
            to_val(compute_evolutionary_distances(&names, &aligned_seqs, model, &groups))
        }
        "compute_population_diversity" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let model = str_arg(&payload, "model", "Tamura-Nei (TN93)");
            let groups: Vec<String> = parse_field(&payload, "groups").unwrap_or_default();
            to_val(compute_population_diversity(&names, &aligned_seqs, model, &groups))
        }
        "ml_tree_search" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let model = str_arg(&payload, "model", "GTR+G");
            match molbiocraft_phylo::ml_search::ml_tree_search(&names, &aligned_seqs, model) {
                Ok(r) => to_val(r),
                Err(e) => Err(e),
            }
        }
        "construct_phylogenetic_tree" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let algorithm = str_arg(&payload, "algorithm", "Maximum Likelihood (ML)");
            let model = str_arg(&payload, "model", "Tamura-Nei (TN93)");
            let bootstrap_replicates = usize_arg(&payload, "bootstrapReplicates", 500);
            // "jackknifePct" > 0 switches the resampling from bootstrap to delete-d jackknife.
            let jackknife = f64_arg(&payload, "jackknifePct", 0.0);
            to_val(construct_phylogenetic_tree_with_resampling(
                &names,
                &aligned_seqs,
                algorithm,
                model,
                bootstrap_replicates,
                (jackknife > 0.0).then_some(jackknife),
            ))
        }
        "analyze_user_tree" => {
            let user_newick = str_arg(&payload, "userNewick", "");
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(analyze_user_tree(user_newick, &names, &aligned_seqs))
        }
        "infer_ancestral_sequences" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let method = str_arg(&payload, "method", "Maximum Likelihood (Empirical Bayes)");
            to_val(infer_ancestral_sequences(&names, &aligned_seqs, method))
        }
        "run_selection_and_neutrality_tests" => {
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(run_selection_and_neutrality_tests(&aligned_seqs))
        }
        "estimate_gamma_and_site_rates" => {
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let num_categories = usize_arg(&payload, "numCategories", 5);
            to_val(estimate_gamma_and_site_rates(&aligned_seqs, num_categories))
        }
        "run_molecular_clock_and_timetree" => {
            let names: Vec<String> = parse_field(&payload, "names")?;
            let aligned_seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            let method = str_arg(&payload, "method", "RelTime-ML");
            let calibration_age_mya = f64_arg(&payload, "calibrationAgeMya", 45.0);
            to_val(run_molecular_clock_and_timetree(
                &names,
                &aligned_seqs,
                method,
                calibration_age_mya,
            ))
        }
        "diagnose_missense_mutation" => {
            let position_aa = usize_arg(&payload, "positionAa", 1);
            let wild_type_aa = str_arg(&payload, "wildTypeAa", "A");
            let mutant_aa = str_arg(&payload, "mutantAa", "V");
            let aligned: Vec<String> = parse_field(&payload, "alignedSeqs").unwrap_or_default();
            to_val(diagnose_missense_mutation(
                position_aa,
                wild_type_aa,
                mutant_aa,
                &aligned,
            ))
        }

        // ─── 5. Protein Biophysics, Translation, ORF & 3D Kabsch (`molbiocraft-protein`) ───
        // Both reply with the result and `warnings` (D0005): a `tableId` that selects no NCBI table
        // reads as the Standard code (table 1), and the warning names the value sent.
        "translate_sequence" => {
            let dna = str_arg(&payload, "dna", "");
            let frame_offset = usize_arg(&payload, "frameOffset", 0);
            let (table_id, warnings) = genetic_code_arg(&payload, "tableId", 1);
            to_val(TranslationReport {
                protein: translate_sequence(dna, frame_offset, table_id),
                warnings,
            })
        }
        "find_orfs" => {
            let seq = str_arg(&payload, "seq", "");
            let min_length_aa = usize_arg(&payload, "minLengthAa", 30);
            let allow_alt = bool_arg(&payload, "allowAlternativeStart", false);
            let (table_id, warnings) = genetic_code_arg(&payload, "tableId", 1);
            let circular = bool_arg(&payload, "circular", false);
            to_val(OrfSearchReport {
                orfs: molbiocraft_protein::translation_orf::find_orfs_with_topology(seq, min_length_aa, allow_alt, table_id, circular),
                warnings,
            })
        }
        "predict_glimmer_genes" => {
            let seq = str_arg(&payload, "seq", "");
            let min_aa = usize_arg(&payload, "minAaLength", 50);
            to_val(predict_glimmer_microbial_genes(seq, min_aa))
        }
        "optimize_codons" => {
            let seq = str_arg(&payload, "seq", "");
            let is_dna = bool_arg(&payload, "isDna", false);
            let host = str_arg(&payload, "host", "Escherichia coli K-12");
            to_val(optimize_codons_for_host(seq, is_dna, host))
        }
        "analyze_protein_sequence" => {
            let seq = str_arg(&payload, "seq", "");
            let is_dna = bool_arg(&payload, "isDna", true);
            let window_size = usize_arg(&payload, "windowSize", 9);
            to_val(analyze_protein_sequence(seq, is_dna, window_size))
        }
        "predict_coiled_coils_and_tm" => {
            let protein_seq = str_arg(&payload, "proteinSeq", "");
            to_val(predict_coiled_coils_and_transmembrane(protein_seq))
        }
        "backbone_torsions" => {
            note_key("text");
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .ok_or("Missing required field 'text' in RPC payload")?;
            // Optional chain id; absent, null or "" means the first protein chain.
            let chain: Option<String> = parse_opt_field(&payload, "chain")?;
            molbiocraft_protein::backbone::backbone_torsions(text, chain.as_deref()).and_then(to_val)
        }
        "align_pdb_kabsch" => {
            let pdb_a = str_arg(&payload, "pdbA", "");
            let pdb_b = str_arg(&payload, "pdbB", "");
            // Optional chain ids; absent, null or "" means each structure's first protein chain.
            let chain_a: Option<String> = parse_opt_field(&payload, "chainA")?;
            let chain_b: Option<String> = parse_opt_field(&payload, "chainB")?;
            align_pdb_chains_kabsch(pdb_a, pdb_b, chain_a.as_deref(), chain_b.as_deref()).and_then(to_val)
        }
        "align_structures_tm" => {
            // Sequence-independent (TM-align-style) alignment; the same keys as `align_pdb_kabsch`.
            let pdb_a = str_arg(&payload, "pdbA", "");
            let pdb_b = str_arg(&payload, "pdbB", "");
            let chain_a: Option<String> = parse_opt_field(&payload, "chainA")?;
            let chain_b: Option<String> = parse_opt_field(&payload, "chainB")?;
            molbiocraft_protein::structure_align::align_structures_tm(
                pdb_a,
                pdb_b,
                chain_a.as_deref(),
                chain_b.as_deref(),
            )
            .and_then(to_val)
        }

        // ─── 6. Molecular Cloning, REBASE, Thermodynamics, CRISPR, Vector Architect & Batch Ops ───
        "get_rebase_enzymes" => to_val(get_rebase_enzymes()),
        "find_restriction_cut_sites" => {
            let seq = str_arg(&payload, "seq", "");
            let topology = parse_topology_str(str_arg(&payload, "topology", "circular"));
            let custom_enzymes: Option<Vec<RestrictionEnzyme>> =
                parse_opt_field(&payload, "customEnzymes")?;
            to_val(find_restriction_cut_sites(
                seq,
                topology,
                custom_enzymes.as_deref(),
            ))
        }
        // The scan with every enzyme's complete site count, the enzymes whose positions were kept
        // to RESTRICTION_POSITIONS_PER_ENZYME, `stoppedEarly` and `warnings` (BG-01M6S1K2).
        "scan_restriction_sites" => {
            let seq = str_arg(&payload, "seq", "");
            let topology = parse_topology_str(str_arg(&payload, "topology", "circular"));
            let custom_enzymes: Option<Vec<RestrictionEnzyme>> =
                parse_opt_field(&payload, "customEnzymes")?;
            to_val(scan_restriction_sites(
                seq,
                topology,
                custom_enzymes.as_deref(),
                RestrictionPositionLimit::PerEnzyme(RESTRICTION_POSITIONS_PER_ENZYME),
            ))
        }
        "find_non_cutting_enzymes" => {
            let seq = str_arg(&payload, "seq", "");
            let custom_enzymes: Option<Vec<RestrictionEnzyme>> =
                parse_opt_field(&payload, "customEnzymes")?;
            // Older callers send no topology: keep their circular behaviour.
            let topology = if str_arg(&payload, "topology", "circular").eq_ignore_ascii_case("linear") {
                Topology::Linear
            } else {
                Topology::Circular
            };
            to_val(find_non_cutting_enzymes_for_topology(seq, topology, custom_enzymes.as_deref()))
        }
        "simulate_restriction_digest" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let enzymes: Vec<String> = parse_field(&payload, "selectedEnzymeNames")?;
            to_val(simulate_restriction_digest(&doc, &enzymes))
        }
        "compute_agarose_gel_physics" => {
            let sizes: Vec<usize> = parse_field(&payload, "fragmentSizesBp")?;
            let agarose_pct = f64_arg(&payload, "agarosePct", 1.0);
            let buffer_type = str_arg(&payload, "bufferType", "TAE");
            let gel_len_mm = f64_arg(&payload, "gelLengthMm", 80.0);
            to_val(compute_agarose_gel_band_physics(
                &sizes,
                agarose_pct,
                buffer_type,
                gel_len_mm,
            ))
        }
        "analyze_silent_mutations" => {
            let seq = str_arg(&payload, "seq", "");
            let max_candidates = usize_arg(&payload, "maxCandidates", 16);
            to_val(analyze_silent_mutations(seq, max_candidates))
        }
        "analyze_silent_mutations_in_cds" => {
            let seq = str_arg(&payload, "seq", "");
            let regions: Vec<CodingRegion1Based> = parse_field(&payload, "regions")?;
            let max_candidates = usize_arg(&payload, "maxCandidates", 16);
            to_val(analyze_silent_mutations_in_cds(seq, &regions, max_candidates))
        }
        "get_common_plasmid_features" => to_val(get_common_plasmid_features()),
        "detect_common_features" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            to_val(detect_common_features(&doc))
        }
        "calculate_primer_metrics" => {
            let seq = str_arg(&payload, "seq", "");
            let na_mm = f64_arg(&payload, "naMm", 50.0);
            let mg_mm = f64_arg(&payload, "mgMm", 1.5);
            let primer_nm = f64_arg(&payload, "primerNm", 250.0);
            to_val(calculate_primer_metrics(seq, na_mm, mg_mm, primer_nm))
        }
        "design_pcr_primers" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let region_start = usize_arg(&payload, "regionStart", 1);
            let region_end = usize_arg(&payload, "regionEnd", 500);
            let target_tm = f64_arg(&payload, "targetTm", 60.0);
            let fwd_tail = str_arg(&payload, "fwdTail5Prime", "");
            let rev_tail = str_arg(&payload, "revTail5Prime", "");
            let slack = usize_arg(&payload, "positionSlackBp", 0);
            to_val(design_pcr_primers_with_slack(
                &doc,
                region_start,
                region_end,
                target_tm,
                fwd_tail,
                rev_tail,
                slack,
            ))
        }
        "test_saved_primers" => {
            let seq = str_arg(&payload, "seq", "");
            let saved_primers: Vec<PrimerRecord> = parse_field(&payload, "savedPrimers")?;
            let max_mismatches = usize_arg(&payload, "maxMismatches", 2);
            to_val(test_saved_primers_on_sequence(
                seq,
                &saved_primers,
                max_mismatches,
            ))
        }
        "simulate_mutagenesis" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let mode = str_arg(&payload, "mode", "Substitution");
            let position_bp = usize_arg(&payload, "positionBp", 20);
            let replacement = str_arg(&payload, "replacementBases", "CAC");
            let deletion_len = usize_arg(&payload, "deletionLengthBp", 3);
            to_val(simulate_site_directed_mutagenesis(
                &doc,
                mode,
                position_bp,
                replacement,
                deletion_len,
            ))
        }
        "anneal_oligos" => {
            let duplex_name = str_arg(&payload, "duplexName", "Annealed_Oligo_Adapter");
            let top = str_arg(&payload, "topOligo5to3", "");
            let bottom = str_arg(&payload, "bottomOligo5to3", "");
            let phos = bool_arg(&payload, "phosphorylated5Prime", true);
            to_val(anneal_complementary_oligos(duplex_name, top, bottom, phos))
        }
        "compute_dna_ligation_calcs" => {
            let length_bp = usize_arg(&payload, "lengthBp", 3000);
            let conc = f64_arg(&payload, "concNgPerUl", 50.0);
            let vol = f64_arg(&payload, "volumeUl", 20.0);
            let vec_mass = f64_arg(&payload, "vectorMassNg", 50.0);
            let ins_len = usize_arg(&payload, "insertLengthBp", 720);
            to_val(compute_dna_and_ligation_calculations(
                length_bp, conc, vol, vec_mass, ins_len,
            ))
        }
        "predict_secondary_structure" => {
            let seq = str_arg(&payload, "seq", "");
            let molecule_type = str_arg(&payload, "moleculeType", "RNA");
            let temperature_c = f64_arg(&payload, "temperatureC", 37.0);
            let dangling_ends = bool_arg(&payload, "danglingEnds", true);
            let circular = bool_arg(&payload, "circular", false);
            to_val(predict_secondary_structure_with(
                seq,
                molecule_type,
                temperature_c,
                dangling_ends,
                circular,
            ))
        }
        "simulate_molecular_cloning" => {
            let vector_doc: SequenceDocument = parse_field(&payload, "vectorDoc")?;
            let insert_doc: SequenceDocument = parse_field(&payload, "insertDoc")?;
            let method = str_arg(&payload, "method", "restriction_ligation");
            let enz5 = str_arg(&payload, "enzyme5Prime", "EcoRI");
            let enz3 = str_arg(&payload, "enzyme3Prime", "XhoI");
            let gg_enz = str_arg(&payload, "goldenGateEnzyme", "BsaI-HFv2");
            to_val(simulate_molecular_cloning(
                &vector_doc,
                &insert_doc,
                method,
                enz5,
                enz3,
                gg_enz,
            ))
        }
        "set_circular_origin" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let new_origin = usize_arg(&payload, "newOrigin1Based", 1);
            to_val(set_circular_origin(&doc, new_origin))
        }
        "find_crispr_guides" => {
            let seq = str_arg(&payload, "seq", "");
            let nuclease = str_arg(&payload, "nuclease", "SpCas9 (NGG)");
            let max_results = usize_arg(&payload, "maxResults", 30);
            // A plasmid is read as the circle it is, so the guides across its origin are in the
            // reply (BG-01M6T6GQ). Older callers send no topology and get the straight read they
            // already got.
            let circular = bool_arg(&payload, "circular", false);
            to_val(find_crispr_guides_for_topology(
                seq,
                nuclease,
                max_results,
                circular,
            ))
        }
        "audit_sequence_alerts" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let cut_sites: Vec<RestrictionCutSite> = parse_field(&payload, "cutSites")?;
            let strain = str_arg(&payload, "strain", "DH5α (dam+ dcm+)");
            // A scan that kept only some of its sites (its `stoppedEarly`) makes the methylation
            // count a lower bound; older callers send no such key and audit the sites as all.
            let stopped_early = bool_arg(&payload, "scanStoppedEarly", false);
            to_val(audit_sequence_alerts_for_scan(&doc, &cut_sites, strain, stopped_early))
        }
        "get_modular_vector_parts" => to_val(get_modular_vector_parts()),
        "get_vector_catalog" => to_val(get_vector_catalog()),
        "get_vector_system_guides" => to_val(get_vector_system_guides()),
        "get_host_strain_guides" => to_val(get_host_strain_guides()),
        "get_origin_compatibility_groups" => to_val(get_origin_compatibility_groups()),
        "get_twist_antibiotic_standards" => to_val(get_twist_antibiotic_standards()),
        "get_cloning_action_vector_presets" => to_val(get_cloning_action_vector_presets()),
        "get_sample_library" => to_val(get_sample_library()),
        "generate_large_genome_benchmark" => {
            let length_bp = usize_arg(&payload, "lengthBp", 500_000);
            let preset = str_arg(&payload, "organismPreset", "Escherichia coli K-12");
            to_val(generate_large_genome_benchmark(length_bp, preset))
        }
        "generate_large_protein_benchmark" => {
            let length_aa = usize_arg(&payload, "lengthAa", 10_000);
            let preset = str_arg(&payload, "proteinPreset", "Titin_Ig_Polyprotein");
            to_val(generate_large_protein_benchmark(length_aa, preset))
        }
        "generate_safe_backbone_spacer" => {
            let length_bp = usize_arg(&payload, "lengthBp", 64);
            let seed = usize_arg(&payload, "seed", 17);
            Ok(Value::String(generate_safe_backbone_spacer(
                length_bp, seed,
            )))
        }
        "build_mcs_polylinker" => {
            let enzyme_names: Vec<String> = parse_field(&payload, "enzymeNames")?;
            Ok(Value::String(build_mcs_polylinker(&enzyme_names)))
        }
        "build_catalog_vector_document" => {
            let entry: CatalogVectorEntry = parse_field(&payload, "entry")?;
            to_val(build_catalog_vector_document(&entry))
        }
        "assemble_modular_custom_vector" => {
            let spec: ModularAssemblySpec = parse_field(&payload, "spec")?;
            to_val(assemble_modular_custom_vector(&spec))
        }
        "audit_twist_onboarding" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let site = usize_arg(&payload, "insertionSiteBp", 100);
            let vol = f64_arg(&payload, "dnaVolumeUl", 120.0);
            let conc = f64_arg(&payload, "dnaConcNgUl", 150.0);
            to_val(audit_twist_custom_vector_onboarding(&doc, site, vol, conc))
        }
        "simulate_twist_clonal_insertion" => {
            let vector_doc: SequenceDocument = parse_field(&payload, "vectorDoc")?;
            let site = usize_arg(&payload, "insertionSiteBp", 100);
            let insert_name = str_arg(&payload, "insertName", "Clonal_Gene_Insert");
            let insert_seq = str_arg(&payload, "insertSeqRaw", "");
            let framing = str_arg(&payload, "framingMode", "standard-scarless");
            to_val(simulate_twist_clonal_gene_insertion(
                &vector_doc,
                site,
                insert_name,
                insert_seq,
                framing,
            ))
        }
        "check_cotransformation" => {
            let vec_a: CatalogVectorEntry = parse_field(&payload, "vecA")?;
            let vec_b: CatalogVectorEntry = parse_field(&payload, "vecB")?;
            to_val(check_cotransformation_compatibility(&vec_a, &vec_b))
        }
        "generate_catalog_circular_svg" => {
            let entry: CatalogVectorEntry = parse_field(&payload, "entry")?;
            Ok(Value::String(generate_catalog_circular_svg(&entry)))
        }
        "export_vector_catalog_csv" => {
            let entries: Vec<CatalogVectorEntry> = parse_field(&payload, "entries")?;
            Ok(Value::String(export_vector_catalog_csv(&entries)))
        }
        "build_cloning_action_vector_document" => {
            let preset: CloningActionVectorPreset = parse_field(&payload, "preset")?;
            to_val(build_cloning_action_vector_document(&preset))
        }
        "concatenate_documents" => {
            let docs: Vec<SequenceDocument> = parse_field(&payload, "docs")?;
            let spacer = str_arg(&payload, "spacer", "");
            let res = concatenate_sequence_documents(&docs, spacer)?;
            to_val(res)
        }
        "generate_consensus_document" => {
            let docs: Vec<SequenceDocument> = parse_field(&payload, "docs")?;
            let threshold_pct = f64_arg(&payload, "thresholdPct", 75.0);
            let res = generate_consensus_document(&docs, threshold_pct)?;
            to_val(res)
        }
        "mask_sequence_regions" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let mode = str_arg(&payload, "mode", "selection");
            let range: Option<SelectionRange1Based> = parse_opt_field(&payload, "range")?;
            to_val(mask_sequence_regions(&doc, mode, range))
        }
        "extract_annotated_features" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let filter_type = str_arg(&payload, "filterType", "ALL");
            to_val(extract_annotated_features_to_documents(&doc, filter_type))
        }
        "convert_selection_to_oligo" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let range: Option<SelectionRange1Based> = parse_opt_field(&payload, "range")?;
            let strand = i32_arg(&payload, "strand", 1) as i8;
            to_val(convert_selection_to_oligo_primer(&doc, range, strand))
        }
        "annotate_gateway_att_sites" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            to_val(annotate_gateway_att_sites(&doc))
        }
        "add_attb_sites" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let range: Option<SelectionRange1Based> = parse_opt_field(&payload, "range")?;
            to_val(add_attb_sites_to_sequence(&doc, range))
        }
        "export_lineage_bundle_genbank" => {
            let target_doc: SequenceDocument = parse_field(&payload, "targetDoc")?;
            let all_docs: Vec<SequenceDocument> = parse_field(&payload, "allDocs")?;
            to_val(export_lineage_bundle_genbank(&target_doc, &all_docs))
        }
        "batch_modify_annotation_intervals" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let delta_start = isize_arg(&payload, "deltaStartBp", 0);
            let delta_end = isize_arg(&payload, "deltaEndBp", 0);
            to_val(batch_modify_annotation_intervals(
                &doc,
                delta_start,
                delta_end,
            ))
        }
        "batch_set_cds_translation" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            to_val(batch_set_cds_translation_property(&doc))
        }
        "randomly_sample_documents" => {
            let docs: Vec<SequenceDocument> = parse_field(&payload, "docs")?;
            let sample_size = usize_arg(&payload, "sampleSize", 5);
            let seed = usize_arg(&payload, "seed", 42) as u32;
            to_val(randomly_sample_documents(&docs, sample_size, seed))
        }
        "group_documents_by_prefix" => {
            let docs: Vec<SequenceDocument> = parse_field(&payload, "docs")?;
            to_val(group_documents_by_prefix(&docs))
        }

        // ─── 7. Resident Native/WASM Genome & Giant-Protein Store ───
        "ensure_resident_sequence" => {
            let doc_id = str_arg(&payload, "docId", "");
            if doc_id.is_empty() {
                return Err("Missing required 'docId' in ensure_resident_sequence".into());
            }
            let rev_key = str_arg(&payload, "revisionKey", "");
            let seq = str_arg(&payload, "seq", "");
            let features: Vec<SequenceFeature> =
                parse_opt_field(&payload, "features")?.unwrap_or_default();
            let is_rna = bool_arg(&payload, "isRna", false);
            let is_protein = bool_arg(&payload, "isProtein", false);
            let bins = usize_arg(&payload, "bins", 180);
            to_val(ensure_resident_sequence(
                doc_id,
                rev_key,
                seq,
                &features,
                is_rna,
                is_protein,
                bins,
            ))
        }
        "slice_resident_viewport" => {
            let doc_id = str_arg(&payload, "docId", "");
            let start_pos = usize_arg(&payload, "startPos", 1);
            let end_pos = usize_arg(&payload, "endPos", 1200);
            to_val(slice_resident_viewport(doc_id, start_pos, end_pos)?)
        }
        "get_resident_track_overview" => {
            let doc_id = str_arg(&payload, "docId", "");
            note_key("bins");
            let req_bins = payload
                .get("bins")
                .and_then(|x| x.as_u64().map(|n| n as usize));
            to_val(get_resident_track_overview(doc_id, req_bins)?)
        }
        "search_resident_motif_fmindex" => {
            let doc_id = str_arg(&payload, "docId", "");
            let pattern = str_arg(&payload, "pattern", "");
            let both_strands = bool_arg(&payload, "bothStrands", true);
            let max_hits = usize_arg(&payload, "maxHits", 500);
            to_val(search_resident_motif_fmindex(
                doc_id,
                pattern,
                both_strands,
                max_hits,
            )?)
        }
        "evict_resident_sequence" => {
            let doc_id = str_arg(&payload, "docId", "");
            to_val(evict_resident_sequence(doc_id))
        }
        "resident_store_stats" => to_val(resident_store_stats()),

        // ─── 8. Reference Databases, .mbc Checksum & Chromatogram Signal Engine ───
        "get_reference_database_categories" => to_val(get_reference_database_categories()),
        "get_curated_database_records" => to_val(get_curated_database_records()),
        "query_curated_database_records" => {
            let category = str_arg(&payload, "category", "");
            let query = str_arg(&payload, "query", "");
            to_val(query_curated_database_records(category, query))
        }
        "build_curated_database_document" => {
            let record_id = str_arg(&payload, "recordId", "");
            let ts = str_arg(&payload, "timestampIso", "");
            to_val(build_curated_database_document(record_id, ts))
        }
        "parse_remote_database_payload" => {
            let raw_text = str_arg(&payload, "rawText", "");
            let accession = str_arg(&payload, "accession", "REF_001");
            let is_protein_hint = bool_arg(&payload, "isProteinHint", false);
            let target_folder = str_arg(&payload, "targetFolder", "Sample Documents");
            to_val(parse_remote_database_payload(
                raw_text,
                accession,
                is_protein_hint,
                target_folder,
            ))
        }
        "compute_mbc_payload_checksum" => {
            let docs: Vec<MbcChecksumDocInput> = parse_field(&payload, "docs")?;
            to_val(compute_mbc_payload_checksum(&docs))
        }
        "compute_chromatogram_viewport" => {
            let chrom: ChromatogramData = parse_field(&payload, "chromatogram")?;
            let base_offset = usize_arg(&payload, "baseOffset", 0);
            let window_bases = usize_arg(&payload, "windowBases", 70);
            let raw_mode = bool_arg(&payload, "rawMode", false);
            let autoscaled = bool_arg(&payload, "autoscaled", true);
            let vertical_scale = f64_arg(&payload, "verticalScale", 1.0);
            let baseline_y = f64_arg(&payload, "baselineY", 175.0);
            let max_peak_height = f64_arg(&payload, "maxPeakHeight", 145.0);
            to_val(compute_chromatogram_viewport(
                &chrom,
                base_offset,
                window_bases,
                raw_mode,
                autoscaled,
                vertical_scale,
                baseline_y,
                max_peak_height,
            ))
        }

        // ─── 9. Guided Bioinformatics Pipelines, Reaction Buffers, Golden Gate & Macros ───
        "get_bio_pipeline_catalog" => to_val(get_bio_pipeline_catalog()),
        "execute_bio_pipeline_rust" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let pipeline_id = str_arg(&payload, "pipelineId", "cloning-expression-qc");
            let host_os = str_arg(&payload, "hostOS", "macos");
            let completed_at = str_arg(&payload, "completedAtIso", "2026-10-31T00:00:00Z");
            let report = execute_bio_pipeline_rust(&doc, pipeline_id, host_os, completed_at)
                .map_err(|e| e.to_string())?;
            to_val(report)
        }
        "evaluate_multi_digest_buffer_plan" => {
            let enzymes: Vec<String> = parse_field(&payload, "enzymes")?;
            to_val(evaluate_multi_digest_buffer_plan(&enzymes))
        }
        "evaluate_golden_gate_overhang_fidelity" => {
            let overhangs: Vec<String> = parse_field(&payload, "overhangs")?;
            to_val(evaluate_golden_gate_overhang_fidelity(&overhangs))
        }
        "analyze_gibson_overlap_junction" => {
            let overlap = str_arg(&payload, "overlapSeq", "");
            to_val(analyze_gibson_overlap_junction(overlap))
        }
        "execute_builtin_rust_workflow_macro" => {
            let macro_id = str_arg(&payload, "macroId", "");
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            Ok(execute_builtin_rust_workflow_macro(macro_id, &doc))
        }

        // ─── 10. Protein Motifs/Domains, 3D Structural Geometry, Minimizers & Coalescent ───
        "scan_protein_functional_motifs" => {
            let seq = str_arg(&payload, "proteinSeq", "");
            to_val(scan_protein_functional_motifs(seq))
        }
        "predict_signal_peptide_von_heijne" => {
            let seq = str_arg(&payload, "proteinSeq", "");
            to_val(predict_signal_peptide_von_heijne(seq))
        }
        "analyze_pdb_3d_geometry" => {
            let pdb = str_arg(&payload, "pdbOrCif", "");
            to_val(analyze_pdb_3d_geometry(pdb))
        }
        "compute_mash_minimizer_distance" => {
            let seq_a = str_arg(&payload, "seqA", "");
            let seq_b = str_arg(&payload, "seqB", "");
            let k = usize_arg(&payload, "k", 15);
            let w = usize_arg(&payload, "w", 5);
            let sketch_cap = usize_arg(&payload, "sketchCapacity", 1024);
            to_val(compute_mash_minimizer_distance(
                seq_a, seq_b, k, w, sketch_cap,
            ))
        }
        "map_long_read_minimizer_chains" => {
            let reference = str_arg(&payload, "referenceSeq", "");
            let reads: Vec<(String, String)> = parse_field(&payload, "reads")?;
            let k = usize_arg(&payload, "k", 13);
            let w = usize_arg(&payload, "w", 5);
            to_val(map_long_read_minimizer_chains(reference, &reads, k, w))
        }
        "profile_pangenome_core_accessory" => {
            let genomes: Vec<PangenomeGenomeInput> = parse_field(&payload, "genomes")?;
            let k = usize_arg(&payload, "k", 13);
            let w = usize_arg(&payload, "w", 5);
            to_val(profile_pangenome_core_accessory(&genomes, k, w))
        }
        "analyze_recombination_and_ld" => {
            let seqs: Vec<String> = parse_field(&payload, "alignedSeqs")?;
            to_val(analyze_recombination_and_ld(&seqs))
        }
        "run_mcdonald_kreitman_test" => {
            let ingroup: Vec<String> = parse_field(&payload, "ingroupCds")?;
            let outgroup = str_arg(&payload, "outgroupCds", "");
            to_val(run_mcdonald_kreitman_test(&ingroup, outgroup))
        }
        "compare_tree_topologies_robinson_foulds" => {
            let tree_a = str_arg(&payload, "newickA", "");
            let tree_b = str_arg(&payload, "newickB", "");
            to_val(compare_tree_topologies_robinson_foulds(tree_a, tree_b))
        }
        "scan_non_b_dna_structures" => {
            let seq = str_arg(&payload, "seq", "");
            let max_hits = usize_arg(&payload, "maxHits", 200);
            to_val(scan_non_b_dna_structures(seq, max_hits))
        }
        "profile_epigenetic_methylation_sites" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(profile_epigenetic_methylation_sites(seq))
        }
        "scan_sigma70_promoters" => {
            let seq = str_arg(&payload, "seq", "");
            let max_hits = usize_arg(&payload, "maxHits", 100);
            to_val(scan_sigma70_promoters(seq, max_hits))
        }
        "scan_rho_independent_terminators" => {
            let seq = str_arg(&payload, "seq", "");
            let max_hits = usize_arg(&payload, "maxHits", 100);
            to_val(scan_rho_independent_terminators(seq, max_hits))
        }
        "analyze_karlin_dinucleotide_islands" => {
            let seq = str_arg(&payload, "seq", "");
            let window_bp = usize_arg(&payload, "windowBp", 2000);
            to_val(analyze_karlin_dinucleotide_islands(seq, window_bp))
        }
        "compute_kmer_spectrum" => {
            let seq = str_arg(&payload, "seq", "");
            let k = usize_arg(&payload, "k", 6);
            to_val(compute_kmer_spectrum(seq, k))
        }
        "analyze_protein_disorder_aggregation_epitopes" => {
            let seq = str_arg(&payload, "proteinSeq", "");
            to_val(analyze_protein_disorder_aggregation_epitopes(seq))
        }

        // ─── 11. Noodles Genomic Pileup/VCF/Interval Algebra, Large-Genome Chaining & Proteomics MS ───
        "compute_sam_pileup_and_coverage_noodles" => {
            let ref_seq = str_arg(&payload, "referenceSeq", "");
            let sam_text = str_arg(&payload, "samText", "");
            let windows = usize_arg(&payload, "windowCount", 64);
            to_val(compute_sam_pileup_and_coverage_noodles(
                ref_seq, sam_text, windows,
            ))
        }
        "annotate_vcf_coding_consequences_noodles" => {
            let ref_seq = str_arg(&payload, "referenceSeq", "");
            let features: Vec<SequenceFeature> =
                parse_field(&payload, "features").unwrap_or_default();
            let vcf_text = str_arg(&payload, "vcfText", "");
            // read as translate_sequence reads `tableId` (a plain `as u8` wrapped 258 to table 2);
            // the reply is the report's own fields plus `warnings` (D0005)
            let (code_id, warnings) = genetic_code_arg(&payload, "geneticCodeId", 11);
            let mut reply = to_val(annotate_vcf_coding_consequences_noodles(
                ref_seq, &features, vcf_text, code_id,
            ))?;
            reply["warnings"] = json!(warnings);
            Ok(reply)
        }
        "intersect_genomic_intervals_noodles" => {
            let track_a = str_arg(&payload, "trackAText", "");
            let track_b = str_arg(&payload, "trackBText", "");
            note_key("referenceFasta");
            let ref_fasta = payload.get("referenceFasta").and_then(|v| v.as_str());
            let flank_bp = usize_arg(&payload, "flankBp", 0);
            to_val(intersect_genomic_intervals_noodles(
                track_a, track_b, ref_fasta, flank_bp,
            ))
        }
        "align_large_genomes_minimizer_chain" => {
            let target_seq = str_arg(&payload, "targetSeq", "");
            let query_seq = str_arg(&payload, "querySeq", "");
            let w = usize_arg(&payload, "windowW", 10);
            let k = usize_arg(&payload, "kmerK", 15);
            let max_occ = usize_arg(&payload, "maxSeedOccurrences", 64);
            to_val(align_large_genomes_minimizer_chain(
                target_seq, query_seq, w, k, max_occ,
            ))
        }
        "search_proteome_blosum62_hsps" => {
            let query_prot = str_arg(&payload, "queryProtein", "");
            let targets: Vec<ProteomeTargetRecord> =
                parse_field(&payload, "targets").unwrap_or_default();
            let word_len = usize_arg(&payload, "wordLen", 3);
            let e_cutoff = f64_arg(&payload, "evalueCutoff", 1e-2);
            to_val(search_proteome_blosum62_hsps(
                query_prot, &targets, word_len, e_cutoff,
            ))
        }
        "simulate_proteolytic_digest_ms" => {
            let prot = str_arg(&payload, "proteinSeq", "");
            let protease = str_arg(&payload, "protease", "Trypsin");
            let max_mc = usize_arg(&payload, "maxMissedCleavages", 1);
            let min_m = f64_arg(&payload, "minMassDa", 400.0);
            let max_m = f64_arg(&payload, "maxMassDa", 4500.0);
            let cam_cys = bool_arg(&payload, "carbamidomethylCys", true);
            to_val(simulate_proteolytic_digest_ms(
                prot, protease, max_mc, min_m, max_m, cam_cys,
            ))
        }
        "simulate_peptide_ms2_spectrum" => {
            let pep = str_arg(&payload, "peptideSeq", "");
            let cam_cys = bool_arg(&payload, "carbamidomethylCys", true);
            to_val(simulate_peptide_ms2_spectrum(pep, cam_cys))
        }
        "scan_post_translational_modifications" => {
            let prot = str_arg(&payload, "proteinSeq", "");
            let atoms: Option<Vec<PdbCaAtom>> = payload
                .get("pdbAtoms")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            to_val(scan_post_translational_modifications(
                prot,
                atoms.as_deref(),
            ))
        }

        // ─── 12. Viterbi HMM, JASPAR PSSM, SIMD Fuzzy Search, POA Contigs, Banded DP, Newick Layout, .mbc Codec & Table/Lineage Engine ───
        "segment_genome_hmm_viterbi" => {
            let seq = str_arg(&payload, "seq", "");
            to_val(segment_genome_hmm_viterbi(seq))
        }
        "scan_jaspar_pssm_motifs" => {
            let seq = str_arg(&payload, "seq", "");
            let min_rel = f64_arg(&payload, "minRelScore", 0.85);
            let custom_sites: Option<Vec<String>> = parse_opt_field(&payload, "customSites")?;
            to_val(scan_jaspar_pssm_motifs(
                seq,
                min_rel,
                custom_sites.as_deref(),
            ))
        }
        "scan_fuzzy_subsequence_simd" => {
            let seq = str_arg(&payload, "seq", "");
            let pattern = str_arg(&payload, "pattern", "");
            let max_edits = usize_arg(&payload, "maxEdits", 2) as u32;
            let both_strands = bool_arg(&payload, "bothStrands", true);
            let max_hits = usize_arg(&payload, "maxHits", 100);
            to_val(scan_fuzzy_subsequence_simd(
                seq,
                pattern,
                max_edits,
                both_strands,
                max_hits,
            ))
        }
        "is_mbc_file_or_payload_rust" => {
            let file_name = str_arg(&payload, "fileName", "");
            note_key("rawText");
            let raw_text = payload.get("rawText").and_then(Value::as_str);
            to_val(is_mbc_file_or_payload_rust(file_name, raw_text))
        }
        "serialize_mbc_workbench_rust" => {
            let snapshot: MbcWorkbenchSnapshotInput = parse_field(&payload, "snapshot")?;
            let app_version = str_arg(&payload, "appVersion", "1.0.0");
            let saved_at = str_arg(&payload, "savedAtIso", "2026-10-31T08:00:00.000Z");
            Ok(Value::String(serialize_mbc_workbench_rust(
                &snapshot,
                app_version,
                saved_at,
            )))
        }
        "parse_mbc_workbench_rust" => {
            let raw_text = str_arg(&payload, "rawText", "");
            let fallback = str_arg(&payload, "fallbackSessionName", "Imported_Session");
            let now_iso = str_arg(&payload, "nowIso", "2026-10-31T08:00:00.000Z");
            let res = parse_mbc_workbench_rust(raw_text, fallback, now_iso)?;
            to_val(res)
        }
        "trim_sanger_trace_mott_phred" => {
            let chrom: ChromatogramData = parse_field(&payload, "chromatogram")?;
            let cutoff = f64_arg(&payload, "errorCutoff", 0.05);
            to_val(trim_sanger_trace_mott_phred(&chrom, cutoff))
        }
        "build_ncbi_reference_preset_document" => {
            let preset = str_arg(&payload, "preset", "spike");
            let now_iso = str_arg(&payload, "nowIso", "2026-10-31T08:00:00.000Z");
            to_val(build_ncbi_reference_preset_document(preset, now_iso))
        }
        "assemble_sanger_contig_poa" => {
            let reads: Vec<PoaReadInput> = parse_field(&payload, "reads")?;
            let contig_name = str_arg(&payload, "contigName", "POA_Consensus_Contig");
            let trim_hq = bool_arg(&payload, "trimLowQuality", true);
            to_val(assemble_sanger_contig_poa(&reads, contig_name, trim_hq))
        }
        "align_pairwise_banded_sparse" => {
            let seq1 = str_arg(&payload, "seq1", "");
            let seq2 = str_arg(&payload, "seq2", "");
            let mode = str_arg(&payload, "mode", "global");
            let k = usize_arg(&payload, "k", 6);
            let w = usize_arg(&payload, "w", 24);
            let match_score = i32_arg(&payload, "matchScore", 2);
            let mismatch_score = i32_arg(&payload, "mismatchScore", -1);
            let gap_open = i32_arg(&payload, "gapOpen", -5);
            let gap_extend = i32_arg(&payload, "gapExtend", -1);
            let max_len = usize_arg(&payload, "maxLen", 25_000);
            // the alignment's fields with `warnings` naming any input the maxLen cap cut (BG-01M6S17Y)
            to_val(align_pairwise_banded_sparse_with_warnings(
                seq1,
                seq2,
                mode,
                k,
                w,
                match_score,
                mismatch_score,
                gap_open,
                gap_extend,
                max_len,
            ))
        }
        "layout_newick_phylogenetic_tree" => {
            let newick = str_arg(&payload, "newick", "");
            let style = str_arg(&payload, "style", "phylogram");
            let width = f64_arg(&payload, "width", 800.0);
            let height = f64_arg(&payload, "height", 320.0);
            to_val(layout_newick_phylogenetic_tree(newick, style, width, height))
        }
        "compute_document_table_metrics_rust" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            to_val(compute_document_table_metrics_rust(&doc))
        }
        "export_table_delimited_csv_rust" => {
            let headers: Vec<String> = parse_field(&payload, "headers")?;
            let rows: Vec<Vec<String>> = parse_field(&payload, "rows")?;
            let delimiter = str_arg(&payload, "delimiter", ",");
            Ok(Value::String(export_table_delimited_csv_rust(
                &headers, &rows, delimiter,
            )))
        }
        "extract_region_with_annotations_rust" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let start = usize_arg(&payload, "start1Based", 1);
            let end = usize_arg(&payload, "end1Based", doc.sequence.len().max(1));
            let now_iso = str_arg(&payload, "nowIso", "2026-10-31T08:00:00.000Z");
            to_val(extract_region_with_annotations_rust(&doc, start, end, now_iso))
        }
        "splice_modular_part_into_document_rust" => {
            let doc: SequenceDocument = parse_field(&payload, "doc")?;
            let part: ModularVectorPart = parse_field(&payload, "part")?;
            let pos = usize_arg(&payload, "positionBp", 1);
            let now_iso = str_arg(&payload, "nowIso", "2026-10-31T08:00:00.000Z");
            to_val(splice_modular_part_into_document_rust(&doc, &part, pos, now_iso))
        }
        "build_construct_lineage_dag_rust" => {
            let target_doc: SequenceDocument = parse_field(&payload, "targetDoc")?;
            let all_docs: Vec<SequenceDocument> =
                parse_opt_field(&payload, "allDocs")?.unwrap_or_default();
            to_val(build_construct_lineage_dag_rust(&target_doc, &all_docs))
        }
        "get_builtin_workflow_macros_rust" => to_val(get_builtin_workflow_macros_rust()),
        "calculate_primer_thermodynamics_santalucia" => {
            let seq = str_arg(&payload, "seq", "");
            let na_mm = f64_arg(&payload, "naMm", 50.0);
            let mg_mm = f64_arg(&payload, "mgMm", 1.5);
            let primer_nm = f64_arg(&payload, "primerNm", 250.0);
            to_val(calculate_primer_thermodynamics_santalucia(
                seq, na_mm, mg_mm, primer_nm,
            ))
        }

        unknown => Err(format!(
            "Unknown MolBioCraft Rust bioinformatics RPC operation: '{}'",
            unknown
        )),
    }
}

// ============================================================================
// Zero-Import WebAssembly Linear-Memory Scratch & C-ABI Exports
// ============================================================================

thread_local! {
    static IN_SCRATCH: RefCell<Vec<u8>> = RefCell::new(Vec::with_capacity(64 * 1024));
    static OUT_SCRATCH: RefCell<Vec<u8>> = RefCell::new(Vec::with_capacity(128 * 1024));
    static LAST_OUT_LEN: Cell<usize> = const { Cell::new(0) };
    static LAST_IS_ERR: Cell<u32> = const { Cell::new(0) };
}

fn execute_slice_to_out_scratch(op_bytes: &[u8], payload_bytes: &[u8]) -> *const u8 {
    let outcome: Result<Value, String> = (|| {
        let op_str = std::str::from_utf8(op_bytes)
            .map_err(|e| format!("Invalid UTF-8 op name: {}", e))?;
        let payload_val: Value = if payload_bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(payload_bytes)
                .map_err(|e| format!("Invalid JSON payload for '{}': {}", op_str, e))?
        };
        dispatch_bio_rpc(op_str, payload_val)
    })();

    OUT_SCRATCH.with(|cell| {
        let mut buf = cell.borrow_mut();
        buf.clear();
        match outcome {
            Ok(val) => {
                if serde_json::to_writer(&mut *buf, &val).is_err() {
                    buf.clear();
                    buf.extend_from_slice(b"Failed to serialize RPC response");
                    LAST_IS_ERR.with(|c| c.set(1));
                } else {
                    LAST_IS_ERR.with(|c| c.set(0));
                }
            }
            Err(err_msg) => {
                buf.extend_from_slice(err_msg.as_bytes());
                LAST_IS_ERR.with(|c| c.set(1));
            }
        }
        // Shrink huge one-off multi-megabase allocations back to 1 MiB resting cap
        let len = buf.len();
        LAST_OUT_LEN.with(|c| c.set(len));
        buf.as_ptr()
    })
}

/// Ensures the reusable input scratch buffer in WASM linear memory has at least `min_cap` bytes
/// and returns its base pointer so JS `TextEncoder.encodeInto` can write `op` + `payload` directly
/// with zero per-call heap allocations.
#[no_mangle]
pub extern "C" fn mbc_wasm_scratch_ptr(min_cap: usize) -> *mut u8 {
    IN_SCRATCH.with(|cell| {
        let mut buf = cell.borrow_mut();
        let req = min_cap.max(64);
        if buf.len() < req {
            buf.resize(req, 0);
        } else if buf.capacity() > 4 * 1024 * 1024 && req < 256 * 1024 {
            buf.truncate(256 * 1024);
            buf.shrink_to_fit();
        }
        buf.as_mut_ptr()
    })
}

/// Executes an RPC call reading `op` from `IN_SCRATCH[0..op_len]` and JSON `payload` from
/// `IN_SCRATCH[op_len..op_len + payload_len]`, writing the JSON response (or UTF-8 error string)
/// into `OUT_SCRATCH` and returning its pointer.
#[no_mangle]
pub extern "C" fn mbc_wasm_invoke_scratch(op_len: usize, payload_len: usize) -> *const u8 {
    let (op_copy, payload_copy) = IN_SCRATCH.with(|cell| {
        let buf = cell.borrow();
        let total = op_len.saturating_add(payload_len).min(buf.len());
        let safe_op = op_len.min(total);
        (
            buf[..safe_op].to_vec(),
            buf[safe_op..total].to_vec(),
        )
    });
    execute_slice_to_out_scratch(&op_copy, &payload_copy)
}

#[no_mangle]
pub extern "C" fn mbc_wasm_alloc(size: usize) -> *mut u8 {
    let eff = size.max(1);
    let Ok(layout) = Layout::from_size_align(eff, 8) else {
        return std::ptr::null_mut();
    };
    // SAFETY: `eff >= 1` and alignment is a power of two.
    unsafe { alloc(layout) }
}

/// Free a buffer allocated by [`mbc_wasm_alloc`].
///
/// # Safety
/// `ptr` must be null or a pointer returned by `mbc_wasm_alloc(size)` that has
/// not been freed yet.
#[no_mangle]
pub unsafe extern "C" fn mbc_wasm_dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    let eff = size.max(1);
    if let Ok(layout) = Layout::from_size_align(eff, 8) {
        // SAFETY: pointer and size match `mbc_wasm_alloc`.
        unsafe { dealloc(ptr, layout) };
    }
}

/// Run one RPC operation on UTF-8 `op` / JSON `payload` buffers in linear memory.
///
/// # Safety
/// `op_ptr..op_ptr+op_len` and `payload_ptr..payload_ptr+payload_len` must be
/// readable bytes in this module's linear memory (or the pointers null).
#[no_mangle]
pub unsafe extern "C" fn mbc_wasm_invoke(
    op_ptr: *const u8,
    op_len: usize,
    payload_ptr: *const u8,
    payload_len: usize,
) -> *const u8 {
    if op_ptr.is_null() {
        return execute_slice_to_out_scratch(b"", b"");
    }
    // SAFETY: caller provides valid linear-memory pointers and byte lengths.
    let op_slice = unsafe { std::slice::from_raw_parts(op_ptr, op_len) };
    let payload_slice = if payload_ptr.is_null() || payload_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) }
    };
    execute_slice_to_out_scratch(op_slice, payload_slice)
}

#[no_mangle]
pub extern "C" fn mbc_wasm_last_len() -> usize {
    LAST_OUT_LEN.with(Cell::get)
}

#[no_mangle]
pub extern "C" fn mbc_wasm_last_is_err() -> u32 {
    LAST_IS_ERR.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatches_end_to_end_across_all_six_bioinformatics_crates() {
        let diag = dispatch_bio_rpc("engine_diagnostics", Value::Null).unwrap();
        assert_eq!(
            diag["engine"],
            "MolBioCraft Rust Bioinformatics Workspace"
        );

        let rc = dispatch_bio_rpc(
            "reverse_complement",
            json!({ "seq": "GAATTCATGGTG", "isRna": false }),
        )
        .unwrap();
        assert_eq!(rc.as_str().unwrap(), "CACCATGAATTC");

        let aln = dispatch_bio_rpc(
            "align_pairwise",
            json!({
                "seq1": "GAATTCATGGTGAGCAAGGGCGAGGAG",
                "seq2": "GAATTCATGGTGTGCAAGGGCGAGGAG",
                "local": false
            }),
        )
        .unwrap();
        assert_eq!(aln["mismatches"], 1);

        let pdb_a = dispatch_bio_rpc(
            "synthesize_folded_pdb",
            json!({
                "proteinSeq": "MVSKGEELFTGVVPILVELDGDVNGHKFSV",
                "chainId": "A",
                "perturbationAngstrom": 0.0
            }),
        )
        .unwrap();
        let pdb_b = dispatch_bio_rpc(
            "synthesize_folded_pdb",
            json!({
                "proteinSeq": "MVSKGEELFTGVVPILVELDGDVNGHKFSV",
                "chainId": "B",
                "perturbationAngstrom": 0.6
            }),
        )
        .unwrap();
        let kabsch = dispatch_bio_rpc(
            "align_pdb_kabsch",
            json!({ "pdbA": pdb_a, "pdbB": pdb_b }),
        )
        .unwrap();
        assert_eq!(kabsch["alignedResiduePairs"], 30);
        assert!(kabsch["rmsdAngstrom"].as_f64().unwrap() < 1.5);

        let enzymes = dispatch_bio_rpc("get_rebase_enzymes", Value::Null).unwrap();
        assert!(enzymes.as_array().unwrap().len() >= 120);

        let catalog = dispatch_bio_rpc("get_vector_catalog", Value::Null).unwrap();
        assert_eq!(catalog.as_array().unwrap().len(), 69);
    }

    #[test]
    fn scratch_c_abi_roundtrip_works_without_leaks() {
        let op = b"clean_sequence";
        let payload = br#"{"seq":"123 gaattc-atg 456"}"#;
        let ptr = mbc_wasm_scratch_ptr(op.len() + payload.len());
        unsafe {
            std::ptr::copy_nonoverlapping(op.as_ptr(), ptr, op.len());
            std::ptr::copy_nonoverlapping(payload.as_ptr(), ptr.add(op.len()), payload.len());
        }
        let out_ptr = mbc_wasm_invoke_scratch(op.len(), payload.len());
        assert_eq!(mbc_wasm_last_is_err(), 0);
        let out_slice = unsafe { std::slice::from_raw_parts(out_ptr, mbc_wasm_last_len()) };
        assert_eq!(std::str::from_utf8(out_slice).unwrap(), "\"GAATTC-ATG\"");
    }

    /// Two models; label chain A is author chain X (numbered from 10), and the water has a label
    /// chain of its own on the same author chain.
    const TWO_MODEL_CIF: &str = concat!(
        "data_T\n",
        "loop_\n",
        "_atom_site.group_PDB\n",
        "_atom_site.id\n",
        "_atom_site.type_symbol\n",
        "_atom_site.label_atom_id\n",
        "_atom_site.label_alt_id\n",
        "_atom_site.label_comp_id\n",
        "_atom_site.label_asym_id\n",
        "_atom_site.label_seq_id\n",
        "_atom_site.pdbx_PDB_ins_code\n",
        "_atom_site.Cartn_x\n",
        "_atom_site.Cartn_y\n",
        "_atom_site.Cartn_z\n",
        "_atom_site.occupancy\n",
        "_atom_site.B_iso_or_equiv\n",
        "_atom_site.auth_seq_id\n",
        "_atom_site.auth_asym_id\n",
        "_atom_site.pdbx_PDB_model_num\n",
        "ATOM 1 N N . MET A 1 ? 11.104 6.134 -6.504 1.00 21.69 10 X 1\n",
        "ATOM 2 C CA . MET A 1 ? 10.120 12.450 8.300 0.90 92.40 10 X 1\n",
        "HETATM 3 O O . HOH B . ? 1.000 2.000 3.000 1.00 30.00 101 X 1\n",
        "ATOM 4 N N . MET A 1 ? 11.200 6.200 -6.600 1.00 21.69 10 X 2\n",
        "ATOM 5 C CA . MET A 1 ? 10.300 12.500 8.400 1.00 92.40 10 X 2\n",
    );

    #[test]
    fn parse_structure_op_returns_the_full_atom_model() {
        let s = dispatch_bio_rpc("parse_structure", json!({ "text": TWO_MODEL_CIF })).unwrap();
        let models = s["models"].as_array().expect("models");
        assert_eq!(models.len(), 2);
        assert_eq!((models[0]["modelNum"].clone(), models[1]["modelNum"].clone()), (json!(1), json!(2)));
        assert_eq!(models[0]["atomRecordCount"], 2);
        assert_eq!(models[0]["hetatmRecordCount"], 1);

        let chains = models[0]["chains"].as_array().expect("chains");
        let ids: Vec<(&str, &str)> = chains
            .iter()
            .map(|c| (c["labelAsymId"].as_str().unwrap(), c["authAsymId"].as_str().unwrap()))
            .collect();
        assert_eq!(ids, vec![("A", "X"), ("B", "X")]);

        let met = &chains[0]["residues"][0];
        assert_eq!(met["resName"], "MET");
        assert_eq!(met["labelSeqId"], 1);
        assert_eq!(met["authSeqId"], 10);
        assert_eq!(met["insCode"], Value::Null);
        let ca = &met["atoms"][1];
        assert_eq!(
            ca,
            &json!({
                "serial": 2, "name": "CA", "element": "C", "altLoc": null,
                "x": 10.12, "y": 12.45, "z": 8.3, "occupancy": 0.9, "bFactor": 92.4, "record": "ATOM"
            })
        );
        let water = &chains[1]["residues"][0];
        assert_eq!((water["resName"].as_str(), water["labelSeqId"].clone()), (Some("HOH"), Value::Null));
        assert_eq!(water["atoms"][0]["record"], "HETATM");
        assert_eq!(models[1]["chains"][0]["residues"][0]["atoms"][1]["x"], 10.3);
        assert_eq!(s["helices"], json!([]));
        assert_eq!(s["strands"], json!([]));

        // parse_pdb_ca on the same text is the first model's C-alpha list.
        let ca_list = dispatch_bio_rpc("parse_pdb_ca", json!({ "pdbText": TWO_MODEL_CIF })).unwrap();
        let ca_list = ca_list.as_array().expect("C-alpha list");
        assert_eq!(ca_list.len(), 1);
        assert_eq!((ca_list[0]["chainId"].clone(), ca_list[0]["x"].clone()), (json!("A"), json!(10.12)));

        // Errors reach the caller by name instead of an empty model.
        // Renaming the header leaves the values in place but no Cartn_x column.
        let no_x = TWO_MODEL_CIF.replace("_atom_site.Cartn_x\n", "_atom_site.pdbx_unnamed\n");
        for op in ["parse_structure", "parse_pdb_ca"] {
            let key = if op == "parse_structure" { "text" } else { "pdbText" };
            let err = dispatch_bio_rpc(op, json!({ key: no_x })).unwrap_err();
            assert!(err.contains("_atom_site.Cartn_x"), "{op}: {err}");
        }
        let err = dispatch_bio_rpc("parse_structure", json!({})).unwrap_err();
        assert!(err.contains("'text'"), "{err}");
    }

    /// `align_pdb_kabsch` takes optional `chainA` / `chainB` ids next to `pdbA` / `pdbB`, and
    /// reports the chains, the pairing and the 4x4 matrix it superposed with.
    #[test]
    fn align_pdb_kabsch_superposes_the_named_chains() {
        let fold = |seq: &str, chain: &str| -> String {
            let pdb = dispatch_bio_rpc(
                "synthesize_folded_pdb",
                json!({ "proteinSeq": seq, "chainId": chain, "perturbationAngstrom": 0.0 }),
            )
            .unwrap();
            pdb.as_str().unwrap().to_string()
        };
        let gfp = "MVSKGEELFTGVVPILVELDGDVNGHKFSV";
        let lyz = "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKF";
        let two_chains = fold(gfp, "A") + &fold(lyz, "B");
        let lyz_alone = fold(lyz, "Q");

        let named = dispatch_bio_rpc(
            "align_pdb_kabsch",
            json!({ "pdbA": two_chains, "pdbB": lyz_alone, "chainA": "B", "chainB": "Q" }),
        )
        .unwrap();
        assert_eq!((named["chainA"].as_str(), named["chainB"].as_str()), (Some("B"), Some("Q")));
        assert_eq!(named["alignedResiduePairs"], 34);
        assert!(named["rmsdAngstrom"].as_f64().unwrap() < 0.01, "{}", named["rmsdAngstrom"]);
        assert_eq!(named["sequenceIdentity"], 1.0);
        assert_eq!(named["alignedSequenceA"], lyz);
        assert!(named["pairingMethod"].as_str().unwrap().contains("BLOSUM62"));
        let t = named["transformationMatrix"].as_array().expect("4x4 matrix");
        assert_eq!(t.len(), 4);
        assert_eq!(t[3], json!([0.0, 0.0, 0.0, 1.0]));

        // The existing payload (no chain keys) still works: each structure's first chain.
        let default = dispatch_bio_rpc("align_pdb_kabsch", json!({ "pdbA": two_chains, "pdbB": lyz_alone })).unwrap();
        assert_eq!(default["chainA"], "A");
        let blank = dispatch_bio_rpc(
            "align_pdb_kabsch",
            json!({ "pdbA": two_chains, "pdbB": lyz_alone, "chainA": "", "chainB": null }),
        )
        .unwrap();
        assert_eq!(blank["chainA"], "A");

        // An absent chain, a chain id that is not a string, or no structure is an error by name.
        let err = dispatch_bio_rpc("align_pdb_kabsch", json!({ "pdbA": two_chains, "pdbB": lyz_alone, "chainA": "Z" }))
            .unwrap_err();
        assert!(err.contains("'Z'") && err.contains("A, B"), "{err}");
        let err = dispatch_bio_rpc("align_pdb_kabsch", json!({ "pdbA": two_chains, "pdbB": lyz_alone, "chainB": 5 }))
            .unwrap_err();
        assert!(err.contains("chainB"), "{err}");
        let err = dispatch_bio_rpc("align_pdb_kabsch", json!({ "pdbA": "", "pdbB": lyz_alone })).unwrap_err();
        assert!(err.contains("Structure A holds no Cα atoms"), "{err}");
    }

    // ---- US01M6PB2V: backbone torsions ----

    /// N, CA and C of residues 1-4 of RCSB 1UBQ chain A (coordinates as deposited), plus a water
    /// filed under the same author chain.
    const UBQ_1_TO_4_CIF: &str = concat!(
        "data_1UBQ\n",
        "loop_\n",
        "_atom_site.group_PDB\n",
        "_atom_site.id\n",
        "_atom_site.label_atom_id\n",
        "_atom_site.label_comp_id\n",
        "_atom_site.label_asym_id\n",
        "_atom_site.label_seq_id\n",
        "_atom_site.Cartn_x\n",
        "_atom_site.Cartn_y\n",
        "_atom_site.Cartn_z\n",
        "_atom_site.auth_seq_id\n",
        "_atom_site.auth_asym_id\n",
        "ATOM 1 N MET A 1 27.340 24.430 2.614 1 A\n",
        "ATOM 2 CA MET A 1 26.266 25.413 2.842 1 A\n",
        "ATOM 3 C MET A 1 26.913 26.639 3.531 1 A\n",
        "ATOM 9 N GLN A 2 26.335 27.770 3.258 2 A\n",
        "ATOM 10 CA GLN A 2 26.850 29.021 3.898 2 A\n",
        "ATOM 11 C GLN A 2 26.100 29.253 5.202 2 A\n",
        "ATOM 18 N ILE A 3 26.849 29.656 6.217 3 A\n",
        "ATOM 19 CA ILE A 3 26.235 30.058 7.497 3 A\n",
        "ATOM 20 C ILE A 3 26.882 31.428 7.862 3 A\n",
        "ATOM 26 N PHE A 4 26.214 32.097 8.771 4 A\n",
        "ATOM 27 CA PHE A 4 26.772 33.436 9.197 4 A\n",
        "ATOM 28 C PHE A 4 27.151 33.362 10.650 4 A\n",
        "HETATM 603 O HOH B . 27.000 20.000 3.000 77 A\n",
    );

    /// `backbone_torsions` takes `text` (mmCIF) and an optional `chain`, and returns each polymer
    /// residue's phi/psi (null where undefined), class and region, with counts per region. The
    /// angles are Biopython's for these residues of 1UBQ (test-data reference, to 0.1 degree).
    #[test]
    fn backbone_torsions_op_returns_phi_psi() {
        let out = dispatch_bio_rpc("backbone_torsions", json!({ "text": UBQ_1_TO_4_CIF, "chain": "A" })).unwrap();
        assert_eq!(out["chain"], "A");
        let res = out["residues"].as_array().expect("residues");
        let names: Vec<&str> = res.iter().map(|r| r["resName"].as_str().unwrap()).collect();
        assert_eq!(names, ["MET", "GLN", "ILE", "PHE"], "polymer residues only, in order");
        let near = |v: &Value, want: f64| (v.as_f64().unwrap_or(f64::NAN) - want).abs() <= 0.1;
        assert!(res[0]["phi"].is_null() && res[3]["psi"].is_null(), "no phi first, no psi last");
        assert!(near(&res[0]["psi"], 149.63), "{}", res[0]["psi"]);
        assert!(near(&res[1]["phi"], -91.02) && near(&res[1]["psi"], 138.26), "{}", res[1]);
        assert!(near(&res[2]["phi"], -131.10) && near(&res[2]["psi"], 163.05), "{}", res[2]);
        assert!(near(&res[3]["phi"], -115.99), "{}", res[3]);
        assert_eq!((res[1]["authSeqId"].clone(), res[1]["chain"].clone()), (json!(2), json!("A")));
        assert_eq!((res[1]["ramachandranClass"].clone(), res[1]["region"].clone()), (json!("general"), json!("favoured")));
        assert_eq!((res[2]["ramachandranClass"].clone(), res[2]["region"].clone()), (json!("ile-val"), json!("favoured")));
        assert!(res[0]["region"].is_null() && res[3]["region"].is_null());
        assert_eq!(out["counts"], json!({ "favoured": 2, "allowed": 0, "outlier": 0, "unclassified": 2 }));
        assert_eq!(out["chainBreaks"], 0);
        assert_eq!(out["peptideBondMaxAngstrom"], 1.8);
        assert!(out["regionRule"].as_str().unwrap().contains("Top8000"), "{}", out["regionRule"]);

        // No chain key, null or "" takes the first protein chain.
        for payload in [json!({ "text": UBQ_1_TO_4_CIF }), json!({ "text": UBQ_1_TO_4_CIF, "chain": null }), json!({ "text": UBQ_1_TO_4_CIF, "chain": "" })] {
            assert_eq!(dispatch_bio_rpc("backbone_torsions", payload).unwrap()["residues"], out["residues"]);
        }
        // Errors name what is wrong: no text, a chain id that is not a string, a chain not there.
        let err = dispatch_bio_rpc("backbone_torsions", json!({})).unwrap_err();
        assert!(err.contains("'text'"), "{err}");
        let err = dispatch_bio_rpc("backbone_torsions", json!({ "text": UBQ_1_TO_4_CIF, "chain": 5 })).unwrap_err();
        assert!(err.contains("chain"), "{err}");
        let err = dispatch_bio_rpc("backbone_torsions", json!({ "text": UBQ_1_TO_4_CIF, "chain": "Z" })).unwrap_err();
        assert!(err.contains("'Z'") && err.contains("protein chains: A"), "{err}");
        // Both payload keys are read by the dispatcher.
        let (_, keys) = keys_read_by(|| dispatch_bio_rpc("backbone_torsions", json!({ "text": UBQ_1_TO_4_CIF, "chain": "A" })));
        assert!(keys.contains(&"text".to_string()) && keys.contains(&"chain".to_string()), "{keys:?}");
    }

    // ---- US01M6P2A3 round 2 ----

    /// Two chains whose global alignment pairs no residue still give a report, not an error: the
    /// studio calls `align_pdb_kabsch` while rendering, where an error reaches the error boundary.
    /// Poly-Trp against poly-Pro: eight W/P pairs score 8 * -4 = -32, two eight-residue gaps
    /// 2 * (-10 - 7 * 0.5) = -27, so the alignment is all gaps. The report has no pairs, leaves B
    /// where it is, gives every number as a finite number (serde writes NaN as null) and says why.
    #[test]
    fn align_pdb_kabsch_reports_chains_that_pair_no_residues() {
        let fold = |seq: &str, chain: &str| -> String {
            let pdb = dispatch_bio_rpc(
                "synthesize_folded_pdb",
                json!({ "proteinSeq": seq, "chainId": chain, "perturbationAngstrom": 0.0 }),
            )
            .unwrap();
            pdb.as_str().unwrap().to_string()
        };
        let (trp, pro) = (fold("WWWWWWWW", "A"), fold("PPPPPPPP", "B"));
        let r = dispatch_bio_rpc("align_pdb_kabsch", json!({ "pdbA": trp, "pdbB": pro }))
            .unwrap_or_else(|e| panic!("a report, not an error: {e}"));

        assert_eq!(r["alignedResiduePairs"], 0);
        assert_eq!((r["atomsModelA"].as_u64(), r["atomsModelB"].as_u64()), (Some(8), Some(8)));
        // The two gaps may come in either order; no column holds two residues.
        let (row_a, row_b) = (r["alignedSequenceA"].as_str().unwrap(), r["alignedSequenceB"].as_str().unwrap());
        assert_eq!((row_a.replace('-', ""), row_b.replace('-', "")), ("WWWWWWWW".into(), "PPPPPPPP".into()));
        assert!(row_a.chars().zip(row_b.chars()).all(|(x, y)| x == '-' || y == '-'), "{row_a} / {row_b}");
        for key in ["rmsdAngstrom", "tmScore", "sequenceIdentity", "alignmentScore"] {
            assert!(r[key].as_f64().is_some_and(f64::is_finite), "{key} is {}", r[key]);
        }
        assert_eq!(r["alignmentScore"], -27.0);
        assert_eq!(r["perResidueDeviations"], json!([]));
        let identity = json!([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]);
        assert_eq!(r["transformationMatrix"], identity, "B is not moved");
        let as_read = dispatch_bio_rpc("parse_pdb_ca", json!({ "pdbText": pro })).unwrap();
        let xyz = |v: &Value| -> Vec<(f64, f64, f64)> {
            v.as_array().unwrap().iter().map(|a| (a["x"].as_f64().unwrap(), a["y"].as_f64().unwrap(), a["z"].as_f64().unwrap())).collect()
        };
        assert_eq!(xyz(&r["superimposedAtomsB"]), xyz(&as_read), "B is where its file puts it");
        let verdict = r["structuralSimilarityVerdict"].as_str().unwrap();
        assert!(verdict.contains("pairs no residues") && verdict.contains("chain A") && verdict.contains("chain B"), "{verdict}");
    }

    // ---- US01M6PBV4: TM-score structure alignment ----

    /// `align_structures_tm` reads `pdbA` / `pdbB` and the optional `chainA` / `chainB` as
    /// `align_pdb_kabsch` does, and returns exactly the report the crate function gives: both
    /// TM-scores with their d0, the RMSD, the aligned length, the two alignment strings, the
    /// identity and the 4x4 matrix.
    #[test]
    fn align_structures_tm_op_returns_scores() {
        use molbiocraft_protein::structure_align::align_structures_tm;
        let fold = |seq: &str, chain: &str, jitter: f64| -> String {
            synthesize_folded_pdb_from_protein(seq, chain, jitter)
        };
        let gfp = "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTL";
        let lyz = "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWW";
        let two_chains = fold(gfp, "A", 0.0) + &fold(lyz, "B", 0.0);
        // The same fold perturbed, without its first three residues.
        let mut atoms_seen = 0;
        let other: String = fold(lyz, "Q", 0.8)
            .lines()
            .filter(|l| {
                atoms_seen += usize::from(l.starts_with("ATOM"));
                !(l.starts_with("ATOM") && atoms_seen <= 3)
            })
            .map(|l| format!("{l}\n"))
            .collect();

        let payload = json!({ "pdbA": two_chains, "pdbB": other, "chainA": "B", "chainB": "Q" });
        let (via_rpc, keys) = keys_read_by(|| dispatch_bio_rpc("align_structures_tm", payload));
        let via_rpc = via_rpc.unwrap();
        assert_eq!(keys, ["pdbA", "pdbB", "chainA", "chainB"]);
        let direct = align_structures_tm(&two_chains, &other, Some("B"), Some("Q")).unwrap();
        assert_eq!(via_rpc, serde_json::to_value(&direct).unwrap(), "the dispatcher changes the report");

        assert_eq!((via_rpc["chainA"].as_str(), via_rpc["chainB"].as_str()), (Some("B"), Some("Q")));
        assert_eq!((via_rpc["lengthA"].as_u64(), via_rpc["lengthB"].as_u64()), (Some(63), Some(60)));
        for key in ["tmScoreA", "tmScoreB", "d0A", "d0B", "rmsdAngstrom", "sequenceIdentity"] {
            assert!(via_rpc[key].is_f64(), "{key}: {}", via_rpc[key]);
        }
        let tm_a = via_rpc["tmScoreA"].as_f64().unwrap();
        assert!(tm_a > 0.5 && tm_a < 1.0, "a perturbed fold of 60 of 63 residues: {tm_a}");
        assert!(via_rpc["alignedLength"].as_u64().unwrap() > 30);
        assert_eq!(via_rpc["alignedSequenceA"].as_str().unwrap().replace('-', ""), lyz);
        assert_eq!(via_rpc["alignedSequenceB"].as_str().unwrap().replace('-', ""), &lyz[3..]);
        let t = via_rpc["transformationMatrix"].as_array().expect("4x4 matrix");
        assert_eq!(t.len(), 4);
        assert_eq!(t[3], json!([0.0, 0.0, 0.0, 1.0]));

        // No chain keys, a blank one or null: each structure's first chain.
        let default = dispatch_bio_rpc("align_structures_tm", json!({ "pdbA": two_chains, "pdbB": other })).unwrap();
        assert_eq!(default["chainA"], "A");
        let blank = dispatch_bio_rpc(
            "align_structures_tm",
            json!({ "pdbA": two_chains, "pdbB": other, "chainA": "", "chainB": null }),
        )
        .unwrap();
        assert_eq!(blank["chainA"], "A");

        // A chain that is not there, a chain id that is not a string, or no structure: an error by name.
        let err = dispatch_bio_rpc("align_structures_tm", json!({ "pdbA": two_chains, "pdbB": other, "chainA": "Z" }))
            .unwrap_err();
        assert!(err.contains("'Z'") && err.contains("A, B"), "{err}");
        let err = dispatch_bio_rpc("align_structures_tm", json!({ "pdbA": two_chains, "pdbB": other, "chainB": 5 }))
            .unwrap_err();
        assert!(err.contains("chainB"), "{err}");
        let err = dispatch_bio_rpc("align_structures_tm", json!({ "pdbA": two_chains, "pdbB": "" })).unwrap_err();
        assert!(err.contains("Structure B holds no Cα atoms"), "{err}");
    }

    /// D0005 / TD-06 through the dispatcher: an unknown mode or scoring-matrix name in a pairwise
    /// request and an unknown protease in a digest each run with the default, and the reply carries
    /// the warning naming it; a known name replies with an empty `warnings`.
    #[test]
    fn unknown_names_reach_the_reply_as_warnings() {
        let (p1, p2) = ("MKWCTAYIAKQRQISFVKSHFSRQ", "MKWCTAYLAKQRQVSFVKAHFSRE");
        let gotoh = |mode: &str, matrix: &str| {
            dispatch_bio_rpc("align_pairwise_gotoh", json!({ "seq1": p1, "seq2": p2, "mode": mode, "matrix": matrix })).unwrap()
        };
        let known = gotoh("global", "blosum62");
        assert_eq!(known["warnings"], json!([]));
        let unknown = gotoh("glocal", "blosum80");
        assert_eq!(
            unknown["warnings"],
            json!([
                "Unknown alignment mode 'glocal': aligned in global mode (Needleman-Wunsch).",
                "Unknown scoring matrix 'blosum80': aligned with BLOSUM62, the default for protein sequences."
            ])
        );
        // the defaults were used: the alignment is the global BLOSUM62 one (the algorithm label names
        // the mode), and PAM250 scores it otherwise
        let without_warnings = |mut v: Value| {
            v.as_object_mut().unwrap().remove("warnings");
            v
        };
        assert_eq!(without_warnings(unknown), without_warnings(known.clone()));
        assert_eq!(known["algorithm"], "Needleman-Wunsch (Global)");
        assert_ne!(gotoh("global", "pam250")["score"], known["score"], "fixture: PAM250 scores as BLOSUM62 does");

        let legacy = |mode: &str| dispatch_bio_rpc("align_pairwise", json!({ "seq1": p1, "seq2": p2, "mode": mode })).unwrap();
        assert_eq!(legacy("local")["warnings"], json!([]));
        assert_eq!(legacy("glocal")["warnings"], json!(["Unknown alignment mode 'glocal': aligned in global mode (Needleman-Wunsch)."]));
        assert_eq!(without_warnings(legacy("glocal")), without_warnings(legacy("global")));
        assert_ne!(legacy("local")["algorithm"], legacy("global")["algorithm"], "fixture");

        let digest = |protease: &str| {
            dispatch_bio_rpc("simulate_proteolytic_digest_ms", json!({ "proteinSeq": "MAKPGREDFWKLRPSTDYMKAGDEQ", "protease": protease })).unwrap()
        };
        let trypsin = digest("Trypsin");
        assert_eq!(trypsin["warnings"], json!([]));
        let foo = digest("Foo");
        assert_eq!(foo["warnings"], json!(["Unknown protease 'Foo': digested with Trypsin."]));
        assert_eq!(foo["protease"], "Trypsin");
        assert_eq!(foo["peptides"], trypsin["peptides"]);
    }

    /// D0005 / TD-06 (US-01M6P2QH AC1) through the dispatcher: a `tableId` that selects no NCBI
    /// genetic code is read as sent, translates with the Standard code (table 1), and the reply's
    /// `warnings` names it as sent. Past 255 it is neither clamped to 255 (300 is named 300) nor
    /// wrapped onto a real table (258 to table 2, where TGA is Trp, not a stop); a negative,
    /// fractional or text id selects no table either, where `usize_arg` read -2 as the unset 0 and
    /// rounded 2.5 to table 3. An absent, null or 0 id is unset: table 1, no warning.
    #[test]
    fn table_ids_past_255_translate_with_table_1() {
        // a null id leaves the key out
        let translate = |id: Value| {
            let mut payload = json!({ "dna": "ATGTGATAA" });
            if !id.is_null() {
                payload["tableId"] = id;
            }
            dispatch_bio_rpc("translate_sequence", payload).unwrap()
        };
        let quiet = |protein: &str| json!({ "protein": protein, "warnings": [] });
        let warned = |named: &str| {
            json!({ "protein": "M**", "warnings": [format!("Unknown genetic code {named}: translated with the Standard code (table 1).")] })
        };
        // fixture: table 2 reads TGA as Trp, table 3 as Trp too, table 1 as a stop
        assert_eq!((translate(json!(1)), translate(json!(2)), translate(json!(3))), (quiet("M**"), quiet("MW*"), quiet("MW*")), "fixture");
        assert_eq!(translate(json!(2.0)), quiet("MW*"), "a whole float is that id");
        for (id, named) in [
            (json!(99), "99"),
            (json!(7), "7"),
            (json!(255), "255"),
            (json!(258), "258"),
            (json!(300), "300"),
            (json!(1_000_000_000_000u64), "1000000000000"),
            (json!(-2), "-2"),
            (json!(2.5), "2.5"),
            (json!("2"), "\"2\""),
        ] {
            assert_eq!(translate(id.clone()), warned(named), "{id}");
        }
        // unset: no key, a null and 0 read as table 1 and warn of nothing
        assert_eq!(translate(Value::Null), quiet("M**"));
        assert_eq!(dispatch_bio_rpc("translate_sequence", json!({ "dna": "ATGTGATAA", "tableId": null })).unwrap(), quiet("M**"));
        assert_eq!(translate(json!(0)), quiet("M**"));

        // ATG AAA AAA AAA AAA AAA TGA AAA TAA: a 6-aa ORF ending at TGA under table 1, an 8-aa one
        // under table 2, where TGA reads W; the reply carries the same warning beside its ORFs
        let orfs = |id: Value| {
            dispatch_bio_rpc("find_orfs", json!({ "seq": "ATGAAAAAAAAAAAAAAATGAAAATAA", "minLengthAa": 5, "tableId": id })).unwrap()
        };
        let proteins = |reply: &Value| reply["orfs"].as_array().unwrap().iter().map(|o| o["proteinSeq"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(orfs(json!(1))["warnings"], json!([]));
        assert_eq!((proteins(&orfs(json!(1))), proteins(&orfs(json!(2)))), (vec!["MKKKKK".to_string()], vec!["MKKKKKWK".to_string()]), "fixture");
        for (id, named) in [(json!(99), "99"), (json!(258), "258"), (json!(300), "300")] {
            let reply = orfs(id);
            assert_eq!(reply["orfs"], orfs(json!(1))["orfs"], "{named}");
            assert_eq!(reply["warnings"], json!([format!("Unknown genetic code {named}: translated with the Standard code (table 1).")]));
        }
        // with alternative starts the fallback is table 1's starts, not table 11's (the same amino
        // acids): ATG...TAA is an ORF under both, GTG...TAA under table 11 alone
        let alt_orfs = |id: Value| {
            let seq = "ATGAAAAAAAAAAAAAAATAAGTGAAAAAAAAAAAAAAATAA";
            dispatch_bio_rpc("find_orfs", json!({ "seq": seq, "minLengthAa": 5, "allowAlternativeStart": true, "tableId": id })).unwrap()
        };
        assert_eq!((proteins(&alt_orfs(json!(1))).len(), proteins(&alt_orfs(json!(11))).len()), (1, 2), "fixture");
        assert_eq!(alt_orfs(json!(99))["orfs"], alt_orfs(json!(1))["orfs"]);
    }

    /// The VCF consequence annotator reads `geneticCodeId` as translate_sequence reads `tableId`:
    /// `as u8` wrapped 258 to table 2, where TGG > TGA is synonymous (Trp > Trp) rather than a stop
    /// gained, and named no code it could not read. An unknown code now reads as the Standard code
    /// and the reply's `warnings` names it; a known or absent one (default 11) warns of nothing.
    #[test]
    fn vcf_genetic_code_ids_are_read_as_sent_and_unknown_ones_warn() {
        // CDS 7..18: ATG TGG AAA TAA; position 12 G>A makes TGG (Trp) TGA
        let vcf = "##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t12\t.\tG\tA\t99\tPASS\t.\n";
        let annotate = |code: Option<Value>| {
            let mut payload = json!({
                "referenceSeq": "GAATTCATGTGGAAATAACTCGAG",
                "features": [{ "id": "cds", "name": "cds", "type": "CDS", "start": 7, "end": 18, "strand": 1, "color": "#000" }],
                "vcfText": vcf,
            });
            if let Some(code) = code {
                payload["geneticCodeId"] = code;
            }
            dispatch_bio_rpc("annotate_vcf_coding_consequences_noodles", payload).unwrap()
        };
        let term = |reply: &Value| reply["annotatedVariants"][0]["consequenceTerm"].as_str().unwrap().to_string();
        let (standard, mito) = (annotate(Some(json!(1))), annotate(Some(json!(2))));
        assert_eq!((term(&standard), term(&mito)), ("stop_gained".to_string(), "synonymous_variant".to_string()), "fixture");
        for known in [annotate(None), annotate(Some(json!(11))), standard, mito] {
            assert_eq!(known["warnings"], json!([]), "{known}");
        }
        for (code, named) in [(json!(258), "258"), (json!(300), "300"), (json!(99), "99")] {
            let reply = annotate(Some(code));
            assert_eq!(term(&reply), "stop_gained", "{named}");
            assert_eq!(reply["warnings"], json!([format!("Unknown genetic code {named}: translated with the Standard code (table 1).")]));
        }
    }
}
