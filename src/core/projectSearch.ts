// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Project text search (US-01M7DVC0): resolves a search scope to documents and matches a word
 * field by field, naming the field each match is in. Pure: the App passes the documents and
 * folders; nothing here reads tabs or storage, and text search never reads residues.
 *
 * Motif search (US-01M7DVE7) is the residue search: it sorts each document into searched or not
 * searched (with the reason), and hands each searched document's sequence to the IUPAC motif
 * engine the caller passes (US-01M7DVBH's search_iupac_motif), which finds and counts the hits.
 *
 * Conditions and filters (US-01M7DVHA): a run may hold several conditions, each a mode and a
 * query, combined with ALL or ANY as evaluateTableRowFilters combines its rows, and filters that
 * narrow the documents searched whatever that choice (D0126).
 */

import type { SequenceDocument, SequenceFeature } from '../types/bio';
import type { IupacMotifHit, IupacMotifSearch, MotifSearchMode } from '../lib/rustBioEngine';
import { isContigSummaryRecord } from './contigSummary';
import { isTreeDocument } from './documentViews';
import { documentsInFolder, PROJECT_ROOT, type ExplorerFolder } from './projectExplorer';
import { inferDocumentTypeLabel } from './workbenchBatchOperations';

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

/** A field's value, and the feature, primer or history step it belongs to, so a hit can find it again (US-01M7DV78). */
interface FieldValue { field: string; value: string; featureId?: string; primerId?: string; historyIndex?: number }

export type TextSearchFieldId =
  | 'name' | 'accession' | 'description' | 'notes' | 'metadata' | 'featureName' | 'featureType'
  | 'featureQualifier' | 'featureNotes' | 'primerName' | 'historyOperation' | 'historyDescription';

/** Metadata keys that are not searched as metadata values: Notes is its own field, Newick is tree text. */
const NOT_METADATA_VALUES = new Set(['Notes', 'Newick']);

/**
 * Residue-valued qualifiers, not searched as text (D0180): /translation and every key ending in
 * 'sequence', the set the GenBank writer breaks as residues (flatfiles.rs qualifier_break).
 */
const isResidueQualifier = (key: string) => key === 'translation' || key.endsWith('sequence');

const featureLabel = (f: SequenceFeature) => (f.name.trim() === '' ? '(unnamed feature)' : f.name);

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
  { id: 'featureName', label: 'feature name', values: (d) => d.features.map((f) => ({ field: `name of feature ${featureLabel(f)}`, value: f.name, featureId: f.id })) },
  { id: 'featureType', label: 'feature type', values: (d) => d.features.map((f) => ({ field: `type of feature ${featureLabel(f)}`, value: f.type, featureId: f.id })) },
  {
    id: 'featureQualifier', label: "each feature qualifier value other than /translation and keys ending in 'sequence'",
    values: (d) => d.features.flatMap((f) => Object.entries(f.qualifiers ?? {}).filter(([key]) => !isResidueQualifier(key))
      .map(([key, value]) => ({ field: `qualifier /${key} of feature ${featureLabel(f)}`, value, featureId: f.id }))),
  },
  {
    id: 'featureNotes', label: 'feature notes',
    values: (d) => d.features.flatMap((f) => f.notes === undefined ? [] : [{ field: `notes of feature ${featureLabel(f)}`, value: f.notes, featureId: f.id }]),
  },
  { id: 'primerName', label: 'document primer names', values: (d) => d.primers.map((p) => ({ field: `name of primer ${p.name}`, value: p.name, primerId: p.id })) },
  {
    id: 'historyOperation', label: 'history operation',
    values: (d) => d.history.map((h, i) => ({ field: `operation of history step ${i + 1}`, value: h.operation, historyIndex: i })),
  },
  {
    id: 'historyDescription', label: 'history description',
    values: (d) => d.history.map((h, i) => ({ field: `description of history step ${i + 1}`, value: h.description, historyIndex: i })),
  },
];

/** What text mode does not read. */
export const TEXT_NOT_SEARCHED = ['residues', 'Newick text', 'chromatogram traces'] as const;

export const TEXT_SEARCH_STATEMENT =
  `Text search looks in: ${TEXT_SEARCH_FIELDS.map((f) => f.label).join(', ')}. `
  + `Not searched in this mode: ${TEXT_NOT_SEARCHED.join(', ')}, `
  + "including residue-valued feature qualifiers (/translation and every key ending in 'sequence'). "
  + "Accents and Unicode forms are not folded: 'e' does not match 'é', and 'é' finds only the same form, precomposed or decomposed.";

export interface TextHit {
  fieldId: TextSearchFieldId;
  /** The field the match is in, for example "qualifier /gene of feature lacZα". */
  field: string;
  /** The field's own value, unmodified. */
  value: string;
  /** UTF-16 offsets into `value`: `value.slice(start, end)` is the match. */
  start: number;
  end: number;
  /** The id of the feature the field belongs to: two features of one name are told apart by it. */
  featureId?: string;
  /** The id of the primer whose name the match is in. */
  primerId?: string;
  /** The 0-based index of the history step the match is in. */
  historyIndex?: number;
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

const COMBINING_MARK = /^\p{M}/u;

/** Whether the code point at `index` of `text` is a combining mark (false past the end). */
const markAt = (text: string, index: number) => index < text.length && COMBINING_MARK.test(text.slice(index, index + 2));

/**
 * Non-overlapping matches of `foldedQuery` in `value`. A match never starts on a combining mark
 * and never ends right before one, so a base letter is never matched apart from its accent (D0180).
 */
function matchesIn(value: string, foldedQuery: string): [number, number][] {
  const folded = foldSameLength(value);
  const found: [number, number][] = [];
  let at = folded.indexOf(foldedQuery);
  while (at !== -1) {
    const end = at + foldedQuery.length;
    if (markAt(value, at) || markAt(value, end)) {
      at = folded.indexOf(foldedQuery, at + 1);
    } else {
      found.push([at, end]);
      at = folded.indexOf(foldedQuery, end);
    }
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
      for (const { field: name, value, ...ids } of field.values(doc)) {
        for (const [start, end] of matchesIn(value, foldedQuery)) {
          hits.push({ fieldId: field.id, field: name, value, start, end, ...ids });
        }
      }
    }
    if (hits.length > 0) {
      results.push({ documentId: doc.id, documentName: doc.name, folderPath: documentFolderPath(doc.folder, folders), hits });
    }
  }
  return { query: trimmed, results };
}

// ─── Motif search (US-01M7DVE7) ───

export type MotifMode = 'Nucleotide motif' | 'Protein motif';
export type SearchMode = 'Text' | MotifMode;
/** The panel's modes, Text first and the default. */
export const SEARCH_MODES: readonly SearchMode[] = ['Text', 'Nucleotide motif', 'Protein motif'];

export const NUCLEOTIDE_MOTIF_STATEMENT =
  'Motif search reads the bases of each DNA and RNA document by IUPAC codes, on both strands when Both strands is on, '
  + 'and across the origin of a circular molecule. A hit is definite when every base is one the motif allows there, '
  + 'and possible when an ambiguous base in the document, such as N, may or may not be one. '
  + 'Not searched in this mode: protein documents, alignments, trees, text documents, enzyme sets and contig summaries.';

export const PROTEIN_MOTIF_STATEMENT =
  'Motif search reads the residues of each protein document by IUPAC codes (B, Z, J, X), on one strand. '
  + 'A hit is definite when every residue is one the motif allows there, and possible when an ambiguous residue in '
  + 'the document, such as X, may or may not be one. Not searched in this mode: DNA and RNA documents (translated '
  + 'search is not available), alignments, trees, text documents, enzyme sets and contig summaries.';

/** The most hits the engine is asked to list for one document; its counts still cover the whole molecule. */
export const MOTIF_HITS_PER_DOCUMENT = 1000;

/** motifNotSearchedReason's words for a record with no residues that is no other kind. */
export const EMPTY_SEQUENCE = 'empty sequence';

/**
 * Why `doc` is not searched in `mode`, or null when it is. An alignment carries its first row in
 * `sequence`, so it is named by its kind, never by having a sequence.
 */
export function motifNotSearchedReason(doc: SequenceDocument, mode: MotifMode): string | null {
  const documentType = String(doc.docMetadata?.['Document Type'] ?? '');
  if (isTreeDocument(doc)) return 'tree (no sequence)';
  if (documentType === 'Text Document') return 'text document (no sequence)';
  if (documentType === 'Enzyme Set') return 'enzyme set (no sequence)';
  if (doc.documentKind === 'alignment' || (doc.alignmentMeta?.sequences?.length ?? 0) > 0) {
    return 'alignment (motif search reads single sequences)';
  }
  if (isContigSummaryRecord(doc)) return 'contig summary (annotations only, no bases)';
  if (doc.sequence.length === 0) return EMPTY_SEQUENCE;
  if (mode === 'Nucleotide motif' && doc.moleculeType === 'Protein') return 'protein sequence (use Protein motif)';
  if (mode === 'Protein motif' && doc.moleculeType !== 'Protein') return 'translated search is not available';
  return null;
}

/** The engine call the search makes, `searchIupacMotifRust`'s shape. */
export type MotifEngine = (
  seq: string,
  query: string,
  options: { mode: MotifSearchMode; circular: boolean; searchBothStrands: boolean; maxHits: number },
) => IupacMotifSearch;

export interface MotifHit extends IupacMotifHit {
  /** The top-strand letters of the hit as the document stores them, start..L then 1..end across the origin. */
  letters: string;
}

export interface DocumentMotifResult {
  documentId: string;
  documentName: string;
  folderPath: string;
  /** The first MOTIF_HITS_PER_DOCUMENT hits by start. */
  hits: MotifHit[];
  /** The engine's counts over the whole molecule, never the listed hits. */
  totalHits: number;
  definiteHits: number;
  possibleHits: number;
  warnings: string[];
}

export interface MotifNotSearched {
  documentId: string;
  documentName: string;
  folderPath: string;
  reason: string;
}

export type MotifSearchOutcome =
  | Refusal<'empty query'>
  /** The engine refused the query itself, so no document was searched. */
  | { queryRefused: string }
  /** The engine could not run the op at all (not loaded, or a build without it). */
  | { engineUnavailable: string }
  | { query: string; searched: number; results: DocumentMotifResult[]; notSearched: MotifNotSearched[] };

const ENGINE_REASON = /^\[MolBioCraft Rust Engine :: [^\]]*\] ([\s\S]*)$/;
const UNKNOWN_OP = 'Unknown MolBioCraft Rust bioinformatics RPC operation';

/** The top-strand letters from 1-based `start` to `end`, wrapping past the end when `start > end`. */
function hitLetters(seq: string, start: number, end: number): string {
  return start <= end ? seq.slice(start - 1, end) : seq.slice(start - 1) + seq.slice(0, end);
}

/**
 * Searches each document of `documents` that `mode` reads, through `engine`, at most
 * MOTIF_HITS_PER_DOCUMENT hits each. A document the engine refuses is listed as not searched with
 * the engine's reason and the search goes on; a refusal of the query itself, or an engine that
 * cannot run the op, ends it with that answer and no document counted as searched.
 */
export function searchMotif(
  query: string,
  documents: SequenceDocument[],
  folders: ExplorerFolder[],
  mode: MotifMode,
  bothStrands: boolean,
  engine: MotifEngine,
): MotifSearchOutcome {
  const trimmed = query.trim();
  if (trimmed === '') return { refused: 'empty query' };
  const results: DocumentMotifResult[] = [];
  const notSearched: MotifNotSearched[] = [];
  let searched = 0;
  for (const doc of documents) {
    const where = { documentId: doc.id, documentName: doc.name, folderPath: documentFolderPath(doc.folder, folders) };
    const skip = motifNotSearchedReason(doc, mode);
    if (skip !== null) {
      notSearched.push({ ...where, reason: skip });
      continue;
    }
    let answer: IupacMotifSearch;
    try {
      answer = engine(doc.sequence, trimmed, {
        mode: mode === 'Nucleotide motif' ? 'nucleotide' : 'protein',
        circular: mode === 'Nucleotide motif' && doc.topology === 'circular',
        searchBothStrands: mode === 'Nucleotide motif' && bothStrands,
        maxHits: MOTIF_HITS_PER_DOCUMENT,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const engineReason = ENGINE_REASON.exec(message)?.[1];
      if (engineReason === undefined || engineReason.startsWith(UNKNOWN_OP)) {
        return { engineUnavailable: engineReason ?? message };
      }
      if (engineReason.startsWith('query letter') || engineReason === 'query is empty') {
        return { queryRefused: engineReason };
      }
      notSearched.push({ ...where, reason: engineReason });
      continue;
    }
    searched += 1;
    if (answer.totalHits > 0) {
      results.push({
        ...where,
        hits: answer.hits.map((h) => ({ ...h, letters: hitLetters(doc.sequence, h.start, h.end) })),
        totalHits: answer.totalHits,
        definiteHits: answer.definiteHits,
        possibleHits: answer.possibleHits,
        warnings: answer.warnings,
      });
    }
  }
  return { query: trimmed, searched, results, notSearched };
}

// ─── Conditions and filters (US-01M7DVHA) ───

/** How conditions combine, with evaluateTableRowFilters' meaning: ALL every condition, ANY at least one. */
export type CombineChoice = 'ALL' | 'ANY';
export const COMBINE_CHOICES: readonly CombineChoice[] = ['ALL', 'ANY'];

/** One condition row: a mode and its query. A condition whose query is empty takes no part. */
export interface SearchCondition { mode: SearchMode; query: string }

/** A condition that takes part in a run: its 1-based row number, mode and trimmed query. */
export interface ActiveCondition { condition: number; mode: SearchMode; query: string }

/** The conditions of `rows` that have a query, numbered by their row. */
export function activeConditions(rows: SearchCondition[]): ActiveCondition[] {
  return rows.flatMap((row, i) => (row.query.trim() === '' ? [] : [{ condition: i + 1, mode: row.mode, query: row.query.trim() }]));
}

export type FilterName = 'Document type' | 'Topology' | 'Length' | 'Modified date' | 'Annotation type';

/**
 * The filters a run applies, each absent when not set. Document type is the label each result
 * group shows (inferDocumentTypeLabel); length counts residues, bp or nt for a nucleotide document
 * and aa for a protein; modified dates are local calendar days (YYYY-MM-DD) compared with
 * updatedAt; annotation type is a feature's type exactly as stored. Every bound is inclusive.
 */
export interface SearchFilters {
  documentType?: string;
  topology?: 'circular' | 'linear';
  length?: { min: number | null; max: number | null };
  modified?: { from: string | null; to: string | null };
  annotationType?: string;
}

/** The filters set in `filters`, in the order the panel shows them. */
export function activeFilterNames(filters: SearchFilters): FilterName[] {
  const names: FilterName[] = [];
  if (filters.documentType !== undefined) names.push('Document type');
  if (filters.topology !== undefined) names.push('Topology');
  if (filters.length !== undefined) names.push('Length');
  if (filters.modified !== undefined) names.push('Modified date');
  if (filters.annotationType !== undefined) names.push('Annotation type');
  return names;
}

export const MIN_ABOVE_MAX = 'Minimum is above maximum.';
export const NOT_A_NUMBER = 'Not a number.';
export const NOT_A_DATE = 'Not a date.';
export const FILTER_REFUSED = 'A filter cannot be read, so nothing was searched.';

/** A bound field's value: null when empty, undefined when it cannot be read. */
function readBound<T>(text: string, read: (s: string) => T | undefined): T | null | undefined {
  const s = text.trim();
  return s === '' ? null : read(s);
}

/**
 * The length bounds typed in two fields. Both empty is no filter. A field that is not a whole
 * number of residues refuses ("Not a number."), and so does a minimum above the maximum: a refused
 * bound is never read as no bound.
 */
export function readLengthBounds(minText: string, maxText: string):
  { bounds: { min: number | null; max: number | null } | null } | Refusal<string> {
  const read = (s: string) => (/^\d+$/.test(s) ? Number(s) : undefined);
  const min = readBound(minText, read);
  const max = readBound(maxText, read);
  if (min === undefined || max === undefined) return { refused: NOT_A_NUMBER };
  if (min === null && max === null) return { bounds: null };
  if (min !== null && max !== null && min > max) return { refused: MIN_ABOVE_MAX };
  return { bounds: { min, max } };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** A calendar day typed as YYYY-MM-DD, or undefined when it names no day (2026-02-30, 26-1-1). */
function readDay(s: string): string | undefined {
  const m = DAY.exec(s);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? s : undefined;
}

/** The modified-date bounds typed in two fields, as readLengthBounds reads lengths. */
export function readDateBounds(fromText: string, toText: string):
  { bounds: { from: string | null; to: string | null } | null } | Refusal<string> {
  const from = readBound(fromText, readDay);
  const to = readBound(toText, readDay);
  if (from === undefined || to === undefined) return { refused: NOT_A_DATE };
  if (from === null && to === null) return { bounds: null };
  if (from !== null && to !== null && from > to) return { refused: MIN_ABOVE_MAX };
  return { bounds: { from, to } };
}

/** The local calendar day (YYYY-MM-DD) of an ISO timestamp, or null when it names no instant. */
export function localDay(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/**
 * Why `doc` holds no single sequence, in motifNotSearchedReason's words, or null when it holds one.
 * These are the reasons it gives in every mode alike (the document's kind), an empty sequence aside.
 */
export function noSingleSequenceReason(doc: SequenceDocument): string | null {
  const reason = motifNotSearchedReason(doc, 'Nucleotide motif');
  return reason !== null && reason !== EMPTY_SEQUENCE && reason === motifNotSearchedReason(doc, 'Protein motif') ? reason : null;
}

/** The filters that read a single sequence, and so do not apply to a document with none. */
const SEQUENCE_FILTERS: readonly FilterName[] = ['Topology', 'Length'];

export type FilterVerdict = 'passes' | 'filtered out' | { notApplicable: string };

/**
 * Whether `doc` passes `filters`. A document an active filter does not apply to is neither: it is
 * not applicable, named "<Filter> does not apply: <reason>" for each such filter. A document whose
 * updatedAt names no instant is not shown to be in a date range, so it does not pass one.
 */
export function filterDocument(doc: SequenceDocument, filters: SearchFilters): FilterVerdict {
  const noSequence = noSingleSequenceReason(doc);
  if (noSequence !== null) {
    const inapplicable = activeFilterNames(filters).filter((name) => SEQUENCE_FILTERS.includes(name));
    if (inapplicable.length > 0) return { notApplicable: inapplicable.map((name) => `${name} does not apply: ${noSequence}`).join('; ') };
  }
  if (filters.documentType !== undefined && inferDocumentTypeLabel(doc) !== filters.documentType) return 'filtered out';
  if (filters.topology !== undefined && doc.topology !== filters.topology) return 'filtered out';
  if (filters.length) {
    const { min, max } = filters.length;
    const n = doc.sequence.length;
    if ((min !== null && n < min) || (max !== null && n > max)) return 'filtered out';
  }
  if (filters.modified) {
    const { from, to } = filters.modified;
    const day = localDay(doc.updatedAt);
    if (day === null || (from !== null && day < from) || (to !== null && day > to)) return 'filtered out';
  }
  if (filters.annotationType !== undefined && !doc.features.some((f) => f.type === filters.annotationType)) return 'filtered out';
  return 'passes';
}

/** A document an active filter does not apply to, and why. */
export interface NotApplicable { documentId: string; documentName: string; folderPath: string; reason: string }

/** What the filters did over a run's documents: `passed` were searched, the rest were not. */
export interface FilterTally { passed: number; filteredOut: number; notApplicable: NotApplicable[] }

/** One condition's answer for one document: its hits, or why its mode does not read the document. */
export type ConditionAnswer =
  | { condition: number; textHits: TextHit[] }
  | { condition: number; motif: Omit<DocumentMotifResult, 'documentId' | 'documentName' | 'folderPath'> }
  | { condition: number; notSearched: string };

/** A document some condition found hits in or did not read, with each such condition's answer. */
export interface DocumentConditionAnswers { documentId: string; documentName: string; folderPath: string; answers: ConditionAnswer[] }

export type ConditionsOutcome =
  | Refusal<'empty query'>
  /** The engine refused one condition's query itself, so no document was searched. */
  | { condition: number; queryRefused: string }
  | { engineUnavailable: string }
  /** `searched` documents passed the filters and were read by every condition whose mode reads them. */
  | { conditions: ActiveCondition[]; searched: number; documents: DocumentConditionAnswers[] };

/**
 * Every condition of `conditions` on one document, through searchText and searchMotif. A refusal
 * of a condition's query or an engine that cannot run ends the run, as it does with one condition.
 */
export function searchConditionsIn(
  doc: SequenceDocument, conditions: ActiveCondition[], folders: ExplorerFolder[], bothStrands: boolean, engine: MotifEngine,
): DocumentConditionAnswers | { condition: number; queryRefused: string } | { engineUnavailable: string } {
  const answers: ConditionAnswer[] = [];
  for (const { condition, mode, query } of conditions) {
    if (mode === 'Text') {
      const one = searchText(query, [doc], folders);
      if ('results' in one && one.results.length > 0) answers.push({ condition, textHits: one.results[0].hits });
      continue;
    }
    const one = searchMotif(query, [doc], folders, mode, bothStrands, engine);
    if ('queryRefused' in one) return { condition, queryRefused: one.queryRefused };
    if ('engineUnavailable' in one) return one;
    if (!('results' in one)) continue;
    if (one.notSearched.length > 0) answers.push({ condition, notSearched: one.notSearched[0].reason });
    else if (one.results.length > 0) {
      const { documentId: _id, documentName: _name, folderPath: _path, ...motif } = one.results[0];
      answers.push({ condition, motif });
    }
  }
  return { documentId: doc.id, documentName: doc.name, folderPath: documentFolderPath(doc.folder, folders), answers };
}

/** A result's hits under the condition that found them. */
export type ConditionSection =
  | { condition: ActiveCondition; textHits: TextHit[] }
  | { condition: ActiveCondition; motif: Omit<DocumentMotifResult, 'documentId' | 'documentName' | 'folderPath'> };

export interface CombinedResult { documentId: string; documentName: string; folderPath: string; sections: ConditionSection[] }

/**
 * The results of a conditions run under `choice`. Definite only first drops each motif condition's
 * possible hits, so a condition whose hits in a document are all possible has none there. ALL keeps
 * a document every condition has a hit in, ANY one that at least one has; a condition whose mode
 * does not read a document has no hit in it, and is listed under Not searched as "condition N: ...".
 */
export function combineConditions(
  answers: DocumentConditionAnswers[], conditions: ActiveCondition[], choice: CombineChoice, definiteOnly: boolean,
): { results: CombinedResult[]; notSearched: MotifNotSearched[] } {
  const byNumber = new Map(conditions.map((c) => [c.condition, c]));
  const results: CombinedResult[] = [];
  const notSearched: MotifNotSearched[] = [];
  for (const doc of answers) {
    const where = { documentId: doc.documentId, documentName: doc.documentName, folderPath: doc.folderPath };
    const sections: ConditionSection[] = [];
    for (const answer of doc.answers) {
      const condition = byNumber.get(answer.condition);
      if (!condition) continue;
      if ('notSearched' in answer) notSearched.push({ ...where, reason: `condition ${answer.condition}: ${answer.notSearched}` });
      else if ('textHits' in answer) sections.push({ condition, textHits: answer.textHits });
      else if ((definiteOnly ? answer.motif.definiteHits : answer.motif.totalHits) > 0) sections.push({ condition, motif: answer.motif });
    }
    const met = choice === 'ALL' ? sections.length === conditions.length : sections.length > 0;
    if (met && conditions.length > 0) results.push({ ...where, sections });
  }
  return { results, notSearched };
}

// ─── Search runs (US-01M7DVVS) ───

/**
 * What one run searches: a text query, a motif in a motif mode through `engine`, or several
 * conditions (US-01M7DVHA). `filters`, when set, narrow the documents every kind searches.
 */
export type SearchRequest =
  | { mode: 'Text'; query: string; documents: SequenceDocument[]; folders: ExplorerFolder[]; filters?: SearchFilters }
  | {
    mode: MotifMode; query: string; documents: SequenceDocument[]; folders: ExplorerFolder[];
    bothStrands: boolean; engine: MotifEngine; filters?: SearchFilters;
  }
  | {
    mode: 'Conditions'; conditions: SearchCondition[]; documents: SequenceDocument[]; folders: ExplorerFolder[];
    bothStrands: boolean; engine: MotifEngine; filters?: SearchFilters;
  };

/**
 * A completed run's answer, as searchText, searchMotif or searchConditionsIn gives it over the
 * documents that passed the filters; `filtering` says what the filters did, when any is set.
 */
export type SearchRunResult =
  | { mode: 'Text'; outcome: ReturnType<typeof searchText>; filtering?: FilterTally }
  | { mode: MotifMode; outcome: MotifSearchOutcome; filtering?: FilterTally }
  | { mode: 'Conditions'; outcome: ConditionsOutcome; filtering?: FilterTally };

export type SearchRunEvent =
  /** `reached` of the run's `total` documents have been read. */
  | { kind: 'progress'; reached: number; total: number }
  | { kind: 'done'; result: SearchRunResult };

/** Hands the UI a turn between two documents: a timer task, so input and painting run in between. */
export const nextTask = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Runs searches one document per step, awaiting `yieldStep` between documents, so no single call
 * of searchText or searchMotif (and of the engine under it) covers more than one document: with
 * several conditions, every condition reads a document in that document's step. The filters are
 * read in the same step, and a document they leave out is read by no condition. Only the newest
 * run is ever reported: `start` and `stop` each end the run before them, which then stops at its
 * next step and never calls its listener again, whatever order the steps resolve in.
 */
export interface SearchRunner {
  /** Ends any run in progress and starts `request`, reporting to `listener` while it is the newest. */
  start(request: SearchRequest, listener: (event: SearchRunEvent) => void): void;
  /** Ends any run in progress; it reads no further document and reports nothing more. */
  stop(): void;
}

export function createSearchRunner(yieldStep: () => Promise<void> = nextTask): SearchRunner {
  let generation = 0;
  const run = async (id: number, request: SearchRequest, listener: (event: SearchRunEvent) => void) => {
    const { documents, folders } = request;
    const total = documents.length;
    const filters = request.filters && activeFilterNames(request.filters).length > 0 ? request.filters : null;
    const tally: FilterTally = { passed: 0, filteredOut: 0, notApplicable: [] };
    const withTally = <R extends SearchRunResult>(result: R): R => (filters ? { ...result, filtering: tally } : result);
    const textResults: DocumentTextResult[] = [];
    const motif = { searched: 0, results: [] as DocumentMotifResult[], notSearched: [] as MotifNotSearched[] };
    const conditions = request.mode === 'Conditions' ? activeConditions(request.conditions) : [];
    const conditionAnswers: DocumentConditionAnswers[] = [];
    const query = request.mode === 'Conditions' ? '' : request.query.trim();
    const empty = request.mode === 'Conditions' ? conditions.length === 0 : query === '';
    if (empty) {
      listener({ kind: 'done', result: request.mode === 'Text' ? { mode: 'Text', outcome: { refused: 'empty query' } } : { mode: request.mode, outcome: { refused: 'empty query' } } });
      return;
    }
    for (let i = 0; i < total; i++) {
      if (i > 0) await yieldStep();
      if (id !== generation) return;
      const doc = documents[i];
      const verdict = filters ? filterDocument(doc, filters) : 'passes';
      if (verdict === 'filtered out') tally.filteredOut += 1;
      else if (verdict !== 'passes') {
        tally.notApplicable.push({ documentId: doc.id, documentName: doc.name, folderPath: documentFolderPath(doc.folder, folders), reason: verdict.notApplicable });
      } else {
        tally.passed += 1;
        if (request.mode === 'Text') {
          const one = searchText(request.query, [doc], folders);
          if ('refused' in one) { listener({ kind: 'done', result: withTally({ mode: 'Text', outcome: one }) }); return; }
          textResults.push(...one.results);
        } else if (request.mode === 'Conditions') {
          const one = searchConditionsIn(doc, conditions, folders, request.bothStrands, request.engine);
          if (!('answers' in one)) { listener({ kind: 'done', result: withTally({ mode: 'Conditions', outcome: one }) }); return; }
          if (one.answers.length > 0) conditionAnswers.push(one);
        } else {
          const one = searchMotif(request.query, [doc], folders, request.mode, request.bothStrands, request.engine);
          if (!('results' in one)) { listener({ kind: 'done', result: withTally({ mode: request.mode, outcome: one }) }); return; }
          motif.searched += one.searched;
          motif.results.push(...one.results);
          motif.notSearched.push(...one.notSearched);
        }
      }
      listener({ kind: 'progress', reached: i + 1, total });
    }
    if (id !== generation) return;
    const result: SearchRunResult = request.mode === 'Text'
      ? { mode: 'Text', outcome: { query, results: textResults } }
      : request.mode === 'Conditions'
        ? { mode: 'Conditions', outcome: { conditions, searched: tally.passed, documents: conditionAnswers } }
        : { mode: request.mode, outcome: { query, ...motif } };
    listener({ kind: 'done', result: withTally(result) });
  };
  return {
    start(request, listener) {
      generation += 1;
      void run(generation, request, listener);
    },
    stop() {
      generation += 1;
    },
  };
}

// ─── Opening a hit (US-01M7DV78) ───

/** Characters of a field's value a snippet shows on each side of its match. */
export const SNIPPET_CONTEXT = 40;

/** The text around a hit's match, `before + match + after` read from its value, and whether the value goes on past each end. */
export function snippetOf(hit: Pick<TextHit, 'value' | 'start' | 'end'>): {
  clippedStart: boolean; before: string; match: string; after: string; clippedEnd: boolean;
} {
  const from = Math.max(0, hit.start - SNIPPET_CONTEXT);
  const to = Math.min(hit.value.length, hit.end + SNIPPET_CONTEXT);
  return {
    clippedStart: from > 0,
    before: hit.value.slice(from, hit.start),
    match: hit.value.slice(hit.start, hit.end),
    after: hit.value.slice(hit.end, to),
    clippedEnd: to < hit.value.length,
  };
}

/** A listed hit and the mode that found it. */
export type SearchHitRef = { mode: 'Text'; hit: TextHit } | { mode: MotifMode; hit: MotifHit };

/** A document as the search read it, or as the catalog holds it now, and whether it is in Deleted Items. */
export interface DocumentState { doc: SequenceDocument; deleted: boolean }

/** Where a hit opens: the span the Sequence view selects, or the field Document info names. */
export interface HitOpening {
  documentId: string;
  /** 1-based and inclusive; `start > end` is the span across the origin, never its complement. */
  selection: { start: number; end: number; label?: string } | null;
  /** The hit Document info shows, for a match in no feature or primer; null when `selection` shows it. */
  field: TextHit | null;
}

/** A feature's span: a joined feature's from its first segment's start to its last segment's end. */
export function featureSpan(f: SequenceFeature): { start: number; end: number } {
  const segments = f.segments ?? [];
  return segments.length > 0
    ? { start: segments[0].start, end: segments[segments.length - 1].end }
    : { start: f.start, end: f.end };
}

export const deletedAfterSearch = (name: string) => `"${name}" was deleted after this search ran.`;
export const changedAfterSearch = (name: string) => `"${name}" changed after this search ran: this result is out of date.`;

/**
 * Where clicking `ref` opens, read from the document as the catalog holds it now (`current`), or
 * why it opens nothing: the document was deleted since the search read it (gone from the catalog,
 * or moved to Deleted Items when it was not there then), or its `updatedAt` or sequence is not the
 * one searched. A feature or primer is found by its id, and one the document no longer holds is
 * told as a change, never opened at another place.
 */
export function openSearchHit(
  ref: SearchHitRef, searched: DocumentState, current: DocumentState | null,
): { opens: HitOpening } | { refused: string } {
  const name = searched.doc.name;
  if (current === null || (current.deleted && !searched.deleted)) return { refused: deletedAfterSearch(name) };
  const doc = current.doc;
  if (doc.updatedAt !== searched.doc.updatedAt || doc.sequence !== searched.doc.sequence) {
    return { refused: changedAfterSearch(name) };
  }
  const opens = (selection: HitOpening['selection'], field: TextHit | null) => ({ opens: { documentId: doc.id, selection, field } });
  if (ref.mode !== 'Text') return opens({ start: ref.hit.start, end: ref.hit.end }, null);
  const { hit } = ref;
  if (hit.featureId !== undefined) {
    const feature = doc.features.find((f) => f.id === hit.featureId);
    if (!feature) return { refused: changedAfterSearch(name) };
    return opens({ ...featureSpan(feature), label: featureLabel(feature) }, null);
  }
  if (hit.primerId !== undefined) {
    const primer = doc.primers.find((p) => p.id === hit.primerId);
    if (!primer) return { refused: changedAfterSearch(name) };
    return opens({ start: primer.bindStart, end: primer.bindEnd, label: primer.name }, null);
  }
  return opens(null, hit);
}

export const notShownInExplorer = (name: string) => `"${name}" is in no folder the explorer shows, so this result cannot open.`;
export const inHiddenFolder = (name: string, folder: string) =>
  `"${name}" is in the hidden folder "${folder}", and no folder the explorer shows lists it: show that folder to open this result.`;

/**
 * The explorer folder a hit's document opens in, or why it opens in none. Deleted Items for a
 * deleted document; else the folder it is filed in (or the folder whose aliases hold it), or, when
 * that folder or one above it is hidden, the folder just above the topmost hidden one; and from
 * there the nearest folder up to the root whose view `lists` the document. A folder view is not
 * the whole catalog (the root lists only the session's documents, not the catalog-only sample
 * library ones), so when no such folder's view lists the document the answer is a refusal, naming
 * the topmost hidden folder when one hides it, never a folder that would open another document.
 */
export function hitFolderId(
  doc: SequenceDocument, deleted: boolean, folders: ExplorerFolder[], hiddenFolders: string[],
  lists: (folderId: string) => boolean,
): { folderId: string } | { refused: string } {
  if (deleted) return lists(DELETED) ? { folderId: DELETED } : { refused: notShownInExplorer(doc.name) };
  const owner = ROOT_NAMES.has(doc.folder) ? undefined
    : folders.find((f) => f.id === doc.folder) ?? folders.find((f) => f.matchFolders.includes(doc.folder));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const hidden = new Set(hiddenFolders);
  let shown = owner?.id ?? PROJECT_ROOT;
  let topHidden: ExplorerFolder | undefined;
  const seen = new Set<string>();
  for (let at: ExplorerFolder | undefined = owner; at && !seen.has(at.id); at = byId.get(at.parent)) {
    seen.add(at.id);
    if (hidden.has(at.id)) { shown = at.parent; topHidden = at; }
  }
  // Every folder above the nearest shown one is shown too, so the walk up never reaches a hidden one.
  const climbed = new Set<string>();
  for (let at: string | undefined = shown; at !== undefined && !climbed.has(at); at = byId.get(at)?.parent) {
    climbed.add(at);
    const id = ROOT_NAMES.has(at) ? PROJECT_ROOT : at;
    if (lists(id)) return { folderId: id };
    if (ROOT_NAMES.has(at)) break;
  }
  return { refused: topHidden ? inHiddenFolder(doc.name, topHidden.label) : notShownInExplorer(doc.name) };
}
