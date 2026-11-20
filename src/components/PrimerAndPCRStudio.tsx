// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  CrisprGuideRecord,
  PrimerRecord,
  RestrictionEnzyme,
  SequenceDocument,
  SequenceFeature,
} from '../types/bio';
import { intervalLength } from '../core/activeInterval';
import {
  calculatePrimerMetrics,
  databasePrimerCandidate,
  designPCRPrimers,
  documentPrimerCandidate as screeningCandidateOf,
  CUSTOM_ENZYME_NO_LONGER_STORED,
  enzymeLabel,
  crisprNucleasePresets,
  scanCrisprGuidesAsync,
  findPrimerBindings,
  primerMatchSettingsText,
  testSavedPrimersOnSequence,
  type CrisprNucleasePreset,
  type CrisprScanGuide,
  type CrisprScanReport,
  type CrisprScanResult,
} from '../core/bioEngine';
import { enzymeKey, sequenceRevision } from '../core/restrictionDisplay';
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
import { savePlatformFile, usePrimerDatabaseSave, type PlatformSaveResult } from './PrimerDatabaseWindow';
import { openGuideSetDatabase, type GuideSet, type GuideSetList } from '../core/guideSetDatabase';

/** What a guide set export reports: "Exported" only for a file the platform says it wrote. */
function describeGuideSetExport(result: PlatformSaveResult, filename: string): { ok: boolean; text: string } {
  switch (result.kind) {
    case 'saved':
      return { ok: true, text: `Exported the saved guide sets to ${result.where}.` };
    case 'cancelled':
      return { ok: true, text: 'Export cancelled: no file was saved.' };
    case 'unconfirmed':
      return result.how === 'downloaded'
        ? { ok: true, text: `Export: handed to your browser to download as ${filename}; the browser does not say whether it was kept.` }
        : { ok: true, text: `Export: sent to the save dialog as ${filename}; this build is not told whether it was saved.` };
    case 'failed':
      return { ok: false, text: `Export failed: ${result.message}. No file was saved.` };
    default:
      return { ok: false, text: 'Export is not possible here: this build has no save path.' };
  }
}

/** How many of the candidate guides the CRISPR tab lists. */
const CRISPR_GUIDES_LISTED = 25;

/**
 * The guide table's score column headings, read by the table and by a saved guide set
 * (US-01M7DVFD), so a set records the names the scores were shown under when it was saved. The
 * seed-match specificity has no column of its own: it shades the seed-match cell.
 */
const CRISPR_SCORE_COLUMNS = {
  onTargetScore: 'Heuristic Rank (8–98)',
  offTargetCount: 'Exact Seed Matches (range searched)',
} as const;

/** The score names a saved guide set records, from the table's own headings. */
const CRISPR_SCORE_NAMES = {
  onTargetScore: CRISPR_SCORE_COLUMNS.onTargetScore,
  specificityScore: CRISPR_SCORE_COLUMNS.offTargetCount,
  offTargetCount: CRISPR_SCORE_COLUMNS.offTargetCount,
};

/** The preset fields a saved set's rerun needs unchanged (US-01M7DVDF AC4), in the order they are named. */
const CRISPR_PRESET_FIELDS = ['id', 'pamSide', 'pamPattern', 'spacerLengthBp', 'siteSpanBp', 'cutConvention'] as const;

/** An interval a CRISPR search may be asked for: 1-based bounds, `start > end` across the origin. */
type CrisprInterval = { start: number; end: number; lengthBp: number; crossesOrigin: boolean };

/**
 * One CRISPR search as it was asked for (US-01M7DVJK): its name, the document and the sequence
 * revision it ran on, and the nuclease, scope and topology it ran with. A result is read through the
 * run it came from, so its words never follow the tab's current chooser (AC6).
 */
interface CrisprRun {
  serial: number;
  name: string;
  docId: string;
  docName: string;
  revision: string;
  topology: 'circular' | 'linear';
  nuclease: string;
  preset?: CrisprNucleasePreset;
  interval: CrisprInterval | null;
  /** The bases the engine was asked to search: the interval's own length, or the sequence's. */
  askedBp: number;
  /** ISO 8601 time Run was pressed, which a saved guide set records (US-01M7DVFD). */
  ranAt: string;
  /** The saved guide set this run reruns (US-01M7DVDF AC4): its completed reply is written over it. */
  rerunOf?: string;
}

/**
 * What a saved set's Rerun asks the Run path for (US-01M7DVDF AC4): the set's own name, nuclease
 * preset, interval and result cap, so nothing in it is read from the tab's chooser or scope.
 */
interface CrisprRerunSpec {
  setId: string;
  name: string;
  preset: CrisprNucleasePreset;
  interval: CrisprInterval | null;
  resultCap: number;
}

/** A search the engine answered with a report and no interval refusal. */
interface CrisprCompletedSearch {
  run: CrisprRun;
  result: CrisprScanResult & { report: CrisprScanReport };
}

/** Where the last search asked for stands. */
type CrisprRunStatus =
  | { phase: 'running' | 'stopped' | 'done'; run: CrisprRun }
  | { phase: 'failed'; run: CrisprRun; refusal?: string; unavailable?: string };

/**
 * The CRISPR searches of this app session (D0172): the last completed result per document id, and
 * where the last search asked for stands. It is held here, outside the component, because the App
 * draws the studio only while its tab is shown, so a guide jump to the Sequence view would otherwise
 * drop a result that took a run to get. It is not kept across a restart.
 */
const crisprSearches: {
  results: Map<string, CrisprCompletedSearch>;
  /**
   * Per document, the scope chosen and the interval held for it (US-01M7DVJK AC5), kept here with
   * the results so an edit made in another view does not drop the bounds the search was set to.
   */
  scopes: Map<string, { choice: 'whole' | 'interval'; held: CrisprInterval | null }>;
  /** The document of the last completed search, which a tab on another document names. */
  lastDocId: string | null;
  status: CrisprRunStatus | null;
  /** The serial of the run whose reply may still be read; Stop and every new Run move it on. */
  serial: number;
  /**
   * What the last change to a saved guide set said (US-01M7DVDF): a rename, a remove, a refused
   * rerun or a rerun's write, by the document it was made on. Kept here because a rerun's reply can
   * come after the studio has unmounted.
   */
  guideSetNotice: { docId: string; ok: boolean; text: string } | null;
  /** Moved on by each rerun write, so the saved-set lists are read from storage again. */
  guideSetWrites: number;
  version: number;
  listeners: Set<() => void>;
} = {
  results: new Map(),
  scopes: new Map(),
  lastDocId: null,
  status: null,
  serial: 0,
  guideSetNotice: null,
  guideSetWrites: 0,
  version: 0,
  listeners: new Set(),
};

const crisprSearchesChanged = () => {
  crisprSearches.version += 1;
  for (const listener of crisprSearches.listeners) listener();
};
const subscribeCrisprSearches = (listener: () => void) => {
  crisprSearches.listeners.add(listener);
  return () => {
    crisprSearches.listeners.delete(listener);
  };
};
const crisprSearchesVersion = () => crisprSearches.version;

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
  /** A panel the studio hosts in place of its tools while shown: folding for a DNA document (US-01M7QC8Q). */
  hostedPanel?: React.ReactNode;
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
  /**
   * Told after every Save to Primer Database that finishes (US-01M7DVZP), so other views of the
   * store, an included Search Project among them, read it again.
   */
  onPrimerDatabaseChanged?: () => void;
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
  /**
   * The active enzyme list the 5' tail pickers offer (BG-01M7DX96): the catalogue, then every stored
   * custom definition, each chosen by its key, so a custom enzyme named like a built-in adds its own
   * motif. The catalogue when not given.
   */
  enzymes?: readonly RestrictionEnzyme[];
}

export const PrimerAndPCRStudio: React.FC<PrimerAndPCRStudioProps> = ({
  hostedPanel,
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
  onPrimerDatabaseChanged,
  selectedRange = null,
  enzymes = REBASE_ENZYMES,
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

  // A tail choice is an enzyme's key (BG-01M7DX96). A key the active list no longer holds (a custom
  // definition discarded with the store) adds no tail at all, never a leader without its site.
  const tailEnzyme = (key: string) => (key === 'None' ? undefined : enzymes.find((e) => enzymeKey(e) === key));
  const fwdTailSeq = useMemo(() => {
    const enz = fwdTailEnz === 'None' ? undefined : enzymes.find((e) => enzymeKey(e) === fwdTailEnz);
    return enz ? (includeClampTail ? 'GCG' : '') + enz.recognitionSeq : '';
  }, [fwdTailEnz, includeClampTail, enzymes]);

  const revTailSeq = useMemo(() => {
    const enz = revTailEnz === 'None' ? undefined : enzymes.find((e) => enzymeKey(e) === revTailEnz);
    return enz ? (includeClampTail ? 'CGC' : '') + enz.recognitionSeq : '';
  }, [revTailEnz, includeClampTail, enzymes]);
  // The label each chosen tail enzyme was last shown with, so one that leaves the list is still named.
  const knownTailLabels = useRef(new Map<string, string>());
  for (const key of [fwdTailEnz, revTailEnz]) {
    const enz = tailEnzyme(key);
    if (enz) knownTailLabels.current.set(key, enzymeLabel(enz));
  }
  // The summary and the History entry name a tail by its label, a custom one marked.
  const tailLabel = (key: string) => {
    const enz = tailEnzyme(key);
    if (enz) return enzymeLabel(enz);
    return key === 'None' ? 'None' : knownTailLabels.current.get(key) ?? CUSTOM_ENZYME_NO_LONGER_STORED;
  };
  // A chosen tail enzyme that leaves the active list is set to None, and the studio says so by name
  // beside the primers (D0005), so the picker, the choice, the summary and the primers agree.
  const [tailNotice, setTailNotice] = useState<string[]>([]);
  useEffect(() => {
    const gone = (key: string) => key !== 'None' && !enzymes.some((e) => enzymeKey(e) === key);
    const sides = new Map<string, string[]>();
    if (gone(fwdTailEnz)) sides.set(tailLabel(fwdTailEnz), ['forward']);
    if (gone(revTailEnz)) sides.set(tailLabel(revTailEnz), [...(sides.get(tailLabel(revTailEnz)) ?? []), 'reverse']);
    if (sides.size === 0) return;
    if (gone(fwdTailEnz)) setFwdTailEnz('None');
    if (gone(revTailEnz)) setRevTailEnz('None');
    setTailNotice([...sides].map(([label, which]) =>
      `${label}, the 5' ${which.join(' and ')} tail enzyme, is no longer stored, so ${which.length > 1 ? 'those tails are' : 'that tail is'} now None (Blunt PCR).`));
    // tailLabel reads the same enzymes and choices this effect runs on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enzymes, fwdTailEnz, revTailEnz]);

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
    onPrimerDatabaseChanged?.();
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
  // Which of the two scopes the search is asked for. A user who selected a span and then asked for
  // CRISPR sites meant that span, so the interval is preferred wherever one is on offer.
  // The searches of this session (D0172), read from the module's store.
  useSyncExternalStore(subscribeCrisprSearches, crisprSearchesVersion, crisprSearchesVersion);
  const crisprScopeState = crisprSearches.scopes.get(doc.id) ?? { choice: 'interval' as const, held: null };
  const crisprScopeChoice = crisprScopeState.choice;
  const setCrisprScopeChoice = (choice: 'whole' | 'interval') => {
    crisprSearches.scopes.set(doc.id, { ...crisprScopeState, choice });
    crisprSearchesChanged();
  };
  // The bounds on offer when the scope was last set to the interval (US-01M7DVJK AC5): the search
  // holds them, so a sequence shortened under them or a record set linear under an origin-crossing
  // interval sends them as chosen and the engine's refusal is reported, rather than the search being
  // widened to the whole sequence on the user's behalf.
  const offered = crisprRangeOffer.interval;
  useEffect(() => {
    const now = crisprSearches.scopes.get(doc.id) ?? { choice: 'interval' as const, held: null };
    if (now.choice !== 'interval' || !offered) return;
    if (now.held && now.held.start === offered.start && now.held.end === offered.end) return;
    crisprSearches.scopes.set(doc.id, { ...now, held: offered });
    crisprSearchesChanged();
  }, [crisprScopeChoice, offered, doc.id]);
  const crisprIntervalAsked: CrisprInterval | null =
    crisprScopeChoice !== 'interval' ? null : offered ?? crisprScopeState.held;
  const crisprScope: 'whole' | 'interval' = crisprIntervalAsked ? 'interval' : 'whole';
  /** The interval held for the search that is no longer on offer as the selection. */
  const crisprHeldOnly = crisprIntervalAsked !== null && crisprRangeOffer.interval === null;

  const docTopology: 'circular' | 'linear' = doc.topology === 'circular' ? 'circular' : 'linear';
  const docRevision = useMemo(() => sequenceRevision(doc.sequence, docTopology), [doc.sequence, docTopology]);
  const crisprStored = crisprSearches.results.get(doc.id);
  // A result belongs to the document and the sequence revision it ran on (US-01M7DVJK AC6): it is
  // shown only while both are the active document's.
  const crisprShown = crisprStored && crisprStored.run.revision === docRevision ? crisprStored : undefined;
  const crisprWithdrawn: { why: 'earlier-sequence' | 'other-document'; run: CrisprRun } | null = crisprShown
    ? null
    : crisprStored
    ? { why: 'earlier-sequence', run: crisprStored.run }
    : crisprSearches.lastDocId !== null && crisprSearches.lastDocId !== doc.id
    ? { why: 'other-document', run: crisprSearches.results.get(crisprSearches.lastDocId)!.run }
    : null;
  const crisprStatus = crisprSearches.status;
  /** The search in progress on this document: a run on another one is not offered here. */
  const crisprRunningHere =
    crisprStatus?.phase === 'running' && crisprStatus.run.docId === doc.id ? crisprStatus : null;
  const crisprShownRun = crisprShown?.run;
  /** The last search on this document failed, and nothing it said is a result. */
  const crisprFailed = crisprStatus?.phase === 'failed' && crisprStatus.run.docId === doc.id ? crisprStatus : null;

  const crisprNameDefault = `${doc.name}, ${crisprNuclease}, ${
    crisprIntervalAsked
      ? `bases ${bp(crisprIntervalAsked.start)}..${bp(crisprIntervalAsked.end)}`
      : 'whole sequence'
  }`;
  const [crisprNameDraft, setCrisprNameDraft] = useState<string | null>(null);
  useEffect(() => {
    setCrisprNameDraft(null);
  }, [doc.id]);
  const crisprName = crisprNameDraft !== null && crisprNameDraft.trim() !== '' ? crisprNameDraft.trim() : crisprNameDefault;

  /**
   * The saved guide sets (US-01M7DVFD): a user-local store keyed to a document id and revision,
   * never written into the document. The lists are read again after each change to it.
   */
  const guideSetDb = useMemo(() => openGuideSetDatabase(), []);
  /**
   * Run the search as named (US-01M7DVJK, D0171): one engine call over the whole scope asked for,
   * off the UI thread. Its reply is read only while its serial is the store's: Stop and a later Run
   * each move the serial on, so a reply that comes after either is dropped unread.
   *
   * A saved set's Rerun (US-01M7DVDF AC4) comes through here with its own spec: the set's name,
   * preset, interval and result cap in place of the tab's chooser and scope, the document's current
   * topology, and, once its reply completes, the set rewritten in the store by its id. Without a
   * spec the run is exactly the tab's own.
   */
  const runCrisprSearch = (rerun?: CrisprRerunSpec) => {
    const serial = (crisprSearches.serial += 1);
    const interval = rerun ? rerun.interval : crisprIntervalAsked;
    const nucleaseId = rerun ? rerun.preset.id : crisprNuclease;
    const preset = rerun ? rerun.preset : chosenPreset;
    const run: CrisprRun = {
      serial,
      name: rerun ? rerun.name : crisprName,
      docId: doc.id,
      docName: doc.name,
      revision: docRevision,
      topology: docTopology,
      nuclease: nucleaseId,
      ...(preset ? { preset } : {}),
      interval,
      askedBp: interval ? interval.lengthBp : doc.sequence.length,
      ranAt: new Date().toISOString(),
      ...(rerun ? { rerunOf: rerun.setId } : {}),
    };
    crisprSearches.status = { phase: 'running', run };
    crisprSearchesChanged();
    void scanCrisprGuidesAsync(
      doc.sequence,
      nucleaseId,
      rerun ? rerun.resultCap : CRISPR_GUIDES_LISTED,
      docTopology === 'circular',
      interval ? { start: interval.start, end: interval.end } : null
    ).then((result) => {
      if (crisprSearches.serial !== serial) return;
      const report = result.report;
      if (!report) {
        crisprSearches.status = {
          phase: 'failed',
          run,
          unavailable: result.reportUnavailableReason ?? 'the engine sent no scan report',
        };
      } else if (report.intervalRefusal !== undefined) {
        crisprSearches.status = { phase: 'failed', run, refusal: report.intervalRefusal };
      } else {
        crisprSearches.results.set(run.docId, { run, result: { ...result, report } });
        crisprSearches.lastDocId = run.docId;
        crisprSearches.status = { phase: 'done', run };
        if (run.rerunOf !== undefined) {
          // The store is read again now, when the reply is in: the set is written by its id as it is
          // stored now, or not at all, and the result stays shown either way.
          const written = guideSetDb.writeRerun(
            run.rerunOf,
            {
              ranAt: run.ranAt,
              topology: run.topology,
              report,
              guides: result.guides,
              scoreNames: CRISPR_SCORE_NAMES,
              heuristicRule: crisprRankRule,
            },
            { id: run.docId, name: run.docName, revision: run.revision }
          );
          crisprSearches.guideSetNotice = written.ok
            ? {
                docId: run.docId,
                ok: true,
                text: `Reran "${written.value.name}": its ${bp(written.value.guides.length)} guides on revision ${written.value.sequenceRevision} are kept in place of the earlier ones.`,
              }
            : { docId: run.docId, ok: false, text: written.error.message };
          crisprSearches.guideSetWrites += 1;
        }
      }
      crisprSearchesChanged();
    });
  };
  /** Stop abandons the reply (D0171): nothing the engine sends for this run is read. */
  const stopCrisprSearch = () => {
    const status = crisprSearches.status;
    if (status?.phase !== 'running') return;
    crisprSearches.serial += 1;
    crisprSearches.status = { phase: 'stopped', run: status.run };
    crisprSearchesChanged();
  };

  const crisprResult: CrisprScanResult = crisprShown?.result ?? { guides: [] };

  const [guideSetsRead, setGuideSetsRead] = useState(0);
  const guideSetWrites = crisprSearches.guideSetWrites;
  const guideSetList: GuideSetList = useMemo(
    () => guideSetDb.listForDocument(doc.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guideSetDb, doc.id, guideSetsRead, guideSetWrites]
  );
  /**
   * The sets of documents not open in this workspace (US-01M7DVDF AC6), read from the same store:
   * every open document's id, the active one with them, is left out, so a set of another open
   * document is listed nowhere here.
   */
  const openDocumentIds = useMemo(() => [doc.id, ...allDocuments.map((d) => d.id)], [doc.id, allDocuments]);
  const guideSetsElsewhere: GuideSetList = useMemo(
    () => guideSetDb.listNotOpen(openDocumentIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guideSetDb, openDocumentIds, guideSetsRead, guideSetWrites]
  );
  /** The whole store, for the backup (US-01M7M67J): Export is offered only while it reads and holds a set. */
  const guideSetStore = useMemo(
    () => guideSetDb.read(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guideSetDb, guideSetsRead, guideSetWrites]
  );
  const [guideSetSave, setGuideSetSave] = useState<{ docId: string; ok: boolean; text: string } | null>(null);
  /**
   * Save this result is offered only for a completed run shown on this document's current revision:
   * not before a run, while one runs, after a Stop or a failure on this document (even with an
   * earlier result still shown), and not while the result is withdrawn.
   */
  const crisprSaveOffered =
    crisprShown !== undefined &&
    crisprShown.run.preset !== undefined &&
    // A rerun's result belongs to the set it reran (US-01M7DVDF AC4), which its reply is written
    // over: it is never offered to be saved as a second set.
    crisprShown.run.rerunOf === undefined &&
    !(crisprStatus && crisprStatus.phase !== 'done' && crisprStatus.run.docId === doc.id);
  const saveCrisprGuideSet = () => {
    if (!crisprSaveOffered || !crisprShown?.run.preset) return;
    const { run, result } = crisprShown;
    const saved = guideSetDb.save(
      {
        name: run.name,
        ranAt: run.ranAt,
        criteria: { nuclease: run.preset!, topology: run.topology, interval: run.interval, resultCap: CRISPR_GUIDES_LISTED },
        report: result.report,
        guides: result.guides,
        scoreNames: CRISPR_SCORE_NAMES,
        heuristicRule: crisprRankRule,
      },
      { id: run.docId, name: run.docName, revision: run.revision }
    );
    setGuideSetSave(
      saved.ok
        ? { docId: doc.id, ok: true, text: `Saved "${saved.value.name}" as a guide set for ${run.docName}: ${bp(saved.value.guides.length)} guides, kept on this computer and not in the document.` }
        : { docId: doc.id, ok: false, text: saved.error.message }
    );
    setGuideSetsRead((n) => n + 1);
  };
  const guideSetWords = (set: GuideSet) =>
    `${set.criteria.nuclease.id}, ${
      set.criteria.interval ? `bases ${bp(set.criteria.interval.start)}..${bp(set.criteria.interval.end)}` : 'whole sequence'
    }, revision ${set.sequenceRevision}, run ${set.ranAt}`;

  /**
   * Rename, remove and rerun a saved set (US-01M7DVDF). None of them calls the document writer:
   * each changes only the guide-set store, and each says what it did or why it did nothing.
   */
  const [guideSetRowsShown, setGuideSetRowsShown] = useState<string[]>([]);
  const [guideSetRenaming, setGuideSetRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [guideSetRemoving, setGuideSetRemoving] = useState<string | null>(null);
  const guideSetNotice = crisprSearches.guideSetNotice?.docId === doc.id ? crisprSearches.guideSetNotice : null;
  const noteGuideSet = (ok: boolean, text: string) => {
    crisprSearches.guideSetNotice = { docId: doc.id, ok, text };
    crisprSearchesChanged();
  };
  /** Export every saved set, documents not open included, as the versioned backup (US-01M7M67J). */
  const exportGuideSets = async () => {
    const backup = guideSetDb.exportBackup();
    setGuideSetsRead((n) => n + 1);
    if (!backup.ok) return noteGuideSet(false, backup.error.message);
    const filename = `crispr-guide-sets-${new Date().toISOString().slice(0, 10)}.json`;
    const said = describeGuideSetExport(await savePlatformFile(filename, backup.value), filename);
    noteGuideSet(said.ok, said.text);
  };
  /** Import a backup file; the saved-sets lists are read again, and the document is never touched. */
  const importGuideSets = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      return noteGuideSet(false, `${file.name} was not imported: it could not be read (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`);
    }
    const r = guideSetDb.importBackup(file.name, text);
    setGuideSetsRead((n) => n + 1);
    if (!r.ok) return noteGuideSet(false, r.error.message);
    const { added, unchanged, kept } = r.value;
    noteGuideSet(
      true,
      `Imported ${file.name}: ${added.length} added, ${unchanged.length} unchanged, ${kept.length} kept as stored${kept.length > 0 ? ` (${kept.join(', ')})` : ''}.`
    );
  };
  const toggleGuideSetRows = (id: string) =>
    setGuideSetRowsShown((shown) => (shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id]));
  const renameGuideSet = () => {
    if (!guideSetRenaming) return;
    const renamed = guideSetDb.rename(guideSetRenaming.id, guideSetRenaming.draft);
    // A refused name leaves the field open to be put right; any other outcome closes it.
    if (renamed.ok || renamed.error.kind !== 'invalid') setGuideSetRenaming(null);
    noteGuideSet(renamed.ok, renamed.ok ? `Renamed the guide set to "${renamed.value.name}".` : renamed.error.message);
    setGuideSetsRead((n) => n + 1);
  };
  const removeGuideSet = (id: string) => {
    setGuideSetRemoving(null);
    const removed = guideSetDb.remove(id);
    noteGuideSet(
      removed.ok,
      removed.ok ? `Removed the guide set "${removed.value.name}" from this computer; no document is changed.` : removed.error.message
    );
    setGuideSetsRead((n) => n + 1);
  };
  /**
   * Rerun a set of this document through the Run path (US-01M7DVDF AC4) with the set's own preset,
   * interval and result cap, never the chooser's. It is refused, the engine not called, when the
   * engine no longer has the set's preset as it ran, or when a set of an interval is stale: bounds
   * on an earlier sequence may not hold the same bases now.
   */
  const rerunGuideSet = (set: GuideSet) => {
    const refuse = (why: string) => noteGuideSet(false, `"${set.name}" was not rerun: ${why}`);
    const ranWith = set.criteria.nuclease;
    const now = nucleasePresets.find((p) => p.id === ranWith.id);
    if (!now) {
      refuse(`the engine has no ${ranWith.id} preset now.`);
      return;
    }
    const changed = CRISPR_PRESET_FIELDS.find((f) => now[f] !== ranWith[f]);
    if (changed) {
      refuse(
        `the engine's ${ranWith.id} preset is not the one it ran with (${changed} was ${String(ranWith[changed])}, is now ${String(now[changed])}).`
      );
      return;
    }
    const interval = set.criteria.interval;
    if (interval && set.sequenceRevision !== docRevision) {
      refuse(
        `it searched bases ${bp(interval.start)}..${bp(interval.end)} of an earlier sequence of ${doc.name}, and those bounds may no longer hold the same bases. Select the interval and press Run.`
      );
      return;
    }
    crisprSearches.guideSetNotice = null;
    runCrisprSearch({ setId: set.id, name: set.name, preset: now, interval, resultCap: set.criteria.resultCap });
  };
  /**
   * One saved set's entry. A set of this document is marked stale while its revision is not the
   * document's (the rule a live result is withdrawn by, US-01M7DVJK AC6); a set of a document that
   * is not open is listed with its document and is never offered for rerun. Its rows are shown as
   * stored, read-only: no row jumps to a guide, annotates or draws on the map.
   */
  const guideSetEntry = (set: GuideSet, where: 'here' | 'elsewhere') => {
    const here = where === 'here';
    const stale = here && set.sequenceRevision !== docRevision;
    const renaming = here && guideSetRenaming?.id === set.id ? guideSetRenaming : null;
    const rowsShown = guideSetRowsShown.includes(set.id);
    return (
      <li
        key={set.id}
        {...(here
          ? { 'data-guide-set': set.id, 'data-guide-set-stale': stale ? 'yes' : 'no' }
          : { 'data-guide-set-elsewhere': set.id })}
      >
        {here ? (
          <>
            <span data-guide-set-name="">{set.name}</span> — {guideSetWords(set)}
          </>
        ) : (
          <>
            <span data-guide-set-elsewhere-name="">{set.name}</span> — for {set.documentName}: {guideSetWords(set)}
          </>
        )}
        {stale && (
          <p className="mbc-opdlg-muted" data-guide-set-stale-note="">
            {`Stale: computed on revision ${set.sequenceRevision} of ${set.documentName}; its bases or topology have changed since.`}
          </p>
        )}
        {!here && (
          <p className="mbc-opdlg-muted" data-guide-set-no-rerun="">
            {`Not offered for rerun: ${set.documentName} is not open in this workspace, and a set is never rerun on another document.`}
          </p>
        )}
        <div className="cloning-action-row">
          <button type="button" className="btn-secondary-sm" data-guide-set-show-rows={set.id} onClick={() => toggleGuideSetRows(set.id)}>
            {rowsShown ? 'Hide rows' : 'Show rows'}
          </button>
          {here && (
            <button
              type="button"
              className="btn-secondary-sm"
              data-guide-set-rerun={set.id}
              title={`Search ${doc.name} again with the nuclease, range and result cap "${set.name}" ran with`}
              onClick={() => rerunGuideSet(set)}
            >
              Rerun
            </button>
          )}
          {here && (
            <button
              type="button"
              className="btn-secondary-sm"
              data-guide-set-rename={set.id}
              onClick={() => setGuideSetRenaming({ id: set.id, draft: set.name })}
            >
              Rename
            </button>
          )}
          <button type="button" className="btn-secondary-sm" data-guide-set-remove={set.id} onClick={() => setGuideSetRemoving(set.id)}>
            Remove
          </button>
        </div>
        {renaming && (
          <div className="cloning-action-row">
            <input
              type="text"
              aria-label={`New name for "${set.name}"`}
              data-guide-set-rename-field={set.id}
              value={renaming.draft}
              onChange={(e) => setGuideSetRenaming({ id: set.id, draft: e.target.value })}
            />
            <button type="button" className="btn-secondary-sm" data-guide-set-rename-save={set.id} onClick={renameGuideSet}>
              Save name
            </button>
            <button type="button" className="btn-secondary-sm" data-guide-set-rename-cancel={set.id} onClick={() => setGuideSetRenaming(null)}>
              Cancel
            </button>
          </div>
        )}
        {guideSetRemoving === set.id && (
          <div className="cloning-action-row" role="alertdialog" aria-label={`Remove "${set.name}"`}>
            <span data-guide-set-remove-confirm={set.id}>
              {`Remove the guide set "${set.name}" from this computer? No document is changed.`}
            </span>
            <button type="button" className="btn-secondary-sm" data-guide-set-remove-yes={set.id} onClick={() => removeGuideSet(set.id)}>
              Remove
            </button>
            <button type="button" className="btn-secondary-sm" data-guide-set-remove-cancel={set.id} onClick={() => setGuideSetRemoving(null)}>
              Cancel
            </button>
          </div>
        )}
        {rowsShown && (
          <div data-guide-set-rows={set.id}>
            {stale && (
              <p className="mbc-opdlg-muted" data-guide-set-rows-note="">
                {`Computed on revision ${set.sequenceRevision}, not the current sequence: these coordinates are not read against it.`}
              </p>
            )}
            {set.guides.length === 0 ? (
              <p className="mbc-opdlg-muted">{`"${set.name}" holds no guide rows: its search found none.`}</p>
            ) : (
              <ul>
                {set.guides.map((g) => (
                  <li key={g.id} data-guide-set-row={g.id}>
                    {`${g.name}: ${guideRange(g)}, ${g.strand === 1 ? 'forward' : 'reverse'} strand, spacer ${g.spacerSeq}, PAM ${g.pamSeq}, ${set.scoreNames.onTargetScore} ${g.onTargetScore}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };
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
  // A result is shown only on the revision it ran on, which hashes the topology with the bases, so
  // the document's topology here is the one the run was made with (US-01M7DVJK AC6).
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
      ? crisprRunningHere
        ? 'running'
        : crisprFailed?.refusal !== undefined
        ? 'no range searched'
        : crisprFailed
        ? 'scan report unavailable'
        : crisprWithdrawn
        ? 'result withdrawn'
        : 'no search run'
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
  }, [doc.id, crisprShownRun?.serial]);
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
      // The preset the run was made with, never the chooser's current one (US-01M7DVJK AC6).
      ...(crisprShownRun?.preset ? { preset: crisprShownRun.preset } : {}),
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
    if (!crisprShown) return;
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
    // A withdrawn result, or none, annotates nothing (US-01M7DVJK AC6).
    if (!crisprShown) return;
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
          description: `Amplified ${designedPCR.ampliconLength} bp product (${regionStart}..${regionEnd}) with 5' ${tailLabel(fwdTailEnz)}/${tailLabel(revTailEnz)} adapter tails`,
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
            : `5' ${tailLabel(fwdTailEnz)} / ${tailLabel(revTailEnz)}${includeClampTail ? ' + 3-nt leader' : ''}`}
        </span>
      </summary>
      <div className="form-grid-3col" style={{ marginTop: 8 }}>
        <label className="form-field">
          <span>5&apos; Forward Enzyme Tail:</span>
          <select value={fwdTailEnz} onChange={(e) => { setFwdTailEnz(e.target.value); setTailNotice([]); }}>
            <option value="None">None (Blunt PCR)</option>
            {enzymes.map((e) => (
              <option key={enzymeKey(e)} value={enzymeKey(e)}>
                {enzymeLabel(e)} ({e.recognitionSeq})
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>5&apos; Reverse Enzyme Tail:</span>
          <select value={revTailEnz} onChange={(e) => { setRevTailEnz(e.target.value); setTailNotice([]); }}>
            <option value="None">None (Blunt PCR)</option>
            {enzymes.map((e) => (
              <option key={enzymeKey(e)} value={enzymeKey(e)}>
                {enzymeLabel(e)} ({e.recognitionSeq})
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
        {/* The interval this search was set to, held when it is no longer on offer, so Run sends
            it as it was chosen (US-01M7DVJK AC5). */}
        {crisprHeldOnly && crisprIntervalAsked && (
          <option value="interval">
            {`The interval this search was set to, ${bp(crisprIntervalAsked.start)}..${bp(crisprIntervalAsked.end)} (${bp(crisprIntervalAsked.lengthBp)} bp${crisprIntervalAsked.crossesOrigin ? ', across the origin' : ''})`}
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

  if (hostedPanel) return <div className="alignment-studio-wrapper">{hostedPanel}</div>;
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

            <ResultWarnings warnings={tailNotice} label="Primer tail warnings" />

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
              <span className="badge-accent">SantaLucia (1998) nearest-neighbour, von Ahsen (2001) Mg2+ equivalence (Primer3 default)</span>
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
              <label className="form-field">
                <span>Search name:</span>
                <input
                  type="text"
                  aria-label="Search name:"
                  data-crispr-search-name=""
                  value={crisprNameDraft ?? crisprNameDefault}
                  onChange={(e) => setCrisprNameDraft(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                data-crispr-run=""
                title={`Search ${crisprScope === 'interval' && crisprIntervalAsked ? `bases ${bp(crisprIntervalAsked.start)}..${bp(crisprIntervalAsked.end)}` : 'the whole sequence'} of ${doc.name} for ${crisprNuclease} guides`}
                onClick={() => runCrisprSearch()}
              >
                Run
              </button>
              {crisprRunningHere && (
                <button type="button" className="btn-secondary-sm" data-crispr-stop="" onClick={stopCrisprSearch}>
                  Stop
                </button>
              )}
              {crisprSaveOffered && (
                <button
                  type="button"
                  className="btn-secondary-sm"
                  data-crispr-save-set=""
                  title={`Keep "${crisprShown?.run.name}" as a guide set on this computer, with its nuclease, range, revision and scores`}
                  onClick={saveCrisprGuideSet}
                >
                  Save this result
                </button>
              )}
              <button
                className="btn-success"
                onClick={handleAnnotateTop5Crispr}
                disabled={!crisprShown}
                title={crisprShown ? undefined : 'No search result is shown for this sequence: press Run first'}
              >
                + Annotate Top 5 Guides onto {doc.name}
              </button>
            </div>
          </div>

          {/* The result shown, by its own name (US-01M7DVJK AC2, AC3): read from this document's
              entry in the store, so it is named whatever ran since, here or on another document. */}
          {crisprShown && (
            <p className="mbc-opdlg-muted" data-crispr-shown-result="">
              {`"${crisprShown.run.name}" searched ${bp(crisprShown.result.report.scannedLengthBp)} bp.`}
            </p>
          )}
          {/* Where the last search on this document stands (US-01M7DVJK): running, stopped or failed,
              by its name, and the result still shown beside it named (AC3). */}
          {crisprStatus &&
            crisprStatus.phase !== 'done' &&
            crisprStatus.run.docId === doc.id && (
              <p className="mbc-opdlg-muted" role="status" data-crispr-run-status={crisprStatus.phase}>
                {crisprStatus.phase === 'running'
                  ? `Running "${crisprStatus.run.name}": the engine was asked for ${bp(crisprStatus.run.askedBp)} bp.`
                  : crisprStatus.phase === 'stopped'
                  ? `Stopped "${crisprStatus.run.name}" before the engine replied: ${bp(crisprStatus.run.askedBp)} bp were asked for and no result is shown.${
                      crisprShownRun ? ` The result of "${crisprShownRun.name}" is left as it was.` : ''
                    }`
                  : `"${crisprStatus.run.name}" failed: ${
                      crisprStatus.phase === 'failed' && crisprStatus.refusal !== undefined
                        ? `the engine searched no range: ${crisprStatus.refusal}`
                        : `the CRISPR scan report is unavailable (${crisprStatus.phase === 'failed' ? crisprStatus.unavailable : ''})`
                    }${crisprShownRun ? ` The result of "${crisprShownRun.name}" is left as it was.` : ''}`}
              </p>
            )}
          {crisprWithdrawn && (
            <p className="mbc-opdlg-muted" data-crispr-withdrawn={crisprWithdrawn.why}>
              {crisprWithdrawn.why === 'other-document'
                ? `"${crisprWithdrawn.run.name}" ran on another document ("${crisprWithdrawn.run.docName}"), so none of its guides is shown here: press Run to search ${doc.name}.`
                : `"${crisprWithdrawn.run.name}" ran on an earlier sequence of ${doc.name}: its bases or topology have changed since, so none of its guides is shown: press Run to search it again.`}
            </p>
          )}

          {/* The guide sets saved for this document (US-01M7DVFD): some, none, or a store that
              cannot be read, which is said by name and never drawn as no saved searches. */}
          {guideSetSave && guideSetSave.docId === doc.id && (
            <p className="mbc-opdlg-muted" role="status" data-guide-set-save={guideSetSave.ok ? 'saved' : 'refused'}>
              {guideSetSave.text}
            </p>
          )}
          {guideSetNotice && (
            <p className="mbc-opdlg-muted" role="status" data-guide-set-outcome={guideSetNotice.ok ? 'done' : 'refused'}>
              {guideSetNotice.text}
            </p>
          )}
          <div className="mbc-guide-sets" data-guide-sets={guideSetList.kind}>
            <strong>Saved guide sets for {doc.name}</strong>:{' '}
            {guideSetList.kind === 'unreadable' ? (
              `${guideSetList.error.message} Nothing is listed here until they can be read.`
            ) : guideSetList.kind === 'none' ? (
              `No saved searches for ${doc.name}.`
            ) : (
              <ul>{guideSetList.sets.map((set) => guideSetEntry(set, 'here'))}</ul>
            )}
          </div>
          {/* The backup (US-01M7M67J): Export only while the store reads and holds a set; over a
              store that cannot be read the list above names why, and nothing here claims it is empty.
              Import is always offered, and refuses by name what it cannot read. */}
          <div className="cloning-action-row" data-guide-set-backup="">
            {guideSetStore.ok && guideSetStore.sets.length > 0 && (
              <button type="button" className="btn-secondary-sm" data-guide-set-export="" onClick={() => void exportGuideSets()}>
                Export guide sets…
              </button>
            )}
            {guideSetStore.ok && guideSetStore.sets.length === 0 && (
              <span className="mbc-opdlg-muted" data-guide-set-export-none="">
                No saved guide sets to export.
              </span>
            )}
            <label className="form-field">
              <span>Import guide sets (.json)</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Import guide sets"
                data-guide-set-import=""
                onChange={(e) => {
                  void importGuideSets(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {/* The sets of documents not open here (US-01M7DVDF AC6), apart from this document's. The
              section is drawn only when such a set is stored: a store that cannot be read is named
              in the list above, never drawn here as no sets. */}
          {guideSetList.kind !== 'unreadable' && guideSetsElsewhere.kind === 'saved' && (
            <div className="mbc-guide-sets" data-guide-sets-elsewhere="">
              <strong>Saved guide sets for documents not open</strong>
              <ul>{guideSetsElsewhere.sets.map((set) => guideSetEntry(set, 'elsewhere'))}</ul>
            </div>
          )}

          <div className="info-callout">
            {/* An interval the engine refused was searched not at all, so this line claims no
                range, no candidate count and no seed count for it (US-01M7DVAS AC6). */}
            {/* With no result shown, the last failure on this document is the answer, then why a
                result is withheld, then that no search has been run (US-01M7DVJK AC1, AC5). */}
            {crisprShownRun === undefined
              ? crisprFailed?.refusal !== undefined
                ? `No range was searched: ${crisprFailed.refusal} No guide, range or seed count is claimed here.`
                : crisprFailed
                ? `CRISPR scan report unavailable (${crisprFailed.unavailable}): this tab cannot say how many candidate guides there are, what range was searched, or whether the scan is complete.`
                : crisprWithdrawn
                ? `No guide is shown for this sequence: the last search ran on ${crisprWithdrawn.why === 'other-document' ? 'another document' : 'an earlier sequence'}. Press Run to search it.`
                : `No search has been run on ${doc.name}: choose the nuclease and the range, then press Run.`
              : crisprIntervalRefusal !== undefined
              ? `No range was searched: ${crisprIntervalRefusal} No guide, range or seed count is claimed here.`
              : crisprCandidates === undefined
              ? `CRISPR scan report unavailable (${crisprResult.reportUnavailableReason ?? 'the engine sent no scan report'}): this tab cannot say how many candidate guides there are, what range was searched, or whether the scan is complete.`
              : crisprCandidates === 0
              ? `No candidate ${crisprShownRun.nuclease} guide: 0 of the candidates this scan looked for are in ${crisprReadAs}.`
              : crisprCandidates > crisprReturned
              ? `Lists the ${bp(crisprReturned)} highest-scoring of the ${bp(crisprCandidates)} candidate ${crisprShownRun.nuclease} guides found.`
              : `Lists all ${bp(crisprCandidates)} candidate ${crisprShownRun.nuclease} guides found.`}{' '}
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
                <th>{CRISPR_SCORE_COLUMNS.onTargetScore}</th>
                <th>{CRISPR_SCORE_COLUMNS.offTargetCount}</th>
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
