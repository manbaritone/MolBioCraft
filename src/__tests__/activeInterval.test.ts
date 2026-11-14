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
  intervalSequence,
  intervalUnit,
  moveInterval,
  normaliseInterval,
  renderSegments,
  resizeInterval,
  resizeIntervalBy,
  reverseInterval,
  selectionInterval,
  toSelectedRange,
} from '../core/activeInterval';
import { describeSelectionSector, orfSelectRange, selectionSectorAngles } from '../components/CircularPlasmidMap';

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
    expect(formatIntervalLabel({ start: 5990, end: 71 }, 6061, 'circular')).toBe('5,990..71 (143 bp, across the origin)');
    expect(formatIntervalLabel({ start: 10, end: 20 }, 100, 'circular')).toBe('10..20 (11 bp)');
    expect(formatIntervalLabel({ start: 1, end: 1 }, 100, 'linear')).toBe('1..1 (1 bp)');
    expect(formatIntervalLabel({ start: 100, end: 1 }, 100, 'circular')).toBe('100..1 (2 bp, across the origin)');
    expect(formatIntervalLabel({ start: 1, end: 250000 }, 250000, 'linear')).toBe('1..250,000 (250,000 bp)');
  });
});

// ─── BG-01M7CG2W: every selectedRange consumer reads an origin-crossing interval as the model does ───

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (s: string) => [...s].reverse().map((c) => COMPLEMENT[c]).join('');
/** A 6,061-base molecule (the Sample Project's length) whose every base is told apart by position. */
const SEQ_6061 = Array.from({ length: 6061 }, (_, i) => 'ACGT'[(i * 7 + (i >> 3)) % 4]).join('');

describe('BG-01M7CG2W boundary cases of the model', () => {
  it('reads a circular pair spanning exactly the molecule as the whole molecule, wherever it starts', () => {
    // :72 `>=` -> `>` would wrap these to the crossing {100, 99} / {5, 4}.
    expect(normaliseInterval({ start: 0, end: 99 }, 100, 'circular')).toEqual({ start: 1, end: 100 });
    expect(normaliseInterval({ start: 5, end: 104 }, 100, 'circular')).toEqual({ start: 1, end: 100 });
    expect(normaliseInterval({ start: 5, end: 103 }, 100, 'circular')).toEqual({ start: 5, end: 3 });
  });

  it('breaks a half-turn tie by going forward round the circle, for either edge', () => {
    // :186 `d > length / 2` -> `>=` turns the +50 into -50; `d <= -length / 2` -> `<` keeps a -50.
    expect(resizeInterval({ start: 10, end: 20 }, 'end', 70, 100, 'circular')).toEqual({ start: 10, end: 70 });
    expect(resizeInterval({ start: 60, end: 70 }, 'start', 10, 100, 'circular')).toEqual({ start: 70, end: 10 });
  });

  it('turns the other way round rather than stopping one base short when the shorter way is a full turn', () => {
    // :192 `>=` -> `>` lets resizeIntervalBy clamp this to {60, 59} instead of reaching base 60.
    expect(resizeInterval({ start: 60, end: 10 }, 'end', 60, 100, 'circular')).toEqual({ start: 60, end: 60 });
  });

  it('rounds a fractional delta or base to the nearest base before moving', () => {
    expect(moveInterval({ start: 10, end: 20 }, 2.6, 100, 'circular')).toEqual({ start: 13, end: 23 });
    expect(moveInterval({ start: 10, end: 20 }, 2.6, 100, 'linear')).toEqual({ start: 13, end: 23 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'end', 2.6, 100, 'linear')).toEqual({ start: 10, end: 23 });
    expect(resizeIntervalBy({ start: 10, end: 20 }, 'end', 2.6, 100, 'circular')).toEqual({ start: 10, end: 23 });
    expect(resizeInterval({ start: 10, end: 20 }, 'end', 30.4, 100, 'circular')).toEqual({ start: 10, end: 30 });
  });

  it('throws a RangeError for a non-finite coordinate, delta, base or length in every operation', () => {
    const iv = { start: 10, end: 20 };
    for (const topology of TOPOLOGIES) {
      expect(() => moveInterval(iv, Number.NaN, 100, topology)).toThrow(RangeError);
      expect(() => moveInterval({ start: Number.NaN, end: 20 }, 1, 100, topology)).toThrow(RangeError);
      expect(() => moveInterval(iv, 1, Number.NaN, topology)).toThrow(RangeError);
      expect(() => resizeIntervalBy(iv, 'end', Infinity, 100, topology)).toThrow(RangeError);
      expect(() => resizeIntervalBy({ start: 10, end: -Infinity }, 'start', 1, 100, topology)).toThrow(RangeError);
      expect(() => resizeInterval(iv, 'start', Number.NaN, 100, topology)).toThrow(RangeError);
      expect(() => resizeInterval(iv, 'start', 5, 0, topology)).toThrow(RangeError);
      expect(() => formatIntervalLabel({ start: Number.NaN, end: 1 }, 100, topology)).toThrow(RangeError);
    }
  });
});

describe('BG-01M7CG2W the App selection read through the model', () => {
  it('reads no selection, an empty molecule or a non-finite edge as no interval, rather than {NaN, NaN}', () => {
    expect(selectionInterval(null, 100, 'circular')).toBeNull();
    expect(selectionInterval(undefined, 100, 'linear')).toBeNull();
    expect(selectionInterval({ start: 1, end: 5 }, 0, 'linear')).toBeNull();
    expect(selectionInterval({ start: Number.NaN, end: 5 }, 100, 'circular')).toBeNull();
    expect(selectionInterval({ start: 1, end: Infinity }, 100, 'linear')).toBeNull();
  });

  it('keeps an origin-crossing selection on a circular molecule and normalises it on a linear one', () => {
    expect(selectionInterval({ start: 5990, end: 71, label: 'x' } as { start: number; end: number }, 6061, 'circular')).toEqual({ start: 5990, end: 71 });
    expect(selectionInterval({ start: 5990, end: 71 }, 6061, 'linear')).toEqual({ start: 71, end: 5990 });
    expect(selectionInterval({ start: 10, end: 20 }, 6061, 'circular')).toEqual({ start: 10, end: 20 });
  });

  it('measures {5990, 71} on 6,061 bp as 143 bases, the length the HUD and the status bar print', () => {
    const iv = selectionInterval({ start: 5990, end: 71 }, 6061, 'circular')!;
    expect(intervalLength(iv, 6061)).toBe(143);
    expect(formatIntervalLabel(iv, 6061, 'circular', 'bp')).toBe('5,990..71 (143 bp, across the origin)');
  });

  it('labels in the unit of the molecule and never calls a reversed linear pair a crossing', () => {
    expect(intervalUnit('DNA')).toBe('bp');
    expect(intervalUnit('RNA')).toBe('nt');
    expect(intervalUnit('Protein')).toBe('aa');
    expect(formatIntervalLabel({ start: 50, end: 10 }, 100, 'linear')).toBe('10..50 (41 bp)');
    expect(formatIntervalLabel({ start: 10, end: 20 }, 100, 'linear', 'aa')).toBe('10..20 (11 aa)');
    expect(formatIntervalLabel({ start: 90, end: 10 }, 100, 'circular', 'nt')).toBe('90..10 (21 nt, across the origin)');
  });

  it('extracts exactly the 143 bases of {5990, 71}: the end of the molecule, then its start', () => {
    const bases = intervalSequence(SEQ_6061, { start: 5990, end: 71 });
    expect(bases).toHaveLength(143);
    expect(bases).toBe(SEQ_6061.slice(5989) + SEQ_6061.slice(0, 71));
    expect(intervalSequence(SEQ_6061, { start: 5179, end: 5898 })).toBe(SEQ_6061.slice(5178, 5898));
    const seq = 'ACGTTGCA';
    for (const iv of [...nonCrossing(seq.length), ...crossing(seq.length)]) {
      expect(intervalSequence(seq, iv)).toBe(walk(iv, seq.length).map((b) => seq[b - 1]).join(''));
    }
  });

  it('maps a selection through reverse-complement onto the same bases, crossing the origin or not', () => {
    const rc = revComp(SEQ_6061);
    const mirrored = reverseInterval({ start: 5990, end: 71 }, 6061);
    expect(mirrored).toEqual({ start: 5991, end: 72 });
    expect(intervalSequence(rc, mirrored)).toBe(revComp(intervalSequence(SEQ_6061, { start: 5990, end: 71 })));
    const seq = 'ACGTTGCA';
    for (const iv of [...nonCrossing(seq.length), ...crossing(seq.length)]) {
      const m = reverseInterval(iv, seq.length);
      expect(intervalSequence(revComp(seq), m)).toBe(revComp(intervalSequence(seq, iv)));
      expect(crossesOrigin(m)).toBe(crossesOrigin(iv));
      expect(reverseInterval(m, seq.length)).toEqual(iv);
    }
  });
});

describe('BG-01M7CG2W the circular map draws and selects an origin-crossing interval', () => {
  it('draws {5990, 71} on 6,061 bp as one sector across twelve o\'clock, 143/6061 of a turn wide', () => {
    const sectors = selectionSectorAngles({ start: 5990, end: 71 }, 6061, 'circular');
    expect(sectors).toHaveLength(1);
    expect(sectors[0].startAngle).toBeCloseTo((5989 / 6061) * 360, 9);
    expect(sectors[0].endAngle).toBeCloseTo(360 + (71 / 6061) * 360, 9);
    expect(sectors[0].endAngle - sectors[0].startAngle).toBeCloseTo((143 / 6061) * 360, 9);
    expect(sectors[0].label).toBe('5990..71');
  });

  it('draws a reversed pair on a linear molecule as the normalised interval, never across the origin', () => {
    const [s] = selectionSectorAngles({ start: 5990, end: 71 }, 6061, 'linear');
    expect(s.startAngle).toBeCloseTo((70 / 6061) * 360, 9);
    expect(s.endAngle).toBeCloseTo((5990 / 6061) * 360, 9);
  });

  it('paths the crossing sector from left of twelve o\'clock to right of it, the short way round', () => {
    const [s] = selectionSectorAngles({ start: 5990, end: 71 }, 6061, 'circular');
    const d = describeSelectionSector(200, 200, 100, 120, s.startAngle, s.endAngle);
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    // M x y (outer start), A r r 0 large 1 x y (outer end)
    const [mx, my] = [nums[0], nums[1]];
    const [large, sweep, ax, ay] = [nums[5], nums[6], nums[7], nums[8]];
    const at = (deg: number) => ({
      x: 200 + 120 * Math.cos(((deg - 90) * Math.PI) / 180),
      y: 200 + 120 * Math.sin(((deg - 90) * Math.PI) / 180),
    });
    expect(mx).toBeCloseTo(at((5989 / 6061) * 360).x, 1);
    expect(my).toBeCloseTo(at((5989 / 6061) * 360).y, 1);
    expect(ax).toBeCloseTo(at((71 / 6061) * 360).x, 1);
    expect(ay).toBeCloseTo(at((71 / 6061) * 360).y, 1);
    expect(mx).toBeLessThan(200);
    expect(ax).toBeGreaterThan(200);
    expect(large).toBe(0);
    expect(sweep).toBe(1);
  });

  it('selects an origin-spanning ORF itself on a circular molecule, not the arc between its ends', () => {
    const orf = { start: 5990, end: 71, frame: 1 as const, lengthAa: 47 };
    expect(orfSelectRange(orf, 6061, 'circular')).toEqual({ start: 5990, end: 71, label: 'ORF Frame +1 (47 aa)' });
    expect(orfSelectRange({ ...orf, start: 100, end: 400, frame: -2 as const }, 6061, 'circular')).toEqual({
      start: 100,
      end: 400,
      label: 'ORF Frame -2 (47 aa)',
    });
    expect(orfSelectRange(orf, 6061, 'linear')).toEqual({ start: 71, end: 5990, label: 'ORF Frame +1 (47 aa)' });
  });
});

describe('BG-01M7CG2W the readers: the map HUD and sector, and the App extraction', () => {
  it('prints the true length of an origin-crossing selection in the map HUD and draws its sector across twelve o\'clock', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const puc19 = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;
    const doc = { ...puc19, sequence: SEQ_6061, features: [], primers: [], topology: 'circular' as const };
    const render = (selectedRange: { start: number; end: number }, topology: Topology) =>
      renderToStaticMarkup(
        React.createElement(CircularPlasmidMap, {
          doc: { ...doc, topology },
          cutSites: [],
          orfs: [],
          selectedRange,
          onSelectRange: () => {},
          showOrfs: false,
          showPrimers: false,
          showUniqueCuttersOnly: true,
          zoomLevel: 100,
          onZoomChange: () => {},
        } as unknown as Parameters<typeof CircularPlasmidMap>[0])
      );
    const html = render({ start: 5990, end: 71 }, 'circular');
    expect(html).toContain('Selected 5,990..71 (143 bp, across the origin)');
    expect(html).not.toContain('5920');
    const sectors = [...html.matchAll(/data-active-interval="([^"]+)" data-start-angle="([^"]+)" data-end-angle="([^"]+)"/g)];
    expect(sectors).toHaveLength(1);
    expect(sectors[0][1]).toBe('5990..71');
    expect(Number(sectors[0][2])).toBeCloseTo((5989 / 6061) * 360, 9);
    expect(Number(sectors[0][3])).toBeCloseTo(360 + (71 / 6061) * 360, 9);
    const linear = render({ start: 5990, end: 71 }, 'linear');
    expect(linear).toContain('Selected 71..5,990 (5,920 bp)');
  });

  it('extracts exactly the bases of an origin-crossing selection, the end of the molecule then its start', async () => {
    const { selectionOnOwnOrigin } = await import('../App');
    const { extractRegionWithAnnotationsRust } = await import('../lib/rustBioEngine');
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const puc19 = structuredClone(SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!);
    expect(puc19.topology).toBe('circular');
    const n = puc19.sequence.length;
    const region = selectionOnOwnOrigin(puc19, { start: n - 92, end: 50 })!;
    expect(region.start).toBe(1);
    expect(region.end).toBe(143);
    const extracted = extractRegionWithAnnotationsRust(region.doc, region.start, region.end, '2026-11-14T00:00:00.000Z');
    expect(extracted.sequence).toBe(puc19.sequence.slice(n - 93) + puc19.sequence.slice(0, 50));
    // A selection that does not cross is handed over as it is, and none gives null.
    expect(selectionOnOwnOrigin(puc19, { start: 10, end: 20 })).toEqual({ doc: puc19, start: 10, end: 20 });
    expect(selectionOnOwnOrigin(puc19, null)).toBeNull();
    expect(selectionOnOwnOrigin({ ...puc19, topology: 'linear' }, { start: n - 92, end: 50 })).toMatchObject({ start: 50, end: n - 92 });
  });
});

describe('BG-01M7CG2W the App operations on an origin-crossing selection', () => {
  it('names an extracted crossing region and records its provenance by its own range, with no rotation step', async () => {
    const { extractSelectedRegionDocument } = await import('../App');
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const puc19 = structuredClone(SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!);
    const n = puc19.sequence.length;
    const s = n - 92;
    const doc = extractSelectedRegionDocument(puc19, { start: s, end: 50 }, '2026-11-14T00:00:00.000Z');
    expect(doc.sequence).toBe(puc19.sequence.slice(n - 93) + puc19.sequence.slice(0, 50));
    expect(doc.name).toBe(`${puc19.name}_${s}_50`);
    expect(doc.accession).toBe(`MBC_EXT_${s}_50`);
    expect(doc.description).toBe(`Extracted region ${s}..50, across the origin (143 bp) from ${puc19.name}`);
    expect(doc.history).toHaveLength(puc19.history.length + 1);
    expect(doc.history.slice(0, -1)).toEqual(puc19.history);
    const step = doc.history[doc.history.length - 1];
    expect(step.operation).toBe(`Extract Region (${s}..50, across the origin)`);
    expect(step.parentIds).toEqual([puc19.id]);
    expect(doc.history.some((h) => /Set Circular Origin/.test(h.operation))).toBe(false);
    // A selection that does not cross is extracted, named and recorded as before.
    const plain = extractSelectedRegionDocument(puc19, { start: 10, end: 20 }, '2026-11-14T00:00:00.000Z');
    expect(plain.name).toBe(`${puc19.name}_10_20`);
    expect(plain.sequence).toBe(puc19.sequence.slice(9, 20));
  });

  it('masks exactly the bases of an origin-crossing selection, both sides of the origin, and counts 143', async () => {
    const { maskActiveSelection } = await import('../App');
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const puc19 = structuredClone(SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!);
    const n = puc19.sequence.length;
    const r = maskActiveSelection(puc19, 'selection', { start: n - 92, end: 50 });
    expect(r.maskedBases).toBe(143);
    const seq = r.updated.sequence;
    expect(seq.slice(0, 50)).toBe('N'.repeat(50));
    expect(seq.slice(n - 93)).toBe('N'.repeat(93));
    expect(seq.slice(50, n - 93)).toBe(puc19.sequence.slice(50, n - 93));
    // A plain selection masks only its own bases.
    const plain = maskActiveSelection(puc19, 'selection', { start: 11, end: 20 });
    expect(plain.maskedBases).toBe(10);
    expect(plain.updated.sequence.slice(10, 20)).toBe('N'.repeat(10));
    expect(plain.updated.sequence.slice(0, 10)).toBe(puc19.sequence.slice(0, 10));
  });
});
