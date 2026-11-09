// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { MSA_MAX_RESIDUES, runMultipleSequenceAlignment } from './bioEngine';
import type { MSAAlignmentResult } from '../types/bio';

type Input = { id: string; name: string; sequence: string; moleculeType?: string };
export const emptyAlignment: MSAAlignmentResult = {
  rows: [], consensus: '', conservation: [], newickTree: '();',
};

/** The interactive engine is bounded; never silently align a prefix or discard a row. */
export function alignmentInputError(docs: readonly Input[], maxLength: number): string | null {
  for (const doc of docs) {
    const seq = doc.sequence.replace(/[-.\s]/g, '');
    if (!seq.length) return `${doc.name}: no residues to align.`;
    if (/[^A-Za-z]/.test(seq)) return `${doc.name}: this aligner supports alphabetic residues only; stop symbols and other characters cannot be silently removed.`;
    if (seq.length > maxLength) return `${doc.name}: ${seq.length.toLocaleString()} residues exceeds this engine's ${maxLength.toLocaleString()}-residue limit. No partial alignment was run.`;
  }
  return null;
}

export function runValidatedAlignment(docs: Input[], algorithm: string): {
  result: MSAAlignmentResult; error: string | null;
} {
  if (!docs.length) return { result: emptyAlignment, error: null };
  const inputError = alignmentInputError(docs, MSA_MAX_RESIDUES);
  if (inputError) return { result: emptyAlignment, error: inputError };
  const types = new Set(docs.map((d) => (d.moleculeType === 'RNA' ? 'DNA' : d.moleculeType)).filter(Boolean));
  if (types.size > 1) {
    return { result: emptyAlignment, error: 'Cannot align nucleotide and protein sequences together. Select members of one molecule type.' };
  }
  if (new Set(docs.map((d) => d.id)).size !== docs.length) {
    return { result: emptyAlignment, error: 'Alignment member IDs must be unique.' };
  }
  try {
    const result = runMultipleSequenceAlignment(
      docs.map(({ id, name, sequence }) => ({ id, name, sequence })), algorithm);
    const rows = new Map(result.rows.map((r) => [r.id, r]));
    if (rows.size !== docs.length || result.rows.length !== docs.length || docs.some((d) => {
      const row = rows.get(d.id);
      return !row || row.alignedSeq.length !== result.consensus.length ||
        row.alignedSeq.replace(/-/g, '').toUpperCase() !== d.sequence.replace(/[-.\s]/g, '').toUpperCase();
    }) || Array.from({ length: result.consensus.length }, (_, c) => c)
      .some((c) => result.rows.every((r) => r.alignedSeq[c] === '-'))) {
      throw new Error('The selected engine returned an inconsistent alignment (changed or omitted residues, or gap-only columns). Its result was rejected; choose a different alignment preset.');
    }
    return { result, error: null };
  } catch (error) {
    return { result: emptyAlignment, error: error instanceof Error ? error.message : String(error) };
  }
}
