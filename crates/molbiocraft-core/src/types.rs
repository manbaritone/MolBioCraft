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
    /// Why the primer has no Tm (BG-01M6SHQ0): it holds N or another base that is not A, C, G or T,
    /// which Primer3 refuses; this is the sentence a reader shows, with "n/a", in place of the Tm.
    /// The number stays in `tm_anneal_c` and `tm_full_c`, so no reader of it breaks. It is read over
    /// the whole primer, the 5′ tail followed by the anneal sequence (BG-01M6TB1R): `design_pcr_primers`
    /// takes only A/C/G/T anneal sequences, as Primer3 does, so on a designed primer it is set only by
    /// a tail holding such a base, and then `tm_full_c` has no answer while `tm_anneal_c` does. Absent
    /// for an A/C/G/T primer, and for a record saved before it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_no_answer_reason: Option<String>,
    /// Where the primer came from when it was added from the Primer Database (US-01M7DQMY): the
    /// record's id and a copy of the record as it was then, never a link to it. Absent for a primer
    /// added any other way and for a record saved before it, which still loads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<PrimerSourceSnapshot>,
}

/// How a binding site was found: the engine's match rule and the settings it ran with (US-01M7DQMY).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimerMatchConditions {
    pub method: String,
    pub max_mismatches: usize,
    pub clamp3_prime_bases: usize,
    pub mismatches: usize,
    /// The conditions of the effective Tm; absent where the Tm is unavailable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_conditions: Option<String>,
}

/// A document primer's copy of the Primer Database record it was added from (US-01M7DQMY, D0119).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimerSourceSnapshot {
    /// "primerDatabase".
    pub kind: String,
    pub record_id: String,
    pub name: String,
    pub sequence: String,
    pub tail5_prime: String,
    pub molecule: String,
    pub modifications: String,
    /// The sequence revision of the target the primer was found on.
    pub sequence_revision: String,
    pub r#match: PrimerMatchConditions,
    /// Why the engine computes no Tm or ΔG for the record (RNA or a modification).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thermo_unavailable_reason: Option<String>,
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

/// Where an enzyme definition comes from: the read-only built-in catalogue, or the user's own
/// enzyme database (US-01M7DV1V).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnzymeSource {
    #[default]
    Builtin,
    Custom,
}

/// The prefix of every custom definition's id (`custom:<uuid>`, D0147); no catalogue name has it.
pub const CUSTOM_ENZYME_ID_PREFIX: &str = "custom:";

/// A restriction enzyme, built-in or custom. Its `id` is stable for the definition's life: a
/// built-in's is its catalogue name, verbatim; a custom definition's is `custom:<uuid>`, so two
/// enzymes that share a name are told apart by their ids (US-01M7DV1V).
///
/// Deserializing goes through [`RestrictionEnzymeWire`], so a payload written before `id`,
/// `source`, `provenance` and `notes` existed still reads: an absent or empty `id` is filled with
/// the name once the payload is read, and an absent `source` is `custom` exactly when the id
/// starts with `custom:`, `builtin` otherwise. A JSON null in any of the four reads as the key
/// absent (BG-01M7H533).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "RestrictionEnzymeWire")]
pub struct RestrictionEnzyme {
    pub id: String,
    pub source: EnzymeSource,
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
    /// Free text naming where the definition came from; empty for a built-in and when unset.
    #[serde(default)]
    pub provenance: String,
    #[serde(default)]
    pub notes: String,
}

/// A [`RestrictionEnzyme`] as a payload spells it: `id`, `source`, `provenance` and `notes` may
/// be absent, as in every payload written before US-01M7DV1V, or JSON null, as a hand-edited
/// backup or a REST client may write them; serde reads a null `Option` as `None`, the same as an
/// absent key (BG-01M7H533).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestrictionEnzymeWire {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    source: Option<EnzymeSource>,
    name: String,
    recognition_seq: String,
    cut_fwd: i32,
    cut_rev: i32,
    #[serde(rename = "isTypeIIS", default)]
    is_type_iis: bool,
    #[serde(default)]
    suppliers: Vec<String>,
    #[serde(default)]
    methylation_sensitivity: Vec<String>,
    #[serde(rename = "bufferNEB", default)]
    buffer_standard: String,
    #[serde(default)]
    temp_c: u32,
    #[serde(default)]
    provenance: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

impl From<RestrictionEnzymeWire> for RestrictionEnzyme {
    /// Runs after the payload is read: an absent, null or empty id becomes the name (a built-in's
    /// id), an absent or null source is read from the id by the one rule, and an absent or null
    /// provenance or notes is empty.
    fn from(w: RestrictionEnzymeWire) -> Self {
        let id = match w.id {
            Some(id) if !id.is_empty() => id,
            _ => w.name.clone(),
        };
        let source = w.source.unwrap_or(if id.starts_with(CUSTOM_ENZYME_ID_PREFIX) {
            EnzymeSource::Custom
        } else {
            EnzymeSource::Builtin
        });
        RestrictionEnzyme {
            id,
            source,
            name: w.name,
            recognition_seq: w.recognition_seq,
            cut_fwd: w.cut_fwd,
            cut_rev: w.cut_rev,
            is_type_iis: w.is_type_iis,
            suppliers: w.suppliers,
            methylation_sensitivity: w.methylation_sensitivity,
            buffer_standard: w.buffer_standard,
            temp_c: w.temp_c,
            provenance: w.provenance.unwrap_or_default(),
            notes: w.notes.unwrap_or_default(),
        }
    }
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
    /// `N` counts every letter that is not A, C, G or T (U read as T); the masses weigh each as the
    /// mean of the four.
    pub counts: HashMap<char, usize>,
    /// Why `basic_tm_c`, which stays a number, is no answer: set when the sequence holds any letter
    /// that is not A, C, G or T, naming N and the other codes, inosine and other letters apart
    /// (`tm_no_answer_sentence`, US-01M6VFP8). Null otherwise.
    #[serde(default)]
    pub tm_no_answer_reason: Option<String>,
    /// A sentence when the shared alphabet rule reads the sequence as protein, so these nucleotide
    /// statistics do not apply to it; empty otherwise.
    #[serde(default)]
    pub warnings: Vec<String>,
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

#[cfg(test)]
mod us_01m7dqmy_tests {
    use super::*;

    const WITH_SOURCE: &str = r#"{"id":"p1","name":"Fwd-tailed","sequence":"GGATCCAAAAACGTACGTACGTACGTACGT","annealSequence":"ACGTACGTACGTACGTACGT","tail5Prime":"GGATCCAAAA","bindStart":51,"bindEnd":70,"strand":1,"length":30,"gcPercent":50.0,"tmAnnealC":0.0,"tmFullC":0.0,"deltaG37":0.0,"hairpinDeltaG":0.0,"selfDimerDeltaG":0.0,"gcClamp3Prime":true,"tmNoAnswerReason":"Tm and ΔG unavailable: it is RNA.","source":{"kind":"primerDatabase","recordId":"seed-1","name":"Fwd-tailed","sequence":"GGATCCAAAAACGTACGTACGTACGTACGT","tail5Prime":"GGATCCAAAA","molecule":"RNA","modifications":"/5Phos/","sequenceRevision":"l400.abc","match":{"method":"Test with Saved Primers engine","maxMismatches":1,"clamp3PrimeBases":5,"mismatches":0},"thermoUnavailableReason":"Tm and ΔG unavailable: it is RNA."}}"#;

    #[test]
    fn us_01m7dqmy_ac4_primer_source_survives_a_serde_round_trip() {
        let p: PrimerRecord = serde_json::from_str(WITH_SOURCE).expect("parses");
        let src = p.source.clone().expect("source kept");
        assert_eq!(src.record_id, "seed-1");
        assert_eq!(src.name, "Fwd-tailed");
        assert_eq!(src.tail5_prime, "GGATCCAAAA");
        assert_eq!(src.sequence_revision, "l400.abc");
        assert_eq!(src.r#match.clamp3_prime_bases, 5);
        assert_eq!(src.r#match.tm_conditions, None);
        let back: serde_json::Value = serde_json::to_value(&p).unwrap();
        let original: serde_json::Value = serde_json::from_str(WITH_SOURCE).unwrap();
        assert_eq!(back["source"], original["source"]);
        let again: PrimerRecord = serde_json::from_value(back).unwrap();
        assert_eq!(again.source, p.source);
    }

    #[test]
    fn us_01m7dqmy_ac4_a_primer_saved_without_source_still_loads_and_writes_none() {
        let mut v: serde_json::Value = serde_json::from_str(WITH_SOURCE).unwrap();
        v.as_object_mut().unwrap().remove("source");
        let p: PrimerRecord = serde_json::from_value(v).expect("an older primer loads");
        assert!(p.source.is_none());
        let out = serde_json::to_value(&p).unwrap();
        assert!(out.get("source").is_none(), "no source key is written for a primer without one");
    }
}

#[cfg(test)]
mod us_01m7dv1v_tests {
    use super::*;

    /// A catalogue entry as the engine serialized it before US-01M7DV1V: no `id`, `source`,
    /// `provenance` or `notes` key.
    const OLD_BUILTIN: &str = r#"{"name":"EcoRI","recognitionSeq":"GAATTC","cutFwd":1,"cutRev":5,"isTypeIIS":false,"suppliers":["NEB"],"methylationSensitivity":["CpG"],"bufferNEB":"rCutSmart","tempC":37}"#;

    #[test]
    fn us_01m7dv1v_ac3_an_old_payload_deserializes_with_its_name_as_id_and_builtin_source() {
        let e: RestrictionEnzyme = serde_json::from_str(OLD_BUILTIN).expect("an old payload still deserializes");
        // Wrong implementations: an id left empty (serde's default), or taken from anything but the name.
        assert_eq!(e.id, "EcoRI", "an absent id is filled with the name, never left empty");
        assert_eq!(e.source, EnzymeSource::Builtin);
        assert_eq!(e.provenance, "");
        assert_eq!(e.notes, "");
        assert_eq!((e.name.as_str(), e.recognition_seq.as_str(), e.cut_fwd, e.cut_rev), ("EcoRI", "GAATTC", 1, 5));
        let back = serde_json::to_value(&e).unwrap();
        assert_eq!(back["id"], "EcoRI");
        assert_eq!(back["source"], "builtin");
        assert_eq!(back["provenance"], "");
        assert_eq!(back["notes"], "");
    }

    #[test]
    fn us_01m7dv1v_ac3_a_missing_source_is_custom_exactly_when_the_id_starts_with_custom() {
        let with = |id: &str| -> RestrictionEnzyme {
            let mut v: serde_json::Value = serde_json::from_str(OLD_BUILTIN).unwrap();
            v["id"] = serde_json::Value::String(id.to_string());
            v["name"] = serde_json::Value::String("Mine".to_string());
            serde_json::from_value(v).unwrap()
        };
        let custom = with("custom:0b9c7c2e-8a51-4f8e-9d0c-5a3a2f1e6b7d");
        assert_eq!(custom.id, "custom:0b9c7c2e-8a51-4f8e-9d0c-5a3a2f1e6b7d");
        assert_eq!(custom.source, EnzymeSource::Custom, "an id in the custom: namespace reads as custom");
        let builtin = with("Mine");
        assert_eq!(builtin.source, EnzymeSource::Builtin, "any other id reads as builtin");
        // The rule reads the id's prefix, not its mention: `custom:` elsewhere is not custom.
        assert_eq!(with("my-custom:thing").source, EnzymeSource::Builtin);
        // A source the payload states is kept as stated.
        let mut v: serde_json::Value = serde_json::from_str(OLD_BUILTIN).unwrap();
        v["source"] = serde_json::Value::String("custom".to_string());
        let stated: RestrictionEnzyme = serde_json::from_value(v).unwrap();
        assert_eq!((stated.id.as_str(), stated.source), ("EcoRI", EnzymeSource::Custom));
        // An empty id is no id: it is filled with the name too.
        assert_eq!(with("").id, "Mine");
    }

    #[test]
    fn us_01m7dv1v_ac3_provenance_and_notes_are_kept_when_present() {
        let mut v: serde_json::Value = serde_json::from_str(OLD_BUILTIN).unwrap();
        v["id"] = serde_json::Value::String("custom:1".to_string());
        v["provenance"] = serde_json::Value::String("REBASE 1234".to_string());
        v["notes"] = serde_json::Value::String("lab stock".to_string());
        let e: RestrictionEnzyme = serde_json::from_value(v).unwrap();
        assert_eq!((e.provenance.as_str(), e.notes.as_str(), e.source), ("REBASE 1234", "lab stock", EnzymeSource::Custom));
    }
}
