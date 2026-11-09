// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Locally installed tree-inference programs (FastTree, PhyML, RAxML, MrBayes).

use crate::commands::AppBackendState;
use molbiocraft_phylo::external::{
    detect_external_tree_programs, run_external_tree_program, ExternalProgramStatus,
    ExternalTreeProgram, ExternalTreeResult,
};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

/// Hard stop for one external run.
const EXTERNAL_TREE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Same bound as the interactive aligner: 1,000 taxa × 100 kb columns.
const MAX_TAXA: usize = 1000;
const MAX_TOTAL_RESIDUES: usize = 100 * 1024 * 1024;

static CANCELLED_JOBS: Mutex<Option<HashSet<u64>>> = Mutex::new(None);

fn is_cancelled(job: u64) -> bool {
    CANCELLED_JOBS
        .lock()
        .map(|g| g.as_ref().is_some_and(|s| s.contains(&job)))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn cmd_detect_tree_programs(
    state: State<'_, AppBackendState>,
) -> Result<Vec<ExternalProgramStatus>, String> {
    state.record_call();
    tauri::async_runtime::spawn_blocking(detect_external_tree_programs)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_run_external_tree(
    state: State<'_, AppBackendState>,
    algorithm: String,
    names: Vec<String>,
    aligned_seqs: Vec<String>,
    job_id: u64,
) -> Result<ExternalTreeResult, String> {
    state.record_call();
    let program = ExternalTreeProgram::from_algorithm(&algorithm)
        .ok_or_else(|| format!("'{algorithm}' is not an external tree program"))?;
    if names.len() > MAX_TAXA {
        return Err(format!("at most {MAX_TAXA} sequences can be sent to an external program"));
    }
    if aligned_seqs.iter().map(String::len).sum::<usize>() > MAX_TOTAL_RESIDUES {
        return Err("the alignment is too large to send to an external program".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_external_tree_program(program, &names, &aligned_seqs, EXTERNAL_TREE_TIMEOUT, &|| {
            is_cancelled(job_id)
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(mut g) = CANCELLED_JOBS.lock() {
        if let Some(s) = g.as_mut() {
            s.remove(&job_id);
        }
    }
    result
}

#[tauri::command]
pub async fn cmd_cancel_external_tree(
    state: State<'_, AppBackendState>,
    job_id: u64,
) -> Result<(), String> {
    state.record_call();
    let mut g = CANCELLED_JOBS.lock().map_err(|e| e.to_string())?;
    let set = g.get_or_insert_with(HashSet::new);
    // Bounded: a cancel for a job that already finished is never removed otherwise.
    if set.len() > 256 {
        set.clear();
    }
    set.insert(job_id);
    Ok(())
}
