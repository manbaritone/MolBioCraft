// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCG9: the linear overview zooms around the pointer under a wheel or pinch, from the whole
 * molecule (1x) to a bound where one base is 12 SVG units wide, with -, %, + and Fit controls that
 * read and move the same zoom. A plain wheel over the base rows still scrolls them. Zoom never
 * changes the selection, and the brush, its handles and the feature pills map to the bases drawn
 * under the pointer at every scale. The linear map's Export draws the whole schematic.
 *
 * The zoom is pure (overviewWheelStep, overviewZoomTo, clampOverviewView, bindOverviewWheel over a
 * stand-in element). The view is rendered with renderToStaticMarkup and driven through the
 * elements its render creates (the element probe of cleavagePreview.test.tsx); a state update a
 * handler makes during a render re-renders the view, and each later pass is handed to the test.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));
const files = vi.hoisted(() => ({ drawings: [] as { svg: unknown; draw: (() => string) | null }[] }));

type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});
// The figure-file registration is recorded, so the drawing an Export would save can be read.
vi.mock('../core/figureCapture', async () => {
  const actual = await vi.importActual<typeof import('../core/figureCapture')>('../core/figureCapture');
  return {
    ...actual,
    setFigureFileDrawing: (svg: unknown, draw: (() => string) | null) => {
      files.drawings.push({ svg, draw });
      actual.setFigureFileDrawing(svg as Element, draw);
    },
  };
});

const {
  LinearSequenceView,
  OVERVIEW_FIT,
  OVERVIEW_BASE_UNITS_AT_MAX,
  overviewMaxScale,
  clampOverviewView,
  overviewZoomTo,
  overviewWheelStep,
  overviewX,
  overviewVisibleBases,
  overviewBrushLayout,
  overviewRulerTicks,
  bindOverviewWheel,
  schematicBaseAt,
  BRUSH_HANDLE_HIT_PX,
} = await import('../components/LinearSequenceView');
const { classifyWheelGesture, WHEEL_ZOOM_IN_PER_NOTCH } = await import('../core/wheelZoom');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SequenceDocument = import('../types/bio').SequenceDocument;
type OverviewView = import('../components/LinearSequenceView').OverviewView;

afterEach(() => {
  probe.onElement = null;
  files.drawings = [];
  vi.unstubAllGlobals();
});

const X0 = 38;
const W = 724;
const N = 6061;

const docOf = (sequence: string, extra: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id: 'doc-zoom', name: 'zoom', accession: '', description: '', moleculeType: 'DNA', topology: 'circular', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'],
  ...extra,
});
const SEQ = 'ACGTTGCAAT'.repeat(606) + 'A'; // 6,061 bp, as pET-28a(+)-eGFP
const COLORS = { kan: '#ea4335', t7: '#7b61ff', egfp: '#34a853', his: '#fbbc04' };
const zoomDoc = docOf(SEQ, {
  features: [
    { id: 'kan', name: 'KanR', type: 'CDS', start: 400, end: 1200, strand: -1, color: COLORS.kan },
    { id: 't7', name: 'T7 tag', type: 'tag', start: 5131, end: 5163, strand: 1, color: COLORS.t7 },
    { id: 'egfp', name: 'eGFP', type: 'CDS', start: 5179, end: 5898, strand: 1, color: COLORS.egfp },
    { id: 'his', name: '6xHis', type: 'tag', start: 5893, end: 5910, strand: 1, color: COLORS.his },
  ] as SequenceDocument['features'],
});

/** The molecule position (in track units at 1x) under SVG x in `view`: what an anchored zoom keeps still. */
const contentAt = (x: number, view: OverviewView) => (x - X0 - view.offset) / view.scale;

const wheel = (deltaY: number, x: number, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}, deltaX = 0, deltaMode = 0) => ({
  deltaX, deltaY, deltaMode, ctrlKey: false, metaKey: false, altKey: false, ...mods, x,
});

// ─── Stand-ins ───

type Listener = (e: Record<string, unknown>) => void;
function fakeTarget(scale = 1) {
  const listeners: Record<string, { fn: Listener; options?: AddEventListenerOptions }[]> = {};
  return {
    listeners,
    addEventListener: vi.fn((t: string, fn: Listener, options?: AddEventListenerOptions) => { (listeners[t] ??= []).push({ fn, options }); }),
    removeEventListener: vi.fn((t: string, fn: Listener) => { listeners[t] = (listeners[t] ?? []).filter((l) => l.fn !== fn); }),
    fire(t: string, e: Record<string, unknown>) {
      let prevented = 0;
      const event = { preventDefault: () => { prevented++; }, ...e };
      (listeners[t] ?? []).forEach((l) => l.fn(event));
      return prevented;
    },
    getScreenCTM: () => ({ a: scale, e: 0 }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800 * scale, height: 100 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}
type FakeTarget = ReturnType<typeof fakeTarget>;
const wheelEvent = (deltaY: number, clientX: number, extra: Record<string, unknown> = {}) =>
  ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, clientX, clientY: 50, ...extra });
/** requestAnimationFrame that queues; `flush` runs the frames. */
function stubFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
  return { frames, flush: () => frames.splice(0).forEach((f) => f(0)) };
}
/** requestAnimationFrame that runs at once (inside the render that asked for it). */
const syncFrames = () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
};

interface Pass {
  html?: string;
  svg?: Record<string, unknown>;
  rows?: Record<string, unknown>;
  buttons: Record<string, Record<string, unknown>>;
  handles: Record<string, Record<string, unknown>>;
  pills: Record<string, unknown>[];
  cutPills: Record<string, unknown>[];
  percent?: number;
}
const freshPass = (): Pass => ({ buttons: {}, handles: {}, pills: [], cutPills: [] });

/**
 * Render the view; `onPass(n, pass)` runs inside each render pass n (1, 2, ...) once the pass has
 * created the rows' scroller (after the controls, the overview and the rows). A state update made
 * there re-renders the view as pass n + 1.
 */
function renderPasses(
  doc: SequenceDocument,
  selectedRange: { start: number; end: number } | null,
  onPass: (n: number, p: Pass) => void,
  cutSites: ReturnType<typeof findRestrictionCutSites> = [],
) {
  const selections: { start: number; end: number; label?: string }[] = [];
  const passes: Pass[] = [];
  let cur = freshPass();
  probe.onElement = (type, props) => {
    if (type === 'svg' && props.className === 'schematic-overview-svg') cur.svg = props;
    if (type === 'button' && typeof props['aria-label'] === 'string') cur.buttons[props['aria-label'] as string] = props;
    if (type === 'span' && props['data-overview-zoom'] !== undefined) cur.percent = Number(props['data-overview-zoom']);
    if (type === 'rect' && typeof props['data-interval-handle'] === 'string') cur.handles[props['data-interval-handle'] as string] = props;
    if (type === 'g' && props.className === 'clickable-arc') cur.pills.push(props);
    if (type === 'span' && /(^| )cut-pill( |$)/.test(String(props.className ?? ''))) cur.cutPills.push(props);
    if (props.className === 'sequence-blocks-scroll') {
      cur.rows = props;
      const pass = cur;
      passes.push(pass);
      cur = freshPass();
      onPass(passes.length, pass);
    }
  };
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={cutSites} selectedRange={selectedRange}
      onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />,
  );
  probe.onElement = null;
  return { html, selections, passes, last: passes[passes.length - 1] };
}
const call = (props: Record<string, unknown> | undefined, name: string, event: object = {}) => {
  expect(props, 'the element is drawn').toBeDefined();
  expect(typeof props![name], `${name} is wired`).toBe('function');
  (props![name] as (e: object) => void)(event);
};
const attachSvg = (p: Pass, target: FakeTarget) => (p.svg!.ref as (el: unknown) => void)(target);

function schematicSvg(html: string): string {
  const open = html.indexOf('class="schematic-overview-svg"');
  expect(open, 'the schematic is drawn').toBeGreaterThan(-1);
  const start = html.lastIndexOf('<svg', open);
  return html.slice(start, html.indexOf('</svg>', open) + 6);
}
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const rectsOf = (svg: string) => svg.match(/<rect\b[^>]*>/g) ?? [];
const rulerLabels = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*\by="13"[^>]*>([^<]*)<\/text>/g)].map((m) => Number(m[1].replace(/,/g, '')));
const activeRect = (svg: string) => rectsOf(svg).find((r) => attr(r, 'data-active-interval'));
const pillRect = (svg: string, color: string) => rectsOf(svg).find((r) => attr(r, 'fill') === color);

/** The last-painted rect holding (x, y) that takes pointer events: where a click on the drawn overview lands. */
function hitAt(svg: string, x: number, y: number) {
  let top: { handle: string | null; fill: string | undefined } | null = null;
  for (const r of rectsOf(svg)) {
    if (attr(r, 'pointer-events') === 'none' || attr(r, 'fill') === 'none') continue;
    const rx = Number(attr(r, 'x') ?? 0), ry = Number(attr(r, 'y') ?? 0), rw = Number(attr(r, 'width')), rh = Number(attr(r, 'height'));
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) top = { handle: attr(r, 'data-interval-handle') ?? null, fill: attr(r, 'fill') };
  }
  return top;
}

/** Zoom the view with `notches` wheel notches in at SVG x `at` (pass 1), then hand the zoomed pass to `then`. */
function zoomedView(sel: { start: number; end: number } | null, notches: number, at: number, then?: (p: Pass) => void, cutSites: ReturnType<typeof findRestrictionCutSites> = []) {
  syncFrames();
  const svg = fakeTarget();
  let zoomed: Pass | undefined;
  const r = renderPasses(zoomDoc, sel, (n, p) => {
    if (n === 1) {
      attachSvg(p, svg);
      for (let k = 0; k < notches; k++) svg.fire('wheel', wheelEvent(-100, at));
    } else if (!zoomed) {
      zoomed = p;
      then?.(p);
    }
  }, cutSites);
  return { ...r, svg, zoomed };
}

// ═══ AC1 ═══

describe('US-01M7CCG9 AC1 wheel or pinch zooms the overview about the pointer, 1x to single bases, with -, %, +, Fit', () => {
  it('the bound: one base is 12 SVG units wide there, about 60 bases across the track; small molecules do not zoom past 1x', () => {
    expect(OVERVIEW_BASE_UNITS_AT_MAX).toBe(12);
    const max = overviewMaxScale(N);
    expect((W * max) / N).toBeCloseTo(12, 9);
    const view = clampOverviewView({ scale: 1e9, offset: -1e12 }, N);
    expect(view.scale).toBeCloseTo(max, 9);
    const { first, last } = overviewVisibleBases(view, N);
    expect(last - first + 1).toBeGreaterThanOrEqual(60);
    expect(last - first + 1).toBeLessThanOrEqual(62);
    expect(last).toBe(N);
    expect(overviewMaxScale(100)).toBeCloseTo(1200 / 724, 9);
    expect(overviewMaxScale(20)).toBe(1);
    expect(overviewMaxScale(Number.NaN)).toBe(1);
  });

  it('the view is held to 1x..bound and never shows past either end of the molecule', () => {
    for (const scale of [0.1, 1, 2, 50, 1e6]) {
      for (const offset of [100, 0, -500, -1e9]) {
        const v = clampOverviewView({ scale, offset }, N);
        expect(v.scale).toBeGreaterThanOrEqual(1);
        expect(v.scale).toBeLessThanOrEqual(overviewMaxScale(N));
        expect(overviewX(0, v, N), 'base 1 never right of the track start').toBeLessThanOrEqual(X0 + 1e-9);
        expect(overviewX(N, v, N), 'the last base never left of the track end').toBeGreaterThanOrEqual(X0 + W - 1e-9);
      }
    }
    expect(clampOverviewView({ scale: Number.NaN, offset: 0 }, N)).toEqual(OVERVIEW_FIT);
    expect(clampOverviewView({ scale: 2, offset: Number.POSITIVE_INFINITY }, N)).toEqual(OVERVIEW_FIT);
  });

  it('a wheel notch in zooms by 1.08 about the pointer: the molecule point under it does not move', () => {
    let view = OVERVIEW_FIT;
    for (const x of [200, 400, 401.5, 600, 300, 500]) {
      const step = overviewWheelStep(wheel(-100, x), view, N);
      expect(step.handled).toBe(true);
      expect(step.view.scale).toBeCloseTo(view.scale * WHEEL_ZOOM_IN_PER_NOTCH, 9);
      expect(contentAt(x, step.view), `anchor at ${x}`).toBeCloseTo(contentAt(x, view), 9);
      view = step.view;
    }
    // Out again by the same notches returns to the start.
    let back = view;
    for (const x of [500, 300, 600, 401.5, 400, 200]) back = overviewWheelStep(wheel(100, x), back, N).view;
    expect(back.scale).toBeCloseTo(1, 9);
    expect(back.offset).toBeCloseTo(0, 6);
  });

  it('Ctrl, Cmd and Alt wheels and a Chromium pinch zoom; a horizontal or empty wheel is not the overview\'s', () => {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(overviewWheelStep(wheel(-50, 400, mods), OVERVIEW_FIT, N).view.scale).toBeGreaterThan(1);
    }
    expect(overviewWheelStep(wheel(-1, 400, {}, -50), OVERVIEW_FIT, N)).toEqual({ handled: false, view: OVERVIEW_FIT });
    expect(overviewWheelStep(wheel(0, 400), OVERVIEW_FIT, N).handled).toBe(false);
    // Line-mode deltas are pixels times 16.
    expect(overviewWheelStep(wheel(-6.25, 400, {}, 0, 1), OVERVIEW_FIT, N).view.scale).toBeCloseTo(1.08, 9);
  });

  it('near an end the anchor gives way so the molecule still fills the track; a non-finite pointer zooms about the centre', () => {
    // Left of the track's start: holding that point would pull base 1 right of the track.
    const v = overviewWheelStep(wheel(-400, X0 - 30), OVERVIEW_FIT, N).view;
    expect(v.scale).toBeGreaterThan(1);
    expect(v.offset).toBe(0);
    expect(overviewX(0, v, N)).toBe(X0);
    // Just inside it, the point under the pointer holds.
    const w = overviewWheelStep(wheel(-400, X0 + 2), OVERVIEW_FIT, N).view;
    expect(contentAt(X0 + 2, w)).toBeCloseTo(2, 9);
    const c = overviewZoomTo(OVERVIEW_FIT, 2, Number.NaN, N);
    expect(contentAt(X0 + W / 2, c)).toBeCloseTo(W / 2, 9);
  });

  it('bindOverviewWheel: non-passive; one frame\'s wheels are summed into one zoom; a horizontal wheel keeps its default', () => {
    const f = stubFrames();
    const target = fakeTarget();
    let view = OVERVIEW_FIT;
    const applied: OverviewView[] = [];
    const unbind = bindOverviewWheel(target as unknown as Parameters<typeof bindOverviewWheel>[0], {
      read: () => view, toSvgX: (cx) => cx, length: () => N, apply: (v) => { view = v; applied.push(v); },
    });
    for (const t of ['wheel', 'gesturestart', 'gesturechange', 'gestureend']) {
      expect(target.listeners[t]?.[0]?.options, `${t} non-passive`).toEqual({ passive: false });
    }
    expect(target.fire('wheel', wheelEvent(-100, 400))).toBe(1);
    expect(target.fire('wheel', wheelEvent(-100, 400))).toBe(1);
    expect(target.fire('wheel', wheelEvent(-2, 400, { deltaX: 80 })), 'a horizontal wheel is left to the page').toBe(0);
    expect(f.frames).toHaveLength(1);
    f.flush();
    expect(applied).toHaveLength(1);
    expect(applied[0].scale).toBeCloseTo(1.08 * 1.08, 9);
    expect(contentAt(400, applied[0])).toBeCloseTo(400 - X0, 9);
    unbind();
    expect(target.listeners.wheel).toEqual([]);
    expect(target.fire('wheel', wheelEvent(-100, 400))).toBe(0);
  });

  it('bindOverviewWheel: a WebKit pinch (gesturestart / gesturechange) zooms to its start scale times its scale, about the pinch', () => {
    syncFrames();
    const target = fakeTarget();
    let view: OverviewView = { scale: 2, offset: -300 };
    const unbind = bindOverviewWheel(target as unknown as Parameters<typeof bindOverviewWheel>[0], { read: () => view, toSvgX: (cx) => cx, length: () => N, apply: (v) => { view = v; } });
    const before = contentAt(450, view);
    expect(target.fire('gesturestart', { scale: 1, clientX: 450 })).toBe(1);
    target.fire('gesturechange', { scale: 1.5, clientX: 450 });
    expect(view.scale).toBeCloseTo(3, 9);
    target.fire('gesturechange', { scale: 2, clientX: 450 });
    expect(view.scale).toBeCloseTo(4, 9);
    expect(contentAt(450, view)).toBeCloseTo(before, 9);
    // Wheels a pinch also sends while it runs are prevented, not applied.
    expect(target.fire('wheel', wheelEvent(-100, 450, { ctrlKey: true }))).toBe(1);
    expect(view.scale).toBeCloseTo(4, 9);
    target.fire('gestureend', {});
    target.fire('wheel', wheelEvent(-100, 450, { ctrlKey: true }));
    expect(view.scale).toBeCloseTo(4 * 1.08, 9);
    unbind();
  });

  it('bindOverviewWheel: while a brush drag runs (read() is null) the overview does not zoom', () => {
    syncFrames();
    const target = fakeTarget();
    const applied: OverviewView[] = [];
    bindOverviewWheel(target as unknown as Parameters<typeof bindOverviewWheel>[0], { read: () => null, toSvgX: (cx) => cx, length: () => N, apply: (v) => applied.push(v) });
    target.fire('wheel', wheelEvent(-100, 400));
    target.fire('gesturestart', { scale: 1, clientX: 400 });
    target.fire('gesturechange', { scale: 2, clientX: 400 });
    expect(applied).toEqual([]);
  });

  it('the view: a wheel over the overview zooms it, and the percentage and the ruler read the same zoom', () => {
    const r = zoomedView(null, 10, 400);
    const scale = Math.pow(1.08, 10);
    expect(r.zoomed?.percent).toBe(Math.round(scale * 100));
    expect(r.html).toContain(`${Math.round(scale * 100)}%`);
    const svg = schematicSvg(r.html);
    const labels = rulerLabels(svg);
    const view = overviewZoomTo(OVERVIEW_FIT, scale, 400, N);
    const { first, last } = overviewVisibleBases(view, N);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const l of labels) {
      expect(l).toBeGreaterThanOrEqual(first - 1);
      expect(l).toBeLessThanOrEqual(last);
    }
    expect(overviewRulerTicks(view, N).map((t) => t.label)).toEqual(labels);
  });

  it('the view: + zooms in, - zooms out, Fit returns to 100%; each button is off where it would do nothing', () => {
    syncFrames();
    const seen: Pass[] = [];
    renderPasses(zoomDoc, null, (n, p) => {
      seen.push(p);
      if (n === 1) {
        expect(p.percent).toBe(100);
        expect(p.buttons['Zoom out the linear map'].disabled).toBe(true);
        expect(p.buttons['Fit the whole molecule in the linear map'].disabled).toBe(true);
        expect(p.buttons['Zoom in the linear map'].disabled).toBe(false);
        call(p.buttons['Zoom in the linear map'], 'onClick');
      } else if (n === 2) {
        expect(p.percent).toBe(Math.round(Math.pow(1.08, 3) * 100));
        expect(p.buttons['Zoom out the linear map'].disabled).toBe(false);
        call(p.buttons['Zoom in the linear map'], 'onClick');
      } else if (n === 3) {
        expect(p.percent).toBe(Math.round(Math.pow(1.08, 6) * 100));
        call(p.buttons['Zoom out the linear map'], 'onClick');
      } else if (n === 4) {
        expect(p.percent).toBe(Math.round(Math.pow(1.08, 3) * 100));
        call(p.buttons['Fit the whole molecule in the linear map'], 'onClick');
      }
    });
    expect(seen.map((p) => p.percent)).toEqual([100, 126, 159, 126, 100]);
  });

  it('the view: at the bound the axis ticks every base it shows, and + is off', () => {
    const r = zoomedView(null, 80, 400);
    expect(r.zoomed?.percent).toBe(Math.round(overviewMaxScale(N) * 100));
    expect(r.zoomed?.buttons['Zoom in the linear map'].disabled).toBe(true);
    const ticks = /data-base-ticks="(\d+)\.\.(\d+)"[^>]*\sd="([^"]*)"|\sd="([^"]*)"[^>]*data-base-ticks="(\d+)\.\.(\d+)"/.exec(schematicSvg(r.html));
    expect(ticks, 'one tick per base').not.toBeNull();
    const [a, b] = ticks![1] ? [Number(ticks![1]), Number(ticks![2])] : [Number(ticks![5]), Number(ticks![6])];
    const d = ticks![3] ?? ticks![4];
    expect(b - a + 1).toBeGreaterThanOrEqual(60);
    expect(d.match(/M /g)?.length).toBe(b - a + 2);
  });
});

// ═══ AC2 ═══

describe('US-01M7CCG9 AC2 a plain wheel over the base rows scrolls them and does not zoom', () => {
  it('the rows are a scroll surface: a plain wheel scrolls, a horizontal wheel scrolls', () => {
    expect(classifyWheelGesture({ deltaX: 0, deltaY: 100, ctrlKey: false, metaKey: false, altKey: false }, 'scroll')).toBe('scroll');
    expect(classifyWheelGesture({ deltaX: 100, deltaY: 0, ctrlKey: false, metaKey: false, altKey: false }, 'scroll')).toBe('scroll');
  });

  it('the view binds its wheel to the overview alone: the rows take no wheel handler and no wheel listener', () => {
    syncFrames();
    const svg = fakeTarget();
    const rows = fakeTarget();
    const r = renderPasses(zoomDoc, null, (n, p) => {
      if (n !== 1) return;
      expect(p.rows!.onWheel, 'no React wheel handler on the rows').toBeUndefined();
      expect(p.rows!.onWheelCapture).toBeUndefined();
      (p.rows!.ref as (el: unknown) => void)({ ...rows, clientWidth: 1000, scrollTop: 0, querySelectorAll: () => [], querySelector: () => null });
      attachSvg(p, svg);
    });
    expect(rows.addEventListener.mock.calls.map((c) => c[0])).not.toContain('wheel');
    expect(svg.addEventListener.mock.calls.map((c) => c[0])).toContain('wheel');
    expect(r.passes.every((p) => p.percent === 100)).toBe(true);
  });

  it('the view: wheels that are not the overview\'s keep their default and leave the zoom at 100%', () => {
    syncFrames();
    const svg = fakeTarget();
    let prevented = -1;
    const r = renderPasses(zoomDoc, null, (n, p) => {
      if (n !== 1) return;
      attachSvg(p, svg);
      prevented = svg.fire('wheel', wheelEvent(-2, 400, { deltaX: -120 }));
    });
    expect(prevented).toBe(0);
    expect(r.last.percent).toBe(100);
  });
});

// ═══ AC3 ═══

describe('US-01M7CCG9 AC3 zoom keeps the selection, and every click maps to the same coordinates at every scale', () => {
  const sel = { start: 5179, end: 5898 };

  it('zooming never selects: the selection stays, drawn at its bases on the zoomed scale', () => {
    for (const notches of [0, 5, 20, 60]) {
      const r = zoomedView(sel, notches, 640);
      expect(r.selections, `${notches} notches`).toEqual([]);
      const view = notches === 0 ? OVERVIEW_FIT : overviewZoomTo(OVERVIEW_FIT, Math.min(overviewMaxScale(N), Math.pow(1.08, notches)), 640, N);
      const rect = activeRect(schematicSvg(r.html))!;
      expect(attr(rect, 'data-active-interval')).toBe('5179..5898');
      expect(Number(attr(rect, 'x'))).toBeCloseTo(overviewX(sel.start - 1, view, N), 6);
      expect(Number(attr(rect, 'width'))).toBeCloseTo(Math.max(2, overviewX(sel.end, view, N) - overviewX(sel.start - 1, view, N)), 6);
      for (const [edge, b] of [['start', sel.start - 1], ['end', sel.end]] as const) {
        const h = notches === 0 ? undefined : r.zoomed?.handles[edge];
        if (h) expect(Number(h.x) + Number(h.width) / 2, `${edge} handle at ${notches}`).toBeCloseTo(overviewX(b, view, N), 6);
      }
    }
  });

  it('a drag on the zoomed overview selects the bases drawn under the pointer', () => {
    const notches = 30;
    const view = overviewZoomTo(OVERVIEW_FIT, Math.pow(1.08, notches), 400, N);
    const layout = overviewBrushLayout(view, N, 1);
    const xOf = (b: number) => overviewX(b - 0.5, view, N);
    const target = fakeTarget();
    let drag: { start: number; end: number }[] = [];
    const { first, last } = overviewVisibleBases(view, N);
    const a = first + 20;
    const b = last - 15;
    expect(schematicBaseAt(xOf(a), layout)).toBe(a);
    const r = zoomedView(null, notches, 400, (p) => {
      call(p.svg, 'onPointerDown', { clientX: xOf(a), pointerId: 1, button: 0, currentTarget: target, target: { getAttribute: () => null } });
      call(p.svg, 'onPointerUp', { clientX: xOf(b), pointerId: 1, button: 0, currentTarget: target, target: { getAttribute: () => null } });
    });
    drag = r.selections;
    expect(drag).toEqual([{ start: a, end: b }]);
    expect(b - a).toBeLessThan(last - first);
  });

  it('a feature pill on the zoomed overview is drawn at its bases, takes its click over the edge handles, and selects its coordinates', () => {
    for (const notches of [0, 8, 25]) {
      const view = notches === 0 ? OVERVIEW_FIT : overviewZoomTo(OVERVIEW_FIT, Math.pow(1.08, notches), 640, N);
      let selected: { start: number; end: number }[] = [];
      const r = notches === 0
        ? renderPasses(zoomDoc, sel, (n, p) => { if (n === 1) (p.pills.find((g) => g.className === 'clickable-arc' && JSON.stringify(Object.keys(g)).length > 0 && String(([g.children].flat(3) as { props?: { children?: unknown } }[])[0]?.props?.children).startsWith('T7 tag'))!.onClick as () => void)(); })
        : zoomedView(sel, notches, 640, (p) => {
            const t7 = p.pills.find((g) => String(([g.children].flat(3) as { props?: { children?: unknown } }[])[0]?.props?.children).startsWith('T7 tag'));
            (t7!.onClick as () => void)();
          });
      selected = r.selections.map(({ start, end }) => ({ start, end }));
      expect(selected, `${notches} notches`).toEqual([{ start: 5131, end: 5163 }]);
      const svg = schematicSvg(r.html);
      const t7 = pillRect(svg, COLORS.t7)!;
      const x = Number(attr(t7, 'x'));
      expect(x).toBeCloseTo(overviewX(5130, view, N), 6);
      const w = Number(attr(t7, 'width'));
      expect(w).toBeCloseTo(Math.max(8, overviewX(5163, view, N) - x), 6);
      for (let dx = 0.25; dx < w; dx += 0.5) {
        const hit = hitAt(svg, x + dx, Number(attr(t7, 'y')) + 8);
        if (x + dx < X0 - 6 || x + dx > X0 + W + 6) continue;
        expect(hit?.handle ?? null, `${notches}: +${dx}`).toBeNull();
        expect(hit?.fill).toBe(COLORS.t7);
      }
    }
  });

  it('the zoomed track draws only what it shows, clipped to the track; the fitted one draws everything, unclipped', () => {
    const fit = schematicSvg(renderPasses(zoomDoc, null, () => {}).html);
    expect(fit).not.toContain('clip-path');
    for (const c of Object.values(COLORS)) expect(pillRect(fit, c), c).toBeDefined();
    const z = zoomedView(null, 25, 640);
    const svg = schematicSvg(z.html);
    expect(svg).toMatch(/<g clip-path="url\(#mbc-overview-clip-doc-zoom\)">/);
    expect(pillRect(svg, COLORS.kan), 'KanR is off the zoomed window').toBeUndefined();
    expect(pillRect(svg, COLORS.egfp)).toBeDefined();
  });

  it('a restriction marker in the base rows still selects its site at any zoom', () => {
    const seq = 'TTTTGAATTCTTTT';
    const ecoRI = REBASE_ENZYMES.find((e) => e.name === 'EcoRI')!;
    const sites = findRestrictionCutSites(seq, 'linear', [ecoRI]);
    syncFrames();
    const target = fakeTarget();
    const r = renderPasses(docOf(seq, { topology: 'linear' }), null, (n, p) => {
      if (n === 1) {
        attachSvg(p, target);
        for (let k = 0; k < 5; k++) target.fire('wheel', wheelEvent(-100, 300));
      } else if (n === 2) {
        const el = { focus() {} };
        call(p.cutPills[0], 'onClick', { currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} });
      }
    }, sites);
    expect(r.passes[1]?.percent, 'zoomed (a 14 bp molecule tops out early)').toBeGreaterThanOrEqual(100);
    expect(r.selections.map(({ start, end }) => ({ start, end }))).toEqual([{ start: 5, end: 10 }]);
  });

  it('the view: a wheel while a brush drag runs does not zoom (the drag keeps the scale it was pressed at); after it, it does', () => {
    syncFrames();
    const svg = fakeTarget();
    const ev = (clientX: number) => ({ clientX, pointerId: 1, button: 0, currentTarget: svg, target: { getAttribute: () => null } });
    let during = -1;
    const r = renderPasses(zoomDoc, null, (n, p) => {
      if (n !== 1) return;
      attachSvg(p, svg);
      call(p.svg, 'onPointerDown', ev(300));
      call(p.svg, 'onPointerMove', ev(360));
      during = svg.fire('wheel', wheelEvent(-300, 330));
      call(p.svg, 'onPointerUp', ev(360));
      svg.fire('wheel', wheelEvent(-100, 330));
    });
    expect(during, 'the gesture is still the overview\'s, so the page does not scroll').toBe(1);
    expect(r.selections).toHaveLength(1);
    expect(r.last.percent, 'only the wheel after the drag zoomed').toBe(108);
  });

  it('the handles stay 10 screen pixels wide when zoomed', () => {
    const z = zoomedView(sel, 12, 640);
    expect(Number(z.zoomed?.handles.start?.width)).toBe(BRUSH_HANDLE_HIT_PX);
  });
});

// ═══ AC4 ═══

describe('US-01M7CCG9 AC4 the linear map\'s Export saves the whole schematic, not the zoomed window', () => {
  it('the overview registers a file drawing, and when zoomed that drawing is the whole fitted schematic', () => {
    const sel = { start: 5179, end: 5898 };
    const z = zoomedView(sel, 25, 640);
    const reg = files.drawings.filter((d) => d.svg === z.svg && d.draw);
    expect(reg, 'the overview svg registers its file drawing').toHaveLength(1);
    const inner = reg[0].draw!();
    const file = `<svg viewBox="0 0 800 100">${inner}</svg>`;
    // Screen: zoomed and clipped.
    expect(schematicSvg(z.html)).toContain('clip-path');
    expect(rulerLabels(schematicSvg(z.html))).not.toEqual([1, 1212, 2424, 3637, 4849, 6061]);
    // File: the whole molecule, every feature, the fitted ruler, the selection at its fitted place.
    expect(file).not.toContain('clip-path');
    expect(rulerLabels(file)).toEqual([1, 1212, 2424, 3637, 4849, 6061]);
    for (const c of Object.values(COLORS)) expect(pillRect(file, c), c).toBeDefined();
    const rect = activeRect(file)!;
    expect(Number(attr(rect, 'x'))).toBeCloseTo(overviewX(5178, OVERVIEW_FIT, N), 6);
    expect(file, 'no focusable handles in a file').not.toContain('data-interval-handle');
    expect(file).not.toContain('tabindex');
    expect(file).not.toContain('data-base-ticks');
  });

  it('unzoomed, the file drawing matches the screen\'s drawing apart from the handles', () => {
    syncFrames();
    const target = fakeTarget();
    const r = renderPasses(zoomDoc, { start: 30, end: 90 }, (n, p) => { if (n === 1) attachSvg(p, target); });
    const inner = files.drawings.find((d) => d.svg === target && d.draw)!.draw!();
    const screen = schematicSvg(r.html);
    const screenInner = screen.slice(screen.indexOf('>') + 1, -'</svg>'.length);
    const withoutHandles = (m: string) => m.replace(/<rect\b[^>]*data-interval-handle[^>]*>(<\/rect>)?/g, '');
    expect(withoutHandles(inner)).toBe(withoutHandles(screenInner));
  });
});
