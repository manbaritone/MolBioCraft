// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * One sizing convention for every chart in the workbench.
 *
 * An SVG's user units are only meaningful next to the size it is rendered at. A chart authored
 * 475 units wide and then stretched across a 1330 px card is scaled 2.8x, which turns its 10 px
 * axis labels into 28 px headlines and its captions into clipped banners. So charts are authored
 * at roughly the pixel width they will occupy, and are never scaled up past it.
 */

export interface ChartBox {
  /** viewBox width, in units that render as CSS pixels at the chart's intended size. */
  w: number;
  /** viewBox height. */
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

/** A chart that spans a full-width studio card. */
export const CHART_FULL: ChartBox = { w: 1180, h: 300, padL: 56, padR: 24, padT: 18, padB: 40 };

/** A chart that sits in one column of a two-column studio grid. */
export const CHART_HALF: ChartBox = { w: 560, h: 260, padL: 48, padR: 20, padT: 16, padB: 36 };

export interface PlotFrame extends ChartBox {
  /** Inner plot rectangle, inside the padding. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Maps a value in [d0, d1] to an x coordinate across the plot. */
  xOf: (v: number, d0: number, d1: number) => number;
  /** Maps a value in [d0, d1] to a y coordinate, with d0 at the bottom. */
  yOf: (v: number, d0: number, d1: number) => number;
  /** Maps index i of n points evenly across the plot. */
  xOfIndex: (i: number, n: number) => number;
}

const span = (v: number, d0: number, d1: number) => (d1 === d0 ? 0.5 : (v - d0) / (d1 - d0));
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Builds the inner plot rectangle and its value-to-coordinate mappings. */
export function plotFrame(box: ChartBox = CHART_FULL): PlotFrame {
  const x = box.padL;
  const y = box.padT;
  const width = Math.max(1, box.w - box.padL - box.padR);
  const height = Math.max(1, box.h - box.padT - box.padB);
  return {
    ...box,
    x,
    y,
    width,
    height,
    xOf: (v, d0, d1) => x + clamp01(span(v, d0, d1)) * width,
    yOf: (v, d0, d1) => y + height - clamp01(span(v, d0, d1)) * height,
    xOfIndex: (i, n) => x + (n <= 1 ? 0.5 : i / (n - 1)) * width,
  };
}

/**
 * Inline style that keeps a chart from being scaled above the size it was drawn at, while still
 * letting it shrink on a narrow window. Charts authored through {@link plotFrame} already match
 * their card, but this also protects the ones drawn at their own natural size.
 */
export function chartMaxWidth(naturalWidth: number): { maxInlineSize: string; marginInline: string } {
  return { maxInlineSize: `${naturalWidth}px`, marginInline: 'auto' };
}

/** Evenly spaced tick values across [d0, d1], inclusive of both ends. */
export function ticks(d0: number, d1: number, count: number): number[] {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => d0 + ((d1 - d0) * i) / (n - 1));
}
