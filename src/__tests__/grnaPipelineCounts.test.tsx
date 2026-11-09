// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6T6JA: the gRNA step of the CRISPR knockout pipeline reported the length of its capped
 * guide list as the number of guides found — "Found 40 SpCas9 & 25 Cas12a guides" on a 100 kb
 * record with over twelve thousand candidates — and dropped the scans' own warnings on the way.
 *
 * The report here is computed by the real WASM engine, through the same `executeBioPipelineAsync`
 * call the studio makes; nothing is mocked and no count is written into a fixture by hand. The
 * totals are checked against an exhaustive both-strand PAM oracle written below, never against the
 * engine's `candidateCount`. The 100 kb record is generated from a fixed seed — the same seed and
 * the same generator as the Rust test of the same bug, so both runtimes read the same bases.
 *
 * The studio is rendered on the server, as the other studio tests render it, which runs no effect:
 * the report is handed to it at the one place it picks the report to show
 * (`selectCurrentPipelineReport`), and its own layout export is rendered with the gRNA step
 * focused, since a server render cannot click the step rail.
 *
 * Wrong implementations this catches:
 * - the shipped list lengths as the totals (the oracle's totals are in the thousands, so a headline
 *   reading a list's length can never match);
 * - the engine's sentences rewritten, reordered or dropped on the way to the card (both are read in
 *   full, in order, out of the `ResultWarnings` region);
 * - the warnings shown somewhere other than the focused step's card (the region is looked for
 *   inside `mbc-step-detail-card` only);
 * - a warnings region rendered whatever the step holds (the knockout-window step has no warnings,
 *   and its card must show none).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  /** When set, the report the pipeline studio is told is current; otherwise its own choice. */
  report: undefined as unknown,
}));

vi.mock('../core/pipelineReportFreshness', async () => {
  const actual = await vi.importActual<typeof import('../core/pipelineReportFreshness')>('../core/pipelineReportFreshness');
  const select = ((...args: Parameters<typeof actual.selectCurrentPipelineReport>) =>
    probe.report === undefined ? actual.selectCurrentPipelineReport(...args) : probe.report) as typeof actual.selectCurrentPipelineReport;
  return { ...actual, selectCurrentPipelineReport: select };
});

const { GuidedPipelineLayout, WorkflowPipelineStudio } = await import('../components/WorkflowPipelineStudio');
const { executeBioPipelineAsync } = await import('../core/bioPipelineEngine');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
type SequenceDocument = import('../types/bio').SequenceDocument;
type BioPipelineExecutionReport = import('../core/bioPipelineEngine').BioPipelineExecutionReport;
type BioPipelineId = import('../core/bioPipelineEngine').BioPipelineId;

const noop = () => undefined;

/** Seeded pseudo-random DNA (an LCG), so every run reads the same bases and no fixture is stored. */
function randomDna(length: number, seed: number): string {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[x >>> 30];
  }
  return out.join('');
}

/**
 * Every candidate guide of the linear record `seq`, as the 1-based plus-strand base it cuts after:
 * an exhaustive both-strand PAM scan, with nothing taken from the engine.
 *
 * SpCas9 reads a 20-nt spacer then an NGG PAM — a 23-base site, starting at every base
 * `0..=len-23` of each strand — and cuts bluntly 3 bp 5' of the PAM, between site bases 17 and 18.
 * Cas12a reads a TTTV PAM then a 20-nt spacer — a 24-base site, `0..=len-24` — and cuts after
 * spacer nt 18, between site bases 22 and 23. A spacer holding anything but A, C, G or T is no
 * candidate. Of the two bases that flank the cut, the one first in plus-strand reading order is
 * site base 17 (22) on the plus strand and the next site base on the minus strand, because the two
 * strands run in opposite directions.
 */
function oracleCandidateCuts(seq: string, isSpCas9: boolean): number[] {
  const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  const len = seq.length;
  const minus = [...seq].reverse().map((b) => complement[b] ?? b).join('');
  const span = isSpCas9 ? 23 : 24;
  const cutAfter = isSpCas9 ? 17 : 22;
  const cuts: number[] = [];
  for (const [strand, bases] of [
    [1, seq],
    [-1, minus],
  ] as const) {
    for (let i = 0; i + span <= len; i++) {
      const site = bases.slice(i, i + span);
      const pamOk = isSpCas9
        ? site[21] === 'G' && site[22] === 'G'
        : site.startsWith('TTT') && 'ACG'.includes(site[3]);
      if (!pamOk) continue;
      const spacer = isSpCas9 ? site.slice(0, 20) : site.slice(4);
      if (/[^ACGT]/.test(spacer)) continue;
      cuts.push(strand === 1 ? i + cutAfter : len - (i + cutAfter));
    }
  }
  return cuts;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * 100 kb of seeded random bases with a CDS annotated over its first 60,000, so the knockout window
 * is a third of the record: the fixture of the Rust test of this bug, base for base.
 */
const hundredKb: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT,
  id: 'Grna_Counts_100kb',
  name: 'Grna_Counts_100kb',
  sequence: randomDna(100_000, 0x5eed6a01),
  features: [
    { id: 'cds-ko', name: 'koTarget', type: 'CDS', start: 1, end: 60_000, strand: 1, color: '#2563eb' },
  ],
};

/** The text a reader sees: tags and comments stripped, entities decoded, runs of space collapsed. */
const text = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ');

/** Every warnings region in the markup (ResultWarnings): its accessible name and its sentences. */
const warningRegions = (html: string) =>
  [...html.matchAll(/(<div[^>]*data-mbc-result-warnings[^>]*>)([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) =>
      text(p[1]).trim()
    ),
  }));

/** The focused step's own card, out of the studio's markup. */
const stepCard = (html: string) => {
  const from = html.indexOf('mbc-step-detail-card');
  expect(from, 'the studio draws a step card').toBeGreaterThan(-1);
  const to = html.indexOf('mbc-blueprint', from);
  return html.slice(from, to > -1 ? to : html.length);
};

const studioProps = {
  activeDoc: hundredKb,
  allDocuments: [hundredKb],
  hostOs: 'macos' as const,
  onSelectDocument: noop,
  onSelectRange: noop,
  onNavigateStudio: noop,
};

/** The studio's own layout, with `stepIdx` focused. */
const layoutMarkup = (report: BioPipelineExecutionReport, stepIdx: number) =>
  renderToStaticMarkup(
    <GuidedPipelineLayout
      report={report}
      selectedPipelineId={'crispr-hdr-knockout' as BioPipelineId}
      onSelectPipeline={noop}
      activeStepIdx={stepIdx}
      onSelectStep={noop}
      onSelectRange={noop}
      onNavigateStudio={noop}
      copiedLabel={null}
      onCopySequence={noop}
    />
  );

/** The studio, told that `report` is the current one. */
const studioMarkup = (report: BioPipelineExecutionReport) => {
  probe.report = report;
  try {
    return renderToStaticMarkup(<WorkflowPipelineStudio {...studioProps} />);
  } finally {
    probe.report = undefined;
  }
};

describe('the gRNA pipeline step counts every candidate guide (BG-01M6T6JA)', () => {
  it("shows the gRNA step's guide-scan warnings in its step card", async () => {
    const spcas9 = oracleCandidateCuts(hundredKb.sequence, true);
    const cas12a = oracleCandidateCuts(hundredKb.sequence, false);
    expect(
      [spcas9.length > 40, cas12a.length > 25],
      'the fixture caps both guide lists, so neither length is its total'
    ).toEqual([true, true]);

    const report = await executeBioPipelineAsync(hundredKb, 'crispr-hdr-knockout', {
      hostOs: 'macos',
    });
    const stepIdx = report.steps.findIndex((s) => s.id === 'grna-ranking');
    expect(stepIdx, 'the report holds the gRNA ranking step').toBeGreaterThan(-1);
    const step = report.steps[stepIdx];

    // The knockout window the first step mapped, and the candidates that cut inside it.
    const windowShown =
      report.steps
        .find((s) => s.id === 'ko-window')
        ?.metrics.find((m) => m.label === 'Optimal NMD Knockout Window')?.value ?? '';
    const [winStart, winEnd] = windowShown.replace('bp ', '').split('..').map(Number);
    expect([winStart, winEnd], windowShown).toEqual([6_001, 42_001]);
    const inWindow = spcas9.filter((cut) => cut >= winStart && cut <= winEnd).length;
    expect(
      inWindow,
      'more candidates cut inside the window than the 40 listed, so a count over the list cannot reach it'
    ).toBeGreaterThan(40);

    // The engine's own numbers are the oracle's, and its sentences name the same totals.
    const headline = `Found ${fmt(spcas9.length)} SpCas9 and ${fmt(cas12a.length)} Cas12a candidate guides; listing the top 40 and top 25;`;
    expect(step.findingSummary.startsWith(headline), step.findingSummary).toBe(true);
    const sentences = [
      `Guide list capped: it shows the 40 highest-scoring of the ${fmt(spcas9.length)} candidate guides found.`,
      `Guide list capped: it shows the 25 highest-scoring of the ${fmt(cas12a.length)} candidate guides found.`,
    ];
    expect(step.warnings).toEqual(sentences);

    // The step's card shows both sentences in a ResultWarnings region, and the headline with them.
    const card = stepCard(layoutMarkup(report, stepIdx));
    expect(warningRegions(card)).toEqual([
      { label: 'Pipeline step warnings', sentences },
    ]);
    expect(text(card)).toContain(headline);
    // And the metric beside them: the oracle's total, and the oracle's count of the candidates
    // that cut inside the knockout window.
    const spMetric = step.metrics.find((m) => m.label === "SpCas9 (5'-NGG-3') Candidates")?.value ?? '';
    expect(spMetric).toBe(`${fmt(spcas9.length)} (${fmt(inWindow)} in KO window)`);
    expect(step.metrics.find((m) => m.label === "LbCas12a (5'-TTTV-3') Candidates")?.value).toBe(
      fmt(cas12a.length)
    );
    expect(text(card)).toContain(spMetric);

    // The studio itself draws that card: given the same report with the gRNA step first — the step
    // a server render focuses — the region and its sentences are in the card it writes.
    const grnaFirst = {
      ...report,
      steps: [step, ...report.steps.filter((s) => s.id !== 'grna-ranking')],
    };
    const drawn = stepCard(studioMarkup(grnaFirst));
    expect(warningRegions(drawn)).toEqual([{ label: 'Pipeline step warnings', sentences }]);
    expect(text(drawn)).toContain(headline);

    // A step with nothing to warn about shows no region at all: the knockout window step, which
    // the studio focuses on the report as the engine ordered it.
    expect(report.steps[0].id).toBe('ko-window');
    expect(report.steps[0].warnings ?? []).toEqual([]);
    expect(warningRegions(stepCard(studioMarkup(report)))).toEqual([]);
  }, 90_000);
});
