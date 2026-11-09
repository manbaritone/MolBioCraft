// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6T6RZ: a stored primer record whose anneal sequence holds N or another ambiguity base has no
 * Tm, and the engine says why in its `tmNoAnswerReason` (BG-01M6SHQ0):
 *
 *   "Tm n/a: the span holds <k> N or other ambiguity base(s); Tm is computed on A/C/G/T only, as
 *   Primer3 does"
 *
 * Eleven displays of a stored primer's Tm printed the record's number whatever its reason. Each now
 * reads the reason for such a primer and its number otherwise, at the precision it gave before: the
 * number as stored (a whole-number Tm reads "62", a degenerate primer's midpoint 57.65 reads "57.65")
 * at every site but the Design Primers note, which gives one decimal ("64.0"). The Primer studio's
 * cataloged-primer column, headed "Tm (°C)", gives the number without "Tm" before it ("62°C").
 *
 * Every record comes from the real WASM engine (Selection to Oligo and Design Primers on a seeded
 * template holding one N; the Primer studio's designed pair both without 5′ tails and with its
 * BsaI-HFv2 tails, so the reverse primer's full Tm differs from its anneal Tm), except the
 * degenerate primer, written here as Design Degenerate Primers stores one: ambiguity codes in its
 * sequence, the midpoint of its A/C/G/T versions' Tm range, and no reason, so it keeps its number.
 * Components are rendered with renderToStaticMarkup; a click, a key, a hover or a pick in a select is
 * the handler the component hands the element, run as the element would run it. The App is restored
 * from its autosave and driven from inside its own render (see restrictionSiteCap).
 *
 * Wrong implementations these catch: a site that prints the number whatever the reason; one that
 * prints "Tm n/a" without the reason; one that rounds every Tm to one decimal ("62.0"), or gives
 * the Design Primers note the stored number ("64"); a reason worked out from the sequence,
 * which takes the Tm from the degenerate primer; a Primer studio pill that keeps the full Tm's
 * number beside an anneal Tm that has none, or that reads the anneal Tm as the full Tm; and a
 * cataloged-primer column that puts "Tm" before a number its header already names.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
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
      probe.onMenus?.(trees, (id) => {
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

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const { App } = await import('../App');
const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
const { PrimerAndPCRStudio } = await import('../components/PrimerAndPCRStudio');
const { DesignPrimersOperationDialog } = await import('../components/SequenceOperationDialogs');
const { OperationDialog } = await import('../components/OperationDialog');
const { designPCRPrimers } = await import('../core/bioEngine');
const { convertSelectionToOligoPrimer } = await import('../core/workbenchBatchOperations');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
type SequenceDocument = import('../types/bio').SequenceDocument;
type PrimerRecord = import('../types/bio').PrimerRecord;

afterEach(() => {
  probe.onMenus = null;
  probe.onElement = null;
  storage.clear();
});

// ─── Markup, read as a tree ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses React's static markup (well formed, quoted attributes). */
function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, classes: new Set(), parent: null, children: [] };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { cur.children.push(decode(m[5])); continue; }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent: cur, children: [] };
    cur.children.push(node);
    if (node.tag === 'style' || node.tag === 'script') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      node.children.push(html.slice(re.lastIndex, end));
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (!selfClosing && !VOID.has(node.tag)) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}
function* walk(e: El): Generator<El> {
  yield e;
  for (const c of e.children) if (typeof c !== 'string') yield* walk(c);
}
const textOf = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
/** The words an element shows, its spaces collapsed. */
const wordsOf = (e: El) => textOf(e).replace(/\s+/g, ' ').trim();
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const childrenOf = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
/** The one element `pred` accepts. */
function one(root: El, pred: (e: El) => boolean, what: string): El {
  const found = findAll(root, pred);
  expect(found.length, `exactly one ${what}`).toBe(1);
  return found[0];
}

// ─── Fixtures: seeded, never committed ───

/** The shared reason, in the product seat's words, written out here rather than taken from the app. */
const ONE = 'Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does';

/** A fixed-seed A/C/G/T run, so no fixture files are needed. */
const acgt = (len: number, seed: number) => {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[x >>> 30];
  }
  return out;
};

const docOf = (name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id: `doc-${name}`, name, accession: '', description: '', moleculeType: 'DNA', topology: 'circular', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'], ...more,
});

/** 1,200 seeded bases, circular, with one N at base 106: inside a primer placed at 101. */
const REGION_START = 101;
const N_AT = 106;
const plainBases = acgt(1_200, 21);
const bare = docOf('Template', `${plainBases.slice(0, N_AT - 1)}N${plainBases.slice(N_AT)}`);

/** Selection to Oligo over `start`..`start + 19` of the template, as the engine makes it. */
const oligoAt = (start: number) => convertSelectionToOligoPrimer(bare, { start, end: start + 19 }, 1).primer;

/** The stored primer holding the N (101..120). */
const nPrimer = oligoAt(REGION_START);
/**
 * The first A/C/G/T 20-mer from base 200 whose Tm the engine gives as a whole number, so its number
 * as stored ("62") and its number to one decimal ("62.0") differ.
 */
const wholePrimer = (() => {
  for (let s = 200; s < 1_000; s++) {
    const p = oligoAt(s);
    if (Number.isInteger(p.tmAnnealC)) return p;
  }
  throw new Error('no 20-mer of the template has a whole-number Tm');
})();
/**
 * A degenerate primer as Design Degenerate Primers stores it (runDesignDegeneratePrimers): ambiguity
 * codes in its sequence, the midpoint of its A/C/G/T versions' Tm range as its Tm, and no reason.
 */
const degeneratePrimer: PrimerRecord = {
  id: 'prm-degenerate-f1', name: 'Degenerate_F1', sequence: 'GAGAACATCRGTGTCTCAYC', annealSequence: 'GAGAACATCRGTGTCTCAYC',
  tail5Prime: '', bindStart: 600, bindEnd: 619, strand: 1, length: 20, gcPercent: 50, tmAnnealC: 57.65, tmFullC: 57.65,
  deltaG37: -21.4, hairpinDeltaG: -0.8, selfDimerDeltaG: -5.1, gcClamp3Prime: true,
  notes: 'Degenerate primer from Design Degenerate Primers; pair 1; degeneracy 4; Tm 56.9–58.4 °C; product 412 columns',
};
const storedPrimers = [nPrimer, wholePrimer, degeneratePrimer];

/** The Tm words each stored primer's displays read, written out here. */
const tmWords = (p: PrimerRecord) =>
  p === nPrimer ? ONE : p === wholePrimer ? `Tm ${wholePrimer.tmAnnealC}°C` : 'Tm 57.65°C';

/**
 * The 5′ tails the Primer studio adds when BsaI-HFv2 is picked for both primers with its 3-nt
 * cleavage leader on (the default): GCG or CGC, then BsaI's site GGTCTC. They hold A/C/G/T only, so
 * the reverse primer's full Tm (tail included) is a number, and not its anneal Tm.
 */
const TAIL_ENZYME = 'BsaI-HFv2';
const FWD_TAIL = 'GCGGGTCTC';
const REV_TAIL = 'CGCGGTCTC';

/**
 * The first region end from base 700 at which Design Primers' reverse primer has a whole-number
 * anneal Tm, and a whole-number full Tm both without a tail and with REV_TAIL; the forward primer, at
 * 101, holds the N.
 */
const REGION_END = (() => {
  for (let e = 700; e < 1_000; e++) {
    const plain = designPCRPrimers(bare, REGION_START, e, 60, '', '', 0).reverse;
    const tailed = designPCRPrimers(bare, REGION_START, e, 60, FWD_TAIL, REV_TAIL, 0).reverse;
    if ([plain.tmAnnealC, plain.tmFullC, tailed.tmFullC].every(Number.isInteger)) return e;
  }
  throw new Error('no region end gives a whole-number reverse Tm');
})();
const designed = designPCRPrimers(bare, REGION_START, REGION_END, 60, '', '', 0);
/** The same pair with the studio's BsaI-HFv2 tails. */
const designedTailed = designPCRPrimers(bare, REGION_START, REGION_END, 60, FWD_TAIL, REV_TAIL, 0);

/** The template as a session holds it: a CDS over the region and the three stored primers. */
const template = docOf('Template', bare.sequence, {
  features: [{ id: 'feat-cds', name: 'orf', type: 'CDS', start: REGION_START, end: REGION_END, strand: 1, color: '#2e7d32' }],
  primers: storedPrimers,
});

describe('the fixtures', () => {
  it('come from the engine as the tests need them', () => {
    expect(nPrimer.annealSequence, 'the N primer holds one N').toMatch(/^[ACGT]*N[ACGT]*$/);
    expect(nPrimer.tmNoAnswerReason, "the engine's reason").toBe(ONE);
    expect(Number.isFinite(nPrimer.tmAnnealC), 'the number a wrong display shows').toBe(true);
    expect(wholePrimer.tmNoAnswerReason).toBeUndefined();
    expect(String(wholePrimer.tmAnnealC)).not.toBe(wholePrimer.tmAnnealC.toFixed(1));
    expect(designed.forward.tmNoAnswerReason, 'the designed forward primer holds the N').toBe(ONE);
    expect(Number.isFinite(designed.forward.tmFullC)).toBe(true);
    expect(designed.reverse.tmNoAnswerReason).toBeUndefined();
    expect(String(designed.reverse.tmAnnealC)).not.toBe(designed.reverse.tmAnnealC.toFixed(1));
    expect([designedTailed.forward.tail5Prime, designedTailed.reverse.tail5Prime], 'the tails the design adds').toEqual([FWD_TAIL, REV_TAIL]);
    expect(designedTailed.forward.tmNoAnswerReason, 'the tailed forward primer still holds the N').toBe(ONE);
    expect(designedTailed.reverse.tmNoAnswerReason).toBeUndefined();
    expect(designedTailed.reverse.tmAnnealC, 'a tail leaves the anneal Tm as it was').toBe(designed.reverse.tmAnnealC);
    expect(designedTailed.reverse.tmFullC, 'the full Tm a pill reading the anneal Tm would not show').not.toBe(designedTailed.reverse.tmAnnealC);
    expect(String(designedTailed.reverse.tmFullC)).not.toBe(designedTailed.reverse.tmFullC.toFixed(1));
  });
});

// ─── The circular map (CircularPlasmidMap.tsx) ───

/**
 * The template's circular map, primers shown; `onElement` sees each element it creates while it
 * renders. Returns its markup and the labels it hands onSelectRange.
 */
function renderMap(onElement?: ElementProbe) {
  const selected: (string | undefined)[] = [];
  probe.onElement = onElement ?? null;
  try {
    const html = renderToStaticMarkup(
      <CircularPlasmidMap doc={template} cutSites={[]} orfs={[]} selectedRange={null}
        onSelectRange={(r) => selected.push(r.label)} showOrfs={false} showPrimers showUniqueCuttersOnly={false} />,
    );
    return { root: parse(html), selected };
  } finally {
    probe.onElement = null;
  }
}

type Handlers = Record<string, unknown>;
/** The props of the callout labelling `p`: the clickable group whose title is the primer's. */
const isCallout = (p: PrimerRecord) => (type: unknown, props: Handlers) => {
  if (type !== 'g' || props.role !== 'button') return false;
  const first = ([] as unknown[]).concat(props.children)[0] as { type?: unknown; props?: { children?: unknown } } | undefined;
  return first?.type === 'title' && String(first.props?.children ?? '').startsWith(`Primer ${p.name}:`);
};
/** The props of `p`'s marker on the ring. */
const isMarker = (p: PrimerRecord) => (type: unknown, props: Handlers) =>
  type === 'circle' && String(props['aria-label'] ?? '').startsWith(`Select primer ${p.name} (`);

/** The props of the first element `pick` accepts, in one render of the map. */
function mapElement(pick: (type: unknown, props: Handlers) => boolean, what: string) {
  let found: Handlers | null = null;
  const { selected } = renderMap((type, props) => {
    if (!found && pick(type, props)) found = props;
  });
  expect(found, `the map draws ${what}`).not.toBeNull();
  return { props: found! as Handlers, selected };
}

describe("a stored primer's Tm on the circular map (BG-01M6T6RZ)", () => {
  it("circular map primer label: the callout's hover text", () => {
    const { root } = renderMap();
    for (const p of storedPrimers) {
      const titles = findAll(root, (e) => e.tag === 'title' && e.parent?.tag === 'g' && textOf(e).startsWith(`Primer ${p.name}:`));
      expect(titles.map(textOf), p.name).toEqual([`Primer ${p.name}: 5'-${p.sequence}-3' (${p.bindStart}..${p.bindEnd}, ${tmWords(p)})`]);
    }
  });

  it('circular map primer title: the label a click on the callout selects', () => {
    for (const p of storedPrimers) {
      const { props, selected } = mapElement(isCallout(p), `${p.name}'s callout`);
      (props.onClick as () => void)();
      expect(selected, p.name).toEqual([`Primer ${p.name} (${tmWords(p)})`]);
    }
  });

  it("circular map primer list row: the ring marker's hover readout", () => {
    for (const p of storedPrimers) {
      // The pointer enters the marker while the map renders, so the render shows what it set.
      let hovered = false;
      const { root } = renderMap((type, props) => {
        if (!hovered && isMarker(p)(type, props)) {
          hovered = true;
          (props.onMouseEnter as () => void)();
        }
      });
      expect(hovered, `the map draws ${p.name}'s marker`).toBe(true);
      const readout = `Primer ${p.name}: ${p.sequence} (${p.bindStart}..${p.bindEnd}, ${tmWords(p)})`;
      expect(wordsOf(one(root, (e) => e.classes.has('map-hover-readout'), 'hover readout')), p.name).toBe(readout);
      expect(wordsOf(one(root, (e) => e.classes.has('circular-hover-pill'), 'hover pill')), p.name).toBe(readout);
    }
  });

  it("circular map primer list Tm cell: the ring marker's accessible name", () => {
    const { root } = renderMap();
    for (const p of storedPrimers) {
      const marker = one(root, (e) => e.tag === 'circle' && (e.attrs['aria-label'] ?? '').startsWith(`Select primer ${p.name} (`), `${p.name}'s marker`);
      expect(marker.attrs['aria-label'], p.name).toBe(`Select primer ${p.name} (${p.bindStart} to ${p.bindEnd}, ${tmWords(p)})`);
    }
  });

  it('circular map primer tooltip: the label a click on the ring marker selects', () => {
    for (const p of storedPrimers) {
      const { props, selected } = mapElement(isMarker(p), `${p.name}'s marker`);
      (props.onClick as () => void)();
      expect(selected, p.name).toEqual([`Primer ${p.name} (${tmWords(p)})`]);
    }
  });

  it('circular map primer detail: the label Enter on the ring marker selects', () => {
    for (const p of storedPrimers) {
      const { props, selected } = mapElement(isMarker(p), `${p.name}'s marker`);
      let prevented = false;
      (props.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({ key: 'Enter', preventDefault: () => { prevented = true; } });
      expect(prevented).toBe(true);
      expect(selected, p.name).toEqual([`Primer ${p.name} (${tmWords(p)})`]);
    }
  });
});

// ─── The Primer studio (PrimerAndPCRStudio.tsx) ───

/**
 * The Primer studio's design tab on the template (its region: the CDS, 101..REGION_END). With
 * `tailEnzyme`, the forward and reverse 5′ tail selects each pick it once while the studio renders,
 * so the render shows what the picks set.
 */
function studio(tailEnzyme?: string): El {
  const picked: string[] = [];
  probe.onElement = (type, props) => {
    if (!tailEnzyme || type !== 'label') return;
    const [caption, select] = ([] as unknown[]).concat(props.children) as ({ type?: unknown; props?: Handlers } | undefined)[];
    const which = String(caption?.props?.children ?? '');
    if (select?.type !== 'select' || !/^5' (Forward|Reverse) Enzyme Tail:$/.test(which) || picked.includes(which)) return;
    picked.push(which);
    (select.props!.onChange as (e: { target: { value: string } }) => void)({ target: { value: tailEnzyme } });
  };
  let root: El;
  try {
    root = parse(renderToStaticMarkup(<PrimerAndPCRStudio doc={template} onUpdateDocument={() => {}} onAddConstruct={() => {}} />));
  } finally {
    probe.onElement = null;
  }
  expect(picked, 'the tail selects picked').toEqual(tailEnzyme ? ["5' Forward Enzyme Tail:", "5' Reverse Enzyme Tail:"] : []);
  return root;
}

describe("a stored primer's Tm in the Primer studio (BG-01M6T6RZ)", () => {
  it("primer studio primer table: the designed pair's Tm pill, anneal and full", () => {
    const pillsOf = (root: El) => findAll(root, (e) => e.classes.has('primer-detail-card')).map((c) => [
      wordsOf(childrenOf(one(c, (e) => e.classes.has('primer-card-top'), 'card top'))[0]),
      findAll(c, (e) => e.classes.has('tail-highlight')).map(wordsOf).join(''),
      wordsOf(one(c, (e) => e.classes.has('tm-pill'), 'Tm pill')),
    ]);
    // Untailed, the reverse primer's full Tm is its anneal Tm; with BsaI-HFv2 tails it is the whole
    // primer's Tm, another number, which a pill reading the anneal Tm for both would not show.
    const cases = [
      { tailEnzyme: undefined, pair: designed, tails: ['', ''] },
      { tailEnzyme: TAIL_ENZYME, pair: designedTailed, tails: [FWD_TAIL, REV_TAIL] },
    ];
    for (const { tailEnzyme, pair: { forward, reverse }, tails } of cases) {
      expect(pillsOf(studio(tailEnzyme)), tailEnzyme ?? 'no tails').toEqual([
        // The whole forward primer holds the N its anneal sequence holds, so neither has a Tm.
        [`Forward Primer: ${forward.name}`, tails[0], `Anneal ${ONE} | Full Tm n/a`],
        [`Reverse Primer: ${reverse.name}`, tails[1], `Anneal Tm ${reverse.tmAnnealC}°C | Full Tm ${reverse.tmFullC}°C`],
      ]);
    }
  });

  it("primer studio pair table: the cataloged primers' Tm column", () => {
    const root = studio();
    const table = one(root, (e) => e.tag === 'table' && findAll(e, (h) => h.tag === 'th' && wordsOf(h) === 'Tm (°C)').length === 1, 'cataloged primers table');
    const rows = findAll(table, (e) => e.tag === 'tr' && e.parent?.tag === 'tbody').map((tr) => {
      const cells = childrenOf(tr);
      return [wordsOf(one(cells[0], (e) => e.tag === 'strong', 'name')), wordsOf(cells[cells.length - 1])];
    });
    // The column's header names Tm and its unit, so a number reads without "Tm" before it, as it did
    // before; the reason keeps its own words.
    const cellWords = (p: PrimerRecord) => (p === nPrimer ? ONE : p === wholePrimer ? `${wholePrimer.tmAnnealC}°C` : '57.65°C');
    expect(rows).toEqual(storedPrimers.map((p) => [p.name, cellWords(p)]));
  });
});

// ─── The Design Primers dialog (SequenceOperationDialogs.tsx) ───

describe("a stored primer's Tm in the Design Primers note (BG-01M6T6RZ)", () => {
  it('primer dialog Tm: the note in the history and on the PCR product', () => {
    let run: ((v: Record<string, string | number | boolean>) => void) | null = null;
    probe.onElement = (type, props) => {
      if (type === OperationDialog) run = props.onRun as typeof run;
    };
    const updated: SequenceDocument[] = [];
    const created: SequenceDocument[] = [];
    renderToStaticMarkup(
      <DesignPrimersOperationDialog doc={bare} onUpdate={(d) => updated.push(d)} onCreate={(d) => created.push(d)} onClose={() => {}} />,
    );
    probe.onElement = null;
    expect(run, 'the dialog hands its window a Design action').not.toBeNull();
    run!({ regionStart: REGION_START, regionEnd: REGION_END, targetTm: 60, slack: 0, fwdTail: '', revTail: '', extractProduct: true });
    const { forward, reverse, ampliconLength } = designed;
    // The note's own precision: one decimal, so a whole-number Tm reads "64.0" where it is stored as 64.
    const note = `${ONE} / Tm ${reverse.tmAnnealC.toFixed(1)}°C, product ${ampliconLength.toLocaleString()} bp`;
    expect(created.map((d) => d.history[0].description), "the PCR product's history").toEqual([note]);
    expect(created[0].description).toBe(`PCR product of ${forward.name} + ${reverse.name} on ${bare.name}; ${note}`);
    expect(updated).toHaveLength(1);
    const history = updated[0].history[updated[0].history.length - 1];
    expect(history.description.startsWith(`${forward.name} + ${reverse.name}; ${note}`), history.description).toBe(true);
  });
});

// ─── The App (App.tsx) ───

/** The App restored on the template in `viewerTab`, with `selectedRange`, then running `then`. */
function restoreApp(viewerTab: 'sequence-view' | 'annotations-table', selectedRange: { start: number; end: number } | null, then?: string): El {
  expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Primer_Tm_Session',
    documents: [template],
    workspace: {
      activeDocId: template.id, selectedFolder: 'All Project Files', navHistory: [template.id], navIndex: 0,
      viewerTab, mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange,
      displaySettings: {
        showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
      },
    },
  }), 'the autosave is written').toBe(true);
  const steps = ['file:restore-autosave', ...(then ? [then] : [])];
  let ran = 0;
  let passes = 0;
  probe.onMenus = (_menus, dispatch) => {
    if (++passes > 25) throw new Error('the App kept re-rendering');
    if (ran < steps.length) dispatch(steps[ran++]);
  };
  const root = parse(renderToStaticMarkup(<App />));
  expect(ran, 'every step ran').toBe(steps.length);
  return root;
}

describe("a stored primer's Tm in the App (BG-01M6T6RZ)", () => {
  it('app primer record readout: the Selection to Oligo banner', () => {
    for (const p of [nPrimer, wholePrimer]) {
      const root = restoreApp('sequence-view', { start: p.bindStart, end: p.bindEnd }, 'primers:convert-to-oligo');
      const banners = findAll(root, (e) => e.classes.has('statusbar-toast-text')).map(wordsOf);
      expect(banners, p.name).toEqual([`Converted ${p.bindStart}..${p.bindEnd} to oligo "${p.name}" (${p.length} nt, ${tmWords(p)})`]);
    }
  });

  it("app primer list readout: the Annotations table's primer rows", () => {
    const root = restoreApp('annotations-table', null);
    const table = one(root, (e) => e.tag === 'table' && findAll(e, (h) => h.tag === 'th' && wordsOf(h) === 'Notes / Qualifiers').length === 1, 'annotations table');
    const rows = findAll(table, (e) => e.tag === 'tr' && e.parent?.tag === 'tbody')
      .map((tr) => childrenOf(tr))
      .filter((cells) => storedPrimers.some((p) => wordsOf(cells[0]) === p.name))
      .map((cells) => [wordsOf(cells[0]), wordsOf(cells[cells.length - 1])]);
    expect(rows).toEqual(storedPrimers.map((p) => [p.name, `5'-${p.sequence}-3' (${tmWords(p)})`]));
  });
});
