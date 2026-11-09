// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q177: the Alignment studio keeps to two tab levels. The document's view tabs are the
 * first; the studio's mode strip is the second and the only tab strip above the alignment grid.
 * The sub-views that repeated a document tab are gone, the analyses (the members' annotation
 * table, distances, lengths, gel and fragments) open from the inspector rail beside the grid,
 * contigs keep their traces and read QC as mode-strip views, Dotplot mode draws an alignment's own
 * members, and the Flatfile tab shows an alignment's text.
 *
 * Every check renders the real studio (or drives the real App) and reads the markup that results;
 * none reads source text. Controls are operated by calling the handlers the studio's render hands
 * to its own elements: a state update made while a component renders re-renders it with that
 * update, so a click made from inside the render is followed by the render that shows its result.
 * The sample documents are the bundled sample library, so no reference data is needed.
 *
 * BG-01M6RJG0: the studio's dotplot draws with PRD F11's window 11 and minimum 9 matches, and its
 * figure and PNG export say so. Those checks also render the dotplot on its own (with the props the
 * studio hands it, or a generated pair) and run its drawing effect against a recording canvas.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with a dispatcher for its menu commands. */
  onMenus: null as null | ((dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Sees every effect a component registers while it renders, so a test can run it afterwards. */
  onEffect: null as null | ((effect: () => unknown) => void),
  /** Every file the workbench was asked to save, in order. */
  saved: [] as { name: string; content: unknown; mime: string }[],
}));

vi.mock('../platform/macosMenuBridge', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/macosMenuBridge');
  return {
    ...actual,
    saveWorkbenchFile: (name: string, content: unknown, mime: string) => {
      probe.saved.push({ name, content, mime });
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
  // A server render never runs effects; the probe hands them to the test, which runs them itself.
  const useEffect = ((effect: Parameters<typeof actual.useEffect>[0], deps?: Parameters<typeof actual.useEffect>[1]) => {
    probe.onEffect?.(effect);
    return actual.useEffect(effect, deps);
  }) as typeof actual.useEffect;
  return { ...actual, default: { ...actual, useRef, useEffect }, useRef, useEffect };
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

const { App } = await import('../App');
// Read through the module object, so an export this story adds fails only the criterion that needs it.
const studioModule = await import('../components/AlignmentAndPhyloStudio');
const { SequenceAlignmentStudio } = studioModule;
const { AlignmentCanvas } = await import('../components/AlignmentCanvas');
const { AlignmentDotplot } = await import('../components/AlignmentDotplot');
const bio = await import('../core/bioEngine');
const { computeDotplot } = await import('../core/alignmentViewModel');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
const { computeNonEndGapPairwiseMetric } = await import('../core/alignmentAnalysis');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
type SequenceDocument = import('../types/bio').SequenceDocument;
type StudioProps = React.ComponentProps<typeof SequenceAlignmentStudio>;

afterEach(() => {
  probe.onElement = null;
  probe.onEffect = null;
  probe.onMenus = null;
  probe.saved = [];
  vi.unstubAllGlobals();
});

// ─── Rendered markup as a tree ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }

function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent, children: [] };
  if (parent) parent.children.push(node);
  return node;
}
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses React's static markup (well formed, quoted attributes). */
function parse(html: string): El {
  const root = el('root');
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {
      cur.children.push(decode(m[5]));
      continue;
    }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node = el(tag, attrs, cur);
    if (tag.toLowerCase() === 'style' || tag.toLowerCase() === 'script') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      node.children.push(html.slice(re.lastIndex, end));
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (!selfClosing && !VOID.has(tag.toLowerCase())) cur = node;
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
const within = (e: El, outer: El) => {
  for (let p: El | null = e; p; p = p.parent) if (p === outer) return true;
  return false;
};
const hidden = (e: El) => e.attrs['aria-hidden'] === 'true' || /display:\s*none/.test(e.attrs.style ?? '');
/** The text a reader is given: aria-hidden and display:none subtrees left out. */
const shownText = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : hidden(c) ? '' : shownText(c))).join('');
const text = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : text(c))).join('');
/** A tab's accessible name: its aria-label, else the text it shows. */
const tabName = (tab: El) => (tab.attrs['aria-label'] ?? shownText(tab)).trim();

/** Every tab in the studio's tab lists, with the list it sits in. */
function studioTabs(root: El) {
  return findAll(root, (e) => e.attrs.role === 'tablist').flatMap((list) =>
    findAll(list, (e) => e.attrs.role === 'tab').map((tab) => ({ list: list.attrs['aria-label'] ?? '', tab, name: tabName(tab), title: tab.attrs.title ?? '' })),
  );
}
const modeStripOf = (root: El) => {
  const strips = findAll(root, (e) => e.attrs.role === 'tablist' && e.attrs['aria-label'] === 'Sequence Alignment Modes');
  expect(strips, 'the studio draws one mode strip').toHaveLength(1);
  return strips[0];
};
/** The tab lists that come before the alignment grid's pane in the markup (none is its ancestor). */
function tablistsAboveGrid(root: El): El[] {
  const order = [...walk(root)];
  const pane = order.findIndex(hasClass('mbc-aln-canvas-pane'));
  expect(pane, 'the alignment grid is drawn').toBeGreaterThan(0);
  return order.slice(0, pane).filter((e) => e.attrs.role === 'tablist');
}

// ─── The studio, and clicks made from inside its render ───

const byId = (id: string) => {
  const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
  if (!doc) throw new Error(`sample library has no ${id}`);
  return doc;
};
const coxii = byId('doc-aln-coxii-cds'); // aligned, 50 nucleotide members
const coi = byId('doc-contig-coi-assembly'); // contig of two traced Sanger reads
const proteinPair = byId('doc-aln-pairwise-protein'); // aligned protein pair
const ionTorrent = byId('doc-contig-yghj-ion-torrent'); // simulated NGS read list, no traces

/** The studio as the App mounts it for one document (the project's documents beside it). */
const studioProps = (doc: SequenceDocument, more: Partial<StudioProps> = {}): StudioProps =>
  ({ documents: [doc], projectDocuments: SAMPLE_LIBRARY, activeDoc: doc, ...more }) as StudioProps;

/**
 * Renders the studio, clicking in turn each button whose accessible name (aria-label, else its
 * text) is listed, each in the render that the click before it caused.
 */
function renderStudio(props: StudioProps, clicks: string[] = []): El {
  let next = 0;
  const clicked: string[] = [];
  probe.onElement = (type, p) => {
    if (next >= clicks.length || type !== 'button') return;
    const label = typeof p['aria-label'] === 'string' ? p['aria-label'] : React.Children.toArray(p.children as React.ReactNode)
      .map((c) => (typeof c === 'string' ? c : React.isValidElement(c) && typeof (c.props as { children?: unknown }).children === 'string' ? (c.props as { children: string }).children : ''))
      .join('').trim();
    if (label !== clicks[next]) return;
    clicked.push(label);
    next++;
    (p.onClick as () => void)();
  };
  const html = renderToStaticMarkup(<SequenceAlignmentStudio {...props} />);
  probe.onElement = null;
  expect(clicked, 'every click found its button').toEqual(clicks);
  return parse(html);
}

const unalignedList: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT, id: 'list', name: 'Unaligned list', sequence: 'ACGTACGTACGT', folder: 'Local',
  alignmentMeta: {
    isAligned: false,
    sequences: [
      { id: 'm1', name: 'MemberOne', sequence: 'ACGTACGTACGT' },
      { id: 'm2', name: 'MemberTwo', sequence: 'TTGCA' },
    ],
  },
} as SequenceDocument;

/**
 * An aligned set whose members carry annotations: a quoted name, a two-interval reverse CDS, a
 * directionless source, a strand-0 promoter, a gapped member and a member with none.
 */
const annotatedSeq = 'ATGGCTAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATC';
const annotated = {
  ...EMPTY_WORKSPACE_DOCUMENT, id: 'aln-annotated', name: 'Annotated "pair" set', sequence: annotatedSeq, folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
  alignmentMeta: {
    isAligned: true,
    sequences: [
      { id: 'm1', name: 'Member_One', sequence: annotatedSeq, features: [
        { id: 'g1', name: 'lacZ "alpha"', type: 'gene', start: 3, end: 20, strand: 1, color: '#2563eb' },
        { id: 'c1', name: 'CDS, split', type: 'CDS', start: 5, end: 30, strand: -1, color: '#16a34a',
          segments: [{ index: 1, name: 's1', start: 5, end: 10, color: '#16a34a' }, { index: 2, name: 's2', start: 15, end: 30, color: '#16a34a' }] },
      ] },
      { id: 'm2', name: 'Member_Two', sequence: `${annotatedSeq.slice(0, 20)}--${annotatedSeq.slice(22)}`, features: [
        { id: 's1', name: 'source', type: 'source', start: 1, end: 43, strand: 1, color: '#94a3b8' },
        { id: 'p1', name: 'Pro', type: 'promoter', start: 2, end: 9, strand: 0, color: '#f59e0b' },
      ] },
      { id: 'm3', name: 'Member_Three', sequence: annotatedSeq },
    ],
  },
} as unknown as SequenceDocument;

/** The CSV the base's Annotations sub-view (dcdd53f) exported for `annotated`, byte for byte. */
const ANNOTATED_BASE_CSV = [
  '"Name","Sequence","Type","Minimum","Maximum","Length","Intervals","Direction","Track"',
  '"lacZ ""alpha""","Member_One","gene","3","20","18","1","forward",""',
  '"CDS, split","Member_One","CDS","5","30","22","2","reverse",""',
  '"source","Member_Two","source","1","43","43","1","none",""',
  '"Pro","Member_Two","promoter","2","9","8","1","forward",""',
].join('\n');

// ─── AC1 ───

describe('AC1: one tab level above the grid', () => {
  it('renders one tab level above the alignment grid', () => {
    for (const doc of [coxii, coi]) {
      const root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc)} />));
      expect(tablistsAboveGrid(root).map((l) => l.attrs['aria-label']), `${doc.name}: tab lists above the grid`).toEqual(['Sequence Alignment Modes']);
      expect(findAll(root, hasClass('mbc-aln-primary-tabbar')), `${doc.name}: no primary tab bar`).toEqual([]);
      // The inspector rail is the one other tab list, and it sits beside the grid in the split layout.
      const rail = findAll(root, (e) => e.attrs.role === 'tablist' && e.attrs['aria-label'] === 'Alignment Inspector Tabs');
      expect(rail).toHaveLength(1);
      const split = findAll(root, hasClass('mbc-aln-split-layout'));
      expect(split).toHaveLength(1);
      expect(within(rail[0], split[0]), `${doc.name}: the rail is inside the split layout`).toBe(true);
      expect(findAll(root, (e) => e.attrs.role === 'tablist')).toHaveLength(2);
    }
  });
});

// ─── AC2 ───

describe('AC2: no sub-view repeats a document tab', () => {
  const FORBIDDEN = ['Annotations', 'Info', 'Text View', 'Lineage', 'Feature Intervals', 'Conservation Telemetry', 'Clustal / FASTA Stream', 'Provenance DAG'];

  it('drops the sub-views that repeat document tabs', () => {
    for (const doc of [coxii, coi]) {
      const root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc)} />));
      const tabs = studioTabs(root);
      expect(tabs.length, `${doc.name}: tabs were read`).toBeGreaterThan(8);
      for (const t of tabs) {
        expect(FORBIDDEN, `${doc.name}: tab "${t.name}" in ${t.list}`).not.toContain(t.name);
        expect(FORBIDDEN, `${doc.name}: tab titled "${t.title}" in ${t.list}`).not.toContain(t.title);
      }
      const dotplots = tabs.filter((t) => t.name === 'Dotplot');
      expect(dotplots.map((t) => t.list), `${doc.name}: Dotplot appears once, in the mode strip`).toEqual(['Sequence Alignment Modes']);
      // Nor is any of those views drawn under another name: the studio shows none of their headings.
      const shown = shownText(root);
      for (const heading of FORBIDDEN.slice(4)) expect(shown, `${doc.name}: "${heading}" is not drawn`).not.toContain(heading);
    }
  });

  // The Lineage sub-view listed a document's parents and descendants, each opened by Go to. The
  // History tab's lineage graph does that now. The wrong implementations this fails: the App giving
  // the History studio no way to open a document (Go to drawn disabled, or not drawn); a Go to that
  // opens the wrong document; an App handler that does not make the linked document active.
  it('drops the sub-views that repeat document tabs, and the History tab opens the documents its lineage links', async () => {
    const step = (id: string, operation: string, parentIds: string[]) =>
      ({ id, timestamp: '2026-11-06 10:00', operation, description: operation, parentIds, lengthBp: 30, topology: 'linear' });
    const lineageDoc = (id: string, name: string, history: ReturnType<typeof step>[]) =>
      ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, accession: id, sequence: 'ATGGCTAGC'.repeat(4), folder: 'Local', moleculeType: 'DNA', topology: 'linear', history }) as unknown as SequenceDocument;
    const parent = lineageDoc('lineage-parent', 'Lineage_Parent', [step('p1', 'Imported', [])]);
    const child = lineageDoc('lineage-child', 'Lineage_Child', [step('c1', 'Insert fragment', ['lineage-parent'])]);
    const grandchild = lineageDoc('lineage-grandchild', 'Lineage_Grandchild', [step('g1', 'Mutagenesis', ['lineage-child'])]);
    const project = [parent, child, grandchild];
    const isHistoryStudio = (p: Record<string, unknown>) => 'allDocuments' in p && 'initialSubTab' in p && 'doc' in p;
    /** Opens the History studio's lineage graph (a restored session opens the studio on its first module). */
    const openLineage = (type: unknown, p: Record<string, unknown>) => {
      if (type === 'button' && p.role === 'tab' && p['aria-selected'] === false && p.children === 'History Tree, Alerts & Info (⌘8)') (p.onClick as () => void)();
    };

    // The child's History tab lists its parent and its descendant, each with a Go to; Go to on the
    // parent asks the App to open the parent.
    const asked: string[] = [];
    const goTo: { label: string; disabled: boolean }[] = [];
    const app = await appRestored(project, child.id, 'history-hybrid', (type, p) => {
      openLineage(type, p);
      if (isHistoryStudio(p) && typeof p.onSelectDocument === 'function') {
        p.onSelectDocument = (id: string) => { asked.push(id); };
      }
      if (type === 'button' && typeof p['aria-label'] === 'string' && p['aria-label'].startsWith('Go to ')) {
        goTo.push({ label: p['aria-label'], disabled: Boolean(p.disabled) });
        if (p['aria-label'] === 'Go to Lineage_Parent') (p.onClick as () => void)();
      }
    });
    const list = findAll(app, (e) => e.tag === 'ul' && e.attrs['aria-label'] === 'Linked documents');
    expect(list, 'the History tab lists the linked documents').toHaveLength(1);
    expect(findAll(list[0], (e) => e.tag === 'li').map((li) => [text(kids(li)[0]), text(kids(li)[1])])).toEqual([
      ['Parent', 'Lineage_Parent'],
      ['Descendant', 'Lineage_Grandchild'],
    ]);
    expect(goTo, 'each linked document has a Go to the App can act on').toEqual([
      { label: 'Go to Lineage_Parent', disabled: false },
      { label: 'Go to Lineage_Grandchild', disabled: false },
    ]);
    expect(asked, 'Go to asks the App for the parent').toEqual([parent.id]);

    // The App's handler opens it: the parent becomes the active document.
    let opened = 0;
    const after = await appRestored(project, child.id, 'history-hybrid', (type, p) => {
      openLineage(type, p);
      if (isHistoryStudio(p) && (p.doc as SequenceDocument).id === child.id && typeof p.onSelectDocument === 'function') {
        opened++;
        (p.onSelectDocument as (id: string) => void)(asked[0]);
      }
    });
    expect(opened, 'the App hands the History studio a way to open a document').toBeGreaterThan(0);
    const openFiles = findAll(after, (e) => e.attrs.role === 'tablist' && e.attrs['aria-label'] === 'Open Project Files');
    expect(openFiles).toHaveLength(1);
    expect(findAll(openFiles[0], (e) => e.attrs.role === 'tab' && e.attrs['aria-selected'] === 'true').map(tabName), 'the parent is the active document').toEqual(['Lineage_Parent']);
    // Its History tab now draws the parent's lineage.
    const parentList = findAll(after, (e) => e.tag === 'ul' && e.attrs['aria-label'] === 'Linked documents');
    expect(parentList).toHaveLength(1);
    expect(findAll(parentList[0], (e) => e.tag === 'li').map((li) => [text(kids(li)[0]), text(kids(li)[1])])).toEqual([
      ['Descendant', 'Lineage_Child'],
      ['Linked', 'Lineage_Grandchild'],
    ]);
  });
});

// ─── AC3 ───

describe('AC3: the analyses open from the inspector', () => {
  const PANELS = [
    { id: 'member-annotations', label: 'Member Annotations' },
    { id: 'distances', label: 'Substitution Distances' },
    { id: 'lengths-graph', label: 'Lengths Graph' },
    { id: 'virtual-gel', label: 'Virtual Gel' },
    { id: 'fragments', label: 'Fragments' },
  ] as const;
  const railNames = (root: El) => studioTabs(root).filter((t) => t.list === 'Alignment Inspector Tabs').map((t) => t.name);
  const inspectorBody = (root: El) => {
    const bodies = findAll(root, hasClass('mbc-aln-inspector-body'));
    expect(bodies).toHaveLength(1);
    return bodies[0];
  };
  /** The panel's own content, which must be drawn inside the inspector body and nowhere else. */
  const marker: Record<(typeof PANELS)[number]['id'], (e: El) => boolean> = {
    'member-annotations': (e) => e.tag === 'table' && findAll(e, (th) => th.tag === 'th' && text(th) === '# Intervals').length === 1,
    distances: (e) => e.tag === 'table' && e.classes.has('mbc-aln-matrix-table'),
    'lengths-graph': (e) => e.tag === 'h4' && text(e) === 'Sequence Length Distribution',
    'virtual-gel': (e) => e.tag === 'svg' && e.attrs.id === 'mbc-virtual-gel-svg',
    fragments: (e) => e.tag === 'span' && text(e) === 'Simulate restriction digest',
  };
  const ungapped = (s: string) => s.replace(/[-.]/g, '').length;

  it('opens distances, lengths, gel and fragments from the inspector', () => {
    const members = coxii.alignmentMeta!.sequences!;
    for (const panel of PANELS) {
      // Opened with initialInspectorTab, and opened by clicking its rail entry from the default panel.
      const opened = [
        renderStudio(studioProps(coxii, { initialInspectorTab: panel.id } as Partial<StudioProps>)),
        renderStudio(studioProps(coxii), [panel.label]),
      ];
      for (const root of opened) {
        expect(railNames(root), 'the rail lists the analyses').toEqual(expect.arrayContaining(PANELS.map((p) => p.label)));
        const selected = studioTabs(root).filter((t) => t.list === 'Alignment Inspector Tabs' && t.tab.attrs['aria-selected'] === 'true');
        expect(selected.map((t) => t.name), `${panel.label} is the selected rail entry`).toEqual([panel.label]);
        const body = inspectorBody(root);
        const hits = findAll(root, marker[panel.id]);
        expect(hits.length, `${panel.label} is drawn`).toBe(1);
        expect(within(hits[0], body), `${panel.label} is drawn in the inspector body`).toBe(true);
        expect(findAll(root, hasClass('mbc-aln-canvas-pane')), 'the grid stays beside it').toHaveLength(1);
        // Moving the view does not change its numbers.
        if (panel.id === 'distances') {
          const firstRow = findAll(hits[0], (e) => e.tag === 'tr')[1];
          const cell = kids(firstRow)[2];
          const padded = (s: string) => s.toUpperCase().replace(/\./g, '-').padEnd(Math.max(...members.map((m) => m.sequence.length)), '-');
          const expected = computeNonEndGapPairwiseMetric(padded(members[0].sequence), padded(members[1].sequence), 'identity');
          expect(text(cell), 'row 1, column 2 is the identity of members 1 and 2').toBe(`${expected.toFixed(3)}%`);
        }
        if (panel.id === 'lengths-graph') {
          const lens = members.map((m) => ungapped(m.sequence));
          const kv = Object.fromEntries(findAll(body, hasClass('mbc-aln-stat-kv')).map((row) => [text(kids(row)[0]), text(kids(row)[1])]));
          expect(kv['Minimum:']).toBe(`${Math.min(...lens).toLocaleString()} bp`);
          expect(kv['Maximum:']).toBe(`${Math.max(...lens).toLocaleString()} bp`);
        }
      }
    }

    // The members' annotations: one row per member feature, sorted by member then start, and the
    // panel's export writes the CSV the removed Annotations sub-view wrote for the same alignment
    // (captured from the base, dcdd53f, by clicking its "Export table (CSV)").
    const annotatedRoot = renderStudio(studioProps(annotated), ['Member Annotations', 'Export table (CSV)']);
    const annotatedBody = inspectorBody(annotatedRoot);
    const table = findAll(annotatedRoot, marker['member-annotations']);
    expect(table).toHaveLength(1);
    expect(within(table[0], annotatedBody), 'the member annotation table is in the inspector body').toBe(true);
    expect(findAll(table[0], (e) => e.tag === 'th').map(text)).toEqual(
      ['Name', 'Sequence Name', 'Type', 'Minimum', 'Maximum', 'Length', '# Intervals', 'Direction', 'Track']);
    const bodyRows = findAll(table[0], (e) => e.tag === 'tr' && e.parent?.tag === 'tbody').map((tr) => kids(tr).map(text));
    expect(bodyRows).toEqual([
      ['lacZ "alpha"', 'Member_One', 'gene', '3', '20', '18', '1', 'forward', ''],
      ['CDS, split', 'Member_One', 'CDS', '5', '30', '22', '2', 'reverse', ''],
      ['source', 'Member_Two', 'source', '1', '43', '43', '1', 'none', ''],
      ['Pro', 'Member_Two', 'promoter', '2', '9', '8', '1', 'forward', ''],
    ]);
    expect(probe.saved, 'the export saved one file').toHaveLength(1);
    expect(probe.saved[0]).toEqual({ name: 'Annotated_pair_set_annotations.csv', content: ANNOTATED_BASE_CSV, mime: 'text/csv;charset=utf-8' });

    // Gel and fragments are nucleotide analyses: a protein alignment's rail offers neither.
    const protein = renderStudio(studioProps(proteinPair));
    expect(railNames(protein)).toEqual(expect.arrayContaining(['Member Annotations', 'Substitution Distances', 'Lengths Graph']));
    expect(railNames(protein)).not.toContain('Virtual Gel');
    expect(railNames(protein)).not.toContain('Fragments');

    // An unaligned list: distances asks to align first and draws no matrix.
    const list = renderStudio({ documents: [unalignedList], activeDoc: unalignedList, initialInspectorTab: 'distances' } as StudioProps);
    const body = inspectorBody(list);
    expect(shownText(body)).toContain('Align first');
    expect(findAll(list, marker.distances)).toEqual([]);
  });

  // The gel moved from a full-width view into the inspector, where it is drawn narrower than its
  // 440-unit view. The widths are the gel SVG's drawn width in Chromium with the inspector open on
  // the gel (opuntia, project sidebar open): 426px at 1280x800 and 434px at 1440x900. At each, every
  // label is at least 11px on screen and no two labels' boxes meet. The wrong implementations this
  // fails: labels at fixed gel units (about 9.7px at 1280); lane names over the lanes (a 30-character
  // name is several lanes wide at that size); every ladder size labelled (2,500 and 2,000 sit 11
  // units apart); the figure left at the SVG's default 300px width.
  it('opens distances, lengths, gel and fragments from the inspector, and draws the gel legibly at the inspector\'s width', () => {
    const DRAWN_WIDTHS = { '1280x800': 426, '1440x900': 434 };
    const name30 = (n: number) => `gi|62732${80 + n}|gb|AF1916${50 + n}.1|AF191`;
    const seq = 'TATACATTAAAGAAGGGGGATGCGGATAAATGGAAAGGCGAAAGAAAGAATATATATATATATATATATATATATATATATATATATATATATATATATATATATATAAATATAAATAT'.slice(0, 120);
    const opuntiaLike = {
      ...EMPTY_WORKSPACE_DOCUMENT, id: 'aln-opuntia-like', name: 'opuntia-like', sequence: seq, folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
      alignmentMeta: { isAligned: true, sequences: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, name: name30(i), sequence: i % 2 ? `${seq.slice(0, 40)}${'-'.repeat(6)}${seq.slice(46)}` : seq })) },
    } as unknown as SequenceDocument;
    expect(name30(1)).toHaveLength(30);

    /** A label's box in gel units, from the attributes it is drawn with (a generous width per character). */
    const boxOf = (t: El) => {
      const size = Number(t.attrs['font-size']);
      const x = Number(t.attrs.x);
      const y = Number(t.attrs.y);
      const chars = [...text(t)].length;
      const mono = /mono/.test(t.attrs['font-family'] ?? '');
      const w = chars * size * (mono ? 0.75 : 0.7) + chars * Number(t.attrs['letter-spacing'] ?? 0);
      const anchor = t.attrs['text-anchor'] ?? 'start';
      const [x0, x1] = anchor === 'end' ? [x - w, x] : anchor === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w];
      const rotate = /rotate\(\s*-90\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(t.attrs.transform ?? '');
      if (rotate) return { left: x - 0.95 * size, right: x + 0.3 * size, top: y - (x1 - x), bottom: y - (x0 - x) };
      return { left: x0, right: x1, top: y - 0.95 * size, bottom: y + 0.3 * size };
    };
    const meet = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

    for (const doc of [opuntiaLike, coxii]) {
      for (const ladder of ['10bp DNA Ladder', '1kb DNA Ladder']) {
        for (const [viewport, width] of Object.entries(DRAWN_WIDTHS)) {
          const where = `${doc.name}, ${ladder}, ${viewport}`;
          let measured = false;
          probe.onElement = (type, p) => {
            if (type === 'select' && p.value === '10bp DNA Ladder' && ladder !== p.value) (p.onChange as (e: unknown) => void)({ target: { value: ladder } });
            if (type === 'svg' && p.id === 'mbc-virtual-gel-svg' && !measured) {
              measured = true;
              if (typeof p.ref !== 'function') throw new Error(`the gel's ref is ${typeof p.ref}, not a callback that measures the drawn gel`);
              (p.ref as (el: unknown) => void)({ getBoundingClientRect: () => ({ width, height: width, top: 0, left: 0, right: width, bottom: width, x: 0, y: 0 }) });
            }
          };
          let root: El;
          try {
            root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialInspectorTab: 'virtual-gel' } as Partial<StudioProps>)} />));
          } finally {
            probe.onElement = null;
          }
          expect(measured, `${where}: the gel was measured`).toBe(true);
          const svg = findAll(root, (e) => e.tag === 'svg' && e.attrs.id === 'mbc-virtual-gel-svg');
          expect(svg).toHaveLength(1);
          expect(within(svg[0], inspectorBody(root)), `${where}: the gel is in the inspector`).toBe(true);
          // The figure fills its column, so the gel is drawn at the measured width, not the SVG's default 300px.
          const figure = svg[0].parent!;
          expect('data-mbc-figure' in figure.attrs, `${where}: the gel's figure`).toBe(true);
          expect(figure.attrs.style ?? '', `${where}: the gel's figure fills its column`).toMatch(/(^|;)\s*width:\s*100%/);
          const [, , viewW] = (svg[0].attrs.viewBox ?? '').split(/\s+/).map(Number);
          const scale = width / viewW;
          expect(scale, `${where}: the gel is drawn below its own size`).toBeLessThan(1);

          const labels = findAll(svg[0], (e) => e.tag === 'text' && text(e).trim() !== '');
          expect(labels.length, `${where}: the gel's labels are drawn`).toBeGreaterThan(10);
          for (const t of labels) {
            expect(Number(t.attrs['font-size']) * scale, `${where}: "${text(t)}" on screen (px)`).toBeGreaterThanOrEqual(11);
          }
          for (let i = 0; i < labels.length; i++) {
            for (let j = i + 1; j < labels.length; j++) {
              expect(meet(boxOf(labels[i]), boxOf(labels[j])), `${where}: "${text(labels[i])}" and "${text(labels[j])}" do not meet`).toBe(false);
            }
          }
          // Every lane is named, in full, and every ladder band keeps its tick.
          const shown = labels.map((t) => text(t));
          expect(shown).toContain(ladder);
          for (const m of doc.alignmentMeta!.sequences!.slice(0, 4)) expect(shown, `${where}: lane for ${m.name}`).toContain(m.name);
        }
      }
    }
  });
});

// ─── AC4 ───

describe('AC4: Dotplot mode draws the alignment members', () => {
  const member = (id: string, name: string, sequence: string) => ({ id, name, sequence });
  const base = 'ATGGCTAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAG';
  const alignment: SequenceDocument = {
    ...EMPTY_WORKSPACE_DOCUMENT, id: 'aln-members', name: 'Members alignment', sequence: base, folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
    alignmentMeta: {
      isAligned: true,
      sequences: [
        member('m1', 'Member_One', base),
        member('m2', 'Member_Two', `${base.slice(0, 30)}--${base.slice(32)}`),
        member('m3', 'Member_Three', `${base.slice(0, 50)}CC${base.slice(52)}`),
      ],
    },
  } as SequenceDocument;
  const projectDoc = (id: string, name: string, sequence: string): SequenceDocument =>
    ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, folder: 'Local', moleculeType: 'DNA' }) as SequenceDocument;
  const docA = projectDoc('p-a', 'Project_Seq_A', base.slice(10));
  const docB = projectDoc('p-b', 'Project_Seq_B', base.slice(0, 60));

  /** The names the dotplot offers on its X and Y axes, and the pair it draws. */
  const dotplotOf = (root: El) => {
    const controls = findAll(root, hasClass('mbc-dotplot-controls'));
    expect(controls, 'the dotplot is drawn').toHaveLength(1);
    const selects = findAll(controls[0], (e) => e.tag === 'select').slice(0, 2);
    const options = selects.map((s) => findAll(s, (e) => e.tag === 'option').map((o) => text(o).replace(/^\d+\.\s*/, '')));
    const canvas = findAll(root, (e) => e.tag === 'canvas' && (e.attrs['aria-label'] ?? '').startsWith('Dotplot of'));
    const plot = findAll(root, hasClass('mbc-dotplot-plot'));
    expect(plot).toHaveLength(1);
    const hint = findAll(plot[0], hasClass('mbc-aln-hint'));
    return { x: options[0], y: options[1], drawn: canvas[0]?.attrs['aria-label'], hint: hint.length ? text(hint[0]) : '' };
  };

  it('draws the alignment members in Dotplot mode', () => {
    // The alignment is open with two other project documents beside it.
    const root = renderStudio({ documents: [alignment, docA, docB], projectDocuments: [alignment, docA, docB], activeDoc: alignment, initialSubMode: 'dotplot' } as StudioProps);
    const plot = dotplotOf(root);
    const names = ['Member_One', 'Member_Two', 'Member_Three'];
    expect(plot.x, 'X axis: the members').toEqual(names);
    expect(plot.y, 'Y axis: the members').toEqual(names);
    expect(plot.drawn).toBe('Dotplot of Member_One vs Member_Two');
    // The dotplot's own parameters are F11's (D0032, BG-01M6RJG0), and the figure states them.
    expect(plot.hint).toBe('Windowed match · window 11 · minimum 9 matches · both strands');

    // Without members (a plain sequence), Dotplot mode still draws the project's documents.
    const plain = renderStudio({ documents: [docA, docB], projectDocuments: [docA, docB], activeDoc: docA, initialSubMode: 'dotplot' } as StudioProps);
    expect(dotplotOf(plain).x).toEqual(['Project_Seq_A', 'Project_Seq_B']);

    // And the mode strip is still the one tab level above the figure.
    const strip = modeStripOf(root);
    expect(findAll(strip, (e) => e.attrs.role === 'tab' && e.attrs['aria-selected'] === 'true').map(tabName)).toEqual(['Dotplot']);
  });
});

// ─── BG-01M6RJG0 ───

describe('BG-01M6RJG0: the studio dotplot uses the F11 parameters and the figure says which', () => {
  type DotplotProps = React.ComponentProps<typeof AlignmentDotplot>;
  const WINDOWED = 'Windowed match · window 11 · minimum 9 matches · both strands';

  // Two diverged 150 nt sequences, from a fixed seed. Y's first 90 nt are X's with every 6th base
  // changed, and its last 50 nt are the reverse complement of X's last 50 with every 7th changed.
  // Every 11-base window over either region keeps 9 or 10 matches, while every 10-base word holds a
  // mismatch, so a word-match dotplot draws neither diagonal and a window-11, minimum-9 one draws both.
  let seed = 1101;
  const random = (n: number) =>
    Array.from({ length: n }, () => 'ACGT'[Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * 4)]).join('');
  const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  const revComp = (s: string) => [...s].reverse().map((c) => COMP[c]).join('');
  const diverge = (s: string, period: number) =>
    [...s].map((c, i) => (i % period === period - 1 ? 'ACGT'[('ACGT'.indexOf(c) + 1) % 4] : c)).join('');
  const X = random(150);
  const Y = `${diverge(X.slice(0, 90), 6)}${random(10)}${revComp(diverge(X.slice(100), 7))}`;

  /**
   * Every pair of 11-base windows with at least 9 matching positions, by brute force, as
   * "x,y,strand" with 0-based window starts: forward, and window x against the reverse complement
   * of window y.
   */
  const windowHits = (a: string, b: string, w: number, min: number) => {
    const hits: string[] = [];
    for (let i = 0; i + w <= a.length; i++) {
      for (let j = 0; j + w <= b.length; j++) {
        let fwd = 0;
        let rev = 0;
        for (let k = 0; k < w; k++) {
          if (a[i + k] === b[j + k]) fwd++;
          if (a[i + k] === COMP[b[j + w - 1 - k]]) rev++;
        }
        if (fwd >= min) hits.push(`${i},${j},1`);
        if (rev >= min) hits.push(`${i},${j},-1`);
      }
    }
    return hits.sort();
  };

  const alignmentOf = (members: { name: string; sequence: string }[], moleculeType: 'DNA' | 'Protein' = 'DNA') =>
    ({
      ...EMPTY_WORKSPACE_DOCUMENT, id: `aln-${moleculeType}`, name: 'Diverged pair', sequence: members[0].sequence, folder: 'Alignments', moleculeType, documentKind: 'alignment',
      alignmentMeta: { isAligned: true, sequences: members.map((m, i) => ({ id: `m${i}`, ...m })) },
    }) as SequenceDocument;

  /** The studio in Dotplot mode: the props it hands its dotplot, and the caption the figure shows. */
  function studioDotplot(doc: SequenceDocument) {
    let handed: DotplotProps | null = null;
    probe.onElement = (type, p) => {
      if (type === AlignmentDotplot) handed = p as unknown as DotplotProps;
    };
    const root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialSubMode: 'dotplot' } as Partial<StudioProps>)} />));
    probe.onElement = null;
    expect(handed, 'the studio mounts the dotplot').not.toBeNull();
    const plot = findAll(root, hasClass('mbc-dotplot-plot'));
    expect(plot).toHaveLength(1);
    const methodControls = findAll(root, (e) => e.tag === 'select' && e.attrs['aria-label'] === 'Dotplot method');
    return { props: handed as unknown as DotplotProps, caption: text(findAll(plot[0], hasClass('mbc-aln-hint'))[0]), methodControls };
  }

  /**
   * A canvas whose 2-D context records every call, and every stroke colour it is given, and whose
   * PNG is that record, so an export can be read back.
   */
  function recordingCanvas() {
    const calls: { op: string; args: unknown[] }[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (_t, key: string) =>
        key in state
          ? state[key]
          : key === 'measureText'
            ? (s: string) => ({ width: s.length * 6 })
            : (...args: unknown[]) => void calls.push({ op: key, args }),
      set: (_t, key: string, value) => {
        state[key] = value;
        if (key === 'strokeStyle') calls.push({ op: key, args: [value] });
        return true;
      },
    });
    const canvas = {
      width: 0, height: 0, style: {} as Record<string, string>,
      getContext: () => ctx,
      toDataURL: () => `data:image/png,${encodeURIComponent(JSON.stringify(calls))}`,
    };
    return { canvas, calls };
  }

  /**
   * Draws the dotplot as the app would: renders it with `props`, operating `change` on the
   * elements it renders (a state update made while it renders re-renders it), runs the effects of
   * its final render against a recording canvas, then presses Export PNG.
   */
  function drawDotplot(props: DotplotProps, change?: (type: unknown, p: Record<string, unknown>) => boolean) {
    const { canvas, calls } = recordingCanvas();
    probe.saved = [];
    let pending: (() => unknown)[] = [];
    let finalEffects: (() => unknown)[] = [];
    let exportPng: (() => void) | null = null;
    let changed = false;
    probe.onEffect = (effect) => pending.push(effect);
    probe.onElement = (type, p) => {
      if (type === 'canvas') (p.ref as { current: unknown }).current = canvas;
      if (type === 'button' && p.children === 'Export PNG') exportPng = p.onClick as () => void;
      if (change && !changed) changed = change(type, p);
      if (type === 'div' && p.className === 'mbc-dotplot') {
        // The outermost element closes a render pass: its effects are the ones that pass registered.
        finalEffects = pending;
        pending = [];
      }
    };
    const root = parse(renderToStaticMarkup(<AlignmentDotplot {...props} />));
    probe.onElement = null;
    probe.onEffect = null;
    if (change) expect(changed, 'the control to change was rendered').toBe(true);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    for (const effect of finalEffects) effect();
    expect(exportPng, 'the dotplot offers Export PNG').not.toBeNull();
    (exportPng as unknown as () => void)();
    vi.unstubAllGlobals();

    // The drawn matches, read back from the canvas through the plot frame: forward runs go down
    // and right, reverse-strand runs up and right; gridlines are level or upright and are skipped.
    const frames = calls.filter((c) => c.op === 'strokeRect');
    expect(frames, 'the plot frame is drawn').toHaveLength(1);
    const [fx, fy, fw] = frames[0].args as number[];
    const scale = fw / props.sequences[0].alignedSeq.replace(/-/g, '').length;
    const at = (v: number, origin: number) => Math.round((v - origin + 0.5) / scale);
    const drawn: string[] = [];
    const lengths = new Set<number>();
    /** The colour each drawn match was stroked in, by its "x,y,strand". */
    const colours: Record<string, string> = {};
    let stroke = '';
    let from: number[] | null = null;
    for (const c of calls) {
      if (c.op === 'strokeStyle') stroke = String(c.args[0]);
      if (c.op === 'moveTo') from = c.args as number[];
      if (c.op !== 'lineTo' || !from) continue;
      const [x1, y1] = c.args as number[];
      const [x0, y0] = from;
      if (x1 === x0 || y1 === y0) continue;
      const match = `${at(x0, fx)},${at(y1 > y0 ? y0 : y1, fy)},${y1 > y0 ? 1 : -1}`;
      drawn.push(match);
      colours[match] = stroke;
      lengths.add(Math.round((x1 - x0) / scale));
    }
    expect(probe.saved, 'one PNG is exported').toHaveLength(1);
    const png = probe.saved[0];
    const exported = JSON.parse(new TextDecoder().decode(png.content as Uint8Array)) as { op: string; args: unknown[] }[];
    const captions = (log: { op: string; args: unknown[] }[]) =>
      log.filter((c) => c.op === 'fillText' && /[a-z]/i.test(String(c.args[0]))).map((c) => String(c.args[0]));
    const hints = findAll(findAll(root, hasClass('mbc-dotplot-plot'))[0], hasClass('mbc-aln-hint')).map(text);
    return {
      caption: hints[0],
      counts: hints[1],
      drawn: drawn.sort(),
      colours,
      lengths: [...lengths],
      canvasCaptions: captions(calls),
      exportName: png.name,
      exportMime: png.mime,
      exportCaptions: captions(exported),
    };
  }

  /** Changes a `<select>` with the given accessible name to `value`. */
  const choose = (name: string, value: string) => (type: unknown, p: Record<string, unknown>) => {
    if (type !== 'select' || p['aria-label'] !== name) return false;
    (p.onChange as (e: unknown) => void)({ target: { value } });
    return true;
  };

  it('draws the dotplot with the F11 parameters, and the figure and its PNG say which', () => {
    // The fixture reaches a word-match default: exact 10-base words draw neither diverged diagonal.
    const oracle = windowHits(X, Y, 11, 9);
    const words = computeDotplot(X, Y, 10, true, false).segments;
    const diagonal = oracle.filter((h) => h.endsWith(',1') && h.split(',')[0] === h.split(',')[1]).map((h) => Number(h.split(',')[0]));
    expect(diagonal.filter((i) => i < 80), 'the diverged forward diagonal').toHaveLength(80);
    expect(oracle.filter((h) => h.endsWith(',-1')).length, 'the diverged reverse-strand run').toBeGreaterThanOrEqual(40);
    expect(words.filter((s) => (s.strand === 1 && s.x === s.y) || (s.strand === -1 && s.x >= 100)), 'exact words find neither run').toEqual([]);

    const engine = vi.spyOn(bio, 'computeDotplotHits');
    try {
      const studio = studioDotplot(alignmentOf([{ name: 'Seq_X', sequence: X }, { name: 'Seq_Y', sequence: Y }]));
      expect(studio.props.sequences.map((s) => s.name)).toEqual(['Seq_X', 'Seq_Y']);
      expect(studio.props.isProtein).toBe(false);
      expect(studio.caption, 'the figure states its method and parameters').toBe(WINDOWED);
      expect(studio.methodControls, 'exact word matching stays a choice').toHaveLength(1);

      const figure = drawDotplot(studio.props);
      // Through the engine's windowed dotplot, at F11's window 11 and minimum 9 matches ...
      expect(engine).toHaveBeenCalledWith(X, Y, 11, 9);
      expect(engine.mock.calls.every(([, , w, m]) => w === 11 && m === 9)).toBe(true);
      // ... and every window drawn is one a brute-force count finds, and every one it finds is drawn.
      expect(figure.drawn).toEqual(oracle);
      expect(figure.lengths, 'each dot spans its 11-base window').toEqual([11]);
      expect(figure.caption).toBe(WINDOWED);
      // The canvas carries the label, so the PNG it exports does too, under a name that says the method.
      expect(figure.canvasCaptions).toEqual([WINDOWED]);
      expect(figure.exportCaptions).toEqual([WINDOWED]);
      expect(figure.exportName).toBe('dotplot-Seq_X-vs-Seq_Y-window11-min9.png');
      expect(figure.exportMime).toBe('image/png');
    } finally {
      engine.mockRestore();
    }
  });

  it('draws the dotplot with the F11 parameters by default, exact word matching when chosen, and labels each', () => {
    const props: DotplotProps = { isProtein: false, sequences: [{ id: 'x', name: 'Seq_X', alignedSeq: X, features: [] }, { id: 'y', name: 'Seq_Y', alignedSeq: Y, features: [] }] };
    const engine = vi.spyOn(bio, 'computeDotplotHits');
    try {
      const word = drawDotplot(props, choose('Dotplot method', 'word'));
      const label = 'Exact word match · word size 10 bp · both strands';
      expect(word.caption).toBe(label);
      expect(word.canvasCaptions).toEqual([label]);
      expect(word.exportCaptions).toEqual([label]);
      expect(word.exportName).toBe('dotplot-Seq_X-vs-Seq_Y-word10.png');
      const merged = computeDotplot(X, Y, 10, true, false).segments.map((s) => `${s.x},${s.y},${s.strand}`).sort();
      expect(word.drawn).toEqual(merged);
      expect(word.drawn, 'word matching draws no diverged diagonal').not.toContain('0,0,1');
    } finally {
      engine.mockRestore();
    }

    // With the reverse strand off, the windowed figure draws only forward windows and says so.
    const forwardOnly = drawDotplot(props, (type, p) => {
      if (type !== 'label') return false;
      const [input, span] = React.Children.toArray(p.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[];
      if (span?.props?.children !== 'Reverse-complement matches') return false;
      (input.props.onChange as (e: unknown) => void)({ target: { checked: false } });
      return true;
    });
    const label = 'Windowed match · window 11 · minimum 9 matches · forward strand only';
    expect(forwardOnly.caption).toBe(label);
    expect(forwardOnly.exportCaptions).toEqual([label]);
    expect(forwardOnly.drawn).toEqual(windowHits(X, Y, 11, 9).filter((h) => h.endsWith(',1')));
  });

  it('draws the dotplot with the F11 parameters, and says when the engine samples its windows', () => {
    // One base shifts Y against X, so every 11-base window of X but its last matches Y one diagonal
    // off the main one. While the longer sequence is under 560 nt the engine compares every window
    // pair and the figure draws that whole diagonal; at 560 nt the engine strides past it, and the
    // figure says so.
    const shifted = (n: number) => {
      const x = random(n);
      return { x, y: `A${x.slice(0, n - 1)}` };
    };
    const pair = (x: string, y: string): DotplotProps => ({ isProtein: false, sequences: [{ id: 'x', name: 'Seq_X', alignedSeq: x, features: [] }, { id: 'y', name: 'Seq_Y', alignedSeq: y, features: [] }] });
    const offByOne = (hits: string[]) =>
      hits.filter((h) => {
        const [i, j, strand] = h.split(',').map(Number);
        return strand === 1 && j === i + 1;
      });

    const short = shifted(559);
    const whole = drawDotplot(pair(short.x, short.y));
    expect(whole.drawn).toEqual(windowHits(short.x, short.y, 11, 9));
    expect(offByOne(whole.drawn), 'the whole shifted diagonal').toHaveLength(559 - 11);
    expect(whole.caption).toBe(WINDOWED);
    expect(whole.counts).not.toMatch(/sample/);

    const long = shifted(560);
    const sample = drawDotplot(pair(long.x, long.y));
    expect(offByOne(windowHits(long.x, long.y, 11, 9))).toHaveLength(560 - 11);
    expect(offByOne(sample.drawn).length, 'the engine samples past the shifted diagonal').toBeLessThan(560 - 11);
    const label = `${WINDOWED} · windows sampled`;
    expect(sample.caption).toBe(label);
    expect(sample.canvasCaptions).toEqual([label]);
    expect(sample.exportCaptions).toEqual([label]);
    expect(sample.counts).toMatch(/ · from 560 nt the engine compares a sample of window pairs, so some matches are not drawn$/);
  });

  it('draws the dotplot with the F11 parameters for nucleotides only, and a protein figure names its word match', () => {
    const engine = vi.spyOn(bio, 'computeDotplotHits');
    try {
      const studio = studioDotplot(alignmentOf([{ name: 'P1', sequence: 'MKVLAAGIVGLLLAQWERTYPLKHGFDSA' }, { name: 'P2', sequence: 'MKVLAAGIVALLLAQWERTYPLKHGFDSA' }], 'Protein'));
      expect(studio.props.isProtein).toBe(true);
      expect(studio.caption).toBe('Exact word match · word size 3 aa');
      expect(studio.methodControls, 'no windowed method is offered for protein').toEqual([]);
      const figure = drawDotplot(studio.props);
      expect(figure.exportCaptions).toEqual(['Exact word match · word size 3 aa']);
      expect(figure.exportName).toBe('dotplot-P1-vs-P2-word3.png');
      expect(engine, 'the nucleotide engine is not run on protein').not.toHaveBeenCalled();
    } finally {
      engine.mockRestore();
    }
  });

  /** A generator of its own, so each fixture below is the same whichever tests ran before it. */
  const seeded = (start: number) => {
    let s = start;
    return (n: number, alphabet = 'ACGT') =>
      Array.from({ length: n }, () => alphabet[Math.floor(((s = (s * 16807) % 2147483647) / 2147483647) * alphabet.length)]).join('');
  };
  const pairOf = (x: string, y: string): DotplotProps => ({ isProtein: false, sequences: [{ id: 'x', name: 'Seq_X', alignedSeq: x, features: [] }, { id: 'y', name: 'Seq_Y', alignedSeq: y, features: [] }] });

  /** The bases a position can match on: A, C, G and T, with U read as T. N and every other code match nothing. */
  const BASE: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', U: 'T' };
  const BASE_COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A' };
  /**
   * The positions where 11-base window i of `a` holds the same base as window j of `b` (strand 1),
   * or as the reverse complement of window j of `b` (strand -1). 0-based starts; case is ignored.
   */
  const baseMatches = (a: string, b: string, i: number, j: number, strand: number) => {
    let m = 0;
    for (let k = 0; k < 11; k++) {
      const p = BASE[a[i + k].toUpperCase()];
      const q = strand === 1 ? BASE[b[j + k].toUpperCase()] : BASE_COMPLEMENT[b[j + 10 - k].toUpperCase()];
      if (p !== undefined && p === q) m++;
    }
    return m;
  };
  /** Every pair of 11-base windows with at least 9 base matches, by brute force, as "x,y,strand". */
  const baseWindowHits = (a: string, b: string) => {
    const hits: string[] = [];
    for (let i = 0; i + 11 <= a.length; i++) {
      for (let j = 0; j + 11 <= b.length; j++) {
        if (baseMatches(a, b, i, j, 1) >= 9) hits.push(`${i},${j},1`);
        if (baseMatches(a, b, i, j, -1) >= 9) hits.push(`${i},${j},-1`);
      }
    }
    return hits.sort();
  };
  const keyOf = (h: { x: number; y: number; strand: number }) => `${h.x - 1},${h.y - 1},${h.strand}`;
  const parts = (h: string) => h.split(',').map(Number) as [number, number, number];

  it('draws the dotplot with the F11 parameters, and never counts N or another ambiguity code as a match', () => {
    const next = seeded(4242);

    // Two unrelated 200 nt sequences whose only shared feature is a 40-N run (a hard-masked repeat
    // or a scaffold gap). X's other bases are A and T and Y's are C and G, so no base of one equals
    // a base of the other or its complement: the only windows with 9 equal letters are N against N.
    const nx = `${next(70, 'AT')}${'N'.repeat(40)}${next(90, 'AT')}`;
    const ny = `${next(110, 'CG')}${'N'.repeat(40)}${next(50, 'CG')}`;
    // On a pair of plain bases the base count agrees with the letter count above.
    expect(baseWindowHits(X, Y)).toEqual(windowHits(X, Y, 11, 9));
    expect(baseWindowHits(nx, ny), 'no window pair shares 9 bases').toEqual([]);
    // The fixture reaches a letter-for-letter count: the engine scores N against N as a match on both strands.
    const rawN = bio.computeDotplotHits(nx, ny, 11, 9);
    expect(rawN.filter((h) => h.strand === 1).length, 'forward N-against-N windows from the engine').toBeGreaterThan(0);
    expect(rawN.filter((h) => h.strand === -1).length, 'reverse N-against-N windows from the engine').toBeGreaterThan(0);
    const nRun = drawDotplot(pairOf(nx, ny));
    expect(nRun.drawn, 'a shared N run draws nothing').toEqual([]);
    expect(nRun.counts).toBe('0 windows with ≥ 9 of 11 matching · 0 forward, 0 reverse');
    expect(nRun.caption).toBe(WINDOWED);
    // Exact word matching still skips every word that holds a letter other than A, C, G, T or U.
    const nWords = drawDotplot(pairOf(nx, ny), choose('Dotplot method', 'word'));
    expect(nWords.drawn).toEqual([]);
    expect(nWords.counts).toBe('0 matching segments (≥ 10 bp) · 0 forward, 0 reverse');

    // Soft ambiguity codes: the diverged pair above with an IUPAC code at every 13th base of X,
    // carried into Y (complemented on its reverse-strand run), and 30 nt of Y soft-masked in lower
    // case. A code against the same code is two equal letters, so a letter-for-letter count passes
    // windows that hold only 8 matching bases; those must not be drawn, while a window that keeps 9
    // matching bases beside a code must be, and each is coloured by its matching bases.
    const CODES = 'RYSWKMBDHVN';
    const IUPAC_COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' };
    const ax = [...X].map((c, i) => (i % 13 === 4 ? CODES[Math.floor(i / 13) % CODES.length] : c)).join('');
    const upper = `${diverge(ax.slice(0, 90), 6)}${next(10)}${[...diverge(ax.slice(100), 7)].reverse().map((c) => IUPAC_COMPLEMENT[c]).join('')}`;
    const ay = `${upper.slice(0, 30)}${upper.slice(30, 60).toLowerCase()}${upper.slice(60)}`;
    const oracle = baseWindowHits(ax, ay);
    const holdsCode = (h: string) => /[^ACGT]/.test(ax.slice(parts(h)[0], parts(h)[0] + 11));
    for (const strand of [1, -1]) {
      const onStrand = oracle.filter((h) => parts(h)[2] === strand);
      expect(onStrand.filter(holdsCode).length, `strand ${strand}: windows that keep 9 bases beside a code`).toBeGreaterThan(0);
    }
    expect(oracle.filter((h) => parts(h)[2] === 1 && parts(h)[1] >= 30 && parts(h)[1] + 11 <= 60).length, 'windows inside the soft-masked run').toBeGreaterThan(0);
    const rawSoft = bio.computeDotplotHits(ax, ay, 11, 9);
    const lettersOnly = rawSoft.filter((h) => baseMatches(ax, ay, h.x - 1, h.y - 1, h.strand) < 9);
    expect(lettersOnly.filter((h) => h.strand === 1).length, 'forward windows the engine passes on equal codes').toBeGreaterThan(0);
    expect(lettersOnly.filter((h) => h.strand === -1).length, 'reverse windows the engine passes on equal codes').toBeGreaterThan(0);

    const soft = drawDotplot(pairOf(ax, ay), (type, p) => {
      if (type !== 'select' || p.value !== 'Strand') return false;
      (p.onChange as (e: unknown) => void)({ target: { value: 'Score' } });
      return true;
    });
    expect(soft.drawn, 'exactly the windows with 9 matching bases, on both strands').toEqual(oracle);
    // Coloured by matching bases: 9 blue, 11 red, 10 between, never by the engine's count of equal letters.
    const SCORE_COLOUR: Record<number, string> = { 9: 'rgb(37,99,235)', 10: 'rgb(129,69,137)', 11: 'rgb(220,38,38)' };
    const engineScore = new Map(rawSoft.map((h) => [keyOf(h), h.score]));
    expect(soft.drawn.filter((h) => engineScore.get(h) !== baseMatches(ax, ay, ...parts(h))).length, 'drawn windows the engine over-scores').toBeGreaterThan(0);
    expect(soft.drawn.filter((h) => soft.colours[h] !== SCORE_COLOUR[baseMatches(ax, ay, ...parts(h))])).toEqual([]);

    // Soft-masking reads the same on X: the pair again with 30 nt of X lower-cased on each diverged
    // run (forward and reverse strand) draws exactly the windows a brute-force base count finds.
    const sx = `${ax.slice(0, 40)}${ax.slice(40, 70).toLowerCase()}${ax.slice(70, 110)}${ax.slice(110, 140).toLowerCase()}${ax.slice(140)}`;
    const softX = baseWindowHits(sx, ay);
    expect(softX, 'case is not a base difference').toEqual(oracle);
    const insideSoftX = (h: string) => (parts(h)[0] >= 40 && parts(h)[0] + 11 <= 70) || (parts(h)[0] >= 110 && parts(h)[0] + 11 <= 140);
    for (const strand of [1, -1]) {
      expect(softX.filter((h) => parts(h)[2] === strand && insideSoftX(h)).length, `strand ${strand}: windows inside X's soft-masked runs`).toBeGreaterThan(0);
    }
    expect(drawDotplot(pairOf(sx, ay)).drawn, 'a soft-masked X draws its windows on both strands').toEqual(softX);

    // RNA: U is a base like T, so the diverged pair written as RNA draws exactly the windows a
    // brute-force base count finds on both strands, which are the DNA pair's.
    const rx = X.replace(/T/g, 'U');
    const ry = Y.replace(/T/g, 'U');
    const rna = drawDotplot(pairOf(rx, ry));
    expect(rna.drawn.filter((h) => parts(h)[2] === 1)).toEqual(baseWindowHits(X, Y).filter((h) => parts(h)[2] === 1));
    const rnaReverse = baseWindowHits(rx, ry).filter((h) => parts(h)[2] === -1);
    expect(rnaReverse.length, 'reverse RNA windows a brute-force base count finds').toBeGreaterThan(0);
    expect(rnaReverse, 'the RNA pair has the DNA pair\'s reverse windows').toEqual(baseWindowHits(X, Y).filter((h) => parts(h)[2] === -1));
    expect(rna.drawn.filter((h) => parts(h)[2] === -1)).toEqual(rnaReverse);
  });

  it('draws the dotplot with the F11 parameters, and reads U as T on both strands', () => {
    const next = seeded(6161);
    const RNA_COMPLEMENT: Record<string, string> = { A: 'U', C: 'G', G: 'C', U: 'A' };
    const brute = (a: string, b: string) => baseWindowHits(a, b);
    const onStrand = (hits: string[], strand: number) => hits.filter((h) => parts(h)[2] === strand);
    const engineOnLetters = (a: string, b: string) => bio.computeDotplotHits(a, b, 11, 9).map(keyOf);

    // An RNA hairpin: a 40 nt stem, a 12 nt loop and the stem's reverse complement, in 20 nt of
    // flank each side. Drawn against itself, its stem pairs on the reverse strand.
    const stem = next(40, 'ACGU');
    const hairpin = `${next(20, 'ACGU')}${stem}${next(12, 'ACGU')}${[...stem].reverse().map((c) => RNA_COMPLEMENT[c]).join('')}${next(20, 'ACGU')}`;
    const oracle = brute(hairpin, hairpin);
    expect(onStrand(oracle, -1).length, 'the stem\'s reverse windows').toBeGreaterThanOrEqual(60);
    // The fixture reaches a letter-for-letter count: handed U as it is, the engine builds its
    // reverse strand with T and so finds only some of the stem's reverse windows.
    expect(onStrand(engineOnLetters(hairpin, hairpin), -1).length, 'reverse windows the engine finds on U').toBeLessThan(onStrand(oracle, -1).length);
    const drawnHairpin = drawDotplot(pairOf(hairpin, hairpin));
    expect(onStrand(drawnHairpin.drawn, -1), 'every reverse window of the stem').toEqual(onStrand(oracle, -1));
    expect(drawnHairpin.drawn, 'exactly the brute-force windows on both strands').toEqual(oracle);
    // Its DNA twin draws the same windows.
    expect(drawDotplot(pairOf(hairpin.replace(/U/g, 'T'), hairpin.replace(/U/g, 'T'))).drawn).toEqual(oracle);

    // An RNA X against a DNA Y (and a DNA X against an RNA Y) is the DNA pair: U against T is a
    // match on the forward strand, and U pairs with A on the reverse. The RNA X is soft-masked over
    // 30 nt of its forward run, so lower-case u is read as U and then as T.
    const dnaPair = baseWindowHits(X, Y);
    const rx = X.replace(/T/g, 'U');
    const softRx = `${rx.slice(0, 20)}${rx.slice(20, 50).toLowerCase()}${rx.slice(50)}`;
    const ry = Y.replace(/T/g, 'U');
    for (const [x, y, name] of [[softRx, Y, 'RNA X against DNA Y'], [X, ry, 'DNA X against RNA Y']] as const) {
      const pairOracle = brute(x, y);
      expect(pairOracle, `${name}: the DNA pair's windows`).toEqual(dnaPair);
      expect(onStrand(engineOnLetters(x, y), 1).length, `${name}: forward windows the engine finds on U against T`).toBeLessThan(onStrand(pairOracle, 1).length);
      const drawn = drawDotplot(pairOf(x, y)).drawn;
      for (const strand of [1, -1]) {
        expect(onStrand(pairOracle, strand).length, `${name}: strand ${strand} windows`).toBeGreaterThan(0);
        expect(onStrand(drawn, strand), `${name}: strand ${strand}`).toEqual(onStrand(pairOracle, strand));
      }
    }
  });

  it('draws the dotplot with the F11 parameters, and never lets an N gap spend the engine\'s hit cap', () => {
    const next = seeded(7373);
    const n = (v: number) => v.toLocaleString();
    // A scaffold over 4,000 nt with a run of N (a scaffold gap or a hard-masked region), drawn
    // against itself: 5,000 bases around a 1,000-N gap at 600, and around a 300-N gap at 1,000.
    // Above 4,000 nt the engine seeds its scan along X and stops once it holds 4,000 hits, so a hit
    // spent on N would cut the scan short of the bases past the gap.
    for (const { length, gapAt, gap } of [{ length: 6000, gapAt: 600, gap: 1000 }, { length: 5300, gapAt: 1000, gap: 300 }]) {
      const scaffold = `${next(gapAt)}${'N'.repeat(gap)}${next(length - gapAt - gap)}`;
      const bases = [...scaffold].flatMap((c, i) => (c === 'N' ? [] : [i]));
      expect(bases, `${n(length)} nt: the non-N bases`).toHaveLength(5000);

      // The fixture reaches a letter-for-letter scan: handed N as it is, the engine counts N against
      // N, spends most of its cap on windows that hold N, and stops before the middle of X.
      const onLetters = bio.computeDotplotHits(scaffold, scaffold, 11, 9);
      expect(onLetters.length, `${n(length)} nt: the engine reaches its cap on N`).toBeGreaterThanOrEqual(4000);
      expect(onLetters.filter((h) => baseMatches(scaffold, scaffold, h.x - 1, h.y - 1, h.strand) < 9).length).toBeGreaterThan(onLetters.length / 2);
      expect(Math.max(...onLetters.map((h) => h.x))).toBeLessThan(length / 2);

      // The studio's figure, and every call it made to the engine with what the engine returned.
      const engine = vi.spyOn(bio, 'computeDotplotHits');
      const { figure, handed } = (() => {
        try {
          const drawn = drawDotplot(pairOf(scaffold, scaffold));
          const results = engine.mock.results.map((r) => r.value as { x: number; y: number; strand: number }[]);
          return { figure: drawn, handed: engine.mock.calls.map(([x, y], i) => ({ x, y, hits: results[i] })) };
        } finally {
          engine.mockRestore();
        }
      })();
      expect(handed.length, 'the studio runs the engine').toBeGreaterThan(0);
      for (const call of handed) {
        // One letter for one, so every hit keeps the coordinates of the letters as given ...
        expect([call.x.length, call.y.length], `${n(length)} nt: the letters handed to the engine`).toEqual([length, length]);
        // ... and N never spends the cap: every hit the engine returns holds 9 matching bases.
        expect(call.hits.length, `${n(length)} nt: under the hit cap`).toBeLessThan(4000);
        expect(call.hits.filter((h) => baseMatches(scaffold, scaffold, h.x - 1, h.y - 1, h.strand) < 9), `${n(length)} nt: hits that hold N`).toEqual([]);
      }

      // The scan reaches the end of X, so the figure says its windows were sampled, never that it stopped.
      expect(figure.caption).toBe(`${WINDOWED} · windows sampled`);
      expect(figure.canvasCaptions).toEqual([`${WINDOWED} · windows sampled`]);
      expect(figure.exportCaptions).toEqual([`${WINDOWED} · windows sampled`]);
      expect(figure.counts).toMatch(/ · from 560 nt the engine compares a sample of window pairs, so some matches are not drawn$/);
      expect(figure.counts).not.toMatch(/cap|stopped/);
      // The main diagonal is drawn over every base on both sides of the gap. The engine strides 2
      // along X here and its last window starts at length - 12 (length - 11 is odd), so the last base
      // is the one base no window reaches; every other of the 5,000 lies on a drawn diagonal window.
      const onDiagonal = new Set(
        figure.drawn
          .map(parts)
          .filter(([x, y, strand]) => strand === 1 && x === y)
          .flatMap(([x]) => Array.from({ length: 11 }, (_, k) => x + k))
      );
      expect(bases.filter((i) => !onDiagonal.has(i)), `${n(length)} nt: bases off the drawn diagonal`).toEqual([length - 1]);
    }
  });

  it('draws the dotplot with the F11 parameters, and says where the engine stopped at its hit cap', () => {
    const next = seeded(5150);
    const unit = next(20);
    const tandem = (n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const n = (v: number) => v.toLocaleString();

    // While neither sequence is longer than 4,000 nt the engine strides over the whole plot and keeps
    // every hit: X, a 3,600 nt tandem repeat, against a 4,000 nt one returns more hits than the cap,
    // from all along X, and nothing was cut, so the figure says only that its windows were sampled.
    const x = tandem(3600);
    const strided = bio.computeDotplotHits(x, tandem(4000), 11, 9);
    expect(strided.length, 'more hits than the cap').toBeGreaterThanOrEqual(4000);
    expect(Math.max(...strided.map((h) => h.x)), 'hits to the end of X').toBeGreaterThan(3600 - 30);
    const whole = drawDotplot(pairOf(x, tandem(4000)));
    expect(whole.caption).toBe(`${WINDOWED} · windows sampled`);
    expect(whole.counts).toMatch(/ · from 560 nt the engine compares a sample of window pairs, so some matches are not drawn$/);

    // From 4,001 nt the engine seeds its scan along X and stops once it holds 4,000 hits, so the
    // rest of the plot is never compared, though X matches Y there base for base.
    const capped = bio.computeDotplotHits(x, tandem(4001), 11, 9);
    expect(capped.length, 'the engine reached its hit cap').toBeGreaterThanOrEqual(4000);
    const stop = Math.max(...capped.map((h) => h.x));
    expect(stop, 'the scan stopped well short of the end of X').toBeLessThan(1000);
    expect(baseMatches(x, tandem(4001), 3600 - 11, 3600 - 11, 1), 'an uncompared window that matches').toBe(11);
    const cut = drawDotplot(pairOf(x, tandem(4001)));
    expect(cut.drawn.every((h) => parts(h)[0] < stop), 'nothing is drawn past the stop').toBe(true);
    const stopped = `scan stopped at the ${n(4000)}-hit cap at position ${n(stop)} of ${n(3600)} along X`;
    expect(cut.caption).toBe(`${WINDOWED} · ${stopped}`);
    expect(cut.canvasCaptions).toEqual([`${WINDOWED} · ${stopped}`]);
    expect(cut.exportCaptions).toEqual([`${WINDOWED} · ${stopped}`]);
    const tail = ` · ${stopped}; the rest of the plot was not compared, and the windows before it were sampled`;
    expect(cut.counts.slice(-tail.length)).toBe(tail);

    // Exactly 4,000 hits is the cap too. Y, 170 nt of the repeat, holds each 6-base seed of the unit
    // 8 times, so every X window seeds 8 hits and the scan stops after its 500th window.
    const short = tandem(170);
    const exact = bio.computeDotplotHits(tandem(4001), short, 11, 9);
    expect(exact.length, 'exactly the cap').toBe(4000);
    const atCap = drawDotplot(pairOf(tandem(4001), short));
    expect(atCap.caption).toBe(`${WINDOWED} · scan stopped at the ${n(4000)}-hit cap at position ${n(500)} of ${n(4001)} along X`);

    // Above 4,000 nt but under the cap, the seeded scan reaches the end of X: a sample, not a stop.
    const longer = next(4800);
    const below = bio.computeDotplotHits(longer, longer, 11, 9);
    expect(below.length, 'under the hit cap').toBeLessThan(4000);
    expect(Math.max(...below.map((h) => h.x)), 'hits to the end of X').toBeGreaterThan(4800 - 30);
    const sample = drawDotplot(pairOf(longer, longer));
    expect(sample.caption).toBe(`${WINDOWED} · windows sampled`);
    expect(sample.counts).toMatch(/ · from 560 nt the engine compares a sample of window pairs, so some matches are not drawn$/);
  });
});

// ─── AC5 ───

describe('AC5: contigs keep their traces and read QC as views', () => {
  const modeNames = (root: El) => findAll(modeStripOf(root), (e) => e.attrs.role === 'tab').map(tabName);
  const MODES = ['Multiple Sequence Alignment (MSA)', 'Pairwise Alignment', 'Dotplot'];

  it('offers traces and read QC as views for contigs', () => {
    expect(modeNames(parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(coi)} />)))).toEqual([...MODES, 'Chromatogram', 'QC Report']);
    expect(modeNames(parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(coxii)} />)))).toEqual(MODES);
    // A read list with no traces offers read QC, and no Chromatogram.
    expect(modeNames(parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(ionTorrent)} />)))).toEqual([...MODES, 'QC Report']);

    // Chromatogram: the contig's real traces, in place of the grid, under the same single tab level.
    const traces = renderStudio(studioProps(coi), ['Chromatogram']);
    expect(findAll(modeStripOf(traces), (e) => e.attrs['aria-selected'] === 'true').map(tabName)).toEqual(['Chromatogram']);
    expect(findAll(traces, hasClass('mbc-trace')), 'the trace viewer draws the reads\' traces').toHaveLength(1);
    expect(findAll(traces, hasClass('mbc-aln-canvas-pane')), 'the grid gives way to the traces').toEqual([]);
    const order = [...walk(traces)];
    const viewer = order.findIndex(hasClass('mbc-trace'));
    expect(order.slice(0, viewer).filter((e) => e.attrs.role === 'tablist').map((l) => l.attrs['aria-label'])).toEqual(['Sequence Alignment Modes']);

    // QC Report: computed from the contig's reads.
    const qc = renderStudio(studioProps(coi), ['QC Report']);
    expect(findAll(modeStripOf(qc), (e) => e.attrs['aria-selected'] === 'true').map(tabName)).toEqual(['QC Report']);
    expect(findAll(qc, hasClass('mbc-qc')), 'the read QC report is drawn').toHaveLength(1);
    expect(findAll(qc, hasClass('mbc-aln-canvas-pane'))).toEqual([]);

    // MSA brings the grid back.
    const back = renderStudio(studioProps(coi), ['Chromatogram', 'Multiple Sequence Alignment (MSA)']);
    expect(findAll(back, hasClass('mbc-aln-canvas-pane'))).toHaveLength(1);
    expect(findAll(back, hasClass('mbc-trace'))).toEqual([]);

    // Outside any Contig Assembly folder: a single traced read still offers its Chromatogram, and a
    // read list still offers its QC Report. (The folder alone must not be what offers them.)
    const singleRead = { ...byId('doc-contig-coi-fwd'), folder: 'Sequencing Reads' } as SequenceDocument;
    expect(singleRead.documentKind, 'the read is a trace document').toBe('trace');
    expect(modeNames(parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(singleRead)} />)))).toEqual([...MODES, 'Chromatogram']);
    const singleTrace = renderStudio(studioProps(singleRead), ['Chromatogram']);
    expect(findAll(singleTrace, hasClass('mbc-trace')), 'the single read draws its trace').toHaveLength(1);
    const looseReadList = { ...ionTorrent, folder: 'Local' } as SequenceDocument;
    expect(modeNames(parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(looseReadList)} />)))).toEqual([...MODES, 'QC Report']);
    const looseQc = renderStudio(studioProps(looseReadList), ['QC Report']);
    expect(findAll(looseQc, hasClass('mbc-qc')), 'the read list draws its QC report').toHaveLength(1);
  });
});

// ─── AC6 ───

/** localStorage for the App (its autosave lives there). */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

/**
 * The App restored from an autosave holding `documents`, with `activeDocId` open on `viewerTab`.
 * The App loads its studios as lazy chunks, so it is rendered until no loading line is left.
 * `onElement` sees every element the App and its studios create in each render.
 */
async function appRestored(documents: SequenceDocument[], activeDocId: string, viewerTab: import('../core/mbcSessionFormat').MbcViewerTabId, onElement?: ElementProbe): Promise<El> {
  const g = globalThis as unknown as { localStorage?: MemoryStorage };
  const before = g.localStorage;
  g.localStorage = new MemoryStorage();
  try {
    expect(saveWorkbenchToLocalAutosave({
      sessionName: 'Restored_Session',
      documents,
      workspace: {
        activeDocId, selectedFolder: 'All Project Files', navHistory: [activeDocId], navIndex: 0,
        viewerTab, mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
        darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
        displaySettings: {
          showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    }), 'the autosave is written').toBe(true);
    for (let attempt = 0; attempt < 200; attempt++) {
      let restored = false;
      let passes = 0;
      probe.onMenus = (dispatch) => {
        if (++passes > 25) throw new Error('the App kept re-rendering');
        if (!restored) {
          restored = true;
          dispatch('file:restore-autosave');
        }
      };
      probe.onElement = onElement ?? null;
      let html: string;
      try {
        html = renderToStaticMarkup(<App />);
      } finally {
        probe.onElement = null;
        probe.onMenus = null;
      }
      expect(restored, 'the autosave was restored').toBe(true);
      if (!/role="status">Loading [^<]*…</.test(html)) return parse(html);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the studio chunk never loaded');
  } finally {
    if (before === undefined) delete g.localStorage;
    else g.localStorage = before;
  }
}
const appOnFlatfile = (doc: SequenceDocument) => appRestored([doc], doc.id, 'text-view');

describe('AC6: the Flatfile tab shows the alignment text', () => {
  const formatSelect = (root: El) => {
    const selects = findAll(root, (e) => e.tag === 'select' && within(e, root) && findAll(e, (o) => o.tag === 'option' && o.attrs.value === 'NEXUS').length > 0);
    expect(selects, 'the alignment text offers its formats').toHaveLength(1);
    return Object.fromEntries(findAll(selects[0], (o) => o.tag === 'option').map((o) => [o.attrs.value, { label: text(o), disabled: 'disabled' in o.attrs }]));
  };

  it('shows the alignment text stream in the Flatfile tab', async () => {
    const TextStream = studioModule.AlignmentTextStream;
    expect(TextStream, 'the alignment text stream is a component of its own').toBeTypeOf('function');

    // An unaligned list: the original sequences as unpadded FASTA, and no alignment layouts.
    const list = parse(renderToStaticMarkup(<TextStream doc={unalignedList} />));
    const listText = shownText(list);
    expect(listText).toContain('>MemberTwo\nTTGCA');
    expect(listText).not.toContain('TTGCA-');
    const listFormats = formatSelect(list);
    expect(listFormats.Clustal).toEqual({ label: 'Clustal (align first)', disabled: true });

    // An aligned sample: the alignment formats are offered.
    const aligned = parse(renderToStaticMarkup(<TextStream doc={coxii} />));
    const formats = formatSelect(aligned);
    for (const f of ['Clustal', 'FASTA', 'PHYLIP', 'NEXUS']) expect(formats[f], f).toEqual({ label: f, disabled: false });
    // Its default layout is the alignment itself: the members, block by block, under the consensus.
    const alignedText = shownText(aligned);
    for (const m of coxii.alignmentMeta!.sequences!.slice(0, 3)) expect(alignedText).toContain(m.name);
    expect(alignedText).toContain('Consensus');

    // The App renders it on the Flatfile tab of an alignment document, in place of the GenBank record.
    // Its Format select is a setting of App's inspector there (US-01M6TAZ7, D0082), which the server
    // renderer does not draw, so the pane holds the stream and no Format select.
    const app = await appOnFlatfile(coxii);
    const pane = findAll(app, hasClass('mbc-text-view-pane'));
    expect(pane, 'the App is on the Flatfile tab').toHaveLength(1);
    expect(findAll(pane[0], (e) => e.tag === 'select' && findAll(e, (o) => o.tag === 'option' && o.attrs.value === 'NEXUS').length > 0), 'no Format select in the pane').toEqual([]);
    expect(findAll(pane[0], hasClass('mbc-aln-text-stream')), 'the alignment text stream').toHaveLength(1);
    expect(shownText(pane[0])).toContain(coxii.alignmentMeta!.sequences![0].name);
    expect(shownText(pane[0])).not.toContain('Flatfile Record Format:');

    // A sequence that is not an alignment keeps its flat-file record.
    const plain = await appOnFlatfile(byId('doc-puc19'));
    const plainPane = findAll(plain, hasClass('mbc-text-view-pane'));
    expect(plainPane).toHaveLength(1);
    expect(shownText(plainPane[0])).toContain('Flatfile Record Format:');
    expect(findAll(plainPane[0], (e) => e.tag === 'option' && e.attrs.value === 'NEXUS')).toEqual([]);
  });

  // The alignment text's consensus line is the grid's Consensus row: the same residues and the same
  // name, under whatever threshold and gap vote the grid's Display inspector last set for the
  // document. The wrong implementations this fails: a consensus of its own (majority, gaps ignored,
  // whatever the grid shows); member row 1 printed as the consensus (MC4); gaps counted in the vote
  // (MC5); a contig's quality-trimmed read ends voting (MC8); the line named "Consensus" alone.
  const member = (id: string, name: string, sequence: string, features: SequenceDocument['features'] = []) => ({ id, name, sequence, features });
  // Five columns, repeated past one 60-column block. Column by column: all A; C C C G; G G T T (a
  // tie); a gap in three rows and A in the fourth; all T. Row 1 differs from every consensus below.
  const repeat = (s: string) => s.repeat(13);
  const voting = {
    ...EMPTY_WORKSPACE_DOCUMENT, id: 'aln-consensus-vote', name: 'Consensus vote', sequence: repeat('ACGAT'), folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
    alignmentMeta: {
      isAligned: true,
      sequences: [
        member('v1', 'Vote_One', repeat('ACG-T')),
        member('v2', 'Vote_Two', repeat('ACG-T')),
        member('v3', 'Vote_Three', repeat('ACT-T')),
        member('v4', 'Vote_Four', repeat('AGTAT')),
      ],
    },
  } as unknown as SequenceDocument;
  // The consensus each setting calls, worked by hand from the columns above.
  const VOTES: { threshold: string; ignoreGaps: boolean; label: string; consensus: string }[] = [
    { threshold: 'Majority', ignoreGaps: true, label: 'majority', consensus: repeat('ACKAT') },
    { threshold: 'Majority', ignoreGaps: false, label: 'majority', consensus: repeat('ACK-T') },
    { threshold: '0%', ignoreGaps: true, label: '0%', consensus: repeat('ACGAT') },
    { threshold: '75%', ignoreGaps: false, label: '75%', consensus: repeat('ACK-T') },
    { threshold: '100%', ignoreGaps: true, label: '100%', consensus: repeat('ASKAT') },
  ];
  // Two reads whose first three bases are trimmed (G), and one untrimmed read (C): in a contig the
  // trimmed ends do not vote, so the consensus starts CCC; in a plain alignment they do (GGG).
  const trimmed = [{ id: 't', name: 'Trimmed', type: 'misc_feature', start: 1, end: 3, strand: 1, color: '#94a3b8' }] as SequenceDocument['features'];
  const reads = [
    member('r1', 'Read_One', 'GGGTTTTTTT', trimmed),
    member('r2', 'Read_Two', 'GGGTTTTTTT', trimmed),
    member('r3', 'Read_Three', 'CCCTTTTTTT'),
  ];
  const contig = {
    ...EMPTY_WORKSPACE_DOCUMENT, id: 'contig-trimmed-ends', name: 'Trimmed contig', sequence: 'CCCTTTTTTT', folder: 'Contig Assembly', moleculeType: 'DNA', documentKind: 'contig',
    alignmentMeta: { isAligned: true, sequences: reads },
  } as unknown as SequenceDocument;
  const sameReadsAligned = { ...contig, id: 'aln-trimmed-ends', name: 'Same reads, aligned', folder: 'Alignments', documentKind: 'alignment' } as SequenceDocument;

  /** Sets the grid's consensus threshold and gap vote through its own Display inspector controls. */
  function setGridConsensus(doc: SequenceDocument, threshold: string, ignoreGaps: boolean) {
    let thresholdSet = false;
    let gapsSet = false;
    probe.onElement = (type, p) => {
      const kidsOf = (node: unknown) => React.Children.toArray(node as React.ReactNode).filter(React.isValidElement) as React.ReactElement<Record<string, unknown>>[];
      if (type === 'select' && kidsOf(p.children).some((o) => o.props.value === '100%') && kidsOf(p.children).some((o) => o.props.value === 'Majority')) {
        thresholdSet = true;
        if (p.value !== threshold) (p.onChange as (e: unknown) => void)({ target: { value: threshold } });
      }
      if (type === 'label') {
        const kids = kidsOf(p.children);
        const box = kids.find((k) => k.type === 'input' && k.props.type === 'checkbox');
        if (box && kids.some((k) => k.type === 'span' && k.props.children === 'Ignore Gaps')) {
          gapsSet = true;
          if (box.props.checked !== ignoreGaps) (box.props.onChange as (e: unknown) => void)({ target: { checked: ignoreGaps } });
        }
      }
    };
    try {
      renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialInspectorTab: 'display' })} />);
    } finally {
      probe.onElement = null;
    }
    expect([thresholdSet, gapsSet], 'the Display inspector offers the threshold and the gap vote').toEqual([true, true]);
  }

  /** The grid's Consensus row: the consensus it is handed for the whole alignment, and its name. */
  function gridConsensusOf(doc: SequenceDocument) {
    let consensus: string | null = null;
    probe.onElement = (type, p) => {
      if (type === AlignmentCanvas) consensus = String(p.consensus);
    };
    let root: El;
    try {
      root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc)} />));
    } finally {
      probe.onElement = null;
    }
    const names = findAll(root, (e) => e.classes.has('mbc-aln-name') && e.classes.has('consensus'));
    expect(names.length, `${doc.name}: the grid draws its Consensus row`).toBeGreaterThan(0);
    expect(consensus, `${doc.name}: the grid is handed its consensus`).not.toBeNull();
    return { consensus: consensus as unknown as string, label: kids(names[0]).map((k) => text(k).trim()) };
  }

  /** The alignment text's consensus lines, joined across its blocks, and the name it gives them. */
  function textConsensusOf(root: El) {
    const lines = findAll(root, hasClass('mbc-aln-text-cons'));
    expect(lines.length, 'the alignment text draws a consensus line').toBeGreaterThan(0);
    const labels = lines.map((l) => kids(findAll(l, hasClass('mbc-aln-text-name'))[0]).map((k) => text(k).trim()));
    for (const l of labels) expect(l, 'every block names its consensus line alike').toEqual(labels[0]);
    return { consensus: lines.map((l) => text(findAll(l, hasClass('mbc-aln-text-seq'))[0])).join(''), label: labels[0] };
  }
  const flatfileConsensusOf = (doc: SequenceDocument) => textConsensusOf(parse(renderToStaticMarkup(<studioModule.AlignmentTextStream doc={doc} />)));

  it('shows the alignment text stream in the Flatfile tab, with the grid\'s own consensus', async () => {
    const used = [voting, contig, sameReadsAligned, coxii];
    try {
      // Every setting: the text's consensus line is the grid's row, residue for residue, name for name.
      for (const vote of VOTES) {
        setGridConsensus(voting, vote.threshold, vote.ignoreGaps);
        const grid = gridConsensusOf(voting);
        const flat = flatfileConsensusOf(voting);
        const setting = `${vote.threshold}, gaps ${vote.ignoreGaps ? 'ignored' : 'counted'}`;
        expect(grid.consensus, `${setting}: the grid's consensus`).toBe(vote.consensus);
        expect(grid.label, `${setting}: the grid's row name`).toEqual(['Consensus', vote.label]);
        expect(flat.consensus, `${setting}: the text's consensus line`).toBe(grid.consensus);
        expect(flat.label, `${setting}: the text names its line as the grid does`).toEqual(grid.label);
        expect(flat.consensus, `${setting}: not member row 1`).not.toBe(voting.alignmentMeta!.sequences![0].sequence);
      }

      // A contig's trimmed read ends do not vote, in the grid or in the text; a plain alignment's do.
      for (const [doc, expected] of [[contig, 'CCCTTTTTTT'], [sameReadsAligned, 'GGGTTTTTTT']] as const) {
        const grid = gridConsensusOf(doc);
        expect(grid.consensus, `${doc.name}: the grid's consensus`).toBe(expected);
        expect(flatfileConsensusOf(doc).consensus, `${doc.name}: the text's consensus line`).toBe(expected);
      }

      // In the App: a threshold and gap vote set in the grid are the ones the Flatfile tab prints.
      setGridConsensus(coxii, '0%', false);
      const coxiiGrid = gridConsensusOf(coxii);
      expect(coxiiGrid.label).toEqual(['Consensus', '0%']);
      const app = await appOnFlatfile(coxii);
      const pane = findAll(app, hasClass('mbc-text-view-pane'));
      expect(pane, 'the App is on the Flatfile tab').toHaveLength(1);
      const appText = textConsensusOf(pane[0]);
      expect(appText.label).toEqual(coxiiGrid.label);
      expect(appText.consensus).toBe(coxiiGrid.consensus);
      setGridConsensus(coxii, 'Majority', true);
      const majority = gridConsensusOf(coxii).consensus;
      expect(majority, 'the two settings call different consensuses on COXII').not.toBe(coxiiGrid.consensus);
      expect(textConsensusOf(findAll(await appOnFlatfile(coxii), hasClass('mbc-text-view-pane'))[0]).consensus).toBe(majority);
    } finally {
      for (const doc of used) studioModule.setAlignmentConsensusSettings(doc.id, studioModule.DEFAULT_ALIGNMENT_CONSENSUS);
    }
  });
});
