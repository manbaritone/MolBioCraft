// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Genome-scale map for contig-summary records (annotations without downloaded bases).
 * Everything is drawn at true genomic coordinates on the declared length; no bases, GC,
 * restriction sites or translations are shown because none exist in the record.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { subsetNote } from './CircularPlasmidMap';
import type { SequenceDocument, SequenceFeature } from '../types/bio';
import {
  declaredLengthOf,
  downloadSummarySequence,
  MAX_SUMMARY_DOWNLOAD_BP,
} from '../core/contigSummary';

interface Props {
  doc: SequenceDocument;
  onUpdateDocument?: (doc: SequenceDocument) => void;
  onStatusNotice?: (message: string) => void;
}

const W = 1000;
const MARGIN = 24;
const LANE_H = 16;
const MAX_LANES = 10;
/**
 * The most annotations the circular overview draws arcs for, the first in record order. An
 * annotation that spans the whole record is never an arc (the first such one that is not `source`
 * is drawn as a ring) and is not counted here.
 */
const SUMMARY_CIRCLE_ARCS = 400;

function niceStep(span: number, targetTicks = 8): number {
  const raw = span / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

function fmtBp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)} Mb`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)} kb`;
  return n.toLocaleString();
}

function intervalsOf(f: SequenceFeature): { start: number; end: number }[] {
  return f.segments?.length ? f.segments.map((s) => ({ start: s.start, end: s.end })) : [{ start: f.start, end: f.end }];
}

function isWholeRecord(f: SequenceFeature, len: number): boolean {
  return f.start <= 1 && f.end >= len && !f.segments?.length;
}

export const ContigSummaryView: React.FC<Props> = ({ doc, onUpdateDocument, onStatusNotice }) => {
  const total = declaredLengthOf(doc);
  const unit = doc.moleculeType === 'RNA' ? 'nt' : 'bp';
  const [view, setView] = useState<[number, number]>([1, total]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<{ busy: boolean; message: string }>({ busy: false, message: '' });

  useEffect(() => {
    setView([1, total]);
    setSelectedId(null);
    setDownloadState({ busy: false, message: '' });
  }, [doc.id, total]);

  const [vStart, vEnd] = view;
  const span = Math.max(1, vEnd - vStart + 1);
  const x = (pos: number) => MARGIN + ((pos - vStart) / span) * (W - 2 * MARGIN);

  const wholeRecord = useMemo(() => doc.features.filter((f) => isWholeRecord(f, total)), [doc.features, total]);
  const localized = useMemo(() => doc.features.filter((f) => !isWholeRecord(f, total)), [doc.features, total]);

  /** Pixel-space lane packing of features overlapping the current window. */
  const laid = useMemo(() => {
    const visible = localized
      .filter((f) => f.end >= vStart && f.start <= vEnd)
      .map((f) => {
        const x0 = x(Math.max(f.start, vStart));
        const x1 = Math.max(x0 + 3, x(Math.min(f.end, vEnd) + 1));
        return { f, x0, x1 };
      })
      .sort((a, b) => a.x0 - b.x0 || b.x1 - a.x1);
    const laneEnds: number[] = [];
    let hidden = 0;
    const out: { f: SequenceFeature; x0: number; x1: number; lane: number }[] = [];
    for (const it of visible) {
      let lane = laneEnds.findIndex((end) => end + 2 < it.x0);
      if (lane < 0) {
        if (laneEnds.length >= MAX_LANES) { hidden++; continue; }
        lane = laneEnds.length;
        laneEnds.push(it.x1);
      } else laneEnds[lane] = it.x1;
      out.push({ ...it, lane });
    }
    return { items: out, lanes: Math.max(1, laneEnds.length), hidden };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localized, vStart, vEnd]);

  const step = niceStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(vStart / step) * step; t <= vEnd; t += step) if (t > 0) ticks.push(t);

  const rulerY = 22;
  const wholeY = rulerY + 18;
  const lanesY = wholeY + wholeRecord.length * (LANE_H + 4) + 8;
  const height = lanesY + laid.lanes * (LANE_H + 4) + 14;

  const selected = doc.features.find((f) => f.id === selectedId) ?? null;

  const zoomTo = (start: number, end: number) => {
    const s = Math.max(1, Math.floor(start));
    const e = Math.min(total, Math.ceil(end));
    if (e - s < 50) {
      const mid = (s + e) / 2;
      setView([Math.max(1, Math.floor(mid - 25)), Math.min(total, Math.ceil(mid + 25))]);
    } else setView([s, e]);
  };
  const zoomBy = (factor: number) => {
    const mid = (vStart + vEnd) / 2;
    const half = Math.min(total, span * factor) / 2;
    const s = Math.max(1, mid - half);
    zoomTo(s, Math.min(total, s + half * 2));
  };
  const pan = (dir: 1 | -1) => {
    const shift = Math.round(span * 0.5) * dir;
    const s = Math.min(Math.max(1, vStart + shift), Math.max(1, total - span + 1));
    setView([s, s + span - 1]);
  };

  const canDownload = Boolean(onUpdateDocument) && total <= MAX_SUMMARY_DOWNLOAD_BP && Boolean(doc.accession);
  const handleDownload = async () => {
    if (!onUpdateDocument) return;
    setDownloadState({ busy: true, message: `Downloading ${doc.accession} (${total.toLocaleString()} ${unit}) from NCBI…` });
    try {
      const full = await downloadSummarySequence(doc);
      onUpdateDocument(full);
      onStatusNotice?.(`Downloaded ${doc.accession}: ${full.sequence.length.toLocaleString()} ${unit} from NCBI.`);
      setDownloadState({ busy: false, message: '' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadState({ busy: false, message: `Download failed: ${msg} The record is unchanged.` });
    }
  };

  // Circular overview for circular records.
  const circular = doc.topology === 'circular';
  const R = 120;
  const C = 150;
  const arcPath = (start: number, end: number, r: number) => {
    const a0 = ((start - 1) / total) * 2 * Math.PI - Math.PI / 2;
    const a1 = (end / total) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)}`;
  };
  const circStep = niceStep(total, 8);

  return (
    <div className="mbc-summary-view">
      <div className="mbc-summary-banner" role="region" aria-label="Contig Summary Notice">
        <div>
          <strong>Selected sequences are only summaries</strong>
          <span>
            {doc.name} · {total.toLocaleString()} {unit} declared · {doc.features.length} annotations · no bases downloaded
          </span>
        </div>
        <button
          type="button"
          className="btn-primary-sm"
          disabled={!canDownload || downloadState.busy}
          title={
            total > MAX_SUMMARY_DOWNLOAD_BP
              ? `Too large to hold in the interactive viewer (limit ${MAX_SUMMARY_DOWNLOAD_BP.toLocaleString()} bp)`
              : `Fetch ${doc.accession} from NCBI nuccore`
          }
          onClick={handleDownload}
        >
          {downloadState.busy ? 'Downloading…' : 'Download Full Sequence'}
        </button>
      </div>
      {downloadState.message && (
        <div className="mbc-summary-status" role="status">{downloadState.message}</div>
      )}
      {total > MAX_SUMMARY_DOWNLOAD_BP && (
        <p className="mbc-summary-note">
          This chromosome is too large to load as bases here; use the annotation map below, or import a region of
          {` ${doc.accession}`} via the NCBI database browser.
        </p>
      )}

      <div className={`mbc-summary-maps ${circular ? 'has-circle' : ''}`}>
        {circular && (
          <div data-mbc-figure>
          <div className="studio-card-header" style={{ paddingTop: 0 }}>
            <h4>Circular Map</h4>
            <FigureExportButton compact baseName={`${doc.name} — Circular Map`} title={`${doc.name} — circular map`} table={{ headers: ['Name', 'Type', 'Start', 'End', 'Length', 'Strand'], rows: doc.features.map((f) => [f.name, String(f.type), String(f.start), String(f.end), String(f.end - f.start + 1), f.strand === -1 ? '-' : '+']), caption: `${doc.name} — ${doc.features.length} annotations over ${total.toLocaleString()} ${unit}` }} />
          </div>
          <svg className="mbc-summary-circle" viewBox="0 0 300 300" role="img" aria-label={`${doc.name} circular map, ${total.toLocaleString()} ${unit}`}>
            <circle cx={C} cy={C} r={R} className="mbc-summary-backbone" />
            {wholeRecord.filter((f) => String(f.type) !== 'source').slice(0, 1).map((f) => (
              <circle key={f.id} cx={C} cy={C} r={R} className="mbc-summary-whole-ring" style={{ stroke: f.color || '#16a34a' }}>
                <title>{`${f.name} (${f.type}) 1–${total.toLocaleString()}`}</title>
              </circle>
            ))}
            {Array.from({ length: Math.floor(total / circStep) }, (_, i) => (i + 1) * circStep).map((t) => {
              const a = ((t - 1) / total) * 2 * Math.PI - Math.PI / 2;
              return (
                <g key={t}>
                  <line x1={C + (R - 4) * Math.cos(a)} y1={C + (R - 4) * Math.sin(a)} x2={C + (R + 4) * Math.cos(a)} y2={C + (R + 4) * Math.sin(a)} className="mbc-summary-tick" />
                  <text x={C + (R + 16) * Math.cos(a)} y={C + (R + 16) * Math.sin(a)} className="mbc-summary-tick-label" textAnchor="middle" dominantBaseline="middle">
                    {fmtBp(t)}
                  </text>
                </g>
              );
            })}
            {localized.slice(0, SUMMARY_CIRCLE_ARCS).map((f) =>
              intervalsOf(f).map((iv, k) => (
                <path key={`${f.id}-${k}`} d={arcPath(iv.start, iv.end, R - 12)} className="mbc-summary-arc"
                  style={{ stroke: f.color || '#64748b' }}>
                  <title>{`${f.name} (${f.type}) ${iv.start.toLocaleString()}–${iv.end.toLocaleString()}`}</title>
                </path>
              ))
            )}
            {vStart > 1 || vEnd < total ? (
              <path d={arcPath(vStart, vEnd, R + 7)} className="mbc-summary-window" />
            ) : null}
            <text x={C} y={C - 6} textAnchor="middle" className="mbc-summary-center-name">{doc.name}</text>
            <text x={C} y={C + 12} textAnchor="middle" className="mbc-summary-center-len">{total.toLocaleString()} {unit}</text>
          </svg>
          <ResultWarnings
            warnings={subsetNote('The circle draws', Math.min(localized.length, SUMMARY_CIRCLE_ARCS), localized.length, 'annotations along the record', 'first')}
            label="Circular map coverage"
          />
          </div>
        )}

        <div className="mbc-summary-linear" data-mbc-figure>
          <div className="mbc-summary-toolbar">
            <span className="mbc-summary-range">
              {vStart.toLocaleString()}–{vEnd.toLocaleString()} {unit} ({fmtBp(span)} shown)
            </span>
            <div className="mbc-summary-buttons">
              <button type="button" className="btn-secondary-sm" onClick={() => pan(-1)} disabled={vStart <= 1} aria-label="Pan left">◀</button>
              <button type="button" className="btn-secondary-sm" onClick={() => zoomBy(0.25)} disabled={span <= 50}>Zoom in</button>
              <button type="button" className="btn-secondary-sm" onClick={() => zoomBy(4)} disabled={span >= total}>Zoom out</button>
              <button type="button" className="btn-secondary-sm" onClick={() => setView([1, total])} disabled={span >= total}>Whole record</button>
              <button type="button" className="btn-secondary-sm" onClick={() => pan(1)} disabled={vEnd >= total} aria-label="Pan right">▶</button>
              <FigureExportButton compact baseName={`${doc.name} — Annotation Map`} title={`${doc.name} — annotation map ${vStart}-${vEnd}`} table={{ headers: ['Name', 'Type', 'Start', 'End', 'Length', 'Strand'], rows: doc.features.map((f) => [f.name, String(f.type), String(f.start), String(f.end), String(f.end - f.start + 1), f.strand === -1 ? '-' : '+']), caption: `${doc.name} — ${doc.features.length} annotations over ${total.toLocaleString()} ${unit}` }} />
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${height}`} className="mbc-summary-svg" role="img"
            aria-label={`${doc.name} annotation map ${vStart}–${vEnd}`}>
            <line x1={MARGIN} x2={W - MARGIN} y1={rulerY} y2={rulerY} className="mbc-summary-ruler" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={rulerY - 4} y2={rulerY + 4} className="mbc-summary-tick" />
                <text x={x(t)} y={rulerY - 8} textAnchor="middle" className="mbc-summary-tick-label">{fmtBp(t)}</text>
              </g>
            ))}
            {wholeRecord.map((f, i) => (
              <g key={f.id} className="mbc-summary-feature" onClick={() => setSelectedId(f.id)}>
                <rect x={MARGIN} width={W - 2 * MARGIN} y={wholeY + i * (LANE_H + 4)} height={LANE_H} rx={3}
                  className="mbc-summary-whole" style={{ fill: f.color || '#94a3b8' }} />
                <text x={W / 2} y={wholeY + i * (LANE_H + 4) + LANE_H / 2 + 4} textAnchor="middle" className="mbc-summary-whole-label">
                  {f.name}
                </text>
                <title>{`${f.name} (${f.type}) 1–${total.toLocaleString()}`}</title>
              </g>
            ))}
            {laid.items.map(({ f, x0, x1, lane }) => {
              const y = lanesY + lane * (LANE_H + 4);
              const parts = intervalsOf(f).filter((iv) => iv.end >= vStart && iv.start <= vEnd);
              const label = x1 - x0 > f.name.length * 6 + 8 ? f.name : '';
              return (
                <g key={f.id} className={`mbc-summary-feature ${selectedId === f.id ? 'is-selected' : ''}`}
                  onClick={() => { setSelectedId(f.id); }}
                  onDoubleClick={() => zoomTo(f.start - (f.end - f.start) * 0.1, f.end + (f.end - f.start) * 0.1)}>
                  {parts.length > 1 && (
                    <line x1={x0} x2={x1} y1={y + LANE_H / 2} y2={y + LANE_H / 2} className="mbc-summary-intron" />
                  )}
                  {parts.map((iv, k) => {
                    const a = x(Math.max(iv.start, vStart));
                    const b = Math.max(a + 3, x(Math.min(iv.end, vEnd) + 1));
                    return <rect key={k} x={a} width={b - a} y={y} height={LANE_H} rx={2} style={{ fill: f.color || '#64748b' }} />;
                  })}
                  {label && <text x={(x0 + x1) / 2} y={y + LANE_H / 2 + 4} textAnchor="middle" className="mbc-summary-feat-label">{label}</text>}
                  <title>{`${f.name} (${f.type}) ${f.strand === -1 ? 'reverse' : 'forward'} ${f.start.toLocaleString()}–${f.end.toLocaleString()}${parts.length > 1 ? `, ${intervalsOf(f).length} parts` : ''}`}</title>
                </g>
              );
            })}
          </svg>
          {laid.hidden > 0 && (
            <p className="mbc-summary-note">{laid.hidden} more annotations overlap in this window — zoom in to see them.</p>
          )}
          {selected && (
            <div className="mbc-summary-detail">
              <strong>{selected.name}</strong>
              <span>{selected.type}</span>
              <span>{selected.strand === -1 ? 'Reverse' : 'Forward'} strand</span>
              <span>
                {intervalsOf(selected).map((iv) => `${iv.start.toLocaleString()}–${iv.end.toLocaleString()}`).join(', ')}
                {' '}({intervalsOf(selected).reduce((n, iv) => n + iv.end - iv.start + 1, 0).toLocaleString()} {unit})
              </span>
              <button type="button" className="mbc-aln-link-btn"
                onClick={() => zoomTo(selected.start - (selected.end - selected.start) * 0.1, selected.end + (selected.end - selected.start) * 0.1)}>
                Zoom to annotation
              </button>
              {selected.notes && <p>{selected.notes}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
