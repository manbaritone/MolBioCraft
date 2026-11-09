// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Measured 3D structures attached to protein documents (imported .pdb / .cif keeps the file in
 * docMetadata.PDBText, one document per chain). Only these are drawn or compared: a sequence
 * without coordinates has no structure, and the app does not invent one.
 */

import { parsePdbCaCoordinates, type PdbCaAtom } from './genomicsAndStructureSuite';
import type { SequenceDocument } from '../types/bio';

export const structureTextOf = (doc: SequenceDocument | undefined): string =>
  String(doc?.docMetadata?.PDBText ?? doc?.docMetadata?.['PDB Text'] ?? '');

export const hasStructure = (doc: SequenceDocument | undefined): boolean => structureTextOf(doc).trim().length > 0;

/** The Cα atoms of the document's own chain (all chains when the document names none). */
export function structureAtomsOf(doc: SequenceDocument, wholeStructure = false): PdbCaAtom[] {
  const text = structureTextOf(doc);
  if (!text) return [];
  let atoms: PdbCaAtom[];
  try {
    atoms = parsePdbCaCoordinates(text);
  } catch {
    return [];
  }
  const chain = String(doc.docMetadata?.Chain ?? '');
  if (wholeStructure || !chain) return atoms;
  const own = atoms.filter((a) => (a.chainId || 'A') === chain);
  return own.length ? own : atoms;
}

/** Number of polypeptide chains in the document's structure file. */
export function structureChainCount(doc: SequenceDocument): number {
  return new Set(structureAtomsOf(doc, true).map((a) => a.chainId || 'A')).size;
}

const col = (s: string | number, w: number, right = true) => (right ? String(s).padStart(w) : String(s).padEnd(w)).slice(0, w);

/**
 * Cα atoms as fixed-column PDB ATOM records (with HELIX / SHEET records for the secondary
 * structure they carry), so a single chain can be passed to the superposition engine.
 */
export function caAtomsToPdb(atoms: PdbCaAtom[]): string {
  const lines: string[] = [];
  // secondary-structure runs → HELIX / SHEET records
  let i = 0;
  let h = 0;
  let e = 0;
  while (i < atoms.length) {
    const ss = atoms[i].secondaryStructure;
    let j = i;
    while (j + 1 < atoms.length && atoms[j + 1].secondaryStructure === ss && (atoms[j + 1].chainId ?? '') === (atoms[i].chainId ?? '')) j++;
    const a = atoms[i];
    const b = atoms[j];
    const ch = (a.chainId || 'A').slice(0, 1);
    if (ss === 'H') {
      h++;
      lines.push(`HELIX  ${col(h, 3)} ${col(h, 3)} ${col(a.resName, 3)} ${ch} ${col(a.resSeq, 4)}  ${col(b.resName, 3)} ${ch} ${col(b.resSeq, 4)}  1`);
    } else if (ss === 'E') {
      e++;
      lines.push(`SHEET  ${col(e, 3)} ${col('S' + e, 3)} 1 ${col(a.resName, 3)} ${ch}${col(a.resSeq, 4)}  ${col(b.resName, 3)} ${ch}${col(b.resSeq, 4)}  0`);
    }
    i = j + 1;
  }
  atoms.forEach((a, k) => {
    lines.push(
      'ATOM  ' + col(k + 1, 5) + ' ' + ' CA ' + ' ' + col(a.resName, 3) + ' ' + (a.chainId || 'A').slice(0, 1) +
        col(a.resSeq, 4) + '    ' + col(a.x.toFixed(3), 8) + col(a.y.toFixed(3), 8) + col(a.z.toFixed(3), 8) +
        col('1.00', 6) + col((a.bFactor ?? 0).toFixed(2), 6) + '           C'
    );
  });
  lines.push('END');
  return lines.join('\n') + '\n';
}
