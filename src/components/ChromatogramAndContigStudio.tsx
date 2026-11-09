// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Settings2, TriangleAlert } from 'lucide-react';
import { FigureExportButton } from './FigureExportButton';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { hasBiologicalSequence } from '../core/documentViews';
import { ChromatogramData, SequenceDocument } from '../types/bio';
import { mapReadAndCallVariants } from '../core/bioEngine';
import { mapVariantRefPositionToReadIndex } from '../core/chromatogramVariantNavigation';
import {
  assembleSangerContigPoaRust,
  computeChromatogramViewportRust,
  trimSangerTraceMottPhredRust,
  type PoaContigAssemblyReport,
} from '../lib/rustBioEngine';
import { withWarningNotes } from '../core/operationRunners';
import { ResultWarnings } from './ResultWarnings';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import { BASE_COLOR, baseColor, qualityColor } from '../core/basePalette';

/** A quality-trimmed read shorter than this is warned about before it can be saved as a read. */
const MIN_READ_BP = 20;

/** The error cutoff of the viewport's HQ window (`compute_chromatogram_viewport` trims at P(err) 0.05). */
const VIEWPORT_HQ_CUTOFF = 0.05;
/** How every surface that shows the viewport's HQ window names the cutoff it is fixed at. */
const VIEWPORT_HQ_CUTOFF_LABEL = `P(err) cutoff ${VIEWPORT_HQ_CUTOFF}`;

const NO_HQ_REGION = 'No high-quality region';
/** What the trimming surfaces say of a read the trim cannot score: it was not trimmed, not trimmed to 0 bp. */
const NOT_TRIMMED = 'Not trimmed';
/** The one wording for a read with no quality values, and its short form for a table cell and for a sequence with no trace. */
const NO_QUALITY_VALUES = 'No quality values in this file';
const NO_QUALITY_VALUES_SHORT = 'No quality values';

const counted = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;

/**
 * What keeps this read's quality values from scoring its base calls, or null when it has one for
 * every call. A file can hold fewer of them than calls, or more: the importer reads an ABIF file's
 * PCON whole, filters its PBAS calls to letters, and checks neither against the other. Then which
 * value scores which call is unknown.
 */
function qualityGapOf(chrom: ChromatogramData): string | null {
  const q = chrom.phredScores?.length ?? 0;
  if (q === 0) return NO_QUALITY_VALUES;
  const n = chrom.baseCalls.length;
  return q === n ? null : `${counted(q, 'quality value')} for ${counted(n, 'base call')}`;
}

/**
 * Whether the Mott trim at `cutoff` finds a high-quality region in this read. The trim keeps none
 * of the read when no stretch of bases scores above zero (the empty interval 1..0, BG-01M6RPCA),
 * and every base of it, untrimmed, when the read has no quality value for every call. A stretch
 * scores above zero (its score is the sum of cutoff - P(err)) exactly when some base's error
 * probability is below the cutoff. The report's expected errors cannot tell instead: they are
 * rounded to 0.01.
 */
function hqRegionOf(chrom: ChromatogramData, cutoff: number): 'region' | 'none' | 'no-quality' {
  if (qualityGapOf(chrom) !== null) return 'no-quality';
  return chrom.phredScores.some((v) => 10 ** (-v / 10) < cutoff) ? 'region' : 'none';
}

/**
 * Mixed IUPAC double peaks over the whole read, the total every surface states. The viewport lists
 * only the first 32 of them (`compute_chromatogram_viewport`), and the trim counts them inside the
 * region it keeps, which with no high-quality region is empty, so it counts none (BG-01M6RPCA).
 * Scored Q93 at every call, a read's error probability (5e-10)
 * is below every cutoff the engine accepts (it clamps them to 0.001 and up), so every base scores
 * above zero and the trim keeps the whole read.
 */
function wholeReadMixedPeaksOf(chrom: ChromatogramData): number {
  const errorFree = { ...chrom, phredScores: new Array<number>(chrom.baseCalls.length).fill(93) };
  return trimSangerTraceMottPhredRust(errorFree, VIEWPORT_HQ_CUTOFF).heterozygoteCount;
}

interface ChromatogramAndContigStudioProps {
  documents: SequenceDocument[];
  activeDoc?: SequenceDocument;
  selectedDocuments?: SequenceDocument[];
  onCreateDocument?: (newDoc: SequenceDocument) => void;
}

export const ChromatogramAndContigStudio: React.FC<ChromatogramAndContigStudioProps> = ({
  documents,
  activeDoc,
  selectedDocuments = [],
  onCreateDocument,
}) => {
  const dnaDocs = useMemo(() => documents.filter((doc) => doc.moleculeType === 'DNA' && hasBiologicalSequence(doc)), [documents]);
  const traceDocs = useMemo(() => dnaDocs.filter((doc) => doc.chromatogram !== undefined), [dnaDocs]);
  const initialRead = activeDoc && dnaDocs.some((doc) => doc.id === activeDoc.id) ? activeDoc : traceDocs[0] ?? dnaDocs[0];
  const [selectedReadId, setSelectedReadId] = useState(initialRead?.id ?? '');
  const [selectedRefId, setSelectedRefId] = useState('');
  const [baseOffset, setBaseOffset] = useState(0);
  const [assemblyRequested, setAssemblyRequested] = useState(false);
  const selectionKey = selectedDocuments.map((doc) => doc.id + ':' + doc.updatedAt).join('|');
  useEffect(() => { setAssemblyRequested(false); }, [selectionKey]);

  // Trace display options (Trace | Parameters | Raw, Standard | Autoscaled, Shading, Bases Above, Quality Values, Thin Lines)
  const [traceSubTab, setTraceSubTab] = useState<'processed' | 'parameters' | 'raw'>('processed');
  const [heightScaleMode, setHeightScaleMode] = useState<'standard' | 'autoscaled'>('autoscaled');
  const [fullHeightView, setFullHeightView] = useState<boolean>(false);
  const [showShading, setShowShading] = useState<boolean>(true);
  const [showBasesAbove, setShowBasesAbove] = useState<boolean>(true);
  const [showQualityNumbers, setShowQualityNumbers] = useState<boolean>(true);
  const [thinLines, setThinLines] = useState<boolean>(false);
  const [verticalScale, setVerticalScale] = useState<number>(1.0);
  const [mottErrorCutoff, setMottErrorCutoff] = useState<number>(0.05);
  const [poaTrimHq, setPoaTrimHq] = useState<boolean>(true);
  const [channelVisible, setChannelVisible] = useState<{ A: boolean; C: boolean; G: boolean; T: boolean }>({
    A: true,
    C: true,
    G: true,
    T: true,
  });
  const [openTracePanels, setOpenTracePanels] = useState<Record<string, boolean>>({
    general: true,
    display: false,
    channels: false,
    trimming: false,
    assembly: false,
    stats: false,
  });
  const toggleTracePanel = (key: string) =>
    setOpenTracePanels((prev) => ({ ...prev, [key]: !prev[key] }));
  // In the workbench the view controls are sections of App's shared inspector, and the studio
  // draws no aside of its own (US-01M6TA87); drawn on its own it keeps its aside.
  const inWorkbench = useInWorkbench();

  const readDoc = useMemo(
    () => dnaDocs.find((d) => d.id === selectedReadId) ?? initialRead ?? EMPTY_WORKSPACE_DOCUMENT,
    [dnaDocs, initialRead, selectedReadId]
  );
  const refDoc = useMemo(
    () => dnaDocs.find((d) => d.id === selectedRefId && d.id !== readDoc.id),
    [dnaDocs, selectedRefId, readDoc.id]
  );

  const mappingResult = useMemo(
    () => refDoc ? mapReadAndCallVariants(refDoc, readDoc) : null,
    [refDoc, readDoc]
  );

  const chrom = readDoc.chromatogram;
  // FASTQ / SAM reads keep base calls and Phred qualities in a chromatogram with no trace channels
  const hasTraces = Boolean(chrom && (chrom.traceA.length || chrom.traceC.length || chrom.traceG.length || chrom.traceT.length));
  const isNgsRead = Boolean(chrom) && !hasTraces;
  const WINDOW_BASES = 45;

  const svgHeight = fullHeightView ? 344 : 248;
  const baselineY = showBasesAbove ? svgHeight - 20 : svgHeight - 48;
  const maxPeakHeight = fullHeightView ? 236 : 142;

  const viewportReport = useMemo(() => {
    if (!chrom) return null;
    return computeChromatogramViewportRust(
      chrom,
      baseOffset,
      WINDOW_BASES,
      traceSubTab === 'raw',
      heightScaleMode === 'autoscaled',
      verticalScale,
      baselineY,
      maxPeakHeight
    );
  }, [
    chrom,
    baseOffset,
    traceSubTab,
    heightScaleMode,
    verticalScale,
    baselineY,
    maxPeakHeight,
  ]);

  const mottTrimReport = useMemo(() => {
    if (!chrom) return null;
    return trimSangerTraceMottPhredRust(chrom, mottErrorCutoff);
  }, [chrom, mottErrorCutoff]);
  // Why the read's quality values cannot be used, or null when every call has one.
  const qualityGap = chrom ? qualityGapOf(chrom) : null;
  // The same in a table cell, which says it short, and also for a read with no chromatogram.
  const cellQualityGap = !chrom || qualityGap === NO_QUALITY_VALUES ? NO_QUALITY_VALUES_SHORT : qualityGap;
  // The report's cutoff is the one the trim ran at (the engine clamps it).
  const mottHq = chrom && mottTrimReport ? hqRegionOf(chrom, mottTrimReport.errorProbabilityCutoff) : 'no-quality';
  // A read the trim cannot score (no quality values, or not one per call) is not trimmed at all. One
  // it scores with no base better than the cutoff is trimmed, to nothing.
  const mottUnscored = mottHq === 'no-quality';
  // Bases kept by the trim: none when it found no high-quality region.
  const mottKeptBp = mottHq === 'region' && mottTrimReport ? mottTrimReport.trimmedLengthBp : 0;
  // The read's mixed-peak total, stated on every surface in place of the length of the capped list.
  const mixedPeakTotal = useMemo(() => (chrom ? wholeReadMixedPeaksOf(chrom) : 0), [chrom]);
  // The viewport's HQ window is the same trim at its own fixed cutoff.
  const viewportHq = chrom ? hqRegionOf(chrom, VIEWPORT_HQ_CUTOFF) : 'no-quality';
  /** What a trim surface shows in place of coordinates when there is no high-quality region. */
  const noHqRegionText = (hq: 'none' | 'no-quality') => (hq === 'none' ? NO_HQ_REGION : qualityGap ?? NO_QUALITY_VALUES);

  const poaCandidateDocs = useMemo(() => selectedDocuments.filter((doc) =>
    doc.moleculeType === 'DNA' && hasBiologicalSequence(doc) &&
    (doc.chromatogram || doc.documentKind === 'trace')), [selectedDocuments]);

  // Every ticked trace goes to the assembler whole. The engine names each read it leaves out or
  // cuts in `warnings` (a read the pre-trim keeps nothing of, one past its per-read length bound,
  // reads it could not place in one overlap layout with the others), shown beside the contig and
  // kept in the saved contig's notes (BG-01M6S17N, BG-01M6SQ2Y).
  const poaContigReport = useMemo((): (PoaContigAssemblyReport & { warnings?: string[] }) | null => {
    if (!assemblyRequested || poaCandidateDocs.length < 2) return null;
    return assembleSangerContigPoaRust(
      poaCandidateDocs.map((d) => ({
        id: d.id,
        name: d.name,
        sequence: d.sequence,
        phredScores: d.chromatogram?.phredScores,
      })),
      `${readDoc.name}_POA_Contig`,
      poaTrimHq
    );
  }, [poaCandidateDocs, readDoc.name, poaTrimHq, assemblyRequested]);
  /** How many of the ticked reads the contig was built from: "8 reads", or "8 of 9 reads" when it left some out. */
  const poaReadsUsed = !poaContigReport ? ''
    : poaContigReport.readCount < poaCandidateDocs.length
      ? `${poaContigReport.readCount} of ${counted(poaCandidateDocs.length, 'read')}`
      : counted(poaContigReport.readCount, 'read');

  // Whole-read quality horizon, mirroring the Sequence view's coordinate scrubber so the
  // chromatogram window can be moved by clicking the read rather than only by the slider.
  const HORIZON_BUCKETS = 240;
  const qualityHorizon = useMemo(() => {
    const scores = chrom?.phredScores;
    if (!scores || scores.length === 0) return [] as number[];
    const n = scores.length;
    const buckets = Math.min(HORIZON_BUCKETS, n);
    return Array.from({ length: buckets }, (_, i) => {
      const from = Math.floor((i * n) / buckets);
      const to = Math.max(from + 1, Math.floor(((i + 1) * n) / buckets));
      let sum = 0;
      for (let k = from; k < to; k++) sum += scores[k] ?? 0;
      return sum / (to - from);
    });
  }, [chrom]);

  const readLength = readDoc.sequence.length;
  const maxOffset = Math.max(0, readLength - WINDOW_BASES);
  const windowEnd = Math.min(readLength, baseOffset + WINDOW_BASES);
  const jumpToBase = (base1: number) => setBaseOffset(Math.max(0, Math.min(maxOffset, base1 - 1)));
  const firstMixedPeak = viewportReport?.heterozygotePeaks[0];
  // The peak table holds the viewport's list, which stops at 32: name the cap when it cuts the list short.
  const listedPeaks = viewportReport?.heterozygotePeaks.length ?? 0;
  const peakListCap = listedPeaks < mixedPeakTotal ? `first ${listedPeaks} of ${mixedPeakTotal}` : null;
  const hasQuality = Boolean(viewportReport) && qualityGap === null;

  /**
   * Run assembly preview, the contig assembly's primary action. In the workbench it stays on the
   * canvas beside the contig result while its settings move into the inspector (D0063 ruling c);
   * drawn on its own the studio keeps it in its aside's Contig Assembly section.
   */
  const runAssemblyButton = () => (
    <button
      type="button"
      className="btn-primary-sm"
      disabled={poaCandidateDocs.length < 2}
      onClick={() => setAssemblyRequested(true)}
    >
      Run assembly preview
    </button>
  );

  /** The read and reference pickers, the trace source and scaling, and the window start. */
  const generalControls = () => (
    <>
      <div className="mbc-control-row">
        <span>Sequencing Read (.ab1 / FASTQ):</span>
        <select
          value={selectedReadId}
          onChange={(e) => { setSelectedReadId(e.target.value); setBaseOffset(0); }}
        >
          {dnaDocs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.chromatogram ? '[4-Dye AB1 Trace]' : '[FASTA/Seq]'}
            </option>
          ))}
        </select>
      </div>
      <div className="mbc-control-row">
        <span>Reference Plasmid / Template:</span>
        <select value={selectedRefId} onChange={(e) => setSelectedRefId(e.target.value)}>
          <option value="">Choose a reference to compare…</option>
          {dnaDocs.filter((doc) => doc.id !== readDoc.id).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.sequence.length} bp)
            </option>
          ))}
        </select>
      </div>
      {hasTraces && (
        <>
          <div className="mbc-control-row">
            <span>Trace Source:</span>
            <div className="prefs-segmented-pair" role="group" aria-label="Trace view mode">
              <button
                type="button"
                className={`prefs-seg-btn ${traceSubTab === 'processed' ? 'active' : ''}`}
                onClick={() => setTraceSubTab('processed')}
              >
                Trace
              </button>
              <button
                type="button"
                className={`prefs-seg-btn ${traceSubTab === 'parameters' ? 'active' : ''}`}
                onClick={() => setTraceSubTab('parameters')}
              >
                Parameters
              </button>
              <button
                type="button"
                className={`prefs-seg-btn ${traceSubTab === 'raw' ? 'active' : ''}`}
                onClick={() => setTraceSubTab('raw')}
                title="Processed trace with a baseline offset; raw ABIF DATA channels are not imported"
              >
                Baseline View
              </button>
            </div>
          </div>
          <div className="mbc-control-row">
            <span>Peak Height Scaling:</span>
            <div className="prefs-segmented-pair" role="group" aria-label="Peak height scaling">
              <button
                type="button"
                className={`prefs-seg-btn ${heightScaleMode === 'standard' ? 'active' : ''}`}
                onClick={() => setHeightScaleMode('standard')}
              >
                Standard
              </button>
              <button
                type="button"
                className={`prefs-seg-btn ${heightScaleMode === 'autoscaled' ? 'active' : ''}`}
                onClick={() => setHeightScaleMode('autoscaled')}
              >
                Autoscaled
              </button>
            </div>
          </div>
        </>
      )}
      <div className="mbc-control-row">
        <span>Window Start Base ({baseOffset + 1}):</span>
        <input
          type="range"
          min={0}
          max={maxOffset}
          value={baseOffset}
          onChange={(e) => setBaseOffset(Number(e.target.value))}
        />
      </div>
    </>
  );

  /** What the trace draws, and its Y-Gain. */
  const displayControls = () => (
    <>
      <label className="mbc-check-row">
        <input type="checkbox" checked={fullHeightView} onChange={(e) => setFullHeightView(e.target.checked)} />
        <span>View Full Height</span>
      </label>
      <label className="mbc-check-row">
        <input type="checkbox" checked={showShading} onChange={(e) => setShowShading(e.target.checked)} />
        <span>Shading (Filled Peaks)</span>
      </label>
      <label className="mbc-check-row">
        <input type="checkbox" checked={showBasesAbove} onChange={(e) => setShowBasesAbove(e.target.checked)} />
        <span>Show Bases Above</span>
      </label>
      <label className="mbc-check-row">
        <input type="checkbox" checked={showQualityNumbers} onChange={(e) => setShowQualityNumbers(e.target.checked)} />
        <span>Show Quality Values (Q)</span>
      </label>
      <label className="mbc-check-row">
        <input type="checkbox" checked={thinLines} onChange={(e) => setThinLines(e.target.checked)} />
        <span>Thin Lines</span>
      </label>
      <div className="mbc-control-row">
        <span>Y-Gain ({verticalScale.toFixed(1)}×):</span>
        <input
          type="range"
          min={0.5}
          max={2.2}
          step={0.1}
          value={verticalScale}
          onChange={(e) => setVerticalScale(Number(e.target.value))}
        />
      </div>
    </>
  );

  /** Which of the four dyes the trace draws. */
  const channelControls = () => (
    <>
      <div className="mbc-trace-channel-row">
        {(['A', 'C', 'G', 'T'] as const).map((ch) => {
          const col = BASE_COLOR[ch];
          return (
            <button
              key={ch}
              type="button"
              className="btn-secondary-sm mbc-trace-channel-btn"
              aria-pressed={channelVisible[ch]}
              style={{
                color: channelVisible[ch] ? 'var(--mbc-bg-canvas)' : col,
                background: channelVisible[ch] ? col : 'var(--mbc-bg-canvas)',
                borderColor: col,
              }}
              onClick={() => setChannelVisible((prev) => ({ ...prev, [ch]: !prev[ch] }))}
            >
              {ch}
            </button>
          );
        })}
      </div>
      <p className="mbc-accordion-note">Hidden channels are removed from both the curves and their shading.</p>
    </>
  );

  /** The Mott trim cutoff and the region it keeps. */
  const trimmingControls = () => (
    <>
      <div className="mbc-control-row">
        <span>Error Cutoff P(err):</span>
        <select value={String(mottErrorCutoff)} onChange={(e) => setMottErrorCutoff(Number(e.target.value))}>
          <option value="0.1">0.10 (Q10 Relaxed)</option>
          <option value="0.05">0.05 (Q13 Standard)</option>
          <option value="0.01">0.01 (Q20 High-Accuracy)</option>
          <option value="0.005">0.005 (Q23 Ultra-Clean)</option>
        </select>
      </div>
      {mottTrimReport ? (
        <div className="mbc-accordion-body stats-list" style={{ padding: 0 }}>
          <div className="stat-kv">
            <span>HQ Window</span>
            <strong>
              {mottHq === 'region'
                ? `${mottTrimReport.trimStart1based}..${mottTrimReport.trimEnd1based}`
                : noHqRegionText(mottHq)}
            </strong>
          </div>
          <div className="stat-kv">
            <span>Trimmed Length</span>
            <strong>{mottUnscored ? NOT_TRIMMED : `${mottKeptBp} / ${mottTrimReport.rawLengthBp} bp`}</strong>
          </div>
        </div>
      ) : (
        <p className="mbc-accordion-note">{NO_QUALITY_VALUES_SHORT}, so there is nothing to trim.</p>
      )}
    </>
  );

  /** The assembly input and its pre-trim; Run assembly preview sits here only on its own. */
  const assemblyControls = () => (
    <>
      <p className="mbc-accordion-note">
        {poaCandidateDocs.length} DNA {poaCandidateDocs.length === 1 ? 'trace' : 'traces'} selected in the project
        table. Select at least two. The assembly uses every selected trace, and the result names
        each read it left out or cut.
      </p>
      <label className="mbc-check-row">
        <input type="checkbox" checked={poaTrimHq} onChange={(e) => setPoaTrimHq(e.target.checked)} />
        <span>Pre-trim reads (Mott quality trimming)</span>
      </label>
      {!inWorkbench && runAssemblyButton()}
    </>
  );

  /** The read's quality figures. */
  const statisticsControls = () => (
    <>
      <div className="stat-kv">
        <span>Called Bases</span>
        <strong>{readLength.toLocaleString()}</strong>
      </div>
      {viewportReport && hasQuality ? (
        <>
          <div className="stat-kv">
            <span>Mean Phred</span>
            <strong>Q{viewportReport.meanPhred.toFixed(1)}</strong>
          </div>
          <div className="stat-kv">
            <span>Q20 / Q30</span>
            <strong>{viewportReport.q20Pct.toFixed(1)}% / {viewportReport.q30Pct.toFixed(1)}%</strong>
          </div>
          <div className="stat-kv">
            <span>HQ Trim Window ({VIEWPORT_HQ_CUTOFF_LABEL})</span>
            <strong>
              {viewportHq === 'region'
                ? `${viewportReport.hqTrimStart1based}..${viewportReport.hqTrimEnd1based}`
                : noHqRegionText(viewportHq)}
            </strong>
          </div>
        </>
      ) : (
        <div className="stat-kv">
          <span>Per-Base Quality</span>
          <strong>{qualityGap ?? NO_QUALITY_VALUES_SHORT}</strong>
        </div>
      )}
      {viewportReport && (
        <>
          <div className="stat-kv">
            <span>Signal / Noise</span>
            <strong>{viewportReport.signalToNoiseRatio.toFixed(1)}×</strong>
          </div>
          <div className="stat-kv">
            <span>Mixed IUPAC Peaks</span>
            <strong>{mixedPeakTotal}</strong>
          </div>
        </>
      )}
    </>
  );

  /**
   * One group of the view controls, unfolded or folded by the studio's own open state. Drawn on its
   * own, the studio draws it as a section of its aside. In the workbench it is a section of App's
   * shared inspector (US-01M6TA87), drawn there while the inspector is open; the state stays the
   * studio's, so each section keeps its open state and its values while the inspector is closed.
   */
  const traceSection = (key: string, title: string, order: number, controls: () => React.ReactNode, bodyClass?: string) => {
    const open = Boolean(openTracePanels[key]);
    if (inWorkbench) {
      return (
        <InspectorSection
          title={title}
          order={order}
          open={open}
          onOpenChange={(next) => setOpenTracePanels((prev) => ({ ...prev, [key]: next }))}
        >
          {open && (bodyClass ? (
            <div className={`mbc-accordion-body ${bodyClass}`} style={{ padding: 0 }}>{controls()}</div>
          ) : controls())}
        </InspectorSection>
      );
    }
    return (
      <div className="mbc-accordion-section">
        <button
          type="button"
          className="mbc-accordion-header"
          aria-expanded={open}
          onClick={() => toggleTracePanel(key)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
        </button>
        {open && (
          <div className={bodyClass ? `mbc-accordion-body ${bodyClass}` : 'mbc-accordion-body'}>
            {controls()}
          </div>
        )}
      </div>
    );
  };

  /** The groups (Trace Channels only for a read with trace channels), in the order the aside and the inspector show them. */
  const traceSections = () => (
    <>
      {traceSection('general', 'General & Layout', 1, generalControls)}
      {traceSection('display', 'Display & Color Scheme', 2, displayControls)}
      {hasTraces && traceSection('channels', 'Trace Channels (4-Dye)', 3, channelControls)}
      {traceSection('trimming', 'Quality Trimming', 4, trimmingControls)}
      {traceSection('assembly', 'Contig Assembly', 5, assemblyControls)}
      {traceSection('stats', 'Trace Statistics', 6, statisticsControls, 'stats-list')}
    </>
  );

  return (
    <div className={`chromatogram-studio-wrapper ${inWorkbench ? 'in-workbench' : 'has-trace-inspector'}`}>
      <div className="chromatogram-studio-main">
        {/* Trace telemetry cockpit — the same two-row shell the Sequence view uses. */}
        <section className="mbc-cockpit-bar" aria-label="Sanger Trace Quality & Window Telemetry Cockpit">
          <div className="mbc-cockpit-row-top">
            <span className="mbc-cockpit-scale-badge" title="Called read length">
              {readLength.toLocaleString()} bp {hasTraces ? 'Sanger Trace' : isNgsRead ? 'NGS Read' : 'Sequence'}
            </span>

            <svg
              viewBox="0 0 1000 22"
              preserveAspectRatio="none"
              className="mbc-cockpit-horizon-svg"
              role="slider"
              tabIndex={0}
              aria-label="Trace quality horizon — click, or use Left/Right arrows, to move the chromatogram window"
              aria-valuemin={1}
              aria-valuemax={Math.max(1, readLength)}
              aria-valuenow={baseOffset + 1}
              aria-valuetext={`Window ${baseOffset + 1} to ${windowEnd} of ${readLength} bases`}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                if (box.width === 0) return;
                jumpToBase(Math.round(((e.clientX - box.left) / box.width) * readLength) - Math.floor(WINDOW_BASES / 2));
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setBaseOffset((o) => Math.max(0, o - WINDOW_BASES));
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setBaseOffset((o) => Math.min(maxOffset, o + WINDOW_BASES));
                }
              }}
            >
              <rect x={0} y={0} width={1000} height={22} rx={3} fill="var(--mbc-bg-canvas)" />
              {qualityHorizon.map((q, i) => {
                const w = 1000 / qualityHorizon.length;
                const h = Math.max(1.5, Math.min(20, (q / 60) * 20));
                return (
                  <rect
                    key={i}
                    x={i * w}
                    y={21 - h}
                    width={Math.max(0.8, w - 0.3)}
                    height={h}
                    fill={q >= 30 ? 'rgba(26, 115, 232, 0.55)' : q >= 20 ? 'rgba(227, 116, 0, 0.55)' : 'rgba(217, 48, 37, 0.6)'}
                  />
                );
              })}
              {viewportReport && viewportHq === 'region' && readLength > 0 && (
                <rect
                  x={((viewportReport.hqTrimStart1based - 1) / readLength) * 1000}
                  y={0.8}
                  width={Math.max(2, ((viewportReport.hqTrimEnd1based - viewportReport.hqTrimStart1based + 1) / readLength) * 1000)}
                  height={20.4}
                  fill="none"
                  stroke="rgba(0, 158, 115, 0.85)"
                  strokeWidth={1.2}
                  rx={2}
                >
                  <title>{`High-quality trim window ${viewportReport.hqTrimStart1based}..${viewportReport.hqTrimEnd1based} bp (${VIEWPORT_HQ_CUTOFF_LABEL})`}</title>
                </rect>
              )}
              {readLength > 0 && (
                <rect
                  x={(baseOffset / readLength) * 1000}
                  y={0}
                  width={Math.max(3, (WINDOW_BASES / readLength) * 1000)}
                  height={22}
                  fill="rgba(0, 114, 178, 0.22)"
                  stroke="#0072B2"
                  strokeWidth={1.6}
                  rx={2}
                />
              )}
            </svg>

            {readDoc.history && readDoc.history.length > 0 && (
              <span className="mbc-cockpit-provenance" title="Most recent recorded operation on this read">
                <strong>Provenance:</strong>
                <span>
                  {readDoc.history[readDoc.history.length - 1].operation} ({readDoc.history.length}{' '}
                  {readDoc.history.length === 1 ? 'step' : 'steps'})
                </span>
              </span>
            )}
          </div>

          <div className="mbc-cockpit-row-bottom">
            <div className="mbc-cockpit-telemetry-group">
              <span className="mbc-cockpit-span-readout">
                <strong>Window:</strong> {readLength === 0 ? '—' : `${baseOffset + 1}..${windowEnd} of ${readLength.toLocaleString()} bp`}
              </span>
              {viewportReport ? (
                hasQuality ? (
                  <>
                    <span title="Mean Phred quality over the whole read">
                      <strong>Mean Q:</strong> Q{viewportReport.meanPhred.toFixed(1)}
                    </span>
                    <span title="Share of bases at or above Q20 and Q30">
                      <strong>Q20 / Q30:</strong> {viewportReport.q20Pct.toFixed(1)}% / {viewportReport.q30Pct.toFixed(1)}%
                    </span>
                    <span title="High-quality trim window">
                      <strong>HQ Window ({VIEWPORT_HQ_CUTOFF_LABEL}):</strong>{' '}
                      {viewportHq === 'region'
                        ? `${viewportReport.hqTrimStart1based}..${viewportReport.hqTrimEnd1based} bp`
                        : noHqRegionText(viewportHq)}
                    </span>
                  </>
                ) : (
                  <span title="Per-base quality values">
                    <strong>Quality:</strong> {qualityGap}
                  </span>
                )
              ) : (
                <span>
                  <strong>Quality:</strong> FASTA reference (no trace)
                </span>
              )}
              {viewportReport && hasTraces && (
                <>
                  <span title="Peak signal against baseline noise">
                    <strong>S/N:</strong> {viewportReport.signalToNoiseRatio.toFixed(1)}×
                  </span>
                  <span title="Mixed IUPAC double peaks called across the read">
                    <strong>Mixed Peaks:</strong> {mixedPeakTotal}
                  </span>
                </>
              )}
              {refDoc && (
                <span title="Reference currently compared against this read">
                  <strong>Reference:</strong> {refDoc.name}
                </span>
              )}
            </div>

            <div className="mbc-cockpit-actions">
              {viewportReport && (
                <button
                  type="button"
                  className="btn-secondary-sm mbc-cockpit-action-btn"
                  disabled={viewportHq !== 'region'}
                  onClick={() => jumpToBase(viewportReport.hqTrimStart1based)}
                  title={viewportHq === 'region'
                    ? 'Move the chromatogram window to the start of the high-quality region'
                    : viewportHq === 'none'
                    ? `${NO_HQ_REGION}: no stretch of bases is better than the ${VIEWPORT_HQ_CUTOFF_LABEL}`
                    : `${noHqRegionText(viewportHq)}, so the read has no high-quality region`}
                >
                  Jump to HQ Start
                </button>
              )}
              {firstMixedPeak && (
                <button
                  type="button"
                  className="btn-secondary-sm mbc-cockpit-action-btn"
                  onClick={() => jumpToBase(firstMixedPeak.position1based - 20)}
                  title={`First mixed IUPAC call at bp ${firstMixedPeak.position1based}`}
                >
                  First Mixed Peak
                </button>
              )}
              <button
                type="button"
                className="btn-secondary-sm mbc-cockpit-action-btn"
                onClick={() => setBaseOffset(0)}
                title="Move the chromatogram window to the first called base"
              >
                Read Start
              </button>
              <button
                type="button"
                className="btn-secondary-sm mbc-cockpit-action-btn"
                onClick={() => setBaseOffset(maxOffset)}
                title="Move the chromatogram window to the last called bases"
              >
                Read End
              </button>
            </div>
          </div>
        </section>

        <div className="studio-card">
          <div className="studio-card-header">
            <h3>
              {hasTraces ? 'Chromatogram' : 'Sequencing Read'} — {readDoc.name}
            </h3>
            <span className="badge-accent">
              {isNgsRead
                ? 'Base calls & Phred qualities (FASTQ / SAM carry no trace channels)'
                : traceSubTab === 'processed'
                ? 'Trace channels & quality scores'
                : traceSubTab === 'parameters'
                ? 'ABIF run & electrophoresis parameters'
                : 'Processed trace with baseline offset (raw ABIF DATA channels are not imported)'}
            </span>
          </div>

        {isNgsRead && chrom ? (
          <div className="trace-canvas-box" data-mbc-figure>
              <div className="studio-card-header" style={{ paddingTop: 0 }}>
                <h4>{hasTraces ? 'Trace' : 'Read Quality'} — bases {baseOffset + 1}..{windowEnd}</h4>
                <FigureExportButton
                  compact
                  baseName={`${readDoc.name} — ${hasTraces ? 'Chromatogram' : 'Read Quality'}`}
                  title={`${readDoc.name} — bases ${baseOffset + 1}..${windowEnd}`}
                  table={{
                    headers: ['Base position', 'Call', 'Phred quality'],
                    rows: Array.from({ length: Math.max(0, windowEnd - baseOffset) }, (_, i) => {
                      const at = baseOffset + i;
                      return [
                        String(at + 1),
                        (chrom?.baseCalls ?? readDoc.sequence)[at] ?? '',
                        String(chrom?.phredScores?.[at] ?? ''),
                      ];
                    }),
                    caption: `${readDoc.name} — bases ${baseOffset + 1}..${windowEnd} of ${readLength}`,
                  }}
                />
              </div>
            {/* Per-base Phred quality strip for reads without trace channels (Q0-45 scale,
                Q20 and Q30 guides; the same base palette as the trace view). */}
            <svg viewBox="0 0 830 150" className="chromatogram-svg" role="img" aria-label={`Phred quality of bases ${baseOffset + 1} to ${windowEnd}`}>
              <rect x="0" y="0" width="830" height="150" rx="6" fill="var(--mbc-bg-canvas)" stroke="var(--mbc-border)" />
              {[20, 30, 40].map((q) => {
                const y = 100 - (q / 45) * 84;
                return (
                  <g key={q}>
                    <line x1="25" x2="805" y1={y} y2={y} stroke="var(--mbc-border)" strokeDasharray="3 3" />
                    <text x="20" y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--mbc-text-muted)">Q{q}</text>
                  </g>
                );
              })}
              <line x1="25" x2="805" y1="100" y2="100" stroke="var(--mbc-border)" />
              {Array.from({ length: WINDOW_BASES }, (_, idx) => {
                const baseIdx = baseOffset + idx;
                if (baseIdx >= chrom.baseCalls.length) return null;
                const base = chrom.baseCalls[baseIdx];
                const phred: number | undefined = chrom.phredScores[baseIdx];
                const x = 25 + ((idx + 0.5) / WINDOW_BASES) * 780;
                const h = phred === undefined ? 0 : (Math.min(45, phred) / 45) * 84;
                const color = baseColor(base);
                return (
                  <g key={baseIdx}>
                    {phred !== undefined && (
                      <rect x={x - 6} y={100 - h} width={12} height={h} rx="1.5"
                        fill={qualityColor(phred)}>
                        <title>{`${base}${baseIdx + 1}: Q${phred}`}</title>
                      </rect>
                    )}
                    <text x={x} y="117" textAnchor="middle" fill={color} fontSize="12.5" fontWeight="700">{base}</text>
                    {baseIdx % 5 === 0 && (
                      <text x={x} y="133" textAnchor="middle" fill="var(--mbc-text-secondary)" fontSize="10.5">{baseIdx + 1}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        ) : traceSubTab === 'parameters' ? (
          <div className="cloning-result-box" style={{ marginBottom: 10 }}>
            <div className="result-headline" style={{ marginBottom: 8 }}>
              <strong>ABIF (.ab1) Run &amp; Electrophoresis Parameters — {readDoc.name}</strong>
            </div>
            <div className="form-grid-3col" style={{ fontSize: 12 }}>
              <div>
                {/* These rows used to show fixed values (3730xl, KB 1.4.1.8,
                    8.5 kV, 60 °C) for every file; the importer does not read
                    the ABIF run metadata, so nothing is claimed here. */}
                <strong>Instrument, basecaller &amp; run conditions:</strong> not read from this file
              </div>
              <div>
                <strong>Read Length:</strong> {readDoc.sequence.length.toLocaleString()} bases called
              </div>
              <div>
                <strong>Mean Phred Quality &amp; SNR:</strong>{' '}
                {viewportReport
                  ? qualityGap !== null
                    ? `${qualityGap} • SNR ${viewportReport.signalToNoiseRatio.toFixed(1)}`
                    : `Q${viewportReport.meanPhred.toFixed(1)} • Q20 ${viewportReport.q20Pct.toFixed(1)}% • Q30 ${viewportReport.q30Pct.toFixed(1)}% • SNR ${viewportReport.signalToNoiseRatio.toFixed(1)}`
                  : 'FASTA Reference'}
              </div>
              <div>
                <strong>HQ Trim Range ({VIEWPORT_HQ_CUTOFF_LABEL}) &amp; Heterozygote Peaks:</strong>{' '}
                {viewportReport
                  ? `${viewportHq === 'region'
                    ? `${viewportReport.hqTrimStart1based}..${viewportReport.hqTrimEnd1based} bp`
                    : noHqRegionText(viewportHq)} • ${mixedPeakTotal} mixed IUPAC call(s)`
                  : 'N/A'}
              </div>
            </div>
          </div>
        ) : chrom && viewportReport ? (
          <div className="trace-canvas-box" data-mbc-figure>
              <div className="studio-card-header" style={{ paddingTop: 0 }}>
                <h4>{hasTraces ? 'Trace' : 'Read Quality'} — bases {baseOffset + 1}..{windowEnd}</h4>
                <FigureExportButton
                  compact
                  baseName={`${readDoc.name} — ${hasTraces ? 'Chromatogram' : 'Read Quality'}`}
                  title={`${readDoc.name} — bases ${baseOffset + 1}..${windowEnd}`}
                  table={{
                    headers: ['Base position', 'Call', 'Phred quality'],
                    rows: Array.from({ length: Math.max(0, windowEnd - baseOffset) }, (_, i) => {
                      const at = baseOffset + i;
                      return [
                        String(at + 1),
                        (chrom?.baseCalls ?? readDoc.sequence)[at] ?? '',
                        String(chrom?.phredScores?.[at] ?? ''),
                      ];
                    }),
                    caption: `${readDoc.name} — bases ${baseOffset + 1}..${windowEnd} of ${readLength}`,
                  }}
                />
              </div>
            <svg viewBox={`0 0 830 ${svgHeight}`} className="chromatogram-svg">
              <rect x="0" y="0" width="830" height={svgHeight} rx="6" fill="var(--mbc-bg-canvas)" stroke="var(--mbc-border)" />

              {/* Phred Quality Score Bars & Base Calls (Google Core Four Fluorescence Palette) */}
              {Array.from({ length: WINDOW_BASES }, (_, idx) => {
                const baseIdx = baseOffset + idx;
                if (baseIdx >= chrom.baseCalls.length) return null;
                const base = chrom.baseCalls[baseIdx];
                // Missing qualities stay missing (some ABIF files carry no PCON tag).
                const phred: number | undefined = chrom.phredScores[baseIdx];
                // Bases sit at their recorded trace peaks, not on an even grid.
                const x = viewportReport.baseXPositions?.[idx] ?? 25 + ((idx + 0.5) / WINDOW_BASES) * 780;
                const qHeight = phred === undefined ? 0 : Math.min(24, (phred / 60) * 24);
                const color = baseColor(base);

                const baseTextY = showBasesAbove ? 49 : svgHeight - 24;
                const qBarBottomY = showBasesAbove ? 34 : 36;

                return (
                  <g key={baseIdx}>
                    {phred !== undefined && (
                      <rect
                        x={x - 5}
                        y={qBarBottomY - qHeight}
                        width={10}
                        height={qHeight}
                        fill={qualityColor(phred)}
                      />
                    )}
                    {showQualityNumbers && phred !== undefined && idx % 3 === 0 && (
                      <text
                        x={x}
                        y={Math.max(10, qBarBottomY - qHeight - 2)}
                        textAnchor="middle"
                        fill="var(--mbc-text-muted)"
                        fontSize="10"
                      >
                        {phred}
                      </text>
                    )}
                    <text
                      x={x}
                      y={baseTextY}
                      textAnchor="middle"
                      fill={color}
                      fontSize="12.5"
                      fontWeight="700"
                    >
                      {base}
                    </text>
                    {baseIdx % 5 === 0 && (
                      <text
                        x={x}
                        y={showBasesAbove ? 63 : svgHeight - 8}
                        textAnchor="middle"
                        fill="var(--mbc-text-secondary)"
                        fontSize="10.5"
                      >
                        {baseIdx + 1}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Optional Shading Under Peaks (Rust-Computed SVG Polygons) */}
              {showShading && channelVisible.A && (
                <path d={viewportReport.areaA} fill="rgba(30, 142, 62, 0.15)" stroke="none" />
              )}
              {showShading && channelVisible.C && (
                <path d={viewportReport.areaC} fill="rgba(26, 115, 232, 0.15)" stroke="none" />
              )}
              {showShading && channelVisible.G && (
                <path d={viewportReport.areaG} fill="rgba(227, 116, 0, 0.15)" stroke="none" />
              )}
              {showShading && channelVisible.T && (
                <path d={viewportReport.areaT} fill="rgba(217, 48, 37, 0.15)" stroke="none" />
              )}

              {/* 4-Channel Fluorescence Curves (Rust-Computed SVG Paths) */}
              {channelVisible.A && (
                <path
                  d={viewportReport.pathA}
                  fill="none"
                  stroke="var(--mbc-green)"
                  strokeWidth={thinLines ? '1.1' : '1.9'}
                />
              )}
              {channelVisible.C && (
                <path
                  d={viewportReport.pathC}
                  fill="none"
                  stroke="var(--mbc-blue)"
                  strokeWidth={thinLines ? '1.1' : '1.9'}
                />
              )}
              {channelVisible.G && (
                <path
                  d={viewportReport.pathG}
                  fill="none"
                  stroke="var(--mbc-amber)"
                  strokeWidth={thinLines ? '1.1' : '1.9'}
                />
              )}
              {channelVisible.T && (
                <path
                  d={viewportReport.pathT}
                  fill="none"
                  stroke="var(--mbc-red)"
                  strokeWidth={thinLines ? '1.1' : '1.9'}
                />
              )}
            </svg>
          </div>
        ) : (
          <div className="info-callout">
            Select a Sanger `.ab1` trace document (e.g., `eGFP_Clone3_Sanger_Fwd.ab1`) to inspect 4-channel capillary electropherogram peaks.
          </div>
        )}

        {/* Contig Reference Mapping & Variant Calling Summary */}
        {mappingResult && refDoc ? <div className="contig-variants-section">
          <h4>
            Contig Reference Mapping &amp; Automated Variant Caller ({readDoc.name} mapped onto{' '}
            {refDoc.name} @ bp {mappingResult.refStartPos})
          </h4>
          {mappingResult.variants.length === 0 ? (
            <div className="ok-banner">
              No differences reported in the analyzed alignment window.
            </div>
          ) : (
            <WorkbenchSmartTable
              tableId="chromatogram-contig-variants"
              tableLabel="Contig Variant Calls Table"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Reference Position</th>
                  <th>Trace Base</th>
                  <th>Variant Type</th>
                  <th>Reference Base</th>
                  <th>Called Base</th>
                  <th>Phred Q-Score</th>
                  <th>Biological Impact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {mappingResult.variants.map((v, idx) => {
                  // Variants are reported in reference coordinates; the trace viewport is
                  // indexed by read base, so map through the alignment the caller used.
                  const traceIdx = mapVariantRefPositionToReadIndex(
                    mappingResult,
                    readDoc.chromatogram?.baseCalls || readDoc.sequence,
                    v.position,
                    v.type
                  );
                  return (
                  <tr key={idx}>
                    <td>
                      <strong>bp {v.position}</strong>
                    </td>
                    <td className="mono-cell">{traceIdx === null ? '—' : `base ${traceIdx + 1}`}</td>
                    <td>
                      <span className="warn-tag">{v.type}</span>
                    </td>
                    <td className="mono-cell">{v.refBase}</td>
                    <td className="mono-cell">{v.altBase}</td>
                    <td>
                      {cellQualityGap !== null
                        ? cellQualityGap
                        : v.phredQuality > 0
                          ? `Q${v.phredQuality} (error p = ${Math.pow(10, -v.phredQuality / 10).toPrecision(2)})`
                          : 'Q0 (lowest confidence, or no score at this base)'}
                    </td>
                    <td>{v.codonImpact || 'Coding / Non-coding variant'}</td>
                    <td>
                      <button
                        className="btn-secondary-sm"
                        disabled={!chrom || traceIdx === null}
                        title={
                          !chrom
                            ? 'This read has no chromatogram trace'
                            : traceIdx === null
                              ? 'Reference position could not be mapped onto the read'
                              : `Show trace base ${traceIdx + 1}`
                        }
                        onClick={() => {
                          if (traceIdx !== null) jumpToBase(traceIdx + 1 - 20);
                        }}
                      >
                        Jump to Trace Peak
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </WorkbenchSmartTable>
          )}
        </div> : <p className="studio-panel-note">{`Choose a reference in the Chromatogram View Controls ${inWorkbench ? 'inspector' : 'sidebar'} to compare this read. No reference comparison has been run.`}</p>}

        {/* Mott PHREDProb Minimum-Error Trimming & Mixed-Peak Heterozygote Audit */}
        {chrom && mottTrimReport && (
          <div className="contig-variants-section mbc-studio-isolated-region" style={{ marginTop: 12 }}>
            <div className="studio-card-header" style={{ paddingTop: 0 }}>
              <h4>
                Quality trimming (Mott) &amp; mixed-peak IUPAC calls
              </h4>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge-accent">P(err) cutoff {mottErrorCutoff}</span>
                {!mottUnscored && mottKeptBp < MIN_READ_BP && (
                  <div
                    className="cloning-warning-note"
                    role="status"
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  >
                    <TriangleAlert size={14} aria-hidden="true" style={{ flex: 'none' }} />
                    <span>
                      {mottKeptBp} bp after trimming is too short to use as a read.
                    </span>
                  </div>
                )}
                {onCreateDocument && mottKeptBp > 0 && (
                  <button
                    type="button"
                    className={mottKeptBp < MIN_READ_BP ? 'btn-secondary-sm' : 'btn-primary-sm'}
                    onClick={() => {
                      const now = new Date().toISOString();
                      onCreateDocument({
                        id: `doc-mott-${Date.now()}`,
                        name: `${readDoc.name}_MottHQ_${mottTrimReport.trimStart1based}_${mottTrimReport.trimEnd1based}`,
                        accession: `${readDoc.accession || 'TRACE'}_HQ`,
                        description: `Mott PHREDProb trimmed read (${mottTrimReport.trimStart1based}..${mottTrimReport.trimEnd1based} bp, P_cut=${mottErrorCutoff}, mean Q${mottTrimReport.meanPhredTrimmed.toFixed(1)})`,
                        moleculeType: 'DNA',
                        topology: 'linear',
                        sequence: mottTrimReport.trimmedSequence,
                        folder: 'Contig Assembly',
                        documentKind: 'trace',
                        createdAt: now,
                        updatedAt: now,
                        features: [],
                        primers: [],
                        history: [
                          ...readDoc.history,
                          {
                            id: `h-mott-${Date.now()}`,
                            timestamp: now.slice(0, 16).replace('T', ' '),
                            operation: `Mott PHREDProb Trim (P=${mottErrorCutoff})`,
                            description: `Trimmed ${readDoc.name} to HQ window ${mottTrimReport.trimStart1based}..${mottTrimReport.trimEnd1based} (${mottTrimReport.trimmedLengthBp} bp)`,
                            parentIds: [readDoc.id],
                            lengthBp: mottTrimReport.trimmedLengthBp,
                            topology: 'linear',
                          },
                        ],
                      });
                    }}
                  >
                    + Save Mott-Trimmed HQ Read ({mottTrimReport.trimmedLengthBp} bp)
                  </button>
                )}
              </div>
            </div>

            <div className="thermo-kpi-grid">
              {mottHq === 'region' ? (
                <>
                  <div className="kpi-box">
                    <span className="kpi-label">HQ Trim Coordinates</span>
                    <strong className="kpi-val">
                      {mottTrimReport.trimStart1based}..{mottTrimReport.trimEnd1based} ({mottTrimReport.trimmedLengthBp} / {mottTrimReport.rawLengthBp} bp)
                    </strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Mean Trimmed Phred</span>
                    <strong className="kpi-val">Q{mottTrimReport.meanPhredTrimmed.toFixed(1)}</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Expected Base Errors</span>
                    <strong className="kpi-val">
                      {mottTrimReport.expectedErrorsTrimmed.toFixed(2)} (raw {mottTrimReport.expectedErrorsRaw.toFixed(2)})
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="kpi-box">
                    <span className="kpi-label">Trim Result</span>
                    <strong className="kpi-val">{mottUnscored ? NOT_TRIMMED : NO_HQ_REGION}</strong>
                  </div>
                  {mottUnscored && (
                    <div className="kpi-box">
                      <span className="kpi-label">Reason</span>
                      <strong className="kpi-val">{noHqRegionText(mottHq)}</strong>
                    </div>
                  )}
                  {mottHq === 'none' && (
                    <div className="kpi-box">
                      <span className="kpi-label">Expected Base Errors</span>
                      <strong className="kpi-val">
                        {mottTrimReport.expectedErrorsRaw.toFixed(2)} in {mottTrimReport.rawLengthBp} bp
                      </strong>
                    </div>
                  )}
                </>
              )}
              <div className="kpi-box">
                <span className="kpi-label">Mixed IUPAC Double Peaks</span>
                <strong className="kpi-val">
                  {mottHq === 'region'
                    ? `${mottTrimReport.heterozygoteCount} of ${mixedPeakTotal} in the trimmed region`
                    : `${mixedPeakTotal} over the whole read`}
                </strong>
              </div>
            </div>

            {viewportReport && viewportReport.heterozygotePeaks.length > 0 && peakListCap && (
              <p className="studio-panel-note">The table lists the {peakListCap} mixed peaks.</p>
            )}
            {viewportReport && viewportReport.heterozygotePeaks.length > 0 && (
              <WorkbenchSmartTable
                tableId="chromatogram-heterozygote-peaks"
                tableLabel={`Mixed-Peak IUPAC Heterozygote Calls${peakListCap ? ` (${peakListCap})` : ''}`}
                regionMaxHeight={160}
                className="bio-table"
              >
                <thead>
                  <tr>
                    <th>Trace Position</th>
                    <th>IUPAC Call</th>
                    <th>Primary / Secondary</th>
                    <th>Secondary Ratio</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {viewportReport.heterozygotePeaks.map((pk) => (
                    <tr key={pk.position1based}>
                      <td>
                        <strong>bp {pk.position1based}</strong>
                      </td>
                      <td className="mono-cell">
                        <strong>{pk.iupacCode}</strong>
                      </td>
                      <td className="mono-cell">
                        {pk.primaryBase} / {pk.secondaryBase}
                      </td>
                      <td>{(pk.secondaryRatio * 100).toFixed(1)}%</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          onClick={() => setBaseOffset(Math.max(0, pk.position1based - 20))}
                        >
                          Jump to Peak
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            )}
          </div>
        )}

        {/* Multi-Read Contig Assembler: overlap layout, then partial-order alignment (POA). In the
            workbench its primary action, Run assembly preview, stays here beside the result, while
            the pre-trim setting moves with Contig Assembly into the inspector (D0063 ruling c). */}
        {(poaContigReport || inWorkbench) && (
          <div className="contig-variants-section mbc-studio-isolated-region" style={{ marginTop: 12 }}>
            <div className="studio-card-header" style={{ paddingTop: 0 }}>
              <h4>
                Contig assembly by partial-order alignment (POA)
              </h4>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {poaContigReport && (
                  <span className="badge-accent">
                    {poaTrimHq ? 'Mott quality pre-trim on' : 'Raw reads (no pre-trim)'}
                  </span>
                )}
                {inWorkbench && runAssemblyButton()}
                {onCreateDocument && poaContigReport && poaContigReport.consensusLengthBp > 0 && (
                  <button
                    type="button"
                    className="btn-success"
                    onClick={() => onCreateDocument(withWarningNotes(poaContigReport.contigDocument, poaContigReport.warnings))}
                  >
                    + Save POA Consensus Contig ({poaContigReport.consensusLengthBp.toLocaleString()} bp)
                  </button>
                )}
              </div>
            </div>

            {poaContigReport ? (
              <>
                <ResultWarnings warnings={poaContigReport.warnings} label="Contig assembly warnings" />

                <div className="thermo-kpi-grid">
                  <div className="kpi-box">
                    <span className="kpi-label">POA Consensus Length</span>
                    <strong className="kpi-val">
                      {poaContigReport.consensusLengthBp.toLocaleString()} bp ({poaReadsUsed})
                    </strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">POA DAG Nodes / Edges</span>
                    <strong className="kpi-val">
                      {poaContigReport.graphNodeCount} / {poaContigReport.graphEdgeCount} ({poaContigReport.graphBranchBubbles} bubbles)
                    </strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Mean Depth &amp; Identity</span>
                    <strong className="kpi-val">
                      {poaContigReport.meanCoverageX.toFixed(1)}× • {poaContigReport.pairwiseIdentityPct.toFixed(1)}%
                    </strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Strand Orientation</span>
                    <strong className="kpi-val">
                      {poaContigReport.forwardReads} Fwd / {poaContigReport.reverseComplementedReads} Auto-RevComp
                    </strong>
                  </div>
                </div>

                <WorkbenchSmartTable
                  tableId="chromatogram-poa-contig-reads"
                  tableLabel="POA Assembled Sequencing Reads"
                  regionMaxHeight={175}
                  className="bio-table"
                >
                  <thead>
                    <tr>
                      <th>Read Name</th>
                      <th>Strand</th>
                      <th>Raw / Post-Trim</th>
                      <th>POA Score</th>
                      <th>Identity to Consensus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poaContigReport.alignedReads.map((rd) => (
                      <tr key={rd.id}>
                        <td>
                          <strong>{rd.name}</strong>
                        </td>
                        <td>{rd.strand === 1 ? 'Forward (+)' : 'Auto-RevComp (-)'}</td>
                        <td>
                          {rd.rawLengthBp} / {rd.postTrimLengthBp} bp
                        </td>
                        <td>{rd.poaScore}</td>
                        <td>{rd.identityPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </WorkbenchSmartTable>
              </>
            ) : (
              <p className="studio-panel-note">
                {`${poaCandidateDocs.length < 2 ? 'Select at least two traces in the project table to assemble them. ' : ''}No assembly has been run.`}
              </p>
            )}
          </div>
        )}
        </div>
      </div>

      {/* In the workbench the sections are drawn in App's inspector, so the studio draws no aside.
          Drawn on its own it keeps its right-hand collapsible control sidebar, the same inspector
          shell as the Sequence view. */}
      {inWorkbench ? traceSections() : (
        <aside className="mbc-right-controls chromatogram-inspector" aria-label="Chromatogram View Controls">
          <div className="mbc-pane-title">
            <Settings2 size={14} />
            <span>Chromatogram View Controls</span>
          </div>

          <div className="mbc-accordion-scroll">
            {traceSections()}
          </div>
        </aside>
      )}
    </div>
  );
};
