// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Search Project (US-01M7DV88): the panel over the project text search of
 * src/core/projectSearch.ts (US-01M7DVC0). It offers the scopes the core offers for its folder,
 * shows the chosen scope's label and the core's statement of what is and is not searched, and
 * lists the matches grouped by document, 50 groups to a page.
 *
 * The App passes the search context: every catalog document (deleted ones included) and every
 * explorer folder (hidden ones included), as the core's SearchContext asks. An empty scope, an
 * empty query and a query with no matches are each told by their own sentence.
 *
 * The Search mode select (US-01M7DVE7) switches to a nucleotide or protein motif search over the
 * same scope, run by the IUPAC motif engine (searchIupacMotifRust): each hit with its coordinates,
 * strand, letters and certainty, the documents the mode does not read listed under Not searched
 * with their reasons, and a refused query or an engine that cannot run each told in one sentence.
 *
 * Searches run through the core's run controller (US-01M7DVVS), one document per step with a
 * timer task between documents. Typing, or a change of the documents, waits SEARCH_PAUSE_MS
 * before a run starts; a change of scope, mode or Both strands starts one at once. Results are
 * listed only for the query, scope, mode and strands now chosen, so an older query's groups are
 * never shown; a change of the documents keeps the old groups under an out-of-date sentence until
 * the rerun completes, and Cancel search ends a run with no results shown.
 *
 * Each hit is a button (US-01M7DV78): the core's openSearchHit reads it against the document as the
 * catalog holds it now, and the App opens the opening it answers. A hit whose document was deleted
 * or changed since the run read it opens nothing and is told in its own sentence.
 *
 * Add condition (US-01M7DVHA) adds a row with its own mode and query, combined with the others by
 * ALL or ANY; with one row the panel is the one above. Filters by document type, topology, length,
 * modified date and annotation type narrow the documents searched whatever that choice, show as
 * chips while set, and a bound that cannot be read stops the search with its reason. Every row, the
 * choice and the filters are in the run's key, so a change of any lists no other set's groups.
 *
 * Include Primer Database (US-01M7DVZP), off by default, searches the active records of the store
 * read the App passes beside the scope's documents, never counted among them, and lists their hits
 * in one group after the document groups, headed as outside the project folders. A record hit opens
 * the Primer Database window on that record through `onOpenPrimerRecord`, never a document; one
 * edited, trashed or removed since the run read it opens nothing and says so. A read of the store
 * that differs from the one searched marks an included search out of date and reruns it after the
 * pause, as a document change does.
 *
 * Save search… (US-01M7DV4Y) keeps the conditions, ALL / ANY, Both strands, the filters as typed,
 * Include Primer Database, the scope and the folder's id under mbc.projectSearches.v1, never the
 * results. Choosing one sets the panel to it and runs it at once on the documents as they are now,
 * reopening the panel through `onReopenSaved` when its folder is not the panel's; a folder gone runs
 * nothing. Table filter searches (mbc.savedSearches.v1) are listed apart and handed to the App's
 * table filter through `onApplyTableSearch`, never run here.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  activeConditions,
  activeFilterNames,
  combineConditions,
  COMBINE_CHOICES,
  createSearchRunner,
  FILTER_REFUSED,
  motifNotSearchedReason,
  NO_ACTIVE_PRIMERS,
  NUCLEOTIDE_MOTIF_STATEMENT,
  openPrimerHit,
  openSearchHit,
  PRIMER_DATABASE_NAME,
  PRIMER_GROUP_HEADING,
  primerHitPortion,
  PRIMERS_NOT_PROTEIN,
  PRIMERS_NOT_READ,
  PROTEIN_MOTIF_STATEMENT,
  readDateBounds,
  readLengthBounds,
  resolveSearchScope,
  scopesOffered,
  SEARCH_MODES,
  snippetOf,
  TEXT_SEARCH_STATEMENT,
  trashedNotSearched,
  type CombineChoice,
  type CombinedResult,
  type DocumentMotifResult,
  type FilterName,
  type HitOpening,
  type MotifHit,
  type MotifMode,
  type MotifNotSearched,
  type SearchContext,
  type SearchFilters,
  type SearchMode,
  type SearchRequest,
  type SearchRunResult,
  type SearchHitRef,
  type SearchScope,
  type TextHit,
} from '../core/projectSearch';
import type { ExplorerFolder } from '../core/projectExplorer';
import type { DatabasePrimer, SequenceDocument } from '../types/bio';
import type { PrimerDbRead } from '../core/primerDatabase';
import { inferDocumentTypeLabel } from '../core/workbenchBatchOperations';
import { searchIupacMotifRust } from '../lib/rustBioEngine';
import {
  deleteProjectSearch, discardUnreadableSearches, folderGoneSentence, readProjectSearches, readTableSearches, saveProjectSearch,
  savedSearchFolder, unreadableStoreSentence, type ProjectSavedSearch, type SavedSearch,
} from '../core/savedSearches';

/** Groups shown on one page. */
export const GROUPS_PER_PAGE = 50;
/** The pause after the last keystroke, or after the documents change, before a search runs. */
export const SEARCH_PAUSE_MS = 250;

/** One condition row as typed: its mode and its query. */
interface Row { id: number; mode: SearchMode; query: string }

/**
 * What a run searched for: its results are listed only while every part is still the chosen one.
 * `conditions` holds every row, empty ones included, so adding or removing one is a change.
 */
interface RunKey {
  conditions: { mode: SearchMode; query: string }[]; combine: CombineChoice; scope: SearchScope; bothStrands: boolean; filters: string;
  primers: boolean;
}
const sameKey = (a: RunKey, b: RunKey) => JSON.stringify(a) === JSON.stringify(b);
/** Whether only a query differs between two keys of the same rows: typing, which waits for the pause. */
const queryTyped = (a: RunKey, b: RunKey) => a.conditions.length === b.conditions.length
  && a.conditions.some((c, i) => c.query !== b.conditions[i].query);

/** The filter fields as typed; a field left empty, or "Any", sets no filter. */
interface FilterFields {
  documentType: string; topology: '' | 'circular' | 'linear'; lengthMin: string; lengthMax: string;
  modifiedFrom: string; modifiedTo: string; annotationType: string;
}
const NO_FILTERS: FilterFields = { documentType: '', topology: '', lengthMin: '', lengthMax: '', modifiedFrom: '', modifiedTo: '', annotationType: '' };
export const LENGTH_LABEL = 'Length (bp or nt; aa for proteins)';
/** The ids of the elements showing a refused Length or Modified date range's reason. */
const LENGTH_REASON_ID = 'mbc-project-search-length-reason';
const DATE_REASON_ID = 'mbc-project-search-date-reason';
/** A range input's ARIA while its range is refused: invalid, and described by the reason; none otherwise. */
const refusedBy = (reason: string | null, reasonId: string) =>
  (reason ? { 'aria-invalid': true, 'aria-describedby': reasonId } as const : {});
/** The fields each filter's chip clears. */
const FILTER_FIELDS: Record<FilterName, (keyof FilterFields)[]> = {
  'Document type': ['documentType'], Topology: ['topology'], Length: ['lengthMin', 'lengthMax'],
  'Modified date': ['modifiedFrom', 'modifiedTo'], 'Annotation type': ['annotationType'],
};
const FILTER_ORDER: FilterName[] = ['Document type', 'Topology', 'Length', 'Modified date', 'Annotation type'];
const rangeText = (min: string, max: string) => (min.trim() === '' ? `up to ${max.trim()}` : max.trim() === '' ? `from ${min.trim()}` : `${min.trim()} to ${max.trim()}`);

/**
 * What a run read: the scope's documents, the folders their paths come from and, when the Primer
 * Database is included, the store's read as text (a re-read of an unchanged store reads the same).
 */
interface RunInputs { documents: SequenceDocument[]; foldersKey: string; primersKey: string }
const foldersKeyOf = (folders: ExplorerFolder[]) =>
  JSON.stringify(folders.map((f) => [f.id, f.label, f.parent, f.matchFolders]));
/** Whether two runs read the same: the same document objects in the same order, under the same folders. */
const sameInputs = (a: RunInputs, b: RunInputs) => a.foldersKey === b.foldersKey && a.primersKey === b.primersKey
  && a.documents.length === b.documents.length && a.documents.every((d, i) => d === b.documents[i]);

/** A completed run, and the documents in Deleted Items when it read them. */
interface Completed { key: RunKey; inputs: RunInputs; deletedIds: ReadonlySet<string>; result: SearchRunResult }
interface Cancelled { key: RunKey; reached: number; total: number }

/** The scope a folder's Search Folder… opens on: its first offered wider scope, else the only one offered. */
export function initialFolderScope(folderId: string): SearchScope {
  const offered = scopesOffered(folderId);
  return offered.find((scope) => scope === 'Folder and subfolders') ?? offered[0];
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** A motif count, grouped by thousands as the engine's own warning writes it. */
const motifCount = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

const MODE_STATEMENT: Record<SearchMode, string> = {
  Text: TEXT_SEARCH_STATEMENT,
  'Nucleotide motif': NUCLEOTIDE_MOTIF_STATEMENT,
  'Protein motif': PROTEIN_MOTIF_STATEMENT,
};

const strandText = (hit: MotifHit) => (hit.strand === 1 ? (hit.palindromic ? '+ palindrome' : '+') : '\u2212');

/** The hit's value around its match, the match itself marked exactly as the value holds it. */
export function Snippet({ hit }: { hit: TextHit }) {
  const { clippedStart, before, match, after, clippedEnd } = snippetOf(hit);
  return (
    <span className="mbc-project-search-snippet" data-part="snippet">
      {clippedStart ? '…' : ''}
      {before}
      <mark>{match}</mark>
      {after}
      {clippedEnd ? '…' : ''}
    </span>
  );
}

interface Props {
  folderId: string;
  initialScope: SearchScope;
  context: SearchContext;
  onClose: () => void;
  /**
   * Opens a hit the core found still current, or returns the sentence saying why it opens nothing
   * (no folder the explorer shows lists its document); never called for a deleted or changed one.
   */
  onOpenHit?: (opening: HitOpening) => string | null;
  /** Opens the Primer Database window on a record the core found still current (US-01M7DVZP). */
  onOpenPrimerRecord?: (recordId: string) => void;
  /** The saved search this panel was reopened on (US-01M7DV4Y): its settings are the panel's and it runs at once. */
  initialSaved?: ProjectSavedSearch;
  /** Reopens the panel on another folder, found by id, to run a saved search there. */
  onReopenSaved?: (folderId: string, saved: ProjectSavedSearch) => void;
  /** Applies a table filter search (mbc.savedSearches.v1) to the document table filter; it never runs here. */
  onApplyTableSearch?: (search: SavedSearch) => void;
  /** Says the panel discarded an unreadable store, so the table menu re-reads its own. */
  onSavedSearchesChanged?: () => void;
}

/** The filters as read from their fields; a field left empty, or "Any", sets no filter, and a bound that cannot be read refuses. */
function readFilterFields(fields: FilterFields) {
  const lengthRead = readLengthBounds(fields.lengthMin, fields.lengthMax);
  const dateRead = readDateBounds(fields.modifiedFrom, fields.modifiedTo);
  const lengthReason = 'refused' in lengthRead ? lengthRead.refused : null;
  const dateReason = 'refused' in dateRead ? dateRead.refused : null;
  const filters: SearchFilters = {};
  if (fields.documentType !== '') filters.documentType = fields.documentType;
  if (fields.topology !== '') filters.topology = fields.topology;
  if ('bounds' in lengthRead && lengthRead.bounds) filters.length = lengthRead.bounds;
  if ('bounds' in dateRead && dateRead.bounds) filters.modified = dateRead.bounds;
  if (fields.annotationType !== '') filters.annotationType = fields.annotationType;
  return { filters, lengthReason, dateReason, filterRefused: lengthReason !== null || dateReason !== null };
}

/**
 * The run key of a set of settings, queries trimmed and filters read as a run reads them: the
 * panel's own, and a saved search's, so choosing one is known to start a run only when it does.
 */
function runKeyOf(x: Pick<ProjectSavedSearch, 'combine' | 'bothStrands' | 'includePrimers' | 'scope'> & { conditions: { mode: SearchMode; query: string }[]; filters: FilterFields }): RunKey {
  const read = readFilterFields(x.filters);
  return {
    conditions: x.conditions.map((r) => ({ mode: r.mode, query: r.query.trim() })), combine: x.combine, scope: x.scope, bothStrands: x.bothStrands,
    filters: read.filterRefused ? `refused ${JSON.stringify(x.filters)}` : JSON.stringify(read.filters),
    primers: x.includePrimers,
  };
}

/** The read a run is given when the App passed none: never read as a store without records. */
const NOT_READ: PrimerDbRead = { ok: false, error: { kind: 'unavailable', message: PRIMERS_NOT_READ, fields: [] } };

export function ProjectSearchPanel({
  folderId, initialScope, context, onClose, onOpenHit, onOpenPrimerRecord, initialSaved, onReopenSaved, onApplyTableSearch, onSavedSearchesChanged,
}: Props) {
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const nextRowId = useRef(initialSaved ? initialSaved.conditions.length : 1);
  const [rows, setRows] = useState<Row[]>(() => initialSaved
    ? initialSaved.conditions.map((c, i) => ({ id: i, mode: c.mode, query: c.query }))
    : [{ id: 0, mode: 'Text', query: '' }]);
  const [combine, setCombine] = useState<CombineChoice>(initialSaved?.combine ?? 'ALL');
  const [fields, setFields] = useState<FilterFields>(initialSaved ? { ...initialSaved.filters } : NO_FILTERS);
  const [page, setPage] = useState(0);
  const [bothStrands, setBothStrands] = useState(initialSaved?.bothStrands ?? true);
  const [definiteOnly, setDefiniteOnly] = useState(false);
  const [includePrimers, setIncludePrimers] = useState(initialSaved?.includePrimers ?? false);
  /** A saved search chosen: its run starts at once, typed queries and all, with no pause. */
  const runAtOnce = useRef(Boolean(initialSaved));
  // One row is today's panel: its mode and query are the panel's own.
  const { mode, query } = rows[0];
  const multi = rows.length > 1;
  const offered = scopesOffered(folderId);
  const resolved = useMemo(() => resolveSearchScope(folderId, scope, context), [folderId, scope, context]);
  const searched = 'refused' in resolved ? null : resolved.documents;
  const trimmed = query.trim();
  const active = activeConditions(rows);

  // The filters as read from their fields; a bound that cannot be read refuses, never reads as none.
  const { filters, lengthReason, dateReason, filterRefused } = readFilterFields(fields);
  const filtering = activeFilterNames(filters).length > 0;

  const key = runKeyOf({ conditions: rows, combine, scope, bothStrands, filters: fields, includePrimers });
  const keyText = JSON.stringify(key);
  const primerRead = includePrimers ? context.primers ?? NOT_READ : null;
  const inputs = useMemo<RunInputs>(
    () => ({ documents: searched ?? [], foldersKey: foldersKeyOf(context.folders), primersKey: primerRead ? JSON.stringify(primerRead) : '' }),
    [searched, context.folders, primerRead],
  );

  const [runner] = useState(() => createSearchRunner());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<{ key: RunKey; inputs: RunInputs } | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [progress, setProgress] = useState<{ reached: number; total: number } | null>(null);
  const [cancelled, setCancelled] = useState<Cancelled | null>(null);
  /** Why the last hit clicked opened nothing; a run's new results drop it. */
  const [hitNotice, setHitNotice] = useState<string | null>(null);
  useEffect(() => { setHitNotice(null); }, [completed]);

  useEffect(() => {
    const prev = last.current;
    last.current = { key, inputs };
    const atOnce = runAtOnce.current;
    runAtOnce.current = false;
    const stopRun = () => {
      runner.stop();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setProgress(null);
      setCancelled(null);
    };
    // No query, an empty scope, a refused one and a filter that cannot be read each have their
    // sentence and run nothing.
    // An empty scope still searches the Primer Database when it is included.
    if (active.length === 0 || !searched || (searched.length === 0 && !primerRead) || filterRefused) { stopRun(); return; }
    const keyChanged = prev === null || !sameKey(prev.key, key);
    // The App passed a new context that reads the same: the run in progress or shown stands.
    if (!keyChanged && sameInputs(prev.inputs, inputs)) return;
    // A change of scope, a condition (added, removed or its mode), ALL / ANY, Both strands or a
    // filter runs at once. Typing in a query and a change of the documents wait for the pause.
    const now = atOnce || (prev !== null && keyChanged && !queryTyped(prev.key, key));
    stopRun();
    const runKey = key;
    const runInputs = inputs;
    const runDeleted = new Set(context.deletedIds);
    const request: SearchRequest = multi
      ? {
        mode: 'Conditions', conditions: rows.map((r) => ({ mode: r.mode, query: r.query })), documents: searched,
        folders: context.folders, bothStrands, engine: searchIupacMotifRust, filters, primers: primerRead ?? undefined,
      }
      : mode === 'Text'
        ? { mode, query: trimmed, documents: searched, folders: context.folders, filters, primers: primerRead ?? undefined }
        : {
          mode, query: trimmed, documents: searched, folders: context.folders, bothStrands, engine: searchIupacMotifRust, filters,
          primers: primerRead ?? undefined,
        };
    const begin = () => {
      timer.current = null;
      setProgress({ reached: 0, total: searched.length });
      runner.start(request, (event) => {
        if (event.kind === 'progress') setProgress({ reached: event.reached, total: event.total });
        else {
          setProgress(null);
          setCompleted({ key: runKey, inputs: runInputs, deletedIds: runDeleted, result: event.result });
        }
      });
    };
    if (now) begin();
    else timer.current = setTimeout(begin, SEARCH_PAUSE_MS);
    // Every value the run reads is in `key` and `inputs`, compared above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyText, inputs]);
  useEffect(() => () => {
    runner.stop();
    if (timer.current !== null) clearTimeout(timer.current);
  }, [runner]);

  const cancelRun = () => {
    if (!progress) return;
    runner.stop();
    setCancelled({ key, reached: progress.reached, total: progress.total });
    setProgress(null);
  };

  // Listed only for what is chosen now; a cancelled run lists nothing. A refused filter's key holds
  // its fields as typed, which no run's key does, so no earlier run is listed under it.
  const isCancelled = cancelled && sameKey(cancelled.key, key) ? cancelled : null;
  const current = !isCancelled && completed && sameKey(completed.key, key) ? completed : null;
  const outOfDate = current !== null && !sameInputs(current.inputs, inputs);
  const outcome = current && current.result.mode === 'Text' ? current.result.outcome : null;
  const motif = current && current.result.mode !== 'Text' && current.result.mode !== 'Conditions' ? current.result.outcome : null;
  const motifMode = current && current.result.mode !== 'Text' && current.result.mode !== 'Conditions' ? current.result.mode : null;
  const conditionsOutcome = current && current.result.mode === 'Conditions' ? current.result.outcome : null;
  const tally = current?.result.filtering ?? null;
  const byId = useMemo(() => new Map((searched ?? []).map((d) => [d.id, d])), [searched]);

  // The choices the type and annotation filters offer: those the scope's documents hold.
  const typeOptions = useMemo(() => [...new Set((searched ?? []).map((d) => inferDocumentTypeLabel(d)))].sort(), [searched]);
  const annotationOptions = useMemo(() => [...new Set((searched ?? []).flatMap((d) => d.features.map((f) => f.type)))].sort(), [searched]);

  /** Opens `ref` from the document as the catalog holds it now, or says why it opens nothing. */
  const openHit = (documentId: string, ref: SearchHitRef) => {
    if (!current) return;
    const searchedDoc = current.inputs.documents.find((d) => d.id === documentId);
    if (!searchedDoc) return;
    const now = context.documents.find((d) => d.id === documentId);
    const answer = openSearchHit(
      ref,
      { doc: searchedDoc, deleted: current.deletedIds.has(documentId) },
      now ? { doc: now, deleted: context.deletedIds.includes(documentId) } : null,
    );
    if ('refused' in answer) { setHitNotice(answer.refused); return; }
    setHitNotice(onOpenHit?.(answer.opens) ?? null);
  };

  // The Primer Database's part of the run (US-01M7DVZP): its conditions combine over a record as
  // over a document, and Definite only drops a record's possible hits as a document's.
  const primerResult = current?.result.primers ?? null;
  const primerAnswer = primerResult && 'records' in primerResult ? primerResult : null;
  const searchedRecords = useMemo(
    () => new Map((primerAnswer?.records ?? []).map((r) => [r.record.id, r.record])),
    [primerAnswer],
  );
  const primerCombined = primerAnswer
    ? combineConditions(
      primerAnswer.records.map((r) => ({ documentId: r.record.id, documentName: r.record.name, folderPath: PRIMER_GROUP_HEADING, answers: r.answers })),
      active, multi ? combine : 'ALL', definiteOnly,
    )
    : null;
  /** Opens a record hit from the store as the App holds it now, or says why it opens nothing. */
  const openPrimer = (record: DatabasePrimer) => {
    const answer = openPrimerHit(record, context.primers);
    if ('refused' in answer) { setHitNotice(answer.refused); return; }
    setHitNotice(null);
    onOpenPrimerRecord?.(answer.opens);
  };

  const results = outcome && !('refused' in outcome) ? outcome.results : [];
  const motifAnswer = motif && 'results' in motif ? motif : null;
  // Definite only drops the possible hits, and with them a document whose hits are all possible.
  const motifResults: DocumentMotifResult[] = !motifAnswer ? []
    : definiteOnly ? motifAnswer.results.filter((r) => r.definiteHits > 0) : motifAnswer.results;
  const conditionsAnswer = conditionsOutcome && 'documents' in conditionsOutcome ? conditionsOutcome : null;
  const combined = conditionsAnswer
    ? combineConditions(conditionsAnswer.documents, conditionsAnswer.conditions, combine, definiteOnly)
    : { results: [] as CombinedResult[], notSearched: [] as MotifNotSearched[] };
  const groupCount = multi ? combined.results.length : mode === 'Text' ? results.length : motifResults.length;
  const pages = Math.max(1, Math.ceil(groupCount / GROUPS_PER_PAGE));
  const shownPage = Math.min(page, pages - 1);
  const first = shownPage * GROUPS_PER_PAGE;
  const shown = multi ? [] : results.slice(first, first + GROUPS_PER_PAGE);
  const shownMotif = multi ? [] : motifResults.slice(first, first + GROUPS_PER_PAGE);
  const shownCombined = combined.results.slice(first, first + GROUPS_PER_PAGE);
  const shownCount = multi ? shownCombined.length : mode === 'Text' ? shown.length : shownMotif.length;
  const hitTotal = results.reduce((n, r) => n + r.hits.length, 0);
  const notSearched = [
    ...(multi ? combined.notSearched : motifAnswer?.notSearched ?? []),
    // Listed, never counted among the documents not searched.
    ...(primerResult && 'notSearched' in primerResult && primerResult.notSearched === PRIMERS_NOT_PROTEIN
      ? [{ documentId: PRIMER_DATABASE_NAME, documentName: PRIMER_DATABASE_NAME, folderPath: PRIMER_GROUP_HEADING, reason: PRIMERS_NOT_PROTEIN }]
      : []),
    ...(primerCombined?.notSearched ?? []),
  ];

  /** The hits a section lists and counts: under Definite only, a motif condition's definite ones. */
  const sectionHits = (section: CombinedResult['sections'][number]) => ('textHits' in section
    ? section.textHits.length : definiteOnly ? section.motif.definiteHits : section.motif.totalHits);
  /** What the filters left out, said after the documents searched while one is set. */
  const filterTail = filtering && tally ? ` · ${tally.filteredOut} filtered out · ${tally.notApplicable.length} not applicable` : '';

  let message: string;
  let alert = 'refused' in resolved;
  if ('refused' in resolved) message = `This scope cannot be searched: ${resolved.refused}`;
  else if (resolved.documents.length === 0) message = `No documents in ${resolved.label}`;
  else if (filterRefused) { message = FILTER_REFUSED; alert = true; }
  else if (active.length === 0 || (current && 'refused' in current.result.outcome)) {
    message = mode === 'Text'
      ? `Type text to search ${count(resolved.documents.length, 'document')}`
      : `Type a motif to search ${count(resolved.documents.filter((d) => motifNotSearchedReason(d, mode) === null).length, 'document')}`;
  }
  else if (isCancelled) message = `Cancelled after ${isCancelled.reached} of ${count(isCancelled.total, 'document')}: no results are shown`;
  else if (!current) message = `Searching for "${multi ? active.map((c) => c.query).join(`" ${combine === 'ALL' ? 'and' : 'or'} "`) : trimmed}"…`;
  else if (outOfDate) message = 'Out of date: the documents changed. Searching again…';
  else if (conditionsOutcome) {
    if ('engineUnavailable' in conditionsOutcome) { message = `The motif engine is not available: ${conditionsOutcome.engineUnavailable}`; alert = true; }
    else if ('queryRefused' in conditionsOutcome) {
      message = `This motif cannot be searched: condition ${conditionsOutcome.condition}: ${conditionsOutcome.queryRefused}`;
      alert = true;
    }
    else {
      const tail = `${count(conditionsAnswer!.searched, 'document')} searched${filterTail}`;
      const listedHits = combined.results.reduce((n, r) => n + r.sections.reduce((m, sec) => m + sectionHits(sec), 0), 0);
      message = combined.results.length === 0
        ? `No matches in ${tail}`
        : `${motifCount(listedHits, 'hit')} in ${count(combined.results.length, 'document')} · ${tail}`;
    }
  }
  else if (motif) {
    if ('engineUnavailable' in motif) { message = `The motif engine is not available: ${motif.engineUnavailable}`; alert = true; }
    else if ('queryRefused' in motif) { message = `This motif cannot be searched: ${motif.queryRefused}`; alert = true; }
    else {
      const skipped = motifAnswer!.notSearched.length;
      const tail = `${count(motifAnswer!.searched, 'document')} searched · ${skipped} not searched${filterTail}`;
      const listedHits = motifResults.reduce((n, r) => n + (definiteOnly ? r.definiteHits : r.totalHits), 0);
      const hidden = definiteOnly ? motifAnswer!.results.reduce((n, r) => n + r.possibleHits, 0) : 0;
      message = motifResults.length === 0
        ? `No matches in ${tail}`
        : `${motifCount(listedHits, 'hit')} in ${count(motifResults.length, 'document')} · ${tail}`;
      if (hidden > 0) message += ` · ${motifCount(hidden, 'possible hit')} hidden`;
    }
  }
  else {
    // With a filter set, the documents searched are those that passed it.
    const searchedCount = tally ? tally.passed : resolved.documents.length;
    message = results.length === 0
      ? `No matches in ${count(searchedCount, 'document')} searched${filterTail}`
      : `${count(hitTotal, 'hit')} in ${count(results.length, 'document')} · ${count(searchedCount, 'document')} searched${filterTail}`;
  }

  /** The Primer Database group's own sentence: never searched, holding no active records, or its counts. */
  let primerStatus: string | null = null;
  if (primerResult && 'notSearched' in primerResult) primerStatus = `Not searched: ${primerResult.notSearched}`;
  else if (primerAnswer && primerCombined) {
    const listedHits = primerCombined.results.reduce((n, r) => n + r.sections.reduce((m, sec) => m + sectionHits(sec), 0), 0);
    const tail = `${count(primerAnswer.searched, 'record')} searched`;
    primerStatus = primerAnswer.searched === 0 ? NO_ACTIVE_PRIMERS
      : primerCombined.results.length === 0 ? `No matches in ${tail}`
        : `${motifCount(listedHits, 'hit')} in ${count(primerCombined.results.length, 'record')} · ${tail}`;
  }

  const setRow = (index: number, change: Partial<Row>) => {
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...change } : r)));
    setPage(0);
  };
  const addRow = () => {
    setRows((all) => [...all, { id: nextRowId.current++, mode: 'Text', query: '' }]);
    setPage(0);
  };
  const removeRow = (index: number) => {
    setRows((all) => all.filter((_, i) => i !== index));
    setPage(0);
  };
  const setField = (change: Partial<FilterFields>) => { setFields((f) => ({ ...f, ...change })); setPage(0); };

  // ─── Saved searches (US-01M7DV4Y) ───
  // Both stores are read when the panel opens and after each write it makes; an unreadable one is
  // shown by key and reason, and a save to it is refused by saveProjectSearch, keeping its value.
  const [stores, setStores] = useState(() => ({ project: readProjectSearches(), table: readTableSearches() }));
  const rereadStores = () => setStores({ project: readProjectSearches(), table: readTableSearches() });
  const [saveName, setSaveName] = useState<string | null>(null);
  const [chosenSaved, setChosenSaved] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const projectList = stores.project.state === 'unreadable' ? [] : stores.project.searches;
  const tableList = stores.table.state === 'unreadable' ? [] : stores.table.searches;
  const unreadableStores = [stores.project, stores.table].flatMap((r) => (r.state === 'unreadable' ? [r] : []));
  const saveSearch = (name: string) => {
    // What to search for and where; never the results, so a rerun reads the documents as they are then.
    const out = saveProjectSearch({
      name, conditions: rows.map((r) => ({ mode: r.mode, query: r.query })), combine, bothStrands, filters: { ...fields },
      includePrimers, scope, folderId,
    });
    setSaveName(null);
    setSavedNotice(out.ok ? `Saved search "${name}".` : out.sentence);
    rereadStores();
  };
  const applySaved = (x: ProjectSavedSearch) => {
    // At once only when its run key is not the panel's: then the run effect runs and clears the flag.
    // An equal key starts no run, so the flag is cleared here, and a rerun already pending stands.
    runAtOnce.current = JSON.stringify(runKeyOf(x)) !== keyText;
    setRows(x.conditions.map((c, i) => ({ id: nextRowId.current + i, mode: c.mode, query: c.query })));
    nextRowId.current += x.conditions.length;
    setCombine(x.combine);
    setFields({ ...x.filters });
    setBothStrands(x.bothStrands);
    setIncludePrimers(x.includePrimers);
    setScope(x.scope);
    setPage(0);
  };
  const chooseSaved = (value: string) => {
    setSavedNotice(null);
    if (value.startsWith('t:')) {
      const x = tableList.find((q) => q.id === value.slice(2));
      setChosenSaved('');
      if (x) onApplyTableSearch?.(x);
      return;
    }
    const x = projectList.find((q) => q.id === value.slice(2));
    if (!x) { setChosenSaved(''); return; }
    // The folder is found by id; one gone runs nothing and leaves the scope as it is.
    const where = savedSearchFolder(x, folderId, context.folders);
    if ('missing' in where) {
      setChosenSaved('');
      setSavedNotice(folderGoneSentence(x.name));
      return;
    }
    if (where.folderId !== folderId && onReopenSaved) { onReopenSaved(where.folderId, x); return; }
    setChosenSaved(value);
    applySaved(x);
  };
  const deleteChosen = () => {
    const x = projectList.find((q) => `p:${q.id}` === chosenSaved);
    setChosenSaved('');
    if (!x) return;
    const out = deleteProjectSearch(x.id, x.name);
    setSavedNotice(out.ok ? `Deleted saved search "${x.name}".` : out.sentence);
    rereadStores();
  };
  const discardUnreadable = () => {
    const failed = discardUnreadableSearches();
    setConfirmDiscard(false);
    setSavedNotice(failed.length > 0
      ? `The unreadable saved searches were not discarded (${failed.join(', ')}): browser storage refused the write.`
      : 'Discarded the unreadable saved searches.');
    rereadStores();
    onSavedSearchesChanged?.();
  };
  const queryLabel = (row: Row, n: number) => `${row.mode === 'Text' ? 'Search text' : 'Search motif'}${n > 1 ? `, condition ${n}` : ''}`;
  /** A condition row's own marks: why an empty one takes no part, and its Remove button. */
  const rowMarks = (row: Row, n: number) => (multi ? (
    <>
      {row.query.trim() === '' && <span className="mbc-project-search-empty-condition" data-part="empty-condition">(empty: not used)</span>}
      <button type="button" className="nav-cluster-icon-btn" aria-label={`Remove condition ${n}`} onClick={() => removeRow(n - 1)}>
        <X size={12} />
      </button>
    </>
  ) : null);
  const modeSelect = (row: Row, n: number) => (
    <select
      aria-label={n > 1 ? `Search mode, condition ${n}` : 'Search mode'}
      value={row.mode}
      onChange={(e) => setRow(n - 1, { mode: e.target.value as SearchMode })}
    >
      {SEARCH_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
  const anyNucleotide = rows.some((r) => r.mode === 'Nucleotide motif');
  const anyMotif = rows.some((r) => r.mode !== 'Text');
  const modesShown = [...new Set(rows.map((r) => r.mode))];

  const chips = FILTER_ORDER.filter((name) => FILTER_FIELDS[name].some((f) => fields[f] !== '')).map((name) => {
    const value = name === 'Document type' ? fields.documentType
      : name === 'Topology' ? fields.topology
        : name === 'Annotation type' ? fields.annotationType
          : name === 'Length' ? rangeText(fields.lengthMin, fields.lengthMax)
            : rangeText(fields.modifiedFrom, fields.modifiedTo);
    return { name, text: `${name}: ${value}` };
  });

  /** A record's hits open the record; `record` absent, a document's hits open the document. */
  const motifHitRows = (hits: MotifHit[], documentId: string, hitMode: MotifMode, record?: DatabasePrimer) => (
    <ul>
      {hits.map((hit, i) => (
        <li key={`${hit.start}-${hit.strand}-${i}`} data-search-hit>
          <button type="button" className="mbc-project-search-hit" onClick={() => (record ? openPrimer(record) : openHit(documentId, { mode: hitMode, hit }))}>
            <span data-part="coords">{hit.start}-{hit.end}</span>{' '}
            <span data-part="strand">{strandText(hit)}</span>{' '}
            <code data-part="letters">{hit.letters}</code>{' '}
            <span data-part="certainty">{hit.certainty}</span>
            {record && <>{' '}<span data-part="portion">{primerHitPortion(record, hit.start, hit.end)}</span></>}
          </button>
        </li>
      ))}
    </ul>
  );
  const textHitRows = (hits: TextHit[], documentId: string, record?: DatabasePrimer) => (
    <ul>
      {hits.map((hit, i) => (
        <li key={`${hit.field}-${hit.start}-${i}`} data-search-hit>
          <button type="button" className="mbc-project-search-hit" onClick={() => (record ? openPrimer(record) : openHit(documentId, { mode: 'Text', hit }))}>
            <span className="mbc-project-search-field" data-part="field">{hit.field}</span>
            <Snippet hit={hit} />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      role="dialog"
      aria-label="Search Project"
      className="mbc-project-search studio-card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="mbc-project-search-head">
        <h2>Search Project</h2>
        <button type="button" className="nav-cluster-icon-btn" aria-label="Close Search Project" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <input
        type="search"
        className="mbc-project-search-input"
        aria-label={queryLabel(rows[0], 1)}
        placeholder={mode === 'Text' ? 'Search text…' : 'Search motif…'}
        value={query}
        autoFocus
        onChange={(e) => setRow(0, { query: e.target.value })}
      />
      {rowMarks(rows[0], 1)}
      <fieldset className="mbc-project-search-scopes">
        <legend>Scope</legend>
        {offered.map((s) => (
          <label key={s}>
            <input
              type="radio"
              name="mbc-project-search-scope"
              value={s}
              checked={s === scope}
              onChange={() => { setScope(s); setPage(0); }}
            />
            {s}
          </label>
        ))}
      </fieldset>
      <div className="mbc-project-search-mode">
        <label>
          Search mode{' '}
          {modeSelect(rows[0], 1)}
        </label>
        {anyNucleotide && (
          <label>
            <input type="checkbox" checked={bothStrands} onChange={(e) => { setBothStrands(e.target.checked); setPage(0); }} />
            Both strands
          </label>
        )}
        {anyMotif && (
          <label>
            <input type="checkbox" checked={definiteOnly} onChange={(e) => { setDefiniteOnly(e.target.checked); setPage(0); }} />
            Definite only
          </label>
        )}
        <label>
          <input type="checkbox" checked={includePrimers} onChange={(e) => { setIncludePrimers(e.target.checked); setPage(0); }} />
          Include Primer Database
        </label>
      </div>
      {multi && (
        <div className="mbc-project-search-conditions">
          <label>
            Combine conditions{' '}
            <select aria-label="Combine conditions" value={combine} onChange={(e) => { setCombine(e.target.value as CombineChoice); setPage(0); }}>
              {COMBINE_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {rows.slice(1).map((row, i) => {
            const n = i + 2;
            return (
              <div key={row.id} className="mbc-project-search-condition" data-search-condition-row={n}>
                <span className="mbc-project-search-joiner" data-part="joiner">{combine === 'ALL' ? 'and' : 'or'}</span>
                <input
                  type="search"
                  className="mbc-project-search-input"
                  aria-label={queryLabel(row, n)}
                  placeholder={row.mode === 'Text' ? 'Search text…' : 'Search motif…'}
                  value={row.query}
                  onChange={(e) => setRow(n - 1, { query: e.target.value })}
                />
                {modeSelect(row, n)}
                {rowMarks(row, n)}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="mbc-project-search-add-condition" onClick={addRow}>Add condition</button>
      <fieldset className="mbc-project-search-filters">
        <legend>Filters</legend>
        <label>
          Document type{' '}
          <select aria-label="Document type" value={fields.documentType} onChange={(e) => setField({ documentType: e.target.value })}>
            <option value="">Any</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Topology{' '}
          <select aria-label="Topology" value={fields.topology} onChange={(e) => setField({ topology: e.target.value as FilterFields['topology'] })}>
            <option value="">Any</option>
            <option value="circular">circular</option>
            <option value="linear">linear</option>
          </select>
        </label>
        <span role="group" aria-label={LENGTH_LABEL} className="mbc-project-search-range">
          {LENGTH_LABEL}{' '}
          <input inputMode="numeric" aria-label={`${LENGTH_LABEL}, minimum`} placeholder="min" value={fields.lengthMin} onChange={(e) => setField({ lengthMin: e.target.value })} {...refusedBy(lengthReason, LENGTH_REASON_ID)} />
          {' – '}
          <input inputMode="numeric" aria-label={`${LENGTH_LABEL}, maximum`} placeholder="max" value={fields.lengthMax} onChange={(e) => setField({ lengthMax: e.target.value })} {...refusedBy(lengthReason, LENGTH_REASON_ID)} />
          {lengthReason && <span id={LENGTH_REASON_ID} className="mbc-project-search-filter-reason" data-filter-reason="Length">{lengthReason}</span>}
        </span>
        <span role="group" aria-label="Modified date" className="mbc-project-search-range">
          Modified date{' '}
          <input aria-label="Modified date, from" placeholder="YYYY-MM-DD" value={fields.modifiedFrom} onChange={(e) => setField({ modifiedFrom: e.target.value })} {...refusedBy(dateReason, DATE_REASON_ID)} />
          {' – '}
          <input aria-label="Modified date, to" placeholder="YYYY-MM-DD" value={fields.modifiedTo} onChange={(e) => setField({ modifiedTo: e.target.value })} {...refusedBy(dateReason, DATE_REASON_ID)} />
          {dateReason && <span id={DATE_REASON_ID} className="mbc-project-search-filter-reason" data-filter-reason="Modified date">{dateReason}</span>}
        </span>
        <label>
          Annotation type{' '}
          <select aria-label="Annotation type" value={fields.annotationType} onChange={(e) => setField({ annotationType: e.target.value })}>
            <option value="">Any</option>
            {annotationOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </fieldset>
      {chips.length > 0 && (
        <ul className="mbc-project-search-chips">
          {chips.map((chip) => (
            <li key={chip.name} data-search-filter-chip={chip.name}>
              <span data-part="chip">{chip.text}</span>
              <button
                type="button"
                className="nav-cluster-icon-btn"
                aria-label={`Remove ${chip.name.toLowerCase()} filter`}
                onClick={() => setField(Object.fromEntries(FILTER_FIELDS[chip.name].map((f) => [f, ''])))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mbc-project-search-saved" data-saved-searches>
        {saveName === null ? (
          <button type="button" className="mbc-filter-small-btn" disabled={active.length === 0} onClick={() => setSaveName('')}>Save search…</button>
        ) : (
          <span className="mbc-filter-save-row">
            <input
              autoFocus
              type="text"
              aria-label="Saved search name"
              placeholder="Search name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) { e.preventDefault(); saveSearch(saveName.trim()); }
                if (e.key === 'Escape') { e.stopPropagation(); setSaveName(null); }
              }}
            />
            <button type="button" className="mbc-filter-small-btn" disabled={!saveName.trim()} onClick={() => saveSearch(saveName.trim())}>Save</button>
            <button type="button" className="mbc-filter-small-btn" onClick={() => setSaveName(null)}>Cancel</button>
          </span>
        )}
        {(projectList.length > 0 || tableList.length > 0) && (
          <select aria-label="Saved searches" value={chosenSaved} onChange={(e) => chooseSaved(e.target.value)}>
            <option value="">Saved searches…</option>
            {projectList.length > 0 && (
              <optgroup label="Project searches">
                {projectList.map((x) => <option key={x.id} value={`p:${x.id}`}>{x.name}</option>)}
              </optgroup>
            )}
            {tableList.length > 0 && (
              <optgroup label="Table filter searches (open in the document table)">
                {tableList.map((x) => <option key={x.id} value={`t:${x.id}`}>{x.name}</option>)}
              </optgroup>
            )}
          </select>
        )}
        {chosenSaved.startsWith('p:') && (
          <button type="button" className="mbc-filter-small-btn" onClick={deleteChosen}>Delete saved search</button>
        )}
        {unreadableStores.map((r) => <p key={r.key} role="alert" data-saved-search-unreadable={r.key}>{unreadableStoreSentence(r)}</p>)}
        {unreadableStores.length > 0 && (confirmDiscard ? (
          <span className="mbc-filter-save-row">
            The stored values that cannot be read are replaced with empty lists.{' '}
            <button type="button" className="mbc-filter-small-btn" onClick={discardUnreadable}>Discard them</button>
            <button type="button" className="mbc-filter-small-btn" onClick={() => setConfirmDiscard(false)}>Keep them</button>
          </span>
        ) : (
          <button type="button" className="mbc-filter-small-btn" onClick={() => setConfirmDiscard(true)}>Discard unreadable saved searches</button>
        ))}
        {savedNotice && <p role="status" data-saved-search-notice>{savedNotice}</p>}
      </div>
      {'refused' in resolved ? null : (
        <p className="mbc-project-search-scope">
          Searching: <strong data-search-scope-label>{resolved.label}</strong>
        </p>
      )}
      {modesShown.map((m) => <p key={m} className="mbc-project-search-fields">{MODE_STATEMENT[m]}</p>)}
      <p className="mbc-project-search-summary" role={alert ? 'alert' : 'status'} data-search-summary>
        {message}
      </p>
      {progress && (
        <button type="button" className="mbc-project-search-cancel" onClick={cancelRun}>Cancel search</button>
      )}
      {hitNotice && (
        <p className="mbc-project-search-hit-notice" role="alert" data-search-hit-notice>{hitNotice}</p>
      )}
      {groupCount > GROUPS_PER_PAGE && (
        <div className="mbc-project-search-pager">
          <button type="button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>Previous</button>
          <span data-search-pager-range>
            Groups {first + 1}-{first + shownCount} of {groupCount}
          </span>
          <button type="button" disabled={shownPage >= pages - 1} onClick={() => setPage(shownPage + 1)}>Next</button>
        </div>
      )}
      {shown.length > 0 && (
        <ol className="mbc-project-search-results">
          {shown.map((group) => {
            const doc = byId.get(group.documentId);
            return (
              <li key={group.documentId} data-search-group={group.documentId} className="mbc-project-search-group">
                <div className="mbc-project-search-group-head">
                  <strong data-part="name">{group.documentName}</strong>
                  <span data-part="path">{group.folderPath}</span>
                  <span data-part="type">{doc ? inferDocumentTypeLabel(doc) : ''}</span>
                  <span data-part="hits">{count(group.hits.length, 'hit')}</span>
                </div>
                {textHitRows(group.hits, group.documentId)}
              </li>
            );
          })}
        </ol>
      )}
      {shownMotif.length > 0 && (
        <ol className="mbc-project-search-results">
          {shownMotif.map((group) => {
            const doc = byId.get(group.documentId);
            const hits = definiteOnly ? group.hits.filter((h) => h.certainty === 'definite') : group.hits;
            return (
              <li key={group.documentId} data-search-group={group.documentId} className="mbc-project-search-group">
                <div className="mbc-project-search-group-head">
                  <strong data-part="name">{group.documentName}</strong>
                  <span data-part="path">{group.folderPath}</span>
                  <span data-part="type">{doc ? inferDocumentTypeLabel(doc) : ''}</span>
                  <span data-part="hits">
                    {motifCount(group.totalHits, 'hit')} ({group.definiteHits.toLocaleString('en-US')} definite, {group.possibleHits.toLocaleString('en-US')} possible)
                  </span>
                </div>
                {group.warnings.map((w) => <p key={w} className="mbc-project-search-warning" data-part="warning">{w}</p>)}
                {motifHitRows(hits, group.documentId, motifMode!)}
              </li>
            );
          })}
        </ol>
      )}
      {shownCombined.length > 0 && (
        <ol className="mbc-project-search-results">
          {shownCombined.map((group) => {
            const doc = byId.get(group.documentId);
            return (
              <li key={group.documentId} data-search-group={group.documentId} className="mbc-project-search-group">
                <div className="mbc-project-search-group-head">
                  <strong data-part="name">{group.documentName}</strong>
                  <span data-part="path">{group.folderPath}</span>
                  <span data-part="type">{doc ? inferDocumentTypeLabel(doc) : ''}</span>
                  <span data-part="hits">{motifCount(group.sections.reduce((n, sec) => n + sectionHits(sec), 0), 'hit')}</span>
                </div>
                {group.sections.map((section) => {
                  const { condition, mode: conditionMode, query: conditionQuery } = section.condition;
                  return (
                    <div key={condition} className="mbc-project-search-condition-hits" data-search-condition={condition}>
                      <h4 data-part="condition">Condition {condition}: {conditionMode} {conditionQuery}</h4>
                      {'textHits' in section ? textHitRows(section.textHits, group.documentId) : (
                        <>
                          {section.motif.warnings.map((w) => <p key={w} className="mbc-project-search-warning" data-part="warning">{w}</p>)}
                          {motifHitRows(
                            definiteOnly ? section.motif.hits.filter((h) => h.certainty === 'definite') : section.motif.hits,
                            group.documentId, conditionMode as MotifMode,
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ol>
      )}
      {current && primerResult && (
        <section className="mbc-project-search-primer-group" data-search-primer-group aria-label={PRIMER_GROUP_HEADING}>
          <h3 data-part="heading">{PRIMER_GROUP_HEADING}</h3>
          <p data-part="primer-status">{primerStatus}</p>
          {primerAnswer && primerAnswer.trashed > 0 && <p data-part="primer-trashed">{trashedNotSearched(primerAnswer.trashed)}</p>}
          {primerCombined && primerCombined.results.length > 0 && (
            <ol>
              {primerCombined.results.map((group) => {
                const record = searchedRecords.get(group.documentId)!;
                return (
                  <li key={group.documentId} data-search-primer-record={group.documentId}>
                    <div className="mbc-project-search-group-head">
                      <strong data-part="name">{group.documentName}</strong>
                      <span data-part="hits">{motifCount(group.sections.reduce((n, sec) => n + sectionHits(sec), 0), 'hit')}</span>
                    </div>
                    {group.sections.map((section) => {
                      const { condition, mode: conditionMode, query: conditionQuery } = section.condition;
                      return (
                        <div key={condition} className="mbc-project-search-condition-hits" data-search-condition={condition}>
                          {multi && <h4 data-part="condition">Condition {condition}: {conditionMode} {conditionQuery}</h4>}
                          {'textHits' in section ? textHitRows(section.textHits, group.documentId, record) : motifHitRows(
                            definiteOnly ? section.motif.hits.filter((h) => h.certainty === 'definite') : section.motif.hits,
                            group.documentId, conditionMode as MotifMode, record,
                          )}
                        </div>
                      );
                    })}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
      {notSearched.length > 0 && (
        <section className="mbc-project-search-not-searched" data-search-not-searched>
          <h3>Not searched</h3>
          <ul>
            {notSearched.map((skip) => (
              <li key={`${skip.documentId} ${skip.reason}`} data-search-skip={skip.documentId}>
                <strong data-part="name">{skip.documentName}</strong>{' '}
                <span data-part="path">{skip.folderPath}</span>{' '}
                <span data-part="reason">{skip.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {current && tally && tally.notApplicable.length > 0 && (
        <section className="mbc-project-search-not-applicable" data-search-not-applicable>
          <h3>Not applicable</h3>
          <ul>
            {tally.notApplicable.map((na) => (
              <li key={na.documentId} data-search-not-applicable-doc={na.documentId}>
                <strong data-part="name">{na.documentName}</strong>{' '}
                <span data-part="path">{na.folderPath}</span>{' '}
                <span data-part="reason">{na.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
