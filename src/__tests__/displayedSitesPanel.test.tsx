// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC7J: the Displayed restriction sites panel. Every site is the real engine's record
 * (scanRestrictionSites over public/molbiocraft_wasm.wasm). The panel is rendered with
 * renderToStaticMarkup; its handlers are read off the elements its render creates (the element
 * probe of cleavagePreview.test.tsx) and called by hand. The App's own wiring of the panel (a
 * cleared choice told after an edit, Go to site, an enzyme checkbox) is driven through the real App
 * over the live DOM (appHarness.tsx), never read off App.tsx's source (BG-01M7DH6B).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

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
      `${counts.detected.toLocaleString()} detected · ${(counts.detected - counts.eligible).toLocaleString()} filtered out · 1 hidden by you (1 more held under the unique-cutter filter) · ${counts.shown.toLocaleString()} shown`
    );
  });

  it('BG-01M7DH9X AC1 the hides the unique-cutter filter holds are counted, and only while it is on', () => {
    // Every multi-cutter hidden: the filter takes them all off the maps, and the summary says how
    // many of the user's hides it holds rather than reading 0 hidden by you.
    const multi = namesOf(SITES).filter((n) => COUNTS[n] !== 1);
    const v = multi.reduce((st, n) => setEnzymeVisibility(st, n, false), EMPTY);
    const heldSites = SITES.filter((s) => COUNTS[s.enzyme.name] !== 1).length;
    expect(heldSites).toBeGreaterThan(1);
    const on = render({ visibility: v, uniqueCuttersOnly: true }).html;
    expect(on).toContain(` · 0 hidden by you (${heldSites.toLocaleString()} more held under the unique-cutter filter) · `);
    const off = render({ visibility: v, uniqueCuttersOnly: false }).html;
    expect(off).toContain(` · ${heldSites.toLocaleString()} hidden by you · `);
    expect(off).not.toContain('held under');
    expect(render({ uniqueCuttersOnly: true }).html).not.toContain('held under');
  });
});

describe('BG-01M7DH9X: a mixed enzyme reads as indeterminate', () => {
  it('BG-01M7DH9X AC1 a mixed enzyme\'s checkbox is clear, indeterminate and mixed, and a click on it shows every site', () => {
    const mixed = setOccurrenceVisibility(EMPTY, keptOf(THRICE)[0], false);
    const r = render({ visibility: mixed, initialQuery: THRICE });
    const box = r.one(`Show ${THRICE} sites on the maps`);
    expect(box.checked, 'drawn clear, so a click ticks it').toBe(false);
    expect(box['aria-checked']).toBe('mixed');
    const el = { indeterminate: false };
    (box.ref as (e: unknown) => void)(el);
    expect(el.indeterminate).toBe(true);
    // The click ticks it: every site shown, its sites' own choices cleared. A browser that reports
    // the click as a clear (an indeterminate box that was ticked) still shows them all.
    for (const checked of [true, false]) {
      const next = render({ visibility: mixed, initialQuery: THRICE });
      next.check(`Show ${THRICE} sites on the maps`, checked);
      expect(next.changes[0].occurrences).toEqual({});
      expect(next.changes[0].hiddenEnzymes).toEqual([]);
      expect(keptOf(THRICE).every((s) => shownByUser(next.changes[0]).has(s))).toBe(true);
    }
    // A shown enzyme is ticked and not indeterminate; a hidden one clear.
    const shown = render({ initialQuery: THRICE }).one(`Show ${THRICE} sites on the maps`);
    expect([shown.checked, shown['aria-checked']]).toEqual([true, undefined]);
    const hidden = render({ visibility: setEnzymeVisibility(EMPTY, THRICE, false), initialQuery: THRICE }).one(`Show ${THRICE} sites on the maps`);
    expect([hidden.checked, hidden['aria-checked']]).toEqual([false, undefined]);
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

  it('US-01M7CC7J AC3 the App hashes the scanned string once per version', async () => {
    const fs = await vi.importActual<{ readFileSync: (p: URL, e: string) => string }>('node:fs');
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const molecule = app.match(/const restrictionMolecule = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[/);
    expect(molecule).not.toBeNull();
    expect(molecule![1]).toMatch(/restrictionRevisionCache\.current/);
    expect(molecule![1]).toMatch(/sequenceRevision\(firstBp \? activeDoc\.sequence\.slice\(0, firstBp\) : activeDoc\.sequence, topology\)/);
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

describe('BG-01M7DH6B: a reverse-strand occurrence is labelled reverse', () => {
  // The engine's own records for BsmBI-v2 (CGTCTC(1/5)) on pET-28a(+)-eGFP: two of its three sites
  // are on the reverse strand, so a panel that called every site forward fails here.
  const BSMBI = 'BsmBI-v2';

  it('BG-01M7DH6B AC1 the fixture is the engine\'s scan of pET-28a(+)-eGFP, with BsmBI-v2 cutting on both strands', () => {
    expect(plasmid.name).toBe('pET-28a(+)-eGFP');
    expect(keptOf(BSMBI).map((s) => [cutSiteDisplayPosition(s.cutTop, MOLECULE.seqLen, true), s.strand])).toEqual([
      [923, -1],
      [2500, 1],
      [3627, -1],
    ]);
    expect(COUNTS[BSMBI]).toBe(3);
  });

  it('BG-01M7DH6B AC1 each occurrence\'s checkbox, strand word and Go to name its own strand', () => {
    const r = render({ initialQuery: 'BsmBI', initialExpanded: [BSMBI] });
    for (const [pos, strand] of [[923, 'reverse'], [2500, 'forward'], [3627, 'reverse']] as const) {
      expect(r.one(`Show ${BSMBI} at ${pos}, ${strand} strand`).type).toBe('checkbox');
      r.one(`Go to ${BSMBI} site cutting after ${pos}, ${strand} strand`);
    }
    expect([...r.html.matchAll(/<span class="mbc-dsites-strand">(\w+)<\/span>/g)].map((m) => m[1])).toEqual(['reverse', 'forward', 'reverse']);
  });
});

describe('BG-01M7DH6B: an enzyme checkbox sets the enzyme\'s choice', () => {
  it('BG-01M7DH6B AC1 clearing a multi-cutter\'s checkbox hides the enzyme, not each of its sites', () => {
    const r = render({ initialQuery: TWICE });
    r.check(`Show ${TWICE} sites on the maps`, false);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].hiddenEnzymes).toEqual([TWICE]);
    expect(r.changes[0].occurrences).toEqual({});
    // Ticked again, its sites' own choices are cleared with it.
    const mixed = setOccurrenceVisibility(EMPTY, keptOf(TWICE)[0], false);
    const back = render({ visibility: mixed, initialQuery: TWICE });
    back.check(`Show ${TWICE} sites on the maps`, true);
    expect(back.changes[0].hiddenEnzymes).toEqual([]);
    expect(back.changes[0].occurrences).toEqual({});
  });
});

// ─── The App's wiring of the panel, through the real App ───

const textOf = (el: LiveElement) => el.textContent ?? '';

/** The Displayed restriction sites panel of a mounted App, driven as a user drives it. */
interface PanelDriver {
  /** Types `query` into the panel's search. */
  search(query: string): Promise<void>;
  /** The one checkbox or button labelled `label`. */
  control(label: string): LiveElement;
  /** Expands a multi-cutter's occurrences (no-op when already open). */
  expand(name: string, sites: number): Promise<void>;
  /** The panel's detected / filtered out / hidden by you / shown line. */
  counts(): string;
  /** Every status-line notice now shown. */
  notices(): string[];
  /** The Sequence tab's selection readout, or null when nothing is selected. */
  selection(): string | null;
  /** Ticks or clears Shown only. */
  shownOnly(on: boolean): Promise<void>;
  /** The enzymes the panel lists, in order. */
  enzymes(): string[];
  /** What has keyboard focus: an element's aria-label, or 'body' when focus was lost. */
  focused(): string;
}

/**
 * Mounts the App with pET-28a(+)-eGFP restored on the Sequence tab, every enzyme listed (the
 * unique-cutter filter off), and runs `run` against its Displayed restriction sites panel.
 */
async function withPanelApp(run: (panel: PanelDriver, app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await app.restoreSession({
      documents: [plasmid],
      activeDocId: plasmid.id,
      viewerTab: 'sequence-view',
      workspace: {
        mapLayoutMode: 'split',
        displaySettings: {
          showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    });
    await app.settle();
    const control = (label: string) => app.one(`[aria-label="${label}"]`, label);
    const panel: PanelDriver = {
      search: (query) => app.input(control('Search enzymes by name'), query),
      control,
      expand: async (name, sites) => {
        if (app.all(`button[aria-label="Expand the ${sites} sites of ${name}"]`).length) await app.click(control(`Expand the ${sites} sites of ${name}`));
        control(`Collapse the ${sites} sites of ${name}`);
      },
      counts: () => textOf(app.one('section[aria-label="Displayed restriction sites"] .mbc-dsites-counts', 'the panel\'s counts')).replace(/\s+/g, ' ').trim(),
      notices: () => app.all('.statusbar-toast-text').map(textOf),
      selection: () => {
        const found = app.all('.mbc-selection-readout');
        expect(found.length, 'at most one selection readout').toBeLessThanOrEqual(1);
        return found.length ? textOf(found[0]) : null;
      },
      shownOnly: (on) => app.change(app.one('section[aria-label="Displayed restriction sites"] label.mbc-dsites-check input', 'Shown only'), on),
      enzymes: () => app.all('section[aria-label="Displayed restriction sites"] .mbc-dsites-name').map(textOf),
      focused: () => {
        const el = app.doc.activeElement as LiveElement;
        return el === (app.doc.body as unknown) ? 'body' : el.getAttribute('aria-label') ?? `<${el.localName}>`;
      },
    };
    await run(panel, app);
  } finally {
    app.unmount();
  }
}

describe('BG-01M7DH6B: the App\'s wiring of the panel', () => {
  vi.setConfig({ testTimeout: 120_000 });

  it('BG-01M7DH6B AC1 in the App, a checkbox changes only what is drawn and Go to site selects that site\'s recognition span', async () => {
    await withPanelApp(async (panel, app) => {
      expect(panel.selection(), 'nothing is selected at first').toBeNull();
      const none = panel.counts();
      expect(none).toContain(' 0 hidden by you ');
      await panel.search('BsmBI');
      await panel.expand('BsmBI-v2', 3);
      // A checkbox records a choice: the summary counts it, and nothing is selected.
      await app.change(panel.control('Show BsmBI-v2 at 2500, forward strand'), false);
      expect(panel.counts()).toContain(' 1 hidden by you ');
      expect(panel.selection()).toBeNull();
      // Go to site on the reverse-strand site cutting after 923: its recognition site GAGACG (CGTCTC
      // read on the other strand) is bases 929..934, and the choices are as they were.
      expect(plasmid.sequence.slice(928, 934)).toBe('GAGACG');
      await app.click(panel.control('Go to BsmBI-v2 site cutting after 923, reverse strand'));
      expect(panel.selection()).toBe('929..934 (6 bp) • BsmBI-v2 cuts after 923');
      expect(panel.counts()).toContain(' 1 hidden by you ');
    });
  });

  it('BG-01M7DH6B AC1 in the App, an edit clears the per-site choices and says so, and keeps the enzyme choices', async () => {
    await withPanelApp(async (panel, app) => {
      // Hide a two-site enzyme by its checkbox, and one site of a three-site enzyme by its own.
      await panel.search(TWICE);
      await app.change(panel.control(`Show ${TWICE} sites on the maps`), false);
      await panel.search(THRICE);
      await panel.expand(THRICE, 3);
      const site = keptOf(THRICE)[0];
      await app.change(panel.control(occLabel(site)), false);
      expect(panel.counts()).toContain(' 3 hidden by you ');
      expect(panel.notices().join(' ')).not.toContain('per-site display');

      // Reverse Complement: the same sites, read from the other strand, so a new scan's sites.
      await app.menu('sequence:reverse-complement');
      await app.settle();
      // The one per-site choice is cleared and told in the status line; the enzyme's is kept.
      expect(panel.notices().join(' ')).toContain(clearedChoicesNotice(1));
      // The edit's own confirmation is kept alongside it (BG-01M7DH9X).
      expect(panel.notices().join(' ')).toContain(`Applied Reverse Complement to ${plasmid.name}`);
      expect(panel.counts()).toContain(' 2 hidden by you ');
      const thrice = panel.control(`Show ${THRICE} sites on the maps`) as LiveElement & { checked: boolean };
      expect(thrice.checked).toBe(true);
      expect(thrice.getAttribute('aria-checked')).toBeNull();
      await panel.search(TWICE);
      expect((panel.control(`Show ${TWICE} sites on the maps`) as LiveElement & { checked: boolean }).checked).toBe(false);
    });
  });
});

describe('BG-01M7DH9X: focus, mixed enzymes and the edit\'s confirmation in the App', () => {
  vi.setConfig({ testTimeout: 120_000 });
  const box = (name: string) => `Show ${name} sites on the maps`;

  it('BG-01M7DH9X AC1 with Shown only, Space on an enzyme checkbox hides its row and focus moves to the next row, the one before, then the search', async () => {
    await withPanelApp(async (panel, app) => {
      await panel.search('Bsm');
      await panel.shownOnly(true);
      const listed = panel.enzymes();
      expect(listed.length, 'several enzymes match').toBeGreaterThanOrEqual(3);
      // A row hidden while focus is elsewhere (WebKit does not focus a checkbox it clicks) leaves
      // focus where the user put it: then shown again.
      panel.control('Search enzymes by name').focus();
      await app.change(panel.control(box(listed[0])), false);
      expect(panel.enzymes()).toEqual(listed.slice(1));
      expect(panel.focused()).toBe('Search enzymes by name');
      await panel.shownOnly(false);
      await app.change(panel.control(box(listed[0])), true);
      await panel.shownOnly(true);
      expect(panel.enzymes()).toEqual(listed);
      // The first row: hidden, its row leaves the list, and focus lands on the next row's checkbox.
      panel.control(box(listed[0])).focus();
      expect(panel.focused()).toBe(box(listed[0]));
      await app.press(' ');
      expect(panel.enzymes()).toEqual(listed.slice(1));
      expect(panel.focused()).toBe(box(listed[1]));
      // The last row: there is no next, so focus lands on the one before it.
      const last = listed[listed.length - 1];
      panel.control(box(last)).focus();
      await app.press(' ');
      expect(panel.enzymes()).toEqual(listed.slice(1, -1));
      expect(panel.focused()).toBe(box(listed[listed.length - 2]));
      // Hide the rest from the keyboard, one at a time: focus stays in the panel, and goes to the
      // search once the list is empty.
      for (let left = listed.length - 2; left > 0; left--) {
        await app.press(' ');
        expect(panel.enzymes()).toHaveLength(left - 1);
        expect(panel.focused()).toBe(left > 1 ? box(panel.enzymes()[panel.enzymes().length - 1]) : 'Search enzymes by name');
      }
      // With Shown only off, a checkbox that stays listed keeps its focus.
      await panel.shownOnly(false);
      panel.control(box(listed[0])).focus();
      await app.press(' ');
      expect(panel.focused()).toBe(box(listed[0]));
    });
  });

  it('BG-01M7DH9X AC1 a mixed enzyme reads as indeterminate in the App, and a mouse click on it shows every site', async () => {
    await withPanelApp(async (panel, app) => {
      await panel.search(THRICE);
      await panel.expand(THRICE, 3);
      await app.change(panel.control(occLabel(keptOf(THRICE)[0])), false);
      const enzyme = panel.control(box(THRICE)) as LiveElement & { checked: boolean; indeterminate?: boolean };
      expect([enzyme.checked, enzyme.getAttribute('aria-checked'), enzyme.indeterminate]).toEqual([false, 'mixed', true]);
      expect(panel.counts()).toContain(' 1 hidden by you ');
      await app.click(enzyme);
      expect(panel.counts()).toContain(' 0 hidden by you ');
      const after = panel.control(box(THRICE)) as LiveElement & { checked: boolean; indeterminate?: boolean };
      expect([after.checked, after.getAttribute('aria-checked'), after.indeterminate]).toEqual([true, null, false]);
      for (const s of keptOf(THRICE)) expect((panel.control(occLabel(s)) as LiveElement & { checked: boolean }).checked).toBe(true);
    });
  });
});
