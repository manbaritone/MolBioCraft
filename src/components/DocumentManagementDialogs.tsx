// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Edit → Find Duplicates… and Edit → Batch Rename… options windows. */

import React from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { renameOptionsOf, runBatchRename } from '../core/operationRunners';
import {
  findDuplicateGroups,
  regexError,
  renamedValue,
  type DuplicateKey,
} from '../core/documentManagement';
import type { OptionValues } from '../core/optionProfiles';
import type { SequenceDocument } from '../types/bio';

// ───────────────────────────── Find Duplicates ─────────────────────────────

export interface FindDuplicatesDialogProps {
  selected: SequenceDocument[];
  folderDocs: SequenceDocument[];
  folderLabel: string;
  /** Selects the duplicate copies in the document table. */
  onSelect: (ids: string[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const FindDuplicatesDialog: React.FC<FindDuplicatesDialogProps> = ({
  selected, folderDocs, folderLabel, onSelect, onClose, onDownload,
}) => {
  const scopeDocs = (v: OptionValues) => (v.scope === 'selected' ? selected : folderDocs);
  const groupsFor = (v: OptionValues) =>
    findDuplicateGroups(scopeDocs(v), String(v.matchBy) as DuplicateKey, v.keep === 'oldest' ? 'oldest' : 'newest', Boolean(v.bothStrands));
  return (
    <OperationDialog
      operationId="find-duplicates"
      title="Find Duplicates…"
      runLabel="Select Duplicates"
      defaults={{ scope: selected.length > 1 ? 'selected' : 'folder', matchBy: 'sequence', keep: 'newest', bothStrands: false }}
      onDownload={onDownload}
      summary={<span><strong>{folderLabel}</strong> · {folderDocs.length} documents, {selected.length} selected</span>}
      validate={(v) => (groupsFor(v).length === 0 ? 'No duplicates found with these settings.' : null)}
      renderOptions={(v, set) => {
        const groups = groupsFor(v);
        const dupCount = groups.reduce((n, g) => n + g.duplicates.length, 0);
        return (
          <>
            <OptionRow label="Search in:" htmlFor="opdlg-dup-scope">
              <select id="opdlg-dup-scope" value={String(v.scope)} onChange={(e) => set('scope', e.target.value)}>
                <option value="folder">All documents in {folderLabel}</option>
                <option value="selected" disabled={selected.length < 2}>Selected documents ({selected.length})</option>
              </select>
            </OptionRow>
            <OptionRow label="Duplicates have the same:" htmlFor="opdlg-dup-by">
              <select id="opdlg-dup-by" value={String(v.matchBy)} onChange={(e) => set('matchBy', e.target.value)}>
                <option value="sequence">Residues (sequence, ignoring case and gaps)</option>
                <option value="name">Name</option>
                <option value="accession">Accession / database ID</option>
              </select>
              {v.matchBy === 'sequence' && (
                <label className="mbc-check-row">
                  <input type="checkbox" checked={Boolean(v.bothStrands)} onChange={(e) => set('bothStrands', e.target.checked)} />
                  <span>A reverse complement counts as a duplicate (reads from either strand)</span>
                </label>
              )}
            </OptionRow>
            <OptionRow label="Keep unselected:" htmlFor="opdlg-dup-keep" hint="All other copies are selected so you can delete or move them.">
              <select id="opdlg-dup-keep" value={String(v.keep)} onChange={(e) => set('keep', e.target.value)}>
                <option value="newest">The most recently modified copy</option>
                <option value="oldest">The least recently modified copy</option>
              </select>
            </OptionRow>
            <OptionRow label="Found:">
              <div className="mbc-opdlg-checklist" role="list" aria-label="Duplicate groups">
                {groups.length === 0 && <span className="mbc-opdlg-muted">No duplicates.</span>}
                {groups.slice(0, 50).map((g) => (
                  <div key={g.key} role="listitem" className="mbc-check-row">
                    <span>{g.keep.name}</span>
                    <span className="mbc-opdlg-muted">+{g.duplicates.length} cop{g.duplicates.length === 1 ? 'y' : 'ies'}</span>
                  </div>
                ))}
                {groups.length > 50 && <span className="mbc-opdlg-muted">…and {groups.length - 50} more groups</span>}
              </div>
              <span className="mbc-opdlg-muted">{groups.length} groups, {dupCount} duplicate cop{dupCount === 1 ? 'y' : 'ies'}</span>
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        const groups = groupsFor(v);
        const ids = groups.flatMap((g) => g.duplicates.map((d) => d.id));
        onSelect(ids, `Selected ${ids.length} duplicate cop${ids.length === 1 ? 'y' : 'ies'} in ${groups.length} group${groups.length === 1 ? '' : 's'} (one copy of each kept unselected)`);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Batch Rename ─────────────────────────────

export interface BatchRenameDialogProps {
  docs: SequenceDocument[];
  onApply: (updated: SequenceDocument[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

const opts = renameOptionsOf;

export const BatchRenameDialog: React.FC<BatchRenameDialogProps> = ({ docs, onApply, onClose, onDownload }) => (
  <OperationDialog
    operationId="batch-rename"
    title="Batch Rename…"
    runLabel="Rename"
    defaults={{ field: 'name', template: '{name}', prefix: '', suffix: '', find: '', replace: '', counterStart: 1 }}
    onDownload={onDownload}
    summary={<span><strong>{docs.length}</strong> selected document{docs.length === 1 ? '' : 's'}</span>}
    validate={(v) => {
      if (docs.length === 0) return 'Select the documents to rename in the table.';
      const err = regexError(String(v.find));
      if (err) return err;
      const o = opts(v);
      if (o.field === 'name' && docs.some((d, i) => !renamedValue(d, i, o))) return 'Some names would be empty.';
      if (docs.every((d, i) => renamedValue(d, i, o) === (o.field === 'name' ? d.name : d.description))) return 'These settings change nothing.';
      return null;
    }}
    renderOptions={(v, set) => {
      const o = opts(v);
      return (
        <>
          <OptionRow label="Field to change:" htmlFor="opdlg-ren-field">
            <select id="opdlg-ren-field" value={String(v.field)} onChange={(e) => {
              set('field', e.target.value);
              set('template', e.target.value === 'description' ? '{description}' : '{name}');
            }}>
              <option value="name">Name</option>
              <option value="description">Description</option>
            </select>
          </OptionRow>
          <OptionRow label="New value:" htmlFor="opdlg-ren-tpl" hint="Combine fields: {name} {accession} {description} {organism} {length} {n} (counter; {n:3} pads to 001).">
            <input id="opdlg-ren-tpl" type="text" value={String(v.template)} onChange={(e) => set('template', e.target.value)} />
          </OptionRow>
          <OptionRow label="Add text:">
            <div className="prefs-row">
              <input aria-label="Prefix" type="text" placeholder="before" style={{ width: 130 }} value={String(v.prefix)} onChange={(e) => set('prefix', e.target.value)} />
              <input aria-label="Suffix" type="text" placeholder="after" style={{ width: 130 }} value={String(v.suffix)} onChange={(e) => set('suffix', e.target.value)} />
            </div>
          </OptionRow>
          <OptionRow label="Preview:">
            <div className="mbc-opdlg-checklist" role="list" aria-label="Rename preview">
              {docs.slice(0, 12).map((d, i) => {
                const before = o.field === 'name' ? d.name : d.description;
                const after = renamedValue(d, i, o);
                return (
                  <div key={d.id} role="listitem" className="mbc-check-row">
                    <span className="mbc-opdlg-muted" style={{ marginInlineStart: 0 }}>{before || '—'}</span>
                    <span>→ {after || '—'}</span>
                  </div>
                );
              })}
              {docs.length > 12 && <span className="mbc-opdlg-muted">…and {docs.length - 12} more</span>}
            </div>
          </OptionRow>
        </>
      );
    }}
    renderMoreOptions={(v, set) => (
      <>
        <OptionRow label="Find (regular expression):" htmlFor="opdlg-ren-find" hint="Applied to the new value. Use $1, $2 in the replacement for captured groups.">
          <input id="opdlg-ren-find" type="text" value={String(v.find)} onChange={(e) => set('find', e.target.value)} />
        </OptionRow>
        <OptionRow label="Replace with:" htmlFor="opdlg-ren-repl">
          <input id="opdlg-ren-repl" type="text" value={String(v.replace)} onChange={(e) => set('replace', e.target.value)} />
        </OptionRow>
        <OptionRow label="Counter starts at:" htmlFor="opdlg-ren-n">
          <input id="opdlg-ren-n" type="number" min={0} style={{ width: 90 }} value={Number(v.counterStart)} onChange={(e) => set('counterStart', Math.round(Number(e.target.value)))} />
        </OptionRow>
      </>
    )}
    onRun={(v) => {
      const r = runBatchRename(docs, v);
      onApply(r.updated, r.summary);
    }}
    onClose={onClose}
  />
);
