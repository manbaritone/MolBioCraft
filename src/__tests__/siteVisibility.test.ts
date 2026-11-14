// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC0W: which restriction sites the maps display is display state, keyed by a stable
 * occurrence identity. Every scanned site here is the real engine's record (scanRestrictionSites
 * over public/molbiocraft_wasm.wasm), and every digest the engine's own (simulateRestrictionDigest);
 * the identity tests copy one record with one field changed to show which fields the id reads.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { restrictionSiteCountsByName, scanRestrictionSites, simulateRestrictionDigest } from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  applySiteVisibility,
  cutSiteDisplayPosition,
  emptySiteVisibility,
  reconcileSiteVisibility,
  sequenceRevision,
  setEnzymeVisibility,
  setOccurrenceVisibility,
  siteOccurrenceId,
  type SiteVisibility,
} from '../core/restrictionDisplay';
import type { RestrictionCutSite, SequenceDocument } from '../types/bio';
import { CircularPlasmidMap, circularCalloutNote } from '../components/CircularPlasmidMap';
import { LinearSequenceView } from '../components/LinearSequenceView';
import { parseMbcWorkbench, restoredSiteVisibility, serializeMbcWorkbench, siteVisibilityForSession, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import { mountApp } from './appHarness';
import type { LiveElement } from './liveDom';

const ENZYMES = ['EcoRI', 'BamHI', 'BsaI-HFv2'].map((n) => {
  const e = REBASE_ENZYMES.find((x) => x.name === n);
  if (!e) throw new Error(`no catalogue enzyme ${n}`);
  return e;
});

/** `n` filler bases over A and C only, which hold none of the three motifs. */
const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};

/**
 * The fixture: EcoRI G^AATTC twice, BamHI G^GATCC once and BsaI's GGTCTC on the bottom strand once
 * (GAGACC on the top), each between A/C filler.
 */
const SEQ = [filler(40, 1), 'GAATTC', filler(50, 2), 'GGATCC', filler(50, 3), 'GAGACC', filler(50, 4), 'GAATTC', filler(60, 5)].join('');

const scan = (seq: string, topology: 'circular' | 'linear' = 'circular') => scanRestrictionSites(seq, topology, ENZYMES);
const sitesOf = (sites: RestrictionCutSite[], enzyme: string) => sites.filter((s) => s.enzyme.name === enzyme);
const key = (s: RestrictionCutSite) => `${s.enzyme.name}@${s.position}/${s.strand}`;
const displayedKeys = (sites: RestrictionCutSite[], rev: string, state: SiteVisibility, uniqueCuttersOnly = false) =>
  applySiteVisibility(sites, rev, state, { uniqueCuttersOnly }).displayed.map(key).sort();

describe('site visibility fixture', () => {
  it('holds the planted sites, and only them', () => {
    const s = scan(SEQ);
    expect(s.sites.map(key).sort()).toEqual(
      ['BamHI@97/1', 'BsaI-HFv2@153/-1', 'EcoRI@209/1', 'EcoRI@41/1'].sort()
    );
  });
});

describe('US-01M7CC0W AC1: occurrence identity', () => {
  it('US-01M7CC0W AC1 an id is the same for the same site on every rescan of the same sequence, whatever its place in the list', () => {
    const rev = sequenceRevision(SEQ, 'circular');
    const first = scan(SEQ).sites;
    const again = scan(SEQ).sites;
    const byKey = (sites: RestrictionCutSite[]) => new Map(sites.map((s) => [key(s), siteOccurrenceId(s, rev)]));
    expect(byKey(again)).toEqual(byKey(first));
    // The list reordered (as a sort by uniqueness reorders it) leaves every site its own id.
    const reordered = [...first].reverse();
    for (const s of reordered) expect(siteOccurrenceId(s, rev)).toBe(byKey(first).get(key(s)));
    // Every site its own id; a list index would collide across lists of different order.
    const ids = first.map((s) => siteOccurrenceId(s, rev));
    expect(new Set(ids).size).toBe(first.length);
    // A choice follows its site, not its place: the first-listed site hidden stays the one hidden in
    // a list of another order and in a fresh scan.
    const state = setOccurrenceVisibility(emptySiteVisibility(rev), first[0], false);
    const hiddenIn = (sites: RestrictionCutSite[]) =>
      sites.filter((s) => !applySiteVisibility(sites, rev, state, { uniqueCuttersOnly: false }).displayed.includes(s)).map(key);
    expect(hiddenIn(first)).toEqual([key(first[0])]);
    expect(hiddenIn(reordered)).toEqual([key(first[0])]);
    expect(hiddenIn(again)).toEqual([key(first[0])]);
  });

  it('US-01M7CC0W AC1 the id names the enzyme, recognition position, strand and revision, and changes with each', () => {
    const rev = sequenceRevision(SEQ, 'circular');
    const [bsa] = sitesOf(scan(SEQ).sites, 'BsaI-HFv2');
    const id = siteOccurrenceId(bsa, rev);
    expect(id).toContain('BsaI-HFv2');
    expect(id).toContain('153');
    expect(id).toContain(rev);
    expect(siteOccurrenceId({ ...bsa, strand: 1 }, rev)).not.toBe(id);
    expect(siteOccurrenceId({ ...bsa, position: bsa.position + 1 }, rev)).not.toBe(id);
    expect(siteOccurrenceId({ ...bsa, enzyme: { ...bsa.enzyme, name: 'Eco31I' } }, rev)).not.toBe(id);
    expect(siteOccurrenceId(bsa, sequenceRevision(SEQ + 'A', 'circular'))).not.toBe(id);
    // The cut coordinates are not identity: the same occurrence read with another cut is the same site.
    expect(siteOccurrenceId({ ...bsa, cutTop: bsa.cutTop + 1 }, rev)).toBe(id);
  });

  it('US-01M7CC0W AC1 the revision is a function of the sequence and topology alone', () => {
    const rev = sequenceRevision(SEQ, 'circular');
    expect(sequenceRevision(SEQ.slice(), 'circular')).toBe(rev);
    expect(sequenceRevision(SEQ, 'linear')).not.toBe(rev);
    // One base changed, same length, same composition (a swap): a new revision.
    const i = [...SEQ].findIndex((b, k) => b !== SEQ[k + 1]);
    const swapped = SEQ.slice(0, i) + SEQ[i + 1] + SEQ[i] + SEQ.slice(i + 2);
    expect(swapped).not.toBe(SEQ);
    expect(sequenceRevision(swapped, 'circular')).not.toBe(rev);
    expect(sequenceRevision(SEQ.slice(0, -1) + (SEQ.endsWith('A') ? 'C' : 'A'), 'circular')).not.toBe(rev);
    expect(sequenceRevision('ACGT', 'linear')).not.toBe(sequenceRevision('ACGA', 'linear'));
  });
});

describe('US-01M7CC0W AC2: composition, the unique-cutter filter and counts', () => {
  const rev = sequenceRevision(SEQ, 'circular');
  const sites = scan(SEQ).sites;
  const [eco1, eco2] = sitesOf(sites, 'EcoRI').sort((a, b) => a.position - b.position);
  const [bam] = sitesOf(sites, 'BamHI');

  it('US-01M7CC0W AC2 nothing chosen shows every site', () => {
    expect(displayedKeys(sites, rev, emptySiteVisibility(rev))).toEqual(sites.map(key).sort());
  });

  it('US-01M7CC0W AC2 an occurrence re-shown inside a hidden enzyme is the one of its sites shown', () => {
    let state = setEnzymeVisibility(emptySiteVisibility(rev), 'EcoRI', false);
    expect(displayedKeys(sites, rev, state)).toEqual([key(bam), 'BsaI-HFv2@153/-1'].sort());
    state = setOccurrenceVisibility(state, eco2, true);
    expect(displayedKeys(sites, rev, state)).toEqual([key(bam), 'BsaI-HFv2@153/-1', key(eco2)].sort());
  });

  it('US-01M7CC0W AC2 an occurrence hidden inside a shown enzyme hides that site alone', () => {
    const state = setOccurrenceVisibility(emptySiteVisibility(rev), eco1, false);
    const shown = displayedKeys(sites, rev, state);
    expect(shown).not.toContain(key(eco1));
    expect(shown).toContain(key(eco2));
    expect(shown).toHaveLength(sites.length - 1);
  });

  it('US-01M7CC0W AC2 an enzyme-level choice made after an occurrence choice clears that enzyme\'s occurrence choices', () => {
    let state = setOccurrenceVisibility(emptySiteVisibility(rev), eco1, false);
    state = setOccurrenceVisibility(state, bam, false);
    state = setEnzymeVisibility(state, 'EcoRI', true);
    const shown = displayedKeys(sites, rev, state);
    expect(shown).toContain(key(eco1));
    // Another enzyme's occurrence choice stays.
    expect(shown).not.toContain(key(bam));
    // Hiding the enzyme after re-showing one of its sites hides them all.
    state = setOccurrenceVisibility(setEnzymeVisibility(state, 'EcoRI', false), eco2, true);
    state = setEnzymeVisibility(state, 'EcoRI', false);
    expect(displayedKeys(sites, rev, state).filter((k) => k.startsWith('EcoRI'))).toEqual([]);
  });

  it('US-01M7CC0W AC2 an occurrence set back to its enzyme\'s setting holds no choice of its own', () => {
    const hidden = setOccurrenceVisibility(emptySiteVisibility(rev), eco1, false);
    expect(setOccurrenceVisibility(hidden, eco1, true)).toEqual(emptySiteVisibility(rev));
  });

  it('US-01M7CC0W AC2 the unique-cutter filter limits what is eligible and keeps every choice', () => {
    const state = setOccurrenceVisibility(setOccurrenceVisibility(emptySiteVisibility(rev), eco1, false), bam, false);
    const snapshot = structuredClone(state);
    const filtered = applySiteVisibility(sites, rev, state, { uniqueCuttersOnly: true });
    // EcoRI cuts twice, so neither of its sites is eligible; BamHI is hidden by the user.
    expect(filtered.displayed.map(key)).toEqual(['BsaI-HFv2@153/-1']);
    expect(filtered.counts).toEqual({ detected: 4, eligible: 2, hiddenByUser: 1, shown: 1 });
    // The filter left the choices as they were: off again, eco1 and BamHI are still hidden, eco2 shown.
    expect(state).toEqual(snapshot);
    const unfiltered = applySiteVisibility(sites, rev, state, { uniqueCuttersOnly: false });
    expect(unfiltered.displayed.map(key).sort()).toEqual([key(eco2), 'BsaI-HFv2@153/-1'].sort());
    expect(unfiltered.counts).toEqual({ detected: 4, eligible: 4, hiddenByUser: 2, shown: 2 });
  });

  it('US-01M7CC0W AC2 uniqueness is read from the scan\'s complete counts when given, not from the kept sites', () => {
    // A scan that kept one EcoRI site of the two it counted: EcoRI is still not a single cutter.
    const kept = sites.filter((s) => s !== eco2);
    const counts = restrictionSiteCountsByName(scan(SEQ));
    const out = applySiteVisibility(kept, rev, emptySiteVisibility(rev), { uniqueCuttersOnly: true, siteCounts: counts });
    expect(out.displayed.map(key).sort()).toEqual([key(bam), 'BsaI-HFv2@153/-1'].sort());
    expect(out.counts).toEqual({ detected: 3, eligible: 2, hiddenByUser: 0, shown: 2 });
  });

  it('US-01M7CC0W AC2 the state is plain data that survives a JSON round trip', () => {
    const state = setOccurrenceVisibility(setEnzymeVisibility(emptySiteVisibility(rev), 'EcoRI', false), eco2, true);
    const back = JSON.parse(JSON.stringify(state)) as SiteVisibility;
    expect(back).toEqual(state);
    expect(displayedKeys(sites, rev, back)).toEqual(displayedKeys(sites, rev, state));
  });
});

/** Freezes `value` and everything it holds, so that a write to any of it throws. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('US-01M7CC0W AC3: visibility never touches the scan or a digest', () => {
  const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000)!;
  const rev = sequenceRevision(plasmid.sequence, plasmid.topology);

  it('US-01M7CC0W AC3 hiding sites returns a displayed subset and leaves every scanned site in the scan', () => {
    const full = scanRestrictionSites(plasmid.sequence, plasmid.topology);
    const before = structuredClone(full);
    deepFreeze(full);
    const counts = restrictionSiteCountsByName(full);
    const unique = [...new Set(full.sites.filter((s) => counts[s.enzyme.name] === 1).map((s) => s.enzyme.name))];
    expect(unique.length).toBeGreaterThan(3);
    let state = setEnzymeVisibility(emptySiteVisibility(rev), unique[0], false);
    state = setOccurrenceVisibility(state, full.sites.find((s) => s.enzyme.name === unique[1])!, false);
    const out = applySiteVisibility(full.sites, rev, state, { uniqueCuttersOnly: true, siteCounts: counts });
    expect(out.displayed.length).toBe(unique.length - 2);
    expect(out.displayed).not.toBe(full.sites);
    expect(full).toEqual(before);
    expect(full.sites).toHaveLength(before.sites.length);
  });

  it('US-01M7CC0W AC3 a digest by the scan\'s single cutters is the same with every one of them hidden', () => {
    const full = scanRestrictionSites(plasmid.sequence, plasmid.topology);
    const counts = restrictionSiteCountsByName(full);
    const uniqueNames = () => [...new Set(full.sites.filter((s) => counts[s.enzyme.name] === 1).map((s) => s.enzyme.name))].slice(0, 3);
    const names = uniqueNames();
    const digestBefore = simulateRestrictionDigest(plasmid, names);
    expect(digestBefore.length).toBe(names.length);
    const state = names.reduce((st, n) => setEnzymeVisibility(st, n, false), emptySiteVisibility(rev));
    const out = applySiteVisibility(full.sites, rev, state, { uniqueCuttersOnly: false, siteCounts: counts });
    expect(out.displayed.some((s) => names.includes(s.enzyme.name))).toBe(false);
    // The scan still holds them, so the digest the user picks from it is the one it was.
    expect(uniqueNames()).toEqual(names);
    expect(simulateRestrictionDigest(plasmid, uniqueNames())).toEqual(digestBefore);
  });
});

describe('US-01M7CC0W AC4: an edit or rescan drops stale ids and never moves a choice', () => {
  const rev0 = sequenceRevision(SEQ, 'circular');
  const sites0 = scan(SEQ).sites;
  const [eco1, eco2] = sitesOf(sites0, 'EcoRI').sort((a, b) => a.position - b.position);

  it('US-01M7CC0W AC4 a rescan of the same sequence keeps every occurrence choice', () => {
    const state = setOccurrenceVisibility(emptySiteVisibility(rev0), eco1, false);
    const again = reconcileSiteVisibility(state, scan(SEQ).sites, sequenceRevision(SEQ, 'circular'));
    expect(again).toEqual(state);
    expect(displayedKeys(scan(SEQ).sites, rev0, again)).not.toContain(key(eco1));
  });

  it('US-01M7CC0W AC4 bases inserted upstream give the moved site a new id, and its old choice is dropped', () => {
    const state = setOccurrenceVisibility(emptySiteVisibility(rev0), eco1, false);
    const edited = 'ACA' + SEQ;
    const rev1 = sequenceRevision(edited, 'circular');
    const sites1 = scan(edited).sites;
    const moved = sitesOf(sites1, 'EcoRI').find((s) => s.position === eco1.position + 3)!;
    expect(siteOccurrenceId(moved, rev1)).not.toBe(siteOccurrenceId(eco1, rev0));
    const next = reconcileSiteVisibility(state, sites1, rev1);
    expect(next.revision).toBe(rev1);
    expect(Object.keys(next.occurrences)).toEqual([]);
    expect(displayedKeys(sites1, rev1, next)).toContain(key(moved));
  });

  it('US-01M7CC0W AC4 a hidden choice never transfers to a different site that comes to sit where it was', () => {
    // Hide the second EcoRI site, then delete the 50 filler bases after the first (the hidden site
    // moves 50 bases left) and write a new EcoRI site over the filler exactly where the hidden one was.
    const state = setOccurrenceVisibility(emptySiteVisibility(rev0), eco2, false);
    const shortened = SEQ.slice(0, eco1.position + 5) + SEQ.slice(eco1.position + 55);
    const edited = shortened.slice(0, eco2.position - 1) + 'GAATTC' + shortened.slice(eco2.position + 5);
    const rev1 = sequenceRevision(edited, 'circular');
    const sites1 = scan(edited).sites;
    const atOld = sitesOf(sites1, 'EcoRI').find((s) => s.position === eco2.position && s.strand === eco2.strand);
    expect(atOld, `an EcoRI site at ${eco2.position} after the edit`).toBeDefined();
    // The moved site and the new one are both new occurrences: neither inherits the hidden choice,
    // with or without a reconcile (the stale id names the old revision).
    expect(sitesOf(sites1, 'EcoRI').map((s) => s.position).sort((x, y) => x - y)).toEqual([eco1.position, eco2.position - 50, eco2.position]);
    expect(displayedKeys(sites1, rev1, state)).toContain(key(atOld!));
    const next = reconcileSiteVisibility(state, sites1, rev1);
    expect(displayedKeys(sites1, rev1, next)).toContain(key(atOld!));
    expect(Object.keys(next.occurrences)).toEqual([]);
  });

  it('US-01M7CC0W AC4 ids of the current revision that match no scanned site are dropped; enzyme choices are kept', () => {
    let state = setEnzymeVisibility(emptySiteVisibility(rev0), 'BamHI', false);
    state = setOccurrenceVisibility(state, eco1, false);
    state = setOccurrenceVisibility(state, { ...eco1, position: 999 }, false);
    expect(Object.keys(state.occurrences)).toHaveLength(2);
    const next = reconcileSiteVisibility(state, sites0, rev0);
    expect(Object.keys(next.occurrences)).toEqual([siteOccurrenceId(eco1, rev0)]);
    expect(next.hiddenEnzymes).toEqual(['BamHI']);
    // An edit keeps the enzyme choice: BamHI stays hidden wherever it now cuts.
    const edited = 'ACA' + SEQ;
    const after = reconcileSiteVisibility(next, scan(edited).sites, sequenceRevision(edited, 'circular'));
    expect(after.hiddenEnzymes).toEqual(['BamHI']);
    expect(displayedKeys(scan(edited).sites, after.revision, after).some((k) => k.startsWith('BamHI'))).toBe(false);
  });

  it('US-01M7CC0W AC4 a change of topology is a new revision: occurrence choices are dropped', () => {
    const state = setOccurrenceVisibility(emptySiteVisibility(rev0), eco1, false);
    const next = reconcileSiteVisibility(state, scan(SEQ, 'linear').sites, sequenceRevision(SEQ, 'linear'));
    expect(Object.keys(next.occurrences)).toEqual([]);
  });

  it('US-01M7CC0W AC4 reconcile returns a new state and leaves the one it was given as it was', () => {
    const state = deepFreeze(setOccurrenceVisibility(emptySiteVisibility(rev0), eco1, false));
    const edited = 'ACA' + SEQ;
    const next = reconcileSiteVisibility(state, scan(edited).sites, sequenceRevision(edited, 'circular'));
    expect(next).not.toBe(state);
    expect(Object.keys(state.occurrences)).toHaveLength(1);
  });
});

// ─── US-01M7CCGA: the maps and their exports draw only the displayed sites ───

const MAP_DOC: SequenceDocument = {
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id: 'site-visibility-map-doc',
  name: 'Site visibility probe',
  sequence: SEQ,
  topology: 'circular',
  features: [],
  primers: [],
};
const MAP_SCAN = scan(SEQ);
const MAP_REV = sequenceRevision(SEQ, 'circular');
const [MAP_ECO1, MAP_ECO2] = sitesOf(MAP_SCAN.sites, 'EcoRI').sort((a, b) => a.position - b.position);
const cutAfter = (s: RestrictionCutSite) => cutSiteDisplayPosition(s.cutTop, SEQ.length, true);

/** The circular map's markup with `state` (none: no choices passed). */
const circularMarkup = (state?: SiteVisibility, uniqueOnly = false, doc = MAP_DOC, sites = MAP_SCAN.sites, counts = restrictionSiteCountsByName(MAP_SCAN), rev = MAP_REV) =>
  renderToStaticMarkup(
    React.createElement(CircularPlasmidMap, {
      doc, cutSites: sites, siteCounts: counts, orfs: [], selectedRange: null, onSelectRange: () => {},
      showOrfs: false, showPrimers: false, showUniqueCuttersOnly: uniqueOnly, restrictionScope: null,
      siteVisibility: state ? { state, revision: rev } : null,
    })
  );
/** Every cut-site callout the circular map draws, as `enzyme@cut-after`. */
const circularCuts = (html: string) => [...html.matchAll(/<title>(\S+) \([A-Z]+\) cuts after (\d+)/g)].map((m) => `${m[1]}@${m[2]}`).sort();
const notesOf = (html: string) => [...html.matchAll(/class="circular-callout-note"[^>]*>([^<]*)</g)].map((m) => m[1]);
/** The linear view's markup with `state`. */
const linearMarkup = (state?: SiteVisibility) =>
  renderToStaticMarkup(
    React.createElement(LinearSequenceView, {
      doc: MAP_DOC, cutSites: MAP_SCAN.sites, selectedRange: null, onSelectRange: () => {}, onUpdateDocument: () => {},
      siteVisibility: state ? { state, revision: MAP_REV } : null,
    })
  );
/** Every cut pill of the base rows, as `enzyme@cut-after`. */
const linearCuts = (html: string) => [...html.matchAll(/▼ (\S+) \((\d+)\)/g)].map((m) => `${m[1]}@${m[2]}`).sort();

describe('US-01M7CCGA AC1: a hidden site has no marker or label on either map', () => {
  const all = ['BamHI@97', 'BsaI-HFv2@' + cutAfter(sitesOf(MAP_SCAN.sites, 'BsaI-HFv2')[0]), `EcoRI@${cutAfter(MAP_ECO1)}`, `EcoRI@${cutAfter(MAP_ECO2)}`].sort();

  it('US-01M7CCGA AC1 the fixture draws every site on both maps when nothing is hidden', () => {
    expect(circularCuts(circularMarkup())).toEqual(all);
    expect(linearCuts(linearMarkup())).toEqual(all);
    expect(circularMarkup(emptySiteVisibility(MAP_REV))).toBe(circularMarkup());
  });

  it('US-01M7CCGA AC1 a hidden enzyme and a hidden occurrence leave the circular map, the base rows and the plate count', () => {
    const state = setOccurrenceVisibility(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BamHI', false), MAP_ECO1, false);
    const html = circularMarkup(state);
    const expected = all.filter((k) => k !== 'BamHI@97' && k !== `EcoRI@${cutAfter(MAP_ECO1)}`);
    expect(circularCuts(html)).toEqual(expected);
    expect(html).not.toMatch(/BamHI/);
    expect(html).toContain('0 annotations · 2 sites');
    expect(linearCuts(linearMarkup(state))).toEqual(expected);
    expect(linearMarkup(state)).not.toMatch(/BamHI/);
  });

  it('US-01M7CCGA AC1 a site shown again is drawn exactly where and as it was', () => {
    let state = setOccurrenceVisibility(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BamHI', false), MAP_ECO1, false);
    state = setOccurrenceVisibility(setEnzymeVisibility(state, 'BamHI', true), MAP_ECO1, true);
    expect(circularMarkup(state)).toBe(circularMarkup());
    expect(linearMarkup(state)).toBe(linearMarkup());
  });

  it('US-01M7CCGA AC1 the remaining site of a partly hidden two-cutter is still drawn as a multi-cutter', () => {
    /** The callout group of `enzyme` cutting after `at`. */
    const callout = (html: string, enzyme: string, at: number) => {
      const t = html.indexOf(`<title>${enzyme} (`);
      const title = [...html.matchAll(new RegExp(`<title>${enzyme} \\([A-Z]+\\) cuts after ${at}\\b`, 'g'))][0];
      expect(title, `${enzyme} at ${at} is drawn`).toBeDefined();
      expect(t).toBeGreaterThanOrEqual(0);
      return html.slice(html.lastIndexOf('<g', title!.index!), html.indexOf('</g>', title!.index!));
    };
    const whole = callout(circularMarkup(), 'EcoRI', cutAfter(MAP_ECO2));
    const partly = callout(circularMarkup(setOccurrenceVisibility(emptySiteVisibility(MAP_REV), MAP_ECO1, false)), 'EcoRI', cutAfter(MAP_ECO2));
    expect(partly).toBe(whole);
    expect(partly).toContain('var(--mbc-text-secondary)');
    expect(partly).not.toContain('var(--mbc-blue)');
    // The single cutter, for contrast, is drawn blue.
    expect(callout(circularMarkup(), 'BamHI', 97)).toContain('var(--mbc-blue)');
  });

  it('US-01M7CCGA AC1 a choice of another revision hides nothing on the maps', () => {
    const old = sequenceRevision('A' + SEQ, 'circular');
    const stale = setEnzymeVisibility(setOccurrenceVisibility(emptySiteVisibility(old), MAP_ECO1, false), 'NotAnEnzyme', false);
    expect(circularCuts(circularMarkup(stale))).toEqual(all);
    expect(linearCuts(linearMarkup(stale))).toEqual(all);
  });
});

describe('US-01M7CCGA AC2: the note tells sites the user hid apart from labels left out for space', () => {
  it('US-01M7CCGA AC2 the note words: hidden sites apart, at every length', () => {
    expect(circularCalloutNote(0, 0, 200, null, 0)).toBeNull();
    expect(circularCalloutNote(0, 0, 200, null, 3)).toBe('3 sites hidden by you');
    expect(circularCalloutNote(5, 2, 200, null, 1)).toBe('5 more sites in Restriction Analysis, 2 in Annotations; 1 site hidden by you');
    expect(circularCalloutNote(5, 2, 45, null, 1)).toBe('7 not shown for space; 1 site hidden by you');
    expect(circularCalloutNote(5, 2, 20, null, 1)).toBe('7 not shown, 1 hidden');
    expect(circularCalloutNote(5, 0, 200, 'first 60,000 bp', 2)).toBe('5 more sites in Restriction Analysis (first 60,000 bp); 2 sites hidden by you');
    // With nothing hidden the words are those the map always gave.
    expect(circularCalloutNote(5, 2, 200, null)).toBe('5 more sites in Restriction Analysis, 2 in Annotations');
  });

  it('US-01M7CCGA AC2 a partial scan\'s note names its scope at every width, with or without hidden or omitted sites', () => {
    const scope = 'first 60,000 bp';
    for (const width of [30, 40, 60, 200]) {
      for (const hidden of [0, 2]) {
        for (const [sites, annotations] of [[0, 0], [5, 0], [5, 2], [0, 3]]) {
          const note = circularCalloutNote(sites, annotations, width, scope, hidden);
          const what = `width ${width}, ${hidden} hidden, ${sites} sites and ${annotations} labels left out`;
          expect(note, what).not.toBeNull();
          expect(note!, what).toContain(scope);
          // Counts are dropped before the scope: a line names hidden sites only when it fits.
          if (note!.length > width) expect(note, what).toBe(`Cut sites: ${scope} only`);
        }
      }
    }
    // The reviewer's cases, and each step of the chain.
    expect(circularCalloutNote(5, 2, 40, scope)).toBe('Cut sites: first 60,000 bp only');
    expect(circularCalloutNote(5, 2, 40, scope, 1)).toBe('1 hidden; first 60,000 bp scanned');
    expect(circularCalloutNote(0, 0, 30, scope, 2)).toBe('Cut sites: first 60,000 bp only');
    expect(circularCalloutNote(0, 0, 40, scope, 2)).toBe('2 hidden; first 60,000 bp scanned');
    expect(circularCalloutNote(0, 0, 60, scope, 2)).toBe('Cut sites: first 60,000 bp only; 2 sites hidden by you');
    expect(circularCalloutNote(5, 2, 60, scope, 1)).toBe('7 not shown, 1 hidden by you; first 60,000 bp scanned');
    expect(circularCalloutNote(5, 2, 200, scope, 1)).toBe('5 more sites in Restriction Analysis (first 60,000 bp), 2 in Annotations; 1 site hidden by you');
    // A whole-molecule scan never claims a scope.
    for (const width of [30, 40, 60, 200]) expect(circularCalloutNote(5, 2, width, null, 1)).not.toMatch(/scanned|only|bp/);
  });

  it('US-01M7CCGA AC2 in the single-cutter view, a hidden multi-cutter is not counted as hidden by you', () => {
    const html = circularMarkup(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'EcoRI', false), true);
    expect(notesOf(html)).toEqual([]);
    expect(html).toContain('0 annotations · 2 unique sites');
    expect(html).not.toMatch(/hidden by you/);
  });

  it('US-01M7CCGA AC2 on a crowded map, the hidden sites are counted apart and never as left out for space', () => {
    const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000)!;
    const full = scanRestrictionSites(plasmid.sequence, 'circular');
    const counts = restrictionSiteCountsByName(full);
    const rev = sequenceRevision(plasmid.sequence, 'circular');
    const total = full.siteCounts.reduce((n, c) => n + c.sites, 0);
    // An enzyme cutting several times, all of its sites kept by the scan.
    const multi = [...new Set(full.sites.map((s) => s.enzyme.name))].find((n) => counts[n] >= 3 && full.sites.filter((s) => s.enzyme.name === n).length === counts[n])!;
    const draw = (state?: SiteVisibility) => circularMarkup(state, false, plasmid, full.sites, counts, rev);
    const before = draw();
    const omittedBefore = Number(/^(\d[\d,]*) more sites/.exec(notesOf(before)[0])![1].replace(/,/g, ''));
    expect(before).toContain(`· ${total.toLocaleString()} sites`);
    const after = draw(setEnzymeVisibility(emptySiteVisibility(rev), multi, false));
    const note = notesOf(after)[0];
    expect(note).toMatch(new RegExp(`; ${counts[multi]} sites hidden by you$`));
    expect(after).toContain(`· ${(total - counts[multi]).toLocaleString()} sites`);
    const omittedAfter = Number(/^(\d[\d,]*) (?:more sites|not shown)/.exec(note)![1].replace(/,/g, ''));
    const placed = (html: string) => circularCuts(html).length;
    expect(omittedAfter + placed(after) + counts[multi]).toBe(total);
    expect(omittedBefore + placed(before)).toBe(total);
    expect(circularCuts(after).some((k) => k.startsWith(`${multi}@`))).toBe(false);
  });

  it('US-01M7CCGA AC2 a hidden enzyme\'s sites past the scan\'s kept positions are counted as hidden too', () => {
    // A scan that kept one of EcoRI's two sites, with its complete count: hiding EcoRI hides both.
    const kept = MAP_SCAN.sites.filter((s) => s !== MAP_ECO2);
    const counts = restrictionSiteCountsByName(MAP_SCAN);
    const html = circularMarkup(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'EcoRI', false), false, MAP_DOC, kept, counts);
    expect(notesOf(html)).toEqual(['2 sites hidden by you']);
    expect(html).toContain('0 annotations · 2 sites');
  });

  it('US-01M7CCGA AC2 in the single-cutter view, a hidden single cutter is counted as hidden', () => {
    const html = circularMarkup(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BamHI', false), true);
    expect(circularCuts(html)).toEqual(['BsaI-HFv2@' + cutAfter(sitesOf(MAP_SCAN.sites, 'BsaI-HFv2')[0])]);
    expect(notesOf(html)).toEqual(['1 site hidden by you']);
    expect(html).toContain('0 annotations · 1 unique sites');
  });
});

describe('US-01M7CCGA AC3: a figure export draws the displayed sites only', () => {
  const state = setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BamHI', false);

  it('US-01M7CCGA AC3 the exported figures carry no hidden site', () => {
    // A figure export clones the figure's live SVG (FigureExportButton: its target or the
    // [data-mbc-figure] it sits in): the circular map's svg, and the linear map's schematic.
    const circ = circularMarkup(state);
    const svg = /<svg[^>]*class="[^"]*plasmid-svg[\s\S]*?<\/svg>/.exec(circ)![0];
    expect(svg).not.toMatch(/BamHI/);
    expect(circularCuts(svg).length).toBe(3);
    const lin = linearMarkup(state);
    const at = lin.indexOf('class="mbc-schematic-header"');
    expect(at).toBeGreaterThan(0);
    const schematic = lin.slice(at, lin.indexOf('</svg>', at));
    expect(schematic).not.toMatch(/BamHI|EcoRI|BsaI/);
  });

  it('US-01M7CCGA AC3 every digest, fragment and cloning path keeps the whole scan: the displayed subset reaches only the maps\' drawing', async () => {
    const fs = await vi.importActual<{ readFileSync: (p: URL, e: string) => string; readdirSync: (p: URL) => string[] }>('node:fs');
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    // Every list of sites the App hands on is the whole scan.
    const handed = [...app.matchAll(/cutSites=\{([^}]+)\}/g)].map((m) => m[1]);
    expect(handed.length).toBeGreaterThanOrEqual(3);
    expect(new Set(handed)).toEqual(new Set(['cutSites', 'cockpitCutSites']));
    expect(app).toMatch(/const cutSites = restrictionScan\.sites;/);
    expect(app).toMatch(/const cockpitCutSites = useMemo\(\(\) => \(restrictionScope\?\.firstBp \? \[\] : cutSites\)/);
    // The choices go only to the maps' siteVisibility props and the panel.
    const uses = [...app.matchAll(/\bmapSiteVisibility\b/g)].length;
    expect([...app.matchAll(/siteVisibility=\{mapSiteVisibility\}/g)].length).toBe(2);
    expect(uses).toBe(2 + 1);
    // In src/, src/core and src/components, no module but the model, the panel and the two maps makes the displayed subset.
    const dirs = ['../core/', '../components/', '../'];
    const makers: string[] = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(new URL(d, import.meta.url))) {
        if (!/\.tsx?$/.test(f)) continue;
        if (fs.readFileSync(new URL(d + f, import.meta.url), 'utf8').match(/applySiteVisibility\(/)) makers.push(f);
      }
    }
    expect(makers.sort()).toEqual(['CircularPlasmidMap.tsx', 'DisplayedSitesPanel.tsx', 'LinearSequenceView.tsx', 'restrictionDisplay.ts'].sort());
    // With every enzyme hidden on the map, a digest by them still cuts at every scanned site.
    const names = [...new Set(MAP_SCAN.sites.map((s) => s.enzyme.name))];
    const hidden = names.reduce((st, n) => setEnzymeVisibility(st, n, false), emptySiteVisibility(MAP_REV));
    expect(circularCuts(circularMarkup(hidden))).toEqual([]);
    expect(simulateRestrictionDigest(MAP_DOC, names)).toHaveLength(MAP_SCAN.sites.length);
  });
});

describe('US-01M7CCGA AC4: choices outlive a document switch, a layout change and zoom, per document', () => {
  vi.setConfig({ testTimeout: 120_000 });
  const TWIN: SequenceDocument = { ...MAP_DOC, id: 'site-visibility-twin', name: 'Site visibility twin' };

  it('US-01M7CCGA AC4 in the App, hidden sites stay hidden through back and forward, layouts and zoom, and only on their document', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({
        documents: [TWIN, MAP_DOC],
        activeDocId: MAP_DOC.id,
        viewerTab: 'sequence-view',
        workspace: {
          navHistory: [TWIN.id, MAP_DOC.id],
          navIndex: 1,
          mapLayoutMode: 'split',
          zoomLevel: 100,
          displaySettings: {
            showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      });
      await app.settle();
      const text = (el: LiveElement) => el.textContent ?? '';
      const mapCuts = () =>
        app.all('svg.plasmid-svg title').map(text).map((t) => /^(\S+) \([A-Z]+\) cuts after (\d+)/.exec(t)).filter(Boolean).map((m) => `${m![1]}@${m![2]}`).sort();
      const pillCuts = () => app.all('.cut-pill').map(text).map((t) => /▼ (\S+) \((\d+)\)/.exec(t)).filter(Boolean).map((m) => `${m![1]}@${m![2]}`).sort();
      const box = (label: string) => app.one(`input[aria-label="${label}"]`, label);
      // The App scans with the whole catalogue: every site it draws, the fixture's among them.
      const all = mapCuts();
      for (const k of ['BamHI@97', `EcoRI@${cutAfter(MAP_ECO1)}`, `EcoRI@${cutAfter(MAP_ECO2)}`]) expect(all).toContain(k);
      expect(pillCuts()).toEqual(all);

      // Open the preview of the first EcoRI site, then hide BamHI and that EcoRI site from the panel.
      const eco1Pill = app.all('.cut-pill').find((b) => text(b).includes(`EcoRI (${cutAfter(MAP_ECO1)})`))!;
      await app.click(eco1Pill);
      expect(app.all('section.mbc-cleavage-preview')).toHaveLength(1);
      await app.change(box('Show BamHI sites on the maps'), false);
      await app.click(app.one('button[aria-label="Expand the 2 sites of EcoRI"]'));
      await app.change(box(`Show EcoRI at ${cutAfter(MAP_ECO1)}, forward strand`), false);
      const shown = all.filter((k) => k !== 'BamHI@97' && k !== `EcoRI@${cutAfter(MAP_ECO1)}`);
      expect(mapCuts()).toEqual(shown);
      expect(pillCuts()).toEqual(shown);
      // The preview of a site the user hides closes, and stays closed when it is shown again.
      expect(app.all('section.mbc-cleavage-preview')).toHaveLength(0);
      const notes = app.all('svg.plasmid-svg text.circular-callout-note').map(text);
      expect(notes).toEqual(['2 sites hidden by you']);
      // Shown again at once: its pill is back, its preview stays closed; then hidden again.
      await app.change(box(`Show EcoRI at ${cutAfter(MAP_ECO1)}, forward strand`), true);
      expect(pillCuts()).toContain(`EcoRI@${cutAfter(MAP_ECO1)}`);
      expect(app.all('section.mbc-cleavage-preview')).toHaveLength(0);
      await app.change(box(`Show EcoRI at ${cutAfter(MAP_ECO1)}, forward strand`), false);
      expect(pillCuts()).toEqual(shown);

      // Back to the twin (the same sequence, another document): nothing is hidden there.
      await app.menu('view:back');
      await app.settle();
      expect(mapCuts()).toEqual(all);
      expect(pillCuts()).toEqual(all);
      expect(box('Show BamHI sites on the maps').checked).toBe(true);
      // Forward again: the choices are as they were.
      await app.menu('view:forward');
      await app.settle();
      expect(mapCuts()).toEqual(shown);
      expect(pillCuts()).toEqual(shown);
      // A layout change and back, and zoom.
      await app.menu('view:layout-linear');
      await app.settle();
      expect(pillCuts()).toEqual(shown);
      await app.menu('view:layout-circular');
      await app.settle();
      expect(mapCuts()).toEqual(shown);
      await app.menu('view:layout-split');
      await app.menu('view:zoom-in');
      await app.settle();
      expect(mapCuts()).toEqual(shown);
      expect(pillCuts()).toEqual(shown);
      // Shown again: back where it was, and its preview stays closed. (The panel opens each document
      // with its enzymes collapsed.)
      await app.click(app.one('button[aria-label="Expand the 2 sites of EcoRI"]'));
      await app.change(box(`Show EcoRI at ${cutAfter(MAP_ECO1)}, forward strand`), true);
      expect(pillCuts()).toEqual(all.filter((k) => k !== 'BamHI@97'));
      expect(app.all('section.mbc-cleavage-preview')).toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

// ─── BG-01M7DHM0: the choices are saved with the session and autosave, and restored per document ───

describe('BG-01M7DHM0 AC1: site visibility is saved with the session and restored per document', () => {
  vi.setConfig({ testTimeout: 120_000 });
  const TWIN: SequenceDocument = { ...MAP_DOC, id: 'site-visibility-twin', name: 'Site visibility twin' };
  const PLAIN: SequenceDocument = { ...MAP_DOC, id: 'site-visibility-plain', name: 'Nothing hidden' };
  const DOCS = [MAP_DOC, TWIN, PLAIN];
  const WORKSPACE: MbcWorkbenchSnapshot['workspace'] = {
    activeDocId: MAP_DOC.id, selectedFolder: 'All Project Files', navHistory: [MAP_DOC.id], navIndex: 0,
    viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
    darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
    displaySettings: {
      showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
      showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
    },
  };
  // MAP_DOC: BamHI hidden and the first EcoRI site hidden. TWIN (the same sequence): BsaI hidden, and
  // its one site shown again inside it. PLAIN: nothing chosen.
  const mapChoice = setOccurrenceVisibility(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BamHI', false), MAP_ECO1, false);
  const twinChoice = setOccurrenceVisibility(setEnzymeVisibility(emptySiteVisibility(MAP_REV), 'BsaI-HFv2', false), sitesOf(MAP_SCAN.sites, 'BsaI-HFv2')[0], true);
  const BY_DOC: Record<string, SiteVisibility> = { [MAP_DOC.id]: mapChoice, [TWIN.id]: twinChoice, [PLAIN.id]: emptySiteVisibility(MAP_REV) };
  /** `byDoc` through the App's session writer and reader (the Rust engine's), and back as the App restores it. */
  const throughSession = (byDoc: Record<string, SiteVisibility>, documents = DOCS, extra: Record<string, unknown> = {}) => {
    const workspace = { ...WORKSPACE, siteVisibility: siteVisibilityForSession(byDoc, documents), ...extra };
    const env = parseMbcWorkbench(serializeMbcWorkbench({ sessionName: 'Sites', documents, workspace })).envelope;
    return { saved: env.workspace.siteVisibility, restored: restoredSiteVisibility(env.workspace.siteVisibility, env.documents) };
  };

  it('BG-01M7DHM0 AC1 serialise then parse gives each document its own hidden sites back, and saves no document without a choice', () => {
    const { saved, restored } = throughSession(BY_DOC);
    expect(Object.keys(saved ?? {}).sort()).toEqual([MAP_DOC.id, TWIN.id].sort());
    expect(restored).toEqual({ [MAP_DOC.id]: mapChoice, [TWIN.id]: twinChoice });
    // Displayed the same, per document: MAP_DOC hides BamHI and one EcoRI site, TWIN hides nothing
    // (its BsaI site shown again inside the hidden enzyme), PLAIN hides nothing.
    const mapShown = displayedKeys(MAP_SCAN.sites, MAP_REV, restored[MAP_DOC.id]);
    expect(mapShown).toEqual(displayedKeys(MAP_SCAN.sites, MAP_REV, mapChoice));
    expect(mapShown).not.toContain(key(sitesOf(MAP_SCAN.sites, 'BamHI')[0]));
    expect(mapShown).not.toContain(key(MAP_ECO1));
    expect(mapShown).toContain(key(MAP_ECO2));
    expect(displayedKeys(MAP_SCAN.sites, MAP_REV, restored[TWIN.id])).toEqual(MAP_SCAN.sites.map(key).sort());
    expect(restored[PLAIN.id]).toBeUndefined();
    // Reconciled with the restored (unchanged) sequence's scan, every choice is kept.
    expect(reconcileSiteVisibility(restored[MAP_DOC.id], scan(MAP_DOC.sequence).sites, MAP_REV)).toEqual(mapChoice);
  });

  it('BG-01M7DHM0 AC1 a session saved before it, or with nothing hidden, restores no choice: every site shown', () => {
    expect(siteVisibilityForSession({ [PLAIN.id]: emptySiteVisibility(MAP_REV) }, DOCS)).toBeUndefined();
    const { saved, restored } = throughSession({});
    expect(saved).toBeUndefined();
    expect(restored).toEqual({});
    // A document no longer in the session saves nothing.
    expect(siteVisibilityForSession(BY_DOC, [PLAIN])).toBeUndefined();
  });

  it('BG-01M7DHM0 AC1 a restored choice for a sequence that changed is dropped; the enzyme choice is kept', () => {
    // The document as reopened: bases inserted upstream of every site, so each moved site has a new id.
    const edited = { ...MAP_DOC, sequence: 'ACCA' + SEQ };
    const { restored, saved } = throughSession({ [MAP_DOC.id]: mapChoice }, [edited]);
    expect(restored[MAP_DOC.id]).toEqual(mapChoice);
    const editedRev = sequenceRevision(edited.sequence, 'circular');
    const editedScan = scan(edited.sequence);
    const reconciled = reconcileSiteVisibility(restored[MAP_DOC.id], editedScan.sites, editedRev);
    expect(reconciled).toEqual({ revision: editedRev, hiddenEnzymes: ['BamHI'], occurrences: {} });
    // Restored with the restored document's revision, the choice is dropped on the way in, as the
    // reconcile drops it; on the unchanged sequence it is kept.
    const revisionOf = (d: SequenceDocument) => sequenceRevision(d.sequence, d.topology);
    expect(restoredSiteVisibility(saved, [edited], revisionOf)).toEqual({ [MAP_DOC.id]: reconciled });
    expect(restoredSiteVisibility(saved, [MAP_DOC], revisionOf)).toEqual({ [MAP_DOC.id]: mapChoice });
    const shown = displayedKeys(editedScan.sites, editedRev, reconciled);
    expect(shown).toEqual(editedScan.sites.filter((s) => s.enzyme.name !== 'BamHI').map(key).sort());
  });

  it('BG-01M7DHM0 AC1 malformed visibility in a session is ignored, through the parser and on restore', () => {
    const garbage = [
      'BamHI', ['BamHI'], 7, null,
      { [MAP_DOC.id]: 'BamHI' },
      { [MAP_DOC.id]: { revision: 5, hiddenEnzymes: ['BamHI'] } },
      { [MAP_DOC.id]: { hiddenEnzymes: ['BamHI'], occurrences: {} } },
      { 'not-in-the-session': { revision: MAP_REV, hiddenEnzymes: ['BamHI'], occurrences: {} } },
    ];
    for (const raw of garbage) {
      expect(throughSession({}, DOCS, { siteVisibility: raw }).restored).toEqual({});
      expect(restoredSiteVisibility(raw, DOCS)).toEqual({});
    }
    // Inside an entry: what is not the shape is dropped and the rest kept.
    const mixed = {
      [MAP_DOC.id]: {
        revision: MAP_REV,
        hiddenEnzymes: ['BamHI', 7, '', { name: 'EcoRI' }],
        occurrences: {
          [siteOccurrenceId(MAP_ECO1, MAP_REV)]: { enzyme: 'EcoRI', shown: false },
          [siteOccurrenceId(MAP_ECO2, MAP_REV)]: { enzyme: 'EcoRI', shown: 'no' },
          [siteOccurrenceId(MAP_ECO2, 'c1.other')]: { enzyme: 'EcoRI', shown: false },
          junk: 'x',
        },
        script: '<b>',
      },
    };
    const expected = { [MAP_DOC.id]: mapChoice };
    expect(restoredSiteVisibility(mixed, DOCS)).toEqual(expected);
    expect(throughSession({}, DOCS, { siteVisibility: mixed }).restored).toEqual(expected);
  });

  it('BG-01M7DHM0 AC1 in the App, hidden sites come back hidden on reopen, on the map and in the panel, and are saved again with the session', async () => {
    const text = (el: LiveElement) => el.textContent ?? '';
    const ecoBox = `Show EcoRI at ${cutAfter(MAP_ECO1)}, forward strand`;
    let savedSession = '';
    {
      const app = await mountApp();
      try {
        await app.restoreSession({
          documents: [MAP_DOC, PLAIN], activeDocId: MAP_DOC.id, viewerTab: 'sequence-view',
          workspace: { ...WORKSPACE, navHistory: [PLAIN.id, MAP_DOC.id], navIndex: 1, siteVisibility: { [MAP_DOC.id]: mapChoice } },
        });
        await app.settle();
        const mapCuts = () =>
          app.all('svg.plasmid-svg title').map(text).map((t) => /^(\S+) \([A-Z]+\) cuts after (\d+)/.exec(t)).filter(Boolean).map((m) => `${m![1]}@${m![2]}`);
        const cuts = mapCuts();
        expect(cuts).toContain(`EcoRI@${cutAfter(MAP_ECO2)}`);
        expect(cuts).not.toContain('BamHI@97');
        expect(cuts).not.toContain(`EcoRI@${cutAfter(MAP_ECO1)}`);
        expect(app.one('input[aria-label="Show BamHI sites on the maps"]').checked).toBe(false);
        await app.click(app.one('button[aria-label="Expand the 2 sites of EcoRI"]'));
        expect(app.one(`input[aria-label="${ecoBox}"]`).checked).toBe(false);
        // The other document opens with nothing hidden.
        await app.menu('view:back');
        await app.settle();
        expect(mapCuts()).toContain('BamHI@97');
        // Saved again with the session (the writer autosave uses too).
        await app.menu('file:save-session');
        await app.settle();
        const file = app.downloads().filter((f) => f.filename.endsWith('.mbc')).pop();
        expect(file, 'Save Session wrote no .mbc').toBeDefined();
        savedSession = await file!.text();
      } finally {
        app.unmount();
      }
    }
    const env = parseMbcWorkbench(savedSession).envelope;
    expect(restoredSiteVisibility(env.workspace.siteVisibility, env.documents)).toEqual({ [MAP_DOC.id]: mapChoice });
    expect(env.workspace.siteVisibility?.[PLAIN.id]).toBeUndefined();
  });

  it('BG-01M7DHM0 AC1 in the App, a restored choice made on another sequence is dropped and its enzyme choice kept', async () => {
    const edited = { ...MAP_DOC, sequence: 'ACCA' + SEQ };
    const app = await mountApp();
    try {
      await app.restoreSession({
        documents: [edited], activeDocId: edited.id, viewerTab: 'sequence-view',
        workspace: { ...WORKSPACE, siteVisibility: { [edited.id]: mapChoice } },
      });
      await app.settle();
      const text = (el: LiveElement) => el.textContent ?? '';
      const cuts = app.all('svg.plasmid-svg title').map(text).filter((t) => /^EcoRI \(/.test(t) || /^BamHI \(/.test(t));
      expect(cuts.filter((t) => t.startsWith('EcoRI'))).toHaveLength(2);
      expect(cuts.filter((t) => t.startsWith('BamHI'))).toHaveLength(0);
      expect(app.one('input[aria-label="Show BamHI sites on the maps"]').checked).toBe(false);
      expect(app.one('input[aria-label="Show EcoRI sites on the maps"]').checked).toBe(true);
      // Dropped on the way in, so the reopened session says it was restored and nothing was cleared.
      expect(app.doc.body.textContent).toContain('Restored workbench');
      // A choice dropped at restore is never reported as cleared (the App would append that notice).
      expect(app.doc.body.textContent).not.toContain('per-site display');
    } finally {
      app.unmount();
    }
  });
});
