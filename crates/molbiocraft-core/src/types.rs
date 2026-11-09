// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Topology {
    #[serde(rename = "circular")]
    Circular,
    #[serde(rename = "linear")]
    Linear,
}

impl Default for Topology {
    fn default() -> Self {
        Topology::Linear
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MoleculeType {
    DNA,
    RNA,
    Protein,
}

impl Default for MoleculeType {
    fn default() -> Self {
        MoleculeType::DNA
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSegment {
    pub index: usize,
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceFeature {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub feature_type: String,
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualifiers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<FeatureSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleavage_site: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimerRecord {
    pub id: String,
    pub name: String,
    pub sequence: String,
    pub anneal_sequence: String,
    pub tail5_prime: String,
    pub bind_start: usize,
    pub bind_end: usize,
    pub strand: i8,
    pub length: usize,
    pub gc_percent: f64,
    pub tm_anneal_c: f64,
    pub tm_full_c: f64,
    pub delta_g37: f64,
    pub hairpin_delta_g: f64,
    pub self_dimer_delta_g: f64,
    pub gc_clamp3_prime: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Why `tm_anneal_c` is no answer (BG-01M6SHQ0): the anneal sequence holds N or another base
    /// that is not A, C, G or T, which Primer3 refuses; this is the sentence a reader shows, with
    /// "n/a", in place of the Tm. The number stays in `tm_anneal_c` and `tm_full_c`, so no reader of
    /// it breaks. The reason is the anneal sequence's only. `tm_full_c` is the Tm of the 5′ tail
    /// followed by the anneal sequence, so it has no answer either where this is set; but the tail
    /// is not read for it, so a primer whose 5′ tail holds N beside an A/C/G/T anneal sequence (a
    /// tail given to `design_pcr_primers`) has no reason here although its `tm_full_c` has no
    /// answer. Absent for an A/C/G/T primer, and for a record saved before it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_no_answer_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertedRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTreeNode {
    pub id: String,
    pub timestamp: String,
    pub operation: String,
    pub description: String,
    pub parent_ids: Vec<String>,
    pub length_bp: usize,
    pub topology: Topology,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inserted_range: Option<InsertedRange>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentMemberSequence {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accession: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organism: Option<String>,
    pub sequence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strand: Option<i8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<SequenceFeature>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAlignmentMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairwise_identity_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identical_sites_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genetic_code_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_coverage_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_builder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_aligned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequences: Option<Vec<AlignmentMemberSequence>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromatogramData {
    pub trace_a: Vec<f64>,
    pub trace_c: Vec<f64>,
    pub trace_g: Vec<f64>,
    pub trace_t: Vec<f64>,
    pub peak_locations: Vec<usize>,
    pub phred_scores: Vec<u8>,
    pub base_calls: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceDocument {
    pub id: String,
    pub name: String,
    pub accession: String,
    pub description: String,
    pub molecule_type: MoleculeType,
    pub topology: Topology,
    pub sequence: String,
    #[serde(default)]
    pub features: Vec<SequenceFeature>,
    #[serde(default)]
    pub primers: Vec<PrimerRecord>,
    #[serde(default)]
    pub history: Vec<HistoryTreeNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chromatogram: Option<ChromatogramData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment_meta: Option<DocumentAlignmentMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_metadata: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictionEnzyme {
    pub name: String,
    pub recognition_seq: String,
    pub cut_fwd: i32,
    pub cut_rev: i32,
    #[serde(rename = "isTypeIIS", default)]
    pub is_type_iis: bool,
    #[serde(default)]
    pub suppliers: Vec<String>,
    #[serde(default)]
    pub methylation_sensitivity: Vec<String>,
    #[serde(rename = "bufferNEB", default)]
    pub buffer_standard: String,
    #[serde(default)]
    pub temp_c: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictionCutSite {
    pub id: String,
    pub enzyme: RestrictionEnzyme,
    pub position: usize,
    pub cut_top: usize,
    pub cut_bottom: usize,
    pub strand: i8,
    pub overhang_seq: String,
    pub overhang_type: String,
    pub methylation_blocked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrfRecord {
    pub id: String,
    pub frame: i8,
    pub strand: i8,
    pub start: usize,
    pub end: usize,
    pub length_bp: usize,
    pub length_aa: usize,
    pub start_codon: String,
    pub stop_codon: String,
    pub protein_seq: String,
    pub mw_kda: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceStats {
    pub length: usize,
    pub gc_percent: f64,
    pub at_percent: f64,
    pub mw_ssdna_da: f64,
    pub mw_dsdna_da: f64,
    pub mw_rna_da: f64,
    pub basic_tm_c: f64,
    pub gc_skew: f64,
    pub at_skew: f64,
    pub shannon_entropy_bits: f64,
    pub counts: HashMap<char, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchSequenceItem {
    pub id: String,
    pub name: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchSequenceStatsEntry {
    pub id: String,
    pub name: String,
    pub stats: SequenceStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimerThermodynamics {
    pub sequence: String,
    pub length: usize,
    pub gc_percent: f64,
    pub delta_h_kcal: f64,
    pub delta_s_cal: f64,
    pub delta_g_37_kcal: f64,
    pub tm_salt_corrected_c: f64,
    pub hairpin_dg_kcal: f64,
    pub self_dimer_dg_kcal: f64,
    pub gc_clamp_3prime: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignmentOutput {
    pub aligned_seq1: String,
    pub aligned_seq2: String,
    pub midline: String,
    pub score: i32,
    pub matches: i32,
    pub mismatches: i32,
    pub gaps: i32,
    pub identity_pct: f64,
}
