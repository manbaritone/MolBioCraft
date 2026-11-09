// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6PBTA: pairwise alignment of two workbench structures, after RCSB's "Pairwise Structure
 * Alignment". Synthetic traces (a seeded random walk and a rigidly moved copy, with the motion
 * known) run everywhere; the RCSB files run against `reference/structure.json`
 * (scripts/outside-data/ref_structure.py: Biopython 1.88, TM-align through tmtools 0.3.0) when the
 * reference-data folder is present, and skip visibly when it is not.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { caAtomsToPdb } from '../core/structureModels';
import { parsePdbCaCoordinates, type PdbCaAtom } from '../core/genomicsAndStructureSuite';
import { parseAlignedFasta } from '../core/alignmentFormats';
import {
  alignStructures, chainProblem, MIN_ALIGNABLE_RESIDUES, recordName, structureAlignmentFasta, structureAlignmentFileName,
  structureAlignmentMatrixJson, structureAlignmentMethodOf, structureChains, structureEntryId,
  type StructureAlignment, type StructureAlignmentMethod, type StructureInput,
} from '../core/structureAlignment';
import { runStructureAlignment } from '../core/operationRunners';
import { StructureAlignmentDialog, StructureAlignmentResults } from '../components/StructureAlignmentDialog';
import type { SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

// Every engine call still runs; the spy records which ops were asked, so a refusal can be shown to
// come before the alignment ops.
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return { ...real, invokeRustBioSync: vi.fn(real.invokeRustBioSync) };
});
const engine = vi.mocked(invokeRustBioSync);
const ALIGN_OPS = ['align_pdb_kabsch', 'align_structures_tm'];
const alignOpsCalled = () => engine.mock.calls.map((c) => c[0]).filter((op) => ALIGN_OPS.includes(op));
// A block body: a hook that returns a function has it run as the test's teardown.
beforeEach(() => {
  engine.mockClear();
});

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs).catch(() => null) as null | { readFileSync: (p: string, e: string) => string };
const read = (rel: string): string => fs!.readFileSync(dataPath(rel), 'utf8');

const METHODS: StructureAlignmentMethod[] = ['tm', 'sequence'];

// ─── Synthetic structures ───

type V3 = [number, number, number];
const THREE: Record<string, string> = {
  A: 'ALA', C: 'CYS', D: 'ASP', E: 'GLU', F: 'PHE', G: 'GLY', H: 'HIS', I: 'ILE', K: 'LYS', L: 'LEU',
  M: 'MET', N: 'ASN', P: 'PRO', Q: 'GLN', R: 'ARG', S: 'SER', T: 'THR', V: 'VAL', W: 'TRP', Y: 'TYR',
};

/** xorshift64, so every synthetic trace is the same on every run. */
function rng(seed: bigint): () => number {
  let s = seed;
  const M = (1n << 64n) - 1n;
  return () => {
    s ^= (s << 13n) & M; s ^= s >> 7n; s ^= (s << 17n) & M;
    return Number(s >> 11n) / 2 ** 53;
  };
}

/** A random walk of `n` Cα positions 3.8 Å apart, and a random sequence for it. */
function trace(n: number, seed: bigint): { pts: V3[]; seq: string } {
  const next = rng(seed);
  const pts: V3[] = [];
  let p: V3 = [0, 0, 0];
  let seq = '';
  for (let i = 0; i < n; i++) {
    const d: V3 = [next() - 0.5, next() - 0.5, next() - 0.5];
    const len = Math.hypot(...d);
    p = [p[0] + (3.8 * d[0]) / len, p[1] + (3.8 * d[1]) / len, p[2] + (3.8 * d[2]) / len];
    pts.push(p);
    seq += 'ACDEFGHIKLMNPQRSTVWY'[Math.floor(next() * 20)];
  }
  return { pts, seq };
}

/** Rotation by `angle` about `axis` (Rodrigues), row-major. */
function rotation(axis: V3, angle: number): number[][] {
  const l = Math.hypot(...axis);
  const [x, y, z] = axis.map((v) => v / l);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
const Q = rotation([-2, 1, 0.5], 2.3);
const SHIFT: V3 = [-40, 15.5, 7];
/** Q p + SHIFT: where structure B's copy of a point of A is put. */
const moved = (p: V3): V3 => [0, 1, 2].map((i) => Q[i][0] * p[0] + Q[i][1] * p[1] + Q[i][2] * p[2] + SHIFT[i]) as V3;
/** A 4x4 row-major [R t] applied to p. */
const apply = (m: number[][], p: V3): V3 => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]) as V3;
const dist = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Fixed-column PDB text of one or more Cα chains. */
function pdb(...chains: { id: string; pts: V3[]; seq: string; start?: number }[]): string {
  const atoms: PdbCaAtom[] = chains.flatMap((c) =>
    c.pts.map((p, k) => ({ chainId: c.id, resSeq: (c.start ?? 1) + k, resName: THREE[c.seq[k]], x: p[0], y: p[1], z: p[2], bFactor: 20 })));
  return caAtomsToPdb(atoms);
}

/** mmCIF text of `rows`: (group, atom, residue, label chain, label seq or '.', x, y, z, author chain, element). */
function cif(rows: [string, string, string, string, string, number, number, number, string, string][]): string {
  const head = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_comp_id', 'label_asym_id', 'label_seq_id', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'auth_seq_id', 'auth_asym_id'];
  const body = rows.map(([g, atom, comp, label, seq, x, y, z, auth, el], i) =>
    [g, i + 1, el, atom, comp, label, seq, x.toFixed(3), y.toFixed(3), z.toFixed(3), seq === '.' ? 500 + i : seq, auth].join(' '));
  return ['data_SYNT', '_entry.id SYNT', 'loop_', ...head.map((h) => `_atom_site.${h}`), ...body, '#', ''].join('\n');
}
/** mmCIF rows of a Cα chain. */
const cifChain = (label: string, auth: string, t: { pts: V3[]; seq: string }): Parameters<typeof cif>[0] =>
  t.pts.map((p, k) => ['ATOM', 'CA', THREE[t.seq[k]], label, String(k + 1), p[0], p[1], p[2], auth, 'C']);

const A80 = trace(80, 0x2545f4914f6cdd1dn);
const OTHER = trace(70, 0x9e3779b97f4a7c15n);
/** Structure A: chain A, 80 residues. */
const PDB_A = pdb({ id: 'A', ...A80 });
/** Structure B: chain B, residues 11-70 of A, moved by Q and SHIFT. */
const B60 = { pts: A80.pts.slice(10, 70).map(moved), seq: A80.seq.slice(10, 70) };
const PDB_B = pdb({ id: 'B', ...B60, start: 11 });
/** Structure B': chain B, all 80 residues of A, moved. */
const PDB_B80 = pdb({ id: 'B', pts: A80.pts.map(moved), seq: A80.seq });

const A = (chain = 'A', text = PDB_A): StructureInput => ({ text, chain, entry: 'SYNA' });
const B = (chain = 'B', text = PDB_B): StructureInput => ({ text, chain, entry: 'SYNB' });

/** The residue pairs (index in A, index in B) the alignment's gap-free columns give. */
function pairsOf(al: StructureAlignment): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, j = 0;
  for (let k = 0; k < al.alignedSequenceA.length; k++) {
    const ca = al.alignedSequenceA[k], cb = al.alignedSequenceB[k];
    if (ca !== '-' && cb !== '-') out.push([i, j]);
    if (ca !== '-') i++;
    if (cb !== '-') j++;
  }
  return out;
}
const close = (got: number, want: number, tol: number, what: string) =>
  expect(Math.abs(got - want), `${what}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);

// ─── Reference data ───

const REF = 'reference/structure.json';
const HHB = 'rcsb/4HHB.cif';
const MBN = 'rcsb/1MBN.cif';
const haveRef = haveTestData(REF, HHB, MBN);
interface RefSuperposition { chain_1: string; chain_2: string; equivalent_residues: number; identity: number; rmsd: number }
interface RefTm {
  chain_1: string; chain_2: string; length_1: number; length_2: number; tm_score_norm_1: number; tm_score_norm_2: number;
  rmsd: number; aligned_length: number; identity_aligned: number; alignment_1: string; alignment_2: string;
}
const reference = () => JSON.parse(read(REF)) as { sequence_superposition: RefSuperposition[]; tm_align: RefTm[] };
/** "4HHB.A" -> the structure input for that chain of rcsb/4HHB.cif. */
const rcsb = (name: string): StructureInput => {
  const [entry, chain] = name.split('.');
  return { text: read(`rcsb/${entry}.cif`), chain, entry };
};
/** The two pairs the story names: 4HHB.A/4HHB.B and 1MBN.A/4HHB.A. */
const STORY_PAIRS = [['4HHB.A', '4HHB.B'], ['1MBN.A', '4HHB.A']];

/** Cα coordinates of a chain, in chain order, from the engine's Cα view (label chain ids). */
const caOf = (input: StructureInput): V3[] =>
  parsePdbCaCoordinates(input.text).filter((a) => (a.chainId || 'A') === input.chain).map((a) => [a.x, a.y, a.z]);

// ─── AC1 ───

describe('reports RMSD, TM-score, identity and equivalent residues', () => {
  it('by either method, a chain against a rigidly moved part of itself: RMSD 0, identity 1, every shared residue equivalent', () => {
    for (const method of METHODS) {
      const al = alignStructures(A(), B(), method);
      expect(al.method).toBe(method);
      expect(al.a).toEqual({ entry: 'SYNA', chain: 'A', authorId: 'A', residues: 80 });
      expect(al.b).toEqual({ entry: 'SYNB', chain: 'B', authorId: 'B', residues: 60 });
      expect(al.equivalentResidues, method).toBe(60);
      expect(al.sequenceIdentity, method).toBe(1);
      expect(al.rmsdAngstrom, method).toBeLessThan(2e-3);
      expect(pairsOf(al)).toEqual(Array.from({ length: 60 }, (_, k) => [k + 10, k]));
    }
    expect(alignOpsCalled()).toEqual(['align_structures_tm', 'align_pdb_kabsch']);
  });

  it('by TM-score, reports the TM-score normalised by each chain: 60/80 by the 80-residue chain, 1 by its 60-residue part', () => {
    const al = alignStructures(A(), B(), 'tm');
    expect(al.tmScores.map((s) => s.name)).toEqual(['TM-score by SYNA.A', 'TM-score by SYNB.B']);
    expect(al.tmScores.every((s) => !s.approximate)).toBe(true);
    close(al.tmScores[0].value, 0.75, 1e-4, 'normalised by A');
    close(al.tmScores[1].value, 1, 1e-4, 'normalised by B');
    expect(al.tmScores[0].detail).toMatch(/normalised by SYNA\.A: 80 residues, d0 \d\.\d\d Å/);
    expect(al.tmScores[1].detail).toMatch(/normalised by SYNB\.B: 60 residues/);
    expect(al.methodDescription).toMatch(/TM-align-style/);
  });

  it("by sequence, labels the engine's score TM≈, approximate, and never a TM-align TM-score", () => {
    const al = alignStructures(A(), B(), 'sequence');
    expect(al.tmScores).toHaveLength(1);
    const [s] = al.tmScores;
    expect(s.approximate).toBe(true);
    expect(s.name).toBe('TM≈ (approximate)');
    expect(s.detail).toMatch(/not a TM-align TM-score/);
    expect(s.detail).toMatch(/longer chain \(80 residues\)/);
    // Scored with d0 from the 60 pairs and divided by the longer chain: 60/80 on a perfect fit.
    close(s.value, 0.75, 1e-3, 'TM≈');
    expect(al.methodDescription).toMatch(/BLOSUM62/);
  });

  it('aligns the chain an mmCIF label id names, not the chain whose author id is that letter', () => {
    const other = trace(50, 0x1234567n);
    // Label A is author B, and label B is author A.
    const text = cif([...cifChain('A', 'B', A80), ...cifChain('B', 'A', other)]);
    expect(structureChains(text)).toEqual([
      { id: 'A', authorId: 'B', residues: 80, caResidues: 80 },
      { id: 'B', authorId: 'A', residues: 50, caResidues: 50 },
    ]);
    for (const method of METHODS) {
      const al = alignStructures({ text, chain: 'A', entry: 'SYNT' }, { text: PDB_B80, chain: 'B', entry: 'SYNB' }, method);
      expect(al.a).toEqual({ entry: 'SYNT', chain: 'A', authorId: 'B', residues: 80 });
      expect(al.equivalentResidues, method).toBe(80);
      expect(al.rmsdAngstrom, method).toBeLessThan(2e-3);
    }
    expect(engine.mock.calls.filter((c) => ALIGN_OPS.includes(c[0])).map((c) => (c[1] as { chainA: string }).chainA)).toEqual(['B', 'B']);
  });

  it('by sequence, reports no superposition for chains whose sequence alignment pairs no residues, with the engine verdict', () => {
    // Ten Trp against ten Pro: two gaps (-29) score above ten W/P pairs (-40), so nothing pairs.
    const line = (id: string, k: number) => ({ id, pts: A80.pts.slice(k, k + 10), seq: '' });
    const trp = pdb({ ...line('A', 0), seq: 'W'.repeat(10) });
    const pro = pdb({ ...line('B', 30), seq: 'P'.repeat(10) });
    expect(() => alignStructures(A('A', trp), B('B', pro), 'sequence')).toThrow(/^SYNA\.A and SYNB\.B: Not superposed: the sequence alignment of chain A and chain B pairs no residues/);
    expect(alignOpsCalled()).toEqual(['align_pdb_kabsch']);
  });

  it('refuses an unknown method rather than choosing one', () => {
    expect(() => structureAlignmentMethodOf('tm-align')).toThrow(/Unknown structure alignment method "tm-align"/);
    expect(() => alignStructures(A(), B(), 'kabsch' as StructureAlignmentMethod)).toThrow(/Unknown structure alignment method/);
    expect(alignOpsCalled()).toEqual([]);
  });

  it('the Align Structures operation creates the alignment document, and the results table shows every number', () => {
    const doc = (id: string, name: string, text: string, chain: string): SequenceDocument => ({
      id, name, accession: `PDB_${name}`, description: '', moleculeType: 'Protein', topology: 'linear', sequence: '', features: [], primers: [],
      history: [], createdAt: '', updatedAt: '', folder: 'Protein Documents', docMetadata: { PDBText: text, Chain: chain },
    } as SequenceDocument);
    const r = runStructureAlignment(doc('a', 'SYNA', PDB_A, 'A'), doc('b', 'SYNB chain B', PDB_B, 'B'), { method: 'tm', chainA: '', chainB: '' }, { sourceLabel: 'x' });
    const out = r.created[0];
    expect(out.documentKind).toBe('alignment');
    expect(out.alignmentMeta?.sequences?.map((s) => [s.name, s.sequence])).toEqual([
      ['SYNA.A', r.alignment.alignedSequenceA], ['SYNB.B', r.alignment.alignedSequenceB],
    ]);
    expect(out.docMetadata).toMatchObject({ 'Equivalent residues': 60, 'Sequence identity (%)': 100, 'TM-score by SYNA.A': r.alignment.tmScores[0].value });
    expect(JSON.parse(String(out.docMetadata?.['Transformation matrix (B onto A)'])).matrix).toEqual(r.alignment.transformationMatrix);
    expect(r.summary).toMatch(/^SYNA\.A vs SYNB\.B: RMSD 0\.00 Å, TM-score by SYNA\.A 0\.750, TM-score by SYNB\.B 1\.000, identity 100%, 60 equivalent residues$/);
    expect(() => runStructureAlignment(doc('a', 'SYNA', PDB_A, 'A'), doc('b', 'SYNB', PDB_B, 'B'), { method: '' }, { sourceLabel: 'x' })).toThrow(/Unknown structure alignment method/);
    // A chain picked in the window wins over the document's own chain.
    const two = pdb({ id: 'C', ...OTHER }, { id: 'A', ...A80 });
    const picked = runStructureAlignment(doc('t', 'SYNT chain C', two, 'C'), doc('b', 'SYNB', PDB_B, 'B'), { method: 'sequence', chainA: 'A', chainB: '' }, { sourceLabel: 'x' });
    expect([recordName(picked.alignment.a), picked.alignment.equivalentResidues, picked.alignment.sequenceIdentity]).toEqual(['SYNT.A', 60, 1]);
    const own = runStructureAlignment(doc('t', 'SYNT chain C', two, 'C'), doc('b', 'SYNB', PDB_B, 'B'), { method: 'sequence', chainA: '', chainB: '' }, { sourceLabel: 'x' });
    expect(recordName(own.alignment.a)).toBe('SYNT.C');

    const html = renderToStaticMarkup(React.createElement(StructureAlignmentResults, { alignment: r.alignment }));
    for (const text of ['SYNA.A', 'SYNB.B', 'RMSD', '0.00 Å', 'TM-score by SYNA.A', '0.750', 'TM-score by SYNB.B', '1.000', 'Sequence identity', '100.0%', 'Equivalent residues', '60']) {
      expect(html, text).toContain(text);
    }
    const seqHtml = renderToStaticMarkup(React.createElement(StructureAlignmentResults, { alignment: alignStructures(A(), B(), 'sequence') }));
    expect(seqHtml).toContain('TM≈ (approximate)');
    expect(seqHtml).not.toContain('TM-score by');
  });

  it('the dialog offers the structure documents, their chains and both methods', () => {
    const doc = (id: string, name: string, text: string, chain: string): SequenceDocument => ({
      id, name, accession: '', description: '', moleculeType: 'Protein', topology: 'linear', sequence: 'ACD', features: [], primers: [],
      history: [], createdAt: '', updatedAt: '', folder: 'Protein Documents', docMetadata: { PDBText: text, Chain: chain },
    } as SequenceDocument);
    const plain = { ...doc('p', 'plain protein', '', ''), docMetadata: {} } as SequenceDocument;
    const two = pdb({ id: 'A', ...A80 }, { id: 'C', ...trace(8, 7n) });
    const html = renderToStaticMarkup(React.createElement(StructureAlignmentDialog, {
      documents: [doc('a', 'SYNA', two, 'A'), plain, doc('b', 'SYNB', PDB_B, 'B')],
      onCreate: () => undefined, onDownload: () => undefined, onClose: () => undefined,
    }));
    expect(html).toContain('SYNA');
    expect(html).toContain('SYNB');
    expect(html).not.toContain('plain protein');
    expect(html).toContain('A (80 residues with Cα)');
    expect(html).toContain('C (8 residues with Cα: fewer than 10)');
    expect(html).toContain('By structure (TM-align-style)');
    expect(html).toContain('By sequence (Kabsch superposition)');
    expect(html).toMatch(/<option value="A" selected="">A \(80 residues with Cα\)/);
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*class="btn-primary-sm"(?![^>]*disabled)[^>]*>.*Align<\/button>/);

    // A document whose own chain is too short: the window says why and does not offer to align.
    const refused = renderToStaticMarkup(React.createElement(StructureAlignmentDialog, {
      documents: [doc('c', 'SYNC', two, 'C'), doc('b', 'SYNB', PDB_B, 'B')],
      onCreate: () => undefined, onDownload: () => undefined, onClose: () => undefined,
    }));
    expect(refused).toContain("Structure A, SYNC chain C, has 8 residues with Cα coordinates; a structure alignment needs at least 10, as RCSB&#x27;s does.");
    expect(refused).toMatch(/<button[^>]*class="btn-primary-sm"[^>]*disabled=""[^>]*>.*Align<\/button>/);
    expect(alignOpsCalled()).toEqual([]);
  });

  it.skipIf(!haveRef)("4HHB.A/4HHB.B and 1MBN.A/4HHB.A by TM-score: TM-align's TM-score normalised by each chain, its RMSD and aligned length (reference tm_align)", () => {
    for (const [n1, n2] of STORY_PAIRS) {
      const ref = reference().tm_align.find((c) => c.chain_1 === n1 && c.chain_2 === n2)!;
      expect(ref, `${n1}/${n2} in tm_align`).toBeDefined();
      const al = alignStructures(rcsb(n1), rcsb(n2), 'tm');
      console.log(`${n1}/${n2} TM: ${al.tmScores.map((s) => s.value.toFixed(5)).join('/')} ref ${ref.tm_score_norm_1}/${ref.tm_score_norm_2}, RMSD ${al.rmsdAngstrom.toFixed(3)} ref ${ref.rmsd}, equivalent ${al.equivalentResidues} ref ${ref.aligned_length}, identity ${al.sequenceIdentity.toFixed(4)} ref ${ref.identity_aligned}`);
      expect([recordName(al.a), recordName(al.b)]).toEqual([n1, n2]);
      expect([al.a.residues, al.b.residues]).toEqual([ref.length_1, ref.length_2]);
      expect(al.tmScores.map((s) => s.name)).toEqual([`TM-score by ${n1}`, `TM-score by ${n2}`]);
      // The tolerances the engine's own reference test holds (structure_superposition_reference.rs).
      close(al.tmScores[0].value, ref.tm_score_norm_1, 0.02, `${n1}/${n2} TM-score by ${n1}`);
      close(al.tmScores[1].value, ref.tm_score_norm_2, 0.02, `${n1}/${n2} TM-score by ${n2}`);
      close(al.rmsdAngstrom, ref.rmsd, 0.15, `${n1}/${n2} RMSD`);
      close(al.equivalentResidues, ref.aligned_length, 3, `${n1}/${n2} equivalent residues`);
      // Identity, which the engine's test does not check: within 0.03 of TM-align's over its pairs.
      close(al.sequenceIdentity, ref.identity_aligned, 0.03, `${n1}/${n2} identity`);
      // The identity and the pair count are those of the alignment the FASTA carries.
      const pairs = pairsOf(al);
      expect(pairs).toHaveLength(al.equivalentResidues);
      const same = pairs.filter(([i, j]) => al.alignedSequenceA.replace(/-/g, '')[i] === al.alignedSequenceB.replace(/-/g, '')[j]).length;
      close(al.sequenceIdentity, same / pairs.length, 1e-12, `${n1}/${n2} identity over the pairs`);
    }
  });

  it.skipIf(!haveRef)("4HHB.A/4HHB.B and 1MBN.A/4HHB.A by sequence: Biopython's equivalent residues, identity and RMSD (reference sequence_superposition)", () => {
    for (const [n1, n2] of STORY_PAIRS) {
      const ref = reference().sequence_superposition.find((c) => c.chain_1 === n1 && c.chain_2 === n2)!;
      expect(ref, `${n1}/${n2} in sequence_superposition`).toBeDefined();
      const al = alignStructures(rcsb(n1), rcsb(n2), 'sequence');
      console.log(`${n1}/${n2} sequence: equivalent ${al.equivalentResidues} ref ${ref.equivalent_residues}, identity ${al.sequenceIdentity} ref ${ref.identity}, RMSD ${al.rmsdAngstrom} ref ${ref.rmsd}, TM≈ ${al.tmScores[0].value}`);
      expect([recordName(al.a), recordName(al.b)]).toEqual([n1, n2]);
      expect(al.equivalentResidues).toBe(ref.equivalent_residues);
      close(al.sequenceIdentity, ref.identity, 5e-5, `${n1}/${n2} identity`);
      close(al.rmsdAngstrom, ref.rmsd, 0.05, `${n1}/${n2} RMSD`);
      expect(al.tmScores.map((s) => [s.name, s.approximate])).toEqual([['TM≈ (approximate)', true]]);
    }
  });
});

// ─── AC2 ───

describe('exports the structure-based alignment as FASTA', () => {
  it('writes two records named ENTRY.CHAIN, A first, the aligned sequences with - for each gap, read back by the aligned-FASTA reader', () => {
    for (const method of METHODS) {
      const al = alignStructures(A(), B(), method);
      const fasta = structureAlignmentFasta(al);
      const lines = fasta.trimEnd().split('\n');
      expect(lines.filter((l) => l.startsWith('>'))).toEqual(['>SYNA.A', '>SYNB.B']);
      expect(lines[0]).toBe('>SYNA.A');
      expect(lines.every((l) => l.length <= 60), 'lines of at most 60').toBe(true);
      const back = parseAlignedFasta(fasta);
      expect(back?.names).toEqual(['SYNA.A', 'SYNB.B']);
      expect(back?.sequences).toEqual([al.alignedSequenceA, al.alignedSequenceB]);
      const [ra, rb] = back!.sequences;
      // B is residues 11-70 of A: ten gaps either side, each written as '-'.
      expect(ra).toBe(A80.seq);
      expect(rb).toBe(`${'-'.repeat(10)}${B60.seq}${'-'.repeat(10)}`);
      // The file itself, not only what a lenient reader makes of it ('.' would read back as '-').
      const wrap60 = (s: string) => s.match(/.{1,60}/g)!.join('\n');
      expect(fasta).toBe(`>SYNA.A\n${wrap60(A80.seq)}\n>SYNB.B\n${wrap60(rb)}\n`);
      expect(lines.filter((l) => !l.startsWith('>')).every((l) => /^[A-Z-]+$/.test(l))).toBe(true);
    }
  });

  it('names the file after both records', () => {
    const al = alignStructures(A(), B(), 'tm');
    expect(structureAlignmentFileName(al, 'fasta')).toBe('SYNA.A_SYNB.B_alignment.fasta');
    expect(structureEntryId('HEADER    OXYGEN TRANSPORT                        07-MAR-84   4HHB\n', 'x')).toBe('4HHB');
    expect(structureEntryId('data_1MBN\n_entry.id   1MBN\nloop_\n_atom_site.id\n', 'x')).toBe('1MBN');
    expect(structureEntryId('ATOM      1  CA  ALA A   1\n', 'my model')).toBe('my model');
  });

  it.skipIf(!haveRef)("4HHB.A/4HHB.B and 1MBN.A/4HHB.A: each record is the whole chain TM-align and Biopython read, gapped where the alignment puts its gaps", () => {
    for (const [n1, n2] of STORY_PAIRS) {
      const ref = reference().tm_align.find((c) => c.chain_1 === n1 && c.chain_2 === n2)!;
      for (const method of METHODS) {
        const al = alignStructures(rcsb(n1), rcsb(n2), method);
        const back = parseAlignedFasta(structureAlignmentFasta(al))!;
        expect(back.names).toEqual([n1, n2]);
        expect(back.sequences.map((s) => s.replace(/-/g, '')), `${n1}/${n2} ${method}`).toEqual([ref.alignment_1.replace(/-/g, ''), ref.alignment_2.replace(/-/g, '')]);
        expect(back.sequences[0].length).toBe(back.sequences[1].length);
        expect(pairsOf(al)).toHaveLength(al.equivalentResidues);
      }
    }
  });
});

// ─── AC3 ───

describe('saves the transformation matrix as JSON', () => {
  it('states direction B onto A, units in ångströms and row-major order, and its matrix is the inverse of the motion that made B', () => {
    for (const method of METHODS) {
      const al = alignStructures(A(), B(), method);
      const json = JSON.parse(structureAlignmentMatrixJson(al));
      expect(json.direction).toMatch(/^B onto A: a point x of SYNB\.B, in its file's coordinates, moves to R x \+ t in the frame of SYNA\.A$/);
      expect(json.units).toMatch(/ångströms \(Å\)/);
      expect(json.order).toMatch(/^row-major: matrix\[i\]\[j\] is row i, column j/);
      expect(json.fixed).toMatchObject({ entry: 'SYNA', chain: 'A' });
      expect(json.moving).toMatchObject({ entry: 'SYNB', chain: 'B' });
      expect(json.matrix).toEqual(al.transformationMatrix);
      // B = Q a + SHIFT, so B onto A is R = Q^T, t = -Q^T SHIFT (to the 3 decimals PDB keeps).
      const m = json.matrix as number[][];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) close(m[i][j], Q[j][i], 1e-4, `${method} R[${i}][${j}]`);
        close(m[i][3], -(Q[0][i] * SHIFT[0] + Q[1][i] * SHIFT[1] + Q[2][i] * SHIFT[2]), 2e-3, `${method} t[${i}]`);
      }
      expect(m[3]).toEqual([0, 0, 0, 1]);
      // And it moves each of B's atoms onto its source atom in A.
      B60.pts.forEach((p, k) => close(dist(apply(m, p), A80.pts[k + 10]), 0, 3e-3, `${method} residue ${k + 11}`));
    }
  });

  it('names the file for the motion it holds', () => {
    expect(structureAlignmentFileName(alignStructures(A(), B(), 'sequence'), 'matrix')).toBe('SYNB.B_onto_SYNA.A_matrix.json');
  });

  it.skipIf(!haveRef)("4HHB.B onto 4HHB.A and 4HHB.A onto 1MBN.A: the matrix gives back the reported RMSD (by sequence) and TM-score by A (by TM-score)", () => {
    for (const [n1, n2] of STORY_PAIRS) {
      const [ia, ib] = [rcsb(n1), rcsb(n2)];
      const [pa, pb] = [caOf(ia), caOf(ib)];
      const seq = alignStructures(ia, ib, 'sequence');
      const m = JSON.parse(structureAlignmentMatrixJson(seq)).matrix as number[][];
      const sq = pairsOf(seq).map(([i, j]) => dist(pa[i], apply(m, pb[j])) ** 2);
      close(Math.sqrt(sq.reduce((s, x) => s + x, 0) / sq.length), seq.rmsdAngstrom, 1e-3, `${n1}/${n2} RMSD under the matrix`);

      const tm = alignStructures(ia, ib, 'tm');
      const mt = JSON.parse(structureAlignmentMatrixJson(tm)).matrix as number[][];
      const d0 = 1.24 * Math.cbrt(tm.a.residues - 15) - 1.8;
      const score = pairsOf(tm).reduce((s, [i, j]) => s + 1 / (1 + (dist(pa[i], apply(mt, pb[j])) / d0) ** 2), 0) / tm.a.residues;
      close(score, tm.tmScores[0].value, 1e-6, `${n1}/${n2} TM-score by A under the matrix`);
    }
  });
});

// ─── AC4 ───

describe('refuses chains shorter than 10 residues or without C-alpha coordinates', () => {
  /** Residues 21 to 20 + n of structure A as chain `id`: residues 11 onward of B are their moved copies. */
  const short = (n: number, id = 'S') => pdb({ id, pts: A80.pts.slice(20, 20 + n), seq: A80.seq.slice(20, 20 + n), start: 21 });

  it(`refuses a chain of ${MIN_ALIGNABLE_RESIDUES - 1} residues, naming it, before the engine is asked to align; accepts ${MIN_ALIGNABLE_RESIDUES}`, () => {
    for (const method of METHODS) {
      expect(() => alignStructures(A('S', short(9)), B(), method)).toThrow(
        'Structure A, SYNA chain S, has 9 residues with Cα coordinates; a structure alignment needs at least 10, as RCSB\'s does.');
      expect(() => alignStructures(A(), B('S', short(9)), method)).toThrow(/^Structure B, SYNB chain S, has 9 residues/);
      expect(alignOpsCalled()).toEqual([]);
      const ok = alignStructures(A('S', short(10)), B(), method);
      expect([ok.a.residues, ok.equivalentResidues]).toEqual([10, 10]);
      expect(ok.rmsdAngstrom).toBeLessThan(2e-3);
      expect(alignOpsCalled()).toHaveLength(1);
      engine.mockClear();
    }
    expect(chainProblem(A('S', short(1)), 'A')).toMatch(/has 1 residue with Cα coordinates/);
  });

  it('names both chains when both are refused', () => {
    expect(() => alignStructures(A('S', short(4)), B('T', short(9, 'T')), 'tm')).toThrow(
      /^Structure A, SYNA chain S, has 4 residues .* Structure B, SYNB chain T, has 9 residues/);
    expect(alignOpsCalled()).toEqual([]);
  });

  it('refuses an mmCIF polymer chain without Cα coordinates, and counts no calcium ion as a Cα', () => {
    const backbone = (label: string, n: number) => Array.from({ length: n }, (_, k): Parameters<typeof cif>[0][number] =>
      ['ATOM', 'N', 'GLY', label, String(k + 1), k * 3.8, 0, 0, label, 'N']);
    // Chain N: 12 glycines with N atoms only. Chain D: 12 nucleotides (P atoms). Chain M: 9 Cα
    // residues and three more whose atom named CA is a calcium, not a carbon. Chain E: a calcium ion.
    const nine = trace(12, 5n);
    const text = cif([
      ...cifChain('A', 'A', A80),
      ...backbone('N', 12),
      ...Array.from({ length: 12 }, (_, k): Parameters<typeof cif>[0][number] => ['ATOM', 'P', 'DA', 'D', String(k + 1), 0, k * 6, 0, 'D', 'P']),
      ...cifChain('M', 'M', nine).map((r, k): Parameters<typeof cif>[0][number] => (k < 9 ? r : [...r.slice(0, 9), 'CA'] as Parameters<typeof cif>[0][number])),
      ['HETATM', 'CA', 'CA', 'E', '.', 1, 2, 3, 'A', 'CA'],
    ]);
    expect(structureChains(text)).toEqual([
      { id: 'A', authorId: 'A', residues: 80, caResidues: 80 },
      { id: 'N', authorId: 'N', residues: 12, caResidues: 0 },
      { id: 'D', authorId: 'D', residues: 12, caResidues: 0 },
      { id: 'M', authorId: 'M', residues: 12, caResidues: 9 },
    ]);
    const at = (chain: string): StructureInput => ({ text, chain, entry: 'SYNT' });
    for (const method of METHODS) {
      expect(() => alignStructures(at('N'), B(), method)).toThrow('Structure A, SYNT chain N, has no Cα coordinates; a structure alignment superposes Cα atoms.');
      expect(() => alignStructures(at('D'), B(), method)).toThrow(/^Structure A, SYNT chain D, has no Cα coordinates/);
      expect(() => alignStructures(at('M'), B(), method)).toThrow(/^Structure A, SYNT chain M, has 9 residues with Cα coordinates/);
      expect(() => alignStructures(at('E'), B(), method)).toThrow("Structure A (SYNT) has no polymer chain 'E' (its polymer chains: A, N, D, M).");
    }
    expect(alignOpsCalled()).toEqual([]);
    expect(alignStructures(at('A'), B(), 'tm').equivalentResidues).toBe(60);
  });

  it('refuses a PDB chain with no Cα record, an empty structure and a structure with no chains at all', () => {
    const nOnly = PDB_A.replace(/END\n$/, '') + 'ATOM     81  N   GLY Z   1       1.000   2.000   3.000  1.00 20.00           N\nEND\n';
    expect(structureChains(nOnly).map((c) => c.id)).toEqual(['A']);
    expect(() => alignStructures(A('Z', nOnly), B(), 'sequence')).toThrow("Structure A (SYNA) has no chain 'Z' with Cα coordinates (its chains with Cα coordinates: A).");
    expect(() => alignStructures(A('A', ''), B(), 'tm')).toThrow('Structure A (SYNA) has no structure file to align.');
    expect(() => alignStructures(A('', 'HEADER    NOTHING\nEND\n'), B(), 'tm')).toThrow('Structure A (SYNA) has no chain with Cα coordinates.');
    expect(alignOpsCalled()).toEqual([]);
  });
});
