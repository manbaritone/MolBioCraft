// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC3B: clicking a restriction marker in the linear map selects the recognition span, as it
 * did, and opens a cleavage preview of that one site: the enzyme, the matched site with its 1-based
 * coordinates and orientation, the top strand 5'->3' over the bottom strand 3'->5' with a ▼ at the
 * top strand's cut and a ▲ at the bottom strand's (the Enzymes View's marks), and the end the cut
 * leaves. Every site is the real engine's record (findRestrictionCutSites over
 * public/molbiocraft_wasm.wasm); every expected strand is written out by hand from the enzyme's
 * published cleavage (EcoRI G^AATTC, PstI CTGCA^G, SmaI CCC^GGG, AciI C^CGC, BsaI GGTCTC(1/5),
 * XbaI T^CTAGA). Each strand carries one blank column where the other strand is cut, so the two
 * stay aligned base for base.
 *
 * Components are rendered with renderToStaticMarkup. The map's own handlers are driven through
 * the elements its render creates (the in-render harness of sequenceSplitView.test.tsx): a state
 * update made while the view renders re-renders it with that update.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Sees every effect a component registers while it renders (server rendering runs none). */
  onEffect: null as null | ((effect: () => unknown) => void),
}));

// The preview's open effect is read off its `useEffect` and run by hand on stand-in elements.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useEffect = ((effect: Parameters<typeof actual.useEffect>[0], deps?: Parameters<typeof actual.useEffect>[1]) => {
    probe.onEffect?.(effect);
    return actual.useEffect(effect, deps);
  }) as typeof actual.useEffect;
  return { ...actual, default: { ...actual, useEffect }, useEffect };
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

const { CleavagePreview } = await import('../components/CleavagePreview');
const { LinearSequenceView, cutBoundaryInRow, revealSelectedRow } = await import('../components/LinearSequenceView');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SequenceDocument = import('../types/bio').SequenceDocument;
type RestrictionCutSite = import('../types/bio').RestrictionCutSite;
type CleavageCut = import('../core/restrictionDisplay').CleavageCut;

afterEach(() => {
  probe.onElement = null;
  probe.onEffect = null;
  vi.unstubAllGlobals();
});

// ─── Helpers ───

const enzymeNamed = (name: string) => {
  const enz = REBASE_ENZYMES.find((e) => e.name === name);
  if (!enz) throw new Error(`no catalogue enzyme ${name}`);
  return enz;
};

/** The engine's one site of `enzyme` on `seq`. */
function engineSite(seq: string, topology: 'circular' | 'linear', enzyme: string): RestrictionCutSite {
  const sites = findRestrictionCutSites(seq, topology, [enzymeNamed(enzyme)]);
  expect(sites).toHaveLength(1);
  return sites[0];
}

const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The words markup shows: tags and comments dropped, entities decoded, spaces collapsed. */
const wordsOf = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** One strand line of the preview, exactly as drawn (its spaces kept). */
const strandOf = (html: string, strand: 'top' | 'bottom') => {
  const m = new RegExp(`data-strand="${strand}"[^>]*>([\\s\\S]*?)</code>`).exec(html);
  expect(m, `the ${strand} strand is drawn`).not.toBeNull();
  return decode(m![1].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''));
};

const previewOf = (seq: string, topology: 'circular' | 'linear', enzyme: string, flank = 2) => {
  const site = engineSite(seq, topology, enzyme);
  const html = renderToStaticMarkup(
    <CleavagePreview site={site} sequence={seq} circular={topology === 'circular'} flank={flank} onClose={() => {}} />,
  );
  return { site, html, words: wordsOf(html), top: strandOf(html, 'top'), bottom: strandOf(html, 'bottom') };
};

const docOf = (sequence: string, topology: 'linear' | 'circular' = 'linear'): SequenceDocument => ({
  id: 'doc-cleave', name: 'cleave', accession: '', description: '', moleculeType: 'DNA', topology, sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'],
});

const isCutPill = (type: unknown, props: Record<string, unknown>) =>
  type === 'span' && /(^| )cut-pill( |$)/.test(String(props.className ?? ''));

type Gesture = 'click' | 'Enter' | ' ' | 'a';
interface FakeMarker { focus: ReturnType<typeof vi.fn> }

/**
 * The linear map of `seq` with its engine sites of `enzymes`, one cut marker driven by `gesture`
 * on the first pass that draws it; `then` runs on every element created afterwards.
 */
function driveMap(
  seq: string,
  enzymes: string[],
  gesture: Gesture | null,
  opts: { pick?: string; then?: ElementProbe; selectedRange?: { start: number; end: number; label?: string } } = {},
) {
  const doc = docOf(seq);
  const cutSites = findRestrictionCutSites(seq, 'linear', enzymes.map(enzymeNamed));
  const selections: { start: number; end: number; label?: string }[] = [];
  const marker: FakeMarker = { focus: vi.fn() };
  const markers: Record<string, unknown>[] = [];
  let prevented = 0;
  let driven = false;
  probe.onElement = (type, props) => {
    if (isCutPill(type, props)) {
      markers.push(props);
      const isPick = !opts.pick || String(props.children).includes(opts.pick) || String(props['aria-label']).includes(opts.pick);
      if (gesture && !driven && isPick) {
        driven = true;
        const event = { key: gesture, currentTarget: marker, target: marker, preventDefault: () => { prevented++; }, stopPropagation() {} };
        if (gesture === 'click') (props.onClick as (e: object) => void)(event);
        else (props.onKeyDown as (e: object) => void)(event);
        return;
      }
    }
    if (driven) opts.then?.(type, props);
  };
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={cutSites} selectedRange={opts.selectedRange ?? null}
      onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />,
  );
  probe.onElement = null;
  return { html, words: wordsOf(html), selections, marker, markers, prevented: () => prevented, driven };
}

const dialogsIn = (html: string) => html.match(/role="dialog"/g)?.length ?? 0;

// ─── AC1 ───

describe('US-01M7CC3B AC1 the preview shows the site, both strands, both cuts and the end', () => {
  it('EcoRI: 5\' overhang AATT, ▼ after the G on the top strand and ▲ before the G on the bottom', () => {
    const p = previewOf('TTTTGAATTCTTTT', 'linear', 'EcoRI');
    expect(p.html).toContain('role="dialog"');
    expect(p.html).toContain('aria-label="EcoRI cleavage preview"');
    expect(p.top).toBe("5'-TTG▼AATT CTT-3'");
    expect(p.bottom).toBe("3'-AAC TTAA▲GAA-5'");
    expect(p.top.length).toBe(p.bottom.length);
    expect(p.words).toContain('EcoRI');
    expect(p.words).toContain('Site GAATTC, bases 5–10, forward (+) strand');
    expect(p.words).toContain('Top strand cut after base 5; bottom strand cut after base 9');
    expect(p.words).toContain("5' overhang, 4 nt: AATT");
  });

  it("PstI: 3' overhang TGCA, the bottom strand cut first", () => {
    const p = previewOf('TTTTCTGCAGTTTT', 'linear', 'PstI');
    expect(p.top).toBe("5'-TTC TGCA▼GTT-3'");
    expect(p.bottom).toBe("3'-AAG▲ACGT CAA-5'");
    expect(p.words).toContain('Site CTGCAG, bases 5–10, forward (+) strand');
    expect(p.words).toContain("3' overhang, 4 nt: TGCA");
    expect(p.words).not.toContain("5' overhang");
  });

  it('SmaI: a blunt end, both marks in one column', () => {
    const p = previewOf('TTTTCCCGGGTTTT', 'linear', 'SmaI');
    expect(p.top).toBe("5'-TTCCC▼GGGTT-3'");
    expect(p.bottom).toBe("3'-AAGGG▲CCCAA-5'");
    expect(p.words).toContain('Blunt end');
    expect(p.words).not.toMatch(/overhang/i);
  });

  it('AciI matched on the reverse strand reads its motif on the bottom strand', () => {
    const p = previewOf('TTTTGCGGTTTT', 'linear', 'AciI');
    expect(p.site.strand).toBe(-1);
    expect(p.top).toBe("5'-TTG▼CG GTT-3'");
    expect(p.bottom).toBe("3'-AAC GC▲CAA-5'");
    expect(p.words).toContain("Site GCGG, bases 5–8, reverse (−) strand: CCGC read 5'→3' on the bottom strand");
    expect(p.words).toContain('Top strand cut after base 5; bottom strand cut after base 7');
    expect(p.words).toContain("5' overhang, 2 nt: CG");
  });

  it('an EcoRI site across base 1 of a circle gives wrapped coordinates', () => {
    const p = previewOf('ATTCAAAAAAAAAAAAAAAAGA', 'circular', 'EcoRI');
    expect(p.top).toBe("5'-AAG▼AATT CAA-3'");
    expect(p.bottom).toBe("3'-TTC TTAA▲GTT-5'");
    expect(p.words).toContain('Site GAATTC, bases 21–4, forward (+) strand');
    expect(p.words).toContain('across the origin');
    expect(p.words).toContain('Top strand cut after base 21; bottom strand cut after base 3');
    expect(p.words).toContain("5' overhang, 4 nt: AATT");
  });

  it('a site that stays inside the molecule says nothing of the origin', () => {
    expect(previewOf('ATTCAAAAGAATTCAAAAAAAA', 'circular', 'EcoRI').words).not.toContain('origin');
  });

  it('clicking a cut marker in the linear map opens the preview of that site', () => {
    const shut = driveMap('TTTTGAATTCTTTT', ['EcoRI'], null);
    expect(dialogsIn(shut.html), 'no preview before a click').toBe(0);
    const open = driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'click');
    expect(open.driven).toBe(true);
    expect(dialogsIn(open.html)).toBe(1);
    expect(open.html).toContain('aria-label="EcoRI cleavage preview"');
    // The map's default flank shows the whole 14-bp molecule.
    expect(strandOf(open.html, 'top')).toBe("5'-TTTTG▼AATT CTTTT-3'");
    expect(strandOf(open.html, 'bottom')).toBe("3'-AAAAC TTAA▲GAAAA-5'");
  });

  it('in a dense row the preview shows only the site clicked', () => {
    // EcoRI GAATTC and XbaI TCTAGA share a row; the XbaI marker is clicked.
    const run = driveMap('TTGAATTCTTTCTAGATT', ['EcoRI', 'XbaI'], 'click', { pick: 'XbaI' });
    expect(run.markers.length).toBeGreaterThanOrEqual(2);
    expect(dialogsIn(run.html)).toBe(1);
    expect(run.html).toContain('aria-label="XbaI cleavage preview"');
    expect(run.html).not.toContain('aria-label="EcoRI cleavage preview"');
  });
});

// ─── AC2 ───

describe('US-01M7CC3B AC2 Type IIS cuts outside the motif and methylation-blocked sites', () => {
  it('BsaI GGTCTC(1/5) is drawn cutting 1 and 5 nt past the motif, never clamped into it', () => {
    const p = previewOf('AAAAGGTCTCAAAAAAAAAAAAAA', 'linear', 'BsaI-HFv2');
    expect(p.top).toBe("5'-AAGGTCTCA▼AAAA AA-3'");
    expect(p.bottom).toBe("3'-TTCCAGAGT TTTT▲TT-5'");
    expect(p.words).toContain('Type IIS: cuts outside the GGTCTC motif, top strand 1 nt and bottom strand 5 nt from it');
    expect(p.words).toContain('Top strand cut after base 11; bottom strand cut after base 15');
    expect(p.words).toContain("5' overhang, 4 nt: AAAA");
  });

  it('a Type II site cutting inside its motif makes no Type IIS claim', () => {
    expect(previewOf('TTTTGAATTCTTTT', 'linear', 'EcoRI').words).not.toContain('Type IIS');
  });

  it('a Dam-blocked XbaI site says methylation may block the cut', () => {
    const p = previewOf('TTTTCTCTAGATCTTTTT', 'linear', 'XbaI');
    expect(p.site.methylationBlocked).toBe(true);
    expect(p.words).toContain('Methylation may block this cut');
    expect(p.html).toMatch(/role="status"[^>]*>[^<]*Methylation may block this cut/);
  });

  it('a Dcm-blocked BsaI site is both Type IIS and methylation-blocked', () => {
    const p = previewOf('CCAGGTCTCAAAAAAAAAAAAA', 'linear', 'BsaI-HFv2');
    expect(p.site.methylationBlocked).toBe(true);
    expect(p.words).toContain('Methylation may block this cut');
    expect(p.words).toContain('Type IIS: cuts outside the GGTCTC motif');
  });

  it('an unmethylated XbaI site makes no methylation claim', () => {
    const p = previewOf('TTTTCTCTAGAAAAAAAA', 'linear', 'XbaI');
    expect(p.site.methylationBlocked).toBe(false);
    expect(p.words).not.toContain('Methylation may block');
  });
});

// ─── AC3 ───

describe('US-01M7CC3B AC3 the click still selects the recognition span, and its actions work', () => {
  it('selects the recognition span with the label it always had', () => {
    expect(driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'click').selections).toEqual([
      { start: 5, end: 10, label: 'EcoRI (5prime: AATT)' },
    ]);
    expect(driveMap('TTTTCCCGGGTTTT', ['SmaI'], 'click').selections).toEqual([
      { start: 5, end: 10, label: 'SmaI (blunt: blunt)' },
    ]);
    expect(driveMap('TTTTCTGCAGTTTT', ['PstI'], 'click').selections).toEqual([
      { start: 5, end: 10, label: 'PstI (3prime: TGCA)' },
    ]);
  });

  it('copy, annotate and extract act on that selection', () => {
    const seq = 'TTTTGAATTCTTTT';
    const [selection] = driveMap(seq, ['EcoRI'], 'click').selections;
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onExtract = vi.fn();
    const updates: SequenceDocument[] = [];
    let extractHandler: unknown;
    let annotated = false;
    let submitted = false;
    probe.onElement = (type, props) => {
      if (type !== 'button' && type !== 'form') return;
      if (props.title === "Copy selected 5'→3' sequence") (props.onClick as () => void)();
      if (props.title === 'Copy Reverse Complement of selected region') (props.onClick as () => void)();
      if (props.title === 'Extract selected region into a new sequence document') extractHandler = props.onClick;
      if (!annotated && props.title === 'Create a new feature annotation spanning the active selection') {
        annotated = true;
        (props.onClick as () => void)();
      }
      if (annotated && !submitted && type === 'form' && props.className === 'add-feature-drawer') {
        submitted = true;
        (props.onSubmit as (e: object) => void)({ preventDefault() {} });
      }
    };
    renderToStaticMarkup(
      <LinearSequenceView doc={docOf(seq)} cutSites={findRestrictionCutSites(seq, 'linear', [enzymeNamed('EcoRI')])}
        selectedRange={selection} onSelectRange={() => {}} onUpdateDocument={(d) => updates.push(d)}
        onExtractSelection={onExtract} />,
    );
    probe.onElement = null;
    expect(writeText.mock.calls.map((c) => c[0])).toContain('GAATTC');
    expect(writeText.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(extractHandler).toBe(onExtract);
    expect(submitted, 'Annotate opened the new-annotation form').toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].features.at(-1)).toMatchObject({ start: 5, end: 10 });
  });
});

// ─── AC4 ───

describe('US-01M7CC3B AC4 the keyboard opens the preview and Escape closes it, back on the marker', () => {
  it('each marker is a focusable, named button that opens a dialog', () => {
    const { markers } = driveMap('TTTTGAATTCTTTT', ['EcoRI'], null);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ role: 'button', tabIndex: 0, 'aria-haspopup': 'dialog', 'aria-expanded': false });
    expect(String(markers[0]['aria-label'])).toMatch(/^EcoRI \(5\) cut site/);
    expect(typeof markers[0].onKeyDown).toBe('function');
  });

  for (const key of ['Enter', ' '] as const) {
    it(`${key === ' ' ? 'Space' : key} on a focused marker selects the site and opens the preview`, () => {
      const run = driveMap('TTTTGAATTCTTTT', ['EcoRI'], key);
      expect(run.driven).toBe(true);
      expect(run.selections).toEqual([{ start: 5, end: 10, label: 'EcoRI (5prime: AATT)' }]);
      expect(dialogsIn(run.html)).toBe(1);
      expect(run.prevented(), 'the key does not also scroll or submit').toBeGreaterThan(0);
      expect(run.markers.at(-1)?.['aria-expanded']).toBe(true);
    });
  }

  it('another key on the marker opens nothing', () => {
    const run = driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'a');
    expect(run.selections).toEqual([]);
    expect(dialogsIn(run.html)).toBe(0);
  });

  it('Escape in the preview asks it closed; other keys do not', () => {
    const site = engineSite('TTTTGAATTCTTTT', 'linear', 'EcoRI');
    const onClose = vi.fn();
    let onKeyDown: ((e: object) => void) | undefined;
    probe.onElement = (type, props) => {
      if (props.role === 'dialog') onKeyDown = props.onKeyDown as (e: object) => void;
    };
    renderToStaticMarkup(<CleavagePreview site={site} sequence="TTTTGAATTCTTTT" circular={false} onClose={onClose} />);
    probe.onElement = null;
    expect(onKeyDown, 'the dialog listens for keys').toBeTypeOf('function');
    onKeyDown!({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
    expect(onClose).not.toHaveBeenCalled();
    onKeyDown!({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing the preview removes it and returns focus to the marker that opened it', () => {
    let closed = false;
    const run = driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'Enter', {
      then: (type, props) => {
        if (!closed && type === CleavagePreview) {
          closed = true;
          (props.onClose as () => void)();
        }
      },
    });
    expect(closed, 'the preview was drawn').toBe(true);
    expect(dialogsIn(run.html)).toBe(0);
    expect(run.marker.focus).toHaveBeenCalledTimes(1);
    expect(run.markers.at(-1)?.['aria-expanded']).toBe(false);
  });

  it('Escape on the marker itself closes an open preview and keeps focus there', () => {
    let escaped = false;
    const run = driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'Enter', {
      then: (type, props) => {
        if (!escaped && isCutPill(type, props)) {
          escaped = true;
          (props.onKeyDown as (e: object) => void)({ key: 'Escape', currentTarget: { focus: () => {} }, preventDefault() {}, stopPropagation() {} });
        }
      },
    });
    expect(escaped).toBe(true);
    expect(dialogsIn(run.html)).toBe(0);
    expect(run.selections).toHaveLength(1);
  });
});

// ─── US-01M7CCR2: the base rows mark the previewed site's cuts ───
//
// With a site's preview open (its marker clicked), the top strand's row carries a mark where the
// top strand is cut and the bottom strand's row one where the bottom strand is cut, at the
// boundaries the preview draws. Each row below is read back as text with ▼ for a top-strand mark
// and ▲ for a bottom-strand mark; every expected row is written out by hand from the enzyme's
// published cleavage. A view's rows hold 60 bases when no width has been measured (as here).

const T = (n: number) => 'T'.repeat(n);
const A = (n: number) => 'A'.repeat(n);

/** Each base row as drawn: its first coordinate, its top and bottom strands, ▼/▲ where the marks sit. */
function strandRows(html: string): { start: number; top: string; bottom: string }[] {
  return html.split('data-row-start="').slice(1).map((block) => {
    const line = (cls: string) => {
      const m = new RegExp(
        `class="seq-strand-line ${cls}"[\\s\\S]*?class="mono-bases[^"]*"[^>]*>([\\s\\S]*?)</span><span class="coord-gutter-right"`,
      ).exec(block);
      expect(m, `the ${cls} line is drawn`).not.toBeNull();
      return decode(
        m![1]
          .replace(/<span[^>]*data-cut-mark="top"[^>]*><\/span>/g, '▼')
          .replace(/<span[^>]*data-cut-mark="bottom"[^>]*><\/span>/g, '▲')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<[^>]+>/g, ''),
      );
    };
    return { start: Number(block.slice(0, block.indexOf('"'))), top: line('top-strand'), bottom: line('bottom-strand') };
  });
}

const isCutMark = (props: Record<string, unknown>) => props['data-cut-mark'] === 'top' || props['data-cut-mark'] === 'bottom';
const isShowCutMarks = (type: unknown, props: Record<string, unknown>) => type === 'input' && props.type === 'checkbox' && props['data-cut-marks-toggle'] === true;

/**
 * The sequence view of `seq` with its one engine site of `enzyme`: the site's marker is clicked
 * (unless `click` is false) on the first pass that draws it, and `then` sees every element created
 * after that click.
 */
function viewSite(
  seq: string,
  topology: 'circular' | 'linear',
  enzyme: string,
  opts: { click?: boolean; then?: ElementProbe; selectedRange?: { start: number; end: number } | null } = {},
) {
  const cutSites = findRestrictionCutSites(seq, topology, [enzymeNamed(enzyme)]);
  expect(cutSites, `one ${enzyme} site`).toHaveLength(1);
  const selections: { start: number; end: number; label?: string }[] = [];
  let driven = false;
  probe.onElement = (type, props) => {
    if (opts.click !== false && !driven && isCutPill(type, props)) {
      driven = true;
      const marker = { focus() {} };
      (props.onClick as (e: object) => void)({ currentTarget: marker, target: marker, preventDefault() {}, stopPropagation() {} });
      return;
    }
    if (driven || opts.click === false) opts.then?.(type, props);
  };
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={docOf(seq, topology)} cutSites={cutSites} selectedRange={opts.selectedRange ?? null}
      onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />,
  );
  probe.onElement = null;
  return { html, rows: strandRows(html), selections, driven };
}

/** A session store that holds what is written to it. */
const sessionStore = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
  };
};

/** Flip the 'Show cut marks' box (to `checked`) the first `times` passes it is drawn after the click. */
const flipCutMarks = (sequence: boolean[]): ElementProbe => {
  let i = 0;
  return (type, props) => {
    if (i < sequence.length && isShowCutMarks(type, props)) {
      (props.onChange as (e: object) => void)({ target: { checked: sequence[i] }, currentTarget: { checked: sequence[i] } });
      i++;
    }
  };
};

describe('US-01M7CCR2 AC1 the base rows mark both cuts where the preview draws them', () => {
  it('no marks are drawn before a site is clicked', () => {
    const v = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { click: false });
    expect(v.rows).toEqual([{ start: 1, top: 'TTTTGAATTCTTTT', bottom: 'AAAACTTAAGAAAA' }]);
  });

  it("EcoRI G^AATTC: ▼ after the G on the top strand, ▲ before the G on the bottom, as in its preview", () => {
    const v = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI');
    expect(v.driven).toBe(true);
    expect(dialogsIn(v.html)).toBe(1);
    expect(v.rows).toEqual([{ start: 1, top: 'TTTTG▼AATTCTTTT', bottom: 'AAAACTTAA▲GAAAA' }]);
    // The preview drawn beside them places the same two cuts.
    expect(strandOf(v.html, 'top')).toBe("5'-TTTTG▼AATT CTTTT-3'");
    expect(strandOf(v.html, 'bottom')).toBe("3'-AAAAC TTAA▲GAAAA-5'");
  });

  it("PstI CTGCA^G: the top strand is cut after the A and the bottom after base 5, not the other way round", () => {
    const v = viewSite('TTTTCTGCAGTTTT', 'linear', 'PstI');
    expect(v.rows).toEqual([{ start: 1, top: 'TTTTCTGCA▼GTTTT', bottom: 'AAAAG▲ACGTCAAAA' }]);
  });

  it('BsaI GGTCTC(1/5): the marks sit 1 and 5 nt past the motif, outside it', () => {
    const v = viewSite('AAAAGGTCTCAAAAAAAAAAAAAA', 'linear', 'BsaI-HFv2');
    expect(v.rows).toEqual([
      { start: 1, top: 'AAAAGGTCTCA▼AAAAAAAAAAAAA', bottom: 'TTTTCCAGAGTTTTT▲TTTTTTTTT' },
    ]);
  });

  it('an EcoRI site across a row break: ▼ in the first row, ▲ in the next', () => {
    // GAATTC at 58-63: the top strand is cut after 58 (row 1), the bottom after 62 (row 2).
    const v = viewSite(T(57) + 'GAATTC' + T(17), 'linear', 'EcoRI');
    expect(v.rows).toEqual([
      { start: 1, top: T(57) + 'G▼AA', bottom: A(57) + 'CTT' },
      { start: 61, top: 'TTC' + T(17), bottom: 'AA▲G' + A(17) },
    ]);
  });

  it('a BsaI motif closing one row marks both its cuts in the next row, not the motif\'s', () => {
    // GGTCTC at 55-60: cuts after 61 and 65.
    const v = viewSite(A(54) + 'GGTCTC' + A(20), 'linear', 'BsaI-HFv2');
    expect(v.rows).toEqual([
      { start: 1, top: A(54) + 'GGTCTC', bottom: T(54) + 'CCAGAG' },
      { start: 61, top: 'A▼' + A(19), bottom: 'TTTTT▲' + T(15) },
    ]);
  });

  it('an EcoRI site across base 1 of a circle: ▼ before base 22, ▲ after base 3', () => {
    const v = viewSite('ATTC' + A(16) + 'GA', 'circular', 'EcoRI');
    expect(v.rows).toEqual([{ start: 1, top: 'ATTC' + A(16) + 'G▼A', bottom: 'TAA▲G' + T(16) + 'CT' }]);
  });

  it('a site across the origin of a 70 bp circle: ▼ in the last row, ▲ in the first', () => {
    // GAATTC at 68-70 and 1-3: the top strand is cut after 68, the bottom after 2.
    const v = viewSite('TTC' + A(64) + 'GAA', 'circular', 'EcoRI');
    expect(v.rows).toEqual([
      { start: 1, top: 'TTC' + A(57), bottom: 'AA▲G' + T(57) },
      { start: 61, top: A(7) + 'G▼AA', bottom: T(7) + 'CTT' },
    ]);
  });

  it("NlaIII CATG^ at the end of a linear molecule: ▼ after its last base, closing the row", () => {
    const v = viewSite('TTTTCATG', 'linear', 'NlaIII');
    expect(v.rows).toEqual([{ start: 1, top: 'TTTTCATG▼', bottom: 'AAAA▲GTAC' }]);
    expect(strandOf(v.html, 'top').replace(/ /g, '')).toBe("5'-TTTTCATG▼-3'");
  });

  it('a cut between two bases is marked once, in the row of the base after it', () => {
    const cut = (firstBaseAfter: number | null, position: number | null, available = true): CleavageCut =>
      ({ boundary: 0, available, position, firstBaseAfter, gapFromMotif: 0 });
    // Between bases 60 and 61: the start of row 61-120, not the end of row 1-60.
    expect(cutBoundaryInRow(cut(61, 60), 1, 60)).toBeNull();
    expect(cutBoundaryInRow(cut(61, 60), 61, 120)).toBe(0);
    expect(cutBoundaryInRow(cut(75, 74), 61, 120)).toBe(14);
    // Before base 1 of a circle: the start of the first row only.
    expect(cutBoundaryInRow(cut(1, 130), 1, 60)).toBe(0);
    expect(cutBoundaryInRow(cut(1, 130), 121, 130)).toBeNull();
    // After a linear molecule's last base, where no base follows: the end of its row.
    expect(cutBoundaryInRow(cut(null, 80), 61, 80)).toBe(20);
    expect(cutBoundaryInRow(cut(null, 80), 1, 60)).toBeNull();
    // Past an end of a linear molecule there is no DNA to cut, so no mark.
    expect(cutBoundaryInRow(cut(null, null, false), 61, 80)).toBeNull();
    expect(cutBoundaryInRow(cut(null, null, false), 1, 60)).toBeNull();
  });
});

describe("US-01M7CCR2 AC2 a 'Show cut marks' toggle hides and shows the marks for the session", () => {
  it("the toggle is a labelled checkbox, ticked to start with", () => {
    const boxes: Record<string, unknown>[] = [];
    const v = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', {
      click: false,
      then: (type, props) => { if (isShowCutMarks(type, props)) boxes.push(props); },
    });
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.at(-1)).toMatchObject({ type: 'checkbox', checked: true });
    expect(v.html).toMatch(/<label[^>]*><input type="checkbox"[^>]*data-cut-marks-toggle="true"[^>]*\/>Show cut marks<\/label>/);
  });

  it('unticking it hides the marks and keeps the selection and the open preview', () => {
    const range = { start: 5, end: 10 };
    const shown = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { selectedRange: range });
    const hidden = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { selectedRange: range, then: flipCutMarks([false]) });
    expect(hidden.rows).toEqual([{ start: 1, top: 'TTTTGAATTCTTTT', bottom: 'AAAACTTAAGAAAA' }]);
    expect(hidden.html).not.toContain('data-cut-mark=');
    // The selection is the click's alone: the toggle neither selects nor clears.
    expect(hidden.selections).toEqual([{ start: 5, end: 10, label: 'EcoRI (5prime: AATT)' }]);
    expect(hidden.html.match(/sel-base/g)?.length).toBe(6);
    expect(hidden.html.match(/sel-base/g)?.length).toBe(shown.html.match(/sel-base/g)?.length);
    expect(dialogsIn(hidden.html), 'the preview stays open').toBe(1);
  });

  it('ticking it again shows them again', () => {
    const v = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { then: flipCutMarks([false, true]) });
    expect(v.rows).toEqual([{ start: 1, top: 'TTTTG▼AATTCTTTT', bottom: 'AAAACTTAA▲GAAAA' }]);
  });

  it('the choice is kept for the session: a view opened later starts with it', () => {
    const store = sessionStore();
    vi.stubGlobal('sessionStorage', store);
    viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { then: flipCutMarks([false]) });
    expect([...store.data.values()]).toEqual(['0']);
    const later = viewSite('TTTTCTGCAGTTTT', 'linear', 'PstI');
    expect(later.rows).toEqual([{ start: 1, top: 'TTTTCTGCAGTTTT', bottom: 'AAAAGACGTCAAAA' }]);
    expect(dialogsIn(later.html)).toBe(1);
    viewSite('TTTTCTGCAGTTTT', 'linear', 'PstI', { then: flipCutMarks([true]) });
    expect([...store.data.values()]).toEqual(['1']);
    expect(viewSite('TTTTCTGCAGTTTT', 'linear', 'PstI').rows[0].top).toBe('TTTTCTGCA▼GTTTT');
  });

  it('with no session store the marks show and the toggle still works', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });
    expect(viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI').rows[0].top).toBe('TTTTG▼AATTCTTTT');
    expect(viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { then: flipCutMarks([false]) }).rows[0].top).toBe('TTTTGAATTCTTTT');
  });
});

describe('US-01M7CCR2 AC3 the marks take no pointer events, so the bases under them click as before', () => {
  it('every mark is pointer-events: none, hidden from assistive tech, and has no handler of its own', () => {
    const marks: Record<string, unknown>[] = [];
    viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', { then: (_t, props) => { if (isCutMark(props)) marks.push(props); } });
    expect(marks.map((m) => m['data-cut-mark']).sort()).toEqual(['bottom', 'top']);
    for (const m of marks) {
      expect((m.style as React.CSSProperties | undefined)?.pointerEvents).toBe('none');
      expect(m['aria-hidden']).toBe('true');
      expect(Object.keys(m).filter((k) => /^on[A-Z]/.test(k))).toEqual([]);
      expect(m.children).toBeUndefined();
    }
  });

  it('the bases either side of a mark select from themselves, as with no mark there', () => {
    const clickBases = (click: boolean) => {
      const handlers: (() => void)[] = [];
      const v = viewSite('TTTTGAATTCTTTT', 'linear', 'EcoRI', {
        click,
        then: (type, props) => {
          if (type === 'span' && /(^| )base-ch( |$)/.test(String(props.className ?? ''))) handlers.push(props.onClick as () => void);
        },
      });
      // The last pass draws the 14 bases, no more and no fewer.
      const last = handlers.slice(-14);
      expect(handlers.length % 14).toBe(0);
      v.selections.length = 0;
      last[4](); // G5, before the top-strand mark
      last[5](); // A6, after it
      last[9](); // C10, after the bottom-strand mark's column
      return v.selections;
    };
    const unmarked = clickBases(false);
    expect(unmarked).toEqual([{ start: 5, end: 14 }, { start: 6, end: 14 }, { start: 10, end: 14 }]);
    expect(clickBases(true)).toEqual(unmarked);
  });
});

// ─── US-01M7CC3B repair: the preview opens where it can be seen ───

/**
 * The preview of the EcoRI site of TTTTGAATTCTTTT drawn as the row of a scroll pane `paneHeight`
 * px tall, its open effects then run by hand on stand-ins for the dialog, its row and the pane.
 */
function openInPane(paneHeight: number) {
  const pane = { parentElement: null, clientHeight: paneHeight, style: { maxHeight: '', overflowY: '' }, focus: vi.fn() };
  const row = { parentElement: pane, style: { maxHeight: '', overflowY: '' }, focus: vi.fn() };
  const calls: string[] = [];
  const dialog = {
    parentElement: row,
    style: { maxHeight: '', overflowY: '' },
    scrollIntoView: vi.fn((o: object) => { calls.push(`scroll ${JSON.stringify(o)}`); }),
    focus: vi.fn((o?: object) => { calls.push(`focus ${JSON.stringify(o)}`); }),
  };
  vi.stubGlobal('getComputedStyle', (e: object) => ({ overflowY: e === pane ? 'auto' : 'visible' }));
  const effects: (() => unknown)[] = [];
  let refs = 0;
  probe.onEffect = (effect) => effects.push(effect);
  probe.onElement = (_type, props) => {
    if (props.role === 'dialog' && props.ref && typeof props.ref === 'object') {
      refs++;
      (props.ref as { current: unknown }).current = dialog;
    }
  };
  const site = engineSite('TTTTGAATTCTTTT', 'linear', 'EcoRI');
  renderToStaticMarkup(<CleavagePreview site={site} sequence="TTTTGAATTCTTTT" circular={false} onClose={() => {}} />);
  probe.onEffect = null;
  probe.onElement = null;
  expect(refs, 'the dialog carries the ref its effect reads').toBe(1);
  expect(effects.length, 'the preview registers an open effect').toBeGreaterThan(0);
  for (const effect of effects) effect();
  return { dialog, pane, calls };
}

describe('US-01M7CC3B AC1 the opened preview is brought into sight in the rows pane', () => {
  it('scrolls the dialog into view within its pane by the least distance', () => {
    const { dialog, calls } = openInPane(160);
    expect(dialog.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(dialog.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    expect(calls[0], 'it scrolls before it takes focus').toMatch(/^scroll /);
  });

  it('caps the dialog to the pane it opens in, so the whole of it fits there', () => {
    // A 160 px pane, as the Sample Project split layout gives at 1440x900, less the dialog's
    // 4 px and 6 px margins.
    const short = openInPane(160);
    expect(short.dialog.style).toEqual({ maxHeight: '150px', overflowY: 'auto' });
    const tall = openInPane(420);
    expect(tall.dialog.style.maxHeight).toBe('410px');
  });

  it('in a map of more than one row only the clicked site\'s row draws the dialog', () => {
    // EcoRI at 5 (row 1-60) and at 91 (row 61-120); the second marker is clicked.
    const seq = `TTTTGAATTC${'T'.repeat(80)}GAATTC${'T'.repeat(30)}`;
    const run = driveMap(seq, ['EcoRI'], 'click', { pick: 'EcoRI (91)' });
    expect(run.driven).toBe(true);
    expect(run.selections).toEqual([{ start: 91, end: 96, label: 'EcoRI (5prime: AATT)' }]);
    expect(dialogsIn(run.html)).toBe(1);
    expect(run.html.match(/id="cleavage-preview-doc-cleave"/g)).toHaveLength(1);
    const dialogAt = run.html.indexOf('role="dialog"');
    expect(dialogAt).toBeGreaterThan(run.html.indexOf('data-row-start="61"'));
    expect(run.html.indexOf('data-row-start="1"')).toBeLessThan(run.html.indexOf('data-row-start="61"'));
  });
});

describe('US-01M7CC3B AC1 following the selection leaves an opened preview in sight', () => {
  /** A rows pane 160 px tall whose selected row (top strand at 300 px, out of view) may hold the preview. */
  const paneWithRow = (holdsPreview: boolean) => {
    const rect = (top: number, height: number) => () => ({ top, bottom: top + height });
    const strand = { getBoundingClientRect: rect(300, 16) };
    const row = {
      getBoundingClientRect: rect(200, 200),
      querySelector: (sel: string) => (sel === '.top-strand' ? strand : sel === '.mbc-cleavage-preview' && holdsPreview ? {} : null),
    };
    const scroller = {
      scrollTop: 1000,
      getBoundingClientRect: rect(100, 160),
      querySelector: (sel: string) => (sel === '[data-row-start="61"]' ? row : null),
    };
    vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '0px' }));
    return scroller;
  };

  it('a row holding the open preview is not pulled to the top over it', () => {
    const scroller = paneWithRow(true);
    revealSelectedRow(scroller as unknown as HTMLElement, 61);
    expect(scroller.scrollTop).toBe(1000);
  });

  it('a selected row out of view without a preview is still scrolled to the top', () => {
    const scroller = paneWithRow(false);
    revealSelectedRow(scroller as unknown as HTMLElement, 61);
    expect(scroller.scrollTop).toBe(1100);
  });
});

describe('US-01M7CC3B AC4 focus moves into the opened preview, and a stray Escape does nothing', () => {
  it('the open effect puts focus in the dialog without a second scroll', () => {
    const { dialog } = openInPane(160);
    expect(dialog.focus).toHaveBeenCalledTimes(1);
    expect(dialog.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('Escape on a marker with no open preview selects, opens and focuses nothing', () => {
    const run = driveMap('TTTTGAATTCTTTT', ['EcoRI'], 'Escape' as Gesture);
    expect(run.driven).toBe(true);
    expect(run.selections).toEqual([]);
    expect(dialogsIn(run.html)).toBe(0);
    expect(run.prevented(), 'the key is left to the page').toBe(0);
    expect(run.marker.focus).not.toHaveBeenCalled();
  });
});
