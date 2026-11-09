// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Single-pass Rust Document Table Metrics & Type/Icon Inference, RFC-4180 CSV/TSV Table Exporter (`csv`),
//! `bio::data_structures::interval_tree::IntervalTree` Annotation-Preserving Subsequence Extractor,
//! Modular Part Splicer, Built-In Workflow Macro Catalog, and `petgraph::graph::DiGraph` + `toposort`
//! Multi-Document Construct Lineage Provenance DAG Layout Engine.

use crate::cloning_crispr::{audit_sequence_alerts_for_scan, SequenceAlertItem};
use crate::modular_parts_data::ModularVectorPart;
use crate::rebase_catalog::{
    get_rebase_enzymes, scan_restriction_sites, RestrictionPositionLimit, RestrictionSiteScan,
};
use bio::data_structures::interval_tree::IntervalTree;
use csv::WriterBuilder;
use molbiocraft_core::{
    analyze_sequence_composition, clean_alpha_sequence, HistoryTreeNode, InsertedRange,
    MoleculeType, PrimerRecord, RestrictionEnzyme, SequenceDocument, SequenceFeature, Topology,
};
use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::Direction;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedDocumentRowMetricsRust {
    pub doc_type_label: String,
    pub icon_kind: String,
    pub length_num: usize,
    pub length_label: String,
    pub gc_pct: f64,
    pub gc_label: String,
    pub annotations_count: usize,
    pub num_sequences: usize,
    pub pairwise_identity_pct: Option<f64>,
    pub pairwise_identity_label: String,
    pub identical_sites_pct: Option<f64>,
    pub identical_sites_label: String,
    pub genetic_code_label: String,
    pub mean_coverage_x: Option<f64>,
    pub mean_coverage_label: String,
    pub tree_builder_label: String,
    pub modified_formatted: String,
    pub created_formatted: String,
    pub alerts_count: usize,
    pub alerts_summary: String,
    /// How far the record checks behind the Status column got. An empty alert list is a clear
    /// record only when this is `Complete` (BG-01M6S1B3).
    pub checks_state: RecordChecksState,
    /// The checks that did not run or did not finish, and why, in plain words; empty when every
    /// check ran in full. It is also the end of `alerts_summary`, so the reason is stated beside
    /// the status.
    pub checks_not_run: String,
}

/// How far the record checks (methylation-blocked sites, Type IIS sites inside a CDS, CDS reading
/// frames, primer Tm spread) got on one document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordChecksState {
    /// Every check ran on the whole record.
    Complete,
    /// Some checks ran in full; `checks_not_run` names those that did not run or did not finish.
    Partial,
    /// No check ran; `checks_not_run` says why.
    NotRun,
}

/// The longest sequence the document table scans for restriction sites, which the methylation and
/// Type IIS checks need. A longer record runs only the checks that read its annotations.
const RECORD_RESTRICTION_CHECK_MAX_BP: usize = 50_000;

const NOT_RUN_PROTEIN: &str = "Not checked: the methylation, Type IIS site, reading-frame and primer checks are DNA checks, and this is a protein record";
const NOT_RUN_NO_BASES: &str = "Not checked: this record holds no bases the checks can read (A, C, G, T or U), so no check ran";
const ALL_CHECKS_FOUND_NOTHING: &str = "Checked methylation-blocked restriction sites, Type IIS sites inside a CDS, CDS reading frames and primer Tm spread: nothing found";
const ANNOTATION_CHECKS_FOUND_NOTHING: &str = "CDS reading frames and primer Tm spread checked: nothing found";

/// Why a record over `RECORD_RESTRICTION_CHECK_MAX_BP` runs only the annotation checks.
fn not_run_long() -> String {
    format!(
        "Not run: the methylation and Type IIS site checks, which need a restriction-site scan that the document table runs only on sequences up to {} bp",
        format_usize_with_commas(RECORD_RESTRICTION_CHECK_MAX_BP)
    )
}

/// Why a record whose restriction scan kept only its first `cap` sites is only partly checked.
fn scan_stopped_at_cap(cap: usize) -> String {
    format!(
        "Not finished: the methylation and Type IIS site checks read a restriction-site scan that stopped at its {}-site cap before the end of the record, so they may have missed sites",
        format_usize_with_commas(cap)
    )
}

/// Whether the record holds a base the restriction scan can match: A, C, G or T (U is read as T),
/// in either case. An N or another ambiguity code matches no recognition site's fixed base, and
/// whitespace is no base at all, so a record of only those has nothing the scan can read.
fn holds_readable_bases(sequence: &str) -> bool {
    sequence
        .bytes()
        .any(|b| matches!(b.to_ascii_uppercase(), b'A' | b'C' | b'G' | b'T' | b'U'))
}

/// The catalogue enzymes the methylation and Type IIS checks read: a site is methylation-blocked
/// only for an enzyme that Dam or Dcm blocks, and the Type IIS check reads only Type IIS sites.
/// Scanning just these lists the same methylation-blocked and Type IIS sites as a whole-catalogue
/// scan that keeps every site, among far fewer sites in all (about a quarter on random sequence), so
/// the checks' `RECORD_CHECK_SITE_POSITIONS` limit, which the whole catalogue reaches on a GC-rich
/// record under 50,000 bp, is reached far less often.
fn record_check_enzymes() -> Vec<RestrictionEnzyme> {
    get_rebase_enzymes()
        .into_iter()
        .filter(|e| e.is_type_iis || e.methylation_sensitivity.iter().any(|m| m == "Dam" || m == "Dcm"))
        .collect()
}

/// The most sites the record checks keep from their restriction scan, all enzymes together. The
/// scan counts every site, but the checks read positioned sites (which are blocked, which fall in a
/// CDS); past this many the record is only partly checked, which the scan's `stopped_early` reports.
const RECORD_CHECK_SITE_POSITIONS: usize = 12_000;

/// Runs the record checks the document can take and says how far they got. The reading-frame and
/// primer checks read only the annotations, so they run at any length; the methylation and Type IIS
/// checks need the restriction scan, which runs up to `RECORD_RESTRICTION_CHECK_MAX_BP` and must
/// have kept every site it found (its own stop report, BG-01M6S1K2) for them to be complete.
fn run_record_checks(doc: &SequenceDocument) -> (Vec<SequenceAlertItem>, RecordChecksState, String) {
    if doc.molecule_type == MoleculeType::Protein {
        return (Vec::new(), RecordChecksState::NotRun, NOT_RUN_PROTEIN.to_string());
    }
    if !holds_readable_bases(&doc.sequence) {
        return (Vec::new(), RecordChecksState::NotRun, NOT_RUN_NO_BASES.to_string());
    }
    let scanned = doc.sequence.len() <= RECORD_RESTRICTION_CHECK_MAX_BP;
    let scan = if scanned {
        scan_restriction_sites(
            &doc.sequence,
            doc.topology,
            Some(&record_check_enzymes()),
            RestrictionPositionLimit::Total(RECORD_CHECK_SITE_POSITIONS),
        )
    } else {
        RestrictionSiteScan::default()
    };
    let mut alerts = audit_sequence_alerts_for_scan(doc, &scan.sites, "DH5α (dam+ dcm+)", scan.stopped_early);
    // The audit's own all-clear line is a verdict, not an alert, and with no scan it would claim
    // restriction sites it never looked at.
    alerts.retain(|a| a.id != "alert-clean");
    if !scanned {
        return (alerts, RecordChecksState::Partial, not_run_long());
    }
    if scan.stopped_early {
        let cap = scan.positions_total_cap.unwrap_or(RECORD_CHECK_SITE_POSITIONS);
        (alerts, RecordChecksState::Partial, scan_stopped_at_cap(cap))
    } else {
        (alerts, RecordChecksState::Complete, String::new())
    }
}

fn format_usize_with_commas(n: usize) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(len + len / 3);
    for (i, &b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(b as char);
    }
    out
}

fn format_short_iso_timestamp_rust(iso: &str) -> String {
    let t = iso.trim();
    if t.is_empty() {
        return "—".to_string();
    }
    // Normalize ISO-8601 `YYYY-MM-DDTHH:MM...` or `YYYY-MM-DD HH:MM...`
    if t.len() >= 16 {
        let prefix: String = t.chars().take(16).collect();
        return prefix.replace('T', " ");
    }
    t.to_string()
}

pub fn infer_document_type_label_rust(doc: &SequenceDocument) -> String {
    let dk = doc.document_kind.as_deref().unwrap_or("");
    // documents without a sequence of their own: analysis reports, enzyme sets, fragment runs
    if let Some(meta) = doc.doc_metadata.as_ref() {
        match meta.get("Document Type").and_then(|v| v.as_str()) {
            Some("Text Document") => return "Text Report".into(),
            Some("Enzyme Set") => return "Enzyme Set".into(),
            _ => {}
        }
        if meta.contains_key("Fragment trace") {
            return "Fragment Analysis Run".into();
        }
        // a chain imported from a .pdb / .cif file keeps its coordinates
        if meta.get("PDBText").and_then(|v| v.as_str()).is_some_and(|t| !t.trim().is_empty()) {
            return "3D Structure".into();
        }
    }
    if dk == "primer" || doc.folder == "Primers" {
        return "Oligo / Primer".into();
    }
    if dk == "contig" || doc.folder == "Contig Assembly" {
        return "Contig Assembly".into();
    }
    // NGS reads (FASTQ / SAM) keep their qualities in a chromatogram with no trace channels
    if let Some(c) = doc.chromatogram.as_ref() {
        return if c.trace_a.is_empty() && c.trace_c.is_empty() && c.trace_g.is_empty() && c.trace_t.is_empty() {
            "NGS Read".into()
        } else {
            "Sanger Chromatogram".into()
        };
    }
    if dk == "trace" {
        return "Sanger Chromatogram".into();
    }
    if dk == "tree"
        || doc
            .alignment_meta
            .as_ref()
            .and_then(|m| m.tree_builder.as_ref())
            .is_some()
        || doc.folder == "Tree Documents"
    {
        return "Phylogenetic Tree".into();
    }
    if dk == "alignment"
        || doc
            .alignment_meta
            .as_ref()
            .and_then(|m| m.sequence_count)
            .unwrap_or(1)
            > 1
        || doc.folder == "Alignments"
    {
        return "Alignment / Consensus".into();
    }
    if doc.molecule_type == MoleculeType::Protein || dk == "protein" {
        return "Protein Sequence".into();
    }
    if doc.molecule_type == MoleculeType::RNA {
        return "RNA Transcript".into();
    }
    if doc.topology == Topology::Circular {
        // a complete circular genome (phage, virus, organelle, bacterial chromosome) is not a vector
        let d = doc.description.to_ascii_lowercase();
        let genome_like = d.contains("complete genome") || d.contains("chromosome") || d.contains("mitochondri") || d.contains("chloroplast")
            || ((d.contains("phage") || d.contains("virus")) && !d.contains("vector"));
        return if doc.folder.starts_with("Genomes") || genome_like {
            "Circular Genome".into()
        } else {
            "Plasmid / Vector".into()
        };
    }
    "Nucleotide Sequence".into()
}

pub fn infer_document_icon_kind_rust(doc: &SequenceDocument) -> String {
    if let Some(dk) = doc.document_kind.as_deref() {
        if !dk.trim().is_empty() {
            return dk.to_string();
        }
    }
    if doc.chromatogram.is_some() {
        return "trace".into();
    }
    if doc.folder == "Primers" || doc.folder == "Primers & Guides" {
        return "primer".into();
    }
    if doc.folder == "Tree Documents"
        || doc
            .alignment_meta
            .as_ref()
            .and_then(|m| m.tree_builder.as_ref())
            .is_some()
    {
        return "tree".into();
    }
    if doc.folder == "Contig Assembly" {
        return "contig".into();
    }
    if doc.folder == "Alignments"
        || doc
            .alignment_meta
            .as_ref()
            .and_then(|m| m.sequence_count)
            .unwrap_or(1)
            > 1
    {
        return "alignment".into();
    }
    if doc.molecule_type == MoleculeType::Protein || doc.folder == "Protein Documents" {
        return "protein".into();
    }
    if doc.topology == Topology::Circular {
        "circular-dna".into()
    } else {
        "linear-dna".into()
    }
}

/// Computes all 19 document table metrics, restriction alert audits, genetic code inference,
/// and type/icon classification in a single zero-copy Rust call instead of 3 separate WASM round-trips.
pub fn compute_document_table_metrics_rust(doc: &SequenceDocument) -> ComputedDocumentRowMetricsRust {
    let is_protein = doc.molecule_type == MoleculeType::Protein;
    let comp = analyze_sequence_composition(&doc.sequence);
    let (alerts, checks_state, checks_not_run) = run_record_checks(doc);

    let length_num = doc.sequence.len();
    let unit = if is_protein {
        "aa"
    } else if doc.molecule_type == MoleculeType::RNA {
        "nt"
    } else {
        "bp"
    };
    let length_label = format!("{} {}", format_usize_with_commas(length_num), unit);

    let gc_pct = if is_protein { 0.0 } else { comp.gc_percent };
    let gc_label = if is_protein {
        "—".to_string()
    } else {
        format!("{:.1}%", comp.gc_percent)
    };

    let annotations_count = doc.features.len() + doc.primers.len();
    let num_sequences = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.sequence_count)
        .unwrap_or(1);

    let pw_id = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.pairwise_identity_pct);
    let id_sites = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.identical_sites_pct);

    // Only an assembly or a mapping measures coverage; a read's Phred scores do not.
    let mean_cov = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.mean_coverage_x);

    let genetic_code_label = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.genetic_code_label.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if is_protein {
                "Standard (1)".to_string()
            } else {
                let desc_low = doc.description.to_ascii_lowercase();
                if desc_low.contains("bacterial")
                    || desc_low.contains("e. coli")
                    || doc.name.starts_with("pET")
                    || doc.name.starts_with("pUC")
                {
                    "Bacterial / Plastid (11)".to_string()
                } else {
                    "Standard (1)".to_string()
                }
            }
        });

    let tree_builder_label = doc
        .alignment_meta
        .as_ref()
        .and_then(|m| m.tree_builder.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "—".to_string());

    let found = if !alerts.is_empty() {
        alerts
            .iter()
            .map(|a| format!("{}: {}", a.category, a.title))
            .collect::<Vec<_>>()
            .join(" | ")
    } else {
        match checks_state {
            RecordChecksState::Complete => ALL_CHECKS_FOUND_NOTHING.to_string(),
            RecordChecksState::Partial => ANNOTATION_CHECKS_FOUND_NOTHING.to_string(),
            RecordChecksState::NotRun => String::new(),
        }
    };
    let alerts_summary = [found.as_str(), checks_not_run.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");

    ComputedDocumentRowMetricsRust {
        doc_type_label: infer_document_type_label_rust(doc),
        icon_kind: infer_document_icon_kind_rust(doc),
        length_num,
        length_label,
        gc_pct,
        gc_label,
        annotations_count,
        num_sequences,
        pairwise_identity_pct: pw_id,
        pairwise_identity_label: pw_id
            .map(|v| format!("{v:.1}%"))
            .unwrap_or_else(|| "—".into()),
        identical_sites_pct: id_sites,
        identical_sites_label: id_sites
            .map(|v| format!("{v:.1}%"))
            .unwrap_or_else(|| "—".into()),
        genetic_code_label,
        mean_coverage_x: mean_cov,
        mean_coverage_label: mean_cov
            .map(|v| format!("{v:.1}×"))
            .unwrap_or_else(|| "—".into()),
        tree_builder_label,
        modified_formatted: format_short_iso_timestamp_rust(&doc.updated_at),
        created_formatted: format_short_iso_timestamp_rust(&doc.created_at),
        alerts_count: alerts.len(),
        alerts_summary,
        checks_state,
        checks_not_run,
    }
}

/// Serializes any tabular headers + rows into RFC-4180 compliant CSV or TSV using `csv::WriterBuilder`.
pub fn export_table_delimited_csv_rust(
    headers: &[String],
    rows: &[Vec<String>],
    delimiter: &str,
) -> String {
    let delim_byte = match delimiter {
        "\t" | "tsv" | "TSV" => b'\t',
        ";" => b';',
        _ => b',',
    };
    let mut wtr = WriterBuilder::new()
        .delimiter(delim_byte)
        .from_writer(Vec::new());

    if !headers.is_empty() {
        let _ = wtr.write_record(headers);
    }
    for row in rows {
        let _ = wtr.write_record(row);
    }
    let bytes = wtr.into_inner().unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Extracts a 1-based subsequence `[start_1based..=end_1based]` into a new linear `SequenceDocument`
/// while querying an `IntervalTree` (`bio::data_structures::interval_tree::IntervalTree`) to preserve,
/// clip, and coordinate-shift all overlapping `SequenceFeature` and `PrimerRecord` annotations!
pub fn extract_region_with_annotations_rust(
    doc: &SequenceDocument,
    start_1based: usize,
    end_1based: usize,
    now_iso: &str,
) -> SequenceDocument {
    let n = doc.sequence.len();
    if n == 0 {
        return doc.clone();
    }
    let s1 = start_1based.clamp(1, n);
    let e1 = end_1based.clamp(s1, n);
    let sub_seq: String = doc
        .sequence
        .chars()
        .skip(s1 - 1)
        .take(e1 + 1 - s1)
        .collect();
    let sub_len = sub_seq.len();

    // Build `rust-bio` IntervalTree over 0-based half-open intervals `[start-1..end)`
    let mut feat_tree: IntervalTree<usize, usize> = IntervalTree::new();
    for (idx, f) in doc.features.iter().enumerate() {
        let fs = f.start.min(f.end).saturating_sub(1);
        let fe = f.start.max(f.end).min(n);
        if fs < fe {
            feat_tree.insert(fs..fe, idx);
        }
    }

    let q_range = (s1 - 1)..e1;
    let mut hit_feat_indices: Vec<usize> = feat_tree.find(q_range.clone()).map(|e| *e.data()).collect();
    hit_feat_indices.sort_unstable();
    hit_feat_indices.dedup();

    let extracted_features: Vec<SequenceFeature> = hit_feat_indices
        .into_iter()
        .map(|idx| {
            let f = &doc.features[idx];
            let orig_s = f.start.min(f.end).max(s1);
            let orig_e = f.start.max(f.end).min(e1);
            let mut cloned = f.clone();
            cloned.id = format!("{}-ext-{}", f.id, s1);
            cloned.start = (orig_s - s1) + 1;
            cloned.end = ((orig_e - s1) + 1).min(sub_len.max(1));
            cloned.segments = None;
            cloned
        })
        .collect();

    let extracted_primers: Vec<PrimerRecord> = doc
        .primers
        .iter()
        .filter_map(|p| {
            let ps = p.bind_start.min(p.bind_end);
            let pe = p.bind_start.max(p.bind_end);
            if ps >= s1 && pe <= e1 {
                let mut cp = p.clone();
                cp.id = format!("{}-ext-{}", p.id, s1);
                cp.bind_start = (ps - s1) + 1;
                cp.bind_end = (pe - s1) + 1;
                Some(cp)
            } else {
                None
            }
        })
        .collect();

    let now = if now_iso.trim().is_empty() {
        "2026-10-31T08:30:00.000Z"
    } else {
        now_iso
    };
    let short_ts = format_short_iso_timestamp_rust(now);

    let mut history = doc.history.clone();
    history.push(HistoryTreeNode {
        id: format!("h-ext-{s1}-{e1}"),
        timestamp: short_ts,
        operation: format!("Extract Region ({s1}..{e1})"),
        description: format!(
            "Extracted {sub_len} bp linear sub-sequence from {} ({} annotations preserved via IntervalTree)",
            doc.name,
            extracted_features.len() + extracted_primers.len()
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: sub_len,
        topology: Topology::Linear,
        history_color: Some("#0284c7".into()),
        inserted_range: None,
    });

    let unit = if doc.molecule_type == MoleculeType::Protein {
        "aa"
    } else {
        "bp"
    };

    SequenceDocument {
        id: format!("doc-ext-{}-{}-{}", doc.id, s1, e1),
        name: format!("{}_{}_{}", doc.name, s1, e1),
        accession: format!("MBC_EXT_{}_{}", s1, e1),
        description: format!(
            "Extracted region {}..{} ({} {}) from {}",
            s1, e1, sub_len, unit, doc.name
        ),
        molecule_type: doc.molecule_type,
        topology: Topology::Linear,
        sequence: sub_seq,
        features: extracted_features,
        primers: extracted_primers,
        history,
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        folder: "Cloning Inserts & PCR".to_string(),
    }
}

/// Splices a `ModularVectorPart` into `doc` at 1-based `position_bp` natively in Rust,
/// shifting downstream `SequenceFeature` and `PrimerRecord` coordinates and appending a provenance node.
pub fn splice_modular_part_into_document_rust(
    doc: &SequenceDocument,
    part: &ModularVectorPart,
    position_bp: usize,
    now_iso: &str,
) -> SequenceDocument {
    let clean_part = clean_alpha_sequence(&part.sequence);
    let delta = clean_part.len();
    let seq_chars: Vec<char> = doc.sequence.chars().collect();
    let cut_idx = position_bp.saturating_sub(1).min(seq_chars.len());

    let mut next_seq = String::with_capacity(doc.sequence.len() + delta);
    for &c in &seq_chars[..cut_idx] {
        next_seq.push(c);
    }
    next_seq.push_str(&clean_part);
    for &c in &seq_chars[cut_idx..] {
        next_seq.push(c);
    }

    let mut shifted_features: Vec<SequenceFeature> = doc
        .features
        .iter()
        .map(|f| {
            let mut cf = f.clone();
            if cf.start > cut_idx {
                cf.start += delta;
            }
            if cf.end > cut_idx {
                cf.end += delta;
            }
            cf
        })
        .collect();

    shifted_features.push(SequenceFeature {
        id: format!("ins-part-{}-{}", part.id, cut_idx + 1),
        name: part.name.clone(),
        feature_type: part.feature_type.clone(),
        start: cut_idx + 1,
        end: (cut_idx + delta).max(cut_idx + 1),
        strand: 1,
        color: part.color.clone(),
        notes: Some(format!(
            "{} ({}): {}",
            part.category, part.source, part.summary
        )),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });

    let shifted_primers: Vec<PrimerRecord> = doc
        .primers
        .iter()
        .map(|p| {
            let mut cp = p.clone();
            if cp.bind_start > cut_idx {
                cp.bind_start += delta;
            }
            if cp.bind_end > cut_idx {
                cp.bind_end += delta;
            }
            cp
        })
        .collect();

    let now = if now_iso.trim().is_empty() {
        "2026-10-31T08:30:00.000Z"
    } else {
        now_iso
    };

    let mut history = doc.history.clone();
    history.push(HistoryTreeNode {
        id: format!("hist-part-{}-{}", part.id, cut_idx + 1),
        timestamp: now.to_string(),
        operation: format!("Inserted Modular Part ({})", part.name),
        description: format!(
            "Spliced {} ({} bp) into {} at bp {}",
            part.name,
            delta,
            doc.name,
            cut_idx + 1
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: next_seq.len(),
        topology: doc.topology,
        history_color: Some(part.color.clone()),
        inserted_range: Some(InsertedRange {
            start: cut_idx + 1,
            end: (cut_idx + delta).max(cut_idx + 1),
        }),
    });

    let mut updated = doc.clone();
    updated.sequence = next_seq;
    updated.features = shifted_features;
    updated.primers = shifted_primers;
    updated.updated_at = now.to_string();
    updated.history = history;
    updated
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageDagNodeView {
    pub node_id: String,
    pub doc_id: Option<String>,
    pub title: String,
    pub subtitle: String,
    pub operation: String,
    pub timestamp: String,
    pub length_bp: usize,
    pub topology: String,
    pub color: String,
    pub is_active_target: bool,
    pub is_document_node: bool,
    pub layer: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageDagEdgeView {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub label: String,
    pub svg_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructLineageDagReport {
    pub width: f64,
    pub height: f64,
    pub layer_count: usize,
    pub is_acyclic: bool,
    pub topological_order: Vec<String>,
    pub ancestor_document_count: usize,
    pub descendant_document_count: usize,
    pub nodes: Vec<LineageDagNodeView>,
    pub edges: Vec<LineageDagEdgeView>,
}

/// Builds a multi-document Cloning & Assembly Provenance Directed Acyclic Graph (`petgraph::graph::DiGraph`
/// + `petgraph::algo::toposort`) across all related workspace constructs (`parent_ids` linking donor inserts,
/// backbone vectors, PCR amplicons, POA contigs, and child constructs + chronological `HistoryTreeNode` steps),
/// returning topological order and layered Sugiyama SVG node/Bezier-edge coordinates.
pub fn build_construct_lineage_dag_rust(
    target_doc: &SequenceDocument,
    all_docs: &[SequenceDocument],
) -> ConstructLineageDagReport {
    let mut doc_by_id: HashMap<&str, &SequenceDocument> = HashMap::new();
    for d in all_docs {
        doc_by_id.insert(d.id.as_str(), d);
    }
    doc_by_id.entry(target_doc.id.as_str()).or_insert(target_doc);

    // Discover connected component of documents linked to `target_doc` via `history[*].parent_ids`
    let mut doc_edges: Vec<(String, String, String)> = Vec::new(); // (parent_doc_id, child_doc_id, op_label)
    for d in doc_by_id.values() {
        for h in &d.history {
            for pid in &h.parent_ids {
                if pid != &d.id && doc_by_id.contains_key(pid.as_str()) {
                    if !doc_edges
                        .iter()
                        .any(|(p, c, _)| p == pid && c == &d.id)
                    {
                        doc_edges.push((pid.clone(), d.id.clone(), h.operation.clone()));
                    }
                }
            }
        }
    }

    // BFS undirected around `target_doc.id` to gather ancestors & descendants
    let mut related_docs: HashSet<String> = HashSet::new();
    let mut queue = vec![target_doc.id.clone()];
    related_docs.insert(target_doc.id.clone());
    while let Some(cur) = queue.pop() {
        for (p, c, _) in &doc_edges {
            if p == &cur && !related_docs.contains(c) {
                related_docs.insert(c.clone());
                queue.push(c.clone());
            } else if c == &cur && !related_docs.contains(p) {
                related_docs.insert(p.clone());
                queue.push(p.clone());
            }
        }
    }

    #[derive(Clone)]
    struct RawDagItem {
        node_id: String,
        doc_id: Option<String>,
        title: String,
        subtitle: String,
        operation: String,
        timestamp: String,
        length_bp: usize,
        topology: String,
        color: String,
        is_active_target: bool,
        is_document_node: bool,
    }

    let mut graph: DiGraph<RawDagItem, String> = DiGraph::new();
    let mut idx_map: HashMap<String, NodeIndex> = HashMap::new();

    // Add document nodes for all related workspace documents
    let mut sorted_related: Vec<String> = related_docs.iter().cloned().collect();
    sorted_related.sort();

    for did in &sorted_related {
        if let Some(d) = doc_by_id.get(did.as_str()) {
            let topo_str = match d.topology {
                Topology::Circular => "circular",
                Topology::Linear => "linear",
            };
            let latest_op = d
                .history
                .last()
                .map(|h| h.operation.clone())
                .unwrap_or_else(|| "Workspace Construct".into());
            let ts = d
                .history
                .last()
                .map(|h| h.timestamp.clone())
                .unwrap_or_else(|| format_short_iso_timestamp_rust(&d.updated_at));
            let color = if d.id == target_doc.id {
                "#2563eb".to_string()
            } else if d.topology == Topology::Circular {
                "#0d9488".to_string()
            } else {
                "#7c3aed".to_string()
            };
            let nx = graph.add_node(RawDagItem {
                node_id: format!("doc:{}", d.id),
                doc_id: Some(d.id.clone()),
                title: d.name.clone(),
                subtitle: format!("{} · {} bp ({})", d.accession, d.sequence.len(), topo_str),
                operation: latest_op,
                timestamp: ts,
                length_bp: d.sequence.len(),
                topology: topo_str.into(),
                color,
                is_active_target: d.id == target_doc.id,
                is_document_node: true,
            });
            idx_map.insert(format!("doc:{}", d.id), nx);
        }
    }

    // Add chronological intra-document history chain for `target_doc` preceding `doc:{target_doc.id}`
    let mut prev_hist_nx: Option<NodeIndex> = None;
    for (hi, h) in target_doc.history.iter().enumerate() {
        let topo_str = match h.topology {
            Topology::Circular => "circular",
            Topology::Linear => "linear",
        };
        let hid = format!("hist:{}:{}", target_doc.id, hi);
        let nx = graph.add_node(RawDagItem {
            node_id: hid.clone(),
            doc_id: None,
            title: h.operation.clone(),
            subtitle: h.description.clone(),
            operation: h.operation.clone(),
            timestamp: h.timestamp.clone(),
            length_bp: h.length_bp,
            topology: topo_str.into(),
            color: h.history_color.clone().unwrap_or_else(|| "#0284c7".into()),
            is_active_target: false,
            is_document_node: false,
        });
        idx_map.insert(hid, nx);

        if let Some(prev) = prev_hist_nx {
            graph.add_edge(prev, nx, "step".into());
        }
        // Connect any external parent documents referenced by this history step directly into this step!
        for pid in &h.parent_ids {
            if pid != &target_doc.id {
                if let Some(&p_nx) = idx_map.get(&format!("doc:{pid}")) {
                    graph.add_edge(p_nx, nx, "donor/parent".into());
                }
            }
        }
        prev_hist_nx = Some(nx);
    }

    if let (Some(last_h), Some(&target_nx)) =
        (prev_hist_nx, idx_map.get(&format!("doc:{}", target_doc.id)))
    {
        graph.add_edge(last_h, target_nx, "yields".into());
    }

    // Add inter-document edges among related constructs (avoiding duplicate edge if routed via target history)
    for (p, c, op) in &doc_edges {
        if related_docs.contains(p) && related_docs.contains(c) {
            if c == &target_doc.id && !target_doc.history.is_empty() {
                continue;
            }
            if let (Some(&pnx), Some(&cnx)) =
                (idx_map.get(&format!("doc:{p}")), idx_map.get(&format!("doc:{c}")))
            {
                if pnx != cnx {
                    graph.add_edge(pnx, cnx, op.clone());
                }
            }
        }
    }

    // Topological sort & longest-path layer assignment via `petgraph::algo::toposort`
    let (topo_nodes, is_acyclic) = match toposort(&graph, None) {
        Ok(order) => (order, true),
        Err(_) => (graph.node_indices().collect::<Vec<_>>(), false),
    };

    let mut layers = vec![0usize; graph.node_count()];
    for &nx in &topo_nodes {
        let max_pred = graph
            .neighbors_directed(nx, Direction::Incoming)
            .map(|p| layers[p.index()] + 1)
            .max()
            .unwrap_or(0);
        layers[nx.index()] = max_pred;
    }

    let max_layer = layers.iter().copied().max().unwrap_or(0);
    let layer_count = max_layer + 1;
    let mut per_layer: Vec<Vec<NodeIndex>> = vec![Vec::new(); layer_count];
    for &nx in &topo_nodes {
        per_layer[layers[nx.index()]].push(nx);
    }

    let max_rows_in_layer = per_layer.iter().map(|v| v.len()).max().unwrap_or(1).max(1);
    let col_w = 236.0;
    let row_h = 84.0;
    let node_w = 186.0;
    let width = ((layer_count as f64) * col_w + 48.0).max(520.0);
    let height = ((max_rows_in_layer as f64) * row_h + 44.0).max(150.0);

    let mut coords = vec![(0.0_f64, 0.0_f64); graph.node_count()];
    for (l_idx, bucket) in per_layer.iter().enumerate() {
        let x = 24.0 + (l_idx as f64) * col_w;
        let bucket_h = (bucket.len() as f64) * row_h;
        let start_y = ((height - bucket_h) * 0.5).max(18.0) + 28.0;
        for (r_idx, &nx) in bucket.iter().enumerate() {
            coords[nx.index()] = (x, start_y + (r_idx as f64) * row_h);
        }
    }

    let topological_order: Vec<String> = topo_nodes
        .iter()
        .map(|&nx| graph[nx].title.clone())
        .collect();

    let mut ancestor_docs = 0usize;
    let mut descendant_docs = 0usize;
    let target_layer = idx_map
        .get(&format!("doc:{}", target_doc.id))
        .map(|nx| layers[nx.index()])
        .unwrap_or(0);
    for &nx in &topo_nodes {
        if graph[nx].is_document_node && !graph[nx].is_active_target {
            if layers[nx.index()] <= target_layer {
                ancestor_docs += 1;
            } else {
                descendant_docs += 1;
            }
        }
    }

    let nodes: Vec<LineageDagNodeView> = topo_nodes
        .iter()
        .map(|&nx| {
            let item = &graph[nx];
            let (x, y) = coords[nx.index()];
            LineageDagNodeView {
                node_id: item.node_id.clone(),
                doc_id: item.doc_id.clone(),
                title: item.title.clone(),
                subtitle: item.subtitle.clone(),
                operation: item.operation.clone(),
                timestamp: item.timestamp.clone(),
                length_bp: item.length_bp,
                topology: item.topology.clone(),
                color: item.color.clone(),
                is_active_target: item.is_active_target,
                is_document_node: item.is_document_node,
                layer: layers[nx.index()],
                x,
                y,
            }
        })
        .collect();

    let mut edges = Vec::with_capacity(graph.edge_count());
    for (ei, e_idx) in graph.edge_indices().enumerate() {
        if let Some((u, v)) = graph.edge_endpoints(e_idx) {
            let (ux, uy) = coords[u.index()];
            let (vx, vy) = coords[v.index()];
            let x1 = ux + node_w;
            let y1 = uy;
            let x2 = vx;
            let y2 = vy;
            let mx = (x1 + x2) * 0.5;
            let svg_path = format!(
                "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
                x1, y1, mx, y1, mx, y2, x2, y2
            );
            edges.push(LineageDagEdgeView {
                id: format!("dag-edge-{ei}"),
                from_id: graph[u].node_id.clone(),
                to_id: graph[v].node_id.clone(),
                label: graph[e_idx].clone(),
                svg_path,
            });
        }
    }

    ConstructLineageDagReport {
        width,
        height,
        layer_count,
        is_acyclic,
        topological_order,
        ancestor_document_count: ancestor_docs,
        descendant_document_count: descendant_docs,
        nodes,
        edges,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinWorkflowMacroDef {
    pub id: String,
    pub rust_macro_id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub code: String,
}

/// Returns the catalog of built-in Rust-accelerated workflow macros (with reference script templates)
/// so the frontend plugin studio contains zero duplicated macro definitions.
pub fn get_builtin_workflow_macros_rust() -> Vec<BuiltinWorkflowMacroDef> {
    vec![
        BuiltinWorkflowMacroDef {
            id: "js-crispr-spcas9".into(),
            rust_macro_id: "js-crispr-spcas9-scanner".into(),
            name: "CRISPR-SpCas9 gRNA & PAM (NGG) Scanner".into(),
            category: "Genome Editing".into(),
            description: "Scans both strands for 20-nt SpCas9 protospacers preceding 5'-NGG-3' PAM motifs and ranks them by a GC/3'-G/poly-T heuristic.".into(),
            code: "// Executed natively via Rust Doench 2016 CRISPR Engine (`find_crispr_guides`)\nfunction runPlugin(doc) {\n  return { macro: 'js-crispr-spcas9-scanner', sequenceLength: doc.sequence.length };\n}".into(),
        },
        BuiltinWorkflowMacroDef {
            id: "js-goldengate-domestication".into(),
            rust_macro_id: "js-goldengate-domestication".into(),
            name: "Golden Gate Type IIS Domestication Auditor".into(),
            category: "Synthetic Biology".into(),
            description: "Checks coding sequences via Rust `aho-corasick` automaton for internal BsaI (GGTCTC), BsmBI (CGTCTC), and BbsI (GAAGAC) sites and recommends silent point mutations.".into(),
            code: "// Executed natively via Rust `aho-corasick` multi-pattern automaton\nfunction runPlugin(doc) {\n  return { macro: 'js-goldengate-domestication', sequenceLength: doc.sequence.length };\n}".into(),
        },
        BuiltinWorkflowMacroDef {
            id: "js-kozak-rbs-auditor".into(),
            rust_macro_id: "js-kozak-rbs-auditor".into(),
            name: "Translation Initiation (Kozak / Shine-Dalgarno) Profiler".into(),
            category: "Expression Optimization".into(),
            description: "Inspects upstream leaders of CDS annotations for prokaryotic Shine-Dalgarno (AGGAGG) and mammalian Kozak (GCCACCATGG) initiation strength.".into(),
            code: "// Executed natively via Rust CDS Translation Initiation Profiler\nfunction runPlugin(doc) {\n  return { macro: 'js-kozak-rbs-auditor', cdsCount: doc.features.length };\n}".into(),
        },
        BuiltinWorkflowMacroDef {
            id: "js-jaspar-pssm-tf-scanner".into(),
            rust_macro_id: "js-jaspar-pssm-tf-scanner".into(),
            name: "JASPAR Position-Specific Scoring Matrix (PSSM) TF Scanner".into(),
            category: "Regulatory Genomics".into(),
            description: "Scans both strands against 10 JASPAR & phage/bacterial Position Weight Matrices (`rust-bio` `DNAMotif` PSSM) and reports log-odds bit scores.".into(),
            code: "// Executed natively via `bio::pattern_matching::pssm::DNAMotif` in Rust\nfunction runPlugin(doc) {\n  return { macro: 'js-jaspar-pssm-tf-scanner', sequenceLength: doc.sequence.length };\n}".into(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample_library_data::get_sample_library;

    #[test]
    fn computes_single_pass_table_metrics_csv_interval_extract_and_petgraph_lineage_dag() {
        let docs = get_sample_library();
        let pet = &docs[0];
        let m = compute_document_table_metrics_rust(pet);
        assert_eq!(m.doc_type_label, "Plasmid / Vector");
        assert_eq!(m.icon_kind, "circular-dna");
        assert!(m.length_label.ends_with(" bp"));

        let csv_txt = export_table_delimited_csv_rust(
            &["Name".into(), "Length".into()],
            &[vec!["pET-28a, eGFP".into(), m.length_label.clone()]],
            ",",
        );
        assert!(csv_txt.contains("\"pET-28a, eGFP\""));

        let ext = extract_region_with_annotations_rust(pet, 1, 1500, "2026-10-31T08:00:00Z");
        assert_eq!(ext.sequence.len(), 1500);
        assert!(!ext.features.is_empty());

        let mut all = vec![pet.clone(), ext.clone()];
        let dag = build_construct_lineage_dag_rust(&ext, &all);
        assert!(dag.is_acyclic);
        assert!(dag.ancestor_document_count >= 1);
        assert!(!dag.edges.is_empty());
        all.clear();
    }
}
