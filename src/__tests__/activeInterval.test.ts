// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import type { ActiveInterval, IntervalEdge, Topology } from '../types/bio';
import {
  crossesOrigin,
  formatIntervalLabel,
  intervalContains,
  intervalLength,
  intervalSegments,
  moveInterval,
  normaliseInterval,
  renderSegments,
  resizeInterval,
  resizeIntervalBy,
  toSelectedRange,
} from '../core/activeInterval';

/**
 * Oracle independent of the model: walk forward from start, one base at a time, wrapping
 * after the last base, until end. Returns the 1-based bases the interval covers, in order.
 */
function walk(iv: ActiveInterval, length: number): number[] {
  const out: number[] = [];
  let b = iv.start;
  for (;;) {
    out.push(b);
    if (b === iv.end) return out;
    b = b === length ? 1 : b + 1;
    if (out.length > length) throw new Error('walk did not reach end');
  }
}

function isValid(iv: ActiveInterval, length: number, topology: Topology): boolean {
  const inRange = (x: number) => Number.isInteger(x) && x >= 1 && x <= length;
  if (!inRange(iv.start) || !inRange(iv.end)) return false;
  return topology === 'circular' || iv.start <= iv.end;
}

const LENGTHS = [1, 2, 3, 7, 100, 6061, 250_000];
const TOPOLOGIES: Topology[] = ['linear', 'circular'];

/** Every start<=end pair for short molecules; edges and a spread of interior bases for long ones. */
function nonCrossing(length: number): ActiveInterval[] {
  const bases =
    length <= 7
      ? Array.from({ length }, (_, i) => i + 1)
      : [1, 2, Math.floor(length / 2), length - 1, length];
  const out: ActiveInterval[] = [];
  for (const s of bases) for (const e of bases) if (s <= e) out.push({ start: s, end: e });
  return out;
}

function crossing(length: number): ActiveInterval[] {
  return nonCrossing(length)
    .filter((iv) => iv.start !== iv.end)
    .map((iv) => ({ start: iv.end, end: iv.start }));
}

describe('US-01M7CCV7 AC1 linear clamp and selectedRange round trip', () => {
  it('round-trips every non-crossing interval unchanged, first and last base included, on both topologies', () => {
    for (const length of LENGTHS) {
      for (const topology of TOPOLOGIES) {
        for (const r of nonCrossing(length)) {
          const iv = normaliseInterval(r, length, topology);
          expect(iv).toEqual(r);
          expect(toSelectedRange(iv)).toEqual({ start: r.start, end: r.end });
        }
      }
    }
  });

  it('round-trips a labelled selectedRange to the same start and end', () => {
    const r = { start: 5179, end: 5898, label: 'eGFP (CDS)' };
    expect(toSelectedRange(normaliseInterval(r, 6061, 'circular'))).toEqual({ start: 5179, end: 5898 });
  });

  it('clamps a linear interval to 1..length, not 0..length or 1..length+1', () => {
    expect(normaliseInterval({ start: 0, end: 50 }, 100, 'linear')).toEqual({ start: 1, end: 50 });
    expect(normaliseInterval({ start: -5, end: 200 }, 100, 'linear')).toEqual({ start: 1, end: 100 });
    expect(normaliseInterval({ start: 50, end: 101 }, 100, 'linear')).toEqual({ start: 50, end: 100 });
    expect(normaliseInterval({ start: 150, end: 200 }, 100, 'linear')).toEqual({ start: 100, end: 100 });
    expect(normaliseInterval({ start: -9, end: 0 }, 100, 'linear')).toEqual({ start: 1, end: 1 });
    expect(normaliseInterval({ start: 3, end: 9 }, 1, 'linear')).toEqual({ start: 1, end: 1 });
    expect(normaliseInterval({ start: 2.4, end: 5.6 }, 10, 'linear')).toEqual({ start: 2, end: 6 });
  });

  it('keeps start<=end on a linear molecule by swapping a reversed pair, never treating it as crossing', () => {
    expect(normaliseInterval({ start: 50, end: 10 }, 100, 'linear')).toEqual({ start: 10, end: 50 });
    expect(normaliseInterval({ start: 100, end: 1 }, 100, 'linear')).toEqual({ start: 1, end: 100 });
    expect(normaliseInterval({ start: 2, end: 1 }, 2, 'linear')).toEqual({ start: 1, end: 2 });
    for (const length of [2, 3, 7]) {
      for (const r of crossing(length)) {
        const iv = normaliseInterval(r, length, 'linear');
        expect(iv.start).toBeLessThanOrEqual(iv.end);
        expect(crossesOrigin(iv)).toBe(false);
      }
    }
  });

  it('refuses an empty molecule or a coordinate that is not a number, rather than inventing an interval', () => {
    expect(() => normaliseInterval({ start: 1, end: 1 }, 0, 'linear')).toThrow(RangeError);
    expect(() => normaliseInterval({ start: 1, end: 1 }, 2.5, 'circular')).toThrow(RangeError);
    expect(() => normaliseInterval({ start: Number.NaN, end: 4 }, 10, 'linear')).toThrow(RangeError);
    expect(() => normaliseInterval({ start: 1, end: Infinity }, 10, 'circular')).toThrow(RangeError);
  });
});

describe('US-01M7CCV7 AC2 origin-crossing interval on a circular molecule', () => {
  it('keeps start > end on a circular molecule instead of swapping it into the complementary arc', () => {
    expect(normaliseInterval({ start: 90, end: 10 }, 100, 'circular')).toEqual({ start: 90, end: 10 });
    expect(normaliseInterval({ start: 5990, end: 71 }, 6061, 'circular')).toEqual({ start: 5990, end: 71 });
    for (const length of [2, 3, 7, 100]) {
      for (const r of crossing(length)) {
        expect(normaliseInterval(r, length, 'circular')).toEqual(r);
        expect(crossesOrigin(r)).toBe(true);
      }
    }
  });

  it('wraps an out-of-range circular coordinate around the origin rather than clamping it', () => {
    expect(normaliseInterval({ start: 101, end: 105 }, 100, 'circular')).toEqual({ start: 1, end: 5 });
    expect(normaliseInterval({ start: 0, end: 3 }, 100, 'circular')).toEqual({ start: 100, end: 3 });
    expect(normaliseInterval({ start: 95, end: 110 }, 100, 'circular')).toEqual({ start: 95, end: 10 });
    expect(normaliseInterval({ start: -1, end: 200 }, 100, 'circular')).toEqual({ start: 1, end: 100 });
  });

  it('counts an origin-crossing interval as length - start + 1 + end', () => {
    expect(intervalLength({ start: 90, end: 10 }, 100)).toBe(21);
    expect(intervalLength({ start: 100, end: 1 }, 100)).toBe(2);
    expect(intervalLength({ start: 2, end: 1 }, 2)).toBe(2);
    expect(intervalLength({ start: 5990, end: 71 }, 6061)).toBe(143);
    expect(intervalLength({ start: 1, end: 100 }, 100)).toBe(100);
  });

  it('agrees with a base-by-base walk for every interval kind on lengths 1, 2, 3 and 7, first and last base included', () => {
    for (const length of [1, 2, 3, 7]) {
      for (const iv of [...nonCrossing(length), ...crossing(length)]) {
        const bases = walk(iv, length);
        expect(intervalLength(iv, length)).toBe(bases.length);
        const segBases = intervalSegments(iv, length).flatMap((s) => walk(s, length));
        expect(segBases).toEqual(bases);
        for (let b = 1; b <= length; b++) {
          expect(intervalContains(iv, b, length)).toBe(bases.includes(b));
        }
      }
    }
  });

  it('splits a crossing interval into [start..length] and [1..end], and leaves a non-crossing one whole', () => {
    expect(intervalSegments({ start: 90, end: 10 }, 100)).toEqual([
      { start: 90, end: 100 },
      { start: 1, end: 10 },
    ]);
    expect(intervalSegments({ start: 100, end: 1 }, 100)).toEqual([
      { start: 100, end: 100 },
      { start: 1, end: 1 },
    ]);
    expect(intervalSegments({ start: 10, end: 20 }, 100)).toEqual([{ start: 10, end: 20 }]);
  });

  it('answers contains() correctly at the seam, at both ends of the molecule and outside it', () => {
    const iv = { start: 90, end: 10 };
    expect(intervalContains(iv, 100, 100)).toBe(true);
    expect(intervalContains(iv, 1, 100)).toBe(true);
    expect(intervalContains(iv, 90, 100)).toBe(true);
    expect(intervalContains(iv, 10, 100)).toBe(true);
    expect(intervalContains(iv, 89, 100)).toBe(false);
    expect(intervalContains(iv, 11, 100)).toBe(false);
    expect(intervalContains(iv, 50, 100)).toBe(false);
    expect(intervalContains(iv, 0, 100)).toBe(false);
    expect(intervalContains(iv, 101, 100)).toBe(false);
    expect(intervalContains({ start: 1, end: 100 }, 0, 100)).toBe(false);
    expect(intervalContains({ start: 1, end: 100 }, 101, 100)).toBe(false);
  });

  it('handles a 1-bp interval at the first and at the last base', () => {
    for (const iv of [
      { start: 1, end: 1 },
      { start: 100, end: 100 },
    ]) {
      expect(crossesOrigin(iv)).toBe(false);
      expect(intervalLength(iv, 100)).toBe(1);
      expect(intervalSegments(iv, 100)).toEqual([iv]);
      for (let b = 1; b <= 100; b++) expect(intervalContains(iv, b, 100)).toBe(b === iv.start);
    }
  });

  it('converts to 0-based render boundaries that slice exactly the covered bases', () => {
    expect(renderSegments({ start: 90, end: 10 }, 100)).toEqual([
      { startIndex: 89, endExclusive: 100 },
      { startIndex: 0, endExclusive: 10 },
    ]);
    expect(renderSegments({ start: 1, end: 1 }, 100)).toEqual([{ startIndex: 0, endExclusive: 1 }]);
    const seq = 'ACGTTGCA';
    const length = seq.length;
    for (const iv of [...nonCrossing(length), ...crossing(length)]) {
      const sliced = renderSegments(iv, length)
        .map((s) => seq.slice(s.startIndex, s.endExclusive))
        .join('');
      expect(sliced).toBe(walk(iv, length).map((b) => seq[b - 1]).join(''));
    }
  });
});

describe('US-01M7CCV7 AC3 move, resize and label', () => {
  it('translates a circular interval across the origin in both directions, keeping its length', () => {
    expect(moveInterval({ start: 95, end: 99 }, 3, 100, 'circular')).toEqual({ start: 98, end: 2 });
    expect(moveInterval({ start: 95, end: 99 }, 10, 100, 'circular')).toEqual({ start: 5, end: 9 });
    expect(moveInterval({ start: 2, end: 6 }, -3, 100, 'circular')).toEqual({ start: 99, end: 3 });
    expect(moveInterval({ start: 98, end: 2 }, -97, 100, 'circular')).toEqual({ start: 1, end: 5 });
    expect(moveInterval({ start: 98, end: 2 }, 300, 100, 'circular')).toEqual({ start: 98, end: 2 });
    for (const length of [1, 2, 3, 7]) {
      for (const iv of [...nonCrossing(length), ...crossing(length)]) {
        for (let d = -2 * length; d <= 2 * length; d++) {
          const moved = moveInterval(iv, d, length, 'circular');
          expect(isValid(moved, length, 'circular')).toBe(true);
          expect(intervalLength(moved, length)).toBe(intervalLength(iv, length));
          expect(intervalContains(moved, ((iv.start - 1 + d) % length + length) % length + 1, length)).toBe(true);
        }
      }
    }
  });

  it('clamps a linear move at either end of the molecule, keeping its length', () => {
    expect(moveInterval({ start: 95, end: 99 }, 3, 100, 'linear')).toEqual({ start: 96, end: 100 });
    expect(moveInterval({ start: 2, end: 6 }, -3, 100, 'linear')).toEqual({ start: 1, end: 5 });
    expect(moveInterval({ start: 2, end: 6 }, 40, 100, 'linear')).toEqual({ start: 42, end: 46 });
    for (const length of [1, 2, 3, 7]) {
      for (const iv of nonCrossing(length)) {
        for (let d = -2 * length; d <= 2 * length; d++) {
          const moved = moveInterval(iv, d, length, 'linear');
          expect(isValid(moved, length, 'linear')).toBe(true);
          expect(moved.end - moved.start).toBe(iv.end - iv.start);
        }
      }
    }
  });

  it('sets either edge on a linear molecule, clamping and swapping edges when one is dragged past the other', () => {
    const iv = { start: 10, end: 20 };
    expect(resizeInterval(iv, 'start', 15, 100, 'linear')).toEqual({ start: 15, end: 20 });
    expect(resizeInterval(iv, 'end', 30, 100, 'linear')).toEqual({ start: 10, end: 30 });
    expect(resizeInterval(iv, 'start', 25, 100, 'linear')).toEqual({ start: 20, end: 25 });
    expect(resizeInterval(iv, 'end', 5, 100, 'linear')).toEqual({ start: 5, end: 10 });
    expect(resizeInterval(iv, 'start', 0, 100, 'linear')).toEqual({ start: 1, end: 20 });
    expect(resizeInterval(iv, 'end', 200, 100, 'linear')).toEqual({ start: 10, end: 100 });
    expect(resizeInterval(iv, 'start', 200, 100, 'linear')).toEqual({ start: 20, end: 100 });
    expect(resizeInterval(iv, 'start', 20, 100, 'linear')).toEqual({ start: 20, end: 20 });
  });

  it('sets either edge on a circular molecule by the shorter way round, wrapping and swapping past the other edge', () => {
    expect(resizeInterval({ start: 10, end: 20 }, 'start', 95, 100, 'circular')).toEqual({ start: 95, end: 20 });
    expect(resizeInterval({ start: 10, end: 20 }, 'start', 25, 100, 'circular')).toEqual({ start: 20, end: 25 });
    expect(resizeInterval({ start: 10, end: 20 }, 'end', 5, 100, 'circular')).toEqual({ start: 5, end: 10 });
    expect(resizeInterval({ start: 95, end: 5 }, 'end', 98, 100, 'circular')).toEqual({ start: 95, end: 98 });
    expect(resizeInterval({ start: 95, end: 5 }, 'start', 3, 100, 'circular')).toEqual({ start: 3, end: 5 });
    expect(resizeInterval({ start: 95, end: 5 }, 'start', 8, 100, 'circular')).toEqual({ start: 5, end: 8 });
    expect(resizeInterval({ start: 95, end: 5 }, 'end', 90, 100, 'circular')).toEqual({ start: 90, end: 95 });
  });

  it('resizes by a delta, swapping past the other edge and stopping at one full turn on a circle', () => {
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'start', 15, 100, 'circular')).toEqual({ start: 20, end: 25 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'end', -15, 100, 'circular')).toEqual({ start: 5, end: 10 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'start', -150, 100, 'circular')).toEqual({ start: 21, end: 20 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'end', 150, 100, 'circular')).toEqual({ start: 10, end: 9 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'start', 25, 100, 'linear')).toEqual({ start: 20, end: 35 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'start', -25, 100, 'linear')).toEqual({ start: 1, end: 20 });
  });

  it('keeps every resize valid and anchored on the edge that was not dragged, on lengths 1, 2, 3 and 7', () => {
    const edges: IntervalEdge[] = ['start', 'end'];
    for (const length of [1, 2, 3, 7]) {
      for (const topology of TOPOLOGIES) {
        const ivs = topology === 'circular' ? [...nonCrossing(length), ...crossing(length)] : nonCrossing(length);
        for (const iv of ivs) {
          for (const edge of edges) {
            const anchor = edge === 'start' ? iv.end : iv.start;
            for (let base = -1; base <= length + 2; base++) {
              const r = resizeInterval(iv, edge, base, length, topology);
              expect(isValid(r, length, topology)).toBe(true);
              expect(intervalContains(r, anchor, length)).toBe(true);
              const target =
                topology === 'linear'
                  ? Math.min(length, Math.max(1, base))
                  : (((base - 1) % length) + length) % length + 1;
              expect(intervalContains(r, target, length)).toBe(true);
              expect([r.start, r.end]).toContain(anchor);
              expect([r.start, r.end]).toContain(target);
            }
          }
        }
      }
    }
  });

  it('labels an interval in 1-based inclusive coordinates, naming a crossing of the origin', () => {
    expect(formatIntervalLabel({ start: 5990, end: 71 }, 6061)).toBe('5,990..71 (143 bp, across the origin)');
    expect(formatIntervalLabel({ start: 10, end: 20 }, 100)).toBe('10..20 (11 bp)');
    expect(formatIntervalLabel({ start: 1, end: 1 }, 100)).toBe('1..1 (1 bp)');
    expect(formatIntervalLabel({ start: 100, end: 1 }, 100)).toBe('100..1 (2 bp, across the origin)');
    expect(formatIntervalLabel({ start: 1, end: 250000 }, 250000)).toBe('1..250,000 (250,000 bp)');
  });
});
