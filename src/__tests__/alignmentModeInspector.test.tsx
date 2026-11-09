// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAA4: the alignment studio's Pairwise Alignment settings (the method, the substitution
 * matrix and the gap scores) and its Dotplot options sit in App's shared inspector, while the
 * sequences they compare stay beside the result. The MSA grid keeps its own panel (US-01M6TA6T), so
 * across the three modes one inspector shows at a time, under the workbench's one open state.
 *
 * Every check runs in the real App over the live DOM (the US-01M6TB6G harness, appHarness.tsx): a
 * session built here is restored on the Alignment tab, and the checks read App's own header button,
 * its inspector column (aside.mbc-right-controls) and its viewer canvas, and drive the settings by
 * editing them in that column. The studio and the dotplot are also drawn on their own (a React root
 * of their own in the launched App's window, no WorkbenchInspectorProvider above them), where every
 * setting stays in place as it was before this story.
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
/** `seq` with the letter at each 1-based column in `cols` moved one step along `alphabet`. */
function substituted(seq: string, cols: number[], alphabet = 'ACGT'): string {
  const out = seq.split('');
  for (const c of cols) out[c - 1] = alphabet[(alphabet.indexOf(out[c - 1]) + 1) % alphabet.length];
  return out.join('');
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Alignments',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

const DNA_A = lettersFrom(0x7aa4, 150);
const DNA_B = substituted(DNA_A, [12, 37, 58, 81, 99, 120, 141]);
const DNA_C = substituted(DNA_A, [5, 70, 133]);
/** An alignment of three 150 nt members: its Pairwise view compares the first two, as its Dotplot does. */
const PAIR: SequenceDocument = {
  ...BLANK, id: 'taa4-pair', name: 'TAA4 Pair Alignment', accession: 'TAA4_0001', description: 'An alignment built in the test',
  sequence: DNA_A, documentKind: 'alignment',
  alignmentMeta: {
    isAligned: true,
    sequences: [['taa4-a', 'TAA4 Member A', DNA_A], ['taa4-b', 'TAA4 Member B', DNA_B], ['taa4-c', 'TAA4 Member C', DNA_C]]
      .map(([id, name, sequence]) => ({ id, name, sequence })),
  },
} as SequenceDocument;

/** Two of those members, cut to different lengths, as a list never aligned: its Alignment tab reads Sequences. */
const LIST: SequenceDocument = {
  ...PAIR, id: 'taa4-list', name: 'TAA4 Unaligned List', accession: 'TAA4_0002',
  alignmentMeta: {
    isAligned: false,
    sequences: [{ id: 'taa4-l1', name: 'TAA4 Read One', sequence: DNA_A.slice(0, 140) }, { id: 'taa4-l2', name: 'TAA4 Read Two', sequence: DNA_B.slice(6) }],
  },
} as SequenceDocument;

const AA = 'ACDEFGHIKLMNPQRSTVWY';
const PROT_A = lettersFrom(0x7aa5, 60, AA);
const PROT_B = substituted(PROT_A, [9, 22, 31, 47], AA);
/** A protein alignment: its pairwise view scores with a substitution matrix and no match or mismatch. */
const PROT: SequenceDocument = {
  ...BLANK, id: 'taa4-prot', name: 'TAA4 Protein Alignment', accession: 'TAA4_0003', description: 'A protein alignment built in the test',
  sequence: PROT_A, moleculeType: 'Protein', documentKind: 'alignment',
  alignmentMeta: {
    isAligned: true,
    sequences: [{ id: 'taa4-p1', name: 'TAA4 Protein One', sequence: PROT_A }, { id: 'taa4-p2', name: 'TAA4 Protein Two', sequence: PROT_B }],
  },
} as SequenceDocument;

/** Opens `doc` on its Alignment tab. */
const onAlignment = (app: AppHarness, doc: SequenceDocument = PAIR) =>
  app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-alignment' });

// ─── Reading the App ───

const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
/**
 * The inspector as the App shows it: the header button's label, the pane title and the section
 * headers in its column, and the alignment studio's own panel (its shell) and App's columns, counted
 * in the whole page.
 */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  return {
    button: label(app.inspectorButton()),
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
    sections: aside ? aside.querySelectorAll('button.mbc-accordion-header').map((b) => b.textContent.trim()) : [],
    asides: app.all('aside.mbc-right-controls').length,
    shell: app.all('.mbc-aln-inspector-shell').length,
  };
}
const OPEN = (tab: string, sections: string[]) => ({ button: `Hide ${tab} Controls Inspector`, title: `${tab} Controls`, sections, asides: 1, shell: 0 });
const CLOSED = (tab: string) => ({ button: `Show ${tab} Controls Inspector`, title: null, sections: [], asides: 0, shell: 0 });
const GRID_OPEN = { button: 'Hide Alignment Controls Inspector', title: null, sections: [], asides: 0, shell: 1 };
const PAIRWISE = ['Algorithm', 'Scoring'];
const DOTPLOT = ['Dotplot'];

/** The one element under `root` matching `selector` whose text reads `text`. */
function byText(root: LiveElement, selector: string, text: string): LiveElement {
  const found = root.querySelectorAll(selector).filter((e) => e.textContent.trim() === text);
  expect(found, `one ${selector} reading "${text}"`).toHaveLength(1);
  return found[0];
}
const modeStrip = (app: AppHarness) => app.one('[role="tablist"][aria-label="Sequence Alignment Modes"]', 'the mode strip');
const MODES = { msa: 'Multiple Sequence Alignment (MSA)', pairwise: 'Pairwise Alignment', dotplot: 'Dotplot' } as const;
async function chooseMode(app: AppHarness, mode: keyof typeof MODES) {
  await app.click(byText(modeStrip(app), 'button[role="tab"]', MODES[mode]));
  expect(selectedMode(app)).toBe(MODES[mode]);
}
function selectedMode(app: AppHarness): string | null {
  const on = modeStrip(app).querySelectorAll('button[role="tab"]').filter((t) => t.getAttribute('aria-selected') === 'true');
  expect(on.length, 'at most one selected mode').toBeLessThanOrEqual(1);
  return on[0]?.textContent.trim() ?? null;
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
const sectionOrder = (app: AppHarness, title: string) =>
  app.inspectorAside()!.querySelectorAll('.mbc-accordion-section')
    .find((s) => s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent.trim() === title)?.style.getPropertyValue('order');

/** The words a control is labelled with: the first span of the label it sits in. */
const named = (el: LiveElement) => el.closest('label')?.querySelectorAll('span')[0]?.textContent.trim() ?? null;
const optionValues = (select: LiveElement) => select.querySelectorAll('option').map((o) => o.value);
/** The selects under `root` that offer exactly `values`, in order. */
const selectsOffering = (root: LiveElement, values: readonly string[]) =>
  root.querySelectorAll('select').filter((s) => JSON.stringify(optionValues(s)) === JSON.stringify(values));
/** The fields under `root` matching `selector` whose label reads `name`. */
const fieldsNamed = (selector: string, name: string) => (root: LiveElement) => root.querySelectorAll(selector).filter((c) => named(c) === name);
const buttonsReading = (text: string) => (root: LiveElement) => root.querySelectorAll('button').filter((b) => b.textContent.trim() === text);

/** The one control in the section's body matched by `find`, which must be nowhere else in the page. */
function onlyIn(app: AppHarness, body: LiveElement, what: string, find: (root: LiveElement) => LiveElement[]): LiveElement {
  expect(find(body), `${what}: one in the inspector section`).toHaveLength(1);
  expect(find(app.canvas()), `${what}: none in the viewer canvas`).toHaveLength(0);
  expect(find(app.doc.body), `${what}: one in the whole page`).toHaveLength(1);
  return find(body)[0];
}
/** The one control matched by `find`, in the viewer canvas inside `holder` and nowhere in the inspector column. */
function onlyBeside(app: AppHarness, holder: LiveElement, what: string, find: (root: LiveElement) => LiveElement[]): LiveElement {
  expect(app.canvas().contains(holder), `${what}: its holder is in the viewer canvas`).toBe(true);
  expect(find(holder), `${what}: one beside the result`).toHaveLength(1);
  expect(find(app.doc.body), `${what}: one in the whole page`).toHaveLength(1);
  const aside = app.inspectorAside();
  if (aside) expect(find(aside), `${what}: none in the inspector column`).toHaveLength(0);
  return find(holder)[0];
}

// The Pairwise view.
const PW_METHODS = ['nw', 'sw', 'banded-nw', 'banded-sw'];
const MATRICES = ['blosum62', 'pam250'];
const numberField = (name: string) => fieldsNamed('input[type="number"]', name);

interface PairwiseControls { method: LiveElement; matrix: LiveElement | null; scores: Record<string, LiveElement>; reset: LiveElement }
/** The Algorithm and Scoring sections' controls, in the column only. */
function pairwiseControls(app: AppHarness, protein = false): PairwiseControls {
  const algorithm = sectionBody(app, 'Algorithm');
  const method = onlyIn(app, algorithm, 'the method', (r) => selectsOffering(r, PW_METHODS));
  expect(named(method), 'the method is labelled').toBe('Method');
  const matrix = protein ? onlyIn(app, algorithm, 'the substitution matrix', (r) => selectsOffering(r, MATRICES)) : null;
  if (matrix) expect(named(matrix), 'the matrix is labelled').toBe('Substitution matrix');
  else expect(selectsOffering(app.doc.body, MATRICES), 'no substitution matrix for nucleotides').toHaveLength(0);
  const scoring = sectionBody(app, 'Scoring');
  const names = protein ? ['Gap open', 'Gap extend'] : ['Match', 'Mismatch', 'Gap open', 'Gap extend'];
  expect(scoring.querySelectorAll('input[type="number"]').map(named), 'the scores in the Scoring section').toEqual(names);
  const scores = Object.fromEntries(names.map((n) => [n, onlyIn(app, scoring, n, numberField(n))]));
  const reset = onlyIn(app, scoring, 'Reset defaults', buttonsReading('Reset defaults'));
  return { method, matrix, scores, reset };
}
/** Sequence A, Sequence B and Swap: in the pairwise panel with the result they choose, in the canvas. */
function sequencePickers(app: AppHarness) {
  const panels = app.canvas().querySelectorAll('.mbc-pw-panel');
  expect(panels, 'the pairwise panel is drawn in the canvas').toHaveLength(1);
  const panel = panels[0];
  const a = onlyBeside(app, panel, 'Sequence A', fieldsNamed('select', 'Sequence A (reference)'));
  const b = onlyBeside(app, panel, 'Sequence B', fieldsNamed('select', 'Sequence B (query)'));
  const swap = onlyBeside(app, panel, 'Swap', (r) => r.querySelectorAll('button[title="Swap sequences A and B"]'));
  expect(panel.querySelectorAll('.mbc-pw-kpis'), 'the result beside them').toHaveLength(1);
  return { a, b, swap };
}
/** The result's Score KPI. */
function scoreKpi(app: AppHarness): number {
  const values = app.canvas().querySelectorAll('.mbc-pw-kpi.is-score .mbc-pw-kpi-value');
  expect(values, 'one Score KPI').toHaveLength(1);
  return Number(values[0].textContent.replace(/[^\d-]/g, ''));
}
/** A KPI's sub-line, by its tone (id, sim, gap, score). */
function kpiSub(app: AppHarness, tone: string): string {
  const subs = app.canvas().querySelectorAll(`.mbc-pw-kpi.is-${tone} .mbc-pw-kpi-sub`);
  expect(subs, `one ${tone} KPI`).toHaveLength(1);
  return subs[0].textContent.trim();
}

// The Dotplot view.
const DOT_METHODS = ['window', 'word'];
const DOT_COLOURS = ['Strand', 'Score', 'Classic'];
const DOT_TOGGLES = ['Reverse-complement matches', 'Alignment path', 'Annotations on axes', 'Gridlines'];
const checkbox = (name: string) => fieldsNamed('input[type="checkbox"]', name);
/** The dotplot's two captions beneath the plot: the method that drew it, and what it drew. */
function dotplotCaptions(app: AppHarness): string[] {
  const plots = app.canvas().querySelectorAll('.mbc-dotplot-plot');
  expect(plots, 'the dotplot is drawn in the canvas').toHaveLength(1);
  return plots[0].querySelectorAll('.mbc-aln-hint').map((h) => h.textContent.trim());
}
/** The X and Y pickers and Export PNG: with the plot, in the canvas. */
function dotplotPickers(app: AppHarness) {
  const boxes = app.canvas().querySelectorAll('.mbc-dotplot .mbc-dotplot-controls');
  expect(boxes, "the dotplot's own box beside the plot").toHaveLength(1);
  return {
    x: onlyBeside(app, boxes[0], 'the X sequence', fieldsNamed('select', 'X sequence:')),
    y: onlyBeside(app, boxes[0], 'the Y sequence', fieldsNamed('select', 'Y sequence:')),
    exportPng: onlyBeside(app, boxes[0], 'Export PNG', buttonsReading('Export PNG')),
  };
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
/** A member of PAIR as a plain document of its own, for the studio drawn on its own. */
const memberDoc = (id: string, name: string, sequence: string): SequenceDocument => ({ ...BLANK, id, name, sequence, folder: 'Local' });

// ─── AC1 ───

describe("Pairwise Alignment's settings in App's inspector (AC1)", () => {
  it("puts the pairwise algorithm and scoring in App's inspector", async () => {
    await withApp(async (app) => {
      await onAlignment(app);
      await chooseMode(app, 'pairwise');
      expect(shown(app)).toEqual(OPEN('Alignment', PAIRWISE));
      expect([sectionOrder(app, 'Algorithm'), sectionOrder(app, 'Scoring')], 'Algorithm first, then Scoring').toEqual(['1', '2']);
      const pw = pairwiseControls(app);
      expect(pw.method.value, 'Needleman-Wunsch unless chosen').toBe('nw');
      expect(Object.values(pw.scores).map((s) => s.value), 'the default scores').toEqual(['2', '-3', '5', '2']);
      const picks = sequencePickers(app);
      expect([picks.a.value, picks.b.value], 'the first two members, A and B').toEqual(['taa4-a', 'taa4-b']);
      // Swap, beside the result, still swaps them.
      await app.click(picks.swap);
      expect([sequencePickers(app).a.value, sequencePickers(app).b.value], 'swapped').toEqual(['taa4-b', 'taa4-a']);

      // Reset defaults, in the Scoring section, resets the scores it sits with.
      const edits: [string, string][] = [['Match', '7'], ['Mismatch', '-5'], ['Gap open', '9'], ['Gap extend', '4']];
      for (const [name, value] of edits) await app.change(pairwiseControls(app).scores[name], value);
      expect(Object.values(pairwiseControls(app).scores).map((s) => s.value), 'the edited scores').toEqual(['7', '-5', '9', '4']);
      await app.click(pairwiseControls(app).reset);
      expect(Object.values(pairwiseControls(app).scores).map((s) => s.value), 'reset').toEqual(['2', '-3', '5', '2']);

      // Hidden, the column and its settings are gone, not back in the canvas; the button and the sequences stay.
      await app.change(pairwiseControls(app).scores.Match, '4');
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED('Alignment'));
      expect(selectsOffering(app.doc.body, PW_METHODS), 'the method is nowhere while hidden').toHaveLength(0);
      expect(app.all('input[type="number"]').filter((i) => named(i) === 'Match'), 'Match is nowhere while hidden').toHaveLength(0);
      sequencePickers(app);
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(OPEN('Alignment', PAIRWISE));
      expect(pairwiseControls(app).scores.Match.value, 'reopened, the score is as it was set').toBe('4');

      // An unaligned list: its tab, the button and the pane read Sequences.
      await onAlignment(app, LIST);
      expect(app.header().querySelectorAll('button[role="tab"][data-view="sequence-alignment"]')[0]?.textContent.trim(), 'the tab reads Sequences').toBe('Sequences');
      await chooseMode(app, 'pairwise');
      expect(shown(app)).toEqual(OPEN('Sequences', PAIRWISE));
      pairwiseControls(app);
      expect([sequencePickers(app).a.value, sequencePickers(app).b.value]).toEqual(['taa4-l1', 'taa4-l2']);

      // A protein pair: the substitution matrix in the Algorithm section, the gap scores alone in Scoring.
      await onAlignment(app, PROT);
      await chooseMode(app, 'pairwise');
      expect(shown(app)).toEqual(OPEN('Alignment', PAIRWISE));
      const prot = pairwiseControls(app, true);
      expect([prot.matrix!.value, prot.scores['Gap open'].value, prot.scores['Gap extend'].value]).toEqual(['blosum62', '11', '1']);
      expect(kpiSub(app, 'sim'), 'similarity scored with BLOSUM62').toBe('positive BLOSUM62 scores');
      await app.change(prot.matrix!, 'pam250');
      expect(kpiSub(app, 'sim'), 'the matrix chosen in the inspector scores the result').toBe('positive PAM250 scores');
      sequencePickers(app);
      // Banded DP takes no matrix: the field goes, from the inspector too.
      await app.change(pairwiseControls(app, true).method, 'banded-nw');
      expect(selectsOffering(app.doc.body, MATRICES), 'no matrix for banded DP').toHaveLength(0);

      // Drawn on its own (no workbench), the three fieldsets sit in the setup row above the result, as before.
      const { SequenceAlignmentStudio } = await import('../components/AlignmentAndPhyloStudio');
      const docs = [memberDoc('taa4-a', 'TAA4 Member A', DNA_A), memberDoc('taa4-b', 'TAA4 Member B', DNA_B)];
      await drawnOnItsOwn(app, (React) => React.createElement(SequenceAlignmentStudio, { documents: docs, projectDocuments: docs, activeDoc: docs[0], initialSubMode: 'pairwise' }), (probe) => {
        const setups = probe.querySelectorAll('.mbc-pw-panel > .mbc-pw-setup');
        expect(setups, 'one setup row').toHaveLength(1);
        const fieldsets = setups[0].children;
        expect(fieldsets.map((f) => `${f.localName}:${f.querySelectorAll('legend')[0]?.textContent}`), 'its three fieldsets').toEqual(['fieldset:Sequences', 'fieldset:Algorithm', 'fieldset:Scoring']);
        const [sequences, algorithm, scoring] = fieldsets;
        expect(selectsOffering(algorithm, PW_METHODS), 'the method in the Algorithm fieldset').toHaveLength(1);
        expect(scoring.querySelectorAll('input[type="number"]').map(named), 'the scores in the Scoring fieldset').toEqual(['Match', 'Mismatch', 'Gap open', 'Gap extend']);
        expect(buttonsReading('Reset defaults')(scoring), 'Reset defaults with them').toHaveLength(1);
        expect(sequences.querySelectorAll('select').map(named), 'the sequences in theirs').toEqual(['Sequence A (reference)', 'Sequence B (query)']);
        const rows = probe.querySelectorAll('.mbc-pw-panel')[0].children.map((c) => c.getAttribute('class'));
        expect(rows.indexOf('mbc-pw-kpis'), 'the result below them').toBeGreaterThan(rows.indexOf('mbc-pw-setup'));
      });
    });
  });
});

// ─── AC2 ───

describe("Dotplot's options in App's inspector (AC2)", () => {
  it("puts the dotplot options in App's inspector", async () => {
    await withApp(async (app) => {
      await onAlignment(app);
      await chooseMode(app, 'dotplot');
      expect(shown(app)).toEqual(OPEN('Alignment', DOTPLOT));
      const body = () => sectionBody(app, 'Dotplot');
      const method = () => onlyIn(app, body(), 'the method', (r) => selectsOffering(r, DOT_METHODS));
      expect([method().value, method().getAttribute('aria-label')]).toEqual(['window', 'Dotplot method']);
      const colours = onlyIn(app, body(), 'the colours', (r) => selectsOffering(r, DOT_COLOURS));
      expect([named(colours), colours.value]).toEqual(['Colors:', 'Strand']);
      const toggles = DOT_TOGGLES.map((t) => onlyIn(app, body(), t, checkbox(t)));
      expect(toggles.map((t) => t.checked), 'reverse, path, annotations, gridlines').toEqual([true, false, true, true]);
      expect(app.all('input[type="number"]').filter((i) => named(i) === 'Word size:'), 'no word size for the windowed method').toHaveLength(0);
      const picks = dotplotPickers(app);
      expect([picks.x.value, picks.y.value], 'X and Y: the first two members').toEqual(['0', '1']);

      // The options drive the plot beside them.
      const [drawnBy, counts] = dotplotCaptions(app);
      expect(drawnBy).toBe('Windowed match · window 11 · minimum 9 matches · both strands');
      expect(counts).toMatch(/^[\d,]+ windows with ≥ 9 of 11 matching · [\d,]+ forward, [\d,]+ reverse$/);
      await app.change(onlyIn(app, body(), 'Reverse-complement matches', checkbox('Reverse-complement matches')), false);
      expect(dotplotCaptions(app)[0], 'forward matches only').toBe('Windowed match · window 11 · minimum 9 matches · forward strand only');
      expect(dotplotCaptions(app)[1], 'forward matches only').not.toMatch(/forward|reverse/);
      await app.change(method(), 'word');
      const wordSize = () => onlyIn(app, body(), 'the word size', numberField('Word size:'));
      expect(wordSize().value, 'the word size, now its method uses one').toBe('10');
      expect(dotplotCaptions(app)[0]).toBe('Exact word match · word size 10 bp · forward strand only');
      await app.change(wordSize(), '12');
      expect(dotplotCaptions(app)[0], 'the word size set in the inspector').toBe('Exact word match · word size 12 bp · forward strand only');
      expect(dotplotCaptions(app)[1]).toMatch(/^[\d,]+ matching segments \(≥ 12 bp\)$/);
      await app.change(colours, 'Classic');
      expect(onlyIn(app, body(), 'the colours', (r) => selectsOffering(r, DOT_COLOURS)).value).toBe('Classic');
      // A picker beside the plot still picks.
      await app.change(dotplotPickers(app).y, '2');
      expect(app.canvas().querySelectorAll('canvas[aria-label="Dotplot of TAA4 Member A vs TAA4 Member C"]'), 'X against the third member').toHaveLength(1);

      // Hidden, the options are nowhere and the plot keeps them; reopened, they are as they were set.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED('Alignment'));
      expect(selectsOffering(app.doc.body, DOT_METHODS), 'the method is nowhere while hidden').toHaveLength(0);
      expect(app.all('input[type="checkbox"]').filter((c) => DOT_TOGGLES.includes(named(c) ?? '')), 'no option while hidden').toHaveLength(0);
      dotplotPickers(app);
      expect(dotplotCaptions(app)[0], 'the plot keeps the options').toBe('Exact word match · word size 12 bp · forward strand only');
      await app.click(app.inspectorButton()!);
      expect([method().value, wordSize().value, onlyIn(app, body(), 'Reverse-complement matches', checkbox('Reverse-complement matches')).checked]).toEqual(['word', '12', false]);

      // A protein alignment: word matches with their word size; no method and no reverse strand.
      await onAlignment(app, PROT);
      await chooseMode(app, 'dotplot');
      expect(shown(app)).toEqual(OPEN('Alignment', DOTPLOT));
      expect(onlyIn(app, body(), 'the word size', numberField('Word size:')).value).toBe('3');
      expect(body().querySelectorAll('input[type="checkbox"]').map(named), 'the protein toggles').toEqual(DOT_TOGGLES.slice(1));
      expect(selectsOffering(app.doc.body, DOT_METHODS), 'no method for a protein').toHaveLength(0);
      dotplotPickers(app);

      // Drawn on its own, every option sits in the dotplot's own box, in its place, as before.
      const { AlignmentDotplot } = await import('../components/AlignmentDotplot');
      const sequences = [['taa4-a', 'TAA4 Member A', DNA_A], ['taa4-b', 'TAA4 Member B', DNA_B]].map(([id, name, alignedSeq]) => ({ id, name, alignedSeq, features: [] }));
      await drawnOnItsOwn(app, (React) => React.createElement(AlignmentDotplot, { sequences, isProtein: false }), (probe) => {
        const boxes = probe.querySelectorAll('.mbc-dotplot > .mbc-dotplot-controls');
        expect(boxes, "the dotplot's own box").toHaveLength(1);
        const items = boxes[0].children.map((c) => (c.localName === 'label' ? named(c.querySelectorAll('input, select')[0]) : c.textContent.trim()));
        expect(items.slice(0, -1), 'the pickers, the options and Export PNG, in place').toEqual(['X sequence:', 'Y sequence:', 'Method:', 'Colors:', ...DOT_TOGGLES, 'Export PNG']);
      });
    });
  });
});

// ─── AC3 ───

describe('one inspector across the alignment modes (AC3)', () => {
  it('shows one inspector at a time across the alignment modes', async () => {
    await withApp(async (app) => {
      await onAlignment(app);
      expect(selectedMode(app)).toBe(MODES.msa);
      const OPEN_IN: Record<keyof typeof MODES, ReturnType<typeof shown>> = { msa: GRID_OPEN, pairwise: OPEN('Alignment', PAIRWISE), dotplot: OPEN('Alignment', DOTPLOT) };
      expect(shown(app), 'the MSA grid: its own panel, no App column').toEqual(GRID_OPEN);
      const ROUTE: (keyof typeof MODES)[] = ['pairwise', 'dotplot', 'msa', 'dotplot', 'pairwise', 'msa'];
      for (const mode of ROUTE) {
        await chooseMode(app, mode);
        expect(shown(app), `${mode}, open`).toEqual(OPEN_IN[mode]);
      }

      // Closed on Pairwise, every mode is closed; opened on the MSA grid, every mode is open.
      await chooseMode(app, 'pairwise');
      await app.click(app.inspectorButton()!);
      const CLOSED_IN = { button: 'Show Alignment Controls Inspector', title: null, sections: [], asides: 0, shell: 0 };
      for (const mode of ['pairwise', 'dotplot', 'msa', 'pairwise'] as const) {
        await chooseMode(app, mode);
        expect(shown(app), `${mode}, closed`).toEqual(CLOSED_IN);
      }
      await chooseMode(app, 'msa');
      await app.press('i', { mod: true, alt: true });
      for (const mode of ['msa', 'dotplot', 'pairwise', 'msa'] as const) {
        await chooseMode(app, mode);
        expect(shown(app), `${mode}, reopened`).toEqual(OPEN_IN[mode]);
      }
      // Closed on Dotplot by the shortcut, the MSA grid shows no panel.
      await chooseMode(app, 'dotplot');
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'dotplot, closed by the shortcut').toEqual(CLOSED_IN);
      await chooseMode(app, 'msa');
      expect(shown(app), 'msa, closed').toEqual(CLOSED_IN);
    });
  });
});

// ─── AC4 ───

interface EngineCall { op: string; payload: string }
/**
 * Records every call the App's WASM engine is sent (its op and JSON payload), read from the
 * engine's own scratch buffer as the call is made. Installed before the App launches, so the
 * launch's engine instance is the recorded one.
 */
function recordEngineCalls() {
  const calls: EngineCall[] = [];
  const state = { muted: false };
  const RealInstance = WebAssembly.Instance;
  const decoder = new TextDecoder();
  function Recorded(module: WebAssembly.Module, imports?: WebAssembly.Imports) {
    const real = new RealInstance(module, imports);
    const exp = real.exports as Record<string, unknown>;
    const memory = exp.memory as WebAssembly.Memory;
    const scratch = exp.mbc_wasm_scratch_ptr as (n: number) => number;
    const invoke = exp.mbc_wasm_invoke_scratch as (opLen: number, payloadLen: number) => number;
    let at = 0;
    return {
      exports: {
        ...exp,
        mbc_wasm_scratch_ptr: (n: number) => (at = scratch(n)),
        mbc_wasm_invoke_scratch: (opLen: number, payloadLen: number) => {
          if (!state.muted) {
            const bytes = new Uint8Array(memory.buffer);
            calls.push({ op: decoder.decode(bytes.slice(at, at + opLen)), payload: decoder.decode(bytes.slice(at + opLen, at + opLen + payloadLen)) });
          }
          return invoke(opLen, payloadLen);
        },
      },
    };
  }
  (WebAssembly as { Instance: unknown }).Instance = Recorded;
  return { calls, state, restore: () => { (WebAssembly as { Instance: unknown }).Instance = RealInstance; } };
}

describe('the scores re-align the pair (AC4)', () => {
  it('re-aligns the pair when a score changes in the inspector', async () => {
    const engine = recordEngineCalls();
    try {
      await withApp(async (app) => {
        /** The pairwise alignments of members A and B the studio has asked the engine for. */
        const pairRuns = () => engine.calls
          .filter((c) => c.op === 'align_pairwise_gotoh')
          .map((c) => JSON.parse(c.payload) as { seq1: string; seq2: string; mode: string; matchScore: number; mismatchPenalty: number; gapOpen: number; gapExtend: number })
          .filter((p) => p.seq1 === DNA_A && p.seq2 === DNA_B);
        const bio = await import('../core/bioEngine');
        /** The score the engine gives A against B with these scores, asked with the recording muted. */
        const expectedScore = (match: number, mismatch: number, open: number, extend: number) => {
          engine.state.muted = true;
          try {
            return bio.alignPairwiseTypeScript(DNA_A, DNA_B, false, match, mismatch, -open, -extend, 'DNA').score;
          } finally {
            engine.state.muted = false;
          }
        };

        await onAlignment(app);
        expect(engine.calls.length, 'the engine is recorded').toBeGreaterThan(0);
        expect(pairRuns(), 'the MSA grid aligns no pair').toHaveLength(0);
        await chooseMode(app, 'dotplot');
        expect(pairRuns(), 'nor does the dotplot').toHaveLength(0);

        await chooseMode(app, 'pairwise');
        expect(pairRuns().length, 'Pairwise aligns A and B').toBeGreaterThan(0);
        const scoresOf = (p: ReturnType<typeof pairRuns>[number]) => [p.mode, p.matchScore, p.mismatchPenalty, p.gapOpen, p.gapExtend];
        expect(scoresOf(pairRuns().at(-1)!), 'with the default scores').toEqual(['global', 2, -3, -5, -2]);
        let score = scoreKpi(app);
        expect(score).toBe(expectedScore(2, -3, 5, 2));

        // Each score, changed in the inspector, aligns the pair again with it.
        const steps: [string, string, (number | string)[]][] = [
          ['Match', '5', ['global', 5, -3, -5, -2]],
          ['Mismatch', '-1', ['global', 5, -1, -5, -2]],
          ['Gap open', '9', ['global', 5, -1, -9, -2]],
          ['Gap extend', '3', ['global', 5, -1, -9, -3]],
        ];
        for (const [name, value, sent] of steps) {
          const before = pairRuns().length;
          await app.change(onlyIn(app, sectionBody(app, 'Scoring'), name, numberField(name)), value);
          expect(pairRuns().length, `${name}: aligned once more`).toBe(before + 1);
          expect(scoresOf(pairRuns().at(-1)!), `${name}: with the score set`).toEqual(sent);
          const [, match, mismatch, open, extend] = sent as [string, number, number, number, number];
          const now = scoreKpi(app);
          expect(now, `${name}: the result shows the new alignment's score`).toBe(expectedScore(match, mismatch, -open, -extend));
          if (name === 'Match') expect(now, 'the match score moves the result').not.toBe(score);
          score = now;
        }

        // Away from Pairwise the pair is not aligned; back on it, it is, with the scores kept.
        const runs = pairRuns().length;
        await chooseMode(app, 'msa');
        await chooseMode(app, 'dotplot');
        await app.click(app.inspectorButton()!);
        await chooseMode(app, 'msa');
        expect(pairRuns(), 'not aligned on the MSA grid or the dotplot').toHaveLength(runs);
        await chooseMode(app, 'pairwise');
        expect(pairRuns().length, 'aligned again on Pairwise').toBe(runs + 1);
        expect(scoresOf(pairRuns().at(-1)!), 'with the scores set before').toEqual(['global', 5, -1, -9, -3]);
        expect(scoreKpi(app)).toBe(score);
      });
    } finally {
      engine.restore();
    }
  });
});

// ─── AC5 ───

describe('a menu command that preselects the pairwise method (AC5)', () => {
  it('shows the pairwise algorithm a menu command preselects', async () => {
    await withApp(async (app) => {
      const bio = await import('../core/bioEngine');
      const algorithmOf = (local: boolean) => bio.alignPairwiseTypeScript(DNA_A, DNA_B, local, 2, -3, -5, -2, 'DNA').algorithm;
      /** The algorithm the result says drew it. */
      const drawnBy = () => app.canvas().querySelectorAll('.mbc-pw-meta > span')[0]?.textContent.trim() ?? null;
      const method = () => pairwiseControls(app).method;

      await onAlignment(app);
      expect(shown(app), 'on the MSA grid').toEqual(GRID_OPEN);
      // The Local (Smith-Waterman) command (align:pairwise-sw), from the MSA grid.
      await app.menu('align:pairwise-sw');
      expect(selectedMode(app)).toBe(MODES.pairwise);
      expect(shown(app)).toEqual(OPEN('Alignment', PAIRWISE));
      expect(method().value, 'Smith-Waterman, in the inspector').toBe('sw');
      expect(drawnBy(), 'and in the result').toBe(algorithmOf(true));

      // A method chosen by hand, then the Global (Needleman-Wunsch) command (align:pairwise-nw).
      await app.change(method(), 'banded-nw');
      expect(method().value).toBe('banded-nw');
      await app.menu('align:pairwise-nw');
      expect(method().value, 'Needleman-Wunsch, in the inspector').toBe('nw');
      expect(drawnBy(), 'and in the result').toBe(algorithmOf(false));
      expect(algorithmOf(false)).not.toBe(algorithmOf(true));

      // From the dotplot, with the inspector closed: the method shows once the inspector opens.
      await chooseMode(app, 'dotplot');
      await app.click(app.inspectorButton()!);
      await app.menu('align:pairwise-sw');
      expect(selectedMode(app)).toBe(MODES.pairwise);
      expect(shown(app), 'closed, as it was left').toEqual(CLOSED('Alignment'));
      expect(drawnBy(), 'the result is local').toBe(algorithmOf(true));
      await app.click(app.inspectorButton()!);
      expect(method().value, 'Smith-Waterman, once opened').toBe('sw');
    });
  });
});
