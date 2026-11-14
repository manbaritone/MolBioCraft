// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The single active interval behind MB-NAV-01: one model that the linear overview, the base
 * rows and the circular map share, so a selection made in one view means the same bases in all.
 *
 * Coordinates are 1-based and inclusive, matching the App's `selectedRange { start, end }`:
 * `{ start: 5, end: 7 }` is three bases, `{ start: 5, end: 5 }` is one.
 *
 * - Linear molecule: always `1 <= start <= end <= length`.
 * - Circular molecule: `start > end` means the interval crosses the origin; it covers
 *   `start..length` and then `1..end`, and is `length - start + 1 + end` bases long. The
 *   whole molecule is `{ 1, length }` (or any `{ k + 1, k }` reached by moving it).
 *
 * Views draw with 0-based half-open boundaries: {@link renderSegments} gives, per segment,
 * `startIndex = start - 1` and `endExclusive = end`, so `sequence.slice(startIndex, endExclusive)`
 * is exactly the bases the segment covers.
 *
 * This is a pure coordinate model for the UI; it computes no scientific result.
 */

import type { ActiveInterval, IntervalEdge, IntervalRenderSegment, Topology } from '../types/bio';

function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`active interval needs a molecule of at least 1 base, got length ${length}`);
  }
}

function assertCoordinate(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`active interval ${name} is not a finite number: ${value}`);
  }
}

/** Wrap any integer onto 1..length around a circular molecule's origin. */
function wrap(base: number, length: number): number {
  return ((((base - 1) % length) + length) % length) + 1;
}

function clamp(base: number, length: number): number {
  return Math.min(length, Math.max(1, base));
}

/**
 * Bring any `{ start, end }` (for example the App's `selectedRange`, label and all) to a valid
 * interval on a molecule of `length` bases. Fractional coordinates are rounded.
 *
 * - Linear: each edge is clamped to 1..length, and a reversed pair is swapped so start <= end.
 * - Circular: each edge is wrapped around the origin; `start > end` is kept as a crossing
 *   interval. A `start <= end` pair spanning `length` bases or more is the whole molecule `{ 1, length }`.
 *
 * Every interval already valid and not crossing the origin comes back unchanged.
 * Throws RangeError on a length below 1, a non-integer length, or a non-finite coordinate.
 */
export function normaliseInterval(
  range: { start: number; end: number },
  length: number,
  topology: Topology
): ActiveInterval {
  assertLength(length);
  assertCoordinate('start', range.start);
  assertCoordinate('end', range.end);
  const start = Math.round(range.start);
  const end = Math.round(range.end);
  if (topology === 'linear') {
    const a = clamp(start, length);
    const b = clamp(end, length);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  if (start <= end && end - start + 1 >= length) return { start: 1, end: length };
  return { start: wrap(start, length), end: wrap(end, length) };
}

/** The App's `selectedRange` shape for an interval: the same 1-based inclusive `{ start, end }`. */
export function toSelectedRange(interval: ActiveInterval): { start: number; end: number } {
  return { start: interval.start, end: interval.end };
}

/** True when the interval runs through the origin of a circular molecule (`start > end`). */
export function crossesOrigin(interval: ActiveInterval): boolean {
  return interval.start > interval.end;
}

/** Number of bases covered, counting both edges; a crossing interval counts both sides of the origin. */
export function intervalLength(interval: ActiveInterval, length: number): number {
  return crossesOrigin(interval)
    ? length - interval.start + 1 + interval.end
    : interval.end - interval.start + 1;
}

/**
 * The interval as 1-based inclusive, non-crossing pieces in reading order from `start`:
 * one piece, or `[start..length]` then `[1..end]` when it crosses the origin.
 */
export function intervalSegments(interval: ActiveInterval, length: number): ActiveInterval[] {
  if (!crossesOrigin(interval)) return [{ start: interval.start, end: interval.end }];
  return [
    { start: interval.start, end: length },
    { start: 1, end: interval.end },
  ];
}

/** Whether 1-based `base` lies in the interval; a base outside 1..length is never contained. */
export function intervalContains(interval: ActiveInterval, base: number, length: number): boolean {
  if (!Number.isInteger(base) || base < 1 || base > length) return false;
  return crossesOrigin(interval)
    ? base >= interval.start || base <= interval.end
    : base >= interval.start && base <= interval.end;
}

/** 0-based half-open render boundaries per segment: `startIndex = start - 1`, `endExclusive = end`. */
export function renderSegments(interval: ActiveInterval, length: number): IntervalRenderSegment[] {
  return intervalSegments(interval, length).map((s) => ({ startIndex: s.start - 1, endExclusive: s.end }));
}

/**
 * Translate the interval by `delta` bases (positive moves towards higher coordinates), keeping
 * its length. Circular: both edges wrap around the origin. Linear: the move stops where an edge
 * meets base 1 or the last base.
 */
export function moveInterval(
  interval: ActiveInterval,
  delta: number,
  length: number,
  topology: Topology
): ActiveInterval {
  const d = Math.round(delta);
  if (topology === 'circular') {
    return { start: wrap(interval.start + d, length), end: wrap(interval.end + d, length) };
  }
  const bounded = Math.min(length - interval.end, Math.max(1 - interval.start, d));
  return { start: interval.start + bounded, end: interval.end + bounded };
}

/**
 * Move one edge by `delta` bases while the other edge stays put (the anchor). If the moved edge
 * passes the anchor, the edges swap: the anchor becomes the other edge and the moved base the
 * new one, so a drag carries on smoothly. Linear: the moved edge is clamped to 1..length.
 * Circular: it wraps around the origin, and the interval never grows past one full turn.
 */
export function resizeIntervalBy(
  interval: ActiveInterval,
  edge: IntervalEdge,
  delta: number,
  length: number,
  topology: Topology
): ActiveInterval {
  const d = Math.round(delta);
  if (topology === 'linear') {
    const anchor = edge === 'start' ? interval.end : interval.start;
    const moved = clamp((edge === 'start' ? interval.start : interval.end) + d, length);
    return { start: Math.min(anchor, moved), end: Math.max(anchor, moved) };
  }
  // Unwrap so start <= end on the number line, then work with plain arithmetic.
  const s = interval.start;
  const e = crossesOrigin(interval) ? interval.end + length : interval.end;
  const anchor = edge === 'start' ? e : s;
  let moved = (edge === 'start' ? s : e) + d;
  moved = moved > anchor ? Math.min(moved, anchor + length - 1) : Math.max(moved, anchor - length + 1);
  const lo = Math.min(anchor, moved);
  const hi = Math.max(anchor, moved);
  return { start: wrap(lo, length), end: wrap(hi, length) };
}

/**
 * Set one edge to 1-based `base`, swapping edges if it is set past the other one.
 * Linear: `base` is clamped to 1..length. Circular: `base` is wrapped onto the molecule and
 * reached the shorter way round from the edge's current position, unless that way would grow
 * the interval past a full turn, in which case it goes the other way round - so `base` and the
 * edge that was not moved are always the two edges of the result.
 */
export function resizeInterval(
  interval: ActiveInterval,
  edge: IntervalEdge,
  base: number,
  length: number,
  topology: Topology
): ActiveInterval {
  const current = edge === 'start' ? interval.start : interval.end;
  if (topology === 'linear') {
    return resizeIntervalBy(interval, edge, clamp(Math.round(base), length) - current, length, topology);
  }
  let d = wrap(Math.round(base), length) - current;
  if (d > length / 2) d -= length;
  else if (d <= -length / 2) d += length;
  const s = interval.start;
  const e = crossesOrigin(interval) ? interval.end + length : interval.end;
  const anchor = edge === 'start' ? e : s;
  const moved = (edge === 'start' ? s : e) + d;
  if (Math.abs(moved - anchor) >= length) d += d > 0 ? -length : length;
  return resizeIntervalBy(interval, edge, d, length, topology);
}

/**
 * A label in 1-based inclusive coordinates with thousands separators, for example
 * `10..20 (11 bp)`, `1..1 (1 bp)`, or `5,990..71 (143 bp, across the origin)` for an interval
 * that crosses the origin of a circular molecule.
 */
export function formatIntervalLabel(interval: ActiveInterval, length: number): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const across = crossesOrigin(interval) ? ', across the origin' : '';
  return `${n(interval.start)}..${n(interval.end)} (${n(intervalLength(interval, length))} bp${across})`;
}
