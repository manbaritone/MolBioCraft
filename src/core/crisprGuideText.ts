// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The text a CRISPR guide leaves the tab as (US-01M7DV5P): what a copy puts on the clipboard, and
 * what the guide table's export writes beside the cells on screen.
 *
 * Every form here is built from the guide record's own facts - its bases, its PAM side and its PAM
 * pattern, which the scan reports per nuclease (US-01M7DV29) - and from the preset the scan ran
 * with. No length, PAM or order is written out for SpCas9: a 20-nt spacer with a 3-nt 3' PAM and a
 * 20-nt spacer with a 4-nt 5' PAM both come out right, and a hard-coded 20 or 3 is wrong for one of
 * them (BG-01M7EXRW).
 *
 * The copy forms are two, and they are not the same text:
 *
 *  - the spacer alone is exactly the bases to order, 5'->3', with no PAM and no label, so it can be
 *    pasted into an order form as it stands;
 *  - the spacer and its PAM are two labelled parts, each bracketed by its own 5' and 3' ends, in the
 *    order the nuclease's PAM side dictates - spacer then PAM where the PAM sits 3' of the spacer
 *    (SpCas9), PAM then spacer where it sits 5' of it (Cas12a). The PAM is never appended to the
 *    spacer bases: the text holds no run of bases that could be ordered as one 23- or 24-base oligo
 *    by accident, and it says as much in words.
 *
 * The export adds what the cells cannot carry: the coordinates' convention, the site's length
 * counted round the origin, the nuclease preset and its cut convention, the rule behind the
 * heuristic rank - in the engine's own words, read from it rather than restated (BG-01M7E61C) - the
 * range a seed count covers, the interval searched and the molecule's revision token. The rows it
 * covers, and why, are a column of their own, because a delimited file carries no caption.
 */

import type { SequenceDocument } from '../types/bio';
import { crisprHeuristicRankDescriptionRust } from '../lib/rustBioEngine';
import { intervalLength } from './activeInterval';
import type { CrisprNucleasePreset, CrisprScanGuide, CrisprScanReport } from './bioEngine';
import type { FigureTable } from './figureExport';
import { sequenceRevision } from './restrictionDisplay';

/** A count as a researcher reads it, grouped like the engine's own sentences. */
const bp = (n: number) => n.toLocaleString('en-US');

/** The guide facts a copy reads: the record's own bases, PAM side and PAM pattern. */
export type CrisprCopyGuide = Pick<
  CrisprScanGuide,
  'name' | 'nuclease' | 'spacerSeq' | 'pamSeq' | 'pamSide' | 'pamPattern'
>;

/**
 * The spacer alone, as it is ordered (AC1): exactly the row's bases, 5'->3' on the guide's own
 * strand, with no PAM and no label. This is the one place that text is defined, so a copy cannot
 * drift from what the row shows.
 */
export function crisprSpacerCopyText(guide: Pick<CrisprCopyGuide, 'spacerSeq'>): string {
  return guide.spacerSeq;
}

/**
 * Whether the PAM leads the labelled copy: it does exactly where the nuclease reads it 5' of the
 * spacer, which is the record's own `pamSide` and nothing derived from the strand or the nuclease's
 * name.
 */
export function crisprPamLeadsCopy(pamSide: string): boolean {
  return pamSide.trim().startsWith("5'");
}

/**
 * The spacer and its PAM as two labelled parts (AC2), in the order the nuclease's PAM side dictates
 * and each bracketed by its own 5' and 3' ends.
 */
export function crisprSpacerAndPamCopyText(guide: CrisprCopyGuide): string {
  const spacerLine = `spacer (${guide.spacerSeq.length} nt, the oligo to order): 5'-${guide.spacerSeq}-3'`;
  const pamLine = `${guide.pamSide} PAM ${guide.pamPattern} (${guide.pamSeq.length} nt, read by the nuclease and not ordered): 5'-${guide.pamSeq}-3'`;
  const parts = crisprPamLeadsCopy(guide.pamSide) ? [pamLine, spacerLine] : [spacerLine, pamLine];
  return [
    `${guide.name} — ${guide.nuclease}, ${guide.pamSide} PAM, in the order the nuclease reads them`,
    ...parts,
    `Two parts of one site, each 5'->3' on the guide's own strand: not one ${
      guide.spacerSeq.length + guide.pamSeq.length
    }-nt oligo to order.`,
  ].join('\n');
}

/**
 * The engine's own description of the heuristic rank's rule and its range, read from the engine so
 * that no surface restates it (BG-01M7E61C, decision D0134). An engine that does not state it
 * leaves the reader saying so, never restating the rule from memory.
 *
 * It asks the engine for that one sentence and nothing else (BG-01M7EYED). It used to run the
 * `js-crispr-spcas9-scanner` macro over a document and read `scoreModels.onTargetScore` off the
 * reply — a whole CRISPR scan, of up to `GUIDE_SCAN_MAX_BP` bases, for a constant that does not
 * depend on the document, which is why the one surface that showed the rule restated it instead.
 */
export function crisprHeuristicRuleText(): string {
  try {
    const stated: unknown = crisprHeuristicRankDescriptionRust();
    if (typeof stated === 'string' && stated.trim()) return stated.replace(/\s+/g, ' ').trim();
    return 'The engine did not state the rule behind this rank, so it is not stated here.';
  } catch (e) {
    return `The engine could not state the rule behind this rank (${
      e instanceof Error ? e.message : String(e)
    }), so it is not stated here.`;
  }
}

/** How many of the rows on screen an export covers, and how many are selected (AC4). */
export interface CrisprGuideExportScope {
  /** Rows the user ticked, among those the table shows. */
  selectedCount: number;
  /** Rows the table shows right now, after its filters. */
  shownCount: number;
}

/** What the export says about the rows it holds: the selection, or every row shown and why (AC4). */
export function crisprGuideExportScopeNote(scope: CrisprGuideExportScope): string {
  const { selectedCount, shownCount } = scope;
  if (selectedCount <= 0) {
    return `No row was selected, so this file holds every one of the ${bp(shownCount)} rows the table shows.`;
  }
  return selectedCount === 1
    ? `1 of the ${bp(shownCount)} rows the table shows is selected, and that row is what this file holds.`
    : `${bp(selectedCount)} of the ${bp(shownCount)} rows the table shows are selected, and those rows are what this file holds.`;
}

/**
 * The convention every coordinate in the file follows (AC5), the one the active-interval model reads
 * (PRD F03): a site across the origin runs from a start past its end, and its length is counted
 * round the origin - never `end - start`, which would be negative there (BG-01M7CG2W, LC-018).
 */
export const CRISPR_EXPORT_COORDINATE_CONVENTION =
  "1-based and inclusive, on the plus strand; a site whose start is past its end runs across the origin of a circular record, and its length is counted round the origin rather than as end - start.";

/** The topology in the words the sentences below read. */
const topologyWord = (topology: string): 'circular' | 'linear' =>
  topology === 'circular' ? 'circular' : 'linear';

/** What a scan read, where it reports no interval: the whole molecule, or a bounded prefix of it. */
function scannedRangeText(scan: CrisprScanReport, topology: string): string {
  return scan.scannedLengthBp < scan.sequenceLengthBp
    ? `bases 1 to ${bp(scan.scannedLengthBp)} of the ${bp(scan.sequenceLengthBp)} bases of this sequence`
    : `all ${bp(scan.sequenceLengthBp)} bases of this ${topologyWord(topology)} sequence`;
}

/** The interval a guide was searched in, as the scan itself reports it (US-01M7DVAS). */
function intervalSearchedText(
  guide: CrisprScanGuide,
  scan: CrisprScanReport | undefined,
  topology: string
): string {
  if (!scan) {
    return 'Not stated: the engine sent no scan report, so what was searched cannot be stated here.';
  }
  if (scan.intervalRefusal !== undefined) {
    return `No interval was searched: ${scan.intervalRefusal}`;
  }
  const interval = scan.searchedInterval;
  if (!interval) {
    return `No interval: the scan searched ${scannedRangeText(scan, topology)}, on both strands.`;
  }
  const context =
    scan.contextOutsideIntervalBp > 0
      ? `${bp(scan.contextOutsideIntervalBp)} bases outside it were read as PAM context only.`
      : 'No base outside it was read.';
  return [
    `bases ${bp(interval.start)}..${bp(interval.end)} — the ${bp(interval.lengthBp)} bp interval searched${
      interval.crossesOrigin ? ', across the origin' : ''
    } — of the ${bp(scan.sequenceLengthBp)} bases of this ${topologyWord(topology)} sequence.`,
    context,
    ...(guide.intervalContextNote ? [guide.intervalContextNote] : []),
  ].join(' ');
}

/**
 * What a guide's seed count counts (US-01M7DVVR, US-01M7DVAS AC4): the seed, the range it was
 * counted over and both strands - so an interval specificity is never read as a sequence-wide one -
 * and that no genome-wide search was run.
 */
function seedScopeText(scan: CrisprScanReport | undefined, topology: string): string {
  const notGenomeWide = 'No genome-wide off-target search was run.';
  if (!scan) {
    return `Not stated: the engine sent no scan report, so the range this count covers cannot be stated. ${notGenomeWide}`;
  }
  const interval = scan.searchedInterval;
  if (interval) {
    return `Other exact copies of the 12-nt PAM-proximal seed inside the interval searched, bases ${bp(
      interval.start
    )}..${bp(interval.end)} (${bp(interval.lengthBp)} bp${
      interval.crossesOrigin ? ', across the origin' : ''
    }), on both strands, and no copy outside it — an interval specificity, not one over the whole ${bp(
      scan.sequenceLengthBp
    )} bases. ${notGenomeWide}`;
  }
  return `Other exact copies of the 12-nt PAM-proximal seed in ${scannedRangeText(
    scan,
    topology
  )} — the range searched — on both strands, and no copy outside it. ${notGenomeWide}`;
}

/** A preset's own site facts, in its own numbers (US-01M7DV29): never SpCas9's written out. */
const presetFactsText = (preset: CrisprNucleasePreset) =>
  `${preset.id} — ${preset.pamSide} PAM ${preset.pamPattern}, ${bp(preset.spacerLengthBp)}-nt spacer, ${bp(
    preset.siteSpanBp
  )}-bp site`;

/** The nuclease preset a row was found with, with the site facts the preset states (US-01M7DV29). */
function nucleasePresetText(nuclease: string, preset?: CrisprNucleasePreset): string {
  return preset && preset.id === nuclease ? presetFactsText(preset) : nuclease;
}

/**
 * The staggered second cut, or why there is none: an absent one is never written as 0 or as a
 * position (US-01M7DV29 AC4).
 */
function secondCutText(guide: CrisprScanGuide): string {
  if (guide.cutPositionTargetStrand !== undefined) return String(guide.cutPositionTargetStrand);
  if (guide.cutPositionTargetStrandNote) return `None here: ${guide.cutPositionTargetStrandNote}`;
  return 'None: this nuclease reports one cut position, by the convention named beside it.';
}

/** What an export writes, and what it is of. */
export interface CrisprGuideExportInput {
  /** The guides to write, in the order the file should hold them. */
  guides: readonly CrisprScanGuide[];
  /** The molecule they were found on: the bases and topology its revision token is of. */
  document: Pick<SequenceDocument, 'name' | 'sequence' | 'topology'>;
  /** The preset the scan ran with, where the chooser holds it. */
  preset?: CrisprNucleasePreset;
  /** The scan's own report; absent where the engine sent none, and then no scope is claimed. */
  scan?: CrisprScanReport;
  /** The engine's own words for the rank's rule ({@link crisprHeuristicRuleText}). */
  heuristicRule: string;
  scope: CrisprGuideExportScope;
}

/** The columns the export writes, in order. */
export const CRISPR_EXPORT_HEADERS = [
  'Guide',
  "Spacer (5'->3')",
  'PAM',
  'PAM Side',
  'Strand',
  'Start',
  'End',
  'Site Length (bp)',
  'Coordinate Convention',
  'Cut Position',
  'Cut Convention',
  'Second Cut (Target Strand)',
  'GC%',
  'Heuristic Rank',
  'Heuristic Rank Rule',
  'Exact Seed Matches',
  'Seed Match Scope',
  'Nuclease Preset',
  'Interval Searched',
  'Sequence Revision',
  'Rows Exported',
] as const;

/**
 * The chosen guides as a table to save (AC4, AC5): each row the guide record's own coordinates and
 * scores, with the provenance the cells on screen do not carry.
 */
export function crisprGuideExportTable(input: CrisprGuideExportInput): FigureTable {
  const { document: doc, guides, preset, scan, heuristicRule, scope } = input;
  const topology = topologyWord(doc.topology);
  const revision = sequenceRevision(doc.sequence, topology);
  const scopeNote = crisprGuideExportScopeNote(scope);
  const rule = heuristicRule.replace(/\s+/g, ' ').trim();
  const rows = guides.map((g) => [
    g.name,
    g.spacerSeq,
    g.pamAmbiguityNote ? `${g.pamSeq} — ${g.pamAmbiguityNote}` : g.pamSeq,
    `${g.pamSide} of the spacer (pattern ${g.pamPattern})`,
    g.strand === 1 ? 'Forward (+)' : 'Reverse (-)',
    String(g.start),
    String(g.end),
    // Counted round the origin, so a site that crosses it has the length it really has (LC-018).
    String(intervalLength({ start: g.start, end: g.end }, Math.max(1, doc.sequence.length))),
    g.start > g.end
      ? `${CRISPR_EXPORT_COORDINATE_CONVENTION} This site runs across the origin.`
      : CRISPR_EXPORT_COORDINATE_CONVENTION,
    String(g.cutPosition),
    g.cutConvention || preset?.cutConvention || 'Not stated by the engine.',
    secondCutText(g),
    String(g.gcPercent),
    String(g.onTargetScore),
    rule,
    String(g.offTargetCount),
    seedScopeText(scan, doc.topology),
    nucleasePresetText(g.nuclease, preset),
    intervalSearchedText(g, scan, doc.topology),
    revision,
    scopeNote,
  ]);
  return {
    headers: [...CRISPR_EXPORT_HEADERS],
    rows,
    caption: [
      `CRISPR guides on ${doc.name} (${bp(doc.sequence.length)} bp, ${topology}; revision ${revision})`,
      `Nuclease: ${preset ? presetFactsText(preset) : (guides[0]?.nuclease ?? 'not stated')}`,
      `Coordinates: ${CRISPR_EXPORT_COORDINATE_CONVENTION}`,
      scopeNote,
    ].join('\n'),
  };
}
