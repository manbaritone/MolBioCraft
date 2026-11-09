// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { analyzeEditing, findGuide, nnls, peakProportions } from '../core/crisprEditing';
import type { ChromatogramData } from '../types/bio';

const control = SAMPLE_LIBRARY.find((d) => d.id === 'doc-sanger-ab1-fwd')!.chromatogram!;

/** Edited trace: mixture of control shifted by each indel after `cut`, then `shift` leading peaks removed. */
function simulate(mix: Record<number, number>, cut: number, shift = 0): ChromatogramData {
  const P = peakProportions(control);
  const n = P.length;
  const props = P.map((p, j) => {
    if (j < cut) return p;
    const out = [0, 0, 0, 0];
    for (const [d, w] of Object.entries(mix)) {
      const src = P[j - Number(d)] ?? [0.25, 0.25, 0.25, 0.25];
      for (let c = 0; c < 4; c++) out[c] += w * src[c];
    }
    return out;
  }).slice(shift);
  const peaks = props.map((_, j) => j * 10 + 5);
  const len = n * 10 + 10;
  const ch = (c: number) => { const t = new Array<number>(len).fill(0); props.forEach((p, j) => { t[peaks[j]] = Math.round(1000 * p[c]); }); return t; };
  const calls = props.map((p) => 'ACGT'[p.indexOf(Math.max(...p))]).join('');
  return { traceA: ch(0), traceC: ch(1), traceG: ch(2), traceT: ch(3), peakLocations: peaks, phredScores: peaks.map(() => 40), baseCalls: calls };
}

describe('CRISPR editing analysis', () => {
  it('NNLS recovers a non-negative mixture', () => {
    const A = [[1, 0, 0.5], [0, 1, 0.5], [1, 1, 0], [0.2, 0, 1]];
    const x = [0.7, 0.2, 0.1];
    const b = A.map((r) => r.reduce((s, a, j) => s + a * x[j], 0));
    nnls(A, b).forEach((v, i) => expect(v).toBeCloseTo(x[i], 6));
  });
  it('finds a guide on either strand and places the cut 3 bp from the PAM', () => {
    const seq = 'AAAAACCCCCGGGGGTTTTTACGTAGG' + 'T'.repeat(30);
    const g = findGuide(seq, 'ACCCCCGGGGGTTTTTACGT');
    expect(g!.strand).toBe(1);
    expect(g!.cut).toBe(4 + 20 - 3);
    expect(g!.pam).toBe('AGG');
    const rcSeq = [...seq].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' } as Record<string, string>)[c]).join('');
    const g2 = findGuide(rcSeq, 'ACCCCCGGGGGTTTTTACGT');
    expect(g2!.strand).toBe(-1);
    expect(g2!.pam).toBe('AGG');
  });
  it('recovers a simulated 60% WT / 30% −2 / 10% +1 mixture, with an offset edited read', () => {
    const cut = 150;
    const edited = simulate({ 0: 0.6, [-2]: 0.3, 1: 0.1 }, cut, 3);
    const r = analyzeEditing(control, edited, { guide: '', cutIndex: cut, maxIndel: 10, window: 100 });
    expect(r.offset).toBe(-3);
    const pct = (d: number) => r.spectrum.find((x) => x.indel === d)?.pct ?? 0;
    expect(pct(0)).toBeCloseTo(60, 0);
    expect(pct(-2)).toBeCloseTo(30, 0);
    expect(pct(1)).toBeCloseTo(10, 0);
    expect(r.efficiencyPct).toBeCloseTo(40, 0);
    expect(r.rSquared).toBeGreaterThan(0.99);
    expect(r.aberrantAfterPct).toBeGreaterThan(r.aberrantBeforePct + 10);
  });
  it('an unedited trace gives ~100% wild type', () => {
    const r = analyzeEditing(control, simulate({ 0: 1 }, 150), { guide: '', cutIndex: 150, maxIndel: 10, window: 100 });
    expect(r.efficiencyPct).toBeLessThan(1);
  });
});
