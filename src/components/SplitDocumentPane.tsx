// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Split view (two documents at once): a second pane beside the main viewer, or below it in Top and
 * Bottom (US-01M7DVR0; the App sets the orientation on the host, src/core/documentSplit.ts), showing
 * any document — sequences in the linear view, trees in the Tree Explorer, alignments as rows, text
 * and result documents, or the document's Info. The App unmounts the pane in Single Pane, so its
 * selection starts empty each time it opens; the document it shows is the App's and is kept.
 */

import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { EMPTY_RESTRICTION_SCAN, scanRestrictionSites, type RestrictionSiteScan } from '../core/bioEngine';
import { LinearSequenceView } from './LinearSequenceView';
import { ImportedTreeViewer } from './ImportedTreeViewer';
import { ExpressionResultsView } from './ExpressionViews';
import { DocumentInfoPanel } from './DocumentInfoPanel';
import { ResultWarnings } from './ResultWarnings';
import { chosenRestrictionScope, restrictionScanEnzymes, restrictionScannedBp, subsetNote, type ChosenScanCollection, type RestrictionScanScope } from './CircularPlasmidMap';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';

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
}

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

export const SplitDocumentPane: React.FC<SplitDocumentPaneProps> = ({ doc, choices, onChooseDoc, mainDocId = null, mainRange = null, onSwap, onClose, onUpdateDocument, onDownload, onDownloadBinary, enzymes = REBASE_ENZYMES, scanCollection = null }) => {
  // The pane's selection belongs to the document it was made on (US-01M7DV3V): it is held with that
  // document's id and read only while that document is shown, so its coordinates are never drawn
  // on another document. Choosing a document clears it; a swap exchanges it with the main view's.
  const [held, setHeld] = useState<{ docId: string; range: SplitRange } | null>(null);
  const range = doc && held?.docId === doc.id ? held.range : null;
  const setRange = (r: SplitRange | null) => setHeld(r && doc ? { docId: doc.id, range: r } : null);
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
    if (doc.sequence.length > 0) {
      return (
        <>
          <ResultWarnings warnings={scan.warnings} label="Restriction scan warnings" />
          <LinearSequenceView key={doc.id} doc={doc} cutSites={scan.sites} restrictionScope={restrictionScope} selectedRange={range} onSelectRange={setRange} onUpdateDocument={onUpdateDocument} onClearSelection={() => setRange(null)} />
        </>
      );
    }
    return <DocumentInfoPanel doc={doc} onUpdateDocument={onUpdateDocument} />;
  })();
  return (
    <section className="mbc-split-pane" aria-label="Split view">
      <div className="mbc-split-pane-head">
        <input type="search" aria-label="Filter documents in split view" placeholder="Filter documents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select aria-label="Document in split view" value={doc?.id ?? ''} onChange={(e) => { setHeld(null); onChooseDoc(e.target.value); }}>
          <option value="">Choose a document…</option>
          {/* the shown document stays its own option when the filter leaves it out, so the picker never names another */}
          {doc && !listed.some((d) => d.id === doc.id) && <option value={doc.id}>{doc.name}</option>}
          {listed.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="mbc-zoom-btn" title="Swap with the main view" aria-label="Swap with the main view" disabled={!doc} onClick={() => {
          onSwap(range);
          setHeld(mainRange && mainDocId ? { docId: mainDocId, range: mainRange } : null);
        }}><ArrowLeftRight size={13} /></button>
        <button type="button" className="mbc-zoom-btn" title="Close split view" aria-label="Close split view" onClick={onClose}><X size={13} /></button>
      </div>
      {filter.trim() && matched === 0 && <p className="mbc-help-where" role="status">No document matches "{filter.trim()}".</p>}
      <ResultWarnings warnings={subsetNote('The picker lists', listed.length, matched, 'documents', 'first')} label="Split view picker" />
      <div className="mbc-split-pane-body">{body}</div>
    </section>
  );
};
