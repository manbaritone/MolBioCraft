// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Split view (two documents side by side): a second pane next to the main viewer
 * showing any document — sequences in the linear view, trees in the Tree Explorer, alignments as
 * rows, text and result documents, or the document's Info.
 */

import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { EMPTY_RESTRICTION_SCAN, scanRestrictionSites, type RestrictionSiteScan } from '../core/bioEngine';
import { LinearSequenceView } from './LinearSequenceView';
import { ImportedTreeViewer } from './ImportedTreeViewer';
import { ExpressionResultsView } from './ExpressionViews';
import { DocumentInfoPanel } from './DocumentInfoPanel';
import { ResultWarnings } from './ResultWarnings';
import { restrictionScanScope, restrictionScannedBp, subsetNote, type RestrictionScanScope } from './CircularPlasmidMap';
import type { SequenceDocument } from '../types/bio';

export interface SplitDocumentPaneProps {
  doc: SequenceDocument | null;
  /** Documents offered in the picker (open tabs first). */
  choices: SequenceDocument[];
  onChooseDoc: (id: string) => void;
  /** Makes the split document the main one (and the main one the split). */
  onSwap: () => void;
  onClose: () => void;
  onUpdateDocument: (doc: SequenceDocument) => void;
  onDownload?: (content: string, name: string, mime: string) => void;
  onDownloadBinary?: (bytes: Uint8Array, name: string, mime: string) => void;
}

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

export const SplitDocumentPane: React.FC<SplitDocumentPaneProps> = ({ doc, choices, onChooseDoc, onSwap, onClose, onUpdateDocument, onDownload, onDownloadBinary }) => {
  const [range, setRange] = useState<{ start: number; end: number; label?: string } | null>(null);
  // The pane scans as the main view does (App.tsx `restrictionScope`), by the one shared rule:
  // `restrictionScannedBp` (over 150,000 bp only the first 60,000 bp, as a linear sequence) and
  // `restrictionScanScope` (more than 100,000 bp scanned with the engine's first CORE_CATALOG_LEN
  // catalog enzymes only). Its linear view is handed that scope, so it says where its cut sites
  // stop, as the main linear view does (BG-01M6RTHN).
  // The scan keeps each enzyme's first sites by position and warns when it left some out (BG-01M6S1K2).
  const { scan, restrictionScope } = useMemo((): { scan: RestrictionSiteScan; restrictionScope: RestrictionScanScope | null } => {
    if (!doc || doc.moleculeType !== 'DNA' || !doc.sequence || doc.alignmentMeta?.sequences?.length) return { scan: EMPTY_RESTRICTION_SCAN, restrictionScope: null };
    const length = doc.sequence.length;
    const scope = restrictionScanScope(length, restrictionScannedBp(length));
    return {
      scan: scope?.firstBp ? scanRestrictionSites(doc.sequence.slice(0, scope.firstBp), 'linear') : scanRestrictionSites(doc.sequence, doc.topology),
      restrictionScope: scope,
    };
  }, [doc]);
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
        <select aria-label="Document in split view" value={doc?.id ?? ''} onChange={(e) => onChooseDoc(e.target.value)}>
          <option value="">Choose a document…</option>
          {choices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="mbc-zoom-btn" title="Swap with the main view" aria-label="Swap with the main view" disabled={!doc} onClick={onSwap}><ArrowLeftRight size={13} /></button>
        <button type="button" className="mbc-zoom-btn" title="Close split view" aria-label="Close split view" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="mbc-split-pane-body">{body}</div>
    </section>
  );
};
