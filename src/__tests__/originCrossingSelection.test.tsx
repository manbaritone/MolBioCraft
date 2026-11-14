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
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));

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
