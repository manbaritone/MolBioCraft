// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAKD: the Primers studio's conditions in App's shared inspector. On Design, a Primer Design
 * section holds the target annealing Tm, the 5' adapter tails (with their summary line) and the 3-nt
 * cleavage leader, and an Oligo Calculator: Buffer & Ionic Conditions section holds Na+/K+, Mg2+ and
 * [Primer]; on Saved, a Saved Primer Screening section holds the mismatch tolerance; on CRISPR, a
 * CRISPR Guides section holds the nuclease. The target region, the custom oligo, the results and the
 * actions stay in the cards.
 *
 * Every App check mounts the real App over the live DOM (the US-01M6TB6G harness), restores records
 * built here on the Primers tab, reads App's own header button, pane title and aside.mbc-right-controls,
 * and drives each setting by editing it in that column. Expected primers, Tms, screening hits and
 * guides come from this launch's engine called with the values the test chose, never from the studio.
 *
 * Wrong implementations these checks fail: a setting left in the card or drawn twice; Target
 * Start/End left in a three-column grid beside an empty slot; the tails' summary line dropped; a
 * moved control no longer wired to its result (the pair not redesigned for a new Tm, the calculator
 * not recomputed for a new buffer, the screening or the guides not redone); the buffer fed to the
 * pair's design; a value lost on a sub-tab switch or an inspector close; and a menu command that opens
 * the wrong sub-tab or none of its settings.
 *
 * The studio drawn outside the workbench, with no provider, is checked here too (AC10): rendered on the
 * server, as the standalone suites render it, and read through the live DOM's parser. On each sub-tab
 * every setting the inspector moves is drawn once, in its own card: the Tm in the target row and the
 * tails in their details in the design card, the buffer in its details in the calculator card, the
 * mismatch tolerance in the Saved card's header and the nuclease beside Annotate Top 5 Guides. Wrong
 * implementations these checks fail: a setting dropped from its card on its own (the round-1 review's
 * mutants), drawn twice (a section drawn there too, which with no provider renders its children as
 * passed), drawn once but outside its card, or wrapped in an inspector header. The standalone suites
 * (crisprGuideCap, primerTmNoAnswer, primerRecordTm, plainLanguageLabels) render the studio with no
 * provider as well, but none of them checks where its settings sit.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrimerRecord, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveDocument, LiveElement, parseMarkup } from './liveDom';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Records built in the test ───

/** Deterministic letters (LCG), so every run reads the same sequence. */
function lettersFrom(seed: number, n: number, alphabet = 'ACGT'): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

/** 1,200 bases with a CDS at 101..700, the target region the studio opens on. */
const TEMPLATE_SEQ = lettersFrom(0x7a3d, 1200);
const CDS = { start: 101, end: 700 };
const TEMPLATE: SequenceDocument = {
  ...BLANK, id: 'takd-template', name: 'pTAKD_Template', accession: 'TAKD_0001', description: 'A linear template built in the test',
  sequence: TEMPLATE_SEQ,
  features: [{ id: 'f-takd-cds', name: 'TakdCDS', type: 'CDS', start: CDS.start, end: CDS.end, strand: 1, color: '#d93025' }],
};

/** A saved oligo record; the screening reads its sequence. */
const oligoRecord = (id: string, name: string, sequence: string): PrimerRecord => ({
  id, name, sequence, annealSequence: sequence, tail5Prime: '', bindStart: 1, bindEnd: sequence.length, strand: 1,
  length: sequence.length, gcPercent: 50, tmAnnealC: 60, tmFullC: 60, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true,
});
/** Bases 301..322 of the template, and the same oligo with its 5'-most base changed. */
const EXACT_SITE = TEMPLATE_SEQ.slice(300, 322);
const ONE_MISMATCH = (EXACT_SITE[0] === 'A' ? 'C' : 'A') + EXACT_SITE.slice(1);
/** The primer collection the Saved sub-tab screens against the template. */
const STOCK: SequenceDocument = {
  ...BLANK, id: 'takd-stock', name: 'TAKD_Primer_Stock', accession: 'TAKD_0002', description: 'Saved oligos',
  sequence: lettersFrom(0x5eed, 400),
  primers: [oligoRecord('takd-exact', 'TAKD_Exact', EXACT_SITE), oligoRecord('takd-mm1', 'TAKD_OneMismatch', ONE_MISMATCH)],
};
const CATALOG = STOCK.primers;

const onPrimers = (app: AppHarness, workspace: Parameters<AppHarness['restoreSession']>[0]['workspace'] = {}) =>
  app.restoreSession({ documents: [TEMPLATE, STOCK], activeDocId: TEMPLATE.id, viewerTab: 'primers-pcr', workspace });

/** This launch's engine and enzyme catalogue, loaded after the App (one at a time). */
async function engine() {
  const bio = await import('../core/bioEngine');
  const rebase = await import('../data/rebaseEnzymes');
  return { bio, rebase };
}
type Engine = Awaited<ReturnType<typeof engine>>;

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A label's own words: its text without the text of the controls inside it (a select's options). */
const ownWords = (label: LiveElement) =>
  words(label.childNodes.map((n) => (n instanceof LiveElement && (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? '' : n.textContent)).join(''));
/** The form controls in `scope` named `name`: by their aria-label, or by the words of the label they sit in. */
const fields = (scope: LiveElement, name: string) =>
  scope.querySelectorAll('input, select').filter((c) => c.getAttribute('aria-label') === name || c.labels.some((l) => ownWords(l) === name));
function field(scope: LiveElement, name: string): LiveElement {
  const found = fields(scope, name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
}

const TM = 'Target Annealing Tm (°C):';
const FWD_TAIL = "5' Forward Enzyme Tail:";
const REV_TAIL = "5' Reverse Enzyme Tail:";
const LEADER = "Add 3-nt 5' Cleavage Leader (GCG)";
const NA = '[Na⁺ / K⁺] (mM):';
const MG = '[Mg²⁺] (mM):';
const PRIMER_NM = '[Primer] (nM):';
const START = 'Target Start (bp):';
const END = 'Target End (bp):';
const OLIGO = "Enter Custom Oligonucleotide Sequence (5' → 3'):";
const MISMATCHES = "Max 5' Mismatches Allowed (3' 5-nt Clamp Required):";
const NUCLEASE = 'Nuclease / PAM:';
const DESIGN_SETTINGS = [TM, FWD_TAIL, REV_TAIL, LEADER];
const BUFFER_SETTINGS = [NA, MG, PRIMER_NM];
const PRIMER_DESIGN = 'Primer Design';
const BUFFER = 'Oligo Calculator: Buffer & Ionic Conditions';
const SCREENING = 'Saved Primer Screening';
const GUIDES = 'CRISPR Guides';
const SPCAS9 = 'SpCas9 (NGG)';
const CAS12A = 'Cas12a / Cpf1 (TTTV)';

/** The value an element's inline style declares for `prop` (React writes it into the style object). */
const declared = (el: LiveElement, prop: string) => el.style.getPropertyValue(prop);
const sectionTitle = (s: LiveElement) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '');
/**
 * The inspector as App shows it: the button's label, the pane title and, in their CSS order, the
 * titles of the sections a studio portals into App's column (never the Sequence tab's own accordion,
 * which App draws itself).
 */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  const sections = aside ? aside.querySelectorAll('.mbc-inspector-sections > .mbc-accordion-section') : [];
  for (const s of sections) expect(declared(s, 'order'), `the "${sectionTitle(s)}" section declares its order`).toMatch(/^\d+$/);
  return {
    button: app.inspectorButton()?.getAttribute('aria-label') ?? null,
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
    sections: [...sections].sort((a, b) => Number(declared(a, 'order')) - Number(declared(b, 'order'))).map(sectionTitle),
  };
}
const OPEN = { button: 'Hide Primers Controls Inspector', title: 'Primers Controls' };
const DESIGN_SHOWN = { ...OPEN, sections: [PRIMER_DESIGN, BUFFER] };
const SAVED_SHOWN = { ...OPEN, sections: [SCREENING] };
const CRISPR_SHOWN = { ...OPEN, sections: [GUIDES] };
const CLOSED = { button: 'Show Primers Controls Inspector', title: null, sections: [] };

/** The body of the column's section titled `title`. */
function sectionBody(app: AppHarness, title: string): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, `the inspector column, for the ${title} section`).not.toBeNull();
  const found = aside!.querySelectorAll('.mbc-inspector-sections > .mbc-accordion-section').filter((s) => sectionTitle(s) === title);
  expect(found, `one "${title}" section`).toHaveLength(1);
  const bodies = found[0].querySelectorAll('.mbc-accordion-body');
  expect(bodies, `the "${title}" section is unfolded`).toHaveLength(1);
  return bodies[0];
}
/** The control named `name`, in the section titled `title` and nowhere else in the page. */
function inSection(app: AppHarness, title: string, name: string): LiveElement {
  const el = field(sectionBody(app, title), name);
  expect(fields(app.canvas(), name), `${name}: none in the viewer canvas`).toHaveLength(0);
  expect(fields(app.doc.body, name), `${name}: one in the whole page`).toHaveLength(1);
  return el;
}

/** The studio's sub-tabs (its own tab strip, in the canvas). */
const subTabButtons = (app: AppHarness) =>
  app.canvas().querySelectorAll('[role="tablist"][aria-label="Primer and CRISPR Tools"] button[role="tab"]');
const SUB_TABS = {
  design: /^Design New Primers & Oligo Biophysics$/,
  saved: /^Test with Saved Primers \(\d+ Binding Sites?\)$/,
  crispr: /^Find CRISPR Sites & Off-Targets \(.+\)$/,
} as const;
type SubTab = keyof typeof SUB_TABS;
function selectedSubTab(app: AppHarness): SubTab | null {
  const selected = subTabButtons(app).filter((b) => b.getAttribute('aria-selected') === 'true');
  expect(selected.length, 'at most one selected sub-tab').toBeLessThanOrEqual(1);
  if (!selected.length) return null;
  const label = words(selected[0].textContent);
  const tab = (Object.keys(SUB_TABS) as SubTab[]).find((k) => SUB_TABS[k].test(label));
  expect(tab, `a known sub-tab is selected, not "${label}"`).toBeDefined();
  return tab!;
}
/** Clicks the studio's own sub-tab button, as a user does. */
async function openSubTab(app: AppHarness, tab: SubTab) {
  const hit = subTabButtons(app).filter((b) => SUB_TABS[tab].test(words(b.textContent)));
  expect(hit, `one ${tab} sub-tab`).toHaveLength(1);
  await app.click(hit[0]);
  expect(selectedSubTab(app)).toBe(tab);
}
/** The Saved sub-tab's own count of binding sites, read from its label. */
const savedTabCount = (app: AppHarness) => {
  const label = subTabButtons(app).map((b) => words(b.textContent)).find((t) => SUB_TABS.saved.test(t)) ?? '';
  return Number(/\((\d+) Binding/.exec(label)?.[1] ?? NaN);
};

/** The studio card in `scope` whose heading starts with `heading`. */
function card(scope: LiveElement, heading: string): LiveElement {
  const found = scope.querySelectorAll('.studio-card').filter((c) => words(c.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? '').startsWith(heading));
  expect(found, `one "${heading}" card`).toHaveLength(1);
  return found[0];
}
const DESIGN_CARD = 'PCR Primer Design & Amplicon Simulator';
const CALC_CARD = 'Oligo Biophysics & Secondary Structure Calculator';
const SAVED_CARD = 'Test with Saved Primers — Screening';
const CRISPR_CARD = 'CRISPR/Cas Guide Finder & Off-Target Specificity Scorer';
const button = (scope: LiveElement, text: string | RegExp) => {
  const found = scope.querySelectorAll('button').filter((b) => (typeof text === 'string' ? words(b.textContent) === text : text.test(words(b.textContent))));
  expect(found, `one "${text}" button`).toHaveLength(1);
  return found[0];
};

/** The one details in `scope` titled `title`: the details element and its summary line. */
function titledDetails(scope: LiveElement, title: string, what: string) {
  const found = scope.querySelectorAll('details').filter((d) => words(d.querySelectorAll('summary span')[0]?.textContent ?? '') === title);
  expect(found, `one ${what} details`).toHaveLength(1);
  const meta = found[0].querySelectorAll('summary .mbc-progressive-summary-meta');
  expect(meta, `the ${what} keep their summary line`).toHaveLength(1);
  return { details: found[0], summary: words(meta[0].textContent) };
}
/** The adapter tails' details in `scope`: its title, its summary line and the details element. */
const tailsDetails = (scope: LiveElement) => titledDetails(scope, "5' Cloning Adapter Tails (Optional)", 'adapter tails');

interface PrimerCard { heading: string; pill: string; seq: string }
/** The designed pair as the design card shows it. */
function pairCards(app: AppHarness): PrimerCard[] {
  const cards = card(app.canvas(), DESIGN_CARD).querySelectorAll('.primer-detail-card');
  expect(cards, 'a forward and a reverse primer card').toHaveLength(2);
  return cards.map((c) => ({
    heading: words(c.querySelectorAll('.primer-card-top strong')[0].textContent),
    pill: words(c.querySelectorAll('.tm-pill')[0].textContent),
    seq: words(c.querySelectorAll('.primer-seq-display')[0].textContent),
  }));
}
/** The cards a designed pair should draw, written out from the engine's records. */
const expectedCards = (pair: { forward: PrimerRecord; reverse: PrimerRecord }): PrimerCard[] =>
  [pair.forward, pair.reverse].map((p) => ({
    heading: `${p.strand === 1 ? 'Forward Primer:' : 'Reverse Primer:'} ${p.name}`,
    pill: `Anneal Tm ${p.tmAnnealC}°C | Full Tm ${p.tmFullC}°C`,
    seq: `5'-${p.tail5Prime}${p.annealSequence}-3'`,
  }));
/** The oligo calculator's Salt-Corrected Tm, as its card reads. */
function calculatorTm(app: AppHarness): string {
  const boxes = card(app.canvas(), CALC_CARD).querySelectorAll('.kpi-box').filter((b) => words(b.querySelectorAll('.kpi-label')[0]?.textContent ?? '') === 'Salt-Corrected Tm');
  expect(boxes, 'one Salt-Corrected Tm KPI').toHaveLength(1);
  return words(boxes[0].querySelectorAll('.kpi-val')[0].textContent);
}

/** The table rows of a card, as cell texts, by its column headers. */
function tableRows(scope: LiveElement): Record<string, string>[] {
  const tables = scope.querySelectorAll('table');
  expect(tables, 'one table').toHaveLength(1);
  const heads = tables[0].querySelectorAll('thead th').map((th) => words(th.textContent));
  return tables[0].querySelectorAll('tbody tr').map((tr) => {
    const cells = tr.querySelectorAll('td').map((td) => words(td.textContent));
    return Object.fromEntries(cells.map((c, i) => [cells.length === heads.length ? heads[i] : `span${i}`, c]));
  });
}
const headed = (row: Record<string, string>, start: string) => {
  const key = Object.keys(row).find((k) => k.startsWith(start));
  expect(key, `a "${start}" column`).toBeDefined();
  return row[key!];
};
/** The screening hits the Saved card lists: primer and mismatches. */
const savedHits = (app: AppHarness) =>
  tableRows(card(app.canvas(), SAVED_CARD)).filter((r) => !('span0' in r)).map((r) => `${headed(r, 'Primer Name')} ${headed(r, 'Mismatches')}`);
const expectedHits = (e: Engine, maxMismatches: number) =>
  e.bio.testSavedPrimersOnSequence(TEMPLATE_SEQ, CATALOG, maxMismatches).map((h) => `${h.primer.name} ${h.mismatches} mm`);
interface GuideRow { name: string; spacer: string; pam: string; strand: string }
/** The guides the CRISPR card lists. */
const guideRows = (app: AppHarness): GuideRow[] =>
  tableRows(card(app.canvas(), CRISPR_CARD)).map((r) => ({
    name: headed(r, 'Guide Name'), spacer: headed(r, '20-nt Spacer'), pam: headed(r, 'PAM'), strand: headed(r, 'Strand'),
  }));
const expectedGuides = (e: Engine, nuclease: typeof SPCAS9 | typeof CAS12A): GuideRow[] =>
  e.bio.findCrisprGuides(TEMPLATE_SEQ, nuclease, 25, false).map((g) => ({
    name: g.name, spacer: g.spacerSeq, pam: g.pamSeq, strand: g.strand === 1 ? 'Forward (+)' : 'Reverse (-)',
  }));
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (s: string) => [...s].reverse().map((b) => COMPLEMENT[b]).join('');
/** The bases a listed guide's site reads on its own strand, found in the template (PAM and spacer, in the order the strand reads them). */
const siteOnStrand = (g: GuideRow) => {
  const forward = g.strand === 'Forward (+)';
  const pamFirst = `${g.pam}${g.spacer}`;
  const pamLast = `${g.spacer}${g.pam}`;
  const reads = (site: string) => TEMPLATE_SEQ.includes(forward ? site : revComp(site));
  return reads(pamFirst) && !reads(pamLast) ? "5' PAM" : reads(pamLast) && !reads(pamFirst) ? "3' PAM" : 'unplaced';
};

// ─── AC1 ───

describe("the Design sub-tab's settings in App's inspector (AC1)", () => {
  it("puts the primer design and oligo calculator conditions in App's inspector", async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      expect(app.activeTab()).toBe('primers-pcr');
      expect(selectedSubTab(app), 'the studio opens on Design').toBe('design');

      // App's own header button, pane title and the two sections in its aside, in that order.
      expect(shown(app)).toEqual(DESIGN_SHOWN);
      const aside = app.inspectorAside()!;
      expect(aside.closest('.mbc-viewer-body-split') === app.bodySplit() && aside.localName === 'aside' && aside.classList.contains('mbc-right-controls'),
        "the sections sit in App's aside.mbc-right-controls").toBe(true);
      for (const name of DESIGN_SETTINGS) inSection(app, PRIMER_DESIGN, name);
      for (const name of BUFFER_SETTINGS) inSection(app, BUFFER, name);
      expect(inSection(app, PRIMER_DESIGN, TM).value).toBe('60');
      expect([NA, MG, PRIMER_NM].map((n) => inSection(app, BUFFER, n).value)).toEqual(['50', '1.5', '250']);

      // The tails keep their details and its summary line, in the Primer Design section, live.
      const tails = tailsDetails(sectionBody(app, PRIMER_DESIGN));
      expect(tails.summary).toBe('Blunt / Direct PCR');
      for (const name of [FWD_TAIL, REV_TAIL, LEADER]) expect(tails.details.contains(field(sectionBody(app, PRIMER_DESIGN), name)), `${name} in the tails details`).toBe(true);
      expect(app.canvas().querySelectorAll('details'), 'no settings details left in the canvas').toHaveLength(0);
      await app.change(inSection(app, PRIMER_DESIGN, FWD_TAIL), 'EcoRI');
      expect(tailsDetails(sectionBody(app, PRIMER_DESIGN)).summary).toBe("5' EcoRI / None + 3-nt leader");
      await app.change(inSection(app, PRIMER_DESIGN, LEADER), false);
      expect(tailsDetails(sectionBody(app, PRIMER_DESIGN)).summary).toBe("5' EcoRI / None");

      // Target Start/End stay in the design card, one two-field row with no empty third column.
      const design = card(app.canvas(), DESIGN_CARD);
      const start = field(design, START);
      const end = field(design, END);
      const row = start.closest('.form-grid-2col');
      expect(row, 'Start sits in a two-column grid').not.toBeNull();
      expect(end.closest('.form-grid-2col') === row, 'End sits in the same row').toBe(true);
      expect(row!.classList.contains('form-grid-3col'), 'the row is not a three-column grid').toBe(false);
      expect(start.closest('.form-grid-3col'), 'no three-column grid around Start').toBeNull();
      expect(row!.children.map((c) => c.localName), 'two fields in the row and nothing else').toEqual(['label', 'label']);
      expect(row!.children[0].contains(start) && row!.children[1].contains(end), 'Start then End').toBe(true);
      expect(aside.contains(start) || aside.contains(end), 'Start/End are not in the inspector').toBe(false);
      // The pair and its actions stay in the card too.
      expect(pairCards(app)).toHaveLength(2);
      for (const text of ['+ Bind Primer Pair to pTAKD_Template' as string | RegExp, /^Amplify & Save \d+ bp PCR Product to Workspace$/]) {
        expect(design.contains(button(app.canvas(), text)), `${text} stays in the design card`).toBe(true);
      }

      // The custom oligo stays in the calculator card, beside its results.
      const calc = card(app.canvas(), CALC_CARD);
      const oligo = field(calc, OLIGO);
      expect(fields(aside, OLIGO), 'the custom oligo is not in the inspector').toHaveLength(0);
      expect(oligo.value).toBe('GGAATTCCATATGGTGAGCAAGGGCGAGGAG');
      calculatorTm(app);

      // Closed, the settings are drawn nowhere, the button stays and the cards keep the target and oligo.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED);
      expect(app.inspectorAside(), 'no column while the inspector is closed').toBeNull();
      for (const name of [...DESIGN_SETTINGS, ...BUFFER_SETTINGS]) expect(fields(app.doc.body, name), `${name} not drawn while closed`).toHaveLength(0);
      for (const name of [START, END]) field(card(app.canvas(), DESIGN_CARD), name);
      field(card(app.canvas(), CALC_CARD), OLIGO);
      // Opened again, the sections are back.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(DESIGN_SHOWN);
      for (const name of DESIGN_SETTINGS) inSection(app, PRIMER_DESIGN, name);
      for (const name of BUFFER_SETTINGS) inSection(app, BUFFER, name);
    });
  });
});

// ─── AC2 ───

describe("the Saved and CRISPR sub-tabs' settings in App's inspector (AC2)", () => {
  it("puts the screening and CRISPR settings in App's inspector", async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      const e = await engine();

      // Saved: the mismatch tolerance in a Saved Primer Screening section, and the screening it drives.
      await openSubTab(app, 'saved');
      expect(shown(app)).toEqual(SAVED_SHOWN);
      const tolerance = inSection(app, SCREENING, MISMATCHES);
      expect(tolerance.localName).toBe('select');
      expect(tolerance.options.map((o) => o.value)).toEqual(['0', '1', '2', '3']);
      expect(tolerance.value).toBe('2');
      const saved = card(app.canvas(), SAVED_CARD);
      expect(saved.querySelectorAll('select'), 'no select left in the Saved card').toHaveLength(0);
      const atTwo = expectedHits(e, 2);
      const atZero = expectedHits(e, 0);
      expect(atZero.length, 'the fixture screens differently at 0 and 2 mismatches').toBeLessThan(atTwo.length);
      expect(savedHits(app)).toEqual(atTwo);
      expect(savedTabCount(app)).toBe(atTwo.length);
      await app.change(tolerance, '0');
      expect(savedHits(app), 'rescreened at 0 mismatches').toEqual(atZero);
      expect(savedTabCount(app)).toBe(atZero.length);

      // CRISPR: the nuclease in a CRISPR Guides section; Annotate Top 5 Guides stays in the card.
      await openSubTab(app, 'crispr');
      expect(shown(app)).toEqual(CRISPR_SHOWN);
      const nuclease = inSection(app, GUIDES, NUCLEASE);
      expect(nuclease.localName).toBe('select');
      expect(nuclease.options.map((o) => o.value)).toEqual([SPCAS9, CAS12A]);
      const crispr = card(app.canvas(), CRISPR_CARD);
      expect(crispr.querySelectorAll('select'), 'no select left in the CRISPR card').toHaveLength(0);
      const annotate = button(app.canvas(), '+ Annotate Top 5 Guides onto pTAKD_Template');
      expect(crispr.contains(annotate), 'Annotate Top 5 Guides stays in the CRISPR card').toBe(true);
      expect(app.inspectorAside()!.querySelectorAll('button').filter((b) => words(b.textContent).startsWith('+ Annotate')), 'no annotate action in the inspector').toHaveLength(0);

      // Back on Design, its two sections return and the others are gone.
      await openSubTab(app, 'design');
      expect(shown(app)).toEqual(DESIGN_SHOWN);
      expect(fields(app.doc.body, MISMATCHES)).toHaveLength(0);
      expect(fields(app.doc.body, NUCLEASE)).toHaveLength(0);
    });
  });
});

// ─── AC3 ───

describe('the target Tm set in the inspector (AC3)', () => {
  it('redesigns the primer pair when the target Tm changes in the inspector', async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      const e = await engine();
      const pairAt = (tm: number) => expectedCards(e.bio.designPCRPrimers(TEMPLATE, CDS.start, CDS.end, tm, '', ''));
      const at60 = pairAt(60);
      const at64 = pairAt(64);
      const at56 = pairAt(56);
      expect(new Set([at60, at64, at56].map((p) => JSON.stringify(p))).size, 'the fixture designs a different pair at 56, 60 and 64 °C').toBe(3);

      expect(pairCards(app), 'designed for 60 °C').toEqual(at60);
      await app.change(inSection(app, PRIMER_DESIGN, TM), '64');
      expect(pairCards(app), 'redesigned for 64 °C').toEqual(at64);
      await app.change(inSection(app, PRIMER_DESIGN, TM), '56');
      expect(pairCards(app), 'redesigned for 56 °C').toEqual(at56);
      expect(inSection(app, PRIMER_DESIGN, TM).value).toBe('56');
    });
  });
});

// ─── AC4 ───

describe('the buffer set in the inspector (AC4)', () => {
  it('recomputes only the oligo calculator when the buffer changes in the inspector', async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      const e = await engine();
      const oligo = field(card(app.canvas(), CALC_CARD), OLIGO).value;
      const tmAt = (na: number, mg: number, nm: number) => `${e.bio.calculatePrimerMetrics(oligo, na, mg, nm).tmC} °C`;
      const pair = expectedCards(e.bio.designPCRPrimers(TEMPLATE, CDS.start, CDS.end, 60, '', ''));
      const steps: { name: string; value: string; tm: string }[] = [
        { name: MG, value: '3', tm: tmAt(50, 3, 250) },
        { name: NA, value: '200', tm: tmAt(200, 3, 250) },
        { name: PRIMER_NM, value: '1000', tm: tmAt(200, 3, 1000) },
      ];
      const tms = [tmAt(50, 1.5, 250), ...steps.map((s) => s.tm)];
      expect(new Set(tms).size, 'each buffer step gives the oligo a different Tm').toBe(tms.length);

      expect(calculatorTm(app), 'the default buffer').toBe(tms[0]);
      expect(pairCards(app), 'the pair designed for 60 °C').toEqual(pair);
      for (const step of steps) {
        await app.change(inSection(app, BUFFER, step.name), step.value);
        expect(calculatorTm(app), `${step.name} ${step.value}: the calculator recomputes`).toBe(step.tm);
        expect(pairCards(app), `${step.name} ${step.value}: the designed pair is unchanged`).toEqual(pair);
        expect(inSection(app, PRIMER_DESIGN, TM).value, 'the target Tm is unchanged').toBe('60');
      }
    });
  });
});

// ─── AC5 ───

describe('the values the inspector keeps (AC5)', () => {
  it('keeps primer values across sub-tabs and an inspector close', async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      const e = await engine();

      // A value set in each of the four sections.
      await app.change(inSection(app, PRIMER_DESIGN, TM), '64');
      await app.change(inSection(app, PRIMER_DESIGN, FWD_TAIL), 'EcoRI');
      await app.change(inSection(app, PRIMER_DESIGN, REV_TAIL), 'BamHI');
      await app.change(inSection(app, BUFFER, MG), '3');
      await openSubTab(app, 'saved');
      await app.change(inSection(app, SCREENING, MISMATCHES), '0');
      await openSubTab(app, 'crispr');
      await app.change(inSection(app, GUIDES, NUCLEASE), CAS12A);

      const fwdEnz = e.rebase.REBASE_ENZYMES.find((enz) => enz.name === 'EcoRI');
      const revEnz = e.rebase.REBASE_ENZYMES.find((enz) => enz.name === 'BamHI');
      expect([fwdEnz, revEnz], 'the catalogue holds both tails').not.toContain(undefined);
      const pair = expectedCards(e.bio.designPCRPrimers(TEMPLATE, CDS.start, CDS.end, 64, `GCG${fwdEnz!.recognitionSeq}`, `CGC${revEnz!.recognitionSeq}`));
      const oligoTm = `${e.bio.calculatePrimerMetrics('GGAATTCCATATGGTGAGCAAGGGCGAGGAG', 50, 3, 250).tmC} °C`;
      const hits = expectedHits(e, 0);
      const guides = expectedGuides(e, CAS12A);

      /** Every value and the result it drives, read across the three sub-tabs. */
      const kept = async (where: string) => {
        await openSubTab(app, 'design');
        expect([TM, FWD_TAIL, REV_TAIL].map((n) => inSection(app, PRIMER_DESIGN, n).value), `${where}: the design settings`).toEqual(['64', 'EcoRI', 'BamHI']);
        expect(inSection(app, PRIMER_DESIGN, LEADER).checked, `${where}: the leader`).toBe(true);
        expect(tailsDetails(sectionBody(app, PRIMER_DESIGN)).summary, `${where}: the tails summary`).toBe("5' EcoRI / BamHI + 3-nt leader");
        expect([NA, MG, PRIMER_NM].map((n) => inSection(app, BUFFER, n).value), `${where}: the buffer`).toEqual(['50', '3', '250']);
        expect(pairCards(app), `${where}: the pair designed at 64 °C with both tails`).toEqual(pair);
        expect(calculatorTm(app), `${where}: the calculator at 3 mM Mg²⁺`).toBe(oligoTm);
        await openSubTab(app, 'saved');
        expect(inSection(app, SCREENING, MISMATCHES).value, `${where}: the tolerance`).toBe('0');
        expect(savedHits(app), `${where}: the hits at 0 mismatches`).toEqual(hits);
        await openSubTab(app, 'crispr');
        expect(inSection(app, GUIDES, NUCLEASE).value, `${where}: the nuclease`).toBe(CAS12A);
        expect(guideRows(app), `${where}: the Cas12a guides`).toEqual(guides);
      };
      await kept('after the sub-tab switches');
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED);
      await openSubTab(app, 'design');
      expect(shown(app).button, 'a sub-tab switch keeps it closed').toBe(CLOSED.button);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(DESIGN_SHOWN);
      await kept('after closing and reopening the inspector');
    });
  });
});

// ─── AC6 ───

describe('the nuclease set in the inspector (AC6)', () => {
  it('lists guides for the nuclease chosen in the inspector', async () => {
    await withApp(async (app) => {
      await onPrimers(app);
      const e = await engine();
      await openSubTab(app, 'crispr');
      const spCas9 = expectedGuides(e, SPCAS9);
      const cas12a = expectedGuides(e, CAS12A);
      // The two nucleases read different sites in this fixture: NGG with its PAM 3' of the spacer,
      // TTTV with its PAM 5' of it, placed in the template by the bases each guide names.
      expect(new Set(spCas9.map((g) => siteOnStrand(g))), "every SpCas9 guide sits at a 3' PAM").toEqual(new Set(["3' PAM"]));
      expect(new Set(cas12a.map((g) => siteOnStrand(g))), "every Cas12a guide sits at a 5' PAM").toEqual(new Set(["5' PAM"]));
      expect(new Set(spCas9.map((g) => g.pam.slice(1))), 'the SpCas9 PAMs read GG').toEqual(new Set(['GG']));
      expect(cas12a.every((g) => /^TTT[ACG]$/.test(g.pam)), 'the Cas12a PAMs read TTTV').toBe(true);
      const spacersOf = (list: GuideRow[]) => new Set(list.map((g) => g.spacer));
      expect([...spacersOf(cas12a)].filter((s) => spacersOf(spCas9).has(s)), 'the two lists share no spacer').toEqual([]);

      expect(inSection(app, GUIDES, NUCLEASE).value).toBe(SPCAS9);
      expect(guideRows(app), 'SpCas9 guides are listed first').toEqual(spCas9);
      await app.change(inSection(app, GUIDES, NUCLEASE), CAS12A);
      expect(guideRows(app), 'Cas12a guides are listed for Cas12a').toEqual(cas12a);
      expect(words(card(app.canvas(), CRISPR_CARD).querySelectorAll('.info-callout')[0].textContent),
        'the callout names the nuclease chosen').toContain(`candidate ${CAS12A} guides`);
      await app.change(inSection(app, GUIDES, NUCLEASE), SPCAS9);
      expect(guideRows(app), 'and SpCas9 guides again').toEqual(spCas9);
    });
  });
});

// ─── AC7 ───

/** The rows of the open in-window menus labelled `text`. */
const menuRows = (app: AppHarness, text: string) =>
  app.all('button.desktop-menu-row').filter((b) => b.querySelectorAll('.desktop-menu-label').some((s) => words(s.textContent) === text));
const menubar = (app: AppHarness, name: string) => {
  const found = app.all('.mbc-menubar button.menu-item').filter((b) => words(b.textContent) === name);
  expect(found, `the ${name} menu`).toHaveLength(1);
  return found[0];
};
/** Chooses `leaf` from the in-window menu `menu` through `submenus`, as a user does. */
async function choose(app: AppHarness, menu: string, submenus: string[], leaf: string) {
  await app.click(menubar(app, menu));
  for (const name of [...submenus, leaf]) {
    const rows = menuRows(app, name);
    expect(rows, `one "${name}" row`).toHaveLength(1);
    await app.click(rows[0]);
  }
  expect(app.all('button.desktop-menu-row'), 'the menus closed').toHaveLength(0);
}

describe('the commands that open a Primers sub-tab (AC7)', () => {
  it('shows the sub-tab a menu command opens, with its settings', async () => {
    await withApp(async (app) => {
      // A selection, so Selection to Oligo has bases to convert.
      await onPrimers(app, { selectedRange: { start: 301, end: 322 } });
      const routes: { name: string; run: () => Promise<void>; tab: SubTab; shows: ReturnType<typeof shown> }[] = [
        { name: 'the native Primers > Selection to Oligo (primers:convert-to-oligo)', run: () => app.menu('primers:convert-to-oligo'), tab: 'saved', shows: SAVED_SHOWN },
        { name: 'the native Primers > Binding Specificity (primers:specificity)', run: () => app.menu('primers:specificity'), tab: 'saved', shows: SAVED_SHOWN },
        { name: 'the native Primers > Find CRISPR Sites (primers:crispr)', run: () => app.menu('primers:crispr'), tab: 'crispr', shows: CRISPR_SHOWN },
        { name: 'the native Annotate > Find CRISPR Sites (annotate:find-crispr)', run: () => app.menu('annotate:find-crispr'), tab: 'crispr', shows: CRISPR_SHOWN },
        { name: 'the native Primers > Design (primers:design)', run: () => app.menu('primers:design'), tab: 'design', shows: DESIGN_SHOWN },
        { name: 'Cloning > Primers > CRISPR Guides > Find CRISPR Sites', run: () => choose(app, 'Cloning', ['Primers', 'CRISPR Guides'], 'Find CRISPR Sites'), tab: 'crispr', shows: CRISPR_SHOWN },
        { name: 'Cloning > Primers > Design Primers > Selection to Oligo', run: () => choose(app, 'Cloning', ['Primers', 'Design Primers'], 'Selection to Oligo'), tab: 'saved', shows: SAVED_SHOWN },
      ];
      for (const route of routes) {
        // From Primers on its Design sub-tab, then from another tab (Sequence).
        for (const from of ['Primers > Design', 'Sequence'] as const) {
          if (from === 'Sequence') {
            await app.clickTab('sequence-view');
            expect(shown(app).title, 'on the Sequence tab').toBe('Sequence View Controls');
          } else {
            if (app.activeTab() !== 'primers-pcr') await app.clickTab('primers-pcr');
            await openSubTab(app, 'design');
          }
          await route.run();
          const where = `${route.name}, from ${from}`;
          expect(app.activeTab(), where).toBe('primers-pcr');
          expect(selectedSubTab(app), where).toBe(route.tab);
          expect(shown(app), where).toEqual(route.shows);
          if (route.tab === 'saved') inSection(app, SCREENING, MISMATCHES);
          else if (route.tab === 'crispr') inSection(app, GUIDES, NUCLEASE);
          else for (const name of DESIGN_SETTINGS) inSection(app, PRIMER_DESIGN, name);
        }
      }
    });
  });
});

// ─── AC10 ───

/**
 * The studio drawn on its own: no WorkbenchInspectorProvider above it, so it is not in the workbench.
 * It is rendered on the server, as the standalone suites render it, from modules loaded afresh with no
 * live DOM in place (after an App launch the module registry still holds that launch's modules), and
 * its markup is read through the live DOM's parser, so the helpers above read it as they read App's
 * page. React DOM's server renderer loads React and Node built-ins only, never the client renderer
 * (react-dom/cjs/react-dom.*) that mountApp refuses to find loaded before it.
 */
async function standaloneStudio(): Promise<(tab: SubTab) => LiveElement> {
  vi.resetModules();
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PrimerAndPCRStudio } = await import('../components/PrimerAndPCRStudio');
  return (tab) => {
    const html = renderToStaticMarkup(React.createElement(PrimerAndPCRStudio, {
      doc: TEMPLATE, allDocuments: [TEMPLATE, STOCK], onUpdateDocument: () => {}, onAddConstruct: () => {}, initialSubTab: tab,
    }));
    const doc = new LiveDocument();
    const page = doc.createElement('div');
    doc.body.appendChild(page);
    for (const n of parseMarkup(html, doc)) page.appendChild(n);
    return page;
  };
}
const EVERY_SETTING = [...DESIGN_SETTINGS, ...BUFFER_SETTINGS, MISMATCHES, NUCLEASE];
/** A standalone render on `tab`: that sub-tab selected, no inspector markup, and no other sub-tab's settings. */
function drawnOn(page: LiveElement, tab: SubTab, own: string[]) {
  const selected = page.querySelectorAll('[role="tablist"][aria-label="Primer and CRISPR Tools"] button[role="tab"]').filter((b) => b.getAttribute('aria-selected') === 'true');
  expect(selected, 'one selected sub-tab').toHaveLength(1);
  expect(words(selected[0].textContent)).toMatch(SUB_TABS[tab]);
  expect(page.querySelectorAll('.mbc-inspector-sections, .mbc-accordion-section, .mbc-accordion-header'), 'no inspector section, header or wrapper on its own').toHaveLength(0);
  for (const name of EVERY_SETTING.filter((n) => !own.includes(n))) expect(fields(page, name), `${name}: not drawn on ${tab}`).toHaveLength(0);
}
/** The control named `name`: drawn once in the whole page, and inside `place`. */
function inPlace(page: LiveElement, place: LiveElement, name: string, where: string): LiveElement {
  const found = fields(page, name);
  expect(found, `${name}: drawn once on its own`).toHaveLength(1);
  expect(place.contains(found[0]), `${name}: ${where}`).toBe(true);
  return found[0];
}

describe('the studio drawn on its own keeps its settings in its cards (AC10)', () => {
  it('keeps its settings in place when rendered on its own, on Design', async () => {
    const page = (await standaloneStudio())('design');
    drawnOn(page, 'design', [...DESIGN_SETTINGS, ...BUFFER_SETTINGS]);

    // The target Tm: the third field of the design card's target row, after Start and End.
    const design = card(page, DESIGN_CARD);
    const start = field(design, START);
    const end = field(design, END);
    const tm = inPlace(page, design, TM, 'in the design card');
    const row = start.closest('.form-grid-3col');
    expect(row, 'Start sits in a three-column row').not.toBeNull();
    expect(row!.children.map((c) => c.localName), 'three fields in the row and nothing else').toEqual(['label', 'label', 'label']);
    expect([start, end, tm].every((el, i) => row!.children[i].contains(el)), 'Start, End, then the target Tm').toBe(true);
    expect(tm.value).toBe('60');

    // The tails: their details, with its summary line, in the design card.
    const tails = tailsDetails(design);
    expect(tails.summary).toBe('Blunt / Direct PCR');
    for (const name of [FWD_TAIL, REV_TAIL, LEADER]) inPlace(page, tails.details, name, 'in the tails details of the design card');
    expect([FWD_TAIL, REV_TAIL].map((n) => field(tails.details, n).value)).toEqual(['None', 'None']);
    expect(field(tails.details, LEADER).checked, 'the leader is on').toBe(true);

    // The buffer: its details, with its summary line, in the calculator card, which holds the custom oligo too.
    const calc = card(page, CALC_CARD);
    field(calc, OLIGO);
    const buffer = titledDetails(calc, 'Buffer & Ionic Conditions', 'buffer');
    expect(buffer.summary).toBe('50 mM Na⁺ · 1.5 mM Mg²⁺ · 250 nM Oligo');
    for (const name of BUFFER_SETTINGS) inPlace(page, buffer.details, name, 'in the buffer details of the calculator card');
    expect(BUFFER_SETTINGS.map((n) => field(buffer.details, n).value)).toEqual(['50', '1.5', '250']);
    expect(page.querySelectorAll('details'), 'the tails and the buffer are the only details').toHaveLength(2);
  });

  it('keeps its settings in place when rendered on its own, on Saved', async () => {
    const page = (await standaloneStudio())('saved');
    drawnOn(page, 'saved', [MISMATCHES]);

    // The mismatch tolerance: in the Saved card's header, the header that holds its title.
    const saved = card(page, SAVED_CARD);
    const header = saved.querySelectorAll('.studio-card-header');
    expect(header, "the Saved card's header").toHaveLength(1);
    const tolerance = inPlace(page, header[0], MISMATCHES, "in the Saved card's header");
    expect(tolerance.localName).toBe('select');
    expect(tolerance.options.map((o) => o.value)).toEqual(['0', '1', '2', '3']);
    expect(tolerance.value).toBe('2');
  });

  it('keeps its settings in place when rendered on its own, on CRISPR', async () => {
    const page = (await standaloneStudio())('crispr');
    drawnOn(page, 'crispr', [NUCLEASE]);

    // The nuclease: in the CRISPR card's action row, beside Annotate Top 5 Guides.
    const crispr = card(page, CRISPR_CARD);
    const actions = button(crispr, '+ Annotate Top 5 Guides onto pTAKD_Template').closest('.cloning-action-row');
    expect(actions !== null && crispr.contains(actions), "Annotate Top 5 Guides sits in the CRISPR card's action row").toBe(true);
    const nuclease = inPlace(page, actions!, NUCLEASE, "in the CRISPR card's action row");
    expect(nuclease.localName).toBe('select');
    expect(nuclease.options.map((o) => o.value)).toEqual([SPCAS9, CAS12A]);
    expect(nuclease.value).toBe(SPCAS9);
  });
});
