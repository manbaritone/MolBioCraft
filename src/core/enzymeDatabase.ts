// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The custom enzyme store (US-01M7DVMJ): the restriction enzymes the user defined, kept in
 * localStorage under one key of its own as a versioned envelope `{ schema, definitions }`, with
 * a versioned JSON backup for export and import. It follows the Primer Database's storage
 * ruling (D0119) and copies its error shape from `primerDatabase.ts`.
 *
 * The store holds custom definitions only. It never writes the built-in catalogue or any key
 * but its own, so a definition is additive: a name equal to a built-in's is a clash the user
 * confirms, never a replacement. A stored value that cannot be read is reported by name, never
 * read as an empty store, and no write replaces it until the user chooses `discardUnreadable`.
 * A write that fails reports that nothing was saved.
 *
 * The module holds no state: tests inject the storage, the clock and the id source.
 */

import type { CustomEnzymeDefinition, MethylationSensitivity } from '../types/bio';
import { builtInEnzymeNamed } from '../data/rebaseEnzymes';

/** The localStorage key the store lives under. */
export const ENZYME_DATABASE_KEY = 'molbiocraft.enzymeDatabase';
/** The envelope schema this build writes and the highest it can read. */
export const ENZYME_DATABASE_SCHEMA = 1;
/** The `format` marker of a backup file. */
export const ENZYME_BACKUP_FORMAT = 'molbiocraft-enzyme-database-backup';
/**
 * The longest motif a definition may have: the restriction scan reads 36 bases past the origin
 * of a circular molecule, so a motif of 37 is the longest whose origin-crossing sites it finds.
 */
export const MAX_CUSTOM_MOTIF_LENGTH = 37;
/** The motif letters the engine's scan matches (`iupac_options` in rebase_catalog.rs). */
export const MOTIF_LETTERS = 'ACGTURYSWKMBDHVN';
/** The methylation spellings the built-in catalogue's type allows. */
export const METHYLATION_SENSITIVITIES: readonly MethylationSensitivity[] = ['Dam', 'Dcm', 'CpG', 'EcoKI'];

const SINGLE_CUT = 'this schema holds a single cut per strand';

/** The two calls of the Web Storage API the store uses. */
export interface EnzymeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EnzymeDatabaseEnv {
  /** Defaults to `globalThis.localStorage`. */
  storage?: EnzymeStorage;
  /** ISO 8601 time; defaults to the system clock. */
  now?: () => string;
  /** A new definition id; defaults to `custom:` and a random UUID. */
  newId?: () => string;
}

/** What a caller supplies to add a definition; the motif is raw input. */
export interface CustomEnzymeInput {
  name: string;
  /** 5' -> 3' on the top strand; case and whitespace are not kept. */
  recognitionSeq: string;
  cutFwd: number;
  cutRev: number;
  isTypeIIS?: boolean;
  methylationSensitivity?: MethylationSensitivity[];
  /** A built-in's name, in any case; stored as the catalogue spells it. */
  clonedFrom?: string;
  provenance?: string;
  notes?: string;
}

export type EnzymeField =
  | 'name'
  | 'recognitionSeq'
  | 'cutFwd'
  | 'cutRev'
  | 'cuts'
  | 'isTypeIIS'
  | 'methylationSensitivity'
  | 'clonedFrom'
  | 'provenance'
  | 'notes';

export interface EnzymeFieldError {
  field: EnzymeField;
  reason: string;
}

/**
 * Why an operation did nothing. `malformed`, `futureSchema` and `unavailable` name a store (or a
 * backup) that could not be read; `notSaved` a write the storage refused; `multipleCuts` a
 * definition needing more than one cut per strand; `nameClash` a built-in's name not confirmed.
 */
export type EnzymeDbErrorKind =
  | 'invalid'
  | 'multipleCuts'
  | 'nameClash'
  | 'malformed'
  | 'futureSchema'
  | 'unavailable'
  | 'notSaved'
  | 'stale';

export interface EnzymeDbError {
  kind: EnzymeDbErrorKind;
  message: string;
  /** Field-level reasons, for `invalid` and `multipleCuts`. */
  fields: EnzymeFieldError[];
  /** The unreadable stored value, for `malformed` and `futureSchema` on the store. */
  storedValue?: string;
  /** The built-in's catalogue name, for `nameClash`. */
  clash?: string;
}

export type EnzymeDbResult<T> = { ok: true; value: T } | { ok: false; error: EnzymeDbError };

export type EnzymeDbRead =
  | { ok: true; definitions: CustomEnzymeDefinition[]; stored: boolean }
  | { ok: false; error: EnzymeDbError };

export interface EnzymeAddOptions {
  /** The built-in name the user was shown as a clash and confirmed keeping the name beside. */
  confirmedClash?: string;
}

export interface EnzymeImportConflict {
  id: string;
  stored: CustomEnzymeDefinition;
  incoming: CustomEnzymeDefinition;
}

/** A backup definition held back because its name is a built-in's and was never confirmed. */
export interface EnzymeImportClash {
  id: string;
  name: string;
  builtIn: string;
}

export interface EnzymeImportSummary {
  added: string[];
  replaced: string[];
  unchanged: string[];
  /** Definitions whose id exists and differs, kept as stored. */
  conflicts: EnzymeImportConflict[];
  /** Definitions not imported until the user confirms their built-in name. */
  clashes: EnzymeImportClash[];
}

export interface EnzymeImportOptions {
  /** The conflicting ids the user chose to replace with the backup's definition. */
  replace?: string[] | 'all';
  /** The clashing ids the user confirmed importing under the built-in's name. */
  confirmClashes?: string[];
}

function fail(kind: EnzymeDbErrorKind, message: string, extra: Partial<EnzymeDbError> = {}): { ok: false; error: EnzymeDbError } {
  return { ok: false, error: { kind, message, fields: [], ...extra } };
}

/** The built-in catalogue name `name` clashes with (trimmed, case-insensitive), or undefined. */
export function builtInNameClash(name: string): string | undefined {
  return builtInEnzymeNamed(name)?.name;
}

// ---- Validation -------------------------------------------------------------------------------

const MOTIF_PATTERN = new RegExp(`^[${MOTIF_LETTERS}]*$`);
/** A REBASE cut pair such as `(10/15)`. */
const REBASE_CUT_PAIR = /\(\s*-?\d+\s*\/\s*-?\d+\s*\)/g;

type Validated = Omit<CustomEnzymeDefinition, 'id' | 'source' | 'createdAt' | 'modifiedAt' | 'sharesBuiltInName'>;

/**
 * The reason a value carries more than one cut per strand, or null: an offset given as a list
 * of more than one, a `cuts` list of more than one pair, or a REBASE-style site with a cut pair
 * on each side of it.
 */
function multipleCuts(v: Record<string, unknown>): EnzymeFieldError | null {
  for (const field of ['cutFwd', 'cutRev'] as const) {
    const value = v[field];
    if (Array.isArray(value) && value.length > 1) {
      return { field, reason: `${field} holds ${value.length} cuts, but ${SINGLE_CUT}.` };
    }
  }
  if (Array.isArray(v.cuts) && v.cuts.length > 1) {
    return { field: 'cuts', reason: `The definition lists ${v.cuts.length} cut pairs, but ${SINGLE_CUT}.` };
  }
  if (typeof v.recognitionSeq === 'string' && (v.recognitionSeq.match(REBASE_CUT_PAIR) ?? []).length > 1) {
    return { field: 'recognitionSeq', reason: `The site carries a cut pair on each side, but ${SINGLE_CUT}.` };
  }
  return null;
}

/**
 * Validate and normalize a definition's fields, collecting a reason for each invalid field.
 * `clonedFrom` must name a built-in when `checkClonedFrom` is set (input); a stored one is kept
 * as text, so a catalogue that later drops that enzyme leaves the store readable.
 */
function validateFields(
  v: Record<string, unknown>,
  checkClonedFrom: boolean,
): { ok: true; value: Validated } | { ok: false; error: EnzymeDbError } {
  const multi = multipleCuts(v);
  if (multi) return fail('multipleCuts', `The enzyme was not saved: ${multi.reason}`, { fields: [multi] });

  const fields: EnzymeFieldError[] = [];
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (name === '') fields.push({ field: 'name', reason: 'An enzyme needs a name.' });
  else if (/[\u0000-\u001f\u007f]/.test(name)) {
    fields.push({ field: 'name', reason: 'An enzyme name is one line, without tabs or line breaks.' });
  }

  const motif = typeof v.recognitionSeq === 'string' ? v.recognitionSeq.replace(/\s+/g, '').toUpperCase() : '';
  if ('strand' in v) {
    fields.push({
      field: 'recognitionSeq',
      reason: "A definition has no strand: write the motif 5' to 3' on the top strand, entering a bottom-strand site as its reverse complement.",
    });
  } else if (motif === '') fields.push({ field: 'recognitionSeq', reason: 'The recognition motif is empty.' });
  else if (!MOTIF_PATTERN.test(motif)) {
    const bad = [...new Set(motif.replace(new RegExp(`[${MOTIF_LETTERS}]`, 'g'), ''))].join(' ');
    fields.push({ field: 'recognitionSeq', reason: `The motif holds characters that are not IUPAC nucleotide codes (${MOTIF_LETTERS}): ${bad}.` });
  } else if (motif.length > MAX_CUSTOM_MOTIF_LENGTH) {
    fields.push({
      field: 'recognitionSeq',
      reason: `The motif is ${motif.length} bases; it may be at most ${MAX_CUSTOM_MOTIF_LENGTH}, the longest motif the scan reads across the origin of a circular molecule.`,
    });
  }

  for (const field of ['cutFwd', 'cutRev'] as const) {
    if (!Number.isSafeInteger(v[field])) {
      const strand = field === 'cutFwd' ? 'top' : 'bottom';
      fields.push({ field, reason: `The ${strand}-strand cut must be a whole number of bases from the motif's first base.` });
    }
  }
  if ('cuts' in v) {
    fields.push({ field: 'cuts', reason: 'Give the cut as the top- and bottom-strand offsets, not as a list.' });
  }
  if (v.isTypeIIS !== undefined && typeof v.isTypeIIS !== 'boolean') {
    fields.push({ field: 'isTypeIIS', reason: 'The Type IIS flag is yes or no.' });
  }

  const methylation: MethylationSensitivity[] = [];
  const rawMethylation = v.methylationSensitivity ?? [];
  if (!Array.isArray(rawMethylation) || !rawMethylation.every((m) => METHYLATION_SENSITIVITIES.includes(m as MethylationSensitivity))) {
    fields.push({ field: 'methylationSensitivity', reason: `Methylation sensitivity is a list of ${METHYLATION_SENSITIVITIES.join(', ')}.` });
  } else {
    for (const m of rawMethylation as MethylationSensitivity[]) if (!methylation.includes(m)) methylation.push(m);
  }

  let clonedFrom: string | undefined;
  if (v.clonedFrom !== undefined) {
    const builtIn = typeof v.clonedFrom === 'string' && checkClonedFrom ? builtInEnzymeNamed(v.clonedFrom) : undefined;
    if (typeof v.clonedFrom !== 'string' || v.clonedFrom.trim() === '') {
      fields.push({ field: 'clonedFrom', reason: 'Cloned-from is the name of a built-in enzyme.' });
    } else if (checkClonedFrom && !builtIn) {
      fields.push({ field: 'clonedFrom', reason: `No built-in enzyme is named ${v.clonedFrom}.` });
    } else clonedFrom = builtIn ? builtIn.name : v.clonedFrom;
  }

  for (const field of ['provenance', 'notes'] as const) {
    if (v[field] !== undefined && typeof v[field] !== 'string') fields.push({ field, reason: `The ${field} must be text.` });
  }

  if (fields.length > 0) {
    const what = [...new Set(fields.map((f) => f.field))].join(', ');
    return fail('invalid', `The enzyme was not saved: ${what} ${fields.length === 1 ? 'is' : 'are'} not valid.`, { fields });
  }
  const value: Validated = {
    name,
    recognitionSeq: motif,
    cutFwd: v.cutFwd as number,
    cutRev: v.cutRev as number,
    isTypeIIS: (v.isTypeIIS as boolean | undefined) ?? false,
    methylationSensitivity: methylation,
    provenance: (v.provenance as string | undefined) ?? '',
    notes: (v.notes as string | undefined) ?? '',
  };
  if (clonedFrom !== undefined) value.clonedFrom = clonedFrom;
  return { ok: true, value };
}

/** Assemble a definition in canonical field order, so two equal definitions serialize alike. */
function definition(
  id: string,
  value: Validated,
  times: { createdAt: string; modifiedAt: string },
  sharesBuiltInName?: string,
): CustomEnzymeDefinition {
  const out: CustomEnzymeDefinition = {
    id,
    source: 'custom',
    name: value.name,
    recognitionSeq: value.recognitionSeq,
    cutFwd: value.cutFwd,
    cutRev: value.cutRev,
    isTypeIIS: value.isTypeIIS,
    methylationSensitivity: [...value.methylationSensitivity],
    provenance: value.provenance,
    notes: value.notes,
    createdAt: times.createdAt,
    modifiedAt: times.modifiedAt,
  };
  if (value.clonedFrom !== undefined) out.clonedFrom = value.clonedFrom;
  if (sharesBuiltInName !== undefined) out.sharesBuiltInName = sharesBuiltInName;
  return out;
}

// ---- Envelope and migration -------------------------------------------------------------------

/**
 * Read one stored or backed-up definition into canonical form, or say why it cannot be read. It
 * must already be canonical: a name or motif that validation would change is not read.
 */
function readDefinition(value: unknown, at: number): { ok: true; definition: CustomEnzymeDefinition } | { ok: false; error: EnzymeDbError } {
  const where = `definition ${at + 1}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('malformed', `${where} is not an object`);
  const v = value as Record<string, unknown>;
  const valid = validateFields(v, false);
  if (!valid.ok) {
    const reasons = valid.error.fields.map((f) => f.reason).join(' ');
    return fail(valid.error.kind === 'multipleCuts' ? 'multipleCuts' : 'malformed', `${where} (${String(v.id)}) cannot be read: ${reasons}`, {
      fields: valid.error.fields,
    });
  }
  for (const key of ['id', 'createdAt', 'modifiedAt'] as const) {
    if (typeof v[key] !== 'string' || v[key] === '') return fail('malformed', `${where} has no ${key}`);
  }
  if (v.source !== 'custom') return fail('malformed', `${where} (${String(v.id)}) is not a custom definition`);
  if (v.sharesBuiltInName !== undefined && (typeof v.sharesBuiltInName !== 'string' || v.sharesBuiltInName === '')) {
    return fail('malformed', `${where} (${String(v.id)}) has a confirmed built-in name that is not text`);
  }
  const canonical = definition(v.id as string, valid.value, { createdAt: v.createdAt as string, modifiedAt: v.modifiedAt as string }, v.sharesBuiltInName as string | undefined);
  if (canonical.name !== v.name || canonical.recognitionSeq !== v.recognitionSeq || typeof v.isTypeIIS !== 'boolean') {
    return fail('malformed', `${where} (${String(v.id)}) is not in the form this store writes`);
  }
  return { ok: true, definition: canonical };
}

/**
 * The one migration entry point: turn a parsed envelope (stored or from a backup) into
 * definitions of the current schema. Schema 1 is current; a higher schema is `futureSchema`, a
 * definition with more than one cut per strand `multipleCuts`, and anything else that cannot be
 * read, including a repeated id, `malformed`.
 */
export function migrateEnzymeEnvelope(value: unknown): { ok: true; definitions: CustomEnzymeDefinition[] } | { ok: false; error: EnzymeDbError } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('malformed', 'it is not an enzyme database envelope');
  }
  const { schema, definitions } = value as { schema?: unknown; definitions?: unknown };
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return fail('malformed', 'it carries no schema version');
  }
  if (schema > ENZYME_DATABASE_SCHEMA) {
    return fail(
      'futureSchema',
      `it was written with schema ${schema}, newer than the schema ${ENZYME_DATABASE_SCHEMA} this version of MolBioCraft reads`,
    );
  }
  if (!Array.isArray(definitions)) return fail('malformed', 'it holds no list of definitions');
  const out: CustomEnzymeDefinition[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < definitions.length; i += 1) {
    const r = readDefinition(definitions[i], i);
    if (!r.ok) return r;
    if (ids.has(r.definition.id)) return fail('malformed', `the id ${r.definition.id} appears twice`);
    ids.add(r.definition.id);
    out.push(r.definition);
  }
  return { ok: true, definitions: out };
}

// ---- The store --------------------------------------------------------------------------------

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name?: unknown; message?: unknown };
    return `${String(e.name)}${e.message ? `: ${String(e.message)}` : ''}`;
  }
  return String(err);
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `custom:${c.randomUUID()}`;
  return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameDefinition(a: CustomEnzymeDefinition, b: CustomEnzymeDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameName(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.toLowerCase();
}

export interface EnzymeDatabase {
  /** Read the store: the definitions, or why it cannot be read. */
  read(): EnzymeDbRead;
  /**
   * Add a definition. A name equal to a built-in's is refused as `nameClash` unless
   * `confirmedClash` names that built-in; it is then stored with its own id beside it.
   */
  add(input: CustomEnzymeInput, options?: EnzymeAddOptions): EnzymeDbResult<CustomEnzymeDefinition>;
  /** A versioned JSON backup of every definition. */
  exportBackup(): EnzymeDbResult<string>;
  /**
   * Import a backup: new ids are added, an existing id that differs is listed as a conflict and
   * kept as stored unless `replace` names it, an unconfirmed built-in name is held back unless
   * `confirmClashes` names it, and nothing is deleted. A malformed, multi-cut or future-schema
   * backup is refused and the store is left unchanged.
   */
  importBackup(text: string, options?: EnzymeImportOptions): EnzymeDbResult<EnzymeImportSummary>;
  /**
   * The user's explicit choice to replace an unreadable stored value with an empty store.
   * Nothing is written unless the store still holds exactly `storedValue` and cannot be read.
   */
  discardUnreadable(storedValue: string): EnzymeDbResult<null>;
}

export function openEnzymeDatabase(env: EnzymeDatabaseEnv = {}): EnzymeDatabase {
  const now = env.now ?? (() => new Date().toISOString());
  const newId = env.newId ?? defaultId;

  function storage(): EnzymeStorage {
    if (env.storage) return env.storage;
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('localStorage is not available');
    return ls;
  }

  function readRaw(): { ok: true; raw: string | null } | { ok: false; error: EnzymeDbError } {
    try {
      return { ok: true, raw: storage().getItem(ENZYME_DATABASE_KEY) };
    } catch (err) {
      return fail('unavailable', `The enzyme database (${ENZYME_DATABASE_KEY}) cannot be read: storage is unavailable (${errorText(err)}).`);
    }
  }

  function parseStored(raw: string | null): EnzymeDbRead {
    if (raw === null) return { ok: true, definitions: [], stored: false };
    const unreadable = (kind: EnzymeDbErrorKind, why: string) =>
      fail(kind, `The stored enzyme database (${ENZYME_DATABASE_KEY}) cannot be read: ${why}. It is kept as it is until you choose what to do with it.`, {
        storedValue: raw,
      });
    if (raw.trim() === '') return unreadable('malformed', 'it holds an empty value');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return unreadable('malformed', 'it is not valid JSON');
    }
    const migrated = migrateEnzymeEnvelope(parsed);
    // A multi-cut definition in storage is unreadable storage, as any other the store did not write.
    if (!migrated.ok) return unreadable(migrated.error.kind === 'futureSchema' ? 'futureSchema' : 'malformed', migrated.error.message);
    return { ok: true, definitions: migrated.definitions, stored: true };
  }

  function read(): EnzymeDbRead {
    const raw = readRaw();
    return raw.ok ? parseStored(raw.raw) : raw;
  }

  function write(definitions: CustomEnzymeDefinition[]): { ok: true } | { ok: false; error: EnzymeDbError } {
    const text = JSON.stringify({ schema: ENZYME_DATABASE_SCHEMA, definitions });
    try {
      const s = storage();
      s.setItem(ENZYME_DATABASE_KEY, text);
      if (s.getItem(ENZYME_DATABASE_KEY) !== text) {
        return fail('notSaved', 'Nothing was saved: the storage did not keep the change. The enzyme database is as it was.');
      }
    } catch (err) {
      return fail('notSaved', `Nothing was saved (${errorText(err)}). The enzyme database is as it was.`);
    }
    return { ok: true };
  }

  /** Re-read the store, apply `change` to what it holds now, and write the result. */
  function commit<T>(
    change: (
      definitions: CustomEnzymeDefinition[],
    ) => { ok: true; definitions: CustomEnzymeDefinition[] | null; value: T } | { ok: false; error: EnzymeDbError },
  ): EnzymeDbResult<T> {
    const current = read();
    if (!current.ok) return current;
    const outcome = change(current.definitions);
    if (!outcome.ok) return outcome;
    if (outcome.definitions) {
      const written = write(outcome.definitions);
      if (!written.ok) return written;
    }
    return { ok: true, value: outcome.value };
  }

  return {
    read,

    add(input, options = {}) {
      const valid = validateFields(input as unknown as Record<string, unknown>, true);
      if (!valid.ok) return valid;
      const clash = builtInNameClash(valid.value.name);
      if (clash !== undefined && !sameName(options.confirmedClash, clash)) {
        return fail(
          'nameClash',
          `${valid.value.name} is the name of the built-in enzyme ${clash}. Nothing was saved: choose a different name, or confirm to keep it as a separate custom enzyme beside ${clash}.`,
          { clash },
        );
      }
      return commit((definitions) => {
        const taken = new Set(definitions.map((d) => d.id));
        let id = newId();
        while (taken.has(id)) id = newId();
        const time = now();
        const def = definition(id, valid.value, { createdAt: time, modifiedAt: time }, clash);
        return { ok: true, definitions: [...definitions, def], value: def };
      });
    },

    exportBackup() {
      const current = read();
      if (!current.ok) return current;
      const backup = { format: ENZYME_BACKUP_FORMAT, schema: ENZYME_DATABASE_SCHEMA, exportedAt: now(), definitions: current.definitions };
      return { ok: true, value: JSON.stringify(backup, null, 2) };
    },

    importBackup(text, options = {}) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail('malformed', 'The backup was not restored: it is not valid JSON.');
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== ENZYME_BACKUP_FORMAT) {
        return fail('malformed', 'The backup was not restored: it is not a MolBioCraft enzyme database backup.');
      }
      const migrated = migrateEnzymeEnvelope(parsed);
      if (!migrated.ok) return fail(migrated.error.kind, `The backup was not restored: ${migrated.error.message}.`, { fields: migrated.error.fields });
      const replace = options.replace ?? [];
      const confirmClashes = options.confirmClashes ?? [];
      return commit((definitions) => {
        const summary: EnzymeImportSummary = { added: [], replaced: [], unchanged: [], conflicts: [], clashes: [] };
        const next = [...definitions];
        for (let incoming of migrated.definitions) {
          const clash = builtInNameClash(incoming.name);
          if (clash !== undefined && !sameName(incoming.sharesBuiltInName, clash)) {
            if (!confirmClashes.includes(incoming.id)) {
              summary.clashes.push({ id: incoming.id, name: incoming.name, builtIn: clash });
              continue;
            }
            incoming = { ...incoming, sharesBuiltInName: clash };
          }
          const index = next.findIndex((d) => d.id === incoming.id);
          if (index < 0) {
            next.push(incoming);
            summary.added.push(incoming.id);
          } else if (sameDefinition(next[index], incoming)) {
            summary.unchanged.push(incoming.id);
          } else if (replace === 'all' || replace.includes(incoming.id)) {
            next[index] = incoming;
            summary.replaced.push(incoming.id);
          } else {
            summary.conflicts.push({ id: incoming.id, stored: next[index], incoming });
          }
        }
        const changed = summary.added.length > 0 || summary.replaced.length > 0;
        return { ok: true, definitions: changed ? next : null, value: summary };
      });
    },

    discardUnreadable(storedValue) {
      const raw = readRaw();
      if (!raw.ok) return raw;
      if (raw.raw !== storedValue) {
        return fail('stale', 'Nothing was discarded: the stored enzyme database is no longer the value you were shown.');
      }
      if (parseStored(raw.raw).ok) return fail('stale', 'Nothing was discarded: the stored enzyme database can be read.');
      const written = write([]);
      if (!written.ok) return written;
      return { ok: true, value: null };
    },
  };
}
