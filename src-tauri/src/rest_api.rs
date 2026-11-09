// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Embedded Local Loopback Rust RESTful Bio-Compute HTTP/JSON Server (`127.0.0.1:18420`).
//!
//! Exposes all 7 MolBioCraft Rust bioinformatics crates (`molbiocraft-{core,formats,align,
//! phylo,cloning,protein,wasm}`) over a zero-external-dependency multi-threaded RESTful v1 API
//! bound strictly to `127.0.0.1` so the TypeScript/React + SVG desktop frontend can execute
//! compute-intensive molecular & evolutionary biology workloads over HTTP/JSON as well as
//! Tauri v2 IPC and WebAssembly.

use crate::commands::AppBackendState;
use molbiocraft_align::align_pairwise_standard;
use molbiocraft_core::{compute_sequence_stats, query_platform_diagnostics};
use molbiocraft_wasm::dispatch_bio_rpc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Default local loopback port matching `src-tauri/tauri.conf.json` CSP `connect-src`.
pub const DEFAULT_REST_PORT: u16 = 18420;

/// Maximum JSON request body accepted by the local RESTful server (64 MiB).
const MAX_REST_BODY_BYTES: usize = 64 * 1024 * 1024;

/// Maximum concurrent in-flight HTTP worker threads.
const MAX_CONCURRENT_CONNECTIONS: usize = 32;

#[derive(Debug, Deserialize)]
struct RestRpcEnvelope {
    op: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Deserialize)]
struct RestSeqStatsRequest {
    seq: String,
}

#[derive(Debug, Deserialize)]
struct RestPairwiseAlignRequest {
    seq1: String,
    seq2: String,
    #[serde(default)]
    local: bool,
    #[serde(default = "default_match_score")]
    match_score: i32,
    #[serde(default = "default_mismatch_penalty")]
    mismatch_penalty: i32,
    #[serde(default = "default_gap_open")]
    gap_open: i32,
    #[serde(default = "default_gap_extend")]
    gap_extend: i32,
}

fn default_match_score() -> i32 {
    2
}
fn default_mismatch_penalty() -> i32 {
    -1
}
fn default_gap_open() -> i32 {
    -3
}
fn default_gap_extend() -> i32 {
    -1
}

/// Spawn the embedded Rust RESTful HTTP/1.1 server on `127.0.0.1:preferred_port`
/// (automatically falling back to `127.0.0.1:0` if `preferred_port` is already occupied).
/// Stores the bound port in `state` and returns it.
pub fn spawn_embedded_rest_server(state: AppBackendState, preferred_port: u16) -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", preferred_port))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .ok()?;

    let bound_port = listener.local_addr().ok()?.port();
    state.set_rest_port(bound_port);

    let active_workers = Arc::new(AtomicUsize::new(0));

    std::thread::Builder::new()
        .name("mbc-rest-accept".into())
        .spawn(move || {
            for incoming in listener.incoming() {
                let Ok(mut stream) = incoming else {
                    continue;
                };
                let current = active_workers.fetch_add(1, Ordering::AcqRel);
                if current >= MAX_CONCURRENT_CONNECTIONS {
                    active_workers.fetch_sub(1, Ordering::AcqRel);
                    let _ = write_json_response(
                        &mut stream,
                        503,
                        None,
                        &json!({
                            "ok": false,
                            "error": "[ERR_BUSY] Embedded Rust RESTful worker pool saturated"
                        }),
                    );
                    continue;
                }

                let worker_state = state.clone();
                let worker_counter = Arc::clone(&active_workers);
                let spawned = std::thread::Builder::new()
                    .name("mbc-rest-worker".into())
                    .spawn(move || {
                        // Release the slot even if the request handler panics;
                        // a leaked slot per panic eventually made the server
                        // answer 503 forever.
                        let _slot = WorkerSlot(worker_counter);
                        let _ = handle_http_connection(stream, &worker_state);
                    });
                if spawned.is_err() {
                    active_workers.fetch_sub(1, Ordering::AcqRel);
                }
            }
        })
        .ok()?;

    Some(bound_port)
}

/// Browsers send `Origin: null` from sandboxed iframes, `file://` and `data:`
/// URLs, so "null" must never be trusted (it let any web page drive the API).
/// Decrements the active-worker counter when dropped (including on unwind).
struct WorkerSlot(Arc<AtomicUsize>);

impl Drop for WorkerSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn is_allowed_local_origin(origin: &str) -> bool {
    let trimmed = origin.trim();
    trimmed == "tauri://localhost"
        || trimmed == "http://tauri.localhost"
        || trimmed == "https://tauri.localhost"
        || trimmed.starts_with("http://localhost:")
        || trimmed.starts_with("http://127.0.0.1:")
}

fn status_reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    allow_origin: Option<&str>,
    body: &Value,
) -> std::io::Result<()> {
    let serialized = if status == 204 {
        Vec::new()
    } else {
        serde_json::to_vec(body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec())
    };

    let cors_origin = allow_origin.unwrap_or("tauri://localhost");
    let header = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: {}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-MolBioCraft-Client, X-MolBioCraft-Token\r\n\
         Vary: Origin\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n",
        status,
        status_reason(status),
        serialized.len(),
        cors_origin
    );

    stream.write_all(header.as_bytes())?;
    if !serialized.is_empty() {
        stream.write_all(&serialized)?;
    }
    stream.flush()
}

fn handle_http_connection(mut stream: TcpStream, state: &AppBackendState) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));

    let cloned = stream.try_clone()?;
    let mut reader = BufReader::new(cloned);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return write_json_response(
            &mut stream,
            400,
            None,
            &json!({ "ok": false, "error": "Malformed HTTP request line" }),
        );
    }
    let method = parts[0].to_ascii_uppercase();
    let raw_target = parts[1];
    let path = raw_target.split('?').next().unwrap_or(raw_target);

    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
        if headers.len() > 64 {
            break;
        }
    }

    let origin_hdr = headers.get("origin").map(String::as_str);
    if let Some(orig) = origin_hdr {
        if !is_allowed_local_origin(orig) {
            return write_json_response(
                &mut stream,
                403,
                None,
                &json!({ "ok": false, "error": "Cross-origin request rejected by loopback guard" }),
            );
        }
    }

    // DNS-rebinding guard: only accept requests addressed to the loopback host.
    let port = state.rest_port();
    let host_ok = headers.get("host").map(|h| {
        let h = h.trim().to_ascii_lowercase();
        h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}")
    });
    if host_ok != Some(true) {
        return write_json_response(
            &mut stream,
            403,
            None,
            &json!({ "ok": false, "error": "Request host rejected by loopback guard" }),
        );
    }

    if method == "OPTIONS" {
        return write_json_response(&mut stream, 204, origin_hdr, &Value::Null);
    }

    // Everything except the health probe requires the per-launch token, which
    // the app receives over Tauri IPC (cmd_rest_api_info). Other local
    // processes and web pages cannot obtain it.
    if path != "/api/v1/health"
        && headers.get("x-molbiocraft-token").map(|t| t.trim()) != Some(state.rest_token())
    {
        return write_json_response(
            &mut stream,
            401,
            origin_hdr,
            &json!({ "ok": false, "error": "[ERR_PERMISSION_DENIED] Missing or invalid X-MolBioCraft-Token" }),
        );
    }

    let content_len = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);

    if content_len > MAX_REST_BODY_BYTES {
        return write_json_response(
            &mut stream,
            413,
            origin_hdr,
            &json!({ "ok": false, "error": "[ERR_PATH_TOO_LONG] Request payload exceeds 64 MiB limit" }),
        );
    }

    let mut body_bytes = vec![0u8; content_len];
    if content_len > 0 {
        reader.read_exact(&mut body_bytes)?;
    }

    state.record_rest_call();

    let (status, payload) = route_rest_request(&method, path, &body_bytes, state);
    write_json_response(&mut stream, status, origin_hdr, &payload)
}

fn route_rest_request(
    method: &str,
    path: &str,
    body_bytes: &[u8],
    state: &AppBackendState,
) -> (u16, Value) {
    match (method, path) {
        ("GET", "/api/v1/health") => {
            let info = state.rest_endpoint_info();
            (
                200,
                json!({
                    "ok": true,
                    "service": "molbiocraft-rust-restful-engine",
                    "version": env!("CARGO_PKG_VERSION"),
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "port": info.port,
                    "base_url": info.base_url,
                    "worker_threads": info.worker_threads,
                    "ipc_calls": info.ipc_calls,
                    "rest_calls": info.rest_calls,
                    "crates": [
                        "molbiocraft-core",
                        "molbiocraft-formats",
                        "molbiocraft-align",
                        "molbiocraft-phylo",
                        "molbiocraft-cloning",
                        "molbiocraft-protein",
                        "molbiocraft-wasm"
                    ]
                }),
            )
        }
        ("GET", "/api/v1/diagnostics") => match query_platform_diagnostics() {
            Ok(diag) => (200, json!({ "ok": true, "data": diag })),
            Err(e) => (500, json!({ "ok": false, "error": e.to_string() })),
        },
        ("GET", "/api/v1/catalog/records") => {
            match dispatch_bio_rpc("query_curated_database_records", json!({ "query": "" })) {
                Ok(records) => (200, json!({ "ok": true, "data": records })),
                Err(e) => (400, json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/v1/sequence/stats") => {
            let parsed: Result<RestSeqStatsRequest, _> = serde_json::from_slice(body_bytes);
            let Ok(req) = parsed else {
                return (
                    400,
                    json!({ "ok": false, "error": "[ERR_CORRUPT_PACKET] Expected JSON { \"seq\": \"...\" }" }),
                );
            };
            let trimmed = req.seq.trim();
            if trimmed.is_empty() {
                return (
                    400,
                    json!({ "ok": false, "error": "[ERR_EMPTY_SEQUENCE] seq cannot be empty" }),
                );
            }
            let fp = AppBackendState::fingerprint(trimmed);
            let stats = if let Some(cached) = state.get_cached_stats(fp) {
                cached
            } else {
                let computed = compute_sequence_stats(trimmed);
                state.put_cached_stats(fp, computed.clone());
                computed
            };
            (200, json!({ "ok": true, "data": stats }))
        }
        ("POST", "/api/v1/align/pairwise") => {
            let parsed: Result<RestPairwiseAlignRequest, _> = serde_json::from_slice(body_bytes);
            let Ok(req) = parsed else {
                return (
                    400,
                    json!({ "ok": false, "error": "[ERR_CORRUPT_PACKET] Invalid pairwise alignment JSON" }),
                );
            };
            if req.seq1.trim().is_empty() || req.seq2.trim().is_empty() {
                return (
                    400,
                    json!({ "ok": false, "error": "[ERR_EMPTY_SEQUENCE] Both seq1 and seq2 must be non-empty" }),
                );
            }
            let res = align_pairwise_standard(
                req.seq1.trim(),
                req.seq2.trim(),
                req.local,
                req.match_score,
                req.mismatch_penalty,
                req.gap_open,
                req.gap_extend,
            );
            (
                200,
                json!({
                    "ok": true,
                    "data": {
                        "aligned_seq1": res.aligned_seq1,
                        "aligned_seq2": res.aligned_seq2,
                        "midline": res.midline,
                        "score": res.score,
                        "matches": res.matches,
                        "mismatches": res.mismatches,
                        "gaps": res.gaps,
                        "identity_pct": res.identity_pct
                    }
                }),
            )
        }
        ("POST", "/api/v1/rpc") => {
            let parsed: Result<RestRpcEnvelope, _> = serde_json::from_slice(body_bytes);
            let Ok(env) = parsed else {
                return (
                    400,
                    json!({ "ok": false, "error": "[ERR_CORRUPT_PACKET] Expected JSON { \"op\": \"...\", \"payload\": {...} }" }),
                );
            };
            match dispatch_bio_rpc(&env.op, env.payload) {
                Ok(data) => (200, json!({ "ok": true, "op": env.op, "data": data })),
                Err(err) => (400, json!({ "ok": false, "op": env.op, "error": err })),
            }
        }
        ("POST", dynamic_rpc) if dynamic_rpc.starts_with("/api/v1/rpc/") => {
            let op = dynamic_rpc.trim_start_matches("/api/v1/rpc/").trim();
            if op.is_empty() {
                return (
                    400,
                    json!({ "ok": false, "error": "Missing RPC operation name in /api/v1/rpc/<op>" }),
                );
            }
            let payload: Value = if body_bytes.is_empty() {
                json!({})
            } else {
                match serde_json::from_slice(body_bytes) {
                    Ok(v) => v,
                    Err(e) => {
                        return (
                            400,
                            json!({ "ok": false, "op": op, "error": format!("[ERR_CORRUPT_PACKET] {}", e) }),
                        );
                    }
                }
            };
            match dispatch_bio_rpc(op, payload) {
                Ok(data) => (200, json!({ "ok": true, "op": op, "data": data })),
                Err(err) => (400, json!({ "ok": false, "op": op, "error": err })),
            }
        }
        ("GET", _) | ("POST", _) => (
            404,
            json!({ "ok": false, "error": format!("Unknown RESTful endpoint '{}'", path) }),
        ),
        _ => (
            405,
            json!({ "ok": false, "error": format!("Unsupported HTTP method '{}'", method) }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn send_raw_http(port: u16, raw_req: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect loopback REST");
        stream
            .write_all(raw_req.as_bytes())
            .expect("write HTTP request");
        let mut resp = String::new();
        stream
            .read_to_string(&mut resp)
            .expect("read HTTP response");
        let (head, body) = resp.split_once("\r\n\r\n").expect("HTTP header separator");
        let status_code = head
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse::<u16>().ok())
            .expect("HTTP status code");
        (status_code, body.to_string())
    }

    #[test]
    fn serves_health_stats_pairwise_and_rpc_over_loopback_http() {
        let state = AppBackendState::default();
        let port = spawn_embedded_rest_server(state.clone(), 0).expect("bind ephemeral REST port");
        assert!(port > 0);
        assert_eq!(state.rest_port(), port);
        let host = format!("127.0.0.1:{port}");
        let token = state.rest_token().to_string();
        let post = |path: &str, body: &str, extra: &str| {
            send_raw_http(
                port,
                &format!(
                    "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}",
                    body.len()
                ),
            )
        };
        let auth = format!("X-MolBioCraft-Token: {token}\r\n");

        // 1. GET /api/v1/health (no token needed, and no token disclosed)
        let (code, health_body) = send_raw_http(
            port,
            &format!("GET /api/v1/health HTTP/1.1\r\nHost: {host}\r\nOrigin: tauri://localhost\r\n\r\n"),
        );
        assert_eq!(code, 200);
        let health_json: Value = serde_json::from_str(&health_body).unwrap();
        assert_eq!(health_json["ok"], true);
        assert_eq!(health_json["service"], "molbiocraft-rust-restful-engine");
        assert_eq!(health_json["crates"].as_array().unwrap().len(), 7);
        assert!(!health_body.contains(&token), "health must not leak the token");

        // 2. POST /api/v1/sequence/stats
        let (code_stats, stats_body) = post("/api/v1/sequence/stats", r#"{"seq":"GAATTCATGCGT"}"#, &auth);
        assert_eq!(code_stats, 200);
        let stats_json: Value = serde_json::from_str(&stats_body).unwrap();
        assert_eq!(stats_json["ok"], true);
        assert_eq!(stats_json["data"]["length"], 12);

        // 3. POST /api/v1/rpc/reverse_complement
        let (code_rc, rc_body) = post("/api/v1/rpc/reverse_complement", r#"{"seq":"GAATTC"}"#, &auth);
        assert_eq!(code_rc, 200);
        let rc_json: Value = serde_json::from_str(&rc_body).unwrap();
        assert_eq!(rc_json["ok"], true);
        assert_eq!(rc_json["data"], "GAATTC");

        // 4. Reject untrusted external Origin header
        let (code_bad_origin, _) = send_raw_http(
            port,
            &format!("GET /api/v1/health HTTP/1.1\r\nHost: {host}\r\nOrigin: https://evil.example.com\r\n\r\n"),
        );
        assert_eq!(code_bad_origin, 403);

        // 5. Security regressions: Origin "null" (sandboxed iframe / file://),
        //    missing or wrong token, and DNS-rebinding Host headers are refused.
        let (code_null_origin, _) = post("/api/v1/rpc/reverse_complement", r#"{"seq":"A"}"#, &format!("Origin: null\r\n{auth}"));
        assert_eq!(code_null_origin, 403);
        let (code_no_token, _) = post("/api/v1/rpc/reverse_complement", r#"{"seq":"A"}"#, "");
        assert_eq!(code_no_token, 401);
        let (code_bad_token, _) = post("/api/v1/rpc/reverse_complement", r#"{"seq":"A"}"#, "X-MolBioCraft-Token: 0000\r\n");
        assert_eq!(code_bad_token, 401);
        let (code_rebind, _) = send_raw_http(
            port,
            &format!("GET /api/v1/health HTTP/1.1\r\nHost: attacker.example:{port}\r\n\r\n"),
        );
        assert_eq!(code_rebind, 403);

        // 6. Oversized size arguments are capped instead of aborting the process.
        let (code_huge, _) = post(
            "/api/v1/rpc/generate_safe_backbone_spacer",
            r#"{"lengthBp":1e12}"#,
            &auth,
        );
        assert!(code_huge == 200 || code_huge == 400, "{code_huge}");
    }
}
