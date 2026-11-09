// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Map to Reference: aligns every read to the reference independently (the engine's
 * seeded local Gotoh alignment, reverse reads in reference orientation) and merges the
 * pairwise alignments into one contig. Insertions in any read become shared columns,
 * so every row has the same length and the reference keeps all of its bases.
 */

import { mapReadAndCallVariants, reverseComplement } from './bioEngine';
import type { SequenceDocument, VariantCall } from '../types/bio';

export interface MappedRead {
  doc: SequenceDocument;
  /** 1-based first reference base covered by the read's aligned part. */
  refStart: number;
  refEnd: number;
  strand: 1 | -1;
  identityPct: number;
  alignedLength: number;
  /** Pairs from the local alignment: reference char ('-' = insertion) and read char ('-' = deletion). */
  pairs: [string, string][];
  variants: VariantCall[];
}

export interface ContigVariant {
  /** 1-based reference coordinate. */
  refPosition: number;
  /** 1-based contig column (in the gapped contig). */
  column: number;
  type: 'SNP' | 'Insertion' | 'Deletion';
  refBase: string;
  altBase: string;
  /** Reads showing this change / reads covering the position (for an insertion, the base before it). */
  supporting: number;
  coverage: number;
  frequencyPct: number;
  meanQuality: number | null;
}

export interface ReferenceContig {
  /** Gapped rows: reference first, then mapped reads (terminal positions are '-'). */
  rows: { id: string; name: string; sequence: string; strand: 1 | -1 }[];
  consensus: string;
  columns: number;
  mapped: MappedRead[];
  unmapped: { doc: SequenceDocument; reason: string }[];
  variants: ContigVariant[];
  meanCoverage: number;
  /** % of reference bases covered by at least one read. */
  breadthPct: number;
}

export interface MapToReferenceOptions {
  minIdentityPct: number;
  minAlignedLength: number;
  minVariantFrequencyPct: number;
  minVariantCoverage: number;
  /** Mean Phred quality a variant needs when the reads carry qualities (traces). */
  minVariantQuality?: number;
  /**
   * Reads that must show a variant. Default: 2 when 20 or more reads are mapped (a single read's
   * sequencing error is not a variant in NGS data), 1 for a handful of Sanger reads.
   */
  minSupportingReads?: number;
}

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

export function mapReadsToReference(
  reference: SequenceDocument,
  reads: SequenceDocument[],
  opts: MapToReferenceOptions
): ReferenceContig {
  const ref = clean(reference.sequence);
  const L = ref.length;
  const mapped: MappedRead[] = [];
  const unmapped: { doc: SequenceDocument; reason: string }[] = [];

  for (const read of reads) {
    const raw = clean(read.chromatogram?.baseCalls || read.sequence);
    if (raw.length < 20) {
      unmapped.push({ doc: read, reason: 'shorter than 20 bases' });
      continue;
    }
    const res = mapReadAndCallVariants(reference, read);
    const a1 = res.alignment.alignedSeq1;
    const a2 = res.alignment.alignedSeq2;
    const alignedLength = a2.replace(/-/g, '').length;
    if (!a1 || alignedLength < opts.minAlignedLength) {
      unmapped.push({ doc: read, reason: `aligned length ${alignedLength} < ${opts.minAlignedLength}` });
      continue;
    }
    if (res.alignment.identityPct < opts.minIdentityPct) {
      unmapped.push({ doc: read, reason: `identity ${res.alignment.identityPct.toFixed(1)}% < ${opts.minIdentityPct}%` });
      continue;
    }
    const pairs: [string, string][] = [];
    for (let k = 0; k < Math.min(a1.length, a2.length); k++) pairs.push([a1[k], a2[k]]);
    const refBases = a1.replace(/-/g, '').length;
    // the engine reports the orientation it aligned (k-mer vote over both strands)
    const reverse = (res as { reverse?: boolean }).reverse ?? (!ref.includes(raw.slice(0, 18)) && ref.includes(reverseComplement(raw).slice(0, 18)));
    mapped.push({
      doc: read,
      refStart: res.refStartPos,
      refEnd: res.refStartPos + refBases - 1,
      strand: reverse ? -1 : 1,
      identityPct: res.alignment.identityPct,
      alignedLength,
      pairs,
      variants: res.variants,
    });
  }

  return assembleReferenceContig(reference, mapped, unmapped, opts);
}

/**
 * Builds the contig (gapped rows, consensus, coverage, variant calls) from reads already placed
 * on the reference — by Map to Reference, or by the POS / CIGAR of an imported SAM file.
 */
export function assembleReferenceContig(
  reference: SequenceDocument,
  mapped: MappedRead[],
  unmapped: { doc: SequenceDocument; reason: string }[],
  opts: MapToReferenceOptions
): ReferenceContig {
  const ref = clean(reference.sequence);
  const L = ref.length;
  // Longest insertion after each reference base (index 0 = before base 1).
  const insertMax = new Array<number>(L + 1).fill(0);
  for (const m of mapped) {
    let p = m.refStart - 1;
    let run = 0;
    for (const [r] of m.pairs) {
      if (r === '-') {
        run += 1;
        insertMax[p] = Math.max(insertMax[p], run);
      } else {
        run = 0;
        p += 1;
      }
    }
  }
  // Column index (0-based) of each reference base, and of the first insertion slot after it.
  const colOfRef = new Array<number>(L + 1).fill(0);
  let col = insertMax[0];
  for (let p = 1; p <= L; p++) {
    colOfRef[p] = col;
    col += 1 + insertMax[p];
  }
  const columns = col;

  const blank = () => new Array<string>(columns).fill('-');
  const refRow = blank();
  for (let p = 1; p <= L; p++) refRow[colOfRef[p]] = ref[p - 1];

  const readRows = mapped.map((m) => {
    const row = blank();
    let p = m.refStart - 1;
    let ins = 0;
    for (const [r, q] of m.pairs) {
      if (r === '-') {
        // Insertion after reference base p fills that base's insertion slots left to right.
        row[(p === 0 ? 0 : colOfRef[p] + 1) + ins] = q;
        ins += 1;
      } else {
        p += 1;
        ins = 0;
        row[colOfRef[p]] = q;
      }
    }
    return row;
  });

  // Consensus: majority of covering reads; reference base where no read covers.
  // A read covers the columns from its first to its last aligned reference base.
  const covered = (c: number, m: MappedRead) => c >= colOfRef[m.refStart] && c <= colOfRef[m.refEnd];
  const consensusChars: string[] = [];
  let coveredRefBases = 0;
  let depthSum = 0;
  for (let c = 0; c < columns; c++) {
    const counts = new Map<string, number>();
    let depth = 0;
    readRows.forEach((row, i) => {
      if (!covered(c, mapped[i])) return;
      depth += 1;
      counts.set(row[c], (counts.get(row[c]) ?? 0) + 1);
    });
    if (refRow[c] !== '-') {
      depthSum += depth;
      if (depth > 0) coveredRefBases += 1;
    }
    if (depth === 0) {
      consensusChars.push(refRow[c]);
    } else {
      const best = Array.from(counts).sort((a, b) => b[1] - a[1] || (a[0] === refRow[c] ? -1 : 1))[0][0];
      consensusChars.push(best);
    }
  }

  // Variants: the alleles each read carries, grouped by position/type/alt; frequency over covering reads.
  // The calls give each inserted base its own Insertion at the reference base it precedes, so the
  // bases one read inserts before one base are joined, in read order, into one allele. An
  // insertion is counted at its anchor, the reference base before it (VCF POS), as a pileup counts
  // it: over the reads covering that base, from the carriers among them.
  const coverageAtRef = (pos: number) => mapped.filter((m) => pos >= m.refStart && pos <= m.refEnd).length;
  const groups = new Map<string, { v: VariantCall; n: number; q: number[] }>();
  for (const m of mapped) {
    const alleles: { v: VariantCall; q: number[] }[] = [];
    const insertionAt = new Map<number, { v: VariantCall; q: number[] }>();
    for (const v of m.variants) {
      const q = v.phredQuality > 0 ? [v.phredQuality] : [];
      const run = v.type === 'Insertion' ? insertionAt.get(v.position) : undefined;
      if (run) {
        run.v.altBase += v.altBase;
        run.q.push(...q);
        continue;
      }
      const allele = { v: v.type === 'Insertion' ? { ...v } : v, q };
      if (v.type === 'Insertion') insertionAt.set(v.position, allele);
      alleles.push(allele);
    }
    for (const { v, q } of alleles) {
      // An insertion leading the read's alignment has no anchor base in it.
      if (v.type === 'Insertion' && v.position - 1 < m.refStart) continue;
      const key = `${v.position}|${v.type}|${v.altBase}`;
      const g = groups.get(key) ?? { v, n: 0, q: [] };
      g.n += 1;
      g.q.push(...q);
      groups.set(key, g);
    }
  }
  const variants: ContigVariant[] = [];
  const minSupport = opts.minSupportingReads ?? (mapped.length >= 20 ? 2 : 1);
  for (const { v, n, q } of groups.values()) {
    const cov = Math.max(n, coverageAtRef(v.type === 'Insertion' ? v.position - 1 : v.position));
    const freq = (100 * n) / cov;
    if (n < minSupport || cov < opts.minVariantCoverage || freq < opts.minVariantFrequencyPct) continue;
    const meanQ = q.length ? q.reduce((a, b) => a + b, 0) / q.length : null;
    if (meanQ !== null && opts.minVariantQuality && meanQ < opts.minVariantQuality) continue;
    const p = Math.min(Math.max(v.position, 1), L);
    variants.push({
      refPosition: v.position,
      column: (v.type === 'Insertion' ? colOfRef[Math.max(p - 1, 1)] + 1 : colOfRef[p]) + 1,
      type: v.type,
      refBase: v.refBase,
      altBase: v.altBase,
      supporting: n,
      coverage: cov,
      frequencyPct: Math.round(freq * 10) / 10,
      meanQuality: meanQ === null ? null : Math.round(meanQ),
    });
  }
  variants.sort((a, b) => a.refPosition - b.refPosition || a.type.localeCompare(b.type));

  return {
    rows: [
      { id: reference.id, name: `${reference.name} (reference)`, sequence: refRow.join(''), strand: 1 },
      ...mapped.map((m, i) => ({ id: m.doc.id, name: m.doc.name, sequence: readRows[i].join(''), strand: m.strand })),
    ],
    consensus: consensusChars.join(''),
    columns,
    mapped,
    unmapped,
    variants,
    meanCoverage: L ? Math.round((depthSum / L) * 100) / 100 : 0,
    breadthPct: L ? Math.round((1000 * coveredRefBases) / L) / 10 : 0,
  };
}
