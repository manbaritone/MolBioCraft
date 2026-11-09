// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * CRISPR editing analysis from Sanger traces (method of
 * TIDE, Brinkman et al. 2014). A control (unedited) and an edited trace of the same amplicon:
 *
 *  1. The cut site is 3 bp upstream of the PAM of the guide (found on either strand of the
 *     control) or given directly.
 *  2. The edited read is aligned to the control upstream of the cut (base calls).
 *  3. At every peak the four channels are turned into base proportions. Downstream of the
 *     cut, the edited proportions are modelled as a non-negative mixture of the control
 *     shifted by each indel size (−maxIndel … +maxIndel; deletions read the control further
 *     along; insertions add unknown bases — ¼ per channel — then read it earlier), solved by
 *     non-negative least squares over all positions and channels. Weights are the estimated frequencies; R² says how well they explain it.
 *  4. "Aberrant signal" = share of the edited signal not on the control's base, before and
 *     after the cut.
 *  5. With a donor template (HDR), its homology arms are found in the control and the
 *     knock-in allele (the control with the donor's region in place) is one more component of
 *     the mixture; its share is the HDR percentage (Synthego ICE reports HDR the same way, and
 *     its HDR / editing percentages are the reference in `outsideDataCrispr.test.ts`).
 */

import type { ChromatogramData } from '../types/bio';

const BASES = 'ACGT';
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const rc = (s: string) => [...s].reverse().map((c) => COMP[c] ?? 'N').join('');

/** Base proportions [A, C, G, T] at every called peak. */
export function peakProportions(c: ChromatogramData): number[][] {
  return c.peakLocations.map((p) => {
    const v = [c.traceA[p] ?? 0, c.traceC[p] ?? 0, c.traceG[p] ?? 0, c.traceT[p] ?? 0].map((x) => Math.max(0, x));
    const s = v[0] + v[1] + v[2] + v[3];
    return s > 0 ? v.map((x) => x / s) : [0.25, 0.25, 0.25, 0.25];
  });
}

export interface GuideSite {
  /** 0-based index in the control of the first base after the cut. */
  cut: number;
  strand: 1 | -1;
  pam: string;
}

/** Finds a 17–24 nt guide (+ NGG PAM) in the control base calls on either strand. */
export function findGuide(control: string, guide: string): GuideSite | null {
  const g = guide.toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, '');
  const s = control.toUpperCase();
  if (g.length < 15) return null;
  const fwd = s.indexOf(g);
  if (fwd >= 0) return { cut: fwd + g.length - 3, strand: 1, pam: s.slice(fwd + g.length, fwd + g.length + 3) };
  const r = s.indexOf(rc(g));
  if (r >= 0) return { cut: r + 3, strand: -1, pam: rc(s.slice(Math.max(0, r - 3), r)) };
  return null;
}

/** Offset `off` with edited[j] ≈ control[j - off]... i.e. edited index = control index + off. */
export function alignOffset(control: string, edited: string, from: number, to: number): { offset: number; identity: number } {
  const ref = control.slice(from, to).toUpperCase();
  const e = edited.toUpperCase();
  let best = { offset: 0, identity: 0 };
  for (let off = -from; off <= e.length - ref.length - from; off++) {
    let same = 0;
    for (let k = 0; k < ref.length; k++) if (e[from + off + k] === ref[k]) same++;
    const id = same / ref.length;
    if (id > best.identity) best = { offset: off, identity: id };
  }
  return best;
}

/** Non-negative least squares (Lawson & Hanson 1974) for small column counts. */
export function nnls(A: number[][], b: number[], maxIter = 500): number[] {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const x = new Array<number>(n).fill(0);
  const P = new Set<number>();
  const grad = () => {
    const r = b.map((bi, i) => bi - A[i].reduce((s, a, j) => s + a * x[j], 0));
    return Array.from({ length: n }, (_, j) => A.reduce((s, row, i) => s + row[j] * r[i], 0));
  };
  const lsq = (cols: number[]): number[] => {
    // normal equations on the passive set
    const k = cols.length;
    const M = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, c) => A.reduce((s, row) => s + row[cols[a]] * row[cols[c]], 0)));
    const v = cols.map((c) => A.reduce((s, row, i) => s + row[c] * b[i], 0));
    for (let i = 0; i < k; i++) M[i][i] += 1e-12;
    // Gaussian elimination
    for (let i = 0; i < k; i++) {
      let p = i;
      for (let r = i + 1; r < k; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]];
      [v[i], v[p]] = [v[p], v[i]];
      for (let r = i + 1; r < k; r++) {
        const f = M[r][i] / M[i][i];
        for (let c = i; c < k; c++) M[r][c] -= f * M[i][c];
        v[r] -= f * v[i];
      }
    }
    const z = new Array<number>(k).fill(0);
    for (let i = k - 1; i >= 0; i--) z[i] = (v[i] - M[i].slice(i + 1).reduce((s, a, c) => s + a * z[i + 1 + c], 0)) / M[i][i];
    return z;
  };
  for (let it = 0; it < maxIter; it++) {
    const w = grad();
    let jmax = -1;
    for (let j = 0; j < n; j++) if (!P.has(j) && w[j] > 1e-10 && (jmax < 0 || w[j] > w[jmax])) jmax = j;
    if (jmax < 0) break;
    P.add(jmax);
    for (let inner = 0; inner < 50; inner++) {
      const cols = [...P];
      const z = lsq(cols);
      if (z.every((v) => v > 0)) { cols.forEach((c, i) => { x[c] = z[i]; }); break; }
      let alpha = Infinity;
      cols.forEach((c, i) => { if (z[i] <= 0) alpha = Math.min(alpha, x[c] / (x[c] - z[i])); });
      cols.forEach((c, i) => { x[c] += alpha * (z[i] - x[c]); if (x[c] <= 1e-12) { x[c] = 0; P.delete(c); } });
    }
  }
  return x;
}

export interface EditingOptions {
  guide: string;
  /** 0-based cut index in the control (used when no guide is given; -1 = none). */
  cutIndex: number;
  maxIndel: number;
  /** Positions after the cut used for the decomposition. */
  window: number;
  /** Optional HDR donor template (either orientation). */
  donor?: string;
}

export interface EditingResult {
  cut: number;
  guideStrand: 1 | -1 | 0;
  pam: string;
  offset: number;
  alignmentIdentity: number;
  spectrum: { indel: number; pct: number }[];
  efficiencyPct: number;
  rSquared: number;
  positionsUsed: number;
  aberrantBeforePct: number;
  aberrantAfterPct: number;
  /** Share of the knock-in (donor) allele, when a donor was given. */
  hdrPct?: number;
  /**
   * Synthego ICE-compatible estimates: positive Lasso (α 0.8 on percent-scaled signals, as ICE)
   * with contributions scaled by the fit's Pearson R² — editing = R²·(1 − wild type), HDR =
   * R²·donor share. TIDE's NNLS numbers above are not R²-adjusted.
   */
  ice: { editingPct: number; hdrPct?: number; rSquared: number; spectrum: { indel: number; pct: number }[] };
  warnings: string[];
}

/**
 * Positive Lasso by coordinate descent, as scikit-learn `Lasso(alpha, positive=True)` with an
 * intercept: minimises (1/2n)‖b − Aw − c‖² + α‖w‖₁, w ≥ 0. Returns w (the intercept is dropped).
 */
export function positiveLasso(A: number[][], b: number[], alpha: number, maxIter = 2000, tol = 1e-6): number[] {
  const n = A.length;
  const p = A[0]?.length ?? 0;
  const colMean = Array.from({ length: p }, (_, j) => A.reduce((s, r) => s + r[j], 0) / n);
  const bMean = b.reduce((s, x) => s + x, 0) / n;
  const X = A.map((r) => r.map((v, j) => v - colMean[j]));
  const y = b.map((v) => v - bMean);
  const norm2 = Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[j] * r[j], 0));
  const w = new Array<number>(p).fill(0);
  const res = [...y];
  for (let it = 0; it < maxIter; it++) {
    let maxDelta = 0, maxW = 0;
    for (let j = 0; j < p; j++) {
      if (norm2[j] === 0) continue;
      let rho = 0;
      for (let i = 0; i < n; i++) rho += X[i][j] * res[i];
      rho += norm2[j] * w[j];
      const nw = Math.max(0, (rho - n * alpha) / norm2[j]);
      const d = nw - w[j];
      if (d !== 0) { for (let i = 0; i < n; i++) res[i] -= d * X[i][j]; w[j] = nw; }
      maxDelta = Math.max(maxDelta, Math.abs(d));
      maxW = Math.max(maxW, Math.abs(nw));
    }
    if (maxW === 0 || maxDelta / maxW < tol) break;
  }
  return w;
}

/** The donor's edit placed in the control: the control span [from, to) is replaced by `insert`. */
export interface DonorEdit { from: number; to: number; insert: string; armLeft: number; armRight: number; /** control index where the donor's 5′ end aligns */ donorStart: number }

/**
 * Locates a donor template in the control by its homology arms: the longest donor prefix found in
 * the control (≥ 12 nt) and the longest suffix found after it, on either donor orientation.
 */
export function placeDonor(control: string, donorRaw: string): DonorEdit | null {
  const ctl = control.toUpperCase();
  const tryOne = (donor: string): DonorEdit | null => {
    let left = -1, armL = 0;
    for (let L = Math.min(donor.length - 1, 80); L >= 12; L--) { const i = ctl.indexOf(donor.slice(0, L)); if (i >= 0) { left = i; armL = L; break; } }
    if (left < 0) return null;
    for (let R = Math.min(donor.length - armL, 80); R >= 12; R--) {
      const suf = donor.slice(donor.length - R);
      const j = ctl.indexOf(suf, left + armL);
      if (j >= 0) {
        const from = left + armL, to = j;
        const insert = donor.slice(armL, donor.length - R);
        return { from, to, insert, armLeft: armL, armRight: R, donorStart: left };
      }
    }
    return null;
  };
  const d = donorRaw.toUpperCase().replace(/U/g, 'T').replace(/[^ACGTN]/g, '');
  if (d.length < 30) return null;
  const a = tryOne(d);
  const b = tryOne(rc(d));
  const score = (x: DonorEdit | null) => (x ? x.armLeft + x.armRight : -1);
  const best = score(a) >= score(b) ? a : b;
  // trim bases the donor shares with the control at the ends of the replaced span
  if (best) {
    while (best.insert.length && best.from < best.to && best.insert[0] === ctl[best.from]) { best.insert = best.insert.slice(1); best.from++; }
    while (best.insert.length && best.to > best.from && best.insert[best.insert.length - 1] === ctl[best.to - 1]) { best.insert = best.insert.slice(0, -1); best.to--; }
  }
  return best && (best.insert.length || best.to > best.from) ? best : null;
}

/**
 * Synthego ICE's inference (Hsiau et al. 2018; synthego-open/ice 1.2): proposals are the wild
 * type, every deletion of 0–20 bases on each side of the cut, insertions of 1–20 unknown bases
 * and the HDR allele (proposals of the donor's net size above 3 bp are skipped); the window runs
 * from 30 bases before the cut to 100 after; per-position signals are normalised to 100; a
 * positive Lasso (α 0.8, intercept) gives abundances, scaled by the fit's Pearson R².
 */
function iceEstimate(Pc: number[][], Pe: number[][], cBases: string, cut: number, offset: number, donor: DonorEdit | null): EditingResult['ice'] {
  const MAX = 20;
  // the window starts 30 bases before the cut, or at the donor's 5′ end if that is earlier (ICE)
  const from = Math.max(0, Math.min(cut - MAX - 10, donor ? donor.donorStart : Infinity));
  const proposals: { size: number | 'HDR'; at: (i: number) => number[] | null }[] = [];
  const ctl = (i: number) => Pc[i] ?? null;
  proposals.push({ size: 0, at: ctl });
  const hdrSize = donor ? donor.insert.length - (donor.to - donor.from) : null;
  const skip = (size: number) => donor != null && Math.abs(size) > 3 && size === hdrSize;
  if (donor) {
    const L = donor.insert.length - (donor.to - donor.from);
    proposals.push({ size: 'HDR', at: (i) => {
      if (i < donor.from) return ctl(i);
      if (i < donor.from + donor.insert.length) { const base = donor.insert[i - donor.from]; return base === cBases[i] ? ctl(i) : BASES.split('').map((x) => (x === base ? 1 : 0)); }
      return ctl(i - L);
    } });
  }
  for (let bf = 0; bf <= MAX; bf++) for (let af = 0; af <= MAX; af++) {
    if (!bf && !af) continue;
    const size = -(bf + af);
    if (skip(size)) continue;
    proposals.push({ size, at: (i) => (i < cut - bf ? ctl(i) : ctl(i + bf + af)) });
  }
  for (let n = 1; n <= MAX; n++) {
    if (skip(n)) continue;
    proposals.push({ size: n, at: (i) => (i < cut ? ctl(i) : i < cut + n ? [0.25, 0.25, 0.25, 0.25] : ctl(i - n)) });
  }
  // right end: 100 after the cut, within both traces and every proposal
  let to = Math.min(cut + 100, Pc.length - 10, Pe.length - offset - 10);
  for (const p of proposals) while (to > from && p.at(to - 1) === null) to--;
  const cols: number[][] = [];
  const sizes: (number | 'HDR')[] = [];
  const seen = new Set<string>();
  for (const p of proposals) {
    const col: number[] = [];
    for (let i = from; i < to; i++) {
      const v = p.at(i) ?? [0.25, 0.25, 0.25, 0.25];
      const s = v[0] + v[1] + v[2] + v[3] || 1;
      for (let ch = 0; ch < 4; ch++) col.push((100 * v[ch]) / s);
    }
    const key = col.map((x) => x.toFixed(4)).join(',');
    if (seen.has(key)) continue; // degenerate proposals (same expected trace)
    seen.add(key);
    cols.push(col);
    sizes.push(p.size);
  }
  const b: number[] = [];
  for (let i = from; i < to; i++) {
    const e = Pe[i + offset] ?? [0.25, 0.25, 0.25, 0.25];
    const s = e[0] + e[1] + e[2] + e[3] || 1;
    for (let ch = 0; ch < 4; ch++) b.push((100 * e[ch]) / s);
  }
  const A = b.map((_, r) => cols.map((c) => c[r]));
  const w = positiveLasso(A, b, 0.8);
  const pred = A.map((row) => row.reduce((acc, a, j) => acc + a * w[j], 0));
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  const mp = pred.reduce((x, y) => x + y, 0) / pred.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < b.length; i++) { sxy += (pred[i] - mp) * (b[i] - mb); sxx += (pred[i] - mp) ** 2; syy += (b[i] - mb) ** 2; }
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const tot = w.reduce((x, y) => x + y, 0) || 1;
  const agg = new Map<number | 'HDR', number>();
  w.forEach((x, j) => agg.set(sizes[j], (agg.get(sizes[j]) ?? 0) + (100 * x * r2) / tot));
  const wt = agg.get(0) ?? 0;
  return {
    rSquared: r2,
    editingPct: 100 * r2 - wt,
    ...(donor ? { hdrPct: agg.get('HDR') ?? 0 } : {}),
    spectrum: [...agg.entries()].filter(([k, v]) => k !== 'HDR' && v >= 0.5).map(([k, v]) => ({ indel: k as number, pct: v })).sort((x, y) => x.indel - y.indel),
  };
}

export function analyzeEditing(control: ChromatogramData, edited: ChromatogramData, o: EditingOptions): EditingResult {
  const warnings: string[] = [];
  const cBases = control.baseCalls.toUpperCase();
  const eBases = edited.baseCalls.toUpperCase();
  let cut = o.cutIndex;
  let strand: 1 | -1 | 0 = 0;
  let pam = '';
  if (o.guide.trim()) {
    const g = findGuide(cBases, o.guide);
    if (!g) throw new Error('The guide sequence was not found in the control read (either strand).');
    cut = g.cut;
    strand = g.strand;
    pam = g.pam;
    if (!/^[ACGT]GG$/.test(pam)) warnings.push(`The guide is not followed by an NGG PAM in the control (found "${pam}"); the cut is still placed 3 bp upstream of where the PAM would be.`);
  }
  if (cut < 40 || cut > cBases.length - 40) throw new Error('The cut site must lie at least 40 bases from both ends of the control read.');
  const alignFrom = Math.max(15, cut - 120);
  const alignTo = cut - 10;
  const { offset, identity } = alignOffset(cBases, eBases, alignFrom, alignTo);
  if (identity < 0.8) warnings.push(`The edited read matches the control only ${(100 * identity).toFixed(0)}% upstream of the cut: check that both traces are of the same amplicon and strand.`);
  const Pc = peakProportions(control);
  const Pe = peakProportions(edited);
  const k = o.maxIndel;
  const indels = Array.from({ length: 2 * k + 1 }, (_, i) => i - k); // negative = deletion
  const donor = o.donor?.trim() ? placeDonor(cBases, o.donor) : null;
  if (o.donor?.trim() && !donor) warnings.push('The donor template’s homology arms (≥ 12 nt) were not found in the control read; HDR is not modelled.');
  // with a donor, the window also covers an edit next to the cut
  const start = donor ? Math.max(alignTo + 1, Math.min(cut + 5, donor.from - 2)) : cut + 5;
  const end = Math.min(cut + 5 + o.window, Pc.length - k - 5, Pe.length - offset - 5);
  if (end - start < 20) throw new Error('Too little trace after the cut site for the decomposition (need about 20 good bases).');
  const A: number[][] = [];
  const b: number[] = [];
  // the knock-in allele's expected proportions at control position i
  const hdrAt = (i: number, ch: number): number => {
    if (!donor) return 0;
    const L = donor.insert.length - (donor.to - donor.from);
    if (i < donor.from) return Pc[i]?.[ch] ?? 0.25;
    if (i < donor.from + donor.insert.length) {
      const base = donor.insert[i - donor.from];
      return base === cBases[i] ? (Pc[i]?.[ch] ?? 0.25) : BASES[ch] === base ? 1 : 0;
    }
    return Pc[i - L]?.[ch] ?? 0.25;
  };
  for (let i = start; i < end; i++) {
    const e = Pe[i + offset];
    for (let ch = 0; ch < 4; ch++) {
      // deletion of d bases: the edited read at i shows control base i + d; i < cut is unedited
      // insertion of d bases: the d inserted bases are unknown (¼ each, as ICE), then control i − d
      const row = indels.map((d) => (i < cut ? Pc[i]?.[ch] ?? 0.25 : d > 0 && i < cut + d ? 0.25 : Pc[i - d]?.[ch] ?? 0.25));
      if (donor) row.push(hdrAt(i, ch));
      A.push(row);
      b.push(e[ch]);
    }
  }
  const w = nnls(A, b);
  const fit = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
  const mean = b.reduce((s, x) => s + x, 0) / b.length;
  const ssTot = b.reduce((s, x) => s + (x - mean) ** 2, 0);
  const ssRes = b.reduce((s, x, i) => s + (x - fit[i]) ** 2, 0);
  const total = w.reduce((s, x) => s + x, 0) || 1;
  const spectrum = indels.map((d, j) => ({ indel: d, pct: (100 * w[j]) / total })).filter((x) => x.pct >= 0.05);
  const hdrPct = donor ? (100 * w[indels.length]) / total : undefined;
  const wt = spectrum.find((x) => x.indel === 0)?.pct ?? 0;
  const ice = iceEstimate(Pc, Pe, cBases, cut, offset, donor);
  // aberrant signal: edited signal not on the control's base
  const aberr = (from: number, to: number) => {
    let s = 0;
    let n = 0;
    for (let i = from; i < to; i++) {
      const base = BASES.indexOf(cBases[i]);
      const e = Pe[i + offset];
      if (base < 0 || !e) continue;
      s += 1 - e[base];
      n++;
    }
    return n ? (100 * s) / n : 0;
  };
  return {
    cut, guideStrand: strand, pam, offset, alignmentIdentity: identity * 100,
    spectrum, efficiencyPct: 100 - wt, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0, positionsUsed: end - start,
    aberrantBeforePct: aberr(alignFrom, alignTo), aberrantAfterPct: aberr(start, end), ...(hdrPct !== undefined ? { hdrPct } : {}), ice, warnings,
  };
}
