// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

// Regression: files the OS asked the desktop app to open are taken from the
// backend queue (which empties it). When that drain resolved after the
// subscription was torn down — React StrictMode mounts effects twice — the
// files were discarded and never imported.

import { describe, expect, it } from 'vitest';
import { subscribeNativeMacMenuEvents } from '../platform/macosMenuBridge';

describe('OS file-open queue across subscription remounts', () => {
  it('delivers files drained by a torn-down subscription to the live one', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const hadWindow = typeof g.window !== 'undefined';
    if (!hadWindow) g.window = new EventTarget();
    const previousInternals = g.__TAURI_INTERNALS__;
    let releaseFirstDrain: (v: unknown) => void = () => {};
    let takeCalls = 0;
    g.__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        if (cmd === 'cmd_take_pending_open_files') {
          takeCalls += 1;
          if (takeCalls === 1) return new Promise((resolve) => (releaseFirstDrain = resolve));
          return Promise.resolve([]);
        }
        return Promise.resolve(0);
      },
      transformCallback: () => 0,
    };
    try {
      const firstOpened: string[] = [];
      const secondOpened: string[] = [];
      const unsubscribeFirst = subscribeNativeMacMenuEvents({
        onMenuAction: () => {},
        onNativeFileOpen: (file) => firstOpened.push(file.name),
      });
      unsubscribeFirst();
      const unsubscribeSecond = subscribeNativeMacMenuEvents({
        onMenuAction: () => {},
        onNativeFileOpen: (file) => secondOpened.push(file.name),
      });
      // The first (already torn down) drain now returns the queued file.
      releaseFirstDrain([{ file_name: 'pUC19.gb', base64: btoa('LOCUS x'), byte_len: 7 }]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(firstOpened).toEqual([]);
      expect(secondOpened).toEqual(['pUC19.gb']);
      unsubscribeSecond();
    } finally {
      g.__TAURI_INTERNALS__ = previousInternals;
      if (!hadWindow) delete g.window;
    }
  });
});
