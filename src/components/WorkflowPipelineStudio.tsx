// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Download,
  Layers,
  Monitor,
  Play,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import {
  BIO_PIPELINE_CATALOG,
  BioPipelineExecutionReport,
  BioPipelineId,
  executeBioPipelineAsync,
  PipelineStepStatus,
  PipelineVisualZone,
  runBatchBioPipelinesAsync,
  TargetWorkbenchStudio,
} from '../core/bioPipelineEngine';
import {
  createPlatformAdapter,
  dispatchDesktopNotification,
  LogEntry,
  Logger,
  MolBioCraftError,
  SupportedOS,
} from '../platform/osPlatform';
import { useTauriBackend } from '../hooks/useTauriBackend';
import { SequenceDocument } from '../types/bio';
import {
  pipelineRunKey,
  PipelineReportRunKey,
  selectCurrentPipelineReport,
} from '../core/pipelineReportFreshness';

export interface WorkflowPipelineStudioProps {
  activeDoc: SequenceDocument;
  allDocuments: ReadonlyArray<SequenceDocument>;
  hostOs: SupportedOS;
  onChangePreviewOs?: (os: SupportedOS) => void;
  onSelectDocument: (docId: string) => void;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
  onNavigateStudio: (studio: TargetWorkbenchStudio) => void;
  onStatusMessage?: (msg: string) => void;
}

const TRACK_ORDER: PipelineVisualZone['track'][] = [
  'Regulatory & Backbone',
  'Coding / ORF',
  'Primers & Amplicon',
  'CRISPR / Cloning',
  'QC Hotspots',
];

function statusBadgeStyle(status: PipelineStepStatus): {
  bg: string;
  fg: string;
  border: string;
  label: string;
} {
  if (status === 'PASS') {
    return {
      bg: 'var(--mbc-green-soft)',
      fg: 'var(--mbc-green)',
      border: 'var(--mbc-green-border)',
      label: 'PASS',
    };
  }
  if (status === 'WARN') {
    return {
      bg: 'var(--mbc-amber-soft)',
      fg: 'var(--mbc-amber)',
      border: 'var(--mbc-amber-border)',
      label: 'REVIEW / WARN',
    };
  }
  return {
    bg: 'var(--mbc-red-soft)',
    fg: 'var(--mbc-red)',
    border: 'var(--mbc-red-border)',
    label: 'ACTION REQUIRED',
  };
}

export interface GuidedPipelineLayoutProps {
  /** The current document's report, or null before one exists (and while a run is in flight). */
  report: BioPipelineExecutionReport | null;
  selectedPipelineId: BioPipelineId;
  onSelectPipeline: (id: BioPipelineId) => void;
  activeStepIdx: number;
  onSelectStep: (idx: number) => void;
  onSelectRange: WorkflowPipelineStudioProps['onSelectRange'];
  onNavigateStudio: WorkflowPipelineStudioProps['onNavigateStudio'];
  copiedLabel: string | null;
  onCopySequence: (label: string, seq: string) => void;
  /** The run's progress bar and error notice, shown below the pipeline choice and above the steps. */
  notices?: React.ReactNode;
  /**
   * Keep the one-row picker while there is no report to draw, because this studio has already shown
   * one: a run replacing it (a pipeline switch, an edit to the document) then does not flash the
   * catalogue open between two reports.
   */
  keepPickerFolded?: boolean;
}

/**
 * The part of the guided-pipelines studio that chooses a pipeline and shows its report, in reading
 * order (US-01M6Q1ZR): the pipeline choice, the run's notices, the steps with the focused step's
 * detail, then the blueprint. Before a report exists the choice is the four-card catalogue; once one
 * exists it folds into a one-row picker of the same four pipelines, so the steps sit near the top.
 */
export const GuidedPipelineLayout: React.FC<GuidedPipelineLayoutProps> = ({
  report,
  selectedPipelineId,
  onSelectPipeline,
  activeStepIdx,
  onSelectStep,
  onSelectRange,
  onNavigateStudio,
  copiedLabel,
  onCopySequence,
  notices,
  keepPickerFolded = false,
}) => {
  const focusedStep = report?.steps[activeStepIdx] ?? report?.steps[0] ?? null;

  return (
    <>
      {/* Pipeline choice: the catalogue cards until a report exists, then a one-row picker */}
      {report || keepPickerFolded ? (
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills mbc-pipeline-picker"
          trackClassName="cloning-method-tabs"
          role="group"
          ariaLabel="Guided pipelines"
          activeKey={selectedPipelineId}
          prevAriaLabel="Slide pipelines left"
          nextAriaLabel="Slide pipelines right"
        >
          {BIO_PIPELINE_CATALOG.map((item) => {
            const isSelected = item.id === selectedPipelineId;
            return (
              <button
                key={item.id}
                type="button"
                className={`method-tab-btn ${isSelected ? 'active' : ''}`}
                aria-pressed={isSelected}
                title={item.title}
                onClick={() => onSelectPipeline(item.id)}
              >
                {item.category}
              </button>
            );
          })}
        </ScrollableMenuStrip>
      ) : (
        <div className="mbc-pipeline-catalog-grid">
          {BIO_PIPELINE_CATALOG.map((item) => {
            const isSelected = item.id === selectedPipelineId;
            return (
              <button
                key={item.id}
                type="button"
                className={`mbc-pipeline-card ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectPipeline(item.id)}
              >
                <div className="mbc-pipeline-card-top">
                  <span className="mbc-pipeline-cat-pill">{item.category}</span>
                  <span className="mbc-pipeline-stepcount">{item.shortBadge}</span>
                </div>
                <div className="mbc-pipeline-card-name">{item.title}</div>
                <div className="mbc-pipeline-card-desc">{item.description}</div>
              </button>
            );
          })}
        </div>
      )}

      {notices}

      {/* 2. Connected step-by-step flow navigation + the focused step's deep-dive */}
      {report && (
        <section className="mbc-stepper-section">
          <ScrollableMenuStrip
            className="mbc-scroll-strip--pills"
            trackClassName="mbc-stepper-rail"
            role="tablist"
            ariaLabel="Pipeline Steps"
            activeKey={activeStepIdx}
            enableSpatialArrowNav
            activateOnSpatialFocus
            prevAriaLabel="Slide pipeline steps left"
            nextAriaLabel="Slide pipeline steps right"
          >
            {report.steps.map((step, idx) => {
              const badge = statusBadgeStyle(step.status);
              const isFocused = idx === activeStepIdx;
              return (
                <React.Fragment key={step.id}>
                  <button
                    type="button"
                    role="tab"
                    tabIndex={isFocused ? 0 : -1}
                    aria-selected={isFocused}
                    className={`mbc-step-node ${isFocused ? 'focused' : ''}`}
                    onClick={() => onSelectStep(idx)}
                  >
                    <span
                      className="mbc-step-num"
                      style={{ background: badge.bg, color: badge.fg, borderColor: badge.border }}
                    >
                      {step.status === 'PASS' ? (
                        <CheckCircle2 size={13} />
                      ) : step.status === 'WARN' ? (
                        <AlertTriangle size={13} />
                      ) : (
                        <XCircle size={13} />
                      )}
                      Step {step.stepNumber}
                    </span>
                    <span className="mbc-step-node-title">{step.title}</span>
                  </button>
                  {idx < report.steps.length - 1 && (
                    <ChevronRight
                      size={16}
                      strokeWidth={2.4}
                      className="mbc-step-arrow"
                      aria-hidden="true"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </ScrollableMenuStrip>

          {focusedStep && (
            <div className="mbc-step-detail-card" role="tabpanel">
              <div className="mbc-step-detail-top">
                <div>
                  <div className="mbc-step-eyebrow">
                    Step {focusedStep.stepNumber} of {report.steps.length}
                  </div>
                  <h4 className="mbc-step-heading">{focusedStep.title}</h4>
                </div>
                <div className="mbc-step-cta-group">
                  {focusedStep.highlightRange && (
                    <button
                      type="button"
                      className="mbc-pipe-btn secondary"
                      onClick={() => {
                        if (focusedStep.highlightRange) {
                          onSelectRange(focusedStep.highlightRange);
                          onNavigateStudio('sequence-view');
                        }
                      }}
                    >
                      Highlight bp {focusedStep.highlightRange.start}..
                      {focusedStep.highlightRange.end}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mbc-pipe-btn primary"
                    onClick={() => onNavigateStudio(focusedStep.targetStudio)}
                  >
                    {focusedStep.targetStudioLabel}{' '}
                    <ChevronRight size={13} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="mbc-rationale-callout">
                <strong>Biological Rationale:</strong> {focusedStep.biologicalRationale}
              </div>

              <p className="mbc-finding-summary">{focusedStep.findingSummary}</p>

              {/* What this step could not report whole (D0005), beside the numbers it reports */}
              <ResultWarnings warnings={focusedStep.warnings} label="Pipeline step warnings" />

              {/* Quantitative Metrics Grid */}
              <div className="mbc-metrics-grid">
                {focusedStep.metrics.map((m) => (
                  <div key={m.label} className={`mbc-metric-box tone-${m.tone ?? 'neutral'}`}>
                    <span className="mbc-metric-label">{m.label}</span>
                    <strong className="mbc-metric-val">{m.value}</strong>
                  </div>
                ))}
              </div>

              {/* Synthesized Oligos / Primers / HDR Donors */}
              {focusedStep.artifacts.length > 0 && (
                <div className="mbc-artifacts-block">
                  <div className="mbc-subblock-title">
                    Synthesized Oligos, Primers &amp; Sequence Artifacts (5&apos; → 3&apos;)
                  </div>
                  {focusedStep.artifacts.map((art) => (
                    <div key={art.label} className="mbc-artifact-row">
                      <div className="mbc-artifact-meta">
                        <strong>{art.label}</strong>
                        <span>{art.note}</span>
                      </div>
                      <code className="mbc-artifact-seq">5&apos;-{art.sequence}-3&apos;</code>
                      <button
                        type="button"
                        className="mbc-copy-mini-btn"
                        onClick={() => onCopySequence(art.label, art.sequence)}
                      >
                        <ClipboardCopy size={12} />
                        {copiedLabel === art.label ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Actionable Bench & Bioinformatics Next Steps */}
              <div className="mbc-recommendations-block">
                <div className="mbc-subblock-title">Recommended Next Steps</div>
                <ul>
                  {focusedStep.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Interactive visual construct & assay blueprint SVG */}
      {report && (
        <section className="mbc-blueprint-card" aria-label="Visual Construct and Assay Blueprint" data-mbc-figure>
          <div className="mbc-blueprint-header">
            <div>
              <strong>
                Visual Construct &amp; Assay Blueprint — {report.documentName} (
                {report.sequenceLengthBp.toLocaleString()} bp)
              </strong>
              <span className="mbc-blueprint-hint">
                Click any track bar to highlight its exact base-pair coordinates in the sequence editor
              </span>
            </div>
            <div className="mbc-readiness-pill-group">
              <span className="mbc-elapsed-tag">{report.elapsedMs} ms async</span>
              <FigureExportButton
                compact
                baseName={`${report.documentName} — Construct Blueprint`}
                title={`${report.documentName} — construct and assay blueprint`}
                table={{
                  headers: ['Track', 'Zone', 'Start (bp)', 'End (bp)', 'Length (bp)'],
                  rows: report.visualZones.map((z) => [
                    z.track,
                    z.label,
                    String(z.start),
                    String(z.end),
                    String(z.end - z.start + 1),
                  ]),
                  caption: `${report.documentName} — ${report.visualZones.length} zones over ${report.sequenceLengthBp.toLocaleString()} bp`,
                }}
              />
              <span
                className="mbc-overall-badge"
                style={{
                  background: statusBadgeStyle(report.overallStatus).bg,
                  color: statusBadgeStyle(report.overallStatus).fg,
                  border: `1px solid ${statusBadgeStyle(report.overallStatus).border}`,
                }}
              >
                Readiness {report.readinessScore}/100 •{' '}
                {statusBadgeStyle(report.overallStatus).label}
              </span>
            </div>
          </div>

          <svg
            viewBox="0 0 940 184"
            className="mbc-blueprint-svg"
            role="img"
            aria-label={`Sequence blueprint for ${report.documentName}`}
          >
            {/* Coordinate Ruler */}
            <line x1={182} y1={24} x2={892} y2={24} stroke="var(--mbc-border-strong)" strokeWidth={1.5} />
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const x = 182 + frac * 710;
              const bp = Math.max(1, Math.round(frac * report.sequenceLengthBp));
              return (
                <g key={frac}>
                  <line x1={x} y1={17} x2={x} y2={29} stroke="var(--mbc-text-muted)" strokeWidth={1.2} />
                  <text
                    x={frac === 1 ? x - 4 : x}
                    y={13}
                    textAnchor={frac === 1 ? 'end' : 'middle'}
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--mbc-text-secondary)"
                  >
                    {bp.toLocaleString()} bp
                  </text>
                </g>
              );
            })}

            {/* 5 Aligned Functional Tracks */}
            {TRACK_ORDER.map((trackName, rowIdx) => {
              const y = 40 + rowIdx * 27;
              const zones = report.visualZones.filter((z) => z.track === trackName);
              return (
                <g key={trackName}>
                  <text
                    x={172}
                    y={y + 13}
                    textAnchor="end"
                    fontSize={11.5}
                    fontWeight={600}
                    fill="var(--mbc-text-main)"
                  >
                    {trackName}
                  </text>
                  <line
                    x1={182}
                    y1={y + 8}
                    x2={892}
                    y2={y + 8}
                    stroke="var(--mbc-border-light)"
                    strokeDasharray="3 3"
                  />
                  {zones.map((zone) => {
                    const total = Math.max(1, report.sequenceLengthBp);
                    const xStart = 182 + ((Math.max(1, zone.start) - 1) / total) * 710;
                    const rawW =
                      ((Math.max(zone.start, zone.end) - zone.start + 1) / total) * 710;
                    const width = Math.max(10, Math.min(892 - xStart, rawW));
                    return (
                      <g
                        key={zone.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          onSelectRange({
                            start: zone.start,
                            end: zone.end,
                            label: zone.label,
                          });
                        }}
                      >
                        <title>
                          {`${zone.label} (bp ${zone.start}..${zone.end}) — Click to select`}
                        </title>
                        <rect
                          x={xStart}
                          y={y}
                          width={width}
                          height={17}
                          rx={4}
                          fill={zone.color}
                          opacity={0.9}
                        />
                        {width > 64 && (
                          <text
                            x={xStart + 6}
                            y={y + 12.5}
                            fontSize={11}
                            fontWeight={700}
                            fill="#ffffff"
                          >
                            {zone.label.slice(0, Math.floor((width - 10) / 6.5))}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </section>
      )}
    </>
  );
};

export const WorkflowPipelineStudio: React.FC<WorkflowPipelineStudioProps> = ({
  activeDoc,
  allDocuments,
  hostOs,
  onChangePreviewOs,
  onSelectDocument,
  onSelectRange,
  onNavigateStudio,
  onStatusMessage,
}) => {
  const batchTableCaptionId = useId();
  const tauriBackend = useTauriBackend();
  const [selectedPipelineId, setSelectedPipelineId] =
    useState<BioPipelineId>('cloning-expression-qc');
  // The stored report is tagged with the document revision + pipeline it was computed
  // for; `report` (below) is only the stored one while it still matches the current
  // selection and no newer run is in flight, so stale reports are never shown/exported.
  const [storedReport, setStoredReport] = useState<
    { report: BioPipelineExecutionReport; key: PipelineReportRunKey } | null
  >(null);
  const [batchReports, setBatchReports] = useState<BioPipelineExecutionReport[]>([]);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const [running, setRunning] = useState<boolean>(false);
  // Single-document run in flight (auto or manual). Tracked apart from
  // `running`, which a multi-document batch also sets, so a batch does not hide
  // the current document's report; the id ignores completions of superseded runs.
  const [singleRunId, setSingleRunId] = useState<number | null>(null);
  const singleRunSeqRef = useRef(0);
  // Whether this studio has shown a report yet: from then on the pipeline picker stays folded, also
  // while the next report is computed, unless a run fails (the catalogue then shows with the error).
  const [hasShownReport, setHasShownReport] = useState(false);
  const [progressStage, setProgressStage] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<ReadonlyArray<LogEntry>>(() =>
    Logger.getRecentLogs().slice(-12)
  );
  const [inspectedOs, setInspectedOs] = useState<SupportedOS>(hostOs);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setInspectedOs(hostOs);
  }, [hostOs]);

  // Subscribe to structured Logger with deterministic cleanup on unmount
  useEffect(() => {
    const unsubscribe = Logger.subscribe(() => {
      setRecentLogs([...Logger.getRecentLogs().slice(-14)]);
    });
    return () => {
      unsubscribe();
      abortRef.current?.abort();
    };
  }, []);

  // Automatically execute the selected guided pipeline whenever activeDoc or pipeline changes
  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const runKey = pipelineRunKey(activeDoc, selectedPipelineId);
    const runId = ++singleRunSeqRef.current;
    const finishSingleRun = () => setSingleRunId((cur) => (cur === runId ? null : cur));
    setStoredReport(null);
    setRunning(true);
    setSingleRunId(runId);
    setErrorBanner(null);
    setProgressStage('Initializing async bioinformatics pipeline...');
    setProgressPct(5);

    executeBioPipelineAsync(activeDoc, selectedPipelineId, {
      signal: controller.signal,
      hostOs,
      onProgress: (stage, pct) => {
        if (!cancelled) {
          setProgressStage(stage);
          setProgressPct(pct);
        }
      },
    })
      .then((res) => {
        if (!cancelled) {
          setStoredReport({ report: res, key: runKey });
          setHasShownReport(true);
          setActiveStepIdx(0);
          setRunning(false);
          finishSingleRun();
          setProgressPct(100);
        }
      })
      .catch((err) => {
        finishSingleRun();
        if (cancelled) return;
        if (err instanceof MolBioCraftError && err.code === 'ERR_TASK_ABORTED') {
          setRunning(false);
          return;
        }
        setRunning(false);
        setErrorBanner(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      controller.abort();
      finishSingleRun();
    };
  }, [activeDoc, selectedPipelineId, hostOs]);

  const handleRunManual = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runKey = pipelineRunKey(activeDoc, selectedPipelineId);
    const runId = ++singleRunSeqRef.current;
    setStoredReport(null);
    setRunning(true);
    setSingleRunId(runId);
    setErrorBanner(null);

    try {
      const res = await executeBioPipelineAsync(activeDoc, selectedPipelineId, {
        signal: controller.signal,
        hostOs,
        onProgress: (stage, pct) => {
          setProgressStage(stage);
          setProgressPct(pct);
        },
      });
      if (controller.signal.aborted) return;
      setStoredReport({ report: res, key: runKey });
      setHasShownReport(true);
      onStatusMessage?.(
        `Completed "${res.pipelineTitle}" on ${res.documentName} in ${res.elapsedMs} ms (Score: ${res.readinessScore}/100).`
      );
    } catch (err) {
      if (!(err instanceof MolBioCraftError && err.code === 'ERR_TASK_ABORTED')) {
        setErrorBanner(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      setSingleRunId((cur) => (cur === runId ? null : cur));
    }
  };

  const handleRunBatchMultiTask = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setErrorBanner(null);

    const candidateDocs = allDocuments
      .filter((d) => d.sequence && d.sequence.length >= 20)
      .slice(0, 8);

    try {
      const results = await runBatchBioPipelinesAsync(candidateDocs, selectedPipelineId, {
        signal: controller.signal,
        hostOs,
        onDocumentProgress: (idx, total, name) => {
          setProgressStage(`Batch Multi-Task (${idx}/${total}): ${name}`);
          setProgressPct(Math.round((idx / Math.max(1, total)) * 100));
        },
      });
      setBatchReports(results);
      await dispatchDesktopNotification(
        'MolBioCraft Multi-Task Batch Complete',
        `Evaluated ${results.length} constructs under ${selectedPipelineId}.`
      );
      onStatusMessage?.(
        `Multi-task batch completed across ${results.length} constructs (${results.filter((r) => r.overallStatus === 'PASS').length} PASS).`
      );
    } catch (err) {
      if (!(err instanceof MolBioCraftError && err.code === 'ERR_TASK_ABORTED')) {
        setErrorBanner(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
  };

  const handleCancelTask = () => {
    abortRef.current?.abort();
    setRunning(false);
    setSingleRunId(null);
    setProgressStage('Cancelled by user');
  };

  const handleExportProtocol = async () => {
    if (!report) return;
    saveWorkbenchFile(report.suggestedExportFilename, report.markdownProtocol, 'text/markdown;charset=utf-8');
    await dispatchDesktopNotification(
      'Lab Protocol Exported',
      `Saved ${report.suggestedExportFilename} (${hostOs.toUpperCase()} line endings).`
    );
    onStatusMessage?.(`Exported ${report.suggestedExportFilename}`);
  };

  const handleCopySequence = async (label: string, seq: string) => {
    try {
      await navigator.clipboard?.writeText(seq);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 1600);
    } catch {
      onStatusMessage?.(`${label}: 5'-${seq}-3'`);
    }
  };

  const inspectedAdapter = useMemo(
    () => createPlatformAdapter(inspectedOs),
    [inspectedOs]
  );
  const inspectedDirs = useMemo(
    () =>
      inspectedAdapter.resolveDirectories({
        home: inspectedOs === 'macos' ? '/Users/researcher' : '/home/researcher',
        appData: 'C:\\Users\\researcher\\AppData\\Roaming',
        localAppData: 'C:\\Users\\researcher\\AppData\\Local',
      }),
    [inspectedAdapter, inspectedOs]
  );

  const report = selectCurrentPipelineReport(
    storedReport,
    pipelineRunKey(activeDoc, selectedPipelineId),
    singleRunId !== null
  );

  return (
    <div className="mbc-pipeline-studio">
      {/* 1. Header */}
      <div className="mbc-pipeline-header">
        <div>
          <h3 className="mbc-pipeline-title">
            <Layers size={16} /> Guided Multi-Task Molecular Biology &amp; Bioinformatics Pipelines
          </h3>
          <p className="mbc-pipeline-subtitle">
            Step-by-step visual execution across cloning, primers, CRISPR/HDR, multi-host protein/mRNA expression, and viral/synthesis QC — running asynchronously across macOS, Windows, and Linux.
          </p>
        </div>
        <div className="mbc-pipeline-actions">
          {running ? (
            <button className="mbc-pipe-btn danger" onClick={handleCancelTask}>
              <Square size={13} /> Stop Task
            </button>
          ) : (
            <button className="mbc-pipe-btn primary" onClick={handleRunManual}>
              <Play size={13} /> Re-Run Pipeline
            </button>
          )}
          <button
            className="mbc-pipe-btn secondary"
            disabled={running}
            onClick={handleRunBatchMultiTask}
            title="Execute this bioinformatics workflow across up to 8 open constructs asynchronously"
          >
            <Activity size={13} /> Batch Run ({Math.min(8, allDocuments.length)} Docs)
          </button>
          <button
            className="mbc-pipe-btn secondary"
            disabled={!report}
            onClick={handleExportProtocol}
            title={
              report
                ? `Export the protocol for ${report.documentName}`
                : singleRunId !== null
                  ? 'A pipeline run is in progress for the current document'
                  : 'No completed pipeline report for the current document'
            }
          >
            <Download size={13} /> Export Lab Protocol (.md)
          </button>
        </div>
      </div>

      <GuidedPipelineLayout
        report={report}
        selectedPipelineId={selectedPipelineId}
        onSelectPipeline={setSelectedPipelineId}
        activeStepIdx={activeStepIdx}
        onSelectStep={setActiveStepIdx}
        onSelectRange={onSelectRange}
        onNavigateStudio={onNavigateStudio}
        copiedLabel={copiedLabel}
        onCopySequence={handleCopySequence}
        keepPickerFolded={hasShownReport && errorBanner === null}
        notices={
          <>
            {/* Async Non-Blocking Progress Bar */}
            {running && (
              <div className="mbc-pipeline-progress-bar" role="status" aria-live="polite">
                <div className="mbc-pipeline-progress-text">
                  <span>⚡ Async Worker Active: {progressStage}</span>
                  <strong>{progressPct}%</strong>
                </div>
                <div className="mbc-pipeline-progress-track">
                  <div
                    className="mbc-pipeline-progress-fill"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {errorBanner && (
              <div className="mbc-pipeline-error" role="alert">
                <XCircle size={15} />
                <span>{errorBanner}</span>
              </div>
            )}
          </>
        }
      />

      {/* 4. Multi-Task Batch Comparison Table (Responsive Sticky-Header Data Table) */}
      {batchReports.length > 0 && (
        <section className="mbc-batch-card">
          <div id={batchTableCaptionId} className="mbc-table-caption">
            Multi-Task Batch Pipeline Results ({batchReports.length} Constructs Evaluated)
          </div>
          <WorkbenchSmartTable
            tableId="workflow-batch-pipeline-results"
            tableLabel="Multi-Task Batch Pipeline Results"
            regionMaxHeight={320}
            className="mbc-batch-table"
          >
            <thead>
              <tr>
                <th scope="col">Construct</th>
                <th scope="col">Length</th>
                <th scope="col">Status</th>
                <th scope="col">Readiness</th>
                <th scope="col">Async Time</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {batchReports.map((br) => {
                const st = statusBadgeStyle(br.overallStatus);
                return (
                  <tr key={br.documentId}>
                    <th scope="row">{br.documentName}</th>
                    <td>{br.sequenceLengthBp.toLocaleString()} bp</td>
                    <td>
                      <span
                        className="mbc-mini-status-pill"
                        style={{
                          background: st.bg,
                          color: st.fg,
                          border: `1px solid ${st.border}`,
                        }}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td>
                      <strong>{br.readinessScore}/100</strong>
                    </td>
                    <td>{br.elapsedMs} ms</td>
                    <td>
                      <button
                        type="button"
                        className="mbc-copy-mini-btn"
                        onClick={() => onSelectDocument(br.documentId)}
                      >
                        Inspect Construct
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </WorkbenchSmartTable>
        </section>
      )}

      {/* 5. Below-the-Fold Deferred Cross-Platform OS Adapter & Structured Telemetry Drawer */}
      <section className="mbc-deferred-os-diagnostics">
        <div className="mbc-os-diag-grid">
          <div className="mbc-os-card">
            <div className="mbc-os-card-header">
              <span>
                <Monitor size={14} /> Cross-Platform OS Adapter Inspector (macOS • Windows • Linux)
              </span>
              <div className="mbc-os-Pill-switcher">
                {(['macos', 'windows', 'linux'] as SupportedOS[]).map((osOpt) => (
                  <button
                    key={osOpt}
                    type="button"
                    className={`mbc-os-switch-btn ${inspectedOs === osOpt ? 'active' : ''}`}
                    onClick={() => {
                      setInspectedOs(osOpt);
                      onChangePreviewOs?.(osOpt);
                    }}
                  >
                    {osOpt === 'macos' ? 'macOS' : osOpt === 'windows' ? 'Windows' : 'Linux'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mbc-os-kv-list">
              <div>
                <span>App Support / Config:</span>
                <code>{inspectedDirs.appSupportDir}</code>
              </div>
              <div>
                <span>Logs Directory:</span>
                <code>{inspectedDirs.logsDir}</code>
              </div>
              <div>
                <span>Cache Directory:</span>
                <code>{inspectedDirs.cacheDir}</code>
              </div>
              <div>
                <span>Filesystem &amp; Casing:</span>
                <strong>{inspectedAdapter.windowChrome.filesystemSummary}</strong>
              </div>
              <div>
                <span>Shortcuts (Open / DNA Calc / Quick Save):</span>
                <strong>
                  {inspectedAdapter.formatShortcut('O')} •{' '}
                  {inspectedAdapter.formatShortcut('M', { shift: true })} •{' '}
                  {inspectedAdapter.formatShortcut('S', { alt: true })}
                </strong>
              </div>
              <div>
                <span>System Tray &amp; Notifications:</span>
                <span>{inspectedAdapter.windowChrome.trayBackend}</span>
              </div>
              <div>
                <span>Native Installer Flows:</span>
                <span>{inspectedAdapter.windowChrome.installerFormats.join(' | ')}</span>
              </div>
              <div>
                <span>Desktop IPC &amp; Security Policy:</span>
                <strong>
                  {tauriBackend.isNativeTauri
                    ? 'Native Desktop IPC Active'
                    : 'Local Workbench Engine Active'}{' '}
                  • CSP + Capabilities Allowlist • LRU Cache ({tauriBackend.cacheTelemetry.size}/
                  {tauriBackend.cacheTelemetry.maxEntries}, {tauriBackend.cacheTelemetry.hits} hits)
                </strong>
              </div>
            </div>
          </div>

          <div className="mbc-os-card">
            <div className="mbc-os-card-header">
              <span>
                <Terminal size={14} /> Structured Runtime Telemetry (INFO / WARN / ERROR)
              </span>
              <span className="mbc-elapsed-tag">{recentLogs.length} recent events</span>
            </div>
            <div className="mbc-telemetry-log-box">
              {recentLogs.length === 0 ? (
                <div className="mbc-log-line">No log entries recorded yet.</div>
              ) : (
                recentLogs.map((entry, idx) => (
                  <div key={`${entry.timestamp}-${idx}`} className={`mbc-log-line lvl-${entry.level}`}>
                    <span className="mbc-log-lvl">[{entry.level}]</span>
                    <span className="mbc-log-mod">[{entry.module}]</span>
                    <span>{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
