// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Expression analysis: the options window (count table → two conditions) and the results view
 * shown on the result document (volcano, MA and PCA plots, sortable results table, CSV export).
 */

import React, { useMemo, useState } from 'react';
import { FigureExportButton } from './FigureExportButton';
import { OperationDialog, OptionRow } from './OperationDialog';
import { parseCountTable, simulatedCountTable, type ParsedCounts } from '../core/expression';
import { COUNT_TABLE_KEY, EXPRESSION_KEY, runExpressionAnalysis, type OperationResult, type StoredExpression } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

// ───────────────────────────── window ─────────────────────────────

export interface ExpressionDialogProps {
  folder?: string;
  /** Documents carrying a count table (from Calculate Expression Levels). */
  countTableDocs?: SequenceDocument[];
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
}

type Role = 'A' | 'B' | '';

export const ExpressionDialog: React.FC<ExpressionDialogProps> = ({ folder, countTableDocs = [], onCreate, onClose }) => {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const parsed = useMemo<{ t?: ParsedCounts; error?: string }>(() => {
    if (!text.trim()) return {};
    try { return { t: parseCountTable(text) }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [text]);
  const t = parsed.t;
  // default roles: first half A, second half B, guessed from common prefixes when possible
  const roleOf = (s: string, i: number): Role => {
    if (roles[s] !== undefined) return roles[s];
    if (!t) return '';
    return i < Math.floor(t.samples.length / 2) ? 'A' : 'B';
  };
  const samplesA = t ? t.samples.filter((s, i) => roleOf(s, i) === 'A') : [];
  const samplesB = t ? t.samples.filter((s, i) => roleOf(s, i) === 'B') : [];
  return (
    <OperationDialog
      operationId="expression"
      title="Compare Expression Levels…"
      runLabel="Compare"
      transientKeys={['resultName']}
      defaults={{ conditionA: 'control', conditionB: 'treated', alpha: 0.05, lfcThreshold: 0, minTotal: 10, resultName: '' }}
      summary={<span>Differential expression between two conditions from a gene × sample count table (CSV/TSV, featureCounts or HTSeq output), DESeq2 statistics.</span>}
      validate={() => {
        if (!t) return parsed.error ?? 'Paste a count table, choose a file, or load the example.';
        if (samplesA.length < 2 || samplesB.length < 2) return 'Assign at least two replicate samples to each condition.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Count table:" htmlFor="opdlg-ex-text">
            <div style={{ display: 'grid', gap: 6, width: '100%' }}>
              <textarea id="opdlg-ex-text" rows={4} value={text.length > 20000 ? `${text.slice(0, 2000)}\n… (${text.split('\n').length.toLocaleString()} lines loaded)` : text}
                readOnly={text.length > 20000} onChange={(e) => { setText(e.target.value); setRoles({}); }}
                placeholder={'gene\tctrl_1\tctrl_2\ttreat_1\ttreat_2\nACTB\t1520\t1388\t1490\t1602'} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} />
              <div className="prefs-row">
                <label className="mbc-btn">
                  Choose file…
                  <input type="file" accept=".csv,.tsv,.txt,.tab,text/csv,text/tab-separated-values" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); setRoles({}); void f.text().then(setText); }} />
                </label>
                {countTableDocs.length > 0 && (
                  <select aria-label="Count table from a document" value="" onChange={(e) => {
                    const d = countTableDocs.find((x) => x.id === e.target.value);
                    if (!d) return;
                    setText(String(d.docMetadata?.[COUNT_TABLE_KEY] ?? '')); setFileName(d.name); setRoles({});
                  }}>
                    <option value="">From a document…</option>
                    {countTableDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
                <button type="button" className="mbc-btn" onClick={() => { setText(simulatedCountTable().text); setFileName('Example: simulated 3 vs 3 RNA-seq counts'); setRoles({}); set('conditionA', 'ctrl'); set('conditionB', 'treat'); }}>Load example</button>
                {fileName && <span className="mbc-opdlg-muted">{fileName}</span>}
              </div>
              {t && <span className="mbc-opdlg-muted">{t.format}: {t.genes.length.toLocaleString()} genes × {t.samples.length} samples{t.skipped ? ` · ${t.skipped} rows skipped` : ''}</span>}
              {parsed.error && <span role="alert" className="mbc-custom-fields-error">{parsed.error}</span>}
            </div>
          </OptionRow>
          {t && (
            <OptionRow label="Samples:" hint="Assign each sample to a condition (or leave it out). Fold changes are reported as condition B relative to A.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 4, width: '100%' }}>
                {t.samples.map((s, i) => (
                  <label key={s} className="prefs-row" style={{ gap: 6 }}>
                    <select aria-label={`Condition of ${s}`} value={roleOf(s, i)} onChange={(e) => setRoles((r) => ({ ...r, [s]: e.target.value as Role }))}>
                      <option value="A">{String(v.conditionA) || 'A'}</option>
                      <option value="B">{String(v.conditionB) || 'B'}</option>
                      <option value="">left out</option>
                    </select>
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </OptionRow>
          )}
          <OptionRow label="Condition names:" htmlFor="opdlg-ex-a">
            <div className="prefs-row">
              <span>A</span><input id="opdlg-ex-a" type="text" style={{ width: 120 }} value={String(v.conditionA)} onChange={(e) => set('conditionA', e.target.value)} />
              <span>B</span><input id="opdlg-ex-b" type="text" style={{ width: 120 }} value={String(v.conditionB)} onChange={(e) => set('conditionB', e.target.value)} />
            </div>
          </OptionRow>
          <OptionRow label="Significance:" htmlFor="opdlg-ex-alpha">
            <div className="prefs-row">
              <span>padj &lt;</span>
              <input id="opdlg-ex-alpha" type="number" min={0.001} max={0.5} step={0.01} style={{ width: 70 }} value={Number(v.alpha)} onChange={(e) => set('alpha', Math.max(0.001, Math.min(0.5, Number(e.target.value) || 0.05)))} />
              <span>and |log2FC| ≥</span>
              <input aria-label="Fold-change threshold" type="number" min={0} max={10} step={0.5} style={{ width: 60 }} value={Number(v.lfcThreshold)} onChange={(e) => set('lfcThreshold', Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          <OptionRow label="Count filter:" htmlFor="opdlg-ex-min" hint="Genes with fewer total counts across the chosen samples are not tested.">
            <div className="prefs-row"><input id="opdlg-ex-min" type="number" min={0} style={{ width: 80 }} value={Number(v.minTotal)} onChange={(e) => set('minTotal', Math.max(0, Number(e.target.value) || 0))} /><span>total counts</span></div>
          </OptionRow>
          <OptionRow label="Result name:" htmlFor="opdlg-ex-name">
            <input id="opdlg-ex-name" type="text" value={String(v.resultName)} placeholder={`${String(v.conditionB)} vs ${String(v.conditionA)}`} onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runExpressionAnalysis(t!, { ...v, samplesA: JSON.stringify(samplesA), samplesB: JSON.stringify(samplesB) }, { sourceLabel: fileName.replace(/\.[^.]+$/, '').replace(/^Example: /, '') || 'Expression', folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── results view ─────────────────────────────

export function readStoredExpression(doc: SequenceDocument): StoredExpression | null {
  const raw = doc.docMetadata?.[EXPRESSION_KEY];
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as StoredExpression; } catch { return null; }
}

const W = 340;
const H = 240;
const M = { l: 44, r: 10, t: 10, b: 34 };

function Axes({ x0, x1, y0, y1, xl, yl, ticks }: { x0: number; x1: number; y0: number; y1: number; xl: string; yl: string; ticks?: boolean }) {
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const nice = (a: number, b: number) => { const span = b - a; const st = Math.pow(10, Math.floor(Math.log10(span / 4 || 1))); const step = span / st > 20 ? st * 5 : span / st > 8 ? st * 2 : st; const out: number[] = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Number(v.toPrecision(6))); return out; };
  return (
    <g fontSize={10} className="mbc-expr-axis">
      <path d={`M${M.l},${M.t} V${H - M.b} H${W - M.r}`} fill="none" stroke="currentColor" strokeOpacity={0.5} />
      {ticks !== false && nice(x0, x1).map((v) => <g key={`x${v}`}><path d={`M${sx(v)},${H - M.b} v4`} stroke="currentColor" strokeOpacity={0.5} /><text x={sx(v)} y={H - M.b + 14} textAnchor="middle">{v}</text></g>)}
      {ticks !== false && nice(y0, y1).map((v) => <g key={`y${v}`}><path d={`M${M.l},${sy(v)} h-4`} stroke="currentColor" strokeOpacity={0.5} /><text x={M.l - 6} y={sy(v) + 3} textAnchor="end">{v}</text></g>)}
      <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">{xl}</text>
      <text x={10} y={(M.t + H - M.b) / 2} textAnchor="middle" transform={`rotate(-90 10 ${(M.t + H - M.b) / 2})`}>{yl}</text>
    </g>
  );
}

export const ExpressionResultsView: React.FC<{ doc: SequenceDocument; onDownload?: (content: string, name: string, mime: string) => void }> = ({ doc, onDownload }) => {
  const e = readStoredExpression(doc);
  const [sort, setSort] = useState<{ col: number; asc: boolean }>({ col: 5, asc: true });
  const [query, setQuery] = useState('');
  const [onlySig, setOnlySig] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const rows = e?.rows ?? [];
  const isSig = (r: StoredExpression['rows'][number]) => !!e && r[5] < e.alpha && Math.abs(r[2]) >= e.lfcThreshold;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (!q || r[0].toLowerCase().includes(q)) && (!onlySig || isSig(r)));
    const k = sort.col;
    return [...list].sort((a, b) => {
      const x = a[k] as number | string;
      const y = b[k] as number | string;
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y as number) ? (y as number) : Infinity);
      return sort.asc ? c : -c;
    }).slice(0, 300);
  }, [rows, query, onlySig, sort, e]);
  if (!e) return null;
  const finite = rows.filter((r) => Number.isFinite(r[2]) && Number.isFinite(r[4]) && r[4] > 0);
  const maxAbs = Math.min(10, Math.max(1, ...finite.map((r) => Math.abs(r[2]))));
  const maxY = Math.min(50, Math.max(2, ...finite.map((r) => -Math.log10(r[4]))));
  const color = (r: StoredExpression['rows'][number]) => (isSig(r) ? (r[2] > 0 ? 'var(--mbc-red)' : 'var(--mbc-blue)') : 'var(--mbc-text-muted)');
  const vx = (x: number) => M.l + ((Math.max(-maxAbs, Math.min(maxAbs, x)) + maxAbs) / (2 * maxAbs)) * (W - M.l - M.r);
  const vy = (y: number) => H - M.b - (Math.min(maxY, y) / maxY) * (H - M.t - M.b);
  const minLogMean = Math.log10(Math.max(0.1, Math.min(...finite.map((r) => r[1] || 0.1))));
  const maxLogMean = Math.log10(Math.max(...finite.map((r) => r[1] || 1)));
  const mx = (m: number) => M.l + ((Math.log10(Math.max(0.1, m)) - minLogMean) / (maxLogMean - minLogMean || 1)) * (W - M.l - M.r);
  const my = (l: number) => H - M.b - ((Math.max(-maxAbs, Math.min(maxAbs, l)) + maxAbs) / (2 * maxAbs)) * (H - M.t - M.b);
  const px = e.pca.map((p) => p.pc1);
  const py = e.pca.map((p) => p.pc2);
  const [p0, p1] = [Math.min(...px), Math.max(...px)];
  const [q0, q1] = [Math.min(...py), Math.max(...py)];
  const pad = (a: number, b: number) => { const d = (b - a) * 0.15 || 1; return [a - d, b + d]; };
  const [pa, pb] = pad(p0, p1);
  const [qa, qb] = pad(q0, q1);
  const ppx = (x: number) => M.l + ((x - pa) / (pb - pa)) * (W - M.l - M.r);
  const ppy = (y: number) => H - M.b - ((y - qa) / (qb - qa)) * (H - M.t - M.b);
  const sig = rows.filter(isSig);
  const exportCsv = () => onDownload?.(['gene,baseMean,log2FoldChange,lfcSE,pvalue,padj', ...rows.map((r) => r.join(','))].join('\n'), `${doc.name}.csv`, 'text/csv;charset=utf-8');
  const header = ['Gene', 'baseMean', 'log2FC', 'lfcSE', 'p-value', 'padj'];
  const fmt = (v: number | string, i: number) => (typeof v === 'string' ? v : !Number.isFinite(v) ? '—' : i >= 4 ? v.toExponential(2) : i === 1 ? v.toFixed(1) : v.toFixed(3));
  // draw at most ~6000 points per plot (non-significant ones thinned)
  const step = Math.max(1, Math.ceil(finite.length / 6000));
  const pts = finite.filter((r, i) => isSig(r) || i % step === 0);
  return (
    <section className="mbc-expr" aria-label="Expression results">
      <div className="mbc-expr-head">
        <strong>{e.conditionB} vs {e.conditionA}</strong>
        <span>{rows.length.toLocaleString()} genes · {sig.length} significant (padj &lt; {e.alpha}{e.lfcThreshold ? `, |log2FC| ≥ ${e.lfcThreshold}` : ''}): <span style={{ color: 'var(--mbc-red)' }}>{sig.filter((r) => r[2] > 0).length} up</span>, <span style={{ color: 'var(--mbc-blue)' }}>{sig.filter((r) => r[2] < 0).length} down</span></span>
        {onDownload && <button type="button" className="mbc-btn" onClick={exportCsv}>Export CSV</button>}
      </div>
      <div className="mbc-expr-plots">
        <figure data-mbc-figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Volcano plot">
            <Axes x0={-maxAbs} x1={maxAbs} y0={0} y1={maxY} xl="log2 fold change" yl="−log10 p-value" />
            {pts.map((r) => <circle key={r[0]} cx={vx(r[2])} cy={vy(-Math.log10(r[4]))} r={hover === r[0] ? 4 : 1.8} fill={color(r)} fillOpacity={0.75}><title>{`${r[0]}: log2FC ${r[2].toFixed(2)}, padj ${fmt(r[5], 5)}`}</title></circle>)}
          </svg>
          <figcaption>
            Volcano plot
            <FigureExportButton compact baseName={`${doc.name} — Volcano Plot`} title={`${doc.name} — volcano plot, ${e.conditionB} vs ${e.conditionA}`} table={{ headers: header, rows: rows.map((r) => r.map((v, i) => String(fmt(v, i)))), caption: `${doc.name} — ${e.conditionB} vs ${e.conditionA}, ${rows.length} genes` }} />
          </figcaption>
        </figure>
        <figure data-mbc-figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="MA plot">
            <Axes x0={minLogMean} x1={maxLogMean} y0={-maxAbs} y1={maxAbs} xl="log10 mean of normalised counts" yl="log2 fold change" />
            <path d={`M${M.l},${my(0)} H${W - M.r}`} stroke="currentColor" strokeOpacity={0.3} />
            {pts.map((r) => <circle key={r[0]} cx={mx(r[1])} cy={my(r[2])} r={hover === r[0] ? 4 : 1.8} fill={color(r)} fillOpacity={0.75}><title>{`${r[0]}: mean ${r[1].toFixed(1)}, log2FC ${r[2].toFixed(2)}`}</title></circle>)}
          </svg>
          <figcaption>
            MA plot
            <FigureExportButton compact baseName={`${doc.name} — MA Plot`} title={`${doc.name} — MA plot, ${e.conditionB} vs ${e.conditionA}`} table={{ headers: header, rows: rows.map((r) => r.map((v, i) => String(fmt(v, i)))), caption: `${doc.name} — ${e.conditionB} vs ${e.conditionA}, ${rows.length} genes` }} />
          </figcaption>
        </figure>
        <figure data-mbc-figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PCA plot">
            <Axes x0={pa} x1={pb} y0={qa} y1={qb} xl={`PC1 (${e.pcaVariance[0].toFixed(0)}%)`} yl={`PC2 (${e.pcaVariance[1].toFixed(0)}%)`} ticks={false} />
            {e.pca.map((p) => (
              <g key={p.sample}>
                <circle cx={ppx(p.pc1)} cy={ppy(p.pc2)} r={5} fill={p.group === e.conditionB ? 'var(--mbc-red)' : 'var(--mbc-blue)'} />
                <text x={ppx(p.pc1) + 7} y={ppy(p.pc2) + 3} fontSize={10}>{p.sample}</text>
              </g>
            ))}
          </svg>
          <figcaption>
            <FigureExportButton compact baseName={`${doc.name} — PCA Plot`} title={`${doc.name} — PCA of samples`} table={{ headers: ['Sample', 'Group', 'PC1', 'PC2'], rows: e.pca.map((p) => [p.sample, p.group, p.pc1.toFixed(4), p.pc2.toFixed(4)]), caption: `${doc.name} — PCA of samples: PC1 ${e.pcaVariance[0].toFixed(0)}%, PC2 ${e.pcaVariance[1].toFixed(0)}%` }} />
            PCA of samples (log2 normalised counts, most variable genes) · <span style={{ color: 'var(--mbc-blue)' }}>●</span> {e.conditionA} <span style={{ color: 'var(--mbc-red)' }}>●</span> {e.conditionB}</figcaption>
        </figure>
      </div>
      <div className="mbc-expr-table-bar">
        <input type="search" placeholder="Find gene…" aria-label="Find gene" value={query} onChange={(ev) => setQuery(ev.target.value)} />
        <label className="mbc-check-row"><input type="checkbox" checked={onlySig} onChange={(ev) => setOnlySig(ev.target.checked)} /> Significant only</label>
        <span className="mbc-opdlg-muted">{shown.length === 300 ? 'first 300 shown' : `${shown.length} shown`}</span>
      </div>
      <div className="mbc-expr-table-wrap">
        <table className="mbc-expr-table">
          <thead><tr>{header.map((h, i) => (
            <th key={h} scope="col" onClick={() => setSort((s) => ({ col: i, asc: s.col === i ? !s.asc : i === 0 || i >= 4 }))} style={{ cursor: 'pointer' }}>
              {h}{sort.col === i ? (sort.asc ? ' ▲' : ' ▼') : ''}
            </th>
          ))}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r[0]} onMouseEnter={() => setHover(r[0])} onMouseLeave={() => setHover(null)}>
              {r.map((v, i) => <td key={i} style={i === 2 && isSig(r) ? { color: color(r), fontWeight: 600 } : undefined}>{fmt(v, i)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
};
