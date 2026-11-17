// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Advanced search and saved searches for the document table: extra search fields beyond the
 * table columns — residues on both strands,
 * annotation names/types, any metadata value — a whole-project scope, and named searches kept
 * in this browser's local storage.
 *
 * Search Project's own saved searches (US-01M7DV4Y) are kept apart under mbc.projectSearches.v1 with
 * a schema version, so an older build's table menu, which reads any mbc.savedSearches.v1 entry with a
 * name, never reads one. Each reader tells a store never written, one written (perhaps empty) and one
 * that cannot be read (by key and reason) apart; a save to an unreadable store is refused so the
 * stored value is kept, and only discardUnreadableSearches replaces it. Each save and delete re-reads
 * its store first and reports a write the browser refused.
 */

import type { SequenceDocument } from '../types/bio';
import type { TableFilterRule } from '../components/WorkbenchSmartTable';
import { PROJECT_ROOT } from './projectExplorer';
import { scopesOffered, type CombineChoice, type SearchMode, type SearchScope } from './projectSearch';

export const SEARCH_FIELDS = [
  { id: '__residues__', label: 'Residues (both strands)' },
  { id: '__annotations__', label: 'Annotation name / type' },
  { id: '__metadata__', label: 'Any metadata value' },
] as const;

export const isSearchField = (colId: string) => SEARCH_FIELDS.some((f) => f.id === colId);

const COMP: Record<string, string> = { A: 'T', T: 'A', U: 'A', G: 'C', C: 'G', N: 'N', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D' };

/** Text a search field matches against. Residues: the sequence and its reverse complement. */
export function searchFieldText(d: SequenceDocument, colId: string): string {
  if (colId === '__residues__') {
    const s = d.sequence.toUpperCase();
    if (d.moleculeType === 'Protein') return s;
    const rc = [...s].reverse().map((c) => COMP[c] ?? c).join('');
    return `${s}\u0000${rc}`;
  }
  if (colId === '__annotations__') return d.features.map((f) => `${f.name} ${f.type}`).join('\u0000');
  if (colId === '__metadata__') {
    return Object.entries(d.docMetadata ?? {}).filter(([k]) => k !== 'Notes' && k !== 'Newick').map(([k, v]) => `${k}: ${String(v)}`).join('\u0000');
  }
  return '';
}

export interface SavedSearch {
  id: string;
  name: string;
  quickFilter: string;
  rules: TableFilterRule[];
  matchMode: 'all' | 'any';
  /** true = whole project, false = the selected folder. */
  wholeProject: boolean;
}

export const TABLE_SEARCHES_KEY = 'mbc.savedSearches.v1';
export const PROJECT_SEARCHES_KEY = 'mbc.projectSearches.v1';
/** The project-search store's schema this build reads and writes. */
export const PROJECT_SEARCHES_SCHEMA = 1;

/** A store never written, a store read (its entries, perhaps none), or one that cannot be read and why. */
export type StoreRead<T> =
  | { state: 'missing'; searches: T[] }
  | { state: 'read'; searches: T[] }
  | { state: 'unreadable'; key: string; reason: string };

/** A failed write or a refusal, as the sentence the user is shown; else the store as written. */
export type StoreWrite<T> = { ok: true; searches: T[] } | { ok: false; sentence: string };

export const notSavedUnreadable = (name: string) => `"${name}" was not saved: the saved searches cannot be read.`;
export const notDeletedUnreadable = (name: string) => `"${name}" was not deleted: the saved searches cannot be read.`;
export const notSavedRefused = (name: string) => `"${name}" was not saved: browser storage refused the write.`;
export const notDeletedRefused = (name: string) => `"${name}" was not deleted: browser storage refused the write.`;

/** The sentence Search Project shows for a store that cannot be read. */
export function unreadableStoreSentence(read: { key: string; reason: string }): string {
  const what = read.key === PROJECT_SEARCHES_KEY ? 'Saved project searches' : 'Table filter searches';
  return `${what} cannot be read (${read.key}): ${read.reason}.`;
}

/** The raw stored text, or why it could not be fetched. `null` text: never written. */
function fetchRaw(key: string): { text: string | null } | { reason: string } {
  try {
    return { text: localStorage.getItem(key) };
  } catch {
    return { reason: 'browser storage refused the read' };
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const newerSchema = (n: number, reads: number) => `it was written in schema ${n}, newer than this build reads (schema ${reads})`;

/** The table filter's v1 store: a list of entries, each kept when it has a name, as before. */
export function readTableSearches(): StoreRead<SavedSearch> {
  const raw = fetchRaw(TABLE_SEARCHES_KEY);
  if ('reason' in raw) return { state: 'unreadable', key: TABLE_SEARCHES_KEY, reason: raw.reason };
  if (raw.text === null) return { state: 'missing', searches: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw.text);
  } catch {
    return { state: 'unreadable', key: TABLE_SEARCHES_KEY, reason: 'it is not valid JSON' };
  }
  if (!Array.isArray(value)) {
    const schema = value && typeof value === 'object' ? (value as { schema?: unknown }).schema : undefined;
    const reason = typeof schema === 'number' ? newerSchema(schema, 1) : 'it is not a list of saved searches';
    return { state: 'unreadable', key: TABLE_SEARCHES_KEY, reason };
  }
  return { state: 'read', searches: (value as SavedSearch[]).filter((s) => s && typeof s.name === 'string') };
}

/** The table menu's list: the v1 entries, or none when the store cannot be read (a save then refuses). */
export function loadSavedSearches(): SavedSearch[] {
  const read = readTableSearches();
  return read.state === 'unreadable' ? [] : read.searches;
}

/** Adds or replaces (same name, case-insensitive) an entry, keeping the replaced one's id. */
function upsertByName<T extends { id: string; name: string }>(list: T[], s: Omit<T, 'id'>, prefix: string): T[] {
  const existing = list.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
  let id = existing?.id ?? `${prefix}-${Date.now().toString(36)}`;
  for (let n = 2; !existing && list.some((x) => x.id === id); n++) id = `${prefix}-${Date.now().toString(36)}-${n}`;
  const entry = { ...s, id } as T;
  return existing ? list.map((x) => (x.id === existing.id ? entry : x)) : [...list, entry];
}

/** Adds or replaces (same name, case-insensitive) a saved search. */
export function upsertSavedSearch(list: SavedSearch[], s: Omit<SavedSearch, 'id'>): SavedSearch[] {
  return upsertByName(list, s, 'ss');
}

/** Saves a table filter search into the store as it reads now; refused while it cannot be read. */
export function saveTableSearch(s: Omit<SavedSearch, 'id'>): StoreWrite<SavedSearch> {
  const read = readTableSearches();
  if (read.state === 'unreadable') return { ok: false, sentence: notSavedUnreadable(s.name) };
  const next = upsertSavedSearch(read.searches, s);
  return write(TABLE_SEARCHES_KEY, next) ? { ok: true, searches: next } : { ok: false, sentence: notSavedRefused(s.name) };
}

/** Deletes a table filter search from the store as it reads now, saying so when the write fails. */
export function deleteTableSearch(id: string, name: string): StoreWrite<SavedSearch> {
  const read = readTableSearches();
  if (read.state === 'unreadable') return { ok: false, sentence: notDeletedUnreadable(name) };
  const next = read.searches.filter((x) => x.id !== id);
  return write(TABLE_SEARCHES_KEY, next) ? { ok: true, searches: next } : { ok: false, sentence: notDeletedRefused(name) };
}

/** The filter fields as typed in Search Project; an empty field sets no filter. */
export interface ProjectSearchFilterFields {
  documentType: string; topology: '' | 'circular' | 'linear'; lengthMin: string; lengthMax: string;
  modifiedFrom: string; modifiedTo: string; annotationType: string;
}

/** A saved Search Project search: what to search for and where, never its results. */
export interface ProjectSavedSearch {
  id: string;
  name: string;
  conditions: { mode: SearchMode; query: string }[];
  combine: CombineChoice;
  bothStrands: boolean;
  filters: ProjectSearchFilterFields;
  includePrimers: boolean;
  scope: SearchScope;
  /** The explorer folder's id the panel was open on, never its label, so a rename keeps it. */
  folderId: string;
}

const MODES: readonly string[] = ['Text', 'Nucleotide motif', 'Protein motif'];
const SCOPES: readonly string[] = ['This folder only', 'Folder and subfolders', 'Entire project'];
const FILTER_KEYS: (keyof ProjectSearchFilterFields)[] = ['documentType', 'topology', 'lengthMin', 'lengthMax', 'modifiedFrom', 'modifiedTo', 'annotationType'];

function isProjectSearch(x: unknown): x is ProjectSavedSearch {
  const s = x as ProjectSavedSearch;
  return Boolean(s) && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string'
    && Array.isArray(s.conditions) && s.conditions.length > 0
    && s.conditions.every((c) => c && MODES.includes(c.mode) && typeof c.query === 'string')
    && (s.combine === 'ALL' || s.combine === 'ANY') && typeof s.bothStrands === 'boolean' && typeof s.includePrimers === 'boolean'
    && SCOPES.includes(s.scope) && typeof s.folderId === 'string'
    && Boolean(s.filters) && typeof s.filters === 'object' && FILTER_KEYS.every((k) => typeof s.filters[k] === 'string');
}

/** Search Project's store: `{ schema, searches }`; any entry it cannot read makes the store unreadable. */
export function readProjectSearches(): StoreRead<ProjectSavedSearch> {
  const raw = fetchRaw(PROJECT_SEARCHES_KEY);
  const unreadable = (reason: string): StoreRead<ProjectSavedSearch> => ({ state: 'unreadable', key: PROJECT_SEARCHES_KEY, reason });
  if ('reason' in raw) return unreadable(raw.reason);
  if (raw.text === null) return { state: 'missing', searches: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw.text);
  } catch {
    return unreadable('it is not valid JSON');
  }
  const store = value as { schema?: unknown; searches?: unknown };
  if (!store || typeof store !== 'object' || typeof store.schema !== 'number') return unreadable('it holds no schema version');
  if (store.schema > PROJECT_SEARCHES_SCHEMA) return unreadable(newerSchema(store.schema, PROJECT_SEARCHES_SCHEMA));
  if (store.schema !== PROJECT_SEARCHES_SCHEMA || !Array.isArray(store.searches)) return unreadable(`it is not a schema ${PROJECT_SEARCHES_SCHEMA} store of saved searches`);
  const bad = store.searches.findIndex((s) => !isProjectSearch(s));
  if (bad >= 0) return unreadable(`entry ${bad + 1} is not a saved project search`);
  return { state: 'read', searches: store.searches as ProjectSavedSearch[] };
}

const writeProject = (list: ProjectSavedSearch[]) => write(PROJECT_SEARCHES_KEY, { schema: PROJECT_SEARCHES_SCHEMA, searches: list });

/** Saves (or replaces by name, case-insensitive) a project search; refused while the store cannot be read. */
export function saveProjectSearch(s: Omit<ProjectSavedSearch, 'id'>): StoreWrite<ProjectSavedSearch> {
  const read = readProjectSearches();
  if (read.state === 'unreadable') return { ok: false, sentence: notSavedUnreadable(s.name) };
  const next = upsertByName(read.searches, s, 'ps');
  return writeProject(next) ? { ok: true, searches: next } : { ok: false, sentence: notSavedRefused(s.name) };
}

/** Deletes a project search from the store as it reads now, saying so when the write fails. */
export function deleteProjectSearch(id: string, name: string): StoreWrite<ProjectSavedSearch> {
  const read = readProjectSearches();
  if (read.state === 'unreadable') return { ok: false, sentence: notDeletedUnreadable(name) };
  const next = read.searches.filter((x) => x.id !== id);
  return writeProject(next) ? { ok: true, searches: next } : { ok: false, sentence: notDeletedRefused(name) };
}

/**
 * Replaces each store that cannot be read with an empty one: the only path that overwrites one.
 * Returns the keys it could not write.
 */
export function discardUnreadableSearches(): string[] {
  const failed: string[] = [];
  if (readProjectSearches().state === 'unreadable' && !writeProject([])) failed.push(PROJECT_SEARCHES_KEY);
  if (readTableSearches().state === 'unreadable' && !write(TABLE_SEARCHES_KEY, [])) failed.push(TABLE_SEARCHES_KEY);
  return failed;
}

/** Folders that exist whatever the explorer holds. */
const FIXED_FOLDERS = new Set([PROJECT_ROOT, 'Favorites', 'Deleted Items']);

/**
 * The folder a saved search runs from, found by id: the panel's own for Entire project when it offers
 * that scope (else the project root); Favorites, Deleted Items and the root always; any other only
 * while the explorer still holds it.
 */
export function savedSearchFolder(s: Pick<ProjectSavedSearch, 'scope' | 'folderId'>, panelFolderId: string, folders: readonly { id: string }[]): { folderId: string } | { missing: true } {
  if (s.scope === 'Entire project') return { folderId: scopesOffered(panelFolderId).includes('Entire project') ? panelFolderId : PROJECT_ROOT };
  if (FIXED_FOLDERS.has(s.folderId) || folders.some((f) => f.id === s.folderId)) return { folderId: s.folderId };
  return { missing: true };
}

/** The sentence a saved search whose folder no longer exists gives in place of a run. */
export const folderGoneSentence = (name: string) => `The folder this search was saved for no longer exists, so "${name}" was not run.`;
