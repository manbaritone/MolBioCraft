// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CM97: the contig overview's annotation map, the alignment dotplot and the imported tree
 * zoom around the pointer under a wheel or a pinch, each on its own axes: the contig map along the
 * bp axis only (its data window, 50 bp up to the whole record), the dotplot and the tree on both
 * axes by one factor (1x to 64x and 1x to 16x). Their exports are unchanged by a zoom, except the
 * contig map's, which follows the shown window as its zoom buttons already make it do, and a tree
 * zoom is view state that never reaches the document.
 *
 * Each view is mounted with React DOM's client renderer over the live DOM (liveDom.ts), which has
 * no layout and no canvas: every test supplies the boxes it needs, and the dotplot's canvas is given
 * a recording 2-D context (as alignmentTabLevels.test.tsx's recordingCanvas is) whose record starts
 * again whenever the canvas is resized, as a real canvas's bitmap does. Wheels and WebKit gesture
 * events are dispatched on the live elements; React 18 attaches its own onWheel passively, so a
 * taken wheel whose defaultPrevented is true proves a native non-passive listener.
 *
 * The wrong implementations these checks fail on: a React onWheel (not prevented); a zoom drawn
 * into the exported canvas or svg (the export changes); a tree zoom kept in the saved display (the
 * display marks dirty, or the saved document carries it); a zoom about the view's centre or corner
 * (the point under the pointer moves); a horizontal wheel that zooms or is prevented.
 */

import { afterEach, expect, it, vi } from 'vitest';
import {
  LiveDocument, LiveElement, LiveResizeObservers, LiveWindow, LiveXMLSerializer, clickElement, dispatchLiveEvent,
  liveDomConstructors, type Box,
} from './liveDom';

// ─── What the views save, recorded ───

const rec = vi.hoisted(() => ({
  /** Every file the dotplot saved (Export PNG), in order. */
  files: [] as { name: string; content: unknown; mime: string }[],
  /** The markup of every figure the Export control saved as SVG, as the real capture writes it. */
  svgs: [] as string[],
}));

vi.mock('../platform/macosMenuBridge', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/macosMenuBridge');
  return {
    ...actual,
    saveWorkbenchFile: (name: string, content: unknown, mime: string) => {
      rec.files.push({ name, content, mime });
    },
  };
});

// The Export control runs the real export path up to the save: the svg it found is captured by the
// real captureSvg, and that markup is what is recorded instead of handing it to a dialog.
vi.mock('../core/figureCapture', async () => {
  const actual = await vi.importActual<typeof import('../core/figureCapture')>('../core/figureCapture');
  return {
    ...actual,
    runFigureExport: (opts: Parameters<typeof actual.runFigureExport>[0]) =>
      actual.runFigureExport({
        ...opts,
        exporter: async (request, format) => {
          if (format !== 'svg' || !request.svg) return { outcome: false, filename: 'figure', error: 'not an svg export' };
          rec.svgs.push(actual.captureSvg(request.svg, { title: request.title }).markup);
          return { outcome: 'downloaded', filename: 'figure.svg' };
        },
      }),
  };
});

afterEach(() => {
  rec.files = [];
  rec.svgs = [];
  vi.unstubAllGlobals();
});

type SequenceDocument = import('../types/bio').SequenceDocument;
type Call = { op: string; args: unknown[] };

// ─── The live page ───

/**
 * Canvases whose 2-D context records every call and every property it is given (as `=name`), whose
 * PNG is that record, and whose record starts again when the canvas's width or height is set.
 */
function recordCanvases(doc: LiveDocument) {
  const canvases: { el: LiveElement; calls: Call[] }[] = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => {
    const el = create(tag);
    if (tag.toLowerCase() !== 'canvas') return el;
    const entry = { el, calls: [] as Call[] };
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (_t, key) =>
        typeof key !== 'string'
          ? undefined
          : key in state
            ? state[key]
            : key === 'measureText'
              ? (s: string) => ({ width: String(s).length * 6 })
              : (...args: unknown[]) => void entry.calls.push({ op: key, args }),
      set: (_t, key, value) => {
        state[String(key)] = value;
        entry.calls.push({ op: `=${String(key)}`, args: [value] });
        return true;
      },
    });
    let width = 300;
    let height = 150;
    Object.defineProperties(el, {
      width: { configurable: true, get: () => width, set: (v: number) => { width = v; entry.calls = []; } },
      height: { configurable: true, get: () => height, set: (v: number) => { height = v; entry.calls = []; } },
      getContext: { configurable: true, value: () => ctx },
      toDataURL: { configurable: true, value: () => `data:image/png,${encodeURIComponent(JSON.stringify(entry.calls))}` },
    });
    canvases.push(entry);
    return el;
  };
  return canvases;
}

/** Mounts `element(React, views)` in a fresh live page laid out by `layout`. */
async function mount(
  layout: (el: LiveElement) => Box,
  element: (React: typeof import('react'), views: Views) => import('react').ReactElement,
) {
  const doc = new LiveDocument();
  doc.layout = (el) => layout(el);
  const canvases = recordCanvases(doc);
  const win = new LiveWindow(doc);
  const observers = new LiveResizeObservers();
  const globals: Record<string, unknown> = {
    window: win, document: doc, requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
    ResizeObserver: observers.Ctor, XMLSerializer: LiveXMLSerializer, getComputedStyle: (el: unknown) => win.getComputedStyle(el),
    IS_REACT_ACT_ENVIRONMENT: true, ...liveDomConstructors,
  };
  for (const [k, v] of Object.entries(globals)) vi.stubGlobal(k, v);
  vi.resetModules();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const views: Views = {
    dotplot: await import('../components/AlignmentDotplot'),
    contig: await import('../components/ContigSummaryView'),
    tree: await import('../components/ImportedTreeViewer'),
  };
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const act = async (fn: () => void | Promise<void>) => { await React.act(async () => { await fn(); }); };
  const settle = async () => {
    for (let round = 0; round < 40; round++) {
      await act(() => new Promise<void>((r) => setTimeout(r, 0)));
      const frames = win.animationFrames.take();
      const observed = observers.due();
      if (!frames.length && !observed.length) return;
      await act(() => {
        for (const f of frames) f(performance.now());
        for (const o of observed) o();
      });
    }
    throw new Error('the view never settled');
  };
  await act(() => { root.render(element(React, views)); });
  await settle();
  const one = (selector: string) => {
    const found = container.querySelectorAll(selector);
    expect(found, `one ${selector}`).toHaveLength(1);
    return found[0];
  };
  /** Dispatches one event on `el` and lets the view settle (its animation frame included). */
  const fire = async (el: LiveElement, type: string, init: Record<string, unknown>) => {
    let ev: ReturnType<typeof dispatchLiveEvent> | null = null;
    await act(() => { ev = dispatchLiveEvent(el, type, init); });
    await settle();
    return ev as unknown as ReturnType<typeof dispatchLiveEvent>;
  };
  const click = async (el: LiveElement) => {
    await act(() => { clickElement(el); });
    await settle();
  };
  const button = (text: string, scope: LiveElement = container) => {
    const found = scope.querySelectorAll('button').filter((b) => b.textContent.trim() === text);
    expect(found, `one "${text}" button`).toHaveLength(1);
    return found[0];
  };
  /** Exports the figure `host` holds through its Export control, as SVG; returns the saved markup. */
  const exportSvg = async (host: LiveElement) => {
    const before = rec.svgs.length;
    const triggers = host.querySelectorAll('button.mbc-figure-export-trigger');
    expect(triggers, 'the figure has one Export control').toHaveLength(1);
    await click(triggers[0]);
    const svgItem = host.querySelectorAll('[role="menuitem"]').filter((m) => m.textContent.trim().startsWith('SVG'));
    expect(svgItem, 'Export offers SVG').toHaveLength(1);
    await click(svgItem[0]);
    expect(rec.svgs.length, 'one SVG saved').toBe(before + 1);
    return rec.svgs[rec.svgs.length - 1];
  };
  const unmount = async () => { await act(() => { root.unmount(); }); };
  return { doc, container, canvases, act, settle, one, fire, click, button, exportSvg, unmount, React, views };
}

interface Views {
  dotplot: typeof import('../components/AlignmentDotplot');
  contig: typeof import('../components/ContigSummaryView');
  tree: typeof import('../components/ImportedTreeViewer');
}

const wheel = (deltaY: number, clientX: number, clientY: number, mods: Record<string, boolean> = {}, deltaX = 0) => ({
  deltaX, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, ...mods, clientX, clientY,
});
const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// ─── The contig overview ───

const CONTIG_TOTAL = 100_000;
const MARGIN = 24;
const MAP_W = 1000;
const contigDoc: SequenceDocument = {
  id: 'contig-zoom', name: 'chrZ', accession: 'NC_000000', description: '', moleculeType: 'DNA', topology: 'linear', sequence: '',
  features: [
    { id: 'g1', name: 'geneA', type: 'gene', start: 20_000, end: 31_000, strand: 1, color: '#2f7de1' },
    { id: 'g2', name: 'geneB', type: 'gene', start: 60_000, end: 64_000, strand: -1, color: '#d14343' },
  ] as SequenceDocument['features'],
  primers: [], history: [], createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  folder: 'Genomes' as SequenceDocument['folder'],
  docMetadata: { 'Declared Length': CONTIG_TOTAL, 'Is Contig Summary': 'Yes' },
};
const contigLayout = (el: LiveElement): Box => (el.classList.contains('mbc-summary-svg') ? { width: MAP_W, height: 200 } : { width: 0, height: 0 });

/** The window the map reads: its range readout and its svg's label, which must agree. */
function contigWindow(ui: Awaited<ReturnType<typeof mount>>) {
  const range = words(ui.one('.mbc-summary-range').textContent);
  const m = /^([\d,]+)–([\d,]+) bp/.exec(range);
  expect(m, `the range readout "${range}"`).not.toBeNull();
  const start = Number(m![1].replace(/,/g, ''));
  const end = Number(m![2].replace(/,/g, ''));
  expect(ui.one('svg.mbc-summary-svg').getAttribute('aria-label'), 'the svg label reads the same window').toBe(`chrZ annotation map ${start}–${end}`);
  return { start, end, span: end - start + 1 };
}
/** The base drawn under a client x in a window: the map draws base b from x(b) to x(b + 1). */
const baseAt = (w: { start: number; span: number }, clientX: number) =>
  Math.floor(w.start + ((clientX - MARGIN) / (MAP_W - 2 * MARGIN)) * w.span);

it('US-01M7CM97 AC1: the contig annotation map zooms its window along the bp axis about the pointer, 50 bp to the whole record, and its export follows the window', async () => {
  const ui = await mount(contigLayout, (React, v) => React.createElement(v.contig.ContigSummaryView, { doc: contigDoc }));
  try {
    const svg = ui.one('svg.mbc-summary-svg');
    const laneHeights = () => svg.querySelectorAll('g.mbc-summary-feature rect').map((r) => r.getAttribute('height'));
    const viewBoxWidth = () => svg.getAttribute('viewBox')!.split(' ')[2];
    expect(contigWindow(ui)).toEqual({ start: 1, end: CONTIG_TOTAL, span: CONTIG_TOTAL });

    // A plain wheel and a Ctrl/Cmd wheel each zoom in, keeping the base under the pointer within 1 bp.
    const x = 300;
    for (const mods of [{}, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true }] as Record<string, boolean>[]) {
      const before = contigWindow(ui);
      const ev = await ui.fire(svg, 'wheel', wheel(-100, x, 80, mods));
      expect(ev.defaultPrevented, `a ${JSON.stringify(mods)} wheel is taken`).toBe(true);
      const after = contigWindow(ui);
      expect(after.span, `${JSON.stringify(mods)} zooms in`).toBeLessThan(before.span);
      expect(Math.abs(baseAt(after, x) - baseAt(before, x)), 'the base under the pointer stays').toBeLessThanOrEqual(1);
    }
    // Along the bp axis only: the drawing keeps its width in map units and its lanes their height.
    expect(viewBoxWidth()).toBe(String(MAP_W));
    expect(new Set(laneHeights())).toEqual(new Set(['16']));

    // Held to 50 bp, still about the pointer.
    const deep = contigWindow(ui);
    for (let i = 0; i < 40; i++) await ui.fire(svg, 'wheel', wheel(-400, x, 80, { ctrlKey: true }));
    const narrow = contigWindow(ui);
    expect(narrow.span, 'held at 50 bp').toBe(50);
    expect(Math.abs(baseAt(narrow, x) - baseAt(deep, x))).toBeLessThanOrEqual(1);

    // The export follows the shown window.
    const exported = await ui.exportSvg(ui.one('.mbc-summary-linear'));
    expect(exported).toContain(`aria-label="chrZ annotation map ${narrow.start}–${narrow.end}"`);

    // 'Whole record' resets it.
    await ui.click(ui.button('Whole record'));
    expect(contigWindow(ui)).toEqual({ start: 1, end: CONTIG_TOTAL, span: CONTIG_TOTAL });

    // Held at the record's end: zoom in at the right edge, then out with the pointer at the left.
    const right = MAP_W - MARGIN;
    for (let i = 0; i < 3; i++) await ui.fire(svg, 'wheel', wheel(-400, right, 80));
    const atEnd = contigWindow(ui);
    expect(atEnd.end, 'zoomed in at the end, the window ends at the record end').toBe(CONTIG_TOTAL);
    expect(atEnd.span).toBeLessThan(CONTIG_TOTAL / 2);
    await ui.fire(svg, 'wheel', wheel(400, MARGIN, 80));
    const heldEnd = contigWindow(ui);
    expect(heldEnd.span, 'zoomed out').toBeGreaterThan(atEnd.span);
    expect(heldEnd.end, 'held at the record end rather than past it').toBe(CONTIG_TOTAL);

    // Held at base 1: zoom in at the left edge, then out with the pointer at the right.
    await ui.click(ui.button('Whole record'));
    for (let i = 0; i < 3; i++) await ui.fire(svg, 'wheel', wheel(-400, MARGIN, 80));
    const atStart = contigWindow(ui);
    expect(atStart.start).toBe(1);
    expect(atStart.span).toBeLessThan(CONTIG_TOTAL / 2);
    await ui.fire(svg, 'wheel', wheel(400, right, 80));
    const heldStart = contigWindow(ui);
    expect(heldStart.span).toBeGreaterThan(atStart.span);
    expect(heldStart.start, 'held at base 1').toBe(1);

    // Up to the whole record and no further.
    for (let i = 0; i < 20; i++) await ui.fire(svg, 'wheel', wheel(400, 500, 80));
    expect(contigWindow(ui)).toEqual({ start: 1, end: CONTIG_TOTAL, span: CONTIG_TOTAL });
    expect(ui.button('Whole record').hasAttribute('disabled'), 'nothing to reset at the whole record').toBe(true);
  } finally {
    await ui.unmount();
  }
}, 60_000);

// ─── The dotplot ───

/** A deterministic DNA string of `n` bases. */
function dna(n: number, seed: number): string {
  let s = '';
  let v = seed;
  for (let i = 0; i < n; i++) {
    v = (v * 1103515245 + 12345) % 2147483648;
    s += 'ACGT'[v % 4];
  }
  return s;
}
const X_SEQ = dna(400, 7);
// Y shares a stretch of X, so the plot has a diagonal to draw.
const Y_SEQ = dna(120, 11) + X_SEQ.slice(100, 260) + dna(20, 13);
const dotplotProps = {
  isProtein: false,
  sequences: [
    { id: 'x', name: 'Seq X', alignedSeq: X_SEQ, features: [] },
    { id: 'y', name: 'Seq Y', alignedSeq: Y_SEQ, features: [] },
  ],
};
// 520 px plot over 400 bases: 1.3 px a base at 1x; the canvas is 600 x 462 CSS px.
const DOT_SCALE = 520 / 400;
const dotLayout = (el: LiveElement): Box => (el.localName === 'canvas' ? { width: 600, height: 462 } : { width: 0, height: 0 });

/** The axes the live drawing places its tick labels on: px = origin + base × k, on each axis. */
function drawnAxes(calls: Call[]) {
  let align = '';
  const xs: [number, number][] = [];
  const ys: [number, number][] = [];
  for (const c of calls) {
    if (c.op === '=textAlign') align = String(c.args[0]);
    if (c.op === 'fillText' && /^\d+$/.test(String(c.args[0]))) {
      if (align === 'center') xs.push([Number(c.args[0]), Number(c.args[1])]);
      if (align === 'right') ys.push([Number(c.args[0]), Number(c.args[2])]);
    }
  }
  const fit = (pts: [number, number][], axis: string) => {
    expect(pts.length, `two or more ${axis} ticks are drawn`).toBeGreaterThanOrEqual(2);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const k = (b[1] - a[1]) / (b[0] - a[0]);
    return { k, origin: a[1] - a[0] * k };
  };
  return { x: fit(xs, 'x'), y: fit(ys, 'y') };
}
/** The match runs the drawing strokes: each moveTo-lineTo pair that is neither level nor upright. */
function drawnRuns(calls: Call[]) {
  const runs: { dx: number; dy: number }[] = [];
  let from: number[] | null = null;
  for (const c of calls) {
    if (c.op === 'moveTo') from = c.args as number[];
    if (c.op !== 'lineTo' || !from) continue;
    const [x1, y1] = c.args as number[];
    if (x1 !== from[0] && y1 !== from[1]) runs.push({ dx: x1 - from[0], dy: y1 - from[1] });
  }
  return runs;
}
const exportedCalls = (file:{ content: unknown }) => JSON.parse(new TextDecoder().decode(file.content as Uint8Array)) as Call[];

it('US-01M7CM97 AC2: the dotplot zooms both axes by one factor about the pointer, 1x to 64x, resets, names its ranges, and exports the full plot at any zoom', async () => {
  const ui = await mount(dotLayout, (React, v) => React.createElement(v.dotplot.AlignmentDotplot, dotplotProps));
  try {
    const canvas = ui.one('canvas');
    const live = () => {
      const found = ui.canvases.filter((c) => c.el === canvas);
      expect(found, 'the plot canvas records its drawing').toHaveLength(1);
      return found[0].calls;
    };
    const readout = () => words(ui.one('.mbc-dotplot-zoom').textContent);
    const exportPng = async () => {
      const before = rec.files.length;
      await ui.click(ui.button('Export PNG'));
      expect(rec.files.length, 'one PNG saved').toBe(before + 1);
      return exportedCalls(rec.files[rec.files.length - 1]);
    };
    const reset = () => ui.button('Reset zoom');

    // 1x: the whole plot, named in the readout; the canvas label is the plot's own.
    const first = JSON.stringify(live());
    expect(first.length, 'the plot is drawn').toBeGreaterThan(100);
    expect(readout()).toBe('1× · X 1–400 of 400 bp · Y 1–300 of 300 bp');
    expect(canvas.getAttribute('aria-label')).toBe('Dotplot of Seq X vs Seq Y');
    expect(reset().hasAttribute('disabled'), 'nothing to reset at 1x').toBe(true);
    const axes1 = drawnAxes(live());
    expect(near(axes1.x.k, DOT_SCALE) && near(axes1.y.k, DOT_SCALE), 'one scale on both axes at 1x').toBe(true);
    const png1 = await exportPng();
    expect(JSON.stringify(png1)).toBe(first);

    // A 4x pinch about the pointer: both axes by one factor, the point under the pointer kept.
    const px = 200;
    const py = 150;
    const at = (a: ReturnType<typeof drawnAxes>) => [(px - a.x.origin) / a.x.k, (py - a.y.origin) / a.y.k];
    const before = at(axes1);
    await ui.fire(canvas, 'gesturestart', { scale: 1, clientX: px, clientY: py });
    await ui.fire(canvas, 'gesturechange', { scale: 4, clientX: px, clientY: py });
    await ui.fire(canvas, 'gestureend', { scale: 4, clientX: px, clientY: py });
    const axes4 = drawnAxes(live());
    expect(near(axes4.x.k, 4 * DOT_SCALE, 1e-6), 'x at 4x').toBe(true);
    expect(near(axes4.y.k, axes4.x.k, 1e-9), 'y by the same factor: the aspect ratio kept').toBe(true);
    const after = at(axes4);
    expect(near(after[0], before[0], 1e-6) && near(after[1], before[1], 1e-6), `the point under the pointer stays (${before} -> ${after})`).toBe(true);
    expect(JSON.stringify(live()), 'the shown drawing changed').not.toBe(first);
    // The matches are drawn at the axes' one scale: every window (11 positions) runs 11 × k on both axes.
    const runs = drawnRuns(live());
    expect(runs.length, 'matches are drawn in the shown window').toBeGreaterThan(0);
    for (const r of runs) {
      expect(near(Math.abs(r.dx), 11 * axes4.x.k, 1e-6) && near(Math.abs(r.dy), 11 * axes4.y.k, 1e-6), `a match run ${JSON.stringify(r)} at 4x`).toBe(true);
    }

    // The readout and the canvas label name the shown ranges.
    const ranges = /^4× · X (\d+)–(\d+) of 400 bp · Y (\d+)–(\d+) of 300 bp$/.exec(readout());
    expect(ranges, `the readout "${readout()}"`).not.toBeNull();
    const [x0, x1, y0, y1] = ranges!.slice(1).map(Number);
    expect(x1 - x0 + 1, 'a quarter of X shown').toBeLessThanOrEqual(101);
    expect(x0).toBeLessThanOrEqual(Math.floor(before[0]) + 1);
    expect(x1).toBeGreaterThanOrEqual(Math.ceil(before[0]));
    expect(y0).toBeLessThanOrEqual(Math.floor(before[1]) + 1);
    expect(y1).toBeGreaterThanOrEqual(Math.ceil(before[1]));
    expect(canvas.getAttribute('aria-label')).toBe(`Dotplot of Seq X vs Seq Y, X ${x0}–${x1} of 400 bp, Y ${y0}–${y1} of 300 bp`);

    // Export PNG writes the full plot, the same drawing as at 1x, and the shown zoom is kept.
    const png4 = await exportPng();
    expect(JSON.stringify(png4), 'the export at 4x is the 1x drawing').toBe(JSON.stringify(png1));
    expect(near(drawnAxes(live()).x.k, 4 * DOT_SCALE), 'still shown at 4x after the export').toBe(true);

    // Held at 64x, then at 1x, about the pointer.
    for (let i = 0; i < 20; i++) await ui.fire(canvas, 'wheel', wheel(-400, px, py, { ctrlKey: true }));
    const axes64 = drawnAxes(live());
    expect(near(axes64.x.k, 64 * DOT_SCALE, 1e-6) && near(axes64.y.k, 64 * DOT_SCALE, 1e-6), 'held at 64x').toBe(true);
    expect(readout().startsWith('64× · ')).toBe(true);
    const a64 = at(axes64);
    expect(near(a64[0], before[0], 1e-6) && near(a64[1], before[1], 1e-6), 'still about the pointer').toBe(true);
    for (let i = 0; i < 20; i++) await ui.fire(canvas, 'wheel', wheel(400, px, py));
    expect(JSON.stringify(live()), 'held at 1x: the whole plot').toBe(first);
    expect(readout()).toBe('1× · X 1–400 of 400 bp · Y 1–300 of 300 bp');

    // Reset returns a zoomed plot to the whole.
    await ui.fire(canvas, 'wheel', wheel(-300, 420, 300));
    expect(JSON.stringify(live())).not.toBe(first);
    expect(reset().hasAttribute('disabled')).toBe(false);
    await ui.click(reset());
    expect(JSON.stringify(live()), 'reset to the whole plot').toBe(first);
    expect(readout()).toBe('1× · X 1–400 of 400 bp · Y 1–300 of 300 bp');
    expect(canvas.getAttribute('aria-label')).toBe('Dotplot of Seq X vs Seq Y');
  } finally {
    await ui.unmount();
  }
}, 60_000);

// ─── The imported tree ───

const NEWICK = '((Alpha:0.1,Beta:0.2)90:0.05,(Gamma:0.3,(Delta:0.1,Epsilon:0.15)75:0.1):0.2);';
const treeDoc = (style: string): SequenceDocument => ({
  id: `tree-${style}`, name: 'Zoom tree', accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence: '',
  features: [], primers: [], history: [], createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  folder: 'Trees' as SequenceDocument['folder'],
  docMetadata: { Newick: NEWICK, 'Source Format': 'Newick', 'Tree display': JSON.stringify({ style }) },
});
const FRAME = { width: 900, height: 640 };
const treeLayout = (el: LiveElement): Box => {
  if (el.classList.contains('mbc-imported-tree-canvas')) return { width: 924, height: 664 };
  if (el.classList.contains('mbc-imported-tree-zoom-frame')) return FRAME;
  if (el.localName === 'svg' && el.getAttribute('role') === 'img') return FRAME;
  return { width: 0, height: 0 };
};
/** The tree's zoom as it is shown: the transform on the zoomed content (none at 1x). */
function treeZoom(ui: Awaited<ReturnType<typeof mount>>) {
  const content = ui.one('.mbc-imported-tree-zoom');
  expect(content.querySelectorAll('svg[role="img"]'), 'the tree is drawn inside the zoomed content').toHaveLength(1);
  const t = String((content.style as unknown as Record<string, unknown>).transform ?? '');
  if (!t) return { k: 1, x: 0, y: 0 };
  const m = /^translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)$/.exec(t);
  expect(m, `the transform "${t}"`).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), k: Number(m![3]) };
}
const DISPLAY_KEYS = ['colors', 'compressed', 'fontSize', 'showAges', 'showLengths', 'showSupport', 'style', 'supportCutoff'];

it('US-01M7CM97 AC3: the imported tree zooms both axes by one factor about the pointer, 1x to 16x, in every layout, with its export unchanged and nothing saved', async () => {
  for (const style of ['rectangular', 'cladogram', 'circular', 'radial']) {
    const updates: SequenceDocument[] = [];
    const ui = await mount(treeLayout, (React, v) =>
      React.createElement(v.tree.ImportedTreeViewer, { doc: treeDoc(style), onUpdateDocument: (d: SequenceDocument) => updates.push(d) }));
    try {
      const frame = ui.one('.mbc-imported-tree-zoom-frame');
      const svg = ui.one('svg[role="img"]');
      const host = ui.one('.mbc-tree-toolbar[aria-label="Tree edits"]').parentElement!;
      expect(treeZoom(ui), `${style}: 1x`).toEqual({ k: 1, x: 0, y: 0 });
      const svgBefore = await ui.exportSvg(host);
      expect(svgBefore, `${style}: the export holds the tree`).toContain('Epsilon');

      // Zoom in about the pointer: the content point under it stays, on both axes by one factor.
      const p = { x: 310, y: 220 };
      const at = (z: ReturnType<typeof treeZoom>) => ({ x: (p.x - z.x) / z.k, y: (p.y - z.y) / z.k });
      const before = at(treeZoom(ui));
      await ui.fire(svg, 'wheel', wheel(-300, p.x, p.y));
      const z1 = treeZoom(ui);
      expect(z1.k, `${style}: zoomed in`).toBeGreaterThan(1.2);
      expect(near(at(z1).x, before.x) && near(at(z1).y, before.y), `${style}: about the pointer`).toBe(true);
      await ui.fire(svg, 'gesturestart', { scale: 1, clientX: 600, clientY: 400 });
      await ui.fire(svg, 'gesturechange', { scale: 2, clientX: 600, clientY: 400 });
      await ui.fire(svg, 'gestureend', { scale: 2, clientX: 600, clientY: 400 });
      const z2 = treeZoom(ui);
      expect(near(z2.k, 2 * z1.k), `${style}: a pinch doubles it`).toBe(true);
      const kept = { x: (600 - z1.x) / z1.k, y: (400 - z1.y) / z1.k };
      expect(near((600 - z2.x) / z2.k, kept.x) && near((400 - z2.y) / z2.k, kept.y), `${style}: the pinch is about its point`).toBe(true);

      // The export, the display and the document are untouched by the zoom.
      expect(await ui.exportSvg(host), `${style}: Export SVG text unchanged by a zoom`).toBe(svgBefore);
      expect(ui.button('Revert').hasAttribute('disabled'), `${style}: the display is not dirty`).toBe(true);
      expect(ui.button('Save changes').hasAttribute('disabled'), `${style}: nothing to save`).toBe(true);
      expect(updates, `${style}: onUpdateDocument not called`).toHaveLength(0);

      // Held at 16x and at 1x.
      for (let i = 0; i < 20; i++) await ui.fire(svg, 'wheel', wheel(-400, p.x, p.y, { ctrlKey: true }));
      expect(treeZoom(ui).k, `${style}: held at 16x`).toBe(16);
      for (let i = 0; i < 20; i++) await ui.fire(svg, 'wheel', wheel(400, p.x, p.y));
      expect(treeZoom(ui), `${style}: held at 1x, unpanned`).toEqual({ k: 1, x: 0, y: 0 });
      expect(frame.getBoundingClientRect().width).toBe(FRAME.width);

      // An edit saved after a zoom saves the display without the zoom in it.
      await ui.fire(svg, 'wheel', wheel(-300, p.x, p.y));
      await ui.click(ui.button('Ladderize ↑'));
      await ui.click(ui.button('Save changes'));
      expect(updates, `${style}: one save, from the edit`).toHaveLength(1);
      const saved = JSON.parse(String(updates[0].docMetadata?.['Tree display'])) as Record<string, unknown>;
      expect(Object.keys(saved).sort(), `${style}: the saved display holds no zoom`).toEqual(DISPLAY_KEYS);
      expect(saved.style).toBe(style);
    } finally {
      await ui.unmount();
    }
  }
}, 120_000);

// ─── Every surface: which wheels and pinches zoom ───

it('US-01M7CM97 AC4: plain, Alt and Ctrl/Cmd vertical wheels, a ctrl-flagged pinch and a WebKit pinch zoom all three through a native non-passive listener; a horizontal wheel zooms none and is not prevented', async () => {
  const surfaces = [
    {
      name: 'contig map',
      layout: contigLayout,
      element: (React: typeof import('react'), v: Views) => React.createElement(v.contig.ContigSummaryView, { doc: contigDoc }),
      target: 'svg.mbc-summary-svg',
      state: (ui: Awaited<ReturnType<typeof mount>>) => JSON.stringify(contigWindow(ui)),
      point: { x: 400, y: 80 },
    },
    {
      name: 'dotplot',
      layout: dotLayout,
      element: (React: typeof import('react'), v: Views) => React.createElement(v.dotplot.AlignmentDotplot, dotplotProps),
      target: 'canvas',
      state: (ui: Awaited<ReturnType<typeof mount>>) => {
        const canvas = ui.one('canvas');
        return JSON.stringify(ui.canvases.find((c) => c.el === canvas)!.calls) + words(ui.one('.mbc-dotplot-zoom').textContent);
      },
      point: { x: 250, y: 200 },
    },
    {
      name: 'imported tree',
      layout: treeLayout,
      element: (React: typeof import('react'), v: Views) => React.createElement(v.tree.ImportedTreeViewer, { doc: treeDoc('rectangular') }),
      target: 'svg[role="img"]',
      state: (ui: Awaited<ReturnType<typeof mount>>) => JSON.stringify(treeZoom(ui)),
      point: { x: 300, y: 200 },
    },
  ];
  for (const s of surfaces) {
    const ui = await mount(s.layout, s.element);
    try {
      const el = ui.one(s.target);
      const { x, y } = s.point;
      const zooms: [string, Record<string, unknown>][] = [
        ['a plain wheel', wheel(-100, x, y)],
        ['an Alt wheel', wheel(-100, x, y, { altKey: true })],
        ['a Ctrl wheel', wheel(-100, x, y, { ctrlKey: true })],
        ['a Cmd wheel', wheel(-100, x, y, { metaKey: true })],
        ['a ctrl-flagged pinch wheel', wheel(-4, x, y, { ctrlKey: true })],
        ['a plain wheel out', wheel(120, x, y)],
      ];
      for (const [what, init] of zooms) {
        const before = s.state(ui);
        const ev = await ui.fire(el, 'wheel', init);
        expect(ev.defaultPrevented, `${s.name}: ${what} is prevented`).toBe(true);
        expect(s.state(ui), `${s.name}: ${what} zooms`).not.toBe(before);
      }
      const beforePinch = s.state(ui);
      const start = await ui.fire(el, 'gesturestart', { scale: 1, clientX: x, clientY: y });
      const change = await ui.fire(el, 'gesturechange', { scale: 1.5, clientX: x, clientY: y });
      await ui.fire(el, 'gestureend', { scale: 1.5, clientX: x, clientY: y });
      expect([start.defaultPrevented, change.defaultPrevented], `${s.name}: the WebKit pinch is prevented`).toEqual([true, true]);
      expect(s.state(ui), `${s.name}: the WebKit pinch zooms`).not.toBe(beforePinch);

      const horizontals: [string, Record<string, unknown>][] = [
        ['a horizontal wheel', wheel(0, x, y, {}, -100)],
        ['a mostly horizontal Ctrl wheel', wheel(30, x, y, { ctrlKey: true }, 120)],
        ['a horizontal Alt wheel', wheel(0, x, y, { altKey: true }, 80)],
      ];
      for (const [what, init] of horizontals) {
        const before = s.state(ui);
        const ev = await ui.fire(el, 'wheel', init);
        expect(ev.defaultPrevented, `${s.name}: ${what} is not prevented`).toBe(false);
        expect(s.state(ui), `${s.name}: ${what} does not zoom`).toBe(before);
      }
    } finally {
      await ui.unmount();
    }
  }

  // The steps the views' listeners call are pure, exported, and classify as a canvas does.
  const { classifyWheelGesture } = await import('../core/wheelZoom');
  const { dotplotWheelStep } = await import('../components/AlignmentDotplot');
  const { contigMapWheelStep } = await import('../components/ContigSummaryView');
  const { treeWheelStep } = await import('../components/ImportedTreeViewer');
  const rect = { left: 0, top: 0, width: 600, height: 462 };
  const steps: [string, (e: ReturnType<typeof wheel>) => { handled: boolean; view: unknown }, unknown][] = [
    ['dotplotWheelStep', (e) => dotplotWheelStep(e, { zoom: 1, offset: { x: 0, y: 0 } }, { rect, x: 64, y: 48, width: 520, height: 390 }), { zoom: 1, offset: { x: 0, y: 0 } }],
    ['contigMapWheelStep', (e) => contigMapWheelStep(e, { start: 1, end: CONTIG_TOTAL }, { total: CONTIG_TOTAL, rect: { left: 0, top: 0, width: MAP_W, height: 200 } }), { start: 1, end: CONTIG_TOTAL }],
    ['treeWheelStep', (e) => treeWheelStep(e, { zoom: 1, offset: { x: 0, y: 0 } }, { left: 0, top: 0, ...FRAME }), { zoom: 1, offset: { x: 0, y: 0 } }],
  ];
  const cases = [wheel(-100, 300, 200), wheel(-100, 300, 200, { altKey: true }), wheel(0, 300, 200, {}, -100), wheel(10, 300, 200, { ctrlKey: true }, 50), wheel(0, 300, 200)];
  for (const [name, step, unchanged] of steps) {
    for (const e of cases) {
      const r = step(e);
      expect(r.handled, `${name} takes exactly what a canvas zooms (${JSON.stringify(e)})`).toBe(classifyWheelGesture(e, 'canvas') === 'zoom');
      if (!r.handled) expect(r.view, `${name} leaves the view of a gesture it does not take`).toEqual(unchanged);
      else expect(r.view, `${name} zooms in`).not.toEqual(unchanged);
    }
  }
}, 120_000);
