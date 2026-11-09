// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Calculate Expression Levels: reads mapped to an annotated reference are counted
 * per gene, and normalised as FPKM (fragments per kilobase per million mapped) and TPM
 * (transcripts per million). Each reference-mapping contig is one sample; together they give
 * a count table for Compare Expression Levels.
 *
 * A read counts for a gene when its aligned span overlaps the gene by at least `minOverlap`
 * bases. Reads overlapping several genes are split between them (default), counted to each,
 * or left out (HTSeq "union" style).
 */

import type { SequenceDocument, SequenceFeature } from '../types/bio';

export type AmbiguousMode = 'split' | 'each' | 'discard';

export interface GeneRegion {
  name: string;
  start: number;
  end: number;
  length: number;
}

export interface SampleLevels {
  sample: string;
  mappedReads: number;
  counts: number[];
  fpkm: number[];
  tpm: number[];
  /** Reads overlapping no gene. */
  unassigned: number;
  ambiguous: number;
}

/** Reference coordinate (1-based) of each contig column, or 0 for insertion columns. */
export function contigToReference(referenceRow: string): number[] {
  let pos = 0;
  return [...referenceRow].map((c) => (c === '-' ? 0 : ++pos));
}

/** Reference span [start, end] of every read row (rows after the reference). */
export function readSpans(contig: SequenceDocument): { name: string; start: number; end: number }[] {
  const rows = contig.alignmentMeta?.sequences ?? [];
  if (rows.length < 2) return [];
  const map = contigToReference(rows[0].sequence);
  return rows.slice(1).map((r) => {
    let first = -1;
    let last = -1;
    for (let c = 0; c < r.sequence.length; c++) {
      if (r.sequence[c] !== '-' && r.sequence[c] !== ' ') { if (first < 0) first = c; last = c; }
    }
    // nearest reference positions inside the span
    let s = 0;
    for (let c = first; c <= last && c >= 0 && !s; c++) s = map[c];
    let e = 0;
    for (let c = last; c >= first && c >= 0 && !e; c--) e = map[c];
    return { name: r.name, start: s, end: e };
  }).filter((x) => x.start > 0 && x.end >= x.start);
}

export function geneRegions(features: readonly SequenceFeature[], types: string[]): GeneRegion[] {
  const want = new Set(types.map((t) => t.toLowerCase()));
  const seen = new Map<string, number>();
  return features.filter((f) => want.has(f.type.toLowerCase())).map((f) => {
    const s = Math.min(f.start, f.end);
    const e = Math.max(f.start, f.end);
    const base = f.name || `${f.type}_${s}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return { name: k === 1 ? base : `${base}_${k}`, start: s, end: e, length: e - s + 1 };
  });
}

export function countReads(spans: { start: number; end: number }[], genes: GeneRegion[], minOverlap: number, mode: AmbiguousMode): { counts: number[]; unassigned: number; ambiguous: number } {
  const counts = genes.map(() => 0);
  let unassigned = 0;
  let ambiguous = 0;
  for (const sp of spans) {
    const hit: number[] = [];
    genes.forEach((g, i) => {
      const ov = Math.min(sp.end, g.end) - Math.max(sp.start, g.start) + 1;
      if (ov >= Math.min(minOverlap, sp.end - sp.start + 1)) hit.push(i);
    });
    if (!hit.length) { unassigned++; continue; }
    if (hit.length > 1) {
      ambiguous++;
      if (mode === 'discard') continue;
      for (const i of hit) counts[i] += mode === 'split' ? 1 / hit.length : 1;
    } else counts[hit[0]] += 1;
  }
  return { counts, unassigned, ambiguous };
}

export function normalise(counts: number[], genes: GeneRegion[], mappedReads: number): { fpkm: number[]; tpm: number[] } {
  const perKb = counts.map((c, i) => c / (genes[i].length / 1000));
  const fpkm = perKb.map((r) => (mappedReads > 0 ? r / (mappedReads / 1e6) : 0));
  const total = perKb.reduce((s, x) => s + x, 0);
  const tpm = perKb.map((r) => (total > 0 ? (r / total) * 1e6 : 0));
  return { fpkm, tpm };
}

export function sampleLevels(sample: string, contig: SequenceDocument, genes: GeneRegion[], minOverlap: number, mode: AmbiguousMode): SampleLevels {
  const spans = readSpans(contig);
  const { counts, unassigned, ambiguous } = countReads(spans, genes, minOverlap, mode);
  const { fpkm, tpm } = normalise(counts, genes, spans.length);
  return { sample, mappedReads: spans.length, counts, fpkm, tpm, unassigned, ambiguous };
}

/** Tab-separated count matrix (genes × samples), rounded to whole reads for count-based statistics. */
export function countTableTsv(genes: GeneRegion[], samples: SampleLevels[]): string {
  return [['gene', ...samples.map((s) => s.sample)].join('\t'), ...genes.map((g, i) => [g.name, ...samples.map((s) => Math.round(s.counts[i]))].join('\t'))].join('\n');
}
