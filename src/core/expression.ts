// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Differential expression from a count table (Compare Expression Levels; DESeq2-style
 * statistics; Love, Huber & Anders 2014):
 *
 *  - size factors by the median-of-ratios method;
 *  - gene-wise negative-binomial dispersions maximising the Cox–Reid adjusted profile
 *    likelihood, a parametric trend α(μ) = a0 + a1/μ (gamma-family fit, outliers excluded), and
 *    empirical-Bayes MAP dispersions with a log-normal prior around the trend (genes far above
 *    the trend keep their gene-wise value);
 *  - NB GLM (two groups) maximum-likelihood log2 fold changes, Wald test, Cook's-distance
 *    flagging of single-sample outliers, independent filtering on the mean of normalised counts
 *    (DESeq2's lowess rule) and Benjamini–Hochberg adjusted p-values;
 *  - PCA of log2(normalised + 1) over the most variable genes.
 *
 * Checked against PyDESeq2 on the pasilla data set (`src/__tests__/outsideDataExpression.test.ts`).
 * Fold-change shrinkage (lfcShrink) is not applied.
 */

export interface CountTable {
  genes: string[];
  samples: string[];
  /** counts[g][s] */
  counts: number[][];
}

export interface ParsedCounts extends CountTable {
  skipped: number;
  format: string;
}

/** CSV/TSV count matrix (gene column then samples), or featureCounts output. */
export function parseCountTable(text: string): ParsedCounts {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('The count table needs a header row and at least one gene.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  let first = 1;
  let format = 'count matrix';
  const lenCol = header.findIndex((h) => h.toLowerCase() === 'length');
  if (header[0].toLowerCase() === 'geneid' && lenCol > 0) { first = lenCol + 1; format = 'featureCounts'; }
  const samples = header.slice(first).map((s) => s.replace(/^.*\//, '').replace(/\.(bam|sam)$/i, ''));
  if (samples.length < 2) throw new Error('The count table needs at least two sample columns.');
  const genes: string[] = [];
  const counts: number[][] = [];
  let skipped = 0;
  for (const l of lines.slice(1)) {
    const cells = split(l);
    if (/^__/.test(cells[0])) { skipped++; continue; } // HTSeq summary rows
    const row = cells.slice(first).map(Number);
    if (row.length !== samples.length || row.some((x) => !Number.isFinite(x) || x < 0)) { skipped++; continue; }
    genes.push(cells[0]);
    counts.push(row.map((x) => Math.round(x)));
  }
  if (!genes.length) throw new Error('No gene rows with numeric counts were found.');
  return { genes, samples, counts, skipped, format };
}

export function sizeFactors(counts: number[][]): number[] {
  const m = counts[0]?.length ?? 0;
  const logGeo = counts.map((r) => (r.every((x) => x > 0) ? r.reduce((s, x) => s + Math.log(x), 0) / m : -Infinity));
  return Array.from({ length: m }, (_, j) => {
    const ratios = counts.map((r, g) => (Number.isFinite(logGeo[g]) ? Math.log(r[j]) - logGeo[g] : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ratios.length) return 1;
    const mid = ratios.length / 2;
    const med = ratios.length % 2 ? ratios[Math.floor(mid)] : (ratios[mid - 1] + ratios[mid]) / 2;
    return Math.exp(med);
  });
}

function trigamma(x: number): number {
  let v = 0;
  let z = x;
  while (z < 6) { v += 1 / (z * z); z += 1; }
  const z2 = 1 / (z * z);
  return v + 1 / z + z2 / 2 + (z2 / z) * (1 / 6 - z2 * (1 / 30 - z2 / 42));
}

/** Standard normal two-sided p-value. */
export function twoSidedP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  // complementary error function (Numerical Recipes erfc, |error| < 1.2e-7)
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return Math.min(1, erfc);
}

export function benjaminiHochberg(p: number[]): number[] {
  const idx = p.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)).sort((a, b) => b[0] - a[0]);
  const n = idx.length;
  const out = new Array<number>(p.length).fill(NaN);
  let prev = 1;
  idx.forEach(([v, i], r) => { const rank = n - r; prev = Math.min(prev, (v * n) / rank); out[i] = Math.min(1, prev); });
  return out;
}

export interface DeGene {
  gene: string;
  baseMean: number;
  log2FC: number;
  lfcSE: number;
  stat: number;
  pvalue: number;
  padj: number;
  dispersion: number;
}

export interface DeResult {
  conditionA: string;
  conditionB: string;
  samplesA: string[];
  samplesB: string[];
  sizeFactors: Record<string, number>;
  genes: DeGene[];
  pca: { sample: string; group: string; pc1: number; pc2: number }[];
  pcaVariance: [number, number];
  dispersionTrend: [number, number];
  significant: number;
  up: number;
  down: number;
  alpha: number;
  lfcThreshold: number;
  filteredOut: number;
}

export interface DeOptions {
  samplesA: string[];
  samplesB: string[];
  conditionA: string;
  conditionB: string;
  /** Genes with fewer total counts are left out. */
  minTotal: number;
  alpha: number;
  lfcThreshold: number;
  pcaGenes: number;
}

// ───────── numerical helpers (log-gamma, incomplete beta, F quantile, lowess) ─────────

function lgamma(x: number): number {
  // Lanczos (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * lgamma(k + r) − lgamma(r) without cancellation when r = 1/α is huge (tiny dispersions): a
 * Stirling-series difference with log1p for r ≥ 10, the direct difference otherwise.
 */
function lgammaDiff(k: number, r: number): number {
  if (k === 0) return 0;
  if (r < 10) return lgamma(k + r) - lgamma(r);
  const x = k + r;
  const corr = (z: number) => 1 / (12 * z) - 1 / (360 * z ** 3) + 1 / (1260 * z ** 5);
  return (r - 0.5) * Math.log1p(k / r) + k * Math.log(x) - k + corr(x) - corr(r);
}

/** Regularised incomplete beta I_x(a, b) (continued fraction, Numerical Recipes). */
function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const cf = (x: number, a: number, b: number) => {
    let c = 1, d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (Math.exp(lbt) * cf(x, a, b)) / a : 1 - (Math.exp(lbt) * cf(1 - x, b, a)) / b;
}

/** Quantile of the F(d1, d2) distribution (bisection on its CDF). */
function fQuantile(p: number, d1: number, d2: number): number {
  const cdf = (f: number) => betaInc((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
  let lo = 0, hi = 1;
  while (cdf(hi) < p) hi *= 2;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Robust lowess (Cleveland 1979; tricube weights, 3 robustness iterations), as R `lowess`. */
function lowess(x: number[], y: number[], frac: number, iters = 3): number[] {
  const n = x.length;
  const r = Math.max(2, Math.ceil(frac * n));
  const fit = new Array<number>(n).fill(0);
  let rw = new Array<number>(n).fill(1);
  for (let it = 0; it <= iters; it++) {
    for (let i = 0; i < n; i++) {
      const d = x.map((xx) => Math.abs(xx - x[i]));
      const h = [...d].sort((a, b) => a - b)[r - 1] || 1e-12;
      let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
      for (let j = 0; j < n; j++) {
        const u = d[j] / h;
        const w = (u < 1 ? (1 - u ** 3) ** 3 : 0) * rw[j];
        sw += w; swx += w * x[j]; swy += w * y[j]; swxx += w * x[j] * x[j]; swxy += w * x[j] * y[j];
      }
      const den = sw * swxx - swx * swx;
      fit[i] = Math.abs(den) > 1e-12 ? ((swxx * swy - swx * swxy) + (sw * swxy - swx * swy) * x[i]) / den : swy / (sw || 1);
    }
    const res = y.map((v, i) => Math.abs(v - fit[i]));
    const s = 6 * ([...res].sort((a, b) => a - b)[Math.floor(n / 2)] || 1e-12);
    rw = res.map((e) => { const u = e / s; return u < 1 ? (1 - u * u) ** 2 : 0; });
  }
  return fit;
}

/** Brent's maximisation of a 1-D function on [a, b]. */
function brentMax(f: (x: number) => number, a: number, b: number, tol = 1e-6): number {
  const g = 0.3819660112501051;
  let x = a + g * (b - a), w = x, v = x;
  let fx = f(x), fw = fx, fv = fx;
  let d = 0, e = 0;
  for (let it = 0; it < 100; it++) {
    const m = (a + b) / 2;
    const tol1 = tol * Math.abs(x) + 1e-10;
    if (Math.abs(x - m) <= 2 * tol1 - (b - a) / 2) break;
    let useGolden = true;
    if (Math.abs(e) > tol1) {
      let r = (x - w) * (fx - fv), q = (x - v) * (fx - fw), pp = (x - v) * q - (x - w) * r;
      q = 2 * (q - r); if (q > 0) pp = -pp; q = Math.abs(q);
      if (Math.abs(pp) < Math.abs(0.5 * q * e) && pp > q * (a - x) && pp < q * (b - x)) { e = d; d = pp / q; useGolden = false; }
    }
    if (useGolden) { e = x < m ? b - x : a - x; d = g * e; }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1);
    const fu = f(u);
    if (fu >= fx) { if (u < x) b = x; else a = x; v = w; fv = fw; w = x; fw = fx; x = u; fx = fu; }
    else { if (u < x) a = u; else b = u; if (fu >= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu >= fv || v === x || v === w) { v = u; fv = fu; } }
  }
  return x;
}

export function differentialExpression(t: CountTable, o: DeOptions): DeResult {
  const ia = o.samplesA.map((s) => t.samples.indexOf(s));
  const ib = o.samplesB.map((s) => t.samples.indexOf(s));
  if (ia.some((i) => i < 0) || ib.some((i) => i < 0)) throw new Error('A chosen sample is not in the count table.');
  if (ia.length < 2 || ib.length < 2) throw new Error('Each condition needs at least two replicate samples (dispersions cannot be estimated otherwise).');
  if (ia.some((i) => ib.includes(i))) throw new Error('A sample cannot be in both conditions.');
  const cols = [...ia, ...ib];
  const all = t.counts.map((r) => cols.map((j) => r[j]));
  const keep = all.map((r) => r.reduce((s, x) => s + x, 0) >= Math.max(1, o.minTotal));
  const genes = t.genes.filter((_, g) => keep[g]);
  const K = all.filter((_, g) => keep[g]);
  if (genes.length < 10) throw new Error('Too few genes pass the count filter.');
  const sf = sizeFactors(K);
  const nA = ia.length;
  const m = cols.length;
  const P = 2; // model coefficients: intercept + condition
  const inB = (j: number) => j >= nA;
  const norm = K.map((r) => r.map((x, j) => x / sf[j]));
  const means = norm.map((r) => r.reduce((s, x) => s + x, 0) / m);
  const minDisp = 1e-8;

  /** Cox–Reid adjusted NB log likelihood of log-dispersion la. */
  const crLogLik = (r: number[], la: number, mu: number[]) => {
    const a = Math.exp(la);
    const ia1 = 1 / a;
    let ll = 0, wA = 0, wB = 0;
    for (let j = 0; j < m; j++) {
      const k = r[j], u = Math.max(mu[j], 1e-12);
      const au = a * u;
      // (−lgamma(k + 1) is constant in α and left out)
      ll += lgammaDiff(k, ia1) + k * (Math.log(au) - Math.log1p(au)) - ia1 * Math.log1p(au);
      const w = u / (1 + a * u);
      if (inB(j)) wB += w; else wA += w;
    }
    return ll - 0.5 * Math.log(Math.max(wA * wB, 1e-300));
  };
  // gene-wise dispersions as DESeq2 (estimateDispersionsGeneEst / fitDisp): start at
  // min(rough, moments) clipped to [minDisp, maxDisp], μ fitted at that start, then a
  // backtracking (Armijo) line search on the Cox–Reid adjusted log likelihood in log α. Genes
  // whose moments estimate is ≤ 0 start at the lower bound, where the likelihood is flat, and
  // stay there (as in DESeq2).
  const maxDisp = Math.max(10, m);
  const minLogA = Math.log(minDisp / 10), maxLogA = Math.log(maxDisp);
  const xim = sf.reduce((s2, x) => s2 + 1 / x, 0) / m;
  const lineSearch = (f: (la: number) => number, start: number): number => {
    const dfn = (la: number) => (f(la + 1e-5) - f(la - 1e-5)) / 2e-5;
    let la = start, lp = f(la), dlp = dfn(la), kappa = 1;
    const eps = 1e-4, tol = 1e-6;
    for (let it = 0; it < 100; it++) {
      let prop = la + kappa * dlp;
      if (prop < minLogA) { kappa = (minLogA - la) / dlp; prop = minLogA; }
      if (prop > maxLogA) { kappa = (maxLogA - la) / dlp; prop = maxLogA; }
      const lpProp = f(prop);
      if (-lpProp <= -lp - kappa * eps * dlp * dlp) {
        kappa = Math.min(kappa * 1.1, 1);
        la = prop;
        const change = lpProp - lp;
        lp = lpProp;
        if (change < tol) return la;
        dlp = dfn(la);
      } else {
        kappa /= 2;
      }
      if (kappa < 1e-12) return la;
    }
    // not converged: grid search, as DESeq2
    const grid = Array.from({ length: 20 }, (_, i) => minLogA + ((maxLogA - minLogA) * i) / 19);
    let best = grid[0], bestV = -Infinity;
    for (const g of grid) { const v = f(g); if (v > bestV) { bestV = v; best = g; } }
    const step = (maxLogA - minLogA) / 19;
    const fine = Array.from({ length: 20 }, (_, i) => best - step + (2 * step * i) / 19);
    for (const g of fine) { const v = f(g); if (v > bestV) { bestV = v; best = g; } }
    return best;
  };
  const muAtStart: number[][] = [];
  const gw = K.map((r, g) => {
    if (means[g] <= 0) { muAtStart.push(r.map(() => 0)); return minDisp; }
    const y = norm[g];
    // rough estimate from the linear model on normalised counts (group means)
    const gmA = y.slice(0, nA).reduce((s2, x) => s2 + x, 0) / nA;
    const gmB = y.slice(nA).reduce((s2, x) => s2 + x, 0) / (m - nA);
    let rough = 0;
    y.forEach((v, j) => { const u = Math.max(inB(j) ? gmB : gmA, 1e-12); rough += ((v - u) ** 2 - u) / (u * u); });
    rough = Math.max(rough / (m - P), 0);
    const bm = means[g];
    const bv = y.reduce((s2, x) => s2 + (x - bm) ** 2, 0) / (m - 1);
    const moments = (bv - xim * bm) / (bm * bm);
    const init = Math.min(Math.max(minDisp, Math.min(rough, moments)), maxDisp);
    // groups-only design: μ from the linear model on normalised counts, floored at 0.5 (DESeq2)
    const mu = r.map((_, j) => Math.max(sf[j] * (inB(j) ? gmB : gmA), 0.5));
    muAtStart.push(mu);
    const la = lineSearch((x) => crLogLik(r, x, mu), Math.log(init));
    return Math.min(Math.max(Math.exp(la), minDisp), maxDisp);
  });
  // parametric trend α = a0 + a1/μ (gamma family, identity link), as PyDESeq2: fitted to every
  // gene with counts, then refitted after dropping genes outside 1e-4 ≤ α/fit < 15 (cumulatively)
  let a0 = 1, a1 = 1;
  const inFit = gw.map((_, g) => means[g] > 0);
  const usable = gw.map((d, g) => d >= 100 * minDisp && means[g] > 0);
  for (let it = 0; it < 100; it++) {
    let b0 = a0, b1 = a1;
    for (let k = 0; k < 100; k++) {
      let s00 = 0, s01 = 0, s11 = 0, t0 = 0, t1 = 0;
      gw.forEach((d, g) => {
        if (!inFit[g]) return;
        const x = 1 / means[g];
        const fit = Math.max(1e-10, b0 + b1 * x);
        const w = 1 / (fit * fit);
        s00 += w; s01 += w * x; s11 += w * x * x; t0 += w * d; t1 += w * d * x;
      });
      const det = s00 * s11 - s01 * s01;
      if (!(det > 0)) break;
      const n0 = (t0 * s11 - t1 * s01) / det;
      const n1 = (s00 * t1 - s01 * t0) / det;
      const conv = Math.abs(n0 - b0) <= 1e-10 * Math.abs(b0) + 1e-14 && Math.abs(n1 - b1) <= 1e-10 * Math.abs(b1) + 1e-14;
      b0 = n0; b1 = n1;
      if (conv) break;
    }
    if (!(b0 > 1e-10 && b1 > 1e-10)) break;
    const change = Math.log(b0 / a0) ** 2 + Math.log(b1 / a1) ** 2;
    a0 = b0; a1 = b1;
    gw.forEach((d, g) => { if (inFit[g]) { const ratio = d / (a0 + a1 / means[g]); if (ratio < 1e-4 || ratio >= 15) inFit[g] = false; } });
    if (change < 1e-6) break;
  }
  const trend = (mu: number) => Math.max(minDisp, a0 + a1 / Math.max(mu, 1e-8));
  // prior width of log dispersions around the trend
  const resid = gw.map((d, g) => (usable[g] ? Math.log(d) - Math.log(trend(means[g])) : NaN)).filter(Number.isFinite);
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const madResid = 1.4826 * median(resid.map((x) => Math.abs(x - median(resid))));
  const varLogDisp = madResid * madResid;
  const priorVar = Math.max(varLogDisp - trigamma((m - P) / 2), 0.25);
  // MAP dispersions (DESeq2 estimateDispersionsMAP): start at the gene-wise estimate when it is
  // above 0.1 × trend, else at the trend; dispersion outliers keep the gene-wise estimate
  const disp = K.map((r, g) => {
    const tr = trend(means[g]);
    if (means[g] <= 0) return tr;
    if (usable[g] && Math.log(gw[g]) > Math.log(tr) + 2 * Math.sqrt(varLogDisp)) return gw[g];
    const lt = Math.log(tr);
    const init = gw[g] > 0.1 * tr ? gw[g] : tr;
    const mu = muAtStart[g];
    const la = lineSearch((x) => crLogLik(r, x, mu) - ((x - lt) ** 2) / (2 * priorVar), Math.log(init));
    return Math.min(Math.max(Math.exp(la), minDisp), maxDisp);
  });
  // NB GLM fold changes and Wald test; Cook's distance per sample
  const cooksCutoff = fQuantile(0.99, P, m - P);
  // NB GLM by IRLS as DESeq2 fitBeta: start from least squares on log(normalised + 0.1), ridge
  // λ = 1e-6 (log2 scale) on both coefficients, μ floored at 0.5, stop when the relative change in
  // deviance is < 1e-8; SE from the ridge sandwich (X'WX + Λ)⁻¹ X'WX (X'WX + Λ)⁻¹.
  const lam = 1e-6 / (Math.LN2 * Math.LN2);
  const nbDev = (r: number[], mu: number[], a: number) => {
    let d = 0;
    for (let j = 0; j < m; j++) { const k = r[j], u = mu[j], au = a * u; d += lgammaDiff(k, 1 / a) - lgamma(k + 1) + k * (Math.log(au) - Math.log1p(au)) - Math.log1p(au) / a; }
    return -2 * d;
  };
  const res: DeGene[] = K.map((r, g) => {
    const a = disp[g];
    const ly = norm[g].map((v) => Math.log(v + 0.1));
    const lA = ly.slice(0, nA).reduce((x, y) => x + y, 0) / nA;
    const lB = ly.slice(nA).reduce((x, y) => x + y, 0) / (m - nA);
    let b0 = lA, b1 = lB - lA;
    let mu = r.map((_, j) => Math.max(sf[j] * Math.exp(b0 + (inB(j) ? b1 : 0)), 0.5));
    let devOld = 0;
    let H: number[] = [];
    for (let it = 0; it < 100; it++) {
      // weighted normal equations for X = [1, x]
      let s00 = 0, s01 = 0, s11 = 0, t0 = 0, t1 = 0;
      for (let j = 0; j < m; j++) {
        const u = mu[j], w = u / (1 + a * u), z = Math.log(u / sf[j]) + (r[j] - u) / u, x = inB(j) ? 1 : 0;
        s00 += w; s01 += w * x; s11 += w * x; t0 += w * z; t1 += w * x * z;
      }
      const A00 = s00 + lam, A01 = s01, A11 = s11 + lam;
      const det = A00 * A11 - A01 * A01;
      b0 = (A11 * t0 - A01 * t1) / det;
      b1 = (A00 * t1 - A01 * t0) / det;
      if (Math.abs(b0) > 30 || Math.abs(b1) > 30) break;
      mu = r.map((_, j) => Math.max(sf[j] * Math.exp(b0 + (inB(j) ? b1 : 0)), 0.5));
      const dev = nbDev(r, mu, a);
      const conv = Math.abs(dev - devOld) / (Math.abs(dev) + 0.1);
      devOld = dev;
      if (conv < 1e-8) break;
    }
    // sandwich covariance at the final μ
    let s00 = 0, s01 = 0, s11 = 0;
    for (let j = 0; j < m; j++) { const u = mu[j], w = u / (1 + a * u), x = inB(j) ? 1 : 0; s00 += w; s01 += w * x; s11 += w * x; }
    const A00 = s00 + lam, A01 = s01, A11 = s11 + lam;
    const det = A00 * A11 - A01 * A01;
    const I00 = A11 / det, I01 = -A01 / det, I11 = A00 / det; // (X'WX + Λ)⁻¹
    // Σ = I · M · I with M = X'WX
    const M00 = s00, M01 = s01, M11 = s11;
    const v11 = I01 * (M00 * I01 + M01 * I11) + I11 * (M01 * I01 + M11 * I11);
    const se = Math.sqrt(Math.max(v11, 0)) / Math.LN2;
    const lfc = b1 / Math.LN2;
    const stat = lfc / se;
    // hat values for Cook's distance: h_j = w_j x_j' (X'WX + Λ)⁻¹ x_j
    H = r.map((_, j) => { const u = mu[j], w = u / (1 + a * u), x = inB(j) ? 1 : 0; return w * (I00 + 2 * I01 * x + I11 * x * x); });
    let maxCook = 0;
    for (let j = 0; j < m; j++) {
      const groupN = inB(j) ? m - nA : nA;
      if (groupN < 3) continue;
      const u = mu[j];
      const h = H[j];
      const pr = (r[j] - u) / Math.sqrt(u + a * u * u);
      maxCook = Math.max(maxCook, ((pr * pr) / P) * (h / ((1 - h) ** 2)));
    }
    const pvalue = maxCook > cooksCutoff ? NaN : twoSidedP(stat);
    return { gene: genes[g], baseMean: means[g], log2FC: lfc, lfcSE: se, stat, pvalue, padj: NaN, dispersion: a };
  });
  // independent filtering on baseMean (DESeq2 / PyDESeq2: θ grid, lowess of rejections)
  const bm = res.map((x) => x.baseMean);
  const sortedBm = [...bm].sort((x, y) => x - y);
  const quant = (q: number) => { const pos = q * (sortedBm.length - 1); const lo = Math.floor(pos); return sortedBm[lo] + (sortedBm[Math.min(lo + 1, sortedBm.length - 1)] - sortedBm[lo]) * (pos - lo); };
  const lowerQ = bm.filter((x) => x === 0).length / bm.length;
  const upperQ = 0.95;
  const thetas = Array.from({ length: 50 }, (_, i) => lowerQ + ((upperQ - lowerQ) * i) / 49);
  const padjAt = (cut: number) => { const pv = res.map((x) => (x.baseMean >= cut ? x.pvalue : NaN)); return benjaminiHochberg(pv); };
  const numRej = thetas.map((th) => padjAt(quant(th)).filter((p) => p < o.alpha).length);
  let jBest = 0;
  if (Math.max(...numRej) > 10) {
    const fit = lowess(thetas, numRej, 1 / 5);
    const rs = numRej.map((v, i) => v - fit[i]).filter((_, i) => numRej[i] > 0);
    const thresh = Math.max(...fit) - Math.sqrt(rs.reduce((s, x) => s + x * x, 0) / Math.max(1, rs.length));
    jBest = Math.max(0, numRej.findIndex((v) => v > thresh));
  }
  const padj = padjAt(quant(thetas[jBest]));
  res.forEach((x, i) => { x.padj = padj[i]; });
  const sig = res.filter((x) => x.padj < o.alpha && Math.abs(x.log2FC) >= o.lfcThreshold);
  // PCA on log2(norm + 1), top variable genes
  const logN = norm.map((r) => r.map((x) => Math.log2(x + 1)));
  const varOf = (r: number[]) => { const mu = r.reduce((s, x) => s + x, 0) / r.length; return r.reduce((s, x) => s + (x - mu) ** 2, 0); };
  const top = logN.map((r, g) => [varOf(r), g] as const).sort((x, y) => y[0] - x[0]).slice(0, o.pcaGenes).map(([, g]) => g);
  const X = Array.from({ length: m }, (_, j) => top.map((g) => logN[g][j]));
  const colMean = top.map((_, c) => X.reduce((s, row) => s + row[c], 0) / m);
  const Xc = X.map((row) => row.map((v, c) => v - colMean[c]));
  // sample-space Gram matrix and power iteration (m is small)
  const G = Xc.map((a) => Xc.map((b) => a.reduce((s, v, c) => s + v * b[c], 0)));
  const totalVar = G.reduce((s, row, i) => s + row[i], 0) || 1;
  const eig = (M: number[][], deflate?: { v: number[]; l: number }) => {
    let v = M.map((_, i) => 1 + i * 0.01);
    let l = 0;
    for (let it = 0; it < 300; it++) {
      let w = M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      if (deflate) { const d = deflate.v.reduce((s, x, j) => s + x * v[j], 0); w = w.map((x, i) => x - deflate.l * d * deflate.v[i]); }
      const n = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      l = n;
      v = w.map((x) => x / n);
    }
    return { v, l };
  };
  const e1 = eig(G);
  const e2 = eig(G, e1);
  const pca = cols.map((j, k) => ({
    sample: t.samples[j], group: k < nA ? o.conditionA : o.conditionB,
    pc1: e1.v[k] * Math.sqrt(e1.l), pc2: e2.v[k] * Math.sqrt(e2.l),
  }));
  return {
    conditionA: o.conditionA, conditionB: o.conditionB, samplesA: o.samplesA, samplesB: o.samplesB,
    sizeFactors: Object.fromEntries(cols.map((j, k) => [t.samples[j], sf[k]])),
    genes: res, pca, pcaVariance: [(100 * e1.l) / totalVar, (100 * e2.l) / totalVar], dispersionTrend: [a0, a1],
    significant: sig.length, up: sig.filter((x) => x.log2FC > 0).length, down: sig.filter((x) => x.log2FC < 0).length,
    alpha: o.alpha, lfcThreshold: o.lfcThreshold, filteredOut: t.genes.length - genes.length,
  };
}

/** Deterministic NB-simulated example: 2,000 genes, 3 vs 3 samples, 10% changed (Help example). */
export function simulatedCountTable(seed = 7): { text: string; truth: Set<string> } {
  let x = seed >>> 0;
  const rand = () => { x = (x * 1664525 + 1013904223) >>> 0; return (x + 0.5) / 4294967296; };
  const gamma = (k: number): number => {
    // Marsaglia–Tsang
    if (k < 1) return gamma(k + 1) * Math.pow(rand(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let z: number;
      let v: number;
      do { const u1 = rand(); const u2 = rand(); z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * z; } while (v <= 0);
      v = v * v * v;
      if (Math.log(rand()) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v;
    }
  };
  const poisson = (l: number) => {
    if (l > 50) return Math.max(0, Math.round(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand())));
    const L = Math.exp(-l); let k = 0; let p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  };
  const sizes = [0.8, 1.0, 1.25, 0.9, 1.1, 1.3];
  const samples = ['ctrl_1', 'ctrl_2', 'ctrl_3', 'treat_1', 'treat_2', 'treat_3'];
  const truth = new Set<string>();
  const rows = [['gene', ...samples].join('\t')];
  for (let g = 0; g < 2000; g++) {
    const mu = Math.exp(Math.log(5) + rand() * Math.log(4000));
    const alpha = 0.05 + 2 / mu;
    const de = g % 10 === 0;
    const fc = de ? (g % 20 === 0 ? 4 : 0.25) : 1;
    const name = `GENE${String(g + 1).padStart(4, '0')}`;
    if (de) truth.add(name);
    const counts = samples.map((_, j) => {
      const m = mu * sizes[j] * (j >= 3 ? fc : 1);
      const lam = gamma(1 / alpha) * alpha * m;
      return poisson(lam);
    });
    rows.push([name, ...counts].join('\t'));
  }
  return { text: rows.join('\n'), truth };
}
