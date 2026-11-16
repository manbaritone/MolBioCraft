// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

export type Topology = 'circular' | 'linear';
export type MoleculeType = 'DNA' | 'RNA' | 'Protein';

/**
 * The one active interval on a molecule (MB-NAV-01), in 1-based inclusive coordinates - the
 * same `{ start, end }` the App passes to every viewer as `selectedRange`. On a linear molecule
 * `start <= end` always; on a circular molecule `start > end` means the interval crosses the
 * origin and covers `start..length` then `1..end`. Readers of `selectedRange` take its length,
 * bases, sector and reverse-complement remap from `src/core/activeInterval.ts`
 * (`selectionInterval`, `intervalLength`, `intervalSequence`, `reverseInterval`), never from
 * `end - start` - which is wrong for such an interval.
 */
export interface ActiveInterval {
  start: number;
  end: number;
}

/** Which edge of an {@link ActiveInterval} a resize moves. */
export type IntervalEdge = 'start' | 'end';

/**
 * A 0-based, half-open render boundary: the bases `sequence.slice(startIndex, endExclusive)`
 * covers. A crossing interval yields two of these.
 */
export interface IntervalRenderSegment {
  startIndex: number;
  endExclusive: number;
}

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
  // Heuristic rank: a rule of thumb over five features of the spacer and one of its PAM,
  // six in all, inside the engine's own CRISPR_HEURISTIC_RANK_RANGE (cloning_crispr.rs) — not a
  // Doench model and not a measured or predicted cutting efficiency.
  onTargetScore: number;
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

/** How the built-in catalogue spells a host methylation an enzyme is sensitive to. */
export type MethylationSensitivity = 'Dam' | 'Dcm' | 'CpG' | 'EcoKI';

/** Where an enzyme comes from: the read-only built-in catalogue, or the user's enzyme database. */
export type EnzymeSource = 'builtin' | 'custom';

export interface RestrictionEnzyme {
  /**
   * Stable for the enzyme's life (US-01M7DV1V): a built-in's is its catalogue name, verbatim; a
   * custom definition's is its `custom:` id. Every enzyme the engine returns carries one; a caller
   * may omit it, and the engine then reads the name as the id.
   */
  id?: string;
  /** Every enzyme the engine returns carries one; omitted, the engine reads `custom` exactly when the id starts with `custom:`. */
  source?: EnzymeSource;
  name: string;
  recognitionSeq: string; // e.g., GAATTC or GGTCTC
  cutFwd: number;         // 0-indexed offset from start of recognitionSeq on top strand
  cutRev: number;         // 0-indexed offset from start of recognitionSeq on bottom strand
  isTypeIIS?: boolean;
  suppliers: string[];    // e.g. ['NEB', 'Thermo', 'Takara']
  methylationSensitivity: MethylationSensitivity[];
  bufferNEB: string;
  tempC: number;
  /** Free text naming where the definition came from; '' for a built-in. */
  provenance?: string;
  notes?: string;
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
  /**
   * Where the primer came from when it was added from the Primer Database (US-01M7DQMY): the
   * record's id and a copy of what it was then, never a link to it, so editing or trashing the
   * record leaves this primer as it was added. Absent for a primer added any other way.
   */
  source?: PrimerSourceSnapshot;
}

/** How a binding site was found: the engine's match rule and the settings it ran with (US-01M7DQMY). */
export interface PrimerMatchConditions {
  /** The match rule, in words. */
  method: string;
  /** The most mismatches the search allowed outside the 3' clamp. */
  maxMismatches: number;
  /** The 3'-terminal bases that had to match exactly. */
  clamp3PrimeBases: number;
  /** The mismatches this binding site has. */
  mismatches: number;
  /**
   * The conditions of the effective Tm, in words; absent where the Tm is unavailable
   * (`PrimerSourceSnapshot.thermoUnavailableReason`).
   */
  tmConditions?: string;
}

/** A document primer's copy of the Primer Database record it was added from (US-01M7DQMY, D0119). */
export interface PrimerSourceSnapshot {
  kind: 'primerDatabase';
  /** The database record's id. */
  recordId: string;
  /** The record's name, sequence (5' -> 3', tail included), 5' tail, molecule and modification text when it was added. */
  name: string;
  sequence: string;
  tail5Prime: string;
  molecule: PrimerMolecule;
  modifications: string;
  /** The `sequenceRevision` of the target the primer was found on. */
  sequenceRevision: string;
  match: PrimerMatchConditions;
  /** Why the engine computes no Tm or ΔG for this record (RNA or a modification); absent when it does. */
  thermoUnavailableReason?: string;
}

/** What a primer in the Primer Database is made of: DNA keeps T, RNA keeps U (US-01M7DQVT). */
export type PrimerMolecule = 'DNA' | 'RNA';

/**
 * A reusable primer kept in the user's Primer Database (US-01M7DQVT, decision D0119), stored by
 * `src/core/primerDatabase.ts`. It is not a document's `PrimerRecord`, which is one binding
 * occurrence of a primer on one sequence.
 */
export interface DatabasePrimer {
  /** Stable for the record's life: add, edit, trash, restore and backup keep it. */
  id: string;
  name: string;
  /**
   * The whole primer 5' -> 3', tail included, normalized: uppercase, without whitespace or
   * 5'-/-3' marks. IUPAC ambiguity codes are kept.
   */
  sequence: string;
  /** The sequence as it was entered or imported, before normalization. */
  originalInput: string;
  molecule: PrimerMolecule;
  /** Free modification text (for example "5' FAM" or an IDT code such as /5Phos/); '' for none. */
  modifications: string;
  /**
   * The 5' non-annealing tail, a strict prefix of `sequence`; '' when no tail is known. The
   * annealing portion is the rest of `sequence`.
   */
  tail5Prime: string;
  description: string;
  /** Labels a lab files its primers under, standing in for project collections (D0120). */
  labels: string[];
  /** ISO 8601 times. */
  createdAt: string;
  modifiedAt: string;
  /** Where the record came from, for example "Entered by hand". */
  provenance: string;
  /** ISO 8601 time the record was moved to the trash; absent while it is active. */
  trashedAt?: string;
}

/**
 * A restriction enzyme the user defined, kept in their enzyme database (US-01M7DVMJ), stored by
 * `src/core/enzymeDatabase.ts`. It is never a built-in catalogue entry: the store holds custom
 * definitions only. Its motif and offset fields are named as `RestrictionEnzyme`'s are and
 * measured the same way.
 */
export interface CustomEnzymeDefinition {
  /** Stable for the definition's life: export and import keep it. The store mints `custom:` and a UUID. */
  id: string;
  /** Every stored definition is custom. */
  source: 'custom';
  /** The display name, trimmed. The store adds one equal to a built-in's only once the user confirms it (`sharesBuiltInName`). */
  name: string;
  /**
   * The IUPAC recognition motif 5' -> 3' on the top strand, uppercase, without whitespace. A
   * definition has no strand field: a site read on the bottom strand is entered as its reverse
   * complement.
   */
  recognitionSeq: string;
  /** Top-strand cut, a whole number of bases from the motif's first base; may lie outside the motif, either side. */
  cutFwd: number;
  /** Bottom-strand cut, measured as `cutFwd` is. */
  cutRev: number;
  isTypeIIS: boolean;
  /** Spelled as the built-in catalogue spells it; empty unless set. */
  methylationSensitivity: MethylationSensitivity[];
  /** The catalogue name of the built-in this definition was cloned from; absent when it was not. */
  clonedFrom?: string;
  /** The built-in catalogue name the user confirmed this definition's name may equal; absent otherwise. */
  sharesBuiltInName?: string;
  /** Free text, for example a REBASE or supplier reference; '' for none. */
  provenance: string;
  notes: string;
  /** ISO 8601 times. */
  createdAt: string;
  modifiedAt: string;
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
  /** The id of the custom definition that cut this end (US-01M7DVD5); absent for a built-in's end and a terminus. */
  leftEnzymeId?: string;
  /** 'custom' when a custom definition cut this end; absent otherwise. */
  leftEnzymeSource?: EnzymeSource;
  rightEnzyme: string;
  rightOverhang: string;
  rightOverhangType: '5prime' | '3prime' | 'blunt';
  /** As `leftEnzymeId`, for the right end. */
  rightEnzymeId?: string;
  /** As `leftEnzymeSource`, for the right end. */
  rightEnzymeSource?: EnzymeSource;
  sequence: string;
}

/**
 * The enzymes a digest by id cuts with (US-01M7DVD5, D0150): a built-in by its catalogue id (its
 * name), a custom enzyme by its whole definition.
 */
export type EnzymeDigestSelection = Array<string | RestrictionEnzyme>;

/**
 * A selected enzyme a digest by id did not use, or two whose cuts at one top-strand position leave
 * different ends where at least one is a custom definition (D0151). `name` is how it is shown
 * (`enzymeLabel`); a clash names both.
 */
export interface UnresolvedDigestEnzyme {
  name: string;
  enzymeIds: string[];
  kind: 'unknownId' | 'unreadableDefinition' | 'noCustomId' | 'sourceNotCustom' | 'clash';
  reason: string;
}

/** A digest by id: its fragments, what it could not use, and whether it is the digest asked for. */
export interface EnzymeDigest {
  fragments: DigestFragment[];
  unresolvedEnzymes: UnresolvedDigestEnzyme[];
  /** False whenever `unresolvedEnzymes` is not empty. */
  complete: boolean;
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
