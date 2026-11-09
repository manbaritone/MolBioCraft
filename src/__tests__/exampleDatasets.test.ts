// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATASETS } from '../core/exampleDatasets';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { phylogenySourceDocuments } from '../core/documentViews';
import { groupOf, runComputeDistances, runCondenseTree, runGeneDuplications } from '../core/operationRunners';

const build = (id: string) => EXAMPLE_DATASETS.find((e) => e.id === id)!.build(SAMPLE_LIBRARY);

describe('example data behaves as described', () => {
  it('grouped COII: five groups and between-group means', () => {
    const [aln] = build('grouped-coii');
    const rows = phylogenySourceDocuments(aln, [], SAMPLE_LIBRARY);
    expect(new Set(rows.map(groupOf))).toEqual(new Set(['Primates', 'Birds', 'Other mammals', 'Reptiles & amphibians', 'Fish']));
    const r = runComputeDistances(rows, { analysis: 'net', model: 'p-distance' }, { sourceLabel: 'COII' });
    expect(String(r.created[0].docMetadata?.Notes)).toMatch(/Birds – Fish|Fish – Birds|Primates – Birds|Birds – Primates/);
  });
  it('globin trees: one duplication', () => {
    const [gene, species] = build('globin-duplication');
    const r = runGeneDuplications(gene, species, { speciesFrom: 'suffix', separator: '_' }, { sourceLabel: 'x' });
    expect(r.created[0].docMetadata?.Duplications).toBe(1);
    expect(r.created[0].docMetadata?.Speciations).toBe(6);
  });
  it('supported tree: condensing at 50% collapses only the 41% branch (the root label is ignored)', () => {
    const [tree] = build('supported-tree');
    const r = runCondenseTree(tree, { cutoff: 50 }, { sourceLabel: 'x' });
    expect(r.created[0].docMetadata?.['Collapsed branches']).toBe(1);
  });
});
