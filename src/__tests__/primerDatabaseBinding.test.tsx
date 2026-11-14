// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DQMY: find where stored primers bind on a sequence and add them as annotations, previewed
 * and undoable, without touching the bases. Every criterion is exercised through the App: the menu
 * items a user clicks, the dialogs and the studio tab they read, Edit > Undo, and the session file
 * File > Save writes (read back through the .mbc parser, then restored and saved again).
 *
 * Each check names the wrong implementation it fails on.
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { openPrimerDatabase, type DatabasePrimerInput } from '../core/primerDatabase';
import type { PrimerRecord, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 60_000 });

// ─── Records built in the test ───

/** Deterministic letters (LCG), so every run reads the same sequence. */
function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[Math.floor((s / 2 ** 32) * 4)];
  }
  return out;
}
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revcomp = (s: string) => [...s].reverse().map((c) => COMP[c]).join('');
const otherBase = (c: string) => (c === 'A' ? 'C' : 'A');

const BASE = lettersFrom(0x1d6a, 400);
/** Bases 51..70: a forward site; a copy with its 5'-most base changed sits at 301..320. */
const FWD_ANNEAL = BASE.slice(50, 70);
const FWD_ONE_MM = otherBase(FWD_ANNEAL[0]) + FWD_ANNEAL.slice(1);
const TARGET_SEQ = BASE.slice(0, 300) + FWD_ONE_MM + BASE.slice(320);
const TAIL = 'GGATCCAAAA';
const T7_DOC_SEQ = TARGET_SEQ.slice(230, 250);
const T7_DB_SEQ = TARGET_SEQ.slice(260, 280);
const TARGET2_SEQ = (() => {
  const b = lettersFrom(0x2b2b, 300);
  return b.slice(0, 100) + FWD_ANNEAL + b.slice(120);
})();

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', features: [], primers: [], history: [],
};
const docPrimer = (id: string, name: string, sequence: string, bindStart: number): PrimerRecord => ({
  id, name, sequence, annealSequence: sequence, tail5Prime: '', bindStart, bindEnd: bindStart + sequence.length - 1, strand: 1,
  length: sequence.length, gcPercent: 50, tmAnnealC: 60, tmFullC: 60, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true,
});
/** The document primer already on the target: a "T7" of its own, at 231..250. */
const EXISTING = docPrimer('mqmy-existing', 'T7', T7_DOC_SEQ, 231);
const TARGET: SequenceDocument = {
  ...BLANK, id: 'mqmy-target', name: 'pMQMY_Target', accession: 'MQMY_0001', description: 'A linear target built in the test',
  sequence: TARGET_SEQ,
  features: [{ id: 'f-mqmy', name: 'MqmyGene', type: 'CDS', start: 20, end: 380, strand: 1, color: '#d93025' }],
  primers: [EXISTING],
};
const TARGET2: SequenceDocument = {
  ...BLANK, id: 'mqmy-target2', name: 'pMQMY_Second', accession: 'MQMY_0002', description: 'A second target', sequence: TARGET2_SEQ,
};
/** A primer document named T7, as the Primers folder holds one. */
const PRIMER_DOC: SequenceDocument = {
  ...BLANK, id: 'mqmy-primer-doc', name: 'T7', accession: 'MQMY_P1', description: 'A primer document', sequence: T7_DOC_SEQ,
  documentKind: 'primer', folder: 'Primers' as SequenceDocument['folder'],
};

const FWD_TAILED: DatabasePrimerInput = { name: 'Fwd-tailed', sequence: TAIL + FWD_ANNEAL, tail5Prime: TAIL };
const REV: DatabasePrimerInput = { name: 'Rev-primer', sequence: revcomp(TARGET_SEQ.slice(200, 220)) };
const T7_DB: DatabasePrimerInput = { name: 'T7', sequence: T7_DB_SEQ };
const RNA: DatabasePrimerInput = { name: 'guide-rna', sequence: TARGET_SEQ.slice(100, 120).replace(/T/g, 'U'), molecule: 'RNA' };
const MODIFIED: DatabasePrimerInput = { name: 'phos-primer', sequence: TARGET_SEQ.slice(130, 150), modifications: '/5Phos/' };
const DEGENERATE: DatabasePrimerInput = {
  name: 'deg-primer',
  sequence: TARGET_SEQ.slice(160, 163) + 'N' + TARGET_SEQ.slice(164, 170) + 'R' + TARGET_SEQ.slice(171, 180),
};
/** Seeded in this order, so their ids are seed-1 .. seed-6. */
const STORE = [FWD_TAILED, REV, T7_DB, RNA, MODIFIED, DEGENERATE];

function seededStorage(inputs: DatabasePrimerInput[] = STORE): LiveStorage {
  const storage = memoryStorage();
  let n = 0;
  const db = openPrimerDatabase({ storage, now: () => '2026-11-15T09:00:00.000Z', newId: () => `seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input);
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}

async function withSession(storage: LiveStorage, viewerTab: 'sequence-view' | 'primers-pcr', run: (app: AppHarness) => Promise<void>) {
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: [TARGET, TARGET2, PRIMER_DOC], activeDocId: TARGET.id, viewerTab });
    await run(app);
  } finally {
    app.unmount();
  }
}

/** This launch's engine and session format, loaded after the App. */
async function engine() {
  return { bio: await import('../core/bioEngine'), mbc: await import('../core/mbcSessionFormat'), runners: await import('../core/operationRunners') };
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function clickMenuPath(app: AppHarness, path: string[]): Promise<void> {
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
}

function dialogTitled(app: AppHarness, operationId: string): LiveElement {
  const dialog = app.one(`#opdlg-${operationId}`, `the ${operationId} dialog title`).closest('dialog, [role="dialog"]');
  if (!dialog) throw new Error(`the ${operationId} dialog is not open`);
  return dialog;
}
const bindingDialog = (app: AppHarness) => dialogTitled(app, 'primer-database-binding');
const savedPrimersDialog = (app: AppHarness) => dialogTitled(app, 'test-saved-primers');

function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}`);
  return found[0];
}
/** The checkbox of the row in `group` whose first text is `label`. */
function checkIn(scope: LiveElement, group: string, label: string, nth = 0): LiveElement {
  const g = scope.querySelectorAll(`[role="group"][aria-label="${group}"]`)[0];
  if (!g) throw new Error(`no group "${group}"`);
  const rows = g.querySelectorAll('label').filter((l) => words(l.querySelectorAll('span')[0]?.textContent) === label);
  if (!rows[nth]) throw new Error(`no "${label}" in "${group}": ${g.querySelectorAll('label').map((l) => words(l.textContent)).join(' | ')}`);
  return rows[nth].querySelectorAll('input')[0];
}
const checklist = (scope: LiveElement, group: string) =>
  scope.querySelectorAll(`[role="group"][aria-label="${group}"] label`).map((l) => l.querySelectorAll('span').map((s) => words(s.textContent)));

/** The preview's rows, cell by cell, without the Add checkbox. */
const previewRows = (app: AppHarness) =>
  bindingDialog(app)
    .querySelectorAll('table[aria-label="Binding sites found"] tbody tr')
    .map((tr) => {
      const cells = tr.querySelectorAll('td').map((td) => words(td.textContent));
      return cells.length === 1 ? cells : cells.slice(1);
    });
/** Clicks a dialog's run button: the dialog runs after a short pause that lets it show Running…, on the App's fake timers. */
async function run(app: AppHarness, scope: LiveElement, name: string): Promise<void> {
  await app.click(button(scope, name));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await app.settle();
}
const notSearched = (scope: LiveElement) => scope.querySelectorAll('[aria-label="Primers not searched"] li').map((li) => words(li.textContent));

async function openBindingDialog(app: AppHarness, records: string[]): Promise<LiveElement> {
  await clickMenuPath(app, ['Cloning', 'Primers', 'Design Primers', 'Find Where Stored Primers Bind…']);
  const dialog = bindingDialog(app);
  for (const name of records) await app.change(checkIn(dialog, 'Stored primers to search for', name), true);
  return bindingDialog(app);
}

/** The session as File > Save writes it, read back through the .mbc parser. */
async function savedDocuments(app: AppHarness): Promise<SequenceDocument[]> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files, 'the session saved as a file').toHaveLength(1);
  const { mbc } = await engine();
  return mbc.parseMbcWorkbench(await files[0].text()).envelope.documents;
}
const docIn = (docs: SequenceDocument[], id: string) => {
  const d = docs.find((x) => x.id === id);
  if (!d) throw new Error(`${id} is not in the saved session`);
  return d;
};
const sites = (d: SequenceDocument) => d.primers.map((p) => `${p.name} ${p.bindStart}..${p.bindEnd} ${p.strand}`);

/** The studio's saved-primer tab rows: name, source, sequence, strand, coordinates, mismatches, Tm. */
async function studioRows(app: AppHarness): Promise<string[][]> {
  const tab = app.canvas().querySelectorAll('button[role="tab"]').find((b) => /^Test with Saved Primers \(/.test(words(b.textContent)));
  if (!tab) throw new Error('no Test with Saved Primers tab');
  await app.click(tab);
  return app.canvas().querySelectorAll('tr[data-primer-key]').map((tr) => tr.querySelectorAll('td').map((td) => words(td.textContent)));
}

const MATCH_1 = "≤ 1 mismatches, exact 3' clamp of 5";
const SETTINGS_1 = "Match: up to 1 mismatch outside an exact 3' clamp of 5 bases.";

// ─── AC1 ───

describe('Find Where Stored Primers Bind previews every site (US-01M7DQMY AC1)', () => {
  // Wrong implementations: binding on the whole oligo, tail included (no 51..70 site); dropping the
  // reverse strand (no 201..220 row); ignoring the mismatch setting (301..320 still listed at 0);
  // adding before the preview (the target's primers change on Cancel).
  it('US-01M7DQMY AC1 lists each forward and reverse site with position, strand, mismatches and the match settings, binding a tailed record on its annealing portion, before anything is added', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      const dialog = await openBindingDialog(app, ['Fwd-tailed', 'Rev-primer']);
      const { bio } = await engine();
      const tmOf = (anneal: string, start: number) => {
        const hit = bio.testSavedPrimersOnSequence(TARGET_SEQ, [docPrimer('x', 'x', anneal, 1)], 1).find((h) => h.bindStart === start);
        if (!hit) throw new Error(`the engine finds no site at ${start}`);
        return `${hit.effectiveTmC.toFixed(1)} °C`;
      };
      expect(previewRows(app)).toEqual([
        ['Fwd-tailed', 'Primer Database', 'pMQMY_Target', 'Forward (+)', '51..70', '0', tmOf(FWD_ANNEAL, 51), MATCH_1],
        ['Rev-primer', 'Primer Database', 'pMQMY_Target', 'Reverse (-)', '201..220', '0', tmOf(REV.sequence, 201), MATCH_1],
        ['Fwd-tailed', 'Primer Database', 'pMQMY_Target', 'Forward (+)', '301..320', '1', tmOf(FWD_ANNEAL, 301), MATCH_1],
      ]);
      expect(words(dialog.querySelectorAll('[data-match-settings]')[0]?.textContent)).toContain(SETTINGS_1);
      expect(words(dialog.querySelectorAll('[data-match-settings]')[0]?.textContent)).toContain("the 3'-terminal 5 bases must match exactly");
      // The tailed record says where it binds.
      expect(checklist(dialog, 'Stored primers to search for').find((r) => r[0] === 'Fwd-tailed')?.[1]).toBe("30 nt, binds on its last 20 (5' tail 10 nt)");

      // A second target is searched too, and the mismatch setting is the one shown and used.
      await app.change(checkIn(dialog, 'Target documents', 'pMQMY_Second'), true);
      await app.change(bindingDialog(app).querySelectorAll('#opdlg-pb-mm')[0], '0');
      expect(previewRows(app).map((r) => [r[0], r[2], r[4], r[5], r[7]])).toEqual([
        ['Fwd-tailed', 'pMQMY_Target', '51..70', '0', "≤ 0 mismatches, exact 3' clamp of 5"],
        ['Rev-primer', 'pMQMY_Target', '201..220', '0', "≤ 0 mismatches, exact 3' clamp of 5"],
        ['Fwd-tailed', 'pMQMY_Second', '101..120', '0', "≤ 0 mismatches, exact 3' clamp of 5"],
      ]);

      // Nothing is added by the preview.
      await app.click(button(bindingDialog(app), 'Cancel'));
      const saved = await savedDocuments(app);
      expect(sites(docIn(saved, TARGET.id))).toEqual(['T7 231..250 1']);
      expect(sites(docIn(saved, TARGET2.id))).toEqual([]);
    });
  });
});

describe('Find Where These Bind from the Databases > Primers window (US-01M7DQMY AC1)', () => {
  // Wrong implementations: a window button that opens the dialog with no record chosen, or with
  // every record rather than those the window lists; a button that adds without a preview.
  it('US-01M7DQMY AC1 the window opens the binding preview for the primers it lists, and nothing is added until Add', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      await app.menu('tools:primer-database');
      const win = app.one('[role="dialog"][aria-labelledby="primer-db-title"]', 'the Primer Database window');
      await app.change(win.querySelectorAll('input[aria-label="Search primers"]')[0], 'Rev-');
      expect(win.querySelectorAll('tbody tr').map((tr) => words(tr.querySelectorAll('td')[0].textContent))).toEqual(['Rev-primer']);
      await app.click(button(win, 'Find Where These Bind…'));
      const dialog = bindingDialog(app);
      const ticked = dialog
        .querySelectorAll('[role="group"][aria-label="Stored primers to search for"] label')
        .filter((l) => (l.querySelectorAll('input')[0] as unknown as { checked: boolean }).checked)
        .map((l) => words(l.querySelectorAll('span')[0].textContent));
      expect(ticked).toEqual(['Rev-primer']);
      expect(previewRows(app).map((r) => [r[0], r[2], r[3], r[4], r[5], r[7]])).toEqual([
        ['Rev-primer', 'pMQMY_Target', 'Reverse (-)', '201..220', '0', MATCH_1],
      ]);
      await app.click(button(bindingDialog(app), 'Cancel'));
      expect(sites(docIn(await savedDocuments(app), TARGET.id))).toEqual(['T7 231..250 1']);
    });
  });
});

// ─── AC2 ───

describe('Both Test with Saved Primers surfaces list database primers (US-01M7DQMY AC2)', () => {
  // Wrong implementations: a catalogue keyed by name (one T7 replaces the other); no source label;
  // document primers screened differently from before (their hits differ from the engine's).
  it('US-01M7DQMY AC2 the studio tab lists a database T7 and a document T7 apart, each labelled, and the document primer has the hits it had', async () => {
    await withSession(seededStorage(), 'primers-pcr', async (app) => {
      const rows = await studioRows(app);
      const t7 = rows.filter((r) => r[0] === 'T7').map((r) => [r[1], r[4], r[3], r[5]]);
      expect(t7).toEqual([
        ['Document', '231..250', 'Forward (+)', '0 mm'],
        ['Primer Database', '261..280', 'Forward (+)', '0 mm'],
      ]);
      const header = words(app.canvas().querySelectorAll('h3').map((h) => h.textContent).find((t) => words(t).startsWith('Test with Saved Primers — Screening')));
      expect(header).toBe('Test with Saved Primers — Screening 7 Primers (6 from the Primer Database, 1 from documents) against pMQMY_Target');
      // The document primer's rows are the engine's hits for it, as before this change.
      const { bio } = await engine();
      const before = bio.testSavedPrimersOnSequence(TARGET_SEQ, [EXISTING], 2).map((h) => [
        'T7', 'Document', h.primer.sequence, h.strand === 1 ? 'Forward (+)' : 'Reverse (-)', `${h.bindStart}..${h.bindEnd}`, `${h.mismatches} mm`, `${h.effectiveTmC} °C`,
      ]);
      expect(rows.filter((r) => r[1] === 'Document')).toEqual(before);
    });
  });

  it('US-01M7DQMY AC2 the Test with Saved Primers dialog lists a primer document and a database record of one name, both labelled, and places both', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      await clickMenuPath(app, ['Cloning', 'Primers', 'Design Primers', 'Test with Saved Primers…']);
      const dialog = savedPrimersDialog(app);
      const listed = checklist(dialog, 'Primers to test');
      expect(listed.filter((r) => r[0] === 'T7').map((r) => r[1])).toEqual(['Document', 'Primer Database']);
      // Test only the two T7s.
      for (const r of listed) if (r[0] !== 'T7') await app.change(checkIn(savedPrimersDialog(app), 'Primers to test', r[0]), false);
      await run(app, savedPrimersDialog(app), 'Test');
      const saved = await savedDocuments(app);
      const { runners } = await engine();
      const placed = docIn(saved, TARGET.id).primers.filter((p) => p.notes?.startsWith(runners.SAVED_PRIMER_NOTE));
      expect(placed.map((p) => `${p.name} ${p.bindStart}..${p.bindEnd} ${/Primer Database record T7/.test(p.notes ?? '') ? 'database' : 'document'}`)).toEqual([
        'T7 231..250 document',
        'T7 261..280 database',
      ]);
      // The primer document gets the sites the runner gave it before this change.
      const before = runners.runTestSavedPrimers([TARGET], [PRIMER_DOC], { maxMismatches: 1 }).updated[0].primers
        .filter((p) => p.notes?.startsWith(runners.SAVED_PRIMER_NOTE))
        .map((p) => `${p.bindStart}..${p.bindEnd} ${p.strand} ${p.notes}`);
      expect(placed.filter((p) => !/Primer Database/.test(p.notes ?? '')).map((p) => `${p.bindStart}..${p.bindEnd} ${p.strand} ${p.notes}`)).toEqual(before);
    });
  });
});

// ─── AC3 ───

describe('Adding is one undoable step that never changes the bases (US-01M7DQMY AC3)', () => {
  // Wrong implementations: one undo step per target (one undo leaves pMQMY_Second's primer); undo
  // that clears every primer (the existing T7 goes); adding an unticked site; touching the bases.
  it('US-01M7DQMY AC3 Add creates the ticked sites on two targets as one step, and one Undo removes exactly them, the bases unchanged throughout', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      const dialog = await openBindingDialog(app, ['Fwd-tailed']);
      await app.change(checkIn(dialog, 'Target documents', 'pMQMY_Second'), true);
      const untick = bindingDialog(app).querySelectorAll('input[aria-label="Add Fwd-tailed at 301..320 on pMQMY_Target"]')[0];
      await app.change(untick, false);
      await run(app, bindingDialog(app), 'Add Selected Binding Sites');
      expect(app.all('#opdlg-primer-database-binding')).toHaveLength(0);

      const added = await savedDocuments(app);
      expect(sites(docIn(added, TARGET.id))).toEqual(['T7 231..250 1', 'Fwd-tailed 51..70 1']);
      expect(sites(docIn(added, TARGET2.id))).toEqual(['Fwd-tailed 101..120 1']);
      expect(docIn(added, TARGET.id).sequence).toBe(TARGET_SEQ);
      expect(docIn(added, TARGET2.id).sequence).toBe(TARGET2_SEQ);
      expect(docIn(added, TARGET.id).features).toEqual(TARGET.features);

      (app.doc.activeElement as unknown as { blur?: () => void } | null)?.blur?.();
      await app.menu('edit:undo');
      const undone = await savedDocuments(app);
      expect(sites(docIn(undone, TARGET.id))).toEqual(['T7 231..250 1']);
      expect(sites(docIn(undone, TARGET2.id))).toEqual([]);
      expect(docIn(undone, TARGET.id).sequence).toBe(TARGET_SEQ);
      expect(docIn(undone, TARGET2.id).sequence).toBe(TARGET2_SEQ);

      await app.menu('edit:redo');
      const redone = await savedDocuments(app);
      expect(sites(docIn(redone, TARGET.id))).toEqual(['T7 231..250 1', 'Fwd-tailed 51..70 1']);
      expect(sites(docIn(redone, TARGET2.id))).toEqual(['Fwd-tailed 101..120 1']);
    });
  });
});

// ─── AC4 ───

describe('An added primer keeps its source and snapshot (US-01M7DQMY AC4)', () => {
  // Wrong implementations: keeping only a link to the record (an edit or trash would show through);
  // dropping the fields on save or reopen (the typed session struct without them); the revision of
  // another molecule.
  it('US-01M7DQMY AC4 the record id, its name, sequence and tail as added, and the target revision survive an edit, the trash, save and reopen', async () => {
    const storage = seededStorage();
    await withSession(storage, 'sequence-view', async (app) => {
      await openBindingDialog(app, ['Fwd-tailed']);
      await app.change(bindingDialog(app).querySelectorAll('input[aria-label="Add Fwd-tailed at 301..320 on pMQMY_Target"]')[0], false);
      await run(app, bindingDialog(app), 'Add Selected Binding Sites');

      const db = openPrimerDatabase({ storage });
      const edited = db.edit('seed-1', { name: 'Fwd-renamed', sequence: 'CCCC' + FWD_ANNEAL, tail5Prime: 'CCCC' });
      expect(edited.ok).toBe(true);
      expect(db.trash('seed-1').ok).toBe(true);

      const { sequenceRevision } = await import('../core/restrictionDisplay');
      const expected = {
        kind: 'primerDatabase',
        recordId: 'seed-1',
        name: 'Fwd-tailed',
        sequence: TAIL + FWD_ANNEAL,
        tail5Prime: TAIL,
        molecule: 'DNA',
        modifications: '',
        sequenceRevision: sequenceRevision(TARGET_SEQ, 'linear'),
      };
      const check = (docs: SequenceDocument[]) => {
        const p = docIn(docs, TARGET.id).primers.find((x) => x.name === 'Fwd-tailed');
        expect(p, 'the added primer').toBeTruthy();
        expect(p?.sequence).toBe(TAIL + FWD_ANNEAL);
        expect(p?.tail5Prime).toBe(TAIL);
        expect(p?.source).toMatchObject(expected);
      };
      const saved = await savedDocuments(app);
      check(saved);
      expect(sequenceRevision(TARGET_SEQ, 'linear')).not.toBe(sequenceRevision(TARGET2_SEQ, 'linear'));

      // Reopened and saved again, it is unchanged.
      await app.restoreSession({ documents: saved, activeDocId: TARGET.id, viewerTab: 'sequence-view' });
      const reopened = await savedDocuments(app);
      check(reopened);
    });
  });
});

// ─── AC5 ───

describe('No invented Tm or ΔG for an RNA or modified record (US-01M7DQMY AC5)', () => {
  // Wrong implementation: showing the engine's DNA effective Tm (a number in °C) for the record,
  // and storing no conditions with a derived value.
  const RNA_REASON = 'Tm and ΔG unavailable: it is RNA, and the engine computes DNA nearest-neighbour values only.';
  const MOD_REASON = 'Tm and ΔG unavailable: it carries the modification "/5Phos/", which the engine has no parameters for.';

  it('US-01M7DQMY AC5 the binding preview shows Tm unavailable with the reason, and the added primers store the match method and conditions', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      await openBindingDialog(app, ['guide-rna', 'phos-primer', 'Rev-primer']);
      const rows = previewRows(app);
      expect(rows.map((r) => [r[0], r[4], r[6]])).toEqual([
        ['guide-rna', '101..120', `n/a: ${RNA_REASON}`],
        ['phos-primer', '131..150', `n/a: ${MOD_REASON}`],
        ['Rev-primer', '201..220', expect.stringMatching(/^\d+\.\d °C$/)],
      ]);
      await run(app, bindingDialog(app), 'Add Selected Binding Sites');
      const saved = await savedDocuments(app);
      const byName = (n: string) => docIn(saved, TARGET.id).primers.find((p) => p.name === n);
      for (const [n, reason] of [['guide-rna', RNA_REASON], ['phos-primer', MOD_REASON]] as const) {
        expect(byName(n)?.tmNoAnswerReason).toBe(reason);
        expect(byName(n)?.notes).toContain(`effective Tm unavailable (${reason})`);
        expect(byName(n)?.source?.thermoUnavailableReason).toBe(reason);
        expect(byName(n)?.source?.match).toEqual({
          method: expect.stringContaining("the 3'-terminal 5 bases must match exactly"),
          maxMismatches: 1,
          clamp3PrimeBases: 5,
          mismatches: 0,
        });
      }
      expect(byName('Rev-primer')?.source?.match.tmConditions).toBe(
        'DNA nearest-neighbour Tm at 50 mM Na+, 1.5 mM Mg2+ and 250 nM oligo, less 2.4 °C per mismatch'
      );
    });
  });

  it('US-01M7DQMY AC5 both Test with Saved Primers surfaces show Tm unavailable with the reason for the RNA and modified records', async () => {
    await withSession(seededStorage(), 'primers-pcr', async (app) => {
      const rows = await studioRows(app);
      expect(rows.find((r) => r[0] === 'guide-rna')?.[6]).toBe(`n/a: ${RNA_REASON}`);
      expect(rows.find((r) => r[0] === 'phos-primer')?.[6]).toBe(`n/a: ${MOD_REASON}`);
      expect(words(app.canvas().querySelectorAll('[data-match-settings]')[0]?.textContent)).toContain(
        "Match: up to 2 mismatches outside an exact 3' clamp of 5 bases."
      );

      await clickMenuPath(app, ['Cloning', 'Primers', 'Design Primers', 'Test with Saved Primers…']);
      const listed = checklist(savedPrimersDialog(app), 'Primers to test');
      expect(listed.find((r) => r[0] === 'guide-rna')?.[3]).toBe(RNA_REASON);
      expect(listed.find((r) => r[0] === 'phos-primer')?.[3]).toBe(MOD_REASON);
      await run(app, savedPrimersDialog(app), 'Test');
      const saved = await savedDocuments(app);
      const rna = docIn(saved, TARGET.id).primers.find((p) => p.name === 'guide-rna');
      expect(rna?.tmNoAnswerReason).toBe(RNA_REASON);
      expect(rna?.notes).toContain(`effective Tm unavailable (${RNA_REASON})`);
      expect(rna?.notes).not.toMatch(/\d °C/);
    });
  });
});

// ─── Round 1 repair: an added RNA or modified primer, and the studio's list after a window save ───

describe('An added RNA or modified primer has no invented Tm anywhere (US-01M7DQMY AC5)', () => {
  const RNA_REASON = 'Tm and ΔG unavailable: it is RNA, and the engine computes DNA nearest-neighbour values only.';
  const MOD_REASON = 'Tm and ΔG unavailable: it carries the modification "/5Phos/", which the engine has no parameters for.';

  it('US-01M7DQMY AC5 after Find Where These Bind and Add, the studio tab and the Test with Saved Primers dialog show n/a with the reason for the added primers, never a number', async () => {
    await withSession(seededStorage(), 'sequence-view', async (app) => {
      await openBindingDialog(app, ['guide-rna', 'phos-primer']);
      await run(app, bindingDialog(app), 'Add Selected Binding Sites');
      const added = docIn(await savedDocuments(app), TARGET.id).primers.filter((p) => p.source?.kind === 'primerDatabase');
      expect(added.map((p) => p.name)).toEqual(['guide-rna', 'phos-primer']);
      // Stored in the app's no-answer form: the reason, with numeric placeholders the engine never computed
      // (wrong implementation: the engine's DNA Tm of the U-to-T oligo stored as tmAnnealC).
      for (const p of added) {
        expect([p.tmNoAnswerReason, p.tmAnnealC, p.tmFullC], p.name).toEqual([p.name === 'guide-rna' ? RNA_REASON : MOD_REASON, 0, 0]);
      }

      // The studio's tab screens the added primers as document primers: n/a with the reason, as the records are
      // (wrong implementation: the document candidate's reason set to null, so the engine's DNA Tm shows).
      await app.menu('primers:pcr');
      const rows = await studioRows(app);
      for (const [name, reason] of [['guide-rna', RNA_REASON], ['phos-primer', MOD_REASON]] as const) {
        const mine = rows.filter((r) => r[0] === name);
        expect(mine.map((r) => r[1]).sort(), name).toEqual(['Document', 'Primer Database']);
        for (const r of mine) expect(r[6], `${name} (${r[1]})`).toBe(`n/a: ${reason}`);
      }
      expect(rows.filter((r) => r[0] === 'guide-rna' || r[0] === 'phos-primer').flat().join(' ')).not.toMatch(/\d °C/);

      // The dialog places the records again beside the added primers; none of them carries a number.
      await clickMenuPath(app, ['Cloning', 'Primers', 'Design Primers', 'Test with Saved Primers…']);
      const listed = checklist(savedPrimersDialog(app), 'Primers to test');
      expect(listed.find((r) => r[0] === 'guide-rna')?.[3]).toBe(RNA_REASON);
      expect(listed.find((r) => r[0] === 'phos-primer')?.[3]).toBe(MOD_REASON);
      await run(app, savedPrimersDialog(app), 'Test');
      const after = docIn(await savedDocuments(app), TARGET.id).primers.filter((p) => p.name === 'guide-rna' || p.name === 'phos-primer');
      expect(after.length).toBeGreaterThanOrEqual(4);
      for (const p of after) {
        expect(p.tmNoAnswerReason, `${p.name}: ${p.notes}`).toBe(p.name === 'guide-rna' ? RNA_REASON : MOD_REASON);
        expect(p.notes ?? '', p.name).not.toMatch(/\d °C/);
        expect([p.tmAnnealC, p.tmFullC], p.name).toEqual([0, 0]);
      }
    });
  });
});

describe('A document primer keeps either record of why it has no Tm (US-01M7DQMY AC5)', () => {
  it("US-01M7DQMY AC5 the studio tab shows n/a for a primer whose source alone, or whose own no-answer reason alone, says why", async () => {
    const RNA_REASON = 'Tm and ΔG unavailable: it is RNA, and the engine computes DNA nearest-neighbour values only.';
    const MOD_REASON = 'Tm and ΔG unavailable: it carries the modification "/5Phos/", which the engine has no parameters for.';
    // As a session from another build may hold them: one primer with only its source's reason, one with only its own.
    const sourceOnly: PrimerRecord = {
      ...docPrimer('mqmy-src-only', 'source-only', TARGET_SEQ.slice(100, 120), 101),
      source: {
        kind: 'primerDatabase', recordId: 'rec-x', name: 'source-only', sequence: TARGET_SEQ.slice(100, 120), tail5Prime: '',
        molecule: 'RNA', modifications: '', sequenceRevision: 'rev', thermoUnavailableReason: RNA_REASON,
        match: { method: 'm', maxMismatches: 1, clamp3PrimeBases: 5, mismatches: 0 },
      },
    };
    const reasonOnly: PrimerRecord = { ...docPrimer('mqmy-reason-only', 'reason-only', TARGET_SEQ.slice(130, 150), 131), tmNoAnswerReason: MOD_REASON };
    const app = await mountApp({ storage: seededStorage([]) });
    try {
      const target = { ...TARGET, primers: [EXISTING, sourceOnly, reasonOnly] };
      await app.restoreSession({ documents: [target], activeDocId: target.id, viewerTab: 'primers-pcr' });
      const rows = await studioRows(app);
      // Wrong implementations: only one of the two reasons carried, so the engine's DNA Tm shows for the other.
      expect(rows.filter((r) => r[0] === 'source-only').map((r) => r[6])).toEqual([`n/a: ${RNA_REASON}`]);
      expect(rows.filter((r) => r[0] === 'reason-only').map((r) => r[6])).toEqual([`n/a: ${MOD_REASON}`]);
      expect(rows.filter((r) => r[0] === 'T7').map((r) => r[6])[0]).toMatch(/^\d+(\.\d)? °C$/);
    } finally {
      app.unmount();
    }
  });
});

describe("The studio's tab reads the Primer Database again when the Primers window saves (US-01M7DQMY AC2)", () => {
  it('US-01M7DQMY AC2 a primer added in the Primers window while the studio tab is open is screened without switching tabs', async () => {
    const NEW_SITE = TARGET_SEQ.slice(220, 240);
    await withSession(seededStorage(), 'primers-pcr', async (app) => {
      expect((await studioRows(app)).some((r) => r[0] === 'late-primer')).toBe(false);
      await app.menu('tools:primer-database');
      const win = () => app.one('[role="dialog"][aria-labelledby="primer-db-title"]');
      await app.click(button(win(), 'Add'));
      const form = app.one('form[aria-label="Add primer"]');
      const field = (label: string) => form.querySelectorAll('input').find((f) => f.getAttribute('aria-label') === label)!;
      await app.input(field('Name'), 'late-primer');
      await app.input(field("Sequence (5' → 3')"), NEW_SITE);
      await app.click(button(form, 'Save Primer'));
      await app.click(button(win(), 'Close Primer Database'));
      // Wrong implementation: the list is read only when the sub-tab changes, so the new record is missing.
      const rows = app.canvas().querySelectorAll('tr[data-primer-key]').map((tr) => tr.querySelectorAll('td').map((td) => words(td.textContent)));
      expect(rows.filter((r) => r[0] === 'late-primer').map((r) => [r[1], r[4]])).toEqual([['Primer Database', '221..240']]);
    });
  });
});

// ─── AC6 ───

describe('A degenerate record is listed as not searched (US-01M7DQMY AC6)', () => {
  // Wrong implementation: handing the record to the engine, which matches bytes exactly, and
  // reporting that it binds nowhere.
  const REASON = 'Not searched: the annealing portion holds the IUPAC ambiguity codes N, R, and the engine matches A, C, G and T exactly, so it cannot say where this primer binds.';

  it('US-01M7DQMY AC6 the binding preview and the studio tab list the degenerate record as not searched with the reason, never as binding nowhere', async () => {
    await withSession(seededStorage(), 'primers-pcr', async (app) => {
      const rows = await studioRows(app);
      expect(rows.map((r) => r[0])).not.toContain('deg-primer');
      expect(notSearched(app.canvas())).toEqual([`deg-primer (Primer Database): ${REASON}`]);

      await openBindingDialog(app, ['deg-primer']);
      expect(notSearched(bindingDialog(app))).toEqual([`deg-primer: ${REASON}`]);
      expect(previewRows(app)).toEqual([['No chosen primer was searched.']]);
      expect(words(bindingDialog(app).textContent)).not.toMatch(/No binding site was found for[^.]*deg-primer/);
      // Beside a record that binds nowhere on the second target, only that record is said to bind nowhere.
      await app.change(checkIn(bindingDialog(app), 'Stored primers to search for', 'Rev-primer'), true);
      await app.change(checkIn(bindingDialog(app), 'Target documents', 'pMQMY_Target'), false);
      await app.change(checkIn(bindingDialog(app), 'Target documents', 'pMQMY_Second'), true);
      expect(previewRows(app)).toEqual([['No binding site was found for Rev-primer within 1 mismatches.']]);
      expect(notSearched(bindingDialog(app))).toEqual([`deg-primer: ${REASON}`]);
    });
  });
});
