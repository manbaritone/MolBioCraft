// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7GQZ6: every props-driven reader of a restriction scan keys an enzyme's display choice,
 * site count and unique-cutter judgement by one helper, `enzymeKey` (`enzyme.id ?? enzyme.name`),
 * so a custom enzyme named like a built-in never hides, shows or counts the built-in's sites. Every
 * site and count is the real engine's (scanRestrictionSites over public/molbiocraft_wasm.wasm),
 * from a scan that holds a built-in EcoRI and a custom definition the user also named "EcoRI".
 * The panel's handlers are read off the elements its render creates (the element probe of
 * displayedSitesPanel.test.tsx) and called by hand.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));
type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});

const { DisplayedSitesPanel, displayedSitesRows } = await import('../components/DisplayedSitesPanel');
const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
const { ConstructCockpitBar } = await import('../components/ConstructCockpitBar');
const { restrictionSiteCountsByName, scanRestrictionSites } = await import('../core/bioEngine');
const {
  applySiteVisibility,
  cutSiteDisplayPosition,
  emptySiteVisibility,
  enzymeKey,
  reconcileSiteVisibility,
  sequenceRevision,
  setEnzymeVisibility,
  setOccurrenceVisibility,
  siteOccurrenceId,
} = await import('../core/restrictionDisplay');
const { parseMbcWorkbench, restoredSiteVisibility, serializeMbcWorkbench, siteVisibilityForSession } = await import('../core/mbcSessionFormat');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
type SiteVisibility = import('../core/restrictionDisplay').SiteVisibility;
type RestrictionCutSite = import('../types/bio').RestrictionCutSite;
type RestrictionEnzyme = import('../types/bio').RestrictionEnzyme;
type SequenceDocument = import('../types/bio').SequenceDocument;
type PanelProps = import('../components/DisplayedSitesPanel').DisplayedSitesPanelProps;

afterEach(() => {
  probe.onElement = null;
});

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};

/**
 * The construct: the built-in EcoRI's G^AATTC at 41 and 209, the custom "EcoRI"'s GTTAAC at 97 and
 * BamHI's G^GATCC at 153, between A/C filler. So the built-in EcoRI cuts twice and the custom one
 * once: one name, two counts, and only the custom one a unique cutter.
 */
const SEQ = [filler(40, 1), 'GAATTC', filler(50, 2), 'GTTAAC', filler(50, 3), 'GGATCC', filler(50, 4), 'GAATTC', filler(60, 5)].join('');
const REV = sequenceRevision(SEQ, 'circular');
const ECO = REBASE_ENZYMES.find((e) => e.name === 'EcoRI')!;
const BAM = REBASE_ENZYMES.find((e) => e.name === 'BamHI')!;
const custom = (id: string, recognitionSeq: string, cut: number): RestrictionEnzyme => ({
  id, source: 'custom', name: 'EcoRI', recognitionSeq, cutFwd: cut, cutRev: cut, isTypeIIS: false,
  suppliers: [], methylationSensitivity: [], bufferNEB: '', tempC: 37, provenance: 'Own isolate', notes: '',
});
const MINE_ID = 'custom:5b1e7c2a-8d34-4f6b-9a0e-2c7d1f3b4a56';
/** Adaeze's "EcoRI": another motif, cut bluntly. */
const MINE = custom(MINE_ID, 'GTTAAC', 3);
const TWIN_ID = 'custom:0d9c8b7a-6e5f-4d3c-8b2a-1f0e9d8c7b6a';
/** A custom "EcoRI" on the built-in's own motif, cut bluntly: its sites lie at the built-in's positions and strands. */
const TWIN = custom(TWIN_ID, 'GAATTC', 3);

const SCAN = scanRestrictionSites(SEQ, 'circular', [ECO, BAM, MINE]);
const COUNTS = restrictionSiteCountsByName(SCAN);
const TWIN_SCAN = scanRestrictionSites(SEQ, 'circular', [ECO, TWIN]);
const TWIN_COUNTS = restrictionSiteCountsByName(TWIN_SCAN);
const EMPTY = emptySiteVisibility(REV);
const MOLECULE = { revision: REV, seqLen: SEQ.length, circular: true };

const byId = (sites: readonly RestrictionCutSite[], id: string) => sites.filter((s) => s.enzyme.id === id).sort((a, b) => a.position - b.position);
/** A site as `enzyme-id@position`, so two enzymes that share a name are told apart. */
const at = (s: RestrictionCutSite) => `${s.enzyme.id}@${s.position}`;
const shown = (sites: readonly RestrictionCutSite[], state: SiteVisibility, uniqueCuttersOnly = false, siteCounts?: Record<string, number>) =>
  applySiteVisibility(sites, REV, state, { uniqueCuttersOnly, siteCounts }).displayed.map(at).sort();

const DOC: SequenceDocument = {
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id: 'adaeze-construct', name: 'pAdaeze', sequence: SEQ, topology: 'circular', features: [], primers: [],
};

/** The panel's markup and every element it created with the props it was given. */
function renderPanel(overrides: Partial<PanelProps> = {}) {
  const changes: SiteVisibility[] = [];
  const elements: { type: unknown; props: Record<string, unknown> }[] = [];
  const props: PanelProps = {
    sites: SCAN.sites, siteCounts: COUNTS, visibility: EMPTY, molecule: MOLECULE, uniqueCuttersOnly: false,
    onVisibilityChange: (v) => changes.push(v), onGoToSite: () => {}, ...overrides,
  };
  probe.onElement = (type, p) => elements.push({ type, props: p });
  const html = renderToStaticMarkup(<DisplayedSitesPanel {...props} />);
  probe.onElement = null;
  const labelled = (label: string) => elements.filter((e) => e.props['aria-label'] === label).map((e) => e.props);
  const check = (props: Record<string, unknown>, checked: boolean) =>
    (props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked } });
  return { html, changes, labelled, check };
}

/** The circular map's markup. */
const mapMarkup = (opts: { state?: SiteVisibility; uniqueOnly?: boolean; counts?: Record<string, number> | null; sites?: RestrictionCutSite[]; doc?: SequenceDocument; rev?: string }) =>
  renderToStaticMarkup(
    <CircularPlasmidMap
      doc={opts.doc ?? DOC} cutSites={opts.sites ?? SCAN.sites} siteCounts={opts.counts === null ? undefined : (opts.counts ?? COUNTS)}
      orfs={[]} selectedRange={null} onSelectRange={() => {}} showOrfs={false} showPrimers={false}
      showUniqueCuttersOnly={opts.uniqueOnly ?? false} restrictionScope={null}
      siteVisibility={opts.state ? { state: opts.state, revision: opts.rev ?? REV } : null}
    />
  );
/** Every cut-site callout the circular map draws, as `name (motif)@cut-after`: the motif tells the two "EcoRI"s apart. */
const mapCuts = (html: string) => [...html.matchAll(/<title>(\S+ \([A-Z]+\)) cuts after (\d+)/g)].map((m) => `${m[1]}@${m[2]}`).sort();
const mapNotes = (html: string) => [...html.matchAll(/class="circular-callout-note"[^>]*>([^<]*)</g)].map((m) => m[1]);
const cutAfter = (s: RestrictionCutSite) => cutSiteDisplayPosition(s.cutTop, SEQ.length, true);

const [ECO1, ECO2] = byId(SCAN.sites, 'EcoRI');
const [MINE1] = byId(SCAN.sites, MINE_ID);
const [BAM1] = byId(SCAN.sites, 'BamHI');

describe('US-01M7GQZ6 AC1: the fixture is a real scan holding a built-in and a custom enzyme of one name', () => {
  it('US-01M7GQZ6 AC1 the engine returns the built-in EcoRI twice and the custom "EcoRI" once, each under its own id', () => {
    expect(SCAN.sites.map((s) => [s.enzyme.id, s.enzyme.name, s.position, s.strand])).toEqual([
      ['EcoRI', 'EcoRI', 41, 1], [MINE_ID, 'EcoRI', 97, 1], ['BamHI', 'BamHI', 153, 1], ['EcoRI', 'EcoRI', 209, 1],
    ]);
    expect(SCAN.siteCounts.map((c) => [c.enzyme, c.enzymeId, c.sites])).toEqual([
      ['EcoRI', 'EcoRI', 2], ['BamHI', 'BamHI', 1], ['EcoRI', MINE_ID, 1],
    ]);
    // The twin's sites lie on the built-in's positions and strands.
    expect(byId(TWIN_SCAN.sites, TWIN_ID).map((s) => [s.position, s.strand])).toEqual(byId(TWIN_SCAN.sites, 'EcoRI').map((s) => [s.position, s.strand]));
  });
});

describe('US-01M7GQZ6 AC1: one key helper, and a built-in keyed exactly as before', () => {
  it('US-01M7GQZ6 AC1 the key is the id, and the name for an enzyme with no id', () => {
    expect(enzymeKey(MINE1.enzyme)).toBe(MINE_ID);
    expect(enzymeKey(ECO1.enzyme)).toBe('EcoRI');
    const { id: _id, ...noId } = MINE1.enzyme;
    expect(enzymeKey(noId)).toBe('EcoRI');
    expect(enzymeKey({ name: 'Inside1' })).toBe('Inside1');
  });

  it('US-01M7GQZ6 AC1 the counts are by id: the built-in EcoRI twice, the custom one once, neither overwriting the other', () => {
    expect(COUNTS).toEqual({ EcoRI: 2, BamHI: 1, [MINE_ID]: 1 });
    expect(TWIN_COUNTS).toEqual({ EcoRI: 2, [TWIN_ID]: 2 });
  });

  it('US-01M7GQZ6 AC1 every built-in occurrence id and count key over a whole-catalogue scan is byte-identical to the name-keyed one', () => {
    const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000)!;
    const scan = scanRestrictionSites(plasmid.sequence, 'circular');
    const rev = sequenceRevision(plasmid.sequence, 'circular');
    expect(scan.sites.length).toBeGreaterThan(100);
    for (const s of scan.sites) {
      expect(s.enzyme.id).toBe(s.enzyme.name);
      expect(siteOccurrenceId(s, rev)).toBe(`${s.enzyme.name}@${s.position}${s.strand === -1 ? '-' : '+'}#${rev}`);
      // A site built with its enzyme's name alone (no id) gets the same id.
      expect(siteOccurrenceId({ ...s, enzyme: { ...s.enzyme, id: undefined } }, rev)).toBe(siteOccurrenceId(s, rev));
    }
    const byName: Record<string, number> = {};
    for (const c of scan.siteCounts) byName[c.enzyme] = c.sites;
    expect(JSON.stringify(restrictionSiteCountsByName(scan))).toBe(JSON.stringify(byName));
  });
});

describe('US-01M7GQZ6 AC1: the restriction display helpers', () => {
  it('US-01M7GQZ6 AC1 hiding the built-in EcoRI leaves the custom "EcoRI" shown, and hiding the custom one leaves the built-in shown', () => {
    const builtInHidden = setEnzymeVisibility(EMPTY, enzymeKey(ECO1.enzyme), false);
    expect(builtInHidden.hiddenEnzymes).toEqual(['EcoRI']);
    expect(shown(SCAN.sites, builtInHidden)).toEqual([at(BAM1), at(MINE1)].sort());
    const customHidden = setEnzymeVisibility(EMPTY, enzymeKey(MINE1.enzyme), false);
    expect(customHidden.hiddenEnzymes).toEqual([MINE_ID]);
    expect(shown(SCAN.sites, customHidden)).toEqual([at(ECO1), at(ECO2), at(BAM1)].sort());
  });

  it('US-01M7GQZ6 AC1 the unique-cutter filter judges each by its own count: the custom "EcoRI" cuts once, the built-in twice', () => {
    expect(shown(SCAN.sites, EMPTY, true, COUNTS)).toEqual([at(BAM1), at(MINE1)].sort());
    // With no counts given, the helper counts the sites it was handed, by the same key.
    expect(shown(SCAN.sites, EMPTY, true)).toEqual([at(BAM1), at(MINE1)].sort());
    const filtered = applySiteVisibility(SCAN.sites, REV, setEnzymeVisibility(EMPTY, MINE_ID, false), { uniqueCuttersOnly: true, siteCounts: COUNTS });
    expect(filtered.counts).toEqual({ detected: 4, eligible: 2, hiddenByUser: 1, shown: 1 });
  });

  it('US-01M7GQZ6 AC1 a site of the custom twin on the built-in\'s own position has its own occurrence id and its own choice', () => {
    const [eco41] = byId(TWIN_SCAN.sites, 'EcoRI');
    const [twin41] = byId(TWIN_SCAN.sites, TWIN_ID);
    expect(siteOccurrenceId(eco41, REV)).toBe(`EcoRI@41+#${REV}`);
    expect(siteOccurrenceId(twin41, REV)).toBe(`${TWIN_ID}@41+#${REV}`);
    const hid = setOccurrenceVisibility(EMPTY, eco41, false);
    expect(hid.occurrences).toEqual({ [`EcoRI@41+#${REV}`]: { enzyme: 'EcoRI', shown: false } });
    expect(shown(TWIN_SCAN.sites, hid)).toContain(at(twin41));
    expect(shown(TWIN_SCAN.sites, hid)).not.toContain(at(eco41));
    // Each enzyme's own setting is the one its site's choice is measured against, and is cleared with it.
    const both = setOccurrenceVisibility(setEnzymeVisibility(hid, TWIN_ID, false), twin41, true);
    expect(both.occurrences[siteOccurrenceId(twin41, REV)]).toEqual({ enzyme: TWIN_ID, shown: true });
    expect(reconcileSiteVisibility(both, TWIN_SCAN.sites, REV)).toEqual(both);
    const cleared = setEnzymeVisibility(both, TWIN_ID, true);
    expect(cleared.occurrences).toEqual(hid.occurrences);
    expect(shown(TWIN_SCAN.sites, cleared)).toEqual(TWIN_SCAN.sites.filter((s) => s !== eco41).map(at).sort());
  });
});

describe('US-01M7GQZ6 AC1: the Displayed restriction sites panel', () => {
  const rowsOf = (state: SiteVisibility, uniqueCuttersOnly = false, sites = SCAN.sites, counts = COUNTS) =>
    displayedSitesRows(sites, counts, state, { query: '', uniqueCuttersOnly, shownOnly: false }, MOLECULE);

  it('US-01M7GQZ6 AC1 lists the two "EcoRI"s as two rows, each with its own motif, count and display state', () => {
    const rows = rowsOf(setEnzymeVisibility(EMPTY, 'EcoRI', false));
    expect(rows.map((r) => [r.key, r.name, r.recognitionSeq, r.siteCount, r.keptCount, r.state])).toEqual([
      ['BamHI', 'BamHI', 'GGATCC', 1, 1, 'shown'],
      ['EcoRI', 'EcoRI', 'GAATTC', 2, 2, 'hidden'],
      [MINE_ID, 'EcoRI', 'GTTAAC', 1, 1, 'shown'],
    ]);
    expect(rowsOf(EMPTY, true).map((r) => r.key)).toEqual(['BamHI', MINE_ID]);
  });

  it('US-01M7GQZ6 AC1 the custom row\'s checkbox hides the custom "EcoRI" alone, and the built-in\'s the built-in alone', () => {
    const rows = rowsOf(EMPTY);
    const r = renderPanel();
    const boxes = [...r.labelled('Show EcoRI sites on the maps'), ...r.labelled('Show EcoRI (custom) sites on the maps')];
    expect(boxes).toHaveLength(2);
    // The panel draws its rows in the order displayedSitesRows gives them.
    const ecoRows = rows.filter((row) => row.name === 'EcoRI').map((row) => row.key);
    r.check(boxes[ecoRows.indexOf(MINE_ID)], false);
    r.check(boxes[ecoRows.indexOf('EcoRI')], false);
    expect(r.changes.map((c) => c.hiddenEnzymes)).toEqual([[MINE_ID], ['EcoRI']]);
    expect(shown(SCAN.sites, r.changes[0])).toEqual([at(ECO1), at(ECO2), at(BAM1)].sort());
    expect(shown(SCAN.sites, r.changes[1])).toEqual([at(BAM1), at(MINE1)].sort());
    // Two rows, two distinct occurrence lists.
    expect(r.html).toContain('aria-label="Show EcoRI sites on the maps"');
    const html = renderPanel({ initialExpanded: ['EcoRI'] }).html;
    expect(html).toContain('id="mbc-dsites-occ-EcoRI"');
    expect(html).not.toContain(`mbc-dsites-occ-${MINE_ID.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  });

  it('US-01M7GQZ6 AC1 with the unique-cutter filter, Hide filtered hides the custom "EcoRI" and leaves the built-in shown', () => {
    const r = renderPanel({ uniqueCuttersOnly: true });
    expect(r.labelled('Show EcoRI (custom) sites on the maps')).toHaveLength(1);
    expect(r.labelled('Show EcoRI sites on the maps')).toHaveLength(0);
    (r.labelled('Hide filtered: hide every site of the 2 matching enzymes')[0].onClick as () => void)();
    expect(r.changes[0].hiddenEnzymes).toEqual(['BamHI', MINE_ID]);
    expect(shown(SCAN.sites, r.changes[0])).toEqual([at(ECO1), at(ECO2)].sort());
  });

  it('US-01M7GQZ6 AC1 an occurrence of the custom twin is shown or hidden on its own, beside the built-in\'s on the same position', () => {
    const [eco41] = byId(TWIN_SCAN.sites, 'EcoRI');
    const [twin41] = byId(TWIN_SCAN.sites, TWIN_ID);
    const r = renderPanel({ sites: TWIN_SCAN.sites, siteCounts: TWIN_COUNTS, initialExpanded: ['EcoRI', TWIN_ID] });
    // The built-in cuts G^AATTC (after 41), the twin GAA^TTC (after 43).
    expect(cutAfter(eco41)).toBe(41);
    expect(cutAfter(twin41)).toBe(43);
    expect(r.html).toContain(`id="mbc-dsites-occ-${TWIN_ID.replace(/[^A-Za-z0-9_-]/g, '_')}"`);
    expect(r.html).toContain('id="mbc-dsites-occ-EcoRI"');
    const [box] = r.labelled('Show EcoRI (custom) at 43, forward strand');
    r.check(box, false);
    expect(r.changes[0].occurrences).toEqual({ [siteOccurrenceId(twin41, REV)]: { enzyme: TWIN_ID, shown: false } });
    expect(shown(TWIN_SCAN.sites, r.changes[0])).toEqual(TWIN_SCAN.sites.filter((s) => s !== twin41).map(at).sort());
    const rows = displayedSitesRows(TWIN_SCAN.sites, TWIN_COUNTS, r.changes[0], { query: '', uniqueCuttersOnly: false, shownOnly: false }, MOLECULE);
    expect(rows.map((row) => [row.key, row.state])).toEqual([['EcoRI', 'shown'], [TWIN_ID, 'mixed']]);
    // Opening the built-in's row opens it alone, and Reset display clears the twin's choice alone.
    const builtInOpen = renderPanel({ sites: TWIN_SCAN.sites, siteCounts: TWIN_COUNTS, initialExpanded: ['EcoRI'] });
    expect(builtInOpen.html).toContain('id="mbc-dsites-occ-EcoRI"');
    expect(builtInOpen.html).not.toContain('id="mbc-dsites-occ-custom_');
    expect(builtInOpen.labelled('Show EcoRI (custom) at 43, forward strand')).toHaveLength(0);
    const both = setOccurrenceVisibility(r.changes[0], eco41, false);
    const reset = renderPanel({ sites: TWIN_SCAN.sites, siteCounts: TWIN_COUNTS, visibility: both, initialQuery: 'eco' });
    (reset.labelled('Reset display: clear every choice for the 2 matching enzymes')[0].onClick as () => void)();
    expect(reset.changes[0]).toEqual(EMPTY);
  });
});

describe('US-01M7GQZ6 AC1: the circular map', () => {
  const builtIn = (s: RestrictionCutSite) => `EcoRI (GAATTC)@${cutAfter(s)}`;
  const mine = `EcoRI (GTTAAC)@${cutAfter(MINE1)}`;
  const bam = `BamHI (GGATCC)@${cutAfter(BAM1)}`;

  it('US-01M7GQZ6 AC1 hiding the built-in EcoRI leaves the custom "EcoRI" drawn, and the reverse', () => {
    expect(mapCuts(mapMarkup({}))).toEqual([builtIn(ECO1), builtIn(ECO2), mine, bam].sort());
    const builtInHidden = mapMarkup({ state: setEnzymeVisibility(EMPTY, 'EcoRI', false) });
    expect(mapCuts(builtInHidden)).toEqual([mine, bam].sort());
    expect(mapNotes(builtInHidden).join(' ')).toContain('2 sites hidden by you');
    const customHidden = mapMarkup({ state: setEnzymeVisibility(EMPTY, MINE_ID, false) });
    expect(mapCuts(customHidden)).toEqual([builtIn(ECO1), builtIn(ECO2), bam].sort());
    expect(mapNotes(customHidden).join(' ')).toContain('1 site hidden by you');
  });

  for (const counts of ['the scan\'s counts', 'no counts'] as const) {
    it(`US-01M7GQZ6 AC1 the single-cutter view draws the custom "EcoRI" and never the built-in, by ${counts}`, () => {
      const c = counts === 'no counts' ? null : COUNTS;
      expect(mapCuts(mapMarkup({ uniqueOnly: true, counts: c, state: EMPTY }))).toEqual([mine, bam].sort());
      const hidden = mapMarkup({ uniqueOnly: true, counts: c, state: setEnzymeVisibility(EMPTY, MINE_ID, false) });
      expect(mapCuts(hidden)).toEqual([bam]);
      expect(mapNotes(hidden).join(' ')).toContain('1 site hidden by you');
    });
  }

  it('US-01M7GQZ6 AC1 the identity plate counts the custom "EcoRI" among the unique sites, and never the built-in', () => {
    const plate = (html: string) => /annotations · (\d+) unique sites/.exec(html.replace(/<!-- -->/g, ''))?.[1];
    expect(plate(mapMarkup({ uniqueOnly: true, state: EMPTY }))).toBe('2');
  });

  it('US-01M7GQZ6 AC1 the custom "EcoRI" cutting once is among the callouts the map keeps first, past 32 sites of multi-cutters', () => {
    // BamHI forty times, the built-in EcoRI twice, then the custom "EcoRI" once at the end: only the
    // unique cutter sorted first keeps a callout among the 32 the map draws.
    const seq = [...Array.from({ length: 40 }, (_, i) => filler(12, i + 7) + 'GGATCC'), filler(20, 1), 'GAATTC', filler(20, 2), 'GAATTC', filler(20, 3), 'GTTAAC', filler(30, 4)].join('');
    const doc = { ...DOC, sequence: seq };
    const rev = sequenceRevision(seq, 'circular');
    const scan = scanRestrictionSites(seq, 'circular', [ECO, BAM, MINE]);
    const counts = restrictionSiteCountsByName(scan);
    expect(counts).toEqual({ EcoRI: 2, BamHI: 40, [MINE_ID]: 1 });
    const [mineSite] = byId(scan.sites, MINE_ID);
    const cuts = mapCuts(mapMarkup({ doc, sites: scan.sites, counts, rev, state: emptySiteVisibility(rev) }));
    // At most 32 of the 43 are offered a callout (fewer may fit).
    expect(cuts.length).toBeLessThanOrEqual(32);
    expect(cuts).toContain(`EcoRI (GTTAAC)@${cutSiteDisplayPosition(mineSite.cutTop, seq.length, true)}`);
  });

  it('US-01M7GQZ6 AC1 the custom "EcoRI" is drawn as a unique cutter and the built-in EcoRI as a multi-cutter', () => {
    const html = mapMarkup({});
    const callout = (title: string) => {
      const i = html.indexOf(`<title>${title}`);
      expect(i, title).toBeGreaterThan(-1);
      // The callout's own group: its title, then its leader line and label.
      return html.slice(i, html.indexOf('</g>', i));
    };
    expect(callout(`EcoRI (GTTAAC) cuts after ${cutAfter(MINE1)}`)).toContain('var(--mbc-blue)');
    expect(callout(`EcoRI (GAATTC) cuts after ${cutAfter(ECO1)}`)).not.toContain('var(--mbc-blue)');
  });

  it('US-01M7GQZ6 AC1 a hidden custom "EcoRI" the scan kept only the first sites of counts every one of its sites as hidden', () => {
    // An A-run long enough that the custom AAAA motif passes the engine's per-enzyme position cap.
    const CAP_ID = 'custom:aa11bb22-cc33-4dd4-8ee5-ff6677889900';
    const seq = [filler(40, 1), 'GAATTC', 'A'.repeat(2400), filler(60, 5)].join('');
    const doc = { ...DOC, sequence: seq };
    const rev = sequenceRevision(seq, 'circular');
    const scan = scanRestrictionSites(seq, 'circular', [ECO, custom(CAP_ID, 'AAAA', 2)]);
    const counts = restrictionSiteCountsByName(scan);
    const kept = scan.sites.filter((s) => s.enzyme.id === CAP_ID).length;
    expect(scan.positionsPerEnzymeCap).toBe(kept);
    expect(counts[CAP_ID]).toBeGreaterThan(kept);
    expect(counts.EcoRI).toBe(1);
    const html = mapMarkup({ doc, sites: scan.sites, counts, rev, state: setEnzymeVisibility(emptySiteVisibility(rev), CAP_ID, false) });
    expect(mapNotes(html).join(' ')).toContain(`${counts[CAP_ID].toLocaleString()} sites hidden by you`);
    const builtIn = mapMarkup({ doc, sites: scan.sites, counts, rev, state: setEnzymeVisibility(emptySiteVisibility(rev), 'EcoRI', false) });
    expect(mapNotes(builtIn).join(' ')).toContain('1 site hidden by you');
  });
});

describe('US-01M7GQZ6 AC1: the construct cockpit', () => {
  const cockpit = (opts: { counts?: Record<string, number>; sites?: RestrictionCutSite[]; doc?: SequenceDocument } = {}) => {
    const doc = opts.doc ?? DOC;
    return renderToStaticMarkup(
      <ConstructCockpitBar doc={doc} cutSites={opts.sites ?? SCAN.sites} siteCounts={opts.counts} selectedRange={{ start: 1, end: doc.sequence.length }} onSelectRange={() => {}} />
    );
  };
  const textOf = (html: string) => html.replace(/<[^>]+>/g, '').trim();
  const cutters = (html: string) => textOf(/1× Cutters:[\s\S]*?<\/span>/.exec(html)?.[0] ?? '').replace(/^1× Cutters:\s*/, '');
  const ticks = (html: string) => [...html.matchAll(/<title>Unique cutter: (\S+) @ (\d+)/g)].map((m) => `${m[1]}@${m[2]}`).sort();

  for (const counts of ['the scan\'s counts', 'no counts'] as const) {
    it(`US-01M7GQZ6 AC1 the span's single cutters and the horizon ticks are the custom "EcoRI" and BamHI, never the built-in EcoRI, by ${counts}`, () => {
      const html = cockpit({ counts: counts === 'no counts' ? undefined : COUNTS });
      expect(cutters(html)).toBe('EcoRI, BamHI');
      expect(ticks(html)).toEqual([`BamHI@${BAM1.position}`, `EcoRI@${MINE1.position}`]);
    });
  }

  it('US-01M7GQZ6 AC1 a built-in and a custom enzyme of one name, each cutting once, are two single cutters', () => {
    const seq = [filler(40, 1), 'GAATTC', filler(50, 2), 'GTTAAC', filler(60, 5)].join('');
    const doc = { ...DOC, sequence: seq };
    const scan = scanRestrictionSites(seq, 'circular', [ECO, MINE]);
    const counts = restrictionSiteCountsByName(scan);
    expect(counts).toEqual({ EcoRI: 1, [MINE_ID]: 1 });
    const html = cockpit({ doc, sites: scan.sites, counts });
    expect(cutters(html)).toBe('EcoRI, EcoRI');
    expect(ticks(html)).toEqual(['EcoRI@41', 'EcoRI@97']);
  });
});

// ─── AC2: a session saved before ids reads back unchanged ───

/**
 * A session as the App saved it before this change: the envelope serializeMbcWorkbench wrote at
 * 5ef9d54, field for field and in its order, re-encoded here by JSON.stringify (its `100.0` zoom reads 100):
 * pAdaeze with BamHI and EcoRI hidden by name, and the EcoRI site at 41 shown again inside its
 * hidden enzyme, keyed `EcoRI@41+#<revision>`.
 */
const PRE_CHANGE_SESSION = JSON.stringify({
  format: 'MolBioCraft-Workbench', magic: 'MBC_WORKBENCH_V1', schemaVersion: '1.0.0', appVersion: '1.0.0', license: 'CC-BY-NC-4.0',
  savedAt: '2026-11-16T02:53:18.171Z', sessionName: 'Adaeze before custom enzymes', documentCount: 1, totalBasePairs: 274,
  checksumFnv1a: '383ad6c7', checksumCrc32: 'fc57a1c1',
  workspace: {
    activeDocId: 'adaeze-construct', selectedFolder: 'All Project Files', navHistory: ['adaeze-construct'], navIndex: 0,
    viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100.0, textFormat: 'genbank', colorScheme: 'standard',
    darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
    displaySettings: { showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
    siteVisibility: {
      'adaeze-construct': {
        hiddenEnzymes: ['BamHI', 'EcoRI'],
        occurrences: { 'EcoRI@41+#c274.25o8crqfpef': { enzyme: 'EcoRI', shown: true } },
        revision: 'c274.25o8crqfpef',
      },
    },
  },
  documents: [
    {
      id: 'adaeze-construct', name: 'pAdaeze', accession: '', description: '', moleculeType: 'DNA', topology: 'circular',
      sequence: 'AACCAACCACAACCACCACCAAAAACCAACCAACACACCCGAATTCAAACCAAACCCACCAAAACACCCAAAAAAACAACCAACCCCCCCAACCCAGTTAACACCCACCAACACCCCCAAAACAAAACCCCCAAAAAAACCAACAACAACACGGATCCACCCACAACCCACCCAAACAACACAAACCCCCACCAAACAACCAAACAACGAATTCACACCAAAACAAACACAACACACCCACACAACAACACAAACCACAAAACAAAAAACAACC',
      features: [], primers: [], history: [], createdAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-15T08:00:00.000Z', folder: 'Plasmids & Vectors',
    },
  ],
});
const SAVED_STATE: SiteVisibility = {
  revision: 'c274.25o8crqfpef',
  hiddenEnzymes: ['BamHI', 'EcoRI'],
  occurrences: { 'EcoRI@41+#c274.25o8crqfpef': { enzyme: 'EcoRI', shown: true } },
};

describe('US-01M7GQZ6 AC2: a session saved before ids reads back with the same enzymes hidden and the same sites shown', () => {
  const open = () => {
    const parsed = parseMbcWorkbench(PRE_CHANGE_SESSION);
    const revisionOf = (d: SequenceDocument) => sequenceRevision(d.sequence, d.topology);
    return { parsed, restored: restoredSiteVisibility(parsed.envelope.workspace.siteVisibility, parsed.envelope.documents, revisionOf) };
  };

  it('US-01M7GQZ6 AC2 the payload is the fixture construct, read with a verified checksum', () => {
    const { parsed } = open();
    expect(parsed.checksumVerified).toBe(true);
    expect(parsed.envelope.documents[0].sequence).toBe(SEQ);
    expect(REV).toBe(SAVED_STATE.revision);
  });

  it('US-01M7GQZ6 AC2 the restored choices are the saved ones, byte for byte: each hidden name is the built-in\'s id', () => {
    const { restored } = open();
    expect(restored).toEqual({ 'adaeze-construct': SAVED_STATE });
    for (const name of restored['adaeze-construct'].hiddenEnzymes) {
      expect(SCAN.sites.filter((s) => s.enzyme.name === name && s.enzyme.source === 'builtin').every((s) => enzymeKey(s.enzyme) === name)).toBe(true);
    }
    expect(Object.keys(restored['adaeze-construct'].occurrences)).toEqual([siteOccurrenceId(ECO1, REV)]);
  });

  it('US-01M7GQZ6 AC2 on the built-in scan it was saved over, the same sites are shown: EcoRI at 41 alone', () => {
    const { restored } = open();
    const builtInScan = scanRestrictionSites(SEQ, 'circular', [ECO, BAM]);
    expect(shown(builtInScan.sites, restored['adaeze-construct'])).toEqual([at(ECO1)]);
  });

  it('US-01M7GQZ6 AC2 a custom "EcoRI" added since is not hidden by the built-in\'s saved name, on the helpers, the panel and the map', () => {
    const state = open().restored['adaeze-construct'];
    expect(shown(SCAN.sites, state)).toEqual([at(ECO1), at(MINE1)].sort());
    const rows = displayedSitesRows(SCAN.sites, COUNTS, state, { query: '', uniqueCuttersOnly: false, shownOnly: false }, MOLECULE);
    expect(rows.map((r) => [r.key, r.state])).toEqual([['BamHI', 'hidden'], ['EcoRI', 'mixed'], [MINE_ID, 'shown']]);
    expect(mapCuts(mapMarkup({ state }))).toEqual([`EcoRI (GAATTC)@${cutAfter(ECO1)}`, `EcoRI (GTTAAC)@${cutAfter(MINE1)}`].sort());
  });

  it('US-01M7GQZ6 AC2 saved again, the session writes the same choices back', () => {
    const { parsed, restored } = open();
    const env = parsed.envelope;
    const again = parseMbcWorkbench(
      serializeMbcWorkbench({ sessionName: env.sessionName, documents: env.documents, workspace: { ...env.workspace, siteVisibility: siteVisibilityForSession(restored, env.documents) } })
    ).envelope;
    expect(again.workspace.siteVisibility).toEqual({ 'adaeze-construct': SAVED_STATE });
  });
});
