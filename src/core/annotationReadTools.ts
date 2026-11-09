// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Compare Annotations (Annotations chapter) and Merge Paired Reads (Assembly chapter). */

import { reverseComplement } from './bioEngine';
import type { SequenceFeature } from '../types/bio';

// ───────────────────────────── compare annotations ─────────────────────────────

export type ComparisonStatus = 'identical' | 'overlapping' | 'only-a' | 'only-b';

export interface FeatureComparison {
  status: ComparisonStatus;
  a?: SequenceFeature;
  b?: SequenceFeature;
  /** Overlap as % of the longer of the two features. */
  overlapPct?: number;
}

const overlapPct = (a: SequenceFeature, b: SequenceFeature) => {
  const ov = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
  if (ov <= 0) return 0;
  return (100 * ov) / Math.max(a.end - a.start + 1, b.end - b.start + 1);
};

/**
 * Pairs features of the same type: identical (same start, end, strand), overlapping
 * (≥ `minOverlapPct` of the longer feature), or present in only one document. Each
 * feature is used in at most one pair (best overlap first).
 */
export function compareAnnotations(
  a: readonly SequenceFeature[],
  b: readonly SequenceFeature[],
  minOverlapPct = 50,
  ignoreTypes: string[] = ['source']
): FeatureComparison[] {
  const keep = (f: SequenceFeature) => !ignoreTypes.includes(f.type);
  const A = a.filter(keep);
  const B = b.filter(keep);
  const usedB = new Set<number>();
  const out: FeatureComparison[] = [];
  const pending: { ai: number }[] = [];
  A.forEach((fa, ai) => {
    const j = B.findIndex((fb, bi) => !usedB.has(bi) && fb.type === fa.type && fb.start === fa.start && fb.end === fa.end && fb.strand === fa.strand);
    if (j >= 0) { usedB.add(j); out.push({ status: 'identical', a: fa, b: B[j], overlapPct: 100 }); }
    else pending.push({ ai });
  });
  for (const { ai } of pending) {
    const fa = A[ai];
    let best = -1;
    let bestPct = 0;
    B.forEach((fb, bi) => {
      if (usedB.has(bi) || fb.type !== fa.type) return;
      const p = overlapPct(fa, fb);
      if (p > bestPct) { bestPct = p; best = bi; }
    });
    if (best >= 0 && bestPct >= minOverlapPct) {
      usedB.add(best);
      out.push({ status: 'overlapping', a: fa, b: B[best], overlapPct: Math.round(bestPct * 10) / 10 });
    } else out.push({ status: 'only-a', a: fa });
  }
  B.forEach((fb, bi) => { if (!usedB.has(bi)) out.push({ status: 'only-b', b: fb }); });
  return out.sort((x, y) => ((x.a ?? x.b)!.start - (y.a ?? y.b)!.start));
}

// ───────────────────────────── paired reads ─────────────────────────────

/** The pair key and mate number of a read name (…_1/_2, _R1/_R2, /1 /2, .1/.2, -F/-R). */
export function mateOf(name: string): { key: string; mate: 1 | 2 } | null {
  const m = /^(.*?)(?:[_.\-\s/])(?:R?([12])|([FR]))(?:_\d{3})?(?:\.(?:fastq|fq|fasta|fa|ab1|scf))?$/i.exec(name.trim());
  if (!m) return null;
  const mate = m[2] ? (Number(m[2]) as 1 | 2) : m[3].toUpperCase() === 'F' ? 1 : 2;
  return { key: m[1], mate };
}

export interface PairMergeResult {
  merged: string | null;
  overlap: number;
  mismatches: number;
  /** Positions (0-based in the merged read) where the mates disagreed. */
  conflicts: number;
}

/**
 * Merges read 1 with the reverse complement of read 2 when they overlap by at least
 * `minOverlap` with at most `maxMismatchPct` mismatches in the overlap. Disagreements take
 * the higher-quality base when qualities are given, otherwise read 1's base.
 */
export function mergePair(
  r1: string,
  r2: string,
  q1: number[] | undefined,
  q2: number[] | undefined,
  minOverlap = 20,
  maxMismatchPct = 10
): PairMergeResult {
  const a = r1.toUpperCase().replace(/[^A-Z]/g, '');
  const b = reverseComplement(r2.toUpperCase().replace(/[^A-Z]/g, ''));
  const qb = q2 ? [...q2].reverse() : undefined;
  let best: { ov: number; mm: number; shift: number } | null = null;
  // Overlap with the end of read 1: b starts at a[shift]. Prefer the longest overlap that passes.
  for (let shift = 0; shift <= a.length - minOverlap; shift++) {
    const ov = Math.min(a.length - shift, b.length);
    if (ov < minOverlap) break;
    let mm = 0;
    const limit = Math.floor((ov * maxMismatchPct) / 100);
    for (let k = 0; k < ov && mm <= limit; k++) if (a[shift + k] !== b[k] && a[shift + k] !== 'N' && b[k] !== 'N') mm++;
    if (mm <= limit) { best = { ov, mm, shift }; break; }
  }
  if (!best) return { merged: null, overlap: 0, mismatches: 0, conflicts: 0 };
  const { ov, mm, shift } = best;
  let out = a.slice(0, shift);
  let conflicts = 0;
  for (let k = 0; k < ov; k++) {
    const x = a[shift + k];
    const y = b[k];
    if (x === y || y === 'N') out += x;
    else if (x === 'N') out += y;
    else {
      conflicts++;
      out += q1 && qb && (qb[k] ?? 0) > (q1[shift + k] ?? 0) ? y : x;
    }
  }
  // When read 2 ends inside read 1 the fragment ends there (read 1's tail is read-through).
  out += b.slice(ov);
  return { merged: out, overlap: ov, mismatches: mm, conflicts };
}
