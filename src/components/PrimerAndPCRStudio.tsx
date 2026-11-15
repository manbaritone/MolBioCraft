// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  CrisprGuideRecord,
  PrimerRecord,
  SequenceDocument,
  SequenceFeature,
} from '../types/bio';
import { intervalLength } from '../core/activeInterval';
import {
  calculatePrimerMetrics,
  databasePrimerCandidate,
  designPCRPrimers,
  documentPrimerCandidate as screeningCandidateOf,
  crisprNucleasePresets,
  scanCrisprGuides,
  findPrimerBindings,
  primerMatchSettingsText,
  testSavedPrimersOnSequence,
  type CrisprScanGuide,
} from '../core/bioEngine';
import {
  crisprGuideExportTable,
  crisprHeuristicRuleText,
  crisprIntervalSpecificityText,
  crisprScanReadAs,
  crisprSeedText,
  crisprSpacerAndPamCopyText,
  crisprSpacerCopyText,
} from '../core/crisprGuideText';
import type { FigureTable } from '../core/figureExport';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { MolBioMenuGlyph } from './MolBioIcons';
import { ResultWarnings } from './ResultWarnings';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { originSpanningSiteCount, primerSiteStatus } from '../core/primerSiteStatus';
import { primerTmText } from './CircularPlasmidMap';
import { activePrimers, openPrimerDatabase, type DatabasePrimerInput, type PrimerDatabase } from '../core/primerDatabase';
import { usePrimerDatabaseSave } from './PrimerDatabaseWindow';

/** How many of the candidate guides the CRISPR tab lists. */
const CRISPR_GUIDES_LISTED = 25;

/**
 * Why no CRISPR row has a genome-wide specificity (US-01M7DVVR AC3): the scan counts seed copies in
 * the range it read and searches no reference genome, so the number is not evaluated, never 0 or 100.
 */
const GENOME_WIDE_NOT_EVALUATED =
  'Not evaluated — no reference genome or off-target search method is configured, so no genome-wide specificity is computed.';

/** A count or a length as a researcher reads it, grouped like the engine's own sentences. */
const bp = (n: number) => n.toLocaleString('en-US');

/**
 * The bases a guide covers. A guide whose site straddles a circular record's origin runs from a
 * start past its end — the coordinate convention this workbench uses for a site across the origin —
 * so the range says so rather than reading backwards (BG-01M6T6GQ).
 */
const guideRange = (g: CrisprGuideRecord) =>
  `${bp(g.start)}..${bp(g.end)}${g.start > g.end ? ' (across the origin)' : ''}`;

/**
 * A guide as the views draw it (US-01M7DVA6): the whole site exactly as the row reports it, and the
 * two parts of that site apart - the spacer the researcher orders and the PAM the nuclease only
 * reads. Every coordinate is 1-based, inclusive and on the plus strand, `start > end` running across
 * the origin of a circular record, the one convention the active-interval model reads (PRD F03).
 * The bases themselves are not carried: a view reads them from the document at these spans and
 * orients them on the guide's own strand, so a span and the letters drawn for it cannot disagree.
 */
export interface CrisprGuideHighlight {
  /** The guide's name, as its row shows it. */
  name: string;
  /** The nuclease preset the scan used, in the engine's own words. */
  nuclease: string;
  strand: 1 | -1;
  /** The spacer and its PAM together, as the row's Region cell reports them. */
  site: { start: number; end: number };
  spacer: { start: number; end: number };
  pam: { start: number; end: number };
  /** Which side of the spacer the PAM sits on, in the engine's words (`5'` or `3'`). */
  pamSide: string;
  /** The reported cut, a plus-strand coordinate. */
  cutPosition: number;
  /** The staggered second cut, where the preset has one and it falls on a base that was read. */
  cutPositionTargetStrand?: number;
  /** Why a staggered second cut has no position here; absent where it has one or the cutter is blunt. */
  cutPositionTargetStrandNote?: string;
}

/**
 * Where a guide's spacer and its PAM lie inside the site the row reports (US-01M7DVA6 AC1-AC3),
 * read off the engine's own record: the site ascends in plus-strand order from `start`, wrapping the
 * origin once where `start > end`, and the PAM leads exactly when the nuclease's PAM side and the
 * guide's strand disagree - so SpCas9's forward site opens with its spacer and its reverse site
 * opens with its PAM (the rule `scan_crispr_guides` builds the coordinates by). The lengths are the
 * record's own spacer and PAM, never a constant, so a 20-nt spacer with a 3-nt or a 4-nt PAM both
 * come out right.
 */
export function crisprGuideParts(
  g: Pick<CrisprGuideRecord, 'start' | 'end' | 'strand' | 'spacerSeq' | 'pamSeq'> & { pamSide: string },
  sequenceLength: number
): { spacer: { start: number; end: number }; pam: { start: number; end: number } } {
  const len = Math.max(1, sequenceLength);
  const wrap = (pos: number) => ((((pos - 1) % len) + len) % len) + 1;
  const span = (from: number, bases: number) => ({ start: wrap(from), end: wrap(from + bases - 1) });
  const spacerLen = g.spacerSeq.length;
  const pamLen = g.pamSeq.length;
  const spacerLeads = g.pamSide.startsWith("3'") === (g.strand === 1);
  return spacerLeads
    ? { spacer: span(g.start, spacerLen), pam: span(g.start + spacerLen, pamLen) }
    : { spacer: span(g.start + pamLen, spacerLen), pam: span(g.start, pamLen) };
}

/** The guide a click hands the views: its site, its two parts and what the row says about it. */
export function crisprGuideHighlight(g: CrisprScanGuide, sequenceLength: number): CrisprGuideHighlight {
  const { spacer, pam } = crisprGuideParts(g, sequenceLength);
  return {
    name: g.name,
    nuclease: g.nuclease,
    strand: g.strand,
    site: { start: g.start, end: g.end },
    spacer,
    pam,
    pamSide: g.pamSide,
    cutPosition: g.cutPosition,
    // An absent staggered cut stays absent: it is never drawn as 0 or as a position (US-01M7DV29 AC4).
    ...(g.cutPositionTargetStrand !== undefined ? { cutPositionTargetStrand: g.cutPositionTargetStrand } : {}),
    ...(g.cutPositionTargetStrandNote !== undefined
      ? { cutPositionTargetStrandNote: g.cutPositionTargetStrandNote }
      : {}),
  };
}

/**
 * A serial number taken once per annotation written, counting up for as long as the app runs
 * (BG01M7EXRW AC3). A feature id is what a downstream reader tells two annotations apart by, and
 * `Date.now()` alone gives two annotations of one guide the same id whenever they land inside the
 * same millisecond - a scripted double-fire, or one button pressed twice fast. The serial is the
 * part of the id that does not depend on the clock's resolution; the timestamp is kept beside it so
 * an id still says when it was written.
 */
let crisprAnnotationSerial = 0;
const nextCrisprAnnotationSerial = () => {
  crisprAnnotationSerial += 1;
  return crisprAnnotationSerial;
};

interface PrimerAndPCRStudioProps {
  doc: SequenceDocument;
  allDocuments?: SequenceDocument[];
  onUpdateDocument: (updated: SequenceDocument) => void;
  onAddConstruct: (ampliconDoc: SequenceDocument) => void;
  onStatusNotice?: (message: string) => void;
  /**
   * Shows `start..end` in the sequence views as the one active interval (PRD F03), `start > end`
   * running across the origin. `guide` is given only by a CRISPR guide row (US-01M7DVA6): the same
   * site, with its spacer and its PAM apart, for the views to draw the two parts distinguishably.
   * Showing a guide changes nothing in the document.
   */
  onJumpToCoordinate?: (
    start: number,
    end: number,
    label?: string,
    guide?: CrisprGuideHighlight
  ) => void;
  /** Sub-tab requested by a menu command (CRISPR sites, saved primers, design). */
  initialSubTab?: 'design' | 'saved' | 'crispr';
  commandNonce?: number;
  /** Bumped when the Primers window or the import writes the Primer Database, so the screened list is read again. */
  primerDatabaseRevision?: number;
  /** The Primer Database that Save to Primer Database writes to; the user's own store unless given. */
  primerDatabase?: PrimerDatabase;
  /**
   * The bases selected in the workbench, as the App holds them (PRD F03's one active interval,
   * EP-01M7CCCF): 1-based and inclusive, `start > end` running across the origin of a circular
   * record. It is the interval Find CRISPR Sites offers beside the whole sequence (US-01M7DVAS
   * AC1). `null` or absent is no selection, and only the whole sequence is then offered - never an
   * interval guessed from a missing one.
   */
  selectedRange?: { start: number; end: number; label?: string } | null;
}

export const PrimerAndPCRStudio: React.FC<PrimerAndPCRStudioProps> = ({
  doc,
  allDocuments = [],
  onUpdateDocument,
  onAddConstruct,
  onStatusNotice,
  onJumpToCoordinate,
  initialSubTab = 'design',
  commandNonce,
  primerDatabase,
  primerDatabaseRevision = 0,
  selectedRange = null,
}) => {
  // In the workbench the conditions of each sub-tab sit in App's inspector; drawn on its own, the
  // studio keeps every setting where it sits in its card (US-01M6TAKD).
  const inWorkbench = useInWorkbench();
  const [subTab, setSubTab] = useState<'design' | 'saved' | 'crispr'>(initialSubTab);
  // Menu commands such as Find CRISPR Sites always landed on the design tab.
  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab, commandNonce]);

  const [regionStart, setRegionStart] = useState<number>(
    doc.features.find((f) => f.type === 'CDS')?.start ?? 100
  );
  const [regionEnd, setRegionEnd] = useState<number>(
    doc.features.find((f) => f.type === 'CDS')?.end ?? Math.min(doc.sequence.length, 820)
  );
  // Region defaults come from the document the studio opened on; re-derive them
  // when the active document changes (they used to keep the previous
  // document's coordinates, clamped into a mislabelled product).
  useEffect(() => {
    const cds = doc.features.find((f) => f.type === 'CDS' && f.start < f.end);
    setRegionStart(cds?.start ?? Math.min(100, Math.max(1, Math.floor(doc.sequence.length / 4))));
    setRegionEnd(cds?.end ?? Math.min(doc.sequence.length, 820));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  const [targetTm, setTargetTm] = useState<number>(60.0);
  const [fwdTailEnz, setFwdTailEnz] = useState<string>('None');
  const [revTailEnz, setRevTailEnz] = useState<string>('None');
  const [includeClampTail, setIncludeClampTail] = useState<boolean>(true);

  // Manual Oligo Evaluator
  const [customOligo, setCustomOligo] = useState<string>(
    'GGAATTCCATATGGTGAGCAAGGGCGAGGAG'
  );
  const [naMm, setNaMm] = useState<number>(50);
  const [mgMm, setMgMm] = useState<number>(1.5);
  const [primerNm, setPrimerNm] = useState<number>(250);

  // Test with Saved Primers state
  const [maxAllowedMismatches, setMaxAllowedMismatches] = useState<number>(2);

  // CRISPR Guide Finder state. The nucleases on offer are the engine's own presets
  // (US-01M7DV29 AC1), so this tab cannot ask for one the engine does not scan for.
  const nucleasePresets = useMemo(() => crisprNucleasePresets(), []);
  const [crisprNuclease, setCrisprNuclease] = useState<string>(
    () => crisprNucleasePresets()[0]?.id ?? 'SpCas9 (NGG)'
  );
  const chosenPreset = nucleasePresets.find((n) => n.id === crisprNuclease);

  const fwdTailSeq = useMemo(() => {
    if (fwdTailEnz === 'None') return '';
    const enz = REBASE_ENZYMES.find((e) => e.name === fwdTailEnz);
    return (includeClampTail ? 'GCG' : '') + (enz?.recognitionSeq ?? '');
  }, [fwdTailEnz, includeClampTail]);

  const revTailSeq = useMemo(() => {
    if (revTailEnz === 'None') return '';
    const enz = REBASE_ENZYMES.find((e) => e.name === revTailEnz);
    return (includeClampTail ? 'CGC' : '') + (enz?.recognitionSeq ?? '');
  }, [revTailEnz, includeClampTail]);

  // Valid linear target: inside the sequence, start before end, long enough
  // for two primers. Reversed / out-of-range regions used to produce 0-bp or
  // nonsense amplicons that could still be saved.
  const pcrRegionValid =
    regionStart >= 1 &&
    regionEnd <= doc.sequence.length &&
    regionEnd - regionStart + 1 >= 40;

  const designedPCR = useMemo(
    () =>
      designPCRPrimers(
        doc,
        regionStart,
        regionEnd,
        targetTm,
        fwdTailSeq,
        revTailSeq
      ),
    [doc, regionStart, regionEnd, targetTm, fwdTailSeq, revTailSeq]
  );

  const customMetrics = useMemo(
    () => calculatePrimerMetrics(customOligo, naMm, mgMm, primerNm),
    [customOligo, naMm, mgMm, primerNm]
  );

  // Save to Primer Database (US-01M7DQFS AC4): a new record, under the duplicate policy; the
  // document and its primers are never changed by it.
  const primerDb = useMemo(() => primerDatabase ?? openPrimerDatabase(), [primerDatabase]);
  const [dbSaveMessage, setDbSaveMessage] = useState<string | null>(null);
  const dbSave = usePrimerDatabaseSave(primerDb, (message) => {
    setDbSaveMessage(message);
    onStatusNotice?.(message);
  });
  // The documents' primers, one per name as before, so each is screened as it was; the Primer
  // Database's active records join them keyed by source and id (US-01M7DQMY AC2), so a record and a
  // document primer of one name are both listed.
  const documentPrimerCatalog = useMemo(() => {
    const map = new Map<string, PrimerRecord>();
    for (const d of [doc, ...allDocuments]) {
      for (const p of d.primers) {
        map.set(p.name, p);
      }
    }
    return Array.from(map.values());
  }, [doc, allDocuments]);

  // Read when the tab opens, after a save to the database here, and when the Primers window or the
  // import writes it (primerDatabaseRevision); an unreadable store is named, never
  // read as one without primers.
  const databaseCatalog = useMemo(() => {
    const read = primerDb.read();
    if (!read.ok) return { candidates: [], error: `The Primer Database cannot be read, so its primers are not screened: ${read.error.message}` };
    return { candidates: activePrimers(read.records).map(databasePrimerCandidate), error: null as string | null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primerDb, subTab, dbSaveMessage, primerDatabaseRevision]);

  const savedPrimerCatalog = useMemo(
    () => [...documentPrimerCatalog.map(screeningCandidateOf), ...databaseCatalog.candidates],
    [documentPrimerCatalog, databaseCatalog]
  );

  const savedPrimerSearch = useMemo(
    () => findPrimerBindings([doc], savedPrimerCatalog, maxAllowedMismatches),
    [doc, savedPrimerCatalog, maxAllowedMismatches]
  );
  const savedPrimerHits = savedPrimerSearch.occurrences;

  // Per-primer binding multiplicity & specificity alerts on active template
  const docPrimerSiteCounts = useMemo(() => {
    const hits = testSavedPrimersOnSequence(doc.sequence, doc.primers, 1);
    const counts = new Map<string, number>();
    for (const p of doc.primers) {
      counts.set(p.name, 0);
    }
    for (const h of hits) {
      counts.set(h.primer.name, (counts.get(h.primer.name) ?? 0) + 1);
    }
    return counts;
  }, [doc.sequence, doc.primers]);

  // What Find CRISPR Sites may be asked to search (US-01M7DVAS AC1): the interval on screen, or why
  // the selection the App holds is not one. The selection is read as it is, not through a
  // normaliser: a bound outside the sequence, a reversed pair on a linear record and a span shorter
  // than the nuclease's own site are each named here, because clamping one of them would search a
  // range the user never selected, and reading it as "no interval" would quietly search the whole
  // plasmid instead.
  const crisprRangeOffer = useMemo((): {
    interval: { start: number; end: number; lengthBp: number; crossesOrigin: boolean } | null;
    note: string;
  } => {
    const length = doc.sequence.length;
    const siteSpanBp = chosenPreset?.siteSpanBp ?? 23;
    if (!selectedRange) {
      return {
        interval: null,
        note: 'No bases are selected, so only the whole sequence is offered: select the span to search to offer it as an interval.',
      };
    }
    const bounds = `${bp(selectedRange.start)}..${bp(selectedRange.end)}`;
    if (
      !Number.isInteger(selectedRange.start) ||
      !Number.isInteger(selectedRange.end) ||
      selectedRange.start < 1 ||
      selectedRange.end < 1 ||
      selectedRange.start > length ||
      selectedRange.end > length
    ) {
      return {
        interval: null,
        note: `The selection ${bounds} is not inside the ${bp(length)} bases of this sequence, so it is not offered as a search interval: it is read neither as the whole sequence nor as an empty one.`,
      };
    }
    if (selectedRange.start > selectedRange.end && doc.topology !== 'circular') {
      return {
        interval: null,
        note: `The selection ${bounds} runs from a start past its end, which is an interval across the origin of a circle; this sequence is linear and has no origin to run across, so it is not offered as a search interval.`,
      };
    }
    // The length comes from the active-interval model, which counts both sides of the origin: an
    // origin-crossing selection is not `end - start` bases (BG-01M7CG2W).
    const lengthBp = intervalLength({ start: selectedRange.start, end: selectedRange.end }, length);
    if (lengthBp < siteSpanBp) {
      return {
        interval: null,
        note: `The selection ${bounds} is ${bp(lengthBp)} bp, shorter than the ${bp(siteSpanBp)}-bp ${crisprNuclease} site, so it holds no whole site and is not offered as a search interval.`,
      };
    }
    return {
      interval: {
        start: selectedRange.start,
        end: selectedRange.end,
        lengthBp,
        crossesOrigin: selectedRange.start > selectedRange.end,
      },
      note: '',
    };
  }, [selectedRange, doc.sequence.length, doc.topology, chosenPreset, crisprNuclease]);
  // Which of the two scopes the scan is asked for. A user who selected a span and then asked for
  // CRISPR sites meant that span, so the interval is preferred wherever one is on offer; choosing
  // the whole sequence here keeps it, and a selection that cannot be searched falls back to the
  // whole sequence rather than to nothing.
  const [crisprScopeChoice, setCrisprScopeChoice] = useState<'whole' | 'interval'>('interval');
  const crisprScope: 'whole' | 'interval' =
    crisprScopeChoice === 'interval' && crisprRangeOffer.interval ? 'interval' : 'whole';
  // The record's own topology goes to the engine: a plasmid is scanned as the circle it is, so the
  // guides across its origin are listed (BG-01M6T6GQ). The interval goes with it where one was
  // asked for, and the engine then searches that arc of the record alone (US-01M7DVAS).
  const crisprResult = useMemo(
    () =>
      scanCrisprGuides(
        doc.sequence,
        crisprNuclease,
        CRISPR_GUIDES_LISTED,
        doc.topology === 'circular',
        crisprScope === 'interval' ? crisprRangeOffer.interval : null
      ),
    [doc.sequence, doc.topology, crisprNuclease, crisprScope, crisprRangeOffer.interval]
  );
  const crisprGuides = crisprResult.guides;
  /**
   * The rank's rule in the engine's own words (BG-01M7EYED): one sentence, asked for once, from the
   * engine op that states it without scanning anything. It does not depend on the document, so no
   * scan, interval or nuclease is in its dependencies — and reading it is not a scan of its own.
   */
  const crisprRankRule = useMemo(() => crisprHeuristicRuleText(), []);
  // The scan's own report (US-01M7DVH2): the envelope the scan op replies with, so these numbers are
  // there when it found no guide, and none of them is derived from the rows the tab holds. Absent
  // only where the engine sent no report; it is then said to be unavailable, never read as zeroes.
  const crisprScan = crisprResult.report;
  // The rows the scan returned. The detected total beside it is the scan's own `candidateCount`,
  // never this number: the rows are the highest-scoring of the candidates, not all of them.
  const crisprReturned = crisprResult.guides.length;
  const crisprCandidates = crisprScan?.candidateCount;
  const crisprScanned = crisprScan?.scannedLengthBp;
  const crisprSequenceBp = crisprScan?.sequenceLengthBp;
  // The interval the scan searched, as the scan itself reports it (US-01M7DVAS) — not the interval
  // this tab asked for, which an engine bound can shorten. Where it is set, `scannedLengthBp` counts
  // that interval, so the bounded-prefix wording below ("bases 1 to N") would be a false claim.
  const crisprSearchedInterval = crisprScan?.searchedInterval;
  const crisprIntervalRefusal = crisprScan?.intervalRefusal;
  const crisprContextBp = crisprScan?.contextOutsideIntervalBp ?? 0;
  const crisprScanIsPartial =
    crisprSearchedInterval === undefined &&
    crisprScanned !== undefined &&
    crisprSequenceBp !== undefined &&
    crisprScanned < crisprSequenceBp;
  /**
   * How the scan read the molecule, in the words the seed-match sentence, the no-guide line, the Top
   * 5 note and the guide export all share: `crisprScanReadAs`, stated once in core (BG-01M7FH8K) and
   * read here rather than copied. Every surface that prints it sits behind a scan report, so a scan
   * that sent none prints no scope at all.
   */
  const crisprReadAs = crisprScan ? crisprScanReadAs(crisprScan, doc.topology) : '';
  /**
   * What a seed count covered, as an annotation of the document has to say it (BG-01M7EQAA AC1):
   * the same words `crisprReadAs` gives the callout and the no-guide line, read from the scan's own
   * report — never from whether a selection exists, so a count taken over a chosen interval says
   * which bases it was measured over in the copy that outlives the session and travels in a GenBank
   * export. A scan that sent no report says the scope is unknown rather than claiming the whole
   * sequence [LC-006].
   */
  const crisprSeedScopeWords =
    crisprScan === undefined
      ? 'scope unavailable: the engine sent no scan report, so which bases this count covered is not known'
      : crisprSearchedInterval !== undefined
      ? `counted over ${crisprReadAs} — ${crisprIntervalSpecificityText(crisprScan)}`
      : `counted over ${crisprReadAs}`;
  /**
   * The seed those counts were taken with, as the note that outlives the session has to say it
   * (BG-01M7FF3B): the length the scan reported, through the one formatter the callout and the
   * export read, never a number of this component's own.
   */
  const crisprSeedNoteWords =
    crisprScan === undefined
      ? 'not known: the engine sent no scan report'
      : crisprSeedText(crisprScan);
  const crisprTabCount =
    crisprCandidates === undefined
      ? 'scan report unavailable'
      : crisprCandidates > crisprReturned
      ? `top ${bp(crisprReturned)} of ${bp(crisprCandidates)} Guides`
      : `${bp(crisprReturned)} Guides`;
  /**
   * The guide rows ticked for export (US-01M7DV5P AC4), by guide id. A scan that ran again lists
   * other guides, so a tick on a row that is gone exports nothing: only ids the table still holds
   * are read.
   */
  const [crisprSelectedIds, setCrisprSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    setCrisprSelectedIds([]);
  }, [doc.id, crisprNuclease, crisprScope]);
  const crisprSelected = useMemo(() => new Set(crisprSelectedIds), [crisprSelectedIds]);
  const crisprSelectedShown = crisprGuides.filter((g) => crisprSelected.has(g.id)).length;
  /**
   * The guide table's own export (US-01M7DV5P AC4): the rows ticked, or every row the table shows
   * where none is ticked, each written with the coordinates, scores and provenance the cells on
   * screen cannot carry. The table hands over the ids of the rows it shows now, in its own order, so
   * a filtered or sorted table exports what it shows and nothing else.
   */
  const crisprExportTable = (shownIds: string[]): FigureTable | null => {
    const byId = new Map(crisprGuides.map((g) => [g.id, g]));
    const shown = shownIds.map((id) => byId.get(id)).filter((g): g is CrisprScanGuide => g !== undefined);
    if (shown.length === 0) return null;
    const selected = shown.filter((g) => crisprSelected.has(g.id));
    return crisprGuideExportTable({
      guides: selected.length > 0 ? selected : shown,
      document: doc,
      ...(chosenPreset ? { preset: chosenPreset } : {}),
      ...(crisprScan ? { scan: crisprScan } : {}),
      // The rank's rule in the engine's own words, never restated here (BG-01M7E61C) — the same
      // sentence the callout shows, asked for once (BG-01M7EYED).
      heuristicRule: crisprRankRule,
      scope: { selectedCount: selected.length, shownCount: shown.length },
    });
  };

  const handleSavePrimersToDoc = () => {
    const updatedPrimers: PrimerRecord[] = [
      ...doc.primers,
      designedPCR.forward,
      designedPCR.reverse,
    ];
    onUpdateDocument({
      ...doc,
      primers: updatedPrimers,
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Bound primer pair "${designedPCR.forward.name}" & "${designedPCR.reverse.name}" (${regionStart.toLocaleString()}..${regionEnd.toLocaleString()} bp) to "${doc.name}"`
    );
  };

  /**
   * One copy out of the guide table, as far as the page can tell (US-01M7DV5P AC1-AC3,
   * BG-01M7EZVV AC4): what was copied, how sure the page is that the clipboard took it, and the
   * text itself - which stays on screen in every outcome, so a copy that did not land still leaves
   * the researcher the bases to take by hand (PRD F31, LC-006).
   *
   * `outcome` is three-valued because the page really has three answers, and collapsing them to a
   * boolean made the third read as the first: `copied` where the write was read back off the
   * clipboard, `not-copied` where it was refused, absent, or accepted and then not there, and
   * `unconfirmed` where the write resolved but this build does not let the page read the clipboard
   * back - a copy nobody can stand behind, and so never reported as one.
   */
  const [crisprCopy, setCrisprCopy] = useState<{
    outcome: 'copied' | 'unconfirmed' | 'not-copied';
    detail: string;
    text: string;
  } | null>(null);
  /** What a copy that did not land tells the reader to do with the text left on screen. */
  const COPY_BY_HAND = 'The text is below — select it and copy it by hand.';
  /** The word the copy panel leads with, one per outcome: only `copied` says a copy happened. */
  const CRISPR_COPY_HEADINGS: Record<'copied' | 'unconfirmed' | 'not-copied', string> = {
    copied: 'Copied',
    unconfirmed: 'Copy not confirmed',
    'not-copied': 'Nothing was copied',
  };
  /**
   * Which click a report belongs to (BG-01M7EZVV AC4). A copy is two awaits long - the write, and
   * the read-back that confirms it - so two clicks in quick succession can finish in either order,
   * and an unsequenced `setCrisprCopy` leaves the earlier click's report on screen as the answer to
   * the later one. Only the newest click reports.
   */
  const crisprCopyClick = useRef(0);

  /**
   * Writes `text` to the clipboard and reports what really happened. A build with no clipboard at
   * all and a clipboard that refused the write are told apart (LC-006), and neither is ever
   * reported as a copy.
   *
   * A `writeText` that resolved is not a write that landed: a clipboard can accept the call and
   * keep its own contents, and reporting the resolve as proof claimed a copy the page never made
   * (BG-01M7EZVV AC4). Where the build lets the page read the clipboard back, the write is
   * confirmed against what the clipboard now holds; where it does not, the panel says so instead.
   */
  const copyCrisprText = async (what: string, text: string): Promise<void> => {
    const click = (crisprCopyClick.current += 1);
    /** Reports one outcome of this click, unless a later click has already started. */
    const report = (
      outcome: 'copied' | 'unconfirmed' | 'not-copied',
      detail: string,
      notice: string
    ): void => {
      if (click !== crisprCopyClick.current) return;
      setCrisprCopy({ outcome, detail, text });
      onStatusNotice?.(notice);
    };
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      report(
        'not-copied',
        `${what} was not written: this build provides no clipboard to write to. ${COPY_BY_HAND}`,
        `Nothing was copied: ${what} was not written, because this build provides no clipboard; the text is shown in the CRISPR tab to take by hand.`
      );
      return;
    }
    try {
      await clipboard.writeText(text);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      report(
        'not-copied',
        `${what} was not written: the clipboard refused it (${why}). ${COPY_BY_HAND}`,
        `Nothing was copied: ${what} was not written, because the clipboard refused it (${why}); the text is shown in the CRISPR tab to take by hand.`
      );
      return;
    }
    // What the clipboard holds now, where the build permits the page to ask; `undefined` is "the
    // page cannot tell", which is not "the clipboard is empty" and is never read as either
    // outcome (LC-006).
    let onClipboard: string | undefined;
    if (typeof clipboard.readText === 'function') {
      try {
        onClipboard = await clipboard.readText();
      } catch {
        onClipboard = undefined;
      }
    }
    if (onClipboard === text) {
      report(
        'copied',
        `${what} is on the clipboard, read back from it.`,
        `Copied ${what} to the clipboard.`
      );
      return;
    }
    if (onClipboard === undefined) {
      report(
        'unconfirmed',
        `${what} was handed to the clipboard and the write was not refused, but this build does not let the page read the clipboard back, so the page cannot confirm the copy. ${COPY_BY_HAND}`,
        `Copy not confirmed: ${what} was handed to the clipboard, but this build does not let the page read the clipboard back to confirm it; the text is shown in the CRISPR tab to take by hand.`
      );
      return;
    }
    report(
      'not-copied',
      `${what} was not written: the clipboard took the write without refusing it and then held other text. ${COPY_BY_HAND}`,
      `Nothing was copied: ${what} was not written, because the clipboard took the write without refusing it and then held other text; the text is shown in the CRISPR tab to take by hand.`
    );
  };

  const saveToPrimerDatabase = (candidate: DatabasePrimerInput, opener: HTMLElement) => {
    setDbSaveMessage(null);
    // The Save button: focus returns to it when a duplicate panel closes (BG-01M7DVJJ).
    dbSave.save(candidate, opener);
  };
  /** A designed primer as ordered: the whole oligo 5'->3', tail included, the tail kept apart. */
  const designedPrimerCandidate = (prm: PrimerRecord): DatabasePrimerInput => ({
    name: prm.name,
    sequence: prm.sequence,
    molecule: 'DNA',
    tail5Prime: prm.tail5Prime,
    description: '',
    labels: [],
    provenance: `Designed in Primer & PCR Studio on ${doc.name} (document ${doc.id}): ${
      prm.strand === 1 ? 'forward' : 'reverse'
    } primer ${prm.name} for the design region ${regionStart}..${regionEnd}`,
  });
  const documentPrimerCandidate = (p: PrimerRecord): DatabasePrimerInput => ({
    name: p.name,
    sequence: p.sequence,
    molecule: 'DNA',
    tail5Prime: p.tail5Prime ?? '',
    description: p.notes ?? '',
    labels: [],
    provenance: `Primer ${p.name} on ${doc.name} (document ${doc.id}), binding ${p.bindStart}..${p.bindEnd}`,
  });

  /**
   * One guide as the two features it is annotated as (US-01M7DVA6 AC4): the spacer and its PAM over
   * their own spans, taken from `crisprGuideParts` once. Both the row's Annotate and `+ Annotate Top
   * 5 Guides` write this, so one document holds one shape of `crispr_guide` annotation however it
   * was made (BG-01M7EQAA AC2). Neither span is clipped to the range the scan searched: a guide
   * whose PAM lies outside a selected interval is annotated over its whole site (AC3).
   *
   * Each call takes its own serial number, so the two ids it writes are unique however fast the
   * annotation is repeated (BG01M7EXRW AC3) - `stamp` says when, the serial says which.
   */
  const crisprGuideAnnotation = (g: CrisprScanGuide, stamp: number) => {
    const parts = crisprGuideParts(g, doc.sequence.length);
    const serial = nextCrisprAnnotationSerial();
    const cutWords = `Cut @ ${g.cutPosition}${
      g.cutPositionTargetStrand !== undefined
        ? `, target strand @ ${g.cutPositionTargetStrand}`
        : g.cutPositionTargetStrandNote
        ? `, target strand: ${g.cutPositionTargetStrandNote}`
        : ''
    }`;
    const shared = (part: 'spacer' | 'PAM'): Pick<SequenceFeature, 'type' | 'strand' | 'qualifiers'> => ({
      type: 'crispr_guide',
      strand: g.strand,
      qualifiers: {
        guide_name: g.name,
        guide_part: part,
        nuclease: g.nuclease,
        pam_side: g.pamSide,
        spacer_span: `${parts.spacer.start}..${parts.spacer.end}`,
        pam_span: `${parts.pam.start}..${parts.pam.end}`,
        cut_position: String(g.cutPosition),
      },
    });
    const newFeats: SequenceFeature[] = [
      {
        ...shared('spacer'),
        id: `feat-${g.id}-spacer-${stamp}-${serial}`,
        name: `${g.name} spacer`,
        start: parts.spacer.start,
        end: parts.spacer.end,
        color: g.onTargetScore >= 70 ? '#16a34a' : g.onTargetScore >= 50 ? '#d97706' : '#dc2626',
        notes: `${g.nuclease} spacer ${g.spacerSeq} (${g.strand === 1 ? 'forward' : 'reverse'} strand) | ${cutWords} | seed counted: ${crisprSeedNoteWords} | Heuristic=${g.onTargetScore}, seed matches=${g.offTargetCount}, ${crisprSeedScopeWords}`,
      },
      {
        ...shared('PAM'),
        id: `feat-${g.id}-pam-${stamp}-${serial}`,
        name: `${g.name} PAM (${g.pamSeq})`,
        start: parts.pam.start,
        end: parts.pam.end,
        color: '#64748b',
        notes: `${g.nuclease} ${g.pamSide} PAM ${g.pamSeq} of ${g.name} (${g.strand === 1 ? 'forward' : 'reverse'} strand): read by the nuclease, not part of the spacer ordered | ${cutWords}`,
      },
    ];
    return { parts, features: newFeats };
  };

  /**
   * Annotate one guide (US-01M7DVA6 AC4): its spacer and its PAM written in one `onUpdateDocument`
   * call and so in one undoable step - a single undo takes both away, never the spacer alone.
   */
  const handleAnnotateCrisprGuide = (g: CrisprScanGuide) => {
    const { parts, features } = crisprGuideAnnotation(g, Date.now());
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...features],
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Annotated CRISPR guide "${g.name}" on "${doc.name}": spacer ${parts.spacer.start.toLocaleString()}..${parts.spacer.end.toLocaleString()} and ${g.pamSide} PAM ${parts.pam.start.toLocaleString()}..${parts.pam.end.toLocaleString()} bp, DSB @ ${g.cutPosition.toLocaleString()} bp`
    );
  };

  /**
   * The top five guides annotated at once: each as the same spacer feature and PAM feature the row's
   * own Annotate writes (BG-01M7EQAA AC2), in one undoable step.
   */
  const handleAnnotateTop5Crispr = () => {
    const stamp = Date.now();
    const annotated = crisprGuides.slice(0, 5);
    const top5: SequenceFeature[] = annotated.flatMap((g) => crisprGuideAnnotation(g, stamp).features);
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...top5],
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Annotated top ${annotated.length} CRISPR guides onto "${doc.name}", each as its spacer and its PAM`
    );
  };

  const handleCreateAmpliconDocument = () => {
    const ampDoc: SequenceDocument = {
      id: `doc-pcr-${Date.now()}`,
      name: `PCR_${doc.name}_${regionStart}_${regionEnd}`,
      accession: `MBC_PCR_${regionStart}`,
      description: `In silico PCR amplicon (${designedPCR.ampliconLength} bp) amplified from ${doc.name} (${regionStart}..${regionEnd}) using ${designedPCR.forward.name} and ${designedPCR.reverse.name}.`,
      moleculeType: 'DNA',
      topology: 'linear',
      sequence: designedPCR.ampliconSeq,
      folder: 'Cloning Inserts & PCR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      features: [
        {
          id: `f-amp-${Date.now()}`,
          name: `Amplified Target (${regionStart}..${regionEnd})`,
          type: 'CDS',
          start: fwdTailSeq.length + 1,
          end: designedPCR.ampliconLength - revTailSeq.length,
          strand: 1,
          color: '#10b981',
        },
      ],
      primers: [designedPCR.forward, designedPCR.reverse],
      history: [
        ...doc.history,
        {
          id: `h-pcr-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: `In Silico PCR Amplification`,
          description: `Amplified ${designedPCR.ampliconLength} bp product (${regionStart}..${regionEnd}) with 5' ${fwdTailEnz}/${revTailEnz} adapter tails`,
          parentIds: [doc.id],
          lengthBp: designedPCR.ampliconLength,
          topology: 'linear',
        },
      ],
    };
    onAddConstruct(ampDoc);
    onStatusNotice?.(
      `Amplified "${ampDoc.name}" (${designedPCR.ampliconLength.toLocaleString()} bp) and saved to workspace`
    );
  };

  // ─── The settings each sub-tab offers, drawn in App's inspector or in the card they sit in ───

  const targetTmField = (
    <label className="form-field">
      <span>Target Annealing Tm (°C):</span>
      <input
        type="number"
        min={45}
        max={75}
        step={0.5}
        value={targetTm}
        onChange={(e) => setTargetTm(Number(e.target.value))}
      />
    </label>
  );

  // The tails keep their progressive details and its summary line, which says what the pair carries.
  const adapterTailsDetails = (
    <details className="mbc-progressive-details">
      <summary className="mbc-progressive-summary">
        <span>5&apos; Cloning Adapter Tails (Optional)</span>
        <span className="mbc-progressive-summary-meta">
          {fwdTailEnz === 'None' && revTailEnz === 'None'
            ? 'Blunt / Direct PCR'
            : `5' ${fwdTailEnz} / ${revTailEnz}${includeClampTail ? ' + 3-nt leader' : ''}`}
        </span>
      </summary>
      <div className="form-grid-3col" style={{ marginTop: 8 }}>
        <label className="form-field">
          <span>5&apos; Forward Enzyme Tail:</span>
          <select value={fwdTailEnz} onChange={(e) => setFwdTailEnz(e.target.value)}>
            <option value="None">None (Blunt PCR)</option>
            {REBASE_ENZYMES.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq})
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>5&apos; Reverse Enzyme Tail:</span>
          <select value={revTailEnz} onChange={(e) => setRevTailEnz(e.target.value)}>
            <option value="None">None (Blunt PCR)</option>
            {REBASE_ENZYMES.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq})
              </option>
            ))}
          </select>
        </label>
        <label className="form-field checkbox-centered">
          <input
            type="checkbox"
            checked={includeClampTail}
            onChange={(e) => setIncludeClampTail(e.target.checked)}
          />
          Add 3-nt 5&apos; Cleavage Leader (GCG)
        </label>
      </div>
    </details>
  );

  /**
   * The oligo calculator's buffer: it corrects the custom oligo's Tm only. `designPCRPrimers` is
   * never handed these, so the inspector section says whose conditions they are.
   */
  const bufferGrid = (
    <div className="form-grid-3col" style={{ marginTop: 8 }}>
      <label className="form-field">
        <span>[Na⁺ / K⁺] (mM):</span>
        <input
          type="number"
          value={naMm}
          onChange={(e) => setNaMm(Number(e.target.value))}
        />
      </label>
      <label className="form-field">
        <span>[Mg²⁺] (mM):</span>
        <input
          type="number"
          step={0.1}
          value={mgMm}
          onChange={(e) => setMgMm(Number(e.target.value))}
        />
      </label>
      <label className="form-field">
        <span>[Primer] (nM):</span>
        <input
          type="number"
          value={primerNm}
          onChange={(e) => setPrimerNm(Number(e.target.value))}
        />
      </label>
    </div>
  );

  const mismatchSelect = (
    <select
      value={maxAllowedMismatches}
      onChange={(e) => setMaxAllowedMismatches(Number(e.target.value))}
    >
      <option value={0}>0 (Exact 100% Match Only)</option>
      <option value={1}>Up to 1 Mismatch</option>
      <option value={2}>Up to 2 Mismatches</option>
      <option value={3}>Up to 3 Mismatches</option>
    </select>
  );
  const MISMATCH_LABEL = "Max 5' Mismatches Allowed (3' 5-nt Clamp Required):";

  /** How a preset's site reads, 5' -> 3': the PAM on its own side of the spacer. */
  const presetSiteText = (n: { pamSide: string; pamPattern: string; spacerLengthBp: number }) =>
    n.pamSide === "5'"
      ? `5'-${n.pamPattern}-N${n.spacerLengthBp}-3'`
      : `5'-N${n.spacerLengthBp}-${n.pamPattern}-3'`;
  const nucleaseSelect = (
    <>
      <select
        aria-label="Nuclease / PAM:"
        value={crisprNuclease}
        onChange={(e) => setCrisprNuclease(e.target.value)}
      >
        {nucleasePresets.map((n) => (
          <option key={n.id} value={n.id}>
            {`${n.id} — ${presetSiteText(n)} (${n.pamSide} PAM, ${n.spacerLengthBp}-nt spacer, ${n.siteSpanBp}-bp site)`}
          </option>
        ))}
      </select>
      {chosenPreset && (
        <span className="mbc-opdlg-muted" data-nuclease-facts={chosenPreset.id}>
          {`PAM ${chosenPreset.pamPattern} on the ${chosenPreset.pamSide} side, ${chosenPreset.spacerLengthBp}-nt spacer, ${chosenPreset.siteSpanBp}-bp site. ${chosenPreset.cutConvention}`}
        </span>
      )}
    </>
  );
  // What the scan may be asked to search (US-01M7DVAS AC1): the interval on screen, where the
  // selection is one that can be searched, and the whole sequence — which is all that is offered
  // when there is no such selection, with the reason beside it.
  const searchRangeSelect = (
    <>
      <select
        aria-label="Search range:"
        value={crisprScope}
        onChange={(e) => setCrisprScopeChoice(e.target.value === 'interval' ? 'interval' : 'whole')}
      >
        {crisprRangeOffer.interval && (
          <option value="interval">
            {`The selected interval ${bp(crisprRangeOffer.interval.start)}..${bp(crisprRangeOffer.interval.end)} (${bp(crisprRangeOffer.interval.lengthBp)} bp${crisprRangeOffer.interval.crossesOrigin ? ', across the origin' : ''})`}
          </option>
        )}
        <option value="whole">
          {`The whole sequence (${bp(doc.sequence.length)} bp${doc.topology === 'circular' ? ', circular' : ''})`}
        </option>
      </select>
      {crisprRangeOffer.note && (
        <span className="mbc-opdlg-muted" data-crispr-range-note="">
          {crisprRangeOffer.note}
        </span>
      )}
    </>
  );

  return (
    <div className="alignment-studio-wrapper">
      <div className="studio-card-header" style={{ marginBottom: 8 }}>
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Primer and CRISPR Tools"
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide primer tools left"
          nextAriaLabel="Slide primer tools right"
        >
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'design' ? 0 : -1}
            aria-selected={subTab === 'design'}
            className={`method-tab-btn ${subTab === 'design' ? 'active' : ''}`}
            onClick={() => setSubTab('design')}
          >
            <MolBioMenuGlyph glyph="primer-design" size={13} />
            <span>Design New Primers &amp; Oligo Biophysics</span>
          </button>
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'saved' ? 0 : -1}
            aria-selected={subTab === 'saved'}
            className={`method-tab-btn ${subTab === 'saved' ? 'active' : ''}`}
            onClick={() => setSubTab('saved')}
          >
            <MolBioMenuGlyph glyph="primer-map" size={13} />
            <span>Test with Saved Primers ({savedPrimerHits.length} Binding Sites)</span>
          </button>
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'crispr' ? 0 : -1}
            aria-selected={subTab === 'crispr'}
            className={`method-tab-btn ${subTab === 'crispr' ? 'active' : ''}`}
            onClick={() => setSubTab('crispr')}
          >
            <MolBioMenuGlyph glyph="crispr-cas9" size={13} />
            <span>Find CRISPR Sites &amp; Off-Targets ({crisprTabCount})</span>
          </button>
        </ScrollableMenuStrip>
      </div>

      {subTab === 'design' && (
        <div className="studio-split-grid">
          {inWorkbench && (
            <>
              <InspectorSection title="Primer Design" order={1}>
                {targetTmField}
                {adapterTailsDetails}
              </InspectorSection>
              <InspectorSection title={'Oligo Calculator: Buffer & Ionic Conditions'} order={2}>
                {bufferGrid}
              </InspectorSection>
            </>
          )}
          {/* Automated Primer Design & PCR Simulator */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>PCR Primer Design &amp; Amplicon Simulator</h3>
              <span className="badge-accent">SantaLucia 1998 Nearest-Neighbor</span>
            </div>

            {/* The target region stays with the pair it amplifies; in the workbench the Tm that
                designs it sits in the inspector, and the row is the two fields it then holds. */}
            <div className={inWorkbench ? 'form-grid-2col' : 'form-grid-3col'}>
              <label className="form-field">
                <span>Target Start (bp):</span>
                <input
                  type="number"
                  min={1}
                  max={doc.sequence.length}
                  value={regionStart}
                  onChange={(e) => setRegionStart(Number(e.target.value))}
                />
              </label>
              <label className="form-field">
                <span>Target End (bp):</span>
                <input
                  type="number"
                  min={1}
                  max={doc.sequence.length}
                  value={regionEnd}
                  onChange={(e) => setRegionEnd(Number(e.target.value))}
                />
              </label>
              {!inWorkbench && targetTmField}
            </div>

            {!inWorkbench && adapterTailsDetails}

            {/* Designed Forward & Reverse Primer Cards */}
            <div className="primer-pair-cards">
              {[designedPCR.forward, designedPCR.reverse].map((prm) => (
                <div key={prm.id} className="primer-detail-card">
                  <div className="primer-card-top">
                    <strong>
                      {prm.strand === 1 ? 'Forward Primer:' : 'Reverse Primer:'} {prm.name}
                    </strong>
                    <span className="tm-pill">
                      Anneal {primerTmText(prm)} | Full {primerTmText(prm, { full: true })}
                    </span>
                  </div>
                  <div className="primer-seq-display">
                    5&apos;-
                    {prm.tail5Prime && <span className="tail-highlight">{prm.tail5Prime}</span>}
                    <span>{prm.annealSequence}</span>-3&apos;
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Save ${prm.name} to Primer Database`}
                    onClick={(e) => saveToPrimerDatabase(designedPrimerCandidate(prm), e.currentTarget)}
                  >
                    Save to Primer Database
                  </button>
                  <div className="primer-metrics-strip">
                    <span>Length: {prm.length} nt</span>
                    <span>GC: {prm.gcPercent}%</span>
                    <span>ΔG°37: {prm.deltaG37} kcal/mol</span>
                    <span>Hairpin ΔG: {prm.hairpinDeltaG} kcal/mol</span>
                    <span>Self-Dimer ΔG: {prm.selfDimerDeltaG} kcal/mol</span>
                    <span className={prm.gcClamp3Prime ? 'ok-tag' : 'warn-tag'}>
                      3&apos; GC Clamp: {prm.gcClamp3Prime ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {dbSave.panel}
            {dbSaveMessage && <p role="status">{dbSaveMessage}</p>}

            <div className="cloning-action-row">
              <button className="btn-primary" disabled={!pcrRegionValid} onClick={handleSavePrimersToDoc}>
                + Bind Primer Pair to {doc.name}
              </button>
              <button
                className="btn-success"
                disabled={!pcrRegionValid}
                title={pcrRegionValid ? undefined : 'Choose a target region inside the sequence (start before end, at least 40 bp)'}
                onClick={handleCreateAmpliconDocument}
              >
                Amplify &amp; Save {designedPCR.ampliconLength} bp PCR Product to Workspace
              </button>
            </div>
          </div>

          {/* Interactive Oligo Thermodynamics & Existing Primers Table */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Oligo Biophysics &amp; Secondary Structure Calculator</h3>
              <span className="badge-accent">Owczarzy Mg²⁺ / Na⁺ Salt Correction</span>
            </div>

            <label className="form-field">
              <span>Enter Custom Oligonucleotide Sequence (5&apos; → 3&apos;):</span>
              <input
                type="text"
                value={customOligo}
                onChange={(e) => setCustomOligo(e.target.value.toUpperCase())}
                className="mono-input"
              />
            </label>

            {!inWorkbench && (
              <details className="mbc-progressive-details">
                <summary className="mbc-progressive-summary">
                  <span>Buffer &amp; Ionic Conditions</span>
                  <span className="mbc-progressive-summary-meta">
                    {naMm} mM Na⁺ · {mgMm} mM Mg²⁺ · {primerNm} nM Oligo
                  </span>
                </summary>
                {bufferGrid}
              </details>
            )}

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Salt-Corrected Tm</span>
                {/* An oligo holding N has no Tm: the engine's reason reads in its place (BG-01M6SHQ0). */}
                {customMetrics.tmNoAnswerReason ? (
                  <>
                    <strong className="kpi-val">n/a</strong>
                    <span className="kpi-label">{customMetrics.tmNoAnswerReason}</span>
                  </>
                ) : (
                  <strong className="kpi-val">{customMetrics.tmC} °C</strong>
                )}
              </div>
              <div className="kpi-box">
                <span className="kpi-label">GC Content</span>
                <strong className="kpi-val">{customMetrics.gcPercent}%</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Duplex ΔG°₃₇</span>
                <strong className="kpi-val">{customMetrics.deltaG37} kcal/mol</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Hairpin / Dimer ΔG</span>
                <strong className="kpi-val">
                  {customMetrics.hairpinDeltaG} / {customMetrics.selfDimerDeltaG}
                </strong>
              </div>
            </div>

            <h4 className="sub-heading">Cataloged Primers &amp; Binding Specificity on {doc.name}</h4>
            <WorkbenchSmartTable
              tableId="primer-studio-cataloged-primers"
              tableLabel="Cataloged Primers and Binding Specificity"
              regionMaxHeight={260}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Primer Name</th>
                  <th>Biophysics</th>
                  <th>Binding</th>
                  <th>Specificity Alert</th>
                  <th>Tm (°C)</th>
                </tr>
              </thead>
              <tbody>
                {doc.primers.map((p) => {
                  // A primer that no longer binds (e.g. after an edit) has 0 sites;
                  // it used to be shown as a green "unique site".
                  const siteCount = docPrimerSiteCounts.get(p.name) ?? 0;
                  const totalSites =
                    siteCount +
                    (doc.topology === 'circular' ? originSpanningSiteCount(p.annealSequence || p.sequence, doc.sequence) : 0);
                  const siteStatus = primerSiteStatus(
                    p.annealSequence || p.sequence,
                    doc.sequence,
                    doc.topology === 'circular',
                    siteCount
                  );
                  const mwDa = (p.length * 303.7 + 79.0).toFixed(1);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="mono-cell" style={{ fontSize: 11, opacity: 0.85 }}>
                          5&apos;-{p.sequence}-3&apos;
                        </div>
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          aria-label={`Save ${p.name} to Primer Database`}
                          onClick={(e) => saveToPrimerDatabase(documentPrimerCandidate(p), e.currentTarget)}
                        >
                          Save to Primer Database
                        </button>
                      </td>
                      <td>
                        {p.length}-mer &middot; {p.gcPercent}% GC &middot; {mwDa} Da
                      </td>
                      <td>
                        {onJumpToCoordinate ? (
                          <button
                            type="button"
                            className="mbc-coord-jump-btn"
                            title={`Jump to ${p.name} binding site (${p.bindStart}..${p.bindEnd} bp) in Sequence view`}
                            onClick={() =>
                              onJumpToCoordinate(p.bindStart, p.bindEnd, p.name)
                            }
                          >
                            {p.bindStart}..{p.bindEnd} ({p.strand === 1 ? '→' : '←'})
                          </button>
                        ) : (
                          <>
                            {p.bindStart}..{p.bindEnd} ({p.strand === 1 ? '→' : '←'})
                          </>
                        )}
                      </td>
                      <td>
                        {siteStatus === 'not-checked' ? (
                          <span
                            style={{ opacity: 0.75, fontSize: 11 }}
                            title="The binding check covers ACGT anneal regions of 12 nt or more that do not span the origin; this primer is outside that scope."
                          >
                            Binding not checked (short, degenerate or origin-spanning)
                          </span>
                        ) : siteStatus === 'none' ? (
                          <span className="warn-tag">⚠ No binding site (≤ 1 mismatch) in this sequence</span>
                        ) : siteStatus === 'multiple' ? (
                          <span className="warn-tag">
                            ⚠ Primer has {totalSites} binding sites
                          </span>
                        ) : (
                          <span className="ok-tag">✓ Unique site (1)</span>
                        )}
                      </td>
                      <td>
                        <strong>{primerTmText(p, { prefix: false })}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {subTab === 'saved' && (
        <div className="studio-card">
          {inWorkbench && (
            <InspectorSection title="Saved Primer Screening" order={1}>
              <label className="form-field">
                <span>{MISMATCH_LABEL}</span>
                {mismatchSelect}
              </label>
            </InspectorSection>
          )}
          <div className="studio-card-header">
            <h3>
              Test with Saved Primers — Screening {savedPrimerCatalog.length} Primers ({databaseCatalog.candidates.length} from the
              Primer Database, {documentPrimerCatalog.length} from documents) against {doc.name}
            </h3>
            {!inWorkbench && (
              <div className="gel-controls-inline">
                <label>
                  {MISMATCH_LABEL} {mismatchSelect}
                </label>
              </div>
            )}
          </div>

          <div className="info-callout">
            <strong>
              Primers{' '}
              <ChevronRight
                size={13}
                strokeWidth={2.4}
                className="mbc-inline-chevron"
                aria-hidden="true"
              />{' '}
              Test with Saved Primers
            </strong>{' '}
            screens your primer collection for binding sites on both strands of <strong>{doc.name}</strong> ({doc.sequence.length.toLocaleString()} bp) requiring a 3&apos; pentamer clamp.
            <div className="mbc-opdlg-muted" data-match-settings="">{primerMatchSettingsText(maxAllowedMismatches)}</div>
          </div>
          {databaseCatalog.error && (
            <div className="info-callout" role="alert">
              {databaseCatalog.error}
            </div>
          )}
          {savedPrimerSearch.notSearched.length > 0 && (
            <ul className="info-callout" aria-label="Primers not searched">
              {savedPrimerSearch.notSearched.map(({ candidate, reason }) => (
                <li key={candidate.key}>
                  <strong>{candidate.name}</strong> ({candidate.sourceLabel}): {reason}
                </li>
              ))}
            </ul>
          )}

          <WorkbenchSmartTable
            tableId="primer-studio-saved-screening"
            tableLabel="Saved Primer Screening Hits"
            className="bio-table"
          >
            <thead>
              <tr>
                <th>Primer Name</th>
                <th>Source</th>
                <th>Sequence (5&apos;→3&apos;)</th>
                <th>Strand</th>
                <th>Binding Coordinates</th>
                <th>Mismatches</th>
                <th>Effective Tm (°C)</th>
              </tr>
            </thead>
            <tbody>
              {savedPrimerHits.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    No searched primer bound within {maxAllowedMismatches} mismatches{savedPrimerSearch.notSearched.length ? ' (the primers listed as not searched were not looked for)' : ''}. Try increasing mismatch tolerance or designing new primers.
                  </td>
                </tr>
              ) : (
                savedPrimerHits.map((hit) => (
                  <tr key={hit.key} data-primer-key={hit.candidate.key}>
                    <td>
                      <strong>{hit.candidate.name}</strong>
                    </td>
                    <td>{hit.candidate.sourceLabel}</td>
                    <td className="mono-cell">{hit.candidate.record.sequence}</td>
                    <td>{hit.strand === 1 ? 'Forward (+)' : 'Reverse (-)'}</td>
                    <td>
                      {onJumpToCoordinate ? (
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          title={`Jump to ${hit.candidate.name} (${hit.bindStart}..${hit.bindEnd} bp) in Sequence view`}
                          onClick={() =>
                            onJumpToCoordinate(hit.bindStart, hit.bindEnd, hit.candidate.name)
                          }
                        >
                          {hit.bindStart}..{hit.bindEnd}
                        </button>
                      ) : (
                        <>
                          {hit.bindStart}..{hit.bindEnd}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={hit.mismatches === 0 ? 'ok-tag' : 'warn-tag'}>
                        {hit.mismatches} mm
                      </span>
                    </td>
                    <td>{hit.effectiveTmC === null ? `n/a: ${hit.tmUnavailableReason}` : `${hit.effectiveTmC} °C`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}

      {subTab === 'crispr' && (
        <div className="studio-card">
          {inWorkbench && (
            <InspectorSection title="CRISPR Guides" order={1}>
              <label className="form-field">
                <span>Nuclease / PAM:</span>
                {nucleaseSelect}
              </label>
              <label className="form-field">
                <span>Search range:</span>
                {searchRangeSelect}
              </label>
            </InspectorSection>
          )}
          <div className="studio-card-header">
            <h3>
              CRISPR/Cas Guide Finder &amp; Off-Target Specificity Scorer — {doc.name}
            </h3>
            <div className="cloning-action-row">
              {!inWorkbench && nucleaseSelect}
              {!inWorkbench && searchRangeSelect}
              <button className="btn-success" onClick={handleAnnotateTop5Crispr}>
                + Annotate Top 5 Guides onto {doc.name}
              </button>
            </div>
          </div>

          <div className="info-callout">
            {/* An interval the engine refused was searched not at all, so this line claims no
                range, no candidate count and no seed count for it (US-01M7DVAS AC6). */}
            {crisprIntervalRefusal !== undefined
              ? `No range was searched: ${crisprIntervalRefusal} No guide, range or seed count is claimed here.`
              : crisprCandidates === undefined
              ? `CRISPR scan report unavailable (${crisprResult.reportUnavailableReason ?? 'the engine sent no scan report'}): this tab cannot say how many candidate guides there are, what range was searched, or whether the scan is complete.`
              : crisprCandidates === 0
              ? `No candidate ${crisprNuclease} guide: 0 of the candidates this scan looked for are in ${crisprReadAs}.`
              : crisprCandidates > crisprReturned
              ? `Lists the ${bp(crisprReturned)} highest-scoring of the ${bp(crisprCandidates)} candidate ${crisprNuclease} guides found.`
              : `Lists all ${bp(crisprCandidates)} candidate ${crisprNuclease} guides found.`}{' '}
            {/* What was searched, in the scan's own numbers: the interval, its length, the whole
                sequence's length and the bases outside the interval that were read for a PAM — so
                an interval scan is never read as a scan of the whole sequence (US-01M7DVAS AC4). */}
            {crisprSearchedInterval !== undefined && (
              <>
                <strong>Searched</strong>: {crisprReadAs}.{' '}
                {crisprContextBp > 0
                  ? `${bp(crisprContextBp)} bases outside the interval were read as PAM context only: a candidate whose spacer is inside the interval but whose PAM is not is listed and says so on its own row, and no base of that context was searched for a guide of its own or counted as a seed match.`
                  : 'No base outside the interval was read.'}{' '}
              </>
            )}
            {/* What the seed count counts is a claim about a scan that ran: an absent report makes
                it no claim at all (US-01M7DVH2 AC5). The seed's length is the one the scan
                reports, through `crisprSeedText` in core, which the Top 5 note and the export read
                too (BG-01M7EZVV AC3, BG-01M7FF3B): no sentence in the app declares the number, so
                a change to what the scorer counts changes every surface that states it.
                Which bases were read is `crisprReadAs` on every branch, as the annotation note
                and the export read it (BG-01M7FCDY AC1, BG-01M7FH8K: `crisprScanReadAs` in core): the interval and bounded-prefix branches each wrote a
                frame of their own here - the bounded one a copy of the formatter's own bounded
                wording - so the frame could drift from the note's on one branch with every
                criterion that holds the note green, as the reviewer's M15 did. What is left is only this sentence's own claim:
                what a seed match is, and that a scan of part of the record found no copy in the
                rest of it. */}
            {crisprScan !== undefined && crisprIntervalRefusal === undefined && (
              <>
                <strong>Seed matches</strong>:{' '}
                {`other exact copies of the ${crisprSeedText(crisprScan)} across ${crisprReadAs}${
                  crisprSearchedInterval !== undefined
                    ? `, and no copy outside it — ${crisprIntervalSpecificityText(crisprScan)}`
                    : crisprScanIsPartial
                    ? ', and no copy outside it'
                    : ''
                }`}{' '}
                (no genome-wide off-target search).
              </>
            )}{' '}
            <strong>Genome-wide specificity</strong>: {GENOME_WIDE_NOT_EVALUATED}
          </div>

          {/* The rank's rule, its features and its range in the engine's own words, read from the
              engine (BG-01M7EYED): no weight is written in this app at all, and the engine's
              sentence is held to its scorer by `us_01m7dvvr_ac2` (workbench_table_and_lineage.rs),
              so a weight change cannot leave this surface — the one a researcher reads — stating
              the old rule with every test green.
              It is a callout of its own because it is a constant statement about the rank and not
              a claim about this scan: the sentence names what orders the list, and the callout
              above claims nothing about a scan whose report the engine did not send
              (US-01M7DVH2 AC5). */}
          <div className="info-callout" data-crispr-rank-rule="">
            {crisprRankRule} It is not a trained Doench model.
          </div>

          <ResultWarnings warnings={crisprScan?.warnings} label="CRISPR guide warnings" />

          {/* The last copy, as it went (US-01M7DV5P AC3, BG-01M7EZVV AC4): a copy the environment
              refused says nothing was copied, a write this build cannot confirm says that rather
              than claiming a copy, and either way the text is here to take by hand. */}
          {crisprCopy && (
            <div
              className="info-callout"
              role="status"
              data-crispr-copy-status={crisprCopy.outcome}
            >
              <strong>{CRISPR_COPY_HEADINGS[crisprCopy.outcome]}</strong>: {crisprCopy.detail}
              <pre className="mono-cell" data-crispr-copy-text="">
                {crisprCopy.text}
              </pre>
            </div>
          )}

          <WorkbenchSmartTable
            tableId="primer-studio-crispr-guides"
            tableLabel="CRISPR Guide Candidates Table"
            regionMaxHeight={340}
            className="bio-table"
            selectionSummary={
              crisprSelectedShown > 0
                ? `${bp(crisprSelectedShown)} of ${bp(crisprReturned)} rows selected for export`
                : undefined
            }
            exportTable={crisprExportTable}
          >
            <thead>
              <tr>
                <th>Guide Name</th>
                <th>20-nt Spacer Sequence (5&apos;→3&apos;)</th>
                <th>PAM</th>
                <th>Strand</th>
                <th>Region (Cut Site)</th>
                <th>Nuclease (PAM side)</th>
                <th>GC%</th>
                <th>Heuristic Rank (8–98)</th>
                <th>Exact Seed Matches (range searched)</th>
                <th>Genome-wide Specificity</th>
                <th>Action</th>
                <th title="Tick the guides to export; with none ticked the export writes every row the table shows">
                  Export
                </th>
              </tr>
            </thead>
            <tbody>
              {crisprGuides.map((g) => {
                // The two parts of this guide's site, and what showing it hands the views
                // (US-01M7DVA6): the row's own coordinates, with the spacer and the PAM apart.
                const parts = crisprGuideParts(g, doc.sequence.length);
                const partsWords = `spacer ${guideRange({ ...g, start: parts.spacer.start, end: parts.spacer.end })}, ${g.pamSide} PAM ${guideRange({ ...g, start: parts.pam.start, end: parts.pam.end })}`;
                const showGuide = onJumpToCoordinate
                  ? () =>
                      onJumpToCoordinate(
                        g.start,
                        g.end,
                        `${g.name} (${g.pamSeq})`,
                        crisprGuideHighlight(g, doc.sequence.length)
                      )
                  : undefined;
                return (
                <tr
                  key={g.id}
                  data-crispr-guide-row={g.id}
                  // The id the table hands its export, so the file holds the rows on screen
                  // (US-01M7DV5P AC4).
                  data-mbc-row-id={g.id}
                  className={showGuide ? 'mbc-row-clickable' : undefined}
                  title={
                    showGuide
                      ? `Show ${g.name} in the sequence views: ${partsWords} (DSB @ ${bp(g.cutPosition)})`
                      : undefined
                  }
                  onClick={showGuide}
                >
                  <td>
                    <strong>{g.name}</strong>
                  </td>
                  <td className="mono-cell">{g.spacerSeq}</td>
                  <td className="mono-cell">
                    <strong>{g.pamSeq}</strong>
                    {g.pamAmbiguityNote && (
                      <span title={g.pamAmbiguityNote}>
                        {' '}
                        (ambiguity code, base not read)
                      </span>
                    )}
                    {/* This guide's spacer is inside the interval searched but its PAM is not, so
                        the PAM was read from context outside it (US-01M7DVAS AC2). */}
                    {g.intervalContextNote && (
                      <span title={g.intervalContextNote}>
                        {' '}
                        (PAM outside the interval searched)
                      </span>
                    )}
                  </td>
                  <td>{g.strand === 1 ? 'Forward (+)' : 'Reverse (-)'}</td>
                  <td>
                    {showGuide ? (
                      <button
                        type="button"
                        className="mbc-coord-jump-btn"
                        title={`Show ${g.name} (${guideRange(g)} bp: ${partsWords}, DSB @ ${bp(g.cutPosition)}) in Sequence view`}
                        onClick={(e) => {
                          // The row shows the guide too: one call, not the row's as well.
                          e.stopPropagation();
                          showGuide();
                        }}
                      >
                        {guideRange(g)} (DSB @ {bp(g.cutPosition)})
                      </button>
                    ) : (
                      <>
                        {guideRange(g)} (DSB @ {bp(g.cutPosition)})
                      </>
                    )}
                  </td>
                  <td title={g.cutConvention}>
                    {g.nuclease} ({g.pamSide} PAM)
                    {g.cutPositionTargetStrand !== undefined &&
                      ` — staggered cut, target strand @ ${bp(g.cutPositionTargetStrand)}`}
                    {g.cutPositionTargetStrand === undefined &&
                      g.cutPositionTargetStrandNote &&
                      ` — staggered cut, target strand: ${g.cutPositionTargetStrandNote}`}
                  </td>
                  <td>{g.gcPercent}%</td>
                  <td>
                    <span
                      className="score-heat-pill"
                      style={{
                        background:
                          g.onTargetScore >= 70
                            ? '#dcfce7'
                            : g.onTargetScore >= 50
                            ? '#fef3c7'
                            : '#fee2e2',
                        color:
                          g.onTargetScore >= 70
                            ? '#166534'
                            : g.onTargetScore >= 50
                            ? '#92400e'
                            : '#991b1b',
                      }}
                    >
                      {/* The rank bare, under a column headed with the range the engine states:
                          it is held to that range, not to 100 (BG-01M7E61C). */}
                      {g.onTargetScore}
                    </span>
                  </td>
                  <td>
                    <span
                      className="score-heat-pill"
                      style={{
                        background: g.specificityScore >= 80 ? '#e0f2fe' : '#fef3c7',
                        color: g.specificityScore >= 80 ? '#0369a1' : '#92400e',
                      }}
                    >
                      {g.offTargetCount === 0 ? 'No other seed copy' : `${g.offTargetCount} seed match${g.offTargetCount > 1 ? 'es' : ''}`}
                    </span>
                  </td>
                  <td title={GENOME_WIDE_NOT_EVALUATED}>Not evaluated</td>
                  <td>
                    <button
                      className="btn-secondary-sm"
                      data-crispr-annotate={g.id}
                      title={`Annotate ${g.name} on ${doc.name}: ${partsWords}`}
                      onClick={(e) => {
                        // Annotating is not showing: it leaves the studio where it is.
                        e.stopPropagation();
                        handleAnnotateCrisprGuide(g);
                      }}
                    >
                      + Annotate
                    </button>
                    {/* The spacer alone, as it is ordered (AC1), and the spacer with its PAM
                        labelled in the order this nuclease reads them (AC2). */}
                    <button
                      className="btn-secondary-sm"
                      data-crispr-copy-spacer={g.id}
                      title={`Copy the ${bp(g.spacerSeq.length)}-nt spacer of ${g.name} alone, 5'→3', with no PAM and no label`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyCrisprText(
                          `the spacer of ${g.name} (${bp(g.spacerSeq.length)} nt)`,
                          crisprSpacerCopyText(g)
                        );
                      }}
                    >
                      Copy spacer
                    </button>
                    <button
                      className="btn-secondary-sm"
                      data-crispr-copy-spacer-pam={g.id}
                      title={`Copy the spacer of ${g.name} and its ${g.pamSide} PAM, each labelled and marked 5'→3', in the order ${g.nuclease} reads them`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyCrisprText(
                          `the spacer and ${g.pamSide} PAM of ${g.name}, labelled`,
                          crisprSpacerAndPamCopyText(g)
                        );
                      }}
                    >
                      Copy spacer + PAM
                    </button>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      data-crispr-select={g.id}
                      aria-label={`Select ${g.name} for export`}
                      checked={crisprSelected.has(g.id)}
                      // Ticking a row is not showing it: the row's own click stays where it is.
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setCrisprSelectedIds((prev) =>
                          on ? [...prev.filter((id) => id !== g.id), g.id] : prev.filter((id) => id !== g.id)
                        );
                      }}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}
    </div>
  );
};
