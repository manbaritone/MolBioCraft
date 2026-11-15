// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7GJ5R: the Restriction Enzymes window (US-01M7DVDV) is the caller of the custom enzyme
 * store's backup and failure paths (US-01M7DVMJ): Export, Import with its per-id choices, a refused
 * file, an unreadable store and a failed write.
 *
 * Every check runs in the real App over the live DOM (appHarness): the window is opened by the App's
 * own menu command, and the store is the page's own local storage, seeded and read back here
 * through src/core/enzymeDatabase.ts. The desktop save dialog is the one seam answered by the test.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ENZYME_BACKUP_FORMAT,
  ENZYME_DATABASE_KEY,
  ENZYME_DATABASE_SCHEMA,
  builtInNameClash,
  openEnzymeDatabase,
  type CustomEnzymeInput,
} from '../core/enzymeDatabase';
import type { CustomEnzymeDefinition } from '../types/bio';
import { macHost, mountApp, type AppHarness, type MountOptions } from './appHarness';
import { dispatchLiveEvent, LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 60_000 });

/** The desktop app's save dialog: the path written, null when the user cancels, or a failure. */
const nativeSave = vi.hoisted(() => ({
  answer: null as null | (() => Promise<string | null>),
  calls: [] as Array<{ filename: string; content: string }>,
}));
vi.mock('../lib/tauriIpc', async (importOriginal) => {
  const mocked = (await import('./appHarness')).tauriIpcMock(await importOriginal<object>());
  return {
    ...mocked,
    saveNativeFileDialogTauri: async (filename: string, content: string) => {
      nativeSave.calls.push({ filename, content });
      if (!nativeSave.answer) throw new Error('the test gave the native save dialog no answer');
      return nativeSave.answer();
    },
  };
});

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function withApp(storage: LiveStorage, run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  const app = await mountApp({ ...opts, storage });
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}
function win(app: AppHarness): LiveElement {
  const found = app.all('[role="dialog"][aria-labelledby="enzyme-db-title"]');
  if (found.length !== 1) throw new Error(`expected one Restriction Enzymes window, found ${found.length}`);
  return found[0];
}
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}: ${scope.querySelectorAll('button').map(nameOf).join(' | ')}`);
  return found[0];
}
const fileInput = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] input[type="file"]', 'the backup file input');
const noticeText = (app: AppHarness) =>
  win(app)
    .querySelectorAll('[role="status"], [role="alert"]')
    .map((n) => words(n.textContent))
    .join(' ');
const customNames = (app: AppHarness) =>
  win(app)
    .querySelectorAll('table[aria-label="Custom enzymes"] tbody tr')
    .map((tr) => words(tr.querySelectorAll('td')[0]?.textContent));
const openEnzymes = (app: AppHarness) => app.menu('tools:enzyme-database');

/** Chooses a file in the window's backup file input, as the browser hands it over. */
async function chooseFile(app: AppHarness, name: string, text: string): Promise<void> {
  const input = fileInput(app);
  (input as unknown as { files: unknown[] }).files = [{ name, text: async () => text }];
  await act(async () => {
    dispatchLiveEvent(input, 'change');
  });
  await app.settle();
}

// ─── The store ───

const OLD_TIME = '2026-01-01T00:00:00.000Z';
const MY_BSA: CustomEnzymeInput = { name: 'MyBsa', recognitionSeq: 'GGTCTC', cutFwd: 7, cutRev: 11, isTypeIIS: true, provenance: 'lab notebook 4', notes: 'n1' };
const ZED: CustomEnzymeInput = { name: 'Zed', recognitionSeq: 'ACGTNNACGT', cutFwd: 2, cutRev: 8 };
const YOX: CustomEnzymeInput = { name: 'Yox', recognitionSeq: 'GAATTCNN', cutFwd: 1, cutRev: 5 };

function seeded(inputs: CustomEnzymeInput[]): LiveStorage {
  const storage = memoryStorage();
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => OLD_TIME, newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
function stored(storage: LiveStorage): CustomEnzymeDefinition[] {
  const r = openEnzymeDatabase({ storage }).read();
  if (!r.ok) throw new Error(r.error.message);
  return r.definitions;
}
const rawStore = (storage: LiveStorage) => storage.getItem(ENZYME_DATABASE_KEY);
function backupOf(definitions: CustomEnzymeDefinition[]): string {
  return JSON.stringify({ format: ENZYME_BACKUP_FORMAT, schema: ENZYME_DATABASE_SCHEMA, exportedAt: OLD_TIME, definitions });
}

/** Makes every write of the store throw, as a full or blocked storage does; returns the undo. */
function refuseWrites(storage: LiveStorage): () => void {
  const realSet = storage.setItem;
  storage.setItem = (k: string, v: string) => {
    if (k === ENZYME_DATABASE_KEY) throw new Error('QuotaExceededError: the quota has been exceeded');
    realSet.call(storage, k, v);
  };
  return () => {
    storage.setItem = realSet;
  };
}

// ─── Export ───

describe('Export saves the versioned JSON file and says so only when the platform confirms it (US-01M7GJ5R AC1)', () => {
  it('US-01M7GJ5R AC1 on the desktop app Export says Exported only for a written file: a cancelled or failed save is not a success', async () => {
    const storage = seeded([MY_BSA, ZED]);
    const definitions = stored(storage);
    await withApp(
      storage,
      async (app) => {
        await openEnzymes(app);
        nativeSave.calls.length = 0;

        nativeSave.answer = async () => null;
        await app.click(button(win(app), 'Export Backup…'));
        expect(nativeSave.calls).toHaveLength(1);
        expect(nativeSave.calls[0].filename).toMatch(/^enzyme-database-\d{4}-\d{2}-\d{2}\.json$/);
        const backup = JSON.parse(nativeSave.calls[0].content);
        expect(backup.format).toBe(ENZYME_BACKUP_FORMAT);
        expect(backup.schema).toBe(ENZYME_DATABASE_SCHEMA);
        expect(backup.definitions).toEqual(definitions);
        expect(noticeText(app)).toContain('Export cancelled: no file was saved.');
        expect(noticeText(app)).not.toContain('Exported');

        nativeSave.answer = async () => '/Users/lab/enzymes.json';
        await app.click(button(win(app), 'Export Backup…'));
        expect(noticeText(app)).toBe('Exported the custom enzyme backup to /Users/lab/enzymes.json.');

        nativeSave.answer = async () => {
          throw new Error('[ERR_PERMISSION_DENIED] the folder is read-only');
        };
        await app.click(button(win(app), 'Export Backup…'));
        expect(noticeText(app)).toContain('Export failed: [ERR_PERMISSION_DENIED] the folder is read-only. No file was saved.');
        expect(noticeText(app)).not.toContain('Exported');
        expect(win(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ')).toContain('Export failed');
        expect(stored(storage)).toEqual(definitions);
      },
      macHost(),
    );
    nativeSave.answer = null;
  });

  it('US-01M7GJ5R AC1 in a browser Export hands the file to a download and never claims it was saved', async () => {
    const storage = seeded([MY_BSA]);
    await withApp(storage, async (app) => {
      await openEnzymes(app);
      const before = app.downloads().length;
      await app.click(button(win(app), 'Export Backup…'));
      const saved = app.downloads().slice(before);
      expect(saved).toHaveLength(1);
      expect(JSON.parse(await saved[0].text()).definitions).toEqual(stored(storage));
      expect(noticeText(app)).toContain('the browser does not say whether it was kept');
      expect(noticeText(app)).not.toContain('Exported');
    });
  });
});

// ─── Import ───

describe('Import adds the new ids and asks per id before replacing or naming a built-in (US-01M7GJ5R AC1)', () => {
  it('US-01M7GJ5R AC1 Import adds the new ids, lists each id that exists and differs, and replaces only the ids chosen', async () => {
    const source = stored(seeded([MY_BSA, ZED, YOX]));
    const [bsa, zed, yox] = source;
    const editedBsa: CustomEnzymeDefinition = { ...bsa, notes: 'edited here' };
    const editedZed: CustomEnzymeDefinition = { ...zed, notes: 'edited too' };
    const storage = memoryStorage({ [ENZYME_DATABASE_KEY]: JSON.stringify({ schema: 1, definitions: [editedBsa, editedZed] }) });
    await withApp(storage, async (app) => {
      await openEnzymes(app);
      await chooseFile(app, 'enzymes.json', backupOf(source));
      // The new id is added; both differing ids are kept as stored until chosen.
      expect(stored(storage)).toEqual([editedBsa, editedZed, yox]);
      expect(customNames(app)).toEqual(['MyBsa', 'Zed', 'Yox']);
      expect(noticeText(app)).toContain('Imported enzymes.json: 1 added, 0 replaced, 0 unchanged, 2 kept as stored, 0 held back as a built-in name.');
      const conflicts = app.one('[role="group"][aria-label="Backup conflicts"]');
      const ticks = conflicts.querySelectorAll('input[type="checkbox"]');
      expect(ticks.map((t) => t.getAttribute('aria-label'))).toEqual([
        `Replace stored MyBsa (${bsa.id}) with the backup's MyBsa`,
        `Replace stored Zed (${zed.id}) with the backup's Zed`,
      ]);
      expect(ticks.map((t) => (t as unknown as { checked: boolean }).checked)).toEqual([false, false]);
      // Choosing one id replaces that id and no other.
      await app.change(ticks[0], true);
      await app.click(button(win(app), 'Import Chosen'));
      expect(stored(storage)).toEqual([bsa, editedZed, yox]);
      expect(noticeText(app)).toContain('1 replaced');
      // The id not chosen is still listed, and keeping it ends the choice with nothing changed.
      const left = app.one('[role="group"][aria-label="Backup conflicts"]').querySelectorAll('input[type="checkbox"]');
      expect(left.map((t) => t.getAttribute('aria-label'))).toEqual([`Replace stored Zed (${zed.id}) with the backup's Zed`]);
      await app.click(button(win(app), 'Keep All as Stored'));
      expect(app.all('[role="group"][aria-label="Backup conflicts"]')).toHaveLength(0);
      expect(stored(storage)).toEqual([bsa, editedZed, yox]);
    });
  });

  it('US-01M7GJ5R AC1 an import entry with a built-in name and no recorded confirmation is shown as a clash and stored only once confirmed', async () => {
    const builtIn = builtInNameClash('EcoRI');
    expect(builtIn, 'the catalogue holds EcoRI').toBeDefined();
    const source = stored(seeded([MY_BSA, { ...ZED, name: builtIn! }]));
    const [bsa, clashing] = source;
    expect(clashing.sharesBuiltInName).toBe(builtIn);
    // The same definition as a backup that never recorded the user's confirmation.
    const { sharesBuiltInName: _confirmed, ...unconfirmed } = clashing;
    void _confirmed;
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await openEnzymes(app);
      await chooseFile(app, 'shared.json', backupOf([bsa, unconfirmed as CustomEnzymeDefinition]));
      expect(stored(storage)).toEqual([bsa]);
      expect(noticeText(app)).toContain('1 held back as a built-in name');
      const clashes = app.one('[role="group"][aria-label="Built-in name clashes"]');
      expect(words(clashes.textContent)).toContain(`${builtIn} (${clashing.id}) is the name of the built-in enzyme ${builtIn}`);
      const ticks = clashes.querySelectorAll('input[type="checkbox"]');
      expect(ticks.map((t) => t.getAttribute('aria-label'))).toEqual([`Import ${builtIn} (${clashing.id}) beside the built-in ${builtIn}`]);
      await app.change(ticks[0], true);
      await app.click(button(win(app), 'Import Chosen'));
      expect(stored(storage)).toEqual([bsa, clashing]);
      expect(app.all('[role="group"][aria-label="Built-in name clashes"]')).toHaveLength(0);
      expect(customNames(app)).toEqual(['MyBsa', builtIn]);
    });
  });

  it('US-01M7GJ5R AC1 a refused import file is named with its reason and changes nothing', async () => {
    const storage = seeded([MY_BSA]);
    const before = rawStore(storage);
    const [bsa] = stored(storage);
    const cases: Array<[string, string, string]> = [
      ['broken.json', '{"format":', 'it is not valid JSON'],
      ['primers.json', JSON.stringify({ format: 'molbiocraft-primer-database-backup', schema: 1, records: [] }), 'it is not a MolBioCraft enzyme database backup'],
      ['future.json', JSON.stringify({ format: ENZYME_BACKUP_FORMAT, schema: 9, definitions: [{ ...bsa, id: 'custom:new' }] }), 'schema 9'],
    ];
    await withApp(storage, async (app) => {
      await openEnzymes(app);
      for (const [file, text, reason] of cases) {
        await chooseFile(app, file, text);
        const alert = win(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert, file).toContain(`${file} was not imported`);
        expect(alert, file).toContain(reason);
        expect(alert, file).toContain('Nothing was changed.');
        expect(noticeText(app), file).not.toContain('Imported');
        expect(rawStore(storage), file).toBe(before);
        expect(customNames(app), file).toEqual(['MyBsa']);
      }
    });
  });
});

// ─── Unreadable store and failed writes ───

describe('An unreadable store is named, never empty, and a failed write says nothing was saved (US-01M7GJ5R AC1)', () => {
  it('US-01M7GJ5R AC1 an unreadable store is shown by name with an explicit discard choice, never as an empty list', async () => {
    for (const [value, kind] of [
      ['{"schema":1,"definitions":[', 'malformed'],
      ['{"schema":9,"definitions":[]}', 'futureSchema'],
    ]) {
      const storage = memoryStorage({ [ENZYME_DATABASE_KEY]: value });
      await withApp(storage, async (app) => {
        await openEnzymes(app);
        const w = win(app);
        const alert = w.querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert, kind).toContain(`(${kind})`);
        expect(alert, kind).toContain(ENZYME_DATABASE_KEY);
        expect(alert, kind).toContain('are not shown as empty');
        // No custom list and no "no custom enzyme yet": an unreadable store is not an empty one.
        expect(w.querySelectorAll('table[aria-label="Custom enzymes"]'), kind).toHaveLength(0);
        expect(words(w.textContent), kind).not.toContain('No custom enzyme yet');
        for (const name of ['Add custom enzyme', 'Export Backup…']) expect(button(w, name).hasAttribute('disabled'), name).toBe(true);
        expect(fileInput(app).hasAttribute('disabled')).toBe(true);
        // Discarding asks first, and keeping it writes nothing.
        await app.click(button(win(app), 'Discard Unreadable Store…'));
        expect(rawStore(storage), kind).toBe(value);
        await app.click(button(win(app), 'Keep It'));
        expect(rawStore(storage), kind).toBe(value);
        await app.click(button(win(app), 'Discard Unreadable Store…'));
        await app.click(button(win(app), 'Discard and Start Empty'));
        expect(JSON.parse(rawStore(storage)!), kind).toEqual({ schema: 1, definitions: [] });
        expect(noticeText(app), kind).toContain('Discarded the unreadable custom enzyme store; it is now empty.');
        expect(words(win(app).textContent), kind).toContain('No custom enzyme yet');
      });
    }
  });

  it('US-01M7GJ5R AC1 the unreadable data can be saved first, and the save says cancelled or saved as the platform reports', async () => {
    const value = '{"schema":1,"definitions":[';
    const storage = memoryStorage({ [ENZYME_DATABASE_KEY]: value });
    await withApp(
      storage,
      async (app) => {
        await openEnzymes(app);
        nativeSave.calls.length = 0;
        nativeSave.answer = async () => null;
        await app.click(button(win(app), 'Save Unreadable Data…'));
        expect(nativeSave.calls.map((c) => c.content)).toEqual([value]);
        expect(noticeText(app)).toContain('Copy of the unreadable data cancelled: no file was saved.');
        nativeSave.answer = async () => '/Users/lab/unreadable.json';
        await app.click(button(win(app), 'Save Unreadable Data…'));
        expect(noticeText(app)).toContain('Copy of the unreadable data saved to /Users/lab/unreadable.json.');
        expect(rawStore(storage)).toBe(value);
      },
      macHost(),
    );
    nativeSave.answer = null;
  });

  it('US-01M7GJ5R AC1 a failed write says nothing was saved: an import, an add and a discard leave the store as it was', async () => {
    const storage = seeded([MY_BSA]);
    const before = rawStore(storage);
    const extra = stored(seeded([ZED, YOX]));
    await withApp(storage, async (app) => {
      await openEnzymes(app);
      const restore = refuseWrites(storage);
      try {
        await chooseFile(app, 'more.json', backupOf(extra));
        let alert = win(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert).toContain('Nothing was saved');
        expect(noticeText(app)).not.toContain('Imported');
        expect(rawStore(storage)).toBe(before);
        expect(customNames(app)).toEqual(['MyBsa']);

        await app.click(button(win(app), 'Add custom enzyme'));
        const form = app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] form');
        const typed: Array<[string, string]> = [
          ['Name', 'Qux'],
          ["Recognition motif (5' → 3')", 'GGATCC'],
          ['Top-strand cut (bases from the motif start)', '1'],
          ['Bottom-strand cut (bases from the motif start)', '5'],
        ];
        for (const [label, value] of typed) await app.input(form.querySelectorAll('input').find((f) => f.getAttribute('aria-label') === label)!, value);
        await app.click(button(form, 'Save Enzyme'));
        alert = win(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert).toContain('Nothing was saved');
        expect(noticeText(app)).not.toContain('Saved Qux');
        expect(rawStore(storage)).toBe(before);
      } finally {
        restore();
      }
    });

    const value = '{"schema":1,"definitions":[';
    const unreadable = memoryStorage({ [ENZYME_DATABASE_KEY]: value });
    await withApp(unreadable, async (app) => {
      await openEnzymes(app);
      const restore = refuseWrites(unreadable);
      try {
        await app.click(button(win(app), 'Discard Unreadable Store…'));
        await app.click(button(win(app), 'Discard and Start Empty'));
        const alert = win(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert).toContain('Nothing was saved');
        expect(noticeText(app)).not.toContain('Discarded');
        expect(rawStore(unreadable)).toBe(value);
        expect(win(app).querySelectorAll('table[aria-label="Custom enzymes"]')).toHaveLength(0);
        expect(alert).toContain('(malformed)');
      } finally {
        restore();
      }
    });
  });
});
