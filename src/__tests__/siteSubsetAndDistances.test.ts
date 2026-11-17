// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import { applySiteSubset } from '../core/siteSubset';
import { groupOf, runBuildTree, runComputeDistances } from '../core/operationRunners';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { phylogenySourceDocuments } from '../core/documentViews';
import type { SequenceDocument } from '../types/bio';

// Three 13-column rows written for this test (US-01M6TDSV). '-' is a gap and '?' a missing base.
//   column  1 2 3 4 5 6 7 8 9 10 11 12 13
//   r1      A C - T G A ? C T A  G  C  -
//   r2      A C G T - A C C T ?  G  C  ?
//   r3      A - G T G A C C C A  G  -  T
// Columns 2, 3, 5, 7, 10 and 12 lack a base in one row (2 of 3 have one: 66.7% coverage); column 13
// lacks it in two (33.3%); columns 1, 4, 6, 8, 9 and 11 have a base in every row.
const rows = ['AC-TGA?CTAGC-', 'ACGT-ACCT?GC?', 'A-GTGACCCAG-T'];

describe('site subset', () => {
  it('complete deletion keeps the 6 sites with no gap or missing base', () => {
    const r = applySiteSubset(rows, { gaps: 'complete', coveragePct: 95, codonPositions: [1, 2, 3] }, false);
    expect(r.kept).toBe(6);
    // Columns 1, 4, 6, 8, 9 and 11 of each row.
    expect(r.rows).toEqual(['ATACTG', 'ATACTG', 'ATACCG']);
  });
  it('partial deletion uses the site-coverage cutoff; pairwise deletion keeps every site', () => {
    expect(applySiteSubset(rows, { gaps: 'partial', coveragePct: 60, codonPositions: [] }, false).kept).toBe(12); // only column 13 (33.3%) falls below 60%
    expect(applySiteSubset(rows, { gaps: 'partial', coveragePct: 70, codonPositions: [] }, false).kept).toBe(6); // the 66.7% columns fall below 70% too
    expect(applySiteSubset(rows, { gaps: 'partial', coveragePct: 100, codonPositions: [] }, false).kept).toBe(6);
    expect(applySiteSubset(rows, { gaps: 'pairwise', coveragePct: 95, codonPositions: [] }, false).kept).toBe(13);
  });
  it('selects codon positions from the first column', () => {
    const r = applySiteSubset(['ATGGCTAAA'], { gaps: 'pairwise', coveragePct: 95, codonPositions: [1, 2] }, false);
    expect(r.rows[0]).toBe('ATGCAA');
    expect(r.note).toMatch(/codon positions 1\+2/);
  });
});

describe('Compute Distances', () => {
  const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
  const width = coxii.sequence.length;
  const rows = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 6);
  it('writes a lower-triangle matrix document with model and data subset', () => {
    const r = runComputeDistances(rows, { analysis: 'pairwise', model: 'Kimura 2-parameter (K2P)', gaps: 'complete' }, { sourceLabel: 'COXII' });
    const notes = String(r.created[0].docMetadata?.Notes);
    expect(notes).toMatch(/Model: Kimura 2-parameter \(K2P\)/);
    expect(notes).toMatch(new RegExp(`complete deletion: \\d+ of ${width} sites used`));
    expect(notes).toMatch(/Tab-separated/);
    expect(r.created[0].docMetadata?.['Document Type']).toBe('Text Document');
  });
  it('computes group means from "Group" metadata and refuses without groups', () => {
    const grouped = rows.map((d, i) => ({ ...d, docMetadata: { ...(d.docMetadata ?? {}), Group: i < 3 ? 'A' : 'B' } }));
    expect(groupOf(grouped[0])).toBe('A');
    const r = runComputeDistances(grouped, { analysis: 'between' }, { sourceLabel: 'x' });
    expect(String(r.created[0].docMetadata?.Notes)).toMatch(/A – B\t\d\.\d{4}/);
    expect(() => runComputeDistances(rows, { analysis: 'within' }, { sourceLabel: 'x' })).toThrow(/Group means need groups/);
  });
  it('Build Tree honours codon positions', async () => {
    // Codon positions 1 and 2 of the alignment's columns, counted from its first column.
    const pos12 = Array.from({ length: width }, (_, c) => c % 3 !== 2).filter(Boolean).length;
    const r = await runBuildTree(rows, { method: 'Neighbor-Joining (NJ)', pos3: false }, { sourceLabel: 'x' });
    expect(r.created[0].history[0].description).toMatch(new RegExp(`codon positions 1\\+2: ${pos12} of ${width} sites used`));
  });
});

// BG-01M7MQP8: on a protein alignment the report named the requested nucleotide model over the Poisson
// distance it computed. Three pre-aligned rows written for this test: 5 differences over 20 comparable
// residues between p1 and p2 (the gap and X columns are skipped), so the Poisson d = -ln(0.75) = 0.2877.
const protein = (id: string, sequence: string): SequenceDocument =>
  ({ id, name: id, accession: '', description: '', moleculeType: 'Protein', topology: 'linear', sequence, features: [], primers: [], history: [], createdAt: 0, updatedAt: 0 }) as unknown as SequenceDocument;
const proteins = [protein('p1', 'MKTAYIAKQRDEFGHLNPSW-X'), protein('p2', 'MKTAWIAKERDEFGHVNPTA-M')];
const noteFor = (m: string) => `Note: ${m} does not apply to proteins: the Poisson correction was computed instead.`;

describe('Compute Distances names the protein distance it computed (BG-01M7MQP8)', () => {
  for (const [label, opts, requested] of [
    ['Jukes-Cantor (JC69)', { model: 'Jukes-Cantor (JC69)' }, 'Jukes-Cantor (JC69)'],
    ['no model (the MCL default)', {}, 'Maximum Composite Likelihood (MCL)'],
  ] as const) {
    it(`BG-01M7MQP8 ${label} on a protein alignment is labelled Poisson correction with a note`, () => {
      const r = runComputeDistances(proteins, { analysis: 'pairwise', ...opts }, { sourceLabel: 'prot' });
      const doc = r.created[0];
      const lines = String(doc.docMetadata?.Notes).split('\n');
      const at = lines.indexOf('Model: Poisson correction');
      expect(at, lines.join('\n')).toBeGreaterThan(0);
      expect(lines[at + 1]).toBe(noteFor(requested));
      expect(lines.filter((l) => l.startsWith('Model:') || l.startsWith('Note:'))).toHaveLength(2);
      expect(doc.description).toBe('Poisson correction pairwise distances for 2 sequences');
      expect(doc.docMetadata?.['Distance model']).toBe('Poisson correction');
      expect(doc.history[0].description).toMatch(/^Poisson correction; /);
      expect(r.summary).toMatch(/^Poisson correction: overall mean 0\.2877 /);
      // The requested name appears only in the note.
      expect(JSON.stringify({ ...doc, docMetadata: { ...doc.docMetadata, Notes: '' } }) + r.summary).not.toContain(requested);
    });
  }
  it('BG-01M7MQP8 p-distance on a protein alignment keeps its label and writes no note', () => {
    const r = runComputeDistances(proteins, { analysis: 'pairwise', model: 'p-distance' }, { sourceLabel: 'prot' });
    const notes = String(r.created[0].docMetadata?.Notes);
    expect(notes).toMatch(/^Model: p-distance$/m);
    expect(notes).not.toMatch(/^Note:/m);
    expect(r.created[0].docMetadata?.['Distance model']).toBe('p-distance');
    expect(r.summary).toMatch(/^p-distance: overall mean 0\.2500 /);
  });
  it('BG-01M7MQP8 Poisson correction on a protein alignment writes no note', () => {
    const notes = String(runComputeDistances(proteins, { analysis: 'pairwise', model: 'Poisson correction' }, { sourceLabel: 'prot' }).created[0].docMetadata?.Notes);
    expect(notes).toMatch(/^Model: Poisson correction$/m);
    expect(notes).not.toMatch(/^Note:/m);
  });
  it('BG-01M7MQP8 the nucleotide K2P report is unchanged', () => {
    const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const rows = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 6);
    const r = runComputeDistances(rows, { analysis: 'pairwise', model: 'Kimura 2-parameter (K2P)' }, { sourceLabel: 'COXII' });
    const doc = r.created[0];
    expect(String(doc.docMetadata?.Notes)).toMatch(/^Model: Kimura 2-parameter \(K2P\)$/m);
    expect(String(doc.docMetadata?.Notes)).not.toMatch(/^Note:/m);
    expect(doc.description).toBe('Kimura 2-parameter (K2P) pairwise distances for 6 sequences');
    expect(doc.docMetadata?.['Distance model']).toBe('Kimura 2-parameter (K2P)');
    expect(doc.history[0].description).toMatch(/^Kimura 2-parameter \(K2P\); /);
    expect(r.summary).toMatch(/^Kimura 2-parameter \(K2P\): overall mean /);
  });
  it("BG-01M7MQP8 every label is the engine report's model and note, and a report with no model fails", async () => {
    // The engine's own words are written back verbatim, so a runner-side relabel cannot pass this.
    const engine = { model: 'ENGINE-MODEL' as string | undefined, modelNote: 'ENGINE-NOTE' as string | undefined };
    vi.resetModules();
    vi.doMock('../core/phyloEvoEngine', async (importOriginal) => {
      const real = await importOriginal<typeof import('../core/phyloEvoEngine')>();
      return {
        ...real,
        computeEvolutionaryDistances: (...a: Parameters<typeof real.computeEvolutionaryDistances>) => ({ ...real.computeEvolutionaryDistances(...a), ...engine }),
      };
    });
    try {
      const { runComputeDistances: run } = await import('../core/operationRunners');
      const r = run(proteins, { analysis: 'pairwise', model: 'Jukes-Cantor (JC69)' }, { sourceLabel: 'prot' });
      const lines = String(r.created[0].docMetadata?.Notes).split('\n');
      expect(lines[lines.indexOf('Model: ENGINE-MODEL') + 1]).toBe('Note: ENGINE-NOTE');
      expect(r.created[0].description).toMatch(/^ENGINE-MODEL /);
      expect(r.created[0].docMetadata?.['Distance model']).toBe('ENGINE-MODEL');
      expect(r.created[0].history[0].description).toMatch(/^ENGINE-MODEL; /);
      expect(r.summary).toMatch(/^ENGINE-MODEL: /);
      // No note from the engine: no Note line.
      engine.modelNote = undefined;
      expect(String(run(proteins, { analysis: 'pairwise' }, { sourceLabel: 'prot' }).created[0].docMetadata?.Notes)).not.toMatch(/^Note:/m);
      // A report naming no model (a stale engine) fails rather than falling back to the requested name.
      engine.model = undefined;
      expect(() => run(proteins, { analysis: 'pairwise', model: 'Jukes-Cantor (JC69)' }, { sourceLabel: 'prot' })).toThrow(/named no distance model/);
    } finally {
      vi.doUnmock('../core/phyloEvoEngine');
      vi.resetModules();
    }
  });
});
