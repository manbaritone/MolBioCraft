// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Geometry for drawing a predicted nucleic-acid secondary structure the way the fold engine
 * actually predicted it. Everything here is derived from the Vienna dot-bracket string and the
 * hairpin coordinates the engine returns, so a picture can never show a stem or loop that the
 * prediction does not contain.
 */

import type { SecondaryStructureStemLoop } from '../types/bio';

/** Longest sequence the fold engine folds; a longer one is folded over its first FOLD_CAP_NT. */
export const FOLD_CAP_NT = 600;

/**
 * Folding temperatures offered in the fold tab. Every loop energy is re-derived from its
 * enthalpy at the chosen one, so these are real predictions rather than the 37 degree fold
 * relabelled: ice-bath and room temperature for handling, 37 for physiology, and the range a
 * thermocycler or a structure-probing experiment works over.
 */
export const FOLD_TEMPERATURES_C = [4, 15, 20, 25, 30, 37, 42, 50, 55, 60, 65, 70, 80, 95] as const;

/**
 * The share of the ensemble one structure holds, as a percentage a reader can take in. A short
 * hairpin's best structure is most of its ensemble, while a kilobase of mRNA has so many ways to
 * fold that its best one is a vanishing fraction of them — so below a hundredth of a percent the
 * number is written as a power of ten rather than rounded away to zero.
 */
export function formatEnsembleShare(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '0%';
  const pct = fraction * 100;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  let exponent = Math.floor(Math.log10(pct));
  let mantissa = pct / 10 ** exponent;
  if (Number(mantissa.toFixed(1)) >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  const superscript = String(exponent).replace('-', '\u207b').replace(/[0-9]/g, (d) => '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079'[Number(d)]);
  return `${mantissa.toFixed(1)} \u00d7 10${superscript}%`;
}

/**
 * Partner table for a dot-bracket string: `partner[i]` is the 0-based index paired with `i`, or
 * null when `i` is unpaired. Unbalanced brackets are ignored rather than thrown, so a malformed
 * string degrades to "fewer pairs" instead of an empty diagram.
 */
export function pairPartners(dotBracket: string): (number | null)[] {
  const partner: (number | null)[] = new Array(dotBracket.length).fill(null);
  const stack: number[] = [];
  for (let i = 0; i < dotBracket.length; i++) {
    const c = dotBracket[i];
    if (c === '(') {
      stack.push(i);
    } else if (c === ')') {
      const j = stack.pop();
      if (j !== undefined) {
        partner[i] = j;
        partner[j] = i;
      }
    }
  }
  return partner;
}

/** The base pairs of a dot-bracket string as 0-based `[i, j]` with `i < j`, in order of `i`. */
export function basePairs(dotBracket: string): Array<[number, number]> {
  const partner = pairPartners(dotBracket);
  const pairs: Array<[number, number]> = [];
  partner.forEach((j, i) => {
    if (j !== null && j > i) pairs.push([i, j]);
  });
  return pairs;
}

export interface ArcDiagram {
  width: number;
  height: number;
  /** Baseline (the backbone) in diagram coordinates. */
  baselineY: number;
  x0: number;
  x1: number;
  /** One semicircular arc per base pair, longest span first so short arcs stay on top. */
  arcs: Array<{ d: string; i: number; j: number; span: number }>;
  /** Maps a 1-based sequence position to its x coordinate. */
  xOf: (pos1: number) => number;
}

/**
 * Arc diagram of a whole fold: the sequence as a horizontal backbone, each base pair as a
 * semicircle above it. The arc heights are proportional to the real span of each pair, so nested
 * hairpins and long-range pairs read correctly at any sequence length.
 */
export function arcDiagram(
  dotBracket: string,
  opts: { width?: number; height?: number; padX?: number; padTop?: number; baselinePad?: number } = {}
): ArcDiagram {
  const width = opts.width ?? 520;
  const height = opts.height ?? 180;
  const padX = opts.padX ?? 28;
  const padTop = opts.padTop ?? 10;
  const baselinePad = opts.baselinePad ?? 26;
  const n = Math.max(dotBracket.length, 1);
  const x0 = padX;
  const x1 = width - padX;
  const baselineY = height - baselinePad;
  // positions sit at base centres, so a 1-nt sequence still lands inside the frame
  const xOf = (pos1: number) => x0 + ((pos1 - 0.5) / n) * (x1 - x0);

  const pairs = basePairs(dotBracket);
  const maxSpan = pairs.reduce((m, [i, j]) => Math.max(m, j - i), 1);
  const maxArcH = baselineY - padTop;

  const arcs = pairs
    .map(([i, j]) => {
      const span = j - i;
      const xa = xOf(i + 1);
      const xb = xOf(j + 1);
      // height grows with the square root of the span: long-range pairs stay inside the frame
      // while short hairpin arcs remain tall enough to tell apart
      const h = maxArcH * Math.sqrt(span / maxSpan);
      const d = `M ${xa.toFixed(2)} ${baselineY} C ${xa.toFixed(2)} ${(baselineY - h).toFixed(2)}, ${xb.toFixed(2)} ${(baselineY - h).toFixed(2)}, ${xb.toFixed(2)} ${baselineY}`;
      return { d, i, j, span };
    })
    .sort((a, b) => b.span - a.span);

  return { width, height, baselineY, x0, x1, arcs, xOf };
}

export interface StemLoopGeometry {
  width: number;
  height: number;
  /** Rungs of the stem, bottom-most first, each carrying its real base pair. */
  rungs: Array<{ y: number; x5: number; x3: number; base5: string; base3: string; pos5: number; pos3: number }>;
  /** Loop bases placed around the apical circle, in 5'->3' order. */
  loopBases: Array<{ x: number; y: number; base: string; pos: number }>;
  loopCx: number;
  loopCy: number;
  loopR: number;
  /** Where the two backbone strands leave the stem towards the rest of the molecule. */
  footY: number;
  foot5X: number;
  foot3X: number;
}

/**
 * True-to-prediction drawing of one hairpin: one rung per base pair of the stem (not a fixed
 * number), and an apical loop whose circle is sized so its real nucleotides sit one pitch apart
 * around it. A 3 bp stem with a 4 nt loop and a 9 bp stem with a 21 nt loop therefore look
 * different, which is the whole point of drawing it.
 */
export function stemLoopGeometry(
  sl: SecondaryStructureStemLoop,
  opts: { pitch?: number; rungWidth?: number; padTop?: number; footPad?: number } = {}
): StemLoopGeometry {
  const pitch = opts.pitch ?? 17;
  const padTop = opts.padTop ?? 16;
  const footPad = opts.footPad ?? 26;

  const stemBp = Math.max(sl.stemLengthBp, 1);
  const loopNt = Math.max(sl.loopLengthNt, 1);
  // the closing pair counts as two of the points around the loop circle, one pitch apart like the
  // loop nucleotides, which fixes the circle's radius
  const around = loopNt + 2;
  const step = (2 * Math.PI) / around;
  const loopR = pitch / (2 * Math.sin(step / 2));
  // the stem is exactly as wide as the closing pair's two slots on that circle
  const rungWidth = opts.rungWidth ?? 2 * loopR * Math.sin(step / 2);

  const cx = loopR + pitch;
  const loopCy = padTop + loopR;
  const stemTopY = loopCy + loopR * Math.cos(step / 2);
  const height = stemTopY + (stemBp - 1) * pitch + footPad;
  const width = 2 * cx;

  const top5 = sl.topStemSeq.toUpperCase();
  // the 3' stem strand is written 5'->3', so its pairing partner for rung k is read from the end
  const bot3 = sl.bottomStemSeq.toUpperCase();
  const x5 = cx - rungWidth / 2;
  const x3 = cx + rungWidth / 2;

  // k = 0 is the outermost rung at the foot of the stem; the last is the closing pair that holds
  // the apical loop, which is the one the loop geometry below joins onto.
  const rungs = Array.from({ length: stemBp }, (_, k) => {
    const depthFromLoop = stemBp - 1 - k;
    return {
      y: stemTopY + depthFromLoop * pitch,
      x5,
      x3,
      base5: top5[k] ?? '',
      base3: bot3[depthFromLoop] ?? '',
      pos5: sl.stemStart5 + k,
      pos3: sl.stemEnd3 - k,
    };
  });

  // The closing pair occupies the two slots at the bottom of the circle; the loop nucleotides fill
  // the rest, walking from the 5' side over the apex to the 3' side.
  // Angles run anticlockwise on screen from the 5' closing base at the bottom left, over the apex,
  // to the 3' closing base at the bottom right, so position order matches the drawn order.
  const loopSeq = sl.loopSeq.toUpperCase();
  const startAngle = -Math.PI / 2 + 1.5 * step;
  const loopBases = Array.from({ length: loopNt }, (_, k) => {
    const angle = startAngle + step * k;
    return {
      x: cx - loopR * Math.cos(angle),
      y: loopCy - loopR * Math.sin(angle),
      base: loopSeq[k] ?? '',
      pos: sl.loopStart + k,
    };
  });

  return {
    width,
    height,
    rungs,
    loopBases,
    loopCx: cx,
    loopCy,
    loopR,
    footY: height - footPad / 2,
    foot5X: x5,
    foot3X: x3,
  };
}

/** Watson-Crick / wobble class of a pair, for colouring rungs by how strongly they hold. */
export function pairClass(a: string, b: string): 'GC' | 'AU' | 'GU' | 'other' {
  const k = [a.toUpperCase().replace('T', 'U'), b.toUpperCase().replace('T', 'U')].sort().join('');
  if (k === 'CG') return 'GC';
  if (k === 'AU') return 'AU';
  if (k === 'GU') return 'GU';
  return 'other';
}
