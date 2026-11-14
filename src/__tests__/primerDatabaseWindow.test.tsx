// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DQFS: Databases > Primers, the window over the Primer Database (US-01M7DQVT's store),
 * and Save to Primer Database in Primer & PCR Studio.
 *
 * Every check runs in the real App over the live DOM (appHarness): the window is opened from the
 * App's own menus (the in-window menu bar, and the native menu's command through the App's
 * dispatcher), and the store is the page's own local storage, seeded and read back here through
 * src/core/primerDatabase.ts.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PRIMER_BACKUP_FORMAT,
  PRIMER_DATABASE_KEY,
  openPrimerDatabase,
  type DatabasePrimerInput,
} from '../core/primerDatabase';
import { buildNativeMenuState, resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { duplicateMatchFor } from '../components/PrimerDatabaseWindow';
import type { DatabasePrimer, PrimerRecord, SequenceDocument } from '../types/bio';
import { macHost, mountApp, type AppHarness, type MountOptions } from './appHarness';
import { dispatchLiveEvent, LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 60_000 });

/**
 * The desktop app's save dialog (cmd_native_save_file_dialog through saveNativeFileDialogTauri),
 * answered by each test: the path written, null when the user cancels, or a failure. The rest of
 * src/lib/tauriIpc is the harness's mock: the Tauri runtime is present only on a macOS host.
 */
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

const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
};

async function withApp(storage: LiveStorage, run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  const app = await mountApp({ ...opts, storage });
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

/** The one Primer Database window in the page, or null. */
function primerWindow(app: AppHarness): LiveElement | null {
  const found = app.all('[role="dialog"][aria-labelledby="primer-db-title"]');
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] ?? null;
}
function openWindow(app: AppHarness): LiveElement {
  const w = primerWindow(app);
  if (!w) throw new Error('the Primer Database window is not open');
  return w;
}
/** The one button in `scope` whose accessible name is `name`. */
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}: ${scope.querySelectorAll('button').map(nameOf).join(' | ')}`);
  return found[0];
}
function field(scope: LiveElement, label: string): LiveElement {
  const found = scope.querySelectorAll('input, select').filter((f) => f.getAttribute('aria-label') === label);
  if (found.length !== 1) throw new Error(`expected one field labelled "${label}", found ${found.length}`);
  return found[0];
}
/** The table rows the window lists, as their cells' text. */
function listedRows(app: AppHarness): string[][] {
  return openWindow(app)
    .querySelectorAll('tbody tr')
    .map((tr) => tr.querySelectorAll('td').map((td) => words(td.textContent)));
}
const listedNames = (app: AppHarness) => listedRows(app).map((r) => r[0]);

/** Opens a menu path in the in-window menu bar by clicking each item, as a user does. */
async function clickMenuPath(app: AppHarness, path: string[]): Promise<LiveElement> {
  const [top, ...rest] = path;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => nameOf(b) === top || words(b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  for (const label of rest) {
    const popups = app.all('.desktop-menu-popup');
    const item = popups
      .flatMap((p) => p.querySelectorAll('button'))
      .find((b) => words(b.textContent).startsWith(label) && words(b.textContent).replace(label, '').trim().length < 3);
    if (!item) throw new Error(`no "${label}" in the open menu: ${popups.flatMap((p) => p.querySelectorAll('button')).map((b) => words(b.textContent)).join(' | ')}`);
    await app.click(item);
  }
  return trigger;
}
/** The labels of the submenu a path opens (the last popup). */
async function submenuLabels(app: AppHarness, path: string[]): Promise<string[]> {
  await clickMenuPath(app, path);
  const popups = app.all('.desktop-menu-popup');
  return popups[popups.length - 1].querySelectorAll('button').map((b) => words(b.textContent));
}

// ─── The store, seeded and read through US-01M7DQVT's module ───

function seededStorage(inputs: DatabasePrimerInput[], trash: string[] = []): { storage: LiveStorage; records: DatabasePrimer[] } {
  const storage = memoryStorage();
  let tick = 0;
  let n = 0;
  const db = openPrimerDatabase({
    storage,
    now: () => new Date(Date.UTC(2026, 10, 15, 9, tick++, 0)).toISOString(),
    newId: () => `seed-${++n}`,
  });
  for (const input of inputs) {
    const r = db.add(input);
    if (!r.ok) throw new Error(r.error.message);
  }
  for (const name of trash) {
    const read = db.read();
    const rec = read.ok ? read.records.find((r) => r.name === name) : undefined;
    if (!rec || !db.trash(rec.id).ok) throw new Error(`could not trash ${name}`);
  }
  const read = db.read();
  if (!read.ok) throw new Error('seed unreadable');
  return { storage, records: read.records };
}
function storedRecords(storage: LiveStorage): DatabasePrimer[] {
  const read = openPrimerDatabase({ storage }).read();
  if (!read.ok) throw new Error(read.error.message);
  return read.records;
}

const ECORI_FWD: DatabasePrimerInput = {
  name: 'EcoRI-fwd',
  sequence: "5'-gcta TCGAATTCCGTAC-3'",
  tail5Prime: 'GCTA',
  modifications: "5' FAM",
  description: 'Adds an EcoRI site',
  labels: ['cloning', 'pUC19'],
};
const RC_DECOY: DatabasePrimerInput = { name: 'decoy', sequence: 'GGGATTCGAGGG', description: 'holds the reverse complement' };
const GUIDE: DatabasePrimerInput = { name: 'guide-rna', sequence: 'ACGUACGUAC', molecule: 'RNA', labels: ['crispr'] };
const OLD: DatabasePrimerInput = { name: 'old-primer', sequence: 'TTTTGGGGCCCC' };

describe('Databases > Primers opens from every menu (US-01M7DQFS AC1)', () => {
  it('US-01M7DQFS AC1 Tools > Databases > Primers and File > Import > Databases > Primers open the window with no session open', async () => {
    const { storage } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      expect(app.all('.mbc-menubar'), 'the in-window menu bar').toHaveLength(1);
      expect(primerWindow(app)).toBeNull();
      await clickMenuPath(app, ['Tools', 'Databases', 'Primers']);
      expect(listedNames(openWindow(app) && app)).toEqual(['EcoRI-fwd']);
      await app.click(button(openWindow(app), 'Close Primer Database'));
      expect(primerWindow(app)).toBeNull();
      await clickMenuPath(app, ['File', 'Import Data', 'Databases', 'Primers']);
      expect(listedNames(app)).toEqual(['EcoRI-fwd']);
    });
  });

  it('US-01M7DQFS AC1 the native menu item opens the window through the dispatcher and is enabled with no session', async () => {
    const mainRs = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
    const dbs = mainRs.slice(mainRs.indexOf('let tools_dbs_sub'), mainRs.indexOf('let tools_batch_sub'));
    // The native Databases submenu gains Primers and keeps every item it had, in order.
    expect([...dbs.matchAll(/item\("([^"]+)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'tools:databases-explorer NCBI & UniProt',
      'tools:primer-database Primers',
      'tools:make-blast-db Make BLAST Database from Selection…',
      'tools:local-blast-dbs Local BLAST DBs',
      'tools:blast-setup BLAST Setup',
    ]);
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('tools:primer-database', noSession)).toBe(true);
    const { storage } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      expect(listedNames(app)).toEqual(['EcoRI-fwd']);
    });
  });

  it('US-01M7DQFS AC1 the in-app Databases submenus keep their items and gain Primers', async () => {
    await withApp(memoryStorage(), async (app) => {
      expect(await submenuLabels(app, ['Tools', 'Databases'])).toEqual([
        'NCBI & UniProt',
        'Primers',
        'Make BLAST Database from Selection…',
        'Local BLAST DBs',
        'BLAST Setup',
      ]);
      await app.press('Escape');
      await app.press('Escape');
      await app.press('Escape');
      expect(await submenuLabels(app, ['File', 'Import Data', 'Databases'])).toEqual(['NCBI & UniProt', 'Primers']);
    });
  });
});

describe('The window lists, searches and backs up the store (US-01M7DQFS AC2)', () => {
  it('US-01M7DQFS AC2 the table lists active records with every column, and the trashed one is not listed', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE, OLD], ['old-primer']);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const head = openWindow(app).querySelectorAll('thead th').map((th) => words(th.textContent));
      expect(head).toEqual(['Name', "Sequence (5' → 3')", 'Length', 'Molecule', 'Modification', 'Labels', 'Modified', 'Actions']);
      const eco = records.find((r) => r.name === 'EcoRI-fwd')!;
      expect(listedRows(app)).toEqual([
        ['EcoRI-fwd', 'GCTATCGAATTCCGTAC', '17', 'DNA', "5' FAM", 'cloning, pUC19', eco.modifiedAt.slice(0, 16).replace('T', ' '), 'EditTrash'],
        ['guide-rna', 'ACGUACGUAC', '10', 'RNA', '', 'crispr', records[1].modifiedAt.slice(0, 16).replace('T', ' '), 'EditTrash'],
      ]);
      // The tail is drawn apart from the annealing portion.
      const tail = openWindow(app).querySelectorAll('tbody tr')[0].querySelectorAll('.tail-highlight');
      expect(tail.map((t) => words(t.textContent))).toEqual(['GCTA']);
    });
  });

  it('US-01M7DQFS AC2 search filters by name, stored sequence (any case, never its reverse complement), description or label', async () => {
    const { storage } = seededStorage([ECORI_FWD, RC_DECOY, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const search = field(openWindow(app), 'Search primers');
      const cases: Array<[string, string[]]> = [
        // TCGAAT is in EcoRI-fwd; its reverse complement ATTCGA is in decoy, which must not match.
        ['tcgaat', ['EcoRI-fwd']],
        ['TCG AAT', ['EcoRI-fwd']],
        ['decoy', ['decoy']],
        ['reverse complement', ['decoy']],
        ['crispr', ['guide-rna']],
        ['ACGUAC', ['guide-rna']],
        ['', ['EcoRI-fwd', 'decoy', 'guide-rna']],
      ];
      for (const [query, names] of cases) {
        await app.input(search, query);
        expect(listedNames(app), query).toEqual(names);
      }
      await app.input(search, 'zzz');
      expect(words(openWindow(app).textContent)).toContain('No primer matches the search.');
    });
  });

  it('US-01M7DQFS AC2 the window offers Add, Import, Export, Restore from Backup and Trash as named buttons', async () => {
    const { storage } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const w = openWindow(app);
      for (const name of ['Add', 'Import…', 'Export Backup…', 'Restore from Backup…', 'Trash (0)']) {
        expect(button(w, name).tagName).toBe('BUTTON');
      }
    });
  });

  it('US-01M7DQFS AC2 Import opens the primer import dialog with Primer Database chosen, and the window lists what it saved', async () => {
    const { storage } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Import…'));
      const text = app.one('#opdlg-ip-text', 'the import dialog');
      // Primer Database is the destination, and Documents is not offered.
      const dest = app.all('#opdlg-ip-destination');
      if (dest.length) expect(dest[0].options.map((o) => o.value)).toEqual(['database']);
      await app.change(text, 'name,sequence\nnew-rev,TTGACCGGTACCAAGT');
      const importDialog = text.closest('dialog, [role="dialog"]');
      if (!importDialog || importDialog === primerWindow(app)) throw new Error('the import dialog is not a dialog of its own');
      const run = importDialog.querySelectorAll('button').filter((b) => words(b.textContent) === 'Import');
      expect(run).toHaveLength(1);
      await app.click(run[0]);
      // The dialog runs after a short pause that lets it show Running…; the App's timers are fake.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await app.settle();
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd', 'new-rev']);
      expect(listedNames(app)).toEqual(['EcoRI-fwd', 'new-rev']);
    });
  });

  it('US-01M7DQFS AC2 Export saves the versioned backup through the platform save path', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE, OLD], ['old-primer']);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const before = app.downloads().length;
      await app.click(button(openWindow(app), 'Export Backup…'));
      const saved = app.downloads().slice(before);
      expect(saved).toHaveLength(1);
      expect(saved[0].filename).toMatch(/^primer-database-\d{4}-\d{2}-\d{2}\.json$/);
      const backup = JSON.parse(await saved[0].text());
      expect(backup.format).toBe(PRIMER_BACKUP_FORMAT);
      expect(backup.schema).toBe(1);
      expect(backup.records).toEqual(records);
    });
  });

  it('US-01M7DQFS AC2 Restore from Backup adds new records and lists a conflict, replacing it only when chosen', async () => {
    const source = seededStorage([ECORI_FWD, GUIDE]);
    const backupText = JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, exportedAt: 'x', records: source.records });
    const eco = source.records[0];
    const edited: DatabasePrimer = { ...eco, labels: ['edited here'] };
    const storage = memoryStorage({ [PRIMER_DATABASE_KEY]: JSON.stringify({ schema: 1, records: [edited] }) });
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const w = openWindow(app);
      const input = w.querySelectorAll('input[type="file"]')[0];
      (input as unknown as { files: unknown[] }).files = [{ text: async () => backupText }];
      await act(async () => {
        dispatchLiveEvent(input, 'change');
      });
      await app.settle();
      // The new record is added; the differing one is kept as stored and listed.
      expect(storedRecords(storage)).toEqual([edited, source.records[1]]);
      const conflicts = app.one('[role="group"][aria-label="Backup conflicts"]');
      expect(words(conflicts.textContent)).toContain('Replace stored EcoRI-fwd');
      const tick = conflicts.querySelectorAll('input[type="checkbox"]');
      expect(tick).toHaveLength(1);
      await app.change(tick[0], true);
      await app.click(button(openWindow(app), 'Replace Chosen'));
      expect(storedRecords(storage)).toEqual([eco, source.records[1]]);
    });
  });

  // Wrong restores (BG-01M7DT7A): a ticked record another window trashed before the commit brought
  // out of the trash, or left out of the result without a word.
  it('BG-01M7DT7A AC3 Restore from Backup names a ticked record trashed before the commit as not replaced, with the reason', async () => {
    const source = seededStorage([ECORI_FWD, GUIDE]);
    const backupText = JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, exportedAt: 'x', records: source.records });
    const [eco, guide] = source.records;
    const editedEco: DatabasePrimer = { ...eco, labels: ['edited here'] };
    const editedGuide: DatabasePrimer = { ...guide, labels: ['edited too'] };
    const storage = memoryStorage({ [PRIMER_DATABASE_KEY]: JSON.stringify({ schema: 1, records: [editedEco, editedGuide] }) });
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const input = openWindow(app).querySelectorAll('input[type="file"]')[0];
      (input as unknown as { files: unknown[] }).files = [{ text: async () => backupText }];
      await act(async () => {
        dispatchLiveEvent(input, 'change');
      });
      await app.settle();
      const conflicts = app.one('[role="group"][aria-label="Backup conflicts"]');
      const ticks = conflicts.querySelectorAll('input[type="checkbox"]');
      expect(ticks).toHaveLength(2);
      for (const t of ticks) await app.change(t, true);
      // Another window trashes guide-rna before the user presses Replace Chosen.
      expect(openPrimerDatabase({ storage }).trash(guide.id).ok).toBe(true);
      const trashed = storedRecords(storage).find((r) => r.id === guide.id)!;
      await app.click(button(openWindow(app), 'Replace Chosen'));
      const alert = openWindow(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
      expect(alert).toBe(`Restored the backup: 0 added, 1 replaced, 0 unchanged, 0 kept as stored, 1 not replaced: guide-rna (${guide.id}) is in the trash.`);
      // EcoRI-fwd is replaced; guide-rna stays in the trash as it was.
      expect(storedRecords(storage)).toEqual([eco, trashed]);
    });
  });

  it('US-01M7DQFS AC2 an unreadable store is named, never listed as empty, and discarded only on an explicit choice', async () => {
    for (const [stored, name] of [
      ['{"schema":1,"records":[', 'malformed'],
      ['{"schema":9,"records":[]}', 'futureSchema'],
    ]) {
      const storage = memoryStorage({ [PRIMER_DATABASE_KEY]: stored });
      await withApp(storage, async (app) => {
        await app.menu('tools:primer-database');
        const w = openWindow(app);
        const alert = w.querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
        expect(alert).toContain(`(${name})`);
        expect(alert).toContain(PRIMER_DATABASE_KEY);
        // No table and no "no primers yet": an unreadable store is not an empty one.
        expect(w.querySelectorAll('table')).toHaveLength(0);
        expect(words(w.textContent)).not.toContain('no primers yet');
        expect(button(w, 'Add').hasAttribute('disabled')).toBe(true);
        await app.click(button(w, 'Discard Unreadable Database…'));
        expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(stored);
        await app.click(button(w, 'Keep It'));
        expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(stored);
        await app.click(button(w, 'Discard Unreadable Database…'));
        await app.click(button(openWindow(app), 'Discard and Start Empty'));
        expect(JSON.parse(storage.getItem(PRIMER_DATABASE_KEY)!)).toEqual({ schema: 1, records: [] });
        expect(words(openWindow(app).textContent)).toContain('no primers yet');
      });
    }
  });

  it('US-01M7DQFS AC2 a write the storage refuses is shown as not saved and the store is unchanged', async () => {
    const { storage } = seededStorage([ECORI_FWD]);
    const raw = storage.getItem(PRIMER_DATABASE_KEY);
    const realSet = storage.setItem;
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      storage.setItem = (k: string, v: string) => {
        if (k === PRIMER_DATABASE_KEY) throw new Error('QuotaExceededError: the quota has been exceeded');
        realSet(k, v);
      };
      await app.click(button(openWindow(app), 'Trash EcoRI-fwd'));
      const alert = openWindow(app).querySelectorAll('[role="alert"]').map((a) => words(a.textContent)).join(' ');
      expect(alert).toMatch(/not saved/);
      expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(raw);
      expect(listedNames(app)).toEqual(['EcoRI-fwd']);
      storage.setItem = realSet;
    });
  });
});

describe('Add, edit, labels and trash (US-01M7DQFS AC3)', () => {
  it('US-01M7DQFS AC3 the form validates in place and shows the normalized sequence before anything is saved', async () => {
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Add'));
      const form = app.one('form[aria-label="Add primer"]');
      await app.input(field(form, "Sequence (5' → 3')"), "5'- gcta tcg aattc -3'");
      expect(words(app.one('[aria-label="Normalized sequence"]').textContent)).toBe("Saved as 5'-GCTATCGAATTC-3' (12 nt, DNA)");
      // A blank name is flagged before saving.
      expect(words(form.textContent)).toContain('A primer needs a name.');
      await app.input(field(form, "Sequence (5' → 3')"), 'ACGTU');
      expect(words(form.textContent)).toContain('both T and U');
      expect(words(app.one('[aria-label="Normalized sequence"]').textContent)).toContain('Not yet valid');
      await app.input(field(form, 'Name'), 'mixed');
      await app.click(button(form, 'Save Primer'));
      // Refused with the field's reason, and nothing written.
      expect(storage.getItem(PRIMER_DATABASE_KEY)).toBeNull();
      expect(words(form.textContent)).toContain('both T and U');
    });
  });

  it('US-01M7DQFS AC3 Add saves the normalized record with the labels added, not the label removed', async () => {
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Add'));
      const form = app.one('form[aria-label="Add primer"]');
      await app.input(field(form, 'Name'), 'new-fwd');
      await app.input(field(form, "Sequence (5' → 3')"), 'ggatcc acgtacgtacgtac');
      await app.input(field(form, "5' tail (non-annealing, optional)"), 'ggatcc');
      for (const label of ['cloning', 'temporary']) {
        await app.input(field(form, 'New label'), label);
        await app.click(button(form, 'Add Label'));
      }
      await app.click(button(form, 'Remove label temporary'));
      await app.click(button(form, 'Save Primer'));
      const [rec] = storedRecords(storage);
      expect(rec).toMatchObject({
        name: 'new-fwd',
        sequence: 'GGATCCACGTACGTACGTAC',
        originalInput: 'ggatcc acgtacgtacgtac',
        tail5Prime: 'GGATCC',
        molecule: 'DNA',
        labels: ['cloning'],
        provenance: 'Entered by hand',
      });
      expect(app.all('form[aria-label="Add primer"]')).toHaveLength(0);
      expect(listedNames(app)).toEqual(['new-fwd']);
    });
  });

  it('US-01M7DQFS AC3 Edit keeps the id, the creation time and the input as typed, and changes only what was edited', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Edit EcoRI-fwd'));
      const form = app.one('form[aria-label="Edit EcoRI-fwd"]');
      await app.input(field(form, 'Description'), 'Adds an EcoRI site to pUC19');
      await app.click(button(form, 'Remove label pUC19'));
      await app.click(button(form, 'Save Changes'));
      const [eco, guide] = storedRecords(storage);
      // Wrong implementation: an edit that re-sends the shown sequence replaces the input as typed.
      expect({ ...eco, modifiedAt: 'x' }).toEqual({
        ...records[0],
        description: 'Adds an EcoRI site to pUC19',
        labels: ['cloning'],
        modifiedAt: 'x',
      });
      expect(eco.originalInput).toBe("5'-gcta TCGAATTCCGTAC-3'");
      expect(eco.modifiedAt).not.toBe(records[0].modifiedAt);
      expect(guide).toEqual(records[1]);
    });
  });

  it('US-01M7DQFS AC3 adding or editing a record that matches a stored one shows the import classification and choices, never a silent duplicate', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const addAs = async (name: string, sequence: string, modifications = '', label = '') => {
        await app.click(button(openWindow(app), 'Add'));
        const form = app.one('form[aria-label="Add primer"]');
        await app.input(field(form, 'Name'), name);
        await app.input(field(form, "Sequence (5' → 3')"), sequence);
        if (modifications) await app.input(field(form, 'Modifications'), modifications);
        if (label) {
          await app.input(field(form, 'New label'), label);
          await app.click(button(form, 'Add Label'));
        }
        await app.click(button(form, 'Save Primer'));
        return form;
      };
      const panelText = () => words(app.one('[role="group"][aria-label="Duplicate primer"]').textContent);

      // Same name (trimmed, any case), different oligo: listed, nothing written until a choice.
      let form = await addAs(' ecori-FWD ', 'ACGTACGTACGTAC');
      expect(panelText()).toContain('Same name, different oligo');
      expect(panelText()).toContain('EcoRI-fwd');
      expect(storedRecords(storage)).toEqual(records);
      // Merge is offered only where the oligo matches (D0122): never into a same-name record of another oligo.
      expect(app.one('[role="group"][aria-label="Duplicate primer"]').querySelectorAll('button').map(nameOf)).toEqual([
        'Skip',
        'Keep Separately (default)',
        'Cancel',
      ]);
      await app.click(button(form, 'Skip'));
      expect(storedRecords(storage)).toEqual(records);
      expect(app.all('form[aria-label="Add primer"]'), 'Skip closes the form').toHaveLength(0);

      // Same oligo (bases, molecule and modification), different name: Keep Separately writes a second record.
      form = await addAs('eco-copy', 'GCTATCGAATTCCGTAC', "5' FAM");
      expect(panelText()).toContain('Same oligo, different name');
      expect(storedRecords(storage)).toEqual(records);
      await app.click(button(form, 'Keep Separately'));
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd', 'guide-rna', 'eco-copy']);

      // The same bases with another modification are a new primer: no panel, saved at once.
      await addAs('eco-hex', 'GCTATCGAATTCCGTAC', "5' HEX");
      expect(app.all('[role="group"][aria-label="Duplicate primer"]')).toHaveLength(0);
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd', 'guide-rna', 'eco-copy', 'eco-hex']);

      // An exact duplicate defaults to Skip; Merge Metadata adds its label to the stored record, no new record.
      form = await addAs('EcoRI-fwd', 'GCTATCGAATTCCGTAC', "5' FAM", 'stock-2026');
      expect(panelText()).toContain('Exact duplicate');
      expect(button(form, 'Skip (default)')).toBeTruthy();
      await app.click(button(form, 'Merge Metadata'));
      const after = storedRecords(storage);
      expect(after.map((r) => r.name)).toEqual(['EcoRI-fwd', 'guide-rna', 'eco-copy', 'eco-hex']);
      expect(after[0]).toMatchObject({ id: records[0].id, sequence: records[0].sequence, labels: ['cloning', 'pUC19', 'stock-2026'] });

      // Editing guide-rna to EcoRI-fwd's name is classified too, and Skip leaves it as stored.
      const beforeEdit = storedRecords(storage);
      await app.click(button(openWindow(app), 'Edit guide-rna'));
      const edit = app.one('form[aria-label="Edit guide-rna"]');
      await app.input(field(edit, 'Name'), 'EcoRI-fwd');
      await app.click(button(edit, 'Save Changes'));
      expect(panelText()).toContain('Same name, different oligo');
      expect(storedRecords(storage)).toEqual(beforeEdit);
      await app.click(button(app.one('form[aria-label="Edit EcoRI-fwd"]'), 'Skip'));
      expect(storedRecords(storage)).toEqual(beforeEdit);
    });
  });

  it('US-01M7DQFS AC3 a candidate matching one record by name and another by oligo names both, offers skip or keep only, and defaults to skip', async () => {
    const third: DatabasePrimerInput = { name: 'third', sequence: 'TTTTGGGGCCCC' };
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE, third]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const panel = () => app.one('[role="group"][aria-label="Duplicate primer"]');
      // Wrong implementations: the oligo match dropped (a second copy of EcoRI-fwd's oligo under
      // guide-rna's name), or Merge offered into either record.
      await app.click(button(openWindow(app), 'Add'));
      const form = app.one('form[aria-label="Add primer"]');
      await app.input(field(form, 'Name'), 'GUIDE-RNA');
      await app.input(field(form, "Sequence (5' → 3')"), 'GCTATCGAATTCCGTAC');
      await app.input(field(form, 'Modifications'), "5' FAM");
      await app.click(button(form, 'Save Primer'));
      expect(words(panel().textContent)).toContain('Matches two primers');
      expect(words(panel().textContent)).toContain('by name, matches stored primer guide-rna');
      expect(words(panel().textContent)).toContain('by oligo, matches stored primer EcoRI-fwd');
      expect(panel().querySelectorAll('button').map(nameOf)).toEqual(['Skip (default)', 'Keep Separately', 'Cancel']);
      expect(storedRecords(storage)).toEqual(records);
      await app.click(button(panel(), 'Skip (default)'));
      expect(storedRecords(storage)).toEqual(records);

      // An edit that would make "third" match both is classified the same way.
      await app.click(button(openWindow(app), 'Edit third'));
      const edit = app.one('form[aria-label="Edit third"]');
      await app.input(field(edit, 'Name'), 'guide-rna');
      await app.input(field(edit, "Sequence (5' → 3')"), 'GCTATCGAATTCCGTAC');
      await app.input(field(edit, 'Modifications'), "5' FAM");
      await app.click(button(edit, 'Save Changes'));
      expect(words(panel().textContent)).toContain('Matches two primers');
      expect(panel().querySelectorAll('button').map(nameOf)).toEqual(['Skip (default)', 'Keep Separately', 'Cancel']);
      expect(storedRecords(storage)).toEqual(records);
    });
  });

  it('US-01M7DQFS AC3 a class the window does not know is shown with skip or keep only and defaults to skip; merge needs an oligo match', () => {
    const [a, b] = seededStorage([ECORI_FWD, GUIDE]).records;
    // Wrong implementation: a new class from the shared classifier falls through to keep, or offers merge.
    expect(duplicateMatchFor('someFutureClass', a, b)).toMatchObject({
      cls: 'someFutureClass',
      label: 'Matches a stored primer (someFutureClass)',
      choices: ['skip', 'keep'],
      defaultChoice: 'skip',
    });
    expect(duplicateMatchFor('both', a, b)).toMatchObject({ label: 'Matches two primers', choices: ['skip', 'keep'], defaultChoice: 'skip' });
    expect(duplicateMatchFor('sameName', a, null)).toMatchObject({ choices: ['skip', 'keep'], defaultChoice: 'keep' });
    expect(duplicateMatchFor('sameOligo', null, a)).toMatchObject({ choices: ['skip', 'keep', 'merge'], defaultChoice: 'skip' });
    expect(duplicateMatchFor('exact', a, a)).toMatchObject({ choices: ['skip', 'keep', 'merge'], defaultChoice: 'skip' });
    // An oligo class without the stored record to merge into offers no merge.
    expect(duplicateMatchFor('sameOligo', null, null).choices).toEqual(['skip', 'keep']);
  });

  it('US-01M7DQFS AC3 Trash lists trashed records with Restore, and only Empty Trash deletes them', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Trash EcoRI-fwd'));
      expect(listedNames(app)).toEqual(['guide-rna']);
      await app.click(button(openWindow(app), 'Trash (1)'));
      expect(listedNames(app)).toEqual(['EcoRI-fwd']);
      await app.click(button(openWindow(app), 'Restore EcoRI-fwd'));
      expect(storedRecords(storage)).toEqual(records);
      await app.click(button(openWindow(app), 'Show Primers'));
      await app.click(button(openWindow(app), 'Trash guide-rna'));
      await app.click(button(openWindow(app), 'Trash (1)'));
      await app.click(button(openWindow(app), 'Empty Trash'));
      // A first click only asks.
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd', 'guide-rna']);
      await app.click(button(openWindow(app), 'Delete for Good'));
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd']);
    });
  });
});

// ─── Primer & PCR Studio (AC4) ───

function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[Math.floor((s / 2 ** 32) * 4)];
  }
  return out;
}
const TEMPLATE_SEQ = lettersFrom(0x7a3d, 1200);
const SITE = TEMPLATE_SEQ.slice(300, 322);
const DOC_PRIMER: PrimerRecord = {
  id: 'dqfs-doc-primer', name: 'Doc_Tailed_Fwd', sequence: `GAATTC${SITE}`, annealSequence: SITE, tail5Prime: 'GAATTC',
  bindStart: 301, bindEnd: 322, strand: 1, length: 28, gcPercent: 50, tmAnnealC: 60, tmFullC: 66, deltaG37: -30,
  hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true, notes: 'from the lab stock',
};
const TEMPLATE: SequenceDocument = {
  id: 'dqfs-template', name: 'pDQFS_Template', accession: 'DQFS_0001', description: 'A linear template built in the test',
  sequence: TEMPLATE_SEQ, moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z',
  features: [{ id: 'f-dqfs-cds', name: 'DqfsCDS', type: 'CDS', start: 101, end: 700, strand: 1, color: '#d93025' }],
  primers: [DOC_PRIMER], history: [],
};
const ownWords = (label: LiveElement) =>
  words(label.childNodes.map((n) => (n instanceof LiveElement && (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? '' : n.textContent)).join(''));
/** The cataloged primers table of the studio: each row's primer name. */
const catalogNames = (app: AppHarness) =>
  app.all('table[aria-label="Cataloged Primers and Binding Specificity"] tbody tr, [aria-label="Cataloged Primers and Binding Specificity"] tbody tr').map((tr) => words(tr.querySelectorAll('strong')[0]?.textContent));

describe('Save to Primer Database from Primer & PCR Studio (US-01M7DQFS AC4)', () => {
  it('US-01M7DQFS AC4 a designed primer is saved as the ordered oligo, tail included and kept apart, with its provenance, and the document is unchanged', async () => {
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await app.restoreSession({ documents: [TEMPLATE], activeDocId: TEMPLATE.id, viewerTab: 'primers-pcr' });
      const tailSelect = app.all('select').find((s) => s.labels.some((l) => ownWords(l) === "5' Forward Enzyme Tail:"));
      if (!tailSelect) throw new Error('no forward tail setting');
      await app.change(tailSelect, 'EcoRI');
      const card = app.all('.primer-pair-cards .primer-detail-card')[0];
      const tail = words(card.querySelectorAll('.tail-highlight')[0].textContent);
      const anneal = words(card.querySelectorAll('.primer-seq-display span').filter((x) => !x.classList.contains('tail-highlight'))[0].textContent);
      expect(tail).toBe('GCGGAATTC');
      const save = card.querySelectorAll('button').find((b) => /^Save .+ to Primer Database$/.test(nameOf(b)));
      if (!save) throw new Error('no Save to Primer Database on the designed primer');
      const name = nameOf(save).replace(/^Save | to Primer Database$/g, '');
      const catalogBefore = catalogNames(app);
      await app.click(save);
      const [rec] = storedRecords(storage);
      // Wrong implementations: the annealing portion alone saved, or the tail folded in and not recorded.
      expect(rec).toMatchObject({ name, sequence: tail + anneal, tail5Prime: tail, molecule: 'DNA' });
      expect(rec.provenance).toContain('pDQFS_Template');
      expect(rec.provenance).toContain(`forward primer ${name}`);
      expect(rec.provenance).toContain('design region 101..700');
      // The document's primers are unchanged: Save is not Bind Primer Pair.
      expect(catalogNames(app)).toEqual(catalogBefore);
      expect(catalogBefore).toEqual(['Doc_Tailed_Fwd']);

      // Saving it again is an exact duplicate: the import choices are offered and nothing is written until one is chosen.
      await app.click(save);
      const panel = app.one('[role="group"][aria-label="Duplicate primer"]');
      expect(words(panel.textContent)).toContain('Exact duplicate');
      expect(storedRecords(storage)).toHaveLength(1);
      await app.click(button(panel, 'Skip (default)'));
      expect(storedRecords(storage)).toHaveLength(1);
      expect(app.all('[role="group"][aria-label="Duplicate primer"]')).toHaveLength(0);
    });
  });

  it("US-01M7DQFS AC4 a document's primer is saved with its tail apart and provenance naming the document and primer; a name match offers the choices", async () => {
    const { storage } = seededStorage([{ name: 'doc_tailed_fwd', sequence: 'ACGTACGTACGTACGT' }]);
    await withApp(storage, async (app) => {
      await app.restoreSession({ documents: [TEMPLATE], activeDocId: TEMPLATE.id, viewerTab: 'primers-pcr' });
      const save = app.all('button').find((b) => nameOf(b) === 'Save Doc_Tailed_Fwd to Primer Database');
      if (!save) throw new Error("no Save to Primer Database on the document's primer");
      await app.click(save);
      // The stored doc_tailed_fwd has the same name (any case) and another oligo.
      const panel = app.one('[role="group"][aria-label="Duplicate primer"]');
      expect(words(panel.textContent)).toContain('Same name, different oligo');
      expect(panel.querySelectorAll('button').map(nameOf)).not.toContain('Merge Metadata');
      expect(storedRecords(storage)).toHaveLength(1);
      await app.click(button(panel, 'Keep Separately (default)'));
      const [, rec] = storedRecords(storage);
      expect(rec).toMatchObject({ name: 'Doc_Tailed_Fwd', sequence: `GAATTC${SITE}`, tail5Prime: 'GAATTC', description: 'from the lab stock' });
      expect(rec.provenance).toContain('Primer Doc_Tailed_Fwd on pDQFS_Template');
      expect(rec.provenance).toContain('dqfs-template');
      expect(catalogNames(app)).toEqual(['Doc_Tailed_Fwd']);
    });
  });
});

describe('Save to Primer Database with a two-way match (US-01M7DQFS AC4)', () => {
  it("US-01M7DQFS AC4 a document's primer matching one record by name and another by oligo names both and defaults to skip", async () => {
    const { storage, records } = seededStorage([
      { name: 'doc_tailed_fwd', sequence: 'ACGTACGTACGTACGT' },
      { name: 'stock-copy', sequence: `GAATTC${SITE}` },
    ]);
    await withApp(storage, async (app) => {
      await app.restoreSession({ documents: [TEMPLATE], activeDocId: TEMPLATE.id, viewerTab: 'primers-pcr' });
      const save = app.all('button').find((b) => nameOf(b) === 'Save Doc_Tailed_Fwd to Primer Database');
      if (!save) throw new Error("no Save to Primer Database on the document's primer");
      await app.click(save);
      const panel = app.one('[role="group"][aria-label="Duplicate primer"]');
      expect(words(panel.textContent)).toContain('Matches two primers');
      expect(words(panel.textContent)).toContain('by name, matches stored primer doc_tailed_fwd');
      expect(words(panel.textContent)).toContain('by oligo, matches stored primer stock-copy');
      expect(panel.querySelectorAll('button').map(nameOf)).toEqual(['Skip (default)', 'Keep Separately', 'Cancel']);
      expect(storedRecords(storage)).toEqual(records);
      await app.click(button(panel, 'Skip (default)'));
      expect(storedRecords(storage)).toEqual(records);
      expect(catalogNames(app)).toEqual(['Doc_Tailed_Fwd']);
    });
  });
});

describe('Keyboard and screen reader (US-01M7DQFS AC5)', () => {
  it('US-01M7DQFS AC5 the window is a labelled dialog, focus starts in search, and Escape returns focus to the in-app opener', async () => {
    const { storage } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      const opener = await clickMenuPath(app, ['Tools', 'Databases', 'Primers']);
      const w = openWindow(app);
      expect(w.getAttribute('aria-modal')).toBe('true');
      expect(words(app.one('#primer-db-title').textContent)).toBe('Primer Database');
      expect(app.doc.activeElement === field(w, 'Search primers'), `focus starts in search, not on ${nameOf(app.doc.activeElement as LiveElement)}`).toBe(true);
      await app.press('Escape');
      expect(primerWindow(app)).toBeNull();
      expect(app.doc.activeElement === opener, `focus returns to the Tools menu button, not ${nameOf(app.doc.activeElement as LiveElement)}`).toBe(true);
    });
  });

  it('US-01M7DQFS AC5 every row and table action is a named button in the tab order, with no click-only row handler', async () => {
    const { storage } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const w = openWindow(app);
      const buttons = w.querySelectorAll('button');
      for (const b of buttons) {
        expect(nameOf(b), 'a named button').not.toBe('');
        expect(b.getAttribute('tabindex'), nameOf(b)).not.toBe('-1');
      }
      for (const tr of w.querySelectorAll('tbody tr')) {
        const name = words(tr.querySelectorAll('td')[0].textContent);
        expect(tr.querySelectorAll('button').map(nameOf)).toEqual([`Edit ${name}`, `Trash ${name}`]);
        expect(tr.hasAttribute('tabindex') || tr.hasAttribute('role')).toBe(false);
      }
    });
    // No row or cell carries a click handler of its own: every row action is one of those buttons.
    const src = readFileSync(new URL('../components/PrimerDatabaseWindow.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/<(tr|td)\b[^>]*on(Click|MouseDown|DoubleClick|PointerDown)/);
  });
});

export type { SequenceDocument };

// ─── BG-01M7DVJJ: Escape, honest export, edits never merged away, the Studio panel's focus ───

const isFocused = (app: AppHarness, el: LiveElement | null | undefined) => !!el && app.doc.activeElement === el;
const focusName = (app: AppHarness) => nameOf(app.doc.activeElement as LiveElement);
const noticeText = (app: AppHarness) =>
  openWindow(app)
    .querySelectorAll('[role="status"], [role="alert"]')
    .map((n) => words(n.textContent))
    .join(' | ');

describe('Escape closes the innermost open thing first (BG-01M7DVJJ AC1)', () => {
  it('BG-01M7DVJJ AC1 Escape closes an Add or Edit form and keeps the window, with focus back on Add or Edit', async () => {
    const { storage } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      // Wrong implementation: Escape closes the whole window and the typed name is lost.
      await app.click(button(openWindow(app), 'Add'));
      // The form takes focus in its Name field, so Escape lands in the window even where a click does not focus.
      expect(isFocused(app, field(app.one('form[aria-label="Add primer"]'), 'Name')), `focus is on ${focusName(app)}`).toBe(true);
      await app.input(field(app.one('form[aria-label="Add primer"]'), 'Name'), 'half-typed');
      await app.press('Escape');
      expect(primerWindow(app), 'the window stays open').not.toBeNull();
      expect(app.all('form[aria-label="Add primer"]')).toHaveLength(0);
      expect(isFocused(app, button(openWindow(app), 'Add')), `focus is on ${focusName(app)}`).toBe(true);
      await app.click(button(openWindow(app), 'Edit guide-rna'));
      expect(isFocused(app, field(app.one('form[aria-label="Edit guide-rna"]'), 'Name')), `focus is on ${focusName(app)}`).toBe(true);
      await app.press('Escape');
      expect(app.all('form[aria-label="Edit guide-rna"]')).toHaveLength(0);
      expect(isFocused(app, button(openWindow(app), 'Edit guide-rna')), `focus is on ${focusName(app)}`).toBe(true);
      // With nothing open, Escape closes the window as before.
      await app.press('Escape');
      expect(primerWindow(app)).toBeNull();
    });
  });

  it('BG-01M7DVJJ AC1 Escape closes a pending duplicate choice first, keeping the form and what was typed', async () => {
    const { storage, records } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Add'));
      const form = app.one('form[aria-label="Add primer"]');
      await app.input(field(form, 'Name'), 'EcoRI-fwd');
      await app.input(field(form, "Sequence (5' → 3')"), 'ACGTACGTACGTAC');
      await app.click(button(form, 'Save Primer'));
      expect(app.all('[role="group"][aria-label="Duplicate primer"]')).toHaveLength(1);
      await app.press('Escape');
      expect(app.all('[role="group"][aria-label="Duplicate primer"]')).toHaveLength(0);
      const still = app.one('form[aria-label="Add primer"]');
      expect(field(still, 'Name').value).toBe('EcoRI-fwd');
      expect(field(still, "Sequence (5' → 3')").value).toBe('ACGTACGTACGTAC');
      expect(isFocused(app, button(still, 'Save Primer')), `focus is on ${focusName(app)}`).toBe(true);
      expect(storedRecords(storage)).toEqual(records);
      await app.press('Escape');
      expect(app.all('form[aria-label="Add primer"]')).toHaveLength(0);
      expect(isFocused(app, button(openWindow(app), 'Add')), `focus is on ${focusName(app)}`).toBe(true);
    });
  });

  it('BG-01M7DVJJ AC1 Escape closes the Empty Trash question first, with focus back on Empty Trash', async () => {
    const { storage } = seededStorage([ECORI_FWD, OLD], ['old-primer']);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Trash (1)'));
      await app.click(button(openWindow(app), 'Empty Trash'));
      await app.press('Escape');
      expect(primerWindow(app)).not.toBeNull();
      expect(isFocused(app, button(openWindow(app), 'Empty Trash')), `focus is on ${focusName(app)}`).toBe(true);
      expect(storedRecords(storage).map((r) => r.name)).toEqual(['EcoRI-fwd', 'old-primer']);
    });
  });
});

describe('Export says what the save path did (BG-01M7DVJJ AC2)', () => {
  it('BG-01M7DVJJ AC2 on the desktop app, Export says Exported only for a written file, and Export cancelled when the dialog is cancelled', async () => {
    const { storage, records } = seededStorage([ECORI_FWD, GUIDE]);
    await withApp(
      storage,
      async (app) => {
        await app.menu('tools:primer-database');
        nativeSave.calls.length = 0;
        // Cancelled: wrong implementation reports Exported because the dialog was opened.
        nativeSave.answer = async () => null;
        await app.click(button(openWindow(app), 'Export Backup…'));
        expect(nativeSave.calls).toHaveLength(1);
        expect(JSON.parse(nativeSave.calls[0].content).records).toEqual(records);
        expect(noticeText(app)).toContain('Export cancelled: no file was saved.');
        expect(noticeText(app)).not.toContain('Exported');
        // Written: the path the dialog wrote to.
        nativeSave.answer = async () => '/Users/lab/primer-database.json';
        await app.click(button(openWindow(app), 'Export Backup…'));
        expect(noticeText(app)).toContain('Exported the Primer Database backup to /Users/lab/primer-database.json.');
        // Failed: said as a failure.
        nativeSave.answer = async () => {
          throw new Error('[ERR_PERMISSION_DENIED] the folder is read-only');
        };
        await app.click(button(openWindow(app), 'Export Backup…'));
        expect(noticeText(app)).toContain('Export failed');
        expect(noticeText(app)).not.toContain('Exported');
      },
      macHost(),
    );
    nativeSave.answer = null;
  });

  it('BG-01M7DVJJ AC2 Save Unreadable Data says cancelled or saved the same way', async () => {
    const stored = '{"schema":1,"records":[';
    const storage = memoryStorage({ [PRIMER_DATABASE_KEY]: stored });
    await withApp(
      storage,
      async (app) => {
        await app.menu('tools:primer-database');
        nativeSave.calls.length = 0;
        nativeSave.answer = async () => null;
        await app.click(button(openWindow(app), 'Save Unreadable Data…'));
        expect(nativeSave.calls.map((c) => c.content)).toEqual([stored]);
        expect(noticeText(app)).toContain('Copy of the unreadable data cancelled: no file was saved.');
        expect(noticeText(app)).not.toMatch(/Saved a copy/);
        nativeSave.answer = async () => '/Users/lab/unreadable.json';
        await app.click(button(openWindow(app), 'Save Unreadable Data…'));
        expect(noticeText(app)).toContain('Copy of the unreadable data saved to /Users/lab/unreadable.json.');
        expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(stored);
      },
      macHost(),
    );
    nativeSave.answer = null;
  });

  it('BG-01M7DVJJ AC2 in the browser, where the download is not confirmed, Export never says Exported', async () => {
    const { storage } = seededStorage([ECORI_FWD]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      const before = app.downloads().length;
      await app.click(button(openWindow(app), 'Export Backup…'));
      expect(app.downloads().length).toBe(before + 1);
      expect(noticeText(app)).toContain('handed to your browser to download as primer-database-');
      expect(noticeText(app)).not.toContain('Exported');
    });
  });
});

describe('An edit is never merged away (BG-01M7DVJJ AC3)', () => {
  it("BG-01M7DVJJ AC3 an edit matching another record's oligo offers no Merge, and Keep Separately saves the edit", async () => {
    const third: DatabasePrimerInput = { name: 'third', sequence: 'TTTTGGGGCCCC', labels: ['x'] };
    const { storage, records } = seededStorage([ECORI_FWD, third]);
    await withApp(storage, async (app) => {
      await app.menu('tools:primer-database');
      await app.click(button(openWindow(app), 'Edit third'));
      const edit = app.one('form[aria-label="Edit third"]');
      await app.input(field(edit, "Sequence (5' → 3')"), 'GCTATCGAATTCCGTAC');
      await app.input(field(edit, 'Modifications'), "5' FAM");
      await app.input(field(edit, 'Description'), 'now the EcoRI oligo');
      await app.click(button(edit, 'Save Changes'));
      const panel = app.one('[role="group"][aria-label="Duplicate primer"]');
      expect(words(panel.textContent)).toContain('Same oligo, different name');
      // Wrong implementation: Merge Metadata offered, which writes into EcoRI-fwd and drops these edits.
      expect(panel.querySelectorAll('button').map(nameOf)).toEqual(['Skip (default)', 'Keep Separately', 'Cancel']);
      expect(storedRecords(storage)).toEqual(records);
      await app.click(button(panel, 'Keep Separately'));
      const [eco, edited] = storedRecords(storage);
      expect(eco).toEqual(records[0]);
      expect(edited).toMatchObject({
        id: records[1].id,
        name: 'third',
        sequence: 'GCTATCGAATTCCGTAC',
        modifications: "5' FAM",
        description: 'now the EcoRI oligo',
      });
    });
  });
});

describe("The Studio's duplicate panel takes focus (BG-01M7DVJJ AC4)", () => {
  it('BG-01M7DVJJ AC4 focus moves into the panel when Save to Primer Database finds a match, and back to the Save button when it closes', async () => {
    const { storage } = seededStorage([{ name: 'stock-copy', sequence: `GAATTC${SITE}` }]);
    await withApp(storage, async (app) => {
      await app.restoreSession({ documents: [TEMPLATE], activeDocId: TEMPLATE.id, viewerTab: 'primers-pcr' });
      const save = () => app.all('button').find((b) => nameOf(b) === 'Save Doc_Tailed_Fwd to Primer Database')!;
      await app.click(save());
      const panel = app.one('[role="dialog"][aria-label="Save Doc_Tailed_Fwd to Primer Database"]');
      // Wrong implementation: the panel appears but focus stays on the Save button behind it.
      expect(panel.contains(app.doc.activeElement as LiveElement), `focus is on ${focusName(app)}`).toBe(true);
      expect(focusName(app)).toBe('Skip (default)');
      await app.press('Escape');
      expect(app.all('[role="dialog"][aria-label="Save Doc_Tailed_Fwd to Primer Database"]')).toHaveLength(0);
      expect(isFocused(app, save()), `focus is on ${focusName(app)}`).toBe(true);
      await app.click(save());
      await app.click(button(app.one('[role="dialog"][aria-label="Save Doc_Tailed_Fwd to Primer Database"]'), 'Skip (default)'));
      expect(isFocused(app, save()), `focus is on ${focusName(app)}`).toBe(true);
      expect(storedRecords(storage)).toHaveLength(1);
    });
  });
});
