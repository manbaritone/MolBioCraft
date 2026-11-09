// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TDGW AC3 and AC5 (D0096): the colour scheme a protein alignment is drawn in, on a live
 * studio mount.
 *
 * The scheme the grid shows is set by the studio's effects - the open-document effect gives each
 * document its molecule type's default, and a guard replaces a scheme the molecule type is not
 * offered with that default - and server-side rendering never runs an effect. So every check here
 * mounts the real studio with React DOM's client renderer, the renderer the app runs, using the
 * live tree of alignmentPaneResize.test.tsx (the repo carries no DOM library): a few node
 * operations, events dispatched through them, animation frames and resize observers run until the
 * page is still. Layout is not under test here, so the browser's layout is a fixed model of a
 * 1000px split layout with a 264px side panel, which leaves the grid room to draw its residues.
 *
 * What the grid shows is read two ways: the colour of each residue cell, and the scheme the studio
 * hands the grid to draw with. Both are needed. A protein cell takes Zappo's colour under any
 * scheme name the colour function does not know (its fallback for a protein is Zappo), so a scheme
 * the studio no longer offers, left in place, still paints Zappo cells; only the scheme the grid is
 * handed tells it apart.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

/** The scheme the studio last handed the alignment grid, recorded by a pass-through wrapper. */
const probe = vi.hoisted(() => ({ schemes: [] as string[] }));
vi.mock('../components/AlignmentCanvas', async (importOriginal) => {
  const real = await importOriginal<typeof import('../components/AlignmentCanvas')>();
  const React = await import('react');
  const Recorded = (props: Parameters<typeof real.AlignmentCanvas>[0]) => {
    probe.schemes.push(props.settings.colorScheme);
    return React.createElement(real.AlignmentCanvas, props);
  };
  return { ...real, AlignmentCanvas: Recorded };
});

afterEach(() => {
  vi.unstubAllGlobals();
  probe.schemes.length = 0;
});

// Each test starts the app afresh (its modules loaded anew), so each is given the minute a test
// may take rather than the 5s default a loaded machine can exceed.
vi.setConfig({ testTimeout: 60_000 });

// ─── The browser's layout, as a fixed model ───

const SPLIT_PX = 1000;
const PANEL_PX = 264;
/** The inspector's icon rail, and the side panel's handle with its rule, beside the panel. */
const RAIL_PX = 34;
const HANDLE_PX = 6;
const GRID_CLASSES = ['mbc-aln-canvas-pane', 'mbc-aln-canvas-root', 'mbc-aln-scroll-frame', 'mbc-aln-scroll'];

/** The width an element is laid out at; 0 for a box the model does not lay out. */
function widthOf(el: LiveElement): number {
  if (el.classList.contains('mbc-aln-split-layout')) return SPLIT_PX;
  if (el.classList.contains('mbc-aln-inspector-body')) return PANEL_PX;
  if (GRID_CLASSES.some((c) => el.classList.contains(c))) return SPLIT_PX - PANEL_PX - RAIL_PX - HANDLE_PX;
  return 0;
}

// ─── A live tree for React DOM's client renderer (as in alignmentPaneResize.test.tsx) ───

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
    const height = this.clientHeight;
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

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
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

/** Starts the app: its modules loaded afresh, as on a launch. */
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
 * Mounts the studio in a live tree. Every step runs in act, so the renders and effects it causes
 * have run when it returns, then lets the page lay out (frames, resize observers) until it is still.
 */
function mount(app: AppRun, props: StudioProps) {
  const doc = new LiveDocument();
  const frames = new Frames();
  const observers = new LiveResizeObservers();
  const storage = memoryStorage();
  const win = Object.assign(new LiveEventTarget(), {
    document: doc,
    HTMLIFrameElement: class {},
    localStorage: storage,
    navigator: globalThis.navigator,
    innerWidth: 1280,
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
  vi.stubGlobal('localStorage', storage);
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
  const dispatch = (target: LiveNode, type: string, init: Record<string, unknown> = {}) => {
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
  };

  app.act(() => root.render(app.React.createElement(app.Studio, props)));
  settle();

  const ui = {
    /** The side panel's Colors select: the one select offering a molecule type's default scheme (Zappo or ACGT - Default). */
    schemeSelect: () => {
      const found = container.querySelectorAll('select').filter((s) => s.options.some((o) => ['Zappo', 'ACGT - Default'].includes(o.getAttribute('value') ?? '')));
      expect(found, 'one Colors select').toHaveLength(1);
      return found[0];
    },
    /** The select now holds `value`, as after the user picks it, and reports the change. */
    setScheme: (value: string) => {
      const select = ui.schemeSelect();
      (select as unknown as { value: string }).value = value;
      dispatch(select, 'change');
    },
    /** The background of every grid cell showing `ch`, which the grid draws alike. */
    cellBackground: (ch: string) => {
      const drawn = new Set(container.querySelectorAll('.mbc-aln-cell').filter((c) => c.textContent === ch).map((c) => String(c.style.background)));
      expect(drawn.size, `the grid draws "${ch}", and every "${ch}" alike (${[...drawn].join(', ')})`).toBe(1);
      return [...drawn][0];
    },
    /** Opens the Colors legend with its Legend button and returns the note under its swatches ('' when it shows none). */
    legendNote: () => {
      const buttons = container.querySelectorAll('button').filter((b) => b.textContent === 'Legend');
      expect(buttons, 'one Legend button').toHaveLength(1);
      if (buttons[0].getAttribute('aria-expanded') !== 'true') dispatch(buttons[0], 'click');
      const legends = container.querySelectorAll('[aria-label="Color legend"]');
      expect(legends, 'the Legend button opens one colour legend').toHaveLength(1);
      return legends[0].querySelectorAll('.mbc-aln-hint').map((h) => h.textContent).join(' ');
    },
    /** The scheme the studio last handed the grid to draw with. */
    gridScheme: () => {
      expect(probe.schemes.length, 'the studio drew the alignment grid').toBeGreaterThan(0);
      return probe.schemes[probe.schemes.length - 1];
    },
    unmount: () => app.act(() => root.unmount()),
  };
  return ui;
}

// ─── A protein alignment: three members carrying every Zappo group ───

const MEMBERS = [
  { name: 'Homo sapiens', seq: 'MKDERHSTNQILVAFWYPGCKDERHSTNQILVAF' },
  { name: 'Mus musculus', seq: 'MKDERHSTNQILVAFWYPGCKDEKHSTNQILVAF' },
  { name: 'Danio rerio', seq: 'MKDERHSTNQLLVAFWYPGCRDERHSTNQILVAF' },
];
const PROTEIN: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT, id: 'live-scheme-protein', name: 'Live scheme protein alignment', sequence: MEMBERS[0].seq,
  folder: 'Alignments', moleculeType: 'Protein', documentKind: 'alignment',
  alignmentMeta: { isAligned: true, sequences: MEMBERS.map((m, i) => ({ id: `live-scheme-${i}`, name: m.name, sequence: m.seq })) },
} as unknown as SequenceDocument;
const studioProps = (doc: SequenceDocument): StudioProps =>
  ({ documents: [doc], projectDocuments: [doc], activeDoc: doc }) as StudioProps;

/**
 * Zappo's cells as the grid washes them (alpha 0x66 over the canvas), read off a live mount: the
 * Negative group (D, E) is pure red #ff0000 and the Positive group (K, R, H) #6464ff (Jalview,
 * Colour Schemes > Zappo).
 */
const ZAPPO_CELLS: Record<string, string> = { D: '#ff000066', E: '#ff000066', K: '#6464ff66', R: '#6464ff66', H: '#6464ff66' };
/** The removed scheme's name, built here because AC1 bars its literal from src. */
const REMOVED = 'ARND*'.split('').join(' ');

function expectZappoGrid(ui: ReturnType<typeof mount>, when: string) {
  expect(ui.gridScheme(), `${when}: the grid is drawn in Zappo`).toBe('Zappo');
  for (const [ch, bg] of Object.entries(ZAPPO_CELLS)) {
    expect(ui.cellBackground(ch), `${when}: "${ch}" is drawn in Zappo's colour`).toBe(bg);
  }
}

describe('US-01M6TDGW: the scheme a protein alignment is drawn in, on a live studio mount', () => {
  it('a protein alignment opens in Zappo on a live studio mount', async () => {
    // Wrong implementations this fails: the open-document effect, which runs on mount after the
    // first render, giving a protein any scheme but Zappo (Clustal, say, as mutant C8 does); and a
    // default protein scheme other than Zappo. Server-side rendering never runs that effect, so
    // only a live mount sees the scheme it sets.
    const ui = mount(await startApp(), studioProps(PROTEIN));
    expectZappoGrid(ui, 'on opening');
    ui.unmount();
  });

  it('a scheme the studio no longer offers is replaced by the default', async () => {
    // Wrong implementations this fails: the studio's guard, which replaces a scheme the molecule
    // type is not offered with that type's default, disabled or not run (mutant C9), and so the
    // removed scheme kept; and the guard putting anything but Zappo in its place for a protein.
    // The grid's cells alone cannot tell: a protein cell takes Zappo's colour under any scheme
    // name the colour function does not know, so the scheme the grid is handed is read too.
    const ui = mount(await startApp(), studioProps(PROTEIN));
    expectZappoGrid(ui, 'on opening');

    // The select reaches the studio: picking Clustal redraws the grid in Clustal. Without this, a
    // change that never reached the studio would leave Zappo in place and pass the check below.
    ui.setScheme('Clustal');
    expect(ui.gridScheme(), 'after picking Clustal').toBe('Clustal');
    expect(ui.cellBackground('D'), 'after picking Clustal: "D" is no longer Zappo red').not.toBe(ZAPPO_CELLS.D);

    // The removed scheme, which no list offers any more, set on the studio: Zappo replaces it.
    expect(ui.schemeSelect().options.map((o) => o.getAttribute('value')), 'the removed scheme is not offered').not.toContain(REMOVED);
    ui.setScheme(REMOVED);
    expectZappoGrid(ui, 'after the removed scheme is set');
    ui.unmount();
  });
});

// ─── A coding alignment, for By Translation ───

const CODING = ['ATGGCTAGCAAGGAGGAACTGTTCACCGGC', 'ATGGCTAGCAAGGAGGAACTGTTTACCGGC', 'ATGGCAAGCAAGGAGGAACTGTTCACCGGT'];
const NUCLEOTIDE: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT, id: 'live-scheme-coding', name: 'Live scheme coding alignment', sequence: CODING[0],
  folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
  alignmentMeta: { isAligned: true, sequences: CODING.map((seq, i) => ({ id: `live-coding-${i}`, name: `Coding ${i + 1}`, sequence: seq })) },
} as unknown as SequenceDocument;

describe('BG-01M6XP1Q: the By Translation legend, on a live studio mount', () => {
  it('the by translation legend names the zappo palette', async () => {
    // Wrong implementations this fails: the legend note under By Translation naming any palette
    // but Zappo (mutant C13 of US-01M6TDGW's review), or saying nothing of the palette. By
    // Translation colours a codon by its amino acid's Zappo colour (alignmentViewModel.ts,
    // residueSolidColor), so the note must name Zappo.
    const ui = mount(await startApp(), studioProps(NUCLEOTIDE));
    ui.setScheme('By Translation');
    expect(ui.gridScheme(), 'the pick reached the studio').toBe('By Translation');
    const note = ui.legendNote();
    expect(note).toBe('Codons are coloured by the encoded amino acid (Zappo palette).');
    // Read as a palette name too, so the check says what it is about if the wording changes.
    expect([...note.matchAll(/\b(\w[\w -]*?) palette\b/g)].map((m) => m[1]), 'the one palette the note names').toEqual(['Zappo']);
    ui.unmount();
  });
});
