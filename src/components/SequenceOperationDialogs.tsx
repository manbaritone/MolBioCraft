// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Options windows for single-sequence operations:
 *   Align   → Pairwise Alignment…      (two-member alignment document)
 *   Enzymes → Digest into Fragments…   (one document per fragment, annotations kept)
 *   Primers → Design Primers…          (primers added to the sequence, optional PCR product)
 */

import React, { useMemo, useState } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { featuresWithin, runDigest, withWarningNotes } from '../core/operationRunners';
import { alignmentInputError } from '../core/alignmentExecution';
import { alignPairwiseTypeScript, CUSTOM_ENZYME_NO_LONGER_STORED, designPCRPrimers, enzymeLabel, scanRestrictionSites } from '../core/bioEngine';
import { customEnzymeCount, primerTmText, restrictionScanEnzymes, restrictionScanScope, restrictionScopeWords } from './CircularPlasmidMap';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { OptionValues } from '../core/optionProfiles';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** The interactive affine-gap pairwise engine's per-sequence limit. */
export const PAIRWISE_MAX_RESIDUES = 2400;

// ───────────────────────────── Pairwise Alignment ─────────────────────────────

export interface PairwiseOperationDialogProps {
  inputs: SequenceDocument[];
  folder?: string;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const PairwiseOperationDialog: React.FC<PairwiseOperationDialogProps> = ({ inputs, folder, onCreate, onClose, onDownload }) => {
  const protein = inputs[0]?.moleculeType === 'Protein';
  const defaults: OptionValues = {
    mode: 'global',
    matchScore: 2,
    mismatch: -3,
    gapOpen: protein ? -10 : -5,
    gapExtend: protein ? -1 : -2,
    matrix: 'blosum62',
    resultName: inputs.length === 2 ? `${inputs[0].name} vs ${inputs[1].name}` : '',
  };
  const num = (v: string | number | boolean) => Number(v);
  return (
    <OperationDialog
      operationId="align-pairwise"
      title="Pairwise Alignment…"
      runLabel="Align"
      transientKeys={['resultName']}
      defaults={defaults}
      onDownload={onDownload}
      summary={inputs.length === 2
        ? <span><strong>{inputs[0].name}</strong> ({inputs[0].sequence.length.toLocaleString()}) vs <strong>{inputs[1].name}</strong> ({inputs[1].sequence.length.toLocaleString()} {protein ? 'aa' : 'nt'})</span>
        : <span>{inputs.length} sequence{inputs.length === 1 ? '' : 's'} selected</span>}
      validate={(v) => {
        if (inputs.length !== 2) return 'Select exactly two sequences for a pairwise alignment.';
        const types = new Set(inputs.map((d) => (d.moleculeType === 'RNA' ? 'DNA' : d.moleculeType)));
        if (types.size > 1) return 'Both sequences must be nucleotide, or both protein.';
        if (num(v.gapOpen) > 0 || num(v.gapExtend) > 0) return 'Gap penalties must be zero or negative.';
        return alignmentInputError(inputs, PAIRWISE_MAX_RESIDUES);
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Alignment type:" htmlFor="opdlg-pw-mode"
            hint={v.mode === 'local' ? 'Smith–Waterman: the best-scoring local region only.' : 'Needleman–Wunsch with affine gaps: end to end.'}>
            <select id="opdlg-pw-mode" value={String(v.mode)} onChange={(e) => set('mode', e.target.value)}>
              <option value="global">Global (end to end)</option>
              <option value="local">Local (best matching region)</option>
            </select>
          </OptionRow>
          {protein ? (
            <OptionRow label="Scoring matrix:" htmlFor="opdlg-pw-matrix">
              <select id="opdlg-pw-matrix" value={String(v.matrix)} onChange={(e) => set('matrix', e.target.value)}>
                <option value="blosum62">BLOSUM62</option>
                <option value="pam250">PAM250</option>
              </select>
            </OptionRow>
          ) : (
            <OptionRow label="Match / mismatch:">
              <div className="prefs-row">
                <input aria-label="Match score" type="number" style={{ width: 70 }} value={num(v.matchScore)} min={1} max={10}
                  onChange={(e) => set('matchScore', Number(e.target.value) || 1)} />
                <input aria-label="Mismatch score" type="number" style={{ width: 70 }} value={num(v.mismatch)} min={-10} max={0}
                  onChange={(e) => set('mismatch', Number(e.target.value))} />
              </div>
            </OptionRow>
          )}
          <OptionRow label="Gap open / extend:">
            <div className="prefs-row">
              <input aria-label="Gap open penalty" type="number" style={{ width: 70 }} value={num(v.gapOpen)} max={0}
                onChange={(e) => set('gapOpen', Number(e.target.value))} />
              <input aria-label="Gap extension penalty" type="number" style={{ width: 70 }} value={num(v.gapExtend)} max={0}
                onChange={(e) => set('gapExtend', Number(e.target.value))} />
            </div>
          </OptionRow>
          <OptionRow label="Result name:" htmlFor="opdlg-pw-name">
            <input id="opdlg-pw-name" type="text" value={String(v.resultName)} onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const [a, b] = inputs;
        const r = alignPairwiseTypeScript(a.sequence, b.sequence, v.mode === 'local', num(v.matchScore), num(v.mismatch),
          num(v.gapOpen), num(v.gapExtend), a.moleculeType, v.matrix === 'pam250' ? 'pam250' : 'blosum62');
        if (!r.alignedSeq1) throw new Error('No alignment was produced (the sequences share no scoring region).');
        const t = now();
        const id = uid('pw');
        const label = `${v.mode === 'local' ? 'Local (Smith–Waterman)' : 'Global (Needleman–Wunsch)'} pairwise, ${protein ? String(v.matrix).toUpperCase() : `match ${v.matchScore} / mismatch ${v.mismatch}`}, gaps ${v.gapOpen}/${v.gapExtend}`;
        const region = v.mode === 'local' && r.xstart ? ` (aligned region ${a.name} ${r.xstart}–${r.xend}, ${b.name} ${r.ystart}–${r.yend})` : '';
        // The engine's warnings end the Notes (D0005): a name replaced by its default, and the columns
        // pairing N or another ambiguity code, which identity does not count (US-01M6VF1T).
        onCreate(withWarningNotes({
          id,
          name: String(v.resultName).trim() || `${a.name} vs ${b.name}`,
          accession: '',
          description: `${label}${region}`,
          moleculeType: a.moleculeType,
          topology: 'linear',
          sequence: r.alignedSeq1,
          features: [],
          primers: [],
          documentKind: 'alignment',
          alignmentMeta: {
            sequenceCount: 2,
            isAligned: true,
            pairwiseIdentityPct: r.identityPct,
            sequences: [
              { id: `${id}-m1`, name: a.name, accession: a.accession || undefined, sequence: r.alignedSeq1 },
              { id: `${id}-m2`, name: b.name, accession: b.accession || undefined, sequence: r.alignedSeq2 },
            ],
          },
          docMetadata: {
            'Alignment method': label,
            Score: r.score,
            'Identity (%)': Number(r.identityPct.toFixed(2)),
            ...(r.similarityPct !== undefined ? { 'Similarity (%)': Number(r.similarityPct.toFixed(2)) } : {}),
            Gaps: r.gaps,
          },
          history: [{ id: uid('hist'), timestamp: t, operation: 'Pairwise Alignment', description: `${label}${region}; score ${r.score}, identity ${r.identityPct.toFixed(1)}%`, parentIds: [a.id, b.id], lengthBp: r.alignedSeq1.length, topology: 'linear' }],
          createdAt: t,
          updatedAt: t,
          folder: (folder ?? 'Alignments') as SequenceDocument['folder'],
        }, r.warnings));
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Digest into Fragments ─────────────────────────────

export { featuresWithin };

export interface DigestOperationDialogProps {
  doc: SequenceDocument;
  onCreate: (docs: SequenceDocument[]) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
  /**
   * The active enzyme list (US-01M7HRCD): the catalogue, then every stored custom definition. The
   * catalogue itself when not given, so the scan sends no list and the engine scans its own.
   */
  enzymes?: RestrictionEnzyme[];
}

export const DigestOperationDialog: React.FC<DigestOperationDialogProps> = ({ doc, onCreate, onClose, onDownload, enzymes = REBASE_ENZYMES }) => {
  const [filter, setFilter] = useState('');
  // Every choice is an enzyme's key (US-01M7HRCD): a built-in's is its name, a custom definition's
  // its `custom:` id, so a custom enzyme named like a built-in is its own row and its own choice.
  // A built-in is also found in the catalogue, which it never leaves.
  const enzymeByKey = useMemo(() => {
    const byKey = new Map<string, RestrictionEnzyme>();
    for (const e of [...REBASE_ENZYMES, ...enzymes]) byKey.set(e.id ?? e.name, e);
    return byKey;
  }, [enzymes]);
  /** A chosen key that names a custom definition the active list no longer holds: the run names it and refuses. */
  const goneCustom = (key: string) => key.startsWith('custom:') && !enzymeByKey.has(key);
  // Nothing here knows a gone definition's label, so it is never shown by its bare id.
  const labelOfKey = (key: string) => {
    const e = enzymeByKey.get(key);
    return e ? enzymeLabel(e) : goneCustom(key) ? CUSTOM_ENZYME_NO_LONGER_STORED : key;
  };
  // Each enzyme's cuts and blocked sites come from the scan's complete counts: it keeps only the
  // first positions of an enzyme that cuts very often, so counting kept positions would stop there
  // (BG-01M6S1K2).
  // Over 100,000 bp the scan is sent the core built-ins and every custom definition, as the maps'
  // is (the engine cuts to its core only when it is sent no list); the catalogue itself is sent as
  // no list (US-01M7HRCD).
  const cutters = useMemo(() => {
    if (doc.moleculeType === 'Protein' || !doc.sequence) return [];
    const scan = scanRestrictionSites(doc.sequence, doc.topology === 'circular' ? 'circular' : 'linear', restrictionScanEnzymes(enzymes, doc.sequence.length));
    return scan.siteCounts
      .filter((c) => c.sites > 0)
      .map((c) => {
        const e = enzymeByKey.get(c.enzymeId);
        return { key: c.enzymeId, name: e ? enzymeLabel(e) : c.enzyme, cuts: c.sites - c.methylationBlocked, blocked: c.methylationBlocked, site: e?.recognitionSeq ?? '' };
      })
      .sort((a, b) => a.cuts - b.cuts || a.name.localeCompare(b.name));
  }, [doc.sequence, doc.topology, doc.moleculeType, enzymes, enzymeByKey]);
  // The engine scans more than 100,000 bp with its core enzymes only (BG-01M6S1D2), and every custom
  // definition beside them, so the count names that scope in the words the map and Restriction
  // Analysis use.
  const scopeWords = doc.moleculeType === 'Protein' || !doc.sequence
    ? null
    : restrictionScopeWords(restrictionScanScope(doc.sequence.length, doc.sequence.length, customEnzymeCount(enzymes)), doc.sequence.length);
  const countLine = scopeWords
    ? `${cutters.length} enzymes cut this sequence ${scopeWords.once}; sorted by number of cuts. ${scopeWords.detail} Methylation-blocked sites are not cut.`
    : `${cutters.length} enzymes cut this sequence; sorted by number of cuts. Methylation-blocked sites are not cut.`;
  const parse = (v: string | number | boolean) => String(v).split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <OperationDialog
      operationId="digest-fragments"
      title="Digest into Fragments…"
      runLabel="Digest"
      defaults={{ enzymes: '', keepAnnotations: true }}
      onDownload={onDownload}
      summary={<span><strong>{doc.name}</strong> · {doc.sequence.length.toLocaleString()} bp, {doc.topology}</span>}
      validate={(v) => {
        if (doc.moleculeType === 'Protein' || !doc.sequence) return 'Digest needs a DNA sequence.';
        // A custom enzyme chosen earlier whose definition is no longer stored stays chosen, so the run
        // can refuse it by name; nothing else counts unless it cuts this sequence.
        const chosen = parse(v.enzymes).filter((k) => goneCustom(k) || cutters.some((c) => c.key === k && c.cuts > 0));
        if (chosen.length === 0) return 'Choose at least one enzyme that cuts this sequence.';
        return null;
      }}
      renderOptions={(v, set) => {
        const chosen = new Set(parse(v.enzymes));
        const shown = cutters.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
        const toggle = (key: string, on: boolean) => {
          const next = new Set(chosen);
          if (on) next.add(key); else next.delete(key);
          set('enzymes', Array.from(next).join(','));
        };
        // A chosen key no checklist row holds (a custom definition no longer stored, a name the
        // catalogue lacks, an enzyme that does not cut here) gets its own ticked entry, so it can be
        // unticked here rather than only by Reset to defaults (BG-01M7J3DP).
        const noRow = Array.from(chosen).filter((k) => !cutters.some((c) => c.key === k));
        return (
          <>
            <OptionRow label="Enzymes:" hint={countLine}>
              <input type="text" placeholder="Filter enzymes" aria-label="Filter enzymes" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="mbc-opdlg-checklist" role="group" aria-label="Enzymes to digest with">
                {shown.map((c) => (
                  <label key={c.key} className="mbc-check-row">
                    <input type="checkbox" checked={chosen.has(c.key)} disabled={c.cuts === 0}
                      onChange={(e) => toggle(c.key, e.target.checked)} />
                    <span>{c.name}</span>
                    <span className="mbc-opdlg-muted">{c.site} · {c.cuts} cut{c.cuts === 1 ? '' : 's'}{c.blocked ? `, ${c.blocked} blocked` : ''}</span>
                  </label>
                ))}
                {shown.length === 0 && <span className="mbc-opdlg-muted">No matching enzymes.</span>}
              </div>
              {noRow.length > 0 && (
                <div className="mbc-opdlg-checklist" role="group" aria-label="Chosen enzymes not listed above">
                  {noRow.map((k) => (
                    <label key={k} className="mbc-check-row">
                      <input type="checkbox" checked onChange={(e) => toggle(k, e.target.checked)} />
                      <span>{labelOfKey(k)}</span>
                      <span className="mbc-opdlg-muted">chosen, not listed above · untick to remove</span>
                    </label>
                  ))}
                </div>
              )}
              {chosen.size > 0 && <span className="mbc-opdlg-muted">Selected: {Array.from(chosen).map(labelOfKey).join(', ')}</span>}
            </OptionRow>
            <OptionRow label="Annotations:">
              <label className="mbc-check-row">
                <input type="checkbox" checked={Boolean(v.keepAnnotations)} onChange={(e) => set('keepAnnotations', e.target.checked)} />
                <span>Keep annotations that lie wholly inside a fragment</span>
              </label>
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        onCreate(runDigest(doc, v, enzymes).created);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Design Primers ─────────────────────────────

export interface DesignPrimersOperationDialogProps {
  doc: SequenceDocument;
  selection?: { start: number; end: number } | null;
  onUpdate: (doc: SequenceDocument) => void;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const DesignPrimersOperationDialog: React.FC<DesignPrimersOperationDialogProps> = ({
  doc, selection, onUpdate, onCreate, onClose, onDownload,
}) => {
  const len = doc.sequence.length;
  const sel = selection && selection.end > selection.start && selection.end <= len ? selection : null;
  // A selection across the origin of a circular molecule (start > end, BG-01M7CG2W) is not a
  // target region primer design can take (it reads start..end within the molecule): say so rather
  // than drop it silently or offer the arc between its ends.
  const crossing = Boolean(selection && doc.topology === 'circular' && selection.start > selection.end);
  const crossingNote = crossing && selection
    ? `The selection ${selection.start}..${selection.end} runs across the origin; set the origin first to design primers around it.`
    : null;
  const num = (v: string | number | boolean) => Number(v);
  return (
    <OperationDialog
      operationId="design-primers"
      title="Design Primers…"
      runLabel="Design"
      transientKeys={['regionStart', 'regionEnd']}
      defaults={{ regionStart: sel?.start ?? 1, regionEnd: sel?.end ?? len, targetTm: 60, slack: 50, fwdTail: '', revTail: '', extractProduct: true }}
      onDownload={onDownload}
      summary={<span><strong>{doc.name}</strong> · {len.toLocaleString()} bp{sel ? ` · selection ${sel.start}–${sel.end}` : ''}{crossingNote ? ` · ${crossingNote}` : ''}</span>}
      validate={(v) => {
        if (doc.moleculeType === 'Protein' || !len) return 'Primer design needs a DNA sequence.';
        const s = num(v.regionStart);
        const e = num(v.regionEnd);
        if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e > len || s >= e) return `Enter a target region between 1 and ${len.toLocaleString()}.`;
        if (e - s + 1 < 34) return 'The target region must be at least 34 bp (room for two primers).';
        if (/[^ACGTRYSWKMBDHVN]/i.test(String(v.fwdTail) + String(v.revTail))) return "5' extensions may contain IUPAC nucleotide letters only.";
        if (num(v.targetTm) < 45 || num(v.targetTm) > 75) return 'Target Tm must be between 45 and 75 °C.';
        if (!(num(v.slack) >= 0 && num(v.slack) <= 300)) return 'Primer position slack must be 0–300 bp.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Target region:" hint="The product always contains this whole region.">
            <div className="prefs-row">
              <input aria-label="Region start" type="number" style={{ width: 90 }} min={1} max={len} value={num(v.regionStart)}
                onChange={(e) => set('regionStart', Math.round(Number(e.target.value)))} />
              <span>to</span>
              <input aria-label="Region end" type="number" style={{ width: 90 }} min={1} max={len} value={num(v.regionEnd)}
                onChange={(e) => set('regionEnd', Math.round(Number(e.target.value)))} />
              {sel && (
                <button type="button" className="btn-secondary-sm" onClick={() => { set('regionStart', sel.start); set('regionEnd', sel.end); }}>Use selection</button>
              )}
              {crossingNote && <span className="mbc-opdlg-hint" role="note">{crossingNote}</span>}
            </div>
          </OptionRow>
          <OptionRow label="Target Tm (°C):" htmlFor="opdlg-pr-tm" hint="SantaLucia nearest-neighbour Tm of the annealing part.">
            <input id="opdlg-pr-tm" type="number" min={45} max={75} step={0.5} value={num(v.targetTm)}
              onChange={(e) => set('targetTm', Number(e.target.value))} />
          </OptionRow>
          <OptionRow label="Primer position:" htmlFor="opdlg-pr-slack"
            hint={num(v.slack) > 0 ? 'Each primer may start this far outside the region when that brings its Tm closer to the target.' : 'Primers anneal exactly at the region ends (needed when the product ends must be exact).'}>
            <div className="prefs-row">
              <span>Up to</span>
              <input id="opdlg-pr-slack" type="number" min={0} max={300} style={{ width: 80 }} value={num(v.slack)}
                onChange={(e) => set('slack', Math.max(0, Math.min(300, Math.round(Number(e.target.value) || 0))))} />
              <span>bp outside the region</span>
            </div>
          </OptionRow>
          <OptionRow label="Result:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.extractProduct)} onChange={(e) => set('extractProduct', e.target.checked)} />
              <span>Also save the PCR product as a new document</span>
            </label>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          <OptionRow label="Forward 5′ extension:" htmlFor="opdlg-pr-ft" hint="e.g. a restriction site plus padding; not counted in the annealing Tm.">
            <input id="opdlg-pr-ft" type="text" value={String(v.fwdTail)} onChange={(e) => set('fwdTail', e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </OptionRow>
          <OptionRow label="Reverse 5′ extension:" htmlFor="opdlg-pr-rt">
            <input id="opdlg-pr-rt" type="text" value={String(v.revTail)} onChange={(e) => set('revTail', e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const r = designPCRPrimers(doc, num(v.regionStart), num(v.regionEnd), num(v.targetTm), String(v.fwdTail), String(v.revTail), num(v.slack));
        if (!r.forward?.sequence || !r.reverse?.sequence || !r.ampliconSeq) {
          throw new Error(r.warnings?.join(' ') || 'No primer pair could be designed for this region.');
        }
        const t = now();
        const tag = `${num(v.regionStart)}-${num(v.regionEnd)}`;
        const fwd = { ...r.forward, id: uid('pr'), name: r.forward.name || `${doc.name}_F_${tag}` };
        const rev = { ...r.reverse, id: uid('pr'), name: r.reverse.name || `${doc.name}_R_${tag}` };
        const note = `${primerTmText(fwd, { digits: 1 })} / ${primerTmText(rev, { digits: 1 })}, product ${r.ampliconLength.toLocaleString()} bp`;
        onUpdate({
          ...doc,
          primers: [...doc.primers, fwd, rev],
          updatedAt: t,
          history: [...doc.history, { id: uid('hist'), timestamp: t, operation: 'Design Primers', description: `${fwd.name} + ${rev.name}; ${note}${r.warnings?.length ? `; ${r.warnings.join(' ')}` : ''}`, parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
        });
        if (v.extractProduct) {
          onCreate({
            id: uid('pcr'),
            name: `${doc.name} PCR product (${r.ampliconLength.toLocaleString()} bp)`,
            accession: '',
            description: `PCR product of ${fwd.name} + ${rev.name} on ${doc.name}; ${note}`,
            moleculeType: 'DNA',
            topology: 'linear',
            sequence: r.ampliconSeq,
            features: [],
            primers: [],
            docMetadata: {
              'Forward primer': fwd.sequence,
              'Reverse primer': rev.sequence,
              'Target region': tag,
              'Product span': `${fwd.bindStart}–${rev.bindEnd}`,
              ...(r.warnings?.length ? { 'Design notes': r.warnings.join(' ') } : {}),
            },
            history: [{ id: uid('hist'), timestamp: t, operation: 'Extract PCR Product', description: note, parentIds: [doc.id], lengthBp: r.ampliconLength, topology: 'linear' }],
            createdAt: t,
            updatedAt: t,
            folder: doc.folder,
          });
        }
      }}
      onClose={onClose}
    />
  );
};
