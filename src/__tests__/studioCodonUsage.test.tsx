// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6XBAC (D0097): the phylogenetics studio's Models-tab codon usage table. The studio aligns
 * unaligned inputs first with the nucleotide aligner, which puts gaps inside codon slots, and
 * codon usage reads an alignment by column. Codon usage needs no alignment, so on unaligned inputs
 * the table reads each input's own sequence in triplets from its first base, as the analysis menu
 * does. Every count is the real WASM engine's.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhylogeneticsStudio } from '../components/AlignmentAndPhyloStudio';
import { runValidatedAlignment } from '../core/alignmentExecution';
import { isPreAlignedInputSet } from '../core/documentViews';
import { codingAlignmentRefusal, runEvolutionAnalysis } from '../core/evolutionAnalyses';
import { computeRelativeSynonymousCodonUsage } from '../core/phyloEvoEngine';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';

const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
/** The 12 COXII CDSs without their gaps, as separate unaligned documents. */
const raw: SequenceDocument[] = aln.alignmentMeta!.sequences!.slice(0, 12).map((m, i) => ({
  ...aln, id: `cds${i}`, name: m.name, sequence: m.sequence.replace(/-/g, ''), alignmentMeta: undefined, features: [], documentKind: undefined,
} as SequenceDocument));

const engineCounts = (rows: string[]) =>
  new Map(computeRelativeSynonymousCodonUsage(rows).filter((r) => r.count > 0).map((r) => [r.codon, r.count]));
const sumOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** The Observed Count column of the rendered codon usage table, keyed by codon (zero counts left out). */
function tableCounts(html: string): Map<string, number> {
  const table = html.split('Relative Synonymous Codon Usage (RSCU)').pop()!;
  const m = new Map<string, number>();
  for (const [, codon, count] of table.matchAll(/<tr><td><code>([ACGT]{3})<\/code><\/td><td><strong>[^<]*<\/strong><\/td><td>(\d+)<\/td>/g)) {
    if (Number(count) > 0) m.set(codon, Number(count));
  }
  return m;
}

describe('phylogenetics studio codon usage', () => {
  it('the models tab counts unaligned inputs in their own frame', () => {
    expect(isPreAlignedInputSet(raw)).toBe(false);
    // Each CDS read on its own: 2,734 codons (Sparrow's two ambiguity-code slots count none).
    const expected = new Map<string, number>();
    for (const d of raw) for (const [c, n] of engineCounts([d.sequence.toUpperCase()])) expected.set(c, (expected.get(c) ?? 0) + n);
    expect(sumOf(expected)).toBe(2734);
    // The studio's own realignment, read by column, would count 2,694 out-of-frame codons.
    const exec = runValidatedAlignment(raw.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence, moleculeType: d.moleculeType })), '');
    expect(exec.error).toBeNull();
    expect(sumOf(engineCounts(exec.result.rows.map((r) => r.alignedSeq.toUpperCase())))).toBe(2694);

    const html = renderToStaticMarkup(
      <PhylogeneticsStudio documents={raw} activeDoc={raw[0]} initialPhyloTab="models" initialModelsSubView="rscu" />,
    );
    const shown = tableCounts(html);
    expect(sumOf(shown)).toBe(2734);
    expect([...shown].sort()).toEqual([...expected].sort());
  });

  it('the models tab strips gaps from unaligned inputs', () => {
    // Gapped rows of unequal length are no alignment, so each is read on its own: its gaps ('-' and
    // '.') come out first, then the rest reads in triplets from its first base (D0097). Ungapped,
    // the rows hold 3 + 4 + 3 codons; read with its gap, each gapped row goes out of frame after it.
    const seqs = ['ATG-AAACCC', 'ATGAAACCCGGG', 'ATGAA.ACCC'];
    const docs = seqs.map((sequence, i) => ({ ...raw[0], id: `g${i}`, name: `g${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(docs)).toBe(false);
    expect(sumOf(engineCounts(seqs))).toBeLessThan(10);
    const html = renderToStaticMarkup(
      <PhylogeneticsStudio documents={docs} activeDoc={docs[0]} initialPhyloTab="models" initialModelsSubView="rscu" />,
    );
    expect(tableCounts(html)).toEqual(new Map([['ATG', 3], ['AAA', 3], ['CCC', 3], ['GGG', 1]]));
  });

  it('the models tab reads an alignment the user gave by column', () => {
    // A frame-2 translation alignment: each row has a lead slot "--X", five codons and a trail
    // slot. Read by column it holds 20 codons; its ungapped rows read from their first base would
    // be out of frame.
    const bodies = ['ATGAAACCCGGGTTT', 'ATGAAGCCAGGGTTC', 'ATGAAACCCGGATTT', 'ATGCAACCCGGGTAT'];
    const leads = ['C', 'T', 'G', 'A'];
    const trails = ['GC-', '---', 'TA-', '---'];
    const rows = bodies.map((b, i) => `--${leads[i]}${b}${trails[i]}`);
    const docs = rows.map((sequence, i) => ({ ...raw[0], id: `f2-${i}`, name: `f2-${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(docs)).toBe(true);
    expect(sumOf(engineCounts(rows.map((r) => r.replace(/-/g, ''))))).not.toBe(20);
    const html = renderToStaticMarkup(
      <PhylogeneticsStudio documents={docs} activeDoc={docs[0]} initialPhyloTab="models" initialModelsSubView="rscu" />,
    );
    const shown = tableCounts(html);
    expect(sumOf(shown)).toBe(20);
    expect([...shown].sort()).toEqual([...engineCounts(bodies)].sort());
  });

  it('refuses a pre-aligned input whose width is not a multiple of 3 for codon usage in both the studio and the menu', () => {
    // Pre-aligned user inputs carrying a 1-column (width 10) or 2-column (width 11) indel.
    const width10 = ['ATG-AAACCC', 'ATGA-AACCC', 'ATGAA-ACCC'];
    const width11 = ['ATG--AAACCC', 'ATGA--AACCC', 'ATGAA--ACCC'];
    for (const seqs of [width10, width11]) {
      const docs = seqs.map((sequence, i) => ({ ...raw[0], id: `w${seqs[0].length}-${i}`, name: `w${i}`, sequence } as SequenceDocument));
      expect(isPreAlignedInputSet(docs)).toBe(true);
      const expectedRefusal = codingAlignmentRefusal(seqs, 'rscu', { ownFrame: false });
      expect(expectedRefusal).toBe('Codon usage needs a coding alignment whose length is a multiple of 3.');

      expect(() => runEvolutionAnalysis(docs, 'models', { analysis: 'rscu' }, { sourceLabel: 'COXII' })).toThrow(expectedRefusal!);

      const html = renderToStaticMarkup(
        <PhylogeneticsStudio documents={docs} activeDoc={docs[0]} initialPhyloTab="models" initialModelsSubView="rscu" />,
      );
      expect(html).toContain(expectedRefusal!);
      expect(html).not.toContain('aria-label="Relative Synonymous Codon Usage (RSCU)"');
      expect(tableCounts(html).size).toBe(0);
    }
  });

  it('refuses selection tests in both the studio and the menu on a pre-aligned input whose width is not a multiple of 3', () => {
    const width10 = ['ATG-AAACCC', 'ATGA-AACCC', 'ATGAA-ACCC', 'ATGAAG-CCC'];
    const width11 = ['ATG--AAACCC', 'ATGA--AACCC', 'ATGAA--ACCC', 'ATGAAG--CCC'];
    for (const seqs of [width10, width11]) {
      const docs = seqs.map((sequence, i) => ({ ...raw[0], id: `s${seqs[0].length}-${i}`, name: `s${i}`, sequence } as SequenceDocument));
      expect(isPreAlignedInputSet(docs)).toBe(true);
      const expectedRefusal = codingAlignmentRefusal(seqs, 'selection');
      expect(expectedRefusal).toBe('Selection tests need a coding alignment whose length is a multiple of 3 (codons from column 1).');

      for (const test of ['z-neutral', 'z-positive', 'z-purifying', 'fisher', 'tajima', 'codons']) {
        expect(() => runEvolutionAnalysis(docs, 'selection', { test }, { sourceLabel: 'COXII' })).toThrow(expectedRefusal!);
      }

      const html = renderToStaticMarkup(
        <PhylogeneticsStudio documents={docs} activeDoc={docs[0]} initialPhyloTab="selection" />,
      );
      expect(html).toContain(expectedRefusal!);
      expect(html).not.toContain('aria-label="Codon-Based Z-Test of Selection"');
      expect(html).not.toContain('aria-label="Site-by-Site Codon Selection Profile"');
    }
  });
});
