// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { arcDiagram, basePairs, pairClass, pairPartners, stemLoopGeometry } from '../core/nucleicFold';
import type { SecondaryStructureStemLoop } from '../types/bio';

const hairpin = (over: Partial<SecondaryStructureStemLoop> = {}): SecondaryStructureStemLoop => ({
  id: 'sl-1',
  stemStart5: 1,
  stemEnd5: 4,
  loopStart: 5,
  loopEnd: 10,
  stemStart3: 11,
  stemEnd3: 14,
  stemLengthBp: 4,
  loopLengthNt: 6,
  deltaGKcalMol: -3.4,
  topStemSeq: 'GGCA',
  loopSeq: 'TTTTAA',
  bottomStemSeq: 'TGCC',
  ...over,
});

describe('pairPartners / basePairs', () => {
  it('pairs matching brackets and leaves dots unpaired', () => {
    const p = pairPartners('((..))');
    expect(p).toEqual([5, 4, null, null, 1, 0]);
    expect(basePairs('((..))')).toEqual([
      [0, 5],
      [1, 4],
    ]);
  });

  it('keeps the valid pairs of an unbalanced string instead of throwing', () => {
    expect(basePairs('(((..)')).toEqual([[2, 5]]);
    expect(basePairs('(..))')).toEqual([[0, 3]]);
  });

  it('handles two separate hairpins', () => {
    expect(basePairs('((..))((..))')).toEqual([
      [0, 5],
      [1, 4],
      [6, 11],
      [7, 10],
    ]);
  });
});

describe('arcDiagram', () => {
  it('draws one arc per base pair, longest span first', () => {
    const d = arcDiagram('((..))((..))');
    expect(d.arcs).toHaveLength(4);
    expect(d.arcs.map((a) => a.span)).toEqual([5, 5, 3, 3]);
  });

  it('keeps every arc inside the frame and anchored on the backbone', () => {
    const d = arcDiagram('(((((.....)))))', { width: 400, height: 150 });
    expect(d.arcs).toHaveLength(5);
    for (const a of d.arcs) {
      const ys = [...a.d.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number).filter((_, i) => i % 2 === 1);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(d.baselineY + 0.01);
    }
  });

  it('places positions in order across the backbone', () => {
    const d = arcDiagram('..........', { width: 300 });
    expect(d.xOf(1)).toBeGreaterThan(d.x0);
    expect(d.xOf(10)).toBeLessThan(d.x1);
    expect(d.xOf(10)).toBeGreaterThan(d.xOf(1));
  });

  it('survives an unfolded sequence with no pairs', () => {
    const d = arcDiagram('.....');
    expect(d.arcs).toEqual([]);
    expect(Number.isFinite(d.xOf(3))).toBe(true);
  });
});

describe('stemLoopGeometry', () => {
  it('draws one rung per predicted base pair, not a fixed number', () => {
    expect(stemLoopGeometry(hairpin({ stemLengthBp: 4 })).rungs).toHaveLength(4);
    expect(
      stemLoopGeometry(hairpin({ stemLengthBp: 9, topStemSeq: 'GGCAGGCAG', bottomStemSeq: 'CTGCCTGCC' })).rungs
    ).toHaveLength(9);
  });

  it('pairs each rung with the real bases and positions of that pair', () => {
    const g = stemLoopGeometry(hairpin());
    // positions 1..4 pair with 14..11, so the rungs run G:C, G:C, C:G, and the A:T closing pair
    expect(g.rungs.map((r) => `${r.base5}${r.base3}`)).toEqual(['GC', 'GC', 'CG', 'AT']);
    expect(g.rungs.map((r) => r.pos5)).toEqual([1, 2, 3, 4]);
    expect(g.rungs.map((r) => r.pos3)).toEqual([14, 13, 12, 11]);
  });

  it('places every loop nucleotide on the apical circle in 5-to-3 order', () => {
    const g = stemLoopGeometry(hairpin({ loopLengthNt: 6, loopSeq: 'TTTTAA' }));
    expect(g.loopBases).toHaveLength(6);
    expect(g.loopBases.map((b) => b.base).join('')).toBe('TTTTAA');
    expect(g.loopBases.map((b) => b.pos)).toEqual([5, 6, 7, 8, 9, 10]);
    for (const b of g.loopBases) {
      const r = Math.hypot(b.x - g.loopCx, b.y - g.loopCy);
      expect(r).toBeCloseTo(g.loopR, 6);
    }
    // the first loop base is left of the last one: the strand runs over the apex
    expect(g.loopBases[0].x).toBeLessThan(g.loopBases[5].x);
  });

  it('grows the apical circle with the real loop length', () => {
    const small = stemLoopGeometry(hairpin({ loopLengthNt: 4, loopSeq: 'TTTT' }));
    const big = stemLoopGeometry(hairpin({ loopLengthNt: 21, loopSeq: 'T'.repeat(21) }));
    expect(big.loopR).toBeGreaterThan(small.loopR * 2);
  });

  it('spaces loop nucleotides one pitch apart around the circle', () => {
    const g = stemLoopGeometry(hairpin({ loopLengthNt: 8, loopSeq: 'TTTTTTTT' }), { pitch: 17 });
    for (let k = 1; k < g.loopBases.length; k++) {
      const d = Math.hypot(g.loopBases[k].x - g.loopBases[k - 1].x, g.loopBases[k].y - g.loopBases[k - 1].y);
      expect(d).toBeCloseTo(17, 4);
    }
  });

  it('joins the stem to the loop: the closing rung sits one pitch from both flanking loop bases', () => {
    const g = stemLoopGeometry(hairpin({ loopLengthNt: 7, loopSeq: 'TTTTTTT' }), { pitch: 17 });
    const closing = g.rungs[g.rungs.length - 1];
    const first = g.loopBases[0];
    const last = g.loopBases[g.loopBases.length - 1];
    expect(Math.hypot(first.x - closing.x5, first.y - closing.y)).toBeCloseTo(17, 4);
    expect(Math.hypot(last.x - closing.x3, last.y - closing.y)).toBeCloseTo(17, 4);
  });

  it('keeps the whole drawing inside its reported box', () => {
    const g = stemLoopGeometry(hairpin({ stemLengthBp: 7, topStemSeq: 'GGCAGGC', bottomStemSeq: 'GCCTGCC', loopLengthNt: 12, loopSeq: 'T'.repeat(12) }));
    const xs = [...g.loopBases.map((b) => b.x), ...g.rungs.flatMap((r) => [r.x5, r.x3])];
    const ys = [...g.loopBases.map((b) => b.y), ...g.rungs.map((r) => r.y), g.footY];
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(g.width);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(g.height);
  });
});

describe('pairClass', () => {
  it('classifies Watson-Crick and wobble pairs either way round, for DNA or RNA', () => {
    expect(pairClass('G', 'C')).toBe('GC');
    expect(pairClass('c', 'g')).toBe('GC');
    expect(pairClass('A', 'U')).toBe('AU');
    expect(pairClass('T', 'A')).toBe('AU');
    expect(pairClass('G', 'U')).toBe('GU');
    expect(pairClass('G', 'T')).toBe('GU');
    expect(pairClass('A', 'C')).toBe('other');
  });
});
