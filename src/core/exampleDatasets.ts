// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Example datasets for the evolution analyses (Help → Load Example Data…). They are built
 * from records already in the sample library or written here as small illustrative trees;
 * nothing is copied from another program's example files.
 */

import { encodeFsa, simulateFragmentRun, SIZE_STANDARDS } from './fragmentAnalysis';
import { fragmentDocumentFromFsa } from './operationRunners';
import { createTreeDocument } from './treeDocuments';
import type { SequenceDocument } from '../types/bio';

export const COXII_GROUPS: Record<string, string> = Object.fromEntries([
  ...['Orangutan', 'Gorilla', 'Chimpanzee', 'Human', 'Monkey', 'Baboon', 'Mangabey', 'Lemur'].map((n) => [n, 'Primates']),
  ...['Starling', 'Catbird', 'Sparrow', 'Warbler', 'Gnateater', 'Ostrich', 'Moa', 'Chicken', 'Spoonbill', 'Ibis'].map((n) => [n, 'Birds']),
  ...['Panda', 'Armadillo', 'Polar bear', 'Cow', 'Gazelle', 'Whale', 'Dolphin', 'Seal', 'Puma', 'Tiger', 'Pig', 'Warthog', 'Rhinoceros', 'Horse', 'Raccoon', 'Wolverine', 'Arctic Fox', 'Jackal', 'Dhole', 'Mouse', 'Rat', 'Mole', 'Chipmunk'].map((n) => [n, 'Other mammals']),
  ...['Sea Turtle', 'Salamander', 'Frog'].map((n) => [n, 'Reptiles & amphibians']),
  ...['Trout', 'Tuna', 'Seahorse', 'Eel', 'Loach', 'Carp'].map((n) => [n, 'Fish']),
]);

export interface ExampleSpec {
  id: string;
  title: string;
  description: string;
  /** What to try with it. */
  tryWith: string;
  build: (library: SequenceDocument[]) => SequenceDocument[];
}

const now = () => new Date().toISOString();
const exampleTree = (newick: string, name: string, description: string): SequenceDocument => {
  const base = createTreeDocument(newick, `${name}.nwk`);
  return { ...base, name, description, docMetadata: { ...base.docMetadata, 'Source Format': 'Example', Example: 'yes' } };
};

export const EXAMPLE_DATASETS: ExampleSpec[] = [
  {
    id: 'fragment-runs',
    title: 'Microsatellite fragment runs (simulated)',
    description: 'Three simulated capillary fragment-analysis runs with the GeneScan 500 LIZ size standard and three markers in 6-FAM, VIC and NED (with stutter peaks). Simulated data, for trying the workflow only.',
    tryWith: 'Annotate → Microsatellite Analysis… with “Insert example panel”, then open a run to see the sized electropherogram.',
    build: () => {
      const std = SIZE_STANDARDS['GeneScan 500 LIZ'];
      const samples: [string, { fam: [number, number]; vic: number; ned: [number, number] }][] = [
        ['Sample_01', { fam: [152, 158], vic: 172, ned: [182, 190] }],
        ['Sample_02', { fam: [154, 154], vic: 168, ned: [186, 194] }],
        ['Sample_03', { fam: [150, 160], vic: 176, ned: [182, 182] }],
      ];
      return samples.map(([name, al], k) => {
        const run = simulateFragmentRun(std, 3 + k, al);
        const doc = fragmentDocumentFromFsa(encodeFsa({ channels: run.channels, sample: name, dyeSet: 'G5 (simulated)' }), `Example ${name}.fsa`);
        return { ...doc, name: `Example – ${name} (simulated)`, docMetadata: { ...doc.docMetadata, Example: 'yes' } };
      });
    },
  },
  {
    id: 'grouped-coii',
    title: 'Vertebrate COII with taxonomic groups',
    description: 'The 50-sequence COXII alignment from the sample documents, with each sequence assigned to one of five groups (Primates, Other mammals, Birds, Reptiles & amphibians, Fish).',
    tryWith: 'Phylogenetics → Compute Distances… (within-, between- and net between-group means); Build Tree… with codon positions 1+2 only.',
    build: (lib) => {
      const src = lib.find((d) => d.id === 'doc-aln-coxii-cds');
      if (!src?.alignmentMeta?.sequences) return [];
      const t = now();
      return [{
        ...src,
        id: `example-coii-groups-${Date.now().toString(36)}`,
        name: 'Example – COII with groups',
        description: 'COXII alignment with taxonomic groups (Group: … on each sequence)',
        alignmentMeta: {
          ...src.alignmentMeta,
          sequences: src.alignmentMeta.sequences.map((m) => ({ ...m, description: `Group: ${COXII_GROUPS[m.name] ?? 'Other'}` })),
        },
        docMetadata: { ...(src.docMetadata ?? {}), Example: 'yes' },
        history: [{ id: `hist-ex-${Date.now().toString(36)}`, timestamp: t, operation: 'Load Example Data', description: 'Groups added for distance analysis', parentIds: [src.id], lengthBp: src.sequence.length, topology: 'linear' }],
        createdAt: t,
        updatedAt: t,
        folder: 'Alignments',
      }];
    },
  },
  {
    id: 'globin-duplication',
    title: 'Globin gene tree and species tree',
    description: 'An illustrative α/β-globin gene tree (one duplication before the divergence of the four species) and the matching species tree. Gene names end in the species (HBA_Human).',
    tryWith: 'Phylogenetics → Gene Duplication Inference… (gene tree = globin tree, species tree = vertebrate tree); expect 1 duplication.',
    build: () => [
      exampleTree('((((HBA_Human:0.08,HBA_Mouse:0.09):0.05,HBA_Chicken:0.15):0.06,HBA_Frog:0.2):0.15,(((HBB_Human:0.07,HBB_Mouse:0.08):0.05,HBB_Chicken:0.16):0.06,HBB_Frog:0.22):0.15);',
        'Example – Globin gene tree', 'Illustrative α/β-globin paralogue tree (not inferred from data)'),
      exampleTree('(((Human:0.9,Mouse:0.9):3.1,Chicken:4.0):3.5,Frog:7.5);', 'Example – Vertebrate species tree', 'Illustrative species tree for the four vertebrates'),
    ],
  },
  {
    id: 'supported-tree',
    title: 'Tree with bootstrap support',
    description: 'A small tree whose interior branches carry bootstrap percentages from 32% to 99%.',
    tryWith: 'Phylogenetics → Condense Tree… at 50% or 70%; Consensus Tree… needs two or more trees (build some with Build Tree… first).',
    build: () => [
      exampleTree('((((Human:0.01,Chimpanzee:0.012)99:0.02,Gorilla:0.025)88:0.01,Orangutan:0.04)95:0.03,((Baboon:0.03,Mangabey:0.028)62:0.01,Monkey:0.035)41:0.02,Lemur:0.09)32;',
        'Example – Primate tree with support', 'Illustrative primate tree with bootstrap support values'),
    ],
  },
];
