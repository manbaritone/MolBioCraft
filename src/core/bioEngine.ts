// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Core Molecular Biology, Sequence Analysis, Alignment, Thermodynamics, Cloning & CRISPR Bridge
 * backed by the compiled Rust `molbiocraft-{core,align,phylo,cloning,protein}` workspace crates
 * (`rust-bio`, `noodles`, `aho-corasick`, `memchr`, `rustc-hash`).
 */

import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type {
  AnnealedOligoResult,
  BlastHitRecord,
  CloningMethodType,
  CommonFeatureTemplate,
  CrisprGuideRecord,
  DigestFragment,
  DnaLigationCalculations,
  DotplotHit,
  MSAAlignmentResult,
  MutagenesisSimulationResult,
  ORFRecord,
  PairwiseAlignmentResult,
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
  enzyme: string;
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

/** Each scanned enzyme's complete site count by name; an enzyme the scan did not read is absent. */
export function restrictionSiteCountsByName(scan: Pick<RestrictionSiteScan, 'siteCounts'>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of scan.siteCounts) counts[c.enzyme] = c.sites;
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

export function findNonCuttingEnzymes(
  rawSeq: string,
  topology: 'circular' | 'linear' = 'circular'
): RestrictionEnzyme[] {
  return invokeRustBioSync<RestrictionEnzyme[]>('find_non_cutting_enzymes', {
    seq: rawSeq,
    topology,
    customEnzymes: null,
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

