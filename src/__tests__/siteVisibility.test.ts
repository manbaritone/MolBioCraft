// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC0W: which restriction sites the maps display is display state, keyed by a stable
 * occurrence identity. Every scanned site here is the real engine's record (scanRestrictionSites
 * over public/molbiocraft_wasm.wasm), and every digest the engine's own (simulateRestrictionDigest);
 * the identity tests copy one record with one field changed to show which fields the id reads.
 */
import { describe, expect, it } from 'vitest';
import { restrictionSiteCountsByName, scanRestrictionSites, simulateRestrictionDigest } from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  applySiteVisibility,
  emptySiteVisibility,
  reconcileSiteVisibility,
  sequenceRevision,
  setEnzymeVisibility,
  setOccurrenceVisibility,
  siteOccurrenceId,
  type SiteVisibility,
} from '../core/restrictionDisplay';
import type { RestrictionCutSite } from '../types/bio';

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
