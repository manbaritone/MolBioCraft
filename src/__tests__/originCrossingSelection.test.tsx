// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7CG2W: clicking an ORF that runs across the origin of a circular molecule selects the ORF
 * itself (start > end), not the complementary arc between its ends. The map is rendered for real
 * and the click handler is taken from the ORF arc's own element as the map creates it.
 *
 * BG-01M6VZSJ: a CRISPR guide or a primer across the origin selects, annotates, draws and exports as
 * the bases it covers (the live-App describe below, ahead of the static renders).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
interface AppDispatcher { onMenuAction: (actionId: string) => void }
const probe = vi.hoisted(() => ({
  onElement: null as null | ElementProbe,
  /** The App's native-menu dispatcher ref, as its render last assigned it. */
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with a dispatcher for its menu actions. */
  onMenus: null as null | ((dispatch: (id: string) => void) => void),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = ((initial: unknown) => {
    const ref = actual.useRef(initial);
    if (initial && typeof initial === 'object' && 'onMenuAction' in initial && 'onNativeFileOpen' in initial) {
      probe.dispatcher = ref as unknown as { current: AppDispatcher };
    }
    return ref;
  }) as typeof actual.useRef;
  return { ...actual, default: { ...actual, useRef }, useRef };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.onMenus?.((id) => {
        if (!probe.dispatcher) throw new Error('the App rendered no native-menu dispatcher');
        probe.dispatcher.current.onMenuAction(id);
      });
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});

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

const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');

afterEach(() => {
  probe.onElement = null;
  probe.onMenus = null;
});

const puc19 = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;
const SEQ_6061 = Array.from({ length: 6061 }, (_, i) => 'ACGT'[(i * 7 + (i >> 3)) % 4]).join('');

function orf(start: number, end: number, frame: 1 | -2) {
  return {
    id: `orf-${start}-${end}`,
    frame,
    strand: frame > 0 ? 1 : -1,
    start,
    end,
    lengthBp: 141,
    lengthAa: 47,
    startCodon: 'ATG',
    stopCodon: 'TAA',
    proteinSeq: 'M',
    mwKda: 5.2,
  } as const;
}

/** Render the map with one ORF and click its arc; returns what the click selected. */
function clickOrf(topology: 'circular' | 'linear', o: ReturnType<typeof orf>): unknown[] {
  const selections: unknown[] = [];
  let onClick: (() => void) | undefined;
  probe.onElement = (type, props) => {
    if (type === 'path' && props.fill === '#fbbc04' && typeof props.onClick === 'function') {
      onClick = props.onClick as () => void;
    }
  };
  renderToStaticMarkup(
    <CircularPlasmidMap
      doc={{ ...puc19, sequence: SEQ_6061, features: [], primers: [], topology }}
      cutSites={[]}
      orfs={[o]}
      selectedRange={null}
      onSelectRange={(r) => selections.push(r)}
      showOrfs
      showPrimers={false}
      showUniqueCuttersOnly
      zoomLevel={100}
      onZoomChange={() => {}}
    />
  );
  probe.onElement = null;
  expect(onClick, 'the map draws a clickable ORF arc').toBeDefined();
  onClick!();
  return selections;
}

// ─── BG-01M6VZSJ: a guide or primer across a circular record's origin, through the live App ───
//
// These mount the real App over the live DOM (the US-01M6TB6G harness) with the real WASM engine,
// so they run ahead of every static-render describe below: the harness refuses to mount once React
// DOM has loaded. Every record is built here from a repeated 8-base unit, with the PAM or primer
// bases planted by coordinate; every expected span and count is derived from the engine's own record
// or the planted coordinates, read round the origin by this file's own walk, never written out
// (the count asserted as a literal is how a wrong number reached four comments, LC-002).
//
// Wrong implementations these kill:
// - AC1: a guide's range passed to the selection read forwards (min..max), so the quickbar reads
//   12..4,980 and counts the bases between the guide's ends; + Annotate writing a crossing spacer
//   or PAM as one span with no parts.
// - AC2: a base row reading `start..end` as one run, which marks nothing when start > end; the
//   overview drawing the selection as one rectangle.
// - AC4: the primer jump reading its binding range forwards while the guide's is fixed; a primer
//   across the origin written as anything but a join.
// - AC5: crisprGuideParts adding the lengths without reducing modulo the record's length, which puts
//   a PAM-leading guide's spacer past the last base instead of back at base 1. The linear view and
//   the map wrap a span they are handed themselves, so this is seen in the spans the row states and
//   the annotation writes; the drawn parts are asserted as well.

const VZSJ_LEN = 4990;
const VZSJ_UNIT = 'ACGTTGCA';
/**
 * The filler: the 8-base unit repeated and trimmed. It holds no GG and no CC (so no SpCas9 PAM on
 * either strand) and no TTT or AAA (so no Cas12a TTTV on either strand), and its last bases run
 * into its first round the origin without making one.
 */
const vzsjFiller = VZSJ_UNIT.repeat(Math.ceil(VZSJ_LEN / VZSJ_UNIT.length)).slice(0, VZSJ_LEN);
/** A 20-base spacer that is not its own reverse complement, so a strand read wrongly shows. */
const VZSJ_SPACER = 'TACG'.repeat(5);

/** `bases` written over `seq` from 1-based `start`, round the origin where they run past the end. */
function plantAt(seq: string, start: number, bases: string): string {
  const out = seq.split('');
  for (let i = 0; i < bases.length; i++) out[(start - 1 + i) % out.length] = bases[i];
  return out.join('');
}

/** `count` 1-based positions from `start` in reading order, round the origin. */
const walkFrom = (start: number, count: number, length: number): number[] =>
  Array.from({ length: count }, (_, i) => ((start - 1 + i) % length) + 1);

/** 1-based positions `start..end` in reading order, round the origin where start > end. */
const walkSpan = (start: number, end: number, length: number): number[] =>
  walkFrom(start, start <= end ? end - start + 1 : length - start + 1 + end, length);

/** Positions as runs of consecutive bases, in the order given: two runs for a walk round the origin. */
function runsOf(positions: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const p of positions) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs;
}

const vzsjDoc = (id: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name: `p${id}`, accession: `MBC_${id}`, description: '', sequence, moleculeType: 'DNA', topology: 'circular',
  folder: 'Local', createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z',
  features: [], primers: [], history: [], ...more,
});

/** One forward SpCas9 site, spacer then AGG, planted from base 4,980 round the origin. */
const SPCAS9_SITE_START = 4980;
const SPCAS9_DOC = vzsjDoc('vzsjSpCas9', plantAt(vzsjFiller, SPCAS9_SITE_START, `${VZSJ_SPACER}AGG`));
/** The same site planted so that its PAM, not its spacer, runs across the origin: its last base is base 1. */
const SPCAS9_PAM_SITE_START = 4969;
const SPCAS9_PAM_DOC = vzsjDoc('vzsjSpCas9Pam', plantAt(vzsjFiller, SPCAS9_PAM_SITE_START, `${VZSJ_SPACER}AGG`));

/** Cas12a's sites: the PAM planted at 4,984; the spacer is as long as the engine's record says. */
const VZSJ_CAS12A = 'Cas12a / Cpf1 (TTTV)';
const CAS12A_SITE_START = 4984;
/** Forward: the 5' PAM TTTG at 4,984, then the spacer, round the origin. */
const CAS12A_FWD_DOC = vzsjDoc('vzsjCas12aFwd', plantAt(vzsjFiller, CAS12A_SITE_START, `TTTG${VZSJ_SPACER}`));
/** Reverse: the spacer from 4,984 round the origin, then CAAA (TTTG read on the minus strand). */
const CAS12A_REV_DOC = vzsjDoc('vzsjCas12aRev', plantAt(vzsjFiller, CAS12A_SITE_START, `${VZSJ_SPACER}CAAA`));

/** A 24-base primer binding the plus strand across the origin: 4,979..4,990 then 1..12. */
const PRIMER_BIND = { start: 4979, end: 12 };
const PRIMER_SEQ = walkSpan(PRIMER_BIND.start, PRIMER_BIND.end, VZSJ_LEN).map((p) => vzsjFiller[p - 1]).join('');
const PRIMER_DOC = vzsjDoc('vzsjPrimer', vzsjFiller, {
  primers: [{
    id: 'p-vzsj', name: 'VZSJ_Fwd', sequence: PRIMER_SEQ, annealSequence: PRIMER_SEQ, tail5Prime: '',
    bindStart: PRIMER_BIND.start, bindEnd: PRIMER_BIND.end, strand: 1, length: PRIMER_SEQ.length, gcPercent: 50,
    tmAnnealC: 60, tmFullC: 60, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: false,
  }],
});

const VZSJ_TIMEOUT = 120_000;

async function withLiveApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

/** This launch's engine over `doc` for `preset` (loaded after the App, as the harness requires). */
async function vzsjGuides(doc: SequenceDocument, preset: string) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(doc.sequence, preset, 25, doc.topology === 'circular');
}

/** The CRISPR tab on `doc`, scanned for `preset` through the tab's own chooser and Run. */
async function vzsjCrisprTab(app: AppHarness, doc: SequenceDocument, preset?: string) {
  await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'primers-pcr' });
  await app.menu('primers:crispr');
  if (preset) {
    await app.change(app.one('select[aria-label="Nuclease / PAM:"]', 'the nuclease chooser'), preset);
    await app.settle();
  }
  await app.click(app.one('[data-crispr-run]', 'the CRISPR Run button'));
}

/** The guide row's own range button, the one that reads "(across the origin)". */
const guideRangeButton = (app: AppHarness, guideId: string) =>
  app.one(`[data-crispr-guide-row="${guideId}"] button.mbc-coord-jump-btn`, `the range button of ${guideId}`);

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The linear view's quickbar summary: the selection's bounds and its count, as it states them. */
const quickbarSummary = (app: AppHarness) =>
  squash(app.one('.seq-selection-quickbar-summary', 'the linear view quickbar summary').textContent);

/** The base rows' selected positions, ascending. */
const selectedBases = (app: AppHarness): number[] =>
  app.all('[data-pos].sel-base').map((el) => Number(el.getAttribute('data-pos'))).sort((a, b) => a - b);

/** The base rows' drawn positions, ascending. */
const drawnBases = (app: AppHarness): number[] =>
  app.all('.mono-bases [data-pos]').map((el) => Number(el.getAttribute('data-pos'))).sort((a, b) => a - b);

/**
 * `read` on the page the view opened at (the record's end, where the site starts) and on its first
 * page (base 1 on), together: on this 4,990 bp record one page of base rows does not hold both
 * sides of the origin.
 */
async function onBothSides(app: AppHarness, read: () => number[]): Promise<{ drawn: number[]; marked: number[] }> {
  const { drawn, marked } = await onBothSidesEach(app, { only: read });
  return { drawn, marked: marked.only };
}

/** As onBothSides, for several readers of the same two pages. */
async function onBothSidesEach<K extends string>(
  app: AppHarness,
  readers: Record<K, () => number[]>
): Promise<{ drawn: number[]; marked: Record<K, number[]> }> {
  const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);
  const keys = Object.keys(readers) as K[];
  const drawnHere = drawnBases(app);
  const here = keys.map((k) => readers[k]());
  await app.click(app.one('button.btn-page[title="First page"]', 'the First page button'));
  const marked = Object.fromEntries(keys.map((k, i) => [k, union(here[i], readers[k]())])) as Record<K, number[]>;
  return { drawn: union(drawnHere, drawnBases(app)), marked };
}

/** The active document as File > Save Session saves it. */
async function vzsjSaved(app: AppHarness, docId: string) {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  const payload = JSON.parse(await files[files.length - 1].text()) as { documents: SequenceDocument[] };
  const doc = payload.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`the saved session holds no document "${docId}"`);
  return doc;
}

/** The active document as File > Export GenBank writes it. */
async function vzsjGenBank(app: AppHarness): Promise<string> {
  const before = app.downloads().length;
  await app.menu('file:save-gb');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Export GenBank saved ${files.length - before} files, not one`);
  return files[files.length - 1].text();
}

/**
 * The INSDC location for the bases `positions` on `strand`: a join where they run round the origin,
 * and a one-base part written as its one position.
 */
function locationOf(positions: number[], strand: number): string {
  const runs = runsOf(positions).map(([a, b]) => (a === b ? `${a}` : `${a}..${b}`));
  const body = runs.length > 1 ? `join(${runs.join(',')})` : runs[0];
  return strand < 0 ? `complement(${body})` : body;
}

/** What the selection must read as, and draw, for the bases `positions` (reading order). */
async function expectSelectionOf(app: AppHarness, positions: number[], what: string) {
  const start = positions[0];
  const end = positions[positions.length - 1];
  const summary = quickbarSummary(app);
  expect(summary, `${what}: the quickbar's bounds, start past end`).toContain(`${start.toLocaleString()}..${end.toLocaleString()}`);
  expect(summary, `${what}: the quickbar counts the bases covered`).toContain(`(${positions.length.toLocaleString()} bp`);
  // Each base drawn, on either side of the origin, is selected exactly when the walk covers it.
  const { drawn, marked } = await onBothSides(app, () => selectedBases(app));
  for (const [a, b] of runsOf(positions)) {
    expect(drawn.includes(a) && drawn.includes(b), `${what}: the rows draw ${a}..${b}`).toBe(true);
  }
  expect(marked, `${what}: the selected bases among those drawn`).toEqual(drawn.filter((p) => positions.includes(p)));
  expect(marked.length, `${what}: every base it covers is selected`).toBe(positions.length);
}

/**
 * + Annotate on forward SpCas9 guide `g` (spacer then PAM), read back from the saved session: the part
 * `crossing` is written with its two segments, exactly its bases, and the other part with one span and
 * none; GenBank export writes each as the bases it covers.
 */
async function expectAnnotatedAsParts(
  app: AppHarness,
  doc: SequenceDocument,
  g: { id: string; start: number; spacerSeq: string; pamSeq: string },
  crossing: 'spacer' | 'PAM'
) {
  await app.click(app.one(`[data-crispr-annotate="${g.id}"]`, `the Annotate button of ${g.id}`));
  const saved = await vzsjSaved(app, doc.id);
  const spacerWalk = walkFrom(g.start, g.spacerSeq.length, VZSJ_LEN);
  const pamWalk = walkFrom((spacerWalk[spacerWalk.length - 1] % VZSJ_LEN) + 1, g.pamSeq.length, VZSJ_LEN);
  const gb = await vzsjGenBank(app);
  for (const [part, walk] of [['spacer', spacerWalk], ['PAM', pamWalk]] as const) {
    const f = saved.features.find((x) => x.qualifiers?.guide_part === part);
    expect(f, `${doc.id}: the ${part} feature`).toBeTruthy();
    expect([f!.start, f!.end], `${doc.id}: the ${part}'s bounds`).toEqual([walk[0], walk[walk.length - 1]]);
    const crosses = runsOf(walk).length > 1;
    expect(crosses, `${doc.id}: the fixture's ${part} ${part === crossing ? 'crosses' : 'does not cross'} the origin`).toBe(part === crossing);
    if (crosses) {
      expect(f!.segments?.map((s) => [s.start, s.end]), `${doc.id}: the ${part} as its two parts, the end of the record then its start`)
        .toEqual(runsOf(walk));
      expect(f!.segments!.flatMap((s) => walkSpan(s.start, s.end, VZSJ_LEN)), `${doc.id}: the parts cover exactly the ${part}`).toEqual(walk);
      expect(gb, `${doc.id}: the ${part} is never written start..end`).not.toContain(`crispr_guide    ${walk[0]}..${walk[walk.length - 1]}\n`);
    } else {
      expect(f!.segments ?? [], `${doc.id}: a part that does not cross keeps one span`).toHaveLength(0);
    }
    expect(gb, `${doc.id}: the ${part} exported as the bases it covers`).toContain(`crispr_guide    ${locationOf(walk, 1)}\n`);
  }
}

describe('BG-01M6VZSJ a guide or primer across a circular record\'s origin, in the live App', () => {
  it("BG-01M6VZSJ AC1: pressing an origin-crossing guide's range selects the bases it covers", async () => {
    await withLiveApp(async (app) => {
      await vzsjCrisprTab(app, SPCAS9_DOC);
      const scan = await vzsjGuides(SPCAS9_DOC, 'SpCas9 (NGG)');
      expect(scan.report?.candidateCount, 'the fixture holds the one planted site').toBe(1);
      const g = scan.guides[0];
      expect([g.start, g.strand], 'the site as planted').toEqual([SPCAS9_SITE_START, 1]);
      expect(g.start, 'the site runs from a start past its end').toBeGreaterThan(g.end);
      const site = walkSpan(g.start, g.end, VZSJ_LEN);
      expect(site.length, 'the site is its spacer and its PAM').toBe(g.spacerSeq.length + g.pamSeq.length);

      const button = guideRangeButton(app, g.id);
      expect(squash(button.textContent), 'the row says the guide runs across the origin').toContain('(across the origin)');
      await app.click(button);
      expect(app.activeTab(), 'the range brings the sequence view forward').toBe('sequence-view');
      await expectSelectionOf(app, site, 'the guide');
      // Never end..start read forwards, which counts the bases between the guide's ends instead.
      const forwards = walkSpan(g.end, g.start, VZSJ_LEN);
      expect(quickbarSummary(app), 'never the bounds read forwards').not.toContain(`${g.end.toLocaleString()}..${g.start.toLocaleString()}`);
      expect(quickbarSummary(app), 'never the count read forwards').not.toContain(`(${forwards.length.toLocaleString()} bp`);

      // + Annotate: the spacer, which crosses the origin here, is written as its two parts.
      await app.menu('primers:crispr');
      await app.click(app.one('[data-crispr-run]', 'the CRISPR Run button'));
      await expectAnnotatedAsParts(app, SPCAS9_DOC, g, 'spacer');
    });
    // And a site whose PAM is the part across the origin: the PAM is written as its two parts.
    await withLiveApp(async (app) => {
      await vzsjCrisprTab(app, SPCAS9_PAM_DOC);
      const scan = await vzsjGuides(SPCAS9_PAM_DOC, 'SpCas9 (NGG)');
      expect(scan.report?.candidateCount, 'the fixture holds the one planted site').toBe(1);
      const g = scan.guides[0];
      expect([g.start, g.strand], 'the site as planted').toEqual([SPCAS9_PAM_SITE_START, 1]);
      await expectAnnotatedAsParts(app, SPCAS9_PAM_DOC, g, 'PAM');
    });
  }, VZSJ_TIMEOUT * 2);

  it('BG-01M6VZSJ AC2: a wrapped selection is highlighted as two runs', async () => {
    await withLiveApp(async (app) => {
      await vzsjCrisprTab(app, SPCAS9_DOC);
      const scan = await vzsjGuides(SPCAS9_DOC, 'SpCas9 (NGG)');
      const g = scan.guides[0];
      const site = walkSpan(g.start, g.end, VZSJ_LEN);
      await app.click(guideRangeButton(app, g.id));

      const want = runsOf(site);
      expect(want.length, 'the site runs round the origin').toBe(2);

      // The linear overview schematic draws the one active interval as two rectangles, one per side
      // (the circular map's sector, a path, is not read here).
      const rects = app.all('rect[data-active-interval]');
      expect(rects.map((r) => r.getAttribute('data-active-interval')), 'the overview draws both segments')
        .toEqual(want.map(() => `${g.start}..${g.end}`));

      // The base rows: both sides of the origin are drawn, and each is one run of highlighted bases.
      const { drawn, marked } = await onBothSides(app, () => selectedBases(app));
      for (const [a, b] of want) {
        expect(drawn.includes(a) && drawn.includes(b), `the rows draw ${a}..${b}`).toBe(true);
      }
      expect(runsOf(marked), 'two runs of highlighted bases, 1.. and ..the last base')
        .toEqual([...want].sort((x, y) => x[0] - y[0]));
      expect(marked.length, 'as many highlighted as the site covers').toBe(site.length);
    });
  }, VZSJ_TIMEOUT);

  it('BG-01M6VZSJ AC4: a primer that binds across the origin selects and exports like a guide', async () => {
    await withLiveApp(async (app) => {
      await app.restoreSession({ documents: [PRIMER_DOC], activeDocId: PRIMER_DOC.id, viewerTab: 'primers-pcr' });
      const p = PRIMER_DOC.primers[0];
      const bound = walkSpan(p.bindStart, p.bindEnd, VZSJ_LEN);
      expect(bound.length, 'the primer binds as many bases as it holds').toBe(p.sequence.length);
      const jump = app.all('button.mbc-coord-jump-btn').filter((b) => squash(b.textContent).startsWith(`${p.bindStart}..${p.bindEnd}`));
      expect(jump.length, "the catalogued primer's binding range button").toBe(1);
      await app.click(jump[0]);
      expect(app.activeTab(), 'the range brings the sequence view forward').toBe('sequence-view');
      await expectSelectionOf(app, bound, 'the primer');

      const gb = await vzsjGenBank(app);
      expect(gb, 'the primer is written as a join of exactly the bases it binds').toContain(
        `primer_bind     ${locationOf(bound, p.strand)}\n`
      );
      expect(gb).not.toContain(`primer_bind     ${p.bindStart}..${p.bindEnd}\n`);
    });
  }, VZSJ_TIMEOUT);

  it("BG-01M6VZSJ AC5: a 5'-PAM guide across the origin draws its PAM and spacer on the bases it covers", async () => {
    for (const doc of [CAS12A_FWD_DOC, CAS12A_REV_DOC]) {
      await withLiveApp(async (app) => {
        await vzsjCrisprTab(app, doc, VZSJ_CAS12A);
        const scan = await vzsjGuides(doc, VZSJ_CAS12A);
        expect(scan.report?.candidateCount, `${doc.id}: the one planted site`).toBe(1);
        const g = scan.guides[0];
        const forward = doc === CAS12A_FWD_DOC;
        expect([g.start, g.strand], `${doc.id}: the site as planted`).toEqual([CAS12A_SITE_START, forward ? 1 : -1]);
        expect(g.pamSide, "the nuclease reads a 5' PAM").toMatch(/^5'/);
        const spacerLen = g.spacerSeq.length;
        const pamLen = g.pamSeq.length;
        // The PAM leads in plus-strand order where the 5' PAM side and the strand agree (forward).
        const pam = forward ? walkFrom(g.start, pamLen, VZSJ_LEN) : walkFrom(g.start + spacerLen, pamLen, VZSJ_LEN);
        const spacer = forward ? walkFrom(g.start + pamLen, spacerLen, VZSJ_LEN) : walkFrom(g.start, spacerLen, VZSJ_LEN);
        expect(runsOf(spacer).length, `${doc.id}: the spacer runs round the origin`).toBe(2);
        const plus = (ps: number[]) => ps.map((p) => doc.sequence[p - 1]).join('');
        const onStrand = (ps: number[]) => (forward ? plus(ps) : rcBases(plus(ps)));
        expect(onStrand(spacer), `${doc.id}: the spacer's bases, read on the guide's strand`).toBe(g.spacerSeq);
        expect(onStrand(pam), `${doc.id}: the PAM's bases`).toBe(g.pamSeq);

        const spanText = (ps: number[]) => `${ps[0]}..${ps[ps.length - 1]}`;
        const spanWords = (ps: number[]) => `${ps[0].toLocaleString()}..${ps[ps.length - 1].toLocaleString()}`;
        // The row states both parts where they lie, before it is pressed.
        const row = app.one(`[data-crispr-guide-row="${g.id}"]`, `the row of ${g.id}`);
        expect(row.getAttribute('title'), `${doc.id}: the row states the spacer where it lies`).toContain(`spacer ${spanWords(spacer)}`);
        expect(row.getAttribute('title'), `${doc.id}: the row states the PAM where it lies`).toContain(`PAM ${spanWords(pam)}`);
        // + Annotate writes each part over the bases it covers, the crossing one as its two segments.
        await app.click(app.one(`[data-crispr-annotate="${g.id}"]`, `the Annotate button of ${g.id}`));
        const saved = await vzsjSaved(app, doc.id);
        for (const [part, walk] of [['spacer', spacer], ['PAM', pam]] as const) {
          const f = saved.features.find((x) => x.qualifiers?.guide_part === part);
          expect([f?.start, f?.end], `${doc.id}: the ${part} annotated where it lies`).toEqual([walk[0], walk[walk.length - 1]]);
          expect(f?.segments?.map((x) => [x.start, x.end]) ?? [walk[0], walk[walk.length - 1]], `${doc.id}: the ${part}'s parts`)
            .toEqual(runsOf(walk).length > 1 ? runsOf(walk) : [walk[0], walk[walk.length - 1]]);
        }
        await app.click(app.one(`[data-crispr-guide-row="${g.id}"]`, `the row of ${g.id}`));
        const ribbon = app.one('[data-guide-highlight]', 'the linear view guide ribbon');
        // The circular map draws each part as one arc over the bases it covers.
        const arcs = (part: string) => app.all(`[data-guide-arc="${part}"]`).map((el) => el.getAttribute('data-guide-arc-span'));
        expect(arcs('spacer'), `${doc.id}: the map's spacer arc`).toEqual([spanText(spacer)]);
        expect(arcs('pam'), `${doc.id}: the map's PAM arc`).toEqual([spanText(pam)]);
        expect(ribbon.getAttribute('data-guide-pam'), `${doc.id}: the PAM span`).toBe(spanText(pam));
        expect(ribbon.getAttribute('data-guide-spacer'), `${doc.id}: the spacer span`).toBe(spanText(spacer));
        const marked = (part: string) =>
          app.all(`[data-pos][data-guide-part="${part}"]`).map((el) => Number(el.getAttribute('data-pos'))).sort((a, b) => a - b);
        const asc = (ps: number[]) => [...ps].sort((a, b) => a - b);
        const seen = await onBothSidesEach(app, { spacer: () => marked('spacer'), pam: () => marked('pam') });
        for (const [a, b] of runsOf(spacer)) {
          expect(seen.drawn.includes(a) && seen.drawn.includes(b), `${doc.id}: the rows draw ${a}..${b}`).toBe(true);
        }
        expect(seen.marked.spacer, `${doc.id}: the spacer drawn on its bases, both sides of the origin`).toEqual(asc(spacer));
        expect(seen.marked.pam, `${doc.id}: the PAM drawn on its bases`).toEqual(asc(pam));
      });
    }
  }, VZSJ_TIMEOUT * 2);
});

const VZSJ_COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
function rcBases(s: string): string {
  return s.split('').reverse().map((c) => VZSJ_COMPLEMENT[c] ?? c).join('');
}

describe('BG-01M7CG2W clicking an ORF on the circular map', () => {
  it('selects an origin-spanning ORF itself, start > end, on a circular molecule', () => {
    expect(clickOrf('circular', orf(5990, 71, 1))).toEqual([{ start: 5990, end: 71, label: 'ORF Frame +1 (47 aa)' }]);
  });

  it('selects an ORF that does not cross the origin as it is', () => {
    expect(clickOrf('circular', orf(100, 240, -2))).toEqual([{ start: 100, end: 240, label: 'ORF Frame -2 (47 aa)' }]);
  });

  it('never selects start > end on a linear molecule', () => {
    expect(clickOrf('linear', orf(5990, 71, 1))).toEqual([{ start: 71, end: 5990, label: 'ORF Frame +1 (47 aa)' }]);
  });
});

describe('BG-01M7CG2W the other readers of an origin-crossing selection', () => {
  const circ: SequenceDocument = { ...puc19, sequence: SEQ_6061, features: [], primers: [], topology: 'circular' };

  it('the cockpit reads 5,990..71 as 143 bp across the origin, its GC from those bases, its lens on both sides', async () => {
    const { ConstructCockpitBar } = await import('../components/ConstructCockpitBar');
    const render = (doc: SequenceDocument, r: { start: number; end: number }) =>
      renderToStaticMarkup(<ConstructCockpitBar doc={doc} cutSites={[]} selectedRange={r} onSelectRange={() => {}} />);
    const html = render(circ, { start: 5990, end: 71 });
    expect(html).toContain('5,990..71 (143 bp, across the origin)');
    expect(html).not.toContain('5,920');
    const bases = SEQ_6061.slice(5989) + SEQ_6061.slice(0, 71);
    const gc = (([...bases].filter((c) => c === 'G' || c === 'C').length / bases.length) * 100).toFixed(1);
    expect(html).toContain(`${gc}%`);
    const lenses = [...html.matchAll(/class="mbc-cockpit-lens" x="([^"]+)"[^>]* width="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(lenses).toHaveLength(2);
    expect(lenses[0][0]).toBeCloseTo((5989 / 6061) * 1000, 6);
    expect(lenses[0][0] + lenses[0][1]).toBeCloseTo(1000, 6);
    expect(lenses[1][0]).toBe(0);
    expect(lenses[1][1]).toBeCloseTo((71 / 6061) * 1000, 6);
    // The same pair on a linear molecule is the normalised interval, one lens, in nt for RNA.
    const linear = render({ ...circ, topology: 'linear', moleculeType: 'RNA' }, { start: 5990, end: 71 });
    expect(linear).toContain('71..5,990 (5,920 nt)');
    expect([...linear.matchAll(/class="mbc-cockpit-lens"/g)]).toHaveLength(1);
  });

  it('Design Primers says a crossing selection runs across the origin instead of dropping it silently', async () => {
    const { DesignPrimersOperationDialog } = await import('../components/SequenceOperationDialogs');
    const html = renderToStaticMarkup(
      <DesignPrimersOperationDialog doc={circ} selection={{ start: 5990, end: 71 }} onUpdate={() => {}} onCreate={() => {}} onClose={() => {}} />
    );
    expect(html).toContain('The selection 5990..71 runs across the origin; set the origin first to design primers around it.');
    expect(html).not.toContain('Use selection');
    const plain = renderToStaticMarkup(
      <DesignPrimersOperationDialog doc={circ} selection={{ start: 100, end: 400 }} onUpdate={() => {}} onCreate={() => {}} onClose={() => {}} />
    );
    expect(plain).toContain('Use selection');
    expect(plain).not.toContain('runs across the origin');
  });

  it('Translation Statistics reads a crossing selection as its two parts, end of molecule then start', async () => {
    const { GenomeInspectorExtras } = await import('../components/LinearSequenceView');
    const html = renderToStaticMarkup(<GenomeInspectorExtras doc={circ} selectedRange={{ start: 5990, end: 71 }} onSelectRange={() => {}} />);
    expect(html).toContain('Selection 5,990..71, + strand');
    // 143 bases are 47 whole codons; the arc between the ends (5,920 bases) would be 1,973.
    expect(html).toContain('Translation Statistics (47 aa / codons)');
  });
});

describe('BG-01M7CG2W the linear view quickbar on an origin-crossing selection', () => {
  const circ: SequenceDocument = { ...puc19, sequence: SEQ_6061, features: [], primers: [], topology: 'circular' };
  const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  const rc = (x: string) => [...x].reverse().map((c) => COMP[c]).join('');

  async function quickbar(doc: SequenceDocument, selectedRange: { start: number; end: number }) {
    const { LinearSequenceView } = await import('../components/LinearSequenceView');
    const buttons = new Map<string, () => void>();
    const copied: string[] = [];
    const notices: string[] = [];
    const extracts: number[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => { copied.push(t); } } });
    probe.onElement = (type, props) => {
      if (type === 'button' && props.className === 'seq-quick-pill-btn' && typeof props.onClick === 'function') {
        buttons.set(String(props.title), props.onClick as () => void);
      }
    };
    const html = renderToStaticMarkup(
      <LinearSequenceView doc={doc} cutSites={[]} selectedRange={selectedRange} onSelectRange={() => {}}
        onUpdateDocument={() => {}} onStatusNotice={(m: string) => notices.push(m)} onExtractSelection={() => extracts.push(1)} />
    );
    probe.onElement = null;
    return { html, buttons, copied, notices, extracts };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("copies exactly the 143 bases 5'→3' and their reverse complement, and reads 143 bp", async () => {
    const q = await quickbar(circ, { start: 5990, end: 71 });
    const want = SEQ_6061.slice(5989) + SEQ_6061.slice(0, 71);
    expect(q.html).toContain('5,990..71');
    expect(q.html).toMatch(/\(143(<!-- -->)? (<!-- -->)?bp/);
    q.buttons.get("Copy selected 5'→3' sequence")!();
    q.buttons.get('Copy Reverse Complement of selected region')!();
    expect(q.copied).toEqual([want, rc(want)]);
    expect(q.notices[0]).toContain('Copied 143 bp (5990..71)');
    q.buttons.get('Extract selected region into a new sequence document')!();
    expect(q.extracts).toEqual([1]);
    q.buttons.get('Create a new feature annotation spanning the active selection')!();
    expect(q.notices.at(-1)).toContain('runs across the origin');
  });

  it('copies a plain selection as before', async () => {
    const q = await quickbar(circ, { start: 100, end: 109 });
    q.buttons.get("Copy selected 5'→3' sequence")!();
    expect(q.copied).toEqual([SEQ_6061.slice(99, 109)]);
  });
});

// ─── BG-01M7CG2W round 2: each App reader pinned at its call site, through the App itself ───

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (x: string) => [...x.toUpperCase()].reverse().map((c) => COMPLEMENT[c] ?? c).join('');
const textOf = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

interface Seen { doc: SequenceDocument; selectedRange: { start: number; end: number; label?: string } | null; onSelectRange: (r: unknown) => void }

/**
 * Open the Sample Project (pET-28a(+)-eGFP, 6,061 bp, circular), select 5990..71 through the
 * circular map's own onSelectRange, then dispatch `actions` - each from inside an App render, so
 * each acts on the state the one before left. Returns the final markup, what the viewers were last
 * handed, and what was written to the clipboard.
 */
function crossingSession(actions: string[]) {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const copied: string[] = [];
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } } });
  let map: Seen | null = null;
  let viewer: Seen | null = null;
  let original: SequenceDocument | null = null;
  let selected = false;
  let sessionOpened = false;
  // The selection is made through the circular map's own onSelectRange, the first time the App
  // hands the map the Sample Project: an App state update made while the App renders.
  probe.onElement = (type, props) => {
    if (typeof props.onSelectRange === 'function' && props.doc && 'selectedRange' in props) {
      const seen = props as unknown as Seen;
      if (type === AppCircularPlasmidMap) map = seen;
      viewer = seen;
      if (sessionOpened && !selected && type === AppCircularPlasmidMap && seen.doc.name === 'pET-28a(+)-eGFP') {
        selected = true;
        original = seen.doc;
        seen.onSelectRange({ start: 5990, end: 71, label: 'origin test' });
      }
    }
  };
  /** A step answers false to be tried again on the next render, once what it needs is there. */
  const steps: ((d: (id: string) => void) => boolean | void)[] = [
    (d) => { sessionOpened = true; d('new-session:sample-library'); },
    ...actions.map((id) => (d: (x: string) => void) => {
      if (!selected) return false;
      d(id);
    }),
  ];
  let ran = 0;
  let passes = 0;
  probe.onMenus = (dispatch) => {
    if (++passes > 60) throw new Error(`the App kept re-rendering (step ${ran})`);
    if (ran < steps.length && steps[ran](dispatch) !== false) ran++;
  };
  const html = renderToStaticMarkup(<App />);
  probe.onMenus = null;
  probe.onElement = null;
  vi.unstubAllGlobals();
  expect(selected, 'the crossing selection was made').toBe(true);
  expect(ran, 'every step ran').toBe(steps.length);
  const o = original as SequenceDocument | null;
  expect(o?.name).toBe('pET-28a(+)-eGFP');
  expect(o?.sequence.length).toBe(6061);
  return { html, text: textOf(html), map: map as Seen | null, viewer: viewer as Seen | null, copied, original: o! };
}

// The App is loaded when a test of the static-render App section first needs it, never at the top
// of the file: the live-DOM harness (BG-01M6VZSJ above) must mount the App before React DOM loads.
// The harness resets the module registry when it mounts, so the circular map these tests recognise
// is loaded beside the App, from the App's own registry, not the one imported at the top.
let App: typeof import('../App').App;
let AppCircularPlasmidMap: typeof CircularPlasmidMap;
const { intervalSequence } = await import('../core/activeInterval');

describe('BG-01M7CG2W round 2: the App readers of an origin-crossing selection, at their call sites', () => {
  beforeAll(async () => {
    ({ App } = await import('../App'));
    ({ CircularPlasmidMap: AppCircularPlasmidMap } = await import('../components/CircularPlasmidMap'));
  });

  it('the viewer chip and the status bar read 5,990..71 as 143 bp across the origin', () => {
    const s = crossingSession([]);
    expect(s.map?.selectedRange).toMatchObject({ start: 5990, end: 71 });
    const chip = /<span class="mbc-selection-readout"[^>]*>([\s\S]*?)<\/span>/.exec(s.html);
    expect(chip, 'the viewer chip').not.toBeNull();
    expect(textOf(chip![1])).toBe('5,990..71 (143 bp, across the origin) • origin test');
    const bases = intervalSequence(s.original.sequence, { start: 5990, end: 71 });
    const gc = (([...bases.toUpperCase()].filter((c) => c === 'G' || c === 'C').length / bases.length) * 100).toFixed(1);
    expect(s.text).toContain(`Selection: 5,990..71 (143 bp, across the origin | GC: ${gc}% | Tm: `);
    expect(s.text).not.toContain('5,920');
  });

  it('Edit > Copy Sequence copies exactly the 143 bases, the end of the molecule then its start', () => {
    const s = crossingSession(['edit:copy-sequence']);
    expect(s.copied).toEqual([s.original.sequence.slice(5989) + s.original.sequence.slice(0, 71)]);
  });

  it('Add Feature and Selection to Oligo refuse it with a banner that says why', () => {
    expect(crossingSession(['features:add']).text).toContain('Add Feature: the selection runs across the origin');
    expect(crossingSession(['primers:convert-to-oligo']).text).toContain('Selection to Oligo: the selection runs across the origin');
  });

  it('Reverse Complement moves it to the mirrored crossing interval, which holds the reverse complement', () => {
    const s = crossingSession(['sequence:reverse-complement']);
    expect(s.map?.selectedRange).toMatchObject({ start: 5991, end: 72, label: 'origin test' });
    const before = intervalSequence(s.original.sequence, { start: 5990, end: 71 });
    expect(intervalSequence(s.map!.doc.sequence, { start: 5991, end: 72 })).toBe(revComp(before));
  });

  it('Extract Region annotates each feature by its own overlap: T7 Terminator 1..47, not 1..143', () => {
    const s = crossingSession(['sequence:extract-region']);
    const ex = s.viewer!.doc;
    expect(ex.name).toBe('pET-28a(+)-eGFP_5990_71');
    expect(ex.sequence).toBe(s.original.sequence.slice(5989) + s.original.sequence.slice(0, 71));
    const t7 = s.original.features.find((f) => f.name === 'T7 Terminator')!;
    expect([t7.start, t7.end]).toEqual([5989, 6036]);
    const got = ex.features.find((f) => f.name === 'T7 Terminator')!;
    expect([got.start, got.end, got.strand]).toEqual([1, 47, t7.strand]);
    // Every extracted feature covers the same bases as its source does inside the selection.
    for (const f of ex.features) {
      const src = s.original.features.find((x) => `${x.id}-ext-5990` === f.id)!;
      expect(src, `${f.name} comes from the source`).toBeDefined();
      const srcStart = ((f.start - 1 + 5989) % 6061) + 1;
      expect(src.start <= src.end ? srcStart >= src.start && srcStart <= src.end : srcStart >= src.start || srcStart <= src.end).toBe(true);
    }
  });
});

describe('BG-01M7CG2W round 2: the view pins', () => {
  const circ: SequenceDocument = { ...puc19, sequence: SEQ_6061, features: [], primers: [], topology: 'circular' };

  it('highlights exactly the bases of a crossing selection in the base rows', async () => {
    const { LinearSequenceView } = await import('../components/LinearSequenceView');
    const html = renderToStaticMarkup(
      <LinearSequenceView doc={circ} cutSites={[]} selectedRange={{ start: 5990, end: 71 }} onSelectRange={() => {}} onUpdateDocument={() => {}} />
    );
    const spans = [...html.matchAll(/<span data-pos="(\d+)" class="([^"]*)"/g)].map((m) => [Number(m[1]), m[2].includes('sel-base')] as const);
    expect(spans.length, 'the rows draw bases').toBeGreaterThan(0);
    expect(spans.some(([pos]) => pos >= 5990), 'the page holds the selection start').toBe(true);
    for (const [pos, sel] of spans) expect(sel, `base ${pos}`).toBe(pos >= 5990 || pos <= 71);
  });

  it('never prefills a crossing selection into the Add Feature form', async () => {
    const { LinearSequenceView } = await import('../components/LinearSequenceView');
    let opened = false;
    probe.onElement = (type, props) => {
      if (!opened && type === 'button' && typeof props.onClick === 'function' && String(props.children ?? '').includes('Add Annotation')) {
        opened = true;
        (props.onClick as () => void)();
      }
    };
    const html = renderToStaticMarkup(
      <LinearSequenceView doc={circ} cutSites={[]} selectedRange={{ start: 5990, end: 71 }} onSelectRange={() => {}} onUpdateDocument={() => {}} />
    );
    probe.onElement = null;
    expect(opened, 'the + Add Annotation button was pressed').toBe(true);
    const values = [...html.matchAll(/<input[^>]*type="number"[^>]*value="(\d+)"/g)].map((m) => Number(m[1]));
    expect(values, 'the form is open').not.toHaveLength(0);
    expect(values).not.toContain(5990);
    expect(values).not.toContain(71);
  });

  it('lists the unique cutters inside a crossing span and none outside it', async () => {
    const { ConstructCockpitBar } = await import('../components/ConstructCockpitBar');
    const site = (name: string, position: number) =>
      ({ id: name, enzyme: { name } as never, position, cutTop: position, cutBottom: position, strand: 1, overhangSeq: '', overhangType: 'blunt', methylationBlocked: false }) as const;
    const html = renderToStaticMarkup(
      <ConstructCockpitBar doc={circ} cutSites={[site('Inside1', 30), site('Inside2', 6050), site('Outside', 3000)]}
        selectedRange={{ start: 5990, end: 71 }} onSelectRange={() => {}} />
    );
    const cutters = textOf(/1× Cutters:[\s\S]*?<\/span>/.exec(html)?.[0] ?? '');
    expect(cutters).toContain('Inside1');
    expect(cutters).toContain('Inside2');
    expect(cutters).not.toContain('Outside');
  });
});

describe('BG-01M7CG2W round 2: a cancelled row drag puts back the crossing selection as it was', () => {
  it('restores 5990..71 with its label through the view, not 71..5990', async () => {
    const { LinearSequenceView } = await import('../components/LinearSequenceView');
    const circ: SequenceDocument = { ...puc19, sequence: SEQ_6061, features: [], primers: [], topology: 'circular' };
    const before = { start: 5990, end: 71, label: 'origin test' };
    const selections: unknown[] = [];
    let rows: Record<string, (e: unknown) => void> | null = null;
    probe.onElement = (_type, props) => {
      if (typeof props.onPointerDown === 'function' && typeof props.onPointerCancel === 'function' && props.onLostPointerCapture === props.onPointerCancel && 'onClickCapture' in props) {
        rows = props as unknown as Record<string, (e: unknown) => void>;
      }
    };
    renderToStaticMarkup(
      <LinearSequenceView doc={circ} cutSites={[]} selectedRange={before} onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />
    );
    probe.onElement = null;
    expect(rows, 'the rows take pointer events').not.toBeNull();
    const anything: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything, set: () => true });
    const event = (pos: number, x: number) => ({
      button: 0, pointerId: 7, clientX: x, clientY: 10, preventDefault() {}, stopPropagation() {},
      target: { closest: () => ({ getAttribute: () => String(pos) }) },
      currentTarget: anything,
    });
    rows!.onPointerDown(event(100, 0));
    rows!.onPointerMove(event(140, 80));
    expect(selections.length, 'the drag selected').toBeGreaterThan(0);
    rows!.onPointerCancel(event(140, 80));
    expect(selections.at(-1)).toEqual(before);
  });
});
