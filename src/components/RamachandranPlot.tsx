// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * A Ramachandran plot of one protein chain, with its outliers listed beneath it (US-01M6PBP8).
 *
 * Every residue with both phi and psi is a point on axes of -180..180 degrees, coloured by the
 * region the engine gave it. The engine does not hand back its region grids, so no region
 * boundary is drawn: in the drawing the regions show only as point colours, and the legend says so.
 * The plot, its legend and the plotted values leave through the shared Export control, so the
 * drawing itself carries what a file pasted into a report needs: the chain plotted (and the model,
 * for an entry of several), a label on every outlier, and the caveat on the regions with the
 * advice to check each outlier.
 */

import React, { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { FigureExportButton } from './FigureExportButton';
import { chartMaxWidth, plotFrame, ticks } from '../core/chartLayout';
import {
  OUTLIER_ADVICE,
  REGION_CAVEAT,
  modelPhrase,
  ramachandranOutliers,
  ramachandranPoints,
  ramachandranTable,
  residueLabel,
  type BackboneTorsionReport,
  type PlottedModel,
  type RamachandranPoint,
  type RamachandranRegion,
} from '../core/ramachandran';

const MIN = -180;
const MAX = 180;
const TICKS = ticks(MIN, MAX, 7);

const REGION_STYLE: Record<RamachandranRegion, { label: string; color: string }> = {
  favoured: { label: 'Favoured', color: 'var(--mbc-blue)' },
  allowed: { label: 'Allowed', color: 'var(--mbc-amber)' },
  outlier: { label: 'Outlier', color: 'var(--mbc-red)' },
};
const NO_REGION_COLOR = 'var(--mbc-text-muted)';
const BOUNDARIES_NOTE = "Region boundaries are not drawn; each point's colour is its region.";
const OUTLIER_RADIUS = 3.4;

/** Break prose into lines of at most `width` characters, at spaces; a longer word gets a line of its own. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 78 characters of 9.5-unit text is about 350 units, inside the 420-unit drawing.
const LEGEND_LINES = [...wrapWords(`${REGION_CAVEAT} ${OUTLIER_ADVICE}`, 78), BOUNDARIES_NOTE];
const LEGEND_TOP = 72;
const LEGEND_LINE = 12;
const PAD_T = 32;
const PAD_B = LEGEND_TOP + LEGEND_LINE * LEGEND_LINES.length;

/**
 * The plot area is square, 352 units a side; the room above it holds the figure's title (structure,
 * chain and model), the room below it the axis title, the legend and its notes.
 */
export const RAMACHANDRAN_FRAME = plotFrame({ w: 420, h: PAD_T + 352 + PAD_B, padL: 52, padR: 16, padT: PAD_T, padB: PAD_B });
const xOf = (phi: number) => RAMACHANDRAN_FRAME.xOf(phi, MIN, MAX);
const yOf = (psi: number) => RAMACHANDRAN_FRAME.yOf(psi, MIN, MAX);

// ─── Outlier labels ───

/** A rectangle in the drawing's units. */
export interface LabelBox { x: number; y: number; width: number; height: number }

export interface OutlierLabelPlacement {
  /** The label, as the outlier list names the residue ("A 102A ASN"). */
  text: string;
  /** Where the text is drawn: its anchor point on the baseline. */
  x: number;
  y: number;
  anchor: 'start' | 'end';
  /** The room the text takes, estimated from its length. */
  box: LabelBox;
  /** A line from the point to its label, when the label had to move away from its point's side. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

const LABEL_FONT = 9;
/**
 * Room per character for a label of capitals, digits and spaces at 9 units: Helvetica sets
 * "A 102A ASN" in about 51 units, estimated here as 56, so the estimate errs towards more room.
 */
const LABEL_CHAR_WIDTH = 5.6;
const LABEL_HEIGHT = 11;
const LABEL_GAP = 5;
/** How many rows above and below its point a label may move to find room. */
const LABEL_MAX_ROWS = 12;
/** How far, in steps of LABEL_SHIFT units, a label may move away from its point along its row. */
const LABEL_MAX_SHIFTS = 20;
const LABEL_SHIFT = 6;
/** The radius of a point that is not an outlier. */
const POINT_RADIUS = 2.4;

/** A line segment in the drawing's units. */
interface Segment { x1: number; y1: number; x2: number; y2: number }

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: LabelBox, area: LabelBox): boolean =>
  a.x >= area.x && a.y >= area.y && a.x + a.width <= area.x + area.width && a.y + a.height <= area.y + area.height;
const turn = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
/** Whether two segments cross at a point inside both (touching or sharing an end does not count). */
export const segmentsCross = (s: Segment, t: Segment): boolean =>
  turn(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1) * turn(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2) < 0
  && turn(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1) * turn(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2) < 0;
/** Whether a segment passes through the inside of a box (running along its edge does not count). */
export const segmentEntersBox = (s: Segment, b: LabelBox): boolean => {
  // Liang-Barsky clipping against the open box: the part of the segment, t in [t0, t1], left
  // inside each of the box's four edges in turn.
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  for (let edge = 0; edge < 4; edge += 1) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q = edge === 0 ? s.x1 - b.x : edge === 1 ? b.x + b.width - s.x1 : edge === 2 ? s.y1 - b.y : b.y + b.height - s.y1;
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) { if (r > t0) t0 = r; } else if (r < t1) t1 = r;
      if (t0 >= t1) return false;
    }
  }
  return true;
};

/** How many moves the repair search may make after the greedy layouts. */
const LABEL_REPAIR_MOVES = 3000;
/** How often (one move in twenty) the repair puts a colliding label at a random spot that covers no point. */
const LABEL_REPAIR_WALK = 0.05;
/** Cell size of the grid the plotted points are bucketed in, so a label checks only the points near it. */
const MARK_CELL = 16;

/**
 * Place a label beside each outlier point, inside `area`, so no two labels overlap, no label covers
 * another plotted point (every outlier, and each of `others`, the points that are not outliers),
 * and no leader line crosses another leader line or runs through another label. A label's spots run
 * in order of how far it moves: right of its point, left of it, then a row higher or lower or a step
 * further along its row at a time, with a leader line once it leaves its point's side.
 *
 * Where each label can go depends on where the others went, so the search is bounded and
 * deterministic. The labels are first placed greedily, each at its nearest spot that collides least
 * with those placed before it, in five orders (as given, by height either way, left to right and
 * right to left). If the best of those still collides, a repair search of at most
 * LABEL_REPAIR_MOVES moves follows, its choices drawn from a fixed seed: each move takes a colliding
 * label and puts it at a spot where it collides least with all the others, or, one move in twenty,
 * at any spot of it that covers no point, so a crowd no single move can clear is shuffled until it
 * clears. The search ends at the first layout with no collision, else keeps the one with the fewest
 * it saw. A collision counts one for each covered point, each pair of crossing leader lines and each
 * leader line through a label, and far more for two labels that overlap. Last, each label moves back
 * to the nearest spot where it collides no more, so labels stay as close to their points as the
 * layout allows. When the plot has no room for a clean layout (a crowd larger than it can label),
 * every outlier is still named and the layout with the fewest collisions found is drawn.
 */
export function placeOutlierLabels(
  points: readonly { text: string; x: number; y: number }[],
  area: LabelBox,
  others: readonly { x: number; y: number }[] = [],
): OutlierLabelPlacement[] {
  const markOf = (x: number, y: number, r: number): LabelBox => ({ x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  const marks: { box: LabelBox; owner: number }[] = [
    ...points.map((p, i) => ({ box: markOf(p.x, p.y, OUTLIER_RADIUS), owner: i })),
    ...others.map((p) => ({ box: markOf(p.x, p.y, POINT_RADIUS), owner: -1 })),
  ];
  // The marks bucketed by grid cell over the area: a label's box looks only in the cells it touches.
  const cellOf = (v: number, from: number) => Math.floor((v - from) / MARK_CELL);
  const columns = cellOf(area.x + area.width, area.x) + 1;
  const rows = cellOf(area.y + area.height, area.y) + 1;
  const cells: number[][] = Array.from({ length: columns * rows }, () => []);
  const span = (b: LabelBox) => [
    Math.max(0, cellOf(b.x, area.x)), Math.min(columns - 1, cellOf(b.x + b.width, area.x)),
    Math.max(0, cellOf(b.y, area.y)), Math.min(rows - 1, cellOf(b.y + b.height, area.y)),
  ];
  marks.forEach((m, k) => {
    const [cx0, cx1, cy0, cy1] = span(m.box);
    for (let cx = cx0; cx <= cx1; cx += 1) for (let cy = cy0; cy <= cy1; cy += 1) cells[cx * rows + cy].push(k);
  });
  const seen = new Int32Array(marks.length).fill(-1);
  let stamp = 0;
  // How many marks other than the owner's a box (inside the area) covers.
  const coveredBy = (box: LabelBox, owner: number): number => {
    stamp += 1;
    let n = 0;
    const [cx0, cx1, cy0, cy1] = span(box);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (const k of cells[cx * rows + cy]) {
          if (seen[k] === stamp) continue;
          seen[k] = stamp;
          if (marks[k].owner !== owner && overlaps(marks[k].box, box)) n += 1;
        }
      }
    }
    return n;
  };
  // Candidate moves, nearest first: (row, shift) by the distance the label travels.
  const moves: { row: number; shift: number }[] = [];
  for (let row = -LABEL_MAX_ROWS; row <= LABEL_MAX_ROWS; row += 1) {
    for (let shift = 0; shift <= LABEL_MAX_SHIFTS; shift += 1) moves.push({ row, shift });
  }
  const travel = (m: { row: number; shift: number }) => Math.hypot(m.row * (LABEL_HEIGHT + 1), m.shift * LABEL_SHIFT);
  moves.sort((a, b) => travel(a) - travel(b) || Math.abs(a.row) - Math.abs(b.row) || a.row - b.row);
  // A spot: the label's box, its leader line, the points it covers (which no other label changes)
  // and the bounds of box and leader together, for a quick test of whether two spots can meet.
  type Spot = { box: LabelBox; anchor: 'start' | 'end'; leader: Segment | null; covered: number; x0: number; y0: number; x1: number; y1: number };
  const spotOf = (i: number, box: LabelBox, anchor: 'start' | 'end', leader: Segment | null): Spot => ({
    box, anchor, leader, covered: coveredBy(box, i),
    x0: leader ? Math.min(box.x, leader.x1) : box.x,
    y0: leader ? Math.min(box.y, leader.y1) : box.y,
    x1: leader ? Math.max(box.x + box.width, leader.x1) : box.x + box.width,
    y1: leader ? Math.max(box.y + box.height, leader.y1) : box.y + box.height,
  });
  const meets = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  // Each label's spots inside the area, nearest first. A label too wide to fit beside its point on
  // either side gets one spot, pinned to the area's corner.
  const spotsOf: Spot[][] = points.map((p, i) => {
    const width = p.text.length * LABEL_CHAR_WIDTH;
    const list: Spot[] = [];
    for (const { row, shift } of moves) {
      for (const anchor of ['start', 'end'] as const) {
        const offset = LABEL_GAP + shift * LABEL_SHIFT;
        const box = {
          x: anchor === 'start' ? p.x + offset : p.x - offset - width,
          y: p.y - LABEL_HEIGHT / 2 + row * (LABEL_HEIGHT + 1),
          width,
          height: LABEL_HEIGHT,
        };
        if (!inside(box, area)) continue;
        const edge = anchor === 'start' ? box.x : box.x + box.width;
        list.push(spotOf(i, box, anchor, row === 0 && shift === 0 ? null : { x1: p.x, y1: p.y, x2: edge, y2: box.y + LABEL_HEIGHT / 2 }));
      }
    }
    if (list.length === 0) {
      list.push(spotOf(i, { x: area.x, y: area.y, width, height: LABEL_HEIGHT }, 'start', { x1: p.x, y1: p.y, x2: area.x, y2: area.y + LABEL_HEIGHT / 2 }));
    }
    return list;
  });
  // The spots of each label that cover no point; the same spots in bands of one row each (all the
  // spots of a row reach the same height), so a scan skips a band no other label comes near; and
  // the labels whose spots can meet its own.
  const clearOf = spotsOf.map((list) => list.filter((s) => s.covered === 0));
  const bandsOf = spotsOf.map((list) => {
    const byRow = new Map<number, Spot[]>();
    for (const s of list) {
      const k = Math.round(s.box.y);
      const band = byRow.get(k);
      if (band) band.push(s); else byRow.set(k, [s]);
    }
    return Array.from(byRow.values()).map((spots) => spots.reduce((b, s) => ({
      x0: Math.min(b.x0, s.x0), y0: Math.min(b.y0, s.y0), x1: Math.max(b.x1, s.x1), y1: Math.max(b.y1, s.y1), spots,
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, spots }));
  });
  const reach = bandsOf.map((bands) => bands.reduce((r, b) => ({
    x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  const near = reach.map((a, i) => reach.flatMap((b, j) => (j !== i && meets(a, b) ? [j] : [])));
  const OVERLAP = 1e6;
  // What two labels' spots collide in, counted the same from either side: overlapping labels, and
  // each leader line that crosses the other's or runs through the other label.
  const pair = (s: Spot, o: Spot): number => {
    if (!meets(s, o)) return 0;
    let cost = overlaps(o.box, s.box) ? OVERLAP : 0;
    if (o.leader && segmentEntersBox(o.leader, s.box)) cost += 1;
    if (s.leader) {
      if (o.leader && segmentsCross(o.leader, s.leader)) cost += 1;
      if (segmentEntersBox(s.leader, o.box)) cost += 1;
    }
    return cost;
  };
  // How much spot s of label i collides with the labels placed in `at` (null: not placed yet).
  const pairsOf = (i: number, s: Spot, at: readonly (Spot | null)[]): number => {
    let cost = 0;
    for (const j of near[i]) if (at[j]) cost += pair(s, at[j]!);
    return cost;
  };
  // Label i's spots that collide least with the labels placed in `at`, nearest first. `stopAtClear`
  // ends the scan at the first spot with no collision.
  const cheapest = (i: number, at: readonly (Spot | null)[], stopAtClear: boolean): { spots: Spot[]; cost: number } => {
    const placed = near[i].flatMap((j) => (at[j] && meets(at[j]!, reach[i]) ? [at[j]!] : []));
    let spots: Spot[] = [];
    let least = Infinity;
    // Whether the scan can stop: s is the first clear spot and only the nearest one is wanted.
    const scan = (s: Spot, against: readonly Spot[]): boolean => {
      if (s.covered > least) return false;
      let cost = s.covered;
      for (const o of against) { cost += pair(s, o); if (cost > least) return false; }
      if (cost < least) { spots = [s]; least = cost; } else spots.push(s);
      return stopAtClear && least === 0;
    };
    if (stopAtClear) {
      for (const s of spotsOf[i]) if (scan(s, placed)) break;
    } else {
      // Every spot is wanted, so a band checks only the placed labels that come near its row.
      for (const band of bandsOf[i]) {
        const against = placed.filter((o) => meets(o, band));
        for (const s of band.spots) scan(s, against);
      }
    }
    return { spots, cost: least };
  };
  const totalOf = (at: readonly Spot[]): number => at.reduce((t, s, i) => t + s.covered + pairsOf(i, s, at) / 2, 0);
  // Greedy placement in one order: each label at its nearest spot that collides least with those before it.
  const greedy = (order: readonly number[]): Spot[] => {
    const at: (Spot | null)[] = new Array(points.length).fill(null);
    for (const i of order) at[i] = cheapest(i, at, true).spots[0];
    return at as Spot[];
  };
  const index = points.map((_, i) => i);
  const orders = [
    index,
    [...index].sort((a, b) => points[a].y - points[b].y || a - b),
    [...index].sort((a, b) => points[b].y - points[a].y || a - b),
    [...index].sort((a, b) => points[a].x - points[b].x || a - b),
    [...index].sort((a, b) => points[b].x - points[a].x || a - b),
  ];
  let best = greedy(orders[0]);
  let bestCost = totalOf(best);
  for (const order of orders.slice(1)) {
    if (bestCost === 0) break;
    const next = greedy(order);
    const cost = totalOf(next);
    if (cost < bestCost) { best = next; bestCost = cost; }
  }
  if (bestCost > 0) {
    // The repair, from a fixed seed (mulberry32) so the same input always gets the same layout. A
    // move may leave the layout worse, so the search can leave a layout every single move worsens.
    let seed = 0x9e3779b9;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const at = [...best];
    const cost = index.map((i) => at[i].covered + pairsOf(i, at[i], at));
    let total = bestCost;
    let last = -1;
    for (let move = 0; move < LABEL_REPAIR_MOVES && total > 0; move += 1) {
      const colliding = index.filter((i) => cost[i] > 0 && i !== last);
      const i = colliding.length > 0 ? colliding[Math.floor(random() * colliding.length)] : last;
      let next: Spot;
      if (random() < LABEL_REPAIR_WALK && clearOf[i].length > 0) {
        next = clearOf[i][Math.floor(random() * clearOf[i].length)];
      } else {
        const { spots } = cheapest(i, at, false);
        next = spots[Math.floor(random() * spots.length)];
      }
      const old = at[i];
      for (const j of near[i]) cost[j] += pair(at[j], next) - pair(at[j], old);
      at[i] = next;
      const now = next.covered + pairsOf(i, next, at);
      total += now - cost[i];
      cost[i] = now;
      last = i;
      if (total < bestCost) { best = [...at]; bestCost = total; }
    }
  }
  // Pull each label back to its nearest spot where it collides no more than where it is.
  for (const i of index) {
    const now = best[i].covered + pairsOf(i, best[i], best);
    for (const s of spotsOf[i]) {
      if (s === best[i]) break;
      if (s.covered <= now && s.covered + pairsOf(i, s, best) <= now) { best[i] = s; break; }
    }
  }
  return points.map((p, i) => {
    const { box, anchor, leader } = best[i];
    return {
      text: p.text,
      x: anchor === 'start' ? box.x : box.x + box.width,
      y: box.y + LABEL_HEIGHT - 2.5,
      anchor,
      box,
      leader,
    };
  });
}

export interface RamachandranPlotProps {
  /** The chain's torsions, as `backboneTorsions` returns them. */
  report: BackboneTorsionReport;
  /** The model those torsions come from and how many the entry holds, as `plottedModelOf` reads them. */
  model: PlottedModel;
  /** The structure's name: the exported file's name and title start with it. */
  name: string;
  /** Called with the export outcome, for a host that shows it in its own status bar. */
  onStatus?: (message: string) => void;
}

export function RamachandranPlot({ report, model, name, onStatus }: RamachandranPlotProps): React.ReactElement {
  const points = useMemo(() => ramachandranPoints(report), [report]);
  const outliers = useMemo(() => ramachandranOutliers(report), [report]);
  const table = useMemo(() => ramachandranTable(report, name, model), [report, name, model]);
  // Outliers are drawn last, so no favoured point hides one.
  const drawOrder = useMemo(
    () => [...points.filter((p) => p.region !== 'outlier'), ...points.filter((p) => p.region === 'outlier')],
    [points]
  );
  const F = RAMACHANDRAN_FRAME;
  const labels = useMemo(
    () => placeOutlierLabels(
      points.filter((p) => p.region === 'outlier').map((p) => ({ text: residueLabel(p.residue), x: xOf(p.phi), y: yOf(p.psi) })),
      { x: F.x, y: F.y, width: F.width, height: F.height },
      points.filter((p) => p.region !== 'outlier').map((p) => ({ x: xOf(p.phi), y: yOf(p.psi) }))
    ),
    [points, F]
  );
  const phrase = modelPhrase(model);
  const chainAndModel = `chain ${report.chain}${phrase ? `, ${phrase}` : ''}`;
  const baseName = `${name} — Ramachandran plot, ${chainAndModel}`;
  const unplotted = report.residues.length - points.length;
  const noRegion = points.filter((p) => p.region === null).length;
  const keys: { label: string; color: string; count: number }[] = [
    ...(['favoured', 'allowed', 'outlier'] as const).map((r) => ({
      ...REGION_STYLE[r],
      count: points.filter((p) => p.region === r).length,
    })),
    ...(noRegion > 0 ? [{ label: 'No region', color: NO_REGION_COLOR, count: noRegion }] : []),
  ];
  const below = F.y + F.height;

  const point = (p: RamachandranPoint) => {
    const label = residueLabel(p.residue);
    const outlier = p.region === 'outlier';
    return (
      <circle
        key={`${label}-${p.residue.labelSeqId}`}
        data-residue={label}
        data-region={p.region ?? 'none'}
        cx={xOf(p.phi)}
        cy={yOf(p.psi)}
        r={outlier ? OUTLIER_RADIUS : 2.4}
        fill={p.region ? REGION_STYLE[p.region].color : NO_REGION_COLOR}
        fillOpacity={outlier ? 0.95 : 0.75}
        stroke={outlier ? 'var(--mbc-text-main)' : 'none'}
        strokeWidth={outlier ? 0.6 : 0}
      >
        <title>{`${label}: φ ${p.phi.toFixed(1)}°, ψ ${p.psi.toFixed(1)}° (${p.residue.ramachandranClass}, ${p.region ?? 'no region'})`}</title>
      </circle>
    );
  };

  return (
    <figure data-mbc-figure style={{ margin: 0 }} aria-label={`Ramachandran plot of ${name}, ${chainAndModel}`}>
      <figcaption style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Ramachandran plot — {chainAndModel}</strong>
        <span style={{ color: 'var(--mbc-text-secondary)' }}>
          {points.length} of {report.residues.length} residues plotted
          {unplotted > 0 ? ` (${unplotted} without both φ and ψ)` : ''}
          {report.chainBreaks > 0 ? ` · ${report.chainBreaks} chain break${report.chainBreaks === 1 ? '' : 's'}` : ''}
        </span>
        <FigureExportButton compact baseName={baseName} table={table} onStatus={onStatus} />
      </figcaption>

      <svg
        viewBox={`0 0 ${F.w} ${F.h}`}
        style={chartMaxWidth(F.w)}
        role="img"
        aria-label={`Ramachandran plot of ${name}, ${chainAndModel}: ${points.length} residues, ${outliers.length} outlier${outliers.length === 1 ? '' : 's'}`}
      >
        <text data-mbc-plot-title x={F.x} y={F.y - 12} fill="var(--mbc-text-main)" fontSize="11.5" fontWeight="600">
          {`${name} — ${chainAndModel}`}
        </text>
        <rect x={F.x} y={F.y} width={F.width} height={F.height} fill="var(--mbc-bg-panel)" stroke="var(--mbc-border)" />
        {TICKS.map((v) => (
          <g key={v}>
            <line
              x1={xOf(v)} y1={F.y} x2={xOf(v)} y2={below}
              stroke={v === 0 ? 'var(--mbc-text-muted)' : 'var(--mbc-border-light)'}
              strokeDasharray={v === 0 ? '3 3' : undefined}
            />
            <line
              x1={F.x} y1={yOf(v)} x2={F.x + F.width} y2={yOf(v)}
              stroke={v === 0 ? 'var(--mbc-text-muted)' : 'var(--mbc-border-light)'}
              strokeDasharray={v === 0 ? '3 3' : undefined}
            />
            <text x={xOf(v)} y={below + 16} textAnchor="middle" fill="var(--mbc-text-secondary)" fontSize="10.5">{v}</text>
            <text x={F.x - 6} y={yOf(v) + 3.5} textAnchor="end" fill="var(--mbc-text-secondary)" fontSize="10.5">{v}</text>
          </g>
        ))}
        <text x={F.x + F.width / 2} y={below + 32} textAnchor="middle" fill="var(--mbc-text-secondary)" fontSize="11">φ (degrees)</text>
        <text
          x={14} y={F.y + F.height / 2} textAnchor="middle" fill="var(--mbc-text-secondary)" fontSize="11"
          transform={`rotate(-90 14 ${F.y + F.height / 2})`}
        >
          ψ (degrees)
        </text>
        {drawOrder.map(point)}

        <g aria-label="Outlier labels">
          {labels.map((l, i) => (
            <g key={`${l.text}-${i}`}>
              {l.leader && (
                <line
                  x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2}
                  stroke="var(--mbc-text-secondary)" strokeWidth={0.6}
                />
              )}
              <text
                data-mbc-outlier-label={l.text}
                x={l.x} y={l.y} textAnchor={l.anchor}
                fill="var(--mbc-text-main)" fontSize={LABEL_FONT}
                stroke="var(--mbc-bg-panel)" strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke"
              >
                {l.text}
              </text>
            </g>
          ))}
        </g>

        <g aria-label="Legend">
          {keys.map((k, i) => (
            <g key={k.label}>
              <circle cx={F.x + 6 + i * 96} cy={below + 50} r={4} fill={k.color} />
              <text x={F.x + 14 + i * 96} y={below + 54} fill="var(--mbc-text-main)" fontSize="10.5">{`${k.label} ${k.count}`}</text>
            </g>
          ))}
          <text x={12} y={below + LEGEND_TOP} fill="var(--mbc-text-secondary)" fontSize="9.5">
            {LEGEND_LINES.map((line, i) => (
              <tspan key={i} x={12} dy={i === 0 ? 0 : LEGEND_LINE}>{line}</tspan>
            ))}
          </text>
        </g>
      </svg>

      <div className="info-callout" data-mbc-outlier-note style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <TriangleAlert size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
        <span>
          Outliers by these approximate regions: {REGION_CAVEAT} {OUTLIER_ADVICE}
        </span>
      </div>
      {outliers.length === 0 ? (
        <p style={{ color: 'var(--mbc-text-secondary)' }}>No residue falls in an outlier region of these approximate maps.</p>
      ) : (
        <ol data-mbc-outliers aria-label={`${outliers.length} Ramachandran outlier${outliers.length === 1 ? '' : 's'}`}>
          {outliers.map((o) => (
            <li key={`${residueLabel(o)}-${o.labelSeqId}`}>
              <strong>{residueLabel(o)}</strong> (φ {o.phi.toFixed(1)}°, ψ {o.psi.toFixed(1)}°, {o.ramachandranClass})
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
