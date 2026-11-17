// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * View › Zoom's Fit, Actual Size (100%), Reset View and View's Reset Rotation, and the items greyed
 * out with the reason when the focused pane cannot use them (US-01M7DVEN), driven through the
 * mounted App:
 *
 * - AC1: each action acts on the focused pane only, through one handler for its in-app item and its
 *   native id. Each pane starts zoomed away from 100%, panned, with its linear overview zoomed in and
 *   its circle turned away from 0, so an action that does nothing, or acts on the other pane, fails.
 * - AC2: with no circle on the main view, Zoom In, Zoom Out and Actual Size are off with
 *   CIRCULAR_ONLY_HINT in the menu, the native state, the header and the shortcuts' status; Fit and
 *   Reset View are off only where the focused pane draws no sequence map, with their two sentences.
 * - AC3: View › Map Layout's circle items are off, with circularMapUnavailableReason's sentence, for a
 *   document that cannot draw a circle; ⌘1 / ⌘2 leave the stored layout and the autosave alone.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { parseMbcWorkbench } from '../core/mbcSessionFormat';
import { CIRCULAR_ONLY_HINT, circularMapUnavailableReason, buildCommandDocumentContext, commandAvailability, resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { macHost, mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

// A macOS host's Tauri runtime, for the native menu state; every other mount is a Linux host.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

vi.setConfig({ testTimeout: 120_000 });

async function withApp<T>(run: (app: AppHarness) => Promise<T>, opts: Parameters<typeof mountApp>[0] = {}): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

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
const doc = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name, accession: '', description: `${name}, built in the test`, sequence,
  moleculeType: 'DNA', topology: 'circular', folder: 'Sequences',
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z',
  features: [{ id: `${id}-mark`, name: 'Mark', type: 'misc_feature', start: 1000, end: 1600, strand: 1, color: '#3b82f6', qualifiers: {} }],
  primers: [], history: [], ...more,
} as SequenceDocument);

const CA = doc('en-a', 'Circ_A', dna(6_000, 21));
const CB = doc('en-b', 'Circ_B', dna(6_400, 23));
const LIN = doc('en-lin', 'Lin_Doc', dna(5_000, 31), { topology: 'linear' });
const RNA = doc('en-rna', 'Rna_Doc', dna(3_000, 37).replace(/T/g, 'U'), { moleculeType: 'RNA', topology: 'linear' });
const PROT = doc('en-prot', 'Prot_Doc', 'MKTAYIAKQRQISFVKSHFSRQ'.repeat(20), { moleculeType: 'Protein', topology: 'linear', features: [] });
const EMPTY = doc('en-empty', 'Empty_Doc', '', { features: [] });
const CONTIG = doc('en-contig', 'Contig_Doc', '', { features: [], docMetadata: { 'Declared Length': 5_000_000, 'Is Contig Summary': 'Yes' } } as Partial<SequenceDocument>);
const TEXT = doc('en-text', 'Text_Doc', '', { features: [], docMetadata: { 'Document Type': 'Text Document', Notes: 'A note.' } } as Partial<SequenceDocument>);
const TREE = SAMPLE_LIBRARY.find((d) => d.id === 'doc-tree-three-kingdoms')!;
const ALN = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-hiv-env')!;

const NO_MAP = 'This record has no sequence map.';
const PANE_NO_MAP = 'The focused split pane shows no sequence map.';
const PANE_NO_CIRCLE = 'The focused split pane shows no circular map.';
const LAYOUT_LINEAR = 'Map Layout is Linear; choose Split or Circular Map to rotate the map.';
const sentenceFor = (d: SequenceDocument) => circularMapUnavailableReason(buildCommandDocumentContext(d)!);

// ─── Reading and driving the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';
const pane = (app: AppHarness) => app.one('section.mbc-split-pane', 'the split view pane');
function labelled(scope: LiveElement, selector: string, name: string): LiveElement {
  const found = scope.querySelectorAll(selector).filter((c) => c.getAttribute('aria-label') === name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
}
const picker = (app: AppHarness) => labelled(pane(app), 'select', 'Document in split view');
const viewSelect = (app: AppHarness) => labelled(pane(app), 'select', 'View in split pane');
const paneBody = (app: AppHarness) => pane(app).querySelectorAll('.mbc-split-pane-body')[0];
const statusSegments = (app: AppHarness) => words(app.all('.statusbar-toast-text').map((t) => t.textContent).join(' ')).split(' · ');
const oneMap = (scope: LiveElement, what: string) => { const m = scope.querySelectorAll('svg.plasmid-svg'); expect(m, what).toHaveLength(1); return m[0]; };
const mainMap = (app: AppHarness) => oneMap(app.canvas(), "the main view's one circular map");
const paneMap = (app: AppHarness) => oneMap(pane(app), "the pane's one circular map");
const wedge = (svg: LiveElement) => svg.querySelectorAll('[data-map-part="origin-wedge"]')[0]?.getAttribute('data-draw-angle') ?? null;
/** The circle's view group transform: null only at 100% and centred. */
const viewport = (svg: LiveElement) => svg.querySelectorAll('g.plasmid-viewport-group')[0]?.getAttribute('transform') ?? null;
const scaleOf = (svg: LiveElement) => { const m = /scale\(([\d.]+)\)/.exec(viewport(svg) ?? ''); return m ? Number(m[1]) : 1; };
/** The linear overview's zoom in percent (100 = the whole sequence). */
const overviewOf = (scope: LiveElement) => {
  const o = scope.querySelectorAll('[data-overview-zoom]');
  expect(o, 'one linear overview').toHaveLength(1);
  return Number(o[0].getAttribute('data-overview-zoom'));
};
const headerZoom = (app: AppHarness) => words(app.header().querySelectorAll('button.zoom-pct-btn')[0]?.textContent);
const headerZoomButtons = (app: AppHarness) => [
  labelled(app.header(), 'button', 'Zoom Out'),
  app.header().querySelectorAll('button.zoom-pct-btn')[0],
  labelled(app.header(), 'button', 'Zoom In'),
];
const rotateDialogs = (scope: LiveElement) => scope.querySelectorAll('[role="dialog"][aria-label="Rotate Circular Map"]');

async function pointerDown(app: AppHarness, el: LiveElement) {
  const p = { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 0, clientY: 0 };
  await React.act(async () => { dispatchLiveEvent(el, 'pointerdown', { ...p, buttons: 1 }); });
  await React.act(async () => { dispatchLiveEvent(el, 'pointerup', { ...p, buttons: 0 }); });
  await app.settle();
}
const focusMain = (app: AppHarness) => pointerDown(app, app.canvas());
const focusPane = (app: AppHarness) => pointerDown(app, paneBody(app));
/** Drags the circle in `scope` by (40, -30) on its own canvas: a pan, which moves its view group. */
async function panCircle(app: AppHarness, scope: LiveElement) {
  const before = viewport(oneMap(scope, 'the circle to pan'));
  const canvas = scope.querySelectorAll('.plasmid-canvas-scroll')[0];
  const p = { pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0 };
  await React.act(async () => { dispatchLiveEvent(canvas, 'pointerdown', { ...p, buttons: 1, clientX: 200, clientY: 200 }); });
  await React.act(async () => { dispatchLiveEvent(canvas, 'pointermove', { ...p, buttons: 1, clientX: 240, clientY: 170 }); });
  await React.act(async () => { dispatchLiveEvent(canvas, 'pointerup', { ...p, buttons: 0, clientX: 240, clientY: 170 }); });
  await app.settle();
  expect(viewport(oneMap(scope, 'the panned circle')), 'the drag panned the circle').not.toBe(before);
}
/** Turns the focused pane's circle to `deg` through View › Rotate Circular Map…'s control, then closes it. */
async function rotateTo(app: AppHarness, scope: LiveElement, deg: string) {
  await app.menu('view:rotate-map');
  const field = rotateDialogs(scope)[0]?.querySelectorAll('input[aria-label="Rotation in degrees"]') ?? [];
  expect(field, 'the degree field').toHaveLength(1);
  await app.change(field[0], deg);
  const close = rotateDialogs(scope)[0].querySelectorAll('button').filter((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'Close');
  await app.click(close[0]);
}
async function zoomOverviewIn(app: AppHarness, scope: LiveElement) {
  await app.click(labelled(scope, 'button', 'Zoom in the linear map'));
}

const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
const rowLabel = (b: LiveElement) => words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent);
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 4 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
async function viewRow(app: AppHarness, path: string[]): Promise<LiveElement> {
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'View');
  if (!trigger) throw new Error('the menu bar has no View menu');
  await app.click(trigger);
  let row: LiveElement | undefined;
  for (const label of path) {
    row = menuButtons(app).find((b) => rowLabel(b) === label);
    if (!row) throw new Error(`no "${label}" in the open menu: ${menuButtons(app).map(rowLabel).join(' | ')}`);
    if (label !== path[path.length - 1]) await app.click(row);
  }
  return row!;
}
async function viewCommand(app: AppHarness, path: string[]) {
  const row = await viewRow(app, path);
  expect(row.hasAttribute('disabled'), `View › ${path.join(' › ')} is enabled`).toBe(false);
  await app.click(row);
  await closeMenus(app);
}
/** Each View row on its path: [disabled, the Function Info it shows on hover]. */
async function viewRows(app: AppHarness, paths: string[][]): Promise<[boolean, string][]> {
  const out: [boolean, string][] = [];
  for (const path of paths) {
    const row = await viewRow(app, path);
    await React.act(async () => { dispatchLiveEvent(row, 'pointerover', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); });
    await app.settle();
    const tips = app.all('[role="tooltip"]').map((t) => words(t.textContent));
    out.push([row.hasAttribute('disabled'), tips.length === 1 ? tips[0] : `${tips.length} tips`]);
    await closeMenus(app);
  }
  return out;
}
/** View › Map Layout's three items as [label, disabled, checked]. */
async function layoutItems(app: AppHarness): Promise<[string, boolean, boolean][]> {
  await viewRow(app, ['Map Layout', 'Linear Sequence']);
  const out = ['Split Map & Sequence', 'Circular Map', 'Linear Sequence'].map((label): [string, boolean, boolean] => {
    const row = menuButtons(app).find((b) => rowLabel(b) === label)!;
    return [label, row.hasAttribute('disabled'), row.getAttribute('aria-checked') === 'true'];
  });
  await closeMenus(app);
  return out;
}

async function autosaveRunsOut(app: AppHarness) {
  await React.act(async () => { vi.advanceTimersByTime(600); });
  await app.settle();
}
const autosaved = (storage: LiveStorage) => {
  const raw = storage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return { raw: raw!, workspace: parseMbcWorkbench(raw!, 'Reopened').envelope.workspace };
};

// A document with no bases opens on its Info tab, the one view the App gives it.
const restore = (app: AppHarness, docs: SequenceDocument[], active: string, mapLayoutMode: 'split' | 'circular' | 'linear' = 'split') =>
  app.restoreSession({ documents: docs, activeDocId: active, viewerTab: active === EMPTY.id ? 'document-info' : 'sequence-view', workspace: { mapLayoutMode } as never });
/** Opens the split with Circ_B in the pane on Circular Map, the main view on Circ_A in Split. */
async function openSplit(app: AppHarness, more: SequenceDocument[] = []) {
  await restore(app, [CA, CB, LIN, ...more], CA.id);
  await app.click(app.one('button.mbc-split-toggle'));
  if (picker(app).value !== CB.id) await app.change(picker(app), CB.id);
  await app.change(viewSelect(app), 'circular');
}

// ─── AC1 ───

type View = { scale: number; viewport: string | null; wedge: string | null; overview?: number };
const mainView = (app: AppHarness): View => ({ scale: scaleOf(mainMap(app)), viewport: viewport(mainMap(app)), wedge: wedge(mainMap(app)), overview: overviewOf(app.canvas()) });
const paneCircle = (app: AppHarness): View => ({ scale: scaleOf(paneMap(app)), viewport: viewport(paneMap(app)), wedge: wedge(paneMap(app)) });

/** Zooms, pans, overview-zooms and turns the main view (focused first); returns its view. */
async function primeMain(app: AppHarness): Promise<View> {
  await focusMain(app);
  await app.menu('view:zoom-in');
  await app.menu('view:zoom-in');
  await panCircle(app, app.canvas());
  await zoomOverviewIn(app, app.canvas());
  await rotateTo(app, app.canvas(), '90');
  const v = mainView(app);
  expect(v.scale, 'the main circle is zoomed away from 100%').not.toBeCloseTo(1, 4);
  expect(v.viewport, 'and drawn transformed').not.toBeNull();
  expect(v.wedge, 'and turned').toBe('90');
  expect(v.overview, 'its overview is zoomed in').toBeGreaterThan(100);
  return v;
}
/** Zooms, pans and turns the pane's circle (the pane focused); returns its view. */
async function primePane(app: AppHarness): Promise<View> {
  await focusPane(app);
  await app.menu('view:zoom-in');
  await app.menu('view:zoom-in');
  await app.menu('view:zoom-in');
  await panCircle(app, pane(app));
  await rotateTo(app, pane(app), '45');
  const v = paneCircle(app);
  expect(v.scale, 'the pane circle is zoomed away from 100%').not.toBeCloseTo(1, 4);
  expect(v.viewport, 'and drawn transformed').not.toBeNull();
  expect(v.wedge, 'and turned').toBe('45');
  return v;
}

type Action = 'Fit' | 'Actual Size (100%)' | 'Reset View' | 'Reset Rotation';
const ROUTES: Record<Action, [string, string[], string]> = {
  Fit: ['in-app', ['Zoom', 'Fit'], 'view:fit'],
  'Actual Size (100%)': ['in-app', ['Zoom', 'Actual Size (100%)'], 'view:zoom-reset'],
  'Reset View': ['in-app', ['Zoom', 'Reset View'], 'view:reset-view'],
  'Reset Rotation': ['in-app', ['Reset Rotation'], 'view:reset-rotation'],
};
/** What each action leaves of a pane's view `before`. */
function expected(action: Action, before: View): View {
  const centred = { scale: 1, viewport: null };
  if (action === 'Fit') return { ...before, ...centred, ...(before.overview !== undefined ? { overview: 100 } : {}) };
  if (action === 'Actual Size (100%)') return { ...before, ...centred };
  if (action === 'Reset View') return { ...before, ...centred, wedge: '0', ...(before.overview !== undefined ? { overview: 100 } : {}) };
  return { ...before, wedge: '0' };
}

describe('US-01M7DVEN AC1: Fit, Actual Size, Reset View and Reset Rotation act on the focused pane only', () => {
  for (const action of Object.keys(ROUTES) as Action[]) {
    it(`US-01M7DVEN AC1 ${action}, by its View item and its native id, on the main view leaves the split pane`, async () => {
      await withApp(async (app) => {
        await openSplit(app);
        const paneBefore = await primePane(app);
        const [, path, nativeId] = ROUTES[action];
        for (const route of ['in-app', 'native'] as const) {
          const before = await primeMain(app);
          if (route === 'in-app') await viewCommand(app, path);
          else await app.menu(nativeId);
          expect(mainView(app), `${route} ${action}: the main view`).toEqual(expected(action, before));
          expect(paneCircle(app), `${route} ${action}: the pane is untouched`).toEqual(paneBefore);
        }
      });
    });

    it(`US-01M7DVEN AC1 ${action}, by its View item and its native id, on the focused split pane leaves the main view`, async () => {
      await withApp(async (app) => {
        await openSplit(app);
        const mainBefore = await primeMain(app);
        const [, path, nativeId] = ROUTES[action];
        for (const route of ['in-app', 'native'] as const) {
          const before = await primePane(app);
          if (route === 'in-app') await viewCommand(app, path);
          else await app.menu(nativeId);
          expect(paneCircle(app), `${route} ${action}: the pane`).toEqual(expected(action, before));
          expect(mainView(app), `${route} ${action}: the main view is untouched`).toEqual(mainBefore);
        }
      });
    });
  }

  it("US-01M7DVEN AC1 Fit and Reset View fit the focused pane's linear overview and not the main view's; Actual Size leaves it", async () => {
    await withApp(async (app) => {
      await openSplit(app);
      const mainBefore = await primeMain(app);
      await focusPane(app);
      await app.change(viewSelect(app), 'linear');
      for (const [what, run] of [
        ['View › Zoom › Fit', () => viewCommand(app, ['Zoom', 'Fit'])],
        ['native view:fit', () => app.menu('view:fit')],
        ['View › Zoom › Reset View', () => viewCommand(app, ['Zoom', 'Reset View'])],
        ['native view:reset-view', () => app.menu('view:reset-view')],
      ] as const) {
        await zoomOverviewIn(app, pane(app));
        await zoomOverviewIn(app, pane(app));
        expect(overviewOf(pane(app)), `${what}: the pane's overview starts zoomed in`).toBeGreaterThan(100);
        await focusPane(app);
        await run();
        expect(overviewOf(pane(app)), `${what}: the pane's overview shows the whole sequence`).toBe(100);
        expect(mainView(app), `${what}: the main view is untouched`).toEqual(mainBefore);
      }
      // Actual Size on the main view leaves its overview zoomed in.
      await focusMain(app);
      await app.menu('view:zoom-reset');
      expect(mainView(app).overview, 'Actual Size leaves the main overview').toBe(mainBefore.overview);
    });
  });

  it('US-01M7DVEN AC1 from another viewer tab, Fit and Reset View first switch the main view to the Sequence view', async () => {
    await withApp(async (app) => {
      await restore(app, [CA], CA.id);
      for (const [what, run] of [
        ['native view:fit', () => app.menu('view:fit')],
        ['View › Zoom › Fit', () => viewCommand(app, ['Zoom', 'Fit'])],
        ['native view:reset-view', () => app.menu('view:reset-view')],
        ['View › Zoom › Reset View', () => viewCommand(app, ['Zoom', 'Reset View'])],
      ] as const) {
        await app.clickTab('text-view');
        expect(app.activeTab()).toBe('text-view');
        await run();
        expect(app.activeTab(), `${what} switches to the Sequence view`).toBe('sequence-view');
      }
    });
  });
});

// ─── AC2 ───

const ZOOM_ROWS = [['Zoom', 'Zoom In'], ['Zoom', 'Zoom Out'], ['Zoom', 'Actual Size (100%)']];
const FIT_ROWS = [['Zoom', 'Fit'], ['Zoom', 'Reset View']];
const ZOOM_IDS: [string, string][] = [['view:zoom-in', 'Zoom In'], ['view:zoom-out', 'Zoom Out'], ['view:zoom-reset', 'Actual Size']];
const FIT_IDS: [string, string][] = [['view:fit', 'Fit'], ['view:reset-view', 'Reset View']];

describe('US-01M7DVEN AC2: the View items are greyed out with the reason where the focused pane cannot use them', () => {
  it('US-01M7DVEN AC2 with no circle on the main view, Zoom In, Zoom Out and Actual Size are off with CIRCULAR_ONLY_HINT in the menu, the header and the shortcuts, and the stored zoom stays', async () => {
    const storage = memoryStorage();
    await withApp(async (app) => {
      await restore(app, [CA, LIN], CA.id);
      await app.menu('view:zoom-in');
      await app.menu('view:zoom-in');
      expect(headerZoom(app)).toBe('120%');
      const cases: [string, () => Promise<void>, string][] = [
        ['Map Layout Linear', () => viewCommand(app, ['Map Layout', 'Linear Sequence']), LAYOUT_LINEAR],
        ['a linear document', () => restore(app, [CA, LIN], LIN.id, 'split'), sentenceFor(LIN)!],
      ];
      for (const [state, reach, rotateReason] of cases) {
        await reach();
        if (state === 'a linear document') {
          // Reopening reset the zoom; the stored zoom for this case is the one the session opened with.
          await autosaveRunsOut(app);
        }
        const stored = headerZoom(app);
        expect(await viewRows(app, ZOOM_ROWS), `${state}: the zoom items are off with the hint`).toEqual([
          [true, CIRCULAR_ONLY_HINT], [true, CIRCULAR_ONLY_HINT], [true, CIRCULAR_ONLY_HINT],
        ]);
        expect(headerZoomButtons(app).map((b) => [b.hasAttribute('disabled'), b.getAttribute('title')]), `${state}: the header's − % + read the same rule`).toEqual([
          [true, CIRCULAR_ONLY_HINT], [true, CIRCULAR_ONLY_HINT], [true, CIRCULAR_ONLY_HINT],
        ]);
        for (const [key, label] of [['=', 'Zoom In'], ['-', 'Zoom Out'], ['0', 'Actual Size']] as const) {
          await app.press(key, { mod: true });
          expect(headerZoom(app), `${state}: ${label}'s shortcut leaves the stored zoom`).toBe(stored);
          expect(statusSegments(app), `${state}: ${label}'s shortcut says why`).toContain(`${label}: ${CIRCULAR_ONLY_HINT}`);
        }
        for (const [id, label] of ZOOM_IDS) {
          await app.menu(id);
          expect(headerZoom(app), `${state}: ${id} leaves the stored zoom`).toBe(stored);
          expect(statusSegments(app), `${state}: ${id} says why`).toContain(`${label}: ${CIRCULAR_ONLY_HINT}`);
        }
        await autosaveRunsOut(app);
        expect(autosaved(storage).workspace.zoomLevel, `${state}: the autosaved zoom`).toBe(Number(stored.replace('%', '')));
        expect(await viewRows(app, [['Reset Rotation']]), `${state}: Reset Rotation keeps the rotate-map reason`).toEqual([[true, rotateReason]]);
        expect((await viewRows(app, FIT_ROWS)).map(([off]) => off), `${state}: Fit and Reset View stay on (a linear map is drawn)`).toEqual([false, false]);
      }
    }, { storage });
  });

  it("US-01M7DVEN AC2 Fit and Reset View are off with 'This record has no sequence map.' for a main-view document with no bases or a contig summary, and on with a circle drawn", async () => {
    await withApp(async (app) => {
      for (const d of [EMPTY, CONTIG]) {
        await restore(app, [CA, d], d.id);
        const rows = await viewRows(app, FIT_ROWS);
        expect(rows, `${d.name}: the menu`).toEqual([[true, NO_MAP], [true, NO_MAP]]);
        for (const [id, label] of FIT_IDS) {
          await app.menu(id);
          expect(statusSegments(app), `${d.name}: ${id}`).toContain(`${label}: ${NO_MAP}`);
        }
      }
      for (const layout of ['split', 'circular'] as const) {
        await restore(app, [CA], CA.id, layout);
        const rows = await viewRows(app, [...ZOOM_ROWS, ...FIT_ROWS, ['Rotate Circular Map…'], ['Reset Rotation']]);
        expect(rows.map(([off]) => off), `${layout}: every item is on`).toEqual([false, false, false, false, false, false, false]);
        expect(headerZoomButtons(app).map((b) => b.hasAttribute('disabled')), `${layout}: the header is on`).toEqual([false, false, false]);
      }
    });
  });

  it("US-01M7DVEN AC2 Fit and Reset View are off with 'The focused split pane shows no sequence map.' for a pane on Info, a tree, an alignment, a text document or no document", async () => {
    await withApp(async (app) => {
      await openSplit(app, [TEXT]);
      await focusPane(app);
      expect((await viewRows(app, FIT_ROWS)).map(([off]) => off), 'on with the pane on its circle').toEqual([false, false]);
      await app.change(viewSelect(app), 'linear');
      expect((await viewRows(app, FIT_ROWS)).map(([off]) => off), 'on with the pane on Linear Map').toEqual([false, false]);
      expect(await viewRows(app, [ZOOM_ROWS[0]]), 'while the zoom items are off for it').toEqual([[true, PANE_NO_CIRCLE]]);
      const states: [string, () => Promise<void>][] = [
        ['Info', () => app.change(viewSelect(app), 'info')],
        ['a tree', () => app.change(picker(app), TREE.id)],
        ['an alignment', () => app.change(picker(app), ALN.id)],
        ['a text document', () => app.change(picker(app), TEXT.id)],
        ['no document', () => app.change(picker(app), '')],
      ];
      for (const [state, choose] of states) {
        await choose();
        await focusPane(app);
        expect(await viewRows(app, FIT_ROWS), `${state}: the menu`).toEqual([[true, PANE_NO_MAP], [true, PANE_NO_MAP]]);
        for (const [id, label] of FIT_IDS) {
          await app.menu(id);
          expect(statusSegments(app), `${state}: ${id}`).toContain(`${label}: ${PANE_NO_MAP}`);
        }
      }
      await focusMain(app);
      expect((await viewRows(app, FIT_ROWS)).map(([off]) => off), 'the main view focused: on').toEqual([false, false]);
    });
  });

  it('US-01M7DVEN AC2 the zoom-map rule reads the document too, for a caller that gives no layout', () => {
    const base = { sessionActive: true, selection: null, undoDepth: 0, redoDepth: 0 };
    for (const d of [LIN, RNA, PROT, CONTIG]) {
      expect(commandAvailability('zoom-map', { ...base, activeDoc: buildCommandDocumentContext(d) }), d.name).toEqual({ enabled: false, reason: CIRCULAR_ONLY_HINT });
    }
    expect(commandAvailability('zoom-map', { ...base, activeDoc: buildCommandDocumentContext(CA) }).enabled, 'a circular DNA document').toBe(true);
  });

  it('US-01M7DVEN AC2 the native menu state follows the same rules: zoom ids off with no circle, Fit ids off with no sequence map', async () => {
    await withApp(async (app) => {
      const native = (ids: [string, string][]) => {
        const states = app.nativeMenuStates();
        expect(states.length, 'the App sent the native menu state').toBeGreaterThan(0);
        return ids.map(([id]) => resolveNativeMenuItemEnabled(id, states[states.length - 1]));
      };
      await restore(app, [CA, LIN, EMPTY], CA.id, 'split');
      expect([native(ZOOM_IDS), native(FIT_IDS)], 'a circle in Split').toEqual([[true, true, true], [true, true]]);
      await restore(app, [CA, LIN, EMPTY], CA.id, 'circular');
      expect([native(ZOOM_IDS), native(FIT_IDS)], 'a circle in Circular Map').toEqual([[true, true, true], [true, true]]);
      await restore(app, [CA, LIN, EMPTY], CA.id, 'linear');
      expect([native(ZOOM_IDS), native(FIT_IDS)], 'Map Layout Linear').toEqual([[false, false, false], [true, true]]);
      await restore(app, [CA, LIN, EMPTY], LIN.id, 'split');
      expect([native(ZOOM_IDS), native(FIT_IDS)], 'a linear document').toEqual([[false, false, false], [true, true]]);
      await restore(app, [CA, LIN, EMPTY], EMPTY.id, 'split');
      expect(native(FIT_IDS), 'a record with no bases').toEqual([false, false]);
    }, macHost());
  });
});

// ─── AC3 ───

describe("US-01M7DVEN AC3: Map Layout's circle items are off, with the sentence, for a document that cannot draw a circle", () => {
  it('US-01M7DVEN AC3 linear DNA, RNA, a protein and a contig summary: Split and Circular off with the sentence, Linear Sequence on and checked; a circular document as before', async () => {
    await withApp(async (app) => {
      for (const d of [LIN, RNA, PROT, CONTIG]) {
        const sentence = sentenceFor(d)!;
        expect(sentence, `${d.name} has a sentence`).toBeTruthy();
        // The stored layout is Split: the checked item is the layout drawn, Linear Sequence.
        await restore(app, [CA, d], d.id, 'split');
        expect(await layoutItems(app), d.name).toEqual([
          ['Split Map & Sequence', true, false], ['Circular Map', true, false], ['Linear Sequence', false, true],
        ]);
        expect(await viewRows(app, [['Map Layout', 'Split Map & Sequence'], ['Map Layout', 'Circular Map']]), `${d.name}: their Function Info`).toEqual([
          [true, sentence], [true, sentence],
        ]);
        for (const [id, label] of [['view:layout-split', 'Split Map & Sequence'], ['view:layout-circular', 'Circular Map']]) {
          await app.menu(id);
          expect(statusSegments(app), `${d.name}: ${id}`).toContain(`${label}: ${sentence}`);
        }
      }
      for (const stored of ['split', 'circular', 'linear'] as const) {
        await restore(app, [CA], CA.id, stored);
        expect(await layoutItems(app), `circular DNA stored ${stored}`).toEqual([
          ['Split Map & Sequence', false, stored === 'split'], ['Circular Map', false, stored === 'circular'], ['Linear Sequence', false, stored === 'linear'],
        ]);
      }
    });
  });

  it('US-01M7DVEN AC3 ⌘1 and ⌘2 leave the stored layout and the autosave unchanged for such a document and say why', async () => {
    const storage = memoryStorage();
    await withApp(async (app) => {
      for (const d of [LIN, RNA, PROT, CONTIG]) {
        const sentence = sentenceFor(d)!;
        // Stored Linear, so a shortcut that wrongly set Split or Circular would change it.
        await restore(app, [CA, d], d.id, 'linear');
        await autosaveRunsOut(app);
        const before = autosaved(storage);
        expect(before.workspace.mapLayoutMode).toBe('linear');
        for (const [key, label] of [['1', 'Split Map & Sequence'], ['2', 'Circular Map']] as const) {
          await app.press(key, { mod: true });
          expect(statusSegments(app), `${d.name}: ⌘${key} says why`).toContain(`${label}: ${sentence}`);
          await autosaveRunsOut(app);
          const after = autosaved(storage);
          expect(after.workspace.mapLayoutMode, `${d.name}: ⌘${key} leaves the stored layout`).toBe('linear');
          expect(after.raw, `${d.name}: ⌘${key} leaves the autosave`).toBe(before.raw);
        }
      }
      // A circular document: the shortcuts change the layout, as before.
      await restore(app, [CA], CA.id, 'linear');
      await app.press('2', { mod: true });
      await autosaveRunsOut(app);
      expect(autosaved(storage).workspace.mapLayoutMode, 'circular DNA: ⌘2').toBe('circular');
      await app.press('1', { mod: true });
      await autosaveRunsOut(app);
      expect(autosaved(storage).workspace.mapLayoutMode, 'circular DNA: ⌘1').toBe('split');
    }, { storage });
  });

  it('US-01M7DVEN AC3 the native menu state turns view:layout-split and view:layout-circular off for such a document, Linear on', async () => {
    await withApp(async (app) => {
      const native = () => {
        const states = app.nativeMenuStates();
        return ['view:layout-split', 'view:layout-circular', 'view:layout-linear'].map((id) => resolveNativeMenuItemEnabled(id, states[states.length - 1]));
      };
      for (const d of [LIN, RNA, PROT, CONTIG]) {
        await restore(app, [CA, d], d.id, 'split');
        expect(native(), d.name).toEqual([false, false, true]);
      }
      await restore(app, [CA], CA.id, 'split');
      expect(native(), 'circular DNA').toEqual([true, true, true]);
    }, macHost());
  });
});
