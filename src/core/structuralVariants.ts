// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Find Structural Variants (reads against a reference)
 * from split-read evidence. Each read is placed by exact 15-mer matches to the reference:
 * consecutive matches on one diagonal form a segment. A normal read gives one segment; a read
 * crossing a breakpoint gives two, and how they relate names the event:
 *
 *   second segment further along the reference (same strand)          → deletion
 *   further back, with no unmatched read bases between the segments   → tandem duplication
 *   further back by about the number of unmatched read bases between  → insertion
 *   on the opposite strand                                            → inversion breakpoint
 *   a read end of ≥ minClip bases that matches nowhere                 → insertion of new sequence
 *
 * Repetitive k-mers (more than one reference position) are ignored. Calls from different reads
 * within `tolerance` bases are merged; at least `minSupport` reads are required.
 */

export type SvType = 'Deletion' | 'Insertion' | 'Tandem duplication' | 'Inversion';

export interface SvCall {
  type: SvType;
  /** 1-based reference coordinates of the affected region (insertions: the base before the insertion point twice). */
  start: number;
  end: number;
  /** Size in bases (insertions from a clipped end: the observed length, a minimum). */
  size: number;
  support: number;
  reads: string[];
}

export interface SvOptions {
  minClip: number;
  minSize: number;
  minSupport: number;
  tolerance: number;
}

export interface SvReadResult {
  calls: SvCall[];
  placed: number;
  unplaced: number;
}

const K = 15;
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const rc = (s: string) => [...s].reverse().map((c) => COMP[c] ?? 'N').join('');

/** Unique k-mers of the reference → position (repeats are dropped). */
function uniqueIndex(ref: string): Map<string, number> {
  const pos = new Map<string, number>();
  const dup = new Set<string>();
  for (let i = 0; i + K <= ref.length; i++) {
    const k = ref.slice(i, i + K);
    if (dup.has(k)) continue;
    if (pos.has(k)) { pos.delete(k); dup.add(k); } else pos.set(k, i);
  }
  return pos;
}

interface Segment {
  /** read k-mer start positions covered (first, last) */
  j0: number;
  j1: number;
  /** +1: ref = read + d; −1: ref = d − read (reverse-complement match) */
  strand: 1 | -1;
  d: number;
}

function segmentsOf(read: string, idx: Map<string, number>): Segment[] {
  const hits: { j: number; strand: 1 | -1; d: number }[] = [];
  for (let j = 0; j + K <= read.length; j++) {
    const k = read.slice(j, j + K);
    const f = idx.get(k);
    if (f !== undefined) { hits.push({ j, strand: 1, d: f - j }); continue; }
    const r = idx.get(rc(k));
    if (r !== undefined) hits.push({ j, strand: -1, d: r + j });
  }
  const segs: Segment[] = [];
  for (const h of hits) {
    const last = segs[segs.length - 1];
    if (last && last.strand === h.strand && Math.abs(last.d - h.d) <= 3) { last.j1 = h.j; continue; }
    segs.push({ j0: h.j, j1: h.j, strand: h.strand, d: h.d });
  }
  // drop tiny segments (chance matches): need at least 3 consecutive k-mers
  return segs.filter((s) => s.j1 - s.j0 >= 2);
}

interface Raw { type: SvType; start: number; end: number; size: number; read: string }

export function findStructuralVariants(reference: string, reads: { name: string; sequence: string }[], o: SvOptions, circular = false): SvReadResult {
  const ref = reference.toUpperCase().replace(/U/g, 'T');
  const idx = uniqueIndex(ref);
  const raw: Raw[] = [];
  let placed = 0;
  for (const rd of reads) {
    let seq = rd.sequence.toUpperCase().replace(/U/g, 'T');
    let segs = segmentsOf(seq, idx);
    // orient so the longest segment is on the forward strand
    const main = [...segs].sort((a, b) => (b.j1 - b.j0) - (a.j1 - a.j0))[0];
    if (!main) continue;
    placed++;
    if (main.strand === -1) { seq = rc(seq); segs = segmentsOf(seq, idx); }
    // read-end clips that match nothing → insertion of new sequence
    const first = segs[0];
    const last = segs[segs.length - 1];
    if (first && first.strand === 1 && first.j0 >= o.minClip && segs.length === 1) {
      const at = first.j0 + first.d; // ref position of the first matched base (0-based)
      raw.push({ type: 'Insertion', start: at, end: at, size: first.j0, read: rd.name });
    }
    if (last && last.strand === 1 && seq.length - (last.j1 + K) >= o.minClip && segs.length === 1) {
      const at = last.j1 + K - 1 + last.d + 1; // 1-based last matched ref base
      raw.push({ type: 'Insertion', start: at, end: at, size: seq.length - (last.j1 + K), read: rd.name });
    }
    for (let s = 0; s + 1 < segs.length; s++) {
      const a = segs[s];
      const b = segs[s + 1];
      const aEndRead = a.j1 + K - 1; // last read base of segment a
      if (a.strand === 1 && b.strand === 1) {
        let shift = b.d - a.d; // > 0: reference skipped; < 0: reference repeated / read has extra bases
        // circular reference: a read across the origin jumps by about one genome length
        const n = ref.length;
        if (circular && Math.abs(shift) > n / 2) shift -= Math.sign(shift) * n;
        const readGap = Math.max(0, b.j0 - aEndRead - 1);
        const aEndRef = ((aEndRead + a.d) % n) + 1; // 1-based
        if (shift >= o.minSize && readGap < o.minSize) {
          raw.push({ type: 'Deletion', start: aEndRef + 1, end: aEndRef + shift, size: shift, read: rd.name });
        } else if (-shift >= o.minSize && readGap >= o.minSize && Math.abs(-shift - readGap) <= Math.max(10, readGap * 0.2)) {
          raw.push({ type: 'Insertion', start: aEndRef, end: aEndRef, size: -shift, read: rd.name });
        } else if (-shift >= o.minSize) {
          raw.push({ type: 'Tandem duplication', start: aEndRef + shift + 1, end: aEndRef, size: -shift, read: rd.name });
        }
      } else if (a.strand !== b.strand) {
        // breakpoint between a forward and a reverse-complement match
        const aEndRef = a.strand === 1 ? aEndRead + a.d + 1 : a.d - aEndRead + 1;
        const bRef = b.strand === 1 ? b.j0 + b.d + 1 : b.d - b.j0 + 1;
        const lo = Math.min(aEndRef, bRef);
        const hi = Math.max(aEndRef, bRef);
        if (hi - lo + 1 >= o.minSize) raw.push({ type: 'Inversion', start: lo, end: hi, size: hi - lo + 1, read: rd.name });
      }
    }
  }
  const calls: SvCall[] = [];
  for (const c of raw.sort((x, y) => x.start - y.start)) {
    const hit = calls.find((x) => x.type === c.type && (
      c.type === 'Inversion'
        ? Math.abs(x.start - c.start) <= o.tolerance || Math.abs(x.end - c.end) <= o.tolerance
        : Math.abs(x.start - c.start) <= o.tolerance && (c.type === 'Insertion' || Math.abs(x.end - c.end) <= o.tolerance)));
    if (hit) {
      if (!hit.reads.includes(c.read)) { hit.reads.push(c.read); hit.support++; }
      if (c.type === 'Insertion') hit.size = Math.max(hit.size, c.size);
      if (c.type === 'Inversion') { hit.start = Math.min(hit.start, c.start); hit.end = Math.max(hit.end, c.end); hit.size = hit.end - hit.start + 1; }
    } else calls.push({ ...c, support: 1, reads: [c.read] });
  }
  return { calls: calls.filter((c) => c.support >= o.minSupport).sort((a, b) => a.start - b.start), placed, unplaced: reads.length - placed };
}
