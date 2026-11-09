// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

export type Topology = 'circular' | 'linear';
export type MoleculeType = 'DNA' | 'RNA' | 'Protein';

export type FeatureType =
  | 'CDS'
  | 'promoter'
  | 'terminator'
  | 'rep_origin'
  | 'primer_bind'
  | 'enhancer'
  | 'regulatory'
  | 'misc_feature'
  | 'protein_bind'
  | 'sig_peptide'
  | 'tag'
  | 'crispr_guide'
  | 'antigenic_epitope'
  | 'secondary_structure'
  | 'Domain'
  // INSDC feature keys carried by the GenBank/RefSeq sample records.
  | 'source'
  | 'accession'
  | 'gene'
  | 'mRNA'
  | 'tRNA'
  | 'rRNA'
  | 'ncRNA'
  | 'misc_RNA'
  | 'exon'
  | 'intron'
  | "5'UTR"
  | "3'UTR"
  | 'mat_peptide'
  | 'polyA_signal'
  | 'polyA_site'
  | 'RBS'
  | 'STS'
  | 'D-loop'
  | 'stem_loop'
  | 'repeat_region'
  | 'mobile_element'
  | 'telomere'
  | 'centromere'
  | 'misc_structure'
  | 'misc_binding'
  | 'misc_recomb'
  | 'variation'
  | 'unsure'
  | 'Polymorphism'
  // UniProt/PDB-derived keys used by the protein records.
  | 'Protein'
  | 'Region'
  | 'Site'
  | 'site'
  | 'Bond'
  | 'helix'
  | 'strand'
  // MolBioCraft-generated annotations.
  | 'extracted region'
  | 'trimmed';

export type NucleotideColorScheme =
  | 'standard'
  | 'electropherogram'
  | 'gc_heatmap'
  | 'purine_pyrimidine'
  | 'colorblind-safe';

export const NUCLEOTIDE_COLOR_SCHEMES: readonly NucleotideColorScheme[] = [
  'standard',
  'electropherogram',
  'gc_heatmap',
  'purine_pyrimidine',
  'colorblind-safe',
];

export type CloningMethodType =
  | 'Restriction Ligation'
  | 'Gibson Assembly'
  | 'In-Fusion Cloning'
  | 'NEBuilder HiFi Assembly'
  | 'Parts Cloning'
  | 'Golden Gate (Type IIS)'
  | 'TA / GC Cloning'
  | 'TOPO Cloning'
  | 'Gateway BP/LR Recombination'
  | 'Overlap Extension PCR';

export type GelBufferType = 'TBE' | 'TAE' | 'SB';

export interface FeatureSegment {
  index: number;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface CommonFeatureTemplate {
  id: string;
  name: string;
  type: FeatureType;
  sequenceMotif: string;
  color: string;
  description: string;
  category:
    | 'Promoter'
    | 'Terminator'
    | 'Resistance'
    | 'Origin'
    | 'Reporter'
    | 'Affinity Tag'
    | 'Protease Cleavage'
    | 'Recombination'
    | 'Linker / 2A / IRES'
    | 'Signal / Localization'
    | 'Viral / Regulatory'
    | 'CRISPR / RNAi'
    | 'Antibody / CAR-T';
  hostSystem?: string;
  lengthBp?: number;
}

export interface SecondaryStructureStemLoop {
  id: string;
  stemStart5: number;
  stemEnd5: number;
  loopStart: number;
  loopEnd: number;
  stemStart3: number;
  stemEnd3: number;
  stemLengthBp: number;
  loopLengthNt: number;
  deltaGKcalMol: number;
  topStemSeq: string;
  loopSeq: string;
  bottomStemSeq: string;
}

export interface SecondaryStructureReport {
  moleculeType: 'DNA' | 'RNA';
  lengthNt: number;
  dotBracket: string;
  minimumFreeEnergyKcalMol: number;
  pairedBasesCount: number;
  pairedPct: number;
  stemLoops: SecondaryStructureStemLoop[];
  /** The folding temperature the energies were taken at, in degrees Celsius. */
  temperatureC: number;
  /** Whether helix ends carry the terminal-mismatch energy of their neighbours (RNAfold -d2). */
  danglingEnds: boolean;
  /** Whether the molecule was folded as a closed circle, with the exterior loop wrapping the origin. */
  circular: boolean;
  /** −RT ln Q over every structure the molecule can adopt; at or below the MFE. */
  ensembleFreeEnergyKcalMol: number;
  /** The share of the ensemble that is the MFE structure exactly, 0 to 1. */
  mfeFrequency: number;
  /** Mean base-pair distance between two structures drawn from the ensemble. */
  ensembleDiversity: number;
  /** How many structures were drawn to estimate the diversity. */
  sampledStructures: number;
  /**
   * What the fold left out (D0005), as plain sentences: the 600-nt cap cutting the sequence, saying
   * too when a cut circle was folded as a linear fragment. Always sent, empty when the whole
   * molecule folded.
   */
  warnings: string[];
}

export interface DnaLigationCalculations {
  lengthBp: number;
  mwDsDnaDa: number;
  mwSsDnaDa: number;
  mwRnaDa: number;
  concNgPerUl: number;
  volumeUl: number;
  totalMassNg: number;
  pmolDsDna: number;
  pmolEndsLinear: number;
  molarityNanomolar: number;
  copyNumberPerUl: string;
  od260Units: number;
  ligationRatios: {
    ratioLabel: string;
    vectorMassNg: number;
    insertLengthBp: number;
    requiredInsertMassNg: number;
    requiredInsertPmol: number;
  }[];
}

export interface SequenceAlertItem {
  id: string;
  severity: 'warning' | 'info' | 'critical';
  category: 'Methylation' | 'Type IIS Cloning' | 'Reading Frame' | 'Primer Hybridization' | 'Secondary Structure';
  title: string;
  detail: string;
  positionBp?: number;
}

export interface MutagenesisSimulationResult {
  mode: 'Substitution' | 'Insertion' | 'Deletion';
  positionBp: number;
  originalSubseq: string;
  replacementSubseq: string;
  codonChangeLabel: string;
  forwardMutagenicPrimer: string;
  reverseMutagenicPrimer: string;
  primerTmC: number;
  annealingTempC: number;
  mutantDocument: SequenceDocument;
}

export interface AnnealedOligoResult {
  topOligo5to3: string;
  bottomOligo5to3: string;
  leftOverhang5Prime: string;
  rightOverhang5Prime: string;
  duplexLengthBp: number;
  tmDuplexC: number;
  phosphorylated5Prime: boolean;
  annealedDocument: SequenceDocument;
  /** Paired region between the oligos (bp) — the part the Tm refers to. */
  pairedLengthBp: number;
  warnings?: string[];
}

export interface BlastHitRecord {
  id: string;
  accession: string;
  description: string;
  organism: string;
  program: 'blastn' | 'blastp' | 'blastx' | 'tblastn';
  queryCoveragePct: number;
  identityPct: number;
  eValue: string;
  bitScore: number;
  alignLength: number;
  queryStart: number;
  queryEnd: number;
  subjectStart: number;
  subjectEnd: number;
  alignedQuery: string;
  alignedMidline: string;
  alignedSubject: string;
  /**
   * Why the hit comes from less than the whole query (D0005): the engine sets it when the query
   * was cut to the program's query cap. Absent when the whole query was searched.
   */
  warnings?: string[];
}

export interface SilentMutationCandidate {
  enzymeName: string;
  recognitionSeq: string;
  positionBp: number;
  codonNumber: number;
  aminoAcid: string;
  wildTypeCodon: string;
  mutantCodon: string;
  mutationLabel: string;
  /** CDS the codon belongs to (CDS-aware analysis). */
  cdsName?: string;
}

export interface CrisprGuideRecord {
  id: string;
  name: string;
  spacerSeq: string;       // 20-nt protospacer
  pamSeq: string;          // e.g. AGG, TGG, CGG, GGG or TTTA
  nuclease: 'SpCas9 (NGG)' | 'Cas12a / Cpf1 (TTTV)';
  start: number;           // 1-based start on sequence
  end: number;             // 1-based end on sequence
  cutPosition: number;     // 1-based DSB cleavage coordinate
  strand: 1 | -1;
  gcPercent: number;
  onTargetScore: number;   // rule-of-thumb activity heuristic (0-100), not a Doench model
  specificityScore: number;// 100 / (1 + exact seed matches in this sequence)
  offTargetCount: number;
}

export interface ProteinAnalysisReport {
  lengthAa: number;
  molecularWeightDa: number;
  molecularWeightKda: number;
  isoelectricPointPi: number;
  /** Net charge on the same titration the pI is the root of, read at pH 7. */
  chargeAtPh7: number;
  extinctionCoeff280Reduced: number;
  extinctionCoeff280Cystine: number;
  /** Absorbance at 280 nm of a 1 mg/ml solution in a 1 cm cell, cysteines paired as cystines. */
  a280Of1mgPerMl: number;
  gravyHydropathy: number;
  aliphaticIndex: number;
  aminoAcidCounts: Record<string, number>;
  hydrophobicityProfile: { position: number; score: number }[];
  antigenicDeterminants: { startAa: number; endAa: number; peptide: string; maxScore: number }[];
  secondaryStructureSummary: {
    helixPercent: number;
    sheetPercent: number;
    coilPercent: number;
    statesPerResidue: ('H' | 'E' | 'C')[];
  };
}

export interface SavedPrimerBindingHit {
  primer: PrimerRecord;
  bindStart: number;
  bindEnd: number;
  strand: 1 | -1;
  mismatches: number;
  effectiveTmC: number;
}

export interface SequenceFeature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 1-based inclusive
  end: number;   // 1-based inclusive
  /**
   * 1 forward, -1 reverse, 0 when the record states no direction. INSDC point features such as
   * a promoter recorded at a single base are directionless, and the reference records keep them
   * that way rather than forcing them onto a strand.
   */
  strand: 1 | -1 | 0;
  color: string;
  notes?: string;
  qualifiers?: Record<string, string>;
  segments?: FeatureSegment[];
  cleavageSite?: string;
}

export interface RestrictionEnzyme {
  name: string;
  recognitionSeq: string; // e.g., GAATTC or GGTCTC
  cutFwd: number;         // 0-indexed offset from start of recognitionSeq on top strand
  cutRev: number;         // 0-indexed offset from start of recognitionSeq on bottom strand
  isTypeIIS?: boolean;
  suppliers: string[];    // e.g. ['NEB', 'Thermo', 'Takara']
  methylationSensitivity: ('Dam' | 'Dcm' | 'CpG' | 'EcoKI')[];
  bufferNEB: string;
  tempC: number;
}

export interface RestrictionCutSite {
  id: string;
  enzyme: RestrictionEnzyme;
  position: number;        // 1-based recognition start
  cutTop: number;          // 1-based cleavage coordinate on top strand
  cutBottom: number;       // 1-based cleavage coordinate on bottom strand
  strand: 1 | -1;
  overhangSeq: string;     // cohesive overhang bases
  overhangType: '5prime' | '3prime' | 'blunt';
  methylationBlocked: boolean;
}

export interface ORFRecord {
  id: string;
  frame: 1 | 2 | 3 | -1 | -2 | -3;
  strand: 1 | -1;
  start: number; // 1-based
  end: number;   // 1-based
  lengthBp: number;
  lengthAa: number;
  startCodon: string;
  stopCodon: string;
  proteinSeq: string;
  mwKda: number;
}

export interface PrimerRecord {
  id: string;
  name: string;
  sequence: string;      // 5' -> 3' full sequence (including any 5' tail)
  annealSequence: string; // 3' template-annealing portion
  tail5Prime: string;
  bindStart: number;     // 1-based on template
  bindEnd: number;       // 1-based on template
  strand: 1 | -1;
  length: number;
  gcPercent: number;
  tmAnnealC: number;
  tmFullC: number;
  deltaG37: number;
  hairpinDeltaG: number;
  selfDimerDeltaG: number;
  gcClamp3Prime: boolean;
  notes?: string;
  /**
   * Why `tmAnnealC` is no answer (BG-01M6SHQ0): the anneal sequence holds N or another base that is
   * not A, C, G or T. It is the sentence a display shows, with "n/a", in place of the number (the
   * engine's `tm_no_answer_reason`, `tmNoAnswerSentence` here); the number stays numeric so no
   * reader of it throws. Absent for an A/C/G/T primer and for a record saved before it.
   */
  tmNoAnswerReason?: string;
}

export interface HistoryTreeNode {
  id: string;
  timestamp: string;
  operation: string; // e.g. 'Imported GenBank', 'Restriction Digest (EcoRI + BamHI)', 'Gibson Assembly'
  description: string;
  parentIds: string[];
  lengthBp: number;
  topology: Topology;
  historyColor?: string;
  insertedRange?: { start: number; end: number };
}

export interface ChromatogramData {
  traceA: number[];
  traceC: number[];
  traceG: number[];
  traceT: number[];
  peakLocations: number[];
  phredScores: number[];
  baseCalls: string;
}

export interface AlignmentMemberSequence {
  id: string;
  name: string;
  accession?: string;
  description?: string;
  organism?: string;
  sequence: string;
  strand?: 1 | -1;
  features?: SequenceFeature[];
}

export interface DocumentAlignmentMeta {
  sequenceCount?: number;
  pairwiseIdentityPct?: number;
  identicalSitesPct?: number;
  geneticCodeLabel?: string;
  meanCoverageX?: number;
  treeBuilder?: string;
  isAligned?: boolean;
  sequences?: AlignmentMemberSequence[];
}

export type SequenceDocumentIconKind =
  | 'circular-dna'
  | 'linear-dna'
  | 'primer'
  | 'alignment'
  | 'contig'
  | 'trace'
  | 'protein'
  | 'tree';

export interface SequenceDocument {
  id: string;
  name: string;
  accession: string;
  description: string;
  moleculeType: MoleculeType;
  topology: Topology;
  sequence: string;
  features: SequenceFeature[];
  primers: PrimerRecord[];
  history: HistoryTreeNode[];
  chromatogram?: ChromatogramData;
  alignmentMeta?: DocumentAlignmentMeta;
  documentKind?: SequenceDocumentIconKind;
  docMetadata?: Record<string, string | number>;
  createdAt: string;
  updatedAt: string;
  folder:
    | 'Plasmids & Vectors'
    | 'Cloning'
    | 'Cloning Inserts & PCR'
    | 'Alignments'
    | 'Contig Assembly'
    | 'Sequencing Reads (Sanger/NGS)'
    | 'Genomes'
    | 'Genomes/Bacteria'
    | 'Genomes/Eukaryotes'
    | 'Genomes/Human'
    | 'Genomes/Plants'
    | 'Genomes/Viruses'
    | 'Primers'
    | 'Protein Documents'
    | 'Protein Homologs'
    | 'Tree Documents'
    | string;
}

export interface DigestFragment {
  id: string;
  index: number;
  start: number;
  end: number;
  lengthBp: number;
  leftEnzyme: string;
  leftOverhang: string;
  leftOverhangType: '5prime' | '3prime' | 'blunt';
  rightEnzyme: string;
  rightOverhang: string;
  rightOverhangType: '5prime' | '3prime' | 'blunt';
  sequence: string;
}

export interface GelLane {
  id: string;
  label: string;
  isLadder?: boolean;
  bands: {
    sizeBp: number;
    label?: string;
    intensity: number; // 0.1 - 1.0
    fragmentId?: string;
  }[];
}

export interface PairwiseAlignmentResult {
  alignedSeq1: string;
  alignedSeq2: string;
  midline: string;
  score: number;
  matches: number;
  mismatches: number;
  gaps: number;
  identityPct: number;
  /** Identical + positively scoring (or IUPAC-compatible) columns, % of alignment length. */
  similarityPct?: number;
  /** 1-based start / end of the aligned region in sequence 1 and 2 (local alignments). */
  xstart?: number;
  xend?: number;
  ystart?: number;
  yend?: number;
  cigar?: string;
  algorithm: 'Needleman-Wunsch (Global)' | 'Smith-Waterman (Local)' | (string & {});
  engineUsed: 'C++ Native / Rust FFI' | 'TypeScript SIMD Fallback' | (string & {});
}

export interface MSARow {
  id: string;
  name: string;
  alignedSeq: string;
  identityToConsensusPct: number;
}

export interface MSAAlignmentResult {
  rows: MSARow[];
  consensus: string;
  conservation: number[]; // 0.0 - 1.0 per column
  newickTree: string;
  shannonEntropyBits?: number[];
  meanPairwiseIdentityPct?: number;
  identicalSitesPct?: number;
  /**
   * What the alignment left out of its input (D0005), one plain sentence per event: the residue
   * cap cutting one or more sequences. The engine always sends it, empty when every input was
   * aligned whole; only a result built outside the engine (the empty placeholder) leaves it out.
   */
  warnings?: string[];
}

export interface DotplotHit {
  x: number;
  y: number;
  strand: 1 | -1;
  score: number;
}

export interface VariantCall {
  position: number;
  refBase: string;
  altBase: string;
  type: 'SNP' | 'Insertion' | 'Deletion';
  phredQuality: number;
  readName: string;
  codonImpact?: string;
}
