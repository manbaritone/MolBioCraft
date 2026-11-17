// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { downloadSummarySequence } from '../core/contigSummary';
import { intervalContains, intervalLength, intervalSequence, moveInterval, normaliseInterval, renderSegments, resizeIntervalBy, selectionInterval } from '../core/activeInterval';
import {
  anchoredOffset,
  classifyWheelGesture,
  normalizeWheelDelta,
  WHEEL_NOTCH_PX,
  wheelZoomScale,
  zoomAnchorPoint,
  type WheelGestureLike,
} from '../core/wheelZoom';
import { setFigureFileDrawing } from '../core/figureCapture';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActiveInterval,
  FeatureType,
  IntervalEdge,
  NucleotideColorScheme,
  RestrictionCutSite,
  SequenceDocument,
  SequenceFeature,
  Topology,
} from '../types/bio';
import { analyzeProteinSequence, CODON_TABLE, enzymeLabel, reverseComplement, tmNoAnswerSentence } from '../core/bioEngine';
import { basicTmHasNoAnswer } from './ConstructCockpitBar';
import {
  getResidentTrackOverviewRust,
  searchResidentMotifFmIndexRust,
  sliceResidentViewportRust,
  type ResidentMotifSearchResult,
} from '../lib/rustBioEngine';
import { applySiteVisibility, cleavagePicture, cutSiteDisplayPosition, type CleavageCut, type SiteVisibility } from '../core/restrictionDisplay';
import { chartMaxWidth } from '../core/chartLayout';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { CleavagePreview } from './CleavagePreview';
import { collectionScanSet, emptyCollectionScanWords, meanGcWords, subsetNote, type RestrictionScanScope } from './CircularPlasmidMap';

interface LinearSequenceViewProps {
  doc: SequenceDocument;
  cutSites: RestrictionCutSite[];
  /**
   * Which of `cutSites` the user chose to display (US-01M7CCGA), with the scanned molecule's
   * revision; absent, every site is displayed. The base rows draw, and a marker opens, only a
   * displayed site; a preview of a site the user then hides closes.
   */
  siteVisibility?: { state: SiteVisibility; revision: string } | null;
  /** What `cutSites` cover when the caller scanned only part of the molecule; absent, the view gives no coverage note. */
  restrictionScope?: RestrictionScanScope | null;
  selectedRange: { start: number; end: number; label?: string } | null;
  /**
   * The CRISPR guide a guide row asked to be shown (US-01M7DVA6), or none: the whole site as the
   * row reports it, and its spacer and PAM as their own spans. Every coordinate is 1-based,
   * inclusive and on the plus strand, `start > end` running across the origin of a circular record
   * (the active-interval convention). The base rows mark the spacer's bases and the PAM's bases
   * apart, and the ribbon above them reads each part on the guide's own strand; nothing here edits
   * the document.
   */
  guideHighlight?: {
    name: string;
    nuclease: string;
    strand: 1 | -1;
    site: { start: number; end: number };
    spacer: { start: number; end: number };
    pam: { start: number; end: number };
    pamSide: string;
    cutPosition: number;
    cutPositionTargetStrand?: number;
    cutPositionTargetStrandNote?: string;
  } | null;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
  onUpdateDocument: (updated: SequenceDocument) => void;
  showTranslation?: boolean;
  showGcGraph?: boolean;
  showHydropathyGraph?: boolean;
  /**
   * View › Tracks' Features and Restriction Sites (US-01M7DV8W); shown unless false. Hidden, the
   * schematic and the base rows draw no feature box, or no cut-site mark or label, and
   * `siteVisibility` is left as it is.
   */
  showFeatures?: boolean;
  showRestrictionSites?: boolean;
  colorScheme?: NucleotideColorScheme;
  onLoadBenchmarkDocument?: (kind: 'genome-500k' | 'protein-10k') => void;
  onClearSelection?: () => void;
  onExtractSelection?: () => void;
  onConvertSelectionToOligo?: () => void;
  onStatusNotice?: (msg: string) => void;
  /** Offered by the cleavage preview as "View the ... enzyme definition" (US-01M7JPSK); absent, not offered. */
  onViewEnzyme?: (site: RestrictionCutSite) => void;
  /** Offered by the cleavage preview as "Add ... to a collection" (US-01M7JPSK); absent, not offered. */
  onAddEnzymeToCollection?: (site: RestrictionCutSite) => void;
  /** Counted up by View › Fit and Reset View (US-01M7DVEN): each new value fits the whole molecule in the overview. */
  overviewFitKey?: number;
}

export interface SchematicFeaturePlaced {
  feature: SequenceFeature;
  lane: number;
  x1: number;
  x2: number;
  y: number;
  boxWidth: number;
  labelMode: 'inside' | 'outside-right' | 'outside-left' | 'none';
  displayLabel: string;
  labelX: number;
  textAnchor: 'middle' | 'start' | 'end';
  occStart: number;
  occEnd: number;
}

/** The most bases a sequence row holds, and the row length before the column has been measured. */
export const LINEAR_ROW_MAX_BASES = 60;
/** The fewest bases a sequence row holds, however narrow the column. */
export const LINEAR_ROW_MIN_BASES = 30;
/**
 * The width of one residue: Google Sans Code's 0.6 em advance (1200/2000) at the 12px residue size
 * (`.seq-strand-line`), plus the 0.25px letter spacing of `.mono-bases`.
 */
export const RESIDUE_ADVANCE_PX = 12 * 0.6 + 0.25;
/**
 * What a row spends beside its bases: the 68px start-coordinate gutter (`.coord-gutter`), then the
 * 8px gap and the end coordinate with its strand mark (`.coord-gutter-right`: room for 11
 * characters, "12345678 3'", of 11px Google Sans Code).
 */
export const LINEAR_ROW_GUTTER_PX = 68 + 8 + 11 * 11 * 0.6;

/**
 * The bases per sequence row for a column `widthPx` wide (the content width of the rows' scroll
 * area): the largest multiple of 10 whose row fits, from LINEAR_ROW_MIN_BASES to LINEAR_ROW_MAX_BASES.
 */
export function linearRowLength(widthPx: number, advancePx: number = RESIDUE_ADVANCE_PX): number {
  if (!Number.isFinite(widthPx) || !(advancePx > 0)) return LINEAR_ROW_MAX_BASES;
  const fits = Math.floor((widthPx - LINEAR_ROW_GUTTER_PX) / advancePx / 10) * 10;
  return Math.max(LINEAR_ROW_MIN_BASES, Math.min(LINEAR_ROW_MAX_BASES, fits));
}

const ROWS_PER_PAGE = 20;

/**
 * Where one strand's cut falls in the sequence row of bases `rowStart`..`rowEnd` (US-01M7CCR2): the
 * 0-based boundary into the row's bases (the cut lies just before the row's base `boundary`), or
 * null when the cut is not in this row or falls past an end of a linear molecule. A cut is marked
 * once, in the row of the first base after it: a cut between two rows opens the later one, and a
 * cut before base 1 of a circle opens the first row. A cut after a linear molecule's last base,
 * which no base follows, closes that base's row.
 */
export function cutBoundaryInRow(cut: CleavageCut, rowStart: number, rowEnd: number): number | null {
  if (!cut.available) return null;
  if (cut.firstBaseAfter !== null) {
    return cut.firstBaseAfter >= rowStart && cut.firstBaseAfter <= rowEnd ? cut.firstBaseAfter - rowStart : null;
  }
  return cut.position !== null && cut.position >= rowStart && cut.position <= rowEnd ? cut.position - rowStart + 1 : null;
}

/** The session-storage key of the 'Show cut marks' choice. */
const SHOW_CUT_MARKS_KEY = 'molbiocraft.sequenceView.showCutMarks';

/** The 'Show cut marks' choice made earlier this session; shown when none was made or the store cannot be read. */
function readShowCutMarks(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(SHOW_CUT_MARKS_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * A cut mark between two bases: a 2px rule in the text colour that takes no room in the row (its
 * border is cancelled by its margins) and no pointer events, so the bases under it click as before.
 */
const CUT_MARK_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 0,
  height: '1.2em',
  margin: '0 -1px',
  borderLeft: '2px solid var(--mbc-text-main)',
  verticalAlign: 'middle',
  pointerEvents: 'none',
};

const cutMark = (strand: 'top' | 'bottom') => (
  <span aria-hidden="true" data-cut-mark={strand} className="seq-cut-mark" style={CUT_MARK_STYLE} />
);

/**
 * A base of the shown CRISPR guide's spacer, and one of its PAM (US-01M7DVA6): the spacer is the
 * part a researcher orders and carries a solid underline, the PAM is only read by the nuclease and
 * carries a dotted one in another colour - so the two parts of a guide read apart without colour
 * alone saying which is which. One frozen object each, shared by every base of a part.
 */
const GUIDE_SPACER_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(22, 163, 74, 0.22)',
  borderBottom: '2px solid #15803d',
};
const GUIDE_PAM_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(217, 119, 6, 0.22)',
  borderBottom: '2px dotted #b45309',
};
/** The guide ribbon above the base rows: one line, out of the way of the selection quickbar. */
const GUIDE_RIBBON_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '3px 8px',
  marginBlockEnd: 4,
  border: '1px solid var(--mbc-border)',
  borderRadius: 4,
  fontSize: 11,
};
const SCHEMATIC_X0 = 38;
const SCHEMATIC_X1 = 762;
const SCHEMATIC_W = SCHEMATIC_X1 - SCHEMATIC_X0;

// ─── The linear overview's interval brush (US-01M7CCFQ, MB-NAV-01) ───

/** Width of each edge handle's hit target in screen (CSS) pixels, whatever the overview's scale. */
export const BRUSH_HANDLE_HIT_PX = 10;
/** Screen pixels a press must travel before it is a drag; less, and it stays a click. */
export const BRUSH_DRAG_THRESHOLD_PX = 3;

/**
 * The overview's scale, in SVG user units: base b (1-based) covers [x0 + (b-1)·width/length,
 * x0 + b·width/length), the same scale the schematic draws its ruler and feature pills with.
 * `unitsPerPx` converts screen pixels to SVG units (1 when the 800-unit SVG is 800 px wide).
 */
export interface BrushLayout {
  x0: number;
  width: number;
  length: number;
  unitsPerPx: number;
}

/** A drag in progress: `pending` until it travels BRUSH_DRAG_THRESHOLD_PX, then `active`. */
export type BrushDrag =
  | { phase: 'idle' }
  | {
      phase: 'pending' | 'active';
      mode: 'create' | 'move' | 'resize';
      edge: IntervalEdge | null;
      pointerId: number;
      downX: number;
      /** The selection when the press began: what a move or resize starts from and a cancel puts back. */
      before: ActiveInterval | null;
      /** The last interval this drag selected (null: none yet). */
      last: ActiveInterval | null;
    };

export type BrushInput =
  | { type: 'down'; x: number; pointerId: number; edge?: IntervalEdge | null }
  | { type: 'move' | 'up'; x: number; pointerId: number }
  | { type: 'cancel'; pointerId: number };

export interface BrushStepResult {
  drag: BrushDrag;
  /** Select exactly these bases (1-based inclusive, never start > end). */
  select?: ActiveInterval;
  /** The drag was cancelled after it selected: put back `restore` (null: clear the selection). */
  cancelled?: { restore: ActiveInterval | null };
}

export const BRUSH_IDLE: BrushDrag = { phase: 'idle' };

/**
 * The base under SVG x-coordinate `x`: floor((x - x0) · length / width) + 1, clamped to
 * 1..length. A cell boundary belongs to the base on its right; a point past either end is the
 * first or the last base.
 */
export function schematicBaseAt(x: number, layout: BrushLayout): number {
  const b = Math.floor(((x - layout.x0) * layout.length) / layout.width) + 1;
  return Math.min(layout.length, Math.max(1, b));
}

/** The SVG x of an interval's start edge (left boundary of `start`) and end edge (right boundary of `end`). */
function brushEdgeXs(interval: ActiveInterval, layout: BrushLayout): { startX: number; endX: number } {
  const per = layout.width / layout.length;
  return { startX: layout.x0 + (interval.start - 1) * per, endX: layout.x0 + interval.end * per };
}

/**
 * What a press at `x` does: within BRUSH_HANDLE_HIT_PX / 2 screen pixels of an edge it resizes
 * the nearer edge; inside the interval it moves it; anywhere else (or with no interval, or an
 * interval across a circle's origin, which the overview never drags) it creates a new one.
 */
export function brushHitTest(
  x: number,
  interval: ActiveInterval | null,
  layout: BrushLayout
): { mode: 'create' } | { mode: 'move' } | { mode: 'resize'; edge: IntervalEdge } {
  if (!interval || interval.start > interval.end) return { mode: 'create' };
  const { startX, endX } = brushEdgeXs(interval, layout);
  const half = (BRUSH_HANDLE_HIT_PX / 2) * layout.unitsPerPx;
  const dStart = Math.abs(x - startX);
  const dEnd = Math.abs(x - endX);
  if (Math.min(dStart, dEnd) < half) {
    if (dStart < dEnd) return { mode: 'resize', edge: 'start' };
    if (dEnd < dStart) return { mode: 'resize', edge: 'end' };
    return { mode: 'resize', edge: x < startX ? 'start' : 'end' };
  }
  return x > startX && x < endX ? { mode: 'move' } : { mode: 'create' };
}

const sameInterval = (a: ActiveInterval | null, b: ActiveInterval | null) =>
  a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end);

/**
 * The interval a drag at `x` covers. Create: from the base under the press to the base under
 * the pointer, both included. Move and resize: the pointer's travel rounded to whole bases
 * (Math.round of travel · length / width), applied with moveInterval / resizeIntervalBy on the
 * LINEAR model - so the overview never wraps through the ends and never makes an interval
 * across the origin, on either topology.
 */
function brushIntervalAt(drag: Exclude<BrushDrag, { phase: 'idle' }>, x: number, layout: BrushLayout): ActiveInterval {
  if (drag.mode === 'create' || !drag.before) {
    const a = schematicBaseAt(drag.downX, layout);
    const b = schematicBaseAt(x, layout);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  const d = Math.round(((x - drag.downX) * layout.length) / layout.width);
  return drag.mode === 'move'
    ? moveInterval(drag.before, d, layout.length, 'linear')
    : resizeIntervalBy(drag.before, drag.edge ?? 'end', d, layout.length, 'linear');
}

/**
 * One pointer event of the overview brush, as a pure step: the next drag state and what to
 * select. `current` is the selection when the event arrives (read only on the press); every
 * selected interval is 1-based inclusive with start <= end, inside 1..layout.length. The
 * topology is not consulted: on the linear overview a drag stays linear on a circle too, and an
 * interval across a circle's origin (start > end, made on the circular map) is never dragged -
 * a press on it starts a new interval - so the overview itself never selects start > end.
 * Non-finite positions, another pointer's events and a layout without bases are ignored.
 */
export function brushStep(
  drag: BrushDrag,
  input: BrushInput,
  ctx: { current: ActiveInterval | null; layout: BrushLayout; topology: Topology }
): BrushStepResult {
  const { layout } = ctx;
  if (!(layout.length >= 1) || !(layout.width > 0) || !Number.isFinite(layout.unitsPerPx)) return { drag: BRUSH_IDLE };
  if (input.type === 'down') {
    if (!Number.isFinite(input.x)) return { drag };
    const current =
      ctx.current && Number.isFinite(ctx.current.start) && Number.isFinite(ctx.current.end) ? ctx.current : null;
    const crossing = current !== null && current.start > current.end;
    const hit = brushHitTest(input.x, current, layout);
    const mode = crossing ? 'create' : input.edge ? 'resize' : hit.mode;
    const edge = mode === 'resize' ? input.edge ?? (hit.mode === 'resize' ? hit.edge : 'end') : null;
    return {
      drag: { phase: 'pending', mode, edge, pointerId: input.pointerId, downX: input.x, before: current, last: null },
    };
  }
  if (drag.phase === 'idle' || input.pointerId !== drag.pointerId) return { drag };
  if (input.type === 'cancel') {
    const result: BrushStepResult = { drag: BRUSH_IDLE };
    if (drag.phase === 'active' && drag.last !== null && !sameInterval(drag.last, drag.before)) {
      result.cancelled = { restore: drag.before };
    }
    return result;
  }
  if (!Number.isFinite(input.x)) return { drag };
  const travelled = Math.abs(input.x - drag.downX) >= BRUSH_DRAG_THRESHOLD_PX * layout.unitsPerPx;
  if (drag.phase === 'pending' && !travelled) return { drag: input.type === 'up' ? BRUSH_IDLE : drag };
  const next = brushIntervalAt(drag, input.x, layout);
  const changed = !sameInterval(next, drag.last ?? (drag.mode === 'create' ? null : drag.before));
  const nextDrag: BrushDrag = input.type === 'up' ? BRUSH_IDLE : { ...drag, phase: 'active', last: changed ? next : drag.last };
  return changed ? { drag: nextDrag, select: next } : { drag: nextDrag };
}

/**
 * An arrow key on an edge handle: one base (ten with Shift) towards higher coordinates for
 * ArrowRight / ArrowUp, lower for ArrowLeft / ArrowDown, with resizeIntervalBy on the linear
 * model (clamped to 1..length). When the edge passes the other one they swap, and `edge` names
 * the handle that now carries the moved base. Any other key gives null.
 */
export function brushKeyStep(
  interval: ActiveInterval,
  edge: IntervalEdge,
  key: string,
  shift: boolean,
  length: number,
  _topology: Topology
): { interval: ActiveInterval; edge: IntervalEdge } | null {
  const dir = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
  if (dir === 0 || !(length >= 1) || interval.start > interval.end) return null;
  const next = resizeIntervalBy(interval, edge, dir * (shift ? 10 : 1), length, 'linear');
  const other: IntervalEdge = edge === 'start' ? 'end' : 'start';
  const swapped = next[other] !== interval[other];
  return { interval: next, edge: swapped ? other : edge };
}

// ─── The linear overview's own zoom (US-01M7CCG9, CR-01M7CCSD) ───

/**
 * The overview's view: `scale` (1 = the whole molecule across the track) and `offset`, the pan in
 * SVG units. A 0-based base boundary `b` of a molecule of `length` bases is drawn at
 * x = SCHEMATIC_X0 + offset + (b / length) · SCHEMATIC_W · scale - the frame of wheelZoom's
 * anchoredOffset, screen = content × scale + offset, with content and screen measured from the
 * track's left end. The selection is not part of the view: zooming never changes it.
 */
export interface OverviewView {
  scale: number;
  offset: number;
}

export const OVERVIEW_FIT: OverviewView = { scale: 1, offset: 0 };
/** At the zoom bound one base is this many SVG units wide (12 px on an 800 px overview): single bases show. */
export const OVERVIEW_BASE_UNITS_AT_MAX = 12;
/** One press of + or - zooms by three wheel notches (1.08³ ≈ 1.26×). */
export const OVERVIEW_BUTTON_STEP_PX = 3 * WHEEL_NOTCH_PX;
/** From this width of a base (SVG units) the axis carries one tick per base. */
export const OVERVIEW_BASE_TICK_UNITS = 6;

/** The zoom bound for a molecule of `length` bases: the scale at which one base is OVERVIEW_BASE_UNITS_AT_MAX wide (never below 1). */
export function overviewMaxScale(length: number): number {
  const n = Number.isFinite(length) && length >= 1 ? length : 1;
  return Math.max(1, (OVERVIEW_BASE_UNITS_AT_MAX * n) / SCHEMATIC_W);
}

/**
 * A view held to its bounds: scale in 1..overviewMaxScale(length), and an offset that keeps the
 * track filled (SCHEMATIC_W · (1 - scale) .. 0), so no zoom or pan shows past the molecule's ends.
 * A view that is not finite is the fitted view.
 */
export function clampOverviewView(view: OverviewView, length: number): OverviewView {
  if (!Number.isFinite(view.scale) || !Number.isFinite(view.offset)) return OVERVIEW_FIT;
  const scale = Math.min(overviewMaxScale(length), Math.max(1, view.scale));
  const offset = Math.min(0, Math.max(SCHEMATIC_W * (1 - scale), view.offset));
  return { scale, offset };
}

/** Where 0-based base boundary `boundary` is drawn (SVG x) in `view`. */
export function overviewX(boundary: number, view: OverviewView, length: number): number {
  return SCHEMATIC_X0 + view.offset + (boundary / Math.max(1, length)) * SCHEMATIC_W * view.scale;
}

/** The brush's scale in `view`: the zoomed track's left end and width, so a pointer maps to the base drawn under it. */
export function overviewBrushLayout(view: OverviewView, length: number, unitsPerPx: number): BrushLayout {
  return { x0: SCHEMATIC_X0 + view.offset, width: SCHEMATIC_W * view.scale, length, unitsPerPx };
}

/** The first and last base the track shows in `view` (1-based, inclusive). */
export function overviewVisibleBases(view: OverviewView, length: number): { first: number; last: number } {
  const layout = overviewBrushLayout(view, length, 1);
  return { first: schematicBaseAt(SCHEMATIC_X0, layout), last: schematicBaseAt(SCHEMATIC_X1 - 1e-9, layout) };
}

/**
 * The view after zooming to `scale` about SVG x `anchorX`: the molecule point under the anchor
 * stays put (anchoredOffset), then the view is held to its bounds - so near either end of the
 * molecule the anchor gives way rather than show past the end. A non-finite anchor zooms about the
 * track's centre.
 */
export function overviewZoomTo(view: OverviewView, scale: number, anchorX: number, length: number): OverviewView {
  const from = clampOverviewView(view, length);
  const to = clampOverviewView({ scale, offset: from.offset }, length).scale;
  const anchor = zoomAnchorPoint({
    pointer: Number.isFinite(anchorX) ? { x: anchorX - SCHEMATIC_X0, y: 0 } : undefined,
    viewport: { x: 0, width: SCHEMATIC_W, height: 0 },
  });
  const offset = anchoredOffset({ pointer: anchor, offset: { x: from.offset, y: 0 }, fromScale: from.scale, toScale: to }).x;
  return clampOverviewView({ scale: to, offset }, length);
}

export interface OverviewWheelEvent extends WheelGestureLike {
  deltaMode?: number;
  /** The pointer's x in the overview's SVG units. */
  x: number;
}

/**
 * One wheel over the overview, the overview being a canvas (classifyWheelGesture): a vertical
 * wheel, plain or with Ctrl / Cmd / Alt, and a Chromium trackpad pinch (a ctrl-flagged wheel) zoom
 * by the shared multiplicative step about the pointer; a mostly horizontal or empty wheel is not
 * the overview's.
 */
export function overviewWheelStep(event: OverviewWheelEvent, view: OverviewView, length: number): { handled: boolean; view: OverviewView } {
  if (classifyWheelGesture(event, 'canvas') !== 'zoom') return { handled: false, view };
  const from = clampOverviewView(view, length);
  const scale = wheelZoomScale(from.scale, normalizeWheelDelta(event).y, { min: 1, max: overviewMaxScale(length) });
  return { handled: true, view: overviewZoomTo(from, scale, event.x, length) };
}

/**
 * The ruler in `view`: the fitted overview keeps its six ticks at 0, 20 .. 100% (labelled with
 * the base count up to there, at least 1); a zoomed one ticks the bases it shows at a 1-2-5 step
 * that gives about six labels.
 */
export function overviewRulerTicks(view: OverviewView, length: number): { x: number; label: number }[] {
  const n = Math.max(1, length);
  if (view.scale === 1 && view.offset === 0) {
    return [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((frac) => ({ x: SCHEMATIC_X0 + frac * SCHEMATIC_W, label: Math.max(1, Math.round(frac * n)) }));
  }
  const { first, last } = overviewVisibleBases(view, n);
  const span = Math.max(1, last - first + 1);
  const raw = span / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * pow).find((k) => k >= raw) ?? 10 * pow);
  const ticks: { x: number; label: number }[] = [];
  for (let b = Math.ceil((first - 1) / step) * step; b <= last && ticks.length < 50; b += step) {
    if (b < first - 1) continue;
    const x = overviewX(b, view, n);
    if (x >= SCHEMATIC_X0 - 0.5 && x <= SCHEMATIC_X1 + 0.5) ticks.push({ x, label: Math.max(1, b) });
  }
  return ticks;
}

type OverviewListener = (event: Event) => void;
/** The part of the overview's `<svg>` `bindOverviewWheel` needs. */
export interface OverviewWheelTarget {
  addEventListener(type: string, listener: OverviewListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: OverviewListener): void;
}

export interface OverviewWheelHooks {
  /** The view now, or null while the overview may not zoom (a brush drag is running). */
  read(): OverviewView | null;
  /** A client x in the overview's SVG units (NaN when it cannot be read). */
  toSvgX(clientX: number): number;
  length(): number;
  apply(view: OverviewView): void;
}

/**
 * Wheels and WebKit pinches on the overview `target`, as bindCircularMapWheel does for the circle:
 * non-passive, so a gesture the overview takes has its default (page scroll, page zoom) prevented
 * and one it does not take (a horizontal wheel) keeps it; the wheel deltas of one animation frame
 * are summed into one step. A WebKit pinch (gesturestart / gesturechange, as WKWebView and Safari
 * send it) zooms to the gesture's start scale times its `scale` about the pinch point; wheels sent
 * while it runs are prevented, not applied. Returns the function that removes every listener.
 */
export function bindOverviewWheel(target: OverviewWheelTarget, hooks: OverviewWheelHooks): () => void {
  const options: AddEventListenerOptions = { passive: false };
  let pending: OverviewWheelEvent | null = null;
  let frame: number | null = null;
  let gestureFrom: number | null = null;

  const flush = () => {
    frame = null;
    const event = pending;
    pending = null;
    const view = hooks.read();
    if (!event || !view) return;
    const step = overviewWheelStep(event, view, hooks.length());
    if (step.handled && (step.view.scale !== view.scale || step.view.offset !== view.offset)) hooks.apply(step.view);
  };
  const schedule = () => {
    if (frame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      // A frame that runs at once (flush clears `frame`) must not leave its id behind as pending.
      frame = -2;
      const id = requestAnimationFrame(flush);
      if (frame === -2) frame = id;
    } else {
      frame = -1;
      flush();
    }
  };
  const onWheel = (event: WheelEvent) => {
    if (classifyWheelGesture(event, 'canvas') !== 'zoom') return;
    event.preventDefault();
    if (gestureFrom !== null) return;
    pending = {
      deltaX: 0,
      deltaY: (pending?.deltaY ?? 0) + normalizeWheelDelta(event).y,
      deltaMode: 0,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      x: hooks.toSvgX(event.clientX),
    };
    schedule();
  };
  const onGestureStart = (event: Event & { scale?: number }) => {
    event.preventDefault();
    gestureFrom = hooks.read()?.scale ?? null;
    pending = null;
  };
  const onGestureChange = (event: Event & { scale?: number; clientX?: number }) => {
    event.preventDefault();
    const view = hooks.read();
    if (gestureFrom === null || !view || !(Number(event.scale) > 0)) return;
    const next = overviewZoomTo(view, gestureFrom * Number(event.scale), hooks.toSvgX(Number(event.clientX)), hooks.length());
    if (next.scale !== view.scale || next.offset !== view.offset) hooks.apply(next);
  };
  const onGestureEnd = (event: Event) => {
    event.preventDefault();
    gestureFrom = null;
  };
  const listeners: [string, OverviewListener][] = [
    ['wheel', onWheel as unknown as OverviewListener],
    ['gesturestart', onGestureStart as unknown as OverviewListener],
    ['gesturechange', onGestureChange as unknown as OverviewListener],
    ['gestureend', onGestureEnd as unknown as OverviewListener],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener, options);
  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener);
    if (frame !== null && frame !== -1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
}

// ─── Drag-selecting bases in the rows, and the navigation rule (US-01M7CCJC, MB-NAV-01) ───

/** A drag across the base rows: `pending` until it travels BRUSH_DRAG_THRESHOLD_PX, then `active`. */
export type RowDrag =
  | { phase: 'idle' }
  | {
      phase: 'pending' | 'active';
      pointerId: number;
      /** The base pressed: one edge of every interval the drag selects. */
      anchor: number;
      downX: number;
      downY: number;
      /** The selection when the press began, which a cancel puts back. */
      before: ActiveInterval | null;
      last: ActiveInterval | null;
    };

export const ROW_DRAG_IDLE: RowDrag = { phase: 'idle' };

/**
 * The selection quickbar's slot above the rows (BG-01M7CMT6): one line of a fixed height, drawn
 * with or without a selection, that neither wraps nor grows. A drag selects at every step, and the
 * bar's readout changes with it; a bar that appeared, or wrapped to a second line, at that moment
 * moved the rows 26-58 px under a pointer that had not moved, so the drag read the base of another
 * line. A readout too long for the line is cut short on screen and given whole in the bar's title.
 */
export const SELECTION_QUICKBAR_HEIGHT_PX = 32;
export const SELECTION_QUICKBAR_SLOT_STYLE: Readonly<React.CSSProperties> = Object.freeze({
  height: SELECTION_QUICKBAR_HEIGHT_PX,
  minHeight: SELECTION_QUICKBAR_HEIGHT_PX,
  maxHeight: SELECTION_QUICKBAR_HEIGHT_PX,
  boxSizing: 'border-box',
  flex: '0 0 auto',
  flexWrap: 'nowrap',
  overflow: 'hidden',
});

/** The quickbar's readout as one line of text, for its title (the bar may cut it short on screen). */
export function selectionQuickbarReadout(
  label: string | undefined,
  stats: { start: number; end: number; length: number; gcPercent: number | null; tmBasicC: number | null },
  unitLabel: string,
): string {
  const tm = stats.tmBasicC === null ? 'n/a' : `${stats.tmBasicC.toFixed(1)} °C`;
  const composition = stats.gcPercent === null ? '' : ` · GC ${stats.gcPercent.toFixed(1)}% · Tm ${tm}`;
  return (
    `${label ? `${label} · ` : ''}${stats.start.toLocaleString()}..${stats.end.toLocaleString()} ` +
    `(${stats.length.toLocaleString()} ${unitLabel}${composition})`
  );
}

/** A pointer event over the rows: `pos` is the 1-based base under it (its data-pos), or null over no base. */
export type RowDragInput =
  | { type: 'down'; pos: number; x: number; y: number; pointerId: number }
  | { type: 'move' | 'up'; pos: number | null; x: number; y: number; pointerId: number }
  | { type: 'cancel'; pointerId: number };

export type RowDragStepResult = Omit<BrushStepResult, 'drag'> & { drag: RowDrag };

/**
 * One pointer event of a drag across the base rows, as a pure step. The drag selects from the
 * base pressed to the base under the pointer, both included, in either direction (always
 * start <= end), across rows and - with the page turned under it - across pages. A press that
 * has not travelled BRUSH_DRAG_THRESHOLD_PX screen pixels is a click and selects nothing (the
 * base's own click then selects as it always has); over no base the drag keeps what it has.
 * Cancel puts back `before` when the drag had changed it.
 */
export function rowDragStep(drag: RowDrag, input: RowDragInput, current: ActiveInterval | null): RowDragStepResult {
  if (input.type === 'down') {
    if (!Number.isInteger(input.pos) || input.pos < 1 || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return { drag };
    return {
      drag: { phase: 'pending', pointerId: input.pointerId, anchor: input.pos, downX: input.x, downY: input.y, before: current, last: null },
    };
  }
  if (drag.phase === 'idle' || input.pointerId !== drag.pointerId) return { drag };
  if (input.type === 'cancel') {
    const result: RowDragStepResult = { drag: ROW_DRAG_IDLE };
    if (drag.phase === 'active' && drag.last !== null && !sameInterval(drag.last, drag.before)) {
      result.cancelled = { restore: drag.before };
    }
    return result;
  }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return { drag };
  const travelled = Math.hypot(input.x - drag.downX, input.y - drag.downY) >= BRUSH_DRAG_THRESHOLD_PX;
  if (drag.phase === 'pending' && !travelled) return { drag: input.type === 'up' ? ROW_DRAG_IDLE : drag };
  const active: RowDrag = { ...drag, phase: 'active' };
  const pos = input.pos;
  if (pos === null || !Number.isInteger(pos) || pos < 1) return { drag: input.type === 'up' ? ROW_DRAG_IDLE : active };
  const next = { start: Math.min(drag.anchor, pos), end: Math.max(drag.anchor, pos) };
  const changed = !sameInterval(next, drag.last);
  const nextDrag: RowDrag = input.type === 'up' ? ROW_DRAG_IDLE : { ...active, last: changed ? next : drag.last };
  return changed ? { drag: nextDrag, select: next } : { drag: nextDrag };
}

/**
 * Drop the page's text selection, if it holds one. A drag across the base rows selects bases, never
 * the page's text: without this, WebKit (the macOS app's engine) keeps a native selection over the
 * strands, frames and labels the drag crossed, and Cmd+C copies that text.
 */
export function clearNativeTextSelection(): void {
  const selection = typeof globalThis.getSelection === 'function' ? globalThis.getSelection() : null;
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) selection.removeAllRanges();
}

/** Stop (true) or allow again (false) native text selection in the rows, from the press on, in both engines. */
function holdRowsTextSelection(scroller: HTMLElement, hold: boolean): void {
  const style = scroller.style as (CSSStyleDeclaration & { webkitUserSelect?: string }) | undefined;
  if (!style) return;
  style.userSelect = hold ? 'none' : '';
  style.webkitUserSelect = hold ? 'none' : '';
}

/**
 * A row drag held past the rows' bottom (dir 1) or top (dir -1) edge: scroll the rows on while
 * they can scroll, then turn to the next (previous) page, then stop at the molecule's end.
 */
export function rowDragEdgeAction(
  m: { scrollTop: number; clientHeight: number; scrollHeight: number },
  dir: number,
  pageIndex: number,
  totalPages: number
): 'scroll' | 'next-page' | 'previous-page' | 'none' {
  if (dir > 0) {
    if (m.scrollTop + m.clientHeight < m.scrollHeight - 1) return 'scroll';
    return pageIndex < totalPages - 1 ? 'next-page' : 'none';
  }
  if (dir < 0) {
    if (m.scrollTop > 0) return 'scroll';
    return pageIndex > 0 ? 'previous-page' : 'none';
  }
  return 'none';
}

type RowsPane = Pick<HTMLElement, 'getBoundingClientRect' | 'querySelectorAll'>;
const rowBoxes = (scroller: RowsPane) =>
  Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-start]'))
    .map((row) => ({ start: Number(row.getAttribute('data-row-start')), box: row.getBoundingClientRect() }))
    .filter((r) => Number.isInteger(r.start) && r.start >= 1);

/**
 * The base a row drag held past an edge reaches: past the bottom, the last base of the last row
 * that shows in the pane; past the top, the first base of the first. Null when no row shows.
 */
export function rowDragEdgeBase(scroller: RowsPane, dir: number, basesPerRow: number, seqLen: number): number | null {
  const view = scroller.getBoundingClientRect();
  const rows = rowBoxes(scroller);
  if (dir > 0) {
    const shown = rows.filter((r) => r.box.top < view.bottom);
    const last = shown[shown.length - 1];
    return last ? Math.min(seqLen, last.start + basesPerRow - 1) : null;
  }
  const first = rows.find((r) => r.box.bottom > view.top);
  return first ? first.start : null;
}

/** The first base of the first row that shows in the rows' pane (its box reaches below the pane's top), or null. */
export function firstVisibleRowStart(scroller: RowsPane): number | null {
  const view = scroller.getBoundingClientRect();
  return rowBoxes(scroller).find((r) => r.box.bottom > view.top + 0.5)?.start ?? null;
}

/**
 * The navigation rule of the linear view (MB-NAV-01):
 * 1. The selection changes only by a direct edit - a drag on the overview or the rows, a click,
 *    a key on a handle, a jump or a search hit. Scrolling never selects.
 * 2. A new selection brings the page that holds its first base, and its row into view (a
 *    programmatic scroll) - unless a drag in the rows is making it: that drag owns the rows'
 *    view, so the bases stay under the pointer.
 * 3. When a scroll of the rows settles - the reader's or the one rule 2 made - the overview's
 *    navigation caret moves to the first row in view. It is a point, never a second range.
 * This is the page rule 2 gives: the selection's page, or the page shown while a row drag runs.
 */
export function selectionFollowPage(selectionPage: number | null, currentPage: number, rowDragging: boolean): number {
  return rowDragging || selectionPage === null ? currentPage : selectionPage;
}

/**
 * A pointer's clientX in the overview SVG's user units, through its screen transform (or, without
 * one, its box against the 800-unit viewBox), and the SVG units one screen pixel spans there.
 */
function overviewPoint(
  svg: Pick<SVGSVGElement, 'getBoundingClientRect'> & { getScreenCTM?: () => { a: number; e: number } | null },
  clientX: number
): { x: number; unitsPerPx: number } {
  const ctm = svg.getScreenCTM?.();
  if (ctm && Number.isFinite(ctm.a) && ctm.a > 0) return { x: (clientX - ctm.e) / ctm.a, unitsPerPx: 1 / ctm.a };
  const box = svg.getBoundingClientRect();
  const k = box.width > 0 ? 800 / box.width : 1;
  return { x: (clientX - box.left) * k, unitsPerPx: k };
}

function isDarkFillHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.62;
}

function classifyProteinResidueCss(aa: string): string {
  switch (aa) {
    case 'A':
    case 'V':
    case 'I':
    case 'L':
    case 'M':
    case 'F':
    case 'W':
    case 'C':
      return 'aa-hydrophobic';
    case 'R':
    case 'K':
    case 'H':
      return 'aa-basic';
    case 'D':
    case 'E':
      return 'aa-acidic';
    case 'G':
    case 'P':
      return 'aa-gly-pro';
    default:
      return 'aa-polar';
  }
}

/**
 * Multi-lane greedy interval packer for the Linear Schematic Overview Track.
 * Ensures feature pills and labels never overlap horizontally or clip past SVG edges.
 */
export function layoutLinearSchematicFeatures(
  features: SequenceFeature[],
  seqLen: number,
  maxLanes = 3,
  /** The overview's zoom (US-01M7CCG9); a zoomed layout places only the features the track shows. */
  view: OverviewView = OVERVIEW_FIT
): { placed: SchematicFeaturePlaced[]; laneCount: number } {
  const zoomed = view.scale !== 1 || view.offset !== 0;
  const safeLen = Math.max(1, seqLen);
  // the 360 longest, when there are more; the view says how many of the document's it drew
  const cappedFeatures =
    features.length > 360
      ? [...features]
          .sort((a, b) => {
            const aStart = Number(a.qualifiers?.genomic_start) || a.start;
            const bStart = Number(b.qualifiers?.genomic_start) || b.start;
            const aEnd = Number(a.qualifiers?.genomic_end) || a.end;
            const bEnd = Number(b.qualifiers?.genomic_end) || b.end;
            return (bEnd - bStart) - (aEnd - aStart);
          })
          .slice(0, 360)
      : features;
  const sorted = [...cappedFeatures].sort(
    (a, b) => {
      const aStart = Number(a.qualifiers?.genomic_start) || a.start;
      const bStart = Number(b.qualifiers?.genomic_start) || b.start;
      const aEnd = Number(a.qualifiers?.genomic_end) || a.end;
      const bEnd = Number(b.qualifiers?.genomic_end) || b.end;
      return aStart - bStart || (bEnd - bStart) - (aEnd - aStart);
    }
  );

  const CHAR_W = 6.35;
  const LANE_GAP_X = 6;
  const SVG_LEFT_LIMIT = 8;
  const SVG_RIGHT_LIMIT = 792;

  const laneEnds = new Array<number>(maxLanes).fill(-Infinity);
  const placed: SchematicFeaturePlaced[] = [];

  for (const f of sorted) {
    const fStart = Number(f.qualifiers?.genomic_start) || f.start;
    const fEnd = Number(f.qualifiers?.genomic_end) || f.end;
    const x1 = SCHEMATIC_X0 + view.offset + ((Math.max(1, fStart) - 1) / safeLen) * SCHEMATIC_W * view.scale;
    const x2 = Math.max(
      x1 + 8,
      Math.min(zoomed ? Infinity : SCHEMATIC_X1, SCHEMATIC_X0 + view.offset + (Math.min(safeLen, fEnd) / safeLen) * SCHEMATIC_W * view.scale)
    );
    if (zoomed && (x2 < SCHEMATIC_X0 || x1 > SCHEMATIC_X1)) continue;
    const boxWidth = x2 - x1;
    const fullTextW = f.name.length * CHAR_W + 12;

    let desiredMode: 'inside' | 'outside-right' | 'outside-left' = 'inside';
    let desiredLabel = f.name;
    let occStart = x1;
    let occEnd = x2;

    if (boxWidth >= fullTextW) {
      desiredMode = 'inside';
      desiredLabel = f.name;
      occStart = x1;
      occEnd = x2;
    } else if (boxWidth >= 52) {
      const maxChars = Math.max(4, Math.floor((boxWidth - 12) / CHAR_W));
      desiredMode = 'inside';
      desiredLabel =
        f.name.length > maxChars ? `${f.name.slice(0, maxChars - 1)}…` : f.name;
      occStart = x1;
      occEnd = x2;
    } else {
      const shortName = f.name.length > 18 ? `${f.name.slice(0, 17)}…` : f.name;
      const sideW = shortName.length * CHAR_W + 6;
      if (x2 + sideW <= SVG_RIGHT_LIMIT) {
        desiredMode = 'outside-right';
        desiredLabel = shortName;
        occStart = x1;
        occEnd = x2 + sideW;
      } else {
        desiredMode = 'outside-left';
        desiredLabel = shortName;
        occStart = Math.max(SVG_LEFT_LIMIT, x1 - sideW);
        occEnd = x2;
      }
    }

    let chosenLane = -1;
    for (let lane = 0; lane < maxLanes; lane++) {
      if (occStart >= laneEnds[lane] + LANE_GAP_X) {
        chosenLane = lane;
        break;
      }
    }

    if (chosenLane !== -1) {
      laneEnds[chosenLane] = occEnd;
      const y = 32 + chosenLane * 21;
      const labelX =
        desiredMode === 'inside'
          ? (x1 + x2) / 2
          : desiredMode === 'outside-right'
          ? x2 + 4
          : x1 - 4;
      const textAnchor =
        desiredMode === 'inside'
          ? 'middle'
          : desiredMode === 'outside-right'
          ? 'start'
          : 'end';

      placed.push({
        feature: f,
        lane: chosenLane,
        x1,
        x2,
        y,
        boxWidth,
        labelMode: desiredMode,
        displayLabel: desiredLabel,
        labelX,
        textAnchor,
        occStart,
        occEnd,
      });
    } else {
      let boxLane = 0;
      for (let lane = 1; lane < maxLanes; lane++) {
        if (laneEnds[lane] < laneEnds[boxLane]) {
          boxLane = lane;
        }
      }
      laneEnds[boxLane] = Math.max(laneEnds[boxLane], x2);
      placed.push({
        feature: f,
        lane: boxLane,
        x1,
        x2,
        y: 32 + boxLane * 21,
        boxWidth,
        labelMode: 'none',
        displayLabel: '',
        labelX: (x1 + x2) / 2,
        textAnchor: 'middle',
        occStart: x1,
        occEnd: x2,
      });
    }
  }

  const maxUsedLane = placed.reduce((acc, p) => Math.max(acc, p.lane), 0);
  return { placed, laneCount: Math.max(1, maxUsedLane + 1) };
}

export interface NucleotideColorEntry {
  symbol: string;
  description: string;
  blockColor: string;
  textColor: string;
  bgColor: string;
}

export const DEFAULT_NUCLEOTIDE_COLOR_PALETTE: NucleotideColorEntry[] = [
  { symbol: 'A', description: 'Adenine', blockColor: '#ef4444', textColor: '#111827', bgColor: '#fecaca' },
  { symbol: 'C', description: 'Cytosine', blockColor: '#3b82f6', textColor: '#111827', bgColor: '#bfdbfe' },
  { symbol: 'G', description: 'Guanine', blockColor: '#eab308', textColor: '#111827', bgColor: '#fef08a' },
  { symbol: 'T', description: 'Thymine / Uracil', blockColor: '#22c55e', textColor: '#111827', bgColor: '#bbf7d0' },
  { symbol: 'R', description: 'Purine (A or G)', blockColor: '#f97316', textColor: '#111827', bgColor: '#fed7aa' },
  { symbol: 'Y', description: 'Pyrimidine (C or T)', blockColor: '#14b8a6', textColor: '#111827', bgColor: '#99f6e4' },
  { symbol: 'M', description: 'Amino (A or C)', blockColor: '#a855f7', textColor: '#111827', bgColor: '#e9d5ff' },
  { symbol: 'W', description: 'Weak (A or T)', blockColor: '#84cc16', textColor: '#111827', bgColor: '#d9f99d' },
  { symbol: 'S', description: 'Strong (C or G)', blockColor: '#06b6d4', textColor: '#111827', bgColor: '#a5f3fc' },
  { symbol: 'K', description: 'Keto (G or T)', blockColor: '#65a30d', textColor: '#111827', bgColor: '#ecfccb' },
  { symbol: 'B', description: 'Not A (C, G, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'D', description: 'Not C (A, G, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'H', description: 'Not G (A, C, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'V', description: 'Not T (A, C, or G)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'N', description: 'Any base (A, C, G, or T)', blockColor: '#94a3b8', textColor: '#334155', bgColor: '#f1f5f9' },
  { symbol: 'I', description: 'Inosine', blockColor: '#94a3b8', textColor: '#334155', bgColor: '#f1f5f9' },
  { symbol: '?', description: 'Unloaded summary / Unknown', blockColor: '#cbd5e1', textColor: '#475569', bgColor: '#f8fafc' },
  { symbol: '-', description: 'Alignment Gap', blockColor: '#e2e8f0', textColor: '#64748b', bgColor: '#ffffff' },
];

export const NucleotideColorOptionsModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [entries, setEntries] = useState<NucleotideColorEntry[]>(DEFAULT_NUCLEOTIDE_COLOR_PALETTE);

  return (
    <div
      className="mbc-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Color Options"
      onClick={onClose}
    >
      <div
        className="mbc-modal-window"
        style={{ maxWidth: 540, width: '94%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mbc-modal-header">
          <h3>Color Options</h3>
          <button type="button" className="mbc-modal-close" onClick={onClose} aria-label="Close Color Options">
            ✕
          </button>
        </div>
        <div className="mbc-modal-body" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <div
            className="info-callout"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 4,
              marginBottom: 10,
              fontSize: 11.5,
            }}
          >
            <div>
              <strong>Block Swatch (Left):</strong> Used as the block color when zoomed out
            </div>
            <div>
              <strong>Text Swatch (Center):</strong> Used as the text color when zoomed in
            </div>
            <div>
              <strong>Background Swatch (Right):</strong> Used as the background color when zoomed in
            </div>
          </div>

          <table className="mbc-document-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>IUPAC Meaning</th>
                <th>Block Color</th>
                <th>Text Color</th>
                <th>Background</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, idx) => (
                <tr key={row.symbol}>
                  <td>
                    <strong
                      style={{
                        display: 'inline-block',
                        minWidth: 22,
                        textAlign: 'center',
                        padding: '1px 5px',
                        borderRadius: 3,
                        color: row.textColor,
                        backgroundColor: row.bgColor,
                        border: `1px solid ${row.blockColor}`,
                      }}
                    >
                      {row.symbol}
                    </strong>
                  </td>
                  <td>{row.description}</td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} block color`}
                      value={row.blockColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, blockColor: val } : item))
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} text color`}
                      value={row.textColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, textColor: val } : item))
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} background color`}
                      value={row.bgColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, bgColor: val } : item))
                        );
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="mbc-modal-footer"
          style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px' }}
        >
          <button
            type="button"
            className="btn-secondary-sm"
            onClick={() => setEntries(DEFAULT_NUCLEOTIDE_COLOR_PALETTE)}
          >
            Restore Defaults
          </button>
          <button type="button" className="btn-primary-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const AA_ORDER_20 = [
  'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L',
  'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', '*',
] as const;

const CODON_ORDER_64 = [
  'TTT', 'TTC', 'TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG',
  'ATT', 'ATC', 'ATA', 'ATG', 'GTT', 'GTC', 'GTA', 'GTG',
  'TCT', 'TCC', 'TCA', 'TCG', 'CCT', 'CCC', 'CCA', 'CCG',
  'ACT', 'ACC', 'ACA', 'ACG', 'GCT', 'GCC', 'GCA', 'GCG',
  'TAT', 'TAC', 'TAA', 'TAG', 'CAT', 'CAC', 'CAA', 'CAG',
  'AAT', 'AAC', 'AAA', 'AAG', 'GAT', 'GAC', 'GAA', 'GAG',
  'TGT', 'TGC', 'TGA', 'TGG', 'CGT', 'CGC', 'CGA', 'CGG',
  'AGT', 'AGC', 'AGA', 'AGG', 'GGT', 'GGC', 'GGA', 'GGG',
] as const;

export const GenomeInspectorExtras: React.FC<{
  doc: SequenceDocument;
  selectedRange: { start: number; end: number; label?: string } | null;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
}> = ({ doc, selectedRange, onSelectRange }) => {
  const isContigSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);
  const declaredLength =
    Number(doc.docMetadata?.['Declared Length']) ||
    Number(String(doc.docMetadata?.['Sequence Length'] ?? '').replace(/,/g, '')) ||
    doc.sequence.length;

  const typeGroups = useMemo(() => {
    const map = new Map<string, SequenceFeature[]>();
    for (const f of doc.features) {
      const rawType = f.qualifiers?.raw_type || f.type;
      const list = map.get(rawType) ?? [];
      list.push(f);
      map.set(rawType, list);
    }
    return Array.from(map.entries());
  }, [doc.features]);

  const [typeCursor, setTypeCursor] = useState<Record<string, number>>({});

  // What Translation Statistics translates, named on the panel (BG-01M6S17C): a selection that is
  // exactly a CDS (its start..end, the bounding span) is that CDS, any other selection is read on
  // its + strand, and with none it is the first CDS, else the first 900 bp. A joined CDS is read
  // from its parts alone, in the order the record lists them, and named by them in INSDC's join()
  // syntax: the GenBank importer keeps start..end as the lowest and highest base, so an
  // origin-spanning join(571..600,1..30) spans 1..600 and a spliced CDS spans its introns. A CDS on
  // the - strand is read from the reverse complement of its joined parts, as Biopython's
  // feature.extract() reads complement(join(...)). A range whose start is past its end, which the
  // GenBank and EMBL importers and Find ORFs never write (each splits an origin-spanning
  // range into parts) but a hand-built feature may carry, runs across the origin.
  const translationTelemetry = useMemo(() => {
    const seqLen = doc.sequence.length;
    const cdsList = doc.features.filter((f) => f.type === 'CDS' || f.qualifiers?.raw_type === 'CDS');
    const cds = selectedRange
      ? cdsList.find((f) => f.start === selectedRange.start && f.end === selectedRange.end)
      : cdsList[0];
    const start = cds?.start ?? selectedRange?.start ?? 1;
    const end = cds?.end ?? selectedRange?.end ?? Math.min(seqLen, 900);
    const minus = cds?.strand === -1;
    const joined = cds?.segments && cds.segments.length > 1 ? cds.segments : null;
    const parts: [number, number][] = joined
      ? joined.map((s) => [s.start, s.end])
      : start > end
        ? [[start, seqLen], [1, end]]
        : [[start, end]];
    const span = joined
      ? `join(${parts.map(([a, b]) => (a === b ? `${a}` : `${a}..${b}`)).join(',')})`
      : `${start.toLocaleString()}..${end.toLocaleString()}`;
    const rangeLabel = cds
      ? `CDS ${cds.name}, ${span}, ${minus ? '- strand, read from its reverse complement' : '+ strand'}`
      : selectedRange
        ? `Selection ${span}, + strand`
        : `${end < seqLen ? `First ${end.toLocaleString()} bp` : 'Whole sequence'}, ${span}, + strand`;
    const forward = parts
      .map(([a, b]) => doc.sequence.slice(Math.max(0, a - 1), Math.min(seqLen, b)))
      .join('')
      .toUpperCase()
      .replace(/U/g, 'T');
    const rawSub = minus && forward ? reverseComplement(forward) : forward;

    const codonCounts: Record<string, number> = {};
    const aaCounts: Record<string, number> = {};
    for (const c of CODON_ORDER_64) codonCounts[c] = 0;
    for (const a of AA_ORDER_20) aaCounts[a] = 0;

    let translatedAa = '';
    const totalCodons = Math.floor(rawSub.length / 3);
    for (let i = 0; i + 2 < rawSub.length; i += 3) {
      const codon = rawSub.slice(i, i + 3);
      if (codon in codonCounts) codonCounts[codon] += 1;
      const aa = CODON_TABLE[codon] ?? 'X';
      translatedAa += aa;
      if (aa in aaCounts) aaCounts[aa] += 1;
    }

    const cleanAa = translatedAa.replace(/\*/g, '');
    // No residue (no complete codon, or only stops) has no protein to measure.
    const protStats = cleanAa ? analyzeProteinSequence(cleanAa, false, 9) : null;
    const nW = aaCounts.W ?? 0;
    const nY = aaCounts.Y ?? 0;
    const nC = aaCounts.C ?? 0;
    const extinctionCoeff = nW * 5500 + nY * 1490 + Math.floor(nC / 2) * 125;
    const mwDa = Math.max(110, (protStats?.molecularWeightKda ?? 0) * 1000);
    const abs280 = extinctionCoeff / mwDa;
    const chargePh7 =
      (aaCounts.K ?? 0) +
      (aaCounts.R ?? 0) +
      0.1 * (aaCounts.H ?? 0) -
      (aaCounts.D ?? 0) -
      (aaCounts.E ?? 0);

    return {
      rangeLabel,
      codonsCount: totalCodons,
      hasResidues: protStats !== null,
      mwKda: protStats?.molecularWeightKda ?? 0,
      isoelectricPoint: protStats?.isoelectricPointPi ?? 0,
      chargePh7,
      extinctionCoeff,
      abs280,
      aaCounts,
      codonCounts,
    };
  }, [doc.features, doc.sequence, selectedRange]);

  const baseCountA = Number(doc.docMetadata?.['Base Count A']) || 0;
  const baseCountC = Number(doc.docMetadata?.['Base Count C']) || 0;
  const baseCountG = Number(doc.docMetadata?.['Base Count G']) || 0;
  const baseCountT = Number(doc.docMetadata?.['Base Count T']) || 0;
  const hasExplicitBaseCounts = baseCountA + baseCountC + baseCountG + baseCountT > 0;

  return (
    <div className="mbc-genome-inspector-extras" style={{ marginTop: 8 }}>
      <div className="stat-kv">
        <span>Sequence Length:</span>
        <strong>
          {declaredLength.toLocaleString()} {doc.moleculeType === 'RNA' ? 'nt' : 'bp'}
        </strong>
      </div>
      {isContigSummary && (
        <div className="stat-kv">
          <span>Summary Reference Bases (?):</span>
          <strong>?: 100.0% ({declaredLength.toLocaleString()} bp)</strong>
        </div>
      )}
      {hasExplicitBaseCounts && (
        <div className="stat-kv">
          <span>Organelle Base Counts (A/C/G/T):</span>
          <strong>
            {baseCountA.toLocaleString()} / {baseCountC.toLocaleString()} /{' '}
            {baseCountG.toLocaleString()} / {baseCountT.toLocaleString()}
          </strong>
        </div>
      )}
      {doc.docMetadata?.['Annotation Provider (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Annotation Provider:</span>
          <strong>{String(doc.docMetadata['Annotation Provider (Genome-Annotation-Data)'])}</strong>
        </div>
      )}
      {doc.docMetadata?.['Annotation Pipeline (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Annotation Pipeline:</span>
          <strong>{String(doc.docMetadata['Annotation Pipeline (Genome-Annotation-Data)'])}</strong>
        </div>
      )}
      {doc.docMetadata?.['Genes (total) (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Genes / CDSs (NCBI RefSeq):</span>
          <strong>
            {String(doc.docMetadata['Genes (total) (Genome-Annotation-Data)'])} genes •{' '}
            {String(doc.docMetadata['CDSs (total) (Genome-Annotation-Data)'] ?? '-')} CDSs
          </strong>
        </div>
      )}

      {typeGroups.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
            Annotation Types ({doc.features.length}):
          </strong>
          {typeGroups.map(([typeName, feats]) => {
            const cur = typeCursor[typeName] ?? 0;
            return (
              <div
                key={typeName}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11.5,
                  padding: '2px 0',
                }}
              >
                <span>
                  {typeName} ({feats.length})
                </span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button
                    type="button"
                    className="btn-page"
                    aria-label={`Previous ${typeName} annotation`}
                    onClick={() => {
                      const nextIdx = (cur - 1 + feats.length) % feats.length;
                      setTypeCursor((p) => ({ ...p, [typeName]: nextIdx }));
                      const f = feats[nextIdx];
                      if (f) {
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${typeName})`,
                        });
                      }
                    }}
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    className="btn-page"
                    aria-label={`Next ${typeName} annotation`}
                    onClick={() => {
                      const nextIdx = (cur + 1) % feats.length;
                      setTypeCursor((p) => ({ ...p, [typeName]: nextIdx }));
                      const f = feats[nextIdx];
                      if (f) {
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${typeName})`,
                        });
                      }
                    }}
                  >
                    &gt;
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!isContigSummary && doc.moleculeType !== 'Protein' && (
        <details style={{ marginTop: 8, fontSize: 11.5 }} open={doc.folder === 'Genomes/Viruses'}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            Translation Statistics ({translationTelemetry.codonsCount.toLocaleString()} aa / codons)
          </summary>
          <div style={{ marginTop: 6 }}>
            <div className="stat-kv">
              <span>Translated range:</span>
              <strong>{translationTelemetry.rangeLabel}</strong>
            </div>
            {translationTelemetry.codonsCount === 0 ? (
              <p className="mbc-summary-note">This range holds no complete codon to translate.</p>
            ) : (
              <>
                <div className="stat-kv">
                  <span>Length (mean):</span>
                  <strong>{translationTelemetry.codonsCount.toLocaleString()} aa (codons)</strong>
                </div>
                {translationTelemetry.hasResidues && (
                  <>
                    <div className="stat-kv">
                      <span>Molecular weight (mean):</span>
                      <strong>{translationTelemetry.mwKda.toFixed(2)} kDa</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Isoelectric point (mean):</span>
                      <strong>{translationTelemetry.isoelectricPoint.toFixed(2)}</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Charge at pH 7:</span>
                      <strong>{translationTelemetry.chargePh7.toFixed(2)}</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Extinction Coefficient (mean):</span>
                      <strong>{translationTelemetry.extinctionCoeff.toLocaleString()} M⁻¹cm⁻¹</strong>
                    </div>
                    <div className="stat-kv">
                      <span>A[280] of 1 mg/ml (mean):</span>
                      <strong>{translationTelemetry.abs280.toFixed(3)}</strong>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  <strong>20 Amino Acid Frequencies:</strong>{' '}
                  {AA_ORDER_20.map((aa) => `${aa}:${translationTelemetry.aaCounts[aa] ?? 0}`).join(' · ')}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.9 }}>
                  <strong>64-Codon Table:</strong>
                  {/* One line per second base (T, C, A, G), 16 codons each: all 64. */}
                  {[0, 16, 32, 48].map((from) => (
                    <div key={from}>
                      {CODON_ORDER_64.slice(from, from + 16)
                        .map((cod) => `${cod}(${CODON_TABLE[cod] ?? '*'}):${translationTelemetry.codonCounts[cod] ?? 0}`)
                        .join(' ')}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

/**
 * Scroll the row starting at `rowStart` to the top of the rows' scroll area when its top strand is
 * out of view there. A row holding an open cleavage preview is left alone: the preview has already
 * scrolled itself into view (US-01M7CC3B), and moving the row to the top would push it out again.
 */
export function revealSelectedRow(scroller: HTMLElement, rowStart: number): void {
  const row = scroller.querySelector<HTMLElement>(`[data-row-start="${rowStart}"]`);
  const strand = row?.querySelector<HTMLElement>('.top-strand');
  if (!row || !strand) return;
  if (row.querySelector('.mbc-cleavage-preview')) return;
  const view = scroller.getBoundingClientRect();
  const line = strand.getBoundingClientRect();
  if (line.top >= view.top && line.bottom <= view.bottom) return;
  const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
  scroller.scrollTop += row.getBoundingClientRect().top - view.top - padTop;
}

/** One action of the selection quickbar: shown inline when it fits, else in the bar's More menu. */
export interface QuickbarAction {
  key: string;
  label: string;
  title: string;
  run: () => void;
}

/** The gap between the quickbar's action buttons, in px (App.css .seq-selection-quickbar-actions). */
export const QUICKBAR_ACTION_GAP_PX = 5;

/**
 * How many of the quickbar's actions are shown inline in `available` px (BG-01M7CMT6): all of them
 * when they fit, else as many from the front as fit beside the More button that holds the rest.
 * The bar stays one line of a fixed height, so the actions that do not fit are never wrapped to a
 * second line or hidden behind a sideways scroll.
 */
export function quickbarInlineCount(widths: readonly number[], available: number, moreWidth: number, gap = QUICKBAR_ACTION_GAP_PX): number {
  const span = (n: number) => widths.slice(0, n).reduce((a, w) => a + w, 0) + Math.max(0, n - 1) * gap;
  if (!(available >= 0)) return 0;
  if (span(widths.length) <= available) return widths.length;
  let n = widths.length - 1;
  while (n > 0 && span(n) + gap + moreWidth > available) n--;
  return n;
}

/** The More menu's keys: the item to focus next, or that the menu closes (and focus returns to More). */
export function quickbarMenuKey(key: string, index: number, count: number): { focus?: number; close?: boolean } | null {
  if (count <= 0) return key === 'Escape' || key === 'Tab' ? { close: true } : null;
  switch (key) {
    case 'ArrowDown':
      return { focus: (index + 1) % count };
    case 'ArrowUp':
      return { focus: (index - 1 + count) % count };
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: count - 1 };
    case 'Escape':
    case 'Tab':
      return { close: true };
    default:
      return null;
  }
}

/**
 * Whether the linear toolbar folds its tools behind its Tools button (BG-01M7CRMG). Beside the
 * circle the card is as tall as the column, and the toolbar has what is left once every other strip
 * sits on its floor: `card` (the card's inner height) less `fixed` (the strips that never give: the
 * title row, the quickbar and any banner), the overview's floor and the rows' floor. A toolbar
 * whose every line (`toolbarFull`, its unfolded height) does not fit there folds, so its search and
 * pager lines stay in view and nothing it holds is left below a scroll with no sign of it.
 */
export function linearToolbarFolds(m: { card: number; fixed: number; overviewFloor: number; rowsFloor: number; toolbarFull: number }): boolean {
  return m.toolbarFull > m.card - m.fixed - m.overviewFloor - m.rowsFloor + 0.5;
}

/** A layout effect in a browser; on the server (which has no layout to read) a plain effect, unwarned. */
const useBrowserLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/** The quickbar's actions as drawn: the first `inlineCount` inline, the rest in the More menu. */
export function QuickbarActionStrip({
  actions,
  inlineCount,
  menuOpen,
  menuId,
  menuAt,
  onToggleMenu,
  onMoreKeyDown,
  onItemKeyDown,
  onItem,
  stripRef,
  measureRef,
  moreRef,
  itemRefs,
}: {
  actions: readonly QuickbarAction[];
  inlineCount: number;
  menuOpen: boolean;
  menuId: string;
  /** Where the open menu sits on screen (it is drawn fixed, so the bar's clipping never hides it). */
  menuAt?: { top: number; right: number } | null;
  onToggleMenu?: () => void;
  onMoreKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onItemKeyDown?: (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onItem?: (action: QuickbarAction) => void;
  stripRef?: React.Ref<HTMLDivElement>;
  measureRef?: React.Ref<HTMLDivElement>;
  moreRef?: React.Ref<HTMLButtonElement>;
  itemRefs?: React.MutableRefObject<(HTMLButtonElement | null)[]>;
}) {
  const n = Math.max(0, Math.min(actions.length, inlineCount));
  const rest = actions.slice(n);
  return (
    <div className="seq-selection-quickbar-actions" ref={stripRef}>
      {actions.slice(0, n).map((a) => (
        <button key={a.key} type="button" className="seq-quick-pill-btn" onClick={a.run} title={a.title}>
          {a.label}
        </button>
      ))}
      {rest.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          className="seq-quick-pill-btn seq-quick-more-btn"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={`More selection actions (${rest.length})`}
          title={`More: ${rest.map((a) => a.label).join(', ')}`}
          onClick={onToggleMenu}
          onKeyDown={onMoreKeyDown}
        >
          More ▾
        </button>
      )}
      {rest.length > 0 && menuOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label="More selection actions"
          className="seq-quick-more-menu"
          style={menuAt ? { position: 'fixed', top: menuAt.top, right: menuAt.right } : undefined}
        >
          {rest.map((a, i) => (
            <button
              key={a.key}
              ref={(el) => {
                if (itemRefs) itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className="seq-quick-more-item"
              title={a.title}
              tabIndex={-1}
              onClick={() => onItem?.(a)}
              onKeyDown={onItemKeyDown?.(i)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {/* The width of each action and of More, measured off screen to count what fits. */}
      <div className="seq-quick-measure" aria-hidden="true" ref={measureRef}>
        {actions.map((a) => (
          <span key={a.key} className="seq-quick-pill-btn">
            {a.label}
          </span>
        ))}
        <span className="seq-quick-pill-btn seq-quick-more-btn">More ▾</span>
      </div>
    </div>
  );
}

/**
 * The quickbar's actions, fitted to the bar's width as it changes (ResizeObserver): the props of
 * its QuickbarActionStrip. A hook of the view, not a component of its own, so the strip's buttons
 * are drawn in the view's render, as they were before the strip.
 */
function useQuickbarActions(actions: readonly QuickbarAction[]): React.ComponentProps<typeof QuickbarActionStrip> {
  /** How many actions fit inline; all of them until the strip has been measured. */
  const [fitCount, setFitCount] = useState<number | null>(null);
  const inlineCount = fitCount ?? actions.length;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const menuId = useId();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const keys = actions.map((a) => a.key).join('|');
  useEffect(() => {
    const strip = stripRef.current;
    const measure = measureRef.current;
    if (!strip || !measure) return;
    const fit = () => {
      const spans = Array.from(measure.children) as HTMLElement[];
      const widths = spans.map((el) => el.getBoundingClientRect().width);
      const more = widths.pop() ?? 0;
      setFitCount(quickbarInlineCount(widths.map(Math.ceil), Math.floor(strip.clientWidth), Math.ceil(more)));
    };
    fit();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(fit);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [keys]);
  const rest = actions.length - Math.min(actions.length, inlineCount);
  useEffect(() => {
    if (rest === 0) setMenuOpen(false);
  }, [rest]);
  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (stripRef.current?.contains(t) ?? false)) return;
      setMenuOpen(false);
    };
    const shut = () => setMenuOpen(false);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [menuOpen]);
  const open = (focusFirst: boolean) => {
    const r = moreRef.current?.getBoundingClientRect?.();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    setMenuAt(r ? { top: r.bottom + 4, right: Math.max(0, vw - r.right) } : null);
    setMenuOpen(true);
    if (focusFirst) requestAnimationFrame(() => itemRefs.current[0]?.focus());
  };
  const shutAndFocusMore = () => {
    setMenuOpen(false);
    moreRef.current?.focus();
  };
  return {
    actions,
    inlineCount,
    menuOpen,
    menuId,
    menuAt,
    stripRef,
    measureRef,
    moreRef,
    itemRefs,
    onToggleMenu: () => (menuOpen ? setMenuOpen(false) : open(false)),
    onMoreKeyDown: (e) => {
      if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && !menuOpen)) {
        e.preventDefault();
        open(true);
      } else if (e.key === 'Escape' && menuOpen) {
        e.preventDefault();
        setMenuOpen(false);
      }
    },
    onItemKeyDown: (i) => (e) => {
      const r = quickbarMenuKey(e.key, i, rest);
      if (!r) return;
      if (e.key !== 'Tab') e.preventDefault();
      if (r.close) shutAndFocusMore();
      else if (r.focus !== undefined) itemRefs.current[r.focus]?.focus();
    },
    onItem: (a) => {
      shutAndFocusMore();
      a.run();
    },
  };
}

export const LinearSequenceView: React.FC<LinearSequenceViewProps> = ({
  doc,
  cutSites,
  siteVisibility = null,
  restrictionScope = null,
  selectedRange,
  guideHighlight = null,
  onSelectRange,
  onUpdateDocument,
  showTranslation = true,
  showGcGraph = true,
  showHydropathyGraph = false,
  showFeatures = true,
  showRestrictionSites = true,
  colorScheme = 'standard',
  onLoadBenchmarkDocument,
  onClearSelection,
  onExtractSelection,
  onConvertSelectionToOligo,
  onStatusNotice,
  onViewEnzyme,
  onAddEnzymeToCollection,
  overviewFitKey = 0,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [jumpCoordInput, setJumpCoordInput] = useState('');
  /**
   * Where the rows' scroll last settled: the first row in view, for the page `key` it was read on
   * (another document, page or row length starts from the page's first base again).
   */
  const [settledRows, setSettledRows] = useState<{ key: string; base: number } | null>(null);
  const settledRowsRef = useRef<{ key: string; base: number } | null>(null);
  const rowsKeyRef = useRef('');
  /** The drag across the base rows (US-01M7CCJC); while it runs it owns the rows' view. */
  const rowDragRef = useRef<RowDrag>(ROW_DRAG_IDLE);
  const rowSuppressClickRef = useRef(false);
  const rowEdgeRef = useRef<{ dir: number; timer: ReturnType<typeof setInterval> | null; x: number; y: number }>({
    dir: 0,
    timer: null,
    x: 0,
    y: 0,
  });
  /** After a row drag turns the page: show the new page from its top (1) or its bottom (-1). */
  const rowTurnScrollRef = useRef(0);
  const [showAddFeature, setShowAddFeature] = useState(false);
  const [newFeatName, setNewFeatName] = useState('New_Annotation');
  const [newFeatType, setNewFeatType] = useState<FeatureType>('CDS');
  // An origin-crossing selection (start > end) is not a feature's start..end: never prefilled (BG-01M7CG2W).
  const prefillable = selectedRange && selectedRange.start <= selectedRange.end ? selectedRange : null;
  const [newFeatStart, setNewFeatStart] = useState(prefillable?.start ?? 1);
  const [newFeatEnd, setNewFeatEnd] = useState(prefillable?.end ?? 120);
  const [newFeatStrand, setNewFeatStrand] = useState<1 | -1>(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [colorOptionsOpen, setColorOptionsOpen] = useState(false);
  const [showDownloadSummaryTab, setShowDownloadSummaryTab] = useState(false);
  /** The one cut site whose cleavage preview is open (US-01M7CC3B), and the marker that opened it. */
  const [previewCutId, setPreviewCutId] = useState<string | null>(null);
  const previewMarkerRef = useRef<HTMLElement | null>(null);
  /** Whether the base rows mark the previewed site's cuts (US-01M7CCR2), kept for the session. */
  const [showCutMarks, setShowCutMarks] = useState(readShowCutMarks);
  const toggleCutMarks = (on: boolean) => {
    setShowCutMarks(on);
    try {
      globalThis.sessionStorage?.setItem(SHOW_CUT_MARKS_KEY, on ? '1' : '0');
    } catch {
      // The store is unavailable: the choice still holds in this view.
    }
  };
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  /** The schematic track, so its Export control saves the map and not a graph below it. */
  const schematicRef = useRef<HTMLDivElement | null>(null);
  /** The card and its toolbar, measured to fold the toolbar's tools when its lines do not fit. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolsPanelRef = useRef<HTMLDivElement | null>(null);
  const toolsPanelId = useId();
  const [toolsFolded, setToolsFolded] = useState(false);
  /** The search hits' control on a folded toolbar, and the list it opens. */
  const hitsButtonRef = useRef<HTMLButtonElement | null>(null);
  const hitsPanelRef = useRef<HTMLDivElement | null>(null);
  const hitsPanelId = useId();
  const addFormRef = useRef<HTMLFormElement | null>(null);
  /** Which of a folded toolbar's panels is open, and where on screen (they are drawn fixed). */
  const [openPanel, setOpenPanel] = useState<null | 'tools' | 'hits'>(null);
  const [panelAt, setPanelAt] = useState<{ top: number; left: number } | null>(null);
  /** Where focus goes once a panel closes on a choice: its button, the opened form or the dialog. */
  const [focusAfter, setFocusAfter] = useState<null | 'tools' | 'hits' | 'form' | 'dialog'>(null);
  /** The height the new-annotation form covers at the foot of the rows while it lies over them. */
  const [formReserve, setFormReserve] = useState(0);
  const toolsOpen = openPanel === 'tools';
  const hitsOpen = openPanel === 'hits';

  const rawLen = doc.sequence.length;
  const seqLen = Math.max(1, rawLen);
  const isProtein = doc.moleculeType === 'Protein';
  const unitLabel = isProtein ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp';
  const isContigSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);
  const declaredLen =
    Number(doc.docMetadata?.['Declared Length']) ||
    Number(String(doc.docMetadata?.['Sequence Length'] ?? '').replace(/,/g, '')) ||
    seqLen;

  // Fetch the real record from NCBI; never synthesize bases for a summary.
  const handleDownloadFullSequence = async () => {
    setShowDownloadSummaryTab(false);
    onStatusNotice?.(`Downloading ${doc.accession || doc.name} (${declaredLen.toLocaleString()} ${unitLabel}) from NCBI…`);
    try {
      const full = await downloadSummarySequence({ ...doc, sequence: '' });
      onUpdateDocument({ ...full, features: doc.features });
      onStatusNotice?.(`Downloaded ${doc.accession}: ${full.sequence.length.toLocaleString()} ${unitLabel} from NCBI.`);
    } catch (err) {
      onStatusNotice?.(`Download failed: ${err instanceof Error ? err.message : String(err)} The record is unchanged.`);
    }
  };

  // Rows wrap to the width of their column: the rows' scroll area is measured when it is drawn and
  // whenever it resizes. Until then (a static render) a row holds LINEAR_ROW_MAX_BASES.
  const [basesPerRow, setBasesPerRow] = useState(LINEAR_ROW_MAX_BASES);
  const rowsResizeObserverRef = useRef<ResizeObserver | null>(null);
  const attachRowsScroll = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
    rowsResizeObserverRef.current?.disconnect();
    rowsResizeObserverRef.current = null;
    if (!el) return;
    const measure = () => {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      const padding = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
      const width = el.clientWidth - padding;
      // A hidden column (no width) keeps the row length it was last drawn at.
      if (width > 0) setBasesPerRow(linearRowLength(width));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      rowsResizeObserverRef.current = observer;
    }
  }, []);

  const totalRows = Math.max(1, Math.ceil(seqLen / basesPerRow));
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
  const safePageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));

  // The selection as the active-interval model reads it (BG-01M7CG2W): on a circular molecule
  // start > end crosses the origin; a linear molecule never has start > end.
  const selectionIv = useMemo(
    () => (rawLen === 0 ? null : selectionInterval(selectedRange, seqLen, doc.topology)),
    [selectedRange, rawLen, seqLen, doc.topology]
  );
  /**
   * The shown guide's two parts as the active-interval model reads them (US-01M7DVA6), with the
   * bases of each read from this document 5'->3' on the guide's own strand: the reverse complement
   * of the plus strand for a reverse guide, so the letters shown as the spacer read as the guide's
   * spacer and not as its complement (AC2). A part across the origin is read round it, both arcs,
   * because `intervalSequence` follows `start > end` (AC3, BG-01M7CG2W).
   */
  const guideParts = useMemo(() => {
    if (!guideHighlight || rawLen === 0) return null;
    const spacer = selectionInterval(guideHighlight.spacer, seqLen, doc.topology);
    const pam = selectionInterval(guideHighlight.pam, seqLen, doc.topology);
    if (!spacer || !pam) return null;
    const asRead = (iv: ActiveInterval) => {
      const plus = intervalSequence(doc.sequence, iv);
      return guideHighlight.strand === -1 ? reverseComplement(plus) : plus;
    };
    return { spacer, pam, spacerBases: asRead(spacer), pamBases: asRead(pam) };
  }, [guideHighlight, doc.sequence, doc.topology, rawLen, seqLen]);

  // The first base of the selection in reading order, and the page that holds it at this row length.
  const selectionStart = selectionIv ? selectionIv.start : null;
  const selectionPage =
    selectionStart === null ? null : Math.floor(Math.floor((selectionStart - 1) / basesPerRow) / ROWS_PER_PAGE);
  // A new row length keeps the selection's first base on the page or, with nothing selected, the
  // base the page started with.
  const [pagedRowLength, setPagedRowLength] = useState(basesPerRow);
  if (pagedRowLength !== basesPerRow) {
    setPagedRowLength(basesPerRow);
    setPageIndex(selectionPage ?? Math.floor((safePageIndex * pagedRowLength) / basesPerRow));
  }
  // Another document starts on its first page (or, below, on the page of its selection).
  const [pagedDocId, setPagedDocId] = useState(doc.id);
  if (pagedDocId !== doc.id) {
    setPagedDocId(doc.id);
    setPageIndex(0);
  }
  // A new selection (a feature clicked on the circle, a search hit, a jump) brings its first base
  // onto the page; the effect below scrolls its row into view inside the rows' own scroll area.
  // A drag in the base rows owns their view, so its selection moves no page (selectionFollowPage).
  const followKey = selectionStart === null ? null : `${doc.id}:${selectionStart}`;
  const [followedKey, setFollowedKey] = useState<string | null>(null);
  if (followKey !== followedKey) {
    setFollowedKey(followKey);
    if (selectionPage !== null) {
      setPageIndex(selectionFollowPage(selectionPage, safePageIndex, rowDragRef.current.phase !== 'idle'));
    }
  }
  rowsKeyRef.current = `${doc.id}:${safePageIndex}:${basesPerRow}`;
  // What a row drag's edge timer reads between renders.
  const safePageIndexRef = useRef(safePageIndex);
  safePageIndexRef.current = safePageIndex;
  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;
  const basesPerRowRef = useRef(basesPerRow);
  basesPerRowRef.current = basesPerRow;

  // A page a row drag turned is shown from the edge the drag came in by; an unmount stops its timer.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    const dir = rowTurnScrollRef.current;
    rowTurnScrollRef.current = 0;
    if (!scroller || dir === 0) return;
    scroller.scrollTop = dir > 0 ? 0 : scroller.scrollHeight;
  }, [safePageIndex]);
  useEffect(
    () => () => {
      if (rowEdgeRef.current.timer !== null) clearInterval(rowEdgeRef.current.timer);
    },
    []
  );

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [doc.id]);

  // The selected row is scrolled to the top of the rows' scroll area when it is out of view there.
  // Only that area scrolls: the page and the viewer stay where they are.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (selectionStart === null || !scroller || typeof requestAnimationFrame !== 'function') return undefined;
    // A selection a drag in the rows is making is already under the pointer: no scroll.
    if (rowDragRef.current.phase !== 'idle') return undefined;
    const rowStart = Math.floor((selectionStart - 1) / basesPerRow) * basesPerRow + 1;
    const reveal = () => {
      if (rowDragRef.current.phase === 'idle') revealSelectedRow(scroller, rowStart);
    };
    reveal();
    // Rows drawn on demand (content-visibility) take their real height once in view, so look again.
    let second = 0;
    const first = requestAnimationFrame(() => {
      reveal();
      second = requestAnimationFrame(reveal);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, safePageIndex, basesPerRow]);

  // When a scroll of the rows settles (native `scrollend`, or 120 ms after the last `scroll`
  // where a WebView has none), the overview's navigation caret moves to the first row in view.
  // It only ever sets that caret - never the selection - and only when the row changed, so a
  // scroll the selection caused cannot select again or loop (the navigation rule, rule 3).
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const supportsNativeScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScrollEnd = () => {
      const base = firstVisibleRowStart(el);
      if (base === null) return;
      const key = rowsKeyRef.current;
      const was = settledRowsRef.current;
      if (was && was.key === key && was.base === base) return;
      settledRowsRef.current = { key, base };
      setSettledRows(settledRowsRef.current);
    };

    const handleScrollFallback = () => {
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        el.dispatchEvent(new CustomEvent('scrollend'));
      }, 120);
    };

    el.addEventListener('scrollend', handleScrollEnd);
    if (!supportsNativeScrollEnd) {
      el.addEventListener('scroll', handleScrollFallback, { passive: true });
    }

    return () => {
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      el.removeEventListener('scrollend', handleScrollEnd);
      if (!supportsNativeScrollEnd) {
        el.removeEventListener('scroll', handleScrollFallback);
      }
    };
  }, [doc.id, safePageIndex]);

  // The features the maps draw: none while View › Tracks hides them (US-01M7DV8W).
  const trackFeatures = useMemo(() => (showFeatures ? doc.features : []), [doc.features, showFeatures]);
  const schematicLayout = useMemo(
    () => layoutLinearSchematicFeatures(trackFeatures, declaredLen, 3),
    [trackFeatures, declaredLen]
  );
  const schematicHeight = Math.max(76, 36 + schematicLayout.laneCount * 22);
  // The schematic draws the longest features when there are more than it holds, and says so (BG-01M6S1AA).
  const schematicCoverage = subsetNote('The map draws', schematicLayout.placed.length, trackFeatures.length, 'features', 'longest');

  // ─── The overview's one active interval and its brush (US-01M7CCFQ) ───
  // The overview draws on the declared length, as its ruler and pills do; so does the brush.
  const overviewLen = Math.max(1, Math.round(declaredLen) || 1);
  const overviewInterval: ActiveInterval | null = useMemo(() => {
    if (!selectedRange) return null;
    try {
      return normaliseInterval(selectedRange, overviewLen, doc.topology === 'circular' ? 'circular' : 'linear');
    } catch {
      return null; // a non-finite selection draws nothing rather than a wrong range
    }
  }, [selectedRange, overviewLen, doc.topology]);
  /** SVG units per screen pixel of the overview, measured when drawn, so handles stay 10 px wide. */
  const [overviewUnitsPerPx, setOverviewUnitsPerPx] = useState(1);
  const overviewResizeRef = useRef<ResizeObserver | null>(null);
  // The overview's own zoom (US-01M7CCG9), kept per document: another document opens fitted.
  const [overviewZoom, setOverviewZoom] = useState<{ docId: string; view: OverviewView }>({ docId: doc.id, view: OVERVIEW_FIT });
  const [overviewFittedFor, setOverviewFittedFor] = useState(overviewFitKey);
  if (overviewFittedFor !== overviewFitKey) {
    setOverviewFittedFor(overviewFitKey);
    setOverviewZoom({ docId: doc.id, view: OVERVIEW_FIT });
  }
  const overviewView = overviewZoom.docId === doc.id ? clampOverviewView(overviewZoom.view, overviewLen) : OVERVIEW_FIT;
  const overviewViewRef = useRef(overviewView);
  overviewViewRef.current = overviewView;
  const overviewLenRef = useRef(overviewLen);
  overviewLenRef.current = overviewLen;
  const docIdRef = useRef(doc.id);
  docIdRef.current = doc.id;
  // The pills as the zoomed track shows them; the fitted view reuses the whole-map layout.
  const overviewLayout = useMemo(
    () =>
      overviewView.scale === 1 && overviewView.offset === 0
        ? schematicLayout
        : layoutLinearSchematicFeatures(trackFeatures, declaredLen, 3, overviewView),
    [schematicLayout, trackFeatures, declaredLen, overviewView.scale, overviewView.offset]
  );
  const overviewClipId = `mbc-overview-clip-${doc.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  /** Zoom the overview by `deltaPx` (wheel pixels; negative zooms in) about the selection's centre when the track shows it, else the track's centre. */
  const zoomOverviewBy = (deltaPx: number) => {
    const scale = wheelZoomScale(overviewView.scale, deltaPx, { min: 1, max: overviewMaxScale(overviewLen) });
    const centre = overviewInterval && overviewInterval.start <= overviewInterval.end
      ? (overviewX(overviewInterval.start - 1, overviewView, overviewLen) + overviewX(overviewInterval.end, overviewView, overviewLen)) / 2
      : NaN;
    const anchor = centre >= SCHEMATIC_X0 && centre <= SCHEMATIC_X1 ? centre : NaN;
    setOverviewZoom({ docId: doc.id, view: overviewZoomTo(overviewView, scale, anchor, overviewLen) });
  };
  const overviewZoomPercent = Math.round(overviewView.scale * 100);
  /** The whole schematic, unzoomed, as markup: what the linear map's Export saves (AC4). */
  const overviewFileDrawingRef = useRef<() => string>(() => '');
  const overviewUnbindRef = useRef<(() => void) | null>(null);
  const attachOverview = useCallback((svg: SVGSVGElement | null) => {
    overviewResizeRef.current?.disconnect();
    overviewResizeRef.current = null;
    overviewUnbindRef.current?.();
    overviewUnbindRef.current = null;
    if (!svg) return;
    setFigureFileDrawing(svg, () => overviewFileDrawingRef.current());
    overviewUnbindRef.current = bindOverviewWheel(svg, {
      // A running brush drag keeps the scale its press was read at.
      read: () => (brushDragRef.current.phase === 'idle' ? overviewViewRef.current : null),
      toSvgX: (clientX) => overviewPoint(svg, clientX).x,
      length: () => overviewLenRef.current,
      apply: (view) => {
        // The next wheel may come before React has drawn this one: it reads the zoom it set.
        overviewViewRef.current = clampOverviewView(view, overviewLenRef.current);
        setOverviewZoom({ docId: docIdRef.current, view: overviewViewRef.current });
      },
    });
    const measure = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setOverviewUnitsPerPx(800 / w);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      overviewResizeRef.current = new ResizeObserver(measure);
      overviewResizeRef.current.observe(svg);
    }
  }, []);
  const brushDragRef = useRef<BrushDrag>(BRUSH_IDLE);
  const brushLayoutRef = useRef<BrushLayout | null>(null);
  /** The newest pointer position not yet worked: the drag does its work once per animation frame. */
  const brushPendingRef = useRef<{ x: number; pointerId: number; frame: number } | null>(null);
  const brushSuppressClickRef = useRef(false);
  const handleRefs = useRef<Record<IntervalEdge, SVGRectElement | null>>({ start: null, end: null });

  const applyBrush = (input: BrushInput): BrushStepResult | null => {
    const layout = brushLayoutRef.current;
    if (!layout) return null;
    const r = brushStep(brushDragRef.current, input, { current: overviewInterval, layout, topology: doc.topology });
    brushDragRef.current = r.drag;
    if (r.select) onSelectRange({ start: r.select.start, end: r.select.end });
    if (r.cancelled) {
      if (r.cancelled.restore) onSelectRange({ start: r.cancelled.restore.start, end: r.cancelled.restore.end });
      else onClearSelection?.();
    }
    return r;
  };
  const dropBrushFrame = () => {
    const pending = brushPendingRef.current;
    brushPendingRef.current = null;
    if (pending && pending.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pending.frame);
  };
  const releaseBrush = (svg: Element, pointerId: number) => {
    try {
      svg.releasePointerCapture?.(pointerId);
    } catch {
      // The capture is already gone.
    }
  };
  const onOverviewPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    const svg = e.currentTarget;
    const p = overviewPoint(svg, e.clientX);
    brushLayoutRef.current = overviewBrushLayout(overviewView, overviewLen, p.unitsPerPx);
    brushSuppressClickRef.current = false;
    dropBrushFrame();
    brushDragRef.current = BRUSH_IDLE;
    const hint = (e.target as Element | null)?.getAttribute?.('data-interval-handle');
    applyBrush({ type: 'down', x: p.x, pointerId: e.pointerId, edge: hint === 'start' || hint === 'end' ? hint : null });
  };
  const onOverviewPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = brushDragRef.current;
    if (drag.phase === 'idle') return;
    const { x, unitsPerPx } = overviewPoint(e.currentTarget, e.clientX);
    // The pointer is captured only once the press has become a drag: captured from the press, a
    // plain click would land on the overview instead of the feature pill under it.
    if (drag.phase === 'pending' && Math.abs(x - drag.downX) >= BRUSH_DRAG_THRESHOLD_PX * unitsPerPx) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Without capture the drag still follows the pointer while it is over the overview.
      }
    }
    if (typeof requestAnimationFrame !== 'function') {
      applyBrush({ type: 'move', x, pointerId: e.pointerId });
      return;
    }
    if (brushPendingRef.current) {
      brushPendingRef.current = { ...brushPendingRef.current, x, pointerId: e.pointerId };
      return;
    }
    const pending = { x, pointerId: e.pointerId, frame: 0 };
    brushPendingRef.current = pending;
    pending.frame = requestAnimationFrame(() => {
      const latest = brushPendingRef.current;
      brushPendingRef.current = null;
      if (latest) applyBrush({ type: 'move', x: latest.x, pointerId: latest.pointerId });
    });
  };
  const onOverviewPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const before = brushDragRef.current;
    if (before.phase === 'idle') return;
    dropBrushFrame();
    const r = applyBrush({ type: 'up', x: overviewPoint(e.currentTarget, e.clientX).x, pointerId: e.pointerId });
    // A drag ends in a click on whatever it was released over; that click is the drag's, not a pill's.
    brushSuppressClickRef.current = before.phase === 'active' || Boolean(r?.select);
    releaseBrush(e.currentTarget, e.pointerId);
  };
  const onOverviewPointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    if (brushDragRef.current.phase === 'idle') return;
    dropBrushFrame();
    applyBrush({ type: 'cancel', pointerId: e.pointerId });
    releaseBrush(e.currentTarget, e.pointerId);
  };
  const onOverviewClickCapture = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!brushSuppressClickRef.current) return;
    brushSuppressClickRef.current = false;
    e.stopPropagation();
  };
  const onHandleKeyDown = (edge: IntervalEdge) => (e: React.KeyboardEvent<SVGRectElement>) => {
    if (!overviewInterval) return;
    const r = brushKeyStep(overviewInterval, edge, e.key, e.shiftKey, overviewLen, doc.topology);
    if (!r) return;
    e.preventDefault();
    onSelectRange({ start: r.interval.start, end: r.interval.end });
    if (r.edge !== edge) handleRefs.current[r.edge]?.focus();
  };

  // ─── Drag-selecting bases in the rows (US-01M7CCJC) ───
  // The selection a drag started from, as it is - an origin-crossing one included, label and all -
  // so a cancelled drag puts back exactly that selection (BG-01M7CG2W). A drag itself only ever
  // selects start <= end.
  const currentSelection: ActiveInterval | null = selectedRange;
  const applyRowDrag = (input: RowDragInput) => {
    const r = rowDragStep(rowDragRef.current, input, currentSelection);
    rowDragRef.current = r.drag;
    if (r.select) onSelectRange({ start: r.select.start, end: r.select.end });
    if (r.cancelled) {
      if (r.cancelled.restore) onSelectRange(r.cancelled.restore);
      else onClearSelection?.();
    }
    return r;
  };
  /** The base under a pointer: the element at the point (the rows hold the capture), else the event's target. */
  const rowPosAt = (e: React.PointerEvent<HTMLDivElement>): number | null => {
    const hit =
      typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(e.clientX, e.clientY)
        : null;
    const base = ((hit ?? e.target) as Element | null)?.closest?.('[data-pos]');
    const pos = base ? Number(base.getAttribute('data-pos')) : NaN;
    return Number.isInteger(pos) && pos >= 1 ? pos : null;
  };
  const stopRowEdge = () => {
    const edge = rowEdgeRef.current;
    if (edge.timer !== null) clearInterval(edge.timer);
    edge.timer = null;
    edge.dir = 0;
  };
  const endRowDrag = (scroller: HTMLDivElement, pointerId: number) => {
    stopRowEdge();
    clearNativeTextSelection();
    holdRowsTextSelection(scroller, false);
    try {
      scroller.releasePointerCapture?.(pointerId);
    } catch {
      // The capture is already gone.
    }
  };
  /** Held past the rows' top or bottom edge, the drag scrolls on, then turns the page (rowDragEdgeAction). */
  const rowEdgeTick = (scroller: HTMLDivElement, pointerId: number) => {
    const { dir, x, y } = rowEdgeRef.current;
    const action = rowDragEdgeAction(scroller, dir, safePageIndexRef.current, totalPagesRef.current);
    if (action === 'scroll') scroller.scrollTop += dir * 46;
    else if (action === 'next-page' || action === 'previous-page') {
      rowTurnScrollRef.current = dir;
      setPageIndex((p) => Math.max(0, Math.min(totalPagesRef.current - 1, p + dir)));
      return; // the new page's rows are read on the next tick
    }
    // Scrolled, or at the molecule's end with nothing left to scroll: reach the edge's base now.
    const pos = rowDragEdgeBase(scroller, dir, basesPerRowRef.current, seqLen);
    if (pos !== null) applyRowDrag({ type: 'move', pos, x, y, pointerId });
  };
  const onRowsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    rowSuppressClickRef.current = false;
    stopRowEdge();
    rowDragRef.current = ROW_DRAG_IDLE;
    const pos = rowPosAt(e);
    if (pos === null) return;
    // A press on a base starts no native text selection (its default is prevented, and the rows
    // take no text selection until the drag ends); a plain click still follows, and the rows keep
    // the keyboard focus a press would have given them.
    e.preventDefault();
    clearNativeTextSelection();
    holdRowsTextSelection(e.currentTarget, true);
    try {
      e.currentTarget.focus?.({ preventScroll: true });
    } catch {
      // Focus is a convenience here.
    }
    applyRowDrag({ type: 'down', pos, x: e.clientX, y: e.clientY, pointerId: e.pointerId });
    // A press that never becomes a drag lets text selection back in when it is released.
    if (rowDragRef.current.phase === 'idle') holdRowsTextSelection(e.currentTarget, false);
  };
  const onRowsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const before = rowDragRef.current;
    if (before.phase === 'idle') return;
    const scroller = e.currentTarget;
    applyRowDrag({ type: 'move', pos: rowPosAt(e), x: e.clientX, y: e.clientY, pointerId: e.pointerId });
    const now = rowDragRef.current;
    if (now.phase !== 'active') return;
    if (before.phase === 'pending') {
      // Captured only once it is a drag, so a plain click still reaches its base.
      try {
        scroller.setPointerCapture?.(e.pointerId);
      } catch {
        // Without capture the drag still follows the pointer over the rows.
      }
    }
    clearNativeTextSelection();
    const box = scroller.getBoundingClientRect?.();
    const dir = !box ? 0 : e.clientY > box.bottom ? 1 : e.clientY < box.top ? -1 : 0;
    const edge = rowEdgeRef.current;
    edge.x = e.clientX;
    edge.y = e.clientY;
    if (dir === 0) stopRowEdge();
    else if (edge.timer === null || edge.dir !== dir) {
      stopRowEdge();
      edge.dir = dir;
      const pointerId = e.pointerId;
      edge.timer = setInterval(() => rowEdgeTick(scroller, pointerId), 250);
    }
  };
  const onRowsPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const before = rowDragRef.current;
    if (before.phase === 'idle') return;
    const r = applyRowDrag({ type: 'up', pos: rowPosAt(e), x: e.clientX, y: e.clientY, pointerId: e.pointerId });
    // The click that ends a drag is the drag's, not the 20-base click of the base under it.
    rowSuppressClickRef.current = before.phase === 'active' || Boolean(r.select);
    endRowDrag(e.currentTarget, e.pointerId);
  };
  const onRowsPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rowDragRef.current.phase === 'idle') return;
    applyRowDrag({ type: 'cancel', pointerId: e.pointerId });
    endRowDrag(e.currentTarget, e.pointerId);
  };
  const onRowsClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rowSuppressClickRef.current) return;
    rowSuppressClickRef.current = false;
    e.stopPropagation();
  };

  // Resident Rust sequence store track overview (cached 180-bin GC%, AT%, cumulative GC-skew, oriC/terC)
  const trackOverview = useMemo(
    () => getResidentTrackOverviewRust(doc, 180),
    [doc]
  );
  const meanGc = meanGcWords(trackOverview);

  const gcProfilePoints = useMemo(() => {
    const gcBins = trackOverview.gcFractionBins;
    const atBins = trackOverview.atFractionBins;
    const skewBins = trackOverview.cumulativeGcSkewBins;
    const n = Math.max(1, gcBins.length);
    const gcPts: string[] = [];
    const atPts: string[] = [];
    const skewPts: string[] = [];

    let maxAbsSkew = 1e-6;
    for (let i = 0; i < skewBins.length; i++) {
      const a = Math.abs(skewBins[i]);
      if (a > maxAbsSkew) maxAbsSkew = a;
    }

    for (let i = 0; i < n; i++) {
      const x = SCHEMATIC_X0 + (i / Math.max(1, n - 1)) * SCHEMATIC_W;
      const yGc = 60 - (gcBins[i] ?? 0.5) * 36;
      const yAt = 60 - (atBins[i] ?? 0.5) * 36;
      const normSkew = 0.5 + ((skewBins[i] ?? 0) / (2 * maxAbsSkew));
      const ySkew = 60 - Math.max(0, Math.min(1, normSkew)) * 34;
      gcPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yGc.toFixed(1)}`);
      atPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yAt.toFixed(1)}`);
      skewPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ySkew.toFixed(1)}`);
    }
    return {
      gcPath: gcPts.join(' '),
      atPath: atPts.join(' '),
      skewPath: skewPts.join(' '),
    };
  }, [trackOverview]);

  const startRow = safePageIndex * ROWS_PER_PAGE;
  const endRow = Math.min(totalRows, startRow + ROWS_PER_PAGE);
  const pageStartPos = Math.min(seqLen, startRow * basesPerRow + 1);
  const pageEndPos = Math.max(pageStartPos, Math.min(seqLen, endRow * basesPerRow));
  const lookaheadEndPos = Math.min(seqLen, pageEndPos + 2);

  // Single O(window + log F) Resident Rust WASM viewport slice for the entire active page (<= 1,202 bp/aa)
  const pageSlice = useMemo(
    () => sliceResidentViewportRust(doc, pageStartPos, lookaheadEndPos),
    [doc, pageStartPos, lookaheadEndPos]
  );

  // Kyte-Doolittle Hydrophobicity profile computed over a bounded 1,800 bp/aa Resident viewport slice
  const hydropathyPath = useMemo(() => {
    if (!showHydropathyGraph) return '';
    const sampleSlice = sliceResidentViewportRust(
      doc,
      pageStartPos,
      Math.min(seqLen, pageStartPos + 1799)
    );
    const prot = analyzeProteinSequence(sampleSlice.topStrand, !isProtein, 9);
    const prof = prot.hydrophobicityProfile;
    if (prof.length === 0) return '';
    return prof
      .map((pt, idx) => {
        const x = SCHEMATIC_X0 + (idx / Math.max(1, prof.length - 1)) * SCHEMATIC_W;
        const norm = (pt.score + 4.5) / 9.0;
        const y = 60 - Math.max(0, Math.min(1, norm)) * 36;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [doc, pageStartPos, seqLen, showHydropathyGraph, isProtein]);

  // Resident Rust `rust-bio` FM-Index / BWT backward motif search across full multi-megabase sequences:
  // the first 100 hits by position on both strands, and the number of hits in the whole sequence.
  const searchResult = useMemo((): ResidentMotifSearchResult => {
    const q = searchQuery.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (q.length < 3) return { hits: [], totalHits: 0, warnings: [] };
    return searchResidentMotifFmIndexRust(doc, q, !isProtein, 100);
  }, [doc, searchQuery, isProtein]);
  const searchMatches = searchResult.hits;

  const handleJumpToCoordinate = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(jumpCoordInput.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const clampedPos = Math.max(1, Math.min(seqLen, parsed));
    const targetRow = Math.floor((clampedPos - 1) / basesPerRow);
    setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
    onSelectRange({
      start: clampedPos,
      end: Math.min(seqLen, clampedPos + 19),
      label: `Coordinate ${clampedPos.toLocaleString()} ${unitLabel}`,
    });
  };

  /** A cut marker's click (or Enter/Space): select the recognition span, as before, and preview the cut. */
  const openCleavagePreview = (c: RestrictionCutSite, marker: HTMLElement) => {
    onSelectRange({
      start: c.position,
      end: c.position + c.enzyme.recognitionSeq.length - 1,
      label: `${enzymeLabel(c.enzyme)} (${c.overhangType}: ${c.overhangSeq || 'blunt'})`,
    });
    previewMarkerRef.current = marker;
    setPreviewCutId(c.id);
  };
  /** Close the preview and put focus back on the marker that opened it. */
  const closeCleavagePreview = () => {
    setPreviewCutId(null);
    previewMarkerRef.current?.focus();
  };
  // None while View › Tracks hides restriction sites (US-01M7DV8W): an open preview then closes.
  const displayedCutSites = useMemo(
    () =>
      !showRestrictionSites
        ? []
        : siteVisibility
        ? applySiteVisibility(cutSites, siteVisibility.revision, siteVisibility.state, { uniqueCuttersOnly: false }).displayed
        : cutSites,
    [cutSites, siteVisibility, showRestrictionSites]
  );
  const previewCut = previewCutId === null ? undefined : displayedCutSites.find((c) => c.id === previewCutId);
  // A preview whose site is hidden (or gone in a rescan) closes, and stays closed if it is shown again.
  useEffect(() => {
    if (previewCutId !== null && !previewCut) setPreviewCutId(null);
  }, [previewCutId, previewCut]);
  const previewDomId = `cleavage-preview-${doc.id}`;
  /** The previewed site's two-strand picture, whose cuts the base rows mark where the preview draws them. */
  const previewPicture = useMemo(
    () => (previewCut && !isProtein ? cleavagePicture(previewCut, doc.sequence, doc.topology === 'circular') : null),
    [previewCut, isProtein, doc.sequence, doc.topology]
  );

  const handleCreateFeature = (e: React.FormEvent) => {
    e.preventDefault();
    const s = Math.max(1, Math.min(seqLen, Number(newFeatStart)));
    const end = Math.max(s, Math.min(seqLen, Number(newFeatEnd)));
    const newFeat: SequenceFeature = {
      id: `feat-user-${Date.now()}`,
      name: newFeatName.trim() || 'Annotation',
      type: newFeatType,
      start: s,
      end,
      strand: newFeatStrand,
      color:
        newFeatType === 'CDS'
          ? '#10b981'
          : newFeatType === 'promoter'
          ? '#0284c7'
          : newFeatType === 'crispr_guide'
          ? '#dc2626'
          : '#d97706',
      notes: 'Added in Sequence View',
    };
    onUpdateDocument({
      ...doc,
      features: [...doc.features, newFeat],
      updatedAt: new Date().toISOString(),
    });
    setShowAddFeature(false);
  };

  const pageOverlappingFeatures = useMemo(() => {
    if (!showFeatures) return [];
    if (pageSlice.overlappingFeatureIndices.length > 0) {
      return pageSlice.overlappingFeatureIndices
        .map((idx) => doc.features[idx])
        .filter((f): f is SequenceFeature => Boolean(f));
    }
    return doc.features.filter((f) => f.end >= pageStartPos && f.start <= pageEndPos);
  }, [doc.features, pageSlice.overlappingFeatureIndices, pageStartPos, pageEndPos, showFeatures]);

  const pageCuts = useMemo(
    () =>
      isProtein
        ? []
        : displayedCutSites.filter((c) => c.position >= pageStartPos && c.position <= pageEndPos),
    [displayedCutSites, isProtein, pageStartPos, pageEndPos]
  );
  // A partial cut-site scan says where it stops (BG-01M6RRSV): on every page that reaches past the
  // scanned range, and on every page of a scan with a reduced catalog, so a stretch with no sites
  // drawn does not read as one with none. A reduced catalog says which bases it scanned (the whole
  // sequence, or only the first), so it does not read as part of the sequence left out (BG-01M6RTP1).
  const scanFirst = isProtein ? undefined : restrictionScope?.firstBp?.toLocaleString();
  const scanCore = isProtein ? undefined : restrictionScope?.coreEnzymes?.toLocaleString();
  // A chosen collection (US-01M7JPK6) is named in place of the core enzymes, by the members scanned.
  const scanCollection = isProtein ? undefined : restrictionScope?.collection;
  const collectionSet = scanCollection && scanCollection.scanned > 0 ? collectionScanSet(scanCollection, 'of') : undefined;
  const cutScanNote =
    scanFirst && pageEndPos > (restrictionScope?.firstBp ?? 0)
      ? `Cut sites are shown for the first ${scanFirst} bp${scanCore ? ` and for ${scanCore} core enzymes` : collectionSet ? ` and for ${collectionSet}` : ''} only: the rest was not scanned.`
      : scanCore
        ? `Cut sites are shown for ${scanCore} core enzymes only: ${scanFirst ? `the first ${scanFirst} bp were` : 'the whole sequence was'} scanned for them, and not for other enzymes.`
        : scanCollection
          ? collectionSet
            ? `Cut sites are shown for ${collectionSet} only: other enzymes were not scanned.`
            : emptyCollectionScanWords(scanCollection.name)
          : null;

  const pagePrimers = useMemo(
    () =>
      isProtein
        ? []
        : doc.primers.filter((p) => p.bindEnd >= pageStartPos && p.bindStart <= pageEndPos),
    [doc.primers, isProtein, pageStartPos, pageEndPos]
  );

  const rows = useMemo(() => {
    const builtRows = [];
    const topPage = pageSlice.topStrand;
    const botPage = pageSlice.bottomStrand;
    const protSsPage = pageSlice.proteinSecondaryStates ?? '';
    const protClsPage = pageSlice.proteinResidueClasses ?? '';

    for (let r = startRow; r < endRow; r++) {
      const rowStart = r * basesPerRow + 1;
      const rowEnd = Math.min(seqLen, (r + 1) * basesPerRow);
      const localOffset = rowStart - pageStartPos;
      const rowLen = Math.max(0, rowEnd - rowStart + 1);
      const topSlice = topPage.slice(localOffset, localOffset + rowLen);
      const botSlice = isProtein ? '' : botPage.slice(localOffset, localOffset + rowLen);
      const protSecondarySlice = isProtein
        ? protSsPage.slice(localOffset, localOffset + rowLen)
        : '';
      const protClassSlice = isProtein
        ? protClsPage.slice(localOffset, localOffset + rowLen)
        : '';

      const rowCuts = pageCuts.filter(
        (c) => c.position >= rowStart && c.position <= rowEnd
      );
      const rowFeatures = pageOverlappingFeatures.filter(
        (f) => f.end >= rowStart && f.start <= rowEnd
      );
      const rowPrimers = pagePrimers.filter(
        (p) => p.bindEnd >= rowStart && p.bindStart <= rowEnd
      );

      const buildFrameLine = (frameOffset: number) => {
        if (isProtein) return '';
        let line = '';
        for (let i = 0; i < topSlice.length; i++) {
          const globalZeroIdx = rowStart - 1 + i;
          const localCenterIdx = localOffset + i;
          if (
            (globalZeroIdx - frameOffset) % 3 === 1 &&
            globalZeroIdx >= frameOffset + 1 &&
            localCenterIdx >= 1 &&
            localCenterIdx + 1 < topPage.length
          ) {
            const codon = topPage
              .slice(localCenterIdx - 1, localCenterIdx + 2)
              .replace(/U/g, 'T');
            line += CODON_TABLE[codon] ?? 'X';
          } else {
            line += ' ';
          }
        }
        return line;
      };

      builtRows.push({
        rowStart,
        rowEnd,
        topSlice,
        botSlice,
        protSecondarySlice,
        protClassSlice,
        rowCuts,
        rowFeatures,
        rowPrimers,
        frame1: buildFrameLine(0),
        frame2: buildFrameLine(1),
        frame3: buildFrameLine(2),
      });
    }
    return builtRows;
  }, [
    startRow,
    endRow,
    basesPerRow,
    seqLen,
    pageStartPos,
    pageSlice,
    isProtein,
    pageCuts,
    pageOverlappingFeatures,
    pagePrimers,
  ]);

  /** Each row with the boundaries of the previewed site's top- and bottom-strand cuts in it, while marks are shown. */
  const markedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        marks:
          previewPicture && showCutMarks
            ? {
                top: cutBoundaryInRow(previewPicture.topCut, row.rowStart, row.rowEnd),
                bottom: cutBoundaryInRow(previewPicture.bottomCut, row.rowStart, row.rowEnd),
              }
            : { top: null, bottom: null },
      })),
    [rows, previewPicture, showCutMarks]
  );

  /** The overview's navigation caret: the first row in view once the rows' scroll settled, else the page's first base. */
  const settledViewportStartPos =
    settledRows && settledRows.key === `${doc.id}:${safePageIndex}:${basesPerRow}`
      ? Math.min(pageEndPos, Math.max(pageStartPos, settledRows.base))
      : pageStartPos;

  /** The quickbar's whole readout, as the bar's accessible description (it may be cut short on screen). */
  const quickbarReadoutId = useId();
  const selectionQuickStats = useMemo(() => {
    if (!selectionIv) return null;
    // An origin-crossing selection's bases are the end of the molecule then its start, read from
    // `bases` at [from, to); any other is read in place on the sequence.
    const { start, end } = selectionIv;
    const crossing = start > end;
    const bases = crossing ? intervalSequence(doc.sequence, selectionIv) : doc.sequence;
    const from = crossing ? 0 : start - 1;
    const to = crossing ? bases.length : end;
    const length = to - from;
    if (isProtein) {
      return {
        start,
        end,
        crossing,
        sequence: () => bases.slice(from, to),
        length,
        gcPercent: null as number | null,
        tmBasicC: null as number | null,
        tmNoAnswerReason: null as string | null,
      };
    }
    // GC and Tm are the whole selection's, beside its full length, in one pass over its bases with no
    // copy (BG-01M6RTHN): they were taken from its first 12,000 bp only. They follow the engine's
    // status-bar readout (analyze_sequence_composition, iupac.rs): N and the other IUPAC codes
    // (S and W too) count toward the length only, so GC and the Tm divide by the A/C/G/T(U) count,
    // and the Wallace rule holds below 14 bases. The length the Tm reads is the selection's letters,
    // as the composition counts them: a gap ('-'), a stop ('*') or any other character that is not
    // a letter is no base, so it is neither in that length nor an ambiguity base.
    let gc = 0;
    let at = 0;
    let letters = 0;
    for (let i = from; i < to; i++) {
      const code = bases.charCodeAt(i);
      const ch = code | 0x20; // folded to lower case
      if (ch === 0x67 || ch === 0x63) gc++; // g, c
      else if (ch === 0x61 || ch === 0x74 || ch === 0x75) at++; // a, t, u
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) letters++; // a letter, a base
    }
    const denom = Math.max(1, gc + at);
    const gcPercent = (gc / denom) * 100;
    // Whether the Tm has an answer is the cockpit's rule, read here and kept nowhere else
    // (basicTmHasNoAnswer, BG-01M6SHQ0): a selection holding N or any other base that is not A, C,
    // G or T has none, "Tm n/a" with the shared reason as its title, as in the status bar. It kept
    // its own copy, which read 26 N and 14 A/C/G/T as 37.4 °C. Otherwise the Wallace rule holds
    // below 14 bases and the basic formula from 14 up, on the bases: a gap counted in the length
    // read ACGTACGT-ACGTAC as "n/a: ... holds 1 N", and ACGTACGT-ACGTA by the 14-base formula.
    const tmNoAnswerReason = basicTmHasNoAnswer(letters, gc + at) ? tmNoAnswerSentence(letters - (gc + at)) : null;
    const tmBasicC =
      tmNoAnswerReason !== null ? null : letters < 14 ? 2 * at + 4 * gc : 64.9 + (41 * (gc - 16.4)) / denom;
    return {
      start,
      end,
      crossing,
      sequence: () => bases.slice(from, to),
      length,
      gcPercent: Math.max(0, Math.min(100, gcPercent)),
      tmBasicC,
      tmNoAnswerReason,
    };
  }, [selectionIv, isProtein, doc.sequence]);

  /** The quickbar's actions, in order; those that do not fit its one line go to its More menu. */
  const quickbarActions: QuickbarAction[] = [];
  const stats = selectionQuickStats;
  if (stats) {
    quickbarActions.push(
      {
        key: 'copy',
        label: isProtein ? 'Copy AA' : "Copy 5'→3'",
        title: isProtein ? 'Copy selected amino acid sequence' : "Copy selected 5'→3' sequence",
        run: () => {
          const sub = stats.sequence();
          navigator.clipboard?.writeText(sub);
          onStatusNotice?.(
            `Copied ${sub.length.toLocaleString()} ${unitLabel} (${stats.start}..${stats.end}) to clipboard.`
          );
        },
      },
      ...(!isProtein
        ? [
            {
              key: 'revcomp',
              label: 'Copy RevComp',
              title: 'Copy Reverse Complement of selected region',
              run: () => {
                const sub = stats.sequence();
                const rc = reverseComplement(sub);
                navigator.clipboard?.writeText(rc);
                onStatusNotice?.(
                  `Copied Reverse Complement (${rc.length.toLocaleString()} bp, ${stats.start}..${stats.end}) to clipboard.`
                );
              },
            },
          ]
        : []),
      {
        key: 'annotate',
        label: '+ Annotate',
        title: 'Create a new feature annotation spanning the active selection',
        run: () => {
          if (stats.crossing) {
            onStatusNotice?.(
              `Annotate: the selection ${stats.start}..${stats.end} runs across the origin; a feature is added on one side of it only. Select within the molecule, or set the origin first.`
            );
            return;
          }
          setNewFeatStart(stats.start);
          setNewFeatEnd(stats.end);
          setShowAddFeature(true);
        },
      },
      ...(onExtractSelection
        ? [{ key: 'extract', label: 'Extract Region', title: 'Extract selected region into a new sequence document', run: onExtractSelection }]
        : []),
      ...(!isProtein && stats.length >= 12 && stats.length <= 80 && onConvertSelectionToOligo
        ? [{ key: 'oligo', label: '+ Save Oligo', title: 'Save selected 12–80 bp region as a primer/oligo', run: onConvertSelectionToOligo }]
        : []),
      ...(onClearSelection
        ? [{ key: 'clear', label: 'Clear', title: 'Clear active sequence selection', run: onClearSelection }]
        : []),
    );
  }
  const quickbarStrip = useQuickbarActions(quickbarActions);

  /**
   * The overview's drawing in `view` (US-01M7CCG9). On screen (`live`) it is drawn in the current
   * zoom, clipped to the track, with the focusable edge handles; for a file it is drawn whole, in
   * the fitted view, without them - so the linear map's Export saves the whole schematic, never
   * the zoomed window.
   */
  const drawOverview = (view: OverviewView, live: boolean) => {
    const zoomed = view.scale !== 1 || view.offset !== 0;
    return (
      <>
          <rect x="0" y="0" width="800" height={schematicHeight} fill="var(--mbc-bg-panel)" />
          <line
            x1={SCHEMATIC_X0}
            y1="23"
            x2={SCHEMATIC_X1}
            y2="23"
            stroke="var(--mbc-border-strong)"
            strokeWidth="1.5"
          />
          {zoomed && (
            <clipPath id={overviewClipId}>
              <rect x={SCHEMATIC_X0 - 6} y={0} width={SCHEMATIC_W + 12} height={schematicHeight} />
            </clipPath>
          )}
          <g clipPath={zoomed ? `url(#${overviewClipId})` : undefined}>
          {/* Ruler ticks */}
          {overviewRulerTicks(view, overviewLen).map((tick, idx) => {
            const x = tick.x;
            const coord = tick.label;
            return (
              <g key={idx}>
                <line
                  x1={x}
                  y1="17"
                  x2={x}
                  y2="27"
                  stroke="var(--mbc-text-muted)"
                  strokeWidth="1.1"
                />
                <text
                  x={x}
                  y="13"
                  textAnchor="middle"
                  fill="var(--mbc-text-secondary)"
                  fontSize="11"
                  fontWeight="600"
                >
                  {coord.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* At single-base zoom the axis carries one tick per base it shows. */}
          {(SCHEMATIC_W * view.scale) / overviewLen >= OVERVIEW_BASE_TICK_UNITS &&
            (() => {
              const { first, last } = overviewVisibleBases(view, overviewLen);
              const marks: string[] = [];
              for (let b = first - 1; b <= last; b++) marks.push(`M ${overviewX(b, view, overviewLen).toFixed(2)} 20 v 6`);
              return (
                <path
                  data-base-ticks={`${first}..${last}`}
                  d={marks.join(' ')}
                  stroke="var(--mbc-text-muted)"
                  strokeWidth="0.8"
                  pointerEvents="none"
                />
              );
            })()}

          {/* Chromosomal oriC / terC Cumulative GC-Skew Markers */}
          {!isProtein && declaredLen >= 20_000 && (
            <>
              <g>
                <title>{`Predicted oriC (GC-skew minimum): ${trackOverview.predictedOricBp.toLocaleString()} bp`}</title>
                <circle
                  cx={overviewX(trackOverview.predictedOricBp, view, overviewLen)}
                  cy={23}
                  r={3.6}
                  fill="var(--mbc-green)"
                />
              </g>
              <g>
                <title>{`Predicted terC (GC-skew maximum): ${trackOverview.predictedTercBp.toLocaleString()} bp`}</title>
                <circle
                  cx={overviewX(trackOverview.predictedTercBp, view, overviewLen)}
                  cy={23}
                  r={3.6}
                  fill="var(--mbc-amber)"
                />
              </g>
            </>
          )}

          {/* The one active interval (MB-NAV-01): the selection, on the schematic's own scale. There is
              no page rectangle beside it; where the base rows start is the caret below, a point. */}
          {overviewInterval &&
            renderSegments(overviewInterval, overviewLen).map((seg) => (
              <rect
                key={`active-${seg.startIndex}`}
                data-active-interval={`${overviewInterval.start}..${overviewInterval.end}`}
                x={overviewX(seg.startIndex, view, overviewLen)}
                y={4}
                width={Math.max(2, overviewX(seg.endExclusive, view, overviewLen) - overviewX(seg.startIndex, view, overviewLen))}
                height={schematicHeight - 8}
                fill="rgba(26, 115, 232, 0.16)"
                stroke="var(--mbc-blue)"
                strokeWidth="1.2"
                pointerEvents="none"
              />
            ))}
          <path
            data-page-tick={settledViewportStartPos}
            d={`M ${overviewX(settledViewportStartPos - 1, view, overviewLen)} 24 l 4 6 h -8 z`}
            fill="var(--mbc-text-muted)"
          >
            <title>{`The base rows show from ${settledViewportStartPos.toLocaleString()} ${unitLabel}`}</title>
          </path>

          {/* Edge handles of the interval: 10 screen pixels wide, focusable sliders (US-01M7CCFQ AC4).
              Drawn BELOW the feature pills, so a pill near an edge still takes its own click; a press
              there that becomes a drag still resizes, since the brush hit-tests the edge in screen
              pixels whatever element the press landed on (brushHitTest). */}
          {overviewInterval &&
            overviewInterval.start <= overviewInterval.end &&
            (['start', 'end'] as const).map((edge) => {
              const edgeX = overviewX(edge === 'start' ? overviewInterval.start - 1 : overviewInterval.end, view, overviewLen);
              const w = BRUSH_HANDLE_HIT_PX * overviewUnitsPerPx;
              const base = overviewInterval[edge];
              return (
                <g key={`handle-${edge}`}>
                  <line x1={edgeX} x2={edgeX} y1={4} y2={schematicHeight - 4} stroke="var(--mbc-blue)" strokeWidth="2.4" pointerEvents="none" />
                  {live && <rect
                    ref={(el) => {
                      handleRefs.current[edge] = el;
                    }}
                    data-interval-handle={edge}
                    x={edgeX - w / 2}
                    y={4}
                    width={w}
                    height={schematicHeight - 8}
                    fill="transparent"
                    style={{ cursor: 'ew-resize' }}
                    tabIndex={0}
                    role="slider"
                    aria-label={edge === 'start' ? 'Selection start' : 'Selection end'}
                    aria-orientation="horizontal"
                    aria-valuemin={1}
                    aria-valuemax={overviewLen}
                    aria-valuenow={base}
                    aria-valuetext={`${edge === 'start' ? 'Start' : 'End'} at ${base.toLocaleString()} ${unitLabel}`}
                    onKeyDown={onHandleKeyDown(edge)}
                  />}
                </g>
              );
            })}

          {/* Each displayed cut site (US-01M7DV8W): a mark under the axis where it cuts. The overview names
              no enzyme (the base rows' cut pills do), so a hidden enzyme's name is never in its figure. */}
          {!isProtein &&
            displayedCutSites.map((c) => {
              const cutAt = cutSiteDisplayPosition(c.cutTop, doc.sequence.length, doc.topology === 'circular');
              const x = overviewX(cutAt, view, overviewLen);
              if (x < SCHEMATIC_X0 - 0.5 || x > SCHEMATIC_X1 + 0.5) return null;
              return (
                <path
                  key={`cut-${c.id}`}
                  data-map-part="cut-site"
                  d={`M ${x.toFixed(2)} 24 l -2.6 5 h 5.2 z`}
                  fill={c.enzyme.isTypeIIS ? 'var(--mbc-amber)' : 'var(--mbc-blue)'}
                >
                  <title>{`Cut site after ${cutAt.toLocaleString()}`}</title>
                </path>
              );
            })}

          {/* Multi-Lane Non-Overlapping Schematic Feature Pills */}
          {(live ? overviewLayout : schematicLayout).placed.map((item) => {
            const f = item.feature;
            const insideLightText = isDarkFillHex(f.color);
            const gStart = Number(f.qualifiers?.genomic_start) || f.start;
            const gEnd = Number(f.qualifiers?.genomic_end) || f.end;
            const gLen = Number(f.qualifiers?.genomic_length) || gEnd - gStart + 1;
            const rawType = f.qualifiers?.raw_type || f.type;
            return (
              <g
                key={f.id}
                data-map-part="feature-box"
                className="clickable-arc"
                onClick={() => {
                  const targetRow = Math.floor((f.start - 1) / basesPerRow);
                  setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
                  onSelectRange({
                    start: f.start,
                    end: f.end,
                    label: `${f.name} (${rawType}: ${gStart.toLocaleString()}..${gEnd.toLocaleString()})`,
                  });
                }}
              >
                <title>{`${f.name} [${rawType}] ${gStart.toLocaleString()}..${gEnd.toLocaleString()} (${gLen.toLocaleString()} ${unitLabel})`}</title>
                {f.segments && f.segments.length > 1 ? (
                  // Joined feature (spliced / frameshifted / trans-spliced): one block per interval.
                  <>
                    <line
                      x1={item.x1}
                      x2={item.x1 + item.boxWidth}
                      y1={item.y + 8}
                      y2={item.y + 8}
                      stroke={f.color}
                      strokeWidth="1.4"
                      strokeDasharray="3 2"
                    />
                    {f.segments.map((seg) => {
                      const span = Math.max(1, gEnd - gStart + 1);
                      const sx = item.x1 + ((seg.start - gStart) / span) * item.boxWidth;
                      const sw = Math.max(3, ((seg.end - seg.start + 1) / span) * item.boxWidth);
                      return (
                        <rect
                          key={`${f.id}-seg-${seg.index}`}
                          x={sx}
                          y={item.y}
                          width={sw}
                          height={16}
                          rx={3.5}
                          fill={f.color}
                          stroke="rgba(15, 23, 42, 0.45)"
                          strokeWidth="0.8"
                        />
                      );
                    })}
                  </>
                ) : (
                  <rect
                    x={item.x1}
                    y={item.y}
                    width={item.boxWidth}
                    height={16}
                    rx={3.5}
                    fill={f.color}
                    stroke="rgba(15, 23, 42, 0.45)"
                    strokeWidth="0.8"
                  />
                )}
                {item.labelMode !== 'none' && (
                  <text
                    x={item.labelX}
                    y={item.y + 11.5}
                    textAnchor={item.textAnchor}
                    fill={
                      item.labelMode === 'inside'
                        ? insideLightText
                          ? '#ffffff'
                          : '#0f172a'
                        : 'var(--mbc-text-main)'
                    }
                    fontSize="11"
                    fontWeight="700"
                  >
                    {item.displayLabel}
                  </text>
                )}
              </g>
            );
          })}

          </g>
      </>
    );
  };
  // BG-01M7CRMG: fold the toolbar's tools when its lines do not fit the card. Its unfolded height is
  // read with the fold lifted for the read and put back before anything paints.
  const measureToolbarFold = useCallback(() => {
    const card = cardRef.current;
    const bar = toolbarRef.current;
    if (!card || !bar || typeof getComputedStyle !== 'function') return;
    const folded = bar.classList.contains('is-folded');
    if (folded) bar.classList.remove('is-folded');
    const toolbarFull = bar.scrollHeight + (bar.offsetHeight - bar.clientHeight);
    if (folded) bar.classList.add('is-folded');
    // Every strip's margins count with what never gives (the quickbar's space under it, say).
    let fixed = 0;
    let overviewFloor = 0;
    let rowsFloor = 0;
    for (const el of Array.from(card.children) as HTMLElement[]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      fixed += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      if (el === bar) continue;
      const floor = parseFloat(cs.minBlockSize) || 0;
      if (el.classList.contains('mbc-schematic-header')) overviewFloor = floor;
      else if (el.classList.contains('sequence-blocks-scroll')) rowsFloor = floor;
      else fixed += el.getBoundingClientRect().height;
    }
    setToolsFolded(linearToolbarFolds({ card: card.clientHeight, fixed, overviewFloor, rowsFloor, toolbarFull }));
  }, []);
  useBrowserLayoutEffect(measureToolbarFold, [
    measureToolbarFold, doc.id, isProtein, Boolean(onLoadBenchmarkDocument), searchMatches.length,
    searchResult.warnings.length, showAddFeature, isContigSummary, showDownloadSummaryTab, schematicCoverage.length,
  ]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => measureToolbarFold());
    observer.observe(card);
    return () => observer.disconnect();
  }, [measureToolbarFold]);
  const openPanelUnder = (which: 'tools' | 'hits') => {
    const button = which === 'tools' ? toolsButtonRef.current : hitsButtonRef.current;
    const r = button?.getBoundingClientRect?.();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    // Under its button, kept on screen (a panel is at most 340px wide).
    setPanelAt(r ? { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, vw - 348)) } : null);
    setOpenPanel(which);
  };
  const hasSearchResults = searchMatches.length > 0 || searchResult.warnings.length > 0;
  useEffect(() => {
    if (!toolsFolded || (openPanel === 'hits' && !hasSearchResults)) setOpenPanel(null);
  }, [toolsFolded, openPanel, hasSearchResults]);
  // BG-01M7DGBF: beside the circle the new-annotation form lies over the foot of the rows (App.css), so
  // the rows' scroll area is padded by its height while it is open: the last row scrolls up above it.
  useEffect(() => {
    const form = addFormRef.current;
    if (!showAddFeature || !form || typeof getComputedStyle !== 'function') {
      setFormReserve(0);
      return;
    }
    const measure = () => {
      const over = getComputedStyle(form).position === 'absolute';
      setFormReserve(over ? Math.ceil(form.getBoundingClientRect().height) : 0);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [showAddFeature]);
  useEffect(() => {
    if (!focusAfter) return;
    const target: HTMLElement | null | undefined =
      focusAfter === 'hits' ? hitsButtonRef.current
      : focusAfter === 'form' ? addFormRef.current?.querySelector?.<HTMLElement>('input, select')
      : focusAfter === 'dialog' ? cardRef.current?.querySelector?.<HTMLElement>('.mbc-modal-close')
      : null;
    (target ?? toolsButtonRef.current)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);
  useEffect(() => {
    if (!openPanel || typeof document === 'undefined') return;
    const panel = openPanel === 'tools' ? toolsPanelRef : hitsPanelRef;
    const button = openPanel === 'tools' ? toolsButtonRef : hitsButtonRef;
    const inside = (e: Event) => {
      const t = e.target as Node | null;
      return Boolean(t && (panel.current?.contains(t) || button.current?.contains(t)));
    };
    const close = (e: Event) => {
      if (!inside(e)) setOpenPanel(null);
    };
    const shut = () => setOpenPanel(null);
    // Escape closes the open panel wherever focus is (WebKit does not focus a clicked button).
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpenPanel(null);
      setFocusAfter(openPanel);
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', close, true);
    };
  }, [openPanel]);

  overviewFileDrawingRef.current = () =>
    // Drawn inside an <svg>, as on screen, so its elements are read as SVG; the export keeps the inside.
    renderToStaticMarkup(<svg>{drawOverview(OVERVIEW_FIT, false)}</svg>).slice('<svg>'.length, -'</svg>'.length);

  return (
    <div
      ref={cardRef}
      className={`linear-seq-container scheme-${colorScheme} ${
        isProtein ? 'molecule-protein' : ''
      }`}
    >
      {colorOptionsOpen && (
        <NucleotideColorOptionsModal onClose={() => setColorOptionsOpen(false)} />
      )}

      {/* Contig Summary Alert Banner & Download Tab */}
      {isContigSummary && (
        <div
          className="mbc-contig-summary-banner"
          role="region"
          aria-label="Contig Summary Notice"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            padding: '7px 12px',
            background: 'var(--mbc-amber-soft)',
            borderBottom: '1px solid var(--mbc-amber-border)',
            color: 'var(--mbc-text-main)',
            fontSize: 12,
          }}
        >
          <div>
            <strong>Selected sequences are only summaries</strong>
            <span style={{ marginLeft: 8, opacity: 0.9 }}>
              ({doc.name} • {declaredLen.toLocaleString()} {unitLabel} Contig Summary)
            </span>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className="btn-secondary-sm"
              onClick={() => setShowDownloadSummaryTab((v) => !v)}
            >
              Download Tab
            </button>
            <button
              type="button"
              className="btn-primary-sm"
              onClick={handleDownloadFullSequence}
            >
              Download Full Sequence(s)
            </button>
          </div>
        </div>
      )}

      {(isContigSummary && showDownloadSummaryTab) && (
        <div
          className="mbc-contig-download-pane"
          style={{
            padding: '12px 16px',
            background: 'var(--mbc-bg-elevated)',
            borderBottom: '1px solid var(--mbc-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12.5,
          }}
        >
          <span>This is only a summary, click &apos;Download&apos; to get the full document</span>
          <button
            type="button"
            className="btn-primary-sm"
            onClick={handleDownloadFullSequence}
          >
            Download
          </button>
        </div>
      )}

      {/* Linear Schematic Overview Track */}
      <div className="studio-card-header" style={{ paddingTop: 0 }}>
        <h4 title={`Linear Map — ${doc.name}`}>Linear Map — {doc.name}</h4>
        <div
          className="mbc-overview-zoom"
          role="group"
          aria-label="Linear map zoom"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineStart: 'auto', marginInlineEnd: 6 }}
        >
          <button
            type="button"
            className="btn-secondary-sm"
            aria-label="Zoom out the linear map"
            title="Zoom out the linear map"
            disabled={overviewView.scale <= 1}
            onClick={() => zoomOverviewBy(OVERVIEW_BUTTON_STEP_PX)}
          >
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <span data-overview-zoom={overviewZoomPercent} aria-live="polite" style={{ minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {overviewZoomPercent.toLocaleString()}%
          </span>
          <button
            type="button"
            className="btn-secondary-sm"
            aria-label="Zoom in the linear map"
            title="Zoom in the linear map (or use the wheel over it)"
            disabled={overviewView.scale >= overviewMaxScale(overviewLen)}
            onClick={() => zoomOverviewBy(-OVERVIEW_BUTTON_STEP_PX)}
          >
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary-sm"
            aria-label="Fit the whole molecule in the linear map"
            title="Fit the whole molecule in the linear map"
            disabled={overviewView.scale === 1 && overviewView.offset === 0}
            onClick={() => setOverviewZoom({ docId: doc.id, view: OVERVIEW_FIT })}
          >
            Fit
          </button>
        </div>
        <FigureExportButton
          compact
          targetRef={schematicRef}
          baseName={`${doc.name} — Linear Map`}
          title={`${doc.name} — linear sequence map`}
          table={{
            headers: ['Name', 'Type', 'Start', 'End', 'Length', 'Strand'],
            rows: doc.features.map((f) => [
              f.name,
              String(f.type),
              String(f.start),
              String(f.end),
              String(f.end - f.start + 1),
              f.strand === -1 ? '-' : '+',
            ]),
            caption: `${doc.name} — ${doc.features.length} features`,
          }}
        />
      </div>
      {schematicCoverage.length > 0 && (
        <div style={{ paddingInline: 10 }}>
          <ResultWarnings warnings={schematicCoverage} label="Linear map coverage" />
        </div>
      )}
      <div className="mbc-schematic-header" data-mbc-figure ref={schematicRef}>
        <svg
          ref={attachOverview}
          viewBox={`0 0 800 ${schematicHeight}`}
          className="schematic-overview-svg"
          role="group"
          aria-label={`Linear schematic overview of ${doc.name}`}
          style={{ touchAction: 'none', userSelect: 'none', cursor: 'crosshair' }}
          onPointerDown={onOverviewPointerDown}
          onPointerMove={onOverviewPointerMove}
          onPointerUp={onOverviewPointerUp}
          onPointerCancel={onOverviewPointerCancel}
          onLostPointerCapture={onOverviewPointerCancel}
          onClickCapture={onOverviewClickCapture}
        >
          {drawOverview(overviewView, true)}
        </svg>

        {/* Multi-Row Wrapped Linear Genome Map for Complete Viral & Organelle Genomes */}
        {!isContigSummary &&
          (doc.folder === 'Genomes/Viruses' ||
            doc.folder === 'Genomes/Organelles' ||
            (doc.folder.startsWith('Genomes/') && declaredLen <= 500_000)) && (
          <svg
            viewBox="0 0 800 130"
            className="mbc-wrapped-genome-svg"
            role="img"
            aria-label={`Wrapped multi-row genome map of ${doc.name}`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderTop: '1px solid var(--mbc-border)',
              ...chartMaxWidth(800),
            }}
          >
            <rect x="0" y="0" width="800" height="130" fill="var(--mbc-bg-panel)" />
            {[0, 1, 2, 3, 4].map((rowIdx) => {
              const rowSpan = Math.ceil(declaredLen / 5);
              const rStart = rowIdx * rowSpan + 1;
              const rEnd = Math.min(declaredLen, (rowIdx + 1) * rowSpan);
              const yBase = 18 + rowIdx * 24;
              const rowFeats = trackFeatures.filter((f) => f.end >= rStart && f.start <= rEnd);
              return (
                <g key={rowIdx}>
                  <text x="6" y={yBase + 3} fontSize="9.5" fill="var(--mbc-text-secondary)" fontWeight="600">
                    {rStart.toLocaleString()}
                  </text>
                  <line
                    x1={56}
                    y1={yBase}
                    x2={740}
                    y2={yBase}
                    stroke="var(--mbc-border-strong)"
                    strokeWidth="1.2"
                  />
                  <text x="744" y={yBase + 3} fontSize="9.5" fill="var(--mbc-text-secondary)" fontWeight="600">
                    {rEnd.toLocaleString()}
                  </text>
                  {rowFeats.slice(0, 18).flatMap((f) => {
                    const parts = f.segments && f.segments.length > 1 ? f.segments : [f];
                    return parts
                      .filter((part) => part.end >= rStart && part.start <= rEnd)
                      .map((part, k) => {
                        const segStart = Math.max(rStart, part.start);
                        const segEnd = Math.min(rEnd, part.end);
                        const x1 = 56 + ((segStart - rStart) / Math.max(1, rEnd - rStart)) * 684;
                        const x2 = Math.max(x1 + 3, 56 + ((segEnd - rStart) / Math.max(1, rEnd - rStart)) * 684);
                        return (
                          <rect
                            key={`${rowIdx}-${f.id}-${k}`}
                            data-map-part="feature-box"
                            x={x1}
                            y={yBase - 6}
                            width={x2 - x1}
                            height={9}
                            rx={2}
                            fill={f.color}
                          >
                            <title>{`${f.name} (${f.qualifiers?.raw_type || f.type}) ${part.start.toLocaleString()}..${part.end.toLocaleString()}${parts.length > 1 ? ` (part ${k + 1} of ${parts.length})` : ''}`}</title>
                          </rect>
                        );
                      });
                  })}
                </g>
              );
            })}
          </svg>
        )}

        {/* Graphs Track (Resident GC% / AT% / GC-Skew or Protein Kyte-Doolittle Hydrophobicity) */}
        {((!isProtein && showGcGraph) || showHydropathyGraph) && (
          <div data-mbc-figure>
          <div className="studio-card-header" style={{ paddingTop: 0 }}>
            <h4>{isProtein || showHydropathyGraph ? 'Hydropathy Track' : 'GC Content Track'}</h4>
            <FigureExportButton
              compact
              baseName={`${doc.name} — ${isProtein || showHydropathyGraph ? 'Hydropathy' : 'GC'} Track`}
              title={`${doc.name} — ${isProtein || showHydropathyGraph ? 'hydropathy' : 'GC content'} track`}
            />
          </div>
          <svg viewBox="0 0 800 66" className="mbc-graphs-track-svg">
            <rect x="0" y="0" width="800" height="66" fill="var(--mbc-bg-elevated)" />
            <line
              x1={SCHEMATIC_X0}
              y1="42"
              x2={SCHEMATIC_X1}
              y2="42"
              stroke="var(--mbc-border)"
              strokeDasharray="3 3"
            />
            {!isProtein && showGcGraph && (
              <>
                <text x={SCHEMATIC_X0} y="15" fill="var(--mbc-blue)" fontSize="11" fontWeight="700">
                  Graphs: — %GC ({meanGc.value}{meanGc.approx ? `, ${meanGc.approx}` : ''})   -- %AT   ⋯ Cum. GC-Skew
                </text>
                <path
                  d={gcProfilePoints.gcPath}
                  fill="none"
                  stroke="var(--mbc-blue)"
                  strokeWidth="1.6"
                />
                <path
                  d={gcProfilePoints.atPath}
                  fill="none"
                  stroke="var(--mbc-amber)"
                  strokeWidth="1.2"
                  strokeDasharray="2.5 2.5"
                />
                <path
                  d={gcProfilePoints.skewPath}
                  fill="none"
                  stroke="var(--mbc-teal)"
                  strokeWidth="1.15"
                  strokeDasharray="1.5 2.5"
                />
              </>
            )}
            {showHydropathyGraph && hydropathyPath && (
              <>
                <text
                  x={isProtein ? SCHEMATIC_X0 : 395}
                  y="15"
                  fill="var(--mbc-purple)"
                  fontSize="11"
                  fontWeight="700"
                >
                  — Kyte-Doolittle Hydrophobicity (Window {pageStartPos.toLocaleString()} {unitLabel})
                </text>
                <path
                  d={hydropathyPath}
                  fill="none"
                  stroke="var(--mbc-purple)"
                  strokeWidth="1.6"
                />
              </>
            )}
          </svg>
          </div>
        )}
      </div>

      {/* Sequence View Sub-Toolbar */}
      <div ref={toolbarRef} className={`linear-toolbar${toolsFolded ? ' is-folded' : ''}`}>
        <div className="search-box-group">
          <div className="seq-search-and-jump-row">
            <input
              id="mbc-seq-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isProtein
                  ? 'FM-Index motif search in protein (e.g. RGD, CxxC, VEV)...'
                  : "FM-Index search in sequence (5'->3' or RevComp, e.g. GAATTC)..."
              }
              className="seq-search-input"
            />
            {/* Shown only while the toolbar is folded (App.css): the hit count, opening the hits. */}
            {hasSearchResults && (
              <button
                ref={hitsButtonRef}
                type="button"
                className="btn-secondary-sm linear-search-hits-btn"
                aria-expanded={toolsFolded && hitsOpen}
                aria-controls={hitsPanelId}
                title={`Show the ${searchResult.totalHits.toLocaleString()} FM-Index hits and jump to one`}
                onClick={() => (hitsOpen ? setOpenPanel(null) : openPanelUnder('hits'))}
              >
                {searchResult.totalHits.toLocaleString()} {searchResult.totalHits === 1 ? 'hit' : 'hits'} ▾
              </button>
            )}
            <form className="coord-jump-form" onSubmit={handleJumpToCoordinate}>
              <input
                type="text"
                inputMode="numeric"
                value={jumpCoordInput}
                onChange={(e) => setJumpCoordInput(e.target.value)}
                placeholder={`Go to ${unitLabel}...`}
                aria-label={`Jump to ${unitLabel} coordinate`}
                className="coord-jump-input"
              />
              <button type="submit" className="btn-secondary-sm">
                Go
              </button>
            </form>
          </div>
          {/* The hits and the search's warnings: in place, or on a folded toolbar the panel the hit
              count opens, so no result is ever below a scroll with nothing to show for it. */}
          <div
            id={hitsPanelId}
            ref={hitsPanelRef}
            className={`search-results${toolsFolded && hitsOpen ? ' is-open' : ''}`}
            role={toolsFolded ? 'group' : undefined}
            aria-label={toolsFolded ? 'Search hits' : undefined}
            style={toolsFolded && hitsOpen && panelAt ? { top: panelAt.top, left: panelAt.left } : undefined}
            onClick={(e) => {
              // Jumping to a hit closes the list and leaves focus on the hit count.
              if (toolsFolded && hitsOpen && (e.target as Element | null)?.closest?.('button')) {
                setOpenPanel(null);
                setFocusAfter('hits');
              }
            }}
          >
          {searchMatches.length > 0 && (
            // Every hit the list holds has a jump button; the row is at most three control heights
            // tall and scrolls beyond that.
            <div
              className="search-hit-pills"
              style={{ maxHeight: 'calc(3 * var(--mbc-control-h-md))', overflowY: 'auto' }}
            >
              <span className="hit-count-badge">
                {searchResult.totalHits.toLocaleString()} FM-Index hits:
              </span>
              {searchMatches.map((m, idx) => (
                <button
                  type="button"
                  key={idx}
                  className="hit-jump-btn"
                  onClick={() => {
                    const targetRow = Math.floor((m.start - 1) / basesPerRow);
                    setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
                    onSelectRange({
                      start: m.start,
                      end: m.end,
                      label: isProtein
                        ? `Motif ${m.start}..${m.end}`
                        : `Match (${m.strand === 1 ? '+' : '-'} strand)`,
                    });
                  }}
                >
                  {m.start.toLocaleString()}..{m.end.toLocaleString()}
                  {!isProtein ? ` (${m.strand === 1 ? '+' : '-'})` : ''}
                </button>
              ))}
            </div>
          )}
          <ResultWarnings warnings={searchResult.warnings} label="Search warnings" />
          </div>
        </div>

        <div className="linear-toolbar-actions">
          {/* Shown only while the toolbar is folded (App.css): it holds the tools beside the pager. */}
          <button
            ref={toolsButtonRef}
            type="button"
            className="btn-secondary-sm linear-toolbar-more"
            aria-label="More tools"
            aria-expanded={toolsFolded && toolsOpen}
            aria-controls={toolsPanelId}
            title="More tools: + Add Annotation, Color Options, cut marks and the sequence generators"
            onClick={() => (toolsOpen ? setOpenPanel(null) : openPanelUnder('tools'))}
          >
            Tools ▾
          </button>
          <div
            id={toolsPanelId}
            ref={toolsPanelRef}
            className={`linear-toolbar-left-pills${toolsFolded && toolsOpen ? ' is-open' : ''}`}
            role={toolsFolded ? 'group' : undefined}
            aria-label={toolsFolded ? 'More tools' : undefined}
            style={toolsFolded && toolsOpen && panelAt ? { top: panelAt.top, left: panelAt.left } : undefined}
            onClick={(e) => {
              // A tool that acts (a button) closes the panel, and focus goes where the tool opened
              // (the new-annotation form, the Color Options dialog) or back to Tools; the cut-marks box
              // keeps the panel open.
              const tool = (e.target as Element | null)?.closest?.('button');
              if (!toolsFolded || !toolsOpen || !tool) return;
              setOpenPanel(null);
              const kind = tool.getAttribute('data-tool');
              setFocusAfter(kind === 'add-annotation' && !showAddFeature ? 'form' : kind === 'color-options' ? 'dialog' : 'tools');
            }}
          >
            <button
              type="button"
              className="btn-secondary-sm"
              data-tool="add-annotation"
              onClick={() => {
                // An origin-crossing selection is not a feature's start..end (BG-01M7CG2W): not prefilled.
                if (selectionIv && selectionIv.start <= selectionIv.end) {
                  setNewFeatStart(selectionIv.start);
                  setNewFeatEnd(selectionIv.end);
                }
                setShowAddFeature(!showAddFeature);
              }}
            >
              + Add Annotation
            </button>
            <button
              type="button"
              className="btn-secondary-sm"
              data-tool="color-options"
              onClick={() => setColorOptionsOpen(true)}
              title="Open Nucleotide & Ambiguity Color Options"
            >
              Color Options
            </button>
            {!isProtein && (
              <label
                title="Mark the top- and bottom-strand cuts of the restriction site whose preview is open on the bases"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  data-cut-marks-toggle={true}
                  checked={showCutMarks}
                  onChange={(e) => toggleCutMarks(e.target.checked)}
                />
                Show cut marks
              </label>
            )}
            {onLoadBenchmarkDocument && (
              <>
                <button
                  type="button"
                  className="btn-secondary-sm"
                  onClick={() => onLoadBenchmarkDocument('genome-500k')}
                  title="Generate & open a 500,000 bp annotated chromosome in the Resident Rust Sequence Store"
                >
                  500 kbp Genome
                </button>
                <button
                  type="button"
                  className="btn-secondary-sm"
                  onClick={() => onLoadBenchmarkDocument('protein-10k')}
                  title="Generate & open a 10,000 aa multi-domain polyprotein in the Resident Rust Sequence Store"
                >
                  10k aa Protein
                </button>
              </>
            )}
            <span className="resident-window-badge" title="Active Resident Rust viewport coordinate & local GC%">
              {isProtein
                ? `At ${settledViewportStartPos.toLocaleString()} aa`
                : `Window GC ${pageSlice.windowGcPercent.toFixed(1)}%`}
            </span>
          </div>

          <div className="pagination-group">
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex(0)}
              title="First page"
            >
              ⏮
            </button>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              title="Previous page"
            >
              ◀ Prev
            </button>
            <span className="page-indicator">
              {pageStartPos.toLocaleString()}–{pageEndPos.toLocaleString()} of{' '}
              {seqLen.toLocaleString()} {unitLabel}
            </span>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex >= totalPages - 1}
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
              title="Next page"
            >
              Next ▶
            </button>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex >= totalPages - 1}
              onClick={() => setPageIndex(totalPages - 1)}
              title="Last page"
            >
              ⏭
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Selection Quick-Action Bar: a slot of one fixed height, held with or without a
          selection, so what it reads never moves the rows under a drag (BG-01M7CMT6). */}
      {!selectionQuickStats && (
        <div className="seq-selection-quickbar seq-selection-quickbar--empty" style={SELECTION_QUICKBAR_SLOT_STYLE}>
          <span className="seq-selection-quickbar-hint">Click a base, or drag across bases, to select them.</span>
        </div>
      )}
      {selectionQuickStats && (
        <div
          className="seq-selection-quickbar"
          role="region"
          aria-label="Selected Sequence Region Actions"
          style={SELECTION_QUICKBAR_SLOT_STYLE}
          title={selectionQuickbarReadout(selectedRange?.label, selectionQuickStats, unitLabel)}
          aria-describedby={quickbarReadoutId}
        >
          <div className="seq-selection-quickbar-summary">
            <strong>
              {selectedRange?.label ? `${selectedRange.label} · ` : ''}
              {selectionQuickStats.start.toLocaleString()}..{selectionQuickStats.end.toLocaleString()}
            </strong>
            <span>
              ({selectionQuickStats.length.toLocaleString()} {unitLabel}
              {selectionQuickStats.gcPercent !== null && (
                <>
                  {` · GC ${selectionQuickStats.gcPercent.toFixed(1)}% · Tm `}
                  {selectionQuickStats.tmBasicC === null ? (
                    <span title={selectionQuickStats.tmNoAnswerReason ?? undefined}>n/a</span>
                  ) : (
                    `${selectionQuickStats.tmBasicC.toFixed(1)} °C`
                  )}
                </>
              )}
              )
            </span>
          </div>
          <span id={quickbarReadoutId} className="mbc-sr-only">
            {selectionQuickbarReadout(selectedRange?.label, selectionQuickStats, unitLabel)}
          </span>
          {QuickbarActionStrip(quickbarStrip)}
        </div>
      )}

      {showAddFeature && (
        <form ref={addFormRef} className="add-feature-drawer" onSubmit={handleCreateFeature}>
          <strong>New Annotation:</strong>
          <input
            type="text"
            value={newFeatName}
            onChange={(e) => setNewFeatName(e.target.value)}
            placeholder="Name"
          />
          <select
            value={newFeatType}
            onChange={(e) => setNewFeatType(e.target.value as FeatureType)}
          >
            <option value="CDS">CDS</option>
            <option value="promoter">promoter</option>
            <option value="terminator">terminator</option>
            <option value="rep_origin">rep_origin</option>
            <option value="regulatory">regulatory</option>
            <option value="crispr_guide">crispr_guide</option>
            <option value="tag">tag</option>
            <option value="sig_peptide">sig_peptide</option>
            <option value="secondary_structure">secondary_structure</option>
            <option value="misc_feature">misc_feature</option>
          </select>
          <label>
            Start:
            <input
              type="number"
              min={1}
              max={seqLen}
              value={newFeatStart}
              onChange={(e) => setNewFeatStart(Number(e.target.value))}
            />
          </label>
          <label>
            End:
            <input
              type="number"
              min={1}
              max={seqLen}
              value={newFeatEnd}
              onChange={(e) => setNewFeatEnd(Number(e.target.value))}
            />
          </label>
          <select
            value={newFeatStrand}
            onChange={(e) => setNewFeatStrand(Number(e.target.value) as 1 | -1)}
          >
            <option value={1}>Forward (+)</option>
            <option value={-1}>Reverse (-)</option>
          </select>
          <button type="submit" className="btn-primary-sm">
            Save
          </button>
        </form>
      )}

      {cutScanNote && (
        <p className="mbc-summary-note" role="note" style={{ padding: '6px 10px' }}>
          {cutScanNote}
        </p>
      )}

      {/* The guide shown from a CRISPR row (US-01M7DVA6): its spacer and its PAM named and read
          apart, each at the plus-strand coordinates the row reports and each on the guide's own
          strand - so the bases marked as the spacer are the ones to order. */}
      {guideHighlight && guideParts && (
        <div
          className="seq-guide-ribbon"
          style={GUIDE_RIBBON_STYLE}
          data-guide-highlight={guideHighlight.name}
          data-guide-strand={guideHighlight.strand}
          data-guide-site={`${guideHighlight.site.start}..${guideHighlight.site.end}`}
          data-guide-spacer={`${guideParts.spacer.start}..${guideParts.spacer.end}`}
          data-guide-pam={`${guideParts.pam.start}..${guideParts.pam.end}`}
          data-guide-spacer-bases={guideParts.spacerBases}
          data-guide-pam-bases={guideParts.pamBases}
          data-guide-cut={guideHighlight.cutPosition}
          data-guide-cut-target={guideHighlight.cutPositionTargetStrand}
          data-guide-cut-target-note={
            guideHighlight.cutPositionTargetStrand === undefined
              ? guideHighlight.cutPositionTargetStrandNote
              : undefined
          }
        >
          <strong>{guideHighlight.name}</strong>
          <span>
            {guideHighlight.nuclease} ·{' '}
            {guideHighlight.strand === 1 ? 'forward (+) strand' : 'reverse (−) strand'} · cut @{' '}
            {guideHighlight.cutPosition.toLocaleString()}
            {guideHighlight.cutPositionTargetStrand !== undefined
              ? `, target strand @ ${guideHighlight.cutPositionTargetStrand.toLocaleString()}`
              : guideHighlight.cutPositionTargetStrandNote
              ? `, target strand: ${guideHighlight.cutPositionTargetStrandNote}`
              : ''}
          </span>
          <span>
            <span style={GUIDE_SPACER_BASE_STYLE}>spacer</span>{' '}
            {guideParts.spacer.start.toLocaleString()}..{guideParts.spacer.end.toLocaleString()} (
            {intervalLength(guideParts.spacer, seqLen).toLocaleString()} nt
            {guideParts.spacer.start > guideParts.spacer.end ? ', across the origin' : ''}){' '}
            <span className="mono-cell">5&apos;-{guideParts.spacerBases}-3&apos;</span>
          </span>
          <span>
            <span style={GUIDE_PAM_BASE_STYLE}>{guideHighlight.pamSide} PAM</span>{' '}
            {guideParts.pam.start.toLocaleString()}..{guideParts.pam.end.toLocaleString()} (
            {intervalLength(guideParts.pam, seqLen).toLocaleString()} nt
            {guideParts.pam.start > guideParts.pam.end ? ', across the origin' : ''}){' '}
            <span className="mono-cell">{guideParts.pamBases}</span> — read by the nuclease, not part
            of the spacer to order
          </span>
        </div>
      )}
      <div
        ref={attachRowsScroll}
        className="sequence-blocks-scroll"
        data-form-reserve={formReserve || undefined}
        style={formReserve ? { paddingBlockEnd: `calc(8px + ${formReserve}px)`, scrollPaddingBlockEnd: formReserve } : undefined}
        tabIndex={0}
        onPointerDown={onRowsPointerDown}
        onPointerMove={onRowsPointerMove}
        onPointerUp={onRowsPointerUp}
        onPointerCancel={onRowsPointerCancel}
        onLostPointerCapture={onRowsPointerCancel}
        onClickCapture={onRowsClickCapture}
        onKeyDown={(e) => {
          if (e.key === 'PageDown') {
            e.preventDefault();
            setPageIndex((p) => Math.min(totalPages - 1, p + 1));
          } else if (e.key === 'PageUp') {
            e.preventDefault();
            setPageIndex((p) => Math.max(0, p - 1));
          }
        }}
      >
        {markedRows.map((row, rowIdx) => (
          <div
            key={row.rowStart}
            data-row-start={row.rowStart}
            className={`seq-row-block ${rowIdx >= 4 ? 'seq-row-deferred' : ''}`}
          >
            {(row.rowCuts.length > 0 || row.rowPrimers.length > 0) && (
              <div className="seq-track-markers">
                {row.rowCuts.map((c) => {
                  const shownAt = cutSiteDisplayPosition(c.cutTop, doc.sequence.length, doc.topology === 'circular');
                  const open = previewCut?.id === c.id;
                  return (
                    <span
                      key={c.id}
                      data-map-part="cut-site"
                      className={`cut-pill ${c.enzyme.isTypeIIS ? 'type2s' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-expanded={open}
                      aria-controls={open ? previewDomId : undefined}
                      aria-label={`${enzymeLabel(c.enzyme)} (${shownAt}) cut site: select it and open its cleavage preview`}
                      onClick={(e) => openCleavagePreview(c, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          openCleavagePreview(c, e.currentTarget);
                        } else if (e.key === 'Escape' && open) {
                          e.preventDefault();
                          e.stopPropagation();
                          closeCleavagePreview();
                        }
                      }}
                    >
                      ▼ {enzymeLabel(c.enzyme)} ({shownAt})
                    </span>
                  );
                })}
                {row.rowPrimers.map((p) => (
                  <span
                    key={p.id}
                    className="primer-pill"
                    title={p.tmNoAnswerReason}
                    onClick={() =>
                      onSelectRange({
                        start: p.bindStart,
                        end: p.bindEnd,
                        label: `Primer ${p.name}`,
                      })
                    }
                  >
                    {p.strand === 1 ? '▶' : '◀'} {p.name} ({p.tmNoAnswerReason ? 'Tm n/a' : `Tm ${p.tmAnnealC}°C`})
                  </span>
                ))}
              </div>
            )}
            {previewCut && row.rowCuts.some((c) => c.id === previewCut.id) && (
              <CleavagePreview
                id={previewDomId}
                site={previewCut}
                sequence={doc.sequence}
                circular={doc.topology === 'circular'}
                onClose={closeCleavagePreview}
                onViewEnzyme={onViewEnzyme}
                onAddEnzymeToCollection={onAddEnzymeToCollection}
              />
            )}

            <div className="seq-strand-line top-strand">
              <span className="coord-gutter">
                {isProtein ? 'N ' : "5' "}
                {String(row.rowStart).padStart(7, ' ')}
              </span>
              <span className="mono-bases">
                {row.topSlice.split('').map((ch, idx) => {
                  const pos = row.rowStart + idx;
                  const inSel = selectionIv !== null && intervalContains(selectionIv, pos, seqLen);
                  // Which part of the shown guide this base belongs to, if either: a base is never
                  // both, so the spacer and the PAM read apart (US-01M7DVA6 AC1).
                  const guidePart = !guideParts
                    ? null
                    : intervalContains(guideParts.spacer, pos, seqLen)
                    ? 'spacer'
                    : intervalContains(guideParts.pam, pos, seqLen)
                    ? 'pam'
                    : null;
                  const tokenClass = isProtein
                    ? `aa-res ${classifyProteinResidueCss(ch)}`
                    : `base-ch base-${ch === 'U' ? 'T' : ch}`;
                  return (
                    <React.Fragment key={idx}>
                      {row.marks.top === idx && cutMark('top')}
                      <span
                        data-pos={pos}
                        data-guide-part={guidePart ?? undefined}
                        className={`${tokenClass} ${inSel ? 'sel-base' : ''}`}
                        style={
                          guidePart === 'spacer'
                            ? GUIDE_SPACER_BASE_STYLE
                            : guidePart === 'pam'
                            ? GUIDE_PAM_BASE_STYLE
                            : undefined
                        }
                        onClick={() =>
                          onSelectRange({
                            start: pos,
                            end: Math.min(seqLen, pos + 19),
                          })
                        }
                      >
                        {ch}
                      </span>
                    </React.Fragment>
                  );
                })}
                {row.marks.top === row.topSlice.length && cutMark('top')}
              </span>
              <span className="coord-gutter-right">
                {row.rowEnd} {isProtein ? 'C' : "3'"}
              </span>
            </div>

            {!isProtein ? (
              <>
                <div className="seq-strand-line bottom-strand">
                  <span className="coord-gutter">3&apos; {' '.repeat(7)}</span>
                  <span className="mono-bases comp-bases">
                    {row.marks.bottom === null ? (
                      row.botSlice
                    ) : (
                      <>
                        {row.botSlice.slice(0, row.marks.bottom)}
                        {cutMark('bottom')}
                        {row.botSlice.slice(row.marks.bottom)}
                      </>
                    )}
                  </span>
                  <span className="coord-gutter-right">5&apos;</span>
                </div>

                {showTranslation && (
                  <>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +1</span>
                      <span className="mono-bases aa-track">{row.frame1}</span>
                    </div>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +2</span>
                      <span className="mono-bases aa-track">{row.frame2}</span>
                    </div>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +3</span>
                      <span className="mono-bases aa-track">{row.frame3}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {row.protClassSlice && (
                  <div
                    className="seq-strand-line bottom-strand"
                    title="Biochemical class symbols (non-color indicator): H = Hydrophobic, P = Polar, + = Basic, - = Acidic, G = Gly/Pro"
                  >
                    <span className="coord-gutter">Biochem</span>
                    <span className="mono-bases comp-bases">{row.protClassSlice}</span>
                  </div>
                )}
                {showTranslation && row.protSecondarySlice && (
                  <div
                    className="seq-strand-line aa-frame-line"
                    title="Garnier-Osguthorpe-Robson (GOR) secondary structure track: H = alpha-helix, E = beta-strand, C = coil"
                  >
                    <span className="coord-gutter">GOR 2°SS</span>
                    <span className="mono-bases aa-track">{row.protSecondarySlice}</span>
                  </div>
                )}
              </>
            )}

            {row.rowFeatures.length > 0 && (
              <div className="row-features-bars">
                {row.rowFeatures.map((f) => {
                  const gStart = Number(f.qualifiers?.genomic_start) || f.start;
                  const gEnd = Number(f.qualifiers?.genomic_end) || f.end;
                  const rawType = f.qualifiers?.raw_type || f.type;
                  return (
                    <div
                      key={f.id}
                      data-map-part="feature-box"
                      className="feature-inline-bar"
                      style={{
                        borderColor: f.color,
                        backgroundColor: `${f.color}20`,
                      }}
                      onClick={() =>
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${rawType})`,
                        })
                      }
                    >
                      <span className="feat-bar-title">
                        {f.strand === 1 ? '▶' : '◀'} {f.name} ({rawType}:{' '}
                        {gStart.toLocaleString()}..{gEnd.toLocaleString()})
                      </span>
                      {f.notes && <span className="feat-bar-note">{f.notes}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {doc.folder.startsWith('Genomes/') && (
          <GenomeInspectorExtras
            doc={doc}
            selectedRange={selectedRange}
            onSelectRange={onSelectRange}
          />
        )}
      </div>
    </div>
  );
};
