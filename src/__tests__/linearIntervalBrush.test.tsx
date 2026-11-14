// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCFQ: on the linear overview a pointer drag creates the one active interval on empty
 * space, moves it from inside and resizes it from either edge, and every step selects exactly the
 * bases the drag covers through the active-interval model (src/core/activeInterval.ts). The
 * overview draws that interval and no page rectangle beside it; feature pills and restriction
 * markers still select their coordinates; the edge handles are 10 px wide, focusable sliders that
 * move one base per arrow key (ten with Shift); and pointercancel puts back the selection the drag
 * started from.
 *
 * The drag itself is a pure reducer (`brushStep`) over SVG x-coordinates and the schematic's own
 * scale, tested exhaustively here. The component wiring is pinned with the element probe of
 * cleavagePreview.test.tsx: the overview's handlers are read off the elements its render creates
 * and driven with stand-in events (no DOM).
 */

import React from 'react';
import nodeFs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  onElement: null as null | ElementProbe,
  /** Sees every effect a component registers while it renders (server rendering runs none). */
  onEffect: null as null | ((effect: () => unknown) => void),
}));

// The views' effects are read off `useEffect` and run by hand on stand-in elements (US-01M7CCJC).
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useEffect = ((effect: Parameters<typeof actual.useEffect>[0], deps?: Parameters<typeof actual.useEffect>[1]) => {
    probe.onEffect?.(effect);
    return actual.useEffect(effect, deps);
  }) as typeof actual.useEffect;
  return { ...actual, default: { ...actual, useEffect }, useEffect };
});

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

const {
  LinearSequenceView,
  schematicBaseAt,
  brushHitTest,
  brushStep,
  brushKeyStep,
  BRUSH_IDLE,
  BRUSH_HANDLE_HIT_PX,
  BRUSH_DRAG_THRESHOLD_PX,
  rowDragStep,
  ROW_DRAG_IDLE,
  rowDragEdgeAction,
  rowDragEdgeBase,
  clearNativeTextSelection,
  firstVisibleRowStart,
  selectionFollowPage,
  SELECTION_QUICKBAR_HEIGHT_PX,
  SELECTION_QUICKBAR_SLOT_STYLE,
  QUICKBAR_ACTION_GAP_PX,
  QuickbarActionStrip,
  quickbarInlineCount,
  quickbarMenuKey,
} = await import('../components/LinearSequenceView');
const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SequenceDocument = import('../types/bio').SequenceDocument;
type ActiveInterval = import('../types/bio').ActiveInterval;
type BrushDrag = import('../components/LinearSequenceView').BrushDrag;
type BrushLayout = import('../components/LinearSequenceView').BrushLayout;
type BrushInput = import('../components/LinearSequenceView').BrushInput;

afterEach(() => {
  probe.onElement = null;
  probe.onEffect = null;
  vi.unstubAllGlobals();
});

// ─── The schematic's scale: base b covers [X0 + (b-1)·W/N, X0 + b·W/N) ───

const X0 = 38;
const W = 724;
const N = 100;
const PER = W / N; // 7.24 SVG units per base
const layoutOf = (length = N, unitsPerPx = 1): BrushLayout => ({ x0: X0, width: W, length, unitsPerPx });
const L = layoutOf();
/** The centre of base `b`, the left boundary of `b` and the right boundary of `b`. */
const mid = (b: number, per = PER) => X0 + (b - 0.5) * per;
const left = (b: number, per = PER) => X0 + (b - 1) * per;
const right = (b: number, per = PER) => X0 + b * per;

/** Run one gesture through the reducer: the selections it makes and whether a cancel restored. */
function gesture(
  inputs: BrushInput[],
  current: ActiveInterval | null,
  opts: { layout?: BrushLayout; topology?: 'linear' | 'circular' } = {},
) {
  let drag: BrushDrag = BRUSH_IDLE;
  const selects: ActiveInterval[] = [];
  const restores: (ActiveInterval | null)[] = [];
  for (const input of inputs) {
    const step = brushStep(drag, input, { current, layout: opts.layout ?? L, topology: opts.topology ?? 'linear' });
    drag = step.drag;
    if (step.select) selects.push(step.select);
    if (step.cancelled) restores.push(step.cancelled.restore);
  }
  return { selects, restores, drag, last: selects[selects.length - 1] };
}
const down = (x: number, edge?: 'start' | 'end'): BrushInput => ({ type: 'down', x, pointerId: 1, edge });
const move = (x: number, pointerId = 1): BrushInput => ({ type: 'move', x, pointerId });
const up = (x: number): BrushInput => ({ type: 'up', x, pointerId: 1 });
const cancel = (): BrushInput => ({ type: 'cancel', pointerId: 1 });

// ─── The component and its stand-in events ───

const docOf = (sequence: string, extra: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id: 'doc-brush', name: 'brush', accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'],
  ...extra,
});
const SEQ100 = 'ACGTTGCAAT'.repeat(10);
const FEATURE_COLOR = '#abcdef';
const featureDoc = docOf(SEQ100, {
  features: [{ id: 'f1', name: 'geneX', type: 'CDS', start: 20, end: 45, strand: 1, color: FEATURE_COLOR }] as SequenceDocument['features'],
});

/** A stand-in for the schematic `<svg>`: clientX maps 1:1 to SVG units (screen CTM a = 1, e = 0). */
function fakeSvg(scale = 1) {
  return {
    getScreenCTM: () => ({ a: scale, e: 0 }),
    getBoundingClientRect: () => ({ left: 0, width: 800 * scale }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  };
}
const targetOf = (handle: string | null = null) => ({ getAttribute: (n: string) => (n === 'data-interval-handle' ? handle : null) });
const pev = (svg: ReturnType<typeof fakeSvg>, clientX: number, handle: string | null = null) => ({
  clientX, pointerId: 1, button: 0, isPrimary: true, currentTarget: svg, target: targetOf(handle),
  preventDefault() {}, stopPropagation() {},
});

/** Frames queued by the view: the drag does its work once per animation frame. */
function stubFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
  return {
    frames,
    flush: () => { const fs = frames.splice(0); fs.forEach((f) => f(0)); return fs.length; },
  };
}

interface Drive {
  svg?: Record<string, unknown>;
  handles: Record<string, Record<string, unknown>>;
  pills: Record<string, unknown>[];
  cutPills: Record<string, unknown>[];
}

/** Render the view; `act` runs once, on the first pass that has drawn the schematic's handles (or the svg). */
function renderView(
  doc: SequenceDocument,
  selectedRange: { start: number; end: number } | null,
  act: ((d: Drive) => void) | null,
  cutSites: ReturnType<typeof findRestrictionCutSites> = [],
) {
  const selections: { start: number; end: number; label?: string }[] = [];
  const clears: number[] = [];
  const seen: Drive = { handles: {}, pills: [], cutPills: [] };
  let acted = false;
  probe.onElement = (type, props) => {
    if (type === 'svg' && props.className === 'schematic-overview-svg') seen.svg = props;
    if (type === 'rect' && typeof props['data-interval-handle'] === 'string') seen.handles[props['data-interval-handle'] as string] = props;
    if (type === 'g' && props.className === 'clickable-arc') seen.pills.push(props);
    if (type === 'span' && /(^| )cut-pill( |$)/.test(String(props.className ?? ''))) seen.cutPills.push(props);
  };
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={cutSites} selectedRange={selectedRange}
      onSelectRange={(r) => selections.push(r)} onClearSelection={() => clears.push(1)} onUpdateDocument={() => {}} />,
  );
  probe.onElement = null;
  if (act && !acted) { acted = true; act(seen); }
  return { html, selections, clears, seen };
}

const handler = (props: Record<string, unknown> | undefined, name: string) => {
  expect(props, 'the element is drawn').toBeDefined();
  const fn = props![name];
  expect(typeof fn, `${name} is wired`).toBe('function');
  return fn as (e: object) => void;
};

/** The `<svg>` of the linear overview, as markup. */
function schematicSvg(html: string): string {
  const open = html.indexOf('class="schematic-overview-svg"');
  expect(open, 'the schematic is drawn').toBeGreaterThan(-1);
  const start = html.lastIndexOf('<svg', open);
  return html.slice(start, html.indexOf('</svg>', open) + 6);
}
const rectsOf = (svg: string) => svg.match(/<rect\b[^>]*>/g) ?? [];
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// ═══ AC1 ═══

describe('US-01M7CCFQ AC1 a drag creates, moves and resizes the interval with the exact bases it covers', () => {
  it('maps every x to the base whose cell holds it: a boundary belongs to the base on its right, the ends clamp', () => {
    for (let b = 1; b <= N; b++) {
      expect(schematicBaseAt(mid(b), L), `centre of ${b}`).toBe(b);
      expect(schematicBaseAt(left(b) + 0.001, L), `just inside ${b}`).toBe(b);
      expect(schematicBaseAt(right(b) - 0.001, L), `just before ${b}'s right edge`).toBe(b);
    }
    expect(schematicBaseAt(left(37), L)).toBe(37);
    expect(schematicBaseAt(X0, L)).toBe(1);
    expect(schematicBaseAt(X0 - 30, L)).toBe(1);
    expect(schematicBaseAt(X0 + W, L)).toBe(N);
    expect(schematicBaseAt(900, L)).toBe(N);
    // A 6,000 bp molecule on the same 724 units: 8.29 bases per unit.
    const big = layoutOf(6000);
    expect(schematicBaseAt(X0 + 362, big)).toBe(3001);
    expect(schematicBaseAt(X0 + 361.99, big)).toBe(3000);
  });

  it('a drag on empty space selects from the base under the press to the base under the pointer, both included', () => {
    const pairs: [number, number][] = [[10, 20], [20, 10], [1, 100], [100, 1], [1, 2], [99, 100], [50, 51], [37, 64], [64, 37], [1, 50], [50, 100]];
    for (const [a, b] of pairs) {
      const g = gesture([down(mid(a)), move(mid(b)), up(mid(b))], null);
      expect(g.last, `${a} -> ${b}`).toEqual({ start: Math.min(a, b), end: Math.max(a, b) });
      expect(g.drag).toEqual(BRUSH_IDLE);
    }
    // The press base stays in when the pointer comes back over it after passing it.
    expect(gesture([down(mid(40)), move(mid(60)), move(mid(30))], null).selects).toEqual([{ start: 40, end: 60 }, { start: 30, end: 40 }]);
    // Released past the ends, the drag takes the first and the last base, no more.
    expect(gesture([down(mid(30)), move(-50)], null).last).toEqual({ start: 1, end: 30 });
    expect(gesture([down(mid(30)), move(1000)], null).last).toEqual({ start: 30, end: 100 });
  });

  it('a drag starting outside an existing interval creates a new one in its place', () => {
    expect(gesture([down(mid(70)), move(mid(80))], { start: 10, end: 20 }).last).toEqual({ start: 70, end: 80 });
  });

  it('every step of a drag selects the bases under it then, and only when they change', () => {
    const g = gesture([down(mid(10)), move(mid(15)), move(mid(15) + 1), move(mid(18)), move(mid(18)), up(mid(18))], null);
    expect(g.selects).toEqual([{ start: 10, end: 15 }, { start: 10, end: 18 }]);
  });

  it('a drag inside the interval moves it by the bases the pointer travelled, never changing its length', () => {
    const cur = { start: 30, end: 39 };
    for (let d = -60; d <= 80; d += 1) {
      const g = gesture([down(mid(35)), move(mid(35) + d * PER)], cur);
      const expected = { start: Math.min(91, Math.max(1, 30 + d)), end: Math.min(100, Math.max(10, 39 + d)) };
      if (d === 0) expect(g.selects, 'no travel, no new selection').toEqual([]);
      else if (Math.abs(d * PER) >= BRUSH_DRAG_THRESHOLD_PX) {
        expect(g.last, `moved ${d}`).toEqual(expected);
        expect(g.last!.end - g.last!.start + 1, `length kept at ${d}`).toBe(10);
      }
    }
    // A half-base travel rounds to the nearer base.
    expect(gesture([down(mid(35)), move(mid(35) + 2.4 * PER)], cur).last).toEqual({ start: 32, end: 41 });
    expect(gesture([down(mid(35)), move(mid(35) + 2.6 * PER)], cur).last).toEqual({ start: 33, end: 42 });
  });

  it('a drag on either edge resizes that edge, and swaps edges when it passes the other one', () => {
    const cur = { start: 30, end: 39 };
    // End edge (right boundary of base 39).
    expect(gesture([down(right(39)), move(right(39) + 3 * PER)], cur).last).toEqual({ start: 30, end: 42 });
    expect(gesture([down(right(39)), move(right(39) - 4 * PER)], cur).last).toEqual({ start: 30, end: 35 });
    expect(gesture([down(right(39)), move(right(39) - 15 * PER)], cur).last).toEqual({ start: 24, end: 30 });
    expect(gesture([down(right(39)), move(2000)], cur).last).toEqual({ start: 30, end: 100 });
    // Start edge (left boundary of base 30).
    expect(gesture([down(left(30)), move(left(30) - 5 * PER)], cur).last).toEqual({ start: 25, end: 39 });
    expect(gesture([down(left(30)), move(left(30) + 4 * PER)], cur).last).toEqual({ start: 34, end: 39 });
    expect(gesture([down(left(30)), move(left(30) + 20 * PER)], cur).last).toEqual({ start: 39, end: 50 });
    expect(gesture([down(left(30)), move(-500)], cur).last).toEqual({ start: 1, end: 39 });
    // The first and the last base.
    expect(gesture([down(left(1)), move(left(1) + 2 * PER)], { start: 1, end: 5 }).last).toEqual({ start: 3, end: 5 });
    expect(gesture([down(right(100)), move(right(100) - 2 * PER)], { start: 96, end: 100 }).last).toEqual({ start: 96, end: 98 });
  });

  it('a one-base interval: each edge is its own handle, and dragging one past the other swaps them', () => {
    const one = { start: 50, end: 50 };
    expect(brushHitTest(left(50), one, L)).toEqual({ mode: 'resize', edge: 'start' });
    expect(brushHitTest(right(50), one, L)).toEqual({ mode: 'resize', edge: 'end' });
    expect(gesture([down(left(50)), move(left(50) + 3 * PER)], one).last).toEqual({ start: 50, end: 53 });
    expect(gesture([down(right(50)), move(right(50) - 3 * PER)], one).last).toEqual({ start: 47, end: 50 });
  });

  it('a press and release without travel (a click) selects nothing', () => {
    expect(gesture([down(mid(10)), move(mid(10) + BRUSH_DRAG_THRESHOLD_PX - 0.5), up(mid(10) + 1)], null).selects).toEqual([]);
    expect(gesture([down(mid(35)), up(mid(35))], { start: 30, end: 39 }).selects).toEqual([]);
  });

  it('a move from another pointer, or with no press, does nothing', () => {
    expect(gesture([move(mid(10)), up(mid(20))], null).selects).toEqual([]);
    expect(gesture([down(mid(10)), move(mid(30), 2)], null).selects).toEqual([]);
  });

  it('circular molecule: a drag on the overview stays linear - it creates and moves without wrapping through the ends', () => {
    const c = { topology: 'circular' as const };
    expect(gesture([down(mid(95)), move(1000)], null, c).last).toEqual({ start: 95, end: 100 });
    expect(gesture([down(mid(95)), move(mid(92) + 10 * PER)], { start: 90, end: 99 }, c).last).toEqual({ start: 91, end: 100 });
    expect(gesture([down(mid(5)), move(mid(5) - 10 * PER)], { start: 3, end: 8 }, c).last).toEqual({ start: 1, end: 6 });
  });

  it('circular molecule: an interval across the origin is not dragged on the overview - a press anywhere starts a new linear one', () => {
    const c = { topology: 'circular' as const };
    const across = { start: 95, end: 5 };
    for (const x of [mid(2), mid(97), mid(50), left(95), right(5)]) {
      expect(brushHitTest(x, across, L), `press at ${x}`).toEqual({ mode: 'create' });
    }
    expect(gesture([down(mid(2)), move(mid(2) + 3 * PER)], across, c).last).toEqual({ start: 2, end: 5 });
    expect(gesture([down(right(5)), move(right(5) + 2 * PER)], across, c).last).toEqual({ start: 6, end: 8 });
    // Even handed an edge, a crossing interval is not resized into a wrap.
    expect(gesture([down(left(95), 'start'), move(left(95) - 2 * PER)], across, c).last).toEqual({ start: 93, end: 95 });
  });

  it('no gesture on the overview ever selects an interval across the origin (start > end), on either topology', () => {
    const xs = [-40, X0, left(1), mid(1), right(1), mid(5), left(30), mid(35), right(39), mid(50), mid(96), right(100), X0 + W, 900];
    const currents = [null, { start: 30, end: 39 }, { start: 1, end: 1 }, { start: 100, end: 100 }, { start: 1, end: 100 }, { start: 95, end: 5 }];
    for (const topology of ['linear', 'circular'] as const)
      for (const current of currents)
        for (const a of xs)
          for (const b of xs)
            for (const edge of [undefined, 'start', 'end'] as const) {
              const g = gesture([down(a, edge), move(b), up(b)], current, { topology });
              for (const s of g.selects) {
                expect(s.start <= s.end && s.start >= 1 && s.end <= N, `${topology} ${JSON.stringify(current)} ${a}->${b} ${edge}: ${s.start}..${s.end}`).toBe(true);
              }
            }
  });

  it('a pointer position that is not a finite number is ignored, and the drag goes on', () => {
    const g = gesture([down(Number.NaN), move(mid(20))], null);
    expect(g.selects).toEqual([]);
    const h = gesture([down(mid(10)), move(Number.NaN), move(Number.POSITIVE_INFINITY), move(mid(20))], { start: 50, end: 60 });
    expect(h.selects).toEqual([{ start: 10, end: 20 }]);
    expect(gesture([down(mid(10)), move(mid(20))], null, { layout: { ...L, length: 0 } }).selects).toEqual([]);
  });

  it('the view: a drag on empty space selects its bases, once per animation frame, under pointer capture', () => {
    const f = stubFrames();
    const svg = fakeSvg();
    const v = renderView(docOf(SEQ100), null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(10)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(12)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(16)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(20)));
    });
    expect(svg.setPointerCapture).toHaveBeenCalledWith(1);
    expect(v.selections, 'nothing before the frame').toEqual([]);
    expect(f.frames, 'one frame for three moves').toHaveLength(1);
    f.flush();
    expect(v.selections).toEqual([{ start: 10, end: 20 }]);
  });

  it('the view: the release selects the bases under the release point and lets go of the pointer', () => {
    stubFrames();
    const svg = fakeSvg();
    const v = renderView(docOf(SEQ100), null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(60)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(40)));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(33)));
    });
    expect(v.selections).toEqual([{ start: 33, end: 60 }]);
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('the view: a drag inside the selection moves it, and one on a handle resizes that edge', () => {
    stubFrames();
    const sel = { start: 30, end: 39 };
    const svg = fakeSvg();
    const moved = renderView(docOf(SEQ100), sel, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(35)));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(35) + 7 * PER));
    });
    expect(moved.selections).toEqual([{ start: 37, end: 46 }]);
    const resized = renderView(docOf(SEQ100), sel, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(35), 'end'));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(35) + 5 * PER));
    });
    expect(resized.selections, 'the end handle resizes even pressed off its centre').toEqual([{ start: 30, end: 44 }]);
  });

  it('the view: a drag on a 2x-scaled overview reads client pixels through the screen transform', () => {
    stubFrames();
    const svg = fakeSvg(2);
    const v = renderView(docOf(SEQ100), null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(10) * 2));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(25) * 2));
    });
    expect(v.selections).toEqual([{ start: 10, end: 25 }]);
  });
});

// ═══ AC2 ═══

describe('US-01M7CCFQ AC2 the overview draws one highlighted interval, the selection, and no page rectangle', () => {
  const others = (svg: string) =>
    rectsOf(svg).filter((r) =>
      attr(r, 'data-interval-handle') === undefined &&
      attr(r, 'width') !== '800' &&
      attr(r, 'fill') !== FEATURE_COLOR);

  it('with a selection, the only highlighted rectangle is the selection, at its bases on the schematic scale', () => {
    for (const sel of [{ start: 30, end: 39 }, { start: 1, end: 1 }, { start: 100, end: 100 }, { start: 1, end: 100 }, { start: 61, end: 80 }]) {
      const svg = schematicSvg(renderView(featureDoc, sel, null).html);
      const highlighted = others(svg);
      expect(highlighted, `${sel.start}..${sel.end}: one rectangle`).toHaveLength(1);
      expect(attr(highlighted[0], 'data-active-interval')).toBe(`${sel.start}..${sel.end}`);
      expect(Number(attr(highlighted[0], 'x'))).toBeCloseTo(left(sel.start), 6);
      expect(Number(attr(highlighted[0], 'width'))).toBeCloseTo(Math.max(2, (sel.end - sel.start + 1) * PER), 6);
    }
  });

  it('the interval and the brush use the scale the ruler and pills use: the declared length, not the bases held', () => {
    const declared = docOf(SEQ100, { docMetadata: { 'Declared Length': '200' } } as Partial<SequenceDocument>);
    const svg = schematicSvg(renderView(declared, { start: 30, end: 39 }, null).html);
    const [hl] = others(svg);
    expect(Number(attr(hl, 'x'))).toBeCloseTo(left(30, W / 200), 6);
    expect(Number(attr(hl, 'width'))).toBeCloseTo(10 * (W / 200), 6);
    stubFrames();
    const fsvg = fakeSvg();
    const v = renderView(declared, null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(fsvg, mid(150, W / 200)));
      handler(d.svg, 'onPointerUp')(pev(fsvg, mid(180, W / 200)));
    });
    expect(v.selections).toEqual([{ start: 150, end: 180 }]);
  });

  it('with no selection, nothing is highlighted - the page box is gone', () => {
    const svg = schematicSvg(renderView(featureDoc, null, null).html);
    expect(others(svg)).toEqual([]);
    expect(svg).not.toContain('stroke-dasharray="3 2"');
  });

  it('an interval across a circle\'s origin is one interval drawn as its two segments', () => {
    const svg = schematicSvg(renderView(docOf(SEQ100, { topology: 'circular' }), { start: 95, end: 5 }, null).html);
    const highlighted = others(svg);
    expect(highlighted).toHaveLength(2);
    expect(highlighted.every((r) => attr(r, 'data-active-interval') === '95..5')).toBe(true);
    expect(highlighted.map((r) => [Number(attr(r, 'x')), Number(attr(r, 'width'))])).toEqual([
      [left(95), 6 * PER],
      [left(1), 5 * PER],
    ].map(([x, w]) => [expect.closeTo(x, 6), expect.closeTo(w, 6)]));
  });

  it('where the base rows start is a caret on the ruler, a point and never a range', () => {
    // Page 2 of a 3,000 bp sequence starts at base 1,201 (20 rows of 60).
    const long = docOf('ACGT'.repeat(750));
    const svg = schematicSvg(renderView(long, { start: 1300, end: 1310 }, null).html);
    const tick = /<path\b[^>]*data-page-tick="1201"[^>]*>/.exec(svg);
    expect(tick, 'the page caret is drawn at base 1,201').not.toBeNull();
    const d = attr(tick![0], 'd')!;
    const xs = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
    expect(xs[0]).toBeCloseTo(X0 + (1200 / 3000) * W, 6);
    expect(others(svg)).toHaveLength(1);
  });
});

// ═══ AC3 ═══

/**
 * The element a click at SVG point (x, y) reaches in the drawn overview: the last-painted `<rect>`
 * whose box holds the point and that takes pointer events (pointer-events not none, fill not
 * none) - the browser's hit-test over this schematic, whose clickable shapes are all rects.
 * `pill` is the 0-based index of the feature pill group (g.clickable-arc) the rect is drawn in.
 */
function hitAt(svg: string, x: number, y: number) {
  let top: { tag: string; pill: number | null; handle: string | null; fill: string | undefined } | null = null;
  const pillStack: (number | null)[] = [];
  let pills = 0;
  for (const m of svg.matchAll(/<(\/?)(g|rect)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClosing] = m;
    const tagText = `<${tag}${attrs}>`;
    if (tag === 'g') {
      if (closing) pillStack.pop();
      else if (!selfClosing) pillStack.push(/class="clickable-arc"/.test(attrs) ? pills++ : (pillStack[pillStack.length - 1] ?? null));
      continue;
    }
    if (closing) continue;
    const rx = Number(attr(tagText, 'x') ?? 0);
    const ry = Number(attr(tagText, 'y') ?? 0);
    const rw = Number(attr(tagText, 'width'));
    const rh = Number(attr(tagText, 'height'));
    if (attr(tagText, 'pointer-events') === 'none' || attr(tagText, 'fill') === 'none') continue;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
      top = { tag, pill: pillStack[pillStack.length - 1] ?? null, handle: attr(tagText, 'data-interval-handle') ?? null, fill: attr(tagText, 'fill') };
    }
  }
  return top;
}

/** pET-28a(+)-eGFP's neighbourhood of the selection edges: the T7 tag pill 5131..5163 and eGFP 5179..5898 selected. */
const T7_COLOR = '#7b61ff';
const nearEdgeDoc = docOf('ACGTTGCAAT'.repeat(606) + 'A', {
  topology: 'circular',
  features: [
    { id: 't7', name: 'T7 tag', type: 'tag', start: 5131, end: 5163, strand: 1, color: T7_COLOR },
    { id: 'egfp', name: 'eGFP', type: 'CDS', start: 5179, end: 5898, strand: 1, color: '#34a853' },
    { id: 'his', name: '6xHis', type: 'tag', start: 5893, end: 5910, strand: 1, color: '#fbbc04' },
    { id: 'kan', name: 'KanR', type: 'CDS', start: 400, end: 1200, strand: -1, color: '#ea4335' },
  ] as SequenceDocument['features'],
});
const titleOf = (props: Record<string, unknown>) =>
  ([props.children].flat(3) as { type?: unknown; props?: { children?: unknown } }[]).find((c) => c?.type === 'title')?.props?.children as string | undefined;

describe('US-01M7CCFQ AC3 feature and restriction-site clicks still select their coordinates', () => {
  it('a click on a pill near a selection edge reaches the pill, not the edge handle (drawn geometry)', () => {
    const N6061 = 6061;
    const per = W / N6061;
    const sel = { start: 5179, end: 5898 };
    stubFrames();
    const fsvg = fakeSvg();
    let hit: ReturnType<typeof hitAt> = null;
    const v = renderView(nearEdgeDoc, sel, null);
    const svg = schematicSvg(v.html);
    // The T7 tag pill: 8 units wide (its minimum), centred 1.7 units left of the start edge.
    const t7 = rectsOf(svg).find((r) => attr(r, 'fill') === T7_COLOR)!;
    const cx = Number(attr(t7, 'x')) + Number(attr(t7, 'width')) / 2;
    const cy = Number(attr(t7, 'y')) + 8;
    const startEdge = X0 + (sel.start - 1) * per;
    expect(Math.abs(cx - startEdge), 'the pill centre is inside the start handle\'s 10 px').toBeLessThan(BRUSH_HANDLE_HIT_PX / 2);
    hit = hitAt(svg, cx, cy);
    expect(hit?.handle, 'the handle is not on top of the pill').toBeNull();
    expect(hit?.pill, 'the click reaches a pill').not.toBeNull();
    expect(hit?.fill, 'the T7 tag pill').toBe(T7_COLOR);
    // The whole gesture: press and release there with no travel, then the click on what was hit.
    const run = renderView(nearEdgeDoc, sel, (d) => {
      handler(d.svg, 'onPointerDown')(pev(fsvg, cx, hit?.handle ?? null));
      handler(d.svg, 'onPointerUp')(pev(fsvg, cx, hit?.handle ?? null));
      let stopped = false;
      handler(d.svg, 'onClickCapture')({ stopPropagation: () => { stopped = true; } });
      expect(stopped).toBe(false);
      const pill = d.pills.find((p) => /^T7 tag/.test(titleOf(p) ?? ''));
      expect(pill, 'the T7 tag pill').toBeDefined();
      (pill!.onClick as () => void)();
    });
    expect(run.selections.map(({ start, end }) => ({ start, end }))).toEqual([{ start: 5131, end: 5163 }]);
  });

  it('every point of every pill, near either edge or not, reaches its pill; off the pills the edges keep their handles', () => {
    for (const sel of [{ start: 5179, end: 5898 }, { start: 5140, end: 5150 }, { start: 5160, end: 5900 }, { start: 1, end: 6061 }]) {
      const svg = schematicSvg(renderView(nearEdgeDoc, sel, null).html);
      const pills = rectsOf(svg).filter((r) => ['#7b61ff', '#34a853', '#fbbc04', '#ea4335'].includes(attr(r, 'fill') ?? ''));
      expect(pills).toHaveLength(4);
      for (const r of pills) {
        const x = Number(attr(r, 'x'));
        const y = Number(attr(r, 'y'));
        const w = Number(attr(r, 'width'));
        for (let dx = 0.25; dx < w; dx += 0.5) {
          const h = hitAt(svg, x + dx, y + 8);
          expect(h?.handle ?? null, `${sel.start}..${sel.end}: ${attr(r, 'fill')} at +${dx}`).toBeNull();
          expect(h?.pill, `${sel.start}..${sel.end}: ${attr(r, 'fill')} at +${dx}`).not.toBeNull();
        }
      }
      // In the ruler band, above the pills, each edge is still a 10-unit handle.
      // (Edges closer than one handle width share the overlap; the end handle is drawn last.)
      const sx = X0 + (sel.start - 1) * (W / 6061);
      const ex = X0 + sel.end * (W / 6061);
      for (const [edge, at] of [['start', sx], ['end', ex]] as const) {
        for (const off of [-4.9, 0, 4.9]) {
          const h = hitAt(svg, at + off, 20)?.handle;
          if (ex - sx >= BRUSH_HANDLE_HIT_PX) expect(h, `${edge} ${off}`).toBe(edge);
          else expect(h, `${edge} ${off}`).toMatch(/^(start|end)$/);
        }
      }
    }
  });

  it('a press on a pill near an edge that travels into a drag still resizes that edge', () => {
    stubFrames();
    const fsvg = fakeSvg();
    const per = W / 6061;
    const sel = { start: 5179, end: 5898 };
    const svg = schematicSvg(renderView(nearEdgeDoc, sel, null).html);
    const t7 = rectsOf(svg).find((r) => attr(r, 'fill') === T7_COLOR)!;
    const cx = Number(attr(t7, 'x')) + Number(attr(t7, 'width')) / 2;
    const v = renderView(nearEdgeDoc, sel, (d) => {
      handler(d.svg, 'onPointerDown')(pev(fsvg, cx));
      handler(d.svg, 'onPointerUp')(pev(fsvg, cx + 40 * per));
    });
    expect(v.selections).toEqual([{ start: 5219, end: 5898 }]);
  });

  it('clicking a feature pill on the overview selects the feature', () => {
    const v = renderView(featureDoc, null, (d) => {
      expect(d.pills).toHaveLength(1);
      (d.pills[0].onClick as () => void)();
    });
    expect(v.selections).toEqual([{ start: 20, end: 45, label: 'geneX (CDS: 20..45)' }]);
  });

  it('a press and release on a pill is a click: the brush selects nothing and lets the click through', () => {
    stubFrames();
    const svg = fakeSvg();
    let stopped = 0;
    const v = renderView(featureDoc, { start: 60, end: 70 }, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(30)));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(30) + 1));
      handler(d.svg, 'onClickCapture')({ stopPropagation: () => { stopped++; } });
      (d.pills[0].onClick as () => void)();
    });
    expect(stopped).toBe(0);
    expect(svg.setPointerCapture, 'a click is not captured, so it reaches the pill').not.toHaveBeenCalled();
    expect(v.selections).toEqual([{ start: 20, end: 45, label: 'geneX (CDS: 20..45)' }]);
  });

  it('a drag that starts on a pill brushes, and the click it ends with does not reach the pill', () => {
    stubFrames();
    const svg = fakeSvg();
    let stopped = 0;
    const v = renderView(featureDoc, null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(30)));
      handler(d.svg, 'onPointerUp')(pev(svg, mid(50)));
      handler(d.svg, 'onClickCapture')({ stopPropagation: () => { stopped++; } });
    });
    expect(v.selections).toEqual([{ start: 30, end: 50 }]);
    expect(stopped).toBe(1);
  });

  it('the overview draws no restriction sites; the base rows\' cut marker still selects the recognition site', () => {
    expect(schematicSvg(renderView(docOf('TTTTGAATTCTTTT'), null, null).html)).not.toMatch(/EcoRI|cut-pill/);
    const seq = 'TTTTGAATTCTTTT';
    const ecoRI = REBASE_ENZYMES.find((e) => e.name === 'EcoRI')!;
    const sites = findRestrictionCutSites(seq, 'linear', [ecoRI]);
    expect(sites).toHaveLength(1);
    const v = renderView(docOf(seq), null, (d) => {
      expect(d.cutPills.length).toBeGreaterThan(0);
      const el = { focus() {} };
      (d.cutPills[0].onClick as (e: object) => void)({ currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} });
    }, sites);
    expect(v.selections.map(({ start, end }) => ({ start, end }))).toEqual([{ start: 5, end: 10 }]);
  });
});

// ═══ AC4 ═══

describe('US-01M7CCFQ AC4 focusable 10 px edge handles, arrow keys, and pointercancel', () => {
  it('each edge answers a press within half the handle width, in screen pixels at any scale', () => {
    expect(BRUSH_HANDLE_HIT_PX).toBeGreaterThanOrEqual(8);
    const half = BRUSH_HANDLE_HIT_PX / 2;
    const cur = { start: 30, end: 59 };
    for (const unitsPerPx of [0.5, 1, 1.6, 3]) {
      const lay = layoutOf(N, unitsPerPx);
      for (const [edge, x] of [['start', left(30)], ['end', right(59)]] as const) {
        for (const off of [-(half - 0.1), -2, 0, 2, half - 0.1]) {
          expect(brushHitTest(x + off * unitsPerPx, cur, lay), `${edge} ${off}px at ${unitsPerPx}`).toEqual({ mode: 'resize', edge });
        }
      }
      expect(brushHitTest(left(30) + (half + 0.5) * unitsPerPx, cur, lay)).toEqual({ mode: 'move' });
      expect(brushHitTest(left(30) - (half + 0.5) * unitsPerPx, cur, lay)).toEqual({ mode: 'create' });
      expect(brushHitTest(right(59) + (half + 0.5) * unitsPerPx, cur, lay)).toEqual({ mode: 'create' });
    }
    expect(brushHitTest(mid(10), null, L)).toEqual({ mode: 'create' });
  });

  it('the handles are focusable sliders at least 8 px wide, naming the edge base', () => {
    const v = renderView(docOf(SEQ100), { start: 30, end: 39 }, null);
    for (const [edge, base, x] of [['start', 30, left(30)], ['end', 39, right(39)]] as const) {
      const h = v.seen.handles[edge];
      expect(h, `${edge} handle`).toBeDefined();
      expect(h.role).toBe('slider');
      expect(h.tabIndex).toBe(0);
      expect(String(h['aria-label'])).toMatch(edge === 'start' ? /start/i : /end/i);
      expect(h['aria-valuenow']).toBe(base);
      expect(h['aria-valuemin']).toBe(1);
      expect(h['aria-valuemax']).toBe(100);
      expect(Number(h.width)).toBeGreaterThanOrEqual(8);
      expect(Number(h.x) + Number(h.width) / 2).toBeCloseTo(x, 6);
    }
    expect(Object.keys(renderView(docOf(SEQ100), null, null).seen.handles), 'no selection, no handles').toEqual([]);
    expect(Object.keys(renderView(docOf(SEQ100, { topology: 'circular' }), { start: 95, end: 5 }, null).seen.handles), 'across the origin, no handles').toEqual([]);
  });

  it('arrow keys move an edge one base, Shift ten, clamped at the ends, swapping past the other edge', () => {
    const cur = { start: 30, end: 39 };
    const k = (edge: 'start' | 'end', key: string, shift = false, iv = cur) => brushKeyStep(iv, edge, key, shift, N, 'linear');
    expect(k('end', 'ArrowRight')).toEqual({ interval: { start: 30, end: 40 }, edge: 'end' });
    expect(k('end', 'ArrowUp')).toEqual({ interval: { start: 30, end: 40 }, edge: 'end' });
    expect(k('end', 'ArrowLeft')).toEqual({ interval: { start: 30, end: 38 }, edge: 'end' });
    expect(k('end', 'ArrowDown', true)).toEqual({ interval: { start: 29, end: 30 }, edge: 'start' });
    expect(k('end', 'ArrowRight', true)).toEqual({ interval: { start: 30, end: 49 }, edge: 'end' });
    expect(k('start', 'ArrowLeft')).toEqual({ interval: { start: 29, end: 39 }, edge: 'start' });
    expect(k('start', 'ArrowLeft', true)).toEqual({ interval: { start: 20, end: 39 }, edge: 'start' });
    expect(k('start', 'ArrowRight', true)).toEqual({ interval: { start: 39, end: 40 }, edge: 'end' });
    expect(k('start', 'ArrowLeft', true, { start: 5, end: 8 })).toEqual({ interval: { start: 1, end: 8 }, edge: 'start' });
    expect(k('end', 'ArrowRight', true, { start: 95, end: 98 })).toEqual({ interval: { start: 95, end: 100 }, edge: 'end' });
    expect(k('end', 'ArrowLeft', false, { start: 50, end: 50 })).toEqual({ interval: { start: 49, end: 50 }, edge: 'start' });
    expect(k('start', 'Enter')).toBeNull();
    expect(k('start', 'a')).toBeNull();
  });

  it('the view: when a key moves an edge past the other, focus moves to the handle that now carries it', () => {
    const focus = { start: vi.fn(), end: vi.fn() };
    const v = renderView(docOf(SEQ100), { start: 50, end: 50 }, (d) => {
      for (const edge of ['start', 'end'] as const) (d.handles[edge].ref as (el: unknown) => void)({ focus: focus[edge] });
      handler(d.handles.end, 'onKeyDown')({ key: 'ArrowLeft', shiftKey: false, preventDefault() {}, stopPropagation() {} });
    });
    expect(v.selections).toEqual([{ start: 49, end: 50 }]);
    expect(focus.start).toHaveBeenCalledTimes(1);
    expect(focus.end).not.toHaveBeenCalled();
    const noSwap = { start: vi.fn(), end: vi.fn() };
    renderView(docOf(SEQ100), { start: 30, end: 39 }, (d) => {
      for (const edge of ['start', 'end'] as const) (d.handles[edge].ref as (el: unknown) => void)({ focus: noSwap[edge] });
      handler(d.handles.end, 'onKeyDown')({ key: 'ArrowRight', shiftKey: false, preventDefault() {}, stopPropagation() {} });
    });
    expect(noSwap.start).not.toHaveBeenCalled();
    expect(noSwap.end).not.toHaveBeenCalled();
  });

  it('the view: an arrow key on a handle selects the moved interval and keeps the page from scrolling', () => {
    let prevented = 0;
    const key = (edge: string, k: string, shiftKey = false) => renderView(docOf(SEQ100), { start: 30, end: 39 }, (d) => {
      handler(d.handles[edge], 'onKeyDown')({ key: k, shiftKey, preventDefault: () => { prevented++; }, stopPropagation() {} });
    }).selections;
    expect(key('end', 'ArrowRight')).toEqual([{ start: 30, end: 40 }]);
    expect(key('end', 'ArrowRight', true)).toEqual([{ start: 30, end: 49 }]);
    expect(key('start', 'ArrowLeft', true)).toEqual([{ start: 20, end: 39 }]);
    expect(prevented).toBe(3);
    expect(key('start', 'Tab')).toEqual([]);
    expect(prevented).toBe(3);
  });

  it('pointercancel ends a drag and puts back the selection it started from', () => {
    expect(gesture([down(mid(10)), move(mid(30)), cancel()], null).restores).toEqual([null]);
    const cur = { start: 30, end: 39 };
    const g = gesture([down(mid(35)), move(mid(45)), cancel(), move(mid(60))], cur);
    expect(g.selects).toEqual([{ start: 40, end: 49 }]);
    expect(g.restores).toEqual([cur]);
    expect(g.drag).toEqual(BRUSH_IDLE);
    // Cancelled before it travelled: there is nothing to put back.
    expect(gesture([down(mid(35)), cancel()], cur).restores).toEqual([]);
  });

  it('the view: pointercancel clears a selection the drag made from nothing, and drops the pending frame', () => {
    const f = stubFrames();
    const svg = fakeSvg();
    const v = renderView(docOf(SEQ100), null, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(10)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(30)));
      f.flush();
      handler(d.svg, 'onPointerMove')(pev(svg, mid(50)));
      handler(d.svg, 'onPointerCancel')(pev(svg, mid(50)));
      f.flush();
      handler(d.svg, 'onPointerMove')(pev(svg, mid(70)));
      f.flush();
    });
    expect(v.selections).toEqual([{ start: 10, end: 30 }]);
    expect(v.clears).toEqual([1]);
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('the view: pointercancel puts back the selection a move started from', () => {
    const f = stubFrames();
    const svg = fakeSvg();
    const v = renderView(docOf(SEQ100), { start: 30, end: 39 }, (d) => {
      handler(d.svg, 'onPointerDown')(pev(svg, mid(35)));
      handler(d.svg, 'onPointerMove')(pev(svg, mid(45)));
      f.flush();
      handler(d.svg, 'onPointerCancel')(pev(svg, mid(45)));
    });
    expect(v.selections).toEqual([{ start: 40, end: 49 }, { start: 30, end: 39 }]);
    expect(v.clears).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// US-01M7CCJC: drag-select bases in the rows, and the overview follows the rows' scroll.
//
// A drag across the base rows is a pure reducer too (`rowDragStep`, positions read from the
// bases' data-pos); turning the page while a drag holds the pointer past the rows' top or bottom
// edge is `rowDragEdgeAction` + `rowDragEdgeBase`. The navigation rule is `selectionFollowPage`
// and the effects of the view, which are read off `useEffect` and run by hand, during the
// render, on a stand-in rows scroller - so a state update they make re-renders the view.
// ═══════════════════════════════════════════════════════════════════════════════════════════

type RowRect = [start: number, top: number, height: number];

/** A stand-in for the rows' scroll area: its box, its rows' boxes, and the listeners added to it. */
function fakeScroller(o: { width?: number; top?: number; height?: number; rows?: RowRect[]; scrollTop?: number; scrollHeight?: number } = {}) {
  const listeners: Record<string, ((e: { type: string }) => void)[]> = {};
  const top = o.top ?? 100;
  const height = o.height ?? 160;
  // Row boxes are given as they sit at scrollTop 0, and move up as the pane scrolls.
  const rowEls = (o.rows ?? []).map(([start, rowTop, h]) => {
    const at = () => rowTop - el.scrollTop;
    const strand = { getBoundingClientRect: () => ({ top: at() + 20, bottom: at() + 36 }) };
    return {
      start,
      getAttribute: (n: string) => (n === 'data-row-start' ? String(start) : null),
      getBoundingClientRect: () => ({ top: at(), bottom: at() + h }),
      querySelector: (sel: string) => (sel === '.top-strand' ? strand : null),
    };
  });
  const el = {
    clientWidth: o.width ?? 1000,
    clientHeight: height,
    scrollHeight: o.scrollHeight ?? 2000,
    scrollTop: o.scrollTop ?? 0,
    getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: o.width ?? 1000, width: o.width ?? 1000, height }),
    querySelectorAll: (sel: string) => (sel === '[data-row-start]' ? rowEls : []),
    querySelector: (sel: string) => rowEls.find((r) => sel === `[data-row-start="${r.start}"]`) ?? null,
    addEventListener: (t: string, f: (e: { type: string }) => void) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t: string, f: (e: { type: string }) => void) => { listeners[t] = (listeners[t] ?? []).filter((g) => g !== f); },
    dispatchEvent: (e: { type: string }) => { (listeners[e.type] ?? []).forEach((f) => f(e)); return true; },
    fire: (t: string) => (listeners[t] ?? []).forEach((f) => f({ type: t })),
    listening: (t: string) => (listeners[t] ?? []).length,
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    style: {} as { userSelect?: string; webkitUserSelect?: string },
    focus: vi.fn(),
  };
  return el;
}
type FakeScroller = ReturnType<typeof fakeScroller>;

/** The target of a pointer event over base `pos` (null: over a gutter, a marker, a feature bar). */
const baseTarget = (pos: number | null) => ({
  closest: (sel: string) => (sel === '[data-pos]' && pos !== null ? { getAttribute: (n: string) => (n === 'data-pos' ? String(pos) : null) } : null),
  getAttribute: () => null,
});
const rowEvent = (scroller: FakeScroller, pos: number | null, x: number, y: number) => ({
  target: baseTarget(pos), clientX: x, clientY: y, pointerId: 7, button: 0, currentTarget: scroller,
  preventDefault() {}, stopPropagation() {},
});

const SEQ3000 = 'ACGTTGCAAT'.repeat(300);
const runEffects = (effects: (() => unknown)[]) => {
  for (const effect of effects) {
    try {
      effect();
    } catch {
      // An effect for an element this harness does not stand in for.
    }
  }
};

interface RowsDrive {
  rows: Record<string, unknown>;
  effects: (() => unknown)[];
  next?: Record<string, unknown>;
  bases: Map<number, Record<string, unknown>>;
}

/**
 * Render the view; `act` runs once, inside the render, when the rows' scroller is created (after
 * the view's hooks have run, so `effects` holds the effects of this pass).
 */
function renderRows(
  doc: SequenceDocument,
  selectedRange: { start: number; end: number; label?: string } | null,
  act: ((d: RowsDrive) => void) | null,
  /** Act only on a pass that draws this base (a pass before the view has turned to its page is skipped). */
  onPassWith?: number,
  /** Runs on every later pass (a re-render the act caused), inside that render. */
  everyLaterPass?: () => void,
) {
  const selections: { start: number; end: number; label?: string }[] = [];
  let passEffects: (() => unknown)[] = [];
  let next: Record<string, unknown> | undefined;
  let bases = new Map<number, Record<string, unknown>>();
  let scrollerPasses = 0;
  let acted = false;
  probe.onEffect = (effect) => passEffects.push(effect);
  probe.onElement = (type, props) => {
    if (type === 'button' && /Next/.test(String([props.children].flat().join('')))) next = props;
    if (type === 'span' && props['data-pos'] !== undefined) bases.set(Number(props['data-pos']), props);
    if (props.className === 'sequence-blocks-scroll') {
      scrollerPasses++;
      const effects = passEffects;
      passEffects = [];
      if (!acted && act && (onPassWith === undefined || bases.has(onPassWith))) {
        acted = true;
        act({ rows: props, effects, next, bases });
      } else if (acted && everyLaterPass) {
        everyLaterPass();
      }
      bases = new Map();
    }
  };
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={[]} selectedRange={selectedRange}
      onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />,
  );
  probe.onElement = null;
  probe.onEffect = null;
  return { html, selections, scrollerPasses };
}
const attach = (d: RowsDrive, scroller: FakeScroller) => (d.rows.ref as (el: unknown) => void)(scroller);
const rowsHandler = (d: RowsDrive, name: string) => handler(d.rows, name);
/** The bases the rows draw highlighted, by their data-pos. */
const highlighted = (html: string) =>
  [...html.matchAll(/<span\b[^>]*class="[^"]*\bsel-base\b[^"]*"[^>]*>/g)].map((m) => Number(attr(m[0], 'data-pos')));
const pageTickOf = (html: string) => Number(/data-page-tick="(\d+)"/.exec(schematicSvg(html))?.[1]);
const overviewIntervalOf = (html: string) => [...new Set(rectsOf(schematicSvg(html)).map((r) => attr(r, 'data-active-interval')).filter(Boolean))];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

function rowGesture(inputs: Parameters<typeof rowDragStep>[1][], current: ActiveInterval | null = null) {
  let drag = ROW_DRAG_IDLE;
  const selects: ActiveInterval[] = [];
  const restores: (ActiveInterval | null)[] = [];
  for (const input of inputs) {
    const step = rowDragStep(drag, input, current);
    drag = step.drag;
    if (step.select) selects.push(step.select);
    if (step.cancelled) restores.push(step.cancelled.restore);
  }
  return { selects, restores, drag, last: selects[selects.length - 1] };
}
const rdown = (pos: number, x = 0, y = 0) => ({ type: 'down' as const, pos, x, y, pointerId: 7 });
const rmove = (pos: number | null, x = 40, y = 40, pointerId = 7) => ({ type: 'move' as const, pos, x, y, pointerId });
const rup = (pos: number | null, x = 40, y = 40) => ({ type: 'up' as const, pos, x, y, pointerId: 7 });

// ═══ US-01M7CCJC AC1 ═══

describe('US-01M7CCJC AC1 a drag across bases selects exactly the bases under it', () => {
  it('from the base pressed to the base under the pointer, both included, in either direction', () => {
    const at = [1, 2, 59, 60, 61, 120, 121, 1199, 1200, 1201, 2999, 3000];
    for (const a of at) for (const b of at) {
      const g = rowGesture([rdown(a), rmove(b)]);
      if (a === b) expect(g.last, `${a} -> ${b}`).toEqual({ start: a, end: a });
      else expect(g.last, `${a} -> ${b}`).toEqual({ start: Math.min(a, b), end: Math.max(a, b) });
    }
    expect(rowGesture([rdown(70), rmove(130), rmove(20), rup(20)]).selects).toEqual([{ start: 70, end: 130 }, { start: 20, end: 70 }]);
  });

  it('a press that has not travelled 3 px is a click: the drag selects nothing', () => {
    expect(BRUSH_DRAG_THRESHOLD_PX).toBe(3);
    expect(rowGesture([rdown(70, 10, 10), rmove(71, 12, 11), rup(71, 12, 12)]).selects).toEqual([]);
    expect(rowGesture([rdown(70, 10, 10), rmove(71, 13, 10)]).selects).toEqual([{ start: 70, end: 71 }]);
  });

  it('over a gutter or a marker the drag keeps its bases, and goes on over the next base', () => {
    expect(rowGesture([rdown(70), rmove(100), rmove(null), rmove(null, 90, 90), rmove(140)]).selects)
      .toEqual([{ start: 70, end: 100 }, { start: 70, end: 140 }]);
    expect(rowGesture([rdown(70), rmove(null), rup(null)]).selects).toEqual([]);
  });

  it('another pointer, or a move with no press, does nothing; pointercancel puts back the selection', () => {
    expect(rowGesture([rmove(80), rup(90)]).selects).toEqual([]);
    expect(rowGesture([rdown(70), rmove(90, 40, 40, 9)]).selects).toEqual([]);
    expect(rowGesture([rdown(70), rmove(90), { type: 'cancel', pointerId: 7 }], { start: 5, end: 9 }).restores).toEqual([{ start: 5, end: 9 }]);
    expect(rowGesture([rdown(70), rmove(90), { type: 'cancel', pointerId: 7 }]).restores).toEqual([null]);
  });

  it('held past the rows\' bottom or top edge, a drag scrolls the rows, then turns the page, then stops', () => {
    const m = (scrollTop: number) => ({ scrollTop, clientHeight: 160, scrollHeight: 1000 });
    expect(rowDragEdgeAction(m(0), 1, 0, 3)).toBe('scroll');
    expect(rowDragEdgeAction(m(839.5), 1, 0, 3)).toBe('next-page');
    expect(rowDragEdgeAction(m(840), 1, 0, 3)).toBe('next-page');
    expect(rowDragEdgeAction(m(840), 1, 2, 3)).toBe('none');
    expect(rowDragEdgeAction(m(300), -1, 1, 3)).toBe('scroll');
    expect(rowDragEdgeAction(m(0), -1, 1, 3)).toBe('previous-page');
    expect(rowDragEdgeAction(m(0), -1, 0, 3)).toBe('none');
    expect(rowDragEdgeAction(m(300), 0, 1, 3)).toBe('none');
  });

  it('at the edge the drag reaches the last base of the last row in view, or the first of the first', () => {
    // A 160 px pane at 100..260; rows of 60 bases.
    const s = fakeScroller({ rows: [[1141, -20, 92], [1161, 72, 92], [1201, 164, 92], [1261, 256, 92], [1321, 348, 92]] });
    expect(rowDragEdgeBase(s as unknown as HTMLElement, 1, 60, 3000)).toBe(1320);
    expect(rowDragEdgeBase(s as unknown as HTMLElement, -1, 60, 3000)).toBe(1161);
    const end = fakeScroller({ rows: [[2941, 120, 92]] });
    expect(rowDragEdgeBase(end as unknown as HTMLElement, 1, 60, 3000), 'clamped to the last base').toBe(3000);
    expect(rowDragEdgeBase(fakeScroller() as unknown as HTMLElement, 1, 60, 3000), 'no rows, no base').toBeNull();
  });

  it('a drag from page 1 that turns to page 2 selects across the page boundary', () => {
    // 20 rows of 60 bases a page: page 1 is 1..1200, page 2 1201..2400.
    expect(rowGesture([rdown(1150), rmove(1190), rmove(1260)]).last).toEqual({ start: 1150, end: 1260 });
    expect(rowGesture([rdown(1230), rmove(1210), rmove(1140)]).last).toEqual({ start: 1140, end: 1230 });
  });

  it('the view: a drag across rows selects its bases, captured once it travels', () => {
    for (const [a, b] of [[70, 130], [130, 70], [1, 1200], [61, 60]] as const) {
      const s = fakeScroller();
      const v = renderRows(docOf(SEQ3000), null, (d) => {
        attach(d, s);
        rowsHandler(d, 'onPointerDown')(rowEvent(s, a, 100, 100));
        expect(s.setPointerCapture, 'a press alone captures nothing').not.toHaveBeenCalled();
        rowsHandler(d, 'onPointerMove')(rowEvent(s, b, 160, 140));
        expect(s.setPointerCapture).toHaveBeenCalledWith(7);
        rowsHandler(d, 'onPointerUp')(rowEvent(s, b, 160, 140));
        expect(s.releasePointerCapture).toHaveBeenCalledWith(7);
      });
      expect(v.selections, `${a} -> ${b}`).toEqual([{ start: Math.min(a, b), end: Math.max(a, b) }]);
    }
  });

  it('a press on a base starts no native text selection, and none survives the drag (WebKit kept one before)', () => {
    const page = { removeAllRanges: vi.fn(), rangeCount: 1, isCollapsed: false };
    vi.stubGlobal('getSelection', () => page);
    const s = fakeScroller();
    let prevented = 0;
    const ev = (pos: number | null, x: number, y: number) => ({ ...rowEvent(s, pos, x, y), preventDefault: () => { prevented++; } });
    const seen: string[] = [];
    const v = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(ev(70, 100, 100));
      seen.push(`down: prevented ${prevented}, user-select ${s.style.userSelect}/${s.style.webkitUserSelect}, cleared ${page.removeAllRanges.mock.calls.length}`);
      expect(s.focus, 'the rows keep the focus a press gives them').toHaveBeenCalledWith({ preventScroll: true });
      rowsHandler(d, 'onPointerMove')(ev(130, 160, 140));
      seen.push(`move: user-select ${s.style.userSelect}, cleared ${page.removeAllRanges.mock.calls.length}`);
      rowsHandler(d, 'onPointerUp')(ev(130, 160, 140));
      seen.push(`up: user-select ${s.style.userSelect || 'auto'}/${s.style.webkitUserSelect || 'auto'}, cleared ${page.removeAllRanges.mock.calls.length}`);
    });
    expect(seen).toEqual([
      'down: prevented 1, user-select none/none, cleared 1',
      'move: user-select none, cleared 2',
      'up: user-select auto/auto, cleared 3',
    ]);
    expect(v.selections).toEqual([{ start: 70, end: 130 }]);
  });

  it('a plain click on a base clears no more than it must and lets text selection back in; a press off the bases is left alone', () => {
    const page = { removeAllRanges: vi.fn(), rangeCount: 1, isCollapsed: true };
    vi.stubGlobal('getSelection', () => page);
    const s = fakeScroller();
    let prevented = 0;
    const ev = (pos: number | null, x: number, y: number) => ({ ...rowEvent(s, pos, x, y), preventDefault: () => { prevented++; } });
    const v = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(ev(70, 100, 100));
      rowsHandler(d, 'onPointerUp')(ev(70, 101, 100));
      expect(s.style.userSelect || 'auto').toBe('auto');
      (d.bases.get(70)!.onClick as () => void)();
      rowsHandler(d, 'onPointerDown')(ev(null, 100, 100));
      // A press the drag cannot use (no finite position) holds no text selection back.
      rowsHandler(d, 'onPointerDown')(ev(70, Number.NaN, 100));
      expect(s.style.userSelect || 'auto').toBe('auto');
    });
    expect(prevented, 'only the presses on a base').toBe(2);
    expect(page.removeAllRanges, 'a collapsed caret is not a selection to clear').not.toHaveBeenCalled();
    expect(v.selections).toEqual([{ start: 70, end: 89 }]);
    expect(s.style.userSelect || 'auto').toBe('auto');
  });

  it('clearNativeTextSelection drops a real selection, leaves a caret, and does nothing where there is no page', () => {
    const range = { removeAllRanges: vi.fn(), rangeCount: 1, isCollapsed: false };
    vi.stubGlobal('getSelection', () => range);
    clearNativeTextSelection();
    expect(range.removeAllRanges).toHaveBeenCalledTimes(1);
    vi.stubGlobal('getSelection', () => ({ ...range, rangeCount: 0, removeAllRanges: vi.fn() }));
    expect(() => clearNativeTextSelection()).not.toThrow();
    vi.stubGlobal('getSelection', undefined);
    expect(() => clearNativeTextSelection()).not.toThrow();
  });

  it('held past the bottom of the last page with nothing left to scroll, the drag reaches the last base shown', () => {
    vi.useFakeTimers();
    try {
      // The last page (2401..3000), scrolled to its end: the row 2941..3000 is the last in view.
      const s = fakeScroller({ rows: [[2881, 30, 92], [2941, 122, 92]], scrollHeight: 160 });
      const v = renderRows(docOf(SEQ3000), { start: 2950, end: 2950 }, (d) => {
        attach(d, s);
        rowsHandler(d, 'onPointerDown')(rowEvent(s, 2950, 100, 150));
        rowsHandler(d, 'onPointerMove')(rowEvent(s, null, 100, 300));
      }, 2950);
      expect(v.selections, 'over no base: nothing yet').toEqual([]);
      vi.advanceTimersByTime(260);
      expect(v.selections).toEqual([{ start: 2950, end: 3000 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the view: a plain click on a base keeps today\'s 20-base selection, and a drag swallows its own click', () => {
    let stopped = 0;
    const s = fakeScroller();
    const click = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(rowEvent(s, 70, 100, 100));
      rowsHandler(d, 'onPointerUp')(rowEvent(s, 70, 101, 101));
      rowsHandler(d, 'onClickCapture')({ stopPropagation: () => { stopped++; } });
      (d.bases.get(70)!.onClick as () => void)();
    });
    expect(stopped).toBe(0);
    expect(click.selections).toEqual([{ start: 70, end: 89 }]);
    const drag = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(rowEvent(s, 70, 100, 100));
      rowsHandler(d, 'onPointerMove')(rowEvent(s, 75, 140, 100));
      rowsHandler(d, 'onPointerUp')(rowEvent(s, 70, 100, 100));
      rowsHandler(d, 'onClickCapture')({ stopPropagation: () => { stopped++; } });
    });
    expect(drag.selections).toEqual([{ start: 70, end: 75 }, { start: 70, end: 70 }]);
    expect(stopped).toBe(1);
  });

  // BG-01M7CMT6: the first selection a drag made changed what the quickbar above the rows read, and
  // with it the bar's height (none -> 36 px, or 61 px when a long readout wrapped to two lines), and
  // the construct cockpit's selection row wrapped the same way; the rows moved 26-58 px under a
  // pointer that had not moved, so the rest of the drag read the bases of another line. Two wrong
  // implementations are named here: a bar whose height still follows what it reads (drawn only
  // with a selection, or free to wrap), and a drag that maps the pointer through where the rows
  // were at the press rather than where they are drawn now.
  it('the quickbar holds one fixed height whatever a drag makes it read, drawn with or without a selection (BG-01M7CMT6)', () => {
    const doc = docOf('ACGTTGCAAT'.repeat(607), {
      features: [{ id: 'egfp', name: 'eGFP', type: 'CDS', start: 5179, end: 5898, strand: 1, color: FEATURE_COLOR }] as SequenceDocument['features'],
    });
    // The selections a drag from 5164 makes as it travels to 5199, its content changing mid-drag.
    const s = fakeScroller();
    const dragged = renderRows(doc, { start: 5179, end: 5898, label: 'eGFP (CDS)' }, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(rowEvent(s, 5164, 100, 100));
      for (const [pos, x] of [[5168, 140], [5175, 210], [5199, 450]] as const) rowsHandler(d, 'onPointerMove')(rowEvent(s, pos, x, 100));
      rowsHandler(d, 'onPointerUp')(rowEvent(s, 5199, 450, 100));
    }).selections;
    expect(dragged.map((r) => `${r.start}..${r.end}`)).toEqual(['5164..5168', '5164..5175', '5164..5199']);
    const states: ({ start: number; end: number; label?: string } | null)[] = [
      null, // before the drag's first selection: the slot is already there
      { start: 5179, end: 5898, label: 'eGFP (CDS)' }, // the 2-line readout of the review
      ...dragged,
      { start: 1, end: 6070 },
    ];
    for (const sel of states) {
      const slots: Record<string, unknown>[] = [];
      probe.onElement = (type, props) => {
        if (type === 'div' && /(^|\s)seq-selection-quickbar(\s|$)/.test(String(props.className ?? ''))) slots.push(props);
      };
      const html = renderToStaticMarkup(
        <LinearSequenceView doc={doc} cutSites={[]} selectedRange={sel} onSelectRange={() => {}} onUpdateDocument={() => {}}
          onClearSelection={() => {}} onExtractSelection={() => {}} onConvertSelectionToOligo={() => {}} />,
      );
      probe.onElement = null;
      const what = sel ? `${sel.label ?? ''} ${sel.start}..${sel.end}` : 'no selection';
      // One slot a pass (a pass that turns to the selection's page renders the view again).
      expect(slots.length, `${what}: a quickbar slot above the rows`).toBeGreaterThan(0);
      const slot = slots[slots.length - 1];
      expect(new Set(slots.map((p) => p.style)).size, `${what}: the same slot on every pass`).toBe(1);
      const style = slot.style as React.CSSProperties;
      expect(style, `${what}: the one slot style`).toEqual(SELECTION_QUICKBAR_SLOT_STYLE);
      expect([style.height, style.minHeight, style.maxHeight], `${what}: a fixed height`).toEqual([
        SELECTION_QUICKBAR_HEIGHT_PX, SELECTION_QUICKBAR_HEIGHT_PX, SELECTION_QUICKBAR_HEIGHT_PX,
      ]);
      expect([style.flexWrap, style.overflow, style.flex, style.boxSizing], `${what}: one line that neither wraps nor grows`).toEqual([
        'nowrap', 'hidden', '0 0 auto', 'border-box',
      ]);
      if (sel) {
        // The readout may be cut short on screen; the bar's title gives it whole.
        const summary = /<div class="seq-selection-quickbar-summary">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
        // The range and its composition are set apart on screen by a margin, in the title by a space.
        const words = summary.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/strong>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        expect(words, `${what}: the readout`).toMatch(/\d\.\.\d/);
        expect(slot.title, `${what}: the whole readout in the title`).toBe(words);
      }
    }
  });

  it('the readouts above the rows keep fixed heights: the quickbar one line cut short, the cockpit two lines from the top (BG-01M7CMT6)', () => {
    const css = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const decls = (selector: string) => {
      const found: Record<string, string> = {};
      const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const m of css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
        for (const d of m[1].split(';')) {
          const i = d.indexOf(':');
          if (i > 0) found[d.slice(0, i).trim()] = d.slice(i + 1).trim();
        }
      }
      expect(Object.keys(found).length, `a ${selector} rule in App.css`).toBeGreaterThan(0);
      return found;
    };
    const summary = decls('.seq-selection-quickbar-summary');
    expect([summary['white-space'], summary['text-overflow'], summary.overflow, summary['min-width']]).toEqual(['nowrap', 'ellipsis', 'hidden', '0']);
    const actions = decls('.seq-selection-quickbar-actions');
    // The actions never wrap and never scroll sideways: what does not fit goes to the More menu.
    expect([actions['flex-wrap'], actions.overflow, actions['overflow-x']]).toEqual(['nowrap', 'hidden', undefined]);
    // The cockpit's selection row keeps the two lines a long readout took, whatever it reads.
    const cockpit = decls('.mbc-cockpit-row-bottom');
    expect(cockpit['block-size'], 'the cockpit selection row has a fixed height').toMatch(/^\d+px$/);
    expect(cockpit['min-block-size']).toBe(cockpit['block-size']);
    expect(parseInt(cockpit['block-size'], 10), 'two lines of 24 px controls').toBeGreaterThanOrEqual(2 * 24 + 8);
    expect(cockpit['overflow-y'], 'more than two lines scrolls inside it').toBe('auto');
    // Its lines start at the row's top: centred lines taller than the row were pushed above it,
    // where no scroll reaches (the selection and its Reset, at 1440x900).
    expect(cockpit['flex-wrap'], 'a row of lines, which align-content places').toBe('wrap');
    expect(['flex-start', 'start', 'safe center'], 'the first line at the top of the row').toContain(cockpit['align-content']);
  });

  // BG-01M7CMT6 round 3: the one-line quickbar hid its last actions behind a sideways scroll. The
  // wrong implementations named: an action that is neither inline nor in the More menu (or in
  // both), a fit that overruns the line or leaves out an action that fits, and a More button
  // without menu semantics or keys.
  const SIX = ["Copy 5'→3'", 'Copy RevComp', '+ Annotate', 'Extract Region', '+ Save Oligo', 'Clear'];
  const sixActions = (ran: string[] = []) =>
    SIX.map((label, i) => ({ key: `k${i}`, label, title: `${label} title`, run: () => ran.push(label) }));
  const WIDTHS = [78, 98, 80, 102, 92, 46];

  it('the actions that fit the line are inline, the rest go to More, and the fit is the largest that fits (BG-01M7CMT6)', () => {
    const span = (n: number) => WIDTHS.slice(0, n).reduce((a, w) => a + w, 0) + Math.max(0, n - 1) * QUICKBAR_ACTION_GAP_PX;
    for (let available = 0; available <= 620; available++) {
      const n = quickbarInlineCount(WIDTHS, available, 60);
      const used = span(n) + (n < WIDTHS.length ? (n > 0 ? QUICKBAR_ACTION_GAP_PX : 0) + 60 : 0);
      if (n === WIDTHS.length) expect(span(n), `${available}: all inline fit`).toBeLessThanOrEqual(available);
      else if (n > 0) expect(used, `${available}: ${n} inline and More fit`).toBeLessThanOrEqual(available);
      if (n < WIDTHS.length && span(WIDTHS.length) <= available) throw new Error(`${available}: all fit, yet ${n} inline`);
      if (n < WIDTHS.length - 1) {
        expect(span(n + 1) + QUICKBAR_ACTION_GAP_PX + 60, `${available}: one more would not fit`).toBeGreaterThan(available);
      }
    }
    expect(quickbarInlineCount(WIDTHS, 1000, 60)).toBe(6);
    expect(quickbarInlineCount(WIDTHS, span(6), 60), 'exactly the width of all six').toBe(6);
    expect(quickbarInlineCount(WIDTHS, span(6) - 1, 60), 'a pixel short: Clear goes to More').toBeLessThan(6);
    expect(quickbarInlineCount(WIDTHS, Number.NaN, 60)).toBe(0);
  });

  it('every action is reachable once, inline or as a labelled item of the More menu, at every fit (BG-01M7CMT6)', () => {
    for (let n = 0; n <= SIX.length; n++) {
      const ran: string[] = [];
      const buttons: Record<string, unknown>[] = [];
      let menu: Record<string, unknown> | null = null;
      probe.onElement = (type, props) => {
        if (type === 'button') buttons.push(props);
        if (props.role === 'menu') menu = props;
      };
      const html = renderToStaticMarkup(
        <QuickbarActionStrip actions={sixActions(ran)} inlineCount={n} menuOpen menuId="qb-menu" onItem={(a) => a.run()} />,
      );
      probe.onElement = null;
      const label = (b: Record<string, unknown>) => [b.children].flat().join('');
      const inline = buttons.filter((b) => b.role !== 'menuitem' && b['aria-haspopup'] === undefined);
      const items = buttons.filter((b) => b.role === 'menuitem');
      const more = buttons.filter((b) => b['aria-haspopup'] === 'menu');
      expect(inline.map(label), `${n} inline`).toEqual(SIX.slice(0, n));
      expect(items.map(label), `${n} inline: the rest in More`).toEqual(SIX.slice(n));
      expect([...inline, ...items].map(label).sort(), `${n} inline: each action once`).toEqual([...SIX].sort());
      if (n === SIX.length) {
        expect(more, 'all inline: no More').toHaveLength(0);
        expect(menu).toBeNull();
      } else {
        expect(more, `${n} inline: one More button`).toHaveLength(1);
        expect(more[0]['aria-expanded']).toBe(true);
        expect(more[0]['aria-controls']).toBe('qb-menu');
        expect(String(more[0]['aria-label'])).toMatch(/^More selection actions/);
        expect(menu).not.toBeNull();
        expect(menu!.id).toBe('qb-menu');
        expect(menu!['aria-label']).toBe('More selection actions');
        for (const it of items) expect(it.title, `${label(it)} has its title`).toBe(`${label(it)} title`);
        // Each item runs its own action.
        for (const it of items) (it.onClick as () => void)();
        expect(ran).toEqual(SIX.slice(n));
      }
      // Inline buttons run their own action too.
      ran.length = 0;
      for (const b of inline) (b.onClick as () => void)();
      expect(ran, `${n} inline: each runs its own action`).toEqual(SIX.slice(0, n));
      expect(html.match(/role="menuitem"/g)?.length ?? 0).toBe(SIX.length - n);
    }
  });

  it('the More menu answers the keys of a menu: arrows cycle, Home and End jump, Escape and Tab close (BG-01M7CMT6)', () => {
    expect(quickbarMenuKey('ArrowDown', 0, 3)).toEqual({ focus: 1 });
    expect(quickbarMenuKey('ArrowDown', 2, 3)).toEqual({ focus: 0 });
    expect(quickbarMenuKey('ArrowUp', 0, 3)).toEqual({ focus: 2 });
    expect(quickbarMenuKey('Home', 2, 3)).toEqual({ focus: 0 });
    expect(quickbarMenuKey('End', 0, 3)).toEqual({ focus: 2 });
    expect(quickbarMenuKey('Escape', 1, 3)).toEqual({ close: true });
    expect(quickbarMenuKey('Tab', 1, 3)).toEqual({ close: true });
    expect(quickbarMenuKey('a', 1, 3)).toBeNull();
  });

  it('the view: the quickbar offers every action it has, keeps its height whichever it has, and describes its whole readout (BG-01M7CMT6)', () => {
    const doc = docOf('ACGTTGCAAT'.repeat(607));
    for (const extra of [{}, { onExtractSelection: () => {}, onConvertSelectionToOligo: () => {}, onClearSelection: () => {} }]) {
      for (const sel of [{ start: 100, end: 135, label: 'Oligo Candidate' }, { start: 5164, end: 5168 }]) {
        let slot: Record<string, unknown> | null = null;
        let inline: Record<string, unknown>[] = [];
        let lastPass: Record<string, unknown>[] = [];
        probe.onElement = (type, props) => {
          if (type === 'div' && /(^|\s)seq-selection-quickbar(\s|$)/.test(String(props.className ?? ''))) {
            // A bar's buttons are made before the bar itself: these are this pass's.
            slot = props;
            lastPass = inline;
            inline = [];
          }
          // Before the strip is measured every action is inline (a narrow strip then moves the rest to More).
          if (type === 'button' && props.className === 'seq-quick-pill-btn') inline.push(props);
        };
        const html = renderToStaticMarkup(
          <LinearSequenceView doc={doc} cutSites={[]} selectedRange={sel} onSelectRange={() => {}} onUpdateDocument={() => {}} {...extra} />,
        );
        probe.onElement = null;
        expect(slot!.style, 'the one fixed slot, whatever actions it has').toEqual(SELECTION_QUICKBAR_SLOT_STYLE);
        const actions = lastPass.map((b) => [b.children].flat().join(''));
        const want = ["Copy 5'→3'", 'Copy RevComp', '+ Annotate'];
        if ('onExtractSelection' in extra) want.push('Extract Region');
        if ('onConvertSelectionToOligo' in extra && sel.end - sel.start + 1 >= 12) want.push('+ Save Oligo');
        if ('onClearSelection' in extra) want.push('Clear');
        expect(actions).toEqual(want);
        // The readout is described in full: the bar names a node that holds the whole of it.
        const id = String(slot!['aria-describedby']);
        const described = new RegExp(`<span id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)</span>`).exec(html)?.[1];
        expect(described, 'the description node').toBeDefined();
        expect(described!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')).toBe(slot!.title);
      }
    }
  });

  it('the drag reads the base under the pointer from the rows as drawn at each event, not where they were at the press (BG-01M7CMT6)', () => {
    // Rows of 60 bases, 40 px high, 10 px a base, their first row's top at `layout.top`.
    const layout = { top: 100 };
    const baseAtPoint = (x: number, y: number) => {
      const row = Math.floor((y - layout.top) / 40);
      const col = Math.floor(x / 10);
      return row >= 0 && col >= 0 && col < 60 ? row * 60 + col + 1 : null;
    };
    const elementFromPoint = vi.fn((x: number, y: number) => baseTarget(baseAtPoint(x, y)));
    // The scroller's box moves with its rows, as it did when the bar above it changed height.
    const s = Object.assign(fakeScroller(), {
      getBoundingClientRect: () => ({ top: layout.top, bottom: layout.top + 160, left: 0, right: 1000, width: 1000, height: 160 }),
    });
    const v = renderRows(docOf(SEQ3000), null, (d) => {
      vi.stubGlobal('document', { elementFromPoint });
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(rowEvent(s, baseAtPoint(95, 115), 95, 115)); // base 10
      // Captured, the events' target is the rows' scroller, never a base: only the point says which.
      layout.top = 158; // the rows moved 58 px down under the pointer
      rowsHandler(d, 'onPointerMove')(rowEvent(s, null, 305, 195)); // drawn now: row 0, base 31 (at the press: 151)
      layout.top = 42; // and back up past where they were
      rowsHandler(d, 'onPointerMove')(rowEvent(s, null, 205, 175)); // drawn now: row 3, base 201 (at the press: 141)
      rowsHandler(d, 'onPointerUp')(rowEvent(s, null, 205, 175));
    });
    expect(v.selections.map((r) => `${r.start}..${r.end}`)).toEqual(['10..31', '10..201']);
    expect(elementFromPoint.mock.calls, 'each event is read at its own point').toEqual([[95, 115], [305, 195], [205, 175], [205, 175]]);
  });

  it('the overview and the rows show the interval a drag selected, base for base', () => {
    for (const sel of [{ start: 70, end: 130 }, { start: 1, end: 1 }, { start: 1150, end: 1200 }]) {
      const { html } = renderRows(docOf(SEQ3000), sel, null);
      expect(overviewIntervalOf(html)).toEqual([`${sel.start}..${sel.end}`]);
      expect(highlighted(html)).toEqual(range(sel.start, sel.end));
    }
  });
});

// ═══ US-01M7CCJC AC2 ═══

describe('US-01M7CCJC AC2 the navigation rule: edits win while dragged, scroll moves only the marker', () => {
  it('a new selection brings its page, except while a drag in the rows is making it', () => {
    expect(selectionFollowPage(3, 0, false)).toBe(3);
    expect(selectionFollowPage(3, 0, true)).toBe(0);
    expect(selectionFollowPage(null, 2, false)).toBe(2);
    expect(selectionFollowPage(0, 2, false)).toBe(0);
  });

  it('first visible row: the first whose box reaches below the pane\'s top', () => {
    const s = fakeScroller({ rows: [[1, 100, 92], [61, 192, 92], [121, 284, 92], [181, 376, 92]], scrollTop: 200 });
    expect(firstVisibleRowStart(s as unknown as HTMLElement)).toBe(121);
    expect(firstVisibleRowStart(fakeScroller({ rows: [[1, 100, 92]] }) as unknown as HTMLElement)).toBe(1);
    expect(firstVisibleRowStart(fakeScroller() as unknown as HTMLElement)).toBeNull();
  });

  it('a manual scroll of the rows moves the overview\'s marker once it settles, and selects nothing', () => {
    const rows: RowRect[] = [[1, 100, 92], [61, 192, 92], [121, 284, 92], [181, 376, 92]];
    const s = fakeScroller({ rows });
    const before = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      runEffects(d.effects);
      s.scrollTop = 200; // the reader scrolls the rows
      s.fire('scroll');
    });
    expect(pageTickOf(before.html), 'not settled: the marker stays').toBe(1);
    const t = fakeScroller({ rows });
    const settled = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, t);
      runEffects(d.effects);
      t.scrollTop = 200;
      expect(t.listening('scrollend'), 'the view listens for the scroll to settle').toBeGreaterThan(0);
      t.fire('scrollend');
    });
    expect(pageTickOf(settled.html)).toBe(121);
    expect(settled.selections).toEqual([]);
    expect(overviewIntervalOf(settled.html)).toEqual([]);
  });

  it('a settled scroll that lands where the marker already is re-renders nothing (no update loop)', () => {
    // Each re-render the settle causes sees the scroll settle again at the same row: without the
    // unchanged-row guard that is a render loop (React stops it with "Too many re-renders").
    const s = fakeScroller({ rows: [[1, 100, 92], [61, 192, 92], [121, 284, 92]] });
    const v = renderRows(docOf(SEQ3000), null, (d) => {
      attach(d, s);
      runEffects(d.effects);
      s.scrollTop = 200;
      s.fire('scrollend');
    }, undefined, () => s.fire('scrollend'));
    expect(pageTickOf(v.html)).toBe(121);
    expect(v.scrollerPasses, 'one re-render for the settle, then quiet').toBeLessThanOrEqual(4);
    expect(v.selections).toEqual([]);
  });

  it('the scroll a new selection causes moves the marker and never re-selects', () => {
    vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '0px', paddingLeft: '0px', paddingRight: '0px' }));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // The selection's row (1261, on page 2) is below the pane: the view scrolls it up.
    const s = fakeScroller({ rows: [[1201, 40, 92], [1261, 400, 92]], scrollTop: 0 });
    const v = renderRows(docOf(SEQ3000), { start: 1300, end: 1310 }, (d) => {
      attach(d, s);
      runEffects(d.effects);
      expect(s.scrollTop, 'the selection scrolled the rows').toBe(300);
      s.fire('scrollend');
    }, 1300);
    expect(v.selections).toEqual([]);
    expect(pageTickOf(v.html), 'the marker is where the rows now start').toBe(1261);
    expect(overviewIntervalOf(v.html)).toEqual(['1300..1310']);
  });

  it('while a drag in the rows is selecting, the selection does not scroll the rows', () => {
    vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '0px', paddingLeft: '0px', paddingRight: '0px' }));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const rows: RowRect[] = [[1201, 40, 92], [1261, 400, 92]];
    const control = fakeScroller({ rows });
    renderRows(docOf(SEQ3000), { start: 1300, end: 1310 }, (d) => {
      attach(d, control);
      runEffects(d.effects);
    }, 1300);
    expect(control.scrollTop, 'no drag: the selection is revealed').toBe(300);
    const s = fakeScroller({ rows });
    const v = renderRows(docOf(SEQ3000), { start: 1300, end: 1310 }, (d) => {
      attach(d, s);
      rowsHandler(d, 'onPointerDown')(rowEvent(s, 1230, 100, 100));
      rowsHandler(d, 'onPointerMove')(rowEvent(s, 1215, 60, 100));
      runEffects(d.effects);
    }, 1300);
    expect(s.scrollTop, 'the drag owns the view').toBe(0);
    expect(v.selections).toEqual([{ start: 1215, end: 1230 }]);
  });
});

// ═══ US-01M7CCJC AC3 ═══

describe('US-01M7CCJC AC3 the selection survives a bases-per-row change and a page change', () => {
  it('rows reflowed from 60 to 40 bases keep the same start and end, in the rows and on the overview', () => {
    for (const sel of [{ start: 70, end: 130 }, { start: 1, end: 1 }, { start: 1190, end: 1210 }]) {
      const v = renderRows(docOf(SEQ3000), sel, (d) => attach(d, fakeScroller({ width: 470 })));
      const page = Math.floor((sel.start - 1) / 40 / 20);
      const pageFirst = page * 800 + 1;
      expect(v.html, 'the rows hold 40 bases now').toContain(`data-row-start="${pageFirst + 40}"`);
      expect(v.html).not.toContain(`data-row-start="${pageFirst + 60}"`);
      expect(v.selections, 'nothing re-selected').toEqual([]);
      expect(overviewIntervalOf(v.html)).toEqual([`${sel.start}..${sel.end}`]);
      expect(highlighted(v.html)).toEqual(range(Math.max(sel.start, pageFirst), Math.min(sel.end, pageFirst + 799)));
    }
  });

  it('turning the page keeps the selection: the next page highlights its part, the overview the whole', () => {
    const sel = { start: 1150, end: 1250 };
    const v = renderRows(docOf(SEQ3000), sel, (d) => {
      expect(d.next, 'the Next button').toBeDefined();
      (d.next!.onClick as () => void)();
    });
    expect(v.html).toContain('data-row-start="1201"');
    expect(v.html).not.toContain('data-row-start="1141"');
    expect(v.selections).toEqual([]);
    expect(overviewIntervalOf(v.html)).toEqual(['1150..1250']);
    expect(highlighted(v.html)).toEqual(range(1201, 1250));
    expect(pageTickOf(v.html)).toBe(1201);
  });
});

// ═══ US-01M7CCJC AC4 ═══

describe('US-01M7CCJC AC4 the circular map draws the same interval as the overview and the rows', () => {
  const CX = 340;
  const CY = 270;
  const R_OUT = 166;
  const R_IN = 126;
  const polar = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  };
  const circularSector = (doc: SequenceDocument, sel: { start: number; end: number }) => {
    const html = renderToStaticMarkup(
      <CircularPlasmidMap doc={doc} cutSites={[]} orfs={[]} selectedRange={sel} onSelectRange={() => {}}
        showOrfs={false} showPrimers={false} showUniqueCuttersOnly={false} zoomLevel={100} onZoomChange={() => {}} />,
    );
    const paths = html.match(/<path\b[^>]*data-active-interval="[^"]*"[^>]*>/g) ?? [];
    return paths;
  };

  it('every interval the views can emit: the same bases, at the same fraction of the molecule', () => {
    const doc = docOf(SEQ100, { topology: 'circular' });
    for (const sel of [{ start: 1, end: 1 }, { start: 100, end: 100 }, { start: 1, end: 100 }, { start: 30, end: 39 }, { start: 61, end: 80 }, { start: 1, end: 50 }, { start: 51, end: 100 }]) {
      const paths = circularSector(doc, sel);
      expect(paths, `${sel.start}..${sel.end}: one sector`).toHaveLength(1);
      const p = paths[0]!;
      expect(attr(p, 'data-active-interval')).toBe(`${sel.start}..${sel.end}`);
      const a0 = Number(attr(p, 'data-start-angle'));
      const a1 = Number(attr(p, 'data-end-angle'));
      expect(a0).toBeCloseTo(((sel.start - 1) / 100) * 360, 6);
      expect(a1).toBeCloseTo((sel.end / 100) * 360, 6);
      // The overview: the same bases, at the same fraction of its width.
      const { html } = renderRows(doc, sel, null);
      const hl = rectsOf(schematicSvg(html)).filter((r) => attr(r, 'data-active-interval'))[0]!;
      expect(attr(hl, 'data-active-interval')).toBe(`${sel.start}..${sel.end}`);
      expect(((Number(attr(hl, 'x')) - X0) / W) * 360).toBeCloseTo(a0, 6);
      if (sel.end - sel.start + 1 >= 1) expect(highlighted(html)).toEqual(range(sel.start, sel.end));
    }
  });

  it('the sector is the plain arc from the start angle to the end angle, with no arrowhead bevel', () => {
    const doc = docOf(SEQ100, { topology: 'circular' });
    for (const sel of [{ start: 30, end: 39 }, { start: 61, end: 80 }, { start: 1, end: 50 }]) {
      const d = attr(circularSector(doc, sel)[0]!, 'd')!;
      const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
      const [mx, my] = nums;
      const [sx, sy] = polar(R_OUT, ((sel.start - 1) / 100) * 360);
      expect(mx).toBeCloseTo(sx, 1);
      expect(my).toBeCloseTo(sy, 1);
      // The outer arc ends at the end angle: `A r r 0 large 1 x y`.
      const [ex, ey] = polar(R_OUT, (sel.end / 100) * 360);
      expect(nums[7]).toBeCloseTo(ex, 1);
      expect(nums[8]).toBeCloseTo(ey, 1);
      // Then down to the inner radius at the same angle.
      const [ix, iy] = polar(R_IN, (sel.end / 100) * 360);
      expect(nums[9]).toBeCloseTo(ix, 1);
      expect(nums[10]).toBeCloseTo(iy, 1);
    }
  });

  it('a 1-bp interval of a long molecule is a 0.5-degree sector, and the last base\'s ends at twelve o\'clock, not past it', () => {
    const long = docOf('ACGTTGCAAT'.repeat(606) + 'A', { topology: 'circular' }); // 6,061 bp: a base is 0.059 degrees
    const degOf = (x: number, y: number) => ((((Math.atan2(y - CY, x - CX) * 180) / Math.PI + 90) % 360) + 360) % 360;
    const sector = (b: number) => {
      const nums = [...attr(circularSector(long, { start: b, end: b })[0]!, 'd')!.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
      const a0 = degOf(nums[0], nums[1]);
      const a1 = degOf(nums[7], nums[8]);
      return { a0, a1, span: (((a1 - a0) % 360) + 360) % 360 };
    };
    const first = sector(1);
    expect(first.a0).toBeCloseTo(0, 1);
    expect(first.span).toBeCloseTo(0.5, 1);
    const mid = sector(3000);
    expect(mid.a0).toBeCloseTo((2999 / 6061) * 360, 1);
    expect(mid.span).toBeCloseTo(0.5, 1);
    const last = sector(6061);
    expect(last.span).toBeCloseTo(0.5, 1);
    expect(last.a1 === 0 || last.a1 > 359.99, `ends at twelve o'clock, got ${last.a1}`).toBe(true);
    expect(last.a0).toBeCloseTo(359.5, 1);
  });

  it('the whole molecule is a full ring, and a 1-bp interval is still drawn', () => {
    const doc = docOf(SEQ100, { topology: 'circular' });
    const whole = attr(circularSector(doc, { start: 1, end: 100 })[0]!, 'd')!;
    expect(whole).not.toMatch(/NaN/);
    expect(whole.match(/A /g)?.length, 'two half-turns on each radius').toBe(4);
    const one = attr(circularSector(doc, { start: 100, end: 100 })[0]!, 'd')!;
    expect(one).not.toMatch(/NaN/);
    expect(one.length).toBeGreaterThan(20);
  });
});
