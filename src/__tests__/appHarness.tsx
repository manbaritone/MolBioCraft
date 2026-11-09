// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The App test harness: the real App, mounted with React DOM's client renderer (`createRoot`, the
 * renderer the app runs) over the live DOM (liveDom.ts), and driven through its own input routes.
 * Copied from the mountApp of documentTableBottom.test.tsx and the studio mount of
 * alignmentPaneResize.test.tsx, which keep their own copies, and extended:
 *
 * - each mount is a launch: the window, document, navigator and storage are stubbed and the app's
 *   own modules are loaded afresh (packages under node_modules, React among them, load once per test
 *   file), so no App state carries over from an earlier mount but the storage a test hands on; and
 *   the App's lazy chunks (the ten studios and the database explorer, App.tsx's React.lazy imports)
 *   are imported before the App mounts, so a studio tab draws its studio, not its Suspense fallback,
 *   once the harness settles;
 * - every input runs in React's act and then settles: pending promises resolve, animation frames run
 *   and resize observers hear of changed boxes, until the page stops changing;
 * - a menu command goes through the App's own dispatcher, by the `mbc:native-menu` window event the
 *   macOS app's native menu sends, and an id the dispatcher has no case for is refused by name;
 * - clicks, field edits and key presses with modifiers are the browser's own events (liveDom.ts), so
 *   they reach the handlers React gave the App's elements and the listeners the App put on the window;
 * - restoreSession writes a session built in the test with the App's own autosave writers
 *   (saveWorkbenchToLocalAutosave, and its saved-or-not flag) and restores it with File > Restore
 *   Autosave, the App's own path, then checks the App says it restored it, on the tab asked for;
 * - every file the App hands to the browser to save (an object URL on a link with `download`) is
 *   kept, readable;
 * - `macHost()` mounts on a macOS desktop host: a macOS user agent, and the Tauri runtime reported by
 *   src/lib/tauriIpc mocked with `tauriIpcMock()` (isTauriDesktopRuntime true, syncNativeMenuStateTauri
 *   recorded; the rest of the module is the real one). vi.mock is hoisted per test file, so a test
 *   file that needs it declares, before its imports run:
 *
 *     vi.mock('../lib/tauriIpc', async (importOriginal) =>
 *       (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));
 *
 * The App's own timers (the start-up splash, status notices) wait on fake timers and are dropped at
 * unmount. React DOM must first be loaded by mountApp, under the live DOM, or it decides it is not in
 * a browser and ignores a text field's input and change events; mountApp refuses to run when
 * something loaded it earlier.
 */

import { afterEach, expect, vi } from 'vitest';
import type { NativeMenuStatePayload } from '../core/commandAvailability';
import type { MbcViewerTabId, MbcWorkspaceUiState } from '../core/mbcSessionFormat';
import type { SequenceDocument } from '../types/bio';
import {
  LiveDocument,
  LiveElement,
  LiveResizeObservers,
  LiveWindow,
  LiveXMLSerializer,
  liveDomConstructors,
  memoryStorage,
  NO_LAYOUT,
  userChange,
  userClick,
  userInput,
  userPress,
  type KeyModifiers,
  type Layout,
  type LiveStorage,
  type Step,
} from './liveDom';

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const nodeFs = await load<{ readFileSync: (p: URL, enc: string) => string }>('node:fs');
const nodeModule = await load<{ createRequire: (url: string) => { cache: Record<string, unknown> } }>('node:module');
const realSetImmediate = (globalThis as unknown as { setImmediate: (fn: () => void) => void }).setImmediate;
/** One turn of the event loop, on the real clock. */
const macrotask = () => new Promise<void>((resolve) => realSetImmediate(resolve));

/** The App's lazy chunks, by the specifier App.tsx imports them with: the ten studios (eight modules) and the database explorer. */
export const LAZY_CHUNKS: Readonly<Record<string, () => Promise<unknown>>> = {
  './components/WorkflowPipelineStudio': () => import('../components/WorkflowPipelineStudio'),
  './components/CloningAndGelStudio': () => import('../components/CloningAndGelStudio'),
  './components/PrimerAndPCRStudio': () => import('../components/PrimerAndPCRStudio'),
  './components/AlignmentAndPhyloStudio': () => import('../components/AlignmentAndPhyloStudio'),
  './components/ChromatogramAndContigStudio': () => import('../components/ChromatogramAndContigStudio'),
  './components/HybridToolsAndHistoryStudio': () => import('../components/HybridToolsAndHistoryStudio'),
  './components/VectorLibraryAndDesignStudio': () => import('../components/VectorLibraryAndDesignStudio'),
  './components/GenomicsNgsAndPredictionStudio': () => import('../components/GenomicsNgsAndPredictionStudio'),
  './components/DatabaseExplorerModal': () => import('../components/DatabaseExplorerModal'),
};

let appSource: string | null = null;
/** src/App.tsx, as text. */
export function appTsxSource(): string {
  appSource ??= nodeFs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  return appSource;
}
let dispatcherIds: Set<string> | null = null;
/** The command ids the App's menu dispatcher (its onMenuAction) has a case for. */
export function menuCommandIds(): Set<string> {
  if (dispatcherIds) return dispatcherIds;
  const src = appTsxSource();
  const start = src.indexOf('onMenuAction: (actionId: string) => {');
  const end = src.indexOf('onNativeFileOpen: (file, mode) => {', start);
  if (start < 0 || end < 0) throw new Error('App.tsx no longer holds the menu dispatcher the harness reads (onMenuAction, then onNativeFileOpen)');
  dispatcherIds = new Set([...src.slice(start, end).matchAll(/case '([^']+)':/g)].map((m) => m[1]));
  return dispatcherIds;
}

// ─── The Tauri runtime, mocked for a macOS host ───

/** State shared by every copy of this module (a fresh launch loads a fresh copy; the mock and the test may hold different ones). */
interface IpcState { desktop: boolean; menuStates: NativeMenuStatePayload[] }
const IPC_KEY = Symbol.for('molbiocraft.appHarness.tauriIpc');
const ipc = (): IpcState => {
  const g = globalThis as unknown as Record<symbol, IpcState | undefined>;
  return (g[IPC_KEY] ??= { desktop: false, menuStates: [] });
};
const MOCK_MARK = '__appHarnessTauriIpcMock';

/**
 * src/lib/tauriIpc for vi.mock: the real module, with isTauriDesktopRuntime reporting the Tauri
 * runtime while the App is mounted on a macOS host (macHost()), and syncNativeMenuStateTauri
 * recording each native-menu state the App sends. Off a macOS host the runtime is reported absent, as
 * in the browser build, and a sync then throws.
 */
export function tauriIpcMock<T extends object>(actual: T): T {
  return {
    ...actual,
    [MOCK_MARK]: true,
    isTauriDesktopRuntime: () => ipc().desktop,
    syncNativeMenuStateTauri: async (statePayload: NativeMenuStatePayload) => {
      const state = ipc();
      if (!state.desktop) throw new Error('the App synced the native menu on a host with no Tauri runtime');
      state.menuStates.push(JSON.parse(JSON.stringify(statePayload)) as NativeMenuStatePayload);
      return Object.keys(statePayload.overrides).length;
    },
  } as T;
}

// ─── Mounting ───

export type Host = 'macos' | 'linux';
export interface MountOptions {
  /** The desktop host: a Linux browser window (the in-window menu bar), unless 'macos' (see macHost). */
  host?: Host;
  /** The window's inner size (1280 x 800 unless given). */
  width?: number;
  height?: number;
  /** The page's local storage (empty memory storage unless given; blockedStorage() for a sandboxed webview). */
  storage?: LiveStorage;
  /** The box each element is laid out at (every box 0 x 0 unless given). */
  layout?: Layout;
}
/** Mount options for a macOS desktop host: a macOS user agent and the mocked Tauri runtime (tauriIpcMock). */
export const macHost = (more: Omit<MountOptions, 'host'> = {}): MountOptions => ({ ...more, host: 'macos' });

const USER_AGENT: Record<Host, string> = {
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',
};

/** A file the App handed to the browser to save. */
export interface SavedFile {
  filename: string;
  /** The object URL (or data URL) the link pointed at. */
  href: string;
  /** The MIME type the App gave the file. */
  type: string;
  /** The file's contents, as text. */
  text(): Promise<string>;
}

/** A session a test builds: its documents, the one open, and the tab it is open on. */
export interface SessionSpec {
  documents: SequenceDocument[];
  activeDocId: string;
  viewerTab: MbcViewerTabId;
  sessionName?: string;
  /** Any other workspace state to restore (layout, zoom, display settings, ...). */
  workspace?: Partial<MbcWorkspaceUiState>;
  /** Whether the autosave holds work never saved to a file (the App then treats the restored session as modified); false unless given. */
  unsaved?: boolean;
}

/** Modifier keys for a press; `mod` is the platform's command key (Cmd on macOS, Ctrl elsewhere). */
export interface PressModifiers extends KeyModifiers { mod?: boolean }

export interface AppHarness {
  readonly doc: LiveDocument;
  readonly win: LiveWindow;
  readonly container: LiveElement;
  readonly host: Host;
  /** Runs a menu command through the App's dispatcher, as the native menu sends it. */
  menu(id: string): Promise<void>;
  /** Clicks the viewer header's tab for `tab`. */
  clickTab(tab: MbcViewerTabId): Promise<void>;
  /** A pointer click (pointer and mouse down and up, the click and its activation). */
  click(el: LiveElement, init?: Record<string, unknown>): Promise<void>;
  /** A committed edit of a field: text, a select's option, or a checkbox ticked or cleared. */
  change(el: LiveElement, value: string | boolean): Promise<void>;
  /** An edit of a text-like field still being typed: the input event only. */
  input(el: LiveElement, value: string): Promise<void>;
  /** A key press on the focused element, with modifiers. */
  press(key: string, mods?: PressModifiers): Promise<void>;
  /** Waits for the page to stop changing: promises, animation frames, resize observers. */
  settle(): Promise<void>;
  /** The elements in the page (the App and anything it portals) that match `selector`. */
  all(selector: string): LiveElement[];
  /** The one element in the page that matches `selector`; any other count throws, naming it. */
  one(selector: string, what?: string): LiveElement;
  /** The viewer header (the studio tabs and the view controls). */
  header(): LiveElement;
  /** The header's inspector toggle (its label says Show or Hide ... Inspector), or null when the tab shows none. */
  inspectorButton(): LiveElement | null;
  /** The inspector column (the body split's aside), or null while it is hidden. */
  inspectorAside(): LiveElement | null;
  /** The viewer canvas the studio or view draws in. */
  canvas(): LiveElement;
  /** The viewer body split: the canvas, the resize handle and the inspector column. */
  bodySplit(): LiveElement;
  /** The tab the viewer header shows selected. */
  activeTab(): string | null;
  /** Every file the App has handed to the browser to save, in order. */
  downloads(): SavedFile[];
  /** Every native-menu state the App has sent (needs tauriIpcMock; empty off a macOS host). */
  nativeMenuStates(): NativeMenuStatePayload[];
  /** Loads a session built in the test through the App's autosave restore. */
  restoreSession(session: SessionSpec): Promise<void>;
  unmount(): void;
}

/** The live mount, and the name of the test that made it. */
interface LiveMount { app: AppHarness; test: string }
const MOUNT_KEY = Symbol.for('molbiocraft.appHarness.liveMount');
/** The one live mount, on globalThis so a module reset cannot split it in two (as for IPC_KEY). */
function mountSlot(): { current: LiveMount | null } {
  const g = globalThis as unknown as Record<symbol, { current: LiveMount | null } | undefined>;
  return (g[MOUNT_KEY] ??= { current: null });
}
/** The test running now, as Vitest names it; '' outside a test. */
function currentTest(): string {
  try {
    return expect.getState().currentTestName ?? '';
  } catch {
    return '';
  }
}

/**
 * Unmounts an App a test left behind and puts back the globals its launch stubbed, reporting whether
 * there was one. The harness installs this as its own `afterEach` below, so no caller's `finally` is
 * load-bearing: a test that dies before its cleanup - a timeout, an abort, a throw outside the
 * `finally` - cannot carry its mount into the next test (BG-01M6XTHE).
 */
export function releaseLeakedMount(): boolean {
  const slot = mountSlot();
  const live = slot.current;
  if (!live) return false;
  try {
    live.app.unmount();
  } finally {
    slot.current = null;
  }
  return true;
}

// Registered as the test file imports the harness, so it covers every test in the file. mountApp's
// vi.resetModules() can have the harness re-evaluated inside a running test (through a hoisted
// vi.mock factory that imports it): hooks cannot be registered then, and that copy needs none,
// since the mount it would guard is held on globalThis.
try {
  afterEach(releaseLeakedMount);
} catch {
  /* re-evaluated inside a test: the collection-time copy's hook already owns the leak */
}

const REACT_DOM_KEY = Symbol.for('molbiocraft.appHarness.reactDomUnderLiveDom');
/** Whether Node has already loaded React DOM in this test file's process. */
function reactDomLoaded(): boolean {
  const cache = nodeModule.createRequire(import.meta.url).cache;
  return Object.keys(cache).some((k) => /[\\/]react-dom[\\/]cjs[\\/]react-dom\.[\w.]+\.js$/.test(k));
}

/** Sets globals, returning the step that puts every one back as it was. */
function stubGlobals(values: Record<string, unknown>): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  for (const [k, v] of Object.entries(values)) Object.defineProperty(g, k, { value: v, configurable: true, writable: true, enumerable: true });
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(g, k, d); else delete g[k];
    }
  };
}

const describeEl = (el: LiveElement) => `<${el.localName}${el.getAttribute('class') ? ` class="${el.getAttribute('class')}"` : ''}${el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : ''}>`;
const MAX_SETTLE_ROUNDS = 60;

/**
 * Mounts the real App in a fresh launch over the live DOM and settles it. One App at a time: unmount
 * it (in a finally) before the next. A mount a previous test left behind is cleared here rather than
 * cascaded, so the next test's failure names that test and not the harness.
 */
export async function mountApp(opts: MountOptions = {}): Promise<AppHarness> {
  const slot = mountSlot();
  const live = slot.current;
  if (live) {
    const here = currentTest();
    if (!here || !live.test || here === live.test) {
      throw new Error('an App is already mounted in this test: unmount it before mounting another (one App at a time over one live DOM)');
    }
    // The afterEach above normally clears a leak; this is the last resort if it did not run.
    console.warn(`appHarness: the App mounted by "${live.test}" was never unmounted - a leak from a previous test, not a double mount in this one; the harness has unmounted it so "${here}" can mount`);
    releaseLeakedMount();
  }
  const host: Host = opts.host ?? 'linux';
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!g[REACT_DOM_KEY] && reactDomLoaded()) {
    throw new Error('react-dom was loaded before the live DOM existed, so React DOM decided it is not in a browser (it then ignores the input and change events of a text field); load the App and React DOM only through mountApp');
  }

  const doc = new LiveDocument();
  doc.layout = opts.layout ?? NO_LAYOUT;
  const clipboard = { text: '' };
  const navigator = {
    userAgent: USER_AGENT[host], platform: host === 'macos' ? 'MacIntel' : 'Linux x86_64', language: 'en-US', languages: ['en-US'],
    maxTouchPoints: 0, hardwareConcurrency: 4, onLine: true,
    clipboard: { writeText: async (t: string) => { clipboard.text = String(t); }, readText: async () => clipboard.text },
  };
  const storage = opts.storage ?? memoryStorage();
  const win = new LiveWindow(doc, { width: opts.width, height: opts.height, navigator, localStorage: storage, sessionStorage: memoryStorage() });
  const observers = new LiveResizeObservers();
  const restoreGlobals = stubGlobals({
    window: win, document: doc, navigator, localStorage: storage, sessionStorage: win.sessionStorage,
    requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
    ResizeObserver: observers.Ctor, XMLSerializer: LiveXMLSerializer,
    getComputedStyle: (el: unknown) => win.getComputedStyle(el), matchMedia: (q: string) => win.matchMedia(q),
    IS_REACT_ACT_ENVIRONMENT: true,
    ...liveDomConstructors,
  });
  // Files the App hands to the browser: an object URL for each, kept readable until unmount.
  const blobs = new Map<string, Blob>();
  const urlMethods = (['createObjectURL', 'revokeObjectURL'] as const).map((k) => [k, Object.getOwnPropertyDescriptor(URL, k)] as const);
  let nextUrl = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (obj: Blob) => { const url = `blob:molbiocraft-harness/${++nextUrl}`; blobs.set(url, obj); return url; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} });
  const state = ipc();
  state.desktop = host === 'macos';
  state.menuStates = [];
  let fakeTimers = false;
  const teardown = () => {
    if (fakeTimers) { vi.clearAllTimers(); vi.useRealTimers(); }
    for (const [k, d] of urlMethods) { if (d) Object.defineProperty(URL, k, d); else delete (URL as unknown as Record<string, unknown>)[k]; }
    restoreGlobals();
    state.desktop = false;
    state.menuStates = [];
  };

  try {
    vi.resetModules();
    // One at a time: a module imported alongside another that imports it can miss a vi.mock of it
    // (Vitest 2), so the App would see the real Tauri module on a macOS host.
    const React = await import('react');
    const ReactDomClient = await import('react-dom/client');
    g[REACT_DOM_KEY] = true;
    const AppModule = await import('../App');
    for (const chunk of Object.values(LAZY_CHUNKS)) await chunk();
    const session = await import('../core/mbcSessionFormat');
    const tauri = await import('../lib/tauriIpc');
    const mocked = Boolean((tauri as unknown as Record<string, unknown>)[MOCK_MARK]);
    if (host === 'macos' && !mocked) {
      throw new Error("a macOS host needs src/lib/tauriIpc mocked in the test file: vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()))");
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    fakeTimers = true;

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = ReactDomClient.createRoot(container as unknown as Element);
    /** Each input event is its own task, as in a browser: its renders and effects have run before the next. */
    const step: Step = (fn) => { void React.act(fn); };

    const settle = async () => {
      let quiet = 0;
      for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
        const before = doc.mutations;
        await React.act(async () => { await macrotask(); });
        let delivered = false;
        const frames = win.animationFrames.take();
        if (frames.length) {
          delivered = true;
          const now = performance.now();
          step(() => { for (const f of frames) f(now); });
        }
        const observed = observers.due();
        if (observed.length) {
          delivered = true;
          step(() => { for (const deliver of observed) deliver(); });
        }
        if (delivered || doc.mutations !== before) quiet = 0;
        else if (++quiet >= 2) return;
      }
      throw new Error(`the App never settled: after ${MAX_SETTLE_ROUNDS} rounds it still changes the page (${win.animationFrames.queue.size} animation frames pending)`);
    };
    const inPage = (el: LiveElement, what: string) => {
      if (!(el instanceof LiveElement)) throw new Error(`${what}: not an element of the live DOM`);
      if (!doc.contains(el)) throw new Error(`${what}: ${describeEl(el)} is no longer in the page`);
    };
    // The whole page: the App's root, and anything it portals elsewhere in the body.
    const all = (selector: string) => doc.body.querySelectorAll(selector);
    const exactlyOne = (found: LiveElement[], what: string) => {
      if (found.length !== 1) throw new Error(`expected one ${what}, found ${found.length}${found.length ? `: ${found.map(describeEl).join(', ')}` : ''}`);
      return found[0];
    };
    const atMostOne = (found: LiveElement[], what: string) => {
      if (found.length > 1) throw new Error(`expected at most one ${what}, found ${found.length}: ${found.map(describeEl).join(', ')}`);
      return found[0] ?? null;
    };
    const header = () => exactlyOne(all('.mbc-viewer-header'), 'viewer header');
    const bodySplit = () => exactlyOne(all('.mbc-viewer-body-split'), 'viewer body split');
    const activeTab = () => {
      const selected = header().querySelectorAll('button[role="tab"][aria-selected="true"]').filter((b) => b.hasAttribute('data-view'));
      return atMostOne(selected, 'selected viewer tab')?.getAttribute('data-view') ?? null;
    };
    let restores = 0;
    const menu = async (id: string) => {
      if (!menuCommandIds().has(id) && !id.startsWith('action-vec:')) throw new Error(`the App's menu dispatcher has no case for "${id}"`);
      step(() => { win.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: id })); });
      await settle();
    };

    const harness: AppHarness = {
      doc, win, container, host,
      menu,
      clickTab: async (tab) => {
        const tabs = header().querySelectorAll('button[role="tab"][data-view]');
        const hit = tabs.filter((b) => b.getAttribute('data-view') === tab);
        if (hit.length !== 1) throw new Error(`the viewer header has ${hit.length ? `${hit.length}` : 'no'} ${tab} tab; it shows ${tabs.map((b) => b.getAttribute('data-view')).join(', ') || 'none'}`);
        userClick(hit[0], {}, step);
        await settle();
      },
      click: async (el, init = {}) => { inPage(el, 'click'); userClick(el, init, step); await settle(); },
      change: async (el, value) => { inPage(el, 'change'); userChange(el, value, step); await settle(); },
      input: async (el, value) => { inPage(el, 'input'); userInput(el, value, step); await settle(); },
      press: async (key, mods = {}) => {
        const { mod, ...rest } = mods;
        const held: KeyModifiers = { ...rest, meta: Boolean(rest.meta || (mod && host === 'macos')), ctrl: Boolean(rest.ctrl || (mod && host !== 'macos')) };
        userPress(doc, key, held, step);
        await settle();
      },
      settle,
      all,
      one: (selector, what = selector) => exactlyOne(all(selector), what),
      header,
      inspectorButton: () => atMostOne(header().querySelectorAll('button[aria-label]').filter((b) => /^(Show|Hide)\b.*\bInspector$/.test(b.getAttribute('aria-label') ?? '')), 'inspector button'),
      inspectorAside: () => atMostOne(bodySplit().children.filter((c) => c.tagName === 'ASIDE'), 'inspector column'),
      canvas: () => exactlyOne(all('.mbc-viewer-canvas'), 'viewer canvas'),
      bodySplit,
      activeTab,
      downloads: () => doc.downloads.map((d) => {
        const blob = blobs.get(d.href) ?? null;
        return {
          filename: d.filename,
          href: d.href,
          type: blob?.type ?? (/^data:([^;,]*)/.exec(d.href)?.[1] ?? ''),
          text: async () => {
            if (blob) return blob.text();
            const data = /^data:[^,]*?(;base64)?,(.*)$/s.exec(d.href);
            if (data) return data[1] ? atob(data[2]) : decodeURIComponent(data[2]);
            throw new Error(`the App saved "${d.filename}" from ${d.href}, a URL the harness holds no file for`);
          },
        };
      }),
      nativeMenuStates: () => {
        if (!mocked) throw new Error('src/lib/tauriIpc is not mocked with tauriIpcMock(), so the native-menu states the App sends cannot be read');
        return state.menuStates.map((s) => JSON.parse(JSON.stringify(s)) as NativeMenuStatePayload);
      },
      restoreSession: async (spec) => {
        const ids = spec.documents.map((d) => d.id);
        if (!ids.length) throw new Error('a session to restore needs at least one document');
        if (new Set(ids).size !== ids.length) throw new Error(`the session's documents share an id: ${ids.join(', ')}`);
        if (!ids.includes(spec.activeDocId)) throw new Error(`the session holds no document "${spec.activeDocId}" to open; it holds ${ids.join(', ')}`);
        // A name of its own unless the test gives one, so an earlier restore's notice is not read as this one's.
        const sessionName = spec.sessionName ?? `Harness_Session_${++restores}`;
        const written = session.saveWorkbenchToLocalAutosave({
          sessionName,
          documents: spec.documents,
          workspace: {
            activeDocId: spec.activeDocId, selectedFolder: 'All Project Files', navHistory: [spec.activeDocId], navIndex: 0,
            viewerTab: spec.viewerTab, mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
            darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
            displaySettings: {
              showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
              showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: true,
            },
            ...spec.workspace,
          },
        });
        if (!written) throw new Error('the App\'s autosave writer wrote nothing (the storage refused it), so there is no session to restore');
        session.writeWorkbenchAutosaveDirtyFlag(spec.unsaved ?? false);
        await menu('file:restore-autosave');
        const said = `Restored workbench "${sessionName}.mbc"`;
        if (!doc.body.textContent.includes(said)) throw new Error(`the App did not restore the session: it never says ${said} (a dialog may be asking first)`);
        if (all('dialog[open], .mbc-modal-backdrop').length) throw new Error('the App holds the restore behind a dialog that is still open');
        const shown = activeTab();
        if (shown !== spec.viewerTab) throw new Error(`the App restored the session on the ${shown ?? 'no'} tab, not ${spec.viewerTab}`);
      },
      unmount: () => {
        try {
          step(() => root.unmount());
        } finally {
          teardown();
          mountSlot().current = null;
        }
      },
    };

    try {
      await React.act(async () => { root.render(React.createElement(AppModule.App)); });
      await settle();
    } catch (err) {
      try { step(() => root.unmount()); } catch { /* the mount failed: report why it did, not the unmount */ }
      throw err;
    }
    slot.current = { app: harness, test: currentTest() };
    return harness;
  } catch (err) {
    teardown();
    throw err;
  }
}
