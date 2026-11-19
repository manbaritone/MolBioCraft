// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import {
  BIO_PIPELINE_CATALOG,
  type BioPipelineId,
  executeBioPipelineAsync,
  runBatchBioPipelinesAsync,
} from '../core/bioPipelineEngine';
import { VIEWER_TAB_ORDER } from '../core/documentViews';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { MolBioCraftError } from '../platform/osPlatform';
import { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';

vi.setConfig({ testTimeout: 90_000 });

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

// ─── US-01M6P24N: the guided pipelines' input rules and step outputs, pinned ───
//
// Wrong implementations these checks name and kill: the length checked before the molecule type (a
// short protein told it needs 12 characters); the raw length checked instead of the cleaned bases;
// an off-by-one on the 12-base floor (<= 12, or < 11); a "DNA only" rule that rejects RNA; and an
// overall status that is not the worst step's. The mounted-App checks prove the Guided pipelines
// studio shows the engine's own sentence and badge, not only that the function derives them.

const PIPELINE_IDS = BIO_PIPELINE_CATALOG.map((d) => d.id);
const STATUSES = ['PASS', 'WARN', 'ACTION_REQUIRED'];
/** The eight TargetWorkbenchStudio ids (bioPipelineEngine.ts): the Protein studio in History's place (US-01M6Q164). */
const TARGET_STUDIOS = [
  'sequence-view', 'vector-library', 'cloning-gel', 'primers-pcr',
  'sequence-alignment', 'phylogenetics', 'sanger-contig', 'protein-3d',
];

const docOf = (
  id: string,
  sequence: string,
  moleculeType: SequenceDocument['moleculeType'] = 'DNA'
): SequenceDocument => ({
  id, name: id, accession: `ACC_${id}`, description: `Document ${id}`, moleculeType, topology: 'linear',
  sequence, features: [], primers: [], history: [],
  createdAt: '2025-01-02T03:04:05.000Z', updatedAt: '2025-01-02T03:04:05.000Z', folder: 'Cloning',
} as SequenceDocument);

const proteinSentence = (id: string, name: string) =>
  `Pipeline "${id}" needs a DNA or RNA document; "${name}" is a protein.`;
const lengthSentence = (name: string, id: string) =>
  `Document "${name}" must contain at least 12 valid nucleotide/residue characters to execute pipeline "${id}".`;

/** The error a run throws, or a failure naming the report it returned instead. */
async function rejection(doc: SequenceDocument, id: BioPipelineId): Promise<MolBioCraftError> {
  try {
    await executeBioPipelineAsync(doc, id, { hostOs: 'linux' });
  } catch (err) {
    expect(err, `${doc.name} / ${id}: a typed MolBioCraftError`).toBeInstanceOf(MolBioCraftError);
    return err as MolBioCraftError;
  }
  throw new Error(`${doc.name} / ${id}: the run returned a report instead of rejecting`);
}

/** A linear DNA sequence with no base repeated more than twice in a row (a fixed LCG, so it is the same every run). */
function balancedDna(n: number): string {
  let s = 7;
  const out: string[] = [];
  while (out.length < n) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const b = 'ACGT'[(s >>> 16) & 3];
    if (out.length >= 2 && out[out.length - 1] === b && out[out.length - 2] === b) continue;
    out.push(b);
  }
  return out.join('');
}
const BALANCED = balancedDna(300);
/** BALANCED with an `n`-base A run at bp 152, fenced by C and G so the run is exactly `n` long. */
const withARun = (n: number) => `${BALANCED.slice(0, 150)}C${'A'.repeat(n)}G${BALANCED.slice(150)}`;

const longestRun = (seq: string) => Math.max(...(seq.match(/(.)\1*/g) ?? ['']).map((r) => r.length));
const windowGc = (seq: string) => {
  const pcts: number[] = [];
  for (let i = 0; i + 50 <= seq.length; i++) {
    const w = seq.slice(i, i + 50);
    pcts.push((w.replace(/[AT]/g, '').length / 50) * 100);
  }
  return { min: Math.min(...pcts), max: Math.max(...pcts) };
};

const worstOf = (statuses: string[]) =>
  statuses.includes('ACTION_REQUIRED') ? 'ACTION_REQUIRED' : statuses.includes('WARN') ? 'WARN' : 'PASS';

/** Mounts the App, restores `doc` and opens it in Guided pipelines by Tools > Pipelines. */
async function openInPipelines(doc: SequenceDocument): Promise<AppHarness> {
  const app = await mountApp();
  await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
  await app.menu('tools:pipelines');
  await app.settle();
  expect(app.activeTab(), 'Tools > Pipelines opens Guided pipelines').toBe('guided-pipelines');
  return app;
}

describe('US-01M6P24N AC1: a protein document is refused by every pipeline, whatever its length', () => {
  const proteins = [
    docOf('Protein0', '', 'Protein'),
    docOf('Protein5', 'MKTAY', 'Protein'),
    docOf('Protein22', 'MKTAYIAKQRQISFVKSHFSRQ', 'Protein'),
  ];

  it('rejects an empty, a 5-residue and a 22-residue protein with ERR_UNSUPPORTED_INPUT and the protein sentence, in all four pipelines', async () => {
    expect(PIPELINE_IDS).toHaveLength(4);
    for (const id of PIPELINE_IDS) {
      for (const doc of proteins) {
        const err = await rejection(doc, id);
        expect(err.code, `${doc.name} / ${id}`).toBe('ERR_UNSUPPORTED_INPUT');
        expect(err.message, `${doc.name} / ${id}`).toBe(`[ERR_UNSUPPORTED_INPUT] ${proteinSentence(id, doc.name)}`);
      }
    }
  });

  it('runs an RNA document of 24 nt through all four pipelines and returns a report, so the rule is not "DNA only"', async () => {
    const rna = docOf('Rna24', 'AUGGCCAUUGUAAUGGGCCGCUGA', 'RNA');
    for (const id of PIPELINE_IDS) {
      const report = await executeBioPipelineAsync(rna, id, { hostOs: 'linux' });
      expect(report.pipelineId, id).toBe(id);
      expect(report.documentId, id).toBe('Rna24');
      expect(report.sequenceLengthBp, id).toBe(24);
      expect(report.steps.length, id).toBeGreaterThan(0);
    }
  });

  it('shows the protein sentence in the Guided pipelines alert and draws no step rail', async () => {
    const doc = proteins[1];
    const app = await openInPipelines(doc);
    try {
      const alerts = app.all('.mbc-pipeline-error[role="alert"]');
      expect(alerts, 'one pipeline alert').toHaveLength(1);
      expect(alerts[0].textContent.trim()).toBe(`[ERR_UNSUPPORTED_INPUT] ${proteinSentence('cloning-expression-qc', doc.name)}`);
      expect(app.all('.mbc-stepper-rail'), 'no step rail').toHaveLength(0);
      expect(app.all('.mbc-overall-badge'), 'no report badge').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M6P24N AC2: a DNA document needs 12 bases after cleaning', () => {
  // 11 bases with spaces and digits between them: 19 raw characters, 11 once cleaned.
  const ELEVEN = '1 ATGCA 7 TGCAT 13G';
  const TWELVE = '1 ATGCA 7 TGCAT 13GC';

  it('the fixtures hold the counts the criterion names', () => {
    expect(ELEVEN.length).toBeGreaterThan(12);
    expect(ELEVEN.replace(/[^A-Z]/g, '')).toHaveLength(11);
    expect(TWELVE.replace(/[^A-Z]/g, '')).toHaveLength(12);
  });

  it('rejects an empty sequence and 11 cleaned bases with ERR_EMPTY_SEQUENCE and the length sentence, in all four pipelines', async () => {
    for (const id of PIPELINE_IDS) {
      for (const doc of [docOf('EmptyDna', ''), docOf('ElevenDna', ELEVEN)]) {
        const err = await rejection(doc, id);
        expect(err.code, `${doc.name} / ${id}`).toBe('ERR_EMPTY_SEQUENCE');
        expect(err.message, `${doc.name} / ${id}`).toBe(`[ERR_EMPTY_SEQUENCE] ${lengthSentence(doc.name, id)}`);
      }
    }
  });

  it('runs cloning-expression-qc on 12 bases, plain and written with spaces and digits, reporting 12 bp', async () => {
    for (const seq of ['ATGCATGCATGC', TWELVE]) {
      const report = await executeBioPipelineAsync(docOf('TwelveDna', seq), 'cloning-expression-qc', { hostOs: 'linux' });
      expect(report.pipelineId).toBe('cloning-expression-qc');
      expect(report.sequenceLengthBp, JSON.stringify(seq)).toBe(12);
    }
  });

  it('shows the length sentence in the Guided pipelines alert for the 11-base document', async () => {
    const doc = docOf('ElevenDna', ELEVEN);
    const app = await openInPipelines(doc);
    try {
      const alerts = app.all('.mbc-pipeline-error[role="alert"]');
      expect(alerts, 'one pipeline alert').toHaveLength(1);
      expect(alerts[0].textContent.trim()).toBe(`[ERR_EMPTY_SEQUENCE] ${lengthSentence(doc.name, 'cloning-expression-qc')}`);
      expect(app.all('.mbc-stepper-rail'), 'no step rail').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M6P24N AC3: each step reports a status from its check, a studio, and a range on the sequence', () => {
  const FIXTURES = [
    { name: 'Balanced', seq: BALANCED, complexity: 'PASS' },
    { name: 'PolyA8', seq: withARun(8), complexity: 'PASS' },
    { name: 'PolyA10', seq: withARun(10), complexity: 'WARN' },
    { name: 'PolyA13', seq: withARun(13), complexity: 'ACTION_REQUIRED' },
  ];

  it('the fixtures are balanced apart from the run they carry', () => {
    expect(longestRun(BALANCED)).toBeLessThanOrEqual(2);
    for (const f of FIXTURES) {
      const gc = windowGc(f.seq);
      expect(gc.min, `${f.name}: lowest 50-bp window GC`).toBeGreaterThanOrEqual(25);
      expect(gc.max, `${f.name}: highest 50-bp window GC`).toBeLessThanOrEqual(75);
    }
    expect(longestRun(withARun(8))).toBe(8);
    expect(longestRun(withARun(10))).toBe(10);
    expect(longestRun(withARun(13))).toBe(13);
  });

  it('gives every step of all four pipelines a known status, a studio that is a viewer tab, and an in-bounds highlight', async () => {
    let ranges = 0;
    for (const f of FIXTURES) {
      for (const id of PIPELINE_IDS) {
        const report = await executeBioPipelineAsync(docOf(f.name, f.seq), id, { hostOs: 'linux' });
        expect(report.sequenceLengthBp, `${f.name} / ${id}`).toBe(f.seq.length);
        expect(report.steps.length, `${f.name} / ${id}`).toBeGreaterThan(0);
        for (const step of report.steps) {
          const where = `${f.name} / ${id} / ${step.id}`;
          expect(STATUSES, where).toContain(step.status);
          expect(TARGET_STUDIOS, where).toContain(step.targetStudio);
          expect(VIEWER_TAB_ORDER as readonly string[], where).toContain(step.targetStudio);
          if (step.highlightRange) {
            ranges++;
            const { start, end } = step.highlightRange;
            expect(start, `${where}: start >= 1`).toBeGreaterThanOrEqual(1);
            expect(end, `${where}: end >= start`).toBeGreaterThanOrEqual(start);
            expect(end, `${where}: end <= sequenceLengthBp`).toBeLessThanOrEqual(report.sequenceLengthBp);
          }
        }
      }
    }
    expect(ranges, 'some steps carry a highlight to check').toBeGreaterThan(0);
  });

  it('reports seq-complexity PASS on balanced sequence and an 8-base run, WARN on a 10-base run and ACTION_REQUIRED on a 13-base run', async () => {
    for (const f of FIXTURES) {
      const report = await executeBioPipelineAsync(docOf(f.name, f.seq), 'cloning-expression-qc', { hostOs: 'linux' });
      const step = report.steps.find((s) => s.id === 'seq-complexity');
      expect(step, `${f.name}: a seq-complexity step`).toBeDefined();
      expect(step!.status, f.name).toBe(f.complexity);
    }
  });

  it('derives overallStatus as the worst step status of the same report', async () => {
    const seen = new Set<string>();
    for (const f of FIXTURES) {
      for (const id of PIPELINE_IDS) {
        const report = await executeBioPipelineAsync(docOf(f.name, f.seq), id, { hostOs: 'linux' });
        const statuses = report.steps.map((s) => s.status);
        expect(report.overallStatus, `${f.name} / ${id}: ${statuses.join(', ')}`).toBe(worstOf(statuses));
        seen.add(report.overallStatus);
      }
    }
    // Every branch of the rule is reached, so a rule wrong on any one of them fails.
    expect([...seen].sort()).toEqual(['ACTION_REQUIRED', 'PASS', 'WARN']);
  });

  it('shows ACTION REQUIRED on the Guided pipelines badge for the 13-base-run document', async () => {
    const app = await openInPipelines(docOf('PolyA13', withARun(13)));
    try {
      const badges = app.all('.mbc-overall-badge');
      expect(badges, 'one overall badge').toHaveLength(1);
      expect(badges[0].textContent.trim().endsWith('ACTION REQUIRED'), badges[0].textContent).toBe(true);
      expect(app.all('.mbc-pipeline-error[role="alert"]'), 'no pipeline alert').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});
