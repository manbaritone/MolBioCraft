// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import {
  ORFRecord,
  PrimerRecord,
  RestrictionCutSite,
  SequenceDocument,
  SequenceFeature,
} from '../types/bio';
import { getResidentTrackOverviewRust } from '../lib/rustBioEngine';
import { cutSiteDisplayPosition } from '../core/restrictionDisplay';

interface CircularPlasmidMapProps {
  doc: SequenceDocument;
  cutSites: RestrictionCutSite[];
  /**
   * Each enzyme's complete site count over what `cutSites` cover (the scan's `siteCounts`,
   * BG-01M6S1K2), which `cutSites` may hold only the first sites of: the single cutters and the
   * plate's site count are read from it. Absent, they are counted from `cutSites`.
   */
  siteCounts?: Readonly<Record<string, number>>;
  orfs: ORFRecord[];
  /**
   * The first bases `orfs` were found in when it is not the whole molecule, and the shortest ORF
   * (in aa) kept there; absent, they are the molecule's.
   */
  orfScope?: { firstBp?: number; minAa?: number } | null;
  selectedRange: { start: number; end: number } | null;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
  showOrfs: boolean;
  showPrimers: boolean;
  showUniqueCuttersOnly: boolean;
  /** What `cutSites` cover when it is not the whole molecule; absent, they are the molecule's. */
  restrictionScope?: RestrictionScanScope | null;
  /**
   * The map's box on screen, in pixels, when it is known before the map is laid out: a render with
   * no layout (the server, a test) measures nothing, and lays the map out at this size instead of
   * full size. Where the map is laid out, its own measurement replaces it.
   */
  measuredBox?: { width: number; height: number };
  /** The sequence map's one zoom, in percent (see SEQUENCE_ZOOM_MIN..SEQUENCE_ZOOM_MAX). */
  zoomLevel?: number;
  /**
   * Reports a zoom change made on the map (⌘/Ctrl/⌥+wheel, double-click), as an update of the
   * caller's zoom; the map keeps no zoom of its own.
   */
  onZoomChange?: (update: (current: number) => number) => void;
  /**
   * Changes each time the caller restores the view (⌘0, View › Actual Size, the 100% readout): the
   * map then recentres a panned circle, as a double-click on it does.
   */
  viewRestoreKey?: number;
}

/**
 * The sequence map's one zoom, in percent of the fitted size. The viewer header's − / % / +
 * buttons, ⌘= / ⌘- / ⌘0 and View › Zoom, ⌘/Ctrl/⌥+wheel and double-click on the circle all move
 * this one value, and a restored session is held to the same range.
 */
export const SEQUENCE_ZOOM_MIN = 65;
export const SEQUENCE_ZOOM_MAX = 260;
export const SEQUENCE_ZOOM_DEFAULT = 100;
/** One button or key step, in percentage points. */
export const SEQUENCE_ZOOM_STEP = 10;

/** A zoom held to SEQUENCE_ZOOM_MIN..SEQUENCE_ZOOM_MAX; a value that is not a number is 100%. */
export function clampSequenceZoom(percent: number): number {
  if (!Number.isFinite(percent)) return SEQUENCE_ZOOM_DEFAULT;
  return Math.min(SEQUENCE_ZOOM_MAX, Math.max(SEQUENCE_ZOOM_MIN, percent));
}

/** The zoom one button or key step in (`1`) or out (`-1`) from `percent`. */
export function stepSequenceZoom(percent: number, direction: 1 | -1): number {
  return clampSequenceZoom(clampSequenceZoom(percent) + direction * SEQUENCE_ZOOM_STEP);
}

/**
 * The zoom one ⌘/Ctrl/⌥+wheel notch moves `percent` to: 8% larger rolling up, 7.5% smaller rolling
 * down, to the whole percent.
 */
export function wheelSequenceZoom(percent: number, deltaY: number): number {
  const from = clampSequenceZoom(percent);
  if (deltaY === 0) return from;
  return clampSequenceZoom(Math.round(from * (deltaY < 0 ? 1.08 : 0.925)));
}

/**
 * A stored primer's Tm as every display of a primer record reads it (BG-01M6T6RZ): the record's
 * `tmNoAnswerReason` where its anneal sequence holds N or another base that is not A, C, G or T
 * ("Tm n/a: the span holds k N or other ambiguity base(s); ...", the engine's words, which
 * `tmNoAnswerSentence` also writes), and "Tm <tmAnnealC>°C" otherwise: the number as stored, or to
 * `digits` decimals for a display that gives it so. A degenerate primer's record holds ambiguity codes
 * but no reason (its Tm is its A/C/G/T versions'), so it reads its number. `full` reads the whole
 * primer's Tm (`tmFullC`, 5′ tail included) the same way, as "Tm n/a" where the record has a reason,
 * since the whole primer holds its anneal sequence's bases. A record whose 5′ tail alone holds N
 * carries no reason, so its full Tm still reads a number. `prefix: false` gives the number without
 * the "Tm " before it ("61.2°C"), for a column whose header already names Tm; a reason keeps its
 * words.
 */
export function primerTmText(
  primer: Pick<PrimerRecord, 'tmAnnealC' | 'tmFullC' | 'tmNoAnswerReason'>,
  { digits, full = false, prefix = true }: { digits?: number; full?: boolean; prefix?: boolean } = {}
): string {
  if (primer.tmNoAnswerReason) return full ? 'Tm n/a' : primer.tmNoAnswerReason;
  const tm = full ? primer.tmFullC : primer.tmAnnealC;
  const value = `${digits === undefined ? tm : tm.toFixed(digits)}°C`;
  return prefix ? `Tm ${value}` : value;
}

export interface CircularCalloutInput {
  id: string;
  kind: 'feature' | 'enzyme-unique' | 'primer' | 'enzyme-multi';
  priority: number;
  angleDeg: number;
  anchorRadius: number;
  label: string;
  color: string;
  lineColor: string;
  bold: boolean;
  hoverText: string;
  selectRange: { start: number; end: number; label: string };
}

export interface CircularCalloutPlaced extends CircularCalloutInput {
  side: 'right' | 'left';
  anchorX: number;
  anchorY: number;
  kneeX: number;
  kneeY: number;
  elbowX: number;
  labelX: number;
  labelY: number;
  displayLabel: string;
}

export interface AdaptiveCircularTick {
  bp: number;
  angle: number;
  label: string;
}

export function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/**
 * Selects an adaptive `1, 2, 5 × 10^k` coordinate step yielding ~6–12 clean ruler ticks
 * across any sequence scale from 500 bp plasmids up to 10+ Mbp bacterial chromosomes.
 */
export function computeAdaptiveCircularTicks(seqLen: number): AdaptiveCircularTick[] {
  const safeLen = Math.max(1, seqLen);
  if (safeLen < 120) return [];

  const targetTicks = 9;
  const rawStep = safeLen / targetTicks;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
  const norm = rawStep / pow10;
  let niceMultiplier = 1;
  if (norm >= 7.5) {
    niceMultiplier = 10;
  } else if (norm >= 3.2) {
    niceMultiplier = 5;
  } else if (norm >= 1.6) {
    niceMultiplier = 2;
  } else {
    niceMultiplier = 1;
  }
  const step = Math.max(50, Math.round(niceMultiplier * pow10));

  const formatTick = (bp: number): string => {
    if (safeLen >= 1_000_000) {
      const mb = bp / 1_000_000;
      return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} Mb`;
    }
    if (safeLen >= 25_000) {
      const kb = bp / 1_000;
      return `${Number.isInteger(kb) ? kb.toFixed(0) : kb.toFixed(1)} kb`;
    }
    return bp.toLocaleString();
  };

  const out: AdaptiveCircularTick[] = [];
  for (let bp = step; bp < safeLen - step * 0.25; bp += step) {
    out.push({
      bp,
      angle: (bp / safeLen) * 360,
      label: formatTick(bp),
    });
  }
  return out;
}

function normalizeAngle(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

// The reset hint leads: where the footer is one line (Split side by side), the end is what is cut.
const CIRCULAR_MAP_TIP =
  'Tip: Double-click to reset • Drag to pan • ⌘/Ctrl+Wheel to zoom • Click any feature, ORF, or site to jump';

/** The most ORFs the ORF ring draws, the longest first (the ORF list comes longest first). */
const ORF_RING_ARCS = 8;

/** The most feature arcs the circular map draws, the longest first; one arc per interval. */
const FEATURE_ARCS_DRAWN = 240;

/**
 * The ResultWarnings sentence for a view that draws or lists fewer items than there are
 * (BG-01M6S1AA): "The ORF ring draws the 8 longest of 17 ORFs.", "The pane shows the first 200 of
 * 250 sequences.", or none when it shows them all. `total` is the document's or the engine's
 * count, never the length of the list the view cut.
 */
export function subsetNote(
  subject: string,
  shown: number,
  total: number,
  noun: string,
  which: 'longest' | 'first'
): string[] {
  if (!(shown < total)) return [];
  const n = (v: number) => v.toLocaleString('en-US');
  return [`${subject} the ${which === 'first' ? `first ${n(shown)}` : `${n(shown)} longest`} of ${n(total)} ${noun}.`];
}

/**
 * The divisor of the stride `compute_genome_track_overview` (crates/molbiocraft-core/src/
 * genome_index.rs) reads each bin at: 1 base in k, k = floor(window / 2048), the window being the
 * overview's `windowBp`. From 4,096 bp a bin (737,280 bp at the maps' 180 bins) k is 2 or more.
 */
const TRACK_OVERVIEW_STRIDE_BP = 2048;

/**
 * The mean GC of a track overview as the maps print it (BG-01M6S1AA): the value, and, when the
 * engine read 1 base in k of each bin to compute it, the words that label it approximate.
 */
export function meanGcWords(overview: { meanGcPercent: number; windowBp: number }): { value: string; approx: string | null } {
  const stride = Math.max(1, Math.floor(overview.windowBp / TRACK_OVERVIEW_STRIDE_BP));
  return {
    value: `${overview.meanGcPercent.toFixed(1)}%`,
    approx: stride > 1 ? `approx., 1 base in ${stride.toLocaleString('en-US')} sampled` : null,
  };
}

/** The smallest size, in screen pixels, at which the circular map draws any of its labels. */
export const CIRCULAR_MAP_LABEL_FLOOR_PX = 9;

/**
 * The screen-pixel pitch of neighbouring callout labels, and the height of each callout's hit
 * area: the 24px target size of WCAG 2.5.8.
 */
export const CIRCULAR_MAP_TARGET_PX = 24;

/**
 * The font size, in map units, of a label whose base size is `baseSize` units on a map drawn at
 * `renderScale` screen pixels per unit (the measured size of the 680x540 view times its zoom). It
 * is the base size, raised so the label is never drawn below CIRCULAR_MAP_LABEL_FLOOR_PX; a map
 * drawn at or above full size keeps the base size, which then grows with the zoom.
 */
export function circularMapLabelSize(baseSize: number, renderScale: number): number {
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  return Math.max(baseSize, CIRCULAR_MAP_LABEL_FLOOR_PX / scale);
}

/** Screen pixels per map unit of the 680x540 view drawn into a `width` x `height` box (meet scaling). */
export function fitCircularMapScale(width: number, height: number): number {
  return Math.min(width / 680, height / 540);
}

/**
 * Whether the identity plate (212x54 units at the view's top-left corner, 18,20) still clears the
 * map's outer ring (radius 168 about 340,270) once enlarged by `scale`.
 */
function plateFits(scale: number): boolean {
  const nearestX = Math.min(340, 18 + 212 * scale);
  const nearestY = Math.min(270, 20 + 54 * scale);
  return Math.hypot(340 - nearestX, 270 - nearestY) >= 168;
}

/** The width of a callout character in ems: Google Sans Code's advance (1200/2000), and wider than Google Sans's average. */
const CALLOUT_CHAR_EM = 0.6;

/** A size in map units, written to two decimals and rounded up, so rounding never takes it below a floor. */
const units = (n: number) => String(Math.ceil(n * 100 - 1e-9) / 100);

/** The inner edge of the innermost track drawn on the ring (the ORF track, r 117..126). */
const RING_INNER_TRACK_R = 117;

/** Google Sans Code's line box (hhea ascent 1932 plus descent 572 per 2000: 1.252 em), centred on `y` by a central baseline. */
const MONO_LINE_EM = 1.252;

export interface CircularTickLabel extends AdaptiveCircularTick {
  /** The centre of the label, in map units. */
  x: number;
  y: number;
  /** The label's box: its characters at Google Sans Code's advance, and the font's line box tall. */
  width: number;
  height: number;
}

/**
 * Seats the ring coordinate labels inside the innermost track. Each label sits on its tick's radius
 * as far out as its own box allows: the box's farthest corner lands a third of an em inside
 * `innerTrackRadius` (unless the label is wider than the track itself), so no arc is drawn over a
 * digit. When
 * neighbouring labels would come closer than half a character, only every second tick is labelled
 * (then every fourth, and so on), so every label drawn is whole and stands clear of the next. The
 * ticks themselves are all still drawn.
 */
export function layoutCircularTickLabels(
  ticks: AdaptiveCircularTick[],
  opts: { cx: number; cy: number; fontSize: number; innerTrackRadius: number }
): CircularTickLabel[] {
  const { cx, cy, fontSize, innerTrackRadius } = opts;
  const limit = innerTrackRadius - fontSize / 3;
  const seated = ticks.map((t) => {
    const width = t.label.length * fontSize * CALLOUT_CHAR_EM;
    const height = fontSize * MONO_LINE_EM;
    const rad = ((t.angle - 90) * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    // The farthest corner of a box (half sides a, b) centred r along the radius is at distance
    // sqrt((r|ux| + a)^2 + (r|uy| + b)^2); setting that to `limit` and solving for r gives:
    const [a, b] = [width / 2, height / 2];
    const reach = a * Math.abs(ux) + b * Math.abs(uy);
    const r = Math.max(0, Math.sqrt(Math.max(0, reach * reach - a * a - b * b + limit * limit)) - reach);
    return { ...t, x: cx + r * ux, y: cy + r * uy, width, height };
  });
  const gap = (fontSize * CALLOUT_CHAR_EM) / 2;
  const apart = (a: CircularTickLabel, b: CircularTickLabel) =>
    Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + gap ||
    Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + gap;
  for (let every = 1; every <= seated.length; every *= 2) {
    // Every `every`-th tick: multiples of `every` ruler steps, so the labels stay round numbers.
    const shown = seated.filter((_, i) => (i + 1) % every === 0);
    if (shown.every((a, i) => shown.every((b, j) => j <= i || apart(a, b)))) return shown;
  }
  return [];
}

/** The note's size on screen: DESIGN.md's caption role (Google Sans 400, 11px). */
const CALLOUT_NOTE_PX = 11;

/**
 * What a restriction scan covered when it is not the whole molecule (BG-01M6RPWR): only the first
 * `firstBp` bases, read as a linear sequence, or only the engine's first `coreEnzymes` catalog
 * enzymes.
 */
export interface RestrictionScanScope {
  firstBp?: number;
  coreEnzymes?: number;
}

/**
 * How many of the catalog's first enzymes the engine scans a sequence of more than 100,000 bp
 * with: the Rust constant `CORE_CATALOG_LEN` in crates/molbiocraft-cloning/src/rebase_catalog.rs,
 * which `find_restriction_cut_sites` slices its default catalog by. A test reads that line and
 * holds this one equal to it.
 */
export const CORE_CATALOG_LEN = 28;

/**
 * How many of a `lengthBp` molecule's first bases the workbench scans for cut sites: the whole
 * molecule up to 150,000 bp, and only the first 60,000 bp (read as a linear sequence) beyond. The
 * App and the split pane both scan this many, so neither keeps its own copy of the rule.
 */
export function restrictionScannedBp(lengthBp: number): number {
  return lengthBp > 150_000 ? 60_000 : lengthBp;
}

/**
 * What a restriction scan of the first `scannedBp` bases of a `lengthBp` molecule covers, as the
 * engine runs it (more than 100,000 bp with the core catalog only); null when it covers the whole
 * molecule with the whole catalog.
 */
export function restrictionScanScope(lengthBp: number, scannedBp = lengthBp): RestrictionScanScope | null {
  const scope: RestrictionScanScope = {
    ...(scannedBp < lengthBp ? { firstBp: scannedBp } : {}),
    ...(scannedBp > 100_000 ? { coreEnzymes: CORE_CATALOG_LEN } : {}),
  };
  return scope.firstBp || scope.coreEnzymes ? scope : null;
}

/**
 * The plain words a partial scan's counts carry, so none reads as the whole molecule's:
 * `sites` follows a count of sites, `once` follows "Cutting once", `short` goes in parentheses or
 * after a comma, and `detail` is the sentence that says what was left out. Null when the scope
 * names neither a range nor a catalog, that is, when the scan covered the whole molecule.
 */
export function restrictionScopeWords(
  scope: RestrictionScanScope | null | undefined,
  lengthBp: number
): { sites: string; once: string; short: string; detail: string } | null {
  const first = scope?.firstBp ? scope.firstBp.toLocaleString() : '';
  const core = scope?.coreEnzymes ? scope.coreEnzymes.toLocaleString() : '';
  if (!first && !core) return null;
  const join = (parts: string[], sep: string) => parts.filter(Boolean).join(sep);
  return {
    sites: join([first && `in the first ${first} bp`, core && `from ${core} core enzymes`], ' '),
    once: join([first && `in the first ${first} bp`, core && `among ${core} core enzymes`], ' '),
    short: join([first && `first ${first} bp`, core && `${core} core enzymes`], ', '),
    detail: join(
      [
        first &&
          `Only the first ${first} of ${lengthBp.toLocaleString()} bp were scanned, as a linear sequence: an enzyme listed here may cut again past ${first} bp.`,
        core && `Only ${core} core enzymes were scanned: other enzymes may also cut this sequence.`,
      ],
      ' '
    ),
  };
}

/**
 * The plain note that says how many callouts the map left out, and where to find them. `sites` are
 * cut sites with no callout, `annotations` features and primers with none. It falls back to a
 * shorter line when the full one would not fit `maxChars`.
 *
 * `scope` is the short words of a partial scan (restrictionScopeWords), and every line drawn for
 * one names it (BG-01M6RPWR): the full line with the sites, then the short line with "…, first
 * 60,000 bp scanned", then, where neither fits or nothing is left out, the scope alone ("Cut
 * sites: first 60,000 bp only"), which is drawn at any width.
 */
export function circularCalloutNote(sites: number, annotations: number, maxChars: number, scope?: string | null): string | null {
  const scopeOnly = scope ? `Cut sites: ${scope} only` : null;
  if (sites <= 0 && annotations <= 0) return scopeOnly;
  const plural = (n: number, word: string) => `${n.toLocaleString()} more ${word}${n === 1 ? '' : 's'}`;
  const restrictionList = scope ? `Restriction Analysis (${scope})` : 'Restriction Analysis';
  const full =
    sites > 0 && annotations > 0
      ? `${plural(sites, 'site')} in ${restrictionList}, ${annotations.toLocaleString()} in Annotations`
      : sites > 0
      ? `${plural(sites, 'site')} in ${restrictionList}`
      : scope
      ? `${plural(annotations, 'label')} in Annotations; cut sites: ${scope} only`
      : `${plural(annotations, 'label')} in Annotations`;
  if (full.length <= maxChars) return full;
  const short = `${plural(sites + annotations, 'label')} not shown`;
  if (!scope) return short;
  const scoped = `${short}, ${scope} scanned`;
  return scoped.length <= maxChars ? scoped : scopeOnly;
}

function truncateCalloutText(text: string, maxChars = 22): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/**
 * Deterministic 2-pass monotonic spider-leg callout layout solver.
 * Separates callout labels vertically on both right (0..180 deg) and left (180..360 deg)
 * hemispheres so no two labels ever overlap and no two leader lines cross.
 */
export function layoutCircularCallouts(
  items: CircularCalloutInput[],
  opts: {
    cx: number;
    cy: number;
    viewHeight: number;
    rKnee: number;
    rEnvelope: number;
    minGapY?: number;
    marginY?: number;
    maxPerSide?: number;
    /** The top of the left column, when something (the identity plate) sits above it. */
    leftMinY?: number;
    /** The bottom of both columns, when something (the left-out note) sits below them. */
    maxY?: number;
  }
): CircularCalloutPlaced[] {
  const {
    cx,
    cy,
    viewHeight,
    rKnee,
    rEnvelope,
    minGapY = 17.5,
    marginY = 22,
    maxPerSide = 25,
    leftMinY = marginY,
    maxY: columnBottom = viewHeight - marginY,
  } = opts;

  const rightRaw: CircularCalloutInput[] = [];
  const leftRaw: CircularCalloutInput[] = [];

  for (const item of items) {
    const norm = normalizeAngle(item.angleDeg);
    const normalized = { ...item, angleDeg: norm };
    if (norm <= 180) {
      rightRaw.push(normalized);
    } else {
      leftRaw.push(normalized);
    }
  }

  const selectAndSolveSide = (
    raw: CircularCalloutInput[],
    side: 'right' | 'left'
  ): CircularCalloutPlaced[] => {
    const minY = side === 'left' ? Math.max(marginY, leftMinY) : marginY;
    const maxY = Math.min(viewHeight - marginY, columnBottom);
    // No more callouts than fit the column at the gap: the ones that do not fit are left out
    // (lowest priority first), never pushed past the column's ends.
    const fits = Math.max(0, Math.floor((maxY - minY) / minGapY) + 1);
    const limit = Math.min(maxPerSide, fits);
    const capped =
      raw.length <= limit
        ? raw
        : [...raw]
            .sort((a, b) => a.priority - b.priority || a.angleDeg - b.angleDeg)
            .slice(0, limit);

    const ordered = [...capped].sort((a, b) =>
      side === 'right' ? a.angleDeg - b.angleDeg : b.angleDeg - a.angleDeg
    );

    if (ordered.length === 0) return [];

    const ys = ordered.map((it) => {
      const naturalPt = polarToCartesian(cx, cy, rEnvelope, it.angleDeg);
      return Math.max(minY, Math.min(maxY, naturalPt.y));
    });

    for (let i = 1; i < ys.length; i++) {
      if (ys[i] < ys[i - 1] + minGapY) {
        ys[i] = ys[i - 1] + minGapY;
      }
    }

    if (ys[ys.length - 1] > maxY) {
      ys[ys.length - 1] = maxY;
      for (let i = ys.length - 2; i >= 0; i--) {
        if (ys[i] > ys[i + 1] - minGapY) {
          ys[i] = ys[i + 1] - minGapY;
        }
      }
    }

    if (ys[0] < minY) {
      ys[0] = minY;
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] < ys[i - 1] + minGapY) {
          ys[i] = ys[i - 1] + minGapY;
        }
      }
    }

    return ordered.map((it, idx) => {
      const labelY = ys[idx];
      const anchor = polarToCartesian(cx, cy, it.anchorRadius, it.angleDeg);
      const knee = polarToCartesian(cx, cy, rKnee, it.angleDeg);
      const dy = labelY - cy;
      const horizReach = Math.sqrt(
        Math.max(64 * 64, rEnvelope * rEnvelope - Math.min(rEnvelope - 12, Math.abs(dy)) ** 2)
      );
      const rawElbowX = side === 'right' ? cx + horizReach : cx - horizReach;
      const elbowX =
        side === 'right'
          ? Math.max(knee.x + 6, rawElbowX)
          : Math.min(knee.x - 6, rawElbowX);
      const labelX = side === 'right' ? elbowX + 4 : elbowX - 4;

      return {
        ...it,
        side,
        anchorX: anchor.x,
        anchorY: anchor.y,
        kneeX: knee.x,
        kneeY: knee.y,
        elbowX,
        labelX,
        labelY,
        displayLabel: truncateCalloutText(it.label, 23),
      };
    });
  };

  return [
    ...selectAndSolveSide(rightRaw, 'right'),
    ...selectAndSolveSide(leftRaw, 'left'),
  ];
}

function describeFeatureArc(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
  strand: 1 | -1 | 0
): string {
  const span = Math.max(2.5, Math.min(358, endAngle - startAngle));
  // A record that states no direction gets no bevel: the ribbon is a plain arc, so the map
  // never implies a strand the annotation does not claim.
  const bevel = strand === 0 ? 0 : Math.min(5.2, span * 0.34);

  // MolBioCraft ribbon: the leading edge is a single slanted bevel running from the outer
  // radius down to the inner radius, so a feature reads as a bevelled ribbon rather than a
  // symmetric centre-pointed arrow. Direction is carried by which end the bevel sits on.
  const arcStart = strand === -1 ? startAngle + bevel : startAngle;
  const arcEnd = strand === -1 ? startAngle + span : startAngle + span - bevel;
  const largeArc = arcEnd - arcStart > 180 ? 1 : 0;

  const pOuterStart = polarToCartesian(cx, cy, rOuter, arcStart);
  const pOuterEnd = polarToCartesian(cx, cy, rOuter, arcEnd);
  const pInnerEnd = polarToCartesian(cx, cy, rInner, arcEnd);
  const pInnerStart = polarToCartesian(cx, cy, rInner, arcStart);

  if (strand !== -1) {
    const pTip = polarToCartesian(cx, cy, rInner, startAngle + span);
    return [
      `M ${pOuterStart.x.toFixed(2)} ${pOuterStart.y.toFixed(2)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${pOuterEnd.x.toFixed(2)} ${pOuterEnd.y.toFixed(2)}`,
      `L ${pTip.x.toFixed(2)} ${pTip.y.toFixed(2)}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pInnerStart.x.toFixed(2)} ${pInnerStart.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }
  const pTip = polarToCartesian(cx, cy, rInner, startAngle);
  return [
    `M ${pOuterStart.x.toFixed(2)} ${pOuterStart.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${pOuterEnd.x.toFixed(2)} ${pOuterEnd.y.toFixed(2)}`,
    `L ${pInnerEnd.x.toFixed(2)} ${pInnerEnd.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pTip.x.toFixed(2)} ${pTip.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const CircularPlasmidMap: React.FC<CircularPlasmidMapProps> = ({
  doc,
  cutSites,
  siteCounts,
  orfs,
  orfScope = null,
  selectedRange,
  onSelectRange,
  showOrfs,
  showPrimers,
  showUniqueCuttersOnly,
  restrictionScope = null,
  measuredBox,
  zoomLevel = SEQUENCE_ZOOM_DEFAULT,
  onZoomChange,
  viewRestoreKey = 0,
}) => {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Screen pixels per map unit of the drawn SVG (meet scaling of the 680x540 view). A render with
  // no layout (the server, a test) measures nothing and keeps the box it is given, or 1.
  const [measuredScale, setMeasuredScale] = useState<number>(() =>
    measuredBox ? fitCircularMapScale(measuredBox.width, measuredBox.height) : 1
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<{
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, pointerId: -1, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    const onBlur = () => {
      dragStateRef.current.dragging = false;
      dragStateRef.current.pointerId = -1;
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  const handleDownloadCircularSvg = () => {
    const svgEl = svgRef.current;
    if (!svgEl || typeof XMLSerializer === 'undefined') return;
    const raw = new XMLSerializer().serializeToString(svgEl);
    const payload = raw.startsWith('<?xml')
      ? raw
      : `<?xml version="1.0" encoding="UTF-8"?>\n${raw}`;
    // Resolve theme CSS variables so the file renders the same outside the app.
    const rootStyle = getComputedStyle(document.documentElement);
    const resolved = payload.replace(/var\((--[A-Za-z0-9-]+)(?:,\s*([^)]+))?\)/g, (_m, name: string, fallback?: string) =>
      rootStyle.getPropertyValue(name).trim() || (fallback ?? '').trim() || 'currentColor'
    );
    saveWorkbenchFile(`${doc.name}_circular_map.svg`, resolved, 'image/svg+xml;charset=utf-8');
  };

  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [doc.id]);

  // A restore by the caller recentres the circle, as its zoom returns to 100%.
  const [restoredFor, setRestoredFor] = useState(viewRestoreKey);
  if (restoredFor !== viewRestoreKey) {
    setRestoredFor(viewRestoreKey);
    setPanOffset({ x: 0, y: 0 });
  }

  const seqLen = Math.max(1, doc.sequence.length);
  const isProtein = doc.moleculeType === 'Protein';
  const unitLabel = isProtein ? 'aa' : 'bp';
  const viewWidth = 680;
  const viewHeight = 540;
  const cx = 340;
  const cy = 270;
  const rBackbone = 146;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const box = svg.getBoundingClientRect();
      // A hidden map (zero box) keeps the scale it was last drawn at.
      if (!(box.width > 0 && box.height > 0)) return;
      const next = fitCircularMapScale(box.width, box.height);
      // A smaller map is always re-measured, so no label is drawn below the floor; a slight growth is not.
      setMeasuredScale((current) => (next >= current && next - current < 0.005 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // The labels live inside the zoomed view group, so they are drawn at the measured scale times
  // the zoom. Each label is sized for that, and the callouts are spaced so every one keeps a
  // 24px-tall hit area of its own; a callout that does not fit is left out (it stays in the
  // inspector's lists and the hover readout), never drawn smaller.
  const effectiveScale = zoomLevel / 100;
  const renderScale = measuredScale * effectiveScale;
  const calloutGapY = Math.max(17.5, CIRCULAR_MAP_TARGET_PX / renderScale);
  const calloutMarginY = 20;
  const tickLabelSize = circularMapLabelSize(10, renderScale);
  const plateScale = circularMapLabelSize(10.2, renderScale) / 10.2;
  const plateShown = plateFits(plateScale);
  // When the ORF arcs cover only the first bases (BG-01M6RTHN: over 150,000 bp the App finds ORFs
  // in the first 60,000 bp only, and only those of 120 aa or more), the map says so under the
  // identity plate, or in its corner when the plate is not drawn, at the caption size on screen
  // (11px), in Google Sans, in line boxes as tall as the mono labels' (MONO_LINE_EM), which Google
  // Sans's own line box (966 plus 286 per 1000: 1.252 em) fills exactly. The length floor takes a second, shorter line, so both clear the ring at the default
  // Split view: "ORFs: first 60,000 bp" over "(120 aa or more)".
  const orfScopeLines =
    showOrfs && !isProtein && orfScope?.firstBp && orfScope.firstBp < seqLen
      ? (() => {
          const fontSize = Number(units(Math.max(CALLOUT_NOTE_PX, CALLOUT_NOTE_PX / renderScale)));
          const top = plateShown ? 20 + 54 * plateScale + 4 : calloutMarginY;
          const lineHeight = fontSize * MONO_LINE_EM;
          const texts = [
            `ORFs: first ${orfScope.firstBp.toLocaleString()} bp`,
            ...(orfScope.minAa ? [`(${orfScope.minAa.toLocaleString()} aa or more)`] : []),
          ];
          return {
            fontSize,
            lines: texts.map((text, i) => ({ text, x: 18, y: top + lineHeight * i + lineHeight / 2 })),
            bottom: top + lineHeight * texts.length,
          };
        })()
      : null;
  // The left column starts below the identity plate (top-left corner) and the ORF scope lines under
  // it, so no label sits under either.
  const calloutLeftMinY = orfScopeLines
    ? orfScopeLines.bottom + calloutGapY / 2
    : plateShown ? 20 + 54 * plateScale + calloutGapY / 2 : calloutMarginY;

  const enzymeCounts = useMemo((): Readonly<Record<string, number>> => {
    if (siteCounts) return siteCounts;
    const counts: Record<string, number> = {};
    for (const c of cutSites) {
      counts[c.enzyme.name] = (counts[c.enzyme.name] || 0) + 1;
    }
    return counts;
  }, [cutSites, siteCounts]);

  const displayedCuts = useMemo(() => {
    if (isProtein) return [];
    const filtered = showUniqueCuttersOnly
      ? cutSites.filter((c) => enzymeCounts[c.enzyme.name] === 1)
      : cutSites;
    return [...filtered]
      .sort((a, b) => {
        const ua = enzymeCounts[a.enzyme.name] === 1 ? 0 : 1;
        const ub = enzymeCounts[b.enzyme.name] === 1 ? 0 : 1;
        return ua - ub || a.position - b.position;
      })
      .slice(0, 32);
  }, [cutSites, enzymeCounts, showUniqueCuttersOnly, isProtein]);

  // The identity plate counts every cut site the map is set to show (all, or the single cutters
  // only), the count the Restriction Analysis list gives, not the 32 at most it offers the callouts.
  // With complete counts, every site is counted, kept or not (BG-01M6S1K2).
  const plateSiteCount = useMemo(() => {
    if (isProtein) return 0;
    if (showUniqueCuttersOnly) return cutSites.filter((c) => enzymeCounts[c.enzyme.name] === 1).length;
    return siteCounts ? Object.values(siteCounts).reduce((n, k) => n + k, 0) : cutSites.length;
  }, [cutSites, siteCounts, enzymeCounts, showUniqueCuttersOnly, isProtein]);
  // What a partial or reduced scan covered (BG-01M6RPWR): the map's note names it at every size.
  const scopeWords = isProtein ? null : restrictionScopeWords(restrictionScope, seqLen);
  // A scan of the first bases only cannot tell that an enzyme cuts the molecule once, so the map
  // calls none unique: no "unique" on the plate, and no unique emphasis (bold, blue) on a callout.
  const partialScan = !isProtein && Boolean(restrictionScope?.firstBp);
  const plateSitesWord = !showUniqueCuttersOnly ? 'sites' : partialScan ? 'cut once' : 'unique sites';

  // Every arc the features make, one per interval of a joined feature: what the map's arcs are
  // counted against when it draws only the longest (BG-01M6S1AA).
  const featureArcs = useMemo(
    () => doc.features.reduce((n, f) => n + (f.segments && f.segments.length > 1 ? f.segments.length : 1), 0),
    [doc.features]
  );
  const visibleFeatures = useMemo(() => {
    // Multi-interval (joined) features are drawn as one arc per interval, so an origin-spanning
    // D-loop or a spliced gene is not painted over the bases between its parts.
    const expanded = doc.features.flatMap((f) =>
      f.segments && f.segments.length > 1
        ? f.segments.map((seg, k) => ({
            ...f,
            id: `${f.id}-part-${k + 1}`,
            name: k === 0 ? f.name : `${f.name} (part ${k + 1})`,
            start: seg.start,
            end: seg.end,
            segments: undefined,
          }))
        : [f]
    );
    if (expanded.length <= FEATURE_ARCS_DRAWN) return expanded;
    return [...expanded]
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, FEATURE_ARCS_DRAWN);
  }, [doc.features]);
  // What the ring and the arcs leave out, said beside the map. The ORF ring draws only when ORFs are shown.
  const orfRingShown = showOrfs && !isProtein;
  const mapCoverage = [
    ...(orfRingShown ? subsetNote('The ORF ring draws', Math.min(orfs.length, ORF_RING_ARCS), orfs.length, 'ORFs', 'longest') : []),
    ...subsetNote(
      'The map draws',
      visibleFeatures.length,
      featureArcs,
      featureArcs > doc.features.length ? 'feature intervals (one arc each)' : 'features',
      'longest'
    ),
  ];

  // Resident Rust Sequence Store overview (cached 180-bin GC%, cumulative GC-skew, oriC/terC)
  const trackOverview = useMemo(
    () => getResidentTrackOverviewRust(doc, 180),
    [doc]
  );
  const meanGc = meanGcWords(trackOverview);

  const { gcPlotPath, skewPlotPath } = useMemo(() => {
    const gcBins = trackOverview.gcFractionBins;
    const skewBins = trackOverview.cumulativeGcSkewBins;
    const steps = Math.max(1, gcBins.length);
    const gcPts: string[] = [];
    const skewPts: string[] = [];

    let maxAbsSkew = 1e-6;
    for (let i = 0; i < skewBins.length; i++) {
      const a = Math.abs(skewBins[i]);
      if (a > maxAbsSkew) maxAbsSkew = a;
    }

    for (let i = 0; i < steps; i++) {
      const ratio = gcBins[i] ?? 0.5;
      const rGc = 76 + (ratio - 0.5) * 24;
      const angle = (i / steps) * 360;
      const ptGc = polarToCartesian(cx, cy, rGc, angle);
      gcPts.push(`${i === 0 ? 'M' : 'L'} ${ptGc.x.toFixed(1)} ${ptGc.y.toFixed(1)}`);

      const normSkew = (skewBins[i] ?? 0) / maxAbsSkew;
      const rSkew = 56 + normSkew * 7.5;
      const ptSkew = polarToCartesian(cx, cy, rSkew, angle);
      skewPts.push(`${i === 0 ? 'M' : 'L'} ${ptSkew.x.toFixed(1)} ${ptSkew.y.toFixed(1)}`);
    }

    return {
      gcPlotPath: `${gcPts.join(' ')} Z`,
      skewPlotPath: `${skewPts.join(' ')} Z`,
    };
  }, [trackOverview]);

  const ticks = useMemo(() => computeAdaptiveCircularTicks(seqLen), [seqLen]);
  const tickLabels = useMemo(
    () => layoutCircularTickLabels(ticks, { cx, cy, fontSize: tickLabelSize, innerTrackRadius: RING_INNER_TRACK_R }),
    [ticks, tickLabelSize]
  );

  // Unified spider-leg outer callouts across Features, Primers, and Restriction Sites (zero overlaps)
  const { placed: placedCallouts, note: calloutNote } = useMemo(() => {
    const inputs: CircularCalloutInput[] = [];

    for (const feat of visibleFeatures) {
      const startAngle = ((feat.start - 1) / seqLen) * 360;
      const endAngle = (feat.end / seqLen) * 360;
      const midAngle = (startAngle + endAngle) / 2;
      const anchorRadius = feat.strand === 1 ? rBackbone + 16 : rBackbone - 7;
      inputs.push({
        id: `feat-${feat.id}`,
        kind: 'feature',
        priority: 1,
        angleDeg: midAngle,
        anchorRadius,
        label: feat.name,
        color: 'var(--mbc-text-main)',
        lineColor: feat.color || 'var(--mbc-border-strong)',
        bold: true,
        hoverText: `${feat.name} [${feat.type}] ${feat.start.toLocaleString()}..${feat.end.toLocaleString()} (${(
          feat.end - feat.start + 1
        ).toLocaleString()} ${unitLabel}, ${feat.strand === 1 ? 'Forward' : 'Reverse'})`,
        selectRange: {
          start: feat.start,
          end: feat.end,
          label: `${feat.name} (${feat.type})`,
        },
      });
    }

    if (showPrimers && !isProtein) {
      for (const prm of doc.primers) {
        const startAngle = ((prm.bindStart - 1) / seqLen) * 360;
        const endAngle = Math.max(startAngle + 3, (prm.bindEnd / seqLen) * 360);
        const midAngle = (startAngle + endAngle) / 2;
        inputs.push({
          id: `prm-${prm.id}`,
          kind: 'primer',
          priority: 2,
          angleDeg: midAngle,
          anchorRadius: rBackbone + 4,
          label: prm.name,
          color: 'var(--mbc-green)',
          lineColor: 'var(--mbc-green)',
          bold: true,
          hoverText: `Primer ${prm.name}: 5'-${prm.sequence}-3' (${prm.bindStart}..${prm.bindEnd}, ${primerTmText(prm)})`,
          selectRange: {
            start: prm.bindStart,
            end: prm.bindEnd,
            label: `Primer ${prm.name} (${primerTmText(prm)})`,
          },
        });
      }
    }

    for (const cut of displayedCuts) {
      const cutAt = cutSiteDisplayPosition(cut.cutTop, seqLen);
      const angle = (cutAt / seqLen) * 360;
      const cutsOnce = enzymeCounts[cut.enzyme.name] === 1;
      // Drawn as a unique cutter only when the scan covered the whole molecule.
      const isUnique = cutsOnce && !partialScan;
      const color = cut.methylationBlocked
        ? 'var(--mbc-red)'
        : cut.enzyme.isTypeIIS
        ? 'var(--mbc-amber)'
        : isUnique
        ? 'var(--mbc-blue)'
        : 'var(--mbc-text-secondary)';
      const lineColor = cut.enzyme.isTypeIIS
        ? 'var(--mbc-amber)'
        : isUnique
        ? 'var(--mbc-blue)'
        : 'var(--mbc-border-strong)';

      inputs.push({
        id: `cut-${cut.id}`,
        kind: isUnique ? 'enzyme-unique' : 'enzyme-multi',
        // Cutters give way to features and primers when callouts are left out, and multi-cutters
        // to single cutters: a cutter stays in the inspector's Restriction Analysis list, while a
        // feature's or primer's callout is the full-size target for its small arc or marker. (An
        // enzyme cutting once in a partial scan still comes first, drawn plain.)
        priority: cutsOnce ? 3 : 4,
        angleDeg: angle,
        anchorRadius: rBackbone + 2,
        label: `${cut.enzyme.name} (${cutAt})`,
        color,
        lineColor,
        bold: isUnique,
        hoverText: `${cut.enzyme.name} (${cut.enzyme.recognitionSeq}) cuts after ${cutAt} (${
          cut.overhangType
        } overhang ${cut.overhangSeq || 'Blunt'})`,
        selectRange: {
          start: cut.position,
          end: cut.position + cut.enzyme.recognitionSeq.length - 1,
          label: `${cut.enzyme.name} cuts after ${cutAt}`,
        },
      });
    }

    const layoutOpts = {
      cx,
      cy,
      viewHeight,
      rKnee: 170,
      rEnvelope: 186,
      minGapY: calloutGapY,
      marginY: calloutMarginY,
      maxPerSide: 25,
      leftMinY: calloutLeftMinY,
    };
    // What the map leaves without a callout: cut sites it would show (all, or the single cutters)
    // and features and primers, counted against what the layout placed.
    const leftOut = (placed: CircularCalloutPlaced[]) => {
      const ids = new Set(placed.map((c) => c.id));
      const sites = plateSiteCount - placed.filter((c) => c.kind === 'enzyme-unique' || c.kind === 'enzyme-multi').length;
      const features = doc.features.filter(
        (f) => !ids.has(`feat-${f.id}`) && !placed.some((c) => c.id.startsWith(`feat-${f.id}-part-`))
      ).length;
      const primers = showPrimers && !isProtein ? doc.primers.filter((p) => !ids.has(`prm-${p.id}`)).length : 0;
      return { sites, annotations: features + primers };
    };
    let placed = layoutCircularCallouts(inputs, layoutOpts);
    let note: { text: string; x: number; y: number; fontSize: number; pinned: boolean } | null = null;
    const missing = leftOut(placed);
    // A partial or reduced scan always has a note, since it names the scope (the plate, which
    // does not fit a small map, cannot carry it).
    if (missing.sites + missing.annotations > 0 || scopeWords) {
      // The note sits in the bottom-left corner of the frame, below both columns, at the caption
      // size on screen; the columns end above it, which can leave out one more callout each.
      const fontSize = Number(units(Math.max(CALLOUT_NOTE_PX, CALLOUT_NOTE_PX / renderScale)));
      const top = viewHeight - 6 - fontSize;
      placed = layoutCircularCallouts(inputs, { ...layoutOpts, maxY: top - calloutGapY / 2 });
      const final = leftOut(placed);
      // A scope's note is pinned to the frame, outside the zoomed and panned view, so it stays on
      // screen at every zoom and pan; it is sized for the measured map alone (the same size as
      // the view's own note at 100%).
      const size = scopeWords ? Number(units(Math.max(CALLOUT_NOTE_PX, CALLOUT_NOTE_PX / measuredScale))) : fontSize;
      const text = circularCalloutNote(
        final.sites,
        final.annotations,
        Math.floor((viewWidth - 36) / (size * CALLOUT_CHAR_EM)),
        scopeWords?.short
      );
      if (text) note = { text, x: 18, y: viewHeight - 6 - size / 2, fontSize: size, pinned: Boolean(scopeWords) };
    }
    return {
      placed: placed.map((c) => {
        const fontSize = circularMapLabelSize(c.kind === 'feature' ? (c.bold ? 11.4 : 10.9) : 10.4, renderScale);
        // As many characters as fit between the label's seat and the edge of the view.
        const room = c.side === 'right' ? viewWidth - 6 - c.labelX : c.labelX - 6;
        const fitChars = Math.max(4, Math.floor(room / (fontSize * CALLOUT_CHAR_EM)));
        return {
          ...c,
          fontSize,
          displayLabel: c.displayLabel.length > fitChars ? truncateCalloutText(c.label, fitChars) : c.displayLabel,
        };
      }),
      note,
    };
  }, [
    visibleFeatures,
    doc.features,
    doc.primers,
    showPrimers,
    showUniqueCuttersOnly,
    isProtein,
    cutSites,
    displayedCuts,
    enzymeCounts,
    plateSiteCount,
    seqLen,
    unitLabel,
    calloutGapY,
    calloutLeftMinY,
    renderScale,
    measuredScale,
    scopeWords?.short,
    partialScan,
  ]);

  const oricPt = polarToCartesian(
    cx,
    cy,
    rBackbone,
    ((trackOverview.predictedOricBp - 1) / seqLen) * 360
  );
  const tercPt = polarToCartesian(
    cx,
    cy,
    rBackbone,
    ((trackOverview.predictedTercBp - 1) / seqLen) * 360
  );

  const isViewTransformed = panOffset.x !== 0 || panOffset.y !== 0;

  const calloutNoteText = calloutNote && (
    <text
      className="circular-callout-note"
      x={calloutNote.x}
      y={calloutNote.y}
      dominantBaseline="middle"
      fill="var(--mbc-text-muted)"
      fontSize={units(calloutNote.fontSize)}
      style={{
        fontFamily: 'var(--font-sans)',
        pointerEvents: 'none',
        // Pinned over a zoomed or panned map, it keeps a canvas halo, as the ring coordinates do.
        ...(calloutNote.pinned
          ? {
              paintOrder: 'stroke',
              stroke: 'var(--mbc-bg-canvas)',
              strokeWidth: (3 * calloutNote.fontSize) / 10,
              strokeLinejoin: 'round' as const,
            }
          : {}),
      }}
    >
      {calloutNote.text}
    </text>
  );

  return (
    <div className="plasmid-map-wrapper" data-mbc-figure>
      <div className="circular-map-hud-bar">
        <span className="circular-hover-pill" aria-live="polite">
          {hoveredItem
            ? hoveredItem
            : selectedRange
            ? `Selected ${selectedRange.start.toLocaleString()}..${selectedRange.end.toLocaleString()} (${(
                Math.abs(selectedRange.end - selectedRange.start) + 1
              ).toLocaleString()} ${unitLabel})`
            : !isProtein
            ? `Mean GC ${meanGc.value}${meanGc.approx ? ` (${meanGc.approx})` : ''} • ${doc.features.length} features`
            : `${seqLen.toLocaleString()} aa polypeptide`}
        </span>
        <div className="circular-hud-actions">
          <FigureExportButton
            compact
            baseName={`${doc.name} — Circular Map`}
            title={`${doc.name} — circular sequence map`}
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
              caption: `${doc.name} — ${doc.features.length} features over ${seqLen.toLocaleString()} ${unitLabel}`,
            }}
          />
          <button
            type="button"
            className="seq-quick-pill-btn"
            onClick={handleDownloadCircularSvg}
            title="Export circular map as vector SVG"
          >
            SVG
          </button>
        </div>
      </div>
      {mapCoverage.length > 0 && (
        <div style={{ paddingInline: 10 }}>
          <ResultWarnings warnings={mapCoverage} label="Circular map coverage" />
        </div>
      )}
      <div
        className="plasmid-canvas-scroll"
        onDoubleClick={() => {
          setPanOffset({ x: 0, y: 0 });
          onZoomChange?.(() => SEQUENCE_ZOOM_DEFAULT);
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            e.preventDefault();
            const deltaY = e.deltaY;
            onZoomChange?.((z) => wheelSequenceZoom(z, deltaY));
          }
        }}
        onPointerDown={(e) => {
          if (dragStateRef.current.dragging) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.clickable-arc')) return;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // Ignore capture errors in synthetic test environments
          }
          dragStateRef.current = {
            dragging: true,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            origX: panOffset.x,
            origY: panOffset.y,
          };
        }}
        onPointerMove={(e) => {
          if (!dragStateRef.current.dragging) return;
          if (
            dragStateRef.current.pointerId !== -1 &&
            e.pointerId !== dragStateRef.current.pointerId
          ) {
            return;
          }
          const dx = e.clientX - dragStateRef.current.startX;
          const dy = e.clientY - dragStateRef.current.startY;
          setPanOffset({
            x: Math.max(-240, Math.min(240, dragStateRef.current.origX + dx)),
            y: Math.max(-200, Math.min(200, dragStateRef.current.origY + dy)),
          });
        }}
        onPointerUp={(e) => {
          if (
            dragStateRef.current.pointerId !== -1 &&
            e.pointerId !== dragStateRef.current.pointerId
          ) {
            return;
          }
          dragStateRef.current.dragging = false;
          dragStateRef.current.pointerId = -1;
          try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            // Ignore release errors
          }
        }}
        onPointerCancel={(e) => {
          if (
            dragStateRef.current.pointerId !== -1 &&
            e.pointerId !== dragStateRef.current.pointerId
          ) {
            return;
          }
          dragStateRef.current.dragging = false;
          dragStateRef.current.pointerId = -1;
        }}
        onLostPointerCapture={() => {
          dragStateRef.current.dragging = false;
          dragStateRef.current.pointerId = -1;
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="plasmid-svg"
          shapeRendering="geometricPrecision"
          textRendering="geometricPrecision"
          role="img"
          aria-label={`Circular Sequence View of ${doc.name}`}
        >
          <g
            className="plasmid-viewport-group"
            transform={
              isViewTransformed || effectiveScale !== 1
                ? `translate(${(cx + panOffset.x).toFixed(2)}, ${(cy + panOffset.y).toFixed(2)}) scale(${effectiveScale.toFixed(4)}) translate(${-cx}, ${-cy})`
                : undefined
            }
          >
            {/* Inner GC% & Cumulative GC-Skew Rings */}
          {!isProtein && (
            <>
              {/* Composition traces are reference data, not the subject of the figure:
                  they stay as unfilled hairlines around a 50 % baseline so the middle of
                  the map reads as empty space. */}
              <circle
                cx={cx}
                cy={cy}
                r={76}
                fill="none"
                stroke="var(--mbc-border)"
                strokeWidth="0.7"
                strokeDasharray="2 5"
              />
              <path
                d={gcPlotPath}
                fill="none"
                stroke="var(--mbc-blue)"
                strokeWidth="0.9"
                opacity="0.5"
              />
              {seqLen >= 2_000 && (
                <path
                  d={skewPlotPath}
                  fill="none"
                  stroke="var(--mbc-teal)"
                  strokeWidth="0.8"
                  strokeDasharray="2 3"
                  opacity="0.45"
                />
              )}
            </>
          )}

          {/* Backbone: one hairline baseline with the two strand lanes resting on it,
              rather than a heavy double ring the features sit on top of. */}
          <circle
            cx={cx}
            cy={cy}
            r={rBackbone}
            fill="none"
            stroke="var(--mbc-border-strong)"
            strokeWidth="0.9"
          />
          <circle
            cx={cx}
            cy={cy}
            r={rBackbone + 17}
            fill="none"
            stroke="var(--mbc-border)"
            strokeWidth="0.7"
            strokeDasharray="1 4"
            opacity="0.75"
          />
          <circle
            cx={cx}
            cy={cy}
            r={rBackbone - 17}
            fill="none"
            stroke="var(--mbc-border)"
            strokeWidth="0.7"
            strokeDasharray="1 4"
            opacity="0.75"
          />

          {/* Origin wedge: a solid notch marking base 1 at twelve o'clock. */}
          <path
            d={`M ${cx} ${cy - rBackbone - 23} L ${cx - 5.4} ${cy - rBackbone - 12} L ${
              cx + 5.4
            } ${cy - rBackbone - 12} Z`}
            fill="var(--mbc-blue)"
          />

          {/* Selected Range Highlight Sector */}
          {selectedRange && (
            <path
              d={describeFeatureArc(
                cx,
                cy,
                rBackbone - 20,
                rBackbone + 20,
                ((selectedRange.start - 1) / seqLen) * 360,
                (selectedRange.end / seqLen) * 360,
                1
              )}
              fill="rgba(251, 188, 4, 0.24)"
              stroke="var(--mbc-amber)"
              strokeWidth="1.4"
            />
          )}

          {/* Adaptive Coordinate Ruler Ticks, labelled inside the innermost track */}
          {ticks.map((t) => {
            const p1 = polarToCartesian(cx, cy, rBackbone - 3, t.angle);
            const p2 = polarToCartesian(cx, cy, rBackbone - 9, t.angle);
            return (
              <line
                key={t.bp}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="var(--mbc-text-muted)"
                strokeWidth="1.15"
              />
            );
          })}
          {tickLabels.map((t) => (
            <text
              key={t.bp}
              className="circular-tick-label"
              x={t.x}
              y={t.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--mbc-text-secondary)"
              fontSize={units(tickLabelSize)}
              fontWeight="600"
              style={{
                fontFamily: 'var(--font-mono)',
                paintOrder: 'stroke',
                stroke: 'var(--mbc-bg-canvas)',
                strokeWidth: (3 * tickLabelSize) / 10,
                strokeLinejoin: 'round',
              }}
            >
              {t.label}
            </text>
          ))}

          {/* Chromosomal oriC / terC Replication Markers */}
          {!isProtein && seqLen >= 20_000 && (
            <>
              <circle
                cx={oricPt.x}
                cy={oricPt.y}
                r={4.2}
                fill="var(--mbc-green)"
                stroke="var(--mbc-bg-canvas)"
                strokeWidth="1.2"
                className="clickable-arc"
                onClick={() =>
                  onSelectRange({
                    start: Math.max(1, trackOverview.predictedOricBp),
                    end: Math.min(seqLen, trackOverview.predictedOricBp + 250),
                    label: 'Predicted oriC (GC-skew minimum)',
                  })
                }
                onMouseEnter={() =>
                  setHoveredItem(
                    `Predicted oriC replication origin (cumulative GC-skew minimum): ${trackOverview.predictedOricBp.toLocaleString()} bp`
                  )
                }
                onMouseLeave={() => setHoveredItem(null)}
              >
                <title>{`Predicted oriC @ ${trackOverview.predictedOricBp.toLocaleString()} bp`}</title>
              </circle>
              <circle
                cx={tercPt.x}
                cy={tercPt.y}
                r={4.2}
                fill="var(--mbc-amber)"
                stroke="var(--mbc-bg-canvas)"
                strokeWidth="1.2"
                className="clickable-arc"
                onClick={() =>
                  onSelectRange({
                    start: Math.max(1, trackOverview.predictedTercBp),
                    end: Math.min(seqLen, trackOverview.predictedTercBp + 250),
                    label: 'Predicted terC (GC-skew maximum)',
                  })
                }
                onMouseEnter={() =>
                  setHoveredItem(
                    `Predicted terC replication terminus (cumulative GC-skew maximum): ${trackOverview.predictedTercBp.toLocaleString()} bp`
                  )
                }
                onMouseLeave={() => setHoveredItem(null)}
              >
                <title>{`Predicted terC @ ${trackOverview.predictedTercBp.toLocaleString()} bp`}</title>
              </circle>
            </>
          )}

          {/* ORF Prediction Track (dedicated ring r = 117..126) */}
          {orfRingShown &&
            orfs.slice(0, ORF_RING_ARCS).map((orf) => {
              const startAngle = ((orf.start - 1) / seqLen) * 360;
              // an ORF across the origin ends "after" 360°
              const endAngle = ((orf.end + (orf.end < orf.start ? seqLen : 0)) / seqLen) * 360;
              const d = describeFeatureArc(
                cx,
                cy,
                117,
                126,
                startAngle,
                endAngle,
                orf.strand
              );
              return (
                <path
                  key={orf.id}
                  d={d}
                  fill="#fbbc04"
                  stroke="#c26401"
                  strokeWidth="0.9"
                  className="clickable-arc"
                  onClick={() =>
                    onSelectRange({
                      start: Math.min(orf.start, orf.end),
                      end: Math.max(orf.start, orf.end),
                      label: `ORF Frame ${
                        orf.frame > 0 ? `+${orf.frame}` : orf.frame
                      } (${orf.lengthAa} aa)`,
                    })
                  }
                  onMouseEnter={() =>
                    setHoveredItem(
                      `ORF (${orf.strand > 0 ? '+' : '-'}${Math.abs(orf.frame)}): ${
                        orf.start
                      }..${orf.end} (${orf.lengthAa} aa, ${orf.mwKda} kDa)`
                    )
                  }
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <title>{`ORF Frame ${orf.frame} (${orf.start}..${orf.end}, ${orf.lengthAa} aa)`}</title>
                </path>
              );
            })}
          {/* What the ORF track covers, when it is not the whole molecule. */}
          {orfScopeLines?.lines.map((line) => (
            <text
              key={line.text}
              className="circular-orf-scope"
              x={line.x}
              y={line.y}
              dominantBaseline="middle"
              fill="var(--mbc-text-muted)"
              fontSize={units(orfScopeLines.fontSize)}
              style={{ fontFamily: 'var(--font-sans)', pointerEvents: 'none' }}
            >
              {line.text}
            </text>
          ))}

          {/* Annotated Sequence Feature Directional Arcs */}
          {visibleFeatures.map((feat: SequenceFeature) => {
            const startAngle = ((feat.start - 1) / seqLen) * 360;
            const endAngle = (feat.end / seqLen) * 360;
            const rIn = feat.strand === 1 ? rBackbone + 4 : rBackbone - 17;
            const rOut = feat.strand === -1 ? rBackbone - 4 : rBackbone + 17;
            const d = describeFeatureArc(
              cx,
              cy,
              rIn,
              rOut,
              startAngle,
              endAngle,
              feat.strand
            );

            const featReadout = `${feat.name} [${feat.type}] ${feat.start.toLocaleString()}..${feat.end.toLocaleString()} (${(
              feat.end - feat.start + 1
            ).toLocaleString()} ${unitLabel}, ${
              feat.strand === 1 ? 'Forward' : 'Reverse'
            })`;

            return (
              <path
                key={feat.id}
                d={d}
                fill={feat.color}
                stroke="var(--mbc-border-strong)"
                strokeWidth="0.95"
                opacity="0.94"
                className="clickable-arc"
                tabIndex={0}
                role="button"
                aria-label={`Select ${feat.name} (${feat.type}, ${feat.start} to ${feat.end})`}
                onClick={() =>
                  onSelectRange({
                    start: feat.start,
                    end: feat.end,
                    label: `${feat.name} (${feat.type})`,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectRange({
                      start: feat.start,
                      end: feat.end,
                      label: `${feat.name} (${feat.type})`,
                    });
                  }
                }}
                onMouseEnter={() => setHoveredItem(featReadout)}
                onMouseLeave={() => setHoveredItem(null)}
                onFocus={() => setHoveredItem(featReadout)}
                onBlur={() => setHoveredItem(null)}
              >
                <title>{`${feat.name} (${feat.type}: ${feat.start}..${feat.end})`}</title>
              </path>
            );
          })}

          {/* Primer Binding Marker Dots on Ring */}
          {showPrimers &&
            !isProtein &&
            doc.primers.map((prm) => {
              const startAngle = ((prm.bindStart - 1) / seqLen) * 360;
              const endAngle = Math.max(startAngle + 3, (prm.bindEnd / seqLen) * 360);
              const midAngle = (startAngle + endAngle) / 2;
              const pt = polarToCartesian(cx, cy, rBackbone + 4, midAngle);
              const prmReadout = `Primer ${prm.name}: ${prm.sequence} (${prm.bindStart}..${prm.bindEnd}, ${primerTmText(prm)})`;
              return (
                <circle
                  key={prm.id}
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5}
                  fill="var(--mbc-green)"
                  className="clickable-arc"
                  tabIndex={0}
                  role="button"
                  aria-label={`Select primer ${prm.name} (${prm.bindStart} to ${prm.bindEnd}, ${primerTmText(prm)})`}
                  onClick={() =>
                    onSelectRange({
                      start: prm.bindStart,
                      end: prm.bindEnd,
                      label: `Primer ${prm.name} (${primerTmText(prm)})`,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectRange({
                        start: prm.bindStart,
                        end: prm.bindEnd,
                        label: `Primer ${prm.name} (${primerTmText(prm)})`,
                      });
                    }
                  }}
                  onMouseEnter={() => setHoveredItem(prmReadout)}
                  onMouseLeave={() => setHoveredItem(null)}
                  onFocus={() => setHoveredItem(prmReadout)}
                  onBlur={() => setHoveredItem(null)}
                >
                  <title>{`Primer ${prm.name} (${prm.bindStart}..${prm.bindEnd})`}</title>
                </circle>
              );
            })}

          {/* De-Collided Spider-Leg Outer Callouts */}
          {placedCallouts.map((c) => (
            <g
              key={c.id}
              className="clickable-arc"
              tabIndex={0}
              role="button"
              aria-label={`Select ${c.displayLabel}`}
              onClick={() => onSelectRange(c.selectRange)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectRange(c.selectRange);
                }
              }}
              onMouseEnter={() => setHoveredItem(c.hoverText)}
              onMouseLeave={() => setHoveredItem(null)}
              onFocus={() => setHoveredItem(c.hoverText)}
              onBlur={() => setHoveredItem(null)}
            >
              <title>{c.hoverText}</title>
              {/* The callout's hit area: a band as tall as the callout pitch (24px on screen) and
                  at least as wide, over the label. */}
              <rect
                className="circular-callout-hit"
                x={c.side === 'right' ? c.labelX - 2 : c.labelX + 2 - Math.max(calloutGapY, c.displayLabel.length * c.fontSize * CALLOUT_CHAR_EM + 4)}
                y={c.labelY - calloutGapY / 2}
                width={Math.max(calloutGapY, c.displayLabel.length * c.fontSize * CALLOUT_CHAR_EM + 4)}
                height={calloutGapY}
                fill="transparent"
              />
              {/* Hairline connector terminating in a square seat at the label, with a dot
                  on the ring at the anchor — a quieter alternative to long tapered leaders. */}
              <polyline
                points={`${c.anchorX.toFixed(1)},${c.anchorY.toFixed(1)} ${c.kneeX.toFixed(
                  1
                )},${c.kneeY.toFixed(1)} ${c.elbowX.toFixed(1)},${c.labelY.toFixed(1)}`}
                fill="none"
                stroke={c.lineColor}
                strokeWidth="0.75"
                strokeOpacity="0.55"
              />
              <circle cx={c.anchorX} cy={c.anchorY} r={c.bold ? 2.1 : 1.5} fill={c.lineColor} />
              <rect
                x={c.side === 'right' ? c.elbowX : c.elbowX - 2.4}
                y={c.labelY - 2.4}
                width="2.4"
                height="4.8"
                fill={c.lineColor}
              />
              <text
                x={c.labelX}
                y={c.labelY}
                textAnchor={c.side === 'right' ? 'start' : 'end'}
                dominantBaseline="middle"
                fill={c.color}
                fontSize={units(c.fontSize)}
                fontWeight={c.kind === 'feature' ? (c.bold ? '700' : '500') : '500'}
                style={
                  c.kind === 'feature'
                    ? undefined
                    : { fontFamily: 'var(--font-mono)', letterSpacing: '-0.015em' }
                }
              >
                {c.displayLabel}
              </text>
            </g>
          ))}

          {/* Identity plate.
              The construct name, length and counts sit on a left-aligned plate in the frame
              corner instead of stacked in the middle of the ring, which keeps the centre of
              the map empty and readable and gives the figure a different silhouette. */}
          {plateShown && (
          <g transform={plateScale === 1 ? 'translate(18, 20)' : `translate(18, 20) scale(${units(plateScale)})`} style={{ pointerEvents: 'none' }}>
            <rect
              x="0"
              y="0"
              width="212"
              height="54"
              rx="4"
              fill="var(--mbc-bg-canvas)"
              fillOpacity="0.88"
              stroke="var(--mbc-border)"
              strokeWidth="0.8"
            />
            <rect x="0" y="0" width="3.5" height="54" rx="1.75" fill="var(--mbc-blue)" />
            <text
              x="13"
              y="20"
              fill="var(--mbc-text-main)"
              fontSize="13.5"
              fontWeight="700"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {truncateCalloutText(doc.name, 24)}
            </text>
            <text
              x="13"
              y="36"
              fill="var(--mbc-text-secondary)"
              fontSize="11"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {seqLen.toLocaleString()} {unitLabel} · {doc.topology}
            </text>
            <text x="13" y="48.5" fill="var(--mbc-text-muted)" fontSize="10.2">
              {doc.features.length} annotations · {plateSiteCount.toLocaleString()} {plateSitesWord}
            </text>
          </g>
          )}
          {/* What the callouts leave out, and where it is listed, in the frame's bottom-left corner. */}
          {calloutNote && !calloutNote.pinned && calloutNoteText}
          </g>
          {/* A partial or reduced scan's note names what the scan covered, and stays in the frame's
              corner at every zoom and pan. */}
          {calloutNote?.pinned && calloutNoteText}
        </svg>
      </div>

      <div className="map-footer-bar" title={hoveredItem || CIRCULAR_MAP_TIP}>
        <span className="map-hover-readout">{hoveredItem || CIRCULAR_MAP_TIP}</span>
      </div>
    </div>
  );
};
