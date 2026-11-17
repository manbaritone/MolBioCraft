// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The saved CRISPR guide sets (US-01M7DVFD, decision D0119's storage ruling): each a completed
 * search kept under its name with the nuclease preset, the interval and the result cap it ran with,
 * the scan's own report and every guide row as the engine returned it, the document id, name and
 * sequence revision it ran on, the engine version and when it ran.
 *
 * It lives in localStorage under one key of its own as a versioned envelope `{ schema, sets }`, as
 * the enzyme stores do (D0158, D0163), and is keyed to a document id plus revision: a guide set is
 * user-local and never written into the `.mbc` document. A stored value that cannot be read is
 * reported by name (malformed, newer schema, storage unavailable), never read as no saved sets, and
 * no save replaces it. A write the storage refuses, or does not keep, says that nothing was saved.
 * Every save re-reads storage first, so a set another tab of the standalone build saved is kept.
 * Rename, remove and a rerun's write (US-01M7DVDF) re-read it first too, change only the one set by
 * its id, and say `Nothing was changed: <reason>` when the store cannot be read, the set is gone or
 * the storage refuses or does not keep the write. A stored envelope with a top-level key this
 * version does not know is malformed, naming the key, so no writer drops it (US-01M7M67J).
 *
 * The backup (US-01M7M67J) is `{ format, schema, exportedAt, sets }` holding every stored set as
 * stored. An import adds each new id as the file holds it, leaves an identical id (compared with
 * every object's keys sorted) as it is and keeps a differing id as stored; a file, or a store, it
 * cannot read changes nothing. An imported set is read field for field against the types the tab
 * renders; a stored one keeps the store's own reader.
 *
 * The rows and the report are typed as the engine's own `CrisprScanGuide` and `CrisprScanReport`
 * and stored as the engine sent them, never a copy of their field lists.
 *
 * The module holds no state: tests inject the storage, the clock, the id source and the engine
 * version.
 */

import type { CrisprNucleasePreset, CrisprScanGuide, CrisprScanReport, CrisprSearchedInterval } from './bioEngine';
import { getRustEngineDiagnostics } from '../lib/rustBioEngine';

/** The localStorage key the guide sets live under. */
export const GUIDE_SET_DATABASE_KEY = 'molbiocraft.crisprGuideSets';
/** The envelope schema this build writes and the highest it can read. */
export const GUIDE_SET_DATABASE_SCHEMA = 1;

/** The `format` a guide set backup file names itself with (US-01M7M67J). */
export const GUIDE_SET_BACKUP_FORMAT = 'molbiocraft-crispr-guide-set-backup';

/** The two calls of the Web Storage API the store uses. */
export interface GuideSetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface GuideSetDatabaseEnv {
  /** Defaults to `globalThis.localStorage`. */
  storage?: GuideSetStorage;
  /** ISO 8601 time of the save; defaults to the system clock. */
  now?: () => string;
  /** A new set id; defaults to a random UUID, or a time-and-random id where the platform has none. */
  newId?: () => string;
  /** The engine version a set records; defaults to the one the engine's diagnostics report. */
  engineVersion?: () => string;
}

/** The criteria a search ran with: exactly the ones the engine has (US-01M7DV29, US-01M7DVAS). */
export interface GuideSetCriteria {
  /** The nuclease preset, with its PAM side, PAM pattern, spacer length, site span and cut convention. */
  nuclease: CrisprNucleasePreset;
  /** How the record was read: a circle is scanned across its origin. */
  topology: 'circular' | 'linear';
  /** The interval the search was asked for, or null for the whole sequence. */
  interval: CrisprSearchedInterval | null;
  /** The most rows the search asked the engine for. */
  resultCap: number;
}

/** The names the guide table shows the three scores under, as they were when the set was saved. */
export interface GuideSetScoreNames {
  onTargetScore: string;
  specificityScore: string;
  offTargetCount: string;
}

/** A completed search as the tab hands it to {@link GuideSetDatabase.save}. */
export interface GuideSetRun {
  name: string;
  /** ISO 8601 time the search was run. */
  ranAt: string;
  criteria: GuideSetCriteria;
  report: CrisprScanReport;
  guides: CrisprScanGuide[];
  scoreNames: GuideSetScoreNames;
  /** The heuristic rank's rule in the engine's own words. */
  heuristicRule: string;
}

/** The document a set ran on: only its id, name and sequence revision are read. */
export interface GuideSetDocumentRef {
  id: string;
  name: string;
  /** The `sequenceRevision` token of the sequence the search read (restrictionDisplay.ts). */
  revision: string;
}

/** A saved guide set. */
export interface GuideSet extends GuideSetRun {
  id: string;
  documentId: string;
  documentName: string;
  sequenceRevision: string;
  engineVersion: string;
  /** ISO 8601 time the set was saved. */
  savedAt: string;
}

/** The stored envelope. */
export interface GuideSetEnvelope {
  schema: number;
  sets: GuideSet[];
}

/**
 * Why an operation did nothing. `malformed`, `futureSchema` and `unavailable` name a store that
 * could not be read; `notSaved` a write the storage refused or did not keep; `invalid` a run that
 * cannot be saved as it is.
 */
export type GuideSetErrorKind = 'malformed' | 'futureSchema' | 'unavailable' | 'notSaved' | 'invalid';

export interface GuideSetError {
  kind: GuideSetErrorKind;
  message: string;
  /** The unreadable stored value, for `malformed` and `futureSchema`. */
  storedValue?: string;
}

export type GuideSetResult<T> = { ok: true; value: T } | { ok: false; error: GuideSetError };

export type GuideSetRead = { ok: true; sets: GuideSet[]; stored: boolean } | { ok: false; error: GuideSetError };

/** One document's saved sets, told apart by name: some saved, none saved, or a store that cannot be read. */
export type GuideSetList =
  | { kind: 'saved'; sets: GuideSet[] }
  | { kind: 'none' }
  | { kind: 'unreadable'; error: GuideSetError };

/**
 * What a rerun of a saved set replaces (US-01M7DVDF AC4): the rows, the report and the provenance of
 * the new search. The set's id, name, document id, nuclease, interval, result cap and savedAt are
 * not in it, so a rerun cannot change them.
 */
export interface GuideSetRerun {
  /** ISO 8601 time the rerun's Run was pressed. */
  ranAt: string;
  /** The document's topology the rerun read. */
  topology: 'circular' | 'linear';
  report: CrisprScanReport;
  guides: CrisprScanGuide[];
  scoreNames: GuideSetScoreNames;
  heuristicRule: string;
}

/** What an import did, by id (US-01M7M67J): only `added` were written. */
export interface GuideSetImport {
  added: string[];
  /** Ids whose stored set is the file's set: the same JSON once every object's keys are sorted. */
  unchanged: string[];
  /** Ids whose stored set differs from the file's set, keys sorted: kept as stored. */
  kept: string[];
}

export interface GuideSetDatabase {
  read(): GuideSetRead;
  /**
   * The backup of every stored set, as stored, documents not open included (US-01M7M67J), or why
   * the store cannot be read.
   */
  exportBackup(): GuideSetResult<string>;
  /**
   * Import a backup file's text. A refusal's message is the whole sentence,
   * `<file> was not imported: <why>. Nothing was changed.`; a file or a store that cannot be read
   * is refused before any write. A file needs an `exportedAt` date, and each of its sets a one-line
   * name and rows, report, criteria and score names readable field for field as the tab renders
   * them. A set whose id is stored is compared with its keys sorted, so key order alone does not
   * make it differ.
   */
  importBackup(file: string, text: string): GuideSetResult<GuideSetImport>;
  /** The sets saved for this document id, oldest first. */
  listForDocument(documentId: string): GuideSetList;
  /**
   * The sets saved for documents none of these ids names (US-01M7DVDF AC6): a set is listed here
   * only while its document is not open, so a set of another open document is not in it.
   */
  listNotOpen(openDocumentIds: readonly string[]): GuideSetList;
  /** Keep a completed run under its name. It writes only this store's key, never the document. */
  save(run: GuideSetRun, document: GuideSetDocumentRef): GuideSetResult<GuideSet>;
  /** Give the set with this id a new one-line name; every other field is kept as stored. */
  rename(id: string, name: string): GuideSetResult<GuideSet>;
  /** Delete the set with this id and no other. */
  remove(id: string): GuideSetResult<GuideSet>;
  /**
   * Write a completed rerun over the set with this id, as stored when the reply came: it keeps the
   * id, name, documentId, criteria.nuclease, criteria.interval, criteria.resultCap and savedAt, and
   * takes the rerun's guides, report, criteria.topology, ranAt, scoreNames and heuristicRule, the
   * document's name and revision, and the engine version now.
   */
  writeRerun(id: string, rerun: GuideSetRerun, document: GuideSetDocumentRef): GuideSetResult<GuideSet>;
}

const fail = (kind: GuideSetErrorKind, message: string, extra: Partial<GuideSetError> = {}): { ok: false; error: GuideSetError } => ({
  ok: false,
  error: { kind, message, ...extra },
});

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name?: unknown; message?: unknown };
    return `${String(e.name)}${e.message ? `: ${String(e.message)}` : ''}`;
  }
  return String(err);
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `guide-set:${c.randomUUID()}`;
  return `guide-set:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const STRING_FIELDS = ['id', 'name', 'documentId', 'documentName', 'sequenceRevision', 'engineVersion', 'ranAt', 'savedAt', 'heuristicRule'] as const;

/** Why a stored set cannot be read, or null when it can. */
function unreadableSet(v: unknown): string | null {
  if (!isObject(v)) return 'it is not a guide set';
  for (const f of STRING_FIELDS) if (typeof v[f] !== 'string') return `it has no ${f}`;
  const c = v.criteria;
  if (!isObject(c) || !isObject(c.nuclease) || typeof c.nuclease.id !== 'string' || typeof c.resultCap !== 'number') {
    return 'it has no criteria';
  }
  const r = v.report;
  if (!isObject(r) || typeof r.candidateCount !== 'number' || !Array.isArray(r.warnings)) return 'it has no scan report';
  if (!Array.isArray(v.guides) || !v.guides.every((g) => isObject(g) && typeof g.id === 'string')) return 'it has no readable guide rows';
  if (!isObject(v.scoreNames)) return 'it has no score names';
  return null;
}

const unknownKeys = (keys: string[]) =>
  keys.length === 1
    ? `it has a top-level key this version does not know: ${keys[0]}`
    : `it has top-level keys this version does not know: ${keys.join(', ')}`;

// ─── An imported set, read field for field as the tab renders it (US-01M7M67J) ───

type FieldCheck = (v: unknown) => boolean;
const str: FieldCheck = (v) => typeof v === 'string';
const num: FieldCheck = (v) => typeof v === 'number' && Number.isFinite(v);
const bool: FieldCheck = (v) => typeof v === 'boolean';
const interval: FieldCheck = (v) =>
  isObject(v) && num(v.start) && num(v.end) && num(v.lengthBp) && bool(v.crossesOrigin);
/** A field the type marks optional: absent, or of its type. */
const optional = (check: FieldCheck): FieldCheck => (v) => v === undefined || check(v);

/** Every field of `CrisprScanGuide`; `tsc --noEmit` refuses this when the type gains one it lacks. */
const GUIDE_ROW_FIELDS = {
  id: str, name: str, spacerSeq: str, pamSeq: str, nuclease: str, start: num, end: num, cutPosition: num,
  strand: (v) => v === 1 || v === -1, gcPercent: num, onTargetScore: num, specificityScore: num, offTargetCount: num,
  pamSide: str, pamPattern: str, cutConvention: str,
  cutPositionTargetStrand: optional(num), cutPositionTargetStrandNote: optional(str), pamAmbiguityNote: optional(str),
  searchedInterval: optional(interval), intervalContextNote: optional(str),
} satisfies Record<keyof CrisprScanGuide, FieldCheck>;

/** Every field of `CrisprScanReport`, pinned the same way. */
const SCAN_REPORT_FIELDS = {
  candidateCount: num, scannedLengthBp: num, sequenceLengthBp: num, scannedCircular: bool, originSpanBp: num,
  searchedInterval: optional(interval), intervalRefusal: optional(str), contextOutsideIntervalBp: num,
  warnings: (v) => Array.isArray(v) && v.every(str), seedLengthBp: optional(num),
} satisfies Record<keyof CrisprScanReport, FieldCheck>;

const PRESET_FIELDS = {
  id: str, pamSide: str, pamPattern: str, spacerLengthBp: num, siteSpanBp: num, cutConvention: str,
} satisfies Record<keyof CrisprNucleasePreset, FieldCheck>;

const CRITERIA_FIELDS = {
  nuclease: (v) => isObject(v) && unreadableField(v, PRESET_FIELDS) === null,
  topology: (v) => v === 'circular' || v === 'linear',
  interval: (v) => v === null || interval(v),
  resultCap: num,
} satisfies Record<keyof GuideSetCriteria, FieldCheck>;

const SCORE_NAME_FIELDS = { onTargetScore: str, specificityScore: str, offTargetCount: str } satisfies Record<keyof GuideSetScoreNames, FieldCheck>;

/** The first field of `v` its check refuses, or null. */
function unreadableField(v: Record<string, unknown>, fields: Record<string, FieldCheck>): string | null {
  for (const [f, check] of Object.entries(fields)) if (!check(v[f])) return f;
  return null;
}

/**
 * Why a set in a backup file cannot be imported, or null: on top of the store's own reader, every
 * row, the report, the criteria and the score names are read field for field against the types the
 * tab renders, and the name must be one line, as Save and Rename require. Only import reads this
 * strictly; a store this build wrote keeps the store's reader.
 */
function unimportableSet(set: GuideSet): string | null {
  const name = set.name.trim();
  if (name === '' || /[\r\n]/.test(set.name)) return 'it has no one-line name';
  for (const [i, g] of set.guides.entries()) {
    const f = unreadableField(g as unknown as Record<string, unknown>, GUIDE_ROW_FIELDS);
    if (f) return `guide row ${i + 1} (${g.id}) has no readable ${f}`;
  }
  const r = unreadableField(set.report as unknown as Record<string, unknown>, SCAN_REPORT_FIELDS);
  if (r) return `its scan report has no readable ${r}`;
  const c = unreadableField(set.criteria as unknown as Record<string, unknown>, CRITERIA_FIELDS);
  if (c) return `its criteria have no readable ${c}`;
  const n = unreadableField(set.scoreNames as unknown as Record<string, unknown>, SCORE_NAME_FIELDS);
  if (n) return `its score names have no readable ${n}`;
  return null;
}

/** JSON with every object's keys sorted: the same set with its keys in another order reads the same. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * The sets an envelope holds, if it is one of the current schema. A higher schema is
 * `futureSchema`; anything else, including a set that cannot be read or a repeated id, is `malformed`.
 */
function readEnvelope(value: unknown): { ok: true; sets: GuideSet[] } | { ok: false; kind: GuideSetErrorKind; why: string } {
  if (!isObject(value)) return { ok: false, kind: 'malformed', why: 'it is not a guide set envelope' };
  const { schema, sets } = value;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { ok: false, kind: 'malformed', why: 'it carries no schema version' };
  }
  if (schema > GUIDE_SET_DATABASE_SCHEMA) {
    return {
      ok: false,
      kind: 'futureSchema',
      why: `it was written with schema ${schema}, newer than the schema ${GUIDE_SET_DATABASE_SCHEMA} this version of MolBioCraft reads`,
    };
  }
  const unknown = Object.keys(value).filter((k) => k !== 'schema' && k !== 'sets');
  if (unknown.length > 0) return { ok: false, kind: 'malformed', why: unknownKeys(unknown) };
  if (!Array.isArray(sets)) return { ok: false, kind: 'malformed', why: 'it holds no list of guide sets' };
  const ids = new Set<string>();
  for (const [i, s] of sets.entries()) {
    const why = unreadableSet(s);
    if (why) return { ok: false, kind: 'malformed', why: `set ${i + 1} cannot be read: ${why}` };
    const id = (s as GuideSet).id;
    if (ids.has(id)) return { ok: false, kind: 'malformed', why: `the id ${id} appears twice` };
    ids.add(id);
  }
  return { ok: true, sets: sets as GuideSet[] };
}

export function openGuideSetDatabase(env: GuideSetDatabaseEnv = {}): GuideSetDatabase {
  const now = env.now ?? (() => new Date().toISOString());
  const newId = env.newId ?? defaultId;
  const engineVersion = env.engineVersion ?? (() => getRustEngineDiagnostics().version);

  function storage(): GuideSetStorage {
    if (env.storage) return env.storage;
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('localStorage is not available');
    return ls;
  }

  /** The stored sets, or why they cannot be read (and the stored value, when there is one). */
  function readStore():
    | { ok: true; sets: GuideSet[]; stored: boolean }
    | { ok: false; kind: GuideSetErrorKind; why: string; storedValue?: string } {
    let raw: string | null;
    try {
      raw = storage().getItem(GUIDE_SET_DATABASE_KEY);
    } catch (err) {
      return { ok: false, kind: 'unavailable', why: `storage is unavailable (${errorText(err)})` };
    }
    if (raw === null) return { ok: true, sets: [], stored: false };
    const unreadable = (kind: GuideSetErrorKind, why: string) => ({ ok: false as const, kind, why, storedValue: raw as string });
    if (raw.trim() === '') return unreadable('malformed', 'it holds an empty value');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return unreadable('malformed', 'it is not valid JSON');
    }
    const envelope = readEnvelope(parsed);
    if (!envelope.ok) return unreadable(envelope.kind, envelope.why);
    return { ok: true, sets: envelope.sets, stored: true };
  }

  function read(): GuideSetRead {
    const r = readStore();
    if (r.ok) return r;
    const tail = r.kind === 'unavailable' ? '.' : '. They are kept as they are.';
    return fail(r.kind, `The saved guide sets (${GUIDE_SET_DATABASE_KEY}) cannot be read: ${r.why}${tail}`, {
      ...(r.storedValue !== undefined ? { storedValue: r.storedValue } : {}),
    });
  }

  /** The stored sets for a change, or why nothing can be changed: the store re-read, never a copy. */
  function readForChange(): { ok: true; sets: GuideSet[] } | { ok: false; error: GuideSetError } {
    const current = read();
    if (current.ok) return { ok: true, sets: current.sets };
    return fail(current.error.kind, `Nothing was changed: ${current.error.message}`, {
      ...(current.error.storedValue !== undefined ? { storedValue: current.error.storedValue } : {}),
    });
  }

  /** Write the sets back and read them again: a write the storage refuses or does not keep is said. */
  function writeSets(sets: GuideSet[]): { ok: true } | { ok: false; error: GuideSetError } {
    const text = JSON.stringify({ schema: GUIDE_SET_DATABASE_SCHEMA, sets } satisfies GuideSetEnvelope);
    try {
      const s = storage();
      s.setItem(GUIDE_SET_DATABASE_KEY, text);
      if (s.getItem(GUIDE_SET_DATABASE_KEY) !== text) {
        return fail('notSaved', 'Nothing was changed: the storage did not keep the change.');
      }
    } catch (err) {
      return fail('notSaved', `Nothing was changed: the storage refused the write (${errorText(err)}).`);
    }
    return { ok: true };
  }

  const gone = (id: string) => fail('notSaved', `Nothing was changed: no guide set with the id ${id} is stored now.`);

  return {
    read,

    exportBackup() {
      const current = read();
      if (!current.ok) return current;
      // The sets as read from storage, which this store wrote with JSON.stringify: serialised again
      // they are the stored bytes.
      return {
        ok: true,
        value: JSON.stringify({ format: GUIDE_SET_BACKUP_FORMAT, schema: GUIDE_SET_DATABASE_SCHEMA, exportedAt: now(), sets: current.sets }),
      };
    },

    importBackup(file, text) {
      const refuse = (why: string) => fail('invalid', `${file} was not imported: ${why}. Nothing was changed.`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return refuse('it is not valid JSON');
      }
      if (!isObject(parsed) || parsed.format !== GUIDE_SET_BACKUP_FORMAT) {
        return refuse('it is not a MolBioCraft CRISPR guide set backup');
      }
      const { format: _format, exportedAt, ...envelope } = parsed;
      // The schema is read before the keys: a newer schema may add keys, and is named as newer.
      const fromFile = readEnvelope(envelope);
      if (!fromFile.ok) return refuse(fromFile.why);
      if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) return refuse('it carries no export time');
      for (const [i, set] of fromFile.sets.entries()) {
        const why = unimportableSet(set);
        if (why) return refuse(`set ${i + 1} (${set.id}) cannot be read: ${why}`);
      }
      const current = readStore();
      if (!current.ok) {
        return fail(current.kind, `${file} was not imported: the saved guide sets (${GUIDE_SET_DATABASE_KEY}) cannot be read: ${current.why}. Nothing was changed.`, {
          ...(current.storedValue !== undefined ? { storedValue: current.storedValue } : {}),
        });
      }
      const byId = new Map(current.sets.map((s) => [s.id, canonicalJson(s)]));
      const summary: GuideSetImport = { added: [], unchanged: [], kept: [] };
      const added: GuideSet[] = [];
      for (const set of fromFile.sets) {
        const storedText = byId.get(set.id);
        if (storedText === undefined) {
          added.push(set);
          summary.added.push(set.id);
        } else if (storedText === canonicalJson(set)) {
          summary.unchanged.push(set.id);
        } else {
          summary.kept.push(set.id);
        }
      }
      if (added.length === 0) return { ok: true, value: summary };
      const written = writeSets([...current.sets, ...added]);
      if (!written.ok) {
        return fail('notSaved', `${file} was not imported: ${written.error.message.replace(/^Nothing was changed: /, '').replace(/\.$/, '')}. Nothing was changed.`);
      }
      return { ok: true, value: summary };
    },

    listNotOpen(openDocumentIds) {
      const current = read();
      if (!current.ok) return { kind: 'unreadable', error: current.error };
      const open = new Set(openDocumentIds);
      const sets = current.sets.filter((s) => !open.has(s.documentId));
      return sets.length > 0 ? { kind: 'saved', sets } : { kind: 'none' };
    },

    rename(id, newName) {
      const name = newName.trim();
      if (name === '' || /[\r\n]/.test(name)) {
        return fail('invalid', 'Not renamed: a guide set needs a one-line name.');
      }
      const current = readForChange();
      if (!current.ok) return current;
      const at = current.sets.findIndex((s) => s.id === id);
      if (at < 0) return gone(id);
      // Spread over the stored set: every other key keeps its place and its value, so a value this
      // store wrote is written back byte for byte.
      const renamed: GuideSet = { ...current.sets[at], name };
      const written = writeSets(current.sets.map((s, i) => (i === at ? renamed : s)));
      return written.ok ? { ok: true, value: renamed } : written;
    },

    remove(id) {
      const current = readForChange();
      if (!current.ok) return current;
      const removed = current.sets.find((s) => s.id === id);
      if (!removed) return gone(id);
      const written = writeSets(current.sets.filter((s) => s.id !== id));
      return written.ok ? { ok: true, value: removed } : written;
    },

    writeRerun(id, rerun, document) {
      const current = readForChange();
      if (!current.ok) return current;
      const at = current.sets.findIndex((s) => s.id === id);
      if (at < 0) return gone(id);
      const stored = current.sets[at];
      if (stored.documentId !== document.id) {
        return fail('invalid', `Nothing was changed: "${stored.name}" was saved for another document, and a set is never rerun on another document.`);
      }
      let version: string;
      try {
        version = engineVersion();
      } catch (err) {
        return fail('invalid', `Nothing was changed: the engine version cannot be read (${errorText(err)}).`);
      }
      // The rerun as it came, through JSON, over the stored set: the kept fields stay where and as
      // they were stored.
      const fresh = JSON.parse(
        JSON.stringify({
          guides: rerun.guides,
          report: rerun.report,
          ranAt: rerun.ranAt,
          scoreNames: rerun.scoreNames,
          heuristicRule: rerun.heuristicRule,
        })
      ) as Pick<GuideSet, 'guides' | 'report' | 'ranAt' | 'scoreNames' | 'heuristicRule'>;
      const rewritten: GuideSet = {
        ...stored,
        ...fresh,
        documentName: document.name,
        sequenceRevision: document.revision,
        engineVersion: version,
        criteria: { ...stored.criteria, topology: rerun.topology },
      };
      const written = writeSets(current.sets.map((s, i) => (i === at ? rewritten : s)));
      return written.ok ? { ok: true, value: rewritten } : written;
    },

    listForDocument(documentId) {
      const current = read();
      if (!current.ok) return { kind: 'unreadable', error: current.error };
      const sets = current.sets.filter((s) => s.documentId === documentId);
      return sets.length > 0 ? { kind: 'saved', sets } : { kind: 'none' };
    },

    save(run, document) {
      const name = run.name.trim();
      if (name === '' || /[\r\n]/.test(name)) {
        return fail('invalid', 'Nothing was saved: a guide set needs a one-line name.');
      }
      const current = read();
      if (!current.ok) {
        return fail(current.error.kind, `Nothing was saved: ${current.error.message}`, {
          ...(current.error.storedValue !== undefined ? { storedValue: current.error.storedValue } : {}),
        });
      }
      let version: string;
      try {
        version = engineVersion();
      } catch (err) {
        return fail('invalid', `Nothing was saved: the engine version cannot be read (${errorText(err)}).`);
      }
      // The run as it came, through JSON: what is stored is exactly what a later read returns.
      const set: GuideSet = JSON.parse(
        JSON.stringify({
          id: newId(),
          name,
          documentId: document.id,
          documentName: document.name,
          sequenceRevision: document.revision,
          engineVersion: version,
          ranAt: run.ranAt,
          savedAt: now(),
          criteria: run.criteria,
          report: run.report,
          guides: run.guides,
          scoreNames: run.scoreNames,
          heuristicRule: run.heuristicRule,
        } satisfies GuideSet)
      );
      const envelope: GuideSetEnvelope = { schema: GUIDE_SET_DATABASE_SCHEMA, sets: [...current.sets, set] };
      const text = JSON.stringify(envelope);
      try {
        const s = storage();
        s.setItem(GUIDE_SET_DATABASE_KEY, text);
        if (s.getItem(GUIDE_SET_DATABASE_KEY) !== text) {
          return fail('notSaved', 'Nothing was saved: the storage did not keep the guide set.');
        }
      } catch (err) {
        return fail('notSaved', `Nothing was saved: the storage refused the write (${errorText(err)}).`);
      }
      return { ok: true, value: set };
    },
  };
}
