// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7JX1J: the collection chosen in `Enzymes the site scans read` (US-01M7JPK6) is also what the
 * split pane and the Enzymes view scan, each over the bases it reads itself (the pane: the other
 * document's own 60,000 bp slice past 150,000 bp; the Enzymes view: the whole sequence), named in
 * the main view's words. The Lineage tab, digests, cloning and workflows keep every enzyme (D0168).
 *
 * The checks run in the real App over the live DOM (appHarness), the stores in the page's own local
 * storage, the engine the committed WASM. Its entry point is watched (not replaced), so each test
 * reads the list the App actually sent: `custom` null is the catalogue.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });

beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
});

/** Every restriction scan the engine receives: over how many bases, and the list it was sent (null: the catalogue). */
const engine = vi.hoisted(() => ({ calls: [] as Array<{ seqLen: number; custom: RestrictionEnzyme[] | null }> }));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...actual,
    invokeRustBioSync: (op: string, payload?: unknown) => {
      if (op === 'scan_restriction_sites') {
        const p = (payload ?? {}) as { seq?: string; customEnzymes?: RestrictionEnzyme[] | null };
        engine.calls.push({ seqLen: String(p.seq ?? '').length, custom: p.customEnzymes ?? null });
      }
      return actual.invokeRustBioSync(op, payload);
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// ─── The fixture ───

const COLL_KEY = 'molbiocraft.enzymeCollections';
const CHOICE_KEY = 'molbiocraft.enzymeScanCollection';
const T0 = '2026-01-01T00:00:00.000Z';

const MY: CustomEnzymeInput = { name: 'MyCut', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6, provenance: 'own isolate' };
const MY_ID = 'custom:mycut';

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};
/** A/C filler with EcoRI, BamHI and MyCut once each, and HindIII twice. */
function construct(fill: number, extra = 0): string {
  return [
    filler(fill, 1), 'GAATTC', filler(fill, 2), 'GGATCC', filler(fill, 3), 'AAGCTT', filler(fill, 4), MY.recognitionSeq,
    filler(fill, 5), 'AAGCTT', filler(fill + extra, 6),
  ].join('');
}
const docOf = (id: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology: 'circular', features: [], primers: [], ...more,
});

interface Coll { id: string; name: string; enzymeIds: string[] }
const CLONING: Coll = { id: 'collection:cloning', name: 'Cloning set', enzymeIds: ['EcoRI', 'BamHI', MY_ID] };
const EMPTY: Coll = { id: 'collection:empty', name: 'Empty', enzymeIds: [] };
// Thirty built-ins outside the core, in an order of their own, with the custom among them.
const BUILT_INS = REBASE_ENZYMES.slice(30, 60).map((e) => e.id ?? e.name).reverse();
const BIG: Coll = { id: 'collection:big', name: 'Big set', enzymeIds: [...BUILT_INS.slice(0, 10), MY_ID, ...BUILT_INS.slice(10)] };
const nameOfId = (id: string) => (id === MY_ID ? 'MyCut (custom)' : REBASE_ENZYMES.find((e) => (e.id ?? e.name) === id)!.name);

const collectionsValue = (list: Coll[]) =>
  JSON.stringify({ schema: 1, collections: list.map((c) => ({ ...c, createdAt: T0, modifiedAt: T0 })) });
const choiceValue = (collectionId: string | null) => JSON.stringify({ schema: 1, collectionId });

function seeded(opts: { collections?: Coll[] | null; choice?: string } = {}): LiveStorage {
  const storage = memoryStorage();
  const db = openEnzymeDatabase({ storage, now: () => T0, newId: () => MY_ID });
  const r = db.add(MY, { confirmedClash: builtInNameClash(MY.name) });
  if (!r.ok) throw new Error(r.error.message);
  if (opts.collections !== null) storage.setItem(COLL_KEY, collectionsValue(opts.collections ?? [CLONING, BIG, EMPTY]));
  if (opts.choice !== undefined) storage.setItem(CHOICE_KEY, opts.choice);
  return storage;
}

async function withDocs(storage: LiveStorage, docs: SequenceDocument[], run: (app: AppHarness) => Promise<void>): Promise<void> {
  engine.calls.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({
      documents: docs,
      activeDocId: docs[0].id,
      viewerTab: 'sequence-view',
      workspace: {
        mapLayoutMode: 'split',
        displaySettings: {
          showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);
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
const chooser = (app: AppHarness) => app.one('select[aria-label="Enzymes the site scans read"]', 'the scan collection chooser');
async function choose(app: AppHarness, label: string): Promise<void> {
  const option = chooser(app).options.find((o) => words(o.textContent).startsWith(label));
  if (!option) throw new Error(`the chooser offers no "${label}"`);
  await app.change(chooser(app), option.getAttribute('value') ?? '');
  await app.settle();
}
const win = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"]', 'the Restriction Enzymes window');
async function addToCloningSet(app: AppHarness, name: string): Promise<void> {
  await app.menu('tools:enzyme-database');
  await app.settle();
  await app.change(field(win(app), 'Enzyme to add to Cloning set'), name);
  await app.click(button(win(app), 'Add to Cloning set'));
  await app.settle();
  expect(win(app), 'the window is still open').toBeTruthy();
}

const scansOf = (seqLen: number) => engine.calls.filter((c) => c.seqLen === seqLen);
const lastScanOf = (seqLen: number) => scansOf(seqLen)[scansOf(seqLen).length - 1];
const sentNames = (list: RestrictionEnzyme[] | null) => (list ?? []).map((e) => e.id ?? e.name);
const EVERY = () => [...REBASE_ENZYMES.map((e) => e.id ?? e.name), MY_ID];

// The split pane.
const pane = (app: AppHarness) => app.one('section[aria-label="Split view"]', 'the split pane');
async function openSplit(app: AppHarness): Promise<void> {
  await app.click(app.one('[aria-label="Split view: show another document side by side"]', 'the split toggle'));
  await app.settle();
}
const paneNotes = (app: AppHarness) => pane(app).querySelectorAll('p.mbc-summary-note[role="note"]').map((p) => words(p.textContent));
const mainLinearNotes = (app: AppHarness) =>
  app.all('p.mbc-summary-note[role="note"]').filter((p) => !p.closest('.mbc-accordion-body') && !p.closest('section[aria-label="Split view"]')).map((p) => words(p.textContent));

// The Enzymes view.
const tabs = (app: AppHarness) => app.canvas().querySelectorAll('button.method-tab-btn').map((b) => words(b.textContent));
async function enzymesView(app: AppHarness, tab: string): Promise<void> {
  await app.menu('view:enzymes');
  await app.settle();
  const t = app.canvas().querySelectorAll('button.method-tab-btn').find((b) => words(b.textContent) === tab);
  if (!t) throw new Error(`no "${tab}" tab: ${tabs(app).join(' | ')}`);
  await app.click(t);
  await app.settle();
}
const tableRows = (app: AppHarness) =>
  app.canvas().querySelectorAll('[aria-label="Restriction Enzymes Cleavage Sites Table"] tbody tr').map((tr) => {
    const cells = tr.querySelectorAll('td');
    return { name: words(cells[0].querySelectorAll('strong')[0]?.textContent), text: words(tr.textContent), last: words(cells[cells.length - 1].textContent) };
  });
const tableNames = (app: AppHarness) => tableRows(app).map((r) => r.name);
/**
 * The Enzymes view's own panel. It is hosted in Sequence Map (US-01M7QC8Q, D0251), whose own notes (its scan-limit
 * note among them) share the canvas, so the view's words are read from its panel alone.
 */
const enzymesPanel = (app: AppHarness) => app.one('section[aria-label="Enzymes view"]', 'the Enzymes view');
const viewNotes = (app: AppHarness) => enzymesPanel(app).querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent));
const setStatus = (app: AppHarness) => app.one('.enzyme-set-action-bar', 'the Enzyme Set toolbar').querySelectorAll('span').map((s) => words(s.textContent));
const viewText = (app: AppHarness) => words(enzymesPanel(app).textContent);
/** Markup with React's generated ids (useId) made equal, which differ only by mount order. */
const markup = (el: LiveElement) => el.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');

/** The document as a saved session holds it: bases, features, primers and docMetadata. */
async function savedDocument(app: AppHarness) {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  return parseMbcWorkbench(await files[0].text()).envelope.documents.map((d) => ({
    id: d.id, sequence: d.sequence, features: d.features, primers: d.primers, docMetadata: (d as { docMetadata?: Record<string, unknown> }).docMetadata ?? null,
  }));
}

const CLONING_NOTE = 'Cut sites are shown for the 3 enzymes of "Cloning set" only: other enzymes were not scanned.';
const CLONING_DETAIL = 'Only the 3 enzymes in the collection "Cloning set" were scanned: other enzymes may also cut this sequence.';
const MAIN = docOf('pMain', construct(200));
const OTHER = docOf('pOther', construct(260));

// ─── AC1: the split pane ───

describe('US-01M7JX1J AC1: the split pane scans the chosen collection over its own document, in the main view\'s words', () => {
  it('US-01M7JX1J AC1 the fixtures differ in length, so the spy tells the pane\'s scan from the main view\'s', () => {
    expect(OTHER.sequence.length).not.toBe(MAIN.sequence.length);
    expect(BUILT_INS).toHaveLength(30);
    expect(new Set(BUILT_INS).size).toBe(30);
  });

  it('US-01M7JX1J AC1 with "Cloning set" chosen the pane\'s scan is sent exactly its three enzymes, and its linear view says the main view\'s note', async () => {
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [MAIN, OTHER], async (app) => {
      await openSplit(app);
      expect(sentNames(lastScanOf(OTHER.sequence.length).custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      expect(mainLinearNotes(app)).toContain(CLONING_NOTE);
      expect(paneNotes(app)).toEqual([CLONING_NOTE]);
    });
  });

  it('US-01M7JX1J AC1 a 200 kb document in the pane with "Big set" chosen is sent all 31 members over its 60,000 bp slice', async () => {
    const big = docOf('pBig200k', construct(200, 200_000));
    expect(big.sequence.length).toBeGreaterThan(200_000);
    await withDocs(seeded({ choice: choiceValue(BIG.id) }), [MAIN, big], async (app) => {
      await openSplit(app);
      const scan = lastScanOf(60_000);
      expect(scan, 'the pane scanned the 60,000 bp slice').toBeTruthy();
      expect(sentNames(scan.custom)).toEqual(BIG.enzymeIds);
      expect(scansOf(big.sequence.length)).toHaveLength(0);
      expect(paneNotes(app)).toEqual(['Cut sites are shown for the 31 enzymes of "Big set" only: other enzymes were not scanned.']);
    });
  });

  it('US-01M7JX1J AC1 adding HindIII to "Cloning set" in the open Restriction Enzymes window adds it to the pane\'s next scan', async () => {
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [MAIN, OTHER], async (app) => {
      await openSplit(app);
      const before = scansOf(OTHER.sequence.length).length;
      await addToCloningSet(app, 'HindIII');
      expect(scansOf(OTHER.sequence.length).length).toBeGreaterThan(before);
      expect(sentNames(lastScanOf(OTHER.sequence.length).custom)).toEqual(['EcoRI', 'BamHI', MY_ID, 'HindIII']);
      expect(paneNotes(app)).toEqual(['Cut sites are shown for the 4 enzymes of "Cloning set" only: other enzymes were not scanned.']);
    });
  });

  it('US-01M7JX1J AC1 a chosen collection with nothing to scan sends the engine nothing for the pane, and says so', async () => {
    await withDocs(seeded({ choice: choiceValue(EMPTY.id) }), [MAIN, OTHER], async (app) => {
      await openSplit(app);
      expect(scansOf(OTHER.sequence.length)).toHaveLength(0);
      expect(paneNotes(app)).toEqual(['The collection "Empty" holds no enzyme that can be scanned: no cut sites are shown.']);
    });
  });

  it('US-01M7JX1J AC1 with All enzymes the pane is sent every enzyme and draws exactly what it drew with no collection store', async () => {
    let today = '';
    await withDocs(seeded({ collections: null }), [MAIN, OTHER], async (app) => {
      await openSplit(app);
      expect(sentNames(lastScanOf(OTHER.sequence.length).custom)).toEqual(EVERY());
      today = markup(pane(app));
    });
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [MAIN, OTHER], async (app) => {
      await openSplit(app);
      await choose(app, 'All enzymes');
      expect(sentNames(lastScanOf(OTHER.sequence.length).custom)).toEqual(EVERY());
      expect(paneNotes(app)).toEqual([]);
      expect(markup(pane(app))).toBe(today);
    });
  });
});

// ─── AC2: the Enzymes view ───

const SET = 'EcoRI, XbaI, PstI';
const demo = (sequence: string, enzymeSet: string | false = false) =>
  docOf('pDemo', sequence, enzymeSet ? { docMetadata: { ...(docOf('x', '').docMetadata ?? {}), 'Enzyme Names': enzymeSet } } : {});

describe('US-01M7JX1J AC2: the Enzymes view lists and names only the chosen collection; the Lineage tab keeps every enzyme', () => {
  it('US-01M7JX1J AC2 with "Cloning set" stored, the view lists only its members over the whole sequence, says the panel\'s detail, and names the All tab for it', async () => {
    const doc = demo(construct(200));
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [doc], async (app) => {
      const before = await savedDocument(app);
      await enzymesView(app, 'All in "Cloning set"');
      expect(tabs(app)).not.toContain('All REBASE Commercial');
      expect(sentNames(lastScanOf(doc.sequence.length).custom)).toEqual(['EcoRI', 'BamHI', MY_ID]);
      expect(tableNames(app)).toEqual(['EcoRI', 'BamHI', 'MyCut (custom)']);
      expect(viewNotes(app)).toContain(CLONING_DETAIL);
      expect(await savedDocument(app)).toEqual(before);
    });
  });

  it('US-01M7JX1J AC2 the choice made in the chooser, then View > Enzymes, gives the same rows and words', async () => {
    const doc = demo(construct(200));
    await withDocs(seeded(), [doc], async (app) => {
      await choose(app, 'Cloning set');
      await enzymesView(app, 'All in "Cloning set"');
      expect(tableNames(app)).toEqual(['EcoRI', 'BamHI', 'MyCut (custom)']);
      expect(viewNotes(app)).toContain(CLONING_DETAIL);
    });
  });

  for (const [label, extra] of [['120 kb', 118_000], ['160 kb', 160_000]] as const) {
    it(`US-01M7JX1J AC2 with "Big set" on a ${label} document the 29th and 30th built-ins are not scanned and say why, and no word says "first 60,000"`, async () => {
      const doc = demo(construct(200, extra));
      expect(doc.sequence.length).toBeGreaterThan(100_000);
      if (extra > 150_000) expect(doc.sequence.length).toBeGreaterThan(150_000);
      await withDocs(seeded({ choice: choiceValue(BIG.id) }), [doc], async (app) => {
        await enzymesView(app, 'All in "Big set"');
        // The Enzymes view reads the whole sequence: the bounded member rule, never a slice.
        expect(sentNames(lastScanOf(doc.sequence.length).custom)).toEqual([...BUILT_INS.slice(0, 28), MY_ID]);
        const rows = tableRows(app);
        expect(rows.map((r) => r.name)).toEqual(BIG.enzymeIds.map(nameOfId));
        const why = 'Not scanned: only the first 28 built-in enzymes of "Big set" are scanned on this sequence';
        for (const id of BUILT_INS.slice(28)) expect(rows.find((r) => r.name === nameOfId(id))!.last).toBe(why);
        expect(rows.filter((r) => r.last === why)).toHaveLength(2);
        expect(viewText(app)).not.toContain('first 60,000');
        expect(viewText(app)).not.toContain('core enzymes');
      });
    });
  }

  it('US-01M7JX1J AC2 the fixture: the catalogue lists XbaI before PstI, so only a set in the other order tells set order from catalogue order', () => {
    const at = (n: string) => REBASE_ENZYMES.findIndex((e) => e.name === n);
    expect(at('XbaI')).toBeGreaterThanOrEqual(0);
    expect(at('XbaI')).toBeLessThan(at('PstI'));
    // Built-in names are unique, so the Custom Enzyme Set tab's Save count (the set's names the
    // catalogue holds) is the count of its rows with every enzyme scanned, today's count.
    expect(new Set(REBASE_ENZYMES.map((e) => e.name)).size).toBe(REBASE_ENZYMES.length);
  });

  it('US-01M7JX1J AC2 the note follows the Enzyme Set\'s own order, not the catalogue\'s: EcoRI, PstI, XbaI names PstI first', async () => {
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [demo(construct(200), 'EcoRI, PstI, XbaI')], async (app) => {
      await enzymesView(app, 'Custom Enzyme Set (3)');
      expect(viewNotes(app)).toContain('2 of this Enzyme Set\'s enzymes are not in "Cloning set" and were not scanned: PstI, XbaI.');
    });
  });

  it('US-01M7JX1J AC2 on the Custom Enzyme Set tab the table lists EcoRI and a note names the set\'s enzymes outside "Cloning set", in set order', async () => {
    const doc = demo(construct(200), SET);
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [doc], async (app) => {
      const before = await savedDocument(app);
      await enzymesView(app, 'Custom Enzyme Set (3)');
      expect(tableNames(app)).toEqual(['EcoRI']);
      expect(viewNotes(app)).toEqual([CLONING_DETAIL, '2 of this Enzyme Set\'s enzymes are not in "Cloning set" and were not scanned: XbaI, PstI.']);
      expect(await savedDocument(app)).toEqual(before);
    });
  });

  it('US-01M7JX1J AC2 Save on All in "Cloning set" saves its built-ins and names the collection and the custom row left out', async () => {
    const doc = demo(construct(200), SET);
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [doc], async (app) => {
      await enzymesView(app, 'All in "Cloning set"');
      // The Enzyme Set note belongs to the Custom Enzyme Set tab: the All tab says the detail only.
      expect(viewNotes(app)).toEqual([CLONING_DETAIL]);
      await app.click(button(app.canvas(), 'Save'));
      await app.settle();
      expect(setStatus(app)).toContain('Saved Enzyme Set "pDemo" (2 enzymes, from "Cloning set") (1 custom enzyme row(s) left out: an Enzyme Set holds built-in enzymes only)');
      expect((await savedDocument(app))[0].docMetadata?.['Enzyme Names']).toBe('EcoRI, BamHI');
    });
  });

  it('US-01M7JX1J AC2 on a fresh document Save on the Custom Enzyme Set tab keeps its 3 names and count although the table lists EcoRI only', async () => {
    const doc = demo(construct(200), SET);
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [doc], async (app) => {
      await enzymesView(app, 'Custom Enzyme Set (3)');
      expect(tableNames(app)).toEqual(['EcoRI']);
      await app.click(button(app.canvas(), 'Save'));
      await app.settle();
      expect(setStatus(app)).toContain('Saved Enzyme Set "pDemo" (3 enzymes)');
      expect((await savedDocument(app))[0].docMetadata?.['Enzyme Names']).toBe(SET);
    });
  });

  it('US-01M7JX1J AC2 the Lineage tab finds the BsaI-HFv2 site inside a CDS with and without the collection, and its alerts are identical', async () => {
    const seq = filler(300, 11) + filler(150, 12) + 'GGTCTC' + filler(150, 13) + filler(300, 14);
    const cds = { id: 'f-cds', name: 'gfp-cds', type: 'CDS', start: 301, end: 600, strand: 1, color: '#88aa88' } as SequenceDocument['features'][number];
    const doc = docOf('pLineage', seq, { features: [cds] });
    const alerts = async (choice?: string) => {
      let seen: string[] = [];
      await withDocs(seeded(choice === undefined ? {} : { choice }), [doc], async (app) => {
        // The alerts moved from History's Lineage tab to Info, for a DNA document (US-01M7QC8Q, D0251).
        await app.clickTab('document-info');
        await app.settle();
        seen = app.canvas().querySelectorAll('[aria-label="Sequence alerts and host strain"] .info-callout').map((c) => words(c.textContent));
      });
      return seen;
    };
    const without = await alerts();
    const withSet = await alerts(choiceValue(CLONING.id));
    const title = 'Internal Type IIS Site (BsaI-HFv2) Inside CDS "gfp-cds"';
    expect(without.some((a) => a.includes(title)), without.join(' | ')).toBe(true);
    expect(withSet.some((a) => a.includes(title))).toBe(true);
    expect(withSet).toEqual(without);
  });

  it('US-01M7JX1J AC2 a chosen collection with nothing to scan sends the engine nothing for the Enzymes view, and lists no row', async () => {
    const doc = demo(construct(200));
    await withDocs(seeded({ choice: choiceValue(EMPTY.id) }), [doc], async (app) => {
      await enzymesView(app, 'All in "Empty"');
      expect(scansOf(doc.sequence.length)).toHaveLength(0);
      expect(tableNames(app)).toEqual([]);
      expect(viewNotes(app)).toContain('The collection "Empty" holds no enzyme that can be scanned: no cut sites are shown.');
    });
  });

  it('US-01M7JX1J AC2 adding HindIII to "Cloning set" in the open Restriction Enzymes window adds it to the Enzymes view\'s rows', async () => {
    const doc = demo(construct(200));
    await withDocs(seeded({ choice: choiceValue(CLONING.id) }), [doc], async (app) => {
      await enzymesView(app, 'All in "Cloning set"');
      expect(tableNames(app)).toEqual(['EcoRI', 'BamHI', 'MyCut (custom)']);
      await addToCloningSet(app, 'HindIII');
      expect(tableNames(app)).toEqual(['EcoRI', 'BamHI', 'MyCut (custom)', 'HindIII']);
      expect(sentNames(lastScanOf(doc.sequence.length).custom)).toEqual(['EcoRI', 'BamHI', MY_ID, 'HindIII']);
    });
  });

  it('US-01M7JX1J AC2 with All enzymes every word and row is as before: the catalogue tab, the core words, the plain Save', async () => {
    const doc = demo(construct(200, 118_000), SET);
    const view = async (storage: LiveStorage, run?: (app: AppHarness) => Promise<void>) => {
      let html = '';
      await withDocs(storage, [doc], async (app) => {
        await enzymesView(app, 'All REBASE Commercial');
        html = markup(app.canvas());
        await run?.(app);
      });
      return html;
    };
    const today = await view(seeded({ collections: null }));
    const all = await view(seeded({ choice: choiceValue(null) }), async (app) => {
      expect(tabs(app)).toContain('All REBASE Commercial');
      const rows = tableRows(app);
      expect(rows).toHaveLength(REBASE_ENZYMES.length + 1);
      expect(rows.filter((r) => r.last === 'Not scanned: only the core enzymes are scanned on this sequence').length).toBeGreaterThan(0);
      await app.click(button(app.canvas(), 'Save'));
      await app.settle();
      expect(setStatus(app).some((s) => /^Saved Enzyme Set "pDemo" \(\d+ enzymes\) \(1 custom enzyme row\(s\) left out/.test(s))).toBe(true);
      expect(setStatus(app).join(' ')).not.toContain('from "');
    });
    expect(all).toBe(today);
  });
});
