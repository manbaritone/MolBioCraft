// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC7J: the Displayed restriction sites panel. Every site is the real engine's record
 * (scanRestrictionSites over public/molbiocraft_wasm.wasm). The panel is rendered with
 * renderToStaticMarkup; its handlers are read off the elements its render creates (the element
 * probe of cleavagePreview.test.tsx) and called by hand.
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

const { DisplayedSitesPanel, DISPLAYED_SITES_RENDER_LIMIT, clearedChoiceCount, clearedChoicesNotice, displayedSitesRows } = await import(
  '../components/DisplayedSitesPanel'
);
const { restrictionSiteCountsByName, scanRestrictionSites } = await import('../core/bioEngine');
const {
  applySiteVisibility,
  cutSiteDisplayPosition,
  emptySiteVisibility,
  reconcileSiteVisibility,
  sequenceRevision,
  setEnzymeVisibility,
  setOccurrenceVisibility,
  siteOccurrenceId,
} = await import('../core/restrictionDisplay');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SiteVisibility = import('../core/restrictionDisplay').SiteVisibility;
type RestrictionCutSite = import('../types/bio').RestrictionCutSite;
type Props = import('../components/DisplayedSitesPanel').DisplayedSitesPanelProps;

afterEach(() => {
  probe.onElement = null;
});

// The fixture: a sample plasmid scanned with the whole catalogue, as the App scans it.
const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000)!;
const scan = scanRestrictionSites(plasmid.sequence, 'circular');
const SITES = scan.sites;
const COUNTS = restrictionSiteCountsByName(scan);
const MOLECULE = { revision: sequenceRevision(plasmid.sequence, 'circular'), seqLen: plasmid.sequence.length, circular: true };
const EMPTY = emptySiteVisibility(MOLECULE.revision);
const namesOf = (sites: readonly RestrictionCutSite[]) => [...new Set(sites.map((s) => s.enzyme.name))];
const keptOf = (name: string) => SITES.filter((s) => s.enzyme.name === name);
/** An enzyme the scan kept exactly `n` sites of, all of them counted. */
const enzymeWith = (n: number) => namesOf(SITES).find((name) => keptOf(name).length === n && COUNTS[name] === n)!;
const TWICE = enzymeWith(2);
const THRICE = enzymeWith(3);
const ONCE = enzymeWith(1);
const shownByUser = (v: SiteVisibility) => new Set(applySiteVisibility(SITES, MOLECULE.revision, v, { uniqueCuttersOnly: false }).displayed);

/** The panel's markup and every element it created with the props it was given. */
function render(overrides: Partial<Props> = {}) {
  const changes: SiteVisibility[] = [];
  const gone: RestrictionCutSite[] = [];
  const elements: { type: unknown; props: Record<string, unknown> }[] = [];
  const props: Props = {
    sites: SITES,
    siteCounts: COUNTS,
    visibility: EMPTY,
    molecule: MOLECULE,
    uniqueCuttersOnly: false,
    onVisibilityChange: (v) => changes.push(v),
    onGoToSite: (s) => gone.push(s),
    ...overrides,
  };
  probe.onElement = (type, p) => elements.push({ type, props: p });
  const html = renderToStaticMarkup(<DisplayedSitesPanel {...props} />);
  probe.onElement = null;
  const labelled = (label: string | RegExp) => {
    const hit = elements.filter((e) => (typeof label === 'string' ? e.props['aria-label'] === label : label.test(String(e.props['aria-label'] ?? ''))));
    return hit;
  };
  const one = (label: string) => {
    const hit = labelled(label);
    expect(hit, `one element labelled ${label}`).toHaveLength(1);
    return hit[0].props;
  };
  const check = (label: string, checked: boolean) =>
    (one(label).onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked } });
  const click = (label: string | RegExp) => {
    const hit = typeof label === 'string' ? [{ props: one(label) }] : labelled(label);
    expect(hit).toHaveLength(1);
    (hit[0].props.onClick as () => void)();
  };
  return { html, elements, changes, gone, one, labelled, check, click };
}

const occLabel = (s: RestrictionCutSite, circular = true, len = MOLECULE.seqLen) =>
  `Show ${s.enzyme.name} at ${cutSiteDisplayPosition(s.cutTop, len, circular)}, ${s.strand === -1 ? 'reverse' : 'forward'} strand`;

describe('displayed sites fixture', () => {
  it('has a once, twice and thrice cutter, and more matching enzymes than the panel draws', () => {
    expect([ONCE, TWICE, THRICE].every(Boolean)).toBe(true);
    expect(namesOf(SITES).length).toBeGreaterThan(DISPLAYED_SITES_RENDER_LIMIT);
  });
});

describe('US-01M7CC7J AC1: search, enzyme rows and occurrences', () => {
  it('US-01M7CC7J AC1 the search keeps exactly the enzymes whose name holds it, in any case', () => {
    const q = TWICE.slice(0, 3).toUpperCase();
    const rows = displayedSitesRows(SITES, COUNTS, EMPTY, { query: q, uniqueCuttersOnly: false, shownOnly: false }, MOLECULE);
    const expected = namesOf(SITES).filter((n) => n.toLowerCase().includes(q.toLowerCase()));
    expect(rows.map((r) => r.name).sort()).toEqual(expected.sort());
    expect(rows.length).toBeLessThan(namesOf(SITES).length);
    const { html } = render({ initialQuery: q });
    for (const n of expected) expect(html).toContain(`aria-label="Show ${n} sites on the maps"`);
    const other = namesOf(SITES).find((n) => !n.toLowerCase().includes(q.toLowerCase()))!;
    expect(html).not.toContain(`aria-label="Show ${other} sites on the maps"`);
  });

  it('US-01M7CC7J AC1 each enzyme shows its recognition sequence, site count and a checkbox', () => {
    const { html, one } = render({ initialQuery: TWICE });
    const motif = REBASE_ENZYMES.find((e) => e.name === TWICE)!.recognitionSeq;
    expect(html).toContain(`<code class="mbc-dsites-motif">${motif}</code>`);
    expect(html).toContain('2 sites');
    const box = one(`Show ${TWICE} sites on the maps`);
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
  });

  it('US-01M7CC7J AC1 a multi-cutter expands into its occurrences, each with position, strand and its own checkbox', () => {
    const collapsed = render({ initialQuery: THRICE });
    for (const s of keptOf(THRICE)) expect(collapsed.labelled(occLabel(s))).toHaveLength(0);
    collapsed.click(`Expand the 3 sites of ${THRICE}`);
    const open = render({ initialQuery: THRICE, initialExpanded: [THRICE] });
    expect(open.one(`Collapse the 3 sites of ${THRICE}`)['aria-expanded']).toBe(true);
    for (const s of keptOf(THRICE)) {
      const box = open.one(occLabel(s));
      expect(box.type).toBe('checkbox');
      expect(open.html).toContain(`>${cutSiteDisplayPosition(s.cutTop, MOLECULE.seqLen, true).toLocaleString()}</span>`);
    }
    // A single cutter has no expand toggle.
    const single = render({ initialQuery: ONCE, initialExpanded: [ONCE] });
    expect(single.labelled(/^Expand the .* of /).filter((e) => String(e.props['aria-label']).endsWith(` ${ONCE}`))).toHaveLength(0);
  });

  it('US-01M7CC7J AC1 an occurrence is numbered as the site list numbers it, by topology', () => {
    // EcoRI G^AATTC across base 1: the cut falls before base 1, after the last base of the circle.
    const seq = 'AATTC' + 'ACCA'.repeat(30) + 'G';
    const eco = REBASE_ENZYMES.find((e) => e.name === 'EcoRI')!;
    const circ = scanRestrictionSites(seq, 'circular', [eco]).sites;
    expect(circ).toHaveLength(1);
    expect(circ[0].cutTop).toBe(1);
    const mol = (circular: boolean) => ({ revision: sequenceRevision(seq, 'circular'), seqLen: seq.length, circular });
    const at = (circular: boolean) =>
      displayedSitesRows(circ, { EcoRI: 1 }, emptySiteVisibility(mol(true).revision), { query: '', uniqueCuttersOnly: false, shownOnly: false }, mol(circular))[0]
        .occurrences[0].displayPosition;
    expect(at(true)).toBe(seq.length);
    expect(at(false)).toBe(0);
  });
});

describe('US-01M7CC7J AC2: bulk actions over every match, Shown only and counts', () => {
  it('US-01M7CC7J AC2 Hide filtered hides every matching enzyme, the undrawn ones included', () => {
    const r = render();
    expect(r.html.match(/class="mbc-dsites-row"/g)).toHaveLength(DISPLAYED_SITES_RENDER_LIMIT);
    r.click(/^Hide filtered: /);
    const next = r.changes[0];
    expect(shownByUser(next).size).toBe(0);
    expect(next.hiddenEnzymes.sort()).toEqual(namesOf(SITES).sort());
    // And Show filtered brings every one back.
    const back = render({ visibility: next });
    back.click(/^Show filtered: /);
    expect(shownByUser(back.changes[0]).size).toBe(SITES.length);
  });

  it('US-01M7CC7J AC2 bulk actions act on the search\'s matches and nothing else', () => {
    const q = TWICE.slice(0, 2).toLowerCase();
    const r = render({ initialQuery: q });
    r.click(/^Hide filtered: /);
    const hidden = SITES.filter((s) => !shownByUser(r.changes[0]).has(s));
    expect(namesOf(hidden).sort()).toEqual(namesOf(SITES).filter((n) => n.toLowerCase().includes(q)).sort());
  });

  it('US-01M7CC7J AC2 with the unique-cutter filter, bulk actions reach single cutters only', () => {
    const r = render({ uniqueCuttersOnly: true });
    r.click(/^Hide filtered: /);
    const shown = shownByUser(r.changes[0]);
    for (const s of SITES) expect(shown.has(s), s.enzyme.name).toBe(COUNTS[s.enzyme.name] !== 1);
  });

  it('US-01M7CC7J AC2 Shown only lists drawn sites, and its bulk hide reaches only those', () => {
    const [a, b, c] = keptOf(THRICE);
    let v = setOccurrenceVisibility(EMPTY, a, false);
    v = setEnzymeVisibility(v, TWICE, false);
    const rows = displayedSitesRows(SITES, COUNTS, v, { query: '', uniqueCuttersOnly: false, shownOnly: true }, MOLECULE);
    expect(rows.map((x) => x.name)).not.toContain(TWICE);
    const thrice = rows.find((x) => x.name === THRICE)!;
    expect(thrice.occurrences.map((o) => o.site)).toEqual([b, c].sort((x, y) => x.position - y.position));
    expect(thrice.state).toBe('mixed');
    const r = render({ visibility: v, initialShownOnly: true, initialQuery: THRICE });
    expect(r.html).toMatch(/<input type="checkbox" checked=""\/><span>Shown only<\/span>/);
    r.click(/^Hide filtered: /);
    expect(keptOf(THRICE).some((s) => shownByUser(r.changes[0]).has(s))).toBe(false);
    // The other enzymes' choices are as they were.
    expect(r.changes[0].hiddenEnzymes).toContain(TWICE);
  });

  it('US-01M7CC7J AC2 Reset display clears the matching enzymes\' choices and keeps the others\'', () => {
    let v = setOccurrenceVisibility(EMPTY, keptOf(THRICE)[0], false);
    v = setEnzymeVisibility(v, TWICE, false);
    v = setEnzymeVisibility(v, ONCE, false);
    const r = render({ visibility: v, initialQuery: THRICE });
    r.click(/^Reset display: /);
    const next = r.changes[0];
    expect(Object.keys(next.occurrences)).not.toContain(siteOccurrenceId(keptOf(THRICE)[0], MOLECULE.revision));
    expect(next.hiddenEnzymes).toEqual([ONCE, TWICE].filter((n) => !n.toLowerCase().includes(THRICE.toLowerCase())).sort());
  });

  it('US-01M7CC7J AC2 the summary tells detected, filtered-out, hidden-by-user and shown apart', () => {
    const v = setEnzymeVisibility(setOccurrenceVisibility(EMPTY, keptOf(TWICE)[0], false), ONCE, false);
    const { counts } = applySiteVisibility(SITES, MOLECULE.revision, v, { uniqueCuttersOnly: true, siteCounts: COUNTS });
    expect(counts.detected - counts.eligible).toBeGreaterThan(0);
    expect(counts.hiddenByUser).toBe(1);
    const { html } = render({ visibility: v, uniqueCuttersOnly: true });
    expect(html).toContain(
      `${counts.detected.toLocaleString()} detected · ${(counts.detected - counts.eligible).toLocaleString()} filtered out · 1 hidden by you · ${counts.shown.toLocaleString()} shown`
    );
  });
});

describe('US-01M7CC7J AC3: Go to site is its own action', () => {
  it('US-01M7CC7J AC3 no checkbox goes to a site, and every one changes the visibility', () => {
    const r = render({ initialQuery: THRICE, initialExpanded: [THRICE] });
    const boxes = r.elements.filter((e) => e.type === 'input' && e.props.type === 'checkbox' && /^Show /.test(String(e.props['aria-label'] ?? '')));
    expect(boxes.length).toBe(1 + keptOf(THRICE).length);
    for (const b of boxes) (b.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    expect(r.gone).toEqual([]);
    expect(r.changes).toHaveLength(boxes.length);
    expect(shownByUser(r.changes[0]).has(keptOf(THRICE)[0])).toBe(false);
  });

  it('US-01M7CC7J AC3 Go to site goes to that site and changes no visibility', () => {
    const r = render({ initialQuery: THRICE, initialExpanded: [THRICE] });
    const target = keptOf(THRICE)[1];
    r.click(`Go to ${THRICE} site cutting after ${cutSiteDisplayPosition(target.cutTop, MOLECULE.seqLen, true)}, ${target.strand === -1 ? 'reverse' : 'forward'} strand`);
    expect(r.gone).toEqual([target]);
    expect(r.changes).toEqual([]);
    const single = render({ initialQuery: ONCE });
    const site = keptOf(ONCE)[0];
    single.click(`Go to ${ONCE} site cutting after ${cutSiteDisplayPosition(site.cutTop, MOLECULE.seqLen, true)}`);
    expect(single.gone).toEqual([site]);
  });

  it('US-01M7CC7J AC3 the App keeps a visibility change to the document\'s choices, away from the selection and view', async () => {
    const fs = await vi.importActual<{ readFileSync: (p: URL, e: string) => string }>('node:fs');
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const panel = app.match(/<DisplayedSitesPanel[\s\S]*?\/>/);
    expect(panel, 'the App renders the panel').not.toBeNull();
    expect(panel![0]).toMatch(/onVisibilityChange=\{handleSiteVisibilityChange\}/);
    const handler = app.match(/const handleSiteVisibilityChange = useCallback\(([\s\S]*?)\n {2}\);/);
    expect(handler, 'the handler is defined').not.toBeNull();
    expect(handler![1]).toMatch(/setSiteVisibilityByDoc/);
    expect(handler![1]).not.toMatch(/setSelectedRange|scroll|setViewer|setCursor|setActive/);
  });
});

describe('US-01M7CC7J AC3: choices are written at the scan\'s revision, and a cleared choice is told', () => {
  it('US-01M7CC7J AC3 a checkbox given choices of an older revision stores its choice under the current site id', () => {
    const old = sequenceRevision('ACGT' + plasmid.sequence, 'circular');
    let stale = setEnzymeVisibility(emptySiteVisibility(old), ONCE, false);
    stale = setOccurrenceVisibility(stale, keptOf(TWICE)[0], false);
    const site = keptOf(THRICE)[1];
    const r = render({ visibility: stale, initialQuery: THRICE, initialExpanded: [THRICE] });
    r.check(occLabel(site), false);
    const next = r.changes[0];
    expect(next.revision).toBe(MOLECULE.revision);
    expect(Object.keys(next.occurrences)).toEqual([siteOccurrenceId(site, MOLECULE.revision)]);
    expect(shownByUser(next).has(site)).toBe(false);
    expect(next.hiddenEnzymes).toEqual([ONCE]);
  });

  it('US-01M7CC7J AC3 the choices an edit clears are counted and told in words', () => {
    const before = setOccurrenceVisibility(setOccurrenceVisibility(EMPTY, keptOf(THRICE)[0], false), keptOf(TWICE)[1], false);
    const edited = 'ACGT' + plasmid.sequence;
    const rev = sequenceRevision(edited, 'circular');
    const after = reconcileSiteVisibility(before, scanRestrictionSites(edited, 'circular').sites, rev);
    expect(clearedChoiceCount(before, after)).toBe(2);
    expect(clearedChoiceCount(before, reconcileSiteVisibility(before, SITES, MOLECULE.revision))).toBe(0);
    expect(clearedChoicesNotice(2)).toMatch(/^2 per-site display choices were cleared/);
    expect(clearedChoicesNotice(1)).toMatch(/^1 per-site display choice was cleared/);
  });

  it('US-01M7CC7J AC3 the App hashes the scanned string once per version and tells cleared choices in the status line', async () => {
    const fs = await vi.importActual<{ readFileSync: (p: URL, e: string) => string }>('node:fs');
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const molecule = app.match(/const restrictionMolecule = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[/);
    expect(molecule).not.toBeNull();
    expect(molecule![1]).toMatch(/restrictionRevisionCache\.current/);
    expect(molecule![1]).toMatch(/sequenceRevision\(firstBp \? activeDoc\.sequence\.slice\(0, firstBp\) : activeDoc\.sequence, topology\)/);
    expect(app).toMatch(/if \(cleared > 0\) setStatusBanner\(clearedChoicesNotice\(cleared\)\);/);
  });
});

describe('US-01M7CC7J AC4: labels and keyboard reach', () => {
  it('US-01M7CC7J AC4 every control is a native, focusable button or input with an accessible name', () => {
    const v = setOccurrenceVisibility(EMPTY, keptOf(THRICE)[0], false);
    const r = render({ visibility: v, initialExpanded: namesOf(SITES) });
    const controls = r.elements.filter((e) => typeof e.props.onClick === 'function' || typeof e.props.onChange === 'function');
    expect(controls.length).toBeGreaterThan(DISPLAYED_SITES_RENDER_LIMIT);
    for (const c of controls) {
      expect(['button', 'input']).toContain(c.type);
      expect(c.props.tabIndex === undefined || Number(c.props.tabIndex) >= 0).toBe(true);
    }
    // Every control is named: by aria-label, or (Shown only) by the label wrapping it.
    for (const tag of r.html.match(/<(button|input)\b[^>]*>/g)!) {
      if (/aria-label="[^"]+"/.test(tag)) continue;
      expect(r.html).toContain(`${tag}<span>Shown only</span></label>`);
    }
    expect(r.html).not.toContain('tabindex="-1"');
    // The kinds the story names are each present and labelled.
    for (const label of [/^Search enzymes by name$/, /^Show .* sites on the maps$/, /^(Expand|Collapse) the \d+ sites of /, /^Go to /, /^Show filtered: /, /^Hide filtered: /, /^Reset display: /, /^Show .* at \d+, (forward|reverse) strand$/]) {
      expect(r.labelled(label).length, String(label)).toBeGreaterThan(0);
    }
    // A mixed enzyme says so to assistive technology.
    expect(r.one(`Show ${THRICE} sites on the maps`)['aria-checked']).toBe('mixed');
    expect(r.one(`Collapse the 3 sites of ${THRICE}`)['aria-controls']).toBeTruthy();
  });
});
