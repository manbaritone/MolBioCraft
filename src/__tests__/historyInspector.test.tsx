// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TANN: the History window's protein, folding and lineage settings in App's shared
 * inspector, and no inspector on its Enzymes and Workflows sub-tabs, which have nothing to set.
 *
 * Every check runs in the real App over the live DOM (the US-01M6TB6G harness): a session built
 * here is restored on the History tab, and the checks read App's own header button, its inspector
 * column (aside.mbc-right-controls) and its viewer canvas, and drive the settings by editing them in
 * that column. AC6 draws the studio on its own (no WorkbenchInspectorProvider: its own React root in
 * the launched App's window) and checks that each setting is drawn once, where it sat before this
 * story moved it into the inspector (878396b^); its standalone suites (proteinCaps, accessibilityFloor,
 * ...) check its results.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

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

// ─── Documents built in the test ───

/** Deterministic letters (LCG) from `alphabet`, so every run reads the same sequence. */
function lettersFrom(seed: number, n: number, alphabet = 'ACGT'): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}
/** `n` sense codons (no stop), drawn from a fixed seed. */
function senseCodons(seed: number, n: number): string {
  const stops = new Set(['TAA', 'TAG', 'TGA']);
  const raw = lettersFrom(seed, n * 6);
  const out: string[] = [];
  for (let i = 0; out.length < n && i + 3 <= raw.length; i += 3) {
    const codon = raw.slice(i, i + 3);
    if (!stops.has(codon)) out.push(codon);
  }
  if (out.length < n) throw new Error('the seed gave too few sense codons');
  return out.join('');
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

/** Two GC-rich hairpins with different stems, so the fold has more than one and the hairpin picker is drawn. */
const HAIRPINS = 'GGACCGTCGAAAGACGGTCC' + 'TTTTTTTT' + 'CTGAGCAGTTCGCTGCTCAG';
const CDS_START = HAIRPINS.length + 13;
/** ATG, 80 sense codons and a stop: an 81-aa ORF, the protein the Protein sub-tab analyses. */
const ORF = 'ATG' + senseCodons(0x7a11, 80) + 'TAA';
const CDS_END = CDS_START + ORF.length - 1;
const CONSTRUCT_SEQ = HAIRPINS + lettersFrom(0x5eed, 12) + ORF + lettersFrom(0xb0b, 40);

const PARENT: SequenceDocument = {
  ...BLANK, id: 'tann-parent', name: 'pTANN_Backbone', accession: 'TANN_0001', description: 'The parent the construct was built from',
  sequence: lettersFrom(0xfeed, 400), topology: 'circular',
  history: [{ id: 'h-parent-1', timestamp: '2026-11-01 09:00', operation: 'Imported GenBank', description: 'Imported', parentIds: [], lengthBp: 400, topology: 'circular' }],
};
const CONSTRUCT: SequenceDocument = {
  ...BLANK, id: 'tann-construct', name: 'pTANN_Construct', accession: 'TANN_0002', description: 'A linear construct built in the test',
  sequence: CONSTRUCT_SEQ,
  features: [{ id: 'f-tann-cds', name: 'TannCDS', type: 'CDS', start: CDS_START, end: CDS_END, strand: 1, color: '#d93025' }],
  history: [
    { id: 'h-tann-1', timestamp: '2026-11-02 10:00', operation: 'PCR Amplification', description: 'Amplified from the backbone', parentIds: ['tann-parent'], lengthBp: CONSTRUCT_SEQ.length, topology: 'linear', historyColor: '#7c3aed' },
    { id: 'h-tann-2', timestamp: '2026-11-03 11:00', operation: 'Annotated CDS', description: 'Marked the ORF', parentIds: [], lengthBp: CONSTRUCT_SEQ.length, topology: 'linear', historyColor: '#d97706' },
  ],
};
/** An Enzyme Set record, shaped as File > New > Enzyme Set makes one (App.tsx handleCreateNewEnzymeSetDocument), holding two enzymes. */
const ENZYME_SET: SequenceDocument = {
  ...BLANK, id: 'tann-enzymes', name: 'TANN_Enzyme_Set', accession: 'ENZ_4242', description: '2 enzymes',
  sequence: lettersFrom(0xe2e, 300), topology: 'circular', folder: 'Cloning',
  docMetadata: { 'Document Type': 'Enzyme Set', 'Enzyme Names': 'EcoRI, BamHI', '# Enzymes': 2 },
  history: [{ id: 'h-enz-1', timestamp: '2026-11-04 12:00', operation: 'Enzyme Set Created', description: 'Created', parentIds: [], lengthBp: 300, topology: 'circular' }],
};

const onHistory = (app: AppHarness, doc: SequenceDocument = CONSTRUCT, ...more: SequenceDocument[]) =>
  app.restoreSession({ documents: [doc, ...(more.length ? more : doc === CONSTRUCT ? [PARENT] : [])], activeDocId: doc.id, viewerTab: 'history-hybrid' });

// ─── Reading the App ───

const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
/** The inspector as the App shows it: the header button's label, the pane title and the section headers in its column. */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  return {
    button: label(app.inspectorButton()),
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
    sections: aside ? aside.querySelectorAll('button.mbc-accordion-header').map((b) => b.textContent.trim()) : [],
  };
}
const NONE = { button: null, title: null, sections: [] };

/** The studio's sub-tab buttons (its own tab strip, in the canvas unless the studio is drawn under `root`). */
const subTabButtons = (app: AppHarness, root: LiveElement = app.canvas()) => root.querySelectorAll('button[role="tab"]');
/** The studio's selected sub-tab, by its label. */
function selectedSubTab(app: AppHarness, root?: LiveElement): string | null {
  const selected = subTabButtons(app, root).filter((b) => b.getAttribute('aria-selected') === 'true');
  expect(selected.length, 'at most one selected sub-tab').toBeLessThanOrEqual(1);
  return selected[0]?.textContent.trim() ?? null;
}
const SUB_TABS = {
  protein: 'Protein Analysis & Codon Opt',
  fold: 'Secondary Structure (⌘7)',
  enzymes: 'Enzymes View (123 / |||| — ⌘3)',
  lineage: 'History Tree, Alerts & Info (⌘8)',
  workflows: 'Workflows & Genetic Code Tables',
} as const;
type SubTab = keyof typeof SUB_TABS;
/** Clicks the studio's own sub-tab button, as a user does. */
async function openSubTab(app: AppHarness, tab: SubTab, root?: LiveElement) {
  const hit = subTabButtons(app, root).filter((b) => b.textContent.trim() === SUB_TABS[tab] && !b.hasAttribute('hidden'));
  expect(hit, `one visible "${SUB_TABS[tab]}" sub-tab`).toHaveLength(1);
  await app.click(hit[0]);
  expect(selectedSubTab(app, root)).toBe(SUB_TABS[tab]);
}

/** The body of the column's section headed `title`. */
function sectionBody(app: AppHarness, title: string): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, `the inspector column, for the ${title} section`).not.toBeNull();
  const sections = aside!.querySelectorAll('.mbc-accordion-section')
    .filter((s) => s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent.trim() === title);
  expect(sections, `one "${title}" section`).toHaveLength(1);
  const bodies = sections[0].querySelectorAll('.mbc-accordion-body');
  expect(bodies, `the "${title}" section is unfolded`).toHaveLength(1);
  return bodies[0];
}

const optionValues = (select: LiveElement) => select.querySelectorAll('option').map((o) => o.value);
/** The selects under `root` that offer exactly `values`, in order. */
const selectsOffering = (root: LiveElement, values: readonly string[]) =>
  root.querySelectorAll('select').filter((s) => JSON.stringify(optionValues(s)) === JSON.stringify(values));
/** The text of the label a control sits in. */
const labelText = (el: LiveElement) => el.closest('label')?.textContent.replace(/\s+/g, ' ').trim() ?? '';

const PROTEASES = ['Trypsin', 'Chymotrypsin', 'Lys-C', 'Glu-C'];
const FOLD_AS = ['RNA', 'DNA'];
const FOLD_REGION = ['whole', 'cds'];
const FOLD_TEMPS = ['4', '15', '20', '25', '30', '37', '42', '50', '55', '60', '65', '70', '80', '95'];
const FOLD_DANGLES = ['d2', 'd0'];
const FOLD_TOPOLOGY = ['circular', 'linear'];
const STRAINS = ['DH5α (dam+ dcm+)', 'JM110 / SCS110 (dam- dcm-)', 'BL21(DE3) (dam+ dcm-)', 'Stbl3 / NEB Stable'];

/** The one control in the section's body matched by `find`, which must be nowhere else in the page. */
function onlyIn(app: AppHarness, body: LiveElement, what: string, find: (root: LiveElement) => LiveElement[]): LiveElement {
  const inBody = find(body);
  expect(inBody, `${what}: one in the inspector section`).toHaveLength(1);
  expect(find(app.canvas()), `${what}: none in the viewer canvas`).toHaveLength(0);
  expect(find(app.doc.body), `${what}: one in the whole page`).toHaveLength(1);
  return inBody[0];
}
const ranges = (root: LiveElement) => root.querySelectorAll('input[type="range"]');
const historyColors = (root: LiveElement) =>
  root.querySelectorAll('input[type="checkbox"]').filter((c) => labelText(c) === 'Show History Colors');

interface ProteinControls { window: LiveElement; protease: LiveElement }
/** The Protein Analysis section's controls: the hydropathy window and the protease, in the column only. */
function proteinControls(app: AppHarness): ProteinControls {
  const body = sectionBody(app, 'Protein Analysis');
  const window = onlyIn(app, body, 'the hydropathy window', ranges);
  expect([window.getAttribute('min'), window.getAttribute('max'), window.getAttribute('step')], 'the hydropathy window\'s range').toEqual(['5', '21', '2']);
  expect(labelText(window), 'the window is labelled with its value').toMatch(/^Hydropathy window: \d+ aa$/);
  const protease = onlyIn(app, body, 'the protease', (r) => selectsOffering(r, PROTEASES));
  expect(labelText(protease).startsWith('Protease'), 'the protease is labelled').toBe(true);
  return { window, protease };
}
interface FoldControls { foldAs: LiveElement; region: LiveElement; temperature: LiveElement; dangles: LiveElement; topology: LiveElement }
/** The Folding section's five controls, in the column only. */
function foldControls(app: AppHarness): FoldControls {
  const body = sectionBody(app, 'Folding');
  const pick = (what: string, values: readonly string[], labelled: string) => {
    const el = onlyIn(app, body, what, (r) => selectsOffering(r, values));
    expect(labelText(el).startsWith(labelled), `${what} is labelled "${labelled}"`).toBe(true);
    return el;
  };
  return {
    foldAs: pick('fold as', FOLD_AS, 'Nearest-neighbour parameters'),
    region: pick('the region', FOLD_REGION, 'Region to fold'),
    temperature: pick('the temperature', FOLD_TEMPS, 'Folding temperature'),
    dangles: pick('the dangling ends', FOLD_DANGLES, 'Dangling ends'),
    topology: pick('the topology', FOLD_TOPOLOGY, 'Topology'),
  };
}
interface LineageControls { colors: LiveElement; strain: LiveElement }
/** The Lineage section's controls: Show History Colors and the transformation strain, in the column only. */
function lineageControls(app: AppHarness): LineageControls {
  const body = sectionBody(app, 'Lineage');
  const colors = onlyIn(app, body, 'Show History Colors', historyColors);
  const strain = onlyIn(app, body, 'the transformation strain', (r) => selectsOffering(r, STRAINS));
  expect(labelText(strain).startsWith('Bacterial Transformation Strain'), 'the strain is labelled').toBe(true);
  return { colors, strain };
}

// The results the settings drive, read from the canvas.
/** The hydropathy plot's line. */
function hydropathyLine(app: AppHarness): string {
  const svgs = app.canvas().querySelectorAll('svg[role="img"]').filter((s) => (s.getAttribute('aria-label') ?? '').startsWith('Kyte-Doolittle hydropathy'));
  expect(svgs, 'one hydropathy plot').toHaveLength(1);
  const lines = svgs[0].querySelectorAll('path').filter((p) => p.getAttribute('stroke') === 'var(--mbc-blue)');
  expect(lines, 'one hydropathy line').toHaveLength(1);
  return lines[0].getAttribute('d') ?? '';
}
const hydropathyHeading = (app: AppHarness) =>
  app.canvas().querySelectorAll('h4').map((h) => h.textContent).filter((t) => t.startsWith('Kyte-Doolittle Hydropathy Plot'));
/** A KPI's value in the canvas, by its label. */
function kpi(app: AppHarness, name: string): string {
  const boxes = app.canvas().querySelectorAll('.kpi-box').filter((b) => b.querySelectorAll('.kpi-label')[0]?.textContent.trim() === name);
  expect(boxes, `one "${name}" KPI`).toHaveLength(1);
  return boxes[0].querySelectorAll('.kpi-val')[0].textContent.trim();
}
/** The lineage graph's edge and node-box strokes. */
function lineageStrokes(app: AppHarness) {
  const graphs = app.canvas().querySelectorAll('svg[aria-label="Construct history provenance graph"]');
  expect(graphs, 'one lineage graph').toHaveLength(1);
  const edges = graphs[0].querySelectorAll('path').map((p) => p.getAttribute('stroke'));
  const nodes = graphs[0].querySelectorAll('g > rect[rx="8"]').map((r) => r.getAttribute('stroke'));
  return { edges, nodes };
}

/** This launch's engine and chart helpers, loaded after the App (one at a time). */
async function engine() {
  const bio = await import('../core/bioEngine');
  const chart = await import('../core/chartLayout');
  return { bio, chart };
}
/** The hydropathy line the studio draws for the construct's CDS at window `w`, from the engine's own profile. */
function expectedHydropathyLine(e: Awaited<ReturnType<typeof engine>>, w: number): string {
  const cds = CONSTRUCT_SEQ.slice(CDS_START - 1, CDS_END);
  const prof = e.bio.analyzeProteinSequence(cds, true, w).hydrophobicityProfile;
  expect(prof.length, 'the 81-aa ORF is analysed residue by residue').toBe(81);
  const frame = e.chart.plotFrame(e.chart.CHART_FULL);
  return prof.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${frame.xOfIndex(i, prof.length).toFixed(1)} ${frame.yOf(pt.score, -4.5, 4.5).toFixed(1)}`).join(' ');
}

// ─── AC1 ───

describe("History's settings in App's inspector (AC1)", () => {
  it("puts the protein, folding and lineage settings in App's inspector", async () => {
    await withApp(async (app) => {
      await onHistory(app);
      expect(app.header().querySelectorAll('button[role="tab"][data-view="history-hybrid"]')[0]?.textContent.trim(), 'the tab reads History').toBe('History');

      // Protein: the hydropathy window and the protease; the MS2 peptide picker stays with its spectrum.
      await openSubTab(app, 'protein');
      expect(shown(app)).toEqual({ button: 'Hide History Controls Inspector', title: 'History Controls', sections: ['Protein Analysis'] });
      proteinControls(app);
      const peptidePickers = (root: LiveElement) => root.querySelectorAll('select').filter((s) => labelText(s).startsWith('b/y Fragment Ions'));
      expect(peptidePickers(app.canvas()), 'the MS2 peptide picker stays in the canvas').toHaveLength(1);
      expect(peptidePickers(app.inspectorAside()!), 'and is not in the inspector').toHaveLength(0);

      // Secondary structure: fold as, region, temperature, dangles and topology; the hairpin picker stays with its drawing.
      await openSubTab(app, 'fold');
      expect(shown(app)).toEqual({ button: 'Hide History Controls Inspector', title: 'History Controls', sections: ['Folding'] });
      foldControls(app);
      const hairpinPickers = (root: LiveElement) => root.querySelectorAll('select').filter((s) => labelText(s).startsWith('Hairpin shown below'));
      expect(hairpinPickers(app.canvas()), 'the hairpin picker stays in the canvas').toHaveLength(1);
      expect(hairpinPickers(app.inspectorAside()!), 'and is not in the inspector').toHaveLength(0);

      // Lineage: Show History Colors and the transformation strain.
      await openSubTab(app, 'lineage');
      expect(shown(app)).toEqual({ button: 'Hide History Controls Inspector', title: 'History Controls', sections: ['Lineage'] });
      lineageControls(app);

      // Hidden, the inspector draws no column and its settings are nowhere, not back in the canvas; the button stays.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual({ button: 'Show History Controls Inspector', title: null, sections: [] });
      expect(historyColors(app.doc.body), 'Show History Colors is nowhere while hidden').toHaveLength(0);
      expect(selectsOffering(app.doc.body, STRAINS), 'the strain is nowhere while hidden').toHaveLength(0);
      await openSubTab(app, 'protein');
      expect(shown(app), 'a sub-tab switch keeps it hidden').toEqual({ button: 'Show History Controls Inspector', title: null, sections: [] });
      expect(ranges(app.canvas()), 'the hydropathy window is not drawn in the canvas while hidden').toHaveLength(0);
      expect(selectsOffering(app.doc.body, PROTEASES), 'the protease is nowhere while hidden').toHaveLength(0);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual({ button: 'Hide History Controls Inspector', title: 'History Controls', sections: ['Protein Analysis'] });
      proteinControls(app);
    });
  });
});

// ─── AC2 ───

describe('no inspector where there is nothing to set (AC2)', () => {
  it('offers no inspector on the Enzymes and Workflows sub-tabs', async () => {
    await withApp(async (app) => {
      await onHistory(app);
      await openSubTab(app, 'lineage');
      expect(shown(app).button, 'a sub-tab with settings shows the button').toBe('Hide History Controls Inspector');
      for (const tab of ['enzymes', 'workflows'] as const) {
        await openSubTab(app, tab);
        expect(shown(app), tab).toEqual(NONE);
        expect(app.all('[aria-label$=" Inspector"]'), `${tab}: no inspector control anywhere, disabled or not`).toHaveLength(0);
        expect(app.bodySplit().classList.contains('inspector-hidden'), `${tab}: the body split draws no column`).toBe(true);
        await openSubTab(app, 'fold');
        expect(shown(app).sections, `back from ${tab}, the settings return`).toEqual(['Folding']);
      }
    });

    // An Enzyme Set: its History tab reads Enzymes, which titles the inspector of its Lineage sub-tab.
    await withApp(async (app) => {
      await onHistory(app, ENZYME_SET);
      expect(app.header().querySelectorAll('button[role="tab"][data-view="history-hybrid"]')[0]?.textContent.trim(), 'the tab reads Enzymes').toBe('Enzymes');
      expect(selectedSubTab(app), 'an Enzyme Set opens on its Enzymes view').toBe(SUB_TABS.enzymes);
      expect(shown(app), 'the Enzymes view').toEqual(NONE);
      await openSubTab(app, 'lineage');
      expect(shown(app)).toEqual({ button: 'Hide Enzymes Controls Inspector', title: 'Enzymes Controls', sections: ['Lineage'] });
      lineageControls(app);
      await openSubTab(app, 'enzymes');
      expect(shown(app), 'back on the Enzymes view').toEqual(NONE);
    });
  });
});

// ─── AC3 ───

describe('the settings drive their results (AC3)', () => {
  it('redraws results from the inspector and keeps values across sub-tabs', async () => {
    await withApp(async (app) => {
      await onHistory(app);
      const e = await engine();

      // A new window redraws the hydropathy plot: the line is the engine's profile at that window.
      await openSubTab(app, 'protein');
      const at9 = expectedHydropathyLine(e, 9);
      const at13 = expectedHydropathyLine(e, 13);
      expect(at13, 'the fixture tells window 9 from 13').not.toBe(at9);
      expect(hydropathyLine(app), 'drawn at the default window').toBe(at9);
      await app.change(proteinControls(app).window, '13');
      expect(hydropathyLine(app), 'redrawn at window 13').toBe(at13);
      expect(hydropathyHeading(app)).toEqual(['Kyte-Doolittle Hydropathy Plot (Window = 13 aa)']);
      expect(labelText(proteinControls(app).window)).toBe('Hydropathy window: 13 aa');
      await app.change(proteinControls(app).protease, 'Glu-C');

      // A new temperature refolds: the MFE shown is the engine's at that temperature.
      await openSubTab(app, 'fold');
      const mfe = (t: number) => e.bio.predictSecondaryStructure(CONSTRUCT_SEQ, 'DNA', { temperatureC: t, danglingEnds: true, circular: false }).minimumFreeEnergyKcalMol;
      expect(mfe(60), 'the fixture folds differently at 37 and 60 °C').not.toBe(mfe(37));
      expect(kpi(app, 'Minimum Free Energy'), 'folded at 37 °C').toBe(`${mfe(37)} kcal/mol`);
      await app.change(foldControls(app).temperature, '60');
      expect(kpi(app, 'Minimum Free Energy'), 'refolded at 60 °C').toBe(`${mfe(60)} kcal/mol`);

      // History Colors recolours the lineage graph.
      await openSubTab(app, 'lineage');
      const coloured = lineageStrokes(app);
      expect(coloured.edges.length, 'the graph has edges').toBeGreaterThan(0);
      expect(new Set(coloured.edges), 'edges in history colour').toEqual(new Set(['var(--mbc-blue)']));
      expect(coloured.nodes.some((s) => s !== 'var(--mbc-green)'), 'nodes in their history colours').toBe(true);
      await app.change(lineageControls(app).colors, false);
      const plain = lineageStrokes(app);
      expect(new Set(plain.edges), 'edges plain').toEqual(new Set(['var(--mbc-text-muted)']));
      expect(new Set(plain.nodes), 'nodes plain').toEqual(new Set(['var(--mbc-green)']));
      await app.change(lineageControls(app).strain, 'BL21(DE3) (dam+ dcm-)');

      // Each value is kept across the sub-tab switches, and across hiding and showing the inspector.
      const kept = async (where: string) => {
        await openSubTab(app, 'protein');
        const p = proteinControls(app);
        expect([p.window.value, p.protease.value], `${where}: protein`).toEqual(['13', 'Glu-C']);
        expect(hydropathyLine(app), `${where}: the plot at window 13`).toBe(at13);
        await openSubTab(app, 'fold');
        expect(foldControls(app).temperature.value, `${where}: temperature`).toBe('60');
        expect(kpi(app, 'Minimum Free Energy'), `${where}: folded at 60 °C`).toBe(`${mfe(60)} kcal/mol`);
        await openSubTab(app, 'lineage');
        const l = lineageControls(app);
        expect([l.colors.checked, l.strain.value], `${where}: lineage`).toEqual([false, 'BL21(DE3) (dam+ dcm-)']);
        expect(new Set(lineageStrokes(app).edges), `${where}: edges plain`).toEqual(new Set(['var(--mbc-text-muted)']));
      };
      await kept('after the sub-tab switches');
      await app.click(app.inspectorButton()!);
      expect(shown(app).button).toBe('Show History Controls Inspector');
      await app.click(app.inspectorButton()!);
      await kept('after hiding and showing the inspector');
    });
  });
});

// ─── AC5 ───

/** The rows of the open menus labelled `text`. */
const menuRows = (app: AppHarness, text: string) =>
  app.all('button.desktop-menu-row').filter((b) => b.querySelectorAll('.desktop-menu-label').some((s) => s.textContent.trim() === text));
const menubar = (app: AppHarness, name: string) => {
  const found = app.all('.mbc-menubar button.menu-item').filter((b) => b.textContent.trim() === name);
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

describe('the commands that open a History sub-tab (AC5)', () => {
  it('shows the sub-tab a menu command opens, with its sections', async () => {
    await withApp(async (app) => {
      await onHistory(app);
      const routes: { name: string; run: () => Promise<void>; tab: SubTab; section: string }[] = [
        { name: 'the native View > Secondary Structure (view:secondary-structure)', run: () => app.menu('view:secondary-structure'), tab: 'fold', section: 'Folding' },
        { name: 'View > Studio Views > Secondary Structure', run: () => choose(app, 'View', ['Studio Views'], 'Secondary Structure'), tab: 'fold', section: 'Folding' },
        { name: 'the native View > Lineage (view:lineage)', run: () => app.menu('view:lineage'), tab: 'lineage', section: 'Lineage' },
        { name: 'the native Tools > Workflows (tools:workflows)', run: () => app.menu('tools:workflows'), tab: 'lineage', section: 'Lineage' },
        { name: 'View > Studio Views > Lineage & History', run: () => choose(app, 'View', ['Studio Views'], 'Lineage & History'), tab: 'lineage', section: 'Lineage' },
        { name: 'Tools > Pipelines > Lineage Manager', run: () => choose(app, 'Tools', ['Pipelines'], 'Lineage Manager'), tab: 'lineage', section: 'Lineage' },
      ];
      for (const route of routes) {
        // From History on its Protein sub-tab, then from another tab (Sequence).
        for (const from of ['History > Protein', 'Sequence'] as const) {
          if (from === 'Sequence') {
            await app.clickTab('sequence-view');
            expect(shown(app).title, 'on the Sequence tab').toBe('Sequence View Controls');
          } else {
            if (app.activeTab() !== 'history-hybrid') await app.clickTab('history-hybrid');
            await openSubTab(app, 'protein');
            expect(shown(app).sections).toEqual(['Protein Analysis']);
          }
          await route.run();
          const where = `${route.name}, from ${from}`;
          expect(app.activeTab(), where).toBe('history-hybrid');
          expect(selectedSubTab(app), where).toBe(SUB_TABS[route.tab]);
          expect(shown(app), where).toEqual({ button: 'Hide History Controls Inspector', title: 'History Controls', sections: [route.section] });
          if (route.tab === 'fold') foldControls(app); else lineageControls(app);
        }
      }
    });
  });
});

// ─── AC6 ───

/** The heading of the result header (`.studio-card-header`) `el` sits directly in, or null when it sits in none. */
function headerOf(el: LiveElement): string | null {
  const row = el.parentElement;
  if (!row?.classList.contains('studio-card-header')) return null;
  return row.querySelectorAll('h3, h4')[0]?.textContent.trim() ?? null;
}
/** The title of the result card `el` sits in. */
const cardOf = (el: LiveElement) =>
  el.closest('.studio-card')?.querySelectorAll('.studio-card-header h3')[0]?.textContent.trim() ?? null;
/** The one control under `root` matched by `find`. */
function once(root: LiveElement, what: string, find: (root: LiveElement) => LiveElement[]): LiveElement {
  const found = find(root);
  expect(found, `${what}: drawn once`).toHaveLength(1);
  return found[0];
}

describe('the studio drawn on its own (AC6)', () => {
  it('keeps each setting in its result when drawn on its own', async () => {
    await withApp(async (app) => {
      // The studio in a React root of its own, in the launched App's window: no WorkbenchInspectorProvider
      // is above it, so useInWorkbench() reads false. Each setting must be drawn once, where it sat before
      // this story moved it into the inspector (878396b^), and no inspector section is drawn.
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { HybridToolsAndHistoryStudio } = await import('../components/HybridToolsAndHistoryStudio');
      const probe = app.doc.createElement('div');
      app.doc.body.appendChild(probe);
      const root = createRoot(probe as unknown as Element);
      try {
        await React.act(async () => {
          root.render(React.createElement(HybridToolsAndHistoryStudio, { doc: CONSTRUCT, allDocuments: [CONSTRUCT, PARENT], initialSubTab: 'protein' }));
        });
        await app.settle();
        const noSections = (where: string) =>
          expect(probe.querySelectorAll('.mbc-accordion-section, .mbc-inspector-sections'), `${where}: no inspector section`).toHaveLength(0);

        // Protein: the window in the hydropathy plot's header, the protease in the digest's header.
        expect(selectedSubTab(app, probe)).toBe(SUB_TABS.protein);
        noSections('Protein');
        const window = once(probe, 'the hydropathy window', ranges);
        expect([window.getAttribute('min'), window.getAttribute('max'), window.getAttribute('step'), window.value], 'the hydropathy window').toEqual(['5', '21', '2', '9']);
        expect(headerOf(window), 'the window sits in the hydropathy plot\'s header').toBe('Kyte-Doolittle Hydropathy Plot (Window = 9 aa)');
        const protease = once(probe, 'the protease', (r) => selectsOffering(r, PROTEASES));
        expect(headerOf(protease), 'the protease sits in the digest\'s header').toBe('Proteomics LC-MS/MS Digest, b/y-Ion MS2 & PTM / Disulfide Prediction');

        // Secondary structure: the five fold settings in one grid of the fold's card.
        await openSubTab(app, 'fold', probe);
        noSections('Secondary structure');
        const grids = new Set<LiveElement>();
        const fold = [['fold as', FOLD_AS], ['the region', FOLD_REGION], ['the temperature', FOLD_TEMPS], ['the dangling ends', FOLD_DANGLES], ['the topology', FOLD_TOPOLOGY]] as const;
        for (const [what, values] of fold) {
          const field = once(probe, what, (r) => selectsOffering(r, values)).closest('label')!;
          expect(cardOf(field)?.startsWith('Nucleic-Acid Fold'), `${what} sits in the fold's card`).toBe(true);
          grids.add(field.parentElement!);
        }
        expect([...grids].map((g) => g.getAttribute('class')), 'the five share one grid').toEqual(['form-grid-2col']);

        // Lineage: Show History Colors in the history tree's header, the strain first in the info panel's grid.
        await openSubTab(app, 'lineage', probe);
        noSections('Lineage');
        const colors = once(probe, 'Show History Colors', historyColors).closest('label')!;
        expect(headerOf(colors), 'Show History Colors sits in the history tree\'s header').toBe('Construct History Tree & History Colors (⌘8)');
        const strain = once(probe, 'the transformation strain', (r) => selectsOffering(r, STRAINS)).closest('label')!;
        expect(labelText(strain).startsWith('Bacterial Transformation Strain'), 'the strain is labelled').toBe(true);
        expect(cardOf(strain), 'the strain sits in the info panel').toBe('Document Info Panel, Enhanced Alerts & Auto-Annotation');
        const grid = strain.parentElement!;
        expect([grid.getAttribute('class'), grid.children[0] === strain], 'the strain is the first field of the panel\'s grid').toEqual(['form-grid-2col', true]);
      } finally {
        await React.act(async () => { root.unmount(); });
        probe.remove();
      }
    });
  });
});
