// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The session autosave (BG-01M7CKYQ): it is kept in IndexedDB, which has no ~5 MB localStorage
 * quota (WebKit, the macOS desktop app's engine, refused the Sample Project there), an autosave
 * written by an older build to localStorage is still restored, and a failure comes back as a
 * named result that the app shows the user once per failure run instead of being swallowed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_IDB_NAME,
  AUTOSAVE_IDB_STORE,
  QUIT_AUTOSAVE_TIMEOUT_MS,
  autosaveWorkbenchWithin,
  clearWorkbenchLocalAutosave,
  createAutosaveFailureNotice,
  createIndexedDbAutosaveStore,
  describeAutosaveFailure,
  hasWorkbenchLocalAutosave,
  loadWorkbenchFromLocalAutosave,
  readNewestLocalStorageWorkbenchAutosave,
  autosaveWorkbench,
  serializeMbcWorkbench,
  workbenchAutosaveNeedsRecovery,
  writeWorkbenchAutosaveDirtyFlag,
  type MbcWorkbenchSnapshot,
  type WorkbenchAutosaveResult,
  type WorkbenchAutosaveStore,
} from '../core/mbcSessionFormat';
import type { SequenceDocument } from '../types/bio';
import { mountApp, releaseLeakedMount, type AppHarness } from './appHarness';
import { memoryStorage } from './liveDom';

const LEGACY_KEY = 'molbiocraft.workbench.autosave.v1';
const LEGACY_SAVED_AT_KEY = 'molbiocraft.workbench.autosave.v1.savedAt';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function quotaError(): Error {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

/** localStorage with WebKit's ~5 MB cap: a value over `capChars` is refused with QuotaExceededError. */
function installLocalStorage(capChars = 5_000_000) {
  const data = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: Storage };
  const original = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (String(v).length > capChars) throw quotaError();
      data.set(k, String(v));
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return { data, restore: () => (g.localStorage = original) };
}

/** One turn of the event loop on the real clock (the App harness fakes setTimeout, not setImmediate). */
const realSetImmediate = (globalThis as unknown as { setImmediate: (fn: () => void) => void }).setImmediate;
const later = (fn: () => void) => realSetImmediate(fn);

function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

interface FakeIdbOptions {
  quotaChars?: number;
  openThrows?: boolean;
  /** Every open is blocked (onblocked) and never succeeds. */
  blocked?: boolean;
}

/**
 * Just enough of IDBFactory for the autosave adapter: open with upgrade, one object store,
 * put/get/delete in a transaction that completes or aborts asynchronously. `quotaChars` makes a
 * larger put abort its transaction with QuotaExceededError, as a full origin does. The returned
 * controls drop every open connection as WKWebView does (with or without its close event), make the
 * next transaction abort with a lost-connection UnknownError, make writes hang or throw, and count opens.
 */
function createFakeIndexedDb(opts: FakeIdbOptions = {}) {
  const databases = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();
  const connections: Array<{ closed: boolean; onclose?: (() => void) | null }> = [];
  const control = {
    opens: 0,
    /** Transactions refused because their connection was closed. */
    refused: 0,
    openThrows: Boolean(opts.openThrows),
    blocked: Boolean(opts.blocked),
    /** Transactions to abort with WebKit's lost-connection UnknownError. */
    lostTransactions: 0,
    /** Writes (put) never complete. */
    hangWrites: false,
    /** Writes (put) abort with this error. */
    writeError: null as Error | null,
  };
  const factory = {
    open(name: string, version: number) {
      if (control.openThrows) throw new Error('IndexedDB is disabled');
      control.opens += 1;
      const request: Record<string, unknown> & { result?: unknown } = {};
      later(() => {
        if (control.blocked) {
          (request.onblocked as (() => void) | undefined)?.();
          return;
        }
        let entry = databases.get(name);
        const upgrading = !entry || entry.version < version;
        if (!entry) {
          entry = { version, stores: new Map() };
          databases.set(name, entry);
        }
        const db = entry;
        const conn: { closed: boolean; onclose?: (() => void) | null } & Record<string, unknown> = {
          closed: false,
          objectStoreNames: { contains: (s: string) => db.stores.has(s) },
          createObjectStore: (s: string) => void db.stores.set(s, new Map()),
          close: () => void (conn.closed = true),
          transaction(storeName: string) {
            if (conn.closed) control.refused += 1;
            if (conn.closed) throw namedError('InvalidStateError', 'The database connection is closing.');
            const rows = db.stores.get(storeName);
            if (!rows) throw new Error(`no object store ${storeName}`);
            const steps: Array<() => void> = [];
            const tx: Record<string, unknown> = { error: null };
            let writes = false;
            const req = (fn: () => unknown) => {
              const r: { result?: unknown } = {};
              steps.push(() => (r.result = fn()));
              return r;
            };
            tx.objectStore = () => ({
              put: (value: unknown, key: string) => {
                writes = true;
                return req(() => {
                  if (control.writeError) throw control.writeError;
                  if (opts.quotaChars !== undefined && JSON.stringify(value).length > opts.quotaChars) throw quotaError();
                  rows.set(key, structuredClone(value));
                  return key;
                });
              },
              get: (key: string) => req(() => structuredClone(rows.get(key))),
              delete: (key: string) => req(() => void rows.delete(key)),
            });
            later(() => {
              if (writes && control.hangWrites) return; // never completes nor aborts
              try {
                if (control.lostTransactions > 0) {
                  control.lostTransactions -= 1;
                  throw namedError('UnknownError', 'Connection to Indexed Database server lost. Refresh the page to try again');
                }
                steps.forEach((s) => s());
              } catch (err) {
                tx.error = err;
                (tx.onabort as (() => void) | undefined)?.();
                return;
              }
              (tx.oncomplete as (() => void) | undefined)?.();
            });
            return tx;
          },
        };
        connections.push(conn);
        request.result = conn;
        if (upgrading) {
          db.version = version;
          (request.onupgradeneeded as (() => void) | undefined)?.();
        }
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  };
  const rows = () => databases.get(AUTOSAVE_IDB_NAME)?.stores.get(AUTOSAVE_IDB_STORE);
  /** The browser drops every open connection; `withEvent` says whether it also fires close. */
  const dropConnections = (withEvent: boolean) => {
    for (const c of connections) {
      if (c.closed) continue;
      c.closed = true;
      if (withEvent) c.onclose?.();
    }
  };
  return { factory: factory as unknown as IDBFactory, rows, control, dropConnections };
}

function snapshotOf(sequence: string, sessionName = 'Autosave test'): MbcWorkbenchSnapshot {
  const doc: SequenceDocument = {
    id: 'doc-1',
    name: 'big',
    accession: 'TEST0001',
    description: 'autosave fixture',
    sequence,
    topology: 'linear',
    moleculeType: 'DNA',
    features: [],
    primers: [],
    history: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    folder: 'Genomes',
  };
  return {
    sessionName,
    documents: [doc],
    workspace: {
      activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode: 'linear', zoomLevel: 100, textFormat: 'genbank',
      colorScheme: 'standard', darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: { showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
    },
  };
}

const bigSequence = 'ACGT'.repeat(1_600_000); // 6.4 Mb: over WebKit's ~5 MB localStorage quota

describe('session autosave storage (BG-01M7CKYQ)', () => {
  let ls: ReturnType<typeof installLocalStorage>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => ls.restore());

  it('keeps a session larger than the localStorage quota in IndexedDB and restores it intact', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    const result = await autosaveWorkbench(snapshotOf(bigSequence), store);
    expect(result).toEqual({ ok: true, location: 'indexeddb' });
    expect(ls.data.has(LEGACY_KEY)).toBe(false);
    expect(idb.rows()?.size).toBe(1);
    // The launch-time offer is synchronous: it must know an IndexedDB autosave exists.
    expect(hasWorkbenchLocalAutosave()).toBe(true);
    writeWorkbenchAutosaveDirtyFlag(true);
    expect(workbenchAutosaveNeedsRecovery()).toBe(true);

    const read = await loadWorkbenchFromLocalAutosave(createIndexedDbAutosaveStore(idb.factory));
    expect(read.status).toBe('found');
    if (read.status !== 'found') return;
    expect(read.location).toBe('indexeddb');
    expect(read.parsed.envelope.sessionName).toBe('Autosave test');
    expect(read.parsed.envelope.documents[0].sequence.length).toBe(bigSequence.length);
    expect(read.parsed.envelope.documents[0].sequence).toBe(bigSequence);
  }, 60_000);

  it('returns a named quota failure instead of swallowing it when no storage can hold the session', async () => {
    const idb = createFakeIndexedDb({ quotaChars: 1_000 });
    const result = await autosaveWorkbench(snapshotOf(bigSequence), createIndexedDbAutosaveStore(idb.factory));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('quota');
    expect(createAutosaveFailureNotice()(result)).toMatch(/too large for browser storage.*File › Save Session/);
  }, 60_000);

  it('falls back to localStorage for a small session when IndexedDB cannot be opened, and reports when that fails too', async () => {
    const broken = createIndexedDbAutosaveStore(createFakeIndexedDb({ openThrows: true }).factory);
    const small = await autosaveWorkbench(snapshotOf('ACGTACGT'), broken);
    expect(small).toEqual({ ok: true, location: 'localStorage' });
    expect(ls.data.has(LEGACY_KEY)).toBe(true);

    const large = await autosaveWorkbench(snapshotOf(bigSequence), broken);
    expect(large.ok).toBe(false);
    if (large.ok) return;
    expect(large.reason).toBe('quota');
    expect(large.detail).toMatch(/IndexedDB is disabled/);
    // The earlier (small) autosave is not destroyed by the failed write.
    expect(ls.data.has(LEGACY_KEY)).toBe(true);

    const none = await autosaveWorkbench(snapshotOf('ACGT'), null);
    expect(none).toEqual({ ok: true, location: 'localStorage' });
  }, 60_000);

  it('still restores an autosave an older build left in localStorage, and keeps it until a newer one is stored', async () => {
    const idb = createFakeIndexedDb();
    ls.data.set(LEGACY_KEY, serializeMbcWorkbench(snapshotOf('GATTACA', 'Legacy session')));
    expect(hasWorkbenchLocalAutosave()).toBe(true);
    expect(workbenchAutosaveNeedsRecovery()).toBe(true);

    const read = await loadWorkbenchFromLocalAutosave(createIndexedDbAutosaveStore(idb.factory));
    expect(read.status).toBe('found');
    if (read.status !== 'found') return;
    expect(read.location).toBe('localStorage');
    expect(read.parsed.envelope.sessionName).toBe('Legacy session');
    // Reading it does not consume it.
    expect(ls.data.has(LEGACY_KEY)).toBe(true);

    // A failed IndexedDB write that also cannot fall back must not lose it.
    const failing = { read: async () => null, write: async () => { throw quotaError(); }, remove: async () => {} };
    const lsQuota = installLocalStorage(10);
    lsQuota.data.set(LEGACY_KEY, ls.data.get(LEGACY_KEY)!);
    const failed = await autosaveWorkbench(snapshotOf('ACGT'), failing);
    expect(failed.ok).toBe(false);
    expect(lsQuota.data.has(LEGACY_KEY)).toBe(true);
    lsQuota.restore();

    // A newer autosave stored in IndexedDB supersedes it.
    const store = createIndexedDbAutosaveStore(idb.factory);
    expect(await autosaveWorkbench(snapshotOf('CCCC', 'Newer session'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(ls.data.has(LEGACY_KEY)).toBe(false);
    const after = await loadWorkbenchFromLocalAutosave(store);
    expect(after.status === 'found' && after.parsed.envelope.sessionName).toBe('Newer session');
  }, 60_000);

  it('prefers a localStorage autosave written after the IndexedDB one (fallback or older build)', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('AAAA', 'Older in IndexedDB'), store);
    ls.data.set(LEGACY_KEY, serializeMbcWorkbench(snapshotOf('TTTT', 'Newer in localStorage')));
    const read = await loadWorkbenchFromLocalAutosave(store);
    expect(read.status === 'found' && read.parsed.envelope.sessionName).toBe('Newer in localStorage');
  });

  it('tells a missing autosave apart from an unreadable one', async () => {
    const store = createIndexedDbAutosaveStore(createFakeIndexedDb().factory);
    expect(await loadWorkbenchFromLocalAutosave(store)).toEqual({ status: 'missing' });
    ls.data.set(LEGACY_KEY, '{ not an mbc session');
    const read = await loadWorkbenchFromLocalAutosave(store);
    expect(read.status).toBe('unreadable');
  });

  it('clears the IndexedDB autosave as well as the localStorage keys', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('ACGT'), store);
    writeWorkbenchAutosaveDirtyFlag(true);
    await clearWorkbenchLocalAutosave(store);
    expect(hasWorkbenchLocalAutosave()).toBe(false);
    expect(workbenchAutosaveNeedsRecovery()).toBe(false);
    expect(idb.rows()?.size).toBe(0);
    expect(await loadWorkbenchFromLocalAutosave(store)).toEqual({ status: 'missing' });
  });
});

describe('autosave failure notice (BG-01M7CKYQ)', () => {
  const quota: WorkbenchAutosaveResult = { ok: false, reason: 'quota', detail: 'QuotaExceededError' };
  const broken: WorkbenchAutosaveResult = { ok: false, reason: 'error', detail: 'disk I/O error' };
  const saved: WorkbenchAutosaveResult = { ok: true, location: 'indexeddb' };

  it('names the failure once per run of failures, not on every autosave tick', () => {
    const notice = createAutosaveFailureNotice();
    expect(notice(quota)).toMatch(/^Autosave failed: the session is too large for browser storage/);
    expect(notice(quota)).toBeNull();
    expect(notice(quota)).toBeNull();
    // A different failure is news.
    expect(notice(broken)).toMatch(/^Autosave failed: .*File › Save Session/);
    expect(notice(broken)).toBeNull();
    // Recovery re-arms it: the same failure as last reported is news again after a success.
    expect(notice(saved)).toBeNull();
    expect(notice(broken)).toMatch(/^Autosave failed: /);
    expect(notice(broken)).toBeNull();
  });
});

describe('autosave notice wording (BG-01M7CPTZ)', () => {
  it('names each failure in plain words, with no raw technical detail and no orphaned "it"', () => {
    const results: Array<Extract<WorkbenchAutosaveResult, { ok: false }>> = [
      { ok: false, reason: 'quota', detail: 'IndexedDB: QuotaExceededError: The quota has been exceeded.' },
      { ok: false, reason: 'unavailable', detail: 'IndexedDB is not available; localStorage is not available' },
      { ok: false, reason: 'error', detail: 'IndexedDB: UnknownError: disk I/O error; localStorage: SecurityError' },
      { ok: false, reason: 'timeout', detail: 'the autosave did not finish within 4 s' },
    ];
    const sentences = results.map((r) => describeAutosaveFailure(r));
    for (const [i, sentence] of sentences.entries()) {
      expect(sentence).toMatch(/^Autosave failed: /);
      expect(sentence).toContain('Save the session with File › Save Session to keep your work.');
      expect(sentence).not.toMatch(/\bit\b/);
      for (const raw of ['IndexedDB', 'localStorage', 'Error', 'disk I/O', 'within 4 s']) {
        expect(sentence, `${results[i].reason}: ${sentence}`).not.toContain(raw);
      }
    }
    expect(new Set(sentences).size).toBe(4);
  });
});

describe('autosave connection recovery (BG-01M7CPTZ)', () => {
  let ls: ReturnType<typeof installLocalStorage>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => ls.restore());

  const savedName = (idb: ReturnType<typeof createFakeIndexedDb>) => {
    const row = idb.rows()?.get('session') as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as { sessionName: string }).sessionName : null;
  };

  it('reopens a connection the browser closed (close event) and autosaves into IndexedDB again without a reload', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'First'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(idb.control.opens).toBe(1);
    idb.dropConnections(true);
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'After the drop'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(idb.control.opens).toBe(2);
    // The close event alone made it reopen: no transaction was tried on the closed connection.
    expect(idb.control.refused).toBe(0);
    expect(savedName(idb)).toBe('After the drop');
    expect(ls.data.has(LEGACY_KEY)).toBe(false);
  });

  it('reopens when the connection was dropped with no close event (the transaction is refused)', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('ACGT', 'First'), store);
    idb.dropConnections(false);
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'Silent drop'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(idb.control.opens).toBe(2);
    expect(idb.control.refused).toBe(1);
    expect(savedName(idb)).toBe('Silent drop');
    // And it stays recovered: the next autosave uses the new connection.
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'Next tick'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(idb.control.opens).toBe(2);
  });

  it("reopens when a transaction aborts with WebKit's lost-connection error, and falls back for a small session when IndexedDB stays unusable", async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('ACGT', 'First'), store);
    idb.control.lostTransactions = 1;
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'Lost once'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(idb.control.opens).toBe(2);
    expect(savedName(idb)).toBe('Lost once');

    // The server is gone for good: the small session still lands in localStorage.
    idb.control.lostTransactions = 100;
    idb.dropConnections(true);
    idb.control.openThrows = true;
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'Fallback'), store)).toEqual({ ok: true, location: 'localStorage' });
    // ... and once IndexedDB is back, the next autosave reaches it again.
    idb.control.openThrows = false;
    idb.control.lostTransactions = 0;
    expect(await autosaveWorkbench(snapshotOf('ACGT', 'Back'), store)).toEqual({ ok: true, location: 'indexeddb' });
    expect(savedName(idb)).toBe('Back');
  });

  it('does not reopen the connection for a failure that is not a lost connection', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('ACGT'), store);
    idb.control.writeError = quotaError();
    expect(await autosaveWorkbench(snapshotOf('ACGT'), store)).toEqual({ ok: true, location: 'localStorage' });
    expect(idb.control.opens).toBe(1);
  });

  it('gives up on an open blocked by another window instead of waiting, so the fallback runs', async () => {
    const idb = createFakeIndexedDb({ blocked: true });
    const store = createIndexedDbAutosaveStore(idb.factory);
    const result = await Promise.race([
      autosaveWorkbench(snapshotOf('ACGT'), store),
      sleep(1_000).then(() => 'still waiting' as const),
    ]);
    expect(result).toEqual({ ok: true, location: 'localStorage' });
  });
});

describe('quit-time autosave is bounded (BG-01M7CPTZ)', () => {
  let ls: ReturnType<typeof installLocalStorage>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => ls.restore());

  it('waits a few seconds at most', () => {
    expect(QUIT_AUTOSAVE_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
    expect(QUIT_AUTOSAVE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('reports a timeout when the IndexedDB write hangs, and the real result when it does not', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    expect(await autosaveWorkbenchWithin(snapshotOf('ACGT'), 2_000, store)).toEqual({ ok: true, location: 'indexeddb' });
    idb.control.hangWrites = true;
    const started = Date.now();
    const hung = await autosaveWorkbenchWithin(snapshotOf('ACGT'), 80, store);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hung.ok).toBe(false);
    if (hung.ok) return;
    expect(hung.reason).toBe('timeout');
    expect(describeAutosaveFailure(hung)).toMatch(/^Autosave failed: /);
    // A failure that comes back in time is reported as itself, not as a timeout.
    const failing: WorkbenchAutosaveStore = { read: async () => null, write: async () => { throw quotaError(); }, remove: async () => {} };
    const big = await autosaveWorkbenchWithin(snapshotOf(bigSequence), 30_000, failing);
    expect(big.ok === false && big.reason).toBe('quota');
  }, 60_000);
});

describe('restore picks the newer copy by its saved time (BG-01M7CPTZ)', () => {
  let ls: ReturnType<typeof installLocalStorage>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => ls.restore());

  /** A store whose write fails only when released, so its localStorage fallback lands late. */
  function slowFailingStore() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store: WorkbenchAutosaveStore = {
      read: async () => null,
      write: async () => {
        await gate;
        throw new Error('IndexedDB is disabled');
      },
      remove: async () => {},
    };
    return { store, release };
  }

  it('writes the same saved time to IndexedDB and to the localStorage fallback', async () => {
    const idb = createFakeIndexedDb();
    await autosaveWorkbench(snapshotOf('ACGT'), createIndexedDbAutosaveStore(idb.factory));
    const row = idb.rows()?.get('session') as { savedAt: string };
    expect(Number.isNaN(Date.parse(row.savedAt))).toBe(false);
    // A successful IndexedDB write removes the superseded localStorage copy and its time.
    ls.data.set(LEGACY_SAVED_AT_KEY, '2000-01-01T00:00:00.000Z');
    await autosaveWorkbench(snapshotOf('ACGT'), createIndexedDbAutosaveStore(idb.factory));
    expect(ls.data.has(LEGACY_SAVED_AT_KEY)).toBe(false);

    const broken = createIndexedDbAutosaveStore(createFakeIndexedDb({ openThrows: true }).factory);
    await autosaveWorkbench(snapshotOf('ACGT'), broken);
    expect(ls.data.has(LEGACY_KEY)).toBe(true);
    expect(Number.isNaN(Date.parse(ls.data.get(LEGACY_SAVED_AT_KEY) ?? ''))).toBe(false);
  });

  it('restores a newer IndexedDB copy over an older localStorage fallback that landed after it (a racing window)', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    const slow = slowFailingStore();
    // Window A snapshots first; its IndexedDB write is slow and then fails.
    const windowA = autosaveWorkbench(snapshotOf('AAAA', 'Window A, older'), slow.store);
    await sleep(5);
    // Window B snapshots later and its IndexedDB write lands at once.
    expect(await autosaveWorkbench(snapshotOf('CCCC', 'Window B, newer'), store)).toEqual({ ok: true, location: 'indexeddb' });
    // A's fallback now lands in localStorage, after B's write.
    slow.release();
    expect(await windowA).toEqual({ ok: true, location: 'localStorage' });
    expect(ls.data.has(LEGACY_KEY)).toBe(true);

    const read = await loadWorkbenchFromLocalAutosave(store);
    expect(read.status === 'found' && read.location).toBe('indexeddb');
    expect(read.status === 'found' && read.parsed.envelope.sessionName).toBe('Window B, newer');
  });

  it('restores a localStorage copy synchronously only when it is certainly the newer one', async () => {
    // An older build's copy (no time), with no IndexedDB autosave recorded.
    ls.data.set(LEGACY_KEY, serializeMbcWorkbench(snapshotOf('GATTACA', 'Untimed')));
    expect(readNewestLocalStorageWorkbenchAutosave()?.parsed.envelope.sessionName).toBe('Untimed');
    // A timed copy with no IndexedDB autosave recorded.
    ls.data.set(LEGACY_SAVED_AT_KEY, new Date().toISOString());
    expect(readNewestLocalStorageWorkbenchAutosave()?.parsed.envelope.sessionName).toBe('Untimed');
    // A timed copy beside a recorded IndexedDB autosave: only the async read can decide.
    const idb = createFakeIndexedDb();
    await autosaveWorkbench(snapshotOf('CCCC', 'In IndexedDB'), createIndexedDbAutosaveStore(idb.factory));
    ls.data.set(LEGACY_KEY, serializeMbcWorkbench(snapshotOf('AAAA', 'Stale fallback')));
    ls.data.set(LEGACY_SAVED_AT_KEY, '2000-01-01T00:00:00.000Z');
    expect(readNewestLocalStorageWorkbenchAutosave()).toBeNull();
    // ... but an untimed copy still wins at once, as it did before the time was kept.
    ls.data.delete(LEGACY_SAVED_AT_KEY);
    expect(readNewestLocalStorageWorkbenchAutosave()?.parsed.envelope.sessionName).toBe('Stale fallback');
  });

  it('restores a newer localStorage fallback over an older IndexedDB copy', async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbAutosaveStore(idb.factory);
    await autosaveWorkbench(snapshotOf('AAAA', 'Older in IndexedDB'), store);
    await sleep(5);
    const broken = createIndexedDbAutosaveStore(createFakeIndexedDb({ openThrows: true }).factory);
    expect(await autosaveWorkbench(snapshotOf('TTTT', 'Newer fallback'), broken)).toEqual({ ok: true, location: 'localStorage' });
    const read = await loadWorkbenchFromLocalAutosave(store);
    expect(read.status === 'found' && read.location).toBe('localStorage');
    expect(read.status === 'found' && read.parsed.envelope.sessionName).toBe('Newer fallback');
  });
});

describe('storage failures outside the autosave write are reported, not swallowed (BG-01M7CPTZ, LC-006)', () => {
  let ls: ReturnType<typeof installLocalStorage>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => ls.restore());

  it('reports a failed IndexedDB delete when the autosave is cleared', async () => {
    const idb = createFakeIndexedDb();
    expect(await clearWorkbenchLocalAutosave(createIndexedDbAutosaveStore(idb.factory))).toEqual({ ok: true });
    const failing: WorkbenchAutosaveStore = { read: async () => null, write: async () => {}, remove: async () => { throw namedError('UnknownError', 'disk I/O error'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cleared = await clearWorkbenchLocalAutosave(failing);
      expect(cleared.ok).toBe(false);
      expect(!cleared.ok && cleared.detail).toMatch(/IndexedDB: UnknownError: disk I\/O error/);
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a dirty flag that storage refused instead of swallowing it', () => {
    expect(writeWorkbenchAutosaveDirtyFlag(true)).toEqual({ ok: true, location: 'localStorage' });
    expect(ls.data.get(`${LEGACY_KEY}.dirty`)).toBe('1');
    const g = globalThis as unknown as { localStorage?: Storage };
    const healthy = g.localStorage;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      g.localStorage = { ...healthy!, setItem: () => { throw namedError('SecurityError', 'storage is blocked'); } } as Storage;
      const refused = writeWorkbenchAutosaveDirtyFlag(false);
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.detail).toMatch(/SecurityError: storage is blocked/);
      g.localStorage = undefined;
      const missing = writeWorkbenchAutosaveDirtyFlag(false);
      expect(missing.ok === false && missing.reason).toBe('unavailable');
    } finally {
      g.localStorage = healthy;
      warn.mockRestore();
    }
  });
});

// ─── The App's wiring (BG-01M7CPTZ): the one-time notice, the status-bar marker and the quit guard ───

describe('the App shows an autosave failure and guards the quit (BG-01M7CPTZ)', () => {
  vi.setConfig({ testTimeout: 90_000 });
  const g = globalThis as unknown as { indexedDB?: IDBFactory };
  let idb: ReturnType<typeof createFakeIndexedDb>;
  afterEach(() => {
    releaseLeakedMount();
    delete g.indexedDB;
  });

  /** Page storage whose autosave key can be made to refuse writes, as a full WebKit quota does. */
  function pageStorage() {
    const base = memoryStorage({ 'mbc.confirmBeforeQuit': 'false' });
    const control = { refuseAutosave: false };
    const storage = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      setItem: (k: string, v: string) => {
        if (control.refuseAutosave && k === LEGACY_KEY) throw quotaError();
        base.setItem(k, v);
      },
    }) as typeof base;
    Object.defineProperty(storage, 'length', { get: () => base.length });
    return { storage, control };
  }

  const doc = (): SequenceDocument => snapshotOf('ACGTACGTACGTACGTACGT').documents[0];

  async function mountRestored(): Promise<{ app: AppHarness; page: ReturnType<typeof pageStorage>; tick: () => Promise<void> }> {
    idb = createFakeIndexedDb();
    g.indexedDB = idb.factory;
    const page = pageStorage();
    const app = await mountApp({ width: 1440, height: 900, storage: page.storage });
    await app.restoreSession({ documents: [doc()], activeDocId: 'doc-1', viewerTab: 'sequence-view', unsaved: true });
    const React = await import('react');
    const tick = async () => {
      await React.act(async () => { vi.advanceTimersByTime(600); });
      await app.settle();
    };
    await tick();
    return { app, page, tick };
  }
  const toast = (app: AppHarness) => app.all('.statusbar-toast-text').map((t) => t.textContent).join(' | ');
  const marker = (app: AppHarness) => app.all('.statusbar-autosave-failed');
  const quitGuard = (app: AppHarness) => app.all('#mbc-confirm-dialog-title').filter((t) => t.textContent === 'Quit Without Saving?');
  function failStorage(page: ReturnType<typeof pageStorage>) {
    idb.control.writeError = new Error('disk I/O error');
    page.control.refuseAutosave = true;
  }

  it('autosaves the restored session into IndexedDB, then shows one notice and a standing marker while autosave fails, until it recovers', async () => {
    const { app, page, tick } = await mountRestored();
    try {
      expect(idb.rows()?.size, 'the restored session was autosaved into IndexedDB').toBe(1);
      expect(page.storage.getItem(LEGACY_KEY), 'the superseded localStorage copy is gone').toBeNull();
      expect(marker(app)).toHaveLength(0);

      failStorage(page);
      await app.clickTab('text-view');
      await tick();
      expect(toast(app)).toMatch(/Autosave failed: .*Save the session with File › Save Session/);
      expect(toast(app)).not.toContain('disk I/O error');
      expect(marker(app)).toHaveLength(1);
      expect(marker(app)[0].getAttribute('title')).toContain('disk I/O error');

      // The same failure on the next autosave tick is not announced again; the marker stays.
      await app.click(app.one('.statusbar-toast-dismiss'));
      await app.clickTab('sequence-view');
      await tick();
      expect(toast(app)).not.toMatch(/Autosave failed/);
      expect(marker(app)).toHaveLength(1);

      // Recovery clears the marker.
      idb.control.writeError = null;
      page.control.refuseAutosave = false;
      await app.clickTab('text-view');
      await tick();
      expect(marker(app)).toHaveLength(0);
    } finally {
      app.unmount();
    }
  });

  it('File › Restore Autosave restores the newer IndexedDB copy, not an older localStorage fallback beside it', async () => {
    const { app, page } = await mountRestored();
    try {
      expect(idb.rows()?.size).toBe(1);
      const kept = (JSON.parse((idb.rows()!.get('session') as { payload: string }).payload) as { sessionName: string }).sessionName;
      page.storage.setItem(LEGACY_KEY, serializeMbcWorkbench(snapshotOf('AAAA', 'Stale_Fallback')));
      page.storage.setItem(LEGACY_SAVED_AT_KEY, '2000-01-01T00:00:00.000Z');
      for (const dismiss of app.all('.statusbar-toast-dismiss')) await app.click(dismiss);
      expect(toast(app)).toBe('');
      await app.menu('file:restore-autosave');
      // The restored session is modified, so the App first asks to discard its changes.
      expect(app.all('#mbc-confirm-dialog-title').map((t) => t.textContent)).toEqual(['Unsaved Changes']);
      await app.click(app.one('.mbc-prompt-dialog-actions .btn-danger', 'Discard Changes'));
      expect(app.all('#mbc-confirm-dialog-title')).toHaveLength(0);
      expect(toast(app)).toContain(`Restored workbench "${kept}.mbc"`);
      expect(app.doc.body.textContent).not.toContain('Stale_Fallback');
    } finally {
      app.unmount();
    }
  });

  it('asks Quit Without Saving? when the quit-time autosave fails over unsaved changes', async () => {
    const { app, page } = await mountRestored();
    try {
      failStorage(page);
      await app.menu('file:quit');
      expect(quitGuard(app)).toHaveLength(1);
      expect(app.all('#mbc-confirm-dialog-message')[0].textContent).toMatch(/^Autosave failed: .*unsaved changes that will be lost/);
      expect(marker(app)).toHaveLength(1);
    } finally {
      app.unmount();
    }
  });

  it('reaches the Quit Without Saving? guard within the timeout when the IndexedDB write hangs', async () => {
    const { app } = await mountRestored();
    try {
      idb.control.hangWrites = true;
      await app.menu('file:quit');
      expect(quitGuard(app), 'still waiting on the autosave').toHaveLength(0);
      const React = await import('react');
      await React.act(async () => { vi.advanceTimersByTime(QUIT_AUTOSAVE_TIMEOUT_MS); });
      await app.settle();
      expect(quitGuard(app)).toHaveLength(1);
    } finally {
      app.unmount();
    }
  });
});
