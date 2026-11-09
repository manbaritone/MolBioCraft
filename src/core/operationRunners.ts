// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Headless operation runners shared by the options windows and Workflows.
 * Each takes input documents and option values and returns the documents it created
 * or changed; nothing here touches the UI.
 */

import { runValidatedAlignment } from './alignmentExecution';
import { computeAlignmentConsensusAndIdentity } from './alignmentAnalysis';
import { addSequencesToAlignment, columnRuns, columnsToMask, stripColumns, translationAlign, type MaskContent, type MaskOptions } from './alignmentTools';
import { calculatePrimerMetrics, findORFs, mapReadAndCallVariants, runLocalBlastSearch, simulateRestrictionDigest, testSavedPrimersOnSequence } from './bioEngine';
import { parsePrimerSpreadsheet } from './primerImport';
import { analyzeEditing } from './crisprEditing';
import { differentialExpression, type CountTable } from './expression';
import { queryCentricRows } from './localBlastDb';
import { countTableTsv, geneRegions, sampleLevels } from './expressionLevels';
import { findStructuralVariants, type SvCall, type SvType } from './structuralVariants';
import { autoSizeStandard, averageBins, calibrateLadder, callAlleles, parseFsa, parsePanel, saturatedScans, SIZE_STANDARDS, sizeStandard, sizingWarning, type FragmentTrace, type LadderBins, type Sizing } from './fragmentAnalysis';
import { mapReadsToReference, type ReferenceContig } from './referenceMapping';
import { compareAnnotations, mateOf, mergePair, type ComparisonStatus } from './annotationReadTools';
import { formatQcReport, readQcModules } from './readQc';
import { renamedValue, type BatchRenameOptions } from './documentManagement';
import { runExternalTree, isExternalTreeAlgorithm } from './externalTreePrograms';
import { runBbdukReadTrimming, runDeNovoAssembly } from './genomicsAndStructureSuite';
import { analyzeUserTree, computeEvolutionaryDistances, constructPhylogeneticTree, mlTreeSearch, type PhyloTreeAlgorithm, type SubstitutionModelName } from './phyloEvoEngine';
import { applySiteSubset, siteSubsetOptionsOf } from './siteSubset';
import { classifySites, SITE_CATEGORY_LABELS, type SiteCategory } from './siteCategories';
import { createTreeDocument } from './treeDocuments';
import { designDegeneratePrimers, DEGENERATE_DEFAULTS, type DegenerateOptions, type DegeneratePrimer } from './degeneratePrimers';
import { annotateFromDocuments, featureCover, sameCoveredSite } from './annotateFromDocuments';
import { rotateToReference } from './circularAlignment';
import { computeTimetree, timetreeConfidence, TIMETREE_METHODS, type Calibration, type TimetreeMethod, type TimetreeResult } from './timetree';
import { fromTreeNode, fullMatrix, labelRootedSupport, resampledSupport, rng, searchTree, supportFor, type Resampling } from './treeSearch';
import { midpointRoot } from './treeLayout';
import { translateCodon } from './alignmentViewModel';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { alignStructures, recordName, structureAlignmentMatrixJson, structureAlignmentMethodOf, structureEntryId, type StructureAlignment } from './structureAlignment';
import { structureTextOf } from './structureModels';
import { isPreAlignedInputSet } from './documentViews';
import { condenseTree, consensusTree, inferDuplications, leafNames, parseNewick, rerootAtOutgroup, rootMinimizingDuplications, toNewick } from './treeConsensus';
import type { OptionValues } from './optionProfiles';
import type { BlastHitRecord, DigestFragment, PrimerRecord, SequenceDocument, SequenceFeature } from '../types/bio';

export interface OperationResult {
  created: SequenceDocument[];
  updated: SequenceDocument[];
  summary: string;
}

export interface RunContext {
  /** Label used in default result names ("HIV env", "3 selected sequences"). */
  sourceLabel: string;
  folder?: string;
  signal?: AbortSignal;
}

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (v: string | number | boolean | undefined) => Number(v);
const folderOf = (f: string | undefined, fallback: SequenceDocument['folder']) => (f ?? fallback) as SequenceDocument['folder'];

/**
 * A saved result document that keeps its engine warnings (D0005) in its notes: a `Warnings:` block,
 * one `- ` line per warning (each once, blanks dropped), after any notes it already has. The same
 * document, untouched, when there is no warning to keep. Multiple Alignment, Build Tree (its
 * little-bootstrap support caveat included) and Compute Timetree (its tree and its report) keep
 * their warnings this way, not in metadata rows.
 *
 * ResultWarnings has no saved-document source: the notes are free text the researcher can edit, and
 * nothing reads the block back, so a reopened result shows its warnings in its notes on the Info
 * tab, not beside the result.
 */
export function withWarningNotes<T extends SequenceDocument>(doc: T, warnings: readonly string[] | undefined): T {
  const kept = [...new Set((warnings ?? []).map((w) => w.trim()).filter(Boolean))];
  if (!kept.length) return doc;
  const prior = String(doc.docMetadata?.Notes ?? '').replace(/\s+$/, '');
  const block = ['Warnings:', ...kept.map((w) => `- ${w}`)].join('\n');
  return { ...doc, docMetadata: { ...doc.docMetadata, Notes: `${prior ? `${prior}\n\n` : ''}${block}\n` } };
}

export type MsaPresetId =
  | ''
  | 'consistency-nj'
  | 'consistency-upgma'
  | 'progressive-upgma'
  | 'graph-backbone';

/**
 * Maps a preset identifier or a legacy saved preset label from an earlier version to the canonical
 * preset identifier in `MSA_ALGORITHMS` (BG-01M6XRYR).
 */
export function normalizeMsaPresetId(v: unknown): MsaPresetId {
  const s = String(v ?? '').trim();
  const up = s.toUpperCase();
  if (!up) return '';
  if (up.includes('CONSISTENCY-NJ') || up.includes('MAFFT')) return 'consistency-nj';
  if (up.includes('CONSISTENCY-UPGMA') || up.includes('MUSCLE')) return 'consistency-upgma';
  if (up.includes('PROGRESSIVE-UPGMA') || up.includes('CLUSTAL')) return 'progressive-upgma';
  if (up.includes('GRAPH-BACKBONE') || up.includes('POA')) return 'graph-backbone';
  return '';
}

/**
 * The MSA presets the Align dialog offers, each described as the route
 * `run_multiple_sequence_alignment_with_algorithm` actually takes for it
 * (crates/molbiocraft-align/src/poa_and_banded.rs), because a run records its preset's `label` as
 * the result document's `Alignment method`: provenance, not a tooltip. Each preset carries a
 * stable non-displayed identifier (`value`) separate from its displayed `label` (BG-01M6XRYR).
 * The empty preset is the only one that reaches plain center-star (the `run_msa` op sends an empty
 * algorithm to `run_multiple_sequence_alignment`); every other preset's center-star result is
 * computed and discarded, so none of their text may claim it.
 * src/__tests__/evolutionAnalyses.test.ts pins each description and identifier to that dispatch,
 * and src/components/AlignmentAndPhyloStudio.tsx describes the same presets — keep the two in step.
 */
export const MSA_ALGORITHMS: { value: MsaPresetId; label: string; hint: string }[] = [
  { value: '', label: 'Center-star (fast)', hint: 'Aligns every sequence to the most central one and reports a Neighbor-Joining tree. Fastest; good for closely related sequences.' },
  { value: 'consistency-nj', label: 'MAFFT-style consistency library (L-INS-i-like)', hint: 'Aligns every pair, builds a consistency library from them (as L-INS-i / T-Coffee), then aligns profiles progressively on that library with 2 refinement passes under a Neighbor-Joining guide tree. Above the library size gate — more than 120 sequences, or sequences too long for an all-pairs library — it falls back to the progressive route.' },
  { value: 'consistency-upgma', label: 'MUSCLE-style consistency library, UPGMA guide', hint: 'The same pairwise consistency library with 3 refinement passes and a UPGMA guide tree. Above the library size gate — more than 120 sequences, or sequences too long for an all-pairs library — it falls back to the progressive route.' },
  { value: 'progressive-upgma', label: 'Clustal-style profile progressive, UPGMA guide', hint: 'Profile-to-profile progressive alignment (BLOSUM62, affine gaps, Henikoff weights) up a UPGMA guide tree rebuilt from the first alignment, with 2 refinement passes.' },
  { value: 'graph-backbone', label: 'Partial-order graph backbone (POA)', hint: 'Builds a rust-bio partial-order graph consensus and aligns every sequence to it, keeping that result only when it scores better than the center-star alignment; Neighbor-Joining guide tree.' },
];
export const msaAlgo = (v: unknown) => {
  const id = normalizeMsaPresetId(v);
  return MSA_ALGORITHMS.find((o) => o.value === id) ?? MSA_ALGORITHMS[0];
};

export function moleculeWord(docs: readonly SequenceDocument[]): string {
  const t = docs[0]?.moleculeType;
  return t === 'Protein' ? 'protein' : t === 'RNA' ? 'RNA' : 'nucleotide';
}

/** Equal-length member rows of an aligned document, or null. */
export function alignmentRowsOf(doc: SequenceDocument): { id: string; name: string; sequence: string }[] | null {
  const members = doc.alignmentMeta?.sequences ?? [];
  if (members.length < 2 || doc.alignmentMeta?.isAligned === false) return null;
  const w = members[0].sequence.length;
  if (!members.every((m) => m.sequence.length === w)) return null;
  return members.map((m) => ({ id: m.id, name: m.name, sequence: m.sequence }));
}

function newAlignmentDoc(
  template: SequenceDocument,
  name: string,
  rows: { name: string; sequence: string; accession?: string; description?: string }[],
  operation: string,
  description: string,
  parentIds: string[],
  folder: string | undefined,
  meta: Record<string, string | number> = {}
): SequenceDocument {
  const t = now();
  const id = uid('aln');
  const consensus = computeAlignmentConsensusAndIdentity(rows, 'Majority', true, template.moleculeType === 'Protein').consensus;
  return {
    id,
    name,
    accession: '',
    description,
    moleculeType: template.moleculeType,
    topology: 'linear',
    sequence: consensus,
    features: [],
    primers: [],
    documentKind: 'alignment',
    alignmentMeta: {
      sequenceCount: rows.length,
      isAligned: true,
      sequences: rows.map((r, i) => ({ id: `${id}-m${i + 1}`, name: r.name, accession: r.accession || undefined, description: r.description || undefined, sequence: r.sequence })),
    },
    docMetadata: { 'Created by': operation, 'Aligned columns': consensus.length, ...meta },
    history: [{ id: uid('hist'), timestamp: t, operation, description, parentIds, lengthBp: consensus.length, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(folder ?? template.folder, 'Alignments'),
  };
}

// ───────────────────────────── alignment ─────────────────────────────

export function runMultipleAlignment(inputs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const algo = msaAlgo(v.algorithm);
  // Circular sequences: rotate (and reverse-complement when needed) to the first one's origin.
  const rotations: string[] = [];
  let seqs = inputs.map((d) => d.sequence);
  if (v.circular && inputs[0]?.moleculeType !== 'Protein') {
    const ref = inputs[0].sequence;
    seqs = inputs.map((d, i) => {
      if (i === 0 || (v.circular !== 'all' && d.topology !== 'circular')) return d.sequence;
      const r = rotateToReference(ref, d.sequence, d.moleculeType === 'RNA');
      if (r.votes === 0) { rotations.push(`${d.name}: no shared k-mers, not rotated`); return d.sequence; }
      if (r.offset || r.reversed) rotations.push(`${d.name}: ${r.reversed ? 'reverse-complemented, ' : ''}origin moved to ${r.offset + 1}`);
      return r.sequence;
    });
  }
  const exec = runValidatedAlignment(inputs.map((d, i) => ({ id: d.id, name: d.name, sequence: seqs[i], moleculeType: d.moleculeType })), algo.value);
  if (exec.error) throw new Error(exec.error);
  const byId = new Map(inputs.map((d) => [d.id, d]));
  const name = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} alignment`;
  const doc = withWarningNotes(newAlignmentDoc(inputs[0], name,
    exec.result.rows.map((r) => ({ name: r.name, sequence: r.alignedSeq, accession: byId.get(r.id)?.accession, description: byId.get(r.id)?.description })),
    'Multiple Alignment', `Multiple alignment of ${inputs.length} ${moleculeWord(inputs)} sequences (${algo.label})`,
    inputs.map((d) => d.id), ctx.folder, { 'Alignment method': algo.label, ...(v.circular ? { 'Circular rotation': rotations.length ? rotations.join('; ') : 'all sequences already share the origin' } : {}) }),
    exec.result.warnings);
  return { created: [doc], updated: [], summary: `Aligned ${inputs.length} sequences → ${doc.sequence.length.toLocaleString()} columns${rotations.length ? ` (${rotations.length} rotated to a common origin)` : ''}` };
}

export function runTranslationAlign(inputs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const frame = (num(v.frame) || 1) as 1 | 2 | 3;
  const algo = msaAlgo(v.algorithm);
  const res = translationAlign(inputs.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence })), frame, String(v.geneticCode ?? 'Standard'), algo.value);
  if (res.error) throw new Error(res.error);
  const name = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} translation alignment`;
  const doc = newAlignmentDoc(inputs[0], name, res.rows.map((r) => ({ name: r.name, sequence: r.nucleotide })), 'Translation Alignment',
    `Codon-preserving alignment: frame ${frame}, ${String(v.geneticCode ?? 'Standard')} code, proteins aligned with ${algo.label}`,
    inputs.map((d) => d.id), ctx.folder);
  return { created: [doc], updated: [], summary: `Translation alignment of ${inputs.length} sequences` };
}

export function maskOptionsOf(v: OptionValues): MaskOptions {
  return {
    content: String(v.content ?? 'none') as MaskContent,
    gapPct: num(v.gapPct ?? 50),
    codonPositions: [v.codon1 && 1, v.codon2 && 2, v.codon3 && 3].filter((x): x is number => typeof x === 'number'),
    charset: String(v.charset ?? ''),
  };
}

export function runMaskAlignment(doc: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult {
  const rows = alignmentRowsOf(doc);
  if (!rows) throw new Error(`${doc.name} is not an aligned document.`);
  const cols = columnsToMask(rows.map((r) => r.sequence), doc.moleculeType === 'Protein', maskOptionsOf(v));
  // Nothing to mask: pass the alignment on unchanged (a workflow keeps going).
  if (cols.size === 0) return { created: [], updated: [doc], summary: 'No columns matched; alignment unchanged' };
  if (v.action === 'annotate') {
    const t = now();
    const feats: SequenceFeature[] = columnRuns(cols).map(([s, e], i) => ({
      id: uid(`mask${i}`), name: 'Masked', type: 'misc_feature', start: s, end: e, strand: 0, color: '#94a3b8', notes: 'Masked by Mask Alignment',
    }));
    return {
      created: [],
      updated: [{
        ...doc,
        features: [...doc.features.filter((f) => f.notes !== 'Masked by Mask Alignment'), ...feats],
        updatedAt: t,
        history: [...doc.history, { id: uid('hist'), timestamp: t, operation: 'Mask Alignment', description: `${cols.size} columns annotated as Masked`, parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
      }],
      summary: `Annotated ${cols.size} masked columns`,
    };
  }
  if (cols.size >= rows[0].sequence.length) throw new Error('This would remove every column.');
  const stripped = stripColumns(rows.map((r) => r.sequence), cols);
  const out = newAlignmentDoc(doc, `${doc.name} (masked)`, rows.map((r, i) => ({ name: r.name, sequence: stripped[i] })), 'Mask Alignment',
    `${cols.size} of ${rows[0].sequence.length} columns removed`, [doc.id], ctx.folder);
  return { created: [out], updated: [], summary: `Removed ${cols.size} columns` };
}

export function runConsensus(doc: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult {
  const rows = alignmentRowsOf(doc);
  if (!rows) throw new Error(`${doc.name} is not an aligned document.`);
  let seq = computeAlignmentConsensusAndIdentity(rows, String(v.threshold ?? 'Majority'), v.ignoreGaps !== false, doc.moleculeType === 'Protein').consensus;
  if (v.stripGaps !== false) seq = seq.replace(/-/g, '');
  if (!seq.replace(/-/g, '')) throw new Error('The consensus would be empty.');
  const t = now();
  const created: SequenceDocument = {
    id: uid('cons'),
    name: String(v.resultName ?? '').trim() || `${doc.name} consensus`,
    accession: '',
    description: `Consensus of ${rows.length} sequences (${String(v.threshold ?? 'Majority')}${v.ignoreGaps !== false ? ', gaps ignored' : ''})`,
    moleculeType: doc.moleculeType,
    topology: 'linear',
    sequence: seq,
    features: [],
    primers: [],
    docMetadata: { 'Consensus source': doc.name, Threshold: String(v.threshold ?? 'Majority') },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Generate Consensus', description: `${String(v.threshold ?? 'Majority')} threshold`, parentIds: [doc.id], lengthBp: seq.length, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(ctx.folder ?? doc.folder, 'Alignments'),
  };
  return { created: [created], updated: [], summary: `Consensus of ${rows.length} sequences (${seq.length.toLocaleString()} residues)` };
}

// ───────────────────────────── trees ─────────────────────────────

export async function runBuildTree(inputs: SequenceDocument[], v: OptionValues, ctx: RunContext): Promise<OperationResult> {
  const method = String(v.method ?? 'Neighbor-Joining (NJ)') as PhyloTreeAlgorithm;
  let names = inputs.map((d) => d.name);
  let seqs = inputs.map((d) => d.sequence.toUpperCase());
  let alignNote = 'input alignment used as given';
  if (!isPreAlignedInputSet(inputs)) {
    const algo = msaAlgo(v.alignFirst);
    const exec = runValidatedAlignment(inputs.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence, moleculeType: d.moleculeType })), algo.value);
    if (exec.error) throw new Error(`Alignment failed: ${exec.error}`);
    names = exec.result.rows.map((r) => r.name);
    seqs = exec.result.rows.map((r) => r.alignedSeq.toUpperCase());
    alignNote = `aligned first (${algo.label})`;
  }
  // "Data subset to use": gaps/missing data treatment and codon positions.
  if (v.gaps === 'complete' || v.gaps === 'partial' || v.pos1 === false || v.pos2 === false || v.pos3 === false) {
    const sub = applySiteSubset(seqs, siteSubsetOptionsOf(v), inputs[0]?.moleculeType === 'Protein');
    if (sub.kept === 0) throw new Error(`No sites remain after ${sub.note.split(':')[0]}.`);
    seqs = sub.rows;
    alignNote += `; ${sub.note}`;
  }
  let newick: string;
  let methodLabel: string;
  let supportLabel: string;
  const meta: Record<string, string | number> = {};
  // The engine's warnings for this tree (D0005), the little-bootstrap support caveat among them,
  // kept in the saved document's notes, as Multiple Alignment keeps the MSA's (withWarningNotes).
  const warnings: string[] = [];
  if (isExternalTreeAlgorithm(method)) {
    const job = runExternalTree(method, names, seqs);
    ctx.signal?.addEventListener('abort', job.cancel);
    const r = await job.promise;
    newick = r.newick;
    methodLabel = `${r.program}${r.version ? ` (${r.version})` : ''}, ${r.model}`;
    supportLabel = r.supportKind === 'none' ? 'none' : `${r.supportKind} (%)`;
    if (r.programLogLikelihood !== null) meta[`${r.program} lnL`] = Number(r.programLogLikelihood.toFixed(3));
    meta.Command = r.commandLine;
    warnings.push(...r.warnings);
  } else {
    const model = String(v.model ?? 'Tamura-Nei (TN93)') as SubstitutionModelName;
    const resampling: Resampling = (['bootstrap', 'jackknife', 'little', 'interior'] as const).find((x) => x === v.resampling) ?? 'none';
    const reps = resampling === 'none' ? 0 : num(v.replicates) || 100;
    const jackPct = num(v.jackknifePct ?? 50) || 50;
    const seen = new Map<string, number>();
    const labels = names.map((nm) => {
      const base = sanitizeNewickLabel(nm);
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      return k === 1 ? base : `${base}_${k}`;
    });
    const searchOpts = {
      labels,
      seqs,
      protein: inputs[0]?.moleculeType === 'Protein',
      distances: (s: string[]) => fullMatrix(computeEvolutionaryDistances(names, s, model).pairwiseMatrix, names.length),
      randomAdditions: Math.max(0, Math.min(100, num(v.randomAdditions ?? 10))),
      resampling,
      replicates: reps,
      jackknifePct: jackPct,
      littleSamples: num(v.littleSamples ?? 10) || 10,
      littleSize: num(v.littleSize ?? 0) || 0,
      seed: num(v.seed ?? 0) || undefined,
      signal: ctx.signal,
    };
    if (method === 'Maximum Likelihood (ML)') {
      if (resampling === 'interior') throw new Error('The interior-branch test needs a distance method (Neighbor-Joining or Minimum Evolution).');
      // proteins use the built-in amino-acid models (LG / WAG / JTT; +I is not offered for them)
      const base = String(searchOpts.protein ? (v.mlProteinModel ?? 'LG') : (v.mlModel ?? 'GTR'));
      const mlModel = `${base}${v.mlGamma !== false ? '+G' : ''}${!searchOpts.protein && v.mlInvariant ? '+I' : ''}`;
      const r = mlTreeSearch(names, seqs, mlModel);
      const indexOf = (nm: string) => labels.indexOf(nm);
      let rooted = midpointRoot(parseNewick(r.newick));
      if (resampling !== 'none') {
        const target = fromTreeNode(parseNewick(r.newick), names.length, indexOf);
        const sup = await resampledSupport(target, seqs, (_w, rs) => fromTreeNode(parseNewick(mlTreeSearch(names, rs, mlModel).newick), names.length, indexOf), searchOpts, rng(searchOpts.seed ?? 20260101));
        rooted = labelRootedSupport(rooted, indexOf, names.length, sup.support);
        supportLabel = sup.label;
        if (sup.warning) warnings.push(sup.warning);
      } else supportLabel = 'none';
      newick = toNewick(rooted);
      methodLabel = `Maximum Likelihood (NNI search), ${r.model}`;
      meta['ML log likelihood'] = r.logLikelihood;
      meta['Starting tree ln L (NJ)'] = r.startLogLikelihood;
      meta['Model parameters'] = r.parameters;
      meta['Tree search'] = `NNI from the NJ tree: ${r.nniSwaps} swaps accepted in ${r.nniRounds} rounds (${r.nniEvaluated.toLocaleString()} rearrangements scored); branch lengths and model parameters optimised`;
    } else if (method === 'Minimum-Evolution (ME)' || method === 'Maximum Parsimony (MP)') {
      const mp = method === 'Maximum Parsimony (MP)';
      if (mp && resampling === 'interior') throw new Error('The interior-branch test needs a distance method (Neighbor-Joining or Minimum Evolution).');
      const r = await searchTree({ ...searchOpts, method: mp ? 'MP' : 'ME', randomAdditions: mp ? searchOpts.randomAdditions : 0 });
      newick = toNewick(r.tree);
      methodLabel = mp
        ? `Maximum Parsimony (SPR search), branch lengths from ${model} distances`
        : `Minimum Evolution (balanced ME, NNI search), ${model}`;
      supportLabel = r.supportResult?.label ?? 'none';
      if (r.supportResult?.warning) warnings.push(r.supportResult.warning);
      meta['Tree search'] = mp
        ? `SPR from the NJ tree and ${searchOpts.randomAdditions} random-addition tree${searchOpts.randomAdditions === 1 ? '' : 's'}; ${r.bestHits} of ${r.startingTrees} starts reached the best length`
        : 'NNI (close-neighbour interchange) from the NJ tree';
      meta[mp ? 'Tree length (steps)' : 'ME tree length'] = mp ? r.score : Number(r.score.toFixed(5));
      meta['Rearrangements tried'] = r.examined;
      meta['Improving moves'] = r.moves;
    } else {
      const engineResampled = resampling === 'bootstrap' || resampling === 'jackknife';
      if (method === 'UPGMA' && !engineResampled && resampling !== 'none') throw new Error('Little bootstraps and the interior-branch test are available for NJ, ME and MP trees, not UPGMA.');
      const rep = constructPhylogeneticTree(names, seqs, method, model, engineResampled ? reps : 0, resampling === 'jackknife' ? jackPct : 0);
      // The engine returns an empty tree with its reason when a pair's distance is undefined (no
      // shared sites, or too divergent for the model): that sentence is the error, not the
      // 'Invalid or incomplete Newick tree' createTreeDocument would throw for the empty tree.
      if (rep.newick.replace(/\s/g, '') === '();' && rep.warnings.length) throw new Error(rep.warnings.join(' '));
      newick = rep.newick;
      methodLabel = `${method === 'UPGMA' ? 'UPGMA' : 'Neighbor-Joining'}, ${model}`;
      supportLabel = rep.bootstrapReplicates > 0
        ? `${resampling === 'jackknife' ? `jackknife (${jackPct}% of columns kept)` : 'bootstrap'}, ${rep.bootstrapReplicates} replicates (%)`
        : 'none';
      warnings.push(...rep.warnings);
      if (resampling === 'little' || resampling === 'interior') {
        // Engine tip labels are the sanitised names (duplicates repeat): consume indices in order.
        const makeIndexOf = () => {
          const pool = new Map<string, number[]>();
          names.forEach((nm, i) => { const k = sanitizeNewickLabel(nm); pool.set(k, [...(pool.get(k) ?? []), i]); });
          return (nm: string) => pool.get(nm)?.shift() ?? -1;
        };
        const rooted = parseNewick(newick);
        const target = fromTreeNode(rooted, names.length, makeIndexOf());
        const sup = await supportFor(target, { ...searchOpts, method: 'NJ' }, rng(searchOpts.seed ?? 20260101));
        if (sup) {
          newick = toNewick(labelRootedSupport(rooted, makeIndexOf(), names.length, sup.support));
          supportLabel = sup.label;
          if (sup.warning) warnings.push(sup.warning);
        }
      }
    }
  }
  if (ctx.signal?.aborted) throw new Error('Cancelled.');
  const outgroup = String(v.outgroup ?? '').trim();
  if (outgroup) {
    newick = toNewick(rerootAtOutgroup(parseNewick(newick), sanitizeNewickLabel(outgroup)));
    meta.Outgroup = outgroup;
  }
  const name = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} tree`;
  const base = createTreeDocument(newick, `${name}.nwk`);
  const evalRep = analyzeUserTree(newick, names, seqs);
  const t = now();
  const doc = withWarningNotes<SequenceDocument>({
    ...base,
    name,
    description: `${methodLabel} tree of ${names.length} sequences`,
    moleculeType: inputs[0].moleculeType,
    folder: folderOf(ctx.folder ?? base.folder, 'Tree Documents'),
    alignmentMeta: {
      sequenceCount: names.length,
      isAligned: true,
      treeBuilder: methodLabel,
      sequences: names.map((n, i) => ({ id: `${base.id}-m${i + 1}`, name: n, sequence: seqs[i] })),
    },
    docMetadata: { ...base.docMetadata, 'Source Format': 'Tree builder', 'Tree method': methodLabel, 'Branch support': supportLabel, 'Parsimony steps': evalRep.parsimonyLengthSteps, ...meta },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Build Tree', description: `${methodLabel}; ${alignNote}; support: ${supportLabel}`, parentIds: inputs.map((d) => d.id), lengthBp: seqs[0]?.length ?? 0, topology: 'linear' }],
  }, warnings);
  return { created: [doc], updated: [], summary: `${methodLabel} tree of ${names.length} sequences` };
}

/** Same rule as the engine's tip labels: anything outside [A-Za-z0-9_.-] becomes "_". */
export function sanitizeNewickLabel(raw: string): string {
  const out = raw.replace(/[^A-Za-z0-9_.-]/g, '_');
  return out || 'Taxon';
}

/** Newick of a tree document (stored by the tree builder / importer). */
export function newickOf(doc: SequenceDocument): string | null {
  const n = doc.docMetadata?.Newick;
  return typeof n === 'string' && n.trim() ? n : null;
}

export function runConsensusTree(treeDocs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const newicks = treeDocs.map((d) => newickOf(d)).filter((n): n is string => !!n);
  if (newicks.length < 2) throw new Error('Select at least two tree documents.');
  const thr = num(v.threshold ?? 50);
  const res = consensusTree(newicks, thr, num(v.burnin ?? 0));
  let newick = res.newick;
  const outgroup = String(v.outgroup ?? '').trim();
  if (outgroup) newick = toNewick(rerootAtOutgroup(parseNewick(newick), outgroup));
  const name = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} consensus tree`;
  const base = createTreeDocument(newick, `${name}.nwk`);
  const t = now();
  const doc: SequenceDocument = {
    ...base,
    name,
    description: `${thr === 100 ? 'Strict' : `${thr}% majority-rule`} consensus of ${res.used} trees${num(v.burnin) ? ` (${num(v.burnin)}% burn-in)` : ''}`,
    folder: folderOf(ctx.folder ?? base.folder, 'Tree Documents'),
    docMetadata: {
      ...base.docMetadata,
      'Source Format': 'Consensus tree',
      'Trees used': res.used,
      'Support threshold (%)': thr,
      'Branch support': '% of trees containing the clade',
      ...(outgroup ? { Outgroup: outgroup } : {}),
    },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Consensus Tree', description: `${thr}% threshold, ${res.used} trees, ${res.clades.length} clades`, parentIds: treeDocs.map((d) => d.id), lengthBp: 0, topology: 'linear' }],
  };
  return { created: [doc], updated: [], summary: `${res.clades.length} clades from ${res.used} trees` };
}

// ───────────────────────────── annotation, cloning, assembly ─────────────────────────────

export const ORF_NOTE = 'Open reading frame found by Find ORFs';

export function runFindOrfs(doc: SequenceDocument, v: OptionValues): OperationResult {
  if (doc.moleculeType === 'Protein' || !doc.sequence) throw new Error(`${doc.name}: Find ORFs needs a nucleotide sequence.`);
  const minAa = num(v.minAa ?? 100);
  const circular = doc.topology === 'circular';
  const orfs = findORFs(doc.sequence, minAa, Boolean(v.altStart), num(v.geneticCode ?? 1) || 1, circular).filter((o) => v.strands !== 'forward' || o.strand === 1);
  const len = doc.sequence.length;
  const feats: SequenceFeature[] = orfs.map((o, i) => {
    const name = `ORF ${i + 1} (frame ${o.frame > 0 ? '+' : ''}${o.frame}, ${o.lengthAa} aa)`;
    // an ORF across the origin of a circular sequence: two segments, as join(start..len,1..end)
    const wraps = o.start > o.end;
    return {
      id: uid(`orf${i + 1}`),
      name,
      type: v.annotateAs === 'CDS' ? 'CDS' : 'misc_feature',
      start: wraps ? 1 : o.start,
      end: wraps ? len : o.end,
      strand: o.strand,
      color: '#d97706',
      notes: ORF_NOTE,
      ...(wraps ? { segments: [{ index: 1, name: `${name} part 1`, start: o.start, end: len, color: '#d97706' }, { index: 2, name: `${name} part 2`, start: 1, end: o.end, color: '#d97706' }] } : {}),
      qualifiers: { translation: o.proteinSeq, codon_start: '1', note: `${o.startCodon}…${o.stopCodon}, ${o.mwKda.toFixed(1)} kDa` },
    };
  });
  const kept = v.replace !== false ? doc.features.filter((f) => f.notes !== ORF_NOTE) : doc.features;
  const t = now();
  return {
    created: [],
    updated: [{
      ...doc,
      features: [...kept, ...feats],
      updatedAt: t,
      history: [...doc.history, { id: uid('hist'), timestamp: t, operation: 'Find ORFs', description: `${feats.length} ORFs ≥ ${minAa} aa`, parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
    }],
    summary: `${feats.length} ORFs on ${doc.name}`,
  };
}

/** Features wholly inside [start, end] (1-based, non-wrapping), shifted to fragment coordinates. */
export function featuresWithin(features: readonly SequenceFeature[], start: number, end: number): SequenceFeature[] {
  if (start > end) return [];
  return features
    .filter((f) => f.start >= start && f.end <= end && f.start <= f.end && (f.segments ?? []).every((s) => s.start >= start && s.end <= end))
    .map((f) => ({
      ...f,
      id: `${f.id}-frag${start}`,
      start: f.start - start + 1,
      end: f.end - start + 1,
      segments: f.segments?.map((s) => ({ ...s, start: s.start - start + 1, end: s.end - start + 1 })),
    }));
}

export function runDigest(doc: SequenceDocument, v: OptionValues): OperationResult {
  const enzymes = String(v.enzymes ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!enzymes.length) throw new Error('Choose at least one enzyme.');
  const frags: DigestFragment[] = simulateRestrictionDigest(doc, enzymes);
  if (frags.length === 0) throw new Error('The digest produced no fragments.');
  if (frags.length > 200) throw new Error(`The digest would create ${frags.length} fragments; choose enzymes that cut less often (limit 200).`);
  const t = now();
  const created = frags.map((f, i): SequenceDocument => ({
    id: uid('frag'),
    name: `${doc.name} ${f.leftEnzyme}–${f.rightEnzyme} (${f.lengthBp.toLocaleString()} bp)`,
    accession: '',
    description: `Fragment ${i + 1} of ${frags.length} from ${enzymes.join(' + ')} digest of ${doc.name} (${f.start}–${f.end})`,
    moleculeType: doc.moleculeType,
    topology: 'linear',
    sequence: f.sequence,
    features: v.keepAnnotations !== false ? featuresWithin(doc.features, f.start, f.end) : [],
    primers: [],
    docMetadata: {
      'Digest enzymes': enzymes.join(', '),
      "5' end": `${f.leftEnzyme} (${f.leftOverhangType}${f.leftOverhang ? ` ${f.leftOverhang}` : ''})`,
      "3' end": `${f.rightEnzyme} (${f.rightOverhangType}${f.rightOverhang ? ` ${f.rightOverhang}` : ''})`,
      'Source coordinates': `${f.start}–${f.end}`,
    },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Digest into Fragments', description: `${enzymes.join(' + ')}; fragment ${i + 1} of ${frags.length} (${f.start}–${f.end})`, parentIds: [doc.id], lengthBp: f.lengthBp, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: doc.folder,
  }));
  return { created, updated: [], summary: `${created.length} fragments from ${doc.name}` };
}

export function runDeNovo(reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const minOverlap = num(v.minOverlap ?? 18);
  const rep = runDeNovoAssembly(reads.map((r) => ({ name: r.name, sequence: r.sequence })), 'CAP3', minOverlap);
  const contigs = rep.contigs.filter((c) => v.keepSingletons || c.readCount > 1);
  if (contigs.length === 0) throw new Error(`No reads overlapped by ≥ ${minOverlap} bp. Try a smaller minimum overlap.`);
  const t = now();
  const created = contigs.map((c, i): SequenceDocument => ({
    id: uid('contig'),
    name: `${ctx.sourceLabel} Contig ${i + 1} (${c.readCount} read${c.readCount === 1 ? '' : 's'})`,
    accession: '',
    description: `De novo contig of ${c.readCount} reads, ${c.lengthBp.toLocaleString()} bp, mean depth ${c.meanCoverageDepth}×`,
    moleculeType: 'DNA',
    topology: 'linear',
    sequence: c.sequence,
    features: [],
    primers: [],
    docMetadata: { Reads: c.readCount, 'Mean depth': c.meanCoverageDepth, 'GC (%)': c.gcPercent, 'Minimum overlap (bp)': minOverlap, 'Contig N50 (bp)': rep.n50Bp },
    history: [{ id: uid('hist'), timestamp: t, operation: 'De Novo Assemble', description: `${/de Bruijn/.test(rep.assembler) ? rep.assembler : `Greedy overlap ≥ ${minOverlap} bp`}; contig ${i + 1} of ${contigs.length}`, parentIds: reads.map((r) => r.id), lengthBp: c.lengthBp, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(ctx.folder, 'Contig Assembly'),
  }));
  return { created, updated: [], summary: `${contigs.length} contigs from ${rep.inputReadCount} reads (N50 ${rep.n50Bp.toLocaleString()} bp)` };
}

export function renameOptionsOf(v: OptionValues): BatchRenameOptions {
  return {
    field: v.field === 'description' ? 'description' : 'name',
    template: String(v.template ?? '{name}'),
    prefix: String(v.prefix ?? ''),
    suffix: String(v.suffix ?? ''),
    find: String(v.find ?? ''),
    replace: String(v.replace ?? ''),
    counterStart: num(v.counterStart ?? 1) || 1,
  };
}

export function runBatchRename(docs: SequenceDocument[], v: OptionValues): OperationResult {
  const o = renameOptionsOf(v);
  const t = now();
  const updated = docs.map((d, i) => {
    const value = renamedValue(d, i, o);
    const before = o.field === 'name' ? d.name : d.description;
    if (value === before || (o.field === 'name' && !value)) return null;
    return {
      ...d,
      [o.field]: value,
      updatedAt: t,
      history: [...d.history, { id: uid(`hist-ren${i}`), timestamp: t, operation: 'Batch Rename', description: `${o.field === 'name' ? 'Name' : 'Description'}: "${before}" → "${value}"`, parentIds: [d.id], lengthBp: d.sequence.length, topology: d.topology }],
    } as SequenceDocument;
  }).filter((d): d is SequenceDocument => d !== null);
  return { created: [], updated, summary: `Renamed ${updated.length} document${updated.length === 1 ? '' : 's'} (${o.field})` };
}

// ───────────────────────────── primers ─────────────────────────────

/**
 * A primer document as a primer record (the whole oligo anneals). One holding N or another ambiguity
 * code keeps its numeric Tm and carries the engine's reason it has none (BG-01M6SHQ0).
 */
export function primerRecordFromDoc(d: SequenceDocument): PrimerRecord {
  const seq = d.sequence.toUpperCase().replace(/[^A-Z]/g, '');
  const m = calculatePrimerMetrics(seq);
  return {
    id: d.id, name: d.name, sequence: seq, annealSequence: seq, tail5Prime: '', bindStart: 0, bindEnd: 0, strand: 1,
    length: seq.length, gcPercent: m.gcPercent, tmAnnealC: m.tmC, tmFullC: m.tmC, deltaG37: m.deltaG37,
    hairpinDeltaG: m.hairpinDeltaG, selfDimerDeltaG: m.selfDimerDeltaG, gcClamp3Prime: m.gcClamp3Prime,
    ...(m.tmNoAnswerReason ? { tmNoAnswerReason: m.tmNoAnswerReason } : {}),
  };
}

export const SAVED_PRIMER_NOTE = 'Binding site from Test with Saved Primers';

/**
 * Finds where each saved primer binds each target (both strands, up to `maxMismatches`
 * outside the 3'-end clamp) and adds the sites as primers on the target.
 * `primerNames` (comma-separated) limits the primers used; empty = all given.
 */
export function runTestSavedPrimers(targets: SequenceDocument[], primerDocs: SequenceDocument[], v: OptionValues): OperationResult {
  const wanted = String(v.primerNames ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const primers = primerDocs.filter((p) => !wanted.length || wanted.includes(p.name)).map(primerRecordFromDoc).filter((p) => p.sequence.length >= 12);
  if (!primers.length) throw new Error('No primers to test (primer documents need at least 12 bases).');
  const maxMm = Math.max(0, Math.min(5, num(v.maxMismatches ?? 1)));
  const t = now();
  let total = 0;
  const updated: SequenceDocument[] = [];
  for (const d of targets) {
    if (d.moleculeType === 'Protein' || !d.sequence) continue;
    const hits = testSavedPrimersOnSequence(d.sequence, primers, maxMm);
    const placed: PrimerRecord[] = hits.map((h, i) => ({
      ...h.primer,
      id: uid(`sp${i}`),
      bindStart: h.bindStart,
      bindEnd: h.bindEnd,
      strand: h.strand,
      notes: `${SAVED_PRIMER_NOTE}: ${h.mismatches} mismatch${h.mismatches === 1 ? '' : 'es'}, effective Tm ${
        h.primer.tmNoAnswerReason ? 'n/a' : `${h.effectiveTmC.toFixed(1)} °C`
      }`,
    }));
    total += placed.length;
    const kept = v.replace !== false ? d.primers.filter((p) => !p.notes?.startsWith(SAVED_PRIMER_NOTE)) : d.primers;
    if (!placed.length && kept.length === d.primers.length) continue;
    updated.push({
      ...d,
      primers: [...kept, ...placed],
      updatedAt: t,
      history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Test with Saved Primers', description: `${placed.length} binding site${placed.length === 1 ? '' : 's'} from ${primers.length} primers (≤ ${maxMm} mismatches)`, parentIds: [d.id], lengthBp: d.sequence.length, topology: d.topology }],
    });
  }
  return { created: [], updated, summary: `${total} primer binding site${total === 1 ? '' : 's'} on ${updated.length} sequence${updated.length === 1 ? '' : 's'} (${primers.length} primers, ≤ ${maxMm} mismatches)` };
}

// ───────────────────────────── read processing ─────────────────────────────

export const TRIM_NOTE = 'Trimmed by Trim Ends';

export function runTrimEnds(reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const t = now();
  const created: SequenceDocument[] = [];
  const updated: SequenceDocument[] = [];
  let removed = 0;
  const minLen = num(v.minLength ?? 0);
  let dropped = 0;
  for (const d of reads) {
    if (d.moleculeType === 'Protein' || !d.sequence) continue;
    const seq = d.chromatogram?.baseCalls || d.sequence;
    const rep = runBbdukReadTrimming(seq, d.chromatogram?.phredScores, {
      minPhredQuality: num(v.minQuality ?? 20),
      trimAdapters: v.trimAdapters !== false,
      trimLowComplexityEnds: v.trimLowComplexity !== false,
    });
    const five = rep.basesRemoved5Prime;
    const three = rep.basesRemoved3Prime;
    removed += five + three;
    const desc = `${five} bp 5′, ${three} bp 3′ trimmed (Q ≥ ${num(v.minQuality ?? 20)}${v.trimAdapters !== false ? ', adapters' : ''}${v.trimLowComplexity !== false ? ', low-complexity ends' : ''}); ${rep.trimmedLengthBp} bp kept`;
    if (v.action === 'copy') {
      if (rep.trimmedLengthBp < Math.max(1, minLen)) { dropped += 1; continue; }
      created.push({
        ...d,
        id: uid('trim'),
        name: `${d.name} (trimmed)`,
        sequence: rep.trimmedSequence,
        chromatogram: undefined,
        documentKind: d.documentKind === 'trace' ? 'linear-dna' : d.documentKind,
        features: featuresWithin(d.features, five + 1, seq.length - three),
        primers: [],
        docMetadata: { ...(d.docMetadata ?? {}), 'Trimmed from': d.name, 'Trimmed 5′ (bp)': five, 'Trimmed 3′ (bp)': three },
        history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Trim Ends', description: desc, parentIds: [d.id], lengthBp: rep.trimmedLengthBp, topology: 'linear' }],
        createdAt: t,
        updatedAt: t,
        folder: folderOf(ctx.folder ?? d.folder, 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder']),
      });
    } else {
      const feats: SequenceFeature[] = [];
      if (five > 0) feats.push({ id: uid('trim5'), name: 'Trimmed', type: 'misc_feature', start: 1, end: five, strand: 0, color: '#94a3b8', notes: TRIM_NOTE });
      if (three > 0) feats.push({ id: uid('trim3'), name: 'Trimmed', type: 'misc_feature', start: seq.length - three + 1, end: seq.length, strand: 0, color: '#94a3b8', notes: TRIM_NOTE });
      updated.push({
        ...d,
        features: [...d.features.filter((f) => f.notes !== TRIM_NOTE), ...feats],
        updatedAt: t,
        history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Trim Ends', description: desc, parentIds: [d.id], lengthBp: seq.length, topology: d.topology }],
      });
    }
  }
  const n = created.length + updated.length;
  return { created, updated, summary: `Trimmed ${n} read${n === 1 ? '' : 's'} (${removed.toLocaleString()} bases)${dropped ? `; ${dropped} shorter than ${minLen} bp after trimming were not kept` : ''}` };
}

// ───────────────────────────── back-translation ─────────────────────────────

const IUPAC_FROM_SET: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', AG: 'R', CT: 'Y', CG: 'S', AT: 'W', GT: 'K', AC: 'M',
  CGT: 'B', AGT: 'D', ACT: 'H', ACG: 'V', ACGT: 'N',
};

/** IUPAC-degenerate codon covering every codon for each amino acid in a genetic code. */
export function degenerateCodons(geneticCode: string): Map<string, string> {
  const byAa = new Map<string, string[]>();
  for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') {
    const codon = a + b + c;
    const aa = translateCodon(codon, geneticCode);
    byAa.set(aa, [...(byAa.get(aa) ?? []), codon]);
  }
  const out = new Map<string, string>();
  for (const [aa, codons] of byAa) {
    out.set(aa, [0, 1, 2].map((i) => IUPAC_FROM_SET[[...new Set(codons.map((c) => c[i]))].sort().join('')] ?? 'N').join(''));
  }
  return out;
}

export const BACK_TRANSLATION_HOSTS: { value: string; label: string }[] = [
  { value: 'ecoli', label: 'Escherichia coli K-12' },
  { value: 'yeast', label: 'Saccharomyces cerevisiae' },
  { value: 'human', label: 'Homo sapiens' },
  { value: 'cho', label: 'Mus musculus (CHO / rodent)' },
  { value: 'insect', label: 'Drosophila melanogaster' },
  { value: 'bsubtilis', label: 'Bacillus subtilis' },
];

export function runBackTranslate(proteins: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const t = now();
  const code = String(v.geneticCode ?? 'Standard');
  const created = proteins.filter((d) => d.moleculeType === 'Protein' && d.sequence).map((d): SequenceDocument => {
    const prot = d.sequence.toUpperCase().replace(/[^A-Z*]/g, '');
    let dna: string;
    let how: string;
    if (v.mode === 'ambiguous') {
      const table = degenerateCodons(code);
      dna = Array.from(prot).map((aa) => table.get(aa) ?? 'NNN').join('');
      how = `ambiguous (IUPAC) codons, ${code} code`;
    } else {
      const body = prot.replace(/\*+$/, '');
      if (body.includes('*')) throw new Error(`${d.name}: internal stop (*) in the protein; use ambiguous mode or remove it.`);
      const host = String(v.host ?? 'ecoli');
      // The engine's codon optimiser takes a protein when isDna is false.
      dna = invokeRustBioSync<{ optimizedDna: string }>('optimize_codons', { seq: body, isDna: false, host }).optimizedDna;
      // Exactly one stop when the protein ends in one (or a stop is requested), none otherwise.
      const lastCodon = dna.slice(-3);
      const endsInStop = dna.length >= 3 && translateCodon(lastCodon, code) === '*';
      const wantStop = prot.endsWith('*') || Boolean(v.addStop);
      if (wantStop && !endsInStop) dna += 'TAA';
      if (!wantStop && endsInStop) dna = dna.slice(0, -3);
      how = `most frequent codons for ${(BACK_TRANSLATION_HOSTS.find((h) => h.value === host) ?? BACK_TRANSLATION_HOSTS[0]).label}`;
    }
    return {
      id: uid('bt'),
      name: `${d.name} (back-translated)`,
      accession: '',
      description: `Back-translation of ${d.name}: ${how}`,
      moleculeType: 'DNA',
      topology: 'linear',
      sequence: dna,
      features: [{ id: uid('cds'), name: `${d.name} CDS`, type: 'CDS', start: 1, end: dna.length, strand: 1, color: '#2563eb', qualifiers: { translation: prot.replace(/\*+$/, ''), note: how } }],
      primers: [],
      docMetadata: { 'Back-translated from': d.name, Method: how },
      history: [{ id: uid('hist'), timestamp: t, operation: 'Back-Translate', description: how, parentIds: [d.id], lengthBp: dna.length, topology: 'linear' }],
      createdAt: t,
      updatedAt: t,
      folder: folderOf(ctx.folder ?? d.folder, 'Protein Documents' as SequenceDocument['folder']),
    };
  });
  if (!created.length) throw new Error('Select protein sequences to back-translate.');
  return { created, updated: [], summary: `Back-translated ${created.length} protein${created.length === 1 ? '' : 's'}` };
}

// ───────────────────────────── map to reference / validate clone ─────────────────────────────

export interface MapRunOptions {
  minIdentity: number;
  minLength: number;
  minVarFreq: number;
  minVarCoverage: number;
  minVarQuality: number;
  resultName?: string;
}

export function mapOptionsOf(v: OptionValues): MapRunOptions {
  return {
    minIdentity: num(v.minIdentity ?? 80),
    minLength: num(v.minLength ?? 50),
    minVarFreq: num(v.minVarFreq ?? 25),
    minVarCoverage: num(v.minVarCoverage ?? 1),
    minVarQuality: num(v.minVarQuality ?? 20),
    resultName: String(v.resultName ?? ''),
  };
}

/** One contig document from a mapping of reads onto one reference. */
export function contigDocument(ref: SequenceDocument, reads: SequenceDocument[], c: ReferenceContig, o: MapRunOptions, folder: string | undefined, name: string, operation = 'Map to Reference'): SequenceDocument {
  const t = now();
  const id = uid('map');
  const features: SequenceFeature[] = c.variants.map((vr, i) => ({
    id: `${id}-var${i + 1}`,
    name: `${vr.type} ${vr.refBase}→${vr.altBase} @${vr.refPosition} (${vr.frequencyPct}%)`,
    type: 'misc_feature',
    start: vr.column,
    end: vr.column,
    strand: 0,
    color: vr.type === 'SNP' ? '#dc2626' : '#7c3aed',
    notes: 'Variant from Map to Reference',
    qualifiers: {
      reference_position: String(vr.refPosition),
      change: `${vr.refBase}>${vr.altBase}`,
      frequency: `${vr.frequencyPct}% (${vr.supporting}/${vr.coverage} reads)`,
      ...(vr.meanQuality !== null ? { mean_quality: String(vr.meanQuality) } : {}),
    },
  }));
  return {
    id,
    name,
    accession: '',
    description: `${c.mapped.length} of ${reads.length} reads mapped to ${ref.name}; mean coverage ${c.meanCoverage}×, ${c.breadthPct}% of the reference covered`,
    moleculeType: ref.moleculeType,
    topology: 'linear',
    sequence: c.consensus,
    features,
    primers: [],
    documentKind: 'alignment',
    alignmentMeta: {
      sequenceCount: c.rows.length,
      isAligned: true,
      meanCoverageX: c.meanCoverage,
      sequences: c.rows.map((r, i) => ({ id: `${id}-m${i}`, name: r.name, sequence: r.sequence, ...(i > 0 ? { strand: r.strand } : {}) })),
    },
    docMetadata: {
      Reference: ref.name,
      'Mapped reads': `${c.mapped.length} of ${reads.length}`,
      'Mean coverage': c.meanCoverage,
      'Reference covered (%)': c.breadthPct,
      Variants: c.variants.length,
      'Mapping thresholds': `≥ ${o.minIdentity}% identity, ≥ ${o.minLength} bp`,
      ...(c.unmapped.length ? { 'Unmapped reads': c.unmapped.map((u) => `${u.doc.name} (${u.reason})`).join('; ') } : {}),
    },
    history: [{
      id: uid('hist'), timestamp: t, operation,
      description: `${c.mapped.length}/${reads.length} reads to ${ref.name}; ${c.variants.length} variants (≥ ${o.minVarFreq}%, coverage ≥ ${o.minVarCoverage})`,
      parentIds: [ref.id, ...reads.map((r) => r.id)], lengthBp: c.columns, topology: 'linear',
    }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(folder, 'Contig Assembly'),
  };
}

/**
 * Maps reads to one or more references. With several references each read goes to the
 * reference it matches best (identity × aligned length) and one contig is made per
 * reference that received reads.
 */
export function runMapToReferences(refs: SequenceDocument[], reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult & { contigs: ReferenceContig[] } {
  const o = mapOptionsOf(v);
  const mapOpts = { minIdentityPct: o.minIdentity, minAlignedLength: o.minLength, minVariantFrequencyPct: o.minVarFreq, minVariantCoverage: o.minVarCoverage, minVariantQuality: o.minVarQuality };
  const assigned = new Map<string, SequenceDocument[]>(refs.map((r) => [r.id, []]));
  const unassigned: SequenceDocument[] = [];
  if (refs.length === 1) assigned.set(refs[0].id, reads);
  else {
    for (const read of reads) {
      let best: { id: string; score: number } | null = null;
      for (const ref of refs) {
        const res = mapReadAndCallVariants(ref, read);
        const len = res.alignment.alignedSeq2.replace(/-/g, '').length;
        if (res.alignment.identityPct < o.minIdentity || len < o.minLength) continue;
        const score = res.alignment.identityPct * len;
        if (!best || score > best.score) best = { id: ref.id, score };
      }
      if (best) assigned.get(best.id)!.push(read);
      else unassigned.push(read);
    }
  }
  const created: SequenceDocument[] = [];
  const contigs: ReferenceContig[] = [];
  for (const ref of refs) {
    const rs = assigned.get(ref.id)!;
    if (!rs.length) continue;
    const c = mapReadsToReference(ref, rs, mapOpts);
    if (!c.mapped.length) { unassigned.push(...rs); continue; }
    contigs.push(c);
    const name = refs.length === 1 && o.resultName?.trim() ? o.resultName.trim() : `${ref.name} contig`;
    created.push(contigDocument(ref, rs, c, o, ctx.folder, name));
  }
  if (!created.length) throw new Error(`No reads mapped to ${refs.length === 1 ? refs[0].name : 'any reference'}.`);
  const mapped = contigs.reduce((n, c) => n + c.mapped.length, 0);
  const variants = contigs.reduce((n, c) => n + c.variants.length, 0);
  const unmappedCount = reads.length - mapped;
  return { created, updated: [], contigs, summary: `${mapped}/${reads.length} reads mapped to ${created.length} reference${created.length === 1 ? '' : 's'}, ${variants} variant${variants === 1 ? '' : 's'}${unmappedCount ? `, ${unmappedCount} unmapped` : ''}` };
}

/**
 * Cloning validation: maps sequencing reads to the expected construct and reports
 * whether every base is covered without discrepancies (variants present in ≥ half the
 * covering reads).
 */
export function runValidateClone(construct: SequenceDocument, reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const r = runMapToReferences([construct], reads, { ...v, minVarFreq: 50 }, ctx);
  const c = r.contigs[0];
  const discrepancies = c.variants;
  const uncovered = Math.round((100 - c.breadthPct) * construct.sequence.length / 100);
  const ok = discrepancies.length === 0 && c.breadthPct >= num(v.requiredCoverage ?? 100);
  const verdict = ok
    ? `Confirmed: ${c.breadthPct}% of ${construct.name} covered by reads with no discrepancies`
    : `Not confirmed: ${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'}${uncovered > 0 ? `, ${uncovered.toLocaleString()} bp not covered (${c.breadthPct}% covered)` : ''}`;
  const doc = r.created[0];
  doc.name = String(v.resultName ?? '').trim() || `${construct.name} validation`;
  doc.docMetadata = { ...doc.docMetadata, Validation: verdict, Discrepancies: discrepancies.map((d) => `${d.type} ${d.refBase}>${d.altBase} @${d.refPosition}`).join('; ') || 'none' };
  doc.history = doc.history.map((h) => ({ ...h, operation: 'Validate Clone', description: `${verdict}; ${h.description}` }));
  return { created: [doc], updated: [], summary: verdict };
}

export function runAddToAlignment(alignment: SequenceDocument, additions: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const rows = alignmentRowsOf(alignment);
  if (!rows) throw new Error(`${alignment.name} is not an aligned document.`);
  const isProtein = alignment.moleculeType === 'Protein';
  if (additions.some((d) => (d.moleculeType === 'Protein') !== isProtein)) throw new Error('Added sequences must be the same molecule type as the alignment.');
  const res = addSequencesToAlignment(rows, additions.map((d) => ({ name: d.name, sequence: d.sequence })), isProtein);
  const name = String(v.resultName ?? '').trim() || `${alignment.name} + ${additions.length}`;
  const doc = newAlignmentDoc(alignment, name, res.rows, 'Add to Alignment',
    `${additions.length} sequence${additions.length === 1 ? '' : 's'} added to ${alignment.name} (existing columns kept)`,
    [alignment.id, ...additions.map((d) => d.id)], ctx.folder ?? alignment.folder,
    { 'Added sequences': additions.map((d, i) => `${d.name} (${res.identities[i].toFixed(1)}% identity to consensus)`).join('; ') });
  return { created: [doc], updated: [], summary: `Added ${additions.length} sequence${additions.length === 1 ? '' : 's'} to ${alignment.name}` };
}

// ───────────────────────────── compare annotations / merge paired reads ─────────────────────────────

const COMPARISON_LABEL: Record<ComparisonStatus, string> = {
  identical: 'identical in both',
  overlapping: 'overlapping',
  'only-a': 'only in first',
  'only-b': 'only in second',
};

export function runCompareAnnotations(a: SequenceDocument, b: SequenceDocument, v: OptionValues): OperationResult {
  const cmp = compareAnnotations(a.features, b.features, num(v.minOverlap ?? 50));
  const colors: Record<ComparisonStatus, string> = { identical: '#16a34a', overlapping: '#d97706', 'only-a': '#2563eb', 'only-b': '#dc2626' };
  const features: SequenceFeature[] = cmp.map((c, i) => {
    const f = (c.a ?? c.b)!;
    return {
      ...f,
      id: uid(`cmp${i}`),
      color: colors[c.status],
      notes: `Compare Annotations: ${COMPARISON_LABEL[c.status]}`,
      qualifiers: {
        ...(f.qualifiers ?? {}),
        comparison: COMPARISON_LABEL[c.status],
        ...(c.status === 'overlapping' && c.a && c.b ? { [`${b.name} interval`]: `${c.b.start}..${c.b.end}`, overlap: `${c.overlapPct}%` } : {}),
      },
    };
  });
  const counts = (s: ComparisonStatus) => cmp.filter((c) => c.status === s).length;
  const t = now();
  const doc: SequenceDocument = {
    ...a,
    id: uid('cmp'),
    name: `${a.name} vs ${b.name} annotations`,
    description: `Annotation comparison: ${counts('identical')} identical, ${counts('overlapping')} overlapping, ${counts('only-a')} only in ${a.name}, ${counts('only-b')} only in ${b.name}`,
    features,
    primers: [],
    docMetadata: { ...(a.docMetadata ?? {}), 'Compared with': b.name, Identical: counts('identical'), Overlapping: counts('overlapping'), [`Only in ${a.name}`]: counts('only-a'), [`Only in ${b.name}`]: counts('only-b') },
    history: [...a.history, { id: uid('hist'), timestamp: t, operation: 'Compare Annotations', description: `vs ${b.name} (overlap ≥ ${num(v.minOverlap ?? 50)}%)`, parentIds: [a.id, b.id], lengthBp: a.sequence.length, topology: a.topology }],
    createdAt: t,
    updatedAt: t,
  };
  return { created: [doc], updated: [], summary: doc.description };
}

export function runMergePairedReads(reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const groups = new Map<string, { r1?: SequenceDocument; r2?: SequenceDocument }>();
  let unpaired = 0;
  for (const d of reads) {
    const m = mateOf(d.name);
    if (!m) { unpaired++; continue; }
    const g = groups.get(m.key) ?? {};
    if ((m.mate === 1 ? g.r1 : g.r2)) { unpaired++; continue; }
    if (m.mate === 1) g.r1 = d; else g.r2 = d;
    groups.set(m.key, g);
  }
  const t = now();
  const created: SequenceDocument[] = [];
  let notMerged = 0;
  for (const [key, g] of groups) {
    if (!g.r1 || !g.r2) { unpaired++; continue; }
    const s1 = g.r1.chromatogram?.baseCalls || g.r1.sequence;
    const s2 = g.r2.chromatogram?.baseCalls || g.r2.sequence;
    const res = mergePair(s1, s2, g.r1.chromatogram?.phredScores, g.r2.chromatogram?.phredScores, num(v.minOverlap ?? 20), num(v.maxMismatchPct ?? 10));
    if (!res.merged) { notMerged++; continue; }
    created.push({
      ...g.r1,
      id: uid('merged'),
      name: `${key} (merged)`,
      description: `Merged pair ${g.r1.name} + ${g.r2.name}: ${res.overlap} bp overlap, ${res.mismatches} mismatch${res.mismatches === 1 ? '' : 'es'}`,
      sequence: res.merged,
      chromatogram: undefined,
      documentKind: 'linear-dna',
      topology: 'linear',
      features: [],
      primers: [],
      docMetadata: { 'Read 1': g.r1.name, 'Read 2': g.r2.name, 'Overlap (bp)': res.overlap, Mismatches: res.mismatches, 'Conflicts resolved by quality': res.conflicts },
      history: [{ id: uid('hist'), timestamp: t, operation: 'Merge Paired Reads', description: `${res.overlap} bp overlap, ${res.mismatches} mismatches`, parentIds: [g.r1.id, g.r2.id], lengthBp: res.merged.length, topology: 'linear' }],
      createdAt: t,
      updatedAt: t,
      folder: folderOf(ctx.folder ?? g.r1.folder, 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder']),
    });
  }
  if (!created.length) throw new Error(groups.size ? 'No pairs overlapped enough to merge (try a smaller minimum overlap).' : 'No read pairs found: mate names need a suffix such as _R1/_R2, _1/_2, /1 /2 or -F/-R.');
  return { created, updated: [], summary: `Merged ${created.length} pair${created.length === 1 ? '' : 's'}${notMerged ? `; ${notMerged} did not overlap` : ''}${unpaired ? `; ${unpaired} reads without a mate` : ''}` };
}

// ───────────────────────────── read QC report ─────────────────────────────

export function runReadQcReport(reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const nuc = reads.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
  if (!nuc.length) throw new Error('Select the reads to report on.');
  const modules = readQcModules(nuc.map((d) => ({
    name: d.name,
    sequence: d.chromatogram?.baseCalls || d.sequence,
    qualities: d.chromatogram?.phredScores,
  })), Math.max(1, num(v.binSize ?? 10)));
  const title = String(v.resultName ?? '').trim() || `QC report: ${ctx.sourceLabel}`;
  const t = now();
  const fails = modules.filter((m) => m.flag === 'FAIL').length;
  const warns = modules.filter((m) => m.flag === 'WARN').length;
  const doc: SequenceDocument = {
    id: uid('qc'),
    name: title,
    accession: '',
    description: `Read QC of ${nuc.length} reads: ${fails} fail, ${warns} warn`,
    moleculeType: 'DNA',
    topology: 'linear',
    sequence: '',
    features: [],
    primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: formatQcReport(title, modules), 'QC fails': fails, 'QC warnings': warns },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Read QC Report', description: `${nuc.length} reads; ${fails} FAIL, ${warns} WARN`, parentIds: nuc.map((d) => d.id), lengthBp: 0, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(ctx.folder, 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder']),
  };
  return { created: [doc], updated: [], summary: `QC report for ${nuc.length} reads: ${fails} FAIL, ${warns} WARN` };
}

// ───────────────────────────── distances ─────────────────────────────

/**
 * Group label of a sequence: its "Group" (or "group") metadata field, else the first "Group: X" in
 * its description, X running to the next ';', ',' or line end. The analysis menu and the
 * phylogenetics studio both read groups with this one function.
 */
export function groupOf(d: { description?: string; docMetadata?: Record<string, string | number> }): string {
  const meta = d.docMetadata?.Group ?? d.docMetadata?.group;
  if (meta !== undefined && String(meta).trim()) return String(meta).trim();
  return /(?:^|\b)Group:\s*([^;,\n]+)/i.exec(d.description ?? '')?.[1]?.trim() ?? '';
}

/** Aligned rows of the inputs (aligning first when needed), then the data subset. */
export function analysisRows(inputs: SequenceDocument[], v: OptionValues): { names: string[]; seqs: string[]; groups: string[]; note: string } {
  let names = inputs.map((d) => d.name);
  let seqs = inputs.map((d) => d.sequence.toUpperCase());
  let groups = inputs.map(groupOf);
  let alignNote = '';
  if (!isPreAlignedInputSet(inputs)) {
    const algo = msaAlgo(v.alignFirst);
    const exec = runValidatedAlignment(inputs.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence, moleculeType: d.moleculeType })), algo.value);
    if (exec.error) throw new Error(`Alignment failed: ${exec.error}`);
    const byId = new Map(inputs.map((d) => [d.id, d]));
    names = exec.result.rows.map((r) => r.name);
    seqs = exec.result.rows.map((r) => r.alignedSeq.toUpperCase());
    groups = exec.result.rows.map((r) => groupOf(byId.get(r.id) ?? {}));
    alignNote = `aligned first (${algo.label}); `;
  }
  const sub = applySiteSubset(seqs, siteSubsetOptionsOf(v), inputs[0]?.moleculeType === 'Protein');
  if (sub.kept === 0) throw new Error(`No sites remain after ${sub.note.split(':')[0]}.`);
  return { names, seqs: sub.rows, groups, note: alignNote + sub.note };
}

const fmtD = (x: number | null | undefined, digits = 4) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/c' : x.toFixed(digits));

export function runComputeDistances(inputs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  if (inputs.length < 2) throw new Error('Select at least two sequences.');
  const { names, seqs, groups, note } = analysisRows(inputs, v);
  const model = String(v.model ?? 'Maximum Composite Likelihood (MCL)') as SubstitutionModelName;
  const rep = computeEvolutionaryDistances(names, seqs, model, groups.some(Boolean) ? groups : []);
  const what = String(v.analysis ?? 'pairwise');
  const withSe = Boolean(v.withSE);
  const lines: string[] = [];
  const title = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} distances`;
  lines.push(`# ${title}`, '', `Model: ${model}`, `Data: ${note}`, `Sequences: ${names.length}`, '');
  if (what === 'pairwise') {
    lines.push('## Pairwise distances (lower triangle)' + (withSe ? ', standard errors (upper triangle)' : ''), '');
    const w = Math.min(28, Math.max(...names.map((n) => n.length)));
    lines.push(['', ...names.map((_, i) => `[${i + 1}]`)].map((x, i) => (i === 0 ? ''.padEnd(w + 6) : x.padStart(9))).join(''));
    names.forEach((nm, i) => {
      const cells = names.map((_, j) => {
        if (i === j) return '—'.padStart(9);
        if (j < i) return fmtD(rep.pairwiseMatrix[i]?.[j]).padStart(9);
        return withSe ? fmtD(rep.pairwiseMatrix[i]?.[j]).padStart(9) : ''.padStart(9);
      });
      lines.push(`[${String(i + 1).padStart(2)}] ${nm.slice(0, w).padEnd(w)}${cells.join('')}`);
    });
    lines.push('', 'Tab-separated (lower triangle), for spreadsheets:', '', ['', ...names].join('\t'));
    names.forEach((nm, i) => lines.push([nm, ...names.map((_, j) => (j < i ? fmtD(rep.pairwiseMatrix[i]?.[j], 6) : ''))].join('\t')));
  }
  if (what === 'pairwise' || what === 'overall') {
    lines.push('', `## Overall mean distance: ${fmtD(rep.overallMeanDistance)}${withSe ? ` (SE ${fmtD(rep.overallMeanSE)})` : ''}`);
  }
  if (what === 'within' || what === 'between' || what === 'net') {
    if (!groups.some(Boolean)) throw new Error('Group means need groups: give sequences a "Group" metadata field (Import Metadata from Spreadsheet) or "Group: X" in their description.');
  }
  if (what === 'within') {
    lines.push('## Within-group mean distances', '');
    for (const g of rep.withinGroupMeans) lines.push(`${g.groupName} (${g.taxonCount})\t${fmtD(g.meanDistance)}${withSe ? `\tSE ${fmtD(g.se)}` : ''}`);
  }
  if (what === 'between' || what === 'net') {
    lines.push(what === 'net' ? '## Net between-group mean distances (Da)' : '## Between-group mean distances', '');
    for (const g of rep.betweenGroupMeans) lines.push(`${g.groupA} – ${g.groupB}\t${fmtD(what === 'net' ? g.netDistanceDa : g.meanDistance)}${withSe ? `\tSE ${fmtD(g.se)}` : ''}`);
  }
  const t = now();
  const doc: SequenceDocument = {
    id: uid('dist'),
    name: title,
    accession: '',
    description: `${model} ${what === 'pairwise' ? 'pairwise distances' : what === 'overall' ? 'overall mean' : what === 'within' ? 'within-group means' : what === 'between' ? 'between-group means' : 'net between-group means'} for ${names.length} sequences`,
    moleculeType: inputs[0].moleculeType,
    topology: 'linear',
    sequence: '',
    features: [],
    primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n', 'Distance model': model, 'Overall mean distance': fmtD(rep.overallMeanDistance) },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Compute Distances', description: `${model}; ${note}`, parentIds: inputs.map((d) => d.id), lengthBp: 0, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: folderOf(ctx.folder ?? inputs[0].folder, 'Alignments'),
  };
  return { created: [doc], updated: [], summary: `${model}: overall mean ${fmtD(rep.overallMeanDistance)} (${note})` };
}

// ───────────────────────────── condense tree, gene duplications ─────────────────────────────

export function runCondenseTree(treeDoc: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult {
  const nw = newickOf(treeDoc);
  if (!nw) throw new Error(`${treeDoc.name} is not a tree document.`);
  const cutoff = num(v.cutoff ?? 50);
  const { tree, collapsed } = condenseTree(parseNewick(nw), cutoff);
  const name = String(v.resultName ?? '').trim() || `${treeDoc.name} (condensed ${cutoff}%)`;
  const base = createTreeDocument(toNewick(tree), `${name}.nwk`);
  const t = now();
  const doc: SequenceDocument = {
    ...base,
    name,
    description: `${treeDoc.name} with ${collapsed} interior branch${collapsed === 1 ? '' : 'es'} below ${cutoff}% support collapsed`,
    moleculeType: treeDoc.moleculeType,
    alignmentMeta: treeDoc.alignmentMeta,
    folder: folderOf(ctx.folder ?? treeDoc.folder, 'Tree Documents'),
    docMetadata: { ...base.docMetadata, 'Source Format': 'Condensed tree', 'Support cutoff (%)': cutoff, 'Collapsed branches': collapsed },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Condense Tree', description: `${collapsed} branches < ${cutoff}% collapsed`, parentIds: [treeDoc.id], lengthBp: 0, topology: 'linear' }],
  };
  return { created: [doc], updated: [], summary: `Collapsed ${collapsed} branch${collapsed === 1 ? '' : 'es'} below ${cutoff}%` };
}

/** Maps a gene-tree tip to a species by a pasted map ("tip<TAB or ,>species" lines) or by its name. */
export function speciesMapper(v: OptionValues): (tip: string) => string | null {
  const map = new Map<string, string>();
  for (const line of String(v.mapText ?? '').split(/\r?\n/)) {
    const [tip, sp] = line.split(/\t|,|=/).map((x) => x?.trim());
    if (tip && sp) map.set(tip, sp);
  }
  const sep = String(v.separator ?? '_') || '_';
  return (tip: string) => {
    if (map.size) return map.get(tip) ?? map.get(tip.replace(/_/g, ' ')) ?? null;
    const parts = tip.split(sep).filter(Boolean);
    if (parts.length < 2) return null;
    return v.speciesFrom === 'prefix' ? parts[0] : parts[parts.length - 1];
  };
}

export function runGeneDuplications(geneDoc: SequenceDocument, speciesDoc: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult {
  const g = newickOf(geneDoc);
  const s = newickOf(speciesDoc);
  if (!g || !s) throw new Error('Choose a gene tree and a species tree (tree documents).');
  const speciesOf = speciesMapper(v);
  const geneTree = parseNewick(g);
  const speciesTree = parseNewick(s);
  const { tree: rooted, result } = v.reroot ? rootMinimizingDuplications(geneTree, speciesTree, speciesOf) : { tree: geneTree, result: inferDuplications(geneTree, speciesTree, speciesOf) };
  if (result.unmapped.length === leafNames(rooted).length) throw new Error('No gene-tree tip could be matched to a species-tree species; check the species naming or paste a tip-to-species map.');
  const name = String(v.resultName ?? '').trim() || `${geneDoc.name} duplications`;
  const base = createTreeDocument(result.newick, `${name}.nwk`);
  const t = now();
  const report = [
    `# ${name}`, '',
    `Gene tree: ${geneDoc.name}`, `Species tree: ${speciesDoc.name}`,
    `Root: ${v.reroot ? 'chosen to minimise duplications' : 'as given'}`, '',
    `Duplications: ${result.duplications.length}`, `Speciations: ${result.speciations}`,
    ...(result.unmapped.length ? [`Tips with no species: ${result.unmapped.join(', ')}`] : []), '',
    '## Duplication nodes (interior labels "D" in the tree; "S" = speciation)',
    ...result.duplications.map((d, i) => `${i + 1}. maps to {${d.species}}: ${d.tips.join(', ')}`),
  ].join('\n');
  const doc: SequenceDocument = {
    ...base,
    name,
    description: `${result.duplications.length} duplication${result.duplications.length === 1 ? '' : 's'}, ${result.speciations} speciation${result.speciations === 1 ? '' : 's'} (reconciled with ${speciesDoc.name})`,
    folder: folderOf(ctx.folder ?? geneDoc.folder, 'Tree Documents'),
    docMetadata: { ...base.docMetadata, 'Source Format': 'Gene duplication inference', Duplications: result.duplications.length, Speciations: result.speciations, 'Species tree': speciesDoc.name, Report: report },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Gene Duplication Inference', description: `${result.duplications.length} duplications vs ${speciesDoc.name}`, parentIds: [geneDoc.id, speciesDoc.id], lengthBp: 0, topology: 'linear' }],
  };
  return { created: [doc], updated: [], summary: doc.description };
}

// ───────────────────────────── highlight site categories ─────────────────────────────

export const SITE_NOTE = 'Site category from Highlight Sites';

export function runHighlightSites(doc: SequenceDocument, v: OptionValues): OperationResult {
  const rows = alignmentRowsOf(doc);
  if (!rows) throw new Error(`${doc.name} is not an aligned document.`);
  const cats = (Object.keys(SITE_CATEGORY_LABELS) as SiteCategory[]).filter((c) => v[c]);
  if (!cats.length) throw new Error('Choose at least one site category.');
  const colors: Record<SiteCategory, string> = { conserved: '#16a34a', variable: '#dc2626', singleton: '#f59e0b', parsimony: '#7c3aed', 'zero-fold': '#0891b2', 'two-fold': '#2563eb', 'four-fold': '#db2777' };
  const counts: string[] = [];
  const features: SequenceFeature[] = [];
  for (const c of cats) {
    const cols = classifySites(rows.map((r) => r.sequence), c, String(v.geneticCode ?? 'Standard'));
    counts.push(`${SITE_CATEGORY_LABELS[c]}: ${cols.length}`);
    columnRuns(new Set(cols)).forEach(([s, e], i) => features.push({
      id: uid(`${c}${i}`), name: `${SITE_CATEGORY_LABELS[c]} site${e > s ? 's' : ''}`, type: 'misc_feature', start: s, end: e, strand: 0, color: colors[c], notes: SITE_NOTE,
      qualifiers: { category: SITE_CATEGORY_LABELS[c] },
    }));
  }
  const t = now();
  const meta = { ...(doc.docMetadata ?? {}) };
  for (const line of counts) { const [k, n] = line.split(': '); meta[`${k} sites`] = Number(n); }
  return {
    created: [],
    updated: [{
      ...doc,
      features: [...doc.features.filter((f) => f.notes !== SITE_NOTE), ...features],
      docMetadata: meta,
      updatedAt: t,
      history: [...doc.history, { id: uid('hist'), timestamp: t, operation: 'Highlight Sites', description: counts.join('; '), parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
    }],
    summary: `${doc.name}: ${counts.join(', ')}`,
  };
}

// ───────────────────────────── timetree ─────────────────────────────

/** Calibrations are stored as JSON in the option `calibrations`. */
export function calibrationsOf(v: OptionValues): Calibration[] {
  try {
    const raw = JSON.parse(String(v.calibrations ?? '[]')) as Partial<Calibration>[];
    const n = (x: unknown) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
    return raw.filter((c) => c.taxonA && c.taxonB).map((c) => ({ taxonA: String(c.taxonA), taxonB: String(c.taxonB), minAge: n(c.minAge), maxAge: n(c.maxAge) }));
  } catch {
    return [];
  }
}

export async function runComputeTimetree(treeDoc: SequenceDocument, v: OptionValues, ctx: RunContext): Promise<OperationResult> {
  const nw = newickOf(treeDoc);
  if (!nw) throw new Error(`${treeDoc.name} is not a tree document.`);
  const outgroup = String(v.outgroup ?? '').trim();
  const cals = calibrationsOf(v);
  const tmethod: TimetreeMethod = v.method === 'mpl' ? 'mpl' : 'reltime';
  const members = treeDoc.alignmentMeta?.sequences ?? [];
  const wantCi = Boolean(v.ci) && num(v.ciReplicates ?? 100) > 0;
  if (wantCi && members.length < 3) throw new Error('Confidence intervals need the alignment the tree was built from; this tree document does not carry one (trees from Build Tree do).');
  let ciDone = 0;
  let r: TimetreeResult;
  if (wantCi) {
    const seen = new Map<string, number>();
    const labels = members.map((m) => {
      const b = sanitizeNewickLabel(m.name);
      const k = (seen.get(b) ?? 0) + 1;
      seen.set(b, k);
      return k === 1 ? b : `${b}_${k}`;
    });
    const names = members.map((m) => m.name);
    const seqs = members.map((m) => m.sequence.toUpperCase());
    const ci = await timetreeConfidence(parseNewick(nw), outgroup, cals, {
      method: tmethod, replicates: Math.min(1000, num(v.ciReplicates ?? 100)), labels, seqs, signal: ctx.signal,
      distances: (s) => fullMatrix(computeEvolutionaryDistances(names, s, 'Tamura-Nei (TN93)').pairwiseMatrix, names.length),
    });
    r = ci;
    ciDone = ci.replicatesDone;
  } else r = computeTimetree(parseNewick(nw), outgroup, cals, { method: tmethod });
  const unit = r.calibrated ? 'Mya' : 'relative time';
  const name = String(v.resultName ?? '').trim() || `${treeDoc.name} timetree`;
  const base = createTreeDocument(toNewick(r.tree), `${name}.nwk`);
  const t = now();
  const method = `${TIMETREE_METHODS[tmethod]}${ciDone ? `; 95% intervals from ${ciDone} bootstrap replicates` : ''}`;
  const fmt = (x: number) => (r.calibrated ? x.toFixed(2) : x.toFixed(4));
  const lines = [
    `# ${name}`, '', `Source tree: ${treeDoc.name}`, `Method: ${method}${outgroup ? `; rooted on ${outgroup} (outgroup left out)` : ''}`,
    r.calibrated ? `Scale: root age ${fmt(r.scale)} Mya` : 'No calibrations: ages are relative (root = 1).', '',
  ];
  if (r.calibrationReport.length) {
    lines.push('## Calibrations', '', ['Node', 'Min (Mya)', 'Max (Mya)', 'Estimated (Mya)', 'Met'].join('\t'));
    for (const c of r.calibrationReport) {
      lines.push([c.nodeLabel, c.calibration.minAge ?? '—', c.calibration.maxAge ?? '—', fmt(c.impliedAge), c.satisfied ? 'yes' : 'NO'].join('\t'));
    }
    lines.push('');
  }
  lines.push(`## Divergence times (${unit})`, '', ['Node (first – last descendant)', 'Tips', `Age (${unit})`, ...(ciDone ? ['95% low', '95% high'] : []), 'Relative rate'].join('\t'));
  for (const n of r.nodes) {
    lines.push([n.label, n.tips, fmt(n.age), ...(ciDone ? [n.ciLow === undefined ? '—' : fmt(n.ciLow), n.ciHigh === undefined ? '—' : fmt(n.ciHigh)] : []), n.relativeRate === null ? '—' : n.relativeRate.toFixed(3)].join('\t'));
  }
  lines.push('', 'Relative rate: substitutions per unit time on the branch above the node, relative to the tree-wide mean.',
    ciDone
      ? 'Intervals: sites bootstrapped, branch lengths rescaled by their replicate / full-data ratio (balanced least squares on the fixed topology), time scale drawn within the calibration range.'
      : 'Confidence intervals were not requested.');
  // Both documents keep the timetree's warnings (an outgroup not found, a calibration ignored,
  // relative ages) in their notes, through withWarningNotes.
  const tree = withWarningNotes<SequenceDocument>({
    ...base,
    name,
    description: `Timetree of ${leafNames(r.tree).length} sequences (${r.calibrated ? `root ${fmt(r.scale)} Mya` : 'relative ages'})`,
    moleculeType: treeDoc.moleculeType,
    folder: folderOf(ctx.folder ?? treeDoc.folder, 'Tree Documents'),
    docMetadata: {
      ...base.docMetadata, 'Source Format': 'Timetree', 'Branch lengths': unit, 'Timetree method': method,
      'Root age': fmt(r.scale), Calibrations: r.calibrationReport.length, ...(outgroup ? { Outgroup: outgroup } : {}),
    },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Compute Timetree', description: `${method}; ${r.calibrationReport.length} calibration(s)`, parentIds: [treeDoc.id], lengthBp: 0, topology: 'linear' }],
  }, r.warnings);
  const report = withWarningNotes<SequenceDocument>({
    id: uid('tt'), name: `${name} divergence times`, accession: '', description: `Divergence times for ${r.nodes.length} nodes (${unit})`,
    moleculeType: treeDoc.moleculeType, topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n' },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Compute Timetree', description: 'Divergence time table', parentIds: [treeDoc.id], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: tree.folder,
  }, r.warnings);
  const unmet = r.calibrationReport.filter((c) => !c.satisfied).length;
  return { created: [tree, report], updated: [], summary: r.calibrated ? `Timetree: root ${fmt(r.scale)} Mya${unmet ? `, ${unmet} calibration(s) not met` : ''}` : 'Timetree with relative ages (no calibrations)' };
}

// ───────────────────────────── degenerate primers, annotate from documents ─────────────────────────────

export const DEGENERATE_PRIMER_NOTE = 'Degenerate primer from Design Degenerate Primers';

export function runDesignDegeneratePrimers(doc: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult {
  const rows = alignmentRowsOf(doc);
  if (!rows) throw new Error(`${doc.name} is not an aligned document.`);
  if (doc.moleculeType === 'Protein') throw new Error('Primers need a nucleotide alignment.');
  const o: DegenerateOptions = {
    ...DEGENERATE_DEFAULTS,
    ...Object.fromEntries(Object.keys(DEGENERATE_DEFAULTS).filter((k) => v[k] !== undefined && v[k] !== '').map((k) => [k, num(v[k])])),
  } as DegenerateOptions;
  const res = designDegeneratePrimers(rows.map((r) => r.sequence), o, (s) => calculatePrimerMetrics(s).tmC);
  const t = now();
  const base = String(v.prefix ?? '').trim() || doc.name.replace(/\s+/g, '_').slice(0, 20);
  const fmtT = (p: DegeneratePrimer) => (Math.abs(p.tmHigh - p.tmLow) < 0.05 ? `${p.tmLow.toFixed(1)}` : `${p.tmLow.toFixed(1)}–${p.tmHigh.toFixed(1)}`);
  const records: PrimerRecord[] = [];
  const primerDocs: SequenceDocument[] = [];
  res.pairs.forEach((pair, i) => {
    for (const p of [pair.forward, pair.reverse]) {
      const name = `${base}_${p.strand === 1 ? 'F' : 'R'}${i + 1}`;
      const m = calculatePrimerMetrics(p.sequence.replace(/[^ACGT]/g, 'A'));
      const note = `${DEGENERATE_PRIMER_NOTE}; pair ${i + 1}; degeneracy ${p.degeneracy}; Tm ${fmtT(p)} °C; product ${pair.productLength} columns`;
      records.push({
        id: uid(`dp${i}`), name, sequence: p.sequence, annealSequence: p.sequence, tail5Prime: '', bindStart: p.start, bindEnd: p.end, strand: p.strand,
        length: p.sequence.length, gcPercent: (p.gcLow + p.gcHigh) / 2, tmAnnealC: (p.tmLow + p.tmHigh) / 2, tmFullC: (p.tmLow + p.tmHigh) / 2,
        deltaG37: m.deltaG37, hairpinDeltaG: m.hairpinDeltaG, selfDimerDeltaG: m.selfDimerDeltaG, gcClamp3Prime: p.clamp, notes: note,
      });
      if (v.savePrimerDocs) {
        primerDocs.push({
          id: uid('pdoc'), name, accession: '', description: `Degenerate primer (degeneracy ${p.degeneracy}, Tm ${fmtT(p)} °C) designed on ${doc.name}`,
          moleculeType: 'DNA', topology: 'linear', sequence: p.sequence, features: [], primers: [], documentKind: 'primer',
          docMetadata: { Degeneracy: p.degeneracy, 'Tm range (°C)': fmtT(p) },
          history: [{ id: uid('hist'), timestamp: t, operation: 'Design Degenerate Primers', description: note, parentIds: [doc.id], lengthBp: p.sequence.length, topology: 'linear' }],
          createdAt: t, updatedAt: t, folder: 'Primers' as SequenceDocument['folder'],
        });
      }
    }
  });
  const lines = [`# Degenerate primers for ${doc.name}`, '',
    `${rows.length} sequences × ${res.consensus.length} columns; bases in ≥ ${o.inclusionPct}% of sequences included; length ${o.minLen}–${o.maxLen}; degeneracy ≤ ${o.maxDegeneracy}; last ${o.exact3Prime} bases exact; Tm ${o.tmMin}–${o.tmMax} °C; product ${o.productMin}–${o.productMax}.`,
    `${res.candidatesForward} forward and ${res.candidatesReverse} reverse candidates.`, '',
    ['Pair', 'Primer', 'Sequence (5′→3′)', 'Columns', 'Degeneracy', 'Tm (°C)', 'GC %', 'Product'].join('\t')];
  res.pairs.forEach((pair, i) => {
    for (const p of [pair.forward, pair.reverse]) {
      lines.push([i + 1, p.strand === 1 ? 'forward' : 'reverse', p.sequence, `${p.start}–${p.end}`, p.degeneracy, fmtT(p), `${p.gcLow.toFixed(0)}–${p.gcHigh.toFixed(0)}`, pair.productLength].join('\t'));
    }
  });
  if (res.notes.length) lines.push('', ...res.notes.map((x) => `- ${x}`));
  lines.push('', 'Column positions are alignment columns; the product length counts alignment columns (sequences with indels differ slightly).', '', 'Degenerate consensus:', res.consensus);
  const report: SequenceDocument = {
    id: uid('dpr'), name: String(v.resultName ?? '').trim() || `${doc.name} degenerate primers`, accession: '',
    description: `${res.pairs.length} degenerate primer pair${res.pairs.length === 1 ? '' : 's'} for ${doc.name}`,
    moleculeType: doc.moleculeType, topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n' },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Design Degenerate Primers', description: `${res.pairs.length} pairs`, parentIds: [doc.id], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? doc.folder, 'Alignments'),
  };
  const updated: SequenceDocument = {
    ...doc,
    primers: [...doc.primers.filter((p) => !p.notes?.startsWith(DEGENERATE_PRIMER_NOTE)), ...records],
    updatedAt: t,
    history: [...doc.history, { id: uid('hist'), timestamp: t, operation: 'Design Degenerate Primers', description: `${res.pairs.length} pairs`, parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
  };
  if (!res.pairs.length) throw new Error(res.notes.join(' ') || 'No primer pairs found.');
  return { created: [report, ...primerDocs], updated: [updated], summary: `${res.pairs.length} degenerate primer pair${res.pairs.length === 1 ? '' : 's'} (best: degeneracy ${res.pairs[0].forward.degeneracy} / ${res.pairs[0].reverse.degeneracy}, product ${res.pairs[0].productLength})` };
}

export const TRANSFERRED_NOTE = 'Annotated from';

export function runAnnotateFromDocuments(targets: SequenceDocument[], references: SequenceDocument[], v: OptionValues): OperationResult {
  const refs = references.filter((r) => !targets.some((t) => t.id === r.id) && r.features.some((f) => f.type !== 'source'));
  if (!refs.length) throw new Error('Choose at least one reference document that has annotations (and is not a target).');
  const minId = num(v.minIdentity ?? 90);
  const minLen = num(v.minLength ?? 15);
  const t = now();
  const updated: SequenceDocument[] = [];
  let total = 0;
  for (const d of targets) {
    if (d.moleculeType === 'Protein' || !d.sequence) continue;
    const hits = annotateFromDocuments(d, refs, minId, minLen);
    const kept = v.replace !== false ? d.features.filter((f) => !f.notes?.startsWith(TRANSFERRED_NOTE)) : d.features;
    // A hit is already on the document when its parts and an existing feature of its type share at
    // least 90% of the bases the one covering fewer covers, read part by part rather than span by
    // span: a hit across the origin spans 1..n, as does an existing feature across it, and that
    // span contains every feature (BG-01M6S1Q9).
    const fresh = hits.filter((h) => !kept.some((f) => f.type === h.feature.type
      && sameCoveredSite(featureCover(f), featureCover({ start: h.start, end: h.end, segments: h.feature.segments }))));
    if (!fresh.length && kept.length === d.features.length) continue;
    total += fresh.length;
    updated.push({
      ...d,
      features: [...kept, ...fresh.map((h, i) => ({
        ...h.feature, id: uid(`af${i}`), start: h.start, end: h.end, strand: h.strand,
        notes: `${TRANSFERRED_NOTE} ${h.reference} (${h.identityPct.toFixed(1)}% identity)`,
      }))],
      updatedAt: t,
      history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Annotate from Documents', description: `${fresh.length} annotations from ${refs.length} reference document${refs.length === 1 ? '' : 's'} (≥ ${minId}% identity)`, parentIds: [d.id, ...refs.map((r) => r.id)], lengthBp: d.sequence.length, topology: d.topology }],
    });
  }
  return { created: [], updated, summary: `${total} annotation${total === 1 ? '' : 's'} added to ${updated.length} of ${targets.length} sequence${targets.length === 1 ? '' : 's'} from ${refs.length} reference${refs.length === 1 ? '' : 's'}` };
}

// ───────────────────────────── primer import, annotate by BLAST ─────────────────────────────

export function runImportPrimers(text: string, v: OptionValues): OperationResult {
  const { rows, skipped } = parsePrimerSpreadsheet(text);
  if (!rows.length) throw new Error(skipped.length ? `No primers imported: ${skipped.slice(0, 3).map((s) => `line ${s.line} ${s.reason}`).join('; ')}.` : 'Paste or choose a spreadsheet with primer names and sequences.');
  const t = now();
  const folder = (String(v.folder ?? '').trim() || 'Primers') as SequenceDocument['folder'];
  const created: SequenceDocument[] = rows.map((r, i) => {
    // The primer as imported, ambiguity codes and all (BG-01M6SHQ0): they were rewritten to A, so a
    // primer holding N was given the Tm of a different oligo. One holding them has no Tm, and its
    // 'Tm (°C)' row gives the engine's reason instead.
    const m = calculatePrimerMetrics(r.sequence);
    return {
      id: uid(`ip${i}`), name: r.name, accession: '', description: r.description || `Imported primer (${r.sequence.length} nt)`,
      moleculeType: 'DNA', topology: 'linear', sequence: r.sequence, features: [], primers: [], documentKind: 'primer',
      docMetadata: { 'Source Format': 'Primer spreadsheet', 'Tm (°C)': m.tmNoAnswerReason ?? Number(m.tmC.toFixed(1)), 'GC %': Number(m.gcPercent.toFixed(1)) },
      history: [{ id: uid('hist'), timestamp: t, operation: 'Import Primers', description: 'Imported from a primer spreadsheet', parentIds: [], lengthBp: r.sequence.length, topology: 'linear' }],
      createdAt: t, updatedAt: t, folder,
    };
  });
  return { created, updated: [], summary: `Imported ${created.length} primer${created.length === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped)` : ''}` };
}

/**
 * The query cap the BLAST engine applies per program (crates/molbiocraft-align/src/search_blast.rs,
 * PRD TD-05): a longer query is searched on its first `cap` letters only.
 */
const BLAST_QUERY_CAPS: Readonly<Record<BlastHitRecord['program'], { cap: number; unit: 'nt' | 'residues' }>> = {
  blastn: { cap: 10_000, unit: 'nt' },
  blastp: { cap: 10_000, unit: 'residues' },
  tblastn: { cap: 10_000, unit: 'residues' },
  blastx: { cap: 30_000, unit: 'nt' },
};

export interface BlastQueryCut {
  program: BlastHitRecord['program'];
  cap: number;
  unit: 'nt' | 'residues';
  /** Query letters in all, counted as the engine counts them. */
  length: number;
}

/**
 * What the engine trims from both ends of a query line (search_blast.rs `is_query_blank`): Rust's
 * `char::is_whitespace` plus U+FEFF, the byte-order mark. JS's `\s` is that set less U+0085.
 */
const QUERY_LINE_BLANK_ENDS = /^[\s\u0085]+|[\s\u0085]+$/g;

/**
 * BLAST query text read as the engine reads it (search_blast.rs `read_blast_query`, BG-01M6QHDJ),
 * which the WASM parity test in blastTruncationWarning.test.tsx holds this to: lines end at `\n` or
 * `\r` and are trimmed of `QUERY_LINE_BLANK_ENDS`; a line that then starts with `;` is a comment and
 * is dropped. With any `>` header line, the query is the lines of the first record only, and any
 * non-blank line before its header is ignored and flagged; with none, every line but the comments
 * is the query and nothing is flagged. Only ASCII letters count.
 */
function readBlastQueryText(query: string): { letters: number; records: number; textBeforeHeader: boolean } {
  let headers = 0;
  let letters = 0;
  let unheaded = 0;
  let textBeforeHeader = false;
  for (const raw of query.split(/[\n\r]/)) {
    const line = raw.replace(QUERY_LINE_BLANK_ENDS, '');
    if (line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      headers += 1;
      continue;
    }
    const n = line.replace(/[^A-Za-z]/g, '').length;
    if (headers === 0) {
      unheaded += n;
      if (line) textBeforeHeader = true;
    } else if (headers === 1) {
      letters += n;
    }
  }
  return headers ? { letters, records: headers, textBeforeHeader } : { letters: unheaded, records: 1, textBeforeHeader: false };
}

/** The query letters BLAST searches (before its cap), counted by the engine's query-text rule. */
export function blastQueryLetters(query: string): number {
  return readBlastQueryText(query).letters;
}

/**
 * How `program` cuts `query`, or null when it searches the whole query. Letters are counted by the
 * engine's query-text rule (`blastQueryLetters`). The engine reports a cut on each hit's
 * `warnings`; a cut query with no hit returns an empty list, so callers use this to report the cut
 * then too (D0005).
 */
export function blastQueryCut(query: string, program: BlastHitRecord['program']): BlastQueryCut | null {
  const { cap, unit } = BLAST_QUERY_CAPS[program];
  const length = blastQueryLetters(query);
  return length > cap ? { program, cap, unit, length } : null;
}

/**
 * The warnings the engine puts on every hit for how it read the query text (several FASTA records,
 * then text before the first header), in its words and order. A search with no hit returns nothing
 * to carry them, so the BLAST window shows these itself then (D0005).
 */
export function blastQueryTextWarnings(query: string, program: BlastHitRecord['program']): string[] {
  const { letters, records, textBeforeHeader } = readBlastQueryText(query);
  const { unit } = BLAST_QUERY_CAPS[program];
  const out: string[] = [];
  if (records > 1) {
    out.push(`Query holds ${records} FASTA records: ${program} searched only the first (${letters} ${unit}); query coordinates and coverage are against that record.`);
  }
  if (textBeforeHeader) out.push('Text before the first FASTA header was ignored.');
  return out;
}

/**
 * The notice for a cut query whose search found no hit, worded like the engine's hit warning, its
 * lengths bare as the engine prints them; the BLAST window groups them when it shows any notice.
 */
export function blastQueryCutNotice(c: BlastQueryCut): string {
  return `Query truncated: ${c.program} has a query cap of ${c.cap} ${c.unit}, so only query 1-${c.cap} of ${c.length} ${c.unit} was searched, and no hit was found there.`;
}

/** A length as the workbench prints one ("10,000"). */
const grouped = (n: number) => n.toLocaleString();

/** What a target annotate-by-BLAST searched only up to blastn's cap records in its History (D0005). */
function annotateCapNote(c: BlastQueryCut): string {
  return `Searched only nt 1-${grouped(c.cap)} of this ${grouped(c.length)}-nt sequence: blastn's query cap is ${grouped(c.cap)} nt, so no hit past nt ${grouped(c.cap)} could be found.`;
}

export function runAnnotateByBlast(targets: SequenceDocument[], database: SequenceDocument[], v: OptionValues): OperationResult {
  const maxHits = Math.max(1, num(v.maxHits ?? 5));
  const minHitIdentity = num(v.minHitIdentity ?? 80);
  const t = now();
  const updated: SequenceDocument[] = [];
  const lines: string[] = [];
  let total = 0;
  let annotated = 0;
  let cuts = 0;
  for (const d of targets) {
    if (d.moleculeType === 'Protein' || !d.sequence) continue;
    // the whole target is the blastn query: past the cap only its first part is searched (D0005).
    // The status toast is one line that clips and fades, so the full note goes in the target's
    // History, even when the run adds nothing to it, and the summary points there.
    const cut = blastQueryCut(d.sequence, 'blastn');
    if (cut) cuts += 1;
    const label = cut ? `${d.name} (nt 1-${grouped(cut.cap)} of ${grouped(cut.length)} searched)` : d.name;
    const recordCut = (description: string) => {
      if (cut) updated.push({ ...d, history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Annotate by BLAST', description: `${description}. ${annotateCapNote(cut)}`, parentIds: [d.id], lengthBp: d.sequence.length, topology: d.topology }], updatedAt: t });
    };
    const pool = database.filter((x) => x.id !== d.id && x.moleculeType !== 'Protein' && x.sequence.length > 0);
    const hits = runLocalBlastSearch(d.sequence, pool, 'blastn', 'Annotate by BLAST')
      .filter((h) => h.identityPct >= minHitIdentity)
      .sort((a, b) => b.bitScore - a.bitScore);
    const byId = new Map(pool.map((x) => [x.id, x]));
    const refs: SequenceDocument[] = [];
    for (const h of hits) {
      const ref = byId.get(h.id.replace(/^blast-hit-/, '').replace(/~hsp\d+$/, '')) ?? byId.get(h.id);
      if (ref && ref.features.some((f) => f.type !== 'source') && !refs.includes(ref)) refs.push(ref);
      if (refs.length >= maxHits) break;
    }
    if (!refs.length) {
      lines.push(`${label}: no annotated hits ≥ ${minHitIdentity}% identity`);
      recordCut(`No annotated hits ≥ ${minHitIdentity}% identity`);
      continue;
    }
    const names = refs.map((x) => x.name).join(', ');
    const r = runAnnotateFromDocuments([d], refs, v);
    const u = r.updated[0];
    if (u) {
      const n = u.features.length - d.features.filter((f) => v.replace === false || !f.notes?.startsWith(TRANSFERRED_NOTE)).length;
      total += Math.max(0, n);
      annotated += 1;
      const description = `${Math.max(0, n)} annotations from top hits: ${names}`;
      updated.push({ ...u, history: [...u.history.slice(0, -1), { ...u.history[u.history.length - 1], operation: 'Annotate by BLAST', description: cut ? `${description}. ${annotateCapNote(cut)}` : description }], updatedAt: t });
    } else {
      recordCut(`0 annotations from top hits: ${names}`);
    }
    lines.push(`${label}: hits ${names}`);
  }
  // a short pointer ahead of the per-target lines, where the one-line toast does not clip it
  const pointer = cuts ? `; ${cuts} target${cuts === 1 ? '' : 's'} partly searched, see History` : '';
  return { created: [], updated, summary: `${total} annotation${total === 1 ? '' : 's'} added to ${annotated} sequence${annotated === 1 ? '' : 's'}${pointer}${lines.length ? ` — ${lines.join('; ')}` : ''}` };
}

// ───────────────────────────── CRISPR editing analysis ─────────────────────────────

export function runCrisprEditing(control: SequenceDocument, edited: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  if (!control.chromatogram) throw new Error(`${control.name} has no trace data: choose a Sanger read (.ab1) as the control.`);
  const reads = edited.filter((d) => d.id !== control.id);
  if (!reads.length) throw new Error('Select at least one edited Sanger read (other than the control).');
  const opts = { guide: String(v.guide ?? ''), cutIndex: num(v.cutPosition ?? 0) - 1, maxIndel: Math.max(1, Math.min(30, num(v.maxIndel ?? 10))), window: Math.max(20, num(v.window ?? 100)), donor: String(v.donor ?? '').trim() || undefined };
  const t = now();
  const lines = [`# CRISPR editing analysis`, '', `Control: ${control.name}`, opts.guide.trim() ? `Guide: ${opts.guide.trim().toUpperCase()}` : `Cut after control base ${opts.cutIndex}`, `Indel range: −${opts.maxIndel} … +${opts.maxIndel}; decomposition window ${opts.window} bases after the cut.`, ''];
  const summaries: string[] = [];
  const meta: Record<string, string | number> = {};
  for (const d of reads) {
    if (!d.chromatogram) { lines.push(`## ${d.name}`, '', 'No trace data: skipped.', ''); continue; }
    const r = analyzeEditing(control.chromatogram, d.chromatogram, opts);
    lines.push(`## ${d.name}`, '',
      `Cut site: after control base ${r.cut}${r.guideStrand ? ` (guide on the ${r.guideStrand === 1 ? 'forward' : 'reverse'} strand, PAM ${r.pam})` : ''}`,
      `Alignment to control upstream of the cut: ${r.alignmentIdentity.toFixed(1)}% identity (offset ${r.offset >= 0 ? '+' : ''}${r.offset})`,
      `Editing efficiency (non-wild-type): ${r.efficiencyPct.toFixed(1)}%   R² = ${r.rSquared.toFixed(3)}   (${r.positionsUsed} positions)`,
      ...(r.hdrPct !== undefined ? [`Knock-in (HDR) allele: ${r.hdrPct.toFixed(1)}%`] : []),
      `ICE-compatible score (Synthego ICE method, R²-adjusted): ${r.ice.editingPct.toFixed(0)}% edited${r.ice.hdrPct !== undefined ? `, ${r.ice.hdrPct.toFixed(0)}% HDR` : ''} (R² ${r.ice.rSquared.toFixed(2)})`,
      `Aberrant signal: ${r.aberrantBeforePct.toFixed(1)}% before the cut, ${r.aberrantAfterPct.toFixed(1)}% after`, '',
      ['Indel', 'Frequency (%)', ''].join('\t'));
    for (const s of r.spectrum.sort((a, b) => a.indel - b.indel)) {
      if (s.pct < 0.5 && s.indel !== 0) continue;
      lines.push([s.indel === 0 ? '0 (wild type)' : s.indel > 0 ? `+${s.indel}` : String(s.indel), s.pct.toFixed(1), '█'.repeat(Math.round(s.pct / 2))].join('\t'));
    }
    if (r.rSquared < 0.8) r.warnings.push('R² below 0.8: the indel model explains the trace poorly (low trace quality, large indels outside the range, or a different template).');
    if (r.warnings.length) lines.push('', ...r.warnings.map((w) => `- ${w}`));
    lines.push('');
    summaries.push(`${d.name}: ${r.efficiencyPct.toFixed(1)}% edited (R² ${r.rSquared.toFixed(2)})`);
    meta[`${d.name} efficiency (%)`] = Number(r.efficiencyPct.toFixed(1));
    meta[`${d.name} ICE score`] = Math.round(r.ice.editingPct);
    if (r.hdrPct !== undefined) meta[`${d.name} HDR (%)`] = Number(r.hdrPct.toFixed(1));
  }
  lines.push('Negative indels are deletions, positive are insertions. Frequencies are estimated by non-negative least squares (TIDE method, Brinkman et al. 2014); values below about 1–2% are within noise. The ICE-compatible score follows Synthego ICE (all deletion positions around the cut, unknown inserted bases, positive Lasso, R²-scaled); on Synthego’s test traces it is within 5 points of ICE.');
  const doc: SequenceDocument = {
    id: uid('crispr'), name: String(v.resultName ?? '').trim() || `${reads.length === 1 ? reads[0].name : `${reads.length} reads`} editing analysis`, accession: '',
    description: summaries.join('; '), moleculeType: 'DNA', topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n', ...meta },
    history: [{ id: uid('hist'), timestamp: t, operation: 'CRISPR Editing Analysis', description: summaries.join('; '), parentIds: [control.id, ...reads.map((r) => r.id)], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? reads[0].folder, 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder']),
  };
  return { created: [doc], updated: [], summary: summaries.join('; ') };
}

// ───────────────────────────── expression analysis ─────────────────────────────

export const EXPRESSION_KEY = 'Expression results';

/** Compact results stored on the document: [gene, baseMean, log2FC, lfcSE, pvalue, padj]. */
export interface StoredExpression {
  conditionA: string;
  conditionB: string;
  samplesA: string[];
  samplesB: string[];
  alpha: number;
  lfcThreshold: number;
  pca: { sample: string; group: string; pc1: number; pc2: number }[];
  pcaVariance: [number, number];
  rows: [string, number, number, number, number, number][];
}

export function runExpressionAnalysis(table: CountTable, v: OptionValues, ctx: RunContext): OperationResult {
  const samplesA = JSON.parse(String(v.samplesA ?? '[]')) as string[];
  const samplesB = JSON.parse(String(v.samplesB ?? '[]')) as string[];
  const conditionA = String(v.conditionA ?? '').trim() || 'A';
  const conditionB = String(v.conditionB ?? '').trim() || 'B';
  const r = differentialExpression(table, {
    samplesA, samplesB, conditionA, conditionB, minTotal: num(v.minTotal ?? 10), alpha: num(v.alpha ?? 0.05), lfcThreshold: num(v.lfcThreshold ?? 0), pcaGenes: num(v.pcaGenes ?? 500),
  });
  const round = (x: number, d: number) => (Number.isFinite(x) ? Number(x.toPrecision(d)) : NaN);
  const stored: StoredExpression = {
    conditionA, conditionB, samplesA, samplesB, alpha: r.alpha, lfcThreshold: r.lfcThreshold, pca: r.pca, pcaVariance: r.pcaVariance,
    rows: r.genes.map((g) => [g.gene, round(g.baseMean, 5), round(g.log2FC, 4), round(g.lfcSE, 3), round(g.pvalue, 3), round(g.padj, 3)]),
  };
  const top = [...r.genes].filter((g) => Number.isFinite(g.padj)).sort((a, b) => a.padj - b.padj).slice(0, 30);
  const lines = [
    `# ${conditionB} vs ${conditionA}`, '',
    `${conditionA}: ${samplesA.join(', ')}`, `${conditionB}: ${samplesB.join(', ')}`,
    `${r.genes.length.toLocaleString()} genes tested (${r.filteredOut.toLocaleString()} with fewer than ${num(v.minTotal ?? 10)} total counts left out).`,
    `Size factors: ${Object.entries(r.sizeFactors).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(', ')}`,
    `Dispersion trend: α = ${r.dispersionTrend[0].toFixed(4)} + ${r.dispersionTrend[1].toFixed(3)} / mean`,
    `Significant (padj < ${r.alpha}${r.lfcThreshold ? `, |log2FC| ≥ ${r.lfcThreshold}` : ''}): ${r.significant} (${r.up} up, ${r.down} down in ${conditionB})`, '',
    '## Top genes by adjusted p-value', '', ['Gene', 'baseMean', 'log2FC', 'lfcSE', 'p-value', 'padj'].join('\t'),
    ...top.map((g) => [g.gene, g.baseMean.toFixed(1), g.log2FC.toFixed(3), g.lfcSE.toFixed(3), g.pvalue.toExponential(2), g.padj.toExponential(2)].join('\t')),
    '', 'DESeq2 procedure (median-of-ratios size factors, Cox–Reid / MAP dispersions, NB GLM Wald test, Cook’s-distance flagging, independent filtering, Benjamini–Hochberg); checked against Bioconductor DESeq2 on the pasilla data. Fold changes are not shrunk (no lfcShrink). The full table and plots are shown above; use Export CSV for all genes.',
  ];
  const t = now();
  const doc: SequenceDocument = {
    id: uid('expr'), name: String(v.resultName ?? '').trim() || `${ctx.sourceLabel} ${conditionB} vs ${conditionA}`, accession: '',
    description: `Differential expression: ${r.significant} genes at padj < ${r.alpha} (${r.up} up, ${r.down} down)`,
    moleculeType: 'DNA', topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n', [EXPRESSION_KEY]: JSON.stringify(stored), 'Genes tested': r.genes.length, 'Significant genes': r.significant },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Differential Expression', description: `${conditionB} vs ${conditionA}; ${r.significant} significant`, parentIds: [], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder, 'Alignments'),
  };
  return { created: [doc], updated: [], summary: `${r.significant} differentially expressed genes (${r.up} up, ${r.down} down) of ${r.genes.length.toLocaleString()} tested` };
}

// ───────────────────────────── BLAST query-centric alignment ─────────────────────────────

export function runQueryCentricAlignment(query: SequenceDocument, querySeq: string, hits: BlastHitRecord[], ctx: RunContext, subjects: SequenceDocument[] = []): OperationResult {
  if (!hits.length) throw new Error('No BLAST hits to align.');
  const q = querySeq.toUpperCase().replace(/[^A-Z*]/g, '');
  const byId = new Map(subjects.map((d) => [d.id, d]));
  const realign = (h: BlastHitRecord) => {
    const subj = byId.get(h.id.replace(/^blast-hit-/, '').replace(/~hsp\d+$/, ''));
    if (!subj || h.program !== 'blastn') return null;
    const qs = Math.min(h.queryStart, h.queryEnd);
    const qe = Math.max(h.queryStart, h.queryEnd);
    const ss = Math.min(h.subjectStart, h.subjectEnd);
    const se = Math.max(h.subjectStart, h.subjectEnd);
    if (qe - qs > 6000) return null;
    let region = subj.sequence.toUpperCase().slice(ss - 1, se);
    if (h.subjectStart > h.subjectEnd) region = reverseComplementDna(region);
    const r = invokeRustBioSync<{ alignedSeq1: string; alignedSeq2: string }>('align_pairwise', {
      seq1: q.slice(qs - 1, qe), seq2: region, mode: 'global', matchScore: 2, mismatchPenalty: -3, gapOpen: -5, gapExtend: -2, maxLen: Math.max(qe - qs, se - ss) + 10,
    });
    return { alignedQuery: r.alignedSeq1, alignedSubject: r.alignedSeq2 };
  };
  const rows = queryCentricRows(q, hits, realign);
  const doc = newAlignmentDoc(query, `${query.name} BLAST hits (query-centric)`,
    [{ name: `${query.name} (query)`, sequence: q }, ...rows.map((r) => ({ name: r.name, sequence: r.sequence, accession: r.hit.accession, description: r.hit.description }))],
    'BLAST Query-Centric Alignment', `${hits.length} BLAST hits placed on the query (insertions relative to the query not shown)`,
    [query.id, ...new Set(hits.map((h) => h.id.replace(/^blast-hit-/, '').replace(/~hsp\d+$/, '')))], ctx.folder, { 'BLAST program': hits[0].program });
  return { created: [doc], updated: [], summary: `Query-centric alignment of ${hits.length} hits` };
}

const DNA_COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', N: 'N' };
const reverseComplementDna = (s: string) => [...s].reverse().map((c) => DNA_COMP[c] ?? 'N').join('');

// ───────────────────────────── expression levels from mapped reads ─────────────────────────────

export const COUNT_TABLE_KEY = 'Count table';

export function runCalculateExpressionLevels(contigs: SequenceDocument[], findDoc: (id: string) => SequenceDocument | undefined, v: OptionValues, ctx: RunContext): OperationResult {
  const usable = contigs.filter((c) => (c.alignmentMeta?.sequences?.length ?? 0) > 1 && c.docMetadata?.Reference);
  if (!usable.length) throw new Error('Select reference-mapping contigs (from Map to Reference), one per sample.');
  const refIds = usable.map((c) => c.history[0]?.parentIds?.[0]);
  const ref = refIds[0] ? findDoc(refIds[0]) : undefined;
  if (!ref) throw new Error('The reference document of the first contig was not found (it may have been deleted).');
  if (refIds.some((id) => id !== refIds[0])) throw new Error('All contigs must be mapped to the same reference (one contig per sample).');
  const types = String(v.featureTypes ?? 'gene,CDS').split(/[,\s]+/).filter(Boolean);
  const genes = geneRegions(ref.features, types);
  if (!genes.length) throw new Error(`${ref.name} has no ${types.join(' / ')} annotations to count reads on.`);
  const mode = (['split', 'each', 'discard'] as const).find((m) => m === v.ambiguous) ?? 'split';
  const minOverlap = Math.max(1, num(v.minOverlap ?? 10));
  const seen = new Map<string, number>();
  const samples = usable.map((c) => {
    const base = c.name.replace(/\s*(contig|mapping).*$/i, '').trim() || c.name;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return sampleLevels(k === 1 ? base : `${base}_${k}`, c, genes, minOverlap, mode);
  });
  const f = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(2));
  const lines = [
    `# Expression levels on ${ref.name}`, '',
    `${genes.length} ${types.join('/')} regions; reads counted when overlapping ≥ ${minOverlap} bp; reads overlapping several genes ${mode === 'split' ? 'split between them' : mode === 'each' ? 'counted to each' : 'left out'}.`,
    ...samples.map((s) => `${s.sample}: ${s.mappedReads} mapped reads, ${s.unassigned} outside genes, ${s.ambiguous} ambiguous`), '',
    ['Gene', 'Length', ...samples.flatMap((s) => [`${s.sample} reads`, `${s.sample} FPKM`, `${s.sample} TPM`])].join('\t'),
    ...genes.map((g, i) => [g.name, g.length, ...samples.flatMap((s) => [f(s.counts[i]), f(s.fpkm[i]), f(s.tpm[i])])].join('\t')),
    '', 'FPKM = reads / (gene length in kb × mapped reads in millions); TPM = reads per kb rescaled so each sample sums to 10⁶.',
    'The count table is stored with this document: use it in Compare Expression Levels (choose “From a document”).',
  ];
  const t = now();
  const doc: SequenceDocument = {
    id: uid('expl'), name: String(v.resultName ?? '').trim() || `${ref.name} expression levels`, accession: '',
    description: `Read counts, FPKM and TPM for ${genes.length} genes in ${samples.length} sample${samples.length === 1 ? '' : 's'}`,
    moleculeType: 'DNA', topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n', [COUNT_TABLE_KEY]: countTableTsv(genes, samples), Reference: ref.name },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Calculate Expression Levels', description: `${samples.length} samples on ${ref.name}`, parentIds: [ref.id, ...usable.map((c) => c.id)], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? usable[0].folder, 'Contig Assembly'),
  };
  return { created: [doc], updated: [], summary: `Expression levels for ${genes.length} genes in ${samples.length} sample${samples.length === 1 ? '' : 's'}` };
}

// ───────────────────────────── structural variants ─────────────────────────────

export const SV_NOTE = 'Structural variant from Find Structural Variants';

export function runFindStructuralVariants(ref: SequenceDocument, reads: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  if (!reads.length) throw new Error('Select the reads to analyse.');
  if (ref.moleculeType === 'Protein') throw new Error('Structural variants need a nucleotide reference.');
  const o = { minClip: num(v.minClip ?? 20), minSize: num(v.minSize ?? 20), minSupport: num(v.minSupport ?? 2), tolerance: num(v.tolerance ?? 10) };
  const res = findStructuralVariants(ref.sequence, reads.filter((r) => r.id !== ref.id).map((r) => ({ name: r.name, sequence: r.chromatogram?.baseCalls || r.sequence })), o, ref.topology === 'circular');
  if (!res.placed) throw new Error('None of the reads match the reference.');
  const calls = res.calls;
  const t = now();
  const label = (c: SvCall) => (c.type === 'Insertion' ? `Insertion at ${c.start} (≥ ${c.size} bp)` : `${c.type} ${c.start}–${c.end} (${c.size.toLocaleString()} bp)`);
  const colors: Record<SvType, string> = { Deletion: '#d14343', Insertion: '#7c3aed', 'Tandem duplication': '#c77d14', Inversion: '#0e9aa7' };
  const features: SequenceFeature[] = calls.map((c, i) => ({
    id: uid(`sv${i}`), name: label(c), type: 'variation', start: c.start, end: Math.max(c.start, c.end), strand: 0, color: colors[c.type], notes: SV_NOTE,
    qualifiers: { sv_type: c.type, size: String(c.size), supporting_reads: String(c.support) },
  }));
  const lines = [
    `# Structural variants: ${reads.length} reads on ${ref.name}`, '',
    `${res.placed} of ${reads.length} reads placed on the reference by exact 15-mer matches; split reads (two segments) and unmatched read ends of ≥ ${o.minClip} bases give breakpoints; events ≥ ${o.minSize} bp with ≥ ${o.minSupport} supporting reads.`, '',
    ['Type', 'Start', 'End', 'Size (bp)', 'Supporting reads'].join('\t'),
    ...calls.map((c) => [c.type, c.start, c.end, c.size, c.support].join('\t')),
    ...(calls.length ? [] : ['(no structural variants found)']),
    '', 'Split-read evidence only: read pairs and read depth are not used, so inserted sequence longer than the reads is reported as a minimum size, and breakpoints inside repeats (k-mers found more than once in the reference) are not seen.',
  ];
  const report: SequenceDocument = {
    id: uid('svr'), name: `${ref.name} structural variants`, accession: '', description: `${calls.length} structural variant${calls.length === 1 ? '' : 's'} from ${res.placed} reads`,
    moleculeType: ref.moleculeType, topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: lines.join('\n') + '\n' },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Find Structural Variants', description: `${calls.length} events`, parentIds: [ref.id, ...reads.map((r) => r.id)], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? ref.folder, 'Contig Assembly'),
  };
  const annotated: SequenceDocument = {
    ...ref, id: uid('svref'), name: `${ref.name} (structural variants)`, features: [...ref.features.filter((f) => f.notes !== SV_NOTE), ...features],
    history: [...ref.history, { id: uid('hist'), timestamp: t, operation: 'Find Structural Variants', description: `${calls.length} events annotated`, parentIds: [ref.id, ...reads.map((r) => r.id)], lengthBp: ref.sequence.length, topology: ref.topology }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? ref.folder, 'Contig Assembly'),
  };
  return { created: [annotated, report], updated: [], summary: `${calls.length} structural variant${calls.length === 1 ? '' : 's'}${calls.length ? `: ${calls.slice(0, 3).map(label).join('; ')}` : ''}` };
}

// ───────────────────────────── fragment analysis / microsatellites ─────────────────────────────

export const FRAGMENT_TRACE_KEY = 'Fragment trace';
export const FRAGMENT_SIZING_KEY = 'Fragment sizing';
export const ALLELE_CALLS_KEY = 'Allele calls';

/** Document for an imported `.fsa` run (text document carrying the trace; the electropherogram is drawn from it). */
export function fragmentDocumentFromFsa(bytes: Uint8Array, fileName: string): SequenceDocument {
  const trace = parseFsa(bytes);
  const t = now();
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.(fsa|hid|ab1)$/i, '');
  const scans = Math.max(...trace.channels.map((c) => c.data.length));
  const notes = [
    `# ${name}`, '', `Fragment analysis run${trace.sample ? ` — sample ${trace.sample}` : ''}`,
    `${trace.channels.length} dye channels (${trace.channels.map((c) => c.dye).join(', ')}), ${scans.toLocaleString()} scans, ${trace.dataKind} data${trace.dyeSet ? `, dye set ${trace.dyeSet}` : ''}${trace.instrument ? `, ${trace.instrument}` : ''}.`,
    '', 'Not sized yet: use Annotate → Microsatellite Analysis… to size against a size standard and call alleles.',
  ];
  return {
    id: uid('fsa'), name, accession: '', description: `Fragment analysis run, ${trace.channels.length} dyes${trace.sample ? `, ${trace.sample}` : ''}`,
    moleculeType: 'DNA', topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: {
      'Document Type': 'Text Document', 'Source Format': 'ABIF fragment analysis (.fsa)', Notes: notes.join('\n') + '\n',
      [FRAGMENT_TRACE_KEY]: JSON.stringify(trace), Dyes: trace.channels.map((c) => c.dye).join(', '), ...(trace.sample ? { 'Sample Name': trace.sample } : {}),
    },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Import', description: `Imported ${fileName}`, parentIds: [], lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder'],
  };
}

export function fragmentTraceOf(doc: SequenceDocument): FragmentTrace | null {
  const raw = doc.docMetadata?.[FRAGMENT_TRACE_KEY];
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as FragmentTrace; } catch { return null; }
}

export function runMicrosatellites(docs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult {
  const runs = docs.map((d) => ({ d, trace: fragmentTraceOf(d) })).filter((x): x is { d: SequenceDocument; trace: FragmentTrace } => !!x.trace);
  if (!runs.length) throw new Error('Select fragment-analysis runs (.fsa files) in the table.');
  const stdName = String(v.standard ?? 'GeneScan 500 LIZ');
  const sizes = stdName === 'custom'
    ? String(v.customSizes ?? '').split(/[,\s;]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
    : stdName === 'auto' ? [1, 2, 3, 4] : SIZE_STANDARDS[stdName];
  if (!sizes || sizes.length < 4) throw new Error('The size standard needs at least four fragment sizes.');
  const markers = String(v.panel ?? '').trim() ? parsePanel(String(v.panel)) : [];
  const o = { minHeight: num(v.minHeight ?? 100), stutterPct: num(v.stutterPct ?? 25), balancePct: num(v.balancePct ?? 30) };
  const t = now();
  const updated: SequenceDocument[] = [];
  const table: string[][] = [];
  const problems: string[] = [];
  // size every run first: allelic ladders must be calibrated before the samples are named
  const sizedRuns: { d: SequenceDocument; trace: FragmentTrace; ladder: FragmentTrace['channels'][number]; sizing: Sizing; usedStd: string; warn: string | null }[] = [];
  for (const { d, trace } of runs) {
    const want = String(v.sizeDye ?? '').trim().toLowerCase();
    const ladder = trace.channels.find((c) => want && c.dye.toLowerCase() === want)
      ?? trace.channels.find((c) => /liz|rox|orange/i.test(c.dye))
      ?? trace.channels[trace.channels.length - 1];
    let sizing: Sizing;
    let usedStd = stdName;
    try {
      const exclude = saturatedScans(trace, ladder.dye);
      if (stdName === 'auto') { const a = autoSizeStandard(ladder.data, num(v.ladderHeight ?? 100), exclude, ladder.dye); sizing = a.sizing; usedStd = a.name; }
      else sizing = sizeStandard(ladder.data, sizes, num(v.ladderHeight ?? 100), exclude);
    } catch (e) { problems.push(`${d.name}: ${e instanceof Error ? e.message : String(e)}`); continue; }
    const warn = sizingWarning(sizing);
    if (warn) problems.push(`${d.name}: ${warn}`);
    sizedRuns.push({ d, trace, ladder, sizing, usedStd, warn });
  }
  // allelic ladder: runs named like the ladder option ("ladder" by default), when the panel has ladder alleles
  const ladderOpt = String(v.allelicLadder ?? 'auto');
  const hasLadderAlleles = markers.some((m) => m.ladder?.length);
  const ladderRuns = !hasLadderAlleles || ladderOpt === 'none' ? [] : sizedRuns.filter((r) => (ladderOpt === 'auto' ? /ladder/i.test(r.d.name) : r.d.id === ladderOpt || r.d.name === ladderOpt));
  // kit channels are numbered over the whole run (`#n`), so keep the size-standard channel then
  const numbered = markers.some((m) => /^#?\d+$/.test(m.dye.trim()));
  const analysisTrace = (tr: FragmentTrace, lad: FragmentTrace['channels'][number]) => (numbered ? tr : { ...tr, channels: tr.channels.filter((c) => c !== lad) });
  let bins: LadderBins | undefined;
  if (ladderRuns.length) {
    const cals = ladderRuns.map((r) => {
      const c = calibrateLadder(analysisTrace(r.trace, r.ladder), r.sizing, markers, o.minHeight);
      problems.push(...c.problems.map((x) => `${r.d.name} (allelic ladder): ${x}`));
      return c.bins;
    });
    bins = averageBins(cals);
  } else if (hasLadderAlleles && ladderOpt !== 'none') {
    problems.push('The panel has ladder alleles but no allelic-ladder run was found (a run with "ladder" in its name): alleles are reported in bp only.');
  }
  for (const { d, trace, ladder, sizing, usedStd, warn } of sizedRuns) {
    const calls = markers.length ? callAlleles(analysisTrace(trace, ladder), sizing, markers, o, bins) : [];
    table.push([d.name, `${sizing.matched}/${sizing.expected}${stdName === 'auto' ? ` ${usedStd}` : ''}`, ...calls.map((c) => (c.alleles.length ? c.alleles.map((a) => a.name ?? a.size.toFixed(1)).join('/') : '—'))]);
    const quality = sizing.matched < sizing.expected ? ` (${sizing.expected - sizing.matched} standard peak${sizing.expected - sizing.matched === 1 ? '' : 's'} not found)` : '';
    const notes = [
      `# ${d.name}`, '', `Sized with ${usedStd === 'custom' ? 'a custom standard' : usedStd}${stdName === 'auto' ? ' (chosen automatically)' : ''} in ${ladder.dye}: ${sizing.matched} of ${sizing.expected} standard peaks matched${quality}; linear-fit R² ${sizing.rSquared.toFixed(4)}.${warn ? ` Warning: ${warn}.` : ''}`,
      ...(calls.length ? ['', [...['Marker', 'Dye'], ...(bins ? ['Alleles'] : []), 'Sizes (bp)', 'Heights (RFU)', 'Note'].join('\t'), ...calls.map((c) => [c.marker, c.dye, ...(bins ? [c.alleles.map((a) => a.name ?? '?').join(' / ') || '—'] : []), c.alleles.map((a) => a.size.toFixed(2)).join(' / ') || '—', c.alleles.map((a) => Math.round(a.height)).join(' / ') || '—', c.note].join('\t'))] : ['', 'No marker panel given: the electropherogram above is sized in base pairs.']),
    ];
    updated.push({
      ...d,
      docMetadata: { ...d.docMetadata, Notes: notes.join('\n') + '\n', [FRAGMENT_SIZING_KEY]: JSON.stringify({ standard: usedStd, dye: ladder.dye, ...sizing }), [ALLELE_CALLS_KEY]: JSON.stringify(calls), 'Size standard': usedStd },
      updatedAt: t,
      history: [...d.history, { id: uid('hist'), timestamp: t, operation: 'Microsatellite Analysis', description: `${sizing.matched}/${sizing.expected} standards; ${calls.filter((c) => c.alleles.length).length} of ${calls.length} markers called`, parentIds: [d.id], lengthBp: 0, topology: 'linear' }],
    });
  }
  if (!updated.length) throw new Error(problems.join(' '));
  const header = ['Sample', 'Standards', ...markers.map((m) => m.name)];
  const report: SequenceDocument = {
    id: uid('msat'), name: String(v.resultName ?? '').trim() || `Genotypes (${updated.length} sample${updated.length === 1 ? '' : 's'})`, accession: '',
    description: `Microsatellite genotypes: ${markers.length} markers × ${updated.length} samples`, moleculeType: 'DNA', topology: 'linear', sequence: '', features: [], primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: [`# Microsatellite genotypes`, '', `Size standard: ${stdName}; ${bins ? `alleles named from the allelic ladder (${ladderRuns.map((r) => r.d.name).join(', ')}), ±0.5 bp bins, OL = off-ladder; ` : ''}peaks ≥ ${o.minHeight} RFU; stutter < ${o.stutterPct}% one repeat below a taller peak removed; second allele ≥ ${o.balancePct}% of the first.`, '', header.join('\t'), ...table.map((r) => r.join('\t')), ...(problems.length ? ['', 'Problems:', ...problems.map((x) => `- ${x}`)] : [])].join('\n') + '\n' },
    history: [{ id: uid('hist'), timestamp: t, operation: 'Microsatellite Analysis', description: `${updated.length} samples`, parentIds: updated.map((u) => u.id), lengthBp: 0, topology: 'linear' }],
    createdAt: t, updatedAt: t, folder: folderOf(ctx.folder ?? updated[0].folder, 'Sequencing Reads (Sanger/NGS)' as SequenceDocument['folder']),
  };
  return { created: [report], updated, summary: `Sized ${updated.length} run${updated.length === 1 ? '' : 's'}${markers.length ? `, called ${markers.length} markers` : ''}${problems.length ? `; ${problems.length} problem${problems.length === 1 ? '' : 's'} noted in the report` : ''}` };
}

// ───────────────────────────── structure alignment ─────────────────────────────

export const STRUCTURE_ALIGNMENT_OPERATION = 'Align Structures';

/** The entry a structure document's file names, else the document's name without its chain suffix. */
export const structureEntryOf = (doc: SequenceDocument): string =>
  structureEntryId(structureTextOf(doc), doc.name.replace(/\s+chain\s+\S+$/i, '') || doc.name);

/** The chain a structure document is (its `Chain`), or '' for its structure's first chain. */
export const structureChainOf = (doc: SequenceDocument): string => String(doc.docMetadata?.Chain ?? '').trim();

/**
 * Align Structures: aligns a chain of document A's structure with a chain of document B's
 * (`chainA` / `chainB`; blank for each document's own chain) by `method` (`tm` or `sequence`),
 * and creates the structure-based sequence alignment as an alignment document that carries the
 * scores and the matrix. Throws, naming the chain and the reason, when a chain cannot be aligned
 * or the method is not one of the two.
 */
export function runStructureAlignment(a: SequenceDocument, b: SequenceDocument, v: OptionValues, ctx: RunContext): OperationResult & { alignment: StructureAlignment } {
  const method = structureAlignmentMethodOf(v.method);
  const input = (d: SequenceDocument, chain: OptionValues[string] | undefined) => ({
    text: structureTextOf(d),
    chain: String(chain ?? '').trim() || structureChainOf(d),
    entry: structureEntryOf(d),
  });
  const al = alignStructures(input(a, v.chainA), input(b, v.chainB), method);
  const identityPct = Math.round(al.sequenceIdentity * 1000) / 10;
  const scores = al.tmScores.map((s) => `${s.name} ${s.value.toFixed(3)}`).join(', ');
  const name = String(v.resultName ?? '').trim() || `${recordName(al.a)} vs ${recordName(al.b)} structure alignment`;
  const description = `Structure alignment of ${recordName(al.a)} and ${recordName(al.b)}: ${al.methodDescription}`;
  const doc = newAlignmentDoc(a, name,
    [{ name: recordName(al.a), sequence: al.alignedSequenceA, accession: a.accession }, { name: recordName(al.b), sequence: al.alignedSequenceB, accession: b.accession }],
    STRUCTURE_ALIGNMENT_OPERATION, description, [a.id, b.id], ctx.folder, {
      'Structure alignment method': al.methodDescription,
      'RMSD (Å)': al.rmsdAngstrom,
      'Equivalent residues': al.equivalentResidues,
      'Sequence identity (%)': identityPct,
      ...Object.fromEntries(al.tmScores.map((s) => [s.name, s.value])),
      'Transformation matrix (B onto A)': structureAlignmentMatrixJson(al),
    });
  return {
    created: [doc],
    updated: [],
    summary: `${recordName(al.a)} vs ${recordName(al.b)}: RMSD ${al.rmsdAngstrom.toFixed(2)} Å, ${scores}, identity ${identityPct}%, ${al.equivalentResidues} equivalent residues`,
    alignment: al,
  };
}
