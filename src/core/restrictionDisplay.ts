// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { RestrictionCutSite } from '../types/bio';
import { complementAligned } from './alignmentViewModel';

/**
 * A restriction site is numbered by the last top-strand base *before* the cut
 * (pUC19: "EcoRI (396)" for G^AATTC starting at 396). The engine's `cutTop` is the 1-based first
 * base *after* the cut, so the displayed number is one less (wrapping to the sequence length when
 * a circular molecule is cut before base 1).
 */
export function cutSiteDisplayPosition(cutTop: number, seqLen: number, circular = true): number {
  if (cutTop > 1) return cutTop - 1;
  return circular ? seqLen : 0;
}

/** One strand's cut in a {@link CleavagePicture}. */
export interface CleavageCut {
  /** The cut as a 0-based boundary into the window: it falls between columns `boundary - 1` and `boundary`. */
  boundary: number;
  /** False when the cut falls past an end of a linear molecule, where there is no DNA to cut. */
  available: boolean;
  /**
   * The 1-based last base before the cut, the number the site list shows (as {@link cutSiteDisplayPosition},
   * save that a cut after a linear molecule's last base is numbered by that base, not 0); null when unavailable.
   */
  position: number | null;
  /** The 1-based first base after the cut (the engine's `cutTop` / `cutBottom`); null when unavailable or past a linear end. */
  firstBaseAfter: number | null;
  /** Bases between the cut and the nearer edge of the recognition motif; 0 for a cut within or at the edge of it. */
  gapFromMotif: number;
}

/**
 * The two-strand picture of one cut site: the top strand 5'->3' and the bottom strand 3'->5' beneath
 * it over a window around the site, with both cuts placed in it. Columns past an end of a linear
 * molecule are blank (' ') with a null coordinate.
 */
export interface CleavagePicture {
  enzyme: string;
  /** The strand that carries the recognition motif 5'->3': the bottom one for a reverse-strand match. */
  recognitionStrand: 'top' | 'bottom';
  top: string;
  bottom: string;
  /** The 1-based coordinate of each window column; null past an end of a linear molecule. */
  coordinates: (number | null)[];
  /** The recognition motif as boundaries into the window: columns `start` to `end - 1`. */
  motif: { start: number; end: number };
  topCut: CleavageCut;
  bottomCut: CleavageCut;
  endType: RestrictionCutSite['overhangType'];
  overhangLength: number;
  /** The top-strand bases between the two cuts, 5'->3'; null when any of them lies past a linear end. */
  overhangSeq: string | null;
  typeIIS: boolean;
  /** Whether the motif or a cut runs across base 1 of a circular molecule. */
  crossesOrigin: boolean;
  /** How many window columns lie past each end of a linear molecule. */
  unavailableFlank: { left: number; right: number };
  /** A Dam/Dcm-blocked site is not a guaranteed cut. */
  cleavage: 'cuts' | 'methylation-blocked';
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Bases between boundary `b` and the motif `[motifStart, motifEnd]`; 0 within or at its edge. */
const distanceToMotif = (b: number, motifStart: number, motifEnd: number) =>
  b < motifStart ? motifStart - b : b > motifEnd ? b - motifEnd : 0;

/**
 * The engine's 1-based `cut` (first base after the cut, taken modulo the molecule's length) as an
 * unwrapped 0-based boundary: the representative nearest the motif `[motifStart, motifEnd]`.
 */
function unwrapCut(cut: number, seqLen: number, motifStart: number, motifEnd: number): number {
  const distance = (b: number) => distanceToMotif(b, motifStart, motifEnd);
  const k = Math.round((motifStart - (cut - 1)) / seqLen);
  const options = [k - 1, k, k + 1].map((i) => cut - 1 + i * seqLen);
  return options.reduce((best, b) => (distance(b) < distance(best) ? b : best));
}

/**
 * The two-strand cleavage picture of `site` on `sequence` (the molecule it was scanned on), with
 * `flank` bases shown beyond the motif and both cuts. It reads the cuts from the engine's
 * `cutTop`/`cutBottom` and never recomputes them from the enzyme; it only lays them out, wrapping
 * across base 1 of a circular molecule and leaving the flank past a linear end blank.
 */
export function cleavagePicture(
  site: RestrictionCutSite,
  sequence: string,
  circular: boolean,
  flank = 4
): CleavagePicture {
  const len = sequence.length;
  const motifStart = site.position - 1;
  const motifEnd = motifStart + site.enzyme.recognitionSeq.length;
  const topRaw = unwrapCut(site.cutTop, len, motifStart, motifEnd);
  const bottomRaw = unwrapCut(site.cutBottom, len, motifStart, motifEnd);
  const spanLo = Math.min(motifStart, topRaw, bottomRaw);
  const spanHi = Math.max(motifEnd, topRaw, bottomRaw);
  const lo = spanLo - flank;
  const hi = spanHi + flank;

  const inMolecule = (i: number) => circular || (i >= 0 && i < len);
  const coordinates: (number | null)[] = [];
  let top = '';
  for (let i = lo; i < hi; i++) {
    coordinates.push(inMolecule(i) ? mod(i, len) + 1 : null);
    top += inMolecule(i) ? sequence[mod(i, len)] : ' ';
  }

  const gap = (raw: number) => distanceToMotif(raw, motifStart, motifEnd);
  const cut = (raw: number): CleavageCut => {
    if (!circular && (raw < 0 || raw > len)) {
      return { boundary: raw - lo, available: false, position: null, firstBaseAfter: null, gapFromMotif: gap(raw) };
    }
    // A linear molecule's cut after its last base: the engine's cut wraps to 1 there, but no base
    // follows it and the last base before it is the molecule's last, not "before base 1".
    return {
      boundary: raw - lo,
      available: true,
      position: circular ? cutSiteDisplayPosition(mod(raw, len) + 1, len, true) : raw,
      firstBaseAfter: circular ? mod(raw, len) + 1 : raw < len ? raw + 1 : null,
      gapFromMotif: gap(raw),
    };
  };
  const topCut = cut(topRaw);
  const bottomCut = cut(bottomRaw);

  const ohLo = Math.min(topRaw, bottomRaw) - lo;
  const ohHi = Math.max(topRaw, bottomRaw) - lo;
  const overhang = top.slice(ohLo, ohHi);

  return {
    enzyme: site.enzyme.name,
    recognitionStrand: site.strand === -1 ? 'bottom' : 'top',
    top,
    bottom: complementAligned(top),
    coordinates,
    motif: { start: motifStart - lo, end: motifEnd - lo },
    topCut,
    bottomCut,
    endType: topRaw < bottomRaw ? '5prime' : topRaw > bottomRaw ? '3prime' : 'blunt',
    overhangLength: ohHi - ohLo,
    overhangSeq: overhang.includes(' ') ? null : overhang,
    typeIIS: site.enzyme.isTypeIIS ?? false,
    crossesOrigin: circular && (spanLo < 0 || spanHi > len),
    unavailableFlank: circular ? { left: 0, right: 0 } : { left: Math.max(0, -lo), right: Math.max(0, hi - len) },
    cleavage: site.methylationBlocked ? 'methylation-blocked' : 'cuts',
  };
}
