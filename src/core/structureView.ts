// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * What the 3D viewer shows from a structure file's full-atom model (US-01M6PB2P, after RCSB's
 * "Sequence Annotations in 3D"): the ligands bound in it, the secondary structure the file itself
 * declares, and the residues a selected sequence feature covers.
 *
 * The model is read by the Rust engine (`parse_structure`); this module only selects and indexes
 * what the model holds. Only the first model is used, as the engine's C-alpha reader does.
 *
 * Chains are named by their label id (`label_asym_id`) and residues by their label sequence number
 * (`label_seq_id`), which is how the C-alpha reader (`parse_pdb_ca`) names an mmCIF file's atoms
 * and so how the viewer's atoms and a structure document's `Chain` are named. Author chain ids,
 * residue numbers and insertion codes are carried alongside, for display.
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { PdbCaAtom } from './genomicsAndStructureSuite';

// ─── The full-atom model, as `parse_structure` returns it (molbiocraft-formats `Structure`) ───

export interface StructureAtom {
  serial: number;
  name: string;
  element: string | null;
  altLoc: string | null;
  x: number;
  y: number;
  z: number;
  occupancy: number | null;
  bFactor: number | null;
  record: 'ATOM' | 'HETATM';
}

export interface StructureResidue {
  resName: string;
  /** `null` for a residue that is not part of a polymer. */
  labelSeqId: number | null;
  authSeqId: number | null;
  insCode: string | null;
  atoms: StructureAtom[];
}

export interface StructureChain {
  labelAsymId: string;
  authAsymId: string;
  residues: StructureResidue[];
}

export interface StructureModel {
  modelNum: number;
  atomRecordCount: number;
  hetatmRecordCount: number;
  chains: StructureChain[];
}

export interface ResidueRef {
  resName: string | null;
  labelAsymId: string;
  labelSeqId: number;
  authAsymId: string | null;
  authSeqId: number | null;
  insCode: string | null;
}

export interface SecondaryStructureSegment {
  id: string;
  confTypeId: string | null;
  sheetId: string | null;
  begin: ResidueRef;
  end: ResidueRef;
}

export interface Structure {
  models: StructureModel[];
  /** Helices the file declares (mmCIF `_struct_conf` helix rows). */
  helices: SecondaryStructureSegment[];
  /** Strands the file declares (mmCIF `_struct_sheet_range` rows). */
  strands: SecondaryStructureSegment[];
}

/** Reads a structure file into its full-atom model; throws the engine's reason when it cannot. */
export function parseStructure(text: string): Structure {
  return invokeRustBioSync<Structure>('parse_structure', { text });
}

const residueKey = (labelAsymId: string, labelSeqId: number): string => `${labelAsymId}:${labelSeqId}`;

/** The chain with this label id in the model's first model. */
export function chainOf(structure: Structure, labelAsymId: string): StructureChain | undefined {
  return structure.models[0]?.chains.find((c) => c.labelAsymId === labelAsymId);
}

// ─── Ligands ───

/** Residue names of water: HOH, DOD (heavy water) and WAT (some older files). */
export const WATER_RESIDUE_NAMES: ReadonlySet<string> = new Set(['HOH', 'DOD', 'WAT']);

export interface StructureLigand {
  resName: string;
  /** Author chain id, as a legacy PDB file and RCSB show it. */
  chainId: string;
  labelAsymId: string;
  /** Author residue number (`null` when the file gives none). */
  authSeqId: number | null;
  insCode: string | null;
  atoms: StructureAtom[];
}

/**
 * The ligands of the first model, in the model's order: every residue that has HETATM rows, is not
 * water, and is not part of a polymer. A residue is part of a polymer when it has a label sequence
 * number, which a modified residue in a chain (MSE, selenomethionine) has and a bound group (HEM,
 * PO4) does not.
 */
export function ligandsOf(structure: Structure): StructureLigand[] {
  const ligands: StructureLigand[] = [];
  for (const chain of structure.models[0]?.chains ?? []) {
    for (const r of chain.residues) {
      if (r.labelSeqId !== null || WATER_RESIDUE_NAMES.has(r.resName.toUpperCase())) continue;
      if (!r.atoms.some((a) => a.record === 'HETATM')) continue;
      ligands.push({
        resName: r.resName, chainId: chain.authAsymId, labelAsymId: chain.labelAsymId,
        authSeqId: r.authSeqId, insCode: r.insCode, atoms: r.atoms,
      });
    }
  }
  return ligands;
}

/**
 * The ligands bound to the named chains (label ids): those whose author chain is the author chain
 * of one of them, which is how a file assigns a ligand to the chain it binds.
 */
export function ligandsOfChains(structure: Structure, labelAsymIds: Iterable<string>): StructureLigand[] {
  const wanted = new Set(labelAsymIds);
  const authChains = new Set(
    (structure.models[0]?.chains ?? []).filter((c) => wanted.has(c.labelAsymId)).map((c) => c.authAsymId),
  );
  return ligandsOf(structure).filter((l) => authChains.has(l.chainId));
}

// ─── Secondary structure ───

/** Whether the file declares any helix or strand. */
export const hasFileSecondaryStructure = (structure: Structure): boolean =>
  structure.helices.length + structure.strands.length > 0;

/**
 * The secondary structure the file declares, residue by residue, keyed `labelAsymId:labelSeqId`:
 * 'H' for each residue a helix covers, 'E' for each residue a strand covers ('H' where both do). A
 * segment covers its first residue's chain from its first to its last label sequence number.
 */
export function fileSecondaryStructure(structure: Structure): Map<string, 'H' | 'E'> {
  const byResidue = new Map<string, 'H' | 'E'>();
  const mark = (segments: SecondaryStructureSegment[], code: 'H' | 'E') => {
    for (const s of segments) {
      for (let seq = s.begin.labelSeqId; seq <= s.end.labelSeqId; seq++) {
        const key = residueKey(s.begin.labelAsymId, seq);
        if (!byResidue.has(key)) byResidue.set(key, code);
      }
    }
  };
  mark(structure.helices, 'H');
  mark(structure.strands, 'E');
  return byResidue;
}

/** Where the secondary structure of a set of C-alpha atoms came from. */
export type SecondaryStructureSource = 'file' | 'inferred';

/**
 * C-alpha atoms of this structure (named as the C-alpha reader names an mmCIF file's) with the
 * secondary structure the file declares, when it declares any: each atom of a polymer residue in
 * the model takes 'H' or 'E' from the file's segments, or 'C' outside all of them, and the source
 * is 'file'. Atoms the model has no residue for keep their own tags. When the file declares none,
 * or no atom is of a residue in the model, the atoms are returned as they are, with the C-alpha
 * reader's tags (inferred from C-alpha geometry for an mmCIF file), and the source is 'inferred'.
 * The input atoms are not changed.
 */
export function withFileSecondaryStructure(
  structure: Structure,
  atoms: PdbCaAtom[],
): { atoms: PdbCaAtom[]; source: SecondaryStructureSource } {
  if (!hasFileSecondaryStructure(structure)) return { atoms, source: 'inferred' };
  const declared = fileSecondaryStructure(structure);
  const inModel = new Set<string>();
  for (const c of structure.models[0]?.chains ?? []) {
    for (const r of c.residues) if (r.labelSeqId !== null) inModel.add(residueKey(c.labelAsymId, r.labelSeqId));
  }
  let tagged = 0;
  const out = atoms.map((a) => {
    const key = residueKey(a.chainId ?? '', a.resSeq);
    if (!inModel.has(key)) return a;
    tagged++;
    return { ...a, secondaryStructure: declared.get(key) ?? 'C' };
  });
  return tagged > 0 ? { atoms: out, source: 'file' } : { atoms, source: 'inferred' };
}

// ─── Sequence features in 3D ───

const ONE_LETTER: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

/** Whether a sequence letter can be this residue (`X`, and any non-standard residue, match anything). */
const letterFits = (r: StructureResidue, letter: string | undefined): boolean => {
  if (letter === undefined) return false;
  const code = ONE_LETTER[r.resName.toUpperCase()];
  return !code || letter === 'X' || letter === code;
};

/**
 * How a sequence's positions name a chain's residues:
 * - `chain-sequence`: the sequence is the chain's whole sequence (as RCSB's FASTA gives it), and
 *   position p is the residue whose label sequence number is p; residues the experiment did not
 *   resolve have no atoms, so their positions are reported as unmodelled.
 * - `modelled-residues`: the sequence is the chain's modelled residues, as a structure import builds
 *   a chain document (one letter for each residue with a C-alpha atom, in order), and position p is
 *   the p-th of them.
 */
export type FeatureNumbering = 'chain-sequence' | 'modelled-residues';

export interface MappedResidue {
  /** 1-based position on the sequence. */
  position: number;
  resName: string;
  labelAsymId: string;
  labelSeqId: number;
  /** Author chain id, residue number and insertion code. */
  chainId: string;
  authSeqId: number | null;
  insCode: string | null;
}

export interface FeatureResidues {
  numbering: FeatureNumbering;
  residues: MappedResidue[];
  /** Positions of the feature with no residue in the model. */
  unmodelled: number[];
}

/** A residue's author number with its insertion code, e.g. `102A` (`?` when the file gives none). */
export const residueNumberLabel = (r: { authSeqId: number | null; insCode: string | null }): string =>
  `${r.authSeqId ?? '?'}${r.insCode ?? ''}`;

/**
 * The residues of `chain` that a feature at 1-based inclusive positions `start`..`end` of `sequence`
 * covers. Which numbering the positions use is read from the sequence itself (see
 * `FeatureNumbering`): the sequence is the chain's whole sequence when each residue's letter is at
 * its label sequence number, or its modelled residues when the letters follow them one for one. A
 * sequence that is neither, one that is both but numbered differently by each, or a range outside
 * the sequence, is refused with the reason.
 */
export function featureResidues(
  chain: StructureChain,
  sequence: string,
  feature: { start: number; end: number },
): FeatureResidues {
  const seq = sequence.toUpperCase();
  const { start, end } = feature;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > seq.length) {
    throw new Error(`Feature ${start}..${end} is not a range on the ${seq.length}-residue sequence.`);
  }
  const polymer = chain.residues.filter((r) => r.labelSeqId !== null);
  const byLabel = new Map<number, StructureResidue[]>();
  for (const r of polymer) {
    const at = byLabel.get(r.labelSeqId!);
    if (at) at.push(r); else byLabel.set(r.labelSeqId!, [r]);
  }
  const mapped = (r: StructureResidue, position: number): MappedResidue => ({
    position, resName: r.resName, labelAsymId: chain.labelAsymId, labelSeqId: r.labelSeqId!,
    chainId: chain.authAsymId, authSeqId: r.authSeqId, insCode: r.insCode,
  });

  // A residue position modelled twice (two residue types at one position) fits when either does.
  const isChainSequence = byLabel.size > 0 &&
    [...byLabel].every(([label, rs]) => label >= 1 && rs.some((r) => letterFits(r, seq[label - 1])));
  const modelled = polymer.filter((r) => r.atoms.some((a) => a.name === 'CA'));
  const isModelled = modelled.length === seq.length && modelled.every((r, i) => letterFits(r, seq[i]));
  // Both readings can fit one sequence (every residue modelled, or a position modelled twice);
  // they agree only when the p-th modelled residue is labelled p.
  if (isChainSequence && isModelled && modelled.some((r, i) => r.labelSeqId !== i + 1)) {
    throw new Error(
      `The ${seq.length}-residue sequence fits both chain ${chain.labelAsymId}'s sequence and its ` +
        'modelled residues, which number it differently, so its positions cannot be placed on the structure.',
    );
  }
  if (isChainSequence) {
    const residues: MappedResidue[] = [];
    const unmodelled: number[] = [];
    for (let p = start; p <= end; p++) {
      const rs = byLabel.get(p);
      if (rs) residues.push(...rs.map((r) => mapped(r, p))); else unmodelled.push(p);
    }
    return { numbering: 'chain-sequence', residues, unmodelled };
  }
  if (isModelled) {
    return {
      numbering: 'modelled-residues',
      residues: modelled.slice(start - 1, end).map((r, i) => mapped(r, start + i)),
      unmodelled: [],
    };
  }
  throw new Error(
    `The ${seq.length}-residue sequence is neither chain ${chain.labelAsymId}'s sequence nor its ` +
      `${modelled.length} modelled residues, so its positions cannot be placed on the structure.`,
  );
}

/**
 * Indices into `atoms` (C-alpha atoms named as the C-alpha reader names an mmCIF file's) of the
 * mapped residues, in the order of `atoms`.
 */
export function caAtomIndicesOf(atoms: PdbCaAtom[], residues: MappedResidue[]): number[] {
  const wanted = new Set(residues.map((r) => residueKey(r.labelAsymId, r.labelSeqId)));
  const out: number[] = [];
  atoms.forEach((a, i) => {
    if (wanted.has(residueKey(a.chainId ?? '', a.resSeq))) out.push(i);
  });
  return out;
}
