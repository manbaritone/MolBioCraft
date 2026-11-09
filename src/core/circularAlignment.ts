// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Circular alignment (circular sequences rotated to a common origin): before a
 * multiple alignment, every circular sequence is rotated — and reverse-complemented when it
 * matches better that way — so it starts where the reference (the first sequence) starts.
 * The offset is the most-voted diagonal of shared k-mers between the reference and the
 * doubled target, so it works for plasmids and organelle genomes with any start coordinate.
 */

import { reverseComplement } from './bioEngine';

export interface Rotation {
  /** 0-based position of the target that becomes position 1. */
  offset: number;
  reversed: boolean;
  /** k-mer votes supporting the offset (0 = no shared k-mers; sequence left unchanged). */
  votes: number;
  sequence: string;
}

function bestOffset(ref: string, target: string, k: number): { offset: number; votes: number } {
  const n = target.length;
  if (n < k || ref.length < k) return { offset: 0, votes: 0 };
  const index = new Map<string, number[]>();
  const doubled = target + target.slice(0, k - 1);
  for (let i = 0; i < n; i++) {
    const kmer = doubled.slice(i, i + k);
    if (/[^ACGT]/.test(kmer)) continue;
    const list = index.get(kmer);
    if (list) { if (list.length < 8) list.push(i); } else index.set(kmer, [i]);
  }
  const votes = new Map<number, number>();
  const step = Math.max(1, Math.floor(ref.length / 4000));
  for (let j = 0; j + k <= ref.length; j += step) {
    const hits = index.get(ref.slice(j, j + k));
    if (!hits || hits.length > 3) continue; // skip repeats
    for (const i of hits) {
      const off = (((i - j) % n) + n) % n;
      votes.set(off, (votes.get(off) ?? 0) + 1);
    }
  }
  let best = { offset: 0, votes: 0 };
  // tolerate small indels: pool votes within ±5 of each offset
  for (const [off] of votes) {
    let v = 0;
    for (let d = -5; d <= 5; d++) v += votes.get((((off + d) % n) + n) % n) ?? 0;
    if (v > best.votes || (v === best.votes && (votes.get(off) ?? 0) > (votes.get(best.offset) ?? 0))) best = { offset: off, votes: v };
  }
  return best;
}

export function rotateToReference(ref: string, target: string, isRna = false, k = 14): Rotation {
  const R = ref.toUpperCase().replace(/U/g, 'T');
  const T = target.toUpperCase().replace(/U/g, 'T');
  const fwd = bestOffset(R, T, k);
  const rc = reverseComplement(T, false);
  const rev = bestOffset(R, rc, k);
  const useRev = rev.votes > fwd.votes;
  const pick = useRev ? rev : fwd;
  if (pick.votes === 0) return { offset: 0, reversed: false, votes: 0, sequence: target };
  const src = useRev ? reverseComplement(target, isRna) : target;
  return { offset: pick.offset, reversed: useRev, votes: pick.votes, sequence: src.slice(pick.offset) + src.slice(0, pick.offset) };
}
