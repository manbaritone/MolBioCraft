// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVS2: the Map Gallery of the document table's checked records, through the mounted App
 * (appHarness). The gallery is App state that takes the main view's place while the split pane stays
 * beside it (D0192); its cards draw as the split pane draws its document.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { SequenceDocument } from '../types/bio';
import { parseMbcWorkbench } from '../core/mbcSessionFormat';
import { buildCommandDocumentContext, circularMapUnavailableReason, commandAvailability } from '../core/commandAvailability';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, memoryStorage, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 240_000 });

/**
 * The component modules' exports, loaded once the App is mounted: the components load React DOM,
 * which only mountApp may load first.
 */
const components = async () => ({
  ...(await import('../components/CircularPlasmidMap')),
  ...(await import('../components/SplitDocumentPane')),
  ...(await import('../components/MapGallery')),
});

async function withApp<T>(run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp();
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test, in two nested project folders ───

const ALPHA = 'Lab Alpha';
const BETA = 'Lab Beta';
const ROOT_PATH = 'All Project Files';

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
const mark = (id: string, n: number, start: number) => ({ id: `${id}-f${n}`, name: `Mark_${n}`, type: 'misc_feature' as const, start, end: start + 400, strand: 1 as const, color: '#3b82f6', qualifiers: {} });
const doc = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name, accession: `ACC-${id.toUpperCase()}`, description: `${name}, built in the test`, sequence,
  moleculeType: 'DNA', topology: 'circular', folder: ALPHA,
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z',
  features: sequence.length >= 1_600 ? [mark(id, 1, 1000)] : [],
  primers: [], history: [], ...more,
} as SequenceDocument);

const CA = doc('ga', 'Circ_A', dna(6_000, 21), {
  primers: [{
    id: 'ga-prm', name: 'Fwd_1', sequence: 'ACGTACGTACGTACGTACGT', annealSequence: 'ACGTACGTACGTACGTACGT', tail5Prime: '', bindStart: 2_000, bindEnd: 2_019,
    strand: 1, length: 20, gcPercent: 50, tmAnnealC: 58, tmFullC: 58, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true,
  }],
});
const CB = doc('gb', 'Circ_B', dna(6_400, 23));
const LIN = doc('glin', 'Lin_Doc', dna(5_000, 31), { topology: 'linear' });
const RNA = doc('grna', 'Rna_Circle', dna(3_000, 37).replace(/T/g, 'U'), { moleculeType: 'RNA', topology: 'circular' });
const PROT = doc('gprot', 'Prot_Doc', 'MKTAYIAKQRQISFVKSHFSRQ'.repeat(20), { moleculeType: 'Protein', topology: 'linear', features: [] });
const EMPTY = doc('gempty', 'Empty_Doc', '');
const CONTIG = doc('gcontig', 'Contig_Doc', '', { docMetadata: { 'Declared Length': 5_000_000, 'Is Contig Summary': 'Yes' } } as Partial<SequenceDocument>);
const TEXT = doc('gtext', 'Text_Doc', '', { docMetadata: { 'Document Type': 'Text Document', Notes: 'A note.' } } as Partial<SequenceDocument>);
const TREE = { ...SAMPLE_LIBRARY.find((d) => d.id === 'doc-tree-three-kingdoms')!, id: 'gtree', accession: 'ACC-GTREE', folder: ALPHA };
const ALN = { ...SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-hiv-env')!, id: 'galn', accession: 'ACC-GALN', folder: ALPHA };
// Two records of one name in different folders, told apart by path and by accession.
const TWIN_A = doc('twa', 'Twin', dna(5_200, 41), { accession: 'TW-ALPHA' });
const TWIN_B = doc('twb', 'Twin', dna(4_100, 43), { accession: 'TW-BETA', folder: BETA });
// Over 150,000 bp: only the first 60,000 bp are scanned, with the core enzymes.
const BIG = doc('gbig', 'Big_Circle', dna(150_001, 47));
// GATC 2,100 times: more DpnI, MboI and Sau3AI sites than the scan keeps positions for, so it warns.
const GATC = doc('ggatc', 'Gatc_Repeat', 'GATC'.repeat(2_100));
// Twenty features round the circle: each labelled at full size, while at card size the label
// floor leaves some callouts out.
const CROWD = doc('gcrowd', 'Crowded_Map', dna(8_000, 53), {
  features: Array.from({ length: 20 }, (_, i) => ({ ...mark('gcrowd', i, 100 + i * 350), end: 150 + i * 350, name: `Crowd_${i}` })),
});

// A record in the built-in Cloning folder's alias: the explorer files it under Sample Documents › Cloning.
const CLONE_ALIAS = 'Cloning Inserts & PCR';
const CLONED = doc('gclone', 'Clone_Insert', dna(4_000, 61), { folder: CLONE_ALIAS });
// A circular RNA, drawn as a bar, whose feature runs across the origin (2,800..200 of 3,000).
const WRAP = doc('gwrap', 'Rna_Wrap', dna(3_000, 67).replace(/T/g, 'U'), {
  moleculeType: 'RNA', topology: 'circular',
  features: [{ ...mark('gwrap', 1, 0), start: 2_800, end: 200, name: 'Across_Origin' }],
});

const sentenceFor = (d: SequenceDocument) => circularMapUnavailableReason(buildCommandDocumentContext(d)!);
const reasonFor = (n: number) => `Check two or more records in the document table (now ${n}).`;
const explorer = { customFolders: [ALPHA, BETA], folderParents: { [BETA]: ALPHA } };

// ─── Reading and driving the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';

const restore = (app: AppHarness, docs: SequenceDocument[], active: string, more: Record<string, unknown> = {}) =>
  app.restoreSession({
    documents: docs, activeDocId: active, viewerTab: 'sequence-view',
    workspace: { selectedFolder: ALPHA, projectExplorer: explorer, mapLayoutMode: 'split', ...more } as never,
  });

const galleries = (app: AppHarness) => app.all('section[aria-label="Map Gallery"]');
const gallery = (app: AppHarness) => app.one('section[aria-label="Map Gallery"]', 'the Map Gallery');
const cards = (app: AppHarness) => gallery(app).querySelectorAll('article.mbc-map-gallery-card');
const field = (card: LiveElement, name: string) => words(card.querySelectorAll(`.mbc-map-gallery-${name}`)[0]?.textContent);
const cardName = (card: LiveElement) => field(card, 'name');
const cardAcc = (card: LiveElement) => field(card, 'accession');
const toolbarButton = (app: AppHarness) => app.one('.doc-table-toolbar button.mbc-map-gallery-btn', 'the table toolbar\'s Map Gallery button');
const tableRows = (app: AppHarness) => app.all('table.mbc-document-table tbody tr').filter((r) => r.querySelectorAll('input[type="checkbox"]').length === 1);
const rowAccession = (row: LiveElement, docs: SequenceDocument[]) => {
  const hit = docs.filter((d) => words(row.textContent).includes(d.accession));
  expect(hit, `one known accession in the row "${words(row.textContent)}"`).toHaveLength(1);
  return hit[0].accession;
};
const lengthColumn = (app: AppHarness) => {
  const ths = app.all('table.mbc-document-table thead th');
  const at = ths.findIndex((th) => (th.getAttribute('title') ?? '').startsWith('Sort by Sequence Length'));
  expect(at, 'the table shows the Sequence Length column').toBeGreaterThan(0);
  return { th: ths[at], at };
};
async function check(app: AppHarness, d: SequenceDocument, on = true) {
  const boxes = tableRows(app).filter((r) => words(r.textContent).includes(d.accession)).map((r) => r.querySelectorAll('input[type="checkbox"]')[0]);
  expect(boxes, `one row for ${d.accession}`).toHaveLength(1);
  expect(boxes[0].getAttribute('aria-label')).toBe(`Select ${d.name}`);
  if (boxes[0].checked !== on) await app.change(boxes[0], on);
}
async function checkAll(app: AppHarness, on = true) {
  await app.change(app.one('input[aria-label="Select or deselect all documents in current folder"]'), on);
}

async function pointerDown(app: AppHarness, el: LiveElement) {
  const p = { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 0, clientY: 0 };
  await React.act(async () => { dispatchLiveEvent(el, 'pointerdown', { ...p, buttons: 1 }); });
  await React.act(async () => { dispatchLiveEvent(el, 'pointerup', { ...p, buttons: 0 }); });
  await app.settle();
}
const pane = (app: AppHarness) => app.one('section.mbc-split-pane', 'the split view pane');
const labelled = (scope: LiveElement, selector: string, name: string) => {
  const found = scope.querySelectorAll(selector).filter((c) => c.getAttribute('aria-label') === name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
};
const picker = (app: AppHarness) => labelled(pane(app), 'select', 'Document in split view');
const viewSelect = (app: AppHarness) => labelled(pane(app), 'select', 'View in split pane');
const paneBody = (app: AppHarness) => pane(app).querySelectorAll('.mbc-split-pane-body')[0];
const focusMain = (app: AppHarness) => pointerDown(app, app.canvas());
const focusPane = (app: AppHarness) => pointerDown(app, paneBody(app));
const oneMap = (scope: LiveElement, what: string) => { const m = scope.querySelectorAll('svg.plasmid-svg'); expect(m, what).toHaveLength(1); return m[0]; };
const wedge = (svg: LiveElement) => svg.querySelectorAll('[data-map-part="origin-wedge"]')[0]?.getAttribute('data-draw-angle') ?? null;
const viewport = (svg: LiveElement) => svg.querySelectorAll('g.plasmid-viewport-group')[0]?.getAttribute('transform') ?? null;
const scaleOf = (svg: LiveElement) => { const m = /scale\(([\d.]+)\)/.exec(viewport(svg) ?? ''); return m ? Number(m[1]) : 1; };
const rotateDialogs = (scope: LiveElement) => scope.querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"]');
const headerZoom = (app: AppHarness) => words(app.header().querySelectorAll('button.zoom-pct-btn')[0]?.textContent);
const statusText = (app: AppHarness) => words(app.all('.statusbar-toast-text').map((t) => t.textContent).join(' '));
async function rotateTo(app: AppHarness, scope: LiveElement, deg: string) {
  await app.menu('view:rotate-map');
  const input = rotateDialogs(scope)[0]?.querySelectorAll('input[aria-label="Rotation in degrees"]') ?? [];
  expect(input, 'the degree field').toHaveLength(1);
  await app.change(input[0], deg);
  const close = rotateDialogs(scope)[0].querySelectorAll('button').filter((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'Close');
  await app.click(close[0]);
}
/** The split shown with Circ_B in the pane on Circular Map, zoomed in and turned to 45 degrees, and focused. */
async function primedPane(app: AppHarness) {
  await app.click(app.one('button.mbc-split-toggle'));
  if (picker(app).value !== CB.id) await app.change(picker(app), CB.id);
  await app.change(viewSelect(app), 'circular');
  await focusPane(app);
  await app.menu('view:zoom-in');
  await app.menu('view:zoom-in');
  await rotateTo(app, pane(app), '45');
}
type PaneState = { doc: string; view: string; scale: number; wedge: string | null; focused: string | null };
const paneState = (app: AppHarness): PaneState => {
  const m = oneMap(pane(app), "the pane's circle");
  return { doc: picker(app).value, view: viewSelect(app).value, scale: scaleOf(m), wedge: wedge(m), focused: pane(app).getAttribute('aria-current') };
};

const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
const rowLabel = (b: LiveElement) => words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent);
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 4 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
async function viewRow(app: AppHarness, label: string): Promise<LiveElement> {
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'View');
  if (!trigger) throw new Error('the menu bar has no View menu');
  await app.click(trigger);
  const row = menuButtons(app).find((b) => rowLabel(b) === label);
  if (!row) throw new Error(`no "${label}" in the View menu: ${menuButtons(app).map(rowLabel).join(' | ')}`);
  return row;
}
/** View › Map Gallery (or another View row): [disabled, the Function Info it shows on hover]. */
async function viewItem(app: AppHarness, label = 'Map Gallery'): Promise<[boolean, string]> {
  const row = await viewRow(app, label);
  await React.act(async () => { dispatchLiveEvent(row, 'pointerover', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); });
  await app.settle();
  const tips = app.all('[role="tooltip"]').map((t) => words(t.textContent));
  await closeMenus(app);
  return [row.hasAttribute('disabled'), tips.join(' | ')];
}
async function openByView(app: AppHarness) {
  const row = await viewRow(app, 'Map Gallery');
  expect(row.hasAttribute('disabled'), 'View › Map Gallery is enabled').toBe(false);
  await app.click(row);
  await closeMenus(app);
}
async function openByToolbar(app: AppHarness) {
  expect(toolbarButton(app).hasAttribute('disabled'), 'the toolbar button is enabled').toBe(false);
  await app.click(toolbarButton(app));
}
async function closeGallery(app: AppHarness) {
  await app.click(labelled(gallery(app), 'button', 'Close Map Gallery'));
  expect(galleries(app)).toHaveLength(0);
}
const autosaved = async (app: AppHarness) => {
  await React.act(async () => { vi.advanceTimersByTime(600); });
  await app.settle();
  const raw = app.win.localStorage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return { raw: raw!, envelope: parseMbcWorkbench(raw!, 'Reopened').envelope };
};
/** Each card's drawn circle, as [wedge, viewport], or the card's map part counts where it has no circle. */
const cardViews = (app: AppHarness) => cards(app).map((c) => {
  const svg = c.querySelectorAll('svg.plasmid-svg')[0];
  return svg ? [wedge(svg), viewport(svg)] : [c.querySelectorAll('[data-map-part]').length];
});

// ─── AC1 ───

describe('US-01M7DVS2 AC1: Map Gallery opens from the table toolbar and View with two or more checked rows', () => {
  it('US-01M7DVS2 AC1 both entry points are off with the reason under two checked rows, on at two (DNA with protein), and open the gallery in the main view', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, PROT], CA.id);
      // The restore checks the open record alone.
      expect([toolbarButton(app).hasAttribute('disabled'), toolbarButton(app).getAttribute('title')]).toEqual([true, reasonFor(1)]);
      expect(await viewItem(app)).toEqual([true, expect.stringContaining(reasonFor(1))]);
      await check(app, CA, false);
      expect([toolbarButton(app).hasAttribute('disabled'), toolbarButton(app).getAttribute('title')]).toEqual([true, reasonFor(0)]);
      expect(await viewItem(app)).toEqual([true, expect.stringContaining(reasonFor(0))]);
      // A disabled button does nothing.
      await app.click(toolbarButton(app));
      expect(galleries(app)).toHaveLength(0);

      // DNA mixed with protein is enabled: the rule counts rows, and refuses no molecule mix.
      await check(app, CA);
      await check(app, PROT);
      expect(toolbarButton(app).hasAttribute('disabled')).toBe(false);
      expect(toolbarButton(app).getAttribute('title')).not.toBe(reasonFor(2));
      expect((await viewItem(app))[0]).toBe(false);
      await openByToolbar(app);
      expect(app.canvas().querySelectorAll('section[aria-label="Map Gallery"]'), 'the gallery takes the main view\'s place').toHaveLength(1);
      expect(cards(app).map(cardName)).toEqual(['Circ_A', 'Prot_Doc']);
      await closeGallery(app);
      await openByView(app);
      expect(cards(app).map(cardName)).toEqual(['Circ_A', 'Prot_Doc']);
    });
  });

  it('US-01M7DVS2 AC1 the rule multi-record-view reads checkedRecordCount alone', () => {
    const ctx = { sessionActive: true, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 };
    expect([0, 1, 2, 7].map((n) => commandAvailability('multi-record-view', { ...ctx, checkedRecordCount: n }))).toEqual([
      { enabled: false, reason: reasonFor(0) }, { enabled: false, reason: reasonFor(1) }, { enabled: true }, { enabled: true },
    ]);
    expect(commandAvailability('multi-record-view', { ...ctx, sessionActive: false, checkedRecordCount: 3 }).enabled).toBe(false);
    // A caller that does not count the rows is refused, not enabled.
    expect(commandAvailability('multi-record-view', ctx).enabled).toBe(false);
  });

  it("US-01M7DVS2 AC1 opening the gallery from either entry leaves the split pane's document, view, zoom, rotation and focus as they were", async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await primedPane(app);
      const before = paneState(app);
      expect(before.focused, 'the pane is focused').toBe('true');
      expect(before.wedge).toBe('45');
      expect(before.scale).not.toBeCloseTo(1, 4);
      await check(app, LIN);
      await check(app, CA);
      expect(paneState(app)).toEqual(before);
      for (const open of [openByToolbar, openByView]) {
        // Closing the gallery is a click in the main view's place, which focuses it; the pane is focused again.
        await focusPane(app);
        expect(paneState(app)).toEqual(before);
        await open(app);
        expect(cards(app).map(cardName)).toEqual(['Circ_A', 'Lin_Doc']);
        expect(paneState(app), `${open.name} leaves the pane`).toEqual(before);
        await closeGallery(app);
      }
    });
  });
});

// ─── AC2 ───

describe("US-01M7DVS2 AC2: one card per checked row the table shows, in the table's order", () => {
  it('US-01M7DVS2 AC2 each card names the record, its table length, topology, molecule, accession and folder path; sorting by Sequence Length reorders the cards', async () => {
    const docs = [CA, LIN, TWIN_A, TWIN_B, PROT];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openByToolbar(app);
      const tableOrder = () => tableRows(app).map((r) => rowAccession(r, docs));
      expect(cards(app).map(cardAcc)).toEqual(tableOrder());
      const { th, at } = lengthColumn(app);
      for (const card of cards(app)) {
        const d = docs.find((x) => x.accession === cardAcc(card))!;
        const row = tableRows(app).find((r) => rowAccession(r, docs) === d.accession)!;
        expect(field(card, 'length'), `${d.accession}'s length`).toBe(words(row.children[at].textContent));
        expect(field(card, 'length')).toMatch(/ (bp|aa)$/);
        expect(cardName(card)).toBe(d.name);
        expect(field(card, 'topology')).toBe(d.topology === 'circular' ? 'Circular' : 'Linear');
        expect(field(card, 'molecule')).toBe(d.moleculeType);
        expect(field(card, 'folder')).toBe(d.folder === BETA ? `${ROOT_PATH} › ${ALPHA} › ${BETA}` : `${ROOT_PATH} › ${ALPHA}`);
      }
      // The two records named Twin: the same name, told apart by path and accession.
      const twins = cards(app).filter((c) => cardName(c) === 'Twin');
      expect(twins.map((c) => [cardAcc(c), field(c, 'folder')]).sort()).toEqual([
        ['TW-ALPHA', `${ROOT_PATH} › ${ALPHA}`], ['TW-BETA', `${ROOT_PATH} › ${ALPHA} › ${BETA}`],
      ]);
      const unsorted = cards(app).map(cardAcc);
      await app.click(th);
      const sorted = tableOrder();
      expect(sorted, 'the sort moved the rows').not.toEqual(unsorted);
      expect(cards(app).map(cardAcc), 'the cards follow the sorted table').toEqual(sorted);
      await app.click(th);
      expect(cards(app).map(cardAcc), 'and its reversal').toEqual([...sorted].reverse());
    });
  });

  it('US-01M7DVS2 AC2 a checked row the table filter hides has no card, and the rule counts the rows shown', async () => {
    const docs = [CA, LIN, TWIN_A, TWIN_B];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openByToolbar(app);
      expect(cards(app)).toHaveLength(4);
      await app.click(app.one('button.mbc-filter-trigger-btn'));
      await app.change(app.one('input[aria-label="Quick filter across table columns"]'), 'Twin');
      expect(tableRows(app).map((r) => rowAccession(r, docs)).sort()).toEqual(['TW-ALPHA', 'TW-BETA']);
      expect(cards(app).map(cardAcc).sort()).toEqual(['TW-ALPHA', 'TW-BETA']);
      await app.change(app.one('input[aria-label="Quick filter across table columns"]'), 'Lin_Doc');
      expect(cards(app).map(cardAcc)).toEqual([LIN.accession]);
      expect(toolbarButton(app).getAttribute('title')).toBe(reasonFor(1));
    });
  });

  it("US-01M7DVS2 AC2 a record filed under a built-in folder's alias shows the path of the folder the explorer files it in", async () => {
    const docs = [CA, CLONED];
    await withApp(async (app) => {
      await restore(app, docs, CA.id, { selectedFolder: ROOT_PATH });
      for (const d of docs) await check(app, d);
      await openByToolbar(app);
      const byAcc = new Map(cards(app).map((c) => [cardAcc(c), c]));
      expect(byAcc.size).toBe(2);
      expect(field(byAcc.get(CLONED.accession)!, 'folder'), `${CLONE_ALIAS} is gathered by Sample Documents › Cloning`).toBe(`${ROOT_PATH} › Sample Documents › Cloning`);
      expect(field(byAcc.get(CA.accession)!, 'folder')).toBe(`${ROOT_PATH} › ${ALPHA}`);
    });
  });
});

// ─── AC3 ───

describe('US-01M7DVS2 AC3: a card says why it has no map, or draws a circle or a linear bar by the circle rule', () => {
  const noMap = [TREE, ALN, TEXT, CONTIG, EMPTY] as SequenceDocument[];
  const drawn = [CA, CB, LIN, RNA, PROT];
  const REASONS: Record<string, string> = {
    gtree: 'A tree has no sequence map.',
    galn: 'An alignment has no sequence map.',
    gtext: 'A text document has no sequence map.',
    gcontig: 'A contig summary has no sequence map.',
    gempty: 'This record has no bases to draw.',
  };

  it('US-01M7DVS2 AC3 the no-map kinds say why; the others draw a circle exactly where circularMapUnavailableReason is null, a bar otherwise, at the main-view rotation', async () => {
    await withApp(async (app) => {
      await restore(app, [...drawn, ...noMap], CA.id);
      await focusMain(app);
      await rotateTo(app, app.canvas(), '90');
      await checkAll(app);
      await openByToolbar(app);
      // Five maps: past GALLERY_MAPS_DRAWN_FIRST, the rest are drawn by Draw next (US-01M7DV75 AC2).
      await drawEvery(app);
      const byAcc = new Map(cards(app).map((c) => [cardAcc(c), c]));
      expect(byAcc.size).toBe(10);
      for (const d of noMap) {
        const c = byAcc.get(d.accession)!;
        expect(field(c, 'nomap'), d.name).toBe(REASONS[d.id]);
        expect(c.querySelectorAll('svg').length, `${d.name} draws nothing`).toBe(0);
      }
      for (const d of drawn) {
        const c = byAcc.get(d.accession)!;
        expect(field(c, 'nomap'), d.name).toBe('');
        const circle = sentenceFor(d) === null;
        expect([c.querySelectorAll('svg.plasmid-svg').length, c.querySelectorAll('svg.mbc-map-gallery-bar').length], d.name).toEqual(circle ? [1, 0] : [0, 1]);
      }
      expect(drawn.filter((d) => sentenceFor(d) === null).map((d) => d.name), 'the fixture holds both kinds').toEqual(['Circ_A', 'Circ_B']);
      expect(wedge(oneMap(byAcc.get(CA.accession)!, 'Circ_A card')), "Circ_A starts at the main view's rotation").toBe('90');
      expect(wedge(oneMap(byAcc.get(CB.accession)!, 'Circ_B card')), 'Circ_B, never turned, at 0').toBe('0');
    });
  });

  it('US-01M7DVS2 AC3 every drawn card follows View › Tracks Features and Restriction Sites and draws no ORFs or primers', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id, {
        displaySettings: { showOrfs: true, minOrfAa: 30, allowAltStartCodons: false, showPrimers: true, showTranslation: false, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
      });
      const main = oneMap(app.canvas(), 'the main circle');
      expect(main.querySelectorAll('[data-map-part="primer-marker"]').length, 'the main view draws Circ_A\'s primer').toBeGreaterThan(0);
      await checkAll(app);
      await openByToolbar(app);
      const parts = () => cards(app).map((c) => ({
        features: c.querySelectorAll('[data-map-part="feature-arc"], [data-map-part="feature-box"]').length,
        sites: c.querySelectorAll('[data-map-part="cut-site"]').length,
        orfs: c.querySelectorAll('[data-map-part="orf-arc"]').length,
        primers: c.querySelectorAll('[data-map-part="primer-marker"]').length,
      }));
      for (const p of parts()) {
        expect(p.features, 'each card draws its feature').toBeGreaterThan(0);
        expect(p.sites, 'and its cut sites').toBeGreaterThan(0);
        expect([p.orfs, p.primers], 'no ORFs or primers').toEqual([0, 0]);
      }
      await app.menu('view:track-features');
      expect(parts().map((p) => p.features), 'Features hidden in every card').toEqual([0, 0, 0]);
      expect(parts().every((p) => p.sites > 0)).toBe(true);
      await app.menu('view:track-restriction-sites');
      expect(parts().map((p) => p.sites), 'Restriction Sites hidden in every card').toEqual([0, 0, 0]);
      await app.menu('view:track-features');
      await app.menu('view:track-restriction-sites');
      expect(parts().every((p) => p.features > 0 && p.sites > 0), 'both shown again').toBe(true);
    });
  });

  it("US-01M7DVS2 AC3 a bar draws a feature across a circular record's origin as its two parts, to the bar's end and from its start", async () => {
    await withApp(async (app) => {
      expect(sentenceFor(WRAP), 'a circular RNA is drawn as a bar').not.toBeNull();
      await restore(app, [CA, WRAP], CA.id);
      await checkAll(app);
      await openByToolbar(app);
      const card = cards(app).find((c) => cardAcc(c) === WRAP.accession)!;
      const bar = card.querySelectorAll('svg.mbc-map-gallery-bar');
      expect(bar).toHaveLength(1);
      const width = Number(/^0 0 (\d+) /.exec(bar[0].getAttribute('viewBox') ?? '')?.[1]);
      const at = (bp: number) => ((bp - 1) / WRAP.sequence.length) * width;
      const boxes = bar[0].querySelectorAll('[data-map-part="feature-box"]').map((r) => [Number(r.getAttribute('x')), Number(r.getAttribute('x')) + Number(r.getAttribute('width'))]);
      expect(boxes, 'two parts: 2,800 to the end, then 1 to 200').toHaveLength(2);
      expect(boxes[0][0]).toBeCloseTo(at(2_800), 6);
      expect(boxes[0][1]).toBeCloseTo(width, 6);
      expect(boxes[1][0]).toBe(0);
      expect(boxes[1][1]).toBeCloseTo(at(201), 6);
    });
  });
});

// ─── AC4 ───

describe('US-01M7DVS2 AC4: at most SPLIT_PICKER_CAP cards and GALLERY_MAPS_DRAWN_FIRST maps, each said by subsetNote', () => {
  it('US-01M7DVS2 AC4 over the cap the gallery lists the first cards in table order and draws the first maps, saying both', async () => {
    await withApp(async (app) => {
      const { SPLIT_PICKER_CAP, GALLERY_MAPS_DRAWN_FIRST, subsetNote } = await components();
      const many = Array.from({ length: SPLIT_PICKER_CAP + 1 }, (_, i) => doc(`m${String(i).padStart(4, '0')}`, `Many_${String(i).padStart(4, '0')}`, dna(300 + i, 100 + i)));
      const M = many.length;
      await restore(app, many, many[0].id);
      await checkAll(app);
      await openByToolbar(app);
      const shown = cards(app);
      expect(shown).toHaveLength(SPLIT_PICKER_CAP);
      const rows = tableRows(app);
      expect(rows).toHaveLength(M);
      const rowNames = rows.map((r) => r.querySelectorAll('input[type="checkbox"]')[0].getAttribute('aria-label')!.replace(/^Select /, ''));
      expect(shown.map(cardName), 'the first in table order').toEqual(rowNames.slice(0, SPLIT_PICKER_CAP));
      const text = words(gallery(app).textContent);
      expect(text).toContain(subsetNote('The gallery shows', SPLIT_PICKER_CAP, M, 'records', 'first')[0]);
      // Every record here has a map, so the maps are counted against all M.
      expect(text).toContain(subsetNote('The gallery draws maps for', GALLERY_MAPS_DRAWN_FIRST, M, 'records with a map', 'first')[0]);
      const withMap = shown.map((c) => c.querySelectorAll('svg.plasmid-svg').length);
      expect(withMap.slice(0, GALLERY_MAPS_DRAWN_FIRST), 'the first cards draw maps').toEqual(Array(GALLERY_MAPS_DRAWN_FIRST).fill(1));
      expect(withMap.slice(GALLERY_MAPS_DRAWN_FIRST).every((n) => n === 0), 'the rest draw none').toBe(true);
      const { at } = lengthColumn(app);
      for (const [i, c] of shown.entries()) {
        if (i < GALLERY_MAPS_DRAWN_FIRST) continue;
        expect([cardName(c), field(c, 'length'), field(c, 'topology')], `card ${i}`).toEqual([rowNames[i], words(rows[i].children[at].textContent), 'Circular']);
      }
      // Under both caps the gallery says nothing of either.
      await checkAll(app, false);
      expect(tableRows(app).filter((r) => r.querySelectorAll('input[type="checkbox"]')[0].checked), 'Select All cleared every row').toHaveLength(0);
      // The gallery follows the checked rows, the open record's among them or not.
      expect(galleries(app), 'the gallery stays').toHaveLength(1);
      expect(cards(app)).toHaveLength(0);
      const EMPTY_SENTENCE = 'No record is checked in the document table. Check the rows to show their maps here.';
      expect(gallery(app).querySelectorAll('[role="status"]').map((p) => words(p.textContent)), 'an empty gallery says why').toEqual([EMPTY_SENTENCE]);
      for (const d of many.slice(1, GALLERY_MAPS_DRAWN_FIRST)) await check(app, d);
      expect(cards(app)).toHaveLength(GALLERY_MAPS_DRAWN_FIRST - 1);
      expect(words(gallery(app).textContent)).not.toMatch(/The gallery (shows|draws maps for) the first/);
      expect(words(gallery(app).textContent), 'and says nothing of it once rows are checked').not.toContain(EMPTY_SENTENCE);
    });
  });

  it('US-01M7DVS2 AC4 a card with no map takes no drawn slot, and the note counts only the records that have a map', async () => {
    await withApp(async (app) => {
      const { GALLERY_MAPS_DRAWN_FIRST, subsetNote } = await components();
      const mapped = Array.from({ length: GALLERY_MAPS_DRAWN_FIRST + 1 }, (_, i) => doc(`s${String(i).padStart(3, '0')}`, `Slot_${String(i).padStart(3, '0')}`, dna(300 + i, 200 + i)));
      const docs = [EMPTY, TEXT, ...mapped];
      await restore(app, docs, mapped[0].id);
      await checkAll(app);
      await openByToolbar(app);
      const order = tableRows(app).map((r) => rowAccession(r, docs));
      expect(cards(app).map(cardAcc), 'one card per row, in table order').toEqual(order);
      expect([EMPTY, TEXT].every((d) => order.indexOf(d.accession) < GALLERY_MAPS_DRAWN_FIRST), 'both no-map cards sit among the first cards').toBe(true);
      const drawnAcc = () => cards(app).filter((c) => c.querySelectorAll('svg.plasmid-svg, svg.mbc-map-gallery-bar').length > 0).map(cardAcc);
      const mappedInOrder = order.filter((a) => mapped.some((d) => d.accession === a));
      expect(drawnAcc(), 'the first records that have a map, all GALLERY_MAPS_DRAWN_FIRST of them').toEqual(mappedInOrder.slice(0, GALLERY_MAPS_DRAWN_FIRST));
      const text = () => words(gallery(app).textContent);
      expect(text()).toContain(subsetNote('The gallery draws maps for', GALLERY_MAPS_DRAWN_FIRST, mapped.length, 'records with a map', 'first')[0]);
      expect(text(), 'the no-map records are not counted').not.toContain(`of ${docs.length} records`);
      // With every record that has a map drawn, the gallery says nothing of a limit.
      await check(app, mapped.find((d) => d.accession === mappedInOrder[GALLERY_MAPS_DRAWN_FIRST])!, false);
      expect(drawnAcc().sort()).toEqual(mappedInOrder.slice(0, GALLERY_MAPS_DRAWN_FIRST).sort());
      expect(text()).not.toMatch(/The gallery draws maps for/);
    });
  });
});

// ─── AC5 ───

describe("US-01M7DVS2 AC5: a card shows its map's warnings as the split pane does", () => {
  const warningsIn = (scope: LiveElement, label: string) =>
    scope.querySelectorAll(`[data-mbc-result-warnings][aria-label="${label}"]`).flatMap((w) => w.querySelectorAll('p').map((p) => words(p.textContent)));

  it("US-01M7DVS2 AC5 the scan's own warnings, as the split pane shows them, and a partial scan's scope detail", async () => {
    await withApp(async (app) => {
      const { scanDocumentForMap, restrictionScopeWords } = await components();
      const gatcWarnings = scanDocumentForMap(GATC, REBASE_ENZYMES, null).scan.warnings;
      expect(gatcWarnings.length, 'the fixture makes the scan warn').toBeGreaterThan(0);
      const big = scanDocumentForMap(BIG, REBASE_ENZYMES, null);
      const detail = restrictionScopeWords(big.restrictionScope, BIG.sequence.length)!.detail;
      expect(detail).toMatch(/^Only the first 60,000 of 150,001 bp were scanned, /);
      await restore(app, [CA, GATC, BIG], CA.id);
      await checkAll(app);
      await openByToolbar(app);
      // Over GALLERY_DRAW_ON_OPEN_MAX_BP, Big_Circle is drawn only when asked (US-01M7DV75 AC3).
      await app.click(labelled(gallery(app), 'button', `Draw map of ${BIG.name}`));
      const byAcc = new Map(cards(app).map((c) => [cardAcc(c), c]));
      expect(warningsIn(byAcc.get(GATC.accession)!, 'Restriction scan warnings')).toEqual(gatcWarnings.map(words));
      expect(warningsIn(byAcc.get(CA.accession)!, 'Restriction scan warnings')).toEqual([]);
      expect(field(byAcc.get(BIG.accession)!, 'scope')).toBe(words(detail));
      expect(field(byAcc.get(GATC.accession)!, 'scope'), 'a whole scan has no scope sentence').toBe('');
      // The split pane shows the same warnings for the same document.
      await app.click(app.one('button.mbc-split-toggle'));
      await app.change(picker(app), GATC.id);
      expect(warningsIn(pane(app), 'Restriction scan warnings')).toEqual(warningsIn(byAcc.get(GATC.accession)!, 'Restriction scan warnings'));
    });
  });

  it("US-01M7DVS2 AC5 a circular card drawn at card size shows the callout note of labels left out, which the full-size map does not", async () => {
    await withApp(async (app) => {
      await restore(app, [CROWD, CB], CROWD.id, { mapLayoutMode: 'circular' });
      await app.menu('view:track-restriction-sites');
      const full = oneMap(app.canvas(), 'the main circle at full size');
      expect(full.querySelectorAll('.circular-callout-note'), 'the full-size map leaves no label out').toHaveLength(0);
      await checkAll(app);
      await openByToolbar(app);
      const card = cards(app).find((c) => cardAcc(c) === CROWD.accession)!;
      const notes = oneMap(card, 'the crowded card').querySelectorAll('.circular-callout-note');
      expect(notes, 'the card says labels were left out').toHaveLength(1);
      expect(words(notes[0].textContent)).toMatch(/^\d+ more labels? in Annotations$|^\d+ more labels? not shown$/);
    });
  });

  it('US-01M7DVS2 AC5 with a collection chosen for site scans, a card scans with it, as the split pane does', async () => {
    const ids = ['EcoRI', 'BamHI', 'HindIII', 'PstI', 'SacI', 'KpnI', 'XbaI', 'SalI', 'NcoI', 'XhoI'];
    const T0 = '2026-01-01T00:00:00.000Z';
    const storage = memoryStorage({
      'molbiocraft.enzymeCollections': JSON.stringify({ schema: 1, collections: [{ id: 'collection:six', name: 'Six cutters', enzymeIds: ids, createdAt: T0, modifiedAt: T0 }] }),
      'molbiocraft.enzymeScanCollection': JSON.stringify({ schema: 1, collectionId: 'collection:six' }),
    });
    const app = await mountApp({ storage });
    try {
      const { scanDocumentForMap } = await components();
      const members = ids.map((id) => REBASE_ENZYMES.find((e) => (e.id ?? e.name) === id)!);
      const chosen = scanDocumentForMap(LIN, REBASE_ENZYMES, { name: 'Six cutters', members, notScanned: [] }).scan.sites.length;
      const every = scanDocumentForMap(LIN, REBASE_ENZYMES, null).scan.sites.length;
      expect(chosen, 'the collection cuts the record').toBeGreaterThan(0);
      expect(chosen, 'fewer sites than every enzyme').toBeLessThan(every);
      await restore(app, [CA, LIN], CA.id);
      await checkAll(app);
      await openByToolbar(app);
      const card = cards(app).find((c) => cardAcc(c) === LIN.accession)!;
      expect(card.querySelectorAll('svg.mbc-map-gallery-bar [data-map-part="cut-site"]'), "the card draws the collection's sites").toHaveLength(chosen);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC6 ───

describe('US-01M7DVS2 AC6: Fit each map is the default, labelled not to scale', () => {
  it('US-01M7DVS2 AC6 the size choice starts on "Fit each map" and says sizes are not to scale', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB], CA.id);
      await checkAll(app);
      await openByToolbar(app);
      const fit = labelled(gallery(app), 'input[type="radio"]', 'Fit each map');
      expect(fit.checked).toBe(true);
      const described = fit.getAttribute('aria-describedby');
      expect(described).toBeTruthy();
      const note = app.all('[id]').filter((e) => e.getAttribute('id') === described);
      expect(note.map((e) => words(e.textContent))).toEqual(['Each map fitted to its card; sizes are not to scale']);
    });
  });
});

// ─── AC7 ───

describe("US-01M7DVS2 AC7: a card's Open in viewer opens its record and keeps the checked rows", () => {
  it('US-01M7DVS2 AC7 opens the right one of two same-name records, keeps the rows checked so the gallery reopens the same cards, and leaves the split pane', async () => {
    const docs = [CA, CB, TWIN_A, TWIN_B];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await primedPane(app);
      const before = paneState(app);
      await check(app, TWIN_A);
      await check(app, TWIN_B);
      expect(app.all('tr.selected-row').map((r) => rowAccession(r, docs)), 'the last row checked is the main view\'s').toEqual(['TW-BETA']);
      await openByToolbar(app);
      const first = cards(app).map(cardAcc);
      expect(first.sort()).toEqual([CA.accession, 'TW-ALPHA', 'TW-BETA'].sort());
      for (const target of [TWIN_A, TWIN_B]) {
        const card = cards(app).find((c) => cardAcc(c) === target.accession)!;
        await app.click(labelled(card, 'button', `Open ${target.name} in viewer`));
        expect(galleries(app), 'the gallery closes').toHaveLength(0);
        expect(app.all('tr.selected-row').map((r) => rowAccession(r, docs)), `${target.accession} is the main view's record`).toEqual([target.accession]);
        expect(app.activeTab()).toBe('sequence-view');
        expect(tableRows(app).filter((r) => r.querySelectorAll('input[type="checkbox"]')[0].checked).map((r) => rowAccession(r, docs)).sort(), 'the rows stay checked').toEqual(first.sort());
        expect({ ...paneState(app), focused: null }, 'the split pane is as it was').toEqual({ ...before, focused: null });
        await openByToolbar(app);
        expect(cards(app).map(cardAcc).sort(), 'Map Gallery reopens the same cards').toEqual(first.sort());
      }
    });
  });
});

// ─── AC8 ───

describe('US-01M7DVS2 AC8: View commands behind the gallery act on the focused pane', () => {
  const LEAVING: [string, string][] = [
    ['Fit', 'view:fit'], ['Reset View', 'view:reset-view'], ['Rotate Circular Map…', 'view:rotate-map'], ['Reset Rotation', 'view:reset-rotation'],
    ['Split Map & Sequence', 'view:layout-split'], ['Circular Map', 'view:layout-circular'], ['Linear Sequence', 'view:layout-linear'],
  ];

  it("US-01M7DVS2 AC8 with the main view focused, Fit, Reset View, Rotate, Reset Rotation and Map Layout close the gallery onto the main view's Sequence view; Zoom keeps it", async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await check(app, CB);
      await check(app, CA);
      for (const [label, id] of LEAVING) {
        await app.menu('view:layout-split');
        await focusMain(app);
        await rotateTo(app, app.canvas(), '90');
        await app.menu('view:zoom-in');
        await app.clickTab('document-info');
        await openByToolbar(app);
        const cardsBefore = cardViews(app);
        await app.menu(id);
        expect(galleries(app), `${label} closes the gallery`).toHaveLength(0);
        expect(app.activeTab(), `${label} shows the Sequence view`).toBe('sequence-view');
        if (label === 'Linear Sequence') {
          expect(app.canvas().querySelectorAll('svg.plasmid-svg'), 'Map Layout Linear draws no circle').toHaveLength(0);
          continue;
        }
        const main = oneMap(app.canvas(), `the main circle after ${label}`);
        if (label === 'Fit' || label === 'Reset View') expect(scaleOf(main), `${label} fits the main circle`).toBeCloseTo(1, 4);
        if (label === 'Reset View' || label === 'Reset Rotation') expect(wedge(main), `${label} turns it back`).toBe('0');
        if (label === 'Rotate Circular Map…') {
          expect(rotateDialogs(app.canvas()), 'the main view opens its rotate control').toHaveLength(1);
          await app.click(rotateDialogs(app.canvas())[0].querySelectorAll('button').filter((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'Close')[0]);
        }
        expect(cardsBefore.length).toBe(2);
      }
      // Zoom In, Zoom Out and Actual Size change the main view's zoom behind the gallery, which stays.
      await app.menu('view:layout-split');
      await app.menu('view:zoom-reset');
      await openByToolbar(app);
      const cardsBefore = cardViews(app);
      for (const [id, zoom] of [['view:zoom-in', '110%'], ['view:zoom-in', '120%'], ['view:zoom-out', '110%'], ['view:zoom-reset', '100%']]) {
        await app.menu(id);
        expect(galleries(app), `${id} leaves the gallery`).toHaveLength(1);
        expect(headerZoom(app), `${id} zooms the main view`).toBe(zoom);
        expect(cardViews(app), `${id} changes no card`).toEqual(cardsBefore);
      }
    });
  });

  it('US-01M7DVS2 AC8 a viewer tab clicked behind the gallery closes it onto that tab, the tab behind it included', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await check(app, CB);
      await check(app, CA);
      await openByToolbar(app);
      expect(app.activeTab(), 'the tab behind the gallery').toBe('sequence-view');
      await app.clickTab('document-info');
      expect(galleries(app), 'Document Info closes the gallery').toHaveLength(0);
      expect(app.activeTab()).toBe('document-info');
      expect(app.canvas().querySelectorAll('section[aria-label="Document information"]'), 'and shows its panel').toHaveLength(1);
      await openByToolbar(app);
      await app.clickTab('document-info');
      expect(galleries(app), 'the tab behind the gallery closes it too').toHaveLength(0);
      expect(app.canvas().querySelectorAll('section[aria-label="Document information"]')).toHaveLength(1);
      await openByToolbar(app);
      await app.clickTab('history-hybrid');
      expect(galleries(app), 'the hybrid studio tab closes it').toHaveLength(0);
      expect(app.activeTab()).toBe('history-hybrid');
      await openByToolbar(app);
      await app.clickTab('sequence-view');
      expect(galleries(app), 'Sequence View closes it').toHaveLength(0);
      expect(app.activeTab()).toBe('sequence-view');
      oneMap(app.canvas(), "the main view's circle, shown again");
    });
  });

  it('US-01M7DVS2 AC8 with the split pane focused, every command acts on the pane and the gallery stays, its cards unchanged', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await primedPane(app);
      await check(app, LIN);
      await check(app, CA);
      await openByToolbar(app);
      await focusPane(app);
      const cardsBefore = cardViews(app);
      const steps: [string, (s: PaneState) => void][] = [
        ['view:zoom-in', (s) => expect(s.scale).toBeGreaterThan(1)],
        ['view:fit', (s) => expect(s.scale).toBeCloseTo(1, 4)],
        ['view:zoom-in', (s) => expect(s.scale).toBeGreaterThan(1)],
        ['view:zoom-reset', (s) => expect(s.scale).toBeCloseTo(1, 4)],
        ['view:zoom-out', (s) => expect(s.scale).toBeLessThan(1)],
        ['view:reset-rotation', (s) => expect(s.wedge).toBe('0')],
        ['view:rotate-map', () => expect(rotateDialogs(pane(app))).toHaveLength(1)],
        ['view:reset-view', (s) => expect([s.scale, s.wedge]).toEqual([1, '0'])],
        ['view:layout-linear', () => undefined],
        ['view:layout-split', () => undefined],
      ];
      for (const [id, acted] of steps) {
        await app.menu(id);
        expect(galleries(app), `${id} leaves the gallery`).toHaveLength(1);
        const s = paneState(app);
        expect(s.focused, `${id} keeps the pane focused`).toBe('true');
        acted(s);
        expect(cardViews(app), `${id} changes no card`).toEqual(cardsBefore);
      }
      expect(rotateDialogs(app.canvas()).filter((d) => !pane(app).contains(d)), 'the main view opened no rotate control').toHaveLength(0);
    });
  });
});

// ─── AC9 ───

describe('US-01M7DVS2 AC9: the gallery is not saved', () => {
  it('US-01M7DVS2 AC9 a session saved while the gallery is shown writes the tab behind it and no gallery key; restoring it opens no gallery and reports nothing', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await check(app, CB);
      await app.clickTab('document-info');
      await openByToolbar(app);
      await app.menu('view:zoom-in');
      const { raw, envelope } = await autosaved(app);
      expect(envelope.workspace.viewerTab, 'the tab behind the gallery').toBe('document-info');
      expect(raw).not.toMatch(/gallery/i);
      expect(galleries(app)).toHaveLength(1);
      await app.menu('file:restore-autosave');
      expect(galleries(app), 'the restore opens no gallery').toHaveLength(0);
      expect(app.activeTab()).toBe('document-info');
      const said = statusText(app);
      expect(said).toContain('Restored workbench');
      expect(said).not.toMatch(/gallery|could not|unreadable|ignored/i);
    });
  });
});


// ─── US-01M7DV6R: each card's own selection, rotation and choice, and Compare in split ───

const cardOf = (app: AppHarness, d: SequenceDocument) => {
  const found = cards(app).filter((c) => cardAcc(c) === d.accession);
  expect(found, `one card for ${d.accession}`).toHaveLength(1);
  return found[0];
};
const cardCircle = (app: AppHarness, d: SequenceDocument) => oneMap(cardOf(app, d), `${d.name}'s card circle`);
const activeInterval = (svg: LiveElement) => svg.querySelectorAll('[data-active-interval]').map((p) => `${p.getAttribute('data-start-angle')}-${p.getAttribute('data-end-angle')}`);
const featureArc = (svg: LiveElement, name: string) => {
  const arcs = svg.querySelectorAll('[aria-label]').filter((e) => (e.getAttribute('aria-label') ?? '').startsWith(`Select ${name} (`));
  expect(arcs, `one "${name}" feature on the map`).toHaveLength(1);
  return arcs[0];
};
const chooseBox = (app: AppHarness, d: SequenceDocument) => labelled(cardOf(app, d), 'input[type="checkbox"]', `Choose ${d.name} to compare`);
const compareButton = (app: AppHarness) => labelled(gallery(app), 'button', 'Compare in split');
const compareReason = (n: number) => `Choose exactly two cards to compare (now ${n}).`;
const selectionReadout = (app: AppHarness) => { const r = app.header().querySelectorAll('.mbc-selection-readout'); return r.length ? words(r[0].textContent) : null; };
const docSplitChooser = (app: AppHarness) => labelled(app.header(), 'select', 'Document split');
const splitHostClasses = (app: AppHarness) => [...app.one('.mbc-split-host', 'the split host').classList].sort().join(' ');
const SIDE_BY_SIDE = 'is-side-by-side is-split mbc-split-host';
const TOP_BOTTOM = 'is-split is-top-bottom mbc-split-host';
const mainRecord = (app: AppHarness, docs: SequenceDocument[]) => app.all('tr.selected-row').map((r) => rowAccession(r, docs));
/** A card's own view: its circle's origin wedge and active interval (none without a circle), and its compare choice. */
const cardOwn = (app: AppHarness, d: SequenceDocument) => {
  const svg = cardOf(app, d).querySelectorAll('svg.plasmid-svg')[0];
  return { wedge: svg ? wedge(svg) : null, interval: svg ? activeInterval(svg) : [], scale: svg ? scaleOf(svg) : null, chosen: chooseBox(app, d).checked };
};
/** Turns a card's map with its own rotate control, then closes the control. */
async function rotateCard(app: AppHarness, d: SequenceDocument, deg: string) {
  await app.click(labelled(cardOf(app, d), 'button', `Rotate ${d.name}`));
  const dialogs = rotateDialogs(cardOf(app, d));
  expect(dialogs, `${d.name}'s card opens its own rotate control`).toHaveLength(1);
  const input = dialogs[0].querySelectorAll('input[aria-label="Rotation in degrees"]');
  expect(input, "the card's degree field").toHaveLength(1);
  await app.change(input[0], deg);
  const close = rotateDialogs(cardOf(app, d))[0].querySelectorAll('button').filter((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'Close');
  await app.click(close[0]);
  expect(rotateDialogs(cardOf(app, d))).toHaveLength(0);
}
const savedRotation = async (app: AppHarness) =>
  ((await autosaved(app)).envelope.workspace as { mapRotation?: Record<string, number | null> }).mapRotation ?? {};
/** A plain wheel off the map's centre, as a pointer over a card sends it; returns whether its default (scrolling the gallery) was prevented. */
async function wheelOver(app: AppHarness, svg: LiveElement, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  const scroller = svg.parentElement!;
  expect(scroller.classList.contains('plasmid-canvas-scroll'), "the map's wheel target").toBe(true);
  let prevented = true;
  await React.act(async () => {
    prevented = dispatchLiveEvent(scroller, 'wheel', { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, clientX: 40, clientY: 30, ...mods }).defaultPrevented;
  });
  await app.settle();
  return prevented;
}
/** A WebKit pinch (gesturestart, a gesturechange to twice the size, gestureend) off the map's centre; returns whether each was prevented. */
async function pinchOver(app: AppHarness, svg: LiveElement) {
  const scroller = svg.parentElement!;
  const prevented: boolean[] = [];
  for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 2], ['gestureend', 2]] as const) {
    await React.act(async () => { prevented.push(dispatchLiveEvent(scroller, type, { scale, clientX: 40, clientY: 30 }).defaultPrevented); });
  }
  await app.settle();
  return prevented;
}
async function exportCardSvg(app: AppHarness, d: SequenceDocument): Promise<{ filename: string; wedge: string | null; intervals: string[] }> {
  const triggers = cardOf(app, d).querySelectorAll('.circular-hud-actions .mbc-figure-export-trigger');
  expect(triggers, `${d.name}'s card has one figure export`).toHaveLength(1);
  await app.click(triggers[0]);
  const items = cardOf(app, d).querySelectorAll('.circular-hud-actions .mbc-figure-export-item').filter((b) => words(b.textContent).startsWith('SVG'));
  expect(items, 'the figure menu offers SVG').toHaveLength(1);
  const before = app.downloads().length;
  await app.click(items[0]);
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.svg'));
  expect(files, 'one .svg saved').toHaveLength(1);
  const text = await files[0].text();
  const tags = text.match(/<[^>]*data-map-part="origin-wedge"[^>]*>/g) ?? [];
  expect(tags, 'the file draws one origin wedge').toHaveLength(1);
  const intervals = (text.match(/<[^>]*data-active-interval[^>]*>/g) ?? []).map((t) => `${/data-start-angle="([^"]*)"/.exec(t)?.[1]}-${/data-end-angle="([^"]*)"/.exec(t)?.[1]}`);
  return { filename: files[0].filename, wedge: /data-draw-angle="([^"]*)"/.exec(tags[0] ?? '')?.[1] ?? null, intervals };
}

describe("US-01M7DV6R AC1: a card's selection and rotation are its own", () => {
  it("US-01M7DV6R AC1 a card's selection, its own rotate control and a wheel over it change nothing outside that card, and the gallery says they are not saved", async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, LIN], CA.id);
      await primedPane(app);
      await focusMain(app);
      await rotateTo(app, app.canvas(), '90');
      await app.menu('view:zoom-in');
      await checkAll(app);
      await openByToolbar(app);
      expect(words(gallery(app).textContent)).toContain('Card selections and rotations are not saved.');
      const paneBefore = { ...paneState(app), focused: null };
      const main = () => ({ readout: selectionReadout(app), zoom: headerZoom(app) });
      const mainBefore = main();
      expect(mainBefore, 'the fixture: nothing selected, the main view zoomed').toEqual({ readout: null, zoom: '110%' });
      const linParts = cardOf(app, LIN).querySelectorAll('[data-map-part]').length;
      expect(cardOwn(app, CA)).toEqual({ wedge: '90', interval: [], scale: 1, chosen: false });
      expect(cardOwn(app, CB)).toEqual({ wedge: '0', interval: [], scale: 1, chosen: false });
      const outside = async (what: string) => {
        expect(main(), `${what}: the main view's selection and zoom`).toEqual(mainBefore);
        expect({ ...paneState(app), focused: null }, `${what}: the split pane's document, view, zoom and rotation`).toEqual(paneBefore);
        expect(activeInterval(oneMap(pane(app), "the pane's circle")), `${what}: the split pane's selection`).toEqual([]);
        expect(cardOf(app, LIN).querySelectorAll('[data-map-part]').length, `${what}: the linear card`).toBe(linParts);
      };

      // A selection on Circ_A's card is drawn by that card alone.
      await app.click(featureArc(cardCircle(app, CA), 'Mark_1'));
      const caInterval = activeInterval(cardCircle(app, CA));
      expect(caInterval, "Circ_A's card draws its selection").toHaveLength(1);
      expect(cardOwn(app, CB).interval, "Circ_B's card draws none").toEqual([]);
      await outside('a selection on a card');

      // Circ_B's card (the split pane's document) turned by its own control.
      await rotateCard(app, CB, '200');
      expect(cardOwn(app, CB)).toEqual({ wedge: '200', interval: [], scale: 1, chosen: false });
      expect(cardOwn(app, CA), "Circ_A's card as it was").toEqual({ wedge: '90', interval: caInterval, scale: 1, chosen: false });
      await outside("turning Circ_B's card");
      // Circ_A's card (the main view's document) turned too, and a selection on Circ_B's card.
      await rotateCard(app, CA, '270');
      await app.click(featureArc(cardCircle(app, CB), 'Mark_1'));
      const cbInterval = activeInterval(cardCircle(app, CB));
      expect(cbInterval).toHaveLength(1);
      expect(cardOwn(app, CA)).toEqual({ wedge: '270', interval: caInterval, scale: 1, chosen: false });
      await outside("turning Circ_A's card and selecting on Circ_B's");

      // A wheel over a card zooms nothing: not the card, the main view or the pane. The card does not
      // take it either, so its map stays where it is and the wheel scrolls the gallery.
      // A pinch (a ctrl-flagged wheel, or WebKit's gesture events) moves no card either, and is kept from
      // zooming the page.
      // Each circle is laid out at its card's size, so a gesture about a pointer off its centre would move it.
      const { GALLERY_CARD_MAP_BOX } = await components();
      const liveDoc = cardCircle(app, CA).ownerDocument!;
      const layoutBefore = liveDoc.layout;
      liveDoc.layout = (el) => (el.classList.contains('plasmid-svg') ? { ...GALLERY_CARD_MAP_BOX } : layoutBefore(el));
      const views = [viewport(cardCircle(app, CA)), viewport(cardCircle(app, CB))];
      const plain = [await wheelOver(app, cardCircle(app, CA)), await wheelOver(app, cardCircle(app, CB))];
      const pinches = [
        await wheelOver(app, cardCircle(app, CA), { ctrlKey: true }), await wheelOver(app, cardCircle(app, CB), { metaKey: true }), ...(await pinchOver(app, cardCircle(app, CB))),
      ];
      liveDoc.layout = layoutBefore;
      expect([cardOwn(app, CA).scale, cardOwn(app, CB).scale], 'the cards keep their size').toEqual([1, 1]);
      expect([viewport(cardCircle(app, CA)), viewport(cardCircle(app, CB))], 'and their place').toEqual(views);
      expect(plain, 'a plain wheel over a card is left to scroll the gallery').toEqual([false, false]);
      expect(pinches, "a pinch's default (zooming the page) is prevented: ctrl wheel, meta wheel, gesture start, change and end").toEqual([true, true, true, true, true]);
      await outside('a wheel over the cards');
      // A double-click recentres a map at 100%: on a card it reaches no zoom but the card's own.
      for (const d of [CA, CB]) {
        await React.act(async () => { dispatchLiveEvent(cardCircle(app, d).parentElement!, 'dblclick', { detail: 2 }); });
        await app.settle();
      }
      expect([cardOwn(app, CA).scale, cardOwn(app, CB).scale]).toEqual([1, 1]);
      await outside('a double-click on the cards');

      // The main view's rotation of each record is as it was, saved and drawn.
      const saved = await savedRotation(app);
      expect([saved[CA.id] ?? 0, saved[CB.id] ?? 0], "the session's main-view rotations").toEqual([90, 0]);
      await closeGallery(app);
      expect(wedge(oneMap(app.canvas(), 'the main circle')), "the main view's rotation").toBe('90');
      expect(activeInterval(oneMap(app.canvas(), 'the main circle')), "the main view's selection").toEqual([]);
      expect(selectionReadout(app)).toBeNull();
      // Nothing of a card is kept: reopened, each card starts at its record's main-view rotation, unselected.
      await openByToolbar(app);
      expect([cardOwn(app, CA), cardOwn(app, CB)]).toEqual([
        { wedge: '90', interval: [], scale: 1, chosen: false }, { wedge: '0', interval: [], scale: 1, chosen: false },
      ]);
    });
  });
});

describe('US-01M7DV6R AC2: Compare in split with exactly two cards chosen', () => {
  it('US-01M7DV6R AC2 off with the count until two are chosen; opens the first chosen in card order in the main view and the second in the pane at its main-view rotation, in the last orientation, the main pane focused', async () => {
    const docs = [CA, CB, LIN, TWIN_A];
    await withApp(async (app) => {
      await restore(app, docs, CA.id, { mapRotation: { [CA.id]: 30, [CB.id]: 60, [TWIN_A.id]: 120 } });
      await checkAll(app);
      await openByToolbar(app);
      expect([CA, CB, TWIN_A].map((d) => cardOwn(app, d).wedge), "the fixture: each card at its record's main-view rotation").toEqual(['30', '60', '120']);
      expect(app.all('section.mbc-split-pane'), 'no split yet').toHaveLength(0);
      const off = (n: number) => {
        expect([compareButton(app).hasAttribute('disabled'), compareButton(app).getAttribute('title')], `${n} chosen`).toEqual([true, compareReason(n)]);
        expect(words(gallery(app).textContent), `${n} chosen: the reason is shown`).toContain(compareReason(n));
      };
      off(0);
      const order = () => cards(app).map(cardAcc);
      // Chosen against the card order, the later card first. Twin, not Circ_B: Circ_B is the document a
      // split opened the first time would show, so only Twin tells showInSplitPane's rotation from that.
      const [first, second] = [CA, TWIN_A].sort((a, b) => order().indexOf(a.accession) - order().indexOf(b.accession));
      await app.change(chooseBox(app, second), true);
      off(1);
      await app.change(chooseBox(app, first), true);
      await app.change(chooseBox(app, LIN), true);
      off(3);
      await app.change(chooseBox(app, LIN), false);
      expect(compareButton(app).hasAttribute('disabled'), 'two chosen').toBe(false);
      expect(words(gallery(app).textContent)).not.toContain('Choose exactly two cards to compare');
      // The second card's own rotation is not what the pane opens at.
      await rotateCard(app, second, '200');
      const checkedBefore = tableRows(app).filter((r) => r.querySelectorAll('input[type="checkbox"]')[0].checked).map((r) => rowAccession(r, docs)).sort();
      await app.click(compareButton(app));
      const opened = async (a: SequenceDocument, b: SequenceDocument, host: string, what: string) => {
        expect(galleries(app), `${what}: the gallery closes`).toHaveLength(0);
        expect(mainRecord(app, docs), `${what}: the first chosen is the main view's record`).toEqual([a.accession]);
        expect(app.activeTab()).toBe('sequence-view');
        expect(tableRows(app).filter((r) => r.querySelectorAll('input[type="checkbox"]')[0].checked).map((r) => rowAccession(r, docs)).sort(), `${what}: the rows stay checked`).toEqual(checkedBefore);
        expect(splitHostClasses(app), `${what}: the split's orientation`).toBe(host);
        expect(picker(app).value, `${what}: the second chosen in the pane`).toBe(b.id);
        expect(wedge(oneMap(pane(app), "the pane's circle")), `${what}: at the main view's rotation for it`).toBe(String({ [CA.id]: 30, [CB.id]: 60, [TWIN_A.id]: 120 }[b.id]));
        expect([app.canvas().getAttribute('aria-current'), pane(app).getAttribute('aria-current')], `${what}: the main pane focused`).toEqual(['true', null]);
      };
      await app.change(viewSelect(app), 'circular');
      await opened(first, second, SIDE_BY_SIDE, 'the first time');

      // Top and Bottom chosen, then Single Pane: the next compare opens Top and Bottom.
      await app.change(docSplitChooser(app), 'top-bottom');
      await app.change(docSplitChooser(app), 'single');
      expect(app.all('section.mbc-split-pane')).toHaveLength(0);
      await openByToolbar(app);
      const [third, fourth] = [CB, CA].sort((a, b) => order().indexOf(a.accession) - order().indexOf(b.accession));
      await app.change(chooseBox(app, fourth), true);
      await app.change(chooseBox(app, third), true);
      await app.click(compareButton(app));
      await opened(third, fourth, TOP_BOTTOM, 'after Top and Bottom then Single Pane');

      // With the pane focused and turned, Compare activated without a pointer (Enter or Space) still
      // focuses the main pane and opens the second at the main view's rotation for it.
      await focusPane(app);
      await rotateTo(app, pane(app), '45');
      await openByToolbar(app);
      expect(pane(app).getAttribute('aria-current'), 'the pane stays focused behind the gallery').toBe('true');
      const [fifth, sixth] = [CB, TWIN_A].sort((a, b) => order().indexOf(a.accession) - order().indexOf(b.accession));
      await app.change(chooseBox(app, fifth), true);
      await app.change(chooseBox(app, sixth), true);
      await React.act(async () => { dispatchLiveEvent(compareButton(app), 'click', { detail: 0 }); });
      await app.settle();
      await opened(fifth, sixth, TOP_BOTTOM, 'activated by key with the pane focused');
    });
  });

  it('US-01M7DV6R AC2 with either pane folded, Compare in split unfolds it at the ratio it had, so both chosen records are shown', async () => {
    const docs = [CA, CB, LIN, TWIN_A];
    await withApp(async (app) => {
      await restore(app, docs, CA.id, {
        mapRotation: { [TWIN_A.id]: 120 },
        documentSplit: { orientation: 'side-by-side', docId: CB.id, docName: CB.name, ratio: 0.3, collapsed: 'second' },
      });
      const docDivider = () => app.one('.mbc-split-host > .mbc-split-divider', 'the document split divider');
      const drawnRatio = () => docDivider().getAttribute('aria-valuenow');
      expect([splitHostClasses(app), drawnRatio()], 'the fixture: the second pane folded at 30%').toEqual([`is-collapsed-second ${SIDE_BY_SIDE}`, '100']);
      await checkAll(app);
      const order = () => cards(app).map(cardAcc);
      for (const fold of ['second', 'main'] as const) {
        if (fold === 'main') {
          docDivider().focus();
          await app.press('Home');
          expect([splitHostClasses(app), drawnRatio()], 'the fixture: the main view folded').toEqual([`is-collapsed-main ${SIDE_BY_SIDE}`, '0']);
        }
        await openByToolbar(app);
        const [first, second] = [CA, TWIN_A].sort((a, b) => order().indexOf(a.accession) - order().indexOf(b.accession));
        await app.change(chooseBox(app, first), true);
        await app.change(chooseBox(app, second), true);
        await app.click(compareButton(app));
        expect(galleries(app), `${fold} folded: the gallery closes`).toHaveLength(0);
        expect([splitHostClasses(app), drawnRatio()], `${fold} folded: both panes shown, at the ratio they had`).toEqual([SIDE_BY_SIDE, '30']);
        expect(mainRecord(app, docs), `${fold} folded: the first chosen in the main view`).toEqual([first.accession]);
        expect(picker(app).value, `${fold} folded: the second chosen in the pane`).toBe(second.id);
        expect(app.canvas().getAttribute('aria-current'), `${fold} folded: the main pane focused`).toBe('true');
      }
    });
  });
});

describe("US-01M7DV6R AC3: the table's sort orders the cards, and each card's state moves with its record", () => {
  it("US-01M7DV6R AC3 sorting by Sequence Length and by Name reorders the cards to the table, each keeping its selection, rotation and choice", async () => {
    const docs = [CA, CB, TWIN_A, LIN];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openByToolbar(app);
      await app.click(featureArc(cardCircle(app, CA), 'Mark_1'));
      await rotateCard(app, CA, '100');
      await app.change(chooseBox(app, CA), true);
      await rotateCard(app, TWIN_A, '250');
      await app.change(chooseBox(app, LIN), true);
      const states = () => Object.fromEntries(docs.map((d) => [d.accession, cardOwn(app, d)]));
      const before = states();
      expect(before[CA.accession].interval, "the fixture: Circ_A's card selected").toHaveLength(1);
      expect([before[CA.accession].wedge, before[TWIN_A.accession].wedge, before[CB.accession].wedge]).toEqual(['100', '250', '0']);
      const tableOrder = () => tableRows(app).map((r) => rowAccession(r, docs));
      const ths = app.all('table.mbc-document-table thead th');
      const sortBy = (label: string) => {
        const th = ths.filter((h) => (h.getAttribute('title') ?? '').startsWith(`Sort by ${label}`));
        expect(th, `the ${label} column`).toHaveLength(1);
        return th[0];
      };
      const orders = new Set([cards(app).map(cardAcc).join()]);
      for (const label of ['Sequence Length', 'Name']) {
        for (let pass = 0; pass < 2; pass++) {
          await app.click(sortBy(label));
          expect(cards(app).map(cardAcc), `${label}: the cards in the table's order`).toEqual(tableOrder());
          expect(states(), `${label}: each card's selection, rotation and choice moved with its record`).toEqual(before);
          orders.add(cards(app).map(cardAcc).join());
        }
      }
      expect(orders.size, 'the sorts moved the cards').toBeGreaterThan(2);
    });
  });
});

describe('US-01M7DV6R AC4: checking rows adds and removes cards; the others keep their state', () => {
  it('US-01M7DV6R AC4 a row checked or unchecked under the gallery adds or removes its card, the others keeping selection, rotation and choice; none checked says so and shows no card', async () => {
    const docs = [CA, CB, TWIN_A];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await check(app, CB);
      await check(app, TWIN_A);
      await check(app, CA, false);
      await openByToolbar(app);
      expect(cards(app).map(cardAcc), 'the fixture: Circ_B and Twin, in table order').toEqual([CB.accession, TWIN_A.accession]);
      await app.click(featureArc(cardCircle(app, TWIN_A), 'Mark_1'));
      await rotateCard(app, TWIN_A, '135');
      await app.change(chooseBox(app, TWIN_A), true);
      await rotateCard(app, CB, '15');
      await app.change(chooseBox(app, CB), true);
      const twin = cardOwn(app, TWIN_A);
      const cb = cardOwn(app, CB);
      expect([twin.interval.length, twin.wedge, twin.chosen, cb.wedge, cb.chosen]).toEqual([1, '135', true, '15', true]);
      expect(compareButton(app).hasAttribute('disabled')).toBe(false);

      // Circ_A checked: its card is added before the others, which keep theirs.
      await check(app, CA);
      expect(cards(app).map(cardAcc)).toEqual([CA.accession, CB.accession, TWIN_A.accession]);
      expect(cardOwn(app, CA), 'the added card starts fresh').toEqual({ wedge: '0', interval: [], scale: 1, chosen: false });
      expect([cardOwn(app, CB), cardOwn(app, TWIN_A)], 'the others as they were').toEqual([cb, twin]);
      // Circ_B unchecked: its card goes, and its choice is no longer counted.
      await check(app, CB, false);
      expect(cards(app).map(cardAcc)).toEqual([CA.accession, TWIN_A.accession]);
      expect(cardOwn(app, TWIN_A)).toEqual(twin);
      expect(cardOwn(app, CA)).toEqual({ wedge: '0', interval: [], scale: 1, chosen: false });
      expect([compareButton(app).hasAttribute('disabled'), compareButton(app).getAttribute('title')]).toEqual([true, compareReason(1)]);
      // D0195: a card's state is kept by its record's id while the gallery is open, so Circ_B checked
      // again comes back as it was left, its choice counted again...
      await check(app, CB);
      expect(cardOwn(app, CB), 'Circ_B checked again: as it was left').toEqual(cb);
      expect(compareButton(app).hasAttribute('disabled'), 'two chosen again').toBe(false);
      // ...and closing the gallery forgets every card's.
      await closeGallery(app);
      await openByToolbar(app);
      expect([CA, CB, TWIN_A].map((d) => cardOwn(app, d)), 'reopened: every card fresh').toEqual(
        [CA, CB, TWIN_A].map(() => ({ wedge: '0', interval: [], scale: 1, chosen: false })),
      );

      for (const d of [CA, CB, TWIN_A]) await check(app, d, false);
      expect(galleries(app), 'the gallery stays').toHaveLength(1);
      expect(cards(app)).toHaveLength(0);
      expect(words(gallery(app).textContent)).toContain('No record is checked in the document table.');
    });
  });
});

describe("US-01M7DV6R AC5: a card's figure export draws the card's rotation and selection", () => {
  it("US-01M7DV6R AC5 each card's FigureExportButton saves an SVG named for its record with the card's origin wedge and selection", async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB], CA.id);
      await checkAll(app);
      await openByToolbar(app);
      await rotateCard(app, CA, '120');
      await app.click(featureArc(cardCircle(app, CA), 'Mark_1'));
      await rotateCard(app, CB, '300');
      const caInterval = activeInterval(cardCircle(app, CA));
      expect(caInterval).toHaveLength(1);
      const caFile = await exportCardSvg(app, CA);
      expect(caFile.filename, "Circ_A's card names its record").toContain('Circ_A');
      expect(caFile.filename).not.toContain('Circ_B');
      expect([caFile.wedge, caFile.intervals], "Circ_A's card's rotation and selection").toEqual(['120', caInterval]);
      const cbFile = await exportCardSvg(app, CB);
      expect(cbFile.filename, "Circ_B's card names its record").toContain('Circ_B');
      expect(cbFile.filename).not.toContain('Circ_A');
      expect([cbFile.wedge, cbFile.intervals], "Circ_B's card's rotation, and no selection").toEqual(['300', []]);
    });
  });
});

// ─── US-01M7DV75: a labelled common scale, and maps drawn in steps ───

/** A card's drawn map (a circle or a bar), or none. */
const drawnMap = (card: LiveElement) => card.querySelectorAll('svg.plasmid-svg, svg.mbc-map-gallery-bar')[0] ?? null;
const drawnPx = (card: LiveElement) => Number(drawnMap(card)?.getAttribute('data-drawn-px'));
const cardFor = (app: AppHarness, d: SequenceDocument) => {
  const found = cards(app).filter((c) => cardAcc(c) === d.accession);
  expect(found, `one card for ${d.accession}`).toHaveLength(1);
  return found[0];
};
/** The cards that draw a map, by accession, in card order. */
const drawnCards = (app: AppHarness) => cards(app).filter((c) => drawnMap(c) !== null).map(cardAcc);
const sizeNote = (app: AppHarness, name: string) => {
  const radio = labelled(gallery(app), 'input[type="radio"]', name);
  const described = radio.getAttribute('aria-describedby');
  expect(described, `"${name}" is described by its note`).toBeTruthy();
  return { checked: radio.checked, note: app.all('[id]').filter((e) => e.getAttribute('id') === described).map((e) => words(e.textContent)) };
};
const notToScale = (card: LiveElement) => /not to scale/.test(words(card.textContent));
/** Presses Draw next until every card in reach of it is drawn. */
async function drawEvery(app: AppHarness) {
  for (let i = 0; i < 1_000; i++) {
    const next = gallery(app).querySelectorAll('button').filter((b) => /^Draw next/.test(words(b.textContent)));
    if (next.length === 0) return;
    await app.click(next[0]);
  }
  throw new Error('Draw next never went');
}
const backboneX2 = (card: LiveElement) => Number(drawnMap(card)!.querySelectorAll('line')[0].getAttribute('x2'));

describe('US-01M7DV75 AC1: Common scale draws every map at one px-per-base scale k, named by the record that sets it', () => {
  // Circular 2,686 bp, 20,000 bp and 48,502 bp, and linear 10,000 bp: one k across both kinds.
  const SMALL = doc('cs-small', 'Small_Circle', dna(2_686, 71));
  const MID = doc('cs-mid', 'Mid_Circle', dna(20_000, 73));
  const LAMBDA = doc('cs-lambda', 'Lambda_Like', dna(48_502, 79));
  const LIN10 = doc('cs-lin', 'Lin_10k', dna(10_000, 83), { topology: 'linear' });
  const ALL = [SMALL, MID, LAMBDA, LIN10];

  it('US-01M7DV75 AC1 every to-scale map is its length times k, the 48,502 bp circle fills its card and is named, a circle below the smallest is drawn at it and says not to scale, and Fit each map comes back', async () => {
    await withApp(async (app) => {
      const { GALLERY_CARD_MAP_BOX, GALLERY_MIN_CIRCLE_DIAMETER_PX, CIRCULAR_MAP_BACKBONE_R, CIRCULAR_MAP_LABEL_FLOOR_PX, fitCircularMapScale } = await components();
      const cardDiameter = 2 * CIRCULAR_MAP_BACKBONE_R * fitCircularMapScale(GALLERY_CARD_MAP_BOX.width, GALLERY_CARD_MAP_BOX.height);
      expect(GALLERY_MIN_CIRCLE_DIAMETER_PX, 'the smallest circle is set by the label floor').toBeGreaterThan(CIRCULAR_MAP_LABEL_FLOOR_PX);
      expect(GALLERY_MIN_CIRCLE_DIAMETER_PX).toBeLessThan(cardDiameter);
      await restore(app, ALL, LAMBDA.id);
      await checkAll(app);
      await openByToolbar(app);
      const fitPx = () => ALL.map((d) => drawnPx(cardFor(app, d)));
      const fitted = ALL.map((d) => (d === LIN10 ? GALLERY_CARD_MAP_BOX.width : Math.PI * cardDiameter));
      const close = (got: number[], want: number[], what: string) =>
        got.forEach((g, i) => expect(Math.abs(g - want[i]), `${what}: ${ALL[i].name} drew ${g} px, not ${want[i].toFixed(2)}`).toBeLessThanOrEqual(1));
      close(fitPx(), fitted, 'Fit each map fills each card');
      expect(sizeNote(app, 'Fit each map')).toEqual({ checked: true, note: ['Each map fitted to its card; sizes are not to scale'] });

      await app.click(labelled(gallery(app), 'input[type="radio"]', 'Common scale'));
      const k = Math.min((Math.PI * cardDiameter) / LAMBDA.sequence.length, GALLERY_CARD_MAP_BOX.width / LIN10.sequence.length);
      const minPx = Math.PI * GALLERY_MIN_CIRCLE_DIAMETER_PX;
      const want = ALL.map((d) => (d === LIN10 ? d.sequence.length * k : Math.max(d.sequence.length * k, minPx)));
      expect(SMALL.sequence.length * k, 'the fixture: the small circle falls below the smallest').toBeLessThan(minPx);
      expect(MID.sequence.length * k, 'the fixture: the mid circle stays to scale').toBeGreaterThan(minPx);
      close(fitPx(), want, 'Common scale');
      // The to-scale maps stand in the ratio of their lengths, circles and the bar alike.
      const perBase = [MID, LAMBDA, LIN10].map((d) => drawnPx(cardFor(app, d)) / d.sequence.length);
      for (const [i, d] of [MID, LAMBDA, LIN10].entries()) expect(Math.abs(perBase[i] - k) * d.sequence.length, `${d.name} at k`).toBeLessThanOrEqual(1);
      // What is said is what is drawn: the circle's view is shrunk to it, the bar's backbone runs its length.
      for (const d of [SMALL, MID, LAMBDA]) {
        const svg = drawnMap(cardFor(app, d))!;
        expect(Math.abs(scaleOf(svg) * Math.PI * cardDiameter - drawnPx(cardFor(app, d))), `${d.name}'s viewport scale`).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(backboneX2(cardFor(app, LIN10)) - LIN10.sequence.length * k), "the bar's backbone").toBeLessThanOrEqual(1);
      expect(sizeNote(app, 'Common scale')).toEqual({ checked: true, note: ['Common scale: Lambda_Like, 48,502 bp, fills its card'] });
      expect(sizeNote(app, 'Fit each map').checked).toBe(false);
      expect(ALL.map((d) => notToScale(cardFor(app, d))), 'only the circle drawn at the smallest says not to scale').toEqual([true, false, false, false]);

      await app.click(labelled(gallery(app), 'input[type="radio"]', 'Fit each map'));
      expect(sizeNote(app, 'Fit each map')).toEqual({ checked: true, note: ['Each map fitted to its card; sizes are not to scale'] });
      expect(sizeNote(app, 'Common scale').checked).toBe(false);
      close(fitPx(), fitted, 'Fit each map again');
      expect(ALL.map((d) => scaleOf(drawnMap(cardFor(app, d))!)).slice(0, 3), 'each circle at its fitted size').toEqual([1, 1, 1]);
      expect(ALL.map((d) => notToScale(cardFor(app, d)))).toEqual([false, false, false, false]);
    });
  });

  it('US-01M7DV75 AC1 a 40,000 bp bar, shorter than the longest circle, sets k when it is the map that fills its card first, and is the one named', async () => {
    const LIN40 = doc('cs-lin40', 'Lin_40k', dna(40_000, 89), { topology: 'linear' });
    const C30 = doc('cs-c30', 'Circle_30k', dna(30_000, 87));
    const SET = [LAMBDA, LIN40, C30];
    await withApp(async (app) => {
      const { GALLERY_CARD_MAP_BOX, CIRCULAR_MAP_BACKBONE_R, fitCircularMapScale } = await components();
      const cardDiameter = 2 * CIRCULAR_MAP_BACKBONE_R * fitCircularMapScale(GALLERY_CARD_MAP_BOX.width, GALLERY_CARD_MAP_BOX.height);
      const k = GALLERY_CARD_MAP_BOX.width / LIN40.sequence.length;
      expect(k, 'the fixture: the bar, not the longest record, sets k').toBeLessThan((Math.PI * cardDiameter) / LAMBDA.sequence.length);
      await restore(app, SET, LAMBDA.id);
      await checkAll(app);
      await openByToolbar(app);
      await app.click(labelled(gallery(app), 'input[type="radio"]', 'Common scale'));
      expect(sizeNote(app, 'Common scale').note).toEqual(['Common scale: Lin_40k, 40,000 bp, fills its card']);
      for (const d of SET) expect(Math.abs(drawnPx(cardFor(app, d)) - d.sequence.length * k), `${d.name} at k`).toBeLessThanOrEqual(1);
      expect(drawnPx(cardFor(app, LAMBDA)), 'the longest circle no longer fills its card').toBeLessThan(Math.PI * cardDiameter - 1);
    });
  });

  it('US-01M7DV75 AC1 a crowded circle drawn smaller under Common scale leaves labels out and says so, and no label it draws falls below the label floor on screen', async () => {
    await withApp(async (app) => {
      const { GALLERY_CARD_MAP_BOX, CIRCULAR_MAP_BACKBONE_R, CIRCULAR_MAP_LABEL_FLOOR_PX, fitCircularMapScale } = await components();
      const cardDiameter = 2 * CIRCULAR_MAP_BACKBONE_R * fitCircularMapScale(GALLERY_CARD_MAP_BOX.width, GALLERY_CARD_MAP_BOX.height);
      await restore(app, [CROWD, LAMBDA], LAMBDA.id);
      // Restriction sites off, as US-01M7DVS2 AC5 has them: the labels are the twenty features'.
      await app.menu('view:track-restriction-sites');
      await checkAll(app);
      await openByToolbar(app);
      const svg = () => drawnMap(cardFor(app, CROWD))!;
      const labels = () => svg().querySelectorAll('g[data-callout] text');
      // A label's size on screen: its font size times the circle's drawn scale (data-drawn-px is
      // the backbone's circumference on screen, 2 pi R at scale 1).
      const onScreen = () => labels().map((t) => Number(t.getAttribute('font-size')) * (drawnPx(cardFor(app, CROWD)) / (2 * Math.PI * CIRCULAR_MAP_BACKBONE_R)));
      expect(svg().querySelectorAll('[data-map-part="cut-site"]'), 'the fixture: no cut sites drawn').toHaveLength(0);
      const fitLabels = labels().length;
      expect(fitLabels, 'the fixture: the crowded circle fitted to its card draws labels').toBeGreaterThan(1);

      await app.click(labelled(gallery(app), 'input[type="radio"]', 'Common scale'));
      expect(drawnPx(cardFor(app, CROWD)), 'the fixture: the crowded circle is drawn well under its card').toBeLessThan((Math.PI * cardDiameter) / 2);
      expect(labels().length, 'the smaller circle leaves labels out').toBeLessThan(fitLabels);
      const notes = svg().querySelectorAll('.circular-callout-note');
      expect(notes, 'the smaller circle says labels were left out').toHaveLength(1);
      expect(words(notes[0].textContent)).toMatch(/^[\d,]+ more labels? in Annotations$|^[\d,]+ more labels? not shown$/);
      const sizes = onScreen();
      expect(sizes.length, 'the smaller circle still draws a label').toBeGreaterThan(0);
      for (const px of sizes) expect(px, 'no label below the floor on screen').toBeGreaterThanOrEqual(CIRCULAR_MAP_LABEL_FLOOR_PX - 0.01);
    });
  });
});

describe('US-01M7DV75 AC2: the first GALLERY_MAPS_DRAWN_FIRST maps are drawn, and Draw next draws GALLERY_DRAW_STEP more in table order', () => {
  it('US-01M7DV75 AC2 the first cards draw, each Draw next draws the next min(K, remaining) and updates the note, and the note and button go once every card is drawn', async () => {
    await withApp(async (app) => {
      const { GALLERY_MAPS_DRAWN_FIRST: N, GALLERY_DRAW_STEP: K, subsetNote } = await components();
      expect([N, K].every((v) => Number.isInteger(v) && v > 0), 'GALLERY_MAPS_DRAWN_FIRST and GALLERY_DRAW_STEP are counts').toBe(true);
      const docs = Array.from({ length: N + K + 2 }, (_, i) => doc(`st${String(i).padStart(3, '0')}`, `Step_${String(i).padStart(3, '0')}`, dna(400 + ((i * 37) % 97), 300 + i)));
      const M = docs.length;
      await restore(app, docs, docs[0].id);
      await checkAll(app);
      await openByToolbar(app);
      const order = tableRows(app).map((r) => rowAccession(r, docs));
      expect(cards(app).map(cardAcc)).toEqual(order);
      const note = () => words(gallery(app).textContent).match(/The gallery draws maps for [^.]*\./g) ?? [];
      const nextButtons = () => gallery(app).querySelectorAll('button').filter((b) => /^Draw next/.test(words(b.textContent)));
      expect(drawnCards(app), 'the first N in table order').toEqual(order.slice(0, N));
      expect(note()).toEqual(subsetNote('The gallery draws maps for', N, M, 'records with a map', 'first'));
      expect(nextButtons().map((b) => words(b.textContent))).toEqual([`Draw next ${K}`]);
      await app.click(nextButtons()[0]);
      expect(drawnCards(app), 'the next K').toEqual(order.slice(0, N + K));
      expect(note()).toEqual(subsetNote('The gallery draws maps for', N + K, M, 'records with a map', 'first'));
      expect(nextButtons()).toHaveLength(1);
      await app.click(nextButtons()[0]);
      expect(drawnCards(app), 'the last two, fewer than K').toEqual(order);
      expect(note(), 'every card drawn: no note').toEqual([]);
      expect(nextButtons(), 'and no button').toHaveLength(0);
    });
  });
});

describe('US-01M7DV75 AC3: a record longer than GALLERY_DRAW_ON_OPEN_MAX_BP is drawn only when asked', () => {
  it('US-01M7DV75 AC3 a long record among the first cards shows Draw map with its length, the record at the limit draws, and Draw map draws that card only', async () => {
    await withApp(async (app) => {
      const { GALLERY_DRAW_ON_OPEN_MAX_BP: MAX, GALLERY_MAPS_DRAWN_FIRST: N } = await components();
      expect(Number.isInteger(MAX) && MAX > 0, 'GALLERY_DRAW_ON_OPEN_MAX_BP is a length').toBe(true);
      const { restrictionScannedBp } = await components();
      expect([restrictionScannedBp(MAX), restrictionScannedBp(MAX + 1) < MAX + 1], "the limit is the scan rule's: scanned whole up to it, not past it").toEqual([MAX, true]);
      const LONG_A = doc('ln-a', 'Long_A', dna(MAX + 1, 91));
      const LONG_B = doc('ln-b', 'Long_B', dna(MAX + 1, 93), { topology: 'linear' });
      const AT_MAX = doc('ln-max', 'At_Limit', dna(MAX, 97));
      const docs = [LONG_A, LONG_B, AT_MAX, CA];
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openByToolbar(app);
      const order = cards(app).map(cardAcc);
      expect(order.every((_, i) => i < N), 'every card is among the first').toBe(true);
      expect(drawnCards(app).sort(), 'only the records within the limit').toEqual([AT_MAX.accession, CA.accession].sort());
      const drawButton = (d: SequenceDocument) => labelled(cardFor(app, d), 'button', `Draw map of ${d.name}`);
      for (const d of [LONG_A, LONG_B]) {
        const card = cardFor(app, d);
        expect(words(drawButton(d).textContent)).toBe('Draw map');
        expect(field(card, 'undrawn'), `${d.name} gives its length as the reason`).toBe(`${(MAX + 1).toLocaleString('en-US')} bp is longer than ${MAX.toLocaleString('en-US')} bp, so its map is drawn only when asked.`);
      }
      expect([AT_MAX, CA].map((d) => cardFor(app, d).querySelectorAll('button').filter((b) => words(b.textContent) === 'Draw map')).flat()).toHaveLength(0);
      await app.click(drawButton(LONG_A));
      expect(drawnCards(app).sort(), 'Long_A is drawn, Long_B is not').toEqual([LONG_A.accession, AT_MAX.accession, CA.accession].sort());
      expect(cardFor(app, LONG_A).querySelectorAll('svg.plasmid-svg'), 'as the circle it is').toHaveLength(1);
      expect(field(cardFor(app, LONG_A), 'undrawn')).toBe('');
      await app.click(drawButton(LONG_B));
      expect(drawnCards(app).sort()).toEqual(docs.map((d) => d.accession).sort());
      expect(cardFor(app, LONG_B).querySelectorAll('svg.mbc-map-gallery-bar'), 'as the bar it is').toHaveLength(1);
    });
  });
});

describe('US-01M7DV75 AC4: an undrawn card keeps its identity and opens its own record', () => {
  it('US-01M7DV75 AC4 a card past the first and two long records of one name show name, length and topology, and each Open in viewer opens its own record by id', async () => {
    await withApp(async (app) => {
      const { GALLERY_DRAW_ON_OPEN_MAX_BP: MAX, GALLERY_MAPS_DRAWN_FIRST: N } = await components();
      expect(Number.isInteger(MAX) && MAX > 0, 'GALLERY_DRAW_ON_OPEN_MAX_BP is a length').toBe(true);
      const firsts = Array.from({ length: N + 1 }, (_, i) => doc(`un${String(i).padStart(3, '0')}`, `Un_${String(i).padStart(3, '0')}`, dna(350 + i, 500 + i)));
      const TWIN_LONG_A = doc('tla', 'Twin_Long', dna(MAX + 1, 101), { accession: 'TL-ALPHA' });
      const TWIN_LONG_B = doc('tlb', 'Twin_Long', dna(MAX + 2, 103), { accession: 'TL-BETA', folder: BETA, topology: 'linear' });
      const docs = [...firsts, TWIN_LONG_A, TWIN_LONG_B];
      await restore(app, docs, firsts[0].id);
      await checkAll(app);
      await openByToolbar(app);
      const rows = tableRows(app);
      const order = rows.map((r) => rowAccession(r, docs));
      const past = docs.find((d) => d.accession === order.filter((a) => firsts.some((f) => f.accession === a))[N])!;
      const undrawn = [past, TWIN_LONG_A, TWIN_LONG_B];
      const { at } = lengthColumn(app);
      for (const d of undrawn) {
        const card = cardFor(app, d);
        expect(drawnMap(card), `${d.accession} is not drawn`).toBeNull();
        const row = rows[order.indexOf(d.accession)];
        expect([cardName(card), field(card, 'length'), field(card, 'topology')], d.accession).toEqual([
          d.name, words(row.children[at].textContent), d.topology === 'linear' ? 'Linear' : 'Circular',
        ]);
      }
      for (const d of undrawn) {
        await app.click(labelled(cardFor(app, d), 'button', `Open ${d.name} in viewer`));
        expect(galleries(app), 'the gallery closes').toHaveLength(0);
        expect(app.all('tr.selected-row').map((r) => rowAccession(r, docs)), `${d.accession} is the main view's record`).toEqual([d.accession]);
        await openByToolbar(app);
      }
    });
  });
});

// ─── US-01M7DVV8: the Compare Table ───

/** The document table's own text for a record's column, read through the shared functions (loaded after the mount). */
const docTableText = async (d: SequenceDocument, colId: string) => {
  const { computeDocumentTableMetrics, getDocumentColumnDisplayValue } = await import('../core/workbenchBatchOperations');
  return getDocumentColumnDisplayValue(d, computeDocumentTableMetrics(d), colId);
};
const CT_HEADERS = ['Name', 'Folder path', 'Type', 'Topology', 'Sequence Length', 'Annotations', '% GC', 'Modified'];
const CT_DOC_COLUMNS = ['type', 'topology', 'length', 'annotations', 'gc', 'modified'] as const;
/** A record whose docMetadata overrides the computed length and GC, so a recomputed cell differs. */
const OVR = doc('govr', 'Override_Doc', dna(2_400, 71), { docMetadata: { 'Sequence Length': '9,999 bp', '% GC': '61.5%' } } as Partial<SequenceDocument>);
/** A record with no modified date. */
const NOMOD = doc('gnomod', 'NoMod_Doc', dna(2_000, 73), { updatedAt: '' });
/** A DNA record whose length and GC are recorded blank, so the document table shows '-' for both, and whose Modified is recorded empty, which it shows blank. */
/** A protein with no modified date, so its Modified is not a protein's GC reason. */
const PROT_NOMOD = doc('gprotnomod', 'ProtNoMod_Doc', 'MKTAYIAKQRQISFVKSHFSRQ'.repeat(12), { moleculeType: 'Protein', topology: 'linear', features: [], updatedAt: '' });
const BLANK = doc('gblank', 'Blank_Doc', dna(2_200, 79), { docMetadata: { 'Sequence Length': ' ', '% GC': ' ', Modified: '' } } as Partial<SequenceDocument>);

const ctButton = (app: AppHarness) => app.one('.doc-table-toolbar button.mbc-compare-table-btn', "the table toolbar's Compare Table button");
const compareTables = (app: AppHarness) => gallery(app).querySelectorAll('table.mbc-compare-table');
const compareTable = (app: AppHarness) => { const t = compareTables(app); expect(t, 'one Compare Table in the gallery').toHaveLength(1); return t[0]; };
const ctHeaders = (app: AppHarness) => compareTable(app).querySelectorAll('thead th').map((th) => words(th.textContent).replace(/[↑↓▲▼▴▾]+$/g, '').trim());
const ctRows = (app: AppHarness) => compareTable(app).querySelectorAll('tbody tr');
const ctCells = (row: LiveElement) => row.querySelectorAll('td').map((td) => words(td.textContent));
const ctGrid = (app: AppHarness) => ctRows(app).map(ctCells);
const switchTo = (app: AppHarness, view: 'Maps' | 'Compare Table') => app.click(labelled(gallery(app), 'input', view));
async function openCompareByToolbar(app: AppHarness) {
  expect(ctButton(app).hasAttribute('disabled'), 'the Compare Table button is enabled').toBe(false);
  await app.click(ctButton(app));
}
async function openCompareByView(app: AppHarness) {
  const row = await viewRow(app, 'Compare Table');
  expect(row.hasAttribute('disabled'), 'View › Compare Table is enabled').toBe(false);
  await app.click(row);
  await closeMenus(app);
}
const folderWords = (d: SequenceDocument) => (d.folder === BETA ? `${ROOT_PATH} › ${ALPHA} › ${BETA}` : `${ROOT_PATH} › ${ALPHA}`);
/** The Compare Table's Export, saving one file in the given format: its name and text. */
async function exportCompare(app: AppHarness, format: 'TSV' | 'CSV') {
  const triggers = gallery(app).querySelectorAll('.mbc-smart-table-shell .mbc-figure-export-trigger');
  expect(triggers, "the Compare Table's Export control").toHaveLength(1);
  const before = app.downloads().length;
  await app.click(triggers[0]);
  const items = gallery(app).querySelectorAll('.mbc-figure-export-item').filter((b) => words(b.textContent).startsWith(format));
  expect(items, `the Export menu offers ${format}`).toHaveLength(1);
  await app.click(items[0]);
  const files = app.downloads().slice(before);
  expect(files, `one ${format} file saved`).toHaveLength(1);
  return { filename: files[0].filename, text: await files[0].text() };
}

/** A button in the Compare Table's own toolbar, by its title. */
const ctToolbarButton = (app: AppHarness, title: string) => {
  const b = gallery(app).querySelectorAll('.mbc-smart-table-shell button').filter((x) => x.getAttribute('title') === title);
  expect(b, `the Compare Table's "${title}" button`).toHaveLength(1);
  return b[0];
};
/** Drags one Compare Table header onto another, as the smart table reorders its columns. */
async function dragHeader(app: AppHarness, from: string, onto: string) {
  const th = (label: string) => { const t = compareTable(app).querySelectorAll('thead th').filter((x) => words(x.textContent).replace(/[↑↓▲▼▴▾]+$/g, '').trim() === label); expect(t, `the ${label} header`).toHaveLength(1); return t[0]; };
  await React.act(async () => { dispatchLiveEvent(th(from), 'dragstart'); });
  await React.act(async () => { dispatchLiveEvent(th(onto), 'dragover'); });
  await React.act(async () => { dispatchLiveEvent(th(onto), 'drop'); });
  await React.act(async () => { dispatchLiveEvent(th(from), 'dragend'); });
}

describe('US-01M7DVV8 AC1: the toolbar button and View › Compare Table open the gallery on its Compare Table, and a switch moves between the views', () => {
  it('US-01M7DVV8 AC1 both entries read the multi-record-view rule, open the Compare Table, and Maps / Compare Table switch over the same records', async () => {
    await withApp(async (app) => {
      await restore(app, [CA, CB, PROT], CA.id);
      // One checked row: both are off, with the rule's reason.
      expect([ctButton(app).hasAttribute('disabled'), ctButton(app).getAttribute('title')]).toEqual([true, reasonFor(1)]);
      expect(await viewItem(app, 'Compare Table')).toEqual([true, expect.stringContaining(reasonFor(1))]);
      await app.click(ctButton(app));
      expect(galleries(app), 'a disabled Compare Table opens nothing').toHaveLength(0);
      await check(app, PROT);
      expect(ctButton(app).getAttribute('title')).not.toBe(reasonFor(2));
      expect((await viewItem(app, 'Compare Table'))[0]).toBe(false);

      await openCompareByToolbar(app);
      expect(app.canvas().querySelectorAll('section[aria-label="Map Gallery"]'), "the gallery takes the main view's place").toHaveLength(1);
      expect(ctGrid(app).map((r) => r[0]), 'the Compare Table lists the checked records').toEqual(['Circ_A', 'Prot_Doc']);
      expect(cards(app), 'no cards under the Compare Table').toHaveLength(0);
      expect(labelled(gallery(app), 'input', 'Compare Table').checked).toBe(true);

      await switchTo(app, 'Maps');
      expect(compareTables(app), 'Maps shows no Compare Table').toHaveLength(0);
      expect(cards(app).map(cardName)).toEqual(['Circ_A', 'Prot_Doc']);
      expect(labelled(gallery(app), 'input', 'Maps').checked).toBe(true);
      // While the gallery shows its maps, the toolbar's Compare Table moves it to the table.
      await openCompareByToolbar(app);
      expect(ctGrid(app).map((r) => r[0])).toEqual(['Circ_A', 'Prot_Doc']);
      await switchTo(app, 'Maps');
      await switchTo(app, 'Compare Table');
      expect(ctGrid(app).map((r) => r[0]), 'the switch back shows the same records').toEqual(['Circ_A', 'Prot_Doc']);

      // Map Gallery still opens on the maps, and View › Compare Table on the table.
      await closeGallery(app);
      await openByToolbar(app);
      expect([cards(app).map(cardName), compareTables(app).length]).toEqual([['Circ_A', 'Prot_Doc'], 0]);
      await closeGallery(app);
      await openCompareByView(app);
      expect([ctGrid(app).map((r) => r[0]), cards(app).length]).toEqual([['Circ_A', 'Prot_Doc'], 0]);
      await openByView(app);
      expect([cards(app).map(cardName), compareTables(app).length], 'View › Map Gallery moves the open gallery to its maps').toEqual([['Circ_A', 'Prot_Doc'], 0]);
    });
  });
});

describe("US-01M7DVV8 AC2: one row per card in card order, each cell the document table's own text", () => {
  it("US-01M7DVV8 AC2 the eight columns, rows in card order after a sort, and every cell but Folder path read from the document table's functions", async () => {
    const docs = [CA, LIN, OVR, TWIN_B, RNA];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      // Sort the document table by Sequence Length, so card order is not the order the records were given in.
      await app.click(lengthColumn(app).th);
      await openByToolbar(app);
      const cardOrder = cards(app).map(cardAcc);
      expect(cardOrder, 'the fixture: the sort reorders the records').not.toEqual(docs.map((d) => d.accession));
      await switchTo(app, 'Compare Table');
      expect(ctHeaders(app)).toEqual(CT_HEADERS);
      const grid = ctGrid(app);
      expect(grid, 'one row per card').toHaveLength(cardOrder.length);
      const byAcc = new Map(docs.map((d) => [d.accession, d]));
      for (const [i, acc] of cardOrder.entries()) {
        const d = byAcc.get(acc)!;
        const own = await Promise.all(CT_DOC_COLUMNS.map((c) => docTableText(d, c)));
        expect(own.includes('-'), `the fixture: ${d.name} shows no '-'`).toBe(false);
        expect(grid[i], `row ${i}, ${d.name}`).toEqual([d.name, folderWords(d), ...own]);
      }
      // The overrides are the cells, not a recomputed length or GC.
      const ovr = grid[cardOrder.indexOf(OVR.accession)];
      expect([ovr[4], ovr[6]]).toEqual(['9,999 bp', '61.5%']);
      // The Sequence Length cell is the text of the document table's own column for that row.
      const { at } = lengthColumn(app);
      const tableLength = new Map(tableRows(app).map((r) => [rowAccession(r, docs), words(r.children[at].textContent)]));
      expect(grid.map((r) => r[4])).toEqual(cardOrder.map((a) => tableLength.get(a)));
    });
  });
});

describe("US-01M7DVV8 AC3: where the document table shows '-', the cell names why", () => {
  it('US-01M7DVV8 AC3 a protein GC, a missing Modified and a blank recorded length or GC each say n/a with the reason', async () => {
    const docs = [PROT, NOMOD, BLANK, PROT_NOMOD, CA];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      expect([await docTableText(PROT, 'gc'), await docTableText(NOMOD, 'modified'), await docTableText(BLANK, 'length'), await docTableText(BLANK, 'gc')], "the fixture: the document table shows '-'").toEqual(['-', '-', '-', '-']);
      expect([await docTableText(PROT_NOMOD, 'gc'), await docTableText(PROT_NOMOD, 'modified')], "the fixture: a protein whose GC and Modified the document table shows as '-'").toEqual(['-', '-']);
      await openCompareByToolbar(app);
      const row = (d: SequenceDocument) => { const r = ctGrid(app).filter((c) => c[0] === d.name); expect(r, `one row for ${d.name}`).toHaveLength(1); return r[0]; };
      expect(row(PROT)[6]).toBe('n/a: GC% does not apply to a protein');
      expect(row(NOMOD)[7]).toBe('n/a: not recorded');
      expect([row(PROT_NOMOD)[6], row(PROT_NOMOD)[7]], "a protein's missing Modified is not its GC reason").toEqual(['n/a: GC% does not apply to a protein', 'n/a: not recorded']);
      expect([row(BLANK)[4], row(BLANK)[6]], "a DNA record's blank GC is not a protein's").toEqual(['n/a: not recorded for this record', 'n/a: not recorded for this record']);
      expect(await docTableText(BLANK, 'modified'), 'the fixture: the document table shows a blank Modified').toBe('');
      expect(row(BLANK)[7], 'a blank cell says n/a too').toBe('n/a: not recorded');
      // Every other cell is the document table's own text, and none is '-', '0' in place of a value, or blank.
      expect(row(PROT)[4]).toBe(await docTableText(PROT, 'length'));
      expect(row(NOMOD)[6]).toBe(await docTableText(NOMOD, 'gc'));
      for (const r of ctGrid(app)) expect(r.filter((c) => c === '-' || c === ''), `row ${r[0]}`).toEqual([]);
    });
  });
});

describe('US-01M7DVV8 AC4: Export writes TSV and CSV through the shared table export; over the cap it writes every checked record', () => {
  it('US-01M7DVV8 AC4 the TSV and CSV carry the on-screen header and cells, n/a reasons included', async () => {
    const docs = [PROT, NOMOD, OVR, CA];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openCompareByToolbar(app);
      const given = ctGrid(app).map((r) => r[0]);
      // Sort the Compare Table itself by Name, so the export must follow the rows as the table draws them.
      await app.click(compareTable(app).querySelectorAll('thead th').filter((th) => words(th.textContent).startsWith('Name'))[0]);
      const headers = ctHeaders(app);
      const grid = ctGrid(app);
      expect(grid.map((r) => r[0]), 'the fixture: the sort reorders the rows').not.toEqual(given);
      expect(grid.map((r) => r[0])).toEqual([...given].sort());
      const { exportDelimitedTableViaRust } = await import('../core/workbenchBatchOperations');
      const tsv = await exportCompare(app, 'TSV');
      expect(tsv.filename.endsWith('.tsv'), tsv.filename).toBe(true);
      expect(tsv.text.trim().split(/\r?\n/).map((l) => l.split('\t'))).toEqual([headers, ...grid]);
      expect(tsv.text).toContain('n/a: GC% does not apply to a protein');
      expect(tsv.text).toContain('n/a: not recorded');
      const csv = await exportCompare(app, 'CSV');
      expect(csv.filename.endsWith('.csv'), csv.filename).toBe(true);
      expect(csv.text, 'the shared serializer over the on-screen text').toBe(exportDelimitedTableViaRust(headers, grid, ','));
      expect(csv.text).toContain('"9,999 bp"');
    });
  });

  it('US-01M7DVV8 AC4 over SPLIT_PICKER_CAP checked records the table shows the first with the subsetNote, and the export writes every one', async () => {
    await withApp(async (app) => {
      const { SPLIT_PICKER_CAP, subsetNote } = await components();
      const many = Array.from({ length: SPLIT_PICKER_CAP + 2 }, (_, i) => doc(`v${String(i).padStart(4, '0')}`, `Row_${String(i).padStart(4, '0')}`, dna(300 + i, 300 + i)));
      await restore(app, many, many[0].id);
      await checkAll(app);
      const rowNames = tableRows(app).map((r) => r.querySelectorAll('input[type="checkbox"]')[0].getAttribute('aria-label')!.replace(/^Select /, ''));
      expect(rowNames).toHaveLength(many.length);
      await openCompareByToolbar(app);
      expect(ctGrid(app).map((r) => r[0]), 'the first in table order').toEqual(rowNames.slice(0, SPLIT_PICKER_CAP));
      expect(words(gallery(app).textContent)).toContain(subsetNote('The gallery shows', SPLIT_PICKER_CAP, many.length, 'records', 'first')[0]);
      const tsv = await exportCompare(app, 'TSV');
      const lines = tsv.text.trim().split(/\r?\n/).map((l) => l.split('\t'));
      expect(lines[0]).toEqual(CT_HEADERS);
      expect(lines.slice(1).map((l) => l[0]), 'every checked record, in card order').toEqual(rowNames);
      const last = many.find((d) => d.name === rowNames[rowNames.length - 1])!;
      expect(lines[lines.length - 1]).toEqual([last.name, folderWords(last), ...(await Promise.all(CT_DOC_COLUMNS.map((c) => docTableText(last, c))))]);
    });
  });
});

describe('US-01M7DVV8 AC4: the export follows the columns and the filter on screen (D0196)', () => {
  it('US-01M7DVV8 AC4 with Modified hidden and % GC dragged before Folder path, the TSV and CSV header is the on-screen header in its order', async () => {
    const docs = [PROT, NOMOD, CA];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      await openCompareByToolbar(app);
      expect(ctHeaders(app), 'the fixture: all eight columns at first').toEqual(CT_HEADERS);
      await app.click(ctToolbarButton(app, 'Show, hide, lock, or save table columns'));
      const modified = gallery(app).querySelectorAll('.mbc-columns-check-item').filter((l) => words(l.textContent) === 'Modified');
      expect(modified, 'a Modified column toggle').toHaveLength(1);
      await app.click(modified[0].querySelectorAll('input[type="checkbox"]')[0]);
      await dragHeader(app, '% GC', 'Folder path');
      const headers = ctHeaders(app);
      expect(headers, 'the fixture: Modified hidden and % GC moved, on screen').toEqual(['Name', '% GC', 'Folder path', 'Type', 'Topology', 'Sequence Length', 'Annotations']);
      const grid = ctGrid(app);
      expect(grid.every((r) => r.length === 7), 'every on-screen row has the seven shown cells').toBe(true);
      const tsv = await exportCompare(app, 'TSV');
      expect(tsv.text.trim().split(/\r?\n/).map((l) => l.split('\t')), 'the TSV is the table on screen').toEqual([headers, ...grid]);
      expect(tsv.text).not.toContain('Modified');
      const { exportDelimitedTableViaRust } = await import('../core/workbenchBatchOperations');
      const csv = await exportCompare(app, 'CSV');
      expect(csv.text, 'the CSV is the table on screen').toBe(exportDelimitedTableViaRust(headers, grid, ','));
    });
  });

  it('US-01M7DVV8 AC4 over SPLIT_PICKER_CAP checked records, under a quick filter or a column rule the export writes only the rows shown, and no past-cap record', async () => {
    await withApp(async (app) => {
      const { SPLIT_PICKER_CAP } = await components();
      const many = Array.from({ length: SPLIT_PICKER_CAP + 2 }, (_, i) => doc(`f${String(i).padStart(4, '0')}`, `Row_${String(i).padStart(4, '0')}`, dna(300 + i, 300 + i)));
      await restore(app, many, many[0].id);
      await checkAll(app);
      await openCompareByToolbar(app);
      expect(ctRows(app), 'the fixture: the table shows the cap').toHaveLength(SPLIT_PICKER_CAP);
      const names = (text: string) => text.trim().split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]);
      const cardOrder = ctGrid(app).map((r) => r[0]).concat(many.slice(SPLIT_PICKER_CAP).map((d) => d.name));
      // With Modified hidden and no filter, every checked record is written, the past-cap ones in the shown columns too.
      await app.click(ctToolbarButton(app, 'Show, hide, lock, or save table columns'));
      await app.click(gallery(app).querySelectorAll('.mbc-columns-check-item').filter((l) => words(l.textContent) === 'Modified')[0].querySelectorAll('input[type="checkbox"]')[0]);
      const shownHeaders = CT_HEADERS.filter((h) => h !== 'Modified');
      expect(ctHeaders(app), 'the fixture: Modified hidden on screen').toEqual(shownHeaders);
      const all = (await exportCompare(app, 'TSV')).text.trim().split(/\r?\n/).map((l) => l.split('\t'));
      expect(all[0]).toEqual(shownHeaders);
      expect(all.slice(1).map((l) => l[0]), 'no filter: every checked record, in card order').toEqual(cardOrder);
      const last = many[many.length - 1];
      expect(all[all.length - 1], 'a past-cap record in the shown columns').toEqual([last.name, folderWords(last), ...(await Promise.all(CT_DOC_COLUMNS.filter((c) => c !== 'modified').map((c) => docTableText(last, c))))]);
      await app.click(ctToolbarButton(app, 'Filter rows by keyword or column rules'));
      const quick = labelled(gallery(app), 'input', 'Quick filter across table columns');
      await app.input(quick, 'Row_0000');
      expect(ctGrid(app).map((r) => r[0]), 'the quick filter shows one row').toEqual(['Row_0000']);
      expect(names((await exportCompare(app, 'TSV')).text), 'under the quick filter, the rows shown only').toEqual(['Row_0000']);
      await app.input(quick, '');
      expect(ctRows(app), 'the fixture: clearing the quick filter shows the cap again').toHaveLength(SPLIT_PICKER_CAP);
      expect(names((await exportCompare(app, 'TSV')).text), 'a cleared filter, its panel still open, writes every checked record again').toEqual(cardOrder);
      const addRule = gallery(app).querySelectorAll('button').filter((b) => words(b.textContent) === '+ Column Rule');
      expect(addRule, 'a + Column Rule button').toHaveLength(1);
      await app.click(addRule[0]);
      await app.input(labelled(gallery(app), 'input', 'Filter condition value'), 'Row_0001');
      expect(ctGrid(app).map((r) => r[0]), 'the column rule shows one row').toEqual(['Row_0001']);
      expect(names((await exportCompare(app, 'TSV')).text), 'under a column rule, the rows shown only').toEqual(['Row_0001']);
    });
  });
});

describe("US-01M7DVV8 AC5: a row's name opens its record by id", () => {
  it('US-01M7DVV8 AC5 opens the right one of two same-name records, as Open in viewer does', async () => {
    const docs = [CA, TWIN_A, TWIN_B];
    await withApp(async (app) => {
      await restore(app, docs, CA.id);
      await checkAll(app);
      const checked = () => tableRows(app).filter((r) => r.querySelectorAll('input[type="checkbox"]')[0].checked).map((r) => rowAccession(r, docs)).sort();
      const before = checked();
      expect(before).toHaveLength(3);
      for (const target of [TWIN_B, TWIN_A]) {
        await openCompareByToolbar(app);
        const rows = ctRows(app).filter((r) => ctCells(r)[0] === 'Twin' && ctCells(r)[1] === folderWords(target));
        expect(rows, `one Twin row in ${folderWords(target)}`).toHaveLength(1);
        await app.click(labelled(rows[0], 'button', `Open ${target.name} in viewer`));
        expect(galleries(app), 'the gallery closes').toHaveLength(0);
        expect(app.all('tr.selected-row').map((r) => rowAccession(r, docs)), `${target.accession} is the main view's record`).toEqual([target.accession]);
        expect(app.activeTab()).toBe('sequence-view');
        expect(checked(), 'the rows stay checked').toEqual(before);
      }
    });
  });
});
