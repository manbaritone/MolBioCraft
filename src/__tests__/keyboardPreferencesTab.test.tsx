// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Preferences Keyboard tab lists the shortcuts that work (US-01M6P2G2), read in the running App
 * with Preferences opened by its own command and the Keyboard tab chosen:
 *
 * - AC2: the rows are the menus' own paths and labels, in the host's format (⌘S on macOS, Ctrl+S on
 *   Linux), not the old hand-kept table's "Map View" and "Save GenBank".
 * - AC3: a combination an explicit key handler consumes before the menu dispatcher sees it (App.tsx's
 *   primaryShortcutHandlerRef and workspaceShortcutHandlerRef) is listed under the menu item whose
 *   command the handler runs. Each is checked by driving both, in two fresh launches from the same
 *   start: the key press in one, the listed item through the menu bar in the other, and the App's
 *   resulting state compared.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatPlatformShortcut } from '../platform/osPlatform';
import { macHost, mountApp, type AppHarness, type MountOptions, type PressModifiers } from './appHarness';
import type { LiveElement } from './liveDom';

// A macOS host's Tauri runtime (AC2's mac host); the other mounts are Linux hosts.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

vi.setConfig({ testTimeout: 120_000 });

async function withApp<T>(opts: MountOptions, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

const words = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Opens Preferences by its own command, chooses the Keyboard tab and reads its rows as [path, label]. */
async function keyboardTabRows(app: AppHarness): Promise<[string, string][]> {
  await app.menu('app:preferences');
  await app.click(app.one('#prefs-tab-keyboard', 'Preferences Keyboard tab'));
  return app.all('tr.mbc-menu-shortcut-row').map((r) => {
    const cells = r.querySelectorAll('td');
    return [words(cells[0].textContent), words(cells[1].textContent)];
  });
}

async function closePreferences(app: AppHarness) {
  const done = app.all('.prefs-modal-footer button').filter((b) => words(b.textContent) === 'Done');
  expect(done, 'one Done button on Preferences').toHaveLength(1);
  await app.click(done[0]);
  expect(app.all('#prefs-tab-keyboard'), 'Preferences closed').toHaveLength(0);
}

describe('US-01M6P2G2 AC2: the Keyboard tab lists the menus\' own shortcuts', () => {
  const expected = (os: 'macos' | 'linux') => [
    ['File > Export Sequences > Export GenBank', formatPlatformShortcut('S', os)],
    ['File > Export Sequences > Export FASTA', formatPlatformShortcut('S', os, { shift: true })],
    ['File > Save Session > Save Session', formatPlatformShortcut('S', os, { alt: true })],
    ['View > Map Layout > Split Map & Sequence', formatPlatformShortcut('1', os)],
  ];

  it('US-01M6P2G2 AC2 on a macOS host the rows read ⌘S, ⇧⌘S, ⌥⌘S and ⌘1, and no row reads Map View or Save GenBank', async () => {
    await withApp(macHost(), async (app) => {
      const rows = await keyboardTabRows(app);
      const want = expected('macos');
      expect(want.map((w) => w[1])).toEqual(['⌘S', '⇧⌘S', '⌥⌘S', '⌘1']);
      for (const [path, label] of want) expect(rows.filter((r) => r[0] === path), path).toEqual([[path, label]]);
      expect(rows.filter((r) => /Map View|Save GenBank/.test(r[0]))).toEqual([]);
      // The read-only field beside the table shows the selected row's shortcut; a click selects a row.
      const split = app.all('tr.mbc-menu-shortcut-row').find((r) => words(r.querySelectorAll('td')[0].textContent) === want[3][0])!;
      await app.click(split);
      const field = app.all('[aria-labelledby="prefs-tab-keyboard"] input[readonly]');
      expect(field.map((f) => (f as unknown as { value: string }).value)).toEqual(['⌘1']);
    });
  });

  it('US-01M6P2G2 AC2 on the default Linux host the same rows read Ctrl+S, Ctrl+Shift+S, Ctrl+Alt+S and Ctrl+1', async () => {
    await withApp({}, async (app) => {
      const rows = await keyboardTabRows(app);
      const want = expected('linux');
      expect(want.map((w) => w[1])).toEqual(['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+Alt+S', 'Ctrl+1']);
      for (const [path, label] of want) expect(rows.filter((r) => r[0] === path), path).toEqual([[path, label]]);
      expect(rows.filter((r) => /Map View|Save GenBank/.test(r[0]))).toEqual([]);
    });
  });
});

// ─── AC3: explicit handlers and the rows they shadow ───

interface Combo {
  key: string;
  mods: { shift?: boolean; alt?: boolean };
  /** Puts the App in a state where the command does something (beyond an active session). */
  prep?: (app: AppHarness) => Promise<void>;
}
const reverseComplement = (app: AppHarness) => app.press('R', { mod: true, shift: true });
const undo = (app: AppHarness) => app.press('z', { mod: true });

/** Every combination App.tsx's primaryShortcutHandlerRef and workspaceShortcutHandlerRef consume. */
const EXPLICIT_HANDLER_COMBOS: Combo[] = [
  // primaryShortcutHandlerRef
  { key: 'z', mods: {}, prep: reverseComplement },
  { key: 'z', mods: { shift: true }, prep: async (app) => { await reverseComplement(app); await undo(app); } },
  { key: 'y', mods: {}, prep: async (app) => { await reverseComplement(app); await undo(app); } },
  { key: 'n', mods: {} },
  { key: 'n', mods: { alt: true } },
  { key: 'n', mods: { shift: true } },
  { key: 'w', mods: { shift: true } },
  { key: 'p', mods: { shift: true } },
  { key: ',', mods: {} },
  { key: 'y', mods: { shift: true } },
  // workspaceShortcutHandlerRef
  { key: 'o', mods: {} },
  { key: 'i', mods: {} },
  { key: 'i', mods: { shift: true } },
  { key: 'i', mods: { alt: true } },
  { key: 'o', mods: { shift: true } },
  { key: 's', mods: { alt: true } },
  { key: 's', mods: { alt: true, shift: true } },
  { key: 'f', mods: { alt: true } },
  { key: 'f', mods: { shift: true } },
  { key: 'a', mods: { alt: true } },
  { key: 't', mods: { alt: true } },
  { key: 'q', mods: {} },
];

/**
 * The one known exception: ⌥⌘T's handler opens the Phylogenetics studio, while its row (Tools >
 * Phylogenetics > Maximum Likelihood) opens the Build Tree dialog. US-01M6P2HD deletes that handler
 * branch; it then deletes this entry, and the check below fails until it does.
 */
const KNOWN_HANDLER_MISMATCH = 'Ctrl+Alt+T';

/** Ctrl+Y is the primary handler's second Redo key; no menu item shows it, so its row is Redo's (Ctrl+Shift+Z). */
const ROW_OF: Record<string, string> = { 'Ctrl+Y': 'Ctrl+Shift+Z' };

const labelOf = (c: Combo) => formatPlatformShortcut(c.key.toUpperCase(), 'linux', c.mods);

/** What a command can change: dialogs, the tab, the status, focused fields, pickers, the viewer, the layout, files saved. */
function appState(app: AppHarness, calls: string[]) {
  const focused = app.doc.activeElement as LiveElement | null;
  const field = focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName) ? `${focused.tagName}#${focused.getAttribute('id') ?? ''}` : null;
  // Without a session there is no viewer header, inspector or tab: null, not a throw.
  const orNull = <T,>(read: () => T): T | null => { try { return read(); } catch { return null; } };
  return {
    dialogs: app.all('[role="dialog"], [role="alertdialog"], dialog, .mbc-modal-backdrop').map((d) =>
      `${d.localName}:${d.getAttribute('aria-label') ?? words(d.querySelectorAll('h1, h2, h3')[0]?.textContent ?? '')}`),
    prefsTab: app.all('button[role="tab"][aria-selected="true"][id^="prefs-tab-"]').map((t) => t.getAttribute('id')),
    tab: orNull(() => app.activeTab()),
    status: app.all('.statusbar-toast-text').map((t) => words(t.textContent)),
    field,
    calls: [...calls],
    inspector: orNull(() => app.inspectorAside() !== null),
    // What the viewer shows: a studio opened in another mode (pairwise, not multiple alignment) reads differently.
    // (A timing the view reports, "7.74 ms async" or "in 4.19ms", is wall-clock time and is left out.)
    view: orNull(() => words(app.canvas().textContent).replace(/\d+(?:\.\d+)? ?ms\b/g, '# ms')),
    layout: app.all('.mbc-doc-table-pane, .mbc-viewer-body-split, #mbc-folder-filter-input').map((el) => `${el.localName}.${el.getAttribute('class') ?? ''}`),
    downloads: app.downloads().map((d) => d.filename),
  };
}

/** Lets the App's short timers (a focus moved after 30 ms) run, then settles. */
async function runTimers(app: AppHarness) {
  await React.act(async () => { vi.advanceTimersByTime(200); });
  await app.settle();
}

/**
 * One launch: an active session, the combination's prep, the Keyboard tab read and closed; then `act`.
 * Returns the row listed for `rowLabel` and the App's state before and after `act`.
 */
async function launch(combo: Combo, rowLabel: string, act: (app: AppHarness, row: [string, string] | undefined) => Promise<void>) {
  return withApp({}, async (app) => {
    await app.menu('new-session:sample-library');
    await combo.prep?.(app);
    const rows = (await keyboardTabRows(app)).filter((r) => r[1] === rowLabel);
    await closePreferences(app);
    // A file picker opened (its input clicked) and a window close the App asks for leave no other trace.
    const calls: string[] = [];
    app.doc.addEventListener('click', (ev: { target: LiveElement }) => {
      const t = ev.target;
      if (t?.localName === 'input' && t.getAttribute('type') === 'file') calls.push(`picker ${t.getAttribute('accept') ?? ''}`);
    }, true);
    (app.win as unknown as { close: () => void }).close = () => { calls.push('window.close'); };
    await runTimers(app);
    const before = appState(app, calls);
    await act(app, rows[0]);
    await runTimers(app);
    return { rows, before, after: appState(app, calls) };
  });
}

const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
const rowLabelOf = (b: LiveElement) => words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent);

/** Runs the menu item at `path` ('File > Save Session > Save Session') by clicking through the menu bar. */
async function runMenuPath(app: AppHarness, path: string) {
  const [top, ...rest] = path.split(' > ');
  const name = top === 'MolBioCraft' ? 'Application Menu' : top;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === name);
  if (!trigger) throw new Error(`the menu bar has no ${name} menu`);
  await app.click(trigger);
  for (const [depth, label] of rest.entries()) {
    // Each level is looked up in its own popup: a submenu and its item can share a label (Open Session).
    const popup = app.all('.desktop-menu-popup')[depth];
    const item = popup?.querySelectorAll('button').find((b) => rowLabelOf(b) === label);
    if (!item) throw new Error(`no "${label}" in the open menu for ${path}: ${menuButtons(app).map(rowLabelOf).join(' | ')}`);
    expect(item.hasAttribute('disabled'), `${path} is enabled`).toBe(false);
    await app.click(item);
  }
  for (let i = 0; i < 4 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}

describe('US-01M6P2G2 AC3: a combination an explicit handler consumes is listed under the item it runs', () => {
  it('US-01M6P2G2 AC3 the combinations are the two handlers\' own, and only Ctrl+Alt+T is the known exception', () => {
    const labels = EXPLICIT_HANDLER_COMBOS.map(labelOf);
    expect(new Set(labels).size, 'each combination once').toBe(labels.length);
    expect(labels).toContain(KNOWN_HANDLER_MISMATCH);
  });

  for (const combo of EXPLICIT_HANDLER_COMBOS) {
    const label = labelOf(combo);
    const rowLabel = ROW_OF[label] ?? label;
    const exception = label === KNOWN_HANDLER_MISMATCH;
    it(`US-01M6P2G2 AC3 ${label}: the key press and the listed item (${rowLabel}) ${exception ? 'differ until US-01M6P2HD lands' : 'leave the same state'}`, async () => {
      const mods: PressModifiers = { mod: true, ...combo.mods };
      const pressed = await launch(combo, rowLabel, (app) => app.press(combo.key, mods));
      expect(pressed.rows, `one Keyboard row for ${rowLabel}`).toHaveLength(1);
      expect(pressed.after, `${label} changes the App`).not.toEqual(pressed.before);
      const path = pressed.rows[0][0];
      const chosen = await launch(combo, rowLabel, (app) => runMenuPath(app, path));
      expect(chosen.rows).toEqual(pressed.rows);
      expect(chosen.before, 'both launches start from the same state').toEqual(pressed.before);
      if (exception) {
        expect(chosen.after, `${label} runs something other than ${path} (US-01M6P2HD removes this exception)`).not.toEqual(pressed.after);
      } else {
        expect(chosen.after, `${label} runs ${path}`).toEqual(pressed.after);
      }
    });
  }
});
