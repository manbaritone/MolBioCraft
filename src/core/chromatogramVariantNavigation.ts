// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Maps a variant's reference coordinate back to the base index of the read/trace
 * it was called from, using the alignment the variant caller actually produced
 * (`map_read_and_call_variants`).
 *
 * The engine reports variants in 1-based *reference* coordinates
 * (`refStartPos` + walked alignment columns). The chromatogram viewport works in
 * 0-based *trace base* indices. The engine may also have reverse-complemented
 * the read before aligning (reverse reads), in which case read positions must be
 * mirrored back onto the original trace orientation.
 */

export interface VariantMappingAlignmentLike {
  alignedSeq1: string;
  alignedSeq2: string;
  /** 1-based start of the aligned region inside the (oriented, cleaned) read. */
  ystart?: number;
}

export interface VariantMappingLike {
  alignment: VariantMappingAlignmentLike;
  /** 1-based reference coordinate of the first aligned column. */
  refStartPos: number;
}

const IUPAC_COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', U: 'A', G: 'C', C: 'G', N: 'N',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', '-': '-', '*': '*',
};

/** Same character filter as the Rust `clean_sequence`, keeping original indices. */
function cleanWithIndexMap(raw: string): { cleaned: string; originalIndex: number[] } {
  let cleaned = '';
  const originalIndex: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/[A-Za-z*-]/.test(ch)) {
      cleaned += ch.toUpperCase();
      originalIndex.push(i);
    }
  }
  return { cleaned, originalIndex };
}

function reverseComplementIupac(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i--) out += IUPAC_COMPLEMENT[seq[i]] ?? 'N';
  return out;
}

/**
 * Returns the 0-based index into `readSequence` (the exact string the caller passed
 * to the variant mapper, i.e. chromatogram base calls) for the variant at reference
 * position `refPos1` (1-based), or `null` when the position is not covered by the
 * alignment or the alignment cannot be tied back to the read.
 */
export function mapVariantRefPositionToReadIndex(
  mapping: VariantMappingLike,
  readSequence: string,
  refPos1: number,
  variantType?: string
): number | null {
  const a1 = mapping.alignment.alignedSeq1 ?? '';
  const a2 = mapping.alignment.alignedSeq2 ?? '';
  const ystart = mapping.alignment.ystart ?? 0;
  if (!a1 || !a2 || ystart < 1) return null;

  const { cleaned, originalIndex } = cleanWithIndexMap(readSequence);
  if (cleaned.length === 0) return null;

  // Determine the orientation the engine aligned the read in.
  const alignedRead = a2.replace(/-/g, '');
  const start0 = ystart - 1;
  let reversed: boolean;
  if (cleaned.substr(start0, alignedRead.length) === alignedRead) {
    reversed = false;
  } else if (reverseComplementIupac(cleaned).substr(start0, alignedRead.length) === alignedRead) {
    reversed = true;
  } else {
    return null;
  }

  const wantInsertion = variantType === 'Insertion';
  let refPos = mapping.refStartPos;
  let readPos = start0; // 0-based in oriented read
  let hit: number | null = null;
  const cols = Math.min(a1.length, a2.length);
  for (let k = 0; k < cols; k++) {
    const rb = a1[k];
    const qb = a2[k];
    if (refPos === refPos1) {
      const isInsertionCol = rb === '-';
      if (wantInsertion ? isInsertionCol : !isInsertionCol) {
        // Deletions have no read base: anchor on the next read base (clamped below).
        hit = readPos;
        break;
      }
    }
    if (rb !== '-') refPos++;
    if (qb !== '-') readPos++;
    if (refPos > refPos1 && !wantInsertion) break;
  }
  if (hit === null) return null;

  const clamped = Math.max(0, Math.min(cleaned.length - 1, hit));
  const orientedIdx = reversed ? cleaned.length - 1 - clamped : clamped;
  return originalIndex[orientedIdx] ?? null;
}
