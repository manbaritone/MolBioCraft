// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7CG2W: clicking an ORF that runs across the origin of a circular molecule selects the ORF
 * itself (start > end), not the complementary arc between its ends. The map is rendered for real
 * and the click handler is taken from the ORF arc's own element as the map creates it.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';

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
      if (type === CircularPlasmidMap) map = seen;
      viewer = seen;
      if (sessionOpened && !selected && type === CircularPlasmidMap && seen.doc.name === 'pET-28a(+)-eGFP') {
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

const { App } = await import('../App');
const { intervalSequence } = await import('../core/activeInterval');

describe('BG-01M7CG2W round 2: the App readers of an origin-crossing selection, at their call sites', () => {
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
