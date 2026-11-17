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
  commandAvailability,
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

  it('lists Databases > Primers natively, routed without a session, beside the Databases items it had (US-01M7DQFS)', () => {
    for (const id of ['tools:databases-explorer', 'tools:primer-database', 'tools:make-blast-db', 'tools:local-blast-dbs', 'tools:blast-setup']) {
      expect(nativeIds.has(id), id).toBe(true);
    }
    expect(dispatcher.get('tools:primer-database')).toBe(false);
    expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).toContain('tools:primer-database');
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('tools:primer-database', noSession)).toBe(true);
  });

  it('lists Databases > Restriction Enzymes natively after Primers, routed without a session (US-01M7DVDV AC1)', () => {
    const dbs = mainRs.slice(mainRs.indexOf('let tools_dbs_sub'), mainRs.indexOf('let tools_batch_sub'));
    expect([...dbs.matchAll(/item\("([^"]+)"/g)].map((m) => m[1])).toEqual([
      'tools:databases-explorer',
      'tools:primer-database',
      'tools:enzyme-database',
      'tools:make-blast-db',
      'tools:local-blast-dbs',
      'tools:blast-setup',
    ]);
    expect(dispatcher.get('tools:enzyme-database')).toBe(false);
    expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).toContain('tools:enzyme-database');
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('tools:enzyme-database', noSession)).toBe(true);
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

  it('US-01M7DVNS AC4 lists Rotate Circular Map… and Reset Rotation in View > Zoom after Set Origin, under the in-app items\' rule and handler', () => {
    const zoom = mainRs.slice(mainRs.indexOf('let view_zoom_sub'), mainRs.indexOf('let view_menu'));
    expect(zoom).toContain('"Zoom"');
    expect([...zoom.matchAll(/item\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['view:zoom-in', 'Zoom In'],
      ['view:zoom-out', 'Zoom Out'],
      ['view:zoom-reset', 'Actual Size (100%)'],
      ['view:set-origin', 'Set Origin'],
      ['view:rotate-map', 'Rotate Circular Map\u2026'],
      ['view:reset-rotation', 'Reset Rotation'],
    ]);
    // view:reset-rotation is the only native id for Reset Rotation, and the only one for rotation reset.
    expect([...mainRs.matchAll(/item\(\s*"([^"]+)",\s*"Reset Rotation"/g)].map((m) => m[1])).toEqual(['view:reset-rotation']);
    expect([...nativeIds].filter((id) => /rotat/.test(id)).sort()).toEqual(['view:reset-rotation', 'view:rotate-map']);
    expect(NATIVE_MENU_COMMAND_RULES['view:rotate-map']).toBe('rotate-map');
    expect(NATIVE_MENU_COMMAND_RULES['view:reset-rotation']).toBe('rotate-map');
    expect(dispatcher.get('view:rotate-map'), 'the dispatcher gates it on a session').toBe(true);
    expect(dispatcher.get('view:reset-rotation')).toBe(true);

    // Each dispatcher case runs the handler the matching in-app View item runs.
    const caseBody = (id: string) => {
      const at = appTsx.indexOf(`case '${id}':`, appTsx.indexOf('    onMenuAction: (actionId: string) => {'));
      return appTsx.slice(at, appTsx.indexOf('break;', at));
    };
    const itemSelect = (id: string) => {
      const at = appTsx.indexOf(`id: '${id}',`);
      expect(at, `the in-app item ${id}`).toBeGreaterThan(0);
      return /onSelect: \(\) => (.+),\n/.exec(appTsx.slice(at, appTsx.indexOf('},', at)))?.[1] ?? '';
    };
    for (const [native, inApp, call] of [
      ['view:rotate-map', 'view-rotate-map', "handleRotateMapCommand('open')"],
      ['view:reset-rotation', 'view-reset-rotation', "handleRotateMapCommand('reset')"],
    ]) {
      expect(itemSelect(inApp), inApp).toBe(`requireActiveSession(() => ${call})`);
      expect(caseBody(native).trim(), native).toBe(`case '${native}':\n          requireActiveSession(() => ${call});`);
    }

    // So the native items are enabled exactly where the in-app items are.
    const circular = buildCommandDocumentContext({ id: 'c', moleculeType: 'DNA', topology: 'circular', sequence: 'ATGC'.repeat(50) });
    const linear = buildCommandDocumentContext({ id: 'l', moleculeType: 'DNA', topology: 'linear', sequence: 'ATGC'.repeat(50) });
    const protein = buildCommandDocumentContext({ id: 'p', moleculeType: 'Protein', topology: 'linear', sequence: 'MKT' });
    const base = { sessionActive: true, selection: null, undoDepth: 0, redoDepth: 0 };
    const contexts = [
      { ...base, sessionActive: false, activeDoc: null },
      { ...base, activeDoc: circular, mapLayout: 'split' as const },
      { ...base, activeDoc: circular, mapLayout: 'circular' as const },
      { ...base, activeDoc: circular, mapLayout: 'linear' as const },
      { ...base, activeDoc: circular, mapLayout: 'split' as const, circleCollapsed: true },
      { ...base, activeDoc: linear, mapLayout: 'split' as const },
      { ...base, activeDoc: protein, mapLayout: 'split' as const },
    ];
    const seen = new Set<boolean>();
    for (const ctx of contexts) {
      const want = commandAvailability('rotate-map', ctx).enabled;
      seen.add(want);
      const state = buildNativeMenuState(ctx);
      expect(resolveNativeMenuItemEnabled('view:rotate-map', state), JSON.stringify(ctx)).toBe(want);
      expect(resolveNativeMenuItemEnabled('view:reset-rotation', state), JSON.stringify(ctx)).toBe(want);
    }
    expect([...seen].sort(), 'the contexts reach both states').toEqual([false, true]);
  });
});
