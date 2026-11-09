// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Genomics, NGS, Gene/Repeat Prediction, Protein Topology & 3D Kabsch Structure Bridge
 * backed by the compiled Rust `molbiocraft-{core,formats,align,protein}` workspace crates
 * (`rust-bio`, `noodles`, `nalgebra` 3×3 SVD Kabsch superposition, `rustc-hash`).
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { SequenceDocument, SequenceFeature } from '../types/bio';
import { findORFs, translateSequence } from './bioEngine';

export function complementOnlySequence(seq: string, isRna = false): string {
  return invokeRustBioSync<string>('complement_sequence', { seq, isRna });
}

export function reverseOnlySequence(seq: string): string {
  return invokeRustBioSync<string>('reverse_only_sequence', { seq });
}

export interface BbdukTrimOptions {
  kmerLen?: number;
  minPhredQuality?: number;
  trimAdapters?: boolean;
  trimLowComplexityEnds?: boolean;
}

export interface BbdukTrimReport {
  originalLengthBp: number;
  trimmedLengthBp: number;
  basesRemoved5Prime: number;
  basesRemoved3Prime: number;
  retainedPercent: number;
  gcPercent: number;
  adapterMatches: { adapterName: string; positionBp: number; matchedKmer: string }[];
  trimmedSequence: string;
}

export function runBbdukReadTrimming(
  rawSeq: string,
  qualities?: number[],
  opts: BbdukTrimOptions = {}
): BbdukTrimReport {
  return invokeRustBioSync<BbdukTrimReport>('run_bbduk_trim', {
    seq: rawSeq,
    qualities: qualities ?? null,
    options: {
      kmerLen: opts.kmerLen ?? 11,
      minPhredQuality: opts.minPhredQuality ?? 20,
      trimAdapters: opts.trimAdapters ?? true,
      trimLowComplexityEnds: opts.trimLowComplexityEnds ?? true,
    },
  });
}

export type NgsMapperEngine = 'Minimap2' | 'Bowtie2' | 'BBMap';

export interface NgsReferenceMappingReport {
  mapper: NgsMapperEngine;
  strand: '+' | '-';
  refStartBp: number;
  refEndBp: number;
  mappedReadBases: number;
  seedHits: number;
  identityPercent: number;
  coverageBreadthPercent: number;
  mapqScore: number;
  cigar: string;
  mergedConsensusPreview: string;
}

export function runNgsReferenceMapping(
  referenceSeq: string,
  readSeq: string,
  mapper: NgsMapperEngine = 'Minimap2'
): NgsReferenceMappingReport {
  return invokeRustBioSync<NgsReferenceMappingReport>('run_ngs_mapping', {
    referenceSeq,
    readSeq,
    mapper,
  });
}

export type DeNovoAssemblerEngine = 'CAP3' | 'Velvet' | 'Flye' | 'MIRA';

export interface AssembledContigRecord {
  id: string;
  name: string;
  lengthBp: number;
  gcPercent: number;
  readCount: number;
  meanCoverageDepth: number;
  sequence: string;
}

export interface DeNovoAssemblyReport {
  assembler: DeNovoAssemblerEngine;
  kmerOrOverlapBp: number;
  inputReadCount: number;
  contigCount: number;
  totalAssembledBp: number;
  largestContigBp: number;
  n50Bp: number;
  l50Count: number;
  contigs: AssembledContigRecord[];
}

export function runDeNovoAssembly(
  inputs: { name: string; sequence: string }[],
  assembler: DeNovoAssemblerEngine = 'CAP3',
  minOverlapBp = 18
): DeNovoAssemblyReport {
  return invokeRustBioSync<DeNovoAssemblyReport>('run_de_novo_assembly', {
    inputs,
    assembler,
    minOverlapBp,
  });
}

export interface SyntenyLcbBlock {
  blockId: string;
  strand: '+' | '-';
  eventClass: 'Collinear Synteny' | 'Inversion' | 'Translocation / Rearrangement';
  genomeAStart: number;
  genomeAEnd: number;
  genomeBStart: number;
  genomeBEnd: number;
  lengthBp: number;
  identityPercent: number;
}

export interface WholeGenomeSyntenyReport {
  engine: 'LASTZ' | 'Mauve';
  totalAlignedBp: number;
  /** The A/C/G/T bases of genome A the blocks cover, as a percentage of A's A/C/G/T bases. */
  genomeACoveragePct: number;
  /** True when the scan sampled genome B (indexed it at a stride above 1), so the coverage is a lower bound. */
  genomeACoverageIsLowerBound: boolean;
  inversionCount: number;
  blocks: SyntenyLcbBlock[];
  /**
   * D0005: what qualifies the coverage, one sentence each, as the engine wrote them: each genome's
   * N and other ambiguity bases, which no block crosses, and any sampling. Empty for an N-free pair.
   */
  warnings: string[];
}

export function runWholeGenomeSynteny(
  seqA: string,
  seqB: string,
  engine: 'LASTZ' | 'Mauve' = 'Mauve'
): WholeGenomeSyntenyReport {
  return invokeRustBioSync<WholeGenomeSyntenyReport>('run_whole_genome_synteny', {
    seqA,
    seqB,
    engine,
  });
}

export interface FreeBayesVariantRecord {
  id: string;
  positionBp: number;
  refAllele: string;
  altAllele: string;
  variantType: 'SNP' | 'MNP' | 'INS' | 'DEL';
  mutationClass: 'Transition' | 'Transversion' | 'Multi-Nucleotide / Indel';
  phredQual: number;
  genotype: '1/1' | '0/1';
  alleleObservationBalance: number;
}

export interface FreeBayesVariantReport {
  totalVariants: number;
  snpCount: number;
  mnpOrIndelCount: number;
  tiTvRatio: number;
  variants: FreeBayesVariantRecord[];
  vcfText: string;
  annotations: SequenceFeature[];
}

export function callFreeBayesVariants(
  refName: string,
  refSeq: string,
  sampleSeq: string
): FreeBayesVariantReport {
  return invokeRustBioSync<FreeBayesVariantReport>('call_freebayes_variants', {
    refName,
    refSeq,
    sampleSeq,
  });
}

export interface MicrosatelliteStrLocus {
  id: string;
  motif: string;
  unitLengthBp: number;
  repeatCopies: number;
  startBp: number;
  endBp: number;
  tractLengthBp: number;
  virtualAmpliconBp: number;
  alleleCall: string;
}

interface RustStrRecord {
  id: string;
  motif: string;
  periodBp: number;
  repeatUnits: number;
  startBp: number;
  endBp: number;
  tractLengthBp: number;
}

/** Every di- to hexanucleotide STR locus of the sequence (homopolymers are left out), in sequence order: the engine's list has no cap. */
export function scanMicrosatelliteStrs(
  rawSeq: string,
  minRepeatCopies = 4
): MicrosatelliteStrLocus[] {
  const raw = invokeRustBioSync<RustStrRecord[]>('scan_microsatellite_strs', {
    seq: rawSeq,
    minUnitsDiPlus: minRepeatCopies,
    minHomopolymerBp: 1000000,
  });
  return raw.map((r) => ({
    id: r.id,
    motif: r.motif,
    unitLengthBp: r.periodBp,
    repeatCopies: r.repeatUnits,
    startBp: r.startBp,
    endBp: r.endBp,
    tractLengthBp: r.tractLengthBp,
    virtualAmpliconBp: r.tractLengthBp + 140,
    alleleCall: `(${r.motif})${r.repeatUnits}`,
  }));
}

export interface TaxonomicClassificationHit {
  rank: number;
  lineage: string;
  taxonName: string;
  markerClass: string;
  confidencePct: number;
  matchedSignatures: string[];
}

export function classifySequenceTaxonomy(rawSeq: string): TaxonomicClassificationHit[] {
  return invokeRustBioSync<TaxonomicClassificationHit[]>('classify_taxonomy', { seq: rawSeq });
}

export interface CpGIslandRecord {
  id: string;
  startBp: number;
  endBp: number;
  lengthBp: number;
  gcPercent: number;
  cpgCount: number;
  obsExpRatio: number;
}

interface RustCpGIslandRecord {
  id: string;
  startBp: number;
  endBp: number;
  lengthBp: number;
  gcPercent: number;
  cpgDinucleotides: number;
  obsExpCpg: number;
}

export function findCpGIslands(
  rawSeq: string,
  minLengthBp = 200,
  minGcPercent = 50,
  minObsExp = 0.6
): { islands: CpGIslandRecord[]; annotations: SequenceFeature[] } {
  const raw = invokeRustBioSync<RustCpGIslandRecord[]>('find_cpg_islands', {
    seq: rawSeq,
    minLengthBp,
    minGcPct: minGcPercent,
    minObsExp,
  });
  const islands: CpGIslandRecord[] = raw.map((r) => ({
    id: r.id,
    startBp: r.startBp,
    endBp: r.endBp,
    lengthBp: r.lengthBp,
    gcPercent: r.gcPercent,
    cpgCount: r.cpgDinucleotides,
    obsExpRatio: r.obsExpCpg,
  }));
  const annotations: SequenceFeature[] = islands.map((isl, idx) => ({
    id: isl.id,
    name: `CpG Island #${idx + 1}`,
    type: 'regulatory',
    start: isl.startBp,
    end: isl.endBp,
    strand: 1,
    color: '#0284c7',
    notes: `CpG Island (${isl.lengthBp} bp, GC=${isl.gcPercent}%, Obs/Exp=${isl.obsExpRatio})`,
  }));
  return { islands, annotations };
}

export interface GlimmerPredictedGene {
  id: string;
  geneName: string;
  strand: 1 | -1;
  frame: 1 | 2 | 3 | -1 | -2 | -3;
  startBp: number;
  endBp: number;
  lengthBp: number;
  lengthAa: number;
  startCodon: string;
  rbsMotif: string;
  codingScore: number;
  proteinPreview: string;
}

export interface GlimmerPredictionReport {
  /** The highest-scoring predicted CDS, at most 24, best first. */
  genes: GlimmerPredictedGene[];
  /** One CDS feature for each gene listed. */
  annotations: SequenceFeature[];
  /** How many CDS the engine predicted, listed or not. */
  totalPredictedCds: number;
  /** D0005: what the list leaves out, one sentence each; empty when every predicted CDS is listed. */
  warnings: string[];
}

export function predictGlimmerMicrobialGenes(
  rawSeq: string,
  minAaLength = 50
): GlimmerPredictionReport {
  return invokeRustBioSync<GlimmerPredictionReport>('predict_glimmer_genes', { seq: rawSeq, minAaLength });
}

export interface GenomicRepeatHit {
  id: string;
  repeatType: 'Direct Repeat' | 'Inverted Repeat' | 'Palindromic Site';
  armLengthBp: number;
  arm1StartBp: number;
  arm1EndBp: number;
  arm2StartBp: number;
  arm2EndBp: number;
  spacerBp: number;
  sequenceMotif: string;
}

interface RustGenomicRepeatHit {
  id: string;
  repeatType: string;
  armLengthBp: number;
  arm1StartBp: number;
  arm1EndBp: number;
  arm2StartBp: number;
  arm2EndBp: number;
  sequenceMotif: string;
}

/** The `find_genomic_repeats` reply: the engine's scan object (`GenomicRepeatScan`). */
interface RustGenomicRepeatScan {
  hits: RustGenomicRepeatHit[];
  scannedLengthBp: number;
  sequenceLengthBp: number;
  totalHits: number;
  /** Sent only when true: the scan stopped at its copy-pair bound, so `totalHits` is a lower bound. */
  totalIsLowerBound?: boolean;
  warnings: string[];
}

export interface GenomicRepeatReport {
  /**
   * The longest repeats found, at most 80, direct and inverted ranked together: of the whole
   * scanned length, or, when `totalIsLowerBound`, of the copy pairs compared before the scan stopped.
   */
  repeats: GenomicRepeatHit[];
  /** Features for the first 20 repeats listed. */
  annotations: SequenceFeature[];
  /** How many repeats the scan found, listed or not. */
  totalRepeats: number;
  /**
   * BG-01M6SQ9T: the scan stopped after comparing 10,000,000 copy pairs (D0055), so
   * `totalRepeats` is a lower bound; a warning says so.
   */
  totalIsLowerBound: boolean;
  /**
   * The minimum arm length, in bases, the scan was asked for. It is the arm the results are of
   * when it is an integer from 8 to 32 (the engine's range), as the studio's 8 to 24 always is.
   */
  minArmBp: number;
  /** How many bases were scanned, from base 1. */
  scannedLengthBp: number;
  /** The length of the sequence, in residues. */
  sequenceLengthBp: number;
  /**
   * D0005: the scan stopping short of the end; the scan stopping at its copy-pair bound, and, when
   * it stopped before it compared any inverted pair, that inverted and palindromic repeats were not
   * compared; or the list holding fewer repeats than found.
   */
  warnings: string[];
}

export function findGenomicRepeats(rawSeq: string, minArmLen = 10): GenomicRepeatReport {
  const scan = invokeRustBioSync<RustGenomicRepeatScan>('find_genomic_repeats', {
    seq: rawSeq,
    minArmBp: minArmLen,
    maxHits: 80,
  });
  const repeats: GenomicRepeatHit[] = scan.hits.map((r) => ({
    id: r.id,
    repeatType:
      r.repeatType === 'Inverted Repeat'
        ? 'Inverted Repeat'
        : r.repeatType.includes('Palindrom')
        ? 'Palindromic Site'
        : 'Direct Repeat',
    armLengthBp: r.armLengthBp,
    arm1StartBp: r.arm1StartBp,
    arm1EndBp: r.arm1EndBp,
    arm2StartBp: r.arm2StartBp,
    arm2EndBp: r.arm2EndBp,
    spacerBp: r.arm2StartBp > r.arm1EndBp ? r.arm2StartBp - r.arm1EndBp - 1 : 0,
    sequenceMotif: r.sequenceMotif,
  }));
  const annotations: SequenceFeature[] = repeats.slice(0, 20).map((r, idx) => ({
    id: r.id,
    name: `${r.repeatType} #${idx + 1}`,
    type: 'misc_feature',
    start: r.arm1StartBp,
    end: r.arm1EndBp,
    strand: r.repeatType === 'Inverted Repeat' ? -1 : 1,
    color: '#d97706',
    notes: `${r.repeatType} (${r.armLengthBp} bp arm, Mate=${r.arm2StartBp}..${r.arm2EndBp}, Spacer=${r.spacerBp} bp)`,
  }));
  return {
    repeats,
    annotations,
    totalRepeats: scan.totalHits,
    totalIsLowerBound: scan.totalIsLowerBound === true,
    minArmBp: minArmLen,
    scannedLengthBp: scan.scannedLengthBp,
    sequenceLengthBp: scan.sequenceLengthBp,
    warnings: scan.warnings,
  };
}

export interface CoiledCoilDomain {
  id: string;
  startAa: number;
  endAa: number;
  lengthAa: number;
  lupasProbability: number;
  heptadPeptide: string;
}

export interface TransmembraneHelix {
  id: string;
  helixLabel: string;
  startAa: number;
  endAa: number;
  lengthAa: number;
  meanHydropathyKd: number;
  orientation: 'In -> Out' | 'Out -> In';
  sequence: string;
}

export interface ProteinTopologyAndCoilsReport {
  proteinSequence: string;
  lengthAa: number;
  nTerminusLocation:
    | 'Cytoplasmic (Inside)'
    | 'Extracellular / Luminal (Outside)'
    | 'Soluble / Non-Membrane';
  coiledCoils: CoiledCoilDomain[];
  transmembraneHelices: TransmembraneHelix[];
}

export function extractTargetProteinSequence(doc: SequenceDocument): string {
  if (doc.moleculeType === 'Protein') {
    return doc.sequence.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
  }
  const cds = doc.features.find((f) => f.type === 'CDS');
  if (cds) {
    const raw = doc.sequence.slice(Math.max(0, cds.start - 1), cds.end);
    const oriented =
      cds.strand === -1
        ? invokeRustBioSync<string>('reverse_complement', { seq: raw })
        : raw;
    // the bioEngine readers unwrap the `{ protein | orfs, warnings }` replies; with the Standard code
    // (table 1) they read, the warnings are always empty
    const aa = translateSequence(oriented, 0).replace(/\*.*$/, '');
    if (aa.length >= 20) return aa;
  }
  const orfs = findORFs(doc.sequence, 15, false);
  if (orfs.length > 0) return orfs[0].proteinSeq;
  return translateSequence(doc.sequence, 0)
    .split('*')
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

export function predictCoiledCoilsAndTransmembrane(
  proteinSeqRaw: string
): ProteinTopologyAndCoilsReport {
  return invokeRustBioSync<ProteinTopologyAndCoilsReport>('predict_coiled_coils_and_tm', {
    proteinSeq: proteinSeqRaw,
  });
}

export interface PdbCaAtom {
  serial?: number;
  chainId?: string;
  resSeq: number;
  resName: string;
  x: number;
  y: number;
  z: number;
  bFactor?: number;
  secondaryStructure?: 'H' | 'E' | 'C' | string;
}

export interface PdbIntraChainContact {
  resA: number;
  resB: number;
  distanceAngstrom: number;
}

/** `align_pdb_kabsch` (molbiocraft-protein `PdbStructureAlignmentReport`). */
export interface PdbStructureAlignmentReport {
  atomsModelA: number;
  atomsModelB: number;
  /** The residue pairs superposed: the columns of the two chains' sequence alignment with no gap. */
  alignedResiduePairs: number;
  rmsdAngstrom: number;
  /** Scored on the sequence-paired superposition, not searched for as TM-align does: approximate. */
  tmScore: number;
  structuralSimilarityVerdict: string;
  /** The chain superposed from each structure: the author chain id for mmCIF, the chain column for PDB. */
  chainA: string;
  chainB: string;
  /** How the residues were paired and superposed, in the engine's words. */
  pairingMethod: string;
  /** Fraction (0 to 1) of the pairs whose two residues have the same one-letter code. */
  sequenceIdentity: number;
  /** The sequence alignment's score in BLOSUM62 units. */
  alignmentScore: number;
  /** The two chains' one-letter sequences as aligned, `-` for a gap. */
  alignedSequenceA: string;
  alignedSequenceB: string;
  /** Row-major 4x4 matrix `[R t; 0 0 0 1]` that maps structure B onto A. */
  transformationMatrix: number[][];
  perResidueDeviations: {
    residueIndex: number;
    resA: string;
    resB: string;
    distanceAngstrom: number;
  }[];
  rotationMatrix?: number[][];
  atomsA?: PdbCaAtom[];
  superimposedAtomsB?: PdbCaAtom[];
  intraChainContacts?: PdbIntraChainContact[];
}

export function synthesizeAlphaHelicalCaPdbFromProtein(
  _modelName: string,
  proteinSeq: string,
  maxResidues = 60
): string {
  const clean = proteinSeq
    .toUpperCase()
    .replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '')
    .slice(0, maxResidues);
  return invokeRustBioSync<string>('synthesize_folded_pdb', {
    proteinSeq: clean,
    chainId: 'A',
    perturbationAngstrom: 0.0,
  });
}

export function parsePdbCaCoordinates(pdbText: string): PdbCaAtom[] {
  return invokeRustBioSync<PdbCaAtom[]>('parse_pdb_ca', { pdbText });
}

export function alignPdbStructuresKabsch(
  pdbTextA: string,
  pdbTextB: string
): PdbStructureAlignmentReport {
  return invokeRustBioSync<PdbStructureAlignmentReport>('align_pdb_kabsch', {
    pdbA: pdbTextA,
    pdbB: pdbTextB,
  });
}

export interface MutateShuffleOptions {
  mode: 'point-mutate' | 'shuffle-dinucleotide' | 'shuffle-mononucleotide';
  mutationRatePercent?: number;
  tiTvBias?: number;
  seed?: number;
}

export interface MutateShuffleReport {
  mode: MutateShuffleOptions['mode'];
  originalLengthBp: number;
  outputLengthBp: number;
  mutationsApplied: number;
  gcOriginalPct: number;
  gcOutputPct: number;
  dinucleotideCorrelation: number;
  outputSequence: string;
}

export function mutateAndShuffleSequence(
  rawSeq: string,
  opts: MutateShuffleOptions
): MutateShuffleReport {
  return invokeRustBioSync<MutateShuffleReport>('mutate_or_shuffle_sequence', {
    seq: rawSeq,
    mode: opts.mode,
    mutationRatePct: opts.mutationRatePercent ?? 2.5,
    seed: opts.seed ?? 20261030,
  });
}

export interface GenBankSubmissionMeta {
  organism: string;
  strainOrIsolate: string;
  molType: 'genomic DNA' | 'mRNA' | 'other DNA' | 'viral cRNA';
  geneticCodeId: 1 | 11;
}

export interface GenBankValidationIssue {
  severity: 'PASS' | 'WARN' | 'ERROR';
  rule: string;
  message: string;
}

export interface GenBankSubmissionPackage {
  readyForSubmission: boolean;
  issues: GenBankValidationIssue[];
  fastaFsaText: string;
  featureTableTblText: string;
}

export function prepareGenBankSubmissionPackage(
  doc: SequenceDocument,
  meta: GenBankSubmissionMeta
): GenBankSubmissionPackage {
  return invokeRustBioSync<GenBankSubmissionPackage>('prepare_genbank_submission', {
    doc,
    meta,
  });
}
