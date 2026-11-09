// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { classifySites } from '../core/siteCategories';

describe('alignment site categories', () => {
  //            col: 0 1 2 3 4 5
  const rows = ['AAAAAA', 'AACAG-', 'AACCGA', 'AAGTAA'];
  it('conserved, variable, singleton and parsimony-informative sites', () => {
    expect(classifySites(rows, 'conserved')).toEqual([0, 1, 5]);
    expect(classifySites(rows, 'variable')).toEqual([2, 3, 4]);
    expect(classifySites(rows, 'singleton')).toEqual([2, 3]);       // A,C,C,G and A,A,C,T: one type occurs twice
    expect(classifySites(rows, 'parsimony')).toEqual([4]);          // A,G,G,A: two types each twice
  });
  it('degenerate positions of a codon alignment', () => {
    // CTG (Leu): 1st position 2-fold (CTG/TTG), 2nd 0-fold, 3rd 4-fold. GCT (Ala): 1st 0, 2nd 0, 3rd 4.
    const codons = ['CTGGCT', 'CTAGCC'];
    expect(classifySites(codons, 'four-fold')).toEqual([2, 5]);
    expect(classifySites(codons, 'zero-fold')).toEqual([1, 3, 4]);
    expect(classifySites(codons, 'two-fold')).toEqual([0]);
  });
});

describe('Highlight Sites runner', () => {
  it('annotates the COXII alignment and records counts, replacing earlier highlights', async () => {
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const { runHighlightSites, SITE_NOTE } = await import('../core/operationRunners');
    const doc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const r = runHighlightSites(doc, { variable: true, parsimony: true, 'four-fold': true, geneticCode: 'Standard' });
    const out = r.updated[0];
    const hl = out.features.filter((f) => f.notes === SITE_NOTE);
    expect(hl.length).toBeGreaterThan(0);
    expect(Number(out.docMetadata?.['Parsimony-informative sites'])).toBeGreaterThan(0);
    expect(Number(out.docMetadata?.['Variable sites'])).toBeGreaterThanOrEqual(Number(out.docMetadata?.['Parsimony-informative sites']));
    expect(r.summary).toMatch(/Variable: \d+/);
    const again = runHighlightSites(out, { variable: true, geneticCode: 'Standard' });
    expect(again.updated[0].features.filter((f) => f.notes === SITE_NOTE).every((f) => f.qualifiers?.category === 'Variable')).toBe(true);
  });
});
