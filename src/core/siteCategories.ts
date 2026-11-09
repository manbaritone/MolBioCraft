// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Site categories for Highlight Sites. Gaps and missing
 * data are ignored when classifying a site.
 *  - Conserved: one residue type at the site (at least two sequences have a residue).
 *  - Variable: two or more residue types.
 *  - Singleton: variable, with at most one type occurring more than once.
 *  - Parsimony-informative: at least two types each occurring at least twice.
 *  - 0/2/4-fold degenerate (coding nucleotide data, codons from the first column): a
 *    position is n-fold when, in every sequence, n of the four bases at that position
 *    give the same amino acid (0-fold = 1 base, 2-fold = 2–3 bases, 4-fold = 4 bases).
 */

import { translateCodon } from './alignmentViewModel';

export type SiteCategory = 'conserved' | 'variable' | 'singleton' | 'parsimony' | 'zero-fold' | 'two-fold' | 'four-fold';

export const SITE_CATEGORY_LABELS: Record<SiteCategory, string> = {
  conserved: 'Conserved',
  variable: 'Variable',
  singleton: 'Singleton',
  parsimony: 'Parsimony-informative',
  'zero-fold': '0-fold degenerate',
  'two-fold': '2-fold degenerate',
  'four-fold': '4-fold degenerate',
};

const residue = (c: string | undefined) => !!c && !/[-?.NnXx]/.test(c);

function foldClass(codon: string, pos: number, code: string): 0 | 2 | 4 | null {
  if (codon.length !== 3 || /[^ACGT]/.test(codon)) return null;
  const aa = translateCodon(codon, code);
  if (aa === '*' || aa === 'X') return null;
  let same = 0;
  for (const b of 'ACGT') {
    const alt = codon.slice(0, pos) + b + codon.slice(pos + 1);
    if (translateCodon(alt, code) === aa) same++;
  }
  return same === 1 ? 0 : same === 4 ? 4 : 2;
}

export function classifySites(rows: string[], category: SiteCategory, geneticCode = 'Standard'): number[] {
  const W = Math.max(0, ...rows.map((r) => r.length));
  const out: number[] = [];
  const up = rows.map((r) => r.toUpperCase().replace(/U/g, 'T'));
  for (let c = 0; c < W; c++) {
    if (category === 'zero-fold' || category === 'two-fold' || category === 'four-fold') {
      const want = category === 'zero-fold' ? 0 : category === 'two-fold' ? 2 : 4;
      const start = c - (c % 3);
      const classes = up.map((r) => foldClass(r.slice(start, start + 3), c % 3, geneticCode));
      if (classes.length && classes.every((k) => k === want)) out.push(c);
      continue;
    }
    const counts = new Map<string, number>();
    for (const r of up) if (residue(r[c])) counts.set(r[c], (counts.get(r[c]) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total < 2) continue;
    const types = counts.size;
    const multi = [...counts.values()].filter((n) => n >= 2).length;
    if (category === 'conserved' && types === 1) out.push(c);
    else if (category === 'variable' && types >= 2) out.push(c);
    else if (category === 'singleton' && types >= 2 && multi <= 1) out.push(c);
    else if (category === 'parsimony' && multi >= 2) out.push(c);
  }
  return out;
}
