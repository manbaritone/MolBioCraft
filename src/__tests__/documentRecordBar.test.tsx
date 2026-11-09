// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q10G: once a document is open, the document table folds into a one-line record bar that
 * names the open record (name, length, topology, status), with one labelled toggle that agrees with
 * View › Document Table.
 *
 * Every check renders the real component or drives the real App. The App is rendered on the server,
 * where a state update made while the App itself is rendering re-renders it with that update: the
 * probes act from inside the App's render (the native-menu dispatcher it has just assigned, the web
 * menu tables it hands the shortcut collector, and the elements it creates), so a menu command or
 * a toggle chosen there is followed by the render that shows what it did. See structureToolsWiring.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';
import type { SequenceDocument } from '../types/bio';

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
const { DocumentRecordBar, DocumentTableToggle, nextDocTableCollapsed } = await import('../components/DocumentRecordBar');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { computeDocumentTableMetrics, getDocumentColumnDisplayValue, extractAnnotatedFeaturesToDocuments } = await import('../core/workbenchBatchOperations');
const { CLONING_ACTION_VECTOR_PRESETS, buildCloningActionVectorDocument } = await import('../data/cloningActionVectors');
const { extractRegionWithAnnotationsRust } = await import('../lib/rustBioEngine');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
type DocTableEvent = import('../components/DocumentRecordBar').DocTableEvent;

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
const byClass = (root: El, cls: string) => findAll(root, (e) => e.classes.has(cls));
const ancestors = (e: El) => { const out: El[] = []; for (let p = e.parent; p; p = p.parent) out.push(p); return out; };
/** The one element of a class. */
function one(root: El, cls: string): El {
  const found = byClass(root, cls);
  expect(found.map((e) => e.tag), `exactly one .${cls}`).toHaveLength(1);
  return found[0];
}
const buttonsNamed = (root: El, name: string) => findAll(root, (e) => e.tag === 'button' && e.attrs['aria-label'] === name);

// ─── The table's own values ───

const sample = (id: string): SequenceDocument => {
  const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
  if (!doc) throw new Error(`the sample library no longer holds ${id}`);
  return doc;
};
/** What the document table's name, length, topology and status cells say for `doc`. */
function tableValues(doc: SequenceDocument) {
  const metrics = computeDocumentTableMetrics(doc);
  const cell = (col: string) => getDocumentColumnDisplayValue(doc, metrics, col);
  return { name: cell('name'), length: cell('length'), topology: cell('topology'), status: cell('status'), metrics };
}

const bar = (doc: SequenceDocument) => parse(renderToStaticMarkup(<DocumentRecordBar doc={doc} onShowTable={() => {}} />));
const summaryOf = (root: El) => textOf(one(root, 'mbc-record-bar-summary'));

/** A text document, as File › New › Text Document makes one. */
const textDoc: SequenceDocument = {
  id: 'doc-text-notes', name: 'Bench notes', accession: '', description: '', moleculeType: 'DNA', topology: 'linear',
  sequence: '', features: [], primers: [], history: [], createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
  folder: 'Cloning', docMetadata: { 'Document Type': 'Text Document', Notes: 'Ligation set up at 16 °C.' },
};

// ─── App renders ───

type Step = (menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void;
/**
 * A user action on an element the App creates in its own render (a sidebar entry, a table row, a
 * search hit): the first element `pick` accepts, in a render after the previous step.
 */
interface Act { what: string; pick: (type: unknown, props: Record<string, unknown>) => boolean; act: (props: Record<string, unknown>) => void }
/** Renders the App, running each step (a menu step or an action) inside the render the step before caused. */
function driveApp(steps: readonly (Step | Act)[], onElement?: ElementProbe) {
  let ran = 0;
  let passes = 0;
  let lastStepPass = 0;
  let lastMenus: readonly (readonly unknown[])[] = [];
  probe.onMenus = (menus, dispatch) => {
    lastMenus = menus;
    if (++passes > 25) throw new Error('the App kept re-rendering');
    const step = steps[ran];
    if (typeof step === 'function' && passes > lastStepPass) { ran++; lastStepPass = passes; step(menus, dispatch); }
  };
  probe.onElement = (type, props) => {
    onElement?.(type, props);
    const step = steps[ran];
    if (step && typeof step !== 'function' && passes > lastStepPass && step.pick(type, props)) { ran++; lastStepPass = passes; step.act(props); }
  };
  const html = renderToStaticMarkup(<App />);
  probe.onElement = null;
  const pending = steps[ran];
  expect(ran, `every step ran${pending ? ` (stopped at ${typeof pending === 'function' ? 'a menu step' : pending.what})` : ''}`).toBe(steps.length);
  return { html, root: parse(html), menus: lastMenus };
}
const run = (id: string): Step => (_m, d) => d(id);
/** The text an element's own children spell out. */
const childText = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childText).join('');
  if (React.isValidElement(node)) return childText((node.props as { children?: unknown }).children);
  return '';
};
const hasClass = (props: Record<string, unknown>, cls: string) => String(props.className ?? '').split(/\s+/).includes(cls);
/** Presses the first button `pick` accepts. */
const press = (what: string, pick: (props: Record<string, unknown>) => boolean): Act => ({
  what, pick: (type, props) => type === 'button' && pick(props), act: (props) => (props.onClick as () => void)(),
});
/** A sidebar entry, by its label. */
const sidebarEntry = (label: string) => press(`the sidebar's ${label}`, (p) => hasClass(p, 'source-folder-row') && childText(p.children).includes(label));

/** A node of the web menu tables, by id. */
function menuNode(menus: readonly (readonly unknown[])[], id: string): MenuNode {
  const visit = (nodes: readonly MenuNode[]): MenuNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.kind === 'submenu') { const hit = visit(n.children); if (hit) return hit; }
    }
    return null;
  };
  for (const tree of menus) { const hit = visit(tree as MenuNode[]); if (hit) return hit; }
  throw new Error(`the web menus hold no ${id}`);
}
const docTableItem = (menus: readonly (readonly unknown[])[]) => {
  const node = menuNode(menus, 'view-tog-doctable');
  if (node.kind !== 'checkbox') throw new Error('View › Document Table is not a checkbox item');
  return node;
};

/** The centre stack's document-table pane. */
const pane = (root: El) => one(root, 'mbc-doc-table-pane');
const fullTableShown = (root: El) => byClass(pane(root), 'mbc-document-table').length === 1 && findAll(pane(root), (e) => e.tag === 'thead').length === 1;

/** The sample library's first document, eGFP CDS selected (5179..5898), extracted as the App does. */
const extracted = () => extractRegionWithAnnotationsRust(SAMPLE_LIBRARY[0], 5179, 5898, '2026-11-06T00:00:00Z');

// ─── The criteria ───

describe('the record bar (US-01M6Q10G)', () => {
  it('shows name, length, topology and status from the table values', () => {
    // A circular genome whose table length comes from its "Sequence Length" metadata: the
    // sequence is not held, so a bar that counted residues or read the metrics' own length label
    // would say "0 bp". With no bases no check ran, so its status says so (BG-01M6S1B3): the one
    // "alert" it used to count was the audit's own all-clear line.
    const ecoli = sample('doc-genome-ecoli-k12-mg1655');
    const e = tableValues(ecoli);
    expect([ecoli.moleculeType, ecoli.topology, ecoli.sequence, e.metrics.alertsCount], 'the fixture is circular DNA with no bases held').toEqual(['DNA', 'circular', '', 0]);
    expect(e.length, 'its table length is not the residue count').not.toBe(e.metrics.lengthLabel);
    expect(summaryOf(bar(ecoli))).toBe(`${e.name} · ${e.length} · Circular · ${e.status}`);
    expect(e.status).toBe('Not checked');
    expect(e.topology).toBe('Circular');

    // A plasmid with its sequence (thousands separator, unit) and several alerts; and a linear DNA.
    for (const [id, topology] of [['doc-puc19', 'Circular'], ['doc-insert-mcherry', 'Linear']] as const) {
      const doc = sample(id);
      const v = tableValues(doc);
      expect(v.topology, `${id} table topology`).toBe(topology);
      expect(v.metrics.alertsCount, `${id} has alerts`).toBeGreaterThan(1);
      expect(summaryOf(bar(doc)), id).toBe(`${v.name} · ${v.length} · ${topology} · ${v.status}`);
    }
    expect(tableValues(sample('doc-puc19')).length).toBe('2,686 bp');

    // The status icon carries the verdict: a warning for alerts, a pass for a record every check
    // ran on and found nothing (a primer), and neither for a record whose checks did not run.
    const status = (doc: SequenceDocument) => one(bar(doc), 'mbc-record-bar-status');
    const puc19 = sample('doc-puc19');
    expect(byClass(status(puc19), 'is-warn'), 'warning icon for an alert').toHaveLength(1);
    const primer = sample('doc-primer-cmv-fwd');
    const pr = tableValues(primer);
    expect([pr.metrics.alertsCount, pr.status], 'a primer every check passed').toEqual([0, 'OK']);
    expect(byClass(status(primer), 'is-ok'), 'pass icon for OK').toHaveLength(1);
    expect(textOf(one(status(primer), 'mbc-record-bar-status-text'))).toBe(pr.status);
    expect(byClass(status(ecoli), 'is-ok'), 'no pass icon where no check ran').toEqual([]);
    expect(byClass(status(ecoli), 'is-warn'), 'nor a warning').toEqual([]);
    expect(status(puc19).attrs.title, 'the alerts are named on hover').toBe(tableValues(puc19).metrics.alertsSummary);
    expect(status(ecoli).attrs.title, 'why no check ran, on hover').toBe(e.metrics.alertsSummary);

    // A long name is the whole name in the text (the stylesheet truncates it) and in the title.
    const long = { ...sample('doc-puc19'), id: 'doc-long-name', name: `pUC19 ${'with a very long construct description '.repeat(6)}end` };
    const name = one(bar(long), 'mbc-record-bar-name');
    expect(textOf(name)).toBe(long.name);
    expect(name.attrs.title).toBe(long.name);
  });

  it('leaves topology off protein records', () => {
    const protein = sample('doc-prot-egfp-1ema');
    const p = tableValues(protein);
    expect(p.topology, 'the table itself says Linear for a protein').toBe('Linear');
    const root = bar(protein);
    // The record checks are DNA checks, so none ran on a protein (BG-01M6S1B3).
    expect(summaryOf(root)).toBe(`${p.name} · ${p.length} · ${p.status}`);
    expect(p.status).toBe('Not checked');
    expect(p.length).toBe('239 aa');
    expect(textOf(root)).not.toMatch(/Linear|Circular/);
    expect(byClass(root, 'mbc-record-bar-topology')).toEqual([]);
    // Whatever topology the record carries.
    expect(textOf(bar({ ...protein, id: 'doc-protein-circular', topology: 'circular' }))).not.toMatch(/Linear|Circular/);

    // Tree and text records have no DNA topology either (the Info panel's rule); DNA keeps it.
    // The text record holds no bases, so no check ran on it.
    const tree = sample('doc-tree-coxii');
    const t = tableValues(tree);
    expect(summaryOf(bar(tree)), tree.name).toBe(`${t.name} · ${t.length} · ${t.status}`);
    const x = tableValues(textDoc);
    expect(summaryOf(bar(textDoc)), textDoc.name).toBe(`${x.name} · ${x.length} · ${x.status}`);
    expect(x.status).toBe('Not checked');
    expect(summaryOf(bar(sample('doc-insert-mcherry')))).toMatch(/ · Linear · /);
  });

  it('toggles back to the full table with a labelled button', () => {
    // The toggle, collapsed and expanded: a named button that says whether the table is shown.
    const collapsed = parse(renderToStaticMarkup(<DocumentTableToggle expanded={false} onToggle={() => {}} />));
    const show = buttonsNamed(collapsed, 'Show document table');
    expect(show).toHaveLength(1);
    expect(show[0].attrs['aria-expanded']).toBe('false');
    expect(textOf(show[0]).trim(), 'a visible label in the record bar').toBe('Document table');
    // One name for one control: the tooltip a mouse user sees is the name a screen reader hears.
    expect(show[0].attrs.title, 'the folded toggle\'s tooltip').toBe('Show document table');
    const expanded = parse(renderToStaticMarkup(<DocumentTableToggle expanded onToggle={() => {}} />));
    const hide = buttonsNamed(expanded, 'Hide document table');
    expect(hide.map((b) => b.attrs['aria-expanded'])).toEqual(['true']);
    expect(hide[0].attrs.title, 'the expanded toggle\'s tooltip').toBe('Hide document table');

    // Clicking the button calls its handler, and the bar's toggle is the one that shows the table.
    const onToggle = vi.fn();
    const button = DocumentTableToggle({ expanded: false, onToggle }) as React.ReactElement<{ onClick: () => void }>;
    expect(button.type).toBe('button');
    button.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
    const onShowTable = vi.fn();
    const elements: React.ReactElement<Record<string, unknown>>[] = [];
    const visit = (n: React.ReactNode) => {
      if (Array.isArray(n)) n.forEach(visit);
      else if (React.isValidElement(n)) { elements.push(n as React.ReactElement<Record<string, unknown>>); visit((n.props as { children?: React.ReactNode }).children); }
    };
    visit(DocumentRecordBar({ doc: sample('doc-puc19'), onShowTable }));
    const toggles = elements.filter((e) => e.type === DocumentTableToggle);
    expect(toggles.map((t) => t.props.expanded), 'one collapsed toggle in the bar').toEqual([false]);
    (toggles[0].props.onToggle as () => void)();
    expect(onShowTable).toHaveBeenCalledTimes(1);
  });

  it('toggles back to the full table with a labelled button, in agreement with View › Document Table', () => {
    const opened = [run('new-session:sample-library'), run('sequence:extract-region')];

    // With a document opened: the record bar's toggle is collapsed and the menu item unchecked.
    const a = driveApp(opened);
    const barToggle = buttonsNamed(one(a.root, 'mbc-record-bar'), 'Show document table');
    expect(barToggle.map((b) => [b.attrs['aria-expanded'], b.attrs.title])).toEqual([['false', 'Show document table']]);
    expect(buttonsNamed(a.root, 'Hide document table')).toEqual([]);
    expect(docTableItem(a.menus).label, 'the View menu item keeps its name').toBe('Document Table');
    expect(docTableItem(a.menus).checked, 'View › Document Table is unchecked').toBe(false);

    /** The full table, its toggle expanded, and the menu item checked. */
    const expectRestored = (r: ReturnType<typeof driveApp>, how: string) => {
      expect(fullTableShown(r.root), `${how}: the full table`).toBe(true);
      expect(byClass(r.root, 'mbc-record-bar'), `${how}: no record bar`).toEqual([]);
      const hide = buttonsNamed(r.root, 'Hide document table');
      expect(hide.map((b) => b.attrs['aria-expanded']), `${how}: the toggle`).toEqual(['true']);
      expect(ancestors(hide[0]).some((p) => p.classes.has('doc-table-toolbar')), `${how}: in the table's own toolbar`).toBe(true);
      expect(docTableItem(r.menus).checked, `${how}: View › Document Table is checked`).toBe(true);
    };

    // Choosing View › Document Table.
    expectRestored(driveApp([...opened, (menus) => docTableItem(menus).onToggle()]), 'the View menu item');
    // The native macOS menu's item (it dispatches the same command id), from folded to shown ...
    expectRestored(driveApp([...opened, run('view:toggle-doctable')]), 'the native menu command');
    // ... and from shown to folded, both from the session's full table and from a table it showed again.
    for (const [how, steps] of [
      ['from the full table', [run('new-session:sample-library'), run('view:toggle-doctable')]],
      ['after showing it again', [...opened, run('view:toggle-doctable'), run('view:toggle-doctable')]],
    ] as const) {
      const r = driveApp(steps);
      expect(fullTableShown(r.root), `the native menu command folds the table ${how}`).toBe(false);
      expect(buttonsNamed(one(r.root, 'mbc-record-bar'), 'Show document table').map((b) => b.attrs['aria-expanded']), how).toEqual(['false']);
      expect(docTableItem(r.menus).checked, `${how}: View › Document Table is unchecked`).toBe(false);
    }
    expect(textOf(one(driveApp([run('new-session:sample-library'), run('view:toggle-doctable')]).root, 'mbc-record-bar-name')),
      'folded on the session\'s active record').toBe(SAMPLE_LIBRARY[0].name);

    // Choosing the record bar's toggle: its handler runs inside the App's render that drew the bar.
    let used = 0;
    const viaToggle = driveApp(opened, (type, props) => {
      if (type === DocumentRecordBar && used === 0) { used++; (props.onShowTable as () => void)(); }
    });
    expect(used, 'the App drew the record bar').toBe(1);
    expectRestored(viaToggle, 'the record bar toggle');

    // And the expanded table's toggle folds it back into the bar, unchecking the menu item.
    let hid = 0;
    const back = driveApp([...opened, (menus) => docTableItem(menus).onToggle()], (type, props) => {
      if (type === DocumentTableToggle && props.expanded === true && hid === 0) { hid++; (props.onToggle as () => void)(); }
    });
    expect(hid, 'the App drew the expanded toggle').toBe(1);
    expect(byClass(back.root, 'mbc-record-bar')).toHaveLength(1);
    expect(docTableItem(back.menus).checked).toBe(false);
  });

  it('toggles back to the full table with a labelled button, and folds to the folder bar when the viewer shows no document', () => {
    // The bar names the document the viewer is showing. When the viewer shows none, the folded
    // table keeps today's bar (the folder's title and menus) and its toggle. Two ways to get there:
    // Cmd-click the active row to take it out of the selection (the viewer then has nothing to
    // inspect, yet the active document stays set), and open an empty folder (Deleted Items in a
    // new session), where no document is active and the App's active-document fallback is the
    // project's first document, which the viewer does not show either.
    const cmdClickActiveRow: Act = {
      what: 'a Cmd-click on the active row',
      pick: (type, props) => type === 'tr' && props.className === 'selected-row' && typeof props.onClick === 'function',
      act: (props) => (props.onClick as (e: unknown) => void)({ metaKey: true, ctrlKey: false, shiftKey: false }),
    };
    const deletedItems = press('the sidebar\'s Deleted Items', (p) => String(p.title ?? '').startsWith('Non-destructive recycle bin'));
    for (const [how, viewerSays, steps] of [
      ['the active row deselected', 'No Sequence Selected for Inspection', [run('new-session:sample-library'), cmdClickActiveRow, run('view:toggle-doctable')]],
      ['an empty folder open', 'No Sequences in Current Folder', [run('new-session:sample-library'), deletedItems, run('view:toggle-doctable')]],
    ] as const) {
      const r = driveApp(steps);
      expect(byClass(r.root, 'empty-doc-selection-dropzone').map((e) => textOf(findAll(e, (h) => h.tag === 'h3')[0])), `${how}: the viewer shows no document`).toEqual([viewerSays]);
      expect(pane(r.root).classes.has('collapsed'), `${how}: the table is folded`).toBe(true);
      expect(byClass(r.root, 'mbc-record-bar'), `${how}: no record bar`).toEqual([]);
      const toolbar = one(r.root, 'doc-table-toolbar');
      expect(buttonsNamed(toolbar, 'Show document table').map((b) => b.attrs['aria-expanded']), `${how}: the folder bar keeps the toggle`).toEqual(['false']);
      expect(fullTableShown(r.root)).toBe(false);
    }
  });

  it('collapses on open and never on row selection, and restores as saved', () => {
    const opens: DocTableEvent[] = [{ kind: 'open' }, { kind: 'import' }, { kind: 'create' }, { kind: 'result' }, { kind: 'sidebar-open' }];
    for (const from of [false, true]) {
      for (const e of opens) expect(nextDocTableCollapsed(from, e), `${e.kind} from ${from ? 'collapsed' : 'expanded'}`).toBe(true);
      expect(nextDocTableCollapsed(from, { kind: 'select-row' }), `select-row from ${from}`).toBe(from);
      expect(nextDocTableCollapsed(from, { kind: 'toggle' }), `toggle from ${from}`).toBe(!from);
      for (const saved of [false, true]) {
        expect(nextDocTableCollapsed(from, { kind: 'restore-session', saved }), `restore saved=${saved} from ${from}`).toBe(saved);
      }
      expect(nextDocTableCollapsed(from, { kind: 'start-session', hasActiveDocument: false }), `start, no document, from ${from}`).toBe(false);
      expect(nextDocTableCollapsed(from, { kind: 'start-session', hasActiveDocument: true }), `start with a document, from ${from}`).toBe(from);
    }
  });

  it('collapses on open and never on row selection in the App, and restores the session as saved', () => {
    // Selecting a row of the expanded table (a click, and a Cmd-click that adds it) shows that
    // record and leaves the table open: the row's own click handler runs inside the App's render.
    const rowsSelected = (root: El) => findAll(root, (e) => e.tag === 'tr' && (e.classes.has('selected-row') || e.classes.has('multi-checked-row'))).map(textOf);
    const before = rowsSelected(driveApp([run('new-session:sample-library')]).root);
    expect(before, 'one row selected when the session starts').toHaveLength(1);
    for (const mods of [{}, { metaKey: true }]) {
      let rows = 0;
      let clicked = 0;
      const r = driveApp([run('new-session:sample-library')], (type, props) => {
        if (type !== 'tr' || typeof props.onContextMenu !== 'function' || clicked) return;
        if (++rows === 3) { clicked++; (props.onClick as (e: unknown) => void)({ metaKey: false, ctrlKey: false, shiftKey: false, ...mods }); }
      });
      const how = 'metaKey' in mods ? 'Cmd-click' : 'click';
      expect(clicked, `${how}: a table row was clicked`).toBe(1);
      expect(rowsSelected(r.root), `${how}: the selection moved`).not.toEqual(before);
      expect(fullTableShown(r.root), `${how}: the table stays open`).toBe(true);
      expect(byClass(r.root, 'mbc-record-bar'), `${how}: no record bar`).toEqual([]);
    }

    // A blank session started after a folded one shows the full table, not the fold it inherited.
    const foldedSession = [run('new-session:sample-library'), run('sequence:extract-region')];
    expect(pane(driveApp(foldedSession).root).classes.has('collapsed'), 'the session before is folded').toBe(true);
    const blank = driveApp([...foldedSession, run('new-session:blank')]);
    expect(byClass(blank.root, 'mbc-record-bar'), 'the blank session has no record to name').toEqual([]);
    expect(pane(blank.root).classes.has('collapsed'), 'the blank session\'s table is not folded').toBe(false);
    expect(fullTableShown(blank.root), 'the blank session shows the full table').toBe(true);
    expect(buttonsNamed(blank.root, 'Hide document table').map((b) => b.attrs['aria-expanded'])).toEqual(['true']);
    expect(docTableItem(blank.menus).checked, 'View › Document Table is checked').toBe(true);

    // A restored session shows exactly what was saved, a document active either way: no collapse on
    // restore. The active record is not the session's first document, so the bar must name it.
    const puc19 = sample('doc-puc19');
    const restored = (docTableCollapsed: boolean) => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: 'Saved_Session',
        documents: [sample('doc-insert-mcherry'), puc19],
        workspace: {
          activeDocId: puc19.id, selectedFolder: 'All Project Files', navHistory: [puc19.id], navIndex: 0,
          viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed, selectedRange: null,
          displaySettings: {
            showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      }), 'the autosave is written').toBe(true);
      return driveApp([run('file:restore-autosave')]);
    };
    const expanded = restored(false);
    expect(fullTableShown(expanded.root), 'saved expanded: the full table').toBe(true);
    expect(byClass(expanded.root, 'mbc-record-bar')).toEqual([]);
    const folded = restored(true);
    expect(textOf(one(folded.root, 'mbc-record-bar-name')), 'saved collapsed: the bar for the active record').toBe(puc19.name);
    expect(fullTableShown(folded.root)).toBe(false);
  });

  it('gives the full table\'s Status column the record bar\'s verdict (BG-01M6S1B3)', () => {
    // A 60 kb record (the scan-based checks do not run on it), a protein (no check runs), a primer
    // every check passed and a plasmid with alerts, in a restored session with the table shown.
    const longDna: SequenceDocument = { ...sample('doc-insert-mcherry'), id: 'doc-long-60k', name: 'Long 60 kb insert', sequence: 'ACGT'.repeat(15_000), features: [], primers: [] };
    const [protein, primer, puc19, active] = ['doc-prot-egfp-1ema', 'doc-primer-cmv-fwd', 'doc-puc19', 'doc-insert-mcherry'].map(sample);
    expect(saveWorkbenchToLocalAutosave({
      sessionName: 'Saved_Session',
      documents: [active, longDna, protein, primer, puc19],
      workspace: {
        activeDocId: active.id, selectedFolder: 'All Project Files', navHistory: [active.id], navIndex: 0,
        viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
        darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
        displaySettings: {
          showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    }), 'the autosave is written').toBe(true);
    const { root } = driveApp([run('file:restore-autosave')]);
    expect(fullTableShown(root), 'the full table is shown').toBe(true);
    /** The Status cell of `doc`'s row: the cell whose hover text is its alerts summary. */
    const statusCell = (doc: SequenceDocument) => {
      const select = findAll(pane(root), (e) => e.tag === 'input' && e.attrs['aria-label'] === `Select ${doc.name}`);
      expect(select, `one row for ${doc.name}`).toHaveLength(1);
      const row = ancestors(select[0]).find((p) => p.tag === 'tr');
      if (!row) throw new Error(`${doc.name}'s checkbox is in no row`);
      const cells = findAll(row, (e) => e.tag === 'td' && e.attrs.title === computeDocumentTableMetrics(doc).alertsSummary);
      expect(cells, `${doc.name}: one Status cell`).toHaveLength(1);
      return cells[0];
    };
    for (const doc of [longDna, protein]) {
      const cell = statusCell(doc);
      expect(computeDocumentTableMetrics(doc).alertsCount, `${doc.name} has no alert`).toBe(0);
      expect(cell.classes.has('ok-status-cell') || byClass(cell, 'is-ok').length > 0, `${doc.name}: no OK where the checks did not run`).toBe(false);
      expect(byClass(cell, 'is-unchecked'), `${doc.name}: the neutral icon`).toHaveLength(1);
      // Neutral is neither a pass nor a warning: the cell takes no status class (ok-status-cell
      // inks it green, warn-status-cell amber) and no colour of its own, and its one icon is no
      // warning and is drawn in muted ink.
      expect([...cell.classes], `${doc.name}: no status styling on the cell`).toEqual(['center-cell']);
      expect(cell.attrs.style, `${doc.name}: no inline colour on the cell`).toBeUndefined();
      expect(byClass(cell, 'is-warn'), `${doc.name}: no warning icon`).toEqual([]);
      const icons = findAll(cell, (e) => e.tag === 'svg');
      expect(icons, `${doc.name}: one icon`).toHaveLength(1);
      expect(icons[0].attrs.style, `${doc.name}: muted ink`).toBe('color:var(--mbc-text-muted)');
    }
    // Partly checked (the 60 kb record) and Not checked (the protein) are told apart without
    // hovering: their icons draw different shapes, not only carry different class names.
    const drawing = (e: El): string => e.children
      .map((c) => (typeof c === 'string' ? c : `<${c.tag} ${Object.entries(c.attrs).filter(([k]) => k !== 'class').sort().map(([k, v]) => `${k}=${v}`).join(' ')}>${drawing(c)}`))
      .join('');
    const [partlyIcon] = findAll(statusCell(longDna), (e) => e.tag === 'svg');
    const noneIcon = findAll(statusCell(protein), (e) => e.tag === 'svg')[0];
    expect([partlyIcon.classes.has('is-partial'), noneIcon.classes.has('is-not-run')], 'Partly checked and Not checked').toEqual([true, true]);
    expect(drawing(partlyIcon), 'two different icons').not.toBe(drawing(noneIcon));
    const passed = statusCell(primer);
    expect([passed.classes.has('ok-status-cell'), byClass(passed, 'is-ok').length], 'a record every check passed').toEqual([true, 1]);
    const warned = statusCell(puc19);
    expect([warned.classes.has('warn-status-cell'), byClass(warned, 'is-warn').length], 'a record with alerts').toEqual([true, 1]);
  });

  it('opens a document into the record bar', () => {
    // With only the session started, the full table shows.
    const started = driveApp([run('new-session:sample-library')]);
    expect(fullTableShown(started.root), 'the full table before any document is opened').toBe(true);
    expect(byClass(started.root, 'mbc-record-bar')).toEqual([]);
    expect(byClass(started.root, 'doc-table-toolbar')).toHaveLength(1);

    // Sequence › Extract Region creates a document from the selection and makes it active.
    const ex = extracted();
    expect(ex.name, 'a new document, not the one that was active').not.toBe(SAMPLE_LIBRARY[0].name);
    const opened = driveApp([run('new-session:sample-library'), run('sequence:extract-region')]);
    const recordBar = one(opened.root, 'mbc-record-bar');
    expect(ancestors(recordBar).some((p) => p.classes.has('mbc-center-stack')), 'the bar is in the centre stack').toBe(true);
    const v = tableValues(ex);
    expect(summaryOf(opened.root)).toBe(`${ex.name} · ${v.length} · Linear · ${v.status}`);
    expect(findAll(pane(opened.root), (e) => e.tag === 'thead'), 'no document-table header row').toEqual([]);
    expect(byClass(opened.root, 'doc-table-toolbar'), 'no table toolbar').toEqual([]);
    expect(byClass(opened.root, 'mbc-document-table')).toEqual([]);

    // New › Enzyme Set creates and opens a document too. An enzyme set holds no sequence to fold,
    // so the bar leaves off the topology its table cell still reads.
    const drawn: { doc?: SequenceDocument } = {};
    const enzymes = driveApp([run('new-session:sample-library'), run('new-session:enzyme-set')], (type, props) => {
      if (type === DocumentRecordBar) drawn.doc = props.doc as SequenceDocument;
    });
    expect(textOf(one(enzymes.root, 'mbc-record-bar-name'))).toBe('Enzyme Set');
    expect(fullTableShown(enzymes.root)).toBe(false);
    const enzymeSet = drawn.doc;
    if (!enzymeSet) throw new Error('the App drew no record bar for the enzyme set');
    const es = tableValues(enzymeSet);
    expect([enzymeSet.docMetadata?.['Document Type'], es.topology], 'an enzyme set whose table topology reads Circular').toEqual(['Enzyme Set', 'Circular']);
    expect(byClass(one(enzymes.root, 'mbc-record-bar'), 'mbc-record-bar-topology'), 'no topology for an enzyme set').toEqual([]);
    expect(summaryOf(enzymes.root)).toBe(`Enzyme Set · ${es.length} · ${es.status}`);
  });

  it('opens a document into the record bar from every command that opens or creates one', () => {
    const started = run('new-session:sample-library');
    const toggle = run('view:toggle-doctable');
    /** The record bar names `name`; the full table and its header row are folded away. */
    const expectBarFor = (steps: readonly (Step | Act)[], name: string | RegExp, how: string) => {
      const r = driveApp(steps);
      const recordBar = byClass(r.root, 'mbc-record-bar');
      expect(recordBar, `${how}: one record bar`).toHaveLength(1);
      const shown = textOf(one(recordBar[0], 'mbc-record-bar-name'));
      if (typeof name === 'string') expect(shown, `${how}: the bar names the opened record`).toBe(name);
      else expect(shown, `${how}: the bar names the opened record`).toMatch(name);
      expect(findAll(pane(r.root), (e) => e.tag === 'thead'), `${how}: no document-table header row`).toEqual([]);
      expect(docTableItem(r.menus).checked, `${how}: View › Document Table is unchecked`).toBe(false);
    };

    // Tools › Extract Annotations saves one document per feature and opens the first.
    const features = extractAnnotatedFeaturesToDocuments(SAMPLE_LIBRARY[0], 'all');
    expect(features.length, 'the active sample has features to extract').toBeGreaterThan(1);
    expect(features[0].name).not.toBe(SAMPLE_LIBRARY[0].name);
    expectBarFor([started, run('tools:extract-annotations')], features[0].name, 'Tools › Extract Annotations');

    // The sidebar's NCBI RefSeq sample: fetched, and fetched again once the table is shown (the
    // session then holds it, and the fetch opens that copy).
    const spike = /Spike/;
    expectBarFor([started, sidebarEntry('RefSeq: Spike RBD')], spike, 'the NCBI sample fetch');
    expectBarFor([started, sidebarEntry('RefSeq: Spike RBD'), toggle, sidebarEntry('RefSeq: Spike RBD')], spike, 'the NCBI sample fetched again');

    // The sidebar's benchmark document: generated, and loaded again (the session's copy).
    const titin = /^Titin_Ig_Polyprotein/;
    expectBarFor([started, sidebarEntry('Protein: 10,000 aa Titin')], titin, 'the benchmark load');
    expectBarFor([started, sidebarEntry('Protein: 10,000 aa Titin'), toggle, sidebarEntry('Protein: 10,000 aa Titin')], titin, 'the benchmark loaded again');

    // A cloning vector preset (Cloning › vector menus): into a new session, into the open one, and
    // again once the session holds it.
    const preset = CLONING_ACTION_VECTOR_PRESETS.find((p) => !SAMPLE_LIBRARY.some((d) => d.id === buildCloningActionVectorDocument(p).id));
    if (!preset) throw new Error('every vector preset is a sample document');
    const vector = buildCloningActionVectorDocument(preset).name;
    const loadVector = run(`action-vec:${preset.id}`);
    expectBarFor([loadVector], vector, 'a vector preset with no session open');
    expectBarFor([started, loadVector], vector, 'a vector preset in the session');
    expectBarFor([started, loadVector, toggle, loadVector], vector, 'a vector preset the session already holds');

    // A sample document opened from the start page: with no session, and from the session's Home view.
    const puc19 = sample('doc-puc19');
    const openFromHome: Act = {
      what: 'the start page\'s pUC19',
      pick: (_type, props) => typeof props.onOpenSampleDocumentById === 'function',
      act: (props) => (props.onOpenSampleDocumentById as (id: string, tab: string) => void)(puc19.id, 'sequence-view'),
    };
    expectBarFor([openFromHome], puc19.name, 'a sample opened from the start page');
    expectBarFor([started, run('view:home'), openFromHome], puc19.name, 'a sample opened from the session\'s Home view');

    // A document jumped to from the Quick Command Navigator, and from the toolbar's file search.
    const target = SAMPLE_LIBRARY[2];
    expectBarFor([
      started,
      press('the Quick Command Navigator', (p) => String(p['aria-label'] ?? '').startsWith('Open Quick Command Navigator')),
      press(`the navigator's ${target.name}`, (p) => hasClass(p, 'mbc-cmd-palette-item') && childText(p.children).includes(`${target.name} (${target.accession})`)),
    ], target.name, 'the Quick Command Navigator');
    expectBarFor([
      started,
      {
        what: 'typing in the toolbar search',
        pick: (type, props) => type === 'input' && props.id === 'mbc-toolbar-global-search-input',
        act: (props) => (props.onChange as (e: unknown) => void)({ target: { value: target.name } }),
      },
      {
        what: `the search hit for ${target.name}`,
        pick: (type, props) => type === 'button' && hasClass(props, 'mbc-header-search-item') && childText(props.children).includes('File') && childText(props.children).includes(target.name),
        act: (props) => (props.onMouseDown as (e: unknown) => void)({ preventDefault() {} }),
      },
    ], target.name, 'the toolbar\'s file search');
  });
});
