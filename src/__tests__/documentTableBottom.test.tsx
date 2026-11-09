// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6S7T2: in the stacked layout the expanded document table sits below the sequence viewer,
 * with its resize handle between them, while the folded table (the record bar of US-01M6Q10G, or
 * the folder bar) stays on top. The side-by-side layout is as it was. BG-01M6SHDC: the help text
 * the menu shows for View > Split & Expand > Split Top / Bottom says so too.
 *
 * Every check drives the real App, rendered on the server, through the harness of
 * documentRecordBar.test.tsx: a menu command or a handler the App hands to one of its own elements
 * is run inside the App's render, so the render it causes shows what it did. A drag is the App's
 * own pointer listener: the effect it registers while the handle is held is run in that render,
 * against a stand-in window that receives the pointer moves and the release. Keyboard focus lives
 * in a document, not in markup, so the focus check mounts the App with React DOM's client renderer
 * instead (see "A live tree, for focus").
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';

// ─── App probes (installed before the App module is loaded) ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
type Effect = () => void | (() => void);
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Sees every effect a component registers, with its dependencies, while it renders. */
  onEffect: null as null | ((fn: Effect, deps: readonly unknown[] | undefined) => void),
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
  const useEffect = ((fn: Effect, deps?: readonly unknown[]) => {
    probe.onEffect?.(fn, deps);
    return actual.useEffect(fn, deps as unknown[] | undefined);
  }) as typeof actual.useEffect;
  return { ...actual, default: { ...actual, useRef, useEffect }, useRef, useEffect };
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
const { DocumentRecordBar, DocumentTableToggle } = await import('../components/DocumentRecordBar');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { extractRegionWithAnnotationsRust } = await import('../lib/rustBioEngine');
const { resolveMenuNodeFunctionDescription } = await import('../data/menuFunctionDescriptions');

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
/** The one element of a class. */
function one(root: El, cls: string): El {
  const found = byClass(root, cls);
  expect(found.map((e) => e.tag), `exactly one .${cls}`).toHaveLength(1);
  return found[0];
}
const buttonsNamed = (root: El, name: string) => findAll(root, (e) => e.tag === 'button' && e.attrs['aria-label'] === name);
const elementChildren = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');

// ─── The centre stack, as the eye and the Tab key meet it ───

/** The centre stack's regions in document order: the viewer, the resize handle and the table pane. */
function stack(root: El) {
  const centre = one(root, 'mbc-center-stack');
  const parts = elementChildren(centre).map((e) => {
    if (e.classes.has('mbc-viewer-shell')) return 'viewer';
    if (e.attrs.role === 'separator') return 'handle';
    if (e.classes.has('mbc-doc-table-pane')) return 'table';
    return `<${e.tag} class="${e.attrs.class ?? ''}">`;
  });
  const child = (part: string) => elementChildren(centre).find((_e, i) => parts[i] === part);
  return { centre, parts, viewer: child('viewer'), handle: child('handle'), table: child('table') };
}
/** What the Tab key reaches: buttons, fields and links not taken out of the order, and tabindex >= 0. */
const tabbable = (e: El) => {
  const index = e.attrs.tabindex;
  if (index !== undefined) return Number(index) >= 0;
  return ['button', 'input', 'select', 'textarea'].includes(e.tag) ? !('disabled' in e.attrs) : e.tag === 'a' && 'href' in e.attrs;
};
/** The full table: its header row and body. */
const fullTable = (pane: El) => byClass(pane, 'mbc-document-table').length === 1 && findAll(pane, (e) => e.tag === 'thead').length === 1;
/** The pane's height, as the App sets it on the pane. */
const paneHeight = (pane: El) => /--mbc-doc-table-h:\s*(\d+)px/.exec(pane.attrs.style ?? '')?.[1];

// ─── App renders ───

type Step = (menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void;
/** A user action on an element the App creates in its own render: the first element `pick` accepts. */
interface Act { what: string; pick: (type: unknown, props: Record<string, unknown>) => boolean; act: (props: Record<string, unknown>) => void }
/** Renders the App, running each step (a menu step or an action) inside the render the step before caused. */
function driveApp(steps: readonly (Step | Act)[]) {
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
    const step = steps[ran];
    if (step && typeof step !== 'function' && passes > lastStepPass && step.pick(type, props)) { ran++; lastStepPass = passes; step.act(props); }
  };
  const html = renderToStaticMarkup(<App />);
  probe.onElement = null;
  const pending = steps[ran];
  expect(ran, `every step ran${pending ? ` (stopped at ${typeof pending === 'function' ? 'a menu step' : pending.what})` : ''}`).toBe(steps.length);
  expect([...heldDrags], 'every drag reached the App\'s pointer listener and was let go').toEqual([]);
  return { html, root: parse(html), menus: lastMenus };
}
const run = (id: string): Step => (_m, d) => d(id);

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
const docTableChecked = (menus: readonly (readonly unknown[])[]) => {
  const node = menuNode(menus, 'view-tog-doctable');
  if (node.kind !== 'checkbox') throw new Error('View › Document Table is not a checkbox item');
  return node.checked;
};

const started = run('new-session:sample-library');
const sideBySide = run('view:split-left-right');
const stacked = run('view:split-top-bottom');
const toggleTable = run('view:toggle-doctable');
/** Sequence › Extract Region: creates a document from the selection and opens it, folding the table. */
const openDocument = run('sequence:extract-region');
/** The record bar's own toggle, used where the App draws the bar. */
const recordBarToggle: Act = {
  what: 'the record bar\'s toggle',
  pick: (type) => type === DocumentRecordBar,
  act: (props) => (props.onShowTable as () => void)(),
};
/** The expanded table's own toggle, in its toolbar. */
const tableToolbarToggle: Act = {
  what: 'the expanded table\'s toggle',
  pick: (type, props) => type === DocumentTableToggle && props.expanded === true,
  act: (props) => (props.onToggle as () => void)(),
};
/** A Cmd-click on the active row takes it out of the selection, so the viewer shows no document. */
const cmdClickActiveRow: Act = {
  what: 'a Cmd-click on the active row',
  pick: (type, props) => type === 'tr' && props.className === 'selected-row' && typeof props.onClick === 'function',
  act: (props) => (props.onClick as (e: unknown) => void)({ metaKey: true, ctrlKey: false, shiftKey: false }),
};

// ─── The handle, held and moved ───

const POINTER = 7;
/** The table / viewer resize handle (not the sidebar's), acted on through the handler the App gives it. */
const onHandle = (what: string, act: (props: Record<string, unknown>) => void): Act => ({
  what, pick: (type, props) => type === 'div' && props.role === 'separator' && String(props.className ?? '').split(/\s+/).includes('mbc-workspace-pane-resizer'), act,
});
const pressKey = (key: string) => onHandle(`${key} on the handle`, (p) => (p.onKeyDown as (e: unknown) => void)({ key, preventDefault() {} }));
const doubleClick = onHandle('a double-click on the handle', (p) => (p.onDoubleClick as () => void)());

/** Effects the test runs inside the render that registers them, as a commit would run them. */
const runners: ((fn: Effect, deps: readonly unknown[] | undefined) => void)[] = [];
/** Drags whose pointer listener has not run yet: each must reach the App's listener. */
const heldDrags = new Set<string>();
afterEach(() => { runners.length = 0; heldDrags.clear(); });
probe.onEffect = (fn, deps) => { for (const r of [...runners]) r(fn, deps); };

/**
 * Holds the handle at (`x`, `y`), then moves the pointer through `moves` and lets go. The App's
 * pointer listener is the effect it registers while the handle is held; it runs in the render that
 * registers it, so the height it commits on release reaches the next render. While it runs, the
 * window it listens on is a stand-in that delivers the moves and the release.
 */
function drag(x: number, y: number, moves: readonly { x: number; y: number }[]): Act {
  const what = `a drag from (${x}, ${y}) through ${moves.map((m) => `(${m.x}, ${m.y})`).join(', ')}`;
  return onHandle(what, (props) => {
    let held = true;
    heldDrags.add(what);
    runners.push((fn, deps) => {
      // The App's pane-drag listener: the effect keyed on the dragging flag alone, now true, that
      // reads the drag the handle's pointer-down recorded.
      if (!held || deps?.length !== 1 || deps[0] !== true || !String(fn).includes('workspacePaneDragRef')) return;
      held = false;
      heldDrags.delete(what);
      const listeners = new Map<string, (ev: unknown) => void>();
      const g = globalThis as unknown as Record<string, unknown>;
      const before = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
      g.window = { addEventListener: (type: string, f: (ev: unknown) => void) => listeners.set(type, f), removeEventListener: () => {} };
      g.requestAnimationFrame = () => 1;
      g.cancelAnimationFrame = () => {};
      try {
        fn();
        const move = listeners.get('pointermove');
        const up = listeners.get('pointerup');
        if (!move || !up) throw new Error('the pane drag listens for no pointer moves or release');
        for (const m of moves) move({ clientX: m.x, clientY: m.y, pointerId: POINTER });
        up({ clientX: moves.at(-1)?.x ?? x, clientY: moves.at(-1)?.y ?? y, pointerId: POINTER });
      } finally {
        for (const [k, v] of [['window', before.window], ['requestAnimationFrame', before.raf], ['cancelAnimationFrame', before.caf]] as const) {
          if (v === undefined) delete g[k]; else g[k] = v;
        }
      }
    });
    (props.onPointerDown as (e: unknown) => void)({ clientX: x, clientY: y, pointerId: POINTER, preventDefault() {} });
  });
}
/** Runs the App's layout persistence effect each time it is registered, as a commit would. */
function persistLayout() {
  runners.push((fn, deps) => {
    if (deps?.length === 7 && String(fn).includes('savePersistedWorkspaceLayout')) fn();
  });
}
const storedHeight = () => (JSON.parse(storage.getItem('molbiocraft.workspace.layout.v1') ?? '{}') as { docTableHeightPx?: number }).docTableHeightPx;

// ─── A live tree, for focus ───

/**
 * The node tree React DOM's client renderer writes to when the App is mounted with `createRoot`, the
 * renderer the app itself runs. The repo carries no DOM library (jsdom, happy-dom), so, as in
 * engineWarnings.test.tsx, the tree is these few node operations. Which nodes React keeps, moves,
 * inserts or removes on a re-render is React's own reconciliation. The tree holds the nodes, delivers
 * an event along its target's path to the window (capture listeners from the window down, then bubble
 * listeners back up), and keeps the one rule of focus a browser keeps: the focused element is the one
 * `focus()` was last called on, until it or an ancestor leaves the tree (the focus fixup rule), and
 * from then on the body has focus. It fires no focus events, which nothing checked here listens for.
 */
interface LiveEvent { type: string; target: LiveNode; defaultPrevented: boolean; [field: string]: unknown }
type LiveListener = (ev: LiveEvent) => void;
const isCapture = (options?: boolean | { capture?: boolean }) => options === true || (typeof options === 'object' && !!options?.capture);
class LiveEventTarget {
  private readonly listeners: { type: string; capture: boolean; fn: LiveListener }[] = [];
  addEventListener(type: string, fn: LiveListener, options?: boolean | { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: isCapture(options) });
  }
  removeEventListener(type: string, fn: LiveListener, options?: boolean | { capture?: boolean }) {
    const at = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === isCapture(options));
    if (at >= 0) this.listeners.splice(at, 1);
  }
  /** Runs this target's listeners for `ev` in one phase. */
  fire(ev: LiveEvent, capture: boolean) {
    for (const l of this.listeners.filter((x) => x.type === ev.type && x.capture === capture)) l.fn.call(this, ev);
  }
}
class LiveNode extends LiveEventTarget {
  childNodes: LiveNode[] = [];
  parentNode: LiveNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: LiveDocument | null) { super(); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get parentElement(): LiveElement | null { return this.parentNode instanceof LiveElement ? this.parentNode : null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (t) this.appendChild(new LiveText(t, this.ownerDocument!));
  }
  contains(other: LiveNode | null) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  /** The descendants a selector list matches; the tree reads only `tag`, `.class` and `[attr="value"]` parts, and says so of any other. */
  querySelectorAll(selector: string): LiveElement[] {
    const tests = selector.split(',').map((one) => {
      const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/.exec(one.trim());
      if (!m || !one.trim()) throw new Error(`the live tree reads no selector like ${one.trim()}`);
      const tag = m[1]?.toUpperCase();
      const parts = [...m[2].matchAll(/\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)];
      return (e: LiveElement) => (!tag || e.tagName.toUpperCase() === tag) && parts.every((p) => (
        p[1] !== undefined ? e.classList.contains(p[1]) : p[3] === undefined ? e.hasAttribute(p[2]) : e.getAttribute(p[2]) === p[3]
      ));
    });
    return [...liveElements(this)].filter((e) => tests.some((t) => t(e)));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  appendChild(child: LiveNode) { return this.insertBefore(child, null); }
  insertBefore(child: LiveNode, before: LiveNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: LiveNode) {
    const doc = this.ownerDocument ?? (this as unknown as LiveDocument);
    // The focus fixup rule: a focused element that leaves the tree, alone or with an ancestor, loses focus.
    if (doc.focused && child.contains(doc.focused)) doc.focused = null;
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
}
class LiveText extends LiveNode {
  constructor(public nodeValue: string, doc: LiveDocument) { super(3, '#text', doc); }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = t; }
}
class LiveElement extends LiveNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
  constructor(tag: string, readonly namespaceURI: string, doc: LiveDocument) {
    const name = namespaceURI === 'http://www.w3.org/1999/xhtml' ? tag.toUpperCase() : tag;
    super(1, name, doc);
    this.tagName = name;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns: string | null, name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  get classList() {
    const classes = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const write = (list: string[]) => this.setAttribute('class', [...new Set(list)].join(' '));
    return {
      contains: (c: string) => classes().includes(c),
      add: (...cs: string[]) => write([...classes(), ...cs]),
      remove: (...cs: string[]) => write(classes().filter((c) => !cs.includes(c))),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes().includes(c);
        write(on ? [...classes(), c] : classes().filter((x) => x !== c));
        return on;
      },
    };
  }
  focus() { this.ownerDocument!.focused = this; }
  blur() { if (this.ownerDocument!.focused === this) this.ownerDocument!.focused = null; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  /** A select's options, which React DOM reads to mark the selected one. */
  get options(): LiveElement[] { return [...liveElements(this)].filter((e) => e.tagName === 'OPTION'); }
}
class LiveDocument extends LiveNode {
  focused: LiveElement | null = null;
  readonly documentElement: LiveElement;
  readonly head: LiveElement;
  readonly body: LiveElement;
  constructor() {
    super(9, '#document', null);
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  get activeElement() { return this.focused ?? this.body; }
  createElement(tag: string) { return new LiveElement(tag, 'http://www.w3.org/1999/xhtml', this); }
  createElementNS(ns: string, tag: string) { return new LiveElement(tag, ns, this); }
  createTextNode(t: string) { return new LiveText(t, this); }
  getElementById(id: string) { return [...liveElements(this)].find((e) => e.getAttribute('id') === id) ?? null; }
}
function* liveElements(n: LiveNode): Generator<LiveElement> {
  for (const c of n.childNodes) if (c instanceof LiveElement) { yield c; yield* liveElements(c); }
}
/** The window the App and React DOM read while the App is mounted. */
class LiveWindow extends LiveEventTarget {
  readonly HTMLIFrameElement = class {};
  readonly localStorage = storage;
  readonly navigator = globalThis.navigator;
  readonly innerWidth = 1280;
  readonly innerHeight = 800;
  readonly devicePixelRatio = 1;
  constructor(readonly document: LiveDocument) { super(); }
  setTimeout(fn: () => void, ms?: number) { return setTimeout(fn, ms); }
  clearTimeout(id: ReturnType<typeof setTimeout>) { clearTimeout(id); }
  requestAnimationFrame() { return 0; }
  cancelAnimationFrame() {}
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; }
}

/**
 * Mounts the App with React DOM's client renderer in a live tree, and gives the steps a keyboard user
 * takes and what the tree then holds. Every step runs in `flushSync`, so the render and the effects it
 * causes have run when the step returns, as a browser has run them before the next key press. The
 * App's own timers (the start-up splash, status notices) wait on fake timers and are dropped at
 * unmount, so none runs once the tree is gone.
 */
function mountApp() {
  vi.useFakeTimers();
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document };
  const doc = new LiveDocument();
  const win = new LiveWindow(doc);
  g.window = win;
  g.document = doc;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const restore = () => {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete g[k]; else g[k] = v;
    vi.clearAllTimers();
    vi.useRealTimers();
  };
  try {
    flushSync(() => root.render(<App />));
  } catch (err) {
    try { root.unmount(); } finally { restore(); }
    throw err;
  }

  /** Delivers an event to `target` along its path, capture then bubble; returns it. */
  const dispatch = (target: LiveNode, type: string, init: Record<string, unknown> = {}): LiveEvent => {
    const path: LiveEventTarget[] = [];
    for (let n: LiveNode | null = target; n; n = n.parentNode) path.push(n);
    path.push(win);
    let stopped = false;
    const ev: LiveEvent = {
      button: 0, buttons: 0, detail: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init,
      type, target, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: 0, isTrusted: true,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
    };
    flushSync(() => {
      for (const t of [...path].reverse()) { if (stopped) break; t.fire(ev, true); }
      for (const t of path) { if (stopped) break; t.fire(ev, false); }
    });
    return ev;
  };
  const centre = () => {
    const found = [...liveElements(container)].filter((e) => e.classList.contains('mbc-center-stack'));
    expect(found, 'one centre stack').toHaveLength(1);
    return found[0];
  };
  const pane = () => {
    const found = [...centre().childNodes].filter((e): e is LiveElement => e instanceof LiveElement && e.classList.contains('mbc-doc-table-pane'));
    expect(found, 'one table pane').toHaveLength(1);
    return found[0];
  };
  const app = {
    doc,
    /** A menu command, as the native or web menu runs it. */
    menu: (id: string) => flushSync(() => probe.dispatcher!.current.onMenuAction(id)),
    /** Moves focus to `el`, as Tab does. */
    focus: (el: LiveElement) => el.focus(),
    /**
     * A key press on the focused element: Enter on a button also clicks it, unless the key down was
     * cancelled, and the key up goes to whatever has focus by then.
     */
    press: (key: string) => {
      const target = doc.activeElement;
      const down = dispatch(target, 'keydown', { key, code: key });
      if (key === 'Enter' && target.tagName === 'BUTTON' && !down.defaultPrevented) dispatch(target, 'click');
      dispatch(doc.activeElement, 'keyup', { key, code: key });
    },
    click: (el: LiveElement, init: Record<string, unknown> = {}) => dispatch(el, 'click', { detail: 1, ...init }),
    /** The centre stack's regions in document order. */
    parts: () => [...centre().childNodes].map((e) => {
      if (!(e instanceof LiveElement)) return '#text';
      if (e.classList.contains('mbc-viewer-shell')) return 'viewer';
      if (e.getAttribute('role') === 'separator') return 'handle';
      if (e.classList.contains('mbc-doc-table-pane')) return 'table';
      return `<${e.tagName} class="${e.getAttribute('class') ?? ''}">`;
    }),
    pane,
    viewer: () => [...centre().childNodes].find((e): e is LiveElement => e instanceof LiveElement && e.classList.contains('mbc-viewer-shell'))!,
    /** The table's one toggle, in the record bar or the table's toolbar. */
    toggle: () => {
      const found = pane().querySelectorAll('.mbc-doc-table-toggle');
      expect(found.map((t) => t.getAttribute('aria-label')), 'one table toggle in the pane').toHaveLength(1);
      return found[0];
    },
    /** What has focus, for a failure message. */
    focusName: () => {
      const f = doc.activeElement;
      return f === doc.body ? 'the body' : `<${f.tagName} class="${f.getAttribute('class') ?? ''}" aria-label="${f.getAttribute('aria-label') ?? ''}">`;
    },
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
  return app;
}
const inRecordBar = (el: LiveElement) => { for (let n: LiveNode | null = el; n; n = n.parentNode) if (n instanceof LiveElement && n.classList.contains('mbc-record-bar')) return true; return false; };

// ─── The criteria ───

describe('the document table below the viewer (US-01M6S7T2)', () => {
  it('puts the document table below the viewer in the stacked layout', () => {
    /** The stacked layout with the table expanded: the viewer, then the handle, then the table. */
    const expectBelow = (steps: readonly (Step | Act)[], how: string) => {
      const r = driveApp(steps);
      const s = stack(r.root);
      expect(s.parts, `${how}: the viewer, then the handle, then the table`).toEqual(['viewer', 'handle', 'table']);
      expect(fullTable(s.table!), `${how}: the pane below holds the full table`).toBe(true);
      expect(buttonsNamed(s.table!, 'Hide document table').map((b) => b.attrs['aria-expanded']), `${how}: and its toggle`).toEqual(['true']);
      expect(s.centre.classes.has('split-left-right'), `${how}: stacked, not side by side`).toBe(false);
      // The handle between them resizes the table's height.
      expect([s.handle!.attrs['aria-orientation'], s.handle!.attrs['aria-label']], `${how}: the handle`).toEqual(['horizontal', 'Resize Project Document Table height']);
      expect(docTableChecked(r.menus), `${how}: View › Document Table is checked`).toBe(true);
      // The Tab key meets the viewer's controls, then the handle, then the table's.
      const order = [...walk(r.root)];
      const at = (e: El) => order.indexOf(e);
      const viewerStops = findAll(s.viewer!, tabbable).map(at);
      const tableStops = findAll(s.table!, tabbable).map(at);
      expect([viewerStops.length > 5, tableStops.length > 5], `${how}: both regions have controls to reach`).toEqual([true, true]);
      expect(Math.max(...viewerStops) < at(s.handle!) && at(s.handle!) < Math.min(...tableStops), `${how}: focus order viewer, handle, table`).toBe(true);
      return r;
    };
    // The session's start, the table shown again after a document folded it, and the stacked
    // layout chosen again after the side-by-side one.
    expectBelow([started], 'a new session');
    expectBelow([started, openDocument, toggleTable], 'shown again after an open folded it');
    expectBelow([started, openDocument, recordBarToggle], 'shown again from the record bar');
    expectBelow([started, sideBySide, stacked], 'the stacked layout chosen again');
  });

  it('keeps the record bar above the viewer', () => {
    // Opening a document folds the table into its record bar, which sits on top, above the map
    // and sequence, with no handle and nothing below the viewer.
    const folded = driveApp([started, openDocument]);
    const f = stack(folded.root);
    expect(f.parts, 'folded: the record bar on top, then the viewer').toEqual(['table', 'viewer']);
    expect(f.table!.classes.has('collapsed'), 'the pane on top is the folded table').toBe(true);
    const ex = extractRegionWithAnnotationsRust(SAMPLE_LIBRARY[0], 5179, 5898, '2026-11-06T00:00:00Z');
    expect(textOf(one(f.table!, 'mbc-record-bar-name')), 'naming the opened record').toBe(ex.name);
    expect(fullTable(f.table!)).toBe(false);
    expect(byClass(f.viewer!, 'mbc-viewer-header'), 'the viewer below it shows the record').toHaveLength(1);
    expect(byClass(f.viewer!, 'mbc-record-bar'), 'no record bar inside or below the viewer').toEqual([]);

    // The bar still opens the table, which then renders below the viewer; the table's own toggle
    // folds it back into the bar on top.
    for (const [how, steps] of [
      ['the record bar\'s toggle', [started, openDocument, recordBarToggle]],
      ['View › Document Table', [started, openDocument, toggleTable]],
    ] as const) {
      const r = driveApp(steps);
      const s = stack(r.root);
      expect(s.parts, `${how}: the table opens below the viewer`).toEqual(['viewer', 'handle', 'table']);
      expect(fullTable(s.table!), `${how}: the full table`).toBe(true);
      expect(byClass(r.root, 'mbc-record-bar'), `${how}: the bar gives way to the table`).toEqual([]);
    }
    const back = driveApp([started, openDocument, toggleTable, tableToolbarToggle]);
    const b = stack(back.root);
    expect(b.parts, 'folded again: the bar back on top').toEqual(['table', 'viewer']);
    expect(textOf(one(b.table!, 'mbc-record-bar-name'))).toBe(ex.name);
    expect(docTableChecked(back.menus)).toBe(false);

    // The folder bar (folded with no document on show) stays on top too.
    const bare = driveApp([started, cmdClickActiveRow, toggleTable]);
    const n = stack(bare.root);
    expect(n.parts, 'the folder bar on top').toEqual(['table', 'viewer']);
    expect(byClass(n.table!, 'doc-table-toolbar'), 'the folded pane is the folder bar').toHaveLength(1);
    expect(byClass(bare.root, 'mbc-record-bar')).toEqual([]);
  });

  it('resizes the bottom table from the handle above it', () => {
    /** The expanded table's height, read from the pane and from the handle that sets it. */
    const height = (r: ReturnType<typeof driveApp>) => {
      const s = stack(r.root);
      expect(s.parts).toEqual(['viewer', 'handle', 'table']);
      const px = paneHeight(s.table!);
      expect(s.handle!.attrs['aria-valuenow'], 'the handle reports the pane\'s height').toBe(px);
      return Number(px);
    };
    expect(height(driveApp([started])), 'the default height').toBe(175);

    // The table is below the handle: dragging it up grows the table by the distance, down shrinks it.
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 450 }, { x: 290, y: 400 }])])), 'dragged up 100px').toBe(275);
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 530 }])])), 'dragged down 30px').toBe(145);
    // The bounds hold as before.
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: -400 }])])), 'dragged far up').toBe(460);
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 900 }])])), 'dragged far down').toBe(115);

    // The keys move the handle the way they point, 16px a press; Home and a double-click reset it.
    expect(height(driveApp([started, pressKey('ArrowUp')])), 'Arrow Up').toBe(191);
    expect(height(driveApp([started, pressKey('ArrowUp'), pressKey('ArrowUp'), pressKey('ArrowDown')])), 'Up, Up, Down').toBe(191);
    expect(height(driveApp([started, pressKey('ArrowDown')])), 'Arrow Down').toBe(159);
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 400 }]), pressKey('Home')])), 'Home after a drag').toBe(175);
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 400 }]), doubleClick])), 'a double-click after a drag').toBe(175);

    // Folding the table keeps its height, and it opens again at that height.
    const foldedAfterDrag = driveApp([started, drag(300, 500, [{ x: 300, y: 400 }]), toggleTable]);
    const f = stack(foldedAfterDrag.root);
    expect(f.parts, 'folded after the drag: the folded bar on top, no handle').toEqual(['table', 'viewer']);
    expect(docTableChecked(foldedAfterDrag.menus)).toBe(false);
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 400 }]), toggleTable, toggleTable])), 'folded and shown again').toBe(275);

    // The height is stored once the drag ends and read back at the next launch.
    persistLayout();
    expect(height(driveApp([started, drag(300, 500, [{ x: 300, y: 380 }])])), 'dragged up 120px').toBe(295);
    expect(storedHeight(), 'the stored height').toBe(295);
    runners.length = 0;
    expect(height(driveApp([started])), 'the next launch opens the table at the stored height').toBe(295);
    storage.setItem('molbiocraft.workspace.layout.v1', JSON.stringify({ docTableHeightPx: 9000 }));
    expect(height(driveApp([started])), 'a stored height out of bounds is clamped as before').toBe(460);
  });

  it('leaves the side-by-side layout unchanged', () => {
    // Expanded: the table first, the handle, then the viewer, on the side-by-side grid.
    const open = driveApp([started, sideBySide]);
    const s = stack(open.root);
    expect(s.parts, 'the table, the handle, the viewer').toEqual(['table', 'handle', 'viewer']);
    expect([...s.centre.classes].sort(), 'the side-by-side grid').toEqual(['mbc-center-stack', 'split-left-right']);
    expect(fullTable(s.table!)).toBe(true);
    expect([s.handle!.attrs['aria-orientation'], s.handle!.attrs['aria-label'], s.handle!.attrs['aria-valuenow']], 'the handle sets the width').toEqual(['vertical', 'Resize Project Document Table width', '410']);

    // The handle still widens the table to the right and steps 20px a key press.
    const width = (r: ReturnType<typeof driveApp>) => {
      const t = stack(r.root);
      expect(t.parts).toEqual(['table', 'handle', 'viewer']);
      const w = /--mbc-split-left-w:\s*(\d+)px/.exec(t.centre.attrs.style ?? '')?.[1];
      expect(t.handle!.attrs['aria-valuenow']).toBe(w);
      return Number(w);
    };
    expect(width(driveApp([started, sideBySide, drag(500, 300, [{ x: 600, y: 320 }])])), 'dragged right 100px').toBe(510);
    expect(width(driveApp([started, sideBySide, drag(500, 300, [{ x: 450, y: 300 }])])), 'dragged left 50px').toBe(360);
    expect(width(driveApp([started, sideBySide, pressKey('ArrowRight')])), 'Arrow Right').toBe(430);
    expect(width(driveApp([started, sideBySide, pressKey('ArrowLeft')])), 'Arrow Left').toBe(390);
    expect(width(driveApp([started, sideBySide, pressKey('ArrowUp')])), 'Arrow Up does nothing side by side').toBe(410);
    // Up and Down, and the height they set, are the stacked layout's alone: pressed side by side
    // (with Arrow Right, so the press shows), the height the stacked layout comes back to is unchanged.
    const upDownRight = onHandle('Arrow Up, Arrow Down and Arrow Right on the handle', (p) => {
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowRight']) (p.onKeyDown as (e: unknown) => void)({ key, preventDefault() {} });
    });
    const pressed = driveApp([started, sideBySide, upDownRight]);
    expect(width(pressed), 'only Arrow Right moved the handle').toBe(430);
    const back = stack(driveApp([started, sideBySide, upDownRight, stacked]).root);
    expect(paneHeight(back.table!), 'the stacked table\'s height is untouched').toBe('175');

    // Folded: the record bar spans the top, with its switch back to the stacked layout.
    const folded = driveApp([started, sideBySide, openDocument]);
    const f = stack(folded.root);
    expect(f.parts, 'folded side by side: the bar on top, then the viewer').toEqual(['table', 'viewer']);
    expect([...f.centre.classes], 'no grid while folded').toEqual(['mbc-center-stack']);
    expect(buttonsNamed(one(f.table!, 'mbc-record-bar'), 'Switch to Stacked (Top / Bottom) Split View')).toHaveLength(1);

    // The one change side by side is AC6's wording: the empty state says the table is on the left,
    // where it is, no longer above.
    const empty = driveApp([started, sideBySide, cmdClickActiveRow]);
    const drop = one(empty.root, 'empty-doc-selection-dropzone');
    expect(textOf(drop)).toContain('Select a sequence in the table on the left to inspect its map, sequence, and');
    expect(textOf(drop)).not.toMatch(/\b(above|below)\b/);
    expect(stack(empty.root).parts).toEqual(['table', 'handle', 'viewer']);
  });

  it('says the table is below in its empty-state messages', () => {
    /** The text of the viewer's empty state, where it says where to select from. */
    const message = (root: El, cls: string) => {
      const found = byClass(root, cls)
        .flatMap((e) => findAll(e, (m) => (m.tag === 'p' || m.tag === 'span') && /\bselect (a|at least two)\b/i.test(textOf(m))))
        .map((m) => textOf(m).replace(/\s+/g, ' '));
      expect(found, `one .${cls} message about the table`).toHaveLength(1);
      return found[0];
    };
    /** Where each state says the table is. Only the folded table's message looks up, to the control on the bar above. */
    const WHERE = {
      below: 'the table below',
      left: 'the table on the left',
      folded: 'the document table (open it with the Document table control above)',
    } as const;
    type Place = keyof typeof WHERE;
    const PARTS: Record<Place, string[]> = { below: ['viewer', 'handle', 'table'], left: ['table', 'handle', 'viewer'], folded: ['table', 'viewer'] };
    /** The message names its own place and no other, and the table is really there. */
    const expectPlace = (r: ReturnType<typeof driveApp>, text: string, place: Place, how: string) => {
      for (const other of Object.keys(WHERE) as Place[]) {
        if (other !== place) expect(text, `${how}: not ${WHERE[other]}`).not.toContain(WHERE[other]);
      }
      expect(/\babove\b/.test(text), `${how}: above only names the folded table's control`).toBe(place === 'folded');
      expect(/\bbelow\b/.test(text), `${how}: below only while the table is below`).toBe(place === 'below');
      const s = stack(r.root);
      expect(s.parts, `${how}: where the table is`).toEqual(PARTS[place]);
      if (place === 'folded') {
        // The control the message names is on the folded bar, above the message.
        expect(buttonsNamed(s.table!, 'Show document table').map(textOf), `${how}: the Document table control on the bar above`).toEqual(['Document table']);
      } else {
        expect(fullTable(s.table!), `${how}: the full table`).toBe(true);
      }
    };

    // No document on show: the dropzone, stacked and side by side, with the table shown and folded.
    for (const [place, how, steps] of [
      ['below', 'stacked, table shown', [started, cmdClickActiveRow]],
      ['folded', 'stacked, table folded', [started, cmdClickActiveRow, toggleTable]],
      ['left', 'side by side, table shown', [started, sideBySide, cmdClickActiveRow]],
      ['folded', 'side by side, table folded', [started, sideBySide, cmdClickActiveRow, toggleTable]],
    ] as const) {
      const r = driveApp(steps);
      expect(byClass(r.root, 'empty-doc-selection-dropzone').map((e) => textOf(findAll(e, (h) => h.tag === 'h3')[0])), how).toEqual(['No Sequence Selected for Inspection']);
      const text = message(r.root, 'empty-doc-selection-dropzone');
      expect(text, how).toBe(
        `Select a sequence in ${WHERE[place]} to inspect its map, sequence, and analysis studios, or drag and drop files anywhere onto this workspace to import.`,
      );
      expectPlace(r, text, place, how);
    }

    // One sequence selected: the alignment and tree studios ask for two from the table, wherever it is.
    const doc = SAMPLE_LIBRARY[0];
    for (const [place, how, layout] of [
      ['below', 'stacked, table shown', []],
      ['left', 'side by side, table shown', [sideBySide]],
      ['folded', 'stacked, table folded into the record bar', [toggleTable]],
    ] as const) {
      const align = driveApp([started, ...layout, run('align:msa-clustalo')]);
      const alignText = message(align.root, 'mbc-studio-loading-state');
      expect(alignText, `${how}: align`).toBe(
        `Select at least two ${doc.moleculeType} sequences in ${WHERE[place]} to align them, or open a record with stored alignment members.`,
      );
      expectPlace(align, alignText, place, `${how}: align`);
      const tree = driveApp([started, ...layout, run('phylo:tree-fasttree')]);
      const treeText = message(tree.root, 'mbc-studio-loading-state');
      expect(treeText, `${how}: tree`).toBe(
        `This record has no stored tree topology or source alignment. Import a Newick/NEXUS tree, or select at least two ${doc.moleculeType} sequences in ${WHERE[place]} to build a tree.`,
      );
      expectPlace(tree, treeText, place, `${how}: tree`);
    }
  });

  it('keeps keyboard focus on the table toggle across a fold', () => {
    const BELOW = ['viewer', 'handle', 'table'];
    const ON_TOP = ['table', 'viewer'];
    const LEFT = ['table', 'handle', 'viewer'];
    const app = mountApp();
    try {
      app.menu('new-session:sample-library');
      /**
       * A keyboard user reaches the table's toggle and presses Enter. The table must then be where
       * `parts` says, and focus must be on the toggle of the pane now on screen, which offers the
       * next fold or open, in the record bar or not.
       */
      const enterOnToggle = (how: string, parts: readonly string[], expanded: boolean, recordBar: boolean) => {
        app.focus(app.toggle());
        app.press('Enter');
        expect(app.parts(), `${how}: where the table is`).toEqual(parts);
        const toggle = app.toggle();
        expect(app.doc.activeElement === toggle, `${how}: focus on the table's toggle, not ${app.focusName()}`).toBe(true);
        expect([toggle.getAttribute('aria-expanded'), inRecordBar(toggle)], `${how}: the toggle that has focus`).toEqual([String(expanded), recordBar]);
      };

      // Stacked, with no record open (the session's active row Cmd-clicked out of the selection): the
      // folded table is the folder bar on top, the same toolbar and toggle the expanded table shows,
      // so the toggle goes only because the pane changes slot, viewer then table or bar then viewer.
      expect(app.parts(), 'a new session').toEqual(BELOW);
      const active = app.pane().querySelectorAll('.selected-row');
      expect(active.map((r) => r.tagName), 'one active row').toEqual(['TR']);
      app.click(active[0], { metaKey: true });
      expect(app.viewer().querySelectorAll('.empty-doc-selection-dropzone'), 'no record open').toHaveLength(1);
      enterOnToggle('stacked, no record open, folded', ON_TOP, false, false);
      enterOnToggle('stacked, no record open, opened', BELOW, true, false);
      enterOnToggle('stacked, no record open, folded again', ON_TOP, false, false);
      enterOnToggle('stacked, no record open, opened again', BELOW, true, false);

      // With a record open (a row clicked): the table folds into the record bar on top, and the
      // bar's toggle opens it again below the viewer.
      expect(app.pane().querySelectorAll('.selected-row'), 'no active row yet').toEqual([]);
      const firstRow = [...liveElements(app.pane())].find((e) => e.tagName === 'TR' && e.parentElement?.tagName === 'TBODY');
      expect(firstRow, 'a row to open').toBeDefined();
      app.click(firstRow!);
      expect(app.viewer().querySelectorAll('.empty-doc-selection-dropzone'), 'a record open').toHaveLength(0);
      enterOnToggle('stacked, a record open, folded', ON_TOP, false, true);
      enterOnToggle('stacked, a record open, opened', BELOW, true, false);

      // Side by side, with a record open and then with none.
      app.menu('view:split-left-right');
      expect(app.parts(), 'side by side').toEqual(LEFT);
      enterOnToggle('side by side, a record open, folded', ON_TOP, false, true);
      enterOnToggle('side by side, a record open, opened', LEFT, true, false);
      const activeAgain = app.pane().querySelectorAll('.selected-row');
      expect(activeAgain.map((r) => r.tagName), 'one active row side by side').toEqual(['TR']);
      app.click(activeAgain[0], { metaKey: true });
      expect(app.viewer().querySelectorAll('.empty-doc-selection-dropzone'), 'no record open side by side').toHaveLength(1);
      enterOnToggle('side by side, no record open, folded', ON_TOP, false, false);
      enterOnToggle('side by side, no record open, opened', LEFT, true, false);
      // Back to a record open, for the menu and pointer checks below.
      const rowAgain = [...liveElements(app.pane())].find((e) => e.tagName === 'TR' && e.parentElement?.tagName === 'TBODY');
      app.click(rowAgain!);
      expect(app.viewer().querySelectorAll('.empty-doc-selection-dropzone'), 'a record open again').toHaveLength(0);

      // The control that folds the table keeps focus, not the toggle: folding from the View menu
      // while a viewer control has focus leaves focus there.
      app.menu('view:split-top-bottom');
      expect(app.parts()).toEqual(BELOW);
      const viewerControl = app.viewer().querySelectorAll('button')[0];
      expect(viewerControl?.tagName, 'a control in the viewer').toBe('BUTTON');
      app.focus(viewerControl);
      app.menu('view:toggle-doctable');
      expect(app.parts(), 'folded from the menu').toEqual(ON_TOP);
      expect(app.doc.activeElement === viewerControl, `folded from the menu: focus kept on the viewer control, not ${app.focusName()}`).toBe(true);
      app.menu('view:toggle-doctable');
      expect(app.parts(), 'opened from the menu').toEqual(BELOW);
      expect(app.doc.activeElement === viewerControl, `opened from the menu: focus kept on the viewer control, not ${app.focusName()}`).toBe(true);

      // A pointer click on the toggle while nothing has focus (a WebKit button takes none from a
      // click) leaves no keyboard focus to keep, and the fold moves none to the toggle.
      app.doc.focused = null;
      app.click(app.toggle());
      expect(app.parts(), 'folded by a click').toEqual(ON_TOP);
      expect(app.focusName(), 'folded by a click: focus left on the body').toBe('the body');
      app.click(app.toggle());
      expect(app.parts(), 'opened by a click').toEqual(BELOW);
      expect(app.focusName(), 'opened by a click: focus left on the body').toBe('the body');
    } finally {
      app.unmount();
    }
  });
});

describe('the Split Top / Bottom help text (BG-01M6SHDC)', () => {
  /** The wording the item kept after US-01M6S7T2 moved the table below the viewer. */
  const OLD = 'Stack the document table above the active sequence viewer canvas';

  /**
   * Where a description puts the two panes, as `viewer up`, `table down` and so on. Each position
   * word places the pane named nearest before it in its sentence, and a pane named right after it
   * ("above the active sequence viewer") the other way.
   */
  const placements = (text: string) => {
    const said = new Set<string>();
    const isPane = (w: string) => w === 'viewer' || w === 'table';
    for (const sentence of text.toLowerCase().split(/[.;]/)) {
      const marks = [...sentence.matchAll(/\b(viewer|table|above|over|on top|below|beneath|under)\b/g)];
      marks.forEach((m, i) => {
        if (isPane(m[1])) return;
        const up = ['above', 'over', 'on top'].includes(m[1]);
        const before = marks.slice(0, i).reverse().find((p) => isPane(p[1]));
        if (before) said.add(`${before[1]} ${up ? 'up' : 'down'}`);
        const next = marks[i + 1];
        const gap = next ? sentence.slice(m.index! + m[0].length, next.index) : '';
        if (next && isPane(next[1]) && /^(\s+(of|the|active|sequence|document|project))*\s+$/.test(gap)) said.add(`${next[1]} ${up ? 'down' : 'up'}`);
      });
    }
    return said;
  };
  /** The viewer on top and the table below it, and nothing placed the other way. */
  const VIEWER_ABOVE_TABLE = new Set(['viewer up', 'table down']);

  it('describes Split Top / Bottom as the viewer above the table', () => {
    // The reader tells the wordings apart: the old one puts the table on top, and a wording that
    // says the right thing once and the wrong thing elsewhere is not the right placement.
    expect(placements(OLD), 'the old wording').toEqual(new Set(['table up', 'viewer down']));
    expect(placements('Stack the sequence viewer on top, with the document table above the viewer'), 'a contradiction').not.toEqual(VIEWER_ABOVE_TABLE);

    // The call the menu makes for the hovered item (CascadingMenu's tooltip), with the item's id and label.
    const text = resolveMenuNodeFunctionDescription('view-split-tb', 'Split Top / Bottom');
    expect(placements(text), `"${text}"`).toEqual(VIEWER_ABOVE_TABLE);
    expect(text).not.toBe(OLD);

    // The item the App puts in View > Split & Expand is that id and label, with no description of
    // its own, so this text is the one a researcher reads on it.
    const node = menuNode(driveApp([started]).menus, 'view-split-tb');
    if (node.kind !== 'checkbox') throw new Error('Split Top / Bottom is not a checkbox item');
    expect([node.label, node.description], 'the item').toEqual(['Split Top / Bottom', undefined]);
    expect(resolveMenuNodeFunctionDescription(node.id, node.label, node.description, false), 'the item\'s own fields').toBe(text);

    // And choosing it does what the text says, from each layout where it changes something: side by
    // side with the table shown or folded, and stacked with it folded.
    const choose: Step = (menus) => {
      const item = menuNode(menus, 'view-split-tb');
      if (item.kind !== 'checkbox') throw new Error('Split Top / Bottom is not a checkbox item');
      item.onToggle();
    };
    for (const [how, steps] of [
      ['from side by side', [started, sideBySide]],
      ['from side by side, table folded', [started, sideBySide, toggleTable]],
      ['from stacked, table folded', [started, toggleTable]],
    ] as const) {
      expect(stack(driveApp(steps).root).parts, `${how}, before`).not.toEqual(['viewer', 'handle', 'table']);
      const chosen = driveApp([...steps, choose]);
      expect(stack(chosen.root).parts, `${how}: the viewer, then the handle, then the table`).toEqual(['viewer', 'handle', 'table']);
      const after = menuNode(chosen.menus, 'view-split-tb');
      expect(after.kind === 'checkbox' && after.checked, `${how}: the item is checked`).toBe(true);
    }
  });
});
