// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6S7QS: the alignment studio's side panel and the MSA grid's sequence name and identity
 * column are resized by dragging their handles, or with the arrow keys, within bounds; both widths
 * stay as set across the studio's views and are restored after a restart from local storage.
 *
 * Bounds, as approved for this story: a dragged side panel is 300 to 720px wide and never leaves the
 * alignment grid under 360px; until it is dragged the panel keeps its responsive width (264px on a
 * settings tab, clamp(264px, 40vw, 520px) with an analysis open). The name column is 160 to 480px,
 * 248px by default, and always leaves the grid 120px of residues.
 *
 * Every check mounts the real studio with React DOM's client renderer, the renderer the app runs.
 * The repo carries no DOM library (jsdom, happy-dom), so, as in documentTableBottom.test.tsx, the
 * tree is a few node operations, and a drag is the pointer's own events: a press on the handle, then
 * moves and a release anywhere in the window. The browser's layout is a model at a 1280x800 window:
 * the widths the stylesheet gives the side panel and the name column are read from App.css (the
 * rules that apply there, in cascade order) and from the custom properties the studio sets, and the
 * grid takes the rest of the split layout. A ResizeObserver delivers a changed box after each step,
 * as a browser does after laying the page out, and animation frames run then too. A restart is a
 * fresh load of the studio's modules over the same local storage.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

const STORAGE_KEY = 'molbiocraft.alignment.paneWidths.v1';
const VIEWPORT_W = 1280;
/** The inspector's icon rail, and the side panel's handle with its rule, beside the panel. */
const RAIL_PX = 34;
const HANDLE_PX = 6;
/**
 * The split layout's width: in the 1280x800 window beside the Project Explorer, and one wide enough
 * that the panel's 720px maximum, not the grid's 360px, is the bound a drag meets.
 */
const DESK_SPLIT_PX = 1000;
const WIDE_SPLIT_PX = 1400;

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test starts the app afresh (its modules and the engine loaded anew), some several times, so
// each is given the minute a test may take rather than the 5s default a loaded machine can exceed.
vi.setConfig({ testTimeout: 60_000 });

// ─── App.css, as the cascade applies it in a 1280x800 window ───

const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as { readFileSync: (p: URL, enc: string) => string };
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');

interface CssRule { selectors: string[]; decls: [string, string][]; media: string[]; order: number }
function cssRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const open: string[] = [];
  let prelude = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') {
      const head = prelude.trim();
      prelude = '';
      if (head.startsWith('@')) {
        open.push(head);
        continue;
      }
      const end = source.indexOf('}', i);
      const decls = source.slice(i + 1, end).split(';').flatMap((d): [string, string][] => {
        const at = d.indexOf(':');
        return at > 0 ? [[d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()]] : [];
      });
      rules.push({ selectors: head.split(',').map((s) => s.trim()), decls, media: [...open], order: rules.length });
      i = end;
    } else if (c === '}') {
      open.pop();
      prelude = '';
    } else if (c === ';') {
      prelude = '';
    } else {
      prelude += c;
    }
  }
  return rules;
}
const RULES = cssRules(APP_CSS);

/** Whether an at-rule's condition holds in a light-theme 1280x800 window with no motion or contrast preference. */
function atRuleHolds(at: string): boolean {
  if (at.startsWith('@supports') || at.startsWith('@layer')) return true;
  if (!at.startsWith('@media')) return false;
  return at.slice('@media'.length).split(',').some((alt) => {
    const features = [...alt.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (!features.length) return /^\s*(screen|all)?\s*$/.test(alt);
    return features.every((f) => {
      const m = /^(min|max)-(width|height):\s*([\d.]+)px$/.exec(f);
      if (!m) return false;
      const size = m[2] === 'width' ? VIEWPORT_W : 800;
      return m[1] === 'min' ? size >= Number(m[3]) : size <= Number(m[3]);
    });
  });
}

interface Compound { tag?: string; classes: string[] }
const compound = (c: string): Compound => ({
  tag: /^[a-z]/i.test(c) ? c.split('.')[0].toLowerCase() : undefined,
  classes: [...c.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
});
/**
 * Whether a selector of tags, classes and descendant or child combinators matches the element at the
 * end of `chain` (outermost first). A selector with any other part (a state, an attribute, a
 * sibling) is not read, so hover and focus rules never count.
 */
function selectorMatches(selector: string, chain: LiveElement[]): { specificity: number } | null {
  if (/[:[#*~+]/.test(selector)) return null;
  const parts = selector.replace(/>/g, ' ').trim().split(/\s+/).map(compound);
  const fits = (e: LiveElement, p: Compound) => p.classes.every((k) => e.classList.contains(k)) && (!p.tag || p.tag === e.tagName.toLowerCase());
  let at = chain.length - 1;
  if (!fits(chain[at], parts[parts.length - 1])) return null;
  for (let pi = parts.length - 2; pi >= 0; pi--) {
    at--;
    while (at >= 0 && !fits(chain[at], parts[pi])) at--;
    if (at < 0) return null;
  }
  return { specificity: parts.reduce((n, p) => n + p.classes.length * 10 + (p.tag ? 1 : 0), 0) };
}

/** The value of `prop` the cascade gives `el` from App.css in a 1280x800 window, or undefined. */
function cascaded(el: LiveElement, prop: string): string | undefined {
  const chain: LiveElement[] = [];
  for (let n: LiveNode | null = el; n instanceof LiveElement; n = n.parentNode) chain.unshift(n);
  let best: { important: boolean; specificity: number; order: number; value: string } | undefined;
  for (const rule of RULES) {
    if (!rule.media.every(atRuleHolds)) continue;
    for (const selector of rule.selectors) {
      const hit = selectorMatches(selector, chain);
      if (!hit) continue;
      for (const [name, raw] of rule.decls) {
        let value: string | undefined;
        if (name === prop) value = raw;
        else if (prop === 'flex-basis' && name === 'flex') {
          const v = raw.replace(/\s*!important$/, '').trim().split(/\s+/);
          value = v.length === 3 ? v[2] : v[0] === 'none' || v[0] === 'auto' ? 'auto' : '0%';
        }
        if (value === undefined) continue;
        const important = /!important$/.test(value);
        const cand = { important, specificity: hit.specificity, order: rule.order, value: value.replace(/\s*!important$/, '').trim() };
        const beats = !best
          || (cand.important !== best.important ? cand.important
            : cand.specificity !== best.specificity ? cand.specificity > best.specificity
              : cand.order >= best.order);
        if (beats) best = cand;
      }
    }
  }
  return best?.value;
}

/** A CSS length in pixels, its custom properties read from the inline styles of the element and its ancestors. */
function resolvePx(value: string, el: LiveElement): number {
  const v = value.trim();
  let m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (m) {
    for (let n: LiveNode | null = el; n instanceof LiveElement; n = n.parentNode) {
      const set = n.style.getPropertyValue(m[1]);
      if (set) return resolvePx(set, el);
    }
    if (m[2] === undefined) throw new Error(`${m[1]} is set on no ancestor of <${el.tagName} class="${el.getAttribute('class')}"> and has no fallback`);
    return resolvePx(m[2], el);
  }
  m = /^clamp\((.+)\)$/.exec(v);
  if (m) {
    const [lo, mid, hi] = m[1].split(',').map((p) => resolvePx(p, el));
    return Math.min(hi, Math.max(lo, mid));
  }
  m = /^(-?[\d.]+)px$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(-?[\d.]+)vw$/.exec(v);
  if (m) return (Number(m[1]) * VIEWPORT_W) / 100;
  throw new Error(`the layout model reads no length like "${v}"`);
}

// ─── The browser's layout, modelled ───

const closestByClass = (el: LiveElement, cls: string): LiveElement | null => {
  for (let n: LiveNode | null = el; n instanceof LiveElement; n = n.parentNode) if (n.classList.contains(cls)) return n;
  return null;
};

/** The side panel's width: the inline size App.css gives its body. */
function panelBodyPx(body: LiveElement): number {
  const size = cascaded(body, 'inline-size');
  if (!size) throw new Error('App.css gives the side panel no width');
  return resolvePx(size, body);
}

/** The width an element is laid out at, in the model's 1280x800 window; 0 for a box the model does not lay out. */
function widthOf(el: LiveElement): number {
  const doc = el.ownerDocument!;
  if (el.classList.contains('mbc-aln-split-layout')) return doc.splitPx;
  const split = closestByClass(el, 'mbc-aln-split-layout');
  if (!split) return 0;
  const body = split.querySelector('.mbc-aln-inspector-body');
  if (!body) throw new Error('the split layout has no side panel');
  const bodyPx = panelBodyPx(body);
  if (el === body) return bodyPx;
  if (['mbc-aln-canvas-pane', 'mbc-aln-canvas-root', 'mbc-aln-scroll-frame', 'mbc-aln-scroll'].some((c) => el.classList.contains(c))) {
    return doc.splitPx - bodyPx - RAIL_PX - HANDLE_PX;
  }
  // The figures fill the panel inside its padding (the gel inside its box's too).
  if (el.getAttribute('id') === 'mbc-virtual-gel-svg') return bodyPx - 40;
  if (el.classList.contains('mbc-aln-lengths-chart')) return bodyPx - 20;
  return 0;
}

// ─── A live tree for React DOM's client renderer ───

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
  /** The descendants a selector list matches: `tag`, `.class` and `[attr="value"]` parts only. */
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
/** An inline style: properties React writes by name, and custom properties it writes with setProperty. */
class LiveStyle {
  [prop: string]: unknown;
  private readonly custom = new Map<string, string>();
  setProperty(name: string, value: string | null) {
    if (value === null || value === '') this.custom.delete(name);
    else this.custom.set(name, String(value));
  }
  removeProperty(name: string) { this.custom.delete(name); return ''; }
  getPropertyValue(name: string) { return this.custom.get(name) ?? (typeof this[name] === 'string' ? (this[name] as string) : ''); }
}
class LiveElement extends LiveNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = new LiveStyle();
  scrollLeft = 0;
  scrollTop = 0;
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
  /** An input's type, which React DOM reads to choose the event a checkbox reports a change on. */
  get type() { return this.getAttribute('type') ?? ''; }
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
  get clientWidth() { return widthOf(this); }
  get clientHeight() { return this.classList.contains('mbc-aln-scroll') ? 420 : 0; }
  get scrollWidth() { return this.clientWidth; }
  get scrollHeight() { return this.clientHeight; }
  getBoundingClientRect() {
    const width = widthOf(this);
    const height = this.getAttribute('id') === 'mbc-virtual-gel-svg' ? (width * 340) / 480 : this.clientHeight;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height };
  }
  /** The mini-map's canvas: no 2D context, so it draws nothing. */
  getContext() { return null; }
  scrollTo() {}
  scrollBy() {}
  scrollIntoView() {}
  get options(): LiveElement[] { return [...liveElements(this)].filter((e) => e.tagName === 'OPTION'); }
}
class LiveDocument extends LiveNode {
  focused: LiveElement | null = null;
  readonly documentElement: LiveElement;
  readonly head: LiveElement;
  readonly body: LiveElement;
  constructor(public splitPx: number) {
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

/** Animation frames, run when the test lets the page lay out. */
class Frames {
  private next = 1;
  readonly queue = new Map<number, () => void>();
  request = (fn: () => void) => { const id = this.next++; this.queue.set(id, fn); return id; };
  cancel = (id: number) => { this.queue.delete(id); };
}
/** Resize observers, which hear of every observed box whose size changed since they last heard. */
class LiveResizeObservers {
  readonly live = new Set<{ cb: (entries: unknown[], o: unknown) => void; seen: Map<LiveElement, number> }>();
  readonly Ctor = (() => {
    const all = this.live;
    return class {
      private readonly me: { cb: (entries: unknown[], o: unknown) => void; seen: Map<LiveElement, number> };
      constructor(cb: (entries: unknown[], o: unknown) => void) { this.me = { cb, seen: new Map() }; all.add(this.me); }
      observe(el: LiveElement) { this.me.seen.set(el, Number.NaN); }
      unobserve(el: LiveElement) { this.me.seen.delete(el); }
      disconnect() { this.me.seen.clear(); all.delete(this.me); }
    };
  })();
}

const memoryStorage = (seed: Record<string, string> = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
};
type Storage = ReturnType<typeof memoryStorage>;
/** Storage a sandboxed webview refuses: every call throws. */
const blockedStorage = (): Storage => {
  const refuse = () => { throw new Error('SecurityError: storage is blocked'); };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, length: 0, key: refuse } as unknown as Storage;
};

// ─── The app: started, and the studio mounted in it ───

type StudioModule = typeof import('../components/AlignmentAndPhyloStudio');
interface AppRun {
  React: typeof import('react');
  /** Runs a step and all the work React schedules from it (renders, effects, the updates effects make). */
  act: (step: () => void) => void;
  createRoot: typeof import('react-dom/client').createRoot;
  Studio: StudioModule['SequenceAlignmentStudio'];
}

/** Starts the app: its modules loaded afresh, as on a launch, so nothing but local storage carries over from a run before. */
async function startApp(): Promise<AppRun> {
  vi.resetModules();
  const [React, ReactDomClient, studio] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../components/AlignmentAndPhyloStudio'),
  ]);
  const act = (step: () => void) => {
    void React.act(step);
  };
  return { React, act, createRoot: ReactDomClient.createRoot, Studio: studio.SequenceAlignmentStudio };
}

type StudioProps = Parameters<AppRun['Studio']>[0];

/**
 * Mounts the studio in a live tree in a 1280x800 window whose split layout is `splitPx` wide, over
 * `storage`. Every step runs in act, so the renders and effects it causes have run when it returns,
 * then lets the page lay out (frames, resize observers) until it is still, as a browser has before
 * the next input.
 */
function mount(app: AppRun, props: StudioProps, opts: { splitPx?: number; storage: Storage }) {
  const doc = new LiveDocument(opts.splitPx ?? DESK_SPLIT_PX);
  const frames = new Frames();
  const observers = new LiveResizeObservers();
  const win = Object.assign(new LiveEventTarget(), {
    document: doc,
    HTMLIFrameElement: class {},
    localStorage: opts.storage,
    navigator: globalThis.navigator,
    innerWidth: VIEWPORT_W,
    innerHeight: 800,
    devicePixelRatio: 1,
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', opts.storage);
  vi.stubGlobal('requestAnimationFrame', frames.request);
  vi.stubGlobal('cancelAnimationFrame', frames.cancel);
  vi.stubGlobal('ResizeObserver', observers.Ctor);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = app.createRoot(container as unknown as Element);

  const settle = () => {
    for (let round = 0; round < 30; round++) {
      let busy = false;
      const due = [...frames.queue.entries()];
      frames.queue.clear();
      for (const [, fn] of due) { busy = true; app.act(fn); }
      for (const o of [...observers.live]) {
        const changed = [...o.seen.entries()].filter(([el, was]) => widthOf(el) !== was).map(([el]) => el);
        if (!changed.length) continue;
        busy = true;
        for (const el of changed) o.seen.set(el, widthOf(el));
        app.act(() => o.cb(changed.map((target) => ({ target, contentRect: target.getBoundingClientRect() })), o));
      }
      if (!busy) return;
    }
    throw new Error('the layout never settled');
  };
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
    app.act(() => {
      for (const t of [...path].reverse()) { if (stopped) break; t.fire(ev, true); }
      for (const t of path) { if (stopped) break; t.fire(ev, false); }
    });
    settle();
    return ev;
  };

  app.act(() => root.render(app.React.createElement(app.Studio, props)));
  settle();

  const all = (selector: string) => container.querySelectorAll(selector);
  const one = (selector: string, what = selector) => {
    const found = all(selector);
    expect(found, `one ${what}`).toHaveLength(1);
    return found[0];
  };
  const separator = (label: string) => one(`[role="separator"][aria-label="${label}"]`, `separator "${label}"`);
  const byText = (selector: string, label: string) => {
    const found = all(selector).filter((e) => e.textContent.trim() === label);
    expect(found, `one ${selector} reading "${label}"`).toHaveLength(1);
    return found[0];
  };
  let pointer = 0;
  const ui = {
    doc,
    container,
    all,
    one,
    separator,
    sidePanelHandle: () => separator('Resize the side panel'),
    nameHandle: () => separator('Resize the sequence name and identity column'),
    /** Presses a handle with the pointer at `x`; moves and the release go to the window, wherever the pointer is. */
    hold: (handle: LiveElement, x = 700) => {
      const pointerId = ++pointer;
      dispatch(handle, 'pointerdown', { clientX: x, clientY: 300, pointerId, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true });
      let at = x;
      return {
        moveBy: (dx: number) => { at = x + dx; dispatch(doc.body, 'pointermove', { clientX: at, clientY: 300, pointerId, pointerType: 'mouse', buttons: 1, isPrimary: true }); },
        release: () => { dispatch(doc.body, 'pointerup', { clientX: at, clientY: 300, pointerId, pointerType: 'mouse', isPrimary: true }); },
      };
    },
    drag: (handle: LiveElement, dx: number) => {
      const held = ui.hold(handle);
      held.moveBy(dx);
      held.release();
    },
    /** A key press on `el`, which takes focus first, as Tab gives it. */
    press: (el: LiveElement, key: string) => {
      el.focus();
      dispatch(el, 'keydown', { key, code: key });
      dispatch(el, 'keyup', { key, code: key });
    },
    click: (el: LiveElement) => dispatch(el, 'click', { detail: 1 }),
    doubleClick: (el: LiveElement) => dispatch(el, 'dblclick', { detail: 2 }),
    /** Ticks or clears a checkbox, as a click on it does. */
    setChecked: (input: LiveElement, checked: boolean) => {
      (input as unknown as { checked: boolean }).checked = checked;
      dispatch(input, 'click', { detail: 1 });
    },
    rail: (label: string) => one(`button[role="tab"][aria-label="${label}"]`, `rail tab ${label}`),
    mode: (label: string) => byText('button[role="tab"]', label),
    button: (label: string) => byText('button', label),
    buttonNamed: (label: string) => one(`button[aria-label="${label}"]`, `button ${label}`),
    shell: () => one('.mbc-aln-inspector-shell', 'side panel shell'),
    panelBody: () => one('.mbc-aln-inspector-body', 'side panel'),
    /** The side panel's laid-out width. */
    panelPx: () => panelBodyPx(ui.panelBody()),
    /** The alignment grid's laid-out width. */
    gridPx: () => widthOf(one('.mbc-aln-scroll', 'grid')),
    scroll: () => one('.mbc-aln-scroll', 'grid'),
    canvasRoot: () => one('.mbc-aln-canvas-root', 'grid root'),
    /** The width the stylesheet gives the grid's name cells: their flex basis, which a flex row lays them out at. */
    nameCellPx: () => {
      const cells = all('.mbc-aln-name');
      expect(cells.length, 'name cells').toBeGreaterThan(0);
      const widths = new Set(cells.map((c) => resolvePx(cascaded(c, 'flex-basis') ?? 'auto', c)));
      const sizes = new Set(cells.map((c) => resolvePx(cascaded(c, 'inline-size') ?? 'auto', c)));
      expect([...sizes], 'every name cell is as wide as its flex basis').toEqual([...widths]);
      expect(widths.size, 'every name cell is one width').toBe(1);
      return [...widths][0];
    },
    /** The width of every line of the grid, as the grid lays itself out. */
    lineWidths: () => all('.mbc-aln-line').map((l) => Number.parseFloat(String(l.style.width))),
    unmount: () => app.act(() => root.unmount()),
  };
  return ui;
}
type Ui = ReturnType<typeof mount>;

const num = (el: LiveElement, attr: string) => Number(el.getAttribute(attr));
const aria = (el: LiveElement) => ({ now: num(el, 'aria-valuenow'), min: num(el, 'aria-valuemin'), max: num(el, 'aria-valuemax') });
const storedWidths = (s: Storage) => JSON.parse(s.getItem(STORAGE_KEY) ?? 'null') as null | { sidePanelPx: number | null; nameColumnPx: number };

// ─── The alignment: six members named for their organisms, 600 columns ───

function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
const BASE = lettersFrom(0x51c0, 600);
const swap = (seq: string, col1: number) => seq.slice(0, col1 - 1) + ('ACGT'[('ACGT'.indexOf(seq[col1 - 1]) + 1) % 4]) + seq.slice(col1);
const LONG_NAME = 'Saccharomyces cerevisiae S288C mitochondrion COX2';
const MEMBERS = [
  // The first member disagrees with the consensus first at column 400; the others elsewhere.
  { name: LONG_NAME, seq: swap(BASE, 400) },
  { name: 'Drosophila melanogaster mitochondrion COX2', seq: swap(BASE, 120) },
  { name: 'Homo sapiens mitochondrion COX2', seq: swap(BASE, 230) },
  { name: 'Mus musculus domesticus mitochondrion COX2', seq: BASE },
  { name: 'Arabidopsis thaliana ecotype Columbia COX2', seq: swap(BASE, 515) },
  { name: 'Danio rerio mitochondrion COX2', seq: BASE },
];
function alignmentDoc(id: string): SequenceDocument {
  return {
    ...EMPTY_WORKSPACE_DOCUMENT, id, name: `${id} COX2 CDS`, sequence: BASE, folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
    alignmentMeta: { isAligned: true, sequences: MEMBERS.map((m, i) => ({ id: `${id}-${i}`, name: m.name, sequence: m.seq })) },
  } as unknown as SequenceDocument;
}
const COX2 = alignmentDoc('cox2');
const studioProps = (doc: SequenceDocument, more: Partial<StudioProps> = {}): StudioProps =>
  ({ documents: [doc], projectDocuments: [doc], activeDoc: doc, ...more }) as StudioProps;

/**
 * Whether a row's name shows in full: its label, at an average character width of 0.62 em (the
 * width the studio's charts space their text with), fits the cell beside the metric, inside the
 * cell's 8px padding on each side and its 6px gap (App.css .mbc-aln-name). Real glyph widths are
 * what AC5 observes in the built app.
 */
function nameShowsInFull(ui: Ui, label: string): { needPx: number; roomPx: number; fits: boolean } {
  const cell = ui.all('.mbc-aln-name').find((c) => c.querySelector('.mbc-aln-name-text')?.textContent.includes(label));
  if (!cell) throw new Error(`no name cell reads ${label}`);
  const text = cell.querySelector('.mbc-aln-name-text')!.textContent;
  const metric = cell.querySelector('.mbc-aln-name-metric')?.textContent ?? '';
  const fontPx = Number.parseFloat(String(cell.style.fontSize));
  const needPx = text.length * 0.62 * fontPx;
  const roomPx = ui.nameCellPx() - 16 - 6 - metric.length * 0.62 * 11;
  // Nothing else caps the name: the text may take all the room the cell gives it.
  expect(cascaded(cell.querySelector('.mbc-aln-name-text')!, 'max-inline-size') ?? 'none').toBe('none');
  expect(cascaded(cell.querySelector('.mbc-aln-name-text')!, 'max-width') ?? 'none').toBe('none');
  return { needPx, roomPx, fits: needPx <= roomPx };
}

// ─── AC1 ───

describe('resizes the side panel by dragging its handle within bounds', () => {
  it('lays the handle out between the grid and the panel, and gives a dragged width to the panel', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage(), splitPx: WIDE_SPLIT_PX });
    // The handle has its own column between the grid and the panel, and is drawn in this window.
    const split = ui.one('.mbc-aln-split-layout');
    expect(cascaded(split, 'grid-template-columns')).toBe('minmax(0, 1fr) auto auto');
    const kids = split.childNodes.filter((n): n is LiveElement => n instanceof LiveElement);
    expect(kids.map((k) => k.getAttribute('role') ?? k.getAttribute('class'))).toEqual(['mbc-aln-canvas-pane', 'separator', 'mbc-aln-inspector-shell']);
    expect(cascaded(ui.sidePanelHandle(), 'display') ?? 'block').not.toBe('none');
    // Before a drag the panel keeps its responsive width: 264px on a settings tab.
    expect(ui.shell().classList.contains('is-sized')).toBe(false);
    expect(ui.panelPx()).toBe(264);
    ui.unmount();
  });

  it('widens and narrows the panel within 300 and 720px, and the Lengths Graph refits as it goes', async () => {
    const app = await startApp();
    const storage = memoryStorage();
    const ui = mount(app, studioProps(COX2, { initialInspectorTab: 'lengths-graph' }), { storage, splitPx: WIDE_SPLIT_PX });
    const chartWidth = () => Number(ui.one('svg.mbc-aln-lengths-chart', 'lengths chart').getAttribute('viewBox')!.split(/\s+/)[2]);
    // With an analysis open the responsive width is clamp(264px, 40vw, 520px): 512px in a 1280px window.
    expect(ui.panelPx()).toBe(512);
    expect(chartWidth()).toBe(492);
    expect(aria(ui.sidePanelHandle()).now).toBe(512);

    const held = ui.hold(ui.sidePanelHandle());
    held.moveBy(-100); // leftwards widens the panel, which sits at the right
    // While held, the split layout is marked resizing (no hover restyles under the pointer), and so is the handle.
    expect(ui.one('.mbc-aln-split-layout').classList.contains('is-resizing')).toBe(true);
    expect(ui.sidePanelHandle().classList.contains('dragging')).toBe(true);
    expect(ui.shell().classList.contains('is-sized')).toBe(true);
    expect(ui.panelPx()).toBe(612);
    expect(aria(ui.sidePanelHandle()).now).toBe(612);
    expect(chartWidth(), 'the chart is drawn at the panel width while the handle is held').toBe(592);
    held.moveBy(-2000);
    expect(ui.panelPx(), 'no wider than 720px').toBe(720);
    expect(chartWidth()).toBe(700);
    held.moveBy(2000);
    expect(ui.panelPx(), 'no narrower than 300px').toBe(300);
    expect(chartWidth()).toBe(280);
    held.moveBy(-40);
    held.release();
    expect(ui.one('.mbc-aln-split-layout').classList.contains('is-resizing')).toBe(false);
    expect(ui.sidePanelHandle().classList.contains('dragging')).toBe(false);
    expect(ui.panelPx()).toBe(552);
    expect(chartWidth()).toBe(532);
    expect(ui.gridPx()).toBe(WIDE_SPLIT_PX - 552 - RAIL_PX - HANDLE_PX);
    // Once let go, the pointer moving no longer moves the panel.
    ui.hold(ui.one('.mbc-aln-status-footer')).moveBy(-300);
    expect(ui.panelPx()).toBe(552);
    ui.unmount();
  });

  it('refits the Virtual Gel to the dragged width, its labels never under 11px on screen', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2, { initialInspectorTab: 'virtual-gel' }), { storage: memoryStorage(), splitPx: WIDE_SPLIT_PX });
    const gel = () => ui.one('svg[id="mbc-virtual-gel-svg"]', 'gel');
    const labelSizes = () => [...new Set(gel().querySelectorAll('text').map((t) => Number(t.getAttribute('font-size'))))];
    const onScreen = () => labelSizes().map((u) => (u * widthOf(gel())) / 480);
    for (const [dx, panel] of [[-2000, 720], [2000, 300], [-150, 450]] as const) {
      ui.drag(ui.sidePanelHandle(), dx);
      expect(ui.panelPx()).toBe(panel);
      expect(labelSizes().length, 'the gel draws labels').toBeGreaterThan(0);
      for (const px of onScreen()) expect(px, `a gel label at a ${panel}px panel`).toBeGreaterThanOrEqual(11 - 1e-6);
    }
    // Drawn narrower, its labels are drawn larger in its own units, so they keep their size on screen.
    ui.drag(ui.sidePanelHandle(), -2000);
    const wide = Math.max(...labelSizes());
    ui.drag(ui.sidePanelHandle(), 2000);
    expect(Math.max(...labelSizes())).toBeGreaterThan(wide);
    ui.unmount();
  });

  it('never leaves the alignment grid under 360px', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage(), splitPx: DESK_SPLIT_PX });
    ui.drag(ui.sidePanelHandle(), -2000);
    // 1000px less the rail and the handle leaves 960px: the panel takes all but 360px of it.
    expect(ui.panelPx()).toBe(600);
    expect(ui.gridPx()).toBe(360);
    expect(aria(ui.sidePanelHandle()).max).toBe(600);
    ui.unmount();
  });

  it('is not widened from its responsive width by a move toward narrower', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage(), splitPx: WIDE_SPLIT_PX });
    const held = ui.hold(ui.sidePanelHandle());
    held.moveBy(30);
    expect(ui.shell().classList.contains('is-sized')).toBe(false);
    expect(ui.panelPx()).toBe(264);
    held.moveBy(-20); // past where it started: up to the 300px floor
    expect(ui.panelPx()).toBe(300);
    held.moveBy(10); // and back: the responsive width again
    expect(ui.panelPx()).toBe(264);
    held.release();
    ui.unmount();
  });
});

// ─── AC2 ───

describe('resizes the name and identity column by dragging its edge', () => {
  it('widens and narrows the column within 160 and 480px, and a long organism name then shows in full', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    expect(ui.nameCellPx()).toBe(248);
    const lineAt248 = Math.max(...ui.lineWidths());
    const before = nameShowsInFull(ui, LONG_NAME);
    expect(before.fits, `at 248px the name needs ${before.needPx}px and has ${before.roomPx}px`).toBe(false);

    const held = ui.hold(ui.nameHandle());
    held.moveBy(152); // rightwards widens the column
    expect(ui.nameCellPx()).toBe(400);
    expect(aria(ui.nameHandle()).now).toBe(400);
    expect(Math.max(...ui.lineWidths()), 'every line widens by what the column did').toBe(lineAt248 + 152);
    held.moveBy(2000);
    expect(ui.nameCellPx(), 'no wider than 480px').toBe(480);
    held.moveBy(-2000);
    expect(ui.nameCellPx(), 'no narrower than 160px').toBe(160);
    held.moveBy(212);
    held.release();
    expect(ui.nameCellPx()).toBe(460);
    const after = nameShowsInFull(ui, LONG_NAME);
    expect(after.fits, `at 460px the name needs ${after.needPx}px and has ${after.roomPx}px`).toBe(true);
    // The handle sits on the column's edge, wherever that is.
    expect(resolvePx(cascaded(ui.nameHandle(), 'inset-inline-start')!.replace(/^calc\((.+) - 3px\)$/, '$1'), ui.nameHandle())).toBe(460);
    ui.unmount();
  });

  it('fits the whole alignment to the window beside a wide column, without overflowing it', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    ui.drag(ui.nameHandle(), 2000);
    expect(ui.nameCellPx()).toBe(480);
    ui.click(ui.button('Fit'));
    const widest = Math.max(...ui.lineWidths());
    expect(widest, 'the fitted alignment overflows the grid').toBeLessThanOrEqual(ui.gridPx());
    expect(widest, 'the fitted alignment fills the grid').toBeGreaterThan(ui.gridPx() - 40);
    ui.unmount();
  });

  it('wraps the alignment within the grid beside a wide column', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    ui.drag(ui.nameHandle(), 2000);
    const wrap = ui.all('label').find((l) => l.querySelector('span')?.textContent === 'Wrap')?.querySelector('input');
    if (!wrap) throw new Error('the General tab has no Wrap checkbox');
    ui.setChecked(wrap, true);
    // Wrapped: no sticky ruler above the grid, and the alignment broken into blocks of columns.
    expect(ui.all('.mbc-aln-header')).toHaveLength(0);
    const tracks = ui.all('.mbc-aln-track.kind-seq');
    expect(tracks.length).toBeGreaterThan(0);
    expect(Math.max(...tracks.map((t) => Number.parseFloat(String(t.style.width))))).toBeLessThan(600 * 10.4);
    for (const w of ui.lineWidths()) expect(w, 'a wrapped line overflows the grid').toBeLessThanOrEqual(ui.gridPx());
    ui.unmount();
  });

  it('centres a column, renders the columns and draws the mini-map viewport for the visible residues beside the column', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    const cellsInFirstRow = () => ui.all('.mbc-aln-track.kind-seq')[0].querySelectorAll('.mbc-aln-cell').length;
    const viewportPct = () => Number.parseFloat(String(ui.one('.mbc-aln-minimap-viewport', 'mini-map viewport').style.width));
    const trackPx = () => Math.max(...ui.lineWidths()) - ui.nameCellPx() - 8;

    // Centring: the first member's first disagreement (column 400) is brought to the middle of the
    // residues shown beside the column, so a column 152px wider moves it 76px further along.
    ui.click(ui.buttonNamed('Next disagreement'));
    const at248 = ui.scroll().scrollLeft;
    expect(at248).toBeGreaterThan(0);
    // A zoom keeps the cursor column in the middle of those residues too (100% -> 125% and back).
    ui.click(ui.buttonNamed('Zoom in'));
    const zoomedAt248 = ui.scroll().scrollLeft;
    expect(zoomedAt248).toBeGreaterThan(at248);
    ui.click(ui.buttonNamed('Zoom out'));
    ui.drag(ui.nameHandle(), 152);
    await new Promise((r) => setTimeout(r, 5)); // a new scroll request: the next millisecond
    ui.click(ui.button('Cursor'));
    expect(ui.scroll().scrollLeft - at248).toBeCloseTo(76, 6);
    ui.click(ui.buttonNamed('Zoom in'));
    expect(ui.scroll().scrollLeft - zoomedAt248).toBeCloseTo(76, 6);
    ui.click(ui.buttonNamed('Zoom out'));

    // The mini-map's viewport is the share of the track shown beside the column.
    expect(viewportPct()).toBeCloseTo(((ui.gridPx() - 400) / trackPx()) * 100, 6);

    // Rendered columns: the narrower the column, the more residues each row renders.
    ui.scroll().scrollLeft = 0;
    ui.drag(ui.nameHandle(), -2000);
    expect(ui.nameCellPx()).toBe(160);
    const at160 = cellsInFirstRow();
    expect(viewportPct()).toBeCloseTo(((ui.gridPx() - 160) / trackPx()) * 100, 6);
    ui.drag(ui.nameHandle(), 2000);
    expect(ui.nameCellPx()).toBe(480);
    const at480 = cellsInFirstRow();
    // 320px more column hides about 29 columns of 10.4px letters (with their 10-column spaces).
    expect(at160 - at480).toBeGreaterThanOrEqual(25);
    ui.unmount();
  });

  it('leaves the grid 120px of residues beside the column, however wide the panel', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage(), splitPx: DESK_SPLIT_PX });
    ui.drag(ui.nameHandle(), 2000);
    expect(ui.nameCellPx()).toBe(480);
    ui.drag(ui.sidePanelHandle(), -2000);
    expect(ui.gridPx()).toBe(360);
    expect(ui.nameCellPx()).toBe(240);
    expect(aria(ui.nameHandle())).toEqual({ now: 240, min: 160, max: 240 });
    // The column keeps the width it was set to, and has it back when the panel gives the room back.
    ui.press(ui.sidePanelHandle(), 'Home');
    expect(ui.nameCellPx()).toBe(480);
    ui.unmount();
  });
});

// ─── AC3 ───

describe('exposes both handles as keyboard separators', () => {
  it('makes each handle a focusable separator that announces its width', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    for (const handle of [ui.sidePanelHandle(), ui.nameHandle()]) {
      expect(handle.getAttribute('tabindex')).toBe('0');
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      const { now, min, max } = aria(handle);
      expect([now, min, max].every(Number.isFinite)).toBe(true);
      expect(min).toBeLessThanOrEqual(now);
      expect(now).toBeLessThanOrEqual(max);
      expect(handle.getAttribute('aria-valuetext')).toBe(`${now} pixels wide`);
    }
    expect(aria(ui.sidePanelHandle()).now).toBe(ui.panelPx());
    expect(aria(ui.nameHandle()).now).toBe(ui.nameCellPx());
    ui.unmount();
  });

  it('steps the side panel 16px with the arrow keys, within its bounds, and Home restores its responsive width', async () => {
    const app = await startApp();
    const storage = memoryStorage();
    const ui = mount(app, studioProps(COX2, { initialInspectorTab: 'distances' }), { storage, splitPx: WIDE_SPLIT_PX });
    const h = ui.sidePanelHandle;
    expect(ui.panelPx()).toBe(512);
    ui.press(h(), 'ArrowLeft');
    expect(ui.panelPx()).toBe(528);
    expect(aria(h()).now).toBe(528);
    expect(h().getAttribute('aria-valuetext')).toBe('528 pixels wide');
    ui.press(h(), 'ArrowRight');
    ui.press(h(), 'ArrowRight');
    expect(ui.panelPx()).toBe(496);
    for (let i = 0; i < 20; i++) ui.press(h(), 'ArrowRight');
    expect(ui.panelPx()).toBe(300);
    expect(aria(h())).toEqual({ now: 300, min: 300, max: 720 });
    for (let i = 0; i < 40; i++) ui.press(h(), 'ArrowLeft');
    expect(ui.panelPx()).toBe(720);
    ui.press(h(), 'Home');
    expect(ui.shell().classList.contains('is-sized')).toBe(false);
    expect(ui.panelPx()).toBe(512);
    expect(storedWidths(storage)?.sidePanelPx).toBe(null);
    // On a settings tab the responsive 264px is under the floor: Right leaves it, Left takes it to 300px.
    ui.click(ui.rail('General'));
    ui.press(h(), 'ArrowRight');
    expect(ui.panelPx()).toBe(264);
    expect(ui.shell().classList.contains('is-sized')).toBe(false);
    ui.press(h(), 'ArrowLeft');
    expect(ui.panelPx()).toBe(300);
    // A double click restores the responsive width too.
    ui.doubleClick(h());
    expect(ui.panelPx()).toBe(264);
    ui.unmount();
  });

  it('steps the name column 16px with the arrow keys, within its bounds, and Home restores 248px', async () => {
    const app = await startApp();
    const ui = mount(app, studioProps(COX2), { storage: memoryStorage() });
    const h = ui.nameHandle;
    ui.press(h(), 'ArrowRight');
    expect(ui.nameCellPx()).toBe(264);
    expect(aria(h()).now).toBe(264);
    ui.press(h(), 'ArrowLeft');
    ui.press(h(), 'ArrowLeft');
    expect(ui.nameCellPx()).toBe(232);
    for (let i = 0; i < 20; i++) ui.press(h(), 'ArrowLeft');
    expect(ui.nameCellPx()).toBe(160);
    expect(aria(h())).toEqual({ now: 160, min: 160, max: 480 });
    for (let i = 0; i < 40; i++) ui.press(h(), 'ArrowRight');
    expect(ui.nameCellPx()).toBe(480);
    ui.press(h(), 'Home');
    expect(ui.nameCellPx()).toBe(248);
    ui.press(h(), 'ArrowRight');
    ui.doubleClick(h());
    expect(ui.nameCellPx()).toBe(248);
    // Other keys leave it alone.
    ui.press(h(), 'ArrowUp');
    ui.press(h(), 'a');
    expect(ui.nameCellPx()).toBe(248);
    ui.unmount();
  });
});

// ─── AC4 ───

describe('keeps both widths across view switches', () => {
  it('keeps them across the inspector tabs, the studio modes and the studio opened again', async () => {
    const app = await startApp();
    // Storage refuses every call, so only the open app can carry the widths from one view to the next.
    const storage = blockedStorage();
    let ui = mount(app, studioProps(COX2), { storage, splitPx: WIDE_SPLIT_PX });
    ui.drag(ui.sidePanelHandle(), -156); // 264 -> 420
    ui.drag(ui.nameHandle(), 112); // 248 -> 360
    const kept = () => {
      expect(ui.panelPx(), 'the side panel').toBe(420);
      expect(ui.nameCellPx(), 'the name column').toBe(360);
    };
    kept();
    // A dragged width sets the panel on every inspector tab, settings and analyses alike.
    for (const tab of ['Lengths Graph', 'Virtual Gel', 'Display', 'Substitution Distances', 'Statistics', 'General']) {
      ui.click(ui.rail(tab));
      expect(ui.one('button[role="tab"][aria-selected="true"][title="' + tab + '"]', `${tab} open`)).toBeTruthy();
      kept();
    }
    // The studio's modes: the grid gives way to another view, then comes back.
    for (const mode of ['Pairwise Alignment', 'Dotplot']) {
      ui.click(ui.mode(mode));
      expect(ui.all('.mbc-aln-split-layout'), `${mode}: the grid is gone`).toHaveLength(0);
      ui.click(ui.mode('Multiple Sequence Alignment (MSA)'));
      kept();
    }
    // Another document view unmounts the studio; opened again, on this or another alignment, it keeps them.
    ui.unmount();
    for (const doc of [COX2, alignmentDoc('other')]) {
      ui = mount(app, studioProps(doc), { storage, splitPx: WIDE_SPLIT_PX });
      kept();
      ui.unmount();
    }
  });
});

// ─── AC6 ───

describe('restores both widths after a restart', () => {
  it('keeps both widths in local storage, and a restarted app opens with them', async () => {
    const storage = memoryStorage();
    let ui = mount(await startApp(), studioProps(COX2), { storage, splitPx: WIDE_SPLIT_PX });
    expect(storage.getItem(STORAGE_KEY), 'nothing is written before a handle moves').toBe(null);
    const held = ui.hold(ui.sidePanelHandle());
    held.moveBy(-186); // 264 -> 450
    expect(storage.getItem(STORAGE_KEY), 'nothing is written while the handle is held').toBe(null);
    held.release();
    ui.press(ui.nameHandle(), 'ArrowRight'); // 248 -> 264
    ui.drag(ui.nameHandle(), 66); // -> 330
    expect(storedWidths(storage)).toEqual({ sidePanelPx: 450, nameColumnPx: 330 });
    ui.unmount();

    ui = mount(await startApp(), studioProps(COX2), { storage, splitPx: WIDE_SPLIT_PX });
    expect(ui.shell().classList.contains('is-sized')).toBe(true);
    expect(ui.panelPx()).toBe(450);
    expect(ui.nameCellPx()).toBe(330);
    expect(aria(ui.sidePanelHandle()).now).toBe(450);
    expect(aria(ui.nameHandle()).now).toBe(330);
    // A reset is kept too: the next launch opens at the responsive width.
    ui.press(ui.sidePanelHandle(), 'Home');
    ui.unmount();
    ui = mount(await startApp(), studioProps(COX2, { initialInspectorTab: 'lengths-graph' }), { storage, splitPx: WIDE_SPLIT_PX });
    expect(ui.shell().classList.contains('is-sized')).toBe(false);
    expect(ui.panelPx()).toBe(512);
    expect(ui.nameCellPx()).toBe(330);
    ui.unmount();
  });

  it('falls back to the default width for a missing, unreadable or out-of-bounds value', async () => {
    // The defaults: the panel's responsive width (264px on the General tab) and a 248px column. An
    // out-of-bounds value falls back to the default rather than being pulled to the nearest bound.
    const cases: { what: string; storage: Storage; panel: number; name: number }[] = [
      { what: 'nothing stored', storage: memoryStorage(), panel: 264, name: 248 },
      { what: 'not JSON', storage: memoryStorage({ [STORAGE_KEY]: '{"sidePanelPx": 450,' }), panel: 264, name: 248 },
      { what: 'not an object', storage: memoryStorage({ [STORAGE_KEY]: '"450"' }), panel: 264, name: 248 },
      { what: 'storage refuses', storage: blockedStorage(), panel: 264, name: 248 },
      { what: 'not numbers', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: '450', nameColumnPx: true }) }), panel: 264, name: 248 },
      { what: 'not finite', storage: memoryStorage({ [STORAGE_KEY]: '{"sidePanelPx": 1e999, "nameColumnPx": null}' }), panel: 264, name: 248 },
      { what: 'just under the bounds', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: 299, nameColumnPx: 159 }) }), panel: 264, name: 248 },
      { what: 'just over the bounds', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: 721, nameColumnPx: 481 }) }), panel: 264, name: 248 },
      { what: 'one value missing', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ nameColumnPx: 300 }) }), panel: 264, name: 300 },
      { what: 'one value out of bounds', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: 400, nameColumnPx: 9000 }) }), panel: 400, name: 248 },
      { what: 'both at their bounds', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: 300, nameColumnPx: 480 }) }), panel: 300, name: 480 },
      { what: 'both at their other bounds', storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ sidePanelPx: 720, nameColumnPx: 160 }) }), panel: 720, name: 160 },
    ];
    for (const c of cases) {
      const ui = mount(await startApp(), studioProps(COX2), { storage: c.storage, splitPx: WIDE_SPLIT_PX });
      expect(ui.panelPx(), `${c.what}: the side panel`).toBe(c.panel);
      expect(ui.shell().classList.contains('is-sized'), `${c.what}: the side panel is dragged`).toBe(c.panel !== 264);
      expect(ui.nameCellPx(), `${c.what}: the name column`).toBe(c.name);
      ui.unmount();
    }
  });
});
