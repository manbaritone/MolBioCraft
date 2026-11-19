// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';
import { reverseComplement, translateSequence } from './bioEngine';

export type GenomicsSubTabId =
  | 'ngs-assembly' | 'genome-variants' | 'genes-cpg-repeats'
  | 'transform-submit';
/** History's one view, the lineage: its other panels have their own hosts (US-01M7QC8Q). */
export type HybridSubTabId = 'lineage';

/** The NGS and genome views of genomics-ngs (Pipelines & NGS): none for a protein, which has the Protein studio (US-01M6Q164). */
export function genomicsTabsForDocument(doc: SequenceDocument): GenomicsSubTabId[] {
  if (doc.moleculeType === 'Protein') return [];
  return ['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'transform-submit'];
}

/** History is provenance only, for every kind of document: the lineage alone (US-01M7QC8Q). */
export function hybridTabsForDocument(_doc: SequenceDocument): HybridSubTabId[] {
  return ['lineage'];
}

export function defaultHybridSubTab(_doc: SequenceDocument): HybridSubTabId {
  return 'lineage';
}

// ─── The protein a document is analysed as (the Protein studio, and History's CDS fold region) ───

/**
 * The most residues of a protein document the protein tab analyses: more than titin (UniProt
 * Q8WZ42, 34,350 aa), the longest known protein, so a real protein is analysed whole. The PTM
 * scan's time grows about with the square of the length (in the WASM engine under Node, 41 ms at
 * 34,350 aa and 0.39 s at 100,000 aa), and the scan stopped with an engine error at 200,000 aa
 * (BG-01M6S13D).
 */
export const PROTEIN_ANALYSIS_CAP_AA = 40_000;
/**
 * With no CDS feature, the protein tab passes the engine this many bases from the start, of which
 * it analyses the protein of one ORF or frame (`TranslatedSpan`).
 */
const NO_CDS_ANALYSIS_BP = 1_200;

/** A residue as the engine counts one in a protein (biophysics_3d.rs): an ASCII letter, never `*` or `-`. */
const RESIDUE = /[A-Za-z]/;

/**
 * The shortest start of a protein sequence holding its first `cap` residues, how many residues
 * that is, and how many the whole sequence holds (BG-01M6S13D).
 */
function leadingResidues(seq: string, cap: number): { prefix: string; residues: number; total: number } {
  let total = 0;
  let cut = seq.length;
  for (let i = 0; i < seq.length; i++) {
    if (!RESIDUE.test(seq[i])) continue;
    total += 1;
    if (total === cap) cut = i + 1;
  }
  return { prefix: seq.slice(0, cut), residues: Math.min(total, cap), total };
}


/**
 * What a protein KPI reads, in place of its value, when the engine translated no residue
 * (BG-01M6SQXX): its reply for no residue holds zeros for the mass, the extinction and the
 * absorbance, and null for the pI and the charge, none of them a measurement. Each KPI with no
 * residue to describe reads this one string; a count of what was found stays a number.
 */
export const NO_RESIDUE_TRANSLATED = 'n/a: no residue translated';
/**
 * What the GRAVY and aliphatic index read for a chain with no standard residue (all U, O, B, Z, J or
 * X): the engine gives them no value (null), since those letters have none on either scale.
 */
export const NO_STANDARD_RESIDUE = 'n/a: no standard residue';

/** The protein a document is analysed as: a protein itself (to its cap), or a DNA or RNA document's CDS, translated. */
export interface ProteinAnalysisTarget {
  dna: string;
  proteinSeq: string;
  startOffset: number;
  endOffset: number;
  minusStrand: boolean;
  label: string;
  totalResidues: number;
  cds: { name: string; start: number; end: number; minus: boolean } | null;
}

/**
 * What the Protein studio analyses for `doc` (moved from History's protein tab, US-01M6Q164): a
 * protein's own residues up to PROTEIN_ANALYSIS_CAP_AA; a DNA or RNA document's first CDS read along
 * its strand and translated, or with no CDS its first NO_CDS_ANALYSIS_BP bases.
 */
export function proteinAnalysisTarget(doc: SequenceDocument): ProteinAnalysisTarget {
  if (doc.moleculeType === 'Protein') {
    const { prefix: sliceAa, residues, total } = leadingResidues(doc.sequence, PROTEIN_ANALYSIS_CAP_AA);
    return {
      dna: sliceAa,
      proteinSeq: sliceAa,
      startOffset: 1,
      endOffset: sliceAa.length,
      minusStrand: false,
      label: `${doc.name} (1..${residues} aa)`,
      totalResidues: total,
      cds: null,
    };
  }
  const cdsFeat = doc.features.find((f) => f.type === 'CDS');
  const forwardSlice = cdsFeat
    ? doc.sequence.slice(cdsFeat.start - 1, cdsFeat.end)
    : doc.sequence.slice(0, NO_CDS_ANALYSIS_BP);
  // A minus-strand CDS is read on the reverse complement (it was translated
  // from the wrong strand).
  const minusStrand = Boolean(cdsFeat && cdsFeat.strand < 0);
  const dnaSlice = minusStrand
    ? reverseComplement(forwardSlice, doc.moleculeType === 'RNA')
    : forwardSlice;
  return {
    dna: dnaSlice,
    proteinSeq: translateSequence(dnaSlice, 0).replace(/\*/g, ''),
    startOffset: cdsFeat ? cdsFeat.start : 1,
    endOffset: cdsFeat ? cdsFeat.end : dnaSlice.length,
    minusStrand,
    label: cdsFeat
      ? `${cdsFeat.name} (${minusStrand ? `complement(${cdsFeat.start}..${cdsFeat.end})` : `${cdsFeat.start}..${cdsFeat.end}`})`
      : `${doc.name} (1..${dnaSlice.length})`,
    totalResidues: 0,
    cds: cdsFeat ? { name: cdsFeat.name, start: cdsFeat.start, end: cdsFeat.end, minus: minusStrand } : null,
  };
}
