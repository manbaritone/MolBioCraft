// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureRustRestBaseUrl,
  discoverRustRestApiEndpoint,
  fetchRustRestHealth,
  getActiveRustRestBaseUrl,
  invokeBatchSequenceStatsHybrid,
  invokePairwiseAlignHybrid,
  invokePrimerThermodynamicsHybrid,
  invokeReverseComplementHybrid,
  invokeRustFullStackRpc,
  isTauriDesktopRuntime,
  listenTauriEvent,
  openNativeFilesDialogTauri,
  queryPlatformDiagnosticsHybrid,
  readDroppedFileBytesTauri,
  readWorkspaceFileTauri,
  saveNativeFileDialogTauri,
  startDesktopWindowDraggingTauri,
  TauriBatchProgressEvent,
  TauriIpcCache,
  toggleDesktopWindowMaximizeTauri,
  writeWorkspaceFileTauri,
} from '../lib/tauriIpc';

interface MockTauriInternals {
  __TAURI_INTERNALS__?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    transformCallback?: (cb: (event: unknown) => void) => number;
  };
}

describe('Tauri v2 IPC Bridge, Batch Operations, LRU Cache & Path Security', () => {
  const g = globalThis as unknown as MockTauriInternals;

  beforeEach(() => {
    TauriIpcCache.clear();
    configureRustRestBaseUrl(null);
    delete g.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    TauriIpcCache.clear();
    configureRustRestBaseUrl(null);
    delete g.__TAURI_INTERNALS__;
  });

  it('falls back cleanly to synchronous Rust WASM bioEngine when running outside Tauri Desktop', async () => {
    expect(isTauriDesktopRuntime()).toBe(false);

    const diag = await queryPlatformDiagnosticsHybrid();
    expect(diag.backend).toBe('typescript-fallback');
    expect(diag.app_support_dir.length).toBeGreaterThan(0);

    const align = await invokePairwiseAlignHybrid('ATGGTGAGCAAG', 'ATGGTGTCTAAG', false);
    expect(align.engineUsed).toBe('C++ Native / Rust FFI');
    expect(align.identityPct).toBeGreaterThan(70);

    const thermo = await invokePrimerThermodynamicsHybrid('GCTAGCTAGCTAGCTAGCTA', 50, 1.5, 250);
    expect(thermo.length).toBe(20);
    expect(thermo.tm_salt_corrected_c).toBeGreaterThan(45);

    const rc = await invokeReverseComplementHybrid('GAATTC');
    expect(rc).toBe('GAATTC');

    // no shell, no native dialog: nothing read and nothing left out, in the reply's own shape
    expect(await openNativeFilesDialogTauri('folder')).toEqual({ files: [], filesLeftOut: 0 });
  });

  it('dispatches to Rust commands in Tauri Desktop mode, caches deterministic calls, and batches workspace stats', async () => {
    const invokedCommands: string[] = [];
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        invokedCommands.push(cmd);
        if (cmd === 'cmd_pairwise_align') {
          return {
            aligned_seq1: 'ATGGTG',
            aligned_seq2: 'ATGGTG',
            midline: '||||||',
            score: 12,
            matches: 6,
            mismatches: 0,
            gaps: 0,
            identity_pct: 100.0,
          };
        }
        if (cmd === 'cmd_batch_sequence_stats') {
          const items = (args?.items as { id: string; name: string; sequence: string }[]) ?? [];
          return items.map((it) => ({
            id: it.id,
            name: it.name,
            stats: {
              length: it.sequence.length,
              gc_percent: 50,
              at_percent: 50,
              mw_ssdna_da: 3600,
              mw_dsdna_da: 7200,
              basic_tm_c: 36,
              counts: { A: 3, T: 3, G: 3, C: 3 },
            },
          }));
        }
        throw new Error(`[ERR_INVALID_FILENAME] Unexpected command ${cmd}`);
      },
    };

    expect(isTauriDesktopRuntime()).toBe(true);

    // First call hits Tauri Rust/C++ IPC; second identical call hits bounded LRU cache
    const first = await invokePairwiseAlignHybrid('ATGGTG', 'ATGGTG', false);
    const second = await invokePairwiseAlignHybrid('ATGGTG', 'ATGGTG', false);
    expect(first.engineUsed).toBe('C++ Native / Rust FFI');
    expect(second.identityPct).toBe(100);
    expect(invokedCommands.filter((c) => c === 'cmd_pairwise_align')).toHaveLength(1);
    expect(TauriIpcCache.getTelemetry().hits).toBe(1);

    // Multi-document batch stats executes in 1 IPC call instead of 3 separate calls
    const batchRes = await invokeBatchSequenceStatsHybrid([
      { id: '1', name: 'pUC19', sequence: 'GAATTCATGGTG' },
      { id: '2', name: 'pET28a', sequence: 'GGATCCATGGTG' },
      { id: '3', name: 'eGFP', sequence: 'AAGCTTATGGTG' },
    ]);
    expect(batchRes.backend).toBe('tauri-rust-ipc');
    expect(batchRes.entries).toHaveLength(3);
    expect(invokedCommands.filter((c) => c === 'cmd_batch_sequence_stats')).toHaveLength(1);
  });

  it('subscribes to Tauri backend events and deterministically unlistens without leaking callbacks', async () => {
    let storedCallback: ((evt: unknown) => void) | null = null;
    let unlistenCalledWithId: number | null = null;

    g.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => {
        storedCallback = cb;
        return 77;
      },
      invoke: async (cmd, args) => {
        if (cmd === 'plugin:event|listen') {
          return 901;
        }
        if (cmd === 'plugin:event|unlisten') {
          unlistenCalledWithId = (args?.eventId as number) ?? null;
          return null;
        }
        return null;
      },
    };

    const received: TauriBatchProgressEvent[] = [];
    const unlisten = await listenTauriEvent<TauriBatchProgressEvent>(
      'mbc://batch-progress',
      (evt) => received.push(evt.payload)
    );

    const emitMockEvent = storedCallback as ((evt: unknown) => void) | null;
    emitMockEvent?.({
      event: 'mbc://batch-progress',
      id: 901,
      payload: { processed: 3, total: 3, status: 'completed' },
    });
    expect(received).toEqual([{ processed: 3, total: 3, status: 'completed' }]);

    unlisten();
    expect(unlistenCalledWithId).toBe(901);
  });

  it('enforces frontend path-traversal guards and translates Rust error codes into MolBioCraftError', async () => {
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === 'cmd_write_workspace_file') {
          throw new Error(
            "[ERR_FILE_LOCKED] File '/tmp/locked.mbc' remained locked after 4 retries"
          );
        }
        return 'LOCUS pUC19';
      },
    };

    // Failure 1: path traversal blocked before IPC
    await expect(readWorkspaceFileTauri('../../etc/passwd')).rejects.toThrowError(
      /ERR_PERMISSION_DENIED/
    );

    // Failure 2: NUL byte injection blocked before IPC
    await expect(readWorkspaceFileTauri('/tmp/plasmid\0.gb')).rejects.toThrowError(
      /ERR_INVALID_FILENAME/
    );

    // Failure 3: empty batch/sequence rejected cleanly
    await expect(invokeBatchSequenceStatsHybrid([])).rejects.toThrowError(/ERR_EMPTY_SEQUENCE/);

    // Failure 4: Rust [ERR_FILE_LOCKED] mapped to typed MolBioCraftError
    await expect(writeWorkspaceFileTauri('/tmp/locked.mbc', '{"magic":"MBC1"}')).rejects.toThrowError(
      /ERR_FILE_LOCKED/
    );

    // Failure 5: Dropped-file byte reader also blocks relative path traversal before IPC
    await expect(readDroppedFileBytesTauri('../secret/trace.ab1')).rejects.toThrowError(
      /ERR_PERMISSION_DENIED/
    );
  });

  it('invokes native window drag/maximize commands and reads binary dropped file bytes via Tauri v2 IPC', async () => {
    const invoked: { cmd: string; args?: Record<string, unknown> }[] = [];
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        invoked.push({ cmd, args });
        if (cmd === 'cmd_read_dropped_file_bytes') {
          return {
            file_name: 'trace_sample.ab1',
            base64: 'QUJJRg==', // "ABIF"
            byte_len: 4,
          };
        }
        return null;
      },
    };

    await startDesktopWindowDraggingTauri();
    await toggleDesktopWindowMaximizeTauri();
    const dropped = await readDroppedFileBytesTauri('/Users/researcher/Desktop/trace_sample.ab1');

    expect(invoked.map((entry) => entry.cmd)).toEqual([
      'cmd_window_start_dragging',
      'cmd_window_toggle_maximize',
      'cmd_read_dropped_file_bytes',
    ]);
    expect(dropped.file_name).toBe('trace_sample.ab1');
    expect(dropped.byte_len).toBe(4);
    expect(dropped.base64).toBe('QUJJRg==');
  });

  it('executes full-stack Rust RPC across RESTful HTTP/JSON, Tauri v2 IPC, and Rust WASM with native file dialog helpers', async () => {
    // 1. Offline / standalone fallback uses embedded synchronous Rust WASM
    const wasmOut = await invokeRustFullStackRpc<string>('reverse_complement', {
      seq: 'GAATTC',
    });
    expect(wasmOut.transport).toBe('rust-wasm-sync');
    expect(wasmOut.data).toBe('GAATTC');

    // 2. Embedded Rust RESTful HTTP API (/api/v1/health & /api/v1/rpc/<op>)
    const origFetch = globalThis.fetch;
    const fetchedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.endsWith('/api/v1/health')) {
        return new Response(
          JSON.stringify({
            ok: true,
            service: 'molbiocraft-rust-restful-engine',
            version: '1.0.0',
            os: 'macos',
            arch: 'aarch64',
            port: 18420,
            base_url: 'http://127.0.0.1:18420/api/v1',
            worker_threads: 8,
            ipc_calls: 2,
            rest_calls: 1,
            crates: [
              'molbiocraft-core',
              'molbiocraft-formats',
              'molbiocraft-align',
              'molbiocraft-phylo',
              'molbiocraft-cloning',
              'molbiocraft-protein',
              'molbiocraft-wasm',
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/rpc/reverse_complement')) {
        return new Response(
          JSON.stringify({ ok: true, op: 'reverse_complement', data: 'AAGCTT' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
        status: 404,
      });
    }) as typeof fetch;

    try {
      g.__TAURI_INTERNALS__ = {
        invoke: async (cmd) => {
          if (cmd === 'cmd_rest_api_info') {
            return {
              active: true,
              port: 18420,
              base_url: 'http://127.0.0.1:18420/api/v1',
              ipc_calls: 1,
              rest_calls: 0,
              worker_threads: 8,
            };
          }
          if (cmd === 'cmd_native_open_files_dialog') {
            // the backend's reply (OpenedFilesReply, fs_commands.rs): the files read, and how many
            // supported files of a picked folder it left out (BG-01M6S17Y)
            return {
              files: [{ file_name: 'pET28a.gb', base64: 'TE9DVVM=', byte_len: 5 }],
              filesLeftOut: 0,
            };
          }
          if (cmd === 'cmd_native_save_file_dialog') {
            return 'Saved_Construct.mbc';
          }
          return null;
        },
      };

      const info = await discoverRustRestApiEndpoint();
      expect(info?.active).toBe(true);
      expect(getActiveRustRestBaseUrl()).toBe('http://127.0.0.1:18420/api/v1');

      const health = await fetchRustRestHealth();
      expect(health.service).toBe('molbiocraft-rust-restful-engine');
      expect(health.crates).toHaveLength(7);

      const restRpc = await invokeRustFullStackRpc<string>(
        'reverse_complement',
        { seq: 'AAGCTT' },
        { cacheKey: 'rest:rc:AAGCTT' }
      );
      expect(restRpc.transport).toBe('rust-rest-http');
      expect(restRpc.data).toBe('AAGCTT');
      expect(fetchedUrls).toContain('http://127.0.0.1:18420/api/v1/rpc/reverse_complement');

      const picked = await openNativeFilesDialogTauri('import');
      expect(picked).toEqual({
        files: [{ file_name: 'pET28a.gb', base64: 'TE9DVVM=', byte_len: 5 }],
        filesLeftOut: 0,
      });

      const saved = await saveNativeFileDialogTauri('Saved_Construct.mbc', '{"magic":"MBC1"}');
      expect(saved).toBe('Saved_Construct.mbc');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
