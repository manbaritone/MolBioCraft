// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6T6HW: the Genomics studio ran whole-genome synteny, gene prediction and the CpG island
 * scan while it rendered, so every render that reached them held the UI thread for as long as they
 * took; on unrelated 5 Mb genomes synteny alone took 372-695 ms (D0061). None of the three runs
 * while React renders now. Each one's panel reads 'Scanning…' in place of its numbers until its
 * result lands, the scan runs in a task of its own scheduled after the frame showing that has been
 * committed, and the result names the input it was computed for. An input changed while a scan
 * waits or runs discards that scan's result, and a field that is not one of a scan's inputs starts
 * no new run of it. Work is counted, not timed (D0061).
 *
 * The studio is mounted with React's client renderer, the one the app runs, under fake timers and a
 * frame queue, so time and frames move only when a check moves them. As in repeatArmDebounce.test.tsx
 * the tree React writes to is a few node operations, with what React DOM's input, select and click
 * handling reads on top. The engine is the real WASM one. The three scans the studio calls are
 * wrapped in spies that record each call: its arguments, whether React was rendering a component
 * when it was made (read from React's own hooks dispatcher, which is a component's while React
 * renders it), and whether the scan's panel then read 'Scanning…'.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ScanName = 'synteny' | 'genes' | 'cpg';

/** What each spied scan call records, and the hooks a check sets to read the studio at that moment. */
const probe = vi.hoisted(() => ({
  calls: [] as { scan: 'synteny' | 'genes' | 'cpg'; args: unknown[]; inRender: boolean; panelScanning: boolean }[],
  /** Whether React is rendering a component now: installed when the studio is mounted. */
  inRender: (): boolean => {
    throw new Error('the render probe is not installed');
  },
  /** Whether the scan's panel reads 'Scanning…' in what React has committed: installed with the studio. */
  panelScanning: (_scan: string): boolean => false,
  /** Run inside a scan after the engine answers and before the scan returns: a change made while it runs. */
  during: null as null | ((scan: string, args: unknown[]) => void),
}));

// The three genome-scale scans the studio calls are the real engine calls, wrapped to record each
// call. Every other call, here and in the studio, goes to the engine unchanged.
vi.mock('../core/genomicsAndStructureSuite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/genomicsAndStructureSuite')>();
  function spied<A extends unknown[], R>(scan: 'synteny' | 'genes' | 'cpg', fn: (...args: A) => R) {
    return vi.fn((...args: A): R => {
      probe.calls.push({ scan, args, inRender: probe.inRender(), panelScanning: probe.panelScanning(scan) });
      const result = fn(...args);
      probe.during?.(scan, args);
      return result;
    });
  }
  return {
    ...actual,
    runWholeGenomeSynteny: spied('synteny', actual.runWholeGenomeSynteny),
    predictGlimmerMicrobialGenes: spied('genes', actual.predictGlimmerMicrobialGenes),
    findCpGIslands: spied('cpg', actual.findCpGIslands),
  };
});
import { runWholeGenomeSynteny } from '../core/genomicsAndStructureSuite';
import type { GenomicsSuiteSubTab } from '../components/GenomicsNgsAndPredictionStudio';
// Imported once the tree's window and document are in place (mountStudio): the studio loads React
// DOM through the shared inspector, and React DOM loaded first would ignore typing (D0081).
let GenomicsNgsAndPredictionStudio: typeof import('../components/GenomicsNgsAndPredictionStudio').GenomicsNgsAndPredictionStudio;
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

/** The engine with no spy in between: what each scan gives for an input, asked by the checks. */
const unspied = () => vi.importActual<typeof import('../core/genomicsAndStructureSuite')>('../core/genomicsAndStructureSuite');

/**
 * React's hooks dispatcher. While React renders a function component it is that render's own;
 * between components and outside a render it is React's idle one (null before the first render).
 */
const hooksDispatcher = (React as unknown as {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: { ReactCurrentDispatcher?: { current: unknown } };
}).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;

/** Deterministic pseudo-random bases (LCG), the same for the same seed. */
function randomBases(n: number, seed: number): string {
  let s = seed >>> 0;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[s >>> 30];
  }
  return out.join('');
}

/** A copy of `seq` with one base inserted every 150 bp: each insertion ends a collinear block. */
function withInsertions(seq: string): string {
  let out = '';
  for (let i = 0; i < seq.length; i += 150) out += seq.slice(i, i + 150) + (seq[i] === 'A' ? 'C' : 'A');
  return out;
}

const dna = (id: string, name: string, sequence: string): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA' });

// Genome A and a copy of it with an insertion every 150 bp (related), an unrelated genome C, a read
// of A, and a second unrelated genome D for the genes tab. Lengths all differ, so a length names its genome.
const genomeA = dna('a', 'Genome A', randomBases(12_000, 0x5eed_6001));
const genomeB = dna('b', 'Genome B', withInsertions(genomeA.sequence));
const genomeC = dna('c', 'Genome C', randomBases(12_500, 0x5eed_6002));
const read = dna('r', 'Read', genomeA.sequence.slice(3_000, 3_600));
const genomeD = dna('d', 'Genome D', randomBases(13_000, 0x5eed_6003));

const n = (v: number) => v.toLocaleString('en-US');
/** A list's count as the studio's captions give it. */
const listCount = (shown: number, total: number, rank: 'top' | 'first') => (shown < total ? `${rank} ${n(shown)} of ${n(total)}` : n(total));

// ─── The tree React DOM writes to ───

interface TestEvent { type: string; target: TestNode; defaultPrevented: boolean; [field: string]: unknown }
type TestListener = (ev: TestEvent) => void;
const isCapture = (options?: boolean | { capture?: boolean }) => options === true || (typeof options === 'object' && !!options?.capture);

/** The node operations React DOM's client renderer calls, as in repeatArmDebounce.test.tsx, with listeners it can be sent events through. */
class TestNode {
  childNodes: TestNode[] = [];
  parentNode: TestNode | null = null;
  readonly listeners: { type: string; fn: TestListener; capture: boolean }[] = [];
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: TestDocument | null) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get parentElement(): TestElement | null { return this.parentNode instanceof TestElement ? this.parentNode : null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t: string) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = t ? [new TestText(t, this.ownerDocument!)] : [];
  }
  appendChild(child: TestNode) { return this.insertBefore(child, null); }
  insertBefore(child: TestNode, before: TestNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  contains(other: TestNode | null) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener(type: string, fn: TestListener, options?: boolean | { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: isCapture(options) });
  }
  removeEventListener(type: string, fn: TestListener, options?: boolean | { capture?: boolean }) {
    const at = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === isCapture(options));
    if (at >= 0) this.listeners.splice(at, 1);
  }
  /** The elements under this node that `ok` accepts, in document order. */
  elements(ok: (e: TestElement) => boolean): TestElement[] {
    return this.childNodes.flatMap((c) => (c instanceof TestElement ? [...(ok(c) ? [c] : []), ...c.elements(ok)] : []));
  }
  /** Finds nothing: the studio's tab strip asks for its active tab only to scroll it into view. */
  querySelector() { return null; }
}
class TestText extends TestNode {
  constructor(public nodeValue: string, doc: TestDocument) { super(3, '#text', doc); }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = t; }
}
class TestElement extends TestNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  private currentValue = '';
  private isSelected = false;
  constructor(readonly tagName: string, readonly namespaceURI: string, doc: TestDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  /** What React DOM reads to tell a text-like input from a checkbox. */
  get type() { return this.attributes.get('type') ?? 'text'; }
  /**
   * A field's live value, apart from its `value` attribute, as in a browser: an option's is its
   * `value` attribute, and a select's is its selected option's.
   */
  get value(): string {
    if (this.nodeName === 'OPTION') return this.attributes.get('value') ?? this.textContent;
    if (this.nodeName === 'SELECT') return (this.options.find((o) => o.selected) ?? this.options[0])?.value ?? '';
    return this.currentValue;
  }
  set value(v: string) {
    if (this.nodeName === 'SELECT') for (const o of this.options) o.isSelected = o.value === String(v);
    else this.currentValue = String(v);
  }
  /** An option's selection: selecting one deselects the others of its select, as in a browser. */
  get selected() { return this.isSelected; }
  set selected(on: boolean) {
    let select: TestNode | null = this.parentNode;
    while (select && select.nodeName !== 'SELECT') select = select.parentNode;
    if (on && select instanceof TestElement) for (const o of select.options) o.isSelected = false;
    this.isSelected = !!on;
  }
  get options() { return this.elements((e) => e.nodeName === 'OPTION'); }
  get classList() {
    const classes = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const write = (list: string[]) => this.setAttribute('class', [...new Set(list)].join(' '));
    return {
      contains: (c: string) => classes().includes(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes().includes(c);
        write(on ? [...classes(), c] : classes().filter((x) => x !== c));
        return on;
      },
    };
  }
  focus() { this.ownerDocument!.focused = this; }
  blur() { if (this.ownerDocument!.focused === this) this.ownerDocument!.focused = null; }
}
class TestDocument extends TestNode {
  focused: TestElement | null = null;
  /** React DOM asks whether the document has an `oninput` handler slot to learn that `input` events fire. */
  oninput = null;
  readonly body: TestElement;
  readonly documentElement: TestElement;
  constructor() {
    super(9, '#document', null);
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  get activeElement() { return this.focused ?? this.body; }
  createElement(tag: string) { return new TestElement(tag, 'http://www.w3.org/1999/xhtml', this); }
  createElementNS(ns: string, tag: string) { return new TestElement(tag, ns, this); }
  createTextNode(t: string) { return new TestText(t, this); }
}

/** The words an element shows, as one line. */
const words = (e: TestNode) => e.textContent.replace(/\s+/g, ' ').trim();

// ─── The mounted studio ───

interface StudioInput { activeDoc: SequenceDocument; documents: SequenceDocument[]; tab: GenomicsSuiteSubTab }

/** A field a user types in or picks from: an enabled text or number box, or a select, by the label it sits in. */
interface Field { label: string; el: TestElement }

/**
 * Mounts the Genomics studio and gives the steps a user and the browser take: clicking a sub-view's
 * tab, typing in a box, picking an option, a new document, a frame painted, the next task, and every
 * frame and task until none is left. Each step runs in `flushSync`, so the render and the effects it
 * causes have run when the step returns, as a browser has run them before the next event.
 */
async function mountStudio(start: StudioInput) {
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame };
  const doc = new TestDocument();
  const win = new TestNode(0, '#window', null) as TestNode & Record<string, unknown>;
  // the frames the browser has yet to paint: each callback runs before its frame is painted
  const frames = new Map<number, () => void>();
  let lastFrame = 0;
  const requestFrame = (cb: () => void) => { frames.set(++lastFrame, cb); return lastFrame; };
  const cancelFrame = (id: number) => { frames.delete(id); };
  Object.assign(win, {
    document: doc, HTMLIFrameElement: class {}, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame,
  });
  Object.assign(g, { window: win, document: doc, requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame });
  // the tasks the page queues with no delay, in order, so a check can run them one at a time as the
  // browser does; a timer with a delay (the repeat box's settle) stays on the fake clock
  const tasks = new Map<object, () => void>();
  let fakeTimeouts: { set: typeof setTimeout; clear: typeof clearTimeout } | null = null;
  const restore = () => {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete g[k]; else g[k] = v;
    probe.inRender = () => { throw new Error('the render probe is not installed'); };
    probe.panelScanning = () => false;
    probe.during = null;
    if (fakeTimeouts) Object.assign(g, { setTimeout: fakeTimeouts.set, clearTimeout: fakeTimeouts.clear });
    tasks.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  };
  // React DOM learns at load whether it runs in a browser; loaded now, it does
  const { flushSync } = await import('react-dom');
  ({ GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio'));
  const { createRoot } = await import('react-dom/client');
  vi.useFakeTimers();
  fakeTimeouts = { set: g.setTimeout as typeof setTimeout, clear: g.clearTimeout as typeof clearTimeout };
  const { set: delayed, clear: clearDelayed } = fakeTimeouts;
  g.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms) return delayed(fn, ms, ...args);
    const id = {};
    tasks.set(id, () => fn(...args));
    return id;
  };
  g.clearTimeout = (id: unknown) => {
    if (!tasks.delete(id as object)) clearDelayed(id as Parameters<typeof clearTimeout>[0]);
  };

  // React's idle dispatcher, the one it holds after any render: a component's render holds another
  if (!hooksDispatcher) {
    restore();
    throw new Error('React keeps its hooks dispatcher somewhere other than React 18 did: update the render probe');
  }
  const warmup = createRoot(doc.createElement('div') as unknown as Element);
  flushSync(() => warmup.render(<span />));
  flushSync(() => warmup.unmount());
  const idle = hooksDispatcher.current;
  probe.inRender = () => hooksDispatcher.current !== null && hooksDispatcher.current !== idle;

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const noop = () => {};
  let shown = start;
  const draw = (input: StudioInput) => flushSync(() => root.render(
    <GenomicsNgsAndPredictionStudio activeDoc={input.activeDoc} documents={input.documents} initialSubTab={input.tab}
      onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />
  ));

  /** The scan's panel, when its sub-view is shown. */
  const panel = (scan: ScanName): TestElement | null => {
    const found = container.elements((e) => e.getAttribute('data-mbc-scan') === scan);
    expect(found.length, `at most one ${scan} panel`).toBeLessThanOrEqual(1);
    return found[0] ?? null;
  };
  /** Whether the scan's panel reads 'Scanning…' and nothing else, and says it is busy. */
  const scanning = (scan: ScanName) => {
    const p = panel(scan);
    return p !== null && words(p) === 'Scanning…' && p.getAttribute('aria-busy') === 'true';
  };
  probe.panelScanning = (scan) => scanning(scan as ScanName);
  try {
    draw(start);
  } catch (err) {
    try { root.unmount(); } finally { restore(); }
    throw err;
  }

  /** Delivers an event to `target` along its path, capture then bubble. */
  const dispatch = (target: TestNode, type: string, init: Record<string, unknown> = {}) => {
    const path: TestNode[] = [];
    for (let n: TestNode | null = target; n; n = n.parentNode) path.push(n);
    path.push(win);
    let stopped = false;
    const ev: TestEvent = {
      detail: 0, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, relatedTarget: null, ...init,
      type, target, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: 0, isTrusted: true,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
    };
    const fire = (t: TestNode, capture: boolean) => {
      for (const l of t.listeners.filter((x) => x.type === type && x.capture === capture)) l.fn(ev);
    };
    flushSync(() => {
      for (const t of [...path].reverse()) { if (stopped) break; fire(t, true); }
      for (const t of path) { if (stopped) break; fire(t, false); }
    });
  };
  // a box's value is set as a keystroke sets it: past React DOM's own record of the value
  const setValue = Object.getOwnPropertyDescriptor(TestElement.prototype, 'value')!.set!;

  const studio = {
    container,
    panel,
    scanning,
    /** Clicks the sub-view tab whose name opens with `name`. */
    tab(name: string) {
      const found = container.elements((e) => e.getAttribute('role') === 'tab' && words(e).startsWith(name));
      expect(found, `one "${name}" tab`).toHaveLength(1);
      dispatch(found[0], 'click');
    },
    /** Every field the shown sub-view has, by its label. */
    fields(): Field[] {
      return container
        .elements((e) => e.nodeName === 'LABEL')
        .flatMap((label) => {
          const name = label.elements((e) => e.nodeName === 'SPAN').map(words)[0] ?? words(label);
          return label
            .elements((e) => (e.nodeName === 'SELECT' || (e.nodeName === 'INPUT' && ['number', 'text'].includes(e.type)))
              && !e.hasAttribute('disabled') && !e.hasAttribute('readonly'))
            .map((el) => ({ label: name, el }));
        });
    },
    /** The field whose label opens with `name`. */
    field(name: string): TestElement {
      const found = studio.fields().filter((f) => f.label.startsWith(name));
      expect(found, `one "${name}" field`).toHaveLength(1);
      return found[0].el;
    },
    /** The box now holds `text`, as after a keystroke. */
    type(box: TestElement, text: string) {
      box.focus();
      setValue.call(box, text);
      dispatch(box, 'input', { data: text.slice(-1), inputType: 'insertText' });
    },
    /** The select now has the option of value `value` picked. */
    choose(select: TestElement, value: string) {
      expect(select.options.map((o) => o.value), 'an option to pick').toContain(value);
      setValue.call(select, value);
      dispatch(select, 'change');
    },
    /** One character typed at the end of a box, or the next option picked in a select. */
    change(field: TestElement) {
      if (field.nodeName === 'SELECT') {
        const values = field.options.map((o) => o.value);
        studio.choose(field, values[(values.indexOf(field.value) + 1) % values.length]);
      } else {
        studio.type(field, `${field.value}1`);
      }
    },
    /** The studio as the app draws it for another active document, or other documents. */
    redraw(next: Partial<StudioInput>) {
      shown = { ...shown, ...next };
      draw(shown);
    },
    /** The browser paints a frame: the callbacks asked for before it run first. */
    paint() {
      const due = [...frames.values()];
      frames.clear();
      flushSync(() => { for (const cb of due) cb(); });
    },
    /** The next task the page has queued runs, alone. */
    nextTask() {
      const [id, run] = [...tasks.entries()][0] ?? [];
      expect(run, 'a task queued').toBeDefined();
      tasks.delete(id!);
      flushSync(() => run!());
    },
    /** Frames, tasks and timers run until nothing is left to run. */
    settle() {
      for (let i = 0; i < 50; i++) {
        if (frames.size === 0 && tasks.size === 0 && vi.getTimerCount() === 0) return;
        studio.paint();
        while (tasks.size > 0) studio.nextTask();
        flushSync(() => { vi.runOnlyPendingTimers(); });
      }
      throw new Error('frames or tasks were still queued after 50 rounds');
    },
    /** Renders `element` once, in a root of its own. */
    renderAlone(element: React.ReactElement) {
      const host = createRoot(doc.createElement('div') as unknown as Element);
      flushSync(() => host.render(element));
      flushSync(() => host.unmount());
    },
    unmount() {
      try { flushSync(() => root.unmount()); } finally { restore(); }
    },
  };
  return studio;
}

type Studio = Awaited<ReturnType<typeof mountStudio>>;

/** The calls of one scan since `from`, as their arguments. */
const callsOf = (scan: ScanName, from = 0) => probe.calls.slice(from).filter((c) => c.scan === scan).map((c) => c.args);

/** The line naming the input a landed result was computed for. */
const computedFor = (studio: Studio, scan: ScanName): string | null => {
  const p = studio.panel(scan);
  const lines = p ? p.elements((e) => e.nodeName === 'P' && words(e).startsWith('Computed for')).map(words) : [];
  expect(lines.length, `at most one line naming the ${scan} input`).toBeLessThanOrEqual(1);
  return lines[0] ?? null;
};

/** The KPI values in a panel, in order. */
const kpis = (studio: Studio, scan: ScanName) => studio.panel(scan)!.elements((e) => e.classList.contains('kpi-val')).map(words);
/** A panel's table caption. */
const caption = (studio: Studio, scan: ScanName) => studio.panel(scan)!.elements((e) => e.classList.contains('mbc-table-caption')).map(words);
/** The header badges of the studio card titled `title`. */
const badges = (studio: Studio, title: string) => studio.container
  .elements((e) => e.classList.contains('studio-card-header') && words(e).startsWith(title))
  .flatMap((h) => h.elements((e) => e.classList.contains('badge-accent')).map(words));

/** What the synteny panel shows for a result: its line naming the input, then its KPIs. */
async function syntenyShown(a: SequenceDocument, b: SequenceDocument, engineName: 'Mauve' | 'LASTZ') {
  const r = (await unspied()).runWholeGenomeSynteny(a.sequence, b.sequence, engineName);
  return {
    line: `Computed for ${a.name} (${n(a.sequence.length)} bp) against ${b.name} (${n(b.sequence.length)} bp) with ${engineName}`,
    kpis: [
      `${r.blocks.length}`,
      `${r.totalAlignedBp.toLocaleString()} bp (${r.genomeACoverageIsLowerBound ? `at least ${r.genomeACoveragePct}% of ${a.name}` : `${r.genomeACoveragePct}%`})`,
      `${r.inversionCount}`,
    ],
  };
}
const syntenyNow = (studio: Studio) => ({ line: computedFor(studio, 'synteny'), kpis: kpis(studio, 'synteny') });

/** What the gene panel shows for a result: its line naming the input, its caption and the card's badge. */
async function genesShown(d: SequenceDocument, minAa: number) {
  const r = (await unspied()).predictGlimmerMicrobialGenes(d.sequence, minAa);
  return {
    line: `Computed for ${d.name} (${n(d.sequence.length)} bp), proteins ≥ ${minAa} aa`,
    caption: [`Glimmer Predicted Protein-Coding Genes (${listCount(r.genes.length, r.totalPredictedCds, 'top')})`],
    badges: [`${n(r.totalPredictedCds)} Predicted CDS`],
  };
}
const genesNow = (studio: Studio) => ({
  line: computedFor(studio, 'genes'), caption: caption(studio, 'genes'), badges: badges(studio, 'Glimmer Microbial Gene Predictor'),
});

/** What the CpG panel shows for a result: its line naming the input and its caption, and the island count the card's badge opens with. */
async function cpgShown(d: SequenceDocument, minLen: number) {
  const r = (await unspied()).findCpGIslands(d.sequence, minLen);
  return {
    line: `Computed for ${d.name} (${n(d.sequence.length)} bp), islands ≥ ${minLen} bp`,
    caption: [`Gardiner-Garden & Frommer CpG Islands (${r.islands.length})`],
    badge: `${r.islands.length} CpG Islands • `,
  };
}
const cpgBadge = (studio: Studio) => badges(studio, 'CpG Islands & Genomic Repeat Finder')[0] ?? '';
const cpgNow = (studio: Studio) => ({
  line: computedFor(studio, 'cpg'), caption: caption(studio, 'cpg'), badge: /^\d[\d,]* CpG Islands • /.exec(cpgBadge(studio))?.[0] ?? null,
});

const TAB_NAMES: Record<GenomicsSuiteSubTab, string> = {
  'ngs-assembly': 'NGS Trim, Map',
  'genome-variants': 'Whole-Genome, Variants',
  'genes-cpg-repeats': 'Glimmer Genes, CpG',
  'protein-3d': 'Coiled-Coils, Transmembrane',
  'transform-submit': 'Transform, Mutate',
};
/** The scans each sub-view shows. */
const SCANS_ON: Record<GenomicsSuiteSubTab, ScanName[]> = {
  'ngs-assembly': [], 'genome-variants': ['synteny'], 'genes-cpg-repeats': ['genes', 'cpg'], 'protein-3d': [], 'transform-submit': [],
};

describe('Genomics genome-scale scans', () => {
  afterEach(() => {
    probe.calls.length = 0;
    vi.useRealTimers();
  });

  it('runs no genome-scale scan during render', async () => {
    probe.calls.length = 0;
    const studio = await mountStudio({ activeDoc: genomeA, documents: [genomeA, genomeB, read], tab: 'ngs-assembly' });
    try {
      // the probe tells a scan made while React renders a component from one made outside a render
      function ScansWhileRendering() {
        runWholeGenomeSynteny('ACGTACGTACGTACGTACGTACGTACGT', 'ACGTACGTACGTACGTACGTACGTACGT', 'Mauve');
        return null;
      }
      studio.renderAlone(<ScansWhileRendering />);
      runWholeGenomeSynteny('ACGTACGTACGTACGTACGTACGTACGT', 'ACGTACGTACGTACGTACGTACGTACGT', 'Mauve');
      expect(probe.calls.map((c) => c.inRender), 'fixture: the probe sees a render').toEqual([true, false]);
      probe.calls.length = 0;

      // opening the tab, every sub-view in turn and back, and a keystroke or a pick in every field of
      // each: no step runs a scan while it renders, commits or runs its effects; a scan runs only in
      // a task of its own, once its panel reads 'Scanning…' in what has been committed
      const visits: GenomicsSuiteSubTab[] = ['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'protein-3d', 'transform-submit', 'genome-variants', 'genes-cpg-repeats'];
      for (const [i, view] of visits.entries()) {
        const firstVisit = visits.indexOf(view) === i;
        if (i > 0) {
          const from = probe.calls.length;
          studio.tab(TAB_NAMES[view]);
          expect(probe.calls.slice(from), `opening ${view}: no scan in the step`).toEqual([]);
        }
        for (const scan of SCANS_ON[view]) {
          // a first visit has no result yet; a later one shows the result it left, with no new run
          expect(studio.scanning(scan), `${view}, ${scan}: Scanning… on the first visit only`).toBe(firstVisit);
        }
        const beforeFrame = probe.calls.length;
        studio.paint();
        expect(probe.calls.slice(beforeFrame), `${view}: no scan inside a frame`).toEqual([]);
        studio.settle();
        for (const scan of SCANS_ON[view]) expect(studio.scanning(scan), `${view}, ${scan}: landed`).toBe(false);

        for (const { label, el } of studio.fields()) {
          const from = probe.calls.length;
          studio.change(el);
          expect(probe.calls.slice(from), `${view}, "${label}": no scan in the step`).toEqual([]);
          studio.settle();
          for (const scan of SCANS_ON[view]) expect(studio.scanning(scan), `${view}, "${label}", ${scan}: landed`).toBe(false);
        }
      }

      // fixture: each scan ran, more than once, so a scan made in render would have been seen
      for (const scan of ['synteny', 'genes', 'cpg'] as const) {
        expect(callsOf(scan).length, `fixture: ${scan} ran more than once`).toBeGreaterThan(1);
      }
      expect(probe.calls.filter((c) => c.inRender), 'scans made while React rendered').toEqual([]);
      expect(probe.calls.filter((c) => !c.panelScanning), "scans run while their panel did not read 'Scanning…'").toEqual([]);
    } finally {
      studio.unmount();
    }
  }, 60_000);

  it('shows Scanning until each scan lands and never shows a stale result', async () => {
    // ─── Gene prediction and the CpG island scan ───
    probe.calls.length = 0;
    const want = {
      genes45: await genesShown(genomeA, 45), genes60: await genesShown(genomeA, 60),
      cpg200: await cpgShown(genomeA, 200), cpg300: await cpgShown(genomeA, 300), cpg250: await cpgShown(genomeA, 250),
      cpg220: await cpgShown(genomeA, 220), cpg280: await cpgShown(genomeA, 280),
      genesD: await genesShown(genomeD, 60), cpgD: await cpgShown(genomeD, 280),
    };
    // fixture: each changed input gives a result that reads differently, so a stale one would be seen
    expect(want.genes45.caption, 'fixture').not.toEqual(want.genes60.caption);
    expect(new Set([want.cpg200, want.cpg300, want.cpg250, want.cpg220, want.cpg280].map((w) => w.caption[0])).size, 'fixture').toBe(5);
    expect(want.genesD.caption, 'fixture').not.toEqual(want.genes60.caption);
    expect(want.cpgD.caption, 'fixture').not.toEqual(want.cpg280.caption);

    const genes = await mountStudio({ activeDoc: genomeA, documents: [genomeA, genomeD], tab: 'genes-cpg-repeats' });
    try {
      // opened: both panels read 'Scanning…' in place of their numbers, and no count of either sits
      // in its card's badge; a frame passes and neither has run
      const empty = { line: null, caption: [], badges: [] };
      expect([genes.scanning('genes'), genes.scanning('cpg')]).toEqual([true, true]);
      expect(genesNow(genes)).toEqual(empty);
      expect(cpgNow(genes)).toEqual({ line: null, caption: [], badge: null });
      genes.paint();
      expect(probe.calls).toEqual([]);
      // each lands in a task of its own: after the first, the other still reads 'Scanning…'
      genes.nextTask();
      expect(probe.calls.map((c) => c.scan)).toHaveLength(1);
      const first = probe.calls[0].scan;
      const other = first === 'genes' ? 'cpg' : 'genes';
      expect([genes.scanning(first), genes.scanning(other)]).toEqual([false, true]);
      genes.settle();
      expect(genesNow(genes)).toEqual(want.genes45);
      expect(cpgNow(genes)).toEqual({ line: want.cpg200.line, caption: want.cpg200.caption, badge: want.cpg200.badge });

      // a new minimum protein length: at once the gene panel reads 'Scanning…', not the 45 aa
      // result, until the 60 aa one lands; the CpG panel keeps its result
      genes.type(genes.field('Min Protein Length'), '60');
      expect(genes.scanning('genes')).toBe(true);
      expect(genesNow(genes)).toEqual(empty);
      expect(cpgNow(genes).line).toBe(want.cpg200.line);
      genes.settle();
      expect(genesNow(genes)).toEqual(want.genes60);

      // changed while waiting: 300 bp, then 250 bp before the 300 bp scan has run. The 300 bp scan
      // is discarded unrun, the panel never shows the 200 or the 300 bp result, and the 250 bp one lands
      let from = probe.calls.length;
      genes.type(genes.field('Min CpG Island'), '300');
      expect(genes.scanning('cpg')).toBe(true);
      genes.paint();
      expect(genes.scanning('cpg')).toBe(true);
      genes.type(genes.field('Min CpG Island'), '250');
      expect(genes.scanning('cpg')).toBe(true);
      genes.settle();
      expect(callsOf('cpg', from)).toEqual([[genomeA.sequence, 250]]);
      expect(cpgNow(genes)).toEqual({ line: want.cpg250.line, caption: want.cpg250.caption, badge: want.cpg250.badge });

      // changed while running: 220 bp is typed, and while its scan runs the box is set to 280 bp.
      // When the 220 bp scan returns its result is discarded and the panel still reads 'Scanning…'
      from = probe.calls.length;
      probe.during = (scan, args) => {
        if (scan !== 'cpg' || args[1] !== 220) return;
        probe.during = null;
        genes.type(genes.field('Min CpG Island'), '280');
      };
      genes.type(genes.field('Min CpG Island'), '220');
      genes.paint();
      genes.nextTask();
      expect(callsOf('cpg', from)).toEqual([[genomeA.sequence, 220]]);
      expect(genes.scanning('cpg'), 'the 220 bp result is discarded').toBe(true);
      genes.settle();
      expect(callsOf('cpg', from)).toEqual([[genomeA.sequence, 220], [genomeA.sequence, 280]]);
      expect(cpgNow(genes)).toEqual({ line: want.cpg280.line, caption: want.cpg280.caption, badge: want.cpg280.badge });

      // changed back while running: 300 bp is typed, and while its scan runs the box goes back to
      // 280 bp. The 280 bp result shows again at once; the 300 bp one is discarded when it returns,
      // so nothing is scanned again
      from = probe.calls.length;
      probe.during = (scan, args) => {
        if (scan !== 'cpg' || args[1] !== 300) return;
        probe.during = null;
        genes.type(genes.field('Min CpG Island'), '280');
      };
      genes.type(genes.field('Min CpG Island'), '300');
      expect(genes.scanning('cpg')).toBe(true);
      genes.paint();
      genes.nextTask();
      expect(cpgNow(genes), 'the 280 bp result, at once').toEqual({ line: want.cpg280.line, caption: want.cpg280.caption, badge: want.cpg280.badge });
      genes.settle();
      expect(callsOf('cpg', from)).toEqual([[genomeA.sequence, 300]]);
      expect(cpgNow(genes)).toEqual({ line: want.cpg280.line, caption: want.cpg280.caption, badge: want.cpg280.badge });

      // another active document: both panels read 'Scanning…' at once, never genome A's results
      // under genome D, and then name genome D and its length
      genes.redraw({ activeDoc: genomeD });
      expect([genes.scanning('genes'), genes.scanning('cpg')]).toEqual([true, true]);
      genes.settle();
      expect(genesNow(genes)).toEqual(want.genesD);
      expect(cpgNow(genes)).toEqual({ line: want.cpgD.line, caption: want.cpgD.caption, badge: want.cpgD.badge });
      expect(probe.calls.filter((c) => c.inRender || !c.panelScanning)).toEqual([]);
    } finally {
      genes.unmount();
    }

    // ─── Whole-genome synteny ───
    probe.calls.length = 0;
    const pair = {
      abMauve: await syntenyShown(genomeA, genomeB, 'Mauve'), abLastz: await syntenyShown(genomeA, genomeB, 'LASTZ'),
      acMauve: await syntenyShown(genomeA, genomeC, 'Mauve'), acLastz: await syntenyShown(genomeA, genomeC, 'LASTZ'),
    };
    // fixture: a related and an unrelated partner give different numbers
    expect(pair.abMauve.kpis, 'fixture').not.toEqual(pair.acMauve.kpis);
    expect(pair.abLastz.kpis, 'fixture').not.toEqual(pair.acLastz.kpis);

    const synteny = await mountStudio({ activeDoc: genomeA, documents: [genomeA, genomeB, genomeC, read], tab: 'genome-variants' });
    try {
      const empty = { line: null, kpis: [] };
      expect(synteny.scanning('synteny')).toBe(true);
      expect(syntenyNow(synteny)).toEqual(empty);
      synteny.paint();
      expect(probe.calls).toEqual([]);
      synteny.settle();
      // landed: the genomes, their lengths and the engine it was computed for, then its numbers
      expect(syntenyNow(synteny)).toEqual(pair.abMauve);

      // another engine: 'Scanning…' at once, never the Mauve numbers, until the LASTZ result lands
      synteny.choose(synteny.field('Genome Alignment Engine'), 'LASTZ');
      expect(synteny.scanning('synteny')).toBe(true);
      synteny.settle();
      expect(syntenyNow(synteny)).toEqual(pair.abLastz);

      // another partner, then the engine back to Mauve while that scan waits: the A-C LASTZ scan is
      // discarded unrun, and the A-C Mauve result lands
      let from = probe.calls.length;
      synteny.choose(synteny.field('Compare Genome A Against'), 'c');
      expect(synteny.scanning('synteny')).toBe(true);
      synteny.paint();
      synteny.choose(synteny.field('Genome Alignment Engine'), 'Mauve');
      expect(synteny.scanning('synteny')).toBe(true);
      synteny.settle();
      expect(callsOf('synteny', from)).toEqual([[genomeA.sequence, genomeC.sequence, 'Mauve']]);
      expect(syntenyNow(synteny)).toEqual(pair.acMauve);

      // the partner back to B, and while that scan runs the engine is set to LASTZ: the A-B Mauve
      // result is discarded when it returns, and the A-B LASTZ result lands
      from = probe.calls.length;
      probe.during = (scan, args) => {
        if (scan !== 'synteny' || args[2] !== 'Mauve') return;
        probe.during = null;
        synteny.choose(synteny.field('Genome Alignment Engine'), 'LASTZ');
      };
      synteny.choose(synteny.field('Compare Genome A Against'), 'b');
      synteny.paint();
      synteny.nextTask();
      expect(callsOf('synteny', from)).toEqual([[genomeA.sequence, genomeB.sequence, 'Mauve']]);
      expect(synteny.scanning('synteny'), 'the Mauve result is discarded').toBe(true);
      synteny.settle();
      expect(callsOf('synteny', from)).toEqual([
        [genomeA.sequence, genomeB.sequence, 'Mauve'], [genomeA.sequence, genomeB.sequence, 'LASTZ'],
      ]);
      expect(syntenyNow(synteny)).toEqual(pair.abLastz);

      // another active document: 'Scanning…' at once, then genome C against its partner
      synteny.redraw({ activeDoc: genomeC });
      expect(synteny.scanning('synteny')).toBe(true);
      synteny.settle();
      expect(syntenyNow(synteny)).toEqual(await syntenyShown(genomeC, genomeB, 'LASTZ'));
      expect(probe.calls.filter((c) => c.inRender || !c.panelScanning)).toEqual([]);
    } finally {
      synteny.unmount();
    }
  }, 60_000);

  it('starts no scan when an unrelated field changes', async () => {
    probe.calls.length = 0;
    const studio = await mountStudio({ activeDoc: genomeA, documents: [genomeA, genomeB, read], tab: 'genome-variants' });
    try {
      // the scans the studio has run, by name, each outside a render
      const runs = () => ({ synteny: callsOf('synteny').length, genes: callsOf('genes').length, cpg: callsOf('cpg').length });
      const inRender = () => probe.calls.filter((c) => c.inRender);
      studio.settle();
      expect(runs()).toEqual({ synteny: 1, genes: 0, cpg: 0 });
      expect(inRender()).toEqual([]);
      const syntenyLine = computedFor(studio, 'synteny');
      expect(syntenyLine).not.toBeNull();

      // one character in each field of this sub-view that synteny does not read: no new synteny run,
      // and the result shown is the one already computed
      const syntenyInputs = ['Genome Alignment Engine', 'Compare '];
      const unrelated = studio.fields().filter((f) => !syntenyInputs.some((s) => f.label.startsWith(s)));
      expect(unrelated.map((f) => f.label), 'fixture: the unrelated fields here').toEqual(['Min STR Repeats:']);
      for (const { label } of unrelated) {
        studio.change(studio.field(label));
        studio.settle();
        expect(runs(), `"${label}"`).toEqual({ synteny: 1, genes: 0, cpg: 0 });
        expect(computedFor(studio, 'synteny'), `"${label}"`).toBe(syntenyLine);
      }
      // a field synteny reads does start one: the count sees a run a keystroke causes
      studio.choose(studio.field('Genome Alignment Engine'), 'LASTZ');
      studio.settle();
      expect(runs()).toEqual({ synteny: 2, genes: 0, cpg: 0 });
      const syntenyLanded = computedFor(studio, 'synteny');
      expect(syntenyLanded).toMatch(/ with LASTZ$/);

      // the genes sub-view: each scan runs once, then only its own field starts another run of it
      studio.tab(TAB_NAMES['genes-cpg-repeats']);
      studio.settle();
      expect(runs()).toEqual({ synteny: 2, genes: 1, cpg: 1 });
      const own: Record<string, 'genes' | 'cpg'> = { 'Min Protein Length (aa):': 'genes', 'Min CpG Island (bp):': 'cpg' };
      const labels = studio.fields().map((f) => f.label);
      expect(labels, 'fixture: both scans and two unrelated fields are on this sub-view').toEqual(
        expect.arrayContaining([...Object.keys(own), 'Min Repeat Arm:', 'Min Score:'])
      );
      for (const label of labels) {
        const was = runs();
        studio.change(studio.field(label));
        studio.settle();
        const scan = own[label];
        expect(runs(), `"${label}"`).toEqual({ ...was, ...(scan ? { [scan]: was[scan] + 1 } : {}) });
      }

      // every field of the other sub-views, then back: no new run of any of the three, and the
      // results already computed are shown
      const landed = { genes: computedFor(studio, 'genes'), cpg: computedFor(studio, 'cpg') };
      expect([landed.genes, landed.cpg].every(Boolean), 'fixture: both have landed').toBe(true);
      const was = runs();
      for (const view of ['ngs-assembly', 'protein-3d', 'transform-submit'] as const) {
        studio.tab(TAB_NAMES[view]);
        studio.settle();
        for (const { label } of studio.fields()) {
          studio.change(studio.field(label));
          studio.settle();
          expect(runs(), `${view}, "${label}"`).toEqual(was);
        }
      }
      studio.tab(TAB_NAMES['genes-cpg-repeats']);
      expect([studio.scanning('genes'), studio.scanning('cpg')]).toEqual([false, false]);
      expect([computedFor(studio, 'genes'), computedFor(studio, 'cpg')]).toEqual([landed.genes, landed.cpg]);
      studio.tab(TAB_NAMES['genome-variants']);
      expect(studio.scanning('synteny')).toBe(false);
      expect(computedFor(studio, 'synteny')).toBe(syntenyLanded);
      studio.settle();
      expect(runs()).toEqual(was);
      expect(inRender()).toEqual([]);
    } finally {
      studio.unmount();
    }
  }, 60_000);
});
