// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Primer Database store (US-01M7DQVT, decision D0119): the user's reusable primer records,
 * kept in localStorage under one key of its own as a versioned envelope `{ schema, records }`,
 * with a versioned JSON backup for export and restore.
 *
 * It shares the storage mechanism of userPreferences, optionProfiles and localBlastDb but not
 * their error handling. A stored value that cannot be read is reported by name, never read as
 * an empty database, and no write replaces it until the user chooses `discardUnreadable`. A
 * write that fails reports that the change was not saved. Every write re-reads storage first,
 * so a record another tab of the standalone build added is kept.
 *
 * The module holds no state: tests inject the storage, the clock and the id source.
 */

import type { DatabasePrimer, PrimerMolecule } from '../types/bio';

/** The localStorage key the database lives under. */
export const PRIMER_DATABASE_KEY = 'molbiocraft.primerDatabase';
/** The envelope schema this build writes and the highest it can read. */
export const PRIMER_DATABASE_SCHEMA = 1;
/** The `format` marker of a backup file. */
export const PRIMER_BACKUP_FORMAT = 'molbiocraft-primer-database-backup';

/** The two calls of the Web Storage API the store uses. */
export interface PrimerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PrimerDatabaseEnv {
  /** Defaults to `globalThis.localStorage`. */
  storage?: PrimerStorage;
  /** ISO 8601 time; defaults to the system clock. */
  now?: () => string;
  /** A new record id; defaults to a random UUID, or a time-and-random id where the platform has no UUID source. */
  newId?: () => string;
}

/** What a caller supplies to add a primer; `sequence` and `tail5Prime` are raw input. */
export interface DatabasePrimerInput {
  name: string;
  sequence: string;
  /** When omitted, a sequence holding U is RNA and any other DNA. */
  molecule?: PrimerMolecule;
  modifications?: string;
  /** The 5' non-annealing tail, when known: it must be the start of the sequence. */
  tail5Prime?: string;
  description?: string;
  labels?: string[];
  provenance?: string;
}

export type PrimerField = 'name' | 'sequence' | 'molecule' | 'tail5Prime' | 'labels';

export interface PrimerFieldError {
  field: PrimerField;
  reason: string;
}

/**
 * Why an operation did nothing. `malformed`, `futureSchema` and `unavailable` name a store (or a
 * backup) that could not be read; `notSaved` a write the storage refused.
 */
export type PrimerDbErrorKind =
  | 'invalid'
  | 'malformed'
  | 'futureSchema'
  | 'unavailable'
  | 'notSaved'
  | 'notFound'
  | 'trashed'
  | 'stale';

export interface PrimerDbError {
  kind: PrimerDbErrorKind;
  message: string;
  /** Field-level reasons, for `invalid`. */
  fields: PrimerFieldError[];
  /** The unreadable stored value, for `malformed` and `futureSchema` on the store. */
  storedValue?: string;
}

export type PrimerDbResult<T> = { ok: true; value: T } | { ok: false; error: PrimerDbError };

export type PrimerDbRead =
  | { ok: true; records: DatabasePrimer[]; stored: boolean }
  | { ok: false; error: PrimerDbError };

export interface PrimerEdit {
  record: DatabasePrimer;
  /** The fields the edit changed, in record order; empty when it changed nothing. */
  changedFields: Array<keyof DatabasePrimer>;
}

export interface PrimerImportConflict {
  id: string;
  stored: DatabasePrimer;
  incoming: DatabasePrimer;
}

/** A record the caller asked to replace that the store, as it stands at commit, cannot replace. */
export interface PrimerNotReplaced {
  id: string;
  /** "M13F (id) is in the trash" or "M13F (id) is no longer in the database". */
  reason: string;
}

export interface PrimerImportSummary {
  added: string[];
  replaced: string[];
  unchanged: string[];
  /** Records whose id exists and differs, kept as stored. */
  conflicts: PrimerImportConflict[];
  /**
   * Records named in `replace` that are trashed, or no longer stored, when the restore commits
   * (BG-01M7DT7A): left as they are, never re-added or brought out of the trash. Present only
   * when there is one, so a summary without any keeps its earlier shape.
   */
  notReplaced?: PrimerNotReplaced[];
}

export interface PrimerImportOptions {
  /**
   * The conflicting ids the user chose to replace with the backup's record. A named id must still
   * be stored and active when the restore commits, else it is listed in `notReplaced`.
   */
  replace?: string[] | 'all';
  /**
   * When a replace is refused (see `notReplaced`), write nothing and fail with `stale` instead of
   * restoring the rest: for a caller whose records only make sense together, such as an import.
   */
  allOrNothing?: boolean;
}

function fail(kind: PrimerDbErrorKind, message: string, extra: Partial<PrimerDbError> = {}): { ok: false; error: PrimerDbError } {
  return { ok: false, error: { kind, message, fields: [], ...extra } };
}

// ---- Normalization and validation ---------------------------------------------------------

const IUPAC_NUCLEOTIDES = /^[ACGTURYSWKMBDHVN]*$/;
const MARK_5 = /^5['’′]-?/;
const MARK_3 = /-?3['’′]$/;

export type NormalizedSequence =
  | { ok: true; sequence: string; molecule: PrimerMolecule }
  | { ok: false; reason: string };

/**
 * Uppercase `raw` and remove its whitespace and a leading 5'- or trailing -3' mark. IUPAC
 * ambiguity codes are kept; T and U are never rewritten, so a DNA record keeps T and an RNA
 * record keeps U, and a sequence holding both is refused. Without a molecule, U means RNA.
 */
export function normalizePrimerSequence(raw: string, molecule?: PrimerMolecule): NormalizedSequence {
  const sequence = String(raw).replace(/\s+/g, '').replace(MARK_5, '').replace(MARK_3, '').toUpperCase();
  if (sequence === '') return { ok: false, reason: 'The sequence is empty.' };
  if (!IUPAC_NUCLEOTIDES.test(sequence)) {
    const bad = [...new Set(sequence.replace(/[ACGTURYSWKMBDHVN]/g, ''))].join(' ');
    const hint = sequence.includes('/')
      ? ' Put a modification such as /5Phos/ in the modification field, not the sequence.'
      : '';
    return { ok: false, reason: `The sequence holds characters that are not IUPAC nucleotide codes: ${bad}.${hint}` };
  }
  const hasT = sequence.includes('T');
  const hasU = sequence.includes('U');
  if (hasT && hasU) {
    return { ok: false, reason: 'The sequence holds both T and U; a primer is DNA (T) or RNA (U), not both.' };
  }
  const resolved: PrimerMolecule = molecule ?? (hasU ? 'RNA' : 'DNA');
  if (resolved !== 'DNA' && resolved !== 'RNA') {
    return { ok: false, reason: `The molecule must be DNA or RNA, not ${String(resolved)}.` };
  }
  if (resolved === 'DNA' && hasU) {
    return { ok: false, reason: 'A DNA record keeps T, but the sequence holds U. Mark it RNA or enter T.' };
  }
  if (resolved === 'RNA' && hasT) {
    return { ok: false, reason: 'An RNA record keeps U, but the sequence holds T. Mark it DNA or enter U.' };
  }
  return { ok: true, sequence, molecule: resolved };
}

/** The annealing portion of a record: its sequence after the 5' tail. */
export function annealingPortion(record: DatabasePrimer): string {
  return record.sequence.slice(record.tail5Prime.length);
}

export function activePrimers(records: DatabasePrimer[]): DatabasePrimer[] {
  return records.filter((r) => r.trashedAt === undefined);
}

export function trashedPrimers(records: DatabasePrimer[]): DatabasePrimer[] {
  return records.filter((r) => r.trashedAt !== undefined);
}

function cleanLabels(labels: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const label of labels ?? []) {
    const t = String(label).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

type Validated = Omit<DatabasePrimer, 'id' | 'createdAt' | 'modifiedAt' | 'trashedAt'>;

/** Validate and normalize an input, collecting a reason for each invalid field. */
function validateInput(input: DatabasePrimerInput): { ok: true; value: Validated } | { ok: false; error: PrimerDbError } {
  const fields: PrimerFieldError[] = [];
  const name = String(input.name ?? '').trim();
  if (name === '') fields.push({ field: 'name', reason: 'A primer needs a name.' });
  else if (/[\u0000-\u001f\u007f]/.test(name)) {
    fields.push({ field: 'name', reason: 'A primer name is one line, without tabs or line breaks.' });
  }
  let molecule = input.molecule;
  if (molecule !== undefined && molecule !== 'DNA' && molecule !== 'RNA') {
    fields.push({ field: 'molecule', reason: `The molecule must be DNA or RNA, not ${String(molecule)}.` });
    molecule = undefined;
  }
  const seq = normalizePrimerSequence(String(input.sequence ?? ''), molecule);
  if (!seq.ok) fields.push({ field: 'sequence', reason: seq.reason });
  let tail = '';
  if (seq.ok && input.tail5Prime !== undefined && String(input.tail5Prime).trim() !== '') {
    const t = normalizePrimerSequence(String(input.tail5Prime), seq.molecule);
    if (!t.ok) fields.push({ field: 'tail5Prime', reason: `The 5' tail is not valid: ${t.reason}` });
    else if (!seq.sequence.startsWith(t.sequence)) {
      fields.push({ field: 'tail5Prime', reason: "The 5' tail must be the start of the sequence." });
    } else if (t.sequence.length >= seq.sequence.length) {
      fields.push({ field: 'tail5Prime', reason: "The 5' tail must leave an annealing portion after it." });
    } else tail = t.sequence;
  }
  if (input.labels !== undefined && (!Array.isArray(input.labels) || !input.labels.every((l) => typeof l === 'string'))) {
    fields.push({ field: 'labels', reason: 'Labels must be a list of text.' });
  }
  if (fields.length > 0 || !seq.ok) {
    const what = fields.map((f) => f.field).join(', ');
    return fail('invalid', `The primer was not saved: ${what} ${fields.length === 1 ? 'is' : 'are'} not valid.`, { fields });
  }
  return {
    ok: true,
    value: {
      name,
      sequence: seq.sequence,
      originalInput: String(input.sequence),
      molecule: seq.molecule,
      modifications: String(input.modifications ?? '').trim(),
      tail5Prime: tail,
      description: String(input.description ?? ''),
      labels: cleanLabels(input.labels),
      provenance: String(input.provenance ?? 'Entered by hand'),
    },
  };
}

// ---- Envelope and migration ---------------------------------------------------------------

const RECORD_FIELDS: Array<keyof DatabasePrimer> = [
  'id',
  'name',
  'sequence',
  'originalInput',
  'molecule',
  'modifications',
  'tail5Prime',
  'description',
  'labels',
  'createdAt',
  'modifiedAt',
  'provenance',
];

/**
 * Read one stored or backed-up record into canonical form, or say why it cannot be read. The
 * sequence must already be normalized and the tail a strict prefix of it. `originalInput` is
 * only required to be text: it is the input as typed, which may hold a modification code or
 * other text normalization drops, so it is not required to normalize to the sequence.
 */
function readRecord(value: unknown, at: number): { ok: true; record: DatabasePrimer } | { ok: false; reason: string } {
  const where = `record ${at + 1}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, reason: `${where} is not an object` };
  const v = value as Record<string, unknown>;
  for (const key of RECORD_FIELDS) {
    if (key === 'labels') {
      if (!Array.isArray(v.labels) || !v.labels.every((l) => typeof l === 'string')) {
        return { ok: false, reason: `${where} has no list of labels` };
      }
    } else if (typeof v[key] !== 'string') return { ok: false, reason: `${where} has no ${key}` };
  }
  if (v.trashedAt !== undefined && typeof v.trashedAt !== 'string') return { ok: false, reason: `${where} has a trash time that is not text` };
  if (v.id === '' || String(v.name).trim() === '') return { ok: false, reason: `${where} has an empty id or name` };
  const seq = normalizePrimerSequence(v.sequence as string, v.molecule as PrimerMolecule);
  if (!seq.ok || seq.sequence !== v.sequence) {
    return { ok: false, reason: `${where} (${String(v.id)}) has an invalid sequence${seq.ok ? '' : `: ${seq.reason}`}` };
  }
  const tail = v.tail5Prime as string;
  if (!(seq.sequence.startsWith(tail) && tail.length < seq.sequence.length)) {
    return { ok: false, reason: `${where} (${String(v.id)}) has a 5' tail that is not the start of its sequence` };
  }
  const record = {} as Record<string, unknown>;
  for (const key of RECORD_FIELDS) record[key] = key === 'labels' ? [...(v.labels as string[])] : v[key];
  if (v.trashedAt !== undefined) record.trashedAt = v.trashedAt;
  return { ok: true, record: record as unknown as DatabasePrimer };
}

/**
 * The one migration entry point: turn a parsed envelope (stored or from a backup) into records
 * of the current schema. Schema 1 is current; a higher schema is `futureSchema`, and anything
 * else, including a record that cannot be read or a repeated id, is `malformed`. A later schema
 * adds its upgrade step here.
 */
export function migratePrimerEnvelope(value: unknown): { ok: true; records: DatabasePrimer[] } | { ok: false; error: PrimerDbError } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('malformed', 'it is not a primer database envelope');
  }
  const { schema, records } = value as { schema?: unknown; records?: unknown };
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return fail('malformed', 'it carries no schema version');
  }
  if (schema > PRIMER_DATABASE_SCHEMA) {
    return fail(
      'futureSchema',
      `it was written with schema ${schema}, newer than the schema ${PRIMER_DATABASE_SCHEMA} this version of MolBioCraft reads`,
    );
  }
  if (!Array.isArray(records)) return fail('malformed', 'it holds no list of records');
  const out: DatabasePrimer[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < records.length; i += 1) {
    const r = readRecord(records[i], i);
    if (!r.ok) return fail('malformed', r.reason);
    if (ids.has(r.record.id)) return fail('malformed', `the id ${r.record.id} appears twice`);
    ids.add(r.record.id);
    out.push(r.record);
  }
  return { ok: true, records: out };
}

// ---- The store ------------------------------------------------------------------------------

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name?: unknown; message?: unknown };
    return `${String(e.name)}${e.message ? `: ${String(e.message)}` : ''}`;
  }
  return String(err);
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `primer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameRecord(a: DatabasePrimer, b: DatabasePrimer): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PrimerDatabase {
  /** Read the store: the records, or why it cannot be read. */
  read(): PrimerDbRead;
  add(input: DatabasePrimerInput): PrimerDbResult<DatabasePrimer>;
  /** Change the given fields of an active record; the id and creation time never change. */
  edit(id: string, changes: Partial<DatabasePrimerInput>): PrimerDbResult<PrimerEdit>;
  /** Move a record to the trash; it stays stored until `emptyTrash`. */
  trash(id: string): PrimerDbResult<DatabasePrimer>;
  /** Bring a trashed record back as it was. */
  restore(id: string): PrimerDbResult<DatabasePrimer>;
  /** Delete every trashed record: the only call that deletes one. */
  emptyTrash(): PrimerDbResult<{ deleted: string[] }>;
  /** A versioned JSON backup of every record, trashed ones included. */
  exportBackup(): PrimerDbResult<string>;
  /**
   * Restore a backup: new ids are added, an existing id that differs is listed as a conflict and
   * kept as stored unless `replace` names it, and nothing is deleted. An id `replace` names that is
   * trashed or gone when the restore commits is listed in `notReplaced` and left as it is. A malformed or
   * future-schema backup is refused and the store is left unchanged.
   */
  importBackup(text: string, options?: PrimerImportOptions): PrimerDbResult<PrimerImportSummary>;
  /**
   * The user's explicit choice to replace an unreadable stored value with an empty database.
   * `storedValue` is the value the user was shown (`error.storedValue`); nothing is written
   * unless the store still holds exactly that value and cannot be read.
   */
  discardUnreadable(storedValue: string): PrimerDbResult<null>;
}

export function openPrimerDatabase(env: PrimerDatabaseEnv = {}): PrimerDatabase {
  const now = env.now ?? (() => new Date().toISOString());
  const newId = env.newId ?? defaultId;

  function storage(): PrimerStorage {
    if (env.storage) return env.storage;
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('localStorage is not available');
    return ls;
  }

  function readRaw(): { ok: true; raw: string | null } | { ok: false; error: PrimerDbError } {
    try {
      return { ok: true, raw: storage().getItem(PRIMER_DATABASE_KEY) };
    } catch (err) {
      return fail('unavailable', `The primer database (${PRIMER_DATABASE_KEY}) cannot be read: storage is unavailable (${errorText(err)}).`);
    }
  }

  function parseStored(raw: string | null): PrimerDbRead {
    if (raw === null) return { ok: true, records: [], stored: false };
    const unreadable = (kind: PrimerDbErrorKind, why: string) =>
      fail(kind, `The stored primer database (${PRIMER_DATABASE_KEY}) cannot be read: ${why}. It is kept as it is until you choose what to do with it.`, {
        storedValue: raw,
      });
    if (raw.trim() === '') return unreadable('malformed', 'it holds an empty value');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return unreadable('malformed', 'it is not valid JSON');
    }
    const migrated = migratePrimerEnvelope(parsed);
    if (!migrated.ok) return unreadable(migrated.error.kind, migrated.error.message);
    return { ok: true, records: migrated.records, stored: true };
  }

  function read(): PrimerDbRead {
    const raw = readRaw();
    return raw.ok ? parseStored(raw.raw) : raw;
  }

  function write(records: DatabasePrimer[]): { ok: true } | { ok: false; error: PrimerDbError } {
    const text = JSON.stringify({ schema: PRIMER_DATABASE_SCHEMA, records });
    try {
      const s = storage();
      s.setItem(PRIMER_DATABASE_KEY, text);
      if (s.getItem(PRIMER_DATABASE_KEY) !== text) {
        return fail('notSaved', 'The change was not saved: the storage did not keep it. The primer database is as it was.');
      }
    } catch (err) {
      return fail('notSaved', `The change was not saved (${errorText(err)}). The primer database is as it was.`);
    }
    return { ok: true };
  }

  /** Re-read the store, apply `change` to what it holds now, and write the result. */
  function commit<T>(
    change: (records: DatabasePrimer[]) => { ok: true; records: DatabasePrimer[] | null; value: T } | { ok: false; error: PrimerDbError },
  ): PrimerDbResult<T> {
    const current = read();
    if (!current.ok) return current;
    const outcome = change(current.records);
    if (!outcome.ok) return outcome;
    if (outcome.records) {
      const written = write(outcome.records);
      if (!written.ok) return written;
    }
    return { ok: true, value: outcome.value };
  }

  function find(records: DatabasePrimer[], id: string) {
    const index = records.findIndex((r) => r.id === id);
    return index < 0 ? fail('notFound', `No primer with id ${id} is in the database.`) : { ok: true as const, index, record: records[index] };
  }

  return {
    read,

    add(input) {
      const valid = validateInput(input);
      if (!valid.ok) return valid;
      return commit((records) => {
        const taken = new Set(records.map((r) => r.id));
        let id = newId();
        while (taken.has(id)) id = newId();
        const time = now();
        const record: DatabasePrimer = { id, ...valid.value, createdAt: time, modifiedAt: time };
        const ordered = readRecord(record, records.length);
        if (!ordered.ok) return fail('invalid', ordered.reason);
        return { ok: true, records: [...records, ordered.record], value: ordered.record };
      });
    },

    edit(id, changes) {
      return commit((records) => {
        const found = find(records, id);
        if (!found.ok) return found;
        const rec = found.record;
        if (rec.trashedAt !== undefined) return fail('trashed', `${rec.name} is in the trash; restore it before editing.`);
        // Without a new sequence, validate the stored one and keep the stored input as it is:
        // originalInput may hold what normalization never reads back (a /5Phos/ code, other text),
        // and an edit changes only the fields the user changed.
        const valid = validateInput({
          name: changes.name ?? rec.name,
          sequence: changes.sequence ?? rec.sequence,
          molecule: changes.molecule ?? rec.molecule,
          modifications: changes.modifications ?? rec.modifications,
          tail5Prime: changes.tail5Prime ?? rec.tail5Prime,
          description: changes.description ?? rec.description,
          labels: changes.labels ?? rec.labels,
          provenance: changes.provenance ?? rec.provenance,
        });
        if (!valid.ok) return valid;
        if (changes.sequence === undefined) valid.value.originalInput = rec.originalInput;
        const next = { ...rec } as Record<string, unknown>;
        const changedFields: Array<keyof DatabasePrimer> = [];
        for (const key of RECORD_FIELDS) {
          if (!(key in valid.value)) continue;
          const value = valid.value[key as keyof Validated];
          if (JSON.stringify(value) !== JSON.stringify(rec[key])) {
            next[key] = value;
            changedFields.push(key);
          }
        }
        if (changedFields.length === 0) return { ok: true, records: null, value: { record: rec, changedFields } };
        next.modifiedAt = now();
        const record = next as unknown as DatabasePrimer;
        const updated = records.map((r, i) => (i === found.index ? record : r));
        return { ok: true, records: updated, value: { record, changedFields } };
      });
    },

    trash(id) {
      return commit((records) => {
        const found = find(records, id);
        if (!found.ok) return found;
        if (found.record.trashedAt !== undefined) return { ok: true, records: null, value: found.record };
        const record = { ...found.record, trashedAt: now() };
        return { ok: true, records: records.map((r, i) => (i === found.index ? record : r)), value: record };
      });
    },

    restore(id) {
      return commit((records) => {
        const found = find(records, id);
        if (!found.ok) return found;
        if (found.record.trashedAt === undefined) return { ok: true, records: null, value: found.record };
        const record = { ...found.record };
        delete record.trashedAt;
        return { ok: true, records: records.map((r, i) => (i === found.index ? record : r)), value: record };
      });
    },

    emptyTrash() {
      return commit((records) => {
        const deleted = trashedPrimers(records).map((r) => r.id);
        return { ok: true, records: deleted.length ? activePrimers(records) : null, value: { deleted } };
      });
    },

    exportBackup() {
      const current = read();
      if (!current.ok) return current;
      const backup = { format: PRIMER_BACKUP_FORMAT, schema: PRIMER_DATABASE_SCHEMA, exportedAt: now(), records: current.records };
      return { ok: true, value: JSON.stringify(backup, null, 2) };
    },

    importBackup(text, options = {}) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail('malformed', 'The backup was not restored: it is not valid JSON.');
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== PRIMER_BACKUP_FORMAT) {
        return fail('malformed', 'The backup was not restored: it is not a MolBioCraft primer database backup.');
      }
      const migrated = migratePrimerEnvelope(parsed);
      if (!migrated.ok) return fail(migrated.error.kind, `The backup was not restored: ${migrated.error.message}.`);
      const replace = options.replace ?? [];
      return commit((records) => {
        const summary: PrimerImportSummary = { added: [], replaced: [], unchanged: [], conflicts: [] };
        const notReplaced: PrimerNotReplaced[] = [];
        const next = [...records];
        for (const incoming of migrated.records) {
          const index = next.findIndex((r) => r.id === incoming.id);
          // The commit-time precondition of a replace (BG-01M7DT7A): the record must still be
          // stored and out of the trash, as the caller saw it when it chose to replace it.
          const named = replace === 'all' ? index >= 0 : replace.includes(incoming.id);
          if (named && index < 0) {
            notReplaced.push({ id: incoming.id, reason: `${incoming.name} (${incoming.id}) is no longer in the database` });
            continue;
          }
          if (named && next[index].trashedAt !== undefined && !sameRecord(next[index], incoming)) {
            notReplaced.push({ id: incoming.id, reason: `${next[index].name} (${incoming.id}) is in the trash` });
            continue;
          }
          if (index < 0) {
            next.push(incoming);
            summary.added.push(incoming.id);
          } else if (sameRecord(next[index], incoming)) {
            summary.unchanged.push(incoming.id);
          } else if (replace === 'all' || replace.includes(incoming.id)) {
            next[index] = incoming;
            summary.replaced.push(incoming.id);
          } else {
            summary.conflicts.push({ id: incoming.id, stored: next[index], incoming });
          }
        }
        if (notReplaced.length) {
          if (options.allOrNothing) return fail('stale', `The change was not saved: ${notReplaced.map((n) => n.reason).join('; ')}. The primer database is as it was.`);
          summary.notReplaced = notReplaced;
        }
        const changed = summary.added.length > 0 || summary.replaced.length > 0;
        return { ok: true, records: changed ? next : null, value: summary };
      });
    },

    discardUnreadable(storedValue) {
      const raw = readRaw();
      if (!raw.ok) return raw;
      if (raw.raw !== storedValue) {
        return fail('stale', 'Nothing was discarded: the stored primer database is no longer the value you were shown.');
      }
      if (parseStored(raw.raw).ok) return fail('stale', 'Nothing was discarded: the stored primer database can be read.');
      const written = write([]);
      if (!written.ok) return written;
      return { ok: true, value: null };
    },
  };
}
