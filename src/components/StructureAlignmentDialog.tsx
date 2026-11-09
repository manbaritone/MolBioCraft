// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Align Structures… window (US-01M6PBTA, after RCSB's "Pairwise Structure Alignment"):
 * choose two structure documents and a chain of each, align them by structure (TM-align-style)
 * or by sequence, read RMSD, TM-score, identity and equivalent residues, and export the
 * structure-based sequence alignment as FASTA and the superposition as a JSON 4x4 matrix.
 * The work is done by `runStructureAlignment` and `src/core/structureAlignment.ts`; this window
 * only collects the choices and shows the result.
 */

import React, { useMemo, useState } from 'react';
import { Braces, FileText, Loader2, Play, Plus } from 'lucide-react';
import { StaticModalDialog } from './MenusPreferencesAndBlastModal';
import { OptionRow } from './OperationDialog';
import { runStructureAlignment, structureChainOf, structureEntryOf, type OperationResult } from '../core/operationRunners';
import {
  chainProblem, MIN_ALIGNABLE_RESIDUES, recordName, STRUCTURE_ALIGNMENT_METHODS, structureAlignmentFasta, structureAlignmentFileName,
  structureAlignmentMatrixJson, structureChains, type StructureAlignment, type StructureAlignmentMethod, type StructureChainInfo,
} from '../core/structureAlignment';
import { hasStructure, structureTextOf } from '../core/structureModels';
import type { SequenceDocument } from '../types/bio';

export interface StructureAlignmentDialogProps {
  /** Workbench documents; those holding a structure file are offered. */
  documents: SequenceDocument[];
  /** Documents chosen first for structure A and structure B (e.g. the selection). */
  initialA?: string;
  initialB?: string;
  folder?: string;
  /** Adds the alignment document the run created to the workbench. */
  onCreate: (result: OperationResult) => void;
  /** The app's file-save route (desktop save dialog or browser download). */
  onDownload: (content: string, fileName: string, mime: string) => void;
  onClose: () => void;
}

/** The chains of a document's structure, or the reader's reason when it cannot be read. */
function readChains(doc: SequenceDocument | undefined): { chains: StructureChainInfo[]; error: string | null } {
  if (!doc) return { chains: [], error: null };
  try {
    return { chains: structureChains(structureTextOf(doc)), error: null };
  } catch (e) {
    return { chains: [], error: `${doc.name} cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A chain as the chain list shows it, with the reason it cannot be aligned. */
export function chainOptionLabel(c: StructureChainInfo): string {
  const id = c.authorId === c.id ? c.id : `${c.id} [auth ${c.authorId}]`;
  if (c.caResidues === 0) return `${id} (no Cα coordinates)`;
  const n = `${c.caResidues} residue${c.caResidues === 1 ? '' : 's'} with Cα`;
  return c.caResidues < MIN_ALIGNABLE_RESIDUES ? `${id} (${n}: fewer than ${MIN_ALIGNABLE_RESIDUES})` : `${id} (${n})`;
}

/** The numbers of one alignment, as a table. */
export const StructureAlignmentResults: React.FC<{ alignment: StructureAlignment }> = ({ alignment: al }) => {
  const rows: [string, React.ReactNode, string?][] = [
    ['Structure A (reference)', recordName(al.a), `${al.a.residues} residues`],
    ['Structure B (superposed)', recordName(al.b), `${al.b.residues} residues`],
    ['RMSD', `${al.rmsdAngstrom.toFixed(2)} Å`, al.method === 'tm' ? 'over the equivalent residues, after their own best fit' : 'over the equivalent residues, under the saved matrix'],
    ...al.tmScores.map((s): [string, React.ReactNode, string] => [s.name, s.value.toFixed(3), s.detail]),
    ['Sequence identity', `${(al.sequenceIdentity * 100).toFixed(1)}%`, 'of the equivalent residues'],
    ['Equivalent residues', String(al.equivalentResidues), 'residue pairs in the alignment'],
  ];
  return (
    <div className="mbc-opdlg-options" aria-label="Alignment results">
      <table className="mbc-mini-preview-table">
        <tbody>
          {rows.map(([k, v, note]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
              <td className="mbc-opdlg-hint">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mbc-opdlg-hint">{al.methodDescription}</div>
    </div>
  );
};

export const StructureAlignmentDialog: React.FC<StructureAlignmentDialogProps> = ({ documents, initialA, initialB, folder, onCreate, onDownload, onClose }) => {
  const structures = useMemo(() => documents.filter(hasStructure), [documents]);
  const pick = (id: string | undefined, fallback: number) => (structures.some((d) => d.id === id) ? id! : structures[fallback]?.id ?? '');
  const [aId, setAId] = useState(() => pick(initialA, 0));
  const [bId, setBId] = useState(() => pick(initialB, structures.length > 1 ? 1 : 0));
  const docA = structures.find((d) => d.id === aId);
  const docB = structures.find((d) => d.id === bId);
  const readA = useMemo(() => readChains(docA), [docA]);
  const readB = useMemo(() => readChains(docB), [docB]);
  // A chain picked from the list; '' until one is, meaning the document's own chain.
  const [pickedA, setChainA] = useState('');
  const [pickedB, setChainB] = useState('');
  const ownChain = (doc: SequenceDocument | undefined, chains: StructureChainInfo[]) => {
    const own = doc ? structureChainOf(doc) : '';
    return chains.find((c) => c.id === own)?.id ?? chains[0]?.id ?? '';
  };
  const chainA = pickedA || ownChain(docA, readA.chains);
  const chainB = pickedB || ownChain(docB, readB.chains);
  const [method, setMethod] = useState<StructureAlignmentMethod>('tm');
  const [result, setResult] = useState<(OperationResult & { alignment: StructureAlignment }) | null>(null);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const reset = () => { setResult(null); setAdded(false); setError(null); };
  const input = (doc: SequenceDocument | undefined, chain: string) => ({ text: doc ? structureTextOf(doc) : '', chain, entry: doc ? structureEntryOf(doc) : '' });
  const problem = !docA || !docB
    ? 'Open two structures (PDB or mmCIF) to align.'
    : readA.error ?? readB.error ?? chainProblem(input(docA, chainA), 'A', readA.chains) ?? chainProblem(input(docB, chainB), 'B', readB.chains);

  const align = async () => {
    if (problem || running || !docA || !docB) return;
    reset();
    setRunning(true);
    // Let React paint the running state before the synchronous engine blocks the thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      setResult(runStructureAlignment(docA, docB, { method, chainA, chainB }, { sourceLabel: `${docA.name} and ${docB.name}`, folder }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const docSelect = (which: 'A' | 'B', value: string, set: (id: string) => void, setChain: (c: string) => void) => (
    <select id={`opdlg-sa-doc-${which}`} value={value} onChange={(e) => {
      set(e.target.value);
      setChain('');
      reset();
    }}>
      {structures.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
  const chainSelect = (which: 'A' | 'B', chains: StructureChainInfo[], value: string, set: (c: string) => void) => (
    <select id={`opdlg-sa-chain-${which}`} value={value} onChange={(e) => { set(e.target.value); reset(); }}>
      {chains.map((c) => <option key={c.id} value={c.id}>{chainOptionLabel(c)}</option>)}
    </select>
  );
  const al = result?.alignment;

  return (
    <StaticModalDialog titleId="opdlg-structure-alignment" title="Align Structures…" sizeClass="modal-size-operation" onClose={onClose} closedBy="closerequest">
      <div className="mbc-opdlg-body">
        <div className="mbc-opdlg-summary">
          Superposes chain B onto chain A and reports RMSD, TM-score, sequence identity and equivalent residues, as RCSB's Pairwise Structure Alignment does.
          Chains need at least {MIN_ALIGNABLE_RESIDUES} residues with Cα coordinates.
        </div>
        <div className="mbc-opdlg-options">
          <OptionRow label="Structure A:" htmlFor="opdlg-sa-doc-A" hint="The reference: structure B is moved onto it.">
            {docSelect('A', aId, setAId, setChainA)}
          </OptionRow>
          <OptionRow label="Chain:" htmlFor="opdlg-sa-chain-A">{chainSelect('A', readA.chains, chainA, setChainA)}</OptionRow>
          <OptionRow label="Structure B:" htmlFor="opdlg-sa-doc-B">{docSelect('B', bId, setBId, setChainB)}</OptionRow>
          <OptionRow label="Chain:" htmlFor="opdlg-sa-chain-B">{chainSelect('B', readB.chains, chainB, setChainB)}</OptionRow>
          <OptionRow label="Align:" htmlFor="opdlg-sa-method" hint={STRUCTURE_ALIGNMENT_METHODS.find((m) => m.value === method)?.hint}>
            <select id="opdlg-sa-method" value={method} onChange={(e) => { setMethod(e.target.value as StructureAlignmentMethod); reset(); }}>
              {STRUCTURE_ALIGNMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </OptionRow>
        </div>
        {problem && <div className="info-callout" role="status">{problem}</div>}
        {error && <div className="info-callout" role="alert" style={{ color: 'var(--mbc-red)' }}>{error}</div>}
        {running && <div className="mbc-opdlg-progress" role="status"><Loader2 size={14} className="mbc-spin" /> Aligning…</div>}
        {al && <StructureAlignmentResults alignment={al} />}
      </div>
      <div className="prefs-modal-footer">
        <div className="prefs-row">
          <button type="button" className="btn-secondary-sm" disabled={!al}
            onClick={() => al && onDownload(structureAlignmentFasta(al), structureAlignmentFileName(al, 'fasta'), 'text/plain;charset=utf-8')}>
            <FileText size={14} /> Export FASTA
          </button>
          <button type="button" className="btn-secondary-sm" disabled={!al}
            onClick={() => al && onDownload(structureAlignmentMatrixJson(al), structureAlignmentFileName(al, 'matrix'), 'application/json')}>
            <Braces size={14} /> Save matrix (JSON)
          </button>
          <button type="button" className="btn-secondary-sm" disabled={!result || added}
            onClick={() => { if (result) { onCreate(result); setAdded(true); } }}>
            <Plus size={14} /> {added ? 'Alignment added' : 'Add alignment to workbench'}
          </button>
        </div>
        <div className="mbc-opdlg-footer-actions">
          <button type="button" className="btn-secondary-sm" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary-sm" disabled={!!problem || running} onClick={() => void align()} data-autofocus="true">
            <Play size={14} /> Align
          </button>
        </div>
      </div>
    </StaticModalDialog>
  );
};
