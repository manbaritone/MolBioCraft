// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TA6T: the alignment studio's MSA grid keeps its own inspector (the side panel, its resize
 * handle and its icon rail, D0060), and the workbench's one inspector button, Cmd/Ctrl+Alt+I and
 * View > Panels > Inspector open and close it, as they do the inspector of every other window. App
 * draws no column of its own beside it.
 *
 * Every check runs in the real App over the live DOM (the US-01M6TB6G harness, appHarness.tsx), with
 * the record loaded through File > Restore Autosave on the tab under test, and reads App's own DOM.
 * The browser's layout is a model of a desk window (1280x800 unless a check resizes it): the split
 * layout beside the Project Explorer is the window less 280px, the side panel is as wide as App.css
 * gives its body (read with the cascade reader, cssCascade.ts, and the custom properties the studio
 * sets), the rail and the handle take their own widths beside it while App.css draws them, and the
 * grid takes the rest. An element out of the page has no box, as in a browser.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { cascaded, gridTracks, type CascadeView } from './cssCascade';
import { dispatchLiveEvent, LiveElement, memoryStorage, type Layout, type LiveStorage } from './liveDom';

// Each check launches the App afresh, some more than once.
vi.setConfig({ testTimeout: 60_000 });

const PANE_WIDTHS_KEY = 'molbiocraft.alignment.paneWidths.v1';
const WORKSPACE_LAYOUT_KEY = 'molbiocraft.workspace.layout.v1';
/** The Project Explorer and the viewer's margins beside the alignment's split layout. */
const BESIDE_SPLIT_PX = 280;
/** The rail (App.css: 34px) and the side panel's handle (5px and its 1px rule). */
const RAIL_PX = 34;
const HANDLE_PX = 6;

// ─── The desk's layout, modelled ───

interface Desk { window: number }
const splitPx = (desk: Desk) => desk.window - BESIDE_SPLIT_PX;
const viewOf = (desk: Desk): CascadeView => ({ window: desk.window, canvas: splitPx(desk) + 32 });

/** A CSS length in pixels, its custom properties read from the inline styles of the element and its ancestors. */
function resolvePx(value: string, el: LiveElement, desk: Desk): number {
  const v = value.trim();
  let m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (m) {
    for (let n: LiveElement | null = el; n; n = n.parentElement) {
      const set = n.style.getPropertyValue(m[1]);
      if (set) return resolvePx(set, el, desk);
    }
    if (m[2] === undefined) throw new Error(`${m[1]} is set on no ancestor of <${el.localName} class="${el.className}"> and has no fallback`);
    return resolvePx(m[2], el, desk);
  }
  m = /^clamp\((.+)\)$/.exec(v);
  if (m) {
    const [lo, mid, hi] = m[1].split(',').map((p) => resolvePx(p, el, desk));
    return Math.min(hi, Math.max(lo, mid));
  }
  m = /^(-?[\d.]+)px$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(-?[\d.]+)vw$/.exec(v);
  if (m) return (Number(m[1]) * desk.window) / 100;
  throw new Error(`the layout model reads no length like "${v}"`);
}

const hasClass = (el: LiveElement, cls: string) => el.classList.contains(cls);
function enclosing(el: LiveElement, cls: string): LiveElement | null {
  for (let n: LiveElement | null = el; n; n = n.parentElement) if (hasClass(n, cls)) return n;
  return null;
}
/** Whether App.css draws `el` (its display is not none) in the desk's window. */
const drawn = (el: LiveElement | undefined, desk: Desk): el is LiveElement => !!el && cascaded(el, 'display', viewOf(desk)) !== 'none';

/** The side panel's width: the inline size App.css gives its body. */
function panelBodyPx(body: LiveElement, desk: Desk): number {
  const size = cascaded(body, 'inline-size', viewOf(desk));
  if (!size) throw new Error('App.css gives the side panel no width');
  return resolvePx(size, body, desk);
}

/** The split layout's columns: the grid, then the handle and the panel with its rail while they are drawn. */
function splitColumns(split: LiveElement, desk: Desk) {
  const shell = split.children.find((c) => hasClass(c, 'mbc-aln-inspector-shell'));
  const handle = split.children.find((c) => hasClass(c, 'mbc-aln-panel-resizer'));
  const body = drawn(shell, desk) ? shell.querySelectorAll('.mbc-aln-inspector-body')[0] : undefined;
  const bodyPx = body ? panelBodyPx(body, desk) : 0;
  const gridPx = splitPx(desk) - (body ? bodyPx + RAIL_PX : 0) - (drawn(handle, desk) ? HANDLE_PX : 0);
  return { body, bodyPx, gridPx };
}

const GRID_BOXES = ['mbc-aln-canvas-pane', 'mbc-aln-canvas-root', 'mbc-aln-scroll-frame', 'mbc-aln-scroll'];
function deskLayout(desk: Desk): Layout {
  return (el) => {
    const none = { width: 0, height: 0 };
    if (!el.isConnected) return none;
    if (hasClass(el, 'mbc-aln-split-layout')) return { width: splitPx(desk), height: 600 };
    const split = enclosing(el, 'mbc-aln-split-layout');
    if (!split) return none;
    const { body, bodyPx, gridPx } = splitColumns(split, desk);
    if (GRID_BOXES.some((c) => hasClass(el, c))) return { width: gridPx, height: 420 };
    if (!body || !body.contains(el)) return none;
    if (el === body) return { width: bodyPx, height: 560 };
    // The figures fill the panel inside its padding (the gel inside its box's too).
    if (el.getAttribute('id') === 'mbc-virtual-gel-svg') return { width: bodyPx - 40, height: 300 };
    if (hasClass(el, 'mbc-aln-lengths-chart')) return { width: bodyPx - 20, height: 200 };
    return none;
  };
}

/** Mounts the App in a desk window `desk.window` wide (resizable through `desk`), and runs `run` in it. */
async function withDesk(desk: Desk, storage: LiveStorage, run: (app: AppHarness) => Promise<void>) {
  const app = await mountApp({ width: desk.window, height: 800, storage, layout: deskLayout(desk) });
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}
/** Resizes the desk's window, as a browser lays the page out again. */
async function resize(app: AppHarness, desk: Desk, width: number) {
  desk.window = width;
  app.win.innerWidth = width;
  await act(async () => { app.win.dispatchEvent(new Event('resize')); });
  await app.settle();
}

// ─── Documents built in the test ───

function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};
const BASE = lettersFrom(0x6a6e, 600);
const swap = (seq: string, col1: number) => seq.slice(0, col1 - 1) + 'ACGT'[('ACGT'.indexOf(seq[col1 - 1]) + 1) % 4] + seq.slice(col1);
/** Six members named for their organisms, 600 aligned columns. */
const COX2: SequenceDocument = {
  ...BLANK, id: 'a6t-cox2', name: 'A6T COX2 CDS', accession: 'A6T_0001', description: 'An alignment built in the test',
  sequence: BASE, folder: 'Alignments', documentKind: 'alignment',
  alignmentMeta: {
    isAligned: true,
    sequences: [
      ['Saccharomyces cerevisiae S288C mitochondrion COX2', 400],
      ['Drosophila melanogaster mitochondrion COX2', 120],
      ['Homo sapiens mitochondrion COX2', 230],
      ['Mus musculus domesticus mitochondrion COX2', 0],
      ['Arabidopsis thaliana ecotype Columbia COX2', 515],
      ['Danio rerio mitochondrion COX2', 0],
    ].map(([name, col], i) => ({ id: `a6t-m${i}`, name: String(name), sequence: col ? swap(BASE, Number(col)) : BASE })),
  },
} as SequenceDocument;

/** Opens `doc` on its Alignment tab, in a session holding it and `others`. */
const onAlignment = (app: AppHarness, doc: SequenceDocument = COX2, others: SequenceDocument[] = []) =>
  app.restoreSession({ documents: [doc, ...others], activeDocId: doc.id, viewerTab: 'sequence-alignment' });

// ─── Reading the App ───

const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
const SIDE_HANDLE = '[role="separator"][aria-label="Resize the side panel"]';
const NAME_HANDLE = '[role="separator"][aria-label="Resize the sequence name and identity column"]';
const RAIL = '[role="tablist"][aria-label="Alignment Inspector Tabs"]';

/**
 * The inspector as the App shows it on the alignment: the header button's label, App's own column
 * (its aside, its resizer, the body split's second track), and the studio's handle, panel and rail,
 * counted in the viewer canvas and in the whole page.
 */
function inspector(app: AppHarness) {
  const inCanvas = (sel: string) => app.canvas().querySelectorAll(sel).length;
  const inPage = (sel: string) => app.all(sel).length;
  return {
    button: label(app.inspectorButton()),
    appColumn: app.inspectorAside() !== null || inPage('aside.mbc-right-controls') > 0 || inPage('.mbc-inspector-resizer') > 0,
    bodySplit: gridTracks(cascaded(app.bodySplit(), 'grid-template-columns', { window: app.win.innerWidth })!),
    handle: [inCanvas(SIDE_HANDLE), inPage(SIDE_HANDLE)],
    shell: [inCanvas('.mbc-aln-inspector-shell'), inPage('.mbc-aln-inspector-shell')],
    rail: [inCanvas(RAIL), inPage(RAIL)],
  };
}
const ONE_COLUMN = ['minmax(0, 1fr)'];
const ALIGNMENT_OPEN = { button: 'Hide Alignment Controls Inspector', appColumn: false, bodySplit: ONE_COLUMN, handle: [1, 1], shell: [1, 1], rail: [1, 1] };
const ALIGNMENT_CLOSED = { button: 'Show Alignment Controls Inspector', appColumn: false, bodySplit: ONE_COLUMN, handle: [0, 0], shell: [0, 0], rail: [0, 0] };

/** The one element under `root` matching `selector` whose text reads `text`. */
function byText(root: LiveElement | AppHarness, selector: string, text: string): LiveElement {
  const found = (root instanceof LiveElement ? root.querySelectorAll(selector) : root.all(selector)).filter((e) => e.textContent.trim() === text);
  expect(found, `one ${selector} reading "${text}"`).toHaveLength(1);
  return found[0];
}
const modeTab = (app: AppHarness, name: string) => byText(app.one('[role="tablist"][aria-label="Sequence Alignment Modes"]'), 'button[role="tab"]', name);
const railTab = (app: AppHarness, name: string) => app.one(`${RAIL} button[role="tab"][aria-label="${name}"]`, `rail tab ${name}`);
const wrapBox = (app: AppHarness) => {
  const boxes = app.all('.mbc-aln-inspector-body label').filter((l) => l.querySelectorAll('span')[0]?.textContent === 'Wrap').map((l) => l.querySelectorAll('input')[0]);
  expect(boxes, 'one Wrap checkbox in the side panel').toHaveLength(1);
  return boxes[0];
};

/** The menus: the in-window menu bar of a Linux window (as the shared inspector's checks read it). */
const menuRows = (app: AppHarness, text: string) =>
  app.all('button.desktop-menu-row').filter((b) => b.querySelectorAll('.desktop-menu-label').some((s) => s.textContent.trim() === text));
const menubar = (app: AppHarness, name: string) => byText(app, '.mbc-menubar button.menu-item', name);
async function viewInspectorRow(app: AppHarness): Promise<LiveElement> {
  await app.click(menubar(app, 'View'));
  for (const name of ['Panels', 'Inspector']) {
    const rows = menuRows(app, name);
    expect(rows, `one "${name}" row`).toHaveLength(1);
    if (name === 'Inspector') return rows[0];
    await app.click(rows[0]);
  }
  throw new Error('unreachable');
}
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 2 && app.all('button.desktop-menu-row').length; i++) await app.click(menubar(app, 'View'));
  expect(app.all('button.desktop-menu-row'), 'the menus closed').toHaveLength(0);
}
const rowState = (row: LiveElement) => ({ checked: row.getAttribute('aria-checked'), disabled: row.hasAttribute('disabled') });

/** The three routes to the shared toggle. */
const ROUTES: [string, (app: AppHarness) => Promise<void>][] = [
  ['the header button', async (app) => { await app.click(app.inspectorButton()!); }],
  ['Ctrl+Alt+I', async (app) => { await app.press('i', { mod: true, alt: true }); }],
  ['View > Panels > Inspector', async (app) => {
    await app.click(await viewInspectorRow(app));
    await closeMenus(app);
  }],
];

let pointer = 100;
/** A drag of `handle` by `dx`: a press on it, a move and a release anywhere in the window. */
async function drag(app: AppHarness, handle: LiveElement, dx: number) {
  const pointerId = ++pointer;
  const at = { clientY: 300, pointerId, pointerType: 'mouse', isPrimary: true };
  await act(async () => { dispatchLiveEvent(handle, 'pointerdown', { ...at, clientX: 700, button: 0, buttons: 1 }); });
  await act(async () => { dispatchLiveEvent(app.doc.body, 'pointermove', { ...at, clientX: 700 + dx, buttons: 1 }); });
  await act(async () => { dispatchLiveEvent(app.doc.body, 'pointerup', { ...at, clientX: 700 + dx, buttons: 0 }); });
  await app.settle();
}
const numAttr = (el: LiveElement, attr: string) => Number(el.getAttribute(attr));
const storedPaneWidths = (s: LiveStorage) => JSON.parse(s.getItem(PANE_WIDTHS_KEY) ?? 'null') as null | { sidePanelPx: number | null; nameColumnPx: number };
const storedSharedWidth = (s: LiveStorage) => (JSON.parse(s.getItem(WORKSPACE_LAYOUT_KEY) ?? 'null') as null | { inspectorWidthPx?: number })?.inspectorWidthPx;

/** The side panel's and the grid's widths as laid out now, and the widths the studio says it has. */
function widths(app: AppHarness, desk: Desk) {
  const split = app.one('.mbc-aln-split-layout', 'split layout');
  const shell = app.one('.mbc-aln-inspector-shell', 'side panel');
  const { bodyPx, gridPx } = splitColumns(split, desk);
  return {
    panel: bodyPx,
    sized: shell.classList.contains('is-sized'),
    handle: numAttr(app.one(SIDE_HANDLE), 'aria-valuenow'),
    grid: gridPx,
    name: app.one('.mbc-aln-canvas-root').style.getPropertyValue('--mbc-aln-name-w'),
    nameHandle: numAttr(app.one(NAME_HANDLE), 'aria-valuenow'),
  };
}

// ─── AC1 ───

describe('the shared toggle and the alignment inspector (AC1)', () => {
  it("opens and closes the alignment's own inspector with the shared toggle", async () => {
    const desk = { window: 1280 };
    await withDesk(desk, memoryStorage(), async (app) => {
      await onAlignment(app);
      // The header shows the button, App draws no column, and the studio draws its own panel.
      expect(inspector(app), 'on the MSA grid').toEqual(ALIGNMENT_OPEN);
      expect(app.header().querySelectorAll('.mbc-viewer-zoom-controls button').map(label).filter(Boolean).pop(), "the button is the zoom controls' last").toBe('Hide Alignment Controls Inspector');
      const split = () => app.one('.mbc-aln-split-layout', 'split layout');
      expect(split().children.map((k) => k.getAttribute('role') ?? k.className), 'the grid, the handle and the panel').toEqual(['mbc-aln-canvas-pane', 'separator', 'mbc-aln-inspector-shell']);
      let row = await viewInspectorRow(app);
      expect(rowState(row), 'View > Panels > Inspector, checked').toEqual({ checked: 'true', disabled: false });
      await closeMenus(app);

      for (const [route, toggle] of ROUTES) {
        await toggle(app);
        expect(inspector(app), `${route} closes it`).toEqual(ALIGNMENT_CLOSED);
        expect(app.activeTab(), `${route}: the tab stays`).toBe('sequence-alignment');
        // The grid stays, with its action bar, and has the split layout to itself.
        expect(split().children.map((k) => k.className), `${route}: the grid alone`).toEqual(['mbc-aln-canvas-pane']);
        expect(app.canvas().querySelectorAll('.mbc-aln-action-toolbar button[title="Fit the whole alignment width in the window"]'), `${route}: the action bar stays`).toHaveLength(1);
        row = await viewInspectorRow(app);
        expect(rowState(row), `${route}: View > Panels > Inspector, unchecked`).toEqual({ checked: 'false', disabled: false });
        await closeMenus(app);

        await toggle(app);
        expect(inspector(app), `${route} opens it again`).toEqual(ALIGNMENT_OPEN);
        expect(split().children.map((k) => k.getAttribute('role') ?? k.className), `${route}: the panel is back beside the grid`).toEqual(['mbc-aln-canvas-pane', 'separator', 'mbc-aln-inspector-shell']);
      }

      // A route closes it and another opens it: the three are one toggle.
      await app.press('i', { mod: true, alt: true });
      expect(inspector(app)).toEqual(ALIGNMENT_CLOSED);
      await app.click(app.inspectorButton()!);
      expect(inspector(app)).toEqual(ALIGNMENT_OPEN);
    });
  });
});

// ─── AC2 ───

describe("the alignment's own widths (AC2)", () => {
  it("keeps the alignment's own widths across a close and reopen", async () => {
    // The shared inspector was left 400px wide, so a panel that took its width would be told apart.
    const storage = memoryStorage({ [WORKSPACE_LAYOUT_KEY]: JSON.stringify({ inspectorWidthPx: 400 }) });
    const desk = { window: 1280 };
    const SHARED_UNTOUCHED = (app: AppHarness, when: string) => {
      expect(app.bodySplit().style.getPropertyValue('--mbc-inspector-width'), `${when}: the shared width App lays out`).toBe('400px');
      expect(storedSharedWidth(storage), `${when}: the shared width App keeps`).toBe(400);
      for (const el of [app.one('.mbc-aln-inspector-shell'), app.one('.mbc-aln-inspector-body')]) {
        expect(el.style.getPropertyValue('--mbc-inspector-width'), `${when}: not set on the panel`).toBe('');
        expect(cascaded(el, 'inline-size', viewOf(desk)) ?? '', `${when}: not read by the panel`).not.toContain('--mbc-inspector-width');
      }
    };
    await withDesk(desk, storage, async (app) => {
      await onAlignment(app);
      // Before a drag: the responsive widths (264px on a settings tab, clamp(264px, 40vw, 520px)
      // with an analysis open), the 248px name column, and nothing stored under the key.
      expect(widths(app, desk), 'before a drag').toEqual({ panel: 264, sized: false, handle: 264, grid: 1000 - 264 - 40, name: '248px', nameHandle: 248 });
      await app.click(railTab(app, 'Lengths Graph'));
      expect(widths(app, desk).panel, 'an analysis open, 40vw of 1280px').toBe(512);
      await app.click(railTab(app, 'General'));
      expect(storedPaneWidths(storage), 'nothing stored before a drag').toBeNull();
      SHARED_UNTOUCHED(app, 'before a drag');

      // Dragged: the panel to 500px, the name column to 300px; both kept under the key.
      await drag(app, app.one(SIDE_HANDLE), -236);
      await drag(app, app.one(NAME_HANDLE), 52);
      const dragged = { panel: 500, sized: true, handle: 500, grid: 1000 - 500 - 40, name: '300px', nameHandle: 300 };
      expect(widths(app, desk), 'dragged').toEqual(dragged);
      expect(storedPaneWidths(storage)).toEqual({ sidePanelPx: 500, nameColumnPx: 300 });
      SHARED_UNTOUCHED(app, 'after the drags');

      // Closed: the name column keeps its width, and nothing stored changes.
      await app.press('i', { mod: true, alt: true });
      expect(inspector(app), 'closed').toEqual(ALIGNMENT_CLOSED);
      expect([app.one('.mbc-aln-canvas-root').style.getPropertyValue('--mbc-aln-name-w'), numAttr(app.one(NAME_HANDLE), 'aria-valuenow')]).toEqual(['300px', 300]);
      expect(storedPaneWidths(storage)).toEqual({ sidePanelPx: 500, nameColumnPx: 300 });

      // Opened again, the dragged widths come back, on a settings tab and on an analysis.
      await app.click(app.inspectorButton()!);
      expect(widths(app, desk), 'reopened').toEqual(dragged);
      await app.click(railTab(app, 'Virtual Gel'));
      expect(widths(app, desk), 'reopened, on an analysis').toEqual(dragged);
      await app.click(railTab(app, 'General'));
      SHARED_UNTOUCHED(app, 'reopened');

      // The bounds are unchanged: the panel 300px and up, leaving the grid 360px (600px here); the
      // name column 160 to 480px.
      await drag(app, app.one(SIDE_HANDLE), -2000);
      expect([widths(app, desk).panel, widths(app, desk).grid, numAttr(app.one(SIDE_HANDLE), 'aria-valuemax')], 'widest, beside a 360px grid').toEqual([600, 360, 600]);
      await drag(app, app.one(SIDE_HANDLE), 2000);
      expect(widths(app, desk).panel, 'narrowest').toBe(300);
      await drag(app, app.one(NAME_HANDLE), 2000);
      expect(widths(app, desk).nameHandle, 'the widest name column').toBe(480);
      await drag(app, app.one(NAME_HANDLE), -2000);
      expect(widths(app, desk).nameHandle, 'the narrowest name column').toBe(160);
      await drag(app, app.one(SIDE_HANDLE), -220);
      await drag(app, app.one(NAME_HANDLE), 140);
      expect(storedPaneWidths(storage)).toEqual({ sidePanelPx: 520, nameColumnPx: 300 });

      // A close and reopen by View > Panels > Inspector keeps them too.
      for (let i = 0; i < 2; i++) {
        await app.click(await viewInspectorRow(app));
        await closeMenus(app);
      }
      expect(widths(app, desk), 'reopened by the menu').toEqual({ panel: 520, sized: true, handle: 520, grid: 1000 - 520 - 40, name: '300px', nameHandle: 300 });
      SHARED_UNTOUCHED(app, 'at the bounds');
    });

    // Restarted, in a wider window: the stored widths, and the panel's 720px maximum.
    const wide = { window: 1680 };
    await withDesk(wide, storage, async (app) => {
      await onAlignment(app);
      expect(widths(app, wide), 'restarted').toEqual({ panel: 520, sized: true, handle: 520, grid: 1400 - 520 - 40, name: '300px', nameHandle: 300 });
      // Closed and opened again, then dragged as wide as it goes.
      await app.press('i', { mod: true, alt: true });
      await app.press('i', { mod: true, alt: true });
      await drag(app, app.one(SIDE_HANDLE), -2000);
      expect(widths(app, wide).panel, 'no wider than 720px').toBe(720);
      expect(storedPaneWidths(storage)).toEqual({ sidePanelPx: 720, nameColumnPx: 300 });
      expect(storedSharedWidth(storage), 'the shared width App keeps').toBe(400);
    });
  });
});

// ─── AC3 ───

describe('the freed width and the analyses (AC3)', () => {
  it('gives the grid the freed width while closed and refits the analyses on reopening', async () => {
    const desk = { window: 1280 };
    await withDesk(desk, memoryStorage(), async (app) => {
      await onAlignment(app);
      const split = () => app.one('.mbc-aln-split-layout', 'split layout');
      const lineWidths = () => app.canvas().querySelectorAll('.mbc-aln-line').map((l) => Number.parseFloat(String(l.style.width)));
      const widest = () => {
        const all = lineWidths();
        expect(all.length, 'the grid draws lines').toBeGreaterThan(0);
        return Math.max(...all);
      };
      const fit = () => app.click(app.one('.mbc-aln-action-toolbar button[title="Fit the whole alignment width in the window"]'));
      const OPEN_GRID = 1000 - 264 - 40;

      // Open, Fit to window fits the grid beside the panel.
      expect(splitColumns(split(), desk).gridPx).toBe(OPEN_GRID);
      await fit();
      expect(widest(), 'fitted beside the panel: within the grid').toBeLessThanOrEqual(OPEN_GRID);
      expect(widest(), 'fitted beside the panel: filling it').toBeGreaterThan(OPEN_GRID - 40);

      // Closed, the grid's track takes the split layout, and Fit to window uses all of it.
      await app.press('i', { mod: true, alt: true });
      expect(gridTracks(cascaded(split(), 'grid-template-columns', viewOf(desk))!), "the split layout's tracks: the grid's, then the handle's and the panel's").toEqual(['minmax(0, 1fr)', 'auto', 'auto']);
      expect(split().children.map((k) => k.className), 'only the grid sits in them').toEqual(['mbc-aln-canvas-pane']);
      expect(splitColumns(split(), desk).gridPx).toBe(1000);
      await fit();
      expect(widest(), 'fitted while closed: within the grid').toBeLessThanOrEqual(1000);
      expect(widest(), 'fitted while closed: filling the freed width').toBeGreaterThan(1000 - 40);

      // Wrapped at 100%, the lines break within the grid beside the panel, and within the freed
      // width once it is closed.
      await app.press('i', { mod: true, alt: true });
      await app.click(app.one('.mbc-aln-action-toolbar button[title="Zoom to 100% (residue letters visible)"]'));
      await app.change(wrapBox(app), true);
      expect(app.canvas().querySelectorAll('.mbc-aln-header'), 'wrapped: no sticky ruler').toHaveLength(0);
      const wrappedOpen = widest();
      expect(wrappedOpen, 'wrapped beside the panel').toBeLessThanOrEqual(OPEN_GRID);
      await app.press('i', { mod: true, alt: true });
      expect(widest(), 'wrapped while closed: within the grid').toBeLessThanOrEqual(1000);
      expect(widest(), 'wrapped while closed: into the freed width').toBeGreaterThan(OPEN_GRID);
      await app.press('i', { mod: true, alt: true });
      expect(widest(), 'wrapped again beside the panel').toBe(wrappedOpen);

      // The Lengths Graph, drawn at the panel's width less its padding: 40vw of 1280px is 512px.
      const chartWidth = () => Number(app.one('svg.mbc-aln-lengths-chart', 'lengths chart').getAttribute('viewBox')!.split(/\s+/)[2]);
      await app.click(railTab(app, 'Lengths Graph'));
      expect([widths(app, desk).panel, chartWidth()]).toEqual([512, 492]);
      // Closed while the window narrows to 1180px, it reopens refitted to the 472px panel.
      await app.press('i', { mod: true, alt: true });
      await resize(app, desk, 1180);
      await app.press('i', { mod: true, alt: true });
      expect([widths(app, desk).panel, chartWidth()], 'the Lengths Graph, reopened').toEqual([472, 452]);

      // The Virtual Gel, drawn at the panel's width less its padding, its labels never under 11px.
      const gel = () => app.one('svg[id="mbc-virtual-gel-svg"]', 'gel');
      const labelUnits = () => [...new Set(gel().querySelectorAll('text').map((t) => Number(t.getAttribute('font-size'))))];
      const onScreen = (gelPx: number) => labelUnits().map((u) => (u * gelPx) / 480);
      await app.click(railTab(app, 'Virtual Gel'));
      expect(labelUnits().length, 'the gel draws labels').toBeGreaterThan(0);
      const before = Math.max(...labelUnits());
      for (const px of onScreen(472 - 40)) expect(px, 'a gel label in the 472px panel').toBeGreaterThanOrEqual(11 - 1e-6);
      // Closed while the window narrows to 1080px, it reopens refitted to the 432px panel.
      await app.press('i', { mod: true, alt: true });
      await resize(app, desk, 1080);
      await app.press('i', { mod: true, alt: true });
      expect(widths(app, desk).panel).toBe(432);
      for (const px of onScreen(432 - 40)) expect(px, 'a gel label in the reopened 432px panel').toBeGreaterThanOrEqual(11 - 1e-6);
      expect(Math.max(...labelUnits()), 'drawn narrower, its labels are larger in its own units').toBeGreaterThan(before);
    });
  });
});

// ─── AC4 ───

// The studio's own panel is the MSA grid's alone: Pairwise Alignment and Dotplot set their options in
// App's column instead (US-01M6TAA4, D0075).
describe('the traces and read QC views (AC4)', () => {
  it('offers no inspector on the chromatogram and QC report views', async () => {
    const desk = { window: 1280 };
    const NONE = { button: null, appColumn: false, bodySplit: ONE_COLUMN, handle: [0, 0], shell: [0, 0], rail: [0, 0] };
    const CONTIG_OPEN = { ...ALIGNMENT_OPEN, button: 'Hide Contig Controls Inspector' };
    await withDesk(desk, memoryStorage(), async (app) => {
      const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
      const byId = (id: string) => SAMPLE_LIBRARY.find((d) => d.id === id)!;
      // A contig of traced Sanger reads, in a session that holds the reads (the traces are theirs).
      const contig = byId('doc-contig-coi-assembly');
      const traced = SAMPLE_LIBRARY.filter((d) => d.id !== contig.id && d.chromatogram && d.folder === contig.folder);
      expect(traced.length, 'the traced reads beside the contig').toBeGreaterThan(0);
      await onAlignment(app, contig, traced);
      expect(inspector(app), "the contig's MSA grid").toEqual(CONTIG_OPEN);

      await app.click(modeTab(app, 'Chromatogram'));
      expect(app.canvas().querySelectorAll('.mbc-trace'), 'the trace viewer is drawn').toHaveLength(1);
      expect(inspector(app), 'the Chromatogram view: no button, no column, no panel').toEqual(NONE);
      // The read-trace viewer's own toolbar stays on the figure, in the canvas.
      const toolbar = app.one('.mbc-trace > .mbc-aln-action-toolbar', "the trace viewer's toolbar");
      expect(app.canvas().contains(toolbar), 'in the viewer canvas').toBe(true);
      expect(enclosing(toolbar, 'mbc-aln-subview-panel'), 'on the trace view').not.toBeNull();
      expect(toolbar.querySelectorAll('select').length, 'its read picker').toBe(1);
      expect(toolbar.querySelectorAll('input[type="checkbox"]').map((b) => b.parentElement!.textContent.trim()), 'its channel and display toggles').toEqual(['A', 'C', 'G', 'T', 'Base calls', 'Quality']);
      expect(toolbar.querySelectorAll('input[type="range"]').length, 'its X and Y scales').toBe(2);
      // The toggle changes nothing there, and says why; the menu item is greyed.
      await app.press('i', { mod: true, alt: true });
      expect(app.doc.body.textContent).toContain('Inspector: this view has no settings to show.');
      expect(inspector(app), 'the Chromatogram view, after Ctrl+Alt+I').toEqual(NONE);
      const row = await viewInspectorRow(app);
      expect(rowState(row), 'View > Panels > Inspector on the Chromatogram view').toEqual({ checked: 'false', disabled: true });
      await closeMenus(app);

      await app.click(modeTab(app, 'QC Report'));
      expect(app.canvas().querySelectorAll('.mbc-qc'), 'the read QC report is drawn').toHaveLength(1);
      expect(inspector(app), 'the QC Report view').toEqual(NONE);

      await app.click(modeTab(app, 'Multiple Sequence Alignment (MSA)'));
      expect(inspector(app), 'the MSA grid again, open as it was left').toEqual(CONTIG_OPEN);

      // A read list (unaligned reads, no traces, on its Sequences tab): its QC Report claims nothing either.
      await onAlignment(app, byId('doc-contig-yghj-ion-torrent'));
      expect(inspector(app), "the read list's MSA grid").toEqual({ ...ALIGNMENT_OPEN, button: 'Hide Sequences Controls Inspector' });
      expect(app.one('[role="tablist"][aria-label="Sequence Alignment Modes"]').querySelectorAll('button[role="tab"]').map((t) => t.textContent.trim()), 'no Chromatogram for a read list without traces').not.toContain('Chromatogram');
      await app.click(modeTab(app, 'QC Report'));
      expect(app.canvas().querySelectorAll('.mbc-qc'), "the read list's QC report").toHaveLength(1);
      expect(inspector(app), "the read list's QC Report view").toEqual(NONE);

      // Pairwise Alignment and Dotplot are not the MSA grid either, though the mode strip sets the
      // MSA figure back to the grid as it opens them: an alignment's two views show App's column and
      // never the studio's panel, under the one open state. With the grid's inspector left open they
      // show the column, left closed they show neither, and the grid comes back as it was left.
      await onAlignment(app);
      const VIEWS: [string, string][] = [['Pairwise Alignment', '.mbc-pw-panel'], ['Dotplot', '.mbc-dotplot']];
      // App's column beside the viewer: the body split's viewer, resizer and column tracks.
      const APP_COLUMN = ['minmax(0, 1fr)', '5px', 'var(--mbc-inspector-width, 288px)'];
      const SHARED_OPEN = { button: 'Hide Alignment Controls Inspector', appColumn: true, bodySplit: APP_COLUMN, handle: [0, 0], shell: [0, 0], rail: [0, 0] };
      for (const [left, onGrid, onView] of [['open', ALIGNMENT_OPEN, SHARED_OPEN], ['closed', ALIGNMENT_CLOSED, ALIGNMENT_CLOSED]] as const) {
        if (left === 'closed') await app.press('i', { mod: true, alt: true });
        expect(inspector(app), `the alignment's MSA grid, its inspector ${left}`).toEqual(onGrid);
        for (const [view, figure] of VIEWS) {
          await app.click(modeTab(app, view));
          expect(app.canvas().querySelectorAll(figure), `the ${view} view is drawn`).toHaveLength(1);
          expect(app.canvas().querySelectorAll('.mbc-aln-split-layout'), `the ${view} view: no MSA grid`).toHaveLength(0);
          expect(inspector(app), `the ${view} view, the grid's inspector left ${left}: App's column ${left}, no studio panel`).toEqual(onView);
        }
        await app.click(modeTab(app, 'Multiple Sequence Alignment (MSA)'));
        expect(inspector(app), `the MSA grid again, ${left} as it was left`).toEqual(onGrid);
      }
    });
  });
});
