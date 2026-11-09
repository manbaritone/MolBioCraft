// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6SQ9T: the Min Repeat Arm box in the Genomics studio scanned on every keystroke, and a
 * partial "1" scanned at once (the engine held it to 8). On a satellite array each of those scans
 * held the UI thread for seconds. The box now scans 400 ms after the last keystroke, or at once on
 * Enter or when it loses focus, and only at a whole number of bases from 8 to 24 (D0055); until a
 * new scan lands, the repeat list and its caption stay those of the arm they were computed at.
 *
 * The studio is mounted with React's client renderer, the one the app runs, under fake timers, so
 * time moves only when the test moves it. The repo carries no DOM library, so, as in
 * proteinCaps.test.tsx, the tree React writes to is a few node operations, with what React DOM's
 * input handling reads on top: an input's `type` and `value`, and an event delivered along its
 * target's path. React DOM is loaded after the tree's window and document are in place, so it
 * takes its browser path (the `input` event) for typing. The engine is the real WASM one; the
 * repeat scan the studio calls is wrapped in a spy that counts its calls and the arm of each.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Imported once the tree's window and document are in place (mountStudio): the studio loads React
// DOM through the shared inspector, and React DOM loaded first would ignore typing (D0081).
let GenomicsNgsAndPredictionStudio: typeof import('../components/GenomicsNgsAndPredictionStudio').GenomicsNgsAndPredictionStudio;

// The studio's repeat scan is the real engine call, wrapped so the test can count the scans it runs
// and read each one's arm. Every other call goes to the engine unchanged.
vi.mock('../core/genomicsAndStructureSuite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/genomicsAndStructureSuite')>();
  return { ...actual, findGenomicRepeats: vi.fn(actual.findGenomicRepeats) };
});
import { findGenomicRepeats } from '../core/genomicsAndStructureSuite';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

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

// ─── The tree React DOM writes to ───

interface TestEvent { type: string; target: TestNode; defaultPrevented: boolean; [field: string]: unknown }
type TestListener = (ev: TestEvent) => void;
const isCapture = (options?: boolean | { capture?: boolean }) => options === true || (typeof options === 'object' && !!options?.capture);

/** The node operations React DOM's client renderer calls, as in proteinCaps.test.tsx, with listeners it can be sent events through. */
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
  constructor(readonly tagName: string, readonly namespaceURI: string, doc: TestDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  /** What React DOM reads to tell a text-like input from a checkbox. */
  get type() { return this.attributes.get('type') ?? 'text'; }
  /** An input's live value, apart from its `value` attribute, as in a browser. */
  get value() { return this.currentValue; }
  set value(v: string) { this.currentValue = String(v); }
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

// ─── The mounted studio ───

const scans = vi.mocked(findGenomicRepeats);
const armsScanned = () => scans.mock.calls.map((c) => c[1]);

/**
 * Mounts the Genomics studio on `activeDoc`'s repeats tab and gives the steps a user takes in the
 * Min Repeat Arm box: typing (the box then holds `text`), Enter, leaving the box, and time passing.
 * Each step runs in `flushSync`, so the render and the effects it causes have run when the step
 * returns, as a browser has run them before the next key.
 */
async function mountStudio(activeDoc: SequenceDocument) {
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document };
  const doc = new TestDocument();
  const win = new TestNode(0, '#window', null) as TestNode & Record<string, unknown>;
  Object.assign(win, { document: doc, HTMLIFrameElement: class {}, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 });
  g.window = win;
  g.document = doc;
  const restore = () => {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete g[k]; else g[k] = v;
    vi.clearAllTimers();
    vi.useRealTimers();
  };
  // React DOM learns at load whether it runs in a browser; loaded now, it does
  const { flushSync } = await import('react-dom');
  ({ GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio'));
  const { createRoot } = await import('react-dom/client');
  vi.useFakeTimers();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const noop = () => {};
  try {
    flushSync(() => root.render(
      <GenomicsNgsAndPredictionStudio activeDoc={activeDoc} documents={[activeDoc]} initialSubTab="genes-cpg-repeats"
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />
    ));
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
      detail: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, relatedTarget: null, ...init,
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
  const [box] = container
    .elements((e) => e.nodeName === 'LABEL' && e.textContent.startsWith('Min Repeat Arm'))
    .flatMap((label) => label.elements((e) => e.nodeName === 'INPUT'));
  expect(box, 'the Min Repeat Arm box').toBeDefined();
  // the value the box holds is set as a keystroke sets it: past React DOM's own record of the value
  const setValue = Object.getOwnPropertyDescriptor(TestElement.prototype, 'value')!.set!;

  return {
    /** The box now holds `text`, as after a keystroke. */
    type(text: string) {
      box.focus();
      setValue.call(box, text);
      dispatch(box, 'input', { data: text.slice(-1), inputType: 'insertText' });
    },
    enter() { dispatch(box, 'keydown', { key: 'Enter', code: 'Enter' }); },
    leave() { box.blur(); dispatch(box, 'focusout'); },
    wait(ms: number) { flushSync(() => { vi.advanceTimersByTime(ms); }); },
    /** What the box shows. */
    shown: () => box.value,
    /** The repeat table's caption. */
    caption(): string {
      const found = container.elements((e) => e.classList.contains('mbc-table-caption') && e.textContent.startsWith('Direct, Inverted & Palindromic Repeats'));
      expect(found, 'one repeat caption').toHaveLength(1);
      return found[0].textContent;
    },
    unmount() {
      try { flushSync(() => root.unmount()); } finally { restore(); }
    },
  };
}

const repeatCaption = (arm: number) => {
  const scan = findGenomicRepeats(genome.sequence, arm);
  const n = (v: number) => v.toLocaleString('en-US');
  const count = scan.repeats.length < scan.totalRepeats ? `top ${n(scan.repeats.length)} of ${n(scan.totalRepeats)}` : n(scan.totalRepeats);
  return `Direct, Inverted & Palindromic Repeats (arms ≥ ${arm} bp, ${count})`;
};

const genome: SequenceDocument = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'g', name: 'Random 20 kb', sequence: randomBases(20_000, 0x5eed_00a4), moleculeType: 'DNA' };

describe('Min Repeat Arm box', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('scans repeats once after the arm length settles', async () => {
    // the captions each arm's scan gives, from the engine with no studio in between
    const at = { 10: repeatCaption(10), 12: repeatCaption(12), 16: repeatCaption(16) };
    // fixture: the three arms give three different captions, so a caption names its arm's scan
    expect(new Set(Object.values(at)).size).toBe(3);

    scans.mockClear();
    const studio = await mountStudio(genome);
    try {
      // the studio opens on the default arm, scanned once
      expect(armsScanned()).toEqual([10]);
      expect(studio.caption()).toBe(at[10]);
      expect(studio.shown()).toBe('10');

      // "1" then "2", 200 ms apart: no scan while the arm is being typed, then one, at 12, 400 ms
      // after the "2"; until it lands the list is still the one at 10 bp, and says so
      scans.mockClear();
      studio.type('1');
      studio.wait(200);
      studio.type('12');
      studio.wait(399);
      expect(armsScanned()).toEqual([]);
      expect(studio.caption()).toBe(at[10]);
      studio.wait(1);
      expect(armsScanned()).toEqual([12]);
      expect(studio.caption()).toBe(at[12]);
      studio.wait(5_000);
      expect(armsScanned()).toEqual([12]);

      // two arms that could each be scanned, typed 200 ms apart: only the last is, 400 ms after it
      scans.mockClear();
      studio.type('9');
      studio.wait(200);
      studio.type('20');
      studio.wait(399);
      expect(armsScanned()).toEqual([]);
      studio.wait(1);
      expect(armsScanned()).toEqual([20]);
      studio.type('12');
      studio.enter();
      expect(studio.caption()).toBe(at[12]);

      // a lone "1" left for 400 ms is no arm to scan at: no scan, at 8 or any other arm, and the
      // list stays the one at 12 bp while the box shows what was typed
      scans.mockClear();
      studio.type('1');
      studio.wait(400);
      studio.wait(5_000);
      expect(armsScanned()).toEqual([]);
      expect(studio.caption()).toBe(at[12]);
      expect(studio.shown()).toBe('1');

      // Enter after "1", "6": a scan at once, at 16, and no second one when the 400 ms pass
      studio.type('16');
      expect(armsScanned()).toEqual([]);
      studio.enter();
      expect(armsScanned()).toEqual([16]);
      expect(studio.caption()).toBe(at[16]);
      studio.wait(5_000);
      expect(armsScanned()).toEqual([16]);

      // leaving the box after "1", "6": a scan at once, at 16 (from 10, set with Enter first)
      studio.type('10');
      studio.enter();
      expect(studio.caption()).toBe(at[10]);
      scans.mockClear();
      studio.type('1');
      studio.wait(100);
      studio.type('16');
      studio.leave();
      expect(armsScanned()).toEqual([16]);
      expect(studio.caption()).toBe(at[16]);
      studio.wait(5_000);
      expect(armsScanned()).toEqual([16]);

      // only a whole number from 8 to 24 is scanned at: 25, 7 and 12.5 are not, by Enter, by leaving
      // the box or by waiting, and the box then shows the arm the list is of
      scans.mockClear();
      for (const text of ['25', '7', '12.5']) {
        studio.type(text);
        studio.wait(400);
        studio.enter();
        expect(studio.shown(), `${text} then Enter`).toBe('16');
        studio.type(text);
        studio.leave();
        expect(studio.shown(), `${text} then leaving the box`).toBe('16');
      }
      studio.wait(5_000);
      expect(armsScanned()).toEqual([]);
      expect(studio.caption()).toBe(at[16]);
      // and both ends of the range are
      studio.type('24');
      studio.enter();
      studio.type('8');
      studio.wait(400);
      expect(armsScanned()).toEqual([24, 8]);
    } finally {
      studio.unmount();
    }
  }, 60_000);
});
