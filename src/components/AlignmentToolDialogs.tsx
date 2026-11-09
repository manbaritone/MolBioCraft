// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Options windows for alignment tools:
 *   Align → Translation Alignment…    (codon-preserving alignment document)
 *   Align → Mask Alignment…           (stripped copy, or Masked annotations)
 *   Align → Generate Consensus…       (consensus sequence document)
 */

import React from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { alignmentRowsOf, maskOptionsOf, runAddToAlignment, runConsensus, runMaskAlignment, runTranslationAlign } from '../core/operationRunners';
import { MSA_ALGORITHM_OPTIONS } from './AnalysisOperationDialogs';
import { columnsToMask, parseCharset } from '../core/alignmentTools';
import { computeAlignmentConsensusAndIdentity } from '../core/alignmentAnalysis';
import { GENETIC_CODE_NAMES } from '../core/alignmentViewModel';
import { alignmentInputError } from '../core/alignmentExecution';
import { MSA_MAX_RESIDUES } from '../core/bioEngine';
import type { OptionValues } from '../core/optionProfiles';
import type { SequenceDocument } from '../types/bio';

const num = (v: string | number | boolean) => Number(v);

export { alignmentRowsOf };


// ───────────────────────────── Translation Alignment ─────────────────────────────

export interface TranslationAlignDialogProps {
  inputs: SequenceDocument[];
  sourceLabel: string;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const TranslationAlignDialog: React.FC<TranslationAlignDialogProps> = ({ inputs, sourceLabel, onCreate, onClose, onDownload }) => (
  <OperationDialog
    operationId="translation-align"
    title="Translation Alignment…"
    runLabel="Align"
    transientKeys={['resultName']}
    defaults={{ frame: 1, geneticCode: GENETIC_CODE_NAMES[0], algorithm: '', resultName: '' }}
    onDownload={onDownload}
    summary={<span><strong>{inputs.length}</strong> sequence{inputs.length === 1 ? '' : 's'} from <strong>{sourceLabel}</strong></span>}
    validate={() => {
      if (inputs.length < 2) return 'Select at least two nucleotide sequences.';
      if (inputs.some((d) => d.moleculeType === 'Protein')) return 'Translation alignment needs nucleotide sequences (coding regions).';
      const longest = Math.max(...inputs.map((d) => d.sequence.length));
      if (longest / 3 > MSA_MAX_RESIDUES) return alignmentInputError(inputs, MSA_MAX_RESIDUES * 3);
      return null;
    }}
    renderOptions={(v, set) => (
      <>
        <OptionRow label="Translation frame:" htmlFor="opdlg-tr-frame" hint="The same frame is used for every sequence; bases before it are kept at the start of the row.">
          <select id="opdlg-tr-frame" value={num(v.frame)} onChange={(e) => set('frame', Number(e.target.value))}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </OptionRow>
        <OptionRow label="Genetic code:" htmlFor="opdlg-tr-code">
          <select id="opdlg-tr-code" value={String(v.geneticCode)} onChange={(e) => set('geneticCode', e.target.value)}>
            {GENETIC_CODE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </OptionRow>
        <OptionRow label="Protein alignment method:" htmlFor="opdlg-tr-algo">
          <select id="opdlg-tr-algo" value={String(v.algorithm)} onChange={(e) => set('algorithm', e.target.value)}>
            {MSA_ALGORITHM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </OptionRow>
        <OptionRow label="Result name:" htmlFor="opdlg-tr-name">
          <input id="opdlg-tr-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} translation alignment`} onChange={(e) => set('resultName', e.target.value)} />
        </OptionRow>
      </>
    )}
    onRun={(v) => {
      onCreate(runTranslationAlign(inputs, v, { sourceLabel }).created[0]);
    }}
    onClose={onClose}
  />
);

// ───────────────────────────── Mask Alignment ─────────────────────────────

export interface MaskAlignmentDialogProps {
  doc: SequenceDocument;
  onCreate: (doc: SequenceDocument) => void;
  onUpdate: (doc: SequenceDocument, masked: number) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

const maskOpts = maskOptionsOf;

export const MaskAlignmentDialog: React.FC<MaskAlignmentDialogProps> = ({ doc, onCreate, onUpdate, onClose, onDownload }) => {
  const rows = alignmentRowsOf(doc);
  const isProtein = doc.moleculeType === 'Protein';
  const selected = (v: OptionValues) => (rows ? columnsToMask(rows.map((r) => r.sequence), isProtein, maskOpts(v)) : new Set<number>());
  return (
    <OperationDialog
      operationId="mask-alignment"
      title="Mask Alignment…"
      runLabel="OK"
      defaults={{ content: 'all-gaps', gapPct: 50, codon1: false, codon2: false, codon3: false, charset: '', action: 'strip' }}
      onDownload={onDownload}
      summary={rows
        ? <span><strong>{doc.name}</strong> · {rows.length} sequences × {rows[0].sequence.length.toLocaleString()} columns</span>
        : <span>Open an aligned document first.</span>}
      validate={(v) => {
        if (!rows) return 'Mask Alignment works on an aligned document (open one in the viewer).';
        if (String(v.charset).trim()) {
          try { parseCharset(String(v.charset), rows[0].sequence.length); } catch (e) { return e instanceof Error ? e.message : String(e); }
        }
        const n = selected(v).size;
        if (n === 0) return 'These settings select no columns.';
        if (v.action === 'strip' && n >= rows[0].sequence.length) return 'This would remove every column.';
        return null;
      }}
      renderOptions={(v, set) => {
        let count = 0;
        try { count = selected(v).size; } catch { count = 0; }
        return (
          <>
            <OptionRow label="Sites by content:" htmlFor="opdlg-mk-content">
              <div className="prefs-row">
                <select id="opdlg-mk-content" value={String(v.content)} onChange={(e) => set('content', e.target.value)}>
                  <option value="none">None</option>
                  <option value="all-gaps">All gaps</option>
                  <option value="any-gaps">Any gaps</option>
                  <option value="gap-pct">Gaps (%)</option>
                  <option value="identical">Identical residues (constant sites)</option>
                  <option value="ambiguities">Ambiguities</option>
                </select>
                {v.content === 'gap-pct' && (
                  <>
                    <span>≥</span>
                    <input aria-label="Gap percentage" type="number" min={1} max={100} style={{ width: 70 }} value={num(v.gapPct)} onChange={(e) => set('gapPct', Number(e.target.value))} />
                    <span>%</span>
                  </>
                )}
              </div>
            </OptionRow>
            {!isProtein && (
              <OptionRow label="Codon positions:" hint="Counted from the first alignment column, regardless of annotations.">
                <div className="prefs-row">
                  {(['codon1', 'codon2', 'codon3'] as const).map((k, i) => (
                    <label key={k} className="mbc-check-row">
                      <input type="checkbox" checked={Boolean(v[k])} onChange={(e) => set(k, e.target.checked)} />
                      <span>{i + 1}{['st', 'nd', 'rd'][i]}</span>
                    </label>
                  ))}
                </div>
              </OptionRow>
            )}
            <OptionRow label="Result:" htmlFor="opdlg-mk-action" hint={`${count.toLocaleString()} column${count === 1 ? '' : 's'} selected.`}>
              <select id="opdlg-mk-action" value={String(v.action)} onChange={(e) => set('action', e.target.value)}>
                <option value="strip">Create a copy with these columns removed</option>
                <option value="annotate">Add "Masked" annotations to this alignment</option>
              </select>
            </OptionRow>
          </>
        );
      }}
      renderMoreOptions={(v, set) => (
        <OptionRow label="NEXUS CHARSET:" htmlFor="opdlg-mk-charset" hint={'Also mask these sites, e.g. "2 4-6 10-.\\3" or a 0/1 vector.'}>
          <input id="opdlg-mk-charset" type="text" value={String(v.charset)} onChange={(e) => set('charset', e.target.value)} />
        </OptionRow>
      )}
      onRun={(v) => {
        const r = runMaskAlignment(doc, v, { sourceLabel: doc.name });
        if (r.created[0]) onCreate(r.created[0]);
        else onUpdate(r.updated[0], selected(v).size);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Generate Consensus ─────────────────────────────

export const CONSENSUS_THRESHOLDS = ['Majority', '50%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];

export interface ConsensusDialogProps {
  doc: SequenceDocument;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const ConsensusDialog: React.FC<ConsensusDialogProps> = ({ doc, onCreate, onClose, onDownload }) => {
  const rows = alignmentRowsOf(doc);
  const isProtein = doc.moleculeType === 'Protein';
  const build = (v: OptionValues) => {
    const c = computeAlignmentConsensusAndIdentity(rows!, String(v.threshold), Boolean(v.ignoreGaps), isProtein).consensus;
    return v.stripGaps ? c.replace(/-/g, '') : c;
  };
  return (
    <OperationDialog
      operationId="generate-consensus"
      title="Generate Consensus Sequence…"
      runLabel="OK"
      transientKeys={['resultName']}
      defaults={{ threshold: 'Majority', ignoreGaps: true, stripGaps: true, resultName: '' }}
      onDownload={onDownload}
      summary={rows
        ? <span><strong>{doc.name}</strong> · {rows.length} sequences × {rows[0].sequence.length.toLocaleString()} columns</span>
        : <span>Open an aligned document first.</span>}
      validate={(v) => {
        if (!rows) return 'Generate Consensus works on an aligned document (open one in the viewer).';
        return build(v).replace(/-/g, '') ? null : 'The consensus would be empty.';
      }}
      renderOptions={(v, set) => {
        const preview = rows ? build(v) : '';
        return (
          <>
            <OptionRow label="Threshold:" htmlFor="opdlg-cs-thr" hint="Majority: most common residue (ties → ambiguity). A percentage adds residues until that share is reached; several residues give an IUPAC ambiguity (X for proteins).">
              <select id="opdlg-cs-thr" value={String(v.threshold)} onChange={(e) => set('threshold', e.target.value)}>
                {CONSENSUS_THRESHOLDS.map((t) => <option key={t} value={t}>{t === 'Majority' ? 'Majority (most common)' : t}</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Gaps:">
              <label className="mbc-check-row">
                <input type="checkbox" checked={Boolean(v.ignoreGaps)} onChange={(e) => set('ignoreGaps', e.target.checked)} />
                <span>Ignore gaps when calling each column</span>
              </label>
              <label className="mbc-check-row">
                <input type="checkbox" checked={Boolean(v.stripGaps)} onChange={(e) => set('stripGaps', e.target.checked)} />
                <span>Remove gap characters from the result</span>
              </label>
            </OptionRow>
            <OptionRow label="Preview:">
              <code className="mbc-opdlg-muted" style={{ wordBreak: 'break-all' }}>{preview.slice(0, 120)}{preview.length > 120 ? '…' : ''} ({preview.length.toLocaleString()} residues)</code>
            </OptionRow>
            <OptionRow label="Result name:" htmlFor="opdlg-cs-name">
              <input id="opdlg-cs-name" type="text" value={String(v.resultName)} placeholder={`${doc.name} consensus`} onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        onCreate(runConsensus(doc, v, { sourceLabel: doc.name }).created[0]);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Add Sequences to Alignment ─────────────────────────────

export interface AddToAlignmentDialogProps {
  /** Selected documents: one aligned document and the sequences to add. */
  inputs: SequenceDocument[];
  activeDoc: SequenceDocument;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const AddToAlignmentDialog: React.FC<AddToAlignmentDialogProps> = ({ inputs, activeDoc, onCreate, onClose, onDownload }) => {
  const pool = inputs.some((d) => d.id === activeDoc.id) || !activeDoc.id ? inputs : [activeDoc, ...inputs];
  const alignments = pool.filter((d) => alignmentRowsOf(d));
  const defaultTarget = (alignmentRowsOf(activeDoc) ? activeDoc.id : alignments[0]?.id) ?? '';
  const additionsFor = (id: string) => pool.filter((d) => d.id !== id && !alignmentRowsOf(d) && d.sequence.length > 0);
  return (
    <OperationDialog
      operationId="add-to-alignment"
      title="Add Sequences to Alignment…"
      runLabel="Add"
      transientKeys={['targetId', 'resultName']}
      defaults={{ targetId: defaultTarget, resultName: '' }}
      onDownload={onDownload}
      summary={<span>Aligns new sequences to an existing alignment without re-aligning it.</span>}
      validate={(v) => {
        const target = alignments.find((d) => d.id === v.targetId);
        if (!target) return 'Select an aligned document together with the sequences to add.';
        if (!additionsFor(target.id).length) return 'Select the sequences to add (they must not be alignments themselves).';
        return null;
      }}
      renderOptions={(v, set) => {
        const adds = additionsFor(String(v.targetId));
        return (
          <>
            <OptionRow label="Add to:" htmlFor="opdlg-add-target" hint="Each new sequence is aligned to the alignment's consensus; insertions open new gap columns in every row.">
              <select id="opdlg-add-target" value={String(v.targetId)} onChange={(e) => set('targetId', e.target.value)}>
                {alignments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.alignmentMeta?.sequences?.length} sequences)</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Sequences to add:">
              <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>{adds.length ? adds.map((d) => d.name).join(', ') : 'none selected'}</span>
            </OptionRow>
            <OptionRow label="Result name:" htmlFor="opdlg-add-name">
              <input id="opdlg-add-name" type="text" value={String(v.resultName)} placeholder={`${alignments.find((d) => d.id === v.targetId)?.name ?? 'Alignment'} + ${adds.length}`} onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        const target = alignments.find((d) => d.id === v.targetId)!;
        onCreate(runAddToAlignment(target, additionsFor(target.id), v, { sourceLabel: target.name }).created[0]);
      }}
      onClose={onClose}
    />
  );
};
