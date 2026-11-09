// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAT0: an imported tree's display settings (Layout, Support and its cut-off, Branch lengths,
 * Node ages on a timetree, Font) in App's shared inspector, with Find taxa, the edits, the exports and
 * the selected-node bar left above the tree (D0060, D0063, D0064). It is the epic's first proof of a
 * studio's InspectorSection through the real App: every check mounts the App over the live DOM with
 * the US-01M6TB6G harness, restores tree records built here on the Tree tab, and reads App's own
 * header button, pane title and aside.mbc-right-controls. No check builds a provider (LC-003).
 *
 * The checks fail for a wrong viewer: settings left in the canvas or drawn twice, Find taxa left in a
 * 'Tree display' toolbar or moved into the inspector, a change that never marks the tree changed or
 * never reaches Save changes, a split-pane tree whose settings join the main inspector, and an export
 * whose labels keep the stylesheet's size instead of the one chosen.
 */

import { describe, expect, it, vi } from 'vitest';
import { SVG_FILE_PROLOGUE } from '../core/figureExport';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { LiveElement, parseMarkup } from './liveDom';

// Each check launches the App afresh, two of them twice.
vi.setConfig({ testTimeout: 60_000 });

async function withApp<T>(opts: MountOptions, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Tree records built in the test ───

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Tree Documents',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};
/** A tree record as createTreeDocument (src/core/treeDocuments.ts) makes one from an imported file. */
const treeRecord = (id: string, name: string, newick: string, tips: number, more: Record<string, string | number> = {}): SequenceDocument => ({
  ...BLANK, id, name, description: `Imported phylogenetic tree from ${name}.nwk`, documentKind: 'tree',
  docMetadata: { Newick: newick, 'No. tips': tips, 'Source Format': 'Newick', ...more },
});
/** A display state as the viewer saves it under 'Tree display' (its DisplayState, whole). */
const display = (patch: Record<string, unknown>) => JSON.stringify({
  style: 'rectangular', showSupport: true, supportCutoff: 0, showLengths: false, showAges: false, fontSize: 12, colors: {}, compressed: [], ...patch,
});

const ALPHA_TIPS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
/** Branch lengths on every branch, and three support values: 95, 62 and 88. */
const ALPHA = treeRecord('tat0-alpha', 'Tree_Alpha', '((Alpha:0.12,Beta:0.25)95:0.05,(Gamma:0.3,(Delta:0.08,Epsilon:0.1)62:0.2)88:0.15,Zeta:0.4);', 6);
const BETA_TIPS = ['Kappa', 'Lambda', 'Mu', 'Nu', 'Xi'];
const BETA = treeRecord('tat0-beta', 'Tree_Beta', '((Kappa:0.2,Lambda:0.1)77:0.3,(Mu:0.15,Nu:0.25)54:0.1,Xi:0.5);', 5,
  { 'Tree display': display({ style: 'cladogram', fontSize: 10 }) });
/** A timetree, as a Compute Timetree run marks its result (src/core/operationRunners.ts): ages in Mya. */
const TIMETREE = treeRecord('tat0-time', 'Tree_Time', '((Ostrich:80,Emu:80):40,(Chicken:90,Duck:90):30);', 4,
  { 'Source Format': 'Timetree', 'Branch lengths': 'Mya' });

const onTreeTab = (app: AppHarness, docs: SequenceDocument[]) =>
  app.restoreSession({ documents: docs, activeDocId: docs[0].id, viewerTab: 'phylogenetics' });

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
/** The display settings every tree has (Node ages is a timetree's alone). */
const SETTINGS = ['Layout', 'Support ≥', 'Support cutoff', 'Branch lengths', 'Font'];
/** What stays above the tree: Find taxa, the edits and the exports. */
const ABOVE = ['Ladderize ↑', 'Ladderize ↓', 'Midpoint root', 'Undo', 'Revert', 'Save changes', 'Export Newick', 'Export'];

const button = (scope: LiveElement, text: string) => {
  const found = scope.querySelectorAll('button').filter((b) => words(b.textContent).replace(/\s*▾$/, '') === text);
  expect(found, `one "${text}" button`).toHaveLength(1);
  return found[0];
};
/** The aside's accordion sections titled `title`. */
const sectionsTitled = (aside: LiveElement, title: string) =>
  aside.querySelectorAll('.mbc-accordion-section').filter((s) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '') === title);
function treeDisplaySection(app: AppHarness): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, 'the inspector column is drawn').not.toBeNull();
  const found = sectionsTitled(aside!, 'Tree Display');
  expect(found, 'one Tree Display section in the inspector').toHaveLength(1);
  return found[0];
}
const paneTitle = (app: AppHarness) => app.inspectorAside()?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null;
/** The tree a viewer draws (its figure, not an icon). */
const treeSvg = (scope: LiveElement) => {
  const found = scope.querySelectorAll('svg[role="img"]').filter((s) => (s.getAttribute('aria-label') ?? '').startsWith('Phylogenetic tree '));
  expect(found, 'one drawn tree').toHaveLength(1);
  return found[0];
};
/** The tip labels of a drawn or saved tree, by name. */
const tipLabels = (svg: LiveElement, names: string[]) => {
  const found = svg.querySelectorAll('text').filter((t) => names.includes(words(t.textContent).replace(/^▶ /, '')));
  expect(found.map((t) => words(t.textContent).replace(/^▶ /, '')).sort(), 'every tip labelled once').toEqual([...names].sort());
  return found;
};
/** The labels a tree draws at its internal nodes (support values, node ages): its own text children, not a branch's, the scale bar's or the time axis's. */
const nodeLabelEls = (svg: LiveElement) => svg.children.filter((c) => c.localName === 'text' && c.classList.contains('mbc-tree-support'));
const nodeLabels = (svg: LiveElement) => nodeLabelEls(svg).map((t) => words(t.textContent)).sort();
/** The labels drawn on the branches (branch lengths). */
const branchLabels = (svg: LiveElement) =>
  svg.children.filter((g) => g.localName === 'g' && g.querySelectorAll('path[stroke="transparent"]').length > 0).flatMap((g) => g.querySelectorAll('text').map((t) => words(t.textContent)));
/** The value a style attribute declares for `prop` (the last declaration winning, as in CSS). */
function declared(el: LiveElement, prop: string): string | undefined {
  let value: string | undefined;
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const at = decl.indexOf(':');
    if (at > 0 && decl.slice(0, at).trim() === prop) value = decl.slice(at + 1).trim();
  }
  return value;
}
/** Whether the elements are all in the page, in this order. */
function inOrder(app: AppHarness, ...els: LiveElement[]): boolean {
  const page = app.all('*');
  const at = els.map((e) => page.indexOf(e));
  return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || at[k - 1] < i);
}
const toolbarOf = (el: LiveElement) => el.closest('[role="toolbar"]')?.getAttribute('aria-label') ?? null;

// ─── AC1 ───

describe('the Tree tab inspector (AC1)', () => {
  it("puts the tree display settings in App's inspector", async () => {
    await withApp({}, async (app) => {
      await onTreeTab(app, [ALPHA]);
      expect(app.activeTab()).toBe('phylogenetics');

      // App's own header button, its pane title and the section in its aside.
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Hide Tree Controls Inspector');
      expect(paneTitle(app)).toBe('Tree Controls');
      const section = treeDisplaySection(app);
      const aside = app.inspectorAside()!;
      expect(aside.closest('.mbc-viewer-body-split') === app.bodySplit() && aside.localName === 'aside' && aside.classList.contains('mbc-right-controls'),
        "the section sits in App's aside.mbc-right-controls").toBe(true);
      const canvas = app.canvas();
      for (const name of SETTINGS) {
        expect(section.contains(field(section, name)), `${name} in the Tree Display section`).toBe(true);
        expect(fields(canvas, name), `${name} not in the canvas`).toHaveLength(0);
        expect(fields(app.doc.body, name), `${name} drawn once in the page`).toHaveLength(1);
      }
      expect(fields(app.doc.body, 'Node ages'), 'Node ages only on a timetree').toHaveLength(0);
      expect(field(section, 'Layout').value).toBe('rectangular');
      expect(field(section, 'Font').value).toBe('12');

      // Find taxa, the edits, the exports stay in the canvas, above the tree.
      const svg = treeSvg(canvas);
      const find = field(canvas, 'Find taxa');
      expect(find.getAttribute('type')).toBe('search');
      expect(toolbarOf(find), 'Find taxa joins the Tree edits toolbar').toBe('Tree edits');
      expect(app.all('[role="toolbar"][aria-label="Tree display"]').filter((t) => t.contains(find)), 'no Tree display toolbar holds Find taxa').toHaveLength(0);
      expect(aside.contains(find), 'Find taxa is not in the inspector').toBe(false);
      for (const text of ABOVE) {
        const b = button(canvas, text);
        expect(inOrder(app, b, svg), `${text} above the tree`).toBe(true);
        expect(aside.contains(b), `${text} not in the inspector`).toBe(false);
      }
      expect(inOrder(app, find, svg), 'Find taxa above the tree').toBe(true);
      // Find taxa still finds: the matching tip is marked.
      await app.input(find, 'gam');
      expect(tipLabels(treeSvg(app.canvas()), ALPHA_TIPS).filter((t) => words(t.textContent).startsWith('▶ ')).map((t) => words(t.textContent))).toEqual(['▶ Gamma']);

      // The selected-node bar opens above the tree, in the canvas.
      const branch = treeSvg(app.canvas()).querySelectorAll('path[stroke="transparent"]')[0];
      await app.click(branch);
      const bar = app.one('[role="region"][aria-label="Selected node"]', 'the selected-node bar');
      expect([app.canvas().contains(bar), app.inspectorAside()!.contains(bar), inOrder(app, bar, treeSvg(app.canvas()))]).toEqual([true, false, true]);

      // Closed, the settings are drawn nowhere, the button stays and the tree keeps its toolbar.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Show Tree Controls Inspector');
      expect(app.inspectorAside(), 'no column while the inspector is closed').toBeNull();
      for (const name of SETTINGS) expect(fields(app.doc.body, name), `${name} not drawn while closed`).toHaveLength(0);
      expect(toolbarOf(field(app.canvas(), 'Find taxa'))).toBe('Tree edits');
      for (const text of ABOVE) button(app.canvas(), text);
      // Opened again, the section is back with the same settings.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Hide Tree Controls Inspector');
      expect(paneTitle(app)).toBe('Tree Controls');
      for (const name of SETTINGS) field(treeDisplaySection(app), name);
    });

    // A timetree adds Node ages to the section, and it draws the ages.
    await withApp({}, async (app) => {
      await onTreeTab(app, [TIMETREE]);
      const section = treeDisplaySection(app);
      for (const name of [...SETTINGS, 'Node ages']) {
        field(section, name);
        expect(fields(app.canvas(), name), `${name} not in the canvas`).toHaveLength(0);
      }
      expect(field(section, 'Layout').options.map((o) => words(o.textContent))[0], 'the timetree layout').toBe('Timetree');
      expect(nodeLabels(treeSvg(app.canvas())), 'no ages drawn yet').toEqual([]);
      expect(button(app.canvas(), 'Save changes').disabled).toBe(true);
      await app.change(field(section, 'Node ages'), true);
      // The root is 120 Mya old, its two clades 80 and 90.
      expect(nodeLabels(treeSvg(app.canvas())), 'each node labelled with its age').toEqual(['120', '80.00', '90.00']);
      expect(button(app.canvas(), 'Save changes').disabled, 'Node ages marks the tree changed').toBe(false);
    });
  });
});

// ─── AC2 ───

describe('a display change saved from the inspector (AC2)', () => {
  it('saves a display change made in the inspector with the tree', async () => {
    await withApp({}, async (app) => {
      await onTreeTab(app, [ALPHA]);
      const canvas = () => app.canvas();
      const save = () => button(canvas(), 'Save changes');
      const revert = () => button(canvas(), 'Revert');
      const control = (name: string) => field(treeDisplaySection(app), name);
      const height = () => Number((treeSvg(canvas()).getAttribute('viewBox') ?? '').split(/\s+/)[3]);
      /** Each change from a saved tree: it redraws, marks the tree changed, and Save changes leaves nothing to save. */
      const changeAndSave = async (name: string, value: string | boolean, redrawn: () => void) => {
        expect([save().disabled, revert().disabled], `before ${name}: nothing to save or revert`).toEqual([true, true]);
        await app.change(control(name), value);
        redrawn();
        expect([save().disabled, revert().disabled], `${name} marks the tree changed: Save changes and Revert offered`).toEqual([false, false]);
        await app.click(save());
        expect([save().disabled, revert().disabled], `${name} saved: nothing left to save or revert`).toEqual([true, true]);
      };

      // Font: the labels take the size and the rows grow.
      const tall = height();
      await changeAndSave('Font', '16', () => {
        expect(tipLabels(treeSvg(canvas()), ALPHA_TIPS).map((t) => t.style.getPropertyValue('font-size')), 'each tip label at 16px').toEqual(ALPHA_TIPS.map(() => '16px'));
        expect(height(), 'taller rows').toBeGreaterThan(tall);
      });

      // Support cut-off: 62 drops below 70, 95 and 88 stay.
      expect(nodeLabels(treeSvg(canvas()))).toEqual(['62', '88', '95']);
      await changeAndSave('Support cutoff', '70', () => expect(nodeLabels(treeSvg(canvas()))).toEqual(['88', '95']));

      // Branch lengths: each branch labelled with its length.
      expect(branchLabels(treeSvg(canvas())), 'no lengths drawn yet').toEqual([]);
      await changeAndSave('Branch lengths', true, () =>
        expect(branchLabels(treeSvg(canvas())).sort()).toEqual(['0.050', '0.080', '0.10', '0.12', '0.15', '0.20', '0.25', '0.30', '0.40']));

      // Layout: a circular tree turns its tip labels round the circle.
      expect(tipLabels(treeSvg(canvas()), ALPHA_TIPS).filter((t) => t.hasAttribute('transform')), 'no turned labels in a phylogram').toHaveLength(0);
      await changeAndSave('Layout', 'circular', () =>
        expect(tipLabels(treeSvg(canvas()), ALPHA_TIPS).filter((t) => /^rotate\(/.test(t.getAttribute('transform') ?? '')).length, 'labels turned round the circle').toBeGreaterThan(0));

      // Support: cleared, no support value is drawn and the cut-off waits.
      await changeAndSave('Support ≥', false, () => {
        expect(nodeLabels(treeSvg(canvas())), 'no support values drawn').toEqual([]);
        expect(control('Support cutoff').disabled, 'the cut-off off with them').toBe(true);
      });

      // Save changes wrote the whole display state under 'Tree display'.
      await app.menu('file:export-mbc-json');
      const files = app.downloads().filter((f) => f.filename.endsWith('.mbc'));
      expect(files, 'the session saved as a file').toHaveLength(1);
      const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
      const saved = parseMbcWorkbench(await files[0].text()).envelope.documents.find((d) => d.id === ALPHA.id);
      expect(saved?.docMetadata?.Newick, 'the tree itself kept').toBeTruthy();
      expect(JSON.parse(String(saved?.docMetadata?.['Tree display']))).toEqual({
        style: 'circular', showSupport: false, supportCutoff: 70, showLengths: true, showAges: false, fontSize: 16, colors: {}, compressed: [],
      });

      // Drawn afresh, the tree reads its saved display back.
      await app.clickTab('document-info');
      await app.clickTab('phylogenetics');
      expect([control('Layout').value, control('Font').value, control('Support ≥').checked, control('Support cutoff').value, control('Branch lengths').checked])
        .toEqual(['circular', '16', false, '70', true]);
      expect([save().disabled, revert().disabled]).toEqual([true, true]);
    });
  });
});

// ─── AC3 ───

describe('a tree in split view (AC3)', () => {
  it("keeps a split-pane tree's display controls in the split pane", async () => {
    const alpha = { ...ALPHA, docMetadata: { ...ALPHA.docMetadata, 'Tree display': display({ fontSize: 14 }) } };
    await withApp({}, async (app) => {
      await onTreeTab(app, [alpha, BETA]);
      await app.click(app.one('button.mbc-split-toggle'));
      const pane = () => app.one('section.mbc-split-pane', 'the split view pane');
      const choice = field(pane(), 'Document in split view');
      if (choice.value !== BETA.id) await app.change(choice, BETA.id);
      expect(field(pane(), 'Document in split view').value).toBe(BETA.id);

      // The pane's tree draws its settings in place, in its own Tree display toolbar, Find taxa beside its edits.
      const paneBar = pane().querySelectorAll('[role="toolbar"][aria-label="Tree display"]');
      expect(paneBar, "the pane's Tree display toolbar").toHaveLength(1);
      for (const name of SETTINGS) expect(paneBar[0].contains(field(pane(), name)), `the pane's ${name} in its toolbar`).toBe(true);
      expect(toolbarOf(field(pane(), 'Find taxa'))).toBe('Tree edits');
      expect([field(pane(), 'Layout').value, field(pane(), 'Font').value], "Tree_Beta's own settings").toEqual(['cladogram', '10']);

      // The main inspector: one Tree Display section, the main tree's settings alone.
      const aside = app.inspectorAside()!;
      expect(sectionsTitled(aside, 'Tree Display'), 'one Tree Display section').toHaveLength(1);
      const section = treeDisplaySection(app);
      for (const name of SETTINGS) {
        expect(fields(aside, name), `one ${name} in the inspector`).toHaveLength(1);
        expect(pane().contains(field(section, name)), `the inspector's ${name} is not the pane's`).toBe(false);
        expect(aside.contains(field(pane(), name)), `the pane's ${name} is not in the inspector`).toBe(false);
      }
      expect([field(section, 'Layout').value, field(section, 'Font').value], "Tree_Alpha's settings").toEqual(['rectangular', '14']);
      expect(fields(app.canvas(), 'Font'), 'the main canvas draws no settings').toHaveLength(0);

      // Each tree answers to its own controls.
      const mainSvg = () => treeSvg(app.canvas());
      const paneSvg = () => treeSvg(pane());
      const mainBefore = mainSvg().outerHTML;
      await app.change(field(pane(), 'Font'), '18');
      expect(tipLabels(paneSvg(), BETA_TIPS).map((t) => t.style.getPropertyValue('font-size'))).toEqual(BETA_TIPS.map(() => '18px'));
      expect(mainSvg().outerHTML === mainBefore, 'the main tree untouched by the pane').toBe(true);
      expect(field(treeDisplaySection(app), 'Font').value).toBe('14');
      expect([button(pane(), 'Save changes').disabled, button(app.canvas(), 'Save changes').disabled]).toEqual([false, true]);
      const paneBefore = paneSvg().outerHTML;
      await app.change(field(treeDisplaySection(app), 'Layout'), 'radial');
      expect(tipLabels(mainSvg(), ALPHA_TIPS).filter((t) => /^rotate\(/.test(t.getAttribute('transform') ?? '')).length, 'the main tree drawn radial').toBeGreaterThan(0);
      expect(paneSvg().outerHTML === paneBefore, 'the pane tree untouched by the inspector').toBe(true);
      expect(field(pane(), 'Layout').value).toBe('cladogram');
    });
  });
});

// ─── AC4 ───

/** Exports the tree as SVG from its Export menu and reads back the file the harness captured. */
async function exportSvg(app: AppHarness): Promise<LiveElement> {
  const before = app.downloads().length;
  await app.click(button(app.canvas(), 'Export'));
  const svgItem = app.canvas().querySelectorAll('[role="menuitem"]').filter((m) => words(m.textContent).startsWith('SVG'));
  expect(svgItem, 'the SVG item of the Export menu').toHaveLength(1);
  await app.click(svgItem[0]);
  const files = app.downloads();
  expect(files, 'one file saved').toHaveLength(before + 1);
  const file = files[before];
  expect([file.filename.endsWith('.svg'), file.type.startsWith('image/svg+xml')], file.filename).toEqual([true, true]);
  // The file opens with its XML declaration, then the figure.
  const text = await file.text();
  expect(text.startsWith(SVG_FILE_PROLOGUE), 'an SVG file').toBe(true);
  const roots = parseMarkup(text.slice(SVG_FILE_PROLOGUE.length), app.doc).filter((n): n is LiveElement => n instanceof LiveElement);
  expect(roots.map((r) => r.localName), 'the file reads back as one <svg>').toEqual(['svg']);
  return roots[0];
}
const sizes = (labels: LiveElement[]) => [...new Set(labels.map((t) => declared(t, 'font-size')))];
/**
 * The sizes a saved tree gives its root and each kind of label: the tips, the node labels (support
 * values, node ages) and the captions (branch lengths, the scale bar, the time axis), `captions` of them.
 */
function fontOf(svg: LiveElement, tipNames: string[], captions: number) {
  const tips = tipLabels(svg, tipNames);
  const nodes = nodeLabelEls(svg);
  const rest = svg.querySelectorAll('text').filter((t) => !tips.includes(t) && !nodes.includes(t));
  expect(rest.length, 'the captions').toBe(captions);
  return { root: declared(svg, 'font-size'), tips: sizes(tips), nodes: sizes(nodes), captions: sizes(rest) };
}

describe('the exported figure (AC4)', () => {
  it('exports the tree at the font chosen in the inspector', async () => {
    // App.css sets the font of every label in the tree canvas (.mbc-imported-tree-canvas text), which
    // beats the size the root passes down and any font-size attribute, on screen and in the file the
    // export writes from each label's computed style; so each label must carry the size itself.
    await withApp({}, async (app) => {
      await onTreeTab(app, [ALPHA]);
      // Nine branch lengths and the scale bar.
      await app.change(field(treeDisplaySection(app), 'Branch lengths'), true);
      await app.change(field(treeDisplaySection(app), 'Font'), '16');
      const big = await exportSvg(app);
      expect(fontOf(big, ALPHA_TIPS, 10)).toEqual({ root: '16px', tips: ['16px'], nodes: ['14px'], captions: ['16px'] });
      // A copy of the tree on screen, not the tree itself.
      const live = treeSvg(app.canvas());
      expect(live.hasAttribute('xmlns'), 'the tree on screen is not the exported copy').toBe(false);
      expect(big.getAttribute('viewBox')).toBe(live.getAttribute('viewBox'));

      // The size follows the choice: a smaller font exports smaller.
      await app.change(field(treeDisplaySection(app), 'Font'), '10');
      const small = await exportSvg(app);
      expect(fontOf(small, ALPHA_TIPS, 10)).toEqual({ root: '10px', tips: ['10px'], nodes: ['8px'], captions: ['10px'] });
      expect(Number(small.getAttribute('height')), 'shorter rows in the smaller file').toBeLessThan(Number(big.getAttribute('height')));
    });

    // A timetree's node ages and time axis (seven ticks and the unit) take the size too.
    await withApp({}, async (app) => {
      await onTreeTab(app, [TIMETREE]);
      await app.change(field(treeDisplaySection(app), 'Node ages'), true);
      await app.change(field(treeDisplaySection(app), 'Font'), '14');
      const saved = await exportSvg(app);
      expect(nodeLabels(saved), 'the ages saved').toEqual(['120', '80.00', '90.00']);
      expect(fontOf(saved, ['Ostrich', 'Emu', 'Chicken', 'Duck'], 8)).toEqual({ root: '14px', tips: ['14px'], nodes: ['12px'], captions: ['14px'] });
    });
  });
});
