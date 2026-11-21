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
const LABEL_MAX_SHIFTS = 10;
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
  // Liang-Barsky clipping against the open box.
  let t0 = 0;
  let t1 = 1;
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  for (const [p, q] of [[-dx, s.x1 - b.x], [dx, b.x + b.width - s.x1], [-dy, s.y1 - b.y], [dy, b.y + b.height - s.y1]]) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return true;
};

/**
 * Place a label beside each outlier point, inside `area`, so no two labels overlap, no label covers
 * another plotted point (every outlier, and each of `others`, the points that are not outliers),
 * and no leader line crosses another leader line or label. Each label goes to the first free spot
 * in order of how far it moves: right of its point, left of it, then a row higher or lower or a
 * step further along its row at a time, with a leader line once it leaves its point's side. When no
 * spot is free (a crowd larger than the plot can label), the label takes the spot that collides
 * least, an overlapping label weighing more than a crossing leader line and that more than a
 * covered point, so every outlier is still named.
 */
export function placeOutlierLabels(
  points: readonly { text: string; x: number; y: number }[],
  area: LabelBox,
  others: readonly { x: number; y: number }[] = [],
): OutlierLabelPlacement[] {
  const markOf = (x: number, y: number, r: number): LabelBox => ({ x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  const marks: LabelBox[] = [
    ...points.map((p) => markOf(p.x, p.y, OUTLIER_RADIUS)),
    ...others.map((p) => markOf(p.x, p.y, POINT_RADIUS)),
  ];
  // Candidate moves, nearest first: (row, shift) by the distance the label travels.
  const moves: { row: number; shift: number }[] = [];
  for (let row = -LABEL_MAX_ROWS; row <= LABEL_MAX_ROWS; row += 1) {
    for (let shift = 0; shift <= LABEL_MAX_SHIFTS; shift += 1) moves.push({ row, shift });
  }
  const travel = (m: { row: number; shift: number }) => Math.hypot(m.row * (LABEL_HEIGHT + 1), m.shift * LABEL_SHIFT);
  moves.sort((a, b) => travel(a) - travel(b) || Math.abs(a.row) - Math.abs(b.row) || a.row - b.row);
  type Spot = { box: LabelBox; anchor: 'start' | 'end'; leader: Segment | null; cost: number };
  // Greedy placement of the labels in one order: each takes the cheapest spot left by those before.
  const layout = (order: readonly number[]): { spots: Spot[]; cost: number } => {
    const placed: LabelBox[] = [];
    const leaders: Segment[] = [];
    const spots: Spot[] = new Array(points.length);
    let total = 0;
    for (const i of order) {
      const p = points[i];
      const width = p.text.length * LABEL_CHAR_WIDTH;
      let best: Spot | null = null;
      search: for (const { row, shift } of moves) {
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
          const leader = row === 0 && shift === 0 ? null : { x1: p.x, y1: p.y, x2: edge, y2: box.y + LABEL_HEIGHT / 2 };
          // Overlapping labels cost most, then a leader line through a label or across another
          // leader, then each point the label covers.
          const cost = 1e6 * placed.filter((b) => overlaps(b, box)).length
            + 1e3 * leaders.filter((l) => segmentEntersBox(l, box)).length
            + (leader ? 1e3 * (leaders.filter((l) => segmentsCross(l, leader)).length + placed.filter((b) => segmentEntersBox(leader, b)).length) : 0)
            + marks.filter((m, j) => j !== i && overlaps(m, box)).length;
          if (!best || cost < best.cost) best = { box, anchor, leader, cost };
          if (cost === 0) break search;
        }
      }
      // A label too wide to fit beside its point on either side finds no spot inside: pin it to the area's corner.
      const chosen: Spot = best ?? {
        box: { x: area.x, y: area.y, width, height: LABEL_HEIGHT },
        anchor: 'start',
        leader: { x1: p.x, y1: p.y, x2: area.x, y2: area.y + LABEL_HEIGHT / 2 },
        cost: 1e6,
      };
      placed.push(chosen.box);
      if (chosen.leader) leaders.push(chosen.leader);
      spots[i] = chosen;
      total += chosen.cost;
    }
    return { spots, cost: total };
  };
  // The order the labels are placed in decides what each later one can still reach, so try a few
  // (as given, by height either way, left to right and right to left) and keep the one that
  // collides least.
  const index = points.map((_, i) => i);
  const orders = [
    index,
    [...index].sort((a, b) => points[a].y - points[b].y || a - b),
    [...index].sort((a, b) => points[b].y - points[a].y || a - b),
    [...index].sort((a, b) => points[a].x - points[b].x || a - b),
    [...index].sort((a, b) => points[b].x - points[a].x || a - b),
  ];
  let best = layout(orders[0]);
  for (const order of orders.slice(1)) {
    if (best.cost === 0) break;
    const next = layout(order);
    if (next.cost < best.cost) best = next;
  }
  return points.map((p, i) => {
    const { box, anchor, leader } = best.spots[i];
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
