// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  BIO_PIPELINE_CATALOG,
  executeBioPipelineAsync,
  runBatchBioPipelinesAsync,
} from '../core/bioPipelineEngine';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { SequenceDocument } from '../types/bio';

describe('Multi-Task Guided Bioinformatics Pipeline Engine (100% Local Desktop)', () => {
  const sampleConstruct = SAMPLE_LIBRARY[0];

  it('executes all 4 multi-step bioinformatics pipelines asynchronously with biological rationale, oligos, and OS line endings', async () => {
    for (const def of BIO_PIPELINE_CATALOG) {
      const report = await executeBioPipelineAsync(sampleConstruct, def.id, {
        hostOs: def.id === 'viral-twist-onboarding' ? 'windows' : 'linux',
      });

      expect(report.pipelineId).toBe(def.id);
      expect(report.steps.length).toBe(def.stepTitles.length);
      expect(report.readinessScore).toBeGreaterThanOrEqual(15);
      expect(report.readinessScore).toBeLessThanOrEqual(100);
      expect(report.visualZones.length).toBeGreaterThan(0);

      if (def.id === 'cloning-expression-qc') {
        const primerStep = report.steps.find((s) => s.id === 'flanking-primers');
        expect(primerStep?.artifacts.length).toBe(2);
      }

      if (def.id === 'viral-twist-onboarding') {
        // Windows host emits CRLF-formatted Markdown lab report
        expect(report.markdownProtocol.includes('\r\n')).toBe(true);
      } else {
        // Linux / macOS host emits POSIX LF-formatted Markdown lab report
        expect(report.markdownProtocol.includes('\r\n')).toBe(false);
      }
    }
  });

  it('runs multi-construct batch pipelines asynchronously and rejects invalid/empty sequences or aborted runs', async () => {
    const batchDocs = SAMPLE_LIBRARY.slice(0, 2);
    const seenDocs: string[] = [];
    const batchReports = await runBatchBioPipelinesAsync(batchDocs, 'cloning-expression-qc', {
      hostOs: 'macos',
      onDocumentProgress: (_idx, _total, name) => seenDocs.push(name),
    });
    expect(batchReports.length).toBe(2);
    expect(seenDocs.length).toBe(2);

    // Failure state 1: sequence shorter than 12 nt throws typed ERR_EMPTY_SEQUENCE
    const invalidDoc: SequenceDocument = {
      ...sampleConstruct,
      id: 'invalid-short',
      name: 'ShortFragment',
      sequence: 'ATGC',
    };
    await expect(
      executeBioPipelineAsync(invalidDoc, 'cloning-expression-qc', { hostOs: 'linux' })
    ).rejects.toThrowError(/ERR_EMPTY_SEQUENCE/);

    // Failure state 2: pre-aborted AbortSignal throws typed ERR_TASK_ABORTED
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      executeBioPipelineAsync(sampleConstruct, 'crispr-hdr-knockout', {
        signal: aborted.signal,
        hostOs: 'macos',
      })
    ).rejects.toThrowError(/ERR_TASK_ABORTED/);
  });
});
