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
  PANE_SPLIT_KEY_STEP_LARGE_PX,
  PANE_SPLIT_KEY_STEP_PX,
  paneCollapsedAt,
  paneSplitRatioAt,
  paneSplitValueNow,
  parsePaneSplit,
  renderedPaneSplitRatio,
  resetPaneSplit,
  restorePanes,
  stepPaneSplit,
} from '../core/paneSplit';
import type { MbcWorkbenchFileEnvelope } from '../core/mbcSessionFormat';
import { mountApp, releaseLeakedMount, type AppHarness } from './appHarness';
import { appCssRules, cascaded, gridTracks } from './cssCascade';
import { paneSplitStyle } from '../core/paneSplit';
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

async function openSplit(frameWidth: () => number = () => FRAME): Promise<AppHarness> {
  const app = await mountApp({
    width: WINDOW, height: 900,
    layout: (el) => (el.classList.contains('map-seq-split') ? { width: frameWidth(), height: 640 } : { width: 0, height: 0 }),
  });
  await app.menu('new-session:sample-library');
  expect(app.one('.map-seq-grid').classList.contains('mode-split'), 'the sample opens in Split').toBe(true);
  return app;
}
async function withSplit(run: (app: AppHarness) => Promise<void>, frameWidth?: () => number) {
  const app = await openSplit(frameWidth);
  try { await run(app); } finally { app.unmount(); }
}

const frame = (app: AppHarness) => app.one('.map-seq-split', 'Split frame');
const divider = (app: AppHarness) => app.one('.map-seq-split > .map-seq-divider', 'divider');
const dividers = (app: AppHarness) => app.all('.map-seq-divider');
const named = (app: AppHarness, label: string) => app.one(`button[aria-label="${label}"]`, `"${label}" button`);
const ratioOf = (app: AppHarness) => Number(frame(app).style.getPropertyValue('--mbc-split-ratio'));
/**
 * The Split grid's columns as App.css gives them in a frame `width` wide, and the pane widths they
 * come to: two flexible tracks, each held at its minimum when its share would fall below it (the CSS
 * grid algorithm for two `minmax(<px>, <fr>)` tracks).
 */
function columns(app: AppHarness, width = FRAME): { tracks: string[]; circle: number; linear: number } {
  const view = { ...VIEW, canvas: width };
  const grid = app.one('.map-seq-grid.mode-split');
  const tracks = gridTracks(cascaded(grid, 'grid-template-columns', view)!);
  const fr = (t: string) => {
    const v = /var\((--[\w-]+)\)/.exec(t)?.[1];
    const raw = v ? cascaded(frame(app), v, view)! : /(\d+(?:\.\d+)?)fr/.exec(t)![1] + 'fr';
    return Number(/^([\d.]+)fr$/.exec(raw.trim())![1]);
  };
  if (tracks.length === 1) return { tracks, circle: NaN, linear: NaN };
  const [a, b] = tracks.map(fr);
  const [minC, minL] = tracks.map((t) => Number(/^minmax\((\d+)(?:px)?,/.exec(t)![1]));
  const c = cols(width);
  let circle = (c * a) / (a + b);
  if (circle < minC) circle = minC;
  else if (c - circle < minL) circle = c - minL;
  return { tracks, circle, linear: c - circle };
}
/** Evaluates a declared `left: calc(...)` the way the browser does, in a containing block `pct` px wide. */
function evalLength(expr: string, pct: number, vars: Record<string, string>): number {
  let s = expr.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_m, n: string, d?: string) => {
    const v = vars[n] ?? d;
    if (v === undefined) throw new Error(`${n} is not set`);
    return v.trim();
  });
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (_m, n: string) => String((pct * Number(n)) / 100)).replace(/(\d+(?:\.\d+)?)px/g, '$1').replace(/\bcalc\(/g, '(');
  if (/[a-z]/i.test(s.replace(/\b(clamp|max|min)\b/g, ''))) throw new Error(`cannot evaluate "${expr}"`);
  return Function('clamp', 'max', 'min', `return ${s};`)((lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi)), Math.max, Math.min) as number;
}
/** The centre of an absolutely placed element in the frame, from its declared left and width. */
function centreOf(app: AppHarness, el: LiveElement, width: number): number {
  const view = { ...VIEW, canvas: width };
  const vars = Object.fromEntries(['--mbc-split-ratio'].map((n) => [n, cascaded(frame(app), n, view) ?? '']).filter(([, v]) => v));
  const left = evalLength(cascaded(el, 'left', view)!, width, vars);
  return left + Number(/^(\d+)px$/.exec(cascaded(el, 'width', view)!)![1]) / 2;
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
        // US-01M7CCRP: the divider stays while a pane is collapsed, a 6px strip beside the restore
        // rail (so keyboard focus stays on it), never over the card that took the space.
        expect(dividers(app), 'the divider stays, at the collapsed edge').toHaveLength(1);
        expect(cascaded(divider(app), 'width', VIEW)).toBe('6px');
        expect(divider(app).getAttribute('aria-valuenow')).toBe(pane === 'circular' ? '0' : '100');
        expect(app.all('.map-seq-divider-controls'), 'no collapse buttons while collapsed').toHaveLength(0);
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

// ─── US-01M7CCRP AC1: the keyboard ───

const press = async (app: AppHarness, key: string, shift = false) => { await app.press(key, { shift }); };
async function focusDivider(app: AppHarness) {
  await act(app, () => { divider(app).focus(); });
  expect(app.doc.activeElement, 'the divider has focus').toBe(divider(app));
}

describe('US-01M7CCRP AC1: the separator is focusable and moves, collapses and restores from the keyboard', () => {
  it('US-01M7CCRP AC1 steps by a documented amount, clamped, and announces its value', () => {
    expect([PANE_SPLIT_KEY_STEP_PX, PANE_SPLIT_KEY_STEP_LARGE_PX]).toEqual([16, 80]);
    for (const w of [760, 879, 1400, 2200]) {
      const lo = PANE_MIN_PX.circular / cols(w);
      const hi = 1 - PANE_MIN_PX.linear / cols(w);
      for (const step of [16, -16, 80, -80]) {
        let s = { ratio: DEFAULT_PANE_SPLIT_RATIO, collapsed: null as null };
        for (let i = 0; i < 80; i++) {
          const next = stepPaneSplit(s, step, w);
          const want = Math.min(hi, Math.max(lo, s.ratio + step / cols(w)));
          expect(next.ratio, `${w}px, step ${step}, press ${i}`).toBeCloseTo(want, 12);
          expect(next.collapsed).toBeNull();
          s = next as typeof s;
        }
        expect(s.ratio, `${w}px: steps of ${step} end at the bound`).toBeCloseTo(step > 0 ? hi : lo, 12);
      }
      // A collapsed pane does not move under the arrows.
      const shut = { ratio: 0.5, collapsed: 'circular' as const };
      expect(stepPaneSplit(shut, 80, w)).toBe(shut);
    }
    expect([0.4444, 0.5, 0.731].map((ratio) => paneSplitValueNow({ ratio, collapsed: null }))).toEqual([44, 50, 73]);
    expect(paneSplitValueNow({ ratio: 0.5, collapsed: 'circular' })).toBe(0);
    expect(paneSplitValueNow({ ratio: 0.5, collapsed: 'linear' })).toBe(100);
  });

  it('US-01M7CCRP AC1 takes focus, moves on the arrows, collapses on Home/End and restores on Enter', async () => {
    await withSplit(async (app) => {
      const d = divider(app);
      // A focusable separator that names both panes and announces where it is.
      expect({
        role: d.getAttribute('role'), tabindex: d.getAttribute('tabindex'), orientation: d.getAttribute('aria-orientation'),
        now: d.getAttribute('aria-valuenow'), min: d.getAttribute('aria-valuemin'), max: d.getAttribute('aria-valuemax'),
      }).toEqual({ role: 'separator', tabindex: '0', orientation: 'vertical', now: '44', min: '0', max: '100' });
      expect(d.getAttribute('aria-label')).toMatch(/circular/i);
      expect(d.getAttribute('aria-label')).toMatch(/linear/i);
      expect(d.getAttribute('aria-valuetext')).toBe('Circular map 44%, linear map 56%');
      // A visible focus ring: a :focus-visible rule on the divider draws an outline.
      const ring = appCssRules().filter((r) => r.selectorText.split(',').some((x) => /\.map-seq-divider:focus-visible$/.test(x.trim()))
        && r.decls.some((d) => d.name === 'outline' && /^\d+px solid/.test(d.value)));
      expect(ring, 'a focus ring on the divider').toHaveLength(1);

      const W = cols(FRAME);
      await focusDivider(app);
      const start = ratioOf(app);
      await press(app, 'ArrowRight');
      expect(ratioOf(app)).toBeCloseTo(start + 16 / W, 3);
      await press(app, 'ArrowRight', true);
      expect(ratioOf(app)).toBeCloseTo(start + 96 / W, 3);
      await press(app, 'ArrowLeft');
      expect(ratioOf(app)).toBeCloseTo(start + 80 / W, 3);
      expect(divider(app).getAttribute('aria-valuenow')).toBe(String(Math.round((start + 80 / W) * 100)));
      // Held against a bound, the arrows stop at each pane's minimum (and never collapse it).
      for (let i = 0; i < 12; i++) await press(app, 'ArrowLeft', true);
      expect(ratioOf(app)).toBeCloseTo(PANE_MIN_PX.circular / W, 3);
      expect(frame(app).className).not.toMatch(/collapsed/);
      for (let i = 0; i < 12; i++) await press(app, 'ArrowRight', true);
      expect(ratioOf(app)).toBeCloseTo(1 - PANE_MIN_PX.linear / W, 3);
      await press(app, 'ArrowLeft', true);
      const expanded = ratioOf(app);

      // Home folds the circle away, End the linear map; Enter brings both back at the ratio they had,
      // and focus stays on the divider throughout.
      for (const [key, pane, now] of [['Home', 'circular', '0'], ['End', 'linear', '100']] as const) {
        await press(app, key);
        expect(frame(app).classList.contains(`collapsed-${pane}`), `${key} collapses ${pane}`).toBe(true);
        expect(divider(app).getAttribute('aria-valuenow')).toBe(now);
        expect(app.doc.activeElement, 'focus stays on the divider').toBe(divider(app));
        await press(app, 'ArrowRight');
        expect(frame(app).classList.contains(`collapsed-${pane}`), 'the arrows leave a collapsed pane shut').toBe(true);
        await press(app, 'Enter');
        expect(frame(app).className).not.toMatch(/collapsed/);
        expect(ratioOf(app), 'Enter restores the expanded ratio').toBeCloseTo(expanded, 6);
        expect(app.doc.activeElement).toBe(divider(app));
      }
      // Other keys pass through untouched.
      await press(app, 'a');
      expect(ratioOf(app)).toBeCloseTo(expanded, 6);
    });
  });
});

// ─── US-01M7CCRP AC2: saved with the workspace, restored on reopen ───

/** The autosaved session the App wrote, as the file envelope. */
async function autosaved(app: AppHarness): Promise<MbcWorkbenchFileEnvelope> {
  const React = await import('react');
  await React.act(async () => { vi.advanceTimersByTime(1000); });
  await app.settle();
  const raw = app.win.localStorage.getItem('molbiocraft.workbench.autosave.v1');
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return JSON.parse(raw!) as MbcWorkbenchFileEnvelope;
}
const reopen = (app: AppHarness, env: MbcWorkbenchFileEnvelope, paneSplit: unknown, keep = true) => app.restoreSession({
  documents: env.documents, activeDocId: env.workspace.activeDocId, viewerTab: 'sequence-view',
  workspace: (() => {
    const { paneSplit: _drop, ...rest } = env.workspace;
    void _drop;
    return (keep ? { ...rest, paneSplit } : rest) as never;
  })(),
});

describe('US-01M7CCRP AC2: the divider is saved with the workspace and restored on reopen', () => {
  it('US-01M7CCRP AC2 reads a saved divider back, refusing malformed values', () => {
    expect(parsePaneSplit({ ratio: 0.6, collapsed: 'linear' })).toEqual({ ratio: 0.6, collapsed: 'linear' });
    expect(parsePaneSplit({ ratio: 0.3, collapsed: null })).toEqual({ ratio: 0.3, collapsed: null });
    // An older session saved none.
    expect(parsePaneSplit(undefined)).toEqual(DEFAULT_PANE_SPLIT);
    for (const bad of [null, 0.6, 'split', [0.6], true]) expect(parsePaneSplit(bad), JSON.stringify(bad)).toEqual(DEFAULT_PANE_SPLIT);
    for (const ratio of [0, 1, -0.2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0.6', null]) {
      expect(parsePaneSplit({ ratio, collapsed: 'circular' }), `ratio ${String(ratio)}`).toEqual({ ratio: DEFAULT_PANE_SPLIT_RATIO, collapsed: 'circular' });
    }
    for (const collapsed of ['both', 'Circular', 1, {}, true]) {
      expect(parsePaneSplit({ ratio: 0.55, collapsed }), `collapsed ${JSON.stringify(collapsed)}`).toEqual({ ratio: 0.55, collapsed: null });
    }
  });

  it('US-01M7CCRP AC2 saves the ratio and collapse with the session and restores them, clamped to the current width', async () => {
    let width = FRAME;
    await withSplit(async (app) => {
      const W = cols(FRAME);
      // Saved: a dragged ratio, then a collapse on top of it.
      await drag(app, [xForCircle(520)]);
      await app.click(named(app, 'Collapse linear map'));
      const env = await autosaved(app);
      expect(env.workspace.paneSplit?.collapsed).toBe('linear');
      expect(env.workspace.paneSplit?.ratio).toBeCloseTo(520 / W, 3);

      // Reset in the App, then the saved session reopened through the session parser: both return.
      await app.click(named(app, 'Restore linear map'));
      await dblclick(app, divider(app));
      expect(ratioOf(app)).toBeCloseTo(4 / 9, 3);
      await reopen(app, env, env.workspace.paneSplit);
      expect(frame(app).classList.contains('collapsed-linear'), 'the collapse returns').toBe(true);
      await app.click(named(app, 'Restore linear map'));
      expect(ratioOf(app), 'the expanded ratio returns').toBeCloseTo(520 / W, 3);
      expect(columns(app).circle).toBeCloseTo(520, 0);

      // An old session, saved before the divider, opens at the default.
      await reopen(app, env, undefined, false);
      expect(ratioOf(app)).toBeCloseTo(4 / 9, 3);
      expect(frame(app).className).not.toMatch(/collapsed/);
      // Malformed values are refused, field by field, and never reach the layout.
      for (const [bad, want] of [
        [{ ratio: 'wide', collapsed: 'sideways' }, { ratio: 4 / 9, collapsed: false }],
        [0.7, { ratio: 4 / 9, collapsed: false }],
        [{ ratio: 0.55, collapsed: 'circular' }, { ratio: 0.55, collapsed: 'circular' }],
        [{ ratio: 7, collapsed: null }, { ratio: 4 / 9, collapsed: false }],
      ] as const) {
        await reopen(app, env, bad);
        expect(ratioOf(app), JSON.stringify(bad)).toBeCloseTo(want.ratio, 3);
        expect(frame(app).classList.contains('collapsed-circular'), JSON.stringify(bad)).toBe(want.collapsed === 'circular');
      }

      // A ratio wider than this frame can hold is clamped to it on reopen ...
      await reopen(app, env, { ratio: 0.95, collapsed: null });
      expect(ratioOf(app)).toBeCloseTo(1 - PANE_MIN_PX.linear / W, 3);
      expect(columns(app).linear).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 0.5);
      await reopen(app, env, { ratio: 0.05, collapsed: null });
      expect(ratioOf(app)).toBeCloseTo(PANE_MIN_PX.circular / W, 3);
      // ... and a ratio that fits a wide window is clamped when the window narrows.
      width = 1600;
      await reopen(app, env, { ratio: 0.78, collapsed: null });
      expect(ratioOf(app), 'it fits 1600px').toBeCloseTo(0.78, 3);
      width = FRAME;
      await act(app, () => {});
      expect(ratioOf(app), 'clamped at 879px').toBeCloseTo(1 - PANE_MIN_PX.linear / W, 3);
    }, () => width);
  });
});

// ─── US-01M7CCT5 round 2: both floors at any width, the divider on the boundary, a visible line ───

describe('US-01M7CCT5 AC1: both expanded panes keep their minimum at any canvas width', () => {
  it('US-01M7CCT5 AC1 holds the 320px and 300px floors in the stylesheet at every frame width and ratio, with the divider on the boundary', async () => {
    let width = FRAME;
    await withSplit(async (app) => {
      // A dragged ratio, so the frame carries its own tracks (is-resized).
      await drag(app, [xForCircle(520)]);
      expect(frame(app).classList.contains('is-resized')).toBe(true);
      // App.css's floors are the helper's.
      const t = columns(app).tracks;
      expect(t.map((x) => Number(/^minmax\((\d+)px,/.exec(x)?.[1]))).toEqual([PANE_MIN_PX.circular, PANE_MIN_PX.linear]);
      // Whatever ratio the frame holds (a stale one the state has not re-clamped yet, or one written
      // mid-drag), and whatever width the canvas gives it from the 760px breakpoint up, both cards keep
      // their floor and the divider and its buttons sit on the boundary between them.
      for (const w of [760, 775, 790, 830, 879, 1000, 1400]) {
        width = w;
        for (const r of [0.02, 0.2, 0.37, 0.5, 0.62, 0.66, 0.8, 0.98]) {
          for (const [k, v] of Object.entries(paneSplitStyle(r))) frame(app).style.setProperty(k, v);
          const c = columns(app, w);
          const at = `${w}px frame, ratio ${r}`;
          expect(c.circle, at).toBeGreaterThanOrEqual(PANE_MIN_PX.circular - 1e-9);
          expect(c.linear, at).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 1e-9);
          expect(c.circle + c.linear, at).toBeCloseTo(cols(w), 9);
          // Inside the floors the circle takes the ratio's share.
          const free = r * cols(w);
          if (free >= PANE_MIN_PX.circular && cols(w) - free >= PANE_MIN_PX.linear) expect(c.circle, at).toBeCloseTo(free, 6);
          const boundary = c.circle + PANE_SPLIT_GAP_PX / 2;
          expect(centreOf(app, divider(app), w), `divider, ${at}`).toBeCloseTo(boundary, 6);
          expect(centreOf(app, app.one('.map-seq-divider-controls'), w), `collapse buttons, ${at}`).toBeCloseTo(boundary, 6);
        }
      }
      // The default ratio's own 4fr : 5fr tracks hold both floors from the breakpoint up as well.
      await dblclick(app, divider(app));
      for (const w of [760, 879, 1400]) {
        const c = columns(app, w);
        expect(c.tracks).toEqual(['minmax(320px, 4fr)', 'minmax(0, 5fr)']);
        expect(c.circle).toBeGreaterThanOrEqual(PANE_MIN_PX.circular);
        expect(c.linear, `${w}px default`).toBeGreaterThanOrEqual(PANE_MIN_PX.linear);
        expect(Math.abs(centreOf(app, divider(app), w) - (c.circle + PANE_SPLIT_GAP_PX / 2)), 'the 4-decimal ratio puts it within 0.1px').toBeLessThan(0.1);
      }
      // Below the breakpoint the maps stack: one column, no divider shown.
      expect(gridTracks(cascaded(app.one('.map-seq-grid.mode-split'), 'grid-template-columns', { ...VIEW, canvas: 759 })!)).toEqual(['minmax(0, 1fr)']);
      expect(cascaded(divider(app), 'display', { ...VIEW, canvas: 759 })).toBe('none');
    }, () => width);
  });

  it('US-01M7CCT5 AC1 keeps the linear map at 300px when the inspector or explorer widens after a drag to its minimum', async () => {
    // The frame is the 1440px window less the explorer, the inspector and 28px of chrome: 879px at
    // the defaults (245px explorer, 288px inspector), as measured.
    let ref: AppHarness | null = null;
    const frameWidth = () => {
      if (!ref) return FRAME;
      try {
        const inspector = Number(ref.one('.mbc-inspector-resizer').getAttribute('aria-valuenow'));
        const explorer = Number(ref.one('.mbc-sidebar-resizer').getAttribute('aria-valuenow'));
        return WINDOW - 28 - explorer - inspector;
      } catch { return FRAME; }
    };
    await withSplit(async (app) => {
      ref = app;
      expect(frameWidth()).toBe(FRAME);
      await drag(app, [FRAME - PANE_SPLIT_GAP_PX / 2 - 200]);
      expect(columns(app).linear, 'dragged to the linear minimum').toBeCloseTo(PANE_MIN_PX.linear, 0);
      const keep = async (what: string) => {
        const w = frameWidth();
        const c = columns(app, w);
        expect(c.linear, `${what}: ${w}px frame`).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 0.5);
        expect(c.circle, `${what}: ${w}px frame`).toBeGreaterThanOrEqual(PANE_MIN_PX.circular - 0.5);
        expect(Math.abs(centreOf(app, divider(app), w) - (c.circle + PANE_SPLIT_GAP_PX / 2)), `${what}: the divider on the boundary`).toBeLessThan(0.1);
        // The rendered ratio follows too: the frame's ratio is held to the floors at the new width.
        expect(ratioOf(app), `${what}: the rendered ratio`).toBeLessThanOrEqual(1 - PANE_MIN_PX.linear / cols(w) + 1e-4);
        return w;
      };
      // The inspector widened by keyboard, 16px a press.
      await act(app, () => { app.one('.mbc-inspector-resizer').focus(); });
      for (let i = 0; i < 4; i++) await app.press('ArrowLeft');
      expect(await keep('inspector +64px')).toBe(FRAME - 64);
      // The explorer widened too.
      await act(app, () => { app.one('.mbc-sidebar-resizer').focus(); });
      for (let i = 0; i < 2; i++) await app.press('ArrowRight');
      expect(await keep('explorer +32px')).toBe(FRAME - 96);
      await act(app, () => { app.one('.mbc-inspector-resizer').focus(); });
      await app.press('ArrowLeft');
      expect(await keep('inspector +80px')).toBe(FRAME - 112);
      // Past the point where the canvas holds both maps side by side, they stack: the fallback.
      await act(app, () => { app.one('.mbc-sidebar-resizer').focus(); });
      await app.press('ArrowRight');
      expect(frameWidth()).toBe(FRAME - 128);
      expect(columns(app, FRAME - 128).tracks, 'stacked below a 760px canvas').toEqual(['minmax(0, 1fr)']);
    }, frameWidth);
  });

  it('US-01M7CCT5 AC1 draws a visible resting line on the divider', () => {
    const rest = appCssRules().filter((r) => r.at.length === 0 && r.selectorText.trim() === '.map-seq-divider::after');
    expect(rest, 'one resting rule for the divider line').toHaveLength(1);
    const decl = (n: string) => rest[0].decls.find((d) => d.name === n)?.value.trim();
    expect(decl('background'), 'the line has a colour at rest').toMatch(/^var\(--mbc-border-strong\)$/);
    expect(Number(/^(\d+)px$/.exec(decl('width') ?? '')?.[1])).toBeGreaterThanOrEqual(2);
    expect(decl('top')).toBe('0');
    expect(decl('bottom')).toBe('0');
  });
});

describe('US-01M7CCT5 AC3: the Collapse controls show in the side-by-side Split layout', () => {
  it('US-01M7CCT5 AC3 shows both Collapse buttons, beside the divider, in Split', async () => {
    await withSplit(async (app) => {
      const controls = app.one('.map-seq-divider-controls');
      expect(cascaded(controls, 'display', VIEW)).toBe('flex');
      for (const label of ['Collapse circular map', 'Collapse linear map']) {
        const b = named(app, label);
        expect(b.parentElement).toBe(controls);
        expect(cascaded(b, 'display', VIEW), label).not.toBe('none');
        expect(Number(/^(\d+)px$/.exec(cascaded(b, 'width', VIEW) ?? '')?.[1]), label).toBeGreaterThan(0);
      }
      expect(centreOf(app, controls, FRAME)).toBeCloseTo(columns(app).circle + PANE_SPLIT_GAP_PX / 2, 1);
    });
  });
});

// ─── BG-01M7CKN7: the ratio the user chose is kept; only the rendered layout is clamped ───

describe('BG-01M7CKN7 AC1: narrowing and widening the window restores the divider to the ratio the user dragged to', () => {
  it('BG-01M7CKN7 AC1 clamps only the rendered ratio, side by side, and steps from where the divider is drawn', () => {
    for (const w of [760, 800, 879, 1400]) {
      for (const r of [0.05, 0.3, 4 / 9, 0.6548, 0.95]) {
        expect(renderedPaneSplitRatio(r, w), `${w}px, ${r}`).toBe(clampPaneSplitRatio(r, w));
      }
    }
    // Stacked (below 760px) or with no width measured, the chosen ratio is kept for when the maps are side by side.
    for (const w of [null, 0, 400, 759]) expect(renderedPaneSplitRatio(0.95, w), String(w)).toBe(0.95);
    // A key press after a clamp moves from the drawn divider, not from the ratio the window cannot hold.
    const hi = 1 - PANE_MIN_PX.linear / cols(800);
    const wide = { ratio: 569 / cols(FRAME), collapsed: null };
    expect(wide.ratio).toBeGreaterThan(hi);
    expect(stepPaneSplit(wide, -16, 800).ratio).toBeCloseTo(hi - 16 / cols(800), 12);
    expect(stepPaneSplit(wide, 16, 800).ratio).toBeCloseTo(hi, 12);
  });

  it('BG-01M7CKN7 AC1 returns a dragged split after the window narrows and widens, and saves the chosen ratio', async () => {
    let width = FRAME;
    await withSplit(async (app) => {
      const W = cols(FRAME);
      // Dragged to the linear map's minimum at 879px: 569 / 300.
      await drag(app, [FRAME - PANE_SPLIT_GAP_PX / 2 - PANE_MIN_PX.linear]);
      expect(columns(app).circle).toBeCloseTo(569, 0);
      expect(columns(app).linear).toBeCloseTo(PANE_MIN_PX.linear, 0);
      for (const narrow of [800, 760, 700]) {
        width = narrow;
        await act(app, () => {});
        if (narrow >= 760) {
          expect(ratioOf(app), `${narrow}px: drawn clamped`).toBeCloseTo(1 - PANE_MIN_PX.linear / cols(narrow), 4);
          expect(columns(app, narrow).linear, `${narrow}px`).toBeGreaterThanOrEqual(PANE_MIN_PX.linear - 0.5);
          expect(divider(app).getAttribute('aria-valuenow'), `${narrow}px: announces the drawn ratio`)
            .toBe(String(Math.round((1 - PANE_MIN_PX.linear / cols(narrow)) * 100)));
        }
        // The session keeps the ratio the user chose, not the one this width can hold.
        const env = await autosaved(app);
        expect(env.workspace.paneSplit?.ratio, `${narrow}px: saved`).toBeCloseTo(569 / W, 6);
        width = FRAME;
        await act(app, () => {});
        expect(ratioOf(app), `back from ${narrow}px`).toBeCloseTo(569 / W, 4);
        expect(columns(app).circle, `back from ${narrow}px`).toBeCloseTo(569, 0);
      }

      // Reopened at a narrow width, a saved session draws clamped and returns to its ratio when there is room.
      const env = await autosaved(app);
      await dblclick(app, divider(app));
      width = 800;
      await reopen(app, env, { ratio: 569 / W, collapsed: null });
      expect(ratioOf(app)).toBeCloseTo(1 - PANE_MIN_PX.linear / cols(800), 4);
      expect((await autosaved(app)).workspace.paneSplit?.ratio, 'reopened narrow, saved as chosen').toBeCloseTo(569 / W, 6);
      width = FRAME;
      await act(app, () => {});
      expect(ratioOf(app), 'reopened, then widened').toBeCloseTo(569 / W, 4);

      // Collapse and restore at a narrow width keep the chosen ratio too.
      width = 800;
      await act(app, () => {});
      await app.click(named(app, 'Collapse linear map'));
      expect((await autosaved(app)).workspace.paneSplit).toEqual({ ratio: expect.closeTo(569 / W, 6), collapsed: 'linear' });
      width = FRAME;
      await act(app, () => {});
      await app.click(named(app, 'Restore linear map'));
      expect(ratioOf(app), 'restored at the chosen ratio').toBeCloseTo(569 / W, 4);

      // A cancelled drag at a narrow width puts back the drawn (clamped) divider, not the unclamped ratio.
      width = 800;
      await act(app, () => {});
      const drawn = 1 - PANE_MIN_PX.linear / cols(800);
      await drag(app, [xForCircle(400)], 'pointercancel', xForCircle(drawn * cols(800)));
      expect(ratioOf(app), 'cancel at 800px').toBeCloseTo(drawn, 4);
      width = FRAME;
      await act(app, () => {});
      expect(ratioOf(app), 'a cancel keeps the chosen ratio').toBeCloseTo(569 / W, 4);
    }, () => width);
  });

  it('BG-01M7CKN7 AC1 steps from the drawn divider after a clamp, and that becomes the ratio kept', async () => {
    let width = FRAME;
    await withSplit(async (app) => {
      await drag(app, [FRAME - PANE_SPLIT_GAP_PX / 2 - PANE_MIN_PX.linear]);
      width = 800;
      await act(app, () => {});
      const drawn = 1 - PANE_MIN_PX.linear / cols(800);
      expect(ratioOf(app)).toBeCloseTo(drawn, 4);
      await focusDivider(app);
      await press(app, 'ArrowLeft');
      expect(ratioOf(app), 'one press moves 16px from where the divider is drawn').toBeCloseTo(drawn - 16 / cols(800), 4);
      const kept = drawn - 16 / cols(800);
      expect((await autosaved(app)).workspace.paneSplit?.ratio).toBeCloseTo(kept, 6);
      // Widened again, the divider stays where the key put it: the press chose a new ratio.
      width = FRAME;
      await act(app, () => {});
      expect(ratioOf(app)).toBeCloseTo(kept, 4);
    }, () => width);
  });

  it('BG-01M7CKN7 AC1 fades the pane a release would fold away, and selects no text while dragging', async () => {
    await withSplit(async (app) => {
      const el = divider(app);
      const start = xForCircle(ratioOf(app) * cols(FRAME));
      await act(app, () => { dispatchLiveEvent(el, 'pointerdown', { pointerId: 9, button: 0, buttons: 1, clientX: start, isPrimary: true }); });
      expect(frame(app).classList.contains('dragging')).toBe(true);
      expect(frame(app).hasAttribute('data-collapse-preview'), 'no preview before a threshold').toBe(false);
      await act(app, () => { dispatchLiveEvent(el, 'pointermove', { pointerId: 9, buttons: 1, clientX: FRAME - 20 }); });
      expect(frame(app).getAttribute('data-collapse-preview')).toBe('linear');
      await act(app, () => { dispatchLiveEvent(el, 'pointermove', { pointerId: 9, buttons: 1, clientX: 20 }); });
      expect(frame(app).getAttribute('data-collapse-preview')).toBe('circular');
      await act(app, () => { dispatchLiveEvent(el, 'pointermove', { pointerId: 9, buttons: 1, clientX: start }); });
      expect(frame(app).hasAttribute('data-collapse-preview'), 'back inside, no preview').toBe(false);
      await act(app, () => { dispatchLiveEvent(el, 'pointermove', { pointerId: 9, buttons: 1, clientX: FRAME - 20 }); });
      await act(app, () => { dispatchLiveEvent(el, 'pointerup', { pointerId: 9, clientX: FRAME - 20 }); });
      expect(frame(app).classList.contains('collapsed-linear')).toBe(true);
      expect(frame(app).hasAttribute('data-collapse-preview'), 'the release clears the preview').toBe(false);
      expect(frame(app).classList.contains('dragging')).toBe(false);
      // App.css: the dragging frame selects no text, and the previewed card fades.
      const view = VIEW;
      const dragging = appCssRules().filter((r) => r.selectorText.split(',').some((x) => x.trim() === '.map-seq-split.dragging'));
      const decl = (n: string) => dragging.flatMap((r) => r.decls).find((d) => d.name === n)?.value.trim();
      expect([decl('user-select'), decl('-webkit-user-select')]).toEqual(['none', 'none']);
      for (const [pane, card] of [['circular', '.plasmid-map-wrapper'], ['linear', '.linear-seq-container']] as const) {
        frame(app).setAttribute('data-collapse-preview', pane);
        expect(Number(cascaded(app.one(`.map-seq-grid > ${card}`), 'opacity', view)), pane).toBeLessThan(1);
        frame(app).removeAttribute('data-collapse-preview');
        expect(cascaded(app.one(`.map-seq-grid > ${card}`), 'opacity', view), `${pane} at rest`).not.toBe('0.35');
      }
    });
  });
});
