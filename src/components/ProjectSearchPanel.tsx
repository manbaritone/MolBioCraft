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
 */

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  motifNotSearchedReason,
  NUCLEOTIDE_MOTIF_STATEMENT,
  PROTEIN_MOTIF_STATEMENT,
  resolveSearchScope,
  scopesOffered,
  SEARCH_MODES,
  searchMotif,
  searchText,
  TEXT_SEARCH_STATEMENT,
  type DocumentMotifResult,
  type MotifHit,
  type SearchContext,
  type SearchMode,
  type SearchScope,
  type TextHit,
} from '../core/projectSearch';
import { inferDocumentTypeLabel } from '../core/workbenchBatchOperations';
import { searchIupacMotifRust } from '../lib/rustBioEngine';

/** Groups shown on one page. */
export const GROUPS_PER_PAGE = 50;
/** Characters of the field's value shown on each side of a match. */
const SNIPPET_CONTEXT = 40;

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
function Snippet({ hit }: { hit: TextHit }) {
  const from = Math.max(0, hit.start - SNIPPET_CONTEXT);
  const to = Math.min(hit.value.length, hit.end + SNIPPET_CONTEXT);
  return (
    <span className="mbc-project-search-snippet" data-part="snippet">
      {from > 0 ? '…' : ''}
      {hit.value.slice(from, hit.start)}
      <mark>{hit.value.slice(hit.start, hit.end)}</mark>
      {hit.value.slice(hit.end, to)}
      {to < hit.value.length ? '…' : ''}
    </span>
  );
}

interface Props {
  folderId: string;
  initialScope: SearchScope;
  context: SearchContext;
  onClose: () => void;
}

export function ProjectSearchPanel({ folderId, initialScope, context, onClose }: Props) {
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<SearchMode>('Text');
  const [bothStrands, setBothStrands] = useState(true);
  const [definiteOnly, setDefiniteOnly] = useState(false);
  const offered = scopesOffered(folderId);
  const resolved = useMemo(() => resolveSearchScope(folderId, scope, context), [folderId, scope, context]);
  const searched = 'refused' in resolved ? null : resolved.documents;
  const outcome = useMemo(
    () => (mode === 'Text' && searched && searched.length > 0 ? searchText(query, searched, context.folders) : null),
    [mode, query, searched, context.folders],
  );
  const motif = useMemo(
    () => (mode !== 'Text' && searched && searched.length > 0
      ? searchMotif(query, searched, context.folders, mode, bothStrands, searchIupacMotifRust)
      : null),
    [mode, query, searched, context.folders, bothStrands],
  );
  const byId = useMemo(() => new Map((searched ?? []).map((d) => [d.id, d])), [searched]);

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
  else if (mode !== 'Text') {
    const readable = resolved.documents.filter((d) => motifNotSearchedReason(d, mode) === null).length;
    if (!motif || 'refused' in motif) message = `Type a motif to search ${count(readable, 'document')}`;
    else if ('engineUnavailable' in motif) { message = `The motif engine is not available: ${motif.engineUnavailable}`; alert = true; }
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
  else if (!outcome || 'refused' in outcome) message = `Type text to search ${count(resolved.documents.length, 'document')}`;
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
                      <span className="mbc-project-search-field" data-part="field">{hit.field}</span>
                      <Snippet hit={hit} />
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
                      <span data-part="coords">{hit.start}-{hit.end}</span>{' '}
                      <span data-part="strand">{strandText(hit)}</span>{' '}
                      <code data-part="letters">{hit.letters}</code>{' '}
                      <span data-part="certainty">{hit.certainty}</span>
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
