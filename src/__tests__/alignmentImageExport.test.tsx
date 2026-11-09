// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6S8C5: Export › Alignment Image writes the whole alignment as an SVG, PNG or PDF.
 *
 * Each criterion is checked through the real App, restored from an autosave with the document
 * under test open, and its own toolbar Export menu: the Export button's click is run inside the
 * App's render (the harness of alignmentTabLevels.test.tsx), and the menu's items are the props the
 * App hands its Export popup. The file is the one the figure export hands the save panel. AC4 also
 * reads its limit off the drawing functions directly, at sizes the App would take long to restore.
 * What the file must agree with is read from the studio's own grid, rendered for the same
 * document: the rows, names, identities and consensus it hands its canvas, and the colours its
 * cells are drawn in.
 *
 * The suite runs in node with no DOM library, so the export's few DOM needs (an off-screen host,
 * computed styles, a canvas to paint the PNG and PDF on) are stood in for below. The stand-in
 * page answers with the values a window of that size would give (its box, its text size, its
 * background), so a file that took anything from the window would differ between windows.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';

// ─── Probes, installed before the modules under test load ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
interface Saved { filename: string; content?: string; bytes?: Uint8Array }
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with a dispatcher for its menu commands. */
  onMenus: null as null | ((dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Every file handed to the save panel, in order. */
  saved: [] as Saved[],
}));

vi.mock('../platform/macosMenuBridge', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/macosMenuBridge');
  return {
    ...actual,
    postMacosNativeSave: (filename: string, content: string) => {
      probe.saved.push({ filename, content });
      return true;
    },
    postMacosNativeSaveBinary: (filename: string, bytes: Uint8Array) => {
      probe.saved.push({ filename, bytes: bytes.slice() });
      return true;
    },
  };
});

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

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const { App } = await import('../App');
const studioModule = await import('../components/AlignmentAndPhyloStudio');
const { SequenceAlignmentStudio } = studioModule;
const { AlignmentCanvas } = await import('../components/AlignmentCanvas');
const { CascadingMenuPopup } = await import('../components/CascadingMenu');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const viewModel = await import('../core/alignmentViewModel');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
// Read through the module object, so an export this story adds fails only the criterion that needs it.
const imageModule = await import('../core/alignmentImage');
type SequenceDocument = import('../types/bio').SequenceDocument;
type CanvasRow = import('../components/AlignmentCanvas').AlignmentCanvasRow;

// Each criterion restores the App; AC3 exports from every window, 2.6 to 8 s on a loaded machine
// against Vitest's 5 s default (BG-01M6T68N). The file sets its timeout as the App-mounting suites
// beside it do.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  probe.onElement = null;
  probe.onMenus = null;
  probe.saved = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const doc of [...SAMPLE_LIBRARY, crafted]) {
    studioModule.setAlignmentConsensusSettings(doc.id, studioModule.DEFAULT_ALIGNMENT_CONSENSUS);
    imageModule.setAlignmentImageColorScheme(doc.id, viewModel.defaultColorScheme(doc.moleculeType === 'Protein'));
  }
});

// ─── Markup as a tree (React's static markup, and the SVG file) ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses well-formed markup with quoted attributes; `xml` keeps tag case and knows no void tags. */
function parse(markup: string, xml = false): El {
  const root: El = { tag: '#root', attrs: {}, classes: new Set(), parent: null, children: [] };
  let cur = root;
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    if (m[0].startsWith('<?') || m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {
      if (/[<>]/.test(m[5])) throw new Error(`markup holds a bare < or > in "${m[5].slice(0, 40)}"`);
      cur.children.push(decode(m[5]));
      continue;
    }
    const [, closing, rawTag, rawAttrs, selfClosing] = m;
    const tag = xml ? rawTag : rawTag.toLowerCase();
    if (closing) {
      if (cur.tag !== tag) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) {
      if (/[<&](?!(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(a[2] ?? '')) throw new Error(`attribute ${a[1]} is not escaped`);
      attrs[a[1]] = decode(a[2] ?? '');
    }
    const node: El = { tag, attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent: cur, children: [] };
    cur.children.push(node);
    if (!xml && (tag === 'style' || tag === 'script')) {
      const end = markup.indexOf(`</${rawTag}>`, re.lastIndex);
      node.children.push(markup.slice(re.lastIndex, end));
      re.lastIndex = end + rawTag.length + 3;
      continue;
    }
    if (!selfClosing && (xml || !VOID.has(tag))) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}
const kids = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
function* walk(e: El): Generator<El> {
  yield e;
  for (const c of kids(e)) yield* walk(c);
}
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const hasClass = (cls: string) => (e: El) => e.classes.has(cls);
const text = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : text(c))).join('');
/** The value an element is drawn with: its own attribute, else the nearest ancestor's. */
function inherited(e: El, attr: string): string | undefined {
  for (let n: El | null = e; n; n = n.parent) if (n.attrs[attr] !== undefined) return n.attrs[attr];
  return undefined;
}

// ─── The documents ───

const byId = (id: string) => {
  const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
  if (!doc) throw new Error(`sample library has no ${id}`);
  return doc;
};
const coxii = byId('doc-aln-coxii-cds'); // 50 codon-aligned nucleotide members, 729 columns
const pairwiseProtein = byId('doc-aln-pairwise-protein'); // 2 aligned protein members
const threeKingdoms = byId('doc-aln-three-kingdoms'); // 35 aligned protein members, 1,156 columns
const transcripts = byId('doc-aln-transcript-variants'); // 4 aligned RNA members, 3,106 columns
const hivEnv = byId('doc-aln-hiv-env'); // an unaligned list in the Alignments folder
const coiContig = byId('doc-contig-coi-assembly'); // a contig of two Sanger reads
const coxiiTree = byId('doc-tree-coxii'); // a tree carrying the alignment it was built from
const puc19 = byId('doc-puc19'); // a plasmid

const alignment = (id: string, name: string, members: { name: string; sequence: string }[], extra: Partial<SequenceDocument> = {}): SequenceDocument => ({
  ...EMPTY_WORKSPACE_DOCUMENT, id, name, folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
  sequence: members[0].sequence.replace(/[-.]/g, '').toUpperCase(),
  alignmentMeta: { isAligned: true, sequenceCount: members.length, sequences: members.map((m, i) => ({ id: `${id}-m${i + 1}`, name: m.name, sequence: m.sequence })) },
  ...extra,
} as SequenceDocument);

/**
 * 130 columns (blocks of 60, 60 and 10) whose rows the grid reads before it draws them: lower case,
 * '.' for a gap, one row shorter than the rest (padded with gaps), gaps inside rows (so identity
 * with gaps counted differs), and names that a file must escape.
 */
const unit = 'ACGTTGCAAGGCTTAACCGTAGCTAGGATCCAGTTACGATCGGATTACAGCTTAGGCATCAAGTCGATGCA'; // 71
const craftedRows = [
  { name: 'Alpha & <Beta>', sequence: (unit + unit).slice(0, 130) },
  { name: 'gamma "quoted"', sequence: (unit + unit).slice(0, 130).toLowerCase().replace(/^(.{20}).{6}/, '$1......') },
  { name: "Delta's", sequence: (unit + unit).slice(0, 117).replace(/^(.{40}).{3}/, '$1TTT') },
  // Its gaps at 115-123 meet Delta's padding from 117, so those columns are half gaps.
  { name: 'Epsilon', sequence: (unit + unit).slice(0, 130).replace(/^(.{100}).{4}/, '$1AAAA').replace(/^(.{115}).{9}/, '$1---------') },
];
const crafted = alignment('aln-image-crafted', 'Crafted & escaped', craftedRows);

// ─── The studio's grid: what the image must agree with ───

interface Grid {
  rows: CanvasRow[];
  consensus: string;
  consensusLabel: string;
  colorScheme: string;
  /** The background and letter colour of each residue the grid drew a cell for. */
  cells: Map<string, { background: string; color: string }>;
}

/** The studio rendered for `doc`: the rows and consensus it hands its canvas, and the cells it drew. */
function gridOf(doc: SequenceDocument): Grid {
  let props: Record<string, unknown> | null = null;
  probe.onElement = (type, p) => {
    if (type === AlignmentCanvas) props = p;
  };
  let html: string;
  try {
    html = renderToStaticMarkup(<SequenceAlignmentStudio {...({ documents: [doc], projectDocuments: SAMPLE_LIBRARY, activeDoc: doc } as React.ComponentProps<typeof SequenceAlignmentStudio>)} />);
  } finally {
    probe.onElement = null;
  }
  if (!props) expect.fail(`${doc.name}: the studio drew no alignment canvas`);
  const p = props as { rows: CanvasRow[]; consensus: string; settings: { consensusLabel: string; colorScheme: string } };
  const cells = new Map<string, { background: string; color: string }>();
  for (const cell of findAll(parse(html), hasClass('mbc-aln-cell'))) {
    const style = Object.fromEntries((cell.attrs.style ?? '').split(/;(?![^(]*\))/).map((d) => d.split(/:(.*)/s).map((s) => s.trim())).filter((d) => d[0]));
    const ch = text(cell);
    const seen = cells.get(ch);
    const drawn = { background: style.background ?? '', color: style.color ?? '' };
    if (seen) expect(drawn, `${doc.name}: the grid draws every "${ch}" alike`).toEqual(seen);
    else cells.set(ch, drawn);
  }
  return { rows: p.rows, consensus: p.consensus, consensusLabel: p.settings.consensusLabel, colorScheme: p.settings.colorScheme, cells };
}

/**
 * Picks `scheme` in the studio's own General inspector, through the Colors select's own change
 * handler: the select offering a molecule type's default scheme (Zappo or ACGT - Default), as
 * alignmentStudioLiveScheme.test.tsx names it. The studio keeps the scheme per document outside
 * itself, so the pick outlives this render as the user's pick outlives the studio's.
 */
function pickGridScheme(doc: SequenceDocument, scheme: string) {
  let picks = 0;
  probe.onElement = (type, p) => {
    if (type !== 'select') return;
    const options = React.Children.toArray(p.children as React.ReactNode)
      .filter(React.isValidElement)
      .map((o) => String((o.props as { value?: unknown }).value ?? ''));
    if (!options.includes('Zappo') && !options.includes('ACGT - Default')) return;
    picks += 1;
    expect(options, `${doc.name}: the Colors select offers ${scheme}`).toContain(scheme);
    (p.onChange as (e: unknown) => void)({ target: { value: scheme } });
  };
  try {
    renderToStaticMarkup(<SequenceAlignmentStudio {...({ documents: [doc], projectDocuments: SAMPLE_LIBRARY, activeDoc: doc } as React.ComponentProps<typeof SequenceAlignmentStudio>)} />);
  } finally {
    probe.onElement = null;
  }
  expect(picks, `${doc.name}: one Colors select to pick ${scheme} in`).toBe(1);
}

// ─── The App, restored with a document open, and its Export menu ───

/**
 * The App restored from an autosave holding `documents` with `activeDocId` open, its toolbar Export
 * button clicked from inside its render, and the items it then hands its Export popup. `act` runs
 * once, inside the render that shows the menu, with those items.
 */
function exportMenuOf(documents: SequenceDocument[], activeDocId: string, act?: (items: MenuNode[]) => void): { items: MenuNode[]; root: El } {
  const g = globalThis as unknown as { localStorage?: MemoryStorage; window?: unknown };
  const beforeStorage = g.localStorage;
  g.localStorage = new MemoryStorage();
  try {
    expect(saveWorkbenchToLocalAutosave({
      sessionName: 'Restored_Session',
      documents,
      workspace: {
        activeDocId, selectedFolder: 'All Project Files', navHistory: [activeDocId], navIndex: 0,
        viewerTab: 'document-info', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
        darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
        displaySettings: {
          showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    }), 'the autosave is written').toBe(true);
    let passes = 0;
    let restoredAt = 0;
    let clickedAt = 0;
    let items: MenuNode[] | null = null;
    probe.onMenus = (dispatch) => {
      if (++passes > 25) throw new Error('the App kept re-rendering');
      if (!restoredAt) {
        restoredAt = passes;
        dispatch('file:restore-autosave');
      }
    };
    probe.onElement = (type, p) => {
      if (restoredAt && !clickedAt && passes > restoredAt && type === 'button' &&
        String(p.className ?? '').split(/\s+/).includes('mbc-tool-btn') && reactText(p.children).trim() === 'Export') {
        clickedAt = passes;
        const beforeWindow = g.window;
        g.window = { innerWidth: 1280, innerHeight: 800 };
        try {
          const box = { left: 200, top: 60, right: 290, bottom: 100, width: 90, height: 40, x: 200, y: 60 };
          (p.onClick as (e: unknown) => void)({ currentTarget: { getBoundingClientRect: () => box } });
        } finally {
          if (beforeWindow === undefined) delete g.window;
          else g.window = beforeWindow;
        }
      }
      if (clickedAt && !items && passes > clickedAt && type === CascadingMenuPopup && p.ariaLabel === 'Export Menu') {
        items = p.items as MenuNode[];
        act?.(items);
      }
    };
    let html: string;
    try {
      html = renderToStaticMarkup(<App />);
    } finally {
      probe.onElement = null;
      probe.onMenus = null;
    }
    expect(restoredAt, 'the autosave was restored').toBeGreaterThan(0);
    expect(clickedAt, 'the toolbar Export button was clicked').toBeGreaterThan(0);
    if (!items) expect.fail('the App drew no Export menu');
    return { items, root: parse(html) };
  } finally {
    if (beforeStorage === undefined) delete g.localStorage;
    else g.localStorage = beforeStorage;
  }
}
/** The text inside React children. */
function reactText(children: unknown): string {
  return React.Children.toArray(children as React.ReactNode).map((c) => {
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (React.isValidElement(c)) return reactText((c.props as { children?: unknown }).children);
    return '';
  }).join('');
}
function* menuNodes(nodes: readonly MenuNode[]): Generator<MenuNode> {
  for (const n of nodes) {
    yield n;
    if (n.kind === 'submenu') yield* menuNodes(n.children);
  }
}
/** The Export menu's Alignment Image entry, or null when the menu offers none. */
function alignmentImageMenu(items: readonly MenuNode[]) {
  const hits = [...menuNodes(items)].filter((n) => n.kind !== 'separator' && n.kind !== 'search' && /alignment image/i.test(n.label));
  if (hits.length === 0) return null;
  expect(hits.map((h) => h.kind), 'one Alignment Image submenu').toEqual(['submenu']);
  return hits[0] as Extract<MenuNode, { kind: 'submenu' }>;
}
type Command = Extract<MenuNode, { kind: 'command' }>;
/** The Alignment Image commands of `doc`'s Export menu, by the label each carries. */
function alignmentImageCommands(doc: SequenceDocument, documents: SequenceDocument[] = [doc]): Record<'SVG' | 'PNG' | 'PDF', Command> {
  const menu = alignmentImageMenu(exportMenuOf(documents, doc.id).items);
  if (!menu) expect.fail(`${doc.name}: the Export menu offers no Alignment Image`);
  const commands = menu.children.filter((c): c is Command => c.kind === 'command');
  const byFormat = (f: string) => {
    const hit = commands.filter((c) => new RegExp(`\\b${f}\\b`).test(c.label));
    expect(hit.map((c) => c.label), `${doc.name}: one ${f} item`).toHaveLength(1);
    return hit[0];
  };
  expect(commands.filter((c) => !c.disabled), `${doc.name}: three Alignment Image items, all enabled`).toHaveLength(3);
  return { SVG: byFormat('SVG'), PNG: byFormat('PNG'), PDF: byFormat('PDF') };
}

// ─── A page for the export to run in, of a given window size ───

interface Win { name: string; width: number; height: number; dpr: number }
const WINDOWS: Win[] = [
  { name: '1280x800', width: 1280, height: 800, dpr: 2 },
  { name: '1440x900', width: 1440, height: 900, dpr: 2 },
  { name: '800x600 (narrow)', width: 800, height: 600, dpr: 1 },
  { name: '2560x1440', width: 2560, height: 1440, dpr: 1.5 },
];

/** Inherited presentation properties, which a node takes from its parent when it sets none. */
const INHERITED = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'text-transform', 'paint-order', 'shape-rendering']);

class PageNode {
  parentElement: PageNode | null = null;
  readonly kids: PageNode[] = [];
  readonly attrs = new Map<string, string>();
  constructor(readonly tagName: string, private readonly page: Page) {}
  get children() { return this.kids; }
  setAttribute(name: string, value: string) { this.attrs.set(name, String(value)); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  appendChild(child: PageNode) { child.parentElement = this; this.kids.push(child); return child; }
  remove() {
    const siblings = this.parentElement?.kids;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  /** An element sized by the page draws at a share of the window, as a CSS-sized figure would. */
  getBoundingClientRect() {
    const width = this.page.win.width * 0.6;
    const height = this.page.win.height * 0.5;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  }
  cloneNode(deep = false): PageNode {
    const copy = new PageNode(this.tagName, this.page);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    if (deep) for (const c of this.kids) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  declared(prop: string): string | undefined {
    for (const d of (this.attrs.get('style') ?? '').split(';')) {
      const [k, ...v] = d.split(':');
      if (k?.trim() === prop) return v.join(':').trim();
    }
    return undefined;
  }
  serialize(): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const attrs = [...this.attrs].map(([n, v]) => ` ${n}="${esc(v)}"`).join('');
    const inner = this.kids.map((k) => k.serialize()).join('');
    return inner ? `<${this.tagName}${attrs}>${inner}</${this.tagName}>` : `<${this.tagName}${attrs}/>`;
  }
}

interface Painted { markup: string; pixelWidth: number; pixelHeight: number; background: string }
class Page {
  readonly html: PageNode;
  readonly body: PageNode;
  /** Each drawing painted for a PNG or PDF: the SVG painted, and the canvas it was painted on. */
  readonly painted: Painted[] = [];
  constructor(readonly win: Win) {
    this.html = new PageNode('html', this);
    this.body = this.html.appendChild(new PageNode('body', this));
  }
  /** What the page's stylesheet gives an element that sets nothing itself: it varies with the window. */
  pageValue(prop: string): string {
    const narrow = this.win.width < 1000;
    switch (prop) {
      case 'font-family': return 'Google Sans, system-ui, sans-serif';
      case 'font-size': return narrow ? '12px' : '12.5px';
      case 'font-weight': return '400';
      case 'fill': return narrow ? 'rgb(68, 71, 70)' : 'rgb(31, 31, 31)';
      case 'stroke': return 'none';
      case 'text-anchor': return 'start';
      case 'letter-spacing': return narrow ? '0.1px' : 'normal';
      default: return '';
    }
  }
  computed(node: PageNode) {
    const page = this;
    const hexToRgb = (v: string) => {
      const m = v.match(/^#([0-9a-f]{6})$/i);
      if (!m) return v;
      const n = parseInt(m[1], 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    return {
      get backgroundColor() {
        const own = node.declared('background') ?? node.declared('background-color');
        if (own) return hexToRgb(own);
        return node === page.html ? (page.win.width < 1000 ? 'rgb(17, 19, 23)' : 'rgb(238, 243, 251)') : 'rgba(0, 0, 0, 0)';
      },
      getPropertyValue(prop: string): string {
        for (let n: PageNode | null = node; n; n = INHERITED.has(prop) ? n.parentElement : null) {
          const own = n.declared(prop);
          if (own !== undefined) return own;
        }
        return INHERITED.has(prop) || prop === 'opacity' ? page.pageValue(prop) : '';
      },
    };
  }
  /** Installs the page: the document, computed styles, serialization and a canvas to paint on. */
  install(): void {
    const page = this;
    const blobs = new Map<string, Blob>();
    vi.stubGlobal('window', {
      innerWidth: this.win.width, innerHeight: this.win.height, devicePixelRatio: this.win.dpr,
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('devicePixelRatio', this.win.dpr);
    vi.stubGlobal('document', {
      documentElement: this.html,
      body: this.body,
      createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas(page) : new PageNode(tag, page)),
      createElementNS: (_ns: string, tag: string) => new PageNode(tag, page),
    });
    vi.stubGlobal('getComputedStyle', (node: PageNode) => page.computed(node));
    vi.stubGlobal('XMLSerializer', class { serializeToString(node: PageNode) { return node.serialize(); } });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      const url = `blob:page/${blobs.size + 1}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class {
      decoding = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      markup = '';
      set src(url: string) {
        const blob = blobs.get(url);
        if (!blob) { setTimeout(() => this.onerror?.(), 0); return; }
        void blob.text().then((t) => { this.markup = t; this.onload?.(); });
      }
    });
  }
}
/** A canvas that records what is painted on it and encodes it as text, so two paintings compare. */
class FakeCanvas {
  width = 0;
  height = 0;
  private painting: Painted | null = null;
  constructor(private readonly page: Page) {}
  getContext() {
    const canvas = this;
    let fill = '';
    return {
      set fillStyle(v: string) { fill = v; },
      get fillStyle() { return fill; },
      fillRect() {},
      drawImage(image: { markup: string }, _x: number, _y: number, w: number, h: number) {
        expect([w, h], 'the drawing is painted over the whole canvas').toEqual([canvas.width, canvas.height]);
        canvas.painting = { markup: image.markup, pixelWidth: canvas.width, pixelHeight: canvas.height, background: fill };
        canvas.page.painted.push(canvas.painting);
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4).fill(255) };
      },
    };
  }
  toBlob(cb: (b: Blob) => void, type: string) {
    cb(new Blob([`${type} ${this.width}x${this.height} ${this.painting?.markup.length ?? 0}`], { type }));
  }
}

/** Runs `command` from a page of window `win` and waits for the one file it saves. */
async function exportFrom(win: Win, command: Command): Promise<{ file: Saved; page: Page }> {
  const page = new Page(win);
  page.install();
  probe.saved = [];
  try {
    command.onSelect();
    for (let i = 0; i < 400 && probe.saved.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(probe.saved.map((s) => s.filename), `${command.label} from ${win.name}: one file saved`).toHaveLength(1);
    expect(page.body.kids, `${command.label} from ${win.name}: the off-screen host is removed`).toEqual([]);
    return { file: probe.saved[0], page };
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}

/** The SVG file as a tree, and its root. */
function svgOf(file: Saved): { root: El; svg: El } {
  expect(file.content, `${file.filename} is text`).toBeTypeOf('string');
  expect(file.content!.startsWith('<?xml'), `${file.filename} opens as an XML file`).toBe(true);
  const root = parse(file.content!, true);
  const svgs = kids(root).filter((k) => k.tag === 'svg');
  expect(svgs, `${file.filename} holds one root <svg>`).toHaveLength(1);
  return { root, svg: svgs[0] };
}

/** The file read back as blocks: each block's columns, ruler, consensus row and member rows. */
function readImage(svg: El) {
  const blocks = findAll(svg, hasClass('aln-block')).map((block) => {
    const residuesOf = (line: El) => {
      const groups = findAll(line, hasClass('aln-residues'));
      expect(groups, 'each line draws one run of residues').toHaveLength(1);
      return kids(groups[0]).filter((k) => k.tag === 'text').map((t) => ({ ch: text(t), x: Number(t.attrs.x), y: Number(t.attrs.y), el: t }));
    };
    const labelsOf = (line: El) => kids(line).filter((k) => k.tag === 'text').map((t) => text(t));
    const consensus = findAll(block, hasClass('aln-consensus'));
    expect(consensus, 'each block draws one consensus row').toHaveLength(1);
    const ruler = findAll(block, hasClass('aln-ruler'));
    expect(ruler, 'each block draws one ruler').toHaveLength(1);
    const lineOf = (line: El) => ({ labels: labelsOf(line), residues: residuesOf(line), line });
    return {
      el: block,
      columns: block.attrs['data-columns'],
      ruler: findAll(ruler[0], (e) => e.tag === 'text').map((t) => ({ label: text(t), x: Number(t.attrs.x) })),
      ticks: findAll(ruler[0], (e) => e.tag === 'line').map((l) => Number(l.attrs.x1)),
      consensus: lineOf(consensus[0]),
      rows: findAll(block, hasClass('aln-row')).map(lineOf),
    };
  });
  return blocks;
}

// ─── An independent reading of a cell's colour as the light theme shows it on Canvas White ───

function onCanvasWhite(css: string): string | null {
  // The theme switches (--mbc-aln-day / --mbc-aln-night) and token fallbacks, as the light theme reads them.
  let v = css
    .replace(/var\(--mbc-aln-day,\s*1\)/g, '1')
    .replace(/var\(--mbc-aln-night,\s*0\)/g, '0')
    .replace(/var\(--mbc-text-muted\)/g, '#5f6368')
    .replace(/var\(--mbc-text-main,\s*(#[0-9a-f]+)\)/gi, '$1')
    .replace(/calc\(\s*1\s*\*\s*([\d.]+)\s*\+\s*0\s*\*\s*[\d.]+\s*\)/g, '$1')
    .trim();
  if (v === 'transparent') return null;
  let rgb: number[];
  let a = 1;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i))) {
    rgb = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
    if (m[2]) a = parseInt(m[2], 16) / 255;
  } else if ((m = v.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/))) {
    rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4] !== undefined) a = Number(m[4]);
  } else {
    throw new Error(`the test cannot read the grid colour "${css}"`);
  }
  v = `#${rgb.map((c) => Math.round(a * c + (1 - a) * 255).toString(16).padStart(2, '0')).join('')}`;
  return v;
}

// ─── AC1 ───

describe('AC1: Export offers Alignment Image for an alignment', () => {
  it('offers alignment image export only for an alignment', async () => {
    // Wrong implementations this fails: an item offered for every document, or for none; offered
    // for an unaligned list in the Alignments folder, a contig or a tree document (which carry
    // members); offered disabled rather than not at all; items whose format is not the one named.
    for (const doc of [coxii, pairwiseProtein, transcripts]) {
      const menu = alignmentImageMenu(exportMenuOf([doc, puc19], doc.id).items);
      if (!menu) expect.fail(`${doc.name}: the Export menu offers Alignment Image`);
      expect(menu.disabled ?? false, `${doc.name}: Alignment Image is enabled`).toBe(false);
      const labels = menu.children.filter((c): c is Command => c.kind === 'command').map((c) => c.label);
      expect(labels.length, `${doc.name}: ${labels.join(', ')}`).toBe(3);
      for (const f of ['SVG', 'PNG', 'PDF']) expect(labels.filter((l) => l.includes(f)), `${doc.name}: ${f}`).toHaveLength(1);
    }
    for (const doc of [puc19, hivEnv, coiContig, coxiiTree]) {
      const { items } = exportMenuOf([doc, coxii], doc.id);
      expect(items.length, `${doc.name}: the Export menu is drawn with its other entries`).toBeGreaterThan(3);
      expect(alignmentImageMenu(items), `${doc.name}: no Alignment Image`).toBeNull();
    }

    // Each item saves its own format, a whole file of the active alignment.
    // The transcript variants stand in for the dropped fictitious-character People set (D0094).
    const commands = alignmentImageCommands(transcripts);
    const win = WINDOWS[0];
    const svg = await exportFrom(win, commands.SVG);
    expect(svg.file.filename).toMatch(/^Transcript_variants.*Alignment_Image\.svg$/);
    expect(readImage(svgOf(svg.file).svg).flatMap((b) => b.rows).length, 'the SVG draws the 4 transcript rows in each of the 46 blocks of 2,757 columns').toBe(4 * 46);
    expect(svg.page.painted, 'an SVG is written, not painted').toEqual([]);
    const png = await exportFrom(win, commands.PNG);
    expect(png.file.filename).toMatch(/^Transcript_variants.*Alignment_Image\.png$/);
    expect(png.page.painted, 'the PNG is painted once').toHaveLength(1);
    expect(new TextDecoder().decode(png.file.bytes).startsWith('image/png '), 'the PNG is encoded as a PNG').toBe(true);
    const pdf = await exportFrom(win, commands.PDF);
    expect(pdf.file.filename).toMatch(/^Transcript_variants.*Alignment_Image\.pdf$/);
    expect(new TextDecoder().decode(pdf.file.bytes!.slice(0, 5)), 'the PDF is a PDF').toBe('%PDF-');
    // Both are painted from the drawing the SVG holds (the export adds its own XML prologue, size,
    // title and background to the same root).
    for (const painted of [png.page.painted[0], pdf.page.painted[0]]) {
      expect(painted.markup, 'painted from the SVG file\'s drawing').toBe(svg.file.content);
    }
  });
});

// ─── AC2 ───

describe('AC2: the whole alignment, in 60-column blocks', () => {
  it('draws every sequence and column in 60-column blocks with ruler, identity and consensus', async () => {
    // Wrong implementations this fails: the rows or columns the grid has scrolled into view; blocks
    // of another width, or a last partial block dropped; rows read as stored (lower case, '.', no
    // padding) rather than as the grid draws them; names without the grid's numbering, or
    // unescaped; identity counting gaps, or to row 1; a consensus of the image's own (majority)
    // rather than the grid's under its current settings, or labelled "Consensus" alone; a ruler
    // counted from 0, or not lined up with its columns.
    studioModule.setAlignmentConsensusSettings(crafted.id, { threshold: '75%', ignoreGaps: false });
    for (const doc of [coxii, crafted, threeKingdoms]) {
      const grid = gridOf(doc);
      const columns = grid.consensus.length;
      expect(grid.rows.length, `${doc.name}: the grid's rows`).toBe(doc.alignmentMeta!.sequences!.length);
      const { file } = await exportFrom(WINDOWS[0], alignmentImageCommands(doc).SVG);
      const { svg } = svgOf(file);
      const blocks = readImage(svg);
      // Every ruler number is drawn whole inside the figure (Google Sans Code advances 0.6 em).
      const figureWidth = Number(svg.attrs.viewBox.split(' ')[2]);
      for (const r of blocks.flatMap((b) => b.ruler)) {
        expect(r.x + r.label.length * 11 * 0.6, `${doc.name}: ruler number ${r.label} inside the figure`).toBeLessThanOrEqual(figureWidth);
      }

      const expectedBlocks = Math.ceil(columns / 60);
      expect(blocks.map((b) => b.columns), `${doc.name}: the blocks`).toEqual(
        Array.from({ length: expectedBlocks }, (_v, b) => `${b * 60 + 1}-${Math.min(columns, b * 60 + 60)}`));
      const x0 = blocks[0].consensus.residues[0].x;
      blocks.forEach((block, b) => {
        const start = b * 60;
        const end = Math.min(columns, start + 60);
        const where = `${doc.name}, block ${b + 1}`;
        // The ruler: the block's first column and every tenth, each over its own column.
        const marked = Array.from({ length: end - start }, (_v, i) => start + i + 1).filter((pos, i) => i === 0 || pos % 10 === 0);
        expect(block.ruler.map((r) => r.label), `${where}: ruler`).toEqual(marked.map((pos) => pos.toLocaleString('en-US')));
        expect(block.ticks, `${where}: ticks over their columns`).toEqual(marked.map((pos) => x0 + (pos - 1 - start) * 10));
        // The consensus row: the grid's consensus, named as the grid names it.
        expect(block.consensus.labels, `${where}: consensus name`).toEqual(['Consensus', grid.consensusLabel]);
        expect(block.consensus.residues.map((r) => r.ch).join(''), `${where}: consensus`).toBe(grid.consensus.slice(start, end));
        // Every member row, in the grid's order, with the grid's name and identity.
        expect(block.rows.map((r) => r.labels), `${where}: names and identities`).toEqual(grid.rows.map((r) => [r.label, r.metric]));
        block.rows.forEach((row, r) => {
          expect(row.residues.map((c) => c.ch).join(''), `${where}, row ${r + 1}`).toBe(grid.rows[r].alignedSeq.slice(start, end));
          expect(row.residues.map((c) => c.x), `${where}, row ${r + 1}: one column every 10 px`).toEqual(
            Array.from({ length: end - start }, (_v, i) => x0 + i * 10));
        });
        // Rows sit below the consensus, one line each, in order.
        const ys = [block.consensus, ...block.rows].map((l) => l.residues[0].y);
        expect(ys.slice(1).map((y, i) => y - ys[i]), `${where}: one line per row`).toEqual(ys.slice(1).map(() => 14));
      });
      if (doc === coxii) {
        expect(blocks.length, 'COXII: 729 columns make 13 blocks, the last of 9').toBe(13);
        expect(blocks[12].consensus.residues.length).toBe(9);
        expect(blocks[0].rows.length, 'COXII: all 50 rows').toBe(50);
      } else if (doc === threeKingdoms) {
        expect(blocks.map((b) => b.ruler.at(-1)?.label), 'Three Kingdoms: block 17 ends at a four-digit position').toContain('1,020');
      } else {
        // The fixture reaches each wrong reading: lower case and '.' read as residues and gaps, the
        // short row padded, the 75% gap-counting consensus not the majority one, identities moved
        // by gaps.
        expect(grid.consensusLabel).toBe('75%');
        expect(grid.rows[1].alignedSeq).toMatch(/^[ACGT]{20}-{6}[ACGT]/);
        expect(grid.rows[2].alignedSeq.endsWith('-'.repeat(13))).toBe(true);
        const majority = studioModule.alignmentGridConsensus(crafted, grid.rows.map((r) => ({ sequence: r.alignedSeq, features: [] })), studioModule.DEFAULT_ALIGNMENT_CONSENSUS).consensus;
        expect(majority, 'the 75% consensus is not the majority one').not.toBe(grid.consensus);
        const withGaps = (seq: string) => Math.round([...seq].filter((c, i) => c === grid.consensus[i]).length / seq.length * 1000) / 10;
        expect(grid.rows.map((r) => r.metric)).not.toEqual(grid.rows.map((r) => `${withGaps(r.alignedSeq)}%`));
        expect(blocks[0].rows[0].labels[0], 'a name the file had to escape').toBe('1. Alpha & <Beta>');
        expect(blocks.length).toBe(3);
      }
    }
  });
});

// ─── AC3 ───

describe('AC3: the studio\'s colours, and one file from any window', () => {
  it('colours residues as the studio does and exports the same file from any window', async () => {
    // Wrong implementations this fails: a palette of the image's own, the solid residue colour
    // where the grid draws a wash, a protein alignment read as nucleotides, a gap given a fill; the
    // night theme's inks, or a page background behind the drawing; a file that takes its size, text
    // size or ink from the window it was exported from. (By day the grid letters every residue of
    // its default schemes in Ink, since a 0x66 wash on Canvas White is never darker than #999999,
    // so a letter's own ink is checked but cannot tell the two apart here.)
    for (const doc of [coxii, threeKingdoms]) {
      const grid = gridOf(doc);
      const isProtein = doc.moleculeType === 'Protein';
      expect(grid.colorScheme, `${doc.name}: the grid's scheme`).toBe(isProtein ? 'Zappo' : 'ACGT - Default');
      const letters = [...grid.cells.keys()].filter((ch) => ch !== '-');
      expect(letters.length, `${doc.name}: the grid drew ${letters.join('')}`).toBeGreaterThanOrEqual(isProtein ? 12 : 4);
      const { file } = await exportFrom(WINDOWS[0], alignmentImageCommands(doc).SVG);
      const { svg } = svgOf(file);
      const blocks = readImage(svg);
      const drawnLetters = new Set<string>();
      for (const line of blocks.flatMap((b) => [b.consensus, ...b.rows])) {
        for (const cell of line.residues) {
          const cellRect = kids(cell.el.parent!).find((k) => k.tag === 'rect' && Number(k.attrs.x) + 5 === cell.x && Number(k.attrs.y) + 10 === cell.y);
          const seen = grid.cells.get(cell.ch);
          if (cell.ch === '-') {
            expect(cellRect, `${doc.name}: a gap has no fill`).toBeUndefined();
            expect(inherited(cell.el, 'fill'), `${doc.name}: a gap is drawn in Muted Ink`).toBe('#5f6368');
            continue;
          }
          if (!seen) continue;
          drawnLetters.add(cell.ch);
          expect(cellRect?.attrs.fill, `${doc.name}: "${cell.ch}" is filled as the grid fills it (${seen.background})`).toBe(onCanvasWhite(seen.background));
          expect(inherited(cell.el, 'fill'), `${doc.name}: "${cell.ch}" is lettered as the grid letters it (${seen.color})`).toBe(onCanvasWhite(seen.color));
        }
      }
      expect([...drawnLetters].sort(), `${doc.name}: every letter the grid drew was checked`).toEqual(letters.sort());
      if (!isProtein) {
        // Read by hand: ACGT - Default's A (#e5484d), C (#3e7bfa), G (#e8b500), T (#30a46c) washed at
        // 0x66 over Canvas White, each lettered in Ink.
        const fills = Object.fromEntries(['A', 'C', 'G', 'T'].map((ch) => [ch, onCanvasWhite(grid.cells.get(ch)!.background)]));
        expect(fills).toEqual({ A: '#f5b6b8', C: '#b2cafd', G: '#f6e199', T: '#acdbc4' });
      }
      expect(kids(svg).find((k) => k.tag === 'rect')?.attrs.fill, `${doc.name}: drawn on Canvas White`).toBe('rgb(255, 255, 255)');
    }

    // One file from every window: the SVG of COXII, and the PNG and PDF of the transcript variants.
    const coxiiSvg = alignmentImageCommands(coxii).SVG;
    const transcriptCommands = alignmentImageCommands(transcripts);
    const files: Record<string, { win: string; file: Saved; painted: Painted[] }[]> = { svg: [], png: [], pdf: [] };
    // A PDF records when it was made, so the clock is held still: only the window changes.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T09:00:00Z'));
    try {
      for (const win of WINDOWS) {
        const svg = await exportFrom(win, coxiiSvg);
        files.svg.push({ win: win.name, file: svg.file, painted: svg.page.painted });
        for (const [format, command] of [['png', transcriptCommands.PNG], ['pdf', transcriptCommands.PDF]] as const) {
          const out = await exportFrom(win, command);
          files[format].push({ win: win.name, file: out.file, painted: out.page.painted });
        }
      }
    } finally {
      vi.useRealTimers();
    }
    const [first, ...others] = files.svg;
    const { svg } = svgOf(first.file);
    const [, , vw, vh] = svg.attrs.viewBox.split(' ').map(Number);
    expect([Number(svg.attrs.width), Number(svg.attrs.height)], 'COXII is saved at its own drawn size').toEqual([vw, vh]);
    expect(vh, 'COXII is drawn whole: 12 blocks of 52 lines').toBeGreaterThan(12 * 52 * 14);
    for (const x of others) expect(x.file.content, `COXII's SVG from ${x.win} is the one from ${first.win}`).toBe(first.file.content);
    for (const format of ['png', 'pdf'] as const) {
      const [a, ...rest] = files[format];
      expect(a.painted, `The transcript variants' ${format} is painted once`).toHaveLength(1);
      const drawn = svgOf({ filename: 'painted.svg', content: a.painted[0].markup }).svg;
      expect([a.painted[0].pixelWidth, a.painted[0].pixelHeight], `The transcript variants' ${format}: painted at 3x its drawing`).toEqual(
        [Number(drawn.attrs.width) * 3, Number(drawn.attrs.height) * 3]);
      for (const x of rest) {
        expect(x.painted, `The transcript variants' ${format} from ${x.win} paints what it paints from ${a.win}`).toEqual(a.painted);
        expect(x.file.bytes, `The transcript variants' ${format} from ${x.win} is the file from ${a.win}`).toEqual(a.file.bytes);
      }
    }
    // The page the export ran in did differ: a figure sized by the window, or styled by the page,
    // would have differed too.
    const pages = WINDOWS.map((w) => new Page(w));
    expect(new Set(pages.map((p) => p.computed(p.body).getPropertyValue('font-size'))).size).toBeGreaterThan(1);
    expect(new Set(pages.map((p) => p.body.getBoundingClientRect().width)).size).toBe(WINDOWS.length);
  });
});

// ─── AC4 ───

describe('AC4: an alignment too large to draw whole is refused', () => {
  it('refuses an alignment too large to draw whole with a message', async () => {
    // Wrong implementations this fails: no limit; a limit on the drawing's CSS size, or at 2x,
    // rather than on the 3x canvas the PNG and PDF are painted on; a limit on the side but not on
    // the area, or on the area but not the side; a drawing cut to fit (the first rows or blocks)
    // instead of refused; a refusal that names no limit; a refusal shown nowhere, or saved anyway.
    const { drawAlignmentImage, alignmentImageRefusal, alignmentImageRows, alignmentImageSize } = imageModule;
    const residues = (n: number, seed: number) => {
      let s = seed;
      return Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) % 2147483648; return 'ACGT'[s % 4]; }).join('');
    };
    const tall = (rows: number, columns: number, name = (i: number) => `Seq${i + 1}`) =>
      alignment(`aln-tall-${rows}-${columns}`, `Tall ${rows} x ${columns}`, Array.from({ length: rows }, (_v, i) => ({ name: name(i), sequence: residues(columns, i + 1) })));
    const verdict = (doc: SequenceDocument) => {
      const rows = alignmentImageRows(doc);
      if (!rows) expect.fail(`${doc.name} is an alignment`);
      const message = alignmentImageRefusal(doc.name, rows);
      const drawing = drawAlignmentImage(doc.name, { rows: rows.map((r, i) => ({ label: `${i + 1}. ${r.name}`, aligned: r.sequence, identity: '100%' })), consensus: rows[0].sequence, consensusLabel: 'majority', scheme: 'ACGT - Default', isProtein: false });
      const size = alignmentImageSize(rows.map((r, i) => `${i + 1}. ${r.name}`), rows[0].sequence.length);
      expect(drawing.ok ? null : drawing.message, `${doc.name}: the drawing refuses as the menu does`).toBe(message);
      return { message, drawing, size };
    };

    // The samples the operator reads (COXII) and the largest one are drawn whole.
    for (const doc of [coxii, threeKingdoms]) expect(verdict(doc).message, doc.name).toBeNull();

    // On a side: 2 blocks (61 columns) of 386 rows are 10,918 px tall, 32,754 px at 3x, and drawn;
    // 387 rows are 10,946 px, 32,838 px at 3x, past 32,767, and refused, though their CSS size is
    // well under it and their area is under the area limit.
    const under = verdict(tall(386, 61));
    expect(under.message).toBeNull();
    expect([under.size.height, under.size.pixelHeight]).toEqual([10_918, 32_754]);
    if (!under.drawing.ok) expect.fail('386 rows are drawn');
    expect((under.drawing.inner.match(/class="aln-row"/g) ?? []).length, 'every row of both blocks is drawn').toBe(386 * 2);
    const over = verdict(tall(387, 61));
    expect([over.size.height, over.size.pixelHeight]).toEqual([10_946, 32_838]);
    expect(over.size.pixelWidth * over.size.pixelHeight).toBeLessThan(268_435_456);
    expect(over.message, '387 rows are refused').not.toBeNull();
    expect(over.drawing.ok, 'and not drawn in part').toBe(false);

    // In area: names long enough to widen the drawing past 268,435,456 px at 3x, with each side
    // under 32,767 px, are refused; the same rows with a shorter name fit.
    const wide = verdict(tall(425, 50, (i) => (i === 0 ? 'W'.repeat(700) : `Seq${i + 1}`)));
    expect(Math.max(wide.size.pixelWidth, wide.size.pixelHeight), 'each side is under the side limit').toBeLessThan(32_767);
    expect(wide.size.pixelWidth * wide.size.pixelHeight).toBeGreaterThan(268_435_456);
    expect(wide.message, 'the wide drawing is refused').not.toBeNull();
    const narrower = verdict(tall(425, 50, (i) => (i === 0 ? 'W'.repeat(500) : `Seq${i + 1}`)));
    expect(narrower.size.pixelWidth * narrower.size.pixelHeight).toBeLessThan(268_435_456);
    expect(narrower.size.pixelHeight).toBe(wide.size.pixelHeight);
    expect(narrower.message, 'the narrower one fits').toBeNull();

    // The message names the alignment, what it needs and the limit.
    for (const refused of [over, wide]) {
      expect(refused.message).toContain('32,767 pixels on a side');
      expect(refused.message).toContain('268,435,456 pixels in all');
      expect(refused.message).toContain(`${refused.size.pixelWidth.toLocaleString('en-US')} x ${refused.size.pixelHeight.toLocaleString('en-US')} pixels`);
      expect(refused.message).toMatch(/too large to draw whole/);
      expect(refused.message).toMatch(/Nothing was exported/);
    }

    // In the App: Export › Alignment Image › PNG on an alignment too tall to draw is refused with
    // that message in the status bar, and nothing is saved.
    const big = tall(800, 61);
    const expected = verdict(big).message!;
    for (const format of ['PNG', 'SVG']) {
      let selected = false;
      const { root } = exportMenuOf([big], big.id, (items) => {
        const menu = alignmentImageMenu(items);
        const command = menu?.children.find((c): c is Command => c.kind === 'command' && c.label.includes(format));
        if (!command) expect.fail(`the Export menu offers Alignment Image › ${format} for the tall alignment`);
        selected = true;
        command.onSelect();
      });
      expect(selected).toBe(true);
      const banners = findAll(root, hasClass('statusbar-toast-text')).map((b) => text(b));
      expect(banners.some((b) => b.includes(expected)), `${format}: the status bar says why (${banners.join(' | ')})`).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(probe.saved, `${format}: nothing was saved`).toEqual([]);
    }
  });
});

// ─── US-01M6TDGW: the removed protein scheme ───

describe('US-01M6TDGW: the removed protein scheme is offered nowhere', () => {
  it('no scheme list offers the removed scheme, and the studio guard rejects it', async () => {
    // Wrong implementations this fails: the removed scheme still offered for either molecule type,
    // so the studio's guard, which replaces a scheme its molecule type does not offer with that
    // type's default, would keep it; and a default other than Zappo for a protein. That the studio
    // runs the guard on a live mount is AC3 of alignmentStudioLiveScheme.test.tsx. The name is built
    // here because AC1 bars its literal from src.
    const removed = 'ARND*'.split('').join(' ');
    const vm = await import('../core/alignmentViewModel');
    for (const isProtein of [true, false]) {
      const kind = isProtein ? 'protein' : 'nucleotide';
      expect(vm.colorSchemesFor(isProtein).map((o) => o.value), `${kind}: the removed scheme is not offered`).not.toContain(removed);
      expect(vm.isSchemeValidFor(removed as Parameters<typeof vm.isSchemeValidFor>[0], isProtein), `${kind}: the guard rejects it`).toBe(false);
    }
    expect(vm.defaultColorScheme(true), 'what the guard puts in its place for a protein').toBe('Zappo');
  });
});

// ─── BG-01M6XPX5: the scheme the studio is showing, not the molecule type's default ───

describe('BG-01M6XPX5: the exported image is painted in the scheme the studio shows', () => {
  it("the alignment image uses the studio's colour scheme", async () => {
    // Wrong implementations this fails: the export painting the molecule type's default scheme
    // whatever the studio shows (the defect: defaultColorScheme(isProtein) at the drawing's source);
    // a scheme the studio publishes nowhere, so the export reads a store no component writes; and a
    // picked scheme the grid itself does not take up. The pick is made through the studio's own
    // Colors select, and what the file must agree with is read off the studio's grid, rendered for
    // the same document afterwards - never from a store set by hand.
    const doc = threeKingdoms; // 35 aligned protein members: opens in Zappo, offers Clustal X
    const opened = gridOf(doc);
    expect(opened.colorScheme, `${doc.name}: opens in its molecule type's default`).toBe('Zappo');

    // A pick must also tell the grid's watchers, or the open studio would keep drawing the old
    // scheme until something else redrew it. (That the live grid redraws on a pick is AC3 of
    // alignmentStudioLiveScheme.test.tsx; a server render cannot subscribe, so the telling is
    // counted here.)
    let told = 0;
    const stopWatching = imageModule.subscribeAlignmentImageColorScheme(() => { told += 1; });
    try {
      pickGridScheme(doc, 'Clustal');
    } finally {
      stopWatching();
    }
    expect(told, `${doc.name}: the pick tells the grid's watchers`).toBeGreaterThan(0);
    const picked = gridOf(doc);
    expect(picked.colorScheme, `${doc.name}: the grid is drawn in the picked scheme`).toBe('Clustal');
    // The two schemes must part company on the letters this alignment holds, or the file could
    // agree with both and the check would pass on the defect.
    const parted = [...picked.cells.keys()].filter(
      (ch) => ch !== '-' && opened.cells.get(ch)?.background !== picked.cells.get(ch)?.background
    );
    expect(parted.length, `${doc.name}: Clustal washes residues Zappo washes otherwise`).toBeGreaterThan(0);

    const { file } = await exportFrom(WINDOWS[0], alignmentImageCommands(doc).SVG);
    const { svg } = svgOf(file);
    const drawnLetters = new Set<string>();
    for (const line of readImage(svg).flatMap((b) => [b.consensus, ...b.rows])) {
      for (const cell of line.residues) {
        const seen = picked.cells.get(cell.ch);
        if (cell.ch === '-' || !seen) continue;
        const cellRect = kids(cell.el.parent!).find((k) => k.tag === 'rect' && Number(k.attrs.x) + 5 === cell.x && Number(k.attrs.y) + 10 === cell.y);
        drawnLetters.add(cell.ch);
        expect(cellRect?.attrs.fill, `${doc.name}: "${cell.ch}" is filled as the Clustal grid fills it (${seen.background})`).toBe(onCanvasWhite(seen.background));
        expect(inherited(cell.el, 'fill'), `${doc.name}: "${cell.ch}" is lettered as the Clustal grid letters it (${seen.color})`).toBe(onCanvasWhite(seen.color));
      }
    }
    expect(parted.filter((ch) => drawnLetters.has(ch)), `${doc.name}: the letters the two schemes part on were drawn and checked`).not.toEqual([]);
    // Read by hand, so the check does not take the studio's word for the palette: Clustal X washes
    // the Negative group (D, E) in #c048c0 and the Positive group (K, R) in #f01505 at 0x66 over
    // Canvas White (Jalview, Colour Schemes > Clustal X), where Zappo washes them #ff0000 and #6464ff.
    const fills = Object.fromEntries(['D', 'E', 'K', 'R'].map((ch) => [ch, onCanvasWhite(picked.cells.get(ch)!.background)]));
    expect(fills, `${doc.name}: the grid's Clustal cells`).toEqual({ D: '#e6b6e6', E: '#e6b6e6', K: '#f9a19b', R: '#f9a19b' });
  });
});
