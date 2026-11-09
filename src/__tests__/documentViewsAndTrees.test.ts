// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { phylogenySourceDocuments, preferredViewerTab, relevantViewerTabs } from '../core/documentViews';
import { createTreeDocument, extractNewickTree } from '../core/treeDocuments';
import { layoutNewickPhylogeneticTreeRust } from '../lib/rustBioEngine';
import { parsePdbCaCoordinates } from '../core/genomicsAndStructureSuite';
import type { SequenceDocument } from '../types/bio';

// Small original fixtures keep clean-checkout tests independent of ignored reference folders.
const peopleNexus = `#NEXUS
BEGIN TREES;
TREE people = [&R] ((Adam:0.1,Eve:0.2):0.3,(Cain:0.2,Abel:0.1):0.2,Seth:0.4);
END;`;
const proteinComplexPdb = `ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 20.00           C
ATOM      2  CA  GLY A   2       2.000   3.000   4.000  1.00 20.00           C
ATOM      3  CA  SER A   3       3.000   4.000   5.000  1.00 20.00           C
END`;
const caffeinePdb = `HETATM    1  C1  CAF A   1       1.000   2.000   3.000  1.00 20.00           C
END`;

const baseDoc: SequenceDocument = {
  id: 'test', name: 'Test', accession: '', description: '', moleculeType: 'DNA',
  topology: 'linear', sequence: 'ACGTACGT', features: [], primers: [], history: [],
  createdAt: '', updatedAt: '', folder: 'Genomes/Human',
};

describe('document-aware views and tree imports', () => {
  it('suggests DNA, protein, primer, Sanger, and tree tools from data and task', () => {
    const genomeTabs = relevantViewerTabs(baseDoc);
    expect(genomeTabs).not.toContain('genomics-ngs');
    expect(genomeTabs).not.toContain('primers-pcr');
    expect(genomeTabs).not.toContain('cloning-gel');

    const protein: SequenceDocument = { ...baseDoc, id: 'protein', moleculeType: 'Protein', folder: 'Protein Documents' };
    expect(relevantViewerTabs(protein)).not.toContain('primers-pcr');
    expect(relevantViewerTabs(protein)).not.toContain('vector-library');
    expect(relevantViewerTabs(protein, [protein, { ...protein, id: 'protein-2' }])).toContain('sequence-alignment');

    const primer: SequenceDocument = { ...baseDoc, documentKind: 'primer', folder: 'Primers' };
    expect(relevantViewerTabs(primer)).not.toContain('primers-pcr');
    expect(relevantViewerTabs(primer)).not.toContain('cloning-gel');

    const trace: SequenceDocument = { ...baseDoc, documentKind: 'trace', folder: 'Contig Assembly' };
    expect(preferredViewerTab(trace)).toBe('sanger-contig');
    expect(relevantViewerTabs(trace)).toContain('sanger-contig');

    const tree: SequenceDocument = { ...baseDoc, documentKind: 'tree', folder: 'Tree Documents', sequence: '' };
    expect(relevantViewerTabs(tree)).toEqual(['text-view', 'phylogenetics', 'history-hybrid', 'document-info']);
    expect(preferredViewerTab(tree)).toBe('phylogenetics');
  });

  it('opens NEXUS trees as real topologies', () => {
    const doc = createTreeDocument(peopleNexus, '0137_People.tree1.nex');
    expect(doc.documentKind).toBe('tree');
    expect(doc.sequence).toBe('');
    expect(doc.docMetadata?.Newick).toContain('Adam');
    expect(doc.docMetadata?.Newick).not.toContain('First Residues');
    expect(doc.docMetadata?.['No. tips']).toBe(5);
    const layout = layoutNewickPhylogeneticTreeRust(String(doc.docMetadata?.Newick), 'phylogram', 900, 520);
    expect(layout.tipCount).toBe(5);
  });

  it('parses standalone Newick and rejects non-tree text', () => {
    expect(extractNewickTree("[&R] ('Alpha taxon':0.1,B:0.2);")).toBe("('Alpha taxon':0.1,B:0.2);");
    expect(() => extractNewickTree('>sequence\nACGT')).toThrow();
  });

  it('distinguishes protein coordinates from small-molecule PDB content', () => {
    expect(parsePdbCaCoordinates(proteinComplexPdb)).toHaveLength(3);
    expect(parsePdbCaCoordinates(caffeinePdb)).toHaveLength(0);
  });

  it('uses only the active alignment or explicitly selected taxa for phylogeny', () => {
    const embedded = [
      { id: 'taxon-a', name: 'A', sequence: 'ACGT' },
      { id: 'taxon-b', name: 'B', sequence: 'ACGA' },
    ];
    const alignment: SequenceDocument = {
      ...baseDoc, id: 'alignment', documentKind: 'alignment', folder: 'Alignments',
      alignmentMeta: { sequences: embedded },
    };
    const unrelatedProtein: SequenceDocument = {
      ...baseDoc, id: 'other', moleculeType: 'Protein', sequence: 'MATT', folder: 'Protein Documents',
    };
    expect(phylogenySourceDocuments(alignment, [], [alignment, unrelatedProtein]).map((d) => d.id))
      .toEqual(['taxon-a', 'taxon-b']);
    expect(phylogenySourceDocuments(baseDoc, [baseDoc, unrelatedProtein], [baseDoc, unrelatedProtein]))
      .toEqual([]);
    const secondDna = { ...baseDoc, id: 'dna-b', sequence: 'ACGA' };
    expect(phylogenySourceDocuments(baseDoc, [baseDoc, secondDna], [baseDoc, secondDna, unrelatedProtein]).map((d) => d.id))
      .toEqual(['test', 'dna-b']);
  });
});
