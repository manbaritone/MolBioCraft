// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCT5: the divider between the circular and linear maps in the Sequence view's Split layout.
 *
 * The pure helper (src/core/paneSplit.ts) is swept over grid widths and pointer positions. The App
 * is mounted with React DOM's client renderer over the live DOM (appHarness.tsx), opened on the
 * sample library in Split, and the divider is driven by the pointer's own events: a press on the
 * divider, moves, and a release (or a cancel). The Split frame is laid out at the viewer canvas
 * width US-01M6Q1CC measured at 1440x900 (879px; this unit's live check measured 877px); App.css is
 * read the way the cascade applies it there (cssCascade.ts), with the custom properties the App sets
 * inline on the frame.
 *
 * Wrong implementations each check names and kills: an unclamped ratio (a pane dragged narrower than
 * its minimum), a collapse that resets the expanded ratio (restore comes back at the default), a
 * divider that reuses the inspector's (or explorer's) width state, a collapse that unmounts a pane or
 * drops the selection, zoom, document or layout mode, and a resize that rescans the sequence.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PANE_SPLIT,
  DEFAULT_PANE_SPLIT_RATIO,
  PANE_MIN_PX,
  PANE_SPLIT_GAP_PX,
  clampPaneSplitRatio,
  collapsePane,
  dragPaneSplit,
  paneCollapsedAt,
  paneSplitRatioAt,
  resetPaneSplit,
  restorePanes,
} from '../core/paneSplit';
import { mountApp, releaseLeakedMount, type AppHarness } from './appHarness';
import { cascaded, gridTracks } from './cssCascade';
import { dispatchLiveEvent, type LiveElement } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));
/** How many times the App has scanned a sequence for restriction sites. */
const scans = vi.hoisted(() => ({ n: 0 }));
vi.mock('../core/bioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/bioEngine')>();
  return { ...actual, scanRestrictionSites: (...a: Parameters<typeof actual.scanRestrictionSites>) => { scans.n++; return actual.scanRestrictionSites(...a); } };
});
vi.setConfig({ testTimeout: 90_000 });
afterEach(() => { releaseLeakedMount(); });

const WINDOW = 1440;
/** The Split frame's width: the viewer canvas content box at 1440x900 (US-01M6Q1CC measured 879px). */
const FRAME = 879;
const VIEW = { window: WINDOW, height: 900, canvas: FRAME };
const cols = (w: number) => w - PANE_SPLIT_GAP_PX;
/** The pointer x that puts the divider's centre where the circle is `circlePx` wide. */
const xForCircle = (circlePx: number) => circlePx + PANE_SPLIT_GAP_PX / 2;

// ─── The App, mounted ───

async function openSplit(): Promise<AppHarness> {
  const app = await mountApp({
    width: WINDOW, height: 900,
    layout: (el) => (el.classList.contains('map-seq-split') ? { width: FRAME, height: 640 } : { width: 0, height: 0 }),
  });
  await app.menu('new-session:sample-library');
  expect(app.one('.map-seq-grid').classList.contains('mode-split'), 'the sample opens in Split').toBe(true);
  return app;
}
async function withSplit(run: (app: AppHarness) => Promise<void>) {
  const app = await openSplit();
  try { await run(app); } finally { app.unmount(); }
}

const frame = (app: AppHarness) => app.one('.map-seq-split', 'Split frame');
const divider = (app: AppHarness) => app.one('.map-seq-split > .map-seq-divider', 'divider');
const dividers = (app: AppHarness) => app.all('.map-seq-divider');
const named = (app: AppHarness, label: string) => app.one(`button[aria-label="${label}"]`, `"${label}" button`);
const ratioOf = (app: AppHarness) => Number(frame(app).style.getPropertyValue('--mbc-split-ratio'));
/** The Split grid's columns as App.css gives them, and the pane widths they come to in the frame. */
function columns(app: AppHarness): { tracks: string[]; circle: number; linear: number } {
  const grid = app.one('.map-seq-grid.mode-split');
  const tracks = gridTracks(cascaded(grid, 'grid-template-columns', VIEW)!);
  const fr = (t: string) => {
    const v = /var\((--[\w-]+)\)/.exec(t)?.[1];
    const raw = v ? cascaded(frame(app), v, VIEW)! : /(\d+(?:\.\d+)?)fr/.exec(t)![1] + 'fr';
    return Number(/^([\d.]+)fr$/.exec(raw.trim())![1]);
  };
  if (tracks.length === 1) return { tracks, circle: NaN, linear: NaN };
  const [a, b] = tracks.map(fr);
  const min = Number(/^minmax\((\d+)px/.exec(tracks[0])![1]);
  const circle = Math.max(min, (cols(FRAME) * a) / (a + b));
  return { tracks, circle, linear: cols(FRAME) - circle };
}

async function act(app: AppHarness, fn: () => void) {
  const React = await import('react');
  await React.act(async () => { fn(); });
  await app.settle();
}
/** A press on the divider, moves to each x, then a release (or a cancel). */
async function drag(app: AppHarness, xs: number[], end: 'pointerup' | 'pointercancel' = 'pointerup', from?: number) {
  const el = divider(app);
  const start = from ?? xForCircle(ratioOf(app) * cols(FRAME));
  const down = await (async () => {
    let ev: ReturnType<typeof dispatchLiveEvent> | null = null;
    await act(app, () => { ev = dispatchLiveEvent(el, 'pointerdown', { pointerId: 7, button: 0, buttons: 1, clientX: start, isPrimary: true }); });
    return ev!;
  })();
  expect(down.defaultPrevented, 'the press starts no text selection').toBe(true);
  expect(el.hasPointerCapture(7), 'the divider captures the pointer').toBe(true);
  for (const x of xs) await act(app, () => { dispatchLiveEvent(el, 'pointermove', { pointerId: 7, buttons: 1, clientX: x }); });
  await act(app, () => { dispatchLiveEvent(el, end, { pointerId: 7, clientX: xs.at(-1) ?? start }); });
}
const dblclick = (app: AppHarness, el: LiveElement) => act(app, () => { dispatchLiveEvent(el, 'dblclick', { detail: 2 }); });

/** What a collapse must keep: the document, its selection, the zoom and the layout mode, both panes mounted. */
function keepers(app: AppHarness) {
  return {
    doc: app.all('.mbc-doc-table-pane tr.selected-row').map((r) => r.textContent).join('|'),
    selection: app.all('.mbc-viewer-zoom-controls span').map((s) => s.textContent).join('|'),
    zoom: app.all('.mbc-viewer-zoom-controls button').map((b) => b.textContent).join('|'),
    layout: app.one('.map-seq-grid').getAttribute('class'),
    panes: app.all('.map-seq-grid > *').map((k) => k.getAttribute('class')?.split(' ')[0]),
  };
}

// ─── AC1: the drag sets the ratio, clamped ───

describe('US-01M7CCT5 AC1: the divider sets the width ratio by drag, clamped to each pane\'s minimum', () => {
  it('US-01M7CCT5 AC1 maps pointer x to a ratio and clamps it at every width', () => {
    for (const w of [760, 879, 1000, 1400, 2200]) {
      const lo = PANE_MIN_PX.circular / cols(w);
      const hi = 1 - PANE_MIN_PX.linear / cols(w);
      for (let x = 0; x <= w; x += 7) {
        const r = paneSplitRatioAt(x, w);
        expect(r, `${w}px at x=${x}`).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(r, `${w}px at x=${x}`).toBeLessThanOrEqual(hi + 1e-12);
        const free = (x - PANE_SPLIT_GAP_PX / 2) / cols(w);
        if (free >= lo && free <= hi) expect(r, `${w}px at x=${x} follows the pointer`).toBeCloseTo(free, 12);
        // The panes the ratio gives never fall below their minimums.
        expect(r * cols(w)).toBeGreaterThanOrEqual(PANE_MIN_PX.circular - 1e-9);
        expect((1 - r) * cols(w)).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 1e-9);
      }
      expect(clampPaneSplitRatio(0, w)).toBeCloseTo(lo, 12);
      expect(clampPaneSplitRatio(1, w)).toBeCloseTo(hi, 12);
      expect(clampPaneSplitRatio(Number.NaN, w)).toBeCloseTo(DEFAULT_PANE_SPLIT_RATIO, 12);
    }
    // A grid too narrow for both minimums shares its width in proportion to them.
    expect(clampPaneSplitRatio(0.9, 500)).toBeCloseTo(320 / 620, 12);
    // The default ratio is App.css's own 4fr : 5fr, and it lies inside the bounds from the 760px breakpoint up.
    expect(DEFAULT_PANE_SPLIT).toEqual({ ratio: 4 / 9, collapsed: null });
    expect(clampPaneSplitRatio(4 / 9, 760)).toBe(4 / 9);
  });

  it('US-01M7CCT5 AC1 drags the divider in the App and the grid follows, clamped', async () => {
    await withSplit(async (app) => {
      // At rest: one divider in the Split frame, a resize cursor, outside the grid so the two cards
      // stay its only columns, and the stylesheet's own 4fr : 5fr tracks.
      expect(dividers(app)).toHaveLength(1);
      const d = divider(app);
      expect(app.one('.map-seq-grid').children.map((k) => k.getAttribute('class')?.split(' ')[0])).toEqual(['plasmid-map-wrapper', 'linear-seq-container']);
      expect(cascaded(d, 'cursor', VIEW)).toBe('col-resize');
      expect(cascaded(d, 'touch-action', VIEW)).toBe('none');
      const hit = Number(/^(\d+)px$/.exec(cascaded(d, 'width', VIEW) ?? '')?.[1]);
      // A hit target wider than a hairline that reaches at most 1px into each card past the 10px gap.
      expect(hit).toBeGreaterThanOrEqual(8);
      expect(hit).toBeLessThanOrEqual(PANE_SPLIT_GAP_PX + 2);
      expect(columns(app).tracks).toEqual(['minmax(320px, 4fr)', 'minmax(0, 5fr)']);
      expect(ratioOf(app)).toBeCloseTo(4 / 9, 3);

      // Wider and narrower, then past each minimum (short of the collapse threshold): the grid's
      // columns are the ratio the pointer set, and never under 320px / 300px.
      const W = cols(FRAME);
      for (const [circlePx, expected] of [[500, 500], [380, 380], [540, 540], [250, PANE_MIN_PX.circular], [W - 200, W - PANE_MIN_PX.linear]] as const) {
        await drag(app, [xForCircle(circlePx - 40), xForCircle(circlePx)]);
        expect(ratioOf(app), `circle at ${circlePx}px`).toBeCloseTo(expected / W, 3);
        const c = columns(app);
        expect(c.tracks[0], 'the circle track keeps its 320px floor').toMatch(/^minmax\(320px, /);
        expect(c.circle, `circle at ${circlePx}px`).toBeCloseTo(expected, 0);
        expect(c.linear).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 0.5);
        expect(app.all('.map-seq-split.dragging'), 'the drag ended').toHaveLength(0);
      }

      // While the pointer moves, the frame shows the new ratio; a cancelled drag puts the old one back.
      const before = ratioOf(app);
      await drag(app, [xForCircle(450)], 'pointercancel');
      expect(ratioOf(app), 'a cancelled drag leaves the ratio as it was').toBeCloseTo(before, 6);
      expect(divider(app).hasPointerCapture(7), 'the capture is released').toBe(false);
    });
  });
});

// ─── AC2: collapse past the threshold, restore, reset ───

describe('US-01M7CCT5 AC2: a drag past the edge collapses a pane; restore and double-click', () => {
  it('US-01M7CCT5 AC2 collapses past a near-edge threshold and restores the last expanded ratio', () => {
    for (const w of [760, 879, 1400]) {
      for (let x = 0; x <= w; x += 3) {
        const c = paneCollapsedAt(x, w);
        const circle = x - PANE_SPLIT_GAP_PX / 2;
        const linear = w - x - PANE_SPLIT_GAP_PX / 2;
        expect(c, `${w}px at x=${x}`).toBe(circle < 160 ? 'circular' : linear < 150 ? 'linear' : null);
      }
    }
    // The threshold lies past the clamp, so a drag meets the minimum first and collapses further on.
    expect(paneCollapsedAt(xForCircle(PANE_MIN_PX.circular - 1), 879)).toBeNull();
    // A drag that collapses keeps the ratio it began with, whatever it passed through.
    for (const start of [0.4, 0.5, 0.62]) {
      const s = { ratio: start, collapsed: null };
      expect(dragPaneSplit(s, 20, 879)).toEqual({ ratio: start, collapsed: 'circular' });
      expect(dragPaneSplit(s, 870, 879)).toEqual({ ratio: start, collapsed: 'linear' });
      expect(restorePanes(dragPaneSplit(s, 20, 879))).toEqual(s);
      expect(restorePanes(collapsePane(s, 'linear'))).toEqual(s);
      // Coming back out of the collapse zone in the same drag expands again, at the pointer.
      expect(dragPaneSplit(s, 400, 879)).toEqual({ ratio: paneSplitRatioAt(400, 879), collapsed: null });
    }
    expect(resetPaneSplit()).toEqual({ ratio: 4 / 9, collapsed: null });
  });

  it('US-01M7CCT5 AC2 drags a pane shut, leaves a restore button, restores the ratio, and resets on double-click', async () => {
    await withSplit(async (app) => {
      const W = cols(FRAME);
      for (const pane of ['circular', 'linear'] as const) {
        await drag(app, [xForCircle(520)]);
        const expanded = ratioOf(app);
        expect(expanded).toBeCloseTo(520 / W, 3);
        // Past the threshold: the pane folds away (still mounted), the other takes the one column.
        await drag(app, [xForCircle(pane === 'circular' ? 300 : W - 280), pane === 'circular' ? 30 : FRAME - 20]);
        expect(frame(app).classList.contains(`collapsed-${pane}`), `${pane} collapsed`).toBe(true);
        expect(columns(app).tracks, 'the other pane takes the space').toEqual(['minmax(0, 1fr)']);
        const hidden = app.one(pane === 'circular' ? '.map-seq-grid > .plasmid-map-wrapper' : '.map-seq-grid > .linear-seq-container');
        expect(cascaded(hidden, 'display', VIEW)).toBe('none');
        expect(dividers(app), 'no divider while a pane is collapsed').toHaveLength(0);
        const restore = named(app, pane === 'circular' ? 'Restore circular map' : 'Restore linear map');
        expect(cascaded(restore, 'display', VIEW), 'the restore button is visible').not.toBe('none');
        // Restore: the ratio from before the drag that shut it (not the default, not the clamp edge).
        await app.click(restore);
        expect(frame(app).classList.contains(`collapsed-${pane}`)).toBe(false);
        expect(ratioOf(app)).toBeCloseTo(expanded, 6);
        expect(columns(app).circle).toBeCloseTo(520, 0);
      }
      // Double-click resets the default ratio.
      await dblclick(app, divider(app));
      expect(ratioOf(app)).toBeCloseTo(4 / 9, 3);
      expect(columns(app).tracks).toEqual(['minmax(320px, 4fr)', 'minmax(0, 5fr)']);
    });
  });
});

// ─── AC3: explicit collapse controls keep the view's state ───

describe('US-01M7CCT5 AC3: Collapse circular and Collapse linear keep the document, selection, zoom and layout', () => {
  it('US-01M7CCT5 AC3 collapses each pane by its control and keeps everything else', async () => {
    await withSplit(async (app) => {
      // A selection and a zoom to keep.
      await app.press('=', { mod: true });
      const arcs = app.all('.linear-seq-container g.clickable-arc');
      expect(arcs.length, 'the sample\'s features on the linear map').toBeGreaterThan(0);
      await app.click(arcs[0]);
      const scansBefore = scans.n;
      expect(scansBefore, 'the sample was scanned').toBeGreaterThan(0);
      await drag(app, [xForCircle(480)]);
      const ratio = ratioOf(app);
      const kept = keepers(app);
      expect(kept.zoom, 'zoomed in').toMatch(/110%/);
      expect(kept.selection, 'a feature selected').toMatch(/^\d+\.\.\d+ \(/);

      for (const pane of ['circular', 'linear'] as const) {
        await app.click(named(app, pane === 'circular' ? 'Collapse circular map' : 'Collapse linear map'));
        expect(frame(app).classList.contains(`collapsed-${pane}`)).toBe(true);
        expect(columns(app).tracks, 'the other pane takes the whole width').toEqual(['minmax(0, 1fr)']);
        const other = app.one(pane === 'circular' ? '.map-seq-grid > .linear-seq-container' : '.map-seq-grid > .plasmid-map-wrapper');
        expect(cascaded(other, 'display', VIEW)).not.toBe('none');
        // Both panes still mounted, the same document, selection, zoom and Split layout.
        expect(keepers(app)).toEqual(kept);
        await app.click(named(app, pane === 'circular' ? 'Restore circular map' : 'Restore linear map'));
        expect(ratioOf(app), 'the ratio from before the collapse').toBeCloseTo(ratio, 6);
        expect(keepers(app)).toEqual(kept);
      }
      // Linear View Only and Circular View Only draw no divider and no collapse control.
      for (const mode of ['view:layout-linear', 'view:layout-circular'] as const) {
        await app.menu(mode);
        expect(dividers(app)).toHaveLength(0);
        expect(app.all('button[aria-label^="Collapse "], button[aria-label^="Restore "]')).toHaveLength(0);
      }
      await app.menu('view:layout-split');
      expect(dividers(app)).toHaveLength(1);
      // Resizing, collapsing and restoring never rescanned the sequence.
      expect(scans.n, 'no rescan').toBe(scansBefore);
    });
  });
});

// ─── AC4: the outer panes keep their own state ───

describe('US-01M7CCT5 AC4: inspector width, explorer width and SplitDocumentPane are unchanged', () => {
  it('US-01M7CCT5 AC4 leaves the inspector, explorer and split-document pane as they were', async () => {
    await withSplit(async (app) => {
      await app.click(app.one('button.mbc-split-toggle', 'split-document toggle'));
      const outer = () => ({
        inspector: app.one('.mbc-inspector-resizer').getAttribute('aria-valuenow'),
        inspectorVar: app.bodySplit().style.getPropertyValue('--mbc-inspector-width'),
        explorer: app.all('[style*="--mbc-sidebar-width"]').map((e) => e.style.getPropertyValue('--mbc-sidebar-width')).join('|'),
        splitHost: app.one('.mbc-split-host').getAttribute('class'),
        splitDoc: app.all('.mbc-split-host > *').map((e) => e.getAttribute('class')?.split(' ')[0]).join('|'),
        stored: app.win.localStorage.getItem('molbiocraft.workspace.layout.v1'),
      });
      const before = outer();
      expect(before.splitHost).toContain('is-split');
      expect(before.inspector).toBe('288');
      await drag(app, [xForCircle(540)]);
      expect(ratioOf(app)).toBeCloseTo(540 / cols(FRAME), 3);
      expect(outer(), 'after a drag').toEqual(before);
      await drag(app, [10]);
      await app.click(named(app, 'Restore circular map'));
      await app.click(named(app, 'Collapse linear map'));
      await app.click(named(app, 'Restore linear map'));
      await dblclick(app, divider(app));
      expect(outer(), 'after collapse, restore and reset').toEqual(before);
      // Nor does the inspector's own double-click reset touch the divider.
      await drag(app, [xForCircle(560)]);
      await dblclick(app, app.one('.mbc-inspector-resizer'));
      expect(ratioOf(app)).toBeCloseTo(560 / cols(FRAME), 3);
    });
  });
});
