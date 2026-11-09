// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The "Data Subset to Use" analysis option: treatment of alignment
 * gaps and missing data, and choice of codon positions.
 *
 *  - Complete deletion: drop every column with a gap or missing base in any sequence.
 *  - Pairwise deletion: keep all columns; each pairwise comparison ignores its own gaps
 *    (this is what the distance engine does per pair).
 *  - Partial deletion: drop columns whose coverage (share of sequences with a residue)
 *    is below the site-coverage cutoff.
 * Codon positions count from the first column of the alignment.
 */

export type GapTreatment = 'pairwise' | 'complete' | 'partial';

export interface SiteSubsetOptions {
  gaps: GapTreatment;
  /** Partial deletion: minimum % of sequences with a residue at a site. */
  coveragePct: number;
  /** Codon positions to keep (nucleotide data); empty or all three = all sites. */
  codonPositions: number[];
}

const MISSING = /[-?.NnXx]/;

export function applySiteSubset(rows: string[], o: SiteSubsetOptions, isProtein: boolean): { rows: string[]; kept: number; total: number; note: string } {
  const total = Math.max(0, ...rows.map((r) => r.length));
  const n = rows.length;
  const positions = isProtein || !o.codonPositions.length || o.codonPositions.length === 3 ? null : new Set(o.codonPositions);
  const keep: number[] = [];
  for (let c = 0; c < total; c++) {
    if (positions && !positions.has((c % 3) + 1)) continue;
    const missing = rows.filter((r) => MISSING.test(r[c] ?? '-')).length;
    if (o.gaps === 'complete' && missing > 0) continue;
    if (o.gaps === 'partial' && n > 0 && (100 * (n - missing)) / n < o.coveragePct) continue;
    keep.push(c);
  }
  const out = rows.map((r) => keep.map((c) => r[c] ?? '-').join(''));
  const parts = [
    o.gaps === 'complete' ? 'complete deletion' : o.gaps === 'partial' ? `partial deletion (site coverage ≥ ${o.coveragePct}%)` : 'pairwise deletion',
    positions ? `codon positions ${[...positions].sort().join('+')}` : '',
  ].filter(Boolean);
  return { rows: out, kept: keep.length, total, note: `${parts.join(', ')}: ${keep.length.toLocaleString()} of ${total.toLocaleString()} sites used` };
}

export function siteSubsetOptionsOf(v: Record<string, string | number | boolean | undefined>): SiteSubsetOptions {
  const gaps = v.gaps === 'complete' || v.gaps === 'partial' ? v.gaps : 'pairwise';
  return {
    gaps,
    coveragePct: Number(v.coveragePct ?? 95),
    codonPositions: [v.pos1 !== false && 1, v.pos2 !== false && 2, v.pos3 !== false && 3].filter((x): x is number => typeof x === 'number'),
  };
}
