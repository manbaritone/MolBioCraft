// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Pairwise alignment of two workbench structures (US-01M6PBTA, after RCSB's "Pairwise Structure
 * Alignment"): RMSD, TM-score, sequence identity and equivalent residues, the structure-based
 * sequence alignment as FASTA, and the superposition as a 4x4 matrix in JSON.
 *
 * Both alignments are made by the Rust engine; this module checks the chains, calls one op and
 * labels what comes back:
 *
 * - `tm` - `align_structures_tm`: TM-align-style and sequence independent. Its TM-scores are
 *   searched for and normalised by each chain, as TM-align reports them.
 * - `sequence` - `align_pdb_kabsch`: residues paired by a global sequence alignment and
 *   superposed by Kabsch. Its score is shown as **TM≈**, approximate: it is scored on that
 *   RMSD-optimal superposition, normalised by the longer chain, and never searched, so it is not
 *   a TM-score TM-align would give. It is kept, rather than replaced by a TM-align-style score of
 *   the same pair, because that score belongs to a different alignment (other residue pairs,
 *   another superposition) and would sit beside an RMSD, identity, pair count and FASTA it does
 *   not describe. The `tm` method gives the true TM-scores.
 *
 * Chains are refused before either op is called, as RCSB's tool refuses them: one without
 * C-alpha coordinates, or with fewer than 10 residues that have one ({@link chainProblem}).
 *
 * Chains are named as RCSB's tool and the workbench name them: an mmCIF chain by its label id
 * (`label_asym_id`, the id a structure document's `Chain` holds), a PDB chain by its chain column
 * (blank read as `A`). The engine selects a chain by its author id first, so each chain is passed
 * to it by author id, which a label id of another chain cannot shadow.
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';
import { parsePdbCaCoordinates } from './genomicsAndStructureSuite';
import { parseStructure } from './structureView';

/** RCSB's minimum: "The polymer chains selected for alignment must be at least 10 residues long." */
export const MIN_ALIGNABLE_RESIDUES = 10;

export type StructureAlignmentMethod = 'tm' | 'sequence';

export const STRUCTURE_ALIGNMENT_METHODS: { value: StructureAlignmentMethod; label: string; hint: string }[] = [
  {
    value: 'tm',
    label: 'By structure (TM-align-style)',
    hint: 'Aligns the Cα traces without looking at the sequences and reports the TM-score normalised by each chain. A re-implementation of the published method; no TM-align code is run.',
  },
  {
    value: 'sequence',
    label: 'By sequence (Kabsch superposition)',
    hint: 'Pairs residues by a global sequence alignment (BLOSUM62) and superposes the pairs. Its score is approximate (TM≈), not a TM-align TM-score.',
  },
];

/** The method named by `value`; an unknown name is an error, never a default. */
export function structureAlignmentMethodOf(value: unknown): StructureAlignmentMethod {
  const m = STRUCTURE_ALIGNMENT_METHODS.find((o) => o.value === value);
  if (!m) throw new Error(`Unknown structure alignment method ${JSON.stringify(value)}; expected one of ${STRUCTURE_ALIGNMENT_METHODS.map((o) => `'${o.value}'`).join(', ')}`);
  return m.value;
}

// ─── Chains ───

export interface StructureChainInfo {
  /** The chain's name: the label id for mmCIF, the chain column for PDB. */
  id: string;
  /** The id the engine is given: the author id for mmCIF, the chain column for PDB. */
  authorId: string;
  /** Residues of the chain: polymer residues for mmCIF; for PDB, residues with an `ATOM` Cα record (the only ones read). */
  residues: number;
  /** Residues that have a Cα coordinate. */
  caResidues: number;
}

const isMmcif = (text: string): boolean => text.includes('_atom_site.');

/**
 * The chains of a structure (first model) that could be aligned, in file order. mmCIF: every
 * polymer chain (residues with a label sequence number), a residue counting as having a Cα when
 * it has an atom named `CA` whose element is carbon or not given, as `align_pdb_kabsch` counts
 * them, so a calcium ion is not one and a nucleic-acid chain has none (`align_structures_tm` does
 * not look at the element). PDB: the engine's Cα view (`parse_pdb_ca`), grouped by chain column;
 * a chain with no Cα record is not seen.
 * Throws the reader's reason when the file cannot be read.
 */
export function structureChains(text: string): StructureChainInfo[] {
  if (isMmcif(text)) {
    const chains: StructureChainInfo[] = [];
    for (const c of parseStructure(text).models[0]?.chains ?? []) {
      const polymer = c.residues.filter((r) => r.labelSeqId !== null);
      if (polymer.length === 0) continue;
      const caResidues = polymer.filter((r) => r.atoms.some((a) => a.name === 'CA' && (a.element === null || a.element.toUpperCase() === 'C'))).length;
      chains.push({ id: c.labelAsymId, authorId: c.authAsymId || c.labelAsymId, residues: polymer.length, caResidues });
    }
    return chains;
  }
  const byChain = new Map<string, number>();
  for (const a of parsePdbCaCoordinates(text)) {
    const id = a.chainId || 'A';
    byChain.set(id, (byChain.get(id) ?? 0) + 1);
  }
  return [...byChain].map(([id, n]) => ({ id, authorId: id, residues: n, caResidues: n }));
}

export interface StructureInput {
  /** The structure file's text (PDB or mmCIF). */
  text: string;
  /** The chain, by name ({@link StructureChainInfo.id}) or author id; blank means the first chain. */
  chain?: string;
  /** The entry the records and the matrix are named by (e.g. `4HHB`). */
  entry: string;
}

/** The chain `wanted` names (by name, then author id), or the first chain when `wanted` is blank. */
function findChain(chains: StructureChainInfo[], wanted: string | undefined): StructureChainInfo | undefined {
  const w = (wanted ?? '').trim();
  if (!w) return chains[0];
  return chains.find((c) => c.id === w) ?? chains.find((c) => c.authorId === w);
}

/** The chains of `input`'s structure, or the reader's reason, naming the structure, when it cannot be read. */
function chainsOf(input: StructureInput, which: 'A' | 'B'): StructureChainInfo[] {
  try {
    return structureChains(input.text);
  } catch (e) {
    throw new Error(`Structure ${which} (${input.entry}) cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Why a chain cannot be aligned, naming the structure ('A' or 'B'), entry and chain, or null when
 * it can. Refused as RCSB refuses: a structure with no text, a chain that is not there, a chain
 * without Cα coordinates, and one with fewer than {@link MIN_ALIGNABLE_RESIDUES} residues that
 * have a Cα coordinate. `chains` defaults to {@link structureChains} of the structure.
 */
export function chainProblem(input: StructureInput, which: 'A' | 'B', chains?: StructureChainInfo[]): string | null {
  const structure = `Structure ${which} (${input.entry})`;
  if (!input.text.trim()) return `${structure} has no structure file to align.`;
  const all = chains ?? chainsOf(input, which);
  const wanted = (input.chain ?? '').trim();
  const chain = findChain(all, wanted);
  if (!chain) {
    const [one, many] = isMmcif(input.text) ? ['polymer chain', 'polymer chains'] : ['chain with Cα coordinates', 'chains with Cα coordinates'];
    if (!wanted || all.length === 0) return `${structure} has no ${one}.`;
    const listed = `its ${many}: ${all.map((c) => c.id).join(', ')}`;
    return isMmcif(input.text) ? `${structure} has no polymer chain '${wanted}' (${listed}).` : `${structure} has no chain '${wanted}' with Cα coordinates (${listed}).`;
  }
  const named = `Structure ${which}, ${input.entry} chain ${chain.id},`;
  if (chain.caResidues === 0) return `${named} has no Cα coordinates; a structure alignment superposes Cα atoms.`;
  if (chain.caResidues < MIN_ALIGNABLE_RESIDUES) {
    return `${named} has ${chain.caResidues} residue${chain.caResidues === 1 ? '' : 's'} with Cα coordinates; a structure alignment needs at least ${MIN_ALIGNABLE_RESIDUES}, as RCSB's does.`;
  }
  return null;
}

// ─── Alignment ───

/** `align_pdb_kabsch`, the fields read here (molbiocraft-protein `PdbStructureAlignmentReport`). */
interface KabschReport {
  chainA: string;
  chainB: string;
  alignedResiduePairs: number;
  rmsdAngstrom: number;
  tmScore: number;
  structuralSimilarityVerdict: string;
  pairingMethod: string;
  sequenceIdentity: number;
  alignedSequenceA: string;
  alignedSequenceB: string;
  transformationMatrix: number[][];
}

/** `align_structures_tm` (molbiocraft-protein `TmAlignmentReport`). */
interface TmReport {
  chainA: string;
  chainB: string;
  lengthA: number;
  lengthB: number;
  tmScoreA: number;
  tmScoreB: number;
  d0A: number;
  d0B: number;
  alignedLength: number;
  rmsdAngstrom: number;
  sequenceIdentity: number;
  alignedSequenceA: string;
  alignedSequenceB: string;
  transformationMatrix: number[][];
  method: string;
}

export interface AlignedChain {
  entry: string;
  /** The chain's name ({@link StructureChainInfo.id}). */
  chain: string;
  /** The author id the engine aligned. */
  authorId: string;
  /** Residues aligned from this chain (every residue with a Cα, gaps excluded). */
  residues: number;
}

export interface StructureAlignmentScore {
  /** The score's name, e.g. `TM-score by 4HHB.A` or `TM≈ (approximate)`. */
  name: string;
  /** What it is normalised by and how it was made, shown beside it. */
  detail: string;
  value: number;
  /** True for the sequence method's TM≈: scored, not searched, and not a TM-align TM-score. */
  approximate: boolean;
}

export interface StructureAlignment {
  method: StructureAlignmentMethod;
  /** How the engine aligned the chains, in its words. */
  methodDescription: string;
  a: AlignedChain;
  b: AlignedChain;
  rmsdAngstrom: number;
  /** Residue pairs in the alignment: the columns of the aligned sequences without a gap. */
  equivalentResidues: number;
  /** Fraction (0-1) of the equivalent residues whose two residues are the same amino acid. */
  sequenceIdentity: number;
  tmScores: StructureAlignmentScore[];
  /** The two chains' sequences as aligned, `-` for a gap. */
  alignedSequenceA: string;
  alignedSequenceB: string;
  /** Row-major 4x4 `[R t; 0 0 0 1]` moving structure B onto structure A, translation in Å. */
  transformationMatrix: number[][];
}

export const recordName = (c: AlignedChain): string => `${c.entry}.${c.chain}`;

const ungappedLength = (s: string): number => s.replace(/-/g, '').length;

function checkMatrix(m: unknown): number[][] {
  const ok = Array.isArray(m) && m.length === 4 && m.every((row) => Array.isArray(row) && row.length === 4 && row.every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (!ok) throw new Error('The engine returned no 4x4 transformation matrix');
  return m as number[][];
}

/**
 * Aligns chain `a.chain` of structure A with chain `b.chain` of structure B by `method`. Throws,
 * naming the chain and the reason, before the engine is called when a chain cannot be aligned
 * ({@link chainProblem}); throws the engine's reason when it fails, and says so when the chains
 * pair no residues (with the engine's verdict, for the sequence method).
 */
export function alignStructures(a: StructureInput, b: StructureInput, method: StructureAlignmentMethod): StructureAlignment {
  const how = structureAlignmentMethodOf(method);
  const chainsA = a.text.trim() ? chainsOf(a, 'A') : [];
  const chainsB = b.text.trim() ? chainsOf(b, 'B') : [];
  const problems = [chainProblem(a, 'A', chainsA), chainProblem(b, 'B', chainsB)].filter((p): p is string => p !== null);
  if (problems.length) throw new Error(problems.join(' '));
  const ca = findChain(chainsA, a.chain)!;
  const cb = findChain(chainsB, b.chain)!;
  const payload = { pdbA: a.text, pdbB: b.text, chainA: ca.authorId, chainB: cb.authorId };

  const side = (input: StructureInput, chain: StructureChainInfo, engineChain: string, aligned: string): AlignedChain => {
    if (engineChain !== chain.authorId) throw new Error(`The engine aligned chain ${engineChain} of ${input.entry}, not chain ${chain.id} (author ${chain.authorId})`);
    return { entry: input.entry, chain: chain.id, authorId: chain.authorId, residues: ungappedLength(aligned) };
  };

  if (how === 'tm') {
    const r = invokeRustBioSync<TmReport>('align_structures_tm', payload);
    const sa = side(a, ca, r.chainA, r.alignedSequenceA);
    const sb = side(b, cb, r.chainB, r.alignedSequenceB);
    if (r.alignedLength === 0) throw new Error(`${recordName(sa)} and ${recordName(sb)}: the structure alignment pairs no residues.`);
    const score = (c: AlignedChain, length: number, d0: number, value: number): StructureAlignmentScore => ({
      name: `TM-score by ${recordName(c)}`,
      detail: `normalised by ${recordName(c)}: ${length} residues, d0 ${d0.toFixed(2)} Å`,
      value,
      approximate: false,
    });
    return {
      method: how,
      methodDescription: r.method,
      a: sa,
      b: sb,
      rmsdAngstrom: r.rmsdAngstrom,
      equivalentResidues: r.alignedLength,
      sequenceIdentity: r.sequenceIdentity,
      tmScores: [score(sa, r.lengthA, r.d0A, r.tmScoreA), score(sb, r.lengthB, r.d0B, r.tmScoreB)],
      alignedSequenceA: r.alignedSequenceA,
      alignedSequenceB: r.alignedSequenceB,
      transformationMatrix: checkMatrix(r.transformationMatrix),
    };
  }

  const r = invokeRustBioSync<KabschReport>('align_pdb_kabsch', payload);
  const sa = side(a, ca, r.chainA, r.alignedSequenceA);
  const sb = side(b, cb, r.chainB, r.alignedSequenceB);
  if (r.alignedResiduePairs === 0) throw new Error(`${recordName(sa)} and ${recordName(sb)}: ${r.structuralSimilarityVerdict}.`);
  return {
    method: how,
    methodDescription: r.pairingMethod,
    a: sa,
    b: sb,
    rmsdAngstrom: r.rmsdAngstrom,
    equivalentResidues: r.alignedResiduePairs,
    sequenceIdentity: r.sequenceIdentity,
    tmScores: [{
      name: 'TM≈ (approximate)',
      detail: `scored on the sequence-paired superposition, not searched for; normalised by the longer chain (${Math.max(sa.residues, sb.residues)} residues); not a TM-align TM-score`,
      value: r.tmScore,
      approximate: true,
    }],
    alignedSequenceA: r.alignedSequenceA,
    alignedSequenceB: r.alignedSequenceB,
    transformationMatrix: checkMatrix(r.transformationMatrix),
  };
}

// ─── Exports ───

const FASTA_LINE = 60;
const wrap = (s: string): string => (s.match(new RegExp(`.{1,${FASTA_LINE}}`, 'g')) ?? ['']).join('\n');

/**
 * The structure-based sequence alignment as FASTA: one record per chain, named `ENTRY.CHAIN`
 * (structure A first), the aligned sequence with `-` for each gap, 60 residues to a line.
 */
export function structureAlignmentFasta(al: StructureAlignment): string {
  return `>${recordName(al.a)}\n${wrap(al.alignedSequenceA)}\n>${recordName(al.b)}\n${wrap(al.alignedSequenceB)}\n`;
}

/**
 * The superposition as JSON: the 4x4 matrix with its direction (structure B onto structure A),
 * units (translation in Å, rotation dimensionless) and element order (row-major) stated in the
 * file itself.
 */
export function structureAlignmentMatrixJson(al: StructureAlignment): string {
  const side = (c: AlignedChain) => ({ entry: c.entry, chain: c.chain, authorChain: c.authorId, residues: c.residues });
  return JSON.stringify({
    description: `Superposition of ${recordName(al.b)} onto ${recordName(al.a)} from a pairwise structure alignment`,
    method: al.methodDescription,
    fixed: { role: 'structure A (reference)', ...side(al.a) },
    moving: { role: 'structure B (superposed)', ...side(al.b) },
    direction: `B onto A: a point x of ${recordName(al.b)}, in its file's coordinates, moves to R x + t in the frame of ${recordName(al.a)}`,
    units: 'translation t (matrix[0][3], matrix[1][3], matrix[2][3]) in ångströms (Å), as are the coordinates it moves; rotation R dimensionless',
    order: "row-major: matrix[i][j] is row i, column j, counting from 0; matrix[0] to matrix[2] are the rows [R t] and matrix[3] is [0, 0, 0, 1]. RCSB's own download is a flat column-major array; this file is not.",
    rmsdAngstrom: al.rmsdAngstrom,
    equivalentResidues: al.equivalentResidues,
    matrix: al.transformationMatrix,
  }, null, 2) + '\n';
}

/** File names for the two exports: `4HHB.A_4HHB.B_alignment.fasta`, `4HHB.B_onto_4HHB.A_matrix.json`. */
export function structureAlignmentFileName(al: StructureAlignment, kind: 'fasta' | 'matrix'): string {
  const safe = (c: AlignedChain) => recordName(c).replace(/[^A-Za-z0-9._-]+/g, '_');
  return kind === 'fasta' ? `${safe(al.a)}_${safe(al.b)}_alignment.fasta` : `${safe(al.b)}_onto_${safe(al.a)}_matrix.json`;
}

/**
 * The entry a structure file names (`_entry.id` or the `data_` block of mmCIF, the `HEADER` id
 * code of PDB), or `fallback` when it names none.
 */
export function structureEntryId(text: string, fallback: string): string {
  const id = isMmcif(text)
    ? /^_entry\.id\s+(\S+)/m.exec(text)?.[1] ?? /^data_(\S+)/m.exec(text)?.[1]
    : /^HEADER.{56}(\S{4})/m.exec(text)?.[1];
  const clean = (id ?? '').replace(/^['"]|['"]$/g, '').trim();
  return clean && !/^[?.]$/.test(clean) ? clean : fallback;
}
