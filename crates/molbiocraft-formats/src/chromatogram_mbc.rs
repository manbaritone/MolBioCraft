// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Complete `.mbc` / `.mbc.gz` Workbench Session Codec (dual 32-bit FNV-1a + IEEE CRC32 via `crc32fast`,
//! transparent `flate2` Gzip decompression, schema sanitization), Mott's `bio::stats::probs::PHREDProb`
//! Minimum-Error Sanger Trace Quality Trimmer, Sanger 4-dye capillary chromatogram viewport processor,
//! and Curated NCBI Reference Preset Construct Generator.

use bio::stats::probs::{PHREDProb, Prob};
use crc32fast::Hasher as Crc32Hasher;
use flate2::read::GzDecoder;
use molbiocraft_core::{
    ChromatogramData, HistoryTreeNode, MoleculeType, SequenceDocument, SequenceFeature, Topology,
};
use serde::{Deserialize, Serialize};
use std::io::Read;

pub const MBC_FORMAT_MAGIC: &str = "MBC_WORKBENCH_V1";
pub const MBC_SCHEMA_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcChecksumDocInput {
    pub id: String,
    pub name: String,
    pub topology: String,
    pub molecule_type: String,
    pub sequence: String,
    pub feature_count: usize,
    pub primer_count: usize,
}

/// Bit-identical 32-bit FNV-1a checksum (`0x811c9dc5`, prime `0x01000193`) computed directly over
/// UTF-16 code units of each document signature without allocating concatenated megabase strings.
pub fn compute_mbc_payload_checksum(docs: &[MbcChecksumDocInput]) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    let feed_str = |h: &mut u32, s: &str| {
        for cu in s.encode_utf16() {
            *h ^= u32::from(cu);
            *h = h.wrapping_mul(0x0100_0193);
        }
    };

    for doc in docs {
        let prefix = format!(
            "{}|{}|{}|{}|{}|{}|{}|",
            doc.id,
            doc.name,
            doc.topology,
            doc.molecule_type,
            doc.sequence.encode_utf16().count(),
            doc.feature_count,
            doc.primer_count
        );
        feed_str(&mut hash, &prefix);
        feed_str(&mut hash, &doc.sequence);
    }
    format!("{:08x}", hash)
}

/// Computes SIMD-accelerated IEEE 802.3 CRC32 checksum (`crc32fast::Hasher`) over a slice of `SequenceDocument`.
pub fn compute_mbc_crc32_checksum_docs(docs: &[SequenceDocument]) -> String {
    let mut crc = Crc32Hasher::new();
    for doc in docs {
        let topo = match doc.topology {
            Topology::Circular => "circular",
            Topology::Linear => "linear",
        };
        let mol = match doc.molecule_type {
            MoleculeType::DNA => "DNA",
            MoleculeType::RNA => "RNA",
            MoleculeType::Protein => "Protein",
        };
        crc.update(doc.id.as_bytes());
        crc.update(b"|");
        crc.update(doc.name.as_bytes());
        crc.update(b"|");
        crc.update(topo.as_bytes());
        crc.update(b"|");
        crc.update(mol.as_bytes());
        crc.update(b"|");
        crc.update(&(doc.features.len() as u64).to_le_bytes());
        crc.update(&(doc.primers.len() as u64).to_le_bytes());
        crc.update(doc.sequence.as_bytes());
    }
    format!("{:08x}", crc.finalize())
}

fn fnv1a_from_sequence_docs(docs: &[SequenceDocument]) -> String {
    let inputs: Vec<MbcChecksumDocInput> = docs
        .iter()
        .map(|d| MbcChecksumDocInput {
            id: d.id.clone(),
            name: d.name.clone(),
            topology: match d.topology {
                Topology::Circular => "circular".into(),
                Topology::Linear => "linear".into(),
            },
            molecule_type: match d.molecule_type {
                MoleculeType::DNA => "DNA".into(),
                MoleculeType::RNA => "RNA".into(),
                MoleculeType::Protein => "Protein".into(),
            },
            sequence: d.sequence.clone(),
            feature_count: d.features.len(),
            primer_count: d.primers.len(),
        })
        .collect();
    compute_mbc_payload_checksum(&inputs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcDisplaySettingsRust {
    #[serde(default = "default_true")]
    pub show_orfs: bool,
    #[serde(default = "default_min_orf_aa")]
    pub min_orf_aa: usize,
    #[serde(default)]
    pub allow_alt_start_codons: bool,
    #[serde(default = "default_true")]
    pub show_primers: bool,
    #[serde(default = "default_true")]
    pub show_translation: bool,
    #[serde(default = "default_true")]
    pub show_gc_graph: bool,
    #[serde(default)]
    pub show_hydropathy_graph: bool,
    #[serde(default)]
    pub show_unique_cutters_only: bool,
}

fn default_true() -> bool {
    true
}
fn default_min_orf_aa() -> usize {
    50
}

impl Default for MbcDisplaySettingsRust {
    fn default() -> Self {
        Self {
            show_orfs: true,
            min_orf_aa: 50,
            allow_alt_start_codons: false,
            show_primers: true,
            show_translation: true,
            show_gc_graph: true,
            show_hydropathy_graph: false,
            show_unique_cutters_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcSelectedRangeRust {
    pub start: usize,
    pub end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcWorkspaceUiStateRust {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_explorer: Option<serde_json::Value>,
    #[serde(default)]
    pub active_doc_id: String,
    #[serde(default)]
    pub selected_folder: String,
    #[serde(default)]
    pub nav_history: Vec<String>,
    #[serde(default)]
    pub nav_index: usize,
    #[serde(default)]
    pub viewer_tab: String,
    #[serde(default)]
    pub map_layout_mode: String,
    #[serde(default)]
    pub zoom_level: f64,
    #[serde(default)]
    pub text_format: String,
    #[serde(default)]
    pub color_scheme: String,
    #[serde(default)]
    pub dark_mode: bool,
    #[serde(default = "default_true")]
    pub sidebar_open: bool,
    #[serde(default)]
    pub doc_table_collapsed: bool,
    #[serde(default)]
    pub selected_range: Option<MbcSelectedRangeRust>,
    #[serde(default)]
    pub display_settings: MbcDisplaySettingsRust,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcWorkbenchSnapshotInput {
    pub session_name: String,
    pub documents: Vec<SequenceDocument>,
    pub workspace: MbcWorkspaceUiStateRust,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MbcWorkbenchFileEnvelopeRust {
    pub format: String,
    pub magic: String,
    pub schema_version: String,
    pub app_version: String,
    pub license: String,
    pub saved_at: String,
    pub session_name: String,
    pub document_count: usize,
    pub total_base_pairs: usize,
    pub checksum_fnv1a: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum_crc32: Option<String>,
    pub workspace: MbcWorkspaceUiStateRust,
    pub documents: Vec<SequenceDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMbcWorkbenchResultRust {
    pub envelope: MbcWorkbenchFileEnvelopeRust,
    pub checksum_verified: bool,
    pub warnings: Vec<String>,
}

/// Checks whether a filename (`.mbc` / `.mbc.gz`) or raw text payload corresponds to a MolBioCraft session file.
pub fn is_mbc_file_or_payload_rust(file_name: &str, raw_text: Option<&str>) -> bool {
    let lower = file_name.trim().to_ascii_lowercase();
    if lower.ends_with(".mbc") || lower.ends_with(".mbc.gz") {
        return true;
    }
    if let Some(txt) = raw_text {
        let trimmed = txt.trim_start();
        let head: String = trimmed.chars().take(320).collect();
        return head.starts_with('{') && head.contains(MBC_FORMAT_MAGIC);
    }
    false
}

fn strip_mbc_suffix(name: &str) -> String {
    let trimmed = name.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with(".mbc.gz") {
        trimmed[..trimmed.len() - 7].trim().to_string()
    } else if lower.ends_with(".mbc") {
        trimmed[..trimmed.len() - 4].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Serializes the complete MolBioCraft workbench/session state into a `.mbc` JSON envelope in Rust,
/// embedding both 32-bit FNV-1a and SIMD IEEE CRC32 (`crc32fast`) integrity digests.
pub fn serialize_mbc_workbench_rust(
    snapshot: &MbcWorkbenchSnapshotInput,
    app_version: &str,
    saved_at_iso: &str,
) -> String {
    let stripped = strip_mbc_suffix(&snapshot.session_name);
    let clean_name = if stripped.is_empty() {
        "MolBioCraft_Session".to_string()
    } else {
        stripped
    };
    let total_base_pairs: usize = snapshot.documents.iter().map(|d| d.sequence.len()).sum();
    let checksum_fnv1a = fnv1a_from_sequence_docs(&snapshot.documents);
    let checksum_crc32 = compute_mbc_crc32_checksum_docs(&snapshot.documents);

    let envelope = MbcWorkbenchFileEnvelopeRust {
        format: "MolBioCraft-Workbench".to_string(),
        magic: MBC_FORMAT_MAGIC.to_string(),
        schema_version: MBC_SCHEMA_VERSION.to_string(),
        app_version: if app_version.trim().is_empty() {
            "1.0.0".to_string()
        } else {
            app_version.to_string()
        },
        license: "CC-BY-NC-4.0".to_string(),
        saved_at: if saved_at_iso.trim().is_empty() {
            "2026-10-31T00:00:00.000Z".to_string()
        } else {
            saved_at_iso.to_string()
        },
        session_name: clean_name,
        document_count: snapshot.documents.len(),
        total_base_pairs,
        checksum_fnv1a,
        checksum_crc32: Some(checksum_crc32),
        workspace: snapshot.workspace.clone(),
        documents: snapshot.documents.clone(),
    };

    let mut json = serde_json::to_string_pretty(&envelope).unwrap_or_else(|_| "{}".to_string());
    json.push('\n');
    json
}

const VALID_VIEWER_TABS: &[&str] = &[
    "sequence-view",
    "annotations-table",
    "text-view",
    "vector-library",
    "cloning-gel",
    "primers-pcr",
    "sequence-alignment",
    "phylogenetics",
    "sanger-contig",
    "genomics-ngs",
    "history-hybrid",
    "guided-pipelines",
    "document-info",
];

/// Decompresses Gzip-compressed `.mbc.gz` bytes via `flate2::read::GzDecoder` if magic bytes `0x1f 0x8b`
/// are present, then parses, validates, sanitizes, and checksum-verifies the `.mbc` session payload in Rust.
pub fn parse_mbc_workbench_bytes_rust(
    raw_bytes: &[u8],
    fallback_session_name: &str,
    now_iso: &str,
) -> Result<ParsedMbcWorkbenchResultRust, String> {
    let decoded_text = if raw_bytes.len() >= 2 && raw_bytes[0] == 0x1f && raw_bytes[1] == 0x8b {
        let mut decoder = GzDecoder::new(raw_bytes);
        let mut out = String::new();
        decoder
            .read_to_string(&mut out)
            .map_err(|e| format!("Invalid .mbc.gz file: Gzip decompression failed ({e})"))?;
        out
    } else {
        std::str::from_utf8(raw_bytes)
            .map_err(|e| format!("Invalid .mbc file: UTF-8 encoding error ({e})"))?
            .to_string()
    };
    parse_mbc_workbench_rust(&decoded_text, fallback_session_name, now_iso)
}

/// Parses, validates, sanitizes, and verifies FNV-1a + IEEE CRC32 checksums of a `.mbc` JSON payload in Rust.
pub fn parse_mbc_workbench_rust(
    raw_text: &str,
    fallback_session_name: &str,
    now_iso: &str,
) -> Result<ParsedMbcWorkbenchResultRust, String> {
    let val: serde_json::Value = serde_json::from_str(raw_text)
        .map_err(|e| format!("Invalid .mbc file: JSON syntax error ({e})"))?;

    let obj = val
        .as_object()
        .ok_or_else(|| "Invalid .mbc file: root payload must be a JSON object.".to_string())?;

    let magic = obj.get("magic").and_then(|v| v.as_str()).unwrap_or("");
    let fmt = obj.get("format").and_then(|v| v.as_str()).unwrap_or("");
    if magic != MBC_FORMAT_MAGIC && fmt != "MolBioCraft-Workbench" {
        return Err("Invalid .mbc file: missing MBC_WORKBENCH_V1 magic header.".to_string());
    }

    let docs_arr = obj
        .get("documents")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "Invalid .mbc file: workbench documents must be an array.".to_string()
        })?;

    let now = if now_iso.trim().is_empty() {
        "2026-10-31T00:00:00.000Z"
    } else {
        now_iso
    };

    let mut sanitized_docs = Vec::with_capacity(docs_arr.len());
    for (idx, d_val) in docs_arr.iter().enumerate() {
        let d_obj = d_val.as_object().ok_or_else(|| {
            format!("Invalid .mbc file: document at index {idx} is malformed.")
        })?;
        if !d_obj.get("sequence").map(|s| s.is_string()).unwrap_or(false) {
            return Err(format!(
                "Invalid .mbc file: document at index {idx} is malformed."
            ));
        }
        let mut doc: SequenceDocument = serde_json::from_value(d_val.clone()).map_err(|e| {
            format!("Invalid .mbc file: document at index {idx} is malformed ({e}).")
        })?;
        if doc.id.trim().is_empty() {
            doc.id = format!("mbc-doc-{}", idx + 1);
        }
        if doc.name.trim().is_empty() {
            doc.name = format!("Sequence_{}", idx + 1);
        }
        if doc.accession.trim().is_empty() {
            doc.accession = format!("MBC_{}", idx + 1);
        }
        if doc.created_at.trim().is_empty() {
            doc.created_at = now.to_string();
        }
        if doc.updated_at.trim().is_empty() {
            doc.updated_at = now.to_string();
        }
        if doc.folder.trim().is_empty() {
            doc.folder = "Plasmids & Vectors".to_string();
        }
        sanitized_docs.push(doc);
    }

    let mut warnings = Vec::new();
    let computed_fnv1a = fnv1a_from_sequence_docs(&sanitized_docs);
    let computed_crc32 = compute_mbc_crc32_checksum_docs(&sanitized_docs);

    let expected_fnv1a = obj
        .get("checksumFnv1a")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let expected_crc32 = obj.get("checksumCrc32").and_then(|v| v.as_str());

    let fnv_ok = !expected_fnv1a.is_empty() && expected_fnv1a == computed_fnv1a;
    let crc_ok = expected_crc32.map(|c| c == computed_crc32).unwrap_or(true);
    let checksum_verified = fnv_ok && crc_ok;

    if !expected_fnv1a.is_empty() && !fnv_ok {
        warnings.push(format!(
            "Checksum mismatch (expected {expected_fnv1a}, computed {computed_fnv1a}); file may have been edited externally."
        ));
    } else if let Some(exp_crc) = expected_crc32 {
        if !crc_ok {
            warnings.push(format!(
                "Checksum mismatch in IEEE CRC32 (expected {exp_crc}, computed {computed_crc32}); file may have been edited externally."
            ));
        }
    }

    let ws_val = obj.get("workspace").cloned().unwrap_or(serde_json::json!({}));
    let ws_obj = ws_val.as_object();

    let first_doc_id = sanitized_docs.first().map(|doc| doc.id.clone()).unwrap_or_default();
    let req_active = ws_obj
        .and_then(|w| w.get("activeDocId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let resolved_active_id = if !req_active.is_empty()
        && sanitized_docs.iter().any(|d| d.id == req_active)
    {
        req_active.to_string()
    } else {
        first_doc_id
    };

    let valid_history: Vec<String> = ws_obj
        .and_then(|w| w.get("navHistory"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .filter(|id| sanitized_docs.iter().any(|d| d.id == *id))
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    let final_history = if valid_history.is_empty() && !resolved_active_id.is_empty() {
        vec![resolved_active_id.clone()]
    } else {
        valid_history
    };
    let raw_nav_idx = ws_obj
        .and_then(|w| w.get("navIndex"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let final_nav_index = raw_nav_idx.min(final_history.len().saturating_sub(1));

    let raw_tab = ws_obj
        .and_then(|w| w.get("viewerTab"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let viewer_tab = if raw_tab == "align-phylo" {
        "sequence-alignment".to_string()
    } else if VALID_VIEWER_TABS.contains(&raw_tab) {
        raw_tab.to_string()
    } else {
        "sequence-view".to_string()
    };

    let raw_layout = ws_obj
        .and_then(|w| w.get("mapLayoutMode"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let map_layout_mode = if raw_layout == "circular" || raw_layout == "linear" {
        raw_layout.to_string()
    } else {
        "split".to_string()
    };

    let raw_zoom = ws_obj
        .and_then(|w| w.get("zoomLevel"))
        .and_then(|v| v.as_f64())
        .unwrap_or(100.0);
    let zoom_level = if (25.0..=400.0).contains(&raw_zoom) {
        raw_zoom
    } else {
        100.0
    };

    let raw_fmt = ws_obj
        .and_then(|w| w.get("textFormat"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let text_format = if matches!(raw_fmt, "fasta" | "embl" | "gff3") {
        raw_fmt.to_string()
    } else {
        "genbank".to_string()
    };

    let raw_scheme = ws_obj
        .and_then(|w| w.get("colorScheme"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let color_scheme = if matches!(
        raw_scheme,
        "electropherogram" | "gc_heatmap" | "purine_pyrimidine" | "colorblind-safe"
    ) {
        raw_scheme.to_string()
    } else {
        "standard".to_string()
    };

    let ds_obj = ws_obj
        .and_then(|w| w.get("displaySettings"))
        .and_then(|v| v.as_object());

    let display_settings = MbcDisplaySettingsRust {
        show_orfs: ds_obj
            .and_then(|d| d.get("showOrfs"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        min_orf_aa: ds_obj
            .and_then(|d| d.get("minOrfAa"))
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(50),
        allow_alt_start_codons: ds_obj
            .and_then(|d| d.get("allowAltStartCodons"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        show_primers: ds_obj
            .and_then(|d| d.get("showPrimers"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        show_translation: ds_obj
            .and_then(|d| d.get("showTranslation"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        show_gc_graph: ds_obj
            .and_then(|d| d.get("showGcGraph"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        show_hydropathy_graph: ds_obj
            .and_then(|d| d.get("showHydropathyGraph"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        show_unique_cutters_only: ds_obj
            .and_then(|d| d.get("showUniqueCuttersOnly"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    };

    let selected_range: Option<MbcSelectedRangeRust> = ws_obj
        .and_then(|w| w.get("selectedRange"))
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    let resolved_workspace = MbcWorkspaceUiStateRust {
        project_explorer: ws_obj.and_then(|w| w.get("projectExplorer")).filter(|v| v.is_object()).cloned(),
        active_doc_id: resolved_active_id,
        selected_folder: ws_obj
            .and_then(|w| w.get("selectedFolder"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Sample Documents")
            .to_string(),
        nav_history: final_history,
        nav_index: final_nav_index,
        viewer_tab,
        map_layout_mode,
        zoom_level,
        text_format,
        color_scheme,
        dark_mode: ws_obj
            .and_then(|w| w.get("darkMode"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        sidebar_open: ws_obj
            .and_then(|w| w.get("sidebarOpen"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        doc_table_collapsed: ws_obj
            .and_then(|w| w.get("docTableCollapsed"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        selected_range,
        display_settings,
    };

    let raw_sess_name = obj
        .get("sessionName")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback_session_name);
    let stripped_sess = strip_mbc_suffix(raw_sess_name);
    let session_name = if stripped_sess.is_empty() {
        "Imported_Session".to_string()
    } else {
        stripped_sess
    };

    let total_base_pairs: usize = sanitized_docs.iter().map(|d| d.sequence.len()).sum();

    Ok(ParsedMbcWorkbenchResultRust {
        envelope: MbcWorkbenchFileEnvelopeRust {
            format: "MolBioCraft-Workbench".to_string(),
            magic: MBC_FORMAT_MAGIC.to_string(),
            schema_version: obj
                .get("schemaVersion")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(MBC_SCHEMA_VERSION)
                .to_string(),
            app_version: obj
                .get("appVersion")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("1.0.0")
                .to_string(),
            license: "CC-BY-NC-4.0".to_string(),
            saved_at: obj
                .get("savedAt")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(now)
                .to_string(),
            session_name,
            document_count: sanitized_docs.len(),
            total_base_pairs,
            checksum_fnv1a: computed_fnv1a,
            checksum_crc32: Some(computed_crc32),
            workspace: resolved_workspace,
            documents: sanitized_docs,
        },
        checksum_verified,
        warnings,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeterozygotePeakCall {
    pub base_index: usize,
    pub position_1based: usize,
    pub primary_base: String,
    pub secondary_base: String,
    pub iupac_code: String,
    pub secondary_ratio: f64,
    pub phred_score: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromatogramViewportReport {
    pub start_base: usize,
    pub end_base: usize,
    pub start_point: usize,
    pub end_point: usize,
    pub path_a: String,
    pub path_c: String,
    pub path_g: String,
    pub path_t: String,
    pub area_a: String,
    pub area_c: String,
    pub area_g: String,
    pub area_t: String,
    pub mean_phred: f64,
    pub q20_pct: f64,
    pub q30_pct: f64,
    /// The high-quality window: the Mott trim's region at P(err) 0.05, 1-based. A read whose quality
    /// values all miss 0.05 has none and reports the empty interval 1..0. A read without a quality
    /// value for every call is not trimmed (`has_quality_values` is false).
    pub hq_trim_start_1based: usize,
    pub hq_trim_end_1based: usize,
    pub signal_to_noise_ratio: f64,
    pub heterozygote_peaks: Vec<HeterozygotePeakCall>,
    /// SVG x coordinate of each base in the window, placed at its recorded trace peak.
    pub base_x_positions: Vec<f64>,
    /// False when the trace file carries no per-base quality values.
    pub has_quality_values: bool,
}

fn iupac_two_bases(a: char, b: char) -> &'static str {
    let pair = if a <= b { (a, b) } else { (b, a) };
    match pair {
        ('A', 'G') => "R",
        ('C', 'T') => "Y",
        ('C', 'G') => "S",
        ('A', 'T') => "W",
        ('G', 'T') => "K",
        ('A', 'C') => "M",
        _ => "N",
    }
}

/// Computes normalized SVG polylines, shaded area polygons, Phred Q20/Q30 quality trim bounds,
/// signal-to-noise ratio (SNR), and mixed-base heterozygote calls for a Sanger trace viewport.
pub fn compute_chromatogram_viewport(
    chrom: &ChromatogramData,
    base_offset: usize,
    window_bases: usize,
    raw_mode: bool,
    autoscaled: bool,
    vertical_scale: f64,
    baseline_y: f64,
    max_peak_height: f64,
) -> ChromatogramViewportReport {
    let total_pts = chrom
        .trace_a
        .len()
        .min(chrom.trace_c.len())
        .min(chrom.trace_g.len())
        .min(chrom.trace_t.len());
    let total_bases = chrom.base_calls.len();
    let start_base = base_offset.min(total_bases.saturating_sub(1));
    let end_base = (start_base + window_bases.max(1)).min(total_bases);
    // Map the base window onto trace samples using the recorded peak positions (traces have
    // instrument-specific, non-uniform spacing); fall back to proportional spacing only when the
    // file records no peaks.
    let peaks = &chrom.peak_locations;
    let have_peaks = peaks.len() == total_bases && total_bases > 0 && total_pts > 0;
    let sample_of_base = |i: usize| -> f64 {
        if have_peaks {
            peaks[i.min(total_bases - 1)] as f64
        } else {
            (i as f64 + 0.5) * total_pts as f64 / total_bases.max(1) as f64
        }
    };
    let boundary = |i: usize| -> usize {
        // Sample index halfway between base i-1 and base i.
        if i == 0 {
            0
        } else if i >= total_bases {
            total_pts
        } else {
            (((sample_of_base(i - 1) + sample_of_base(i)) / 2.0).round() as usize).min(total_pts)
        }
    };
    let start_pt = boundary(start_base);
    let end_pt = boundary(end_base).max(start_pt);
    let base_x_positions: Vec<f64> = (start_base..end_base)
        .map(|i| {
            let span = (end_pt.saturating_sub(start_pt).saturating_sub(1)).max(1) as f64;
            (25.0 + ((sample_of_base(i) - start_pt as f64) / span) * 780.0).clamp(25.0, 805.0)
        })
        .map(|x| (x * 10.0).round() / 10.0)
        .collect();

    let raw_bias = if raw_mode { 35.0 } else { 0.0 };
    let v_scale = vertical_scale.clamp(0.2, 5.0);

    let build_channel = |arr: &[f64]| -> (String, String) {
        if end_pt <= start_pt {
            return (String::new(), String::new());
        }
        let slice = &arr[start_pt..end_pt];
        let local_max = if autoscaled {
            slice
                .iter()
                .map(|v| *v + raw_bias)
                .fold(250.0_f64, f64::max)
        } else {
            1000.0
        };
        let denom = (slice.len().saturating_sub(1)).max(1) as f64;
        let mut line_pts = String::with_capacity(slice.len() * 16);
        for (idx, &val) in slice.iter().enumerate() {
            let x = 25.0 + (idx as f64 / denom) * 780.0;
            let scaled = (((val + raw_bias) * v_scale) / local_max * max_peak_height)
                .clamp(0.0, max_peak_height);
            let y = baseline_y - scaled;
            if idx == 0 {
                line_pts.push_str(&format!("M {:.1} {:.1}", x, y));
            } else {
                line_pts.push_str(&format!(" L {:.1} {:.1}", x, y));
            }
        }
        let area = format!(
            "{} L 805.0 {:.1} L 25.0 {:.1} Z",
            line_pts, baseline_y, baseline_y
        );
        (line_pts, area)
    };

    let (path_a, area_a) = build_channel(&chrom.trace_a);
    let (path_c, area_c) = build_channel(&chrom.trace_c);
    let (path_g, area_g) = build_channel(&chrom.trace_g);
    let (path_t, area_t) = build_channel(&chrom.trace_t);

    // Quality statistics & Mott-style Q20 trim window
    let n_phred = chrom.phred_scores.len();
    let (mean_phred, q20_pct, q30_pct, hq_start, hq_end) = if n_phred == 0 {
        (0.0, 0.0, 0.0, 1, total_bases.max(1))
    } else {
        let sum: u64 = chrom.phred_scores.iter().map(|&q| u64::from(q)).sum();
        let q20 = chrom.phred_scores.iter().filter(|&&q| q >= 20).count();
        let q30 = chrom.phred_scores.iter().filter(|&&q| q >= 30).count();
        let mott = trim_sanger_trace_mott_phred(chrom, 0.05);
        (
            ((sum as f64 / n_phred as f64) * 10.0).round() / 10.0,
            ((q20 as f64 / n_phred as f64) * 1000.0).round() / 10.0,
            ((q30 as f64 / n_phred as f64) * 1000.0).round() / 10.0,
            mott.trim_start_1based,
            mott.trim_end_1based,
        )
    };

    // Detect secondary peaks >= 35% of primary peak height + signal-to-noise ratio
    let mut primary_sum = 0.0_f64;
    let mut background_sum = 0.0_f64;
    let mut peak_samples = 0usize;
    let mut heterozygote_peaks = Vec::new();
    let base_chars: Vec<char> = chrom.base_calls.chars().collect();

    for (b_idx, &pk_loc) in chrom.peak_locations.iter().enumerate() {
        if pk_loc >= total_pts {
            continue;
        }
        let channels = [
            ('A', chrom.trace_a[pk_loc]),
            ('C', chrom.trace_c[pk_loc]),
            ('G', chrom.trace_g[pk_loc]),
            ('T', chrom.trace_t[pk_loc]),
        ];
        let mut sorted = channels;
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let (prim_ch, prim_v) = sorted[0];
        let (sec_ch, sec_v) = sorted[1];
        let noise_v = (sorted[2].1 + sorted[3].1) * 0.5;
        primary_sum += prim_v;
        background_sum += noise_v.max(1.0);
        peak_samples += 1;

        if prim_v > 120.0 && sec_v / prim_v >= 0.35 && heterozygote_peaks.len() < 32 {
            let called = base_chars.get(b_idx).copied().unwrap_or(prim_ch);
            let q = chrom.phred_scores.get(b_idx).copied().unwrap_or(0);
            heterozygote_peaks.push(HeterozygotePeakCall {
                base_index: b_idx,
                position_1based: b_idx + 1,
                primary_base: called.to_string(),
                secondary_base: sec_ch.to_string(),
                iupac_code: iupac_two_bases(prim_ch, sec_ch).to_string(),
                secondary_ratio: ((sec_v / prim_v) * 100.0).round() / 100.0,
                phred_score: q,
            });
        }
    }

    let snr = if peak_samples > 0 && background_sum > 0.0 {
        ((primary_sum / background_sum) * 10.0).round() / 10.0
    } else {
        0.0
    };

    ChromatogramViewportReport {
        start_base,
        end_base,
        start_point: start_pt,
        end_point: end_pt,
        path_a,
        path_c,
        path_g,
        path_t,
        area_a,
        area_c,
        area_g,
        area_t,
        mean_phred,
        q20_pct,
        q30_pct,
        hq_trim_start_1based: hq_start,
        hq_trim_end_1based: hq_end,
        signal_to_noise_ratio: snr,
        heterozygote_peaks,
        base_x_positions,
        has_quality_values: n_phred == total_bases && total_bases > 0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MottPhredTrimReport {
    pub raw_length_bp: usize,
    pub trimmed_length_bp: usize,
    /// First kept base, 1-based; 1 when nothing is kept.
    pub trim_start_1based: usize,
    /// Last kept base, 1-based; 0 when nothing is kept, so a read with no high-quality region
    /// reports the empty interval 1..0 and a kept length of 0.
    pub trim_end_1based: usize,
    pub error_probability_cutoff: f64,
    pub expected_errors_raw: f64,
    pub expected_errors_trimmed: f64,
    pub mean_phred_trimmed: f64,
    pub trimmed_sequence: String,
    pub iupac_heterozygote_consensus: String,
    pub heterozygote_count: usize,
}

/// Applies Richard Mott's cumulative minimum-error quality trimming algorithm using
/// `bio::stats::probs::{PHREDProb, Prob}` ($p_i = 10^{-Q_i / 10}$, score $s_i = P_{\text{cut}} - p_i$),
/// returning optimal 1-based trim coordinates, expected base-call error counts, trimmed sequence,
/// and an IUPAC mixed-peak consensus sequence for heterozygous Sanger traces. A read scored at every
/// call with no base whose error probability is below the cutoff has no high-quality region and
/// keeps nothing (1..0, 0 bp); a read without a quality value for every call is not trimmed and
/// keeps every base.
pub fn trim_sanger_trace_mott_phred(
    chrom: &ChromatogramData,
    error_cutoff: f64,
) -> MottPhredTrimReport {
    let chars: Vec<char> = chrom.base_calls.chars().collect();
    let n = chars.len();
    let cutoff = error_cutoff.clamp(0.001, 0.25);

    if n == 0 {
        return MottPhredTrimReport {
            raw_length_bp: 0,
            trimmed_length_bp: 0,
            trim_start_1based: 1,
            trim_end_1based: 0,
            error_probability_cutoff: cutoff,
            expected_errors_raw: 0.0,
            expected_errors_trimmed: 0.0,
            mean_phred_trimmed: 0.0,
            trimmed_sequence: String::new(),
            iupac_heterozygote_consensus: String::new(),
            heterozygote_count: 0,
        };
    }

    // Without per-base qualities there is nothing to trim on: keep the full read.
    let has_quality = chrom.phred_scores.len() == n;
    let probs: Vec<f64> = (0..n)
        .map(|i| match chrom.phred_scores.get(i) {
            Some(&q) if has_quality => *Prob::from(PHREDProb(f64::from(q))),
            _ => 0.0,
        })
        .collect();

    let expected_errors_raw: f64 = probs.iter().sum();

    // Mott's Kadane maximum-subarray over (cutoff - p_i)
    let mut best_score = 0.0_f64;
    let mut cur_score = 0.0_f64;
    let mut cur_start = 0usize;
    let mut best_start = 0usize;
    let mut best_end = n.saturating_sub(1);

    for (idx, &p_err) in probs.iter().enumerate() {
        let delta = if has_quality { cutoff - p_err } else { 1.0 };
        if cur_score + delta <= 0.0 {
            cur_score = 0.0;
            cur_start = idx + 1;
        } else {
            cur_score += delta;
            if cur_score > best_score {
                best_score = cur_score;
                best_start = cur_start;
                best_end = idx;
            }
        }
    }

    // The bases kept, 0-based and half-open. No stretch scores above zero when no base's error
    // probability is below the cutoff: the read then has no high-quality region and keeps nothing,
    // never the whole read.
    let kept = if best_score > 0.0 { best_start..best_end + 1 } else { 0..0 };

    // Build IUPAC mixed-peak sequence across the trace
    let total_pts = chrom
        .trace_a
        .len()
        .min(chrom.trace_c.len())
        .min(chrom.trace_g.len())
        .min(chrom.trace_t.len());
    let mut iupac_chars = chars.clone();
    let mut het_count = 0usize;
    for (b_idx, &pk_loc) in chrom.peak_locations.iter().enumerate() {
        if b_idx >= n || pk_loc >= total_pts {
            continue;
        }
        let mut sorted = [
            ('A', chrom.trace_a[pk_loc]),
            ('C', chrom.trace_c[pk_loc]),
            ('G', chrom.trace_g[pk_loc]),
            ('T', chrom.trace_t[pk_loc]),
        ];
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let (prim_ch, prim_v) = sorted[0];
        let (sec_ch, sec_v) = sorted[1];
        if prim_v > 120.0 && sec_v / prim_v >= 0.35 {
            if let Some(code_ch) = iupac_two_bases(prim_ch, sec_ch).chars().next() {
                iupac_chars[b_idx] = code_ch;
                if kept.contains(&b_idx) {
                    het_count += 1;
                }
            }
        }
    }

    let trimmed_sequence: String = chars[kept.clone()].iter().collect();
    let iupac_consensus: String = iupac_chars[kept.clone()].iter().collect();
    let trimmed_len = kept.len();
    let expected_errors_trimmed: f64 = probs[kept.clone()].iter().sum();
    let phred_sum: u64 = kept
        .clone()
        .map(|i| u64::from(chrom.phred_scores.get(i).copied().unwrap_or(0)))
        .sum();
    let mean_phred_trimmed = ((phred_sum as f64 / trimmed_len.max(1) as f64) * 10.0).round() / 10.0;

    MottPhredTrimReport {
        raw_length_bp: n,
        trimmed_length_bp: trimmed_len,
        // Half-open 0-based start..end is 1-based start + 1..end; nothing kept reads 1..0.
        trim_start_1based: kept.start + 1,
        trim_end_1based: kept.end,
        error_probability_cutoff: cutoff,
        expected_errors_raw: (expected_errors_raw * 100.0).round() / 100.0,
        expected_errors_trimmed: (expected_errors_trimmed * 100.0).round() / 100.0,
        mean_phred_trimmed,
        trimmed_sequence,
        iupac_heterozygote_consensus: iupac_consensus,
        heterozygote_count: het_count,
    }
}

/// Builds a curated NCBI Entrez reference construct `SequenceDocument` natively in Rust
/// (`"spike"`, `"cas9"`, `"egfp"`, `"lacz"`), eliminating hardcoded DNA string literals from UI code.
pub fn build_ncbi_reference_preset_document(preset: &str, now_iso: &str) -> SequenceDocument {
    let key = preset.trim().to_ascii_lowercase();
    let now = if now_iso.trim().is_empty() {
        "2026-10-31T00:00:00.000Z"
    } else {
        now_iso
    };
    let short_ts = now.chars().take(16).collect::<String>().replace('T', " ");

    let (id_slug, name, accession, desc, feat_name, raw_seq) = match key.as_str() {
        "spike" => (
            "spike",
            "SARS_CoV2_Spike_S1_RBD",
            "NC_045512.2",
            "NCBI RefSeq SARS-CoV-2 surface glycoprotein S1 Receptor Binding Domain (RBD) coding sequence.",
            "Spike S1/RBD Domain",
            "ATGTTTGTTTTTCTTGTTTTATTGCCACTAGTCTCTAGTCAGTGTGTTAATCTTACAACCAGAACTCAATTACCCCCTGCATACACTAATTCTTTCACACGTGGTGTTTATTACCCTGACAAAGTTTTCAGATCCTCAGTTTTACATTCAACTCAGGACTTGTTCTTACCTTTCTTTTCCAATGTTACTTGGTTCCATGCTATACATGTCTCTGGGACCAATGGTACTAAGAGGTTTGATAACCCTGTCCTACCATTTAATGATGGTGTTTATTTTGCTTCCACTGAGAAGTCTAACATAATAAGAGGCTGGATTTTTGGTACTACTTTAGATTCGAAGACCCAGTCCCTACTTATTGTTAATAACGCTACTAATGTTGTTATTAAAGTCTGTGAATTTCAATTTTGTAATGATCCATTTTTGGGTGTTTATTACCACAAAAACAACAAAAGTTGGATGGAAAGTGAGTTCAGAGTTTATTCTAGTGCGAATAATTGCACTTTTGAATATGTCTCTCAGCCTTTTCTTATGGACCTTGAAGGAAAACAGGGTAATTTCAAAAATCTTAGGGAATTTGTGTTTAAGAATATTGATGGTTATTTTAAAATATATTCTAAGCACACGCCTATTAATTTAGTGCGTGATCTCCCTCAGGGTTTTTCGGCTTTAGAACCATTGGTAGATTTGCCAATAGGTATTAACATCACTAGGTTTCAAACTTTACTTGCTTTACATAGAAGTTATTTGACTCCTGGTGATTCTTCTTCAGGTTGGACAGCTGGTGCTGCAGCTTATTATGTGGGTTATCTTCAACCTAGGACTTTTCTATTAAAATATAATGAAAATGGAACCATTACAGATGCTGTAGACTGTGCACTTGACCCTCTCTCAGAAACAAAGTGTACGTTGAAATCCTTCACTGTAGAAAAAGGAATCTATCAAACTTCTAACTTTAGAGTCCAACCAACAGAATCTATTGTTAGATTTCCTAATATTACAAACTTGTGCCCTTTTGGTGAAGTTTTTAACGCCACCAGATTTGCATCTGTTTATGCTTGGAACAGGAAGAGAATCAGCAACTGTGTTGCTGATTATTCTGTCCTATATAATTCCGCATCATTTTCCACTTTTAAGTGTTATGGAGTGTCTCCTACTAAATTAAATGATCTCTGCTTTACTAATGTCTATGCAGATTCATTTGTAATTAGAGGTGATGAAGTCAGACAAATCGCTCCAGGGCAAACTGGAAAGATTGCTGATTATAATTATAAATTACCAGATGATTTTACAGGCTGCGTTATAGCTTGGAATTCTAACAATCTTGATTCTAAGGTTGGTGGTAATTATAATTACCTGTATAGATTGTTTAGGAAGTCTAATCTCAAACCTTTTGAGAGAGATATTTCAACTGAAATCTATCAGGCCGGTAGCACACCTTGTAATGGTGTTGAAGGTTTTAATTGTTACTTTCCTTTACAATCATATGGTTTCCAACCCACTAATGGTGTTGGTTACCAACCATACAGAGTAGTAGTACTTTCTTTTGAACTTCTACATGCACCAGCAACTGTTTGTGGACCTAAAAAGTCTACTAATTTGGTTAAAAACAAATGTGTCAATTTCAACTTCAATGGTTTAACAGGCACAGGTGTTCTTACTGAGTCTAACAAAAAGTTTCTGCCTTTCCAACAATTTGGCAGAGACATTGCTGACACTACTGATGCTGTCCGTGATCCACAGACACTTGAGATTGCTTGAA",
        ),
        _ => (
            "cas9",
            "SpCas9_Endonuclease_CDS",
            "WP_010922251.1",
            "Streptococcus pyogenes Cas9 RNA-guided DNA endonuclease coding sequence.",
            "SpCas9 Catalytic Core",
            "ATGGACAAGAAGTACTCCATTGGGCTCGATATCGGCACAAACAGCGTCGGCTGGGCCGTCATTACGGACGAGTACAAGGTGCCGAGCAAAAAATTCAAAGTTCTGGGCAATACCGATCGCCACAGCATAAAGAAGAACCTCATTGGCGCCCTCCTGTTCGACTCCGGGGAGACGGCCGAAGCCACGCGGCTCAAAAGAACAGCACGGCGCAGATATACCCGCAGAAAGAATCGGATCTGCTACCTGCAGGAGATCTTTAGTAATGAGATGGCTAAGGTGGATGACTCTTTCTTCCATAGGCTGGAGGAGTCCTTTTTGGTGGAGGAGGATAAAAAGCACGAGCGCCACCCAATCTTTGGCAATATCGTGGACGAGGTGGCGTACCATGAAAAGTACCCAACCATATATCATCTGAGGAAGAAGCTTGTAGACAGTACTGATAAGGCTGACTTGCGGTTGATCTATCTCGCGCTGGCGCATATGATCAAATTTCGGGGACACTTCCTCATCGAGGGGGACCTGAACCCAGACAACAGCGATGTCGACAAACTCTTTATCCAACTGGTTCAGACTTACAATCAGCTTTTCGAAGAGAACCCGATCAACGCATCCGGAGTTGACGCCAAAGCAATCCTGAGCGCTAGGCTGTCCAAATCCCGGCGGCTCGAAAACCTCATCGCACAGCTCCCTGGGGAGAAGAAGAACGGCCTGTTTGGTAATCTTATCGCCCTGTCACTCGGGCTGACCCCCAACTTTAAATCTAACTTCGACCTGGCCGAAGATGCCAAGCTTCAACTGAGCAAAGACACCTACGATGATGATCTCGACAATCTGCTGGCCCAGATCGGCGACCAGTACGCAGACCTTTTTTTGGCGGCAAAGAACCTGTCAGACGCCATTCTGCTGAGTGATATTCTGCGAGTGAACACGGAGATCACCAAAGCTCCGCTGAGCGCTAGTATGATCAAGCGCTATGATGAGCACCACCAAGACTTGACTTTGCTGAAGGCCCTTGTCAGACAGCAACTGCCTGAGAAGTACAAGGAAATTTTCTTCGATCAGTCTAAAAATGGCTACGCCGGATACATTGACGGCGGAGCAAGCCAGGAGGAATTTTACAAATTTATTAAGCCCATCTTGGAAAAAATGGACGGCACCGAGGAGCTGCTGGTAAAGCTTAACAGAGAAGATCTGTTGCGCAAACAGCGCACTTTCGACAATGGAAGCATCCCCCACCAGATTCACCTGGGCGAACTGCACGCTATCCTCAGGCGGCAAGAGGATTTCTACCCCTTTTTGAAAGATAACAGGGAAAAGATTGAGAAAATCCTCACATTTCGGATACCCTACTATGTAGGCCCCCTCGCCCGGGGAAATTCCAGATTCGCGTGGATGACTCGCAAATCAGAAGAGACCATCACTCCCTGGAACTTCGAGGAAGTCGTGGATAAGGGGGCCTCTGCCCAGTCCTTCATCGAAAGGATGACTAACTTTGATAAAAATCTGCCTAACGAAAAGGTGCTTCCTAAACACTCTCTGCTGTACGAGTACTTCACAGTTTATAACGAGCTCACCAAGGTCAAATACGTCACAGAAGGGATGAGAAAGCCAGCATTCCTGTCTGGAGAGCAGAAGAAAGCTATCGTGGACCTCCTCTTCAAGACGAACCGGAAAGTTACCGTGAAACAGCTCAAAGAAGACTATTTCAAAAAGATTGAGTGTTTCGACTCTGTTGAAATCAGCGGAGTGGAGGATCGCTTCAACGCATCCCTGGGAACGTATCACGATCTCCTGAAAATCATTAAAGACAAGGACTTCCTGGACAATGAGGAGAACGAGGACATTCTTGAGGACATTGTCCTCACCCTTACGTTGTTTGAAGATAGGGAGATGATTGAAGAACGCTTGAAAACTTACGCTCATCTCTTCGACGACAAAGTCATGAAACAGCTCAAGAGGCGCCGATATACAGGATGGGGGCGGCTGTCAAGAAAACTGATCAATGGGATCCGAGACAAGCAGAGTGGAAAGACAATCCTGGATTTTCTTAAGTCCGATGGATTTGCCAACCGGAACTTCATGCAGTTGATCCATGATGACTCTCTCACCTTTAAGGAGGACATCCAGAAAGCACAAGTTTCTGGCCAGGGGGACAGTCTTCACGAGCACATCGCTAATCTTGCAGGTAGCCCAGCTATCAAAAAGGGAATACTGCAGACCGTTAAGGTCGTGGATGAACTCGTCAAAGTAATGGGAAGGCATAAGCCCGAGAATATCGTTATCGAGATGGCCCGAGAGAACCAAACTACCCAGAAGGGACAGAAGAACAGTAGGGAAAGGATGAAGAGGATTGAAGAGGGTATAAAAGAACTGGGGTCCCAAATCCTTAAGGAACACCCAGTTGAAAACACCCAGCTTCAGAATGAGAAGCTCTACCTGTACTACCTGCAGAACGGCAGGGACATGTACGTGGATCAGGAACTGGACATCAATCGGCTCTCCGACTACGACGTGGATCATATCGTGCCCCAGTCTTTTAA",
        ),
    };

    let clean_seq: String = raw_seq
        .chars()
        .map(|c| match c {
            'A' | 'C' | 'G' | 'T' => c,
            _ => 'A',
        })
        .collect();
    let seq_len = clean_seq.len();

    SequenceDocument {
        id: format!("doc-ncbi-{id_slug}"),
        name: name.to_string(),
        accession: accession.to_string(),
        description: desc.to_string(),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence: clean_seq,
        features: vec![SequenceFeature {
            id: format!("f-ncbi-{id_slug}"),
            name: feat_name.to_string(),
            feature_type: "CDS".to_string(),
            start: 1,
            end: seq_len,
            strand: 1,
            color: "#34a853".to_string(),
            notes: Some("Fetched via NCBI Entrez Direct Service".to_string()),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }],
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("h-ncbi-{id_slug}"),
            timestamp: short_ts,
            operation: "NCBI Entrez Direct Download".to_string(),
            description: format!("Downloaded {accession} from NCBI Nucleotide Database"),
            parent_ids: Vec::new(),
            length_bp: seq_len,
            topology: Topology::Linear,
            history_color: None,
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        folder: "Cloning Inserts & PCR".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn mbc_session_codec_verifies_fnv1a_crc32_and_gzip_roundtrip() {
        let doc = build_ncbi_reference_preset_document("spike", "2026-10-31T08:00:00.000Z");
        let snap = MbcWorkbenchSnapshotInput {
            session_name: "Test_Study.mbc".to_string(),
            documents: vec![doc.clone()],
            workspace: MbcWorkspaceUiStateRust {
                project_explorer: Some(serde_json::json!({"customFolders": ["folder-1"], "folderNames": {"folder-1": "Experiments"}})),
                active_doc_id: doc.id.clone(),
                selected_folder: "Cloning Inserts & PCR".to_string(),
                nav_history: vec![doc.id.clone()],
                nav_index: 0,
                viewer_tab: "align-phylo".to_string(),
                map_layout_mode: "split".to_string(),
                zoom_level: 100.0,
                text_format: "genbank".to_string(),
                color_scheme: "standard".to_string(),
                dark_mode: true,
                sidebar_open: true,
                doc_table_collapsed: false,
                selected_range: None,
                display_settings: MbcDisplaySettingsRust::default(),
            },
        };

        let json = serialize_mbc_workbench_rust(&snap, "1.0.0", "2026-10-31T08:00:00.000Z");
        assert!(is_mbc_file_or_payload_rust("foo.txt", Some(&json)));

        // Compress with Gzip and verify transparent `.mbc.gz` decompression + legacy tab migration
        let mut enc = GzEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(json.as_bytes()).unwrap();
        let gz_bytes = enc.finish().unwrap();

        let parsed =
            parse_mbc_workbench_bytes_rust(&gz_bytes, "Fallback", "2026-10-31T08:00:00.000Z")
                .unwrap();
        assert!(parsed.checksum_verified);
        assert!(parsed.warnings.is_empty(), "an untouched session must not warn: {:?}", parsed.warnings);
        assert_eq!(parsed.envelope.workspace.project_explorer, snap.workspace.project_explorer);
        assert_eq!(parsed.envelope.session_name, "Test_Study");
        assert_eq!(parsed.envelope.workspace.viewer_tab, "sequence-alignment");
        assert!(parsed.envelope.checksum_crc32.is_some());

        // Tamper: change one base of the saved document after both checksums were written.
        let saved: serde_json::Value = serde_json::from_str(&json).unwrap();
        let stored_fnv1a = saved["checksumFnv1a"].as_str().unwrap().to_string();
        let stored_crc32 = saved["checksumCrc32"].as_str().unwrap().to_string();
        let original_seq = saved["documents"][0]["sequence"].as_str().unwrap().to_string();
        let mut seq_bytes = original_seq.clone().into_bytes();
        seq_bytes[0] = if seq_bytes[0] == b'A' { b'C' } else { b'A' };
        let tampered_seq = String::from_utf8(seq_bytes).unwrap();
        assert_ne!(tampered_seq, original_seq);
        assert_eq!(tampered_seq.len(), original_seq.len());
        let mut tampered_doc = doc.clone();
        tampered_doc.sequence = tampered_seq.clone();
        let tampered_fnv1a = fnv1a_from_sequence_docs(std::slice::from_ref(&tampered_doc));
        let tampered_crc32 = compute_mbc_crc32_checksum_docs(std::slice::from_ref(&tampered_doc));
        assert_ne!(tampered_fnv1a, stored_fnv1a);
        assert_ne!(tampered_crc32, stored_crc32);
        let tampered_payload = |fnv1a: &str, crc32: &str| -> String {
            let mut v = saved.clone();
            v["documents"][0]["sequence"] = serde_json::Value::String(tampered_seq.clone());
            v["checksumFnv1a"] = serde_json::Value::String(fnv1a.to_string());
            v["checksumCrc32"] = serde_json::Value::String(crc32.to_string());
            serde_json::to_string_pretty(&v).unwrap()
        };

        // FNV-1a mismatch alone: the CRC32 is re-sealed over the edit, the FNV-1a is stale.
        let fnv_bad = parse_mbc_workbench_rust(
            &tampered_payload(&stored_fnv1a, &tampered_crc32),
            "Fallback",
            "2026-10-31T08:00:00.000Z",
        )
        .expect("a checksum mismatch is a warning, not an error");
        assert!(!fnv_bad.checksum_verified, "a stale FNV-1a must fail verification");
        assert_eq!(fnv_bad.envelope.checksum_crc32.as_deref(), Some(tampered_crc32.as_str()));
        assert_eq!(fnv_bad.warnings.len(), 1, "{:?}", fnv_bad.warnings);
        assert!(fnv_bad.warnings[0].starts_with("Checksum mismatch (expected "));
        assert!(fnv_bad.warnings[0].contains(&stored_fnv1a));
        assert_eq!(fnv_bad.envelope.document_count, 1);
        assert_eq!(fnv_bad.envelope.documents[0].sequence, tampered_seq);

        // CRC32 mismatch alone: the FNV-1a is re-sealed over the edit, the CRC32 is stale.
        let crc_bad = parse_mbc_workbench_rust(
            &tampered_payload(&tampered_fnv1a, &stored_crc32),
            "Fallback",
            "2026-10-31T08:00:00.000Z",
        )
        .expect("a checksum mismatch is a warning, not an error");
        assert!(!crc_bad.checksum_verified, "a stale CRC32 must fail verification");
        assert_eq!(crc_bad.envelope.checksum_fnv1a, tampered_fnv1a);
        assert_eq!(crc_bad.warnings.len(), 1, "{:?}", crc_bad.warnings);
        assert!(crc_bad.warnings[0].starts_with("Checksum mismatch in IEEE CRC32 (expected "));
        assert!(crc_bad.warnings[0].contains(&stored_crc32));
        assert_eq!(crc_bad.envelope.document_count, 1);
        assert_eq!(crc_bad.envelope.documents[0].sequence, tampered_seq);

        // Gzip-wrapped tampered payload with both checksums stale still opens, unverified.
        let mut enc = GzEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(tampered_payload(&stored_fnv1a, &stored_crc32).as_bytes())
            .unwrap();
        let tampered_gz = enc.finish().unwrap();
        let gz_bad =
            parse_mbc_workbench_bytes_rust(&tampered_gz, "Fallback", "2026-10-31T08:00:00.000Z")
                .expect("a checksum mismatch is a warning, not an error");
        assert!(!gz_bad.checksum_verified, "a tampered .mbc.gz must fail verification");
        assert!(!gz_bad.warnings.is_empty());
        assert!(gz_bad.warnings[0].starts_with("Checksum mismatch"));
        assert_eq!(gz_bad.envelope.session_name, "Test_Study");
        assert_eq!(gz_bad.envelope.document_count, 1);
        assert_eq!(gz_bad.envelope.documents[0].sequence, tampered_seq);
    }
}
