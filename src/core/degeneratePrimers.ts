// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Degenerate primer design on an alignment (primers with degenerate bases). Each column
 * contributes the bases present in at least `inclusionPct` % of
 * the sequences, written as an IUPAC code. Candidate primers are windows of non-gappy columns
 * whose degeneracy (number of distinct primer sequences) is at most `maxDegeneracy` and whose
 * last `exact3Prime` bases are not degenerate; Tm is given as the range between the lowest-GC
 * and highest-GC versions. Pairs are ranked by a penalty on Tm, degeneracy, 3′ clamp and Tm
 * difference.
 */

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', AG: 'R', CT: 'Y', CG: 'S', AT: 'W', GT: 'K', AC: 'M',
  CGT: 'B', AGT: 'D', ACT: 'H', ACG: 'V', ACGT: 'N',
};
const EXPAND: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };

export const iupacOf = (bases: string) => IUPAC[[...new Set(bases)].sort().join('')] ?? 'N';

export function reverseComplementIupac(seq: string): string {
  return [...seq].reverse().map((c) => iupacOf([...(EXPAND[c] ?? 'ACGT')].map((b) => COMP[b]).join(''))).join('');
}

export const degeneracyOf = (seq: string) => [...seq].reduce((p, c) => p * (EXPAND[c] ?? 'ACGT').length, 1);

export interface DegenerateOptions {
  minLen: number;
  maxLen: number;
  tmMin: number;
  tmMax: number;
  maxDegeneracy: number;
  /** Bases below this % of the sequences in a column are ignored. */
  inclusionPct: number;
  /** Number of 3′-end bases that must not be degenerate. */
  exact3Prime: number;
  productMin: number;
  productMax: number;
  /** 1-based alignment columns to amplify (0 = whole alignment). */
  regionStart: number;
  regionEnd: number;
  pairs: number;
}

export const DEGENERATE_DEFAULTS: DegenerateOptions = {
  minLen: 18, maxLen: 24, tmMin: 52, tmMax: 64, maxDegeneracy: 64, inclusionPct: 5, exact3Prime: 3,
  productMin: 150, productMax: 800, regionStart: 0, regionEnd: 0, pairs: 5,
};

export interface DegeneratePrimer {
  sequence: string;
  /** 1-based alignment columns covered. */
  start: number;
  end: number;
  strand: 1 | -1;
  degeneracy: number;
  tmLow: number;
  tmHigh: number;
  gcLow: number;
  gcHigh: number;
  clamp: boolean;
  penalty: number;
}

export interface DegeneratePair {
  forward: DegeneratePrimer;
  reverse: DegeneratePrimer;
  productLength: number;
  penalty: number;
}

export interface DegenerateResult {
  pairs: DegeneratePair[];
  consensus: string;
  candidatesForward: number;
  candidatesReverse: number;
  notes: string[];
}

/** Lowest-GC and highest-GC version of a degenerate primer. */
function extremes(seq: string): [string, string] {
  const lo = [...seq].map((c) => { const e = EXPAND[c] ?? 'ACGT'; return e.includes('A') ? 'A' : e.includes('T') ? 'T' : e[0]; }).join('');
  const hi = [...seq].map((c) => { const e = EXPAND[c] ?? 'ACGT'; return e.includes('G') ? 'G' : e.includes('C') ? 'C' : e[0]; }).join('');
  return [lo, hi];
}

const gcPct = (s: string) => (100 * [...s].filter((c) => c === 'G' || c === 'C').length) / Math.max(1, s.length);

export function designDegeneratePrimers(rows: string[], o: DegenerateOptions, tmOf: (seq: string) => number): DegenerateResult {
  const notes: string[] = [];
  const n = rows.length;
  const L = Math.max(0, ...rows.map((r) => r.length));
  if (n < 2) throw new Error('Degenerate primer design needs an alignment of at least two sequences.');
  // per-column IUPAC code; null = gappy column (more than half the sequences have a gap)
  const cols: (string | null)[] = [];
  for (let c = 0; c < L; c++) {
    const counts: Record<string, number> = {};
    let gaps = 0;
    for (const r of rows) {
      const ch = (r[c] ?? '-').toUpperCase().replace('U', 'T');
      if (ch === '-' || ch === '.' || ch === '?') { gaps++; continue; }
      for (const b of EXPAND[ch] ?? 'ACGT') counts[b] = (counts[b] ?? 0) + 1 / (EXPAND[ch] ?? 'ACGT').length;
    }
    if (gaps * 2 > n) { cols.push(null); continue; }
    const present = Object.entries(counts).filter(([, k]) => (100 * k) / (n - gaps) >= o.inclusionPct).map(([b]) => b).join('');
    cols.push(present ? iupacOf(present) : 'N');
  }
  const consensus = cols.map((c) => c ?? '-').join('');
  const lo = o.regionStart > 0 ? o.regionStart - 1 : 0;
  const hi = o.regionEnd > 0 ? Math.min(L, o.regionEnd) : L;
  const tmCache = new Map<string, number>();
  const tm = (s: string) => { let v = tmCache.get(s); if (v === undefined) { v = tmOf(s); tmCache.set(s, v); } return v; };

  const candidates = (strand: 1 | -1): DegeneratePrimer[] => {
    const out: DegeneratePrimer[] = [];
    for (let s = lo; s < hi; s++) {
      for (let len = o.minLen; len <= o.maxLen && s + len <= hi; len++) {
        const window = cols.slice(s, s + len);
        if (window.some((c) => c === null)) break;
        const fwd = window.join('');
        const seq = strand === 1 ? fwd : reverseComplementIupac(fwd);
        const deg = degeneracyOf(seq);
        if (deg > o.maxDegeneracy) continue;
        if (degeneracyOf(seq.slice(-o.exact3Prime)) > 1) continue;
        const [a, b] = extremes(seq);
        const t1 = tm(a);
        const t2 = tm(b);
        const tLow = Math.min(t1, t2);
        const tHigh = Math.max(t1, t2);
        const last = seq[seq.length - 1];
        const clamp = last === 'G' || last === 'C';
        const outside = Math.max(0, o.tmMin - tLow) + Math.max(0, tHigh - o.tmMax);
        const gcL = gcPct(a);
        const gcH = gcPct(b);
        const gcPenalty = Math.max(0, 30 - gcL) / 10 + Math.max(0, gcH - 70) / 10;
        const penalty = 2 * outside + Math.log2(deg) + (clamp ? 0 : 1.5) + 0.15 * (tHigh - tLow) + gcPenalty;
        out.push({ sequence: seq, start: s + 1, end: s + len, strand, degeneracy: deg, tmLow: tLow, tmHigh: tHigh, gcLow: Math.min(gcL, gcH), gcHigh: Math.max(gcL, gcH), clamp, penalty });
      }
    }
    return out.sort((x, y) => x.penalty - y.penalty);
  };
  const fwd = candidates(1);
  const rev = candidates(-1);
  if (!fwd.length || !rev.length) {
    notes.push('No primers meet the length / degeneracy / 3′ constraints: allow more degeneracy, a lower inclusion threshold, or fewer exact 3′ bases.');
  }
  const topF = fwd.slice(0, 300);
  const topR = rev.slice(0, 300);
  const all: DegeneratePair[] = [];
  for (const f of topF) {
    for (const r of topR) {
      const product = r.end - f.start + 1;
      if (product < o.productMin || product > o.productMax || r.start <= f.end) continue;
      const mid = (x: DegeneratePrimer) => (x.tmLow + x.tmHigh) / 2;
      all.push({ forward: f, reverse: r, productLength: product, penalty: f.penalty + r.penalty + 0.5 * Math.abs(mid(f) - mid(r)) });
    }
  }
  all.sort((a, b) => a.penalty - b.penalty);
  // distinct pairs: each new pair must move at least one primer by 5+ columns from every pair
  // already chosen (otherwise the list fills with the same primers shifted by a base)
  const pairs: DegeneratePair[] = [];
  for (const p of all) {
    const near = pairs.some((q) => Math.abs(q.forward.start - p.forward.start) < 5 && Math.abs(q.reverse.end - p.reverse.end) < 5);
    if (near) continue;
    pairs.push(p);
    if (pairs.length >= o.pairs) break;
  }
  if (fwd.length && rev.length && !pairs.length) notes.push('Primers were found but no pair gives a product in the requested size range.');
  return { pairs, consensus, candidatesForward: fwd.length, candidatesReverse: rev.length, notes };
}
