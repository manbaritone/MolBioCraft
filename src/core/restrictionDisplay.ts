// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { RestrictionCutSite } from '../types/bio';
import { complementAligned } from './alignmentViewModel';

/**
 * A restriction site is numbered by the last top-strand base *before* the cut
 * (pUC19: "EcoRI (396)" for G^AATTC starting at 396). The engine's `cutTop` is the 1-based first
 * base *after* the cut, so the displayed number is one less (wrapping to the sequence length when
 * a circular molecule is cut before base 1). A linear molecule has no wrap (BG-01M7CDM1): the engine
 * reports a cut after its last base as `seqLen + 1`, numbered `seqLen`, and a cut before base 1 as
 * 1, numbered 0 (no base precedes it).
 */
export function cutSiteDisplayPosition(cutTop: number, seqLen: number, circular = true): number {
  if (cutTop > 1) return cutTop - 1;
  return circular ? seqLen : 0;
}

/** One strand's cut in a {@link CleavagePicture}. */
export interface CleavageCut {
  /** The cut as a 0-based boundary into the window: it falls between columns `boundary - 1` and `boundary`. */
  boundary: number;
  /**
   * Whether the cut lies in the molecule: always true, since the engine reports no linear site whose
   * cut falls past an end and a circle has no end. Kept for the sequence view's cut marks.
   */
  available: boolean;
  /**
   * The 1-based last base before the cut, the number the site list shows (as {@link cutSiteDisplayPosition});
   * null for a cut before base 1 of a linear molecule, which no base precedes.
   */
  position: number | null;
  /** The 1-based first base after the cut (the engine's `cutTop` / `cutBottom`); null after a linear molecule's last base, which no base follows. */
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
  /** The top-strand bases between the two cuts, 5'->3' ('' for a blunt end). */
  overhangSeq: string;
  typeIIS: boolean;
  /**
   * Whether the motif or the overhang between the cuts runs across the junction of the last base
   * and base 1 of a circular molecule. A cut exactly at that junction, with the motif and overhang
   * on one side of it, sits on the origin without crossing it: false.
   */
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
 * The engine's cuts of `site` as unwrapped 0-based boundaries `{ top, bottom }`.
 *
 * On a linear molecule each is the engine's `cut - 1`: the engine never wraps a linear cut, so a cut
 * before base 1 is 1 and one after the last base is len + 1 (BG-01M7CDM1).
 *
 * On a circle the engine gives each cut modulo the length, which loses the turn it lies on. The
 * picture takes the pair as the engine's own record fixes it: the top cut, the bottom cut `d` bases
 * after it for a 5' end, before it for a 3' end (`d` the length of the engine's overhang), on the
 * side the enzyme cuts: a forward site cuts at or after its motif start and a reverse site at or
 * before its motif end (every catalogue enzyme's offsets are >= 0 on its recognition strand). It
 * places the pair on the nearest turn that side, which is right whenever the cut nearer the motif
 * lies less than one molecule length from it: a circle shorter than that is drawn on the wrong turn.
 * A circular record whose cuts disagree with its own overhang is refused with an error naming it.
 */
function unwrapCuts(
  site: RestrictionCutSite,
  len: number,
  motifStart: number,
  motifEnd: number,
  circular: boolean
): { top: number; bottom: number } {
  if (!circular) return { top: site.cutTop - 1, bottom: site.cutBottom - 1 };
  return unwrapCircularCuts(site, len, motifStart, motifEnd);
}

/** {@link unwrapCuts} on a circle. */
function unwrapCircularCuts(site: RestrictionCutSite, len: number, motifStart: number, motifEnd: number) {
  const d = site.overhangSeq.length;
  const diff = site.overhangType === '5prime' ? d : site.overhangType === '3prime' ? -d : 0;
  if (mod(site.cutTop - 1 + diff - (site.cutBottom - 1), len) !== 0) {
    throw new Error(`cleavagePicture: ${site.id}'s cuts ${site.cutTop}/${site.cutBottom} disagree with its ${site.overhangType} ${d}-nt overhang`);
  }
  const nearer = site.strand === 1 ? Math.min(0, diff) : Math.max(0, diff);
  const anchor = site.cutTop - 1 + nearer;
  const placed = site.strand === 1 ? motifStart + mod(anchor - motifStart, len) : motifEnd - mod(motifEnd - anchor, len);
  const top = placed - nearer;
  return { top, bottom: top + diff };
}

/**
 * The two-strand cleavage picture of `site` on `sequence` (the molecule it was scanned on), with
 * `flank` bases shown beyond the motif and both cuts. It reads the cuts from the engine's record
 * (`cutTop`/`cutBottom`, and on a circle the overhang that fixes their turn) and never recomputes
 * them from the enzyme; it only lays them out, wrapping
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
  if (len === 0) throw new Error(`cleavagePicture: ${site.id} has no sequence to draw`);
  const { top: topRaw, bottom: bottomRaw } = unwrapCuts(site, len, motifStart, motifEnd, circular);
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

  // A linear molecule's cut before base 1 has no base before it, and one after its last base none after.
  const cut = (raw: number): CleavageCut => ({
    boundary: raw - lo,
    available: true,
    position: circular ? cutSiteDisplayPosition(mod(raw, len) + 1, len, true) : raw > 0 ? raw : null,
    firstBaseAfter: circular ? mod(raw, len) + 1 : raw < len ? raw + 1 : null,
    gapFromMotif: distanceToMotif(raw, motifStart, motifEnd),
  });
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
    overhangSeq: overhang,
    typeIIS: site.enzyme.isTypeIIS ?? false,
    crossesOrigin: circular && (spanLo < 0 || spanHi > len),
    unavailableFlank: circular ? { left: 0, right: 0 } : { left: Math.max(0, -lo), right: Math.max(0, hi - len) },
    cleavage: site.methylationBlocked ? 'methylation-blocked' : 'cuts',
  };
}
