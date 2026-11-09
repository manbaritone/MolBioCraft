// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Options windows for operations that create a new result document:
 *   Align → Multiple Alignment…   (alignment document)
 *   Tree  → Build Tree…           (tree document, with its alignment attached)
 */

import React, { useEffect, useState } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { MSA_ALGORITHMS, newickOf, runBuildTree, runConsensusTree, runMultipleAlignment } from '../core/operationRunners';
import { leafNames, parseNewick } from '../core/treeConsensus';
import { DATA_SUBSET_DEFAULTS, DataSubsetOptions } from './EvolutionAnalysisDialogs';
import { alignmentInputError } from '../core/alignmentExecution';
import { MSA_MAX_RESIDUES } from '../core/bioEngine';
import { isPreAlignedInputSet } from '../core/documentViews';
import { type PhyloTreeAlgorithm, type SubstitutionModelName } from '../core/phyloEvoEngine';
import {
  detectExternalTreePrograms,
  EXTERNAL_TREE_ALGORITHMS,
  EXTERNAL_TREE_NAMES,
  isExternalTreeAlgorithm,
  type ExternalProgramStatus,
} from '../core/externalTreePrograms';
import type { OptionValues } from '../core/optionProfiles';
import type { SequenceDocument } from '../types/bio';
import { littleSampleSize, LITTLE_MIN_SITES } from '../core/treeSearch';

export const MSA_ALGORITHM_OPTIONS = MSA_ALGORITHMS;

const DISTANCE_MODELS: SubstitutionModelName[] = [
  'Tamura-Nei (TN93)',
  'Jukes-Cantor (JC69)',
  'Kimura 2-parameter (K2P)',
  'Tamura 3-parameter (T92)',
  'Hasegawa-Kishino-Yano (HKY85)',
  'General Time Reversible (GTR+G+I)',
  'Maximum Composite Likelihood (MCL)',
  'p-distance',
];


function moleculeWord(docs: readonly SequenceDocument[]): string {
  const t = docs[0]?.moleculeType;
  return t === 'Protein' ? 'protein' : t === 'RNA' ? 'RNA' : 'nucleotide';
}

function InputSummary({ docs, sourceLabel }: { docs: readonly SequenceDocument[]; sourceLabel: string }) {
  const lengths = docs.map((d) => d.sequence.replace(/[-.\s]/g, '').length);
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  return (
    <span>
      <strong>{docs.length}</strong> {moleculeWord(docs)} sequence{docs.length === 1 ? '' : 's'} from <strong>{sourceLabel}</strong>
      {docs.length > 0 && <> · {min === max ? `${min.toLocaleString()}` : `${min.toLocaleString()}–${max.toLocaleString()}`} residues</>}
    </span>
  );
}

function sameMoleculeProblem(docs: readonly SequenceDocument[]): string | null {
  const types = new Set(docs.map((d) => (d.moleculeType === 'RNA' ? 'DNA' : d.moleculeType)));
  return types.size > 1 ? 'Select sequences of one molecule type (nucleotide or protein), not both.' : null;
}


// ───────────────────────────── Multiple Alignment ─────────────────────────────

export interface AlignOperationDialogProps {
  inputs: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  initialAlgorithm?: string;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const AlignOperationDialog: React.FC<AlignOperationDialogProps> = ({
  inputs, sourceLabel, folder, initialAlgorithm, onCreate, onClose, onDownload,
}) => {
  const defaults: OptionValues = { algorithm: '', circular: '', resultName: '' };
  const [seedAlgorithm] = useState(initialAlgorithm);
  const anyCircular = inputs.some((d) => d.topology === 'circular');
  const isProtein = inputs[0]?.moleculeType === 'Protein';
  return (
    <OperationDialog
      operationId="align-multiple"
      transientKeys={['resultName']}
      title="Multiple Alignment…"
      runLabel="Align"
      summary={<InputSummary docs={inputs} sourceLabel={sourceLabel} />}
      defaults={seedAlgorithm !== undefined ? { ...defaults, algorithm: seedAlgorithm } : defaults}
      onDownload={onDownload}
      validate={() => {
        if (inputs.length < 2) return 'Select at least two sequences (or an alignment / sequence list) to align.';
        return sameMoleculeProblem(inputs) ?? alignmentInputError(inputs, MSA_MAX_RESIDUES);
      }}
      renderOptions={(v, set) => {
        const algo = MSA_ALGORITHM_OPTIONS.find((o) => o.value === v.algorithm) ?? MSA_ALGORITHM_OPTIONS[0];
        return (
          <>
            <OptionRow label="Alignment method:" htmlFor="opdlg-msa-algo" hint={algo.hint}>
              <select id="opdlg-msa-algo" value={String(v.algorithm)} onChange={(e) => set('algorithm', e.target.value)}>
                {MSA_ALGORITHM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </OptionRow>
            {!isProtein && (
              <OptionRow label="Circular sequences:" htmlFor="opdlg-msa-circ"
                hint="Rotates each circular sequence (reverse-complementing it if needed) to start where the first sequence starts, so different origins do not split the alignment.">
                <select id="opdlg-msa-circ" value={String(v.circular)} onChange={(e) => set('circular', e.target.value)}>
                  <option value="">Align as given</option>
                  <option value="true">{anyCircular ? 'Rotate circular sequences to a common origin' : 'Rotate circular sequences (none selected are circular)'}</option>
                  <option value="all">Treat all sequences as circular and rotate</option>
                </select>
              </OptionRow>
            )}
            <OptionRow label="Result name:" htmlFor="opdlg-msa-name" hint="Saved as a new alignment document in the current folder.">
              <input id="opdlg-msa-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} alignment`}
                onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        onCreate(runMultipleAlignment(inputs, { ...v, circular: v.circular === 'all' ? 'all' : Boolean(v.circular) }, { sourceLabel, folder }).created[0]);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Build Tree ─────────────────────────────

const BUILT_IN_METHODS: { value: PhyloTreeAlgorithm; label: string }[] = [
  { value: 'Neighbor-Joining (NJ)', label: 'Neighbor-Joining' },
  { value: 'Maximum Likelihood (ML)', label: 'Maximum Likelihood (NNI search)' },
  { value: 'Minimum-Evolution (ME)', label: 'Minimum Evolution (NNI search)' },
  { value: 'Maximum Parsimony (MP)', label: 'Maximum Parsimony (SPR search)' },
  { value: 'UPGMA', label: 'UPGMA (assumes a molecular clock)' },
];

export interface BuildTreeOperationDialogProps {
  inputs: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  initialMethod?: PhyloTreeAlgorithm;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const BuildTreeOperationDialog: React.FC<BuildTreeOperationDialogProps> = ({
  inputs, sourceLabel, folder, initialMethod, onCreate, onClose, onDownload,
}) => {
  const [programs, setPrograms] = useState<ExternalProgramStatus[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void detectExternalTreePrograms().then((r) => live && setPrograms(r));
    return () => { live = false; };
  }, []);
  const preAligned = isPreAlignedInputSet(inputs);
  const seedMethod = initialMethod && (BUILT_IN_METHODS.some((m) => m.value === initialMethod) || isExternalTreeAlgorithm(initialMethod))
    ? initialMethod : 'Neighbor-Joining (NJ)';
  const defaults: OptionValues = {
    method: seedMethod,
    model: 'Tamura-Nei (TN93)',
    resampling: 'none',
    replicates: 100,
    jackknifePct: 50,
    randomAdditions: 10,
    mlModel: 'GTR',
    mlProteinModel: 'LG',
    mlGamma: true,
    mlInvariant: false,
    littleSamples: 10,
    littleSize: 0,
    alignFirst: '',
    outgroup: '',
    ...DATA_SUBSET_DEFAULTS,
    resultName: '',
  };
  const available = (algo: string) => programs?.find((p) => p.algorithm === algo)?.available ?? false;

  return (
    <OperationDialog
      operationId="build-tree"
      transientKeys={['resultName', 'outgroup']}
      title="Build Tree…"
      runLabel="Build Tree"
      summary={
        <>
          <InputSummary docs={inputs} sourceLabel={sourceLabel} />
          <div>{preAligned ? 'Input is aligned; columns are used as given.' : 'Input is not aligned: it will be aligned first (see More options).'}</div>
        </>
      }
      defaults={defaults}
      onDownload={onDownload}
      validate={(v) => {
        const method = String(v.method);
        const external = isExternalTreeAlgorithm(method);
        const min = external ? 4 : 3;
        if (inputs.length < min) return `${external ? EXTERNAL_TREE_NAMES[method] : 'Tree building'} needs at least ${min} sequences.`;
        if (!external && method === 'UPGMA' && (v.resampling === 'little' || v.resampling === 'interior')) return 'Little bootstraps and the interior-branch test work with NJ, ME and MP trees (the interior-branch test: NJ and ME only).';
        if (method === 'Maximum Likelihood (ML)' && inputs.length < 4) return 'Maximum likelihood needs at least 4 sequences.';
        if ((method === 'Maximum Parsimony (MP)' || method === 'Maximum Likelihood (ML)') && v.resampling === 'interior') return 'The interior-branch test needs a distance tree (Neighbor-Joining or Minimum Evolution).';
        if (external && programs === null) return `${EXTERNAL_TREE_NAMES[method]} can only run in the MolBioCraft desktop app.`;
        if (external && programs && !available(method)) {
          const hint = programs.find((p) => p.algorithm === method)?.installHint;
          return `${EXTERNAL_TREE_NAMES[method]} is not installed on this computer. Install it with: ${hint}`;
        }
        if (!preAligned) return sameMoleculeProblem(inputs) ?? alignmentInputError(inputs, MSA_MAX_RESIDUES);
        return sameMoleculeProblem(inputs);
      }}
      renderOptions={(v, set) => {
        const external = isExternalTreeAlgorithm(String(v.method));
        return (
          <>
            <OptionRow label="Tree build method:" htmlFor="opdlg-tree-method">
              <select id="opdlg-tree-method" value={String(v.method)} onChange={(e) => set('method', e.target.value)}>
                <optgroup label="Built in">
                  {BUILT_IN_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </optgroup>
                <optgroup label="Installed programs">
                  {EXTERNAL_TREE_ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {EXTERNAL_TREE_NAMES[a]}
                      {programs === undefined ? '' : programs === null ? ' — desktop app only' : available(a) ? '' : ' — not installed'}
                    </option>
                  ))}
                </optgroup>
              </select>
            </OptionRow>
            {v.method === 'Maximum Parsimony (MP)' && (
              <OptionRow label="Starting trees:" htmlFor="opdlg-tree-ras"
                hint="SPR branch swapping starts from the NJ tree and from this many random-addition trees; the shortest tree found is kept. Branch lengths are estimated from the distance model below.">
                <div className="prefs-row">
                  <span>NJ tree +</span>
                  <input id="opdlg-tree-ras" type="number" min={0} max={100} style={{ width: 70 }}
                    value={Number(v.randomAdditions)} onChange={(e) => set('randomAdditions', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                  <span>random-addition trees</span>
                </div>
              </OptionRow>
            )}
            {v.method === 'Maximum Likelihood (ML)' && (
              <OptionRow label="ML model:" htmlFor="opdlg-tree-mlmodel"
                hint={inputs[0]?.moleculeType === 'Protein' ? 'Empirical amino-acid model (rates and frequencies fixed; Γ shape and all branch lengths estimated by maximum likelihood).' : 'Nucleotide substitution model; its parameters and all branch lengths are estimated by maximum likelihood. Models… (Phylogeny menu) finds the best-fitting model.'}>
                {inputs[0]?.moleculeType === 'Protein' ? (
                <div className="prefs-row">
                  <select id="opdlg-tree-mlmodel" value={String(v.mlProteinModel ?? 'LG')} onChange={(e) => set('mlProteinModel', e.target.value)}>
                    <option value="LG">LG (Le &amp; Gascuel 2008)</option>
                    <option value="WAG">WAG (Whelan &amp; Goldman 2001)</option>
                    <option value="JTT">JTT (Jones, Taylor &amp; Thornton 1992)</option>
                  </select>
                  <label className="mbc-check-row"><input type="checkbox" checked={v.mlGamma !== false} onChange={(e) => set('mlGamma', e.target.checked)} /> +G (4 categories)</label>
                </div>
                ) : (
                <div className="prefs-row">
                  <select id="opdlg-tree-mlmodel" value={String(v.mlModel)} onChange={(e) => set('mlModel', e.target.value)}>
                    <option value="JC">Jukes-Cantor (JC)</option>
                    <option value="K2">Kimura 2-parameter (K2)</option>
                    <option value="T92">Tamura 3-parameter (T92)</option>
                    <option value="HKY">Hasegawa-Kishino-Yano (HKY)</option>
                    <option value="TN93">Tamura-Nei (TN93)</option>
                    <option value="GTR">General Time Reversible (GTR)</option>
                  </select>
                  <label className="mbc-check-row"><input type="checkbox" checked={v.mlGamma !== false} onChange={(e) => set('mlGamma', e.target.checked)} /> +G (4 categories)</label>
                  <label className="mbc-check-row"><input type="checkbox" checked={Boolean(v.mlInvariant)} onChange={(e) => set('mlInvariant', e.target.checked)} /> +I</label>
                </div>
                )}
              </OptionRow>
            )}
            {v.method === 'Minimum-Evolution (ME)' && (
              <OptionRow label="Search:">
                <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>Balanced minimum evolution; nearest-neighbour interchanges from the NJ tree until the tree length stops decreasing.</span>
              </OptionRow>
            )}
            {!external && v.method !== 'Maximum Likelihood (ML)' && (
              <OptionRow label="Genetic distance model:" htmlFor="opdlg-tree-model"
                hint={inputs[0]?.moleculeType === 'Protein' ? 'Protein input uses a Poisson-corrected amino-acid distance (or p-distance).' : undefined}>
                <select id="opdlg-tree-model" value={String(v.model)} onChange={(e) => set('model', e.target.value)}>
                  {DISTANCE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </OptionRow>
            )}
            {external ? (
              <OptionRow label="Branch support:" hint="Reported by the program itself (FastTree / PhyML: SH-like; MrBayes: posterior probability; RAxML: none).">
                <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>From {EXTERNAL_TREE_NAMES[String(v.method) as keyof typeof EXTERNAL_TREE_NAMES]}</span>
              </OptionRow>
            ) : (
              <OptionRow label="Resampling:" htmlFor="opdlg-tree-resample"
                hint={v.resampling === 'little'
                  ? (() => {
                    const L = Math.max(0, ...inputs.map((d) => d.sequence.length));
                    const size = littleSampleSize(L, Number(v.littleSize) || 0);
                    return `Little bootstraps (Sharma & Kumar 2021): replicates drawn from random site subsamples (default L^0.7 = ${size.toLocaleString()} sites here), support averaged over the little samples. Meant for long alignments.${size < LITTLE_MIN_SITES ? ` With ${size.toLocaleString()}-site samples support will be underestimated; use the standard bootstrap or more sites each.` : ''}`;
                  })()
                  : v.resampling === 'interior'
                    ? 'Interior-branch test (Rzhetsky & Nei 1992): each interior branch length is re-estimated on bootstrap resamples; the label is the confidence probability (%) that it is longer than zero.'
                    : undefined}>
                <div className="prefs-row">
                  <select id="opdlg-tree-resample" value={String(v.resampling)} onChange={(e) => set('resampling', e.target.value)}>
                    <option value="none">None</option>
                    <option value="bootstrap">Bootstrap</option>
                    <option value="jackknife">Jackknife</option>
                    <option value="little" disabled={v.method === 'UPGMA'}>Little bootstraps</option>
                    <option value="interior" disabled={v.method === 'UPGMA' || v.method === 'Maximum Parsimony (MP)' || v.method === 'Maximum Likelihood (ML)'}>Interior-branch test</option>
                  </select>
                  {v.resampling === 'little' && (
                    <>
                      <label htmlFor="opdlg-tree-ls">Little samples:</label>
                      <input id="opdlg-tree-ls" type="number" min={2} max={100} style={{ width: 60 }}
                        value={Number(v.littleSamples)} onChange={(e) => set('littleSamples', Math.max(2, Math.min(100, Number(e.target.value) || 10)))} />
                      <label htmlFor="opdlg-tree-lsz">Sites each:</label>
                      <input id="opdlg-tree-lsz" type="number" min={0} style={{ width: 80 }} placeholder="auto"
                        value={Number(v.littleSize) || ''} onChange={(e) => set('littleSize', Math.max(0, Number(e.target.value) || 0))} />
                    </>
                  )}
                  {v.resampling === 'jackknife' && (
                    <>
                      <label htmlFor="opdlg-tree-jk">Keep:</label>
                      <input id="opdlg-tree-jk" type="number" min={10} max={90} step={5} style={{ width: 70 }}
                        value={Number(v.jackknifePct)} onChange={(e) => set('jackknifePct', Math.max(10, Math.min(90, Number(e.target.value) || 50)))} />
                      <span>% of columns</span>
                    </>
                  )}
                  {v.resampling !== 'none' && (
                    <>
                      <label htmlFor="opdlg-tree-reps">{v.resampling === 'little' ? 'Replicates each:' : 'Replicates:'}</label>
                      <input id="opdlg-tree-reps" type="number" min={10} max={1000} step={10} style={{ width: 80 }}
                        value={Number(v.replicates)} onChange={(e) => set('replicates', Math.max(10, Math.min(1000, Number(e.target.value) || 100)))} />
                    </>
                  )}
                </div>
              </OptionRow>
            )}
            <OptionRow label="Result name:" htmlFor="opdlg-tree-name" hint="Saved as a new tree document in the current folder.">
              <input id="opdlg-tree-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} tree`}
                onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      renderMoreOptions={(v, set) => (
        <>
          <DataSubsetOptions v={v} set={set} isProtein={inputs[0]?.moleculeType === 'Protein'} />
          <OptionRow label="Root with outgroup:" htmlFor="opdlg-tree-outgroup" hint="Places the root on the branch leading to this sequence. Leave unset to keep the method's own root (UPGMA) or midpoint root (NJ).">
            <select id="opdlg-tree-outgroup" value={String(v.outgroup)} onChange={(e) => set('outgroup', e.target.value)}>
              <option value="">No outgroup</option>
              {inputs.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </OptionRow>
          {!preAligned && (
            <OptionRow label="Align first with:" htmlFor="opdlg-tree-align">
              <select id="opdlg-tree-align" value={String(v.alignFirst)} onChange={(e) => set('alignFirst', e.target.value)}>
                {MSA_ALGORITHM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </OptionRow>
          )}
        </>
      )}
      onRun={async (v, signal) => {
        const r = await runBuildTree(inputs, v, { sourceLabel, folder, signal });
        if (!signal.aborted) onCreate(r.created[0]);
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Consensus Tree ─────────────────────────────

export interface ConsensusTreeDialogProps {
  trees: SequenceDocument[];
  sourceLabel: string;
  onCreate: (doc: SequenceDocument) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const ConsensusTreeDialog: React.FC<ConsensusTreeDialogProps> = ({ trees, sourceLabel, onCreate, onClose, onDownload }) => {
  const usable = trees.filter((d) => newickOf(d));
  let tips: string[] = [];
  try { tips = usable.length ? leafNames(parseNewick(newickOf(usable[0])!)) : []; } catch { tips = []; }
  return (
    <OperationDialog
      operationId="consensus-tree"
      title="Consensus Tree…"
      runLabel="Build Consensus"
      transientKeys={['outgroup', 'resultName']}
      defaults={{ threshold: 50, burnin: 0, outgroup: '', resultName: '' }}
      onDownload={onDownload}
      summary={<span><strong>{usable.length}</strong> tree document{usable.length === 1 ? '' : 's'} selected{trees.length > usable.length ? ` (${trees.length - usable.length} other documents ignored)` : ''}</span>}
      validate={(v) => {
        if (usable.length < 2) return 'Select two or more tree documents (for example bootstrap or MrBayes trees) in the table.';
        const t = Number(v.threshold);
        if (!(t >= 50 && t <= 100)) return 'The support threshold must be 50–100%.';
        if (!(Number(v.burnin) >= 0 && Number(v.burnin) < 100)) return 'Burn-in must be 0–99%.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Support threshold:" htmlFor="opdlg-ct-thr" hint="Clades found in at least this share of the trees are kept (50% = majority rule, 100% = strict consensus). Node labels give the % of trees containing each clade.">
            <div className="prefs-row">
              <input id="opdlg-ct-thr" type="number" min={50} max={100} style={{ width: 80 }} value={Number(v.threshold)} onChange={(e) => set('threshold', Number(e.target.value))} />
              <span>%</span>
            </div>
          </OptionRow>
          <OptionRow label="Burn-in:" htmlFor="opdlg-ct-burn" hint="Ignore this share of the trees from the start of the list (e.g. MCMC samples).">
            <div className="prefs-row">
              <input id="opdlg-ct-burn" type="number" min={0} max={99} style={{ width: 80 }} value={Number(v.burnin)} onChange={(e) => set('burnin', Number(e.target.value))} />
              <span>%</span>
            </div>
          </OptionRow>
          <OptionRow label="Root with outgroup:" htmlFor="opdlg-ct-out">
            <select id="opdlg-ct-out" value={String(v.outgroup)} onChange={(e) => set('outgroup', e.target.value)}>
              <option value="">No outgroup</option>
              {tips.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Result name:" htmlFor="opdlg-ct-name">
            <input id="opdlg-ct-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} consensus tree`} onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        onCreate(runConsensusTree(usable, v, { sourceLabel }).created[0]);
      }}
      onClose={onClose}
    />
  );
};
