// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Phylogenetics & Molecular Evolution Engine Bridge
 * backed by the compiled Rust `molbiocraft-phylo` crate (`petgraph`, `statrs`,
 * Felsenstein pruning ML, Fitch MP, Tamura-Nei / GTR+G+I, RelTime molecular clocks,
 * Nei-Gojobori dN/dS, Tajima's D, and Grantham / BLOSUM62 missense diagnostics).
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';

export type SubstitutionModelName =
  | 'p-distance'
  | 'Jukes-Cantor (JC69)'
  | 'Kimura 2-parameter (K2P)'
  | 'Tamura 3-parameter (T92)'
  | 'Hasegawa-Kishino-Yano (HKY85)'
  | 'Tamura-Nei (TN93)'
  | 'General Time Reversible (GTR+G+I)'
  | 'Maximum Composite Likelihood (MCL)';

export type PhyloTreeAlgorithm =
  | 'Maximum Likelihood (ML)'
  | 'FastTree (Approx-ML)'
  | 'PhyML (ML + SH-aLRT)'
  | 'RAxML (GTR+G Rapid ML)'
  | 'MrBayes (Bayesian MCMC)'
  | 'Neighbor-Joining (NJ)'
  | 'Minimum-Evolution (ME)'
  | 'UPGMA'
  | 'Maximum Parsimony (MP)';

export type GeneticCodeTableId = 1 | 2 | 3 | 5 | 11;

export interface ActiveDataExplorationReport {
  numTaxa: number;
  numSites: number;
  conservedSites: number;
  variableSites: number;
  parsimonyInformativeSites: number;
  singletonSites: number;
  zeroFoldDegenerateSites: number;
  twoFoldDegenerateSites: number;
  fourFoldDegenerateSites: number;
  gapOrMissingSites: number;
}

export interface ModelSelectionRankingRow {
  model: string;
  parametersK: number;
  logLikelihood: number;
  bic: number;
  aicc: number;
  aic: number;
  gammaShapeAlpha: string;
  invariantSitesI: string;
  tiTvRatioR: number;
}

export interface NucleotideCompositionRow {
  taxonName: string;
  lengthBp: number;
  pctT: number;
  pctC: number;
  pctA: number;
  pctG: number;
  pctGC: number;
  pctGC1: number;
  pctGC2: number;
  pctGC3: number;
}

export interface CodonUsageRow {
  codon: string;
  aminoAcid: string;
  count: number;
  frequencyPerThousand: number;
  rscu: number;
}

/** Values the engine could not compute arrive as `null` (Rust NaN → JSON null). */
export type Maybe = number | null;

/** Format a possibly-undefined statistic: `null`/non-finite → "n/a". */
export function fmtStat(v: Maybe | undefined, digits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return digits === undefined ? String(v) : v.toFixed(digits);
}

/** Format a p-value; values below 1e-4 (reported as 0 after rounding) read "< 0.0001". */
export function fmtP(v: Maybe | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return v < 1e-4 ? '< 0.0001' : v.toFixed(4);
}

export interface SubstitutionRateMatrixReport {
  /** r_ij (%) with the 12 off-diagonal entries summing to 100; diagonal is null. */
  matrix4x4: { from: string; toA: Maybe; toT: Maybe; toC: Maybe; toG: Maybe }[];
  purineKappa1: Maybe;
  pyrimidineKappa2: Maybe;
  overallTiTvRatioR: Maybe;
  disparityPairs: {
    taxonA: string;
    taxonB: string;
    disparityIndexId: Maybe;
    pValue: Maybe;
  }[];
}

export interface DistanceAnalysisReport {
  model: SubstitutionModelName;
  taxaNames: string[];
  /** Lower triangle: distance; upper triangle: SE. `null` = not computable (saturated). */
  pairwiseMatrix: Maybe[][];
  overallMeanDistance: Maybe;
  overallMeanSE: Maybe;
  withinGroupMeans: { groupName: string; taxonCount: number; meanDistance: Maybe; se: Maybe }[];
  betweenGroupMeans: {
    groupA: string;
    groupB: string;
    meanDistance: Maybe;
    netDistanceDa: Maybe;
    se: Maybe;
  }[];
}

export interface DiversityAnalysisReport {
  withinSubpopulationPiS: Maybe;
  withinSubpopulationSE: Maybe;
  entirePopulationPiT: Maybe;
  entirePopulationSE: Maybe;
  interpopulationDiversityDeltaST: Maybe;
  interpopulationSE: Maybe;
  coefficientOfDifferentiationGst: Maybe;
  coefficientSE: Maybe;
  haplotypeDiversityHd: Maybe;
  /** Nei (1987) sampling SE of Hd. */
  haplotypeDiversitySE: Maybe;
}

export interface PhyloTreeInferenceReport {
  algorithm: PhyloTreeAlgorithm;
  model: SubstitutionModelName;
  bootstrapReplicates: number;
  newick: string;
  logLikelihood: Maybe;
  totalTreeLengthS: number;
  parsimonySteps: number;
  consistencyIndexCI: Maybe;
  retentionIndexRI: Maybe;
  /** One row per non-trivial clade (bipartition) of the inferred tree. */
  cladeBootstraps: { cladeLabel: string; supportPct: number; branchLength: number }[];
  /** What was actually computed (topology method, likelihood model, bootstrap replicates run). */
  methodNote: string;
  warnings: string[];
}

export interface UserTreeAnalysisReport {
  newick: string;
  mlLogLikelihood: Maybe;
  mlAicc: Maybe;
  olsSumOfSquaresSSE: Maybe;
  olsRSquared: Maybe;
  parsimonyLengthSteps: number;
  consistencyIndex: Maybe;
  retentionIndex: Maybe;
  notes: string[];
  duplicationNodes: {
    nodeId: string;
    eventType: 'Speciation (S)' | 'Gene Duplication (D)';
    descendantTaxa: string[];
    confidencePct: number;
  }[];
  siteCoverageBins: { thresholdLabel: string; siteCount: number; pctOfAlignment: number }[];
}

export interface AncestralReconstructionReport {
  /** Description of the reconstruction actually performed. */
  method: string;
  nodes: {
    nodeName: string;
    descendants: string;
    ancestralSequence: string;
    meanPosteriorConfidence: Maybe;
  }[];
  siteEvolutionaryProbabilities: {
    position: number;
    consensusState: string;
    probA: number;
    probC: number;
    probG: number;
    probT: number;
    ancestralStateRoot: string;
  }[];
}

export interface SelectionAndNeutralityReport {
  dN: Maybe;
  dS: Maybe;
  omegaDnDs: Maybe;
  zTestNeutrality: { zStat: Maybe; pValue: Maybe; significant: boolean };
  zTestPositive: { zStat: Maybe; pValue: Maybe; significant: boolean };
  zTestPurifying: { zStat: Maybe; pValue: Maybe; significant: boolean };
  fisherExactPValue: Maybe;
  tajimaNeutrality: {
    sampleSizeM: number;
    segregatingSitesS: number;
    psProportion: Maybe;
    thetaWatterson: Maybe;
    nucleotideDiversityPi: Maybe;
    tajimaD: Maybe;
    interpretation: string;
  };
  /** Pair-averaged pN − pS per variable codon (descriptive; not a per-site test). */
  codonSiteSelection: {
    codonIndex: number;
    codonsObserved: string;
    aminoAcidsObserved: string;
    dNMinusDS: number;
    selectionRegime: string;
  }[];
  notes: string[];
}

export interface SiteRatesReport {
  gammaShapeAlpha: Maybe;
  numCategories: number;
  categoryRates: { category: number; relativeRate: number; probability: number }[];
  siteRates: { position: number; relativeRate: number; entropyBits: number; rateCategory: number }[];
  note: string;
}

export type ClockMethod = 'RelTime-ML' | 'RelTime-OLS' | 'RelTime-Branch Lengths' | 'RTDT-RelTime-ML';

export interface MolecularClockAndTimetreeReport {
  /** Requested method and what was actually computed. */
  method: string;
  calibrationNodeName: string;
  calibrationAgeMya: number;
  clockTestML: {
    lnLWithClock: Maybe;
    lnLWithoutClock: Maybe;
    twoDeltaLnL: Maybe;
    degreesOfFreedom: number;
    pValue: Maybe;
    clockRejected: boolean;
  };
  tajimaRelativeRate: {
    taxonA: string;
    taxonB: string;
    outgroupC: string;
    identicalSites: number;
    uniqueToA_m1: number;
    uniqueToB_m2: number;
    chiSquare: Maybe;
    pValue: Maybe;
    equalRatesAccepted: boolean;
  };
  /** Not implemented: all values are null. */
  corrTest: {
    rhoCorrelationScore: Maybe;
    pValue: Maybe;
    autocorrelatedRates: boolean;
  };
  divergenceNodes: {
    nodeLabel: string;
    relativeRate: Maybe;
    divergenceTimeMya: Maybe;
    ci95LowMya: Maybe;
    ci95HighMya: Maybe;
  }[];
  notes: string[];
}

export interface MutationDiagnosisResult {
  positionAa: number;
  wildTypeAa: string;
  mutantAa: string;
  substitutionLabel: string;
  /** Unweighted frequency of the mutant residue among aligned homologs (null without homologs). */
  evolutionaryProbabilityMutant: Maybe;
  /** Frequency of the wild-type residue among aligned homologs. */
  siteConservationScore: Maybe;
  /** Site entropy relative to the alignment mean (protein alignments only). */
  relativeSiteRate: Maybe;
  homologsCompared: number;
  /** −1 when a residue is not one of the 20 standard amino acids. */
  granthamDistance: number;
  blosum62Score: number;
  clinicalImpact: 'Neutral / Benign' | 'Moderately Disruptive' | 'Pathogenic / Damaging';
  rationale: string;
}

/**
 * Whether sequence 1 carries the variant's wild-type residue, per the engine's
 * own reference check (codon-aware for nucleotide alignments).
 */
export function wildTypeMatchesSequenceOne(d: Pick<MutationDiagnosisResult, 'rationale'>): boolean {
  return !/Sequence 1 has |beyond sequence 1/.test(d.rationale);
}

export function exploreActiveAlignmentData(
  alignedSeqs: string[]
): ActiveDataExplorationReport {
  return invokeRustBioSync<ActiveDataExplorationReport>('explore_alignment_data', {
    alignedSeqs,
  });
}

export function findBestSubstitutionModels(
  alignedSeqs: string[]
): ModelSelectionRankingRow[] {
  return invokeRustBioSync<ModelSelectionRankingRow[]>('find_best_substitution_models', {
    alignedSeqs,
  });
}

export function computeSubstitutionRateMatrix(
  names: string[],
  alignedSeqs: string[]
): SubstitutionRateMatrixReport {
  return invokeRustBioSync<SubstitutionRateMatrixReport>('compute_substitution_rate_matrix', {
    names,
    alignedSeqs,
  });
}

export function computeNucleotideCompositionByCodonPos(
  names: string[],
  alignedSeqs: string[]
): NucleotideCompositionRow[] {
  return invokeRustBioSync<NucleotideCompositionRow[]>(
    'compute_nucleotide_composition_by_codon_pos',
    { names, alignedSeqs }
  );
}

export function computeRelativeSynonymousCodonUsage(
  alignedSeqs: string[]
): CodonUsageRow[] {
  return invokeRustBioSync<CodonUsageRow[]>('compute_rscu', { alignedSeqs });
}

/** `groups[i]` is the population/group of sequence i ('' = ungrouped). */
export function computeEvolutionaryDistances(
  names: string[],
  alignedSeqs: string[],
  model: SubstitutionModelName = 'Maximum Composite Likelihood (MCL)',
  groups: string[] = []
): DistanceAnalysisReport {
  return invokeRustBioSync<DistanceAnalysisReport>('compute_evolutionary_distances', {
    names,
    alignedSeqs,
    model,
    groups,
  });
}

/** Nei (1987) diversity; between-population statistics need ≥ 2 groups. */
export function computePopulationDiversity(
  names: string[],
  alignedSeqs: string[],
  model: SubstitutionModelName = 'Maximum Composite Likelihood (MCL)',
  groups: string[] = []
): DiversityAnalysisReport {
  return invokeRustBioSync<DiversityAnalysisReport>('compute_population_diversity', {
    names,
    alignedSeqs,
    model,
    groups,
  });
}

export function constructPhylogeneticTree(
  names: string[],
  alignedSeqs: string[],
  algorithm: PhyloTreeAlgorithm = 'Maximum Likelihood (ML)',
  model: SubstitutionModelName = 'Tamura-Nei (TN93)',
  bootstrapReplicates = 500,
  /** > 0: delete-d jackknife keeping this % of columns per replicate instead of the bootstrap. */
  jackknifePct = 0
): PhyloTreeInferenceReport {
  return invokeRustBioSync<PhyloTreeInferenceReport>('construct_phylogenetic_tree', {
    names,
    alignedSeqs,
    algorithm,
    model,
    bootstrapReplicates,
    jackknifePct,
  });
}

export function analyzeUserTree(
  userNewick: string,
  names: string[],
  alignedSeqs: string[]
): UserTreeAnalysisReport {
  return invokeRustBioSync<UserTreeAnalysisReport>('analyze_user_tree', {
    userNewick,
    names,
    alignedSeqs,
  });
}

export function inferAncestralSequences(
  names: string[],
  alignedSeqs: string[],
  method:
    | 'Maximum Likelihood (Empirical Bayes)'
    | 'Maximum Parsimony (Fitch)' = 'Maximum Likelihood (Empirical Bayes)'
): AncestralReconstructionReport {
  return invokeRustBioSync<AncestralReconstructionReport>('infer_ancestral_sequences', {
    names,
    alignedSeqs,
    method,
  });
}

export function runSelectionAndNeutralityTests(
  alignedSeqs: string[]
): SelectionAndNeutralityReport {
  return invokeRustBioSync<SelectionAndNeutralityReport>('run_selection_and_neutrality_tests', {
    alignedSeqs,
  });
}

export function estimateGammaAndSiteRates(
  alignedSeqs: string[],
  numCategories = 5
): SiteRatesReport {
  return invokeRustBioSync<SiteRatesReport>('estimate_gamma_and_site_rates', {
    alignedSeqs,
    numCategories,
  });
}

export function runMolecularClockAndTimetree(
  names: string[],
  alignedSeqs: string[],
  method: ClockMethod = 'RelTime-ML',
  calibrationAgeMya = 42.5
): MolecularClockAndTimetreeReport {
  return invokeRustBioSync<MolecularClockAndTimetreeReport>('run_molecular_clock_and_timetree', {
    names,
    alignedSeqs,
    method,
    calibrationAgeMya,
  });
}

/**
 * `alignedSeqs` (optional) are homologs aligned to sequence 1; `positionAa` is the ungapped
 * amino-acid position in sequence 1 (nucleotide alignments are read as codons).
 */
export function diagnoseMissenseMutation(
  positionAa: number,
  wildTypeAa: string,
  mutantAa: string,
  alignedSeqs: string[] = []
): MutationDiagnosisResult {
  return invokeRustBioSync<MutationDiagnosisResult>('diagnose_missense_mutation', {
    positionAa,
    wildTypeAa,
    mutantAa,
    alignedSeqs,
  });
}

export interface MlSearchReport {
  newick: string;
  model: string;
  logLikelihood: number;
  startLogLikelihood: number;
  nniSwaps: number;
  nniRounds: number;
  nniEvaluated: number;
  treeLength: number;
  parameters: string;
}

/** Built-in ML tree search (NJ start, NNI with branch-length optimisation). Nucleotides only. */
export function mlTreeSearch(names: string[], alignedSeqs: string[], model = 'GTR+G'): MlSearchReport {
  return invokeRustBioSync<MlSearchReport>('ml_tree_search', { names, alignedSeqs, model });
}
