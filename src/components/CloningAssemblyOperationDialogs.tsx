// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Options windows for annotation, cloning and assembly:
 *   Sequence → Find ORFs…              (ORF annotations added to the sequence)
 *   Cloning  → Clone Insert into Vector… (new construct document)
 *   Align    → De Novo Assemble…        (one document per contig)
 */

import React, { useMemo } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { ORF_NOTE, runDeNovo, runFindOrfs, runMapToReferences, runValidateClone } from '../core/operationRunners';
import { findRestrictionCutSites, simulateMolecularCloning } from '../core/bioEngine';
import { mapReadsToReference } from '../core/referenceMapping';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { restrictionScanScope, restrictionScopeWords } from './CircularPlasmidMap';
import type { CloningMethodType, SequenceDocument, SequenceFeature } from '../types/bio';

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (v: string | number | boolean) => Number(v);

// ───────────────────────────── Find ORFs ─────────────────────────────

export { ORF_NOTE };

export interface FindOrfsOperationDialogProps {
  doc: SequenceDocument;
  onUpdate: (doc: SequenceDocument, added: number) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const FindOrfsOperationDialog: React.FC<FindOrfsOperationDialogProps> = ({ doc, onUpdate, onClose, onDownload }) => {
  const existing = doc.features.filter((f) => f.notes === ORF_NOTE).length;
  return (
    <OperationDialog
      operationId="find-orfs"
      title="Find ORFs…"
      runLabel="Find ORFs"
      defaults={{ minAa: 100, altStart: false, strands: 'both', annotateAs: 'misc_feature', replace: true }}
      onDownload={onDownload}
      summary={<span><strong>{doc.name}</strong> · {doc.sequence.length.toLocaleString()} {doc.moleculeType === 'RNA' ? 'nt' : 'bp'}{existing ? ` · ${existing} ORF annotations from an earlier run` : ''}</span>}
      validate={(v) => {
        if (doc.moleculeType === 'Protein' || !doc.sequence) return 'Find ORFs needs a nucleotide sequence.';
        if (!(num(v.minAa) >= 10 && num(v.minAa) <= 5000)) return 'Minimum length must be 10–5,000 amino acids.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Minimum length:" htmlFor="opdlg-orf-min">
            <div className="prefs-row">
              <input id="opdlg-orf-min" type="number" min={10} max={5000} style={{ width: 90 }} value={num(v.minAa)}
                onChange={(e) => set('minAa', Math.round(Number(e.target.value)))} />
              <span>amino acids</span>
            </div>
          </OptionRow>
          <OptionRow label="Start codons:" htmlFor="opdlg-orf-start">
            <select id="opdlg-orf-start" value={v.altStart ? 'alt' : 'atg'} onChange={(e) => set('altStart', e.target.value === 'alt')}>
              <option value="atg">ATG only</option>
              <option value="alt">ATG, GTG, TTG (bacterial alternatives)</option>
            </select>
          </OptionRow>
          <OptionRow label="Strands:" htmlFor="opdlg-orf-strand">
            <select id="opdlg-orf-strand" value={String(v.strands)} onChange={(e) => set('strands', e.target.value)}>
              <option value="both">Both strands</option>
              <option value="forward">Forward strand only</option>
            </select>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          <OptionRow label="Annotate as:" htmlFor="opdlg-orf-type" hint="CDS implies a known coding sequence; use it only when you intend these as genes.">
            <select id="opdlg-orf-type" value={String(v.annotateAs)} onChange={(e) => set('annotateAs', e.target.value)}>
              <option value="misc_feature">ORF (misc_feature)</option>
              <option value="CDS">CDS</option>
            </select>
          </OptionRow>
          <OptionRow label="Earlier results:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.replace)} onChange={(e) => set('replace', e.target.checked)} />
              <span>Replace ORF annotations from earlier runs</span>
            </label>
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const r = runFindOrfs(doc, v);
        const added = r.updated[0].features.filter((f) => f.notes === ORF_NOTE).length;
        onUpdate(r.updated[0], added);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Cloning ─────────────────────────────

export const CLONING_METHODS: { value: CloningMethodType; hint: string }[] = [
  { value: 'Restriction Ligation', hint: 'Cuts vector and insert with the chosen enzymes and ligates compatible ends.' },
  { value: 'Gibson Assembly', hint: 'Joins fragments through end homology (the insert needs overlaps with the vector).' },
  { value: 'In-Fusion Cloning', hint: '15-bp homology arms at the insert ends join it to the opened vector.' },
  { value: 'NEBuilder HiFi Assembly', hint: 'Homology-based assembly, like Gibson.' },
  { value: 'Golden Gate (Type IIS)', hint: 'Type IIS sites are cut outward and the 4-nt overhangs ligate in one pot.' },
  { value: 'TA / GC Cloning', hint: 'A PCR product with A overhangs into a T vector.' },
  { value: 'TOPO Cloning', hint: 'Topoisomerase-charged vector ligation of a blunt or TA product.' },
  { value: 'Gateway BP/LR Recombination', hint: 'att-site recombination between entry and destination vectors.' },
];

export interface CloningOperationDialogProps {
  candidates: SequenceDocument[];
  initialVectorId?: string;
  initialInsertId?: string;
  onCreate: (doc: SequenceDocument, summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const CloningOperationDialog: React.FC<CloningOperationDialogProps> = ({
  candidates, initialVectorId, initialInsertId, onCreate, onClose, onDownload,
}) => {
  const dna = candidates.filter((d) => d.moleculeType === 'DNA' && d.sequence.length > 0);
  const vectorDefault = initialVectorId && dna.some((d) => d.id === initialVectorId)
    ? initialVectorId : dna.find((d) => d.topology === 'circular')?.id ?? dna[0]?.id ?? '';
  const insertDefault = initialInsertId && initialInsertId !== vectorDefault && dna.some((d) => d.id === initialInsertId)
    ? initialInsertId : dna.find((d) => d.id !== vectorDefault)?.id ?? '';
  const byId = useMemo(() => new Map(dna.map((d) => [d.id, d])), [dna]);
  const uniqueCuttersOf = (doc?: SequenceDocument) => {
    if (!doc) return [] as string[];
    const counts = new Map<string, number>();
    for (const s of findRestrictionCutSites(doc.sequence, doc.topology === 'circular' ? 'circular' : 'linear')) {
      if (!s.methylationBlocked) counts.set(s.enzyme.name, (counts.get(s.enzyme.name) ?? 0) + 1);
    }
    return Array.from(counts).filter(([, n]) => n === 1).map(([name]) => name).sort();
  };
  const typeIIS = REBASE_ENZYMES.filter((e) => e.isTypeIIS).map((e) => e.name);

  return (
    <OperationDialog
      operationId="clone-insert"
      title="Clone Insert into Vector…"
      runLabel="Clone"
      transientKeys={['vectorId', 'insertId', 'resultName']}
      defaults={{ method: 'Restriction Ligation', vectorId: vectorDefault, insertId: insertDefault, enzyme5: 'EcoRI', enzyme3: 'HindIII', typeIIS: typeIIS.includes('BsaI-HFv2') ? 'BsaI-HFv2' : typeIIS[0] ?? '', resultName: '' }}
      onDownload={onDownload}
      summary={<span>{dna.length} DNA documents available in this project</span>}
      validate={(v) => {
        if (!byId.has(String(v.vectorId)) || !byId.has(String(v.insertId))) return 'Choose a vector and an insert.';
        if (v.vectorId === v.insertId) return 'The vector and the insert must be different documents.';
        if (v.method === 'Restriction Ligation' && (!v.enzyme5 || !v.enzyme3)) return "Choose the 5' and 3' enzymes.";
        return null;
      }}
      renderOptions={(v, set) => {
        const method = CLONING_METHODS.find((m) => m.value === v.method) ?? CLONING_METHODS[0];
        const vector = byId.get(String(v.vectorId));
        const unique = v.method === 'Restriction Ligation' ? uniqueCuttersOf(vector) : [];
        // The engine scans a vector of more than 100,000 bp with its core enzymes only
        // (BG-01M6S1D2), so its single cutters are named for those, in the map's words.
        const scopeWords = vector ? restrictionScopeWords(restrictionScanScope(vector.sequence.length), vector.sequence.length) : null;
        const docSelect = (id: string, key: string) => (
          <select id={id} value={String(v[key])} onChange={(e) => set(key, e.target.value)}>
            {dna.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sequence.length.toLocaleString()} bp, {d.topology})</option>)}
          </select>
        );
        const enzSelect = (key: string, label: string) => (
          <select aria-label={label} value={String(v[key])} onChange={(e) => set(key, e.target.value)}>
            {!unique.includes(String(v[key])) && (
              <option value={String(v[key])}>{`${String(v[key])} (not a unique cutter ${scopeWords ? scopeWords.once : 'in the vector'})`}</option>
            )}
            {unique.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        );
        return (
          <>
            <OptionRow label="Method:" htmlFor="opdlg-cl-method" hint={method.hint}>
              <select id="opdlg-cl-method" value={String(v.method)} onChange={(e) => set('method', e.target.value)}>
                {CLONING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.value}</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Vector:" htmlFor="opdlg-cl-vector">{docSelect('opdlg-cl-vector', 'vectorId')}</OptionRow>
            <OptionRow label="Insert:" htmlFor="opdlg-cl-insert">{docSelect('opdlg-cl-insert', 'insertId')}</OptionRow>
            {v.method === 'Restriction Ligation' && (
              <OptionRow label="Enzymes (5′ / 3′):" hint={scopeWords
                ? `${unique.length} enzymes cut the vector exactly once ${scopeWords.once}. ${scopeWords.detail}`
                : `${unique.length} enzymes cut the vector exactly once.`}>
                <div className="prefs-row">{enzSelect('enzyme5', "5' enzyme")}{enzSelect('enzyme3', "3' enzyme")}</div>
              </OptionRow>
            )}
            {v.method === 'Golden Gate (Type IIS)' && (
              <OptionRow label="Type IIS enzyme:" htmlFor="opdlg-cl-iis">
                <select id="opdlg-cl-iis" value={String(v.typeIIS)} onChange={(e) => set('typeIIS', e.target.value)}>
                  {typeIIS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </OptionRow>
            )}
            <OptionRow label="Result name:" htmlFor="opdlg-cl-name">
              <input id="opdlg-cl-name" type="text" value={String(v.resultName)}
                placeholder={vector && byId.get(String(v.insertId)) ? `${vector.name} + ${byId.get(String(v.insertId))!.name}` : 'Construct'}
                onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        const vector = byId.get(String(v.vectorId))!;
        const insert = byId.get(String(v.insertId))!;
        const out = simulateMolecularCloning(vector, insert, String(v.method) as CloningMethodType,
          String(v.enzyme5), String(v.enzyme3), String(v.typeIIS));
        if (!out.success) throw new Error([out.summary, ...out.warnings.slice(1)].join(' '));
        const t = now();
        const c = out.constructDocument;
        const name = String(v.resultName).trim() || c.name || `${vector.name} + ${insert.name}`;
        onCreate({
          ...c,
          id: uid('construct'),
          name,
          folder: vector.folder,
          createdAt: t,
          updatedAt: t,
          docMetadata: { ...(c.docMetadata ?? {}), 'Cloning method': String(v.method), ...(out.warnings.length ? { Warnings: out.warnings.join(' | ') } : {}) },
          history: c.history?.length ? c.history.map((h) => ({ ...h, parentIds: h.parentIds?.length ? h.parentIds : [vector.id, insert.id] }))
            : [{ id: uid('hist'), timestamp: t, operation: String(v.method), description: out.summary, parentIds: [vector.id, insert.id], lengthBp: c.sequence.length, topology: c.topology }],
        }, out.summary);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── De Novo Assembly ─────────────────────────────

/** Reads per run for the built-in assembler (it runs on the interface thread). */
export const DE_NOVO_MAX_READS = 1000;

export interface DeNovoOperationDialogProps {
  reads: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  onCreate: (docs: SequenceDocument[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const DeNovoOperationDialog: React.FC<DeNovoOperationDialogProps> = ({ reads, sourceLabel, folder, onCreate, onClose, onDownload }) => {
  const nuc = reads.filter((r) => r.moleculeType !== 'Protein');
  return (
    <OperationDialog
      operationId="de-novo-assemble"
      title="De Novo Assemble…"
      runLabel="Assemble"
      defaults={{ minOverlap: 18, keepSingletons: false }}
      onDownload={onDownload}
      summary={<span><strong>{nuc.length}</strong> nucleotide reads from <strong>{sourceLabel}</strong></span>}
      validate={(v) => {
        if (nuc.length < 2) return 'Select at least two nucleotide sequences (reads) to assemble.';
        if (nuc.length !== reads.length) return 'Protein sequences cannot be assembled; select nucleotide reads only.';
        if (!(num(v.minOverlap) >= 12 && num(v.minOverlap) <= 500)) return 'Minimum overlap must be 12–500 bp.';
        if (nuc.length > DE_NOVO_MAX_READS) return `The built-in assembler takes at most ${DE_NOVO_MAX_READS.toLocaleString()} reads per run.`;
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Assembler:" hint="Built-in greedy overlap assembler: repeatedly joins the first pair of reads (either orientation) whose ends overlap, allowing a few mismatches. Suited to Sanger reads and small amplicon sets, not NGS-scale data.">
            <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>Greedy overlap (built in)</span>
          </OptionRow>
          <OptionRow label="Minimum overlap:" htmlFor="opdlg-dn-ov">
            <div className="prefs-row">
              <input id="opdlg-dn-ov" type="number" min={12} max={500} style={{ width: 90 }} value={num(v.minOverlap)}
                onChange={(e) => set('minOverlap', Math.round(Number(e.target.value)))} />
              <span>bp</span>
            </div>
          </OptionRow>
          <OptionRow label="Unassembled reads:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.keepSingletons)} onChange={(e) => set('keepSingletons', e.target.checked)} />
              <span>Also save reads that joined nothing as single-read contigs</span>
            </label>
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const r = runDeNovo(nuc, v, { sourceLabel, folder });
        onCreate(r.created, r.summary);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Map to Reference ─────────────────────────────

/** Longest read the seeded local aligner accepts (its alignment window). */
export const MAP_MAX_READ_LENGTH = 2400;

export interface MapToReferenceDialogProps {
  /** Selected sequences: reads, and possibly the reference. */
  inputs: SequenceDocument[];
  /** Other project documents that may serve as the reference. */
  candidates: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  onCreate: (docs: SequenceDocument[], summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const MapToReferenceDialog: React.FC<MapToReferenceDialogProps> = ({
  inputs, candidates, sourceLabel, folder, onCreate, onClose, onDownload,
}) => {
  const nuc = (d: SequenceDocument) => d.moleculeType !== 'Protein' && d.sequence.length > 0;
  const refChoices = useMemo(() => {
    const seen = new Set<string>();
    return [...inputs, ...candidates].filter((d) => nuc(d) && !seen.has(d.id) && (seen.add(d.id), true));
  }, [inputs, candidates]);
  // Default reference: the longest selected sequence (reads are usually shorter).
  const defaultRef = [...inputs].filter(nuc).sort((a, b) => b.sequence.length - a.sequence.length)[0]?.id ?? refChoices[0]?.id ?? '';
  const readsFor = (refId: string) => inputs.filter((d) => d.id !== refId && nuc(d));
  return (
    <OperationDialog
      operationId="map-to-reference"
      title="Map to Reference…"
      runLabel="Map"
      transientKeys={['referenceId', 'extraRefs', 'resultName']}
      defaults={{ referenceId: defaultRef, extraRefs: '', minIdentity: 80, minLength: 50, minVarFreq: 25, minVarCoverage: 1, minVarQuality: 20, resultName: '' }}
      onDownload={onDownload}
      summary={<span><strong>{inputs.length}</strong> selected sequence{inputs.length === 1 ? '' : 's'} from <strong>{sourceLabel}</strong></span>}
      validate={(v) => {
        const ref = refChoices.find((d) => d.id === v.referenceId);
        if (!ref) return 'Choose a nucleotide reference sequence.';
        const reads = readsFor(ref.id);
        if (reads.length === 0) return 'Select the reads to map (the reference itself is not mapped).';
        const long = reads.find((r) => (r.chromatogram?.baseCalls || r.sequence).length > MAP_MAX_READ_LENGTH);
        if (long) return `${long.name} is longer than ${MAP_MAX_READ_LENGTH.toLocaleString()} bases; the mapper handles reads up to that length (use Pairwise Alignment for long sequences).`;
        if (!(num(v.minIdentity) >= 50 && num(v.minIdentity) <= 100)) return 'Minimum identity must be 50–100%.';
        return null;
      }}
      renderOptions={(v, set) => {
        const reads = readsFor(String(v.referenceId));
        return (
          <>
            <OptionRow label="Reference sequence:" htmlFor="opdlg-map-ref" hint={`${reads.length} read${reads.length === 1 ? '' : 's'} will be mapped; each is aligned to the reference independently (both strands).`}>
              <select id="opdlg-map-ref" value={String(v.referenceId)} onChange={(e) => set('referenceId', e.target.value)}>
                {refChoices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sequence.length.toLocaleString()} bp)</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Map reads with:" hint="Reads below either threshold are left unmapped and listed in the result.">
              <div className="prefs-row">
                <span>≥</span>
                <input aria-label="Minimum identity" type="number" min={50} max={100} style={{ width: 70 }} value={num(v.minIdentity)}
                  onChange={(e) => set('minIdentity', Number(e.target.value))} />
                <span>% identity and ≥</span>
                <input aria-label="Minimum aligned length" type="number" min={20} max={2400} style={{ width: 80 }} value={num(v.minLength)}
                  onChange={(e) => set('minLength', Math.round(Number(e.target.value)))} />
                <span>bp aligned</span>
              </div>
            </OptionRow>
            <OptionRow label="Result name:" htmlFor="opdlg-map-name">
              <input id="opdlg-map-name" type="text" value={String(v.resultName)}
                placeholder={`${refChoices.find((d) => d.id === v.referenceId)?.name ?? 'Reference'} contig`}
                onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      renderMoreOptions={(v, set) => (
        <>
        <OptionRow label="More references:" hint="With several references, each read is mapped to the one it matches best and one contig is made per reference.">
          <div className="mbc-opdlg-checklist" role="group" aria-label="Additional references">
            {inputs.filter((d) => nuc(d) && d.id !== v.referenceId).map((d) => {
              const chosen = new Set(String(v.extraRefs).split(',').filter(Boolean));
              return (
                <label key={d.id} className="mbc-check-row">
                  <input type="checkbox" checked={chosen.has(d.id)} onChange={(e) => {
                    if (e.target.checked) chosen.add(d.id); else chosen.delete(d.id);
                    set('extraRefs', Array.from(chosen).join(','));
                  }} />
                  <span>{d.name}</span>
                  <span className="mbc-opdlg-muted">{d.sequence.length.toLocaleString()} bp</span>
                </label>
              );
            })}
          </div>
        </OptionRow>
        <OptionRow label="Annotate variants:" hint="Variants are annotated on the contig with their frequency among covering reads.">
          <div className="prefs-row">
            <span>frequency ≥</span>
            <input aria-label="Minimum variant frequency" type="number" min={1} max={100} style={{ width: 70 }} value={num(v.minVarFreq)}
              onChange={(e) => set('minVarFreq', Number(e.target.value))} />
            <span>% and coverage ≥</span>
            <input aria-label="Minimum variant coverage" type="number" min={1} max={1000} style={{ width: 70 }} value={num(v.minVarCoverage)}
              onChange={(e) => set('minVarCoverage', Math.max(1, Math.round(Number(e.target.value))))} />
          </div>
          <div className="prefs-row">
            <span>trace base quality ≥ Q</span>
            <input aria-label="Minimum variant quality" type="number" min={0} max={60} style={{ width: 70 }} value={num(v.minVarQuality)}
              onChange={(e) => set('minVarQuality', Math.max(0, Math.round(Number(e.target.value))))} />
            <span className="mbc-opdlg-muted">(reads without qualities are not filtered)</span>
          </div>
        </OptionRow>
        </>
      )}
      onRun={(v) => {
        const ref = refChoices.find((d) => d.id === v.referenceId)!;
        const extra = String(v.extraRefs ?? '').split(',').filter(Boolean).map((id) => refChoices.find((d) => d.id === id)).filter((d): d is SequenceDocument => !!d && d.id !== ref.id);
        const refIds = new Set([ref.id, ...extra.map((d) => d.id)]);
        const reads = inputs.filter((d) => !refIds.has(d.id) && nuc(d));
        const r = runMapToReferences([ref, ...extra], reads, v, { sourceLabel, folder });
        onCreate(r.created, r.summary);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Validate Clone ─────────────────────────────

export interface ValidateCloneDialogProps {
  inputs: SequenceDocument[];
  candidates: SequenceDocument[];
  folder?: string;
  onCreate: (doc: SequenceDocument, summary: string) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const ValidateCloneDialog: React.FC<ValidateCloneDialogProps> = ({ inputs, candidates, folder, onCreate, onClose, onDownload }) => {
  const dna = (d: SequenceDocument) => d.moleculeType === 'DNA' && d.sequence.length > 0;
  const choices = [...inputs, ...candidates].filter((d, i, a) => dna(d) && !d.chromatogram && a.findIndex((x) => x.id === d.id) === i);
  const defaultConstruct = [...inputs].filter((d) => dna(d) && !d.chromatogram).sort((a, b) => b.sequence.length - a.sequence.length)[0]?.id ?? choices[0]?.id ?? '';
  const readsFor = (id: string) => inputs.filter((d) => d.id !== id && d.moleculeType !== 'Protein' && d.sequence.length > 0);
  return (
    <OperationDialog
      operationId="validate-clone"
      title="Validate Clone…"
      runLabel="Validate"
      transientKeys={['constructId', 'resultName']}
      defaults={{ constructId: defaultConstruct, minIdentity: 80, minLength: 50, minVarQuality: 20, requiredCoverage: 100, resultName: '' }}
      onDownload={onDownload}
      summary={<span>Checks an expected construct against its sequencing reads (select the construct and the reads).</span>}
      validate={(v) => {
        if (!choices.some((d) => d.id === v.constructId)) return 'Choose the expected construct (a DNA sequence).';
        if (!readsFor(String(v.constructId)).length) return 'Select the sequencing reads together with the construct.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Expected construct:" htmlFor="opdlg-vc-construct">
            <select id="opdlg-vc-construct" value={String(v.constructId)} onChange={(e) => set('constructId', e.target.value)}>
              {choices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sequence.length.toLocaleString()} bp)</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Reads:">
            <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>{readsFor(String(v.constructId)).map((r) => r.name).join(', ') || 'none selected'}</span>
          </OptionRow>
          <OptionRow label="Confirmed when:" hint="A discrepancy is a difference present in at least half of the reads covering that base (and above the quality threshold for traces).">
            <div className="prefs-row">
              <span>≥</span>
              <input aria-label="Required coverage" type="number" min={1} max={100} style={{ width: 70 }} value={num(v.requiredCoverage)} onChange={(e) => set('requiredCoverage', Number(e.target.value))} />
              <span>% of the construct is covered and there are no discrepancies</span>
            </div>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <OptionRow label="Map reads with:">
          <div className="prefs-row">
            <span>≥</span>
            <input aria-label="Minimum identity" type="number" min={50} max={100} style={{ width: 70 }} value={num(v.minIdentity)} onChange={(e) => set('minIdentity', Number(e.target.value))} />
            <span>% identity, ≥</span>
            <input aria-label="Minimum aligned length" type="number" min={20} style={{ width: 80 }} value={num(v.minLength)} onChange={(e) => set('minLength', Math.round(Number(e.target.value)))} />
            <span>bp, trace quality ≥ Q</span>
            <input aria-label="Minimum quality" type="number" min={0} max={60} style={{ width: 60 }} value={num(v.minVarQuality)} onChange={(e) => set('minVarQuality', Math.round(Number(e.target.value)))} />
          </div>
        </OptionRow>
      )}
      onRun={(v) => {
        const construct = choices.find((d) => d.id === v.constructId)!;
        const r = runValidateClone(construct, readsFor(construct.id), v, { sourceLabel: construct.name, folder });
        onCreate(r.created[0], r.summary);
      }}
      onClose={onClose}
    />
  );
};
