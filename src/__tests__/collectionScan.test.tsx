// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7JPK6: a named enzyme collection (US-01M7DV72) chosen in the Restriction Analysis panel's
 * `Enzymes the site scans read` is the list the App's main display scan sends the engine, so the
 * maps, the Displayed restriction sites panel and the Cutting once list show only its enzymes'
 * sites, and every scope word names the collection. Digests, cloning and workflows keep every
 * enzyme; the document is never written. The choice is stored under its own key
 * (molbiocraft.enzymeScanCollection, D0163); a choice, or a collections store, that cannot be read
 * scans every enzyme and says so once (D0168).
 *
 * The checks run in the real App over the live DOM (appHarness), the stores in the page's own local
 * storage, the engine the committed WASM. Its entry point is watched (not replaced), so each test
 * reads the list the App actually sent: `custom` null is the catalogue.
 */

import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type SessionSpec } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
});

/** Every restriction call the engine receives: which, over how many bases, and the list it was sent (null: the catalogue). */
const engine = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; seqLen: number; custom: RestrictionEnzyme[] | null }>,
}));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  const watched = new Set(['scan_restriction_sites', 'find_non_cutting_enzymes', 'find_restriction_cut_sites']);
  return {
    ...actual,
    invokeRustBioSync: (op: string, payload?: unknown) => {
      if (watched.has(op)) {
        const p = (payload ?? {}) as { seq?: string; customEnzymes?: RestrictionEnzyme[] | null };
        engine.calls.push({ op, seqLen: String(p.seq ?? '').length, custom: p.customEnzymes ?? null });
      }
      return actual.invokeRustBioSync(op, payload);
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// ─── The fixture ───

const ENZ_KEY = 'molbiocraft.enzymeDatabase';
const COLL_KEY = 'molbiocraft.enzymeCollections';
const CHOICE_KEY = 'molbiocraft.enzymeScanCollection';
const T0 = '2026-01-01T00:00:00.000Z';

const MY: CustomEnzymeInput = { name: 'MyCut', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6, provenance: 'own isolate' };
const MY_ID = 'custom:mycut';

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};
/** A/C filler (no motif below holds only A and C) with EcoRI, BamHI and MyCut once each, and HindIII twice. */
function construct(fill: number, extra = 0): string {
  return [
    filler(fill, 1), 'GAATTC', filler(fill, 2), 'GGATCC', filler(fill, 3), 'AAGCTT', filler(fill, 4), MY.recognitionSeq,
    filler(fill, 5), 'AAGCTT', filler(fill + extra, 6),
  ].join('');
}
/** Every planted site falls on the linear view's first page (1-1,200 bp). */
const SMALL = construct(200);
const docOf = (id: string, sequence: string): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology: 'circular', features: [], primers: [],
});

interface Coll { id: string; name: string; enzymeIds: string[] }
const CLONING: Coll = { id: 'collection:cloning', name: 'Cloning set', enzymeIds: ['EcoRI', 'BamHI', MY_ID] };
const collectionsValue = (list: Coll[]) =>
  JSON.stringify({ schema: 1, collections: list.map((c) => ({ ...c, createdAt: T0, modifiedAt: T0 })) });
const choiceValue = (collectionId: string) => JSON.stringify({ schema: 1, collectionId });

function seeded(opts: { defs?: boolean; collections?: Coll[]; choice?: string } = {}, storage: LiveStorage = memoryStorage()): LiveStorage {
  if (opts.defs !== false) {
    const db = openEnzymeDatabase({ storage, now: () => T0, newId: () => MY_ID });
    const r = db.add(MY, { confirmedClash: builtInNameClash(MY.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  storage.setItem(COLL_KEY, collectionsValue(opts.collections ?? [CLONING]));
  if (opts.choice !== undefined) storage.setItem(CHOICE_KEY, opts.choice);
  return storage;
}

const session = (doc: SequenceDocument, workspace: SessionSpec['workspace'] = {}): SessionSpec => ({
  documents: [doc],
  activeDocId: doc.id,
  viewerTab: 'sequence-view',
  workspace: {
    mapLayoutMode: 'split',
    displaySettings: {
      showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
      showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
    },
    ...workspace,
  },
});

async function withDoc(storage: LiveStorage, doc: SequenceDocument, run: (app: AppHarness) => Promise<void>, workspace: SessionSpec['workspace'] = {}): Promise<void> {
  engine.calls.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession(session(doc, workspace));
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);
const uniq = (xs: string[]) => [...new Set(xs)].sort();

const circularCutNames = (app: AppHarness) =>
  uniq(app.all('svg.plasmid-svg g[role="button"]').map((g) => /^Select (.*) \([\d,]+\)$/.exec(g.getAttribute('aria-label') ?? '')?.[1] ?? '').filter(Boolean));
const linearCutNames = (app: AppHarness) =>
  uniq(app.all('.cut-pill').map((p) => /^(.*) \([\d,]+\) cut site/.exec(p.getAttribute('aria-label') ?? '')?.[1] ?? '').filter(Boolean));
const panel = (app: AppHarness) => app.one('section[aria-label="Displayed restriction sites"]', 'the Displayed restriction sites panel');
const panelNames = (app: AppHarness) => uniq(panel(app).querySelectorAll('.mbc-dsites-name').map((n) => words(n.textContent)));
const uniqueList = (app: AppHarness) => uniq(app.all('.mbc-enzyme-cloud .mbc-enz-pill').map((b) => words(b.textContent).replace(/ \(\d[\d,]*\)$/, '')));
const restrictionNotes = (app: AppHarness) => app.all('.mbc-accordion-body .mbc-summary-note').map((n) => words(n.textContent));
const header = (app: AppHarness) => words(app.all('.mbc-accordion-header span').map((s) => words(s.textContent)).find((t) => t.startsWith('Restriction Analysis (')));
const onceListName = (app: AppHarness) =>
  words(app.all('.mbc-accordion-body label.mbc-check-row span').map((s) => words(s.textContent)).find((t) => /^(Cutting once|Unique Single-Cutters)/.test(t)));
const circularNote = (app: AppHarness) => app.all('svg.plasmid-svg text.circular-callout-note').map((t) => words(t.textContent)).join(' ');
const linearNotes = (app: AppHarness) =>
  app.all('p.mbc-summary-note[role="note"]').filter((p) => !p.closest('.mbc-accordion-body')).map((p) => words(p.textContent));
const status = (app: AppHarness) => app.all('.statusbar-toast-text').map((t) => words(t.textContent)).join(' ');
const timesIn = (text: string, part: string) => text.split(part).length - 1;
/** Every word the App shows, its windows included. */
const bodyText = (app: AppHarness) => words(app.all('body').map((b) => b.textContent).join(' '));

const chooser = (app: AppHarness) => app.one('select[aria-label="Enzymes the site scans read"]', 'the scan collection chooser');
const chooserOptions = (app: AppHarness) => chooser(app).options.map((o) => words(o.textContent));
async function choose(app: AppHarness, label: string): Promise<void> {
  const option = chooser(app).options.find((o) => words(o.textContent).startsWith(label));
  if (!option) throw new Error(`the chooser offers no "${label}": ${chooserOptions(app).join(' | ')}`);
  await app.change(chooser(app), option.getAttribute('value') ?? '');
  await app.settle();
}

/** The App's display scans, latest last. */
const scans = () => engine.calls.filter((c) => c.op === 'scan_restriction_sites');
const lastScan = () => scans()[scans().length - 1];
const sentNames = (list: RestrictionEnzyme[] | null) => (list ?? []).map((e) => e.id ?? e.name);
const catalogueIds = () => REBASE_ENZYMES.map((e) => e.id ?? e.name);
const EVERY = () => [...catalogueIds(), MY_ID];

// ─── The Restriction Enzymes window ───

const win = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"]', 'the Restriction Enzymes window');
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}`);
  return found[0];
}
const field = (scope: LiveElement, label: string) => {
  const found = scope.querySelectorAll('input, select').filter((f) => f.getAttribute('aria-label') === label);
  if (found.length !== 1) throw new Error(`expected one field labelled "${label}", found ${found.length}`);
  return found[0];
};

/** The document as a saved session holds it: bases, features, primers and docMetadata. */
async function savedDocument(app: AppHarness) {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  return parseMbcWorkbench(await files[0].text()).envelope.documents.map((d) => ({
    sequence: d.sequence, features: d.features, primers: d.primers, docMetadata: (d as { docMetadata?: unknown }).docMetadata ?? null,
  }));
}

const TRIO = ['BamHI', 'EcoRI', 'MyCut (custom)'];

// ─── AC1 ───

describe('US-01M7JPK6 AC1: a chosen collection is what the main display scan reads, and nothing else', () => {
  it('US-01M7JPK6 AC1 choosing "Cloning set" sends exactly its three enzymes; the maps, the panel and the once list show only their sites; All enzymes sends every enzyme again; the document is unchanged', async () => {
    const storage = seeded();
    await withDoc(storage, docOf('pClone', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(panelNames(app)).toContain('HindIII');
      expect(chooserOptions(app)).toEqual(['All enzymes', 'Cloning set (3 enzymes)']);
      const docBefore = await savedDocument(app);

      engine.calls.length = 0;
      await choose(app, 'Cloning set');
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      expect(circularCutNames(app)).toEqual(TRIO);
      expect(linearCutNames(app)).toEqual(TRIO);
      expect(panelNames(app)).toEqual(TRIO);
      expect(uniqueList(app)).toEqual(TRIO);
      expect(storage.getItem(CHOICE_KEY)).toBe(choiceValue(CLONING.id));
      expect(await savedDocument(app)).toEqual(docBefore);

      engine.calls.length = 0;
      await choose(app, 'All enzymes');
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(panelNames(app)).toEqual(expect.arrayContaining(['HindIII', ...TRIO]));
      expect(circularCutNames(app)).toContain('HindIII');
      expect(await savedDocument(app)).toEqual(docBefore);
    });
  });

  it('US-01M7JPK6 AC1 the choice survives a remount on the same storage', async () => {
    const storage = seeded();
    await withDoc(storage, docOf('pClone', SMALL), async (app) => {
      await choose(app, 'Cloning set');
    });
    await withDoc(storage, docOf('pClone', SMALL), async (app) => {
      expect(chooser(app).value).toBe(CLONING.id);
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      expect(panelNames(app)).toEqual(TRIO);
    });
  });

  it('US-01M7JPK6 AC1 the Digest dialog, the cloning studio and a workflow step still read every enzyme', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    storage.setItem('molbiocraft.workflows.v1', JSON.stringify([{
      id: 'wf-mine', name: 'Digest mine', description: '', keepIntermediate: true,
      steps: [{ op: 'digest-fragments', settings: { kind: 'custom', values: { enzymes: 'EcoRI', keepAnnotations: true } } }],
    }]));
    await withDoc(storage, docOf('pClone', SMALL), async (app) => {
      expect(panelNames(app)).toEqual(TRIO);
      await app.menu('enzymes:digest-dialog');
      await app.settle();
      const group = app.one('[role="group"][aria-label="Enzymes to digest with"]', "the Digest dialog's enzymes");
      const rows = group.querySelectorAll('label.mbc-check-row').map((r) => words(r.textContent));
      expect(rows.some((r) => r.startsWith('HindIII'))).toBe(true);
      expect(rows.some((r) => r.startsWith('MyCut (custom)'))).toBe(true);
      expect(rows.length).toBeGreaterThan(3);
      await app.press('Escape');
      await app.settle();

      await app.menu('workflows:manage');
      await app.settle();
      const item = app.all('button[role="option"]').find((b) => words(b.textContent) === 'Digest mine');
      if (!item) throw new Error('the Manage Workflows window lists no "Digest mine"');
      await app.click(item);
      await app.settle();
      const picker = app.one('select[aria-label="enzymes"]', 'the workflow enzymes picker');
      const labels = picker.options.map((o) => words(o.textContent));
      expect(labels).toEqual(expect.arrayContaining(['HindIII', 'MyCut (custom)', 'EcoRI']));
      expect(labels.length).toBeGreaterThan(REBASE_ENZYMES.length);
      await app.press('Escape');
      await app.settle();

      engine.calls.length = 0;
      await app.menu('enzymes:noncutters');
      await app.settle();
      const nonCut = engine.calls.filter((c) => c.op === 'find_non_cutting_enzymes');
      expect(nonCut.length).toBeGreaterThan(0);
      for (const c of nonCut) expect(sentNames(c.custom)).toEqual(EVERY());
    });
  });

  it('US-01M7JPK6 AC1 a session hiding HindIII (outside the collection) adds no "matches no enzyme" notice, and HindIII is still hidden on All enzymes', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    const doc = docOf('pHide', SMALL);
    await withDoc(storage, doc, async (app) => {
      expect(panelNames(app)).toEqual(TRIO);
      expect(status(app)).not.toMatch(/matches? no enzyme/);
      await choose(app, 'All enzymes');
      const box = field(panel(app), 'Show HindIII sites on the maps');
      expect(box.checked).toBe(false);
      expect(circularCutNames(app)).not.toContain('HindIII');
      expect(circularCutNames(app)).toContain('EcoRI');
    }, { siteVisibility: { pHide: { hiddenEnzymes: ['HindIII'], occurrences: {}, revision: 'any' } } });
  });
});

// ─── AC2 ───

describe('US-01M7JPK6 AC2: every scope word names the collection and counts the members scanned', () => {
  it('US-01M7JPK6 AC2 with "Cloning set" chosen the header, the once list, the detail, the circular note and the linear note name it; with All enzymes every word is as before', async () => {
    await withDoc(seeded(), docOf('pWords', SMALL), async (app) => {
      const before = { header: header(app), once: onceListName(app), notes: restrictionNotes(app), linear: linearNotes(app), circle: circularNote(app) };
      expect(before.header).toMatch(/^Restriction Analysis \(\d+\)$/);
      expect(before.once).toMatch(/^Unique Single-Cutters \(\d+\)$/);
      expect(before.notes).toEqual([]);
      expect(before.linear).toEqual([]);

      await choose(app, 'Cloning set');
      expect(header(app)).toBe('Restriction Analysis (3 sites from "Cloning set" (3 enzymes))');
      expect(onceListName(app)).toBe('Cutting once among "Cloning set" (3 enzymes) (3)');
      expect(restrictionNotes(app)).toEqual(['Only the 3 enzymes in the collection "Cloning set" were scanned: other enzymes may also cut this sequence.']);
      expect(circularNote(app)).toContain('"Cloning set" (3 enzymes)');
      expect(linearNotes(app)).toEqual(['Cut sites are shown for the 3 enzymes of "Cloning set" only: other enzymes were not scanned.']);
      expect(chooserOptions(app)).toEqual(['All enzymes', 'Cloning set (3 enzymes)']);

      await choose(app, 'All enzymes');
      expect({ header: header(app), once: onceListName(app), notes: restrictionNotes(app), linear: linearNotes(app), circle: circularNote(app) }).toEqual(before);
    });
  });

  it('US-01M7JPK6 AC2 the chooser counts the members stored, the header the members scanned', async () => {
    const gone: Coll = { id: 'collection:gone', name: 'Gone set', enzymeIds: ['EcoRI', 'custom:gone', 'BamHI'] };
    await withDoc(seeded({ collections: [CLONING, gone] }), docOf('pGone', SMALL), async (app) => {
      expect(chooserOptions(app)).toEqual(['All enzymes', 'Cloning set (3 enzymes)', 'Gone set (3 enzymes)']);
      await choose(app, 'Gone set');
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI']);
      expect(header(app)).toBe('Restriction Analysis (2 sites from "Gone set" (2 enzymes))');
      expect(onceListName(app)).toBe('Cutting once among "Gone set" (2 enzymes) (2)');
      expect(linearNotes(app)[0]).toMatch(/^Cut sites are shown for the 2 enzymes of "Gone set" only/);
    });
  });
});

// ─── AC3 ───

describe('US-01M7JPK6 AC3: over 100,000 bases scanned a collection is cut by the bounded member rule, by the bases scanned', () => {
  const midDoc = docOf('pMid120k', construct(200, 118_000));
  const bigDoc = docOf('pBig160k', construct(200, 160_000));
  // Thirty built-ins outside the core (so a rule that intersects with the core would scan none), in
  // an order of their own, with the custom among them.
  const BUILT_INS = REBASE_ENZYMES.slice(30, 60).map((e) => e.id ?? e.name).reverse();
  const BIG: Coll = { id: 'collection:big', name: 'Big set', enzymeIds: [...BUILT_INS.slice(0, 10), MY_ID, ...BUILT_INS.slice(10)] };

  it('US-01M7JPK6 AC3 the fixtures: one of 100,001-150,000 bp, one over 150,000 bp', () => {
    expect(midDoc.sequence.length).toBeGreaterThan(100_000);
    expect(midDoc.sequence.length).toBeLessThanOrEqual(150_000);
    expect(bigDoc.sequence.length).toBeGreaterThan(150_000);
    expect(BUILT_INS).toHaveLength(30);
    expect(new Set(BUILT_INS).size).toBe(30);
  });

  it('US-01M7JPK6 AC3 a collection of at most 28 built-ins is scanned whole and no word says "core enzymes"', async () => {
    await withDoc(seeded({ choice: choiceValue(CLONING.id) }), midDoc, async (app) => {
      expect(lastScan().seqLen).toBe(midDoc.sequence.length);
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      const all = [header(app), onceListName(app), ...restrictionNotes(app), ...linearNotes(app), circularNote(app)].join(' ');
      expect(all).not.toMatch(/core enzymes/);
      expect(restrictionNotes(app)).toEqual(['Only the 3 enzymes in the collection "Cloning set" were scanned: other enzymes may also cut this sequence.']);
    });
  });

  it('US-01M7JPK6 AC3 30 built-ins and 1 custom scan the first 28 built-ins and the custom, and the detail says so', async () => {
    await withDoc(seeded({ collections: [CLONING, BIG], choice: choiceValue(BIG.id) }), midDoc, async (app) => {
      expect(lastScan().seqLen).toBe(midDoc.sequence.length);
      expect(sentNames(lastScan().custom)).toEqual([...BUILT_INS.slice(0, 28), MY_ID]);
      expect(restrictionNotes(app)).toEqual([
        'Only the first 28 built-in enzymes of "Big set" and its 1 custom enzyme were scanned: its other 2 built-in enzymes, and other enzymes, may also cut this sequence.',
      ]);
      expect(header(app)).toMatch(/^Restriction Analysis \([\d,]+ sites? from "Big set" \(29 enzymes\)\)$/);
      const all = [header(app), onceListName(app), ...restrictionNotes(app), ...linearNotes(app), circularNote(app)].join(' ');
      expect(all).not.toMatch(/core enzymes/);
    });
  });

  it('US-01M7JPK6 AC3 over 150,000 bp the same "Big set" is sent whole over the 60,000 bp slice, and the range words stand beside the collection words', async () => {
    await withDoc(seeded({ collections: [CLONING, BIG], choice: choiceValue(BIG.id) }), bigDoc, async (app) => {
      expect(lastScan().seqLen).toBe(60_000);
      expect(sentNames(lastScan().custom)).toEqual(BIG.enzymeIds);
      const all = [header(app), onceListName(app), ...restrictionNotes(app), ...linearNotes(app), circularNote(app)].join(' ');
      expect(all).not.toMatch(/first 28|core enzymes/);
      expect(restrictionNotes(app)).toEqual([
        `Only the first 60,000 of ${bigDoc.sequence.length.toLocaleString()} bp were scanned, as a linear sequence: an enzyme listed here may cut again past 60,000 bp. Only the 31 enzymes in the collection "Big set" were scanned: other enzymes may also cut this sequence.`,
      ]);
      expect(header(app)).toMatch(/^Restriction Analysis \([\d,]+ sites? in the first 60,000 bp from "Big set" \(31 enzymes\)\)$/);
      expect(onceListName(app)).toMatch(/^Cutting once in the first 60,000 bp among "Big set" \(31 enzymes\) \(\d+\)$/);
    });
  });
});

// ─── AC4 ───

/** Storage that refuses the enzyme stores' keys: reads and writes of them throw, as a blocked store. */
function refusingEnzymeKeys(base: LiveStorage): LiveStorage {
  const enzymeKey = (k: string) => k === ENZ_KEY || k === COLL_KEY || k === CHOICE_KEY;
  return {
    ...base,
    getItem: (k: string) => { if (enzymeKey(k)) throw new Error('SecurityError: storage is blocked'); return base.getItem(k); },
    setItem: (k: string, v: string) => { if (enzymeKey(k)) throw new Error('SecurityError: storage is blocked'); base.setItem(k, v); },
    get length() { return base.length; },
  } as LiveStorage;
}

describe('US-01M7JPK6 AC4: what cannot be scanned, read or saved is named, and falls back to every enzyme', () => {
  const NOT_STORED = 'A custom enzyme no longer stored';
  const GONE_CHOSEN = 'The collection chosen for site scans no longer exists: every enzyme is scanned.';
  const CHOICE_UNREADABLE = 'The collection chosen for site scans cannot be read, so every enzyme is scanned.';

  it('US-01M7JPK6 AC4 a gone custom member is not scanned and named for why, never by its id', async () => {
    const gone: Coll = { id: 'collection:gone', name: 'Gone set', enzymeIds: ['EcoRI', 'custom:gone-1', 'BamHI'] };
    await withDoc(seeded({ collections: [gone], choice: choiceValue(gone.id) }), docOf('pGone', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI']);
      const notes = restrictionNotes(app);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toBe(`Only the 2 enzymes in the collection "Gone set" were scanned: other enzymes may also cut this sequence. 1 member was not scanned: ${NOT_STORED}.`);
      expect(bodyText(app)).not.toContain('custom:');
    });
  });

  it('US-01M7JPK6 AC4 with the definitions unreadable a custom member is named as unreadable', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    storage.setItem(ENZ_KEY, '{not json');
    await withDoc(storage, docOf('pUnread', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI']);
      const notes = restrictionNotes(app);
      expect(notes[0]).toMatch(/1 member was not scanned: A custom enzyme \(the enzyme database could not be read\)\.$/);
      expect(bodyText(app)).not.toContain('custom:');
      expect(storage.getItem(ENZ_KEY)).toBe('{not json');
    });
  });

  it('US-01M7JPK6 AC4 a collection with nothing scannable shows no sites and says so', async () => {
    const empty: Coll = { id: 'collection:empty', name: 'Empty', enzymeIds: [] };
    await withDoc(seeded({ collections: [CLONING, empty], choice: choiceValue(empty.id) }), docOf('pEmpty', SMALL), async (app) => {
      expect(circularCutNames(app)).toEqual([]);
      expect(linearCutNames(app)).toEqual([]);
      // Nothing is scanned, so the panel lists no enzyme (it is not drawn for a scan that did not run).
      expect(app.all('section[aria-label="Displayed restriction sites"] .mbc-dsites-name')).toHaveLength(0);
      expect(header(app)).toBe('Restriction Analysis (0 sites from "Empty" (0 enzymes))');
      expect(uniqueList(app)).toEqual([]);
      expect(restrictionNotes(app)).toEqual(['The collection "Empty" holds no enzyme that can be scanned: no cut sites are shown.']);
    });
  });

  it('US-01M7JPK6 AC4 a chosen collection that was deleted scans every enzyme, says so once, and writes nothing', async () => {
    const storage = seeded({ choice: choiceValue('collection:deleted') });
    const stored = { choice: storage.getItem(CHOICE_KEY), collections: storage.getItem(COLL_KEY) };
    await withDoc(storage, docOf('pDeleted', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(timesIn(status(app), GONE_CHOSEN)).toBe(1);
      expect(restrictionNotes(app)).toEqual([]);
      // A later scan does not say it again: the window opened and closed, and the scan run anew after
      // another tab.
      await app.menu('tools:enzyme-database');
      await app.settle();
      await app.click(button(win(app), 'Close Restriction Enzymes'));
      await app.settle();
      engine.calls.length = 0;
      await app.clickTab('annotations-table');
      await app.settle();
      await app.clickTab('sequence-view');
      await app.settle();
      expect(scans().length).toBeGreaterThan(0);
      expect(timesIn(status(app), GONE_CHOSEN)).toBe(1);
      expect({ choice: storage.getItem(CHOICE_KEY), collections: storage.getItem(COLL_KEY) }).toEqual(stored);
    });
  });

  it('US-01M7JPK6 AC4 a collections store that cannot be read scans every enzyme and names the store reason, only while a choice names a collection', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    storage.setItem(COLL_KEY, '{bad');
    const stored = { choice: storage.getItem(CHOICE_KEY), collections: storage.getItem(COLL_KEY) };
    const notice =
      'The enzyme collections cannot be read, so every enzyme is scanned. The stored enzyme collections (molbiocraft.enzymeCollections) cannot be read: it is not valid JSON. They are kept as they are, and nothing is written over them.';
    await withDoc(storage, docOf('pBadColl', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(timesIn(status(app), notice)).toBe(1);
      expect({ choice: storage.getItem(CHOICE_KEY), collections: storage.getItem(COLL_KEY) }).toEqual(stored);
    });
    const noChoice = seeded();
    noChoice.setItem(COLL_KEY, '{bad');
    await withDoc(noChoice, docOf('pBadColl', SMALL), async (app) => {
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(status(app)).not.toContain('enzyme collections cannot be read');
      expect(chooserOptions(app)).toEqual(['All enzymes']);
    });
  });

  for (const [what, value] of [
    ['not JSON', '{oops'],
    ['a schema this build does not know', JSON.stringify({ schema: 2, collectionId: CLONING.id })],
    ['no collectionId', JSON.stringify({ schema: 1 })],
  ] as const) {
    it(`US-01M7JPK6 AC4 a stored choice that cannot be read (${what}) scans every enzyme, says so once, and is kept`, async () => {
      const storage = seeded({ choice: value });
      await withDoc(storage, docOf('pChoice', SMALL), async (app) => {
        expect(sentNames(lastScan().custom)).toEqual(EVERY());
        expect(timesIn(status(app), CHOICE_UNREADABLE)).toBe(1);
        expect(storage.getItem(CHOICE_KEY)).toBe(value);
      });
    });
  }

  it('US-01M7JPK6 AC4 a choice the storage does not keep is still scanned for this run, and the status line says it was not saved', async () => {
    const base = seeded();
    const forgetful = { ...base, setItem: (k: string, v: string) => { if (k !== CHOICE_KEY) base.setItem(k, v); }, get length() { return base.length; } } as LiveStorage;
    await withDoc(forgetful, docOf('pForget', SMALL), async (app) => {
      await choose(app, 'Cloning set');
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      expect(panelNames(app)).toEqual(TRIO);
      expect(status(app)).toContain('The choice of collection was not saved: the storage did not keep it.');
      expect(base.getItem(CHOICE_KEY)).toBeNull();
    });
  });

  it('US-01M7JPK6 AC4 storage that is unavailable gives no collection notice and scans every enzyme', async () => {
    const storage = refusingEnzymeKeys(memoryStorage());
    await withDoc(storage, docOf('pBlocked', SMALL), async (app) => {
      expect(lastScan().custom).toBeNull();
      expect(status(app)).not.toMatch(/collection|every enzyme is scanned/);
      expect(chooserOptions(app)).toEqual(['All enzymes']);
    });
  });
});

// ─── AC5 ───

describe('US-01M7JPK6 AC5: the window\'s collection writes reach the scans while it is still open', () => {
  it('US-01M7JPK6 AC5 adding and removing a member of the chosen collection is read by the scans behind the open window; the definitions key is unchanged', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    const defs = storage.getItem(ENZ_KEY);
    await withDoc(storage, docOf('pLive', SMALL), async (app) => {
      expect(panelNames(app)).toEqual(TRIO);
      await app.menu('tools:enzyme-database');
      await app.settle();
      await app.change(field(win(app), 'Enzyme to add to Cloning set'), 'HindIII');
      await app.click(button(win(app), 'Add to Cloning set'));
      await app.settle();
      // The window is still open: the maps behind it are read.
      expect(win(app)).toBeTruthy();
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID, 'HindIII']);
      expect(panelNames(app)).toEqual([...TRIO, 'HindIII'].sort());
      expect(circularCutNames(app)).toContain('HindIII');
      expect(chooserOptions(app)).toContain('Cloning set (4 enzymes)');

      await app.click(button(win(app), 'Remove BamHI from Cloning set'));
      await app.settle();
      expect(win(app)).toBeTruthy();
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', MY_ID, 'HindIII']);
      expect(panelNames(app)).not.toContain('BamHI');
      expect(header(app)).toMatch(/from "Cloning set" \(3 enzymes\)\)$/);
      await app.click(button(win(app), 'Close Restriction Enzymes'));
      await app.settle();
      expect(storage.getItem(ENZ_KEY)).toBe(defs);
    });
  });

  it("US-01M7JPK6 AC5 a site's Add to a collection is read while its window is open", async () => {
    const storage = seeded();
    await withDoc(storage, docOf('pSiteAdd', SMALL), async (app) => {
      await app.click(button(panel(app), 'Add HindIII to a collection'));
      await app.settle();
      const region = app.one('section[aria-label="Add HindIII to a collection"]', 'the Add intent region');
      await app.change(field(region, 'Collection'), CLONING.id);
      await app.click(button(region, 'Add'));
      await app.settle();
      expect(win(app)).toBeTruthy();
      expect(chooserOptions(app)).toContain('Cloning set (4 enzymes)');
      await choose(app, 'Cloning set');
      expect(sentNames(lastScan().custom)).toEqual(['EcoRI', 'BamHI', MY_ID, 'HindIII']);
    });
  });

  it('US-01M7JPK6 AC5 deleting the chosen collection in the window scans every enzyme at once and says so', async () => {
    const storage = seeded({ choice: choiceValue(CLONING.id) });
    const defs = storage.getItem(ENZ_KEY);
    await withDoc(storage, docOf('pDel', SMALL), async (app) => {
      expect(panelNames(app)).toEqual(TRIO);
      await app.menu('tools:enzyme-database');
      await app.settle();
      await app.click(button(win(app), 'Delete Cloning set'));
      await app.settle();
      expect(win(app)).toBeTruthy();
      expect(sentNames(lastScan().custom)).toEqual(EVERY());
      expect(panelNames(app)).toContain('HindIII');
      expect(timesIn(status(app), 'The collection chosen for site scans no longer exists: every enzyme is scanned.')).toBe(1);
      expect(storage.getItem(ENZ_KEY)).toBe(defs);
    });
  });

  it('US-01M7JPK6 AC5 a per-site hide of an enzyme outside the collection is kept while it is chosen, with no cleared notice, and applies again on All enzymes', async () => {
    const storage = seeded();
    const defs = storage.getItem(ENZ_KEY);
    await withDoc(storage, docOf('pSite', SMALL), async (app) => {
      await app.click(button(panel(app), 'Expand the 2 sites of HindIII'));
      await app.settle();
      const siteBoxes = () => panel(app).querySelectorAll('input[type="checkbox"]').filter((b) => /^Show HindIII at .* strand$/.test(b.getAttribute('aria-label') ?? ''));
      expect(siteBoxes()).toHaveLength(2);
      const label = siteBoxes()[0].getAttribute('aria-label')!;
      await app.change(siteBoxes()[0], false);
      await app.settle();
      const hiddenCut = (/^Show HindIII at ([\d,]+),/.exec(label) ?? [])[1];
      expect(circularCutNames(app)).toContain('HindIII');
      const hindCallouts = () => app.all('svg.plasmid-svg g[role="button"]').map((g) => g.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Select HindIII ('));
      expect(hindCallouts()).toHaveLength(1);
      expect(hindCallouts()[0]).not.toBe(`Select HindIII (${hiddenCut})`);

      await choose(app, 'Cloning set');
      expect(panelNames(app)).toEqual(TRIO);
      expect(status(app)).not.toMatch(/cleared/);

      await choose(app, 'All enzymes');
      expect(status(app)).not.toMatch(/cleared/);
      expect(hindCallouts()).toHaveLength(1);
      const expand = panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Expand the 2 sites of HindIII');
      if (expand.length) await app.click(expand[0]);
      await app.settle();
      const box = panel(app).querySelectorAll('input[type="checkbox"]').find((b) => b.getAttribute('aria-label') === label);
      expect(box?.checked).toBe(false);
      expect(storage.getItem(ENZ_KEY)).toBe(defs);
    });
  });
});
