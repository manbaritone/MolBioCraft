// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Annotate from documents: every feature of the chosen
 * reference documents is searched for in each target sequence on both strands — k-mer seeds
 * locate a candidate region, a semiglobal alignment of the feature against that region places
 * it exactly — and is copied onto the target when its identity over the feature's length
 * reaches the threshold. Circular targets are searched across the origin, and a feature that
 * lands across the target's origin is transferred as its parts on either side of it.
 *
 * A joined feature (exons, or any `join(...)` of parts with bases between them) is searched for
 * as the stretch of the reference it spans, introns included, and each of its parts is then
 * placed on its own, so it is transferred as its parts in the target's coordinates and never as
 * one range over an intron. Its identity is read over its parts' bases alone.
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';
import { reverseComplement } from './bioEngine';
import type { FeatureSegment, SequenceDocument, SequenceFeature } from '../types/bio';

export interface FeatureHit {
  /**
   * The feature to copy onto the target: the reference's, with the target's own `segments` when
   * it is transferred as more than one part (a joined feature, or a match across the target's
   * origin) and none when it is one range (the reference's segment coordinates mean nothing on
   * the target).
   */
  feature: SequenceFeature;
  reference: string;
  /**
   * 1-based target coordinates from the feature's first base to its last; for a match across
   * the origin, `1..length`, as the importers write such a feature.
   */
  start: number;
  end: number;
  strand: 1 | -1;
  identityPct: number;
}

interface Aln { alignedSeq1: string; alignedSeq2: string }

/** A stretch of a sequence, 1-based and inclusive. */
interface Range { start: number; end: number }

const K = 12;

/**
 * The longest reference feature that is transferred, in bases: from its first base to its last,
 * introns included, the stretch the search reads.
 *
 * The placement aligns each part against a window of the part and two fifths of the feature's
 * length more (about 1.4 times the length of a feature of one part), and the engine's pairwise
 * aligner traps on a matrix past about a billion cells — measured under BG-01M6S1Q9: a 25,000 bp
 * feature places in under a second, a 30,000 bp one traps in `align_pairwise`.
 * A circular target is searched with this many of its first bases repeated past its end, so every
 * feature this long can be found across the origin. A longer feature is left out, and the dialog
 * says how many of the chosen references' features that is. It was 5,000 bases, which left out
 * an ordinary 6 kb operon with no notice.
 */
export const MAX_TRANSFERRED_FEATURE_BP = 20_000;

/** Most-voted diagonal start of `query` in `target` (0-based), or null. */
function seed(query: string, target: string): number | null {
  const index = new Map<string, number[]>();
  for (let i = 0; i + K <= target.length; i++) {
    const k = target.slice(i, i + K);
    const l = index.get(k);
    if (l) { if (l.length < 16) l.push(i); } else index.set(k, [i]);
  }
  const votes = new Map<number, number>();
  for (let j = 0; j + K <= query.length; j += 2) {
    for (const i of index.get(query.slice(j, j + K)) ?? []) votes.set(Math.round((i - j) / 4), (votes.get(Math.round((i - j) / 4)) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const [d, v] of votes) if (!best || v > best[1]) best = [d, v];
  return best && best[1] >= 2 ? best[0] * 4 : null;
}

/**
 * Places `query` in `target` near diagonal `diag`, searching `pad` bases either side; returns the
 * 0-based start/end in target, the bases that match, and the identity over the query's length.
 */
function place(query: string, target: string, diag: number, pad: number): { start: number; end: number; same: number; identity: number } | null {
  const ws = Math.max(0, diag - pad);
  const we = Math.min(target.length, diag + query.length + pad);
  const window = target.slice(ws, we);
  if (window.length < query.length * 0.5) return null;
  const r = invokeRustBioSync<Aln>('align_pairwise', {
    seq1: window, seq2: query, mode: 'semiglobal', matchScore: 2, mismatchPenalty: -3, gapOpen: -5, gapExtend: -2, maxLen: Math.max(window.length, query.length) + 10,
  });
  const a = r.alignedSeq1;
  const b = r.alignedSeq2;
  let first = -1;
  let last = -1;
  for (let c = 0; c < b.length; c++) if (b[c] !== '-') { if (first < 0) first = c; last = c; }
  if (first < 0) return null;
  let same = 0;
  for (let c = first; c <= last; c++) if (a[c] !== '-' && a[c] === b[c]) same++;
  const before = [...a.slice(0, first)].filter((ch) => ch !== '-').length;
  const inside = [...a.slice(first, last + 1)].filter((ch) => ch !== '-').length;
  if (inside === 0) return null;
  return { start: ws + before, end: ws + before + inside - 1, same, identity: (100 * same) / query.length };
}

/**
 * The parts of a reference feature, each `start <= end`, in stored order (by segment index): its
 * `segments` for a joined or origin-spanning feature (the GenBank and EMBL importers
 * keep the parts there), else its own one range. The GenBank and EMBL importers store a join in
 * the order the record lists it, and a join of complemented parts, such as
 * join(complement(101..160),complement(11..40)), in the reverse of that order, as its
 * complement(join(11..40,101..160)) form lists it (BG-01M6SMBS).
 */
function featureParts(f: SequenceFeature): Range[] {
  if (f.segments && f.segments.length) {
    return [...f.segments]
      .sort((a, b) => a.index - b.index)
      .map((s) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }));
  }
  return [{ start: Math.min(f.start, f.end), end: Math.max(f.start, f.end) }];
}

/**
 * Where a reference feature lies on its reference: the stretch from its first base to its last
 * (`first`, 1-based, and `length`, introns included), and its blocks as offsets into that stretch
 * (0-based, `to` exclusive, in stretch order). On a circular reference the stretch runs from the
 * start of the feature's first stored part, around the origin where a later part lies before it,
 * so a feature written across the origin is read across it and one written in ascending order is
 * not. A block is a run of the feature's parts each starting on the base after the one before
 * ends, so a `join(7951..8000,1..350)` written only because the feature crosses the reference's
 * origin is one block, and exons are one block each.
 */
interface FeatureLayout { first: number; length: number; blocks: { from: number; to: number }[]; bases: number }

function featureLayout(f: SequenceFeature, referenceLength: number, circular: boolean): FeatureLayout | null {
  const parts = featureParts(f);
  if (!parts.length || parts.some((p) => p.start < 1 || p.end > referenceLength)) return null;
  const m = referenceLength;
  // The join's order is the feature's order: on a circular reference the stretch starts at the
  // first part stored; a linear reference has no origin to cross, so it starts at the lowest base.
  const first = circular ? parts[0].start : Math.min(...parts.map((p) => p.start));
  const offset = (p: Range) => (circular ? (p.start - first + m) % m : p.start - first);
  const length = Math.max(...parts.map((p) => offset(p) + p.end - p.start + 1));
  const offsets = parts
    .map((p) => ({ from: offset(p), to: offset(p) + p.end - p.start + 1 }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const blocks: { from: number; to: number }[] = [];
  for (const o of offsets) {
    const last = blocks[blocks.length - 1];
    if (last && o.from === last.to) last.to = o.to; else blocks.push({ ...o });
  }
  return { first, length, blocks, bases: blocks.reduce((n, b) => n + b.to - b.from, 0) };
}

/**
 * How many features of `references` are longer than [`MAX_TRANSFERRED_FEATURE_BP`] from their
 * first base to their last, and so are not transferred — the number the Annotate from Documents
 * dialog states.
 */
export function featuresTooLongToTransfer(references: readonly SequenceDocument[]): number {
  let n = 0;
  for (const ref of references) {
    for (const f of ref.features) {
      if (f.type === 'source') continue;
      const layout = featureLayout(f, ref.sequence.length, ref.topology === 'circular');
      if (layout && layout.length > MAX_TRANSFERRED_FEATURE_BP) n += 1;
    }
  }
  return n;
}

/** A segment as a transferred feature carries it, named as the importers name a feature's parts. */
const segment = (index: number, f: SequenceFeature, r: Range): FeatureSegment =>
  ({ index, name: `${f.name} part ${index}`, start: r.start, end: r.end, color: f.color });

export function annotateFromDocuments(target: SequenceDocument, references: SequenceDocument[], minIdentityPct: number, minLength = 15): FeatureHit[] {
  const T = target.sequence.toUpperCase().replace(/U/g, 'T');
  const n = T.length;
  const circular = target.topology === 'circular';
  // The doubled part is as long as the longest feature that can be transferred, so every one of
  // them can be found across the origin.
  const search = circular ? T + T.slice(0, Math.min(n, MAX_TRANSFERRED_FEATURE_BP)) : T;
  const searchRc = reverseComplement(search, false);
  /**
   * A hit, with `cover`, the ranges its parts cover in `search` coordinates (forward strand,
   * ascending; past `n` where it crosses the origin), and `s`..`e`, the first and last of them.
   */
  const hits: (FeatureHit & { s: number; e: number; cover: Range[] })[] = [];
  for (const ref of references) {
    const R = ref.sequence.toUpperCase().replace(/U/g, 'T');
    const refCircular = ref.topology === 'circular';
    for (const f of ref.features) {
      if (f.type === 'source') continue;
      const layout = featureLayout(f, R.length, refCircular);
      if (!layout || layout.bases < minLength || layout.length > MAX_TRANSFERRED_FEATURE_BP) continue;
      // The stretch the feature spans, introns included: the seed finds where it lies, and each
      // block is then placed within a fifth of that stretch of where the seed puts it, as one
      // alignment of the whole stretch would allow.
      const from = layout.first - 1;
      const stretch = from + layout.length <= R.length
        ? R.slice(from, from + layout.length)
        : R.slice(from) + R.slice(0, from + layout.length - R.length);
      const pad = Math.ceil(layout.length * 0.2) + 20;
      for (const strand of [1, -1] as const) {
        const hay = strand === 1 ? search : searchRc;
        const d = seed(stretch, hay);
        if (d === null) continue;
        const placed: { start: number; end: number }[] = [];
        let same = 0;
        for (const b of layout.blocks) {
          const p = place(stretch.slice(b.from, b.to), hay, d + b.from, pad);
          if (!p) { placed.length = 0; break; } // every block is placed, or the feature is not
          placed.push(p);
          same += p.same;
        }
        if (!placed.length) continue;
        const identity = (100 * same) / layout.bases;
        if (identity < minIdentityPct) continue;
        // back to forward-strand, 1-based target coordinates, in the target's order
        let cover = placed
          .map((p) => (strand === 1 ? { start: p.start + 1, end: p.end + 1 } : { start: hay.length - p.end, end: hay.length - p.start }))
          .sort((a, b) => a.start - b.start);
        let s = cover[0].start;
        let e = Math.max(...cover.map((r) => r.end));
        if (circular) {
          if (s > n) { cover = cover.map((r) => ({ start: r.start - n, end: r.end - n })); s -= n; e -= n; }
        } else if (e > n) {
          continue;
        }
        if (e - s + 1 > n) continue; // a match longer than the molecule is not a placement
        const featStrand = ((f.strand === -1 ? -1 : 1) * strand) as 1 | -1;
        // On the target, each part is one range, or two where it runs across the origin
        // (start..n and 1..end-n, the shape the importers write); a feature across the origin
        // takes the whole molecule as its span. A feature that is one range on the target drops
        // the reference's segments, whose coordinates belong to the reference.
        const pieces: Range[] = [];
        for (const r of cover) {
          if (r.end <= n) pieces.push(r);
          else if (r.start > n) pieces.push({ start: r.start - n, end: r.end - n });
          else pieces.push({ start: r.start, end: n }, { start: 1, end: r.end - n });
        }
        const wrapped = e > n;
        hits.push({
          feature: { ...f, segments: pieces.length > 1 ? pieces.map((r, i) => segment(i + 1, f, r)) : undefined },
          reference: ref.name,
          start: wrapped ? 1 : s,
          end: wrapped ? n : e,
          strand: f.strand === 0 ? 1 : featStrand,
          identityPct: identity,
          s,
          e,
          cover,
        });
      }
    }
  }
  // one hit per site: same-type hits whose parts share >= 90% of the shorter's bases keep the
  // best match (references often name the same element differently, e.g. "ColE1 ori" /
  // "pBR322 ori"). The parts are compared in search coordinates, where a match across the origin
  // is one interval; a feature in another's intron shares none of its bases, so it is a site of
  // its own.
  const kept: (FeatureHit & { s: number; e: number; cover: Range[] })[] = [];
  for (const h of hits.sort((a, b) => b.identityPct - a.identityPct || (b.e - b.s) - (a.e - a.s))) {
    if (!kept.some((k) => k.feature.type === h.feature.type && sameCoveredSite(k.cover, h.cover))) kept.push(h);
  }
  return kept
    .sort((a, b) => a.s - b.s)
    .map(({ s: _s, e: _e, cover: _cover, ...hit }) => hit);
}

/**
 * The ranges a feature covers on its sequence, each `start <= end`: its `segments` for a joined
 * or origin-spanning feature, else its own one range.
 */
export function featureCover(f: { start: number; end: number; segments?: readonly { start: number; end: number }[] }): Range[] {
  if (f.segments && f.segments.length) return f.segments.map((s) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) }));
  return [{ start: Math.min(f.start, f.end), end: Math.max(f.start, f.end) }];
}

/**
 * Two features are at the same site when the bases both cover are at least 90% of the bases the
 * one covering fewer covers, read part by part: a feature across the origin (`1..n` as a span) is
 * not at the site of every feature its span contains, and one in another's intron is not at its
 * site. For one range each, the two overlap by at least 90% of the shorter one.
 */
export function sameCoveredSite(a: readonly Range[], b: readonly Range[]): boolean {
  let shared = 0;
  for (const x of a) for (const y of b) shared += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start) + 1);
  const covered = (c: readonly Range[]) => c.reduce((t, r) => t + r.end - r.start + 1, 0);
  return shared > 0 && shared >= 0.9 * Math.min(covered(a), covered(b));
}
