// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The split view pane's document picker and swap, driven through the mounted App (US-01M7DV3V):
 *
 * - AC1: choosing another document in the pane's picker leaves the pane with no selection; a range
 *   selected on one document is never drawn on another, where its coordinates mean something else.
 *   The main view's selection is not touched.
 * - AC2: "Swap with the main view" exchanges the two selections along with the two documents, and an
 *   absent selection travels as absent.
 * - AC3: the picker lists the first 400 candidates and says so by the shared subsetNote rule; a
 *   filter narrows the candidates before the cap, so a document past the 400th can be reached.
 *
 * The document split, also through the mounted App (US-01M7DVR0):
 *
 * - AC1: the header's "Document split" chooser beside the split toggle, View › Document Split's three
 *   checkbox items, and the native view:document-split-* ids, each read through the layout it gives.
 * - AC2: Side by Side and Top and Bottom give the split host their classes (and App.css styles the
 *   stack); Single Pane, the toggle and 'Close split view' keep the pane's document for the next split.
 * - AC3: the split is autosaved and restored with the session, and each restore case is told apart.
 * - AC4: the document-table items keep their behaviour under their new labels, and no document-split
 *   change moves the circular / linear divider.
 *
 * The divider between the two documents, also through the mounted App (US-01M7DVB1), with the split
 * host laid out at a box the test gives:
 *
 * - AC1: a drag sets the ratio along the active axis, clamped to each pane's minimum; a narrower host
 *   clamps only the drawn ratio; the chosen ratio is autosaved and restored, and each restore case of
 *   a saved size is told apart. What is drawn is read from the flex App.css gives each pane and the
 *   shares the App writes on the host (expectDrawn), and the host is measured only while split.
 * - AC2: the separator's attributes, and the keys of each axis (a key of the other axis does nothing).
 * - AC3: a folded pane leaves its restore button, restore returns the last expanded ratio, and neither
 *   folding nor restoring changes a document or a selection.
 * - AC4: Swap leaves the divider, folded or not, where it was.
 *
 * Every document is built here. The three the selection checks use are each 7,200 bp or more, so a
 * carried 5,000-6,000 would be drawable on any of them; the picker's fillers are 40 bp.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { parseMbcWorkbench } from '../core/mbcSessionFormat';
import { paneSplitValueNow, renderedPaneSplitRatio } from '../core/paneSplit';
import { resolveMenuNodeFunctionDescription } from '../data/menuFunctionDescriptions';
import { appTsxSource, mountApp, type AppHarness } from './appHarness';
import { appCssRules, cascaded, gridTracks } from './cssCascade';
import { dispatchLiveEvent, memoryStorage, type LiveElement, type LiveStorage } from './liveDom';
import { macHost } from './appHarness';
import { resolveNativeMenuItemEnabled } from '../core/commandAvailability';

// A macOS host's Tauri runtime, for the native menu state (US-01M7DV10 AC2); every other mount is a
// Linux host, which the mock reports as no Tauri runtime, as the real module does under test.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 120_000 });

async function withApp<T>(run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp({});
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

/** A deterministic, non-repeating-looking DNA sequence of `length` bases. */
function dna(length: number, seed: number): string {
  const bases = 'ACGT';
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += bases[(x >>> 16) & 3];
  }
  return out;
}

/** A sequence document with one misc_feature, "Mark", at 5,000..6,000 (its schematic arc selects it). */
const seqDoc = (id: string, name: string, length: number, seed: number): SequenceDocument => ({
  id, name, accession: '', description: `${name}, built in the test`, sequence: dna(length, seed),
  moleculeType: 'DNA', topology: 'linear', folder: 'Sequences',
  createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [{ id: `${id}-mark`, name: 'Mark', type: 'misc_feature', start: 5000, end: 6000, strand: 1, color: '#3b82f6', qualifiers: {} }],
  primers: [], history: [],
} as SequenceDocument);

const MAIN = seqDoc('sdp-main', 'Main_Doc', 7_400, 7);
const DOC_A = seqDoc('sdp-a', 'Doc_A', 7_200, 11);
const DOC_B = seqDoc('sdp-b', 'Doc_B', 7_500, 13);

/** A small sequence document for the picker's list. */
const smallDoc = (i: number, name = `Listed ${String(i).padStart(3, '0')}`): SequenceDocument =>
  ({ ...seqDoc(`sdp-n${i}`, name, 40, i + 100), features: [] });

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const pane = (app: AppHarness) => app.one('section.mbc-split-pane', 'the split view pane');
function labelled(scope: LiveElement, selector: string, name: string): LiveElement {
  const found = scope.querySelectorAll(selector).filter((c) => c.getAttribute('aria-label') === name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
}
const picker = (app: AppHarness) => labelled(pane(app), 'select', 'Document in split view');
const filterBox = (app: AppHarness) => labelled(pane(app), 'input', 'Filter documents in split view');
/** The picker's document options (not its "Choose a document…" prompt), as [value, text]. */
const pickerOptions = (app: AppHarness) =>
  picker(app).querySelectorAll('option').filter((o) => o.getAttribute('value') !== '').map((o) => [o.getAttribute('value'), words(o.textContent)]);
const REGION = '[aria-label="Selected Sequence Region Actions"]';
const HINT = 'Click a base, or drag across bases, to select them.';

/** What a selection quickbar reads: its range ("5,000..6,000"), or null when it draws no selection. */
const rangeOf = (regions: LiveElement[]): string | null => {
  expect(regions.length, 'at most one selection region').toBeLessThanOrEqual(1);
  if (!regions.length) return null;
  const m = /([\d,]+)\.\.([\d,]+)/.exec(words(regions[0].querySelectorAll('.seq-selection-quickbar-summary strong')[0]?.textContent ?? ''));
  return m ? `${m[1]}..${m[2]}` : 'unreadable';
};
const paneSelection = (app: AppHarness) => rangeOf(pane(app).querySelectorAll(REGION));
/** The main view's selection: the selection regions outside the split pane, when it is open. */
const mainSelection = (app: AppHarness) =>
  rangeOf(app.all(REGION).filter((r) => !app.all('section.mbc-split-pane').some((p) => p.contains(r))));
const paneHint = (app: AppHarness) =>
  pane(app).querySelectorAll('.seq-selection-quickbar-hint').some((h) => words(h.textContent) === HINT);
const mainDocName = (app: AppHarness) => {
  const tabs = app.all('button.mbc-doc-tab-trigger[aria-selected="true"]');
  expect(tabs, 'one document tab is the main view').toHaveLength(1);
  return words(tabs[0].querySelectorAll('.mbc-doc-tab-title')[0]?.textContent ?? '');
};
const paneDocId = (app: AppHarness) => picker(app).value;
/** The picker's coverage note, or null. */
const pickerNote = (app: AppHarness) => {
  const notes = pane(app).querySelectorAll('[aria-label="Split view picker"]');
  return notes.length ? words(notes[0].textContent) : null;
};

/** Opens the split view and shows `docId` in the pane through its picker. */
async function showInPane(app: AppHarness, docId: string) {
  await app.click(app.one('button.mbc-split-toggle'));
  if (paneDocId(app) !== docId) await app.change(picker(app), docId);
  expect(paneDocId(app), 'the pane shows the document asked for').toBe(docId);
}
/** Selects 5,000..6,000 in the pane: a click on its "Mark" feature arc. */
async function selectMarkInPane(app: AppHarness) {
  const arcs = pane(app).querySelectorAll('g.clickable-arc');
  expect(arcs, "the pane's one feature arc").toHaveLength(1);
  await app.click(arcs[0]);
  expect(paneSelection(app), 'the pane reads the selection').toBe('5,000..6,000');
}

const restore = (app: AppHarness, docs: SequenceDocument[], activeDocId: string, selectedRange: { start: number; end: number } | null) =>
  app.restoreSession({
    documents: docs, activeDocId, viewerTab: 'sequence-view',
    workspace: { mapLayoutMode: 'linear', selectedRange: selectedRange ? { ...selectedRange, label: 'Selection' } : null },
  });

// ─── AC1 ───

describe('choosing a document in the split pane', () => {
  it('US-01M7DV3V AC1: leaves the pane with no selection, and the main selection as it was', async () => {
    await withApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, { start: 100, end: 200 });
      expect(mainSelection(app), 'the main view starts selected at 100..200').toBe('100..200');
      await showInPane(app, DOC_A.id);
      await selectMarkInPane(app);

      await app.change(picker(app), DOC_B.id);

      expect(paneDocId(app), 'the pane shows Doc_B').toBe(DOC_B.id);
      expect(pane(app).querySelectorAll(REGION), 'no selection region in the pane').toHaveLength(0);
      expect(paneHint(app), 'the pane shows the selection hint').toBe(true);
      expect(mainDocName(app), 'the main view still shows Main_Doc').toBe('Main_Doc');
      expect(mainSelection(app), "the main view's selection is unchanged").toBe('100..200');
    });
  });
});

// ─── AC2 ───

describe('swapping the split pane with the main view', () => {
  it('US-01M7DV3V AC2: exchanges the two selections with the two documents', async () => {
    await withApp(async (app) => {
      await restore(app, [DOC_A, DOC_B], DOC_A.id, { start: 100, end: 200 });
      await showInPane(app, DOC_B.id);
      await selectMarkInPane(app);
      expect(mainSelection(app), 'Doc_A is selected at 100..200 in the main view').toBe('100..200');

      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));

      expect(mainDocName(app), 'Doc_B is in the main view').toBe('Doc_B');
      expect(mainSelection(app), 'with its 5,000..6,000').toBe('5,000..6,000');
      expect(paneDocId(app), 'Doc_A is in the pane').toBe(DOC_A.id);
      expect(paneSelection(app), 'with its 100..200').toBe('100..200');
    });
  });

  it('US-01M7DV3V AC2: carries an absent main selection as absent', async () => {
    await withApp(async (app) => {
      await restore(app, [DOC_A, DOC_B], DOC_A.id, null);
      await showInPane(app, DOC_B.id);
      await selectMarkInPane(app);
      expect(mainSelection(app), 'nothing is selected in the main view').toBeNull();

      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));

      expect(mainDocName(app), 'Doc_B is in the main view').toBe('Doc_B');
      expect(mainSelection(app), 'with its 5,000..6,000').toBe('5,000..6,000');
      expect(paneDocId(app), 'Doc_A is in the pane').toBe(DOC_A.id);
      expect(paneSelection(app), "Doc_A has no selection, not the pane's old one").toBeNull();
      expect(paneHint(app), 'the pane shows the selection hint').toBe(true);
    });
  });

  it('US-01M7DV3V AC2: carries an absent pane selection into the main view as absent', async () => {
    await withApp(async (app) => {
      await restore(app, [DOC_A, DOC_B], DOC_A.id, { start: 100, end: 200 });
      await showInPane(app, DOC_B.id);
      expect(paneSelection(app), 'nothing is selected in the pane').toBeNull();

      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));

      expect(mainDocName(app), 'Doc_B is in the main view').toBe('Doc_B');
      expect(mainSelection(app), "Doc_B has no selection, not Doc_A's old one").toBeNull();
      expect(paneDocId(app), 'Doc_A is in the pane').toBe(DOC_A.id);
      expect(paneSelection(app), 'with its 100..200').toBe('100..200');
    });
  });
});

// ─── AC3 ───

// The App's catalog holds the sample library beside the session's documents, so the picker's
// candidates are every document of both but the main one.
const listedDocs = (count: number) => Array.from({ length: count }, (_, i) => smallDoc(i + 1));
/** The session documents (MAIN first, the main view) that give the picker exactly `n` candidates. */
const sessionWithCandidates = (n: number) => [MAIN, ...listedDocs(n - SAMPLE_LIBRARY.length)];

describe("the split pane's picker", () => {
  it('US-01M7DV3V AC3: lists the first 400 of 401 candidates and says so', async () => {
    await withApp(async (app) => {
      await restore(app, sessionWithCandidates(401), MAIN.id, null);
      await app.click(app.one('button.mbc-split-toggle'));
      expect(pickerOptions(app), 'the picker lists 400 documents').toHaveLength(400);
      expect(pickerNote(app)).toBe('The picker lists the first 400 of 401 documents.');
    });
  });

  it('US-01M7DV3V AC3: shows no note with exactly 400 candidates', async () => {
    await withApp(async (app) => {
      await restore(app, sessionWithCandidates(400), MAIN.id, null);
      await app.click(app.one('button.mbc-split-toggle'));
      expect(pickerOptions(app), 'all 400 listed').toHaveLength(400);
      expect(pickerNote(app), 'no note at exactly 400').toBeNull();
      expect(words(pane(app).textContent)).not.toContain('The picker lists');
    });
  });

  it('US-01M7DV3V AC3: a filter narrows the candidates before the cap, ignoring case, and reaches one past the 400th', async () => {
    // 400 documents ahead of it, so the one named Zebrafish is past the cap whatever follows.
    const beyond = smallDoc(401, 'Zebrafish_Beyond');
    const docs = [MAIN, ...listedDocs(400), beyond];
    const candidates = docs.length - 1 + SAMPLE_LIBRARY.length;
    await withApp(async (app) => {
      await restore(app, docs, MAIN.id, null);
      await app.click(app.one('button.mbc-split-toggle'));
      expect(pickerOptions(app), 'the picker lists 400 documents').toHaveLength(400);
      expect(pickerOptions(app).some(([id]) => id === beyond.id), 'Zebrafish_Beyond is left out of the list').toBe(false);
      expect(pickerNote(app)).toBe(`The picker lists the first 400 of ${candidates.toLocaleString('en-US')} documents.`);

      await app.input(filterBox(app), 'zEbRaFiSh');
      expect(pickerOptions(app).filter(([id]) => id !== paneDocId(app)), 'only the matching document').toEqual([[beyond.id, 'Zebrafish_Beyond']]);
      expect(pickerNote(app), 'one match, all listed: no note').toBeNull();
      await app.change(picker(app), beyond.id);
      expect(paneDocId(app), 'the pane shows Zebrafish_Beyond').toBe(beyond.id);
      expect(pane(app).querySelectorAll('[data-pos]').length, 'its bases are drawn in the pane').toBeGreaterThan(0);

      // A filter that matches nothing says so, and lists nothing.
      await app.input(filterBox(app), 'no-such-name');
      expect(words(pane(app).textContent)).toContain('No document matches "no-such-name".');
      expect(pickerOptions(app).filter(([id]) => id !== paneDocId(app)), 'no candidate listed').toEqual([]);
    });
  });
});

// ─── US-01M7DVR0: the document split ───

const CHOICES = [['single', 'Single Pane'], ['side-by-side', 'Side by Side'], ['top-bottom', 'Top and Bottom']] as const;
type Orientation = (typeof CHOICES)[number][0];
const NATIVE: Record<Orientation, string> = {
  single: 'view:document-split-single',
  'side-by-side': 'view:document-split-side-by-side',
  'top-bottom': 'view:document-split-top-bottom',
};
const AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';
const UNREADABLE = 'The saved document split could not be read; the viewer opens in Single Pane.';
const missing = (name: string) => `The split pane's document "${name}" is no longer in this session; the viewer opens in Single Pane.`;

const chooser = (app: AppHarness) => labelled(app.header(), 'select', 'Document split');
const toggle = (app: AppHarness) => app.one('button.mbc-split-toggle', 'the split toggle');
const host = (app: AppHarness) => app.one('.mbc-split-host', 'the split host');
const hostClasses = (app: AppHarness) => [...host(app).classList].sort().join(' ');
const paneCount = (app: AppHarness) => app.all('section.mbc-split-pane').length;
/** The layout the App shows: the host's classes, and the pane's document (null with no pane). */
const layout = (app: AppHarness) => ({ host: hostClasses(app), pane: paneCount(app) ? paneDocId(app) : null });
const SINGLE = 'mbc-split-host';
const SIDE = 'is-side-by-side is-split mbc-split-host';
const STACK = 'is-split is-top-bottom mbc-split-host';
const statusSegments = (app: AppHarness) =>
  words(app.all('.statusbar-toast-text').map((t) => t.textContent).join(' ')).split(' · ');

const menuWords = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
/** Opens View, then each submenu on `path`, and returns the last item. */
async function openView(app: AppHarness, path: string[]): Promise<LiveElement> {
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => menuWords(b.getAttribute('aria-label') ?? b.textContent) === 'View');
  if (!trigger) throw new Error('the menu bar has no View menu');
  await app.click(trigger);
  let item: LiveElement | undefined;
  for (const label of path) {
    item = menuButtons(app).find((b) => menuWords(b.textContent) === label);
    if (!item) throw new Error(`no "${label}" in the open menu: ${menuButtons(app).map((b) => menuWords(b.textContent)).join(' | ')}`);
    if (label !== path[path.length - 1]) await app.click(item);
  }
  return item!;
}
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 4 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
/** The View › Document Split items, as [label, checked]. */
async function docSplitItems(app: AppHarness): Promise<[string, boolean][]> {
  await openView(app, ['Document Split', 'Single Pane']);
  const sub = app.all('.desktop-menu-popup').filter((p) => p.querySelectorAll('button').some((b) => menuWords(b.textContent) === 'Top and Bottom'));
  expect(sub, 'one Document Split submenu').toHaveLength(1);
  const rows = sub[0].querySelectorAll('button[role="menuitemcheckbox"]').map((b) => [menuWords(b.textContent), b.getAttribute('aria-checked') === 'true'] as [string, boolean]);
  await closeMenus(app);
  return rows;
}
const checkedOnly = (label: string): [string, boolean][] => CHOICES.map(([, l]) => [l, l === label]);
async function viewDocSplit(app: AppHarness, label: string) {
  const item = await openView(app, ['Document Split', label]);
  expect(item.hasAttribute('disabled'), `View › Document Split › ${label} is enabled`).toBe(false);
  await app.click(item);
  await closeMenus(app);
}

async function autosaveRunsOut(app: AppHarness) {
  await React.act(async () => { vi.advanceTimersByTime(600); });
  await app.settle();
}
/** The documentSplit the App's autosave holds, read back through parseMbcWorkbench (the WASM codec). */
const autosavedSplit = (storage: LiveStorage) => {
  const raw = storage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return parseMbcWorkbench(raw!, 'Reopened').envelope.workspace.documentSplit;
};

describe('US-01M7DVR0 AC1: the document split chooser, the View items and the native ids', () => {
  it('US-01M7DVR0 AC1 the header chooser sits beside the split toggle and, with View › Document Split, shows the current layout; each native id sets it', async () => {
    await withApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      const select = chooser(app);
      const siblings = toggle(app).parentElement!.children;
      expect(siblings.indexOf(select), 'the chooser follows the split toggle').toBe(siblings.indexOf(toggle(app)) + 1);
      expect(select.querySelectorAll('option').map((o) => [o.getAttribute('value'), words(o.textContent)])).toEqual(CHOICES.map(([v, l]) => [v, l]));
      expect(chooser(app).value, 'Single Pane to begin').toBe('single');
      expect(await docSplitItems(app)).toEqual(checkedOnly('Single Pane'));
      expect(layout(app)).toEqual({ host: SINGLE, pane: null });

      await app.change(chooser(app), 'top-bottom');
      expect(layout(app), 'the chooser stacks the panes').toEqual({ host: STACK, pane: DOC_A.id });
      expect(chooser(app).value).toBe('top-bottom');
      expect(await docSplitItems(app)).toEqual(checkedOnly('Top and Bottom'));

      // Each in-app item, then each native id, sets the layout and the chooser and the check follow.
      const expected: Record<Orientation, ReturnType<typeof layout>> = {
        single: { host: SINGLE, pane: null }, 'side-by-side': { host: SIDE, pane: DOC_A.id }, 'top-bottom': { host: STACK, pane: DOC_A.id },
      };
      for (const [orientation, label] of [CHOICES[1], CHOICES[0], CHOICES[2]]) {
        await viewDocSplit(app, label);
        expect(layout(app), `View › Document Split › ${label}`).toEqual(expected[orientation]);
        expect(chooser(app).value).toBe(orientation);
      }
      for (const [orientation, label] of [CHOICES[0], CHOICES[1], CHOICES[2], CHOICES[0]]) {
        await app.menu(NATIVE[orientation]);
        expect(layout(app), NATIVE[orientation]).toEqual(expected[orientation]);
        expect(chooser(app).value, NATIVE[orientation]).toBe(orientation);
        expect(await docSplitItems(app), NATIVE[orientation]).toEqual(checkedOnly(label));
      }

      // The in-app items carry the ids the story names, under the Document Split submenu.
      const src = appTsxSource();
      const sub = src.slice(src.indexOf("id: 'view-docsplit-sub'"), src.indexOf("id: 'view-table-cols-sub'"));
      expect(sub).toContain("label: 'Document Split'");
      expect([...sub.matchAll(/kind: 'checkbox',\s*id: '([^']+)',\s*label: '([^']+)'/g)].map((m) => [m[1], m[2]])).toEqual([
        ['view-docsplit-single', 'Single Pane'], ['view-docsplit-side', 'Side by Side'], ['view-docsplit-stacked', 'Top and Bottom'],
      ]);
    });
  });
});

describe('US-01M7DVR0 AC2: the split host takes the orientation, and Single Pane keeps the pane\'s document', () => {
  it('US-01M7DVR0 AC2 Side by Side and Top and Bottom give the host their classes, and App.css stacks Top and Bottom', async () => {
    await withApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      const view = { window: 1280, height: 800, canvas: 900 };
      await app.change(chooser(app), 'side-by-side');
      expect(hostClasses(app)).toBe(SIDE);
      expect(cascaded(host(app), 'flex-direction', view) ?? 'row', 'side by side is a row').toBe('row');
      await app.change(chooser(app), 'top-bottom');
      expect(hostClasses(app)).toBe(STACK);
      expect(cascaded(host(app), 'flex-direction', view), 'top and bottom is a column').toBe('column');
      const rules = appCssRules().filter((r) => r.selectorText.split(',').some((sel) => sel.trim() === '.mbc-split-host.is-top-bottom'));
      expect(rules.flatMap((r) => r.decls).filter((d) => d.name === 'flex-direction').map((d) => d.value)).toEqual(['column']);
    });
  });

  it('US-01M7DVR0 AC2 Single Pane, the toggle and Close split view keep the pane\'s document for the next split, and the pane reopens with no selection', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'side-by-side');
      await app.change(picker(app), DOC_B.id);
      await selectMarkInPane(app);

      await app.change(chooser(app), 'single');
      expect(layout(app), 'Single Pane: no pane, no is-split').toEqual({ host: SINGLE, pane: null });
      await autosaveRunsOut(app);
      expect(autosavedSplit(storage), 'Single Pane keeps the pane\'s document in the session').toEqual({ orientation: 'single', docId: DOC_B.id, docName: 'Doc_B' });

      // From the chooser.
      await app.change(chooser(app), 'top-bottom');
      expect(layout(app), 'the chooser brings Doc_B back').toEqual({ host: STACK, pane: DOC_B.id });
      expect(paneSelection(app), 'with no selection').toBeNull();
      // From the in-app menu, after Single Pane from it.
      await viewDocSplit(app, 'Single Pane');
      expect(layout(app)).toEqual({ host: SINGLE, pane: null });
      await viewDocSplit(app, 'Side by Side');
      expect(layout(app), 'the menu brings Doc_B back').toEqual({ host: SIDE, pane: DOC_B.id });
      // From the toggle: off, then back to the last split chosen.
      await app.click(toggle(app));
      expect(layout(app), 'the toggle closes the split').toEqual({ host: SINGLE, pane: null });
      expect(toggle(app).getAttribute('aria-pressed')).toBe('false');
      await app.click(toggle(app));
      expect(layout(app), 'the toggle brings Doc_B back, Side by Side').toEqual({ host: SIDE, pane: DOC_B.id });
      expect(toggle(app).getAttribute('aria-pressed')).toBe('true');
      // Close split view is Single Pane; the native id brings it back stacked.
      await app.click(labelled(pane(app), 'button', 'Close split view'));
      expect(layout(app), 'Close split view').toEqual({ host: SINGLE, pane: null });
      expect(chooser(app).value).toBe('single');
      await app.menu('view:document-split-top-bottom');
      expect(layout(app), 'the native item brings Doc_B back').toEqual({ host: STACK, pane: DOC_B.id });
      expect(paneSelection(app), 'with no selection').toBeNull();
      // And the toggle now returns to Top and Bottom, the last split chosen.
      await app.click(toggle(app));
      await app.click(toggle(app));
      expect(layout(app)).toEqual({ host: STACK, pane: DOC_B.id });
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M7DVR0 AC3: the document split is saved with the session and restored, each case by name', () => {
  it('US-01M7DVR0 AC3 changing only the split autosaves it, and restoring that autosave brings back the layout and the document', async () => {
    const storage = memoryStorage();
    const first = await mountApp({ storage });
    try {
      await restore(first, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await autosaveRunsOut(first);
      const before = storage.getItem(AUTOSAVE_KEY);
      expect(autosavedSplit(storage), 'a session that never split saves none').toBeUndefined();
      await first.change(chooser(first), 'top-bottom');
      await first.change(picker(first), DOC_B.id);
      await autosaveRunsOut(first);
      expect(storage.getItem(AUTOSAVE_KEY), 'the split alone is autosaved').not.toBe(before);
      expect(autosavedSplit(storage)).toEqual({ orientation: 'top-bottom', docId: DOC_B.id, docName: 'Doc_B' });
      const stacked = storage.getItem(AUTOSAVE_KEY);
      await first.change(chooser(first), 'side-by-side');
      await autosaveRunsOut(first);
      expect(storage.getItem(AUTOSAVE_KEY), 'the orientation alone is autosaved').not.toBe(stacked);
      expect(autosavedSplit(storage)).toEqual({ orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B' });
    } finally {
      first.unmount();
    }
    const second = await mountApp({ storage });
    try {
      await second.menu('file:restore-autosave');
      await second.settle();
      expect(statusSegments(second).join(' · ')).toContain('Restored workbench');
      expect(layout(second), 'the layout and the document come back').toEqual({ host: SIDE, pane: DOC_B.id });
      expect(chooser(second).value).toBe('side-by-side');
    } finally {
      second.unmount();
    }
  });

  it('US-01M7DVR0 AC3 changing only the pane\'s document autosaves the split with that document', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'side-by-side');
      await autosaveRunsOut(app);
      const first = autosavedSplit(storage);
      expect(first?.orientation).toBe('side-by-side');
      expect(first?.docId, 'the split opened on another document than Doc_B').not.toBe(DOC_B.id);
      // Only the picker changes; the orientation stays Side by Side.
      await app.change(picker(app), DOC_B.id);
      await autosaveRunsOut(app);
      expect(autosavedSplit(storage), 'the pane\'s document alone is autosaved').toEqual({ orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B' });
    } finally {
      app.unmount();
    }
  });

  const restoreSplit = (app: AppHarness, documentSplit: unknown, sessionName: string) => app.restoreSession({
    documents: [MAIN, DOC_A, DOC_B], activeDocId: MAIN.id, viewerTab: 'sequence-view', sessionName,
    workspace: { mapLayoutMode: 'linear', ...(documentSplit === undefined ? {} : { documentSplit: documentSplit as never }) },
  });
  const noSplitNotice = (app: AppHarness) =>
    expect(statusSegments(app).filter((s) => !s.startsWith('Restored workbench') && /Single Pane|document split|split pane/i.test(s)), 'no split notice').toEqual([]);

  it('US-01M7DVR0 AC3 restores a saved split, and an absent one opens in Single Pane with no message', async () => {
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'top-bottom', docId: DOC_B.id, docName: 'Doc_B' }, 'Split_Saved');
      expect(layout(app), 'saved: Top and Bottom with Doc_B').toEqual({ host: STACK, pane: DOC_B.id });
      noSplitNotice(app);
      // A session saved before the field, restored over the open split.
      await restoreSplit(app, undefined, 'Split_Absent');
      expect(layout(app), 'absent: Single Pane').toEqual({ host: SINGLE, pane: null });
      expect(chooser(app).value).toBe('single');
      noSplitNotice(app);
      // The absent session holds no pane document: the toggle opens on another open document, not Doc_B.
      await app.click(toggle(app));
      expect(paneDocId(app)).not.toBe(DOC_B.id);
    });
  });

  it('US-01M7DVR0 AC3 a Single Pane session saved with a pane document brings that document back on the next split', async () => {
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'single', docId: DOC_B.id, docName: 'Doc_B' }, 'Split_Single_Kept');
      expect(layout(app), 'single: no pane').toEqual({ host: SINGLE, pane: null });
      noSplitNotice(app);
      await app.change(chooser(app), 'side-by-side');
      expect(layout(app), 'the saved pane document comes back').toEqual({ host: SIDE, pane: DOC_B.id });
    });
  });

  it('US-01M7DVR0 AC3 after restoring Top and Bottom, the toggle closes and reopens it Top and Bottom', async () => {
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'top-bottom', docId: DOC_B.id, docName: 'Doc_B' }, 'Split_Toggle');
      expect(layout(app)).toEqual({ host: STACK, pane: DOC_B.id });
      await app.click(toggle(app));
      expect(layout(app), 'the toggle closes the split').toEqual({ host: SINGLE, pane: null });
      await app.click(toggle(app));
      expect(layout(app), 'the toggle returns to the restored split').toEqual({ host: STACK, pane: DOC_B.id });
    });
  });

  it('US-01M7DVR0 AC3 a pane document from the sample library restores with no missing-document message', async () => {
    const sample = SAMPLE_LIBRARY[0];
    expect(sample, 'the sample library has a document').toBeTruthy();
    expect([MAIN, DOC_A, DOC_B].some((d) => d.id === sample.id), 'the sample is not among the restored documents').toBe(false);
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'side-by-side', docId: sample.id, docName: sample.name }, 'Split_Sample');
      expect(layout(app), 'the sample document is in the pane').toEqual({ host: SIDE, pane: sample.id });
      noSplitNotice(app);
    });
  });

  it('US-01M7DVR0 AC3 a split saved with docId null reopens split, asking for a document, with no message', async () => {
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'side-by-side', docId: null, docName: null }, 'Split_Null');
      expect(layout(app), 'docId null: split, no document').toEqual({ host: SIDE, pane: '' });
      const shown = picker(app).querySelectorAll('option').filter((o) => o.selected);
      expect(shown.map((o) => words(o.textContent))).toEqual(['Choose a document…']);
      noSplitNotice(app);
    });
  });

  it('US-01M7DVR0 AC3 a docId not among the session\'s non-deleted documents opens in Single Pane and names it', async () => {
    await withApp(async (app) => {
      await restoreSplit(app, { orientation: 'top-bottom', docId: 'sdp-gone', docName: 'Gone_Doc' }, 'Split_Missing');
      expect(layout(app), 'missing: Single Pane').toEqual({ host: SINGLE, pane: null });
      const said = statusSegments(app);
      expect(said[0], 'the restore sentence is kept').toContain('Restored workbench "Split_Missing.mbc"');
      expect(said.filter((s) => s === missing('Gone_Doc')), 'the missing document is named, exactly').toHaveLength(1);
      expect(said.filter((s) => s === UNREADABLE)).toEqual([]);

      // A deleted document is not in the session either.
      await app.restoreSession({
        documents: [MAIN, DOC_A, DOC_B], activeDocId: MAIN.id, viewerTab: 'sequence-view', sessionName: 'Split_Deleted',
        workspace: {
          mapLayoutMode: 'linear',
          projectExplorer: { customFolders: [], folderColors: {}, folderNames: {}, folderParents: {}, hiddenFolders: [], favoriteFolders: [], favoriteDocIds: [], deletedDocIds: [DOC_B.id], readDocIds: [] } as never,
          documentSplit: { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B' },
        },
      });
      expect(layout(app), 'deleted: Single Pane').toEqual({ host: SINGLE, pane: null });
      expect(statusSegments(app).filter((s) => s === missing('Doc_B'))).toHaveLength(1);
    });
  });

  it('US-01M7DVR0 AC3 an orientation not one of the three, or a docId neither a string nor null, opens in Single Pane and says it could not be read', async () => {
    await withApp(async (app) => {
      for (const [name, saved] of [
        ['Split_Orientation', { orientation: 'diagonal', docId: DOC_B.id, docName: 'Doc_B' }],
        ['Split_No_Orientation', { docId: DOC_B.id, docName: 'Doc_B' }],
        ['Split_Number_Id', { orientation: 'side-by-side', docId: 7, docName: 'Doc_B' }],
        ['Split_Object_Id', { orientation: 'top-bottom', docId: { id: DOC_B.id }, docName: 'Doc_B' }],
      ] as const) {
        await restoreSplit(app, saved, name);
        expect(layout(app), `${name}: Single Pane`).toEqual({ host: SINGLE, pane: null });
        const said = statusSegments(app);
        expect(said[0]).toContain(`Restored workbench "${name}.mbc"`);
        expect(said.filter((s) => s === UNREADABLE), `${name}: the unreadable split is said, exactly`).toHaveLength(1);
        expect(said.filter((s) => s.startsWith("The split pane's document")), name).toEqual([]);
      }
    });
  });
});

describe('US-01M7DVR0 AC4: the document table items are relabelled, and the divider stays where it was', () => {
  it('US-01M7DVR0 AC4 View › Split & Expand names the document-table items for what they place, with their descriptions', async () => {
    await withApp(async (app) => {
      await restore(app, [MAIN, DOC_A], MAIN.id, null);
      await openView(app, ['Split & Expand', 'Document Table Beside Viewer']);
      const sub = app.all('.desktop-menu-popup').filter((p) => p.querySelectorAll('button').some((b) => menuWords(b.textContent) === 'Document Table Below Viewer'));
      expect(sub, 'one Split & Expand submenu').toHaveLength(1);
      const labels = sub[0].querySelectorAll('button[role="menuitemcheckbox"]').map((b) => menuWords(b.textContent));
      expect(labels.slice(0, 2)).toEqual(['Document Table Below Viewer', 'Document Table Beside Viewer']);
      await closeMenus(app);
      const center = () => app.one('.mbc-center-stack', 'the centre stack');
      await viewDocSplit(app, 'Side by Side');
      await openView(app, ['Split & Expand', 'Document Table Beside Viewer']).then((b) => app.click(b));
      expect(center().classList.contains('split-left-right'), 'Beside: the table and viewer side by side').toBe(true);
      expect(hostClasses(app), 'the document split is untouched').toBe(SIDE);
      await closeMenus(app);
      await openView(app, ['Split & Expand', 'Document Table Below Viewer']).then((b) => app.click(b));
      expect(center().classList.contains('split-left-right'), 'Below: stacked').toBe(false);
      expect(hostClasses(app)).toBe(SIDE);
      await closeMenus(app);
    });
    const src = appTsxSource();
    for (const [id, label] of [['view-split-tb', 'Document Table Below Viewer'], ['view-split-lr', 'Document Table Beside Viewer']]) {
      expect(src, id).toMatch(new RegExp(`id: '${id}',\\s*label: '${label}',`));
    }
    expect(resolveMenuNodeFunctionDescription('view-split-tb', 'Document Table Below Viewer')).toBe('Stack the active sequence viewer canvas on top with the document table below it');
    expect(resolveMenuNodeFunctionDescription('view-split-lr', 'Document Table Beside Viewer')).toBe('Arrange the document table and sequence viewer side by side');
    expect(src).not.toContain("'Split Top / Bottom'");
    expect(src).not.toContain("'Split Left / Right'");
  });

  it('US-01M7DVR0 AC4 Side by Side leaves the circular / linear divider at the ratio for the map frame\'s own width, and the saved ratio unchanged', async () => {
    const CIRC = { ...seqDoc('sdp-circ', 'Circ_Doc', 7_300, 17), topology: 'circular' } as SequenceDocument;
    const RATIO = 0.75;
    let frameWidth = 700;
    const storage = memoryStorage();
    const app = await mountApp({
      storage, width: 1440, height: 900,
      layout: (el) => (el.classList.contains('map-seq-split') ? { width: frameWidth, height: 640 } : { width: 0, height: 0 }),
    });
    try {
      await app.restoreSession({
        documents: [CIRC, DOC_A], activeDocId: CIRC.id, viewerTab: 'sequence-view',
        workspace: { mapLayoutMode: 'split', paneSplit: { ratio: RATIO, collapsed: null } },
      });
      const divider = () => app.one('.map-seq-split > .map-seq-divider', 'the divider');
      const savedRatio = () => {
        const raw = storage.getItem(AUTOSAVE_KEY);
        return parseMbcWorkbench(raw!, 'Reopened').envelope.workspace.paneSplit;
      };
      for (const orientation of ['side-by-side', 'top-bottom', 'single', 'side-by-side'] as const) {
        await app.change(chooser(app), orientation);
        for (const w of [700, 900]) {
          frameWidth = w;
          await React.act(async () => {});
          await app.settle();
          expect(divider().getAttribute('aria-valuenow'), `${orientation} at ${w}px`)
            .toBe(String(paneSplitValueNow({ ratio: renderedPaneSplitRatio(RATIO, w), collapsed: null })));
        }
        await autosaveRunsOut(app);
        expect(savedRatio(), `${orientation}: the saved ratio and collapse are unchanged`).toEqual({ ratio: RATIO, collapsed: null });
      }
      expect(hostClasses(app)).toBe(SIDE);
      // The two widths draw different ratios, so a divider that ignored the frame's width would fail above.
      expect(renderedPaneSplitRatio(RATIO, 700)).not.toBe(renderedPaneSplitRatio(RATIO, 900));
    } finally {
      app.unmount();
    }
    // The side-by-side maps follow the canvas's own width, not the window's.
    const rules = appCssRules();
    expect(rules.some((r) => r.selectorText.trim() === '.mbc-viewer-canvas' && r.decls.some((d) => d.name === 'container' && /viewer-canvas\s*\/\s*inline-size/.test(d.value)))).toBe(true);
    expect(rules.some((r) => r.at.includes('@container viewer-canvas (min-width: 760px)') && r.selectorText.includes('.map-seq-grid.mode-split'))).toBe(true);
  });
});

// ─── US-01M7DVB1: the divider between the two documents ───

/** The host the tests lay out: 1,206 x 706, so 1,200 px wide or 700 px tall for the panes beside the 6 px divider. */
const HOST_W = 1206;
const HOST_H = 706;
const divider = (app: AppHarness) => app.one('.mbc-split-host > .mbc-split-divider', 'the document split divider');
const valueNow = (app: AppHarness) => Number(divider(app).getAttribute('aria-valuenow'));
const restoreButtons = (app: AppHarness) =>
  app.all('.mbc-split-host > button').map((b) => b.getAttribute('aria-label')).filter((l) => l?.startsWith('Restore'));
const SIZE_UNREADABLE = 'The saved split size could not be read; the panes open at half each.';

/** Mounts the App with the split host laid out at `box` (every other box 0 x 0); `resize` lays it out anew. */
async function withSizedApp<T>(
  run: (app: AppHarness, resize: (width: number, height: number) => Promise<void>) => Promise<T>,
  storage: LiveStorage = memoryStorage()
): Promise<T> {
  const box = { width: HOST_W, height: HOST_H };
  const app = await mountApp({
    storage, width: 1440, height: 900,
    layout: (el) => (el.classList.contains('mbc-split-host') ? { ...box } : { width: 0, height: 0 }),
  });
  const resize = async (width: number, height: number) => {
    box.width = width;
    box.height = height;
    await React.act(async () => {});
    await app.settle();
  };
  try {
    return await run(app, resize);
  } finally {
    app.unmount();
  }
}

/** Drags the divider with the primary pointer from where it is to `to` (page px; the host sits at 0, 0). */
async function dragDivider(app: AppHarness, to: { x: number; y: number }) {
  const d = divider(app);
  const pointer = { pointerId: 9, pointerType: 'mouse', isPrimary: true };
  await React.act(async () => { dispatchLiveEvent(d, 'pointerdown', { ...pointer, button: 0, buttons: 1, clientX: 600, clientY: 350 }); });
  await React.act(async () => { dispatchLiveEvent(d, 'pointermove', { ...pointer, buttons: 1, clientX: to.x, clientY: to.y }); });
  await React.act(async () => { dispatchLiveEvent(d, 'pointerup', { ...pointer, clientX: to.x, clientY: to.y }); });
  await app.settle();
}
/** The pointer offset that leaves the main pane `px` long beside the divider's 3 px half. */
const mainAt = (px: number) => px + 3;
async function pressOnDivider(app: AppHarness, key: string, shift = false) {
  divider(app).focus();
  await app.press(key, { shift });
}
const restoreWithSplit = (app: AppHarness, documentSplit: unknown, sessionName: string) => app.restoreSession({
  documents: [MAIN, DOC_A, DOC_B], activeDocId: MAIN.id, viewerTab: 'sequence-view', sessionName,
  workspace: { mapLayoutMode: 'linear', documentSplit: documentSplit as never },
});
const sizeNotices = (app: AppHarness) => statusSegments(app).filter((s) => /split size|half each/i.test(s));

/** Activates a restore button from the keyboard's place on it; the button goes, and focus moves to the divider. */
async function clickRestore(app: AppHarness, label: string) {
  const button = app.one(`.mbc-split-host > button[aria-label="${label}"]`, label);
  button.focus();
  expect(app.doc.activeElement === button, `${label} has focus`).toBe(true);
  await app.click(button);
  expect(app.all(`.mbc-split-host > button[aria-label="${label}"]`), `${label} is gone`).toHaveLength(0);
  expect(app.doc.activeElement === divider(app), `${label}: focus moves to the divider, not the page`).toBe(true);
}
/** The window the sized host sits in, for the App.css cascade: the viewer canvas at most the host's width. */
const SIZED_VIEW = { window: 1440, height: 900, canvas: HOST_W };
/**
 * What the split draws, read the way a browser lays it out: the flex App.css gives the main view and
 * the pane (cascaded as declared; the reader leaves a var() in a shorthand to the caller), with each
 * var() taken from the shares the App wrote on the host, the one element between it and the panes.
 * The pane's share is the main pane's complement, and the separator announces the main pane's share.
 */
function expectDrawn(app: AppHarness, ratio: number, label: string, view = SIZED_VIEW) {
  const h = host(app);
  const share = (name: string) => Number(h.style.getPropertyValue(name) || NaN);
  // The flex-grow a declared flex resolves to on a child of the host.
  const grow = (flex: string | undefined) =>
    Number(gridTracks((flex ?? '').replace(/var\((--[\w-]+)\s*,\s*([^)]*)\)/g, (_, n: string, fb: string) => h.style.getPropertyValue(n) || fb))[0]);
  const mainFlex = cascaded(app.canvas(), 'flex', view);
  const paneFlex = cascaded(pane(app), 'flex', view);
  expect({
    mainFlex, paneFlex, main: share('--mbc-doc-split-main'), second: share('--mbc-doc-split-second'),
    mainGrow: grow(mainFlex), paneGrow: grow(paneFlex),
  }, label).toEqual({
    mainFlex: 'var(--mbc-doc-split-main, 1) 1 0',
    paneFlex: 'var(--mbc-doc-split-second, 1) 1 0',
    main: expect.closeTo(ratio, 3),
    second: expect.closeTo(1 - ratio, 3),
    mainGrow: expect.closeTo(ratio, 3),
    paneGrow: expect.closeTo(1 - ratio, 3),
  });
  expect(Math.round(share('--mbc-doc-split-main') * 100), `${label}: the separator announces the share drawn`).toBe(valueNow(app));
}

describe('US-01M7DVB1 AC1: the divider is dragged along the active axis, and its ratio is saved and restored', () => {
  it('US-01M7DVB1 AC1 a drag sets the width side by side and the height top and bottom, each pane kept to its minimum', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'side-by-side');
      expect(valueNow(app), 'a first split is half each').toBe(50);
      // x leaves the main pane 360 of 1,200 px; y would read 647 of 700 (or of 1,200).
      await dragDivider(app, { x: mainAt(360), y: 650 });
      expect(valueNow(app), 'side by side: the width').toBe(30);
      expectDrawn(app, 0.3, 'the drag draws the main view at 360 of 1,200');
      // 250 px is under side by side's 320 (and over half of it, so nothing folds).
      await dragDivider(app, { x: mainAt(250), y: 650 });
      expect(valueNow(app), 'clamped to 320 of 1,200').toBe(Math.round((320 / 1200) * 100));
      expectDrawn(app, 320 / 1200, 'the main view is drawn at its 320 px minimum');

      await app.change(chooser(app), 'top-bottom');
      // The chosen 320/1,200 is 187 of 700 px tall, under 200: drawn at 200 of 700.
      expect(valueNow(app), 'the chosen ratio is drawn clamped to the height').toBe(Math.round((200 / 700) * 100));
      expectDrawn(app, 200 / 700, 'top and bottom draws the main view at its 200 px minimum');
      // y leaves the main pane 490 of 700 px; x would fold the main view away.
      await dragDivider(app, { x: 50, y: mainAt(490) });
      expect(valueNow(app), 'top and bottom: the height').toBe(70);
      expectDrawn(app, 0.7, 'the drag draws the main view 490 of 700 tall');
      expect(restoreButtons(app)).toEqual([]);
      // 150 px is under top and bottom's 200 and over half of it.
      await dragDivider(app, { x: 1150, y: mainAt(150) });
      expect(valueNow(app), 'clamped to 200 of 700').toBe(Math.round((200 / 700) * 100));
      expectDrawn(app, 200 / 700, 'the main view is drawn at its 200 px minimum, not 150');
      expect(restoreButtons(app)).toEqual([]);
    });
  });

  it('US-01M7DVB1 AC1 a narrower host clamps the drawn ratio only; the chosen one is saved, drawn again when wide enough, and restored', async () => {
    const storage = memoryStorage();
    await withSizedApp(async (app, resize) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'side-by-side');
      await app.change(picker(app), DOC_B.id);
      await dragDivider(app, { x: mainAt(360), y: 10 });
      expect(valueNow(app)).toBe(30);
      expectDrawn(app, 0.3, 'after the drag');
      await resize(806, HOST_H);
      expect(valueNow(app), '0.3 of 800 is under 320: drawn at 320 of 800').toBe(40);
      expectDrawn(app, 320 / 800, 'the narrower host draws the main view at 320 of 800, not 240', { ...SIZED_VIEW, canvas: 806 });
      await autosaveRunsOut(app);
      expect(autosavedSplit(storage), 'the chosen ratio is saved, not the drawn one')
        .toEqual({ orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B', ratio: 0.3 });
      await resize(HOST_W, HOST_H);
      expect(valueNow(app), 'wide again: the chosen ratio').toBe(30);
      expectDrawn(app, 0.3, 'wide again');
    }, storage);
    await withSizedApp(async (app) => {
      await app.menu('file:restore-autosave');
      await app.settle();
      expect(statusSegments(app).join(' · ')).toContain('Restored workbench');
      expect(layout(app)).toEqual({ host: SIDE, pane: DOC_B.id });
      expect(valueNow(app), 'the saved ratio comes back').toBe(30);
      expectDrawn(app, 0.3, 'the restored ratio is drawn');
      expect(sizeNotices(app)).toEqual([]);
    }, storage);
  });

  it('US-01M7DVB1 AC1 the host is measured only while a split is shown, and a split opened after a Single Pane resize draws at the new size', async () => {
    await withSizedApp(async (app, resize) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      // Which elements each resize observer watches, from here on.
      type Observer = { observe(el: unknown): void; unobserve(el: unknown): void; disconnect(): void };
      const proto = (globalThis as unknown as { ResizeObserver: { prototype: Observer } }).ResizeObserver.prototype;
      const watching = new Map<unknown, Set<unknown>>();
      const watched = (o: unknown) => watching.get(o) ?? watching.set(o, new Set()).get(o)!;
      const { observe, unobserve, disconnect } = proto;
      const spies = [
        vi.spyOn(proto, 'observe').mockImplementation(function (this: Observer, el: unknown) { watched(this).add(el); observe.call(this, el); }),
        vi.spyOn(proto, 'unobserve').mockImplementation(function (this: Observer, el: unknown) { watched(this).delete(el); unobserve.call(this, el); }),
        vi.spyOn(proto, 'disconnect').mockImplementation(function (this: Observer) { watching.delete(this); disconnect.call(this); }),
      ];
      const hostWatched = () => [...watching.values()].some((els) => [...els].some((el) => el === host(app)));
      try {
        await app.change(chooser(app), 'side-by-side');
        expect(hostWatched(), 'side by side: the host is measured').toBe(true);
        await dragDivider(app, { x: mainAt(360), y: 10 });
        expectDrawn(app, 0.3, 'side by side at 1,206');
        await app.change(chooser(app), 'single');
        expect(hostWatched(), 'Single Pane: nothing measures the host').toBe(false);
        await resize(806, HOST_H);
        await app.change(chooser(app), 'side-by-side');
        expect(hostWatched(), 'split again: the host is measured again').toBe(true);
        expect(valueNow(app), 'measured on opening: 0.3 of 800 is drawn at 320 of 800').toBe(40);
        expectDrawn(app, 320 / 800, 'opened after the Single Pane resize', { ...SIZED_VIEW, canvas: 806 });
        await app.change(chooser(app), 'top-bottom');
        expect(hostWatched(), 'top and bottom: the host is measured').toBe(true);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  it('US-01M7DVB1 AC1 an absent ratio opens at half each with no message; an unreadable one at half each, not folded, saying so exactly', async () => {
    await withSizedApp(async (app) => {
      await restoreWithSplit(app, { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B', ratio: 0.3 }, 'Size_Saved');
      expect(valueNow(app), 'a saved ratio').toBe(30);
      expect(sizeNotices(app)).toEqual([]);
      await restoreWithSplit(app, { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B' }, 'Size_Absent');
      expect(valueNow(app), 'absent: half each, not the ratio shown before').toBe(50);
      expect(sizeNotices(app), 'absent: no message').toEqual([]);
      for (const [name, bad] of [
        ['Size_Text', { ratio: 'wide' }],
        ['Size_Over', { ratio: 1.5 }],
        ['Size_Collapse', { ratio: 0.3, collapsed: 'left' }],
      ] as const) {
        await restoreWithSplit(app, { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B', ratio: 0.3, collapsed: 'main' }, `${name}_Before`);
        expect(restoreButtons(app), `${name}: folded before`).toEqual(['Restore the main view']);
        await restoreWithSplit(app, { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B', ...bad }, name);
        expect(layout(app), `${name}: the split and its document are read apart`).toEqual({ host: SIDE, pane: DOC_B.id });
        expect(valueNow(app), `${name}: half each`).toBe(50);
        expect(restoreButtons(app), `${name}: not folded`).toEqual([]);
        const said = statusSegments(app);
        expect(said[0]).toContain(`Restored workbench "${name}.mbc"`);
        expect(said.filter((s) => s === SIZE_UNREADABLE), `${name}: said once, exactly`).toHaveLength(1);
        expect(sizeNotices(app), name).toEqual([SIZE_UNREADABLE]);
      }
    });
  });
});

describe('US-01M7DVB1 AC2: the divider is a separator the keys of its own axis move', () => {
  it('US-01M7DVB1 AC2 side by side: a vertical separator Left and Right move, Shift by the large step; Up and Down do nothing', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'side-by-side');
      const d = divider(app);
      expect({
        tabindex: d.getAttribute('tabindex'), role: d.getAttribute('role'), label: d.getAttribute('aria-label'),
        orientation: d.getAttribute('aria-orientation'), min: d.getAttribute('aria-valuemin'), max: d.getAttribute('aria-valuemax'),
        now: d.getAttribute('aria-valuenow'),
      }).toEqual({
        tabindex: '0', role: 'separator', label: 'Resize the main view and the split pane',
        orientation: 'vertical', min: '0', max: '100', now: '50',
      });
      // 1,200 px wide: 16 px is 1.33%, 80 px 6.67%.
      const steps: [string, boolean, number, number][] = [
        ['ArrowRight', false, 51, 616], ['ArrowRight', true, 58, 696], ['ArrowLeft', false, 57, 680], ['ArrowLeft', true, 50, 600], ['ArrowLeft', false, 49, 584],
      ];
      for (const [key, shift, want, px] of steps) {
        await pressOnDivider(app, key, shift);
        expect(valueNow(app), `${shift ? 'Shift+' : ''}${key}`).toBe(want);
        expectDrawn(app, px / 1200, `${shift ? 'Shift+' : ''}${key} draws the main view ${px} of 1,200`);
      }
      for (const key of ['ArrowUp', 'ArrowDown']) {
        await pressOnDivider(app, key);
        expect(valueNow(app), `${key} is the other axis`).toBe(49);
      }
      await pressOnDivider(app, 'Home');
      expect(valueNow(app), 'Home folds the main view').toBe(0);
      await pressOnDivider(app, 'Enter');
      expect(valueNow(app), 'Enter restores').toBe(49);
      await pressOnDivider(app, 'End');
      expect(valueNow(app), 'End folds the split pane').toBe(100);
      await pressOnDivider(app, 'Enter');
      expect(valueNow(app)).toBe(49);
    });
  });

  it('US-01M7DVB1 AC2 top and bottom: a horizontal separator Up and Down move, Shift by the large step; Left and Right do nothing', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await app.change(chooser(app), 'top-bottom');
      expect(divider(app).getAttribute('aria-orientation')).toBe('horizontal');
      expect(divider(app).getAttribute('aria-label')).toBe('Resize the main view and the split pane');
      expect(valueNow(app)).toBe(50);
      // 700 px tall: 16 px is 2.29%, 80 px 11.43%.
      const steps: [string, boolean, number, number][] = [
        ['ArrowDown', false, 52, 366], ['ArrowDown', true, 64, 446], ['ArrowUp', false, 61, 430], ['ArrowUp', true, 50, 350],
      ];
      for (const [key, shift, want, px] of steps) {
        await pressOnDivider(app, key, shift);
        expect(valueNow(app), `${shift ? 'Shift+' : ''}${key}`).toBe(want);
        expectDrawn(app, px / 700, `${shift ? 'Shift+' : ''}${key} draws the main view ${px} of 700 tall`);
      }
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        await pressOnDivider(app, key);
        expect(valueNow(app), `${key} is the other axis`).toBe(50);
      }
      await pressOnDivider(app, 'End');
      expect(valueNow(app)).toBe(100);
      await pressOnDivider(app, 'Enter');
      expect(valueNow(app)).toBe(50);
      await pressOnDivider(app, 'Home');
      expect(valueNow(app)).toBe(0);
    });
  });
});

describe('US-01M7DVB1 AC3: a folded pane leaves its restore button, and folding changes no document or selection', () => {
  it('US-01M7DVB1 AC3 Home and End fold each pane, its button restores the last expanded ratio, and both selections stay', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, { start: 100, end: 200 });
      await showInPane(app, DOC_A.id);
      await selectMarkInPane(app);
      const readout = () => words(app.one('.mbc-selection-readout', 'the main selection readout').textContent);
      const seen = () => ({ main: mainDocName(app), pane: paneDocId(app), readout: readout(), mainSel: mainSelection(app), paneSel: paneSelection(app) });
      const before = seen();
      expect(before).toMatchObject({ main: 'Main_Doc', pane: DOC_A.id, mainSel: '100..200', paneSel: '5,000..6,000' });
      expect(before.readout).toMatch(/100/);
      await dragDivider(app, { x: mainAt(360), y: 10 });
      expect(valueNow(app)).toBe(30);
      const view = { window: 1440, height: 900, canvas: 1206 };

      await pressOnDivider(app, 'Home');
      expect(valueNow(app)).toBe(0);
      expect(restoreButtons(app)).toEqual(['Restore the main view']);
      expect(hostClasses(app)).toBe('is-collapsed-main is-side-by-side is-split mbc-split-host');
      expect(cascaded(app.canvas(), 'display', view), 'the main view is folded away').toBe('none');
      expect(seen(), 'folding the main view changes nothing in either pane').toEqual(before);
      await clickRestore(app, 'Restore the main view');
      expect(valueNow(app), 'the last expanded ratio').toBe(30);
      expect(restoreButtons(app)).toEqual([]);
      expect(cascaded(app.canvas(), 'display', view) ?? 'block').not.toBe('none');
      expect(seen()).toEqual(before);

      await pressOnDivider(app, 'End');
      expect(valueNow(app)).toBe(100);
      expect(restoreButtons(app)).toEqual(['Restore the split pane']);
      expect(cascaded(pane(app), 'display', view), 'the split pane is folded away').toBe('none');
      expect(seen(), 'folding the split pane changes nothing in either pane').toEqual(before);
      await clickRestore(app, 'Restore the split pane');
      expect(valueNow(app)).toBe(30);
      expect(cascaded(pane(app), 'display', view)).not.toBe('none');
      expect(seen()).toEqual(before);
    });
  });

  it('US-01M7DVB1 AC3 a drag past half the minimum folds the pane, and restoring returns the ratio from before the drag', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, { start: 100, end: 200 });
      await showInPane(app, DOC_A.id);
      await dragDivider(app, { x: mainAt(360), y: 10 });
      expect(valueNow(app)).toBe(30);
      await dragDivider(app, { x: mainAt(100), y: 10 });
      expect(valueNow(app)).toBe(0);
      expect(restoreButtons(app)).toEqual(['Restore the main view']);
      await app.click(app.one('.mbc-split-host > button[aria-label="Restore the main view"]'));
      expect(valueNow(app)).toBe(30);
      await dragDivider(app, { x: mainAt(1100), y: 10 });
      expect(restoreButtons(app)).toEqual(['Restore the split pane']);
      await pressOnDivider(app, 'Enter');
      expect(valueNow(app)).toBe(30);
      expect(mainSelection(app)).toBe('100..200');
    });
  });
});

describe('US-01M7DVB1 AC4: Swap leaves the divider where it was', () => {
  it('US-01M7DVB1 AC4 at 30% the divider reads 30 after Swap, and a folded pane stays folded in the same place', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [DOC_A, DOC_B], DOC_A.id, { start: 100, end: 200 });
      await showInPane(app, DOC_B.id);
      await dragDivider(app, { x: mainAt(360), y: 10 });
      expect(valueNow(app)).toBe(30);
      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));
      expect(mainDocName(app), 'the documents moved').toBe('Doc_B');
      expect(paneDocId(app)).toBe(DOC_A.id);
      expect(valueNow(app), 'the divider did not').toBe(30);
      expectDrawn(app, 0.3, 'Swap leaves the main view drawn at 30%');
      expect(hostClasses(app)).toBe(SIDE);

      await pressOnDivider(app, 'Home');
      expect(valueNow(app)).toBe(0);
      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));
      expect(mainDocName(app)).toBe('Doc_A');
      expect(valueNow(app), 'the main view is still folded').toBe(0);
      expect(restoreButtons(app)).toEqual(['Restore the main view']);
      expect(hostClasses(app)).toBe('is-collapsed-main is-side-by-side is-split mbc-split-host');
      await app.click(app.one('.mbc-split-host > button[aria-label="Restore the main view"]'));
      expect(valueNow(app), 'and restores to where it was').toBe(30);
      expectDrawn(app, 0.3, 'restored after Swap, the main view is drawn at 30% again');
    });
  });
});

// ─── US-01M7DVQG: the same document in both panes, and the pane's own view, zoom and rotation ───
//
// Wrong implementations each check below fails on: the main view's document as a picker option
// rather than a button (AC1: the button is missing, the 401-candidate note counts 402); the pane's
// Circular Map drawing the main view's cut sites (AC1: Circ_B's lone EcoRI site is missing); a
// circle offered for a protein, RNA or linear document, or a sentence of the pane's own (AC1); no
// sharing, or a sync loop (AC2: the readout's change count); the selection shared whenever the split
// is shown (AC4); the pane's zoom moving the header's %, its rotation written to workspace.mapRotation
// (AC3); a swap that does not exchange zoom and rotation, or that pushes history for the same
// document (AC3); Circular Map kept for a document turned linear (AC5); a view saved while it is the
// default, the pane's zoom saved, or an unreadable saved view silently used (AC6).

const ECO = 'GAATTC';
/** `seq` with no EcoRI site, around the origin either: each one turned to GAATTG until none is left. */
function withoutEco(seq: string): string {
  let s = `TTTTTT${seq.slice(6, -6)}TTTTTT`;
  while (s.includes(ECO)) s = s.replace(/GAATTC/g, 'GAATTG');
  return s;
}
/** A circular plasmid built in the test: "Mark" at 5,000..6,000 and "Other" at 1,000..1,500. */
const plasmid = (id: string, name: string, length: number, seed: number, sequence?: string): SequenceDocument => {
  const d = seqDoc(id, name, length, seed);
  return {
    ...d, topology: 'circular', sequence: sequence ?? withoutEco(d.sequence),
    features: [...d.features, { id: `${id}-other`, name: 'Other', type: 'misc_feature', start: 1000, end: 1500, strand: 1, color: '#10b981', qualifiers: {} }],
  } as SequenceDocument;
};
/** Circ_A has no EcoRI site; Circ_B has one, the only one, cutting after 3,001. */
const CA = plasmid('qg-a', 'Circ_A', 7_200, 21);
const CB_SEQ = withoutEco(seqDoc('x', 'x', 7_500, 23).sequence);
const CB = plasmid('qg-b', 'Circ_B', 7_500, 23, `${CB_SEQ.slice(0, 3000)}${ECO}${CB_SEQ.slice(3006)}`);
const LIN = { ...seqDoc('qg-lin', 'Lin_Doc', 7_100, 29), features: [] } as SequenceDocument;
const PROT = { ...seqDoc('qg-prot', 'Prot_Doc', 10, 1), moleculeType: 'Protein', sequence: 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWUAEHA'.replace('U', 'S'), features: [] } as SequenceDocument;
const RNA = { ...seqDoc('qg-rna', 'Rna_Doc', 900, 31), moleculeType: 'RNA', features: [] } as SequenceDocument;
RNA.sequence = RNA.sequence.replace(/T/g, 'U');
/** A tree and an alignment from the sample library, which the App's catalog (and so the picker) holds. */
const TREE = SAMPLE_LIBRARY.find((d) => d.id === 'doc-tree-three-kingdoms')!;
const ALN = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-hiv-env')!;
const TEXT = { ...seqDoc('qg-text', 'Text_Doc', 10, 4), sequence: '', features: [], docMetadata: { 'Document Type': 'Text Document', Notes: 'A note.' } } as unknown as SequenceDocument;

const SHOW_MAIN = "Show the main view's document in the split pane";
const VIEW_NOTICE = "The split pane's saved view could not be read; it opens in Linear Map.";
const rotationNotice = (name: string) => `The saved rotation for ${name} in the split pane could not be read; it opens at 0 degrees.`;
const LINEAR_SENTENCE = 'Circular maps are drawn for circular DNA; this document is linear.';

const showMain = (app: AppHarness) => labelled(pane(app), 'button', SHOW_MAIN);
const viewSelect = (app: AppHarness) => labelled(pane(app), 'select', 'View in split pane');
const viewSelects = (app: AppHarness) => pane(app).querySelectorAll('select').filter((s) => s.getAttribute('aria-label') === 'View in split pane');
const viewOptions = (app: AppHarness) =>
  viewSelect(app).querySelectorAll('option').map((o) => [o.getAttribute('value'), words(o.textContent), o.hasAttribute('disabled')]);
const viewNote = (app: AppHarness) => pane(app).querySelectorAll('.mbc-split-pane-view-note').map((n) => words(n.textContent));
const paneMaps = (app: AppHarness) => pane(app).querySelectorAll('svg.plasmid-svg');
const paneMap = (app: AppHarness) => { const m = paneMaps(app); expect(m, "the pane's one circular map").toHaveLength(1); return m[0]; };
const mainMap = (app: AppHarness) => { const m = app.canvas().querySelectorAll('svg.plasmid-svg'); expect(m, "the main view's one circular map").toHaveLength(1); return m[0]; };
const wedge = (svg: LiveElement) => svg.querySelectorAll('[data-map-part="origin-wedge"]')[0]?.getAttribute('data-draw-angle') ?? null;
const viewport = (svg: LiveElement) => svg.querySelectorAll('g.plasmid-viewport-group')[0]?.getAttribute('transform') ?? null;
/** The scale the map's view group is drawn at: 1 with no transform. */
const scaleOf = (svg: LiveElement) => { const m = /scale\(([\d.]+)\)/.exec(viewport(svg) ?? ''); return m ? Number(m[1]) : 1; };
const cutTitles = (svg: LiveElement) => svg.querySelectorAll('title').map((t) => words(t.textContent)).filter((t) => / cuts after /.test(t));
const interval = (svg: LiveElement) => svg.querySelectorAll('[data-active-interval]').map((p) => `${p.getAttribute('data-start-angle')}-${p.getAttribute('data-end-angle')}`);
const headerZoom = (app: AppHarness) => words(app.header().querySelectorAll('button.zoom-pct-btn')[0]?.textContent ?? '');
const readout = (app: AppHarness) => { const r = app.header().querySelectorAll('.mbc-selection-readout'); return r.length ? words(r[0].textContent) : null; };
const arcIn = (svg: LiveElement, name: string) => {
  const arcs = svg.querySelectorAll('[aria-label]').filter((e) => (e.getAttribute('aria-label') ?? '').startsWith(`Select ${name} (`));
  expect(arcs, `one "${name}" feature on the map`).toHaveLength(1);
  return arcs[0];
};

async function wheelOn(app: AppHarness, svg: LiveElement, init: Record<string, unknown> = {}) {
  const scroller = svg.parentElement!;
  expect(scroller.classList.contains('plasmid-canvas-scroll'), "the map's wheel target").toBe(true);
  await React.act(async () => {
    dispatchLiveEvent(scroller, 'wheel', { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, clientX: 0, clientY: 0, ...init });
  });
  await app.settle();
}
async function panOn(app: AppHarness, svg: LiveElement, dx: number) {
  const scroller = svg.parentElement!;
  const p = { pointerId: 4, pointerType: 'mouse', isPrimary: true };
  await React.act(async () => { dispatchLiveEvent(scroller, 'pointerdown', { ...p, button: 0, buttons: 1, clientX: 100, clientY: 100 }); });
  await React.act(async () => { dispatchLiveEvent(scroller, 'pointermove', { ...p, buttons: 1, clientX: 100 + dx, clientY: 100 }); });
  await React.act(async () => { dispatchLiveEvent(scroller, 'pointerup', { ...p, clientX: 100 + dx, clientY: 100 }); });
  await app.settle();
}
/** Rotates the pane's circular map from its own rotate button and degree field. */
async function rotatePane(app: AppHarness, deg: string) {
  if (!pane(app).querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"]').length) {
    await app.click(labelled(pane(app), 'button', 'Rotate the circular map in the split pane'));
  }
  const field = pane(app).querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]');
  expect(field, "the pane's degree field").toHaveLength(1);
  await app.change(field[0], deg);
}
/** Rotates the main view's circular map from View › Rotate Circular Map…'s degree field. */
async function rotateMain(app: AppHarness, deg: string) {
  await focusMainView(app); // US-01M7DV10: View › Rotate Circular Map… acts on the focused pane
  await app.menu('view:rotate-map');
  const field = app.canvas().querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]');
  expect(field, "the main view's degree field").toHaveLength(1);
  await app.change(field[0], deg);
}
/** Opens the split and shows the main view's document in the pane from the head's button. */
async function showMainInPane(app: AppHarness) {
  if (!app.all('section.mbc-split-pane').length) await app.click(toggle(app));
  const main = mainDocName(app);
  await app.click(showMain(app));
  expect(picker(app).querySelectorAll('option').find((o) => o.getAttribute('value') === paneDocId(app))?.textContent, "the pane shows the main view's document").toBe(`${main} (main view)`);
}
const onCircles = (app: AppHarness, docs: SequenceDocument[], active: string, more: Record<string, unknown> = {}) =>
  app.restoreSession({ documents: docs, activeDocId: active, viewerTab: 'sequence-view', workspace: { mapLayoutMode: 'split', ...more } as never });
const autosavedWorkspace = (storage: LiveStorage) => {
  const raw = storage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return parseMbcWorkbench(raw!, 'Reopened').envelope.workspace;
};

/**
 * React DOM's commit notice, which it takes from a DevTools hook present when it loads: React DOM
 * loads once per test file, at the first mountApp, so the hook is installed here, as this file is
 * evaluated, before any test runs. React calls onCommitFiberRoot once per commit, after it has
 * written that commit's changes to the page, so each call sees the page as one commit left it.
 */
const commitListeners = new Set<() => void>();
(globalThis as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  isDisabled: false,
  renderers: new Map(),
  inject: () => 1,
  onCommitFiberRoot: () => { for (const listener of commitListeners) listener(); },
  onCommitFiberUnmount: () => {},
  onPostCommitFiberRoot: () => {},
};

/**
 * A MutationObserver stand-in over the live DOM (which has none), counted per React commit: after
 * each commit it reads the header readout's full text (or none) and records it when it differs from
 * the last it read. One commit writing the readout's two text nodes (the interval, then the label)
 * is one change, as no commit ends between those two writes; a second commit that rewrites the
 * readout (an echo of the selection) is a second change.
 */
function observeReadout(app: AppHarness) {
  const changes: (string | null)[] = [];
  let commits = 0;
  let last = readout(app);
  const listener = () => {
    commits += 1;
    const now = readout(app);
    if (now !== last) { changes.push(now); last = now; }
  };
  commitListeners.add(listener);
  return { changes, commits: () => commits, stop: () => { commitListeners.delete(listener); } };
}

describe("US-01M7DVQG AC1: the main view's document by a button, and the pane's view selector", () => {
  it("US-01M7DVQG AC1 the button shows the main view's document, is disabled while it does, and the picker names it (main view)", async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      await showInPane(app, CB.id);
      const before = pickerOptions(app);
      expect(before.some(([id]) => id === CA.id), 'the picker lists no option for the main view’s document').toBe(false);
      expect(showMain(app).hasAttribute('disabled'), 'the button is enabled while the pane shows Circ_B').toBe(false);
      expect(words(showMain(app).getAttribute('title') ?? '')).toBe(SHOW_MAIN);

      await app.click(showMain(app));

      expect(paneDocId(app), 'the pane shows Circ_A').toBe(CA.id);
      expect(mainDocName(app), 'the main view still shows Circ_A').toBe('Circ_A');
      expect(showMain(app).hasAttribute('disabled'), 'the button is disabled while the pane shows it').toBe(true);
      const after = pickerOptions(app);
      expect(after.filter(([id]) => id === CA.id), 'the kept option names it as the main view’s').toEqual([[CA.id, 'Circ_A (main view)']]);
      expect(after.filter(([id]) => id !== CA.id), 'the candidates are as they were').toEqual(before);

      await app.change(picker(app), CB.id);
      expect(showMain(app).hasAttribute('disabled'), 'enabled again once the pane shows another').toBe(false);
      expect(pickerOptions(app).some(([id]) => id === CA.id), 'and the main view’s option is gone').toBe(false);
    });
  });

  it('US-01M7DVQG AC1 with 401 other candidates the note still reads 400 of 401 while the pane shows the main view’s document', async () => {
    await withApp(async (app) => {
      await restore(app, sessionWithCandidates(401), MAIN.id, null);
      await app.click(toggle(app));
      await app.click(showMain(app));
      expect(paneDocId(app)).toBe(MAIN.id);
      expect(pickerNote(app)).toBe('The picker lists the first 400 of 401 documents.');
      const options = pickerOptions(app);
      expect(options, 'the 400 listed and the kept main-view option').toHaveLength(401);
      expect(options[0], 'the kept option comes first').toEqual([MAIN.id, 'Main_Doc (main view)']);
    });
  });

  it("US-01M7DVQG AC1 a document with bases offers Circular Map, Linear Map and Info, on Linear Map; its Circular Map draws its own cut sites", async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      await showInPane(app, CB.id);
      expect(viewOptions(app)).toEqual([['circular', 'Circular Map', false], ['linear', 'Linear Map', false], ['info', 'Info', false]]);
      expect(viewSelect(app).value, 'Linear Map by default').toBe('linear');
      expect(paneMaps(app), 'no circular map in Linear Map').toHaveLength(0);
      expect(pane(app).querySelectorAll('[data-row-start]').length, 'the linear view draws rows').toBeGreaterThan(0);
      expect(viewNote(app), 'no reason for a circular document').toEqual([]);

      await app.change(viewSelect(app), 'circular');
      const map = paneMap(app);
      expect(map.getAttribute('aria-label')).toBe('Circular Sequence View of Circ_B');
      expect(pane(app).querySelectorAll('[data-row-start]'), 'no linear rows in Circular Map').toHaveLength(0);
      expect(cutTitles(map).filter((t) => t.startsWith('EcoRI (GAATTC)')), "Circ_B's lone EcoRI site, from the pane's own scan").toEqual([expect.stringMatching(/^EcoRI \(GAATTC\) cuts after 3,?001 /)]);
      expect(cutTitles(mainMap(app)).filter((t) => t.startsWith('EcoRI')), 'Circ_A, in the main view, has none').toEqual([]);
      expect(cutTitles(map), "the pane draws Circ_B's sites, not Circ_A's").not.toEqual(cutTitles(mainMap(app)));

      await app.change(viewSelect(app), 'info');
      expect(paneMaps(app)).toHaveLength(0);
      expect(pane(app).querySelectorAll('[data-row-start]')).toHaveLength(0);
      expect(words(pane(app).querySelectorAll('.mbc-split-pane-body')[0].textContent), 'the Info view names the document').toContain('Circ_B');
    });
  });

  it('US-01M7DVQG AC1 Circular Map is disabled for a protein, RNA or linear document, beside the sentence View › Rotate Circular Map… gives', async () => {
    for (const doc of [PROT, RNA, LIN]) {
      await withApp(async (app) => {
        await onCircles(app, [doc, CA], doc.id);
        await app.menu('view:rotate-map');
        const refused = statusSegments(app).find((s) => s.startsWith('Rotate Circular Map: '));
        expect(refused, `${doc.name}: View › Rotate Circular Map… refuses`).toBeTruthy();
        const sentence = refused!.slice('Rotate Circular Map: '.length);
        await showMainInPane(app);
        expect(paneDocId(app)).toBe(doc.id);
        expect(viewOptions(app), `${doc.name}: Circular Map is disabled`).toEqual([['circular', 'Circular Map', true], ['linear', 'Linear Map', false], ['info', 'Info', false]]);
        expect(viewNote(app), `${doc.name}: the same sentence beside the selector`).toEqual([sentence]);
        expect(sentence).toBe(doc === PROT ? 'Circular maps are drawn for DNA only; this document is a protein.' : doc === RNA ? 'Circular maps are drawn for DNA only; this document is RNA.' : LINEAR_SENTENCE);
      });
    }
  });

  it('US-01M7DVQG AC1 trees, alignments and text documents keep their single body and get no selector', async () => {
    await withApp(async (app) => {
      expect([typeof TREE?.docMetadata?.Newick, (ALN?.alignmentMeta?.sequences?.length ?? 0) > 1]).toEqual(['string', true]);
      await onCircles(app, [CA, TEXT], CA.id);
      await app.click(toggle(app));
      for (const doc of [TREE, ALN, TEXT]) {
        await app.change(picker(app), doc.id);
        expect(paneDocId(app)).toBe(doc.id);
        expect(viewSelects(app), `${doc.name}: no view selector`).toHaveLength(0);
        expect(paneMaps(app), `${doc.name}: no circular map`).toHaveLength(0);
      }
      await app.change(picker(app), ALN.id);
      expect(pane(app).querySelectorAll('pre.mbc-split-aln-pre'), 'the alignment rows').toHaveLength(1);
      await app.change(picker(app), TEXT.id);
      expect(words(pane(app).querySelectorAll('pre.mbc-flatfile-pre')[0]?.textContent ?? '')).toBe('A note.');
    });
  });
});

describe('US-01M7DVQG AC2: the same document in both panes shares one selection', () => {
  it('US-01M7DVQG AC2 a selection in either pane is the one selection, drawn by both and read once by the header readout', async () => {
    // The readout's full text for each selection: its interval, then the clicked feature's label.
    const MARK_READOUT = '5,000..6,000 (1,001 bp) • Mark (misc_feature)';
    const OTHER_READOUT = '1,000..1,500 (501 bp) • Other (misc_feature)';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withApp(async (app) => {
        await onCircles(app, [CA, CB], CA.id);
        await showMainInPane(app);
        await app.change(viewSelect(app), 'circular');
        expect(readout(app), 'nothing selected yet').toBeNull();
        const seen = observeReadout(app);
        try {
          await app.click(arcIn(paneMap(app), 'Mark'));
          expect(seen.commits(), 'React committed the selection').toBeGreaterThan(0);
          expect(readout(app), 'the header reads the selection made in the pane, in full').toBe(MARK_READOUT);
          expect(seen.changes, 'one readout change for the selection, to the selection itself').toEqual([MARK_READOUT]);
          expect(interval(mainMap(app)), 'the main map draws it').toEqual(interval(paneMap(app)));
          expect(interval(paneMap(app)), 'the pane draws it').toHaveLength(1);
          expect(mainSelection(app), "the main view's linear map draws it").toBe('5,000..6,000');

          await app.click(arcIn(mainMap(app), 'Other'));
          expect(readout(app), 'the header reads the selection made in the main view, in full').toBe(OTHER_READOUT);
          expect(seen.changes, 'one more readout change, to that selection').toEqual([MARK_READOUT, OTHER_READOUT]);
          expect(interval(paneMap(app)), 'the pane draws the main view’s selection').toEqual(interval(mainMap(app)));
          expect(interval(paneMap(app))).toHaveLength(1);

          await wheelOn(app, paneMap(app));
          await rotatePane(app, '90');
          await wheelOn(app, mainMap(app));
          await rotateMain(app, '45');
          expect(wedge(paneMap(app)), 'the pane turned').toBe('90');
          expect(wedge(mainMap(app)), 'the main map turned').toBe('45');
          expect(seen.changes, 'rotating or zooming either pane changes the readout zero times').toHaveLength(2);

          await app.change(viewSelect(app), 'linear');
          expect(paneSelection(app), "the pane's Linear Map draws the shared selection").toBe('1,000..1,500');
          expect(seen.changes, 'and changing the view does not change it either').toHaveLength(2);
        } finally {
          seen.stop();
        }
      });
      const logged = errors.mock.calls.map((c) => String(c[0]));
      expect(logged.filter((m) => /Maximum update depth exceeded/.test(m)), 'no update loop').toEqual([]);
      expect(logged, 'no console error').toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("US-01M7DVQG AC3: the pane's zoom, pan and rotation are its own", () => {
  it("US-01M7DVQG AC3 wheel and pinch zoom, pan and rotation in the pane change only the pane, and the reverse", async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await onCircles(app, [CA, CB], CA.id);
      await showMainInPane(app);
      await app.change(viewSelect(app), 'circular');
      const main = () => ({ zoom: headerZoom(app), viewport: viewport(mainMap(app)), wedge: wedge(mainMap(app)) });
      const mainBefore = main();
      expect(mainBefore).toEqual({ zoom: '100%', viewport: null, wedge: '0' });

      await wheelOn(app, paneMap(app));
      const wheeled = scaleOf(paneMap(app));
      expect(wheeled, 'the wheel zoomed the pane').toBeGreaterThan(1);
      await wheelOn(app, paneMap(app), { ctrlKey: true, deltaY: -20 });
      expect(scaleOf(paneMap(app)), 'the pinch zoomed the pane further').toBeGreaterThan(wheeled);
      const zoomed = viewport(paneMap(app));
      await panOn(app, paneMap(app), 60);
      expect(viewport(paneMap(app)), 'the drag panned the pane').not.toBe(zoomed);
      await rotatePane(app, '90');
      expect(wedge(paneMap(app))).toBe('90');
      await focusMainView(app); // US-01M7DV10: the header's % reads the focused pane's zoom
      expect(main(), "the main view's zoom, pan and rotation are unchanged").toEqual(mainBefore);
      await autosaveRunsOut(app);
      const ws = autosavedWorkspace(storage);
      expect(ws.zoomLevel, 'workspace.zoomLevel is the main view’s').toBe(100);
      expect(ws.mapRotation ?? {}, 'workspace.mapRotation is the main view’s').toEqual({});
      expect(ws.documentSplit, 'the pane’s rotation is saved with the split, its zoom is not').toEqual({ orientation: 'side-by-side', docId: CA.id, docName: 'Circ_A', view: 'circular', rotation: 90 });

      const paneBefore = { viewport: viewport(paneMap(app)), wedge: wedge(paneMap(app)) };
      await wheelOn(app, mainMap(app));
      expect(headerZoom(app), 'the main wheel moves the header %').not.toBe('100%');
      await panOn(app, mainMap(app), -40);
      await rotateMain(app, '45');
      expect(wedge(mainMap(app))).toBe('45');
      expect({ viewport: viewport(paneMap(app)), wedge: wedge(paneMap(app)) }, 'the pane is unchanged').toEqual(paneBefore);
    } finally {
      app.unmount();
    }
  });

  it("US-01M7DVQG AC3 a document opened in the pane starts at the main view's rotation for it and keeps the pane's zoom", async () => {
    await withApp(async (app) => {
      // Lin_Doc is the split's first document, so Circ_B comes by the picker.
      await onCircles(app, [CA, LIN, CB], CA.id, { mapRotation: { [CA.id]: 30, [CB.id]: 120 } });
      expect(wedge(mainMap(app))).toBe('30');
      await app.click(toggle(app));
      expect(paneDocId(app)).toBe(LIN.id);
      await app.change(picker(app), CB.id);
      await app.change(viewSelect(app), 'circular');
      expect(wedge(paneMap(app)), 'by the picker: Circ_B at its 120').toBe('120');
      await wheelOn(app, paneMap(app));
      const zoom = scaleOf(paneMap(app));
      expect(zoom).toBeGreaterThan(1);
      await rotatePane(app, '200');
      await app.click(showMain(app));
      expect(wedge(paneMap(app)), "by the button: Circ_A at the main view's 30").toBe('30');
      expect(scaleOf(paneMap(app)), "the pane's zoom is kept").toBe(zoom);
      await app.change(picker(app), CB.id);
      expect(wedge(paneMap(app)), 'Circ_B again at its 120, not the 200 the pane last had').toBe('120');
      expect(wedge(mainMap(app)), 'the main view is unchanged').toBe('30');
      await focusMainView(app); // US-01M7DV10: the header's % reads the focused pane's zoom
      expect(headerZoom(app)).toBe('100%');
    });
  });

  it("US-01M7DVQG AC3 the split's first document, chosen by the split itself, starts at the main view's rotation for it", async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id, { mapRotation: { [CB.id]: 120 } });
      expect(wedge(mainMap(app))).toBe('0');
      await app.click(toggle(app));
      expect(paneDocId(app), 'the split opens on Circ_B, its first other document').toBe(CB.id);
      await app.change(viewSelect(app), 'circular');
      expect(wedge(paneMap(app)), 'Circ_B at its 120, as the picker would open it').toBe('120');
      expect(wedge(mainMap(app)), 'the main view is unchanged').toBe('0');
    });
  });

  it('US-01M7DVQG AC3 swap exchanges the zoom and rotation, so each moves with its document; the divider stays', async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id, { mapRotation: { [CA.id]: 30 } });
      await app.menu('view:zoom-in');
      const mainZoom = headerZoom(app);
      expect(mainZoom).toBe('110%');
      await showInPane(app, CB.id);
      await app.change(viewSelect(app), 'circular');
      await rotatePane(app, '90');
      await wheelOn(app, paneMap(app));
      const paneScale = scaleOf(paneMap(app));
      expect(paneScale).toBeGreaterThan(1);
      const divider = valueNow(app);

      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));

      expect(mainDocName(app)).toBe('Circ_B');
      expect(wedge(mainMap(app)), "Circ_B's 90 came with it").toBe('90');
      await focusMainView(app); // US-01M7DV10: Swap was pressed in the pane, so the pane is focused
      expect(headerZoom(app), "the main view takes the pane's zoom").toBe(`${Math.round(paneScale * 100)}%`);
      expect(paneDocId(app)).toBe(CA.id);
      expect(wedge(paneMap(app)), "Circ_A's 30 came with it").toBe('30');
      expect(scaleOf(paneMap(app)), "the pane takes the main view's zoom").toBeCloseTo(1.1, 4);
      expect(valueNow(app), 'the divider stays').toBe(divider);
    });
  });

  it('US-01M7DVQG AC3 with the same document in both panes, swap exchanges only the zoom and rotation', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await onCircles(app, [CA, CB], CA.id, { mapRotation: { [CA.id]: 30 }, navHistory: [CA.id, CB.id], selectedRange: { start: 100, end: 200, label: 'Selection' } });
      await app.menu('view:zoom-in');
      await showMainInPane(app);
      await app.change(viewSelect(app), 'circular');
      await rotatePane(app, '90');
      await wheelOn(app, paneMap(app));
      const paneScale = scaleOf(paneMap(app));
      await autosaveRunsOut(app);
      const before = autosavedWorkspace(storage);
      expect(before.navHistory, 'a history with a step forward').toEqual([CA.id, CB.id]);
      expect(before.navIndex).toBe(0);
      const tab = app.activeTab();

      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));
      await autosaveRunsOut(app);

      expect(wedge(mainMap(app)), "the main view takes the pane's 90").toBe('90');
      expect(wedge(paneMap(app)), "the pane takes the main view's 30").toBe('30');
      await focusMainView(app); // US-01M7DV10: Swap was pressed in the pane, so the pane is focused
      expect(headerZoom(app)).toBe(`${Math.round(paneScale * 100)}%`);
      expect(scaleOf(paneMap(app))).toBeCloseTo(1.1, 4);
      const after = autosavedWorkspace(storage);
      expect({ doc: mainDocName(app), pane: paneDocId(app), tab: app.activeTab(), active: after.activeDocId, selection: after.selectedRange, history: after.navHistory, index: after.navIndex },
        "the main view's document, tab, selection and history are as they were")
        .toEqual({ doc: 'Circ_A', pane: CA.id, tab, active: before.activeDocId, selection: before.selectedRange, history: before.navHistory, index: before.navIndex });
      expect(after.mapRotation).toEqual({ [CA.id]: 90 });
    } finally {
      app.unmount();
    }
  });

  it("US-01M7DVQG AC3 Single Pane keeps the pane's view, zoom and rotation; a restored pane opens at 100%", async () => {
    const storage = memoryStorage();
    const first = await mountApp({ storage });
    try {
      await onCircles(first, [CA, CB], CA.id);
      await showInPane(first, CB.id);
      await first.change(viewSelect(first), 'circular');
      await rotatePane(first, '90');
      await wheelOn(first, paneMap(first));
      const scale = scaleOf(paneMap(first));
      await first.click(toggle(first));
      expect(paneCount(first)).toBe(0);
      await first.click(toggle(first));
      expect({ view: viewSelect(first).value, wedge: wedge(paneMap(first)), scale: scaleOf(paneMap(first)) }, 'kept through Single Pane')
        .toEqual({ view: 'circular', wedge: '90', scale });
      await autosaveRunsOut(first);
    } finally {
      first.unmount();
    }
    const second = await mountApp({ storage });
    try {
      await second.menu('file:restore-autosave');
      await second.settle();
      expect(paneDocId(second)).toBe(CB.id);
      expect({ view: viewSelect(second).value, wedge: wedge(paneMap(second)), scale: scaleOf(paneMap(second)) }, 'the view and rotation come back, the zoom at 100%')
        .toEqual({ view: 'circular', wedge: '90', scale: 1 });
      // In the same window too: a pane zoomed before a restore opens at 100%.
      await wheelOn(second, paneMap(second));
      expect(scaleOf(paneMap(second))).toBeGreaterThan(1);
      await second.menu('file:restore-autosave');
      await second.settle();
      expect(scaleOf(paneMap(second)), 'the restored pane opens at 100%').toBe(1);
      expect(headerZoom(second), "and the main view's zoom is the session's").toBe('100%');
    } finally {
      second.unmount();
    }
  });
});

describe('US-01M7DVQG AC4: different documents keep their own selections', () => {
  it("US-01M7DVQG AC4 a selection on B leaves A's as it was, a selection on A leaves B's, and no link control is offered", async () => {
    for (const mainRange of [{ start: 100, end: 200 }, null]) {
      await withApp(async (app) => {
        await restore(app, [DOC_A, DOC_B], DOC_A.id, mainRange);
        await showInPane(app, DOC_B.id);
        await selectMarkInPane(app);
        expect(mainSelection(app), "A's main selection is as it was").toBe(mainRange ? '100..200' : null);
        expect(readout(app) === null, 'the header readout is as it was').toBe(mainRange === null);
      });
    }
    await withApp(async (app) => {
      await restore(app, [DOC_A, DOC_B], DOC_A.id, null);
      await showInPane(app, DOC_B.id);
      const mainArcs = app.canvas().querySelectorAll('g.clickable-arc');
      expect(mainArcs, "the main view's Mark arc").toHaveLength(1);
      await app.click(mainArcs[0]);
      expect(mainSelection(app)).toBe('5,000..6,000');
      expect(paneSelection(app), "B's pane selection is as it was: none").toBeNull();
      const named = pane(app).querySelectorAll('button, select, input, [role="button"], [role="checkbox"], [role="switch"]')
        .map((c) => `${c.getAttribute('aria-label') ?? ''} ${c.getAttribute('title') ?? ''} ${words(c.textContent)}`);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((n) => /link/i.test(n)), 'no link control in the pane').toEqual([]);
    });
  });
});

describe('US-01M7DVQG AC5: edits in either pane reach the other at once', () => {
  const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  const rc = (s: string) => Array.from(s).reverse().map((b) => COMP[b]).join('');
  const firstRow = (app: AppHarness) => (pane(app).querySelectorAll('[data-row-start="1"]')[0]?.textContent ?? '').replace(/[^ACGT]/g, '');

  it('US-01M7DVQG AC5 Reverse Complement in the main view shows the new sequence in both of the pane’s maps', async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      await showMainInPane(app);
      expect(firstRow(app), "the pane's linear map reads Circ_A's bases").toContain(CA.sequence.slice(6, 60));
      await app.change(viewSelect(app), 'circular');
      expect(arcIn(paneMap(app), 'Mark').getAttribute('aria-label')).toContain('5000 to 6000');

      await app.menu('sequence:reverse-complement');

      expect(arcIn(paneMap(app), 'Mark').getAttribute('aria-label'), "the pane's circular map draws the reverse complement's Mark").toContain('1201 to 2201');
      expect(arcIn(mainMap(app), 'Mark').getAttribute('aria-label')).toContain('1201 to 2201');
      await app.change(viewSelect(app), 'linear');
      const reversed = rc(CA.sequence);
      expect(firstRow(app), "the pane's linear map reads the new bases").toContain(reversed.slice(6, 60));
      expect(firstRow(app)).not.toContain(CA.sequence.slice(6, 60));
    });
  });

  it("US-01M7DVQG AC5 a feature added from the pane's Linear Map appears in the main view at once", async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      await showMainInPane(app);
      const arcs = pane(app).querySelectorAll('g.clickable-arc').filter((g) => words(g.textContent).includes('Other') || (g.getAttribute('aria-label') ?? '').includes('Other'));
      expect(arcs.length, "the pane's Other arc").toBeGreaterThan(0);
      await app.click(arcs[0]);
      expect(paneSelection(app)).toBe('1,000..1,500');
      // With no layout the quickbar fits no action inline: + Annotate is in its More menu.
      const annotateIn = () => app.all('button').filter((b) => words(b.textContent) === '+ Annotate');
      if (!annotateIn().length) {
        const more = pane(app).querySelectorAll('button').filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('More selection actions'));
        expect(more, "the pane's quickbar More menu").toHaveLength(1);
        await app.click(more[0]);
      }
      const annotate = annotateIn();
      expect(annotate, "the pane's + Annotate").toHaveLength(1);
      await app.click(annotate[0]);
      const form = pane(app).querySelectorAll('form.add-feature-drawer');
      expect(form).toHaveLength(1);
      await app.change(form[0].querySelectorAll('input[placeholder="Name"]')[0], 'Pane_Added');
      await app.click(form[0].querySelectorAll('button[type="submit"]')[0]);
      expect(arcIn(mainMap(app), 'Pane_Added').getAttribute('aria-label'), "the main view's annotations hold it").toContain('1000 to 1500');
    });
  });

  it('US-01M7DVQG AC5 a document turned linear, chosen or swapped in while the pane is in Circular Map opens in Linear Map, and that is saved', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      const refusedLinear = (what: string) => {
        expect(viewSelect(app).value, `${what}: Linear Map`).toBe('linear');
        expect(paneMaps(app), `${what}: no circle`).toHaveLength(0);
        expect(viewOptions(app)[0], `${what}: Circular Map disabled`).toEqual(['circular', 'Circular Map', true]);
      };
      await onCircles(app, [CA, CB, LIN, PROT], CA.id);
      await showMainInPane(app);
      await app.change(viewSelect(app), 'circular');
      await app.menu('sequence:toggle-topology');
      refusedLinear('turned linear');
      expect(viewNote(app)).toEqual([LINEAR_SENTENCE]);
      await autosaveRunsOut(app);
      expect(autosavedWorkspace(storage).documentSplit, 'Linear Map is what is saved').toEqual({ orientation: 'side-by-side', docId: CA.id, docName: 'Circ_A' });

      await app.change(picker(app), CB.id);
      await app.change(viewSelect(app), 'circular');
      await app.change(picker(app), PROT.id);
      refusedLinear('a protein chosen');
      expect(viewNote(app)).toEqual(['Circular maps are drawn for DNA only; this document is a protein.']);

      await app.change(picker(app), CB.id);
      await app.change(viewSelect(app), 'circular');
      await app.click(app.all('button.mbc-doc-tab-trigger').find((b) => words(b.querySelectorAll('.mbc-doc-tab-title')[0]?.textContent ?? '') === 'Circ_A')!);
      expect(mainDocName(app)).toBe('Circ_A');
      // Circ_A is linear now: swapped into the pane, it opens in Linear Map.
      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));
      expect(paneDocId(app)).toBe(CA.id);
      refusedLinear('a linear document swapped in');
      await autosaveRunsOut(app);
      expect(autosavedWorkspace(storage).documentSplit?.view, 'nothing but Linear Map is saved').toBeUndefined();
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M7DVQG AC6: the pane\'s view and rotation are saved with its document', () => {
  it('US-01M7DVQG AC6 each is saved only while it is not the default, and changing only one autosaves it', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await onCircles(app, [CA, CB], CA.id);
      await showInPane(app, CB.id);
      await autosaveRunsOut(app);
      const plain = { orientation: 'side-by-side', docId: CB.id, docName: 'Circ_B' };
      expect(autosavedSplit(storage), 'a split that never used them saves what it saved before').toEqual(plain);
      let last = storage.getItem(AUTOSAVE_KEY);
      const step = async (what: string, run: () => Promise<void>, saved: Record<string, unknown>) => {
        await run();
        await autosaveRunsOut(app);
        expect(storage.getItem(AUTOSAVE_KEY), `${what} alone is autosaved`).not.toBe(last);
        last = storage.getItem(AUTOSAVE_KEY);
        expect(autosavedSplit(storage), what).toEqual({ ...plain, ...saved });
      };
      await step('the view', () => app.change(viewSelect(app), 'info'), { view: 'info' });
      await step('the view again', () => app.change(viewSelect(app), 'circular'), { view: 'circular' });
      await step('the rotation', () => rotatePane(app, '90'), { view: 'circular', rotation: 90 });
      await step('the rotation back to 0', () => rotatePane(app, '360'), { view: 'circular' });
      await step('the view back to Linear Map', () => app.change(viewSelect(app), 'linear'), {});
    } finally {
      app.unmount();
    }
  });

  const restoreView = (app: AppHarness, documentSplit: unknown, sessionName: string) => app.restoreSession({
    documents: [CA, CB, LIN], activeDocId: CA.id, viewerTab: 'sequence-view', sessionName,
    workspace: { mapLayoutMode: 'split', documentSplit: documentSplit as never },
  });
  const splitNotices = (app: AppHarness) => statusSegments(app).filter((s) => /split pane|Linear Map|0 degrees|Single Pane|document split/i.test(s));

  it('US-01M7DVQG AC6 restores them through the App and the codec, normalised; absent ones open Linear Map at 0 with no message', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await restoreView(app, { orientation: 'side-by-side', docId: CB.id, docName: 'Circ_B', view: 'circular', rotation: 450 }, 'View_Saved');
      expect(layout(app)).toEqual({ host: SIDE, pane: CB.id });
      expect({ view: viewSelect(app).value, wedge: wedge(paneMap(app)) }, '450 opens at 90').toEqual({ view: 'circular', wedge: '90' });
      expect(splitNotices(app)).toEqual([]);
      await app.click(labelled(pane(app), 'button', 'Rotate the circular map in the split pane'));
      const field = pane(app).querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]');
      expect(field.map((f) => f.value), "the pane's degree field reads 90, not 450").toEqual(['90']);
      await app.change(viewSelect(app), 'info');
      await app.change(viewSelect(app), 'circular');
      await autosaveRunsOut(app);
      expect(autosavedSplit(storage), 'held as 90, not 450').toEqual({ orientation: 'side-by-side', docId: CB.id, docName: 'Circ_B', view: 'circular', rotation: 90 });
      await restoreView(app, { orientation: 'side-by-side', docId: CB.id, docName: 'Circ_B', view: 'info' }, 'View_Info');
      expect(viewSelect(app).value).toBe('info');
      await restoreView(app, { orientation: 'top-bottom', docId: CB.id, docName: 'Circ_B' }, 'View_Absent');
      expect(layout(app)).toEqual({ host: STACK, pane: CB.id });
      expect(viewSelect(app).value, 'absent: Linear Map').toBe('linear');
      await app.change(viewSelect(app), 'circular');
      expect(wedge(paneMap(app)), 'absent: 0 degrees').toBe('0');
      expect(splitNotices(app)).toEqual([]);
      // A saved document that is gone: the view and rotation are not read, and only its notice is shown.
      await restoreView(app, { orientation: 'side-by-side', docId: 'gone', docName: 'Gone_Doc', view: 'nonsense', rotation: 'x' }, 'View_Gone');
      expect(layout(app)).toEqual({ host: SINGLE, pane: null });
      expect(splitNotices(app)).toEqual([missing('Gone_Doc')]);
    } finally {
      app.unmount();
    }
  });

  it('US-01M7DVQG AC6 an unreadable view or rotation opens Linear Map or 0 degrees, saying so exactly, and changes nothing else', async () => {
    const cases: [string, Record<string, unknown>, string, string, string][] = [
      ['a view not one of the three', { docId: CB.id, docName: 'Circ_B', view: 'diagonal' }, CB.id, 'linear', VIEW_NOTICE],
      ['a null view', { docId: CB.id, docName: 'Circ_B', view: null }, CB.id, 'linear', VIEW_NOTICE],
      ['Circular Map for a linear document', { docId: LIN.id, docName: 'Lin_Doc', view: 'circular' }, LIN.id, 'linear', VIEW_NOTICE],
      ['a rotation that is not a number', { docId: CB.id, docName: 'Circ_B', view: 'circular', rotation: 'x' }, CB.id, 'circular', rotationNotice('Circ_B')],
      ['a null rotation', { docId: CB.id, docName: 'Circ_B', view: 'circular', rotation: null }, CB.id, 'circular', rotationNotice('Circ_B')],
    ];
    await withApp(async (app) => {
      let n = 0;
      for (const [what, saved, docId, view, notice] of cases) {
        await restoreView(app, { orientation: 'top-bottom', ratio: 0.3, ...saved }, `View_Bad_${++n}`);
        expect(layout(app), `${what}: the orientation and document as saved`).toEqual({ host: STACK, pane: docId });
        expect(valueNow(app), `${what}: the divider as saved`).toBe(30);
        expect(viewSelect(app).value, `${what}: the view`).toBe(view);
        if (view === 'circular') expect(wedge(paneMap(app)), `${what}: 0 degrees`).toBe('0');
        expect(splitNotices(app), `${what}: the one notice`).toEqual([notice]);
      }
    });
  });
});

// ─── US-01M7DV10: the focused pane, and the View commands and figure export that act on it ───
//
// Through the mounted App. A pointer down or focus is dispatched on its own where a click would also
// run the control: the harness fires no focus events, so keyboard focus is a focusin dispatched on the
// element, as the browser fires when Tab lands on it.

const FOCUS_CLASS = 'is-focused-pane';
const NO_CIRCLE = 'The focused split pane shows no circular map.';
const paneBody = (app: AppHarness) => pane(app).querySelectorAll('.mbc-split-pane-body')[0];

/** Which pane carries the focus markers ('main', 'second', both joined by '+', or 'none'); aria-current only ever 'true', and only with the class. */
function focusedPaneOf(app: AppHarness): string {
  const panes: [string, LiveElement][] = [['main', app.canvas()], ...app.all('section.mbc-split-pane').map((p): [string, LiveElement] => ['second', p])];
  const marked = panes.filter(([name, el]) => {
    const has = el.classList.contains(FOCUS_CLASS);
    expect(el.getAttribute('aria-current'), `${name}: aria-current is "true" with the class and absent without it, never "false"`).toBe(has ? 'true' : null);
    return has;
  });
  return marked.length ? marked.map(([n]) => n).join('+') : 'none';
}
/** A primary pointer down and up on `el` alone, with no click. */
async function pointerDown(app: AppHarness, el: LiveElement) {
  const p = { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 0, clientY: 0 };
  await React.act(async () => { dispatchLiveEvent(el, 'pointerdown', { ...p, buttons: 1 }); });
  await React.act(async () => { dispatchLiveEvent(el, 'pointerup', { ...p, buttons: 0 }); });
  await app.settle();
}
/** Keyboard focus landing on `el`: the focusin a browser fires (the harness fires none). */
async function focusIn(app: AppHarness, el: LiveElement) {
  el.focus();
  await React.act(async () => { dispatchLiveEvent(el, 'focusin', {}); });
  await app.settle();
}
/** Focuses the main view by a pointer down on its canvas. */
async function focusMainView(app: AppHarness) {
  await pointerDown(app, app.canvas());
}
/** The label a menu row shows (its shortcut apart). */
const rowLabel = (b: LiveElement) => menuWords(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent);
/** Opens the top menu `top`, then each submenu on `path`, and returns the last row. */
async function menuRow(app: AppHarness, top: string, path: string[]): Promise<LiveElement> {
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => menuWords(b.getAttribute('aria-label') ?? b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  let row: LiveElement | undefined;
  for (const label of path) {
    row = menuButtons(app).find((b) => rowLabel(b) === label);
    if (!row) throw new Error(`no "${label}" in the open menu: ${menuButtons(app).map(rowLabel).join(' | ')}`);
    if (label !== path[path.length - 1]) await app.click(row);
  }
  return row!;
}
/** Clicks View › `path` (which must be enabled). */
async function viewCommand(app: AppHarness, path: string[]) {
  const row = await menuRow(app, 'View', path);
  expect(row.hasAttribute('disabled'), `View › ${path.join(' › ')} is enabled`).toBe(false);
  await app.click(row);
  await closeMenus(app);
}
/** Whether each View row on its path is disabled. */
async function viewRowsDisabled(app: AppHarness, paths: string[][]): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const path of paths) {
    out.push((await menuRow(app, 'View', path)).hasAttribute('disabled'));
    await closeMenus(app);
  }
  return out;
}
/** The Function Info the menu shows on hover for `top` › `path`. */
async function functionInfo(app: AppHarness, top: string, path: string[]): Promise<string> {
  const row = await menuRow(app, top, path);
  await React.act(async () => { dispatchLiveEvent(row, 'pointerover', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); });
  await app.settle();
  const tips = app.all('[role="tooltip"]').map((t) => words(t.textContent));
  await closeMenus(app);
  expect(tips, `one Function Info for ${path.join(' › ')}`).toHaveLength(1);
  return tips[0];
}
const ZOOM_ROWS = [['Zoom', 'Zoom In'], ['Zoom', 'Zoom Out'], ['Zoom', 'Actual Size (100%)'], ['Rotate Circular Map…'], ['Reset Rotation']];
const MAP_IDS: [string, string][] = [
  ['view:zoom-in', 'Zoom In'], ['view:zoom-out', 'Zoom Out'], ['view:zoom-reset', 'Actual Size'],
  ['view:rotate-map', 'Rotate Circular Map'], ['view:reset-rotation', 'Reset Rotation'],
];
const headerZoomButtons = (app: AppHarness) => [
  labelled(app.header(), 'button', 'Zoom Out'),
  app.header().querySelectorAll('button.zoom-pct-btn')[0],
  labelled(app.header(), 'button', 'Zoom In'),
];
const rotateDialogs = (scope: LiveElement) => scope.querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"]');
/** Sets the pane's rotate control's degree field, the control already open. */
async function paneDegrees(app: AppHarness, deg: string) {
  const field = pane(app).querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]');
  expect(field, "the pane's degree field").toHaveLength(1);
  await app.change(field[0], deg);
}
async function closePaneRotate(app: AppHarness) {
  const close = rotateDialogs(pane(app))[0].querySelectorAll('button').filter((b) => menuWords(b.getAttribute('aria-label') ?? b.textContent) === 'Close');
  expect(close, "the pane's rotate control's Close").toHaveLength(1);
  await app.click(close[0]);
  expect(rotateDialogs(pane(app))).toHaveLength(0);
}
/** Exports the circular map in `scope` as SVG from its FigureExportButton: the file's name and its origin wedge's angle. */
async function exportMapSvg(app: AppHarness, scope: LiveElement): Promise<{ filename: string; wedge: string | null }> {
  const triggers = scope.querySelectorAll('.circular-hud-actions .mbc-figure-export-trigger');
  expect(triggers, "the map's one figure export").toHaveLength(1);
  await app.click(triggers[0]);
  const items = scope.querySelectorAll('.circular-hud-actions .mbc-figure-export-item').filter((b) => words(b.textContent).startsWith('SVG'));
  expect(items, 'the figure menu offers SVG').toHaveLength(1);
  const before = app.downloads().length;
  await app.click(items[0]);
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.svg'));
  expect(files, 'one .svg saved').toHaveLength(1);
  const text = await files[0].text();
  const tags = text.match(/<[^>]*data-map-part="origin-wedge"[^>]*>/g) ?? [];
  expect(tags, 'the file draws one origin wedge').toHaveLength(1);
  return { filename: files[0].filename, wedge: /data-draw-angle="([^"]*)"/.exec(tags[0] ?? '')?.[1] ?? null };
}
/** The sequence of each document the App's autosave holds. */
const autosavedSequences = (storage: LiveStorage) => {
  const raw = storage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return Object.fromEntries(parseMbcWorkbench(raw!, 'Reopened').envelope.documents.map((d) => [d.id, d.sequence ?? '']));
};
/** Opens the split on Circ_A with Circ_B in the pane on Circular Map, and focuses the pane. */
async function paneOnCircle(app: AppHarness, more: Record<string, unknown> = {}) {
  await onCircles(app, [CA, CB], CA.id, more);
  await showInPane(app, CB.id);
  await app.change(viewSelect(app), 'circular');
  await pointerDown(app, paneBody(app));
  expect(focusedPaneOf(app), 'the pane is focused').toBe('second');
}

describe('US-01M7DV10 AC1: exactly one pane has focus while the split is shown, and it is marked', () => {
  it('US-01M7DV10 AC1 the split opens on the main pane; a pointer down or focus inside a pane takes focus, and nothing outside both moves it', async () => {
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      expect(focusedPaneOf(app), 'Single Pane marks no pane').toBe('none');
      await app.click(toggle(app));
      expect(focusedPaneOf(app), 'the split opens with the main pane focused').toBe('main');
      const view = { window: 1280, height: 800, canvas: 900 };
      const outlined = (el: LiveElement) => cascaded(el, 'outline-style', view) ?? 'none';
      expect([outlined(app.canvas()), outlined(pane(app))], 'App.css outlines the focused pane only').toEqual(['solid', 'none']);

      await pointerDown(app, paneBody(app));
      expect(focusedPaneOf(app), 'a pointer down in the pane').toBe('second');
      expect([outlined(app.canvas()), outlined(pane(app))]).toEqual(['none', 'solid']);

      const inspector = app.inspectorAside();
      expect(inspector, 'the inspector column is shown').not.toBeNull();
      const outside: [string, () => LiveElement][] = [
        ['the header', () => app.header()],
        ["the header's Zoom In", () => labelled(app.header(), 'button', 'Zoom In')],
        ["the header's %", () => app.header().querySelectorAll('button.zoom-pct-btn')[0]],
        ['the divider', () => divider(app)],
        ['the inspector', () => app.inspectorAside()!.querySelectorAll('button')[0] ?? app.inspectorAside()!],
        ['the menu bar', () => app.one('.mbc-menubar')],
      ];
      for (const focused of ['second', 'main'] as const) {
        for (const [what, el] of outside) {
          await pointerDown(app, el());
          expect(focusedPaneOf(app), `a pointer down on ${what} leaves the ${focused} pane focused`).toBe(focused);
          await focusIn(app, el());
          expect(focusedPaneOf(app), `focus on ${what} leaves the ${focused} pane focused`).toBe(focused);
        }
        const viewMenu = await menuRow(app, 'View', ['Zoom', 'Zoom In']);
        await pointerDown(app, viewMenu);
        await closeMenus(app);
        expect(focusedPaneOf(app), `the View menu leaves the ${focused} pane focused`).toBe(focused);
        if (focused === 'second') {
          await focusIn(app, mainMap(app));
          expect(focusedPaneOf(app), 'keyboard focus inside the main view').toBe('main');
        }
      }
      await focusIn(app, picker(app));
      expect(focusedPaneOf(app), "keyboard focus on the pane's picker").toBe('second');
      await pointerDown(app, mainMap(app));
      expect(focusedPaneOf(app), "a pointer down on the main view's map").toBe('main');
      await pointerDown(app, paneBody(app));
      expect(focusedPaneOf(app)).toBe('second');
      await focusMainView(app);
      expect(focusedPaneOf(app), 'a pointer down on the main view').toBe('main');
    });
  });

  it('US-01M7DV10 AC1 folding the focused pane hands focus to the other and restoring keeps it there; Swap leaves it; Single Pane clears it and the next split opens on the main pane', async () => {
    await withSizedApp(async (app) => {
      await restore(app, [MAIN, DOC_A, DOC_B], MAIN.id, null);
      await showInPane(app, DOC_A.id);
      expect(focusedPaneOf(app)).toBe('main');

      await pressOnDivider(app, 'End');
      expect(restoreButtons(app)).toEqual(['Restore the split pane']);
      expect(focusedPaneOf(app), 'folding the other pane leaves focus').toBe('main');
      await clickRestore(app, 'Restore the split pane');
      expect(focusedPaneOf(app)).toBe('main');

      await pressOnDivider(app, 'Home');
      expect(restoreButtons(app)).toEqual(['Restore the main view']);
      expect(focusedPaneOf(app), 'Home folds the focused main view: focus goes to the pane').toBe('second');
      await clickRestore(app, 'Restore the main view');
      expect(focusedPaneOf(app), 'restoring the main view does not take focus back').toBe('second');

      await pressOnDivider(app, 'End');
      expect(focusedPaneOf(app), 'End folds the focused pane: focus goes to the main view').toBe('main');
      await clickRestore(app, 'Restore the split pane');
      expect(focusedPaneOf(app), 'restoring the pane does not take focus back').toBe('main');

      await pointerDown(app, paneBody(app));
      expect(focusedPaneOf(app)).toBe('second');
      await dragDivider(app, { x: HOST_W - 20, y: 10 });
      expect(restoreButtons(app), 'the drag folded the pane').toEqual(['Restore the split pane']);
      expect(focusedPaneOf(app), 'a drag that folds the focused pane hands focus to the main view').toBe('main');
      await app.click(app.one('.mbc-split-host > button[aria-label="Restore the split pane"]'));
      expect(focusedPaneOf(app)).toBe('main');

      await pointerDown(app, paneBody(app));
      await app.click(labelled(pane(app), 'button', 'Swap with the main view'));
      expect(mainDocName(app), 'the documents swapped').toBe('Doc_A');
      expect(focusedPaneOf(app), 'Swap leaves focus on the pane').toBe('second');
      await focusMainView(app);
      await React.act(async () => { dispatchLiveEvent(labelled(pane(app), 'button', 'Swap with the main view'), 'click', { button: 0 }); });
      await app.settle();
      expect(mainDocName(app), 'swapped back').toBe('Main_Doc');
      expect(focusedPaneOf(app), 'Swap leaves focus on the main view').toBe('main');

      await pointerDown(app, paneBody(app));
      await app.click(toggle(app));
      expect(paneCount(app), 'Single Pane').toBe(0);
      expect(focusedPaneOf(app), 'Single Pane marks no pane').toBe('none');
      await app.click(toggle(app));
      expect(focusedPaneOf(app), 'the next split opens on the main pane').toBe('main');
      await pointerDown(app, paneBody(app));
      await app.change(chooser(app), 'single');
      await app.change(chooser(app), 'top-bottom');
      expect(focusedPaneOf(app), 'and by the chooser too').toBe('main');

      // A restored split opens on the main pane, even when the pane had focus before the restore.
      await pointerDown(app, paneBody(app));
      expect(focusedPaneOf(app), 'the pane is focused before the restore').toBe('second');
      await restoreWithSplit(app, { orientation: 'side-by-side', docId: DOC_B.id, docName: 'Doc_B' }, 'Focus_Restored');
      expect(paneCount(app), 'the restored session shows the split').toBe(1);
      expect(chooser(app).value, 'side by side, as saved').toBe('side-by-side');
      expect(focusedPaneOf(app), 'a restored split opens with the main pane focused').toBe('main');
    });
  });
});

describe('US-01M7DV10 AC2: View › Zoom and Rotate act on the focused pane', () => {
  it("US-01M7DV10 AC2 with the pane focused every route zooms and turns the pane's map only, and the header reads its zoom", async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await paneOnCircle(app);
      const mainBefore = { wedge: wedge(mainMap(app)), viewport: viewport(mainMap(app)), tab: app.activeTab() };
      expect(mainBefore).toEqual({ wedge: '0', viewport: null, tab: 'sequence-view' });
      const zoomIn = () => app.menu('view:zoom-in');
      const routes: [string, () => Promise<void>, number][] = [
        ['native view:zoom-in', zoomIn, 110],
        ['View › Zoom › Zoom In', () => viewCommand(app, ['Zoom', 'Zoom In']), 120],
        ['Ctrl+=', () => app.press('=', { mod: true }), 130],
        ["the header's +", () => app.click(headerZoomButtons(app)[2]), 140],
        ['native view:zoom-out', () => app.menu('view:zoom-out'), 130],
        ['View › Zoom › Zoom Out', () => viewCommand(app, ['Zoom', 'Zoom Out']), 120],
        ['Ctrl+-', () => app.press('-', { mod: true }), 110],
        ["the header's −", () => app.click(headerZoomButtons(app)[0]), 100],
        ['native view:zoom-in', zoomIn, 110],
        ['native view:zoom-in', zoomIn, 120], // from 120%, Actual Size and Zoom Out part: 100% against 110%
        ['native view:zoom-reset', () => app.menu('view:zoom-reset'), 100],
        ['native view:zoom-in', zoomIn, 110],
        ['native view:zoom-in', zoomIn, 120], // from 120%, Actual Size and Zoom Out part: 100% against 110%
        ['View › Zoom › Actual Size (100%)', () => viewCommand(app, ['Zoom', 'Actual Size (100%)']), 100],
        ['native view:zoom-in', zoomIn, 110],
        ['native view:zoom-in', zoomIn, 120], // from 120%, Actual Size and Zoom Out part: 100% against 110%
        ['Ctrl+0', () => app.press('0', { mod: true }), 100],
        ['native view:zoom-in', zoomIn, 110],
        ['native view:zoom-in', zoomIn, 120], // from 120%, Actual Size and Zoom Out part: 100% against 110%
        ["the header's %", () => app.click(headerZoomButtons(app)[1]), 100],
        ['native view:zoom-in', zoomIn, 110],
      ];
      for (const [what, run, pct] of routes) {
        (app.doc.activeElement as unknown as { blur?: () => void }).blur?.();
        await run();
        expect(focusedPaneOf(app), `${what}: the pane stays focused`).toBe('second');
        expect(scaleOf(paneMap(app)), `${what}: the pane's map is at ${pct}%`).toBeCloseTo(pct / 100, 4);
        expect(headerZoom(app), `${what}: the header reads the pane's zoom`).toBe(`${pct}%`);
        expect({ wedge: wedge(mainMap(app)), viewport: viewport(mainMap(app)), tab: app.activeTab() }, `${what}: the main view is unchanged`).toEqual(mainBefore);
      }

      await app.menu('view:rotate-map');
      expect(rotateDialogs(pane(app)), "native Rotate opens the pane's control").toHaveLength(1);
      expect(rotateDialogs(app.canvas()), "and not the main view's").toHaveLength(0);
      await paneDegrees(app, '90');
      expect([wedge(paneMap(app)), wedge(mainMap(app))]).toEqual(['90', '0']);
      await app.menu('view:reset-rotation');
      expect([wedge(paneMap(app)), wedge(mainMap(app))], 'native Reset Rotation turns the pane back').toEqual(['0', '0']);
      await closePaneRotate(app);
      await viewCommand(app, ['Rotate Circular Map…']);
      expect([rotateDialogs(pane(app)).length, rotateDialogs(app.canvas()).length], 'View › Rotate Circular Map… opens the pane’s control').toEqual([1, 0]);
      await paneDegrees(app, '45');
      expect([wedge(paneMap(app)), wedge(mainMap(app))]).toEqual(['45', '0']);
      await viewCommand(app, ['Reset Rotation']);
      expect([wedge(paneMap(app)), wedge(mainMap(app))], 'View › Reset Rotation turns the pane back').toEqual(['0', '0']);
      await closePaneRotate(app);

      await app.clickTab('text-view');
      expect(focusedPaneOf(app), 'the header tab leaves the pane focused').toBe('second');
      await app.menu('view:rotate-map');
      expect(app.activeTab(), "Rotate leaves the main view's tab").toBe('text-view');
      expect(rotateDialogs(pane(app)), "and opens the pane's control").toHaveLength(1);
      await paneDegrees(app, '90');
      await closePaneRotate(app);
      await app.clickTab('sequence-view');
      expect([wedge(paneMap(app)), wedge(mainMap(app))]).toEqual(['90', '0']);

      await autosaveRunsOut(app);
      const ws = autosavedWorkspace(storage);
      expect(ws.zoomLevel, 'workspace.zoomLevel is unchanged').toBe(100);
      expect(ws.mapRotation ?? {}, 'workspace.mapRotation is unchanged').toEqual({});

      await focusMainView(app);
      expect(headerZoom(app), "the main view's % read again once it is focused").toBe('100%');
      expect({ wedge: wedge(mainMap(app)), viewport: viewport(mainMap(app)), tab: app.activeTab() }).toEqual(mainBefore);
      // With the main pane focused they act on it, as before.
      await app.menu('view:zoom-in');
      await app.menu('view:zoom-in');
      expect(headerZoom(app), 'the main view zooms').toBe('120%');
      expect(scaleOf(mainMap(app))).toBeCloseTo(1.2, 4);
      expect(scaleOf(paneMap(app)), 'the pane keeps its zoom').toBeCloseTo(1.1, 4);
      await app.menu('view:rotate-map');
      expect([rotateDialogs(pane(app)).length, rotateDialogs(app.canvas()).length], "Rotate opens the main view's control").toEqual([0, 1]);
      await app.menu('view:reset-rotation');
      expect(wedge(paneMap(app)), 'the pane keeps its rotation').toBe('90');
    } finally {
      app.unmount();
    }
  });

  it("US-01M7DV10 AC2 with the focused pane on Linear Map or Info, or showing no document, the items, ids, shortcuts and header buttons are off with exactly the sentence; on the main pane as before", async () => {
    await withApp(async (app) => {
      await paneOnCircle(app);
      expect(await viewRowsDisabled(app, ZOOM_ROWS), 'all on while the pane draws its circle').toEqual([false, false, false, false, false]);
      const states: [string, () => Promise<void>][] = [
        ['Linear Map', () => app.change(viewSelect(app), 'linear')],
        ['Info', () => app.change(viewSelect(app), 'info')],
        ['no document', () => app.change(picker(app), '')],
      ];
      for (const [state, choose] of states) {
        await choose();
        expect(focusedPaneOf(app), `${state}: the pane stays focused`).toBe('second');
        expect(paneMaps(app), `${state}: the pane draws no circle`).toHaveLength(0);
        expect(await viewRowsDisabled(app, ZOOM_ROWS), `${state}: the View items are disabled`).toEqual([true, true, true, true, true]);
        expect(headerZoomButtons(app).map((b) => [b.hasAttribute('disabled'), b.getAttribute('title')]), `${state}: the header's − % + are off, saying why`).toEqual([[true, NO_CIRCLE], [true, NO_CIRCLE], [true, NO_CIRCLE]]);
        for (const [id, label] of MAP_IDS) {
          await app.menu(id);
          expect(statusSegments(app), `${state}: ${id} says exactly why`).toContain(`${label}: ${NO_CIRCLE}`);
        }
        await app.press('=', { mod: true });
        expect(rotateDialogs(app.canvas()), `${state}: nothing opened in the main view`).toHaveLength(0);
        expect([headerZoom(app), wedge(mainMap(app))], `${state}: the main view is unchanged`).toEqual(['100%', '0']);
      }
      await focusMainView(app);
      expect(await viewRowsDisabled(app, ZOOM_ROWS), 'the main pane focused: as before').toEqual([false, false, false, false, false]);
      expect(headerZoomButtons(app).map((b) => [b.hasAttribute('disabled'), b.getAttribute('title')]), 'the header as before').toEqual([
        [false, 'Zoom Out (Ctrl+-)'], [false, 'Reset Zoom to 100% (Ctrl+0)'], [false, 'Zoom In (Ctrl+=)'],
      ]);
      await app.menu('view:zoom-in');
      expect(headerZoom(app), 'and the main view zooms').toBe('110%');
    });
  });

  it('US-01M7DV10 AC2 the native menu state turns the five ids off with the focused pane on Linear Map, and back on with the main pane focused', async () => {
    const app = await mountApp(macHost());
    try {
      const nativeOn = () => {
        const states = app.nativeMenuStates();
        expect(states.length, 'the App sent the native menu state').toBeGreaterThan(0);
        return MAP_IDS.map(([id]) => resolveNativeMenuItemEnabled(id, states[states.length - 1]));
      };
      await paneOnCircle(app);
      expect(nativeOn(), 'on while the focused pane draws its circle').toEqual([true, true, true, true, true]);
      await app.change(viewSelect(app), 'linear');
      expect(nativeOn(), 'off with the focused pane on Linear Map').toEqual([false, false, false, false, false]);
      await app.change(picker(app), '');
      expect(nativeOn(), 'off with no document in the focused pane').toEqual([false, false, false, false, false]);
      await focusMainView(app);
      expect(nativeOn(), 'as before with the main pane focused').toEqual([true, true, true, true, true]);
    } finally {
      app.unmount();
    }
  });
});

describe("US-01M7DV10 AC3: the pane's figure export draws the pane's map", () => {
  it("US-01M7DV10 AC3 the pane map's SVG names the pane's document and draws its 90 degrees; the main map's keeps 0 and its name", async () => {
    await withApp(async (app) => {
      await paneOnCircle(app);
      for (let i = 0; i < 5; i++) await app.menu('view:zoom-in');
      expect(headerZoom(app)).toBe('150%');
      expect(scaleOf(paneMap(app))).toBeCloseTo(1.5, 4);
      await app.menu('view:rotate-map');
      await paneDegrees(app, '90');
      await closePaneRotate(app);
      expect([wedge(paneMap(app)), wedge(mainMap(app))]).toEqual(['90', '0']);
      await focusMainView(app);
      expect(headerZoom(app), 'the main view at 100%').toBe('100%');

      const paneFile = await exportMapSvg(app, pane(app));
      expect(paneFile.filename, "the pane's export names its document").toContain('Circ_B');
      expect(paneFile.filename).not.toContain('Circ_A');
      expect(paneFile.wedge, "the pane's export draws its rotation").toBe('90');
      const mainFile = await exportMapSvg(app, app.canvas());
      expect(mainFile.filename, "the main map's export names the main document").toContain('Circ_A');
      expect(mainFile.filename).not.toContain('Circ_B');
      expect(mainFile.wedge, "the main map's export keeps 0").toBe('0');
    });
  });
});

describe("US-01M7DV10 AC4: document commands stay on the main view's document, and say so", () => {
  it('US-01M7DV10 AC4 with the pane focused on another document, Reverse Complement and Set Origin name the main document, act on it, and the inspector stays', async () => {
    const storage = memoryStorage();
    const app = await mountApp({ storage });
    try {
      await onCircles(app, [CA, CB], CA.id, { selectedRange: { start: 100, end: 100, label: 'Selection' } });
      await showInPane(app, CB.id);
      const SUFFIX = ' Acts on "Circ_A" in the main view.';
      const rc = () => functionInfo(app, 'Sequence', ['Strand', 'Reverse Complement']);
      const origin = () => functionInfo(app, 'View', ['Map Layout', 'Set Origin']);
      const asBefore = { rc: await rc(), origin: await origin() };
      expect(asBefore.rc, 'the main pane focused: its own Function Info').toBe(resolveMenuNodeFunctionDescription('seq-rc', 'Reverse Complement'));
      expect(asBefore.origin).toBe(resolveMenuNodeFunctionDescription('view-set-origin', 'Set Origin'));
      const inspectorText = () => words(app.inspectorAside()?.textContent ?? '');
      const inspectorBefore = inspectorText();
      expect(inspectorBefore, 'the inspector is shown').not.toBe('');

      await pointerDown(app, paneBody(app));
      expect(focusedPaneOf(app)).toBe('second');
      for (const [what, read, own] of [['Reverse Complement', rc, asBefore.rc], ['Set Origin', origin, asBefore.origin]] as const) {
        const info = await read();
        expect(info.endsWith(SUFFIX), `${what}: "${info}" ends naming the main document`).toBe(true);
        expect(info.startsWith(own), `${what}: after its own Function Info`).toBe(true);
      }
      expect(inspectorText(), 'the inspector stays with the main view').toBe(inspectorBefore);
      expect(pane(app).querySelectorAll('aside'), 'and is not drawn in the pane').toHaveLength(0);

      await autosaveRunsOut(app);
      const before = autosavedSequences(storage);
      await app.menu('sequence:reverse-complement');
      await autosaveRunsOut(app);
      const after = autosavedSequences(storage);
      expect(after[CA.id], "Reverse Complement changed the main view's document").not.toBe(before[CA.id]);
      expect(after[CA.id].length).toBe(CA.sequence.length);
      expect(after[CB.id], "and not the pane's").toBe(before[CB.id]);

      await app.click(showMain(app));
      expect(focusedPaneOf(app)).toBe('second');
      expect({ rc: await rc(), origin: await origin() }, 'the same document in both panes: as before').toEqual(asBefore);
    } finally {
      app.unmount();
    }
  });
});

// ─── BG-01M7ND2J ───
//
// With the same document in both panes the pane's selection is the main view's (US-01M7DVQG), so
// the pane's Clear clears that one selection. Wrong implementations this check fails on: the shared
// setRange dropping a null range rather than passing it to onSelectMainRange (the main view and the
// pane keep drawing the selection, and the header keeps reading it); the pane's Clear doing nothing;
// a Clear that empties only the pane's held selection, which the pane does not read while shared.

describe('BG-01M7ND2J', () => {
  it("BG-01M7ND2J AC1 the pane's Clear, with the main view's document in the pane, clears the one shared selection", async () => {
    const MARK_READOUT = '5,000..6,000 (1,001 bp) • Mark (misc_feature)';
    const CLEAR_TITLE = 'Clear active sequence selection';
    await withApp(async (app) => {
      await onCircles(app, [CA, CB], CA.id);
      await showMainInPane(app);
      expect(viewSelect(app).value, 'the pane is on Linear Map').toBe('linear');
      expect(readout(app), 'nothing selected yet').toBeNull();

      await app.click(arcIn(mainMap(app), 'Mark'));
      expect(readout(app), 'the header reads the selection made in the main view').toBe(MARK_READOUT);
      expect(mainSelection(app), "the main view's linear map draws it").toBe('5,000..6,000');
      expect(interval(mainMap(app)), "the main view's circular map draws it").toHaveLength(1);
      expect(paneSelection(app), "the pane's Linear Map draws the shared selection").toBe('5,000..6,000');
      expect(paneHint(app), 'the pane shows no hint while it draws a selection').toBe(false);

      // The pane's Clear: inline on its quickbar, or under its More menu when it does not fit.
      const clearIn = () => pane(app).querySelectorAll('button').filter((b) => b.getAttribute('title') === CLEAR_TITLE);
      if (!clearIn().length) {
        const more = pane(app).querySelectorAll('button').filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('More selection actions'));
        expect(more, "the pane's quickbar More menu").toHaveLength(1);
        await app.click(more[0]);
      }
      const clear = clearIn();
      expect(clear, "the pane's one Clear action").toHaveLength(1);
      await app.click(clear[0]);

      expect(app.header().querySelectorAll('.mbc-selection-readout'), 'the header reads no selection').toHaveLength(0);
      expect(mainSelection(app), 'the main view draws no selection region').toBeNull();
      expect(interval(mainMap(app)), "the main view's circular map draws no interval").toEqual([]);
      expect(paneSelection(app), 'the pane draws no selection region').toBeNull();
      expect(paneHint(app), "the pane shows its 'Click a base' hint").toBe(true);
    });
  });
});
