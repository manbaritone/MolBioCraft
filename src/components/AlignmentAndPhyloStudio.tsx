// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import { captureSvg, setFigureFileDrawing } from '../core/figureCapture';
import {
  alignmentImageColorSchemeFor,
  setAlignmentImageColorScheme,
  subscribeAlignmentImageColorScheme,
} from '../core/alignmentImage';
import {
  BarChart2,
  Check,
  Columns4,
  Copy,
  Download,
  Eye,
  EyeOff,
  Grid3x3,
  Puzzle,
  Ruler,
  Scissors,
  Settings,
  Sigma,
  Sliders,
  Sparkles,
  TableProperties,
  Tag,
  Wrench,
  Zap,
} from 'lucide-react';
import { SequenceDocument, SequenceFeature } from '../types/bio';
import { MolBioMenuGlyph, MolBioMenuGlyphKind } from './MolBioIcons';
import { FigureExportButton } from './FigureExportButton';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import {
  alignPairwiseTypeScript,
  runMultipleSequenceAlignment,
} from '../core/bioEngine';
import { isPreAlignedInputSet } from '../core/documentViews';
import { codingAlignmentRefusal } from '../core/evolutionAnalyses';
import {
  alignPairwiseBandedSparseRust,
  layoutNewickPhylogeneticTreeRust,
} from '../lib/rustBioEngine';
import {
  analyzeUserTree,
  computeEvolutionaryDistances,
  computeNucleotideCompositionByCodonPos,
  computePopulationDiversity,
  computeRelativeSynonymousCodonUsage,
  computeSubstitutionRateMatrix,
  constructPhylogeneticTree,
  diagnoseMissenseMutation,
  wildTypeMatchesSequenceOne,
  estimateGammaAndSiteRates,
  exploreActiveAlignmentData,
  findBestSubstitutionModels,
  ClockMethod,
  fmtP,
  fmtStat,
  inferAncestralSequences,
  ModelSelectionRankingRow,
  PhyloTreeAlgorithm,
  runMolecularClockAndTimetree,
  runSelectionAndNeutralityTests,
  SubstitutionModelName,
  type PhyloTreeInferenceReport,
} from '../core/phyloEvoEngine';
import {
  cachedExternalTree,
  detectExternalTreePrograms,
  EXTERNAL_TREE_ALGORITHMS,
  EXTERNAL_TREE_NAMES,
  externalTreeCacheKey,
  isExternalTreeAlgorithm,
  runExternalTree,
  type ExternalProgramStatus,
  type ExternalTreeResult,
} from '../core/externalTreePrograms';
import {
  AlignmentCanvas,
  AlignmentCanvasRow,
  AlignmentCanvasSettings,
  DEFAULT_NAME_COLUMN_WIDTH_PX,
} from './AlignmentCanvas';
import { AlignmentDotplot } from './AlignmentDotplot';
import { AlignmentTraceViewer, ReadQcReport, TraceEntry } from './AlignmentReadViews';
import { InspectorSection, useInWorkbench, useOwnInspector } from './WorkbenchInspector';
import {
  AlignmentColorScheme,
  colorSchemesFor,
  countDifferences,
  defaultColorScheme,
  findDisagreement,
  findRestrictionSitesAligned,
  GENETIC_CODE_NAMES,
  findOrfsInSequence,
  isSchemeValidFor,
  meanNucleotideMolecularWeightKda,
  meanPairwiseIdentity,
  pairwiseIdentitySampling,
  summariseProteins,
  threeLetterCode,
  translateCodon,
  normaliseGeneticCodeName,
  transferAnnotations,
  residueSolidColor,
  reverseComplementAligned,
  visibleColumns,
  maskTrimmedReadRegions,
  contigFolderShowsSingleRead,
  effectiveTextViewFormat,
  formatPairwiseIdentityPct,
  parseRootCalibrationMya,
  resolveMsaMenuCommand,
  type MsaMenuCommandToken,
  isNucleotideAlignmentRows,
} from '../core/alignmentViewModel';
import { computeAlignmentConsensusAndIdentity, computeNonEndGapPairwiseMetric } from '../core/alignmentAnalysis';
import { alignmentInputError, runValidatedAlignment } from '../core/alignmentExecution';
import { formatAlignmentText } from '../core/alignmentExport';
import { PairwiseAlignmentView } from './PairwiseAlignmentView';
import { ResultWarnings } from './ResultWarnings';
import { exportToGenBank } from '../core/fileParsers';
import { groupOf, normalizeMsaPresetId } from '../core/operationRunners';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';

export type AlignmentSubMode = 'msa' | 'pairwise' | 'dotplot';

export type StudioMsaPresetId =
  | 'consistency-nj'
  | 'progressive-upgma'
  | 'consistency-upgma'
  | 'graph-backbone';

export type LegacyMsaAlgorithmOption =
  | 'MAFFT (FFT-NS-i / L-INS-i)'
  | 'Clustal Omega (HMM)'
  | 'MUSCLE (Iterative)'
  | 'POA (rust-bio Partial-Order Graph)';

export type MsaAlgorithmOption = StudioMsaPresetId | LegacyMsaAlgorithmOption;

const toStudioMsaPresetId = (v: unknown): StudioMsaPresetId =>
  (normalizeMsaPresetId(v) || 'consistency-nj') as StudioMsaPresetId;

/** Honest description of each built-in MSA preset (see `run_multiple_sequence_alignment_with_algorithm`). */
export const MSA_PRESET_INFO: Record<StudioMsaPresetId, { label: string; detail: string }> = {
  'consistency-nj': {
    label: 'MAFFT-style · consistency (L-INS-i-like)',
    detail: 'Every pair aligned, a consistency library built from them (as L-INS-i / T-Coffee), progressive profile alignment on that library and 2 tree-dependent refinement passes. On 26 Pfam seed families it matches MAFFT (mean Q 0.89).',
  },
  'consistency-upgma': {
    label: 'MUSCLE-style · consistency + refinement',
    detail: 'The consistency route of MUSCLE 5 with 3 tree-dependent refinement passes kept only when the objective improves; UPGMA guide tree.',
  },
  'progressive-upgma': {
    label: 'Clustal-style · profile progressive',
    detail: 'Profile–profile progressive alignment (BLOSUM62, affine gaps, Henikoff weights) up a UPGMA guide tree, rebuilt from the first alignment, with 2 refinement passes.',
  },
  'graph-backbone': {
    label: 'POA · graph backbone + NJ',
    detail: 'rust-bio partial-order graph consensus used as the alignment backbone (falls back to center-star if it scores worse); Neighbor-Joining guide tree.',
  },
};

/**
 * The seven amino-acid groups reported in the Statistics panel, each taken from a published table:
 * - Acidic {D, E} and Basic {H, K, R}: the IMGT charge classes 'negative' and 'positive'
 *   (Pommié C. et al., J. Mol. Recognit. 2004, 17:17-32); Charged is their union.
 * - Polar Uncharged {N, Q, S, T, Y}: the IMGT polarity class 'polar' (R N D Q E H K S T Y) less
 *   the charged residues.
 * - Hydrophobic {A, C, F, I, L, M, V, W}: the IMGT hydropathy class 'hydrophobic'.
 * - GC-rich {A, G, P, R} and AT-rich {F, I, K, M, N, Y}: GARP and FYMINK, the residues encoded by
 *   GC-rich and AT-rich codons (Singer G.A.C. and Hickey D.A., Mol. Biol. Evol. 2000,
 *   17(11):1581).
 * The groups overlap (Charged contains Acidic and Basic; a residue can be both hydrophobic and in
 * GARP or FYMINK), so their totals do not sum to the residue count.
 */
export const AA_GROUP_DEFINITIONS: readonly { label: string; chars: string[] }[] = [
  { label: 'Acidic', chars: ['D', 'E'] },
  { label: 'Basic', chars: ['H', 'K', 'R'] },
  { label: 'Charged', chars: ['D', 'E', 'H', 'K', 'R'] },
  { label: 'Polar Uncharged', chars: ['N', 'Q', 'S', 'T', 'Y'] },
  { label: 'Hydrophobic', chars: ['A', 'C', 'F', 'I', 'L', 'M', 'V', 'W'] },
  { label: 'GC-rich', chars: ['A', 'G', 'P', 'R'] },
  { label: 'AT-rich', chars: ['F', 'I', 'K', 'M', 'N', 'Y'] },
];

/**
 * Annotation track names are shown capitalised ("Source (7)", not "source (7)") even though the
 * underlying GenBank feature keys are lower-case; acronyms such as CDS keep their own casing.
 */
export function formatAnnotationTypeLabel(type: string): string {
  if (!type) return type;
  if (type !== type.toLowerCase()) return type;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The tree card heading: the topology method the report's method note says was computed. It is
 * never the dropdown label, because the ML and MP options score the Neighbor-Joining tree and the
 * ME option stops at its start tree. A note that opens with an external program's run, "<program>
 * (<version>) ran on this computer in <t> s: <model> <what>.", names the program and the model it
 * ran. That is read from the whole note, because the version is the program's own banner, which
 * can hold full stops ("RAxML-NG v. 2.0.4 …") and one level of parentheses ("Double precision
 * (No SSE3)"). A built-in tree is read from the note's first sentence. A note naming no tree
 * method, or a banner nested deeper than one level, gets "Phylogenetic tree", which claims none.
 */
export function treeMethodHeading(methodNote: string): string {
  const external = /^(\S+)(?: \((?:[^()]|\([^()]*\))*\))? ran on this computer in [\d.]+ s: (\S+) (.+?)\.(?:\s|$)/.exec(methodNote);
  const first = methodNote.split(/\.\s/)[0];
  if (external) {
    const [, program, model, what] = external;
    const kind = /^approximately-maximum-likelihood\b/.test(what)
      ? 'Approximately-maximum-likelihood tree'
      : /^maximum-likelihood\b/.test(what)
      ? 'Maximum-likelihood tree'
      : /majority-rule consensus of .* MCMC generations/.test(what)
      ? 'Bayesian consensus tree'
      : null;
    return kind ? `${kind} (${program}, ${model})` : 'Phylogenetic tree';
  }
  if (/\bthe topology is Neighbor-Joining\b/.test(first)) return 'Neighbor-Joining tree';
  if (/^UPGMA\b/.test(first)) return 'UPGMA tree';
  if (/\(the starting tree of an ME search\)/.test(first)) return 'Neighbor-Joining start tree (no ME search)';
  if (/\bNeighbor-Joining\b/.test(first)) return 'Neighbor-Joining tree';
  return 'Phylogenetic tree';
}

export type PairwiseAlgorithmOption = 'nw' | 'sw' | 'banded-nw' | 'banded-sw';

export type PhyloModuleTab =
  | 'phylogeny'
  | 'usertree'
  | 'ancestors'
  | 'models'
  | 'data'
  | 'distance'
  | 'diversity'
  | 'selection'
  | 'rates'
  | 'clocks'
  | 'diagnose';

export type ModelsSubViewId =
  | 'best-models'
  | 'rate-matrix'
  | 'disparity'
  | 'composition'
  | 'rscu';

export type AncestralInferenceMethod =
  | 'Maximum Likelihood (Empirical Bayes)'
  | 'Maximum Parsimony (Fitch)';

/** The analyses of an alignment, opened as panels from the inspector rail beside the grid. */
export type AlignmentAnalysisPanel =
  | 'member-annotations'
  | 'distances'
  | 'lengths-graph'
  | 'virtual-gel'
  | 'fragments';

export type AlignmentInspectorTab =
  | 'general'
  | 'display'
  | 'graphs'
  | 'annotations-tracks'
  | 'live-annotate'
  | 'restriction'
  | 'advanced'
  | 'statistics'
  | AlignmentAnalysisPanel;

const ANALYSIS_PANELS: readonly AlignmentInspectorTab[] = [
  'member-annotations', 'distances', 'lengths-graph', 'virtual-gel', 'fragments',
];

/** What the MSA mode draws: the grid, or (contig, trace and read documents) the traces or the read QC. */
type AlignmentMsaFigure = 'grid' | 'chromatogram' | 'qc-report';

export type GelStainPreset = 'etbr' | 'silver' | 'sybr' | 'gelred' | 'inverted';

export interface GelStainConfig {
  id: GelStainPreset;
  name: string;
  shortName: string;
  isDark: boolean;
  filterId: string;
  gelBg: string;
  gelBorder: string;
  ambientGlow: string;
  laneTrack: string;
  wellCavity: string;
  wellRim: string;
  wellStroke: string;
  wellText: string;
  ladderText: string;
  bandCore: string;
  bandBody: string;
  bandGlow: string;
  dyeFront: string;
  crosshairColor: string;
  tooltipBg: string;
  tooltipText: string;
}

export const VIRTUAL_GEL_STAINS: GelStainConfig[] = [
  {
    id: 'etbr',
    name: 'Ethidium Bromide (UV Amber)',
    shortName: 'EtBr Amber',
    isDark: true,
    filterId: 'gel-glow-etbr',
    gelBg: '#08060f',
    gelBorder: 'rgba(249, 115, 22, 0.45)',
    ambientGlow:
      'radial-gradient(ellipse at 50% 45%, rgba(249, 115, 22, 0.1) 0%, rgba(139, 92, 246, 0.04) 50%, transparent 80%)',
    laneTrack: 'rgba(249, 115, 22, 0.035)',
    wellCavity: '#030206',
    wellRim: '#351c2f',
    wellStroke: 'rgba(249, 115, 22, 0.45)',
    wellText: '#fdba74',
    ladderText: '#fed7aa',
    bandCore: '#fff7ed',
    bandBody: '#ff8c38',
    bandGlow: '#ea580c',
    dyeFront: '#4338ca',
    crosshairColor: '#fb923c',
    tooltipBg: '#1e112a',
    tooltipText: '#ffedd5',
  },
  {
    id: 'silver',
    name: 'UV Gel Doc (Fluorescent Silver)',
    shortName: 'UV GelDoc',
    isDark: true,
    filterId: 'gel-glow-silver',
    gelBg: '#060814',
    gelBorder: 'rgba(148, 163, 184, 0.4)',
    ambientGlow:
      'radial-gradient(ellipse at 50% 45%, rgba(148, 163, 184, 0.1) 0%, rgba(59, 130, 246, 0.05) 50%, transparent 80%)',
    laneTrack: 'rgba(255, 255, 255, 0.035)',
    wellCavity: '#020409',
    wellRim: '#1e293b',
    wellStroke: 'rgba(148, 163, 184, 0.45)',
    wellText: '#f1f5f9',
    ladderText: '#cbd5e1',
    bandCore: '#ffffff',
    bandBody: '#e2e8f0',
    bandGlow: '#818cf8',
    dyeFront: '#3b82f6',
    crosshairColor: '#60a5fa',
    tooltipBg: '#0f172a',
    tooltipText: '#f8fafc',
  },
  {
    id: 'sybr',
    name: 'SYBR Safe / GelGreen',
    shortName: 'SYBR Green',
    isDark: true,
    filterId: 'gel-glow-sybr',
    gelBg: '#030a06',
    gelBorder: 'rgba(34, 197, 94, 0.45)',
    ambientGlow:
      'radial-gradient(ellipse at 50% 45%, rgba(34, 197, 94, 0.1) 0%, transparent 75%)',
    laneTrack: 'rgba(34, 197, 94, 0.035)',
    wellCavity: '#010603',
    wellRim: '#143521',
    wellStroke: 'rgba(34, 197, 94, 0.45)',
    wellText: '#86efac',
    ladderText: '#bbf7d0',
    bandCore: '#f0fdf4',
    bandBody: '#34d399',
    bandGlow: '#10b981',
    dyeFront: '#0891b2',
    crosshairColor: '#4ade80',
    tooltipBg: '#062817',
    tooltipText: '#dcfce7',
  },
  {
    id: 'gelred',
    name: 'GelRed (Radiant Coral Red)',
    shortName: 'GelRed Coral',
    isDark: true,
    filterId: 'gel-glow-gelred',
    gelBg: '#0a0408',
    gelBorder: 'rgba(244, 63, 94, 0.45)',
    ambientGlow:
      'radial-gradient(ellipse at 50% 45%, rgba(244, 63, 94, 0.1) 0%, transparent 75%)',
    laneTrack: 'rgba(244, 63, 94, 0.035)',
    wellCavity: '#050204',
    wellRim: '#3b1422',
    wellStroke: 'rgba(244, 63, 94, 0.45)',
    wellText: '#fda4af',
    ladderText: '#fecdd3',
    bandCore: '#fff1f2',
    bandBody: '#fb7185',
    bandGlow: '#e11d48',
    dyeFront: '#7c3aed',
    crosshairColor: '#f43f5e',
    tooltipBg: '#290a16',
    tooltipText: '#ffe4e6',
  },
  {
    id: 'inverted',
    name: 'Publication Print (Inverted B&W)',
    shortName: 'Print B&W',
    isDark: false,
    filterId: 'gel-glow-none',
    gelBg: '#ffffff',
    gelBorder: '#cbd5e1',
    ambientGlow: 'none',
    laneTrack: 'rgba(0, 0, 0, 0.015)',
    wellCavity: '#f1f5f9',
    wellRim: '#cbd5e1',
    wellStroke: '#94a3b8',
    wellText: '#0f172a',
    ladderText: '#334155',
    bandCore: '#0f172a',
    bandBody: '#1e293b',
    bandGlow: '#0f172a',
    dyeFront: '#94a3b8',
    crosshairColor: '#0284c7',
    tooltipBg: '#ffffff',
    tooltipText: '#0f172a',
  },
];

export type { AlignmentColorScheme } from '../core/alignmentViewModel';

export interface SequenceAlignmentStudioProps {
  documents: SequenceDocument[];
  projectDocuments?: SequenceDocument[];
  activeDoc: SequenceDocument;
  initialSubMode?: AlignmentSubMode;
  /** The inspector panel shown first: a settings tab or one of the analyses. */
  initialInspectorTab?: AlignmentInspectorTab;
  /**
   * @deprecated The analyses moved from a tab bar above the grid into the inspector
   * (US-01M6Q177); use `initialInspectorTab`. Still opens the analysis it names.
   */
  initialPrimaryTab?: AlignmentAnalysisPanel;
  initialMsaAlgorithm?: MsaAlgorithmOption;
  initialPairwiseAlgorithm?: PairwiseAlgorithmOption;
  commandNonce?: number;
  onGenerateConsensus?: (displayedConsensus?: string) => void;
  onUpdateDocument?: (doc: SequenceDocument) => void;
}

export interface PhylogeneticsStudioProps {
  documents: SequenceDocument[];
  activeDoc: SequenceDocument;
  initialPhyloTab?: PhyloModuleTab;
  initialTreeAlgorithm?: PhyloTreeAlgorithm;
  initialModelsSubView?: ModelsSubViewId;
  initialAncestralMethod?: AncestralInferenceMethod;
  commandNonce?: number;
}

// Alignment-menu MSA commands (preset + nonce) consumed so far; module-level so a remount of the
// studio on another document with the same nonce does not re-run the command.
let consumedMsaMenuCommand: MsaMenuCommandToken | null = null;

/**
 * The most rows a per-site or per-codon table of the phylogenetics studio draws. Each row is a DOM
 * row and these tables have one per alignment column or variable codon (a chloroplast-genome
 * alignment has over 100,000 columns), so a longer list is drawn from its start and `rowsLeftOut`
 * states how many rows it has.
 */
const PHYLO_TABLE_ROWS_SHOWN = 10_000;

/** The most consensus restriction sites the Restriction Analysis inspector lists, by column. */
const CONSENSUS_SITES_LISTED = 200;

/**
 * The ResultWarnings sentence for a list that shows fewer rows than the engine's total for it
 * ("The table lists the first 10,000 of 150,000 sites."), one that says the engine sent no total,
 * or none when every row is shown.
 */
function rowsLeftOut(shown: number, total: number | undefined, noun: string, where: string): string[] {
  const n = (v: number) => v.toLocaleString('en-US');
  if (typeof total !== 'number' || !Number.isFinite(total)) return [`${where} ${n(shown)} ${noun}; the engine did not report how many there are.`];
  return shown < total ? [`${where} the first ${n(shown)} of ${n(total)} ${noun}.`] : [];
}

const PHYLO_MODULE_META: Record<
  PhyloModuleTab,
  { title: string; category: string; badge: string; glyph: MolBioMenuGlyphKind }
> = {
  phylogeny: {
    title: 'Phylogenetic Tree Reconstruction',
    category: 'Tree Reconstruction & Topologies',
    badge: 'NJ • UPGMA • Bootstrap • Parsimony & likelihood scores',
    glyph: 'tree-cladogram',
  },
  usertree: {
    title: 'User Tree Topology & Gene Duplication Analysis',
    category: 'Tree Reconstruction & Topologies',
    badge: 'Likelihood • Parsimony • OLS fit',
    glyph: 'tree-bayesian',
  },
  ancestors: {
    title: 'Ancestral Sequence Reconstruction',
    category: 'Tree Reconstruction & Topologies',
    badge: 'Marginal ML (TN93+G) • Fitch Parsimony',
    glyph: 'ancestors',
  },
  models: {
    title: 'Substitution Models, Rate Matrices & Codon Usage (RSCU)',
    category: 'Substitution Models, Codons & Data',
    badge: 'ML model test (BIC / AICc) • Ti/Tv • Disparity • RSCU',
    glyph: 'subst-models',
  },
  data: {
    title: 'Alignment Data Explorer & Taxa Groups',
    category: 'Substitution Models, Codons & Data',
    badge: 'Conserved / Variable / Pi Sites • Degeneracy',
    glyph: 'codon-rscu',
  },
  distance: {
    title: 'Pairwise, Within-Group & Net Evolutionary Distances',
    category: 'Evolutionary Distances & Diversity',
    badge: 'p-distance • JC69 • K2P • T92 • TN93',
    glyph: 'evo-distance',
  },
  diversity: {
    title: 'Subpopulation & Interpopulation Nucleotide Diversity',
    category: 'Evolutionary Distances & Diversity',
    badge: 'πS • πT • δST • Nst / Gst • Haplotype Hd',
    glyph: 'evo-distance',
  },
  selection: {
    title: "Codon Selection (dN/dS Z-Test) & Tajima's Neutrality Test",
    category: 'Selection, Site Rates & Molecular Clocks',
    badge: "Nei-Gojobori ω • Z / Fisher tests • Tajima's D",
    glyph: 'selection-dnds',
  },
  rates: {
    title: 'Discrete Gamma Distribution & Site-by-Site Evolutionary Rates',
    category: 'Selection, Site Rates & Molecular Clocks',
    badge: 'ML Gamma Shape α • Empirical-Bayes Site Rates',
    glyph: 'subst-models',
  },
  clocks: {
    title: 'Strict-Clock Timetree, Molecular Clock LRT & Relative Rate Test',
    category: 'Selection, Site Rates & Molecular Clocks',
    badge: 'ML clock LRT • Strict-clock ages • Tajima RRT',
    glyph: 'molecular-clock',
  },
  diagnose: {
    title: 'Missense Variant Functional & Evolutionary Impact Diagnosis',
    category: 'Selection, Site Rates & Molecular Clocks',
    badge: 'Grantham • BLOSUM62 • Homolog frequency',
    glyph: 'variants-snp',
  },
};

/** The alignment ruler's numbers: their default size, and the smallest the Advanced inspector offers. */
const RULER_NUMBER_FONT_FLOOR_PX = 11;

/**
 * The virtual gel's drawing in its own units (US-01M6S7ZF): one view, wider than tall, that holds
 * the gel and, beside it, its electrode marks and lane key. The view never changes, so the figure
 * keeps its aspect at any panel width and its height follows the width it is drawn at.
 */
const VIRTUAL_GEL_VIEW_WIDTH = 480;
const VIRTUAL_GEL_VIEW_HEIGHT = 340;
/** The gel's label size, in gel units, where the gel is drawn at full size or larger. */
const VIRTUAL_GEL_LABEL_UNITS = 10;
/** The smallest size, in screen pixels, at which the gel draws a label: the 11px text floor. */
const VIRTUAL_GEL_LABEL_FLOOR_PX = 11;
/** A size in gel units, written to two decimals and rounded up, so rounding never takes it below the floor. */
const virtualGelUnits = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
/** A position in gel units, written to two decimals. */
const gelAt = (n: number) => Math.round(n * 100) / 100;
/**
 * Generous widths of one character, in label sizes, used to keep labels apart: proportional text
 * (with room for wide letters), and the monospaced ladder sizes. A name is fitted to the key with
 * the narrower average width of the proportional face.
 */
const GEL_CHAR_EM = 0.7;
const GEL_MONO_CHAR_EM = 0.75;
const GEL_KEY_CHAR_EM = 0.62;

/** The lengths chart's height in screen pixels; it is drawn one unit to a pixel at its panel's width. */
const LENGTHS_CHART_HEIGHT = 240;
/** The lengths chart's width before it is measured (a render with no layout), and when it is not fitted to the window. */
const LENGTHS_CHART_DEFAULT_WIDTH = 480;
const LENGTHS_CHART_FIXED_WIDTH = 720;
/** The lengths chart's text: the 11px floor, as Caption type. */
const LENGTHS_CHART_FONT_PX = 11;
/** An average character width of the chart's text, in font sizes, for spacing its tick labels. */
const LENGTHS_CHART_CHAR_EM = 0.62;

// ─── US-01M6S7QS: the side panel and the name and identity column, resized by dragging ───

/** Where the two widths are kept across restarts, as the workspace layout keeps its panes. */
const ALIGNMENT_PANE_WIDTHS_STORAGE_KEY = 'molbiocraft.alignment.paneWidths.v1';
/** A dragged side panel is 300 to 720px; at 300px the Virtual Gel still draws its labels at 11px or more (US-01M6S7ZF). */
const ALN_SIDE_PANEL_MIN_PX = 300;
const ALN_SIDE_PANEL_MAX_PX = 720;
/** A dragged side panel always leaves the alignment grid at least this wide. */
const ALN_GRID_MIN_PX = 360;
/** The side panel's settings-tab width (App.css), its width before the layout is measured. */
const ALN_SIDE_PANEL_SETTINGS_PX = 264;
/** The name and identity column: 160 to 480px, and always leaving the grid this much room for residues. */
const ALN_NAME_COLUMN_MIN_PX = 160;
const ALN_NAME_COLUMN_MAX_PX = 480;
const ALN_NAME_TRACK_MIN_PX = 120;
/** One arrow-key step of either handle, the workspace handles' step. */
const ALN_PANE_KEY_STEP_PX = 16;

interface AlignmentPaneWidths {
  /** The side panel's dragged width; null until it is dragged, while the panel keeps its responsive width. */
  sidePanelPx: number | null;
  nameColumnPx: number;
}
const DEFAULT_ALIGNMENT_PANE_WIDTHS: AlignmentPaneWidths = {
  sidePanelPx: null,
  nameColumnPx: DEFAULT_NAME_COLUMN_WIDTH_PX,
};

/** A kept width: a number within its bounds, or null for a value that is missing, unreadable or out of bounds. */
function keptPaneWidth(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null;
}

/** The widths kept by the last run; each missing, unreadable or out-of-bounds value falls back to its default. */
function loadAlignmentPaneWidths(): AlignmentPaneWidths {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_ALIGNMENT_PANE_WIDTHS;
    const raw = localStorage.getItem(ALIGNMENT_PANE_WIDTHS_STORAGE_KEY);
    if (!raw) return DEFAULT_ALIGNMENT_PANE_WIDTHS;
    const parsed: unknown = JSON.parse(raw);
    const kept = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    return {
      sidePanelPx: keptPaneWidth(kept.sidePanelPx, ALN_SIDE_PANEL_MIN_PX, ALN_SIDE_PANEL_MAX_PX),
      nameColumnPx:
        keptPaneWidth(kept.nameColumnPx, ALN_NAME_COLUMN_MIN_PX, ALN_NAME_COLUMN_MAX_PX) ?? DEFAULT_NAME_COLUMN_WIDTH_PX,
    };
  } catch {
    return DEFAULT_ALIGNMENT_PANE_WIDTHS;
  }
}

/** The widths as last set while the app is open, so a studio opened again keeps them where storage is blocked. */
let alignmentPaneWidthsThisSession: AlignmentPaneWidths | null = null;

function rememberedAlignmentPaneWidths(): AlignmentPaneWidths {
  alignmentPaneWidthsThisSession ??= loadAlignmentPaneWidths();
  return alignmentPaneWidthsThisSession;
}

function keepAlignmentPaneWidths(widths: AlignmentPaneWidths): void {
  alignmentPaneWidthsThisSession = widths;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ALIGNMENT_PANE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Storage is blocked (a sandboxed webview): the widths last while the app is open.
  }
}

/**
 * The width a handle moved from `startPx` to `rawPx` gives, within its bounds. A side panel still at
 * its responsive width under the drag floor is not widened by a move toward narrower: that gives
 * null, and the panel keeps its responsive width.
 */
function paneWidthAfterMove(startPx: number, rawPx: number, minPx: number, maxPx: number): number | null {
  if (startPx < minPx && rawPx <= startPx) return null;
  return Math.max(minPx, Math.min(maxPx, Math.round(rawPx)));
}

type AlignmentPaneHandle = 'side-panel' | 'name-column';

/** The smallest 1, 2 or 5 x 10^k step that is at least `min` (and at least `floor`). */
function niceStep(min: number, floor = 1): number {
  const target = Math.max(min, floor);
  let power = 10 ** Math.floor(Math.log10(target));
  for (;;) {
    for (const m of [1, 2, 5]) if (m * power >= target - 1e-9) return Math.max(floor, m * power);
    power *= 10;
  }
}

/**
 * The lengths histogram's bins: whole lengths from the shortest member to the longest, split into
 * `requested` bins as evenly as whole lengths allow (one length to a bin when there are fewer
 * lengths than bins), each counting the members whose lengths it holds.
 */
function lengthBins(lengths: number[], requested: number): { first: number; last: number; count: number }[] {
  if (lengths.length === 0) return [];
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  const span = longest - shortest + 1;
  const n = Math.max(1, Math.min(Math.round(requested), span));
  return Array.from({ length: n }, (_, i) => {
    const first = shortest + Math.floor((i * span) / n);
    const last = shortest + Math.floor(((i + 1) * span) / n) - 1;
    return { first, last, count: lengths.filter((v) => v >= first && v <= last).length };
  });
}

type AlignmentTextFormatChoice = 'Custom' | 'GenBank' | 'FASTA' | 'Clustal' | 'PHYLIP' | 'NEXUS';

/** How the grid's Consensus row is called: its threshold ('Majority', '0%' … '100%') and the gap vote. */
export interface AlignmentConsensusSettings {
  threshold: string;
  ignoreGaps: boolean;
}

export const DEFAULT_ALIGNMENT_CONSENSUS: AlignmentConsensusSettings = { threshold: 'Majority', ignoreGaps: true };

// Each document's consensus settings for the session: the one source the grid (whose Display
// inspector sets them) and the Flatfile tab's alignment text both read, so the two always agree.
// They outlive the studio, which unmounts when another view tab opens.
const consensusSettingsByDoc = new Map<string, AlignmentConsensusSettings>();
const consensusSettingsListeners = new Set<() => void>();
const subscribeConsensusSettings = (listener: () => void) => {
  consensusSettingsListeners.add(listener);
  return () => {
    consensusSettingsListeners.delete(listener);
  };
};

/** The consensus settings a document's grid and alignment text use: the defaults until changed. */
export function alignmentConsensusSettingsFor(docId: string): AlignmentConsensusSettings {
  return consensusSettingsByDoc.get(docId) ?? DEFAULT_ALIGNMENT_CONSENSUS;
}

export function setAlignmentConsensusSettings(docId: string, settings: AlignmentConsensusSettings): void {
  const current = alignmentConsensusSettingsFor(docId);
  if (current.threshold === settings.threshold && current.ignoreGaps === settings.ignoreGaps) return;
  consensusSettingsByDoc.set(docId, { threshold: settings.threshold, ignoreGaps: settings.ignoreGaps });
  consensusSettingsListeners.forEach((listener) => listener());
}

function useAlignmentConsensusSettings(docId: string): AlignmentConsensusSettings {
  const snapshot = () => alignmentConsensusSettingsFor(docId);
  return React.useSyncExternalStore(subscribeConsensusSettings, snapshot, snapshot);
}

/**
 * The colour scheme a document's grid is drawn in. It is kept per document outside the studio
 * (alignmentImage.ts), so Export › Alignment Image paints the scheme the grid shows rather than the
 * molecule type's default (BG-01M6XPX5).
 */
function useAlignmentColorScheme(doc: Pick<SequenceDocument, 'id' | 'moleculeType'>): AlignmentColorScheme {
  const snapshot = () => alignmentImageColorSchemeFor(doc);
  return React.useSyncExternalStore(subscribeAlignmentImageColorScheme, snapshot, snapshot);
}

/** The grid's name for its consensus row's threshold, beside the word Consensus. */
export const alignmentConsensusLabel = (threshold: string) => (threshold === 'Majority' ? 'majority' : threshold);

/** A contig assembly: its reads' quality-trimmed ends do not vote in the consensus. */
export function isContigAssemblyDocument(
  doc: Pick<SequenceDocument, 'id' | 'folder' | 'documentKind' | 'alignmentMeta'>
): boolean {
  return (
    doc.id === 'doc-contig-coi-assembly' ||
    (doc.folder === 'Contig Assembly' && doc.documentKind === 'contig' && doc.alignmentMeta?.isAligned !== false)
  );
}

/** A stored alignment's rows as the grid draws them: upper case, '.' read as a gap, padded to one length. */
function memberAlignmentRows(members: NonNullable<NonNullable<SequenceDocument['alignmentMeta']>['sequences']>) {
  const maxLen = Math.max(...members.map((m) => m.sequence.length), 1);
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    accession: m.accession ?? '',
    description: m.description ?? '',
    organism: m.organism ?? '',
    sequence: m.sequence.toUpperCase().replace(/\./g, '-').padEnd(maxLen, '-'),
    strand: m.strand ?? 1,
    features: m.features ?? [],
  }));
}

/**
 * The consensus the grid's Consensus row shows, and the identity statistics beside it: the rows
 * that vote (a contig's quality-trimmed read ends do not)
 * called under the document's consensus settings. The Flatfile tab's alignment text prints the
 * same consensus from here.
 */
export function alignmentGridConsensus<R extends { sequence: string; features: readonly SequenceFeature[] }>(
  doc: Pick<SequenceDocument, 'id' | 'folder' | 'documentKind' | 'alignmentMeta' | 'moleculeType'>,
  rows: R[],
  settings: AlignmentConsensusSettings
) {
  const votingRows = isContigAssemblyDocument(doc)
    ? rows.map((r) => {
        const masked = maskTrimmedReadRegions(r.sequence, r.features);
        return masked === r.sequence ? r : { ...r, sequence: masked };
      })
    : rows;
  return {
    votingRows,
    ...computeAlignmentConsensusAndIdentity(votingRows, settings.threshold, settings.ignoreGaps, doc.moleculeType === 'Protein'),
  };
}

export interface AlignmentTextStreamProps {
  /** An alignment, contig or sequence-list document: one that carries its member sequences. */
  doc: SequenceDocument;
}

/**
 * An alignment document's text: its members as Clustal, FASTA, PHYLIP, NEXUS, GenBank records, or
 * the interleaved blocks under the consensus. The Flatfile tab shows it for alignment documents.
 * An unaligned list has no alignment, so it offers FASTA of the original (unpadded) members and
 * GenBank only. The rows and the consensus are the grid's own: the same rows, called by the same
 * function under the threshold and gap settings the grid's Display inspector last set for this
 * document, and labelled as the grid labels its Consensus row.
 */
export const AlignmentTextStream: React.FC<AlignmentTextStreamProps> = ({ doc }) => {
  const [textViewFormat, setTextViewFormat] = useState<AlignmentTextFormatChoice>('Custom');
  const [copyFeedback, setCopyFeedback] = useState<string>('');
  const members = doc.alignmentMeta?.sequences ?? [];
  const isUnalignedSequenceList = members.length > 0 && doc.alignmentMeta?.isAligned === false;
  const consensusSettings = useAlignmentConsensusSettings(doc.id);

  const alignmentRows = useMemo(() => memberAlignmentRows(members), [members]);

  const dynamicConsensus = useMemo(
    () => alignmentGridConsensus(doc, alignmentRows, consensusSettings).consensus,
    [doc, alignmentRows, consensusSettings]
  );

  const shownTextViewFormat = effectiveTextViewFormat(textViewFormat, isUnalignedSequenceList);

  const formattedGenBankRecords = useMemo(() => {
    if (shownTextViewFormat !== 'GenBank') return [];
    return alignmentRows.map((r) => exportToGenBank({
      ...doc, id: r.id, name: r.name, accession: r.accession,
      description: r.description, sequence: r.sequence.replace(/-/g, ''),
      features: r.features, alignmentMeta: undefined, documentKind: undefined,
    }));
  }, [alignmentRows, doc, shownTextViewFormat]);

  // The interleaved layout: 60 columns per block, consensus first, running ungapped coordinates.
  const formattedTextViewBlocks = useMemo(() => {
    const colsPerBlock = 60;
    const totalCols = dynamicConsensus.length;
    const numBlocks = Math.max(1, Math.ceil(totalCols / colsPerBlock));
    const runningCoords = new Array(alignmentRows.length).fill(0);
    const blocks: {
      startCol: number;
      endCol: number;
      consSlice: string;
      rows: { idx: number; name: string; slice: string; endCoord: number }[];
    }[] = [];
    for (let b = 0; b < numBlocks; b++) {
      const startCol = b * colsPerBlock;
      const endCol = Math.min(totalCols, startCol + colsPerBlock);
      const consSlice = dynamicConsensus.slice(startCol, endCol);
      const blockRows = alignmentRows.map((r, rIdx) => {
        const slice = r.sequence.slice(startCol, endCol);
        let nonGapsInSlice = 0;
        for (let k = 0; k < slice.length; k++) {
          if (slice[k] !== '-') nonGapsInSlice++;
        }
        runningCoords[rIdx] += nonGapsInSlice;
        return { idx: rIdx + 1, name: r.name, slice, endCoord: runningCoords[rIdx] };
      });
      blocks.push({ startCol, endCol, consSlice, rows: blockRows });
    }
    return blocks;
  }, [dynamicConsensus, alignmentRows]);

  // An unaligned list has no alignment: alignment layouts are unavailable and FASTA carries the
  // original (unpadded) member sequences rather than padded rows posing as an alignment.
  const textExportRows = useMemo(() => {
    if (!isUnalignedSequenceList) return alignmentRows;
    return alignmentRows.map((r) => {
      const m = members.find((x) => x.id === r.id);
      return { ...r, sequence: m ? m.sequence : r.sequence.replace(/-+$/, '') };
    });
  }, [alignmentRows, isUnalignedSequenceList, members]);
  const formattedTextContent = useMemo(() => shownTextViewFormat === 'GenBank'
    ? formattedGenBankRecords.join('\n\n')
    : isUnalignedSequenceList
      // formatAlignmentText pads every row to a common length; an unaligned list must not be padded.
      ? textExportRows.map((r) => `>${r.name.replace(/[\r\n]/g, ' ')}\n${r.sequence.toUpperCase()}`).join('\n\n')
      : formatAlignmentText(textExportRows, shownTextViewFormat, doc.moleculeType, dynamicConsensus),
  [shownTextViewFormat, formattedGenBankRecords, textExportRows, doc.moleculeType, dynamicConsensus,
    isUnalignedSequenceList]);

  const handleExportTextView = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable; use Export instead.');
      await navigator.clipboard.writeText(formattedTextContent);
      setCopyFeedback(`Copied ${alignmentRows.length} sequences (${shownTextViewFormat})`);
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : 'Copy failed; use Export instead.');
    }
    setTimeout(() => setCopyFeedback(''), 2500);
  };
  const safeFileBase = doc.name.replace(/[^\w.-]+/g, '_');

  return (
    <div className="mbc-aln-text-stream">
      <div className="mbc-aln-action-toolbar">
        <div className="mbc-aln-toolbar-left">
          {/* US-01M6TAZ7: the text format is a setting, so in the workbench it is a section of App's
              inspector; Copy and Export stay here. Drawn on its own, it stays first in this toolbar. */}
          <InspectorSection title="Text Format" order={1}>
          <label className="mbc-aln-inline-select">
            <span>Format:</span>
            <select
              value={shownTextViewFormat}
              onChange={(e) => setTextViewFormat(e.target.value as AlignmentTextFormatChoice)}
            >
              <option value="Custom" disabled={isUnalignedSequenceList}>
                {isUnalignedSequenceList ? 'Custom (align first)' : 'Custom'}
              </option>
              <option value="GenBank">GenBank</option>
              <option value="FASTA">FASTA</option>
              <option value="Clustal" disabled={isUnalignedSequenceList}>
                {isUnalignedSequenceList ? 'Clustal (align first)' : 'Clustal'}
              </option>
              <option value="PHYLIP" disabled={isUnalignedSequenceList}>
                {isUnalignedSequenceList ? 'PHYLIP (align first)' : 'PHYLIP'}
              </option>
              <option value="NEXUS" disabled={isUnalignedSequenceList}>
                {isUnalignedSequenceList ? 'NEXUS (align first)' : 'NEXUS'}
              </option>
            </select>
          </label>
          </InspectorSection>
          <button
            type="button"
            className="mbc-aln-tool-btn"
            onClick={() =>
              setTextViewFormat((f) => (f === 'GenBank' ? (isUnalignedSequenceList ? 'FASTA' : 'Custom') : 'GenBank'))
            }
          >
            Display options
          </button>
          <button type="button" className="mbc-aln-tool-btn" onClick={handleExportTextView}>
            Copy full sequence
          </button>
          <button
            type="button"
            className="mbc-aln-tool-btn"
            onClick={() => saveWorkbenchFile(`${safeFileBase}_${shownTextViewFormat}.txt`, formattedTextContent, 'text/plain;charset=utf-8')}
          >
            Export as *.txt
          </button>
          {isUnalignedSequenceList && (
            <span className="mbc-aln-hint" style={{ marginLeft: 8 }}>
              Unaligned list: alignment formats need an alignment (align first); FASTA exports the original sequences.
            </span>
          )}
          {copyFeedback && (
            <span style={{ fontSize: 11, color: 'var(--mbc-green)', marginLeft: 8 }}>
              {copyFeedback}
            </span>
          )}
        </div>
      </div>

      <div className="mbc-aln-textview-scroll">
        {shownTextViewFormat !== 'Custom' ? (
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11.5,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {formattedTextContent}
          </pre>
        ) : (
          formattedTextViewBlocks.map((blk) => (
            <div key={blk.startCol} className="mbc-aln-text-block">
              <div className="mbc-aln-text-line mbc-aln-text-cons">
                <span className="mbc-aln-text-name">
                  <span className="mbc-aln-name-text">Consensus</span>
                  <span className="mbc-aln-name-metric">{alignmentConsensusLabel(consensusSettings.threshold)}</span>
                </span>
                <span className="mbc-aln-text-seq">{blk.consSlice}</span>
                <span className="mbc-aln-text-coord">{blk.endCol}</span>
              </div>
              {blk.rows.map((r) => (
                <div key={r.idx} className="mbc-aln-text-line">
                  <span className="mbc-aln-text-name">
                    {r.idx}. {r.name}
                  </span>
                  <span className="mbc-aln-text-seq">
                    {r.slice.split('').map((ch, i) => {
                      const diff = ch !== blk.consSlice[i] && ch !== '-';
                      return (
                        <span key={i} className={diff ? 'mbc-aln-text-diff' : undefined}>
                          {ch}
                        </span>
                      );
                    })}
                  </span>
                  <span className="mbc-aln-text-coord">{r.endCoord}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const SequenceAlignmentStudio: React.FC<SequenceAlignmentStudioProps> = ({
  documents,
  projectDocuments = documents,
  activeDoc,
  initialSubMode = 'msa',
  initialInspectorTab,
  initialPrimaryTab,
  initialMsaAlgorithm = 'consistency-nj',
  initialPairwiseAlgorithm = 'nw',
  commandNonce = 0,
  onGenerateConsensus,
  onUpdateDocument,
}) => {
  const [alignSubMode, setAlignSubMode] = useState<AlignmentSubMode>(initialSubMode);
  const [msaFigure, setMsaFigure] = useState<AlignmentMsaFigure>('grid');
  const [inspectorTab, setInspectorTab] = useState<AlignmentInspectorTab>(
    initialInspectorTab ?? initialPrimaryTab ?? 'general'
  );
  const [msaAlgorithm, setMsaAlgorithm] =
    useState<StudioMsaPresetId>(() => toStudioMsaPresetId(initialMsaAlgorithm));
  const [seq1Id, setSeq1Id] = useState<string>(
    documents.find((d) => d.id === activeDoc.id)?.id ?? documents[0]?.id ?? activeDoc.id
  );
  const [seq2Id, setSeq2Id] = useState<string>(
    documents.find((d) => d.id !== seq1Id)?.id ?? seq1Id
  );
  const [pairwiseMode, setPairwiseMode] = useState<PairwiseAlgorithmOption>(
    initialPairwiseAlgorithm
  );
  // Pairwise scoring (BLAST-style defaults: blastn 2/-3, gap 5+2·k; blastp BLOSUM62, gap 11+1·k).
  const [pwMatch, setPwMatch] = useState<number>(2);
  const [pwMismatch, setPwMismatch] = useState<number>(-3);
  const [pwGapOpen, setPwGapOpen] = useState<number>(5);
  const [pwGapExtend, setPwGapExtend] = useState<number>(2);
  const [pwProteinMatrix, setPwProteinMatrix] = useState<'blosum62' | 'pam250'>('blosum62');
  const [pwProteinGapOpen, setPwProteinGapOpen] = useState<number>(11);
  const [pwProteinGapExtend, setPwProteinGapExtend] = useState<number>(1);

  // Alignment View toolbar & zoom controls
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [cursorCol, setCursorCol] = useState<number>(1);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number>(0);
  const [forceRunMsaOnList, setForceRunMsaOnList] = useState<boolean>(false);
  const [msaCommandNotice, setMsaCommandNotice] = useState<string>('');

  // General & Display Inspector settings
  // The colour scheme lives outside the studio, per document, so Export › Alignment Image paints
  // the scheme this grid is drawn in (BG-01M6XPX5). The open-document effect below still gives each
  // document its molecule type's default as it opens it.
  const colorScheme = useAlignmentColorScheme(activeDoc);
  const setColorScheme = (scheme: AlignmentColorScheme) => setAlignmentImageColorScheme(activeDoc.id, scheme);
  const [showGraphs, setShowGraphs] = useState<boolean>(true);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [showConsensus, setShowConsensus] = useState<boolean>(true);
  const [showHighlighting, setShowHighlighting] = useState<boolean>(false);
  const [highlightMode, setHighlightMode] = useState<'All Disagreements' | 'All Agreements'>(
    'All Disagreements'
  );
  const [highlightRef, setHighlightRef] = useState<'Consensus' | 'Reference'>('Consensus');
  const [useDotsForAgreements, setUseDotsForAgreements] = useState<boolean>(false);
  // The consensus settings live outside the studio, per document, so the Flatfile tab's alignment
  // text prints the consensus this grid shows.
  const consensusSettings = useAlignmentConsensusSettings(activeDoc.id);
  const { threshold: consensusThreshold, ignoreGaps: consensusIgnoreGaps } = consensusSettings;
  const setConsensusThreshold = (threshold: string) =>
    setAlignmentConsensusSettings(activeDoc.id, { ...alignmentConsensusSettingsFor(activeDoc.id), threshold });
  const setConsensusIgnoreGaps = (ignoreGaps: boolean) =>
    setAlignmentConsensusSettings(activeDoc.id, { ...alignmentConsensusSettingsFor(activeDoc.id), ignoreGaps });
  const [showNucleotides, setShowNucleotides] = useState<boolean>(true);
  const [showComplement, setShowComplement] = useState<boolean>(false);
  const [showTranslation, setShowTranslation] = useState<boolean>(false);
  const [translationGeneticCode, setTranslationGeneticCode] = useState<string>(
    activeDoc.alignmentMeta?.geneticCodeLabel &&
      activeDoc.alignmentMeta.geneticCodeLabel !== '-'
      ? normaliseGeneticCodeName(activeDoc.alignmentMeta.geneticCodeLabel)
      : 'Standard (1)'
  );
  const [translationFrame, setTranslationFrame] = useState<string>('By annotation');
  const [showRestrictionSites, setShowRestrictionSites] = useState<boolean>(false);
  const [wrapAlignment, setWrapAlignment] = useState<boolean>(false);
  const [showNames, setShowNames] = useState<boolean>(true);
  const [showSecondaryLabel, setShowSecondaryLabel] = useState<boolean>(false);
  const [secondaryLabelField, setSecondaryLabelField] = useState<
    'Description' | 'Organism' | 'Accession'
  >('Description');
  const [showSeqNumbers, setShowSeqNumbers] = useState<boolean>(true);

  // Graphs Inspector settings
  const [showGcGraph, setShowGcGraph] = useState<boolean>(false);
  const [showAtGraph, setShowAtGraph] = useState<boolean>(false);
  const [showFramePlot, setShowFramePlot] = useState<boolean>(false);
  const [gcWindowSize, setGcWindowSize] = useState<number>(48);
  const [showCoverageGraph, setShowCoverageGraph] = useState<boolean>(
    activeDoc.id === 'doc-contig-coi-assembly' || activeDoc.documentKind === 'contig'
  );
  const [coverageLogScale, setCoverageLogScale] = useState<boolean>(false);
  const [coverageHighlightBelow, setCoverageHighlightBelow] = useState<boolean>(false);
  const [showSequenceLogo, setShowSequenceLogo] = useState<boolean>(false);
  const [showIdentityGraph, setShowIdentityGraph] = useState<boolean>(true);
  const [identityWindowSize, setIdentityWindowSize] = useState<number>(1);

  // Contig Consensus & Highlighting extra options
  const [showDistancesInRow, setShowDistancesInRow] = useState<boolean>(false);
  const [showSequenceIcons, setShowSequenceIcons] = useState<boolean>(
    activeDoc.documentKind === 'contig' || activeDoc.folder === 'Contig Assembly'
  );
  const [threeLetterAminoAcids, setThreeLetterAminoAcids] = useState<boolean>(false);
  const [showAminoAcidNumbering, setShowAminoAcidNumbering] = useState<boolean>(false);

  // Dotplot tab controls (EMBOSS dottup / Contig Assembly Dotplot)

  // Annotations & Tracks Inspector settings
  const [annotationFilterQuery, setAnnotationFilterQuery] = useState<string>('');
  const [hiddenAnnotationTypes, setHiddenAnnotationTypes] = useState<Set<string>>(
    () => new Set()
  );

  // Color Options Modal & Protein Simple Graphs settings
  const [showColorEditorModal, setShowColorEditorModal] = useState<boolean>(false);
  const [showHydrophobicityGraph, setShowHydrophobicityGraph] = useState<boolean>(false);
  const [hydrophobicityWindowSize, setHydrophobicityWindowSize] = useState<number>(15);
  const [showPiGraph, setShowPiGraph] = useState<boolean>(false);
  const [piWindowSize, setPiWindowSize] = useState<number>(15);

  // Live Annotate & Predict Inspector settings
  const [transferSimPct, setTransferSimPct] = useState<number>(75);
  const [liveAnnotateStatus, setLiveAnnotateStatus] = useState<string>('');
  const [annotateFromSource, setAnnotateFromSource] = useState<string>('Reference Features');
  const [findOrfsMinSize, setFindOrfsMinSize] = useState<number>(300);
  const [findOrfsGeneticCode, setFindOrfsGeneticCode] = useState<string>('Standard (1)');
  const [findOrfsStartCodons, setFindOrfsStartCodons] = useState<string>('ATG');

  // Restriction Analysis Inspector settings
  const [candidateEnzymeSet, setCandidateEnzymeSet] = useState<string>('commercial-6');
  const [highlightDam, setHighlightDam] = useState<boolean>(false);
  const [highlightDcm, setHighlightDcm] = useState<boolean>(false);

  // Advanced Inspector settings
  const [hideGapSitesOverPct, setHideGapSitesOverPct] = useState<boolean>(false);
  const [gapSiteThresholdPct, setGapSiteThresholdPct] = useState<number>(90);
  const [spacesEveryNBases, setSpacesEveryNBases] = useState<number>(10);
  const [advNumbering, setAdvNumbering] = useState<string>('Standard');
  const [advMiniMap, setAdvMiniMap] = useState<boolean>(true);
  const [advOutlineZoomedOut, setAdvOutlineZoomedOut] = useState<boolean>(true);
  const [advAnnLabelsPos, setAdvAnnLabelsPos] = useState<string>('Inside');
  const [advAnnCompress, setAdvAnnCompress] = useState<boolean>(false);
  const [advAnnShowArrowTips, setAdvAnnShowArrowTips] = useState<boolean>(true);
  const [advAnnHideExcessiveLabels, setAdvAnnHideExcessiveLabels] = useState<boolean>(true);
  const [advSize100Pct, setAdvSize100Pct] = useState<number>(13);
  const [advSizeZoomedOut, setAdvSizeZoomedOut] = useState<number>(14);
  const [advSizeAnnLabels, setAdvSizeAnnLabels] = useState<number>(11);
  const [advSizeAnnThickness, setAdvSizeAnnThickness] = useState<number>(13);
  const [advSizeSeqNames, setAdvSizeSeqNames] = useState<number>(12);
  // Ruler numbers are interface text, so they never go below the 11px caption floor (DESIGN.md).
  const [advSizeBaseNumbers, setAdvSizeBaseNumbers] = useState<number>(RULER_NUMBER_FONT_FLOOR_PX);

  // Member Annotations panel state
  const [annTabTypeFilter, setAnnTabTypeFilter] = useState<string>('All');
  const [annTabSearch, setAnnTabSearch] = useState<string>('');

  // Distances panel state
  const [distanceMetric, setDistanceMetric] = useState<
    'identity' | 'diffs' | 'p-dist' | 'jc69' | 'k2p'
  >('identity');
  const [distanceDecimals, setDistanceDecimals] = useState<number>(3);
  const [distanceStyle, setDistanceStyle] = useState<
    'Numbers Only' | 'Heatmap + Numbers' | 'Lower Triangle'
  >('Numbers Only');
  const [selectedDistRow, setSelectedDistRow] = useState<number>(1);

  // Sequence List / Lengths Graph / Virtual Gel / Fragments state
  const [lengthsBinCount, setLengthsBinCount] = useState<number>(10);
  const [lengthsFitToWindow, setLengthsFitToWindow] = useState<boolean>(true);
  const [gelStainPreset, setGelStainPreset] = useState<GelStainPreset>('etbr');
  const [gelExposurePct, setGelExposurePct] = useState<number>(100);
  const [gelAgarosePct, setGelAgarosePct] = useState<number>(1.0);
  const [gelBufferType, setGelBufferType] = useState<'TAE' | 'TBE' | 'SB'>('TAE');
  const [gelShowDyeFront, setGelShowDyeFront] = useState<boolean>(true);
  const [gelShowLaneTracks, setGelShowLaneTracks] = useState<boolean>(true);
  const [gelShowMwLabels, setGelShowMwLabels] = useState<boolean>(true);
  const [gelCopyNotice, setGelCopyNotice] = useState<boolean>(false);
  const [hoveredBand, setHoveredBand] = useState<{
    id: string;
    label: string;
    sizeBp: number;
    laneLabel: string;
    laneIndex: number;
    rf: number;
    intensityPct: number;
    enzyme?: string;
    start?: number;
    end?: number;
  } | null>(null);
  const [cursorY, setCursorY] = useState<number | null>(null);
  const [gelLadderName, setGelLadderName] = useState<
    '10bp DNA Ladder' | '100bp DNA Ladder' | '1kb DNA Ladder' | '1kb Plus DNA Ladder'
  >('10bp DNA Ladder');
  const [gelBandIntensity, setGelBandIntensity] = useState<'Relative to DNA mass' | 'Uniform'>(
    'Relative to DNA mass'
  );
  const [gelDigestSingleEnzyme, setGelDigestSingleEnzyme] = useState<boolean>(false);
  const [gelDigestEnzymeName, setGelDigestEnzymeName] = useState<string>('EcoRI');
  const [gelShowLaneNames, setGelShowLaneNames] = useState<boolean>(true);
  const [gelShowFragmentsTable, setGelShowFragmentsTable] = useState<boolean>(false);

  // Screen pixels per gel unit as the gel is drawn: its 480-unit view fitted to the SVG's width (its
  // height follows the view). In the inspector the gel is drawn at about its own size or smaller,
  // so its labels are sized for the scale it is drawn at and never fall below the 11px floor on
  // screen, as the cloning studio's gel does. A render with no layout (the server, a test) keeps 1.
  const [gelScale, setGelScale] = useState<number>(1);
  const gelObserverRef = useRef<ResizeObserver | null>(null);
  // The gel as it is drawn, and its drawing as of the last render, so an export draws it at full
  // size whatever window it is saved from (as BG-01M6RJZB does for the cloning gel).
  const gelSvgElementRef = useRef<SVGSVGElement | null>(null);
  const gelDrawingRef = useRef<((labelSize: number) => React.ReactElement) | null>(null);
  const gelSvgRef = React.useCallback((svg: SVGSVGElement | null) => {
    gelObserverRef.current?.disconnect();
    gelObserverRef.current = null;
    gelSvgElementRef.current = svg;
    if (!svg) return;
    setFigureFileDrawing(svg, () => {
      const draw = gelDrawingRef.current;
      if (!draw) throw new Error('The gel has not been drawn yet');
      // Drawn inside an <svg>, as on screen, so its elements are read as SVG; the export keeps the inside.
      return renderToStaticMarkup(<svg>{draw(VIRTUAL_GEL_LABEL_UNITS)}</svg>).slice('<svg>'.length, -'</svg>'.length);
    });
    const measure = () => {
      const box = svg.getBoundingClientRect();
      // A hidden gel (zero box) keeps the scale it was last drawn at.
      if (!(box.width > 0)) return;
      setGelScale(box.width / VIRTUAL_GEL_VIEW_WIDTH);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      gelObserverRef.current = new ResizeObserver(measure);
      gelObserverRef.current.observe(svg);
    }
  }, []);

  // The lengths chart is drawn one unit to a pixel at the width its panel gives it, so its text
  // is drawn at its own size whatever the panel's width. A render with no layout keeps the default.
  const [lengthsChartWidth, setLengthsChartWidth] = useState<number>(LENGTHS_CHART_DEFAULT_WIDTH);
  const lengthsObserverRef = useRef<ResizeObserver | null>(null);
  const lengthsChartRef = React.useCallback((svg: SVGSVGElement | null) => {
    lengthsObserverRef.current?.disconnect();
    lengthsObserverRef.current = null;
    if (!svg) return;
    const measure = () => {
      const width = svg.getBoundingClientRect().width;
      // A hidden chart (zero box) keeps the width it was last drawn at.
      if (width > 0) setLengthsChartWidth(width);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      lengthsObserverRef.current = new ResizeObserver(measure);
      lengthsObserverRef.current.observe(svg);
    }
  }, []);

  // US-01M6S7QS: the side panel's and the name column's widths, set by dragging their handles or
  // with the arrow keys, kept while the app is open and across restarts.
  const [paneWidths, setPaneWidths] = useState<AlignmentPaneWidths>(rememberedAlignmentPaneWidths);
  const paneWidthsSetRef = useRef(false);
  // The grid's and the side panel's widths as laid out, which bound both handles.
  const [paneLayout, setPaneLayout] = useState({ gridPx: 0, panelPx: 0 });
  const paneObserverRef = useRef<ResizeObserver | null>(null);
  const splitLayoutRef = React.useCallback((split: HTMLDivElement | null) => {
    paneObserverRef.current?.disconnect();
    paneObserverRef.current = null;
    if (!split) return;
    const grid = split.querySelector<HTMLElement>('.mbc-aln-canvas-pane');
    // The side panel comes and goes with the inspector (US-01M6TA6T), and one drawn again is a new
    // element, so each measure reads, and observes, the panel drawn now (none while it is closed).
    let panel: HTMLElement | null = null;
    const measure = () => {
      const drawn = split.querySelector<HTMLElement>('.mbc-aln-inspector-body');
      if (drawn !== panel) {
        if (panel) observer?.unobserve(panel);
        panel = drawn;
        if (panel) observer?.observe(panel);
      }
      const gridPx = Math.round(grid?.getBoundingClientRect().width ?? 0);
      const panelPx = Math.round(panel?.getBoundingClientRect().width ?? 0);
      // A layout with no box (hidden, or no layout at all) keeps the room it last had.
      if (!(gridPx > 0)) return;
      setPaneLayout((was) => (was.gridPx === gridPx && was.panelPx === panelPx ? was : { gridPx, panelPx }));
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    paneObserverRef.current = observer;
    if (grid) observer?.observe(grid);
    measure();
  }, []);
  const paneMeasured = paneLayout.gridPx > 0;
  // The panel may take what the grid has beyond its 360px, up to 720px; the name column what the
  // grid has beyond 120px of residues, up to 480px.
  const sidePanelMaxPx = paneMeasured
    ? Math.max(ALN_SIDE_PANEL_MIN_PX, Math.min(ALN_SIDE_PANEL_MAX_PX, paneLayout.gridPx + paneLayout.panelPx - ALN_GRID_MIN_PX))
    : ALN_SIDE_PANEL_MAX_PX;
  const nameColumnMaxPx = paneMeasured
    ? Math.max(ALN_NAME_COLUMN_MIN_PX, Math.min(ALN_NAME_COLUMN_MAX_PX, paneLayout.gridPx - ALN_NAME_TRACK_MIN_PX))
    : ALN_NAME_COLUMN_MAX_PX;
  const sidePanelPx = paneWidths.sidePanelPx === null ? null : Math.min(paneWidths.sidePanelPx, sidePanelMaxPx);
  /** The panel's width now: the dragged width, or the responsive width it is laid out at. */
  const sidePanelNowPx = sidePanelPx ?? (paneLayout.panelPx || ALN_SIDE_PANEL_SETTINGS_PX);
  const nameColumnPx = Math.min(paneWidths.nameColumnPx, nameColumnMaxPx);

  const paneDragRef = useRef<{
    handle: AlignmentPaneHandle;
    pointerId: number;
    startX: number;
    startPx: number;
    maxPx: number;
  } | null>(null);
  const [paneDragging, setPaneDragging] = useState<AlignmentPaneHandle | null>(null);
  /** Sets a handle's width; null puts the side panel back to its responsive width. */
  const setPaneWidth = (handle: AlignmentPaneHandle, px: number | null) => {
    paneWidthsSetRef.current = true;
    setPaneWidths((w) =>
      handle === 'side-panel'
        ? w.sidePanelPx === px ? w : { ...w, sidePanelPx: px }
        : px === null || w.nameColumnPx === px ? w : { ...w, nameColumnPx: px }
    );
  };
  const startPaneDrag = (e: React.PointerEvent<HTMLDivElement>, handle: AlignmentPaneHandle) => {
    if (e.button !== 0 || paneDragRef.current) return;
    e.preventDefault();
    paneDragRef.current = handle === 'side-panel'
      ? { handle, pointerId: e.pointerId, startX: e.clientX, startPx: sidePanelNowPx, maxPx: sidePanelMaxPx }
      : { handle, pointerId: e.pointerId, startX: e.clientX, startPx: nameColumnPx, maxPx: nameColumnMaxPx };
    setPaneDragging(handle);
  };
  // While a handle is held, the pointer's moves anywhere in the window set its width: the panel
  // grows leftwards, the name column rightwards.
  useEffect(() => {
    if (!paneDragging) return;
    const onMove = (ev: PointerEvent) => {
      const d = paneDragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const dx = ev.clientX - d.startX;
      setPaneWidth(
        d.handle,
        d.handle === 'side-panel'
          ? paneWidthAfterMove(d.startPx, d.startPx - dx, ALN_SIDE_PANEL_MIN_PX, d.maxPx)
          : paneWidthAfterMove(d.startPx, d.startPx + dx, ALN_NAME_COLUMN_MIN_PX, d.maxPx)
      );
    };
    const finish = () => {
      paneDragRef.current = null;
      setPaneDragging(null);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === paneDragRef.current?.pointerId) finish();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneDragging]);
  // A width the user set is kept once the handle is let go.
  useEffect(() => {
    if (paneDragging || !paneWidthsSetRef.current) return;
    keepAlignmentPaneWidths(paneWidths);
  }, [paneWidths, paneDragging]);
  /** Arrow keys step a handle 16px (Left widens the panel and narrows the column); Home resets it. */
  const onPaneHandleKey = (e: React.KeyboardEvent<HTMLDivElement>, handle: AlignmentPaneHandle) => {
    const panel = handle === 'side-panel';
    const now = panel ? sidePanelNowPx : nameColumnPx;
    const min = panel ? ALN_SIDE_PANEL_MIN_PX : ALN_NAME_COLUMN_MIN_PX;
    const max = panel ? sidePanelMaxPx : nameColumnMaxPx;
    const widen = panel ? 'ArrowLeft' : 'ArrowRight';
    const narrow = panel ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === widen || e.key === narrow) {
      e.preventDefault();
      const px = paneWidthAfterMove(now, now + (e.key === widen ? ALN_PANE_KEY_STEP_PX : -ALN_PANE_KEY_STEP_PX), min, max);
      if (px !== null) setPaneWidth(handle, px);
    } else if (e.key === 'Home') {
      e.preventDefault();
      resetPaneWidth(handle);
    }
  };
  const resetPaneWidth = (handle: AlignmentPaneHandle) =>
    setPaneWidth(handle, handle === 'side-panel' ? null : DEFAULT_NAME_COLUMN_WIDTH_PX);

  useEffect(() => {
    setAlignSubMode(initialSubMode);
    setMsaFigure('grid');
  }, [initialSubMode, commandNonce]);

  useEffect(() => {
    setMsaAlgorithm(toStudioMsaPresetId(initialMsaAlgorithm));
  }, [initialMsaAlgorithm, commandNonce]);

  useEffect(() => {
    setPairwiseMode(initialPairwiseAlgorithm);
  }, [initialPairwiseAlgorithm, commandNonce]);

  useEffect(() => {
    const requested = initialInspectorTab ?? initialPrimaryTab;
    if (requested) {
      setInspectorTab(requested);
    }
  }, [initialInspectorTab, initialPrimaryTab, commandNonce]);

  const isContigFolderDoc = activeDoc.folder === 'Contig Assembly';
  const isContigAssemblyDoc = isContigAssemblyDocument(activeDoc);
  const isSangerTraceDoc =
    activeDoc.documentKind === 'trace' || Boolean(activeDoc.chromatogram);
  const isNgsReadListDoc =
    activeDoc.id === 'doc-contig-yghj-ion-torrent' ||
    activeDoc.id === 'doc-contig-yghj-illumina' ||
    (isContigFolderDoc && activeDoc.alignmentMeta?.isAligned === false);

  useEffect(() => {
    setForceRunMsaOnList(false);
    if (
      activeDoc.alignmentMeta?.geneticCodeLabel &&
      activeDoc.alignmentMeta.geneticCodeLabel !== '-'
    ) {
      setTranslationGeneticCode(normaliseGeneticCodeName(activeDoc.alignmentMeta.geneticCodeLabel));
    }
    // Each document opens in its molecule type's default scheme (Zappo for a protein).
    setColorScheme(defaultColorScheme(activeDoc.moleculeType === 'Protein'));
    // A contig's consensus threshold is its own setting (Majority until changed), kept per document
    // for the session (not reset here), so its alignment text agrees with this grid.
    if (isContigAssemblyDocument(activeDoc)) {
      setShowHighlighting(true);
      setShowCoverageGraph(true);
    }
  }, [activeDoc.id]);

  // Alignment menu MSA presets (MAFFT / Clustal Omega / MUSCLE …): run the alignment on an
  // unaligned list, and say plainly that a stored alignment is kept as saved. Declared after the
  // per-document reset above so the run request is not cleared by it.
  useEffect(() => {
    const hasMembers = Boolean(activeDoc.alignmentMeta?.sequences?.length);
    const { action, consumed } = resolveMsaMenuCommand({
      commandNonce,
      subMode: initialSubMode,
      docId: activeDoc.id,
      hasEmbeddedMembers: hasMembers,
      isAligned: activeDoc.alignmentMeta?.isAligned,
      consumed: consumedMsaMenuCommand,
    });
    consumedMsaMenuCommand = consumed;
    if (action === 'run-on-list') {
      setForceRunMsaOnList(true);
      setMsaCommandNotice('');
    } else if (action === 'stored-alignment') {
      const presetLabel = MSA_PRESET_INFO[toStudioMsaPresetId(initialMsaAlgorithm)]?.label ?? initialMsaAlgorithm;
      setMsaCommandNotice(
        `${activeDoc.name} is a stored alignment and is shown as saved; the ${presetLabel} preset was not re-run. ` +
        'To realign, run the preset on the unaligned sequences (an unaligned list or the selected sequence documents).'
      );
    } else {
      setMsaCommandNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandNonce, activeDoc.id]);

  const doc1 = useMemo(
    () => documents.find((d) => d.id === seq1Id) ?? documents[0] ?? activeDoc,
    [documents, seq1Id, activeDoc]
  );
  const doc2 = useMemo(
    () => documents.find((d) => d.id === seq2Id) ?? documents.find((d) => d.id !== doc1.id) ?? doc1,
    [documents, seq2Id, doc1]
  );

  // Pairwise DP is only displayed in the Pairwise sub-mode. Computing it eagerly on every mount
  // of the Alignment studio cost ~200 ms of synchronous main-thread WASM time (full NW/SW of the
  // two selected documents) even when the user only opened the MSA view, so it is now gated.
  const pairwiseVisible = alignSubMode === 'pairwise';
  const pairwiseInputError = alignmentInputError(
    [doc1, doc2], pairwiseMode.startsWith('banded') ? 25000 : 2400
  ) ?? (doc1.moleculeType !== doc2.moleculeType ? 'Select sequences of the same molecule type.' : null);

  const pairwiseIsProtein = doc1.moleculeType === 'Protein';
  const pwScoring = pairwiseIsProtein
    ? { match: 0, mismatch: 0, gapOpen: pwProteinGapOpen, gapExtend: pwProteinGapExtend }
    : { match: pwMatch, mismatch: pwMismatch, gapOpen: pwGapOpen, gapExtend: pwGapExtend };

  const bandedPairwiseRes = useMemo(() => {
    if (!pairwiseVisible || pairwiseInputError) return null;
    if (pairwiseMode !== 'banded-nw' && pairwiseMode !== 'banded-sw') return null;
    return alignPairwiseBandedSparseRust(
      doc1.sequence,
      doc2.sequence,
      pairwiseMode === 'banded-sw' ? 'local' : 'global',
      6,
      24,
      // Banded DP uses a match/mismatch scheme for both alphabets.
      pairwiseIsProtein ? 5 : pwScoring.match,
      pairwiseIsProtein ? -4 : pwScoring.mismatch,
      -Math.abs(pwScoring.gapOpen),
      -Math.abs(pwScoring.gapExtend)
    );
  }, [doc1, doc2, pairwiseMode, pairwiseVisible, pairwiseInputError, pairwiseIsProtein,
    pwScoring.match, pwScoring.mismatch, pwScoring.gapOpen, pwScoring.gapExtend]);

  const pairwiseRes = useMemo(() => {
    if (!pairwiseVisible) return null;
    if (pairwiseInputError) return null;
    if (bandedPairwiseRes) {
      return {
        alignedSeq1: bandedPairwiseRes.alignedSeq1,
        alignedSeq2: bandedPairwiseRes.alignedSeq2,
        midline: bandedPairwiseRes.midline,
        score: bandedPairwiseRes.score,
        matches: bandedPairwiseRes.matches,
        mismatches: bandedPairwiseRes.mismatches,
        gaps: bandedPairwiseRes.gaps,
        identityPct: bandedPairwiseRes.identityPct,
        similarityPct: bandedPairwiseRes.similarityPct,
        // Banded results use 0-based half-open starts; normalise to 1-based.
        xstart: bandedPairwiseRes.xstart + 1,
        xend: bandedPairwiseRes.xend,
        ystart: bandedPairwiseRes.ystart + 1,
        yend: bandedPairwiseRes.yend,
        cigar: bandedPairwiseRes.cigar,
        algorithm: bandedPairwiseRes.algorithm,
        engineUsed: bandedPairwiseRes.engineUsed,
      };
    }
    return alignPairwiseTypeScript(
      doc1.sequence, doc2.sequence, pairwiseMode === 'sw',
      pwScoring.match || 2, pwScoring.mismatch || -1,
      -Math.abs(pwScoring.gapOpen), -Math.abs(pwScoring.gapExtend),
      doc1.moleculeType, pwProteinMatrix
    );
  }, [doc1, doc2, pairwiseMode, bandedPairwiseRes, pairwiseVisible, pairwiseInputError,
    pwScoring.match, pwScoring.mismatch, pwScoring.gapOpen, pwScoring.gapExtend, pwProteinMatrix]);

  const hasEmbeddedMembers = Boolean(
    activeDoc.alignmentMeta?.sequences && activeDoc.alignmentMeta.sequences.length > 0
  );

  const fallbackMsaDocs = useMemo(
    () =>
      documents.map((d) => ({
        id: d.id,
        name: d.name,
        sequence: d.sequence,
        moleculeType: d.moleculeType,
      })),
    [documents]
  );

  const msaExecution = useMemo(
    () => runValidatedAlignment(
      alignSubMode !== 'msa' ? [] :
      hasEmbeddedMembers
        ? (activeDoc.alignmentMeta?.isAligned === false && forceRunMsaOnList
          ? activeDoc.alignmentMeta.sequences ?? [] : [])
        : fallbackMsaDocs,
      msaAlgorithm
    ),
    [fallbackMsaDocs, msaAlgorithm, hasEmbeddedMembers, activeDoc.alignmentMeta, forceRunMsaOnList, alignSubMode]
  );
  const fallbackMsaRes = msaExecution.result;
  const isUnalignedSequenceList = hasEmbeddedMembers &&
    activeDoc.alignmentMeta?.isAligned === false && (!forceRunMsaOnList || !!msaExecution.error);

  // Active member sequences for the alignment viewer
  const alignmentRows = useMemo(() => {
    const embedded = activeDoc.alignmentMeta?.sequences;
    if (embedded && embedded.length > 0) {
      if (activeDoc.alignmentMeta?.isAligned === false && forceRunMsaOnList && !msaExecution.error) {
        const alignedById = new Map(fallbackMsaRes.rows.map((r) => [r.id, r.alignedSeq]));
        return embedded.map((m) => ({
          id: m.id,
          name: m.name,
          accession: m.accession ?? '',
          description: m.description ?? '',
          organism: m.organism ?? '',
          sequence: alignedById.get(m.id) ?? m.sequence,
          strand: m.strand ?? 1,
          features: m.features ?? [],
        }));
      }
      return memberAlignmentRows(embedded);
    }
    if (contigFolderShowsSingleRead(isContigFolderDoc, documents.map((d) => d.id))) {
      const isRevRead =
        String(activeDoc.docMetadata?.['Is Forward Read'] ?? 'true') === 'false';
      return [
        {
          id: activeDoc.id,
          name: activeDoc.name,
          accession: activeDoc.accession ?? '',
          description: activeDoc.description ?? '',
          organism: String(activeDoc.docMetadata?.Organism ?? ''),
          sequence: activeDoc.sequence,
          strand: (isRevRead ? -1 : 1) as 1 | -1,
          features: activeDoc.features ?? [],
        },
      ];
    }
    return fallbackMsaRes.rows.map((r) => {
      const srcDoc = documents.find((d) => d.id === r.id);
      return {
        id: r.id,
        name: r.name,
        accession: srcDoc?.accession ?? '',
        description: srcDoc?.description ?? '',
        organism: String(srcDoc?.docMetadata?.Organism ?? ''),
        sequence: r.alignedSeq,
        strand: 1 as const,
        features: srcDoc?.features ?? [],
      };
    });
  }, [activeDoc, isContigFolderDoc, forceRunMsaOnList, msaAlgorithm, fallbackMsaRes, documents, msaExecution.error]);

  // Contig reads: quality-trimmed ends (annotated "Trimmed", ungapped read coordinates) do not
  // contribute to the consensus or to identity statistics.
  // The Flatfile tab's alignment text calls its consensus through the same function.
  const {
    votingRows: statisticRows,
    consensus: dynamicConsensus,
    identityByCol,
    identicalSitesCount,
  } = useMemo(
    () => alignmentGridConsensus(activeDoc, alignmentRows, consensusSettings),
    [activeDoc, alignmentRows, consensusSettings]
  );

  const msaRes = useMemo(() => {
    const rows = alignmentRows.map((r) => {
      let matches = 0;
      let nonGaps = 0;
      for (let i = 0; i < r.sequence.length; i++) {
        const ch = r.sequence[i];
        if (ch !== '-') {
          nonGaps++;
          if (ch.toUpperCase() === dynamicConsensus[i]) matches++;
        }
      }
      const idPct = nonGaps > 0 ? Math.round((matches / nonGaps) * 1000) / 10 : 100;
      return {
        id: r.id,
        name: r.name,
        accession: r.accession,
        description: r.description,
        organism: r.organism,
        alignedSeq: r.sequence,
        strand: r.strand,
        identityToConsensusPct: idPct,
        features: r.features,
      };
    });
    return {
      rows,
      consensus: dynamicConsensus,
      conservation: identityByCol,
    };
  }, [alignmentRows, dynamicConsensus, identityByCol]);

  // Aggregate all annotations across all member sequences for the Annotations and Tracks inspector
  const allAlignmentAnnotations = useMemo(() => {
    const list: {
      id: string;
      name: string;
      seqName: string;
      seqIdx: number;
      type: string;
      min: number;
      max: number;
      length: number;
      intervalsCount: number;
      direction: 'forward' | 'reverse' | 'none';
      color: string;
      track: string;
    }[] = [];
    alignmentRows.forEach((row, sIdx) => {
      for (const f of row.features) {
        const fTypeStr = String(f.type);
        const dir: 'forward' | 'reverse' | 'none' =
          fTypeStr === 'source' || fTypeStr === 'Site' || fTypeStr === 'Bond'
            ? 'none'
            : f.strand === -1
            ? 'reverse'
            : 'forward';
        const intervals = f.segments?.length ? f.segments : [f];
        const computedLen = intervals.reduce((n, s) => n + Math.abs(s.end - s.start) + 1, 0);
        list.push({
          id: `${row.id}-${f.id}`,
          name: f.name,
          seqName: row.name,
          seqIdx: sIdx,
          type: f.type,
          min: f.start,
          max: f.end,
          length: computedLen,
          intervalsCount: intervals.length,
          direction: dir,
          color: f.color || '#64748b',
          track: '',
        });
      }
    });
    return list.sort(
      (a, b) => a.seqName.localeCompare(b.seqName) || a.min - b.min || a.name.localeCompare(b.name)
    );
  }, [alignmentRows]);

  const annotationTypeSummary = useMemo(() => {
    const map = new Map<string, { type: string; count: number; color: string }>();
    for (const a of allAlignmentAnnotations) {
      const existing = map.get(a.type);
      if (existing) {
        existing.count++;
      } else {
        map.set(a.type, { type: a.type, count: 1, color: a.color });
      }
    }
    return Array.from(map.values());
  }, [allAlignmentAnnotations]);

  const filteredAnnotationsForTable = useMemo(() => {
    const q = (annTabSearch || annotationFilterQuery).trim().toLowerCase();
    return allAlignmentAnnotations.filter((a) => {
      if (hiddenAnnotationTypes.has(a.type)) return false;
      if (annTabTypeFilter !== 'All' && a.type !== annTabTypeFilter) return false;
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !a.seqName.toLowerCase().includes(q) &&
        !a.type.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allAlignmentAnnotations, annTabSearch, annotationFilterQuery, hiddenAnnotationTypes, annTabTypeFilter]);

  // Alignment Statistics (exact match to Screenshots 2.54.28 AM, 3.00.56 AM, 3.02.09 AM)
  const alignmentStats = useMemo(() => {
    const isProtein = activeDoc.moleculeType === 'Protein';
    const seqCount = alignmentRows.length;
    const colCount = dynamicConsensus.length;
    const ungappedLengths: number[] = [];
    const charCounts = new Map<string, number>();
    let totalNonGaps = 0;

    for (const r of alignmentRows) {
      let uLen = 0;
      for (let i = 0; i < r.sequence.length; i++) {
        const ch = r.sequence[i].toUpperCase();
        if (ch !== '-') {
          uLen++;
          totalNonGaps++;
          charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
        }
      }
      ungappedLengths.push(uLen);
    }

    const meanLen =
      seqCount > 0 ? ungappedLengths.reduce((s, v) => s + v, 0) / seqCount : 0;
    const variance =
      seqCount > 1
        ? ungappedLengths.reduce((s, v) => s + (v - meanLen) ** 2, 0) / (seqCount - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const minLen = ungappedLengths.length > 0 ? Math.min(...ungappedLengths) : 0;
    const maxLen = ungappedLengths.length > 0 ? Math.max(...ungappedLengths) : 0;

    const identicalSitesPct =
      colCount > 0 ? Math.round((identicalSitesCount / colCount) * 1000) / 10 : 100;
    const pairwiseIdentityPct = meanPairwiseIdentity(statisticRows.map((r) => r.sequence));
    // the pairs it read: fewer than the alignment has past 4,000, and the value says so
    const pairwiseIdentityPairs = pairwiseIdentitySampling(statisticRows.length);

    const gcCount = (charCounts.get('G') ?? 0) + (charCounts.get('C') ?? 0);

    // Molecular weight is composition-weighted, not a flat average mass per base.
    const nucleotideMw = meanNucleotideMolecularWeightKda(alignmentRows.map((r) => r.sequence));
    const ssDnaKda = nucleotideMw.ssKda.toFixed(3);
    const dsDnaKda = nucleotideMw.dsKda.toFixed(3);

    // The full residue alphabet is always listed for proteins, including the two rare
    // genetically encoded residues U (selenocysteine) and O (pyrrolysine) at zero.
    const orderedChars = isProtein
      ? ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', 'U', 'O']
      : ['A', 'C', 'G', 'T', 'U', 'W', 'K', 'R', 'Y', 'S', 'M', 'N'];

    const freqRows = orderedChars
      .filter(
        (ch) =>
          (charCounts.get(ch) ?? 0) > 0 ||
          isProtein ||
          ['A', 'C', 'G', 'T'].includes(ch)
      )
      .map((ch) => {
        const cnt = charCounts.get(ch) ?? 0;
        const pct = totalNonGaps > 0 ? ((cnt / totalNonGaps) * 100).toFixed(1) : '0.0';
        return { label: ch, count: cnt, pct: `${pct}%` };
      });

    if (!isProtein) {
      freqRows.push({
        label: 'GC',
        count: gcCount,
        pct: `${totalNonGaps > 0 ? ((gcCount / totalNonGaps) * 100).toFixed(1) : '0.0'}%`,
      });
    }
    freqRows.push({
      label: 'All',
      count: totalNonGaps,
      pct: '100.0%',
    });

    const aaGroupsDef = AA_GROUP_DEFINITIONS;
    const aaGroupRows = aaGroupsDef.map((g) => {
      const cnt = g.chars.reduce((s, c) => s + (charCounts.get(c) ?? 0), 0);
      const pct = totalNonGaps > 0 ? ((cnt / totalNonGaps) * 100).toFixed(1) : '0.0';
      return { label: g.label, count: cnt, pct: `${pct}%` };
    });
    // Real per-sequence protein properties (mean across sequences).
    const prot = isProtein
      ? summariseProteins(alignmentRows.map((r) => r.sequence))
      : { mwKda: 0, pI: 0, chargePh7: 0, extinction: 0, a280: 0 };
    const proteinMwKda = prot.mwKda.toFixed(2);
    const isoelectricPoint = prot.pI.toFixed(2);
    const chargeAtPh7 = prot.chargePh7.toFixed(2);
    const extinctionCoeff = Math.round(prot.extinction);
    const a280Mean = prot.a280.toFixed(2);

    const codonAaMap: Record<string, string> = {};
    for (const a of 'ACGT') for (const b of 'ACGT') for (const c of 'ACGT') {
      const codon = a + b + c;
      const aa = translateCodon(codon, translationGeneticCode);
      codonAaMap[codon] = aa === '*' ? '***' : threeLetterCode(aa);
    }
    const aa3To1Map: Record<string, string> = {
      Ala: 'A', Cys: 'C', Asp: 'D', Glu: 'E', Phe: 'F',
      Gly: 'G', His: 'H', Ile: 'I', Lys: 'K', Leu: 'L',
      Met: 'M', Asn: 'N', Pro: 'P', Gln: 'Q', Arg: 'R',
      Ser: 'S', Thr: 'T', Val: 'V', Trp: 'W', Tyr: 'Y',
      '***': '*',
    };
    const codonCounts = new Map<string, number>();
    const aaTotals = new Map<string, number>();
    let totalCodons = 0;
    if (!isProtein) {
      for (const r of alignmentRows) {
        const clean = r.sequence.replace(/-/g, '').toUpperCase().replace(/U/g, 'T');
        for (let i = 0; i + 2 < clean.length; i += 3) {
          const cod = clean.slice(i, i + 3);
          const aa3 = codonAaMap[cod];
          if (aa3) {
            codonCounts.set(cod, (codonCounts.get(cod) ?? 0) + 1);
            aaTotals.set(aa3, (aaTotals.get(aa3) ?? 0) + 1);
            totalCodons++;
          }
        }
      }
    }
    const useRnaAlphabet = activeDoc.moleculeType === 'RNA';
    const codonRows = Object.entries(codonAaMap).map(([dnaCod, aa3]) => {
      const cnt = codonCounts.get(dnaCod) ?? 0;
      const pct = totalCodons > 0 ? ((cnt / totalCodons) * 100).toFixed(1) : '0.0';
      const aaSum = aaTotals.get(aa3) ?? 0;
      const pctOfAa = aaSum > 0 ? `${Math.round((cnt / aaSum) * 100)}%` : '0%';
      const displayCodon = useRnaAlphabet ? dnaCod.replace(/T/g, 'U') : dnaCod;
      return {
        codon: displayCodon,
        aa: aa3,
        // Codon-usage rows are labelled with the one-letter code.
        aa1: aa3To1Map[aa3] ?? aa3,
        count: cnt,
        pct: `${pct}%`,
        pctOfAa,
      };
    });

    const translatedAa1Counts = new Map<string, number>();
    for (const [aa3, cnt] of aaTotals.entries()) {
      const c1 = aa3To1Map[aa3];
      if (c1 && c1 !== '*') {
        translatedAa1Counts.set(c1, cnt);
      }
    }
    const translatedAaGroupRows = aaGroupsDef.map((g) => {
      const cnt = g.chars.reduce((s, c) => s + (translatedAa1Counts.get(c) ?? 0), 0);
      const pct = totalCodons > 0 ? ((cnt / totalCodons) * 100).toFixed(1) : '0.0';
      return { label: g.label, count: cnt, pct: `${pct}%` };
    });

    return {
      isProtein,
      unit: isProtein ? 'aa' : 'bp',
      seqCount,
      colCount,
      ungappedLengths,
      meanLen: meanLen.toFixed(1),
      stdDev: stdDev.toFixed(1),
      minLen,
      maxLen,
      identicalSitesCount,
      identicalSitesPct,
      pairwiseIdentityPct,
      pairwiseIdentityPairs,
      ssDnaKda,
      dsDnaKda,
      proteinMwKda,
      isoelectricPoint,
      chargeAtPh7,
      extinctionCoeff,
      a280Mean,
      freqRows,
      aaGroupRows,
      translatedAaGroupRows,
      codonRows,
      totalCodons,
    };
  }, [activeDoc, alignmentRows, statisticRows, dynamicConsensus, identicalSitesCount, msaRes, translationGeneticCode]);

  // The Lengths Graph: a histogram of the members' ungapped lengths, drawn one unit to a pixel at
  // the chart's width. Its length axis runs from the shortest member to the longest, its bins hold
  // whole lengths, and its count axis steps in whole 1, 2 or 5 x 10^k counts from 0 to the first
  // step at or over the largest bin.
  const lengthsChartViewWidth = lengthsFitToWindow ? lengthsChartWidth : LENGTHS_CHART_FIXED_WIDTH;
  const lengthsChart = useMemo(() => {
    const lens = alignmentStats.ungappedLengths;
    const W = lengthsChartViewWidth;
    const H = LENGTHS_CHART_HEIGHT;
    const font = LENGTHS_CHART_FONT_PX;
    const labelWidth = (s: string) => s.length * LENGTHS_CHART_CHAR_EM * font;
    const shortest = lens.length ? Math.min(...lens) : 0;
    const longest = lens.length ? Math.max(...lens) : 0;
    const bins = lengthBins(lens, lengthsBinCount).filter((b) => b.count > 0);
    const maxCount = Math.max(1, ...bins.map((b) => b.count));

    // The plot's top and bottom leave room for the top count label and, below the length axis,
    // its tick labels and title.
    const top = 12;
    const bottom = H - 44;
    // At most five count steps, and ticks at least two label heights apart.
    let step = niceStep(maxCount / 5);
    while ((step * (bottom - top)) / (Math.ceil(maxCount / step) * step) < font * 2) step = niceStep(step + 1);
    const topCount = Math.ceil(maxCount / step) * step;
    const counts = Array.from({ length: topCount / step + 1 }, (_, i) => i * step);
    const countLabelWidth = Math.max(...counts.map((c) => labelWidth(c.toLocaleString())));

    // The count axis title (rotated) and labels sit left of the plot; the first and last length
    // labels are centred on the axis's ends, so the plot leaves each half a label of room.
    const titleX = 4 + 0.95 * font;
    const left = Math.max(titleX + 0.3 * font + 6 + countLabelWidth + 6, labelWidth(shortest.toLocaleString()) / 2 + 4);
    const right = W - Math.max(10, labelWidth(longest.toLocaleString()) / 2 + 4);
    const plotWidth = right - left;
    const xOf = (v: number) => (longest === shortest ? (left + right) / 2 : left + ((v - shortest) / (longest - shortest)) * plotWidth);
    const yOf = (count: number) => bottom - count * ((bottom - top) / topCount);

    // Length ticks: the shortest and the longest, and between them round lengths whose labels clear
    // their neighbours.
    const clears = (a: number, b: number) =>
      Math.abs(xOf(b) - xOf(a)) >= (labelWidth(a.toLocaleString()) + labelWidth(b.toLocaleString())) / 2 + 8;
    const lengthTicks = [shortest];
    if (longest > shortest) {
      const widest = labelWidth(longest.toLocaleString()) + 8;
      const lengthStep = niceStep(((longest - shortest) * widest) / Math.max(1, plotWidth));
      const between: number[] = [];
      for (let v = (Math.floor(shortest / lengthStep) + 1) * lengthStep; v < longest; v += lengthStep) between.push(v);
      for (const v of between) {
        if (clears(lengthTicks[lengthTicks.length - 1], v) && clears(v, longest)) lengthTicks.push(v);
      }
      lengthTicks.push(longest);
    }

    // Each bar stands over the lengths its bin holds (each length half a length either side of its
    // place on the axis, within the plot), a pixel in from each edge so neighbouring bars read apart.
    const bars = bins.map((b) => {
      const x0 = longest === shortest ? Math.max(left, xOf(shortest) - 40) : Math.max(left, xOf(b.first - 0.5));
      const x1 = longest === shortest ? Math.min(right, xOf(longest) + 40) : Math.min(right, xOf(b.last + 0.5));
      const height = b.count * ((bottom - top) / topCount);
      return { ...b, x: x0 + 1, width: Math.max(0, x1 - x0 - 2), y: bottom - height, height };
    });

    return { W, H, font, top, bottom, left, right, titleX, counts, yOf, xOf, lengthTicks, bars };
  }, [alignmentStats.ungappedLengths, lengthsBinCount, lengthsChartViewWidth]);

  // Virtual Gel & Restriction Fragments for Sequence Lists / Alignments
  const virtualGelAndFragments = useMemo(() => {
    const ladderCatalog: Record<string, number[]> = {
      '10bp DNA Ladder': [2500, 2000, 1500, 1000, 500, 100, 50, 10],
      '100bp DNA Ladder': [3000, 2000, 1500, 1200, 1000, 800, 600, 400, 200, 100],
      '1kb DNA Ladder': [10000, 8000, 6000, 4000, 3000, 2000, 1500, 1000, 500, 250],
      '1kb Plus DNA Ladder': [12000, 8000, 5000, 3000, 2000, 1500, 1000, 650, 400, 100],
    };
    const ladderBands = ladderCatalog[gelLadderName] ?? ladderCatalog['10bp DNA Ladder'];
    const enzymeMap: Record<string, { site: string; cutOffset: number }> = {
      EcoRI: { site: 'GAATTC', cutOffset: 1 },
      BamHI: { site: 'GGATCC', cutOffset: 1 },
      HindIII: { site: 'AAGCTT', cutOffset: 1 },
      PstI: { site: 'CTGCAG', cutOffset: 5 },
      TaqI: { site: 'TCGA', cutOffset: 1 },
    };
    const enz = enzymeMap[gelDigestEnzymeName] ?? enzymeMap.EcoRI;

    const digestedFragments: {
      id: string;
      seqName: string;
      enzyme: string;
      start: number;
      end: number;
      length: number;
    }[] = [];

    if (gelDigestSingleEnzyme && !alignmentStats.isProtein) {
      alignmentRows.forEach((r) => {
        const clean = r.sequence.replace(/-/g, '').toUpperCase().replace(/U/g, 'T');
        const cuts: number[] = [];
        let idx = clean.indexOf(enz.site);
        while (idx !== -1) {
          cuts.push(idx + enz.cutOffset);
          idx = clean.indexOf(enz.site, idx + 1);
        }
        if (clean.length > 0) {
          const pts = [0, ...cuts, clean.length];
          for (let i = 0; i < pts.length - 1; i++) {
            const fragLen = pts[i + 1] - pts[i];
            if (fragLen > 0) {
              digestedFragments.push({
                id: `${r.id}-frag-${i + 1}`,
                seqName: r.name,
                enzyme: gelDigestEnzymeName,
                start: pts[i] + 1,
                end: pts[i + 1],
                length: fragLen,
              });
            }
          }
        }
      });
    }

    const sampleBands =
      digestedFragments.length > 0
        ? digestedFragments.map((f) => ({ label: `${f.seqName} (${f.length} bp)`, sizeBp: f.length }))
        : alignmentRows.map((r, i) => ({
            label: r.name,
            sizeBp: alignmentStats.ungappedLengths[i] ?? r.sequence.replace(/-/g, '').length,
          }));

    return {
      ladderBands,
      sampleBands,
      digestedFragments,
    };
  }, [
    gelLadderName,
    gelDigestSingleEnzyme,
    gelDigestEnzymeName,
    alignmentStats.isProtein,
    alignmentStats.ungappedLengths,
    alignmentRows,
  ]);

  const currentStain = useMemo(
    () => VIRTUAL_GEL_STAINS.find((p) => p.id === gelStainPreset) ?? VIRTUAL_GEL_STAINS[0],
    [gelStainPreset]
  );

  const virtualGelLanes = useMemo(() => {
    const landmarkBands = new Set<number>();
    if (gelLadderName === '10bp DNA Ladder' || gelLadderName === '100bp DNA Ladder') {
      landmarkBands.add(1000);
      landmarkBands.add(500);
    } else {
      landmarkBands.add(3000);
      landmarkBands.add(1000);
      landmarkBands.add(500);
    }

    interface GelBandItem {
      id: string;
      label: string;
      sizeBp: number;
      start?: number;
      end?: number;
      enzyme?: string;
      isLandmark?: boolean;
    }

    interface GelLaneItem {
      id: string;
      laneIndex: number;
      label: string;
      isLadder: boolean;
      bands: GelBandItem[];
    }

    const ladderLane: GelLaneItem = {
      id: 'lane-ladder',
      laneIndex: 1,
      label: gelLadderName,
      isLadder: true,
      bands: virtualGelAndFragments.ladderBands.map((bp) => ({
        id: `lad-${bp}`,
        label: `${bp.toLocaleString()} bp`,
        sizeBp: bp,
        isLandmark: landmarkBands.has(bp),
        enzyme: undefined,
        start: undefined,
        end: undefined,
      })),
    };

    const sampleLanes: GelLaneItem[] = [];

    if (gelDigestSingleEnzyme && virtualGelAndFragments.digestedFragments.length > 0) {
      const grouped = new Map<string, typeof virtualGelAndFragments.digestedFragments>();
      virtualGelAndFragments.digestedFragments.forEach((f) => {
        if (!grouped.has(f.seqName)) grouped.set(f.seqName, []);
        grouped.get(f.seqName)!.push(f);
      });

      let laneIdx = 2;
      grouped.forEach((frags, seqName) => {
        if (laneIdx <= 6) {
          sampleLanes.push({
            id: `lane-sample-${laneIdx}`,
            laneIndex: laneIdx,
            label: `${seqName} (${gelDigestEnzymeName})`,
            isLadder: false,
            bands: frags.map((f, fi) => ({
              id: f.id,
              label: `${f.seqName} frag ${fi + 1}: ${f.length} bp`,
              sizeBp: f.length,
              start: f.start,
              end: f.end,
              enzyme: f.enzyme,
              isLandmark: false,
            })),
          });
          laneIdx++;
        }
      });
    } else {
      const rowsToShow =
        alignmentRows.length > 0
          ? alignmentRows.slice(0, 4)
          : [
              {
                id: activeDoc.id,
                name: activeDoc.name,
                sequence: activeDoc.sequence,
              },
            ];
      rowsToShow.forEach((r, idx) => {
        const size =
          alignmentStats.ungappedLengths[idx] ?? r.sequence.replace(/-/g, '').length;
        sampleLanes.push({
          id: `lane-sample-${idx + 2}`,
          laneIndex: idx + 2,
          label: r.name,
          isLadder: false,
          bands: [
            {
              id: `smp-${r.id}-${size}`,
              label: `${r.name}: ${size.toLocaleString()} bp`,
              sizeBp: size,
              isLandmark: true,
            },
          ],
        });
      });
    }

    return [ladderLane, ...sampleLanes];
  }, [
    gelLadderName,
    virtualGelAndFragments.ladderBands,
    virtualGelAndFragments.digestedFragments,
    gelDigestSingleEnzyme,
    gelDigestEnzymeName,
    alignmentRows,
    alignmentStats.ungappedLengths,
    activeDoc.id,
    activeDoc.name,
    activeDoc.sequence,
  ]);

  const { maxLog, minLog, agarosePower } = useMemo(() => {
    const allSizes: number[] = [];
    virtualGelLanes.forEach((l) => l.bands.forEach((b) => allSizes.push(b.sizeBp)));
    const maxVal = Math.max(3000, ...allSizes);
    const minVal = Math.max(8, Math.min(10, ...allSizes));
    const power = 1.0 + (gelAgarosePct - 1.0) * 0.35;
    return {
      maxLog: Math.log10(maxVal),
      minLog: Math.log10(minVal),
      agarosePower: power,
    };
  }, [virtualGelLanes, gelAgarosePct]);

  /**
   * Where everything in the gel's 480x340 view goes when its labels are `labelSize` gel units tall
   * (US-01M6S7ZF). The gel's frame sits at the left: the run direction and the ladder sizes in its
   * left margin, then the lanes, numbered over their wells. To the frame's right a column carries
   * the cathode mark level with the wells, the lane key under it, and the dye front and anode
   * marks level with the bottom of the gel, so the whole figure, key included, keeps the view's
   * aspect at any width. The spacing that keeps labels apart is sized from the labels, so on a
   * narrow panel, where they are larger in gel units, none meet; an export lays the gel out with
   * its full-size labels.
   */
  const layoutGel = (labelSize: number) => {
    const L = labelSize;
    const W = VIRTUAL_GEL_VIEW_WIDTH;
    const H = VIRTUAL_GEL_VIEW_HEIGHT;
    const n = virtualGelLanes.length;
    const textWidth = (chars: number, spacing = 0) => chars * (GEL_CHAR_EM * L + spacing);

    // Down the gel: lane numbers over the wells, the bands' run, then the dye front above the
    // bottom of the frame, placed so its mark and the anode's clear each other in the column.
    const frameTop = 2;
    const frameBottom = H - 2;
    const badgeHeight = virtualGelUnits(L + 4);
    const badgeTop = frameTop + 4;
    const badgeBaseline = gelAt(badgeTop + badgeHeight / 2 + 0.35 * L);
    const wellTop = gelAt(badgeTop + badgeHeight + 3);
    const wellBottom = wellTop + 10;
    const bandTop = wellBottom + 12;
    const anodeBaseline = gelAt(frameBottom - 4 - 0.3 * L);
    const dyeBaseline = gelAt(anodeBaseline - 1.3 * L - 2);
    const dyeY = gelAt(dyeBaseline - 0.35 * L - 2.25);
    const bandBottom = gelAt(dyeY - 12);

    // Across the gel: the run direction (read bottom to top), the ladder sizes right-aligned to
    // their ticks, then the lanes.
    const frameLeft = 1;
    const runX = gelAt(frameLeft + 4 + 0.95 * L);
    const ladderChars = gelShowMwLabels
      ? Math.max(...virtualGelAndFragments.ladderBands.map((bp) => bp.toLocaleString().length))
      : 0;
    const ladderX = gelAt(runX + 0.3 * L + 3 + ladderChars * GEL_MONO_CHAR_EM * L);
    const lanesLeft = ladderX + 12;
    const badgeWidth = Math.max(18, Math.ceil(L * GEL_KEY_CHAR_EM * String(n).length + 8));
    const laneGap = n > 3 ? 6 : 10;
    // A lane is never so narrow that its number's badge meets its neighbour's.
    const minLane = Math.max(16, badgeWidth - laneGap + 2);
    const maxLane = 44;

    // The column right of the frame holds the electrode and dye marks and, when lanes are named,
    // the key; the frame gives it room for every name in full where the lanes can spare it.
    const markWidth = Math.max(textWidth(11, 0.5), textWidth(9, 0.5), gelShowDyeFront ? textWidth(15) : 0);
    const longestName = gelShowLaneNames ? Math.max(...virtualGelLanes.map((l) => l.label.length)) : 0;
    const keyWidth = gelShowLaneNames ? badgeWidth + 6 + longestName * GEL_KEY_CHAR_EM * L : 0;
    const columnGap = 10;
    const room = W - 2 - frameLeft - columnGap;
    const frameMin = lanesLeft - frameLeft + n * minLane + (n - 1) * laneGap + 6;
    const frameMax = lanesLeft - frameLeft + n * maxLane + (n - 1) * laneGap + 6;
    const frameWidth = Math.max(frameMin, Math.min(frameMax, room - Math.max(markWidth, keyWidth)));
    const frameRight = frameLeft + frameWidth;
    const columnX = gelAt(frameRight + columnGap);

    const lanesRight = frameRight - 6;
    const laneWidth = Math.min(maxLane, Math.floor((lanesRight - lanesLeft - (n - 1) * laneGap) / n));
    const lanesStart = lanesLeft + Math.max(0, (lanesRight - lanesLeft - (n * laneWidth + (n - 1) * laneGap)) / 2);
    const lanes = virtualGelLanes.map((lane, idx) => ({
      ...lane,
      x: gelAt(lanesStart + idx * (laneWidth + laneGap)),
      width: laneWidth,
    }));

    // The key: a row per lane under the cathode mark, each lane's number and name, a name cut
    // short with an ellipsis only where the column cannot hold it.
    const cathodeBaseline = wellBottom;
    const keyTop = gelAt(cathodeBaseline + 0.3 * L + 8);
    const keyRowHeight = virtualGelUnits(badgeHeight + 4);
    const keyTextX = gelAt(columnX + badgeWidth + 6);
    const keyMaxChars = Math.max(4, Math.floor((W - 2 - (frameRight + columnGap + badgeWidth + 6)) / (GEL_KEY_CHAR_EM * L) + 1e-6));

    const sizeToY = (bp: number) => {
      const lv = Math.log10(Math.max(8, bp));
      const rawFrac = (maxLog - lv) / Math.max(0.1, maxLog - minLog);
      const clampedFrac = Math.min(1, Math.max(0, rawFrac));
      return bandTop + Math.pow(clampedFrac, agarosePower) * (bandBottom - bandTop);
    };

    // Ladder sizes are labelled where they clear one another (landmark sizes first); every ladder
    // band keeps its tick.
    const ladderYs = virtualGelAndFragments.ladderBands.map((bp) => ({ bp, y: sizeToY(bp) }));
    const landmark = (bp: number) => bp === 1000 || bp === 500 || bp === 3000;
    const labelledLadder: number[] = [];
    for (const pass of [true, false]) {
      for (const { bp, y } of ladderYs) {
        if (landmark(bp) !== pass) continue;
        if (ladderYs.every((o) => !labelledLadder.includes(o.bp) || Math.abs(o.y - y) >= L * 1.3)) labelledLadder.push(bp);
      }
    }

    return {
      L, frameTop, frameBottom, frameLeft, frameRight, badgeHeight, badgeTop, badgeBaseline, badgeWidth,
      wellTop, wellBottom, bandTop, bandBottom, dyeY, dyeBaseline, anodeBaseline, runX, ladderX,
      lanes, columnX, cathodeBaseline, keyTop, keyRowHeight, keyTextX, keyMaxChars, sizeToY,
      labelledLadder: new Set(labelledLadder),
    };
  };
  type GelLayout = ReturnType<typeof layoutGel>;

  /** The size whose band runs to `y` on the gel `lay` lays out. */
  const yToEstimatedBp = (y: number, lay: GelLayout) => {
    const clampedY = Math.max(lay.bandTop, Math.min(lay.bandBottom, y));
    const adjustedFrac = (clampedY - lay.bandTop) / (lay.bandBottom - lay.bandTop);
    const clampedFrac = Math.max(0, Math.min(1, adjustedFrac));
    const rawFrac = Math.pow(clampedFrac, 1 / agarosePower);
    const lv = maxLog - rawFrac * (maxLog - minLog);
    return Math.round(Math.pow(10, lv));
  };
  /** The relative mobility of a band at `y`: 0 at the top of its run, 1 at the bottom. */
  const gelRf = (y: number, lay: GelLayout) => Math.max(0, Math.min(1, (y - lay.bandTop) / (lay.bandBottom - lay.bandTop)));

  // The screen draws the gel with labels sized for the scale it is shown at, never below the 11px
  // floor; an export draws it at full size (VIRTUAL_GEL_LABEL_UNITS).
  const gelLabelSize = virtualGelUnits(Math.max(VIRTUAL_GEL_LABEL_UNITS, VIRTUAL_GEL_LABEL_FLOOR_PX / gelScale));
  const gelLayout = layoutGel(gelLabelSize);

  /**
   * The gel inside its view, its labels `labelSize` gel units tall, as the screen and an export
   * draw it. The screen also rings the band under the cursor (`hoveredId`); a file never does.
   */
  const drawGel = (labelSize: number, hoveredId?: string): React.ReactElement => {
    const lay = layoutGel(labelSize);
    const L = lay.L;
    const markFill = currentStain.isDark ? '#64748b' : '#94a3b8';
    const badgeFill = currentStain.isDark ? '#1e293b' : '#e2e8f0';
    const badgeStroke = currentStain.isDark ? '#334155' : '#cbd5e1';
    const badgeText = currentStain.isDark ? '#cbd5e1' : '#475569';
    return (
      <>
        <defs>
          {/* EtBr Warm Amber Glow Filter */}
          <filter id="gel-glow-etbr" x="-40%" y="-140%" width="180%" height="380%">
            <feGaussianBlur stdDeviation="2.8" result="blur1" />
            <feGaussianBlur stdDeviation="1.1" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* GelDoc Cool Silver Glow Filter */}
          <filter id="gel-glow-silver" x="-40%" y="-140%" width="180%" height="380%">
            <feGaussianBlur stdDeviation="2.6" result="blur1" />
            <feGaussianBlur stdDeviation="0.9" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* SYBR Safe Emerald Green Glow Filter */}
          <filter id="gel-glow-sybr" x="-40%" y="-140%" width="180%" height="380%">
            <feGaussianBlur stdDeviation="2.8" result="blur1" />
            <feGaussianBlur stdDeviation="1.1" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* GelRed Coral Red Glow Filter */}
          <filter id="gel-glow-gelred" x="-40%" y="-140%" width="180%" height="380%">
            <feGaussianBlur stdDeviation="2.8" result="blur1" />
            <feGaussianBlur stdDeviation="1.1" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Transilluminator Radial UV Light Ambient */}
          <radialGradient id="uv-radial-glow" cx="50%" cy="45%" r="55%">
            <stop
              offset="0%"
              stopColor={
                currentStain.id === 'etbr'
                  ? 'rgba(249, 115, 22, 0.12)'
                  : currentStain.id === 'sybr'
                  ? 'rgba(34, 197, 94, 0.12)'
                  : currentStain.id === 'gelred'
                  ? 'rgba(244, 63, 94, 0.12)'
                  : 'rgba(148, 163, 184, 0.1)'
              }
            />
            <stop
              offset="60%"
              stopColor={
                currentStain.isDark
                  ? 'rgba(99, 102, 241, 0.03)'
                  : 'transparent'
              }
            />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Gel Slab Cassette Frame */}
        <rect
          x={lay.frameLeft}
          y={lay.frameTop}
          width={gelAt(lay.frameRight - lay.frameLeft)}
          height={lay.frameBottom - lay.frameTop}
          rx={8}
          fill={currentStain.gelBg}
          stroke={currentStain.gelBorder}
          strokeWidth={1.5}
        />

        {/* UV Transilluminator Ambient Illumination */}
        {currentStain.isDark && (
          <rect
            x={lay.frameLeft}
            y={lay.frameTop}
            width={gelAt(lay.frameRight - lay.frameLeft)}
            height={lay.frameBottom - lay.frameTop}
            rx={8}
            fill="url(#uv-radial-glow)"
          />
        )}

        {/* Run direction, down the gel's left margin */}
        <text
          x={lay.runX}
          y={gelAt((lay.bandTop + lay.bandBottom) / 2)}
          fontSize={L}
          fontWeight={600}
          fill={currentStain.isDark ? '#475569' : '#94a3b8'}
          transform={`rotate(-90 ${lay.runX} ${gelAt((lay.bandTop + lay.bandBottom) / 2)})`}
          textAnchor="middle"
          letterSpacing="1.5"
        >
          RUN DIRECTION ▶
        </text>

        {/* Lane Running Tracks */}
        {gelShowLaneTracks &&
          lay.lanes.map((lane) => (
            <rect
              key={`track-${lane.id}`}
              x={lane.x}
              y={lay.wellBottom}
              width={lane.width}
              height={gelAt(lay.dyeY + 8 - lay.wellBottom)}
              fill={currentStain.laneTrack}
            />
          ))}

        {/* 3D Recessed Comb Loading Wells, each numbered (the key beside the gel names the lane) */}
        {lay.lanes.map((lane) => (
          <g key={`well-${lane.id}`}>
            {/* Well cavity */}
            <rect
              x={lane.x}
              y={lay.wellTop}
              width={lane.width}
              height={10}
              rx={2}
              fill={currentStain.wellCavity}
              stroke={currentStain.wellStroke}
              strokeWidth={1}
            />
            {/* Well top rim highlight */}
            <line
              x1={lane.x + 2}
              y1={lay.wellTop + 1}
              x2={lane.x + lane.width - 2}
              y2={lay.wellTop + 1}
              stroke={currentStain.wellRim}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {/* Well bottom shadow */}
            <line
              x1={lane.x + 2}
              y1={lay.wellBottom - 1}
              x2={lane.x + lane.width - 2}
              y2={lay.wellBottom - 1}
              stroke="#000000"
              strokeWidth={1}
              opacity={0.6}
            />
            {/* Lane Number Badge */}
            <rect
              x={gelAt(lane.x + lane.width / 2 - lay.badgeWidth / 2)}
              y={lay.badgeTop}
              width={lay.badgeWidth}
              height={lay.badgeHeight}
              rx={3}
              fill={badgeFill}
              stroke={badgeStroke}
              strokeWidth={0.8}
            />
            <text
              x={gelAt(lane.x + lane.width / 2)}
              y={lay.badgeBaseline}
              textAnchor="middle"
              fontSize={L}
              fontWeight={700}
              fill={badgeText}
            >
              {lane.laneIndex}
            </text>
          </g>
        ))}

        {/* Size Ladder Marks & Tick Lines (left margin) */}
        {gelShowMwLabels &&
          virtualGelAndFragments.ladderBands.map((bp) => {
            const y = gelAt(lay.sizeToY(bp));
            const isLandmark = bp === 1000 || bp === 500 || bp === 3000;
            return (
              <g key={`mw-tick-${bp}`}>
                <line
                  x1={lay.ladderX + 4}
                  y1={y}
                  x2={lay.ladderX + 9}
                  y2={y}
                  stroke={currentStain.isDark ? '#475569' : '#94a3b8'}
                  strokeWidth={1}
                />
                {lay.labelledLadder.has(bp) && (
                  <text
                    x={lay.ladderX}
                    y={gelAt(y + L * 0.35)}
                    textAnchor="end"
                    fontSize={L}
                    fontFamily="var(--font-mono, monospace)"
                    fontWeight={isLandmark ? 700 : 500}
                    fill={isLandmark ? currentStain.wellText : currentStain.ladderText}
                  >
                    {bp.toLocaleString()}
                  </text>
                )}
              </g>
            );
          })}

        {/* Fluorescent DNA Bands */}
        {lay.lanes.map((lane) =>
          lane.bands.map((b) => {
            const y = gelAt(lay.sizeToY(b.sizeBp));
            const isLandmark = b.isLandmark ?? false;

            // Mass-dependent or uniform intensity calculation
            const massRatio = Math.max(0.2, Math.min(1.0, b.sizeBp / 2500));
            const intensity = gelBandIntensity === 'Uniform' ? 0.85 : massRatio;
            const baseOpacity = isLandmark ? 0.98 : 0.55 + intensity * 0.4;
            const bandHeight = isLandmark ? 4.2 : 3.0 + intensity * 1.5;
            const effectiveOpacity = Math.min(1.0, baseOpacity * (gelExposurePct / 100));

            return (
              <g
                key={b.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() =>
                  setHoveredBand({
                    id: b.id,
                    label: b.label,
                    sizeBp: b.sizeBp,
                    laneLabel: lane.label,
                    laneIndex: lane.laneIndex,
                    rf: gelRf(y, lay),
                    intensityPct: Math.round(intensity * 100),
                    enzyme: b.enzyme,
                    start: b.start,
                    end: b.end,
                  })
                }
                onMouseLeave={() => setHoveredBand(null)}
              >
                {/* Outer Glow Halo (Dark Stain Modes) */}
                {currentStain.isDark && (
                  <rect
                    x={lane.x + 2}
                    y={gelAt(y - bandHeight / 2)}
                    width={lane.width - 4}
                    height={bandHeight}
                    rx={1.5}
                    fill={currentStain.bandGlow}
                    filter={`url(#${currentStain.filterId})`}
                    opacity={effectiveOpacity * 0.85}
                  />
                )}

                {/* Main Band Body */}
                <rect
                  x={lane.x + 2}
                  y={gelAt(y - bandHeight / 2)}
                  width={lane.width - 4}
                  height={bandHeight}
                  rx={1.5}
                  fill={currentStain.isDark ? currentStain.bandBody : currentStain.bandCore}
                  opacity={effectiveOpacity}
                />

                {/* Luminescent Specular Core */}
                {currentStain.isDark && (
                  <rect
                    x={lane.x + 6}
                    y={gelAt(y - 0.75)}
                    width={Math.max(0, lane.width - 12)}
                    height={1.5}
                    rx={0.75}
                    fill={currentStain.bandCore}
                    opacity={effectiveOpacity * (isLandmark ? 0.95 : 0.75)}
                  />
                )}

                {/* Interactive Selection Halo */}
                {hoveredId === b.id && (
                  <rect
                    x={lane.x - 1}
                    y={gelAt(y - bandHeight / 2 - 2)}
                    width={lane.width + 2}
                    height={bandHeight + 4}
                    rx={3}
                    fill="none"
                    stroke={currentStain.crosshairColor}
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                  />
                )}
              </g>
            );
          })
        )}

        {/* Loading Dye Front (Bromophenol Blue) */}
        {gelShowDyeFront && (
          <rect
            x={lay.frameLeft + 4}
            y={lay.dyeY}
            width={gelAt(lay.frameRight - lay.frameLeft - 8)}
            height={4.5}
            rx={2}
            fill={currentStain.dyeFront}
            opacity={currentStain.isDark ? 0.38 : 0.22}
            filter={currentStain.isDark ? `url(#${currentStain.filterId})` : undefined}
          />
        )}

        {/* Beside the gel: the cathode level with the wells, the key, then the dye front and anode marks */}
        <text x={lay.columnX} y={lay.cathodeBaseline} fontSize={L} fontWeight={700} fill={markFill} letterSpacing="0.5">
          (-) CATHODE
        </text>
        {gelShowLaneNames &&
          lay.lanes.map((lane, idx) => {
            const top = gelAt(lay.keyTop + idx * lay.keyRowHeight);
            const baseline = gelAt(top + lay.badgeHeight / 2 + L * 0.35);
            const name = lane.label.length > lay.keyMaxChars ? `${lane.label.slice(0, lay.keyMaxChars - 1)}…` : lane.label;
            return (
              <g key={`key-${lane.id}`} className="mbc-virtual-gel-key-row">
                <rect
                  x={lay.columnX}
                  y={top}
                  width={lay.badgeWidth}
                  height={lay.badgeHeight}
                  rx={3}
                  fill={badgeFill}
                  stroke={badgeStroke}
                  strokeWidth={0.8}
                />
                <text
                  x={gelAt(lay.columnX + lay.badgeWidth / 2)}
                  y={baseline}
                  textAnchor="middle"
                  fontSize={L}
                  fontWeight={700}
                  fill={badgeText}
                >
                  {lane.laneIndex}
                </text>
                <text x={lay.keyTextX} y={baseline} fontSize={L} fontWeight={600} fill={currentStain.wellText}>
                  {name}
                </text>
              </g>
            );
          })}
        {gelShowDyeFront && (
          <text x={lay.columnX} y={lay.dyeBaseline} fontSize={L} fontStyle="italic" fill={markFill}>
            Dye Front (BPB)
          </text>
        )}
        <text x={lay.columnX} y={lay.anodeBaseline} fontSize={L} fontWeight={700} fill={markFill} letterSpacing="0.5">
          (+) ANODE
        </text>
      </>
    );
  };
  gelDrawingRef.current = drawGel;

  const handleExportGelSvg = () => {
    // The file the figure's Export menu saves as SVG: the gel at full size, whatever the window.
    const svg = gelSvgElementRef.current;
    if (!svg) return;
    const { markup } = captureSvg(svg, { title: `Virtual gel — ${gelAgarosePct}% agarose in ${gelBufferType} buffer` });
    saveWorkbenchFile(`gel_${activeDoc.name}_${gelStainPreset}.svg`, markup, 'image/svg+xml;charset=utf-8');
  };

  const handleCopyFragmentsData = () => {
    const rows = [
      ['Lane', 'Sequence / Label', 'Size (bp)', 'Enzyme', 'Coordinates'].join('\t'),
      ...virtualGelLanes.flatMap((lane) =>
        lane.bands.map((b) =>
          [
            lane.laneIndex,
            lane.label,
            b.sizeBp,
            b.enzyme || 'None',
            b.start && b.end ? `${b.start}..${b.end}` : 'Full sequence',
          ].join('\t')
        )
      ),
    ].join('\n');
    navigator.clipboard.writeText(rows);
    setGelCopyNotice(true);
    setTimeout(() => setGelCopyNotice(false), 2000);
  };

  // Restriction cut sites across consensus for Restriction Analysis Inspector
  // ------------------------------------------------------------------
  // Alignment viewer: view model (full length, all settings honoured)
  // ------------------------------------------------------------------
  const [reverseComplementView, setReverseComplementView] = useState<boolean>(false);
  const [scrollRequest, setScrollRequest] = useState<{ col: number; nonce: number } | null>(null);
  const [fitNonce, setFitNonce] = useState<number>(0);
  const [predictedFeatures, setPredictedFeatures] = useState<Record<string, SequenceFeature[]>>({});

  useEffect(() => {
    setPredictedFeatures({});
    setReverseComplementView(false);
    setCursorCol(1);
    setSelectedRowIdx(0);
    setLiveAnnotateStatus('');
  }, [activeDoc.id]);

  // Keep the colour scheme valid for the molecule type.
  useEffect(() => {
    if (!isSchemeValidFor(colorScheme, alignmentStats.isProtein)) {
      setColorScheme(defaultColorScheme(alignmentStats.isProtein));
    }
  }, [alignmentStats.isProtein, colorScheme]);

  useEffect(() => {
    if (alignmentStats.isProtein && (distanceMetric === 'jc69' || distanceMetric === 'k2p')) {
      setDistanceMetric('p-dist');
    }
  }, [alignmentStats.isProtein, distanceMetric]);

  const colorSchemeOptions = useMemo(
    () => colorSchemesFor(alignmentStats.isProtein),
    [alignmentStats.isProtein]
  );

  const colorLegend = useMemo(() => {
    const letters = alignmentStats.isProtein
      ? 'ACDEFGHIKLMNPQRSTVWY'.split('')
      : ['A', 'C', 'G', 'T', 'N', 'R', 'Y'];
    return letters.map((ch) => ({
      ch,
      color: residueSolidColor(ch, {
        scheme: colorScheme,
        isProtein: alignmentStats.isProtein,
        refChar: ch,
        translatedAa: 'M',
      }),
    }));
  }, [colorScheme, alignmentStats.isProtein]);

  const colorLegendNote =
    colorScheme === 'Similarity'
      ? 'Grey = agrees with the highlighting reference, red = differs.'
      : colorScheme === 'By Annotation'
      ? 'Residues take the colour of the annotation covering them.'
      : colorScheme === 'By Direction'
      ? 'Blue = forward strand, orange = reverse strand.'
      : colorScheme === 'By Translation'
      ? 'Codons are coloured by the encoded amino acid (Zappo palette).'
      : colorScheme === 'Hydrophobicity'
      ? 'Red = hydrophobic, blue = hydrophilic (Kyte-Doolittle).'
      : colorScheme === 'Isoelectric Point'
      ? 'Red = acidic, blue = basic residue pI.'
      : '';

  /** Rows as displayed (optionally reverse-complemented), with predicted features merged in. */
  const viewRows = useMemo(() => {
    const rc = reverseComplementView && !alignmentStats.isProtein;
    return msaRes.rows.map((r) => {
      const extra = predictedFeatures[r.id] ?? [];
      const feats = [...r.features, ...extra];
      if (!rc) return { ...r, features: feats };
      const ungappedLen = r.alignedSeq.replace(/-/g, '').length;
      return {
        ...r,
        alignedSeq: reverseComplementAligned(r.alignedSeq),
        strand: (r.strand === -1 ? 1 : -1) as 1 | -1,
        features: feats.map((f) => ({
          ...f,
          start: ungappedLen - f.end + 1,
          end: ungappedLen - f.start + 1,
          strand: (f.strand === -1 ? 1 : -1) as 1 | -1,
          segments: f.segments?.map((segment) => ({
            ...segment,
            start: ungappedLen - segment.end + 1,
            end: ungappedLen - segment.start + 1,
          })).reverse(),
        })),
      };
    });
  }, [msaRes.rows, predictedFeatures, reverseComplementView, alignmentStats.isProtein]);

  const viewConsensus = useMemo(
    () =>
      reverseComplementView && !alignmentStats.isProtein
        ? reverseComplementAligned(msaRes.consensus)
        : msaRes.consensus,
    [msaRes.consensus, reverseComplementView, alignmentStats.isProtein]
  );
  const viewConservation = useMemo(
    () =>
      reverseComplementView && !alignmentStats.isProtein
        ? [...msaRes.conservation].reverse()
        : msaRes.conservation,
    [msaRes.conservation, reverseComplementView, alignmentStats.isProtein]
  );

  const viewVisibleCols = useMemo(
    () =>
      visibleColumns(
        viewRows.map((r) => r.alignedSeq),
        viewConsensus.length,
        hideGapSitesOverPct,
        gapSiteThresholdPct
      ),
    [viewRows, viewConsensus.length, hideGapSitesOverPct, gapSiteThresholdPct]
  );

  const highlightRefSeq =
    highlightRef === 'Reference' ? viewRows[0]?.alignedSeq ?? viewConsensus : viewConsensus;

  const canvasRows: AlignmentCanvasRow[] = useMemo(
    () =>
      viewRows.map((r, idx) => {
        const secondary = showSecondaryLabel
          ? secondaryLabelField === 'Organism'
            ? r.organism
            : secondaryLabelField === 'Accession'
            ? r.accession
            : r.description
          : '';
        const ungappedLen = alignmentStats.ungappedLengths[idx] ?? r.alignedSeq.replace(/-/g, '').length;
        let metric: string;
        if (isUnalignedSequenceList) {
          metric = `${ungappedLen.toLocaleString()} ${alignmentStats.unit}`;
        } else if (showDistancesInRow) {
          const isRef = highlightRef === 'Reference' && idx === 0;
          metric = isRef ? 'ref' : `${countDifferences(r.alignedSeq, highlightRefSeq)} diff`;
        } else {
          metric = `${r.identityToConsensusPct}%`;
        }
        return {
          id: r.id,
          label: `${showSeqNumbers ? `${idx + 1}. ` : ''}${showNames ? r.name : r.accession || r.id}`,
          secondary: secondary ? `(${secondary})` : '',
          metric,
          title: `${r.name}${r.description ? ` — ${r.description}` : ''} · ${ungappedLen.toLocaleString()} ${alignmentStats.unit} ${isUnalignedSequenceList ? '' : ` · ${r.identityToConsensusPct}% identity to consensus`}`,
          alignedSeq: r.alignedSeq,
          strand: r.strand,
          features: r.features,
        };
      }),
    [
      viewRows, showSecondaryLabel, secondaryLabelField, alignmentStats.ungappedLengths, alignmentStats.unit,
      isUnalignedSequenceList, showDistancesInRow, highlightRef, highlightRefSeq, showSeqNumbers, showNames,
    ]
  );

  // Restriction enzymes (real REBASE catalogue, filtered)
  const enzymeSetOptions = useMemo(() => {
    const coreLen = (e: { recognitionSeq: string }) => e.recognitionSeq.replace(/N/gi, '').length;
    const commercial = REBASE_ENZYMES.filter((e) => (e.suppliers?.length ?? 0) > 0);
    return [
      { id: 'commercial-6', label: 'Commercial six+ cutters', enzymes: commercial.filter((e) => coreLen(e) >= 6) },
      { id: 'commercial', label: 'All commercial', enzymes: commercial },
      { id: 'all', label: 'All REBASE (catalogue)', enzymes: REBASE_ENZYMES },
    ];
  }, []);
  const activeEnzymes =
    enzymeSetOptions.find((o) => o.id === candidateEnzymeSet)?.enzymes ?? enzymeSetOptions[0].enzymes;

  const consensusRestrictionHits = useMemo(
    () => (alignmentStats.isProtein ? [] : findRestrictionSitesAligned(viewConsensus, activeEnzymes)),
    [alignmentStats.isProtein, viewConsensus, activeEnzymes]
  );
  const consensusCutterSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of consensusRestrictionHits) counts.set(h.enzyme, (counts.get(h.enzyme) ?? 0) + 1);
    const single = [...counts.values()].filter((n) => n === 1).length;
    return counts.size ? `${counts.size} enzymes, ${single} single cutters` : '';
  }, [consensusRestrictionHits]);

  const [navMessage, setNavMessage] = useState<string>('');
  const goToColumn = (col: number) => {
    const c = Math.max(1, Math.min(viewConsensus.length || 1, col));
    setCursorCol(c);
    setScrollRequest({ col: c, nonce: Date.now() });
  };

  const goToDisagreement = (direction: 1 | -1) => {
    const row = viewRows[selectedRowIdx]?.alignedSeq ?? '';
    const ref =
      highlightRef === 'Reference' && selectedRowIdx !== 0
        ? viewRows[0]?.alignedSeq ?? viewConsensus
        : viewConsensus;
    const next = findDisagreement(row, ref, cursorCol, direction);
    if (next === null) {
      setNavMessage(direction === 1 ? 'No further disagreements.' : 'No earlier disagreements.');
      return;
    }
    setNavMessage('');
    goToColumn(next);
  };

  // Predicted annotations ----------------------------------------------------
  const predictedFeatureCount = useMemo(
    () => Object.values(predictedFeatures).reduce((n, list) => n + list.length, 0),
    [predictedFeatures]
  );
  const canPersistAnnotations =
    !!onUpdateDocument && (activeDoc.alignmentMeta?.sequences?.length ?? 0) > 0;

  const runFindOrfs = () => {
    const starts = findOrfsStartCodons.split(/[\s,;]+/).filter(Boolean);
    const next: Record<string, SequenceFeature[]> = { ...predictedFeatures };
    let total = 0;
    msaRes.rows.forEach((r) => {
      const ungapped = r.alignedSeq.replace(/-/g, '');
      const orfs = findOrfsInSequence(ungapped, findOrfsMinSize, starts, findOrfsGeneticCode);
      const kept = (next[r.id] ?? []).filter((f) => f.qualifiers?.source !== 'Find ORFs');
      next[r.id] = [
        ...kept,
        ...orfs.map((o, k) => ({
          id: `orf-${r.id}-${k}`,
          name: `ORF ${Math.floor(o.lengthBp / 3) - 1} aa`,
          type: 'CDS' as const,
          start: o.start,
          end: o.end,
          strand: o.strand,
          color: '#f59e0b',
          qualifiers: { source: 'Find ORFs', note: `${o.lengthBp} bp, ${findOrfsGeneticCode}` },
        })),
      ];
      total += orfs.length;
    });
    setPredictedFeatures(next);
    setShowAnnotations(true);
    setLiveAnnotateStatus(
      `Found ${total} ORF(s) ≥ ${findOrfsMinSize} bp across ${msaRes.rows.length} sequences (both strands).`
    );
  };

  const runTransferAnnotations = () => {
    const aligned = msaRes.rows.map((r) => r.alignedSeq);
    const feats = msaRes.rows.map((r) => [...r.features, ...(predictedFeatures[r.id] ?? [])]);
    const sources =
      annotateFromSource === 'All Sequences'
        ? feats.map((f, i) => (f.length ? i : -1)).filter((i) => i >= 0)
        : [0];
    const out = transferAnnotations(
      aligned,
      feats.map((list) => list.map((f) => ({ ...f, type: String(f.type) }))),
      sources,
      transferSimPct
    );
    let total = 0;
    const next: Record<string, SequenceFeature[]> = { ...predictedFeatures };
    out.forEach((list, ti) => {
      const id = msaRes.rows[ti].id;
      const orig = new Map(feats.flat().map((f) => [f.id, f]));
      next[id] = [
        ...(next[id] ?? []),
        ...list.map((f) => {
          const src = orig.get(f.id.split('-xfer-')[0]);
          return {
            ...(src ?? ({} as SequenceFeature)),
            id: f.id,
            name: f.name,
            start: f.start,
            end: f.end,
            strand: f.strand,
            color: f.color,
            type: (src?.type ?? 'misc_feature') as SequenceFeature['type'],
            qualifiers: { ...(src?.qualifiers ?? {}), source: 'Transferred' },
          };
        }),
      ];
      total += list.length;
    });
    setPredictedFeatures(next);
    setShowAnnotations(true);
    setLiveAnnotateStatus(
      total
        ? `Transferred ${total} annotation(s) at ≥ ${transferSimPct}% identity.`
        : `No annotations met the ${transferSimPct}% identity threshold (or none to transfer).`
    );
  };

  const savePredictedFeatures = () => {
    const members = activeDoc.alignmentMeta?.sequences;
    if (!onUpdateDocument || !members) return;
    onUpdateDocument({
      ...activeDoc,
      alignmentMeta: {
        ...activeDoc.alignmentMeta,
        sequences: members.map((m) => ({
          ...m,
          features: [...(m.features ?? []), ...(predictedFeatures[m.id] ?? [])],
        })),
      },
    });
    setLiveAnnotateStatus(`Saved ${predictedFeatureCount} annotation(s) to ${activeDoc.name}.`);
    setPredictedFeatures({});
  };

  const traceEntries: TraceEntry[] = useMemo(() => {
    const pool = [activeDoc, ...documents, ...projectDocuments];
    const out: TraceEntry[] = [];
    const seen = new Set<string>();
    const add = (id: string, name: string, reversed: boolean) => {
      const base = name.replace(/\s*\(revers(ed|e)\)\s*$/i, '').trim();
      const doc = pool.find((d) => d.chromatogram && (d.id === id || d.name === name || d.name === base));
      if (!doc?.chromatogram || seen.has(doc.id)) return;
      seen.add(doc.id);
      out.push({ id: doc.id, name: doc.name, chromatogram: doc.chromatogram, reversed });
    };
    if (activeDoc.chromatogram) add(activeDoc.id, activeDoc.name, false);
    for (const r of msaRes.rows) add(r.id, r.name, r.strand === -1);
    return out;
  }, [activeDoc, documents, projectDocuments, msaRes.rows]);

  const coverageStats = useMemo(() => {
    const n = viewConsensus.length;
    if (!n) return { min: 0, max: 0, mean: '0', gapFree: 0, gapFreePct: '0' };
    let min = Infinity;
    let max = 0;
    let sum = 0;
    let gapFree = 0;
    for (let c = 0; c < n; c++) {
      let k = 0;
      for (const r of viewRows) if ((r.alignedSeq[c] ?? '-') !== '-') k++;
      min = Math.min(min, k);
      max = Math.max(max, k);
      sum += k;
      if (k === viewRows.length) gapFree++;
    }
    return {
      min,
      max,
      mean: (sum / n).toFixed(2),
      gapFree,
      gapFreePct: ((gapFree / n) * 100).toFixed(1),
    };
  }, [viewRows, viewConsensus.length]);

  const canvasSettings: AlignmentCanvasSettings = {
    colorScheme,
    isProtein: alignmentStats.isProtein,
    showLetters: showNucleotides,
    // Consensus and identity are meaningless for an unaligned sequence list.
    showConsensus: showConsensus && !isUnalignedSequenceList,
    consensusLabel: alignmentConsensusLabel(consensusThreshold),
    showHighlighting,
    highlightMode,
    highlightRef,
    useDotsForAgreements,
    showComplement,
    showTranslation,
    translationFrame,
    geneticCode: translationGeneticCode,
    threeLetterAminoAcids,
    showAminoAcidNumbering,
    showAnnotations,
    hiddenAnnotationTypes,
    annotationFilter: annotationFilterQuery,
    annotationLabels: (advAnnLabelsPos as 'Inside' | 'Above' | 'None') ?? 'Inside',
    annotationArrowTips: advAnnShowArrowTips,
    annotationHideExcessiveLabels: advAnnHideExcessiveLabels,
    annotationCompress: advAnnCompress,
    annotationLabelSize: advSizeAnnLabels,
    annotationThickness: advSizeAnnThickness,
    showGraphs,
    graphCoverage: showCoverageGraph,
    coverageLogScale,
    coverageHighlightGapped: coverageHighlightBelow,
    graphIdentity: showIdentityGraph && !isUnalignedSequenceList,
    identityWindow: identityWindowSize,
    graphGc: showGcGraph,
    graphAt: showAtGraph,
    gcWindow: gcWindowSize,
    graphFramePlot: showFramePlot,
    graphLogo: showSequenceLogo,
    graphHydrophobicity: showHydrophobicityGraph,
    hydrophobicityWindow: hydrophobicityWindowSize,
    graphPi: showPiGraph,
    piWindow: piWindowSize,
    restrictionSites:
      showRestrictionSites && !alignmentStats.isProtein
        ? consensusRestrictionHits.map((h) => ({ col: h.col, enzyme: h.enzyme }))
        : null,
    highlightDam,
    highlightDcm,
    wrap: wrapAlignment,
    visibleCols: viewVisibleCols,
    spacesEvery: spacesEveryNBases,
    numbering: (advNumbering as 'Standard' | 'From 0' | 'No gaps') ?? 'Standard',
    miniMap: advMiniMap,
    outlineZoomedOut: advOutlineZoomedOut,
    showSequenceIcons,
    nameFontSize: advSizeSeqNames,
    numberFontSize: advSizeBaseNumbers,
    letterFontSize: advSize100Pct,
    zoomedOutRowHeight: advSizeZoomedOut,
  };

  const downloadText = (filename: string, content: string, mime = 'text/plain') => {
    saveWorkbenchFile(filename, content, `${mime};charset=utf-8`);
  };
  const safeFileBase = activeDoc.name.replace(/[^\w.-]+/g, '_');

  const distanceMatrix = useMemo(() => {
    const MAX = 150;
    // Padded unaligned sequences are not homologous columns: no distances until aligned.
    const rows = isUnalignedSequenceList ? [] : alignmentRows.slice(0, MAX);
    const values = rows.map((a) =>
      rows.map((b) => (a === b ? 0 : computeNonEndGapPairwiseMetric(a.sequence, b.sequence, distanceMetric)))
    );
    let min = Infinity;
    let max = -Infinity;
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        if (i === j) return;
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      })
    );
    return {
      names: rows.map((r) => r.name),
      values,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      truncated: !isUnalignedSequenceList && alignmentRows.length > MAX,
      // the alignment's sequences, every one, which the matrix is cut from (none until aligned)
      total: isUnalignedSequenceList ? 0 : alignmentRows.length,
    };
  }, [alignmentRows, distanceMetric, isUnalignedSequenceList]);
  // What the matrix leaves out, shown beside it and written as the exported TSV's first line (BG-01M6S1AA).
  const distanceMatrixLeftOut = rowsLeftOut(distanceMatrix.names.length, distanceMatrix.total, 'sequences', 'The matrix lists');

  const formatDistance = (v: number) =>
    Number.isNaN(v) ? 'N/A' : !Number.isFinite(v) ? '∞' : distanceMetric === 'diffs'
      ? String(Math.round(v))
      : `${v.toFixed(distanceDecimals)}${distanceMetric === 'identity' ? '%' : ''}`;

  const exportDistanceMatrix = () => {
    const header = ['', ...distanceMatrix.names].join('\t');
    const lines = distanceMatrix.names.map((n, i) =>
      [n, ...distanceMatrix.values[i].map((v, j) => (i === j ? '' : formatDistance(v)))].join('\t')
    );
    // a capped matrix opens with a comment line that says how many of the sequences it holds
    const note = distanceMatrixLeftOut.map((s) => `# ${s}`);
    downloadText(`${safeFileBase}_${distanceMetric}_matrix.tsv`, [...note, header, ...lines].join('\n'), 'text/tab-separated-values');
  };

  const exportAnnotationsTable = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['Name', 'Sequence', 'Type', 'Minimum', 'Maximum', 'Length', 'Intervals', 'Direction', 'Track'];
    const lines = filteredAnnotationsForTable.map((a) =>
      [a.name, a.seqName, a.type, a.min, a.max, a.length, a.intervalsCount, a.direction, a.track].map(esc).join(',')
    );
    downloadText(`${safeFileBase}_annotations.csv`, [header.map(esc).join(','), ...lines].join('\n'), 'text/csv');
  };

  const INSPECTOR_TABS: {
    id: AlignmentInspectorTab;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: 'general', label: 'General', icon: <Settings size={15} strokeWidth={1.8} /> },
    { id: 'display', label: 'Display', icon: <span className="mbc-rail-font-icon" aria-hidden="true">Aa</span> },
    { id: 'graphs', label: 'Graphs', icon: <BarChart2 size={15} strokeWidth={1.8} /> },
    { id: 'annotations-tracks', label: 'Annotations and Tracks', icon: <Tag size={15} strokeWidth={1.8} /> },
    { id: 'live-annotate', label: 'Live Annotate & Predict', icon: <Zap size={15} strokeWidth={1.8} /> },
    { id: 'restriction', label: 'Restriction Analysis', icon: <Scissors size={15} strokeWidth={1.8} /> },
    { id: 'advanced', label: 'Advanced', icon: <Wrench size={15} strokeWidth={1.8} /> },
    { id: 'statistics', label: 'Statistics', icon: <Sigma size={15} strokeWidth={1.8} /> },
    // The analyses: panels beside the grid rather than views in place of it.
    { id: 'member-annotations', label: 'Member Annotations', icon: <TableProperties size={15} strokeWidth={1.8} /> },
    { id: 'distances', label: 'Substitution Distances', icon: <Grid3x3 size={15} strokeWidth={1.8} /> },
    { id: 'lengths-graph', label: 'Lengths Graph', icon: <Ruler size={15} strokeWidth={1.8} /> },
    ...(alignmentStats.isProtein
      ? []
      : [
          { id: 'virtual-gel' as const, label: 'Virtual Gel', icon: <Columns4 size={15} strokeWidth={1.8} /> },
          { id: 'fragments' as const, label: 'Fragments', icon: <Puzzle size={15} strokeWidth={1.8} /> },
        ]),
  ];
  // A panel this alignment does not offer (the gel of a protein alignment) falls back to General.
  const shownInspectorTab: AlignmentInspectorTab = INSPECTOR_TABS.some((t) => t.id === inspectorTab)
    ? inspectorTab
    : 'general';
  const inspectorShowsAnalysis = ANALYSIS_PANELS.includes(shownInspectorTab);

  // Contig, trace and read documents draw their traces and read QC as views of the MSA mode, so
  // they sit on the mode strip. A read list shows the Chromatogram only when it has traces.
  const offersChromatogram =
    (isSangerTraceDoc || isContigAssemblyDoc || isContigFolderDoc) &&
    (traceEntries.length > 0 || !isNgsReadListDoc);
  const offersQcReport = isNgsReadListDoc || isContigFolderDoc;
  const shownMsaFigure: AlignmentMsaFigure =
    (msaFigure === 'chromatogram' && !offersChromatogram) || (msaFigure === 'qc-report' && !offersQcReport)
      ? 'grid'
      : msaFigure;
  const studioMode = alignSubMode === 'msa' && shownMsaFigure !== 'grid' ? shownMsaFigure : alignSubMode;
  // US-01M6TA6T: the MSA grid keeps its own inspector, the side panel, its handle and the rail
  // (D0060). In the workbench it claims the inspector while the grid shows, so App's button,
  // Cmd/Ctrl+Alt+I and View > Panels > Inspector open and close it, and App draws no column of its
  // own; the traces and read QC views claim nothing. Drawn outside the workbench, it is always open.
  const ownInspectorOpen = useOwnInspector(alignSubMode === 'msa' && shownMsaFigure === 'grid');
  // US-01M6TAA4: Pairwise Alignment's method, matrix and scores are settings, so in the workbench
  // each group is a section of App's inspector, while the sequences it compares stay beside the
  // result. Drawn on its own, each group is the fieldset beside the sequences it always was.
  const inWorkbench = useInWorkbench();
  const pairwiseSettings = (legend: string, order: number, body: React.ReactNode) => (
    <InspectorSection title={legend} order={order}>
      {inWorkbench ? body : (
        <fieldset className="mbc-pw-fieldset">
          <legend>{legend}</legend>
          {body}
        </fieldset>
      )}
    </InspectorSection>
  );
  const chooseMode = (mode: AlignmentSubMode, figure: AlignmentMsaFigure = 'grid') => {
    setAlignSubMode(mode);
    setMsaFigure(figure);
  };

  // Dotplot mode: a document that carries members (an alignment, contig or sequence list) is drawn
  // from those members; anything else from the documents the studio was opened on (the selected
  // sequences) of the same molecule type.
  const dotplotSequences = hasEmbeddedMembers
    ? viewRows.map((r) => ({ id: r.id, name: r.name, alignedSeq: r.alignedSeq, features: r.features }))
    : documents
        .filter((d) => (d.moleculeType === 'Protein') === (activeDoc.moleculeType === 'Protein'))
        .map((d) => ({ id: d.id, name: d.name, alignedSeq: d.sequence, features: d.features }));

  return (
    <div className="alignment-studio-wrapper">
      <div className="studio-card">
        {alignSubMode === 'msa' && msaExecution.error && (
          <div className="mbc-aln-empty" role="alert">{msaExecution.error}</div>
        )}
        <div className="studio-card-header mbc-studio-aln-header">
          <ScrollableMenuStrip
            className="mbc-scroll-strip--pills"
            trackClassName="cloning-method-tabs"
            role="tablist"
            ariaLabel="Sequence Alignment Modes"
            activeKey={studioMode}
            enableSpatialArrowNav
            activateOnSpatialFocus
            prevAriaLabel="Slide alignment modes left"
            nextAriaLabel="Slide alignment modes right"
          >
            <button
              type="button"
              role="tab"
              tabIndex={studioMode === 'msa' ? 0 : -1}
              aria-selected={studioMode === 'msa'}
              className={`method-tab-btn ${studioMode === 'msa' ? 'active' : ''}`}
              onClick={() => chooseMode('msa')}
            >
              <MolBioMenuGlyph glyph="align-msa" size={13} />
              <span>Multiple Sequence Alignment (MSA)</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={studioMode === 'pairwise' ? 0 : -1}
              aria-selected={studioMode === 'pairwise'}
              className={`method-tab-btn ${studioMode === 'pairwise' ? 'active' : ''}`}
              title="Pairwise Alignment (Needleman-Wunsch / Smith-Waterman)"
              onClick={() => chooseMode('pairwise')}
            >
              <MolBioMenuGlyph glyph="align-pairwise" size={13} />
              <span>Pairwise Alignment</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={studioMode === 'dotplot' ? 0 : -1}
              aria-selected={studioMode === 'dotplot'}
              className={`method-tab-btn ${studioMode === 'dotplot' ? 'active' : ''}`}
              title="EMBOSS K-mer Dotplot"
              onClick={() => chooseMode('dotplot')}
            >
              <MolBioMenuGlyph glyph="dotplot" size={13} />
              <span>Dotplot</span>
            </button>
            {offersChromatogram && (
              <button
                type="button"
                role="tab"
                tabIndex={studioMode === 'chromatogram' ? 0 : -1}
                aria-selected={studioMode === 'chromatogram'}
                className={`method-tab-btn ${studioMode === 'chromatogram' ? 'active' : ''}`}
                title="Base-call traces of the reads"
                onClick={() => chooseMode('msa', 'chromatogram')}
              >
                <MolBioMenuGlyph glyph="import-sanger" size={13} />
                <span>Chromatogram</span>
              </button>
            )}
            {offersQcReport && (
              <button
                type="button"
                role="tab"
                tabIndex={studioMode === 'qc-report' ? 0 : -1}
                aria-selected={studioMode === 'qc-report'}
                className={`method-tab-btn ${studioMode === 'qc-report' ? 'active' : ''}`}
                title="Quality report computed from the reads"
                onClick={() => chooseMode('msa', 'qc-report')}
              >
                <MolBioMenuGlyph glyph="trim-reads" size={13} />
                <span>QC Report</span>
              </button>
            )}
          </ScrollableMenuStrip>
          <div className="cloning-action-row">
            {onGenerateConsensus && (
              <button
                type="button"
                className="btn-secondary-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                disabled={!dynamicConsensus.length || isUnalignedSequenceList || !!msaExecution.error}
                title="Extract Consensus Sequence"
                onClick={() => onGenerateConsensus(dynamicConsensus)}
              >
                <MolBioMenuGlyph glyph="consensus" size={13} />
                <span>Extract Consensus</span>
              </button>
            )}
          </div>
        </div>

        {alignSubMode === 'msa' && (
          <div className="mbc-aln-workbench">
            {/* Unaligned list notice banner */}
            {isUnalignedSequenceList && shownMsaFigure === 'grid' && (
              <div className="mbc-aln-unaligned-banner" role="region" aria-label="Unaligned Sequence Notice">
                <div className="mbc-aln-unaligned-info">
                  <span className="mbc-aln-unaligned-badge">Unaligned list</span>
                  <span className="mbc-aln-unaligned-meta">
                    <strong>{activeDoc.name}</strong> • {msaRes.rows.length} sequences
                  </span>
                  <span className="mbc-aln-unaligned-hint">
                    Sequences are unaligned. Run Multiple Sequence Alignment to compute homology matrix and consensus.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary-sm mbc-aln-run-btn"
                  onClick={() => setForceRunMsaOnList(true)}
                >
                  <MolBioMenuGlyph glyph="align-msa" size={12} />
                  <span>Run MSA Alignment</span>
                </button>
              </div>
            )}

            {msaCommandNotice && shownMsaFigure === 'grid' && (
              <div className="info-callout" role="status" style={{ margin: '6px 0' }}>
                {msaCommandNotice}
              </div>
            )}

            {/* What the engine left out of this alignment (D0005), above the grid it describes */}
            {shownMsaFigure === 'grid' && (
              <ResultWarnings warnings={fallbackMsaRes.warnings} label="Alignment warnings" />
            )}

            {/* The alignment (or contig) grid, with the inspector and its rail beside it */}
            {shownMsaFigure === 'grid' && (
              <>
                {/* Alignment Action & Zoom Toolbar */}
                <div className="mbc-aln-action-toolbar">
                  <div className="mbc-aln-toolbar-left">
                    <div className="mbc-aln-btn-group" role="group" aria-label="Disagreement navigation">
                      <button
                        type="button"
                        className="mbc-aln-tool-btn mbc-aln-group-left"
                        title={`Previous disagreement of the selected sequence vs ${highlightRef.toLowerCase()}`}
                        aria-label="Previous disagreement"
                        onClick={() => goToDisagreement(-1)}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="mbc-aln-tool-btn mbc-aln-group-right"
                        title={`Next disagreement of the selected sequence vs ${highlightRef.toLowerCase()}`}
                        aria-label="Next disagreement"
                        onClick={() => goToDisagreement(1)}
                      >
                        →
                      </button>
                    </div>
                    <span className="mbc-aln-toolbar-sep" />
                    {onGenerateConsensus && (
                      <button
                        type="button"
                        className="mbc-aln-tool-btn"
                        title="Extract the consensus sequence as a new document"
                        disabled={!dynamicConsensus.length || isUnalignedSequenceList || !!msaExecution.error}
                        onClick={() => onGenerateConsensus(dynamicConsensus)}
                      >
                        Extract
                      </button>
                    )}
                    {!alignmentStats.isProtein && (
                      <>
                        <button
                          type="button"
                          className={`mbc-aln-tool-btn ${reverseComplementView ? 'active' : ''}`}
                          title="View the reverse complement of the whole alignment"
                          aria-pressed={reverseComplementView}
                          onClick={() => setReverseComplementView((v) => !v)}
                        >
                          R.C.
                        </button>
                        <button
                          type="button"
                          className={`mbc-aln-tool-btn ${showTranslation ? 'active' : ''}`}
                          title="Translate sequence"
                          aria-pressed={showTranslation}
                          onClick={() => setShowTranslation((v) => !v)}
                        >
                          Translate
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={`mbc-aln-tool-btn ${inspectorTab === 'annotations-tracks' ? 'active' : ''}`}
                      onClick={() => setInspectorTab('annotations-tracks')}
                    >
                      Annotations
                    </button>
                    <button
                      type="button"
                      className={`mbc-aln-tool-btn ${inspectorTab === 'live-annotate' ? 'active' : ''}`}
                      onClick={() => setInspectorTab('live-annotate')}
                    >
                      Annotate &amp; Predict
                    </button>
                    {(!hasEmbeddedMembers || activeDoc.alignmentMeta?.isAligned === false) && (
                      <label className="mbc-aln-inline-select" title="Multiple Sequence Aligner">
                        <select
                          value={msaAlgorithm}
                          onChange={(e) => setMsaAlgorithm(toStudioMsaPresetId(e.target.value))}
                        >
                          {(Object.keys(MSA_PRESET_INFO) as StudioMsaPresetId[]).map((key) => (
                            <option key={key} value={key} title={MSA_PRESET_INFO[key].detail}>
                              {MSA_PRESET_INFO[key].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {activeDoc.alignmentMeta?.isAligned && (
                      <span className="mbc-aln-doc-stat-pill" title={`${msaRes.rows.length} sequences, ${msaRes.consensus.length} columns`}>
                        {msaRes.rows.length} seqs • {msaRes.consensus.length} cols
                      </span>
                    )}
                    {navMessage && (
                      <span className="mbc-aln-nav-msg" role="status">
                        {navMessage}
                      </span>
                    )}
                  </div>
                  <div className="mbc-aln-toolbar-right">
                    <div className="mbc-aln-zoom-stepper" role="group" aria-label="Zoom controls">
                      <button
                        type="button"
                        className="mbc-aln-stepper-btn"
                        title="Zoom out"
                        aria-label="Zoom out"
                        onClick={() => setZoomPct((z) => Math.max(0.5, Math.round((z / 1.25) * 10) / 10))}
                      >
                        −
                      </button>
                      <div className="mbc-aln-stepper-input-wrap">
                        <input
                          type="number"
                          className="mbc-aln-zoom-input"
                          min={0.5}
                          max={400}
                          step="any"
                          value={zoomPct}
                          onChange={(e) =>
                            setZoomPct(Math.max(0.5, Math.min(400, Number(e.target.value) || 100)))
                          }
                          aria-label="Zoom Percentage"
                        />
                        <span className="mbc-aln-zoom-unit">%</span>
                      </div>
                      <button
                        type="button"
                        className="mbc-aln-stepper-btn"
                        title="Zoom in"
                        aria-label="Zoom in"
                        onClick={() => setZoomPct((z) => Math.min(400, Math.round(z * 1.25 * 10) / 10))}
                      >
                        +
                      </button>
                    </div>

                    <div className="mbc-aln-btn-group" role="group" aria-label="View presets">
                      <button
                        type="button"
                        className={`mbc-aln-tool-btn mbc-aln-group-left ${zoomPct === 100 ? 'active' : ''}`}
                        title="Zoom to 100% (residue letters visible)"
                        onClick={() => setZoomPct(100)}
                      >
                        100%
                      </button>
                      <button
                        type="button"
                        className="mbc-aln-tool-btn mbc-aln-group-mid"
                        title="Scroll to the cursor column"
                        onClick={() => goToColumn(cursorCol)}
                      >
                        Cursor
                      </button>
                      <button
                        type="button"
                        className="mbc-aln-tool-btn mbc-aln-group-right"
                        title="Fit the whole alignment width in the window"
                        onClick={() => setFitNonce((n) => n + 1)}
                      >
                        Fit
                      </button>
                    </div>
                  </div>
                </div>

                {!isUnalignedSequenceList && msaRes.rows.length > 0 && (
                  <div className="mbc-msa-summary" aria-label="Alignment summary">
                    {[
                      ['Sequences', alignmentStats.seqCount.toLocaleString()],
                      ['Columns', alignmentStats.colCount.toLocaleString()],
                      ['Identical sites', `${alignmentStats.identicalSitesPct}%`],
                      ['Pairwise identity', formatPairwiseIdentityPct(alignmentStats.pairwiseIdentityPct, alignmentStats.pairwiseIdentityPairs)],
                      ['Gap-free columns', `${coverageStats.gapFreePct}%`],
                      ['Mean length', `${alignmentStats.meanLen} ${alignmentStats.unit}`],
                    ].map(([label, value]) => (
                      <div key={label} className="mbc-msa-chip">
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                    {(!hasEmbeddedMembers || forceRunMsaOnList) && (
                      <div className="mbc-msa-chip is-engine" title={MSA_PRESET_INFO[msaAlgorithm]?.detail}>
                        <span>Built-in aligner (strategy, not the external program)</span>
                        <strong>{MSA_PRESET_INFO[msaAlgorithm]?.label ?? msaAlgorithm}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Split Canvas + Right Inspector + Vertical Icon Rail */}
                <div
                  ref={splitLayoutRef}
                  className={`mbc-aln-split-layout${paneDragging ? ' is-resizing' : ''}`}
                >
                  <div className="mbc-aln-canvas-pane">
                    <AlignmentCanvas
                      rows={canvasRows}
                      consensus={viewConsensus}
                      conservation={viewConservation}
                      settings={canvasSettings}
                      zoomPct={zoomPct}
                      cursorCol={cursorCol}
                      selectedRowIdx={selectedRowIdx}
                      onCursorChange={setCursorCol}
                      onSelectRow={setSelectedRowIdx}
                      scrollRequest={scrollRequest}
                      fitRequestNonce={fitNonce}
                      onRequestZoom={setZoomPct}
                      nameColumnWidthPx={nameColumnPx}
                      nameColumnHandle={
                        <div
                          role="separator"
                          aria-label="Resize the sequence name and identity column"
                          aria-orientation="vertical"
                          aria-valuenow={nameColumnPx}
                          aria-valuemin={ALN_NAME_COLUMN_MIN_PX}
                          aria-valuemax={nameColumnMaxPx}
                          aria-valuetext={`${nameColumnPx} pixels wide`}
                          tabIndex={0}
                          className={`mbc-aln-name-resizer${paneDragging === 'name-column' ? ' dragging' : ''}`}
                          title="Drag or press Left/Right Arrow keys to resize the name and identity column • Double-click to reset"
                          onPointerDown={(e) => startPaneDrag(e, 'name-column')}
                          onKeyDown={(e) => onPaneHandleKey(e, 'name-column')}
                          onDoubleClick={() => resetPaneWidth('name-column')}
                        />
                      }
                    />

                    {/* Bottom Status Bar */}
                    <div className="mbc-aln-status-footer">
                      <span>
                        {(() => {
                          const totalCols = viewConsensus.length || 1;
                          const col = Math.min(Math.max(1, cursorCol), totalCols);
                          const selSeq = viewRows[selectedRowIdx]?.alignedSeq ?? '';
                          const ch = selSeq[col - 1] ?? '-';
                          const ungappedPos = selSeq.slice(0, col).replace(/-/g, '').length;
                          const unit = alignmentStats.isProtein ? 'Residue' : 'Base';
                          return `Column ${col.toLocaleString()} of ${totalCols.toLocaleString()} • ${
                            ch === '-'
                              ? `gap (after ${unit.toLowerCase()} ${ungappedPos.toLocaleString()})`
                              : `${unit} ${ungappedPos.toLocaleString()} (${ch})`
                          } • Consensus ${viewConsensus[col - 1] ?? '-'} • Identity ${Math.round(
                            (viewConservation[col - 1] ?? 0) * 100
                          )}%`;
                        })()}
                      </span>
                      <span>
                        Selected: {viewRows[selectedRowIdx]?.name ?? activeDoc.name}
                        {reverseComplementView && !alignmentStats.isProtein ? ' • reverse complement view' : ''}
                        {!alignmentStats.isProtein && showTranslation && ` • ${translationGeneticCode}`}
                      </span>
                    </div>
                  </div>

                  {/* The side panel's resize handle: until it is dragged the panel keeps its responsive width */}
                  {ownInspectorOpen && (
                  <div
                    role="separator"
                    aria-label="Resize the side panel"
                    aria-orientation="vertical"
                    aria-valuenow={sidePanelNowPx}
                    aria-valuemin={Math.min(ALN_SIDE_PANEL_MIN_PX, sidePanelNowPx)}
                    aria-valuemax={Math.max(sidePanelMaxPx, sidePanelNowPx)}
                    aria-valuetext={`${sidePanelNowPx} pixels wide`}
                    tabIndex={0}
                    className={`mbc-aln-panel-resizer${paneDragging === 'side-panel' ? ' dragging' : ''}`}
                    title="Drag or press Left/Right Arrow keys to resize the side panel • Double-click to reset"
                    onPointerDown={(e) => startPaneDrag(e, 'side-panel')}
                    onKeyDown={(e) => onPaneHandleKey(e, 'side-panel')}
                    onDoubleClick={() => resetPaneWidth('side-panel')}
                  />
                  )}

                  {/* Right inspector panel and its vertical icon rail; an analysis widens it, and a dragged width sets it on every tab */}
                  {ownInspectorOpen && (
                  <div
                    className={`mbc-aln-inspector-shell${inspectorShowsAnalysis ? ' is-analysis' : ''}${sidePanelPx !== null ? ' is-sized' : ''}`}
                    style={sidePanelPx !== null ? ({ '--mbc-aln-panel-w': `${sidePanelPx}px` } as React.CSSProperties) : undefined}
                  >
                    <div className="mbc-aln-inspector-body">
                      {/* A figure that heads itself (the lengths graph, the gel) carries the view's one title. */}
                      {shownInspectorTab !== 'lengths-graph' && shownInspectorTab !== 'virtual-gel' && (
                        <div className="mbc-aln-inspector-title">
                          {INSPECTOR_TABS.find((t) => t.id === shownInspectorTab)?.label}
                        </div>
                      )}

                      {/* Inspector 1: General */}
                      {shownInspectorTab === 'general' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-field-row" style={{ gap: 4 }}>
                            <span>Colors:</span>
                            <select
                              value={colorScheme}
                              onChange={(e) =>
                                setColorScheme(e.target.value as AlignmentColorScheme)
                              }
                            >
                              {colorSchemeOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mbc-aln-link-btn"
                              aria-expanded={showColorEditorModal}
                              onClick={() => setShowColorEditorModal((v) => !v)}
                            >
                              Legend
                            </button>
                          </div>

                          {showColorEditorModal && (
                            <div className="mbc-aln-group-box" aria-label="Color legend">
                              <div className="mbc-aln-legend-grid">
                                {colorLegend.map((item) => (
                                  <span key={item.ch} className="mbc-aln-legend-item" title={item.ch}>
                                    <span
                                      className="mbc-aln-legend-swatch"
                                      style={{ background: item.color ?? 'transparent' }}
                                    />
                                    {item.ch}
                                  </span>
                                ))}
                              </div>
                              {colorLegendNote && (
                                <span className="mbc-aln-hint">{colorLegendNote}</span>
                              )}
                              <button
                                type="button"
                                className="btn-secondary-sm"
                                onClick={() => setColorScheme(defaultColorScheme(alignmentStats.isProtein))}
                              >
                                Restore Default
                              </button>
                            </div>
                          )}

                          <div className="mbc-aln-check-list">
                            {(
                              [
                                ['Graphs', showGraphs, setShowGraphs, 'graphs'],
                                ['Annotations', showAnnotations, setShowAnnotations, 'annotations-tracks'],
                                ['Consensus', showConsensus, setShowConsensus, 'display'],
                                ['Highlighting', showHighlighting, setShowHighlighting, 'display'],
                                ...(!alignmentStats.isProtein
                                  ? ([
                                      ['Complement', showComplement, setShowComplement, null],
                                      ['Translation', showTranslation, setShowTranslation, 'display'],
                                      ['Restriction Sites', showRestrictionSites, setShowRestrictionSites, 'restriction'],
                                    ] as const)
                                  : []),
                                [isContigAssemblyDoc ? 'Wrap Contig' : 'Wrap', wrapAlignment, setWrapAlignment, 'advanced'],
                                ['Show Names', showNames, setShowNames, null],
                              ] as const
                            ).map(([label, value, setter, optTab]) => (
                              <div key={label} className="mbc-aln-check-row">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={value}
                                    onChange={(e) => setter(e.target.checked)}
                                  />
                                  <span>{label}</span>
                                </label>
                                {optTab && (
                                  <button
                                    type="button"
                                    className="mbc-aln-link-btn"
                                    onClick={() => setInspectorTab(optTab)}
                                  >
                                    Options
                                  </button>
                                )}
                              </div>
                            ))}

                            <div className="mbc-aln-check-row">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={showSecondaryLabel}
                                  onChange={(e) => setShowSecondaryLabel(e.target.checked)}
                                />
                                <span>Show</span>
                              </label>
                              <select
                                value={secondaryLabelField}
                                onChange={(e) =>
                                  setSecondaryLabelField(
                                    e.target.value as 'Description' | 'Organism' | 'Accession'
                                  )
                                }
                              >
                                <option value="Description">Description</option>
                                <option value="Organism">Organism</option>
                                <option value="Accession">Accession</option>
                              </select>
                            </div>

                            <div className="mbc-aln-check-row">
                              <label title="Show the number of differences to the highlighting reference instead of % identity">
                                <input
                                  type="checkbox"
                                  checked={showDistancesInRow}
                                  onChange={(e) => setShowDistancesInRow(e.target.checked)}
                                />
                                <span>Show Distances</span>
                              </label>
                            </div>
                            <div className="mbc-aln-check-row">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={showSeqNumbers}
                                  onChange={(e) => setShowSeqNumbers(e.target.checked)}
                                />
                                <span>Show sequence numbers</span>
                              </label>
                            </div>
                            <div className="mbc-aln-check-row">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={showSequenceIcons}
                                  onChange={(e) => setShowSequenceIcons(e.target.checked)}
                                />
                                <span>Show sequence icons</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Inspector 2: Display */}
                      {shownInspectorTab === 'display' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-group-box">
                            <label className="mbc-aln-group-header">
                              <input
                                type="checkbox"
                                checked={showConsensus}
                                onChange={(e) => setShowConsensus(e.target.checked)}
                              />
                              <strong>Consensus</strong>
                            </label>
                            <label className="mbc-aln-field-row">
                              <span>Threshold:</span>
                              <select
                                value={consensusThreshold}
                                onChange={(e) => setConsensusThreshold(e.target.value)}
                              >
                                <option value="Majority">Majority (ties → {alignmentStats.isProtein ? 'X' : 'IUPAC'})</option>
                                <option value="0%">0% (most common)</option>
                                <option value="50%">50%</option>
                                <option value="65%">65%</option>
                                <option value="75%">75%</option>
                                <option value="85%">85%</option>
                                <option value="90%">90%</option>
                                <option value="95%">95%</option>
                                <option value="100%">100% (all observed residues)</option>
                              </select>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={consensusIgnoreGaps}
                                onChange={(e) => setConsensusIgnoreGaps(e.target.checked)}
                              />
                              <span>Ignore Gaps</span>
                            </label>
                          </div>

                          <div className="mbc-aln-group-box">
                            <label className="mbc-aln-group-header">
                              <input
                                type="checkbox"
                                checked={showHighlighting}
                                onChange={(e) => setShowHighlighting(e.target.checked)}
                              />
                              <strong>Highlighting</strong>
                            </label>
                            <label className="mbc-aln-field-row">
                              <span>Highlight:</span>
                              <select
                                value={highlightMode}
                                onChange={(e) =>
                                  setHighlightMode(
                                    e.target.value as 'All Disagreements' | 'All Agreements'
                                  )
                                }
                              >
                                <option value="All Disagreements">Disagreements</option>
                                <option value="All Agreements">Agreements</option>
                              </select>
                            </label>
                            <label className="mbc-aln-field-row">
                              <span>Compared to:</span>
                              <select
                                value={highlightRef}
                                onChange={(e) =>
                                  setHighlightRef(e.target.value as 'Consensus' | 'Reference')
                                }
                              >
                                <option value="Consensus">Consensus</option>
                                <option value="Reference">
                                  Reference ({msaRes.rows[0]?.name?.slice(0, 18) ?? 'first sequence'})
                                </option>
                              </select>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={useDotsForAgreements}
                                onChange={(e) => setUseDotsForAgreements(e.target.checked)}
                              />
                              <span>Use dots (&apos;.&apos;) for agreements</span>
                            </label>
                            <span className="mbc-aln-hint">
                              Also used for Previous / Next disagreement navigation and the
                              distance shown next to each name.
                            </span>
                          </div>

                          <div className="mbc-aln-group-box">
                            <label className="mbc-aln-group-header">
                              <input
                                type="checkbox"
                                checked={showNucleotides}
                                onChange={(e) => setShowNucleotides(e.target.checked)}
                              />
                              <strong>{alignmentStats.isProtein ? 'Residue letters' : 'Nucleotide letters'}</strong>
                            </label>
                            {!alignmentStats.isProtein && (
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={showComplement}
                                  onChange={(e) => setShowComplement(e.target.checked)}
                                />
                                <span>Show complement strand</span>
                              </label>
                            )}
                            <span className="mbc-aln-hint">Letters appear when zoomed to ≈70% or more.</span>
                          </div>

                          {!alignmentStats.isProtein && (
                            <div className="mbc-aln-group-box">
                              <label className="mbc-aln-group-header">
                                <input
                                  type="checkbox"
                                  checked={showTranslation}
                                  onChange={(e) => setShowTranslation(e.target.checked)}
                                />
                                <strong>Translation</strong>
                              </label>
                              <label className="mbc-aln-field-row">
                                <span>Frame:</span>
                                <select
                                  value={translationFrame}
                                  onChange={(e) => setTranslationFrame(e.target.value)}
                                >
                                  <option value="By annotation">By CDS annotation</option>
                                  <option value="Frame 1">Frame 1</option>
                                  <option value="Frame 2">Frame 2</option>
                                  <option value="Frame 3">Frame 3</option>
                                  <option value="All 3 Forward Frames">All 3 forward frames</option>
                                </select>
                              </label>
                              <label className="mbc-aln-field-row">
                                <span>Genetic Code:</span>
                                <select
                                  value={translationGeneticCode}
                                  onChange={(e) => setTranslationGeneticCode(e.target.value)}
                                >
                                  {GENETIC_CODE_NAMES.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={threeLetterAminoAcids}
                                  onChange={(e) => setThreeLetterAminoAcids(e.target.checked)}
                                />
                                <span>Three letter amino acids (when zoomed in)</span>
                              </label>
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={showAminoAcidNumbering}
                                  onChange={(e) => setShowAminoAcidNumbering(e.target.checked)}
                                />
                                <span>Show amino acid numbering</span>
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inspector 3: Graphs */}
                      {shownInspectorTab === 'graphs' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-check-row">
                            <label>
                              <input
                                type="checkbox"
                                checked={showGraphs}
                                onChange={(e) => setShowGraphs(e.target.checked)}
                              />
                              <strong>Show Graphs</strong>
                            </label>
                          </div>
                          <fieldset className="mbc-aln-fieldset" disabled={!showGraphs}>
                            <div className="mbc-aln-group-box">
                              <label className="mbc-aln-group-header">
                                <input
                                  type="checkbox"
                                  checked={showIdentityGraph}
                                  onChange={(e) => setShowIdentityGraph(e.target.checked)}
                                />
                                <strong>Identity</strong>
                              </label>
                              <label className="mbc-aln-field-row">
                                <span>Sliding window:</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={101}
                                  value={identityWindowSize}
                                  onChange={(e) =>
                                    setIdentityWindowSize(Math.max(1, Number(e.target.value) || 1))
                                  }
                                />
                              </label>
                            </div>
                            <div className="mbc-aln-group-box">
                              <label className="mbc-aln-group-header">
                                <input
                                  type="checkbox"
                                  checked={showCoverageGraph}
                                  onChange={(e) => setShowCoverageGraph(e.target.checked)}
                                />
                                <strong>Coverage</strong>
                              </label>
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={coverageLogScale}
                                  onChange={(e) => setCoverageLogScale(e.target.checked)}
                                />
                                <span>Log scale</span>
                              </label>
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={coverageHighlightBelow}
                                  onChange={(e) => setCoverageHighlightBelow(e.target.checked)}
                                />
                                <span>Highlight columns with gaps</span>
                              </label>
                            </div>
                            <div className="mbc-aln-group-box">
                              <label className="mbc-aln-group-header">
                                <input
                                  type="checkbox"
                                  checked={showSequenceLogo}
                                  onChange={(e) => setShowSequenceLogo(e.target.checked)}
                                />
                                <strong>Sequence Logo</strong>
                              </label>
                              <span className="mbc-aln-hint">
                                Height = relative information content of the most common residue.
                              </span>
                            </div>
                            {alignmentStats.isProtein ? (
                              <div className="mbc-aln-group-box">
                                <strong>Residue properties</strong>
                                <label className="mbc-aln-field-row">
                                  <span>
                                    <input
                                      type="checkbox"
                                      checked={showHydrophobicityGraph}
                                      onChange={(e) => setShowHydrophobicityGraph(e.target.checked)}
                                      style={{ marginRight: 5 }}
                                    />
                                    Hydrophobicity
                                  </span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={51}
                                    title="Sliding window"
                                    value={hydrophobicityWindowSize}
                                    onChange={(e) =>
                                      setHydrophobicityWindowSize(Math.max(1, Number(e.target.value) || 1))
                                    }
                                  />
                                </label>
                                <label className="mbc-aln-field-row">
                                  <span>
                                    <input
                                      type="checkbox"
                                      checked={showPiGraph}
                                      onChange={(e) => setShowPiGraph(e.target.checked)}
                                      style={{ marginRight: 5 }}
                                    />
                                    Isoelectric point (pI)
                                  </span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={51}
                                    title="Sliding window"
                                    value={piWindowSize}
                                    onChange={(e) => setPiWindowSize(Math.max(1, Number(e.target.value) || 1))}
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className="mbc-aln-group-box">
                                <label className="mbc-aln-group-header">
                                  <input
                                    type="checkbox"
                                    checked={showGcGraph}
                                    onChange={(e) => setShowGcGraph(e.target.checked)}
                                  />
                                  <strong>GC Content</strong>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={showAtGraph}
                                    onChange={(e) => setShowAtGraph(e.target.checked)}
                                  />
                                  <span>Overlay AT line</span>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={showFramePlot}
                                    onChange={(e) => setShowFramePlot(e.target.checked)}
                                  />
                                  <span>Frame plot (GC at codon positions 1/2/3)</span>
                                </label>
                                <label className="mbc-aln-field-row">
                                  <span>Sliding window:</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={500}
                                    value={gcWindowSize}
                                    onChange={(e) =>
                                      setGcWindowSize(Math.max(1, Number(e.target.value) || 1))
                                    }
                                  />
                                </label>
                              </div>
                            )}
                          </fieldset>
                        </div>
                      )}

                      {/* Inspector 4: Annotations and Tracks */}
                      {shownInspectorTab === 'annotations-tracks' && (
                        <div className="mbc-aln-inspector-section">
                          <label className="mbc-aln-check-inline">
                            <input
                              type="checkbox"
                              checked={showAnnotations}
                              onChange={(e) => setShowAnnotations(e.target.checked)}
                            />
                            <strong>
                              Show Annotations ({filteredAnnotationsForTable.length} of{' '}
                              {allAlignmentAnnotations.length})
                            </strong>
                          </label>
                          <label className="mbc-aln-field-row">
                            <span>Filter:</span>
                            <input
                              type="text"
                              placeholder="Name, type or qualifier"
                              value={annotationFilterQuery}
                              onChange={(e) => setAnnotationFilterQuery(e.target.value)}
                            />
                          </label>
                          <div className="mbc-aln-group-box">
                            <div className="mbc-aln-field-row">
                              <strong>Types</strong>
                              <span>
                                <button
                                  type="button"
                                  className="mbc-aln-link-btn"
                                  onClick={() => setHiddenAnnotationTypes(new Set())}
                                >
                                  All
                                </button>
                                |
                                <button
                                  type="button"
                                  className="mbc-aln-link-btn"
                                  onClick={() =>
                                    setHiddenAnnotationTypes(
                                      new Set(annotationTypeSummary.map((t) => t.type))
                                    )
                                  }
                                >
                                  None
                                </button>
                              </span>
                            </div>
                            {annotationTypeSummary.length === 0 && (
                              <span className="mbc-aln-hint">No annotations on these sequences.</span>
                            )}
                            {annotationTypeSummary.map((t) => {
                              const checked = !hiddenAnnotationTypes.has(t.type);
                              return (
                                <div key={t.type} className="mbc-aln-check-row">
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        setHiddenAnnotationTypes((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(t.type)) next.delete(t.type);
                                          else next.add(t.type);
                                          return next;
                                        })
                                      }
                                    />
                                    <span>
                                      {formatAnnotationTypeLabel(t.type)} ({t.count})
                                    </span>
                                  </label>
                                  <span
                                    className="mbc-aln-type-swatch"
                                    style={{ background: t.color }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <div className="mbc-aln-group-box">
                            <strong>Layout</strong>
                            <label className="mbc-aln-field-row">
                              <span>Labels:</span>
                              <select
                                value={advAnnLabelsPos}
                                onChange={(e) => setAdvAnnLabelsPos(e.target.value)}
                              >
                                <option value="Inside">Inside</option>
                                <option value="Above">Above</option>
                                <option value="None">None</option>
                              </select>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={advAnnCompress}
                                onChange={(e) => setAdvAnnCompress(e.target.checked)}
                              />
                              <span>Compress (share lanes when not overlapping)</span>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={advAnnShowArrowTips}
                                onChange={(e) => setAdvAnnShowArrowTips(e.target.checked)}
                              />
                              <span>Show arrow tips</span>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={advAnnHideExcessiveLabels}
                                onChange={(e) => setAdvAnnHideExcessiveLabels(e.target.checked)}
                              />
                              <span>Hide labels that don&apos;t fit</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Inspector 5: Live Annotate & Predict */}
                      {shownInspectorTab === 'live-annotate' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-group-box">
                            <strong>Transfer Annotations</strong>
                            <label className="mbc-aln-field-row">
                              <span>From:</span>
                              <select
                                value={annotateFromSource}
                                onChange={(e) => setAnnotateFromSource(e.target.value)}
                              >
                                <option value="Reference Features">
                                  Reference ({msaRes.rows[0]?.name?.slice(0, 16) ?? 'row 1'})
                                </option>
                                <option value="All Sequences">All annotated sequences</option>
                              </select>
                            </label>
                            <label className="mbc-aln-field-row">
                              <span>Min. identity: {transferSimPct}%</span>
                              <input
                                type="range"
                                min={50}
                                max={100}
                                value={transferSimPct}
                                onChange={(e) => setTransferSimPct(Number(e.target.value))}
                              />
                            </label>
                            <div className="mbc-aln-btn-row">
                              <button type="button" className="btn-primary-sm" onClick={runTransferAnnotations}>
                                Transfer
                              </button>
                            </div>
                          </div>

                          {!alignmentStats.isProtein && (
                            <div className="mbc-aln-group-box">
                              <strong>Find ORFs</strong>
                              <label className="mbc-aln-field-row">
                                <span>Minimum size (bp):</span>
                                <input
                                  type="number"
                                  min={30}
                                  max={100000}
                                  value={findOrfsMinSize}
                                  onChange={(e) =>
                                    setFindOrfsMinSize(Math.max(30, Number(e.target.value) || 300))
                                  }
                                />
                              </label>
                              <label className="mbc-aln-field-row">
                                <span>Genetic code:</span>
                                <select
                                  value={findOrfsGeneticCode}
                                  onChange={(e) => setFindOrfsGeneticCode(e.target.value)}
                                >
                                  {GENETIC_CODE_NAMES.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="mbc-aln-field-row">
                                <span>Start codons:</span>
                                <input
                                  type="text"
                                  value={findOrfsStartCodons}
                                  onChange={(e) => setFindOrfsStartCodons(e.target.value)}
                                />
                              </label>
                              <div className="mbc-aln-btn-row">
                                <button type="button" className="btn-primary-sm" onClick={runFindOrfs}>
                                  Find ORFs
                                </button>
                              </div>
                            </div>
                          )}

                          {predictedFeatureCount > 0 && (
                            <div className="mbc-aln-group-box">
                              <span>
                                <strong>{predictedFeatureCount}</strong> predicted annotation(s) shown
                                (not yet saved).
                              </span>
                              <div className="mbc-aln-btn-row">
                                {canPersistAnnotations && (
                                  <button type="button" className="btn-primary-sm" onClick={savePredictedFeatures}>
                                    Save to document
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => {
                                    setPredictedFeatures({});
                                    setLiveAnnotateStatus('Cleared predicted annotations.');
                                  }}
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          )}
                          {liveAnnotateStatus && (
                            <p className="mbc-aln-status-note" role="status">
                              {liveAnnotateStatus}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Inspector 6: Restriction Analysis */}
                      {shownInspectorTab === 'restriction' && (
                        <div className="mbc-aln-inspector-section">
                          {alignmentStats.isProtein ? (
                            <span className="mbc-aln-hint">
                              Restriction analysis applies to nucleotide alignments only.
                            </span>
                          ) : (
                            <>
                              <div className="mbc-aln-group-box">
                                <label className="mbc-aln-group-header">
                                  <input
                                    type="checkbox"
                                    checked={showRestrictionSites}
                                    onChange={(e) => setShowRestrictionSites(e.target.checked)}
                                  />
                                  <strong>Show sites on consensus</strong>
                                </label>
                                <label className="mbc-aln-field-row">
                                  <span>Enzymes:</span>
                                  <select
                                    value={candidateEnzymeSet}
                                    onChange={(e) => setCandidateEnzymeSet(e.target.value)}
                                  >
                                    {enzymeSetOptions.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.label} ({o.enzymes.length})
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="mbc-aln-hint">
                                  {consensusRestrictionHits.length} site(s) in the consensus
                                  {consensusCutterSummary ? ` · ${consensusCutterSummary}` : ''}
                                </div>
                                <ResultWarnings
                                  warnings={rowsLeftOut(
                                    Math.min(consensusRestrictionHits.length, CONSENSUS_SITES_LISTED),
                                    consensusRestrictionHits.length,
                                    'sites, by column',
                                    'The list shows'
                                  )}
                                  label="Consensus site list warnings"
                                />
                                <div className="mbc-aln-site-list">
                                  {consensusRestrictionHits.slice(0, CONSENSUS_SITES_LISTED).map((h, i) => (
                                    <button
                                      type="button"
                                      key={`${h.enzyme}-${h.col}-${i}`}
                                      className="mbc-aln-site-row"
                                      onClick={() => goToColumn(h.col + 1)}
                                      title="Go to site"
                                    >
                                      <strong>{h.enzyme}</strong>
                                      <code>{h.site}</code>
                                      <span>col {h.col + 1}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="mbc-aln-group-box">
                                <strong>Highlight Methylation Sites</strong>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={highlightDam}
                                    onChange={(e) => setHighlightDam(e.target.checked)}
                                  />
                                  <span>Dam (GATC)</span>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={highlightDcm}
                                    onChange={(e) => setHighlightDcm(e.target.checked)}
                                  />
                                  <span>Dcm (CCWGG)</span>
                                </label>
                                <span className="mbc-aln-hint">Marked with a purple underline in each sequence.</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Inspector 7: Advanced */}
                      {shownInspectorTab === 'advanced' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-group-box">
                            <strong>Layout</strong>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={wrapAlignment}
                                onChange={(e) => setWrapAlignment(e.target.checked)}
                              />
                              <span>
                                {isUnalignedSequenceList ? 'Wrap sequences' : 'Wrap alignment'}
                              </span>
                            </label>
                            <label className="mbc-aln-field-row">
                              <span>
                                <input
                                  type="checkbox"
                                  checked={hideGapSitesOverPct}
                                  onChange={(e) => setHideGapSitesOverPct(e.target.checked)}
                                  style={{ marginRight: 5 }}
                                />
                                Hide sites with gaps over (%)
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={gapSiteThresholdPct}
                                onChange={(e) =>
                                  setGapSiteThresholdPct(
                                    Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                  )
                                }
                              />
                            </label>
                            {hideGapSitesOverPct && (
                              <span className="mbc-aln-hint">
                                Showing {viewVisibleCols.length.toLocaleString()} of{' '}
                                {viewConsensus.length.toLocaleString()} columns.
                              </span>
                            )}
                            <label className="mbc-aln-field-row">
                              <span>Space every N residues:</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={spacesEveryNBases}
                                onChange={(e) =>
                                  setSpacesEveryNBases(Math.max(0, Number(e.target.value) || 0))
                                }
                              />
                            </label>
                          </div>

                          <div className="mbc-aln-group-box">
                            <strong>Properties</strong>
                            <label className="mbc-aln-field-row">
                              <span>Ruler numbering:</span>
                              <select
                                value={advNumbering}
                                onChange={(e) => setAdvNumbering(e.target.value)}
                              >
                                <option value="Standard">Alignment columns (from 1)</option>
                                <option value="From 0">Alignment columns (from 0)</option>
                                <option value="No gaps">Selected sequence (ungapped)</option>
                              </select>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={advMiniMap}
                                onChange={(e) => setAdvMiniMap(e.target.checked)}
                              />
                              <span>Mini-map</span>
                            </label>
                            <label className="mbc-aln-check-inline">
                              <input
                                type="checkbox"
                                checked={advOutlineZoomedOut}
                                onChange={(e) => setAdvOutlineZoomedOut(e.target.checked)}
                              />
                              <span>Outline residues when zoomed out</span>
                            </label>
                          </div>

                          <div className="mbc-aln-group-box">
                            <strong>Sizes (px)</strong>
                            {(
                              [
                                ['Residue font at 100% zoom', advSize100Pct, setAdvSize100Pct, 8, 24],
                                ['Row height when zoomed out', advSizeZoomedOut, setAdvSizeZoomedOut, 4, 30],
                                ['Sequence names', advSizeSeqNames, setAdvSizeSeqNames, 9, 18],
                                ['Ruler numbers', advSizeBaseNumbers, setAdvSizeBaseNumbers, RULER_NUMBER_FONT_FLOOR_PX, 16],
                                ['Annotation labels', advSizeAnnLabels, setAdvSizeAnnLabels, 8, 16],
                                ['Annotation thickness', advSizeAnnThickness, setAdvSizeAnnThickness, 4, 24],
                              ] as const
                            ).map(([label, value, setter, min, max]) => (
                              <label key={label} className="mbc-aln-field-row">
                                <span>{label}:</span>
                                <input
                                  type="number"
                                  min={min}
                                  max={max}
                                  value={value}
                                  onChange={(e) =>
                                    setter(Math.min(max, Math.max(min, Number(e.target.value) || min)))
                                  }
                                />
                              </label>
                            ))}
                            <button
                              type="button"
                              className="btn-secondary-sm"
                              onClick={() => {
                                setAdvSize100Pct(13);
                                setAdvSizeZoomedOut(14);
                                setAdvSizeSeqNames(12);
                                setAdvSizeBaseNumbers(RULER_NUMBER_FONT_FLOOR_PX);
                                setAdvSizeAnnLabels(11);
                                setAdvSizeAnnThickness(13);
                              }}
                            >
                              Restore Defaults
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inspector 8: Statistics (matching Screenshots 2.54.28 AM, 3.00.56 AM, 3.02.09 AM) */}
                      {shownInspectorTab === 'statistics' && (
                        <div className="mbc-aln-inspector-section">
                          <div className="mbc-aln-group-box">
                            <strong>
                              {alignmentStats.isProtein
                                ? 'Protein Statistics'
                                : 'Nucleotide Statistics'}
                            </strong>
                            <div className="mbc-aln-stat-kv">
                              <span>Length:</span>
                              <strong>
                                {alignmentStats.meanLen} {alignmentStats.unit}
                              </strong>
                            </div>
                            <div className="mbc-aln-stat-kv">
                              <span>Sequences:</span>
                              <strong>{alignmentStats.seqCount}</strong>
                            </div>
                            <div className="mbc-aln-stat-kv">
                              <span>Identical Sites:</span>
                              <strong>
                                {isUnalignedSequenceList
                                  ? 'N/A (align first)'
                                  : `${alignmentStats.identicalSitesCount.toLocaleString()} (${alignmentStats.identicalSitesPct}%)`}
                              </strong>
                            </div>
                            <div className="mbc-aln-stat-kv">
                              <span>Pairwise Identity:</span>
                              <strong>
                                {isUnalignedSequenceList
                                  ? 'N/A (align first)'
                                  : formatPairwiseIdentityPct(alignmentStats.pairwiseIdentityPct, alignmentStats.pairwiseIdentityPairs)}
                              </strong>
                            </div>
                            {viewRows.length > 1 && !isUnalignedSequenceList && (
                              <div className="mbc-aln-stat-subgroup">
                                <div className="mbc-aln-stat-subtitle">Coverage (sequences per column):</div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Minimum:</span>
                                  <strong>{coverageStats.min}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Maximum:</span>
                                  <strong>{coverageStats.max}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Mean:</span>
                                  <strong>{coverageStats.mean}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Gap-free columns:</span>
                                  <strong>
                                    {coverageStats.gapFree.toLocaleString()} ({coverageStats.gapFreePct}%)
                                  </strong>
                                </div>
                              </div>
                            )}
                            <div
                              style={{
                                marginTop: 6,
                                paddingTop: 6,
                                borderTop: '1px solid var(--mbc-border)',
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2 }}>
                                Ungapped lengths of {alignmentStats.seqCount} sequences:
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Mean:</span>
                                <strong>
                                  {alignmentStats.meanLen} {alignmentStats.unit}
                                </strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Std Dev:</span>
                                <strong>{alignmentStats.stdDev}</strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Minimum:</span>
                                <strong>{alignmentStats.minLen.toLocaleString()}</strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Maximum:</span>
                                <strong>{alignmentStats.maxLen.toLocaleString()}</strong>
                              </div>
                            </div>
                            {alignmentStats.isProtein ? (
                              <div
                                style={{
                                  marginTop: 6,
                                  paddingTop: 6,
                                  borderTop: '1px solid var(--mbc-border)',
                                }}
                              >
                                <div className="mbc-aln-stat-kv">
                                  <span>Molecular Weight:</span>
                                  <strong>{alignmentStats.proteinMwKda} kDa</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Isoelectric Point:</span>
                                  <strong>{alignmentStats.isoelectricPoint}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Charge at pH 7:</span>
                                  <strong>{alignmentStats.chargeAtPh7}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>Extinction Coefficient:</span>
                                  <strong>{alignmentStats.extinctionCoeff.toLocaleString()}</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>A[280] of 1 mg/ml (mean):</span>
                                  <strong>{alignmentStats.a280Mean} AU</strong>
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{
                                  marginTop: 6,
                                  paddingTop: 6,
                                  borderTop: '1px solid var(--mbc-border)',
                                }}
                              >
                                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2 }}>
                                  Molecular weight (mean):
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>ssDNA:</span>
                                  <strong>{alignmentStats.ssDnaKda} kDa</strong>
                                </div>
                                <div className="mbc-aln-stat-kv">
                                  <span>dsDNA:</span>
                                  <strong>{alignmentStats.dsDnaKda} kDa</strong>
                                </div>
                              </div>
                            )}
                            <table className="mbc-aln-stat-freq-table">
                              <thead>
                                <tr>
                                  <th>{alignmentStats.isProtein ? 'Amino Acids' : 'Nucleotides'}</th>
                                  <th style={{ textAlign: 'right' }}>Freq</th>
                                  <th style={{ textAlign: 'right' }}>% of non-gaps</th>
                                </tr>
                              </thead>
                              <tbody>
                                {alignmentStats.freqRows.map((fr) => (
                                  <tr key={fr.label}>
                                    <td>
                                      <strong>{fr.label}:</strong>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      {fr.count.toLocaleString()}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{fr.pct}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {alignmentStats.isProtein ? (
                              <table className="mbc-aln-stat-freq-table" style={{ marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th>AA Group</th>
                                    <th style={{ textAlign: 'right' }}>Freq</th>
                                    <th style={{ textAlign: 'right' }}>%</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {alignmentStats.aaGroupRows.map((gr) => (
                                    <tr key={gr.label}>
                                      <td>
                                        <strong>{gr.label}:</strong>
                                      </td>
                                      <td style={{ textAlign: 'right' }}>
                                        {gr.count.toLocaleString()}
                                      </td>
                                      <td style={{ textAlign: 'right' }}>{gr.pct}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div style={{ marginTop: 8 }}>
                                <table className="mbc-aln-stat-freq-table" style={{ marginBottom: 8 }}>
                                  <thead>
                                    <tr>
                                      <th>AA Group</th>
                                      <th style={{ textAlign: 'right' }}>Freq</th>
                                      <th style={{ textAlign: 'right' }}>%</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {alignmentStats.translatedAaGroupRows.map((gr) => (
                                      <tr key={gr.label}>
                                        <td>
                                          <strong>{gr.label}:</strong>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                          {gr.count.toLocaleString()}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{gr.pct}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <table className="mbc-aln-stat-freq-table">
                                  <thead>
                                    <tr>
                                      <th>Codon</th>
                                      <th>AA</th>
                                      <th style={{ textAlign: 'right' }}>% of AA</th>
                                      <th style={{ textAlign: 'right' }}>Freq</th>
                                      <th style={{ textAlign: 'right' }}>%</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {alignmentStats.codonRows.map((cr) => (
                                      <tr key={cr.codon}>
                                        <td>
                                          <code>{cr.codon}</code>
                                        </td>
                                        <td>{cr.aa1}</td>
                                        <td style={{ textAlign: 'right' }}>{cr.pctOfAa}</td>
                                        <td style={{ textAlign: 'right' }}>
                                          {cr.count.toLocaleString()}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{cr.pct}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Analysis panel: the members' annotations as a table, with its CSV export */}
                      {shownInspectorTab === 'member-annotations' && (
                        <div className="mbc-aln-analysis-panel">
                          <div className="mbc-aln-action-toolbar">
                            <div className="mbc-aln-toolbar-left">
                              <label className="mbc-aln-inline-select">
                                <span>Type:</span>
                                <select
                                  value={annTabTypeFilter}
                                  onChange={(e) => setAnnTabTypeFilter(e.target.value)}
                                >
                                  <option value="All">All ({allAlignmentAnnotations.length})</option>
                                  {annotationTypeSummary.map((t) => (
                                    <option key={t.type} value={t.type}>
                                      {t.type} ({t.count})
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button type="button" className="mbc-aln-tool-btn" onClick={exportAnnotationsTable}>
                                Export table (CSV)
                              </button>
                              <button
                                type="button"
                                className="mbc-aln-tool-btn"
                                onClick={() => setInspectorTab('annotations-tracks')}
                              >
                                Display options
                              </button>
                            </div>
                            <div className="mbc-aln-toolbar-right">
                              <input
                                type="text"
                                className="mbc-aln-search-input"
                                placeholder="Filter annotations..."
                                value={annTabSearch}
                                onChange={(e) => setAnnTabSearch(e.target.value)}
                              />
                              <span style={{ fontSize: 11, color: 'var(--mbc-text-muted)' }}>
                                Showing {filteredAnnotationsForTable.length} of{' '}
                                {allAlignmentAnnotations.length} annotations
                              </span>
                            </div>
                          </div>

                          <div className="mbc-aln-table-scroll">
                            <table className="mbc-aln-data-table">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Sequence Name</th>
                                  <th>Type</th>
                                  <th style={{ textAlign: 'right' }}>Minimum</th>
                                  <th style={{ textAlign: 'right' }}>Maximum</th>
                                  <th style={{ textAlign: 'right' }}>Length</th>
                                  <th style={{ textAlign: 'right' }}># Intervals</th>
                                  <th>Direction</th>
                                  <th>Track</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredAnnotationsForTable.map((ann) => (
                                  <tr
                                    key={ann.id}
                                    title="Show in alignment"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => {
                                      setSelectedRowIdx(ann.seqIdx);
                                      const aligned = msaRes.rows[ann.seqIdx]?.alignedSeq ?? '';
                                      // annotation coordinates are ungapped; convert to an alignment column
                                      let pos = 0;
                                      let col = 1;
                                      for (let c = 0; c < aligned.length; c++) {
                                        if (aligned[c] !== '-') pos++;
                                        if (pos >= ann.min) {
                                          col = c + 1;
                                          break;
                                        }
                                      }
                                      goToColumn(col);
                                    }}
                                  >
                                    <td>
                                      <strong>{ann.name}</strong>
                                    </td>
                                    <td>{ann.seqName}</td>
                                    <td>{ann.type}</td>
                                    <td style={{ textAlign: 'right' }}>{ann.min.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right' }}>{ann.max.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right' }}>{ann.length.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right' }}>{ann.intervalsCount}</td>
                                    <td>{ann.direction}</td>
                                    <td>{ann.track}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {/* Analysis panel: Substitution distances between the members */}
                      {shownInspectorTab === 'distances' && (
                        <div className="mbc-aln-analysis-panel">
                          <div className="mbc-aln-action-toolbar">
                            <div className="mbc-aln-toolbar-left">
                              <button
                                type="button"
                                className="mbc-aln-tool-btn"
                                onClick={exportDistanceMatrix}
                                disabled={isUnalignedSequenceList}
                                title={isUnalignedSequenceList ? 'Align first: distances need an alignment' : undefined}
                              >
                                Export Matrix (TSV)
                              </button>
                              <label className="mbc-aln-inline-select">
                                <select
                                  value={distanceMetric}
                                  onChange={(e) =>
                                    setDistanceMetric(
                                      e.target.value as 'identity' | 'diffs' | 'p-dist' | 'jc69' | 'k2p'
                                    )
                                  }
                                >
                                  <option value="identity">% Identity</option>
                                  <option value="diffs">Number of Differences</option>
                                  <option value="p-dist">p-distance</option>
                                  {!alignmentStats.isProtein && (
                                    <>
                                      <option value="jc69">Jukes-Cantor (JC69)</option>
                                      <option value="k2p">Kimura 2-Parameter (K2P)</option>
                                    </>
                                  )}
                                </select>
                              </label>
                              <label className="mbc-aln-inline-select">
                                <span>Decimal places:</span>
                                <input
                                  type="number"
                                  className="mbc-aln-zoom-input"
                                  min={0}
                                  max={5}
                                  value={distanceDecimals}
                                  disabled={distanceMetric === 'diffs'}
                                  onChange={(e) =>
                                    setDistanceDecimals(Math.max(0, Math.min(5, Number(e.target.value) || 0)))
                                  }
                                />
                              </label>
                              <label className="mbc-aln-inline-select">
                                <span>Style:</span>
                                <select
                                  value={distanceStyle}
                                  onChange={(e) =>
                                    setDistanceStyle(
                                      e.target.value as 'Numbers Only' | 'Heatmap + Numbers' | 'Lower Triangle'
                                    )
                                  }
                                >
                                  <option value="Numbers Only">Numbers only</option>
                                  <option value="Heatmap + Numbers">Heatmap + numbers</option>
                                  <option value="Lower Triangle">Lower triangle</option>
                                </select>
                              </label>
                            </div>
                            <div className="mbc-aln-toolbar-right">
                              <span className="mbc-aln-hint">
                                End gaps ignored. Identity/p-distance count internal gaps; JC69/K2P use only A/C/G/T pairs (U=T). N/A = no comparable sites; ∞ = saturation.
                              </span>
                            </div>
                          </div>
                          <ResultWarnings warnings={distanceMatrixLeftOut} label="Distance matrix warnings" />

                          {isUnalignedSequenceList ? (
                            <div className="info-callout" role="status" style={{ margin: 8 }}>
                              Align first: this is an unaligned sequence list, so pairwise distances are not computed
                              (padded unaligned sequences have no homologous columns). Run MSA Alignment on the list to
                              compute the distance matrix.
                              <div style={{ marginTop: 6 }}>
                                <button type="button" className="btn-primary-sm" onClick={() => setForceRunMsaOnList(true)}>
                                  Run MSA Alignment
                                </button>
                              </div>
                            </div>
                          ) : (
                          <div className="mbc-aln-table-scroll">
                            <table className="mbc-aln-data-table mbc-aln-matrix-table">
                              <thead>
                                <tr>
                                  <th>Sequence</th>
                                  {distanceMatrix.names.map((name, cIdx) => (
                                    <th key={cIdx} style={{ textAlign: 'right' }} title={name}>
                                      {cIdx + 1}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {distanceMatrix.names.map((name, rIdx) => (
                                  <tr
                                    key={rIdx}
                                    className={selectedDistRow === rIdx ? 'selected-matrix-row' : ''}
                                    onClick={() => setSelectedDistRow(rIdx)}
                                  >
                                    <td>
                                      <strong>
                                        {rIdx + 1}. {name}
                                      </strong>
                                    </td>
                                    {distanceMatrix.values[rIdx].map((val, cIdx) => {
                                      if (rIdx === cIdx) {
                                        return (
                                          <td key={cIdx} style={{ textAlign: 'right' }}>
                                            —
                                          </td>
                                        );
                                      }
                                      if (distanceStyle === 'Lower Triangle' && cIdx > rIdx) {
                                        return <td key={cIdx} />;
                                      }
                                      const t =
                                        distanceMatrix.max > distanceMatrix.min
                                          ? (val - distanceMatrix.min) / (distanceMatrix.max - distanceMatrix.min)
                                          : 0;
                                      // similarity metrics: high = similar; distance metrics: low = similar
                                      const sim = distanceMetric === 'identity' ? t : 1 - t;
                                      return (
                                        <td
                                          key={cIdx}
                                          style={{
                                            textAlign: 'right',
                                            background:
                                              distanceStyle === 'Heatmap + Numbers'
                                                && Number.isFinite(val) ? `rgba(37, 99, 235, ${(0.08 + sim * 0.42).toFixed(3)})`
                                                : undefined,
                                          }}
                                        >
                                          {formatDistance(val)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          )}
                        </div>
                      )}

                      {/* Analysis panel: Lengths of the members */}
                      {shownInspectorTab === 'lengths-graph' && (
                        <div className="mbc-aln-analysis-panel">
                          <div className="mbc-aln-action-toolbar">
                            <div className="mbc-aln-toolbar-left">
                              <button
                                type="button"
                                className="mbc-aln-tool-btn"
                                disabled={!onGenerateConsensus || !dynamicConsensus.length || isUnalignedSequenceList || !!msaExecution.error}
                                onClick={() => onGenerateConsensus?.(dynamicConsensus)}
                              >
                                Extract
                              </button>
                              <button
                                type="button"
                                className="mbc-aln-tool-btn"
                                onClick={() =>
                                  downloadText(
                                    `${safeFileBase}_lengths.csv`,
                                    [
                                      'Sequence,Length',
                                      ...msaRes.rows.map(
                                        (r, i) =>
                                          `"${r.name.replace(/"/g, '""')}",${alignmentStats.ungappedLengths[i] ?? 0}`
                                      ),
                                    ].join('\n'),
                                    'text/csv'
                                  )
                                }
                              >
                                Export CSV
                              </button>
                              <label className="mbc-aln-inline-select">
                                <span>Bins:</span>
                                <input
                                  type="number"
                                  className="mbc-aln-zoom-input"
                                  min={4}
                                  max={24}
                                  value={lengthsBinCount}
                                  onChange={(e) =>
                                    setLengthsBinCount(
                                      Math.max(4, Math.min(24, Number(e.target.value) || 10))
                                    )
                                  }
                                />
                              </label>
                            </div>
                            <div className="mbc-aln-toolbar-right">
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={lengthsFitToWindow}
                                  onChange={(e) => setLengthsFitToWindow(e.target.checked)}
                                />
                                <span>Fit to window</span>
                              </label>
                              <span style={{ fontSize: 11, color: 'var(--mbc-text-muted)', marginLeft: 8 }}>
                                Resolution: Screen
                              </span>
                            </div>
                          </div>

                          {/* The chart across the panel, its statistics under it across the same width */}
                          <div className="mbc-aln-lengths-view">
                            <div className="mbc-aln-lengths-figure" data-mbc-figure>
                              <div className="studio-card-header">
                                <h4>Sequence Length Distribution</h4>
                                <FigureExportButton compact baseName="Sequence Length Distribution" title="Sequence length distribution" />
                              </div>
                              <svg
                                ref={lengthsChartRef}
                                className="mbc-aln-lengths-chart"
                                viewBox={`0 0 ${lengthsChart.W} ${lengthsChart.H}`}
                                style={{
                                  width: lengthsFitToWindow ? '100%' : LENGTHS_CHART_FIXED_WIDTH,
                                  height: 'auto',
                                  display: 'block',
                                }}
                              >
                                {/* Count axis: grid lines and whole-number ticks */}
                                {lengthsChart.counts.map((c) => (
                                  <g key={`count-${c}`}>
                                    <line
                                      x1={lengthsChart.left}
                                      y1={lengthsChart.yOf(c)}
                                      x2={lengthsChart.right}
                                      y2={lengthsChart.yOf(c)}
                                      stroke="var(--mbc-border)"
                                      strokeDasharray={c === 0 ? undefined : '3 3'}
                                    />
                                    <text
                                      className="mbc-aln-lengths-count-tick"
                                      x={lengthsChart.left - 6}
                                      y={lengthsChart.yOf(c) + 4}
                                      textAnchor="end"
                                      fontSize={lengthsChart.font}
                                      fill="var(--mbc-text-secondary)"
                                    >
                                      {c.toLocaleString()}
                                    </text>
                                  </g>
                                ))}
                                <text
                                  x={lengthsChart.titleX}
                                  y={(lengthsChart.top + lengthsChart.bottom) / 2}
                                  textAnchor="middle"
                                  fontSize={lengthsChart.font}
                                  fontWeight={600}
                                  fill="var(--mbc-text-main)"
                                  transform={`rotate(-90 ${lengthsChart.titleX} ${(lengthsChart.top + lengthsChart.bottom) / 2})`}
                                >
                                  Number of Sequences
                                </text>
                                {/* Histogram bars, each over the whole lengths its bin holds */}
                                {lengthsChart.bars.map((bar) => (
                                  <rect
                                    key={`bar-${bar.first}`}
                                    className="mbc-aln-lengths-bar"
                                    x={bar.x}
                                    y={bar.y}
                                    width={bar.width}
                                    height={bar.height}
                                    fill="var(--mbc-orange)"
                                    rx={1.5}
                                  >
                                    <title>{`${bar.first === bar.last ? bar.first.toLocaleString() : `${bar.first.toLocaleString()}–${bar.last.toLocaleString()}`} ${alignmentStats.unit}: ${bar.count} ${bar.count === 1 ? 'sequence' : 'sequences'}`}</title>
                                  </rect>
                                ))}
                                {/* Axes */}
                                <line
                                  className="mbc-aln-lengths-count-axis"
                                  x1={lengthsChart.left}
                                  y1={lengthsChart.top}
                                  x2={lengthsChart.left}
                                  y2={lengthsChart.bottom}
                                  stroke="var(--mbc-text-secondary)"
                                  strokeWidth={1.2}
                                />
                                <line
                                  className="mbc-aln-lengths-length-axis"
                                  x1={lengthsChart.left}
                                  y1={lengthsChart.bottom}
                                  x2={lengthsChart.right}
                                  y2={lengthsChart.bottom}
                                  stroke="var(--mbc-text-secondary)"
                                  strokeWidth={1.2}
                                />
                                {/* Length axis: the shortest member to the longest */}
                                {lengthsChart.lengthTicks.map((v) => (
                                  <g key={`length-${v}`}>
                                    <line
                                      x1={lengthsChart.xOf(v)}
                                      y1={lengthsChart.bottom}
                                      x2={lengthsChart.xOf(v)}
                                      y2={lengthsChart.bottom + 4}
                                      stroke="var(--mbc-text-secondary)"
                                    />
                                    <text
                                      className="mbc-aln-lengths-length-tick"
                                      x={lengthsChart.xOf(v)}
                                      y={lengthsChart.bottom + 18}
                                      textAnchor="middle"
                                      fontSize={lengthsChart.font}
                                      fill="var(--mbc-text-secondary)"
                                    >
                                      {v.toLocaleString()}
                                    </text>
                                  </g>
                                ))}
                                <text
                                  x={(lengthsChart.left + lengthsChart.right) / 2}
                                  y={lengthsChart.H - 6}
                                  textAnchor="middle"
                                  fontSize={lengthsChart.font}
                                  fontWeight={600}
                                  fill="var(--mbc-text-main)"
                                >
                                  Sequence Length ({alignmentStats.unit})
                                </text>
                              </svg>
                            </div>

                            <div className="mbc-aln-lengths-stats">
                              <div className="mbc-aln-stat-kv">
                                <span>Sequences:</span>
                                <strong>{alignmentStats.seqCount}</strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Minimum:</span>
                                <strong>
                                  {alignmentStats.minLen.toLocaleString()} {alignmentStats.unit}
                                </strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Maximum:</span>
                                <strong>
                                  {alignmentStats.maxLen.toLocaleString()} {alignmentStats.unit}
                                </strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Mean:</span>
                                <strong>
                                  {alignmentStats.meanLen} {alignmentStats.unit}
                                </strong>
                              </div>
                              <div className="mbc-aln-stat-kv">
                                <span>Std Dev:</span>
                                <strong>{alignmentStats.stdDev}</strong>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Analysis panel: Virtual gel of the members */}
                      {shownInspectorTab === 'virtual-gel' && (
                        <div className="mbc-aln-analysis-panel">
                          {/* One column across the panel: the gel (key included) and its readout, its actions, then its controls */}
                          <div className="mbc-aln-gel-view">
                            <div
                              className="mbc-aln-gel-box"
                              style={{
                                background: currentStain.isDark ? '#080c16' : '#ffffff',
                                border: currentStain.isDark
                                  ? '1px solid rgba(255, 255, 255, 0.1)'
                                  : '1px solid var(--mbc-border)',
                                boxShadow: currentStain.isDark
                                  ? '0 12px 30px -6px rgba(0, 0, 0, 0.65)'
                                  : '0 2px 8px rgba(0, 0, 0, 0.05)',
                              }}
                            >
                              {/* The figure: its heading and Export, then the gel drawn at the panel's width */}
                              <div className="mbc-aln-gel-figure" data-mbc-figure style={{ width: '100%' }}>
                                <div className="studio-card-header">
                                  {/* On a dark stain the heading takes the stain's light text, so it reads on the gel's dark box. */}
                                  <h4 style={currentStain.isDark ? { color: currentStain.tooltipText } : undefined}>Virtual Gel</h4>
                                  <FigureExportButton
                                    compact
                                    baseName="Virtual Gel"
                                    title={`Virtual gel — ${gelAgarosePct}% agarose in ${gelBufferType} buffer`}
                                  />
                                </div>
                                <svg
                                  id="mbc-virtual-gel-svg"
                                  ref={gelSvgRef}
                                  viewBox={`0 0 ${VIRTUAL_GEL_VIEW_WIDTH} ${VIRTUAL_GEL_VIEW_HEIGHT}`}
                                  style={{
                                    display: 'block',
                                    width: '100%',
                                    height: 'auto',
                                    userSelect: 'none',
                                    cursor: 'crosshair',
                                  }}
                                  onMouseMove={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const svgY = (e.clientY - rect.top) * (VIRTUAL_GEL_VIEW_HEIGHT / rect.height);
                                    if (svgY >= gelLayout.bandTop - 6 && svgY <= gelLayout.dyeY + 6) {
                                      setCursorY(svgY);
                                    } else {
                                      setCursorY(null);
                                    }
                                  }}
                                  onMouseLeave={() => {
                                    setCursorY(null);
                                    setHoveredBand(null);
                                  }}
                                >
                                  {drawGel(gelLabelSize, hoveredBand?.id)}

                                  {/* Interactive Crosshair Caliper Line & Estimated Bp Badge (screen only) */}
                                  {cursorY !== null && (
                                    <g pointerEvents="none">
                                      <line
                                        x1={gelLayout.frameLeft + 4}
                                        y1={cursorY}
                                        x2={gelLayout.frameRight - 4}
                                        y2={cursorY}
                                        stroke={currentStain.crosshairColor}
                                        strokeWidth={1}
                                        strokeDasharray="3 3"
                                        opacity={0.75}
                                      />
                                      <rect
                                        x={gelLayout.frameLeft + 4}
                                        y={cursorY - (gelLabelSize + 7) / 2}
                                        width={Math.max(64, gelLabelSize * 0.62 * 10 + 8)}
                                        height={gelLabelSize + 7}
                                        rx={4}
                                        fill={currentStain.tooltipBg}
                                        stroke={currentStain.crosshairColor}
                                        strokeWidth={1}
                                      />
                                      <text
                                        x={gelLayout.frameLeft + 4 + Math.max(64, gelLabelSize * 0.62 * 10 + 8) / 2}
                                        y={cursorY + gelLabelSize * 0.35}
                                        textAnchor="middle"
                                        fontSize={gelLabelSize}
                                        fontFamily="var(--font-mono, monospace)"
                                        fontWeight={700}
                                        fill={currentStain.tooltipText}
                                      >
                                        ~{yToEstimatedBp(cursorY, gelLayout).toLocaleString()} bp
                                      </text>
                                    </g>
                                  )}
                                </svg>
                              </div>

                              {/* Live readout under the gel: the stain and run, or the band or position under the cursor */}
                              <div
                                className="mbc-aln-gel-readout"
                                style={{
                                  background: currentStain.tooltipBg,
                                  color: currentStain.tooltipText,
                                  border: `1px solid ${currentStain.crosshairColor}`,
                                }}
                              >
                                {hoveredBand ? (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      flexWrap: 'wrap',
                                      width: '100%',
                                    }}
                                  >
                                    <span style={{ fontWeight: 700, color: currentStain.crosshairColor }}>
                                      Lane {hoveredBand.laneIndex}: {hoveredBand.laneLabel}
                                    </span>
                                    <span>•</span>
                                    <span>
                                      Size: <strong>{hoveredBand.sizeBp.toLocaleString()} bp</strong>
                                    </span>
                                    <span>•</span>
                                    <span>
                                      Mobility: <strong>Rf {hoveredBand.rf.toFixed(3)}</strong>
                                    </span>
                                    <span>•</span>
                                    <span>
                                      Signal: <strong>{hoveredBand.intensityPct}%</strong>
                                    </span>
                                    {hoveredBand.enzyme && (
                                      <>
                                        <span>•</span>
                                        <span>
                                          Cut: <strong>{hoveredBand.enzyme}</strong>
                                        </span>
                                      </>
                                    )}
                                    {hoveredBand.start && hoveredBand.end && (
                                      <span style={{ opacity: 0.8, fontSize: 11 }}>
                                        ({hoveredBand.start}..{hoveredBand.end})
                                      </span>
                                    )}
                                  </div>
                                ) : cursorY !== null ? (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      width: '100%',
                                    }}
                                  >
                                    <span style={{ fontWeight: 700, color: currentStain.crosshairColor }}>
                                      Gel Caliper Cursor:
                                    </span>
                                    <span>
                                      Estimated ~<strong>{yToEstimatedBp(cursorY, gelLayout).toLocaleString()} bp</strong>
                                    </span>
                                    <span>•</span>
                                    <span>
                                      Rf <strong>{gelRf(cursorY, gelLayout).toFixed(3)}</strong>
                                    </span>
                                    <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
                                      Hover over a band for exact metrics
                                    </span>
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      width: '100%',
                                    }}
                                  >
                                    <span>
                                      <strong style={{ color: currentStain.crosshairColor }}>
                                        {currentStain.name}
                                      </strong>{' '}
                                      • {gelAgarosePct}% Agarose in {gelBufferType} Buffer
                                    </span>
                                    <span style={{ fontSize: 11, opacity: 0.75 }}>
                                      Hover gel to measure mobility
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Quick actions */}
                            <div className="mbc-aln-gel-actions">
                              <button
                                type="button"
                                className="btn-secondary-sm"
                                onClick={handleExportGelSvg}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                title="Download high-resolution vector SVG of this virtual gel"
                              >
                                <Download size={13} />
                                <span>Export Gel (SVG)</span>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary-sm"
                                onClick={handleCopyFragmentsData}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                title="Copy fragment sizes and lanes to clipboard"
                              >
                                {gelCopyNotice ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                                <span>{gelCopyNotice ? 'Copied to Clipboard!' : 'Copy Data'}</span>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary-sm"
                                onClick={() => setGelShowFragmentsTable((v) => !v)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                              >
                                {gelShowFragmentsTable ? <EyeOff size={13} /> : <Eye size={13} />}
                                <span>
                                  {gelShowFragmentsTable ? 'Hide Table' : 'Show Table'}
                                </span>
                              </button>
                            </div>

                            {/* Expandable Fragments Table */}
                            {gelShowFragmentsTable && (
                              <div className="mbc-aln-gel-table-scroll">
                                <table className="mbc-aln-data-table" style={{ width: '100%' }}>
                                  <thead>
                                    <tr>
                                      <th>Lane</th>
                                      <th>Sequence / Sample</th>
                                      <th style={{ textAlign: 'right' }}>Size (bp)</th>
                                      <th>Enzyme</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {virtualGelLanes.flatMap((lane) =>
                                      lane.bands.map((b) => (
                                        <tr key={`tbl-${lane.id}-${b.id}`}>
                                          <td>{lane.laneIndex}</td>
                                          <td>{b.label}</td>
                                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                            {b.sizeBp.toLocaleString()} bp
                                          </td>
                                          <td>{b.enzyme || '—'}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Gel and darkroom controls, across the panel under the gel */}
                            <div className="mbc-aln-group-box mbc-aln-gel-controls">
                              <strong>Gel & Darkroom Controls</strong>

                              {/* Quick Stain Presets */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: 11, color: 'var(--mbc-text-muted)' }}>
                                  Stain & Transilluminator Theme:
                                </span>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, 1fr)',
                                    gap: 6,
                                  }}
                                >
                                  {VIRTUAL_GEL_STAINS.map((stain) => {
                                    const isActive = gelStainPreset === stain.id;
                                    return (
                                      // The accessible name begins with the name the button shows (WCAG 2.5.3),
                                      // then the full name, which is also its title. Chosen, it is the studio's
                                      // selected toggle (.method-tab-btn.active: Signal Blue, Night Sky Blue in the
                                      // dark theme); at rest, a DESIGN.md secondary button from App.css's tokens.
                                      // The swatch carries the stain's own colours.
                                      <button
                                        key={stain.id}
                                        type="button"
                                        className={isActive ? 'method-tab-btn active' : 'method-tab-btn'}
                                        aria-label={`${stain.shortName}, ${stain.name}`}
                                        title={stain.name}
                                        aria-pressed={isActive}
                                        onClick={() => setGelStainPreset(stain.id)}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          padding: '6px 8px',
                                          borderRadius: 'var(--mbc-radius-sm)',
                                          fontSize: 11,
                                          fontWeight: 600,
                                          ...(isActive
                                            ? {}
                                            : {
                                                background: 'var(--mbc-bg-canvas)',
                                                color: 'var(--mbc-text-main)',
                                                border: '1px solid var(--mbc-border-strong)',
                                              }),
                                        }}
                                      >
                                        {/* The stain as it looks: its gel's colour holding one band in its band colour */}
                                        <span
                                          aria-hidden="true"
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            flexShrink: 0,
                                            boxSizing: 'border-box',
                                            width: 20,
                                            height: 14,
                                            padding: '0 4px',
                                            borderRadius: 4,
                                            border: '1px solid var(--mbc-border, #334155)',
                                            background: stain.gelBg,
                                          }}
                                        >
                                          <span style={{ flex: 1, height: 4, background: stain.bandBody }} />
                                        </span>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {stain.shortName}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* UV Camera Exposure Slider */}
                              <label
                                className="mbc-aln-field-row"
                                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 11,
                                  }}
                                >
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Sliders size={12} />
                                    <span>UV Exposure / Gain:</span>
                                  </span>
                                  <strong>{gelExposurePct}%</strong>
                                </div>
                                <input
                                  type="range"
                                  min={50}
                                  max={200}
                                  step={5}
                                  value={gelExposurePct}
                                  onChange={(e) => setGelExposurePct(Number(e.target.value))}
                                  style={{ width: '100%', cursor: 'pointer' }}
                                />
                              </label>

                              {/* Agarose % Selector */}
                              <label className="mbc-aln-field-row">
                                <span>Agarose %:</span>
                                <select
                                  value={gelAgarosePct}
                                  onChange={(e) => setGelAgarosePct(Number(e.target.value))}
                                >
                                  <option value={0.7}>0.7% (High MW: 1–15 kb)</option>
                                  <option value={1.0}>1.0% (Standard: 0.5–10 kb)</option>
                                  <option value={1.2}>1.2% (General: 0.3–6 kb)</option>
                                  <option value={1.5}>1.5% (Medium: 0.2–4 kb)</option>
                                  <option value={2.0}>2.0% (Small DNA: 50–1,000 bp)</option>
                                </select>
                              </label>

                              {/* Buffer Type */}
                              <label className="mbc-aln-field-row">
                                <span>Buffer:</span>
                                <select
                                  value={gelBufferType}
                                  onChange={(e) =>
                                    setGelBufferType(e.target.value as 'TAE' | 'TBE' | 'SB')
                                  }
                                >
                                  <option value="TAE">TAE (Tris-Acetate-EDTA)</option>
                                  <option value="TBE">TBE (Tris-Borate-EDTA)</option>
                                  <option value="SB">SB (Sodium Borate)</option>
                                </select>
                              </label>

                              {/* Molecular Weight Ladder */}
                              <label className="mbc-aln-field-row">
                                <span>MW Ladder:</span>
                                <select
                                  value={gelLadderName}
                                  onChange={(e) =>
                                    setGelLadderName(
                                      e.target.value as
                                        | '10bp DNA Ladder'
                                        | '100bp DNA Ladder'
                                        | '1kb DNA Ladder'
                                        | '1kb Plus DNA Ladder'
                                    )
                                  }
                                >
                                  <option value="10bp DNA Ladder">10bp DNA Ladder</option>
                                  <option value="100bp DNA Ladder">100bp DNA Ladder</option>
                                  <option value="1kb DNA Ladder">1kb DNA Ladder</option>
                                  <option value="1kb Plus DNA Ladder">1kb Plus DNA Ladder</option>
                                </select>
                              </label>

                              {/* Band Intensity Mode */}
                              <label className="mbc-aln-field-row">
                                <span>Band Intensity:</span>
                                <select
                                  value={gelBandIntensity}
                                  onChange={(e) =>
                                    setGelBandIntensity(
                                      e.target.value as 'Relative to DNA mass' | 'Uniform'
                                    )
                                  }
                                >
                                  <option value="Relative to DNA mass">
                                    Relative to DNA mass
                                  </option>
                                  <option value="Uniform">Uniform</option>
                                </select>
                              </label>

                              {/* Restriction Digest Simulation */}
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={gelDigestSingleEnzyme}
                                  onChange={(e) => setGelDigestSingleEnzyme(e.target.checked)}
                                />
                                <span>Digest by single enzymes</span>
                              </label>
                              {gelDigestSingleEnzyme && (
                                <label className="mbc-aln-field-row">
                                  <span>Enzyme:</span>
                                  <select
                                    value={gelDigestEnzymeName}
                                    onChange={(e) => setGelDigestEnzymeName(e.target.value)}
                                  >
                                    <option value="EcoRI">EcoRI (GAATTC)</option>
                                    <option value="BamHI">BamHI (GGATCC)</option>
                                    <option value="HindIII">HindIII (AAGCTT)</option>
                                    <option value="PstI">PstI (CTGCAG)</option>
                                    <option value="TaqI">TaqI (TCGA)</option>
                                  </select>
                                </label>
                              )}

                              {/* Visual Annotations Toggles */}
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 4,
                                  borderTop: '1px solid var(--mbc-border)',
                                  paddingTop: 8,
                                }}
                              >
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={gelShowLaneNames}
                                    onChange={(e) => setGelShowLaneNames(e.target.checked)}
                                  />
                                  <span>Show lane names & numbers</span>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={gelShowMwLabels}
                                    onChange={(e) => setGelShowMwLabels(e.target.checked)}
                                  />
                                  <span>Show MW ladder numbers</span>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={gelShowDyeFront}
                                    onChange={(e) => setGelShowDyeFront(e.target.checked)}
                                  />
                                  <span>Show dye front (bromophenol blue)</span>
                                </label>
                                <label className="mbc-aln-check-inline">
                                  <input
                                    type="checkbox"
                                    checked={gelShowLaneTracks}
                                    onChange={(e) => setGelShowLaneTracks(e.target.checked)}
                                  />
                                  <span>Show lane running tracks</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Analysis panel: Restriction fragments of the members */}
                      {shownInspectorTab === 'fragments' && (
                        <div className="mbc-aln-analysis-panel">
                          <div className="mbc-aln-action-toolbar">
                            <div className="mbc-aln-toolbar-left">
                              <label className="mbc-aln-check-inline">
                                <input
                                  type="checkbox"
                                  checked={gelDigestSingleEnzyme}
                                  onChange={(e) => setGelDigestSingleEnzyme(e.target.checked)}
                                />
                                <span>Simulate restriction digest</span>
                              </label>
                              <label className="mbc-aln-inline-select">
                                <span>Enzyme:</span>
                                <select
                                  value={gelDigestEnzymeName}
                                  onChange={(e) => {
                                    setGelDigestEnzymeName(e.target.value);
                                    setGelDigestSingleEnzyme(true);
                                  }}
                                >
                                  <option value="TaqI">TaqI (TCGA)</option>
                                  <option value="EcoRI">EcoRI (GAATTC)</option>
                                  <option value="BamHI">BamHI (GGATCC)</option>
                                  <option value="HindIII">HindIII (AAGCTT)</option>
                                  <option value="PstI">PstI (CTGCAG)</option>
                                </select>
                              </label>
                            </div>
                          </div>

                          {!gelDigestSingleEnzyme || virtualGelAndFragments.digestedFragments.length === 0 ? (
                            <div
                              style={{
                                padding: '48px 24px',
                                textAlign: 'center',
                                color: 'var(--mbc-text-muted)',
                              }}
                            >
                              <h4 style={{ margin: '0 0 6px 0', color: 'var(--mbc-text)' }}>
                                No Fragment Data
                              </h4>
                              <p style={{ margin: '0 0 12px 0', fontSize: 12 }}>
                                The selected documents do not contain restriction sites
                              </p>
                              <button
                                type="button"
                                className="btn-primary-sm"
                                onClick={() => {
                                  setGelDigestEnzymeName('TaqI');
                                  setGelDigestSingleEnzyme(true);
                                }}
                              >
                                Find TaqI Restriction Fragments
                              </button>
                            </div>
                          ) : (
                            <div className="mbc-aln-table-scroll">
                              <table className="mbc-aln-data-table">
                                <thead>
                                  <tr>
                                    <th>Sequence Name</th>
                                    <th>Enzyme</th>
                                    <th style={{ textAlign: 'right' }}>Start</th>
                                    <th style={{ textAlign: 'right' }}>End</th>
                                    <th style={{ textAlign: 'right' }}>Fragment Length (bp)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {virtualGelAndFragments.digestedFragments.map((fr) => (
                                    <tr key={fr.id}>
                                      <td>
                                        <strong>{fr.seqName}</strong>
                                      </td>
                                      <td>{fr.enzyme}</td>
                                      <td style={{ textAlign: 'right' }}>{fr.start.toLocaleString()}</td>
                                      <td style={{ textAlign: 'right' }}>{fr.end.toLocaleString()}</td>
                                      <td style={{ textAlign: 'right' }}>
                                        {fr.length.toLocaleString()} bp
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Vertical icon rail: the settings tabs, then the analyses */}
                    <div
                      className="mbc-aln-inspector-rail"
                      role="tablist"
                      aria-label="Alignment Inspector Tabs"
                    >
                      {INSPECTOR_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          title={tab.label}
                          aria-label={tab.label}
                          aria-selected={shownInspectorTab === tab.id}
                          className={`mbc-aln-rail-btn ${
                            shownInspectorTab === tab.id ? 'active' : ''
                          }${tab.id === ANALYSIS_PANELS[0] ? ' is-group-start' : ''}`}
                          onClick={() => setInspectorTab(tab.id)}
                        >
                          {tab.icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  )}
                </div>
              </>
            )}

            {/* Chromatogram view (real trace data only), chosen on the mode strip */}
            {shownMsaFigure === 'chromatogram' && (
              <div className="mbc-aln-subview-panel">
                <AlignmentTraceViewer traces={traceEntries} />
              </div>
            )}

            {/* QC Report view (computed from the actual reads), chosen on the mode strip */}
            {shownMsaFigure === 'qc-report' && (
              <div className="mbc-aln-subview-panel">
                <ReadQcReport
                  isProtein={alignmentStats.isProtein}
                  reads={msaRes.rows.map((r) => ({
                    name: r.name,
                    sequence: r.alignedSeq.replace(/-/g, ''),
                  }))}
                />
              </div>
            )}
          </div>
        )}

        {alignSubMode === 'pairwise' && (
          <div className="mbc-pw-panel">
            <div className="mbc-pw-setup">
              <fieldset className="mbc-pw-fieldset">
                <legend>Sequences</legend>
                <label className="form-field">
                  <span>Sequence A (reference)</span>
                  <select value={doc1.id} onChange={(e) => setSeq1Id(e.target.value)}>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.sequence.length.toLocaleString()} {d.moleculeType === 'Protein' ? 'aa' : 'bp'})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Sequence B (query)</span>
                  <select value={doc2.id} onChange={(e) => setSeq2Id(e.target.value)}>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.sequence.length.toLocaleString()} {d.moleculeType === 'Protein' ? 'aa' : 'bp'})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary-sm mbc-pw-swap"
                  title="Swap sequences A and B"
                  onClick={() => {
                    const a = doc1.id;
                    setSeq1Id(doc2.id);
                    setSeq2Id(a);
                  }}
                >
                  ⇅ Swap
                </button>
              </fieldset>
              {pairwiseSettings('Algorithm', 1, (
                <>
                  <label className="form-field">
                    <span>Method</span>
                    <select
                      value={pairwiseMode}
                      onChange={(e) => setPairwiseMode(e.target.value as PairwiseAlgorithmOption)}
                    >
                      <option value="nw">Needleman-Wunsch (Global Affine Gap)</option>
                      <option value="sw">Smith-Waterman (Local Affine Gap)</option>
                      <option value="banded-nw">Banded k-mer DP (global, long sequences)</option>
                      <option value="banded-sw">Banded k-mer DP (local, long sequences)</option>
                    </select>
                  </label>
                  {pairwiseIsProtein && !pairwiseMode.startsWith('banded') && (
                    <label className="form-field">
                      <span>Substitution matrix</span>
                      <select
                        value={pwProteinMatrix}
                        onChange={(e) => setPwProteinMatrix(e.target.value as 'blosum62' | 'pam250')}
                      >
                        <option value="blosum62">BLOSUM62</option>
                        <option value="pam250">PAM250</option>
                      </select>
                    </label>
                  )}
                  <p className="mbc-pw-note">
                    {pairwiseMode.startsWith('banded')
                      ? `Banded DP (k = 6, band = 24) for inputs up to 25,000 residues${pairwiseIsProtein ? '; proteins are scored by identity (+5 / −4)' : ''}.`
                      : 'Exact Gotoh dynamic programming; inputs up to 2,400 residues.'}
                  </p>
                </>
              ))}
              {pairwiseSettings('Scoring', 2, (
                <>
                  <div className="mbc-pw-score-grid">
                    {!pairwiseIsProtein && (
                      <>
                        <label className="form-field">
                          <span>Match</span>
                          <input type="number" min={1} max={20} value={pwMatch}
                            onChange={(e) => setPwMatch(Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))))} />
                        </label>
                        <label className="form-field">
                          <span>Mismatch</span>
                          <input type="number" min={-20} max={-1} value={pwMismatch}
                            onChange={(e) => setPwMismatch(-Math.max(1, Math.min(20, Math.abs(Math.round(Number(e.target.value) || 1)))))} />
                        </label>
                      </>
                    )}
                    <label className="form-field">
                      <span>Gap open</span>
                      <input type="number" min={0} max={50}
                        value={pairwiseIsProtein ? pwProteinGapOpen : pwGapOpen}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(50, Math.abs(Math.round(Number(e.target.value) || 0))));
                          if (pairwiseIsProtein) setPwProteinGapOpen(v); else setPwGapOpen(v);
                        }} />
                    </label>
                    <label className="form-field">
                      <span>Gap extend</span>
                      <input type="number" min={1} max={20}
                        value={pairwiseIsProtein ? pwProteinGapExtend : pwGapExtend}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(20, Math.abs(Math.round(Number(e.target.value) || 1))));
                          if (pairwiseIsProtein) setPwProteinGapExtend(v); else setPwGapExtend(v);
                        }} />
                    </label>
                  </div>
                  <div className="mbc-pw-note-row">
                    <p className="mbc-pw-note">A gap of length k costs open + k × extend.</p>
                    <button
                      type="button"
                      className="mbc-aln-link-btn"
                      onClick={() => {
                        setPwMatch(2); setPwMismatch(-3); setPwGapOpen(5); setPwGapExtend(2);
                        setPwProteinMatrix('blosum62'); setPwProteinGapOpen(11); setPwProteinGapExtend(1);
                      }}
                    >
                      Reset defaults
                    </button>
                  </div>
                </>
              ))}
            </div>

            {pairwiseInputError && <div role="alert" className="mbc-aln-empty">{pairwiseInputError}</div>}

            {pairwiseRes && (
              <>
                <div className="mbc-pw-kpis">
                  {(() => {
                    const cols = Math.max(1, pairwiseRes.alignedSeq1.length);
                    const idPct = pairwiseRes.identityPct ?? 0;
                    const simPct = pairwiseRes.similarityPct ?? idPct;
                    const gapPct = Math.round((pairwiseRes.gaps / cols) * 1000) / 10;
                    const items = [
                      { label: 'Identity', value: `${idPct}%`, sub: `${pairwiseRes.matches.toLocaleString()} / ${cols.toLocaleString()} columns`, meter: idPct, tone: 'id' },
                      { label: pairwiseIsProtein ? 'Similarity' : 'Similarity (IUPAC)', value: `${simPct}%`, sub: pairwiseIsProtein ? `positive ${pwProteinMatrix.toUpperCase()} scores` : 'identical or compatible', meter: simPct, tone: 'sim' },
                      { label: 'Gaps', value: `${gapPct}%`, sub: `${pairwiseRes.gaps.toLocaleString()} gap columns`, meter: gapPct, tone: 'gap' },
                      { label: 'Score', value: pairwiseRes.score.toLocaleString(), sub: `${pairwiseRes.mismatches.toLocaleString()} mismatches`, meter: null, tone: 'score' },
                    ];
                    return items.map((k) => (
                      <div key={k.label} className={`mbc-pw-kpi is-${k.tone}`}>
                        <span className="mbc-pw-kpi-label">{k.label}</span>
                        <strong className="mbc-pw-kpi-value">{k.value}</strong>
                        {k.meter !== null && (
                          <span className="mbc-pw-meter" aria-hidden="true">
                            <span style={{ width: `${Math.max(0, Math.min(100, k.meter))}%` }} />
                          </span>
                        )}
                        <span className="mbc-pw-kpi-sub">{k.sub}</span>
                      </div>
                    ));
                  })()}
                </div>
                <div className="mbc-pw-meta">
                  <span>{pairwiseRes.algorithm}</span>
                  {pairwiseRes.xstart !== undefined && (
                    <span>
                      A {pairwiseRes.xstart.toLocaleString()}–{(pairwiseRes.xend ?? 0).toLocaleString()} · B {(pairwiseRes.ystart ?? 1).toLocaleString()}–{(pairwiseRes.yend ?? 0).toLocaleString()}
                    </span>
                  )}
                  {pairwiseRes.cigar && (
                    <code title={pairwiseRes.cigar}>
                      CIGAR {pairwiseRes.cigar.length > 120 ? `${pairwiseRes.cigar.slice(0, 120)}…` : pairwiseRes.cigar}
                    </code>
                  )}
                </div>
                <PairwiseAlignmentView
                  nameA={doc1.name}
                  nameB={doc2.name}
                  alignedA={pairwiseRes.alignedSeq1}
                  alignedB={pairwiseRes.alignedSeq2}
                  midline={pairwiseRes.midline}
                  startA={pairwiseMode === 'sw' || pairwiseMode === 'banded-sw' ? pairwiseRes.xstart ?? 1 : 1}
                  startB={pairwiseMode === 'sw' || pairwiseMode === 'banded-sw' ? pairwiseRes.ystart ?? 1 : 1}
                />
              </>
            )}
          </div>
        )}

        {alignSubMode === 'dotplot' && (
          dotplotSequences.length ? (
            <AlignmentDotplot
              sequences={dotplotSequences}
              isProtein={activeDoc.moleculeType === 'Protein'}
            />
          ) : (
            <div className="mbc-aln-empty">Open at least one {activeDoc.moleculeType === 'Protein' ? 'protein' : 'nucleotide'} sequence to draw a dotplot.</div>
          )
        )}
      </div>
    </div>
  );
};

export const PhylogeneticsStudio: React.FC<PhylogeneticsStudioProps> = ({
  documents,
  activeDoc: _activeDoc,
  initialPhyloTab = 'phylogeny',
  initialTreeAlgorithm = 'Maximum Likelihood (ML)',
  initialModelsSubView = 'best-models',
  initialAncestralMethod = 'Maximum Likelihood (Empirical Bayes)',
  commandNonce = 0,
}) => {
  const [evoTab, setEvoTab] = useState<PhyloModuleTab>(initialPhyloTab);

  // Data & Models state
  const [modelsSubView, setModelsSubView] =
    useState<ModelsSubViewId>(initialModelsSubView);

  // Distance & Phylogeny state
  const [distanceModel, setDistanceModel] = useState<SubstitutionModelName>('Tamura-Nei (TN93)');
  const [treeAlgorithm, setTreeAlgorithm] =
    useState<PhyloTreeAlgorithm>(initialTreeAlgorithm);
  const [treeModel, setTreeModel] = useState<SubstitutionModelName>('Tamura-Nei (TN93)');
  const [bootstrapReps, setBootstrapReps] = useState<number>(500);
  const [treeLayout, setTreeLayout] = useState<'phylogram' | 'cladogram' | 'radial'>(
    'phylogram'
  );
  const [showBootstrap, setShowBootstrap] = useState<boolean>(true);

  // User Tree state
  const [customNewickText, setCustomNewickText] = useState<string>('');

  // Ancestors state
  const [ancestralMethod, setAncestralMethod] =
    useState<AncestralInferenceMethod>(initialAncestralMethod);

  // Clocks & Timetree state
  const [clockMethod, setClockMethod] = useState<ClockMethod>('RelTime-ML');
  const [calibrationMya, setCalibrationMya] = useState<number>(42.5);
  const [calibrationDraft, setCalibrationDraft] = useState<string>('42.5');

  // Diagnose Mutation state
  const [diagPosAa, setDiagPosAa] = useState<number>(66);
  const [diagWtAa, setDiagWtAa] = useState<string>('Y');
  const [diagMutAa, setDiagMutAa] = useState<string>('H');

  useEffect(() => {
    setEvoTab(initialPhyloTab);
  }, [initialPhyloTab, commandNonce]);

  useEffect(() => {
    setTreeAlgorithm(initialTreeAlgorithm);
  }, [initialTreeAlgorithm, commandNonce]);

  useEffect(() => {
    setModelsSubView(initialModelsSubView);
  }, [initialModelsSubView, commandNonce]);

  useEffect(() => {
    setAncestralMethod(initialAncestralMethod);
  }, [initialAncestralMethod, commandNonce]);

  // Input alignment: members of an aligned document (equal lengths) are used exactly as given;
  // unaligned inputs are aligned once with the validated MSA engine. Nothing is truncated.
  const phyloAlignment = useMemo(() => {
    const docs = documents.filter((d) => d.sequence.length > 0);
    // Equal length alone is not an alignment: only rows of a stored alignment
    // (or gapped equal-length rows) are used as given; others are aligned.
    const preAligned = isPreAlignedInputSet(docs);
    // Groups are read as the analysis menu reads them (groupOf in operationRunners.ts).
    if (preAligned) {
      return {
        ids: docs.map((d) => d.id),
        names: docs.map((d) => d.name),
        seqs: docs.map((d) => d.sequence.toUpperCase()),
        groups: docs.map(groupOf),
        // Codon usage reads rows that are already aligned by column.
        codonSeqs: docs.map((d) => d.sequence.toUpperCase()),
        realigned: false,
        error: null as string | null,
      };
    }
    const exec = runValidatedAlignment(
      docs.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence, moleculeType: d.moleculeType })),
      ''
    );
    const byId = new Map(docs.map((d) => [d.id, d]));
    return {
      ids: exec.result.rows.map((r) => r.id),
      names: exec.result.rows.map((r) => r.name),
      seqs: exec.result.rows.map((r) => r.alignedSeq.toUpperCase()),
      groups: exec.result.rows.map((r) => {
        const d = byId.get(r.id);
        return d ? groupOf(d) : '';
      }),
      // Codon usage needs no alignment, and the nucleotide aligner puts gaps inside codon slots:
      // each input is read on its own, ungapped, in triplets from its first base (BG01M6XBAC, D0097).
      codonSeqs: docs.map((d) => d.sequence.replace(/[-.\s]/g, '').toUpperCase()),
      realigned: true,
      error: exec.error,
    };
  }, [documents]);
  const taxaNames = phyloAlignment.names;
  const alignedSeqs = phyloAlignment.seqs;
  const taxonGroups = phyloAlignment.groups;
  const distinctGroups = useMemo(
    () => Array.from(new Set(taxonGroups.filter(Boolean))),
    [taxonGroups]
  );
  // Percent identity of each row to the majority-rule consensus (gaps ignored).
  const identityToConsensus = useMemo(() => {
    const width = alignedSeqs[0]?.length ?? 0;
    const consensus: string[] = [];
    for (let c = 0; c < width; c++) {
      const counts = new Map<string, number>();
      for (const s of alignedSeqs) {
        const ch = s[c];
        if (ch && ch !== '-' && ch !== '?' && ch !== '.') counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
      let best = '-';
      let bestN = 0;
      counts.forEach((n, ch) => {
        if (n > bestN) {
          best = ch;
          bestN = n;
        }
      });
      consensus.push(best);
    }
    return alignedSeqs.map((s) => {
      let same = 0;
      let compared = 0;
      for (let c = 0; c < width; c++) {
        if (s[c] === '-' || consensus[c] === '-') continue;
        compared += 1;
        if (s[c] === consensus[c]) same += 1;
      }
      return compared ? Math.round((1000 * same) / compared) / 10 : null;
    });
  }, [alignedSeqs]);

  // Each analysis runs only while its module is open (several fit ML models).
  const tabIs = (...tabs: PhyloModuleTab[]) => tabs.includes(evoTab);
  const dataExploration = useMemo(
    () => (tabIs('data') ? exploreActiveAlignmentData(alignedSeqs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alignedSeqs, evoTab]
  );
  // ML model selection fits 24 models; it runs when the user asks for it.
  const [bestModels, setBestModels] = useState<ModelSelectionRankingRow[] | null>(null);
  const [bestModelsBusy, setBestModelsBusy] = useState(false);
  useEffect(() => {
    setBestModels(null);
  }, [alignedSeqs]);
  const runModelSelection = () => {
    setBestModelsBusy(true);
    window.setTimeout(() => {
      try {
        setBestModels(findBestSubstitutionModels(alignedSeqs));
      } finally {
        setBestModelsBusy(false);
      }
    }, 30);
  };
  // Nucleotide/codon analyses (substitution matrix, composition by codon
  // position, RSCU, dN/dS and neutrality tests) are meaningless for protein
  // alignments — they previously reported fabricated numbers (e.g. Ala/Gly
  // counted as A/G). They are skipped and the tab says why.
  const isNucleotidePhyloAlignment = useMemo(() => isNucleotideAlignmentRows(alignedSeqs), [alignedSeqs]);
  const substMatrixRep = useMemo(
    () =>
      isNucleotidePhyloAlignment &&
      tabIs('models') && (modelsSubView === 'rate-matrix' || modelsSubView === 'disparity')
        ? computeSubstitutionRateMatrix(taxaNames, alignedSeqs)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, evoTab, modelsSubView]
  );
  const compositionRows = useMemo(
    () =>
      isNucleotidePhyloAlignment && tabIs('models')
        ? computeNucleotideCompositionByCodonPos(taxaNames, alignedSeqs)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, evoTab]
  );
  const rscuRefusal = useMemo(
    () =>
      isNucleotidePhyloAlignment
        ? codingAlignmentRefusal(phyloAlignment.codonSeqs, 'rscu', { ownFrame: phyloAlignment.realigned })
        : null,
    [isNucleotidePhyloAlignment, phyloAlignment.codonSeqs, phyloAlignment.realigned]
  );
  const rscuRows = useMemo(
    () =>
      isNucleotidePhyloAlignment && !rscuRefusal && tabIs('models')
        ? computeRelativeSynonymousCodonUsage(phyloAlignment.codonSeqs)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNucleotidePhyloAlignment, rscuRefusal, phyloAlignment.codonSeqs, evoTab]
  );
  const distanceRep = useMemo(
    () =>
      tabIs('distance')
        ? computeEvolutionaryDistances(taxaNames, alignedSeqs, distanceModel, taxonGroups)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, distanceModel, taxonGroups, evoTab]
  );
  const diversityRep = useMemo(
    () =>
      tabIs('diversity')
        ? computePopulationDiversity(taxaNames, alignedSeqs, distanceModel, taxonGroups)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, distanceModel, taxonGroups, evoTab]
  );
  // External programs (FastTree, PhyML, RAxML, MrBayes) run in the desktop backend when
  // installed; `undefined` = still detecting, `null` = not the desktop app.
  const [extPrograms, setExtPrograms] = useState<ExternalProgramStatus[] | null | undefined>(undefined);
  const [extDetectNonce, setExtDetectNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void detectExternalTreePrograms(extDetectNonce > 0).then((r) => {
      if (live) setExtPrograms(r);
    });
    return () => {
      live = false;
    };
  }, [extDetectNonce]);
  const extAlgo = isExternalTreeAlgorithm(treeAlgorithm) ? treeAlgorithm : null;
  const extStatus = extAlgo && extPrograms ? extPrograms.find((p) => p.algorithm === extAlgo) : undefined;
  const extCanRun = !!extAlgo && !!extStatus?.available && !phyloAlignment.error && taxaNames.length >= 4;
  const extKey = extCanRun && extAlgo ? externalTreeCacheKey(extAlgo, taxaNames, alignedSeqs) : null;
  const [extRun, setExtRun] = useState<{
    key: string;
    status: 'running' | 'done' | 'error' | 'cancelled';
    result?: ExternalTreeResult;
    error?: string;
    startedAt: number;
  } | null>(null);
  const [extRetryNonce, setExtRetryNonce] = useState(0);
  const extCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!extKey || !extAlgo) return;
    const cached = cachedExternalTree(extKey);
    if (cached) {
      setExtRun({ key: extKey, status: 'done', result: cached, startedAt: 0 });
      return;
    }
    const job = runExternalTree(extAlgo, taxaNames, alignedSeqs);
    extCancelRef.current = job.cancel;
    let live = true;
    setExtRun({ key: extKey, status: 'running', startedAt: Date.now() });
    job.promise.then(
      (result) => {
        if (live) setExtRun({ key: extKey, status: 'done', result, startedAt: 0 });
      },
      (err: unknown) => {
        if (!live) return;
        const message = (err instanceof Error ? err.message : String(err)).replace(/^Tauri IPC "[^"]+"( failed)?:\s*/, '');
        setExtRun((prev) =>
          prev?.key === extKey && prev.status === 'cancelled'
            ? prev
            : { key: extKey, status: 'error', error: message, startedAt: 0 }
        );
      }
    );
    return () => {
      live = false;
      job.cancel();
      extCancelRef.current = null;
    };
    // taxaNames/alignedSeqs are captured by extKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extKey, extRetryNonce]);
  const extRunNow = extRun && extRun.key === extKey ? extRun : null;
  const [extElapsed, setExtElapsed] = useState(0);
  useEffect(() => {
    if (extRunNow?.status !== 'running') return;
    const started = extRunNow.startedAt;
    setExtElapsed(0);
    const id = setInterval(() => setExtElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [extRunNow?.status, extRunNow?.startedAt]);
  const cancelExternalRun = () => {
    if (!extKey) return;
    setExtRun((prev) => (prev && prev.key === extKey ? { ...prev, status: 'cancelled' } : prev));
    extCancelRef.current?.();
  };
  const extResult = extRunNow?.status === 'done' ? extRunNow.result : undefined;

  const builtInPhyloRep = useMemo(
    () =>
      constructPhylogeneticTree(
        taxaNames,
        alignedSeqs,
        treeAlgorithm,
        treeModel,
        // An installed external program supplies its own support values.
        tabIs('phylogeny') && !extCanRun ? bootstrapReps : 0
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, treeAlgorithm, treeModel, bootstrapReps, evoTab === 'phylogeny', extCanRun]
  );
  const extTreeEval = useMemo(
    () => (extResult ? analyzeUserTree(extResult.newick, taxaNames, alignedSeqs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extResult]
  );
  const phyloRep: PhyloTreeInferenceReport = useMemo(() => {
    if (!extResult || !extTreeEval) return builtInPhyloRep;
    const what: Record<string, string> = {
      FastTree: 'approximately-maximum-likelihood tree (NNI + SPR moves)',
      PhyML: 'maximum-likelihood tree (NNI + SPR search)',
      RAxML: 'maximum-likelihood tree (one search from a parsimony start, no bootstrap)',
      MrBayes: '50% majority-rule consensus of 2 × 100,000 MCMC generations (25% burn-in)',
    };
    const parts = [
      `${extResult.program}${extResult.version ? ` (${extResult.version})` : ''} ran on this computer in ${(extResult.runtimeMs / 1000).toFixed(1)} s: ${extResult.model} ${what[extResult.program] ?? 'tree'}.`,
      extResult.supportKind === 'none'
        ? 'No branch support was computed.'
        : `Node labels: ${extResult.supportKind} (%).`,
      extResult.programLogLikelihood !== null
        ? `${extResult.program} lnL (${extResult.model}): ${extResult.programLogLikelihood.toFixed(2)}.`
        : '',
      Number.isFinite(extTreeEval.mlLogLikelihood ?? NaN)
        ? 'The lnL card is the JC69 likelihood of this tree, comparable with the built-in methods.'
        : '',
      `Command: ${extResult.commandLine}`,
    ];
    return {
      ...builtInPhyloRep,
      algorithm: treeAlgorithm,
      bootstrapReplicates: 0,
      newick: extResult.newick,
      logLikelihood: extTreeEval.mlLogLikelihood,
      totalTreeLengthS: extResult.totalBranchLength,
      parsimonySteps: extTreeEval.parsimonyLengthSteps,
      consistencyIndexCI: extTreeEval.consistencyIndex,
      retentionIndexRI: extTreeEval.retentionIndex,
      cladeBootstraps: [],
      methodNote: parts.filter(Boolean).join(' '),
      warnings: extResult.warnings,
    };
  }, [builtInPhyloRep, extResult, extTreeEval, treeAlgorithm]);
  const treeHeading = treeMethodHeading(phyloRep.methodNote);
  // Measure the tree card so the layout is computed at its real pixel width and
  // rendered 1:1 — otherwise the SVG is stretched and 11px labels become ~16px.
  const [treeCanvasEl, setTreeCanvasEl] = useState<HTMLDivElement | null>(null);
  const [treeCanvasWidth, setTreeCanvasWidth] = useState(620);
  useEffect(() => {
    if (!treeCanvasEl || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.max(420, Math.min(1400, Math.floor(treeCanvasEl.clientWidth)));
        setTreeCanvasWidth((prev) => (Math.abs(prev - w) < 8 ? prev : w));
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(treeCanvasEl);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [treeCanvasEl]);

  // Newick export sanitises names ("M. maripaludis (Arc.)" -> "M._maripaludis__Arc._");
  // map tip labels back to the original sequence names for display.
  const tipLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const name of taxaNames) {
      const sanitized = name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'Taxon';
      if (!m.has(sanitized)) m.set(sanitized, name);
    }
    return m;
  }, [taxaNames]);
  const displayTipLabel = (raw: string): string =>
    tipLabelMap.get(raw) ?? raw.replace(/_+/g, ' ').trim();

  const phyloLayoutReport = useMemo(
    () =>
      layoutNewickPhylogeneticTreeRust(
        phyloRep.newick,
        treeLayout,
        treeLayout === 'radial' ? Math.min(treeCanvasWidth, 720) : treeCanvasWidth,
        treeLayout === 'radial'
          ? Math.min(treeCanvasWidth, 720)
          : Math.max(260, taxaNames.length * 20 + 56)
      ),
    [phyloRep.newick, treeLayout, taxaNames.length, treeCanvasWidth]
  );
  const userTreeRep = useMemo(
    () =>
      tabIs('usertree')
        ? analyzeUserTree(customNewickText || phyloRep.newick, taxaNames, alignedSeqs)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customNewickText, phyloRep.newick, taxaNames, alignedSeqs, evoTab]
  );
  const userTreeLayoutReport = useMemo(
    () =>
      layoutNewickPhylogeneticTreeRust(
        customNewickText || phyloRep.newick,
        'phylogram',
        620,
        Math.max(250, taxaNames.length * 24 + 48)
      ),
    [customNewickText, phyloRep.newick, taxaNames.length]
  );
  const ancestralRep = useMemo(
    () => (tabIs('ancestors') ? inferAncestralSequences(taxaNames, alignedSeqs, ancestralMethod) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, ancestralMethod, evoTab]
  );
  const selectionRefusal = useMemo(
    () => (isNucleotidePhyloAlignment ? codingAlignmentRefusal(alignedSeqs, 'selection') : null),
    [isNucleotidePhyloAlignment, alignedSeqs]
  );
  const selectionRep = useMemo(
    () =>
      isNucleotidePhyloAlignment && !selectionRefusal && tabIs('selection')
        ? runSelectionAndNeutralityTests(alignedSeqs)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNucleotidePhyloAlignment, selectionRefusal, alignedSeqs, evoTab]
  );
  // GFP reference variants (S65T, Y66H, ...) are only screened when sequence 1
  // actually carries the wild-type residue at that position; on any other
  // protein the rows were meaningless numbers presented as screening results.
  const gfpReferenceVariantRows = useMemo(() => {
    if (evoTab !== 'diagnose') return [];
    // No alignment (e.g. it failed): the engine compares no reference, so no
    // variant can be confirmed against sequence 1.
    if (alignedSeqs.length === 0) return [];
    return [diagnoseMissenseMutation(64, 'F', 'L', alignedSeqs),
                  diagnoseMissenseMutation(65, 'S', 'T', alignedSeqs),
                  diagnoseMissenseMutation(66, 'Y', 'H', alignedSeqs),
                  diagnoseMissenseMutation(66, 'Y', 'W', alignedSeqs),
                  diagnoseMissenseMutation(146, 'N', 'I', alignedSeqs),
                  diagnoseMissenseMutation(153, 'M', 'T', alignedSeqs),
                  diagnoseMissenseMutation(203, 'T', 'Y', alignedSeqs),
    // Keep only variants whose wild type matches sequence 1, using the engine's
    // own reference check (it reads codons for nucleotide alignments, so
    // indexing the raw sequence compared bases with amino acids).
    ].filter(wildTypeMatchesSequenceOne);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignedSeqs, evoTab]);

  const siteRatesRep = useMemo(
    () => (tabIs('rates') ? estimateGammaAndSiteRates(alignedSeqs, 5) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alignedSeqs, evoTab]
  );
  const clockRep = useMemo(
    () =>
      tabIs('clocks')
        ? runMolecularClockAndTimetree(taxaNames, alignedSeqs, clockMethod, calibrationMya)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxaNames, alignedSeqs, clockMethod, calibrationMya, evoTab]
  );
  const diagnosisRep = useMemo(
    () => diagnoseMissenseMutation(diagPosAa, diagWtAa, diagMutAa, alignedSeqs),
    [diagPosAa, diagWtAa, diagMutAa, alignedSeqs]
  );

  const activeMeta = PHYLO_MODULE_META[evoTab];

  // US-01M6TAZE: each module's parameters are settings, so in the workbench they are a section of
  // App's inspector (titled after the tab, "Tree Controls"), while the module picker stays in the top
  // bar. The modules with nothing to set (Data, Models, Diversity, Selection, Rates, User Tree,
  // Diagnose) register none, so App shows no button on them. Drawn on its own, every setting stays
  // where it sat.
  const inWorkbench = useInWorkbench();
  // In the workbench a module's one setting is a labelled field of its section; drawn on its own it
  // is the control where it always was (a card header's select).
  const moduleSetting = (title: string, label: string, control: React.ReactNode) => (
    <InspectorSection title={title} order={1}>
      {inWorkbench ? (
        <label className="form-field">
          <span>{label}</span>
          {control}
        </label>
      ) : control}
    </InspectorSection>
  );
  // With its settings in the inspector, the phylogeny module would leave a near-empty controls
  // column beside the tree, so in the workbench it leaves the figure-first layout: its heading card
  // (the method heading, the support badge and any external-program notice) sits above the tree at
  // full width (D0063 ruling b). Drawn on its own it keeps the figure-first layout (US-01M6Q1Z0).
  const figureFirst = evoTab === 'phylogeny' && !inWorkbench;
  const phylogenyControlsColumn = (headingCard: React.ReactNode) =>
    inWorkbench ? headingCard : <div className="studio-controls-column">{headingCard}</div>;

  return (
    // The phylogeny module lays out figure first, so on a wide canvas the wrapper takes the
    // canvas height and hands what the top bar leaves to the module's two columns.
    <div className={`alignment-studio-wrapper${figureFirst ? ' has-figure-first' : ''}`}>
      <div className="phylo-studio-topbar">
        <div className="phylo-studio-title-group">
          <span className="phylo-studio-category">{activeMeta.category}</span>
          <h3 className="phylo-studio-heading" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <MolBioMenuGlyph glyph={activeMeta.glyph} size={16} />
            <span>{activeMeta.title}</span>
          </h3>
        </div>
        <div className="phylo-studio-controls">
          <label className="phylo-module-picker">
            <span>Phylogenetic Analysis:</span>
            <select
              value={evoTab}
              onChange={(e) => setEvoTab(e.target.value as PhyloModuleTab)}
              aria-label="Active Phylogenetic Analysis"
            >
              <optgroup label="Tree Reconstruction & Topologies">
                <option value="phylogeny">Construct / Test Phylogenetic Tree</option>
                <option value="usertree">Analyze User Tree &amp; Gene Duplications</option>
                <option value="ancestors">Infer Ancestral Sequences (ML / MP)</option>
              </optgroup>
              <optgroup label="Substitution Models, Codons & Data">
                <option value="models">Substitution Models, Rate Matrix &amp; RSCU</option>
                <option value="data">Alignment Data Explorer &amp; Taxa Groups</option>
              </optgroup>
              <optgroup label="Evolutionary Distances & Diversity">
                <option value="distance">Pairwise, Within-Group &amp; Net Distances</option>
                <option value="diversity">Subpopulation &amp; Interpopulation Diversity (π)</option>
              </optgroup>
              <optgroup label="Selection, Site Rates & Molecular Clocks">
                <option value="selection">Codon Selection (dN/dS) &amp; Tajima&apos;s Neutrality</option>
                <option value="rates">Discrete Gamma (α) &amp; Site-by-Site Rates</option>
                <option value="clocks">Strict-Clock Timetree &amp; Molecular Clock Tests</option>
                <option value="diagnose">Diagnose Missense Variant Impact</option>
              </optgroup>
            </select>
          </label>
          <span className="badge-accent">{activeMeta.badge}</span>
        </div>
      </div>

      {phyloAlignment.error && (
        <div className="info-callout" role="alert" style={{ color: 'var(--mbc-red)', margin: '8px 0' }}>
          <strong>Automatic alignment failed, so no analysis could run.</strong>
          <div style={{ marginTop: 4 }}>{phyloAlignment.error}</div>
          <div style={{ marginTop: 4, color: 'var(--mbc-text-secondary)' }}>
            Align the sequences first (Align menu), or select a compatible subset, then reopen this view.
          </div>
        </div>
      )}

      {/* MODULE 2: DATA (Explore Active Data, Genetic Code Table, Taxa & Groups) */}
      {evoTab === 'data' && dataExploration && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Explore Active Alignment Data (Site Classification)</h3>
              <span className="badge-accent">
                {dataExploration.numTaxa} Taxa × {dataExploration.numSites} Sites
              </span>
            </div>
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Conserved Sites (C)</span>
                <strong className="kpi-val">{dataExploration.conservedSites}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Variable Sites (V)</span>
                <strong className="kpi-val">{dataExploration.variableSites}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Parsimony-Informative (Pi)</span>
                <strong className="kpi-val">
                  {dataExploration.parsimonyInformativeSites}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Singleton Sites (S)</span>
                <strong className="kpi-val">{dataExploration.singletonSites}</strong>
              </div>
            </div>

            <WorkbenchSmartTable
              tableId="phylo-data-site-categories"
              tableLabel="Alignment Site Categories"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Site Category</th>
                  <th>Count (Sites)</th>
                  <th>% of Alignment</th>
                  <th>Evolutionary Definition</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Conserved Sites (C)</strong>
                  </td>
                  <td>{dataExploration.conservedSites}</td>
                  <td>
                    {(
                      (dataExploration.conservedSites /
                        Math.max(1, dataExploration.numSites)) *
                      100
                    ).toFixed(1)}
                    %
                  </td>
                  <td>Invariant nucleotides/residues across all aligned taxa</td>
                </tr>
                <tr>
                  <td>
                    <strong>Variable Sites (V)</strong>
                  </td>
                  <td>{dataExploration.variableSites}</td>
                  <td>
                    {(
                      (dataExploration.variableSites /
                        Math.max(1, dataExploration.numSites)) *
                      100
                    ).toFixed(1)}
                    %
                  </td>
                  <td>Sites containing at least 2 distinct nucleotide/amino acid states</td>
                </tr>
                <tr>
                  <td>
                    <strong>Parsimony-Informative Sites (Pi)</strong>
                  </td>
                  <td>{dataExploration.parsimonyInformativeSites}</td>
                  <td>
                    {(
                      (dataExploration.parsimonyInformativeSites /
                        Math.max(1, dataExploration.numSites)) *
                      100
                    ).toFixed(1)}
                    %
                  </td>
                  <td>
                    Sites with ≥ 2 distinct states each occurring in ≥ 2 sequences
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Singleton Sites (S)</strong>
                  </td>
                  <td>{dataExploration.singletonSites}</td>
                  <td>
                    {(
                      (dataExploration.singletonSites /
                        Math.max(1, dataExploration.numSites)) *
                      100
                    ).toFixed(1)}
                    %
                  </td>
                  <td>Polymorphic sites where minority variants appear only once</td>
                </tr>
                <tr>
                  <td>
                    <strong>0-Fold / 2-Fold / 4-Fold Degenerate</strong>
                  </td>
                  <td>
                    {dataExploration.zeroFoldDegenerateSites} /{' '}
                    {dataExploration.twoFoldDegenerateSites} /{' '}
                    {dataExploration.fourFoldDegenerateSites}
                  </td>
                  <td>100%</td>
                  <td>Codon degeneracy classes for synonymous vs nonsynonymous tests</td>
                </tr>
              </tbody>
            </WorkbenchSmartTable>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Taxa &amp; Groups</h3>
              <span className="badge-accent">
                {distinctGroups.length > 0 ? `${distinctGroups.length} groups` : 'No groups defined'}
              </span>
            </div>
            <div className="info-callout" style={{ marginBottom: 8 }}>
              Codon analyses use the Standard genetic code (NCBI table 1).{' '}
              {phyloAlignment.realigned
                ? 'The inputs were unaligned and have been aligned with the MSA engine.'
                : 'The opened alignment is used exactly as aligned.'}{' '}
              Groups come from a sequence&apos;s <code>Group</code> metadata field or <code>Group: …</code> in its description; sequences without one are ungrouped.
            </div>
            <WorkbenchSmartTable
              tableId="phylo-subpopulation-taxa"
              tableLabel="Taxa and Groups"
              className="bio-table"
              regionMaxHeight={230}
            >
              <thead>
                <tr>
                  <th>Taxon Name</th>
                  <th>Group</th>
                  <th>Aligned Length</th>
                  <th>Identity to Consensus</th>
                </tr>
              </thead>
              <tbody>
                {taxaNames.map((name, idx) => (
                  <tr key={phyloAlignment.ids[idx] ?? idx}>
                    <td>
                      <strong>{name}</strong>
                    </td>
                    <td>
                      {taxonGroups[idx] ? (
                        <span className="badge-accent">{taxonGroups[idx]}</span>
                      ) : (
                        <span style={{ color: 'var(--mbc-text-secondary)' }}>—</span>
                      )}
                    </td>
                    <td>{alignedSeqs[idx]?.length ?? 0}</td>
                    <td>{fmtStat(identityToConsensus[idx])}%</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {/* MODULE 3: MODELS (Find Best DNA/Protein Models ML, Substitution Matrix, Disparity Index, Composition, RSCU) */}
      {!isNucleotidePhyloAlignment && alignedSeqs.length > 0 && (evoTab === 'models' || evoTab === 'selection') && (
        <div className="info-callout" role="status" style={{ marginBottom: 8 }}>
          This is a protein alignment. Nucleotide substitution matrices, codon-position composition,
          codon usage (RSCU) and dN/dS / neutrality tests need a nucleotide (coding) alignment and are not computed.
        </div>
      )}

      {evoTab === 'models' && (
        <div className="studio-card">
          <div className="studio-card-header">
            <ScrollableMenuStrip
              className="mbc-scroll-strip--pills"
              trackClassName="cloning-method-tabs"
              role="tablist"
              ariaLabel="Substitution Model Analyses"
              alwaysShowArrows
              activeKey={modelsSubView}
              enableSpatialArrowNav
              activateOnSpatialFocus
              prevAriaLabel="Slide model analyses left"
              nextAriaLabel="Slide model analyses right"
            >
              <button
                type="button"
                role="tab"
                tabIndex={modelsSubView === 'best-models' ? 0 : -1}
                aria-selected={modelsSubView === 'best-models'}
                className={`method-tab-btn ${
                  modelsSubView === 'best-models' ? 'active' : ''
                }`}
                onClick={() => setModelsSubView('best-models')}
              >
                Find Best DNA/Protein Models (ML)
              </button>
              <button
                type="button"
                role="tab"
                tabIndex={modelsSubView === 'rate-matrix' ? 0 : -1}
                aria-selected={modelsSubView === 'rate-matrix'}
                className={`method-tab-btn ${
                  modelsSubView === 'rate-matrix' ? 'active' : ''
                }`}
                onClick={() => setModelsSubView('rate-matrix')}
              >
                Substitution Matrix &amp; Ti/Tv Bias (ML/MCL)
              </button>
              <button
                type="button"
                role="tab"
                tabIndex={modelsSubView === 'disparity' ? 0 : -1}
                aria-selected={modelsSubView === 'disparity'}
                className={`method-tab-btn ${
                  modelsSubView === 'disparity' ? 'active' : ''
                }`}
                onClick={() => setModelsSubView('disparity')}
              >
                Disparity Index Test of Pattern Heterogeneity
              </button>
              <button
                type="button"
                role="tab"
                tabIndex={modelsSubView === 'composition' ? 0 : -1}
                aria-selected={modelsSubView === 'composition'}
                className={`method-tab-btn ${
                  modelsSubView === 'composition' ? 'active' : ''
                }`}
                onClick={() => setModelsSubView('composition')}
              >
                Nucleotide Composition (1st/2nd/3rd Codon)
              </button>
              <button
                type="button"
                role="tab"
                tabIndex={modelsSubView === 'rscu' ? 0 : -1}
                aria-selected={modelsSubView === 'rscu'}
                className={`method-tab-btn ${modelsSubView === 'rscu' ? 'active' : ''}`}
                onClick={() => setModelsSubView('rscu')}
              >
                Codon Usage Bias (RSCU)
              </button>
            </ScrollableMenuStrip>
          </div>

          {modelsSubView === 'best-models' && (
            <div>
              <div className="info-callout" style={{ marginBottom: 8 }}>
                Each of 24 GTR-family models (JC, K2, T92, HKY, TN93, GTR; ±G with 4 categories; ±I) is fitted by
                maximum likelihood on the Neighbor-Joining tree, with branch lengths and model parameters
                optimised. Lowest <strong>BIC</strong> is best; k counts 2n−3 branch
                lengths plus model parameters (base frequencies included).{' '}
                {bestModels && bestModels.length > 0 && (
                  <>
                    Best-fit model: <strong>{bestModels[0].model}</strong> (BIC = {bestModels[0].bic}, lnL ={' '}
                    {bestModels[0].logLikelihood}).
                  </>
                )}
              </div>
              {!isNucleotidePhyloAlignment && (
                <div className="info-callout" role="status" style={{ marginBottom: 8 }}>
                  Protein model selection is not implemented: the ML model test fits nucleotide (GTR-family) models
                  only and needs a nucleotide alignment.
                </div>
              )}
              {!bestModels && (
                <button
                  type="button"
                  className="btn-primary-sm"
                  disabled={bestModelsBusy || alignedSeqs.length < 3 || !isNucleotidePhyloAlignment}
                  title={!isNucleotidePhyloAlignment ? 'Nucleotide alignments only (protein models are not implemented)' : undefined}
                  onClick={runModelSelection}
                  style={{ marginBottom: 8 }}
                >
                  {bestModelsBusy
                    ? 'Fitting 24 models…'
                    : `Run ML model test (${alignedSeqs.length} sequences × ${alignedSeqs[0]?.length ?? 0} sites)`}
                </button>
              )}
              {bestModels && bestModels.length === 0 && (
                <div className="info-callout">Model selection needs at least 3 aligned nucleotide sequences.</div>
              )}
              {bestModels && bestModels.length > 0 && (
              <WorkbenchSmartTable
                tableId="phylo-best-models-ml"
                tableLabel="Best-Fit Substitution Models (ML)"
                className="bio-table"
                regionMaxHeight={310}
              >
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Substitution Model</th>
                    <th>Parameters (k)</th>
                    <th>BIC</th>
                    <th>AICc</th>
                    <th>lnL</th>
                    <th>Gamma (+G α)</th>
                    <th>Invariant (+I)</th>
                    <th>Ti/Tv Ratio (R)</th>
                  </tr>
                </thead>
                <tbody>
                  {bestModels.map((m, idx) => (
                    <tr key={m.model} className={idx === 0 ? 'selected-row' : ''}>
                      <td>#{idx + 1}</td>
                      <td>
                        <strong>{m.model}</strong>
                      </td>
                      <td>{m.parametersK}</td>
                      <td>
                        <strong>{m.bic}</strong>
                      </td>
                      <td>{m.aicc}</td>
                      <td>{m.logLikelihood}</td>
                      <td>{m.gammaShapeAlpha}</td>
                      <td>{m.invariantSitesI}</td>
                      <td>{m.tiTvRatioR}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
              )}
            </div>
          )}

          {modelsSubView === 'rate-matrix' && substMatrixRep && (
            <div className="studio-split-grid">
              <div>
                <h4>Substitution Matrix (ML, Tamura-Nei + G)</h4>
                <WorkbenchSmartTable
                  tableId="phylo-mcl-rate-matrix"
                  tableLabel="ML Tamura-Nei Substitution Matrix"
                  className="bio-table"
                  wrapperStyle={{ marginTop: 8 }}
                >
                  <thead>
                    <tr>
                      <th>From \ To</th>
                      <th>A</th>
                      <th>T / U</th>
                      <th>C</th>
                      <th>G</th>
                    </tr>
                  </thead>
                  <tbody>
                    {substMatrixRep.matrix4x4.map((r) => (
                      <tr key={r.from}>
                        <td>
                          <strong>{r.from}</strong>
                        </td>
                        {[r.toA, r.toT, r.toC, r.toG].map((v, k) => {
                          const transition =
                            (r.from === 'A' && k === 3) || (r.from === 'G' && k === 0) ||
                            (r.from === 'C' && k === 1) || (r.from === 'T/U' && k === 2);
                          return (
                            <td key={k} style={transition ? { fontWeight: 700 } : undefined}>
                              {v === null ? '—' : v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
              <div>
                <h4>Transition / Transversion Bias Parameters</h4>
                <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
                  <div className="kpi-box">
                    <span className="kpi-label">Purine Rate Ratio (κ₁)</span>
                    <strong className="kpi-val">{fmtStat(substMatrixRep.purineKappa1)}</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Pyrimidine Rate Ratio (κ₂)</span>
                    <strong className="kpi-val">{fmtStat(substMatrixRep.pyrimidineKappa2)}</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Overall Ti/Tv Bias (R)</span>
                    <strong className="kpi-val">{fmtStat(substMatrixRep.overallTiTvRatioR)}</strong>
                  </div>
                </div>
                <div className="info-callout" style={{ marginTop: 10 }}>
                  Each entry r<sub>ij</sub> is the instantaneous rate from the row base to the column base, estimated by
                  maximum likelihood under Tamura-Nei with Γ (4 categories) on the Neighbor-Joining tree; the 12 entries sum
                  to 100. Transitions are shown in bold. κ₁ and κ₂ are the purine and pyrimidine transition/transversion
                  rate ratios; R = (π<sub>A</sub>π<sub>G</sub>κ₁ + π<sub>T</sub>π<sub>C</sub>κ₂) / ((π<sub>A</sub>+π<sub>G</sub>)(π<sub>T</sub>+π<sub>C</sub>)).
                </div>
              </div>
            </div>
          )}

          {modelsSubView === 'disparity' && substMatrixRep && (
            <div>
              <div className="info-callout" style={{ marginBottom: 8 }}>
                <strong>Disparity Index Test of Substitution Pattern Homogeneity</strong> (Kumar &amp; Gadagkar 2001):
                I<sub>D</sub> = (Σ(x<sub>iA</sub> − x<sub>iB</sub>)²/2 − n<sub>d</sub>)/n over sites where both sequences have
                A/C/G/T. P-values come from 1,000 Monte Carlo replicates that randomly swap the two bases at each compared
                site (α = 0.05).
              </div>
              <WorkbenchSmartTable
                tableId="phylo-disparity-index"
                tableLabel="Disparity Index Test of Pattern Homogeneity"
                className="bio-table"
                regionMaxHeight={300}
              >
                <thead>
                  <tr>
                    <th>Taxon A</th>
                    <th>Taxon B</th>
                    <th>Disparity Index (I_D)</th>
                    <th>Monte Carlo p-value</th>
                    <th>Homogeneity Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {substMatrixRep.disparityPairs.map((dp, idx) => (
                    <tr key={idx}>
                      <td>
                        <strong>{dp.taxonA}</strong>
                      </td>
                      <td>
                        <strong>{dp.taxonB}</strong>
                      </td>
                      <td>{fmtStat(dp.disparityIndexId)}</td>
                      <td>{fmtP(dp.pValue)}</td>
                      <td>
                        {dp.pValue === null ? (
                          <span>n/a</span>
                        ) : dp.pValue < 0.05 ? (
                          <span style={{ color: '#dc2626', fontWeight: 700 }}>
                            Heterogeneous (Reject H₀)
                          </span>
                        ) : (
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>
                            Homogeneous (Accept H₀)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          )}

          {modelsSubView === 'composition' && (
            <WorkbenchSmartTable
              tableId="phylo-nucleotide-composition"
              tableLabel="Nucleotide Composition by Codon Position"
              className="bio-table"
              regionMaxHeight={320}
            >
              <thead>
                <tr>
                  <th>Taxon</th>
                  <th>%T(U)</th>
                  <th>%C</th>
                  <th>%A</th>
                  <th>%G</th>
                  <th>Overall %GC</th>
                  <th>1st Pos %GC</th>
                  <th>2nd Pos %GC</th>
                  <th>3rd Pos %GC</th>
                </tr>
              </thead>
              <tbody>
                {compositionRows.map((c) => (
                  <tr key={c.taxonName}>
                    <td>
                      <strong>{c.taxonName}</strong>
                    </td>
                    <td>{c.pctT}%</td>
                    <td>{c.pctC}%</td>
                    <td>{c.pctA}%</td>
                    <td>{c.pctG}%</td>
                    <td>
                      <strong>{c.pctGC}%</strong>
                    </td>
                    <td>{c.pctGC1}%</td>
                    <td>{c.pctGC2}%</td>
                    <td>{c.pctGC3}%</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          )}

          {modelsSubView === 'rscu' && (
            rscuRefusal ? (
              <div className="info-callout" role="status" style={{ marginBottom: 8 }}>
                {rscuRefusal}
              </div>
            ) : (
            <div>
              <div className="info-callout" style={{ marginBottom: 8 }}>
                <strong>Relative Synonymous Codon Usage (RSCU)</strong> across all 64 codons: RSCU &gt; 1.0 indicates positive codon preference; RSCU &lt; 1.0 indicates underrepresented synonymous codons.
              </div>
              <WorkbenchSmartTable
                tableId="phylo-codon-rscu"
                tableLabel="Relative Synonymous Codon Usage (RSCU)"
                className="bio-table"
                regionMaxHeight={300}
              >
                <thead>
                  <tr>
                    <th>Codon</th>
                    <th>Amino Acid</th>
                    <th>Observed Count</th>
                    <th>Frequency / 1,000</th>
                    <th>RSCU</th>
                  </tr>
                </thead>
                <tbody>
                  {rscuRows.map((row) => (
                    <tr key={row.codon}>
                      <td>
                        <code>{row.codon}</code>
                      </td>
                      <td>
                        <strong>{row.aminoAcid}</strong>
                      </td>
                      <td>{row.count}</td>
                      <td>{row.frequencyPerThousand}</td>
                      <td>
                        <strong
                          style={{
                            color:
                              row.rscu >= 1.3
                                ? '#16a34a'
                                : row.rscu < 0.7
                                ? '#dc2626'
                                : 'inherit',
                          }}
                        >
                          {row.rscu}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
            )
          )}
        </div>
      )}

      {/* MODULE 4: DISTANCE (Pairwise Distance Matrix, Overall Mean, Within-Group, Between-Group & Net Distances) */}
      {evoTab === 'distance' && distanceRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Pairwise Evolutionary Distance Matrix (d below diag / SE above diag)</h3>
              {moduleSetting('Distance Estimation', 'Distance Model:', (
                <select
                  value={distanceModel}
                  onChange={(e) =>
                    setDistanceModel(e.target.value as SubstitutionModelName)
                  }
                >
                  <option value="p-distance">p-distance (Uncorrected Proportion)</option>
                  <option value="Jukes-Cantor (JC69)">Jukes-Cantor (JC69)</option>
                  <option value="Kimura 2-parameter (K2P)">Kimura 2-parameter (K2P)</option>
                  <option value="Tamura 3-parameter (T92)">Tamura 3-parameter (T92)</option>
                  <option value="Tamura-Nei (TN93)">Tamura-Nei (TN93)</option>
                </select>
              ))}
            </div>
            <WorkbenchSmartTable
              tableId="phylo-pairwise-distance-matrix"
              tableLabel="Pairwise Evolutionary Distance Matrix"
              className="bio-table"
              regionMaxHeight={310}
            >
              <thead>
                <tr>
                  <th>Taxon</th>
                  {distanceRep.taxaNames.map((nm, i) => (
                    <th key={nm}>[{i + 1}]</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {distanceRep.taxaNames.map((nm, rIdx) => (
                  <tr key={nm}>
                    <td>
                      <strong>
                        [{rIdx + 1}] {nm.slice(0, 16)}
                      </strong>
                    </td>
                    {distanceRep.taxaNames.map((_, cIdx) => {
                      if (rIdx === cIdx) {
                        return <td key={cIdx}>—</td>;
                      }
                      const isLower = rIdx > cIdx;
                      const val = distanceRep.pairwiseMatrix[rIdx][cIdx];
                      return (
                        <td
                          key={cIdx}
                          style={{
                            color: isLower ? 'var(--mbc-text-main)' : 'var(--mbc-blue-text)',
                            fontWeight: isLower ? 700 : 400,
                          }}
                          title={
                            val === null
                              ? 'Not computable: no shared sites, or too divergent for this model'
                              : isLower
                              ? `Evolutionary distance d = ${val}`
                              : `Standard error (delta method) = ${val}`
                          }
                        >
                          {val === null ? 'n/c' : val.toFixed(4)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Overall, Within-Group, Between-Group &amp; Net Distances</h3>
              <span className="badge-accent">{distanceModel}</span>
            </div>
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Overall Mean Distance (d)</span>
                <strong className="kpi-val">{fmtStat(distanceRep.overallMeanDistance, 4)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Overall Standard Error (SE)</span>
                <strong className="kpi-val">±{fmtStat(distanceRep.overallMeanSE, 4)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Between-Group Mean (d_XY)</span>
                <strong className="kpi-val">
                  {distanceRep.betweenGroupMeans.length
                    ? fmtStat(distanceRep.betweenGroupMeans[0].meanDistance, 4)
                    : 'needs ≥ 2 groups'}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Net Between-Group (d_A)</span>
                <strong className="kpi-val">
                  {distanceRep.betweenGroupMeans.length
                    ? fmtStat(distanceRep.betweenGroupMeans[0].netDistanceDa, 4)
                    : 'needs ≥ 2 groups'}
                </strong>
              </div>
            </div>

            <h4>Within-Group Mean Distances</h4>
            <WorkbenchSmartTable
              tableId="phylo-within-group-distances"
              tableLabel="Within-Group Mean Distances"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Subpopulation Group</th>
                  <th>Taxa (n)</th>
                  <th>Within-Group Mean (d)</th>
                  <th>Standard Error (SE)</th>
                </tr>
              </thead>
              <tbody>
                {distanceRep.withinGroupMeans.length === 0 && (
                  <tr>
                    <td colSpan={4}>No groups are defined for these sequences (a &quot;Group&quot; metadata field or &quot;Group: …&quot; in the description).</td>
                  </tr>
                )}
                {distanceRep.withinGroupMeans.map((wg) => (
                  <tr key={wg.groupName}>
                    <td>
                      <strong>{wg.groupName}</strong>
                    </td>
                    <td>{wg.taxonCount}</td>
                    <td>
                      <strong>{fmtStat(wg.meanDistance, 4)}</strong>
                    </td>
                    <td>±{fmtStat(wg.se, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>

            <h4>Between-Group &amp; Net Between-Group Mean Distances (Nei &amp; Li)</h4>
            <WorkbenchSmartTable
              tableId="phylo-between-group-distances"
              tableLabel="Between-Group and Net Mean Distances"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Comparison</th>
                  <th>Between-Group d_XY</th>
                  <th>Net Distance d_A = d_XY - (d_X+d_Y)/2</th>
                  <th>SE</th>
                </tr>
              </thead>
              <tbody>
                {distanceRep.betweenGroupMeans.length === 0 && (
                  <tr>
                    <td colSpan={4}>Between-group distances need at least two groups.</td>
                  </tr>
                )}
                {distanceRep.betweenGroupMeans.map((bg, i) => (
                  <tr key={i}>
                    <td>
                      <strong>
                        {bg.groupA} vs {bg.groupB}
                      </strong>
                    </td>
                    <td>{fmtStat(bg.meanDistance, 4)}</td>
                    <td>
                      <strong>{fmtStat(bg.netDistanceDa, 4)}</strong>
                    </td>
                    <td>±{fmtStat(bg.se, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {/* MODULE 5: DIVERSITY (Subpopulation pi_S, Entire Population pi_T, Interpopulation delta_ST, Coefficient G_ST) */}
      {evoTab === 'diversity' && diversityRep && (
        <div className="studio-card">
          <div className="studio-card-header">
            <h3>Population Nucleotide Diversity &amp; Subpopulation Differentiation</h3>
            <span className="badge-accent">Nei (1973 / 1987) Diversity Statistics</span>
          </div>
          <div className="info-callout" style={{ marginBottom: 8 }}>
            Diversities are mean {distanceModel} distances. {distinctGroups.length >= 2
              ? `${distinctGroups.length} groups from the file: ${distinctGroups.join(', ')}.`
              : 'Subpopulation statistics (π_S, δ_ST, G_ST) need at least two groups, from a "Group" metadata field or "Group: …" in each sequence\'s description.'}{' '}
            Standard errors of π need bootstrap resampling, which is not run here (shown as n/a); the Hd SE is Nei&apos;s
            (1987) sampling variance.
          </div>
          <div className="thermo-kpi-grid">
            <div className="kpi-box">
              <span className="kpi-label">Within Subpopulations (π_S)</span>
              <strong className="kpi-val">
                {fmtStat(diversityRep.withinSubpopulationPiS, 4)} ± {fmtStat(diversityRep.withinSubpopulationSE, 4)}
              </strong>
            </div>
            <div className="kpi-box">
              <span className="kpi-label">Entire Population (π_T)</span>
              <strong className="kpi-val">
                {fmtStat(diversityRep.entirePopulationPiT, 4)} ± {fmtStat(diversityRep.entirePopulationSE, 4)}
              </strong>
            </div>
            <div className="kpi-box">
              <span className="kpi-label">Interpopulation Diversity (δ_ST)</span>
              <strong className="kpi-val">
                {fmtStat(diversityRep.interpopulationDiversityDeltaST, 4)} ±{' '}
                {fmtStat(diversityRep.interpopulationSE, 4)}
              </strong>
            </div>
            <div className="kpi-box">
              <span className="kpi-label">Coefficient of Differentiation (N_ST / G_ST)</span>
              <strong className="kpi-val">
                {fmtStat(diversityRep.coefficientOfDifferentiationGst, 4)} ±{' '}
                {fmtStat(diversityRep.coefficientSE, 4)}
              </strong>
            </div>
          </div>

          <WorkbenchSmartTable
            tableId="phylo-population-diversity"
            tableLabel="Population Nucleotide Diversity Quantities"
            className="bio-table"
            wrapperStyle={{ marginTop: 10 }}
          >
            <thead>
              <tr>
                <th>Population Diversity Quantity</th>
                <th>Symbol</th>
                <th>Estimate</th>
                <th>Standard Error (SE)</th>
                <th>Formula &amp; Interpretation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Mean Diversity Within Subpopulations</strong>
                </td>
                <td>
                  <code>π_S</code>
                </td>
                <td>{fmtStat(diversityRep.withinSubpopulationPiS, 4)}</td>
                <td>±{fmtStat(diversityRep.withinSubpopulationSE, 4)}</td>
                <td>Mean of the within-group mean distances (needs ≥ 2 groups)</td>
              </tr>
              <tr>
                <td>
                  <strong>Mean Diversity in Entire Population</strong>
                </td>
                <td>
                  <code>π_T</code>
                </td>
                <td>{fmtStat(diversityRep.entirePopulationPiT, 4)}</td>
                <td>±{fmtStat(diversityRep.entirePopulationSE, 4)}</td>
                <td>Total nucleotide diversity pooled across all subpopulations</td>
              </tr>
              <tr>
                <td>
                  <strong>Mean Interpopulation Diversity</strong>
                </td>
                <td>
                  <code>δ_ST</code>
                </td>
                <td>{fmtStat(diversityRep.interpopulationDiversityDeltaST, 4)}</td>
                <td>±{fmtStat(diversityRep.interpopulationSE, 4)}</td>
                <td>
                  <code>δ_ST = π_T - π_S</code> (Excess diversity attributable to divergence between subpopulations)
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Coefficient of Evolutionary Differentiation</strong>
                </td>
                <td>
                  <code>N_ST / G_ST</code>
                </td>
                <td>
                  <strong>{fmtStat(diversityRep.coefficientOfDifferentiationGst, 4)}</strong>
                </td>
                <td>±{fmtStat(diversityRep.coefficientSE, 4)}</td>
                <td>
                  <code>G_ST = δ_ST / π_T</code> (Proportion of total genetic variance residing between subpopulations)
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Haplotype Diversity</strong>
                </td>
                <td>
                  <code>H_d</code>
                </td>
                <td>{fmtStat(diversityRep.haplotypeDiversityHd, 4)}</td>
                <td>±{fmtStat(diversityRep.haplotypeDiversitySE, 4)}</td>
                <td>Probability that two randomly sampled sequences are distinct haplotypes</td>
              </tr>
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}

      {/* MODULE 6: PHYLOGENY (Construct/Test ML, NJ, ME, UPGMA, MP Trees with Bootstrap).
          Figure first: the method choices in a controls column that scrolls on its own, beside a
          result column with the tree first (it stays in view), then the warnings and metrics,
          then the method note and Newick behind a disclosure. In the workbench the method choices
          are the inspector's Tree Building section, and the heading card sits above the result
          column instead (D0063 ruling b). */}
      {evoTab === 'phylogeny' && (
        <div className={`studio-split-grid${figureFirst ? ' is-figure-first' : ''}`}>
          {phylogenyControlsColumn(
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>{treeHeading}</h3>
              <span className="badge-accent">
                {extResult
                  ? extResult.supportKind === 'none'
                    ? 'No branch support'
                    : extResult.supportKind
                  : phyloRep.bootstrapReplicates > 0
                  ? `${phyloRep.bootstrapReplicates} bootstrap replicates`
                  : 'No bootstrap'}
              </span>
            </div>

            <InspectorSection title="Tree Building" order={1}>
              <div className="form-grid-2col">
                <label className="form-field">
                  <span>Tree Inference Method:</span>
                  <select
                    value={treeAlgorithm}
                    onChange={(e) =>
                      setTreeAlgorithm(e.target.value as PhyloTreeAlgorithm)
                    }
                  >
                    <option value="Neighbor-Joining (NJ)">Neighbor-Joining (NJ)</option>
                    <option value="UPGMA">UPGMA (assumes a molecular clock)</option>
                    <option value="Minimum-Evolution (ME)">
                      Minimum-Evolution — NJ starting tree (no ME branch-swapping)
                    </option>
                    <option value="Maximum Parsimony (MP)">
                      Maximum Parsimony — score the NJ tree (no parsimony search)
                    </option>
                    <option value="Maximum Likelihood (ML)">
                      Maximum Likelihood — lnL of the NJ tree (no ML search)
                    </option>
                    <optgroup label="External programs (run on this computer if installed)">
                      {EXTERNAL_TREE_ALGORITHMS.map((algo) => {
                        const name = EXTERNAL_TREE_NAMES[algo];
                        const st = extPrograms?.find((p) => p.algorithm === algo);
                        const suffix =
                          extPrograms === undefined
                            ? ''
                            : extPrograms === null
                            ? ' — desktop app only (NJ tree shown)'
                            : st?.available
                            ? ' — installed'
                            : ' — not installed (NJ tree shown)';
                        return (
                          <option key={algo} value={algo}>
                            {name}
                            {suffix}
                          </option>
                        );
                      })}
                    </optgroup>
                  </select>
                </label>

                <label className="form-field">
                  <span>Distance Model:</span>
                  <select
                    value={treeModel}
                    onChange={(e) =>
                      setTreeModel(e.target.value as SubstitutionModelName)
                    }
                  >
                    <option value="Tamura-Nei (TN93)">Tamura-Nei (TN93)</option>
                    <option value="Tamura 3-parameter (T92)">Tamura 3-parameter (T92)</option>
                    <option value="Kimura 2-parameter (K2P)">Kimura 2-parameter (K2P)</option>
                    <option value="Jukes-Cantor (JC69)">Jukes-Cantor (JC69)</option>
                    <option value="p-distance">p-distance</option>
                  </select>
                </label>
              </div>

              <div className="form-grid-3col">
                <label className="form-field">
                  <span>Bootstrap Replicates:</span>
                  <select
                    value={bootstrapReps}
                    disabled={extCanRun}
                    title={extCanRun ? `${EXTERNAL_TREE_NAMES[extAlgo!]} reports its own branch support` : undefined}
                    onChange={(e) => setBootstrapReps(Number(e.target.value))}
                  >
                    <option value={100}>100 Replicates (Fast)</option>
                    <option value={500}>500 Replicates (Standard)</option>
                    <option value={1000}>1,000 Replicates (Publication)</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Tree Topology Style:</span>
                  <select
                    value={treeLayout}
                    onChange={(e) =>
                      setTreeLayout(
                        e.target.value as 'phylogram' | 'cladogram' | 'radial'
                      )
                    }
                  >
                    <option value="phylogram">Rectangular Phylogram</option>
                    <option value="cladogram">Equal-Length Cladogram</option>
                    <option value="radial">Radial / Circular Tree</option>
                  </select>
                </label>
                <label className="form-field" style={{ justifyContent: 'flex-end' }}>
                  <label className="mbc-check-row">
                    <input
                      type="checkbox"
                      checked={showBootstrap}
                      onChange={(e) => setShowBootstrap(e.target.checked)}
                    />
                    <span>Show Bootstrap % on Nodes</span>
                  </label>
                </label>
              </div>
            </InspectorSection>

            {extAlgo && !phyloAlignment.error && (() => {
              const name = EXTERNAL_TREE_NAMES[extAlgo];
              const btn = (label: string, onClick: () => void) => (
                <button type="button" className="btn-secondary-sm" style={{ marginLeft: 10 }} onClick={onClick}>
                  {label}
                </button>
              );
              let body: React.ReactNode = null;
              let alert = false;
              if (extPrograms === undefined) {
                body = `Looking for ${name} on this computer…`;
              } else if (extPrograms === null) {
                body = `${name} can only be run from the MolBioCraft desktop app. Showing the built-in Neighbor-Joining tree instead.`;
              } else if (!extStatus?.available) {
                body = (
                  <>
                    {name} was not found on this computer, so the built-in Neighbor-Joining tree is shown. Install it
                    with <code>{extStatus?.installHint}</code>, then
                    {btn('Check again', () => setExtDetectNonce((n) => n + 1))}
                  </>
                );
              } else if (taxaNames.length < 4) {
                body = `${name} needs at least 4 sequences.`;
              } else if (extRunNow?.status === 'running') {
                body = (
                  <>
                    Running {name} on {taxaNames.length} sequences × {(alignedSeqs[0]?.length ?? 0).toLocaleString()} sites…{' '}
                    {extElapsed} s. The Neighbor-Joining tree is shown until it finishes.
                    {btn('Cancel', cancelExternalRun)}
                  </>
                );
              } else if (extRunNow?.status === 'error') {
                alert = true;
                body = (
                  <>
                    {name} did not produce a tree: {extRunNow.error} The Neighbor-Joining tree is shown instead.
                    {btn('Retry', () => setExtRetryNonce((n) => n + 1))}
                  </>
                );
              } else if (extRunNow?.status === 'cancelled') {
                body = (
                  <>
                    {name} was cancelled; the Neighbor-Joining tree is shown.
                    {btn('Run again', () => setExtRetryNonce((n) => n + 1))}
                  </>
                );
              } else if (extResult) {
                body = `Tree from ${extStatus.executablePath ?? name}.`;
              }
              return body ? (
                <div
                  className="info-callout"
                  role={alert ? 'alert' : 'status'}
                  style={{ marginBottom: 8, ...(alert ? { color: 'var(--mbc-red)' } : {}) }}
                >
                  {body}
                </div>
              ) : null;
            })()}

          </div>
          )}

          <div className="studio-result-column">
            {phyloLayoutReport.tipCount === 0 ? (
              <div className="mbc-studio-loading-state" role="status">
                {phyloAlignment.error
                  ? 'No tree to display until the sequences are aligned.'
                  : 'No tree to display. Select at least two sequences.'}
              </div>
            ) : (
            // Out of the figure-first grid the figure flows with the canvas. App.css holds a result
            // column's figure sticky at the top of the canvas, capped at 75% of a column height
            // that only the figure-first grid gives; in one column a tree taller than the canvas
            // would stay over the metrics and the method note as they scroll beneath it.
            <div data-mbc-figure style={figureFirst ? undefined : { position: 'static' }}>
            {/* The one heading that names the figure; the method that ran heads the controls. */}
            <div className="studio-card-header" style={{ paddingTop: 0 }}>
              <h4>
                Tree ({treeLayout})
              </h4>
              <span className="studio-figure-actions">
                <span className="badge-accent">
                  {phyloLayoutReport.tipCount} Tips • {phyloLayoutReport.internalCount} Clades • {treeModel}
                </span>
                <FigureExportButton
                  compact
                  baseName="Phylogenetic Tree"
                  title="Phylogenetic tree"
                  text={phyloRep.newick}
                />
              </span>
            </div>
            <div ref={setTreeCanvasEl} className="mbc-phylo-canvas">
            <svg
              viewBox={`0 0 ${phyloLayoutReport.width} ${phyloLayoutReport.height}`}
              width={phyloLayoutReport.width}
              height={phyloLayoutReport.height}
              role="img"
              aria-label={`Phylogenetic tree (${phyloLayoutReport.tipCount} tips)`}
            >
              <rect
                x="0"
                y="0"
                width={phyloLayoutReport.width}
                height={phyloLayoutReport.height}
                rx="6"
                fill="var(--mbc-bg-panel)"
                stroke="var(--mbc-border)"
              />
              {phyloLayoutReport.svgPaths.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  stroke={edge.isTerminal ? 'var(--mbc-blue)' : 'var(--mbc-text-secondary)'}
                  strokeWidth={edge.isTerminal ? '1.85' : '1.95'}
                />
              ))}
              {phyloLayoutReport.nodes.map((nd) => (
                <g key={nd.nodeId}>
                  <circle
                    cx={nd.x}
                    cy={nd.y}
                    r={nd.isTip ? 3.8 : nd.isRoot ? 4.2 : 2.8}
                    fill={
                      nd.isTip
                        ? 'var(--mbc-green)'
                        : nd.isRoot
                        ? 'var(--mbc-amber)'
                        : 'var(--mbc-blue)'
                    }
                  />
                  {showBootstrap && !nd.isTip && nd.bootstrap !== null && (
                    <text
                      x={nd.x - 4}
                      y={nd.y - 5}
                      textAnchor="end"
                      fill="var(--mbc-amber)"
                      fontSize="10"
                      fontWeight="700"
                    >
                      {Math.round(nd.bootstrap)}%
                    </text>
                  )}
                  {nd.isTip && (() => {
                    const full = displayTipLabel(nd.label);
                    return (
                      <text
                        x={nd.labelX}
                        y={nd.labelY}
                        textAnchor={nd.textAnchor}
                        fill="var(--mbc-text-main)"
                        fontSize="11"
                        fontWeight="500"
                      >
                        <title>{full}</title>
                        {full.length > 30 ? `${full.slice(0, 29)}…` : full}
                      </text>
                    );
                  })()}
                </g>
              ))}
              {phyloLayoutReport.scaleBar && (
                <g>
                  <line
                    x1={phyloLayoutReport.scaleBar.x1}
                    y1={phyloLayoutReport.scaleBar.y}
                    x2={phyloLayoutReport.scaleBar.x2}
                    y2={phyloLayoutReport.scaleBar.y}
                    stroke="var(--mbc-text-main)"
                    strokeWidth="2"
                  />
                  <line
                    x1={phyloLayoutReport.scaleBar.x1}
                    y1={phyloLayoutReport.scaleBar.y - 4}
                    x2={phyloLayoutReport.scaleBar.x1}
                    y2={phyloLayoutReport.scaleBar.y + 4}
                    stroke="var(--mbc-text-main)"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={phyloLayoutReport.scaleBar.x2}
                    y1={phyloLayoutReport.scaleBar.y - 4}
                    x2={phyloLayoutReport.scaleBar.x2}
                    y2={phyloLayoutReport.scaleBar.y + 4}
                    stroke="var(--mbc-text-main)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={(phyloLayoutReport.scaleBar.x1 + phyloLayoutReport.scaleBar.x2) / 2}
                    y={phyloLayoutReport.scaleBar.y - 6}
                    textAnchor="middle"
                    fill="var(--mbc-text-secondary)"
                    fontSize="10"
                    fontWeight="600"
                  >
                    {phyloLayoutReport.scaleBar.label}
                  </text>
                </g>
              )}
            </svg>
            </div>
            </div>
            )}

            {/* Warnings and the no-tree reason stay outside the disclosure, next to the tree. */}
            {phyloAlignment.error ? (
              <div className="info-callout">
                No tree was built: the input sequences could not be aligned (see the message above).
              </div>
            ) : phyloRep.warnings.length > 0 ? (
              <div className="info-callout">
                {phyloRep.warnings.map((w) => (
                  <div key={w} style={{ color: 'var(--mbc-red)' }}>
                    {w}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">lnL (JC69, this tree)</span>
                <strong className="kpi-val">{fmtStat(phyloRep.logLikelihood, 2)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Sum of Branch Lengths (S)</span>
                <strong className="kpi-val">{phyloRep.totalTreeLengthS}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Parsimony Steps</span>
                <strong className="kpi-val">{phyloRep.parsimonySteps}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">CI / RI Indices</span>
                <strong className="kpi-val">
                  {fmtStat(phyloRep.consistencyIndexCI, 3)} / {fmtStat(phyloRep.retentionIndexRI, 3)}
                </strong>
              </div>
            </div>

            {/* The heading over the controls names the method that ran, so the note can start
                closed. When the sequences could not be aligned no tree was built from them, so
                no method note is shown (the reason is shown above, outside this disclosure). */}
            <details className="mbc-progressive-details">
              <summary className="mbc-progressive-summary">
                <span>Method and Newick tree</span>
              </summary>
              {!phyloAlignment.error && (
                <div className="info-callout" style={{ marginTop: 8 }}>
                  {phyloRep.methodNote}
                </div>
              )}

              <div className="newick-box">
                <span>Export Newick Tree String ({treeHeading}):</span>
                <code>{phyloRep.newick}</code>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* MODULE 7: USER TREE (Analyze by ML / Parsimony / OLS, Find Gene Duplications, Site Coverage, Manual Editor) */}
      {evoTab === 'usertree' && userTreeRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Analyze &amp; Edit User Tree (ML / Parsimony / Least Squares)</h3>
            </div>
            <label className="form-field">
              <span>User-Supplied or Manually Edited Newick Tree Topology:</span>
              <textarea
                rows={3}
                value={customNewickText || phyloRep.newick}
                onChange={(e) => setCustomNewickText(e.target.value)}
                style={{
                  width: '100%',
                  fontFamily: 'Google Sans Code, monospace',
                  fontSize: 11.5,
                  padding: 6,
                  borderRadius: 5,
                }}
              />
            </label>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">lnL (JC69) / AICc</span>
                <strong className="kpi-val">
                  {fmtStat(userTreeRep.mlLogLikelihood, 2)} / {fmtStat(userTreeRep.mlAicc, 2)}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">OLS Fit (R² / SSE)</span>
                <strong className="kpi-val">
                  {fmtStat(userTreeRep.olsRSquared, 4)} ({fmtStat(userTreeRep.olsSumOfSquaresSSE)})
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Parsimony Length</span>
                <strong className="kpi-val">{userTreeRep.parsimonyLengthSteps} steps</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">CI / RI</span>
                <strong className="kpi-val">
                  {fmtStat(userTreeRep.consistencyIndex, 3)} / {fmtStat(userTreeRep.retentionIndex, 3)}
                </strong>
              </div>
            </div>

            <div className="info-callout" style={{ margin: '8px 0' }}>
              lnL uses the tree&apos;s own branch lengths under JC69 (AICc with 2n−3 branch parameters). The OLS fit
              compares patristic distances on the tree with pairwise TN93 distances.
              {userTreeRep.notes
                .filter((n) => !n.startsWith('Gene duplication'))
                .map((n) => (
                  <div key={n} style={{ marginTop: 4 }}>
                    {n}
                  </div>
                ))}
            </div>

            <h4>Compute Site Coverage</h4>
            <WorkbenchSmartTable
              tableId="phylo-user-tree-coverage"
              tableLabel="User Tree Site Coverage"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Occupancy Threshold</th>
                  <th>Sites Meeting Threshold</th>
                  <th>% of Alignment</th>
                </tr>
              </thead>
              <tbody>
                {userTreeRep.siteCoverageBins.map((b) => (
                  <tr key={b.thresholdLabel}>
                    <td>
                      <strong>{b.thresholdLabel}</strong>
                    </td>
                    <td>{b.siteCount}</td>
                    <td>{b.pctOfAlignment}%</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Find Gene Duplications (Speciation vs Duplication Nodes)</h3>
            </div>
            <WorkbenchSmartTable
              tableId="phylo-gene-duplications"
              tableLabel="Speciation vs Gene Duplication Nodes"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Internal Node</th>
                  <th>Evolutionary Event</th>
                  <th>Descendant Clade Taxa</th>
                  <th>Support</th>
                </tr>
              </thead>
              <tbody>
                {userTreeRep.duplicationNodes.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      Not inferred: classifying nodes as duplication or speciation needs a species tree to reconcile the
                      gene tree against, and none is loaded.
                    </td>
                  </tr>
                )}
                {userTreeRep.duplicationNodes.map((dn) => (
                  <tr key={dn.nodeId}>
                    <td>
                      <code>{dn.nodeId}</code>
                    </td>
                    <td>
                      <strong
                        style={{
                          color: dn.eventType.includes('Duplication')
                            ? '#dc2626'
                            : '#16a34a',
                        }}
                      >
                        {dn.eventType}
                      </strong>
                    </td>
                    <td>{dn.descendantTaxa.join(', ')}</td>
                    <td>{dn.confidencePct}%</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>

            <div data-mbc-figure>
            <div className="studio-card-header" style={{ paddingTop: 0 }}>
              <h4 style={{ marginTop: 10 }}>
                User tree topology ({userTreeLayoutReport.tipCount} tips •{' '}
                {userTreeLayoutReport.internalCount} internal clades)
              </h4>
              <FigureExportButton
                compact
                baseName="User Tree Topology"
                title="User-tree topology"
                text={customNewickText || phyloRep.newick}
              />
            </div>
            <svg
              viewBox={`0 0 ${userTreeLayoutReport.width} ${userTreeLayoutReport.height}`}
              width={userTreeLayoutReport.width}
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            >
              <rect
                x="0"
                y="0"
                width={userTreeLayoutReport.width}
                height={userTreeLayoutReport.height}
                rx="6"
                fill="var(--mbc-bg-panel)"
                stroke="var(--mbc-border)"
              />
              {userTreeLayoutReport.svgPaths.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  stroke="var(--mbc-blue)"
                  strokeWidth="1.8"
                />
              ))}
              {userTreeLayoutReport.nodes.map((nd) => (
                <g key={nd.nodeId}>
                  <circle
                    cx={nd.x}
                    cy={nd.y}
                    r={nd.isTip ? 3.5 : 2.5}
                    fill={nd.isTip ? 'var(--mbc-green)' : 'var(--mbc-amber)'}
                  />
                  {nd.isTip && (
                    <text
                      x={nd.labelX}
                      y={nd.labelY}
                      textAnchor={nd.textAnchor}
                      fill="var(--mbc-text-main)"
                      fontSize="10.5"
                      fontWeight="500"
                    >
                      {displayTipLabel(nd.label).slice(0, 30)}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            </div>
          </div>
        </div>
      )}

      {/* MODULE 8: ANCESTORS (Infer Ancestral Sequences ML & Parsimony + Evolutionary Probability EP) */}
      {evoTab === 'ancestors' && ancestralRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Infer Ancestral Sequences (MRCA &amp; Clade Nodes)</h3>
              {moduleSetting('Ancestral Reconstruction', 'Reconstruction Method:', (
                <select
                  value={ancestralMethod}
                  onChange={(e) =>
                    setAncestralMethod(
                      e.target.value as
                        | 'Maximum Likelihood (Empirical Bayes)'
                        | 'Maximum Parsimony (Fitch)'
                    )
                  }
                >
                  <option value="Maximum Likelihood (Empirical Bayes)">
                    Infer Ancestral Sequences (ML — Empirical Bayes)
                  </option>
                  <option value="Maximum Parsimony (Fitch)">
                    Infer Ancestral Sequences (Maximum Parsimony)
                  </option>
                </select>
              ))}
            </div>
            <div className="info-callout" style={{ marginBottom: 8 }}>
              {ancestralRep.method}
              {ancestralRep.nodes.length === 0 && ' — no reconstruction (needs ≥ 3 aligned nucleotide sequences).'}
            </div>
            <ResultWarnings
              warnings={rowsLeftOut(ancestralRep.nodes.length, ancestralRep.totalInternalNodes, 'internal nodes', 'The list shows')}
              label="Ancestral node warnings"
            />
            {ancestralRep.nodes.map((nd) => (
              <div key={nd.nodeName} className="primer-detail-card">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{nd.nodeName}</strong>
                  <span className="badge-accent">
                    {ancestralMethod.startsWith('Maximum Parsimony')
                      ? `Unambiguous sites: ${fmtStat(nd.meanPosteriorConfidence)}%`
                      : `Mean posterior of best state: ${fmtStat(nd.meanPosteriorConfidence)}%`}
                  </span>
                </div>
                <small style={{ color: 'var(--mbc-text-muted)' }}>
                  Descendants: {nd.descendants}
                </small>
                <code
                  style={{
                    fontSize: 11,
                    wordBreak: 'break-all',
                    background: 'var(--mbc-bg-canvas)',
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid var(--mbc-border)',
                  }}
                >
                  {nd.ancestralSequence.length > 120
                    ? `${nd.ancestralSequence.slice(0, 120)}… (${nd.ancestralSequence.length} sites)`
                    : nd.ancestralSequence}
                </code>
              </div>
            ))}
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Root State Probabilities Per Site</h3>
              <span className="badge-accent">
                {ancestralMethod.startsWith('Maximum Parsimony') ? 'Fitch state sets' : 'Marginal posterior (ML)'}
              </span>
            </div>
            <ResultWarnings
              warnings={rowsLeftOut(
                Math.min(ancestralRep.siteEvolutionaryProbabilities.length, PHYLO_TABLE_ROWS_SHOWN),
                ancestralRep.totalSites,
                'sites',
                'The table lists'
              )}
              label="Root state probability warnings"
            />
            <WorkbenchSmartTable
              tableId="phylo-ancestral-site-ep"
              tableLabel="Per-Site Evolutionary Probabilities"
              className="bio-table"
              regionMaxHeight={310}
            >
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Root State</th>
                  <th>Majority (tips)</th>
                  <th>P(A)</th>
                  <th>P(C)</th>
                  <th>P(G)</th>
                  <th>P(T)</th>
                </tr>
              </thead>
              <tbody>
                {ancestralRep.siteEvolutionaryProbabilities.slice(0, PHYLO_TABLE_ROWS_SHOWN).map((sp) => (
                  <tr key={sp.position}>
                    <td>#{sp.position}</td>
                    <td>
                      <strong className={`base-ch base-${sp.ancestralStateRoot}`}>
                        {sp.ancestralStateRoot}
                      </strong>
                    </td>
                    <td>{sp.consensusState}</td>
                    <td>{sp.probA}</td>
                    <td>{sp.probC}</td>
                    <td>{sp.probG}</td>
                    <td>{sp.probT}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {/* MODULE 9: SELECTION (Codon Z-Test, Fisher's Exact Test, Tajima's Neutrality Test, Site-by-Site dN-dS) */}
      {evoTab === 'selection' && selectionRefusal && (
        <div className="info-callout" role="status" style={{ marginBottom: 8 }}>
          {selectionRefusal}
        </div>
      )}
      {evoTab === 'selection' && selectionRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Codon-Based Z-Test of Selection &amp; Tajima&apos;s Neutrality Test</h3>
              <span className="badge-accent">Nei-Gojobori &amp; Tajima (1989)</span>
            </div>
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Nonsynonymous (d_N)</span>
                <strong className="kpi-val">{fmtStat(selectionRep.dN)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Synonymous (d_S)</span>
                <strong className="kpi-val">{fmtStat(selectionRep.dS)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Selection Ratio (ω = d_N/d_S)</span>
                <strong className="kpi-val">{fmtStat(selectionRep.omegaDnDs)}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Tajima&apos;s D Statistic</span>
                <strong className="kpi-val">
                  {fmtStat(selectionRep.tajimaNeutrality.tajimaD)}
                </strong>
              </div>
            </div>

            <h4>Codon-Based Z-Test of Selection (3 Alternative Hypotheses)</h4>
            <WorkbenchSmartTable
              tableId="phylo-codon-z-test"
              tableLabel="Codon-Based Z-Test of Selection"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Hypothesis Tested</th>
                  <th>Z-Statistic</th>
                  <th>p-value</th>
                  <th>Statistical Decision (α = 0.05)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Strict Neutrality (H₁: d_N ≠ d_S)</strong>
                  </td>
                  <td>{fmtStat(selectionRep.zTestNeutrality.zStat)}</td>
                  <td>{fmtP(selectionRep.zTestNeutrality.pValue)}</td>
                  <td>
                    {selectionRep.zTestNeutrality.significant
                      ? 'Reject Neutrality (p < 0.05)'
                      : 'Accept Neutrality'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Positive Selection (H₁: d_N &gt; d_S)</strong>
                  </td>
                  <td>{fmtStat(selectionRep.zTestPositive.zStat)}</td>
                  <td>{fmtP(selectionRep.zTestPositive.pValue)}</td>
                  <td>
                    {selectionRep.zTestPositive.significant
                      ? 'Significant Positive Selection'
                      : 'Not Significant'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Purifying Selection (H₁: d_N &lt; d_S)</strong>
                  </td>
                  <td>{fmtStat(selectionRep.zTestPurifying.zStat)}</td>
                  <td>{fmtP(selectionRep.zTestPurifying.pValue)}</td>
                  <td>
                    {selectionRep.zTestPurifying.significant
                      ? 'Significant Purifying Selection'
                      : 'Not Significant'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Fisher&apos;s exact test (positive selection)</strong>
                  </td>
                  <td>—</td>
                  <td>{fmtP(selectionRep.fisherExactPValue)}</td>
                  <td>On pair-averaged Sd/Nd counts (Zhang, Kumar &amp; Nei 1997)</td>
                </tr>
              </tbody>
            </WorkbenchSmartTable>
            <div className="info-callout" style={{ marginTop: 8 }}>
              Nei–Gojobori (1986) with Jukes–Cantor correction, averaged over all sequence pairs (codons with gaps,
              ambiguity or stop codons excluded pairwise; Standard code). Z = (d_N − d_S)/SE with the SE from 500
              bootstrap replicates over codons.
              {selectionRep.notes.map((n) => (
                <div key={n} style={{ marginTop: 4 }}>
                  {n}
                </div>
              ))}
            </div>

            <h4>Tajima&apos;s Test of Neutrality Summary</h4>
            <div className="info-callout">
              Sequences <code>m = {selectionRep.tajimaNeutrality.sampleSizeM}</code> • Segregating sites{' '}
              <code>S = {selectionRep.tajimaNeutrality.segregatingSitesS}</code> •{' '}
              <code>p_s = {fmtStat(selectionRep.tajimaNeutrality.psProportion)}</code> • Watterson{' '}
              <code>Θ = {fmtStat(selectionRep.tajimaNeutrality.thetaWatterson)}</code> • Nucleotide diversity{' '}
              <code>π = {fmtStat(selectionRep.tajimaNeutrality.nucleotideDiversityPi)}</code> •{' '}
              <strong>Tajima&apos;s D = {fmtStat(selectionRep.tajimaNeutrality.tajimaD)}</strong> ({selectionRep.tajimaNeutrality.interpretation})
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Variable Codons: Pair-Averaged p_N − p_S</h3>
              <span className="badge-accent">Descriptive (not a per-site test)</span>
            </div>
            <div className="info-callout" style={{ marginBottom: 8 }}>
              Proportions of nonsynonymous and synonymous differences at each variable codon, averaged over all pairs.
              This is not SLAC/FEL: no per-site significance test is performed.
            </div>
            <ResultWarnings
              warnings={rowsLeftOut(
                Math.min(selectionRep.codonSiteSelection.length, PHYLO_TABLE_ROWS_SHOWN),
                selectionRep.totalVariableCodons,
                'variable codons',
                'The table lists'
              )}
              label="Variable codon warnings"
            />
            <WorkbenchSmartTable
              tableId="phylo-codon-site-selection"
              tableLabel="Site-by-Site Codon Selection Profile"
              className="bio-table"
              regionMaxHeight={320}
            >
              <thead>
                <tr>
                  <th>Codon #</th>
                  <th>Observed Codons</th>
                  <th>Residues</th>
                  <th>p_N − p_S</th>
                  <th>Pattern</th>
                </tr>
              </thead>
              <tbody>
                {selectionRep.codonSiteSelection.slice(0, PHYLO_TABLE_ROWS_SHOWN).map((cs) => (
                  <tr key={cs.codonIndex}>
                    <td>#{cs.codonIndex}</td>
                    <td>
                      <code>{cs.codonsObserved}</code>
                    </td>
                    <td>
                      <strong>{cs.aminoAcidsObserved}</strong>
                    </td>
                    <td>{cs.dNMinusDS}</td>
                    <td>
                      <span
                        style={{
                          color:
                            cs.dNMinusDS > 0
                              ? '#dc2626'
                              : cs.dNMinusDS < 0
                              ? '#0284c7'
                              : '#64748b',
                          fontWeight: 700,
                        }}
                      >
                        {cs.selectionRegime}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {/* MODULE 10: RATES (Estimate Gamma Parameter alpha & Position-by-Position Site Rates ML) */}
      {evoTab === 'rates' && siteRatesRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Estimate Discrete Gamma Parameter for Site Rates (ML)</h3>
              <span className="badge-accent">
                Gamma Shape α = {fmtStat(siteRatesRep.gammaShapeAlpha)}
              </span>
            </div>
            <div className="info-callout">
              Shape parameter <strong>α = {fmtStat(siteRatesRep.gammaShapeAlpha)}</strong> with{' '}
              {siteRatesRep.numCategories} equal-probability categories. α &lt; 1 means strong rate variation among
              sites. {siteRatesRep.note}
            </div>
            <WorkbenchSmartTable
              tableId="phylo-gamma-categories"
              tableLabel="Discrete Gamma Rate Categories"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Gamma Category</th>
                  <th>Relative Evolutionary Rate (r_k)</th>
                  <th>Category Prior Probability</th>
                </tr>
              </thead>
              <tbody>
                {siteRatesRep.categoryRates.map((cat) => (
                  <tr key={cat.category}>
                    <td>
                      <strong>Category #{cat.category}</strong>
                    </td>
                    <td>{cat.relativeRate}×</td>
                    <td>{(cat.probability * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Position-by-Position Evolutionary Rates (ML)</h3>
              <span className="badge-accent">Posterior mean rate (mean = 1)</span>
              <FigureExportButton compact baseName="Evolutionary Rates" title="Position-by-position evolutionary rates" />
            </div>
            <svg viewBox="0 0 475 136" style={{ width: '100%', height: 136 }}>
              <rect
                x="0"
                y="0"
                width="475"
                height="136"
                rx="6"
                fill="var(--mbc-bg-panel)"
                stroke="var(--mbc-border)"
              />
              <line
                x1="40"
                y1="78"
                x2="462"
                y2="78"
                stroke="var(--mbc-border-strong)"
                strokeDasharray="3 3"
              />
              <text x="8" y="82" fontSize="11" fontWeight="600" fill="var(--mbc-text-secondary)">
                1.0×
              </text>
              {(() => {
                // Whole alignment: one bar per site, or the mean rate of each bin when there are
                // more sites than pixels. Scale: 1.0× at y = 78 (46 px per unit), capped at 2.3×.
                const rates = siteRatesRep.siteRates;
                const bins = Math.min(rates.length, 420);
                const per = rates.length / Math.max(1, bins);
                const w = 420 / Math.max(1, bins);
                return Array.from({ length: bins }, (_, i) => {
                  const slice = rates.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per)));
                  const r = slice.reduce((acc, x) => acc + x.relativeRate, 0) / Math.max(1, slice.length);
                  const h = Math.min(106, Math.max(1, r * 46));
                  return (
                    <rect
                      key={i}
                      x={42 + i * w}
                      y={124 - h}
                      width={Math.max(0.6, w * 0.8)}
                      height={h}
                      fill={r > 1.35 ? 'var(--mbc-red)' : r < 0.75 ? 'var(--mbc-blue)' : 'var(--mbc-green)'}
                    >
                      <title>{`Sites ${slice[0]?.position}–${slice[slice.length - 1]?.position}: ${r.toFixed(3)}×`}</title>
                    </rect>
                  );
                });
              })()}
            </svg>
            <ResultWarnings
              warnings={rowsLeftOut(
                Math.min(siteRatesRep.siteRates.length, PHYLO_TABLE_ROWS_SHOWN),
                siteRatesRep.totalSites,
                'sites',
                'The table lists'
              )}
              label="Site rate warnings"
            />
            <WorkbenchSmartTable
              tableId="phylo-position-rates"
              tableLabel="Position-by-Position Evolutionary Rates"
              className="bio-table"
              regionMaxHeight={190}
            >
              <thead>
                <tr>
                  <th>Site Position</th>
                  <th>Relative Rate (r_i)</th>
                  <th>Shannon Entropy (bits)</th>
                  <th>Gamma Category</th>
                </tr>
              </thead>
              <tbody>
                {siteRatesRep.siteRates.slice(0, PHYLO_TABLE_ROWS_SHOWN).map((sr) => (
                  <tr key={sr.position}>
                    <td>Site #{sr.position}</td>
                    <td>
                      <strong>{sr.relativeRate}</strong>
                    </td>
                    <td>{sr.entropyBits}</td>
                    <td>Category {sr.rateCategory}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {/* MODULE 11: CLOCKS (RelTime Timetree, Molecular Clock ML Test, Tajima's Relative Rate Test, CorrTest) */}
      {evoTab === 'clocks' && clockRep && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Strict-Clock Timetree &amp; Root Calibration</h3>
              <span className="badge-accent">ML (TN93+G), midpoint-rooted NJ topology</span>
            </div>
            <InspectorSection title="Root Calibration" order={1}>
              <label className="form-field">
                <span>Root age (Mya):</span>
                <input
                  type="number"
                  step={1.5}
                  min={0.01}
                  max={500}
                  value={calibrationDraft}
                  onChange={(e) => {
                    setCalibrationDraft(e.target.value);
                    const v = parseRootCalibrationMya(e.target.value);
                    if (v !== null) setCalibrationMya(v);
                  }}
                  aria-invalid={parseRootCalibrationMya(calibrationDraft) === null}
                />
              </label>
            </InspectorSection>
            {/* The refusal stays with the timetree it qualifies, so it shows with the inspector closed. */}
            {parseRootCalibrationMya(calibrationDraft) === null && (
              <div className="info-callout" role="alert" style={{ margin: '4px 0' }}>
                Root age must be a positive number; still using {calibrationMya} Mya.
              </div>
            )}
            <div className="info-callout" style={{ margin: '8px 0' }}>
              Node heights are fitted by maximum likelihood under a strict clock and scaled so the root equals the
              calibration age. RelTime (relaxed rates), confidence intervals and CorrTest are not implemented.
              {clockRep.notes.map((n) => (
                <div key={n} style={{ marginTop: 4 }}>
                  {n}
                </div>
              ))}
            </div>
            <ResultWarnings
              warnings={rowsLeftOut(clockRep.divergenceNodes.length, clockRep.totalInternalNodes, 'internal nodes', 'The timetree shows')}
              label="Timetree warnings"
            />
            {(() => {
              const nodes = clockRep.divergenceNodes;
              const height = 44 + nodes.length * 22;
              const x0 = 20;
              const x1 = 300;
              const xOf = (age: number | null) =>
                age === null ? x0 : x1 - (age / Math.max(1e-9, calibrationMya)) * (x1 - x0);
              return (
                <svg viewBox={`0 0 600 ${height}`} className="phylo-tree-svg" style={{ width: '100%', maxWidth: 600, height: 'auto', display: 'block' }}>
                  <rect x="0" y="0" width="600" height={height} rx="6" fill="var(--mbc-bg-panel)" stroke="var(--mbc-border)" />
                  {[1, 0.75, 0.5, 0.25, 0].map((frac) => {
                    const x = x1 - frac * (x1 - x0);
                    return (
                      <g key={frac}>
                        <line x1={x} y1="12" x2={x} y2={height - 24} stroke="var(--mbc-border-light)" strokeDasharray="3 3" />
                        <text x={x} y={height - 9} textAnchor="middle" fontSize="10.5" fill="var(--mbc-text-secondary)">
                          {(calibrationMya * frac).toFixed(1)}
                        </text>
                      </g>
                    );
                  })}
                  {nodes.map((dn, idx) => {
                    const y = 22 + idx * 22;
                    const x = xOf(dn.divergenceTimeMya);
                    return (
                      <g key={`${dn.nodeLabel}-${idx}`}>
                        <line x1={x} y1={y} x2={x1} y2={y} stroke="var(--mbc-blue)" strokeWidth="1.6" opacity="0.5" />
                        <circle cx={x} cy={y} r="3.5" fill="var(--mbc-blue)" />
                        <text x={x1 + 8} y={y + 4} fontSize="10.5" fill="var(--mbc-text-main)">
                          {fmtStat(dn.divergenceTimeMya, 2)} Mya ·{' '}
                          {dn.nodeLabel.length > 34 ? `${dn.nodeLabel.slice(0, 34)}…` : dn.nodeLabel}
                        </text>
                      </g>
                    );
                  })}
                  <text x={(x0 + x1) / 2} y={height - 0.5} textAnchor="middle" fontSize="9.5" fill="var(--mbc-text-secondary)">
                    Mya (root = calibration)
                  </text>
                </svg>
              );
            })()}
            <WorkbenchSmartTable
              tableId="phylo-strict-clock-nodes"
              tableLabel="Strict-clock node ages"
              className="bio-table"
              regionMaxHeight={220}
            >
              <thead>
                <tr>
                  <th>Clade</th>
                  <th>Age (Mya)</th>
                  <th>Relative rate</th>
                </tr>
              </thead>
              <tbody>
                {clockRep.divergenceNodes.map((dn, idx) => (
                  <tr key={`${dn.nodeLabel}-${idx}`}>
                    <td>{dn.nodeLabel}</td>
                    <td>{fmtStat(dn.divergenceTimeMya, 2)}</td>
                    <td>{fmtStat(dn.relativeRate, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Molecular Clock ML Test &amp; Tajima&apos;s Relative Rate Test</h3>
            </div>

            <h4>1. Test Molecular Clock (Maximum Likelihood LRT)</h4>
            <WorkbenchSmartTable
              tableId="phylo-molecular-clock-lrt"
              tableLabel="Molecular Clock Maximum Likelihood LRT"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Model</th>
                  <th>lnL</th>
                  <th>2ΔlnL</th>
                  <th>df</th>
                  <th>p-value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>With Molecular Clock</td>
                  <td>{fmtStat(clockRep.clockTestML.lnLWithClock)}</td>
                  <td>
                    <strong>{fmtStat(clockRep.clockTestML.twoDeltaLnL)}</strong>
                  </td>
                  <td>{clockRep.clockTestML.degreesOfFreedom}</td>
                  <td>
                    {fmtP(clockRep.clockTestML.pValue)}
                    {clockRep.clockTestML.pValue !== null &&
                      (clockRep.clockTestML.clockRejected ? ' — clock rejected' : ' — clock not rejected')}
                  </td>
                </tr>
                <tr>
                  <td>Without Molecular Clock</td>
                  <td>{fmtStat(clockRep.clockTestML.lnLWithoutClock)}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              </tbody>
            </WorkbenchSmartTable>

            <h4>
              2. Tajima&apos;s Relative Rate Test ({clockRep.tajimaRelativeRate.taxonA} vs{' '}
              {clockRep.tajimaRelativeRate.taxonB}, Outgroup:{' '}
              {clockRep.tajimaRelativeRate.outgroupC})
            </h4>
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Identical Sites</span>
                <strong className="kpi-val">
                  {clockRep.tajimaRelativeRate.identicalSites}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Unique to A (m₁)</span>
                <strong className="kpi-val">
                  {clockRep.tajimaRelativeRate.uniqueToA_m1}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Unique to B (m₂)</span>
                <strong className="kpi-val">
                  {clockRep.tajimaRelativeRate.uniqueToB_m2}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">χ² (df=1) / p-val</span>
                <strong className="kpi-val">
                  {fmtStat(clockRep.tajimaRelativeRate.chiSquare)} (p={fmtP(clockRep.tajimaRelativeRate.pValue)})
                </strong>
              </div>
            </div>

            <div className="info-callout" style={{ marginTop: 8 }}>
              Relative-rate test uses sequence 1 and 2 as the ingroup pair and the last sequence as the outgroup; only
              sites with A/C/G/T in all three are counted (Tajima 1993).
            </div>
            <h4>3. Rate Correlation Test (CorrTest)</h4>
            <div className="info-callout">Not implemented.</div>
          </div>
        </div>
      )}

      {/* MODULE 12: DIAGNOSE (Clinical / Functional Missense Mutation Diagnosis — EP & Grantham) */}
      {evoTab === 'diagnose' && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Diagnose Mutation(s) — Functional &amp; Evolutionary Impact (nSNV)</h3>
              <span className="badge-accent">Grantham • BLOSUM62 • Homolog frequency</span>
            </div>

            <div className="form-grid-3col">
              <label className="form-field">
                <span>Amino-acid position (in sequence 1):</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={diagPosAa}
                  onChange={(e) => setDiagPosAa(Number(e.target.value))}
                />
              </label>
              <label className="form-field">
                <span>Wild-Type Residue (1-Letter):</span>
                <input
                  type="text"
                  maxLength={1}
                  value={diagWtAa}
                  onChange={(e) => setDiagWtAa(e.target.value.toUpperCase())}
                />
              </label>
              <label className="form-field">
                <span>Mutant Allele (1-Letter):</span>
                <input
                  type="text"
                  maxLength={1}
                  value={diagMutAa}
                  onChange={(e) => setDiagMutAa(e.target.value.toUpperCase())}
                />
              </label>
            </div>

            <div className="cloning-method-tabs">
              <span style={{ fontSize: 11.5, fontWeight: 600, alignSelf: 'center' }}>
                Presets:
              </span>
              {[
                { pos: 66, wt: 'Y', mut: 'H', label: 'Y66H (GFP→BFP Chromophore)' },
                { pos: 65, wt: 'S', mut: 'T', label: 'S65T (wtGFP→eGFP)' },
                { pos: 203, wt: 'T', mut: 'Y', label: 'T203Y (eGFP→EYFP)' },
                { pos: 146, wt: 'N', mut: 'W', label: 'N146W (Radical Shift)' },
              ].map((p) => (
                <button
                  key={p.label}
                  className="method-tab-btn"
                  onClick={() => {
                    setDiagPosAa(p.pos);
                    setDiagWtAa(p.wt);
                    setDiagMutAa(p.mut);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Substitution</span>
                <strong className="kpi-val">{diagnosisRep.substitutionLabel}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Mutant / WT freq. in homologs</span>
                <strong className="kpi-val">
                  {fmtStat(diagnosisRep.evolutionaryProbabilityMutant, 2)} /{' '}
                  {fmtStat(diagnosisRep.siteConservationScore, 2)}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Grantham Distance</span>
                <strong className="kpi-val">{diagnosisRep.granthamDistance}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">BLOSUM62 / Site variability</span>
                <strong className="kpi-val">
                  {diagnosisRep.blosum62Score} / {fmtStat(diagnosisRep.relativeSiteRate)}
                  {diagnosisRep.relativeSiteRate !== null ? '×' : ''}
                </strong>
              </div>
            </div>

            <div className="cloning-result-box">
              <div className="result-headline">
                <strong>Functional Impact Diagnosis:</strong>{' '}
                <span
                  style={{
                    color:
                      diagnosisRep.clinicalImpact === 'Pathogenic / Damaging'
                        ? 'var(--mbc-red)'
                        : diagnosisRep.clinicalImpact === 'Moderately Disruptive'
                        ? 'var(--mbc-amber)'
                        : 'var(--mbc-green)',
                    fontWeight: 700,
                  }}
                >
                  {diagnosisRep.clinicalImpact}
                </span>
              </div>
              <p className="result-summary-text">{diagnosisRep.rationale}</p>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Batch Missense Variant Screening Table</h3>
              <span className="badge-accent">GFP presets — positions in sequence 1</span>
            </div>
            <WorkbenchSmartTable
              tableId="phylo-missense-variant-screening"
              tableLabel="Batch Missense Variant Screening"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Mutant freq.</th>
                  <th>Grantham</th>
                  <th>BLOSUM62</th>
                  <th>Predicted Impact</th>
                </tr>
              </thead>
              <tbody>
                {gfpReferenceVariantRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      None of the GFP reference variants matches the residues of sequence 1, so none is screened.
                      Use the single-variant diagnosis above for this protein.
                    </td>
                  </tr>
                ) : gfpReferenceVariantRows.map((d) => (
                  <tr key={d.substitutionLabel}>
                    <td>
                      <strong>{d.substitutionLabel}</strong>
                    </td>
                    <td>{fmtStat(d.evolutionaryProbabilityMutant, 2)}</td>
                    <td>{d.granthamDistance}</td>
                    <td>{d.blosum62Score}</td>
                    <td>
                      <strong
                        style={{
                          color:
                            d.clinicalImpact === 'Pathogenic / Damaging'
                              ? '#dc2626'
                              : d.clinicalImpact === 'Moderately Disruptive'
                              ? '#d97706'
                              : '#16a34a',
                        }}
                      >
                        {d.clinicalImpact}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}
    </div>
  );
};
