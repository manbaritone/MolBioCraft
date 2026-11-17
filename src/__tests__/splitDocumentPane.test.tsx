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
 * Every document is built here. The three the selection checks use are each 7,200 bp or more, so a
 * carried 5,000-6,000 would be drawable on any of them; the picker's fillers are 40 bp.
 */

import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

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
