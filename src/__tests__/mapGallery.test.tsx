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
/** View › Map Gallery: [disabled, the Function Info it shows on hover]. */
async function viewItem(app: AppHarness): Promise<[boolean, string]> {
  const row = await viewRow(app, 'Map Gallery');
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
      const EMPTY_SENTENCE = 'No record is checked in the document table: check the rows to show their maps here.';
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

