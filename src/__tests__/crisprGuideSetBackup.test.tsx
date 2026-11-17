// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7M67J: the saved CRISPR guide sets (US-01M7DVFD, US-01M7DVDF) are exported and imported as
 * a versioned backup from the CRISPR tab, and what this version cannot read is refused by name.
 *
 * Everything runs through the real App (LC-003): the CRISPR sub-tab's Export button and Import file
 * input, its outcome line and its saved-sets lists. The sets the App starts with are written to its
 * storage by the real store over real scans, and the export is the file the App hands the browser
 * (`app.downloads()`); a backup file is chosen in the input as the browser hands it over.
 *
 * Wrong implementations these kill (LC-002):
 * - AC1: Export offered over an empty or unreadable store, or the empty sentence said over an
 *   unreadable one; an export of this document's sets only (the not-open set is missing); sets
 *   rebuilt in another key order (the bytes differ); a name without the date or a wrapper without the
 *   format, schema or export time.
 * - AC2: a differing id replaced by the file's set; an identical id counted as added (or written
 *   twice); the kept ids not named; the lists read before the write (the added sets not shown); the
 *   document written.
 * - AC3: a file not JSON, of another format, with an unknown top-level key, a newer schema or an
 *   unreadable set imported, or partly imported; an import over an unreadable store; a refused or
 *   unkept write reported as imported; a stored envelope with an unknown key read as no saved
 *   searches, or written over by an import or a save.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { crisprNucleasePresets, scanCrisprGuides, type CrisprScanReport, type CrisprScanResult } from '../core/bioEngine';
import { openGuideSetDatabase, type GuideSet } from '../core/guideSetDatabase';
import { sequenceRevision } from '../core/restrictionDisplay';
import { act } from 'react';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, memoryStorage, type LiveStorage } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) =>
  (await import('./appHarness')).tauriIpcMock(await importOriginal<object>())
);

// Each mount launches the App afresh, with the real WASM engine behind it.
vi.setConfig({ testTimeout: 120_000 });

const KEY = 'molbiocraft.crisprGuideSets';
const FORMAT = 'molbiocraft-crispr-guide-set-backup';
const SPCAS9 = 'SpCas9 (NGG)';

// ─── Documents ───

/** Bases with no G and no CC: no SpCas9 PAM on either strand. */
const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);
const plant = (seq: string, at: number, bases: string) => seq.slice(0, at - 1) + bases + seq.slice(at - 1 + bases.length);
const dnaDoc = (id: string, sequence: string): SequenceDocument => ({
  id, name: `${id} plasmid`, accession: '', description: '', sequence, moleculeType: 'DNA', topology: 'linear',
  folder: 'Local', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [{ id: 'f-ori', name: 'ori', type: 'rep_origin', start: 1001, end: 1100, strand: 1, color: '#4363d8' }],
  primers: [{
    id: 'p1', name: 'fwd', sequence: 'ATCATACTAATCTAAC', annealSequence: 'ATCATACTAATCTAAC', tail5Prime: '', bindStart: 1, bindEnd: 16,
    strand: 1, length: 16, gcPercent: 18.8, tmAnnealC: 40, tmFullC: 40, deltaG37: -10, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: false,
  }],
  history: [],
});
const LAB = dnaDoc('pBKP_Lab', plant(plant(filler(1200), 201, 'ACGTACTGATCAGTCATGCAAGG'), 701, 'TACGTCATAGTCAGTACTCATGG'));
/** A document never opened in these tests: its sets are listed apart, and exported with the rest. */
const AWAY = { id: 'pBKP_Away', name: 'pBKP_Away plasmid', sequence: plant(filler(600), 101, 'GACGTTACCGATTGCAATCGTGG') };

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ─── Sets, written by the real store over real scans ───

interface Seed {
  id: string;
  name: string;
  doc: { id: string; name: string; sequence: string };
}

/** The sets as the real store writes them for these seeds, in a storage of their own. */
function setsFor(seeds: Seed[]): GuideSet[] {
  const storage = memoryStorage();
  let next = 0;
  const db = openGuideSetDatabase({ storage, now: () => '2026-11-01T00:00:00.000Z', newId: () => seeds[next++].id, engineVersion: () => 'engine 1' });
  const preset = crisprNucleasePresets().find((p) => p.id === SPCAS9)!;
  for (const s of seeds) {
    const r = scanCrisprGuides(s.doc.sequence, SPCAS9, 25, false, null);
    if (!r.report) throw new Error(`no scan report: ${r.reportUnavailableReason}`);
    const result = r as CrisprScanResult & { report: CrisprScanReport };
    const saved = db.save(
      {
        name: s.name,
        ranAt: '2026-10-31T12:00:00.000Z',
        criteria: { nuclease: preset, topology: 'linear', interval: null, resultCap: 25 },
        report: result.report,
        guides: result.guides,
        scoreNames: { onTargetScore: 'Rank', specificityScore: 'Seeds', offTargetCount: 'Seeds' },
        heuristicRule: 'A rule.',
      },
      { id: s.doc.id, name: s.doc.name, revision: sequenceRevision(s.doc.sequence, 'linear') }
    );
    if (!saved.ok) throw new Error(saved.error.message);
  }
  return (JSON.parse(storage.getItem(KEY)!) as { sets: GuideSet[] }).sets;
}

const [SET_A, SET_B, SET_C, SET_D] = setsFor([
  { id: 'set-a', name: 'Exon 1', doc: LAB },
  { id: 'set-b', name: 'Exon 2', doc: LAB },
  { id: 'set-c', name: 'Exon 3, from the other machine', doc: LAB },
  { id: 'set-d', name: 'Away search', doc: AWAY },
]);
const envelopeOf = (sets: GuideSet[]) => JSON.stringify({ schema: 1, sets });
const backupOf = (sets: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: FORMAT, schema: 1, exportedAt: '2026-11-02T00:00:00.000Z', sets, ...extra });
function storeOf(raw: string | null): LiveStorage {
  const storage = memoryStorage();
  if (raw !== null) storage.setItem(KEY, raw);
  return storage;
}

// ─── The App ───

async function withLab(storage: LiveStorage, run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: [LAB], activeDocId: LAB.id, viewerTab: 'primers-pcr' });
    await app.menu('primers:crispr');
    await run(app);
  } finally {
    app.unmount();
  }
}

const exportButtons = (app: AppHarness) => app.all('[data-guide-set-export]');
const appText = (app: AppHarness) => words(app.container.textContent);
const notice = (app: AppHarness) => words(app.one('[data-guide-set-outcome]', 'the guide-set outcome').textContent);
const noticeState = (app: AppHarness) => app.one('[data-guide-set-outcome]').getAttribute('data-guide-set-outcome');
const listState = (app: AppHarness) => app.one('[data-guide-sets]').getAttribute('data-guide-sets');
const listText = (app: AppHarness) => words(app.one('[data-guide-sets]').textContent);
const listedIds = (app: AppHarness) => app.all('[data-guide-sets] [data-guide-set]').map((e) => e.getAttribute('data-guide-set'));
const elsewhereIds = (app: AppHarness) => app.all('[data-guide-sets-elsewhere] [data-guide-set-elsewhere]').map((e) => e.getAttribute('data-guide-set-elsewhere'));

/** Chooses a file in the tab's Import input, as the browser hands it over. */
async function chooseFile(app: AppHarness, name: string, text: string): Promise<void> {
  const input = app.one('input[type="file"][data-guide-set-import]', 'the Import guide sets input');
  (input as unknown as { files: unknown[] }).files = [{ name, text: async () => text }];
  await act(async () => {
    dispatchLiveEvent(input, 'change');
  });
  await app.settle();
}

/** The active document as File > Save Session writes it: its bases, features and primers. */
async function savedDocument(app: AppHarness) {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; sequence: string; features: unknown[]; primers: unknown[] }[];
  };
  const doc = payload.documents.find((d) => d.id === LAB.id)!;
  return { sequence: doc.sequence, features: doc.features, primers: doc.primers };
}

/** Every way the store can fail to read, each named in the saved-sets list. */
const UNREADABLE: { label: string; raw: string; why: string }[] = [
  { label: 'not JSON', raw: '{"schema":1,"sets":[', why: 'it is not valid JSON' },
  { label: 'empty', raw: '', why: 'it holds an empty value' },
  { label: 'newer schema', raw: JSON.stringify({ schema: 2, sets: [] }), why: 'it was written with schema 2' },
  { label: 'unknown key', raw: JSON.stringify({ schema: 1, sets: [], pinned: ['set-a'] }), why: 'it has a top-level key this version does not know: pinned' },
];

// ─── AC1 ───

describe('US-01M7M67J AC1: Export saves every saved set as the versioned backup', () => {
  it('US-01M7M67J AC1 exports every stored set byte for byte, the not-open one included, as crispr-guide-sets-<date>.json', async () => {
    const raw = envelopeOf([SET_A, SET_D, SET_B]);
    const storage = storeOf(raw);
    await withLab(storage, async (app) => {
      expect(listedIds(app)).toEqual(['set-a', 'set-b']);
      expect(elsewhereIds(app)).toEqual(['set-d']);
      expect(appText(app)).not.toContain('No saved guide sets to export.');
      expect(exportButtons(app)).toHaveLength(1);
      const before = app.downloads().length;
      const day = new Date().toISOString().slice(0, 10);
      await app.click(exportButtons(app)[0]);
      await app.settle();
      const files = app.downloads();
      expect(files.length, 'one file saved').toBe(before + 1);
      const file = files[files.length - 1];
      expect(file.filename).toBe(`crispr-guide-sets-${day}.json`);
      const text = await file.text();
      const backup = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(backup)).toEqual(['format', 'schema', 'exportedAt', 'sets']);
      expect(backup.format).toBe(FORMAT);
      expect(backup.schema).toBe(1);
      expect(typeof backup.exportedAt === 'string' && !Number.isNaN(Date.parse(backup.exportedAt))).toBe(true);
      // The stored sets, in their stored order and bytes, the not-open one among them.
      const storedSets = raw.slice(raw.indexOf('"sets":') + '"sets":'.length, -1);
      expect(text).toBe(`{"format":"${FORMAT}","schema":1,"exportedAt":${JSON.stringify(backup.exportedAt)},"sets":${storedSets}}`);
      expect((backup.sets as GuideSet[]).map((s) => s.id)).toEqual(['set-a', 'set-d', 'set-b']);
      expect(notice(app)).toBe(`Export: handed to your browser to download as crispr-guide-sets-${day}.json; the browser does not say whether it was kept.`);
      expect(storage.getItem(KEY), 'export writes nothing').toBe(raw);
    });
  });

  it('US-01M7M67J AC1 a store holding only a set of a document not open offers Export, and an empty store says there is nothing to export', async () => {
    await withLab(storeOf(envelopeOf([SET_D])), async (app) => {
      expect(listState(app)).toBe('none');
      expect(exportButtons(app), 'the not-open set is exported').toHaveLength(1);
      expect(appText(app)).not.toContain('No saved guide sets to export.');
    });
    for (const raw of [null, envelopeOf([])]) {
      await withLab(storeOf(raw), async (app) => {
        expect(exportButtons(app), `${raw}: no Export`).toHaveLength(0);
        expect(words(app.one('[data-guide-set-export-none]').textContent)).toBe('No saved guide sets to export.');
      });
    }
  });

  it('US-01M7M67J AC1 a store that cannot be read offers no Export, never says there is nothing to export, and its list names why', async () => {
    const cases = [...UNREADABLE, { label: 'unavailable', raw: 'UNAVAILABLE', why: 'storage is unavailable' }];
    for (const c of cases) {
      const storage = storeOf(c.raw === 'UNAVAILABLE' ? null : c.raw);
      if (c.raw === 'UNAVAILABLE') {
        const getItem = storage.getItem.bind(storage);
        storage.getItem = (k: string) => {
          if (k === KEY) throw new DOMException('The operation is insecure.', 'SecurityError');
          return getItem(k);
        };
      }
      await withLab(storage, async (app) => {
        expect(exportButtons(app), `${c.label}: no Export`).toHaveLength(0);
        expect(app.all('[data-guide-set-export-none]'), c.label).toHaveLength(0);
        expect(appText(app), c.label).not.toContain('No saved guide sets to export.');
        expect(listState(app), c.label).toBe('unreadable');
        expect(listText(app), c.label).toContain(c.why);
        expect(listText(app), c.label).not.toContain('No saved searches');
      });
    }
  });
});

// ─── AC2 ───

describe('US-01M7M67J AC2: Import adds the new ids, and leaves the others as stored', () => {
  it('US-01M7M67J AC2 adds each new id byte for byte, leaves an identical id, keeps a differing id as stored, lists the added sets at once and leaves the document', async () => {
    const raw = envelopeOf([SET_A, SET_B]);
    const storage = storeOf(raw);
    const differingB = { ...SET_B, name: 'Exon 2, renamed on the other machine' };
    await withLab(storage, async (app) => {
      const doc0 = await savedDocument(app);
      expect(listedIds(app)).toEqual(['set-a', 'set-b']);
      expect(elsewhereIds(app)).toEqual([]);

      await chooseFile(app, 'lab-backup.json', backupOf([SET_A, differingB, SET_C, SET_D]));
      expect(notice(app)).toBe('Imported lab-backup.json: 2 added, 1 unchanged, 1 kept as stored (set-b).');
      expect(noticeState(app)).toBe('done');
      expect(storage.getItem(KEY), 'the added sets appended as the file holds them; A and B as stored').toBe(envelopeOf([SET_A, SET_B, SET_C, SET_D]));
      expect(listedIds(app), 'the added set of this document listed at once').toEqual(['set-a', 'set-b', 'set-c']);
      expect(elsewhereIds(app), 'the added set of a document not open listed at once').toEqual(['set-d']);
      expect(words(app.all('[data-guide-set-name]').map((e) => e.textContent).join('|'))).toBe('Exon 1|Exon 2|Exon 3, from the other machine');

      // A file with nothing new writes nothing, and names no kept id when none is kept.
      const after = storage.getItem(KEY);
      await chooseFile(app, 'again.json', backupOf([SET_A, SET_C]));
      expect(notice(app)).toBe('Imported again.json: 0 added, 2 unchanged, 0 kept as stored.');
      expect(storage.getItem(KEY)).toBe(after);

      expect(await savedDocument(app), 'the bases, features and primers are unchanged').toEqual(doc0);
      expect(doc0.sequence).toBe(LAB.sequence);
      expect(doc0.features).toHaveLength(1);
      expect(doc0.primers).toHaveLength(1);
    });
  });

  it('US-01M7M67J AC2 an import into a store with no value adds every set, and the export reads it back', async () => {
    const storage = storeOf(null);
    await withLab(storage, async (app) => {
      await chooseFile(app, 'first.json', backupOf([SET_D, SET_A]));
      expect(notice(app)).toBe('Imported first.json: 2 added, 0 unchanged, 0 kept as stored.');
      expect(storage.getItem(KEY)).toBe(envelopeOf([SET_D, SET_A]));
      expect(listedIds(app)).toEqual(['set-a']);
      expect(elsewhereIds(app)).toEqual(['set-d']);
      expect(exportButtons(app), 'Export offered once a set is saved').toHaveLength(1);
    });
  });
});

// ─── AC3 ───

describe('US-01M7M67J AC3: Import refuses what this version cannot read, and nothing is changed', () => {
  it('US-01M7M67J AC3 a file not JSON, of another format, with an unknown key, a newer schema or a set that cannot be read is refused by name', async () => {
    const raw = envelopeOf([SET_A]);
    const storage = storeOf(raw);
    const { name: _dropped, ...noName } = SET_C;
    const files: [string, string, string][] = [
      ['notes.json', 'not json {', 'it is not valid JSON'],
      ['enzymes.json', JSON.stringify({ format: 'molbiocraft-enzyme-database-backup', schema: 1, exportedAt: 'x', definitions: [] }), 'it is not a MolBioCraft CRISPR guide set backup'],
      ['bare.json', envelopeOf([SET_C]), 'it is not a MolBioCraft CRISPR guide set backup'],
      ['list.json', JSON.stringify([SET_C]), 'it is not a MolBioCraft CRISPR guide set backup'],
      ['keyed.json', backupOf([SET_C], { comment: 'from the bench' }), 'it has a top-level key this version does not know: comment'],
      ['newer.json', backupOf([SET_C], { schema: 2 }), 'it was written with schema 2, newer than the schema 1 this version of MolBioCraft reads'],
      ['newer-keyed.json', backupOf([SET_C], { schema: 2, comment: 'x' }), 'it was written with schema 2, newer than the schema 1 this version of MolBioCraft reads'],
      ['noschema.json', JSON.stringify({ format: FORMAT, exportedAt: 'x', sets: [SET_C] }), 'it carries no schema version'],
      ['nosets.json', JSON.stringify({ format: FORMAT, schema: 1, exportedAt: 'x' }), 'it holds no list of guide sets'],
      ['broken.json', backupOf([SET_C, noName]), 'set 2 cannot be read: it has no name'],
      ['twice.json', backupOf([SET_C, SET_C]), 'the id set-c appears twice'],
    ];
    await withLab(storage, async (app) => {
      for (const [file, text, why] of files) {
        await chooseFile(app, file, text);
        expect(notice(app), file).toBe(`${file} was not imported: ${why}. Nothing was changed.`);
        expect(noticeState(app), file).toBe('refused');
        expect(storage.getItem(KEY), `${file}: the stored bytes`).toBe(raw);
        expect(listedIds(app), file).toEqual(['set-a']);
      }
    });
  });

  it('US-01M7M67J AC3 an import over a store that cannot be read is refused, naming why, and the stored bytes are kept', async () => {
    for (const c of UNREADABLE) {
      const storage = storeOf(c.raw);
      await withLab(storage, async (app) => {
        await chooseFile(app, 'good.json', backupOf([SET_C]));
        expect(notice(app), c.label).toMatch(new RegExp(`^good\\.json was not imported: the saved guide sets \\(${KEY.replace('.', '\\.')}\\) cannot be read: .*Nothing was changed\\.$`));
        expect(notice(app), c.label).toContain(c.why);
        expect(appText(app), c.label).not.toContain('Imported good.json');
        expect(storage.getItem(KEY), `${c.label}: the stored bytes`).toBe(c.raw);
        expect(listState(app), c.label).toBe('unreadable');
      });
    }
  });

  it('US-01M7M67J AC3 a stored envelope with an unknown top-level key is named, never no saved searches, and a save over it keeps its bytes', async () => {
    const raw = JSON.stringify({ schema: 1, sets: [SET_A], pinned: ['set-a'] });
    const storage = storeOf(raw);
    await withLab(storage, async (app) => {
      expect(listState(app)).toBe('unreadable');
      expect(listText(app)).toContain('it has a top-level key this version does not know: pinned');
      expect(listText(app)).not.toContain('No saved searches');
      expect(listedIds(app), 'its set is not listed as if the store read').toEqual([]);
      await app.click(app.one('[data-crispr-run]', 'the Run button'));
      await app.settle();
      await app.click(app.one('[data-crispr-save-set]', 'the Save button'));
      await app.settle();
      expect(app.one('[data-guide-set-save]').getAttribute('data-guide-set-save')).toBe('refused');
      expect(words(app.one('[data-guide-set-save]').textContent)).toContain('pinned');
      expect(storage.getItem(KEY), 'Save kept the stored bytes').toBe(raw);
    });
  });

  it('US-01M7M67J AC3 a write the storage refuses or does not keep is refused, never reported as imported', async () => {
    const raw = envelopeOf([SET_A]);
    for (const how of ['refuses', 'drops'] as const) {
      const storage = storeOf(raw);
      await withLab(storage, async (app) => {
        const setItem = storage.setItem.bind(storage);
        storage.setItem = (k: string, v: string) => {
          if (k !== KEY) return setItem(k, v);
          if (how === 'refuses') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        };
        await chooseFile(app, 'good.json', backupOf([SET_C]));
        expect(notice(app), how).toMatch(
          how === 'refuses'
            ? /^good\.json was not imported: the storage refused the write \(QuotaExceededError.*\)\. Nothing was changed\.$/
            : /^good\.json was not imported: the storage did not keep the change\. Nothing was changed\.$/
        );
        expect(noticeState(app), how).toBe('refused');
        expect(appText(app), how).not.toContain('Imported good.json');
        storage.setItem = setItem;
        expect(storage.getItem(KEY), `${how}: the stored bytes`).toBe(raw);
        expect(listedIds(app), `${how}: the set is not listed`).toEqual(['set-a']);
      });
    }
  });
});

// ─── AC3, round 2: a set the tab could not render is refused on import ───

describe('US-01M7M67J AC3: an imported set is read field for field, as the tab renders it', () => {
  /**
   * Wrong implementations these kill (LC-002): an import checked with the store's shallow reader, so
   * a row with only an id, a row missing cutPosition, a non-finite or string number, a strand that
   * is not 1 or -1, an optional field of the wrong type, a report missing a field, criteria or score
   * names that cannot be shown, an empty or multi-line name, or a file with no export time is
   * written, and Show rows then crashes the studio; and a refusal that names neither the set nor the
   * field.
   */
  const rowsShown = (app: AppHarness, id: string) => app.all(`[data-guide-set-rows="${id}"] [data-guide-set-row]`).map((r) => r.getAttribute('data-guide-set-row'));
  const crafted = (patch: (set: Record<string, unknown>) => void) => {
    const set = JSON.parse(JSON.stringify({ ...SET_C, id: 'set-x' })) as Record<string, unknown>;
    patch(set);
    return backupOf([SET_A, set]);
  };
  const row = (set: Record<string, unknown>) => (set.guides as Record<string, unknown>[])[0];
  const report = (set: Record<string, unknown>) => set.report as Record<string, unknown>;
  const criteria = (set: Record<string, unknown>) => set.criteria as Record<string, unknown>;

  it('US-01M7M67J AC3 a set whose rows, report, criteria, score names or name cannot be read is refused naming the set and the field, and Show rows still works', async () => {
    const raw = envelopeOf([SET_A]);
    const storage = storeOf(raw);
    const firstRow = SET_C.guides[0].id;
    expect(SET_C.guides.length, 'the fixture set has rows').toBeGreaterThan(0);
    const files: [string, string, string][] = [
      ['crafted.json', crafted((s) => { s.guides = [{ id: 'g1' }]; }), 'set 2 (set-x) cannot be read: guide row 1 (g1) has no readable name'],
      ['nocut.json', crafted((s) => { delete row(s).cutPosition; }), `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable cutPosition`],
      ['textcut.json', crafted((s) => { row(s).cutPosition = '12'; }), `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable cutPosition`],
      ['strand.json', crafted((s) => { row(s).strand = 2; }), `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable strand`],
      ['optional.json', crafted((s) => { row(s).cutPositionTargetStrandNote = 7; }), `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable cutPositionTargetStrandNote`],
      ['interval.json', crafted((s) => { row(s).searchedInterval = { start: 1 }; }), `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable searchedInterval`],
      ['report.json', crafted((s) => { delete report(s).scannedLengthBp; }), 'set 2 (set-x) cannot be read: its scan report has no readable scannedLengthBp'],
      ['warnings.json', crafted((s) => { report(s).warnings = [1]; }), 'set 2 (set-x) cannot be read: its scan report has no readable warnings'],
      ['circular.json', crafted((s) => { report(s).scannedCircular = 'no'; }), 'set 2 (set-x) cannot be read: its scan report has no readable scannedCircular'],
      ['preset.json', crafted((s) => { delete (criteria(s).nuclease as Record<string, unknown>).spacerLengthBp; }), 'set 2 (set-x) cannot be read: its criteria have no readable nuclease'],
      ['range.json', crafted((s) => { criteria(s).interval = { start: 1, end: 'x' }; }), 'set 2 (set-x) cannot be read: its criteria have no readable interval'],
      ['topology.json', crafted((s) => { criteria(s).topology = 'round'; }), 'set 2 (set-x) cannot be read: its criteria have no readable topology'],
      ['scores.json', crafted((s) => { (s.scoreNames as Record<string, unknown>).onTargetScore = 3; }), 'set 2 (set-x) cannot be read: its score names have no readable onTargetScore'],
      ['noname.json', crafted((s) => { s.name = '   '; }), 'set 2 (set-x) cannot be read: it has no one-line name'],
      ['twolines.json', crafted((s) => { s.name = 'two\nlines'; }), 'set 2 (set-x) cannot be read: it has no one-line name'],
      ['noexport.json', JSON.stringify({ format: FORMAT, schema: 1, sets: [SET_C] }), 'it carries no export time'],
      ['numexport.json', JSON.stringify({ format: FORMAT, schema: 1, exportedAt: 1731800000, sets: [SET_C] }), 'it carries no export time'],
      ['badexport.json', JSON.stringify({ format: FORMAT, schema: 1, exportedAt: 'last Tuesday', sets: [SET_C] }), 'it carries no export time'],
    ];
    // A row of set-x with a number JSON reads as Infinity.
    const whole = crafted(() => undefined);
    const at = whole.indexOf('"id":"set-x"');
    const infinite = whole.slice(0, at) + whole.slice(at).replace(/"cutPosition":\d+/, '"cutPosition":1e999');
    files.push(['infinite.json', infinite, `set 2 (set-x) cannot be read: guide row 1 (${firstRow}) has no readable cutPosition`]);
    await withLab(storage, async (app) => {
      for (const [file, text, why] of files) {
        await chooseFile(app, file, text);
        expect(notice(app), file).toBe(`${file} was not imported: ${why}. Nothing was changed.`);
        expect(storage.getItem(KEY), `${file}: the stored bytes`).toBe(raw);
        expect(listedIds(app), file).toEqual(['set-a']);
      }
      // The studio still renders a stored set's rows.
      await app.click(app.one('[data-guide-set-show-rows="set-a"]', 'Show rows of set-a'));
      await app.settle();
      expect(rowsShown(app, 'set-a')).toEqual(SET_A.guides.map((g) => g.id));
    });
  });

  it('US-01M7M67J AC3 the sets the engine writes import whole, their rows shown, and an identical set with its keys in another order or pretty-printed reads unchanged', async () => {
    const reorder = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
    const storage = storeOf(envelopeOf([SET_A]));
    await withLab(storage, async (app) => {
      await chooseFile(app, 'reordered.json', backupOf([reorder(SET_A)]));
      expect(notice(app)).toBe('Imported reordered.json: 0 added, 1 unchanged, 0 kept as stored.');
      await chooseFile(app, 'pretty.json', JSON.stringify(JSON.parse(backupOf([SET_A])), null, 2));
      expect(notice(app)).toBe('Imported pretty.json: 0 added, 1 unchanged, 0 kept as stored.');
      expect(storage.getItem(KEY)).toBe(envelopeOf([SET_A]));
      await chooseFile(app, 'more.json', backupOf([SET_A, SET_C]));
      expect(notice(app)).toBe('Imported more.json: 1 added, 1 unchanged, 0 kept as stored.');
      await app.click(app.one('[data-guide-set-show-rows="set-c"]', 'Show rows of set-c'));
      await app.settle();
      expect(rowsShown(app, 'set-c')).toEqual(SET_C.guides.map((g) => g.id));
    });
  });
});
