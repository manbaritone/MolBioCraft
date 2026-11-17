// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Split view (two documents at once): a second pane beside the main viewer, or below it in Top and
 * Bottom (US-01M7DVR0; the App sets the orientation on the host, src/core/documentSplit.ts), showing
 * any document — sequences in the linear view, trees in the Tree Explorer, alignments as rows, text
 * and result documents, or the document's Info. The App unmounts the pane in Single Pane, so its
 * selection starts empty each time it opens; the document it shows is the App's and is kept.
 *
 * The pane can show the main view's document too (US-01M7DVQG). A document with bases is shown in the
 * view its "View in split pane" selector names: Circular Map, Linear Map or Info. The view, the zoom
 * and the rotation of its circular map are the App's, so they outlive Single Pane, and they are the
 * pane's own: nothing here moves the main view's. While the pane shows the main view's document, the
 * two share one selection, the main view's.
 *
 * While the split is shown one of the two panes is focused (US-01M7DV10), the App's state: a pointer
 * down or keyboard focus inside the pane hands it focus (`onFocusPane`), and the focused pane is marked
 * `is-focused-pane` and `aria-current="true"`. View › Zoom and View › Rotate Circular Map… then act on
 * the pane's own zoom and rotation, and open its rotate control (`rotateOpen`).
 *
 * `DocumentSplitDivider` (US-01M7DVB1) is the separator the App places between the main view and the
 * pane, with the button a folded pane leaves; its arithmetic is src/core/documentSplit.ts's.
 */

import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, RotateCw, X } from 'lucide-react';
import { EMPTY_RESTRICTION_SCAN, restrictionSiteCountsByName, scanRestrictionSites, type RestrictionSiteScan } from '../core/bioEngine';
import { LinearSequenceView } from './LinearSequenceView';
import { ImportedTreeViewer } from './ImportedTreeViewer';
import { ExpressionResultsView } from './ExpressionViews';
import { DocumentInfoPanel } from './DocumentInfoPanel';
import { ResultWarnings } from './ResultWarnings';
import {
  chosenRestrictionScope,
  CircularMapRotationControl,
  CircularPlasmidMap,
  restrictionScanEnzymes,
  restrictionScannedBp,
  SEQUENCE_ZOOM_DEFAULT,
  subsetNote,
  type ChosenScanCollection,
  type RestrictionScanScope,
} from './CircularPlasmidMap';
import { buildCommandDocumentContext, circularMapUnavailableReason } from '../core/commandAvailability';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import {
  documentSplitExtent,
  documentSplitKey,
  documentSplitStyle,
  documentSplitValueNow,
  dragDocumentSplit,
  renderedDocumentSplitRatio,
  DEFAULT_SPLIT_PANE_VIEW,
  SPLIT_PANE_VIEW_CHOICES,
  type DocumentSplitAxisOrientation,
  type DocumentSplitSize,
  type SplitPaneView,
} from '../core/documentSplit';
import { PANE_SPLIT_KEY_STEP_LARGE_PX, PANE_SPLIT_KEY_STEP_PX } from '../core/paneSplit';

/** A selected range of bases, 1-based and inclusive, as the linear view holds it. */
export type SplitRange = { start: number; end: number; label?: string };

export interface SplitDocumentPaneProps {
  doc: SequenceDocument | null;
  /**
   * Every document the picker can offer (open tabs first), uncapped: the pane filters them and lists
   * the first SPLIT_PICKER_CAP, saying how many it leaves out (US-01M7DV3V).
   */
  choices: SequenceDocument[];
  onChooseDoc: (id: string) => void;
  /** The document in the main view and its selection, which a swap brings into the pane (US-01M7DV3V). */
  mainDocId?: string | null;
  mainRange?: SplitRange | null;
  /**
   * Makes the split document the main one (and the main one the split), handed the pane's selection
   * (null for none) for the main view to take; the pane takes `mainRange`, or none when it is null.
   */
  onSwap: (paneRange: SplitRange | null) => void;
  onClose: () => void;
  onUpdateDocument: (doc: SequenceDocument) => void;
  onDownload?: (content: string, name: string, mime: string) => void;
  onDownloadBinary?: (bytes: Uint8Array, name: string, mime: string) => void;
  /** The active enzyme list (US-01M7DV52): the catalogue and the stored custom definitions; the catalogue alone unless given. */
  enzymes?: RestrictionEnzyme[];
  /**
   * The collection chosen for site scans (US-01M7JX1J), when one is: the pane scans its members
   * over the other document's own scanned length, and names it as the main view does.
   */
  scanCollection?: ChosenScanCollection | null;
  /**
   * Writes the main view's selection (US-01M7DVQG). While the pane shows the main view's document
   * (`doc.id === mainDocId`), the pane draws `mainRange` and every selection made in it is written
   * here, so the two share one selection; otherwise the pane keeps its own.
   */
  onSelectMainRange?: (range: SplitRange | null) => void;
  /** Shows the main view's document in the pane (the head's button); the button is left out without it. */
  onShowMainDoc?: () => void;
  /** The view a document with bases is shown in; Linear Map unless given. */
  view?: SplitPaneView;
  onViewChange?: (view: SplitPaneView) => void;
  /** The pane's own zoom of its circular map, in percent; 100% unless given. */
  zoomLevel?: number;
  onZoomChange?: (update: (current: number) => number) => void;
  /** The pane's own rotation of its circular map, in degrees clockwise; 0 unless given. */
  rotationDeg?: number;
  onRotate?: (rotationDeg: number) => void;
  /**
   * Whether the pane's rotate control is open, for the App to open it from View › Rotate Circular Map…
   * (US-01M7DV10); the pane holds it itself unless given.
   */
  rotateOpen?: boolean;
  onRotateOpenChange?: (open: boolean) => void;
  /** Whether the pane is the focused one (US-01M7DV10): it is then marked `is-focused-pane` and `aria-current="true"`. */
  focused?: boolean;
  /** Called on a pointer down or keyboard focus inside the pane (US-01M7DV10). */
  onFocusPane?: () => void;
  /** Counted up by Actual Size, Fit and Reset View on the focused pane (US-01M7DVEN): each new value recentres its circle. */
  viewRestoreKey?: number;
  /** Counted up by Fit and Reset View on the focused pane (US-01M7DVEN): each new value fits the whole molecule in its linear overview. */
  overviewFitKey?: number;
  /**
   * The main view's View › Tracks settings (US-01M7DV8W): Features and Restriction Sites hidden are
   * hidden in both of the pane's maps, and its Linear Map draws Translation, GC Graph and Hydropathy
   * Graph as the main view does. Left out, the pane draws as before (each shown, the graphs at the
   * linear view's defaults). The pane draws no ORFs or primers whatever they say.
   */
  tracks?: { showFeatures: boolean; showRestrictionSites: boolean; showTranslation: boolean; showGcGraph: boolean; showHydropathyGraph: boolean };
}

/**
 * Whether the pane draws a circular map for `doc` in `view` (US-01M7DV10, US-01M7DVQG): a document with
 * bases (not a tree, an alignment or a text document) in Circular Map that can draw a circle, by the
 * rule View › Rotate Circular Map… reads. The App reads it for the focused pane's map commands.
 */
export function splitPaneShowsCircularMap(doc: SequenceDocument | null, view: SplitPaneView): boolean {
  return view === 'circular' && splitPaneHasBases(doc) && splitPaneCircleRefused(doc!) === null;
}
/**
 * Whether the pane draws a sequence map for `doc` in `view` (US-01M7DVEN): a document with bases in
 * Circular Map or Linear Map, not Info, a tree, an alignment, a text document or no document. The App
 * reads it for View › Fit and Reset View while the pane is focused.
 */
export function splitPaneShowsSequenceMap(doc: SequenceDocument | null, view: SplitPaneView): boolean {
  return view !== 'info' && splitPaneHasBases(doc);
}
function splitPaneHasBases(doc: SequenceDocument | null): boolean {
  return Boolean(
    doc && typeof doc.docMetadata?.Newick !== 'string' && (doc.alignmentMeta?.sequences?.length ?? 0) <= 1 &&
      doc.docMetadata?.['Document Type'] !== 'Text Document' && doc.sequence.length > 0
  );
}
function splitPaneCircleRefused(doc: SequenceDocument): string | null {
  return circularMapUnavailableReason(buildCommandDocumentContext(doc) ?? doc);
}

/** The pane head's button that shows the main view's document in the pane (US-01M7DVQG). */
export const SHOW_MAIN_DOC_LABEL = "Show the main view's document in the split pane";

/**
 * The most candidates the picker lists, the first in `choices` order that pass the filter; the shown
 * document is kept as an option besides when the filter leaves it out.
 */
const SPLIT_PICKER_CAP = 400;

/** The most alignment rows the split pane draws, the first in the alignment's order. */
const SPLIT_ALIGNMENT_ROWS = 200;

const AlignmentRows: React.FC<{ doc: SequenceDocument }> = ({ doc }) => {
  const rows = doc.alignmentMeta?.sequences ?? [];
  const [offset, setOffset] = useState(0);
  const width = rows[0]?.sequence.length ?? 0;
  const span = 120;
  const nameW = Math.min(28, Math.max(6, ...rows.map((r) => r.name.length)));
  const shown = rows.slice(0, SPLIT_ALIGNMENT_ROWS);
  return (
    <div className="mbc-split-aln">
      <div className="prefs-row" style={{ gap: 6, marginBottom: 6 }}>
        <span>{rows.length} sequences × {width.toLocaleString()} columns · columns {offset + 1}–{Math.min(width, offset + span)}</span>
        <button type="button" className="mbc-btn" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - span))}>◀</button>
        <button type="button" className="mbc-btn" disabled={offset + span >= width} onClick={() => setOffset((o) => Math.min(Math.max(0, width - span), o + span))}>▶</button>
      </div>
      {/* the rows it leaves out, counted against every row of the alignment (BG-01M6S1AA) */}
      <ResultWarnings warnings={subsetNote('The pane shows', shown.length, rows.length, 'sequences', 'first')} label="Split view coverage" />
      <pre className="mbc-split-aln-pre">
        {shown.map((r) => `${r.name.slice(0, nameW).padEnd(nameW)}  ${r.sequence.slice(offset, offset + span)}`).join('\n')}
      </pre>
    </div>
  );
};

export const SplitDocumentPane: React.FC<SplitDocumentPaneProps> = ({
  doc, choices, onChooseDoc, mainDocId = null, mainRange = null, onSwap, onClose, onUpdateDocument, onDownload, onDownloadBinary,
  enzymes = REBASE_ENZYMES, scanCollection = null, onSelectMainRange, onShowMainDoc,
  view = DEFAULT_SPLIT_PANE_VIEW, onViewChange, zoomLevel = SEQUENCE_ZOOM_DEFAULT, onZoomChange, rotationDeg = 0, onRotate,
  rotateOpen: rotateOpenProp, onRotateOpenChange, focused = false, onFocusPane, viewRestoreKey = 0, overviewFitKey = 0, tracks,
}) => {
  // The pane's selection belongs to the document it was made on (US-01M7DV3V): it is held with that
  // document's id and read only while that document is shown, so its coordinates are never drawn
  // on another document. Choosing a document clears it; a swap exchanges it with the main view's.
  const [held, setHeld] = useState<{ docId: string; range: SplitRange } | null>(null);
  // The one sharing condition (US-01M7DVQG): the pane shows the main view's document. Then its
  // selection is the main view's; otherwise it is the one held above.
  const shared = doc !== null && mainDocId !== null && doc.id === mainDocId;
  const range = shared ? mainRange : doc && held?.docId === doc.id ? held.range : null;
  const setRange = (r: SplitRange | null) => {
    if (shared) onSelectMainRange?.(r);
    else setHeld(r && doc ? { docId: doc.id, range: r } : null);
  };
  const [ownRotateOpen, setOwnRotateOpen] = useState(false);
  const rotateOpen = rotateOpenProp ?? ownRotateOpen;
  const setRotateOpen = onRotateOpenChange ?? setOwnRotateOpen;
  const [filter, setFilter] = useState('');
  // The filter narrows every candidate, ignoring case, before the cap, so a document past the 400th
  // can be reached by its name; the note counts the candidates the filter passed (subsetNote).
  const { listed, matched } = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const passing = needle ? choices.filter((d) => d.name.toLowerCase().includes(needle)) : choices;
    return { listed: passing.slice(0, SPLIT_PICKER_CAP), matched: passing.length };
  }, [choices, filter]);
  // The pane scans as the main view does (App.tsx `restrictionScope`), by the one shared rule:
  // `restrictionScannedBp` (over 150,000 bp only the first 60,000 bp, as a linear sequence) and
  // `restrictionScanScope` (more than 100,000 bp scanned with the engine's first CORE_CATALOG_LEN
  // catalog enzymes only). Its linear view is handed that scope, so it says where its cut sites
  // stop, as the main linear view does (BG-01M6RTHN).
  // The scan keeps each enzyme's first sites by position and warns when it left some out (BG-01M6S1K2).
  // A chosen collection is scanned and named by the same helper as the main view's (US-01M7JX1J,
  // D0169); one with nothing that can be scanned sends the engine nothing, as the main view's does.
  const { scan, restrictionScope } = useMemo((): { scan: RestrictionSiteScan; restrictionScope: RestrictionScanScope | null } => {
    if (!doc || doc.moleculeType !== 'DNA' || !doc.sequence || doc.alignmentMeta?.sequences?.length) return { scan: EMPTY_RESTRICTION_SCAN, restrictionScope: null };
    const length = doc.sequence.length;
    const scannedBp = restrictionScannedBp(length);
    const scope = chosenRestrictionScope(length, scannedBp, enzymes, scanCollection);
    // The core cut follows the bases the scan reads, not the document's length (US-01M7DV52).
    const list = restrictionScanEnzymes(scanCollection ? scanCollection.members : enzymes, scannedBp);
    if (list.length === 0) return { scan: EMPTY_RESTRICTION_SCAN, restrictionScope: scope };
    return {
      scan: scope?.firstBp ? scanRestrictionSites(doc.sequence.slice(0, scope.firstBp), 'linear', list) : scanRestrictionSites(doc.sequence, doc.topology, list),
      restrictionScope: scope,
    };
  }, [doc, enzymes, scanCollection]);
  // A document with bases (not a tree, an alignment or a text document) is shown in a view of its
  // choice; a document that cannot draw a circle is shown in Linear Map whatever the view, by the rule
  // View › Rotate Circular Map… reads (circularMapUnavailableReason), whose sentence says why.
  const hasBases = splitPaneHasBases(doc);
  const circleRefused = doc && hasBases ? splitPaneCircleRefused(doc) : null;
  const shownView: SplitPaneView = view === 'circular' && circleRefused ? 'linear' : view;
  const body = (() => {
    if (!doc) return <p className="mbc-help-where">Choose a document to show next to the main view.</p>;
    if (typeof doc.docMetadata?.Newick === 'string') return <ImportedTreeViewer key={doc.id} doc={doc} onUpdateDocument={onUpdateDocument} onDownload={onDownload} onDownloadBinary={onDownloadBinary} />;
    if ((doc.alignmentMeta?.sequences?.length ?? 0) > 1) return <AlignmentRows key={doc.id} doc={doc} />;
    if (doc.docMetadata?.['Document Type'] === 'Text Document') {
      return (
        <>
          <ExpressionResultsView doc={doc} onDownload={onDownload} />
          <pre className="mbc-flatfile-pre">{String(doc.docMetadata?.Notes ?? '')}</pre>
        </>
      );
    }
    if (doc.sequence.length > 0 && shownView === 'info') return <DocumentInfoPanel doc={doc} onUpdateDocument={onUpdateDocument} />;
    if (doc.sequence.length > 0 && shownView === 'circular') {
      return (
        <>
          <ResultWarnings warnings={scan.warnings} label="Restriction scan warnings" />
          {rotateOpen && onRotate && (
            <CircularMapRotationControl rotationDeg={rotationDeg} onRotate={onRotate} onClose={() => setRotateOpen(false)} />
          )}
          <CircularPlasmidMap
            doc={doc}
            cutSites={scan.sites}
            siteCounts={restrictionSiteCountsByName(scan)}
            orfs={[]}
            selectedRange={range}
            onSelectRange={setRange}
            showOrfs={false}
            showPrimers={false}
            showFeatures={tracks?.showFeatures ?? true}
            showRestrictionSites={tracks?.showRestrictionSites ?? true}
            showUniqueCuttersOnly={false}
            restrictionScope={restrictionScope}
            zoomLevel={zoomLevel}
            onZoomChange={onZoomChange}
            rotationDeg={rotationDeg}
            viewRestoreKey={viewRestoreKey}
          />
        </>
      );
    }
    if (doc.sequence.length > 0) {
      return (
        <>
          <ResultWarnings warnings={scan.warnings} label="Restriction scan warnings" />
          <LinearSequenceView key={doc.id} doc={doc} cutSites={scan.sites} restrictionScope={restrictionScope} selectedRange={range} onSelectRange={setRange} onUpdateDocument={onUpdateDocument} onClearSelection={() => setRange(null)} overviewFitKey={overviewFitKey} {...(tracks ?? {})} />
        </>
      );
    }
    return <DocumentInfoPanel doc={doc} onUpdateDocument={onUpdateDocument} />;
  })();
  return (
    <section
      className={`mbc-split-pane${focused ? ' is-focused-pane' : ''}`}
      aria-label="Split view"
      aria-current={focused ? 'true' : undefined}
      // A pointer down or focus inside the pane, in its DOM (not a portal it renders elsewhere), focuses it.
      onPointerDownCapture={(e) => { if (e.currentTarget.contains(e.target as Node)) onFocusPane?.(); }}
      onFocusCapture={(e) => { if (e.currentTarget.contains(e.target as Node)) onFocusPane?.(); }}
    >
      <div className="mbc-split-pane-head">
        <input type="search" aria-label="Filter documents in split view" placeholder="Filter documents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select aria-label="Document in split view" value={doc?.id ?? ''} onChange={(e) => { setHeld(null); onChooseDoc(e.target.value); }}>
          <option value="">Choose a document…</option>
          {/* the shown document stays its own option when the filter leaves it out, so the picker never names another */}
          {doc && !listed.some((d) => d.id === doc.id) && <option value={doc.id}>{doc.id === mainDocId ? `${doc.name} (main view)` : doc.name}</option>}
          {listed.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {onShowMainDoc && (
          <button type="button" className="mbc-zoom-btn" title={SHOW_MAIN_DOC_LABEL} aria-label={SHOW_MAIN_DOC_LABEL} disabled={!mainDocId || shared} onClick={() => { setHeld(null); onShowMainDoc(); }}>
            <Columns2 size={13} />
          </button>
        )}
        <button type="button" className="mbc-zoom-btn" title="Swap with the main view" aria-label="Swap with the main view" disabled={!doc} onClick={() => {
          onSwap(range);
          setHeld(mainRange && mainDocId ? { docId: mainDocId, range: mainRange } : null);
        }}><ArrowLeftRight size={13} /></button>
        <button type="button" className="mbc-zoom-btn" title="Close split view" aria-label="Close split view" onClick={onClose}><X size={13} /></button>
      </div>
      {hasBases && (
        <div className="mbc-split-pane-view">
          <select aria-label="View in split pane" value={shownView} onChange={(e) => onViewChange?.(e.target.value as SplitPaneView)}>
            {SPLIT_PANE_VIEW_CHOICES.map((c) => (
              <option key={c.view} value={c.view} disabled={c.view === 'circular' && circleRefused !== null}>{c.label}</option>
            ))}
          </select>
          {circleRefused && <span className="mbc-split-pane-view-note">{circleRefused}</span>}
          {shownView === 'circular' && onRotate && (
            <button type="button" className="mbc-zoom-btn" title="Rotate the circular map in the split pane" aria-label="Rotate the circular map in the split pane" aria-pressed={rotateOpen} onClick={() => setRotateOpen(!rotateOpen)}>
              <RotateCw size={13} />
            </button>
          )}
        </div>
      )}
      {filter.trim() && matched === 0 && <p className="mbc-help-where" role="status">No document matches "{filter.trim()}".</p>}
      <ResultWarnings warnings={subsetNote('The picker lists', listed.length, matched, 'documents', 'first')} label="Split view picker" />
      <div className="mbc-split-pane-body">{body}</div>
    </section>
  );
};

export interface DocumentSplitDividerProps {
  orientation: DocumentSplitAxisOrientation;
  /** The divider as the user chose it: the ratio a restore returns to, and the folded pane. */
  size: DocumentSplitSize;
  /** The ratio drawn for `size.ratio` at the host's measured size (renderedDocumentSplitRatio). */
  drawnRatio: number;
  onChange: (next: DocumentSplitSize) => void;
}

/**
 * The divider between the main view and the split pane (US-01M7DVB1), a child of the split host, and
 * the restore button a folded pane leaves. A drag writes the host's custom properties as the pointer
 * moves and hands the state over on release (a cancel puts the old one back). It stays while a pane
 * is folded, so focus stays on it and Enter restores; the restore button hands focus to it as it goes.
 */
export function DocumentSplitDivider({ orientation, size, drawnRatio, onChange }: DocumentSplitDividerProps) {
  const dragRef = useRef<{
    pointerId: number;
    box: { left: number; top: number; width: number; height: number };
    start: DocumentSplitSize;
    pending: DocumentSplitSize;
    handle: HTMLElement;
    host: HTMLElement;
  } | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const side = orientation === 'side-by-side';
  const showOnHost = (host: HTMLElement, ratio: number) => {
    for (const [k, v] of Object.entries(documentSplitStyle(ratio))) host.style.setProperty(k, v);
  };
  const finish = (commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const next = commit ? drag.pending : drag.start;
    try {
      if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    } catch {
      // The pointer has already gone.
    }
    // The host shows what the App will draw, which a drag that folded a pane leaves unchanged.
    showOnHost(drag.host, renderedDocumentSplitRatio(next.ratio, documentSplitExtent(orientation, drag.box), orientation));
    if (next.ratio !== size.ratio || next.collapsed !== size.collapsed) onChange(next);
  };
  const now = documentSplitValueNow({ ratio: drawnRatio, collapsed: size.collapsed });
  const keys = side ? 'Left/Right Arrow' : 'Up/Down Arrow';
  const restoreLabel = size.collapsed === 'main' ? 'Restore the main view' : 'Restore the split pane';
  const RestoreIcon = side
    ? size.collapsed === 'main' ? ChevronRight : ChevronLeft
    : size.collapsed === 'main' ? ChevronDown : ChevronUp;
  return (
    <>
      <div
        ref={dividerRef}
        className="mbc-split-divider"
        role="separator"
        tabIndex={0}
        aria-orientation={side ? 'vertical' : 'horizontal'}
        aria-label="Resize the main view and the split pane"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={now}
        aria-valuetext={
          size.collapsed === 'main'
            ? 'Main view collapsed'
            : size.collapsed === 'second'
              ? 'Split pane collapsed'
              : `Main view ${now}%, split pane ${100 - now}%`
        }
        title={`Drag, or press ${keys} (${PANE_SPLIT_KEY_STEP_PX}px; Shift ${PANE_SPLIT_KEY_STEP_LARGE_PX}px), to resize the main view and the split pane • Home or End collapses one, Enter restores`}
        onKeyDown={(e) => {
          const host = e.currentTarget.parentElement;
          const extent = host ? documentSplitExtent(orientation, host.getBoundingClientRect()) : 0;
          const next = documentSplitKey(size, e.key, e.shiftKey, extent, orientation);
          if (!next) return;
          e.preventDefault();
          if (next.ratio !== size.ratio || next.collapsed !== size.collapsed) onChange(next);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || dragRef.current) return;
          const handle = e.currentTarget;
          const host = handle.parentElement;
          if (!host) return;
          // No text selection starts, and the captured pointer never reaches either view.
          e.preventDefault();
          const r = host.getBoundingClientRect();
          try {
            handle.setPointerCapture(e.pointerId);
          } catch {
            // The pointer has already gone.
          }
          dragRef.current = {
            pointerId: e.pointerId,
            box: { left: r.left, top: r.top, width: r.width, height: r.height },
            start: size,
            pending: size,
            handle,
            host,
          };
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || e.pointerId !== drag.pointerId) return;
          drag.pending = dragDocumentSplit(drag.start, { x: e.clientX, y: e.clientY }, drag.box, orientation);
          showOnHost(drag.host, renderedDocumentSplitRatio(drag.pending.ratio, documentSplitExtent(orientation, drag.box), orientation));
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) finish(true);
        }}
        onPointerCancel={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) finish(false);
        }}
        onLostPointerCapture={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) finish(true);
        }}
      />
      {size.collapsed && (
        <button
          type="button"
          className={`mbc-split-restore restore-${size.collapsed}`}
          aria-label={restoreLabel}
          title={`${restoreLabel} at the size it had`}
          onClick={() => {
            // The button goes with the fold, so focus moves to the divider rather than the page.
            dividerRef.current?.focus();
            onChange({ ratio: size.ratio, collapsed: null });
          }}
        >
          <RestoreIcon size={14} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
