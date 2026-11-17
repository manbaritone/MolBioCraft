// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVFD AC6: through the real App (LC-003), Save this result keeps a completed CRISPR search
 * as a named guide set in the user-local store, the tab lists the document's saved sets on open, and
 * a restart (a second mount over the same storage, the session restored on the same document id)
 * lists it again. An unreadable store is said to be unreadable, never drawn as no saved searches.
 *
 * Wrong implementations this kills (LC-002):
 * - Save offered before a run, while a run is going, after a Stop, after a failed run, or while the
 *   result is withdrawn (an edited sequence), or for a result kept from an earlier run;
 * - Save calling the document writer: the document as File > Save Session writes it must not change;
 * - a list read once and not refreshed, so the saved set is not shown at once;
 * - a list showing another document's sets;
 * - an unparseable stored value read as no saved searches.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { memoryStorage } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) =>
  (await import('./appHarness')).tauriIpcMock(await importOriginal<object>())
);

/** A reply the test may hold or fail in place of the engine's own, for the App's async scans. */
const engine = vi.hoisted(() => ({
  asyncReply: null as
    | null
    | ((payload: Record<string, unknown>, real: (op: string, payload?: unknown) => unknown) => Promise<unknown>),
}));

vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...real,
    invokeRustBioNativeAsync: async <T,>(op: string, payload?: unknown): Promise<T> => {
      if (op === 'scan_crispr_guides' && engine.asyncReply) {
        return (await engine.asyncReply(payload as Record<string, unknown>, (o, p) => real.invokeRustBioSync<unknown>(o, p))) as T;
      }
      return real.invokeRustBioNativeAsync<T>(op, payload);
    },
  };
});

// Each mount launches the App afresh, with the real WASM engine behind it (LC-038).
vi.setConfig({ testTimeout: 120_000 });

const GUIDE_SET_KEY = 'molbiocraft.crisprGuideSets';

async function withApp(run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  engine.asyncReply = null;
  const app = await mountApp(opts);
  try {
    await run(app);
  } finally {
    app.unmount();
    engine.asyncReply = null;
  }
}

const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);
const plant = (seq: string, at: number, bases: string) => seq.slice(0, at - 1) + bases + seq.slice(at - 1 + bases.length);
const dnaDoc = (id: string, sequence: string): SequenceDocument => ({
  id, name: id, accession: '', description: '', sequence, moleculeType: 'DNA', topology: 'linear',
  folder: 'Local', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [], primers: [], history: [],
});
const SAVE_DOC = dnaDoc('pFVD_Save', plant(plant(filler(1500), 201, 'ACGTACTGATCAGTCATGCAAGG'), 901, 'TACGTCATAGTCAGTACTCATGG'));
const OTHER_DOC = dnaDoc('pFVD_Other', plant(filler(900), 301, 'TACGTCATAGTCAGTACTCAAGG'));

const words = (s: string) => s.replace(/\s+/g, ' ').trim();

async function openStudio(app: AppHarness, docs: SequenceDocument[], activeDocId = docs[0].id): Promise<void> {
  await app.restoreSession({ documents: docs, activeDocId, viewerTab: 'primers-pcr' });
  await app.menu('primers:crispr');
}

const pressRun = (app: AppHarness) => app.click(app.one('[data-crispr-run]', 'the Run button'));
const pressStop = (app: AppHarness) => app.click(app.one('[data-crispr-stop]', 'the Stop button'));
const nameField = (app: AppHarness) => app.one('input[aria-label="Search name:"]', 'the search name field');
const listedGuideIds = (app: AppHarness) => app.all('[data-crispr-guide-row]').map((r) => r.getAttribute('data-crispr-guide-row'));
const saveButtons = (app: AppHarness) => app.all('[data-crispr-save-set]');
const saveOffered = (app: AppHarness) => saveButtons(app).length === 1;
/** The saved-sets section: its state attribute and its words. */
const savedSets = (app: AppHarness) => {
  const found = app.all('[data-guide-sets]');
  expect(found, 'one saved guide sets section').toHaveLength(1);
  return { state: found[0].getAttribute('data-guide-sets'), text: words(found[0].textContent) };
};
const savedSetNames = (app: AppHarness) => app.all('[data-guide-set-name]').map((e) => words(e.textContent));

/** The active document as File > Save Session writes it: its bases, features and primers. */
async function savedDocument(app: AppHarness, docId: string) {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; sequence: string; features: unknown[]; primers: unknown[] }[];
  };
  const doc = payload.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`the saved session holds no document "${docId}"`);
  return { sequence: doc.sequence, features: doc.features, primers: doc.primers };
}

describe('Save this result keeps a CRISPR search as a guide set across a restart (US-01M7DVFD)', () => {
  it('US-01M7DVFD AC6 Save is offered only for a shown completed run, lists the set at once, leaves the document unchanged, and lists it again after a restart', async () => {
    const storage = memoryStorage();
    const pending: ((v: unknown) => void)[] = [];
    let setName = '';
    await withApp(async (app) => {
      await openStudio(app, [SAVE_DOC, OTHER_DOC]);
      expect(saveOffered(app), 'not before a run').toBe(false);
      expect(savedSets(app)).toEqual({ state: 'none', text: expect.stringContaining('No saved searches') });

      // While running, and after a Stop.
      engine.asyncReply = (payload, real) =>
        new Promise((resolve) => pending.push(() => resolve(real('scan_crispr_guides', payload))));
      await pressRun(app);
      expect(saveOffered(app), 'not while it runs').toBe(false);
      await pressStop(app);
      expect(saveOffered(app), 'not after a Stop').toBe(false);
      pending.shift()!(null);
      await app.settle();
      expect(saveOffered(app), 'not for a reply that came after Stop').toBe(false);

      // After a failed run.
      engine.asyncReply = async () => {
        throw new Error('the desktop engine stopped');
      };
      await pressRun(app);
      expect(saveOffered(app), 'not after a failed run').toBe(false);

      // A completed run is offered; a failure after it is not, though its result is left shown.
      engine.asyncReply = null;
      await app.input(nameField(app), 'Exon 2 sweep');
      await pressRun(app);
      const ids = listedGuideIds(app);
      expect(ids.length, 'the run found the planted guides').toBeGreaterThan(0);
      expect(saveOffered(app), 'a completed run shown on this revision').toBe(true);
      // A run that is going, then stopped, with the earlier result left shown.
      engine.asyncReply = (payload, real) =>
        new Promise((resolve) => pending.push(() => resolve(real('scan_crispr_guides', payload))));
      await pressRun(app);
      expect(saveOffered(app), 'not while a later run is going').toBe(false);
      await pressStop(app);
      expect(listedGuideIds(app), 'Stop leaves the earlier result shown').toEqual(ids);
      expect(saveOffered(app), 'not after a Stop, even with an earlier result shown').toBe(false);
      pending.shift()!(null);
      await app.settle();
      engine.asyncReply = async () => {
        throw new Error('the desktop engine stopped');
      };
      await pressRun(app);
      expect(listedGuideIds(app), 'the earlier result is left as it was').toEqual(ids);
      expect(saveOffered(app), 'not after a failed run, even with an earlier result shown').toBe(false);
      engine.asyncReply = null;
      await pressRun(app);
      expect(saveOffered(app)).toBe(true);
      setName = words(nameField(app).value);
      expect(setName).toBe('Exon 2 sweep');

      // Withdrawn: the sequence's topology changed, then undone back to its revision.
      await app.menu('sequence:toggle-topology');
      expect(listedGuideIds(app)).toEqual([]);
      expect(saveOffered(app), 'not while the result is withdrawn').toBe(false);
      await app.menu('edit:undo');
      expect(listedGuideIds(app)).toEqual(ids);
      expect(saveOffered(app)).toBe(true);

      // Save: listed at once by name, and the document as saved is unchanged.
      const before = await savedDocument(app, SAVE_DOC.id);
      expect(before.sequence).toBe(SAVE_DOC.sequence);
      await app.click(saveButtons(app)[0]);
      expect(savedSets(app).state).toBe('saved');
      expect(savedSetNames(app), 'listed in the tab at once').toEqual([setName]);
      expect(savedSets(app).text).toContain('SpCas9 (NGG)');
      expect(words(app.one('[data-guide-set-save]', 'the save outcome').textContent)).toContain(`Saved "${setName}"`);
      expect(await savedDocument(app, SAVE_DOC.id), 'bases, features and primers as File > Save Session writes them').toEqual(before);
      const stored = JSON.parse(storage.getItem(GUIDE_SET_KEY) ?? 'null') as { schema: number; sets: { documentId: string; name: string; guides: { id: string }[] }[] };
      expect(stored.schema).toBe(1);
      expect(stored.sets.map((s) => [s.documentId, s.name, s.guides.map((g) => g.id)])).toEqual([[SAVE_DOC.id, setName, ids]]);
    }, { storage });

    // The restart: a second launch over the same storage, the session restored on the same document id.
    await withApp(async (app) => {
      await openStudio(app, [SAVE_DOC, OTHER_DOC]);
      expect(listedGuideIds(app), 'no run in this launch').toEqual([]);
      expect(saveOffered(app), 'nothing to save before a run').toBe(false);
      expect(savedSets(app).state).toBe('saved');
      expect(savedSetNames(app), 'listed again by name').toEqual([setName]);
    }, { storage });

    // Another document of the same session lists none of it.
    await withApp(async (app) => {
      await openStudio(app, [SAVE_DOC, OTHER_DOC], OTHER_DOC.id);
      expect(savedSetNames(app), 'no other document\'s sets').toEqual([]);
      expect(savedSets(app).state).toBe('none');
    }, { storage });
  });

  it('US-01M7DVFD AC6 an unparseable value at the guide-set key is reported as unreadable, never as no saved searches', async () => {
    const raw = '{"schema":1,"sets":[{"id":';
    const storage = memoryStorage({ [GUIDE_SET_KEY]: raw });
    await withApp(async (app) => {
      await openStudio(app, [SAVE_DOC]);
      const shown = savedSets(app);
      expect(shown.state).toBe('unreadable');
      expect(shown.text).toContain('cannot be read');
      expect(shown.text).not.toMatch(/No saved searches/i);
      expect(savedSetNames(app)).toEqual([]);
      // A completed run over it: Save refuses, says so, and keeps the stored value.
      await pressRun(app);
      expect(saveOffered(app)).toBe(true);
      await app.click(saveButtons(app)[0]);
      expect(words(app.one('[data-guide-set-save]', 'the save outcome').textContent)).toMatch(/^Nothing was saved: /);
      expect(storage.getItem(GUIDE_SET_KEY), 'the stored value byte for byte').toBe(raw);
      expect(savedSets(app).state).toBe('unreadable');
    }, { storage });
  });
});

/**
 * BG-01M7M602 AC1: what the tab hands the store beyond the name and the rows. A circular record and
 * an origin-crossing selection, so the interval's length and its crossesOrigin are both the less
 * likely value. Wrong implementations this kills (LC-002): the interval saved as null or rebuilt
 * without crossing the origin; the result cap written as a literal other than what the engine was
 * asked for; ranAt a fixed time, or taken when Save is pressed rather than when Run was.
 */
describe('a saved guide set records the interval, the result cap and the time of its run (BG-01M7M602)', () => {
  it('BG-01M7M602 AC1 a Save after an interval search over a selection stores the run\'s interval, the engine payload\'s maxResults and a ranAt from when Run was pressed', async () => {
    const storage = memoryStorage();
    const circle: SequenceDocument = { ...dnaDoc('pBG602_Circle', SAVE_DOC.sequence), topology: 'circular' };
    // 1301..400 across the origin of 1,500 bp: 200 bases before it and 400 after, the guide at 201 inside.
    const selected = { start: 1301, end: 400 };
    const payloads: Record<string, unknown>[] = [];
    await withApp(async (app) => {
      await app.restoreSession({
        documents: [circle],
        activeDocId: circle.id,
        viewerTab: 'primers-pcr',
        workspace: { selectedRange: { label: 'Selection', ...selected } },
      });
      await app.menu('primers:crispr');
      expect(app.one('select[aria-label="Search range:"]', 'the search-range chooser').value, 'the selection is the scope').toBe('interval');
      engine.asyncReply = async (payload, real) => {
        payloads.push(payload);
        return real('scan_crispr_guides', payload);
      };

      const t0 = Date.now();
      await pressRun(app);
      await app.settle();
      const tA = Date.now();
      expect(payloads, 'one scan_crispr_guides call').toHaveLength(1);
      const payload = payloads[0];
      expect([payload.start1Based, payload.end1Based], 'the selection is what the engine searched').toEqual([selected.start, selected.end]);
      expect(payload.maxResults, 'the cap the engine was asked for').toBe(25);
      expect(listedGuideIds(app).length, 'the run found the planted guide').toBeGreaterThan(0);
      expect(saveOffered(app)).toBe(true);
      // Date is real (mountApp fakes only setTimeout and setInterval): spin until the clock moves on.
      while (Date.now() <= tA) {
        /* spin */
      }
      const t1 = Date.now();
      await app.click(saveButtons(app)[0]);

      const stored = JSON.parse(storage.getItem(GUIDE_SET_KEY) ?? 'null') as {
        sets: { ranAt: string; criteria: { interval: unknown; resultCap: unknown } }[];
      };
      expect(stored.sets, 'one saved set').toHaveLength(1);
      const set = stored.sets[0];
      expect(set.criteria.interval, 'the run\'s interval, across the origin').toEqual({
        start: 1301,
        end: 400,
        lengthBp: 600,
        crossesOrigin: true,
      });
      expect(set.criteria.resultCap, 'the maxResults the engine was sent').toBe(payload.maxResults);
      const ranAt = Date.parse(set.ranAt);
      expect(Number.isNaN(ranAt), `ranAt ${set.ranAt} is a time`).toBe(false);
      expect(ranAt, 'ranAt is not before Run was pressed').toBeGreaterThanOrEqual(t0);
      expect(ranAt, 'ranAt is not after the reply settled').toBeLessThanOrEqual(tA);
      expect(tA, 'Save is pressed after the clock moved on').toBeLessThan(t1);
    }, { storage });
  });
});
