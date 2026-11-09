// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAZE: a built tree's parameters in App's shared inspector, titled "Tree Controls". The
 * phylogeny module's method, distance model, bootstrap replicates, topology style and Show Bootstrap
 * form a Tree Building section; Distances' model, Ancestors' method and Clocks' root age each form
 * their own; the module picker stays in the studio's top bar, and the modules with nothing to set
 * show no button. In the workbench the phylogeny module leaves the figure-first layout: its heading
 * card (the method heading, the support badge and any external-program notice) sits above the tree
 * at full width, with no near-empty column beside it (D0063 ruling b).
 *
 * Every check runs in the real App over the live DOM (the US-01M6TB6G harness, appHarness.tsx): an
 * alignment built here is restored on the Tree tab, and the checks read App's own header button, its
 * inspector column (aside.mbc-right-controls) and its viewer canvas, and drive the settings by editing
 * them in that column. The studio is also drawn on its own (a React root of its own in the launched
 * App's window, no WorkbenchInspectorProvider above it), where every setting stays where it sat and the
 * phylogeny module keeps its figure-first columns (US-01M6Q1Z0).
 *
 * The desktop backend that runs FastTree, PhyML, RAxML and MrBayes is replaced by a fake whose
 * detection and runs each check settles by hand (src/core/externalTreePrograms.ts keeps its own key
 * and names); until a check turns it on, it answers as the browser build does: not the desktop app.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ExternalProgramStatus, ExternalTreeResult } from '../core/externalTreePrograms';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { cascaded, gridTracks } from './cssCascade';
import type { LiveElement } from './liveDom';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

// ─── The desktop backend, faked ───

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(err: unknown): void }
interface FakeRun { algorithm: string; names: string[]; seqs: string[]; job: Deferred<ExternalTreeResult>; cancels: number }
const ext = vi.hoisted(() => {
  const deferred = <T,>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  return {
    deferred,
    /** Off: detection answers null, as in the browser build. */
    on: false,
    detection: null as Deferred<ExternalProgramStatus[] | null> | null,
    /** The refresh flag of each detection the studio asked for. */
    detections: [] as boolean[],
    runs: [] as FakeRun[],
    cache: new Map<string, ExternalTreeResult>(),
  };
});
vi.mock('../core/externalTreePrograms', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/externalTreePrograms')>();
  return {
    ...real,
    detectExternalTreePrograms: (refresh = false) => {
      if (!ext.on) return Promise.resolve(null);
      ext.detections.push(refresh);
      return ext.detection!.promise;
    },
    runExternalTree: (algorithm: string, names: string[], seqs: string[]) => {
      const run: FakeRun = { algorithm, names, seqs, job: ext.deferred<ExternalTreeResult>(), cancels: 0 };
      ext.runs.push(run);
      const key = real.externalTreeCacheKey(algorithm, names, seqs);
      return {
        promise: run.job.promise.then((r) => { ext.cache.set(key, r); return r; }),
        cancel: () => { run.cancels += 1; },
      };
    },
    cachedExternalTree: (key: string) => ext.cache.get(key),
  };
});
function resetBackend(on: boolean) {
  ext.on = on;
  ext.detection = on ? ext.deferred<ExternalProgramStatus[] | null>() : null;
  ext.detections = [];
  ext.runs = [];
  ext.cache.clear();
}

async function withApp(run: (app: AppHarness) => Promise<void>, desktop = false): Promise<void> {
  resetBackend(desktop);
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
    resetBackend(false);
  }
}

// ─── An alignment built in the test ───

/** Deterministic letters (LCG), so every run reads the same sequence. */
function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[Math.floor((s / 2 ** 32) * 4)];
  }
  return out;
}
/** `seq` with the base at each 1-based column in `cols` moved one step along ACGT. */
function substituted(seq: string, cols: number[]): string {
  const out = seq.split('');
  for (const c of cols) out[c - 1] = 'ACGT'[('ACGT'.indexOf(out[c - 1]) + 1) % 4];
  return out.join('');
}

const ROOT = lettersFrom(0x7a2e, 120);
const LEFT = substituted(ROOT, [4, 19, 33, 47, 61, 75, 88, 102]);
const RIGHT = substituted(ROOT, [9, 26, 40, 54, 68, 83, 97, 111]);
/** Six members in three pairs, two of them nearer each other: a resolved tree with supported clades. */
const MEMBERS: [string, string][] = [
  ['TAZE_A', substituted(LEFT, [12, 70])],
  ['TAZE_B', substituted(LEFT, [30, 95])],
  ['TAZE_C', substituted(RIGHT, [15, 58])],
  ['TAZE_D', substituted(RIGHT, [44, 105])],
  ['TAZE_E', substituted(ROOT, [7, 22, 36, 50, 64, 79, 93, 108, 115])],
  ['TAZE_F', substituted(ROOT, [2, 17, 29, 52, 66, 81, 99, 113, 118])],
];
const NAMES = MEMBERS.map(([name]) => name);
const SEQS = MEMBERS.map(([, seq]) => seq);
const ALN: SequenceDocument = {
  id: 'taze-aln', name: 'TAZE Tree Alignment', accession: 'TAZE_0001', description: 'An alignment built in the test',
  sequence: ROOT, moleculeType: 'DNA', topology: 'linear', folder: 'Alignments', documentKind: 'alignment',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
  alignmentMeta: { isAligned: true, sequences: MEMBERS.map(([name, sequence], i) => ({ id: `taze-m${i + 1}`, name, sequence })) },
} as SequenceDocument;

/** Opens the alignment on its Tree tab (the phylogeny module unless a command chose another). */
const onTree = (app: AppHarness) => app.restoreSession({ documents: [ALN], activeDocId: ALN.id, viewerTab: 'phylogenetics' });

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
/**
 * The inspector as the App shows it: the header button's label, the pane title and the section
 * headers in its column, and any section drawn into the viewer canvas instead.
 */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  return {
    button: label(app.inspectorButton()),
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
    sections: aside ? aside.querySelectorAll('button.mbc-accordion-header').map((b) => words(b.textContent)) : [],
    inCanvas: app.canvas().querySelectorAll('.mbc-accordion-section').length,
  };
}
const OPEN = (...sections: string[]) => ({ button: 'Hide Tree Controls Inspector', title: 'Tree Controls', sections, inCanvas: 0 });
const CLOSED = { button: 'Show Tree Controls Inspector', title: null, sections: [], inCanvas: 0 };
const NONE = { button: null, title: null, sections: [], inCanvas: 0 };

/** The module picker, in the studio's top bar in the canvas and nowhere in the inspector. */
function picker(app: AppHarness): LiveElement {
  const found = app.all('select[aria-label="Active Phylogenetic Analysis"]');
  expect(found, 'one module picker').toHaveLength(1);
  expect(found[0].closest('.phylo-studio-topbar') !== null && app.canvas().contains(found[0]), 'the picker sits in the top bar, in the canvas').toBe(true);
  return found[0];
}
async function chooseModule(app: AppHarness, module: string) {
  await app.change(picker(app), module);
  expect(picker(app).value).toBe(module);
}

/** The body of the column's section headed `title`. */
function sectionBody(app: AppHarness, title: string): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, `the inspector column, for the ${title} section`).not.toBeNull();
  const sections = aside!.querySelectorAll('.mbc-accordion-section')
    .filter((s) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '') === title);
  expect(sections, `one "${title}" section`).toHaveLength(1);
  const bodies = sections[0].querySelectorAll('.mbc-accordion-body');
  expect(bodies, `the "${title}" section is unfolded`).toHaveLength(1);
  return bodies[0];
}

/** The words a control is labelled with: the first span of the label it sits in. */
const named = (el: LiveElement) => el.closest('label')?.querySelectorAll('span')[0]?.textContent.trim() ?? null;
const optionValues = (select: LiveElement) => select.options.map((o) => o.value);
/** The selects under `root` that offer exactly `values`, in order. */
const selectsOffering = (root: LiveElement, values: readonly string[]) =>
  root.querySelectorAll('select').filter((s) => JSON.stringify(optionValues(s)) === JSON.stringify(values));
const fieldsNamed = (selector: string, name: string) => (root: LiveElement) => root.querySelectorAll(selector).filter((c) => named(c) === name);
const buttonsReading = (text: string) => (root: LiveElement) => root.querySelectorAll('button').filter((b) => words(b.textContent) === text);

/** The one control in the section's body matched by `find`, which must be nowhere else in the page. */
function onlyIn(app: AppHarness, body: LiveElement, what: string, find: (root: LiveElement) => LiveElement[]): LiveElement {
  expect(find(body), `${what}: one in the inspector section`).toHaveLength(1);
  expect(find(app.canvas()), `${what}: none in the viewer canvas`).toHaveLength(0);
  expect(find(app.doc.body), `${what}: one in the whole page`).toHaveLength(1);
  return find(body)[0];
}

// The phylogeny module's settings.
const TREE_METHODS = [
  'Neighbor-Joining (NJ)', 'UPGMA', 'Minimum-Evolution (ME)', 'Maximum Parsimony (MP)', 'Maximum Likelihood (ML)',
  'FastTree (Approx-ML)', 'PhyML (ML + SH-aLRT)', 'RAxML (GTR+G Rapid ML)', 'MrBayes (Bayesian MCMC)',
];
const TREE_MODELS = ['Tamura-Nei (TN93)', 'Tamura 3-parameter (T92)', 'Kimura 2-parameter (K2P)', 'Jukes-Cantor (JC69)', 'p-distance'];
const BOOTSTRAPS = ['100', '500', '1000'];
const TOPOLOGIES = ['phylogram', 'cladogram', 'radial'];
const TREE_BUILDING = ['Tree Inference Method:', 'Distance Model:', 'Bootstrap Replicates:', 'Tree Topology Style:', 'Show Bootstrap % on Nodes'];
const showBootstrap = fieldsNamed('input[type="checkbox"]', 'Show Bootstrap % on Nodes');
interface TreeBuilding { method: LiveElement; model: LiveElement; bootstrap: LiveElement; topology: LiveElement; support: LiveElement }
/** The Tree Building section's five controls, in the column only. */
function treeBuilding(app: AppHarness): TreeBuilding {
  const body = sectionBody(app, 'Tree Building');
  expect(body.querySelectorAll('select, input, textarea').map(named), 'the Tree Building section holds the five settings').toEqual(TREE_BUILDING);
  const tb = {
    method: onlyIn(app, body, 'the method', (r) => selectsOffering(r, TREE_METHODS)),
    model: onlyIn(app, body, 'the distance model', (r) => selectsOffering(r, TREE_MODELS)),
    bootstrap: onlyIn(app, body, 'the bootstrap replicates', (r) => selectsOffering(r, BOOTSTRAPS)),
    topology: onlyIn(app, body, 'the topology style', (r) => selectsOffering(r, TOPOLOGIES)),
    support: onlyIn(app, body, 'Show Bootstrap', showBootstrap),
  };
  expect([named(tb.method), named(tb.model), named(tb.bootstrap), named(tb.topology)]).toEqual(TREE_BUILDING.slice(0, 4));
  return tb;
}
/** The settings of the phylogeny module counted anywhere in the page (all gone while the inspector is hidden). */
const treeSettingsAnywhere = (app: AppHarness) =>
  [TREE_METHODS, TREE_MODELS, BOOTSTRAPS, TOPOLOGIES].reduce((n, v) => n + selectsOffering(app.doc.body, v).length, 0) + showBootstrap(app.doc.body).length;

// The phylogeny module's result.
/** The drawn tree (its figure, not an icon), in the canvas. */
function treeSvg(app: AppHarness): LiveElement {
  const found = app.canvas().querySelectorAll('svg[role="img"]').filter((s) => /^Phylogenetic tree \(\d+ tips\)$/.test(s.getAttribute('aria-label') ?? ''));
  expect(found, 'one drawn tree').toHaveLength(1);
  return found[0];
}
/** The phylogeny module's grid: the one around the drawn tree. */
function phyloGrid(app: AppHarness): LiveElement {
  const grid = treeSvg(app).closest('.studio-split-grid');
  expect(grid, 'the tree sits in the module grid').not.toBeNull();
  return grid!;
}
/** The method heading and the support badge on the heading card. */
function headingCard(app: AppHarness) {
  const card = phyloGrid(app).children[0];
  const header = card.querySelectorAll('.studio-card-header')[0];
  return { card, heading: words(header?.querySelectorAll('h3')[0]?.textContent ?? ''), badge: words(header?.querySelectorAll('.badge-accent')[0]?.textContent ?? '') };
}
const figureOf = (app: AppHarness) => treeSvg(app).closest('[data-mbc-figure]')!;
const figureHeading = (app: AppHarness) => words(figureOf(app).querySelectorAll('h4')[0]?.textContent ?? '');
const figureBadge = (app: AppHarness) => words(figureOf(app).querySelectorAll('.badge-accent')[0]?.textContent ?? '');
/** The support labels drawn on the tree's nodes (95%, ...). */
const supportLabels = (app: AppHarness) => treeSvg(app).querySelectorAll('text').filter((t) => /^\d+%$/.test(words(t.textContent)));
/** The Newick string the result shows behind its disclosure. */
const shownNewick = (app: AppHarness) => {
  const codes = app.canvas().querySelectorAll('.newick-box code');
  expect(codes, 'one Newick string').toHaveLength(1);
  return words(codes[0].textContent);
};

// The other modules' settings.
const DISTANCE_MODELS = ['p-distance', 'Jukes-Cantor (JC69)', 'Kimura 2-parameter (K2P)', 'Tamura 3-parameter (T92)', 'Tamura-Nei (TN93)'];
const ANCESTRAL_METHODS = ['Maximum Likelihood (Empirical Bayes)', 'Maximum Parsimony (Fitch)'];
const rootAge = fieldsNamed('input[type="number"]', 'Root age (Mya):');
/** A card in the canvas whose header reads `heading`. */
function cardHeaded(root: LiveElement, heading: string): LiveElement {
  const cards = root.querySelectorAll('.studio-card').filter((c) => words(c.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? '') === heading);
  expect(cards, `one card headed "${heading}"`).toHaveLength(1);
  return cards[0];
}
const DISTANCE_MATRIX = 'Pairwise Evolutionary Distance Matrix (d below diag / SE above diag)';
const DISTANCE_SUMMARY = 'Overall, Within-Group, Between-Group & Net Distances';
const ANCESTORS = 'Infer Ancestral Sequences (MRCA & Clade Nodes)';
const CLOCKS = 'Strict-Clock Timetree & Root Calibration';
/** The distance summary's model badge and its overall mean distance. */
function distanceSummary(app: AppHarness) {
  const card = cardHeaded(app.canvas(), DISTANCE_SUMMARY);
  const kpi = card.querySelectorAll('.kpi-box').find((k) => words(k.querySelectorAll('.kpi-label')[0]?.textContent ?? '') === 'Overall Mean Distance (d)');
  return { badge: words(card.querySelectorAll('.studio-card-header .badge-accent')[0]?.textContent ?? ''), mean: Number(words(kpi?.querySelectorAll('.kpi-val')[0]?.textContent ?? 'NaN')) };
}
/** The badges on the reconstructed ancestral nodes. */
const ancestralBadges = (app: AppHarness) => cardHeaded(app.canvas(), ANCESTORS).querySelectorAll('.primer-detail-card .badge-accent').map((b) => words(b.textContent));
/** The tick labels under the timetree (root age down to 0). */
const timetreeTicks = (app: AppHarness) => {
  const svgs = cardHeaded(app.canvas(), CLOCKS).querySelectorAll('svg.phylo-tree-svg');
  expect(svgs, 'one timetree').toHaveLength(1);
  return svgs[0].querySelectorAll('text').map((t) => words(t.textContent)).filter((t) => /^\d+\.\d$/.test(t));
};

/** The member documents the App hands the studio for ALN. */
async function memberDocs(): Promise<SequenceDocument[]> {
  const { phylogenySourceDocuments } = await import('../core/documentViews');
  return phylogenySourceDocuments(ALN, [], [ALN]);
}
/** Draws `element` on its own: its own React root in the launched App's window, with no WorkbenchInspectorProvider above it. */
async function drawnOnItsOwn(app: AppHarness, element: (React: typeof import('react')) => import('react').ReactElement, check: (probe: LiveElement) => Promise<void> | void) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const probe = app.doc.createElement('div');
  app.doc.body.appendChild(probe);
  const root = createRoot(probe as unknown as Element);
  try {
    await React.act(async () => { root.render(element(React)); });
    await app.settle();
    expect(probe.querySelectorAll('.mbc-accordion-section, .mbc-inspector-sections'), 'drawn on its own: no inspector section').toHaveLength(0);
    await check(probe);
  } finally {
    await React.act(async () => { root.unmount(); });
    probe.remove();
  }
}
/** The studio on its own, opened on `module`. */
async function studioOnItsOwn(app: AppHarness, module: string, check: (probe: LiveElement) => Promise<void> | void) {
  const { PhylogeneticsStudio } = await import('../components/AlignmentAndPhyloStudio');
  const docs = await memberDocs();
  await drawnOnItsOwn(app, (React) => React.createElement(PhylogeneticsStudio, { documents: docs, activeDoc: docs[0], initialPhyloTab: module as never }), check);
}
/** The phylogeny module drawn on its own: its figure-first grid, a controls column holding only the heading card, and the result column. */
function figureFirstColumns(probe: LiveElement): { card: LiveElement; result: LiveElement } {
  const grids = probe.querySelectorAll('.studio-split-grid');
  expect(grids, 'one module grid').toHaveLength(1);
  const grid = grids[0];
  expect(grid.classList.contains('is-figure-first'), 'the figure-first grid').toBe(true);
  expect(grid.parentElement!.classList.contains('has-figure-first'), 'its wrapper takes the canvas height').toBe(true);
  expect(grid.children.map((c) => c.getAttribute('class')), 'a controls column and a result column').toEqual(['studio-controls-column', 'studio-result-column']);
  const [controls, result] = grid.children;
  expect(controls.children.map((c) => c.getAttribute('class')), 'the heading card alone in the controls column').toEqual(['studio-card']);
  return { card: controls.children[0], result };
}
/** Whether no inspector wrapper (an accordion section or body, or the sections' column) holds `el`. */
const unwrapped = (el: LiveElement) => el.closest('.mbc-accordion-section, .mbc-accordion-body, .mbc-inspector-sections') === null;

/** The canvas widths at 1280x800 and 1440x900: beside the open inspector with and without the planned 56 px rail, and the whole canvas. */
const CANVASES = [{ window: 1280, canvas: 661 }, { window: 1280, canvas: 717 }, { window: 1280, canvas: 1010 }, { window: 1440, canvas: 821 }, { window: 1440, canvas: 877 }, { window: 1440, canvas: 1170 }];

// ─── AC1 ───

describe("each module's parameters in App's inspector (AC1)", () => {
  it("puts each module's parameters in App's inspector", async () => {
    await withApp(async (app) => {
      await onTree(app);
      expect(app.activeTab()).toBe('phylogenetics');
      expect(picker(app).value, 'the phylogeny module').toBe('phylogeny');
      expect(shown(app)).toEqual(OPEN('Tree Building'));
      let tb = treeBuilding(app);
      expect([tb.method.value, tb.model.value, tb.bootstrap.value, tb.topology.value, tb.support.checked], 'the defaults')
        .toEqual(['Maximum Likelihood (ML)', 'Tamura-Nei (TN93)', '500', 'phylogram', true]);
      expect([headingCard(app).heading, headingCard(app).badge, figureHeading(app)]).toEqual(['Neighbor-Joining tree', '500 bootstrap replicates', 'Tree (phylogram)']);
      expect(figureBadge(app)).toMatch(/^6 Tips • \d+ Clades • Tamura-Nei \(TN93\)$/);
      expect(supportLabels(app).length, 'support drawn on the nodes').toBeGreaterThan(0);

      // Each setting, changed in the inspector, reaches the tree.
      await app.change(treeBuilding(app).method, 'UPGMA');
      expect(headingCard(app).heading, 'the method').toBe('UPGMA tree');
      await app.change(treeBuilding(app).model, 'Jukes-Cantor (JC69)');
      expect(figureBadge(app), 'the distance model').toMatch(/• Jukes-Cantor \(JC69\)$/);
      await app.change(treeBuilding(app).bootstrap, '100');
      expect(headingCard(app).badge, 'the bootstrap replicates').toBe('100 bootstrap replicates');
      await app.change(treeBuilding(app).topology, 'cladogram');
      expect(figureHeading(app), 'the topology style').toBe('Tree (cladogram)');
      await app.change(treeBuilding(app).support, false);
      expect(supportLabels(app), 'support hidden').toHaveLength(0);

      // Hidden, the settings are nowhere, not back in the canvas; the tree keeps them. Reopened, they are as set.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED);
      expect(treeSettingsAnywhere(app), 'no tree setting while hidden').toBe(0);
      expect([headingCard(app).heading, headingCard(app).badge, figureHeading(app), supportLabels(app).length]).toEqual(['UPGMA tree', '100 bootstrap replicates', 'Tree (cladogram)', 0]);
      picker(app);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(OPEN('Tree Building'));
      tb = treeBuilding(app);
      expect([tb.method.value, tb.model.value, tb.bootstrap.value, tb.topology.value, tb.support.checked], 'reopened, as set')
        .toEqual(['UPGMA', 'Jukes-Cantor (JC69)', '100', 'cladogram', false]);

      // Distances: the model in its own section, out of the matrix card's header.
      await chooseModule(app, 'distance');
      expect(shown(app)).toEqual(OPEN('Distance Estimation'));
      const distanceModel = () => onlyIn(app, sectionBody(app, 'Distance Estimation'), 'the distance model', (r) => selectsOffering(r, DISTANCE_MODELS));
      expect([named(distanceModel()), distanceModel().value]).toEqual(['Distance Model:', 'Tamura-Nei (TN93)']);
      expect(cardHeaded(app.canvas(), DISTANCE_MATRIX).querySelectorAll('.studio-card-header select'), 'no select left in the matrix header').toHaveLength(0);
      expect(distanceSummary(app).badge).toBe('Tamura-Nei (TN93)');
      await app.change(distanceModel(), 'p-distance');
      const p = distanceSummary(app);
      await app.change(distanceModel(), 'Jukes-Cantor (JC69)');
      const jc = distanceSummary(app);
      expect([p.badge, jc.badge], 'the model chosen in the inspector computes the distances').toEqual(['p-distance', 'Jukes-Cantor (JC69)']);
      expect(jc.mean, 'JC69 corrects the p-distance upwards').toBeGreaterThan(p.mean);
      expect(p.mean).toBeGreaterThan(0);

      // Ancestors: the method in its own section, out of its card's header.
      await chooseModule(app, 'ancestors');
      expect(shown(app)).toEqual(OPEN('Ancestral Reconstruction'));
      const ancestralMethod = () => onlyIn(app, sectionBody(app, 'Ancestral Reconstruction'), 'the ancestral method', (r) => selectsOffering(r, ANCESTRAL_METHODS));
      expect([named(ancestralMethod()), ancestralMethod().value]).toEqual(['Reconstruction Method:', 'Maximum Likelihood (Empirical Bayes)']);
      expect(cardHeaded(app.canvas(), ANCESTORS).querySelectorAll('.studio-card-header select'), 'no select left in the ancestors header').toHaveLength(0);
      expect(ancestralBadges(app).length, 'ancestral nodes reconstructed').toBeGreaterThan(0);
      expect(ancestralBadges(app).every((b) => b.startsWith('Mean posterior of best state: '))).toBe(true);
      await app.change(ancestralMethod(), 'Maximum Parsimony (Fitch)');
      expect(ancestralBadges(app).length).toBeGreaterThan(0);
      expect(ancestralBadges(app).every((b) => b.startsWith('Unambiguous sites: ')), 'parsimony, as chosen in the inspector').toBe(true);

      // Clocks: the root age in its own section; the refusal of a bad age stays with the timetree.
      await chooseModule(app, 'clocks');
      expect(shown(app)).toEqual(OPEN('Root Calibration'));
      const age = () => onlyIn(app, sectionBody(app, 'Root Calibration'), 'the root age', rootAge);
      expect(age().value).toBe('42.5');
      expect(timetreeTicks(app)[0], 'the axis starts at the root age').toBe('42.5');
      await app.change(age(), '100');
      expect(timetreeTicks(app), 'the root age set in the inspector scales the timetree').toEqual(['100.0', '75.0', '50.0', '25.0', '0.0']);
      await app.change(age(), '0');
      expect(age().getAttribute('aria-invalid')).toBe('true');
      const refusals = () => app.canvas().querySelectorAll('[role="alert"]').filter((a) => words(a.textContent) === 'Root age must be a positive number; still using 100 Mya.');
      expect(refusals(), 'the refusal, beside the timetree').toHaveLength(1);
      expect(cardHeaded(app.canvas(), CLOCKS).contains(refusals()[0]), 'in the timetree card').toBe(true);
      expect(app.inspectorAside()!.querySelectorAll('[role="alert"]'), 'not in the inspector').toHaveLength(0);
      expect(timetreeTicks(app)[0], 'still 100 Mya').toBe('100.0');
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED);
      expect(refusals(), 'the refusal stays with the inspector closed').toHaveLength(1);
      await app.click(app.inspectorButton()!);
      // Drawn on its own, each module keeps its setting where it sat: the AC7 checks below.
    });
  });
});

// ─── AC2 ───

describe('the phylogeny heading above the tree (AC2)', () => {
  it('puts the phylogeny heading above the tree with no empty column beside it', async () => {
    await withApp(async (app) => {
      await onTree(app);
      for (const state of ['open', 'closed'] as const) {
        if (state === 'closed') {
          await app.click(app.inspectorButton()!);
          expect(shown(app)).toEqual(CLOSED);
        } else {
          expect(shown(app)).toEqual(OPEN('Tree Building'));
        }
        const grid = phyloGrid(app);
        expect(grid.classList.contains('is-figure-first'), `${state}: no figure-first grid`).toBe(false);
        expect(app.all('.studio-controls-column'), `${state}: no controls column anywhere`).toHaveLength(0);
        // The heading card, then the result column: one above the other.
        expect(grid.children.map((c) => c.getAttribute('class')), `${state}: the module grid`).toEqual(['studio-card', 'studio-result-column']);
        const [card, result] = grid.children;
        expect([headingCard(app).heading, headingCard(app).badge], `${state}: the heading card names the method and its support`).toEqual(['Neighbor-Joining tree', '500 bootstrap replicates']);
        expect(card.querySelectorAll('select, input, textarea'), `${state}: no setting left on the heading card`).toHaveLength(0);
        expect(result.children[0].hasAttribute('data-mbc-figure') && result.children[0].contains(treeSvg(app)), `${state}: the tree first in the result column`).toBe(true);
        // At full width: one track at every canvas the window and the inspector leave.
        for (const view of CANVASES) {
          expect(gridTracks(cascaded(grid, 'grid-template-columns', view)!), `${state}: one column on a ${view.canvas}px canvas`).toEqual(['minmax(0, 1fr)']);
        }
        // The wrapper is not held to the canvas height, and the tree flows with the canvas rather
        // than staying over the metrics as they scroll.
        const wrapper = grid.parentElement!;
        expect(wrapper.classList.contains('alignment-studio-wrapper') && !wrapper.classList.contains('has-figure-first'), `${state}: the wrapper`).toBe(true);
        for (const view of CANVASES) {
          expect(cascaded(wrapper, 'block-size', view), `${state}: the wrapper's height on a ${view.canvas}px canvas`).toBeUndefined();
          expect(cascaded(figureOf(app), 'position', view), `${state}: the figure on a ${view.canvas}px canvas`).toBe('static');
        }
      }

      // Drawn on its own it keeps the figure-first layout: the heading card in a controls column beside the tree.
      await studioOnItsOwn(app, 'phylogeny', (probe) => {
        const { card, result } = figureFirstColumns(probe);
        expect(words(card.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? ''), 'its method heading').toBe('Neighbor-Joining tree');
        const figure = result.children[0];
        expect(figure.hasAttribute('data-mbc-figure') && figure.querySelectorAll('svg[role="img"]').length === 1, 'the tree first in the result column').toBe(true);
        expect(figure.getAttribute('style'), 'the figure keeps the stylesheet\'s sticky place').toBeNull();
      });
    });
  });
});

// ─── AC3 ───

describe('modules with nothing to set (AC3)', () => {
  it('offers no inspector on modules with nothing to set', async () => {
    await withApp(async (app) => {
      await onTree(app);
      expect(shown(app)).toEqual(OPEN('Tree Building'));
      const BARE = ['data', 'models', 'diversity', 'selection', 'rates', 'usertree', 'diagnose'];
      for (const module of BARE) {
        await chooseModule(app, module);
        expect(shown(app), module).toEqual(NONE);
        expect(app.all('[aria-label$=" Inspector"]'), `${module}: no inspector control anywhere`).toHaveLength(0);
        expect(app.all('.mbc-accordion-section'), `${module}: no section anywhere`).toHaveLength(0);
      }
      // Their fields stay in their cards: User Tree's Newick and Diagnose's variant.
      await chooseModule(app, 'usertree');
      const newick = app.canvas().querySelectorAll('textarea').filter((t) => named(t) === 'User-Supplied or Manually Edited Newick Tree Topology:');
      expect(newick, "User Tree's Newick in its card").toHaveLength(1);
      expect(newick[0].closest('.studio-card') !== null, 'in a card').toBe(true);
      expect(shown(app)).toEqual(NONE);
      await chooseModule(app, 'diagnose');
      const variant = ['Amino-acid position (in sequence 1):', 'Wild-Type Residue (1-Letter):', 'Mutant Allele (1-Letter):']
        .map((n) => app.canvas().querySelectorAll('input').filter((i) => named(i) === n));
      expect(variant.map((v) => v.length), "Diagnose's variant fields in the canvas").toEqual([1, 1, 1]);
      expect(new Set(variant.map((v) => v[0].closest('.studio-card'))).size, 'in one card').toBe(1);
      // The Models sub-views stay in the canvas as its tabs.
      await chooseModule(app, 'models');
      expect(app.canvas().querySelectorAll('[role="tablist"][aria-label="Substitution Model Analyses"]'), 'the Models tabs').toHaveLength(1);
      expect(shown(app)).toEqual(NONE);

      // Back on a module with settings, the inspector shows as it was left: open, then closed.
      await chooseModule(app, 'phylogeny');
      expect(shown(app)).toEqual(OPEN('Tree Building'));
      await app.click(app.inspectorButton()!);
      await chooseModule(app, 'rates');
      expect(shown(app), 'rates, the inspector closed').toEqual(NONE);
      await chooseModule(app, 'clocks');
      expect(shown(app), 'clocks, closed as left').toEqual(CLOSED);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(OPEN('Root Calibration'));
    });
  });
});

// ─── AC4 ───

describe('a menu command that preselects (AC4)', () => {
  it('shows the values a menu command preselects in the inspector', async () => {
    await withApp(async (app) => {
      await onTree(app);
      const method = () => treeBuilding(app).method;
      expect(method().value).toBe('Maximum Likelihood (ML)');

      // Phylogeny > Neighbor-Joining and > UPGMA, on the tree.
      await app.menu('phylo:tree-nj');
      expect([picker(app).value, method().value, headingCard(app).heading]).toEqual(['phylogeny', 'Neighbor-Joining (NJ)', 'Neighbor-Joining tree']);
      await app.menu('phylo:tree-upgma');
      expect([method().value, headingCard(app).heading]).toEqual(['UPGMA', 'UPGMA tree']);
      // A method chosen by hand, then the command again: the command's method.
      await app.change(method(), 'Maximum Parsimony (MP)');
      await app.menu('phylo:tree-upgma');
      expect(method().value, 'the command again, after a hand choice').toBe('UPGMA');

      // A command that opens a module: Distances, with its section.
      await app.menu('phylo:distance');
      expect(picker(app).value).toBe('distance');
      expect(shown(app)).toEqual(OPEN('Distance Estimation'));
      // From Distances with the inspector closed: the module and the method, shown once it opens.
      await app.click(app.inspectorButton()!);
      await app.menu('phylo:tree-nj');
      expect(picker(app).value).toBe('phylogeny');
      expect(shown(app), 'closed, as it was left').toEqual(CLOSED);
      expect(headingCard(app).heading).toBe('Neighbor-Joining tree');
      await app.click(app.inspectorButton()!);
      expect(method().value, 'Neighbor-Joining, once opened').toBe('Neighbor-Joining (NJ)');
      // From another tab: the command opens Tree on the phylogeny module with its method.
      await app.clickTab('sequence-alignment');
      await app.menu('phylo:tree-upgma');
      expect([app.activeTab(), picker(app).value, method().value]).toEqual(['phylogenetics', 'phylogeny', 'UPGMA']);
      // A command that opens a module with nothing to set.
      await app.menu('phylo:usertree');
      expect([picker(app).value, shown(app)]).toEqual(['usertree', NONE]);

      // No App command preselects the ancestral method (Phylogeny > Ancestors opens the Evolution
      // Analysis dialog), so the studio's own preselection is shown through the real provider App
      // renders, with a column of its own.
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { WorkbenchInspectorProvider } = await import('../components/WorkbenchInspector');
      const { PhylogeneticsStudio } = await import('../components/AlignmentAndPhyloStudio');
      const docs = await memberDocs();
      const host = app.doc.createElement('div');
      const column = app.doc.createElement('div');
      app.doc.body.appendChild(host);
      app.doc.body.appendChild(column);
      const root = createRoot(host as unknown as Element);
      const claims: unknown[] = [];
      // React's act returns a thenable whose then() returns nothing, so each step is awaited on its own.
      const draw = async (initialAncestralMethod: string, commandNonce: number) => {
        await React.act(async () => {
          root.render(React.createElement(WorkbenchInspectorProvider, { open: true, column: column as unknown as HTMLElement, onClaimsChange: (c) => claims.push(c) },
            React.createElement(PhylogeneticsStudio, { documents: docs, activeDoc: docs[0], initialPhyloTab: 'ancestors', initialAncestralMethod: initialAncestralMethod as never, commandNonce })));
        });
        await app.settle();
      };
      const chosen = () => {
        const found = selectsOffering(column, ANCESTRAL_METHODS);
        expect(found, 'the method in the column').toHaveLength(1);
        expect(selectsOffering(host, ANCESTRAL_METHODS), 'none beside the result').toHaveLength(0);
        return found[0];
      };
      try {
        await draw('Maximum Parsimony (Fitch)', 1);
        expect(claims, 'the studio claims the inspector').toEqual([{ shared: true, own: false }]);
        expect(column.querySelectorAll('button.mbc-accordion-header').map((b) => words(b.textContent))).toEqual(['Ancestral Reconstruction']);
        expect(chosen().value, 'the preselected parsimony').toBe('Maximum Parsimony (Fitch)');
        await draw('Maximum Likelihood (Empirical Bayes)', 2);
        expect(chosen().value, 'a second command').toBe('Maximum Likelihood (Empirical Bayes)');
        await app.change(chosen(), 'Maximum Parsimony (Fitch)');
        await draw('Maximum Likelihood (Empirical Bayes)', 3);
        expect(chosen().value, 'the same command again, after a hand choice').toBe('Maximum Likelihood (Empirical Bayes)');
      } finally {
        await React.act(async () => { root.unmount(); });
        host.remove();
        column.remove();
      }
    });
  });
});

// ─── AC5 ───

describe('external tree programs (AC5)', () => {
  it('keeps the external program notice above the tree', async () => {
    await withApp(async (app) => {
      const { constructPhylogeneticTree } = await import('../core/phyloEvoEngine');
      const njNewick = constructPhylogeneticTree(NAMES, SEQS, 'Neighbor-Joining (NJ)', 'Tamura-Nei (TN93)', 0).newick;
      await onTree(app);
      expect(ext.detections.length, 'the studio looks for the programs').toBeGreaterThan(0);
      /** The notice: one, on the heading card above the tree (none in the inspector), its sentence apart from its buttons. */
      const noticeEl = () => {
        // The notice is a live region; the method note behind the disclosure names the program too.
        const found = app.all('.info-callout[role]').filter((n) => /\b(FastTree|PhyML)\b/.test(n.textContent));
        expect(found, 'one external-program notice').toHaveLength(1);
        const [card, result] = phyloGrid(app).children;
        expect(card.contains(found[0]) && !result.contains(found[0]), 'on the heading card, above the result column').toBe(true);
        const page = app.all('*');
        expect(page.indexOf(found[0]), 'before the tree').toBeLessThan(page.indexOf(treeSvg(app)));
        return found[0];
      };
      const notice = () => {
        const el = noticeEl();
        const isButton = (n: unknown) => (n as { tagName?: string }).tagName === 'BUTTON';
        return {
          text: words(el.childNodes.filter((n) => !isButton(n)).map((n) => n.textContent).join('')),
          buttons: el.children.filter(isButton).map((b) => words(b.textContent)),
          role: el.getAttribute('role'),
        };
      };
      const press = async (text: string) => {
        const found = buttonsReading(text)(noticeEl());
        expect(found, `the notice's ${text} button`).toHaveLength(1);
        await app.click(found[0]);
      };
      const optionText = (value: string) => words(treeBuilding(app).method.options.find((o) => o.value === value)!.textContent);

      // Chosen in the inspector while the programs are still being looked for.
      await app.change(treeBuilding(app).method, 'FastTree (Approx-ML)');
      expect(notice()).toEqual({ text: 'Looking for FastTree on this computer…', buttons: [], role: 'status' });
      expect(headingCard(app).heading, 'the Neighbor-Joining tree meanwhile').toBe('Neighbor-Joining tree');

      // Found: it runs, with Cancel, and the Neighbor-Joining tree is drawn until it finishes.
      const status = (algorithm: string, name: string, path: string | null, installHint: string) => ({ algorithm, name, available: path !== null, executablePath: path, installHint }) as ExternalProgramStatus;
      ext.detection!.resolve([
        status('FastTree (Approx-ML)', 'FastTree', '/opt/taze/bin/FastTree', 'conda install -c bioconda fasttree'),
        status('PhyML (ML + SH-aLRT)', 'PhyML', null, 'conda install -c bioconda phyml'),
        status('RAxML (GTR+G Rapid ML)', 'RAxML', null, 'conda install -c bioconda raxml-ng'),
        status('MrBayes (Bayesian MCMC)', 'MrBayes', null, 'conda install -c bioconda mrbayes'),
      ]);
      await app.settle();
      expect(ext.runs.map((r) => [r.algorithm, r.names, r.seqs]), 'one FastTree run on the alignment').toEqual([['FastTree (Approx-ML)', NAMES, SEQS]]);
      const RUNNING = { text: 'Running FastTree on 6 sequences × 120 sites… 0 s. The Neighbor-Joining tree is shown until it finishes.', buttons: ['Cancel'], role: 'status' };
      expect(notice()).toEqual(RUNNING);
      expect([headingCard(app).heading, shownNewick(app)], 'the Neighbor-Joining tree').toEqual(['Neighbor-Joining tree', njNewick]);
      expect([optionText('FastTree (Approx-ML)'), optionText('PhyML (ML + SH-aLRT)')], 'the inspector says which are installed')
        .toEqual(['FastTree — installed', 'PhyML — not installed (NJ tree shown)']);
      const bootstrap = treeBuilding(app).bootstrap;
      expect([bootstrap.disabled, bootstrap.getAttribute('title')], 'the program reports its own support').toEqual([true, 'FastTree reports its own branch support']);
      // Closing the inspector leaves the notice above the tree.
      await app.click(app.inspectorButton()!);
      expect(notice(), 'the inspector closed').toEqual(RUNNING);
      await app.click(app.inspectorButton()!);

      // Cancelled, then run again.
      await press('Cancel');
      expect(ext.runs[0].cancels, 'the run is stopped').toBeGreaterThan(0);
      expect(notice()).toEqual({ text: 'FastTree was cancelled; the Neighbor-Joining tree is shown.', buttons: ['Run again'], role: 'status' });
      expect(shownNewick(app)).toBe(njNewick);
      await press('Run again');
      expect(ext.runs, 'a second run').toHaveLength(2);
      expect(notice()).toEqual(RUNNING);

      // Failed, then retried.
      ext.runs[1].job.reject(new Error('FastTree exited with status 1.'));
      await app.settle();
      expect(notice()).toEqual({ text: 'FastTree did not produce a tree: FastTree exited with status 1. The Neighbor-Joining tree is shown instead.', buttons: ['Retry'], role: 'alert' });
      expect(shownNewick(app)).toBe(njNewick);
      await press('Retry');
      expect(ext.runs, 'a third run').toHaveLength(3);

      // Finished: its own tree replaces the Neighbor-Joining one.
      const external = '((TAZE_A:0.02,TAZE_B:0.03)0.97:0.04,((TAZE_C:0.02,TAZE_D:0.03)0.91:0.04,(TAZE_E:0.05,TAZE_F:0.06)0.55:0.01)0.62:0.02);';
      ext.runs[2].job.resolve({
        algorithm: 'FastTree (Approx-ML)', program: 'FastTree', version: '2.1.11', executablePath: '/opt/taze/bin/FastTree', commandLine: 'FastTree -gtr -nt taze.fasta',
        model: 'GTR+CAT', newick: external, supportKind: 'SH-like local support', programLogLikelihood: -512.25, totalBranchLength: 0.42, runtimeMs: 1500, warnings: [],
      });
      await app.settle();
      expect(notice()).toEqual({ text: 'Tree from /opt/taze/bin/FastTree.', buttons: [], role: 'status' });
      expect([headingCard(app).heading, headingCard(app).badge, shownNewick(app)]).toEqual(['Approximately-maximum-likelihood tree (FastTree, GTR+CAT)', 'SH-like local support', external]);
      expect(external).not.toBe(njNewick);

      // A program that is not installed: the hint, and Check again looks once more.
      await app.change(treeBuilding(app).method, 'PhyML (ML + SH-aLRT)');
      expect(notice()).toEqual({ text: 'PhyML was not found on this computer, so the built-in Neighbor-Joining tree is shown. Install it with conda install -c bioconda phyml, then', buttons: ['Check again'], role: 'status' });
      expect(headingCard(app).heading).toBe('Neighbor-Joining tree');
      const asked = ext.detections.length;
      await press('Check again');
      expect(ext.detections.slice(asked), 'looked for again, afresh').toEqual([true]);
    }, true);

    // The browser build (no desktop backend): the notice says so, above the tree.
    await withApp(async (app) => {
      await onTree(app);
      await app.change(treeBuilding(app).method, 'MrBayes (Bayesian MCMC)');
      const found = app.all('.info-callout[role]').filter((n) => n.textContent.includes('MrBayes'));
      expect(found.map((n) => words(n.textContent))).toEqual(['MrBayes can only be run from the MolBioCraft desktop app. Showing the built-in Neighbor-Joining tree instead.']);
      expect(phyloGrid(app).children[0].contains(found[0]), 'on the heading card above the tree').toBe(true);
      expect(ext.runs, 'nothing is run').toHaveLength(0);
    });
  });
});

// ─── AC7 ───

// Drawn on its own (no WorkbenchInspectorProvider above it), every module whose settings move keeps
// each of them where it sat, drawn once, with no inspector wrapper (D0063 ruling f). These fail for a
// setting dropped from the standalone path, one drawn twice, and an inWorkbench guard dropped.
describe('the studio drawn on its own (AC7)', () => {
  it('keeps its settings in place when rendered on its own, Phylogeny', async () => {
    await withApp(async (app) => {
      await studioOnItsOwn(app, 'phylogeny', (probe) => {
        const { card } = figureFirstColumns(probe);
        // The heading card: its header, then the two form grids that hold the five settings, and nothing else.
        expect(card.children.map((c) => c.getAttribute('class')), 'the heading card, in order').toEqual(['studio-card-header', 'form-grid-2col', 'form-grid-3col']);
        const [, twoCol, threeCol] = card.children;
        const settings: [LiveElement, string, (root: LiveElement) => LiveElement[]][] = [
          [twoCol, 'Tree Inference Method:', (r) => selectsOffering(r, TREE_METHODS)],
          [twoCol, 'Distance Model:', (r) => selectsOffering(r, TREE_MODELS)],
          [threeCol, 'Bootstrap Replicates:', (r) => selectsOffering(r, BOOTSTRAPS)],
          [threeCol, 'Tree Topology Style:', (r) => selectsOffering(r, TOPOLOGIES)],
          [threeCol, 'Show Bootstrap % on Nodes', showBootstrap],
        ];
        for (const [row, name, find] of settings) {
          expect(find(probe), `${name}: drawn once`).toHaveLength(1);
          const control = find(probe)[0];
          expect(row.contains(control), `${name}: in its form grid on the heading card`).toBe(true);
          expect(named(control), `${name}: labelled as before`).toBe(name);
          expect(unwrapped(control), `${name}: no inspector wrapper`).toBe(true);
        }
        expect(twoCol.children.map((l) => named(l.querySelectorAll('select, input')[0])), 'the two-column row').toEqual(TREE_BUILDING.slice(0, 2));
        expect(threeCol.children.map((l) => named(l.querySelectorAll('select, input')[0])), 'the three-column row').toEqual(TREE_BUILDING.slice(2));
      });
    });
  });

  for (const [module, heading, values, value] of [
    ['Distances', DISTANCE_MATRIX, DISTANCE_MODELS, 'Tamura-Nei (TN93)'],
    ['Ancestors', ANCESTORS, ANCESTRAL_METHODS, 'Maximum Likelihood (Empirical Bayes)'],
  ] as const) {
    it(`keeps its settings in place when rendered on its own, ${module}`, async () => {
      await withApp(async (app) => {
        await studioOnItsOwn(app, module === 'Distances' ? 'distance' : 'ancestors', (probe) => {
          const header = cardHeaded(probe, heading).querySelectorAll('.studio-card-header')[0];
          expect(header.children.map((c) => c.localName), "the card header: its heading, then the setting's select").toEqual(['h3', 'select']);
          const found = selectsOffering(probe, values);
          expect(found, 'the setting: drawn once').toHaveLength(1);
          expect(found[0] === header.children[1], 'in the card header, beside its heading').toBe(true);
          expect(found[0].closest('label') === null && unwrapped(found[0]), 'no label or inspector wrapper around it').toBe(true);
          expect(found[0].value).toBe(value);
        });
      });
    });
  }

  it('keeps its settings in place when rendered on its own, Clocks', async () => {
    await withApp(async (app) => {
      await studioOnItsOwn(app, 'clocks', (probe) => {
        const card = cardHeaded(probe, CLOCKS);
        const found = rootAge(probe);
        expect(found, 'the root age: drawn once').toHaveLength(1);
        expect(card.children[0].classList.contains('studio-card-header'), 'the timetree card opens with its header').toBe(true);
        expect(found[0].closest('label') === card.children[1], 'its field right under that header, in the card').toBe(true);
        expect(unwrapped(found[0]), 'no inspector wrapper').toBe(true);
        expect(found[0].value).toBe('42.5');
      });
    });
  });
});
