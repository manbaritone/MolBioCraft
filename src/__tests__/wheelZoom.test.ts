// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCDR: one wheel-zoom helper the scientific views share. It turns a wheel event's deltas
 * into pixels whatever the event's delta mode, moves a scale multiplicatively inside its bounds,
 * decides whether a wheel gesture zooms or scrolls the surface under it, and returns the pan offset
 * that keeps the point under the pointer where it was.
 *
 * The wrong implementations each test is written to fail on: a line- or page-mode delta read as
 * pixels (AC1); a zero, NaN or infinite delta that moves anything (AC1, AC2); an additive step in
 * place of a multiplicative one, a step rounded to whole units, a delta sign read backwards (AC2);
 * a horizontal wheel that zooms, Alt read as zoom on a scroll surface (AC3); the anchor's content
 * point computed with the new scale instead of the old one (AC4).
 */

import { describe, expect, it } from 'vitest';
import {
  WHEEL_LINE_PX,
  WHEEL_MAX_DELTA_PX,
  WHEEL_NOTCH_PX,
  WHEEL_PAGE_PX,
  WHEEL_ZOOM_IN_PER_NOTCH,
  anchoredOffset,
  classifyWheelGesture,
  normalizeWheelDelta,
  wheelZoomScale,
  zoomAnchorPoint,
} from '../core/wheelZoom';
import { SEQUENCE_ZOOM_MAX, SEQUENCE_ZOOM_MIN, clampSequenceZoom, wheelSequenceZoom } from '../components/CircularPlasmidMap';

const PIXEL = 0;
const LINE = 1;
const PAGE = 2;

describe('US-01M7CCDR AC1 wheel deltas normalize to pixels', () => {
  it('converts pixel, line and page modes with the documented sizes', () => {
    expect([WHEEL_LINE_PX, WHEEL_PAGE_PX, WHEEL_MAX_DELTA_PX]).toEqual([16, 800, 400]);
    // Magnitudes below the burst limit in every mode, both signs, both axes.
    const cases: [number, number, number][] = [
      // [deltaMode, raw, expected px]
      [PIXEL, 1, 1],
      [PIXEL, 4.5, 4.5],
      [PIXEL, 100, 100],
      [PIXEL, -53, -53],
      [LINE, 1, 16],
      [LINE, 3, 48],
      [LINE, -3, -48],
      [LINE, 0.5, 8],
      [LINE, 20, 320],
      [PAGE, 0.25, 200],
      [PAGE, -0.1, -80],
      [PAGE, 0.5, 400],
    ];
    for (const [deltaMode, raw, px] of cases) {
      expect(normalizeWheelDelta({ deltaX: 0, deltaY: raw, deltaMode }), `mode ${deltaMode} y ${raw}`).toEqual({ x: 0, y: px });
      expect(normalizeWheelDelta({ deltaX: raw, deltaY: 0, deltaMode }), `mode ${deltaMode} x ${raw}`).toEqual({ x: px, y: 0 });
    }
    // Three lines and 48 pixels are the same gesture; three lines are not three pixels.
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: LINE })).toEqual(normalizeWheelDelta({ deltaX: 0, deltaY: 48, deltaMode: PIXEL }));
    // A missing mode is the DOM default, pixels.
    expect(normalizeWheelDelta({ deltaX: 2, deltaY: -7 })).toEqual({ x: 2, y: -7 });
  });

  it('ignores zero, NaN and infinite deltas and an unknown mode', () => {
    for (const deltaMode of [PIXEL, LINE, PAGE]) {
      for (const bad of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const out = normalizeWheelDelta({ deltaX: bad, deltaY: bad, deltaMode });
        expect(Object.is(out.x, 0) && Object.is(out.y, 0), `mode ${deltaMode} ${bad} -> ${JSON.stringify(out)}`).toBe(true);
      }
      // A bad axis does not take the good one with it.
      expect(normalizeWheelDelta({ deltaX: Number.NaN, deltaY: 0.25, deltaMode })).toEqual({ x: 0, y: 0.25 * [1, WHEEL_LINE_PX, WHEEL_PAGE_PX][deltaMode] });
    }
    expect(normalizeWheelDelta({ deltaX: 5, deltaY: 5, deltaMode: 7 })).toEqual({ x: 0, y: 0 });
  });

  it('clamps an oversized burst to the limit, keeping its sign', () => {
    const bursts: [number, number][] = [
      [PIXEL, 401],
      [PIXEL, 5000],
      [LINE, 26],
      [LINE, 1000],
      [PAGE, 1],
      [PAGE, 12],
    ];
    for (const [deltaMode, raw] of bursts) {
      expect(normalizeWheelDelta({ deltaX: 0, deltaY: raw, deltaMode }).y, `mode ${deltaMode} ${raw}`).toBe(WHEEL_MAX_DELTA_PX);
      expect(normalizeWheelDelta({ deltaX: -raw, deltaY: -raw, deltaMode }), `mode ${deltaMode} -${raw}`).toEqual({ x: -WHEEL_MAX_DELTA_PX, y: -WHEEL_MAX_DELTA_PX });
    }
    // At the limit itself nothing is cut.
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 400, deltaMode: PIXEL }).y).toBe(400);
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 25, deltaMode: LINE }).y).toBe(400);
  });
});

describe('US-01M7CCDR AC2 wheel zoom is multiplicative and bounded', () => {
  const bounds = { min: 0.25, max: 40 };

  it('scales by the same factor for the same delta at every scale, with no rounding', () => {
    expect([WHEEL_NOTCH_PX, WHEEL_ZOOM_IN_PER_NOTCH]).toEqual([100, 1.08]);
    for (const delta of [-400, -100, -37, -4, -1, 0.5, 3, 100, 250]) {
      const factor = Math.pow(WHEEL_ZOOM_IN_PER_NOTCH, -delta / WHEEL_NOTCH_PX);
      for (const scale of [0.5, 1, 2.75, 10]) {
        const next = wheelZoomScale(scale, delta, bounds);
        // The ratio, not the difference, is the same at every scale: an additive step fails here.
        expect(next / scale, `scale ${scale} delta ${delta}`).toBeCloseTo(factor, 12);
      }
    }
    // A trackpad's one-pixel step still moves the scale, by a fraction: rounding would stall it.
    const tiny = wheelZoomScale(1, -1, bounds);
    expect(tiny).toBeGreaterThan(1);
    expect(tiny).toBeLessThan(1.001);
    expect(wheelZoomScale(100, -1, { min: 65, max: 260 })).not.toBe(100);
    expect(Number.isInteger(wheelZoomScale(100, -1, { min: 65, max: 260 }))).toBe(false);
  });

  it('zooms in for a negative delta and out for a positive one; a zero or non-finite delta does nothing', () => {
    for (const scale of [0.3, 1, 7]) {
      for (const d of [1, 10, 100, 400]) {
        expect(wheelZoomScale(scale, -d, bounds), `in ${scale} ${d}`).toBeGreaterThan(scale);
        expect(wheelZoomScale(scale, d, bounds), `out ${scale} ${d}`).toBeLessThan(scale);
      }
      for (const d of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(wheelZoomScale(scale, d, bounds), `no-op ${scale} ${d}`).toBe(scale);
      }
    }
  });

  it('returns to the start within 0.5% after equal and opposite deltas away from the bounds', () => {
    for (const scale of [0.5, 1, 3.3, 12]) {
      for (const d of [1, 7, 48, 100, 333, 400]) {
        for (const first of [-d, d]) {
          const back = wheelZoomScale(wheelZoomScale(scale, first, bounds), -first, bounds);
          expect(Math.abs(back / scale - 1), `scale ${scale} delta ${first}`).toBeLessThan(0.005);
        }
      }
      // Many small trackpad steps out and back, too.
      let s = scale;
      for (let i = 0; i < 50; i++) s = wheelZoomScale(s, -3, bounds);
      for (let i = 0; i < 50; i++) s = wheelZoomScale(s, 3, bounds);
      expect(Math.abs(s / scale - 1), `stream at ${scale}`).toBeLessThan(0.005);
    }
  });

  it('holds the scale inside its bounds and an out-of-range start is brought back', () => {
    const run = (from: number, delta: number) => {
      let s = from;
      for (let i = 0; i < 200; i++) {
        s = wheelZoomScale(s, delta, bounds);
        expect(s).toBeGreaterThanOrEqual(bounds.min);
        expect(s).toBeLessThanOrEqual(bounds.max);
      }
      return s;
    };
    expect(run(1, -400)).toBe(bounds.max);
    expect(run(1, 400)).toBe(bounds.min);
    expect(run(1, -50)).toBe(bounds.max);
    expect(run(1, 50)).toBe(bounds.min);
    expect(wheelZoomScale(100, -100, bounds)).toBe(bounds.max);
    expect(wheelZoomScale(0.01, 100, bounds)).toBe(bounds.min);
  });

  it('one classic mouse notch still moves the circular map by its 8% / 7.5% step', () => {
    // The step the map shipped with, written out: 8% larger rolling up, 7.5% smaller rolling down,
    // to the whole percent, inside 65-260%. Every notch size a mouse reports is one notch.
    const legacy = (p: number, deltaY: number) => {
      const from = clampSequenceZoom(p);
      if (deltaY === 0) return from;
      return clampSequenceZoom(Math.round(from * (deltaY < 0 ? 1.08 : 0.925)));
    };
    const starts: number[] = [];
    for (let p = SEQUENCE_ZOOM_MIN - 5; p <= SEQUENCE_ZOOM_MAX + 5; p++) starts.push(p, p + 0.5);
    for (const p of starts) {
      for (const deltaY of [-100, 100, -120, 120, -3, 3, -1, 1, -1000, 1000, 0]) {
        expect(wheelSequenceZoom(p, deltaY), `${p}% deltaY ${deltaY}`).toBe(legacy(p, deltaY));
      }
    }
    expect([wheelSequenceZoom(100, -100), wheelSequenceZoom(100, 100), wheelSequenceZoom(200, 100)]).toEqual([108, 93, 185]);
    // A delta that is not a number moves nothing (the old code read NaN as a notch out).
    expect(wheelSequenceZoom(150, Number.NaN)).toBe(150);
    // The shared helper's own notch in is the same 8%.
    expect(wheelZoomScale(100, -WHEEL_NOTCH_PX, { min: 65, max: 260 })).toBeCloseTo(108, 10);
  });
});

describe('US-01M7CCDR AC3 the gesture policy decides zoom or scroll', () => {
  const mods = (m: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>>) => ({ ctrlKey: false, metaKey: false, altKey: false, ...m });

  it('plain vertical wheel zooms a canvas and scrolls a scroll surface', () => {
    for (const deltaY of [-120, -3, -0.5, 0.5, 3, 120]) {
      for (const deltaX of [0, deltaY / 2, -deltaY / 3]) {
        expect(classifyWheelGesture({ deltaX, deltaY, ...mods({}) }, 'canvas'), `canvas ${deltaX},${deltaY}`).toBe('zoom');
        expect(classifyWheelGesture({ deltaX, deltaY, ...mods({}) }, 'scroll'), `scroll ${deltaX},${deltaY}`).toBe('scroll');
      }
    }
  });

  it('Ctrl or Cmd with the wheel, and a ctrl-flagged pinch, zoom either surface', () => {
    for (const surface of ['canvas', 'scroll'] as const) {
      for (const deltaY of [-100, -2.3, 1.7, 100]) {
        expect(classifyWheelGesture({ deltaX: 0, deltaY, ...mods({ ctrlKey: true }) }, surface), `${surface} ctrl ${deltaY}`).toBe('zoom');
        expect(classifyWheelGesture({ deltaX: 0, deltaY, ...mods({ metaKey: true }) }, surface), `${surface} cmd ${deltaY}`).toBe('zoom');
        expect(classifyWheelGesture({ deltaX: 0.4, deltaY, ...mods({ ctrlKey: true, altKey: true }) }, surface)).toBe('zoom');
      }
    }
  });

  it('Alt with the wheel is a zoom alias on a canvas only', () => {
    expect(classifyWheelGesture({ deltaX: 0, deltaY: -100, ...mods({ altKey: true }) }, 'canvas')).toBe('zoom');
    expect(classifyWheelGesture({ deltaX: 0, deltaY: -100, ...mods({ altKey: true }) }, 'scroll')).toBe('scroll');
  });

  it('a pure or mostly horizontal wheel never zooms, whatever the modifiers', () => {
    for (const surface of ['canvas', 'scroll'] as const) {
      for (const m of [{}, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true, metaKey: true, altKey: true }]) {
        for (const deltaX of [-120, -1, 1, 120]) {
          for (const deltaY of [0, deltaX / 4]) {
            expect(classifyWheelGesture({ deltaX, deltaY, ...mods(m) }, surface), `${surface} ${JSON.stringify(m)} ${deltaX},${deltaY}`).toBe('scroll');
          }
        }
      }
    }
  });

  it('a gesture with no usable delta is ignored', () => {
    for (const surface of ['canvas', 'scroll'] as const) {
      for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(classifyWheelGesture({ deltaX: bad, deltaY: bad, ...mods({ ctrlKey: true }) }, surface)).toBe('ignore');
        expect(classifyWheelGesture({ deltaX: bad, deltaY: bad, ...mods({}) }, surface)).toBe('ignore');
      }
      // A non-finite vertical delta with a real horizontal one is a horizontal gesture.
      expect(classifyWheelGesture({ deltaX: 5, deltaY: Number.NaN, ...mods({ ctrlKey: true }) }, surface)).toBe('scroll');
    }
  });
});

describe('US-01M7CCDR AC4 the zoom stays anchored at the pointer', () => {
  it('keeps the content point under the pointer within 1 CSS px', () => {
    const scales = [0.25, 0.65, 1, 1.08, 2.6, 13];
    const pointers = [
      { x: 0, y: 0 },
      { x: 312.5, y: 87 },
      { x: -40, y: 900 },
      { x: 1919, y: 1079 },
    ];
    const offsets = [
      { x: 0, y: 0 },
      { x: -250, y: 33.3 },
      { x: 4000, y: -1200 },
    ];
    for (const fromScale of scales) {
      for (const toScale of scales) {
        for (const pointer of pointers) {
          for (const offset of offsets) {
            const content = { x: (pointer.x - offset.x) / fromScale, y: (pointer.y - offset.y) / fromScale };
            const next = anchoredOffset({ pointer, offset, fromScale, toScale });
            const screen = { x: content.x * toScale + next.x, y: content.y * toScale + next.y };
            const label = `${fromScale}->${toScale} at ${pointer.x},${pointer.y} offset ${offset.x},${offset.y}`;
            expect(Math.abs(screen.x - pointer.x), label).toBeLessThan(1);
            expect(Math.abs(screen.y - pointer.y), label).toBeLessThan(1);
          }
        }
      }
    }
  });

  it('a zoom through the wheel helper keeps the anchor, and a zoom held at a bound keeps the offset', () => {
    const bounds = { min: 0.5, max: 4 };
    const pointer = { x: 410, y: 222 };
    let scale = 1;
    let offset = { x: -30, y: 15 };
    const content = { x: (pointer.x - offset.x) / scale, y: (pointer.y - offset.y) / scale };
    for (const delta of [-100, -48, -3, 250, -400, -400, -400, -400, 7]) {
      const next = wheelZoomScale(scale, delta, bounds);
      offset = anchoredOffset({ pointer, offset, fromScale: scale, toScale: next });
      scale = next;
      expect(Math.abs(content.x * scale + offset.x - pointer.x), `after ${delta}`).toBeLessThan(1);
      expect(Math.abs(content.y * scale + offset.y - pointer.y), `after ${delta}`).toBeLessThan(1);
    }
    expect(anchoredOffset({ pointer, offset: { x: 5, y: 6 }, fromScale: 4, toScale: 4 })).toEqual({ x: 5, y: 6 });
  });

  it('a scale that is not a positive number leaves the offset where it was', () => {
    const offset = { x: 12, y: -8 };
    for (const [fromScale, toScale] of [
      [0, 2],
      [Number.NaN, 2],
      [1, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [-1, 2],
    ]) {
      expect(anchoredOffset({ pointer: { x: 100, y: 100 }, offset, fromScale, toScale }), `${fromScale}->${toScale}`).toEqual(offset);
    }
  });

  it('a button or key zoom anchors at the pointer, else the selection centre, else the viewport centre', () => {
    const viewport = { x: 10, y: 20, width: 600, height: 400 };
    expect(zoomAnchorPoint({ pointer: { x: 50, y: 60 }, selectionCentre: { x: 1, y: 2 }, viewport })).toEqual({ x: 50, y: 60 });
    expect(zoomAnchorPoint({ selectionCentre: { x: 1, y: 2 }, viewport })).toEqual({ x: 1, y: 2 });
    expect(zoomAnchorPoint({ pointer: { x: Number.NaN, y: 3 }, selectionCentre: { x: 1, y: 2 }, viewport })).toEqual({ x: 1, y: 2 });
    expect(zoomAnchorPoint({ viewport })).toEqual({ x: 310, y: 220 });
    expect(zoomAnchorPoint({ selectionCentre: { x: Number.POSITIVE_INFINITY, y: 0 }, viewport: { width: 100, height: 50 } })).toEqual({ x: 50, y: 25 });
  });
});
