// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { applySiteSubset } from '../core/siteSubset';
import { groupOf, runBuildTree, runComputeDistances } from '../core/operationRunners';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { phylogenySourceDocuments } from '../core/documentViews';

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
