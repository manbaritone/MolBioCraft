// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Static contract between the native macOS menu (src-tauri/native-menu.json, generated from the
 * command registry and built by src-tauri/src/native_menu.rs; US-01M6Q159), the App's native
 * dispatcher (App.tsx onMenuAction runs each native id's registry command, nativeTargets) and the
 * native-menu availability rules:
 *  - every native item id runs a registry command (no dead menu items);
 *  - the ids that stay enabled without a session are exactly the registry's session-independent
 *    commands (D0262: as the in-window menubar shows them), Undo and Redo always;
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
import { NATIVE_ENABLED_ALWAYS, nativeTargets, type NativeMenuNode } from '../core/commandRegistry';
import { CLONING_ACTION_VECTOR_PRESETS } from '../data/cloningActionVectors';

// Same dynamic-import pattern as formatsRealFiles.test.ts (no @types/node in the project).
const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
};
const SPEC_TEXT = readFileSync(new URL('../../src-tauri/native-menu.json', import.meta.url), 'utf8');
const spec = JSON.parse(SPEC_TEXT) as { menus: { label: string; items: NativeMenuNode[] }[]; dispatchOnly: string[] };
const nativeMenuRs = readFileSync(new URL('../../src-tauri/src/native_menu.rs', import.meta.url), 'utf8');
const appTsx = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const TARGETS = nativeTargets(CLONING_ACTION_VECTOR_PRESETS);

/** Every native item of the spec, in menu order, with its parent path. */
const nativeItemList: { id: string; label: string; path: string[] }[] = [];
const walkSpec = (items: readonly NativeMenuNode[], path: string[]) => {
  for (const n of items) {
    if (n.type === 'item') nativeItemList.push({ id: n.id, label: n.label, path });
    else if (n.type === 'submenu') walkSpec(n.items, [...path, n.label]);
  }
};
for (const m of spec.menus) walkSpec(m.items, [m.label]);
const nativeIds = new Set(nativeItemList.map((i) => i.id));
/** How many native items carry an id. */
const listedTimes = (id: string) => nativeItemList.filter((i) => i.id === id).length;
/** A native item's accelerator, from the spec. */
const nativeAccel = (id: string): string | undefined => {
  let found: string | undefined;
  const walk = (items: readonly NativeMenuNode[]) => items.forEach((n) => {
    if (n.type === 'item' && n.id === id) found = n.accel;
    else if (n.type === 'submenu') walk(n.items);
  });
  spec.menus.forEach((m) => walk(m.items));
  return found;
};

/** The entries of the native submenu at `path`: 'id|label' per item, 'sub:Label', 'sep', 'appkit:kind'. */
function entries(path: string[]): string[] {
  let items: readonly NativeMenuNode[] = spec.menus.find((m) => m.label === path[0])?.items ?? [];
  for (const label of path.slice(1)) {
    const next = items.find((n) => n.type === 'submenu' && n.label === label);
    items = next?.type === 'submenu' ? next.items : [];
  }
  return items.map((n) => (n.type === 'item' ? `${n.id}|${n.label}` : n.type === 'submenu' ? `sub:${n.label}` : n.type === 'separator' ? 'sep' : `appkit:${n.kind}`));
}
/** A submenu's items as [id, label]. */
const itemsOf = (path: string[]) => entries(path).filter((e) => e.includes('|')).map((e) => e.split('|'));

/**
 * The App's native dispatch set (US-01M6Q159): each native id the registry runs, and whether the
 * registry says it needs a session.
 */
function parseDispatcher(): Map<string, boolean> {
  return new Map([...TARGETS].map(([id, t]) => [id, !t.noSession]));
}
/** The in-window menubar item a native id runs (the dispatcher runs that item's handler). */
const runs = (id: string) => TARGETS.get(id)?.runs;

describe('native menu ↔ dispatcher contract', () => {
  const dispatcher = parseDispatcher();

  it('has native menu items', () => {
    expect(nativeIds.size).toBeGreaterThan(150);
  });

  it('routes every native menu id to a dispatcher case', () => {
    const orphans = [...nativeIds, ...spec.dispatchOnly].filter((id) => !dispatcher.has(id));
    expect(orphans).toEqual([]);
    // Each runs an in-window item, or one of the App's few native-only steps.
    expect(appTsx).toContain('const target = NATIVE_MENU_TARGETS.get(actionId);');
    expect([...nativeIds].filter((id) => !runs(id))).toEqual(['tools:primers']);
    expect(spec.dispatchOnly.filter((id) => !runs(id))).toEqual(['view:home']);
  });

  it('keeps exactly the session-independent commands enabled without a session', () => {
    const isIndependent = (id: string) =>
      NATIVE_MENU_SESSION_INDEPENDENT_IDS.includes(id) ||
      NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES.some((p) => id.startsWith(p));
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    const mismatches: string[] = [];
    for (const id of nativeIds) {
      const requiresSession = dispatcher.get(id);
      if (requiresSession === undefined) { mismatches.push(`${id}: no registry command`); continue; }
      if (NATIVE_ENABLED_ALWAYS.includes(id)) continue; // D0262: Undo and Redo, for text-field undo
      if (requiresSession === isIndependent(id)) mismatches.push(`${id}: the registry requires a session=${requiresSession}`);
      if (resolveNativeMenuItemEnabled(id, noSession) === requiresSession) mismatches.push(`${id}: native state with no session`);
    }
    expect(mismatches).toEqual([]);
    expect(NATIVE_ENABLED_ALWAYS.map((id) => resolveNativeMenuItemEnabled(id, noSession))).toEqual([true, true]);
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
    expect(itemsOf(['Tools', 'Databases']).map((i) => i[0])).toEqual([
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
    expect(nativeMenuRs).not.toMatch(/PredefinedMenuItem::undo\(/);
    expect(nativeMenuRs).not.toMatch(/PredefinedMenuItem::redo\(/);
    expect(SPEC_TEXT).not.toMatch(/"kind": "(undo|redo)"/);
    expect(itemsOf(['Edit']).slice(0, 2)).toEqual([['edit:undo', 'Undo'], ['edit:redo', 'Redo']]);
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

  it('US-01M7DVNS AC4 lists Rotate Circular Map… and Reset Rotation natively where the in-window View menu has them, under the in-app items\' rule and handler', () => {
    // US-01M6Q159 AC2: the native View menu is the in-window one, so the two sit in View after Tracks,
    // Set Origin in Map Layout, and View › Zoom holds the zoom items.
    expect(itemsOf(['View', 'Zoom'])).toEqual([
      ['view:zoom-in', 'Zoom In'],
      ['view:zoom-out', 'Zoom Out'],
      ['view:zoom-reset', 'Actual Size (100%)'],
      ['view:fit', 'Fit'],
      ['view:reset-view', 'Reset View'],
    ]);
    const view = entries(['View']);
    const tracks = view.indexOf('sub:Tracks');
    expect(view.slice(tracks, tracks + 3)).toEqual(['sub:Tracks', 'view:rotate-map|Rotate Circular Map\u2026', 'view:reset-rotation|Reset Rotation']);
    expect(itemsOf(['View', 'Map Layout']).map((i) => i[0])).toContain('view:set-origin');
    // view:reset-rotation is the only native id for Reset Rotation, and the only one for rotation reset.
    expect(nativeItemList.filter((i) => i.label === 'Reset Rotation').map((i) => i.id)).toEqual(['view:reset-rotation']);
    expect([...nativeIds].filter((id) => /rotat/.test(id)).sort()).toEqual(['view:reset-rotation', 'view:rotate-map']);
    expect(NATIVE_MENU_COMMAND_RULES['view:rotate-map']).toBe('rotate-map');
    expect(NATIVE_MENU_COMMAND_RULES['view:reset-rotation']).toBe('rotate-map');
    expect(dispatcher.get('view:rotate-map'), 'the dispatcher gates it on a session').toBe(true);
    expect(dispatcher.get('view:reset-rotation')).toBe(true);

    // Each dispatcher case runs the handler the matching in-app View item runs.
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
      expect(runs(native), `${native} runs the in-app item`).toBe(inApp);
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
    // The submenu's entries in order, separators included (the rotation items sit in View itself, US-01M6Q159 AC2).
    expect(entries(['View', 'Zoom']).map((e) => e.split('|')[0])).toEqual([
      'view:zoom-in', 'view:zoom-out', 'view:zoom-reset', 'view:fit', 'view:reset-view',
    ]);
    expect(itemsOf(['View', 'Zoom']).filter((i) => i[0] === 'view:fit' || i[0] === 'view:reset-view')).toEqual([
      ['view:fit', 'Fit'],
      ['view:reset-view', 'Reset View'],
    ]);
    // view:reset-rotation stays the one Reset Rotation id; each new id is listed once in the whole menu.
    expect(nativeItemList.filter((i) => i.label === 'Reset Rotation').map((i) => i.id)).toEqual(['view:reset-rotation']);
    for (const id of ['view:fit', 'view:reset-view']) {
      expect(listedTimes(id), id).toBe(1);
      expect(nativeIds.has(id)).toBe(true);
      expect(NATIVE_MENU_COMMAND_RULES[id], `${id} follows Fit's rule`).toBe('fit-view');
      expect(dispatcher.get(id), `${id}: the dispatcher gates it on a session`).toBe(true);
      expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).not.toContain(id);
    }
    expect(NATIVE_MENU_COMMAND_RULES['view:reset-rotation']).toBe('rotate-map');

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
      expect(runs(native), `${native} runs the in-app item`).toBe(inApp);
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
    const items = itemsOf(['View', 'Search & Filter']);
    // Beside the table filter's two items, which stay; Search Tools & Files is Command Palette (D0260 (2)).
    expect(items).toEqual([
      ['view:filter-folder', 'Filter Folder'],
      ['view:search-tools', 'Command Palette'],
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
    expect(entries(['View'])).toContain('sub:Document Split');
    expect(itemsOf(['View', 'Document Split'])).toEqual([
      ['view:document-split-single', 'Single Pane'],
      ['view:document-split-side-by-side', 'Side by Side'],
      ['view:document-split-top-bottom', 'Top and Bottom'],
    ]);
    // In the View menu, right after Split & Expand; Map Gallery and Compare Table follow it (US-01M7NNGQ), then Table Columns.
    const view = entries(['View']);
    const split = view.indexOf('sub:Split & Expand');
    expect(view.slice(split, split + 5)).toEqual(['sub:Split & Expand', 'sub:Document Split', 'view:map-gallery|Map Gallery', 'view:compare-table|Compare Table', 'sub:Table Columns']);
    // No native item carries a check mark, so only the in-app items show the current split.
    expect(nativeMenuRs).not.toMatch(/CheckMenuItem/);
    // The document-table items keep their ids under their new labels.
    expect(itemsOf(['View', 'Split & Expand']).slice(0, 2)).toEqual([
      ['view:split-top-bottom', 'Document Table Below Viewer'],
      ['view:split-left-right', 'Document Table Beside Viewer'],
    ]);
    expect(SPEC_TEXT).not.toMatch(/"Split (Top \/ Bottom|Left \/ Right)"/);

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
      expect(runs(native), `${native} runs the in-app item`).toBe(inApp);
      expect(dispatcher.get(native), `${native} is gated on a session`).toBe(true);
      const base = { activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
      expect(resolveNativeMenuItemEnabled(native, buildNativeMenuState({ ...base, sessionActive: false })), native).toBe(false);
      expect(resolveNativeMenuItemEnabled(native, buildNativeMenuState({ ...base, sessionActive: true })), native).toBe(true);
    }
    // The header chooser and the split toggle call the same setter.
    expect(appTsx).toContain('onChange={(e) => chooseDocumentSplit(e.target.value as DocumentSplitOrientation)}');
    expect(appTsx).toContain("onClick={() => chooseDocumentSplit(documentSplit !== 'single' ? 'single' : lastDocumentSplitRef.current)}");
  });

  it('US-01M7DVJ4 AC3 lists View › Restore Default Layout natively right after Table Columns, its case calling the in-app item\'s handler under a session', () => {
    const id = 'view:restore-default-layout';
    // In the View menu, right after Table Columns; the US-01M7DVR0 AC1 pin still holds, with US-01M7NNGQ's two items before Table Columns.
    const view = entries(['View']);
    const split = view.indexOf('sub:Split & Expand');
    expect(view.slice(split, split + 5)).toEqual(['sub:Split & Expand', 'sub:Document Split', 'view:map-gallery|Map Gallery', 'view:compare-table|Compare Table', 'sub:Table Columns']);
    const cols = view.indexOf('sub:Table Columns');
    expect(view[cols + 1]).toBe('view:restore-default-layout|Restore Default Layout');
    expect(listedTimes('view:restore-default-layout'), 'listed once').toBe(1);
    expect(nativeIds.has(id)).toBe(true);

    const itemSelect = (inApp: string) => {
      const at = appTsx.indexOf(`id: '${inApp}',`);
      expect(at, `the in-app item ${inApp}`).toBeGreaterThan(0);
      return /onSelect: \(\) => (.+),\n/.exec(appTsx.slice(at, appTsx.indexOf('},', at)))?.[1] ?? '';
    };
    const call = 'requireActiveSession(() => restoreDefaultLayout())';
    expect(itemSelect('view-restore-default-layout')).toBe(call);
    expect(runs(id), `${id} runs the in-app item`).toBe('view-restore-default-layout');

    // Gated on a session, and named by no session-independent list, so both are off without one.
    expect(dispatcher.get(id), 'the dispatcher gates it on a session').toBe(true);
    expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).not.toContain(id);
    expect(NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES.some((p) => id.startsWith(p))).toBe(false);
    const base = { activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
    expect(resolveNativeMenuItemEnabled(id, buildNativeMenuState({ ...base, sessionActive: false })), 'no session').toBe(false);
    expect(resolveNativeMenuItemEnabled(id, buildNativeMenuState({ ...base, sessionActive: true })), 'a session').toBe(true);
  });
});

describe('US-01M7DV8W AC1: View › Tracks natively', () => {
  const TRACKS: [string, string, string, string][] = [
    ['view:track-features', 'Features', 'view-track-features', 'features'],
    ['view:track-primers', 'Primers', 'view-track-primers', 'primers'],
    ['view:track-restriction-sites', 'Restriction Sites', 'view-track-restriction-sites', 'restriction-sites'],
    ['view:track-orfs', 'ORFs', 'view-track-orfs', 'orfs'],
    ['view:track-translation', 'Translation', 'view-track-translation', 'translation'],
    ['view:track-gc-graph', 'GC Graph', 'view-track-gc-graph', 'gc-graph'],
    ['view:track-hydropathy-graph', 'Hydropathy Graph', 'view-track-hydropathy-graph', 'hydropathy-graph'],
  ];
  const dispatcher = parseDispatcher();
  const itemToggle = (id: string) => {
    const at = appTsx.indexOf(`id: '${id}',`);
    expect(at, `the in-app item ${id}`).toBeGreaterThan(0);
    return /onToggle: \(\) => (.+),\n/.exec(appTsx.slice(at, appTsx.indexOf('},', at)))?.[1] ?? '';
  };

  it('US-01M7DV8W AC1 lists the seven plain items in a Tracks submenu, placed after Map Layout', () => {
    const sub = entries(['View', 'Tracks']);
    expect(itemsOf(['View', 'Tracks'])).toEqual(TRACKS.map(([id, label]) => [id, label]));
    // Plain items only, no key (the US-01M7DVR0 AC1 pin): only the in-app items show the state.
    expect(sub.every((e) => e.includes('|'))).toBe(true);
    expect(nativeItemList.filter((i) => i.path.join('>') === 'View>Tracks').every((i) => !nativeAccel(i.id))).toBe(true);
    expect(nativeMenuRs).not.toMatch(/CheckMenuItem/);
    const view = entries(['View']);
    expect(view.slice(view.indexOf('sub:Map Layout'), view.indexOf('sub:Map Layout') + 2)).toEqual(['sub:Map Layout', 'sub:Tracks']);
    for (const [id] of TRACKS) expect(listedTimes(id), `${id} listed once`).toBe(1);
  });

  it("US-01M7DV8W AC1 each dispatcher case calls the in-app item's toggle under requireActiveSession, and its native state is the track's rule", () => {
    for (const [native, , inApp, track] of TRACKS) {
      const call = `requireActiveSession(() => toggleTrack('${track}'))`;
      expect(itemToggle(inApp), inApp).toBe(call);
      expect(runs(native), `${native} runs the in-app item`).toBe(inApp);
      expect(dispatcher.get(native), `${native} is gated on a session`).toBe(true);
      expect(NATIVE_MENU_COMMAND_RULES[native], `${native} follows the track's rule`).toBe(`track-${track}`);
    }
    // The state the backend applies: off without a session; on a protein, as the one rule says.
    const base = { selection: null, undoDepth: 0, redoDepth: 0 };
    const protein = buildCommandDocumentContext({ id: 'p', moleculeType: 'Protein', topology: 'linear', sequence: 'MKT', features: [] });
    const circ = buildCommandDocumentContext({ id: 'c', moleculeType: 'DNA', topology: 'circular', sequence: 'ACGT', features: [] });
    const on = (ctx: Parameters<typeof buildNativeMenuState>[0]) => TRACKS.map(([id]) => resolveNativeMenuItemEnabled(id, buildNativeMenuState(ctx)));
    expect(on({ ...base, sessionActive: false, activeDoc: null })).toEqual([false, false, false, false, false, false, false]);
    expect(on({ ...base, sessionActive: true, activeDoc: circ, mapLayout: 'split' })).toEqual([true, true, true, true, true, true, true]);
    expect(on({ ...base, sessionActive: true, activeDoc: protein, mapLayout: 'linear' })).toEqual([true, false, false, false, false, false, true]);
    for (const [native, , , track] of TRACKS) {
      expect(commandAvailability(`track-${track}` as never, { ...base, sessionActive: true, activeDoc: protein, mapLayout: 'linear' }).enabled).toBe(resolveNativeMenuItemEnabled(native, buildNativeMenuState({ ...base, sessionActive: true, activeDoc: protein, mapLayout: 'linear' })));
    }
  });
});

describe('US-01M7NNGQ: View › Map Gallery and View › Compare Table natively', () => {
  const dispatcher = parseDispatcher();
  const GALLERY: ReadonlyArray<readonly [string, string, string, string]> = [
    // native id, label, in-app id, the gallery view it opens on
    ['view:map-gallery', 'Map Gallery', 'view-map-gallery', 'maps'],
    ['view:compare-table', 'Compare Table', 'view-compare-table', 'compare-table'],
  ];
  const itemSelect = (id: string) => {
    const at = appTsx.indexOf(`id: '${id}',`);
    expect(at, `the in-app item ${id}`).toBeGreaterThan(0);
    return /onSelect: \(\) => (.+),\n/.exec(appTsx.slice(at, appTsx.indexOf('},', at)))?.[1] ?? '';
  };

  it('US-01M7NNGQ AC1 lists Map Gallery then Compare Table in the View menu right after Document Split and before Table Columns', () => {
    expect(spec.menus.map((m) => m.label)).toContain('View');
    // The View menu's entries, in order, as the native spec lists them (US-01M6Q159).
    const view = entries(['View']);
    const at = view.indexOf('sub:Document Split');
    expect(at, 'Document Split is in the View menu').toBeGreaterThan(0);
    expect(view.slice(at, at + 4)).toEqual([
      'sub:Document Split',
      'view:map-gallery|Map Gallery',
      'view:compare-table|Compare Table',
      'sub:Table Columns',
    ]);
    for (const [id] of GALLERY) {
      expect(nativeAccel(id), `${id} has no key`).toBeUndefined();
      expect(listedTimes(id), `${id} listed once`).toBe(1);
      expect(nativeIds.has(id), id).toBe(true);
    }
  });

  it("US-01M7NNGQ AC2 each dispatcher case is the in-app item's onSelect, gated on a session", () => {
    for (const [native, , inApp, view] of GALLERY) {
      const call = `requireActiveSession(() => openMapGallery('${view}'))`;
      expect(itemSelect(inApp), inApp).toBe(call);
      expect(runs(native), `${native} runs the in-app item`).toBe(inApp);
      expect(dispatcher.get(native), `${native} is gated on a session`).toBe(true);
    }
  });

  it('US-01M7NNGQ AC3 both ids follow the multi-record-view rule: off without a session, off with one checked row, on with two', () => {
    const base = { activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
    const contexts: Array<[string, Parameters<typeof buildNativeMenuState>[0], boolean]> = [
      ['no session', { ...base, sessionActive: false, checkedRecordCount: 2 }, false],
      ['one checked row', { ...base, sessionActive: true, checkedRecordCount: 1 }, false],
      ['two checked rows', { ...base, sessionActive: true, checkedRecordCount: 2 }, true],
      ['three checked rows', { ...base, sessionActive: true, checkedRecordCount: 3 }, true],
    ];
    for (const [native] of GALLERY) {
      expect(NATIVE_MENU_COMMAND_RULES[native], native).toBe('multi-record-view');
      for (const [what, ctx, enabled] of contexts) {
        expect(resolveNativeMenuItemEnabled(native, buildNativeMenuState(ctx)), `${native}, ${what}`).toBe(enabled);
        // The native state is the in-app items' rule, case for case.
        expect(commandAvailability('multi-record-view', ctx).enabled, `the rule, ${what}`).toBe(enabled);
      }
    }
  });
});
