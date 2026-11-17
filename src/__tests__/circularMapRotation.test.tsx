// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVG4: View > Rotate Circular Map… turns the circular map (a degree field, a slider and
 * Reset rotation, one value), and View > Reset Rotation turns it back, while the sequence and its
 * coordinates stay as they are.
 *
 * AC1, AC3, AC4 and AC5 run in the mounted App over the live DOM (appHarness), from the App's own
 * menus. AC2 is a static render of the map (a static render measures nothing, so the zoom stands
 * in for the Split view's measured scale, as accessibilityFloor.test.tsx does). jsdom-like trees
 * have no hit testing, so where a click lands is read from what each element says it is drawn at
 * (`data-draw-angle`) and where its drawing starts, compared with polarToCartesian.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CIRCULAR_MAP_LABEL_FLOOR_PX,
  CircularPlasmidMap,
  polarToCartesian,
  type RestrictionScanScope,
} from '../components/CircularPlasmidMap';
import { apply, normalize, parseRotationEntry } from '../core/mapRotation';
import { buildDocumentRevisionKey } from '../lib/rustBioEngine';
import type { ORFRecord, PrimerRecord, RestrictionCutSite, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type SessionSpec } from './appHarness';
import { LiveDocument, LiveElement, memoryStorage, parseMarkup } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

// ─── Fixtures ───

/** Deterministic bases (an LCG's top two bits), so no fixture is read from disk. */
function bases(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
/** An ORF of `codons` sense codons after ATG, closed by TAA. */
const orfBases = (codons: number) =>
  'ATG' + Array.from({ length: codons }, (_, i) => ['GCT', 'GAA', 'CTG', 'AAA', 'GGC', 'TCC', 'CGT', 'ACC', 'GTT', 'CAG'][i % 10]).join('') + 'TAA';

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'circular',
  folder: 'Plasmids & Vectors', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
  features: [], primers: [], history: [],
};
const primer = (id: string, name: string, bindStart: number, bindEnd: number, sequence: string): PrimerRecord => ({
  id, name, sequence, annealSequence: sequence, tail5Prime: '', bindStart, bindEnd, strand: 1, length: sequence.length,
  gcPercent: 50, tmAnnealC: 60, tmFullC: 60, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true,
});

const LEN = 20_000;
/** AC2's molecule: exactly 20,000 bp (oriC / terC are drawn from 20,000 bp, the GC-skew trace from 2,000). */
const FIX: SequenceDocument = {
  ...BLANK, id: 'rot-fix', name: 'pRot20k', accession: 'ROT20K', sequence: bases(0x5eed, LEN),
  features: [
    { id: 'f-fwd', name: 'ampR', type: 'CDS', start: 1001, end: 3000, strand: 1, color: '#e57373' },
    { id: 'f-rev', name: 'lacZ', type: 'gene', start: 12001, end: 14000, strand: -1, color: '#64b5f6' },
  ],
  primers: [primer('p-1', 'fwdP', 7001, 7020, 'ACGTACGTACGTACGTACGT')],
};
const ORF: ORFRecord = {
  id: 'orf-1', frame: 1, strand: 1, start: 2001, end: 2900, lengthBp: 900, lengthAa: 299,
  startCodon: 'ATG', stopCodon: 'TAA', proteinSeq: 'M', mwKda: 33,
};
/** A cut at base 5,000 (90 degrees): cutTop 5001 is shown as "cuts after 5000". */
const CUT: RestrictionCutSite = {
  id: 'cut-5000', position: 4999, cutTop: 5001, cutBottom: 5005, strand: 1, overhangSeq: 'AATT', overhangType: '5prime',
  methylationBlocked: false,
  enzyme: { name: 'EcoRI', recognitionSeq: 'GAATTC', cutFwd: 1, cutRev: 5, suppliers: ['NEB'], methylationSensitivity: [], bufferNEB: 'CutSmart', tempC: 37 },
};
const SCOPE: RestrictionScanScope = { collection: { name: 'Lab set', scanned: 1, builtInsLeftOut: 0, notScanned: [] } };
const GUIDE = {
  name: 'g1', nuclease: 'SpCas9', strand: 1 as const, site: { start: 18001, end: 18023 },
  spacer: { start: 18001, end: 18020 }, pam: { start: 18021, end: 18023 }, pamSide: "3'", cutPosition: 18017,
};
const SELECTION = { start: 16001, end: 16500 };

// ─── Reading a drawn map ───

const [CX, CY] = [340, 270];
const num = (el: LiveElement, name: string) => {
  const v = el.getAttribute(name);
  if (v === null) throw new Error(`<${el.tagName.toLowerCase()}> has no ${name}`);
  return Number(v);
};
const drawAngle = (el: LiveElement) => num(el, 'data-draw-angle');
/** The signed difference of two angles, in (-180, 180]. */
const angleGap = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;
/** Where an element's drawing starts: a circle's centre, a line's first end, a text's seat, a path's first M. */
function startPoint(el: LiveElement): { x: number; y: number } {
  const tag = el.tagName.toLowerCase();
  if (tag === 'circle') return { x: num(el, 'cx'), y: num(el, 'cy') };
  if (tag === 'line') return { x: num(el, 'x1'), y: num(el, 'y1') };
  if (tag === 'text') return { x: num(el, 'x'), y: num(el, 'y') };
  const m = /^\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(el.getAttribute('d') ?? '');
  if (!m) throw new Error(`a <${tag}> with no leading M: ${el.getAttribute('d')}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}
/** The drawn start point lies at the element's drawn angle: polarToCartesian(cx, cy, r, data-draw-angle). */
function expectSeatedAt(el: LiveElement, what: string, tol = 0.01) {
  const p = startPoint(el);
  const r = Math.hypot(p.x - CX, p.y - CY);
  const want = polarToCartesian(CX, CY, r, drawAngle(el));
  expect(Math.abs(p.x - want.x), `${what}: x at its drawn angle`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - want.y), `${what}: y at its drawn angle`).toBeLessThanOrEqual(tol);
}
function expectDrawnAt(el: LiveElement, biological: number, rotation: number, what: string, tol = 0.01) {
  expect(el.getAttribute('data-draw-angle'), `${what} carries data-draw-angle`).not.toBeNull();
  expect(Math.abs(angleGap(drawAngle(el), (biological + rotation) % 360)), `${what}: drawn at (biological + rotation) mod 360`).toBeLessThan(1e-9);
  expect(drawAngle(el), `${what}: a drawn angle in [0, 360)`).toBeGreaterThanOrEqual(0);
  expect(drawAngle(el)).toBeLessThan(360);
  expectSeatedAt(el, what, tol);
}
const titleOf = (el: LiveElement) => el.querySelector('title')?.textContent ?? '';

function renderMap(rotationDeg: number, opts: { selectedRange?: { start: number; end: number }; zoomLevel?: number } = {}): LiveElement {
  const markup = renderToStaticMarkup(
    <CircularPlasmidMap
      doc={FIX}
      cutSites={[CUT]}
      orfs={[ORF]}
      orfScope={{ firstBp: 10000, minAa: 120 }}
      selectedRange={opts.selectedRange ?? SELECTION}
      guideHighlight={GUIDE}
      onSelectRange={() => {}}
      showOrfs
      showPrimers
      showUniqueCuttersOnly={false}
      restrictionScope={SCOPE}
      zoomLevel={opts.zoomLevel ?? 100}
      rotationDeg={rotationDeg}
    />
  );
  const nodes = parseMarkup(markup, new LiveDocument());
  const root = nodes.find((n): n is LiveElement => n instanceof LiveElement);
  if (!root) throw new Error('the map rendered nothing');
  return root;
}
const part = (root: LiveElement, name: string) => root.querySelectorAll(`[data-map-part="${name}"]`);
const onePart = (root: LiveElement, name: string) => {
  const found = part(root, name);
  expect(found, `one ${name}`).toHaveLength(1);
  return found[0];
};

// ─── Driving the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function withSession(spec: SessionSpec, run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await app.restoreSession(spec);
    await run(app);
  } finally {
    app.unmount();
  }
}
const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
async function openMenu(app: AppHarness, path: string[]): Promise<LiveElement | undefined> {
  const [top, ...rest] = path;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => nameOf(b) === top || words(b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  let item: LiveElement | undefined;
  for (const label of rest) {
    // The row's text is its label, then any shortcut.
    item = menuButtons(app).find((b) => {
      const t = words(b.textContent);
      const rest = t.slice(label.length).trim();
      return t.startsWith(label) && (rest.length < 3 || /^(Ctrl|Shift|Alt|[⌘⇧⌥⌃])/.test(rest));
    });
    if (!item) throw new Error(`no "${label}" in the open menu: ${menuButtons(app).map((b) => words(b.textContent)).join(' | ')}`);
    if (label !== rest[rest.length - 1]) await app.click(item);
  }
  return item;
}
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 3 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
/** Clicks View > `label` (which must be enabled). */
async function viewItem(app: AppHarness, label: string) {
  const item = await openMenu(app, ['View', label]);
  expect(item!.hasAttribute('disabled'), `View > ${label} is enabled`).toBe(false);
  await app.click(item!);
}
async function viewItemDisabled(app: AppHarness, label: string): Promise<boolean> {
  const item = await openMenu(app, ['View', label]);
  const disabled = item!.hasAttribute('disabled');
  await closeMenus(app);
  return disabled;
}
const ROTATE = 'Rotate Circular Map…';
const RESET = 'Reset Rotation';
const control = (app: AppHarness) => app.all('[role="dialog"][aria-label="Rotate Circular Map"]')[0] ?? null;
const degreeField = (app: AppHarness) => app.one('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]', 'the degree field');
const slider = (app: AppHarness) => app.one('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation slider"]', 'the slider');
const refusal = (app: AppHarness) => words(control(app)?.querySelector('[role="alert"]')?.textContent);
const svg = (app: AppHarness) => app.one('svg.plasmid-svg', 'the circular map');
const wedgeAngle = (app: AppHarness) => app.one('svg.plasmid-svg [data-map-part="origin-wedge"]', 'the origin wedge').getAttribute('data-draw-angle');
const button = (scope: LiveElement, name: string) => {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button "${name}", found ${found.length}`);
  return found[0];
};
const selectionLabel = (app: AppHarness) => app.all('svg.plasmid-svg [data-active-interval]').map((p) => p.getAttribute('data-active-interval') ?? '');
const row = (app: AppHarness, name: string) => {
  const rows = app.all('.mbc-doc-table-pane tbody tr').filter((r) => r.querySelectorAll('td, span').some((c) => c.textContent.trim() === name));
  expect(rows, `one table row for ${name}`).toHaveLength(1);
  return rows[0];
};
async function rotateTo(app: AppHarness, text: string) {
  if (!control(app)) await viewItem(app, ROTATE);
  await app.change(degreeField(app), text);
}

/** App fixtures: a 3,000 bp circular plasmid with a forward and a reverse feature and an ORF of 161 aa. */
const plasmid = (id: string, name: string, seed: number): SequenceDocument => {
  const filler = bases(seed, 3000);
  const orf = orfBases(160);
  return {
    ...BLANK, id, name, accession: id.toUpperCase(), sequence: filler.slice(0, 300) + orf + filler.slice(300 + orf.length),
    features: [
      { id: `${id}-a`, name: 'bla', type: 'CDS', start: 1001, end: 1600, strand: 1, color: '#e57373' },
      { id: `${id}-b`, name: 'rop', type: 'gene', start: 2001, end: 2400, strand: -1, color: '#64b5f6' },
    ],
  };
};
const PA = plasmid('rot-a', 'pRotA', 0x1234);
const PB = plasmid('rot-b', 'pRotB', 0x9876);

/** The documents and view state a saved session holds. */
async function saved(app: AppHarness) {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  const { envelope } = parseMbcWorkbench(await files[0].text());
  return {
    documents: envelope.documents.map((d) => ({
      id: d.id, sequence: d.sequence, features: d.features, primers: d.primers, history: d.history, updatedAt: d.updatedAt,
      revision: buildDocumentRevisionKey(d),
    })),
    selectedRange: envelope.workspace.selectedRange,
    zoomLevel: envelope.workspace.zoomLevel,
  };
}

// ─── AC1 ───

describe('US-01M7DVG4 AC1: View > Rotate Circular Map… sets one rotation from a degree field, a slider and Reset rotation', () => {
  it('US-01M7DVG4 AC1 normalize gives [0, 360) and +0 for -360, and refuses an empty, blank, non-number or infinite entry', () => {
    // Wrong implementations: the map's normalizeAngle (-0 for -360); Number('') or Number('  ') read as 0.
    expect(Object.is(normalize(-360), 0), 'normalize(-360) is +0').toBe(true);
    expect(Object.is(normalize(-720), 0)).toBe(true);
    expect([360, -90, 725, 0.1, 359.9, 0].map(normalize)).toEqual([0, 270, 5, 0.1, 359.9, 0]);
    expect(normalize(-1e-14), 'a negative angle too small to hold apart from 360 is 0').toBe(0);
    expect(apply(350, 20)).toBe(10);
    const entry = parseRotationEntry('-360');
    expect(entry.ok && Object.is(entry.value, 0)).toBe(true);
    expect(parseRotationEntry('')).toEqual({ ok: false, reason: 'Enter an angle in degrees' });
    expect(parseRotationEntry('   ')).toEqual({ ok: false, reason: 'Enter an angle in degrees' });
    for (const t of ['abc', 'Infinity', '-Infinity', '1e999', '0x10', '12deg']) {
      expect(parseRotationEntry(t), t).toEqual({ ok: false, reason: `${t} is not an angle in degrees` });
    }
  });

  it('US-01M7DVG4 AC1 each entry draws the origin wedge at exactly the value shown, the field and slider kept to it, and refusals change nothing', async () => {
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view' }, async (app) => {
      expect(wedgeAngle(app), 'unrotated, the wedge is at twelve o\'clock').toBe('0');
      await viewItem(app, ROTATE);
      const dialog = control(app);
      expect(dialog, 'the control is open').not.toBeNull();
      const field = degreeField(app);
      expect(field.getAttribute('type'), 'a text field, not type=number').toBe('text');
      // React writes the prop as inputMode; an HTML document reads attribute names case-insensitively.
      expect(field.getAttribute('inputmode') ?? field.getAttribute('inputMode')).toBe('decimal');
      const range = slider(app);
      expect([range.getAttribute('type'), range.getAttribute('min'), range.getAttribute('max')]).toEqual(['range', '0', '359.9']);
      button(dialog!, 'Reset rotation');

      for (const [text, value] of [['360', 0], ['-90', 270], ['725', 5], ['-360', 0], ['0.1', 0.1], ['359.9', 359.9]] as const) {
        await app.change(degreeField(app), text);
        expect(refusal(app), `${text} is taken`).toBe('');
        expect(Number(wedgeAngle(app)), `${text} draws the wedge at ${value}`).toBe(value);
        expect(degreeField(app).value, `${text} shows ${value} in the field`).toBe(String(value));
        expect(slider(app).value, `${text} sets the slider to ${value}`).toBe(String(value));
      }

      // The slider moves the same value, and the field follows it.
      await app.change(slider(app), '200.5');
      expect([wedgeAngle(app), degreeField(app).value]).toEqual(['200.5', '200.5']);
      await app.change(degreeField(app), '725');
      expect(wedgeAngle(app)).toBe('5');

      const drawn = svg(app).outerHTML;
      for (const [text, reason] of [
        ['', 'Enter an angle in degrees'],
        ['   ', 'Enter an angle in degrees'],
        ['abc', 'abc is not an angle in degrees'],
        ['Infinity', 'Infinity is not an angle in degrees'],
        ['-Infinity', '-Infinity is not an angle in degrees'],
      ] as const) {
        await app.change(degreeField(app), text);
        expect(refusal(app), `"${text}" is refused`).toBe(reason);
        expect(wedgeAngle(app), `"${text}" leaves the rotation at 5, never 0`).toBe('5');
        expect(slider(app).value, `"${text}" leaves the slider at 5`).toBe('5');
        expect(svg(app).outerHTML === drawn, `"${text}" leaves the drawn map as it was`).toBe(true);
      }

      // Reset rotation, in the control and as View > Reset Rotation.
      await app.click(button(control(app)!, 'Reset rotation'));
      expect([wedgeAngle(app), degreeField(app).value, slider(app).value, refusal(app)]).toEqual(['0', '0', '0', '']);
      await app.change(degreeField(app), '90');
      expect(wedgeAngle(app)).toBe('90');
      await viewItem(app, RESET);
      expect([wedgeAngle(app), degreeField(app).value]).toEqual(['0', '0']);
      await app.change(degreeField(app), '45');
      await app.menu('view:reset-rotation');
      expect(wedgeAngle(app)).toBe('0');
      await app.menu('view:rotate-map');
      expect(control(app)).not.toBeNull();
    });
  });
});

// ─── AC2 ───

describe('US-01M7DVG4 AC2: every angle-placed element is drawn at its biological angle plus the rotation', () => {
  const ROTATIONS = [0, 90, 180, 359.9];
  const deg = (base: number) => (base / LEN) * 360;

  it('US-01M7DVG4 AC2 each element carries data-draw-angle = (biological + rotation) mod 360 and starts at polarToCartesian of it', () => {
    for (const rot of ROTATIONS) {
      const root = renderMap(rot);
      const at = `at ${rot} degrees`;
      expectDrawnAt(onePart(root, 'origin-wedge'), 0, rot, `the origin wedge ${at}`);

      const arcs = part(root, 'feature-arc');
      expect(arcs.map((a) => a.getAttribute('data-feature-id')), at).toEqual(['f-fwd', 'f-rev']);
      expectDrawnAt(arcs[0], deg(1000), rot, `the forward feature ${at}`);
      // The reverse feature's outer edge starts after its bevel: min(5.2, span * 0.34) past its start.
      expectDrawnAt(arcs[1], deg(12000) + Math.min(5.2, (deg(14000) - deg(12000)) * 0.34), rot, `the reverse feature ${at}`);
      expectDrawnAt(onePart(root, 'orf-arc'), deg(2000), rot, `the ORF ${at}`);
      // A primer marker sits at the middle of its binding arc, drawn at least 3 degrees wide.
      expectDrawnAt(onePart(root, 'primer-marker'), (deg(7000) + Math.max(deg(7000) + 3, deg(7020))) / 2, rot, `the primer ${at}`);

      const callouts = root.querySelectorAll('[data-callout]');
      const anchorOf = (id: string) => {
        const g = callouts.find((c) => c.getAttribute('data-callout') === id);
        expect(g, `the ${id} callout ${at}`).toBeDefined();
        return g!.querySelector('[data-map-part="callout-anchor"]')!;
      };
      expectDrawnAt(anchorOf('feat-f-fwd'), (deg(1000) + deg(3000)) / 2, rot, `ampR's callout ${at}`);
      expectDrawnAt(anchorOf('feat-f-rev'), (deg(12000) + deg(14000)) / 2, rot, `lacZ's callout ${at}`);
      expectDrawnAt(anchorOf('prm-p-1'), (deg(7000) + deg(7000) + 3) / 2, rot, `fwdP's callout ${at}`);
      expectDrawnAt(anchorOf('cut-cut-5000'), 90, rot, `EcoRI's callout ${at}`);
      if (rot === 90) expect(drawAngle(anchorOf('cut-cut-5000')), 'the base-5,000 cut at 90 degrees is drawn at exactly 180').toBe(180);

      for (const name of ['oric', 'terc']) {
        const marker = onePart(root, name);
        const bp = Number(/@ ([\d,]+) bp/.exec(titleOf(marker))![1].replace(/,/g, ''));
        expectDrawnAt(marker, deg(bp - 1), rot, `${name} ${at}`);
      }
      expectDrawnAt(onePart(root, 'gc-trace'), 0, rot, `the GC% trace ${at}`, 0.08);
      expectDrawnAt(onePart(root, 'skew-trace'), 0, rot, `the GC-skew trace ${at}`, 0.08);

      const ticks = part(root, 'tick');
      expect(ticks.map((t) => num(t, 'data-bp')), `the 2 kb ruler ${at}`).toEqual([2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000]);
      for (const t of ticks) expectDrawnAt(t, deg(num(t, 'data-bp')), rot, `the ${num(t, 'data-bp')} tick ${at}`);
      const labels = root.querySelectorAll('text.circular-tick-label');
      expect(labels.length, `ring coordinates ${at}`).toBeGreaterThan(0);
      for (const l of labels) expectDrawnAt(l, deg(num(l, 'data-bp')), rot, `the ${l.textContent} label ${at}`);

      const [sel] = root.querySelectorAll('[data-active-interval]');
      expect(sel.getAttribute('data-start-angle'), `the selection keeps its biological start ${at}`).toBe(String(deg(16000)));
      expectDrawnAt(sel, deg(16000), rot, `the selection ${at}`);
      const spacer = root.querySelector('[data-guide-arc="spacer"]')!;
      const pam = root.querySelector('[data-guide-arc="pam"]')!;
      expect([spacer.getAttribute('data-start-angle'), pam.getAttribute('data-start-angle')], `the guide keeps its biological starts ${at}`).toEqual([String(deg(18000)), String(deg(18020))]);
      // Each guide part is narrower than 0.5 degrees, so it is widened from its start.
      expectDrawnAt(spacer, deg(18000), rot, `the spacer ${at}`);
      expectDrawnAt(pam, deg(18020), rot, `the PAM ${at}`);
    }
  });

  it('US-01M7DVG4 AC2 a one-base selection on the last base ends at the rotated origin and never spills past it', () => {
    for (const rot of ROTATIONS) {
      const root = renderMap(rot, { selectedRange: { start: LEN, end: LEN } });
      const [sel] = root.querySelectorAll('[data-active-interval]');
      const d = sel.getAttribute('d')!;
      const arc = /A\s*([\d.]+)\s+[\d.]+\s+0\s+[01]\s+1\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(d)!;
      const rOuter = Number(arc[1]);
      const end = polarToCartesian(CX, CY, rOuter, rot);
      expect(Math.abs(Number(arc[2]) - end.x), `at ${rot}: the sector ends at the rotated origin (x)`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(Number(arc[3]) - end.y), `at ${rot}: (y)`).toBeLessThanOrEqual(0.01);
      // Widened to 0.5 degrees and pulled back: it starts 0.5 degrees before the origin.
      expectDrawnAt(sel, 359.5, rot, `the last base at ${rot}`);
    }
  });

  it('US-01M7DVG4 AC2 callouts take the side of their drawn angle, nothing is rotated by a transform, and the plate, scope lines and note stay put', () => {
    const fixed = (root: LiveElement) => ({
      plate: root.querySelectorAll('g').filter((g) => /^translate\(18, 20\)/.test(g.getAttribute('transform') ?? '')).map((g) => g.getAttribute('transform')),
      scope: root.querySelectorAll('text.circular-orf-scope').map((t) => [t.textContent, t.getAttribute('x'), t.getAttribute('y')]),
      note: root.querySelectorAll('text.circular-callout-note').map((t) => [t.getAttribute('x'), t.getAttribute('y')]),
    });
    const at0 = fixed(renderMap(0));
    expect(at0.plate, 'the identity plate is drawn').toHaveLength(1);
    expect(at0.scope.map((s) => s[0]), 'the ORF scope lines are drawn').toEqual(['ORFs: first 10,000 bp', '(120 aa or more)']);
    expect(at0.note, 'the pinned scope note is drawn').toHaveLength(1);
    for (const rot of ROTATIONS) {
      const root = renderMap(rot);
      const callouts = root.querySelectorAll('[data-callout]');
      expect(callouts.length, `every callout is placed at ${rot}`).toBe(4);
      for (const g of callouts) {
        const a = drawAngle(g.querySelector('[data-map-part="callout-anchor"]')!);
        const label = g.querySelector('text')!;
        expect(num(label, 'x') > CX, `${g.getAttribute('data-callout')} at ${a}: right of centre exactly when drawn in [0, 180]`).toBe(a >= 0 && a <= 180);
      }
      if (rot === 90) {
        const cut = callouts.find((g) => g.getAttribute('data-callout') === 'cut-cut-5000')!;
        expect(num(cut.querySelector('text')!, 'x'), 'the cut drawn at 180 is labelled on the right').toBeGreaterThan(CX);
      }
      // The map's own svg (the header's icons are svgs too).
      const svgEl = root.querySelector('svg.plasmid-svg')!;
      expect(svgEl.querySelectorAll('*').length, 'the map svg is the one read').toBeGreaterThan(50);
      const rotated = [svgEl, ...svgEl.querySelectorAll('*')].filter((e) => /rotate/i.test(e.getAttribute('transform') ?? ''));
      expect(rotated.map((e) => e.getAttribute('transform')), `no rotate() transform at ${rot}`).toEqual([]);
      expect(fixed(root), `the plate, ORF scope lines and note at ${rot}`).toEqual(at0);
    }
  });

  it('US-01M7DVG4 AC2 every tick and callout label stays at or above the label floor on screen at the Split view scales, at every angle', () => {
    for (const scale of [0.618, 0.534]) {
      for (const rot of ROTATIONS) {
        const root = renderMap(rot, { zoomLevel: scale * 100 });
        const labels = [...root.querySelectorAll('text.circular-tick-label'), ...root.querySelectorAll('[data-callout] text')];
        expect(labels.length, `labels at ${scale} / ${rot}`).toBeGreaterThan(4);
        for (const l of labels) {
          expect(num(l, 'font-size') * scale, `"${l.textContent}" at ${scale} / ${rot}`).toBeGreaterThanOrEqual(CIRCULAR_MAP_LABEL_FLOOR_PX - 1e-9);
        }
      }
    }
  });
});

// ─── AC3 ───

describe('US-01M7DVG4 AC3: rotation is view state, held per document', () => {
  it('US-01M7DVG4 AC3 rotating and Reset rotation change nothing else; ⌘Z outside the field undoes the last edit, inside it stays text undo', async () => {
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view' }, async (app) => {
      const original = (await saved(app)).documents[0].sequence;
      // A document edit to undo, then a selection (Set Origin is then available) and a zoom.
      await app.menu('sequence:reverse-complement');
      const edited = (await saved(app)).documents[0].sequence;
      expect(edited, 'the edit changed the sequence').not.toBe(original);
      await app.click(app.all('svg.plasmid-svg [data-map-part="feature-arc"]')[0]);
      await app.menu('view:zoom-in');
      const before = await saved(app);
      expect(before.selectedRange, 'a selection to keep').not.toBeNull();
      expect(before.zoomLevel, 'a zoom to keep').not.toBe(100);
      const setOrigin = async () => {
        const item = await openMenu(app, ['View', 'Map Layout', 'Set Origin']);
        const state = item!.hasAttribute('disabled');
        await closeMenus(app);
        return state;
      };
      const originBefore = await setOrigin();
      expect(originBefore, 'Set Origin is available with a selection').toBe(false);
      const viewport = () => app.one('svg.plasmid-svg g.plasmid-viewport-group').getAttribute('transform');
      const viewportBefore = viewport();

      for (const step of ['90', 'slider', 'reset', '135'] as const) {
        if (step === 'slider') await app.change(slider(app), '222.2');
        else if (step === 'reset') await app.click(button(control(app)!, 'Reset rotation'));
        else await rotateTo(app, step);
        expect(await saved(app), `after ${step}: documents, history, updatedAt, revision key, selection and zoom unchanged`).toEqual(before);
        expect(viewport(), `after ${step}: pan and zoom unchanged`).toBe(viewportBefore);
      }
      expect(wedgeAngle(app)).toBe('135');
      expect(await setOrigin(), 'Set Origin is as available as before').toBe(originBefore);

      // Inside the degree field, ⌘Z is the field's own text undo: the document edit stays.
      await rotateTo(app, '135');
      degreeField(app).focus();
      await app.press('z', { mod: true });
      await app.menu('edit:undo');
      expect((await saved(app)).documents[0].sequence, 'inside the field the edit is not undone').toBe(edited);
      expect(wedgeAngle(app)).toBe('135');

      // Closed, ⌘Z undoes the document edit, not the rotation; the stack held that one edit only.
      await app.click(button(control(app)!, 'Close'));
      expect(control(app)).toBeNull();
      await app.press('z', { mod: true });
      expect((await saved(app)).documents[0].sequence, '⌘Z undoes the reverse complement').toBe(original);
      expect(wedgeAngle(app), 'the rotation is not undone').toBe('135');
      await app.menu('edit:undo');
      expect(app.doc.body.textContent, 'the undo stack held the one edit and no rotation').toContain('Nothing to undo.');
      expect(wedgeAngle(app)).toBe('135');
    });
  });

  it('US-01M7DVG4 AC3 each document shows its own rotation, 0 until it is rotated', async () => {
    await withSession({ documents: [PA, PB], activeDocId: PA.id, viewerTab: 'sequence-view' }, async (app) => {
      await rotateTo(app, '135');
      expect(wedgeAngle(app)).toBe('135');
      await app.click(row(app, PB.name));
      expect(wedgeAngle(app), 'pRotB was never rotated').toBe('0');
      await rotateTo(app, '45');
      expect(wedgeAngle(app)).toBe('45');
      await app.click(row(app, PA.name));
      expect(wedgeAngle(app), 'pRotA keeps its own angle').toBe('135');
      await app.menu('view:reset-rotation');
      expect(wedgeAngle(app)).toBe('0');
      await app.click(row(app, PB.name));
      expect(wedgeAngle(app), 'resetting pRotA left pRotB at 45').toBe('45');
    });
  });
});

// ─── AC4 ───

describe('US-01M7DVG4 AC4: a click on the rotated map selects what is drawn there', () => {
  it('US-01M7DVG4 AC4 at 90 and 270 degrees the feature arc, cut-site label and ORF arc are drawn rotated and select the same interval as at 0', async () => {
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view' }, async (app) => {
      // The cut-site callout first drawn at 0 degrees, followed by its id at every angle.
      const cutId = app.all('svg.plasmid-svg [data-callout]').map((g) => g.getAttribute('data-callout')!).find((id) => id.startsWith('cut-'));
      const targets = () => {
        const feature = app.all('svg.plasmid-svg [data-map-part="feature-arc"]').find((a) => a.getAttribute('data-feature-id') === `${PA.id}-a`);
        const cut = app.all('svg.plasmid-svg [data-callout]').find((g) => g.getAttribute('data-callout') === cutId);
        const orf = app.all('svg.plasmid-svg [data-map-part="orf-arc"]').find((a) => /\(301\.\.786, 161 aa\)/.test(titleOf(a)));
        expect([feature, cut, orf].map(Boolean), 'a feature arc, a cut-site label and the ORF arc are drawn').toEqual([true, true, true]);
        return { feature: feature!, cut: cut!, orf: orf! };
      };
      const angleOf = (name: string, el: LiveElement) => drawAngle(name === 'cut' ? el.querySelector('[data-map-part="callout-anchor"]')! : el);
      const at0: Record<string, { angle: number; selects: string[] }> = {};
      for (const [name, el] of Object.entries(targets())) {
        await app.click(el);
        at0[name] = { angle: angleOf(name, el), selects: selectionLabel(app) };
        expect(at0[name].selects, `${name} selects something at 0`).toHaveLength(1);
      }
      const cutBp = Number(/cuts after (\d+)/.exec(titleOf(targets().cut))![1]);
      expect(at0.cut.angle).toBeCloseTo((cutBp / PA.sequence.length) * 360, 9);
      for (const rot of [90, 270]) {
        await rotateTo(app, String(rot));
        for (const [name, el] of Object.entries(targets())) {
          const drawn = name === 'cut' ? el.querySelector('[data-map-part="callout-anchor"]')! : el;
          expect(Math.abs(angleGap(drawAngle(drawn), apply(at0[name].angle, rot))), `${name} at ${rot} is drawn at its rotated angle`).toBeLessThan(1e-9);
          expectSeatedAt(drawn, `${name} at ${rot}`);
          await app.click(el);
          expect(selectionLabel(app), `clicking ${name} at ${rot} selects what it selects at 0`).toEqual(at0[name].selects);
        }
      }
    });
  });
});

// ─── AC5 ───

describe('US-01M7DVG4 AC5: the mounted App greys Rotate Circular Map… and Reset Rotation where there is no circle to turn', () => {
  const linear: SequenceDocument = { ...PA, id: 'rot-lin', name: 'pLin', topology: 'linear' };
  const protein: SequenceDocument = { ...BLANK, id: 'rot-prot', name: 'Prot', moleculeType: 'Protein', topology: 'linear', sequence: 'MKTAYIAKQRQISFVKSHFSRQ' };
  const cases: Array<[string, SessionSpec, string]> = [
    ['a linear molecule', { documents: [linear], activeDocId: linear.id, viewerTab: 'sequence-view' }, 'Circular maps are drawn for circular DNA; this document is linear.'],
    ['a protein', { documents: [protein], activeDocId: protein.id, viewerTab: 'sequence-view' }, 'Circular maps are drawn for DNA only; this document is a protein.'],
    ['Map Layout Linear', { documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view', workspace: { mapLayoutMode: 'linear' } }, 'Map Layout is Linear; choose Split or Circular Map to rotate the map.'],
    ['a collapsed circle', { documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view', workspace: { paneSplit: { ratio: 0.5, collapsed: 'circular' } } }, 'The circular map is collapsed; restore it to rotate the map.'],
  ];
  for (const [label, spec, reason] of cases) {
    it(`US-01M7DVG4 AC5 on ${label} both items are disabled and the command says why`, async () => {
      await withSession(spec, async (app) => {
        expect(await viewItemDisabled(app, ROTATE), `${ROTATE} is disabled`).toBe(true);
        expect(await viewItemDisabled(app, RESET), `${RESET} is disabled`).toBe(true);
        for (const id of ['view:rotate-map', 'view:reset-rotation']) {
          await app.menu(id);
          expect(app.doc.body.textContent, `${id} says why`).toContain(reason);
          expect(control(app), `${id} opens nothing`).toBeNull();
        }
      });
    });
  }

  it('US-01M7DVG4 AC5 on another viewer tab the command first switches to the Sequence view; restored, the circle can be turned again', async () => {
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'text-view' }, async (app) => {
      expect(await viewItemDisabled(app, ROTATE)).toBe(false);
      await viewItem(app, ROTATE);
      expect(app.activeTab(), 'Rotate Circular Map… switches to the Sequence view').toBe('sequence-view');
      expect(control(app)).not.toBeNull();
      await app.change(degreeField(app), '30');
      await app.clickTab('text-view');
      await viewItem(app, RESET);
      expect(app.activeTab(), 'Reset Rotation switches to the Sequence view').toBe('sequence-view');
      expect(wedgeAngle(app)).toBe('0');
    });
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view', workspace: { paneSplit: { ratio: 0.5, collapsed: 'circular' } } }, async (app) => {
      expect(await viewItemDisabled(app, ROTATE)).toBe(true);
      await app.click(app.one('button.map-seq-restore.restore-circular'));
      expect(await viewItemDisabled(app, ROTATE), 'restored, the circle can be turned').toBe(false);
    });
  });
});

// ─── US-01M7DVNS: the rotation is kept with the session, drawn in exported figures ───

const AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';
const statusText = (app: AppHarness) => words(app.all('.statusbar-toast-text').map((t) => t.textContent).join(' '));
const unreadableNotice = (name: string) => `The saved rotation for ${name} could not be read; it opens at 0 degrees.`;
/** Lets the App's 500 ms autosave timer run out (the harness's timers are fake), then the write it starts. */
async function autosaveRunsOut(app: AppHarness) {
  await React.act(async () => { vi.advanceTimersByTime(600); });
  await app.settle();
}
/** The mapRotation a session text holds once it is read back through parseMbcWorkbench (the WASM codec). */
async function reopenedRotation(text: string): Promise<unknown> {
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  return parseMbcWorkbench(text, 'Reopened').envelope.workspace.mapRotation;
}
/** The rotation the App's own session save writes. */
async function savedRotation(app: AppHarness): Promise<unknown> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  return reopenedRotation(await files[0].text());
}
/** The root <svg> of an exported file's markup. */
function svgOfFile(markup: string): LiveElement {
  const at = markup.indexOf('<svg');
  expect(at, 'the file holds an <svg>').toBeGreaterThanOrEqual(0);
  const root = parseMarkup(markup.slice(at), new LiveDocument()).find((n): n is LiveElement => n instanceof LiveElement);
  if (!root) throw new Error('the file holds no element');
  return root;
}
/** Where each origin wedge and feature arc is drawn: its data-draw-angle and its start point. */
function drawnParts(root: LiveElement) {
  const parts = [...part(root, 'origin-wedge'), ...part(root, 'feature-arc')];
  return parts.map((el) => ({ part: el.getAttribute('data-map-part'), angle: el.getAttribute('data-draw-angle'), start: startPoint(el) }));
}

describe('US-01M7DVNS AC1: workspace.mapRotation is saved with the session and restored on reopen', () => {
  it('US-01M7DVNS AC1 session text reopened through parseMbcWorkbench (the WASM) keeps each angle, a non-number as null, and a session saved before the field has none', async () => {
    const { serializeMbcWorkbench } = await import('../core/mbcSessionFormat');
    const workspace = {
      activeDocId: PA.id, selectedFolder: 'All Project Files', navHistory: [PA.id], navIndex: 0,
      viewerTab: 'sequence-view' as const, mapLayoutMode: 'split' as const, zoomLevel: 100, textFormat: 'genbank' as const,
      colorScheme: 'standard' as const, darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: {
        showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: true,
      },
    };
    const text = serializeMbcWorkbench({ sessionName: 'Rot', documents: [PA, PB], workspace: { ...workspace, mapRotation: { [PA.id]: 120, [PB.id]: 45.5 } } });
    expect(await reopenedRotation(text), 'each angle comes back as saved').toEqual({ [PA.id]: 120, [PB.id]: 45.5 });
    const json = JSON.parse(text) as { workspace: Record<string, unknown> };
    json.workspace.mapRotation = { [PA.id]: '120', [PB.id]: 45.5 };
    expect(await reopenedRotation(JSON.stringify(json)), 'a string angle is kept as null under its id; the rest is read').toEqual({ [PA.id]: null, [PB.id]: 45.5 });
    json.workspace.mapRotation = { [PA.id]: null, [PB.id]: true };
    expect(await reopenedRotation(JSON.stringify(json))).toEqual({ [PA.id]: null, [PB.id]: null });
    delete json.workspace.mapRotation;
    expect(await reopenedRotation(JSON.stringify(json)), 'a session saved before the field has none').toBeUndefined();
  });

  it('US-01M7DVNS AC1 the App reopens each map at its saved angle, names a non-number angle once in the status bar, and opens a session saved before the field at 0', async () => {
    await withSession(
      { documents: [PA, PB], activeDocId: PA.id, viewerTab: 'sequence-view', sessionName: 'Rot_Saved', workspace: { mapRotation: { [PA.id]: 120, [PB.id]: 'abc' as unknown as number } } },
      async (app) => {
        expect(wedgeAngle(app), 'pRotA opens with its origin wedge at the saved 120 degrees').toBe('120');
        const said = statusText(app);
        expect(said, 'the restore sentence is kept').toContain('Restored workbench "Rot_Saved.mbc"');
        expect(said, 'the unreadable angle is named, appended').toContain(unreadableNotice(PB.name));
        expect(said.split(unreadableNotice(PB.name)), 'named once').toHaveLength(2);
        expect(said, 'pRotA was read').not.toContain(unreadableNotice(PA.name));
        expect(said.indexOf('Restored workbench'), 'appended after the restore sentence').toBeLessThan(said.indexOf(unreadableNotice(PB.name)));
        await app.click(row(app, PB.name));
        expect(wedgeAngle(app), 'pRotB opens at 0').toBe('0');
        await app.click(row(app, PA.name));
        expect(await savedRotation(app), 'saving keeps pRotA\'s angle and writes none for pRotB at 0').toEqual({ [PA.id]: 120 });

        // A session saved before the field, reopened over a turned map, opens it at 0.
        await app.restoreSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view', sessionName: 'Rot_Old' });
        expect(wedgeAngle(app), 'a session with no mapRotation opens at 0').toBe('0');
        expect(statusText(app)).not.toContain('could not be read');
        expect(await savedRotation(app)).toBeUndefined();
      }
    );
  });

  it('US-01M7DVNS AC1 changing only the rotation autosaves it, and restoring that autosave brings it back', async () => {
    const storage = memoryStorage();
    const first = await mountApp({ storage });
    try {
      await first.restoreSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view' });
      await autosaveRunsOut(first);
      const before = storage.getItem(AUTOSAVE_KEY);
      expect(before, 'the restored session is autosaved').not.toBeNull();
      expect(await reopenedRotation(before!), 'unrotated, the autosave holds no rotation').toBeUndefined();
      // The rotation alone changes: the open control, then the angle (the control opening changes nothing saved).
      await viewItem(first, ROTATE);
      await autosaveRunsOut(first);
      expect(storage.getItem(AUTOSAVE_KEY), 'opening the control is no change to save').toBe(before);
      await first.change(degreeField(first), '120');
      expect(wedgeAngle(first)).toBe('120');
      await autosaveRunsOut(first);
      const after = storage.getItem(AUTOSAVE_KEY);
      expect(after, 'the rotation alone is autosaved').not.toBe(before);
      expect(await reopenedRotation(after!), 'the autosave holds the new angle').toEqual({ [PA.id]: 120 });
    } finally {
      first.unmount();
    }
    const second = await mountApp({ storage });
    try {
      await second.menu('file:restore-autosave');
      await second.settle();
      expect(statusText(second)).toContain('Restored workbench');
      expect(wedgeAngle(second), 'restoring the autosave brings the angle back').toBe('120');
    } finally {
      second.unmount();
    }
  });
});

describe('US-01M7DVNS AC3: the exported figures draw the map at its rotation', () => {
  it('US-01M7DVNS AC3 the HUD SVG file and the FigureExportButton SVG draw the origin wedge and feature arcs where the rotated map on screen does', async () => {
    await withSession({ documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view' }, async (app) => {
      await rotateTo(app, '90');
      await app.click(button(control(app)!, 'Close'));
      const onScreen = drawnParts(svg(app));
      expect(onScreen.map((p) => p.part)).toEqual(['origin-wedge', 'feature-arc', 'feature-arc']);
      expect(onScreen[0].angle, 'the wedge is drawn at the rotation').toBe('90');
      const unrotated = drawnParts(renderMap(0));
      expect(unrotated[0].angle).toBe('0');

      const hud = app.all('.circular-hud-actions');
      expect(hud, 'one circular map HUD').toHaveLength(1);
      const svgButton = hud[0].querySelectorAll('button').filter((b) => b.getAttribute('title') === 'Export circular map as vector SVG');
      expect(svgButton).toHaveLength(1);
      let before = app.downloads().length;
      await app.click(svgButton[0]);
      await app.settle();
      const hudFiles = app.downloads().slice(before).filter((f) => f.filename.endsWith('.svg'));
      expect(hudFiles, 'the HUD button saves one .svg').toHaveLength(1);
      expect(drawnParts(svgOfFile(await hudFiles[0].text())), 'the HUD SVG file is drawn as the screen is').toEqual(onScreen);

      await app.click(hud[0].querySelectorAll('.mbc-figure-export-trigger')[0]);
      const svgItem = app.all('.circular-hud-actions .mbc-figure-export-item').filter((b) => words(b.textContent).startsWith('SVG'));
      expect(svgItem, 'the figure menu offers SVG').toHaveLength(1);
      before = app.downloads().length;
      await app.click(svgItem[0]);
      await app.settle();
      const figureFiles = app.downloads().slice(before).filter((f) => f.filename.endsWith('.svg'));
      expect(figureFiles, 'the figure export saves one .svg').toHaveLength(1);
      expect(drawnParts(svgOfFile(await figureFiles[0].text())), 'the FigureExportButton SVG is drawn as the screen is').toEqual(onScreen);
    });
  });
});

describe('US-01M7DVNS AC5: Set Origin on a rotated map', () => {
  it('US-01M7DVNS AC5 changes the sequence exactly as on an unrotated map and keeps the rotation angle', async () => {
    const at = { start: 1201, end: 1201 };
    const originEdit = async (rotation: number | undefined) => {
      let result: { sequence: string; features: unknown; wedge: string | null; saved: unknown } | null = null;
      await withSession(
        { documents: [PA], activeDocId: PA.id, viewerTab: 'sequence-view', workspace: { selectedRange: at, ...(rotation === undefined ? {} : { mapRotation: { [PA.id]: rotation } }) } },
        async (app) => {
          expect(wedgeAngle(app)).toBe(String(rotation ?? 0));
          await app.menu('view:set-origin');
          await app.settle();
          expect(statusText(app)).toContain('to base 1201');
          const { documents } = await saved(app);
          result = { sequence: documents[0].sequence, features: documents[0].features, wedge: wedgeAngle(app), saved: await savedRotation(app) };
        }
      );
      return result!;
    };
    const plain = await originEdit(undefined);
    expect(plain.sequence, 'Set Origin moved base 1201 to base 1').toBe(PA.sequence.slice(1200) + PA.sequence.slice(0, 1200));
    expect(plain.saved).toBeUndefined();
    const turned = await originEdit(90);
    expect(turned.sequence, 'the same sequence edit as on the unrotated map').toBe(plain.sequence);
    expect(turned.features, 'the same features').toEqual(plain.features);
    expect(turned.wedge, 'the rotation angle is kept on screen').toBe('90');
    expect(turned.saved, 'and in the session').toEqual({ [PA.id]: 90 });
  });
});
