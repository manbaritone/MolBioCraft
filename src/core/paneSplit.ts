// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCT5: the divider between the circular map and the linear map in the Sequence view's
 * Split layout. Pure layout arithmetic, no science: where the divider sits, how far each pane may
 * shrink, and when a drag folds a pane away.
 *
 * The ratio is the circle's share of the two columns' width (the grid's width less its gap). A
 * pointer x is measured from the grid's left edge; the divider's centre is the middle of the gap.
 */

export type SplitPane = 'circular' | 'linear';

/** The Split grid's state: the circle's share while both panes show, and which pane is folded away. */
export interface PaneSplitState {
  /** The circle's share of the columns, 0..1. Kept unchanged while a pane is collapsed. */
  ratio: number;
  collapsed: SplitPane | null;
}

/** The gap between the two cards, as App.css gives `.map-seq-grid`. */
export const PANE_SPLIT_GAP_PX = 10;
/** The narrowest each expanded pane may be dragged: the circle's 320px track minimum in App.css, and
 * room for rows of bases beside it. */
export const PANE_MIN_PX: Readonly<Record<SplitPane, number>> = { circular: 320, linear: 300 };
/** A pane dragged below this share of its minimum width collapses. */
export const PANE_COLLAPSE_FRACTION = 0.5;
/** The circle's share App.css gives the Split grid (4fr : 5fr). */
export const DEFAULT_PANE_SPLIT_RATIO = 4 / 9;
export const DEFAULT_PANE_SPLIT: PaneSplitState = { ratio: DEFAULT_PANE_SPLIT_RATIO, collapsed: null };

/** The width the two columns share in a grid `widthPx` wide. */
const columnsOf = (widthPx: number) => Math.max(0, widthPx - PANE_SPLIT_GAP_PX);

/**
 * `ratio` clamped so both panes keep their minimum widths in a grid `widthPx` wide. A grid too narrow
 * to hold both minimums shares its width in proportion to them.
 */
export function clampPaneSplitRatio(ratio: number, widthPx: number): number {
  const cols = columnsOf(widthPx);
  const both = PANE_MIN_PX.circular + PANE_MIN_PX.linear;
  if (cols < both) return PANE_MIN_PX.circular / both;
  const lo = PANE_MIN_PX.circular / cols;
  const hi = 1 - PANE_MIN_PX.linear / cols;
  const r = Number.isFinite(ratio) ? ratio : DEFAULT_PANE_SPLIT_RATIO;
  return Math.min(hi, Math.max(lo, r));
}

/** The ratio that puts the divider's centre at `xPx` from the grid's left edge, clamped. */
export function paneSplitRatioAt(xPx: number, widthPx: number): number {
  const cols = columnsOf(widthPx);
  if (cols <= 0) return clampPaneSplitRatio(DEFAULT_PANE_SPLIT_RATIO, widthPx);
  return clampPaneSplitRatio((xPx - PANE_SPLIT_GAP_PX / 2) / cols, widthPx);
}

/** The pane a divider at `xPx` folds away: one left narrower than half its minimum width. */
export function paneCollapsedAt(xPx: number, widthPx: number): SplitPane | null {
  const circle = xPx - PANE_SPLIT_GAP_PX / 2;
  const linear = widthPx - xPx - PANE_SPLIT_GAP_PX / 2;
  if (circle < PANE_MIN_PX.circular * PANE_COLLAPSE_FRACTION) return 'circular';
  if (linear < PANE_MIN_PX.linear * PANE_COLLAPSE_FRACTION) return 'linear';
  return null;
}

/**
 * The state a drag that began at `start` gives with the pointer at `xPx`. Past a collapse threshold
 * the pane folds away and the ratio stays the one the drag began with, so restoring brings back the
 * width the pane had before it was dragged shut.
 */
export function dragPaneSplit(start: PaneSplitState, xPx: number, widthPx: number): PaneSplitState {
  const collapsed = paneCollapsedAt(xPx, widthPx);
  if (collapsed) return { ratio: start.ratio, collapsed };
  return { ratio: paneSplitRatioAt(xPx, widthPx), collapsed: null };
}

/** Folds `pane` away, keeping the ratio to restore to. */
export function collapsePane(state: PaneSplitState, pane: SplitPane): PaneSplitState {
  return { ratio: state.ratio, collapsed: pane };
}

/** Shows both panes again at the last expanded ratio. */
export function restorePanes(state: PaneSplitState): PaneSplitState {
  return { ratio: state.ratio, collapsed: null };
}

/** Both panes at the default ratio. */
export function resetPaneSplit(): PaneSplitState {
  return { ...DEFAULT_PANE_SPLIT };
}

/** Whether the panes show at the default ratio, so App.css's own 4fr : 5fr tracks apply. */
export function paneSplitIsDefault(state: PaneSplitState): boolean {
  return Math.abs(state.ratio - DEFAULT_PANE_SPLIT_RATIO) < 1e-9;
}

/** The custom properties the Split frame carries: each pane's flex share, and the ratio the divider is placed by. */
export function paneSplitStyle(ratio: number): Record<string, string> {
  const r = Math.round(ratio * 1e4) / 1e4;
  return {
    '--mbc-split-circle': `${Math.round(r * 1e4) / 100}fr`,
    '--mbc-split-linear': `${Math.round((1 - r) * 1e4) / 100}fr`,
    '--mbc-split-ratio': String(r),
  };
}
