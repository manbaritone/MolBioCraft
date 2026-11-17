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
 */

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  resolveSearchScope,
  scopesOffered,
  searchText,
  TEXT_SEARCH_STATEMENT,
  type SearchContext,
  type SearchScope,
  type TextHit,
} from '../core/projectSearch';
import { inferDocumentTypeLabel } from '../core/workbenchBatchOperations';

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
  const offered = scopesOffered(folderId);
  const resolved = useMemo(() => resolveSearchScope(folderId, scope, context), [folderId, scope, context]);
  const searched = 'refused' in resolved ? null : resolved.documents;
  const outcome = useMemo(
    () => (searched && searched.length > 0 ? searchText(query, searched, context.folders) : null),
    [query, searched, context.folders],
  );
  const byId = useMemo(() => new Map((searched ?? []).map((d) => [d.id, d])), [searched]);

  const results = outcome && !('refused' in outcome) ? outcome.results : [];
  const pages = Math.max(1, Math.ceil(results.length / GROUPS_PER_PAGE));
  const shownPage = Math.min(page, pages - 1);
  const first = shownPage * GROUPS_PER_PAGE;
  const shown = results.slice(first, first + GROUPS_PER_PAGE);
  const hitTotal = results.reduce((n, r) => n + r.hits.length, 0);

  let message: string;
  if ('refused' in resolved) message = `This scope cannot be searched: ${resolved.refused}`;
  else if (resolved.documents.length === 0) message = `No documents in ${resolved.label}`;
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
        aria-label="Search text"
        placeholder="Search text…"
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
      {'refused' in resolved ? null : (
        <p className="mbc-project-search-scope">
          Searching: <strong data-search-scope-label>{resolved.label}</strong>
        </p>
      )}
      <p className="mbc-project-search-fields">{TEXT_SEARCH_STATEMENT}</p>
      <p className="mbc-project-search-summary" role={'refused' in resolved ? 'alert' : 'status'} data-search-summary>
        {message}
      </p>
      {results.length > GROUPS_PER_PAGE && (
        <div className="mbc-project-search-pager">
          <button type="button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>Previous</button>
          <span data-search-pager-range>
            Groups {first + 1}-{first + shown.length} of {results.length}
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
    </section>
  );
}
