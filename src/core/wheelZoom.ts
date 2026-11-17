// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * One wheel-zoom helper for the scientific views (US-01M7CCDR, CR-01M7CCSD). It is pure and knows
 * nothing of React or the DOM: a view hands it the numbers of a wheel event and gets back pixels, a
 * decision, a scale and a pan offset.
 *
 * - `normalizeWheelDelta` turns a wheel event's deltas into pixels whatever its `deltaMode`.
 * - `classifyWheelGesture` decides whether a gesture zooms, scrolls or is ignored on a surface.
 * - `wheelZoomScale` moves a scale multiplicatively by a pixel delta, inside its bounds.
 * - `anchoredOffset` returns the pan offset that keeps the point under the pointer still, and
 *   `zoomAnchorPoint` picks the anchor for a zoom that has no pointer (a button or a key).
 * - `WHEEL_ZOOM_COVERAGE` records, for every graphical view, whether its wheel and pinch zoom.
 */

/** `WheelEvent.DOM_DELTA_PIXEL`, `DOM_DELTA_LINE`, `DOM_DELTA_PAGE`. */
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** One line of a line-mode wheel delta, in CSS pixels (a 16 px line of text). */
export const WHEEL_LINE_PX = 16;
/**
 * One page of a page-mode wheel delta, in CSS pixels: a fixed 800 px rather than the viewport's
 * height, so the same event zooms by the same amount in every view and the helper stays pure.
 */
export const WHEEL_PAGE_PX = 800;
/**
 * The largest delta one event may carry on each axis, in CSS pixels: four classic notches. A larger
 * burst (a fast free-spinning wheel, a page-mode event) is clamped to it, keeping its sign.
 */
export const WHEEL_MAX_DELTA_PX = 400;
/** The pixel delta of one classic mouse-wheel notch. */
export const WHEEL_NOTCH_PX = 100;
/** The factor one notch toward the user (a negative delta) zooms in by: 8% larger. */
export const WHEEL_ZOOM_IN_PER_NOTCH = 1.08;

export interface WheelDeltaLike {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages; missing is the DOM default, pixels. */
  deltaMode?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A finite, non-zero number, or 0 for zero, NaN and infinity. */
function usable(value: number): number {
  return Number.isFinite(value) && value !== 0 ? value : 0;
}

/**
 * A wheel event's deltas in CSS pixels: a line is WHEEL_LINE_PX, a page WHEEL_PAGE_PX. A zero, NaN
 * or infinite delta on an axis reads as 0 on that axis alone, and so does every axis of an event
 * whose `deltaMode` is not one the DOM defines. Each axis is clamped to ±WHEEL_MAX_DELTA_PX.
 */
export function normalizeWheelDelta(event: WheelDeltaLike): Point {
  const mode = event.deltaMode ?? DOM_DELTA_PIXEL;
  const unit = mode === DOM_DELTA_PIXEL ? 1 : mode === DOM_DELTA_LINE ? WHEEL_LINE_PX : mode === DOM_DELTA_PAGE ? WHEEL_PAGE_PX : 0;
  const axis = (raw: number) => {
    const px = usable(raw) * unit;
    if (px === 0) return 0;
    return Math.max(-WHEEL_MAX_DELTA_PX, Math.min(WHEEL_MAX_DELTA_PX, px));
  };
  return { x: axis(event.deltaX), y: axis(event.deltaY) };
}

export type WheelSurface = 'canvas' | 'scroll';
export type WheelGesture = 'zoom' | 'scroll' | 'ignore';

export interface WheelGestureLike {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * The gesture policy of CR-01M7CCSD. A `canvas` is a dedicated graphical view (a plasmid map, a
 * tree); a `scroll` surface is one whose plain wheel scrolls its content (sequence text, an
 * alignment matrix, a trace).
 *
 * - No usable delta on either axis: 'ignore'.
 * - A gesture whose horizontal delta is larger than its vertical one (a pure horizontal wheel among
 *   them) is 'scroll', whatever the modifiers: it never zooms.
 * - Ctrl or Cmd (metaKey) with the wheel zooms either surface; a trackpad pinch arrives as a wheel
 *   event with `ctrlKey` set, so it zooms too.
 * - Alt with the wheel zooms a canvas, the map's old alias; on a scroll surface it scrolls.
 * - A plain vertical wheel zooms a canvas and scrolls a scroll surface.
 */
export function classifyWheelGesture(event: WheelGestureLike, surface: WheelSurface): WheelGesture {
  const dx = Math.abs(usable(event.deltaX));
  const dy = Math.abs(usable(event.deltaY));
  if (dx === 0 && dy === 0) return 'ignore';
  if (dx > dy) return 'scroll';
  if (event.ctrlKey || event.metaKey) return 'zoom';
  return surface === 'canvas' ? 'zoom' : 'scroll';
}

export interface WheelZoomBounds {
  min: number;
  max: number;
  /** The factor one notch in zooms by; WHEEL_ZOOM_IN_PER_NOTCH by default. */
  zoomInPerNotch?: number;
  /**
   * The factor one notch out zooms by; the inverse of `zoomInPerNotch` by default, so equal and
   * opposite deltas return exactly to the start.
   */
  zoomOutPerNotch?: number;
}

/**
 * The scale a pixel delta (from `normalizeWheelDelta`) moves `scale` to: multiplied by
 * `zoomInPerNotch` for every WHEEL_NOTCH_PX of negative delta and by `zoomOutPerNotch` for every
 * WHEEL_NOTCH_PX of positive delta, fractionally for a fraction of a notch, and held to
 * `min..max`. Nothing is rounded. A zero, NaN or infinite delta returns `scale` unchanged; a scale
 * that is not a finite number is returned as it came, for the caller's own guard to decide.
 */
export function wheelZoomScale(scale: number, deltaPx: number, bounds: WheelZoomBounds): number {
  const delta = usable(deltaPx);
  if (delta === 0 || !Number.isFinite(scale)) return scale;
  const zoomIn = bounds.zoomInPerNotch ?? WHEEL_ZOOM_IN_PER_NOTCH;
  const zoomOut = bounds.zoomOutPerNotch ?? 1 / zoomIn;
  const notches = Math.abs(delta) / WHEEL_NOTCH_PX;
  const next = scale * Math.pow(delta < 0 ? zoomIn : zoomOut, notches);
  return Math.min(bounds.max, Math.max(bounds.min, next));
}

/**
 * The pan offset after a zoom from `fromScale` to `toScale` that keeps the content point under
 * `pointer` where it is on screen, with screen = content × scale + offset on each axis. The content
 * point is read at the old scale, before the change. A scale that is not a finite positive number
 * returns `offset` unchanged; an unchanged scale (a zoom held at a bound) returns it unchanged too.
 */
export function anchoredOffset({ pointer, offset, fromScale, toScale }: { pointer: Point; offset: Point; fromScale: number; toScale: number }): Point {
  const valid = (s: number) => Number.isFinite(s) && s > 0;
  if (!valid(fromScale) || !valid(toScale) || fromScale === toScale) return { x: offset.x, y: offset.y };
  const ratio = toScale / fromScale;
  return {
    x: pointer.x - (pointer.x - offset.x) * ratio,
    y: pointer.y - (pointer.y - offset.y) * ratio,
  };
}

/**
 * The anchor of a zoom, in the same screen coordinates as `anchoredOffset`'s pointer: the pointer
 * where the zoom has one (a wheel); else, for a button or key zoom, the centre of the selection
 * where there is one; else the centre of the viewport (whose `x` and `y` are 0 when omitted). A point
 * with a coordinate that is not finite counts as absent.
 */
export function zoomAnchorPoint({
  pointer,
  selectionCentre,
  viewport,
}: {
  pointer?: Point;
  selectionCentre?: Point;
  viewport: { x?: number; y?: number; width: number; height: number };
}): Point {
  const finite = (p?: Point): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (finite(pointer)) return { x: pointer.x, y: pointer.y };
  if (finite(selectionCentre)) return { x: selectionCentre.x, y: selectionCentre.y };
  return { x: (viewport.x ?? 0) + viewport.width / 2, y: (viewport.y ?? 0) + viewport.height / 2 };
}

export type WheelZoomCoverageStatus = 'covered' | 'excluded' | 'pending';

export interface WheelZoomCoverageRow {
  view: string;
  status: WheelZoomCoverageStatus;
  /** Why the view is excluded or still pending. */
  reason?: string;
  /** A covered view's module under src/components, without its extension. */
  module?: string;
  /** The wheel-step function that module exports: (event, view, context?) => { handled, ... }. */
  wheelStep?: string;
}

const PENDING = 'no wheel or pinch zoom yet (CR-01M7CCSD)';

/**
 * Every graphical view's wheel-zoom coverage (US-01M7CMFH, CR-01M7CCSD). A covered view names its
 * module and its exported wheel-step function as strings rather than importing them, because the
 * components import this file; wheelZoom.test.ts resolves each name and drives the step.
 */
export const WHEEL_ZOOM_COVERAGE: readonly WheelZoomCoverageRow[] = [
  { view: 'circular map', status: 'covered', module: 'CircularPlasmidMap', wheelStep: 'circularMapWheelStep' },
  { view: 'linear overview', status: 'covered', module: 'LinearSequenceView', wheelStep: 'overviewWheelStep' },
  { view: 'alignment matrix', status: 'covered', module: 'AlignmentCanvas', wheelStep: 'alignmentWheelStep' },
  { view: 'chromatogram trace', status: 'covered', module: 'ChromatogramAndContigStudio', wheelStep: 'chromatogramWheelStep' },
  { view: '3D Calpha canvas', status: 'covered', module: 'ProteinStructure3DViewer', wheelStep: 'structureWheelStep' },
  { view: 'contig annotation map', status: 'covered', module: 'ContigSummaryView', wheelStep: 'contigMapWheelStep' },
  { view: 'dotplot', status: 'covered', module: 'AlignmentDotplot', wheelStep: 'dotplotWheelStep' },
  { view: 'imported tree', status: 'covered', module: 'ImportedTreeViewer', wheelStep: 'treeWheelStep' },
  { view: 'Mol* viewport', status: 'excluded', reason: 'Mol* trackball owns wheel and pinch' },
  { view: 'inferred tree (PhylogeneticsStudio)', status: 'pending', reason: PENDING },
  { view: 'user-tree topology (PhylogeneticsStudio)', status: 'pending', reason: PENDING },
  { view: 'cloning diagram', status: 'pending', reason: PENDING },
  { view: 'gel', status: 'pending', reason: PENDING },
  { view: 'read alignment views', status: 'pending', reason: PENDING },
  { view: 'pairwise alignment', status: 'pending', reason: PENDING },
  { view: 'Ramachandran plot', status: 'pending', reason: PENDING },
  {
    view: 'View > Zoom with Cmd+=/Cmd+-/Cmd+0 for every view but the maps',
    status: 'pending',
    reason: 'View > Zoom and Cmd+=/Cmd+-/Cmd+0 are routed to the sequence maps only',
  },
];
