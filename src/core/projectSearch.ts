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
 */

import type { SequenceDocument, SequenceFeature } from '../types/bio';
import type { IupacMotifHit, IupacMotifSearch, MotifSearchMode } from '../lib/rustBioEngine';
import { isContigSummaryRecord } from './contigSummary';
import { isTreeDocument } from './documentViews';
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
  { id: 'featureName', label: 'feature name', values: (d) => d.features.map((f) => ({ field: `name of feature ${featureLabel(f)}`, value: f.name })) },
  { id: 'featureType', label: 'feature type', values: (d) => d.features.map((f) => ({ field: `type of feature ${featureLabel(f)}`, value: f.type })) },
  {
    id: 'featureQualifier', label: "each feature qualifier value other than /translation and keys ending in 'sequence'",
    values: (d) => d.features.flatMap((f) => Object.entries(f.qualifiers ?? {}).filter(([key]) => !isResidueQualifier(key))
      .map(([key, value]) => ({ field: `qualifier /${key} of feature ${featureLabel(f)}`, value }))),
  },
  {
    id: 'featureNotes', label: 'feature notes',
    values: (d) => d.features.flatMap((f) => f.notes === undefined ? [] : [{ field: `notes of feature ${featureLabel(f)}`, value: f.notes }]),
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
  if (doc.sequence.length === 0) return 'empty sequence';
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

// ─── Search runs (US-01M7DVVS) ───

/** What one run searches: a text query, or a motif in a motif mode through `engine`. */
export type SearchRequest =
  | { mode: 'Text'; query: string; documents: SequenceDocument[]; folders: ExplorerFolder[] }
  | {
    mode: MotifMode; query: string; documents: SequenceDocument[]; folders: ExplorerFolder[];
    bothStrands: boolean; engine: MotifEngine;
  };

/** A completed run's answer, as searchText or searchMotif gives it over the run's documents. */
export type SearchRunResult =
  | { mode: 'Text'; outcome: ReturnType<typeof searchText> }
  | { mode: MotifMode; outcome: MotifSearchOutcome };

export type SearchRunEvent =
  /** `reached` of the run's `total` documents have been read. */
  | { kind: 'progress'; reached: number; total: number }
  | { kind: 'done'; result: SearchRunResult };

/** Hands the UI a turn between two documents: a timer task, so input and painting run in between. */
export const nextTask = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Runs searches one document per step, awaiting `yieldStep` between documents, so no single call
 * of searchText or searchMotif (and of the engine under it) covers more than one document. Only
 * the newest run is ever reported: `start` and `stop` each end the run before them, which then
 * stops at its next step and never calls its listener again, whatever order the steps resolve in.
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
    const textResults: DocumentTextResult[] = [];
    const motif = { searched: 0, results: [] as DocumentMotifResult[], notSearched: [] as MotifNotSearched[] };
    const query = request.query.trim();
    if (query === '') {
      listener({ kind: 'done', result: request.mode === 'Text' ? { mode: 'Text', outcome: { refused: 'empty query' } } : { mode: request.mode, outcome: { refused: 'empty query' } } });
      return;
    }
    for (let i = 0; i < total; i++) {
      if (i > 0) await yieldStep();
      if (id !== generation) return;
      const doc = documents[i];
      if (request.mode === 'Text') {
        const one = searchText(request.query, [doc], folders);
        if ('refused' in one) { listener({ kind: 'done', result: { mode: 'Text', outcome: one } }); return; }
        textResults.push(...one.results);
      } else {
        const one = searchMotif(request.query, [doc], folders, request.mode, request.bothStrands, request.engine);
        if (!('results' in one)) { listener({ kind: 'done', result: { mode: request.mode, outcome: one } }); return; }
        motif.searched += one.searched;
        motif.results.push(...one.results);
        motif.notSearched.push(...one.notSearched);
      }
      listener({ kind: 'progress', reached: i + 1, total });
    }
    if (id !== generation) return;
    listener(request.mode === 'Text'
      ? { kind: 'done', result: { mode: 'Text', outcome: { query, results: textResults } } }
      : { kind: 'done', result: { mode: request.mode, outcome: { query, ...motif } } });
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
