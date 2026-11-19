// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TANN: the History window's protein, folding and lineage settings in App's shared
 * inspector, and no inspector on its Enzymes and Workflows sub-tabs, which have nothing to set.
 * The protein settings moved with History's protein sub-tab to the Protein studio (US-01M6Q164,
 * D0247 (2)): they are checked there, on the same DNA construct, under the Protein studio's title.
 * History is provenance only (US-01M7QC8Q, D0250): it has no sub-tab strip, and each former sub-tab's
 * check follows its panel to its new home - folding to Primers & CRISPR (the DNA construct), the
 * Enzymes view to Sequence Map and Cloning & Gel, the workflow runner to Pipelines & NGS, and the
 * strain to Info's Sequence Alerts & Host Strain card. History's Lineage section keeps Show History Colors.
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
import { STUDIO_ENTRIES } from '../core/studioRegistry';

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
/** A studio's one name, from the studio registry (US-01M6Q16Q, D0237): its tab and inspector title read it, whatever the record. */
const studioName = (id: string): string => STUDIO_ENTRIES.find((e) => e.id === id)!.name;

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
/** History's former sub-tabs, each now a panel in its own host (US-01M7QC8Q): none is drawn in History. */
const FORMER_SUB_TABS = ['Secondary Structure', 'Enzymes View (123 / ||||)', 'History Tree, Alerts & Info', 'Workflows & Genetic Code Tables'];
/** History has no sub-tab strip (US-01M7QC8Q AC1): no tab button at all in its canvas. */
function expectNoSubTabs(app: AppHarness, where: string, root?: LiveElement) {
  const tabs = subTabButtons(app, root).map((b) => b.textContent.trim());
  expect(tabs, `${where}: History has no sub-tab strip`).toEqual([]);
  for (const former of FORMER_SUB_TABS) expect(tabs, `${where}: no "${former}"`).not.toContain(former);
}
/** The inspector a studio shows with its own settings section(s). */
const OPEN = (studio: string, sections: string[]) =>
  ({ button: `Hide ${studioName(studio)} Controls Inspector`, title: `${studioName(studio)} Controls`, sections });
/** Primers & CRISPR hosting the folding panel for the DNA construct: the Folding section alone. */
const FOLD_OPEN = OPEN('primers-crispr', ['Folding']);
/** History's inspector: the Lineage section alone. */
const LINEAGE_OPEN = OPEN('history', ['Lineage']);
/** The panel a host draws for the Enzymes view or folding (App's hostedPanelNode). */
const hosted = (app: AppHarness, name: 'Enzymes view' | 'Folding') => app.canvas().querySelectorAll(`section[aria-label="${name}"]`);
/** Opens the folding panel with the native View > Secondary Structure, as a user does; the DNA construct folds in Primers & CRISPR. */
async function openFolding(app: AppHarness) {
  await app.menu('view:secondary-structure');
  expect(app.activeTab(), 'folding a DNA opens Primers & CRISPR').toBe('primers-pcr');
  expect(hosted(app, 'Folding'), 'the folding panel is shown').toHaveLength(1);
}
/** History's former protein sub-tab, now the Protein studio (US-01M6Q164). */
const FORMER_PROTEIN_SUB_TAB = 'Protein Analysis & Codon Opt';
/** The Protein studio's inspector on a DNA construct: the protein analysis's section alone (no structure to set). */
const PROTEIN_OPEN = { button: `Hide ${studioName('protein-3d')} Controls Inspector`, title: `${studioName('protein-3d')} Controls`, sections: ['Protein Analysis'] };
/** Opens the Protein studio on the active record from the rail, as a user does. */
async function openProtein(app: AppHarness) {
  await app.clickStudio('protein-3d');
  expect(app.activeTab(), 'the Protein studio').toBe('protein-3d');
}
/** Back to History from the rail. */
async function backToHistory(app: AppHarness) {
  await app.clickTab('history-hybrid');
  expect(app.activeTab(), 'History').toBe('history-hybrid');
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
interface LineageControls { colors: LiveElement }
/**
 * The Lineage section's one control, Show History Colors, in the column only. The transformation
 * strain left with the alerts for Info (US-01M7QC8Q AC4): it is nowhere in History.
 */
function lineageControls(app: AppHarness): LineageControls {
  const body = sectionBody(app, 'Lineage');
  const colors = onlyIn(app, body, 'Show History Colors', historyColors);
  expect(body.querySelectorAll('input, select, textarea'), 'Show History Colors is the section\'s only control').toHaveLength(1);
  expect(selectsOffering(app.doc.body, STRAINS), 'no strain picker anywhere on History').toHaveLength(0);
  return { colors };
}
/** The strain picker in Info (US-01M7QC8Q AC4), opened from the rail on the same document. */
async function strainInInfo(app: AppHarness): Promise<LiveElement> {
  await app.clickTab('document-info');
  const strain = once(app.canvas(), 'the transformation strain in Info', (r) => selectsOffering(r, STRAINS));
  expect(labelText(strain).startsWith('Bacterial Transformation Strain'), 'the strain is labelled').toBe(true);
  expect(cardOf(strain), 'the strain sits in Info\'s alerts card').toBe('Sequence Alerts & Host Strain');
  return strain;
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
      expect(app.railTabs().filter((b) => b.getAttribute('data-studio') === 'history')[0]?.textContent.trim(), 'the rail entry reads History').toBe('History');

      // History has no sub-tab strip (US-01M7QC8Q): the protein settings are the Protein studio's, on the same construct.
      expectNoSubTabs(app, 'History');
      expect(subTabButtons(app).map((b) => b.textContent.trim()), 'no protein sub-tab in History').not.toContain(FORMER_PROTEIN_SUB_TAB);
      // Protein: the hydropathy window and the protease; the MS2 peptide picker stays with its spectrum.
      await openProtein(app);
      expect(shown(app)).toEqual(PROTEIN_OPEN);
      proteinControls(app);
      const peptidePickers = (root: LiveElement) => root.querySelectorAll('select').filter((s) => labelText(s).startsWith('b/y Fragment Ions'));
      expect(peptidePickers(app.canvas()), 'the MS2 peptide picker stays in the canvas').toHaveLength(1);
      expect(peptidePickers(app.inspectorAside()!), 'and is not in the inspector').toHaveLength(0);

      // Secondary structure, in Primers & CRISPR for the DNA construct: fold as, region, temperature,
      // dangles and topology; the hairpin picker stays with its drawing.
      await openFolding(app);
      expect(shown(app)).toEqual(FOLD_OPEN);
      foldControls(app);
      const hairpinPickers = (root: LiveElement) => root.querySelectorAll('select').filter((s) => labelText(s).startsWith('Hairpin shown below'));
      expect(hairpinPickers(app.canvas()), 'the hairpin picker stays in the canvas').toHaveLength(1);
      expect(hairpinPickers(app.inspectorAside()!), 'and is not in the inspector').toHaveLength(0);

      // Lineage: Show History Colors alone; the transformation strain is in Info.
      await backToHistory(app);
      expect(shown(app)).toEqual(LINEAGE_OPEN);
      lineageControls(app);
      await strainInInfo(app);
      await backToHistory(app);

      // Hidden, the inspector draws no column and its settings are nowhere, not back in the canvas; the button stays.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual({ button: 'Show History Controls Inspector', title: null, sections: [] });
      expect(historyColors(app.doc.body), 'Show History Colors is nowhere while hidden').toHaveLength(0);
      expect(selectsOffering(app.doc.body, STRAINS), 'the strain is nowhere while hidden').toHaveLength(0);
      await openProtein(app);
      expect(shown(app), 'a switch to the Protein studio keeps it hidden').toEqual({ button: `Show ${studioName('protein-3d')} Controls Inspector`, title: null, sections: [] });
      expect(ranges(app.canvas()), 'the hydropathy window is not drawn in the canvas while hidden').toHaveLength(0);
      expect(selectsOffering(app.doc.body, PROTEASES), 'the protease is nowhere while hidden').toHaveLength(0);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(PROTEIN_OPEN);
      proteinControls(app);
    });
  });
});

// ─── AC2 ───

describe('no inspector where there is nothing to set (AC2)', () => {
  it('offers no inspector on the Enzymes and Workflows sub-tabs', async () => {
    await withApp(async (app) => {
      await onHistory(app);
      expect(shown(app).button, 'History, whose lineage has settings, shows the button').toBe('Hide History Controls Inspector');
      const nothingToSet = (where: string) => {
        expect(shown(app), where).toEqual(NONE);
        expect(app.all('[aria-label$=" Inspector"]'), `${where}: no inspector control anywhere, disabled or not`).toHaveLength(0);
        expect(app.bodySplit().classList.contains('inspector-hidden'), `${where}: the body split draws no column`).toBe(true);
      };

      // The Enzymes view in Cloning & Gel: the hosted view has nothing to set.
      await app.clickTab('cloning-gel');
      await app.menu('view:enzymes');
      expect(app.activeTab(), 'the Enzymes view, asked from Cloning & Gel').toBe('cloning-gel');
      expect(hosted(app, 'Enzymes view'), 'Cloning & Gel hosts the Enzymes view').toHaveLength(1);
      nothingToSet('enzymes in Cloning & Gel');
      await backToHistory(app);
      expect(shown(app).sections, 'back from the Enzymes view, the settings return').toEqual(['Lineage']);

      // The Enzymes view in Sequence Map adds no section: the column is Sequence Map's own.
      await app.clickTab('sequence-view');
      const mapSections = shown(app).sections;
      await app.menu('view:enzymes');
      expect(app.activeTab(), 'the Enzymes view, asked from Sequence Map').toBe('sequence-view');
      expect(hosted(app, 'Enzymes view'), 'Sequence Map hosts the Enzymes view').toHaveLength(1);
      expect(shown(app), 'Sequence Map keeps its own column, with no section from the Enzymes view').toEqual(OPEN('sequence-map', mapSections));

      // The workflow plugin runner, on Pipelines & NGS's Workflow Plugins view.
      await app.clickStudio('pipelines-ngs');
      const view = app.canvas().querySelectorAll('button[role="tab"]').filter((b) => b.textContent.trim() === 'Workflow Plugins');
      expect(view, 'the Workflow Plugins view').toHaveLength(1);
      await app.click(view[0]);
      expect(app.canvas().textContent, 'the plugin runner is shown').toContain('Workflow Automation & Bioinformatics Plugin Runner');
      nothingToSet('workflows in Pipelines & NGS');
      await backToHistory(app);
      expect(shown(app).sections, 'back from workflows, the settings return').toEqual(['Lineage']);
    });

    // An Enzyme Set: its History tab reads History, the panel's registry name, not a per-record
    // "Enzymes" (US-01M6Q16Q, D0237), and that name titles the inspector of its Lineage section.
    // Its Enzymes view is in Cloning & Gel (D0220), with nothing to set.
    await withApp(async (app) => {
      await onHistory(app, ENZYME_SET);
      expect(app.railTabs().filter((b) => b.getAttribute('data-studio') === 'history')[0]?.textContent.trim(), 'the rail entry reads the panel name').toBe(studioName('history'));
      expectNoSubTabs(app, 'an Enzyme Set on History');
      expect(hosted(app, 'Enzymes view'), 'no Enzymes view in History').toHaveLength(0);
      expect(shown(app)).toEqual(LINEAGE_OPEN);
      lineageControls(app);
      await app.clickTab('cloning-gel');
      expect(hosted(app, 'Enzymes view'), 'an Enzyme Set opens Cloning & Gel on its Enzymes view').toHaveLength(1);
      expect(shown(app), 'the Enzymes view').toEqual(NONE);
      await backToHistory(app);
      expect(shown(app), 'back on History').toEqual(LINEAGE_OPEN);
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
      await openProtein(app);
      const at9 = expectedHydropathyLine(e, 9);
      const at13 = expectedHydropathyLine(e, 13);
      expect(at13, 'the fixture tells window 9 from 13').not.toBe(at9);
      expect(hydropathyLine(app), 'drawn at the default window').toBe(at9);
      await app.change(proteinControls(app).window, '13');
      expect(hydropathyLine(app), 'redrawn at window 13').toBe(at13);
      expect(hydropathyHeading(app)).toEqual(['Kyte-Doolittle Hydropathy Plot (Window = 13 aa)']);
      expect(labelText(proteinControls(app).window)).toBe('Hydropathy window: 13 aa');
      await app.change(proteinControls(app).protease, 'Glu-C');
      // The protein values are the panel's, not the section's: kept across hiding and showing the inspector.
      await app.click(app.inspectorButton()!);
      expect(shown(app).button).toBe(`Show ${studioName('protein-3d')} Controls Inspector`);
      await app.click(app.inspectorButton()!);
      const p = proteinControls(app);
      expect([p.window.value, p.protease.value], 'after hiding and showing the inspector: protein').toEqual(['13', 'Glu-C']);
      expect(hydropathyLine(app), 'after hiding and showing the inspector: the plot at window 13').toBe(at13);

      // A new temperature refolds, in Primers & CRISPR: the MFE shown is the engine's at that temperature.
      await openFolding(app);
      const mfe = (t: number) => e.bio.predictSecondaryStructure(CONSTRUCT_SEQ, 'DNA', { temperatureC: t, danglingEnds: true, circular: false }).minimumFreeEnergyKcalMol;
      expect(mfe(60), 'the fixture folds differently at 37 and 60 °C').not.toBe(mfe(37));
      expect(kpi(app, 'Minimum Free Energy'), 'folded at 37 °C').toBe(`${mfe(37)} kcal/mol`);
      await app.change(foldControls(app).temperature, '60');
      expect(kpi(app, 'Minimum Free Energy'), 'refolded at 60 °C').toBe(`${mfe(60)} kcal/mol`);
      // The fold's values are kept across asking for folding again and across hiding and showing the inspector.
      const foldKept = async (where: string) => {
        expect(foldControls(app).temperature.value, `${where}: temperature`).toBe('60');
        expect(kpi(app, 'Minimum Free Energy'), `${where}: folded at 60 °C`).toBe(`${mfe(60)} kcal/mol`);
      };
      await openFolding(app);
      await foldKept('after View > Secondary Structure again');
      await app.click(app.inspectorButton()!);
      expect(shown(app).button).toBe(`Show ${studioName('primers-crispr')} Controls Inspector`);
      await app.click(app.inspectorButton()!);
      await foldKept('after hiding and showing the inspector');

      // History Colors recolours the lineage graph.
      await backToHistory(app);
      const coloured = lineageStrokes(app);
      expect(coloured.edges.length, 'the graph has edges').toBeGreaterThan(0);
      expect(new Set(coloured.edges), 'edges in history colour').toEqual(new Set(['var(--mbc-blue)']));
      expect(coloured.nodes.some((s) => s !== 'var(--mbc-green)'), 'nodes in their history colours').toBe(true);
      await app.change(lineageControls(app).colors, false);
      const plain = lineageStrokes(app);
      expect(new Set(plain.edges), 'edges plain').toEqual(new Set(['var(--mbc-text-muted)']));
      expect(new Set(plain.nodes), 'nodes plain').toEqual(new Set(['var(--mbc-green)']));

      // History has no sub-tabs to switch: the lineage value is kept across hiding and showing the inspector.
      await app.click(app.inspectorButton()!);
      expect(shown(app).button).toBe('Show History Controls Inspector');
      await app.click(app.inspectorButton()!);
      expect(lineageControls(app).colors.checked, 'after hiding and showing the inspector: lineage').toBe(false);
      expect(new Set(lineageStrokes(app).edges), 'after hiding and showing the inspector: edges plain').toEqual(new Set(['var(--mbc-text-muted)']));
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
    // Each level in the popup it opened: View's own History submenu and Studio Views > History share a label (US-01M6Q1CF AC6).
    const popups = app.all('.desktop-menu-popup');
    const rows = menuRows(app, name).filter((b) => popups.length === 0 || popups[popups.length - 1].contains(b));
    expect(rows, `one "${name}" row`).toHaveLength(1);
    await app.click(rows[0]);
  }
  expect(app.all('button.desktop-menu-row'), 'the menus closed').toHaveLength(0);
}

describe('the commands that open a History sub-tab (AC5)', () => {
  it('shows the sub-tab a menu command opens, with its sections', async () => {
    await withApp(async (app) => {
      await onHistory(app);
      // Folding opens in Primers & CRISPR for the DNA construct; the lineage routes stay on History (US-01M7QC8Q).
      type Home = 'fold' | 'lineage';
      const routes: { name: string; run: () => Promise<void>; home: Home }[] = [
        { name: 'the native View > Secondary Structure (view:secondary-structure)', run: () => app.menu('view:secondary-structure'), home: 'fold' },
        { name: 'View > Studio Views > Secondary Structure', run: () => choose(app, 'View', ['Studio Views'], 'Secondary Structure'), home: 'fold' },
        { name: 'the native View > Lineage (view:lineage)', run: () => app.menu('view:lineage'), home: 'lineage' },
        { name: 'the native Tools > Workflows (tools:workflows)', run: () => app.menu('tools:workflows'), home: 'lineage' },
        { name: 'View > Studio Views > History', run: () => choose(app, 'View', ['Studio Views'], 'History'), home: 'lineage' },
        { name: 'Tools > Pipelines > Lineage Manager', run: () => choose(app, 'Tools', ['Pipelines'], 'Lineage Manager'), home: 'lineage' },
      ];
      for (const route of routes) {
        // From Sequence Map with the Enzymes view open (History's former Enzymes sub-tab), from the
        // Protein studio on the same construct (History's former protein sub-tab, US-01M6Q164), then
        // from Sequence Map alone.
        for (const from of ['Sequence Map > Enzymes', 'Protein & 3D', 'Sequence'] as const) {
          if (from === 'Sequence') {
            await app.clickTab('sequence-view');
            expect(shown(app).title, 'on the Sequence tab').toBe(`${studioName('sequence-map')} Controls`);
            expect(hosted(app, 'Enzymes view'), 'Sequence Map alone').toHaveLength(0);
          } else if (from === 'Protein & 3D') {
            await openProtein(app);
            expect(shown(app)).toEqual(PROTEIN_OPEN);
          } else {
            if (app.activeTab() !== 'sequence-view') await app.clickTab('sequence-view');
            await app.menu('view:enzymes');
            expect(app.activeTab(), 'the Enzymes view in Sequence Map').toBe('sequence-view');
            expect(hosted(app, 'Enzymes view'), 'the Enzymes view is open').toHaveLength(1);
          }
          await route.run();
          const where = `${route.name}, from ${from}`;
          if (route.home === 'fold') {
            expect(app.activeTab(), where).toBe('primers-pcr');
            expect(hosted(app, 'Folding'), `${where}: the folding panel`).toHaveLength(1);
            expect(shown(app), where).toEqual(FOLD_OPEN);
            foldControls(app);
          } else {
            expect(app.activeTab(), where).toBe('history-hybrid');
            expectNoSubTabs(app, where);
            expect(shown(app), where).toEqual(LINEAGE_OPEN);
            lineageControls(app);
          }
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
      const { HybridToolsAndHistoryStudio, FoldingPanel, SequenceAlertsPanel } = await import('../components/HybridToolsAndHistoryStudio');
      // History's former protein sub-tab is the Protein studio's panel (US-01M6Q164): drawn on its own too.
      const { ProteinStudio } = await import('../components/ProteinStudio');
      const probe = app.doc.createElement('div');
      app.doc.body.appendChild(probe);
      let root = createRoot(probe as unknown as Element);
      /** Draws `el` alone in the probe, in place of what it held. */
      const drawAlone = async (el: React.ReactElement) => {
        await React.act(async () => { root.unmount(); });
        root = createRoot(probe as unknown as Element);
        await React.act(async () => { root.render(el); });
        await app.settle();
      };
      try {
        await React.act(async () => {
          root.render(React.createElement(ProteinStudio, { activeDoc: CONSTRUCT }));
        });
        await app.settle();
        const noSections = (where: string) =>
          expect(probe.querySelectorAll('.mbc-accordion-section, .mbc-inspector-sections'), `${where}: no inspector section`).toHaveLength(0);

        // Protein: the window in the hydropathy plot's header, the protease in the digest's header.
        noSections('Protein');
        const window = once(probe, 'the hydropathy window', ranges);
        expect([window.getAttribute('min'), window.getAttribute('max'), window.getAttribute('step'), window.value], 'the hydropathy window').toEqual(['5', '21', '2', '9']);
        expect(headerOf(window), 'the window sits in the hydropathy plot\'s header').toBe('Kyte-Doolittle Hydropathy Plot (Window = 9 aa)');
        const protease = once(probe, 'the protease', (r) => selectsOffering(r, PROTEASES));
        expect(headerOf(protease), 'the protease sits in the digest\'s header').toBe('Proteomics LC-MS/MS Digest, b/y-Ion MS2 & PTM / Disulfide Prediction');

        // Secondary structure, History's former sub-tab, drawn on its own as the folding panel (US-01M7QC8Q):
        // the five fold settings in one grid of the fold's card.
        await drawAlone(React.createElement(FoldingPanel, { doc: CONSTRUCT, allDocuments: [CONSTRUCT, PARENT] }));
        noSections('Secondary structure');
        const grids = new Set<LiveElement>();
        const fold = [['fold as', FOLD_AS], ['the region', FOLD_REGION], ['the temperature', FOLD_TEMPS], ['the dangling ends', FOLD_DANGLES], ['the topology', FOLD_TOPOLOGY]] as const;
        for (const [what, values] of fold) {
          const field = once(probe, what, (r) => selectsOffering(r, values)).closest('label')!;
          expect(cardOf(field)?.startsWith('Nucleic-Acid Fold'), `${what} sits in the fold's card`).toBe(true);
          grids.add(field.parentElement!);
        }
        expect([...grids].map((g) => g.getAttribute('class')), 'the five share one grid').toEqual(['form-grid-2col']);

        // Lineage: History drawn on its own, with no sub-tab strip; Show History Colors in the history tree's header.
        await drawAlone(React.createElement(HybridToolsAndHistoryStudio, { doc: CONSTRUCT, allDocuments: [CONSTRUCT, PARENT], initialSubTab: 'lineage' }));
        noSections('Lineage');
        expectNoSubTabs(app, 'History drawn on its own', probe);
        const colors = once(probe, 'Show History Colors', historyColors).closest('label')!;
        expect(headerOf(colors), 'Show History Colors sits in the history tree\'s header').toBe('Construct History Tree & History Colors');
        expect(selectsOffering(probe, STRAINS), 'no strain in History').toHaveLength(0);

        // The strain, drawn on its own with the alerts it drives (Info's slot): first in the alerts card's grid.
        await drawAlone(React.createElement(SequenceAlertsPanel, { doc: CONSTRUCT, allDocuments: [CONSTRUCT, PARENT] }));
        noSections('Sequence alerts');
        const strain = once(probe, 'the transformation strain', (r) => selectsOffering(r, STRAINS)).closest('label')!;
        expect(labelText(strain).startsWith('Bacterial Transformation Strain'), 'the strain is labelled').toBe(true);
        expect(cardOf(strain), 'the strain sits in the alerts card').toBe('Sequence Alerts & Host Strain');
        const grid = strain.parentElement!;
        expect([grid.getAttribute('class'), grid.children[0] === strain], 'the strain is the first field of the card\'s grid').toEqual(['form-grid-2col', true]);
      } finally {
        await React.act(async () => { root.unmount(); });
        probe.remove();
      }
    });
  });
});
