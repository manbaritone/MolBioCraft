// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** File → Import → Metadata from Spreadsheet… */

import React, { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { parseDelimited, planMetadataImport, type Spreadsheet } from '../core/metadataImport';
import type { SequenceDocument } from '../types/bio';

export interface MetadataImportDialogProps {
  selected: SequenceDocument[];
  folderDocs: SequenceDocument[];
  allDocs: SequenceDocument[];
  folderLabel: string;
  onApply: (updated: SequenceDocument[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const MetadataImportDialog: React.FC<MetadataImportDialogProps> = ({ selected, folderDocs, allDocs, folderLabel, onApply, onClose, onDownload }) => {
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scopeDocs = (scope: unknown) => (scope === 'selected' ? selected : scope === 'all' ? allDocs : folderDocs);
  const guessKey = useMemo(() => sheet?.headers.find((h) => /^(name|accession|id|sample)$/i.test(h.trim())) ?? sheet?.headers[0] ?? '', [sheet]);
  const plan = (v: Record<string, string | number | boolean>) => {
    if (!sheet) return null;
    try {
      return planMetadataImport(scopeDocs(v.scope), sheet, { keyColumn: String(v.keyColumn || guessKey), matchBy: v.matchBy === 'accession' ? 'accession' : 'name', overwrite: Boolean(v.overwrite) });
    } catch {
      return null;
    }
  };
  return (
    <OperationDialog
      operationId="import-metadata"
      title="Import Metadata from Spreadsheet…"
      runLabel="Import"
      transientKeys={['keyColumn']}
      defaults={{ scope: selected.length ? 'selected' : 'folder', matchBy: 'name', keyColumn: '', overwrite: false }}
      onDownload={onDownload}
      summary={<span>Adds spreadsheet columns as metadata fields on matching documents (CSV or tab-separated, first row = column names).</span>}
      validate={(v) => {
        if (fileError) return fileError;
        if (!sheet) return 'Choose a CSV or TSV file.';
        const p = plan(v);
        if (!p) return 'Choose the column that identifies each document.';
        if (!p.updated.length) return p.matchedRows ? 'Matching documents already have these values (turn on Overwrite to replace them).' : 'No rows match a document with these settings.';
        return null;
      }}
      renderOptions={(v, set) => {
        const p = plan(v);
        return (
          <>
            <OptionRow label="Spreadsheet:">
              <div className="prefs-row">
                <button type="button" className="btn-secondary-sm" onClick={() => fileRef.current?.click()}><Upload size={13} /> Choose file…</button>
                <span className="mbc-opdlg-muted">{fileName ? `${fileName} · ${sheet?.rows.length ?? 0} rows, ${sheet?.headers.length ?? 0} columns` : 'No file chosen'}</span>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setFileName(f.name);
                try {
                  setSheet(parseDelimited(await f.text()));
                  setFileError(null);
                  set('keyColumn', '');
                } catch (err) {
                  setSheet(null);
                  setFileError(err instanceof Error ? err.message : String(err));
                }
              }} />
            </OptionRow>
            {sheet && (
              <>
                <OptionRow label="Match column:" htmlFor="opdlg-md-key">
                  <div className="prefs-row">
                    <select id="opdlg-md-key" value={String(v.keyColumn || guessKey)} onChange={(e) => set('keyColumn', e.target.value)}>
                      {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span>to document</span>
                    <select aria-label="Document field to match" value={String(v.matchBy)} onChange={(e) => set('matchBy', e.target.value)}>
                      <option value="name">Name</option>
                      <option value="accession">Accession</option>
                    </select>
                  </div>
                </OptionRow>
                <OptionRow label="Documents:" htmlFor="opdlg-md-scope">
                  <select id="opdlg-md-scope" value={String(v.scope)} onChange={(e) => set('scope', e.target.value)}>
                    <option value="selected" disabled={!selected.length}>Selected documents ({selected.length})</option>
                    <option value="folder">All documents in {folderLabel} ({folderDocs.length})</option>
                    <option value="all">All documents in the project ({allDocs.length})</option>
                  </select>
                </OptionRow>
                <OptionRow label="Existing values:">
                  <label className="mbc-check-row">
                    <input type="checkbox" checked={Boolean(v.overwrite)} onChange={(e) => set('overwrite', e.target.checked)} />
                    <span>Overwrite fields that already have a value</span>
                  </label>
                </OptionRow>
                {p && (
                  <OptionRow label="Preview:">
                    <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>
                      {p.matchedRows} of {sheet.rows.length} rows match; {p.updated.length} document{p.updated.length === 1 ? '' : 's'} will change; fields: {p.fields.join(', ') || '—'}
                      {p.unmatched.length ? `. Unmatched: ${p.unmatched.slice(0, 5).join(', ')}${p.unmatched.length > 5 ? '…' : ''}` : ''}
                    </span>
                  </OptionRow>
                )}
              </>
            )}
          </>
        );
      }}
      onRun={(v) => {
        const p = plan(v)!;
        onApply(p.updated, `Imported metadata onto ${p.updated.length} document${p.updated.length === 1 ? '' : 's'} (${p.fields.join(', ')})${p.unmatched.length ? `; ${p.unmatched.length} rows had no matching document` : ''}`);
      }}
      onClose={onClose}
    />
  );
};
