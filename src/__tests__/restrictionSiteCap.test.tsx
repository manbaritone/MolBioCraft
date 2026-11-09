// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1K2: past about 75 kb the engine's restriction scan stopped at 12,000 sites in all, so the
 * workbench listed frequent cutters as single cutters and enzymes that do cut as noncutters. The scan
 * now counts every site of every scanned enzyme and keeps only each enzyme's first sites by position;
 * the surfaces that classify or count enzymes read those counts, and a limit on the kept positions is
 * the engine's own warning, shown with the result.
 *
 * Every enzyme is checked against a direct count written in this file: its recognition site matched
 * base by base on both strands (an N in a site also matching an N in the sequence), across the origin
 * of a circle, and on a linear molecule only where both strands' cuts fall inside it. Nothing is
 * taken from the engine's scanner. The App is rendered on the server and driven from inside its own
 * render (see structureToolsWiring and documentRecordBar); the studios are rendered on their own.
 *
 * Wrong implementations this catches: the engine stopping at 12,000 sites in all (the 90 kb record
 * holds more than that, so late catalogue enzymes read 0 or 1 sites and the 1 Mb record's late NotI
 * sites are lost); a site total or per-enzyme count read from the kept positions (the GATC block and
 * the 1 Mb record give enzymes more sites than are kept); an Enzymes view that lists an enzyme the
 * scan did not read as a noncutter (over 100,000 bp only the core enzymes are scanned); and a cap with
 * no warning beside the result.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── App probes (installed before the App module is loaded) ───

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
const { CloningAndGelStudio } = await import('../components/CloningAndGelStudio');
const { HybridToolsAndHistoryStudio } = await import('../components/HybridToolsAndHistoryStudio');
const { CORE_CATALOG_LEN } = await import('../components/CircularPlasmidMap');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
const { auditSequenceAlerts, scanRestrictionSites } = await import('../core/bioEngine');
type SequenceDocument = import('../types/bio').SequenceDocument;
type RestrictionEnzyme = import('../types/bio').RestrictionEnzyme;

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
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const childrenOf = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
/** The one element `pred` accepts. */
function one(root: El, pred: (e: El) => boolean, what: string): El {
  const found = findAll(root, pred);
  expect(found.length, `exactly one ${what}`).toBe(1);
  return found[0];
}
/** The sentences of the result warnings labelled `label` (ResultWarnings), inside `root`. */
const warningsIn = (root: El, label: string) =>
  findAll(root, (e) => 'data-mbc-result-warnings' in e.attrs && e.attrs['aria-label'] === label)
    .map((w) => findAll(w, (p) => p.tag === 'p').map((p) => textOf(p).trim()));

// ─── The direct count ───

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGTN',
};
const COMPLEMENT: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};
const reverseComplementSite = (site: string) => [...site].reverse().map((b) => COMPLEMENT[b] ?? 'N').join('');

/**
 * The number of sites of `e` in `seq` (upper case): its recognition site read on the top strand, and
 * on the bottom strand when it is not its own reverse complement; across the origin of a circle; on a
 * linear molecule, only where both strands' cuts fall inside it.
 */
function directSites(seq: string, e: RestrictionEnzyme, circular: boolean): number {
  const site = e.recognitionSeq.toUpperCase();
  const m = site.length;
  const n = seq.length;
  const text = circular ? seq + seq.slice(0, Math.min(n, m - 1)) : seq;
  const codes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) codes[i] = text.charCodeAt(i);
  const rc = reverseComplementSite(site);
  const strands: [string, 1 | -1][] = rc === site ? [[site, 1]] : [[site, 1], [rc, -1]];
  let count = 0;
  for (const [motif, strand] of strands) {
    // One lookup table per site base: which sequence letters it matches.
    const tables = [...motif].map((b) => {
      const t = new Uint8Array(128);
      for (const ok of IUPAC[b] ?? '') t[ok.charCodeAt(0)] = 1;
      return t;
    });
    const last = circular ? n - 1 : n - m;
    for (let i = 0; i <= last; i++) {
      let k = 0;
      while (k < m && tables[k][codes[i + k]]) k++;
      if (k < m) continue;
      if (!circular) {
        const [top, bottom] = strand === 1 ? [i + e.cutFwd, i + e.cutRev] : [i + m - e.cutRev, i + m - e.cutFwd];
        if (top < 0 || bottom < 0 || top > n || bottom > n) continue;
      }
      count++;
    }
  }
  return count;
}
const directCounts = (seq: string, enzymes: readonly RestrictionEnzyme[], circular: boolean) =>
  new Map(enzymes.map((e) => [e.name, directSites(seq, e, circular)] as const));
const fmt = (n: number) => n.toLocaleString('en-US');

// ─── Fixtures: seeded, never committed ───

/** A seeded random DNA of `length` bp (the same bases on every run). */
const randomDna = (length: number, seed: number) => {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) out[i] = 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
  return out.join('');
};
const template = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular')!;
const dnaDoc = (id: string, sequence: string, topology: 'circular' | 'linear'): SequenceDocument => ({
  ...template, id, name: id, accession: '', description: '', sequence, topology, features: [], primers: [], history: [],
  docMetadata: {},
});

/** The positions the scan keeps per enzyme (RESTRICTION_POSITIONS_PER_ENZYME in rebase_catalog.rs). */
const KEPT = 2_000;

/**
 * 90 kb, circular, scanned with the whole catalogue: random bases with 2,500 GATC repeats from base
 * 20,001, so DpnI, MboI, Sau3AI and DpnII (every GATC) and ClaI, TaqI and kin (every junction) cut
 * more often than the scan keeps positions for, and the catalogue holds more than 12,000 sites.
 */
const ninetyKb = (() => {
  const s = randomDna(90_000, 0x90_002);
  // An AscI site (GGCGCGCC) across the origin, which only a scan of the circle finds: AscI, which
  // cuts these random bases once, then cuts the circle twice.
  return dnaDoc('Cap_90kb', 'CGCC' + s.slice(4, 20_000) + 'GATC'.repeat(2_500) + s.slice(30_000, 89_996) + 'GGCG', 'circular');
})();
/**
 * 1 Mb, linear, scanned with the core enzymes: random bases with 6,000 GATC repeats from base
 * 100,001 (6,000 sites each of the core DpnI and ClaI, so the core sites run past 12,000 there) and
 * NotI sites at 900 kb and 950 kb, past where a scan stopped at 12,000 sites would reach.
 */
const oneMb = (() => {
  const s = randomDna(1_000_000, 0x1_000_000).replace(/GCGGCCGC/g, 'GCGGACGC');
  return dnaDoc(
    'Cap_1Mb',
    `${s.slice(0, 100_000)}${'GATC'.repeat(6_000)}${s.slice(124_000, 900_000)}GCGGCCGC${s.slice(900_008, 950_000)}GCGGCCGC${s.slice(950_008)}`,
    'linear'
  );
})();

/** The App restored on `doc` in its Sequence view (Split, all cutters on the map). */
function restoreApp(doc: SequenceDocument): El {
  expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Restriction_Cap_Session',
    documents: [doc],
    workspace: {
      activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: {
        showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
      },
    },
  }), 'the autosave is written').toBe(true);
  let ran = false;
  let passes = 0;
  probe.onMenus = (_menus, dispatch) => {
    if (++passes > 25) throw new Error('the App kept re-rendering');
    if (!ran) { ran = true; dispatch('file:restore-autosave'); }
  };
  const root = parse(renderToStaticMarkup(<App />));
  expect(ran, 'the autosave was restored').toBe(true);
  return root;
}

/** The Enzymes view of `doc`, on the enzyme-set tab whose button reads `tab` (clicked from inside its render). */
function enzymesView(doc: SequenceDocument, tab: string): El {
  let clicked = tab === '';
  probe.onElement = (type, props) => {
    if (clicked || type !== 'button' || typeof props.onClick !== 'function') return;
    if (String(props.className ?? '').includes('method-tab-btn') && props.children === tab) {
      clicked = true;
      (props.onClick as () => void)();
    }
  };
  const root = parse(renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={doc} allDocuments={[doc]} initialSubTab="enzymes-view" />));
  probe.onElement = null;
  expect(clicked, `the "${tab}" tab was chosen`).toBe(true);
  return root;
}

/** Each row of the Enzymes view's table: name, # Cuts and Positions. */
const enzymeRows = (root: El) => {
  const region = one(root, (e) => e.attrs.role === 'region' && e.attrs['aria-label'] === 'Restriction Enzymes Cleavage Sites Table', 'Enzymes table');
  return findAll(region, (e) => e.tag === 'tr' && e.parent?.tag === 'tbody').map((tr) => {
    const cells = childrenOf(tr).filter((c) => c.tag === 'td');
    return { name: textOf(findAll(cells[0], (e) => e.tag === 'strong')[0]), cuts: textOf(cells[5]), positions: textOf(cells[6]) };
  });
};

/** The warning the engine gives when it kept only the first positions of `capped` (name -> complete count). */
const cappedWarningNames = (warning: string, enzymes: readonly RestrictionEnzyme[]) =>
  enzymes.filter((e) => warning.includes(`${e.name} (`)).map((e) => e.name);

describe('the restriction surfaces read complete site counts (BG-01M6S1K2)', () => {
  it('lists no single cutter or noncutter that a direct count contradicts', () => {
    const catalogue = REBASE_ENZYMES;
    expect(catalogue.length, 'the whole catalogue').toBeGreaterThan(CORE_CATALOG_LEN);

    // ── 90 kb, the whole catalogue ──
    const direct90 = directCounts(ninetyKb.sequence, catalogue, true);
    const total90 = [...direct90.values()].reduce((a, b) => a + b, 0);
    const single90 = catalogue.filter((e) => direct90.get(e.name) === 1).map((e) => e.name).sort();
    const none90 = catalogue.filter((e) => direct90.get(e.name) === 0).map((e) => e.name).sort();
    const capped90 = catalogue.filter((e) => direct90.get(e.name)! > KEPT);
    expect(total90, 'the fixture holds more sites than the scan once stopped at').toBeGreaterThan(12_000);
    expect(capped90.map((e) => e.name), 'the fixture holds enzymes cutting more often than positions are kept for').toEqual(
      expect.arrayContaining(['DpnI', 'ClaI'])
    );
    expect(single90.length, 'the fixture has single cutters').toBeGreaterThan(4);
    expect(none90.length, 'and noncutters').toBeGreaterThan(0);
    const ascI = catalogue.find((e) => e.name === 'AscI')!;
    expect([directSites(ninetyKb.sequence, ascI, true), directSites(ninetyKb.sequence, ascI, false)], 'AscI cuts the circle twice, once across its origin').toEqual([2, 1]);

    const app = restoreApp(ninetyKb);
    const spans = findAll(app, (e) => e.tag === 'span').map((s) => textOf(s));

    // The Restriction Analysis header gives every site, kept or not; the Unique Single-Cutters list
    // is exactly the enzymes that cut once.
    expect(spans.filter((t) => /^Restriction Analysis \(/.test(t)), 'the header counts every site').toEqual([`Restriction Analysis (${total90})`]);
    expect(spans.filter((t) => /^Unique Single-Cutters \(/.test(t))).toEqual([`Unique Single-Cutters (${single90.length})`]);
    const pills = findAll(app, (e) => e.tag === 'button' && e.classes.has('mbc-enz-pill')).map((b) => textOf(b).replace(/ \(.*$/, ''));
    expect([...pills].sort(), 'the Unique Single-Cutters list').toEqual(single90);

    // The engine's warning, beside the Restriction Analysis list: the cap, and each capped enzyme
    // with its complete count.
    const restriction = one(app, (e) => e.classes.has('mbc-accordion-section')
      && childrenOf(e).some((h) => h.tag === 'button' && /^Restriction Analysis \(/.test(textOf(h))), 'Restriction Analysis section');
    const listed = warningsIn(restriction, 'Restriction scan warnings');
    expect(listed.map((w) => w.length), 'one warning, shown with the list').toEqual([1]);
    const warning90 = listed[0][0];
    expect(warning90).toContain(`at most ${fmt(KEPT)} sites per enzyme`);
    for (const e of capped90) expect(warning90, e.name).toContain(`${e.name} (${fmt(direct90.get(e.name)!)} sites)`);
    expect(cappedWarningNames(warning90, catalogue).sort(), 'no other enzyme is named').toEqual(capped90.map((e) => e.name).sort());

    // The map's plate counts every site too.
    const plates = findAll(app, (e) => e.tag === 'text' && /^\d+ annotations · [\d,]+ sites$/.test(textOf(e))).map((t) => textOf(t));
    expect(plates, "the map's plate").toEqual([`0 annotations · ${fmt(total90)} sites`]);

    // The cockpit's 1x Cutters over the whole molecule: the first four named, then how many more,
    // and a tick for each (up to 40), every one an enzyme that cuts once.
    const cockpit = one(app, (e) => e.tag === 'span' && e.attrs.title === 'Unique Restriction Endonucleases Cleaving Inside Active Interval', 'cockpit 1x Cutters');
    const [, named, more] = /^1× Cutters: (.*?)(?: \+(\d+))?$/.exec(textOf(cockpit).trim()) ?? [];
    const cockpitNames = (named ?? '').split(', ').filter(Boolean);
    expect(cockpitNames.filter((n) => direct90.get(n) !== 1), 'the cockpit names only single cutters').toEqual([]);
    expect(cockpitNames.length + Number(more ?? 0), 'and counts every one').toBe(single90.length);
    const ticks = findAll(app, (e) => e.tag === 'title' && textOf(e).startsWith('Unique cutter: ')).map((t) => /^Unique cutter: (\S+) @/.exec(textOf(t))?.[1] ?? '');
    expect(ticks.filter((n) => direct90.get(n) !== 1), "the cockpit's unique-cutter ticks are single cutters").toEqual([]);
    expect(ticks.length, 'a tick for each, up to 40').toBe(Math.min(40, single90.length));

    // The Noncutters list: exactly the enzymes with no site.
    const cloning = parse(renderToStaticMarkup(
      <CloningAndGelStudio documents={[ninetyKb]} activeDoc={ninetyKb} onAddConstruct={() => undefined} initialSubTool="non-cutters" />
    ));
    expect(findAll(cloning, (e) => e.tag === 'span').map((s) => textOf(s)).filter((t) => /^Noncutters \(/.test(t))).toEqual([`Noncutters (${none90.length})`]);
    const noncutterRegion = one(cloning, (e) => e.attrs.role === 'region' && e.attrs['aria-label'] === 'Non-Cutting Restriction Enzymes', 'Noncutters table');
    const noncutters = findAll(noncutterRegion, (e) => e.tag === 'tr' && e.parent?.tag === 'tbody').map((tr) => textOf(findAll(tr, (e) => e.tag === 'strong')[0]));
    expect([...noncutters].sort(), 'the Noncutters list').toEqual(none90);

    // ── 1 Mb, the core enzymes (the scope over 100,000 bp) ──
    const core = catalogue.slice(0, CORE_CATALOG_LEN);
    const coreNames = new Set(core.map((e) => e.name));
    const direct1M = directCounts(oneMb.sequence, core, false);
    const capped1M = core.filter((e) => direct1M.get(e.name)! > KEPT);
    expect(capped1M.length, 'the 1 Mb fixture holds core enzymes cutting more often than positions are kept for').toBeGreaterThan(0);
    expect(direct1M.get('NotI'), 'and NotI sites past 900 kb').toBe(2);
    expect([...direct1M.values()].reduce((a, b) => a + b, 0), 'more core sites than the scan once stopped at').toBeGreaterThan(12_000);

    // Every enzyme of the catalogue is a row: a core enzyme with its complete count (its first
    // positions, and how many of how many when they were capped), and any other one not scanned,
    // never a noncutter.
    const all = enzymesView(oneMb, 'All REBASE Commercial');
    const rows = enzymeRows(all);
    expect(rows.map((r) => r.name), 'every catalogue enzyme is a row').toEqual(catalogue.map((e) => e.name));
    for (const r of rows) {
      if (!coreNames.has(r.name)) {
        expect({ name: r.name, cuts: r.cuts }, 'an enzyme the scan did not read').toEqual({ name: r.name, cuts: 'not scanned' });
        expect(r.positions, r.name).not.toMatch(/noncutter/i);
        continue;
      }
      const n = direct1M.get(r.name)!;
      expect({ name: r.name, cuts: r.cuts }, 'a core enzyme shows its complete count').toEqual({ name: r.name, cuts: String(n) });
      if (n === 0) expect(r.positions, r.name).toBe('None (Noncutter)');
      else if (n > KEPT) expect(r.positions, r.name).toMatch(new RegExp(` \\(the first ${fmt(KEPT)} of ${fmt(n)} sites\\)$`));
      else expect(r.positions.split(', '), r.name).toHaveLength(n);
    }
    const viewWarnings = warningsIn(all, 'Restriction scan warnings');
    expect(viewWarnings.map((w) => w.length), "the engine's warning, in the view").toEqual([1]);
    for (const e of capped1M) expect(viewWarnings[0][0], e.name).toContain(`${e.name} (${fmt(direct1M.get(e.name)!)} sites)`);
    expect(cappedWarningNames(viewWarnings[0][0], catalogue).sort()).toEqual(capped1M.map((e) => e.name).sort());

    // Its single cutters are the core enzymes that cut once.
    const once = enzymeRows(enzymesView(oneMb, '')).map((r) => r.name).sort();
    expect(once, `the "Cutting once among ${CORE_CATALOG_LEN} core enzymes" set`).toEqual(core.filter((e) => direct1M.get(e.name) === 1).map((e) => e.name).sort());
  }, 120_000);

  it('gives no all-clear line for a record whose scan stopped early', () => {
    // 20 kb, linear, no features or primers: random bases and 2,500 AGCT repeats, with no GATC,
    // CCAGG or CCTGG, so Dam and Dcm block no site. AluI, NheI and BfaI cut it more often than the
    // scan keeps positions for, so the audit has not seen every site and may not call them all
    // verified; it finds nothing else to say. A 4 kb record of the same kind is scanned whole.
    const noMethylation = (s: string) => s.replace(/GATC/g, 'GTTC').replace(/CC[AT]GG/g, 'CCCGG');
    const stoppedDoc = dnaDoc('Stopped_20kb', noMethylation(randomDna(10_000, 0xC1EA) + 'AGCT'.repeat(2_500)), 'linear');
    const wholeDoc = dnaDoc('Whole_4kb', noMethylation(randomDna(4_000, 0xC1EB)), 'linear');
    for (const doc of [stoppedDoc, wholeDoc]) expect(/GATC|CC[AT]GG/.test(doc.sequence), `${doc.name}: no methylated motif`).toBe(false);
    const alui = REBASE_ENZYMES.find((e) => e.name === 'AluI')!;
    expect(directSites(stoppedDoc.sequence, alui, false), 'the fixture: more AluI sites than are kept').toBeGreaterThan(KEPT);
    const stopped = scanRestrictionSites(stoppedDoc.sequence, 'linear');
    const whole = scanRestrictionSites(wholeDoc.sequence, 'linear');
    expect([stopped.stoppedEarly, whole.stoppedEarly], 'the scans report whether they stopped').toEqual([true, false]);

    // The audit RPC reads the scan's stop report.
    const ids = (doc: SequenceDocument, scan: typeof stopped, stoppedEarly: boolean) =>
      auditSequenceAlerts(doc, scan.sites, 'DH5α (dam+ dcm+)', stoppedEarly).map((a) => a.id);
    expect(ids(stoppedDoc, stopped, true), 'a stopped scan: no all-clear line').toEqual([]);
    expect(ids(stoppedDoc, stopped, false), 'the same sites read as every site').toEqual(['alert-clean']);

    // The lineage view's audit passes the stop report on.
    const ALL_CLEAR = '[Reading Frame] All Reading Frames, Restriction Sites & Primer Duplexes Verified';
    const lineageLines = (doc: SequenceDocument) =>
      findAll(parse(renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={doc} allDocuments={[doc]} initialSubTab="lineage" />)), (e) => e.tag === 'strong')
        .map((e) => textOf(e).trim())
        .filter((t) => t.startsWith('[Reading Frame] All '));
    expect(lineageLines(stoppedDoc), 'the record whose scan stopped').toEqual([]);
    expect(lineageLines(wholeDoc), 'the record scanned whole').toEqual([ALL_CLEAR]);
  }, 60_000);
});
