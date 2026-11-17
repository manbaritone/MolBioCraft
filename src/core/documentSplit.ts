// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The document split (US-01M7DVR0): whether the viewer shows one document (Single Pane) or a second
 * document beside it (Side by Side) or below it (Top and Bottom), and which document that second pane
 * shows. One rule per fact: this module owns the orientations, the class each one gives the split
 * host, the value a session saves, and `parseDocumentSplit`, the only reader of a saved value.
 *
 * The divider between the two panes (US-01M7DVB1): the main pane's share along the active axis (width
 * side by side, height top and bottom), each expanded pane's minimum along it, which pane is folded
 * away, and the keys. The collapse fraction and the key steps are paneSplit's; its clamp is bound to
 * the circular and linear maps' own minimums and gap, so the clamp here applies this split's.
 */

import { PANE_COLLAPSE_FRACTION, PANE_SPLIT_KEY_STEP_LARGE_PX, PANE_SPLIT_KEY_STEP_PX } from './paneSplit';
import { circularMapUnavailableReason } from './commandAvailability';
import { normalize } from './mapRotation';
import type { MoleculeType, Topology } from '../types/bio';

export type DocumentSplitOrientation = 'single' | 'side-by-side' | 'top-bottom';

/** The orientations in the order the chooser and the View › Document Split submenu list them, with their labels. */
export const DOCUMENT_SPLIT_CHOICES: readonly { orientation: DocumentSplitOrientation; label: string }[] = [
  { orientation: 'single', label: 'Single Pane' },
  { orientation: 'side-by-side', label: 'Side by Side' },
  { orientation: 'top-bottom', label: 'Top and Bottom' },
];

const isOrientation = (v: unknown): v is DocumentSplitOrientation =>
  DOCUMENT_SPLIT_CHOICES.some((c) => c.orientation === v);

/**
 * The split host's classes: `is-split` while a second pane shows, with the orientation's own class,
 * and `is-collapsed-main` or `is-collapsed-second` while that pane is folded away (US-01M7DVB1).
 */
export function documentSplitHostClass(orientation: DocumentSplitOrientation, collapsed: DocumentSplitPane | null = null): string {
  if (orientation === 'single') return 'mbc-split-host';
  const folded = collapsed ? ` is-collapsed-${collapsed}` : '';
  return `mbc-split-host is-split is-${orientation}${folded}`;
}

// ─── US-01M7DVB1: the divider ───

/** The two panes of a split: the main view, and the second document's pane. */
export type DocumentSplitPane = 'main' | 'second';
/** A split that shows a second pane. */
export type DocumentSplitAxisOrientation = Exclude<DocumentSplitOrientation, 'single'>;

/**
 * The divider's state: the main pane's share of the room along the active axis the user chose, 0..1,
 * and the pane folded away. The ratio is kept while a pane is folded (restore returns it) and is never
 * rewritten by a narrower window: only the drawn ratio is clamped (`renderedDocumentSplitRatio`).
 */
export interface DocumentSplitSize {
  ratio: number;
  collapsed: DocumentSplitPane | null;
}

export const DEFAULT_DOCUMENT_SPLIT_RATIO = 0.5;
export const DEFAULT_DOCUMENT_SPLIT_SIZE: DocumentSplitSize = { ratio: DEFAULT_DOCUMENT_SPLIT_RATIO, collapsed: null };
/** The narrowest each expanded pane may be along the active axis: 320 px wide side by side, 200 px tall top and bottom. */
export const DOCUMENT_SPLIT_MIN_PX: Readonly<Record<DocumentSplitAxisOrientation, number>> = { 'side-by-side': 320, 'top-bottom': 200 };
/** The divider's thickness along the active axis, as App.css gives `.mbc-split-divider`. */
export const DOCUMENT_SPLIT_DIVIDER_PX = 6;

/** The host's extent along the active axis: its width side by side, its height top and bottom. */
export function documentSplitExtent(orientation: DocumentSplitAxisOrientation, box: { width: number; height: number }): number {
  return orientation === 'side-by-side' ? box.width : box.height;
}

/**
 * `ratio` clamped so each pane keeps its minimum along the axis in a host `sizePx` long. A host too
 * short for both minimums gives each half.
 */
export function clampDocumentSplitRatio(ratio: number, sizePx: number, orientation: DocumentSplitAxisOrientation): number {
  const room = sizePx - DOCUMENT_SPLIT_DIVIDER_PX;
  const min = DOCUMENT_SPLIT_MIN_PX[orientation];
  if (room < 2 * min) return DEFAULT_DOCUMENT_SPLIT_RATIO;
  const r = Number.isFinite(ratio) ? ratio : DEFAULT_DOCUMENT_SPLIT_RATIO;
  return Math.min(1 - min / room, Math.max(min / room, r));
}

/**
 * The ratio drawn for the chosen `ratio` in a host `sizePx` long: clamped to both minimums. With no
 * size measured (null, or a host with no layout) the chosen ratio is drawn as it is.
 */
export function renderedDocumentSplitRatio(ratio: number, sizePx: number | null, orientation: DocumentSplitAxisOrientation): number {
  if (sizePx === null || !(sizePx > 0)) return ratio;
  return clampDocumentSplitRatio(ratio, sizePx, orientation);
}

/**
 * The state a drag that began at `start` gives with the pointer at `point` over a host laid out at
 * `box`: the pointer's x against the width side by side, its y against the height top and bottom.
 * A pane left under PANE_COLLAPSE_FRACTION of its minimum folds away, and the ratio stays the one the
 * drag began with, so restoring brings back the size the pane had.
 */
export function dragDocumentSplit(
  start: DocumentSplitSize,
  point: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  orientation: DocumentSplitAxisOrientation
): DocumentSplitSize {
  const side = orientation === 'side-by-side';
  const size = side ? box.width : box.height;
  const at = side ? point.x - box.left : point.y - box.top;
  const room = size - DOCUMENT_SPLIT_DIVIDER_PX;
  if (!(room > 0)) return start;
  const fold = DOCUMENT_SPLIT_MIN_PX[orientation] * PANE_COLLAPSE_FRACTION;
  const main = at - DOCUMENT_SPLIT_DIVIDER_PX / 2;
  if (main < fold) return { ratio: start.ratio, collapsed: 'main' };
  if (room - main < fold) return { ratio: start.ratio, collapsed: 'second' };
  return { ratio: clampDocumentSplitRatio(main / room, size, orientation), collapsed: null };
}

/**
 * The state a key on the divider gives, or null for a key it does not take. Side by side the Left and
 * Right arrows move it, top and bottom the Up and Down arrows, by PANE_SPLIT_KEY_STEP_PX (with Shift,
 * PANE_SPLIT_KEY_STEP_LARGE_PX) from where it is drawn, clamped. Home folds the main view away, End the
 * second pane, and Enter restores both at the last expanded ratio. An arrow leaves a folded pane folded.
 */
export function documentSplitKey(
  state: DocumentSplitSize,
  key: string,
  shift: boolean,
  sizePx: number,
  orientation: DocumentSplitAxisOrientation
): DocumentSplitSize | null {
  if (key === 'Home') return { ratio: state.ratio, collapsed: 'main' };
  if (key === 'End') return { ratio: state.ratio, collapsed: 'second' };
  if (key === 'Enter') return { ratio: state.ratio, collapsed: null };
  const [back, forward] = orientation === 'side-by-side' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (key !== back && key !== forward) return null;
  const room = sizePx - DOCUMENT_SPLIT_DIVIDER_PX;
  if (state.collapsed || !(room > 0)) return state;
  const step = (shift ? PANE_SPLIT_KEY_STEP_LARGE_PX : PANE_SPLIT_KEY_STEP_PX) * (key === back ? -1 : 1);
  const from = clampDocumentSplitRatio(state.ratio, sizePx, orientation);
  return { ratio: clampDocumentSplitRatio(from + step / room, sizePx, orientation), collapsed: null };
}

/** The main pane's share as the separator announces it, in whole percent: 0 with the main view folded, 100 with the second pane folded. */
export function documentSplitValueNow(drawn: DocumentSplitSize): number {
  if (drawn.collapsed === 'main') return 0;
  if (drawn.collapsed === 'second') return 100;
  return Math.round(drawn.ratio * 100);
}

/** The custom properties the split host carries: each pane's flex share. */
export function documentSplitStyle(ratio: number): Record<string, string> {
  const r = Math.round(ratio * 1e4) / 1e4;
  return { '--mbc-doc-split-main': String(r), '--mbc-doc-split-second': String(Math.round((1 - r) * 1e4) / 1e4) };
}

// ─── US-01M7DVQG: the second pane's view and rotation ───

/** The views the second pane shows a document with bases in. */
export type SplitPaneView = 'circular' | 'linear' | 'info';

/** The views in the order the pane's "View in split pane" selector lists them, with their labels. */
export const SPLIT_PANE_VIEW_CHOICES: readonly { view: SplitPaneView; label: string }[] = [
  { view: 'circular', label: 'Circular Map' },
  { view: 'linear', label: 'Linear Map' },
  { view: 'info', label: 'Info' },
];

/** The view the pane opens in, and the one a session does not save. */
export const DEFAULT_SPLIT_PANE_VIEW: SplitPaneView = 'linear';

const isSplitPaneView = (v: unknown): v is SplitPaneView => SPLIT_PANE_VIEW_CHOICES.some((c) => c.view === v);

/** The second pane's view and the rotation of its circular map, in degrees clockwise in [0, 360). */
export interface SplitPaneViewState {
  view: SplitPaneView;
  rotation: number;
}

export const DEFAULT_SPLIT_PANE_VIEW_STATE: SplitPaneViewState = { view: DEFAULT_SPLIT_PANE_VIEW, rotation: 0 };

/**
 * What a session saves: the orientation, and the second pane's document by id and by name (to name it
 * if it is gone); the divider's chosen ratio and folded pane only while they are not the default
 * (US-01M7DVB1), so a split never resized saves what it saved before; and, with the pane's document,
 * its view while it is not Linear Map and its rotation while it is not 0 degrees (US-01M7DVQG).
 */
export interface SavedDocumentSplit {
  orientation: DocumentSplitOrientation;
  docId: string | null;
  docName: string | null;
  ratio?: number;
  collapsed?: DocumentSplitPane;
  view?: SplitPaneView;
  rotation?: number;
}

/**
 * The value a session saves, or undefined while the split was never opened in it (Single Pane with
 * no document chosen), so a session that never used the split saves what it saved before.
 * `docId` is the App's pane document: null before one is chosen, '' while the pane asks for one.
 */
export function documentSplitForSession(
  orientation: DocumentSplitOrientation,
  docId: string | null,
  docs: readonly { id: string; name: string }[],
  size: DocumentSplitSize = DEFAULT_DOCUMENT_SPLIT_SIZE,
  paneView: SplitPaneViewState = DEFAULT_SPLIT_PANE_VIEW_STATE
): SavedDocumentSplit | undefined {
  if (orientation === 'single' && docId === null) return undefined;
  const id = docId ? docId : null;
  const saved: SavedDocumentSplit = { orientation, docId: id, docName: id === null ? null : docs.find((d) => d.id === id)?.name ?? null };
  if (size.ratio !== DEFAULT_DOCUMENT_SPLIT_RATIO) saved.ratio = size.ratio;
  if (size.collapsed) saved.collapsed = size.collapsed;
  // The view and the rotation belong to the pane's document, so they are saved only with one.
  if (id !== null) {
    if (paneView.view !== DEFAULT_SPLIT_PANE_VIEW) saved.view = paneView.view;
    const rotation = normalize(paneView.rotation);
    if (rotation !== 0) saved.rotation = rotation;
  }
  return saved;
}

export const UNREADABLE_DOCUMENT_SPLIT_NOTICE =
  'The saved document split could not be read; the viewer opens in Single Pane.';

export const UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE =
  'The saved split size could not be read; the panes open at half each.';

/**
 * The divider a readable saved split holds: an absent ratio is half each and an absent (or null)
 * collapse is none, with no notice; a ratio that is not a finite number in [0, 1], or a collapse that
 * is not 'main' or 'second', is half each and not collapsed, with UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE.
 */
function parseDocumentSplitSize(v: Record<string, unknown>): { size: DocumentSplitSize; sizeNotice: string | null } {
  const ratioOk = v.ratio === undefined || (typeof v.ratio === 'number' && Number.isFinite(v.ratio) && v.ratio >= 0 && v.ratio <= 1);
  const collapsedOk = v.collapsed === undefined || v.collapsed === null || v.collapsed === 'main' || v.collapsed === 'second';
  if (!ratioOk || !collapsedOk) return { size: { ...DEFAULT_DOCUMENT_SPLIT_SIZE }, sizeNotice: UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE };
  return {
    size: {
      ratio: v.ratio === undefined ? DEFAULT_DOCUMENT_SPLIT_RATIO : (v.ratio as number),
      collapsed: v.collapsed === 'main' || v.collapsed === 'second' ? v.collapsed : null,
    },
    sizeNotice: null,
  };
}

export const UNREADABLE_SPLIT_PANE_VIEW_NOTICE = "The split pane's saved view could not be read; it opens in Linear Map.";

export function unreadableSplitPaneRotationNotice(docName: string): string {
  return `The saved rotation for ${docName} in the split pane could not be read; it opens at 0 degrees.`;
}

/** A document the restored session can show, as `parseDocumentSplit` reads it. */
export interface DocumentSplitCandidate {
  id: string;
  name?: string;
  topology?: Topology;
  moleculeType?: MoleculeType;
}

/**
 * The pane's view and rotation a readable saved split holds for `doc`, read only when the split saves
 * one of them: an absent view is Linear Map and an absent rotation 0 degrees, with no notice; a view
 * that is not one of the three (null included), or Circular Map for a document that cannot draw a
 * circle (circularMapUnavailableReason, read when the candidate carries its molecule type and
 * topology, as the App's documents do), is Linear Map with UNREADABLE_SPLIT_PANE_VIEW_NOTICE; a
 * rotation that is not a finite number (null included) is 0 with the notice naming the document. A
 * readable angle is normalised as `workspace.mapRotation`'s are.
 */
function parseSplitPaneView(
  v: Record<string, unknown>,
  doc: DocumentSplitCandidate,
  savedName: string
): (SplitPaneViewState & { viewNotice: string | null; rotationNotice: string | null }) | null {
  if (!('view' in v) && !('rotation' in v)) return null;
  let view: SplitPaneView = DEFAULT_SPLIT_PANE_VIEW;
  let viewNotice: string | null = null;
  if (v.view !== undefined) {
    const circleRefused =
      v.view === 'circular' &&
      doc.moleculeType !== undefined &&
      doc.topology !== undefined &&
      circularMapUnavailableReason({ moleculeType: doc.moleculeType, topology: doc.topology }) !== null;
    if (isSplitPaneView(v.view) && !circleRefused) view = v.view;
    else viewNotice = UNREADABLE_SPLIT_PANE_VIEW_NOTICE;
  }
  let rotation = 0;
  let rotationNotice: string | null = null;
  if (v.rotation !== undefined) {
    if (typeof v.rotation === 'number' && Number.isFinite(v.rotation)) rotation = normalize(v.rotation);
    else rotationNotice = unreadableSplitPaneRotationNotice(doc.name?.trim() ? doc.name : savedName);
  }
  return { view, rotation, viewNotice, rotationNotice };
}

export function missingSplitDocumentNotice(docName: string): string {
  return `The split pane's document "${docName}" is no longer in this session; the viewer opens in Single Pane.`;
}

/**
 * The split a restored session opens with, from the parser's `workspace.documentSplit` (`raw`) and the
 * documents the restored session can show (`available`), told apart by case:
 * - absent (a session saved before the field): Single Pane, no document, no notice;
 * - not an object, an orientation that is not one of the three, or a docId that is neither a string
 *   nor null: Single Pane, no document, and UNREADABLE_DOCUMENT_SPLIT_NOTICE;
 * - a docId no available document has: Single Pane, no document, and the notice naming it (by its
 *   saved name, or its id when the name was not saved);
 * - otherwise the saved orientation and document; a docId of null (or '') with a split orientation
 *   reopens the pane asking for a document ('').
 * `docId` is in the App's terms: null for no document, '' for the pane's "Choose a document…".
 *
 * The divider (US-01M7DVB1) is read apart, once the orientation and docId are readable, into `size`
 * and `sizeNotice` (see parseDocumentSplitSize); a split that is absent or cannot be read at all opens
 * at half each, its one notice (if any) being `notice`.
 *
 * The pane's view and rotation (US-01M7DVQG) are read only when the saved docId names an available
 * document, and only when the split saves one of them: the result then carries `view`, `rotation`,
 * `viewNotice` and `rotationNotice` (see parseSplitPaneView), and otherwise none of the four, so the
 * pane opens in Linear Map at 0 degrees with no message.
 */
export function parseDocumentSplit(
  raw: unknown,
  available: readonly DocumentSplitCandidate[]
): {
  orientation: DocumentSplitOrientation;
  docId: string | null;
  notice: string | null;
  size: DocumentSplitSize;
  sizeNotice: string | null;
  view?: SplitPaneView;
  rotation?: number;
  viewNotice?: string | null;
  rotationNotice?: string | null;
} {
  const half = { size: { ...DEFAULT_DOCUMENT_SPLIT_SIZE }, sizeNotice: null };
  const single = (notice: string | null, sized: { size: DocumentSplitSize; sizeNotice: string | null } = half) =>
    ({ orientation: 'single' as const, docId: null, notice, ...sized });
  if (raw === undefined) return single(null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  const v = raw as Record<string, unknown>;
  if (!isOrientation(v.orientation)) return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  if (v.docId !== null && typeof v.docId !== 'string') return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  const orientation = v.orientation;
  const sized = parseDocumentSplitSize(v);
  if (!v.docId) return { orientation, docId: orientation === 'single' ? null : '', notice: null, ...sized };
  const docId = v.docId;
  const savedName = typeof v.docName === 'string' && v.docName.trim() ? v.docName : docId;
  const doc = available.find((d) => d.id === docId);
  if (!doc) return single(missingSplitDocumentNotice(savedName), sized);
  const paneView = parseSplitPaneView(v, doc, savedName);
  return { orientation, docId, notice: null, ...sized, ...(paneView ?? {}) };
}
