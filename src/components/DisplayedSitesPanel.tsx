// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RestrictionCutSite } from '../types/bio';
import { enzymeLabel } from '../core/bioEngine';
import {
  applySiteVisibility,
  cutSiteDisplayPosition,
  enzymeKey,
  reconcileSiteVisibility,
  setEnzymeVisibility,
  setOccurrenceVisibility,
  siteOccurrenceId,
  type SiteVisibility,
} from '../core/restrictionDisplay';

/** How many enzyme rows the panel draws at once; the bulk actions still act on every match. */
export const DISPLAYED_SITES_RENDER_LIMIT = 100;

/** One scanned site of an enzyme row. */
export interface PanelOccurrence {
  site: RestrictionCutSite;
  id: string;
  /** Whether the user's choices show it (the unique-cutter filter aside). */
  shownByUser: boolean;
  /** The 1-based number the site is listed by: the last base before its top-strand cut. */
  displayPosition: number;
}

/** One enzyme of the panel, with the occurrences that match the current search and filter. */
export interface PanelEnzymeRow {
  /**
   * The enzyme's {@link enzymeKey} (US-01M7GQZ6): its choices, count and row are kept under it, so a
   * custom enzyme named like a built-in is a row of its own. A built-in's is its name.
   */
  key: string;
  name: string;
  recognitionSeq: string;
  /** The scan's complete count of its sites. */
  siteCount: number;
  /** How many of its sites the scan kept (and the panel can list). */
  keptCount: number;
  /** Its kept sites that match the filter, by position. */
  occurrences: PanelOccurrence[];
  /** The user's choices over all its kept sites. */
  state: 'shown' | 'hidden' | 'mixed';
}

/** What the list is narrowed to: a name search, the unique-cutter filter and Shown only. */
export interface PanelFilter {
  query: string;
  uniqueCuttersOnly: boolean;
  shownOnly: boolean;
}

/** Where the scanned molecule's sites are numbered from (as {@link cutSiteDisplayPosition}). */
export interface PanelMolecule {
  revision: string;
  seqLen: number;
  circular: boolean;
}

/**
 * Every enzyme row that matches `filter`, one per {@link enzymeKey}, by name: an enzyme matches when
 * its name holds the search (any case), it is eligible under the unique-cutter filter (cutting once
 * by `siteCounts`, keyed as its sites are),
 * and, with Shown only, at least one of its sites is drawn; Shown only also limits its occurrences
 * to the drawn ones. Every match is returned, however many the panel draws.
 */
export function displayedSitesRows(
  sites: readonly RestrictionCutSite[],
  siteCounts: Readonly<Record<string, number>>,
  visibility: SiteVisibility,
  filter: PanelFilter,
  molecule: PanelMolecule
): PanelEnzymeRow[] {
  const { revision, seqLen, circular } = molecule;
  const byUser = new Set(applySiteVisibility(sites, revision, visibility, { uniqueCuttersOnly: false }).displayed);
  const drawn = new Set(
    applySiteVisibility(sites, revision, visibility, { uniqueCuttersOnly: filter.uniqueCuttersOnly, siteCounts }).displayed
  );
  const query = filter.query.trim().toLowerCase();
  const byEnzyme = new Map<string, RestrictionCutSite[]>();
  for (const s of sites) {
    const key = enzymeKey(s.enzyme);
    const list = byEnzyme.get(key);
    if (list) list.push(s);
    else byEnzyme.set(key, [s]);
  }
  const rows: PanelEnzymeRow[] = [];
  for (const [key, kept] of byEnzyme) {
    const name = kept[0].enzyme.name;
    if (query && !name.toLowerCase().includes(query)) continue;
    const siteCount = siteCounts[key] ?? kept.length;
    if (filter.uniqueCuttersOnly && siteCount !== 1) continue;
    const ordered = [...kept].sort((a, b) => a.position - b.position || a.strand - b.strand);
    const matching = filter.shownOnly ? ordered.filter((s) => drawn.has(s)) : ordered;
    if (matching.length === 0) continue;
    const shownCount = kept.filter((s) => byUser.has(s)).length;
    rows.push({
      key,
      name,
      recognitionSeq: kept[0].enzyme.recognitionSeq,
      siteCount,
      keptCount: kept.length,
      occurrences: matching.map((site) => ({
        site,
        id: siteOccurrenceId(site, revision),
        shownByUser: byUser.has(site),
        displayPosition: cutSiteDisplayPosition(site.cutTop, seqLen, circular),
      })),
      state: shownCount === kept.length ? 'shown' : shownCount === 0 ? 'hidden' : 'mixed',
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/**
 * `visibility` with every occurrence of `rows` (every match of the search and filter, drawn or not)
 * shown or hidden: an enzyme whose kept sites all match is set as a whole, which clears its sites'
 * own choices; otherwise each matching site is set on its own.
 */
export function setRowsVisibility(visibility: SiteVisibility, rows: readonly PanelEnzymeRow[], visible: boolean): SiteVisibility {
  let next = visibility;
  for (const row of rows) {
    if (row.occurrences.length === row.keptCount) next = setEnzymeVisibility(next, row.key, visible);
    else for (const o of row.occurrences) next = setOccurrenceVisibility(next, o.site, visible);
  }
  return next;
}

/** `visibility` with every enzyme of `rows` back to no choice: shown, its sites' own choices cleared. */
export function resetRowsVisibility(visibility: SiteVisibility, rows: readonly PanelEnzymeRow[]): SiteVisibility {
  return rows.reduce((next, row) => setEnzymeVisibility(next, row.key, true), visibility);
}

/**
 * How many of `stored`'s per-site choices `reconciled` (the same choices carried onto the current
 * scan) no longer holds: the choices an edit or rescan cleared.
 */
export function clearedChoiceCount(stored: SiteVisibility, reconciled: SiteVisibility): number {
  return Object.keys(stored.occurrences).filter((id) => !(id in reconciled.occurrences)).length;
}

/** The status line's words for `n` per-site choices an edit or rescan cleared. */
export function clearedChoicesNotice(n: number): string {
  return `${n.toLocaleString()} per-site display ${n === 1 ? 'choice was' : 'choices were'} cleared: the sequence changed, so ${
    n === 1 ? 'that site is' : 'those sites are'
  } a new scan's sites. Enzyme choices are kept.`;
}

const strandWord = (s: RestrictionCutSite) => (s.strand === -1 ? 'reverse' : 'forward');

export interface DisplayedSitesPanelProps {
  /** The scan's kept sites. */
  sites: readonly RestrictionCutSite[];
  /** The scan's complete site counts by enzyme {@link enzymeKey} (`restrictionSiteCountsByName`). */
  siteCounts: Readonly<Record<string, number>>;
  /** The document's choices; the panel reconciles them to `molecule.revision` before reading or writing. */
  visibility: SiteVisibility;
  molecule: PanelMolecule;
  uniqueCuttersOnly: boolean;
  /** Called with the new choices; it is the only thing a checkbox or a bulk action calls. */
  onVisibilityChange: (next: SiteVisibility) => void;
  /** Go to site: selects the site in the views. Never called by a checkbox. */
  onGoToSite: (site: RestrictionCutSite) => void;
  initialQuery?: string;
  initialShownOnly?: boolean;
  /** The rows open at first, by {@link enzymeKey}. */
  initialExpanded?: readonly string[];
  /**
   * View a row's enzyme definition, called with one of its sites (US-01M7JPSK); absent, no row
   * offers it. It changes no display choice.
   */
  onViewEnzyme?: (site: RestrictionCutSite) => void;
  /** Add a row's enzyme to a collection, called with one of its sites (US-01M7JPSK); absent, no row offers it. */
  onAddEnzymeToCollection?: (site: RestrictionCutSite) => void;
}

/**
 * The Displayed restriction sites panel (US-01M7CC7J): which scanned sites the maps are to draw,
 * per enzyme and per occurrence. Display state only: it never changes the scan or a digest, and
 * a checkbox never moves the view or the selection (Go to site is its own button).
 *
 * A mixed enzyme (some of its sites shown, some hidden) draws its checkbox clear and indeterminate,
 * and a click on it shows every site. A checkbox whose row leaves the list (Shown only) hands focus
 * to the next checkbox still listed, else the one before it, else the search (BG-01M7DH9X).
 */
export function DisplayedSitesPanel(props: DisplayedSitesPanelProps) {
  const { sites, siteCounts, molecule, uniqueCuttersOnly, onVisibilityChange, onGoToSite, onViewEnzyme, onAddEnzymeToCollection } = props;
  // Every choice is read and written at the scan's own revision: a state of another revision is
  // reconciled first, so a choice is never stored under an id no site carries.
  const visibility =
    props.visibility.revision === molecule.revision
      ? props.visibility
      : reconcileSiteVisibility(props.visibility, sites, molecule.revision);
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [shownOnly, setShownOnly] = useState(props.initialShownOnly ?? false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(props.initialExpanded ?? []));
  // The listed checkboxes by key (`e:` an enzyme's, `o:` an occurrence's), and the search, so focus
  // can move on when the checkbox it is on leaves the list.
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pendingFocus = useRef<{ key: string; order: readonly string[] } | null>(null);
  const boxRef = (key: string, indeterminate = false) => (el: HTMLInputElement | null) => {
    if (el) {
      el.indeterminate = indeterminate;
      boxes.current.set(key, el);
    } else boxes.current.delete(key);
  };

  const rows = displayedSitesRows(sites, siteCounts, visibility, { query, uniqueCuttersOnly, shownOnly }, molecule);
  const { counts } = applySiteVisibility(sites, molecule.revision, visibility, { uniqueCuttersOnly, siteCounts });
  // The user's hides the unique-cutter filter keeps off the maps anyway: held, and counted apart.
  const held = uniqueCuttersOnly
    ? applySiteVisibility(sites, molecule.revision, visibility, { uniqueCuttersOnly: false }).counts.hiddenByUser - counts.hiddenByUser
    : 0;
  const drawnRows = rows.slice(0, DISPLAYED_SITES_RENDER_LIMIT);
  // Every listed checkbox, in the order Tab reaches it.
  const order: string[] = [];
  for (const row of drawnRows) {
    order.push(`e:${row.key}`);
    if (row.keptCount > 1 && expanded.has(row.key)) for (const o of row.occurrences) order.push(`o:${o.id}`);
  }
  /** A checkbox's change: the new choices, remembering the box so focus can follow if its row goes. */
  const choose = (key: string, next: SiteVisibility) => {
    pendingFocus.current = { key, order };
    onVisibilityChange(next);
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (boxes.current.has(pending.key)) {
      // Still listed: wait for the render that carries the change (or none, if nothing changed).
      if (pending.order !== order) pendingFocus.current = null;
      return;
    }
    pendingFocus.current = null;
    // Only focus that was lost with the row moves: focus the user put elsewhere stays there.
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active && active !== document.body) return;
    const at = pending.order.indexOf(pending.key);
    const after = pending.order.slice(at + 1).find((k) => boxes.current.has(k));
    const before = [...pending.order.slice(0, Math.max(at, 0))].reverse().find((k) => boxes.current.has(k));
    const target = (after && boxes.current.get(after)) || (before && boxes.current.get(before)) || searchRef.current;
    target?.focus();
  });
  const matchWords = `${rows.length.toLocaleString()} matching ${rows.length === 1 ? 'enzyme' : 'enzymes'}`;
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="mbc-dsites" aria-label="Displayed restriction sites">
      <h4 className="mbc-dsites-title">Displayed restriction sites</h4>
      <p className="mbc-dsites-counts" aria-live="polite">
        {counts.detected.toLocaleString()} detected · {(counts.detected - counts.eligible).toLocaleString()} filtered out ·{' '}
        {counts.hiddenByUser.toLocaleString()} hidden by you
        {held > 0 ? ` (${held.toLocaleString()} more held under the unique-cutter filter)` : ''} · {counts.shown.toLocaleString()} shown
      </p>
      <div className="mbc-dsites-tools">
        <input
          type="search"
          className="mbc-dsites-search"
          ref={searchRef}
          aria-label="Search enzymes by name"
          placeholder="Search enzymes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="mbc-dsites-check">
          <input type="checkbox" checked={shownOnly} onChange={(e) => setShownOnly(e.target.checked)} />
          <span>Shown only</span>
        </label>
      </div>
      <div className="mbc-dsites-bulk" role="group" aria-label="Display every matching site">
        <button
          type="button"
          aria-label={`Show filtered: show every site of the ${matchWords}`}
          disabled={rows.length === 0}
          onClick={() => onVisibilityChange(setRowsVisibility(visibility, rows, true))}
        >
          Show filtered
        </button>
        <button
          type="button"
          aria-label={`Hide filtered: hide every site of the ${matchWords}`}
          disabled={rows.length === 0}
          onClick={() => onVisibilityChange(setRowsVisibility(visibility, rows, false))}
        >
          Hide filtered
        </button>
        <button
          type="button"
          aria-label={`Reset display: clear every choice for the ${matchWords}`}
          disabled={rows.length === 0}
          onClick={() => onVisibilityChange(resetRowsVisibility(visibility, rows))}
        >
          Reset display
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mbc-dsites-note">{sites.length === 0 ? 'No restriction sites were scanned.' : 'No enzyme matches the search and filter.'}</p>
      ) : (
        <ul className="mbc-dsites-list">
          {drawnRows.map((row) => {
            const multi = row.keptCount > 1;
            const open = multi && expanded.has(row.key);
            const listId = `mbc-dsites-occ-${row.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
            const single = row.occurrences[0];
            // The row's name as every surface shows it: a custom definition's marked "(custom)" (US-01M7DV52).
            const label = single ? enzymeLabel(single.site.enzyme) : row.name;
            return (
              <li key={row.key} className="mbc-dsites-row">
                <div className="mbc-dsites-enzyme">
                  {multi ? (
                    <button
                      type="button"
                      className="mbc-dsites-expand"
                      aria-expanded={open}
                      aria-controls={listId}
                      aria-label={`${open ? 'Collapse' : 'Expand'} the ${row.keptCount} sites of ${label}`}
                      onClick={() => toggleExpanded(row.key)}
                    >
                      {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    </button>
                  ) : (
                    <span className="mbc-dsites-expand-spacer" aria-hidden />
                  )}
                  <input
                    type="checkbox"
                    checked={row.state === 'shown'}
                    aria-checked={row.state === 'mixed' ? 'mixed' : undefined}
                    ref={boxRef(`e:${row.key}`, row.state === 'mixed')}
                    aria-label={`Show ${label} sites on the maps`}
                    onChange={(e) =>
                      choose(`e:${row.key}`, setEnzymeVisibility(visibility, row.key, row.state === 'mixed' || e.target.checked))
                    }
                  />
                  <span className="mbc-dsites-name">{label}</span>
                  <code className="mbc-dsites-motif">{row.recognitionSeq}</code>
                  <span className="mbc-dsites-count">
                    {row.siteCount.toLocaleString()} {row.siteCount === 1 ? 'site' : 'sites'}
                    {row.keptCount < row.siteCount ? ` (first ${row.keptCount.toLocaleString()} listed)` : ''}
                  </span>
                  {!multi && single && (
                    <button
                      type="button"
                      className="mbc-dsites-goto"
                      aria-label={`Go to ${label} site cutting after ${single.displayPosition}`}
                      onClick={() => onGoToSite(single.site)}
                    >
                      Go to {single.displayPosition}
                    </button>
                  )}
                  {onViewEnzyme && single && (
                    <button
                      type="button"
                      className="mbc-dsites-goto"
                      aria-label={`View the ${label} enzyme definition`}
                      onClick={() => onViewEnzyme(single.site)}
                    >
                      Definition
                    </button>
                  )}
                  {onAddEnzymeToCollection && single && (
                    <button
                      type="button"
                      className="mbc-dsites-goto"
                      aria-label={`Add ${label} to a collection`}
                      onClick={() => onAddEnzymeToCollection(single.site)}
                    >
                      Add to collection
                    </button>
                  )}
                </div>
                {open && (
                  <ul id={listId} className="mbc-dsites-occurrences">
                    {row.occurrences.map((o) => (
                      <li key={o.id} className="mbc-dsites-occurrence">
                        <input
                          type="checkbox"
                          checked={o.shownByUser}
                          ref={boxRef(`o:${o.id}`)}
                          aria-label={`Show ${label} at ${o.displayPosition}, ${strandWord(o.site)} strand`}
                          onChange={(e) => choose(`o:${o.id}`, setOccurrenceVisibility(visibility, o.site, e.target.checked))}
                        />
                        <span className="mbc-dsites-pos" title={`cuts after base ${o.displayPosition}`}>
                          {o.displayPosition.toLocaleString()}
                        </span>
                        <span className="mbc-dsites-strand">{strandWord(o.site)}</span>
                        <button
                          type="button"
                          className="mbc-dsites-goto"
                          aria-label={`Go to ${label} site cutting after ${o.displayPosition}, ${strandWord(o.site)} strand`}
                          onClick={() => onGoToSite(o.site)}
                        >
                          Go to
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > drawnRows.length && (
        <p className="mbc-dsites-note">
          Listing the first {drawnRows.length} of {rows.length.toLocaleString()} matching enzymes: search to narrow the list. Show,
          Hide and Reset act on all {rows.length.toLocaleString()}.
        </p>
      )}
    </section>
  );
}
