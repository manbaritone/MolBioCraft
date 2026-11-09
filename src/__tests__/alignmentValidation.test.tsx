// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAlignmentConsensusAndIdentity as consensus, computeNonEndGapPairwiseMetric as metric } from '../core/alignmentAnalysis';
import { alignmentInputError, runValidatedAlignment } from '../core/alignmentExecution';
import { formatAlignmentText } from '../core/alignmentExport';
import {
  atByColumn, colorSchemesFor, computeDotplot, countDifferences, framePlot,
  meanPairwiseIdentity, residueCellStyle, smooth, translateAlignedRow, translateCodon,
  transferAnnotations, GENETIC_CODE_NAMES, reverseComplementAligned,
} from '../core/alignmentViewModel';
import * as bio from '../core/bioEngine';
import { SequenceAlignmentStudio, VIRTUAL_GEL_STAINS } from '../components/AlignmentAndPhyloStudio';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

const dna: SequenceDocument = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'a', name: 'DNA A', sequence: 'ACGTACGT', folder: 'Local' };
const dna2 = { ...dna, id: 'b', name: 'DNA B', sequence: 'ACGTTACGT' };
afterEach(() => vi.restoreAllMocks());

describe('alignment calculations and settings', () => {
  it('distinguishes nucleotide ambiguity from protein ties', () => {
    const rows = [{ sequence: 'AC' }, { sequence: 'GT' }];
    expect(consensus(rows, 'Majority', true).consensus).toBe('RY');
    expect(consensus(rows, 'Majority', true, true).consensus).toBe('XX');
  });

  it.each(['0%', '50%', '65%', '75%', '85%', '90%', '95%', '100%', 'Majority'])('honours threshold %s on invariant and all-gap sites', (threshold) => {
    expect(consensus([{ sequence: 'A-' }, { sequence: 'A-' }], threshold, true))
      .toEqual({ consensus: 'A-', identityByCol: [1, 0], identicalSitesCount: 1 });
  });

  it('honours gap participation and cumulative nucleotide thresholds', () => {
    const rows = [{ sequence: 'A' }, { sequence: '-' }, { sequence: '-' }];
    expect(consensus(rows, '100%', false).consensus).toBe('-');
    expect(consensus(rows, '100%', true).consensus).toBe('A');
    expect(consensus([{ sequence: 'A' }, { sequence: 'G' }], '100%', true).consensus).toBe('R');
  });

  it.each([false, true])('provides finite styles for every offered palette (protein=%s)', (protein) => {
    for (const { value } of colorSchemesFor(protein)) {
      for (const ch of protein ? 'ACDEFGHIKLMNPQRSTVWYX*-' : 'ACGTURYSWKMBDHVN-') {
        const style = residueCellStyle(ch, { scheme: value, isProtein: protein, translatedAa: 'M', refChar: 'A' }, false);
        expect(style.background).not.toMatch(/NaN|undefined/);
        expect(style.color.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates all 64 codons for every offered genetic code', () => {
    for (const code of GENETIC_CODE_NAMES) {
      for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG')
        expect(translateCodon(a + b + c, code)).toMatch(/^[ACDEFGHIKLMNPQRSTVWY*]$/);
    }
  });

  it('places reverse-strand translation and numbering at original alignment columns', () => {
    const aligned = 'TTA--TTTCAT'; // reverse complement encodes ATG AAA TAA
    const result = translateAlignedRow(aligned, 0, 'Standard (1)', 1, 9, -1);
    expect(result.aaAtCol[9]).toBe('M');
    expect(result.aaAtCol[6]).toBe('K');
    expect(result.aaAtCol[1]).toBe('*');
    expect(result.aaIndexAtCol[9]).toBe(1);
    expect(result.aaIndexAtCol[1]).toBe(3);
  });

  it('skips introns and honours codon_start for joined CDS translation', () => {
    const result = translateAlignedRow('CATNNNGAAA', 1, 'Standard (1)', 1, 10, 1,
      [{ start: 1, end: 3 }, { start: 7, end: 10 }]);
    expect(result.aaAtCol.filter(Boolean)).toEqual(['M', 'K']);
    expect(result.aaCoverAtCol.slice(3, 6)).toEqual(['', '', '']);
  });

  it('uses precisely the requested even or odd smoothing window', () => {
    expect(smooth([0, 2, 4, 6], 2)).toEqual([1, 3, 5, 6]);
    expect(smooth([0, 2, 4, 6], 3)).toEqual([1, 2, 4, 5]);
    expect(smooth([1, 2], Number.NaN)).toEqual([1, 2]);
  });

  it('does not report gap or unknown columns as AT', () => {
    expect(atByColumn(['A-NG', 'T-NC'], 4)).toEqual([1, 0, 0, 0]);
  });

  it('keeps codon frames in ungapped coordinates', () => {
    const frames = framePlot('G--ATGAT', 100);
    expect(frames[0]).toEqual(Array(8).fill(1));
    expect(frames[1]).toEqual(Array(8).fill(0));
    expect(frames[2]).toEqual(Array(8).fill(0));
  });

  it('counts trailing residues and safely transfers to short rows', () => {
    expect(countDifferences('AC', 'ACGT')).toBe(2);
    // Identity is measured over the overlap only: the short row's missing tail is an end gap.
    expect(meanPairwiseIdentity(['AC', 'ACGT'])).toBe(100);
    expect(meanPairwiseIdentity(['ACGT', 'AGGT'])).toBe(75);
    const features = [[{ id: 'f', name: 'CDS', type: 'CDS', start: 1, end: 4, strand: 1 as const, color: '#f00' }], []];
    expect(transferAnnotations(['ACGT', 'AC'], features, [0, 99], 40).get(1)?.[0]).toMatchObject({ start: 1, end: 2 });
  });

  it.each(['identity', 'diffs', 'p-dist', 'jc69', 'k2p'] as const)('reports no overlap as missing for %s', (method) => {
    expect(metric('AC--', '--GT', method)).toBeNaN();
  });

  it('handles model saturation and pairwise deletion rather than fabricating finite distances', () => {
    expect(metric('AAAA', 'CCCC', 'jc69')).toBe(Infinity);
    expect(metric('AAAA', 'GGGG', 'k2p')).toBe(Infinity);
    expect(metric('AN-T', 'AGCT', 'k2p')).toBeCloseTo(0);
    expect(metric('AU', 'AT', 'jc69')).toBeCloseTo(0);
    expect(metric('ACGT', 'ACGA', 'p-dist')).toBe(0.25);
    expect(metric('ACGT', 'ACGA', 'identity')).toBe(75);
  });

  it('maps reverse dotplot segments to original coordinates and bounds repetitive output', () => {
    const x = 'ACGTTGCAAGT';
    const result = computeDotplot(x, reverseComplementAligned(x), x.length, true, false);
    expect(result.segments).toContainEqual({ x: 0, y: 0, len: x.length, strand: -1 });
    const limited = computeDotplot('A'.repeat(20), 'A'.repeat(20), 2, false, false, 3);
    expect(limited.segments.length).toBeLessThanOrEqual(3);
    expect(limited.truncated).toBe(true);
    expect(computeDotplot('ACGT', 'ACGT', 2, true, true).segments.every((s) => s.strand === 1)).toBe(true);
  });
});

describe('alignment execution and data integrity', () => {
  it('rejects over-limit, empty and unsupported residues explicitly', () => {
    expect(alignmentInputError([{ ...dna, sequence: 'A'.repeat(2401) }], 2400)).toContain('No partial alignment');
    expect(alignmentInputError([{ ...dna, sequence: '--' }], 2400)).toContain('no residues');
    expect(alignmentInputError([{ ...dna, sequence: 'MKT*' }], 2400)).toContain('stop symbols');
    expect(alignmentInputError([dna], 2400)).toBeNull();
  });

  it('auto-aligns full-length HIV env genes (2,520-2,628 nt) without hitting the residue cap', async () => {
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const members = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-hiv-env')!.alignmentMeta!.sequences!;
    expect(Math.max(...members.map((m) => m.sequence.length))).toBeLessThanOrEqual(bio.MSA_MAX_RESIDUES);
    const { result, error } = runValidatedAlignment(
      members.map((m) => ({ id: m.id, name: m.name, sequence: m.sequence, moleculeType: 'DNA' })), '');
    expect(error).toBeNull();
    expect(result.rows).toHaveLength(members.length);
    expect(alignmentInputError([{ ...dna, sequence: 'A'.repeat(bio.MSA_MAX_RESIDUES + 1) }], bio.MSA_MAX_RESIDUES)).toContain('No partial alignment');
  }, 30000);

  it.each([
    'consistency-nj',
    'progressive-upgma',
    'consistency-upgma',
    'graph-backbone',
    'MAFFT (FFT-NS-i / L-INS-i)',
    'Clustal Omega (HMM)',
    'MUSCLE (Iterative)',
    'POA (rust-bio Partial-Order Graph)',
  ])('preserves every row and residue for %s', (algorithm) => {
    const inputs = [dna, dna2, { ...dna, id: 'c', sequence: 'ACGT' }];
    const { result, error } = runValidatedAlignment(inputs, algorithm);
    expect(error).toBeNull();
    for (const input of inputs) expect(result.rows.find((r) => r.id === input.id)?.alignedSeq.replace(/-/g, '')).toBe(input.sequence);
  });

  it('rejects lossy or malformed backend output rather than assigning it to another member', () => {
    vi.spyOn(bio, 'runMultipleSequenceAlignment').mockReturnValue({
      rows: [{ id: 'a', name: 'wrong', alignedSeq: 'AC', identityToConsensusPct: 100 }],
      consensus: 'AC', conservation: [1, 1], newickTree: '();',
    });
    expect(runValidatedAlignment([dna, dna2], 'POA').error).toContain('changed or omitted');
  });

  it('rejects gap-only columns from the backend and mixed molecule types before running', () => {
    vi.spyOn(bio, 'runMultipleSequenceAlignment').mockReturnValue({
      rows: [
        { id: 'a', name: 'a', alignedSeq: 'ACGT-ACGT', identityToConsensusPct: 100 },
        { id: 'b', name: 'b', alignedSeq: 'ACGTTACGT', identityToConsensusPct: 100 },
      ],
      consensus: 'ACGTTACGT', conservation: [], newickTree: '();',
    });
    expect(runValidatedAlignment([dna, dna2], 'MAFFT').error).toBeNull();
    vi.restoreAllMocks();
    const protein = { ...dna, id: 'p', moleculeType: 'Protein' as const, sequence: 'MKTAY' };
    expect(runValidatedAlignment([dna, protein], 'MAFFT').error).toContain('nucleotide and protein');
  });

  it('turns residues tied at a percentage threshold into an ambiguity code', () => {
    const rows = [{ sequence: 'A' }, { sequence: 'A' }, { sequence: 'C' }, { sequence: 'C' }];
    expect(consensus(rows, '50%', true).consensus).toBe('M');
    expect(consensus([{ sequence: 'A' }, { sequence: 'A' }, { sequence: 'A' }, { sequence: 'C' }], '50%', true).consensus).toBe('A');
    expect(consensus(rows, '50%', true, true).consensus).toBe('X');
  });

  it('uses pairwise deletion for p-distance so indels are not counted as substitutions', () => {
    expect(metric('ACGTACGT', 'ACG--CGA', 'p-dist')).toBeCloseTo(1 / 6, 6);
    expect(metric('ACGTACGT', 'ACG--CGA', 'diffs')).toBe(3);
  });

  it('does not run hidden MSA or dotplot engines in pairwise mode', () => {
    const msa = vi.spyOn(bio, 'runMultipleSequenceAlignment');
    const dotplot = vi.spyOn(bio, 'computeDotplotHits');
    renderToStaticMarkup(<SequenceAlignmentStudio documents={[dna, dna2]} activeDoc={dna} initialSubMode="pairwise" />);
    expect(msa).not.toHaveBeenCalled();
    expect(dotplot).not.toHaveBeenCalled();
  });

  it.each(['nw', 'sw', 'banded-nw', 'banded-sw'] as const)('renders pairwise mode %s and handles an empty document list', (algorithm) => {
    expect(() => renderToStaticMarkup(<SequenceAlignmentStudio documents={[]} activeDoc={dna} initialSubMode="pairwise" initialPairwiseAlgorithm={algorithm} />)).not.toThrow();
  });

  it('does not substitute the alignment consensus for the first stored member', () => {
    const parent = { ...dna, id: 'parent', sequence: 'TTTT' };
    const pairwise = vi.spyOn(bio, 'alignPairwiseTypeScript');
    renderToStaticMarkup(<SequenceAlignmentStudio documents={[dna, dna2]} activeDoc={parent} initialSubMode="pairwise" />);
    expect(pairwise).toHaveBeenCalledWith(dna.sequence, dna2.sequence, false, 2, -3, -5, -2, 'DNA', 'blosum62');
  });

  it('shows a limit error rather than aligning a 720-base prefix', () => {
    const long = { ...dna, sequence: 'A'.repeat(bio.MSA_MAX_RESIDUES + 1) };
    const msa = vi.spyOn(bio, 'runMultipleSequenceAlignment');
    const html = renderToStaticMarkup(<SequenceAlignmentStudio documents={[long, dna2]} activeDoc={long} />);
    expect(msa).not.toHaveBeenCalled();
    expect(html).toContain('No partial alignment was run');
  });

  it('uses protein units and does not run nucleotide dotplots on proteins', () => {
    const protein = { ...dna, moleculeType: 'Protein' as const, sequence: 'MKR' };
    const html = renderToStaticMarkup(<SequenceAlignmentStudio documents={[protein]} activeDoc={protein} initialSubMode="pairwise" />);
    expect(html).toContain('(3 aa)');
    const dotplot = vi.spyOn(bio, 'computeDotplotHits');
    renderToStaticMarkup(<SequenceAlignmentStudio documents={[protein]} activeDoc={protein} initialSubMode="dotplot" />);
    expect(dotplot).not.toHaveBeenCalled();
  });
});

describe('full alignment text exports', () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ name: `Same taxon ${i}`, sequence: 'ACGT'.repeat(201) }));
  it.each(['FASTA', 'Clustal', 'PHYLIP', 'NEXUS'] as const)('emits complete %s rather than custom text or truncated rows', (format) => {
    const text = formatAlignmentText(rows, format, 'DNA');
    expect(text.replace(/[^ACGT]/g, '').length).toBeGreaterThanOrEqual(17 * 804);
    if (format === 'FASTA') expect(text.match(/^>/gm)).toHaveLength(17);
    if (format === 'Clustal') expect(text).toMatch(/^CLUSTAL/);
    if (format === 'PHYLIP') {
      expect(text.split('\n')[0]).toBe('17 804');
      expect(new Set(text.split('\n').slice(1).map((line) => line.slice(0, 10))).size).toBe(17);
    }
    if (format === 'NEXUS') {
      expect(text).toContain('NTAX=17 NCHAR=804');
      expect(text).toContain('DATATYPE=DNA');
    }
  });
});

describe('virtual gel dark version and UV transilluminator simulation', () => {
  it('provides scientific dark stain presets with fluorescent filters and print mode', () => {
    expect(VIRTUAL_GEL_STAINS.length).toBeGreaterThanOrEqual(5);
    const ids = VIRTUAL_GEL_STAINS.map((s) => s.id);
    expect(ids).toContain('etbr');
    expect(ids).toContain('silver');
    expect(ids).toContain('sybr');
    expect(ids).toContain('gelred');
    expect(ids).toContain('inverted');

    const etbr = VIRTUAL_GEL_STAINS.find((s) => s.id === 'etbr')!;
    expect(etbr.isDark).toBe(true);
    expect(etbr.filterId).toBe('gel-glow-etbr');
    expect(etbr.bandBody).toContain('#ff8c38');

    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    expect(inverted.isDark).toBe(false);
  });

  it('renders virtual gel with dark UV transilluminator cassette, 3D wells, and fluorescent bands', () => {
    const coiDoc: SequenceDocument = {
      ...dna,
      id: 'coi-assembly',
      name: 'COI Assembly',
      sequence: 'A'.repeat(658),
    };
    const html = renderToStaticMarkup(
      <SequenceAlignmentStudio
        documents={[coiDoc]}
        activeDoc={coiDoc}
        initialInspectorTab="virtual-gel"
      />
    );
    expect(html).toContain('mbc-virtual-gel-svg');
    expect(html).toContain('COI Assembly');
    expect(html).toContain('10bp DNA Ladder');
    expect(html).toContain('gel-glow-etbr');
    expect(html).toContain('(-) CATHODE');
    expect(html).toContain('(+) ANODE');
    expect(html).toContain('Dye Front (BPB)');
  });
});
