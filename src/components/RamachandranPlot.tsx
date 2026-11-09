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
  /** A line from the point to its label, when the label had to move off the point's own row. */
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

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: LabelBox, area: LabelBox): boolean =>
  a.x >= area.x && a.y >= area.y && a.x + a.width <= area.x + area.width && a.y + a.height <= area.y + area.height;

/**
 * Place a label beside each outlier point, inside `area`, so no two labels overlap and no label
 * covers another outlier. Each label goes to the first free spot in order: right of its point,
 * left of it, then a row higher or lower at a time, with a leader line once it leaves its point's
 * row. When no spot is free (a crowd larger than the plot can label), the label takes the spot
 * that overlaps least, so every outlier is still named.
 */
export function placeOutlierLabels(points: readonly { text: string; x: number; y: number }[], area: LabelBox): OutlierLabelPlacement[] {
  const marks: LabelBox[] = points.map((p) => ({
    x: p.x - OUTLIER_RADIUS, y: p.y - OUTLIER_RADIUS, width: 2 * OUTLIER_RADIUS, height: 2 * OUTLIER_RADIUS,
  }));
  const placed: LabelBox[] = [];
  return points.map((p, i) => {
    const width = p.text.length * LABEL_CHAR_WIDTH;
    let best: { box: LabelBox; anchor: 'start' | 'end'; row: number; cost: number } | null = null;
    search: for (let step = 0; step <= LABEL_MAX_ROWS; step += 1) {
      for (const row of step === 0 ? [0] : [-step, step]) {
        for (const anchor of ['start', 'end'] as const) {
          const box = {
            x: anchor === 'start' ? p.x + LABEL_GAP : p.x - LABEL_GAP - width,
            y: p.y - LABEL_HEIGHT / 2 + row * (LABEL_HEIGHT + 1),
            width,
            height: LABEL_HEIGHT,
          };
          if (!inside(box, area)) continue;
          const cost = 100 * placed.filter((b) => overlaps(b, box)).length
            + marks.filter((m, j) => j !== i && overlaps(m, box)).length;
          if (!best || cost < best.cost) best = { box, anchor, row, cost };
          if (cost === 0) break search;
        }
      }
    }
    // A label too wide to fit beside its point on either side finds no spot inside: pin it to the area's corner.
    const chosen = best ?? { box: { x: area.x, y: area.y, width, height: LABEL_HEIGHT }, anchor: 'start' as const, row: 1 };
    placed.push(chosen.box);
    const { box, anchor } = chosen;
    const edge = anchor === 'start' ? box.x : box.x + box.width;
    return {
      text: p.text,
      x: edge,
      y: box.y + LABEL_HEIGHT - 2.5,
      anchor,
      box,
      leader: chosen.row === 0 ? null : { x1: p.x, y1: p.y, x2: edge, y2: box.y + LABEL_HEIGHT / 2 },
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
      { x: F.x, y: F.y, width: F.width, height: F.height }
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
