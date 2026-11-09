// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use crate::commands::{AppBackendState, RestApiEndpointInfo};
use molbiocraft_align::align_pairwise_standard;
use molbiocraft_core::{
    compute_batch_sequence_stats, compute_genome_track_overview, compute_sequence_stats,
    query_platform_diagnostics, reverse_complement, slice_genome_viewport, AlignmentOutput,
    BatchSequenceItem, BatchSequenceStatsEntry, BioEngineError, GenomeTrackOverview,
    GenomeViewportSlice, PlatformDiagnostics, PrimerThermodynamics, SequenceFeature, SequenceStats,
};
use molbiocraft_wasm::dispatch_bio_rpc;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

/// Maximum single-sequence payload accepted over IPC (50 Mbp) to prevent OOM denial-of-service.
const MAX_SEQUENCE_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct BatchProgressEventPayload {
    pub processed: usize,
    pub total: usize,
    pub status: String,
}

fn validate_sequence_input(seq: &str, field_name: &str) -> Result<(), String> {
    let trimmed = seq.trim();
    if trimmed.is_empty() {
        return Err(
            BioEngineError::EmptySequence(format!("{} cannot be empty", field_name)).to_string(),
        );
    }
    if trimmed.len() > MAX_SEQUENCE_BYTES {
        return Err(BioEngineError::PathTooLong(format!(
            "{} length ({} bytes) exceeds 50 MiB IPC safety limit",
            field_name,
            trimmed.len()
        ))
        .to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_platform_diagnostics(
    state: State<'_, AppBackendState>,
) -> Result<PlatformDiagnostics, String> {
    state.record_call();
    query_platform_diagnostics().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_rest_api_info(
    state: State<'_, AppBackendState>,
) -> Result<RestApiEndpointInfo, String> {
    state.record_call();
    Ok(state.rest_endpoint_info())
}

#[tauri::command]
pub async fn cmd_sequence_stats(
    seq: String,
    state: State<'_, AppBackendState>,
) -> Result<SequenceStats, String> {
    state.record_call();
    validate_sequence_input(&seq, "seq")?;

    let fp = AppBackendState::fingerprint(&seq);
    if let Some(cached) = state.get_cached_stats(fp) {
        return Ok(cached);
    }

    let computed = tauri::async_runtime::spawn_blocking(move || compute_sequence_stats(&seq))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))?;

    state.put_cached_stats(fp, computed.clone());
    Ok(computed)
}

/// Batched multi-document sequence statistics command minimizing IPC overhead
/// and emitting real-time `mbc://batch-progress` events to subscribed frontend listeners.
#[tauri::command]
pub async fn cmd_batch_sequence_stats(
    app: AppHandle,
    items: Vec<BatchSequenceItem>,
    state: State<'_, AppBackendState>,
) -> Result<Vec<BatchSequenceStatsEntry>, String> {
    state.record_call();
    let total = items.len();
    for item in &items {
        validate_sequence_input(&item.sequence, &item.name)?;
    }

    let _ = app.emit(
        "mbc://batch-progress",
        BatchProgressEventPayload {
            processed: 0,
            total,
            status: "started".into(),
        },
    );

    let out = tauri::async_runtime::spawn_blocking(move || compute_batch_sequence_stats(&items))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))?
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "mbc://batch-progress",
        BatchProgressEventPayload {
            processed: total,
            total,
            status: "completed".into(),
        },
    );

    Ok(out)
}

#[tauri::command]
pub async fn cmd_reverse_complement(
    seq: String,
    state: State<'_, AppBackendState>,
) -> Result<String, String> {
    state.record_call();
    validate_sequence_input(&seq, "seq")?;

    tauri::async_runtime::spawn_blocking(move || reverse_complement(&seq))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))
}

#[tauri::command]
pub async fn cmd_primer_thermodynamics(
    seq: String,
    na_mm: f64,
    mg_mm: f64,
    primer_nm: f64,
    state: State<'_, AppBackendState>,
) -> Result<PrimerThermodynamics, String> {
    state.record_call();
    validate_sequence_input(&seq, "primer_seq")?;

    if !na_mm.is_finite()
        || na_mm <= 0.0
        || !mg_mm.is_finite()
        || mg_mm < 0.0
        || !primer_nm.is_finite()
        || primer_nm <= 0.0
    {
        return Err("[ERR_INVALID_FILENAME] Salt (Na+/Mg2+) and primer concentrations must be finite positive numbers".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        molbiocraft_cloning::calculate_primer_thermodynamics_santalucia(
            &seq, na_mm, mg_mm, primer_nm,
        )
    })
    .await
    .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))
}

#[tauri::command]
pub async fn cmd_pairwise_align(
    seq1: String,
    seq2: String,
    local: bool,
    match_score: i32,
    mismatch_penalty: i32,
    gap_open: i32,
    gap_extend: i32,
    state: State<'_, AppBackendState>,
) -> Result<AlignmentOutput, String> {
    state.record_call();
    validate_sequence_input(&seq1, "seq1")?;
    validate_sequence_input(&seq2, "seq2")?;

    tauri::async_runtime::spawn_blocking(move || {
        let res = align_pairwise_standard(
            &seq1,
            &seq2,
            local,
            match_score,
            mismatch_penalty,
            gap_open,
            gap_extend,
        );
        AlignmentOutput {
            aligned_seq1: res.aligned_seq1,
            aligned_seq2: res.aligned_seq2,
            midline: res.midline,
            score: res.score,
            matches: res.matches as i32,
            mismatches: res.mismatches as i32,
            gaps: res.gaps as i32,
            identity_pct: res.identity_pct,
        }
    })
    .await
    .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))
}

/// Native multi-core Rust RPC command invoking any of the 100+ bioinformatics operations
/// across `molbiocraft-{core,formats,align,phylo,cloning,protein}` on Tauri's blocking worker pool.
#[tauri::command]
pub async fn cmd_rust_bio_invoke(
    op: String,
    payload: Value,
    state: State<'_, AppBackendState>,
) -> Result<Value, String> {
    state.record_call();
    tauri::async_runtime::spawn_blocking(move || dispatch_bio_rpc(&op, payload))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))?
}

/// Fast native genome/protein viewport slicer using `rust-bio` `IntervalTree`.
#[tauri::command]
pub async fn cmd_genome_viewport(
    seq: String,
    features: Vec<SequenceFeature>,
    start_pos: usize,
    end_pos: usize,
    is_rna: bool,
    is_protein: bool,
    state: State<'_, AppBackendState>,
) -> Result<GenomeViewportSlice, String> {
    state.record_call();
    validate_sequence_input(&seq, "seq")?;
    tauri::async_runtime::spawn_blocking(move || {
        slice_genome_viewport(&seq, &features, start_pos, end_pos, is_rna, is_protein)
    })
    .await
    .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))
}

/// Fast native multi-megabase genome track computer (GC%, AT%, GC-skew, cumulative `oriC`/`terC`).
#[tauri::command]
pub async fn cmd_genome_tracks(
    seq: String,
    bins: usize,
    state: State<'_, AppBackendState>,
) -> Result<GenomeTrackOverview, String> {
    state.record_call();
    validate_sequence_input(&seq, "seq")?;
    tauri::async_runtime::spawn_blocking(move || compute_genome_track_overview(&seq, bins))
        .await
        .map_err(|e| format!("[ERR_ASYNC_JOIN] {}", e))
}
