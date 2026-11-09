// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Returns why a BBDuk-trimmed read cannot be saved, or null when it can.
 * A trim that removes every base must not silently fall back to the untrimmed read.
 */
export function trimmedReadSaveBlockReason(
  report: { trimmedSequence?: string | null; trimmedLengthBp?: number } | null | undefined
): string | null {
  if (!report) return 'No trimming result is available.';
  const seq = report.trimmedSequence ?? '';
  if (seq.length === 0 || (report.trimmedLengthBp ?? seq.length) <= 0) {
    return 'Trimming removed every base (0 bp retained); there is no trimmed read to save. Lower the quality threshold or check the adapter k-mer settings.';
  }
  return null;
}

/** Shared check for user-loaded PDB/mmCIF text: null when usable, else a message. */
export function pdbTextLoadProblem(text: string, caAtomCount: number, fileName: string): string | null {
  if (!text.trim()) return `${fileName} is empty.`;
  if (caAtomCount === 0) return `${fileName} contains no Cα (CA) ATOM records that could be read.`;
  return null;
}
