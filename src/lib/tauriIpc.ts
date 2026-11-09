// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Strongly-Typed Tauri v2 IPC Command & Event Client with Bounded LRU Caching,
 * Multi-Document Batch Operations, Path Sanitization, and Offline TypeScript Fallback.
 *
 * Adheres to `.agents/skills/tauri-development/SKILL.md`:
 * - Typed `invoke` wrapper matching `src-tauri/src/commands/{bio_commands,fs_commands}.rs`
 * - Typed `listen` event subscription with deterministic `unlisten()` cleanup
 * - Batch operations (`cmd_batch_sequence_stats`) & bounded LRU caching to minimize IPC calls
 * - Input & file-path validation converting Rust error tags into `MolBioCraftError`
 */

import {
  alignPairwiseTypeScript,
  reverseComplement,
} from '../core/bioEngine';
import { invokeRustBioSync } from './rustBioEngine';
import {
  createPlatformAdapter,
  detectCpuArch,
  detectHostOS,
  ErrorCode,
  Logger,
  MolBioCraftError,
} from '../platform/osPlatform';
import { PairwiseAlignmentResult, SequenceDocument } from '../types/bio';

export interface TauriPlatformDiagnostics {
  os: string;
  arch: string;
  case_sensitive_fs: boolean;
  app_support_dir: string;
  logs_dir: string;
  cache_dir: string;
}

export interface TauriSequenceStats {
  length: number;
  gc_percent: number;
  at_percent: number;
  mw_ssdna_da: number;
  mw_dsdna_da: number;
  basic_tm_c: number;
  counts: Record<string, number>;
}

export interface TauriBatchSequenceItem {
  id: string;
  name: string;
  sequence: string;
}

export interface TauriBatchSequenceStatsEntry {
  id: string;
  name: string;
  stats: TauriSequenceStats;
}

export interface TauriPrimerThermodynamics {
  sequence: string;
  length: number;
  gc_percent: number;
  delta_h_kcal: number;
  delta_s_cal: number;
  delta_g_37_kcal: number;
  tm_salt_corrected_c: number;
  hairpin_dg_kcal: number;
  self_dimer_dg_kcal: number;
  gc_clamp_3prime: boolean;
}

export interface TauriAlignmentOutput {
  aligned_seq1: string;
  aligned_seq2: string;
  midline: string;
  score: number;
  matches: number;
  mismatches: number;
  gaps: number;
  identity_pct: number;
}

export interface TauriBatchProgressEvent {
  processed: number;
  total: number;
  status: 'started' | 'completed' | string;
}

export interface TauriDroppedFileBytesPayload {
  file_name: string;
  base64: string;
  byte_len: number;
}

/**
 * What one native open dialog read (`OpenedFilesReply`, fs_commands.rs): the files, and how many
 * supported files of a picked folder Import Folder left out past its 500-file limit (BG-01M6S17Y),
 * 0 for every other pick.
 */
export interface TauriOpenedFilesReply {
  files: TauriDroppedFileBytesPayload[];
  filesLeftOut: number;
}

export interface TauriDragDropEventPayload {
  paths?: string[];
  position?: { x: number; y: number };
}

export interface TauriRestApiInfo {
  active: boolean;
  /** Per-launch REST secret (desktop IPC only). */
  token?: string;
  port: number;
  base_url: string;
  ipc_calls: number;
  rest_calls: number;
  worker_threads: number;
}

export interface RustRestHealthResponse {
  ok: boolean;
  service: string;
  version: string;
  os: string;
  arch: string;
  port: number;
  base_url: string;
  worker_threads: number;
  ipc_calls: number;
  rest_calls: number;
  crates: string[];
}

export const DEFAULT_RUST_REST_BASE_URL = 'http://127.0.0.1:18420/api/v1';

/**
 * End-to-end compile-time contract between TypeScript frontend and Rust `#[tauri::command]` handlers.
 */
export interface TauriCommandMap {
  cmd_platform_diagnostics: {
    args: Record<string, never>;
    result: TauriPlatformDiagnostics;
  };
  cmd_rest_api_info: {
    args: Record<string, never>;
    result: TauriRestApiInfo;
  };
  cmd_sequence_stats: {
    args: { seq: string };
    result: TauriSequenceStats;
  };
  cmd_batch_sequence_stats: {
    args: { items: TauriBatchSequenceItem[] };
    result: TauriBatchSequenceStatsEntry[];
  };
  cmd_reverse_complement: {
    args: { seq: string };
    result: string;
  };
  cmd_primer_thermodynamics: {
    args: { seq: string; naMm: number; mgMm: number; primerNm: number };
    result: TauriPrimerThermodynamics;
  };
  cmd_pairwise_align: {
    args: {
      seq1: string;
      seq2: string;
      local: boolean;
      matchScore: number;
      mismatchPenalty: number;
      gapOpen: number;
      gapExtend: number;
    };
    result: TauriAlignmentOutput;
  };
  cmd_rust_bio_invoke: {
    args: { op: string; payload: Record<string, unknown> };
    result: unknown;
  };
  cmd_detect_tree_programs: {
    args: Record<string, never>;
    result: import('../core/externalTreePrograms').ExternalProgramStatus[];
  };
  cmd_run_external_tree: {
    args: { algorithm: string; names: string[]; alignedSeqs: string[]; jobId: number };
    result: import('../core/externalTreePrograms').ExternalTreeResult;
  };
  cmd_cancel_external_tree: {
    args: { jobId: number };
    result: null | undefined;
  };
  cmd_read_workspace_file: {
    args: { path: string };
    result: string;
  };
  cmd_write_workspace_file: {
    args: { path: string; content: string };
    result: null | undefined;
  };
  cmd_read_dropped_file_bytes: {
    args: { path: string };
    result: TauriDroppedFileBytesPayload;
  };
  cmd_native_open_files_dialog: {
    args: { mode: string };
    result: TauriOpenedFilesReply;
  };
  cmd_native_save_file_dialog: {
    args: { filename: string; content: string; contentBase64?: string };
    result: string | null;
  };
  cmd_print_webview: {
    args: Record<string, never>;
    result: null | undefined;
  };
  cmd_ack_quit_request: {
    args: Record<string, never>;
    result: null | undefined;
  };
  cmd_take_pending_open_files: {
    args: Record<string, never>;
    result: TauriDroppedFileBytesPayload[];
  };
  cmd_sync_native_menu_state: {
    args: {
      statePayload: {
        sessionActive: boolean;
        sessionIndependentIds: string[];
        sessionIndependentPrefixes: string[];
        overrides: Record<string, boolean>;
      };
    };
    result: number;
  };
  cmd_window_start_dragging: {
    args: Record<string, never>;
    result: null | undefined;
  };
  cmd_window_toggle_maximize: {
    args: Record<string, never>;
    result: boolean;
  };
  cmd_set_confirm_before_quit: {
    args: { confirm: boolean };
    result: boolean;
  };
  cmd_app_exit: {
    args: Record<string, never>;
    result: null | undefined;
  };
}

export interface TauriEvent<TPayload> {
  event: string;
  id: number;
  payload: TPayload;
}

export type UnlistenFn = () => void;

interface TauriWindowGlobals {
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    transformCallback?: (cb: (event: unknown) => void) => number;
  };
  __TAURI__?: {
    core?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    event?: {
      listen?: <T>(
        eventName: string,
        handler: (event: TauriEvent<T>) => void
      ) => Promise<UnlistenFn>;
    };
  };
}

/**
 *Bounded LRU Cache minimizing repetitive frontend <-> Rust IPC calls for deterministic bio operations.
 */
class TauriIpcLruCache {
  private readonly store = new Map<string, unknown>();
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries = 128) {
    this.maxEntries = maxEntries;
  }

  public get<T>(key: string): T | undefined {
    if (!this.store.has(key)) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    const val = this.store.get(key) as T;
    // Refresh recency order
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  public set<T>(key: string, value: T): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }

  public clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public getTelemetry(): { size: number; maxEntries: number; hits: number; misses: number } {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

export const TauriIpcCache = new TauriIpcLruCache(128);

/**
 * Detect whether the application is currently executing inside a Tauri v2 Desktop WebView.
 */
export function isTauriDesktopRuntime(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as unknown as TauriWindowGlobals;
  return Boolean(
    typeof g.__TAURI_INTERNALS__?.invoke === 'function' ||
      typeof g.__TAURI__?.core?.invoke === 'function'
  );
}

function parseRustErrorToMolBioCraftError(rawError: unknown, cmd: string): MolBioCraftError {
  if (rawError instanceof MolBioCraftError) return rawError;
  const msg = rawError instanceof Error ? rawError.message : String(rawError);
  const tagMatch = /^\[(ERR_[A-Z_]+)\]\s*(.*)$/.exec(msg);
  if (tagMatch) {
    const rawCode = tagMatch[1];
    const detail = tagMatch[2] || msg;
    const knownCodes = new Set<ErrorCode>([
      'ERR_INVALID_FILENAME',
      'ERR_WINDOWS_RESERVED_NAME',
      'ERR_PATH_TOO_LONG',
      'ERR_FILE_LOCKED',
      'ERR_PERMISSION_DENIED',
      'ERR_SANDBOX_VIOLATION',
      'ERR_READ_ONLY_FILESYSTEM',
      'ERR_TASK_ABORTED',
      'ERR_CORRUPT_PACKET',
      'ERR_EMPTY_SEQUENCE',
    ]);
    const mappedCode: ErrorCode = knownCodes.has(rawCode as ErrorCode)
      ? (rawCode as ErrorCode)
      : 'ERR_INVALID_FILENAME';
    return new MolBioCraftError(mappedCode, `Tauri IPC "${cmd}": ${detail}`);
  }
  return new MolBioCraftError('ERR_INVALID_FILENAME', `Tauri IPC "${cmd}" failed: ${msg}`);
}

/**
 * Strongly-typed Tauri v2 `invoke` wrapper with structured error translation and telemetry.
 */
export async function invokeTauriCommand<K extends keyof TauriCommandMap>(
  command: K,
  args: TauriCommandMap[K]['args'],
  options: { cacheKey?: string } = {}
): Promise<TauriCommandMap[K]['result']> {
  if (options.cacheKey) {
    const cached = TauriIpcCache.get<TauriCommandMap[K]['result']>(options.cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const g = globalThis as unknown as TauriWindowGlobals;
  const invoker = g.__TAURI_INTERNALS__?.invoke ?? g.__TAURI__?.core?.invoke;
  if (typeof invoker !== 'function') {
    throw new MolBioCraftError(
      'ERR_SANDBOX_VIOLATION',
      `Tauri native runtime is not active; cannot directly invoke "${command}".`
    );
  }

  try {
    const result = await invoker<TauriCommandMap[K]['result']>(
      command,
      args as Record<string, unknown>
    );
    if (options.cacheKey) {
      TauriIpcCache.set(options.cacheKey, result);
    }
    return result;
  } catch (err) {
    const typed = parseRustErrorToMolBioCraftError(err, command);
    Logger.error('TauriIPC', `Rust command "${command}" returned an error`, {
      code: typed.code,
      message: typed.message,
    });
    throw typed;
  }
}

/**
 * Subscribe to Tauri backend events (e.g. `mbc://batch-progress`) with safe no-op fallback
 * in browser/standalone HTML environments and guaranteed `UnlistenFn` cleanup.
 */
export async function listenTauriEvent<TPayload>(
  eventName: string,
  handler: (event: TauriEvent<TPayload>) => void
): Promise<UnlistenFn> {
  const g = globalThis as unknown as TauriWindowGlobals;

  // Prefer Tauri global event API when exposed by capability `core:event:default`
  if (typeof g.__TAURI__?.event?.listen === 'function') {
    return g.__TAURI__.event.listen<TPayload>(eventName, handler);
  }

  // Fallback to Tauri v2 internals plugin:event|listen IPC channel
  if (
    typeof g.__TAURI_INTERNALS__?.invoke === 'function' &&
    typeof g.__TAURI_INTERNALS__?.transformCallback === 'function'
  ) {
    const handlerId = g.__TAURI_INTERNALS__.transformCallback((rawEvt) => {
      handler(rawEvt as TauriEvent<TPayload>);
    });
    const eventId = await g.__TAURI_INTERNALS__.invoke<number>('plugin:event|listen', {
      event: eventName,
      target: { kind: 'Any' },
      handler: handlerId,
    });
    return () => {
      void g.__TAURI_INTERNALS__?.invoke?.('plugin:event|unlisten', {
        event: eventName,
        eventId,
      });
    };
  }

  return () => {};
}

/**
 * Sanitize a frontend file path before invoking Tauri filesystem commands (defense-in-depth
 * complementing Rust's `sanitize_workspace_path`).
 */
export function validateFrontendWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new MolBioCraftError(
      'ERR_INVALID_FILENAME',
      'Workspace file path cannot be empty or contain NUL bytes.'
    );
  }
  const segments = trimmed.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new MolBioCraftError(
      'ERR_PERMISSION_DENIED',
      `Parent-directory path traversal ('..') is blocked before Tauri IPC: "${trimmed}"`
    );
  }
  const adapter = createPlatformAdapter(detectHostOS());
  return adapter.validatePathAccess(trimmed).normalizedPath;
}

export async function readWorkspaceFileTauri(path: string): Promise<string> {
  const safePath = validateFrontendWorkspacePath(path);
  return invokeTauriCommand('cmd_read_workspace_file', { path: safePath });
}

export async function writeWorkspaceFileTauri(path: string, content: string): Promise<void> {
  const safePath = validateFrontendWorkspacePath(path);
  await invokeTauriCommand('cmd_write_workspace_file', { path: safePath, content });
}

export async function readDroppedFileBytesTauri(
  path: string
): Promise<TauriDroppedFileBytesPayload> {
  const safePath = validateFrontendWorkspacePath(path);
  return invokeTauriCommand('cmd_read_dropped_file_bytes', { path: safePath });
}

export async function startDesktopWindowDraggingTauri(): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return false;
  await invokeTauriCommand('cmd_window_start_dragging', {});
  return true;
}

export async function toggleDesktopWindowMaximizeTauri(): Promise<boolean | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invokeTauriCommand('cmd_window_toggle_maximize', {});
}

/**
 * Print the workbench. Inside the Tauri desktop app this uses the native
 * webview print operation (window.print() is a no-op in macOS WKWebView);
 * elsewhere it falls back to window.print().
 */
export async function printWorkbenchView(): Promise<void> {
  if (isTauriDesktopRuntime()) {
    await invokeTauriCommand('cmd_print_webview', {});
    return;
  }
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
  }
}

/** Tell the desktop backend the quit-confirmation request reached a live frontend. */
export async function ackQuitRequestTauri(): Promise<void> {
  if (!isTauriDesktopRuntime()) return;
  await invokeTauriCommand('cmd_ack_quit_request', {});
}

export async function setConfirmBeforeQuitTauri(confirm: boolean): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return confirm;
  return invokeTauriCommand('cmd_set_confirm_before_quit', { confirm });
}

export async function exitDesktopAppTauri(): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return false;
  await invokeTauriCommand('cmd_app_exit', {});
  return true;
}

export async function openNativeFilesDialogTauri(
  mode: string
): Promise<TauriOpenedFilesReply> {
  if (!isTauriDesktopRuntime()) return { files: [], filesLeftOut: 0 };
  return invokeTauriCommand('cmd_native_open_files_dialog', { mode });
}

export async function saveNativeFileDialogTauri(
  filename: string,
  content: string
): Promise<string | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invokeTauriCommand('cmd_native_save_file_dialog', { filename, content });
}

/**
 * Collect files the OS asked the desktop app to open (file associations,
 * Finder "Open With…", launch arguments).
 */
export async function takePendingOpenFilesTauri(): Promise<TauriDroppedFileBytesPayload[]> {
  if (!isTauriDesktopRuntime()) return [];
  return invokeTauriCommand('cmd_take_pending_open_files', {});
}

/** Apply enabled/disabled states to the native (macOS) menu bar. Returns the number of items updated. */
export async function syncNativeMenuStateTauri(
  statePayload: TauriCommandMap['cmd_sync_native_menu_state']['args']['statePayload']
): Promise<number> {
  if (!isTauriDesktopRuntime()) return 0;
  return invokeTauriCommand('cmd_sync_native_menu_state', { statePayload });
}

/** Save binary bytes (base64-encoded, e.g. a folder .mbc ZIP archive) through the native Save dialog. */
export async function saveNativeBinaryFileDialogTauri(
  filename: string,
  base64: string
): Promise<string | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invokeTauriCommand('cmd_native_save_file_dialog', {
    filename,
    content: '',
    contentBase64: base64,
  });
}

let activeRustRestBaseUrl: string | null = null;
/** Secret required by the loopback REST server; only known inside the desktop app. */
let activeRustRestToken: string | null = null;

export function configureRustRestBaseUrl(baseUrl: string | null): void {
  activeRustRestBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
}

export function getActiveRustRestBaseUrl(): string | null {
  return activeRustRestBaseUrl;
}

export async function fetchRustRestHealth(
  baseUrl = activeRustRestBaseUrl ?? DEFAULT_RUST_REST_BASE_URL
): Promise<RustRestHealthResponse> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`${cleanBase}/health`, {
      method: 'GET',
      headers: { 'X-MolBioCraft-Client': 'MolBioCraft/1.0.0' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new MolBioCraftError(
        'ERR_CORRUPT_PACKET',
        `Rust RESTful health check returned HTTP ${resp.status}`
      );
    }
    const json = (await resp.json()) as RustRestHealthResponse;
    if (!json?.ok) {
      throw new MolBioCraftError(
        'ERR_CORRUPT_PACKET',
        'Rust RESTful health endpoint returned ok=false'
      );
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover and activate the embedded local Rust RESTful Bio-Compute HTTP endpoint
 * (`http://127.0.0.1:<port>/api/v1`) when running inside Tauri v2 or local dev mode.
 */
export async function discoverRustRestApiEndpoint(): Promise<TauriRestApiInfo | null> {
  if (isTauriDesktopRuntime()) {
    try {
      const info = await invokeTauriCommand('cmd_rest_api_info', {});
      if (info.active && info.base_url) {
        configureRustRestBaseUrl(info.base_url);
        activeRustRestToken = info.token ?? null;
      }
      return info;
    } catch {
      return null;
    }
  }

  // The companion `molbiocraft` REST server is a development aid: probe for it only in dev
  // builds (or when opted in), so a production build served from localhost makes no requests
  // beyond its own files.
  const optedIn = (() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('molbiocraft.restProbe') === '1'; } catch { return false; }
  })();
  if (
    typeof window !== 'undefined' &&
    (import.meta.env?.DEV || optedIn) &&
    (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1')
  ) {
    try {
      const health = await fetchRustRestHealth(DEFAULT_RUST_REST_BASE_URL);
      const base = health.base_url || DEFAULT_RUST_REST_BASE_URL;
      configureRustRestBaseUrl(base);
      return {
        active: true,
        port: health.port || 18420,
        base_url: base,
        ipc_calls: health.ipc_calls ?? 0,
        rest_calls: health.rest_calls ?? 0,
        worker_threads: health.worker_threads ?? 1,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Full-stack Rust bioinformatics RPC client supporting:
 * 1. Embedded Multi-Core Rust RESTful HTTP/JSON API (`POST http://127.0.0.1:<port>/api/v1/rpc/<op>`)
 * 2. Tauri v2 Native Multi-Core Rust IPC (`cmd_rust_bio_invoke`)
 * 3. Synchronous Zero-Import Rust WebAssembly (`invokeRustBioSync`)
 */
export async function invokeRustFullStackRpc<TResult>(
  op: string,
  payload: Record<string, unknown> = {},
  options: { cacheKey?: string; preferRest?: boolean } = {}
): Promise<{
  data: TResult;
  transport: 'rust-rest-http' | 'tauri-rust-ipc' | 'rust-wasm-sync';
}> {
  const trimmedOp = op.trim();
  if (!trimmedOp) {
    throw new MolBioCraftError('ERR_INVALID_FILENAME', 'Rust RPC operation name cannot be empty.');
  }

  if (options.cacheKey) {
    const cached = TauriIpcCache.get<{
      data: TResult;
      transport: 'rust-rest-http' | 'tauri-rust-ipc' | 'rust-wasm-sync';
    }>(options.cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  if (options.preferRest !== false && activeRustRestBaseUrl) {
    try {
      const resp = await fetch(
        `${activeRustRestBaseUrl}/rpc/${encodeURIComponent(trimmedOp)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-MolBioCraft-Client': 'MolBioCraft/1.0.0',
            ...(activeRustRestToken ? { 'X-MolBioCraft-Token': activeRustRestToken } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      if (resp.status === 401) {
        // Not authorised (no desktop token): use IPC / WASM instead.
        throw new Error('REST unauthorised');
      }
      const envelope = (await resp.json()) as {
        ok?: boolean;
        data?: TResult;
        error?: string;
      };
      if (!resp.ok || !envelope?.ok) {
        throw parseRustErrorToMolBioCraftError(
          envelope?.error ?? `HTTP ${resp.status}`,
          `REST /api/v1/rpc/${trimmedOp}`
        );
      }
      const out = {
        data: envelope.data as TResult,
        transport: 'rust-rest-http' as const,
      };
      if (options.cacheKey) {
        TauriIpcCache.set(options.cacheKey, out);
      }
      return out;
    } catch (err) {
      if (err instanceof MolBioCraftError) {
        throw err;
      }
      // Network/socket interruption: fall through cleanly to Tauri IPC / Rust WASM
    }
  }

  if (isTauriDesktopRuntime()) {
    const data = (await invokeTauriCommand('cmd_rust_bio_invoke', {
      op: trimmedOp,
      payload,
    })) as TResult;
    const out = { data, transport: 'tauri-rust-ipc' as const };
    if (options.cacheKey) {
      TauriIpcCache.set(options.cacheKey, out);
    }
    return out;
  }

  const data = invokeRustBioSync<TResult>(trimmedOp, payload);
  const out = { data, transport: 'rust-wasm-sync' as const };
  if (options.cacheKey) {
    TauriIpcCache.set(options.cacheKey, out);
  }
  return out;
}

/**
 * Query platform diagnostics via Tauri Rust `cmd_platform_diagnostics` when in Desktop mode,
 * or synthesize equivalent diagnostics via `createPlatformAdapter` in Web/Standalone mode.
 */
export async function queryPlatformDiagnosticsHybrid(): Promise<
  TauriPlatformDiagnostics & { backend: 'tauri-rust-ipc' | 'typescript-fallback' }
> {
  if (isTauriDesktopRuntime()) {
    const diag = await invokeTauriCommand(
      'cmd_platform_diagnostics',
      {},
      { cacheKey: 'diag:platform' }
    );
    return { ...diag, backend: 'tauri-rust-ipc' };
  }

  const hostOs = detectHostOS();
  const adapter = createPlatformAdapter(hostOs);
  const dirs = adapter.resolveDirectories();
  return {
    os: hostOs,
    arch: detectCpuArch(),
    case_sensitive_fs: adapter.filesystemCaseSensitive,
    app_support_dir: dirs.appSupportDir,
    logs_dir: dirs.logsDir,
    cache_dir: dirs.cacheDir,
    backend: 'typescript-fallback',
  };
}

/**
 * Execute pairwise Needleman-Wunsch or Smith-Waterman alignment via Tauri's Rust -> C++17 FFI
 * (`cmd_pairwise_align`) with LRU caching when active, falling back cleanly to TypeScript otherwise.
 */
export async function invokePairwiseAlignHybrid(
  seq1: string,
  seq2: string,
  local = false,
  scoring = { matchScore: 2, mismatchPenalty: -1, gapOpen: -3, gapExtend: -1 }
): Promise<PairwiseAlignmentResult> {
  const clean1 = seq1.trim();
  const clean2 = seq2.trim();
  if (!clean1 || !clean2) {
    throw new MolBioCraftError(
      'ERR_EMPTY_SEQUENCE',
      'Both sequences must be non-empty for pairwise alignment.'
    );
  }

  const cacheKey = `align:${local ? 'SW' : 'NW'}:${scoring.matchScore}:${scoring.mismatchPenalty}:${scoring.gapOpen}:${scoring.gapExtend}:${clean1}:${clean2}`;

  if (isTauriDesktopRuntime()) {
    const out = await invokeTauriCommand(
      'cmd_pairwise_align',
      {
        seq1: clean1,
        seq2: clean2,
        local,
        matchScore: scoring.matchScore,
        mismatchPenalty: scoring.mismatchPenalty,
        gapOpen: scoring.gapOpen,
        gapExtend: scoring.gapExtend,
      },
      { cacheKey }
    );
    return {
      alignedSeq1: out.aligned_seq1,
      alignedSeq2: out.aligned_seq2,
      midline: out.midline,
      score: out.score,
      matches: out.matches,
      mismatches: out.mismatches,
      gaps: out.gaps,
      identityPct: Number(out.identity_pct.toFixed(2)),
      algorithm: local ? 'Smith-Waterman (Local)' : 'Needleman-Wunsch (Global)',
      engineUsed: 'C++ Native / Rust FFI',
    };
  }

  const cachedTs = TauriIpcCache.get<PairwiseAlignmentResult>(cacheKey);
  if (cachedTs) return cachedTs;

  const tsResult = alignPairwiseTypeScript(clean1, clean2, local);
  TauriIpcCache.set(cacheKey, tsResult);
  return tsResult;
}

/**
 * Batch sequence statistics across multiple workspace documents in a SINGLE Tauri IPC call
 * (`cmd_batch_sequence_stats`), eliminating N-round-trip serialization overhead.
 */
export async function invokeBatchSequenceStatsHybrid(
  docs: ReadonlyArray<Pick<SequenceDocument, 'id' | 'name' | 'sequence'>>
): Promise<{
  entries: TauriBatchSequenceStatsEntry[];
  backend: 'tauri-rust-ipc' | 'typescript-fallback';
}> {
  if (docs.length === 0) {
    throw new MolBioCraftError(
      'ERR_EMPTY_SEQUENCE',
      'Batch sequence stats requires at least one document.'
    );
  }

  const items: TauriBatchSequenceItem[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    sequence: d.sequence,
  }));

  if (isTauriDesktopRuntime()) {
    const entries = await invokeTauriCommand('cmd_batch_sequence_stats', { items });
    return { entries, backend: 'tauri-rust-ipc' };
  }

  for (const item of items) {
    if (!item.sequence.trim()) {
      throw new MolBioCraftError(
        'ERR_EMPTY_SEQUENCE',
        `Document "${item.name}" contains an empty sequence.`
      );
    }
  }
  const entries = invokeRustBioSync<TauriBatchSequenceStatsEntry[]>(
    'compute_batch_sequence_stats',
    { items }
  );
  return { entries, backend: 'typescript-fallback' };
}

/**
 * Hybrid SantaLucia (1998) primer thermodynamics & IUPAC reverse-complement helpers with LRU cache.
 */
export async function invokePrimerThermodynamicsHybrid(
  seq: string,
  naMm = 50,
  mgMm = 1.5,
  primerNm = 250
): Promise<TauriPrimerThermodynamics> {
  const clean = seq.trim();
  if (!clean) {
    throw new MolBioCraftError('ERR_EMPTY_SEQUENCE', 'Primer sequence cannot be empty.');
  }
  const cacheKey = `thermo:${naMm}:${mgMm}:${primerNm}:${clean}`;
  if (isTauriDesktopRuntime()) {
    return invokeTauriCommand(
      'cmd_primer_thermodynamics',
      { seq: clean, naMm, mgMm, primerNm },
      { cacheKey }
    );
  }
  const cached = TauriIpcCache.get<TauriPrimerThermodynamics>(cacheKey);
  if (cached) return cached;

  const fallback = invokeRustBioSync<TauriPrimerThermodynamics>(
    'calculate_primer_thermodynamics_santalucia',
    {
      seq: clean,
      naMm,
      mgMm,
      primerNm,
    }
  );
  TauriIpcCache.set(cacheKey, fallback);
  return fallback;
}

export async function invokeReverseComplementHybrid(seq: string): Promise<string> {
  const clean = seq.trim();
  if (!clean) {
    throw new MolBioCraftError('ERR_EMPTY_SEQUENCE', 'Sequence cannot be empty.');
  }
  const cacheKey = `rc:${clean}`;
  if (isTauriDesktopRuntime()) {
    return invokeTauriCommand('cmd_reverse_complement', { seq: clean }, { cacheKey });
  }
  const cached = TauriIpcCache.get<string>(cacheKey);
  if (cached !== undefined) return cached;
  const rc = reverseComplement(clean);
  TauriIpcCache.set(cacheKey, rc);
  return rc;
}
