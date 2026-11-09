// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TA87: the Chromatogram's six groups of view controls (General & Layout with the read and
 * reference pickers, Display & Color Scheme, Trace Channels (4-Dye), Quality Trimming, Contig
 * Assembly and Trace Statistics) in App's shared inspector, with Run assembly preview left on the
 * canvas beside the contig result (D0060 ruling 5, D0063 rulings c and d). Every check mounts the
 * real App over the live DOM with the US-01M6TB6G harness and restores trace records built here on
 * the Chromatogram tab; the checks read App's own header button, pane title, resizer and
 * aside.mbc-right-controls, and the layout checks read App.css through the harness's cascade
 * reader. No check builds a provider (LC-003), reads component source or reads test-data.
 *
 * The traces are built here from a fixed seed: a 400 bp template, a forward read over its first 300
 * bases and a reverse read over its last 300, each called under clean peaks and scored Q5 at its 15
 * end bases and Q40 between, so the Mott pre-trim keeps 270 bp of each and the contig is 370 bp
 * trimmed and 400 bp raw.
 *
 * Wrong implementations, and the check that fails for each: a control left in the canvas, drawn
 * twice, or in the wrong section, sections out of order or all unfolded at the start, an aside
 * still drawn by the studio in the workbench (AC1); Run assembly preview moved into the inspector,
 * drawn there as well, gone from the canvas, or run with a fixed pre-trim (AC2); a channel button
 * or the Y-Gain wired to nothing or to another setting, and a value or open state lost when the
 * inspector closes (AC3); the has-trace-inspector grid kept in the workbench, the note style left
 * scoped to the studio's own aside, and the empty-comparison note still naming a sidebar (AC4); the
 * 1150px rule's stacking or its hand-back of scrolling reaching the workbench, or the rule lost for
 * the studio drawn on its own (AC5); and the studio drawn on its own losing its aside, a section,
 * or Run assembly preview from its Contig Assembly section (AC7, beside documentContextRegression
 * and plainLanguageLabels).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { cascaded, gridTracks, type CascadeView } from './cssCascade';
import { LiveElement } from './liveDom';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

async function withApp<T>(opts: MountOptions, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Trace records built in the test ───

/** mulberry32: a small, fixed-seed generator. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const reverseComplement = (seq: string) => Array.from(seq).reverse().map((b) => COMPLEMENT[b]).join('');

const draw = rng(0x7a87);
const TEMPLATE = Array.from({ length: 400 }, () => 'ACGT'[Math.floor(draw() * 4)]).join('');
/** Q5 at the 15 bases at each end, Q40 between: the Mott trim at P(err) 0.05 keeps the 270 in the middle. */
const PHRED = Array.from({ length: 300 }, (_, i) => (i < 15 || i >= 285 ? 5 : 40));

/** A Sanger trace with these base calls, each under a clean peak 1,000 high, scored as given. */
function traceDoc(id: string, name: string, calls: string, phredScores: number[]): SequenceDocument {
  const spacing = 12;
  const channels: Record<string, number[]> = {};
  for (const b of 'ACGT') channels[b] = new Array((calls.length + 1) * spacing).fill(0);
  const peakLocations: number[] = [];
  for (let i = 0; i < calls.length; i++) {
    const at = i * spacing + spacing / 2;
    peakLocations.push(at);
    for (let x = at - 5; x <= at + 5; x++) channels[calls[i]][x] = Math.round(1000 * Math.exp(-((x - at) ** 2) / 4));
  }
  return {
    id, name, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence: calls,
    features: [], primers: [], history: [], createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
    folder: 'Sequencing Reads (Sanger/NGS)', documentKind: 'trace',
    chromatogram: { traceA: channels.A, traceC: channels.C, traceG: channels.G, traceT: channels.T, peakLocations, phredScores, baseCalls: calls },
  };
}
const FWD = traceDoc('ta87-fwd', 'TA87_Fwd.ab1', TEMPLATE.slice(0, 300), PHRED);
const REV = traceDoc('ta87-rev', 'TA87_Rev.ab1', reverseComplement(TEMPLATE.slice(100)), PHRED);
/** The template as a plain record: a DNA sequence with no trace. */
const PLAIN: SequenceDocument = { ...FWD, id: 'ta87-plain', name: 'TA87_Template.fasta', sequence: TEMPLATE, folder: 'Plasmids', documentKind: undefined, chromatogram: undefined };

const onTraceTab = (app: AppHarness, docs: SequenceDocument[]) =>
  app.restoreSession({ documents: docs, activeDocId: docs[0].id, viewerTab: 'sanger-contig' });

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const TITLES = ['General & Layout', 'Display & Color Scheme', 'Trace Channels (4-Dye)', 'Quality Trimming', 'Contig Assembly', 'Trace Statistics'] as const;
type Title = (typeof TITLES)[number];
const ONLY_GENERAL_OPEN = [true, false, false, false, false, false];
const PRE_TRIM = 'Pre-trim reads (Mott quality trimming)';
const RUN = 'Run assembly preview';
const CONTIG_CARD = 'Contig assembly by partial-order alignment (POA)';

/** A section's accordion header: the one header button directly in it. */
function headerOf(section: LiveElement): LiveElement {
  const found = section.children.filter((c) => c.localName === 'button' && c.classList.contains('mbc-accordion-header'));
  expect(found, 'one header in the section').toHaveLength(1);
  return found[0];
}
const titleOf = (section: LiveElement) => words(headerOf(section).textContent);
const sectionsIn = (scope: LiveElement) => scope.querySelectorAll('.mbc-accordion-section');
function sectionIn(scope: LiveElement, title: Title): LiveElement {
  const found = sectionsIn(scope).filter((s) => titleOf(s) === title);
  expect(found, `one ${title} section`).toHaveLength(1);
  return found[0];
}
const isOpen = (section: LiveElement) => headerOf(section).getAttribute('aria-expanded') === 'true';
/** Unfolds the section titled `title` in `scope()` (App's aside, or the studio's own), if it is folded. */
async function unfold(app: AppHarness, scope: () => LiveElement, title: Title) {
  if (!isOpen(sectionIn(scope(), title))) await app.click(headerOf(sectionIn(scope(), title)));
  expect(isOpen(sectionIn(scope(), title)), `${title} unfolded`).toBe(true);
}
const aside = (app: AppHarness) => {
  const found = app.inspectorAside();
  expect(found, 'the inspector column is drawn').not.toBeNull();
  return found!;
};
const paneTitle = (app: AppHarness) => app.inspectorAside()?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null;

/** The field of each control row in `scope` whose caption starts with `caption`. */
const rowFields = (scope: LiveElement, caption: string) =>
  scope.querySelectorAll('.mbc-control-row').filter((r) => words(r.children[0]?.textContent ?? '').startsWith(caption)).flatMap((r) => r.querySelectorAll('select, input'));
const rowCaption = (field: LiveElement) => words(field.closest('.mbc-control-row')?.children[0]?.textContent ?? '');
/** The checkbox of each check row in `scope` labelled `label`. */
const checks = (scope: LiveElement, label: string) =>
  scope.querySelectorAll('label.mbc-check-row').filter((l) => words(l.textContent) === label).flatMap((l) => l.querySelectorAll('input[type="checkbox"]'));
const channelButtons = (scope: LiveElement, dye: string) => scope.querySelectorAll('button.mbc-trace-channel-btn').filter((b) => words(b.textContent) === dye);
const statRows = (scope: LiveElement, label: string) => scope.querySelectorAll('.stat-kv').filter((kv) => words(kv.children[0]?.textContent ?? '') === label);
const buttonsNamed = (scope: LiveElement, text: string) => scope.querySelectorAll('button').filter((b) => words(b.textContent) === text);
function one(found: LiveElement[], what: string): LiveElement {
  expect(found, `one ${what}`).toHaveLength(1);
  return found[0];
}

interface Control { what: string; find(scope: LiveElement): LiveElement[] }
const row = (caption: string): Control => ({ what: caption, find: (s) => rowFields(s, caption) });
const check = (label: string): Control => ({ what: label, find: (s) => checks(s, label) });
const group = (label: string): Control => ({ what: label, find: (s) => s.querySelectorAll(`[role="group"][aria-label="${label}"]`) });
const stat = (label: string): Control => ({ what: label, find: (s) => statRows(s, label) });
/** What each section holds, for a trace scored at every call. */
const CONTROLS: Record<Title, Control[]> = {
  'General & Layout': [row('Sequencing Read (.ab1 / FASTQ)'), row('Reference Plasmid / Template'), group('Trace view mode'), group('Peak height scaling'), row('Window Start Base')],
  'Display & Color Scheme': [check('View Full Height'), check('Shading (Filled Peaks)'), check('Show Bases Above'), check('Show Quality Values (Q)'), check('Thin Lines'), row('Y-Gain')],
  'Trace Channels (4-Dye)': ['A', 'C', 'G', 'T'].map((dye) => ({ what: `the ${dye} channel`, find: (s: LiveElement) => channelButtons(s, dye) })),
  'Quality Trimming': [row('Error Cutoff P(err)'), stat('HQ Window'), stat('Trimmed Length')],
  'Contig Assembly': [check(PRE_TRIM)],
  'Trace Statistics': [stat('Called Bases'), stat('Mean Phred'), stat('Q20 / Q30'), stat('HQ Trim Window (P(err) cutoff 0.05)'), stat('Signal / Noise'), stat('Mixed IUPAC Peaks')],
};

// The trace on the canvas: each dye's curve and shading, as the studio draws them.
const DYE: Record<string, string> = { A: 'var(--mbc-green)', C: 'var(--mbc-blue)', G: 'var(--mbc-amber)', T: 'var(--mbc-red)' };
const SHADE: Record<string, string> = { A: 'rgba(30, 142, 62, 0.15)', C: 'rgba(26, 115, 232, 0.15)', G: 'rgba(227, 116, 0, 0.15)', T: 'rgba(217, 48, 37, 0.15)' };
/** The trace drawn in `scope`: its chromatogram SVG (the quality strip of a read with no trace is an image). */
const traceSvg = (scope: LiveElement) => one(scope.querySelectorAll('svg.chromatogram-svg').filter((s) => !s.hasAttribute('role')), 'drawn trace');
const curves = (svg: LiveElement, dye: string) => svg.querySelectorAll('path').filter((p) => p.getAttribute('stroke') === DYE[dye]);
const shades = (svg: LiveElement, dye: string) => svg.querySelectorAll('path').filter((p) => p.getAttribute('fill') === SHADE[dye]);
/** The height of a curve's tallest peak over its baseline, in the trace's SVG units. */
function peakHeight(curve: LiveElement): number {
  const ys = [...(curve.getAttribute('d') ?? '').matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
  expect(ys.length, 'the curve has points').toBeGreaterThan(1);
  return Math.max(...ys) - Math.min(...ys);
}
const windowReadout = (app: AppHarness) => words(one(app.canvas().querySelectorAll('.mbc-cockpit-span-readout'), 'window readout').textContent);

/** The contig card in `scope`: its result, and Run assembly preview in the workbench. */
const contigCard = (scope: LiveElement) =>
  one(scope.querySelectorAll('.contig-variants-section').filter((c) => c.querySelectorAll('h4').some((h) => words(h.textContent) === CONTIG_CARD)), 'contig card');
const cardHeader = (card: LiveElement) => one(card.children.filter((c) => c.classList.contains('studio-card-header')), 'contig card header');
/** What the contig card shows: its badge, consensus, read rows and note, each null when it shows none. */
function contigResult(card: LiveElement) {
  const kpi = card.querySelectorAll('.kpi-box').find((k) => words(k.querySelectorAll('.kpi-label')[0]?.textContent ?? '') === 'POA Consensus Length');
  const table = card.querySelectorAll('table').find((t) => t.closest('[aria-label="POA Assembled Sequencing Reads"]'));
  return {
    badge: cardHeader(card).querySelectorAll('.badge-accent').map((b) => words(b.textContent))[0] ?? null,
    consensus: kpi ? words(kpi.querySelectorAll('.kpi-val')[0].textContent) : null,
    reads: table ? table.querySelectorAll('tbody tr').map((tr) => { const td = tr.querySelectorAll('td'); return [words(td[0].textContent), words(td[2].textContent)]; }).sort() : null,
    note: card.querySelectorAll('p.studio-panel-note').map((p) => words(p.textContent))[0] ?? null,
  };
}

/**
 * The studio drawn on its own: in a React root of its own, in the launched App's window, with no
 * WorkbenchInspectorProvider above it, so useInWorkbench() reads false. `rootClass` names the root
 * element's classes (a viewer canvas, for the layout checks).
 */
async function drawnOnItsOwn(app: AppHarness, rootClass: string, check: (root: LiveElement) => Promise<void>) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ChromatogramAndContigStudio } = await import('../components/ChromatogramAndContigStudio');
  const probe = app.doc.createElement('div');
  if (rootClass) probe.setAttribute('class', rootClass);
  app.doc.body.appendChild(probe);
  const root = createRoot(probe as unknown as Element);
  try {
    await React.act(async () => {
      root.render(React.createElement(ChromatogramAndContigStudio, { documents: [FWD, REV], activeDoc: FWD, selectedDocuments: [FWD, REV], onCreateDocument: () => {} }));
    });
    await app.settle();
    await check(probe);
  } finally {
    await React.act(async () => { root.unmount(); });
    probe.remove();
  }
}

// ─── AC1 ───

describe("the chromatogram's view controls in the shared inspector (AC1)", () => {
  it("puts the chromatogram's view controls in App's inspector", async () => {
    await withApp({}, async (app) => {
      await onTraceTab(app, [FWD, REV, PLAIN]);
      expect(app.activeTab()).toBe('sanger-contig');

      // App's own header button, its pane title, and its column beside its resizer.
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Hide Chromatogram View Controls Inspector');
      expect(paneTitle(app)).toBe('Chromatogram View Controls');
      const split = app.bodySplit();
      expect(split.children.map((c) => c.localName), 'viewer, resizer, column').toEqual(['div', 'div', 'aside']);
      const [host, resizer, column] = split.children;
      expect([host.contains(app.canvas()), resizer.getAttribute('role'), resizer.getAttribute('aria-label'), column === aside(app), column.classList.contains('mbc-right-controls')])
        .toEqual([true, 'separator', 'Resize Chromatogram View Controls inspector', true, true]);

      // The six sections, in their order, in App's shared body; General & Layout alone unfolded.
      const body = one(aside(app).querySelectorAll('.mbc-inspector-sections'), "App's shared inspector body");
      expect(sectionsIn(aside(app)).every((s) => s.parentElement === body), 'every section in the shared body').toBe(true);
      expect(sectionsIn(aside(app)).map(titleOf)).toEqual([...TITLES]);
      expect(sectionsIn(aside(app)).map((s) => cascaded(s, 'order', { window: 1280 }))).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(sectionsIn(aside(app)).map(isOpen)).toEqual(ONLY_GENERAL_OPEN);

      // Each section's controls: in it, in App's aside, drawn once in the page, none on the canvas.
      for (const title of TITLES) {
        await unfold(app, () => aside(app), title);
        const section = sectionIn(aside(app), title);
        for (const control of CONTROLS[title]) {
          const found = one(control.find(app.doc.body), `${control.what} in the page`);
          expect(section.contains(found), `${control.what} in the ${title} section`).toBe(true);
          expect(app.canvas().contains(found), `${control.what} not on the canvas`).toBe(false);
        }
      }
      // The figures keep their stat rows' style there: label left, value right.
      const figures = [...statRows(sectionIn(aside(app), 'Quality Trimming'), 'HQ Window'), ...statRows(sectionIn(aside(app), 'Trace Statistics'), 'Called Bases')];
      expect(figures.map((kv) => [cascaded(kv, 'display', { window: 1280 }), cascaded(kv, 'justify-content', { window: 1280 })]), 'stat rows styled').toEqual([['flex', 'space-between'], ['flex', 'space-between']]);
      // The pickers: the open read, with the session's DNA records offered (the sample library's
      // too); no reference chosen, any record but the read offered.
      const general = sectionIn(aside(app), 'General & Layout');
      const read = one(rowFields(general, 'Sequencing Read'), 'read picker');
      expect([read.localName, read.value]).toEqual(['select', FWD.id]);
      expect(read.options.map((o) => o.value)).toEqual(expect.arrayContaining([FWD.id, REV.id, PLAIN.id]));
      const reference = one(rowFields(general, 'Reference Plasmid'), 'reference picker');
      expect([reference.localName, reference.value, reference.options[0]?.value]).toEqual(['select', '', '']);
      expect(reference.options.map((o) => o.value)).toEqual(expect.arrayContaining([REV.id, PLAIN.id]));
      expect(reference.options.map((o) => o.value)).not.toContain(FWD.id);

      // The canvas draws the trace, and no aside, inspector shell or section of its own.
      traceSvg(app.canvas());
      expect(app.canvas().querySelectorAll('aside, .mbc-right-controls, .chromatogram-inspector, .mbc-pane-title, .mbc-accordion-section, .mbc-accordion-header'), 'no inspector on the canvas').toHaveLength(0);
      expect(app.all('aside.mbc-right-controls'), "App's column is the one inspector").toHaveLength(1);

      // Closed: the button stays and the trace with it; no column and no section is drawn anywhere.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Show Chromatogram View Controls Inspector');
      expect(app.inspectorAside(), 'no column while the inspector is closed').toBeNull();
      expect(app.all('.mbc-right-controls, .mbc-accordion-section'), 'no section drawn while closed').toHaveLength(0);
      for (const title of TITLES) for (const control of CONTROLS[title]) expect(control.find(app.doc.body), `${control.what} not drawn while closed`).toHaveLength(0);
      traceSvg(app.canvas());

      // Opened again: the six sections under the title.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorButton()?.getAttribute('aria-label')).toBe('Hide Chromatogram View Controls Inspector');
      expect(paneTitle(app)).toBe('Chromatogram View Controls');
      expect(sectionsIn(aside(app)).map(titleOf)).toEqual([...TITLES]);
    });
  });
});

// ─── AC2 ───

describe('Run assembly preview (AC2)', () => {
  it('keeps Run assembly preview on the canvas, beside the contig result, and runs it with the pre-trim set in the inspector', async () => {
    await withApp({}, async (app) => {
      await onTraceTab(app, [FWD, REV]);
      const run = () => one(buttonsNamed(app.doc.body, RUN), `${RUN} button`);
      const card = () => contigCard(app.canvas());
      const preTrim = () => one(checks(app.doc.body, PRE_TRIM), 'pre-trim toggle');
      /** Run assembly preview: on the canvas, in the contig card's header, and not in the inspector. */
      const onCanvas = (where: string) => {
        expect([app.canvas().contains(run()), cardHeader(card()).contains(run()), app.inspectorAside()?.contains(run()) ?? false], `${where}: ${RUN} in the contig card's header on the canvas`).toEqual([true, true, false]);
      };

      // One trace ticked: the button waits on the canvas, and says nothing has run.
      onCanvas('one trace ticked');
      expect(run().disabled).toBe(true);
      expect(contigResult(card())).toEqual({ badge: null, consensus: null, reads: null, note: 'Select at least two traces in the project table to assemble them. No assembly has been run.' });
      // The pre-trim toggle moved with Contig Assembly into the inspector.
      await unfold(app, () => aside(app), 'Contig Assembly');
      expect([sectionIn(aside(app), 'Contig Assembly').contains(preTrim()), app.canvas().contains(preTrim()), preTrim().checked]).toEqual([true, false, true]);

      // Two traces ticked in the project table (the second opens): Run is offered.
      await app.change(app.one(`input[type="checkbox"][aria-label="Select ${REV.name}"]`, 'the reverse read\'s tick box'), true);
      expect(app.activeTab()).toBe('sanger-contig');
      onCanvas('two traces ticked');
      expect(run().disabled).toBe(false);
      expect(contigResult(card()).note).toBe('No assembly has been run.');

      // Pressed with the pre-trim on: each read trimmed to its Q40 middle, the result beside the button.
      await unfold(app, () => aside(app), 'Contig Assembly');
      expect(preTrim().checked, 'the pre-trim on').toBe(true);
      await app.click(run());
      onCanvas('after a run');
      expect(contigResult(card())).toEqual({
        badge: 'Mott quality pre-trim on', consensus: '370 bp (2 reads)', note: null,
        reads: [[FWD.name, '300 / 270 bp'], [REV.name, '300 / 270 bp']],
      });

      // A changed selection drops the result. Ticked again (the forward read opens afresh, its
      // pre-trim on), nothing runs until Run is pressed.
      const fwdTick = () => app.one(`input[type="checkbox"][aria-label="Select ${FWD.name}"]`, 'the forward read\'s tick box');
      await app.change(fwdTick(), false);
      expect([run().disabled, contigResult(card()).consensus, contigResult(card()).note]).toEqual([true, null, 'Select at least two traces in the project table to assemble them. No assembly has been run.']);
      await app.change(fwdTick(), true);
      expect([run().disabled, contigResult(card()).consensus, contigResult(card()).note]).toEqual([false, null, 'No assembly has been run.']);

      // Pressed with the pre-trim cleared in the inspector: the raw reads, whole.
      await unfold(app, () => aside(app), 'Contig Assembly');
      expect(preTrim().checked, 'the pre-trim on').toBe(true);
      await app.change(preTrim(), false);
      expect(contigResult(card()).consensus, 'clearing the toggle runs nothing').toBeNull();
      await app.click(run());
      onCanvas('after the raw run');
      expect(contigResult(card())).toEqual({
        badge: 'Raw reads (no pre-trim)', consensus: '400 bp (2 reads)', note: null,
        reads: [[FWD.name, '300 / 300 bp'], [REV.name, '300 / 300 bp']],
      });

      // With the inspector closed the button stays on the canvas, beside the result.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorAside()).toBeNull();
      expect(checks(app.doc.body, PRE_TRIM), 'the toggle is not drawn while closed').toHaveLength(0);
      onCanvas('inspector closed');
      expect(contigResult(card()).badge).toBe('Raw reads (no pre-trim)');
    });
  });
});

// ─── AC3 ───

describe('the trace driven from the inspector (AC3)', () => {
  it('drives the trace from the inspector and keeps its state while the inspector is closed', async () => {
    await withApp({}, async (app) => {
      await onTraceTab(app, [FWD, REV]);
      const svg = () => traceSvg(app.canvas());
      const field = (title: Title, control: Control) => {
        const found = one(control.find(app.doc.body), control.what);
        expect(sectionIn(aside(app), title).contains(found), `${control.what} in the ${title} section`).toBe(true);
        return found;
      };
      const gain = () => field('Display & Color Scheme', row('Y-Gain'));
      const thin = () => field('Display & Color Scheme', check('Thin Lines'));
      const channel = (dye: string) => field('Trace Channels (4-Dye)', { what: `the ${dye} channel`, find: (s) => channelButtons(s, dye) });
      const cutoff = () => field('Quality Trimming', row('Error Cutoff P(err)'));
      const preTrim = () => field('Contig Assembly', check(PRE_TRIM));
      const windowStart = () => field('General & Layout', row('Window Start Base'));
      const reference = () => field('General & Layout', row('Reference Plasmid'));
      const mottBadge = () => words(app.canvas().querySelectorAll('.badge-accent').find((b) => b.textContent.startsWith('P(err) cutoff'))?.textContent ?? '');

      // Every dye drawn with its shading; at Y-Gain 1.0 each dye's tallest peak fills the 142-unit plot.
      await unfold(app, () => aside(app), 'Display & Color Scheme');
      await unfold(app, () => aside(app), 'Trace Channels (4-Dye)');
      for (const dye of 'ACGT') expect([curves(svg(), dye).length, shades(svg(), dye).length], `${dye} drawn`).toEqual([1, 1]);
      expect(rowCaption(gain())).toBe('Y-Gain (1.0×):');
      const full = Object.fromEntries([...'CGT'].map((dye) => [dye, peakHeight(curves(svg(), dye)[0])]));
      expect(full).toEqual({ C: 142, G: 142, T: 142 });

      // Unticking A in the inspector removes its curve and its shading; the other dyes stay.
      expect(channel('A').getAttribute('aria-pressed')).toBe('true');
      await app.click(channel('A'));
      expect(channel('A').getAttribute('aria-pressed')).toBe('false');
      expect([curves(svg(), 'A').length, shades(svg(), 'A').length], 'A hidden').toEqual([0, 0]);
      for (const dye of 'CGT') expect([curves(svg(), dye).length, shades(svg(), dye).length], `${dye} still drawn`).toEqual([1, 1]);

      // Y-Gain 0.5 in the inspector halves every peak.
      await app.change(gain(), '0.5');
      expect(rowCaption(gain())).toBe('Y-Gain (0.5×):');
      for (const dye of 'CGT') expect(peakHeight(curves(svg(), dye)[0]) / full[dye], `${dye} at half height`).toBeCloseTo(0.5, 3);

      // More values, each from its section: thin lines, the window, a reference, a cutoff, the pre-trim.
      await app.change(thin(), true);
      expect(curves(svg(), 'C')[0].getAttribute('stroke-width'), 'thin curves').toBe('1.1');
      await app.change(windowStart(), '20');
      expect(windowReadout(app)).toBe('Window: 21..65 of 300 bp');
      await app.change(reference(), REV.id);
      expect(app.canvas().textContent.includes(`Reference: ${REV.name}`), 'the read compared against the reference').toBe(true);
      await unfold(app, () => aside(app), 'Quality Trimming');
      await app.change(cutoff(), '0.01');
      expect(mottBadge()).toBe('P(err) cutoff 0.01');
      await unfold(app, () => aside(app), 'Contig Assembly');
      await app.change(preTrim(), false);
      // General & Layout folded, Trace Statistics left folded.
      await app.click(headerOf(sectionIn(aside(app), 'General & Layout')));
      const openState = [false, true, true, true, true, false];
      expect(sectionsIn(aside(app)).map(isOpen)).toEqual(openState);

      /** The trace as the settings above draw it. */
      const traceAsSet = (where: string) => {
        expect([curves(svg(), 'A').length, shades(svg(), 'A').length], `${where}: A hidden`).toEqual([0, 0]);
        for (const dye of 'CGT') expect(peakHeight(curves(svg(), dye)[0]) / full[dye], `${where}: ${dye} at half height`).toBeCloseTo(0.5, 3);
        expect(curves(svg(), 'C')[0].getAttribute('stroke-width'), `${where}: thin curves`).toBe('1.1');
        expect(windowReadout(app), where).toBe('Window: 21..65 of 300 bp');
        expect(mottBadge(), where).toBe('P(err) cutoff 0.01');
        expect(app.canvas().textContent.includes(`Reference: ${REV.name}`), `${where}: the reference`).toBe(true);
      };
      traceAsSet('set');

      // Closed: no section drawn, the trace keeps every setting.
      await app.click(app.inspectorButton()!);
      expect(app.inspectorAside()).toBeNull();
      expect(app.all('.mbc-accordion-section')).toHaveLength(0);
      traceAsSet('inspector closed');

      // Opened again: each section open or folded as it was, each value as set.
      await app.click(app.inspectorButton()!);
      expect(sectionsIn(aside(app)).map(titleOf)).toEqual([...TITLES]);
      expect(sectionsIn(aside(app)).map(isOpen), 'each section as it was').toEqual(openState);
      expect([gain().value, rowCaption(gain()), thin().checked, cutoff().value, preTrim().checked]).toEqual(['0.5', 'Y-Gain (0.5×):', true, '0.01', false]);
      expect([...'ACGT'].map((dye) => channel(dye).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'true', 'true']);
      await unfold(app, () => aside(app), 'General & Layout');
      expect([one(rowFields(aside(app), 'Sequencing Read'), 'read picker').value, reference().value, windowStart().value]).toEqual([FWD.id, REV.id, '20']);
      traceAsSet('inspector opened again');
    });
  });
});

// ─── AC4 ───

describe('the shared width and the note styles (AC4)', () => {
  it('gives the chromatogram the shared width and its notes their caption style', async () => {
    await withApp({}, async (app) => {
      await onTraceTab(app, [FWD, PLAIN]);
      const view: CascadeView = { window: 1280, height: 800 };

      // The studio draws neither its has-trace-inspector grid nor its fixed inspector width: its
      // wrapper is the trace column alone, a flex column, and nothing sets --mbc-trace-inspector-width.
      const canvas = app.canvas();
      const wrapper = one(app.all('.chromatogram-studio-wrapper'), 'studio wrapper');
      expect(wrapper.parentElement === canvas, 'the studio fills the canvas').toBe(true);
      expect(wrapper.classList.contains('has-trace-inspector'), 'no has-trace-inspector grid').toBe(false);
      expect(wrapper.children.map((c) => c.getAttribute('class')), 'the trace column alone').toEqual(['chromatogram-studio-main']);
      expect([cascaded(wrapper, 'display', view), cascaded(wrapper, 'grid-template-columns', view)]).toEqual(['flex', undefined]);
      for (const el of [canvas, wrapper, wrapper.children[0]]) expect(cascaded(el, '--mbc-trace-inspector-width', view), `no fixed width on ${el.getAttribute('class')}`).toBeUndefined();
      expect(app.all('.chromatogram-inspector'), "no studio aside").toHaveLength(0);

      // The panel takes App's shared width, the body split's third track, and its resizer.
      const split = app.bodySplit();
      const resizer = split.children[1];
      const width = Number(resizer.getAttribute('aria-valuenow'));
      expect(gridTracks(cascaded(split, 'grid-template-columns', view)!)).toEqual(['minmax(0, 1fr)', '5px', 'var(--mbc-inspector-width, 288px)']);
      expect(cascaded(split, '--mbc-inspector-width', view)).toBe(`${width}px`);
      resizer.focus();
      await app.press('ArrowLeft');
      expect([app.bodySplit().children[1].getAttribute('aria-valuenow'), cascaded(app.bodySplit(), '--mbc-inspector-width', view)], 'widened by the resizer').toEqual([String(width + 16), `${width + 16}px`]);
      expect(sectionsIn(aside(app)).map(titleOf)).toEqual([...TITLES]);

      // The section notes keep their caption style in App's aside.
      const CAPTION = ['var(--font-size-caption)', 'var(--mbc-text-secondary)', '0', '0'];
      const style = (note: LiveElement) => ['font-size', 'color', 'margin-top', 'margin-bottom'].map((p) => cascaded(note, p, view));
      await unfold(app, () => aside(app), 'Trace Channels (4-Dye)');
      await unfold(app, () => aside(app), 'Contig Assembly');
      const notes = aside(app).querySelectorAll('.mbc-accordion-note');
      expect(notes.map((n) => words(n.textContent))).toEqual([
        'Hidden channels are removed from both the curves and their shading.',
        '1 DNA trace selected in the project table. Select at least two. The assembly uses every selected trace, and the result names each read it left out or cut.',
      ]);
      for (const note of notes) expect(style(note), words(note.textContent)).toEqual(CAPTION);
      // A record with no trace: no channels to choose, and the Quality Trimming note.
      await app.change(one(rowFields(aside(app), 'Sequencing Read'), 'read picker'), PLAIN.id);
      expect(sectionsIn(aside(app)).map(titleOf), 'no Trace Channels section without a trace').toEqual(TITLES.filter((t) => t !== 'Trace Channels (4-Dye)'));
      await unfold(app, () => aside(app), 'Quality Trimming');
      const trimNote = one(sectionIn(aside(app), 'Quality Trimming').querySelectorAll('.mbc-accordion-note'), 'trimming note');
      expect(words(trimNote.textContent)).toBe('No quality values, so there is nothing to trim.');
      expect(style(trimNote)).toEqual(CAPTION);

      // The empty-comparison note names the inspector.
      const compare = one(app.canvas().querySelectorAll('p.studio-panel-note').filter((p) => p.textContent.startsWith('Choose a reference')), 'empty-comparison note');
      expect(words(compare.textContent)).toBe('Choose a reference in the Chromatogram View Controls inspector to compare this read. No reference comparison has been run.');
      expect(app.canvas().textContent.includes('sidebar'), 'no sidebar named on the canvas').toBe(false);
    });
  });
});

// ─── AC5 ───

describe('the narrow-window rule (AC5)', () => {
  it('keeps the trace beside the inspector at the 1100px minimum window', async () => {
    await withApp({ width: 1100, height: 720 }, async (app) => {
      await onTraceTab(app, [FWD, REV]);
      const at = (window: number): CascadeView => ({ window, height: 720 });

      // App's column beside the trace: three tracks, nothing stacks them.
      const split = app.bodySplit();
      expect([cascaded(split, 'display', at(1100)), gridTracks(cascaded(split, 'grid-template-columns', at(1100))!)]).toEqual(['grid', ['minmax(0, 1fr)', '5px', 'var(--mbc-inspector-width, 288px)']]);
      for (const prop of ['grid-template-rows', 'grid-template-areas', 'grid-auto-flow']) expect(cascaded(split, prop, at(1100)), `no ${prop} stacks it`).toBeUndefined();
      expect(split.children.map((c) => c.localName)).toEqual(['div', 'div', 'aside']);
      expect(split.children[0].contains(app.canvas())).toBe(true);
      expect(sectionsIn(split.children[2]).map(titleOf), 'the sections in the column beside the trace').toEqual([...TITLES]);

      // The trace fills the canvas, which does not scroll, and scrolls on its own: at 1100px, and
      // either side of the 1150px rule.
      const canvas = app.canvas();
      const wrapper = canvas.children[0];
      const main = wrapper.children[0];
      expect([wrapper.getAttribute('class')?.split(' ')[0], main.getAttribute('class')]).toEqual(['chromatogram-studio-wrapper', 'chromatogram-studio-main']);
      for (const w of [1100, 1150, 1151, 1280]) {
        expect([cascaded(canvas, 'overflow-x', at(w)), cascaded(canvas, 'overflow-y', at(w))], `${w}px: the canvas does not scroll`).toEqual(['hidden', 'hidden']);
        expect([cascaded(wrapper, 'display', at(w)), cascaded(wrapper, 'grid-template-columns', at(w)), cascaded(wrapper, 'block-size', at(w)), cascaded(wrapper, 'min-block-size', at(w))], `${w}px: the trace fills the canvas`)
          .toEqual(['flex', undefined, '100%', '0']);
        expect([cascaded(main, 'overflow-y', at(w)), cascaded(main, 'min-block-size', at(w))], `${w}px: the trace scrolls on its own`).toEqual(['auto', '0']);
      }

      // Drawn on its own, the 1150px rule still stacks its aside under the trace and hands scrolling
      // back to the canvas, and above 1150px keeps the two columns.
      await drawnOnItsOwn(app, 'mbc-viewer-canvas', async (probe) => {
        const own = probe.children[0];
        const ownMain = own.children[0];
        expect([own.getAttribute('class'), ownMain.getAttribute('class'), own.children[1].getAttribute('class')]).toEqual(['chromatogram-studio-wrapper has-trace-inspector', 'chromatogram-studio-main', 'mbc-right-controls chromatogram-inspector']);
        for (const w of [1100, 1150]) {
          expect([cascaded(probe, 'overflow-y', at(w)), gridTracks(cascaded(own, 'grid-template-columns', at(w))!), cascaded(own, 'block-size', at(w)), cascaded(ownMain, 'overflow-y', at(w))], `${w}px on its own: stacked`)
            .toEqual(['auto', ['minmax(0, 1fr)'], 'auto', 'visible']);
        }
        for (const w of [1151, 1280]) {
          expect([cascaded(probe, 'overflow-y', at(w)), gridTracks(cascaded(own, 'grid-template-columns', at(w))!), cascaded(own, 'block-size', at(w)), cascaded(ownMain, 'overflow-y', at(w))], `${w}px on its own: two columns`)
            .toEqual(['hidden', ['minmax(0, 1fr)', 'var(--mbc-trace-inspector-width, 288px)'], '100%', 'auto']);
        }
      });
    });
  });
});

// ─── AC7 ───

describe('the studio drawn on its own (AC7)', () => {
  it('keeps its aside when drawn on its own', async () => {
    await withApp({}, async (app) => {
      await onTraceTab(app, [FWD, REV]);
      await drawnOnItsOwn(app, '', async (probe) => {
        // Its wrapper holds the trace and its own aside, the inspector shell it had before.
        const own = one(probe.querySelectorAll('.chromatogram-studio-wrapper'), 'studio wrapper');
        expect(own.getAttribute('class')).toBe('chromatogram-studio-wrapper has-trace-inspector');
        const [main, ownAside] = own.children;
        expect([own.children.length, main.getAttribute('class'), ownAside.localName, ownAside.getAttribute('class'), ownAside.getAttribute('aria-label')])
          .toEqual([2, 'chromatogram-studio-main', 'aside', 'mbc-right-controls chromatogram-inspector', 'Chromatogram View Controls']);
        expect(ownAside.children.map((c) => c.getAttribute('class'))).toEqual(['mbc-pane-title', 'mbc-accordion-scroll']);
        expect(words(ownAside.children[0].textContent)).toBe('Chromatogram View Controls');
        expect(probe.querySelectorAll('.mbc-inspector-sections'), 'no shared inspector body').toHaveLength(0);
        const scroll = ownAside.children[1];
        expect(sectionsIn(probe).every((s) => s.parentElement === scroll), 'every section in its own aside').toBe(true);
        expect(sectionsIn(probe).map(titleOf)).toEqual([...TITLES]);
        expect(sectionsIn(probe).map(isOpen)).toEqual(ONLY_GENERAL_OPEN);

        // Each control: drawn once, in its section of the aside, not in the trace column.
        for (const title of TITLES) {
          await unfold(app, () => probe, title);
          const section = sectionIn(probe, title);
          for (const control of [...CONTROLS[title], ...(title === 'Contig Assembly' ? [{ what: RUN, find: (s: LiveElement) => buttonsNamed(s, RUN) }] : [])]) {
            const found = one(control.find(probe), `${control.what} on its own`);
            expect([section.contains(found), ownAside.contains(found), main.contains(found)], `${control.what} in its ${title} section`).toEqual([true, true, false]);
          }
        }
        const figures = [...statRows(sectionIn(probe, 'Quality Trimming'), 'HQ Window'), ...statRows(sectionIn(probe, 'Trace Statistics'), 'Called Bases')];
        expect(figures.map((kv) => [cascaded(kv, 'display', { window: 1280 }), cascaded(kv, 'justify-content', { window: 1280 })]), 'stat rows styled').toEqual([['flex', 'space-between'], ['flex', 'space-between']]);
        // No contig card on the canvas before a run; the empty-comparison note names the sidebar, as before.
        expect(main.querySelectorAll('h4').filter((h) => words(h.textContent) === CONTIG_CARD), 'no contig card before a run').toHaveLength(0);
        expect(main.querySelectorAll('p.studio-panel-note').map((p) => words(p.textContent))).toEqual(['Choose a reference in the Chromatogram View Controls sidebar to compare this read. No reference comparison has been run.']);

        // Run assembly preview in the aside runs the assembly; the result on the canvas has no button of its own.
        await app.click(one(buttonsNamed(ownAside, RUN), RUN));
        const result = contigCard(main);
        expect(contigResult(result)).toEqual({
          badge: 'Mott quality pre-trim on', consensus: '370 bp (2 reads)', note: null,
          reads: [[FWD.name, '300 / 270 bp'], [REV.name, '300 / 270 bp']],
        });
        expect(buttonsNamed(result, RUN), 'no Run button beside the result on its own').toHaveLength(0);
        expect(buttonsNamed(probe, RUN), 'one Run button, in the aside').toHaveLength(1);

        // App's column still holds its own studio's six sections alone: nothing from the studio drawn on its own.
        expect(sectionsIn(aside(app)).map(titleOf)).toEqual([...TITLES]);
      });
    });
  });
});
