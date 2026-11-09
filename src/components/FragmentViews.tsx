// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Electropherogram view for fragment-analysis runs and the Microsatellite Analysis window. */

import React, { useMemo, useState } from 'react';
import { FigureExportButton } from './FigureExportButton';
import { InspectorSection } from './WorkbenchInspector';
import { OperationDialog, OptionRow } from './OperationDialog';
import { dyeColor, parseKitXml, scanToBp, SIZE_STANDARDS, type MarkerCall, type Sizing } from '../core/fragmentAnalysis';
import { ALLELE_CALLS_KEY, FRAGMENT_SIZING_KEY, fragmentTraceOf, runMicrosatellites, type OperationResult } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

const parse = <T,>(raw: unknown): T | null => { if (typeof raw !== 'string') return null; try { return JSON.parse(raw) as T; } catch { return null; } };

export const FragmentTraceView: React.FC<{ doc: SequenceDocument }> = ({ doc }) => {
  const trace = useMemo(() => fragmentTraceOf(doc), [doc]);
  const sizing = useMemo(() => parse<Sizing & { dye: string; standard: string }>(doc.docMetadata?.[FRAGMENT_SIZING_KEY]), [doc]);
  const calls = useMemo(() => parse<MarkerCall[]>(doc.docMetadata?.[ALLELE_CALLS_KEY]) ?? [], [doc]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<{ lo: string; hi: string }>({ lo: '', hi: '' });
  if (!trace) return null;
  const n = Math.max(...trace.channels.map((c) => c.data.length));
  const xOf = (scan: number) => (sizing ? scanToBp(sizing, scan) : scan);
  const unit = sizing ? 'bp' : 'scan';
  const fullLo = sizing ? Math.max(0, Math.floor(xOf(sizing.points[0].scan) - 20)) : 0;
  const fullHi = sizing ? Math.ceil(xOf(sizing.points[sizing.points.length - 1].scan) + 20) : n;
  const lo = Number(range.lo) || fullLo;
  const hi = Number(range.hi) > lo ? Number(range.hi) : fullHi;
  const W = 900;
  const H = 260;
  const M = { l: 48, r: 10, t: 14, b: 28 };
  // scans inside the visible range, thinned to ~3 points per pixel
  const visible: number[] = [];
  for (let s = 0; s < n; s++) { const x = xOf(s); if (x >= lo && x <= hi) visible.push(s); }
  const step = Math.max(1, Math.floor(visible.length / (W * 3)));
  const shown = trace.channels.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.dye));
  const yMax = Math.max(100, ...shown.flatMap(({ c }) => visible.map((s) => c.data[s] ?? 0)));
  const px = (x: number) => M.l + ((x - lo) / (hi - lo)) * (W - M.l - M.r);
  const py = (y: number) => H - M.b - (Math.min(y, yMax) / yMax) * (H - M.t - M.b);
  const ticks: number[] = [];
  const span = hi - lo;
  const tstep = Math.pow(10, Math.floor(Math.log10(span / 5)));
  const ts = span / tstep > 25 ? tstep * 5 : span / tstep > 10 ? tstep * 2 : tstep;
  for (let v = Math.ceil(lo / ts) * ts; v <= hi; v += ts) ticks.push(v);
  return (
    <section className="mbc-fragment" aria-label="Electropherogram" data-mbc-figure>
      <div className="mbc-expr-head">
        <strong>Electropherogram</strong>
        <span className="mbc-opdlg-muted">{sizing ? `sized with ${sizing.standard} (${sizing.matched}/${sizing.expected} standards)` : 'not sized (scan numbers)'}</span>
        {/* US-01M6TAZ7: which dyes are drawn is a setting, so in the workbench the toggles are a section of
            App's inspector (a document with no trace returned above, and claims none); the range and
            export stay on the trace. Drawn on its own, they stay here in the head. */}
        <InspectorSection title="Dye Channels" order={1}>
          {trace.channels.map((c, i) => (
            <label key={c.dye} className="mbc-check-row">
              <input type="checkbox" checked={!hidden.has(c.dye)} onChange={() => setHidden((h) => { const nx = new Set(h); if (nx.has(c.dye)) nx.delete(c.dye); else nx.add(c.dye); return nx; })} />
              <span style={{ color: dyeColor(c.dye, i), fontWeight: 600 }}>{c.dye}</span>
            </label>
          ))}
        </InspectorSection>
        <span className="prefs-row">
          <input aria-label="From" type="number" style={{ width: 70 }} placeholder={String(fullLo)} value={range.lo} onChange={(e) => setRange((r) => ({ ...r, lo: e.target.value }))} />
          <span>–</span>
          <input aria-label="To" type="number" style={{ width: 70 }} placeholder={String(fullHi)} value={range.hi} onChange={(e) => setRange((r) => ({ ...r, hi: e.target.value }))} />
          <span>{unit}</span>
          {(range.lo || range.hi) && <button type="button" className="mbc-btn" onClick={() => setRange({ lo: '', hi: '' })}>Full range</button>}
        </span>
        <FigureExportButton
          compact
          baseName={`${doc.name} — Electropherogram`}
          title={`${doc.name} — electropherogram`}
          table={{
            headers: ['Dye', 'Marker', `Size (${unit})`, 'Height', 'Allele'],
            rows: calls.flatMap((c) => c.alleles.map((a) => [c.dye, c.marker, String(a.size), String(a.height), a.name ?? ''])),
            caption: `${doc.name} — called alleles${sizing ? `, sized with ${sizing.standard}` : ' (not sized)'}`,
          }}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={`Electropherogram of ${doc.name}`}>
        <path d={`M${M.l},${M.t} V${H - M.b} H${W - M.r}`} fill="none" stroke="currentColor" strokeOpacity={0.5} />
        {ticks.map((v) => <g key={v}><path d={`M${px(v)},${H - M.b} v4`} stroke="currentColor" strokeOpacity={0.5} /><text x={px(v)} y={H - M.b + 15} fontSize={10} textAnchor="middle" fill="currentColor">{Number(v.toPrecision(6))}</text></g>)}
        <text x={W - M.r} y={H - 2} fontSize={10} textAnchor="end" fill="currentColor">{unit}</text>
        <text x={M.l - 6} y={M.t + 8} fontSize={10} textAnchor="end" fill="currentColor">{Math.round(yMax)}</text>
        <text x={M.l - 6} y={H - M.b} fontSize={10} textAnchor="end" fill="currentColor">0</text>
        {shown.map(({ c, i }) => {
          let d = '';
          for (let k = 0; k < visible.length; k += step) { const s = visible[k]; d += `${k ? 'L' : 'M'}${px(xOf(s)).toFixed(1)},${py(c.data[s] ?? 0).toFixed(1)}`; }
          return <path key={c.dye} d={d} fill="none" stroke={dyeColor(c.dye, i)} strokeWidth={1} />;
        })}
        {sizing && calls.flatMap((c) => c.alleles.filter((a) => a.size >= lo && a.size <= hi && !hidden.has(c.dye)).map((a) => (
          <g key={`${c.marker}-${a.size}`}>
            <path d={`M${px(a.size)},${py(a.height) - 2} v-10`} stroke="currentColor" />
            <text x={px(a.size)} y={Math.max(10, py(a.height) - 15)} fontSize={10} textAnchor="middle" fill="currentColor">{c.marker} {a.name ? `${a.name} (${a.size.toFixed(1)})` : a.size.toFixed(1)}</text>
          </g>
        )))}
      </svg>
    </section>
  );
};

export interface MicrosatelliteDialogProps {
  runs: SequenceDocument[];
  onApply: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

function kitSummary(xml: string): string {
  try {
    const kits = parseKitXml(xml);
    const k = kits[0];
    return `Kit ${k.name}: ${k.markers.length} markers, ${k.markers.reduce((a, m) => a + (m.ladder?.length ?? 0), 0)} ladder alleles${kits.length > 1 ? ` (first of ${kits.length} kits)` : ''}`;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

const EXAMPLE_PANEL = '# name, dye, min bp, max bp, repeat\nD1S80, 6-FAM, 140, 170, 2\nTH01, VIC, 150, 200, 4\nvWA, NED, 150, 210, 4';

export const MicrosatelliteDialog: React.FC<MicrosatelliteDialogProps> = ({ runs, onApply, onClose, onDownload }) => {
  const traces = runs.map((d) => fragmentTraceOf(d)).filter(Boolean);
  const dyes = [...new Set(traces.flatMap((t) => t!.channels.map((c) => c.dye)))];
  return (
    <OperationDialog
      operationId="microsatellites"
      title="Microsatellite Analysis…"
      runLabel="Analyse"
      transientKeys={['resultName']}
      defaults={{ standard: 'GeneScan 500 LIZ', customSizes: '', sizeDye: dyes.find((d) => /liz|rox|orange/i.test(d)) ?? dyes[dyes.length - 1] ?? '', panel: '', allelicLadder: 'auto', minHeight: 100, stutterPct: 25, balancePct: 30, ladderHeight: 100, resultName: '' }}
      onDownload={onDownload}
      summary={<span>Sizes <strong>{traces.length}</strong> fragment-analysis run{traces.length === 1 ? '' : 's'} against a size standard and calls microsatellite alleles from a marker panel.</span>}
      validate={(v) => {
        if (!traces.length) return 'Select fragment-analysis runs (.fsa, imported with File → Import) in the table.';
        if (v.standard === 'custom' && String(v.customSizes).split(/[,\s;]+/).filter((x) => Number(x) > 0).length < 4) return 'Enter at least four sizes for the custom standard.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Size standard:" htmlFor="opdlg-ms-std">
            <div className="prefs-row">
              <select id="opdlg-ms-std" value={String(v.standard)} onChange={(e) => set('standard', e.target.value)}>
                <option value="auto">Auto (best-fitting standard)</option>
                {Object.keys(SIZE_STANDARDS).map((k) => <option key={k} value={k}>{k}</option>)}
                <option value="custom">Custom…</option>
              </select>
              <span>in</span>
              <select aria-label="Size-standard dye" value={String(v.sizeDye)} onChange={(e) => set('sizeDye', e.target.value)}>
                {dyes.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </OptionRow>
          {v.standard === 'custom' && (
            <OptionRow label="Standard sizes (bp):" htmlFor="opdlg-ms-custom">
              <input id="opdlg-ms-custom" type="text" value={String(v.customSizes)} placeholder="50, 75, 100, 125, 150 …" onChange={(e) => set('customSizes', e.target.value)} />
            </OptionRow>
          )}
          <OptionRow label="Marker panel:" htmlFor="opdlg-ms-panel" hint="One marker per line: name, dye, min bp, max bp, repeat unit — or load a kit definition (OSIRIS LadderInfo .xml) with its ladder alleles. Leave empty to only size the runs.">
            <div style={{ display: 'grid', gap: 4, width: '100%' }}>
              {String(v.panel).trim().startsWith('<')
                ? <div className="prefs-row"><span>{kitSummary(String(v.panel))}</span><button type="button" className="mbc-btn" onClick={() => set('panel', '')}>Clear</button></div>
                : <textarea id="opdlg-ms-panel" rows={5} value={String(v.panel)} placeholder={EXAMPLE_PANEL} onChange={(e) => set('panel', e.target.value)} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} />}
              <div className="prefs-row">
                <button type="button" className="mbc-btn" onClick={() => set('panel', EXAMPLE_PANEL)}>Insert example panel</button>
                <label className="mbc-btn" style={{ cursor: 'pointer' }}>
                  Load kit file…
                  <input type="file" accept=".xml,.txt,.csv,.tsv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((x) => set('panel', x)); e.target.value = ''; }} />
                </label>
              </div>
            </div>
          </OptionRow>
          {String(v.panel).trim().startsWith('<') && (
            <OptionRow label="Allelic ladder:" htmlFor="opdlg-ms-lad" hint="Alleles are named from the ladder run(s), whose peaks are matched in order to the kit’s ladder alleles; a sample peak within ±0.5 bp of a ladder allele takes its name, others are off-ladder (OL).">
              <select id="opdlg-ms-lad" value={String(v.allelicLadder)} onChange={(e) => set('allelicLadder', e.target.value)}>
                <option value="auto">Runs named “ladder” ({runs.filter((r) => /ladder/i.test(r.name)).length})</option>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="none">None (sizes in bp)</option>
              </select>
            </OptionRow>
          )}
          <OptionRow label="Peak calling:" htmlFor="opdlg-ms-h">
            <div className="prefs-row">
              <span>peaks ≥</span><input id="opdlg-ms-h" type="number" min={10} style={{ width: 70 }} value={Number(v.minHeight)} onChange={(e) => set('minHeight', Math.max(10, Number(e.target.value) || 100))} /><span>RFU</span>
            </div>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          <OptionRow label="Stutter filter:" htmlFor="opdlg-ms-st" hint="A peak one repeat shorter than a taller peak, and below this % of its height, is treated as stutter.">
            <div className="prefs-row"><input id="opdlg-ms-st" type="number" min={0} max={90} style={{ width: 60 }} value={Number(v.stutterPct)} onChange={(e) => set('stutterPct', Math.max(0, Math.min(90, Number(e.target.value) || 0)))} /><span>%</span></div>
          </OptionRow>
          <OptionRow label="Heterozygote balance:" htmlFor="opdlg-ms-bal" hint="A second allele must reach this % of the first allele’s height.">
            <div className="prefs-row"><input id="opdlg-ms-bal" type="number" min={5} max={100} style={{ width: 60 }} value={Number(v.balancePct)} onChange={(e) => set('balancePct', Math.max(5, Math.min(100, Number(e.target.value) || 30)))} /><span>%</span></div>
          </OptionRow>
          <OptionRow label="Size-standard peaks ≥" htmlFor="opdlg-ms-lh">
            <div className="prefs-row"><input id="opdlg-ms-lh" type="number" min={10} style={{ width: 70 }} value={Number(v.ladderHeight)} onChange={(e) => set('ladderHeight', Math.max(10, Number(e.target.value) || 100))} /><span>RFU</span></div>
          </OptionRow>
        </>
      )}
      onRun={(v) => onApply(runMicrosatellites(runs, v, { sourceLabel: 'Microsatellites' }))}
      onClose={onClose}
    />
  );
};
