// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProteinStructure3DViewer } from '../components/ProteinStructure3DViewer';
import { parsePdbCaCoordinates, type PdbCaAtom } from '../core/genomicsAndStructureSuite';
import {
  caAtomIndicesOf, chainOf, featureResidues, ligandsOf, ligandsOfChains, parseStructure, residueNumberLabel,
  withFileSecondaryStructure,
  type SecondaryStructureSegment, type Structure, type StructureAtom, type StructureChain, type StructureResidue,
} from '../core/structureView';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs).catch(() => null) as null | { readFileSync: (p: string | URL, e: string) => string };
const read = (rel: string): string => fs!.readFileSync(dataPath(rel), 'utf8');

const HHB_CIF = 'rcsb/4HHB.cif';
const HHB_PDB = 'rcsb/4HHB.pdb';
const CRN_CIF = 'rcsb/1CRN.cif';
const CRN_PDB = 'rcsb/1CRN.pdb';
const UBQ_CIF = 'rcsb/1UBQ.cif';
const REF = 'reference/structure.json';
interface RefCounts { helices_struct_conf: number; strands_struct_sheet_range: number; hetatm_records_model_1: number }
const refCounts = (id: string): RefCounts => (JSON.parse(read(REF)) as { counts: Record<string, RefCounts> }).counts[id];

// ─── Synthetic models (no engine call, so these run without reference data) ───

let serial = 0;
const atom = (name: string, record: 'ATOM' | 'HETATM' = 'ATOM', at = 0): StructureAtom => ({
  serial: ++serial, name, element: name.slice(0, 1), altLoc: null, x: at, y: at / 2, z: -at, occupancy: 1, bFactor: 20, record,
});
const aa = (resName: string, labelSeqId: number, authSeqId: number, insCode: string | null = null, record: 'ATOM' | 'HETATM' = 'ATOM'): StructureResidue => ({
  resName, labelSeqId, authSeqId, insCode, atoms: ['N', 'CA', 'C', 'O'].map((n) => atom(n, record, labelSeqId * 3.8)),
});
const het = (resName: string, authSeqId: number, atomNames = ['C1', 'O1']): StructureResidue => ({
  resName, labelSeqId: null, authSeqId, insCode: null, atoms: atomNames.map((n) => atom(n, 'HETATM')),
});
const chainOfResidues = (labelAsymId: string, authAsymId: string, residues: StructureResidue[]): StructureChain => ({ labelAsymId, authAsymId, residues });
const model = (chains: StructureChain[], helices: SecondaryStructureSegment[] = [], strands: SecondaryStructureSegment[] = []): Structure => ({
  models: [{ modelNum: 1, atomRecordCount: 0, hetatmRecordCount: 0, chains }], helices, strands,
});
const segment = (id: string, labelAsymId: string, begin: number, end: number): SecondaryStructureSegment => {
  const ref = (labelSeqId: number) => ({ resName: null, labelAsymId, labelSeqId, authAsymId: null, authSeqId: null, insCode: null });
  return { id, confTypeId: null, sheetId: null, begin: ref(begin), end: ref(end) };
};
/** C-alpha atoms named as the engine's C-alpha reader names an mmCIF file's: label chain id, label sequence number. */
const caAtomsOf = (s: Structure, ss = 'C'): PdbCaAtom[] => s.models[0].chains.flatMap((c) => c.residues.flatMap((r) =>
  r.atoms.filter((a) => a.name === 'CA' && r.labelSeqId !== null).map((a) => ({
    chainId: c.labelAsymId, resSeq: r.labelSeqId!, resName: r.resName, x: a.x, y: a.y, z: a.z, secondaryStructure: ss,
  }))));
const ssString = (atoms: PdbCaAtom[]): string => atoms.map((a) => a.secondaryStructure ?? 'C').join('');

/**
 * Chain "B" (author chain "H") of a 12-residue protein MKTAYIAKQRQL: residues 1-2 and 7-8 were not
 * resolved, author numbering starts at 100, residue 6 is the insertion 102A, and the author numbering
 * skips 107 although no residue is missing there.
 */
const OFFSET_ENTITY = 'MKTAYIAKQRQL';
const OFFSET_MODELLED = 'TAYIQRQL';
const offsetChain = (): StructureChain => chainOfResidues('B', 'H', [
  aa('THR', 3, 100), aa('ALA', 4, 101), aa('TYR', 5, 102), aa('ILE', 6, 102, 'A'),
  aa('GLN', 9, 105), aa('ARG', 10, 106), aa('GLN', 11, 108), aa('LEU', 12, 109),
]);
/** A chain listed before the offset chain, so array positions and residue numbers disagree. */
const leadingChain = (): StructureChain => chainOfResidues('A', 'L', [aa('MET', 1, 1), aa('LYS', 2, 2), aa('THR', 3, 3), aa('ALA', 4, 4), aa('TYR', 5, 5)]);
const labels = (rs: { authSeqId: number | null; insCode: string | null }[]) => rs.map(residueNumberLabel);

/** The sequence a structure import gives a chain document: one letter per C-alpha atom of the chain. */
const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};
const importedChainSequence = (atoms: PdbCaAtom[], chainId: string): string =>
  atoms.filter((a) => a.chainId === chainId).map((a) => THREE_TO_ONE[a.resName] ?? 'X').join('');

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('structure view: ligands', () => {
  it.skipIf(!haveTestData(HHB_CIF, REF))('extracts non-water ligands: the four HEM and two PO4 of 4HHB.cif, each with its chain, residue number and atoms', () => {
    const s = parseStructure(read(HHB_CIF));
    const ligands = ligandsOf(s);
    expect(ligands.map((l) => `${l.resName} ${l.chainId}${residueNumberLabel(l)}`))
      .toEqual(['HEM A142', 'PO4 B147', 'HEM B148', 'HEM C142', 'PO4 D147', 'HEM D148']);
    expect(ligands.map((l) => l.labelAsymId)).toEqual(['E', 'F', 'G', 'H', 'I', 'J']);
    expect(ligands.map((l) => l.atoms.length)).toEqual([43, 1, 43, 43, 1, 43]); // each phosphate is modelled by its P alone
    expect(ligands[1].atoms.map((a) => [a.name, a.element])).toEqual([['P', 'P']]);
    expect(ligands.every((l) => l.atoms.every((a) => a.record === 'HETATM'))).toBe(true);
    // Every HETATM row of the model is a ligand atom or a water atom: nothing else was dropped.
    const waterAtoms = s.models[0].chains.flatMap((c) => c.residues).filter((r) => r.resName === 'HOH').reduce((n, r) => n + r.atoms.length, 0);
    expect(waterAtoms).toBeGreaterThan(0);
    expect(ligands.reduce((n, l) => n + l.atoms.length, 0) + waterAtoms).toBe(refCounts('4HHB').hetatm_records_model_1);
    // The coordinates are the heme's own: the iron of chain A's heme sits on the proximal His A87.
    const fe = ligands[0].atoms.find((a) => a.name === 'FE')!;
    const his87 = chainOf(s, 'A')!.residues.find((r) => r.authSeqId === 87)!;
    expect(his87.resName).toBe('HIS');
    expect(dist(fe, his87.atoms.find((a) => a.name === 'NE2')!)).toBeLessThan(2.5);
    // A chain's ligands are those its author chain binds.
    expect(ligandsOfChains(s, ['A']).map((l) => `${l.resName}${l.authSeqId}`)).toEqual(['HEM142']);
    expect(ligandsOfChains(s, ['B']).map((l) => `${l.resName}${l.authSeqId}`)).toEqual(['PO4147', 'HEM148']);
  });

  it.skipIf(!haveTestData(UBQ_CIF, REF))('extracts non-water ligands: none from 1UBQ.cif, whose HETATM rows are all water', () => {
    const s = parseStructure(read(UBQ_CIF));
    expect(s.models[0].hetatmRecordCount).toBe(refCounts('1UBQ').hetatm_records_model_1);
    expect(s.models[0].hetatmRecordCount).toBeGreaterThan(0);
    expect(ligandsOf(s)).toEqual([]);
  });

  it('extracts non-water ligands: waters (HOH, DOD, WAT) and polymer HETATM residues such as MSE are not ligands', () => {
    const s = model([
      chainOfResidues('A', 'A', [aa('MET', 1, 1), aa('MSE', 2, 2, null, 'HETATM'), aa('ALA', 3, 3)]),
      chainOfResidues('B', 'A', [het('HEM', 201, ['FE', 'NA', 'C1A'])]),
      chainOfResidues('C', 'A', [het('HOH', 301, ['O']), het('DOD', 302, ['O']), het('WAT', 303, ['O']), het('hoh', 304, ['O'])]),
      chainOfResidues('D', 'Z', [het('NAG', 401)]),
    ]);
    const ligands = ligandsOf(s);
    expect(ligands.map((l) => `${l.resName} ${l.chainId}${l.authSeqId}`)).toEqual(['HEM A201', 'NAG Z401']);
    expect(ligands[0].atoms.map((a) => a.name)).toEqual(['FE', 'NA', 'C1A']);
    expect(ligandsOfChains(s, ['A']).map((l) => l.resName)).toEqual(['HEM']);
    // A residue without a sequence number but read from ATOM rows only is not a ligand either.
    const unnumbered: StructureResidue = { ...aa('ALA', 0, 5), labelSeqId: null };
    expect(ligandsOf(model([chainOfResidues('A', 'A', [unnumbered])]))).toEqual([]);
  });

  it('extracts non-water ligands of a chain by its author chain, whatever the label ids', () => {
    // Label chain A is author chain X; author chain A is another chain's.
    const s = model([
      chainOfResidues('A', 'X', [aa('MET', 1, 1)]),
      chainOfResidues('B', 'A', [aa('GLY', 1, 1)]),
      chainOfResidues('C', 'X', [het('HEM', 201)]),
      chainOfResidues('D', 'A', [het('SO4', 301)]),
    ]);
    expect(ligandsOfChains(s, ['A']).map((l) => `${l.resName} ${l.chainId}`)).toEqual(['HEM X']);
    expect(ligandsOfChains(s, ['B']).map((l) => `${l.resName} ${l.chainId}`)).toEqual(['SO4 A']);
    expect(ligandsOfChains(s, ['A', 'B'])).toHaveLength(2);
  });

  it('extracts non-water ligands and the viewer lists those of the chains it shows', () => {
    const s = model([
      chainOfResidues('A', 'A', [aa('MET', 1, 1), aa('ALA', 2, 2), aa('LYS', 3, 3)]),
      chainOfResidues('B', 'A', [het('HEM', 201)]),
      chainOfResidues('C', 'Q', [het('PO4', 301)]),
    ]);
    const html = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, { primaryAtoms: caAtomsOf(s), structure: s }));
    expect(html).toContain('1 ligand');
    expect(html).toContain('HEM A201');
    expect(html).not.toContain('PO4');
    expect(html).toContain('Hide Ligands');
    const bare = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, { primaryAtoms: caAtomsOf(s) }));
    expect(bare).not.toContain('ligand');
  });
});

describe('structure view: secondary structure', () => {
  // 1CRN's _struct_conf / _struct_sheet_range (and its HELIX / SHEET records): strands 1-4 and
  // 32-35, helices 7-19 and 23-30.
  const CRN_FILE_SS = 'EEEE' + 'CC' + 'H'.repeat(13) + 'CCC' + 'H'.repeat(8) + 'C' + 'EEEE' + 'C'.repeat(11);

  it.skipIf(!haveTestData(CRN_CIF, CRN_PDB, REF))('uses file secondary structure when defined: 1CRN.cif takes the helices and strands its file declares, as 1CRN.pdb does', () => {
    const cif = read(CRN_CIF);
    const s = parseStructure(cif);
    expect(s.helices).toHaveLength(refCounts('1CRN').helices_struct_conf);
    expect(s.strands).toHaveLength(refCounts('1CRN').strands_struct_sheet_range);
    const inferred = parsePdbCaCoordinates(cif);
    expect(inferred).toHaveLength(46);
    const view = withFileSecondaryStructure(s, inferred);
    expect(view.source).toBe('file');
    expect(ssString(view.atoms)).toBe(CRN_FILE_SS);
    expect(ssString(inferred)).not.toBe(CRN_FILE_SS); // the geometric inference differs, so the choice shows
    expect(ssString(parsePdbCaCoordinates(read(CRN_PDB)))).toBe(CRN_FILE_SS); // both formats now agree
    // The same model without the file's secondary structure keeps the inference.
    const bare = withFileSecondaryStructure({ ...s, helices: [], strands: [] }, inferred);
    expect(bare.source).toBe('inferred');
    expect(bare.atoms).toBe(inferred);
  });

  it.skipIf(!haveTestData(HHB_CIF, HHB_PDB, REF))('uses file secondary structure when defined: each 4HHB.cif chain matches the HELIX records of 4HHB.pdb', () => {
    const cif = read(HHB_CIF);
    const s = parseStructure(cif);
    expect(s.helices).toHaveLength(refCounts('4HHB').helices_struct_conf);
    expect(s.strands).toHaveLength(refCounts('4HHB').strands_struct_sheet_range);
    const inferred = parsePdbCaCoordinates(cif);
    const view = withFileSecondaryStructure(s, inferred);
    expect(view.source).toBe('file');
    const fromPdb = parsePdbCaCoordinates(read(HHB_PDB));
    for (const chain of ['A', 'B', 'C', 'D']) {
      const mine = ssString(view.atoms.filter((a) => a.chainId === chain));
      expect(mine).toBe(ssString(fromPdb.filter((a) => a.chainId === chain)));
      expect(mine).toMatch(/^[HC]+$/); // the file declares no strands
      expect(mine).toContain('H');
    }
    expect(ssString(view.atoms)).not.toBe(ssString(inferred));
  });

  it('uses file secondary structure when defined, and the C-alpha reader\'s tags only when not', () => {
    const s = model(
      [chainOfResidues('A', 'A', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => aa('ALA', n, n + 20)))],
      [segment('H1', 'A', 2, 4)],
      [segment('S1', 'A', 6, 7)],
    );
    const stray: PdbCaAtom = { chainId: 'Z', resSeq: 1, resName: 'GLY', x: 0, y: 0, z: 0, secondaryStructure: 'H' };
    const inferred = [...caAtomsOf(s, 'H'), stray];
    const view = withFileSecondaryStructure(s, inferred);
    expect(view.source).toBe('file');
    expect(ssString(view.atoms)).toBe('CHHHCEEC' + 'H'); // outside the file's segments is coil; the stray atom keeps its own
    expect(ssString(inferred)).toBe('HHHHHHHHH'); // the input is not changed
    const none = withFileSecondaryStructure(model(s.models[0].chains), inferred);
    expect(none).toEqual({ atoms: inferred, source: 'inferred' });
    // A file whose segments name residues these atoms do not have leaves them as they are.
    expect(withFileSecondaryStructure(s, [stray]).source).toBe('inferred');
    // Where a helix and a strand overlap, the helix wins, as the legacy PDB reader decides.
    const overlap = model(s.models[0].chains, [segment('H1', 'A', 2, 4)], [segment('S1', 'A', 4, 5)]);
    expect(ssString(withFileSecondaryStructure(overlap, caAtomsOf(overlap)).atoms)).toBe('CHHHECCC');
  });

  it('uses file secondary structure when defined: the viewer says where the secondary structure came from', () => {
    const chains = [chainOfResidues('A', 'A', [1, 2, 3, 4, 5].map((n) => aa('ALA', n, n)))];
    const withFile = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: caAtomsOf(model(chains)), structure: model(chains, [segment('H1', 'A', 1, 4)]),
    }));
    expect(withFile).toContain('SS from file');
    const without = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: caAtomsOf(model(chains)), structure: model(chains),
    }));
    expect(without).toContain('SS inferred');
  });
});

describe('structure view: sequence features in 3D', () => {
  it.skipIf(!haveTestData(HHB_CIF, 'rcsb/fasta/4HHB.A.fasta', 'rcsb/fasta/4HHB.fasta'))('maps a selected sequence feature to its 3D residues on 4HHB chains A and C, each through its own numbering', () => {
    const cif = read(HHB_CIF);
    const s = parseStructure(cif);
    const all = parsePdbCaCoordinates(cif); // the whole structure, chain A first
    const docA = importedChainSequence(all, 'A');
    expect(docA).toHaveLength(141);
    const fastaA = read('rcsb/fasta/4HHB.A.fasta').split('\n').slice(1).join('').trim();
    for (const seq of [docA, fastaA]) {
      const proximal = featureResidues(chainOf(s, 'A')!, seq, { start: 87, end: 87 });
      expect(proximal.numbering).toBe('chain-sequence'); // every residue is modelled, so both readings agree
      expect(proximal.residues.map((r) => `${r.resName} ${r.chainId}${residueNumberLabel(r)}`)).toEqual(['HIS A87']);
      expect(proximal.unmodelled).toEqual([]);
    }
    const helixE = featureResidues(chainOf(s, 'A')!, docA, { start: 58, end: 87 });
    expect(labels(helixE.residues)).toEqual(Array.from({ length: 30 }, (_, i) => String(58 + i)));
    expect(caAtomIndicesOf(all, helixE.residues)).toEqual(Array.from({ length: 30 }, (_, i) => 57 + i));

    // Chain C has chain A's sequence; a feature on its document lands on chain C, not on the
    // array position the same number would have in the whole structure.
    const onC = featureResidues(chainOf(s, 'C')!, importedChainSequence(all, 'C'), { start: 87, end: 87 });
    expect(onC.residues.map((r) => `${r.resName} ${r.chainId}${residueNumberLabel(r)}`)).toEqual(['HIS C87']);
    const [idx] = caAtomIndicesOf(all, onC.residues);
    expect(idx).toBe(141 + 146 + 86);
    const caC87 = chainOf(s, 'C')!.residues.find((r) => r.labelSeqId === 87)!.atoms.find((a) => a.name === 'CA')!;
    expect([all[idx].x, all[idx].y, all[idx].z]).toEqual([caC87.x, caC87.y, caC87.z]);
    expect(dist(all[idx], all[86])).toBeGreaterThan(10);

    // The beta chain's sequence is not chain A's, so it is refused rather than placed.
    const beta = read('rcsb/fasta/4HHB.fasta').split('>').find((r) => r.startsWith('4HHB_2'))!.split('\n').slice(1).join('');
    expect(() => featureResidues(chainOf(s, 'A')!, beta, { start: 1, end: 5 })).toThrow(/neither chain A's sequence/);
  });

  it('maps a selected sequence feature to its 3D residues on a chain numbered from 100 with gaps and insertion codes', () => {
    const chain = offsetChain();
    // On the chain's whole sequence, positions are label sequence numbers: 7 and 8 were not resolved.
    const onEntity = featureResidues(chain, OFFSET_ENTITY, { start: 5, end: 10 });
    expect(onEntity.numbering).toBe('chain-sequence');
    expect(onEntity.residues.map((r) => r.position)).toEqual([5, 6, 9, 10]);
    expect(labels(onEntity.residues)).toEqual(['102', '102A', '105', '106']);
    expect(onEntity.residues.map((r) => r.chainId)).toEqual(['H', 'H', 'H', 'H']);
    expect(onEntity.unmodelled).toEqual([7, 8]);
    // The author numbering skips 107 with no residue missing.
    expect(labels(featureResidues(chain, OFFSET_ENTITY, { start: 10, end: 12 }).residues)).toEqual(['106', '108', '109']);
    expect(featureResidues(chain, OFFSET_ENTITY, { start: 1, end: 2 })).toEqual({ numbering: 'chain-sequence', residues: [], unmodelled: [1, 2] });

    // On the modelled residues (what a structure import puts in the chain document), position p is the p-th of them.
    const onModelled = featureResidues(chain, OFFSET_MODELLED.toLowerCase(), { start: 3, end: 6 });
    expect(onModelled.numbering).toBe('modelled-residues');
    expect(onModelled.residues.map((r) => r.position)).toEqual([3, 4, 5, 6]);
    expect(labels(onModelled.residues)).toEqual(['102', '102A', '105', '106']);
    expect(labels(featureResidues(chain, OFFSET_MODELLED, { start: 1, end: 8 }).residues))
      .toEqual(['100', '101', '102', '102A', '105', '106', '108', '109']);

    // The 3D atoms are found by residue, wherever the chain sits in the atom list.
    const atoms = caAtomsOf(model([leadingChain(), chain]));
    const idx = caAtomIndicesOf(atoms, onEntity.residues);
    expect(idx).toEqual([7, 8, 9, 10]);
    expect(idx.map((i) => `${atoms[i].chainId}${atoms[i].resSeq}`)).toEqual(['B5', 'B6', 'B9', 'B10']);
  });

  it('maps a selected sequence feature to its 3D residues only when the sequence is the chain\'s', () => {
    const chain = offsetChain();
    expect(() => featureResidues(chain, 'TAYIQRQW', { start: 1, end: 2 })).toThrow(/neither chain B's sequence nor its 8 modelled residues/);
    expect(() => featureResidues(chain, OFFSET_MODELLED, { start: 0, end: 2 })).toThrow(/not a range/);
    expect(() => featureResidues(chain, OFFSET_MODELLED, { start: 6, end: 5 })).toThrow(/not a range/);
    expect(() => featureResidues(chain, OFFSET_MODELLED, { start: 5, end: 9 })).toThrow(/not a range/);
    // A residue modelled as two residue types: both readings fit "AXA" but number it differently.
    const micro = chainOfResidues('M', 'M', [aa('ALA', 1, 1), aa('SER', 1, 1), aa('ALA', 2, 2)]);
    expect(() => featureResidues(micro, 'AXA', { start: 2, end: 2 })).toThrow(/fits both/);
    // Only residues with a C-alpha atom are in a chain document's sequence, as the structure import builds it.
    const noCa: StructureResidue = { ...aa('LYS', 2, 2), atoms: [atom('N'), atom('C'), atom('O')] };
    const partial = chainOfResidues('P', 'P', [aa('MET', 1, 1), noCa, aa('VAL', 3, 3)]);
    expect(featureResidues(partial, 'MKV', { start: 2, end: 2 }).residues.map((r) => r.resName)).toEqual(['LYS']);
    const onPartial = featureResidues(partial, 'MV', { start: 2, end: 2 });
    expect([onPartial.numbering, onPartial.residues.map((r) => r.resName)]).toEqual(['modelled-residues', ['VAL']]);
    // An unknown residue type, or X in the sequence, matches any letter.
    const odd = chainOfResidues('N', 'N', [aa('MSE', 1, 1), aa('ALA', 2, 2), aa('GLY', 3, 3)]);
    expect(labels(featureResidues(odd, 'MXG', { start: 1, end: 3 }).residues)).toEqual(['1', '2', '3']);
  });

  it('maps a selected sequence feature to its 3D residues and the viewer highlights them', () => {
    const s = model([leadingChain(), offsetChain()]);
    const atoms = caAtomsOf(s);
    const html = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: atoms, structure: s,
      selectedFeature: { chainId: 'B', sequence: OFFSET_ENTITY, start: 5, end: 10, name: 'Loop' },
    }));
    expect(html).toContain('Loop: 4 residues (H 102–106), 2 not modelled<');
    const otherChainShown = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: atoms.filter((a) => a.chainId === 'A'), structure: s,
      selectedFeature: { chainId: 'B', sequence: OFFSET_ENTITY, start: 5, end: 10, name: 'Loop' },
    }));
    expect(otherChainShown).toContain('Loop: 4 residues (H 102–106), 2 not modelled, 0 in view');
    const refused = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: atoms, structure: s,
      selectedFeature: { chainId: 'B', sequence: 'WWWW', start: 1, end: 2, name: 'Loop' },
    }));
    expect(refused).toContain('Feature not placed');
    expect(refused).toContain('neither chain B');
    const noChain = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: atoms, structure: s, selectedFeature: { chainId: 'Q', sequence: 'MK', start: 1, end: 1 },
    }));
    expect(noChain).toContain('has no chain Q');
  });

  it('exposes the Mol* sequence panel toggle, representation preset selector, and stage host container', () => {
    const s = model([leadingChain(), offsetChain()]);
    const atoms = caAtomsOf(s);
    const html = renderToStaticMarkup(React.createElement(ProteinStructure3DViewer, {
      primaryAtoms: atoms,
      structure: s,
    }));
    expect(html).toContain('aria-label="3D Representation Preset"');
    expect(html).toContain('Preset: Polymer &amp; Hetero');
    expect(html).toContain('Preset: Polymer Cartoon');
    expect(html).toContain('Preset: Atomic Detail');
    expect(html).toContain('Preset: Molecular Surface');
    expect(html).toContain('Preset: Coarse Surface');
    expect(html).toContain('Preset: Auto Detail (LOD)');
    expect(html).toContain('Preset: Illustrative (Spacefill)');
    expect(html).toContain('Show Sequence');
    expect(html).toContain('molstar-viewer-host');
  });

  it('docks Mol* floating viewport controls at the bottom and keeps expanded fullscreen exit reachable', () => {
    const appCss = fs!.readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    const viewerSrc = fs!.readFileSync(new URL('../components/ProteinStructure3DViewer.tsx', import.meta.url), 'utf8');
    expect(appCss).toContain('.molstar-viewer-host .msp-plugin .msp-viewport-controls');
    expect(appCss).toContain('bottom: 10px !important;');
    expect(appCss).toContain('.mbc-viewer-canvas:has(.msp-layout-expanded)');
    expect(appCss).toContain('container-type: normal !important;');
    expect(appCss).not.toContain('molstar-exit-expanded-btn');
    expect(viewerSrc).not.toContain('molstar-exit-expanded-btn');
  });
});
