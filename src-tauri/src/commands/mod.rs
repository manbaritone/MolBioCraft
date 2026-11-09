// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

pub mod bio_commands;
pub mod fs_commands;
pub mod tree_tool_commands;
pub mod window_commands;

use molbiocraft_core::SequenceStats;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct RestApiEndpointInfo {
    pub active: bool,
    /// Per-launch secret required by the loopback REST server
    /// (`X-MolBioCraft-Token`). Only ever delivered over Tauri IPC.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub token: String,
    pub port: u16,
    pub base_url: String,
    pub ipc_calls: u64,
    pub rest_calls: u64,
    pub worker_threads: usize,
}

struct AppBackendInner {
    ipc_calls: AtomicU64,
    rest_calls: AtomicU64,
    rest_port: AtomicU16,
    confirm_before_quit: AtomicBool,
    quit_approved: AtomicBool,
    stats_cache: Mutex<HashMap<u64, SequenceStats>>,
    /// Files the OS asked the app to open (file associations, `Open With…`,
    /// launch arguments) that the frontend has not collected yet.
    pending_open_files: Mutex<Vec<std::path::PathBuf>>,
    /// Random per-launch token authenticating loopback REST requests.
    rest_token: String,
    /// When the last unacknowledged quit confirmation was sent to the frontend.
    quit_request_sent_at: Mutex<Option<std::time::Instant>>,
    /// Close requests received since that unacknowledged confirmation was sent.
    unacked_close_attempts: std::sync::atomic::AtomicU32,
}

/// 128-bit random hex token. `RandomState` keys come from the OS RNG, so the
/// value is unpredictable to other processes and web pages.
fn generate_rest_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::with_capacity(32);
    for salt in 0u64..2 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(salt);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

impl Default for AppBackendInner {
    fn default() -> Self {
        Self {
            ipc_calls: AtomicU64::new(0),
            rest_calls: AtomicU64::new(0),
            rest_port: AtomicU16::new(0),
            confirm_before_quit: AtomicBool::new(true),
            quit_approved: AtomicBool::new(false),
            stats_cache: Mutex::new(HashMap::new()),
            pending_open_files: Mutex::new(Vec::new()),
            rest_token: generate_rest_token(),
            quit_request_sent_at: Mutex::new(None),
            unacked_close_attempts: std::sync::atomic::AtomicU32::new(0),
        }
    }
}

/// Managed Tauri + Embedded Rust RESTful backend state shared safely across worker threads:
/// - Tracks both Tauri IPC and local RESTful HTTP invocation telemetry atomically.
/// - Publishes the active loopback port (`127.0.0.1:<port>/api/v1`) bound by `rest_api`.
/// - Caches computed `SequenceStats` by FNV-1a sequence fingerprint (bounded to 256 entries)
///   to avoid recomputing large viral/BAC/chromosomal sequence statistics across switches.
#[derive(Clone, Default)]
pub struct AppBackendState {
    inner: Arc<AppBackendInner>,
}

impl AppBackendState {
    pub fn record_call(&self) -> u64 {
        self.inner.ipc_calls.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn record_rest_call(&self) -> u64 {
        self.inner.rest_calls.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn total_calls(&self) -> u64 {
        self.inner.ipc_calls.load(Ordering::Relaxed)
    }

    pub fn total_rest_calls(&self) -> u64 {
        self.inner.rest_calls.load(Ordering::Relaxed)
    }

    pub fn set_rest_port(&self, port: u16) {
        self.inner.rest_port.store(port, Ordering::Release);
    }

    pub fn rest_port(&self) -> u16 {
        self.inner.rest_port.load(Ordering::Acquire)
    }

    pub fn rest_endpoint_info(&self) -> RestApiEndpointInfo {
        let port = self.rest_port();
        RestApiEndpointInfo {
            active: port > 0,
            port,
            token: self.inner.rest_token.clone(),
            base_url: if port > 0 {
                format!("http://127.0.0.1:{}/api/v1", port)
            } else {
                String::new()
            },
            ipc_calls: self.total_calls(),
            rest_calls: self.total_rest_calls(),
            worker_threads: rayon::current_num_threads(),
        }
    }

    pub fn fingerprint(seq: &str) -> u64 {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in seq.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    pub fn get_cached_stats(&self, key: u64) -> Option<SequenceStats> {
        self.inner
            .stats_cache
            .lock()
            .ok()
            .and_then(|guard| guard.get(&key).cloned())
    }

    pub fn put_cached_stats(&self, key: u64, stats: SequenceStats) {
        if let Ok(mut guard) = self.inner.stats_cache.lock() {
            if guard.len() >= 256 {
                guard.clear();
            }
            guard.insert(key, stats);
        }
    }

    pub fn confirm_before_quit(&self) -> bool {
        self.inner.confirm_before_quit.load(Ordering::Acquire)
    }

    pub fn set_confirm_before_quit(&self, confirm: bool) {
        self.inner
            .confirm_before_quit
            .store(confirm, Ordering::Release);
    }

    pub fn is_quit_approved(&self) -> bool {
        self.inner.quit_approved.load(Ordering::Acquire)
    }

    pub fn set_quit_approved(&self, approved: bool) {
        self.inner.quit_approved.store(approved, Ordering::Release);
    }

    /// How long the frontend has to acknowledge a quit confirmation request
    /// before repeated close requests are honoured without it. Long enough to
    /// outlast a synchronous engine job (MSA, bootstrap) blocking the webview's
    /// main thread, so a busy — not dead — frontend still gets to confirm.
    pub const QUIT_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
    /// Close requests (including the first) needed, after the timeout, before
    /// an unacknowledged confirmation is bypassed.
    pub const QUIT_BYPASS_ATTEMPTS: u32 = 3;
    /// With confirmation off, how long the frontend has to finish its final
    /// autosave before a second close request is honoured without it.
    pub const QUIT_NO_CONFIRM_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

    /// Decide whether a close/exit request must be vetoed so the frontend can
    /// ask for confirmation. If an earlier request was never acknowledged (the
    /// frontend crashed or its listener is gone) and the user asks again after
    /// [`Self::QUIT_ACK_TIMEOUT`], the close is allowed instead of the window
    /// becoming impossible to close.
    ///
    /// With "confirm before quitting" off the first close is still routed
    /// through the frontend (without a prompt) so it can write the final
    /// autosave — or warn when unsaved work cannot be autosaved — before it
    /// exits; a repeated, unacknowledged close is honoured after
    /// [`Self::QUIT_NO_CONFIRM_TIMEOUT`].
    pub fn should_veto_close(&self, now: std::time::Instant) -> bool {
        if self.is_quit_approved() {
            return false;
        }
        let (timeout, attempts_needed) = if self.confirm_before_quit() {
            (Self::QUIT_ACK_TIMEOUT, Self::QUIT_BYPASS_ATTEMPTS)
        } else {
            (Self::QUIT_NO_CONFIRM_TIMEOUT, 2)
        };
        let mut sent = self
            .inner
            .quit_request_sent_at
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        use std::sync::atomic::Ordering;
        if let Some(t) = *sent {
            let attempts = self.inner.unacked_close_attempts.fetch_add(1, Ordering::SeqCst) + 1;
            if now.duration_since(t) >= timeout && attempts >= attempts_needed {
                return false;
            }
        } else {
            *sent = Some(now);
            self.inner.unacked_close_attempts.store(1, Ordering::SeqCst);
        }
        true
    }

    /// The frontend received the quit confirmation request (it is alive).
    pub fn ack_quit_request(&self) {
        *self
            .inner
            .quit_request_sent_at
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = None;
        self.inner
            .unacked_close_attempts
            .store(0, std::sync::atomic::Ordering::SeqCst);
    }

    /// Secret the loopback REST server requires on every request.
    pub fn rest_token(&self) -> &str {
        &self.inner.rest_token
    }

    /// Queue files the OS asked us to open; duplicates are ignored.
    pub fn queue_open_files<I: IntoIterator<Item = std::path::PathBuf>>(&self, paths: I) -> usize {
        let mut q = self
            .inner
            .pending_open_files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for p in paths {
            if !q.contains(&p) {
                q.push(p);
            }
        }
        q.len()
    }

    /// Take (and clear) the queued open-file requests.
    pub fn take_open_files(&self) -> Vec<std::path::PathBuf> {
        let mut q = self
            .inner
            .pending_open_files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *q)
    }
}

/// Launch arguments that name existing files (Windows/Linux file associations
/// pass the document path as an argument). Flags are ignored.
pub fn open_file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<std::path::PathBuf> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_file())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::AppBackendState;

    #[test]
    fn unacknowledged_quit_request_does_not_trap_the_window() {
        let state = AppBackendState::default();
        let t0 = std::time::Instant::now();
        // First close: vetoed so the frontend can confirm.
        assert!(state.should_veto_close(t0));
        // Frontend alive: it acknowledges, later closes are vetoed again.
        state.ack_quit_request();
        assert!(state.should_veto_close(t0 + std::time::Duration::from_secs(5)));
        // Frontend busy (main thread blocked by an engine job): a second close
        // a few seconds later must still be vetoed — unsaved work is at stake.
        let t1 = t0 + std::time::Duration::from_secs(5);
        assert!(state.should_veto_close(t1 + std::time::Duration::from_secs(3)));
        // Even after the timeout, one more close alone is not enough …
        let late = t1 + AppBackendState::QUIT_ACK_TIMEOUT + std::time::Duration::from_secs(1);
        assert!(!state.should_veto_close(late), "third unacknowledged close after timeout is honoured");
        // … but a fresh, acknowledged cycle restarts the count.
        state.ack_quit_request();
        assert!(state.should_veto_close(late));
        assert!(state.should_veto_close(late + AppBackendState::QUIT_ACK_TIMEOUT));
        // Confirmation disabled: the first close still goes through the
        // frontend (final autosave, no prompt); a second unacknowledged close
        // after the short timeout is honoured.
        let off = AppBackendState::default();
        off.set_confirm_before_quit(false);
        assert!(off.should_veto_close(t0));
        assert!(off.should_veto_close(t0 + std::time::Duration::from_secs(1)));
        assert!(!off.should_veto_close(t0 + AppBackendState::QUIT_NO_CONFIRM_TIMEOUT));
        // Quit approved by the frontend: never vetoed.
        let approved = AppBackendState::default();
        approved.set_quit_approved(true);
        assert!(!approved.should_veto_close(t0));
    }

    #[test]
    fn rest_tokens_are_random_per_state() {
        let a = AppBackendState::default();
        let b = AppBackendState::default();
        assert_eq!(a.rest_token().len(), 32);
        assert!(a.rest_token().chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.rest_token(), b.rest_token());
    }

    #[test]
    fn open_file_queue_deduplicates_and_drains() {
        let state = AppBackendState::default();
        let a = std::path::PathBuf::from("/tmp/a.gb");
        let b = std::path::PathBuf::from("/tmp/b.mbc");
        assert_eq!(state.queue_open_files(vec![a.clone(), b.clone(), a.clone()]), 2);
        assert_eq!(state.take_open_files(), vec![a, b]);
        assert!(state.take_open_files().is_empty());
    }

    #[test]
    fn open_file_args_keep_existing_files_and_drop_flags() {
        let file = std::env::temp_dir().join("mbc_open_args_test.fasta");
        std::fs::write(&file, ">x\nACGT\n").unwrap();
        let args = vec![
            "--flag".to_string(),
            file.to_string_lossy().into_owned(),
            "/definitely/not/here.gb".to_string(),
        ];
        assert_eq!(super::open_file_args(args), vec![file.clone()]);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn confirm_quit_guard_defaults_to_enabled_and_tracks_approval() {
        let state = AppBackendState::default();
        assert!(state.confirm_before_quit());
        assert!(!state.is_quit_approved());

        state.set_confirm_before_quit(false);
        assert!(!state.confirm_before_quit());

        state.set_confirm_before_quit(true);
        state.set_quit_approved(true);
        assert!(state.confirm_before_quit());
        assert!(state.is_quit_approved());
    }
}
