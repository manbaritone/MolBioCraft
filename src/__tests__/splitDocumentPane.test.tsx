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
import { appCssRules, cascaded } from './cssCascade';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

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
