// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DV52: a stored custom restriction enzyme is scanned and shown wherever the built-in
 * catalogue is: the circular and linear maps, the Displayed restriction sites panel, the App's
 * single-cutter list, the Enzymes view and the cloning studio's noncutter list, each marking it
 * "(custom)". The App reads the store (US-01M7DVMJ) once per write and hands every display scan the
 * active list: the catalogue (cut to its core over 100,000 bp scanned) plus every definition.
 *
 * The checks run in the real App over the live DOM (appHarness), with the store in the page's own
 * local storage, and the engine is the committed WASM. Its entry point is watched (not replaced), so
 * each test reads the list the App actually sent the engine: `customEnzymes` null is the catalogue.
 */

import React, { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** The engine's core set over 100,000 bp scanned (CORE_CATALOG_LEN, read from the map's module below). */
let CORE_CATALOG_LEN = 0;
/** The studios rendered on their own, loaded only once React DOM has been loaded under the live DOM (mountApp). */
let ui: {
  renderToStaticMarkup: typeof import('react-dom/server').renderToStaticMarkup;
  CloningAndGelStudio: typeof import('../components/CloningAndGelStudio').CloningAndGelStudio;
  HybridToolsAndHistoryStudio: typeof import('../components/HybridToolsAndHistoryStudio').HybridToolsAndHistoryStudio;
  SplitDocumentPane: typeof import('../components/SplitDocumentPane').SplitDocumentPane;
};
beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
  CORE_CATALOG_LEN = (await import('../components/CircularPlasmidMap')).CORE_CATALOG_LEN;
  ui = {
    renderToStaticMarkup: (await import('react-dom/server')).renderToStaticMarkup,
    CloningAndGelStudio: (await import('../components/CloningAndGelStudio')).CloningAndGelStudio,
    HybridToolsAndHistoryStudio: (await import('../components/HybridToolsAndHistoryStudio')).HybridToolsAndHistoryStudio,
    SplitDocumentPane: (await import('../components/SplitDocumentPane')).SplitDocumentPane,
  };
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

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};

const ENZ_KEY = 'molbiocraft.enzymeDatabase';
const ADA: CustomEnzymeInput = { name: 'AdaI', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6, provenance: 'own isolate' };
const ADA_EDITED_MOTIF = 'TGTGGATTGTG';
/** Adaeze's own "EcoRI": another motif, under the built-in's name, confirmed. */
const MINE: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 2, cutRev: 2 };
const NONE: CustomEnzymeInput = { name: 'NoneI', recognitionSeq: 'GATTACAGATTAC', cutFwd: 6, cutRev: 6 };
const ZED: CustomEnzymeInput = { name: 'ZedI', recognitionSeq: 'GTGTTGGATT', cutFwd: 5, cutRev: 5 };

/**
 * A/C filler with planted sites (every custom motif, and its reverse complement, holds a T or a G,
 * so the filler never holds one): the built-in
 * EcoRI's GAATTC twice, BamHI once, AdaI's motif once, the custom "EcoRI"'s once, the edited AdaI
 * motif once and ZedI's once.
 */
function construct(fill: number, extra = 0): string {
  return [
    filler(fill, 1), 'GAATTC', filler(fill, 2), ADA.recognitionSeq, filler(fill, 3), MINE.recognitionSeq, filler(fill, 4), 'GAATTC',
    filler(fill, 5), ADA_EDITED_MOTIF, filler(fill, 6), ZED.recognitionSeq, filler(fill, 7), 'GGATCC', filler(fill + extra, 8),
  ].join('');
}
const SMALL = construct(300);
const posOf = (seq: string, motif: string) => seq.indexOf(motif) + 1;

const docOf = (id: string, sequence: string, topology: 'circular' | 'linear' = 'circular'): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology, features: [], primers: [],
});

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function withDoc(storage: LiveStorage, doc: SequenceDocument, run: (app: AppHarness) => Promise<void>): Promise<void> {
  engine.calls.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({
      documents: [doc],
      activeDocId: doc.id,
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

/** The circular map's cut-site callouts, by their accessible names. */
const circularCuts = (app: AppHarness) =>
  app.all('svg.plasmid-svg g[role="button"]').map((g) => g.getAttribute('aria-label') ?? '').filter((l) => /^Select .* \([\d,]+\)$/.test(l));
/** The linear map's cut markers: accessible name and visible text. */
const linearCuts = (app: AppHarness) => app.all('.cut-pill').map((p) => ({ label: p.getAttribute('aria-label') ?? '', text: words(p.textContent) }));
const panel = (app: AppHarness) => app.one('section[aria-label="Displayed restriction sites"]', 'the Displayed restriction sites panel');
const panelNames = (app: AppHarness) => panel(app).querySelectorAll('.mbc-dsites-name').map((n) => words(n.textContent));
const panelBoxes = (app: AppHarness) =>
  panel(app).querySelectorAll('input[type="checkbox"]').map((b) => b.getAttribute('aria-label') ?? '').filter((l) => / sites on the maps$/.test(l));
const panelCount = (app: AppHarness, name: string) => {
  const row = panel(app).querySelectorAll('.mbc-dsites-row').filter((r) => words(r.querySelectorAll('.mbc-dsites-name')[0]?.textContent) === name);
  expect(row, `one panel row named ${name}`).toHaveLength(1);
  return words(row[0].querySelectorAll('.mbc-dsites-count')[0]?.textContent);
};
const uniqueList = (app: AppHarness) => app.all('.mbc-enzyme-cloud .mbc-enz-pill').map((b) => words(b.textContent).replace(/ \(\d[\d,]*\)$/, ''));
const restrictionNotes = (app: AppHarness) => app.all('.mbc-accordion-body .mbc-summary-note').map((n) => words(n.textContent));
const onceListName = (app: AppHarness) =>
  words(app.all('.mbc-accordion-body label.mbc-check-row span').map((s) => words(s.textContent)).find((t) => /^(Cutting once|Unique Single-Cutters)/.test(t)));
/** The App's own notices naming the enzyme store, outside the Restriction Enzymes window. */
const storeNotices = (app: AppHarness) =>
  app.all('[role="alert"]').filter((n) => !n.closest('[aria-labelledby="enzyme-db-title"]') && (n.textContent ?? '').includes(ENZ_KEY));

/** The App's display scans (the workbench and the Enzymes view), latest last. */
const scans = () => engine.calls.filter((c) => c.op === 'scan_restriction_sites');
const sentNames = (list: RestrictionEnzyme[] | null) => (list ?? []).map((e) => e.id ?? e.name);
const catalogueIds = (n = REBASE_ENZYMES.length) => REBASE_ENZYMES.slice(0, n).map((e) => e.id ?? e.name);

/** Opens the Enzymes view on its All tab and reads its table: name, # cuts, positions. */
async function enzymesView(app: AppHarness, tab = 'All REBASE Commercial') {
  await app.menu('view:enzymes');
  await app.settle();
  const t = app.all('button.method-tab-btn').find((b) => words(b.textContent) === tab);
  if (!t) throw new Error(`no "${tab}" tab: ${app.all('button.method-tab-btn').map((b) => words(b.textContent)).join(' | ')}`);
  await app.click(t);
  await app.settle();
  return enzymeRows(app);
}
const enzymeRows = (app: AppHarness) =>
  app.all('[aria-label="Restriction Enzymes Cleavage Sites Table"] tbody tr').map((tr) => {
    const td = tr.querySelectorAll('td');
    return { name: words(td[0].querySelectorAll('strong')[0]?.textContent), select: td[0].querySelectorAll('input')[0]?.getAttribute('aria-label') ?? '', cuts: words(td[5].textContent), positions: words(td[6].textContent) };
  });

// ─── The Restriction Enzymes window ───

const win = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"]', 'the Restriction Enzymes window');
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}: ${scope.querySelectorAll('button').map(nameOf).join(' | ')}`);
  return found[0];
}
const field = (scope: LiveElement, label: string) => {
  const found = scope.querySelectorAll('input, select').filter((f) => f.getAttribute('aria-label') === label);
  if (found.length !== 1) throw new Error(`expected one field labelled "${label}", found ${found.length}`);
  return found[0];
};
const editorForm = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] form', 'the enzyme editor');
async function chooseFile(app: AppHarness, name: string, text: string) {
  const input = app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] input[type="file"]', 'the backup file input');
  (input as unknown as { files: unknown[] }).files = [{ name, text: async () => text }];
  await act(async () => {
    dispatchLiveEvent(input, 'change');
  });
  await app.settle();
}

// ─── AC1 ───

describe('US-01M7DV52 AC1: a stored definition is reported, marked as custom, on every display surface', () => {
  it('US-01M7DV52 AC1 the maps, the panel, the single-cutter list and the Enzymes view report AdaI as "AdaI (custom)"', async () => {
    const at = posOf(SMALL, ADA.recognitionSeq);
    await withDoc(seeded([ADA]), docOf('pAda', SMALL), async (app) => {
      // The list sent: the whole catalogue, then the definition, with its custom id and source.
      const last = scans()[scans().length - 1];
      expect(sentNames(last.custom)).toEqual([...catalogueIds(), 'custom:seed-1']);
      expect(last.custom![last.custom!.length - 1]).toMatchObject({ id: 'custom:seed-1', source: 'custom', name: 'AdaI', recognitionSeq: ADA.recognitionSeq });

      const cutAt = String(at + ADA.cutFwd - 1);
      expect(circularCuts(app)).toContain(`Select AdaI (custom) (${cutAt})`);
      expect(app.all('svg.plasmid-svg text').map((t) => words(t.textContent))).toContain(`AdaI (custom) (${cutAt})`);
      expect(linearCuts(app)).toContainEqual({ label: `AdaI (custom) (${cutAt}) cut site: select it and open its cleavage preview`, text: `▼ AdaI (custom) (${cutAt})` });
      expect(panelNames(app)).toContain('AdaI (custom)');
      expect(panelBoxes(app)).toContain('Show AdaI (custom) sites on the maps');
      expect(uniqueList(app)).toContain('AdaI (custom)');
      // A built-in's own words are unchanged beside it.
      expect(panelBoxes(app)).toContain('Show BamHI sites on the maps');
      expect(panelNames(app)).not.toContain('BamHI (custom)');

      const rows = await enzymesView(app);
      const ada = rows.filter((r) => r.name.startsWith('AdaI'));
      expect(ada).toEqual([{ name: 'AdaI (custom)', select: 'Select AdaI (custom)', cuts: '1', positions: String(at + ADA.cutFwd - 1) }]);
      expect(rows.map((r) => r.name).slice(0, REBASE_ENZYMES.length)).toEqual(REBASE_ENZYMES.map((e) => e.name));
    });
  });

  it('US-01M7DV52 AC1 with no definition stored every surface sends the catalogue itself and draws only built-ins, unmarked', async () => {
    engine.calls.length = 0;
    await withDoc(memoryStorage(), docOf('pPlain', SMALL), async (app) => {
      expect(scans().length).toBeGreaterThan(0);
      for (const c of scans()) expect(c.custom, 'the App sends no list: the engine scans its own catalogue').toBeNull();
      expect(circularCuts(app).some((l) => l.includes('(custom)'))).toBe(false);
      expect(linearCuts(app).some((c) => c.label.includes('(custom)'))).toBe(false);
      expect(panelBoxes(app)).toContain('Show EcoRI sites on the maps');
      expect(panelCount(app, 'EcoRI')).toBe('2 sites');
      engine.calls.length = 0;
      const rows = await enzymesView(app);
      expect(rows.map((r) => r.name)).toEqual(REBASE_ENZYMES.map((e) => e.name));
      for (const c of scans()) expect(c.custom).toBeNull();
    });
  });
});

// ─── AC2 ───

describe('US-01M7DV52 AC2: the core cut follows the length the scan reads, and never drops a custom enzyme', () => {
  const coreDoc = docOf('pCore120k', construct(300, 118_000));
  const sliceDoc = docOf('pSlice160k', construct(300, 160_000));

  it('US-01M7DV52 AC2 the fixtures: one over 100,000 bp read whole, one over 150,000 bp read as a 60,000 bp slice', () => {
    expect(coreDoc.sequence.length).toBeGreaterThan(100_000);
    expect(coreDoc.sequence.length).toBeLessThanOrEqual(150_000);
    expect(sliceDoc.sequence.length).toBeGreaterThan(150_000);
    // The slice reaches the custom "EcoRI" and AdaI, so a dropped definition would show.
    expect(sliceDoc.sequence.indexOf(MINE.recognitionSeq)).toBeLessThan(60_000);
  });

  it('US-01M7DV52 AC2 over 100,000 bp scanned: the core built-ins plus every custom definition, and the scope words say so', async () => {
    await withDoc(seeded([ADA, MINE]), coreDoc, async (app) => {
      const last = scans()[scans().length - 1];
      expect(last.seqLen).toBe(coreDoc.sequence.length);
      expect(sentNames(last.custom)).toEqual([...catalogueIds(CORE_CATALOG_LEN), 'custom:seed-1', 'custom:seed-2']);
      expect(panelNames(app)).toEqual(expect.arrayContaining(['AdaI (custom)', 'EcoRI (custom)', 'EcoRI']));
      expect(restrictionNotes(app)).toContain(`Only ${CORE_CATALOG_LEN} core enzymes and your 2 custom enzymes were scanned: other built-in enzymes may also cut this sequence.`);
      expect(onceListName(app)).toMatch(new RegExp(`^Cutting once among ${CORE_CATALOG_LEN} core enzymes plus 2 custom \\(\\d+\\)$`));

      engine.calls.length = 0;
      const rows = await enzymesView(app);
      expect(sentNames(scans()[scans().length - 1].custom)).toEqual([...catalogueIds(CORE_CATALOG_LEN), 'custom:seed-1', 'custom:seed-2']);
      expect(rows.find((r) => r.name === 'AdaI (custom)')?.cuts).toBe('1');
      expect(rows.find((r) => r.name === REBASE_ENZYMES[CORE_CATALOG_LEN].name)?.cuts).toBe('not scanned');
    });
  });

  it('US-01M7DV52 AC2 over 150,000 bp the App and the split pane scan a 60,000 bp slice with the FULL catalogue plus every definition, and name only the range', async () => {
    await withDoc(seeded([ADA, MINE]), sliceDoc, async (app) => {
      const last = scans()[scans().length - 1];
      expect(last.seqLen).toBe(60_000);
      expect(sentNames(last.custom)).toEqual([...catalogueIds(), 'custom:seed-1', 'custom:seed-2']);
      const notes = restrictionNotes(app).join(' ');
      expect(notes).toContain(`Only the first 60,000 of ${sliceDoc.sequence.length.toLocaleString()} bp were scanned, as a linear sequence`);
      expect(notes).not.toMatch(/core enzymes|custom/);
      expect(panelNames(app)).toEqual(expect.arrayContaining(['AdaI (custom)', 'EcoRI (custom)']));
    });
    // The split pane, handed the same list, reads the same slice with the same enzymes.
    const list = [...REBASE_ENZYMES, { ...REBASE_ENZYMES[0], id: 'custom:split-1', source: 'custom' as const, name: 'AdaI', recognitionSeq: ADA.recognitionSeq, cutFwd: 4, cutRev: 6, provenance: '', notes: '' }];
    engine.calls.length = 0;
    ui.renderToStaticMarkup(<ui.SplitDocumentPane doc={sliceDoc} choices={[]} onChooseDoc={() => {}} onSwap={() => {}} onClose={() => {}} onUpdateDocument={() => {}} enzymes={list} />);
    expect(scans().map((c) => [c.seqLen, sentNames(c.custom)])).toEqual([[60_000, [...catalogueIds(), 'custom:split-1']]]);
    engine.calls.length = 0;
    ui.renderToStaticMarkup(<ui.SplitDocumentPane doc={coreDoc} choices={[]} onChooseDoc={() => {}} onSwap={() => {}} onClose={() => {}} onUpdateDocument={() => {}} enzymes={list} />);
    expect(scans().map((c) => [c.seqLen, sentNames(c.custom)])).toEqual([[coreDoc.sequence.length, [...catalogueIds(CORE_CATALOG_LEN), 'custom:split-1']]]);
  });

  it('US-01M7DV52 AC2 with no definition stored the over-100,000 bp words are as before', async () => {
    await withDoc(memoryStorage(), coreDoc, async (app) => {
      expect(scans()[scans().length - 1].custom).toBeNull();
      expect(restrictionNotes(app)).toContain(`Only ${CORE_CATALOG_LEN} core enzymes were scanned: other enzymes may also cut this sequence.`);
      expect(onceListName(app)).toMatch(new RegExp(`^Cutting once among ${CORE_CATALOG_LEN} core enzymes \\(\\d+\\)$`));
    });
  });
});

// ─── AC3 ───

describe('US-01M7DV52 AC3: a custom noncutter is a noncutter only when it was scanned', () => {
  const unreadable: RestrictionEnzyme = {
    id: 'custom:bad-1', source: 'custom', name: 'BadI', recognitionSeq: 'GAAXTC', cutFwd: 1, cutRev: 5, isTypeIIS: false,
    suppliers: [], methylationSensitivity: [], bufferNEB: '', tempC: 37, provenance: '', notes: '',
  };
  const noneEnzyme: RestrictionEnzyme = { ...unreadable, id: 'custom:none-1', name: 'NoneI', recognitionSeq: NONE.recognitionSeq, cutFwd: 6, cutRev: 6 };
  const doc = docOf('pAda', SMALL);

  it('US-01M7DV52 AC3 in the Enzymes view a scanned custom noncutter reads as a noncutter and an unread motif as not scanned', () => {
    // An Enzyme Set document opens on its set, so the rows named in it are listed whatever they cut.
    const setDoc: SequenceDocument = { ...doc, docMetadata: { ...(doc.docMetadata ?? {}), 'Document Type': 'Enzyme Set', 'Enzyme Names': 'NoneI, BadI, BamHI' } };
    const html = ui.renderToStaticMarkup(<ui.HybridToolsAndHistoryStudio doc={setDoc} allDocuments={[setDoc]} initialSubTab="enzymes-view" enzymes={[...REBASE_ENZYMES, noneEnzyme, unreadable]} />);
    const tbody = html.slice(html.indexOf('<tbody', html.indexOf('Restriction Enzymes Cleavage Sites Table')));
    const rows = [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => {
      const cells = [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim());
      return { name: cells[0], cuts: cells[5], positions: cells[6] };
    });
    expect(rows).toEqual([
      expect.objectContaining({ name: 'BamHI', cuts: '1' }),
      { name: 'NoneI (custom)', cuts: '0', positions: 'None (Noncutter)' },
      { name: 'BadI (custom)', cuts: 'not scanned', positions: 'Not scanned: its recognition sequence holds a letter the scan cannot read' },
    ]);
  });

  it('US-01M7DV52 AC3 through the App the Enzymes view reads a stored custom noncutter as a noncutter, never as not scanned', async () => {
    await withDoc(seeded([NONE, ADA]), doc, async (app) => {
      const rows = await enzymesView(app);
      expect(rows.find((r) => r.name === 'NoneI (custom)')).toMatchObject({ cuts: '0', positions: 'None (Noncutter)' });
    });
  });

  it('US-01M7DV52 AC3 the cloning noncutter list: a scanned custom noncutter is listed, an unread one is not, and the built-ins are the same at any length', async () => {
    const big = docOf('pCore120k', construct(300, 118_000));
    const listed = (d: SequenceDocument, enzymes?: RestrictionEnzyme[]) => {
      const html = ui.renderToStaticMarkup(
        <ui.CloningAndGelStudio documents={[d]} activeDoc={d} onAddConstruct={() => {}} initialSubTool="non-cutters" {...(enzymes ? { enzymes } : {})} />
      );
      const body = html.slice(html.indexOf('<tbody', html.indexOf('Recognition Site')));
      return [...body.matchAll(/<tr[^>]*><td><strong>([^<]+)<\/strong>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
    };
    for (const d of [doc, big]) {
      engine.calls.length = 0;
      const plain = listed(d);
      expect(engine.calls.filter((c) => c.op === 'find_non_cutting_enzymes').map((c) => c.custom), `${d.name}: no list sent`).toEqual([null]);
      const withCustom = listed(d, [...REBASE_ENZYMES, noneEnzyme, unreadable]);
      const sent = engine.calls.filter((c) => c.op === 'find_non_cutting_enzymes');
      expect(sentNames(sent[sent.length - 1].custom), `${d.name}: the FULL catalogue and the definitions`).toEqual([...catalogueIds(), 'custom:none-1', 'custom:bad-1']);
      expect(withCustom).toContain('NoneI (custom)');
      expect(withCustom.some((n) => n.startsWith('BadI'))).toBe(false);
      expect(withCustom.filter((n) => !n.endsWith('(custom)')), `${d.name}: the built-in noncutters`).toEqual(plain);
      expect(plain.length, `${d.name}: noncutters among the catalogue's non-core enzymes`).toBeGreaterThan(CORE_CATALOG_LEN);
    }
  });

  it('US-01M7DV52 AC3 through the App the cloning studio lists the stored custom noncutter and not a stored custom that cuts', async () => {
    await withDoc(seeded([NONE, ADA]), doc, async (app) => {
      await app.menu('enzymes:noncutters');
      await app.settle();
      const tab = app.all('button[role="tab"]').find((b) => /^Noncutters \(\d+\)$/.test(words(b.textContent)));
      if (!tab) throw new Error('no Noncutters tab');
      await app.click(tab);
      await app.settle();
      const names = app.all('tbody tr td strong').map((s) => words(s.textContent));
      expect(names).toContain('NoneI (custom)');
      expect(names).not.toContain('AdaI (custom)');
      const sent = engine.calls.filter((c) => c.op === 'find_non_cutting_enzymes');
      expect(sentNames(sent[sent.length - 1].custom)).toEqual([...catalogueIds(), 'custom:seed-1', 'custom:seed-2']);
    });
  });
});

// ─── AC4 ───

describe('US-01M7DV52 AC4: a store write in Databases > Restriction Enzymes reaches the scans at once', () => {
  it('US-01M7DV52 AC4 an add, an edit and an import in the window change the map and the Enzymes view without reopening the session', async () => {
    const doc = docOf('pAda', SMALL);
    const other = memoryStorage();
    const otherDb = openEnzymeDatabase({ storage: other, newId: () => 'custom:zed-1' });
    if (!otherDb.add(ZED).ok) throw new Error('ZedI not stored');
    const backup = otherDb.exportBackup();
    if (!backup.ok) throw new Error(backup.error.message);
    await withDoc(memoryStorage(), doc, async (app) => {
      expect(panelNames(app).some((n) => n.includes('(custom)'))).toBe(false);
      await app.menu('tools:enzyme-database');
      await app.settle();
      // Add.
      await app.click(button(win(app), 'Add custom enzyme'));
      const f = editorForm(app);
      await app.input(field(f, 'Name'), ADA.name);
      await app.input(field(f, "Recognition motif (5' → 3')"), ADA.recognitionSeq);
      await app.input(field(f, 'Top-strand cut (bases from the motif start)'), String(ADA.cutFwd));
      await app.input(field(f, 'Bottom-strand cut (bases from the motif start)'), String(ADA.cutRev));
      await app.click(button(editorForm(app), 'Save Enzyme'));
      await app.settle();
      const cutOf = (motif: string, cutFwd: number) => String(posOf(SMALL, motif) + cutFwd - 1);
      expect(circularCuts(app)).toContain(`Select AdaI (custom) (${cutOf(ADA.recognitionSeq, ADA.cutFwd)})`);
      expect(panelNames(app)).toContain('AdaI (custom)');
      expect(linearCuts(app).map((c) => c.text)).toContain(`▼ AdaI (custom) (${cutOf(ADA.recognitionSeq, ADA.cutFwd)})`);
      // Edit: the motif moves the site.
      await app.click(button(win(app), 'Edit AdaI'));
      await app.input(field(editorForm(app), "Recognition motif (5' → 3')"), ADA_EDITED_MOTIF);
      await app.click(button(editorForm(app), 'Save Changes'));
      await app.settle();
      expect(circularCuts(app).filter((l) => l.startsWith('Select AdaI'))).toEqual([`Select AdaI (custom) (${cutOf(ADA_EDITED_MOTIF, ADA.cutFwd)})`]);
      // Import.
      await chooseFile(app, 'zed.json', backup.value);
      expect(circularCuts(app)).toContain(`Select ZedI (custom) (${cutOf(ZED.recognitionSeq, ZED.cutFwd)})`);
      // The Enzymes view, opened after, holds all of them.
      await app.click(button(win(app), 'Close Restriction Enzymes'));
      const rows = await enzymesView(app);
      expect(rows.filter((r) => r.name.endsWith('(custom)')).map((r) => [r.name, r.cuts])).toEqual([['AdaI (custom)', '1'], ['ZedI (custom)', '1']]);
    });
  });

  it('US-01M7DV52 AC4 an unreadable store: one App notice, catalogue-only scans, and Discard clears the notice', async () => {
    const storage = memoryStorage({ [ENZ_KEY]: '{"schema": 1, "definitions": [' });
    await withDoc(storage, docOf('pAda', SMALL), async (app) => {
      expect(storeNotices(app), 'one App notice naming the store').toHaveLength(1);
      expect(words(storeNotices(app)[0].textContent)).toContain(`The stored enzyme database (${ENZ_KEY}) cannot be read`);
      for (const c of scans()) expect(c.custom).toBeNull();
      await enzymesView(app);
      expect(storeNotices(app), 'still one, with the Enzymes view open').toHaveLength(1);
      await app.menu('tools:enzyme-database');
      await app.settle();
      await app.click(button(win(app), 'Discard Unreadable Store…'));
      await app.click(button(win(app), 'Discard and Start Empty'));
      await app.settle();
      expect(storeNotices(app)).toHaveLength(0);
    });
  });

  it('US-01M7DV52 AC4 storage that is unavailable: catalogue-only scans, no App notice, and the window names it', async () => {
    const base = memoryStorage();
    const storage = { ...base, getItem: (k: string) => { if (k === ENZ_KEY) throw new Error('SecurityError: storage is blocked'); return base.getItem(k); },
      setItem: (k: string, v: string) => { if (k === ENZ_KEY) throw new Error('SecurityError: storage is blocked'); base.setItem(k, v); } } as LiveStorage;
    engine.calls.length = 0;
    await withDoc(storage, docOf('pAda', SMALL), async (app) => {
      expect(scans().length).toBeGreaterThan(0);
      for (const c of scans()) expect(c.custom).toBeNull();
      expect(storeNotices(app)).toHaveLength(0);
      expect(app.all('[role="alert"]').filter((n) => !n.closest('[aria-labelledby="enzyme-db-title"]') && /enzyme/i.test(n.textContent ?? ''))).toHaveLength(0);
      await app.menu('tools:enzyme-database');
      await app.settle();
      expect(words(win(app).textContent)).toContain('storage is unavailable');
    });
  });

  it('US-01M7DV52 AC4 the Digest dialog and the restriction-cloning picker still offer the catalogue only', async () => {
    await withDoc(seeded([ADA, MINE]), docOf('pAda', SMALL), async (app) => {
      expect(panelNames(app)).toContain('AdaI (custom)');
      await app.menu('enzymes:digest-dialog');
      await app.settle();
      const digest = app.one('[role="group"][aria-label="Enzymes to digest with"]', 'the Digest dialog\'s enzymes');
      expect(words(digest.textContent)).toContain('BamHI');
      expect(words(digest.textContent)).not.toMatch(/AdaI|\(custom\)/);
      await app.press('Escape');
      await app.settle();
      // The restriction-cloning dialog's unique-cutter pickers, over this vector.
      const before = app.all('select option').length;
      await app.menu('actions:clone-dialog');
      await app.settle();
      const options = app.all('select option').map((o) => words(o.textContent));
      expect(options.length).toBeGreaterThan(before);
      expect(options).toContain('BamHI');
      expect(options.some((o) => /AdaI|\(custom\)/.test(o))).toBe(false);
    });
  });
});

// ─── AC5 ───

describe('US-01M7DV52 AC5: a custom "EcoRI" beside the built-in EcoRI, end to end', () => {
  const doc = docOf('pTwoEco', SMALL);
  const mineCut = String(posOf(SMALL, MINE.recognitionSeq) + MINE.cutFwd - 1);

  it('US-01M7DV52 AC5 both appear, each labelled with its source, with their own counts and single-cutter judgements', async () => {
    await withDoc(seeded([MINE]), doc, async (app) => {
      expect(panelNames(app).filter((n) => n.startsWith('EcoRI'))).toEqual(['EcoRI', 'EcoRI (custom)']);
      expect(panelCount(app, 'EcoRI')).toBe('2 sites');
      expect(panelCount(app, 'EcoRI (custom)')).toBe('1 site');
      // The App's single-cutter list: the custom one cuts once, the built-in twice.
      expect(uniqueList(app)).toContain('EcoRI (custom)');
      expect(uniqueList(app)).not.toContain('EcoRI');
      expect(circularCuts(app).filter((l) => l.startsWith('Select EcoRI'))).toHaveLength(3);
      expect(circularCuts(app)).toContain(`Select EcoRI (custom) (${mineCut})`);
      const rows = await enzymesView(app);
      const eco = rows.filter((r) => r.name.startsWith('EcoRI'));
      expect(eco.map((r) => [r.name, r.select, r.cuts, r.positions.split(', ').length])).toEqual([
        ['EcoRI', 'Select EcoRI', '2', 2],
        ['EcoRI (custom)', 'Select EcoRI (custom)', '1', 1],
      ]);
      expect(eco[1].positions).toBe(String(posOf(SMALL, MINE.recognitionSeq) + MINE.cutFwd - 1));
      const once = await enzymesView(app, 'Unique Cutters (1)');
      expect(once.map((r) => r.name)).toContain('EcoRI (custom)');
      expect(once.map((r) => r.name)).not.toContain('EcoRI');
    });
  });

  it('US-01M7DV52 AC5 hiding one leaves the other\'s sites drawn on both maps, and the reverse', async () => {
    await withDoc(seeded([MINE]), doc, async (app) => {
      const drawn = () => ({
        circular: circularCuts(app).filter((l) => l.startsWith('Select EcoRI')).map((l) => (l.includes('(custom)') ? 'custom' : 'built-in')).sort(),
        linear: linearCuts(app).filter((c) => c.text.startsWith('▼ EcoRI')).map((c) => (c.text.includes('(custom)') ? 'custom' : 'built-in')).sort(),
      });
      // The circular map draws all three; the linear map the rows it has laid out, both kinds among them.
      const before = drawn();
      expect(before.circular).toEqual(['built-in', 'built-in', 'custom']);
      expect(new Set(before.linear)).toEqual(new Set(['built-in', 'custom']));
      const only = (kind: string, list: string[]) => list.filter((k) => k === kind);
      const box = (label: string) => panel(app).querySelectorAll(`input[aria-label="${label}"]`);
      expect(box('Show EcoRI sites on the maps')).toHaveLength(1);
      expect(box('Show EcoRI (custom) sites on the maps')).toHaveLength(1);
      await app.change(box('Show EcoRI (custom) sites on the maps')[0], false);
      expect(drawn()).toEqual({ circular: ['built-in', 'built-in'], linear: only('built-in', before.linear) });
      await app.change(box('Show EcoRI (custom) sites on the maps')[0], true);
      await app.change(box('Show EcoRI sites on the maps')[0], false);
      expect(drawn()).toEqual({ circular: ['custom'], linear: only('custom', before.linear) });
    });
  });

  it('US-01M7DV52 AC5 (BG-01M7H5M0) two same-named rows each keep their own focus and Tab stop, and their own React key', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
    try {
      await withDoc(seeded([MINE]), doc, async (app) => {
        const control = (label: string) => app.one(`section[aria-label="Displayed restriction sites"] [aria-label="${label}"]`, label);
        const focused = () => {
          const el = app.doc.activeElement as LiveElement;
          return el === (app.doc.body as unknown) ? 'body' : el.getAttribute('aria-label') ?? `<${el.localName}>`;
        };
        const shownOnly = (on: boolean) => app.change(panel(app).querySelectorAll('label.mbc-dsites-check input')[0], on);
        await app.input(control('Search enzymes by name'), 'EcoRI');
        await shownOnly(true);
        expect(panelNames(app)).toEqual(['EcoRI', 'EcoRI (custom)']);
        // Hide the custom row from the keyboard: it leaves, and focus lands on the built-in's box.
        control('Show EcoRI (custom) sites on the maps').focus();
        await app.press(' ');
        expect(panelNames(app)).toEqual(['EcoRI']);
        expect(focused()).toBe('Show EcoRI sites on the maps');
        // Back, then hide the built-in: focus lands on the custom row's box, never on the search.
        await shownOnly(false);
        await app.change(control('Show EcoRI (custom) sites on the maps'), true);
        await shownOnly(true);
        expect(panelNames(app)).toEqual(['EcoRI', 'EcoRI (custom)']);
        control('Show EcoRI sites on the maps').focus();
        await app.press(' ');
        expect(panelNames(app)).toEqual(['EcoRI (custom)']);
        expect(focused()).toBe('Show EcoRI (custom) sites on the maps');
      });
    } finally {
      spy.mockRestore();
    }
    expect(errors.filter((e) => /same key/i.test(e)), 'no two rows share a React key').toEqual([]);
  });
});
