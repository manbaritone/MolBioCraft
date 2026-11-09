// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Static contract between the native macOS menu (src-tauri/src/main.rs), the
 * App.tsx command dispatcher and the native-menu availability rules:
 *  - every native item id reaches a dispatcher case (no dead menu items);
 *  - the ids that stay enabled without a session are exactly the dispatcher
 *    cases that do not require one (no functional item wrongly disabled, no
 *    session-only item wrongly enabled);
 *  - Undo/Redo are custom items wired to the document undo stack.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCommandDocumentContext,
  buildNativeMenuState,
  NATIVE_MENU_COMMAND_RULES,
  NATIVE_MENU_SESSION_INDEPENDENT_IDS,
  NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES,
  resolveNativeMenuItemEnabled,
} from '../core/commandAvailability';

// Same dynamic-import pattern as formatsRealFiles.test.ts (no @types/node in the project).
const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
};
const mainRs = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
const appTsx = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const nativeIds = new Set(
  Array.from(mainRs.matchAll(/item\(\s*"([a-z-]+:[a-z0-9-]+)"/g), (m) => m[1])
);

/** Dispatcher case groups: ids sharing one body, and whether that body starts with requireActiveSession. */
function parseDispatcher(): Map<string, boolean> {
  const start = appTsx.indexOf('    onMenuAction: (actionId: string) => {');
  const end = appTsx.indexOf('    onNativeFileOpen: (file, mode) => {', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const gated = new Map<string, boolean>();
  let pending: string[] = [];
  let body: string[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const first = body.join('\n').trim().split('\n')[0] ?? '';
    for (const id of pending) gated.set(id, first.includes('requireActiveSession'));
    pending = [];
    body = [];
  };
  for (const line of appTsx.slice(start, end).split('\n')) {
    const m = line.match(/^\s*case '([^']+)':(.*)$/);
    if (m) {
      if (body.join('').trim()) flush();
      pending.push(m[1]);
      if (m[2].trim()) body.push(m[2]);
    } else if (pending.length) {
      body.push(line);
    }
  }
  flush();
  return gated;
}

describe('native menu ↔ dispatcher contract', () => {
  const dispatcher = parseDispatcher();

  it('has native menu items', () => {
    expect(nativeIds.size).toBeGreaterThan(150);
  });

  it('routes every native menu id to a dispatcher case', () => {
    const orphans = [...nativeIds].filter(
      (id) => !dispatcher.has(id) && !id.startsWith('action-vec:')
    );
    expect(orphans).toEqual([]);
    expect(appTsx).toContain("actionId.startsWith('action-vec:')");
  });

  it('keeps exactly the session-independent commands enabled without a session', () => {
    const isIndependent = (id: string) =>
      NATIVE_MENU_SESSION_INDEPENDENT_IDS.includes(id) ||
      NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES.some((p) => id.startsWith(p));
    const mismatches: string[] = [];
    for (const id of nativeIds) {
      if (id.startsWith('action-vec:')) continue;
      const requiresSession = dispatcher.get(id);
      if (requiresSession === undefined) continue;
      if (requiresSession === isIndependent(id)) {
        mismatches.push(`${id}: dispatcher requires session=${requiresSession}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('only declares command rules for real dispatcher commands', () => {
    for (const id of Object.keys(NATIVE_MENU_COMMAND_RULES)) {
      expect(dispatcher.has(id), id).toBe(true);
    }
  });

  it('wires native Undo/Redo to the document undo stack, not WKWebView text undo', () => {
    expect(nativeIds.has('edit:undo')).toBe(true);
    expect(nativeIds.has('edit:redo')).toBe(true);
    expect(mainRs).not.toMatch(/PredefinedMenuItem::undo\(/);
    expect(mainRs).not.toMatch(/PredefinedMenuItem::redo\(/);
  });

  it('resolves concrete native states from the shared rules', () => {
    const protein = buildCommandDocumentContext({ id: 'p', moleculeType: 'Protein', topology: 'linear', sequence: 'MKT' });
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('file:open-session', noSession)).toBe(true);
    expect(resolveNativeMenuItemEnabled('new-session:blank', noSession)).toBe(true);
    expect(resolveNativeMenuItemEnabled('file:save-session', noSession)).toBe(false);
    expect(resolveNativeMenuItemEnabled('sequence:reverse-only', noSession)).toBe(false);

    const proteinSession = buildNativeMenuState({ sessionActive: true, activeDoc: protein, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('file:save-session', proteinSession)).toBe(true);
    expect(resolveNativeMenuItemEnabled('sequence:reverse-only', proteinSession)).toBe(false);
    expect(resolveNativeMenuItemEnabled('sequence:convert-dna-rna', proteinSession)).toBe(false);
    expect(resolveNativeMenuItemEnabled('view:set-origin', proteinSession)).toBe(false);
    expect(resolveNativeMenuItemEnabled('file:save-gb', proteinSession)).toBe(true);
    // Text-field undo must keep working, so Undo is never greyed out.
    expect(resolveNativeMenuItemEnabled('edit:undo', proteinSession)).toBe(true);
  });
});
