// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  ENZYME_BACKUP_FORMAT,
  ENZYME_DATABASE_KEY,
  ENZYME_DATABASE_SCHEMA,
  MAX_CUSTOM_MOTIF_LENGTH,
  builtInNameClash,
  openEnzymeDatabase,
  type CustomEnzymeInput,
  type EnzymeDatabaseEnv,
  type EnzymeDbError,
  type EnzymeStorage,
} from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { CustomEnzymeDefinition } from '../types/bio';

/** A localStorage stand-in that counts writes and records the keys written. */
class MemoryStorage implements EnzymeStorage {
  map = new Map<string, string>();
  writes = 0;
  keysWritten: string[] = [];
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.keysWritten.push(key);
    this.map.set(key, String(value));
  }
}

/** Storage whose writes fail the way a full or blocked localStorage does. */
class FailingStorage extends MemoryStorage {
  failWith: DOMException | null = null;
  setItem(key: string, value: string): void {
    if (this.failWith) throw this.failWith;
    super.setItem(key, value);
  }
}

/** Storage that accepts a write without throwing but keeps the old value. */
class ForgetfulStorage extends MemoryStorage {
  forget = false;
  setItem(key: string, value: string): void {
    if (this.forget) {
      this.writes += 1;
      return;
    }
    super.setItem(key, value);
  }
}

function env(storage: EnzymeStorage, prefix = 'e', day = 16): EnzymeDatabaseEnv {
  let tick = 0;
  let n = 0;
  return {
    storage,
    now: () => new Date(Date.UTC(2026, 10, day, 9, 0, tick++)).toISOString(),
    newId: () => `${prefix}${++n}`,
  };
}

function okValue<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf(result: { ok: true } | { ok: false; error: EnzymeDbError }): EnzymeDbError {
  if (result.ok) throw new Error('expected a refusal, got ok');
  return result.error;
}

function storedDefinitions(storage: MemoryStorage): CustomEnzymeDefinition[] {
  return JSON.parse(storage.getItem(ENZYME_DATABASE_KEY)!).definitions;
}

const BSAI_LIKE: CustomEnzymeInput = { name: 'MyBsa', recognitionSeq: 'GGTCTC', cutFwd: 7, cutRev: 11, isTypeIIS: true };

describe('Enzyme database: definitions (US-01M7DVMJ AC1)', () => {
  it('US-01M7DVMJ AC1 keeps every field of a cloned definition and returns it identical after a reload', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const mboi = REBASE_ENZYMES.find((e) => e.name === 'MboI')!;
    const def = okValue(
      db.add({
        name: '  Adaeze MboI ',
        recognitionSeq: ' ga tc ',
        cutFwd: 0,
        cutRev: 4,
        isTypeIIS: false,
        provenance: 'REBASE 1234',
        notes: 'Blocked by Dam, as MboI is',
        methylationSensitivity: mboi.methylationSensitivity,
        clonedFrom: 'mboi',
      }),
    );
    // Wrong implementations this fails on: a field dropped or renamed, a strand field added, the
    // motif kept in lower case or with its spaces, the name kept untrimmed, methylation dropped
    // from a clone, or cloned-from kept as typed rather than as the catalogue's name.
    expect(def).toEqual({
      id: 'e1',
      source: 'custom',
      name: 'Adaeze MboI',
      recognitionSeq: 'GATC',
      cutFwd: 0,
      cutRev: 4,
      isTypeIIS: false,
      methylationSensitivity: ['Dam'],
      clonedFrom: 'MboI',
      provenance: 'REBASE 1234',
      notes: 'Blocked by Dam, as MboI is',
      createdAt: '2026-11-16T09:00:00.000Z',
      modifiedAt: '2026-11-16T09:00:00.000Z',
    });
    expect(Object.keys(def)).not.toContain('strand');
    // One versioned key, and nothing else written.
    expect(new Set(storage.keysWritten)).toEqual(new Set([ENZYME_DATABASE_KEY]));
    expect(JSON.parse(storage.getItem(ENZYME_DATABASE_KEY)!).schema).toBe(ENZYME_DATABASE_SCHEMA);
    // A fresh store over the same storage stands for a restart.
    const reloaded = openEnzymeDatabase(env(storage)).read();
    expect(reloaded).toEqual({ ok: true, definitions: [def], stored: true });
  });

  it('US-01M7DVMJ AC1 leaves methylation empty and cloned-from absent unless set, and refuses an unknown spelling', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const plain = okValue(db.add({ name: 'Plain', recognitionSeq: 'GAATTC', cutFwd: 1, cutRev: 5 }));
    // Wrong implementations: a default sensitivity filled in, cloned-from stored as '' or undefined key.
    expect(plain.methylationSensitivity).toEqual([]);
    expect('clonedFrom' in plain).toBe(false);
    expect(plain.isTypeIIS).toBe(false);
    expect(plain.provenance).toBe('');
    expect(plain.notes).toBe('');
    const before = storage.writes;
    const dam = errorOf(db.add({ name: 'X', recognitionSeq: 'GATC', cutFwd: 0, cutRev: 4, methylationSensitivity: ['dam' as never] }));
    expect(dam.fields.map((f) => f.field)).toContain('methylationSensitivity');
    const nowhere = errorOf(db.add({ name: 'X', recognitionSeq: 'GATC', cutFwd: 0, cutRev: 4, clonedFrom: 'NoSuchEnzyme' }));
    expect(nowhere.fields.map((f) => f.field)).toContain('clonedFrom');
    expect(storage.writes).toBe(before);
  });

  it("US-01M7DVMJ AC1 copies a clone's methylation list, so editing the definition never edits the catalogue", () => {
    const db = openEnzymeDatabase(env(new MemoryStorage()));
    const hpaii = REBASE_ENZYMES.find((e) => e.name === 'HpaII')!;
    const def = okValue(db.add({ name: 'H2', recognitionSeq: 'CCGG', cutFwd: 1, cutRev: 3, methylationSensitivity: hpaii.methylationSensitivity, clonedFrom: 'HpaII' }));
    // Wrong implementation: storing the catalogue's own array, aliased.
    expect(def.methylationSensitivity).not.toBe(hpaii.methylationSensitivity);
    def.methylationSensitivity.push('Dam');
    expect(hpaii.methylationSensitivity).toEqual(['CpG']);
  });

  it('US-01M7DVMJ AC1 refuses a strand field, entered or stored, rather than dropping it', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: ignoring the key, so a bottom-strand motif is silently read as top.
    const entered = errorOf(db.add({ ...BSAI_LIKE, strand: -1 } as CustomEnzymeInput));
    expect(entered.fields.map((f) => f.field)).toContain('recognitionSeq');
    expect(entered.fields.map((f) => f.reason).join(' ')).toMatch(/reverse complement/);
    expect(storage.writes).toBe(0);
    okValue(db.add(BSAI_LIKE));
    const file = JSON.parse(okValue(db.exportBackup()));
    const before = storage.getItem(ENZYME_DATABASE_KEY);
    const imported = errorOf(db.importBackup(JSON.stringify({ ...file, definitions: [{ ...file.definitions[0], id: 'b1', strand: -1 }] })));
    expect(imported.kind).toBe('malformed');
    expect(imported.message).toMatch(/reverse complement/);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(before);
    storage.map.set(ENZYME_DATABASE_KEY, JSON.stringify({ schema: 1, definitions: [{ ...file.definitions[0], strand: -1 }] }));
    const read = openEnzymeDatabase(env(storage)).read();
    expect(read.ok).toBe(false);
  });
});

describe('Enzyme database: validation (US-01M7DVMJ AC2)', () => {
  it('US-01M7DVMJ AC2 refuses an empty name or motif with a field-level reason and writes nothing', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const name = errorOf(db.add({ ...BSAI_LIKE, name: '   ' }));
    expect(name.kind).toBe('invalid');
    expect(name.fields).toEqual([{ field: 'name', reason: expect.any(String) }]);
    const motif = errorOf(db.add({ ...BSAI_LIKE, recognitionSeq: ' ' }));
    expect(motif.fields).toEqual([{ field: 'recognitionSeq', reason: expect.stringMatching(/empty/) }]);
    expect(storage.writes).toBe(0);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBeNull();
  });

  it('US-01M7DVMJ AC2 accepts exactly the letters iupac_options knows, in either case', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: an A/C/G/T-only check, or one that forgets U or N.
    const all = okValue(db.add({ ...BSAI_LIKE, recognitionSeq: 'acgturyswkmbdhvn' }));
    expect(all.recognitionSeq).toBe('ACGTURYSWKMBDHVN');
    // Wrong implementation: any letter A-Z accepted, or a digit or gap character let through.
    for (const bad of 'EFIJLOPQXZ*-.0'.split('')) {
      const err = errorOf(db.add({ ...BSAI_LIKE, recognitionSeq: `GGT${bad}TC` }));
      expect(err.fields.map((f) => f.field)).toEqual(['recognitionSeq']);
      expect(err.fields[0].reason).toContain(bad.toUpperCase());
    }
    expect(storage.writes).toBe(1);
  });

  it('US-01M7DVMJ AC2 refuses a motif past 37 bases with a reason naming the limit, and keeps one of 37', () => {
    // A later story asserts this equals the Rust scan's origin wrap + 1 (36 + 1).
    expect(MAX_CUSTOM_MOTIF_LENGTH).toBe(37);
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementations: no limit, a limit of 36 (off by one), or one counted before spaces are removed.
    const at = okValue(db.add({ ...BSAI_LIKE, recognitionSeq: `${'A'.repeat(36)} C` }));
    expect(at.recognitionSeq).toHaveLength(37);
    const writes = storage.writes;
    const over = errorOf(db.add({ ...BSAI_LIKE, recognitionSeq: 'A'.repeat(38) }));
    expect(over.fields).toHaveLength(1);
    expect(over.fields[0].field).toBe('recognitionSeq');
    expect(over.fields[0].reason).toContain(String(MAX_CUSTOM_MOTIF_LENGTH));
    expect(over.fields[0].reason).toMatch(/origin/);
    expect(storage.writes).toBe(writes);
  });

  it('US-01M7DVMJ AC2 refuses an offset that is not a whole number, per field', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementations: rounding 1.5, reading "7" or null as a number, or NaN/Infinity let through.
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '7', null, undefined]) {
      const top = errorOf(db.add({ ...BSAI_LIKE, cutFwd: bad as never }));
      expect(top.fields.map((f) => f.field)).toEqual(['cutFwd']);
      const bottom = errorOf(db.add({ ...BSAI_LIKE, cutRev: bad as never }));
      expect(bottom.fields.map((f) => f.field)).toEqual(['cutRev']);
    }
    const both = errorOf(db.add({ ...BSAI_LIKE, name: '', cutFwd: 0.5, cutRev: 2.5 }));
    expect(both.fields.map((f) => f.field)).toEqual(['name', 'cutFwd', 'cutRev']);
    expect(storage.writes).toBe(0);
  });

  it('US-01M7DVMJ AC2 keeps offsets outside the motif exactly, in both directions, never clamped', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: clamping an offset to the motif's bounds [0, length].
    const past = okValue(db.add({ name: 'Past', recognitionSeq: 'GGTCTC', cutFwd: 7, cutRev: 11 }));
    expect([past.cutFwd, past.cutRev]).toEqual([7, 11]);
    const before = okValue(db.add({ name: 'Before', recognitionSeq: 'GAGACC', cutFwd: -3, cutRev: -7 }));
    expect([before.cutFwd, before.cutRev]).toEqual([-3, -7]);
    expect(storedDefinitions(storage).map((d) => [d.cutFwd, d.cutRev])).toEqual([
      [7, 11],
      [-3, -7],
    ]);
  });
});

describe('Enzyme database: one cut per strand (US-01M7DVMJ AC3)', () => {
  const SINGLE = 'this schema holds a single cut per strand';

  it('US-01M7DVMJ AC3 refuses an offset entered as an array by name, never storing its first cut', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: taking the first element of the array, a two-cut approximation.
    for (const input of [
      { ...BSAI_LIKE, cutFwd: [7, 30] },
      { ...BSAI_LIKE, cutRev: [11, 34] },
    ]) {
      const err = errorOf(db.add(input as never));
      expect(err.kind).toBe('multipleCuts');
      expect(err.message).toContain(SINGLE);
    }
    expect(storage.writes).toBe(0);
  });

  it('US-01M7DVMJ AC3 refuses a cuts list longer than one pair, and a REBASE-style site with two cut pairs', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const cuts = errorOf(
      db.add({ ...BSAI_LIKE, cuts: [{ top: 7, bottom: 11 }, { top: -10, bottom: -15 }] } as never),
    );
    expect(cuts.kind).toBe('multipleCuts');
    expect(cuts.message).toContain(SINGLE);
    // BaeI as REBASE writes it: a cut pair on each side of the site.
    const rebase = errorOf(db.add({ ...BSAI_LIKE, name: 'MyBae', recognitionSeq: '(10/15)ACNNNNGTAYC(12/7)' }));
    expect(rebase.kind).toBe('multipleCuts');
    expect(rebase.message).toContain(SINGLE);
    expect(storage.writes).toBe(0);
  });

  it('US-01M7DVMJ AC3 refuses an imported multi-cut definition by name and leaves the store unchanged', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    okValue(db.add(BSAI_LIKE));
    const exported = JSON.parse(okValue(db.exportBackup()));
    const stored = storage.getItem(ENZYME_DATABASE_KEY);
    const writes = storage.writes;
    const second = { ...exported.definitions[0], id: 'other', name: 'Other' };
    for (const bad of [
      { ...second, cutFwd: [7, 30] },
      { ...second, cuts: [{ top: 7, bottom: 11 }, { top: 30, bottom: 34 }] },
      { ...second, recognitionSeq: '(10/15)ACNNNNGTAYC(12/7)' },
    ]) {
      const err = errorOf(db.importBackup(JSON.stringify({ ...exported, definitions: [bad] })));
      // Wrong implementations: importing it as one cut, or refusing it only as a malformed file.
      expect(err.kind).toBe('multipleCuts');
      expect(err.message).toContain(SINGLE);
    }
    expect(storage.writes).toBe(writes);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(stored);
  });
});

describe('Enzyme database: built-in names (US-01M7DVMJ AC4)', () => {
  it('US-01M7DVMJ AC4 reports a built-in name, trimmed and in any case, as a clash before writing', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementations: a case-sensitive or untrimmed comparison, or no check against the real catalogue.
    for (const name of ['EcoRI', 'ecori', '  ECORI ', 'bsai-hfV2']) {
      const err = errorOf(db.add({ ...BSAI_LIKE, name }));
      expect(err.kind).toBe('nameClash');
      expect(err.clash).toBe(name.trim().toLowerCase() === 'ecori' ? 'EcoRI' : 'BsaI-HFv2');
    }
    expect(storage.writes).toBe(0);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBeNull();
    // A name that only contains a built-in's is not a clash.
    expect(okValue(db.add({ ...BSAI_LIKE, name: 'EcoRI-like' })).name).toBe('EcoRI-like');
  });

  it('US-01M7DVMJ AC4 the exported clash check trims and ignores case on raw input, as an editor calls it', () => {
    // Wrong implementations: an untrimmed or case-sensitive lookup, which the store's own trimmed
    // name never reaches but an editor checking what is typed does.
    expect(builtInNameClash('  ecori ')).toBe('EcoRI');
    expect(builtInNameClash('\tHINDIII\n')).toBe('HindIII');
    expect(builtInNameClash('EcoRI-like')).toBeUndefined();
    expect(builtInNameClash('   ')).toBeUndefined();
  });

  it('US-01M7DVMJ AC4 stores a confirmed same-name definition as a separate custom one with its own id', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: a confirmation of one clash accepted for another name.
    const wrongConfirm = errorOf(db.add({ ...BSAI_LIKE, name: 'ecoRI' }, { confirmedClash: 'BsaI' }));
    expect(wrongConfirm.kind).toBe('nameClash');
    expect(storage.writes).toBe(0);
    const def = okValue(db.add({ ...BSAI_LIKE, name: 'ecoRI' }, { confirmedClash: 'EcoRI' }));
    expect(def).toMatchObject({ id: 'e1', source: 'custom', name: 'ecoRI', sharesBuiltInName: 'EcoRI' });
    // Its id is its own, never the built-in's name.
    expect(REBASE_ENZYMES.map((e) => e.name)).not.toContain(def.id);
    // Or under a distinct display name, with no confirmation at all.
    const renamed = okValue(db.add({ ...BSAI_LIKE, name: 'EcoRI (mine)' }));
    expect('sharesBuiltInName' in renamed).toBe(false);
  });

  it('US-01M7DVMJ AC4 writes only its own key and leaves the catalogue as it was', () => {
    const snapshot = JSON.stringify(REBASE_ENZYMES);
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    okValue(db.add({ ...BSAI_LIKE, name: 'EcoRI' }, { confirmedClash: 'EcoRI' }));
    okValue(db.importBackup(okValue(db.exportBackup()).replace('"e1"', '"e9"')));
    // Wrong implementation: the store writing a catalogue key, or splicing into REBASE_ENZYMES.
    expect(new Set(storage.keysWritten)).toEqual(new Set([ENZYME_DATABASE_KEY]));
    expect(JSON.stringify(REBASE_ENZYMES)).toBe(snapshot);
    expect(storedDefinitions(storage).every((d) => d.source === 'custom')).toBe(true);
  });

  it('US-01M7DVMJ AC4 holds back an unconfirmed built-in name in an import until the user confirms it', () => {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const backup = JSON.stringify({
      format: ENZYME_BACKUP_FORMAT,
      schema: ENZYME_DATABASE_SCHEMA,
      exportedAt: '2026-11-16T08:00:00.000Z',
      definitions: [
        {
          id: 'x1', source: 'custom', name: 'HindIII', recognitionSeq: 'AAGCTT', cutFwd: 1, cutRev: 5, isTypeIIS: false,
          methylationSensitivity: [], provenance: '', notes: '', createdAt: '2026-11-16T08:00:00.000Z', modifiedAt: '2026-11-16T08:00:00.000Z',
        },
      ],
    });
    // Wrong implementation: an import that stores a clashing name the user never confirmed.
    const held = okValue(db.importBackup(backup));
    expect(held.added).toEqual([]);
    expect(held.clashes).toEqual([{ id: 'x1', name: 'HindIII', builtIn: 'HindIII' }]);
    expect(storage.writes).toBe(0);
    const confirmed = okValue(db.importBackup(backup, { confirmClashes: ['x1'] }));
    expect(confirmed.added).toEqual(['x1']);
    expect(storedDefinitions(storage)[0].sharesBuiltInName).toBe('HindIII');
  });
});

describe('Enzyme database: export and import (US-01M7DVMJ AC5)', () => {
  function seeded() {
    const storage = new MemoryStorage();
    const db = openEnzymeDatabase(env(storage));
    const a = okValue(db.add({ ...BSAI_LIKE, provenance: 'NEB', notes: 'golden gate' }));
    const b = okValue(db.add({ name: 'Before', recognitionSeq: 'GAGACC', cutFwd: -3, cutRev: -7, methylationSensitivity: ['Dcm'] }));
    const c = okValue(db.add({ name: 'pstI', recognitionSeq: 'CTGCAG', cutFwd: 5, cutRev: 1 }, { confirmedClash: 'PstI' }));
    expect(c.sharesBuiltInName).toBe('PstI');
    return { storage, db, defs: [a, b, c] };
  }

  it('US-01M7DVMJ AC5 exports a versioned file holding every definition with its id, motif, offsets, provenance and notes', () => {
    const { db, defs } = seeded();
    const file = JSON.parse(okValue(db.exportBackup()));
    expect(file.format).toBe(ENZYME_BACKUP_FORMAT);
    expect(file.schema).toBe(ENZYME_DATABASE_SCHEMA);
    // Wrong implementation: an export that drops a field or a definition.
    expect(file.definitions).toEqual(defs);
    expect(file.definitions[1]).toMatchObject({ id: 'e2', recognitionSeq: 'GAGACC', cutFwd: -3, cutRev: -7, provenance: '', notes: '' });
    expect(file.definitions[0]).toMatchObject({ provenance: 'NEB', notes: 'golden gate' });
  });

  it('US-01M7DVMJ AC5 restores an export into an empty store identically', () => {
    const { db, defs } = seeded();
    const target = new MemoryStorage();
    // Another day's clock and id source, so a restore that mints its own times or ids differs.
    const fresh = openEnzymeDatabase(env(target, 'z', 20));
    const summary = okValue(fresh.importBackup(okValue(db.exportBackup())));
    expect(summary).toEqual({ added: ['e1', 'e2', 'e3'], replaced: [], unchanged: [], conflicts: [], clashes: [] });
    // Wrong implementation: new ids or times minted on import, or a confirmed clash held back again.
    expect(openEnzymeDatabase(env(target)).read()).toEqual({ ok: true, definitions: defs, stored: true });
  });

  it('US-01M7DVMJ AC5 into a non-empty store adds new ids and lists differing ones, replacing or deleting nothing silently', () => {
    const { storage, db, defs } = seeded();
    const file = JSON.parse(okValue(db.exportBackup()));
    const changed = { ...file.definitions[0], notes: 'edited elsewhere' };
    const extra = { ...file.definitions[1], id: 'n1', name: 'New one' };
    // The backup lacks e2 and holds e3 unchanged.
    const backup = JSON.stringify({ ...file, definitions: [changed, file.definitions[2], extra] });
    const summary = okValue(db.importBackup(backup));
    // Wrong implementations: an import that replaces a differing id, or drops ids the file lacks.
    expect(summary.added).toEqual(['n1']);
    expect(summary.unchanged).toEqual(['e3']);
    expect(summary.replaced).toEqual([]);
    expect(summary.conflicts).toEqual([{ id: 'e1', stored: defs[0], incoming: changed }]);
    expect(storedDefinitions(storage)).toEqual([...defs, extra]);
    // Replaced only when the user chooses it.
    const chosen = okValue(db.importBackup(backup, { replace: ['e1'] }));
    expect(chosen.replaced).toEqual(['e1']);
    expect(storedDefinitions(storage)).toEqual([changed, defs[1], defs[2], extra]);
  });

  it('US-01M7DVMJ AC5 refuses a malformed or newer-schema file by name and leaves the store unchanged', () => {
    const { storage, db } = seeded();
    const file = JSON.parse(okValue(db.exportBackup()));
    const stored = storage.getItem(ENZYME_DATABASE_KEY);
    const writes = storage.writes;
    const cases: Array<[string, string]> = [
      ['{ not json', 'malformed'],
      [JSON.stringify({ ...file, format: 'molbiocraft-primer-database-backup' }), 'malformed'],
      [JSON.stringify({ ...file, definitions: [{ ...file.definitions[0], recognitionSeq: 'GGTXTC' }] }), 'malformed'],
      [JSON.stringify({ ...file, definitions: [{ ...file.definitions[0], cutFwd: 7.5 }] }), 'malformed'],
      [JSON.stringify({ ...file, definitions: [file.definitions[0], file.definitions[0]] }), 'malformed'],
      [JSON.stringify({ ...file, schema: ENZYME_DATABASE_SCHEMA + 1 }), 'futureSchema'],
    ];
    for (const [text, kind] of cases) {
      const err = errorOf(db.importBackup(text));
      // Wrong implementation: a partial import, or a newer file read as if it were current.
      expect(err.kind).toBe(kind);
      expect(err.message).toMatch(/not restored/);
    }
    expect(errorOf(db.importBackup(JSON.stringify({ ...file, schema: 2 }))).message).toContain('schema 2');
    expect(storage.writes).toBe(writes);
    expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(stored);
  });
});

describe('Enzyme database: unreadable store and failed writes (US-01M7DVMJ AC6)', () => {
  for (const [label, value, kind] of [
    ['an unparseable value', '{"schema":1,"definitions":[', 'malformed'],
    ['an empty value', '', 'malformed'],
    ['a newer schema', JSON.stringify({ schema: ENZYME_DATABASE_SCHEMA + 1, definitions: [] }), 'futureSchema'],
    ['a definition it cannot read', JSON.stringify({ schema: 1, definitions: [{ id: 'q', name: 'Q' }] }), 'malformed'],
  ] as const) {
    it(`US-01M7DVMJ AC6 reports ${label} as unreadable, never empty, and does not overwrite it`, () => {
      const storage = new MemoryStorage();
      storage.map.set(ENZYME_DATABASE_KEY, value);
      const db = openEnzymeDatabase(env(storage));
      // Wrong implementation: reading an unreadable store as an empty database.
      const read = db.read();
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.error.kind).toBe(kind);
      expect(read.error.storedValue).toBe(value);
      expect(read.error.message).toMatch(/cannot be read/);
      // Wrong implementation: a write that replaces it with a fresh store.
      expect(errorOf(db.add(BSAI_LIKE)).kind).toBe(kind);
      const backup = JSON.stringify({ format: ENZYME_BACKUP_FORMAT, schema: 1, exportedAt: '', definitions: [] });
      expect(errorOf(db.importBackup(backup)).kind).toBe(kind);
      expect(errorOf(db.exportBackup()).kind).toBe(kind);
      expect(storage.writes).toBe(0);
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(value);
    });
  }

  it('US-01M7DVMJ AC6 replaces an unreadable store only on the choice to, and only the value shown', () => {
    const storage = new MemoryStorage();
    storage.map.set(ENZYME_DATABASE_KEY, '{ broken');
    const db = openEnzymeDatabase(env(storage));
    // Wrong implementation: discarding whatever is stored, even a value the user was never shown.
    expect(errorOf(db.discardUnreadable('{ other')).kind).toBe('stale');
    expect(storage.writes).toBe(0);
    okValue(db.discardUnreadable('{ broken'));
    expect(db.read()).toEqual({ ok: true, definitions: [], stored: true });
    okValue(db.add(BSAI_LIKE));
    // Wrong implementation: discarding a store that can be read.
    const readable = storage.getItem(ENZYME_DATABASE_KEY)!;
    expect(errorOf(db.discardUnreadable(readable)).kind).toBe('stale');
    expect(storedDefinitions(storage)).toHaveLength(1);
  });

  it('US-01M7DVMJ AC6 reports blocked storage as unavailable, never as an empty database', () => {
    const blocked: EnzymeStorage = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    const db = openEnzymeDatabase(env(blocked));
    const read = db.read();
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('unavailable');
    expect(errorOf(db.add(BSAI_LIKE)).kind).toBe('unavailable');
  });

  for (const [label, error] of [
    ['over quota', new DOMException('The quota has been exceeded.', 'QuotaExceededError')],
    ['blocked', new DOMException('The operation is insecure.', 'SecurityError')],
  ] as const) {
    it(`US-01M7DVMJ AC6 a write refused as ${label} reports nothing saved and leaves the previous store intact`, () => {
      const storage = new FailingStorage();
      const db = openEnzymeDatabase(env(storage));
      const kept = okValue(db.add(BSAI_LIKE));
      const before = storage.getItem(ENZYME_DATABASE_KEY);
      storage.failWith = error;
      // Wrong implementation: reporting success, or reporting it saved when the storage threw.
      const attempt = errorOf(db.add({ ...BSAI_LIKE, name: 'Second' }));
      expect(attempt.kind).toBe('notSaved');
      expect(attempt.message).toMatch(/[Nn]othing was saved/);
      const file = JSON.parse(okValue(db.exportBackup()));
      expect(errorOf(db.importBackup(JSON.stringify({ ...file, definitions: [{ ...kept, id: 'other', name: 'Other' }] }))).kind).toBe('notSaved');
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(before);
      expect(db.read()).toEqual({ ok: true, definitions: [kept], stored: true });
    });
  }

  it('US-01M7DVMJ AC6 a write the storage silently drops reports nothing saved', () => {
    const storage = new ForgetfulStorage();
    const db = openEnzymeDatabase(env(storage));
    const kept = okValue(db.add(BSAI_LIKE));
    storage.forget = true;
    // Wrong implementation: trusting setItem without reading the value back.
    expect(errorOf(db.add({ ...BSAI_LIKE, name: 'Second' })).kind).toBe('notSaved');
    expect(db.read()).toEqual({ ok: true, definitions: [kept], stored: true });
  });
});
