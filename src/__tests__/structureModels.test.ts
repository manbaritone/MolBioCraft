// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { parsePdbCaCoordinates, synthesizeAlphaHelicalCaPdbFromProtein } from '../core/genomicsAndStructureSuite';
import { caAtomsToPdb, hasStructure, structureAtomsOf, structureChainCount } from '../core/structureModels';
import { computeDocumentTableMetrics } from '../core/workbenchBatchOperations';
import type { SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs).catch(() => null) as null | { existsSync: (p: string) => boolean; readFileSync: (p: string, e: string) => string };
const HHB = dataPath('rcsb/4HHB.pdb');

const proteinDoc = (over: Partial<SequenceDocument>): SequenceDocument => ({
  id: 'p', name: 'p', accession: '', description: '', moleculeType: 'Protein', topology: 'linear', sequence: 'MKV',
  features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Protein Documents', ...over,
} as SequenceDocument);

describe('measured 3D structures', () => {
  it('writes Cα atoms as PDB records that read back with the same coordinates and secondary structure', () => {
    const atoms = parsePdbCaCoordinates(synthesizeAlphaHelicalCaPdbFromProtein('m', 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ', 33));
    const back = parsePdbCaCoordinates(caAtomsToPdb(atoms));
    expect(back).toHaveLength(atoms.length);
    back.forEach((b, i) => {
      expect([b.resName, b.resSeq, b.chainId]).toEqual([atoms[i].resName, atoms[i].resSeq, atoms[i].chainId]);
      expect(Math.abs(b.x - atoms[i].x) + Math.abs(b.y - atoms[i].y) + Math.abs(b.z - atoms[i].z)).toBeLessThan(0.01);
    });
    expect(back.map((a) => a.secondaryStructure).join('')).toBe(atoms.map((a) => a.secondaryStructure).join(''));
  });

  it('a sequence without coordinates has no structure', () => {
    const doc = proteinDoc({});
    expect(hasStructure(doc)).toBe(false);
    expect(structureAtomsOf(doc)).toEqual([]);
    expect(computeDocumentTableMetrics(doc).docTypeLabel).toBe('Protein Sequence');
  });

  it.skipIf(!haveTestData(HHB))('a chain document shows its own chain, and the whole structure on request', () => {
    const text = fs!.readFileSync(HHB, 'utf8');
    const docA = proteinDoc({ docMetadata: { PDBText: text, Chain: 'A' } });
    const docB = proteinDoc({ id: 'b', docMetadata: { PDBText: text, Chain: 'B' } });
    expect(structureAtomsOf(docA)).toHaveLength(141); // haemoglobin α
    expect(structureAtomsOf(docB)).toHaveLength(146); // haemoglobin β
    expect(structureAtomsOf(docA, true)).toHaveLength(574);
    expect(structureChainCount(docA)).toBe(4);
    expect(computeDocumentTableMetrics(docA).docTypeLabel).toBe('3D Structure');
    // the chain survives the trip through PDB records with its helices
    const back = parsePdbCaCoordinates(caAtomsToPdb(structureAtomsOf(docA)));
    expect(back.filter((a) => a.secondaryStructure === 'H').length).toBe(structureAtomsOf(docA).filter((a) => a.secondaryStructure === 'H').length);
  });
});
