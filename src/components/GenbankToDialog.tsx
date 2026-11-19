// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Convert GenBank… window (US-01M7RCCA, D0228): genbank_to 0.54's outputs (Rob Edwards, MIT,
 * https://github.com/linsalrob/genbank_to), ported to Rust (EP-01M7RC9C), from the selected open
 * records, the active record, or a GenBank file (gzipped or not). The engine writes every file in
 * one `genbank_to_convert` call; this window only collects the choices, saves the one file or the
 * one zip through saveWorkbenchFile, and shows the engine's warnings.
 */

import React, { useId, useState } from 'react';
import { FileOutput, Loader2 } from 'lucide-react';
import { StaticModalDialog } from './MenusPreferencesAndBlastModal';
import { OptionRow } from './OperationDialog';
import { convertGenbank, type GenbankToOutput, type GenbankToRequest } from '../core/bioEngine';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import type { SequenceDocument } from '../types/bio';

/** The outputs, in the engine's order, with the files each writes. */
export const GENBANK_TO_OUTPUTS: readonly { id: GenbankToOutput; label: string; files: string }[] = [
  { id: 'nucleotides', label: 'Nucleotides', files: '.fna' },
  { id: 'cdsDna', label: 'CDS DNA', files: '.orfs' },
  { id: 'proteins', label: 'CDS proteins', files: '.faa' },
  { id: 'functions', label: 'Functions', files: '.functions.tsv' },
  { id: 'ptt', label: 'ptt', files: '.ptt' },
  { id: 'phageFinder', label: 'phage_finder', files: '.phage_finder.tsv' },
  { id: 'gff3', label: 'GFF3', files: '.gff3' },
  { id: 'amrFinderPlus', label: 'AMRFinderPlus', files: '.amr.gff, .amr.faa, .amr.fna' },
  { id: 'baktaJson', label: 'Bakta JSON', files: '.bakta.json' },
];

/** The translation tables Bakta JSON accepts, as genbank_to 0.54 does (D0227 (10)). */
export const BAKTA_TRANSLATION_TABLES = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33];

/** The extensions a GenBank file is chosen by, each also gzipped. */
export const GENBANK_FILE_ACCEPT = ['.gb', '.gbk', '.gbff', '.genbank'].flatMap((e) => [e, `${e}.gz`]).join(',');

/** A file's base name (D0228): its name without its .gz and then its GenBank extension. */
export function genbankBaseName(fileName: string): string {
  const unzipped = fileName.replace(/\.gz$/i, '');
  return unzipped.replace(/\.(gb|gbk|gbff|genbank)$/i, '') || unzipped;
}

/** A chosen file, as the browser hands it over. */
type ChosenFile = Pick<File, 'name' | 'arrayBuffer'>;

export interface GenbankToDialogProps {
  /** The records offered as the source: the selected ones, else the active one; [] with no session. */
  records: SequenceDocument[];
  /** The active record's name, the base name of the records source. */
  activeName: string;
  onClose: () => void;
}

/** What the last Convert did: what was saved, or the refusal, and the engine's warnings. */
interface Outcome {
  saved: string | null;
  error: string | null;
  warnings: string[];
}

const engineMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\[MolBioCraft Rust Engine :: [^\]]+\] /, '');

export const GenbankToDialog: React.FC<GenbankToDialogProps> = ({ records, activeName, onClose }) => {
  const uid = useId();
  const [source, setSource] = useState<'records' | 'file'>(records.length ? 'records' : 'file');
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [outputs, setOutputs] = useState<GenbankToOutput[]>([]);
  const [includePseudogenes, setIncludePseudogenes] = useState(false);
  const [complexHeaders, setComplexHeaders] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [recordIds, setRecordIds] = useState('');
  const [gram, setGram] = useState<'' | '+' | '-'>('');
  const [table, setTable] = useState(11);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const bakta = outputs.includes('baktaJson');
  const toggle = (id: GenbankToOutput, on: boolean) =>
    setOutputs((prev) => GENBANK_TO_OUTPUTS.map((o) => o.id).filter((o) => (o === id ? on : prev.includes(o))));
  const base = source === 'file' ? (file ? genbankBaseName(file.name) : '') : activeName;
  const problem = source === 'file' && !file ? 'Choose a GenBank file to convert.' : source === 'records' && !records.length ? 'No record is open: choose a GenBank file.' : null;

  const convert = async () => {
    if (problem || running) return;
    setRunning(true);
    setOutcome(null);
    try {
      const request: GenbankToRequest = {
        source: source === 'file' && file
          ? { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }
          : { documents: records },
        baseName: base,
        outputs,
        includePseudogenes,
        complexHeaders,
        separate,
        records: recordIds.split(',').map((r) => r.trim()).filter(Boolean),
        gram: bakta && gram ? gram : null,
        translationTable: bakta ? table : null,
      };
      const reply = convertGenbank(request);
      const zipName = `${base}.genbank_to.zip`;
      const [name, saved] = reply.zip
        ? [zipName, saveWorkbenchFile(zipName, new Uint8Array(reply.zip), 'application/zip')]
        : [reply.files[0].name, saveWorkbenchFile(reply.files[0].name, reply.files[0].text)];
      const what = reply.zip ? `${name} (${reply.files.length} files)` : name;
      setOutcome(saved
        ? { saved: `Saved ${what}.`, error: null, warnings: reply.warnings }
        : { saved: null, error: `${what} could not be saved: this window has no save route.`, warnings: reply.warnings });
    } catch (e) {
      setOutcome({ saved: null, error: engineMessage(e), warnings: [] });
    } finally {
      setRunning(false);
    }
  };

  const check = (key: string, label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="mbc-opdlg-check" title={hint}>
      <input type="checkbox" data-genbank-to-option={key} checked={value} onChange={(e) => { set(e.target.checked); setOutcome(null); }} /> {label}
    </label>
  );

  return (
    <StaticModalDialog titleId="opdlg-genbank-to" title="Convert GenBank…" sizeClass="modal-size-operation" onClose={onClose} closedBy="closerequest">
      <div className="mbc-opdlg-body" data-genbank-to-dialog="">
        <div className="mbc-opdlg-summary">
          Writes genbank_to 0.54's outputs (Rob Edwards, MIT) from GenBank records. Several files save as one {base ? `${base}.genbank_to.zip` : 'zip'}.
        </div>
        <div className="mbc-opdlg-options">
          <OptionRow label="Source:" htmlFor={`${uid}-src-records`}>
            <label>
              <input type="radio" id={`${uid}-src-records`} name={`${uid}-source`} data-genbank-to-source="records" checked={source === 'records'}
                disabled={!records.length} onChange={() => { setSource('records'); setOutcome(null); }} />{' '}
              {records.length > 1 ? `The ${records.length} selected records` : records.length ? `The record ${records[0].name}` : 'No record is open'}
            </label>
            <label>
              <input type="radio" name={`${uid}-source`} data-genbank-to-source="file" checked={source === 'file'}
                onChange={() => { setSource('file'); setOutcome(null); }} />{' '}
              A GenBank file…
            </label>
            {source === 'file' && (
              <input type="file" data-genbank-to-file="" accept={GENBANK_FILE_ACCEPT} aria-label="GenBank file"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setOutcome(null); }} />
            )}
          </OptionRow>
          <OptionRow label="Outputs:">
            {GENBANK_TO_OUTPUTS.map((o) => (
              <label key={o.id} className="mbc-opdlg-check" title={o.files}>
                <input type="checkbox" data-genbank-to-output={o.id} checked={outputs.includes(o.id)}
                  onChange={(e) => { toggle(o.id, e.target.checked); setOutcome(null); }} /> {o.label} ({o.files})
              </label>
            ))}
          </OptionRow>
          <OptionRow label="Options:">
            {check('includePseudogenes', 'Include pseudogenes', includePseudogenes, setIncludePseudogenes, 'Keep CDS marked /pseudo; never in Bakta JSON or AMRFinderPlus.')}
            {check('complexHeaders', 'Complex headers', complexHeaders, setComplexHeaders)}
            {check('separate', 'One file per record', separate, setSeparate, 'Nucleotides, CDS DNA and proteins, one file per record; with no output, each record as <record id>.gbk.')}
          </OptionRow>
          <OptionRow label="Records:" htmlFor={`${uid}-records`} hint="Comma-separated record ids, with or without their version; empty keeps every record.">
            <input type="text" id={`${uid}-records`} data-genbank-to-records="" value={recordIds} onChange={(e) => { setRecordIds(e.target.value); setOutcome(null); }} />
          </OptionRow>
          {bakta && (
            <>
              <OptionRow label="Gram stain:" htmlFor={`${uid}-gram`} hint="Bakta JSON only.">
                <select id={`${uid}-gram`} data-genbank-to-gram="" value={gram} onChange={(e) => { setGram(e.target.value as '' | '+' | '-'); setOutcome(null); }}>
                  <option value="">From the genus</option>
                  <option value="+">+</option>
                  <option value="-">-</option>
                </select>
              </OptionRow>
              <OptionRow label="Translation table:" htmlFor={`${uid}-table`} hint="Bakta JSON only.">
                <select id={`${uid}-table`} data-genbank-to-table="" value={String(table)} onChange={(e) => { setTable(Number(e.target.value)); setOutcome(null); }}>
                  {BAKTA_TRANSLATION_TABLES.map((t) => <option key={t} value={String(t)}>{t}</option>)}
                </select>
              </OptionRow>
            </>
          )}
        </div>
        {problem && <div className="info-callout" role="status">{problem}</div>}
        {running && <div className="mbc-opdlg-progress" role="status"><Loader2 size={14} className="mbc-spin" /> Converting…</div>}
        {outcome?.error && <div className="info-callout" role="alert" data-genbank-to-error="" style={{ color: 'var(--mbc-red)' }}>{outcome.error}</div>}
        {outcome?.saved && <div className="info-callout" role="status" data-genbank-to-saved="">{outcome.saved}</div>}
        {outcome && outcome.warnings.length > 0 && (
          <ul className="info-callout" data-genbank-to-warnings="" aria-label="Warnings">
            {outcome.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </div>
      <div className="prefs-modal-footer">
        <div className="mbc-opdlg-footer-actions">
          <button type="button" className="btn-secondary-sm" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary-sm" data-genbank-to-convert="" disabled={!!problem || running} onClick={() => void convert()}>
            <FileOutput size={14} /> Convert
          </button>
        </div>
      </div>
    </StaticModalDialog>
  );
};
