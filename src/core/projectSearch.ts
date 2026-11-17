// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Project text search (US-01M7DVC0): resolves a search scope to documents and matches a word
 * field by field, naming the field each match is in. Pure: the App passes the documents and
 * folders; nothing here reads tabs, storage or residues.
 */

import type { SequenceDocument } from '../types/bio';
import { documentsInFolder, PROJECT_ROOT, type ExplorerFolder } from './projectExplorer';

export type SearchScope = 'This folder only' | 'Folder and subfolders' | 'Entire project';

export interface SearchContext {
  /** Every document of the catalog, deleted ones included. */
  documents: SequenceDocument[];
  /** Every explorer folder, hidden ones included. */
  folders: ExplorerFolder[];
  deletedIds: string[];
  favoriteIds: string[];
}

export type Refusal<R extends string> = { refused: R };

const ROOT_NAMES = new Set([PROJECT_ROOT, 'All Documents', 'Local']);
const FAVORITES = 'Favorites';
const DELETED = 'Deleted Items';
const ALL_SCOPES: SearchScope[] = ['This folder only', 'Folder and subfolders', 'Entire project'];
const PATH_SEPARATOR = ' › ';

export function scopesOffered(folderId: string): SearchScope[] {
  return folderId === FAVORITES || folderId === DELETED ? ['This folder only'] : [...ALL_SCOPES];
}

/** The folder labels from the top folder under the root down to `folderId`. */
function folderPathOf(folderId: string, folders: ExplorerFolder[]): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const labels: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    labels.unshift(current.label);
    current = byId.get(current.parent);
  }
  return labels.join(PATH_SEPARATOR);
}

/** The path of the folder a document is filed in: its folder's own, or that of the folder whose aliases hold it. */
export function documentFolderPath(folder: string, folders: ExplorerFolder[]): string {
  if (ROOT_NAMES.has(folder)) return PROJECT_ROOT;
  const owner = folders.find((f) => f.id === folder) ?? folders.find((f) => f.matchFolders.includes(folder));
  return owner ? folderPathOf(owner.id, folders) : folder;
}

export function resolveSearchScope(
  folderId: string, scope: SearchScope, ctx: SearchContext,
): { label: string; documents: SequenceDocument[] } | Refusal<'scope not offered' | 'unknown folder'> {
  if (!scopesOffered(folderId).includes(scope)) return { refused: 'scope not offered' };
  const deleted = new Set(ctx.deletedIds);
  if (folderId === DELETED) {
    return { label: 'Deleted Items (trash)', documents: ctx.documents.filter((d) => deleted.has(d.id)) };
  }
  const live = ctx.documents.filter((d) => !deleted.has(d.id));
  if (folderId === FAVORITES) {
    const favorites = new Set(ctx.favoriteIds);
    return { label: 'Favorites only', documents: live.filter((d) => favorites.has(d.id)) };
  }
  const isRoot = ROOT_NAMES.has(folderId);
  const folder = ctx.folders.find((f) => f.id === folderId);
  if (!isRoot && !folder) return { refused: 'unknown folder' };
  if (scope === 'Entire project' || (isRoot && scope === 'Folder and subfolders')) {
    return { label: 'Entire project', documents: live };
  }
  if (isRoot) {
    return { label: `${PROJECT_ROOT} only`, documents: live.filter((d) => ROOT_NAMES.has(d.folder)) };
  }
  const path = folderPathOf(folderId, ctx.folders);
  if (scope === 'Folder and subfolders') {
    return { label: `${path} and subfolders`, documents: documentsInFolder(folderId, ctx.folders, live) };
  }
  const own = new Set([folderId, ...(folder?.matchFolders ?? [])]);
  return { label: `${path} only`, documents: live.filter((d) => own.has(d.folder)) };
}

interface FieldValue { field: string; value: string }

export type TextSearchFieldId =
  | 'name' | 'accession' | 'description' | 'notes' | 'metadata' | 'featureName' | 'featureType'
  | 'featureQualifier' | 'featureNotes' | 'primerName' | 'historyOperation' | 'historyDescription';

/** Metadata keys that are not searched as metadata values: Notes is its own field, Newick is tree text. */
const NOT_METADATA_VALUES = new Set(['Notes', 'Newick']);

/** The fields text search reads, in the order a document's hits are reported. */
export const TEXT_SEARCH_FIELDS: readonly { id: TextSearchFieldId; label: string; values: (d: SequenceDocument) => FieldValue[] }[] = [
  { id: 'name', label: 'document name', values: (d) => [{ field: 'Name', value: d.name }] },
  { id: 'accession', label: 'accession', values: (d) => [{ field: 'Accession', value: d.accession }] },
  { id: 'description', label: 'description', values: (d) => [{ field: 'Description', value: d.description }] },
  {
    id: 'notes', label: 'Notes',
    values: (d) => {
      const notes = d.docMetadata?.Notes;
      return notes === undefined ? [] : [{ field: 'Notes', value: String(notes) }];
    },
  },
  {
    id: 'metadata', label: 'each metadata value (by its key) other than Notes and Newick',
    values: (d) => Object.entries(d.docMetadata ?? {}).filter(([key]) => !NOT_METADATA_VALUES.has(key))
      .map(([key, value]) => ({ field: `metadata ${key}`, value: String(value) })),
  },
  { id: 'featureName', label: 'feature name', values: (d) => d.features.map((f) => ({ field: `name of feature ${f.name}`, value: f.name })) },
  { id: 'featureType', label: 'feature type', values: (d) => d.features.map((f) => ({ field: `type of feature ${f.name}`, value: f.type })) },
  {
    id: 'featureQualifier', label: 'each feature qualifier value',
    values: (d) => d.features.flatMap((f) => Object.entries(f.qualifiers ?? {})
      .map(([key, value]) => ({ field: `qualifier /${key} of feature ${f.name}`, value }))),
  },
  {
    id: 'featureNotes', label: 'feature notes',
    values: (d) => d.features.flatMap((f) => f.notes === undefined ? [] : [{ field: `notes of feature ${f.name}`, value: f.notes }]),
  },
  { id: 'primerName', label: 'document primer names', values: (d) => d.primers.map((p) => ({ field: `name of primer ${p.name}`, value: p.name })) },
  {
    id: 'historyOperation', label: 'history operation',
    values: (d) => d.history.map((h, i) => ({ field: `operation of history step ${i + 1}`, value: h.operation })),
  },
  {
    id: 'historyDescription', label: 'history description',
    values: (d) => d.history.map((h, i) => ({ field: `description of history step ${i + 1}`, value: h.description })),
  },
];

/** What text mode does not read. */
export const TEXT_NOT_SEARCHED = ['residues', 'Newick text', 'chromatogram traces'] as const;

export const TEXT_SEARCH_STATEMENT =
  `Text search looks in: ${TEXT_SEARCH_FIELDS.map((f) => f.label).join(', ')}. `
  + `Not searched in this mode: ${TEXT_NOT_SEARCHED.join(', ')}.`;

export interface TextHit {
  fieldId: TextSearchFieldId;
  /** The field the match is in, for example "qualifier /gene of feature lacZα". */
  field: string;
  /** The field's own value, unmodified. */
  value: string;
  /** UTF-16 offsets into `value`: `value.slice(start, end)` is the match. */
  start: number;
  end: number;
}

export interface DocumentTextResult {
  documentId: string;
  documentName: string;
  folderPath: string;
  hits: TextHit[];
}

/**
 * Lower-cases code point by code point, keeping any code point whose lower case has another
 * length (such as "İ"), so every index in the result is the same index in `text`.
 */
function foldSameLength(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

function matchesIn(value: string, foldedQuery: string): [number, number][] {
  const folded = foldSameLength(value);
  const found: [number, number][] = [];
  for (let at = folded.indexOf(foldedQuery); at !== -1; at = folded.indexOf(foldedQuery, at + foldedQuery.length)) {
    found.push([at, at + foldedQuery.length]);
  }
  return found;
}

/**
 * Case-insensitive substring search within each field value of `documents`. An empty or
 * whitespace-only query is refused and reads no document.
 */
export function searchText(
  query: string, documents: SequenceDocument[], folders: ExplorerFolder[],
): { query: string; results: DocumentTextResult[] } | Refusal<'empty query'> {
  const trimmed = query.trim();
  if (trimmed === '') return { refused: 'empty query' };
  const foldedQuery = foldSameLength(trimmed);
  const results: DocumentTextResult[] = [];
  for (const doc of documents) {
    const hits: TextHit[] = [];
    for (const field of TEXT_SEARCH_FIELDS) {
      for (const { field: name, value } of field.values(doc)) {
        for (const [start, end] of matchesIn(value, foldedQuery)) {
          hits.push({ fieldId: field.id, field: name, value, start, end });
        }
      }
    }
    if (hits.length > 0) {
      results.push({ documentId: doc.id, documentName: doc.name, folderPath: documentFolderPath(doc.folder, folders), hits });
    }
  }
  return { query: trimmed, results };
}
