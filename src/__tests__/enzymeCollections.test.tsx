// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DV72: named enzyme collections in the enzyme database (D0158), kept under their own key
 * `molbiocraft.enzymeCollections` beside the custom definitions, edited in the Restriction Enzymes
 * window, and a document's legacy Enzyme Set imported into one from the Enzymes view (D0159).
 *
 * AC1 reads the store over injected storage. AC2 and AC3 run in the real App over the live DOM
 * (appHarness): the window opened from its menu command, the Enzymes view from `view:enzymes`. The
 * document the App hands the Enzymes view is read from the studio's own `doc` prop, so an import
 * that wrote to the document would show there.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ENZYME_COLLECTIONS_KEY,
  ENZYME_DATABASE_KEY,
  builtInNameClash,
  openEnzymeCollections,
  openEnzymeDatabase,
  type CustomEnzymeInput,
  type EnzymeCollection,
} from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** The document the App last handed the Enzymes view, and how often the view asked to change it. */
const seen = vi.hoisted(() => ({ doc: null as SequenceDocument | null, updates: 0 }));
vi.mock('../components/HybridToolsAndHistoryStudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/HybridToolsAndHistoryStudio')>();
  const Studio = actual.HybridToolsAndHistoryStudio;
  const Watched = (props: React.ComponentProps<typeof Studio>) => {
    seen.doc = props.doc;
    const update = props.onUpdateDocument;
    return React.createElement(Studio, {
      ...props,
      onUpdateDocument: update
        ? (d: SequenceDocument) => {
            seen.updates += 1;
            update(d);
          }
        : undefined,
    });
  };
  return { ...actual, HybridToolsAndHistoryStudio: Watched };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// ─── The fixture ───

const MY_ECO: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 2, cutRev: 6 };
const MY_CUT: CustomEnzymeInput = { name: 'MyCut', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6 };
const TWIN_A: CustomEnzymeInput = { name: 'Twin', recognitionSeq: 'GATTACAGA', cutFwd: 3, cutRev: 5 };
const TWIN_B: CustomEnzymeInput = { name: 'Twin', recognitionSeq: 'GATTTCAGA', cutFwd: 3, cutRev: 5 };

/** Stores `inputs` in order; the n-th is `custom:seed-n`. */
function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}

/** A storage that counts the writes to each key and can refuse the collections key's. */
function watchedStorage(base: LiveStorage, refuse: 'throw' | 'drop' | null = null) {
  const writes: Record<string, number> = {};
  const storage = {
    ...base,
    getItem: (k: string) => base.getItem(k),
    setItem: (k: string, v: string) => {
      writes[k] = (writes[k] ?? 0) + 1;
      if (k === ENZYME_COLLECTIONS_KEY && refuse === 'throw') throw new Error('quota');
      if (k === ENZYME_COLLECTIONS_KEY && refuse === 'drop') return;
      base.setItem(k, v);
    },
  } as LiveStorage;
  return { storage, writes };
}

function clock() {
  let n = 0;
  return () => `2026-02-0${++n}T00:00:00.000Z`;
}
function store(storage: LiveStorage, more: { now?: () => string } = {}) {
  let n = 0;
  return openEnzymeCollections({ storage, now: more.now ?? clock(), newId: () => `collection:t-${++n}` });
}
function value<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const collectionsIn = (storage: LiveStorage): EnzymeCollection[] => {
  const r = openEnzymeCollections({ storage }).read();
  if (!r.ok) throw new Error(r.error.message);
  return r.collections;
};

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};
/** EcoRI's GAATTC twice and BamHI's GGATCC once in A/C filler. */
const SEQ = [filler(300, 1), 'GAATTC', filler(300, 2), 'GGATCC', filler(300, 3), 'GAATTC', filler(300, 4)].join('');
const docOf = (id: string, enzymeNames?: string): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence: SEQ, topology: 'circular', features: [], primers: [],
  docMetadata: enzymeNames === undefined ? {} : { 'Enzyme Names': enzymeNames },
});

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}: ${scope.querySelectorAll('button').map(nameOf).join(' | ')}`);
  return found[0];
}
const buttonsNamed = (scope: LiveElement, name: string) => scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
function field(scope: LiveElement, label: string): LiveElement {
  const found = scope.querySelectorAll('input, select').filter((f) => f.getAttribute('aria-label') === label);
  if (found.length !== 1) throw new Error(`expected one field labelled "${label}", found ${found.length}`);
  return found[0];
}

async function withApp(storage: LiveStorage, doc: SequenceDocument | null, run: (app: AppHarness) => Promise<void>): Promise<void> {
  seen.doc = null;
  seen.updates = 0;
  const app = await mountApp({ storage });
  try {
    if (doc) {
      await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
      await app.settle();
    }
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── AC1: the store ───

describe('US-01M7DV72 AC1: the collections store', () => {
  it('US-01M7DV72 AC1 creates, renames and deletes collections of built-in and custom keys, reopens them field for field, and never writes the definitions key', () => {
    const { storage, writes } = watchedStorage(seeded([MY_ECO]));
    const definitions = storage.getItem(ENZYME_DATABASE_KEY);
    const defWrites = writes[ENZYME_DATABASE_KEY] ?? 0;
    const s = store(storage);
    const created = value(s.create('  Cloning set  '));
    expect(created).toEqual({ id: 'collection:t-1', name: 'Cloning set', enzymeIds: [], createdAt: '2026-02-01T00:00:00.000Z', modifiedAt: '2026-02-01T00:00:00.000Z' });
    expect(value(s.addMember(created.id, 'EcoRI')).already).toBe(false);
    expect(value(s.addMember(created.id, 'custom:seed-1')).already).toBe(false);
    const renamed = value(s.rename(created.id, 'Digest set'));
    expect(renamed).toEqual({ id: 'collection:t-1', name: 'Digest set', enzymeIds: ['EcoRI', 'custom:seed-1'], createdAt: '2026-02-01T00:00:00.000Z', modifiedAt: '2026-02-04T00:00:00.000Z' });
    const other = value(s.create('Other'));
    expect(JSON.parse(storage.getItem(ENZYME_COLLECTIONS_KEY)!)).toEqual({ schema: 1, collections: [renamed, other] });
    // Reopened on the same storage: the same collections, field for field.
    expect(collectionsIn(storage)).toEqual([renamed, other]);
    expect(value(s.removeMember(created.id, 'EcoRI')).enzymeIds).toEqual(['custom:seed-1']);
    expect(value(s.remove(created.id))).toBeNull();
    expect(collectionsIn(storage)).toEqual([other]);
    // Every collection write left the definitions byte for byte, and never wrote their key.
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(definitions);
    expect(writes[ENZYME_DATABASE_KEY] ?? 0).toBe(defWrites);
    expect(writes[ENZYME_COLLECTIONS_KEY]).toBe(7);
  });

  it('US-01M7DV72 AC1 refuses an empty, a multi-line and a duplicate name with a field reason, writing nothing', () => {
    const { storage, writes } = watchedStorage(seeded([]));
    const s = store(storage);
    const first = value(s.create('Cloning set'));
    const stored = storage.getItem(ENZYME_COLLECTIONS_KEY);
    const before = writes[ENZYME_COLLECTIONS_KEY];
    const refusals = [s.create(''), s.create('   '), s.create('Cloning\nset'), s.create('cloning set '), s.create('Line\rtwo')];
    const other = value(s.create('Other'));
    const afterCreate = storage.getItem(ENZYME_COLLECTIONS_KEY);
    const createWrites = writes[ENZYME_COLLECTIONS_KEY];
    refusals.push(s.rename(other.id, ' CLONING SET'), s.rename(other.id, ''), s.rename(other.id, 'a\nb'));
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.kind).toBe('invalid');
      expect(r.error.fields).toHaveLength(1);
      expect(r.error.fields[0].field).toBe('name');
      expect(r.error.fields[0].reason).not.toBe('');
      expect(r.error.message).toMatch(/^Nothing was saved/);
    }
    expect([refusals[3], refusals[5]].map((r) => !r.ok && r.error.fields[0].reason)).toEqual([
      'Another collection is already named "Cloning set".',
      'Another collection is already named "Cloning set".',
    ]);
    expect(before).toBe(1);
    expect(createWrites).toBe(2);
    expect(writes[ENZYME_COLLECTIONS_KEY]).toBe(2);
    expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe(afterCreate);
    expect(stored).not.toBe(afterCreate);
    // Renaming a collection to its own name in another case is not a duplicate.
    expect(value(s.rename(first.id, 'CLONING SET')).name).toBe('CLONING SET');
    // A stored name with surrounding spaces (written by hand) is the same name too.
    const spaced = { id: 'collection:x', name: ' Spaced set ', enzymeIds: [], createdAt: 'a', modifiedAt: 'a' };
    const hand = memoryStorage({ [ENZYME_COLLECTIONS_KEY]: JSON.stringify({ schema: 1, collections: [spaced] }) });
    const r = store(hand).create('spaced SET');
    expect(!r.ok && r.error.fields[0].reason).toBe('Another collection is already named " Spaced set ".');
  });

  it('US-01M7DV72 AC1 returns already for a key already present, and refuses an unknown key by name, never printing a custom id, writing nothing', () => {
    const { storage, writes } = watchedStorage(seeded([MY_ECO]));
    const s = store(storage);
    const c = value(s.create('Cloning set'));
    value(s.addMember(c.id, 'custom:seed-1'));
    const stored = storage.getItem(ENZYME_COLLECTIONS_KEY);
    const count = writes[ENZYME_COLLECTIONS_KEY];
    const again = value(s.addMember(c.id, 'custom:seed-1'));
    expect(again.already).toBe(true);
    expect(again.collection.enzymeIds).toEqual(['custom:seed-1']);
    const unknown = s.addMember(c.id, 'NotAnEnzymeI');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.message).toBe('Nothing was saved: NotAnEnzymeI is not in the catalogue or the enzyme database.');
    const gone = s.addMember(c.id, 'custom:gone-4f2a');
    expect(gone.ok).toBe(false);
    if (!gone.ok) {
      expect(gone.error.message).toBe('Nothing was saved: a custom enzyme that is not stored cannot be added to "Cloning set".');
      expect(gone.error.message).not.toMatch(/custom:|gone-4f2a/);
    }
    expect(writes[ENZYME_COLLECTIONS_KEY]).toBe(count);
    expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe(stored);
  });

  it("US-01M7DV72 AC1 with the definitions store unreadable refuses a custom key with that store's reason and still accepts a catalogue key", () => {
    const storage = memoryStorage({ [ENZYME_DATABASE_KEY]: '{not json' });
    const why = openEnzymeDatabase({ storage }).read();
    if (why.ok) throw new Error('the fixture store reads');
    const s = store(storage);
    const c = value(s.create('Cloning set'));
    const stored = storage.getItem(ENZYME_COLLECTIONS_KEY);
    const refused = s.addMember(c.id, 'custom:seed-1');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toBe(`Nothing was saved: ${why.error.message}`);
      expect(refused.error.kind).toBe('malformed');
      expect(refused.error.message).not.toMatch(/not stored|custom:seed-1/);
    }
    expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe(stored);
    expect(value(s.addMember(c.id, 'EcoRI')).collection.enzymeIds).toEqual(['EcoRI']);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe('{not json');
  });

  it('US-01M7DV72 AC1 reports an unparseable or newer-schema collections value as unreadable, never empty, and does not overwrite it', () => {
    const cases: Array<[string, string]> = [
      ['{not json', 'malformed'],
      ['', 'malformed'],
      [JSON.stringify({ schema: 2, collections: [] }), 'futureSchema'],
      [JSON.stringify({ schema: 1, collections: 'none' }), 'malformed'],
      [JSON.stringify({ schema: 1, collections: [{ id: 'collection:x', name: 'A' }] }), 'malformed'],
    ];
    for (const [raw, kind] of cases) {
      const { storage, writes } = watchedStorage(memoryStorage({ [ENZYME_COLLECTIONS_KEY]: raw }));
      const s = store(storage);
      const read = s.read();
      expect(read.ok, raw).toBe(false);
      if (read.ok) continue;
      expect(read.error.kind, raw).toBe(kind);
      expect(read.error.storedValue).toBe(raw);
      expect(read.error.message).toMatch(/^The stored enzyme collections \(molbiocraft\.enzymeCollections\) cannot be read: /);
      for (const r of [s.create('New'), s.rename('collection:x', 'B'), s.remove('collection:x'), s.addMember('collection:x', 'EcoRI'), s.removeMember('collection:x', 'EcoRI')]) {
        expect(r.ok, raw).toBe(false);
        if (!r.ok) expect(r.error.message).toBe(read.error.message);
      }
      expect(writes[ENZYME_COLLECTIONS_KEY] ?? 0, raw).toBe(0);
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe(raw);
    }
  });

  it('US-01M7DV72 AC1 reports a refused write as nothing saved and keeps the previous value', () => {
    const base = seeded([]);
    value(store(base).create('Kept'));
    const previous = base.getItem(ENZYME_COLLECTIONS_KEY);
    for (const refuse of ['throw', 'drop'] as const) {
      const { storage } = watchedStorage(base, refuse);
      const s = store(storage);
      const r = s.create('Lost');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('notSaved');
        expect(r.error.message).toBe(
          refuse === 'throw'
            ? 'Nothing was saved (Error: quota). The enzyme collections are as they were.'
            : 'Nothing was saved: the storage did not keep the change. The enzyme collections are as they were.',
        );
      }
      expect(base.getItem(ENZYME_COLLECTIONS_KEY)).toBe(previous);
      expect(collectionsIn(base).map((c) => c.name)).toEqual(['Kept']);
    }
  });
});

// ─── AC2: the Restriction Enzymes window ───

const win = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"]', 'the Restriction Enzymes window');
const rowsOf = (app: AppHarness, table: string) =>
  win(app)
    .querySelectorAll(`table[aria-label="${table}"] tbody tr`)
    .map((tr) => tr.querySelectorAll('td').map((td) => words(td.textContent)));
const members = (app: AppHarness, name: string) =>
  win(app)
    .querySelectorAll(`ul[aria-label="Members of ${name}"] li`)
    .map((li) => words(li.querySelectorAll('span')[0]?.textContent));
async function reopenWindow(app: AppHarness) {
  await app.click(button(win(app), 'Close Restriction Enzymes'));
  await app.settle();
  expect(app.all('[role="dialog"][aria-labelledby="enzyme-db-title"]')).toHaveLength(0);
  await app.menu('tools:enzyme-database');
  await app.settle();
}

describe("US-01M7DV72 AC2: collections in the App's Restriction Enzymes window", () => {
  it('US-01M7DV72 AC2 a user creates, fills, renames, empties and deletes a collection; a gone or unreadable custom member is named, never by its id; the tables never change', async () => {
    const storage = seeded([MY_ECO]);
    await withApp(storage, null, async (app) => {
      await app.menu('tools:enzyme-database');
      await app.settle();
      const builtIn = rowsOf(app, 'Built-in enzymes');
      const custom = rowsOf(app, 'Custom enzymes');
      expect(builtIn.length).toBe(REBASE_ENZYMES.length);
      expect(custom.map((r) => r[0])).toEqual(['EcoRI']);
      const tablesUnchanged = () => {
        expect(rowsOf(app, 'Built-in enzymes')).toEqual(builtIn);
        expect(rowsOf(app, 'Custom enzymes')).toEqual(custom);
        expect(words(win(app).textContent)).not.toContain('custom:');
      };
      tablesUnchanged();

      await app.change(field(win(app), 'New collection name'), 'Cloning set');
      await app.click(button(win(app), 'New Collection'));
      await app.settle();
      expect(members(app, 'Cloning set')).toEqual([]);
      tablesUnchanged();

      // The picker offers the active list from the window's own read: the built-in and the custom EcoRI.
      const picker = field(win(app), 'Enzyme to add to Cloning set');
      const options = picker.querySelectorAll('option').map((o) => [o.getAttribute('value'), words(o.textContent)]);
      expect(options.filter(([, label]) => label === 'EcoRI' || label === 'EcoRI (custom)')).toEqual([
        ['EcoRI', 'EcoRI'],
        ['custom:seed-1', 'EcoRI (custom)'],
      ]);
      expect(options).toHaveLength(REBASE_ENZYMES.length + 1);
      for (const key of ['EcoRI', 'custom:seed-1']) {
        await app.change(field(win(app), 'Enzyme to add to Cloning set'), key);
        await app.click(button(win(app), 'Add to Cloning set'));
        await app.settle();
        tablesUnchanged();
      }
      expect(members(app, 'Cloning set')).toEqual(['EcoRI', 'EcoRI (custom)']);
      expect(collectionsIn(storage)[0].enzymeIds).toEqual(['EcoRI', 'custom:seed-1']);

      await app.change(field(win(app), 'New name for Cloning set'), 'Digest set');
      await app.click(button(win(app), 'Rename Cloning set'));
      await app.settle();
      expect(members(app, 'Digest set')).toEqual(['EcoRI', 'EcoRI (custom)']);
      expect(collectionsIn(storage).map((c) => c.name)).toEqual(['Digest set']);
      tablesUnchanged();

      await app.click(button(win(app), 'Remove EcoRI from Digest set'));
      await app.settle();
      expect(members(app, 'Digest set')).toEqual(['EcoRI (custom)']);
      tablesUnchanged();

      // The definition is gone from the store (the app offers no delete): the member stays, named.
      storage.setItem(ENZYME_DATABASE_KEY, JSON.stringify({ schema: 1, definitions: [] }));
      await reopenWindow(app);
      expect(members(app, 'Digest set')).toEqual(['A custom enzyme no longer stored']);
      expect(buttonsNamed(win(app), 'Remove A custom enzyme no longer stored from Digest set')).toHaveLength(1);
      expect(rowsOf(app, 'Built-in enzymes')).toEqual(builtIn);
      expect(words(win(app).textContent)).not.toContain('custom:');

      storage.setItem(ENZYME_DATABASE_KEY, '{not json');
      await reopenWindow(app);
      expect(members(app, 'Digest set')).toEqual(['A custom enzyme (the enzyme database could not be read)']);
      // The picker falls back to the catalogue alone.
      expect(field(win(app), 'Enzyme to add to Digest set').querySelectorAll('option')).toHaveLength(REBASE_ENZYMES.length);
      expect(rowsOf(app, 'Built-in enzymes')).toEqual(builtIn);
      expect(words(win(app).textContent)).not.toContain('custom:');

      await app.click(button(win(app), 'Delete Digest set'));
      await app.settle();
      expect(win(app).querySelectorAll('ul[aria-label^="Members of"]')).toHaveLength(0);
      expect(collectionsIn(storage)).toEqual([]);
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe('{not json');
      expect(rowsOf(app, 'Built-in enzymes')).toEqual(builtIn);
    });
  });

  it("US-01M7DV72 AC2 a refused name is shown with the store's reason and nothing is created", async () => {
    const storage = seeded([MY_ECO]);
    value(store(storage).create('Cloning set'));
    const stored = storage.getItem(ENZYME_COLLECTIONS_KEY);
    await withApp(storage, null, async (app) => {
      await app.menu('tools:enzyme-database');
      await app.settle();
      await app.change(field(win(app), 'New collection name'), 'cloning set ');
      await app.click(button(win(app), 'New Collection'));
      await app.settle();
      const alerts = win(app).querySelectorAll('section[aria-label="Collections"] [role="alert"]').map((n) => words(n.textContent));
      expect(alerts).toEqual(['Nothing was saved: Another collection is already named "Cloning set".']);
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe(stored);
    });
  });
});

// ─── AC3: importing a document's Enzyme Set ───

const IMPORT = 'Import Enzyme Set as collection';
const bar = (app: AppHarness) => app.one('.enzyme-set-action-bar', 'the Enzyme Set toolbar');
const statusLine = (app: AppHarness) => words(bar(app).querySelectorAll('span').map((s) => s.textContent).join(' '));
const docState = () => {
  const d = seen.doc;
  if (!d) throw new Error('the App drew no Enzymes view');
  return JSON.stringify({ sequence: d.sequence, features: d.features, primers: d.primers, docMetadata: d.docMetadata });
};
async function enzymesView(app: AppHarness, tab = 'All REBASE Commercial') {
  await app.menu('view:enzymes');
  await app.settle();
  const t = app.all('button.method-tab-btn').find((b) => words(b.textContent).startsWith(tab));
  if (!t) throw new Error(`no "${tab}" tab: ${app.all('button.method-tab-btn').map((b) => words(b.textContent)).join(' | ')}`);
  await app.click(t);
  await app.settle();
}
const tableNames = (app: AppHarness) =>
  app.all('[aria-label="Restriction Enzymes Cleavage Sites Table"] tbody tr').map((tr) => words(tr.querySelectorAll('td')[0].querySelectorAll('strong')[0]?.textContent));
async function importSet(app: AppHarness) {
  await app.click(button(app.canvas(), IMPORT));
  await app.settle();
}

describe("US-01M7DV72 AC3: a document's Enzyme Set imported as a collection", () => {
  it('fixture: BsaI is not a catalogue name, EcoRI and BamHI are', () => {
    expect(['EcoRI', 'BamHI', 'BsaI'].map((n) => REBASE_ENZYMES.some((e) => e.name === n))).toEqual([true, true, false]);
  });

  it('US-01M7DV72 AC3 imports EcoRI and the one MyCut, names what it could not match, creates no definition, leaves the document as it was and offers once', async () => {
    const storage = seeded([MY_CUT, TWIN_A, TWIN_B]);
    const definitions = storage.getItem(ENZYME_DATABASE_KEY);
    const doc = docOf('pDemo', 'EcoRI, BsaI, MyCut, Twin');
    await withApp(storage, doc, async (app) => {
      await enzymesView(app, 'Custom Enzyme Set');
      // The legacy Custom Enzyme Set filter reads as before: its four names, the built-in EcoRI listed.
      expect(app.all('button.method-tab-btn').map((b) => words(b.textContent))).toContain('Custom Enzyme Set (4)');
      expect(tableNames(app)).toEqual(['EcoRI']);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe(
        'Imported 2 of 4 enzymes from pDemo\'s Enzyme Set into the collection "pDemo". Not matched: BsaI (not in the catalogue); Twin (2 stored custom enzymes share this name).',
      );
      const [c] = collectionsIn(storage);
      expect(collectionsIn(storage)).toHaveLength(1);
      expect([c.name, c.enzymeIds, c.importedFrom]).toEqual(['pDemo', ['EcoRI', 'custom:seed-1'], { documentId: 'pDemo', documentName: 'pDemo' }]);
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(definitions);
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(0);
      expect(docState()).toBe(before);
      expect(seen.updates).toBe(0);
      expect(tableNames(app)).toEqual(['EcoRI']);
    });
    // Reopened, the document is not offered the import again.
    await withApp(storage, doc, async (app) => {
      await enzymesView(app);
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(0);
      expect(buttonsNamed(app.canvas(), 'Extract Selected Enzymes')).toHaveLength(1);
    });
  });

  it('US-01M7DV72 AC3 a name already taken gets " (2)", then " (3)"', async () => {
    const storage = seeded([MY_CUT]);
    const s = store(storage);
    value(s.create('pDemo'));
    await withApp(storage, docOf('pDemo', 'EcoRI, MyCut'), async (app) => {
      await enzymesView(app);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe('Imported 2 of 2 enzymes from pDemo\'s Enzyme Set into the collection "pDemo (2)".');
      expect(docState()).toBe(before);
    });
    value(s.create('pOther (2)'));
    value(s.create('POTHER'));
    await withApp(storage, docOf('pOther', 'BamHI'), async (app) => {
      await enzymesView(app);
      await importSet(app);
      expect(statusLine(app)).toBe('Imported 1 of 1 enzymes from pOther\'s Enzyme Set into the collection "pOther (3)".');
    });
    expect(collectionsIn(storage).map((c) => [c.name, c.enzymeIds])).toEqual([
      ['pDemo', []],
      ['pDemo (2)', ['EcoRI', 'custom:seed-1']],
      ['pOther (2)', []],
      ['POTHER', []],
      ['pOther (3)', ['BamHI']],
    ]);
  });

  it('US-01M7DV72 AC3 a set whose names match nothing writes nothing and says so', async () => {
    const storage = seeded([TWIN_A, TWIN_B]);
    await withApp(storage, docOf('pNone', 'BsaI, Twin, ecori'), async (app) => {
      await enzymesView(app);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe(
        "No enzyme in pNone's Enzyme Set matches the catalogue or a stored custom enzyme: no collection was created. Not matched: BsaI (not in the catalogue); Twin (2 stored custom enzymes share this name); ecori (not in the catalogue).",
      );
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBeNull();
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(1);
      expect(docState()).toBe(before);
    });
  });

  it('US-01M7DV72 AC3 with the definitions store unreadable a set naming a custom enzyme imports nothing, and an all-catalogue set imports', async () => {
    const storage = memoryStorage({ [ENZYME_DATABASE_KEY]: '{not json' });
    await withApp(storage, docOf('pDemo', 'EcoRI, BsaI, MyCut, Twin'), async (app) => {
      await enzymesView(app);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe('The enzyme database could not be read, so custom enzyme names cannot be matched: nothing was imported.');
      expect(statusLine(app)).not.toContain('MyCut (not in the catalogue)');
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBeNull();
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(1);
      expect(docState()).toBe(before);
    });
    await withApp(storage, docOf('pCat', 'EcoRI, BamHI'), async (app) => {
      await enzymesView(app);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe('Imported 2 of 2 enzymes from pCat\'s Enzyme Set into the collection "pCat".');
      expect(collectionsIn(storage).map((c) => [c.name, c.enzymeIds])).toEqual([['pCat', ['EcoRI', 'BamHI']]]);
      expect(docState()).toBe(before);
    });
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe('{not json');
  });

  it("US-01M7DV72 AC3 with the collections write refused nothing is written, the store's reason is shown and the offer stays", async () => {
    const { storage } = watchedStorage(seeded([MY_CUT]), 'throw');
    await withApp(storage, docOf('pDemo', 'EcoRI, MyCut'), async (app) => {
      await enzymesView(app);
      const before = docState();
      await importSet(app);
      expect(statusLine(app)).toBe('Nothing was saved (Error: quota). The enzyme collections are as they were.');
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBeNull();
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(1);
      expect(docState()).toBe(before);
      expect(seen.updates).toBe(0);
    });
  });

  it('US-01M7DV72 AC3 a document with no Enzyme Names is offered no import', async () => {
    await withApp(seeded([MY_CUT]), docOf('pPlain'), async (app) => {
      await enzymesView(app);
      expect(buttonsNamed(app.canvas(), 'Extract Selected Enzymes')).toHaveLength(1);
      expect(buttonsNamed(app.canvas(), IMPORT)).toHaveLength(0);
    });
  });
});
