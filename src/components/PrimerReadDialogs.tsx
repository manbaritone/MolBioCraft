// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 *   Primers → Test with Saved Primers…   (binding sites added as primers)
 *   Primers → Find Where Stored Primers Bind…   (Primer Database binding sites, previewed, added as primers)
 *   Sequence → Trim Ends…                 (Trimmed annotations, or trimmed copies)
 */

import React, { useMemo, useState } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { BACK_TRANSLATION_HOSTS, runBackTranslate, runCompareAnnotations, runMergePairedReads, runReadQcReport, runTestSavedPrimers, runTrimEnds, SAVED_PRIMER_NOTE, type OperationResult } from '../core/operationRunners';
import { mateOf } from '../core/annotationReadTools';
import { GENETIC_CODE_NAMES } from '../core/alignmentViewModel';
import {
  addPrimerBindings,
  databasePrimerCandidate,
  findPrimerBindings,
  primerFromDatabaseOccurrence,
  primerMatchSettingsText,
  type PrimerBindingOccurrence,
  type PrimerCandidate,
} from '../core/bioEngine';
import { activePrimers, type PrimerDbRead } from '../core/primerDatabase';
import type { PrimerRecord, SequenceDocument } from '../types/bio';

const num = (v: string | number | boolean) => Number(v);
/** A list option's items: keys and ids are joined by a line break, which none of them holds. */
const KEY_SEP = '\n';
const keysOf = (v: string | number | boolean | undefined) => String(v ?? '').split(KEY_SEP).filter(Boolean);
const stampId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The Primer Database's active records as candidates, or why the store cannot be read (never read as empty). */
function databaseCandidates(read: PrimerDbRead | undefined): { candidates: PrimerCandidate[]; error: string | null } {
  if (!read) return { candidates: [], error: null };
  if (!read.ok) return { candidates: [], error: `The Primer Database cannot be read, so its primers are not listed: ${read.error.message}` };
  return { candidates: activePrimers(read.records).map(databasePrimerCandidate), error: null };
}

/** What a surface says after a candidate's name: its length, and why Tm or the search is unavailable. */
function candidateNote(c: PrimerCandidate): string {
  return c.notSearchedReason ?? c.thermoUnavailableReason ?? '';
}

export interface TestSavedPrimersDialogProps {
  targets: SequenceDocument[];
  primerDocs: SequenceDocument[];
  /** The Primer Database as read when the dialog opened; its active records are listed beside the primer documents. */
  databaseRead?: PrimerDbRead;
  onApply: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

/**
 * Test with Saved Primers over the chosen primer documents and Primer Database records
 * (US-01M7DQMY AC2). The documents are screened by `runTestSavedPrimers` exactly as before; the
 * records through the same engine, placed with their source, the match conditions and, for an RNA
 * or modified record, Tm marked unavailable with the reason.
 */
export function runTestSavedPrimersWithDatabase(
  targets: SequenceDocument[],
  primerDocs: SequenceDocument[],
  database: PrimerCandidate[],
  v: Record<string, string | number | boolean>
): OperationResult {
  const maxMm = Math.max(0, Math.min(5, num(v.maxMismatches ?? 1)));
  // runTestSavedPrimers refuses a run with no primer of 12 bases or more; the records may still be screened.
  const docPart = primerDocs.some((d) => d.sequence.length >= 12) ? runTestSavedPrimers(targets, primerDocs, { ...v, primerNames: '' }) : null;
  const search = findPrimerBindings(targets, database, maxMm);
  const updated: SequenceDocument[] = [];
  let placedTotal = 0;
  const t = new Date().toISOString();
  for (const target of targets) {
    if (target.moleculeType === 'Protein' || !target.sequence) continue;
    const fromDocs = docPart?.updated.find((d) => d.id === target.id);
    const base = fromDocs ?? (docPart === null && v.replace !== false
      ? { ...target, primers: target.primers.filter((p) => !p.notes?.startsWith(SAVED_PRIMER_NOTE)) }
      : target);
    const placed: PrimerRecord[] = search.occurrences
      .filter((o) => o.targetId === target.id)
      .map((o) => {
        const p = primerFromDatabaseOccurrence(o, target, stampId('spdb'));
        return { ...p, notes: `${SAVED_PRIMER_NOTE}: ${p.notes?.replace(/^Added from the Primer Database: /, '') ?? ''} (Primer Database record ${o.candidate.name})` };
      });
    placedTotal += placed.length;
    if (!fromDocs && !placed.length && base.primers.length === target.primers.length) continue;
    updated.push({
      ...base,
      primers: [...base.primers, ...placed],
      updatedAt: placed.length ? t : base.updatedAt,
      history: placed.length
        ? [...base.history, { id: stampId('hist'), timestamp: t, operation: 'Test with Saved Primers', description: `${placed.length} binding site${placed.length === 1 ? '' : 's'} from ${database.length} Primer Database record${database.length === 1 ? '' : 's'} (≤ ${maxMm} mismatches)`, parentIds: [target.id], lengthBp: target.sequence.length, topology: target.topology }]
        : base.history,
    });
  }
  const notSearched = search.notSearched.map(({ candidate, reason }) => `${candidate.name} (Primer Database): ${reason}`);
  const dbSummary = database.length
    ? `${placedTotal} binding site${placedTotal === 1 ? '' : 's'} from ${database.length} Primer Database record${database.length === 1 ? '' : 's'}`
    : '';
  return {
    created: [],
    updated,
    summary: [docPart?.summary, dbSummary, ...notSearched].filter(Boolean).join('; '),
  };
}

export const TestSavedPrimersDialog: React.FC<TestSavedPrimersDialogProps> = ({ targets, primerDocs, databaseRead, onApply, onClose, onDownload }) => {
  const [filter, setFilter] = useState('');
  const dna = targets.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length >= 12 && d.documentKind !== 'primer');
  const database = useMemo(() => databaseCandidates(databaseRead), [databaseRead]);
  // Every primer keyed by its source and id: a record and a primer document of one name are both listed.
  const entries = useMemo(
    () => [
      ...primerDocs.map((d) => ({ key: `document:${d.id}`, name: d.name, sourceLabel: 'Document', length: d.sequence.length, note: '', doc: d as SequenceDocument | undefined, candidate: undefined as PrimerCandidate | undefined })),
      ...database.candidates.map((c) => ({ key: c.key, name: c.name, sourceLabel: c.sourceLabel, length: c.record.sequence.length, note: candidateNote(c), doc: undefined, candidate: c })),
    ],
    [primerDocs, database]
  );
  const chosenEntries = (v: Record<string, string | number | boolean>) => {
    const chosen = new Set(keysOf(v.primerKeys));
    return chosen.size === 0 ? entries : entries.filter((e) => chosen.has(e.key));
  };
  return (
    <OperationDialog
      operationId="test-saved-primers"
      title="Test with Saved Primers…"
      runLabel="Test"
      defaults={{ primerKeys: '', maxMismatches: 1, replace: true }}
      onDownload={onDownload}
      summary={<span><strong>{dna.length}</strong> target sequence{dna.length === 1 ? '' : 's'} · {primerDocs.length} primer documents in the project · {database.candidates.length} Primer Database primer{database.candidates.length === 1 ? '' : 's'}</span>}
      validate={(v) => {
        if (!dna.length) return 'Select the nucleotide sequences to test (primer documents themselves are not targets).';
        if (!entries.length) return database.error ?? 'This project has no primer documents (add some to the Primers folder) and the Primer Database has no primers.';
        if (keysOf(v.primerKeys).length && !chosenEntries(v).length) return 'None of the chosen primers are in this project or the Primer Database.';
        return null;
      }}
      renderOptions={(v, set) => {
        const chosen = new Set(keysOf(v.primerKeys));
        const all = chosen.size === 0;
        const shown = entries.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
        const toggle = (key: string, on: boolean) => {
          const base = all ? new Set(entries.map((p) => p.key)) : new Set(chosen);
          if (on) base.add(key); else base.delete(key);
          set('primerKeys', base.size === entries.length ? '' : Array.from(base).join(KEY_SEP));
        };
        return (
          <>
            {database.error && <div className="info-callout" role="alert">{database.error}</div>}
            <OptionRow label="Primers:" hint={all ? `All ${entries.length} primers are tested.` : `${chosen.size} of ${entries.length} primers selected.`}>
              <input type="text" placeholder="Filter primers" aria-label="Filter primers" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="mbc-opdlg-checklist" role="group" aria-label="Primers to test">
                {shown.map((p) => (
                  <label key={p.key} className="mbc-check-row" data-primer-key={p.key}>
                    <input type="checkbox" checked={all || chosen.has(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                    <span>{p.name}</span>
                    <span className="mbc-opdlg-muted">{p.sourceLabel}</span>
                    <span className="mbc-opdlg-muted">{p.length} nt</span>
                    {p.note && <span className="mbc-opdlg-muted">{p.note}</span>}
                  </label>
                ))}
              </div>
            </OptionRow>
            <OptionRow label="Allow mismatches:" htmlFor="opdlg-sp-mm" hint={primerMatchSettingsText(num(v.maxMismatches))}>
              <select id="opdlg-sp-mm" value={num(v.maxMismatches)} onChange={(e) => set('maxMismatches', Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None (exact match)' : `Up to ${n}`}</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Earlier results:">
              <label className="mbc-check-row">
                <input type="checkbox" checked={Boolean(v.replace)} onChange={(e) => set('replace', e.target.checked)} />
                <span>Replace binding sites from earlier tests</span>
              </label>
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        const chosen = chosenEntries(v);
        const docs = chosen.flatMap((e) => (e.doc ? [e.doc] : []));
        const records = chosen.flatMap((e) => (e.candidate ? [e.candidate] : []));
        onApply(records.length ? runTestSavedPrimersWithDatabase(dna, docs, records, v) : runTestSavedPrimers(dna, docs, { ...v, primerNames: '' }));
      }}
      onClose={onClose}
    />
  );
};

export interface PrimerBindingDialogProps {
  /** The Primer Database as read when the dialog opened. */
  databaseRead: PrimerDbRead;
  /** The project's nucleotide documents a primer can be searched on. */
  documents: SequenceDocument[];
  /** The targets ticked when the dialog opens: the selected documents, or the open one. */
  initialTargetIds: string[];
  /** The records ticked when the dialog opens: those the Primer Database window listed, or none. */
  initialPrimerIds?: string[];
  /** Adds the chosen binding sites: one call, so the App records it as one undoable step. */
  onAdd: (updated: SequenceDocument[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

/** One search of the dialog's options: the chosen records on the chosen targets. */
function bindingSearchFor(v: Record<string, string | number | boolean>, candidates: PrimerCandidate[], documents: SequenceDocument[]) {
  const ids = new Set(keysOf(v.primerIds));
  const targetIds = new Set(keysOf(v.targetIds));
  const chosen = candidates.filter((c) => ids.has(c.database?.id ?? ''));
  const targets = documents.filter((d) => targetIds.has(d.id));
  const search = findPrimerBindings(targets, chosen, num(v.maxMismatches));
  const excluded = new Set(keysOf(v.excluded));
  const selected = search.occurrences.filter((o) => !excluded.has(o.key));
  return { chosen, targets, search, selected };
}

const strandText = (o: PrimerBindingOccurrence) => (o.strand === 1 ? 'Forward (+)' : 'Reverse (-)');

/**
 * Find Where Stored Primers Bind (US-01M7DQMY AC1, AC3, AC5, AC6): choose Primer Database records
 * and target documents, see every forward and reverse binding site with its position, strand,
 * mismatches and the match method and settings, and add the ticked ones as primers. Nothing is
 * added until Add; the targets' bases are never changed.
 */
export const PrimerBindingDialog: React.FC<PrimerBindingDialogProps> = ({ databaseRead, documents, initialTargetIds, initialPrimerIds = [], onAdd, onClose, onDownload }) => {
  const database = useMemo(() => databaseCandidates(databaseRead), [databaseRead]);
  const targetsAvailable = documents.filter((d) => d.moleculeType !== 'Protein' && d.documentKind !== 'primer' && d.sequence.length > 0);
  const initialTargets = initialTargetIds.filter((id) => targetsAvailable.some((d) => d.id === id));
  const toggleIn = (v: string | number | boolean, key: string, on: boolean) => {
    const s = new Set(keysOf(v));
    if (on) s.add(key); else s.delete(key);
    return Array.from(s).join(KEY_SEP);
  };
  return (
    <OperationDialog
      operationId="primer-database-binding"
      title="Find Where Stored Primers Bind…"
      runLabel="Add Selected Binding Sites"
      defaults={{ primerIds: initialPrimerIds.join(KEY_SEP), targetIds: initialTargets.join(KEY_SEP), maxMismatches: 1, excluded: '' }}
      transientKeys={['primerIds', 'targetIds', 'excluded']}
      onDownload={onDownload}
      summary={<span>{database.candidates.length} Primer Database primer{database.candidates.length === 1 ? '' : 's'} · {targetsAvailable.length} nucleotide document{targetsAvailable.length === 1 ? '' : 's'}</span>}
      validate={(v) => {
        if (database.error) return database.error;
        if (!database.candidates.length) return 'The Primer Database has no primers.';
        const { chosen, targets, selected } = bindingSearchFor(v, database.candidates, targetsAvailable);
        if (!chosen.length) return 'Choose the stored primers to search for.';
        if (!targets.length) return 'Choose the documents to search.';
        if (!selected.length) return 'No binding site is ticked to add.';
        return null;
      }}
      renderOptions={(v, set) => {
        const { search, chosen } = bindingSearchFor(v, database.candidates, targetsAvailable);
        // Only a primer the engine searched can be said to bind nowhere (US-01M7DQMY AC6).
        const searchedNames = chosen.filter((c) => c.notSearchedReason === null).map((c) => c.name);
        const excluded = new Set(keysOf(v.excluded));
        const primerIds = new Set(keysOf(v.primerIds));
        const targetIds = new Set(keysOf(v.targetIds));
        return (
          <>
            {database.error && <div className="info-callout" role="alert">{database.error}</div>}
            <OptionRow label="Stored primers:">
              <div className="mbc-opdlg-checklist" role="group" aria-label="Stored primers to search for">
                {database.candidates.map((c) => (
                  <label key={c.key} className="mbc-check-row" data-primer-key={c.key}>
                    <input type="checkbox" checked={primerIds.has(c.database?.id ?? '')} onChange={(e) => set('primerIds', toggleIn(v.primerIds, c.database?.id ?? '', e.target.checked))} />
                    <span>{c.name}</span>
                    <span className="mbc-opdlg-muted">{c.record.sequence.length} nt{c.record.tail5Prime ? `, binds on its last ${c.record.annealSequence.length} (5' tail ${c.record.tail5Prime.length} nt)` : ''}</span>
                  </label>
                ))}
              </div>
            </OptionRow>
            <OptionRow label="Target documents:">
              <div className="mbc-opdlg-checklist" role="group" aria-label="Target documents">
                {targetsAvailable.map((d) => (
                  <label key={d.id} className="mbc-check-row">
                    <input type="checkbox" checked={targetIds.has(d.id)} onChange={(e) => set('targetIds', toggleIn(v.targetIds, d.id, e.target.checked))} />
                    <span>{d.name}</span>
                    <span className="mbc-opdlg-muted">{d.sequence.length.toLocaleString('en-US')} bp</span>
                  </label>
                ))}
              </div>
            </OptionRow>
            <OptionRow label="Allow mismatches:" htmlFor="opdlg-pb-mm">
              <select id="opdlg-pb-mm" value={num(v.maxMismatches)} onChange={(e) => set('maxMismatches', Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None (exact match)' : `Up to ${n}`}</option>)}
              </select>
            </OptionRow>
            <p className="mbc-opdlg-muted" data-match-settings="">{primerMatchSettingsText(num(v.maxMismatches))}</p>
            {search.notSearched.length > 0 && (
              <ul className="info-callout" aria-label="Primers not searched">
                {search.notSearched.map(({ candidate, reason }) => (
                  <li key={candidate.key}><strong>{candidate.name}</strong>: {reason}</li>
                ))}
              </ul>
            )}
            <table className="bio-table" aria-label="Binding sites found">
              <thead>
                <tr>
                  <th>Add</th>
                  <th>Primer</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Strand</th>
                  <th>Position</th>
                  <th>Mismatches</th>
                  <th>Effective Tm</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {search.occurrences.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      {searchedNames.length
                        ? `No binding site was found for ${searchedNames.join(', ')} within ${num(v.maxMismatches)} mismatches.`
                        : 'No chosen primer was searched.'}
                    </td>
                  </tr>
                ) : (
                  search.occurrences.map((o) => (
                    <tr key={o.key} data-occurrence={o.key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Add ${o.candidate.name} at ${o.bindStart}..${o.bindEnd} on ${o.targetName}`}
                          checked={!excluded.has(o.key)}
                          onChange={(e) => set('excluded', toggleIn(v.excluded, o.key, !e.target.checked))}
                        />
                      </td>
                      <td>{o.candidate.name}</td>
                      <td>{o.candidate.sourceLabel}</td>
                      <td>{o.targetName}</td>
                      <td>{strandText(o)}</td>
                      <td>{o.bindStart}..{o.bindEnd}</td>
                      <td>{o.mismatches}</td>
                      <td>{o.effectiveTmC === null ? `n/a: ${o.tmUnavailableReason}` : `${o.effectiveTmC.toFixed(1)} °C`}</td>
                      <td>{`≤ ${o.conditions.maxMismatches} mismatches, exact 3' clamp of ${o.conditions.clamp3PrimeBases}`}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        );
      }}
      onRun={(v) => {
        const { targets, selected } = bindingSearchFor(v, database.candidates, targetsAvailable);
        const updated = addPrimerBindings(targets, selected, new Date().toISOString(), () => stampId('pdb'));
        if (!updated.length) throw new Error('No binding site is ticked to add.');
        onAdd(updated, `Added ${selected.length} primer binding site${selected.length === 1 ? '' : 's'} from the Primer Database to ${updated.length} document${updated.length === 1 ? '' : 's'}`);
      }}
      onClose={onClose}
    />
  );
};

export interface TrimEndsDialogProps {
  reads: SequenceDocument[];
  folder?: string;
  onApply: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const TrimEndsDialog: React.FC<TrimEndsDialogProps> = ({ reads, folder, onApply, onClose, onDownload }) => {
  const nuc = reads.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
  const traces = nuc.filter((d) => d.chromatogram?.phredScores?.length).length;
  return (
    <OperationDialog
      operationId="trim-ends"
      title="Trim Ends…"
      runLabel="Trim"
      defaults={{ minQuality: 20, trimAdapters: true, trimLowComplexity: true, action: 'annotate', minLength: 50 }}
      onDownload={onDownload}
      summary={<span><strong>{nuc.length}</strong> read{nuc.length === 1 ? '' : 's'} selected · {traces} with base qualities</span>}
      validate={() => (nuc.length ? null : 'Select the reads (nucleotide sequences or traces) to trim.')}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Base quality:" htmlFor="opdlg-tr-q" hint="Low-quality ends are trimmed back to the first base at or above this Phred score (reads without qualities skip this test).">
            <div className="prefs-row">
              <span>Q ≥</span>
              <input id="opdlg-tr-q" type="number" min={0} max={60} style={{ width: 70 }} value={num(v.minQuality)} onChange={(e) => set('minQuality', Math.round(Number(e.target.value)))} />
            </div>
          </OptionRow>
          <OptionRow label="Also trim:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.trimAdapters)} onChange={(e) => set('trimAdapters', e.target.checked)} />
              <span>Adapter and vector sequence (built-in k-mer library)</span>
            </label>
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.trimLowComplexity)} onChange={(e) => set('trimLowComplexity', e.target.checked)} />
              <span>Low-complexity ends (poly-N, homopolymer runs)</span>
            </label>
          </OptionRow>
          <OptionRow label="Result:" htmlFor="opdlg-tr-action" hint={v.action === 'copy' ? 'Trimmed copies are plain sequences (the trace is not copied).' : 'The reads keep all bases; the trimmed ends are annotated as "Trimmed".'}>
            <select id="opdlg-tr-action" value={String(v.action)} onChange={(e) => set('action', e.target.value)}>
              <option value="annotate">Annotate trimmed regions on the reads</option>
              <option value="copy">Create trimmed copies</option>
            </select>
          </OptionRow>
          {v.action === 'copy' && (
            <OptionRow label="Discard reads shorter than:" htmlFor="opdlg-tr-min">
              <div className="prefs-row">
                <input id="opdlg-tr-min" type="number" min={0} style={{ width: 80 }} value={num(v.minLength)} onChange={(e) => set('minLength', Math.max(0, Math.round(Number(e.target.value))))} />
                <span>bp after trimming</span>
              </div>
            </OptionRow>
          )}
        </>
      )}
      onRun={(v) => onApply(runTrimEnds(nuc, v, { sourceLabel: 'reads', folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Back-Translate ─────────────────────────────

export interface BackTranslateDialogProps {
  proteins: SequenceDocument[];
  folder?: string;
  onCreate: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const BackTranslateDialog: React.FC<BackTranslateDialogProps> = ({ proteins, folder, onCreate, onClose, onDownload }) => {
  const prots = proteins.filter((d) => d.moleculeType === 'Protein' && d.sequence.length > 0);
  return (
    <OperationDialog
      operationId="back-translate"
      title="Back-Translate…"
      runLabel="Back-Translate"
      defaults={{ mode: 'likely', host: 'ecoli', geneticCode: GENETIC_CODE_NAMES[0], addStop: false }}
      onDownload={onDownload}
      summary={<span><strong>{prots.length}</strong> protein sequence{prots.length === 1 ? '' : 's'} selected</span>}
      validate={() => (prots.length ? null : 'Select one or more protein sequences.')}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Codons:" htmlFor="opdlg-bt-mode" hint={v.mode === 'ambiguous'
            ? 'Each residue becomes one IUPAC-degenerate codon covering all its codons (useful for degenerate probes and primers).'
            : 'Each residue gets the most frequently used codon in the chosen organism (Kazusa codon usage).'}>
            <select id="opdlg-bt-mode" value={String(v.mode)} onChange={(e) => set('mode', e.target.value)}>
              <option value="likely">Most likely codons for an organism</option>
              <option value="ambiguous">Ambiguous (IUPAC) codons</option>
            </select>
          </OptionRow>
          {v.mode === 'ambiguous' ? (
            <OptionRow label="Genetic code:" htmlFor="opdlg-bt-code">
              <select id="opdlg-bt-code" value={String(v.geneticCode)} onChange={(e) => set('geneticCode', e.target.value)}>
                {GENETIC_CODE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </OptionRow>
          ) : (
            <OptionRow label="Organism:" htmlFor="opdlg-bt-host">
              <select id="opdlg-bt-host" value={String(v.host)} onChange={(e) => set('host', e.target.value)}>
                {BACK_TRANSLATION_HOSTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </OptionRow>
          )}
          {v.mode !== 'ambiguous' && (
            <OptionRow label="Stop codon:">
              <label className="mbc-check-row">
                <input type="checkbox" checked={Boolean(v.addStop)} onChange={(e) => set('addStop', e.target.checked)} />
                <span>Add a stop codon when the protein has none</span>
              </label>
            </OptionRow>
          )}
        </>
      )}
      onRun={(v) => onCreate(runBackTranslate(prots, v, { sourceLabel: 'proteins', folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Merge Paired Reads ─────────────────────────────

export interface MergePairsDialogProps {
  reads: SequenceDocument[];
  folder?: string;
  onCreate: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const MergePairsDialog: React.FC<MergePairsDialogProps> = ({ reads, folder, onCreate, onClose, onDownload }) => {
  const nuc = reads.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
  const paired = nuc.filter((d) => mateOf(d.name)).length;
  return (
    <OperationDialog
      operationId="merge-pairs"
      title="Merge Paired Reads…"
      runLabel="Merge"
      defaults={{ minOverlap: 20, maxMismatchPct: 10 }}
      onDownload={onDownload}
      summary={<span><strong>{nuc.length}</strong> reads selected · {paired} named as mates (_R1/_R2, _1/_2, /1 /2 or -F/-R)</span>}
      validate={() => (paired < 2 ? 'Select read pairs whose names end in _R1/_R2, _1/_2, /1 /2 or -F/-R.' : null)}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Minimum overlap:" htmlFor="opdlg-mp-ov" hint="Read 1 is overlapped with the reverse complement of read 2; the longest overlap that passes is used.">
            <div className="prefs-row">
              <input id="opdlg-mp-ov" type="number" min={10} max={500} style={{ width: 80 }} value={num(v.minOverlap)} onChange={(e) => set('minOverlap', Math.round(Number(e.target.value)))} />
              <span>bp</span>
            </div>
          </OptionRow>
          <OptionRow label="Mismatches allowed:" htmlFor="opdlg-mp-mm" hint="Where mates disagree, the base with the higher quality is kept (read 1's base when there are no qualities).">
            <div className="prefs-row">
              <span>≤</span>
              <input id="opdlg-mp-mm" type="number" min={0} max={30} style={{ width: 70 }} value={num(v.maxMismatchPct)} onChange={(e) => set('maxMismatchPct', Number(e.target.value))} />
              <span>% of the overlap</span>
            </div>
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runMergePairedReads(nuc, v, { sourceLabel: 'reads', folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Compare Annotations ─────────────────────────────

export interface CompareAnnotationsDialogProps {
  inputs: SequenceDocument[];
  onCreate: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const CompareAnnotationsDialog: React.FC<CompareAnnotationsDialogProps> = ({ inputs, onCreate, onClose, onDownload }) => {
  const docs = inputs.filter((d) => d.features.length > 0 || d.sequence.length > 0);
  return (
    <OperationDialog
      operationId="compare-annotations"
      title="Compare Annotations…"
      runLabel="Compare"
      transientKeys={['firstId', 'secondId']}
      defaults={{ firstId: docs[0]?.id ?? '', secondId: docs[1]?.id ?? '', minOverlap: 50 }}
      onDownload={onDownload}
      summary={<span>Compares the annotations of two sequences that share coordinates (e.g. two annotations of one genome).</span>}
      validate={(v) => {
        if (docs.length < 2) return 'Select the two annotated sequences to compare.';
        if (v.firstId === v.secondId) return 'Choose two different documents.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          {(['firstId', 'secondId'] as const).map((k, i) => (
            <OptionRow key={k} label={i === 0 ? 'First:' : 'Second:'} htmlFor={`opdlg-ca-${k}`}>
              <select id={`opdlg-ca-${k}`} value={String(v[k])} onChange={(e) => set(k, e.target.value)}>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.features.length} annotations)</option>)}
              </select>
            </OptionRow>
          ))}
          <OptionRow label="Overlapping when:" htmlFor="opdlg-ca-ov" hint="Features of the same type that are not identical but overlap this much (of the longer one) are reported as overlapping.">
            <div className="prefs-row">
              <span>≥</span>
              <input id="opdlg-ca-ov" type="number" min={1} max={100} style={{ width: 70 }} value={num(v.minOverlap)} onChange={(e) => set('minOverlap', Number(e.target.value))} />
              <span>% overlap</span>
            </div>
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const a = docs.find((d) => d.id === v.firstId)!;
        const b = docs.find((d) => d.id === v.secondId)!;
        onCreate(runCompareAnnotations(a, b, v));
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Read QC Report ─────────────────────────────

export interface ReadQcDialogProps {
  reads: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  onCreate: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const ReadQcDialog: React.FC<ReadQcDialogProps> = ({ reads, sourceLabel, folder, onCreate, onClose, onDownload }) => {
  const nuc = reads.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
  return (
    <OperationDialog
      operationId="read-qc"
      title="Read QC Report…"
      runLabel="Create Report"
      transientKeys={['resultName']}
      defaults={{ binSize: 10, resultName: '' }}
      onDownload={onDownload}
      summary={<span><strong>{nuc.length}</strong> reads · {nuc.filter((d) => d.chromatogram?.phredScores?.length).length} with base qualities</span>}
      validate={() => (nuc.length ? null : 'Select the reads (or a folder of reads) to report on.')}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Report:" hint="Basic statistics, per-base and per-read quality, N content, GC content, length distribution, duplication, overrepresented sequences and adapter content, each marked PASS / WARN / FAIL with FastQC's default thresholds.">
            <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>Saved as a text document you can read, edit or export.</span>
          </OptionRow>
          <OptionRow label="Quality bins:" htmlFor="opdlg-qc-bin">
            <div className="prefs-row">
              <input id="opdlg-qc-bin" type="number" min={1} max={100} style={{ width: 70 }} value={num(v.binSize)} onChange={(e) => set('binSize', Math.max(1, Math.round(Number(e.target.value))))} />
              <span>bases per row</span>
            </div>
          </OptionRow>
          <OptionRow label="Report name:" htmlFor="opdlg-qc-name">
            <input id="opdlg-qc-name" type="text" value={String(v.resultName)} placeholder={`QC report: ${sourceLabel}`} onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runReadQcReport(nuc, v, { sourceLabel, folder }))}
      onClose={onClose}
    />
  );
};
