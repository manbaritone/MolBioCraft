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
 * On a circle the engine gives each cut modulo the length, which loses the turn it lies on. The turn
 * is read from the enzyme's signed offsets on the site (`site.enzyme.cutFwd` / `cutRev`, either may
 * be negative, as a custom definition's can be: US-01M7DVY6), measured from the first base of the
 * motif on the strand it was found on: a forward site's cuts lie at motif start + cutFwd (top) and
 * + cutRev (bottom), a reverse site's at motif end - cutRev (top) and - cutFwd (bottom), so a cut
 * before the motif is drawn before it. The offsets only place the engine's cuts on
 * their turn: a circular record whose cuts disagree with its own overhang, or with its enzyme's
 * offsets modulo the length, is refused with an error naming it.
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
  const { cutFwd, cutRev } = site.enzyme;
  const top = site.strand === 1 ? motifStart + cutFwd : motifEnd - cutRev;
  const bottom = site.strand === 1 ? motifStart + cutRev : motifEnd - cutFwd;
  if (mod(top - (site.cutTop - 1), len) !== 0 || mod(bottom - (site.cutBottom - 1), len) !== 0 || bottom - top !== diff) {
    throw new Error(`cleavagePicture: ${site.id}'s cuts ${site.cutTop}/${site.cutBottom} disagree with ${site.enzyme.name}'s offsets ${cutFwd}/${cutRev}`);
  }
  return { top, bottom };
}

/**
 * The two-strand cleavage picture of `site` on `sequence` (the molecule it was scanned on), with
 * `flank` bases shown beyond the motif and both cuts. It reads the cuts from the engine's record
 * (`cutTop`/`cutBottom`); on a circle, where the record gives each cut modulo the length, it reads
 * their turn from the enzyme's signed offsets and refuses a record they do not agree with
 * (`unwrapCuts`). It only lays them out, wrapping across base 1 of a circular molecule and leaving
 * the flank past a linear end blank.
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

/**
 * The revision token of a molecule (US-01M7CC0W): a 53-bit hash of its bases with its topology and
 * length, so the same sequence gives the same token on every scan and any edit, or a change of
 * topology, gives another (up to a hash collision). Bases are hashed as given; the caller passes the
 * sequence the scan read.
 */
export function sequenceRevision(sequence: string, topology: 'circular' | 'linear'): string {
  // cyrb53: two 32-bit lanes mixed into one 53-bit value.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < sequence.length; i++) {
    const ch = sequence.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  return `${topology === 'circular' ? 'c' : 'l'}${sequence.length}.${hash}`;
}

/**
 * The key an enzyme's display choices, site count and unique-cutter judgement are kept under
 * (US-01M7GQZ6): its id, so a custom definition (`custom:<uuid>`) never shares a built-in's of the
 * same name; an enzyme with no id keys by its name. A built-in's id is its catalogue name
 * (US-01M7DV1V), so every built-in key is its name, as it was.
 */
export function enzymeKey(enzyme: { id?: string; name: string }): string {
  return enzyme.id ?? enzyme.name;
}

/**
 * A restriction site's occurrence id: its enzyme's {@link enzymeKey}, 1-based recognition position, strand and the
 * {@link sequenceRevision} of the molecule it was scanned on, never its place in a list. A rescan
 * of the same sequence gives every site the id it had; after an edit every site has a new id, a
 * site that only moved included, so a choice made on one revision never lands on another site.
 */
export function siteOccurrenceId(site: RestrictionCutSite, revision: string): string {
  return `${enzymeKey(site.enzyme)}@${site.position}${site.strand === -1 ? '-' : '+'}#${revision}`;
}

/**
 * Which restriction sites the maps display (US-01M7CC0W): display state only, plain data that
 * serialises as JSON. It never hides a site from the scan or from a digest.
 *
 * Precedence: an occurrence's own choice wins over its enzyme's, so one site can be shown inside a
 * hidden enzyme or hidden inside a shown one; a site with no choice of its own follows its enzyme;
 * an enzyme with no choice is shown. Setting an enzyme's visibility clears its sites' own choices.
 */
export interface SiteVisibility {
  /** The {@link sequenceRevision} the occurrence choices were made on. */
  revision: string;
  /**
   * Enzymes the user hid, by {@link enzymeKey}, sorted; a session saved before enzyme ids names each
   * built-in by its name, which is its id. Enzyme choices outlive edits.
   */
  hiddenEnzymes: string[];
  /** Occurrence choices by {@link siteOccurrenceId}: the site's enzyme (its {@link enzymeKey}) and whether it is shown. */
  occurrences: Record<string, { enzyme: string; shown: boolean }>;
}

/** The state with no choice made: every site shown. */
export function emptySiteVisibility(revision: string): SiteVisibility {
  return { revision, hiddenEnzymes: [], occurrences: {} };
}

/** `state` with the enzyme keyed `enzyme` (its {@link enzymeKey}) shown or hidden and its occurrences' own choices cleared. */
export function setEnzymeVisibility(state: SiteVisibility, enzyme: string, visible: boolean): SiteVisibility {
  const others = state.hiddenEnzymes.filter((n) => n !== enzyme);
  const occurrences = Object.fromEntries(Object.entries(state.occurrences).filter(([, o]) => o.enzyme !== enzyme));
  return { revision: state.revision, hiddenEnzymes: visible ? others : [...others, enzyme].sort(), occurrences };
}

/**
 * `state` with `site` (scanned on `state.revision`) shown or hidden; a choice equal to its enzyme's
 * setting is no choice of its own and is removed.
 */
export function setOccurrenceVisibility(state: SiteVisibility, site: RestrictionCutSite, visible: boolean): SiteVisibility {
  const id = siteOccurrenceId(site, state.revision);
  const key = enzymeKey(site.enzyme);
  const enzymeShown = !state.hiddenEnzymes.includes(key);
  const occurrences = { ...state.occurrences };
  if (visible === enzymeShown) delete occurrences[id];
  else occurrences[id] = { enzyme: key, shown: visible };
  return { revision: state.revision, hiddenEnzymes: [...state.hiddenEnzymes], occurrences };
}

/**
 * The counts of {@link applySiteVisibility}, over the sites it was given: `detected` all of them,
 * `eligible` those the unique-cutter filter admits, of which the user hid `hiddenByUser` and the
 * rest are `shown` (so `shown + hiddenByUser = eligible <= detected`).
 */
export interface SiteVisibilityCounts {
  detected: number;
  eligible: number;
  hiddenByUser: number;
  shown: number;
}

/**
 * The sites of `sites` (a scan of the molecule whose revision is `revision`) the maps display, as a
 * new array in scan order, with its counts. It reads `sites` and `state` and changes neither.
 * With `uniqueCuttersOnly`, only an enzyme cutting once is eligible, by `siteCounts` (the scan's
 * complete counts by {@link enzymeKey}) when given, else by its sites in `sites`; the filter limits what is
 * shown and leaves every choice in `state` as it was. An occurrence choice made on another revision
 * matches no site here.
 */
export function applySiteVisibility(
  sites: readonly RestrictionCutSite[],
  revision: string,
  state: SiteVisibility,
  options: { uniqueCuttersOnly: boolean; siteCounts?: Readonly<Record<string, number>> }
): { displayed: RestrictionCutSite[]; counts: SiteVisibilityCounts } {
  let counts = options.siteCounts;
  if (!counts) {
    const own: Record<string, number> = {};
    for (const s of sites) own[enzymeKey(s.enzyme)] = (own[enzymeKey(s.enzyme)] ?? 0) + 1;
    counts = own;
  }
  const hiddenEnzymes = new Set(state.hiddenEnzymes);
  const displayed: RestrictionCutSite[] = [];
  let eligible = 0;
  for (const site of sites) {
    if (options.uniqueCuttersOnly && counts[enzymeKey(site.enzyme)] !== 1) continue;
    eligible++;
    const own = state.occurrences[siteOccurrenceId(site, revision)];
    if (own ? own.shown : !hiddenEnzymes.has(enzymeKey(site.enzyme))) displayed.push(site);
  }
  return {
    displayed,
    counts: { detected: sites.length, eligible, hiddenByUser: eligible - displayed.length, shown: displayed.length },
  };
}

/**
 * `state` carried onto a scan of revision `revision` (after an edit, a rescan or a change of
 * topology), as a new state: it keeps the occurrence choices whose id names a site in `sites`
 * scanned on `revision` and drops every other, so a choice made on another revision (every site
 * moved or not) or on a site no longer found is gone, never moved to another site. Enzyme choices
 * are kept, by {@link enzymeKey}.
 *
 * Given `scannedKeys` (the {@link enzymeKey} of every enzyme the scan read, zero counts included),
 * while the bases are unchanged (`state.revision === revision`) an occurrence choice whose enzyme
 * the scan did not read is kept too (BG-01M7JP9Y): the scan cannot have found its site, so it has
 * not lost it. A choice's enzyme is its own `enzyme` field, never parsed from its id. Without
 * `scannedKeys`, or after the bases changed, every choice matching no site in `sites` is dropped.
 */
export function reconcileSiteVisibility(
  state: SiteVisibility,
  sites: readonly RestrictionCutSite[],
  revision: string,
  scannedKeys?: ReadonlySet<string>
): SiteVisibility {
  const current = new Set(sites.map((s) => siteOccurrenceId(s, revision)));
  const unread = (enzyme: string) => !!scannedKeys && state.revision === revision && !scannedKeys.has(enzyme);
  const occurrences = Object.fromEntries(
    Object.entries(state.occurrences).filter(([id, o]) => current.has(id) || unread(o.enzyme))
  );
  return { revision, hiddenEnzymes: [...state.hiddenEnzymes], occurrences };
}
