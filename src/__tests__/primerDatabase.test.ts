// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  PRIMER_BACKUP_FORMAT,
  PRIMER_DATABASE_KEY,
  PRIMER_DATABASE_SCHEMA,
  activePrimers,
  annealingPortion,
  migratePrimerEnvelope,
  normalizePrimerSequence,
  openPrimerDatabase,
  trashedPrimers,
  type PrimerDatabaseEnv,
  type PrimerStorage,
} from '../core/primerDatabase';
import type { DatabasePrimer } from '../types/bio';

/** A localStorage stand-in that counts writes, so a test can tell "nothing was written". */
class MemoryStorage implements PrimerStorage {
  map = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.map.set(key, String(value));
  }
}

/** Storage whose writes fail the way a full localStorage does (QuotaExceededError). */
class QuotaStorage extends MemoryStorage {
  full = false;
  setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    super.setItem(key, value);
  }
}

function env(storage: PrimerStorage, prefix = 'p'): PrimerDatabaseEnv {
  let tick = 0;
  let n = 0;
  return {
    storage,
    now: () => new Date(Date.UTC(2026, 10, 15, 9, 0, tick++)).toISOString(),
    newId: () => `${prefix}${++n}`,
  };
}

function okValue<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function storedRecords(storage: MemoryStorage): DatabasePrimer[] {
  return JSON.parse(storage.getItem(PRIMER_DATABASE_KEY)!).records;
}

const FULL_INPUT = {
  name: ' EcoRI-fwd ',
  sequence: "5'- gcta tcg\tAATTC cgtacgatcg\n-3'",
  molecule: 'DNA' as const,
  modifications: "5' FAM",
  tail5Prime: 'gcta',
  description: 'Adds an EcoRI site',
  labels: ['cloning', 'pUC19'],
  provenance: 'Entered by hand',
};

describe('Primer Database: records (US-01M7DQVT AC1)', () => {
  it('US-01M7DQVT AC1 normalizes the sequence, keeps every field apart, and returns it identical after a reload', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const rec = okValue(db.add(FULL_INPUT));
    // Wrong implementations this fails on: marks or inner whitespace left in, case kept, the tail
    // folded into the annealing portion, the raw input dropped, or the name kept untrimmed.
    expect(rec).toEqual({
      id: 'p1',
      name: 'EcoRI-fwd',
      sequence: 'GCTATCGAATTCCGTACGATCG',
      originalInput: "5'- gcta tcg\tAATTC cgtacgatcg\n-3'",
      molecule: 'DNA',
      modifications: "5' FAM",
      tail5Prime: 'GCTA',
      description: 'Adds an EcoRI site',
      labels: ['cloning', 'pUC19'],
      createdAt: '2026-11-15T09:00:00.000Z',
      modifiedAt: '2026-11-15T09:00:00.000Z',
      provenance: 'Entered by hand',
    });
    expect(annealingPortion(rec)).toBe('TCGAATTCCGTACGATCG');
    // One versioned key of its own; a fresh handle (a restart) reads the same record back.
    expect([...storage.map.keys()]).toEqual([PRIMER_DATABASE_KEY]);
    const reloaded = openPrimerDatabase({ storage }).read();
    expect(reloaded).toEqual({ ok: true, stored: true, records: [rec] });
  });

  it('US-01M7DQVT AC1 an RNA record keeps U, a DNA record keeps T, and IUPAC codes are allowed', () => {
    expect(normalizePrimerSequence('acgu ugca', 'RNA')).toEqual({ ok: true, sequence: 'ACGUUGCA', molecule: 'RNA' });
    expect(normalizePrimerSequence('acgt tgca', 'DNA')).toEqual({ ok: true, sequence: 'ACGTTGCA', molecule: 'DNA' });
    // With no molecule given, U means RNA and anything else DNA; neither base is ever rewritten.
    expect(normalizePrimerSequence('ACGU')).toEqual({ ok: true, sequence: 'ACGU', molecule: 'RNA' });
    expect(normalizePrimerSequence('ACGT')).toEqual({ ok: true, sequence: 'ACGT', molecule: 'DNA' });
    expect(normalizePrimerSequence('acgtrysWKMbdhvn', 'DNA')).toEqual({
      ok: true,
      sequence: 'ACGTRYSWKMBDHVN',
      molecule: 'DNA',
    });
    // A DNA record holding U, or an RNA record holding T, is refused rather than silently converted.
    const dnaWithU = normalizePrimerSequence('ACGU', 'DNA');
    expect(dnaWithU.ok).toBe(false);
    if (!dnaWithU.ok) expect(dnaWithU.reason).toMatch(/DNA.*U/);
    const rnaWithT = normalizePrimerSequence('ACGT', 'RNA');
    expect(rnaWithT.ok).toBe(false);
    if (!rnaWithT.ok) expect(rnaWithT.reason).toMatch(/RNA.*T/);
    const storage = new MemoryStorage();
    const rna = okValue(openPrimerDatabase(env(storage)).add({ name: 'guide', sequence: "5'-gcu agc-3'", molecule: 'RNA' }));
    expect(rna.sequence).toBe('GCUAGC');
    expect(rna.molecule).toBe('RNA');
  });

  it('US-01M7DQVT AC1 a sequence holding both T and U is refused with a reason and is not stored', () => {
    const storage = new MemoryStorage();
    const result = openPrimerDatabase(env(storage)).add({ name: 'mixed', sequence: 'ACGTU' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid');
    expect(result.error.fields).toEqual([{ field: 'sequence', reason: expect.stringMatching(/both T and U/) }]);
    expect(storage.writes).toBe(0);
  });
});

describe('Primer Database: add, edit, trash and restore (US-01M7DQVT AC2)', () => {
  it('US-01M7DQVT AC2 editing keeps the id and creation time and changes only the edited fields and the modified time', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const before = okValue(db.add(FULL_INPUT));
    const edited = okValue(db.edit(before.id, { description: 'Adds an EcoRI site for pUC19' }));
    // Wrong implementations: a rebuilt record with a new id or creation time, or edit fields left
    // out of the change (labels, tail, modifications) reset to their defaults.
    expect(edited.changedFields).toEqual(['description']);
    expect(edited.record).toEqual({
      ...before,
      description: 'Adds an EcoRI site for pUC19',
      modifiedAt: '2026-11-15T09:00:01.000Z',
    });
    expect(storedRecords(storage)).toEqual([edited.record]);

    const reseq = okValue(db.edit(before.id, { sequence: 'gcta TCGAATTCCGTACGATCC' }));
    expect(reseq.changedFields).toEqual(['sequence', 'originalInput']);
    expect(reseq.record).toEqual({
      ...edited.record,
      sequence: 'GCTATCGAATTCCGTACGATCC',
      originalInput: 'gcta TCGAATTCCGTACGATCC',
      modifiedAt: '2026-11-15T09:00:02.000Z',
    });

    // An edit that changes nothing writes nothing and keeps the modified time.
    const writes = storage.writes;
    const same = okValue(db.edit(before.id, { name: 'EcoRI-fwd', labels: ['cloning', 'pUC19'] }));
    expect(same.changedFields).toEqual([]);
    expect(same.record).toEqual(reseq.record);
    expect(storage.writes).toBe(writes);
  });

  it('US-01M7DQVT AC2 a trashed record is hidden from the active list, still stored, and comes back unchanged on restore', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const a = okValue(db.add({ name: 'A', sequence: 'ACGTACGTAC', labels: ['x'] }));
    const b = okValue(db.add({ name: 'B', sequence: 'TTTTGGGGCC' }));
    const trashed = okValue(db.trash(a.id));
    expect(trashed.id).toBe(a.id);
    expect(trashed.trashedAt).toBeTruthy();
    const read = openPrimerDatabase({ storage }).read();
    if (!read.ok) throw new Error('unreadable');
    expect(activePrimers(read.records)).toEqual([b]);
    expect(trashedPrimers(read.records)).toEqual([trashed]);
    // Editing a record in the trash is refused, so what restore brings back is what was trashed.
    const editTrashed = db.edit(a.id, { name: 'A2' });
    expect(editTrashed.ok).toBe(false);
    if (!editTrashed.ok) expect(editTrashed.error.kind).toBe('trashed');
    const restored = okValue(db.restore(a.id));
    expect(restored).toEqual(a);
    expect(storedRecords(storage)).toEqual([a, b]);
  });

  it('US-01M7DQVT AC2 only an explicit empty-trash deletes a record, and it deletes nothing active', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const a = okValue(db.add({ name: 'A', sequence: 'ACGTACGTAC' }));
    const b = okValue(db.add({ name: 'B', sequence: 'TTTTGGGGCC' }));
    okValue(db.trash(a.id));
    // A reload keeps the trashed record.
    const reread = openPrimerDatabase({ storage }).read();
    expect(reread.ok && reread.records.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(okValue(db.emptyTrash())).toEqual({ deleted: [a.id] });
    expect(storedRecords(storage)).toEqual([b]);
  });
});

describe('Primer Database: validation (US-01M7DQVT AC3)', () => {
  it('US-01M7DQVT AC3 an invalid name is refused with a field-level reason and nothing is written', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    for (const name of ['', '   ', 'two\nlines']) {
      const result = db.add({ name, sequence: 'ACGTACGT' });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe('invalid');
      expect(result.error.fields).toEqual([{ field: 'name', reason: expect.any(String) }]);
    }
    expect(storage.writes).toBe(0);
  });

  it('US-01M7DQVT AC3 an invalid sequence or tail is refused with a field-level reason and nothing is written', () => {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const kept = okValue(db.add({ name: 'kept', sequence: 'ACGTACGT' }));
    const raw = storage.getItem(PRIMER_DATABASE_KEY);
    const writes = storage.writes;

    const bad = db.add({ name: 'bad', sequence: 'ACGXTZ' });
    expect(!bad.ok && bad.error.fields).toEqual([{ field: 'sequence', reason: expect.stringMatching(/X.*Z/) }]);
    const empty = db.add({ name: 'empty', sequence: " 5'- -3' " });
    expect(!empty.ok && empty.error.fields).toEqual([{ field: 'sequence', reason: expect.stringMatching(/empty/i) }]);
    const idt = db.add({ name: 'phos', sequence: '/5Phos/ACGTACGT' });
    expect(!idt.ok && idt.error.fields).toEqual([{ field: 'sequence', reason: expect.stringMatching(/modification/i) }]);
    const both = db.add({ name: ' ', sequence: 'AC GT!' });
    expect(!both.ok && both.error.fields.map((f) => f.field)).toEqual(['name', 'sequence']);
    const tail = db.add({ name: 'tail', sequence: 'ACGTACGT', tail5Prime: 'GG' });
    expect(!tail.ok && tail.error.fields).toEqual([{ field: 'tail5Prime', reason: expect.stringMatching(/start/) }]);
    const allTail = db.add({ name: 'tail', sequence: 'ACGTACGT', tail5Prime: 'acgtacgt' });
    expect(!allTail.ok && allTail.error.fields.map((f) => f.field)).toEqual(['tail5Prime']);
    // An edit to an invalid value is refused too, and the stored record is untouched.
    const badEdit = db.edit(kept.id, { sequence: 'ACGTU' });
    expect(!badEdit.ok && badEdit.error.fields.map((f) => f.field)).toEqual(['sequence']);

    expect(storage.writes).toBe(writes);
    expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(raw);
  });
});

describe('Primer Database: backup (US-01M7DQVT AC4)', () => {
  function seeded() {
    const storage = new MemoryStorage();
    const db = openPrimerDatabase(env(storage));
    const a = okValue(db.add(FULL_INPUT));
    const b = okValue(db.add({ name: 'B', sequence: 'acgu', molecule: 'RNA', labels: ['rna'] }));
    const c = okValue(db.add({ name: 'C', sequence: 'TTTTGGGGCC', modifications: '3\' BHQ-1' }));
    const cTrashed = okValue(db.trash(c.id));
    return { storage, db, a, b, cTrashed };
  }

  it('US-01M7DQVT AC4 export writes a versioned backup that an empty store restores record for record', () => {
    const { db, a, b, cTrashed } = seeded();
    const text = okValue(db.exportBackup());
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(PRIMER_BACKUP_FORMAT);
    expect(parsed.schema).toBe(PRIMER_DATABASE_SCHEMA);
    const target = new MemoryStorage();
    const summary = okValue(openPrimerDatabase(env(target, 'q')).importBackup(text));
    expect(summary).toEqual({ added: [a.id, b.id, cTrashed.id], replaced: [], unchanged: [], conflicts: [] });
    // Same ids, modifications, tail, labels and trash state: the records are identical.
    expect(storedRecords(target)).toEqual([a, b, cTrashed]);
  });

  it('US-01M7DQVT AC4 a restore into a non-empty store adds new ids, lists a differing record and keeps it, and deletes nothing', () => {
    const { db, a, b, cTrashed } = seeded();
    const backup = okValue(db.exportBackup());
    const target = new MemoryStorage();
    const tdb = openPrimerDatabase(env(target, 'q'));
    // The target holds its own record (q1) and an edited copy of A under A's id.
    const own = okValue(tdb.add({ name: 'own', sequence: 'GGGGAAAACC' }));
    const aEdited: DatabasePrimer = { ...a, labels: ['edited here'], modifiedAt: '2026-11-16T00:00:00.000Z' };
    target.setItem(PRIMER_DATABASE_KEY, JSON.stringify({ schema: 1, records: [own, aEdited] }));

    const summary = okValue(tdb.importBackup(backup));
    expect(summary.added).toEqual([b.id, cTrashed.id]);
    expect(summary.replaced).toEqual([]);
    expect(summary.conflicts).toEqual([{ id: a.id, stored: aEdited, incoming: a }]);
    expect(storedRecords(target)).toEqual([own, aEdited, b, cTrashed]);

    // Importing again changes nothing; the conflict is still listed, never applied silently.
    const again = okValue(tdb.importBackup(backup));
    expect(again).toEqual({ added: [], replaced: [], unchanged: [b.id, cTrashed.id], conflicts: [{ id: a.id, stored: aEdited, incoming: a }] });

    // Only an explicit choice replaces the stored record, and the target's own record stays.
    const chosen = okValue(tdb.importBackup(backup, { replace: [a.id] }));
    expect(chosen.replaced).toEqual([a.id]);
    expect(chosen.conflicts).toEqual([]);
    expect(storedRecords(target)).toEqual([own, a, b, cTrashed]);
  });

  it('US-01M7DQVT AC4 a malformed or future-schema backup is refused with a reason and leaves the store unchanged', () => {
    const { storage, db, a } = seeded();
    const raw = storage.getItem(PRIMER_DATABASE_KEY);
    const writes = storage.writes;
    const fresh = { ...a, id: 'brand-new' };
    const cases: Array<[string, string]> = [
      ['not json {', 'malformed'],
      [JSON.stringify({ schema: 1, records: [fresh] }), 'malformed'], // no backup format marker
      [JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [fresh, { id: 'x' }] }), 'malformed'],
      [JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [fresh, { ...fresh, id: 'other', sequence: 'ACGTU' }] }), 'malformed'],
      [JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [fresh, fresh] }), 'malformed'],
      [JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 2, records: [fresh] }), 'futureSchema'],
    ];
    for (const [text, kind] of cases) {
      const result = db.importBackup(text, { replace: 'all' });
      expect(result.ok, text).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind, text).toBe(kind);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    // No partial import: the valid first record of a refused backup was not added.
    expect(storage.writes).toBe(writes);
    expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(raw);
  });
});

describe('Primer Database: envelope, unreadable store and failed writes (US-01M7DQVT AC5)', () => {
  it('US-01M7DQVT AC5 the store is a schema 1 envelope read through one migration entry point', () => {
    const storage = new MemoryStorage();
    const rec = okValue(openPrimerDatabase(env(storage)).add({ name: 'A', sequence: 'ACGT' }));
    expect(JSON.parse(storage.getItem(PRIMER_DATABASE_KEY)!)).toEqual({ schema: 1, records: [rec] });
    expect(PRIMER_DATABASE_SCHEMA).toBe(1);
    expect(migratePrimerEnvelope({ schema: 1, records: [rec] })).toEqual({ ok: true, records: [rec] });
    const future = migratePrimerEnvelope({ schema: 2, records: [] });
    expect(!future.ok && future.error.kind).toBe('futureSchema');
    for (const value of [null, [], { records: [] }, { schema: 0, records: [] }, { schema: 1, records: {} }]) {
      const result = migratePrimerEnvelope(value);
      expect(!result.ok && result.error.kind, JSON.stringify(value)).toBe('malformed');
    }
    // A missing key is an empty database; it is told apart from an unreadable one.
    expect(openPrimerDatabase({ storage: new MemoryStorage() }).read()).toEqual({ ok: true, stored: false, records: [] });
  });

  it('US-01M7DQVT AC5 an unreadable stored value is reported by name, never read as empty, and only an explicit choice replaces it', () => {
    const cases: Array<[string, string]> = [
      ['{"schema":1,"records":[', 'malformed'],
      ['', 'malformed'],
      ['{"schema":1,"records":[{"id":"x"}]}', 'malformed'],
      ['{"schema":2,"records":[]}', 'futureSchema'],
    ];
    for (const [stored, kind] of cases) {
      const storage = new MemoryStorage();
      storage.setItem(PRIMER_DATABASE_KEY, stored);
      storage.writes = 0;
      const db = openPrimerDatabase(env(storage));
      const read = db.read();
      expect(read.ok, stored).toBe(false);
      if (read.ok) continue;
      expect(read.error.kind).toBe(kind);
      expect(read.error.message).toContain(PRIMER_DATABASE_KEY);
      expect(read.error.storedValue).toBe(stored);
      // Every write, and an export, is refused with the same report, and the stored value is untouched.
      const attempts = [
        db.add({ name: 'A', sequence: 'ACGT' }),
        db.edit('x', { name: 'B' }),
        db.trash('x'),
        db.restore('x'),
        db.emptyTrash(),
        db.importBackup(JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [] })),
        db.exportBackup(),
      ];
      for (const attempt of attempts) {
        expect(!attempt.ok && attempt.error.kind, stored).toBe(kind);
      }
      // A choice made against a value that is no longer the stored one changes nothing.
      expect(db.discardUnreadable('something else').ok).toBe(false);
      expect(storage.writes).toBe(0);
      expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(stored);
      // The explicit choice starts an empty database, after which writes work.
      expect(db.discardUnreadable(stored).ok).toBe(true);
      expect(db.read()).toEqual({ ok: true, stored: true, records: [] });
      expect(db.add({ name: 'A', sequence: 'ACGT' }).ok).toBe(true);
    }
    // There is nothing to discard in a readable store.
    const fine = new MemoryStorage();
    const fineDb = openPrimerDatabase(env(fine));
    okValue(fineDb.add({ name: 'A', sequence: 'ACGT' }));
    expect(fineDb.discardUnreadable(fine.getItem(PRIMER_DATABASE_KEY)!).ok).toBe(false);
    expect(storedRecords(fine)).toHaveLength(1);
  });

  it('US-01M7DQVT AC5 a write that fails reports the change was not saved and leaves the previous store intact', () => {
    const storage = new QuotaStorage();
    const db = openPrimerDatabase(env(storage));
    const a = okValue(db.add({ name: 'A', sequence: 'ACGTACGT' }));
    const raw = storage.getItem(PRIMER_DATABASE_KEY);
    storage.full = true;
    const attempts = [
      db.add({ name: 'B', sequence: 'ACGT' }),
      db.edit(a.id, { name: 'A2' }),
      db.trash(a.id),
      db.importBackup(JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [{ ...a, id: 'z' }] })),
    ];
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      if (attempt.ok) continue;
      expect(attempt.error.kind).toBe('notSaved');
      expect(attempt.error.message).toMatch(/not saved/);
      expect(attempt.error.message).toMatch(/QuotaExceededError|quota/i);
    }
    expect(storage.getItem(PRIMER_DATABASE_KEY)).toBe(raw);
    expect(openPrimerDatabase({ storage }).read()).toEqual({ ok: true, stored: true, records: [a] });

    // Storage that drops a write without throwing is caught by reading it back.
    const silent = new MemoryStorage();
    silent.setItem = () => {};
    const dropped = openPrimerDatabase(env(silent)).add({ name: 'A', sequence: 'ACGT' });
    expect(!dropped.ok && dropped.error.kind).toBe('notSaved');

    // Storage that cannot be read at all is reported as unavailable, and nothing is written.
    const blocked = new MemoryStorage();
    blocked.getItem = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const bdb = openPrimerDatabase(env(blocked));
    const bread = bdb.read();
    expect(!bread.ok && bread.error.kind).toBe('unavailable');
    const badd = bdb.add({ name: 'A', sequence: 'ACGT' });
    expect(!badd.ok && badd.error.kind).toBe('unavailable');
    expect(blocked.writes).toBe(0);
  });
});

describe('Primer Database: two tabs share one store (US-01M7DQVT AC6)', () => {
  it('US-01M7DQVT AC6 a record another tab added after this tab read is kept by every kind of write', () => {
    const storage = new MemoryStorage();
    const tabA = openPrimerDatabase(env(storage, 'a'));
    const tabB = openPrimerDatabase(env(storage, 'b'));
    const mine = okValue(tabB.add({ name: 'mine', sequence: 'ACGTACGT' }));
    expect(tabB.read().ok).toBe(true); // tab B has read the store before tab A writes
    const theirs = okValue(tabA.add({ name: 'theirs', sequence: 'GGGGCCCC' }));
    // Each of tab B's writes keeps tab A's record (a tab caching its first read would drop it).
    const added = okValue(tabB.add({ name: 'mine too', sequence: 'TTTTAAAA' }));
    expect(storedRecords(storage).map((r) => r.id)).toEqual([mine.id, theirs.id, added.id]);
    const theirs2 = okValue(tabA.add({ name: 'theirs 2', sequence: 'CCCCAAAA' }));
    okValue(tabB.edit(mine.id, { description: 'edited in B' }));
    expect(storedRecords(storage).map((r) => r.id)).toContain(theirs2.id);
    const theirs3 = okValue(tabA.add({ name: 'theirs 3', sequence: 'CCCCGGGG' }));
    okValue(tabB.trash(mine.id));
    expect(storedRecords(storage).map((r) => r.id)).toContain(theirs3.id);
    const theirs4 = okValue(tabA.add({ name: 'theirs 4', sequence: 'AAAAGGGG' }));
    okValue(tabB.emptyTrash());
    const theirs5 = okValue(tabA.add({ name: 'theirs 5', sequence: 'AAAACCCC' }));
    const fromBackup = { ...theirs, id: 'from-backup' };
    okValue(tabB.importBackup(JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: 1, records: [fromBackup] })));
    expect(storedRecords(storage).map((r) => r.id)).toEqual([
      theirs.id,
      added.id,
      theirs2.id,
      theirs3.id,
      theirs4.id,
      theirs5.id,
      'from-backup',
    ]);
  });
});
