// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { useCallback, useEffect, useState } from 'react';
import {
  invokeBatchSequenceStatsHybrid,
  isTauriDesktopRuntime,
  listenTauriEvent,
  queryPlatformDiagnosticsHybrid,
  TauriBatchProgressEvent,
  TauriBatchSequenceStatsEntry,
  TauriIpcCache,
  TauriPlatformDiagnostics,
} from '../lib/tauriIpc';
import { SequenceDocument } from '../types/bio';

export interface TauriBackendHookState {
  isNativeTauri: boolean;
  diagnostics: (TauriPlatformDiagnostics & { backend: 'tauri-rust-ipc' | 'typescript-fallback' }) | null;
  batchProgress: TauriBatchProgressEvent | null;
  lastBatchStats: TauriBatchSequenceStatsEntry[];
  cacheTelemetry: { size: number; maxEntries: number; hits: number; misses: number };
  runWorkspaceBatchStats: (
    docs: ReadonlyArray<Pick<SequenceDocument, 'id' | 'name' | 'sequence'>>
  ) => Promise<TauriBatchSequenceStatsEntry[]>;
}

/**
 * Custom React hook synchronizing frontend state with the Tauri v2 Rust backend:
 * - Resolves native `cmd_platform_diagnostics` on mount
 * - Subscribes to Rust `mbc://batch-progress` events and calls `unlisten()` deterministically on unmount
 * - Provides single-call batched workspace sequence stats (`cmd_batch_sequence_stats`) + LRU cache metrics
 */
export function useTauriBackend(): TauriBackendHookState {
  const [isNativeTauri] = useState<boolean>(() => isTauriDesktopRuntime());
  const [diagnostics, setDiagnostics] = useState<
    (TauriPlatformDiagnostics & { backend: 'tauri-rust-ipc' | 'typescript-fallback' }) | null
  >(null);
  const [batchProgress, setBatchProgress] = useState<TauriBatchProgressEvent | null>(null);
  const [lastBatchStats, setLastBatchStats] = useState<TauriBatchSequenceStatsEntry[]>([]);
  const [cacheTelemetry, setCacheTelemetry] = useState(() => TauriIpcCache.getTelemetry());

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;

    void queryPlatformDiagnosticsHybrid()
      .then((diag) => {
        if (active) {
          setDiagnostics(diag);
          setCacheTelemetry(TauriIpcCache.getTelemetry());
        }
      })
      .catch((err) => {
        // Diagnostics are informational; a failure must not surface as an
        // unhandled rejection.
        // eslint-disable-next-line no-console
        console.warn('[MolBioCraft] platform diagnostics unavailable', err);
      });

    void listenTauriEvent<TauriBatchProgressEvent>('mbc://batch-progress', (evt) => {
      if (active) {
        setBatchProgress(evt.payload);
      }
    })
      .then((unlisten) => {
        if (active) {
          unlistenFn = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => {
        // No event bridge outside the desktop runtime; batch progress is optional.
      });

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  const runWorkspaceBatchStats = useCallback(
    async (docs: ReadonlyArray<Pick<SequenceDocument, 'id' | 'name' | 'sequence'>>) => {
      const res = await invokeBatchSequenceStatsHybrid(docs);
      setLastBatchStats(res.entries);
      setCacheTelemetry(TauriIpcCache.getTelemetry());
      return res.entries;
    },
    []
  );

  return {
    isNativeTauri,
    diagnostics,
    batchProgress,
    lastBatchStats,
    cacheTelemetry,
    runWorkspaceBatchStats,
  };
}
