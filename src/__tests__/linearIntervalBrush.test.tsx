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
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));

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
} = await import('../components/LinearSequenceView');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SequenceDocument = import('../types/bio').SequenceDocument;
type ActiveInterval = import('../types/bio').ActiveInterval;
type BrushDrag = import('../components/LinearSequenceView').BrushDrag;
type BrushLayout = import('../components/LinearSequenceView').BrushLayout;
type BrushInput = import('../components/LinearSequenceView').BrushInput;

afterEach(() => {
  probe.onElement = null;
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

describe('US-01M7CCFQ AC3 feature and restriction-site clicks still select their coordinates', () => {
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

  it('clicking a restriction marker of the linear map selects the recognition site', () => {
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
