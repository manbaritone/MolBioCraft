// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 *   Primers → Test with Saved Primers…   (binding sites added as primers)
 *   Sequence → Trim Ends…                 (Trimmed annotations, or trimmed copies)
 */

import React, { useState } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { BACK_TRANSLATION_HOSTS, runBackTranslate, runCompareAnnotations, runMergePairedReads, runReadQcReport, runTestSavedPrimers, runTrimEnds, type OperationResult } from '../core/operationRunners';
import { mateOf } from '../core/annotationReadTools';
import { GENETIC_CODE_NAMES } from '../core/alignmentViewModel';
import type { SequenceDocument } from '../types/bio';

const num = (v: string | number | boolean) => Number(v);

export interface TestSavedPrimersDialogProps {
  targets: SequenceDocument[];
  primerDocs: SequenceDocument[];
  onApply: (result: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const TestSavedPrimersDialog: React.FC<TestSavedPrimersDialogProps> = ({ targets, primerDocs, onApply, onClose, onDownload }) => {
  const [filter, setFilter] = useState('');
  const dna = targets.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length >= 12 && d.documentKind !== 'primer');
  const parse = (v: string | number | boolean) => String(v).split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <OperationDialog
      operationId="test-saved-primers"
      title="Test with Saved Primers…"
      runLabel="Test"
      defaults={{ primerNames: '', maxMismatches: 1, replace: true }}
      onDownload={onDownload}
      summary={<span><strong>{dna.length}</strong> target sequence{dna.length === 1 ? '' : 's'} · {primerDocs.length} primer documents in the project</span>}
      validate={(v) => {
        if (!dna.length) return 'Select the nucleotide sequences to test (primer documents themselves are not targets).';
        if (!primerDocs.length) return 'This project has no primer documents (add some to the Primers folder).';
        const chosen = parse(v.primerNames);
        if (chosen.length && !primerDocs.some((p) => chosen.includes(p.name))) return 'None of the chosen primers are in this project.';
        return null;
      }}
      renderOptions={(v, set) => {
        const chosen = new Set(parse(v.primerNames));
        const all = chosen.size === 0;
        const shown = primerDocs.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
        const toggle = (name: string, on: boolean) => {
          const base = all ? new Set(primerDocs.map((p) => p.name)) : new Set(chosen);
          if (on) base.add(name); else base.delete(name);
          set('primerNames', base.size === primerDocs.length ? '' : Array.from(base).join(','));
        };
        return (
          <>
            <OptionRow label="Primers:" hint={all ? `All ${primerDocs.length} primers are tested.` : `${chosen.size} of ${primerDocs.length} primers selected.`}>
              <input type="text" placeholder="Filter primers" aria-label="Filter primers" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="mbc-opdlg-checklist" role="group" aria-label="Primers to test">
                {shown.map((p) => (
                  <label key={p.id} className="mbc-check-row">
                    <input type="checkbox" checked={all || chosen.has(p.name)} onChange={(e) => toggle(p.name, e.target.checked)} />
                    <span>{p.name}</span>
                    <span className="mbc-opdlg-muted">{p.sequence.length} nt</span>
                  </label>
                ))}
              </div>
            </OptionRow>
            <OptionRow label="Allow mismatches:" htmlFor="opdlg-sp-mm" hint="Mismatches are allowed only outside the 3′-end clamp (the last 5 bases must match).">
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
      onRun={(v) => onApply(runTestSavedPrimers(dna, primerDocs, v))}
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
