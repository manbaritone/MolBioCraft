// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  invokeBatchSequenceStatsHybrid,
  invokePairwiseAlignHybrid,
  invokeReverseComplementHybrid,
  isTauriDesktopRuntime,
  listenTauriEvent,
  openNativeFilesDialogTauri,
  queryPlatformDiagnosticsHybrid,
  readDroppedFileBytesTauri,
  saveNativeFileDialogTauri,
  startDesktopWindowDraggingTauri,
  TauriBatchProgressEvent,
  TauriIpcCache,
  toggleDesktopWindowMaximizeTauri,
} from '../lib/tauriIpc';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_CODES, MolBioCraftError } from '../platform/osPlatform';

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
    delete g.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    TauriIpcCache.clear();
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
    const invoked: string[] = [];
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        invoked.push(cmd);
        if (cmd === 'cmd_native_save_file_dialog') {
          throw new Error(
            "[ERR_FILE_LOCKED] File '/tmp/locked.mbc' remained locked after 4 retries"
          );
        }
        return { file_name: 'plasmid.gb', base64: 'TE9DVVM=', byte_len: 5 };
      },
    };

    // Failure 1: path traversal blocked before IPC
    await expect(readDroppedFileBytesTauri('../../etc/passwd')).rejects.toThrowError(
      /ERR_PERMISSION_DENIED/
    );

    // Failure 2: NUL byte injection blocked before IPC
    await expect(readDroppedFileBytesTauri('/tmp/plasmid\0.gb')).rejects.toThrowError(
      /ERR_INVALID_FILENAME/
    );

    // Failure 3: empty batch/sequence rejected cleanly
    await expect(invokeBatchSequenceStatsHybrid([])).rejects.toThrowError(/ERR_EMPTY_SEQUENCE/);

    // Failure 5: Dropped-file byte reader also blocks relative path traversal before IPC
    await expect(readDroppedFileBytesTauri('../secret/trace.ab1')).rejects.toThrowError(
      /ERR_PERMISSION_DENIED/
    );
    // none of the guarded paths reached the shell
    expect(invoked).toEqual([]);

    // Failure 4: Rust [ERR_FILE_LOCKED] mapped to typed MolBioCraftError
    await expect(saveNativeFileDialogTauri('locked.mbc', '{"magic":"MBC1"}')).rejects.toThrowError(
      /ERR_FILE_LOCKED/
    );
    expect(invoked).toEqual(['cmd_native_save_file_dialog']);
  });

  it('lets the WebView name a file path to one shell command only, the drop reader (US-01M6P2X0)', () => {
    // The shell reads only files dropped onto the window in this launch (D0186), so no other
    // command may take a path from the WebView: not in the UI's command map, not in the shell.
    const ipc = readFileSync(resolve(process.cwd(), 'src/lib/tauriIpc.ts'), 'utf8');
    const map = ipc.slice(ipc.indexOf('interface TauriCommandMap'));
    const mapCommands = [...map.slice(0, map.indexOf('\n}\n')).matchAll(/\n {2}(cmd_\w+): \{\s*args: ([^;]*);/g)];
    expect(mapCommands.length).toBeGreaterThan(10);
    expect(mapCommands.filter((m) => /\bpath\??:/.test(m[2])).map((m) => m[1])).toEqual([
      'cmd_read_dropped_file_bytes',
    ]);

    const shellCommands = ['bio_commands', 'fs_commands', 'tree_tool_commands', 'window_commands'].flatMap((mod) => {
      const src = readFileSync(resolve(process.cwd(), `src-tauri/src/commands/${mod}.rs`), 'utf8');
      return [...src.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (cmd_\w+)(?:<[^>]*>)?\(([^)]*)\)/g)];
    });
    expect(shellCommands.length).toBeGreaterThan(10);
    expect(
      shellCommands.filter((m) => /\bpath\s*:|PathBuf/.test(m[2])).map((m) => m[1])
    ).toEqual(['cmd_read_dropped_file_bytes']);

    // and the shell's window-event handler is what records a drop (main.rs grant_native_drop)
    const main = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');
    const handler = main.slice(main.indexOf('.on_window_event(|window, event| {'), main.indexOf('.invoke_handler('));
    expect(handler).toMatch(/^\.on_window_event\(\|window, event\| \{\s*grant_native_drop\(&window\.state::<AppBackendState>\(\), event\);/);
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

  it('opens and saves through the native file dialogs over Tauri v2 IPC, with no REST command and no fetch', async () => {
    // The UI no longer uses the embedded REST server (D0174): the dialogs are IPC commands, and
    // nothing here may ask the shell for a REST endpoint or reach for the network.
    const origFetch = globalThis.fetch;
    const fetchedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchedUrls.push(String(input));
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const invoked: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

    try {
      g.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          invoked.push({ cmd, args });
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

      const picked = await openNativeFilesDialogTauri('import');
      expect(picked).toEqual({
        files: [{ file_name: 'pET28a.gb', base64: 'TE9DVVM=', byte_len: 5 }],
        filesLeftOut: 0,
      });

      const saved = await saveNativeFileDialogTauri('Saved_Construct.mbc', '{"magic":"MBC1"}');
      expect(saved).toBe('Saved_Construct.mbc');

      expect(invoked.map((entry) => entry.cmd)).toEqual([
        'cmd_native_open_files_dialog',
        'cmd_native_save_file_dialog',
      ]);
      expect(invoked[0].args?.mode).toBe('import');
      expect(invoked[1].args).toMatchObject({ filename: 'Saved_Construct.mbc', content: '{"magic":"MBC1"}' });
      expect(fetchedUrls).toEqual([]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('keeps the code of a Rust ERR_PAYLOAD_TOO_LARGE or ERR_IO_FAILURE reply', async () => {
    // A reply whose tag the parser does not know turns into ERR_INVALID_FILENAME, so a size limit
    // or a missing file would read as a bad file name. The parser's known codes are ERROR_CODES,
    // the one list ErrorCode is derived from (US-01M6P2C1).
    let reply = '';
    g.__TAURI_INTERNALS__ = {
      invoke: async () => {
        throw reply;
      },
    };
    const codeOf = async (rustReply: string): Promise<string> => {
      reply = rustReply;
      try {
        await readDroppedFileBytesTauri('/Users/researcher/Desktop/trace_sample.ab1');
      } catch (err) {
        expect(err).toBeInstanceOf(MolBioCraftError);
        return (err as MolBioCraftError).code;
      }
      throw new Error(`no error for ${rustReply}`);
    };

    // a dropped file over the limit, and one that is gone: told apart from an ungranted one
    expect(await codeOf("[ERR_PAYLOAD_TOO_LARGE] Dropped file 'big.fasta' (67108865 bytes) exceeds 64 MiB limit")).toBe(
      'ERR_PAYLOAD_TOO_LARGE'
    );
    expect(await codeOf('[ERR_IO_FAILURE] No such file or directory (os error 2)')).toBe('ERR_IO_FAILURE');
    expect(await codeOf('[ERR_PERMISSION_DENIED] Operation not permitted (os error 1)')).toBe(
      'ERR_PERMISSION_DENIED'
    );
    // a path never dropped onto the window (US-01M6P2X0)
    expect(
      await codeOf(
        "[ERR_SANDBOX_VIOLATION] '/Users/researcher/notes.txt' was not dropped onto the window in this launch, so MolBioCraft does not read it"
      )
    ).toBe('ERR_SANDBOX_VIOLATION');

    // every tag the Rust engine's errors print reaches the UI with its own code
    const engine = readFileSync(resolve(process.cwd(), 'crates/molbiocraft-core/src/lib.rs'), 'utf8');
    const display = engine.slice(engine.indexOf('impl fmt::Display for BioEngineError'));
    const rustTags = [...display.slice(0, display.indexOf('\nimpl ')).matchAll(/"\[(ERR_[A-Z_]+)\]/g)].map((m) => m[1]);
    expect(rustTags).toEqual(
      expect.arrayContaining(['ERR_PAYLOAD_TOO_LARGE', 'ERR_IO_FAILURE', 'ERR_SANDBOX_VIOLATION'])
    );
    expect(rustTags).not.toContain('ERR_PATH_TOO_LONG');
    for (const tag of rustTags) {
      expect(await codeOf(`[${tag}] detail`), tag).toBe(tag);
    }
    // and so does every code in the list, which is the whole of what the parser knows
    for (const code of ERROR_CODES) {
      expect(await codeOf(`[${code}] detail`), code).toBe(code);
    }
    // a tag outside the list is still not passed through as a code
    expect(await codeOf('[ERR_ASYNC_JOIN] task panicked')).toBe('ERR_INVALID_FILENAME');
  });
});
