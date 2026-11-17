// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CM8J: the chromatogram zooms its base window around the hovered peak, and the 3D Calpha
 * view zooms through the shared wheel helper (CR-01M7CCSD).
 *
 * Every chromatogram check mounts the real App over the live DOM (the harness of
 * chromatogramInspector.test.tsx) with reads built here: Sanger traces whose peaks crowd and spread
 * out in runs (5 to 22 samples a base, from a fixed seed), so a base's drawn x is far off the even grid,
 * and an NGS read with qualities and no trace channels, which the studio draws as its quality strip.
 * The live DOM has no layout, so the test gives each chromatogram svg a 1200 px wide box: the
 * 830-unit view is drawn "meet" at 1.2 px a unit, 102 px in from the left. A wheel is dispatched on
 * the svg as a browser would and the page settles (its animation frames run). React 18 attaches its
 * onWheel passively, and a passive listener cannot cancel an event in the live DOM, so a wheel the
 * view takes reading defaultPrevented true proves a native non-passive listener.
 *
 * The 3D checks render ProteinStructure3DViewer alone in a React root of its own in the App's
 * window (as proteinCaps.test.tsx renders it alone), with a canvas whose 2D context records the
 * points it is asked to draw.
 *
 * Wrong implementations, and the check that fails for each: a React onWheel (its preventDefault
 * does nothing, AC1 and AC5); a plain wheel taken on the trace (AC1); the window bounds or the read
 * length hold missed, or the new window left out of the viewport call, the prev/next steps, the
 * overview rect or the jump centring (AC1); a zoom about the window's start or centre, or a pointer
 * read without the svg's letterbox (AC2); a zoom that reruns the trim, drops the contig or changes
 * the read or reference (AC3); a label that does not follow the window (AC4); the 0.92 or 1.08
 * notch, a horizontal wheel zooming, a zoom about the pointer or one that moves the rotation, Reset
 * not returning 100% (AC5, AC6); a listener on the shared .protein-3d-canvas-viewport (AC7).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import type { PdbCaAtom } from '../core/genomicsAndStructureSuite';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { dispatchLiveEvent, LiveElement, type LiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 90_000 });

// ─── Reads built in the test ───

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
const draw = rng(0x8c3a);
const TEMPLATE = Array.from({ length: 400 }, () => 'ACGT'[Math.floor(draw() * 4)]).join('');
/** Q5 at the 15 bases at each end, Q40 between: the Mott trim keeps the 270 in the middle. */
const PHRED = Array.from({ length: 300 }, (_, i) => (i < 15 || i >= 285 ? 5 : 40));

const base = (id: string, name: string, sequence: string): SequenceDocument => ({
  id, name, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  folder: 'Sequencing Reads (Sanger/NGS)', documentKind: 'trace',
});

/**
 * A Sanger trace with these calls, each under a clean peak. The peaks come in runs of 6 to 14 bases
 * spaced 5 or 6 samples apart, then as many spaced 18 to 22 apart, so within any window the bases
 * crowd and spread out: a zoom placed on the even grid misses the base under the pointer by several.
 */
function traceDoc(id: string, name: string, calls: string, phredScores: number[], seed: number): SequenceDocument {
  const step = rng(seed);
  const peakLocations: number[] = [];
  let at = 12;
  let run = 0;
  let tight = true;
  for (let i = 0; i < calls.length; i++) {
    if (run === 0) { run = 6 + Math.floor(step() * 9); tight = !tight; }
    run--;
    peakLocations.push(at);
    at += tight ? 5 + Math.floor(step() * 2) : 18 + Math.floor(step() * 5);
  }
  const channels: Record<string, number[]> = {};
  for (const b of 'ACGT') channels[b] = new Array(at + 12).fill(0);
  peakLocations.forEach((p, i) => {
    for (let x = p - 2; x <= p + 2; x++) channels[calls[i]][x] = Math.round(1000 * Math.exp(-((x - p) ** 2) / 2));
  });
  return { ...base(id, name, calls), chromatogram: { traceA: channels.A, traceC: channels.C, traceG: channels.G, traceT: channels.T, peakLocations, phredScores, baseCalls: calls } };
}
const FWD = traceDoc('cm8j-fwd', 'CM8J_Fwd.ab1', TEMPLATE.slice(0, 300), PHRED, 0x51);
const REV = traceDoc('cm8j-rev', 'CM8J_Rev.ab1', reverseComplement(TEMPLATE.slice(100)), PHRED, 0x52);
/** An NGS read: 120 calls with qualities and no trace channels, so the studio draws its quality strip. */
const NGS_CALLS = TEMPLATE.slice(40, 160);
const NGS: SequenceDocument = {
  ...base('cm8j-ngs', 'CM8J_Read.fastq', NGS_CALLS),
  chromatogram: { traceA: [], traceC: [], traceG: [], traceT: [], peakLocations: [], phredScores: Array.from({ length: 120 }, (_, i) => 20 + (i % 20)), baseCalls: NGS_CALLS },
};
const PLAIN: SequenceDocument = { ...base('cm8j-plain', 'CM8J_Template.fasta', TEMPLATE), folder: 'Plasmids', documentKind: undefined };

// ─── The page ───

/** The svg's box: 1200 px wide and 1.2 px a unit high, so the 830-unit view is letterboxed 102 px a side. */
const BOX_W = 1200;
const K = 1.2;
const OX = (BOX_W - 830 * K) / 2;
const clientXOf = (viewX: number) => OX + viewX * K;
const layout: MountOptions['layout'] = (el) => {
  if (el.localName === 'svg' && el.classList.contains('chromatogram-svg')) {
    const h = Number((el.getAttribute('viewBox') ?? '0 0 830 150').split(' ')[3]);
    return { width: BOX_W, height: h * K };
  }
  if (el.localName === 'svg' && el.classList.contains('mbc-cockpit-horizon-svg')) return { width: 1000, height: 22 };
  if (el.localName === 'canvas') return { width: 600, height: 330 };
  return { width: 0, height: 0 };
};

async function withApp<T>(run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp({ layout });
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}
const onTraceTab = (app: AppHarness, docs: SequenceDocument[], active = docs[0]) =>
  app.restoreSession({ documents: docs, activeDocId: active.id, viewerTab: 'sanger-contig' });
const words = (s: string) => s.replace(/\s+/g, ' ').trim();
function one(found: LiveElement[], what: string): LiveElement {
  expect(found, `one ${what}`).toHaveLength(1);
  return found[0];
}

/** The drawing of the read on the canvas: the trace, or the quality strip, by its label. */
const TRACE_LABEL = /^Trace of bases (\d+) to (\d+)$/;
const STRIP_LABEL = /^Phred quality of bases (\d+) to (\d+)$/;
const drawing = (app: AppHarness, label: RegExp) =>
  one(app.canvas().querySelectorAll('svg.chromatogram-svg').filter((s) => label.test(s.getAttribute('aria-label') ?? '')), `svg labelled ${label}`);
/** The window the drawing's label names, 1-based and inclusive. */
function windowOf(svg: LiveElement, label: RegExp) {
  const m = label.exec(svg.getAttribute('aria-label') ?? '');
  expect(m, 'the drawing names its bases').not.toBeNull();
  const from = Number(m![1]);
  const to = Number(m![2]);
  return { from, to, size: to - from + 1 };
}
/** The base letters the drawing places, with their x in view units: one per base of the window. */
const letters = (svg: LiveElement) => svg.querySelectorAll('text').filter((t) => t.getAttribute('font-weight') === '700').map((t) => Number(t.getAttribute('x')));
/** The 1-based base whose drawn x is nearest view x `vx`. */
function baseUnder(svg: LiveElement, label: RegExp, vx: number): number {
  const xs = letters(svg);
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - vx) < Math.abs(xs[best] - vx)) best = i;
  return windowOf(svg, label).from + best;
}

/** Dispatches an event as the browser does, then lets the page settle (its animation frames run). */
async function fire(app: AppHarness, el: LiveElement, type: string, init: Record<string, unknown>): Promise<LiveEvent> {
  const ev = dispatchLiveEvent(el, type, { deltaX: 0, deltaY: 0, deltaMode: 0, ...init });
  await app.settle();
  return ev;
}
const horizon = (app: AppHarness) => one(app.canvas().querySelectorAll('svg.mbc-cockpit-horizon-svg'), 'quality horizon');
const windowRect = (app: AppHarness) => one(horizon(app).querySelectorAll('rect').filter((r) => r.getAttribute('stroke') === '#0072B2'), 'window rect');
/** Picks a read in the inspector's Sequencing Read picker. */
async function pickRead(app: AppHarness, id: string) {
  const row = one(app.inspectorAside()!.querySelectorAll('.mbc-control-row').filter((r) => words(r.children[0]?.textContent ?? '').startsWith('Sequencing Read')), 'read picker row');
  await app.change(one(row.querySelectorAll('select'), 'read picker'), id);
}

const READS = [
  { what: 'the trace', doc: FWD, label: TRACE_LABEL, length: 300, docs: [FWD, REV] },
  { what: 'the quality strip', doc: NGS, label: STRIP_LABEL, length: 120, docs: [NGS] },
] as const;

// ─── AC1 ───

describe('US-01M7CM8J AC1', () => {
  for (const read of READS) {
    it(`US-01M7CM8J AC1: a plain wheel scrolls ${read.what}; Ctrl/Cmd+wheel and a pinch change its window within 10 to 180 bases, held to the read, and every reader of the window follows`, async () => {
      await withApp(async (app) => {
        await onTraceTab(app, read.docs as unknown as SequenceDocument[]);
        const svg = () => drawing(app, read.label);
        const size = () => windowOf(svg(), read.label).size;
        expect(windowOf(svg(), read.label)).toEqual({ from: 1, to: 45, size: 45 });

        // A plain wheel is the page's: not taken, the window unchanged.
        const plain = await fire(app, svg(), 'wheel', { deltaY: -100, clientX: clientXOf(400) });
        expect([plain.defaultPrevented, size()]).toEqual([false, 45]);
        // A mostly horizontal wheel with Ctrl is a scroll too.
        const sideways = await fire(app, svg(), 'wheel', { deltaX: -300, deltaY: -100, ctrlKey: true, clientX: clientXOf(400) });
        expect([sideways.defaultPrevented, size()]).toEqual([false, 45]);

        // Ctrl+wheel, Cmd+wheel and a line-mode wheel zoom; the taken wheel is prevented.
        const ctrl = await fire(app, svg(), 'wheel', { deltaY: -100, ctrlKey: true, clientX: clientXOf(400) });
        expect([ctrl.defaultPrevented, size()]).toEqual([true, Math.round(45 / 1.08)]);
        const cmd = await fire(app, svg(), 'wheel', { deltaY: 100, metaKey: true, clientX: clientXOf(400) });
        expect([cmd.defaultPrevented, size()]).toEqual([true, 45]);
        const lines = await fire(app, svg(), 'wheel', { deltaY: -6.25, deltaMode: 1, ctrlKey: true, clientX: clientXOf(400) });
        expect([lines.defaultPrevented, size()]).toEqual([true, 42]);

        // Every reader of the window: the drawing places one letter a base, spread over the whole
        // 25..805 plot (the viewport call ran with the window too), the overview rect is as wide.
        const readers = () => {
          const n = size();
          const xs = letters(svg());
          const slot = 780 / n;
          return {
            letters: xs.length,
            spansPlot: xs[0] <= 25 + 1.5 * slot && xs[xs.length - 1] >= 805 - 1.5 * slot,
            rect: Number(windowRect(app).getAttribute('width')),
          };
        };
        expect(readers()).toEqual({ letters: 42, spansPlot: true, rect: Math.max(3, (42 / read.length) * 1000) });

        // Bounds: 10 bases in, 180 out, held to the read's length.
        for (let i = 0; i < 12; i++) await fire(app, svg(), 'wheel', { deltaY: -400, ctrlKey: true, clientX: clientXOf(400) });
        expect(size()).toBe(10);
        expect(readers()).toEqual({ letters: 10, spansPlot: true, rect: Math.max(3, (10 / read.length) * 1000) });
        for (let i = 0; i < 12; i++) await fire(app, svg(), 'wheel', { deltaY: 400, ctrlKey: true, clientX: clientXOf(400) });
        const widest = Math.min(180, read.length);
        expect(windowOf(svg(), read.label)).toEqual({ from: 1, to: widest, size: widest });
        expect(readers()).toEqual({ letters: widest, spansPlot: true, rect: Math.max(3, (widest / read.length) * 1000) });
        // One notch back in leaves the read-length hold at once.
        await fire(app, svg(), 'wheel', { deltaY: -100, ctrlKey: true, clientX: clientXOf(400) });
        expect(size()).toBe(Math.round(widest / 1.08));

        // A WebKit pinch: the window is the gesture's start window over its scale.
        const startSize = size();
        const start = await fire(app, svg(), 'gesturestart', { scale: 1, clientX: clientXOf(400) });
        const change = await fire(app, svg(), 'gesturechange', { scale: 2, clientX: clientXOf(400) });
        // A ctrl-flagged wheel a pinch sends while it is under way is taken but not applied again.
        const during = await fire(app, svg(), 'wheel', { deltaY: -100, ctrlKey: true, clientX: clientXOf(400) });
        const end = await fire(app, svg(), 'gestureend', { scale: 2, clientX: clientXOf(400) });
        expect([start.defaultPrevented, change.defaultPrevented, during.defaultPrevented, end.defaultPrevented]).toEqual([true, true, true, true]);
        expect(startSize).toBe(Math.round(widest / 1.08));
        expect(size()).toBe(Math.round(widest / 1.08 / 2));

        // The prev/next steps move by the window, and a click on the horizon centres the window.
        const n = size();
        await app.click(horizon(app), { clientX: 0 });
        horizon(app).focus();
        const before = windowOf(svg(), read.label).from;
        expect(before).toBe(1);
        await app.press('ArrowRight');
        expect(windowOf(svg(), read.label).from).toBe(before + n);
        await app.press('ArrowLeft');
        expect(windowOf(svg(), read.label).from).toBe(before);
        await app.click(horizon(app), { clientX: 500 });
        expect(windowOf(svg(), read.label).from).toBe(Math.round(0.5 * read.length) - Math.floor(n / 2));
        expect(Number(windowRect(app).getAttribute('width'))).toBe(Math.max(3, (n / read.length) * 1000));
      });
    });
  }
});

describe('US-01M7CM8J AC1', () => {
  it('US-01M7CM8J AC1: a read shorter than the 10-base floor is shown whole and its window rect fills the horizon', async () => {
    const calls = NGS_CALLS.slice(0, 8);
    const short: SequenceDocument = { ...NGS, id: 'cm8j-short', name: 'CM8J_Short.fastq', sequence: calls, chromatogram: { ...NGS.chromatogram!, phredScores: NGS.chromatogram!.phredScores.slice(0, 8), baseCalls: calls } };
    await withApp(async (app) => {
      await onTraceTab(app, [short]);
      const svg = () => drawing(app, STRIP_LABEL);
      expect([svg().getAttribute('aria-label'), Number(windowRect(app).getAttribute('width'))]).toEqual(['Phred quality of bases 1 to 8', 1000]);
      for (const deltaY of [-400, 400, 400]) {
        expect((await fire(app, svg(), 'wheel', { deltaY, ctrlKey: true, clientX: clientXOf(400) })).defaultPrevented).toBe(true);
        expect([svg().getAttribute('aria-label'), letters(svg()).length, Number(windowRect(app).getAttribute('width'))]).toEqual(['Phred quality of bases 1 to 8', 8, 1000]);
      }
    });
  });

  it('US-01M7CM8J AC1: the exported chromatogramWheelStep takes Ctrl/Cmd and line-mode wheels and leaves a plain one', async () => {
    await withApp(async () => {
      const { chromatogramWheelStep } = await import('../components/ChromatogramAndContigStudio');
      const context = { readLength: 300, rect: { left: 0, top: 0, width: BOX_W, height: 150 * K }, viewHeight: 150 };
      const view = { offset: 100, span: 45 };
      const ev = { deltaX: 0, deltaY: -6.25, deltaMode: 1, ctrlKey: true, metaKey: false, altKey: false, clientX: clientXOf(415), clientY: 10 };
      const step = chromatogramWheelStep(ev, view, context);
      expect(step.handled).toBe(true);
      expect(step.view.span).toBeCloseTo(45 / 1.08, 9);
      expect(chromatogramWheelStep({ ...ev, ctrlKey: false }, view, context)).toEqual({ handled: false, view });
      expect(chromatogramWheelStep({ ...ev, ctrlKey: false, metaKey: true, deltaY: 400, deltaMode: 0 }, view, context).view.span).toBeCloseTo(45 * 1.08 ** 4, 9);
    });
  });
});

// ─── AC2 ───

describe('US-01M7CM8J AC2', () => {
  for (const read of READS) {
    const exact = read.label === STRIP_LABEL;
    it(`US-01M7CM8J AC2: the base under the pointer stays under it on ${read.what} (${exact ? 'exactly, on the even grid' : 'within one base'}), unless the window is held at an end`, async () => {
      await withApp(async (app) => {
        await onTraceTab(app, read.docs as unknown as SequenceDocument[]);
        const svg = () => drawing(app, read.label);
        // Into the middle of the read first, so the window is free to move both ways.
        await app.click(horizon(app), { clientX: 500 });
        const steps: [number, number][] = [[60, -100], [300, -250], [700, 100], [790, -60], [415, 300], [120, 150], [500, -400], [37, -37], [640, 220]];
        if (read.length > 150) steps.push([250, 400], [710, -120]);
        for (const [vx, deltaY] of steps) {
          const was = baseUnder(svg(), read.label, vx);
          const ev = await fire(app, svg(), 'wheel', { deltaY, ctrlKey: true, clientX: clientXOf(vx) });
          expect(ev.defaultPrevented).toBe(true);
          const w = windowOf(svg(), read.label);
          expect(w.from > 1 && w.to < read.length, `window ${w.from}..${w.to} not held at an end`).toBe(true);
          const now = baseUnder(svg(), read.label, vx);
          if (exact) expect(now, `x ${vx}, delta ${deltaY}`).toBe(was);
          else expect(Math.abs(now - was), `x ${vx}, delta ${deltaY}: base ${was} then ${now}`).toBeLessThanOrEqual(1);
        }

        // Held at the start: zoomed out from the first window it stays at base 1.
        await app.click(horizon(app), { clientX: 0 });
        expect(windowOf(svg(), read.label).from).toBe(1);
        await fire(app, svg(), 'wheel', { deltaY: 200, ctrlKey: true, clientX: clientXOf(600) });
        expect(windowOf(svg(), read.label).from).toBe(1);
        // Held at the end: zoomed out from the last window it still ends at the read's last base.
        await app.click(horizon(app), { clientX: 1000 });
        expect(windowOf(svg(), read.label).to).toBe(read.length);
        await fire(app, svg(), 'wheel', { deltaY: 200, ctrlKey: true, clientX: clientXOf(100) });
        expect(windowOf(svg(), read.label).to).toBe(read.length);
      });
    });
  }
});

// ─── AC3 ───

describe('US-01M7CM8J AC3', () => {
  it('US-01M7CM8J AC3: a chromatogram zoom leaves the Mott trim window, the contig and the read and reference as they were', async () => {
    await withApp(async (app) => {
      await onTraceTab(app, [FWD, REV, PLAIN]);
      const pickerRow = (caption: string) => one(app.inspectorAside()!.querySelectorAll('.mbc-control-row').filter((r) => words(r.children[0]?.textContent ?? '').startsWith(caption)), `${caption} row`);
      const picker = (caption: string) => one(pickerRow(caption).querySelectorAll('select'), caption);
      // Both traces ticked in the project table (the reverse read then opens), the forward read
      // picked again, a reference picked, and the contig assembled.
      await app.change(app.one(`input[type="checkbox"][aria-label="Select ${REV.name}"]`, "the reverse read's tick box"), true);
      await app.change(picker('Sequencing Read'), FWD.id);
      await app.change(picker('Reference Plasmid'), PLAIN.id);
      await app.click(one(app.canvas().querySelectorAll('button').filter((b) => words(b.textContent) === 'Run assembly preview'), 'Run assembly preview'));
      const state = () => {
        const card = app.canvas().querySelectorAll('.contig-variants-section').find((c) => c.querySelectorAll('.kpi-label').some((l) => words(l.textContent) === 'POA Consensus Length'));
        return {
          trim: horizon(app).querySelectorAll('title').map((t) => words(t.textContent)).filter((t) => t.startsWith('High-quality trim window')),
          mott: app.canvas().querySelectorAll('.badge-accent').map((b) => words(b.textContent)).filter((t) => t.includes('P(err) cutoff')),
          contig: card ? words(card.textContent) : null,
          read: (picker('Sequencing Read') as unknown as { value: string }).value,
          reference: (picker('Reference Plasmid') as unknown as { value: string }).value,
        };
      };
      const before = state();
      expect(before.trim).toEqual(['High-quality trim window 16..285 bp (P(err) cutoff 0.05)']);
      expect(before.contig, 'the contig was assembled').not.toBeNull();
      expect([(picker('Sequencing Read') as unknown as { value: string }).value, before.reference]).toEqual([FWD.id, PLAIN.id]);
      const svg = () => drawing(app, TRACE_LABEL);
      await app.click(horizon(app), { clientX: 500 });
      for (const [vx, deltaY] of [[200, -300], [600, 400], [400, 400], [100, -100]]) {
        const ev = await fire(app, svg(), 'wheel', { deltaY, ctrlKey: true, clientX: clientXOf(vx) });
        expect(ev.defaultPrevented).toBe(true);
        expect(state()).toEqual(before);
      }
      await fire(app, svg(), 'gesturestart', { scale: 1, clientX: clientXOf(300) });
      await fire(app, svg(), 'gesturechange', { scale: 3, clientX: clientXOf(300) });
      await fire(app, svg(), 'gestureend', { scale: 3, clientX: clientXOf(300) });
      expect(windowOf(svg(), TRACE_LABEL).size).not.toBe(45);
      expect(state()).toEqual(before);
    });
  });
});

// ─── AC4 ───

describe('US-01M7CM8J AC4', () => {
  it("US-01M7CM8J AC4: the trace's label and the quality strip's label name the window as it is zoomed", async () => {
    await withApp(async (app) => {
      await onTraceTab(app, [FWD, NGS]);
      // The zoom is a view setting: it stays as it is when another read is picked.
      let span = 45;
      for (const read of READS) {
        await pickRead(app, read.doc.id);
        const svg = () => drawing(app, read.label);
        const label = () => svg().getAttribute('aria-label');
        const other = read.label === TRACE_LABEL ? STRIP_LABEL : TRACE_LABEL;
        expect(app.canvas().querySelectorAll('svg.chromatogram-svg').filter((s) => other.test(s.getAttribute('aria-label') ?? '')), 'only this read drawn').toHaveLength(0);
        const name = read.label === TRACE_LABEL ? 'Trace' : 'Phred quality';
        const n = Math.round(span);
        expect(label()).toBe(`${name} of bases 1 to ${n}`);
        await app.click(horizon(app), { clientX: 500 });
        const from = Math.round(read.length / 2) - Math.floor(n / 2);
        expect(label()).toBe(`${name} of bases ${from} to ${from + n - 1}`);
        await fire(app, svg(), 'wheel', { deltaY: -400, ctrlKey: true, clientX: clientXOf(415) });
        span /= 1.08 ** 4;
        const zoomed = windowOf(svg(), read.label);
        expect(zoomed.size).toBe(Math.round(span));
        expect(label()).toBe(`${name} of bases ${zoomed.from} to ${zoomed.from + zoomed.size - 1}`);
        // The drawing's letters are the bases the label names.
        expect(letters(svg())).toHaveLength(zoomed.size);
        // One event carries at most four notches (the shared helper's clamp), so eight take two.
        await fire(app, svg(), 'wheel', { deltaY: 400, ctrlKey: true, clientX: clientXOf(415) });
        await fire(app, svg(), 'wheel', { deltaY: 400, ctrlKey: true, clientX: clientXOf(415) });
        span *= 1.08 ** 8;
        const out = windowOf(svg(), read.label);
        expect(out.size).toBe(Math.round(span));
        expect(out.size).not.toBe(n);
        expect(label()).toBe(`${name} of bases ${out.from} to ${out.to}`);
        expect(letters(svg())).toHaveLength(out.size);
      }
    });
  });
});

// ─── BG-01M7ME5A ───

/** A 120-base Sanger trace: shorter than the 180-base widest window, so the read holds the window. */
const SHORT_TRACE = traceDoc('bg5a-short', 'BG5A_Short.ab1', TEMPLATE.slice(200, 320), PHRED.slice(0, 120), 0x53);

describe('BG-01M7ME5A AC1', () => {
  // Wrong implementations: a step that starts from the stored 180-base span (the first notch gives
  // 166.7, held to 120, and nothing moves); a fix to the wheel step that leaves the pinch's start
  // span stale (180 / 1.1 = 163.6, held to 120 again). Each path is checked on a fresh switch.
  it('BG-01M7ME5A AC1: the first notch after a read change to a shorter read narrows the trace window, by Ctrl/Cmd+wheel and by a WebKit pinch', async () => {
    await withApp(async (app) => {
      await onTraceTab(app, [FWD, SHORT_TRACE]);
      const svg = () => drawing(app, TRACE_LABEL);
      const size = () => windowOf(svg(), TRACE_LABEL).size;
      const widenTo180OnFwd = async () => {
        await pickRead(app, FWD.id);
        for (let i = 0; i < 6; i++) await fire(app, svg(), 'wheel', { deltaY: 400, ctrlKey: true, clientX: clientXOf(400) });
        expect(size(), 'the 300-base read zoomed out to 180').toBe(180);
        await pickRead(app, SHORT_TRACE.id);
        expect(size(), 'the 120-base read holds the window').toBe(120);
      };

      // Ctrl+wheel: the first notch in after the switch narrows the window.
      await widenTo180OnFwd();
      const notch = await fire(app, svg(), 'wheel', { deltaY: -100, ctrlKey: true, clientX: clientXOf(400) });
      expect(notch.defaultPrevented).toBe(true);
      expect(size()).toBeLessThan(120);
      expect(size()).toBe(Math.round(120 / 1.08));

      // A WebKit pinch started after the switch: its first change narrows the window.
      await widenTo180OnFwd();
      await fire(app, svg(), 'gesturestart', { scale: 1, clientX: clientXOf(400) });
      const change = await fire(app, svg(), 'gesturechange', { scale: 1.1, clientX: clientXOf(400) });
      expect(change.defaultPrevented).toBe(true);
      expect(size()).toBeLessThan(120);
      expect(size()).toBe(Math.round(120 / 1.1));
      await fire(app, svg(), 'gestureend', { scale: 1.1, clientX: clientXOf(400) });
      expect(windowOf(svg(), TRACE_LABEL).to).toBeLessThanOrEqual(120);
    });
  });
});

// ─── The 3D viewer, alone ───

/** A 40-residue helix about the z axis. */
const ATOMS: PdbCaAtom[] = Array.from({ length: 40 }, (_, i) => ({
  serial: i + 1, chainId: 'A', resSeq: i + 1, resName: 'ALA', secondaryStructure: 'H',
  x: 8 * Math.cos(i * 1.7), y: 8 * Math.sin(i * 1.7), z: 1.5 * i - 30,
}));
type Pt = [number, number];
interface Viewer { probe: LiveElement; canvas: () => LiveElement; label: () => string | null; frames: Pt[][] }

/**
 * Renders the viewer alone in the App's window, its canvas laid out 600 x 330 with a 2D context
 * that records, for each frame, every point it is asked to move, line, curve or arc to.
 */
async function withViewer(app: AppHarness, run: (v: Viewer) => Promise<void>) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ProteinStructure3DViewer } = await import('../components/ProteinStructure3DViewer');
  const frames: Pt[][] = [];
  const createElement = app.doc.createElement.bind(app.doc);
  const recorder = () => new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'clearRect') return () => { frames.push([]); };
      if (key === 'moveTo' || key === 'lineTo' || key === 'arc') return (x: number, y: number) => { frames[frames.length - 1]?.push([x, y]); };
      if (key === 'quadraticCurveTo' || key === 'bezierCurveTo') return (...a: number[]) => { for (let i = 0; i + 1 < a.length; i += 2) frames[frames.length - 1]?.push([a[i], a[i + 1]]); };
      if (key in target) return target[key];
      return () => ({ addColorStop() {} });
    },
    set: (target, key, v) => { target[key] = v; return true; },
  });
  (app.doc as unknown as { createElement: (tag: string) => LiveElement }).createElement = (tag: string) => {
    const el = createElement(tag);
    if (tag === 'canvas') (el as unknown as { getContext: () => unknown }).getContext = recorder;
    return el;
  };
  const probe = app.doc.createElement('div');
  app.doc.body.appendChild(probe);
  const root = createRoot(probe as unknown as Element);
  try {
    await React.act(async () => { root.render(React.createElement(ProteinStructure3DViewer, { primaryAtoms: ATOMS })); });
    await app.settle();
    const canvas = () => one(probe.querySelectorAll('canvas'), 'Calpha canvas');
    await run({ probe, canvas, label: () => canvas().getAttribute('aria-label'), frames });
  } finally {
    await React.act(async () => { root.unmount(); });
    probe.remove();
    (app.doc as unknown as { createElement: unknown }).createElement = createElement;
  }
}
const withViewerApp = (run: (app: AppHarness, v: Viewer) => Promise<void>) => withApp((app) => withViewer(app, (v) => run(app, v)));

// ─── AC5 ───

describe('US-01M7CM8J AC5', () => {
  it('US-01M7CM8J AC5: the Calpha canvas takes a wheel through the shared helper at 1.09 a notch, bounded 0.35 to 4.5, pivoting on the rotation centre, and Reset returns 100%', async () => {
    await withViewerApp(async (app, v) => {
      expect(v.label()).toBe('3D structure, zoom 100%');
      // A horizontal wheel never zooms and is left to the page.
      const sideways = await fire(app, v.canvas(), 'wheel', { deltaX: 200, deltaY: 40, clientX: 120, clientY: 60 });
      expect([sideways.defaultPrevented, v.label()]).toEqual([false, '3D structure, zoom 100%']);
      // An empty wheel is not taken either.
      expect((await fire(app, v.canvas(), 'wheel', { deltaY: 0, clientX: 120, clientY: 60 })).defaultPrevented).toBe(false);

      // The drawn points scale about the rotation centre (the canvas centre, pan 0), not the
      // pointer: rotation and pan unchanged. Points that do not move (fixed decorations) stay put.
      const before = v.frames[v.frames.length - 1];
      expect(before.length, 'a frame was drawn').toBeGreaterThan(40);
      const ev = await fire(app, v.canvas(), 'wheel', { deltaY: -100, clientX: 120, clientY: 60 });
      expect([ev.defaultPrevented, v.label()]).toEqual([true, '3D structure, zoom 109%']);
      const after = v.frames[v.frames.length - 1];
      expect(after.length).toBe(before.length);
      let scaled = 0;
      after.forEach(([x, y], i) => {
        const [x0, y0] = before[i];
        if (x === x0 && y === y0) return;
        scaled++;
        expect(x, `point ${i} x`).toBeCloseTo(300 + (x0 - 300) * 1.09, 6);
        expect(y, `point ${i} y`).toBeCloseTo(165 + (y0 - 165) * 1.09, 6);
      });
      expect(scaled).toBeGreaterThan(40);

      // Bounds 0.35 to 4.5.
      for (let i = 0; i < 12; i++) await fire(app, v.canvas(), 'wheel', { deltaY: -400, ctrlKey: true, clientX: 300, clientY: 165 });
      expect(v.label()).toBe('3D structure, zoom 450%');
      for (let i = 0; i < 20; i++) await fire(app, v.canvas(), 'wheel', { deltaY: 400, clientX: 300, clientY: 165 });
      expect(v.label()).toBe('3D structure, zoom 35%');

      // A WebKit pinch zooms to the start zoom times its scale; its ctrl wheels are taken, not applied.
      const start = await fire(app, v.canvas(), 'gesturestart', { scale: 1 });
      const change = await fire(app, v.canvas(), 'gesturechange', { scale: 2 });
      const during = await fire(app, v.canvas(), 'wheel', { deltaY: -100, ctrlKey: true });
      const end = await fire(app, v.canvas(), 'gestureend', { scale: 2 });
      expect([start.defaultPrevented, change.defaultPrevented, during.defaultPrevented, end.defaultPrevented]).toEqual([true, true, true, true]);
      expect(v.label()).toBe('3D structure, zoom 70%');

      // Reset returns 100%.
      await app.click(one(v.probe.querySelectorAll('button').filter((b) => words(b.textContent) === 'Reset'), 'Reset'));
      expect(v.label()).toBe('3D structure, zoom 100%');

      // The exported step: the shape the coverage record imports; it changes the zoom alone.
      const { structureWheelStep } = await import('../components/ProteinStructure3DViewer');
      const view = { zoom: 1, pan: { x: 12, y: -7 }, rotX: 0.3, rotY: -1.1 };
      const ev0 = { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, clientX: 5, clientY: 9 };
      const step = structureWheelStep(ev0, view);
      expect(step.handled).toBe(true);
      expect(step.view.zoom).toBeCloseTo(1.09, 12);
      expect({ ...step.view, zoom: 0 }).toEqual({ ...view, zoom: 0 });
      expect(structureWheelStep({ ...ev0, deltaX: 300 }, view)).toEqual({ handled: false, view });
      expect(structureWheelStep({ ...ev0, deltaY: -6.25, deltaMode: 1 }, view).view.zoom).toBeCloseTo(1.09, 12);
    });
  });
});

// ─── AC6 ───

describe('US-01M7CM8J AC6', () => {
  it("US-01M7CM8J AC6: the Calpha canvas's label names its zoom", async () => {
    await withViewerApp(async (app, v) => {
      const at = () => v.label();
      expect(at()).toBe('3D structure, zoom 100%');
      await fire(app, v.canvas(), 'wheel', { deltaY: -100, clientX: 300, clientY: 165 });
      expect(at()).toBe('3D structure, zoom 109%');
      await fire(app, v.canvas(), 'wheel', { deltaY: -6.25, deltaMode: 1, clientX: 300, clientY: 165 });
      expect(at()).toBe(`3D structure, zoom ${Math.round(1.09 ** 2 * 100)}%`);
      await fire(app, v.canvas(), 'wheel', { deltaY: 400, metaKey: true, clientX: 300, clientY: 165 });
      expect(at()).toBe(`3D structure, zoom ${Math.round(1.09 ** -2 * 100)}%`);
      expect(at()).toBe('3D structure, zoom 84%');
    });
  });
});

// ─── AC7 ───

describe('US-01M7CM8J AC7', () => {
  it("US-01M7CM8J AC7: the Mol* viewport's wheel and pinch are left to Mol*", async () => {
    await withViewerApp(async (app, v) => {
      const host = one(v.probe.querySelectorAll('.molstar-viewer-host'), 'Mol* host');
      const viewport = one(v.probe.querySelectorAll('.protein-3d-canvas-viewport'), 'shared viewport');
      expect([host.parentElement === viewport, v.canvas().parentElement === viewport]).toEqual([true, true]);
      const wheel = await fire(app, host, 'wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 165 });
      const start = await fire(app, host, 'gesturestart', { scale: 1 });
      const change = await fire(app, host, 'gesturechange', { scale: 2 });
      const end = await fire(app, host, 'gestureend', { scale: 2 });
      expect([wheel.defaultPrevented, start.defaultPrevented, change.defaultPrevented, end.defaultPrevented]).toEqual([false, false, false, false]);
      expect(v.label()).toBe('3D structure, zoom 100%');
      // The same wheel on the Calpha canvas is the canvas's.
      expect((await fire(app, v.canvas(), 'wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 165 })).defaultPrevented).toBe(true);
      expect(v.label()).toBe('3D structure, zoom 109%');
    });
  });
});
