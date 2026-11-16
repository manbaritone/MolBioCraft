// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Core Molecular Biology, Sequence Analysis, Alignment, Thermodynamics, Cloning & CRISPR Bridge
 * backed by the compiled Rust `molbiocraft-{core,align,phylo,cloning,protein}` workspace crates
 * (`rust-bio`, `noodles`, `aho-corasick`, `memchr`, `rustc-hash`).
 */

import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { sequenceRevision } from './restrictionDisplay';
import type {
  AnnealedOligoResult,
  BlastHitRecord,
  CloningMethodType,
  CommonFeatureTemplate,
  CrisprGuideRecord,
  CustomEnzymeDefinition,
  DatabasePrimer,
  DigestFragment,
  DnaLigationCalculations,
  DotplotHit,
  EnzymeDigest,
  EnzymeDigestSelection,
  MSAAlignmentResult,
  MutagenesisSimulationResult,
  ORFRecord,
  PairwiseAlignmentResult,
  PrimerMatchConditions,
  PrimerRecord,
  ProteinAnalysisReport,
  RestrictionCutSite,
  RestrictionEnzyme,
  SavedPrimerBindingHit,
  SecondaryStructureReport,
  SequenceAlertItem,
  SequenceDocument,
  SequenceFeature,
  SilentMutationCandidate,
  VariantCall,
} from '../types/bio';

export const CODON_TABLE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

export function cleanSequence(raw: string): string {
  return invokeRustBioSync<string>('clean_sequence', {
    seq: raw,
    alphaOnly: true,
  }).replace(/U/g, 'T');
}

export function complement(seq: string): string {
  return invokeRustBioSync<string>('complement_sequence', {
    seq,
    isRna: false,
  }).toUpperCase();
}

/**
 * Reverse complement. RNA documents keep the RNA alphabet (A↔U) instead of
 * being silently rewritten with T.
 */
export function reverseComplement(seq: string, isRna = false): string {
  return invokeRustBioSync<string>('reverse_complement', {
    seq,
    isRna,
  });
}

/**
 * The `translate_sequence` reply: the protein and the engine's `warnings` (D0005), always present.
 * A `tableId` that names no NCBI genetic code is read as the Standard code (table 1), and the
 * warning names the id as sent.
 */
export interface TranslationResult {
  protein: string;
  warnings: string[];
}

/**
 * Translation with the Standard code (table 1). Table 1 names an NCBI code, so the reply's
 * `warnings` is always empty and the protein alone is returned.
 */
export function translateSequence(dna: string, frameOffset = 0): string {
  return invokeRustBioSync<TranslationResult>('translate_sequence', {
    dna,
    frameOffset,
    tableId: 1,
  }).protein;
}

export interface SequenceComposition {
  length: number;
  gcPercent: number;
  atPercent: number;
  mwSsDnaDa: number;
  mwDsDnaDa: number;
  extinctionCoeff260: number;
  meltingTempBasicC: number;
  counts: { A: number; T: number; G: number; C: number; N: number };
  damSites: number[];
  dcmSites: number[];
}

export function analyzeSequenceComposition(rawSeq: string): SequenceComposition {
  return invokeRustBioSync<SequenceComposition>('analyze_sequence_composition', {
    seq: rawSeq,
  });
}

/** The `find_orfs` reply: the ORFs and the engine's `warnings` (D0005), always present. */
export interface OrfSearchResult {
  orfs: ORFRecord[];
  warnings: string[];
}

/**
 * ORFs on both strands, with the engine's warnings. `tableId`: NCBI genetic code (1–33; alternative
 * starts follow the table); one that names no NCBI code is read as the Standard code (table 1) and
 * `warnings` names it. `circular`: ORFs may run across the origin (forward-strand `end` < `start`).
 */
export function findORFsWithWarnings(
  rawSeq: string,
  minLengthAa = 50,
  allowAlternativeStart = false,
  tableId = 1,
  circular = false
): OrfSearchResult {
  return invokeRustBioSync<OrfSearchResult>('find_orfs', {
    seq: rawSeq,
    minLengthAa,
    allowAlternativeStart,
    tableId,
    circular,
  });
}

/**
 * The ORFs of {@link findORFsWithWarnings} alone, for a `tableId` that names an NCBI code (the
 * default, table 1, does), where `warnings` is empty. A caller passing an id it did not choose
 * from the NCBI list should read `findORFsWithWarnings`, so a fallback to table 1 is not lost;
 * `runFindOrfs` (a saved workflow's `geneticCode`) still reads this one.
 */
export function findORFs(
  rawSeq: string,
  minLengthAa = 50,
  allowAlternativeStart = false,
  tableId = 1,
  circular = false
): ORFRecord[] {
  return findORFsWithWarnings(rawSeq, minLengthAa, allowAlternativeStart, tableId, circular).orfs;
}

export const findOpenReadingFrames = findORFs;

/**
 * A stored custom definition (US-01M7DVMJ) as the engine reads an enzyme: its `custom:` id and
 * source go with it, so every site and count the engine returns for it carries them (US-01M7DV1V).
 */
export function customEnzymeForScan(d: CustomEnzymeDefinition): RestrictionEnzyme {
  return {
    id: d.id,
    source: 'custom',
    name: d.name,
    recognitionSeq: d.recognitionSeq,
    cutFwd: d.cutFwd,
    cutRev: d.cutRev,
    isTypeIIS: d.isTypeIIS,
    suppliers: [],
    methylationSensitivity: [...d.methylationSensitivity],
    bufferNEB: '',
    tempC: 37,
    provenance: d.provenance,
    notes: d.notes,
  };
}

/**
 * The active enzyme list (US-01M7DV52): the built-in catalogue, then every stored definition. With
 * none stored it is `REBASE_ENZYMES` itself, so a scan handed it sends no list and the engine scans
 * its own catalogue exactly as before.
 */
export function activeEnzymeList(definitions: readonly CustomEnzymeDefinition[]): RestrictionEnzyme[] {
  return definitions.length === 0 ? REBASE_ENZYMES : [...REBASE_ENZYMES, ...definitions.map(customEnzymeForScan)];
}

/** Whether an enzyme is a custom definition: its source says so, or, with none given, a `custom:` id (as the engine reads it). */
export function isCustomEnzyme(enzyme: Pick<RestrictionEnzyme, 'id' | 'source'>): boolean {
  return enzyme.source === 'custom' || (enzyme.source === undefined && (enzyme.id ?? '').startsWith('custom:'));
}

/**
 * The name an enzyme is shown under (US-01M7DV52): a built-in's name as it is, and a custom
 * definition's followed by " (custom)", so one named like a built-in is never read as it.
 */
export function enzymeLabel(enzyme: Pick<RestrictionEnzyme, 'id' | 'source' | 'name'>): string {
  return isCustomEnzyme(enzyme) ? `${enzyme.name} (custom)` : enzyme.name;
}

export function findRestrictionCutSites(
  rawSeq: string,
  topology: 'circular' | 'linear',
  enzymes: RestrictionEnzyme[] = REBASE_ENZYMES
): RestrictionCutSite[] {
  const useDefault = enzymes === REBASE_ENZYMES;
  return invokeRustBioSync<RestrictionCutSite[]>('find_restriction_cut_sites', {
    seq: rawSeq,
    topology,
    customEnzymes: useDefault ? null : enzymes,
  });
}

/**
 * One scanned enzyme's complete number of sites over the scanned range, and how many of them Dam or
 * Dcm methylation blocks; the rest are its cuts (BG-01M6S1K2).
 */
export interface EnzymeSiteCount {
  /** The enzyme's display name. */
  enzyme: string;
  /** The enzyme's id (US-01M7DV1V): a built-in's is its name, a custom definition's its `custom:` id. */
  enzymeId: string;
  sites: number;
  methylationBlocked: number;
}

/**
 * A restriction scan, as the engine's `scan_restriction_sites` returns it (BG-01M6S1K2): every
 * scanned enzyme's complete site count, in catalogue order (an enzyme the scan did not read, such
 * as a non-core enzyme over 100,000 bp, is absent); the cut sites it kept, each enzyme's first
 * `positionsPerEnzymeCap` by position; the enzymes whose positions it left out; and one warning
 * sentence naming them (D0005). Single cutters, noncutters and per-enzyme counts are read from
 * `siteCounts`, never from the length of `sites`.
 */
export interface RestrictionSiteScan {
  sites: RestrictionCutSite[];
  siteCounts: EnzymeSiteCount[];
  cappedEnzymes: string[];
  positionsPerEnzymeCap: number | null;
  positionsTotalCap: number | null;
  stoppedEarly: boolean;
  warnings: string[];
}

/** The scan of a document that is not scanned (a protein, a view that shows no sites). */
export const EMPTY_RESTRICTION_SCAN: RestrictionSiteScan = Object.freeze({
  sites: [],
  siteCounts: [],
  cappedEnzymes: [],
  positionsPerEnzymeCap: null,
  positionsTotalCap: null,
  stoppedEarly: false,
  warnings: [],
}) as RestrictionSiteScan;

/** {@link findRestrictionCutSites} with every enzyme's complete site count, its stop report and warnings. */
export function scanRestrictionSites(
  rawSeq: string,
  topology: 'circular' | 'linear',
  enzymes: RestrictionEnzyme[] = REBASE_ENZYMES
): RestrictionSiteScan {
  const useDefault = enzymes === REBASE_ENZYMES;
  return invokeRustBioSync<RestrictionSiteScan>('scan_restriction_sites', {
    seq: rawSeq,
    topology,
    customEnzymes: useDefault ? null : enzymes,
  });
}

/**
 * Each scanned enzyme's complete site count by its id (US-01M7GQZ6), the key `enzymeKey` gives its
 * sites: a built-in's id is its name, so a built-in is counted under its name as before, and a custom
 * definition sharing a built-in's name under its own `custom:` id. An enzyme the scan did not read is
 * absent.
 */
export function restrictionSiteCountsByName(scan: Pick<RestrictionSiteScan, 'siteCounts'>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of scan.siteCounts) counts[c.enzymeId] = c.sites;
  return counts;
}

export function simulateRestrictionDigest(
  doc: SequenceDocument,
  selectedEnzymeNames: string[]
): DigestFragment[] {
  return invokeRustBioSync<DigestFragment[]>('simulate_restriction_digest', {
    doc,
    selectedEnzymeNames,
  });
}

/**
 * A digest by id (US-01M7DVD5, D0150): each built-in by its catalogue id, each custom enzyme by its
 * definition, so a custom one named like a built-in cuts at its own sites and its ends say so. The
 * reply lists every selected enzyme the engine could not use; `complete` is then false and, when
 * nothing cut, there are no fragments rather than the uncut molecule.
 */
export function simulateEnzymeDigest(doc: SequenceDocument, selection: EnzymeDigestSelection): EnzymeDigest {
  return invokeRustBioSync<EnzymeDigest>('simulate_enzyme_digest', { doc, selection });
}

/** How a digest by id names `enzymes`: a custom definition whole, a built-in by its id. */
export function enzymeDigestSelection(enzymes: readonly RestrictionEnzyme[]): EnzymeDigestSelection {
  return enzymes.map((e) => (isCustomEnzyme(e) ? e : e.id ?? e.name));
}

/** The name a fragment end is shown under: its enzyme's, marked " (custom)" when a custom definition cut it. */
export function digestEndLabel(fragment: DigestFragment, side: 'left' | 'right'): string {
  const name = side === 'left' ? fragment.leftEnzyme : fragment.rightEnzyme;
  const source = side === 'left' ? fragment.leftEnzymeSource : fragment.rightEnzymeSource;
  return source === 'custom' ? `${name} (custom)` : name;
}

/**
 * The one sentence a Tm readout shows in place of a Tm for a span or oligo holding `ambiguityBases`
 * bases that are not A, C, G or T (BG-01M6SHQ0): primer3-py 2.4.0 `calc_tm` refuses such a
 * sequence, whichever base it holds. The engine writes the same words
 * (`tm_no_answer_reason`, crates/molbiocraft-cloning/src/thermodynamics.rs) into the
 * `tmNoAnswerReason` of its primer metrics, Gibson junctions and primer records.
 */
export function tmNoAnswerSentence(ambiguityBases: number): string {
  return `Tm n/a: the span holds ${ambiguityBases.toLocaleString('en-US')} N or other ambiguity base${
    ambiguityBases === 1 ? '' : 's'
  }; Tm is computed on A/C/G/T only, as Primer3 does`;
}

export function calculatePrimerMetrics(
  rawPrimerSeq: string,
  naMm = 50,
  mgMm = 1.5,
  primerNm = 250
): {
  length: number;
  gcPercent: number;
  /** A number always; no answer where `tmNoAnswerReason` is set (an oligo holding N, BG-01M6SHQ0). */
  tmC: number;
  deltaG37: number;
  hairpinDeltaG: number;
  selfDimerDeltaG: number;
  gcClamp3Prime: boolean;
  /** Why `tmC` is no answer: the oligo holds N or another base that is not A, C, G or T. */
  tmNoAnswerReason?: string;
} {
  return invokeRustBioSync('calculate_primer_metrics', {
    seq: rawPrimerSeq,
    naMm,
    mgMm,
    primerNm,
  });
}

export function designPCRPrimers(
  doc: SequenceDocument,
  regionStart: number,
  regionEnd: number,
  targetTm = 60,
  fwdTail5Prime = '',
  revTail5Prime = '',
  /** Bases each primer may start outside the region to approach the target Tm (0 = at the ends). */
  positionSlackBp = 0
): {
  forward: PrimerRecord;
  reverse: PrimerRecord;
  ampliconSeq: string;
  ampliconLength: number;
  /** Region adjustments and design problems reported by the engine. */
  warnings?: string[];
} {
  return invokeRustBioSync('design_pcr_primers', {
    doc,
    regionStart,
    regionEnd,
    targetTm,
    fwdTail5Prime,
    revTail5Prime,
    positionSlackBp,
  });
}

export interface CloningOutcome {
  success: boolean;
  method: CloningMethodType;
  constructDocument: SequenceDocument;
  summary: string;
  leftJunctionSeq: string;
  rightJunctionSeq: string;
  overhangOrHomologyLeft: string;
  overhangOrHomologyRight: string;
  warnings: string[];
}

export function simulateMolecularCloning(
  vectorDoc: SequenceDocument,
  insertDoc: SequenceDocument,
  method: CloningMethodType,
  enzyme5Prime = 'EcoRI',
  enzyme3Prime = 'XhoI',
  goldenGateEnzyme = 'BsaI-HFv2'
): CloningOutcome {
  return invokeRustBioSync<CloningOutcome>('simulate_molecular_cloning', {
    vectorDoc,
    insertDoc,
    method,
    enzyme5Prime,
    enzyme3Prime,
    goldenGateEnzyme,
  });
}

export function alignPairwiseTypeScript(
  rawSeq1: string,
  rawSeq2: string,
  local = false,
  matchScore = 2,
  mismatchPenalty = -1,
  gapOpen = -3,
  gapExtend = -1,
  moleculeType?: 'DNA' | 'RNA' | 'Protein',
  proteinMatrix: 'blosum62' | 'pam250' = 'blosum62'
): PairwiseAlignmentResult {
  // Both ops take `mode`; `matrix` and `maxLen` only apply to the Gotoh (typed) path.
  return invokeRustBioSync<PairwiseAlignmentResult>(moleculeType ? 'align_pairwise_gotoh' : 'align_pairwise', {
    seq1: rawSeq1,
    seq2: rawSeq2,
    mode: local ? 'local' : 'global',
    matchScore,
    mismatchPenalty,
    gapOpen,
    gapExtend,
    ...(moleculeType
      ? { matrix: moleculeType === 'Protein' ? proteinMatrix : 'nucleotide' }
      : {}),
  });
}

/**
 * Longest member (residues) the interactive MSA engine aligns whole: the cap passed to `run_msa`,
 * equal to the Rust engine's own hard cap in `clean_msa_inputs`. The engine cuts a longer member
 * to its first 6,000 residues and says so in the result's `warnings` (D0005). The app's callers
 * reach it through `runValidatedAlignment` (alignmentExecution.ts), whose two guards keep a cut
 * alignment from reaching them: `alignmentInputError` refuses a longer input before the engine
 * runs, and the consistency check after the run rejects a reply whose rows do not hold every input
 * residue, which a cut alignment's rows do not. So they never align or show a prefix.
 * 20 × ~2.6 kb (HIV env) aligns in about a second with the default preset.
 */
export const MSA_MAX_RESIDUES = 6000;

export function runMultipleSequenceAlignment(
  docs: { id: string; name: string; sequence: string }[],
  algorithm = ''
): MSAAlignmentResult {
  return invokeRustBioSync<MSAAlignmentResult>('run_msa', {
    docs,
    maxSeqLen: MSA_MAX_RESIDUES,
    algorithm,
  });
}

export function computeDotplotHits(
  rawSeq1: string,
  rawSeq2: string,
  windowSize = 11,
  minMatches = 9
): DotplotHit[] {
  return invokeRustBioSync<DotplotHit[]>('compute_dotplot_hits', {
    seq1: rawSeq1,
    seq2: rawSeq2,
    windowSize,
    minMatches,
  });
}

export function buildNeighborJoiningNewick(
  names: string[],
  alignedSeqs: string[]
): string {
  return invokeRustBioSync<string>('build_nj_newick', {
    names,
    alignedSeqs,
  });
}

export function mapReadAndCallVariants(
  refDoc: SequenceDocument,
  readDoc: SequenceDocument
): {
  alignment: PairwiseAlignmentResult;
  refStartPos: number;
  variants: VariantCall[];
} {
  return invokeRustBioSync('map_read_and_call_variants', {
    refSeq: refDoc.sequence,
    readSeq: readDoc.chromatogram?.baseCalls || readDoc.sequence,
    readName: readDoc.name,
    phredScores: readDoc.chromatogram?.phredScores ?? null,
  });
}

export function buildUPGMANewick(names: string[], alignedSeqs: string[]): string {
  return invokeRustBioSync<string>('build_upgma_newick', {
    names,
    alignedSeqs,
  });
}

/**
 * Candidate guides over the whole record. `circular` reads it as the circle a plasmid is
 * (BG-01M6T6GQ), so the guides whose site straddles the origin are found too, reported inside
 * 1..length — a site across the origin reads `start > end` — and counted in `candidateCount`; the
 * reply says which way it was read in `scannedCircular`. A record read straight loses the last
 * `span - 1` start positions of each strand — 22 for SpCas9's 23-base site, 23 for Cas12a's 24-base
 * one — so pass the document's own topology.
 */
/**
 * A nuclease the engine can scan for (US-01M7DV29 AC1): what its site looks like and where it cuts.
 * The list comes from the engine, so no surface offers a nuclease the engine does not scan for.
 */
export interface CrisprNucleasePreset {
  /** The id sent in the `nuclease` payload key, and the label a guide carries. */
  id: string;
  /** The side of the spacer the PAM sits on, as a reader says it: `5'` or `3'`. */
  pamSide: string;
  /** The PAM pattern in IUPAC letters, 5' -> 3'. */
  pamPattern: string;
  spacerLengthBp: number;
  /** The bases the whole site occupies, PAM and spacer together. */
  siteSpanBp: number;
  /** Where this nuclease cuts, in words, naming the convention a position follows (D0131). */
  cutConvention: string;
}

/** Every nuclease a scan can be asked for, in the order a chooser offers them. */
export function crisprNucleasePresets(): CrisprNucleasePreset[] {
  return invokeRustBioSync<CrisprNucleasePreset[]>('crispr_nuclease_presets', {});
}

/**
 * A guide as the scan returns it: the record with the preset facts that say which nuclease found it
 * (US-01M7DV29 AC6) and how it cuts (D0131). `src/types/bio.ts` names the fields every guide has
 * had; these are the scan's own.
 */
export interface CrisprScanGuide extends CrisprGuideRecord {
  /** `5'` or `3'`: the side of the spacer this nuclease's PAM sits on. */
  pamSide: string;
  pamPattern: string;
  /** Where the cut falls, in words, naming the convention `cutPosition` follows. */
  cutConvention: string;
  /** The staggered second cut as a plus-strand coordinate (Cas12a); absent for a blunt cutter. */
  cutPositionTargetStrand?: number;
  /** Why a staggered cut has no second position: it falls past the end of the range read straight. */
  cutPositionTargetStrandNote?: string;
  /** Which bases of `pamSeq` are an ambiguity letter rather than a base the scan read; absent where none are. */
  pamAmbiguityNote?: string;
  /** The interval this guide was searched for in; absent where the scan read the whole sequence. */
  searchedInterval?: CrisprSearchedInterval;
  /**
   * What this guide read outside the interval searched (US-01M7DVAS AC2): its spacer is inside the
   * interval, so only its PAM can be outside, and the sentence names that PAM's own bases. Absent
   * for a whole-sequence scan and for a site wholly inside the interval.
   */
  intervalContextNote?: string;
}

/**
 * The 1-based inclusive interval a scan searched (US-01M7DVAS). On a circular record `start > end`
 * runs across the origin - the convention the active-interval model uses (`crossesOrigin`) - and
 * `lengthBp` counts both sides of it, so a reader never takes `end - start` for the length
 * (BG-01M7CG2W). It is the interval really searched, which is not always the one asked for: one
 * longer than the engine's scan bound is searched from its start for that many bases.
 */
export interface CrisprSearchedInterval {
  start: number;
  end: number;
  lengthBp: number;
  crossesOrigin: boolean;
}

/** The scan's own report (US-01M7DVH2): what a CRISPR guide scan searched and what it found. */
export interface CrisprScanReport {
  /** Every candidate guide over the range read, kept or not. */
  candidateCount: number;
  /** The bases read, from base 1, on both strands. */
  scannedLengthBp: number;
  /** The length of the whole sequence; equal to `scannedLengthBp` when the scan read it all. */
  sequenceLengthBp: number;
  /** Whether both strands were read across the origin, as a circle (BG-01M6T6GQ). */
  scannedCircular: boolean;
  /** The bases across the origin a circular scan read, or 0 when it did not wrap. */
  originSpanBp: number;
  /**
   * The interval searched (US-01M7DVAS), or absent where the scan read the whole sequence or a
   * prefix bound of it. Present is what says `scannedLengthBp` counts an interval, so a reader
   * never prints an interval scan as a scan of bases 1 to N - or of the whole sequence.
   */
  searchedInterval?: CrisprSearchedInterval;
  /**
   * Why no interval was searched although one was asked for: bounds outside the sequence, an
   * interval shorter than the nuclease's site span, or an across-origin interval on a linear
   * record. Such a scan searched nothing and claims no range.
   */
  intervalRefusal?: string;
  /** The bases outside the interval the scan read as PAM context, and for nothing else. */
  contextOutsideIntervalBp: number;
  /** One plain sentence per range or list the scan could not report whole (D0005). */
  warnings: string[];
  /**
   * The length of the PAM-proximal seed whose exact copies the scan counted (BG-01M7FF3B): the
   * engine's own `SEED_LEN`, as the scan reports it. Absent when the engine reported none - a
   * refused scan, which counted no seed, or an engine older than the field - and then no surface
   * states a length: none is ever filled in on the engine's behalf.
   */
  seedLengthBp?: number;
}

/**
 * A scan's reply: the rows it kept and its report. `report` is absent only when the engine sent no
 * report - an older engine, or a call that failed - and `reportUnavailableReason` then says which,
 * so a reader shows that instead of a count the scan never gave (US-01M7DVH2 AC5). An absent report
 * is never an empty one: 0 candidates is a scan that ran and found none.
 */
export interface CrisprScanResult {
  guides: CrisprScanGuide[];
  report?: CrisprScanReport;
  reportUnavailableReason?: string;
}

/** Whether `value` holds every field of a scan report, with the type each one must have. */
function isCrisprScanReport(value: unknown): value is CrisprScanReport & { guides?: unknown } {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.candidateCount === 'number' &&
    typeof v.scannedLengthBp === 'number' &&
    typeof v.sequenceLengthBp === 'number' &&
    typeof v.scannedCircular === 'boolean' &&
    typeof v.originSpanBp === 'number' &&
    // US-01M7DVAS: an engine that cannot say how many bases outside the interval it read cannot be
    // asked for an interval at all, so its reply is no report rather than one read as zeroes.
    typeof v.contextOutsideIntervalBp === 'number' &&
    Array.isArray(v.warnings)
  );
}

/** Whether `value` is the engine's interval shape, with the type each field must have. */
function isSearchedInterval(value: unknown): value is CrisprSearchedInterval {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.start === 'number' &&
    typeof v.end === 'number' &&
    typeof v.lengthBp === 'number' &&
    typeof v.crossesOrigin === 'boolean'
  );
}

/**
 * The CRISPR guide scan itself (US-01M7DVH2): the engine's `scan_crispr_guides` op, which replies
 * with the whole scan envelope, so the candidate count, the range read, how the record was read and
 * the warnings are there even when the scan found no guide - they are not read off a guide row.
 * Pass the document's own topology, as {@link findCrisprGuides} documents.
 *
 * A reply without the report, and a call that threw, both come back with `report` absent and
 * `reportUnavailableReason` set; neither is turned into zeroes.
 *
 * `interval` searches one arc of the record instead of all of it (US-01M7DVAS): 1-based and
 * inclusive, `start > end` running across the origin of a circular record. The engine refuses an
 * interval it cannot search - bounds outside the sequence, shorter than the nuclease's site span, or
 * across the origin of a linear record - and the report then carries `intervalRefusal` with the
 * reason and no range; it is never widened to the whole sequence on the caller's behalf.
 */
export function scanCrisprGuides(
  rawSeq: string,
  /** A preset id from {@link crisprNucleasePresets}; the engine refuses any other (D0130). */
  nuclease = 'SpCas9 (NGG)',
  maxResults = 30,
  circular = false,
  interval?: { start: number; end: number } | null
): CrisprScanResult {
  let reply: unknown;
  try {
    reply = invokeRustBioSync<unknown>('scan_crispr_guides', {
      seq: rawSeq,
      nuclease,
      maxResults,
      circular,
      // Both bounds or neither: the engine refuses one alone rather than reading it as the whole
      // sequence.
      ...(interval ? { start1Based: interval.start, end1Based: interval.end } : {}),
    });
  } catch (e) {
    return {
      guides: [],
      reportUnavailableReason: `the scan could not be run: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const guides = Array.isArray((reply as { guides?: unknown } | null)?.guides)
    ? ((reply as { guides: CrisprScanGuide[] }).guides ?? [])
    : [];
  if (!isCrisprScanReport(reply)) {
    return { guides, reportUnavailableReason: 'the engine returned no scan report' };
  }
  const searched = (reply as { searchedInterval?: unknown }).searchedInterval;
  const refusal = (reply as { intervalRefusal?: unknown }).intervalRefusal;
  const seedLength = (reply as { seedLengthBp?: unknown }).seedLengthBp;
  // An interval this reader cannot read is no report at all: dropping it would leave
  // `scannedLengthBp` counting an interval under a report that claims none, which reads as a scan of
  // the whole sequence - the one thing an interval scan must never be shown as (US-01M7DVAS AC4).
  if (searched !== undefined && !isSearchedInterval(searched)) {
    return {
      guides,
      reportUnavailableReason:
        'the engine reported an interval in a shape this reader does not know, so what it searched cannot be stated',
    };
  }
  return {
    guides,
    report: {
      candidateCount: reply.candidateCount,
      scannedLengthBp: reply.scannedLengthBp,
      sequenceLengthBp: reply.sequenceLengthBp,
      scannedCircular: reply.scannedCircular,
      originSpanBp: reply.originSpanBp,
      contextOutsideIntervalBp: reply.contextOutsideIntervalBp,
      ...(isSearchedInterval(searched) ? { searchedInterval: searched } : {}),
      ...(typeof refusal === 'string' ? { intervalRefusal: refusal } : {}),
      // Only a whole number of bases is a seed length; anything else is left absent, never guessed.
      ...(Number.isInteger(seedLength) && (seedLength as number) > 0
        ? { seedLengthBp: seedLength as number }
        : {}),
      warnings: reply.warnings,
    },
  };
}

export function findCrisprGuides(
  rawSeq: string,
  nuclease: 'SpCas9 (NGG)' | 'Cas12a / Cpf1 (TTTV)' = 'SpCas9 (NGG)',
  maxResults = 30,
  circular = false
): CrisprGuideRecord[] {
  return invokeRustBioSync<CrisprGuideRecord[]>('find_crispr_guides', {
    seq: rawSeq,
    nuclease,
    maxResults,
    circular,
  });
}

export function testSavedPrimersOnSequence(
  rawSeq: string,
  savedPrimers: PrimerRecord[],
  maxMismatches = 2
): SavedPrimerBindingHit[] {
  return invokeRustBioSync<SavedPrimerBindingHit[]>('test_saved_primers', {
    seq: rawSeq,
    savedPrimers,
    maxMismatches,
  });
}

export function analyzeProteinSequence(
  rawInput: string,
  isDna = true,
  windowSize = 9
): ProteinAnalysisReport {
  return invokeRustBioSync<ProteinAnalysisReport>('analyze_protein_sequence', {
    seq: rawInput,
    isDna,
    windowSize,
  });
}

/**
 * The enzymes of `enzymes` with no site on the whole molecule. The engine applies no core cut here,
 * at any length, so a caller hands the FULL catalogue plus its definitions (US-01M7DV52); with
 * `REBASE_ENZYMES` itself no list is sent. An enzyme whose motif the scan cannot read is not listed.
 */
export function findNonCuttingEnzymes(
  rawSeq: string,
  topology: 'circular' | 'linear' = 'circular',
  enzymes: RestrictionEnzyme[] = REBASE_ENZYMES
): RestrictionEnzyme[] {
  return invokeRustBioSync<RestrictionEnzyme[]>('find_non_cutting_enzymes', {
    seq: rawSeq,
    topology,
    customEnzymes: enzymes === REBASE_ENZYMES ? null : enzymes,
  });
}

/**
 * A silent-mutation scan of a construct: the candidates listed, how many there are in all, and
 * the engine's sentence for a list that shows only the first of them (D0005).
 */
export interface SilentMutationScan {
  candidates: SilentMutationCandidate[];
  /** Every candidate over the whole length of every scanned CDS, however many are listed. */
  totalCandidates: number;
  warnings: string[];
}

/**
 * Silent restriction-site mutations inside the annotated CDS features of a
 * construct, read in each gene's own frame and strand, over each gene's whole
 * length. Positions are construct coordinates. Single-segment CDS features only
 * (joined CDS are skipped), so a spliced gene contributes no candidates.
 *
 * `totalCandidates` counts every candidate in those genes, so a list showing
 * `maxCandidates` of them can say which of how many it shows (BG-01M6S1Q9).
 */
export function analyzeSilentMutationsInCds(
  doc: Pick<SequenceDocument, 'sequence' | 'features'>,
  maxCandidates = 18
): SilentMutationScan {
  const regions = doc.features
    .filter((f) => f.type === 'CDS' && !(f.segments && f.segments.length > 1))
    .map((f) => ({ name: f.name, start: f.start, end: f.end, strand: f.strand < 0 ? -1 : 1 }));
  if (regions.length === 0) return { candidates: [], totalCandidates: 0, warnings: [] };
  return invokeRustBioSync<SilentMutationScan>('analyze_silent_mutations_in_cds', {
    seq: doc.sequence,
    regions,
    maxCandidates,
  });
}

export function analyzeSilentMutations(
  rawSeq: string,
  maxCandidates = 18
): SilentMutationCandidate[] {
  return invokeRustBioSync<SilentMutationCandidate[]>('analyze_silent_mutations', {
    seq: rawSeq,
    maxCandidates,
  });
}

export function runLocalBlastSearch(
  querySeqRaw: string,
  allDocs: SequenceDocument[],
  program: 'blastn' | 'blastp' | 'blastx' | 'tblastn' = 'blastn',
  databaseName = 'nr / nt (Curated Local + NCBI Reference Index)'
): BlastHitRecord[] {
  const docs = allDocs.map((d) => ({
    id: d.id,
    name: d.name,
    accession: d.accession,
    description: d.description,
    organism: String(d.docMetadata?.Organism ?? ''),
    sequence: d.sequence,
  }));
  return invokeRustBioSync<BlastHitRecord[]>('run_local_blast', {
    querySeq: querySeqRaw,
    docs,
    program,
    databaseName,
  });
}

export function convertDnaRna(rawSeq: string, toRna: boolean): string {
  return invokeRustBioSync<string>('convert_dna_rna', {
    seq: rawSeq,
    toRna,
  });
}

export const COMMON_PLASMID_FEATURES: CommonFeatureTemplate[] =
  invokeRustBioSync<CommonFeatureTemplate[]>('get_common_plasmid_features');

export function detectCommonFeatures(doc: SequenceDocument): SequenceFeature[] {
  return invokeRustBioSync<SequenceFeature[]>('detect_common_features', { doc });
}

export function simulateSiteDirectedMutagenesis(
  doc: SequenceDocument,
  mode: 'Substitution' | 'Insertion' | 'Deletion',
  positionBp: number,
  replacementBases: string,
  deletionLengthBp = 3
): MutagenesisSimulationResult {
  return invokeRustBioSync<MutagenesisSimulationResult>('simulate_mutagenesis', {
    doc,
    mode,
    positionBp,
    replacementBases,
    deletionLengthBp,
  });
}

export function annealComplementaryOligos(
  duplexName: string,
  topOligo5to3: string,
  bottomOligo5to3: string,
  phosphorylated5Prime = true
): AnnealedOligoResult {
  return invokeRustBioSync<AnnealedOligoResult>('anneal_oligos', {
    duplexName,
    topOligo5to3,
    bottomOligo5to3,
    phosphorylated5Prime,
  });
}

export function setCircularOrigin(
  doc: SequenceDocument,
  newOrigin1Based: number
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('set_circular_origin', {
    doc,
    newOrigin1Based,
  });
}

export function predictSecondaryStructure(
  rawSeq: string,
  moleculeType: 'DNA' | 'RNA' = 'RNA',
  options: { temperatureC?: number; danglingEnds?: boolean; circular?: boolean } = {}
): SecondaryStructureReport {
  return invokeRustBioSync<SecondaryStructureReport>('predict_secondary_structure', {
    seq: rawSeq,
    moleculeType,
    temperatureC: options.temperatureC ?? 37,
    danglingEnds: options.danglingEnds ?? true,
    circular: options.circular ?? false,
  });
}

export function computeDnaAndLigationCalculations(
  lengthBp: number,
  concNgPerUl = 50,
  volumeUl = 20,
  vectorMassNg = 50,
  insertLengthBp = 720
): DnaLigationCalculations {
  return invokeRustBioSync<DnaLigationCalculations>('compute_dna_ligation_calcs', {
    lengthBp,
    concNgPerUl,
    volumeUl,
    vectorMassNg,
    insertLengthBp,
  });
}

/**
 * The record's alerts read from `cutSites`. `scanStoppedEarly` is the scan's own report that it kept
 * fewer sites than it found (`RestrictionSiteScan.stoppedEarly`, BG-01M6S1K2): the methylation
 * alert then says "At least N" and no all-clear line is given.
 */
export function auditSequenceAlerts(
  doc: SequenceDocument,
  cutSites: RestrictionCutSite[],
  strain = 'DH5α (dam+ dcm+)',
  scanStoppedEarly = false
): SequenceAlertItem[] {
  return invokeRustBioSync<SequenceAlertItem[]>('audit_sequence_alerts', {
    doc,
    cutSites,
    strain,
    scanStoppedEarly,
  });
}

/**
 * Mirrors 1-based inclusive feature and primer coordinates across a sequence of length `seqLen`
 * when reversing or reverse-complementing a construct so annotations stay aligned to their codons.
 */
export function invertSequenceCoordinates(
  doc: Pick<SequenceDocument, 'features' | 'primers'>,
  seqLen: number,
  flipStrand: boolean
): { features: SequenceFeature[]; primers: PrimerRecord[] } {
  if (seqLen <= 0) {
    return { features: doc.features, primers: doc.primers };
  }
  const mapCoord = (pos: number) =>
    Math.max(1, Math.min(seqLen, seqLen - pos + 1));

  const features: SequenceFeature[] = (doc.features ?? []).map((f) => ({
    ...f,
    start: mapCoord(f.end),
    end: mapCoord(f.start),
    strand: flipStrand ? (f.strand === 1 ? -1 : 1) : f.strand,
    segments: f.segments
      ? [...f.segments]
          .reverse()
          .map((seg, idx) => ({
            ...seg,
            index: idx + 1,
            start: mapCoord(seg.end),
            end: mapCoord(seg.start),
          }))
      : undefined,
  }));

  const primers: PrimerRecord[] = (doc.primers ?? []).map((p) => ({
    ...p,
    bindStart: mapCoord(p.bindEnd),
    bindEnd: mapCoord(p.bindStart),
    strand: flipStrand ? (p.strand === 1 ? -1 : 1) : p.strand,
  }));

  return { features, primers };
}


// ───────────── Where stored primers bind (US-01M7DQMY) ─────────────
//
// The search is the engine's Test with Saved Primers (`test_saved_primers`, PRD F08): it binds on a
// primer's annealing portion, needs the 3'-terminal bases to match exactly, counts mismatches in the
// rest, and compares bases byte for byte, so an IUPAC ambiguity code never matches. The functions
// below choose what the engine is given and say what it cannot answer; every hit comes from it.

/** The 3'-terminal bases the engine requires to match exactly. */
export const PRIMER_BINDING_CLAMP_BASES = 5;
/** The match rule of `test_saved_primers`, in words. */
export const PRIMER_BINDING_METHOD =
  "Test with Saved Primers engine: the annealing portion is compared base by base on both strands; the 3'-terminal 5 bases must match exactly and mismatches are counted in the rest";
/** The conditions `test_saved_primers` computes its effective Tm under. */
export const PRIMER_BINDING_TM_CONDITIONS =
  'DNA nearest-neighbour Tm at 50 mM Na+, 1.5 mM Mg2+ and 250 nM oligo, less 2.4 °C per mismatch';

/** The match rule and settings of one binding site. */
export function primerMatchConditions(maxMismatches: number, mismatches: number, tmAvailable: boolean): PrimerMatchConditions {
  return {
    method: PRIMER_BINDING_METHOD,
    maxMismatches,
    clamp3PrimeBases: PRIMER_BINDING_CLAMP_BASES,
    mismatches,
    ...(tmAvailable ? { tmConditions: PRIMER_BINDING_TM_CONDITIONS } : {}),
  };
}

/** The settings line a surface shows with its binding sites. */
export function primerMatchSettingsText(maxMismatches: number): string {
  return `Match: up to ${maxMismatches} mismatch${maxMismatches === 1 ? '' : 'es'} outside an exact 3' clamp of ${PRIMER_BINDING_CLAMP_BASES} bases. ${PRIMER_BINDING_METHOD}. Effective Tm: ${PRIMER_BINDING_TM_CONDITIONS}.`;
}

export type PrimerCandidateSource = 'database' | 'document';

/** A primer a search screens, from the Primer Database or a document, keyed by its source and id. */
export interface PrimerCandidate {
  /** `database:<record id>` or `document:<primer id>`: two candidates of one name never share it. */
  key: string;
  source: PrimerCandidateSource;
  sourceLabel: 'Primer Database' | 'Document';
  name: string;
  /** What the engine screens: the document primer as it is, or the record as a primer. */
  record: PrimerRecord;
  /** The database record, for a database candidate. */
  database?: DatabasePrimer;
  /** Why the engine computes no Tm or ΔG for it (an RNA record or one with a modification), or null. */
  thermoUnavailableReason: string | null;
  /** Why it is not searched at all (a degenerate or too-short annealing portion), or null. */
  notSearchedReason: string | null;
}

const ACGTU = /^[ACGTU]*$/;

/** Why the engine has no Tm or ΔG for a database record, or null where it computes them. */
export function thermoUnavailableReasonFor(rec: Pick<DatabasePrimer, 'molecule' | 'modifications'>): string | null {
  const reasons: string[] = [];
  if (rec.molecule === 'RNA') {
    reasons.push('it is RNA, and the engine computes DNA nearest-neighbour values only');
  }
  if (rec.modifications.trim() !== '') {
    reasons.push(`it carries the modification "${rec.modifications.trim()}", which the engine has no parameters for`);
  }
  return reasons.length ? `Tm and ΔG unavailable: ${reasons.join('; ')}.` : null;
}

/** Why the engine cannot search a database record's annealing portion, or null where it can. */
export function notSearchedReasonFor(anneal: string): string | null {
  const codes = [...new Set(anneal.replace(/[ACGTU]/g, ''))];
  if (!ACGTU.test(anneal)) {
    return `Not searched: the annealing portion holds the IUPAC ambiguity code${codes.length === 1 ? '' : 's'} ${codes.join(', ')}, and the engine matches A, C, G and T exactly, so it cannot say where this primer binds.`;
  }
  if (anneal.length < 12) {
    return `Not searched: the annealing portion is ${anneal.length} bases, and the engine searches primers of 12 bases or more.`;
  }
  return null;
}

/** A Primer Database record as a candidate: the engine binds it on its annealing portion. */
export function databasePrimerCandidate(rec: DatabasePrimer): PrimerCandidate {
  const anneal = rec.sequence.slice(rec.tail5Prime.length);
  return {
    key: `database:${rec.id}`,
    source: 'database',
    sourceLabel: 'Primer Database',
    name: rec.name,
    record: {
      id: rec.id,
      name: rec.name,
      sequence: rec.sequence,
      annealSequence: anneal,
      tail5Prime: rec.tail5Prime,
      bindStart: 0,
      bindEnd: 0,
      strand: 1,
      length: rec.sequence.length,
      gcPercent: 0,
      tmAnnealC: 0,
      tmFullC: 0,
      deltaG37: 0,
      hairpinDeltaG: 0,
      selfDimerDeltaG: 0,
      gcClamp3Prime: false,
    },
    database: rec,
    thermoUnavailableReason: thermoUnavailableReasonFor(rec),
    notSearchedReason: notSearchedReasonFor(anneal),
  };
}

/**
 * A document's primer as a candidate, screened exactly as before. A primer added from an RNA or
 * modified record keeps why it has no Tm or ΔG (its source's reason, else its own no-answer reason):
 * the engine reads its oligo as DNA and would otherwise answer with an invented value.
 */
export function documentPrimerCandidate(p: PrimerRecord): PrimerCandidate {
  return {
    key: `document:${p.id}`,
    source: 'document',
    sourceLabel: 'Document',
    name: p.name,
    record: p,
    thermoUnavailableReason: p.source?.thermoUnavailableReason ?? p.tmNoAnswerReason ?? null,
    notSearchedReason: null,
  };
}

/** One place a candidate binds on one target. */
export interface PrimerBindingOccurrence {
  /** The candidate's key, the target's id and the site: unique within one search. */
  key: string;
  candidate: PrimerCandidate;
  targetId: string;
  targetName: string;
  bindStart: number;
  bindEnd: number;
  strand: 1 | -1;
  mismatches: number;
  /** The engine's effective Tm, or null where it is unavailable (`tmUnavailableReason`). */
  effectiveTmC: number | null;
  tmUnavailableReason: string | null;
  conditions: PrimerMatchConditions;
}

export interface PrimerBindingSearch {
  occurrences: PrimerBindingOccurrence[];
  /** The candidates the engine was not given, each with its reason. */
  notSearched: Array<{ candidate: PrimerCandidate; reason: string }>;
}

/**
 * Screen `candidates` on each target through the engine's `test_saved_primers`. A candidate with a
 * `notSearchedReason` is listed with it and never reported as binding nowhere. Each engine hit is
 * mapped back to its candidate by position, so two candidates of one name stay apart.
 */
export function findPrimerBindings(
  targets: SequenceDocument[],
  candidates: PrimerCandidate[],
  maxMismatches: number
): PrimerBindingSearch {
  const searched = candidates.filter((c) => c.notSearchedReason === null);
  const notSearched = candidates
    .filter((c) => c.notSearchedReason !== null)
    .map((candidate) => ({ candidate, reason: candidate.notSearchedReason as string }));
  const occurrences: PrimerBindingOccurrence[] = [];
  if (!searched.length) return { occurrences, notSearched };
  const engineRecords = searched.map((c, i) => ({ ...c.record, id: `cand-${i}` }));
  for (const target of targets) {
    const hits = testSavedPrimersOnSequence(target.sequence, engineRecords, maxMismatches);
    for (const h of hits) {
      const candidate = searched[Number(h.primer.id.slice('cand-'.length))];
      const unavailable = candidate.thermoUnavailableReason ?? h.primer.tmNoAnswerReason ?? null;
      occurrences.push({
        key: `${candidate.key}@${target.id}:${h.bindStart}..${h.bindEnd}${h.strand === 1 ? '+' : '-'}`,
        candidate,
        targetId: target.id,
        targetName: target.name,
        bindStart: h.bindStart,
        bindEnd: h.bindEnd,
        strand: h.strand,
        mismatches: h.mismatches,
        effectiveTmC: unavailable ? null : h.effectiveTmC,
        tmUnavailableReason: unavailable,
        conditions: primerMatchConditions(maxMismatches, h.mismatches, !unavailable),
      });
    }
  }
  return { occurrences, notSearched };
}

/**
 * The document primer a database binding site becomes: the record's oligo placed where it binds,
 * with the record's id and a copy of the record, the target's sequence revision and how it was
 * matched (US-01M7DQMY AC4). Tm and ΔG come from the engine. For an RNA or modified record the
 * engine is not asked: the numbers are 0 placeholders, and `tmNoAnswerReason` and
 * `source.thermoUnavailableReason` say why there is no value.
 */
export function primerFromDatabaseOccurrence(occ: PrimerBindingOccurrence, target: SequenceDocument, id: string): PrimerRecord {
  const rec = occ.candidate.database;
  if (!rec) throw new Error(`${occ.candidate.name} is not a Primer Database record.`);
  const anneal = occ.candidate.record.annealSequence;
  const unavailable = occ.candidate.thermoUnavailableReason;
  const annealM = unavailable ? null : calculatePrimerMetrics(anneal, 50, 1.5, 250);
  const fullM = unavailable ? null : calculatePrimerMetrics(rec.sequence, 50, 1.5, 250);
  const gc = rec.sequence.length ? (100 * (rec.sequence.match(/[GCS]/g)?.length ?? 0)) / rec.sequence.length : 0;
  const tmReason = unavailable ?? annealM?.tmNoAnswerReason;
  return {
    id,
    name: rec.name,
    sequence: rec.sequence,
    annealSequence: anneal,
    tail5Prime: rec.tail5Prime,
    bindStart: occ.bindStart,
    bindEnd: occ.bindEnd,
    strand: occ.strand,
    length: rec.sequence.length,
    gcPercent: fullM?.gcPercent ?? Math.round(gc * 10) / 10,
    tmAnnealC: annealM?.tmC ?? 0,
    tmFullC: fullM?.tmC ?? 0,
    deltaG37: fullM?.deltaG37 ?? 0,
    hairpinDeltaG: fullM?.hairpinDeltaG ?? 0,
    selfDimerDeltaG: fullM?.selfDimerDeltaG ?? 0,
    gcClamp3Prime: annealM?.gcClamp3Prime ?? /[GC]$/.test(anneal),
    notes: `Added from the Primer Database: ${occ.mismatches} mismatch${occ.mismatches === 1 ? '' : 'es'}, effective Tm ${
      occ.effectiveTmC === null ? `unavailable (${occ.tmUnavailableReason})` : `${occ.effectiveTmC.toFixed(1)} °C`
    }`,
    ...(tmReason ? { tmNoAnswerReason: tmReason } : {}),
    source: {
      kind: 'primerDatabase',
      recordId: rec.id,
      name: rec.name,
      sequence: rec.sequence,
      tail5Prime: rec.tail5Prime,
      molecule: rec.molecule,
      modifications: rec.modifications,
      sequenceRevision: sequenceRevision(target.sequence, target.topology === 'circular' ? 'circular' : 'linear'),
      match: { ...occ.conditions },
      ...(unavailable ? { thermoUnavailableReason: unavailable } : {}),
    },
  };
}

/**
 * Add the chosen database binding sites to their targets as primers. Only `primers`, the history
 * and `updatedAt` change: each target's bases, features and every other field are kept as they are.
 */
export function addPrimerBindings(
  targets: SequenceDocument[],
  chosen: PrimerBindingOccurrence[],
  stamp: string,
  newId: (n: number) => string
): SequenceDocument[] {
  const updated: SequenceDocument[] = [];
  let n = 0;
  for (const target of targets) {
    const mine = chosen.filter((o) => o.targetId === target.id && o.candidate.database);
    if (!mine.length) continue;
    const added = mine.map((o) => primerFromDatabaseOccurrence(o, target, newId(n++)));
    updated.push({
      ...target,
      primers: [...target.primers, ...added],
      updatedAt: stamp,
      history: [
        ...target.history,
        {
          id: newId(n++),
          timestamp: stamp,
          operation: 'Add Primer Binding Sites',
          description: `${added.length} primer binding site${added.length === 1 ? '' : 's'} from the Primer Database (${added
            .map((p) => p.name)
            .join(', ')})`,
          parentIds: [target.id],
          lengthBp: target.sequence.length,
          topology: target.topology,
        },
      ],
    });
  }
  return updated;
}
