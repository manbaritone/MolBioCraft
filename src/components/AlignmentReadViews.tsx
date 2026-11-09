// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Real Sanger trace viewer (A/C/G/T channels, base calls, Phred bars) and a
 * FastQC-style read QC report computed from the actual sequences.
 */

import React, { useMemo, useState } from 'react';
import { FigureExportButton } from './FigureExportButton';
import type { ChromatogramData } from '../types/bio';
import { BASE_COLOR, qualityColor } from '../core/basePalette';

// ---------------------------------------------------------------------------
// Trace viewer
// ---------------------------------------------------------------------------

export interface TraceEntry {
  id: string;
  name: string;
  chromatogram: ChromatogramData;
  reversed?: boolean;
}

const CHANNEL_COLORS: Record<'A' | 'C' | 'G' | 'T', string> = BASE_COLOR;

export const AlignmentTraceViewer: React.FC<{ traces: TraceEntry[] }> = ({ traces }) => {
  const [idx, setIdx] = useState(0);
  const [xScale, setXScale] = useState(2);
  const [yScale, setYScale] = useState(100);
  const [showQuality, setShowQuality] = useState(true);
  const [showCalls, setShowCalls] = useState(true);
  const [channels, setChannels] = useState({ A: true, C: true, G: true, T: true });

  const entry = traces[Math.min(idx, traces.length - 1)];
  const chrom = entry?.chromatogram;

  const geometry = useMemo(() => {
    if (!chrom) return null;
    const n = Math.max(chrom.traceA.length, chrom.traceC.length, chrom.traceG.length, chrom.traceT.length);
    let max = 1;
    for (const tr of [chrom.traceA, chrom.traceC, chrom.traceG, chrom.traceT]) for (const v of tr) if (v > max) max = v;
    return { n, max };
  }, [chrom]);

  if (!traces.length || !chrom || !geometry) {
    return (
      <div className="mbc-aln-empty">
        No chromatogram (trace) data is attached to the sequences in this document. Import the
        original <code>.ab1</code> / <code>.scf</code> files to view base-call traces and Phred quality.
      </div>
    );
  }

  const H = 180;
  const traceH = 120;
  const width = Math.max(200, geometry.n * xScale);
  const yOf = (v: number) => traceH - Math.min(traceH, (v / geometry.max) * traceH * (yScale / 100));
  const pathFor = (tr: number[]) => {
    const step = Math.max(1, Math.floor(1 / xScale));
    let d = '';
    for (let i = 0; i < tr.length; i += step) d += `${i ? 'L' : 'M'}${(i * xScale).toFixed(1)} ${yOf(tr[i]).toFixed(1)}`;
    return d;
  };
  const meanQ =
    chrom.phredScores.length > 0
      ? chrom.phredScores.reduce((s, q) => s + q, 0) / chrom.phredScores.length
      : 0;
  const q20 = chrom.phredScores.filter((q) => q >= 20).length;

  return (
    <div className="mbc-trace">
      <div className="mbc-aln-action-toolbar">
        <div className="mbc-aln-toolbar-left">
          <label className="mbc-aln-inline-select">
            <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
              {traces.map((t, i) => (
                <option key={t.id} value={i}>
                  {t.name}
                  {t.reversed ? ' (reverse read)' : ''}
                </option>
              ))}
            </select>
          </label>
          {(['A', 'C', 'G', 'T'] as const).map((b) => (
            <label key={b} className="mbc-aln-check-inline" style={{ color: CHANNEL_COLORS[b] }}>
              <input
                type="checkbox"
                checked={channels[b]}
                onChange={(e) => setChannels((c) => ({ ...c, [b]: e.target.checked }))}
              />
              <strong>{b}</strong>
            </label>
          ))}
          <label className="mbc-aln-check-inline">
            <input type="checkbox" checked={showCalls} onChange={(e) => setShowCalls(e.target.checked)} />
            <span>Base calls</span>
          </label>
          <label className="mbc-aln-check-inline">
            <input type="checkbox" checked={showQuality} onChange={(e) => setShowQuality(e.target.checked)} />
            <span>Quality</span>
          </label>
        </div>
        <div className="mbc-aln-toolbar-right">
          <label className="mbc-aln-field-row">
            <span>X</span>
            <input type="range" min={0.5} max={6} step={0.5} value={xScale} onChange={(e) => setXScale(Number(e.target.value))} />
          </label>
          <label className="mbc-aln-field-row">
            <span>Y</span>
            <input type="range" min={25} max={400} step={25} value={yScale} onChange={(e) => setYScale(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <div className="mbc-aln-hint" style={{ padding: '0 8px' }}>
        {chrom.baseCalls.length.toLocaleString()} bases · mean Phred {meanQ.toFixed(1)} ·{' '}
        {chrom.phredScores.length ? ((q20 / chrom.phredScores.length) * 100).toFixed(1) : '0'}% ≥ Q20
      </div>
      <div className="mbc-trace-scroll" data-mbc-figure>
        <FigureExportButton
          compact
          baseName={`${entry.name} — Trace`}
          title={`${entry.name} — chromatogram`}
          table={{
            headers: ['Base position', 'Call', 'Phred quality'],
            rows: Array.from(chrom.baseCalls, (call, i) => [String(i + 1), call, String(chrom.phredScores[i] ?? '')]),
            caption: `${entry.name} — ${chrom.baseCalls.length.toLocaleString()} bases, mean Phred ${meanQ.toFixed(1)}`,
          }}
        />
        <svg width={width} height={H} role="img" aria-label={`Chromatogram of ${entry.name}`}>
          {showQuality &&
            chrom.peakLocations.map((p, i) => {
              const q = chrom.phredScores[i] ?? 0;
              const h = Math.min(traceH, (q / 60) * traceH);
              return (
                <rect
                  key={`q${i}`}
                  x={p * xScale - 3 * Math.min(1, xScale)}
                  y={traceH - h}
                  width={Math.max(1, 6 * Math.min(1, xScale))}
                  height={h}
                  fill={qualityColor(q)}
                  opacity={0.55}
                />
              );
            })}
          {(['A', 'C', 'G', 'T'] as const).map((b) =>
            channels[b] ? (
              <path
                key={b}
                d={pathFor(chrom[`trace${b}` as 'traceA'])}
                fill="none"
                stroke={CHANNEL_COLORS[b]}
                strokeWidth={1.1}
              />
            ) : null
          )}
          {showCalls &&
            chrom.peakLocations.map((p, i) => {
              const ch = chrom.baseCalls[i] ?? 'N';
              const color = CHANNEL_COLORS[ch as 'A'] ?? BASE_COLOR.N;
              return (
                <React.Fragment key={`b${i}`}>
                  {xScale >= 1 && (
                    <text x={p * xScale} y={traceH + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill={color} fontFamily="var(--font-mono)">
                      {ch}
                    </text>
                  )}
                  {(i + 1) % 10 === 0 && (
                    <text x={p * xScale} y={traceH + 32} textAnchor="middle" fontSize={9} fill="var(--mbc-text-muted)">
                      {i + 1}
                    </text>
                  )}
                </React.Fragment>
              );
            })}
        </svg>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// QC report
// ---------------------------------------------------------------------------

export interface QcRead {
  name: string;
  sequence: string; // ungapped
  quality?: number[];
}

type QcStatus = 'pass' | 'warn' | 'fail' | 'info';

const STATUS_ICON: Record<QcStatus, string> = { pass: '✓', warn: '!', fail: '✗', info: 'i' };

export const ReadQcReport: React.FC<{ reads: QcRead[]; isProtein: boolean }> = ({ reads, isProtein }) => {
  const [module, setModule] = useState('Basic Statistics');

  const qc = useMemo(() => {
    const seqs = reads.map((r) => r.sequence.toUpperCase());
    const lengths = seqs.map((s) => s.length);
    const n = seqs.length;
    const maxLen = lengths.length ? Math.max(...lengths) : 0;
    const minLen = lengths.length ? Math.min(...lengths) : 0;
    let gc = 0;
    let total = 0;
    let nCount = 0;
    const perSeqGc: number[] = [];
    for (const s of seqs) {
      let g = 0;
      for (const ch of s) {
        if (ch === 'G' || ch === 'C') g++;
        if (ch === 'N') nCount++;
      }
      gc += g;
      total += s.length;
      perSeqGc.push(s.length ? (g / s.length) * 100 : 0);
    }
    // per-position composition, binned to <= 100 bins
    const bins = Math.min(100, Math.max(1, maxLen));
    const binSize = Math.max(1, Math.ceil(maxLen / bins));
    const comp: { A: number; C: number; G: number; T: number; N: number; total: number }[] = Array.from(
      { length: Math.ceil(maxLen / binSize) },
      () => ({ A: 0, C: 0, G: 0, T: 0, N: 0, total: 0 })
    );
    for (const s of seqs) {
      for (let i = 0; i < s.length; i++) {
        const b = comp[Math.floor(i / binSize)];
        const ch = s[i] === 'U' ? 'T' : s[i];
        if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'N') b[ch]++;
        b.total++;
      }
    }
    // length distribution
    const lenCounts = new Map<number, number>();
    for (const l of lengths) lenCounts.set(l, (lenCounts.get(l) ?? 0) + 1);
    // duplication
    const seqCounts = new Map<string, number>();
    for (const s of seqs) seqCounts.set(s, (seqCounts.get(s) ?? 0) + 1);
    const distinct = seqCounts.size;
    // per-sequence GC histogram (0..100 in 5% bins)
    const gcHist = new Array<number>(21).fill(0);
    for (const v of perSeqGc) gcHist[Math.min(20, Math.floor(v / 5))]++;
    const hasQuality = reads.some((r) => r.quality && r.quality.length > 0);
    const maxCompDev = comp.reduce((m, b) => {
      if (!b.total) return m;
      const a = b.A / b.total;
      const t = b.T / b.total;
      const g = b.G / b.total;
      const c = b.C / b.total;
      return Math.max(m, Math.abs(a - t), Math.abs(g - c));
    }, 0);
    return {
      n, minLen, maxLen, total,
      gcPct: total ? (gc / total) * 100 : 0,
      nPct: total ? (nCount / total) * 100 : 0,
      comp, binSize, lenCounts, distinct, gcHist, hasQuality, maxCompDev,
    };
  }, [reads]);

  if (isProtein) {
    return <div className="mbc-aln-empty">The read QC report applies to nucleotide reads.</div>;
  }

  const modules: { name: string; status: QcStatus }[] = [
    { name: 'Basic Statistics', status: 'pass' },
    { name: 'Per base sequence quality', status: qc.hasQuality ? 'pass' : 'info' },
    { name: 'Per base sequence content', status: qc.maxCompDev > 0.2 ? 'fail' : qc.maxCompDev > 0.1 ? 'warn' : 'pass' },
    { name: 'Per sequence GC content', status: 'pass' },
    { name: 'Per base N content', status: qc.nPct > 20 ? 'fail' : qc.nPct > 5 ? 'warn' : 'pass' },
    { name: 'Sequence length distribution', status: qc.minLen === qc.maxLen ? 'pass' : 'warn' },
    {
      name: 'Sequence duplication levels',
      status: qc.n && qc.distinct / qc.n < 0.5 ? 'fail' : qc.n && qc.distinct / qc.n < 0.8 ? 'warn' : 'pass',
    },
  ];

  const W = 560;
  const H = 180;
  const chart = () => {
    switch (module) {
      case 'Per base sequence content': {
        const colors = BASE_COLOR;
        const nb = qc.comp.length;
        return (
          <svg width={W} height={H} className="mbc-qc-chart">
            {(['A', 'C', 'G', 'T'] as const).map((b) => (
              <path
                key={b}
                fill="none"
                stroke={colors[b]}
                strokeWidth={1.4}
                d={qc.comp
                  .map((bin, i) => `${i ? 'L' : 'M'}${((i + 0.5) / nb) * W} ${H - (bin.total ? bin[b] / bin.total : 0) * H}`)
                  .join('')}
              />
            ))}
          </svg>
        );
      }
      case 'Per base N content': {
        const nb = qc.comp.length;
        return (
          <svg width={W} height={H} className="mbc-qc-chart">
            <path
              fill="none"
              stroke="var(--mbc-red)"
              strokeWidth={1.4}
              d={qc.comp.map((bin, i) => `${i ? 'L' : 'M'}${((i + 0.5) / nb) * W} ${H - (bin.total ? bin.N / bin.total : 0) * H}`).join('')}
            />
          </svg>
        );
      }
      case 'Per sequence GC content': {
        const max = Math.max(1, ...qc.gcHist);
        const bw = W / qc.gcHist.length;
        return (
          <svg width={W} height={H} className="mbc-qc-chart">
            {qc.gcHist.map((v, i) => (
              <rect key={i} x={i * bw + 1} width={bw - 2} y={H - (v / max) * H} height={(v / max) * H} fill="var(--mbc-blue)" />
            ))}
          </svg>
        );
      }
      case 'Sequence length distribution': {
        const entries = [...qc.lenCounts.entries()].sort((a, b) => a[0] - b[0]);
        const max = Math.max(1, ...entries.map((e) => e[1]));
        const bw = W / Math.max(1, entries.length);
        return (
          <svg width={W} height={H} className="mbc-qc-chart">
            {entries.map(([len, cnt], i) => (
              <g key={len}>
                <rect x={i * bw + 1} width={Math.max(1, bw - 2)} y={H - (cnt / max) * (H - 14)} height={(cnt / max) * (H - 14)} fill="var(--mbc-purple)">
                  <title>{`${len} bp: ${cnt}`}</title>
                </rect>
              </g>
            ))}
          </svg>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="mbc-qc">
      <ul className="mbc-qc-modules">
        {modules.map((m) => (
          <li key={m.name}>
            <button
              type="button"
              className={`mbc-qc-module ${module === m.name ? 'active' : ''}`}
              onClick={() => setModule(m.name)}
            >
              <span className={`mbc-qc-status ${m.status}`}>{STATUS_ICON[m.status]}</span>
              {m.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="mbc-qc-body" data-mbc-figure>
        <div className="studio-card-header" style={{ paddingTop: 0 }}>
          <h4>{module}</h4>
          <FigureExportButton
            compact
            baseName={`Read QC — ${module}`}
            title={`Read QC — ${module}`}
            table={{
              headers: ['Bin', 'Position', 'A', 'C', 'G', 'T', 'N', 'Total'],
              rows: qc.comp.map((bin, i) => [
                String(i + 1),
                String(i + 1),
                String(bin.A),
                String(bin.C),
                String(bin.G),
                String(bin.T),
                String(bin.N),
                String(bin.total),
              ]),
              caption: `Read QC — ${module}: ${qc.n.toLocaleString()} sequences, ${qc.total.toLocaleString()} bases, ${qc.gcPct.toFixed(1)}% GC`,
            }}
          />
        </div>
        {module === 'Basic Statistics' && (
          <table className="mbc-aln-stat-freq-table">
            <tbody>
              <tr><td>Total sequences</td><td>{qc.n.toLocaleString()}</td></tr>
              <tr><td>Total bases</td><td>{qc.total.toLocaleString()}</td></tr>
              <tr><td>Sequence length</td><td>{qc.minLen === qc.maxLen ? qc.minLen : `${qc.minLen}–${qc.maxLen}`}</td></tr>
              <tr><td>%GC</td><td>{qc.gcPct.toFixed(1)}</td></tr>
              <tr><td>%N</td><td>{qc.nPct.toFixed(2)}</td></tr>
              <tr><td>Distinct sequences</td><td>{qc.distinct.toLocaleString()}</td></tr>
            </tbody>
          </table>
        )}
        {module === 'Per base sequence quality' && (
          <p className="mbc-aln-hint">
            {qc.hasQuality
              ? 'Quality scores are available for these reads.'
              : 'No per-base quality scores are stored with these sequences (FASTA / alignment input). Import FASTQ or trace files to evaluate quality.'}
          </p>
        )}
        {module === 'Sequence duplication levels' && (
          <p>
            {qc.distinct.toLocaleString()} distinct of {qc.n.toLocaleString()} sequences —{' '}
            {qc.n ? ((qc.distinct / qc.n) * 100).toFixed(1) : '0'}% would remain after de-duplication.
          </p>
        )}
        {chart()}
        {module === 'Per base sequence content' && (
          <p className="mbc-aln-hint">
            Position bins of {qc.binSize} bp. A <span style={{ color: BASE_COLOR.A }}>■</span> C{' '}
            <span style={{ color: BASE_COLOR.C }}>■</span> G <span style={{ color: BASE_COLOR.G }}>■</span> T{' '}
            <span style={{ color: BASE_COLOR.T }}>■</span>
          </p>
        )}
      </div>
    </div>
  );
};
