// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Fragment analysis / microsatellites:
 *
 *  1. `.fsa` import: Applied Biosystems ABIF files from capillary fragment runs — dye channels
 *     (DATA 1–4 and 105 raw; 9–12 and 205 analysed, preferred when present), dye names (DyeN),
 *     dye set, sample and run details.
 *  2. Sizing: peaks in the size-standard channel are matched in order to the standard's sizes
 *     by dynamic programming (the matching whose scans-per-base slope changes most smoothly,
 *     allowing extra peaks or missing standards), and scans are converted to base pairs by
 *     local linear interpolation between neighbouring standards.
 *  3. Allele calling per marker (dye + size range + repeat unit): peaks above a height
 *     threshold, stutter peaks one repeat shorter than a taller peak removed, the tallest peak
 *     and a second peak within heterozygote balance reported.
 */

// ───────────────────────────── ABIF reading / writing ─────────────────────────────

export interface FragmentChannel {
  dye: string;
  /** Fluorescence per scan. */
  data: number[];
}

export interface FragmentTrace {
  channels: FragmentChannel[];
  dyeSet?: string;
  sample?: string;
  instrument?: string;
  /** Which DATA tags were read ('analysed' or 'raw'). */
  dataKind: 'analysed' | 'raw';
}

interface Entry { name: string; num: number; type: number; count: number; size: number; data: Uint8Array }

function entries(bytes: Uint8Array): Entry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 34 || String.fromCharCode(...bytes.slice(0, 4)) !== 'ABIF') throw new Error('Not an ABIF file (missing "ABIF" header).');
  const n = dv.getInt32(18);
  const dir = dv.getUint32(26);
  const out: Entry[] = [];
  for (let i = 0; i < Math.min(n, 16384); i++) {
    const p = dir + i * 28;
    if (p + 28 > bytes.length) break;
    const name = String.fromCharCode(...bytes.slice(p, p + 4));
    const num = dv.getInt32(p + 4);
    const type = dv.getInt16(p + 8);
    const count = Math.max(0, dv.getInt32(p + 12));
    const size = Math.max(0, dv.getInt32(p + 16));
    let data: Uint8Array;
    if (size <= 4) data = bytes.slice(p + 20, p + 20 + size);
    else {
      const off = dv.getUint32(p + 20);
      if (off + size > bytes.length) continue;
      data = bytes.slice(off, off + size);
    }
    out.push({ name, num, type, count, size, data });
  }
  return out;
}

const text = (e?: Entry) => {
  if (!e || (e.type !== 18 && e.type !== 19 && e.type !== 2)) return undefined;
  const d = e.type === 18 && e.data.length ? e.data.slice(1) : e.data; // pString: length byte first
  return String.fromCharCode(...d).replace(/\0+$/, '').trim() || undefined;
};
const shorts = (e: Entry) => {
  const dv = new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength);
  return Array.from({ length: Math.floor(e.data.length / 2) }, (_, i) => Math.max(0, dv.getInt16(i * 2)));
};

export function parseFsa(buffer: ArrayBuffer | Uint8Array): FragmentTrace {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const es = entries(bytes);
  const get = (name: string, num: number) => es.find((e) => e.name === name && e.num === num);
  // Thermo's HID files store protected (encrypted) traces under element type 28
  if ([1, 2, 3, 4, 9, 10].some((n) => get('DATA', n)?.type === 28)) {
    throw new Error('This file stores its traces in encrypted form (HID format): export the run as .fsa from the instrument’s analysis software to analyse it here.');
  }
  // dyes 1–4 then 5 and 6 (DATA 105/106 raw, 205/206 analysed) for 5- and 6-dye chemistries
  const analysed = [9, 10, 11, 12, 205, 206].map((n) => get('DATA', n)).filter((e): e is Entry => !!e && e.type === 4);
  const raw = [1, 2, 3, 4, 105, 106].map((n) => get('DATA', n)).filter((e): e is Entry => !!e && e.type === 4);
  const use = analysed.length >= 2 ? analysed : raw;
  if (use.length < 2) throw new Error('This ABIF file has no fragment-analysis dye channels (DATA 1–4 / 105–106).');
  const channels = use.map((e, i) => ({ dye: text(get('DyeN', i + 1)) ?? `Dye ${i + 1}`, data: shorts(e) }));
  return {
    channels,
    dyeSet: text(get('DySN', 1)),
    sample: text(get('SMPL', 1)),
    instrument: text(get('MCHN', 1)),
    dataKind: use === analysed ? 'analysed' : 'raw',
  };
}

/** Writes a minimal ABIF fragment file (for tests and exports): DATA 1–4/105, DyeN, SMPL. */
export function encodeFsa(trace: { channels: FragmentChannel[]; sample?: string; dyeSet?: string }): Uint8Array {
  type Item = { name: string; num: number; type: number; elemSize: number; count: number; data: Uint8Array };
  const items: Item[] = [];
  const str = (s: string) => { const b = new Uint8Array(s.length + 1); b[0] = s.length; for (let i = 0; i < s.length; i++) b[i + 1] = s.charCodeAt(i) & 0xff; return b; };
  trace.channels.forEach((c, i) => {
    const b = new Uint8Array(c.data.length * 2);
    const dv = new DataView(b.buffer);
    c.data.forEach((v, k) => dv.setInt16(k * 2, Math.max(-32768, Math.min(32767, Math.round(v)))));
    items.push({ name: 'DATA', num: i < 4 ? i + 1 : 105, type: 4, elemSize: 2, count: c.data.length, data: b });
    items.push({ name: 'DyeN', num: i + 1, type: 18, elemSize: 1, count: c.dye.length + 1, data: str(c.dye) });
  });
  if (trace.sample) items.push({ name: 'SMPL', num: 1, type: 18, elemSize: 1, count: trace.sample.length + 1, data: str(trace.sample) });
  if (trace.dyeSet) items.push({ name: 'DySN', num: 1, type: 18, elemSize: 1, count: trace.dyeSet.length + 1, data: str(trace.dyeSet) });
  const header = 128;
  let offset = header;
  const blobs: { item: Item; off: number }[] = [];
  for (const it of items) { if (it.data.length > 4) { blobs.push({ item: it, off: offset }); offset += it.data.length; } }
  const dirOff = offset;
  const total = dirOff + items.length * 28;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([65, 66, 73, 70], 0); // "ABIF"
  dv.setInt16(4, 101);
  // root directory entry ("tdir")
  out.set([116, 100, 105, 114], 6);
  dv.setInt32(10, 1);
  dv.setInt16(14, 1023);
  dv.setInt16(16, 28);
  dv.setInt32(18, items.length);
  dv.setInt32(22, items.length * 28);
  dv.setUint32(26, dirOff);
  for (const b of blobs) out.set(b.item.data, b.off);
  items.forEach((it, i) => {
    const p = dirOff + i * 28;
    for (let k = 0; k < 4; k++) out[p + k] = it.name.charCodeAt(k);
    dv.setInt32(p + 4, it.num);
    dv.setInt16(p + 8, it.type);
    dv.setInt16(p + 10, it.elemSize);
    dv.setInt32(p + 12, it.count);
    dv.setInt32(p + 16, it.data.length);
    if (it.data.length <= 4) out.set(it.data, p + 20);
    else dv.setUint32(p + 20, blobs.find((x) => x.item === it)!.off);
  });
  return out;
}

// ───────────────────────────── peaks ─────────────────────────────

export interface Peak { scan: number; height: number; /** reached the detector limit (off-scale) */ saturated?: boolean }

/** Raw fluorescence at or above this is off-scale on ABI instruments (16-bit signed maximum). */
export const SATURATION = 32000;

/** Baseline-corrected local maxima above `minHeight`, at least `minSep` scans apart. */
export function findPeaks(data: number[], minHeight: number, minSep = 4, from = 0): Peak[] {
  const n = data.length;
  // baseline: running minimum over ±100 scans, smoothed
  const w = 100;
  const base = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k += 5) m = Math.min(m, data[k]);
    base[i] = m;
  }
  const y = data.map((v, i) => v - base[i]);
  const peaks: Peak[] = [];
  for (let i = Math.max(1, from); i < n - 1; i++) {
    // off-scale plateau: one peak at its centre (its flat top would otherwise split into two)
    if (data[i] >= SATURATION) {
      let j = i;
      while (j + 1 < n && data[j + 1] >= SATURATION) j++;
      const c = (i + j) / 2;
      const last = peaks[peaks.length - 1];
      if (last && c - last.scan < minSep) peaks.pop();
      peaks.push({ scan: c, height: Math.max(...y.slice(i, j + 1)), saturated: true });
      i = j;
      continue;
    }
    if (y[i] >= minHeight && y[i] >= y[i - 1] && y[i] > y[i + 1]) {
      const last = peaks[peaks.length - 1];
      if (last && i - last.scan < minSep) { if (y[i] > last.height) peaks[peaks.length - 1] = { scan: i, height: y[i] }; continue; }
      peaks.push({ scan: i, height: y[i] });
    }
  }
  // sub-scan position by parabolic interpolation
  return peaks.map((p) => {
    if (p.saturated) return p;
    const a = y[p.scan - 1], b = y[p.scan], c = y[p.scan + 1];
    const den = a - 2 * b + c;
    return { scan: den !== 0 ? p.scan + (0.5 * (a - c)) / den : p.scan, height: p.height };
  });
}

// ───────────────────────────── sizing ─────────────────────────────

export const SIZE_STANDARDS: Record<string, number[]> = {
  'GeneScan 500 LIZ': [35, 50, 75, 100, 139, 150, 160, 200, 250, 300, 340, 350, 400, 450, 490, 500],
  'GeneScan 500 ROX': [35, 50, 75, 100, 139, 150, 160, 200, 250, 300, 340, 350, 400, 450, 490, 500],
  'Promega ILS 600': [60, 80, 100, 120, 140, 160, 180, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500, 550, 600],
  'GeneScan 600 LIZ v2': [20, 40, 60, 80, 100, 114, 120, 140, 160, 180, 200, 214, 220, 240, 250, 260, 280, 300, 314, 320, 340, 360, 380, 400, 414, 420, 440, 460, 480, 500, 514, 520, 540, 560, 580, 600],
  'GeneScan 1200 LIZ': [20, 30, 40, 60, 80, 100, 114, 120, 140, 160, 180, 200, 214, 220, 240, 250, 260, 280, 300, 314, 320, 340, 360, 380, 400, 414, 420, 440, 460, 480, 500, 514, 520, 540, 560, 580, 600, 614, 620, 640, 660, 680, 700, 714, 720, 740, 760, 780, 800, 820, 840, 850, 860, 880, 900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080, 1100, 1120, 1160, 1200],
};

export interface Sizing {
  /** Matched standards: scan → bp, in order. */
  points: { scan: number; bp: number }[];
  matched: number;
  expected: number;
  /** Largest deviation of a standard from the global linear fit (bp), a quality indicator. */
  maxResidualBp: number;
  rSquared: number;
  /** The standard's sizes (all of them, matched or not). */
  sizes?: number[];
}

/**
 * In-order matching of peak positions to standard sizes. The shorter list is matched entirely
 * to an ordered subset of the longer one, choosing the subset whose local slope
 * (scans per base between consecutive matches) changes most smoothly — mobility curves are
 * smooth, a wrong or skipped assignment makes the slope jump. Dynamic programming over
 * (current, previous) choices: O(m · n³).
 */
export function matchLadder(scans: number[], sizes: number[]): { scan: number; bp: number }[] {
  const peaksLonger = scans.length >= sizes.length;
  const S = peaksLonger ? sizes : scans; // fully matched
  const L = peaksLonger ? scans : sizes; // subset chosen
  const m = S.length;
  const n = L.length;
  if (m < 2) return [];
  const pair = (k: number, idx: number) => (peaksLonger ? { scan: L[idx], bp: S[k] } : { scan: S[k], bp: L[idx] });
  const slope = (k1: number, i1: number, k2: number, i2: number) => {
    const a = pair(k1, i1);
    const b = pair(k2, i2);
    const ds = b.scan - a.scan;
    const db = b.bp - a.bp;
    return ds > 0 && db > 0 ? Math.log(ds / db) : NaN;
  };
  // dp[a][b] for step k: k-th match uses L[a], (k−1)-th uses L[b]
  const INF = Infinity;
  let dp: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(INF));
  const back: Int16Array[][] = [];
  for (let a = 1; a < n; a++) for (let b = 0; b < a; b++) if (Number.isFinite(slope(0, b, 1, a))) dp[a][b] = 0;
  back.push([]);
  for (let k = 2; k < m; k++) {
    const next: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(INF));
    const bk: Int16Array[] = Array.from({ length: n }, () => new Int16Array(n).fill(-1));
    for (let a = k - 1; a < n; a++) {
      for (let b = k - 2; b < a; b++) {
        const cur = dp[a][b];
        if (cur === INF) continue;
        const s1 = slope(k - 2, b, k - 1, a);
        for (let c = a + 1; c <= n - (m - k); c++) {
          const s2 = slope(k - 1, a, k, c);
          if (!Number.isFinite(s2)) continue;
          const cost = cur + (s2 - s1) ** 2;
          if (cost < next[c][a]) { next[c][a] = cost; bk[c][a] = b; }
        }
      }
    }
    dp = next;
    back.push(bk);
  }
  let best = INF;
  let ba = -1;
  let bb = -1;
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) if (dp[a][b] < best) { best = dp[a][b]; ba = a; bb = b; }
  if (ba < 0) return [];
  const idx = new Array<number>(m);
  idx[m - 1] = ba;
  idx[m - 2] = bb;
  for (let k = m - 1; k >= 2; k--) {
    const prev = back[k - 1][idx[k]][idx[k - 1]];
    idx[k - 2] = prev;
  }
  return idx.map((li, k) => pair(k, li));
}

/** `exclude`: scan positions of off-scale peaks in other dyes — size-standard peaks there are pull-up. */
export function sizeStandard(data: number[], sizes: number[], minHeight = 100, exclude: number[] = []): Sizing {
  // skip the primer flare: start after the first 5% of the run
  const allPeaks = findPeaks(data, minHeight, 4, Math.floor(data.length * 0.05));
  const best = (peaks: Peak[]) => {
    if (peaks.length < 3) return null;
    return matchCandidates(peaks, sizes);
  };
  // Peaks at the scans of off-scale peaks in other dyes may be pull-up — or a real standard that
  // happens to coincide. Match both ways and keep the better result.
  const withAll = best(allPeaks);
  const withoutPullUp = exclude.length ? best(allPeaks.filter((p) => !exclude.some((x) => Math.abs(x - p.scan) <= 3))) : null;
  const pick = [withAll, withoutPullUp].filter((x): x is { scan: number; bp: number }[] => !!x).sort(compareMatches)[0];
  if (!pick || allPeaks.length < 3) throw new Error('Too few peaks in the size-standard channel (check the dye or lower the threshold).');
  const points = pick;
  if (points.length < 3) throw new Error('The size-standard peaks could not be matched to the chosen standard.');
  return { ...finishSizing(points, sizes.length), sizes };
}

function matchCandidates(peaks: Peak[], sizes: number[]): { scan: number; bp: number }[] {
  // candidates: size-standard peaks are of similar height; drop small artefacts
  const tops = [...peaks].sort((a, b) => b.height - a.height).slice(0, sizes.length);
  const medTop = tops[Math.floor(tops.length / 2)]?.height ?? 0;
  const cand = peaks.filter((p) => p.height >= 0.25 * medTop).slice(0, sizes.length * 3);
  // Mobility on capillary instruments is close to linear in this range, so a poor straight-line
  // fit means the matching started inside an early artefact cluster (primer, dye blobs): retry
  // without the earliest candidates and keep the best fit.
  let points = matchLadder(cand.map((c) => c.scan), sizes);
  const tryAlt = (c: Peak[]) => { if (c.length >= 3) { const alt = matchLadder(c.map((x) => x.scan), sizes); if (compareMatches(alt, points) < 0) points = alt; } };
  for (let drop = 1; linearR2(points) < GOOD_FIT && drop <= 20 && cand.length - drop >= Math.max(3, sizes.length - 2); drop++) tryAlt(cand.slice(drop));
  // With fewer peaks than standards every peak must take a size, so a trailing artefact (past the
  // largest standard) or a weak spike between standards shifts the whole match: retry without them.
  if (linearR2(points) < GOOD_FIT || cand.length <= sizes.length + 2) {
    const weak = cand.filter((p) => p.height < 0.5 * medTop).sort((a, b) => a.height - b.height).slice(0, 2);
    const variants: Peak[][] = [];
    for (let lead = 0; lead <= 3; lead++) for (let trail = 0; trail <= 3; trail++) {
      if (!lead && !trail) continue;
      variants.push(cand.slice(lead, cand.length - trail));
    }
    for (let w = 1; w <= weak.length; w++) {
      const rest = cand.filter((p) => !weak.slice(0, w).includes(p));
      for (let trail = 0; trail <= 2; trail++) variants.push(rest.slice(0, rest.length - trail));
    }
    for (const v of variants) tryAlt(v);
  }
  return points;
}

/** Straight-line fit a correct size-standard match on capillary instruments reaches. */
const GOOD_FIT = 0.998;

/** Sum of squared changes of log(scans per base) between neighbouring matches (lower = smoother). */
function roughness(points: { scan: number; bp: number }[]): number {
  const sl = points.slice(1).map((p, i) => Math.log((p.scan - points[i].scan) / (p.bp - points[i].bp)));
  let c = 0;
  for (let i = 1; i < sl.length; i++) c += (sl[i] - sl[i - 1]) ** 2;
  return c;
}

/**
 * Orders candidate matchings, best first: a good straight-line fit (R² ≥ 0.998) before a poor
 * one that matched at most three more standards; then more standards matched; among good fits the smoother mobility curve (R² hardly sees
 * a slip at the small end); among poor fits the higher R².
 */
function compareMatches(a: { scan: number; bp: number }[], b: { scan: number; bp: number }[]): number {
  const ra = linearR2(a);
  const rb = linearR2(b);
  const ga = ra >= GOOD_FIT;
  const gb = rb >= GOOD_FIT;
  // a good straight-line fit beats a poor one that only matched one to three more peaks
  if (ga !== gb && Math.abs(a.length - b.length) <= 3 && Math.min(a.length, b.length) >= 5) return ga ? -1 : 1;
  if (a.length !== b.length) return b.length - a.length;
  if (ga !== gb) return ga ? -1 : 1;
  return ga ? roughness(a) - roughness(b) : rb - ra;
}

function finishSizing(points: { scan: number; bp: number }[], expected: number): Sizing {
  // quality: linear regression of bp on scan
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.scan, 0) / n;
  const my = points.reduce((a, p) => a + p.bp, 0) / n;
  const sxy = points.reduce((a, p) => a + (p.scan - mx) * (p.bp - my), 0);
  const sxx = points.reduce((a, p) => a + (p.scan - mx) ** 2, 0);
  const slope = sxy / sxx;
  const icpt = my - slope * mx;
  const ssTot = points.reduce((a, p) => a + (p.bp - my) ** 2, 0);
  const ssRes = points.reduce((a, p) => a + (p.bp - (icpt + slope * p.scan)) ** 2, 0);
  return { points, matched: n, expected, maxResidualBp: Math.max(...points.map((p) => Math.abs(p.bp - (icpt + slope * p.scan)))), rSquared: 1 - ssRes / ssTot };
}

/**
 * Tries every listed standard and keeps the one that matches the largest share of its peaks
 * with a near-linear fit. Forcing the wrong standard still "matches" peaks but with a poor fit.
 */
export function autoSizeStandard(data: number[], minHeight: number, exclude: number[] = [], dye = ''): { name: string; sizing: Sizing } {
  let best: { name: string; sizing: Sizing; score: number } | null = null;
  const d = dye.toUpperCase();
  for (const [name, sizes] of Object.entries(SIZE_STANDARDS)) {
    try {
      const sizing = sizeStandard(data, sizes, minHeight, exclude);
      // share of the standard matched, sharply penalised for a poor straight-line fit (a wrong
      // standard can match every peak, but not on a straight line); between equal fits (GS500
      // LIZ and ROX share their sizes) the standard named after the ladder dye
      const named = d && name.toUpperCase().includes(d) ? 1.001 : 1;
      const score = (sizing.matched / sizing.expected) * Math.max(0, sizing.rSquared) ** 30 * named;
      if (!best || score > best.score) best = { name, sizing, score };
    } catch { /* this standard does not fit */ }
  }
  if (!best) throw new Error('None of the size standards could be matched to the size-standard peaks.');
  return { name: best.name, sizing: best.sizing };
}

/**
 * A sizing problem worth telling the user about, or null. Standards missing only at the ends
 * (small fragments hidden in the primer peak, large ones past the end of the run) are normal and
 * only reported when most of the standard is missing.
 */
export function sizingWarning(s: Sizing): string | null {
  if (s.rSquared < 0.995) return `poor size-standard fit (R² ${s.rSquared.toFixed(3)}): check that the right standard and dye are chosen`;
  const lo = s.points[0]?.bp ?? 0;
  const hi = s.points[s.points.length - 1]?.bp ?? 0;
  const inner = s.sizes ? s.sizes.filter((b) => b > lo && b < hi && !s.points.some((p) => p.bp === b)).length : s.expected - s.matched;
  if (inner > 0) return `${inner} standard peak${inner === 1 ? '' : 's'} not found inside the matched range; check the size-standard channel`;
  if (s.matched < 0.6 * s.expected) return `only ${s.matched} of ${s.expected} standard peaks found (${lo}–${hi} bp); sizes outside that range are extrapolated`;
  return null;
}

function linearR2(points: { scan: number; bp: number }[]): number {
  const n = points.length;
  if (n < 3) return 0;
  const mx = points.reduce((a, p) => a + p.scan, 0) / n;
  const my = points.reduce((a, p) => a + p.bp, 0) / n;
  const sxy = points.reduce((a, p) => a + (p.scan - mx) * (p.bp - my), 0);
  const sxx = points.reduce((a, p) => a + (p.scan - mx) ** 2, 0);
  const syy = points.reduce((a, p) => a + (p.bp - my) ** 2, 0);
  return sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
}

export type SizingMethod = 'local-southern' | 'local-linear' | 'cubic';

/** Reciprocal (Southern 1979) fit through three standards: bp = c + m / (scan − t0). */
function southern3(a: { scan: number; bp: number }, b: { scan: number; bp: number }, c: { scan: number; bp: number }) {
  // solve for t0 from (bp_i − bp_j)(scan_i − t0)(scan_j − t0) = m (scan_j − scan_i) …: use the closed form
  const x1 = a.scan, x2 = b.scan, x3 = c.scan, y1 = a.bp, y2 = b.bp, y3 = c.bp;
  // (y − c)(x − t0) = m for each point → linear in (c·t0 − m), c, t0 after expansion:
  // y·x = c·x + y·t0 + (m − c·t0)  → unknowns A=c, B=t0, C=m − c·t0
  const M = [[x1, y1, 1, y1 * x1], [x2, y2, 1, y2 * x2], [x3, y3, 1, y3 * x3]];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k];
    }
  }
  const cc = M[0][3] / M[0][0];
  const t0 = M[1][3] / M[1][1];
  const C = M[2][3] / M[2][2];
  const m = C + cc * t0;
  return (x: number) => cc + m / (x - t0);
}

/** Least-squares cubic bp(scan) over all standards. */
function cubicFit(points: { scan: number; bp: number }[]): ((x: number) => number) | null {
  const n = points.length;
  if (n < 5) return null;
  const xm = points.reduce((a, p) => a + p.scan, 0) / n;
  const xs = Math.max(...points.map((p) => Math.abs(p.scan - xm))) || 1;
  const X = points.map((p) => (p.scan - xm) / xs);
  const A = Array.from({ length: 4 }, (_, i) => Array.from({ length: 5 }, (_, j) => (j < 4 ? X.reduce((acc, x) => acc + x ** (i + j), 0) : X.reduce((acc, x, k) => acc + points[k].bp * x ** i, 0))));
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 5; k++) A[r][k] -= f * A[col][k];
    }
  }
  const c = A.map((row, i) => row[4] / row[i]);
  return (x: number) => { const t = (x - xm) / xs; return c[0] + c[1] * t + c[2] * t * t + c[3] * t * t * t; };
}

/**
 * Base-pair size of a scan position. Default: Local Southern (Elder and Southern 1983) — the
 * average of the reciprocal fits through the three standards ending and starting at the
 * standards that bracket the scan; outside the standards, the nearest three. Alternatives:
 * local linear interpolation, or a least-squares cubic over all standards.
 */
export function scanToBp(sizing: Sizing, scan: number, method: SizingMethod = 'local-southern'): number {
  const p = fitPoints(sizing);
  if (method === 'cubic') { const f = cubicFit(p); if (f) return f(scan); }
  if (method === 'local-southern' && p.length >= 3) {
    let k = 0;
    while (k < p.length - 2 && scan > p[k + 1].scan) k++; // scan in [p[k], p[k+1]] (or beyond the ends)
    const fits: number[] = [];
    if (k >= 1) { const f = southern3(p[k - 1], p[k], p[k + 1]); if (f) fits.push(f(scan)); }
    if (k + 2 < p.length) { const f = southern3(p[k], p[k + 1], p[k + 2]); if (f) fits.push(f(scan)); }
    const ok = fits.filter(Number.isFinite);
    if (ok.length) return ok.reduce((a, b) => a + b, 0) / ok.length;
  }
  return localLinear(sizing, scan);
}

/**
 * GeneScan 500 fragments that migrate anomalously (secondary structure): matched for the ladder
 * fit but left out when converting scans to sizes, as Applied Biosystems' GS500(-250) / (-250,-340)
 * definitions do. On the OSIRIS allelic ladders this halves the within-locus size scatter.
 */
const ANOMALOUS_GS500 = [250, 340];
const isGs500 = (p: { bp: number }[]) => [139, 160, 340, 490].every((b) => p.some((q) => q.bp === b));
function fitPoints(sizing: Sizing): { scan: number; bp: number }[] {
  const p = sizing.points;
  if (!isGs500(p)) return p;
  const kept = p.filter((q) => !ANOMALOUS_GS500.includes(q.bp));
  return kept.length >= 3 ? kept : p;
}

function localLinear(sizing: Sizing, scan: number): number {
  const p = fitPoints(sizing);
  let k = 0;
  while (k < p.length - 2 && scan > p[k + 1].scan) k++;
  const a = p[k];
  const b = p[k + 1];
  return a.bp + ((scan - a.scan) * (b.bp - a.bp)) / (b.scan - a.scan);
}

// ───────────────────────────── allele calling ─────────────────────────────

export interface Marker {
  name: string;
  /** Dye name, or `#n` for the n-th channel of the run (kit definitions number channels). */
  dye: string;
  minBp: number;
  maxBp: number;
  repeat: number;
  /** Allelic-ladder alleles in run order with their approximate (nominal) sizes. */
  ladder?: { name: string; bp: number }[];
}

export interface MarkerCall {
  marker: string;
  dye: string;
  /** `name`: allele designation from the allelic ladder ('OL' = off-ladder), when a ladder was used. */
  alleles: { size: number; height: number; name?: string }[];
  peaks: number;
  note: string;
}

/** A ladder allele as observed in an allelic-ladder run: its designation and measured size. */
export interface LadderBin { name: string; size: number; /** the kit's nominal size of this allele */ nominal?: number }
/** Observed ladder alleles per marker name. */
export type LadderBins = Record<string, LadderBin[]>;

/** The channel a marker's dye refers to: a dye name, or `#n` / `n` for the n-th channel. */
export function markerChannel(trace: FragmentTrace, dye: string) {
  const n = /^#?(\d+)$/.exec(dye.trim());
  if (n) return trace.channels[Number(n[1]) - 1];
  return trace.channels.find((c) => c.dye.toLowerCase() === dye.toLowerCase())
    ?? trace.channels.find((c) => c.dye.toLowerCase().includes(dye.toLowerCase()));
}

/**
 * Kit definitions in the NCBI OSIRIS LadderInfo XML format (`<Set>` per kit, `<Locus>` with
 * channel, size range and ladder alleles). Channels are mapped to the .fsa channel numbers.
 */
export function parseKitXml(xml: string): { name: string; markers: Marker[] }[] {
  const tag = (t: string, s: string) => new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`).exec(s)?.[1];
  const sets = xml.split(/<Set>/).slice(1);
  if (!sets.length) throw new Error('No <Set> kit definition found in this XML (expected an OSIRIS LadderInfo file).');
  return sets.map((set) => {
    const fsaOf = new Map<number, number>();
    for (const c of set.split('<Channel>').slice(1)) {
      const k = Number(tag('KitChannelNumber', c));
      const f = Number(tag('fsaChannelNumber', c));
      if (k && f) fsaOf.set(k, f);
    }
    const markers = set.split('<Locus>').slice(1).map((l) => {
      const ladder = [...l.matchAll(/<Allele>([\s\S]*?)<\/Allele>/g)]
        .map((m) => ({ name: tag('Name', m[1]) ?? '', bp: Number(tag('BP', m[1])) }))
        .filter((a) => a.name && Number.isFinite(a.bp))
        .sort((a, b) => a.bp - b.bp);
      const ch = Number(tag('Channel', l));
      const ints = ladder.filter((a) => /^\d+$/.test(a.name));
      const steps = ints.slice(1).map((a, i) => (a.bp - ints[i].bp) / (Number(a.name) - Number(ints[i].name))).filter((x) => x > 0).sort((a, b) => a - b);
      const repeat = Math.max(1, Math.round(steps[Math.floor(steps.length / 2)] ?? 4));
      return {
        name: tag('Name', l) ?? '?', dye: `#${fsaOf.get(ch) ?? ch}`,
        minBp: Number(tag('MinBP', l) ?? ladder[0]?.bp - repeat), maxBp: Number(tag('MaxBP', l) ?? ladder[ladder.length - 1]?.bp + repeat),
        repeat, ...(ladder.length ? { ladder } : {}),
      };
    });
    return { name: tag('Name', set) ?? 'Kit', markers };
  });
}

/**
 * Finds each marker's ladder alleles in an allelic-ladder run. Kit sizes are only approximate
 * (several bp off on a given instrument), so ladder peaks are assigned by order: the tall
 * peaks around the marker's range are matched in order to the ladder alleles, choosing the
 * run whose spacing follows the nominal spacing most smoothly (as for size standards).
 */
export function calibrateLadder(trace: FragmentTrace, sizing: Sizing, markers: Marker[], minHeight = 100): { bins: LadderBins; problems: string[] } {
  const bins: LadderBins = {};
  const problems: string[] = [];
  for (const mk of markers) {
    if (!mk.ladder?.length) continue;
    const ch = markerChannel(trace, mk.dye);
    if (!ch) { problems.push(`${mk.name}: dye ${mk.dye} not in the ladder run`); continue; }
    const pad = Math.max(10, 2 * mk.repeat);
    const peaks = cleanPeaks(trace, ch.dye, sizing, minHeight).filter((p) => p.size >= mk.minBp - pad && p.size <= mk.maxBp + pad);
    const n = mk.ladder.length;
    const tops = [...peaks].sort((a, b) => b.height - a.height).slice(0, n);
    const med = tops[Math.floor(tops.length / 2)]?.height ?? 0;
    const cand = peaks.filter((p) => p.height >= 0.3 * med);
    if (cand.length < Math.min(2, n)) { problems.push(`${mk.name}: only ${cand.length} ladder peak${cand.length === 1 ? '' : 's'} found`); continue; }
    const nominal = mk.ladder.map((a) => a.bp);
    // a stutter or neighbouring-marker peak next to the ladder gives an equally smooth shifted
    // match: among equally smooth matches keep the one on the taller peaks
    const heightOf = new Map(cand.map((p) => [p.size, p.height]));
    const score = (pts: { scan: number; bp: number }[]) => ({ len: pts.length, rough: roughness(pts.map((x) => ({ scan: x.scan, bp: x.bp }))), h: pts.reduce((a, x) => a + (heightOf.get(x.scan) ?? 0), 0) });
    let m: { scan: number; bp: number }[];
    if (n === 1) m = [{ scan: [...cand].sort((a, b) => b.height - a.height)[0].size, bp: nominal[0] }];
    else if (n === 2) {
      // two alleles (amelogenin X/Y): the pair whose spacing is closest to nominal, then the tallest
      let best: { i: number; j: number; cost: number } | null = null;
      const d = nominal[1] - nominal[0];
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        const err = Math.abs(cand[j].size - cand[i].size - d);
        if (err > Math.max(1.5, 0.3 * d)) continue;
        const cost = err - 1e-4 * (cand[i].height + cand[j].height) / Math.max(1, med);
        if (!best || cost < best.cost) best = { i, j, cost };
      }
      m = best ? [{ scan: cand[best.i].size, bp: nominal[0] }, { scan: cand[best.j].size, bp: nominal[1] }] : [];
    } else m = matchLadder(cand.map((p) => p.size), nominal);
    if (n > 2) {
      for (let lead = 0; lead <= 2; lead++) for (let trail = 0; trail <= 2; trail++) {
        if (!lead && !trail) continue;
        const sub = cand.slice(lead, cand.length - trail);
        if (sub.length < 2) continue;
        const alt = matchLadder(sub.map((p) => p.size), nominal);
        const a = score(alt);
        const b = score(m);
        if (a.len > b.len || (a.len === b.len && (a.rough < b.rough - 0.01 || (Math.abs(a.rough - b.rough) <= 0.01 && a.h > b.h)))) m = alt;
      }
    }
    const byBp = new Map(mk.ladder.map((a) => [a.bp, a.name]));
    // amelogenin: OSIRIS numbers X and Y as 1 and 2
    const amel = /^amel/i.test(mk.name);
    bins[mk.name] = m.map((x) => { const nm = byBp.get(x.bp) ?? '?'; return { name: amel ? ({ 1: 'X', 2: 'Y' } as Record<string, string>)[nm] ?? nm : nm, size: x.scan, nominal: x.bp }; });
    if (m.length < n) problems.push(`${mk.name}: ${n - m.length} of ${n} ladder alleles not found`);
    const offs = m.map((x) => x.scan - x.bp);
    const jump = Math.max(0, ...offs.slice(1).map((o, i) => Math.abs(o - offs[i])));
    if (jump > Math.max(1.5, mk.repeat * 0.4)) problems.push(`${mk.name}: ladder spacing irregular (offset jumps ${jump.toFixed(1)} bp): check the ladder`);
  }
  return { bins, problems };
}

/** Averages ladder bins from several ladder runs. */
export function averageBins(all: LadderBins[]): LadderBins {
  const out: LadderBins = {};
  for (const b of all) for (const [mk, list] of Object.entries(b)) {
    const cur = out[mk] ?? [];
    for (const x of list) { const c = cur.find((y) => y.name === x.name); if (c) (c as LadderBin & { n?: number }).n = ((c as LadderBin & { n?: number }).n ?? 1) + 1, c.size += x.size; else cur.push({ ...x }); }
    out[mk] = cur;
  }
  for (const list of Object.values(out)) for (const c of list as (LadderBin & { n?: number })[]) { c.size /= c.n ?? 1; delete c.n; }
  return out;
}

/**
 * Allele designation of a sized peak from the ladder bins: the ladder allele within ±`window` bp,
 * or 'OL' (off-ladder). `variant` suggests a designation for an off-ladder peak (e.g. 9.3) from
 * the nearest ladder allele and the repeat length.
 */
export function nameAllele(size: number, bins: LadderBin[], repeat: number, window = 0.5): { name: string; variant?: string } {
  if (!bins.length) return { name: 'OL' };
  const near = bins.reduce((b, x) => (Math.abs(x.size - size) < Math.abs(b.size - size) ? x : b));
  if (Math.abs(near.size - size) <= window) return { name: near.name };
  const m = /^(\d+)(?:\.(\d))?$/.exec(near.name);
  if (!m) return { name: 'OL' };
  // length in bases relative to the nearest ladder allele: "9.3" = 9 repeats + 3 bases
  const bases = Number(m[1]) * repeat + Number(m[2] ?? 0) + Math.round(size - near.size);
  const whole = Math.floor(bases / repeat);
  const rest = bases - whole * repeat;
  return { name: 'OL', variant: rest ? `${whole}.${rest}` : `${whole}` };
}

/**
 * "name, dye, min, max, repeat" per line (CSV or tab); '#' lines are comments. An OSIRIS kit
 * XML (LadderInfo) is also accepted, with its ladder alleles (`kitName` picks the kit).
 */
export function parsePanel(textIn: string, kitName = ''): Marker[] {
  if (textIn.trim().startsWith('<')) {
    const kits = parseKitXml(textIn);
    const k = kits.find((x) => kitName && x.name.toLowerCase() === kitName.toLowerCase()) ?? kits[0];
    return k.markers;
  }
  return textIn.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const c = l.split(/[,\t;]/).map((x) => x.trim());
    const [name, dye, a, b, r] = c;
    const minBp = Number(a);
    const maxBp = Number(b);
    if (!name || !dye || !Number.isFinite(minBp) || !Number.isFinite(maxBp) || maxBp <= minBp) throw new Error(`Panel line "${l}": expected name, dye, min bp, max bp, repeat.`);
    return { name, dye, minBp, maxBp, repeat: Math.max(1, Number(r) || 2) };
  });
}

/** Scans of off-scale peaks in each channel (pull-up sources). */
export function saturatedScans(trace: FragmentTrace, exceptDye?: string): number[] {
  return trace.channels.filter((c) => c.dye !== exceptDye).flatMap((c) => findPeaks(c.data, SATURATION / 2).filter((p) => p.saturated).map((p) => p.scan));
}

export interface CleanPeak { size: number; scan: number; height: number; saturated: boolean }

/**
 * Peaks of one dye with artefacts removed:
 *  - pull-up: within ±`pullUpScans` of a peak in another dye that is off-scale or at least
 *    `pullUpRatio` times taller (spectral bleed-through), unless this peak is itself off-scale;
 *  - split / +A peaks: within `mergeBp` of a taller peak of the same dye.
 */
export function cleanPeaks(trace: FragmentTrace, dye: string, sizing: Sizing, minHeight: number, o = { pullUpScans: 2.5, pullUpRatio: 4, mergeBp: 1.2 }): CleanPeak[] {
  const ch = trace.channels.find((c) => c.dye === dye);
  if (!ch) return [];
  const others = trace.channels.filter((c) => c !== ch).map((c) => findPeaks(c.data, minHeight));
  const own = findPeaks(ch.data, minHeight)
    .filter((p) => p.saturated || !others.some((list) => list.some((q) => Math.abs(q.scan - p.scan) <= o.pullUpScans && (q.saturated || q.height >= o.pullUpRatio * p.height))))
    .map((p) => ({ size: scanToBp(sizing, p.scan), scan: p.scan, height: p.height, saturated: !!p.saturated }));
  // split peaks (< 0.5 bp apart) merge into the taller one; a peak up to mergeBp from one at least
  // twice its height is its −A / +A shoulder. Two similar peaks 1 bp apart (TH01 9.3 / 10) stay.
  const dominated = (p: CleanPeak, q: CleanPeak) => q.height > p.height || (q.height === p.height && q.scan < p.scan);
  return own.filter((p) => !own.some((q) => q !== p && dominated(p, q) && (Math.abs(q.size - p.size) < 0.5 || (Math.abs(q.size - p.size) <= o.mergeBp && q.height >= 2 * p.height))));
}

export function callAlleles(trace: FragmentTrace, sizing: Sizing, markers: Marker[], o: { minHeight: number; stutterPct: number; balancePct: number }, bins?: LadderBins): MarkerCall[] {
  return markers.map((mk) => {
    const ch = markerChannel(trace, mk.dye);
    if (!ch) return { marker: mk.name, dye: mk.dye, alleles: [], peaks: 0, note: `Dye "${mk.dye}" is not in this run (${trace.channels.map((c) => c.dye).join(', ')}).` };
    const lb = bins?.[mk.name];
    // with a ladder, the marker range moves with the observed ladder (kit sizes are approximate)
    let lo = mk.minBp;
    let hi = mk.maxBp;
    if (lb?.length && mk.ladder?.length) {
      const nominalOf = (b: LadderBin) => b.nominal ?? mk.ladder!.find((a) => a.name === b.name)?.bp;
      const first = nominalOf(lb[0]);
      const last = nominalOf(lb[lb.length - 1]);
      // (± a bin width: kit ranges often end exactly at the end alleles)
      if (first !== undefined) lo += lb[0].size - first - 0.6;
      if (last !== undefined) hi += lb[lb.length - 1].size - last + 0.6;
      // kit ranges can reach into a neighbouring marker of the same dye: stay within a few
      // repeats of the ladder
      lo = Math.max(lo, lb[0].size - 3 * mk.repeat - 1);
      hi = Math.min(hi, lb[lb.length - 1].size + 3 * mk.repeat + 1);
    }
    const peaks = cleanPeaks(trace, ch.dye, sizing, o.minHeight).filter((p) => p.size >= lo && p.size <= hi);
    // stutter: a peak one repeat shorter than a taller peak, below stutterPct of it
    const kept = peaks.filter((p) => !peaks.some((q) => q.height > p.height && Math.abs(q.size - mk.repeat - p.size) <= 0.6 * Math.min(1, mk.repeat / 2) + 0.4 && p.height < (o.stutterPct / 100) * q.height));
    const sorted = [...kept].sort((a, b) => b.height - a.height);
    if (!sorted.length) return { marker: mk.name, dye: mk.dye, alleles: [], peaks: peaks.length, note: 'No peak above the threshold in the marker range.' };
    const alleles = [sorted[0]];
    if (sorted[1] && sorted[1].height >= (o.balancePct / 100) * sorted[0].height) alleles.push(sorted[1]);
    const extra = sorted.slice(2).filter((p) => p.height >= (o.balancePct / 100) * sorted[0].height).length;
    const off = alleles.some((a) => a.saturated);
    const note = [
      extra ? `${extra} more peak${extra === 1 ? '' : 's'} above the balance threshold (mixture or artefacts?)` : alleles.length === 1 ? 'homozygous (one allele)' : 'heterozygous',
      ...(off ? ['off-scale peak: size less precise, consider re-running with less product'] : []),
    ].join('; ');
    const named = alleles.sort((a, b) => a.size - b.size).map((a) => {
      if (!lb?.length) return { size: a.size, height: a.height };
      const n = nameAllele(a.size, lb, mk.repeat);
      return { size: a.size, height: a.height, name: n.name };
    });
    const ol = lb?.length ? named.filter((a) => a.name === 'OL').map((a) => { const v = nameAllele(a.size, lb, mk.repeat).variant; return `${a.size.toFixed(1)} bp${v ? ` (≈ ${v})` : ''}`; }) : [];
    return { marker: mk.name, dye: ch.dye, alleles: named, peaks: peaks.length, note: ol.length ? `${note}; off-ladder: ${ol.join(', ')}` : note };
  });
}

/** Display colour for common fragment-analysis dyes. */
export function dyeColor(dye: string, i: number): string {
  const d = dye.toUpperCase();
  if (/FAM|BLUE/.test(d)) return '#2f7de1';
  if (/VIC|HEX|JOE|GREEN/.test(d)) return '#1f9d55';
  if (/NED|TAMRA|YELLOW|ATTO/.test(d)) return '#c7a514';
  if (/PET|ROX|RED/.test(d)) return '#d14343';
  if (/LIZ|ORANGE/.test(d)) return '#ee7d20';
  return ['#2f7de1', '#1f9d55', '#c7a514', '#d14343', '#ee7d20'][i % 5];
}

/**
 * Simulated capillary run for examples and tests (clearly labelled as simulated): curved
 * mobility, Gaussian peaks, primer flare and noise. FAM: D1S80-like 152/158 bp with stutter;
 * VIC: TH01-like homozygote at 172 bp; NED: vWA-like 182/190 bp; LIZ: the size standard.
 */
export function simulateFragmentRun(standard: number[], seed = 3, alleles?: { fam?: [number, number]; vic?: number; ned?: [number, number] }) {
  const N = 9000;
  const scanOf = (bp: number) => 1500 + 11 * bp - 0.003 * bp * bp;
  let x = seed;
  const noise = () => { x = (x * 1103515245 + 12345) % 2147483648; return ((x >>> 16) % 21) - 10; };
  const channel = (peaks: [number, number][], flare = true) => Array.from({ length: N }, (_, i) => {
    let v = 60 + noise();
    for (const [bp, h] of peaks) { const d = i - scanOf(bp); v += h * Math.exp(-(d * d) / (2 * 3.5 * 3.5)); }
    if (flare && i > 300 && i < 700) v += 6000 * Math.exp(-((i - 450) ** 2) / (2 * 60 * 60));
    return Math.max(0, Math.round(v));
  });
  const [f1, f2] = alleles?.fam ?? [152, 158];
  const v1 = alleles?.vic ?? 172;
  const [n1, n2] = alleles?.ned ?? [182, 190];
  const fam = channel([[f1, 3000], [f2, 2600], [f1 - 2, 350], [f2 - 2, 300]]);
  const vic = channel([[v1, 2000], [v1 - 4, 300]]);
  const ned = channel([[n1, 1500], [n2, 1300], [n1 - 4, 200], [n2 - 4, 180]]);
  const liz = channel(standard.map((bp) => [bp, 700] as [number, number]));
  return { N, scanOf, channels: [{ dye: '6-FAM', data: fam }, { dye: 'VIC', data: vic }, { dye: 'NED', data: ned }, { dye: 'LIZ', data: liz }] };
}
