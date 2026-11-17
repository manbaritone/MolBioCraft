// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CMZ5: the alignment matrix zooms around the hovered column without recentring on the
 * cursor column (CR-01M7CCSD).
 *
 * Every check but the pure ones runs in the real App over the live DOM (appHarness.tsx), with an
 * alignment restored on its Alignment tab, and reads the App's own DOM: the % field, the grid's
 * scroll element, the cursor box the grid draws over the cursor column and the status footer. The
 * live DOM has no layout, so the grid's scroll element is given a 900 x 420 box with its top-left
 * corner at (37, 61) in the window; every other box is 0 x 0, as the track a click lands on. React 18
 * listens for wheels passively at its root, so a wheel the grid takes reports defaultPrevented only
 * when the grid listens for it natively and non-passively. The live DOM does not scroll: a test sets
 * scrollLeft or scrollTop and sends the scroll event a browser would.
 *
 * Positions are read from the DOM, not from a model of the grid's geometry: the cursor box is drawn
 * at the cursor column's left edge (its `left`) and is the column's width, so with the cursor on the
 * hovered column the column's left edge on screen is nameW + left - scrollLeft.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, type Layout, type LiveElement } from './liveDom';
import {
  ALIGNMENT_ZOOM_BOUNDS,
  alignmentWheelStep,
  type AlignmentWheelContext,
} from '../components/AlignmentCanvas';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

const SCROLL_W = 900;
const SCROLL_H = 420;
const ORIGIN = { x: 37, y: 61 };

const gridLayout: Layout = (el) =>
  el.isConnected && el.classList.contains('mbc-aln-scroll') ? { width: SCROLL_W, height: SCROLL_H } : { width: 0, height: 0 };

function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
const BASE = lettersFrom(0x5a7e, 600);
const swap = (seq: string, col1: number) => seq.slice(0, col1 - 1) + 'ACGT'[('ACGT'.indexOf(seq[col1 - 1]) + 1) % 4] + seq.slice(col1);
const ALN: SequenceDocument = {
  id: 'cmz5-aln', name: 'CMZ5 alignment', accession: 'CMZ5_0001', description: 'An alignment built in the test',
  sequence: BASE, moleculeType: 'DNA', topology: 'linear', folder: 'Alignments', documentKind: 'alignment',
  createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', features: [], primers: [], history: [],
  alignmentMeta: {
    isAligned: true,
    sequences: [['Alpha', 0], ['Bravo', 140], ['Charlie', 333], ['Delta', 501]].map(([name, col], i) => ({
      id: `cmz5-m${i}`, name: String(name), sequence: col ? swap(BASE, Number(col)) : BASE,
    })),
  },
} as SequenceDocument;
/** Four columns: Fit to window would ask for a zoom far over 400%. */
const TINY: SequenceDocument = {
  ...ALN, id: 'cmz5-tiny', name: 'CMZ5 tiny', sequence: 'ACGT',
  alignmentMeta: { isAligned: true, sequences: [{ id: 't0', name: 'T0', sequence: 'ACGT' }, { id: 't1', name: 'T1', sequence: 'ACGA' }] },
} as SequenceDocument;

// ─── The App, mounted on the alignment ───

interface Grid {
  app: AppHarness;
  el: LiveElement;
}
async function withGrid(doc: SequenceDocument, run: (g: Grid) => Promise<void>) {
  const app = await mountApp({ width: 1280, height: 800, layout: gridLayout });
  try {
    await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-alignment' });
    const el = app.one('.mbc-aln-scroll', 'the alignment grid');
    const rect = { x: ORIGIN.x, y: ORIGIN.y, left: ORIGIN.x, top: ORIGIN.y, right: ORIGIN.x + SCROLL_W, bottom: ORIGIN.y + SCROLL_H, width: SCROLL_W, height: SCROLL_H };
    (el as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
    await run({ app, el });
  } finally {
    app.unmount();
  }
}

const field = (g: Grid) => g.app.one('input[aria-label="Zoom Percentage"]', 'the % field') as LiveElement & { value: string };
const zoomShown = (g: Grid) => field(g).value;
const nameW = (g: Grid) => Number(g.app.one('[role="separator"][aria-label="Resize the sequence name and identity column"]').getAttribute('aria-valuenow'));
const px = (v: unknown) => parseFloat(String(v));
/** The cursor column's box: its left edge in the track and its width (the same in every line of a block). */
function cursorBox(g: Grid) {
  const boxes = g.app.all('.mbc-aln-cursor');
  expect(boxes.length, 'the grid draws the cursor box').toBeGreaterThan(0);
  return { left: px(boxes[0].style.left), width: px(boxes[0].style.width) };
}
/** The top of the first line drawing the cursor box: the cursor's block's first line after its ruler. */
function cursorLineTop(g: Grid): number {
  const tops = g.app.all('.mbc-aln-cursor').map((c) => px(c.parentElement!.parentElement!.style.top)).filter((t) => Number.isFinite(t));
  expect(tops.length, 'a body line draws the cursor box').toBeGreaterThan(0);
  return Math.min(...tops);
}
const footer = (g: Grid) => g.app.one('.mbc-aln-status-footer').textContent;
const cursorColumn = (g: Grid) => Number(/Column ([\d,]+) of/.exec(footer(g))![1].replace(/,/g, ''));
const seqTrack = (g: Grid, row = 0) => g.app.all('.mbc-aln-track.kind-seq')[row];

async function scrollTo(g: Grid, at: { left?: number; top?: number }) {
  if (at.left !== undefined) g.el.scrollLeft = at.left;
  if (at.top !== undefined) g.el.scrollTop = at.top;
  await act(async () => { dispatchLiveEvent(g.el, 'scroll'); });
  await g.app.settle();
}
/** A click on row `row`'s track `clientX` px from the track's (0 x 0 box's) left edge. */
async function clickTrack(g: Grid, clientX: number, row = 0) {
  await g.app.click(seqTrack(g, row), { clientX, clientY: 5 });
}
/** A wheel over the grid (it lands on a residue track and bubbles), settled; the event as delivered. */
async function wheel(g: Grid, init: Record<string, unknown>) {
  let ev: ReturnType<typeof dispatchLiveEvent> | null = null;
  await act(async () => {
    ev = dispatchLiveEvent(seqTrack(g), 'wheel', { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, ...init });
  });
  await g.app.settle();
  return ev!;
}
async function gesture(g: Grid, type: string, init: Record<string, unknown>) {
  let ev: ReturnType<typeof dispatchLiveEvent> | null = null;
  await act(async () => { ev = dispatchLiveEvent(seqTrack(g), type, init); });
  await g.app.settle();
  return ev!;
}
async function setZoomField(g: Grid, value: string) {
  await g.app.change(field(g), value);
}
const button = (g: Grid, label: string) => {
  const found = g.app.all('button').filter((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  expect(found, `one ${label} button`).toHaveLength(1);
  return found[0];
};

/**
 * Puts the cursor on the column a click `clickX` px into the track hits, scrolls that column's left
 * edge to `screenLeft` px into the visible track, and wheels at `frac` of its width with `init`.
 * Returns the column's left edge and the pointer, in visible-track px, before and after.
 */
async function anchoredWheel(g: Grid, o: { clickX: number; screenLeft: number; frac: number; init: Record<string, unknown> }) {
  await clickTrack(g, o.clickX);
  const col = cursorColumn(g);
  const before = cursorBox(g);
  const scrollLeft = before.left - o.screenLeft;
  expect(scrollLeft, 'the case scrolls the grid off 0').toBeGreaterThan(50);
  await scrollTo(g, { left: scrollLeft });
  const w = nameW(g);
  const pointerTrackX = o.screenLeft + o.frac * before.width;
  const zoomBefore = zoomShown(g);
  const ev = await wheel(g, { clientX: ORIGIN.x + w + pointerTrackX, clientY: ORIGIN.y + 200, ...o.init });
  const after = cursorBox(g);
  return {
    ev, col, before, after, zoomBefore, zoomAfter: zoomShown(g),
    pointerTrackX,
    leftBefore: o.screenLeft,
    leftAfter: after.left - g.el.scrollLeft,
    recentred: Math.max(0, after.left - (SCROLL_W - w) / 2),
    colAfter: cursorColumn(g),
  };
}
function expectAnchored(r: Awaited<ReturnType<typeof anchoredWheel>>, g: Grid) {
  expect(r.ev.defaultPrevented, 'the wheel zoom is prevented').toBe(true);
  expect(r.zoomAfter, 'the wheel zoomed').not.toBe(r.zoomBefore);
  expect(r.colAfter, 'the cursor stays on its column').toBe(r.col);
  expect(Math.abs(r.leftAfter - r.leftBefore), `the column's left edge stays within 1px (was ${r.leftBefore}, now ${r.leftAfter})`).toBeLessThanOrEqual(1);
  expect(r.pointerTrackX, 'the pointer is still over the column').toBeGreaterThanOrEqual(r.leftAfter);
  expect(r.pointerTrackX, 'the pointer is still over the column').toBeLessThan(r.leftAfter + r.after.width);
  // The case can tell a recentring zoom from an anchored one.
  expect(Math.abs(g.el.scrollLeft - r.recentred), 'the cursor column was not recentred').toBeGreaterThan(20);
}

// ─── AC1 ───

describe('US-01M7CMZ5 AC1: which gestures over the matrix scroll it and which zoom it', () => {
  it('US-01M7CMZ5 AC1 a plain vertical wheel, an Alt+wheel and a horizontal wheel scroll it, unprevented and unzoomed', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      for (const init of [{ deltaY: 100 }, { deltaY: -100, altKey: true }, { deltaX: 120, deltaY: 4 }, { deltaX: -120, deltaY: 2, ctrlKey: true }]) {
        const ev = await wheel(g, { ...at, ...init });
        expect(ev.defaultPrevented, `${JSON.stringify(init)} keeps its default (the browser scrolls)`).toBe(false);
        expect(zoomShown(g), `${JSON.stringify(init)} does not zoom`).toBe('100');
      }
    });
  });

  it('US-01M7CMZ5 AC1 a Ctrl+wheel, a Cmd+wheel and a ctrl-flagged pinch wheel zoom it through a native non-passive listener', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      let ev = await wheel(g, { ...at, deltaY: -100, ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(zoomShown(g)).toBe('108');
      ev = await wheel(g, { ...at, deltaY: 100, metaKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(zoomShown(g)).toBe('100');
      ev = await wheel(g, { ...at, deltaY: -6.5, ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(Number(zoomShown(g))).toBeCloseTo(Math.round(100 * Math.pow(1.08, 0.065) * 10) / 10, 6);
      expect(Number(zoomShown(g))).toBeGreaterThan(100);
    });
  });

  it('US-01M7CMZ5 AC1 a WebKit gesturestart / gesturechange pinch zooms it, prevented, and the wheels it sends meanwhile are not applied twice', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      const start = await gesture(g, 'gesturestart', { ...at, scale: 1 });
      expect(start.defaultPrevented).toBe(true);
      const change = await gesture(g, 'gesturechange', { ...at, scale: 1.5 });
      expect(change.defaultPrevented).toBe(true);
      expect(zoomShown(g)).toBe('150');
      const during = await wheel(g, { ...at, deltaY: -50, ctrlKey: true });
      expect(during.defaultPrevented, 'a pinch wheel during the gesture is prevented').toBe(true);
      expect(zoomShown(g), 'and not applied on top of the gesture').toBe('150');
      const end = await gesture(g, 'gestureend', { ...at, scale: 1.5 });
      expect(end.defaultPrevented).toBe(true);
      await wheel(g, { ...at, deltaY: 100, ctrlKey: true });
      expect(Number(zoomShown(g)), 'after the gesture a pinch wheel zooms again').toBeCloseTo(Math.round((150 / 1.08) * 10) / 10, 6);
    });
  });

  it('US-01M7CMZ5 AC1 alignmentWheelStep takes only the zoom gestures of a scroll surface', () => {
    const view = { zoomPct: 100, scrollLeft: 500, scrollTop: 0 };
    const at = { clientX: 300, clientY: 100, deltaMode: 0 };
    const none = { ctrlKey: false, metaKey: false, altKey: false };
    for (const e of [{ deltaX: 0, deltaY: 100, ...none }, { deltaX: 0, deltaY: 100, ...none, altKey: true }, { deltaX: 90, deltaY: 3, ...none, ctrlKey: true }]) {
      const step = alignmentWheelStep({ ...e, ...at }, view, CTX);
      expect(step.handled).toBe(false);
      expect(step.view).toEqual(view);
    }
    for (const e of [{ deltaX: 0, deltaY: -100, ...none, ctrlKey: true }, { deltaX: 0, deltaY: -100, ...none, metaKey: true }]) {
      const step = alignmentWheelStep({ ...e, ...at }, view, CTX);
      expect(step.handled).toBe(true);
      expect(step.view.zoomPct).toBeCloseTo(108, 9);
    }
  });
});

/** The App's defaults: 13 px letters at 100%, spacing every 10, a 248 px name column, no wrap. */
const CTX: AlignmentWheelContext = {
  origin: { x: 0, y: 0 },
  viewportWidth: SCROLL_W,
  nameW: 248,
  columnCount: 600,
  settings: { letterFontSize: 13, showLetters: true, spacesEvery: 10, zoomedOutRowHeight: 14, wrap: false },
  block: { fixedPx: 0, rowLines: 1, logo: false },
};

// ─── AC2 ───

describe('US-01M7CMZ5 AC2: the hovered column stays under the pointer, and only a wheel zoom skips the recentre', () => {
  it('US-01M7CMZ5 AC2 with spacing groups on, a wheel zoom in and out keeps the hovered column and its left edge', async () => {
    await withGrid(ALN, async (g) => {
      let r = await anchoredWheel(g, { clickX: 2400, screenLeft: 110, frac: 0.4, init: { deltaY: -100, ctrlKey: true } });
      expectAnchored(r, g);
      r = await anchoredWheel(g, { clickX: 3300, screenLeft: 480, frac: 0.3, init: { deltaY: 100, ctrlKey: true } });
      expectAnchored(r, g);
      // Zooming out with the pointer near the column's right edge still keeps it over the column.
      r = await anchoredWheel(g, { clickX: 2900, screenLeft: 200, frac: 0.97, init: { deltaY: 100, ctrlKey: true } });
      expectAnchored(r, g);
    });
  });

  it('US-01M7CMZ5 AC2 with spacing off, a wheel zoom keeps the hovered column and its left edge', async () => {
    await withGrid(ALN, async (g) => {
      await g.app.click(g.app.one('[role="tablist"][aria-label="Alignment Inspector Tabs"] button[role="tab"][aria-label="Advanced"]'));
      const spacing = g.app.all('.mbc-aln-inspector-body label').filter((l) => l.querySelectorAll('span')[0]?.textContent === 'Space every N residues:').map((l) => l.querySelectorAll('input')[0]);
      expect(spacing).toHaveLength(1);
      await g.app.change(spacing[0], '0');
      const r = await anchoredWheel(g, { clickX: 2000, screenLeft: 90, frac: 0.6, init: { deltaY: -160, ctrlKey: true } });
      expectAnchored(r, g);
    });
  });

  it('US-01M7CMZ5 AC2 a wheel zoom that takes colW over 7 (letters and spacing groups appear) keeps the hovered column, by column index', async () => {
    await withGrid(ALN, async (g) => {
      await setZoomField(g, '65');
      expect(cursorBox(g).width, 'at 65% a column is under 7px').toBeLessThan(7);
      expect(g.app.all('.mbc-aln-cell').length, 'no letters at 65%').toBe(0);
      const r = await anchoredWheel(g, { clickX: 2028 + 3, screenLeft: 150, frac: 0.5, init: { deltaY: -100, ctrlKey: true } });
      expect(r.after.width, 'the zoom took the column over 7px').toBeGreaterThan(7);
      expect(g.app.all('.mbc-aln-cell').length, 'letters show').toBeGreaterThan(0);
      expectAnchored(r, g);
      // A pixel-ratio anchor would have put the column where its old x times the ratio lands.
      const ratioLeft = r.before.left * (Number(r.zoomAfter) / 65) - (r.before.left - 150);
      expect(Math.abs(ratioLeft - r.leftAfter), 'the anchor is not a pixel ratio').toBeGreaterThan(20);
    });
  });

  it('US-01M7CMZ5 AC2 toolbar -/+, the % field, 100% and Fit still centre the cursor column', async () => {
    await withGrid(ALN, async (g) => {
      await clickTrack(g, 3000);
      const w = nameW(g);
      const centred = () => Math.max(0, cursorBox(g).left - (SCROLL_W - w) / 2);
      const steps: [string, () => Promise<void>][] = [
        ['Zoom in', () => g.app.click(button(g, 'Zoom in'))],
        ['Zoom out', () => g.app.click(button(g, 'Zoom out'))],
        ['% field', () => setZoomField(g, '140')],
        ['100%', () => g.app.click(button(g, '100%'))],
        ['Fit', () => g.app.click(button(g, 'Fit'))],
      ];
      for (const [name, act1] of steps) {
        if (name === 'Fit') await setZoomField(g, '90');
        await scrollTo(g, { left: 37 });
        const zoom = zoomShown(g);
        await act1();
        expect(zoomShown(g), `${name} changed the zoom`).not.toBe(zoom);
        expect(Math.abs(g.el.scrollLeft - centred()), `${name} centres the cursor column`).toBeLessThanOrEqual(1);
      }
    });
  });

  it('US-01M7CMZ5 AC2 alignmentWheelStep anchors by column index across the colW-7 switch', () => {
    // 65% is 6.76px a column with no spacing groups; one notch in is 70.2%, 7.3px with a 4.38px gap every 10.
    const view = { zoomPct: 65, scrollLeft: 1800, scrollTop: 0 };
    const idx = 300;
    const fromLeft = idx * 6.76 - view.scrollLeft;
    const step = alignmentWheelStep(
      { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false, altKey: false, clientX: CTX.nameW + fromLeft + 3, clientY: 50 },
      view,
      CTX,
    );
    expect(step.handled).toBe(true);
    const colW = 13 * 0.8 * step.view.zoomPct / 100;
    const toX = idx * colW + Math.floor(idx / 10) * Math.max(4, colW * 0.6);
    expect(Math.abs(toX - step.view.scrollLeft - fromLeft)).toBeLessThanOrEqual(1);
  });
});

// ─── AC3 ───

describe('US-01M7CMZ5 AC3: one 0.5-400 bound; the wheel stores its zoom unrounded, the toolbar rounds to 0.1', () => {
  it('US-01M7CMZ5 AC3 the bound is exported as 0.5 to 400', () => {
    expect(ALIGNMENT_ZOOM_BOUNDS).toEqual({ min: 0.5, max: 400 });
  });

  it('US-01M7CMZ5 AC3 a wheel zoom is stored unrounded, shown to 0.1, and the toolbar steps still round to 0.1', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      await wheel(g, { ...at, deltaY: -37, ctrlKey: true });
      const z = 100 * Math.pow(1.08, 0.37);
      expect(zoomShown(g), 'the % field shows the zoom to 0.1').toBe(String(Math.round(z * 10) / 10));
      expect(Math.abs(cursorBox(g).width - (13 * 0.8 * z) / 100), 'the grid draws the unrounded zoom').toBeLessThan(1e-6);
      await g.app.click(button(g, 'Zoom in'));
      const stepped = Math.round(z * 1.25 * 10) / 10;
      expect(zoomShown(g)).toBe(String(stepped));
      expect(Math.abs(cursorBox(g).width - (13 * 0.8 * stepped) / 100), 'the toolbar step is rounded to 0.1').toBeLessThan(1e-6);
      await wheel(g, { ...at, deltaY: 23, ctrlKey: true });
      const z2 = stepped / Math.pow(1.08, 0.23);
      await g.app.click(button(g, 'Zoom out'));
      const down = Math.round((z2 / 1.25) * 10) / 10;
      expect(Math.abs(cursorBox(g).width - (13 * 0.8 * down) / 100), 'zoom out rounds to 0.1').toBeLessThan(1e-6);
    });
  });

  it('US-01M7CMZ5 AC3 the wheel, the toolbar steps and the % field meet the same 0.5 and 400 bounds', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      await setZoomField(g, '390');
      for (let i = 0; i < 3; i++) await wheel(g, { ...at, deltaY: -400, ctrlKey: true });
      expect(zoomShown(g), 'the wheel stops at 400').toBe('400');
      const held = await wheel(g, { ...at, deltaY: -400, ctrlKey: true });
      expect(held.defaultPrevented, 'a wheel held at the bound is still the grid\'s').toBe(true);
      await g.app.click(button(g, 'Zoom in'));
      expect(zoomShown(g), 'zoom in stops at 400').toBe('400');
      await setZoomField(g, '1000');
      expect(zoomShown(g), 'the % field stops at 400').toBe('400');
      await setZoomField(g, '0.6');
      for (let i = 0; i < 3; i++) await wheel(g, { ...at, deltaY: 400, ctrlKey: true });
      expect(zoomShown(g), 'the wheel stops at 0.5').toBe('0.5');
      await g.app.click(button(g, 'Zoom out'));
      expect(zoomShown(g), 'zoom out stops at 0.5').toBe('0.5');
      await setZoomField(g, '0.1');
      expect(zoomShown(g), 'the % field stops at 0.5').toBe('0.5');
    });
  });

  it('US-01M7CMZ5 AC3 Fit meets the same 400 bound on an alignment narrower than the window', async () => {
    await withGrid(TINY, async (g) => {
      await g.app.click(button(g, 'Fit'));
      expect(zoomShown(g), 'Fit stops at 400').toBe('400');
      expect(Math.abs(cursorBox(g).width - (13 * 0.8 * 400) / 100)).toBeLessThan(1e-6);
    });
  });
});

// ─── AC4 ───

describe('US-01M7CMZ5 AC4: in wrap mode the hovered column\'s block line keeps its height in the viewport', () => {
  it('US-01M7CMZ5 AC4 a wheel zoom that moves the hovered column into another block keeps that block line\'s top where it was', async () => {
    await withGrid(ALN, async (g) => {
      // Column 170 (index 169) is the last of block 3 at 100% (57 columns a block) and in block 4 at 108%.
      await clickTrack(g, 169 * 10.4 + 16 * 6.24 + 3);
      expect(cursorColumn(g)).toBe(170);
      await g.app.click(g.app.one('[role="tablist"][aria-label="Alignment Inspector Tabs"] button[role="tab"][aria-label="Advanced"]'));
      const wrapBox = g.app.all('.mbc-aln-inspector-body label').filter((l) => /^Wrap( alignment)?$/.test(l.querySelectorAll('span')[0]?.textContent ?? '')).map((l) => l.querySelectorAll('input')[0]);
      expect(wrapBox.length).toBeGreaterThan(0);
      await g.app.change(wrapBox[0], true);
      const top = cursorLineTop(g);
      const inView = 50;
      await scrollTo(g, { top: top - inView });
      expect(cursorLineTop(g)).toBe(top);
      const box = cursorBox(g);
      const ev = await wheel(g, { clientX: ORIGIN.x + nameW(g) + box.left + box.width / 2, clientY: ORIGIN.y + inView + 4, deltaY: -100, ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(zoomShown(g), 'the wheel zoomed').toBe('108');
      await scrollTo(g, {});
      const topAfter = cursorLineTop(g);
      expect(Math.abs(topAfter - g.el.scrollTop - inView), `the block line stays ${inView}px into the viewport`).toBeLessThanOrEqual(1);
      expect(Math.abs(topAfter - top), 'the column moved to another block, so an unchanged scrollTop would fail').toBeGreaterThan(100);
      expect(cursorColumn(g)).toBe(170);
    });
  });
});

// ─── AC5 ───

describe('US-01M7CMZ5 AC5: a wheel zoom changes the zoom and the scroll, and nothing else', () => {
  it('US-01M7CMZ5 AC5 the cursor column, the selected row and the alignment are unchanged by wheel zooms', async () => {
    await withGrid(ALN, async (g) => {
      await clickTrack(g, 2500, 2);
      await scrollTo(g, { left: 1900 });
      const before = { footer: footer(g), pill: g.app.one('.mbc-aln-doc-stat-pill').textContent, col: cursorColumn(g) };
      expect(before.footer).toContain('Selected: Charlie');
      const cells = (row: number) => g.app.all('.mbc-aln-track.kind-seq')[row].textContent;
      const row2 = cells(2);
      const scrolls: number[] = [g.el.scrollLeft];
      for (const [deltaY, x] of [[-100, 300], [-60, 520], [140, 410]] as const) {
        await wheel(g, { clientX: ORIGIN.x + x, clientY: ORIGIN.y + 150, deltaY, ctrlKey: true });
        scrolls.push(g.el.scrollLeft);
      }
      expect(zoomShown(g), 'the wheels zoomed').not.toBe('100');
      expect(new Set(scrolls).size, 'each wheel zoom moved the scroll').toBe(scrolls.length);
      expect(footer(g), 'the cursor column and selected row are unchanged').toBe(before.footer);
      expect(cursorColumn(g)).toBe(before.col);
      expect(g.app.one('.mbc-aln-doc-stat-pill').textContent).toBe(before.pill);
      await scrollTo(g, { left: 1900 });
      await setZoomField(g, '100');
      await scrollTo(g, { left: 1900 });
      expect(cells(2), 'the alignment reads as it did').toBe(row2);
    });
  });
});

// ─── BG-01M7MEXT ───

/** Column `idx`'s left edge in the track at 400% with spacing every 10: colW 41.6, a 24.96 px gap. */
const X400 = (idx: number) => idx * 41.6 + Math.floor(idx / 10) * 24.96;
const isLit = (b: LiveElement) => b.className.split(/\s+/).includes('active');

describe('BG-01M7MEXT: the zoom-out edge, the pinch bound and the 100% button', () => {
  it('BG alignment zoom pins the zoom-out edge: at 400% one and four notches out keep the hovered column, its right edge min(0.25, colW/4) px right of the pointer', async () => {
    await withGrid(ALN, async (g) => {
      // One notch out narrows 41.6 px to 38.5 px, four to 30.6 px: a pointer 40.35 px into the column is past both.
      const cases: [string, number[], number][] = [['one notch', [100], 41.6 / 1.08], ['four notches in one wheel', [400], 41.6 / Math.pow(1.08, 4)], ['four notches one by one', [100, 100, 100, 100], 41.6 / Math.pow(1.08, 4)]];
      for (const [name, deltas, colW] of cases) {
        await setZoomField(g, '400');
        expect(zoomShown(g), `${name}: starts at 400%`).toBe('400');
        await clickTrack(g, X400(205) + 5);
        const col = cursorColumn(g);
        const before = cursorBox(g);
        expect(before.width, `${name}: a column is 41.6 px at 400%`).toBeCloseTo(41.6, 6);
        const screenLeft = 200;
        await scrollTo(g, { left: before.left - screenLeft });
        const w = nameW(g);
        const pointer = screenLeft + 0.97 * before.width;
        for (const deltaY of deltas) {
          const ev = await wheel(g, { clientX: ORIGIN.x + w + pointer, clientY: ORIGIN.y + 200, deltaY, ctrlKey: true });
          expect(ev.defaultPrevented, `${name}: the wheel zoom is prevented`).toBe(true);
        }
        const after = cursorBox(g);
        expect(after.width, `${name}: the zoom narrowed the column past the pointer`).toBeCloseTo(colW, 6);
        expect(pointer - screenLeft, `${name}: the pointer is past the narrowed column's width`).toBeGreaterThan(after.width);
        const leftAfter = after.left - g.el.scrollLeft;
        const rightAfter = leftAfter + after.width;
        expect(cursorColumn(g), `${name}: the cursor stays on its column`).toBe(col);
        expect(pointer, `${name}: the same column is under the pointer`).toBeGreaterThanOrEqual(leftAfter);
        expect(pointer, `${name}: the same column is under the pointer`).toBeLessThan(rightAfter);
        const want = Math.min(0.25, after.width / 4);
        expect(Math.abs(rightAfter - pointer - want), `${name}: its right edge is ${want} px right of the pointer (is ${rightAfter - pointer})`).toBeLessThanOrEqual(0.01);
      }
    });
  });

  it('BG alignment zoom pins the pinch bound: from a gesturestart at 100%, a scale of 10 reads 400 and one of 0.001 reads 0.5', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      expect(zoomShown(g)).toBe('100');
      await gesture(g, 'gesturestart', { ...at, scale: 1 });
      await gesture(g, 'gesturechange', { ...at, scale: 10 });
      expect(zoomShown(g), 'a pinch to 1000% stops at 400').toBe('400');
      expect(cursorBox(g).width, 'the grid draws 400%').toBeCloseTo(41.6, 6);
      await gesture(g, 'gesturechange', { ...at, scale: 0.001 });
      expect(zoomShown(g), 'a pinch to 0.1% stops at 0.5').toBe('0.5');
      await gesture(g, 'gestureend', { ...at, scale: 0.001 });
    });
  });

  it('BG alignment zoom pins the 100% button: lit exactly when the % field reads 100, after a wheel in and out, and the wheel zoom stays unrounded', async () => {
    await withGrid(ALN, async (g) => {
      const at = { clientX: ORIGIN.x + 400, clientY: ORIGIN.y + 200 };
      const hundred = () => button(g, '100%');
      const expectLitIffHundred = (why: string) => expect(isLit(hundred()), `${why}: the field reads ${zoomShown(g)}`).toBe(zoomShown(g) === '100');
      expect(zoomShown(g)).toBe('100');
      expect(isLit(hundred()), 'lit at 100%').toBe(true);
      await wheel(g, { ...at, deltaY: -100, ctrlKey: true });
      expect(zoomShown(g)).toBe('108');
      expect(isLit(hundred()), 'unlit at 108%').toBe(false);
      await wheel(g, { ...at, deltaY: 100, ctrlKey: true });
      expect(zoomShown(g), 'one notch in and one out reads 100').toBe('100');
      expect(isLit(hundred()), 'lit after one notch in and one out').toBe(true);
      // The field's own reading decides it: either side of each rounding boundary.
      for (const [typed, shown] of [['99.9', '99.9'], ['100.1', '100.1'], ['99.6', '99.6'], ['99.94', '99.9'], ['100.06', '100.1'], ['99.96', '100'], ['100.04', '100']]) {
        await setZoomField(g, typed);
        expect(zoomShown(g), `${typed} reads ${shown}`).toBe(shown);
        expectLitIffHundred(`typed ${typed}`);
      }
      await g.app.click(hundred());
      expectLitIffHundred('after the 100% button');
      // A fractional wheel zoom is stored as the wheel computed it, not as the field shows it.
      await wheel(g, { ...at, deltaY: -37, ctrlKey: true });
      const z = 100 * Math.pow(1.08, 0.37);
      expect(zoomShown(g)).toBe(String(Math.round(z * 10) / 10));
      expect(Math.abs(cursorBox(g).width - (13 * 0.8 * z) / 100), 'the grid draws the unrounded wheel zoom').toBeLessThan(1e-6);
      expectLitIffHundred('after a fractional wheel');
    });
  });
});
