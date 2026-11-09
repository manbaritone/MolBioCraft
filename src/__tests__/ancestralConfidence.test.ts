// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runEvolutionAnalysis } from '../core/evolutionAnalyses';
import { inferAncestralSequences, type AncestralReconstructionReport } from '../core/phyloEvoEngine';
import type { SequenceDocument } from '../types/bio';

// The real engine stays in place; the spy lets a test either read what the engine returned or
// hand the report formatter a known engine value.
vi.mock('../core/phyloEvoEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/phyloEvoEngine')>();
  return { ...actual, inferAncestralSequences: vi.fn(actual.inferAncestralSequences) };
});
const engine = vi.mocked(inferAncestralSequences);

const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
const members: SequenceDocument[] = aln.alignmentMeta!.sequences!.slice(0, 12).map((m, i) => ({
  ...aln, id: `m${i}`, name: m.name, sequence: m.sequence, alignmentMeta: undefined, features: [], documentKind: undefined,
} as SequenceDocument));
const ctx = { sourceLabel: 'COXII' };

/** The "Mean confidence" cell of each row of the report's node table, in row order. */
function confidenceCells(notes: string): string[] {
  const lines = notes.split('\n');
  const head = lines.findIndex((l) => /^Node\s.*Mean confidence$/.test(l));
  expect(head, 'the report has a node table').toBeGreaterThanOrEqual(0);
  const rows: string[] = [];
  for (const l of lines.slice(head + 2)) {
    if (!l.trim()) break;
    rows.push(l.trim().split(/\s{2,}/).at(-1)!);
  }
  return rows;
}

function reconstruct(method: 'ml' | 'mp'): { report: AncestralReconstructionReport; cells: string[] } {
  engine.mockClear();
  const r = runEvolutionAnalysis(members, 'ancestors', { method }, ctx);
  expect(engine).toHaveBeenCalledTimes(1);
  const report = engine.mock.results[0].value as AncestralReconstructionReport;
  return { report, cells: confidenceCells(String(r.created[0].docMetadata?.Notes)) };
}

describe('ancestral reconstruction report', () => {
  it("prints the engine's mean confidence percent unchanged for known engine values", () => {
    // The engine already reports a percent rounded to 0.1 (models_selection.rs). 0.5% is reachable
    // under parsimony (share of sites with a unique Fitch state), so a formatter that guesses
    // "below 1 means a fraction" is caught too; null is a node with no counted site.
    const known = [95.3, 0.5, 100, null, 62.5];
    const real = (vi.mocked(inferAncestralSequences).getMockImplementation())!;
    const base = real(members.map((m) => m.name), members.map((m) => m.sequence), 'Maximum Parsimony (Fitch)');
    expect(base.nodes.length).toBeGreaterThanOrEqual(known.length);
    const fixture: AncestralReconstructionReport = {
      ...base,
      nodes: base.nodes.map((n, k) => ({ ...n, meanPosteriorConfidence: known[k % known.length] })),
    };
    engine.mockClear();
    engine.mockReturnValueOnce(fixture);
    const r = runEvolutionAnalysis(members, 'ancestors', { method: 'mp' }, ctx);
    expect(engine).toHaveBeenCalledTimes(1);
    const cells = confidenceCells(String(r.created[0].docMetadata?.Notes));
    const printed = ['95.3%', '0.5%', '100.0%', 'n/a', '62.5%'];
    expect(cells).toEqual(fixture.nodes.map((_, k) => printed[k % printed.length]));
  });

  it.each(['ml', 'mp'] as const)("prints the engine's mean confidence percent unchanged, between 0%% and 100%%, on a real %s reconstruction", (method) => {
    const { report, cells } = reconstruct(method);
    expect(report.nodes.length).toBeGreaterThan(0);
    expect(cells).toHaveLength(report.nodes.length);
    const values = report.nodes.map((n) => n.meanPosteriorConfidence);
    expect(values.some((x) => x !== null), 'at least one node has a computed confidence').toBe(true);
    expect(cells).toEqual(values.map((x) => (x === null ? 'n/a' : `${x.toFixed(1)}%`)));
    for (const c of cells.filter((x) => x !== 'n/a')) {
      expect(c).toMatch(/^\d+(\.\d)?%$/);
      const v = Number(c.slice(0, -1));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
