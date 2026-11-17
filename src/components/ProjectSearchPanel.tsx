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
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  createSearchRunner,
  motifNotSearchedReason,
  NUCLEOTIDE_MOTIF_STATEMENT,
  openSearchHit,
  PROTEIN_MOTIF_STATEMENT,
  resolveSearchScope,
  scopesOffered,
  SEARCH_MODES,
  snippetOf,
  TEXT_SEARCH_STATEMENT,
  type DocumentMotifResult,
  type HitOpening,
  type MotifHit,
  type SearchContext,
  type SearchMode,
  type SearchRequest,
  type SearchRunResult,
  type SearchHitRef,
  type SearchScope,
  type TextHit,
} from '../core/projectSearch';
import type { ExplorerFolder } from '../core/projectExplorer';
import type { SequenceDocument } from '../types/bio';
import { inferDocumentTypeLabel } from '../core/workbenchBatchOperations';
import { searchIupacMotifRust } from '../lib/rustBioEngine';

/** Groups shown on one page. */
export const GROUPS_PER_PAGE = 50;
/** The pause after the last keystroke, or after the documents change, before a search runs. */
export const SEARCH_PAUSE_MS = 250;

/** What a run searched for: its results are listed only while all four are still the chosen ones. */
interface RunKey { query: string; scope: SearchScope; mode: SearchMode; bothStrands: boolean }
const sameKey = (a: RunKey, b: RunKey) =>
  a.query === b.query && a.scope === b.scope && a.mode === b.mode && a.bothStrands === b.bothStrands;

/** What a run read: the scope's documents and the folders their paths come from. */
interface RunInputs { documents: SequenceDocument[]; foldersKey: string }
const foldersKeyOf = (folders: ExplorerFolder[]) =>
  JSON.stringify(folders.map((f) => [f.id, f.label, f.parent, f.matchFolders]));
/** Whether two runs read the same: the same document objects in the same order, under the same folders. */
const sameInputs = (a: RunInputs, b: RunInputs) => a.foldersKey === b.foldersKey
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
}

export function ProjectSearchPanel({ folderId, initialScope, context, onClose, onOpenHit }: Props) {
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<SearchMode>('Text');
  const [bothStrands, setBothStrands] = useState(true);
  const [definiteOnly, setDefiniteOnly] = useState(false);
  const offered = scopesOffered(folderId);
  const resolved = useMemo(() => resolveSearchScope(folderId, scope, context), [folderId, scope, context]);
  const searched = 'refused' in resolved ? null : resolved.documents;
  const trimmed = query.trim();
  const key: RunKey = { query: trimmed, scope, mode, bothStrands };
  const inputs = useMemo<RunInputs>(
    () => ({ documents: searched ?? [], foldersKey: foldersKeyOf(context.folders) }),
    [searched, context.folders],
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
    const stopRun = () => {
      runner.stop();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setProgress(null);
      setCancelled(null);
    };
    // An empty query, an empty scope and a refused one each have their sentence and run nothing.
    if (trimmed === '' || !searched || searched.length === 0) { stopRun(); return; }
    const keyChanged = prev === null || !sameKey(prev.key, key);
    // The App passed a new context that reads the same: the run in progress or shown stands.
    if (!keyChanged && sameInputs(prev.inputs, inputs)) return;
    // Scope, mode or Both strands changed under the same query: run at once. Typing and a change
    // of the documents wait for the pause.
    const now = prev !== null && keyChanged && prev.key.query === key.query;
    stopRun();
    const runKey = key;
    const runInputs = inputs;
    const runDeleted = new Set(context.deletedIds);
    const request: SearchRequest = mode === 'Text'
      ? { mode, query: trimmed, documents: searched, folders: context.folders }
      : { mode, query: trimmed, documents: searched, folders: context.folders, bothStrands, engine: searchIupacMotifRust };
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
  }, [trimmed, scope, mode, bothStrands, inputs]);
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

  // Listed only for what is chosen now; a cancelled run lists nothing.
  const isCancelled = cancelled && sameKey(cancelled.key, key) ? cancelled : null;
  const current = !isCancelled && completed && sameKey(completed.key, key) ? completed : null;
  const outOfDate = current !== null && !sameInputs(current.inputs, inputs);
  const outcome = current && current.result.mode === 'Text' ? current.result.outcome : null;
  const motif = current && current.result.mode !== 'Text' ? current.result.outcome : null;
  const motifMode = current && current.result.mode !== 'Text' ? current.result.mode : null;
  const byId = useMemo(() => new Map((searched ?? []).map((d) => [d.id, d])), [searched]);

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

  const results = outcome && !('refused' in outcome) ? outcome.results : [];
  const motifAnswer = motif && 'results' in motif ? motif : null;
  // Definite only drops the possible hits, and with them a document whose hits are all possible.
  const motifResults: DocumentMotifResult[] = !motifAnswer ? []
    : definiteOnly ? motifAnswer.results.filter((r) => r.definiteHits > 0) : motifAnswer.results;
  const groupCount = mode === 'Text' ? results.length : motifResults.length;
  const pages = Math.max(1, Math.ceil(groupCount / GROUPS_PER_PAGE));
  const shownPage = Math.min(page, pages - 1);
  const first = shownPage * GROUPS_PER_PAGE;
  const shown = results.slice(first, first + GROUPS_PER_PAGE);
  const shownMotif = motifResults.slice(first, first + GROUPS_PER_PAGE);
  const shownCount = mode === 'Text' ? shown.length : shownMotif.length;
  const hitTotal = results.reduce((n, r) => n + r.hits.length, 0);

  let message: string;
  let alert = 'refused' in resolved;
  if ('refused' in resolved) message = `This scope cannot be searched: ${resolved.refused}`;
  else if (resolved.documents.length === 0) message = `No documents in ${resolved.label}`;
  else if (trimmed === '' || (current && 'refused' in current.result.outcome)) {
    message = mode === 'Text'
      ? `Type text to search ${count(resolved.documents.length, 'document')}`
      : `Type a motif to search ${count(resolved.documents.filter((d) => motifNotSearchedReason(d, mode) === null).length, 'document')}`;
  }
  else if (isCancelled) message = `Cancelled after ${isCancelled.reached} of ${count(isCancelled.total, 'document')}: no results are shown`;
  else if (!current) message = `Searching for "${trimmed}"…`;
  else if (outOfDate) message = 'Out of date: the documents changed. Searching again…';
  else if (motif) {
    if ('engineUnavailable' in motif) { message = `The motif engine is not available: ${motif.engineUnavailable}`; alert = true; }
    else if ('queryRefused' in motif) { message = `This motif cannot be searched: ${motif.queryRefused}`; alert = true; }
    else {
      const skipped = motifAnswer!.notSearched.length;
      const tail = `${count(motifAnswer!.searched, 'document')} searched · ${skipped} not searched`;
      const listedHits = motifResults.reduce((n, r) => n + (definiteOnly ? r.definiteHits : r.totalHits), 0);
      const hidden = definiteOnly ? motifAnswer!.results.reduce((n, r) => n + r.possibleHits, 0) : 0;
      message = motifResults.length === 0
        ? `No matches in ${tail}`
        : `${motifCount(listedHits, 'hit')} in ${count(motifResults.length, 'document')} · ${tail}`;
      if (hidden > 0) message += ` · ${motifCount(hidden, 'possible hit')} hidden`;
    }
  }
  else if (results.length === 0) message = `No matches in ${count(resolved.documents.length, 'document')} searched`;
  else message = `${count(hitTotal, 'hit')} in ${count(results.length, 'document')} · ${count(resolved.documents.length, 'document')} searched`;

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
        aria-label={mode === 'Text' ? 'Search text' : 'Search motif'}
        placeholder={mode === 'Text' ? 'Search text…' : 'Search motif…'}
        value={query}
        autoFocus
        onChange={(e) => { setQuery(e.target.value); setPage(0); }}
      />
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
          <select
            aria-label="Search mode"
            value={mode}
            onChange={(e) => { setMode(e.target.value as SearchMode); setPage(0); }}
          >
            {SEARCH_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {mode === 'Nucleotide motif' && (
          <label>
            <input type="checkbox" checked={bothStrands} onChange={(e) => { setBothStrands(e.target.checked); setPage(0); }} />
            Both strands
          </label>
        )}
        {mode !== 'Text' && (
          <label>
            <input type="checkbox" checked={definiteOnly} onChange={(e) => { setDefiniteOnly(e.target.checked); setPage(0); }} />
            Definite only
          </label>
        )}
      </div>
      {'refused' in resolved ? null : (
        <p className="mbc-project-search-scope">
          Searching: <strong data-search-scope-label>{resolved.label}</strong>
        </p>
      )}
      <p className="mbc-project-search-fields">{MODE_STATEMENT[mode]}</p>
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
                <ul>
                  {group.hits.map((hit, i) => (
                    <li key={`${hit.field}-${hit.start}-${i}`} data-search-hit>
                      <button type="button" className="mbc-project-search-hit" onClick={() => openHit(group.documentId, { mode: 'Text', hit })}>
                        <span className="mbc-project-search-field" data-part="field">{hit.field}</span>
                        <Snippet hit={hit} />
                      </button>
                    </li>
                  ))}
                </ul>
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
                <ul>
                  {hits.map((hit, i) => (
                    <li key={`${hit.start}-${hit.strand}-${i}`} data-search-hit>
                      <button type="button" className="mbc-project-search-hit" onClick={() => openHit(group.documentId, { mode: motifMode!, hit })}>
                        <span data-part="coords">{hit.start}-{hit.end}</span>{' '}
                        <span data-part="strand">{strandText(hit)}</span>{' '}
                        <code data-part="letters">{hit.letters}</code>{' '}
                        <span data-part="certainty">{hit.certainty}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
      {motifAnswer && motifAnswer.notSearched.length > 0 && (
        <section className="mbc-project-search-not-searched" data-search-not-searched>
          <h3>Not searched</h3>
          <ul>
            {motifAnswer.notSearched.map((skip) => (
              <li key={skip.documentId} data-search-skip={skip.documentId}>
                <strong data-part="name">{skip.documentName}</strong>{' '}
                <span data-part="path">{skip.folderPath}</span>{' '}
                <span data-part="reason">{skip.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
