// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * A guided-pipeline report is shown/exported only when it belongs to the document
 * revision and pipeline currently selected, and no newer run is in flight. This
 * prevents a previous document's report from being displayed or exported after the
 * active document changes or a re-run fails.
 */
export interface PipelineReportIdentity {
  pipelineId: string;
  documentId: string;
}

export interface PipelineReportRunKey {
  documentId: string;
  /** Revision stamp of the document the report was computed from (e.g. updatedAt). */
  documentRevision: string;
  pipelineId: string;
}

export function pipelineRunKey(
  doc: { id: string; updatedAt?: string; sequence?: string },
  pipelineId: string
): PipelineReportRunKey {
  return {
    documentId: doc.id,
    documentRevision: `${doc.updatedAt ?? ''}#${doc.sequence?.length ?? 0}`,
    pipelineId,
  };
}

export function selectCurrentPipelineReport<R extends PipelineReportIdentity>(
  stored: { report: R; key: PipelineReportRunKey } | null,
  currentKey: PipelineReportRunKey,
  running: boolean
): R | null {
  if (!stored || running) return null;
  const { report, key } = stored;
  if (
    key.documentId !== currentKey.documentId ||
    key.documentRevision !== currentKey.documentRevision ||
    key.pipelineId !== currentKey.pipelineId
  ) {
    return null;
  }
  if (report.documentId !== currentKey.documentId || report.pipelineId !== currentKey.pipelineId) {
    return null;
  }
  return report;
}
