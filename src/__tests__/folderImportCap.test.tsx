// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S17Y AC4: the desktop Import Folder reads at most the first 500 supported files of a folder
 * and used to leave the rest out without a word. The backend's reply now says how many it left out
 * (`filesLeftOut`, AC3), and the App tells the user in the status line, once the files it read are
 * imported, and keeps the notice until it is dismissed.
 *
 * The App is mounted with React DOM's client renderer in a live tree (the node operations of
 * documentTableBottom.test.tsx's "A live tree, for focus"; the repo carries no DOM library), inside a
 * stand-in Tauri shell whose native folder dialog replies as `cmd_native_open_files_dialog` does. The
 * menu command runs the App's own Import Folder, so the reply goes through tauriIpc.ts and
 * macosMenuBridge.ts to the App's importer exactly as on the desktop. The read and left-out counts
 * are the stand-in's, and the expected notice is written from them here.
 *
 * Wrong implementations, and what catches each: no notice (the bug); the notice shown before the
 * batch, so the batch's own "Batch imported" line replaces it, or shown and then timed out like any
 * other status line (the notice after the batch, and 6 s later); the read count, or the folder's
 * total, given as the files not imported (read, left out and total all differ); a notice left over
 * for the next import, or shown for an import that left nothing out (the second import); the batch's
 * failures dropped by the notice that replaces the batch's own line (the third import, one file empty).
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── App probe (installed before the App module is loaded) ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
const probe = vi.hoisted(() => ({ dispatcher: null as null | { current: AppDispatcher } }));

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

afterEach(() => {
  storage.clear();
});

// ─── A live tree ───

interface LiveEvent { type: string; [field: string]: unknown }
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
  /** An event dispatched on this target alone, as the bridge's `window.dispatchEvent(new CustomEvent(...))`. */
  dispatchEvent(ev: LiveEvent) {
    for (const l of this.listeners.filter((x) => x.type === ev.type)) l.fn.call(this, ev);
    return true;
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
  click() {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
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

// ─── The desktop shell's folder dialog ───

/** What `cmd_native_open_files_dialog` replies for a picked folder: the files it read, and how many it left out. */
interface FolderReply { files: { file_name: string; base64: string; byte_len: number }[]; filesLeftOut: number }
const fastaFile = (name: string, seq: string) => {
  const text = `>${name}\n${seq}\n`;
  return { file_name: `${name}.fasta`, base64: btoa(text), byte_len: text.length };
};

/**
 * Mounts the App in the live tree inside a stand-in Tauri shell whose folder dialog answers with
 * `nextReply()`, on fake timers. Returns the menu command, the status line's notice, and a wait that
 * lets the App's own timers and the import's promises run.
 */
function mountDesktopApp(nextReply: () => FolderReply) {
  vi.useFakeTimers();
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document, __TAURI_INTERNALS__: g.__TAURI_INTERNALS__ };
  const doc = new LiveDocument();
  const win = new LiveWindow(doc);
  g.window = win;
  g.document = doc;
  const dialogs: string[] = [];
  g.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'cmd_native_open_files_dialog') {
        dialogs.push(String(args?.mode));
        return nextReply();
      }
      if (cmd === 'cmd_take_pending_open_files') return [];
      if (cmd === 'cmd_rest_api_info') return { active: false };
      if (cmd === 'plugin:event|listen') return 1;
      return null;
    },
    transformCallback: () => 0,
  };
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
  const notice = () => container.querySelector('.statusbar-toast-text')?.textContent ?? null;
  return {
    dialogs,
    notice,
    text: () => container.textContent,
    menu: (id: string) => flushSync(() => probe.dispatcher!.current.onMenuAction(id)),
    /** Runs the App's timers and the import's promises, `ms` of fake time in 20 ms steps, until `done`. */
    async waitFor(done: () => boolean, ms = 4_000) {
      for (let t = 0; t < ms && !done(); t += 20) {
        await vi.advanceTimersByTimeAsync(20);
        await new Promise<void>((r) => queueMicrotask(r));
      }
    },
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    unmount() {
      try { flushSync(() => root.unmount()); } finally { restore(); }
    },
  };
}

describe('Import Folder that leaves files out', () => {
  it('shows how many files the folder import left out', async () => {
    const read = ['clone_A01', 'clone_A02', 'clone_A03', 'clone_B01', 'clone_B02', 'clone_B03'];
    const seq = 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGC';
    const replies: FolderReply[] = [
      // the backend read 6 files of the folder and left 9 supported files out
      { files: read.map((n, i) => fastaFile(n, seq.slice(i))), filesLeftOut: 9 },
      // a folder it read whole
      { files: read.map((n, i) => fastaFile(`${n}_whole`, seq.slice(i + 1))), filesLeftOut: 0 },
      // 3 read, one of them empty, and 4 left out
      {
        files: [fastaFile('clone_C01', seq), { file_name: 'blank.fasta', base64: '', byte_len: 0 }, fastaFile('clone_C02', seq.slice(2))],
        filesLeftOut: 4,
      },
    ];
    const app = mountDesktopApp(() => replies.shift()!);
    try {
      const expected = '9 of the 15 supported files in the folder were not imported: Import Folder reads the first 6, by name.';

      app.menu('file:import-folder');
      await app.waitFor(() => app.notice() === expected);
      expect(app.dialogs, 'the App asked the desktop shell for a folder').toEqual(['folder']);
      expect(app.notice(), 'after the import, the status line says how many files were left out').toBe(expected);
      for (const name of read) expect(app.text(), `${name} was imported`).toContain(name);

      // it is not a passing status line: it stays until it is dismissed or replaced
      await app.advance(6_000);
      expect(app.notice(), '6 s later').toBe(expected);

      // the next import left nothing out: it says nothing of files left out
      app.menu('file:import-folder');
      await app.waitFor(() => app.notice() !== expected);
      expect(app.dialogs).toEqual(['folder', 'folder']);
      expect(app.notice(), 'a folder read whole').toBe('Batch imported 6 sequence files into active session');
      expect(app.text()).not.toContain('not imported');

      // files left out and a file that failed: the notice keeps the batch's failure, which it replaces
      const withFailure = '4 of the 7 supported files in the folder were not imported: Import Folder reads the first 3, by name.'
        + ' Of the 3 read, 1 failed to import: blank.fasta.';
      app.menu('file:import-folder');
      await app.waitFor(() => app.notice() === withFailure);
      expect(app.notice(), 'a folder import that left files out and failed one').toBe(withFailure);
    } finally {
      app.unmount();
    }
  });
});
