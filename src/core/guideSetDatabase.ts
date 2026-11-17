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

export interface GuideSetDatabase {
  read(): GuideSetRead;
  /** The sets saved for this document id, oldest first. */
  listForDocument(documentId: string): GuideSetList;
  /** Keep a completed run under its name. It writes only this store's key, never the document. */
  save(run: GuideSetRun, document: GuideSetDocumentRef): GuideSetResult<GuideSet>;
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

  function read(): GuideSetRead {
    let raw: string | null;
    try {
      raw = storage().getItem(GUIDE_SET_DATABASE_KEY);
    } catch (err) {
      return fail('unavailable', `The saved guide sets (${GUIDE_SET_DATABASE_KEY}) cannot be read: storage is unavailable (${errorText(err)}).`);
    }
    if (raw === null) return { ok: true, sets: [], stored: false };
    const stored = raw;
    const unreadable = (kind: GuideSetErrorKind, why: string) =>
      fail(kind, `The saved guide sets (${GUIDE_SET_DATABASE_KEY}) cannot be read: ${why}. They are kept as they are.`, {
        storedValue: stored,
      });
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

  return {
    read,

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
