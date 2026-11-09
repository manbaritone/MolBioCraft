// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultHybridSubTab, genomicsTabsForDocument, hybridTabsForDocument } from '../core/analysisContext';
import * as genomics from '../core/genomicsAndStructureSuite';
import * as bio from '../core/bioEngine';
import { GenomicsNgsAndPredictionStudio } from '../components/GenomicsNgsAndPredictionStudio';
import { HybridToolsAndHistoryStudio } from '../components/HybridToolsAndHistoryStudio';
import type { SequenceDocument } from '../types/bio';

const dna: SequenceDocument = {
  id: 'dna', name: 'DNA', accession: '', description: '', moleculeType: 'DNA',
  topology: 'linear', sequence: 'ACGT'.repeat(30), features: [], primers: [], history: [],
  createdAt: '', updatedAt: '', folder: 'Genomes/Bacteria',
};
const protein: SequenceDocument = { ...dna, id: 'protein', moleculeType: 'Protein', sequence: 'MALWMRLLPLLALLALWGPDPAAA', folder: 'Protein Documents' };

afterEach(() => vi.restoreAllMocks());

describe('analysis context and deferred panels', () => {
  it('keeps DNA tools off proteins and RNA, and opens history for DNA', () => {
    expect(genomicsTabsForDocument(protein)).toEqual(['protein-3d']);
    expect(hybridTabsForDocument(protein)).not.toContain('enzymes-view');
    expect(hybridTabsForDocument({ ...dna, moleculeType: 'RNA' })).not.toContain('enzymes-view');
    expect(defaultHybridSubTab(dna)).toBe('lineage');
    expect(defaultHybridSubTab(protein)).toBe('protein');
    expect(defaultHybridSubTab({ ...dna, docMetadata: { 'Document Type': 'Enzyme Set' } })).toBe('enzymes-view');
  });

  it('opens a compatible protein panel without running hidden nucleotide analyses', () => {
    const trim = vi.spyOn(genomics, 'runBbdukReadTrimming');
    const assembly = vi.spyOn(genomics, 'runDeNovoAssembly');
    const variants = vi.spyOn(genomics, 'callFreeBayesVariants');
    const topology = vi.spyOn(genomics, 'predictCoiledCoilsAndTransmembrane');
    const html = renderToStaticMarkup(<GenomicsNgsAndPredictionStudio
      activeDoc={protein} documents={[dna, protein]} initialSubTab="ngs-assembly"
      onCreateDocument={() => {}} onUpdateActiveSequence={() => {}} onAppendFeatures={() => {}}
    />);
    expect(trim).not.toHaveBeenCalled();
    expect(assembly).not.toHaveBeenCalled();
    expect(variants).not.toHaveBeenCalled();
    expect(topology).toHaveBeenCalledTimes(1);
    expect(topology).toHaveBeenCalledWith(protein.sequence);
    expect(html).toContain('aa Analyzed');
  });

  it('runs the visible trim panel with its original parameters', () => {
    const trim = vi.spyOn(genomics, 'runBbdukReadTrimming');
    const variants = vi.spyOn(genomics, 'callFreeBayesVariants');
    renderToStaticMarkup(<GenomicsNgsAndPredictionStudio
      activeDoc={dna} documents={[dna]} initialSubTab="ngs-assembly"
      onCreateDocument={() => {}} onUpdateActiveSequence={() => {}} onAppendFeatures={() => {}}
    />);
    expect(trim).toHaveBeenCalledTimes(1);
    expect(trim).toHaveBeenCalledWith(dna.sequence, undefined, {
      kmerLen: 11, minPhredQuality: 20,
    });
    expect(variants).not.toHaveBeenCalled();
  });

  it('does not run protein or RNA folding analysis while reading history', () => {
    const proteinAnalysis = vi.spyOn(bio, 'analyzeProteinSequence');
    const folding = vi.spyOn(bio, 'predictSecondaryStructure');
    const html = renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={dna} allDocuments={[dna]} />);
    expect(proteinAnalysis).not.toHaveBeenCalled();
    expect(folding).not.toHaveBeenCalled();
    expect(html).toContain('History Tree');
  });

  it('does not offer codon optimization for a protein substrate', () => {
    const html = renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={protein} />);
    expect(html).not.toContain('Back-Translate &amp; Multi-Host Codon Optimizer');
    expect(html).toContain('Molecular Weight');
  });
});
