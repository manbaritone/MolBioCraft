// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7RCCA AC4 and AC5 (D0228): File > Export Sequences > Convert GenBank… opens the Convert
 * GenBank dialog, with no session open as with one, and the dialog converts a GenBank file (gzipped
 * or not) or the open records through the engine's one `genbank_to_convert` RPC, saving the one
 * file, or the one zip of several, through saveWorkbenchFile.
 *
 * The real App is mounted (appHarness.tsx) and driven by clicks on its in-window menus. The file is
 * the genbank_to oracle fixture (crates/molbiocraft-formats/tests/fixtures/genbank_to), handed to the
 * dialog's file input as the browser hands a File over; the expected protein text is genbank_to
 * 0.54's own (expected/oracle.faa). Every request the dialog sends is recorded on its way to the
 * real engine.
 *
 * Wrong implementations, and what catches each: the menu item missing, under a session-only
 * submenu, or behind requireActiveSession (the no-session open); a save per file instead of one zip
 * (exactly one save, the zip); a zip for one file, or a name not '<base>.faa' (the Proteins-only
 * save and its text); the gzip extension kept in the base name, or a gzipped file sent as text (the
 * .gbk.gz file); the Bakta-only options shown or sent without Bakta JSON (null gram and table,
 * selects absent); the engine's warnings or refusals not shown; the RPC called more than once a
 * Convert; the records source sending other documents than the active record.
 */

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { GenbankToRequest } from '../core/bioEngine';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, type LiveElement } from './liveDom';

/** Every Convert GenBank request the App sends, on globalThis so each fresh launch's copy shares it. */
const CALLS = Symbol.for('molbiocraft.genbankToDialog.calls');
const calls = (): GenbankToRequest[] => {
  const g = globalThis as unknown as Record<symbol, GenbankToRequest[] | undefined>;
  return (g[CALLS] ??= []);
};

vi.mock('../core/bioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/bioEngine')>();
  return {
    ...actual,
    convertGenbank: (request: GenbankToRequest) => {
      (globalThis as unknown as Record<symbol, GenbankToRequest[]>)[Symbol.for('molbiocraft.genbankToDialog.calls')].push(
        JSON.parse(JSON.stringify(request)) as GenbankToRequest
      );
      return actual.convertGenbank(request);
    },
  };
});

const FIXTURES = new URL('../../crates/molbiocraft-formats/tests/fixtures/genbank_to/', import.meta.url);
const ORACLE = readFileSync(new URL('oracle.gbk', FIXTURES), 'utf8');
const FAA = readFileSync(new URL('expected/oracle.faa', FIXTURES), 'utf8');
const NO_VERSION_WARNING = 'Record OR000003 has no VERSION line, so its accession is used as its id.';

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The one menu item, in the open menus, whose text is `label`. */
function menuItem(app: AppHarness, label: string): LiveElement {
  const found = app.all('[role="menuitem"]').filter((m) => words(m.textContent) === label);
  if (found.length !== 1) throw new Error(`${found.length} menu items read "${label}"`);
  return found[0];
}

/** Opens the in-window File menu and clicks File > Export Sequences > Convert GenBank…. */
async function openFromFileMenu(app: AppHarness): Promise<void> {
  const file = app.all('[role="menubar"] [role="menuitem"]').filter((b) => words(b.textContent) === 'File');
  expect(file, 'the in-window File menu').toHaveLength(1);
  await app.click(file[0]);
  const exportSeq = menuItem(app, 'Export Sequences');
  expect(exportSeq.hasAttribute('disabled'), 'Export Sequences is enabled').toBe(false);
  await app.click(exportSeq);
  const convert = menuItem(app, 'Convert GenBank…');
  expect(convert.hasAttribute('disabled'), 'Convert GenBank… is enabled').toBe(false);
  await app.click(convert);
}

const dialog = (app: AppHarness) => app.one('[data-genbank-to-dialog]', 'the Convert GenBank dialog');
const output = (app: AppHarness, id: string) => app.one(`input[data-genbank-to-output="${id}"]`, `the ${id} checkbox`);

/** Chooses a file in the dialog's file input, as the browser hands it over. */
async function chooseFile(app: AppHarness, name: string, bytes: Uint8Array): Promise<void> {
  const input = app.one('input[type="file"][data-genbank-to-file]', 'the GenBank file input');
  (input as unknown as { files: unknown[] }).files = [{ name, arrayBuffer: async () => bytes.slice().buffer }];
  await act(async () => {
    dispatchLiveEvent(input, 'change');
  });
  await app.settle();
}

async function convert(app: AppHarness): Promise<void> {
  await app.click(app.one('button[data-genbank-to-convert]', 'the Convert button'));
}

const warningsShown = (app: AppHarness) => app.all('[data-genbank-to-warnings] li').map((li) => words(li.textContent));

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  calls().length = 0;
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

describe('Convert GenBank (US-01M7RCCA AC4, AC5)', () => {
  it('opens from File > Export Sequences with no session, and saves one zip for two outputs and one file for one', async () => {
    await withApp(async (app) => {
      expect(app.railTabs(), 'no session is open').toHaveLength(0);
      await openFromFileMenu(app);
      dialog(app);
      // with no session the source is a file; the records choice is there, and off
      const records = app.one('input[data-genbank-to-source="records"]');
      expect(records.hasAttribute('disabled'), 'no record to convert').toBe(true);
      expect(app.one('input[data-genbank-to-source="file"]').checked).toBe(true);
      const input = app.one('input[type="file"][data-genbank-to-file]');
      expect(input.getAttribute('accept')?.split(',')).toEqual(
        ['.gb', '.gb.gz', '.gbk', '.gbk.gz', '.gbff', '.gbff.gz', '.genbank', '.genbank.gz']
      );
      // a checkbox for each output, and each option
      expect(app.all('input[data-genbank-to-output]').map((e) => e.getAttribute('data-genbank-to-output'))).toEqual(
        ['nucleotides', 'cdsDna', 'proteins', 'functions', 'ptt', 'phageFinder', 'gff3', 'amrFinderPlus', 'baktaJson']
      );
      expect(words(dialog(app).textContent)).toMatch(/Include pseudogenes.*Complex headers.*One file per record/);
      app.one('input[data-genbank-to-records]', 'the Records field');
      // the Bakta-only options are not shown without Bakta JSON
      expect(app.all('[data-genbank-to-gram], [data-genbank-to-table]')).toHaveLength(0);

      await chooseFile(app, 'oracle.gbk', new TextEncoder().encode(ORACLE));
      await app.change(output(app, 'proteins'), true);
      await app.change(output(app, 'functions'), true);
      await convert(app);
      expect(calls(), 'Convert calls the RPC once').toHaveLength(1);
      const sent = calls()[0];
      expect(Object.keys(sent).sort()).toEqual(
        ['baseName', 'complexHeaders', 'gram', 'includePseudogenes', 'outputs', 'records', 'separate', 'source', 'translationTable']
      );
      expect(sent).toMatchObject({ baseName: 'oracle', outputs: ['proteins', 'functions'], gram: null, translationTable: null, separate: false, records: [] });
      expect(new TextDecoder().decode(new Uint8Array((sent.source as { bytes: number[] }).bytes))).toBe(ORACLE);
      const saved = app.downloads();
      expect(saved.map((f) => f.filename), 'one save, the zip').toEqual(['oracle.genbank_to.zip']);
      expect((await saved[0].text()).slice(0, 4)).toBe('PK\u0003\u0004');
      expect(words(app.one('[data-genbank-to-saved]').textContent)).toBe('Saved oracle.genbank_to.zip (2 files).');
      expect(warningsShown(app)).toContain(NO_VERSION_WARNING);

      // Proteins alone: one file, genbank_to 0.54's own text
      await app.change(output(app, 'functions'), false);
      await convert(app);
      expect(calls()).toHaveLength(2);
      const both = app.downloads();
      expect(both.map((f) => f.filename)).toEqual(['oracle.genbank_to.zip', 'oracle.faa']);
      expect(await both[1].text()).toBe(FAA);
    });
  });

  it('reads a gzipped file by its bytes and names its files without .gbk.gz', async () => {
    await withApp(async (app) => {
      await app.menu('file:convert-genbank');
      await chooseFile(app, 'oracle.GBK.gz', new Uint8Array(gzipSync(ORACLE)));
      await app.change(output(app, 'proteins'), true);
      await convert(app);
      expect(calls()[0].baseName).toBe('oracle');
      expect((calls()[0].source as { bytes: number[] }).bytes.slice(0, 2)).toEqual([0x1f, 0x8b]);
      const saved = app.downloads();
      expect(saved.map((f) => f.filename)).toEqual(['oracle.faa']);
      expect(await saved[0].text()).toBe(FAA);
    });
  });

  it('shows Gram stain and Translation table only with Bakta JSON, and sends them only then', async () => {
    await withApp(async (app) => {
      await app.menu('file:convert-genbank');
      await chooseFile(app, 'oracle.gbk', new TextEncoder().encode(ORACLE));
      await app.change(output(app, 'baktaJson'), true);
      const gram = app.one('select[data-genbank-to-gram]', 'the Gram stain choice');
      const table = app.one('select[data-genbank-to-table]', 'the Translation table choice');
      expect(gram.value).toBe('');
      expect(table.value).toBe('11');
      // 0.54's set: 15 and 32 are not offered
      expect(app.all('select[data-genbank-to-table] option').map((o) => o.getAttribute('value'))).not.toContain('15');
      await convert(app);
      expect(calls()[0]).toMatchObject({ outputs: ['baktaJson'], gram: null, translationTable: 11 });
      await app.change(gram, '+');
      await app.change(table, '4');
      await convert(app);
      expect(calls()[1]).toMatchObject({ gram: '+', translationTable: 4 });
      expect(app.downloads().map((f) => f.filename)).toEqual(['oracle.bakta.json', 'oracle.bakta.json']);
      const genome = JSON.parse(await app.downloads()[1].text()) as { genome: { gram: string; translation_table: number } };
      expect(genome.genome).toMatchObject({ gram: '+', translation_table: 4 });
      // Bakta JSON cleared: the choices go, and nothing of them is sent
      await app.change(output(app, 'baktaJson'), false);
      expect(app.all('[data-genbank-to-gram], [data-genbank-to-table]')).toHaveLength(0);
      await app.change(output(app, 'proteins'), true);
      await convert(app);
      expect(calls()[2]).toMatchObject({ outputs: ['proteins'], gram: null, translationTable: null });
    });
  });

  it("shows the engine's refusal and saves nothing", async () => {
    await withApp(async (app) => {
      await app.menu('file:convert-genbank');
      await chooseFile(app, 'notes.gb', new TextEncoder().encode('plain prose, no record\n'));
      await convert(app);
      expect(words(app.one('[data-genbank-to-error]').textContent)).toBe('Choose at least one output.');
      await app.change(output(app, 'proteins'), true);
      await convert(app);
      expect(words(app.one('[data-genbank-to-error]').textContent)).toBe('No GenBank record was found in notes.');
      expect(app.downloads()).toHaveLength(0);
    });
  });

  it('converts the active record when a session is open, also from the toolbar Export menu', async () => {
    const { parseGenBank } = await import('../core/fileParsers');
    // the fixture's three records, each ending at its '//' line
    const records = ORACLE.split(/^\/\/[ \t]*\n/m).filter((r) => r.includes('LOCUS')).map((r) => `${r}//\n`);
    const docs = records.map((r, i) => ({ ...parseGenBank(r, 'oracle', '2026-11-19T00:00:00.000Z'), id: `gbk-${i}` }));
    expect(docs.map((d) => d.name)).toHaveLength(3);
    await withApp(async (app) => {
      await app.restoreSession({ documents: docs, activeDocId: docs[1].id, viewerTab: 'sequence-view' });
      const toolbarExport = app.all('button.mbc-tool-btn').filter((b) => words(b.textContent) === 'Export');
      expect(toolbarExport, 'the toolbar Export menu').toHaveLength(1);
      await app.click(toolbarExport[0]);
      await app.click(menuItem(app, 'Annotations'));
      await app.click(menuItem(app, 'Convert GenBank…'));
      expect(app.one('input[data-genbank-to-source="records"]').checked, 'the open record is the source').toBe(true);
      expect(words(dialog(app).textContent)).toContain(`The record ${docs[1].name}`);
      await app.change(output(app, 'proteins'), true);
      await convert(app);
      const sent = calls()[0];
      expect((sent.source as { documents: { id: string }[] }).documents.map((d) => d.id)).toEqual([docs[1].id]);
      expect(sent.baseName).toBe(docs[1].name);
      const saved = app.downloads();
      expect(saved.map((f) => f.filename)).toEqual([`${docs[1].name}.faa`]);
      // OR000002's proteins, as genbank_to wrote them in the whole file's .faa
      const text = await saved[0].text();
      expect(text.length).toBeGreaterThan(0);
      expect(FAA).toContain(text);
      expect(text).not.toBe(FAA);
      expect(text.split('\n').filter((l) => l.startsWith('>'))).toEqual(['>ORP20001.1', '>ORT2_0002']);
    });
  });

  it('converts the records checked in the document table, and the active record alone when none is checked', async () => {
    // D0228: "Source: the selected open records (the active record when none is selected), or a
    // GenBank file chosen from disk." Wrong implementations this catches: the active record sent
    // whatever is checked (the checked pair holds a record that is not active), every open record
    // sent (the second record stays unchecked, and with none checked only the active one may go).
    const { parseGenBank } = await import('../core/fileParsers');
    const records = ORACLE.split(/^\/\/[ \t]*\n/m).filter((r) => r.includes('LOCUS')).map((r) => `${r}//\n`);
    const docs = records.map((r, i) => ({ ...parseGenBank(r, 'oracle', '2026-11-19T00:00:00.000Z'), id: `gbk-${i}` }));
    expect(new Set(docs.map((d) => d.name)).size, 'three records, three names').toBe(3);
    const tick = (app: AppHarness, i: number) =>
      app.one(`input[type="checkbox"][aria-label="Select ${docs[i].name}"]`, `${docs[i].name}'s tick box`);
    const headers = (text: string) => text.split('\n').filter((l) => l.startsWith('>'));
    await withApp(async (app) => {
      await app.restoreSession({ documents: docs, activeDocId: docs[1].id, viewerTab: 'sequence-view' });
      // the restore checks the active record: clear it, then check the first and the third
      await app.change(tick(app, 1), false);
      await app.change(tick(app, 0), true);
      await app.change(tick(app, 2), true);
      expect([0, 1, 2].map((i) => tick(app, i).checked), 'the first and third are checked').toEqual([true, false, true]);

      await openFromFileMenu(app);
      expect(app.one('input[data-genbank-to-source="records"]').checked, 'the checked records are the source').toBe(true);
      expect(words(dialog(app).textContent)).toContain('The 2 selected records');
      await app.change(output(app, 'nucleotides'), true);
      await convert(app);
      expect(calls(), 'Convert calls the RPC once').toHaveLength(1);
      expect((calls()[0].source as { documents: { id: string }[] }).documents.map((d) => d.id)).toEqual([docs[0].id, docs[2].id]);
      const saved = app.downloads();
      expect(saved).toHaveLength(1);
      // the two checked records' nucleotides, and not the unchecked second one
      expect(headers(await saved[0].text())).toEqual(['>OR000001.1', '>OR000003']);
      // the Close button sits in the footer beside Convert
      const close = app.all('button').filter((b) => words(b.textContent) === 'Close' && b.parentElement?.querySelector('[data-genbank-to-convert]'));
      expect(close, 'the dialog Close button').toHaveLength(1);
      await app.click(close[0]);
      expect(app.all('[data-genbank-to-dialog]'), 'the dialog closed').toHaveLength(0);

      // none checked: the active record (the last one checked) is the source, alone
      await app.change(tick(app, 0), false);
      await app.change(tick(app, 2), false);
      expect([0, 1, 2].map((i) => tick(app, i).checked), 'nothing is checked').toEqual([false, false, false]);
      await openFromFileMenu(app);
      expect(app.one('input[data-genbank-to-source="records"]').checked).toBe(true);
      expect(words(dialog(app).textContent)).toContain(`The record ${docs[2].name}`);
      await app.change(output(app, 'nucleotides'), true);
      await convert(app);
      expect(calls()).toHaveLength(2);
      expect((calls()[1].source as { documents: { id: string }[] }).documents.map((d) => d.id)).toEqual([docs[2].id]);
      const second = app.downloads();
      expect(second.map((f) => f.filename)).toEqual([saved[0].filename, `${docs[2].name}.fna`]);
      expect(headers(await second[1].text())).toEqual(['>OR000003']);
    });
  });
});
