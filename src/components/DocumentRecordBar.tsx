// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The one-line record bar the document table folds into once a document is open (US-01M6Q10G):
 * the open record's name, length, topology and status, read from the table's own cell values so
 * the bar and the table cannot disagree, and the one toggle that shows or hides the table. The
 * status is the table's Status value with the icon its Status column shows too (BG-01M6S1B3): a
 * record with an alert reads "N alert(s)" with the warning icon, whether or not every check ran;
 * one with no alert reads "OK" only when every check ran on the whole record, and otherwise
 * "Partly checked" or "Not checked", each with its own neutral icon.
 */
import React from 'react';
import { ChevronDown, ChevronUp, CircleDashed, CircleDotDashed } from 'lucide-react';
import type { SequenceDocument } from '../types/bio';
import { computeDocumentTableMetrics, getDocumentColumnDisplayValue, recordCheckVerdict, type RecordCheckVerdict } from '../core/workbenchBatchOperations';
import { isTreeDocument } from '../core/documentViews';
import { MolBioStatusBadgeIcon } from './MolBioIcons';

/** What happened to the workbench, as far as the document table's shown/folded state is concerned. */
export type DocTableEvent =
  /** A document was opened: by import or File › Open, created (new sequence), saved by an analysis, or opened from the sidebar. */
  | { kind: 'open' | 'import' | 'create' | 'result' | 'sidebar-open' }
  /** A row of the expanded table was clicked (a plain click, or a Cmd/Ctrl or Shift click that adds it). */
  | { kind: 'select-row' }
  /** A session was started from scratch. */
  | { kind: 'start-session'; hasActiveDocument: boolean }
  /** A saved session (.mbc file or autosave) was restored with its saved state. */
  | { kind: 'restore-session'; saved: boolean }
  /** The table's toggle, View › Document Table, or the native menu's Toggle File Table. */
  | { kind: 'toggle' };

/**
 * The table's next folded state (`true`: the record bar) after `event`. Opening a document folds the
 * table; selecting rows never does, so the table can be browsed; a restored session shows what was
 * saved; a session started without a document shows the full table and one started with a document
 * keeps the current state.
 */
export function nextDocTableCollapsed(collapsed: boolean, event: DocTableEvent): boolean {
  switch (event.kind) {
    case 'open':
    case 'import':
    case 'create':
    case 'result':
    case 'sidebar-open':
      return true;
    case 'select-row':
      return collapsed;
    case 'start-session':
      return event.hasActiveDocument ? collapsed : false;
    case 'restore-session':
      return event.saved;
    case 'toggle':
      return !collapsed;
  }
}

/**
 * Shows or hides the document table; the same control in the record bar and the table toolbar. Its
 * tooltip is its accessible name, so a mouse user and a screen-reader user meet one name.
 */
export function DocumentTableToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const name = expanded ? 'Hide document table' : 'Show document table';
  return (
    <button
      type="button"
      className="mbc-icon-btn mbc-doc-table-toggle"
      aria-label={name}
      aria-expanded={expanded}
      title={name}
      onClick={() => onToggle()}
    >
      {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
      {!expanded && <span className="mbc-doc-table-toggle-label">Document table</span>}
    </button>
  );
}

/**
 * A topology belongs to DNA and RNA sequence records. Proteins have none (the Info panel shows none
 * for them), and neither do trees, text documents and enzyme sets, which hold no sequence to fold.
 */
function recordHasTopology(doc: SequenceDocument): boolean {
  const type = String(doc.docMetadata?.['Document Type'] ?? '');
  return doc.moleculeType !== 'Protein' && !isTreeDocument(doc) && type !== 'Text Document' && type !== 'Enzyme Set';
}

const Sep = () => <span className="mbc-record-bar-sep" aria-hidden="true">{' · '}</span>;

/**
 * The verdict's icon, shared by the record bar and the table's Status column: a pass for a clear
 * record, a warning for alerts, and, in muted ink, a dashed circle with a dot when some checks ran
 * ("Partly checked") or an empty dashed circle when none did ("Not checked").
 */
export function RecordStatusIcon({ verdict, size = 14 }: { verdict: RecordCheckVerdict; size?: number }) {
  if (verdict === 'alerts' || verdict === 'clear') return <MolBioStatusBadgeIcon ok={verdict === 'clear'} size={size} />;
  const Icon = verdict === 'partial' ? CircleDotDashed : CircleDashed;
  return (
    <Icon
      size={size}
      className={`mbc-status-svg is-unchecked ${verdict === 'partial' ? 'is-partial' : 'is-not-run'}`}
      style={{ color: 'var(--mbc-text-muted)' }}
      aria-hidden="true"
    />
  );
}

/**
 * The open record in one line: `name · length · topology · status`, then any controls the caller
 * passes as children, then the toggle that restores the full table.
 */
export function DocumentRecordBar({ doc, onShowTable, children }: { doc: SequenceDocument; onShowTable: () => void; children?: React.ReactNode }) {
  const metrics = computeDocumentTableMetrics(doc);
  const cell = (col: string) => getDocumentColumnDisplayValue(doc, metrics, col);
  const name = cell('name');
  const verdict = recordCheckVerdict(metrics);
  return (
    <div className="mbc-record-bar" role="group" aria-label="Open record">
      <p className="mbc-record-bar-summary">
        <span className="mbc-record-bar-name" title={name}>{name}</span>
        <Sep />
        <span className="mbc-record-bar-length">{cell('length')}</span>
        {recordHasTopology(doc) && (
          <>
            <Sep />
            <span className="mbc-record-bar-topology">{cell('topology')}</span>
          </>
        )}
        <Sep />
        <span className="mbc-record-bar-status" title={metrics.alertsSummary}>
          <RecordStatusIcon verdict={verdict} size={14} />
          <span className="mbc-record-bar-status-text">{cell('status')}</span>
        </span>
      </p>
      {children}
      <DocumentTableToggle expanded={false} onToggle={onShowTable} />
    </div>
  );
}
