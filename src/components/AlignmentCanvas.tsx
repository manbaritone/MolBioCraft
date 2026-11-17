// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Full-length, virtualised multiple-sequence-alignment canvas.
 *
 * - Renders every column (no 140/758 column caps) at a zoom-dependent column width.
 * - Horizontal + vertical windowing keeps DOM size proportional to the viewport.
 * - Letters are drawn when columns are wide enough; otherwise colour runs are drawn in SVG.
 * - All display settings from the inspector are honoured here.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SequenceFeature } from '../types/bio';
import {
  AlignedTranslation,
  atByColumn,
  AlignmentColorScheme,
  complementAligned,
  coverageByColumn,
  framePlot,
  gcByColumn,
  hydrophobicityByColumn,
  isoelectricByColumn,
  logoByColumn,
  lowerBound,
  motifColumns,
  packLanes,
  residueCellStyle,
  residueSolidColor,
  rowCoordinateMaps,
  rulerStep,
  smooth,
  threeLetterCode,
  translateAlignedRow,
} from '../core/alignmentViewModel';
import { classifyWheelGesture, normalizeWheelDelta, wheelZoomScale, type WheelGestureLike } from '../core/wheelZoom';

export interface AlignmentCanvasRow {
  id: string;
  label: string;
  secondary?: string;
  metric?: string;
  title?: string;
  alignedSeq: string;
  strand: 1 | -1;
  features: SequenceFeature[];
}

export interface AlignmentCanvasSettings {
  colorScheme: AlignmentColorScheme;
  isProtein: boolean;
  showLetters: boolean;
  showConsensus: boolean;
  consensusLabel: string;
  showHighlighting: boolean;
  highlightMode: 'All Disagreements' | 'All Agreements';
  highlightRef: 'Consensus' | 'Reference';
  useDotsForAgreements: boolean;
  showComplement: boolean;
  showTranslation: boolean;
  translationFrame: string;
  geneticCode: string;
  threeLetterAminoAcids: boolean;
  showAminoAcidNumbering: boolean;
  showAnnotations: boolean;
  hiddenAnnotationTypes: ReadonlySet<string>;
  annotationFilter: string;
  annotationLabels: 'Inside' | 'Above' | 'None';
  annotationArrowTips: boolean;
  annotationHideExcessiveLabels: boolean;
  annotationCompress: boolean;
  annotationLabelSize: number;
  annotationThickness: number;
  showGraphs: boolean;
  graphCoverage: boolean;
  coverageLogScale: boolean;
  coverageHighlightGapped: boolean;
  graphIdentity: boolean;
  identityWindow: number;
  graphGc: boolean;
  graphAt: boolean;
  gcWindow: number;
  graphFramePlot: boolean;
  graphLogo: boolean;
  graphHydrophobicity: boolean;
  hydrophobicityWindow: number;
  graphPi: boolean;
  piWindow: number;
  restrictionSites: { col: number; enzyme: string }[] | null;
  highlightDam: boolean;
  highlightDcm: boolean;
  wrap: boolean;
  visibleCols: number[];
  spacesEvery: number;
  numbering: 'Standard' | 'From 0' | 'No gaps';
  miniMap: boolean;
  outlineZoomedOut: boolean;
  showSequenceIcons: boolean;
  nameFontSize: number;
  numberFontSize: number;
  letterFontSize: number;
  zoomedOutRowHeight: number;
}

export interface AlignmentCanvasProps {
  rows: AlignmentCanvasRow[];
  consensus: string;
  conservation: number[];
  settings: AlignmentCanvasSettings;
  zoomPct: number;
  cursorCol: number; // 1-based alignment column
  selectedRowIdx: number;
  onCursorChange: (col: number) => void;
  onSelectRow: (idx: number) => void;
  /** Scroll so that the given 1-based column is centred (nonce re-triggers). */
  scrollRequest: { col: number; nonce: number } | null;
  /** When nonce changes, the canvas computes the zoom that fits all columns and reports it. */
  fitRequestNonce: number;
  onRequestZoom: (zoomPct: number) => void;
  /**
   * The width of the sequence name and identity column, in pixels (US-01M6S7QS). Every layout
   * measure the grid takes from the column - its line widths, Fit to window, wrapping, centring a
   * column, the columns it renders and the mini-map's viewport - reads this width.
   */
  nameColumnWidthPx?: number;
  /** Drawn over the name column's right edge, the full height of the grid: its resize handle. */
  nameColumnHandle?: React.ReactNode;
}

/** The name column's width when the studio gives none. */
export const DEFAULT_NAME_COLUMN_WIDTH_PX = 248;
const BUFFER_PX = 240;

type LineKind =
  | 'ruler'
  | 'consensus'
  | 'restriction'
  | 'g-coverage'
  | 'g-identity'
  | 'g-gc'
  | 'g-frame'
  | 'g-logo'
  | 'g-hydro'
  | 'g-pi'
  | 'seq'
  | 'comp'
  | 'trans'
  | 'ann'
  | 'spacer';

interface Line {
  key: string;
  kind: LineKind;
  height: number;
  block: number;
  rowIdx?: number;
  frame?: number; // translation frame index into row translations
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

// ------------------------------------------------------------------ zoom (US-01M7CMZ5)

/**
 * The one zoom bound of the alignment grid, in percent: a wheel or pinch zoom, the toolbar's - and +,
 * the % field and Fit all hold the zoom to it.
 */
export const ALIGNMENT_ZOOM_BOUNDS = { min: 0.5, max: 400 } as const;

/** `zoomPct` held to ALIGNMENT_ZOOM_BOUNDS. */
export function clampAlignmentZoom(zoomPct: number): number {
  return Math.min(ALIGNMENT_ZOOM_BOUNDS.max, Math.max(ALIGNMENT_ZOOM_BOUNDS.min, zoomPct));
}

/** The settings the grid's column geometry is made from. */
export type AlignmentGeometrySettings = Pick<
  AlignmentCanvasSettings,
  'letterFontSize' | 'showLetters' | 'spacesEvery' | 'zoomedOutRowHeight' | 'wrap'
>;

/** The grid's column geometry at one zoom. */
export interface AlignmentGeometry {
  colW: number;
  lettersVisible: boolean;
  fontPx: number;
  rowH: number;
  /** Columns per spacing group; 0 while there are none (letters hidden, or spacing off). */
  spacesEvery: number;
  spaceW: number;
}

/**
 * The column geometry at `zoomPct`. Spacing groups exist only while letters show (colW 7 and over),
 * so a column's x is not proportional to the zoom across that switch.
 */
export function alignmentGeometry(zoomPct: number, s: AlignmentGeometrySettings): AlignmentGeometry {
  const colW = Math.max(0.05, (s.letterFontSize * 0.8 * zoomPct) / 100);
  const lettersVisible = s.showLetters && colW >= 7;
  const fontPx = clamp(colW * 1.1, 7, 18);
  const rowH = lettersVisible ? Math.max(15, Math.round(fontPx + 6)) : clamp(s.zoomedOutRowHeight, 4, 40);
  const spacesEvery = lettersVisible && s.spacesEvery > 0 ? Math.floor(s.spacesEvery) : 0;
  const spaceW = spacesEvery ? Math.max(4, colW * 0.6) : 0;
  return { colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW };
}

/** The x of visible column `i`'s left edge in the track. */
export function columnX(g: AlignmentGeometry, i: number): number {
  return i * g.colW + (g.spacesEvery ? Math.floor(i / g.spacesEvery) * g.spaceW : 0);
}

/** The visible column at track x `x` (a spacing gap counts as the column before it). */
export function columnAtX(g: AlignmentGeometry, x: number): number {
  if (!g.spacesEvery) return Math.floor(x / g.colW);
  const group = g.spacesEvery * g.colW + g.spaceW;
  const n = Math.floor(x / group);
  const rem = x - n * group;
  return n * g.spacesEvery + Math.min(g.spacesEvery - 1, Math.floor(rem / g.colW));
}

/** The width of the track a wrapped block may fill, for a scroll element `viewportWidth` wide. */
function wrapTrackWidth(viewportWidth: number, nameW: number): number {
  return Math.max(120, viewportWidth - nameW - 18);
}

/** The number of columns in each wrapped block. */
export function wrapBlockColumns(g: AlignmentGeometry, availTrackW: number): number {
  let per = Math.max(10, Math.floor(availTrackW / g.colW));
  while (per > 10 && columnX(g, per) > availTrackW) per--;
  return per;
}

/**
 * What one wrapped block's lines are made of, so its height can be found at another zoom: every block
 * holds the same lines. `rowLines` lines are one row high (the consensus, each sequence, its
 * complement and its translations), `fixedPx` is the rest whatever the zoom (the ruler, graphs,
 * annotations, a translation's numbering, the spacer), and `logo` a sequence logo, taller while
 * letters show.
 */
export interface WrapBlockShape {
  fixedPx: number;
  rowLines: number;
  logo: boolean;
}

const GRAPH_H = 30;
const LOGO_LETTERS_H = 34;

/** The height of one wrapped block at geometry `g`. */
export function wrapBlockHeight(shape: WrapBlockShape, g: AlignmentGeometry): number {
  return shape.fixedPx + shape.rowLines * g.rowH + (shape.logo ? (g.lettersVisible ? LOGO_LETTERS_H : GRAPH_H) : 0);
}

/** The grid's zoom and scroll, which a wheel zoom moves together. */
export interface AlignmentWheelView {
  zoomPct: number;
  scrollLeft: number;
  scrollTop: number;
}

/** What a wheel step needs to know of the grid; it reads nothing from the DOM. */
export interface AlignmentWheelContext {
  /** The scroll element's top-left corner, in the client coordinates of the event. */
  origin: { x: number; y: number };
  /** The scroll element's client width. */
  viewportWidth: number;
  /** The name column's width; the track starts after it. */
  nameW: number;
  /** The number of visible columns. */
  columnCount: number;
  settings: AlignmentGeometrySettings;
  /** In wrap mode, what a block is made of. */
  block: WrapBlockShape;
}

export type AlignmentWheelEvent = WheelGestureLike & { deltaMode?: number; clientX: number; clientY: number };

/**
 * The view after zooming to `toZoomPct` around the pointer at (`clientX`, `clientY`), anchored by
 * column index rather than by a pixel ratio, since spacing groups appear and vanish as the zoom
 * crosses colW 7.
 *
 * Unwrapped, the column under the pointer (idxAtX at the old zoom) keeps its left edge where it was
 * on screen (xOf at the new zoom); the one exception is a zoom out that would leave the pointer past
 * the narrowed column's right edge, where the column moves left just enough to stay under the
 * pointer. A pointer over the name column anchors the first column of the visible track. scrollLeft
 * is held to the content, so the anchor cannot hold where it would scroll past either end.
 *
 * Wrapped, the block line holding the hovered column keeps its top at the same height in the
 * viewport: scrollTop moves by the change in that block's offset, the column's block changing as the
 * zoom changes the columns a block holds.
 */
function alignmentZoomTo(view: AlignmentWheelView, toZoomPct: number, clientX: number, clientY: number, ctx: AlignmentWheelContext): AlignmentWheelView {
  const zoomPct = clampAlignmentZoom(toZoomPct);
  if (!Number.isFinite(zoomPct) || zoomPct === view.zoomPct) return view;
  const n = ctx.columnCount;
  const next: AlignmentWheelView = { zoomPct, scrollLeft: view.scrollLeft, scrollTop: view.scrollTop };
  if (n <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return next;
  const from = alignmentGeometry(view.zoomPct, ctx.settings);
  const to = alignmentGeometry(zoomPct, ctx.settings);
  const trackPx = Math.max(0, clientX - ctx.origin.x - ctx.nameW);

  if (ctx.settings.wrap) {
    const avail = wrapTrackWidth(ctx.viewportWidth, ctx.nameW);
    const perFrom = wrapBlockColumns(from, avail);
    const perTo = wrapBlockColumns(to, avail);
    const hFrom = wrapBlockHeight(ctx.block, from);
    const hTo = wrapBlockHeight(ctx.block, to);
    if (!(hFrom > 0) || !(hTo > 0)) return next;
    const blocks = Math.ceil(n / perFrom);
    const contentY = view.scrollTop + clientY - ctx.origin.y;
    const b = clamp(Math.floor(contentY / hFrom), 0, blocks - 1);
    const start = b * perFrom;
    const end = Math.min(n, start + perFrom);
    const idx = clamp(columnAtX(from, columnX(from, start) + trackPx + view.scrollLeft), start, end - 1);
    const bTo = Math.floor(idx / perTo);
    next.scrollTop = Math.max(0, view.scrollTop + bTo * hTo - b * hFrom);
    return next;
  }

  const x = view.scrollLeft + trackPx;
  const idx = clamp(columnAtX(from, x), 0, n - 1);
  const left = columnX(from, idx) - view.scrollLeft;
  let leftTo = left;
  const inside = trackPx - left;
  if (inside >= 0 && inside < from.colW && inside >= to.colW) {
    leftTo = trackPx - to.colW + Math.min(0.25, to.colW / 4);
  }
  const contentW = ctx.nameW + columnX(to, n) + 8;
  const maxLeft = Math.max(0, contentW - ctx.viewportWidth);
  next.scrollLeft = clamp(columnX(to, idx) - leftTo, 0, maxLeft);
  return next;
}

/**
 * One wheel event over the alignment grid, a 'scroll' surface (src/core/wheelZoom.ts): a zoom
 * gesture (Ctrl or Cmd with the wheel, a ctrl-flagged pinch) is handled and moves the zoom
 * multiplicatively, unrounded and inside ALIGNMENT_ZOOM_BOUNDS, about the hovered column; any other
 * gesture is not handled and leaves the view as it is, for the browser to scroll. A zoom held at a
 * bound is still handled.
 */
export function alignmentWheelStep(
  event: AlignmentWheelEvent,
  view: AlignmentWheelView,
  ctx: AlignmentWheelContext
): { handled: boolean; view: AlignmentWheelView } {
  if (classifyWheelGesture(event, 'scroll') !== 'zoom') return { handled: false, view };
  const zoomPct = wheelZoomScale(view.zoomPct, normalizeWheelDelta(event).y, ALIGNMENT_ZOOM_BOUNDS);
  return { handled: true, view: alignmentZoomTo(view, zoomPct, event.clientX, event.clientY, ctx) };
}

type GridListener = (event: Event) => void;
interface GridWheelTarget {
  addEventListener(type: string, listener: GridListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: GridListener): void;
}
interface GridGestureLike {
  scale?: number;
  clientX?: number;
  clientY?: number;
  preventDefault(): void;
}

/**
 * Listens for wheels and WebKit pinches on the grid's scroll element natively and non-passively
 * (React 18's onWheel is passive and cannot prevent the page's zoom), after the maps' binder
 * (bindCircularMapWheel): a zoom gesture is prevented, any other keeps its default and scrolls; the
 * wheel deltas of one animation frame are summed into one step; a gesturestart / gesturechange pinch
 * zooms to its start zoom times its `scale`, and the ctrl-flagged wheels sent meanwhile are prevented
 * but not applied. Returns the function that removes every listener and cancels a queued frame.
 */
export function bindAlignmentWheel(
  target: GridWheelTarget,
  hooks: { read(): AlignmentWheelView; context(): AlignmentWheelContext; apply(next: AlignmentWheelView): void }
): () => void {
  const options: AddEventListenerOptions = { passive: false };
  let pending: AlignmentWheelEvent | null = null;
  let frame: number | null = null;
  let gestureFrom: number | null = null;
  const changed = (a: AlignmentWheelView, b: AlignmentWheelView) =>
    a.zoomPct !== b.zoomPct || a.scrollLeft !== b.scrollLeft || a.scrollTop !== b.scrollTop;

  const flush = () => {
    frame = null;
    const event = pending;
    pending = null;
    if (!event) return;
    const view = hooks.read();
    const step = alignmentWheelStep(event, view, hooks.context());
    if (step.handled && changed(step.view, view)) hooks.apply(step.view);
  };
  const schedule = () => {
    if (frame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(flush);
    } else {
      frame = -1;
      flush();
    }
  };
  const onWheel = (event: WheelEvent) => {
    if (classifyWheelGesture(event, 'scroll') !== 'zoom') return;
    event.preventDefault();
    if (gestureFrom !== null) return;
    pending = {
      deltaX: 0,
      deltaY: (pending?.deltaY ?? 0) + normalizeWheelDelta(event).y,
      deltaMode: 0,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: false,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    schedule();
  };
  const onGestureStart = (event: GridGestureLike) => {
    event.preventDefault();
    gestureFrom = hooks.read().zoomPct;
    pending = null;
  };
  const onGestureChange = (event: GridGestureLike) => {
    event.preventDefault();
    if (gestureFrom === null || !(Number(event.scale) > 0)) return;
    const view = hooks.read();
    const next = alignmentZoomTo(view, gestureFrom * Number(event.scale), Number(event.clientX), Number(event.clientY), hooks.context());
    if (changed(next, view)) hooks.apply(next);
  };
  const onGestureEnd = (event: GridGestureLike) => {
    event.preventDefault();
    gestureFrom = null;
  };

  const listeners: [string, GridListener][] = [
    ['wheel', onWheel as unknown as GridListener],
    ['gesturestart', onGestureStart as unknown as GridListener],
    ['gesturechange', onGestureChange as unknown as GridListener],
    ['gestureend', onGestureEnd as unknown as GridListener],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener, options);
  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener);
    if (frame !== null && frame !== -1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };
}

export const AlignmentCanvas: React.FC<AlignmentCanvasProps> = ({
  rows,
  consensus,
  conservation,
  settings: s,
  zoomPct,
  cursorCol,
  selectedRowIdx,
  onCursorChange,
  onSelectRow,
  scrollRequest,
  fitRequestNonce,
  onRequestZoom,
  nameColumnWidthPx = DEFAULT_NAME_COLUMN_WIDTH_PX,
  nameColumnHandle,
}) => {
  const nameW = nameColumnWidthPx;
  const scrollRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ left: 0, top: 0, width: 900, height: 480 });

  // ---------------------------------------------------------------- geometry
  // One geometry for drawing and for the wheel's anchor (alignmentGeometry, columnX, columnAtX).
  const geometry = alignmentGeometry(zoomPct, s);
  const { colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW } = geometry;

  const xOf = useCallback(
    (i: number) => columnX({ colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW }, i),
    [colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW]
  );
  const idxAtX = useCallback(
    (x: number) => columnAtX({ colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW }, x),
    [colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW]
  );

  const visibleCols = s.visibleCols;
  const nVis = visibleCols.length;
  const seqs = useMemo(() => rows.map((r) => r.alignedSeq), [rows]);
  const colCount = consensus.length;

  // Blocks (wrap) -------------------------------------------------------------
  const availTrackW = wrapTrackWidth(view.width, nameW);
  const blocks = useMemo(() => {
    if (!s.wrap) return [{ start: 0, end: nVis }];
    const per = wrapBlockColumns({ colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW }, availTrackW);
    const out: { start: number; end: number }[] = [];
    for (let i = 0; i < nVis; i += per) out.push({ start: i, end: Math.min(nVis, i + per) });
    return out.length ? out : [{ start: 0, end: 0 }];
  }, [s.wrap, nVis, availTrackW, colW, lettersVisible, fontPx, rowH, spacesEvery, spaceW]);

  // ------------------------------------------------------------- derived data
  const coordMaps = useMemo(() => rows.map((r) => rowCoordinateMaps(r.alignedSeq)), [rows]);

  const refSeq = s.highlightRef === 'Reference' ? rows[0]?.alignedSeq ?? consensus : consensus;

  const needsTranslation = !s.isProtein && (s.showTranslation || s.colorScheme === 'By Translation');
  const translations: AlignedTranslation[][] = useMemo(() => {
    if (!needsTranslation) return [];
    return rows.map((r) => {
      if (s.translationFrame === 'All 3 Forward Frames') {
        return [0, 1, 2].map((f) => translateAlignedRow(r.alignedSeq, f, s.geneticCode));
      }
      if (s.translationFrame === 'By annotation') {
        const cds = r.features.filter((f) => String(f.type).toUpperCase() === 'CDS');
        if (cds.length) return cds.map((f) => translateAlignedRow(
          r.alignedSeq, Number(f.qualifiers?.codon_start ?? 1) - 1,
          s.geneticCode, f.start, f.end, f.strand === -1 ? -1 : 1, f.segments
        ));
        return [translateAlignedRow(r.alignedSeq, 0, s.geneticCode)];
      }
      const off = s.translationFrame === 'Frame 2' ? 1 : s.translationFrame === 'Frame 3' ? 2 : 0;
      return [translateAlignedRow(r.alignedSeq, off, s.geneticCode)];
    });
  }, [needsTranslation, rows, s.translationFrame, s.geneticCode]);

  const complements = useMemo(
    () => (!s.isProtein && s.showComplement ? rows.map((r) => complementAligned(r.alignedSeq)) : []),
    [rows, s.isProtein, s.showComplement]
  );

  const motifSets = useMemo(() => {
    if (s.isProtein || (!s.highlightDam && !s.highlightDcm)) return [];
    return rows.map((r) => {
      const set = new Set<number>();
      if (s.highlightDam) motifColumns(r.alignedSeq, 'GATC').forEach((c) => set.add(c));
      if (s.highlightDcm) motifColumns(r.alignedSeq, 'CCWGG').forEach((c) => set.add(c));
      return set;
    });
  }, [rows, s.isProtein, s.highlightDam, s.highlightDcm]);

  const filterQ = s.annotationFilter.trim().toLowerCase();
  const rowFeatures = useMemo(
    () =>
      rows.map((r) =>
        r.features.filter(
          (f) =>
            String(f.type) !== 'source' &&
            !s.hiddenAnnotationTypes.has(String(f.type)) &&
            (!filterQ ||
              f.name.toLowerCase().includes(filterQ) ||
              String(f.type).toLowerCase().includes(filterQ) ||
              Object.values(f.qualifiers ?? {}).some((v) => String(v).toLowerCase().includes(filterQ)))
        )
      ),
    [rows, s.hiddenAnnotationTypes, filterQ]
  );

  /** Feature intervals mapped to visible-column indices, lane-packed per row. */
  const featureLanes = useMemo(() => {
    if (!s.showAnnotations) return rows.map(() => ({ items: [], lanes: 0 }));
    return rows.map((r, ri) => {
      const { colOfPos } = coordMaps[ri];
      const maxPos = colOfPos.length - 1;
      const mapped = rowFeatures[ri]
        .map((f) => {
          if (maxPos < 1) return null;
          const a = colOfPos[clamp(Math.min(f.start, f.end), 1, maxPos)];
          const b = colOfPos[clamp(Math.max(f.start, f.end), 1, maxPos)];
          const startCol = lowerBound(visibleCols, a);
          const endCol = lowerBound(visibleCols, b + 1) - 1;
          if (endCol < startCol) return null;
          return { startCol, endCol, feature: f };
        })
        .filter((x): x is { startCol: number; endCol: number; feature: SequenceFeature } => !!x);
      const packed = packLanes(mapped, s.annotationCompress);
      const lanes = packed.reduce((m, p) => Math.max(m, p.lane + 1), 0);
      return { items: packed, lanes };
    });
  }, [s.showAnnotations, rows, coordMaps, rowFeatures, visibleCols, s.annotationCompress]);

  const annotationColorAtCol = useMemo(() => {
    if (s.colorScheme !== 'By Annotation') return [];
    return rows.map((r, ri) => {
      const arr = new Array<string | undefined>(r.alignedSeq.length);
      const { colOfPos } = coordMaps[ri];
      const maxPos = colOfPos.length - 1;
      for (const f of rowFeatures[ri]) {
        if (maxPos < 1) break;
        const a = colOfPos[clamp(Math.min(f.start, f.end), 1, maxPos)];
        const b = colOfPos[clamp(Math.max(f.start, f.end), 1, maxPos)];
        for (let c = a; c <= b; c++) arr[c] = f.color;
      }
      return arr;
    });
  }, [s.colorScheme, rows, coordMaps, rowFeatures]);

  const trimmedCols = useMemo(
    () =>
      rows.map((r, ri) => {
        const { colOfPos } = coordMaps[ri];
        const maxPos = colOfPos.length - 1;
        const ranges: [number, number][] = [];
        for (const f of r.features) {
          if (!f.name.toLowerCase().includes('trimmed') || maxPos < 1) continue;
          ranges.push([colOfPos[clamp(f.start, 1, maxPos)], colOfPos[clamp(f.end, 1, maxPos)]]);
        }
        return ranges;
      }),
    [rows, coordMaps]
  );

  // Graph data over full alignment
  const graphs = useMemo(() => {
    const on = s.showGraphs;
    return {
      coverage: on && s.graphCoverage ? coverageByColumn(seqs, colCount) : null,
      identity: on && s.graphIdentity ? smooth(conservation, s.identityWindow) : null,
      gc: on && (s.graphGc || s.graphAt) && !s.isProtein ? smooth(gcByColumn(seqs, colCount), s.gcWindow) : null,
      at: on && s.graphAt && !s.isProtein ? smooth(atByColumn(seqs, colCount), s.gcWindow) : null,
      frame: on && s.graphFramePlot && !s.isProtein ? framePlot(consensus, s.gcWindow) : null,
      logo: on && s.graphLogo ? logoByColumn(seqs, colCount, s.isProtein) : null,
      hydro:
        on && s.graphHydrophobicity && s.isProtein
          ? smooth(hydrophobicityByColumn(seqs, colCount), s.hydrophobicityWindow)
          : null,
      pi: on && s.graphPi && s.isProtein ? smooth(isoelectricByColumn(seqs, colCount), s.piWindow) : null,
    };
  }, [
    s.showGraphs, s.graphCoverage, s.graphIdentity, s.identityWindow, s.graphGc, s.graphAt, s.isProtein, s.gcWindow,
    s.graphFramePlot, s.graphLogo, s.graphHydrophobicity, s.hydrophobicityWindow, s.graphPi, s.piWindow,
    seqs, colCount, conservation, consensus,
  ]);

  const restrictionByIdx = useMemo(() => {
    if (!s.restrictionSites) return null;
    return s.restrictionSites
      .map((h) => ({ idx: lowerBound(visibleCols, h.col), col: h.col, enzyme: h.enzyme }))
      .filter((h) => visibleCols[h.idx] === h.col);
  }, [s.restrictionSites, visibleCols]);

  // -------------------------------------------------------------- line list
  const graphH = GRAPH_H;
  const annLaneH = s.annotationThickness + (s.annotationLabels === 'Above' ? s.annotationLabelSize + 2 : 0) + 3;
  const transH = rowH + (s.showAminoAcidNumbering ? 10 : 0);

  const { headerLines, bodyLines } = useMemo(() => {
    const header: Line[] = [];
    const body: Line[] = [];
    blocks.forEach((_, b) => {
      const target = s.wrap ? body : header;
      target.push({ key: `ruler-${b}`, kind: 'ruler', height: 20, block: b });
      if (s.showConsensus) target.push({ key: `cons-${b}`, kind: 'consensus', height: rowH, block: b });
      if (restrictionByIdx && restrictionByIdx.length)
        target.push({ key: `re-${b}`, kind: 'restriction', height: 16, block: b });
      if (graphs.coverage) target.push({ key: `gcov-${b}`, kind: 'g-coverage', height: graphH, block: b });
      if (graphs.identity) target.push({ key: `gid-${b}`, kind: 'g-identity', height: graphH, block: b });
      if (graphs.gc) target.push({ key: `ggc-${b}`, kind: 'g-gc', height: graphH, block: b });
      if (graphs.frame) target.push({ key: `gfr-${b}`, kind: 'g-frame', height: graphH, block: b });
      if (graphs.hydro) target.push({ key: `ghy-${b}`, kind: 'g-hydro', height: graphH + 6, block: b });
      if (graphs.pi) target.push({ key: `gpi-${b}`, kind: 'g-pi', height: graphH, block: b });
      if (graphs.logo)
        target.push({ key: `glogo-${b}`, kind: 'g-logo', height: lettersVisible ? LOGO_LETTERS_H : graphH, block: b });
      rows.forEach((r, ri) => {
        body.push({ key: `seq-${b}-${ri}`, kind: 'seq', height: rowH, block: b, rowIdx: ri });
        if (complements.length)
          body.push({ key: `comp-${b}-${ri}`, kind: 'comp', height: rowH, block: b, rowIdx: ri });
        if (s.showTranslation && translations[ri])
          translations[ri].forEach((_, fi) =>
            body.push({ key: `tr-${b}-${ri}-${fi}`, kind: 'trans', height: transH, block: b, rowIdx: ri, frame: fi })
          );
        const fl = featureLanes[ri];
        if (fl && fl.lanes > 0)
          body.push({ key: `ann-${b}-${ri}`, kind: 'ann', height: fl.lanes * annLaneH + 2, block: b, rowIdx: ri });
      });
      if (s.wrap) body.push({ key: `sp-${b}`, kind: 'spacer', height: 14, block: b });
    });
    return { headerLines: header, bodyLines: body };
  }, [
    blocks, s.wrap, s.showConsensus, restrictionByIdx, graphs, rowH, lettersVisible, rows, complements,
    s.showTranslation, translations, transH, featureLanes, annLaneH,
  ]);

  const headerH = headerLines.reduce((acc, l) => acc + l.height, 0);
  const bodyOffsets = useMemo(() => {
    const offs = new Array<number>(bodyLines.length + 1);
    offs[0] = 0;
    for (let i = 0; i < bodyLines.length; i++) offs[i + 1] = offs[i] + bodyLines[i].height;
    return offs;
  }, [bodyLines]);
  const bodyH = bodyOffsets[bodyLines.length] ?? 0;

  /** What each wrapped block is made of (every block holds the same lines), for the wheel's anchor. */
  const blockShape = useMemo((): WrapBlockShape => {
    const shape: WrapBlockShape = { fixedPx: 0, rowLines: 0, logo: false };
    for (const l of bodyLines) {
      if (l.block !== 0) continue;
      if (l.kind === 'consensus' || l.kind === 'seq' || l.kind === 'comp') shape.rowLines++;
      else if (l.kind === 'trans') {
        shape.rowLines++;
        shape.fixedPx += l.height - rowH;
      } else if (l.kind === 'g-logo') shape.logo = true;
      else shape.fixedPx += l.height;
    }
    return shape;
  }, [bodyLines, rowH]);

  const trackW = s.wrap ? xOf(blocks[0]?.end - blocks[0]?.start || 0) : xOf(nVis);
  const contentW = nameW + trackW + 8;

  // ---------------------------------------------------------------- viewport
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setView((v) => {
          const next = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight };
          return v.left === next.left && v.top === next.top && v.width === next.width && v.height === next.height
            ? v
            : next;
        })
      );
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // A wheel or pinch zoom's view, from the moment it asks for its zoom until that zoom is drawn.
  const wheelView = useRef<AlignmentWheelView | null>(null);

  // Keep the cursor column centred when the toolbar, the % field, 100% or Fit change the zoom; a
  // wheel or pinch zoom instead scrolls to the view its step anchored on the hovered column.
  const prevZoom = useRef(zoomPct);
  useLayoutEffect(() => {
    if (prevZoom.current === zoomPct) return;
    prevZoom.current = zoomPct;
    const el = scrollRef.current;
    const wheel = wheelView.current;
    wheelView.current = null;
    if (!el) return;
    if (wheel && wheel.zoomPct === zoomPct) {
      el.scrollLeft = wheel.scrollLeft;
      el.scrollTop = wheel.scrollTop;
      return;
    }
    if (s.wrap) return;
    const idx = lowerBound(visibleCols, cursorCol - 1);
    el.scrollLeft = Math.max(0, xOf(idx) - (el.clientWidth - nameW) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomPct]);

  // What the wheel binder reads; kept current on every render.
  const wheelState = useRef({ zoomPct, context: null as AlignmentWheelContext | null, onRequestZoom });
  wheelState.current.zoomPct = zoomPct;
  wheelState.current.onRequestZoom = onRequestZoom;
  wheelState.current.context = {
    origin: { x: 0, y: 0 },
    viewportWidth: view.width,
    nameW,
    columnCount: nVis,
    settings: s,
    block: blockShape,
  };
  const hasGrid = rows.length > 0 && colCount > 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasGrid) return;
    return bindAlignmentWheel(el, {
      read: () => {
        const queued = wheelView.current;
        return queued ?? { zoomPct: wheelState.current.zoomPct, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
      },
      context: () => {
        const rect = el.getBoundingClientRect();
        const base = wheelState.current.context!;
        return { ...base, origin: { x: rect.left + (el.clientLeft || 0), y: rect.top + (el.clientTop || 0) }, viewportWidth: el.clientWidth };
      },
      apply: (next) => {
        wheelView.current = next;
        wheelState.current.onRequestZoom(next.zoomPct);
      },
    });
  }, [hasGrid]);

  const scrollToCol = useCallback(
    (col1: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = lowerBound(visibleCols, col1 - 1);
      if (!s.wrap) {
        el.scrollLeft = Math.max(0, xOf(idx) - (el.clientWidth - nameW) / 2);
        return;
      }
      const b = blocks.findIndex((bl) => idx >= bl.start && idx < bl.end);
      const li = bodyLines.findIndex((l) => l.block === Math.max(0, b));
      if (li >= 0) el.scrollTop = Math.max(0, headerH + bodyOffsets[li] - 8);
    },
    [visibleCols, s.wrap, xOf, nameW, blocks, bodyLines, bodyOffsets, headerH]
  );

  useEffect(() => {
    if (scrollRequest) scrollToCol(scrollRequest.col);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.nonce]);

  const lastFit = useRef(fitRequestNonce);
  useEffect(() => {
    if (lastFit.current === fitRequestNonce) return;
    lastFit.current = fitRequestNonce;
    const el = scrollRef.current;
    const avail = (el?.clientWidth ?? view.width) - nameW - 20;
    if (nVis <= 0 || avail <= 0) return;
    const targetColW = avail / nVis;
    const z = (targetColW / (s.letterFontSize * 0.8)) * 100;
    onRequestZoom(clampAlignmentZoom(Math.round(z * 10) / 10));
  }, [fitRequestNonce, nVis, s.letterFontSize, onRequestZoom, view.width, nameW]);

  // --------------------------------------------------------------- mini-map
  useEffect(() => {
    const cv = miniRef.current;
    if (!s.miniMap || !cv) return;
    const W = cv.clientWidth || 600;
    const H = cv.clientHeight || 48;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!nVis || !rows.length) return;
    const rh = H / rows.length;
    for (let ri = 0; ri < rows.length; ri++) {
      const seq = rows[ri].alignedSeq;
      for (let x = 0; x < W; x++) {
        const col = visibleCols[Math.min(nVis - 1, Math.floor((x / W) * nVis))];
        const color = residueSolidColor(seq[col] ?? '-', {
          scheme: s.colorScheme,
          isProtein: s.isProtein,
          refChar: refSeq[col],
          strand: rows[ri].strand,
        });
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, ri * rh, 1, Math.max(1, rh));
      }
    }
  }, [s.miniMap, rows, visibleCols, nVis, s.colorScheme, s.isProtein, refSeq]);

  const miniViewport = useMemo(() => {
    if (s.wrap || trackW <= 0) return { left: 0, width: 100 };
    const vis = Math.max(0, view.width - nameW);
    return {
      left: clamp((view.left / trackW) * 100, 0, 100),
      width: clamp((vis / trackW) * 100, 1, 100),
    };
  }, [s.wrap, trackW, view.width, view.left, nameW]);

  // ---------------------------------------------------------------- render helpers
  const winFor = (block: number): [number, number] => {
    const bl = blocks[block] ?? { start: 0, end: 0 };
    if (s.wrap) return [bl.start, bl.end];
    const lo = Math.max(0, idxAtX(Math.max(0, view.left - BUFFER_PX)));
    const hi = Math.min(nVis, idxAtX(view.left + view.width - nameW + BUFFER_PX) + 1);
    return [lo, hi];
  };
  /** x within the block's track for visible index i */
  const xIn = (block: number, i: number) => xOf(i) - (s.wrap ? xOf(blocks[block]?.start ?? 0) : 0);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>, block: number, rowIdx?: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const base = s.wrap ? xOf(blocks[block]?.start ?? 0) : 0;
    const idx = clamp(idxAtX(e.clientX - rect.left + base), 0, Math.max(0, nVis - 1));
    const col = visibleCols[idx];
    if (col !== undefined) onCursorChange(col + 1);
    if (rowIdx !== undefined) onSelectRow(rowIdx);
  };

  const cursorIdx = useMemo(() => {
    const i = lowerBound(visibleCols, cursorCol - 1);
    return visibleCols[i] === cursorCol - 1 ? i : -1;
  }, [visibleCols, cursorCol]);

  const renderCursor = (block: number, height: number) => {
    if (cursorIdx < 0) return null;
    const bl = blocks[block];
    if (!bl || cursorIdx < bl.start || cursorIdx >= bl.end) return null;
    return (
      <div
        className="mbc-aln-cursor"
        style={{ left: xIn(block, cursorIdx), width: Math.max(1, colW), height }}
      />
    );
  };

  /** Residue strip (sequence / consensus / complement). */
  const renderResidues = (
    block: number,
    seq: string,
    opts: { rowIdx?: number; isConsensus?: boolean; height: number }
  ) => {
    const [lo, hi] = winFor(block);
    if (hi <= lo) return null;
    const ri = opts.rowIdx;
    const strand = ri !== undefined ? rows[ri].strand : 1;
    const trans = ri !== undefined && translations[ri] ? translations[ri][0] : undefined;
    const annCols = ri !== undefined ? annotationColorAtCol[ri] : undefined;
    const motif = ri !== undefined ? motifSets[ri] : undefined;
    // Only the reference row itself (row 0 when highlighting against 'Reference') is exempt; rows
    // that merely equal the reference/consensus must still be highlighted and dotted.
    const isReferenceRow = s.highlightRef === 'Reference' && ri === 0;
    const highlightOn = s.showHighlighting && !opts.isConsensus && !isReferenceRow;
    const ctxFor = (col: number) => ({
      scheme: s.colorScheme,
      isProtein: s.isProtein,
      refChar: opts.isConsensus ? seq[col] : refSeq[col],
      strand,
      translatedAa: trans?.aaCoverAtCol[col],
      annotationColor: annCols?.[col],
    });
    const isDimmed = (ch: string, col: number) => {
      if (!highlightOn) return false;
      const a = ch.toUpperCase();
      const b = (refSeq[col] ?? '-').toUpperCase();
      if (a === '-') return false;
      return s.highlightMode === 'All Disagreements' ? a === b : a !== b;
    };

    if (lettersVisible) {
      const cells: React.ReactNode[] = [];
      for (let i = lo; i < hi; i++) {
        const col = visibleCols[i];
        const ch = seq[col] ?? '-';
        const dim = isDimmed(ch, col);
        const st = residueCellStyle(ch, ctxFor(col), dim);
        const agree =
          s.useDotsForAgreements &&
          !opts.isConsensus &&
          ch !== '-' &&
          !isReferenceRow &&
          ch.toUpperCase() === (refSeq[col] ?? '').toUpperCase();
        cells.push(
          <span
            key={i}
            className="mbc-aln-cell"
            style={{
              left: xIn(block, i),
              width: colW,
              background: st.background,
              color: st.color,
              boxShadow: motif?.has(col) ? 'inset 0 -3px 0 #7c3aed' : undefined,
            }}
          >
            {agree ? '.' : ch}
          </span>
        );
      }
      return (
        <div className="mbc-aln-cells" style={{ fontSize: fontPx, lineHeight: `${opts.height}px` }}>
          {cells}
        </div>
      );
    }

    // Zoomed out: merge runs of identical colour into single rects.
    const rects: React.ReactNode[] = [];
    const gapRuns: React.ReactNode[] = [];
    const h = opts.height;
    const pad = h > 6 ? 1 : 0;
    let runStart = lo;
    let runColor: string | null | undefined;
    const flush = (end: number) => {
      if (runColor === undefined || end <= runStart) return;
      const x = xIn(block, runStart);
      const w = xIn(block, end - 1) + colW - x;
      if (runColor === null) {
        gapRuns.push(
          <rect key={`g${runStart}`} x={x} y={h / 2 - 0.5} width={w} height={1} fill="var(--mbc-border)" />
        );
      } else {
        rects.push(
          <rect
            key={runStart}
            x={x}
            y={pad}
            width={Math.max(0.6, w)}
            height={h - pad * 2}
            fill={runColor}
            stroke={s.outlineZoomedOut && colW >= 3 ? 'rgba(15,23,42,0.35)' : undefined}
            strokeWidth={s.outlineZoomedOut && colW >= 3 ? 0.5 : undefined}
          />
        );
      }
    };
    for (let i = lo; i < hi; i++) {
      const col = visibleCols[i];
      const ch = seq[col] ?? '-';
      const color = isDimmed(ch, col) ? '#e2e8f0' : residueSolidColor(ch, ctxFor(col));
      const boundary = spacesEvery > 0 && i % spacesEvery === 0;
      if (color !== runColor || boundary) {
        flush(i);
        runStart = i;
        runColor = color;
      }
    }
    flush(hi);
    const x0 = xIn(block, lo);
    const x1 = xIn(block, hi - 1) + colW;
    return (
      <svg
        className="mbc-aln-svg"
        style={{ left: 0 }}
        width={Math.max(1, x1)}
        height={h}
        viewBox={`0 0 ${Math.max(1, x1)} ${h}`}
        data-x0={x0}
      >
        {gapRuns}
        {rects}
        {motif &&
          motif.size > 0 &&
          Array.from({ length: hi - lo }, (_, k) => lo + k)
            .filter((i) => motif.has(visibleCols[i]))
            .map((i) => (
              <rect key={`m${i}`} x={xIn(block, i)} y={h - 2} width={Math.max(1, colW)} height={2} fill="#7c3aed" />
            ))}
      </svg>
    );
  };

  const renderTrimmed = (block: number, ri: number, height: number) => {
    const ranges = trimmedCols[ri];
    if (!ranges || !ranges.length) return null;
    return ranges.map(([a, b], k) => {
      const ia = lowerBound(visibleCols, a);
      const ib = lowerBound(visibleCols, b + 1) - 1;
      if (ib < ia) return null;
      const bl = blocks[block];
      const sa = Math.max(ia, bl.start);
      const sb = Math.min(ib, bl.end - 1);
      if (sb < sa) return null;
      return (
        <div
          key={k}
          className="mbc-aln-trimmed"
          style={{ left: xIn(block, sa), width: xIn(block, sb) + colW - xIn(block, sa), height }}
          title="Trimmed region"
        />
      );
    });
  };

  const renderTranslation = (block: number, ri: number, fi: number, height: number) => {
    const tr = translations[ri]?.[fi];
    if (!tr) return null;
    const [lo, hi] = winFor(block);
    const nodes: React.ReactNode[] = [];
    const top = s.showAminoAcidNumbering ? 10 : 0;
    const boxH = height - top;
    for (let i = lo; i < hi; i++) {
      const col = visibleCols[i];
      const cover = tr.aaCoverAtCol[col];
      if (cover) {
        const color = cover === '*' ? '#111827' : residueSolidColor(cover, { scheme: 'Zappo', isProtein: true });
        nodes.push(
          <div
            key={`b${i}`}
            className="mbc-aln-aa-bg"
            style={{ left: xIn(block, i), width: colW, top, height: boxH, background: `${color}55` }}
          />
        );
      }
      const aa = tr.aaAtCol[col];
      if (aa && lettersVisible) {
        const three = s.threeLetterAminoAcids && colW * 3 >= fontPx * 1.9;
        const text = three ? threeLetterCode(aa) : aa;
        const w = three ? colW * 3 : colW;
        const left = three ? xIn(block, i) - colW : xIn(block, i);
        nodes.push(
          <span
            key={`t${i}`}
            className="mbc-aln-aa-text"
            style={{ left, width: w, top, height: boxH, lineHeight: `${boxH}px`, fontSize: fontPx * 0.95 }}
          >
            {text}
          </span>
        );
      }
      const k = tr.aaIndexAtCol[col];
      if (s.showAminoAcidNumbering && k > 0 && k % 10 === 0) {
        nodes.push(
          <span key={`n${i}`} className="mbc-aln-aa-num" style={{ left: xIn(block, i) }}>
            {k}
          </span>
        );
      }
    }
    return nodes;
  };

  const renderAnnotations = (block: number, ri: number) => {
    const fl = featureLanes[ri];
    if (!fl) return null;
    const bl = blocks[block];
    const [lo, hi] = winFor(block);
    return fl.items.map((it) => {
      const a = Math.max(it.startCol, bl.start, lo);
      const b = Math.min(it.endCol, bl.end - 1, hi - 1);
      if (b < a) return null;
      const left = xIn(block, a);
      const width = Math.max(2, xIn(block, b) + colW - left);
      const f = it.feature;
      const labelH = s.annotationLabels === 'Above' ? s.annotationLabelSize + 2 : 0;
      const top = it.lane * annLaneH + 1;
      const textW = f.name.length * s.annotationLabelSize * 0.6 + 8;
      const showLabel =
        s.annotationLabels !== 'None' && !(s.annotationHideExcessiveLabels && textW > width);
      const arrow = s.annotationArrowTips && width > 8 && it.endCol === b && f.strand === 1;
      const arrowRev = s.annotationArrowTips && width > 8 && it.startCol === a && f.strand === -1;
      const tip = Math.min(8, width / 3);
      const clip = arrow
        ? `polygon(0 0, calc(100% - ${tip}px) 0, 100% 50%, calc(100% - ${tip}px) 100%, 0 100%)`
        : arrowRev
        ? `polygon(${tip}px 0, 100% 0, 100% 100%, ${tip}px 100%, 0 50%)`
        : undefined;
      return (
        <React.Fragment key={f.id}>
          {showLabel && s.annotationLabels === 'Above' && (
            <span
              className="mbc-aln-ann-label-above"
              style={{ left, top, fontSize: s.annotationLabelSize, maxWidth: Math.max(width, 160) }}
            >
              {f.name}
            </span>
          )}
          <div
            className="mbc-aln-ann"
            title={`${f.name} (${f.type}: ${f.start}..${f.end}${f.strand === -1 ? ', reverse' : ''})`}
            style={{
              left,
              width,
              top: top + labelH,
              height: s.annotationThickness,
              background: `${f.color}88`,
              borderColor: f.color,
              clipPath: clip,
              fontSize: Math.min(s.annotationLabelSize, s.annotationThickness),
              lineHeight: `${s.annotationThickness}px`,
            }}
          >
            {showLabel && s.annotationLabels === 'Inside' ? f.name : ''}
          </div>
        </React.Fragment>
      );
    });
  };

  const barsPath = (
    block: number,
    lo: number,
    hi: number,
    h: number,
    valueAt: (col: number) => number,
    include?: (col: number) => boolean
  ) => {
    let d = '';
    if (colW >= 1) {
      for (let i = lo; i < hi; i++) {
        const col = visibleCols[i];
        if (include && !include(col)) continue;
        const v = clamp(valueAt(col), 0, 1);
        if (v <= 0) continue;
        const bh = Math.max(1, v * (h - 2));
        const x = xIn(block, i);
        const w = Math.max(0.6, colW - (colW > 3 ? 0.6 : 0));
        d += `M${x.toFixed(2)} ${(h - bh).toFixed(2)}h${w.toFixed(2)}v${bh.toFixed(2)}h${(-w).toFixed(2)}Z`;
      }
      return d;
    }
    // sub-pixel columns: bucket by pixel and draw the max value
    let px = -1;
    let best = 0;
    const emit = () => {
      if (px < 0 || best <= 0) return;
      const bh = Math.max(1, best * (h - 2));
      d += `M${px} ${(h - bh).toFixed(2)}h1v${bh.toFixed(2)}h-1Z`;
    };
    for (let i = lo; i < hi; i++) {
      const col = visibleCols[i];
      if (include && !include(col)) continue;
      const x = Math.floor(xIn(block, i));
      const v = clamp(valueAt(col), 0, 1);
      if (x !== px) {
        emit();
        px = x;
        best = v;
      } else best = Math.max(best, v);
    }
    emit();
    return d;
  };

  const linePath = (block: number, lo: number, hi: number, h: number, valueAt: (col: number) => number) => {
    let d = '';
    const step = Math.max(1, Math.floor(1 / Math.max(colW, 0.0001)));
    for (let i = lo; i < hi; i += step) {
      const x = xIn(block, i) + colW / 2;
      const y = h - 1 - clamp(valueAt(visibleCols[i]), 0, 1) * (h - 3);
      d += `${d ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return d;
  };

  const renderGraph = (line: Line) => {
    const [lo, hi] = winFor(line.block);
    if (hi <= lo) return null;
    const h = line.height;
    const w = xIn(line.block, hi - 1) + colW;
    let content: React.ReactNode = null;
    switch (line.kind) {
      case 'g-coverage': {
        const cov = graphs.coverage!;
        const max = Math.max(1, rows.length);
        const val = (c: number) =>
          s.coverageLogScale ? Math.log1p(cov[c]) / Math.log1p(max) : cov[c] / max;
        content = (
          <>
            <path d={barsPath(line.block, lo, hi, h, val, (c) => !s.coverageHighlightGapped || cov[c] >= max)} fill="#3b82f6" />
            {s.coverageHighlightGapped && (
              <path d={barsPath(line.block, lo, hi, h, val, (c) => cov[c] < max)} fill="#f59e0b" />
            )}
          </>
        );
        break;
      }
      case 'g-identity': {
        const id = graphs.identity!;
        content = (
          <>
            <path d={barsPath(line.block, lo, hi, h, (c) => id[c], (c) => id[c] >= 0.999)} fill="#22c55e" />
            <path d={barsPath(line.block, lo, hi, h, (c) => id[c], (c) => id[c] >= 0.3 && id[c] < 0.999)} fill="#a3a322" />
            <path d={barsPath(line.block, lo, hi, h, (c) => id[c], (c) => id[c] < 0.3)} fill="#dc2626" />
          </>
        );
        break;
      }
      case 'g-gc': {
        const gc = graphs.gc!;
        content = (
          <>
            {s.graphGc && <path d={barsPath(line.block, lo, hi, h, (c) => gc[c])} fill="#60a5fa" />}
            {s.graphAt && (
              <path d={linePath(line.block, lo, hi, h, (c) => graphs.at?.[c] ?? 0)} fill="none" stroke="#f59e0b" strokeWidth={1.2} />
            )}
          </>
        );
        break;
      }
      case 'g-frame': {
        const fr = graphs.frame!;
        const colors = ['#dc2626', '#16a34a', '#2563eb'];
        content = fr.map((vals, k) => (
          <path key={k} d={linePath(line.block, lo, hi, h, (c) => vals[c])} fill="none" stroke={colors[k]} strokeWidth={1.1} />
        ));
        break;
      }
      case 'g-hydro': {
        const hy = graphs.hydro!;
        const mid = h / 2;
        const up = barsPath(line.block, lo, hi, mid, (c) => Math.max(0, hy[c]) / 4.5);
        const down = barsPath(line.block, lo, hi, mid, (c) => Math.max(0, -hy[c]) / 4.5);
        content = (
          <>
            <path d={up} fill="#dc2626" />
            <g transform={`translate(0 ${h}) scale(1 -1)`}>
              <path d={down} fill="#2563eb" />
            </g>
            <line x1={0} x2={w} y1={mid} y2={mid} stroke="var(--mbc-border)" strokeWidth={0.6} />
          </>
        );
        break;
      }
      case 'g-pi': {
        const pi = graphs.pi!;
        content = <path d={barsPath(line.block, lo, hi, h, (c) => (pi[c] - 2.77) / (10.76 - 2.77))} fill="#8b5cf6" />;
        break;
      }
      case 'g-logo': {
        const logo = graphs.logo!;
        if (lettersVisible) {
          content = Array.from({ length: hi - lo }, (_, k) => lo + k).map((i) => {
            const col = visibleCols[i];
            const { letter, info } = logo[col];
            if (letter === '-' || info <= 0.02) return null;
            const color = residueSolidColor(letter, { scheme: s.colorScheme, isProtein: s.isProtein }) ?? '#64748b';
            const lh = Math.max(2, info * (h - 2));
            return (
              <text
                key={i}
                x={0}
                y={0}
                textAnchor="middle"
                fontWeight={800}
                fontFamily="var(--font-mono)"
                fontSize={h}
                fill={color}
                transform={`translate(${(xIn(line.block, i) + colW / 2).toFixed(2)} ${h}) scale(${(colW / (h * 0.62)).toFixed(3)} ${(lh / (h * 0.72)).toFixed(3)})`}
              >
                {letter}
              </text>
            );
          });
        } else {
          content = <path d={barsPath(line.block, lo, hi, h, (c) => logo[c].info)} fill="#7c3aed" />;
        }
        break;
      }
      default:
        break;
    }
    return (
      <svg className="mbc-aln-svg" width={Math.max(1, w)} height={h}>
        {content}
      </svg>
    );
  };

  const refRowIdx = clamp(selectedRowIdx, 0, Math.max(0, rows.length - 1));
  const renderRuler = (block: number) => {
    const [lo, hi] = winFor(block);
    const step = rulerStep(colW, 56);
    const ticks: React.ReactNode[] = [];
    const posAt = coordMaps[refRowIdx]?.posAt;
    let lastNoGapLabel = -1;
    for (let i = lo; i < hi; i++) {
      const col = visibleCols[i];
      let n: number;
      if (s.numbering === 'No gaps') {
        n = posAt ? posAt[col] : col + 1;
        if (!posAt || rows[refRowIdx].alignedSeq[col] === '-' || n === lastNoGapLabel) continue;
      } else {
        n = s.numbering === 'From 0' ? col : col + 1;
      }
      const isFirst = i === (s.wrap ? blocks[block].start : 0);
      if (n % step !== 0 && !(isFirst && n === (s.numbering === 'From 0' ? 0 : 1))) continue;
      lastNoGapLabel = n;
      const x = xIn(block, i) + colW / 2;
      ticks.push(
        <React.Fragment key={i}>
          <span className="mbc-aln-tick" style={{ left: x }} />
          <span className="mbc-aln-tick-label" style={{ left: x + 2, fontSize: s.numberFontSize }}>
            {n.toLocaleString()}
          </span>
        </React.Fragment>
      );
    }
    return ticks;
  };

  const renderRestriction = (block: number) => {
    if (!restrictionByIdx) return null;
    const [lo, hi] = winFor(block);
    return restrictionByIdx
      .filter((h) => h.idx >= lo && h.idx < hi)
      .map((h, k) => (
        <span
          key={`${h.enzyme}-${h.col}-${k}`}
          className="mbc-aln-re-site"
          style={{ left: xIn(block, h.idx) }}
          title={`${h.enzyme} at column ${h.col + 1}`}
        >
          ▼{colW >= 3 ? h.enzyme : ''}
        </span>
      ));
  };

  // ------------------------------------------------------------- name cells
  const graphMeta: Partial<Record<LineKind, [string, string]>> = {
    'g-coverage': ['Coverage', `0 – ${rows.length}${s.coverageLogScale ? ' (log)' : ''}`],
    'g-identity': ['Identity', s.identityWindow > 1 ? `w=${s.identityWindow}` : ''],
    'g-gc': [s.graphAt ? (s.graphGc ? 'GC / AT' : 'AT Content') : 'GC Content', `w=${s.gcWindow}`],
    'g-frame': ['Frame plot', 'GC1 GC2 GC3'],
    'g-logo': ['Sequence Logo', 'bits'],
    'g-hydro': ['Hydrophobicity', 'KD ±4.5'],
    'g-pi': ['Mean residue pI', '2.8 – 10.8'],
  };

  const renderName = (line: Line) => {
    const ri = line.rowIdx;
    if (line.kind === 'seq' && ri !== undefined) {
      const r = rows[ri];
      return (
        <div
          className={`mbc-aln-name ${ri === selectedRowIdx ? 'selected' : ''}`}
          style={{ fontSize: s.nameFontSize }}
          title={r.title ?? r.label}
          onClick={() => onSelectRow(ri)}
        >
          {s.showSequenceIcons && (
            <span className={`mbc-aln-seq-icon ${r.strand === -1 ? 'rev' : ''}`} aria-hidden="true">
              {s.isProtein ? '◆' : r.strand === -1 ? '◀' : '▶'}
            </span>
          )}
          <span className="mbc-aln-name-text">
            {r.label}
            {r.secondary ? <span className="mbc-aln-name-secondary"> {r.secondary}</span> : null}
          </span>
          {r.metric && <span className="mbc-aln-name-metric">{r.metric}</span>}
        </div>
      );
    }
    let label = '';
    let sub = '';
    switch (line.kind) {
      case 'ruler':
        label = s.numbering === 'No gaps' ? `Coordinate (${rows[refRowIdx]?.label ?? ''})` : 'Coordinate';
        break;
      case 'consensus':
        label = 'Consensus';
        sub = s.consensusLabel;
        break;
      case 'restriction':
        label = 'Restriction sites';
        sub = `${restrictionByIdx?.length ?? 0}`;
        break;
      case 'comp':
        sub = 'complement';
        break;
      case 'trans': {
        const multi = (translations[ri ?? 0]?.length ?? 0) > 1;
        sub = multi ? `${s.translationFrame === 'By annotation' ? 'CDS' : 'frame'} ${(line.frame ?? 0) + 1}` : `translation · ${s.translationFrame}`;
        break;
      }
      case 'ann':
        sub = 'annotations';
        break;
      default: {
        const m = graphMeta[line.kind];
        if (m) [label, sub] = m;
      }
    }
    return (
      <div className={`mbc-aln-name minor ${line.kind === 'consensus' ? 'consensus' : ''}`} style={{ fontSize: Math.max(11, s.nameFontSize - 1) }}>
        <span className="mbc-aln-name-text">{label}</span>
        {sub && <span className="mbc-aln-name-metric">{sub}</span>}
      </div>
    );
  };

  const renderTrack = (line: Line) => {
    const ri = line.rowIdx;
    const h = line.height;
    let inner: React.ReactNode = null;
    switch (line.kind) {
      case 'ruler':
        inner = renderRuler(line.block);
        break;
      case 'consensus':
        inner = renderResidues(line.block, consensus, { isConsensus: true, height: h });
        break;
      case 'restriction':
        inner = renderRestriction(line.block);
        break;
      case 'seq':
        inner = (
          <>
            {renderResidues(line.block, rows[ri!].alignedSeq, { rowIdx: ri, height: h })}
            {renderTrimmed(line.block, ri!, h)}
          </>
        );
        break;
      case 'comp':
        inner = renderResidues(line.block, complements[ri!], { rowIdx: ri, height: h, isConsensus: true });
        break;
      case 'trans':
        inner = renderTranslation(line.block, ri!, line.frame ?? 0, h);
        break;
      case 'ann':
        inner = renderAnnotations(line.block, ri!);
        break;
      case 'spacer':
        return <div className="mbc-aln-track" style={{ width: trackW, height: h }} />;
      default:
        inner = renderGraph(line);
    }
    const blockW = s.wrap ? xOf(blocks[line.block].end) - xOf(blocks[line.block].start) : trackW;
    return (
      <div
        className={`mbc-aln-track kind-${line.kind}`}
        style={{ width: blockW, height: h }}
        onClick={(e) => handleTrackClick(e, line.block, line.kind === 'seq' || line.kind === 'comp' || line.kind === 'trans' || line.kind === 'ann' ? ri : undefined)}
      >
        {inner}
        {line.kind !== 'ruler' && renderCursor(line.block, h)}
      </div>
    );
  };

  const renderLine = (line: Line, style?: React.CSSProperties) => (
    <div
      key={line.key}
      className={`mbc-aln-line ${line.kind === 'seq' && line.rowIdx === selectedRowIdx ? 'selected' : ''} ${line.kind === 'spacer' ? 'spacer' : ''}`}
      style={{ height: line.height, width: contentW, ...style }}
    >
      {line.kind === 'spacer' ? <div className="mbc-aln-name minor" /> : renderName(line)}
      {renderTrack(line)}
    </div>
  );

  // Vertical window over body lines
  const bodyTopInView = view.top - (s.wrap ? 0 : headerH);
  const firstLine = Math.max(0, lowerBound(bodyOffsets, bodyTopInView - BUFFER_PX) - 1);
  const lastLine = Math.min(bodyLines.length, lowerBound(bodyOffsets, bodyTopInView + view.height + BUFFER_PX) + 1);

  if (!rows.length || colCount === 0) {
    return <div className="mbc-aln-empty">No aligned sequences to display.</div>;
  }

  return (
    <div className="mbc-aln-canvas-root" style={{ '--mbc-aln-name-w': `${nameW}px` } as React.CSSProperties}>
      {s.miniMap && (
        <div
          className="mbc-aln-minimap"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
            const idx = Math.min(nVis - 1, Math.floor(frac * nVis));
            const col = visibleCols[idx] + 1;
            onCursorChange(col);
            scrollToCol(col);
          }}
          title="Mini-map — click to navigate"
        >
          <canvas ref={miniRef} />
          {!s.wrap && (
            <div
              className="mbc-aln-minimap-viewport"
              style={{ left: `${miniViewport.left}%`, width: `${miniViewport.width}%` }}
            />
          )}
        </div>
      )}
      {/* The scrolling grid, and over the name column's edge its resize handle (US-01M6S7QS). */}
      <div className="mbc-aln-scroll-frame">
        <div className="mbc-aln-scroll" ref={scrollRef} tabIndex={0} aria-label="Alignment viewer">
          <div style={{ width: contentW, minHeight: (s.wrap ? 0 : headerH) + bodyH }}>
            {!s.wrap && headerLines.length > 0 && (
              <div className="mbc-aln-header" style={{ width: contentW }}>
                {headerLines.map((l) => renderLine(l))}
              </div>
            )}
            <div className="mbc-aln-body" style={{ height: bodyH, width: contentW }}>
              {bodyLines.slice(firstLine, lastLine).map((l, k) =>
                renderLine(l, { position: 'absolute', top: bodyOffsets[firstLine + k], left: 0 })
              )}
            </div>
          </div>
        </div>
        {nameColumnHandle}
      </div>
    </div>
  );
};
