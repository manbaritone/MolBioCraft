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
      ['view:fit', 'Fit'],
      ['view:reset-view', 'Reset View'],
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
  it('US-01M7DVEN AC4 lists Fit and Reset View in View > Zoom after Actual Size, under Fit\'s rule, each case calling the in-app items\' handler', () => {
    const zoom = mainRs.slice(mainRs.indexOf('let view_zoom_sub'), mainRs.indexOf('let view_menu'));
    expect(zoom).toContain('"Zoom"');
    // The submenu's entries in order, separators included.
    const entries = [...zoom.matchAll(/item\(\s*"([^"]+)"|sep\(\)/g)].map((m) => m[1] ?? '---');
    expect(entries).toEqual([
      'view:zoom-in', 'view:zoom-out', 'view:zoom-reset', 'view:fit', 'view:reset-view', '---',
      'view:set-origin', 'view:rotate-map', 'view:reset-rotation',
    ]);
    expect([...zoom.matchAll(/item\(\s*"(view:fit|view:reset-view)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['view:fit', 'Fit'],
      ['view:reset-view', 'Reset View'],
    ]);
    // view:reset-rotation stays the one Reset Rotation id; each new id is listed once in the whole menu.
    expect([...mainRs.matchAll(/item\(\s*"([^"]+)",\s*"Reset Rotation"/g)].map((m) => m[1])).toEqual(['view:reset-rotation']);
    for (const id of ['view:fit', 'view:reset-view']) {
      expect([...mainRs.matchAll(new RegExp(`item\\(\\s*"${id}"`, 'g'))], id).toHaveLength(1);
      expect(nativeIds.has(id)).toBe(true);
      expect(NATIVE_MENU_COMMAND_RULES[id], `${id} follows Fit's rule`).toBe('fit-view');
      expect(dispatcher.get(id), `${id}: the dispatcher gates it on a session`).toBe(true);
      expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).not.toContain(id);
    }
    expect(NATIVE_MENU_COMMAND_RULES['view:reset-rotation']).toBe('rotate-map');

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
      ['view:fit', 'view-fit', "fitFocusedPane('fit')"],
      ['view:reset-view', 'view-reset-view', "fitFocusedPane('reset')"],
    ]) {
      expect(itemSelect(inApp), inApp).toBe(`requireActiveSession(() => ${call})`);
      expect(caseBody(native).trim(), native).toBe(`case '${native}':\n          requireActiveSession(() => ${call});`);
    }

    // The native items are on exactly where Fit's rule is, for each pane, and the two ids agree.
    const doc = (id: string, sequence: string, more: Record<string, unknown> = {}) =>
      buildCommandDocumentContext({ id, moleculeType: 'DNA', topology: 'circular', sequence, ...more });
    const base = { sessionActive: true, selection: null, undoDepth: 0, redoDepth: 0 };
    const cases: [string, Parameters<typeof buildNativeMenuState>[0], boolean][] = [
      ['no session', { ...base, sessionActive: false, activeDoc: null }, false],
      ['a circle in Split', { ...base, activeDoc: doc('c', 'ATGC'.repeat(50)), mapLayout: 'split' }, true],
      ['Map Layout Linear', { ...base, activeDoc: doc('c', 'ATGC'.repeat(50)), mapLayout: 'linear' }, true],
      ['a record with no bases', { ...base, activeDoc: doc('e', ''), mapLayout: 'linear' }, false],
      ['the focused pane on Linear Map', { ...base, activeDoc: doc('c', 'ATGC'.repeat(50)), focusedSplitPane: { circularMapShown: false, sequenceMapShown: true } }, true],
      ['the focused pane on Info', { ...base, activeDoc: doc('c', 'ATGC'.repeat(50)), focusedSplitPane: { circularMapShown: false, sequenceMapShown: false } }, false],
    ];
    for (const [what, ctx, want] of cases) {
      expect(commandAvailability('fit-view', ctx).enabled, `${what}: Fit's rule`).toBe(want);
      const state = buildNativeMenuState(ctx);
      expect(['view:fit', 'view:reset-view'].map((id) => resolveNativeMenuItemEnabled(id, state)), what).toEqual([want, want]);
    }
  });
  it('lists View › Search & Filter › Search Project… natively, its dispatcher case gated on a session (US-01M7DV88 AC1)', () => {
    const sub = mainRs.slice(mainRs.indexOf('let view_search_sub'), mainRs.indexOf('let view_panels_sub'));
    expect(sub.length).toBeGreaterThan(0);
    const items = [...sub.matchAll(/item\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    // Beside the table filter's two items, which stay.
    expect(items).toEqual([
      ['view:filter-folder', 'Filter Folder'],
      ['view:search-tools', 'Search Tools & Files'],
      ['view:search-project', 'Search Project…'],
    ]);
    expect(nativeIds.has('view:search-project')).toBe(true);
    // The case's first line is requireActiveSession, so no session-independent list may name it.
    expect(dispatcher.get('view:search-project')).toBe(true);
    expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).not.toContain('view:search-project');
    expect(NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES.some((p) => 'view:search-project'.startsWith(p))).toBe(false);
    const base = { activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
    expect(resolveNativeMenuItemEnabled('view:search-project', buildNativeMenuState({ ...base, sessionActive: false }))).toBe(false);
    expect(resolveNativeMenuItemEnabled('view:search-project', buildNativeMenuState({ ...base, sessionActive: true }))).toBe(true);
  });

  it('US-01M7DVR0 AC1 lists View › Document Split natively after Split & Expand, with no check mark, each case calling the in-app item\'s setter', () => {
    const sub = mainRs.slice(mainRs.indexOf('let view_docsplit_sub'), mainRs.indexOf('let view_cols_sub'));
    expect(sub).toContain('"Document Split"');
    expect([...sub.matchAll(/item\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['view:document-split-single', 'Single Pane'],
      ['view:document-split-side-by-side', 'Side by Side'],
      ['view:document-split-top-bottom', 'Top and Bottom'],
    ]);
    // In the View menu, right after Split & Expand.
    const view = mainRs.slice(mainRs.indexOf('let view_menu'), mainRs.indexOf('let enz_select_sub'));
    expect(view).toMatch(/&view_split_expand_sub,\s*&view_docsplit_sub,\s*&view_cols_sub,/);
    // No native item carries a check mark, so only the in-app items show the current split.
    expect(mainRs).not.toMatch(/CheckMenuItem/);
    // The document-table items keep their ids under their new labels.
    const split = mainRs.slice(mainRs.indexOf('let view_split_expand_sub'), mainRs.indexOf('let view_docsplit_sub'));
    expect([...split.matchAll(/item\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]).slice(0, 2)).toEqual([
      ['view:split-top-bottom', 'Document Table Below Viewer'],
      ['view:split-left-right', 'Document Table Beside Viewer'],
    ]);
    expect(mainRs).not.toMatch(/"Split (Top \/ Bottom|Left \/ Right)"/);

    const caseBody = (id: string) => {
      const at = appTsx.indexOf(`case '${id}':`, appTsx.indexOf('    onMenuAction: (actionId: string) => {'));
      expect(at, `the dispatcher case ${id}`).toBeGreaterThan(0);
      return appTsx.slice(at, appTsx.indexOf('break;', at));
    };
    const itemToggle = (id: string) => {
      const at = appTsx.indexOf(`id: '${id}',`);
      expect(at, `the in-app item ${id}`).toBeGreaterThan(0);
      return /onToggle: \(\) => (.+),\n/.exec(appTsx.slice(at, appTsx.indexOf('},', at)))?.[1] ?? '';
    };
    for (const [native, inApp, orientation] of [
      ['view:document-split-single', 'view-docsplit-single', 'single'],
      ['view:document-split-side-by-side', 'view-docsplit-side', 'side-by-side'],
      ['view:document-split-top-bottom', 'view-docsplit-stacked', 'top-bottom'],
    ]) {
      const call = `requireActiveSession(() => chooseDocumentSplit('${orientation}'))`;
      expect(itemToggle(inApp), inApp).toBe(call);
      expect(caseBody(native).trim(), native).toBe(`case '${native}':\n          ${call};`);
      expect(dispatcher.get(native), `${native} is gated on a session`).toBe(true);
      const base = { activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
      expect(resolveNativeMenuItemEnabled(native, buildNativeMenuState({ ...base, sessionActive: false })), native).toBe(false);
      expect(resolveNativeMenuItemEnabled(native, buildNativeMenuState({ ...base, sessionActive: true })), native).toBe(true);
    }
    // The header chooser and the split toggle call the same setter.
    expect(appTsx).toContain('onChange={(e) => chooseDocumentSplit(e.target.value as DocumentSplitOrientation)}');
    expect(appTsx).toContain("onClick={() => chooseDocumentSplit(documentSplit !== 'single' ? 'single' : lastDocumentSplitRef.current)}");
  });
});
