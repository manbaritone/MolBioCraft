// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Multi-Task Guided Molecular Biology & Bioinformatics Pipeline Engine (Rust-Backed).
 *
 * Delegates all computational steps, sequence audits, primer/gRNA/HDR design, thermodynamic
 * folding, and platform-aware Markdown report generation to compiled Rust
 * (`crates/molbiocraft-cloning/src/bio_pipelines.rs`) via `runAsyncBioTask` + native Tauri/WASM.
 */

import {
  executeBioPipelineRust,
  getBioPipelineCatalogRust,
  invokeRustBioNativeAsync,
} from '../lib/rustBioEngine';
import {
  detectHostOS,
  MolBioCraftError,
  runAsyncBioTask,
  SupportedOS,
} from '../platform/osPlatform';
import { SequenceDocument } from '../types/bio';
import { cleanSequence } from './bioEngine';

export type BioPipelineId =
  | 'cloning-expression-qc'
  | 'crispr-hdr-knockout'
  | 'multihost-protein-mrna'
  | 'viral-twist-onboarding';

export type PipelineStepStatus = 'PASS' | 'WARN' | 'ACTION_REQUIRED';

export type TargetWorkbenchStudio =
  | 'sequence-view'
  | 'vector-library'
  | 'cloning-gel'
  | 'primers-pcr'
  | 'sequence-alignment'
  | 'phylogenetics'
  | 'sanger-contig'
  | 'history-hybrid';

export interface PipelineDefinition {
  id: BioPipelineId;
  title: string;
  shortBadge: string;
  category: string;
  description: string;
  stepTitles: string[];
}

export interface PipelineMetricKV {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface PipelineSequenceArtifact {
  label: string;
  sequence: string;
  note: string;
}

export interface PipelineVisualZone {
  id: string;
  track:
    | 'Regulatory & Backbone'
    | 'Coding / ORF'
    | 'Primers & Amplicon'
    | 'CRISPR / Cloning'
    | 'QC Hotspots';
  label: string;
  start: number;
  end: number;
  strand?: 1 | -1;
  color: string;
  status: PipelineStepStatus;
  targetStudio: TargetWorkbenchStudio;
}

export interface BioPipelineStepResult {
  stepNumber: number;
  id: string;
  title: string;
  status: PipelineStepStatus;
  biologicalRationale: string;
  findingSummary: string;
  metrics: PipelineMetricKV[];
  artifacts: PipelineSequenceArtifact[];
  recommendations: string[];
  targetStudio: TargetWorkbenchStudio;
  targetStudioLabel: string;
  /**
   * What this step could not report whole (D0005), as the engine's own plain sentences: the gRNA
   * step carries the caps on its guide lists and the range its scans read. Absent when the step
   * reports its whole input.
   */
  warnings?: string[];
  highlightRange?: { start: number; end: number; label: string };
}

export interface BioPipelineExecutionReport {
  pipelineId: BioPipelineId;
  pipelineTitle: string;
  documentId: string;
  documentName: string;
  sequenceLengthBp: number;
  overallStatus: PipelineStepStatus;
  readinessScore: number;
  elapsedMs: number;
  completedAtIso: string;
  steps: BioPipelineStepResult[];
  visualZones: PipelineVisualZone[];
  markdownProtocol: string;
  suggestedExportFilename: string;
}

export const BIO_PIPELINE_CATALOG: ReadonlyArray<PipelineDefinition> =
  getBioPipelineCatalogRust<PipelineDefinition>();

/**
 * Execute an end-to-end guided molecular biology / bioinformatics pipeline asynchronously
 * via the compiled Rust bioinformatics engine (`molbiocraft-cloning`).
 */
export async function executeBioPipelineAsync(
  doc: SequenceDocument,
  pipelineId: BioPipelineId,
  options: {
    signal?: AbortSignal;
    hostOs?: SupportedOS;
    onProgress?: (stageLabel: string, progressPct: number) => void;
  } = {}
): Promise<BioPipelineExecutionReport> {
  const hostOs = options.hostOs ?? detectHostOS();
  const cleanSeq = cleanSequence(doc.sequence);

  if (!cleanSeq || cleanSeq.length < 12) {
    throw new MolBioCraftError(
      'ERR_EMPTY_SEQUENCE',
      `Document "${doc.name}" must contain at least 12 valid nucleotide/residue characters to execute pipeline "${pipelineId}".`,
      hostOs,
      { documentId: doc.id, length: cleanSeq.length }
    );
  }

  // Every catalogued pipeline (primer QC, CRISPR KO/HDR, CDS codon adaptation,
  // viral/Twist onboarding) works on nucleotide sequence; protein input used
  // to be processed as if it were DNA and produced nonsense oligos.
  if (doc.moleculeType === 'Protein') {
    throw new MolBioCraftError(
      'ERR_UNSUPPORTED_INPUT',
      `Pipeline "${pipelineId}" needs a DNA or RNA document; "${doc.name}" is a protein.`,
      hostOs,
      { documentId: doc.id }
    );
  }
  const def = BIO_PIPELINE_CATALOG.find((p) => p.id === pipelineId);
  if (!def) {
    throw new MolBioCraftError('ERR_UNSUPPORTED_INPUT', `Unknown pipeline "${pipelineId}".`, hostOs);
  }

  const completedAtIso = new Date().toISOString();
  const taskRes = await runAsyncBioTask(
    `${def.id}:${doc.name}`,
    async ({ checkpoint }) => {
      await checkpoint(`Dispatching ${def.title} to Rust Bioinformatics Engine`, 20);
      const report =
        typeof window !== 'undefined'
          ? await invokeRustBioNativeAsync<BioPipelineExecutionReport>(
              'execute_bio_pipeline_rust',
              {
                doc,
                pipelineId: def.id,
                hostOS: hostOs,
                completedAtIso,
              }
            )
          : executeBioPipelineRust<BioPipelineExecutionReport>(
              doc,
              def.id,
              hostOs,
              completedAtIso
            );
      await checkpoint('Finalizing laboratory protocol & construct blueprint', 95);
      return report;
    },
    { signal: options.signal, onProgress: options.onProgress }
  );

  return {
    ...taskRes.data,
    elapsedMs: taskRes.elapsedMs,
  };
}

/**
 * Execute a bioinformatics pipeline across multiple documents asynchronously
 * without blocking the main desktop UI thread.
 */
export async function runBatchBioPipelinesAsync(
  docs: ReadonlyArray<SequenceDocument>,
  pipelineId: BioPipelineId,
  options: {
    signal?: AbortSignal;
    hostOs?: SupportedOS;
    onDocumentProgress?: (docIndex: number, totalDocs: number, docName: string) => void;
  } = {}
): Promise<BioPipelineExecutionReport[]> {
  const reports: BioPipelineExecutionReport[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    options.onDocumentProgress?.(i + 1, docs.length, doc.name);
    const report = await executeBioPipelineAsync(doc, pipelineId, {
      signal: options.signal,
      hostOs: options.hostOs,
    });
    reports.push(report);
  }
  return reports;
}
