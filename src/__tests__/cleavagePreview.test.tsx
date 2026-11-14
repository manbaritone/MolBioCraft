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
}));

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
const { LinearSequenceView } = await import('../components/LinearSequenceView');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
type SequenceDocument = import('../types/bio').SequenceDocument;
type RestrictionCutSite = import('../types/bio').RestrictionCutSite;

afterEach(() => {
  probe.onElement = null;
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
