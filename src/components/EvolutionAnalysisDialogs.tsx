// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Evolution analysis windows and their analysis options:
 *   Distances → Compute Distances…   (pairwise / overall / within / between / net between)
 */

import React from 'react';
import { OperationDialog, OptionRow, type SetOption } from './OperationDialog';
import { MSA_ALGORITHMS, calibrationsOf, groupOf, newickOf, runComputeTimetree, runComputeDistances, runCondenseTree, runGeneDuplications, runHighlightSites, alignmentRowsOf, type OperationResult } from '../core/operationRunners';
import { SITE_CATEGORY_LABELS, type SiteCategory } from '../core/siteCategories';
import { GENETIC_CODE_NAMES } from '../core/alignmentViewModel';
import { isPreAlignedInputSet } from '../core/documentViews';
import type { OptionValues } from '../core/optionProfiles';
import { EXAMPLE_DATASETS } from '../core/exampleDatasets';
import { leafNames, parseNewick } from '../core/treeConsensus';
import { EVO_ANALYSIS_TITLES, MODEL_ANALYSES, runEvolutionAnalysis, type EvoAnalysis } from '../core/evolutionAnalyses';
import type { SequenceDocument } from '../types/bio';

export const DATA_SUBSET_DEFAULTS: OptionValues = { gaps: 'pairwise', coveragePct: 95, pos1: true, pos2: true, pos3: true };

/** "Data Subset to Use": gaps/missing data treatment and codon positions. */
export function DataSubsetOptions({ v, set, isProtein }: { v: OptionValues; set: SetOption; isProtein: boolean }) {
  return (
    <>
      <OptionRow label="Gaps / missing data:" htmlFor="opdlg-ds-gaps" hint={
        v.gaps === 'complete' ? 'Every site with a gap or missing base in any sequence is removed before the analysis.'
          : v.gaps === 'partial' ? 'Sites are removed when fewer than the cutoff share of sequences have a residue there.'
          : 'All sites are kept; each pairwise comparison ignores only its own gaps.'}>
        <div className="prefs-row">
          <select id="opdlg-ds-gaps" value={String(v.gaps)} onChange={(e) => set('gaps', e.target.value)}>
            <option value="pairwise">Pairwise deletion</option>
            <option value="complete">Complete deletion</option>
            <option value="partial">Partial deletion</option>
          </select>
          {v.gaps === 'partial' && (
            <>
              <span>site coverage ≥</span>
              <input aria-label="Site coverage cutoff" type="number" min={1} max={100} style={{ width: 70 }} value={Number(v.coveragePct)}
                onChange={(e) => set('coveragePct', Math.max(1, Math.min(100, Number(e.target.value) || 95)))} />
              <span>%</span>
            </>
          )}
        </div>
      </OptionRow>
      {!isProtein && (
        <OptionRow label="Codon positions:" hint="Counted from the first alignment column. Untick positions to leave them out.">
          <div className="prefs-row">
            {(['pos1', 'pos2', 'pos3'] as const).map((k, i) => (
              <label key={k} className="mbc-check-row">
                <input type="checkbox" checked={v[k] !== false} onChange={(e) => set(k, e.target.checked)} />
                <span>{i + 1}{['st', 'nd', 'rd'][i]}</span>
              </label>
            ))}
          </div>
        </OptionRow>
      )}
    </>
  );
}

export const DISTANCE_MODELS_NUC = [
  'p-distance',
  'Jukes-Cantor (JC69)',
  'Kimura 2-parameter (K2P)',
  'Tamura 3-parameter (T92)',
  'Tamura-Nei (TN93)',
  'Maximum Composite Likelihood (MCL)',
];
export const DISTANCE_MODELS_PROT = ['p-distance', 'Poisson correction'];

export interface ComputeDistancesDialogProps {
  inputs: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  initialAnalysis?: string;
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const ComputeDistancesDialog: React.FC<ComputeDistancesDialogProps> = ({ inputs, sourceLabel, folder, initialAnalysis, onCreate, onClose, onDownload }) => {
  const isProtein = inputs[0]?.moleculeType === 'Protein';
  const groups = new Set(inputs.map(groupOf).filter(Boolean));
  const aligned = isPreAlignedInputSet(inputs);
  return (
    <OperationDialog
      operationId="compute-distances"
      title="Compute Distances…"
      runLabel="Compute"
      transientKeys={['resultName']}
      defaults={{
        analysis: initialAnalysis ?? 'pairwise',
        model: isProtein ? 'p-distance' : 'Maximum Composite Likelihood (MCL)',
        withSE: false,
        alignFirst: '',
        resultName: '',
        ...DATA_SUBSET_DEFAULTS,
      }}
      onDownload={onDownload}
      summary={<span><strong>{inputs.length}</strong> sequences from <strong>{sourceLabel}</strong>{groups.size ? ` · ${groups.size} groups` : ' · no groups'}{aligned ? '' : ' · will be aligned first'}</span>}
      validate={(v) => {
        if (inputs.length < 2) return 'Select at least two sequences (or an alignment).';
        if (['within', 'between', 'net'].includes(String(v.analysis)) && groups.size < (v.analysis === 'within' ? 1 : 2)) {
          return 'Group means need groups: give sequences a "Group" metadata field (File → Import → Metadata from Spreadsheet) or "Group: X" in the description.';
        }
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Compute:" htmlFor="opdlg-cd-what">
            <select id="opdlg-cd-what" value={String(v.analysis)} onChange={(e) => set('analysis', e.target.value)}>
              <option value="pairwise">Pairwise distances (matrix)</option>
              <option value="overall">Overall mean distance</option>
              <option value="within">Within-group mean distances</option>
              <option value="between">Between-group mean distances</option>
              <option value="net">Net between-group mean distances (Da)</option>
            </select>
          </OptionRow>
          <OptionRow label="Substitution model:" htmlFor="opdlg-cd-model">
            <select id="opdlg-cd-model" value={String(v.model)} onChange={(e) => set('model', e.target.value)}>
              {(isProtein ? DISTANCE_MODELS_PROT : DISTANCE_MODELS_NUC).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Variance:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.withSE)} onChange={(e) => set('withSE', e.target.checked)} />
              <span>Also report standard errors</span>
            </label>
          </OptionRow>
          <DataSubsetOptions v={v} set={set} isProtein={isProtein} />
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          {!aligned && (
            <OptionRow label="Align first with:" htmlFor="opdlg-cd-align">
              <select id="opdlg-cd-align" value={String(v.alignFirst)} onChange={(e) => set('alignFirst', e.target.value)}>
                {MSA_ALGORITHMS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </OptionRow>
          )}
          <OptionRow label="Result name:" htmlFor="opdlg-cd-name">
            <input id="opdlg-cd-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} distances`} onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runComputeDistances(inputs, v, { sourceLabel, folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Condense Tree ─────────────────────────────

const treeDocsOf = (docs: SequenceDocument[]) => docs.filter((d) => newickOf(d));

export interface CondenseTreeDialogProps {
  trees: SequenceDocument[];
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const CondenseTreeDialog: React.FC<CondenseTreeDialogProps> = ({ trees, onCreate, onClose, onDownload }) => {
  const usable = treeDocsOf(trees);
  return (
    <OperationDialog
      operationId="condense-tree"
      title="Condense Tree…"
      runLabel="Condense"
      transientKeys={['treeId', 'resultName']}
      defaults={{ treeId: usable[0]?.id ?? '', cutoff: 50, resultName: '' }}
      onDownload={onDownload}
      summary={<span>Collapses interior branches with low bootstrap or other support into multifurcations, so only reliable branching remains.</span>}
      validate={() => (usable.length ? null : 'Select a tree document with support values.')}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Tree:" htmlFor="opdlg-ct-tree">
            <select id="opdlg-ct-tree" value={String(v.treeId)} onChange={(e) => set('treeId', e.target.value)}>
              {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Collapse below:" htmlFor="opdlg-ct-cut" hint="Branch lengths of collapsed branches are added to their children; use the topology, not the lengths, of a condensed tree.">
            <div className="prefs-row">
              <input id="opdlg-ct-cut" type="number" min={1} max={100} style={{ width: 70 }} value={Number(v.cutoff)} onChange={(e) => set('cutoff', Number(e.target.value))} />
              <span>% support</span>
            </div>
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runCondenseTree(usable.find((d) => d.id === v.treeId) ?? usable[0], v, { sourceLabel: 'tree' }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Gene Duplication Inference ─────────────────────────────

export interface GeneDuplicationDialogProps {
  trees: SequenceDocument[];
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const GeneDuplicationDialog: React.FC<GeneDuplicationDialogProps> = ({ trees, onCreate, onClose, onDownload }) => {
  const usable = treeDocsOf(trees);
  return (
    <OperationDialog
      operationId="gene-duplications"
      title="Gene Duplication Inference…"
      runLabel="Infer"
      transientKeys={['geneId', 'speciesId', 'mapText', 'resultName']}
      defaults={{ geneId: usable[0]?.id ?? '', speciesId: usable[1]?.id ?? '', speciesFrom: 'suffix', separator: '_', mapText: '', reroot: false, resultName: '' }}
      onDownload={onDownload}
      summary={<span>Marks each gene-tree node as a duplication (D) or speciation (S) by reconciling it with a trusted species tree.</span>}
      validate={(v) => {
        if (usable.length < 2) return 'Select the gene tree and the species tree (two tree documents).';
        if (v.geneId === v.speciesId) return 'Choose different trees for the gene tree and the species tree.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Gene tree:" htmlFor="opdlg-gd-gene">
            <select id="opdlg-gd-gene" value={String(v.geneId)} onChange={(e) => set('geneId', e.target.value)}>
              {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Species tree:" htmlFor="opdlg-gd-sp">
            <select id="opdlg-gd-sp" value={String(v.speciesId)} onChange={(e) => set('speciesId', e.target.value)}>
              {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Species of each gene:" hint="Taken from the gene name, e.g. HBA_Human → Human (after the last separator). A pasted map overrides this.">
            <div className="prefs-row">
              <select aria-label="Species part of the name" value={String(v.speciesFrom)} onChange={(e) => set('speciesFrom', e.target.value)}>
                <option value="suffix">Text after the last</option>
                <option value="prefix">Text before the first</option>
              </select>
              <input aria-label="Separator" type="text" style={{ width: 50 }} value={String(v.separator)} onChange={(e) => set('separator', e.target.value)} />
            </div>
          </OptionRow>
          <OptionRow label="Root:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.reroot)} onChange={(e) => set('reroot', e.target.checked)} />
              <span>Root the gene tree where it needs the fewest duplications</span>
            </label>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <OptionRow label="Tip-to-species map:" htmlFor="opdlg-gd-map" hint="One line per gene: name, then a tab, comma or = and the species name.">
          <textarea id="opdlg-gd-map" rows={4} style={{ width: '100%' }} value={String(v.mapText)} onChange={(e) => set('mapText', e.target.value)} />
        </OptionRow>
      )}
      onRun={(v) => {
        const gene = usable.find((d) => d.id === v.geneId)!;
        const species = usable.find((d) => d.id === v.speciesId)!;
        onCreate(runGeneDuplications(gene, species, v, { sourceLabel: gene.name }));
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Example data ─────────────────────────────

export interface ExamplesDialogProps {
  library: SequenceDocument[];
  onCreate: (docs: SequenceDocument[], summary: string) => void;
  onClose: () => void;
}

export const ExamplesDialog: React.FC<ExamplesDialogProps> = ({ library, onCreate, onClose }) => (
  <OperationDialog
    operationId="load-examples"
    title="Load Example Data…"
    runLabel="Add to Project"
    defaults={Object.fromEntries(EXAMPLE_DATASETS.map((e) => [e.id, true]))}
    summary={<span>Example datasets for the evolutionary analyses, added to the current project.</span>}
    validate={(v) => (EXAMPLE_DATASETS.some((e) => v[e.id]) ? null : 'Choose at least one example.')}
    renderOptions={(v, set) => (
      <>
        {EXAMPLE_DATASETS.map((e) => (
          <OptionRow key={e.id} label={e.title} hint={`${e.description} Try: ${e.tryWith}`}>
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v[e.id])} onChange={(ev) => set(e.id, ev.target.checked)} />
              <span>Add</span>
            </label>
          </OptionRow>
        ))}
      </>
    )}
    onRun={(v) => {
      const chosen = EXAMPLE_DATASETS.filter((e) => v[e.id]);
      const docs = chosen.flatMap((e) => e.build(library));
      if (!docs.length) throw new Error('The sample documents these examples are built from are not available.');
      onCreate(docs, `Added ${docs.length} example document${docs.length === 1 ? '' : 's'}: ${chosen.map((e) => e.title).join('; ')}`);
    }}
    onClose={onClose}
  />
);

// ───────────────────────────── Highlight Sites ─────────────────────────────

export interface HighlightSitesDialogProps {
  doc: SequenceDocument;
  onApply: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const HighlightSitesDialog: React.FC<HighlightSitesDialogProps> = ({ doc, onApply, onClose, onDownload }) => {
  const rows = alignmentRowsOf(doc);
  const isProtein = doc.moleculeType === 'Protein';
  const cats = (Object.keys(SITE_CATEGORY_LABELS) as SiteCategory[]).filter((c) => !isProtein || !c.endsWith('fold'));
  return (
    <OperationDialog
      operationId="highlight-sites"
      title="Highlight Sites…"
      runLabel="Highlight"
      defaults={{ conserved: false, variable: true, singleton: false, parsimony: true, 'zero-fold': false, 'two-fold': false, 'four-fold': false, geneticCode: GENETIC_CODE_NAMES[0] }}
      onDownload={onDownload}
      summary={rows ? <span><strong>{doc.name}</strong> · {rows.length} sequences × {rows[0].sequence.length.toLocaleString()} sites</span> : <span>Open an aligned document first.</span>}
      validate={(v) => (!rows ? 'Highlight Sites works on an aligned document.' : cats.some((c) => v[c]) ? null : 'Choose at least one site category.')}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Site categories:" hint="Each chosen category is annotated on the alignment and counted (gaps and missing data are ignored; degenerate sites use codons from the first column).">
            <div className="mbc-wf-custom-grid">
              {cats.map((c) => (
                <label key={c} className="mbc-check-row">
                  <input type="checkbox" checked={Boolean(v[c])} onChange={(e) => set(c, e.target.checked)} />
                  <span>{SITE_CATEGORY_LABELS[c]}</span>
                </label>
              ))}
            </div>
          </OptionRow>
          {!isProtein && (v['zero-fold'] || v['two-fold'] || v['four-fold']) && (
            <OptionRow label="Genetic code:" htmlFor="opdlg-hs-code">
              <select id="opdlg-hs-code" value={String(v.geneticCode)} onChange={(e) => set('geneticCode', e.target.value)}>
                {GENETIC_CODE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </OptionRow>
          )}
        </>
      )}
      onRun={(v) => onApply(runHighlightSites(doc, v))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Models / Diversity / Selection / Rates / Ancestors / Clocks ─────────────────────────────

export interface EvolutionAnalysisDialogProps {
  kind: EvoAnalysis;
  inputs: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  initial?: OptionValues;
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

const EVO_HINTS: Record<EvoAnalysis, string> = {
  models: 'Substitution models, substitution pattern and composition.',
  diversity: 'Nei (1987) nucleotide diversity; between-population statistics use the sequences’ groups.',
  selection: 'Codon-based tests on a coding alignment (codons counted from column 1).',
  rates: 'Discrete-gamma rate heterogeneity among sites and the relative rate of each site.',
  ancestors: 'Ancestral states on the NJ tree of the alignment.',
  clocks: 'Tests of the molecular clock (for a calibrated timetree use Tree → Compute Timetree…).',
};

export const EvolutionAnalysisDialog: React.FC<EvolutionAnalysisDialogProps> = ({ kind, inputs, sourceLabel, folder, initial, onCreate, onClose, onDownload }) => {
  const isProtein = inputs[0]?.moleculeType === 'Protein';
  const aligned = isPreAlignedInputSet(inputs);
  const groups = new Set(inputs.map(groupOf).filter(Boolean));
  const min = kind === 'clocks' ? 3 : 2;
  const dnaOnly = kind !== 'diversity' && kind !== 'rates';
  return (
    <OperationDialog
      operationId={`evo-${kind}`}
      title={`${EVO_ANALYSIS_TITLES[kind]}…`}
      runLabel="Compute"
      transientKeys={['resultName']}
      defaults={{
        analysis: 'best',
        model: isProtein ? 'p-distance' : 'Maximum Composite Likelihood (MCL)',
        test: kind === 'clocks' ? 'ml' : 'z-neutral',
        categories: 5,
        method: 'ml',
        siteProbabilities: false,
        alignFirst: '',
        resultName: '',
        ...DATA_SUBSET_DEFAULTS,
        ...(initial ?? {}),
      }}
      onDownload={onDownload}
      summary={(v) => {
        const ownFrame = kind === 'models' && v.analysis === 'rscu';
        const alignNote = aligned
          ? ''
          : ownFrame
            ? ' · each sequence read in its own frame (not aligned)'
            : ' · will be aligned first';
        return (
          <>
            <span><strong>{inputs.length}</strong> sequences from <strong>{sourceLabel}</strong>{groups.size ? ` · ${groups.size} groups` : ''}{alignNote}</span>
            <div className="mbc-opdlg-muted">{EVO_HINTS[kind]}</div>
          </>
        );
      }}
      validate={(v) => {
        if (inputs.length < min) return `Select at least ${min} sequences (or an alignment).`;
        if (dnaOnly && kind !== 'models' && isProtein) return `${EVO_ANALYSIS_TITLES[kind]} needs nucleotide sequences.`;
        if (kind === 'models' && isProtein && v.analysis !== 'best') return 'This analysis needs nucleotide sequences.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          {kind === 'models' && (
            <OptionRow label="Analysis:" htmlFor="opdlg-evo-what">
              <select id="opdlg-evo-what" value={String(v.analysis)} onChange={(e) => set('analysis', e.target.value)}>
                {Object.entries(MODEL_ANALYSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </OptionRow>
          )}
          {kind === 'diversity' && (
            <OptionRow label="Substitution model:" htmlFor="opdlg-evo-model">
              <select id="opdlg-evo-model" value={String(v.model)} onChange={(e) => set('model', e.target.value)}>
                {(isProtein ? DISTANCE_MODELS_PROT : DISTANCE_MODELS_NUC).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </OptionRow>
          )}
          {kind === 'selection' && (
            <OptionRow label="Test:" htmlFor="opdlg-evo-test">
              <select id="opdlg-evo-test" value={String(v.test)} onChange={(e) => set('test', e.target.value)}>
                <option value="z-neutral">Codon-based Z-test: neutrality (dN = dS)</option>
                <option value="z-positive">Codon-based Z-test: positive selection (dN &gt; dS)</option>
                <option value="z-purifying">Codon-based Z-test: purifying selection (dN &lt; dS)</option>
                <option value="fisher">Codon-based Fisher’s exact test</option>
                <option value="tajima">Tajima’s test of neutrality</option>
                <option value="codons">Codon-by-codon pN − pS</option>
              </select>
            </OptionRow>
          )}
          {kind === 'rates' && (
            <OptionRow label="Gamma categories:" htmlFor="opdlg-evo-cats">
              <input id="opdlg-evo-cats" type="number" min={2} max={16} style={{ width: 70 }}
                value={Number(v.categories)} onChange={(e) => set('categories', Math.max(2, Math.min(16, Number(e.target.value) || 5)))} />
            </OptionRow>
          )}
          {kind === 'ancestors' && (
            <>
              <OptionRow label="Method:" htmlFor="opdlg-evo-anc">
                <select id="opdlg-evo-anc" value={String(v.method)} onChange={(e) => set('method', e.target.value)}>
                  <option value="ml">Maximum Likelihood (empirical Bayes)</option>
                  <option value="mp">Maximum Parsimony (Fitch)</option>
                </select>
              </OptionRow>
              <OptionRow label="Output:">
                <label className="mbc-check-row">
                  <input type="checkbox" checked={Boolean(v.siteProbabilities)} onChange={(e) => set('siteProbabilities', e.target.checked)} />
                  <span>Include root state probabilities for every site</span>
                </label>
              </OptionRow>
            </>
          )}
          {kind === 'clocks' && (
            <OptionRow label="Test:" htmlFor="opdlg-evo-clock">
              <select id="opdlg-evo-clock" value={String(v.test)} onChange={(e) => set('test', e.target.value)}>
                <option value="ml">Molecular clock test (ML likelihood ratio)</option>
                <option value="relative">Tajima’s relative rate test</option>
              </select>
            </OptionRow>
          )}
          {kind === 'selection' || (kind === 'models' && v.analysis === 'rscu')
            ? <OptionRow label="Data subset:"><span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>All columns are used so codons stay in frame (gaps are handled per codon pair).</span></OptionRow>
            : <DataSubsetOptions v={v} set={set} isProtein={isProtein} />}
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          {/* Codon usage reads each unaligned input on its own and aligns nothing (D0097), so no aligner is offered. */}
          {!aligned && (kind === 'models' && v.analysis === 'rscu'
            ? (
              <OptionRow label="Align first with:">
                <span className="mbc-opdlg-muted" style={{ paddingTop: 5 }}>Does not apply: codon usage reads each sequence on its own, in triplets from its first base, so nothing is aligned.</span>
              </OptionRow>
            )
            : (
              <OptionRow label="Align first with:" htmlFor="opdlg-evo-align">
                <select id="opdlg-evo-align" value={String(v.alignFirst)} onChange={(e) => set('alignFirst', e.target.value)}>
                  {MSA_ALGORITHMS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </OptionRow>
            ))}
          <OptionRow label="Result name:" htmlFor="opdlg-evo-name" hint="Saved as a text document in the current folder.">
            <input id="opdlg-evo-name" type="text" value={String(v.resultName)} placeholder={`${sourceLabel} ${EVO_ANALYSIS_TITLES[kind].toLowerCase()}`}
              onChange={(e) => set('resultName', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runEvolutionAnalysis(inputs, kind, v, { sourceLabel, folder }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Compute Timetree ─────────────────────────────

export interface TimetreeDialogProps {
  treeDoc: SequenceDocument | null;
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const TimetreeDialog: React.FC<TimetreeDialogProps> = ({ treeDoc, onCreate, onClose, onDownload }) => {
  const nw = treeDoc ? newickOf(treeDoc) : null;
  const hasAlignment = (treeDoc?.alignmentMeta?.sequences?.length ?? 0) >= 3;
  let tips: string[] = [];
  try { tips = nw ? leafNames(parseNewick(nw)) : []; } catch { tips = []; }
  return (
    <OperationDialog
      operationId="timetree"
      title="Compute Timetree…"
      runLabel="Compute"
      transientKeys={['resultName', 'calibrations', 'outgroup']}
      defaults={{ outgroup: '', calibrations: '[]', method: 'reltime', ci: false, ciReplicates: 100, resultName: '' }}
      onDownload={onDownload}
      summary={nw
        ? <span><strong>{treeDoc!.name}</strong> · {tips.length} tips{hasAlignment ? ' · alignment available for intervals' : ''}. Calibrations set the time scale.</span>
        : <span>Select a tree document with branch lengths (for example from Build Tree…).</span>}
      validate={(v) => {
        if (!nw) return 'Compute Timetree works on a tree document.';
        if (tips.length < 3) return 'The tree needs at least three tips.';
        const cals = calibrationsOf(v);
        for (const c of cals) {
          if (c.taxonA === c.taxonB) return 'Each calibration needs two different taxa (their most recent common ancestor is calibrated).';
          if (c.taxonA === v.outgroup || c.taxonB === v.outgroup) return 'Calibrations must use ingroup taxa (the outgroup is left out of the timetree).';
          if (c.minAge !== null && c.maxAge !== null && c.minAge > c.maxAge) return 'A calibration’s minimum age is above its maximum.';
        }
        return null;
      }}
      renderOptions={(v, set) => {
        const cals = calibrationsOf(v);
        const raw = (() => { try { return JSON.parse(String(v.calibrations ?? '[]')) as Record<string, string>[]; } catch { return []; } })();
        const save = (rows: Record<string, string>[]) => set('calibrations', JSON.stringify(rows));
        const edit = (i: number, key: string, value: string) => save(raw.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
        return (
          <>
            <OptionRow label="Method:" htmlFor="opdlg-tt-method" hint={v.method === 'mpl' ? 'Node age = mean path length to its tips, relative to the root.' : 'Sister lineages get rates in the ratio of their lineage lengths; the ancestral rate is their geometric mean (RelTime framework).'}>
              <select id="opdlg-tt-method" value={String(v.method)} onChange={(e) => set('method', e.target.value)}>
                <option value="reltime">RelTime-style relative rates</option>
                <option value="mpl">Mean path length</option>
              </select>
            </OptionRow>
            <OptionRow label="Intervals:" hint={hasAlignment ? 'Bootstrap the alignment the tree was built from; calibrations with a range are sampled within it.' : 'Needs the tree’s alignment: available for trees made with Build Tree.'}>
              <div className="prefs-row">
                <label className="mbc-check-row"><input type="checkbox" disabled={!hasAlignment} checked={Boolean(v.ci) && hasAlignment} onChange={(e) => set('ci', e.target.checked)} /> 95% intervals from</label>
                <input aria-label="Interval replicates" type="number" min={20} max={1000} step={10} style={{ width: 70 }} disabled={!hasAlignment || !v.ci}
                  value={Number(v.ciReplicates)} onChange={(e) => set('ciReplicates', Math.max(20, Math.min(1000, Number(e.target.value) || 100)))} />
                <span>replicates</span>
              </div>
            </OptionRow>
            <OptionRow label="Outgroup:" htmlFor="opdlg-tt-out" hint="Roots the tree; the outgroup is then left out of the timetree.">
              <select id="opdlg-tt-out" value={String(v.outgroup)} onChange={(e) => set('outgroup', e.target.value)}>
                <option value="">None (use the tree’s root)</option>
                {tips.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </OptionRow>
            <OptionRow label="Calibrations:" hint={cals.length ? 'Each calibration constrains the age of the most recent common ancestor of two taxa (Mya). Leave a bound empty for no limit.' : 'Without calibrations, ages are relative (root = 1).'}>
              <div style={{ display: 'grid', gap: 6 }}>
                {raw.map((r, i) => (
                  <div key={i} className="prefs-row" style={{ flexWrap: 'wrap' }}>
                    <span>MRCA of</span>
                    <select aria-label={`Calibration ${i + 1} taxon A`} value={r.taxonA ?? ''} onChange={(e) => edit(i, 'taxonA', e.target.value)}>
                      {tips.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span>and</span>
                    <select aria-label={`Calibration ${i + 1} taxon B`} value={r.taxonB ?? ''} onChange={(e) => edit(i, 'taxonB', e.target.value)}>
                      {tips.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input aria-label={`Calibration ${i + 1} minimum age`} type="number" min={0} step="any" placeholder="min" style={{ width: 70 }}
                      value={r.minAge ?? ''} onChange={(e) => edit(i, 'minAge', e.target.value)} />
                    <span>–</span>
                    <input aria-label={`Calibration ${i + 1} maximum age`} type="number" min={0} step="any" placeholder="max" style={{ width: 70 }}
                      value={r.maxAge ?? ''} onChange={(e) => edit(i, 'maxAge', e.target.value)} />
                    <span>Mya</span>
                    <button type="button" className="mbc-btn mbc-btn-ghost" onClick={() => save(raw.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                <div>
                  <button type="button" className="mbc-btn" disabled={tips.length < 2}
                    onClick={() => save([...raw, { taxonA: tips[0] ?? '', taxonB: tips[tips.length - 1] ?? '', minAge: '', maxAge: '' }])}>
                    Add calibration
                  </button>
                </div>
              </div>
            </OptionRow>
            <OptionRow label="Result name:" htmlFor="opdlg-tt-name" hint="Saves the timetree and a divergence-time table in the current folder.">
              <input id="opdlg-tt-name" type="text" value={String(v.resultName)} placeholder={`${treeDoc?.name ?? 'Tree'} timetree`}
                onChange={(e) => set('resultName', e.target.value)} />
            </OptionRow>
          </>
        );
      }}
      onRun={async (v, signal) => onCreate(await runComputeTimetree(treeDoc!, { ...v, ci: Boolean(v.ci) && hasAlignment }, { sourceLabel: treeDoc!.name, signal }))}
      onClose={onClose}
    />
  );
};
