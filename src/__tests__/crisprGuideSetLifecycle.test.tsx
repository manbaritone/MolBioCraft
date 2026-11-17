// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVDF: a saved CRISPR guide set (US-01M7DVFD) is renamed, removed, rerun and marked stale
 * from the tab's saved-sets list, and none of it changes the document. Everything runs through the
 * real App (LC-003): the CRISPR sub-tab, its list's buttons, the one Run path's status and Stop, and
 * the View, Features, Sequence and Edit menu commands. The sets the App starts with are written to
 * its storage by the real store over real scans, so what the App reads is what a Save writes.
 *
 * Wrong implementations these kill (LC-002):
 * - AC1: a rename that renews the id or savedAt, or rewrites other sets; an empty or multi-line name
 *   accepted; Remove deleting on the first click, Cancel writing, or a remove taking every set of
 *   the document; a change written from the list the tab read on open, dropping a set another tab
 *   saved since; a dropped write reported as done.
 * - AC2: stale read from updatedAt, from the document object's identity or from a document name;
 *   rows from the live result rather than the stored rows; a stored row that jumps, annotates or
 *   draws on the map.
 * - AC3: stale on a map rotation, a view change or a new feature (each changes the document object
 *   or its updatedAt but not its revision); not stale on a topology toggle or Set Origin; stale kept
 *   after Undo.
 * - AC4: a rerun reading the tab's nuclease chooser, scope or result cap; a second Run button or a
 *   second Stop; a stopped, failed or overtaken rerun writing; a write from the set as listed when
 *   Rerun was pressed (a rename during the run lost); kept fields renewed or replaced fields kept;
 *   Save offered for the rerun's result; a write over a set removed meanwhile, or over a store that
 *   cannot be read or does not keep it, reported as done or dropping the shown result; an unknown
 *   or changed preset, or a stale interval, rerun anyway.
 * - AC5: any action writing the document.
 * - AC6: a set of a document not open listed with this document's, or offered for rerun; a set of
 *   another open document listed as not open; the section drawn as no sets over an unreadable store.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { crisprNucleasePresets, scanCrisprGuides, type CrisprScanReport, type CrisprScanResult } from '../core/bioEngine';
import { crisprHeuristicRuleText } from '../core/crisprGuideText';
import { openGuideSetDatabase, type GuideSet } from '../core/guideSetDatabase';
import { sequenceRevision } from '../core/restrictionDisplay';
import { getRustEngineDiagnostics } from '../lib/rustBioEngine';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { memoryStorage, type LiveStorage } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) =>
  (await import('./appHarness')).tauriIpcMock(await importOriginal<object>())
);

/** Every async `scan_crispr_guides` the App made, and a reply the test may hold or fail. */
const engine = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  asyncReply: null as
    | null
    | ((payload: Record<string, unknown>, real: (op: string, payload?: unknown) => unknown) => Promise<unknown>),
}));

vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...real,
    invokeRustBioNativeAsync: async <T,>(op: string, payload?: unknown): Promise<T> => {
      if (op === 'scan_crispr_guides') {
        engine.calls.push(payload as Record<string, unknown>);
        if (engine.asyncReply) {
          return (await engine.asyncReply(payload as Record<string, unknown>, (o, p) => real.invokeRustBioSync<unknown>(o, p))) as T;
        }
      }
      return real.invokeRustBioNativeAsync<T>(op, payload);
    },
  };
});

// Each mount launches the App afresh, with the real WASM engine behind it (LC-038).
vi.setConfig({ testTimeout: 120_000 });

const KEY = 'molbiocraft.crisprGuideSets';
const SPCAS9 = 'SpCas9 (NGG)';
const CAS12A = 'Cas12a / Cpf1 (TTTV)';

async function withApp(run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  engine.calls.length = 0;
  engine.asyncReply = null;
  const app = await mountApp(opts);
  try {
    await run(app);
  } finally {
    app.unmount();
    engine.asyncReply = null;
  }
}

// ─── Documents ───

/** Bases with no G, no CC and no TTT: no SpCas9 or Cas12a PAM on either strand. */
const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);
const plant = (seq: string, at: number, bases: string) => seq.slice(0, at - 1) + bases + seq.slice(at - 1 + bases.length);
const dnaDoc = (id: string, sequence: string, topology: 'linear' | 'circular'): SequenceDocument => ({
  id, name: `${id} plasmid`, accession: '', description: '', sequence, moleculeType: 'DNA', topology,
  folder: 'Local', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [], primers: [], history: [],
});

/** A 1,500-bp circle: SpCas9 sites at 201 and 901, a Cas12a site at 251 inside the interval 150..400. */
const LAB = dnaDoc(
  'pDVDF_Lab',
  plant(plant(plant(filler(1500), 201, 'ACGTACTGATCAGTCATGCAAGG'), 901, 'TACGTCATAGTCAGTACTCATGG'), 251, 'TTTAGACGTTACCGATTGCAATCGACA'),
  'circular'
);
/** An earlier, linear sequence of the same document, with its one SpCas9 site at 601. */
const EARLIER = { sequence: plant(filler(1500), 601, 'GACGTTACCGATTGCAATCGTGG'), topology: 'linear' as const };
const OTHER = dnaDoc('pDVDF_Other', plant(filler(900), 301, 'TACGTCATAGTCAGTACTCAAGG'), 'linear');
const INTERVAL = { start: 150, end: 400, lengthBp: 251, crossesOrigin: false };
/** Inside the circle, past base 1 and clear of every site: where Set Origin and Add Feature act. */
const SELECTION = { label: 'Selection', start: 601, end: 700 };

const rev = (d: { sequence: string; topology: string }) => sequenceRevision(d.sequence, d.topology === 'circular' ? 'circular' : 'linear');
const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const bp = (n: number) => n.toLocaleString('en-US');

// ─── The sets the App starts with, written by the real store over real scans ───

interface Seed {
  id: string;
  name: string;
  /** The sequence the set's search read. */
  on: { sequence: string; topology: 'linear' | 'circular' };
  doc: { id: string; name: string };
  nuclease?: string;
  interval?: typeof INTERVAL | null;
  cap?: number;
  /** A change to the stored set, for a preset or provenance the engine would not give today. */
  patch?: (set: GuideSet) => void;
}

function scanOf(on: Seed['on'], nuclease: string, cap: number, interval: { start: number; end: number } | null) {
  const r = scanCrisprGuides(on.sequence, nuclease, cap, on.topology === 'circular', interval);
  if (!r.report) throw new Error(`no scan report: ${r.reportUnavailableReason}`);
  return r as CrisprScanResult & { report: CrisprScanReport };
}

/** A storage holding these sets, as the store writes them; and the sets as stored. */
function seeded(seeds: Seed[]): { storage: LiveStorage; sets: GuideSet[] } {
  const storage = memoryStorage();
  let next = 0;
  const db = openGuideSetDatabase({ storage, now: () => '2026-11-01T00:00:00.000Z', newId: () => seeds[next++].id });
  for (const s of seeds) {
    const nuclease = s.nuclease ?? SPCAS9;
    const preset = crisprNucleasePresets().find((p) => p.id === nuclease)!;
    const cap = s.cap ?? 25;
    const result = scanOf(s.on, nuclease, cap, s.interval ?? null);
    const saved = db.save(
      {
        name: s.name,
        ranAt: '2026-10-31T12:00:00.000Z',
        criteria: { nuclease: preset, topology: s.on.topology, interval: s.interval ?? null, resultCap: cap },
        report: result.report,
        guides: result.guides,
        scoreNames: { onTargetScore: 'Old rank', specificityScore: 'Old seeds', offTargetCount: 'Old seeds' },
        heuristicRule: 'An older rule.',
      },
      { id: s.doc.id, name: s.doc.name, revision: rev(s.on) }
    );
    if (!saved.ok) throw new Error(saved.error.message);
  }
  const envelope = JSON.parse(storage.getItem(KEY)!) as { schema: number; sets: GuideSet[] };
  for (const [i, s] of seeds.entries()) {
    envelope.sets[i].engineVersion = 'an older engine';
    s.patch?.(envelope.sets[i]);
  }
  storage.setItem(KEY, JSON.stringify(envelope));
  return { storage, sets: envelope.sets };
}

const stored = (storage: LiveStorage) => JSON.parse(storage.getItem(KEY) ?? 'null') as { schema: number; sets: GuideSet[] };
const envelopeOf = (sets: GuideSet[]) => JSON.stringify({ schema: 1, sets });

// ─── The App ───

async function openStudio(app: AppHarness, docs: SequenceDocument[], activeDocId = docs[0].id): Promise<void> {
  await app.restoreSession({ documents: docs, activeDocId, viewerTab: 'primers-pcr', workspace: { selectedRange: SELECTION } });
  await app.menu('primers:crispr');
}

const entry = (app: AppHarness, id: string) => app.one(`[data-guide-sets] [data-guide-set="${id}"]`, `the entry of ${id}`);
const staleOf = (app: AppHarness, id: string) => entry(app, id).getAttribute('data-guide-set-stale');
const listedIds = (app: AppHarness) => app.all('[data-guide-sets] [data-guide-set]').map((e) => e.getAttribute('data-guide-set'));
const listedNames = (app: AppHarness) => app.all('[data-guide-set-name]').map((e) => words(e.textContent));
const elsewhereIds = (app: AppHarness) => app.all('[data-guide-sets-elsewhere] [data-guide-set-elsewhere]').map((e) => e.getAttribute('data-guide-set-elsewhere'));
const notice = (app: AppHarness) => words(app.one('[data-guide-set-outcome]', 'the guide-set outcome').textContent);
const button = (app: AppHarness, attr: string, id: string) => app.one(`[${attr}="${id}"]`, `${attr} of ${id}`);
const press = (app: AppHarness, attr: string, id: string) => app.click(button(app, attr, id));
const rowIds = (app: AppHarness, id: string) => app.all(`[data-guide-set-rows="${id}"] [data-guide-set-row]`).map((r) => r.getAttribute('data-guide-set-row'));
const runStatus = (app: AppHarness) => app.all('[data-crispr-run-status]').map((e) => [e.getAttribute('data-crispr-run-status'), words(e.textContent)]);
const shownResult = (app: AppHarness) => app.all('[data-crispr-shown-result]').map((e) => words(e.textContent));
const tableIds = (app: AppHarness) => app.all('[data-crispr-guide-row]').map((r) => r.getAttribute('data-crispr-guide-row'));

async function rename(app: AppHarness, id: string, name: string) {
  await press(app, 'data-guide-set-rename', id);
  await app.input(button(app, 'data-guide-set-rename-field', id), name);
  await press(app, 'data-guide-set-rename-save', id);
}
async function removeConfirmed(app: AppHarness, id: string) {
  await press(app, 'data-guide-set-remove', id);
  await press(app, 'data-guide-set-remove-yes', id);
}

/** Hold every scan reply until the test releases it; a released reply is the engine's own. */
function holdReplies() {
  const pending: { release: () => void; fail: () => void }[] = [];
  engine.asyncReply = (payload, real) =>
    new Promise((resolve, reject) =>
      pending.push({ release: () => resolve(real('scan_crispr_guides', payload)), fail: () => reject(new Error('the desktop engine stopped')) })
    );
  return pending;
}

/** The active document as File > Save Session writes it: its bases, topology, features and primers. */
async function savedDocument(app: AppHarness, docId: string) {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; sequence: string; topology: string; features: unknown[]; primers: unknown[] }[];
  };
  const doc = payload.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`the saved session holds no document "${docId}"`);
  return { sequence: doc.sequence, topology: doc.topology, features: doc.features, primers: doc.primers };
}

const LAB_REF = { id: LAB.id, name: LAB.name };
const CURRENT: Seed['on'] = { sequence: LAB.sequence, topology: 'circular' };

// ─── AC1 ───

describe('US-01M7DVDF AC1: rename and remove a saved set from the list', () => {
  it('US-01M7DVDF AC1 a rename keeps every other field byte for byte and refuses an empty or multi-line name; Remove asks, Cancel keeps, confirming removes only that set', async () => {
    const { storage, sets } = seeded([
      { id: 'set-a', name: 'Exon 2 sweep', on: CURRENT, doc: LAB_REF },
      { id: 'set-b', name: 'Promoter', on: CURRENT, doc: LAB_REF, interval: INTERVAL, nuclease: CAS12A },
      { id: 'set-o', name: 'Other plasmid', on: OTHER, doc: { id: OTHER.id, name: OTHER.name } },
    ]);
    const [a, b, o] = sets;
    await withApp(async (app) => {
      await openStudio(app, [LAB, OTHER]);
      expect(listedNames(app)).toEqual(['Exon 2 sweep', 'Promoter']);

      for (const bad of ['', '   ', 'two\nlines']) {
        const before = storage.getItem(KEY);
        await rename(app, a.id, bad);
        expect(notice(app), JSON.stringify(bad)).toBe('Not renamed: a guide set needs a one-line name.');
        expect(storage.getItem(KEY), `${JSON.stringify(bad)}: the stored value byte for byte`).toBe(before);
        await press(app, 'data-guide-set-rename-cancel', a.id);
      }

      // Another tab saves a set after this list was read: the rename keeps it, and the list shows it.
      const c = { ...b, id: 'set-c', name: 'Saved in another tab' };
      storage.setItem(KEY, envelopeOf([a, b, o, c]));
      await rename(app, a.id, 'Exon 2, kept');
      expect(notice(app)).toBe('Renamed the guide set to "Exon 2, kept".');
      expect(storage.getItem(KEY), 'only the name changed').toBe(envelopeOf([{ ...a, name: 'Exon 2, kept' }, b, o, c]));
      expect(listedNames(app), 'the list shows what is stored').toEqual(['Exon 2, kept', 'Promoter', 'Saved in another tab']);

      // Remove asks first, naming the set; Cancel writes nothing.
      const beforeRemove = storage.getItem(KEY);
      await press(app, 'data-guide-set-remove', b.id);
      expect(words(button(app, 'data-guide-set-remove-confirm', b.id).textContent)).toBe(
        'Remove the guide set "Promoter" from this computer? No document is changed.'
      );
      expect(storage.getItem(KEY), 'the first click removes nothing').toBe(beforeRemove);
      await press(app, 'data-guide-set-remove-cancel', b.id);
      expect(app.all('[data-guide-set-remove-confirm]')).toHaveLength(0);
      expect(storage.getItem(KEY), 'Cancel keeps the stored value byte for byte').toBe(beforeRemove);
      await removeConfirmed(app, b.id);
      expect(notice(app)).toBe('Removed the guide set "Promoter" from this computer; no document is changed.');
      expect(storage.getItem(KEY), 'only that set is gone').toBe(envelopeOf([{ ...a, name: 'Exon 2, kept' }, o, c]));
      expect(listedIds(app)).toEqual([a.id, c.id]);

      // A write the storage does not keep, and one it refuses: nothing is changed, and it says so.
      const kept = storage.getItem(KEY);
      const setItem = storage.setItem;
      storage.setItem = (k, v) => (k === KEY ? undefined : setItem(k, v));
      await rename(app, a.id, 'Dropped');
      expect(notice(app)).toBe('Nothing was changed: the storage did not keep the change.');
      await removeConfirmed(app, c.id);
      expect(notice(app)).toBe('Nothing was changed: the storage did not keep the change.');
      storage.setItem = (k, v) => {
        if (k === KEY) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        setItem(k, v);
      };
      await removeConfirmed(app, c.id);
      expect(notice(app)).toMatch(/^Nothing was changed: the storage refused the write \(QuotaExceededError/);
      storage.setItem = setItem;
      expect(storage.getItem(KEY)).toBe(kept);
      expect(listedNames(app), 'the list shows what is stored').toEqual(['Exon 2, kept', 'Saved in another tab']);

      // A store that cannot be read: nothing is changed, and the list names it.
      storage.setItem(KEY, '{"schema":1,"sets":[');
      await removeConfirmed(app, c.id);
      expect(notice(app)).toMatch(/^Nothing was changed: The saved guide sets \(molbiocraft\.crisprGuideSets\) cannot be read: it is not valid JSON/);
      expect(storage.getItem(KEY)).toBe('{"schema":1,"sets":[');
      expect(app.one('[data-guide-sets]').getAttribute('data-guide-sets')).toBe('unreadable');
    }, { storage });
  });
});

// ─── AC2 ───

describe('US-01M7DVDF AC2: Show rows lists the stored rows, and a set off the current revision says it is stale', () => {
  it('US-01M7DVDF AC2 a current set reads no stale sentence, a set of an earlier sequence reads both, and no stored row jumps, annotates or draws', async () => {
    const { storage, sets } = seeded([
      { id: 'set-now', name: 'Current', on: CURRENT, doc: LAB_REF },
      { id: 'set-then', name: 'Earlier', on: EARLIER, doc: { id: LAB.id, name: 'pDVDF_Lab as it was' } },
    ]);
    const [now, then] = sets;
    expect(then.guides.map((g) => g.id), 'the earlier rows are not the current ones').not.toEqual(now.guides.map((g) => g.id));
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      // A live result is shown beside the list: Show rows still lists each set's own stored rows.
      await app.change(app.one('select[aria-label="Search range:"]'), 'whole');
      await app.click(app.one('[data-crispr-run]'));
      await app.settle();
      const live = tableIds(app);
      expect(live.length, 'the live result has rows').toBeGreaterThan(0);
      expect(live, 'the live rows are not the earlier set\'s').not.toEqual(then.guides.map((g) => g.id));
      const docBefore = await savedDocument(app, LAB.id);
      expect([staleOf(app, now.id), staleOf(app, then.id)]).toEqual(['no', 'yes']);
      expect(words(entry(app, now.id).textContent)).not.toMatch(/Stale|Computed on revision/);
      expect(app.all(`[data-guide-set="${then.id}"] [data-guide-set-stale-note]`).map((e) => words(e.textContent))).toEqual([
        `Stale: computed on revision ${then.sequenceRevision} of pDVDF_Lab as it was; its bases or topology have changed since.`,
      ]);

      for (const set of [now, then]) {
        expect(rowIds(app, set.id), 'no rows until asked').toEqual([]);
        await press(app, 'data-guide-set-show-rows', set.id);
        expect(rowIds(app, set.id), `${set.name}: its stored rows by id`).toEqual(set.guides.map((g) => g.id));
      }
      expect(words(entry(app, now.id).textContent)).not.toMatch(/Stale|Computed on revision/);
      expect(app.all(`[data-guide-set-rows="${then.id}"] [data-guide-set-rows-note]`).map((e) => words(e.textContent))).toEqual([
        `Computed on revision ${then.sequenceRevision}, not the current sequence: these coordinates are not read against it.`,
      ]);

      // Read-only: no control in the rows, and a click on one is not a guide jump, an annotation or a map highlight.
      expect(app.all('[data-guide-set-rows] button, [data-guide-set-rows] a, [data-guide-set-rows] input')).toHaveLength(0);
      for (const row of app.all('[data-guide-set-row]')) await app.click(row);
      expect(app.activeTab(), 'no jump to the Sequence view').toBe('primers-pcr');
      expect(tableIds(app), 'the live guide table is as it was').toEqual(live);
      expect(await savedDocument(app, LAB.id), 'nothing annotated').toEqual(docBefore);
      await app.clickTab('sequence-view');
      expect(app.all('[data-guide-highlight], [data-guide-arc]'), 'no guide drawn on the map').toHaveLength(0);
    }, { storage });
  });
});

// ─── AC3 ───

describe('US-01M7DVDF AC3: a set goes stale on the edits that change its bases or topology, and only those', () => {
  it('US-01M7DVDF AC3 rotate, a view change and a new feature leave it current; Toggle Topology and Set Origin make it stale; Undo brings it back', async () => {
    const { storage, sets } = seeded([{ id: 'set-now', name: 'Current', on: CURRENT, doc: LAB_REF }]);
    const id = sets[0].id;
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      const back = async () => app.menu('primers:crispr');
      expect(staleOf(app, id)).toBe('no');

      await app.menu('view:rotate-map');
      await app.change(app.one('[role="dialog"][aria-label="Rotate Circular Map"] input[aria-label="Rotation in degrees"]', 'the degree field'), '90');
      await back();
      expect(staleOf(app, id), 'a map rotation').toBe('no');

      await app.menu('view:layout-linear');
      await app.menu('view:zoom-in');
      await back();
      expect(staleOf(app, id), 'a view change').toBe('no');

      const beforeFeature = await savedDocument(app, LAB.id);
      await app.menu('features:add');
      await app.click(app.one('form.mbc-prompt-dialog-form button[type="submit"]', 'Add Feature'));
      await back();
      const withFeature = await savedDocument(app, LAB.id);
      expect(withFeature.features.length, 'the feature was added').toBe(beforeFeature.features.length + 1);
      expect(withFeature.sequence).toBe(LAB.sequence);
      expect(staleOf(app, id), 'a new feature').toBe('no');

      await app.menu('sequence:toggle-topology');
      await back();
      expect((await savedDocument(app, LAB.id)).topology).toBe('linear');
      expect(staleOf(app, id), 'Toggle Topology').toBe('yes');
      await app.menu('edit:undo');
      await back();
      expect(staleOf(app, id), 'Undo back to the stored revision').toBe('no');

      await app.menu('view:set-origin');
      await back();
      expect((await savedDocument(app, LAB.id)).sequence, 'Set Origin rewrote the bases').not.toBe(LAB.sequence);
      expect(staleOf(app, id), 'Set Origin').toBe('yes');
      await app.menu('edit:undo');
      await back();
      expect((await savedDocument(app, LAB.id)).sequence).toBe(LAB.sequence);
      expect(staleOf(app, id), 'Undo back to the stored revision').toBe('no');
    }, { storage });
  });
});

// ─── AC4 ───

/** A whole-sequence set of an earlier, linear sequence of LAB, with a cap of 3: stale, so it reruns on the circle. */
const STALE_WHOLE: Seed = { id: 'set-w', name: 'Whole, capped', on: EARLIER, doc: { id: LAB.id, name: 'pDVDF_Lab as it was' }, cap: 3 };
const CURRENT_INTERVAL: Seed = { id: 'set-i', name: 'Promoter interval', on: CURRENT, doc: LAB_REF, nuclease: CAS12A, interval: INTERVAL };

describe('US-01M7DVDF AC4: Rerun runs the set through the one Run path and writes it in place when its reply completes', () => {
  it('US-01M7DVDF AC4 a rerun uses the set\'s nuclease, interval and cap, never the chooser, and a Stop, a failure or a later Run writes nothing', async () => {
    const { storage, sets } = seeded([STALE_WHOLE, CURRENT_INTERVAL]);
    const [w, i] = sets;
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      // The chooser asks for another nuclease over the selection: the rerun reads neither.
      await app.change(app.all('select[aria-label="Nuclease / PAM:"]')[0], CAS12A);
      expect(app.one('select[aria-label="Search range:"]').value).toBe('interval');
      const raw = storage.getItem(KEY);
      const pending = holdReplies();

      await press(app, 'data-guide-set-rerun', w.id);
      expect(engine.calls, 'one engine call').toHaveLength(1);
      expect(engine.calls[0]).toMatchObject({ seq: LAB.sequence, nuclease: SPCAS9, maxResults: 3, circular: true });
      expect('start1Based' in engine.calls[0], 'the whole sequence, as the set ran').toBe(false);
      expect(runStatus(app)).toEqual([['running', `Running "Whole, capped": the engine was asked for ${bp(1500)} bp.`]]);
      expect(app.all('[data-crispr-run]'), 'one Run').toHaveLength(1);
      expect(app.all('[data-crispr-stop]'), 'one Stop').toHaveLength(1);
      await press(app, 'data-guide-set-show-rows', w.id);
      expect(rowIds(app, w.id), 'the earlier rows stay listed').toEqual(w.guides.map((g) => g.id));
      await app.click(app.one('[data-crispr-stop]'));
      expect(runStatus(app)[0][1]).toMatch(/^Stopped "Whole, capped" before the engine replied/);
      pending.shift()!.release();
      await app.settle();
      expect(storage.getItem(KEY), 'a stopped rerun writes nothing').toBe(raw);
      expect(shownResult(app)).toEqual([]);

      await press(app, 'data-guide-set-rerun', w.id);
      pending.shift()!.fail();
      await app.settle();
      expect(runStatus(app)[0]).toEqual(['failed', expect.stringMatching(/^"Whole, capped" failed: /)]);
      expect(storage.getItem(KEY), 'a failed rerun writes nothing').toBe(raw);

      // A later Run before the reply: the rerun's reply is dropped and the tab's own result is not written.
      await press(app, 'data-guide-set-rerun', w.id);
      await app.click(app.one('[data-crispr-run]'));
      expect(engine.calls.at(-1)).toMatchObject({ nuclease: CAS12A, maxResults: 25, start1Based: SELECTION.start, end1Based: SELECTION.end });
      pending.shift()!.release();
      await app.settle();
      expect(storage.getItem(KEY), 'an overtaken rerun writes nothing').toBe(raw);
      pending.shift()!.release();
      await app.settle();
      expect(storage.getItem(KEY), 'the tab\'s own Run writes no set').toBe(raw);
      expect(app.all('[data-crispr-save-set]'), 'the tab\'s own result may be saved').toHaveLength(1);

      // The interval set reruns its own interval with its own nuclease.
      engine.asyncReply = null;
      await app.change(app.all('select[aria-label="Nuclease / PAM:"]')[0], SPCAS9);
      const before = engine.calls.length;
      await press(app, 'data-guide-set-rerun', i.id);
      await app.settle();
      expect(engine.calls.slice(before)).toEqual([
        expect.objectContaining({ nuclease: CAS12A, maxResults: 25, circular: true, start1Based: INTERVAL.start, end1Based: INTERVAL.end }),
      ]);
    }, { storage });
  });

  it('US-01M7DVDF AC4 a completed rerun keeps the set\'s id, name as stored then, document, nuclease, interval, cap and savedAt and takes the rest from the rerun, and Save is not offered for it', async () => {
    const { storage, sets } = seeded([STALE_WHOLE, CURRENT_INTERVAL]);
    const [w, i] = sets;
    const oracle = scanOf(CURRENT, SPCAS9, 3, null);
    expect(oracle.guides.map((g) => g.id), 'the rerun finds other rows').not.toEqual(w.guides.map((g) => g.id));
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      expect(staleOf(app, w.id)).toBe('yes');
      const pending = holdReplies();
      const t0 = Date.now();
      await press(app, 'data-guide-set-rerun', w.id);
      // Renamed while it runs: the write keeps the name as stored when the reply comes.
      await rename(app, w.id, 'Renamed while it ran');
      pending.shift()!.release();
      await app.settle();
      const t1 = Date.now();

      const after = stored(storage).sets;
      expect(after.map((s) => s.id)).toEqual([w.id, i.id]);
      expect(JSON.stringify(after[1]), 'the other set byte for byte').toBe(JSON.stringify(i));
      const set = after[0];
      for (const k of ['id', 'documentId', 'savedAt'] as const) expect(set[k], k).toBe(w[k]);
      expect(set.name).toBe('Renamed while it ran');
      for (const k of ['nuclease', 'interval', 'resultCap'] as const) {
        expect(JSON.stringify(set.criteria[k]), `criteria.${k}`).toBe(JSON.stringify(w.criteria[k]));
      }
      expect(JSON.stringify(set.guides), 'the rerun\'s rows').toBe(JSON.stringify(oracle.guides));
      expect(JSON.stringify(set.report), 'the rerun\'s report').toBe(JSON.stringify(oracle.report));
      expect(set.sequenceRevision).toBe(rev(CURRENT));
      expect(set.criteria.topology).toBe('circular');
      expect(set.documentName).toBe(LAB.name);
      expect(set.engineVersion).toBe(getRustEngineDiagnostics().version);
      expect(set.engineVersion).not.toBe('an older engine');
      expect(Date.parse(set.ranAt)).toBeGreaterThanOrEqual(t0);
      expect(Date.parse(set.ranAt)).toBeLessThanOrEqual(t1);
      expect(set.scoreNames).toEqual({
        onTargetScore: 'Heuristic Rank (8–98)',
        specificityScore: 'Exact Seed Matches (range searched)',
        offTargetCount: 'Exact Seed Matches (range searched)',
      });
      expect(set.heuristicRule).toBe(crisprHeuristicRuleText());

      expect(notice(app)).toBe(`Reran "Renamed while it ran": its ${oracle.guides.length} guides on revision ${rev(CURRENT)} are kept in place of the earlier ones.`);
      expect(shownResult(app), 'the shown result, under the set\'s name').toEqual([`"Whole, capped" searched ${bp(1500)} bp.`]);
      expect(tableIds(app)).toEqual(oracle.guides.map((g) => g.id));
      expect(app.all('[data-crispr-save-set]'), 'Save this result is not offered for a rerun').toHaveLength(0);
      expect(staleOf(app, w.id), 'the rerun is on the current revision').toBe('no');
      await press(app, 'data-guide-set-show-rows', w.id);
      expect(rowIds(app, w.id)).toEqual(oracle.guides.map((g) => g.id));
    }, { storage });
  });

  it('US-01M7DVDF AC4 a set removed before the reply, or a store that cannot be read or does not keep the write, is not written and the result stays shown', async () => {
    const { storage, sets } = seeded([STALE_WHOLE]);
    const [w] = sets;
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      const pending = holdReplies();
      const setItem = storage.setItem;
      /** The set stored again, and the tab opened afresh so its list reads it. */
      const restore = async () => {
        storage.setItem = setItem;
        storage.setItem(KEY, envelopeOf([w]));
        await app.clickTab('sequence-view');
        await app.menu('primers:crispr');
      };
      const cases: { label: string; before: () => Promise<void>; meanwhile: () => Promise<void>; says: RegExp; after: () => string | null }[] = [
        {
          label: 'a set removed before the reply',
          before: async () => undefined,
          meanwhile: async () => removeConfirmed(app, w.id),
          says: new RegExp(`^Nothing was changed: no guide set with the id ${w.id} is stored now\\.$`),
          after: () => envelopeOf([]),
        },
        {
          label: 'a store that does not keep the write',
          before: restore,
          meanwhile: async () => {
            storage.setItem = (k, v) => (k === KEY ? undefined : setItem(k, v));
          },
          says: /^Nothing was changed: the storage did not keep the change\.$/,
          after: () => envelopeOf([w]),
        },
        {
          label: 'a store that cannot be read',
          before: restore,
          meanwhile: async () => {
            storage.setItem(KEY, '{"schema":9,"sets":[]}');
          },
          says: /^Nothing was changed: The saved guide sets .* cannot be read: it was written with schema 9/,
          after: () => '{"schema":9,"sets":[]}',
        },
      ];
      for (const c of cases) {
        await c.before();
        await press(app, 'data-guide-set-rerun', w.id);
        await c.meanwhile();
        pending.shift()!.release();
        await app.settle();
        expect(notice(app), c.label).toMatch(c.says);
        expect(storage.getItem(KEY), c.label).toBe(c.after());
        expect(shownResult(app), `${c.label}: the result is still shown`).toEqual([`"Whole, capped" searched ${bp(1500)} bp.`]);
        expect(tableIds(app).length, c.label).toBeGreaterThan(0);
      }
    }, { storage });
  });

  it('US-01M7DVDF AC4 a rerun whose reply comes while the studio is not shown is still written, and on return its notice shows and Save is not offered', async () => {
    const { storage, sets } = seeded([STALE_WHOLE]);
    const [w] = sets;
    const oracle = scanOf(CURRENT, SPCAS9, 3, null);
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      const pending = holdReplies();
      await press(app, 'data-guide-set-rerun', w.id);
      await app.clickTab('sequence-view');
      expect(app.all('[data-guide-sets], [data-crispr-run]'), 'the studio is not mounted').toHaveLength(0);
      pending.shift()!.release();
      await app.settle();
      const set = stored(storage).sets[0];
      expect(set.id).toBe(w.id);
      expect(set.sequenceRevision, 'written while the studio was not shown').toBe(rev(CURRENT));
      expect(set.engineVersion).toBe(getRustEngineDiagnostics().version);
      expect(JSON.stringify(set.guides)).toBe(JSON.stringify(oracle.guides));

      await app.menu('primers:crispr');
      expect(notice(app)).toBe(`Reran "Whole, capped": its ${oracle.guides.length} guides on revision ${rev(CURRENT)} are kept in place of the earlier ones.`);
      expect(shownResult(app)).toEqual([`"Whole, capped" searched ${bp(1500)} bp.`]);
      expect(app.all('[data-crispr-save-set]'), 'Save this result is not offered for a rerun').toHaveLength(0);
      expect(staleOf(app, w.id)).toBe('no');
    }, { storage });
  });

  it('US-01M7DVDF AC4 Rerun is refused, the engine not called, for a preset the engine lacks or has changed, and for a stale interval', async () => {
    const { storage, sets } = seeded([
      { id: 'set-gone', name: 'Gone nuclease', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.id = 'XCas9 (NGN)') },
      { id: 'set-spacer', name: 'Longer spacer', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.spacerLengthBp = 21) },
      { id: 'set-pam', name: 'Other PAM', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.pamPattern = 'NAG') },
      // The interval set was saved under another document name: the refusal names the active document.
      { ...CURRENT_INTERVAL, doc: { id: LAB.id, name: 'pDVDF_Lab as named when saved' } },
      { id: 'set-side', name: 'Other PAM side', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.pamSide = "5'") },
      { id: 'set-span', name: 'Wider site', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.siteSpanBp = 99) },
      { id: 'set-cut', name: 'Other cut', on: CURRENT, doc: LAB_REF, patch: (s) => void (s.criteria.nuclease.cutConvention = 'cuts somewhere else') },
    ]);
    const preset = crisprNucleasePresets().find((p) => p.id === SPCAS9)!;
    const spacer = preset.spacerLengthBp;
    expect([preset.pamSide, preset.siteSpanBp, preset.cutConvention], 'the patched values differ from the engine\'s').not.toContainEqual("5'");
    expect(preset.siteSpanBp).not.toBe(99);
    expect(sets[3].documentName, 'the stored document name is not the active one').not.toBe(LAB.name);
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      const raw = storage.getItem(KEY);
      const refusals: [string, string][] = [
        ['set-gone', '"Gone nuclease" was not rerun: the engine has no XCas9 (NGN) preset now.'],
        ['set-spacer', `"Longer spacer" was not rerun: the engine's ${SPCAS9} preset is not the one it ran with (spacerLengthBp was 21, is now ${spacer}).`],
        ['set-pam', `"Other PAM" was not rerun: the engine's ${SPCAS9} preset is not the one it ran with (pamPattern was NAG, is now NGG).`],
        ['set-side', `"Other PAM side" was not rerun: the engine's ${SPCAS9} preset is not the one it ran with (pamSide was 5', is now ${preset.pamSide}).`],
        ['set-span', `"Wider site" was not rerun: the engine's ${SPCAS9} preset is not the one it ran with (siteSpanBp was 99, is now ${preset.siteSpanBp}).`],
        ['set-cut', `"Other cut" was not rerun: the engine's ${SPCAS9} preset is not the one it ran with (cutConvention was cuts somewhere else, is now ${preset.cutConvention}).`],
      ];
      for (const [id, says] of refusals) {
        await press(app, 'data-guide-set-rerun', id);
        expect(notice(app), id).toBe(words(says));
        expect(engine.calls, `${id}: the engine is not called`).toEqual([]);
        expect(runStatus(app), `${id}: no run is started`).toEqual([]);
        expect(storage.getItem(KEY), `${id}: the stored value byte for byte`).toBe(raw);
      }

      // The interval set is current: it is offered. Stale, it is refused; Undo makes it current again.
      await app.menu('sequence:toggle-topology');
      await app.menu('primers:crispr');
      await press(app, 'data-guide-set-rerun', sets[3].id);
      expect(notice(app)).toBe(
        `"Promoter interval" was not rerun: it searched bases 150..400 of an earlier sequence of ${LAB.name}, and those bounds may no longer hold the same bases. Select the interval and press Run.`
      );
      expect(engine.calls, 'the engine is not called for a refused rerun').toEqual([]);
      expect(runStatus(app), 'no run is started').toEqual([]);
      expect(storage.getItem(KEY), 'the stored value byte for byte').toBe(raw);
      await app.menu('edit:undo');
      await app.menu('primers:crispr');
      await press(app, 'data-guide-set-rerun', sets[3].id);
      await app.settle();
      expect(engine.calls).toHaveLength(1);
    }, { storage });
  });
});

// ─── AC5 ───

describe('US-01M7DVDF AC5: nothing in the saved-sets list changes the document', () => {
  it('US-01M7DVDF AC5 bases, features and primers are identical before and after rename, remove, rerun and stale marking', async () => {
    const withParts: SequenceDocument = {
      ...LAB,
      features: [{ id: 'f-ori', name: 'ori', type: 'rep_origin', start: 1001, end: 1100, strand: 1, color: '#4363d8' }],
      primers: [
        {
          id: 'p-fwd', name: 'fwd', sequence: 'ATCATACTAATCTAACATTA', annealSequence: 'ATCATACTAATCTAACATTA', tail5Prime: '',
          bindStart: 1201, bindEnd: 1220, strand: 1, length: 20, gcPercent: 25, tmAnnealC: 44, tmFullC: 44, deltaG37: -12,
          hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: false,
        },
      ],
    };
    const { storage, sets } = seeded([
      { id: 'set-a', name: 'A', on: CURRENT, doc: LAB_REF },
      { id: 'set-b', name: 'B', on: CURRENT, doc: LAB_REF },
    ]);
    await withApp(async (app) => {
      await openStudio(app, [withParts]);
      const doc0 = await savedDocument(app, LAB.id);
      expect(doc0.features).toHaveLength(1);
      expect(doc0.primers).toHaveLength(1);
      await rename(app, sets[0].id, 'A renamed');
      expect(await savedDocument(app, LAB.id), 'rename').toEqual(doc0);
      await removeConfirmed(app, sets[1].id);
      expect(await savedDocument(app, LAB.id), 'remove').toEqual(doc0);
      await press(app, 'data-guide-set-rerun', sets[0].id);
      await app.settle();
      expect(notice(app)).toMatch(/^Reran "A renamed"/);
      expect(await savedDocument(app, LAB.id), 'rerun').toEqual(doc0);

      await app.menu('sequence:toggle-topology');
      const toggled = await savedDocument(app, LAB.id);
      await app.menu('primers:crispr');
      expect(staleOf(app, sets[0].id)).toBe('yes');
      await press(app, 'data-guide-set-show-rows', sets[0].id);
      expect(await savedDocument(app, LAB.id), 'stale marking').toEqual(toggled);
      expect({ ...toggled, topology: doc0.topology }, 'only the topology the menu toggled').toEqual(doc0);
    }, { storage });
  });
});

// ─── AC6 ───

describe('US-01M7DVDF AC6: sets of documents not open are listed apart and never rerun', () => {
  const GONE = { id: 'pDVDF_Gone', name: 'pDVDF_Gone plasmid' };

  it('US-01M7DVDF AC6 a set of a document not open is listed apart with its document, rows and Remove and no Rerun; a set of another open document is in neither list', async () => {
    const { storage, sets } = seeded([
      { id: 'set-here', name: 'Here', on: CURRENT, doc: LAB_REF },
      { id: 'set-gone', name: 'Gone away', on: EARLIER, doc: GONE },
      { id: 'set-open', name: 'Open elsewhere', on: OTHER, doc: { id: OTHER.id, name: OTHER.name } },
    ]);
    const [here, gone, open] = sets;
    await withApp(async (app) => {
      await openStudio(app, [LAB, OTHER]);
      expect(listedIds(app)).toEqual([here.id]);
      expect(app.all('[data-guide-sets-elsewhere]'), 'one section').toHaveLength(1);
      expect(app.all('[data-guide-sets] [data-guide-sets-elsewhere]'), 'outside the document\'s list').toHaveLength(0);
      expect(elsewhereIds(app)).toEqual([gone.id]);
      expect([...listedIds(app), ...elsewhereIds(app)]).not.toContain(open.id);
      const section = words(app.one('[data-guide-sets-elsewhere]').textContent);
      expect(section).toContain('Saved guide sets for documents not open');
      expect(section).toContain(`Gone away — for ${GONE.name}:`);
      expect(section).toContain(`revision ${gone.sequenceRevision}`);
      expect(words(app.one(`[data-guide-set-elsewhere="${gone.id}"] [data-guide-set-no-rerun]`).textContent)).toBe(
        `Not offered for rerun: ${GONE.name} is not open in this workspace, and a set is never rerun on another document.`
      );
      expect(app.all(`[data-guide-set-rerun="${gone.id}"]`), 'no Rerun').toHaveLength(0);
      expect(app.all('[data-guide-sets-elsewhere] [data-guide-set-rerun]')).toHaveLength(0);
      expect(app.all('[data-guide-sets-elsewhere] [data-guide-set-rename]'), 'no Rename').toHaveLength(0);
      // Its revision is not the active document's, and it is still never marked stale against it.
      expect(gone.sequenceRevision).not.toBe(rev(CURRENT));
      const goneEntry = app.one(`[data-guide-set-elsewhere="${gone.id}"]`);
      expect(goneEntry.getAttribute('data-guide-set-stale'), 'no stale state').toBeNull();
      await press(app, 'data-guide-set-show-rows', gone.id);
      expect(rowIds(app, gone.id)).toEqual(gone.guides.map((g) => g.id));
      expect(app.all('[data-guide-sets-elsewhere] [data-guide-set-stale-note], [data-guide-sets-elsewhere] [data-guide-set-rows-note]')).toHaveLength(0);
      expect(words(app.one('[data-guide-sets-elsewhere]').textContent)).not.toMatch(/Stale|Computed on revision/);

      await removeConfirmed(app, gone.id);
      expect(storage.getItem(KEY)).toBe(envelopeOf([here, open]));
      expect(app.all('[data-guide-sets-elsewhere]'), 'absent once no such set is stored').toHaveLength(0);
    }, { storage });

    // On the other open document, its own set is listed and LAB's is in neither list.
    await withApp(async (app) => {
      await openStudio(app, [LAB, OTHER], OTHER.id);
      expect(listedIds(app)).toEqual([open.id]);
      expect(app.all('[data-guide-sets-elsewhere]')).toHaveLength(0);
    }, { storage });
  });

  it('US-01M7DVDF AC6 the section is absent when no such set is stored and when the store cannot be read, and never drawn as no sets', async () => {
    const { storage } = seeded([{ id: 'set-here', name: 'Here', on: CURRENT, doc: LAB_REF }]);
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      expect(app.all('[data-guide-sets-elsewhere]')).toHaveLength(0);
    }, { storage });

    const onlyGone = seeded([{ id: 'set-gone', name: 'Gone away', on: EARLIER, doc: GONE }]);
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      expect(app.one('[data-guide-sets]').getAttribute('data-guide-sets')).toBe('none');
      expect(elsewhereIds(app)).toEqual(['set-gone']);
    }, { storage: onlyGone.storage });

    const unreadable = memoryStorage({ [KEY]: '{"schema":1,"sets":[' });
    await withApp(async (app) => {
      await openStudio(app, [LAB]);
      expect(app.all('[data-guide-sets-elsewhere]'), 'absent, not drawn as no sets').toHaveLength(0);
      const list = app.one('[data-guide-sets]');
      expect(list.getAttribute('data-guide-sets')).toBe('unreadable');
      expect(words(list.textContent)).toContain('cannot be read');
      expect(words(list.textContent)).not.toMatch(/No saved/);
    }, { storage: unreadable });
  });
});
