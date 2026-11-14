// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The session autosave (BG-01M7CKYQ): it is kept in IndexedDB, which has no ~5 MB localStorage
 * quota (WebKit, the macOS desktop app's engine, refused the Sample Project there), an autosave
 * written by an older build to localStorage is still restored, and a failure comes back as a
 * named result that the app shows the user once per failure run instead of being swallowed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOSAVE_IDB_NAME,
  AUTOSAVE_IDB_STORE,
  clearWorkbenchLocalAutosave,
  createAutosaveFailureNotice,
  createIndexedDbAutosaveStore,
  hasWorkbenchLocalAutosave,
  loadWorkbenchFromLocalAutosave,
  autosaveWorkbench,
  serializeMbcWorkbench,
  workbenchAutosaveNeedsRecovery,
  writeWorkbenchAutosaveDirtyFlag,
  type MbcWorkbenchSnapshot,
  type WorkbenchAutosaveResult,
} from '../core/mbcSessionFormat';
import type { SequenceDocument } from '../types/bio';

const LEGACY_KEY = 'molbiocraft.workbench.autosave.v1';

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

/**
 * Just enough of IDBFactory for the autosave adapter: open with upgrade, one object store,
 * put/get/delete in a transaction that completes or aborts asynchronously. `quotaChars` makes a
 * larger put abort its transaction with QuotaExceededError, as a full origin does.
 */
function createFakeIndexedDb(opts: { quotaChars?: number; openThrows?: boolean } = {}) {
  const databases = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();
  const factory = {
    open(name: string, version: number) {
      if (opts.openThrows) throw new Error('IndexedDB is disabled');
      const request: Record<string, unknown> & { result?: unknown } = {};
      setTimeout(() => {
        let entry = databases.get(name);
        const upgrading = !entry || entry.version < version;
        if (!entry) {
          entry = { version, stores: new Map() };
          databases.set(name, entry);
        }
        const db = entry;
        request.result = {
          objectStoreNames: { contains: (s: string) => db.stores.has(s) },
          createObjectStore: (s: string) => void db.stores.set(s, new Map()),
          close: () => {},
          transaction(storeName: string) {
            const rows = db.stores.get(storeName);
            if (!rows) throw new Error(`no object store ${storeName}`);
            const steps: Array<() => void> = [];
            const tx: Record<string, unknown> = { error: null };
            const req = (fn: () => unknown) => {
              const r: { result?: unknown } = {};
              steps.push(() => (r.result = fn()));
              return r;
            };
            tx.objectStore = () => ({
              put: (value: unknown, key: string) =>
                req(() => {
                  if (opts.quotaChars !== undefined && JSON.stringify(value).length > opts.quotaChars) throw quotaError();
                  rows.set(key, structuredClone(value));
                  return key;
                }),
              get: (key: string) => req(() => structuredClone(rows.get(key))),
              delete: (key: string) => req(() => void rows.delete(key)),
            });
            setTimeout(() => {
              try {
                steps.forEach((s) => s());
              } catch (err) {
                tx.error = err;
                (tx.onabort as (() => void) | undefined)?.();
                return;
              }
              (tx.oncomplete as (() => void) | undefined)?.();
            }, 0);
            return tx;
          },
        };
        if (upgrading) {
          db.version = version;
          (request.onupgradeneeded as (() => void) | undefined)?.();
        }
        (request.onsuccess as (() => void) | undefined)?.();
      }, 0);
      return request;
    },
  };
  const rows = () => databases.get(AUTOSAVE_IDB_NAME)?.stores.get(AUTOSAVE_IDB_STORE);
  return { factory: factory as unknown as IDBFactory, rows };
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
    expect(notice(broken)).toMatch(/^Autosave failed: disk I\/O error\..*File › Save Session/);
    expect(notice(broken)).toBeNull();
    // Recovery re-arms it: the same failure as last reported is news again after a success.
    expect(notice(saved)).toBeNull();
    expect(notice(broken)).toMatch(/^Autosave failed: disk I\/O error\./);
    expect(notice(broken)).toBeNull();
  });
});
