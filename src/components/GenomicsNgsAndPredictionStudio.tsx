// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import {
  callFreeBayesVariants,
  classifySequenceTaxonomy,
  complementOnlySequence,
  DE_NOVO_ASSEMBLER_METHODS,
  DeNovoAssemblerEngine,
  findCpGIslands,
  findGenomicRepeats,
  GenBankSubmissionMeta,
  type GenomicRepeatReport,
  mutateAndShuffleSequence,
  MutateShuffleOptions,
  NGS_MAPPER_METHODS,
  NgsMapperEngine,
  predictGlimmerMicrobialGenes,
  prepareGenBankSubmissionPackage,
  reverseOnlySequence,
  runBbdukReadTrimming,
  runDeNovoAssembly,
  runNgsReferenceMapping,
  runWholeGenomeSynteny,
  SYNTENY_ENGINE_METHODS,
  type SyntenyEngine,
  scanMicrosatelliteStrs,
} from '../core/genomicsAndStructureSuite';
import { SequenceDocument, SequenceFeature } from '../types/bio';
import {
  alignLargeGenomesMinimizerChainRust,
  annotateVcfCodingConsequencesNoodlesRust,
  scanJasparPssmMotifsRust,
  segmentGenomeHmmViterbiRust,
  type HmmGenomeSegmentationReport,
  type PssmMotifScanReport,
} from '../lib/rustBioEngine';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { MolBioMenuGlyph } from './MolBioIcons';
import { trimmedReadSaveBlockReason } from '../core/ngsTrimSave';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { ResultWarnings } from './ResultWarnings';
import { subsetNote } from './CircularPlasmidMap';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';

import { genomicsTabsForDocument, type GenomicsSubTabId } from '../core/analysisContext';
export type GenomicsSuiteSubTab = GenomicsSubTabId;

const TABLE_ROWS_SHOWN = 250;

/**
 * The most rows the variant-call, HGVS-consequence and HMM-segment tables draw, the first in
 * sequence order (BG-01M6S1AA). The variant and segment captions give the total, as "first N of
 * M" when the table shows fewer; the HGVS table's caption counts impact tiers, so a note beside it
 * says how many records it lists when that is fewer than there are.
 */
const VARIANT_ROWS_SHOWN = 25;
const CONSEQUENCE_ROWS_SHOWN = 20;
const SEGMENT_ROWS_SHOWN = 24;

/**
 * A list's count as its caption gives it: the total when every item is shown, or "top 24 of 40"
 * ("first 250 of 400" for a list in sequence order) when the list shows fewer than were found.
 */
function listCountLabel(shown: number, total: number, rank: 'top' | 'first'): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return shown < total ? `${rank} ${n(shown)} of ${n(total)}` : n(total);
}

/**
 * The repeat list's count as its caption gives it (BG-01M6SQ9T): the arm length the shown scan was
 * run at, then the count as for any ranked list, or, when the scan stopped at its copy-pair bound,
 * "80 of at least M, the longest found before the scan stopped", since those need not be the
 * longest repeats in the sequence.
 */
function repeatListLabel(report: GenomicRepeatReport): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const count = report.totalIsLowerBound
    ? `${n(report.repeats.length)} of at least ${n(report.totalRepeats)}, the longest found before the scan stopped`
    : listCountLabel(report.repeats.length, report.totalRepeats, 'top');
  return `arms ≥ ${report.minArmBp} bp, ${count}`;
}

/**
 * The Min Repeat Arm box (BG-01M6SQ9T, D0055): the repeat scan runs this long after the last
 * keystroke, or at once on Enter or when the box loses focus, and only at a whole number of bases
 * from the least to the most arm length here.
 */
const REPEAT_ARM_SETTLE_MS = 400;
const MIN_REPEAT_ARM_BP = 8;
const MAX_REPEAT_ARM_BP = 24;

/** The Min Repeat Arm box's text as an arm length to scan at, or null when it is not one. */
function repeatArmOf(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const arm = Number(text);
  return arm >= MIN_REPEAT_ARM_BP && arm <= MAX_REPEAT_ARM_BP ? arm : null;
}

/** What a genome-scale scan is computed from, field by field; the genome names are kept to say so. */
type ScanInput = Readonly<Record<string, string | number>>;
type SyntenyInput = { genomeA: string; seqA: string; genomeB: string; seqB: string; engine: SyntenyEngine };
type GenomeScanInput = { genome: string; seq: string; min: number };

const sameScanInput = (a: ScanInput, b: ScanInput) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.is(a[k], b[k]));

const syntenyScan = (i: SyntenyInput) => runWholeGenomeSynteny(i.seqA, i.seqB, i.engine);
/** The seed length each synteny engine value runs with (D0204), as the card's badge names it. */
const SYNTENY_SEED_MER: Readonly<Record<SyntenyEngine, string>> = { 'seed-13': '13-mer', 'seed-11': '11-mer' };
const geneScan = (i: GenomeScanInput) => predictGlimmerMicrobialGenes(i.seq, i.min);
const cpgScan = (i: GenomeScanInput) => findCpGIslands(i.seq, i.min);

/**
 * Runs `run` in a task of its own once the next frame has been painted (where there are no frames,
 * as outside a browser, in the next task); the function returned cancels it.
 */
function afterNextPaint(run: () => void): () => void {
  let frame: number | null = null;
  let task: ReturnType<typeof setTimeout> | null = null;
  const queue = () => {
    frame = null;
    task = setTimeout(run, 0);
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(queue);
  else queue();
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (task !== null) clearTimeout(task);
  };
}

/**
 * A genome-scale scan (whole-genome synteny, gene prediction, the CpG island scan) the studio never
 * runs while it renders (BG-01M6T6HW): on unrelated 5 Mb genomes synteny alone takes hundreds of
 * milliseconds (D0061). Returns the landed result and the input it was computed for, or null while
 * there is none for `input`, which the panel shows as 'Scanning…'. The scan runs in a task of its
 * own after the frame that shows that has been painted. A result is shown only under the input it
 * was computed from: an input changed while its scan waits cancels it, and a result that returns
 * after its input changed is dropped. `input` is null while the scan's sub-view is not shown; the
 * last result shows again, with no new run, when its input comes back. A scan that throws, throws
 * here, in render, as it did when it ran in render.
 */
function useScanAfterPaint<I extends ScanInput, R>(input: I | null, scan: (input: I) => R): { input: I; result: R } | null {
  const [landed, setLanded] = useState<{ input: I; result?: R; failure?: { error: unknown } } | null>(null);
  const current = input && landed && sameScanInput(landed.input, input) ? landed : null;
  const waiting = input !== null && current === null;
  useEffect(() => {
    if (!input || !waiting) return undefined;
    let dropped = false;
    const cancel = afterNextPaint(() => {
      let outcome: { input: I; result?: R; failure?: { error: unknown } };
      try {
        outcome = { input, result: scan(input) };
      } catch (error) {
        outcome = { input, failure: { error } };
      }
      if (!dropped) setLanded(outcome);
    });
    return () => {
      dropped = true;
      cancel();
    };
  }, [input, waiting, scan]);
  if (current?.failure) throw current.failure.error;
  return current ? { input: current.input, result: current.result as R } : null;
}

/** What a scan's panel shows in place of its numbers while the scan waits or runs. */
const ScanningNote = () => (
  <div className="mbc-opdlg-progress" role="status">
    <Loader2 size={14} className="mbc-spin" aria-hidden="true" />
    <span>Scanning…</span>
  </div>
);

const bp = (seq: string) => `${seq.length.toLocaleString('en-US')} bp`;

/**
 * An engine reply with the D0005 `warnings` it carries: for the HMM segmentation, the TF motif scan
 * and the minimizer chainer, the bases covered when the engine stopped short of the sequence's end
 * and any list it cut. The engine's TypeScript reply types do not declare the field yet.
 */
type EngineCoverage<T> = T & { warnings?: string[] };

interface GenomicsNgsAndPredictionStudioProps {
  activeDoc: SequenceDocument;
  /** Candidate nucleotide documents for reference / read / partner pickers (no trashed or protein records). */
  documents: SequenceDocument[];
  /** Documents ticked in the table; when 2+ are ticked they are the de novo assembly inputs. */
  selectedDocuments?: SequenceDocument[];
  /** Live protein documents; the 3D aligner takes its partner model B from these. */
  proteinDocuments?: SequenceDocument[];
  /**
   * The selection on the active document's sequence (clicking a feature selects its range): the 3D
   * viewer highlights its residues on the document's own chain.
   */
  selectedRange?: { start: number; end: number; label?: string } | null;
  initialSubTab?: GenomicsSuiteSubTab;
  /** Incremented on every menu request so re-requesting the same sub-tab re-applies it. */
  commandNonce?: number;
  /**
   * Told of each sub-tab chosen on the studio's own sub-tab bar, so App names the tab, the
   * inspector and the Help topic for the view shown (D0241).
   */
  onSubTabChange?: (subTab: GenomicsSuiteSubTab) => void;
  onCreateDocument: (newDoc: SequenceDocument) => void;
  onUpdateActiveSequence: (newSeq: string, summary: string) => void;
  /**
   * Coordinate-aware strand transforms. When provided, the in-place
   * Complement/Reverse buttons delegate to them so features and primers are
   * mirrored together with the sequence (a raw sequence swap would leave every
   * annotation pointing at the wrong bases).
   */
  onComplementOnlyActiveDoc?: () => void;
  onReverseOnlyActiveDoc?: () => void;
  onAppendFeatures: (features: SequenceFeature[], summary: string) => void;
  /** Append features to a specific document (e.g. variants called against the reference, not the active doc). */
  onAppendFeaturesToDocument?: (docId: string, features: SequenceFeature[], summary: string) => void;
  onStatusBanner?: (msg: string) => void;
}

export const GenomicsNgsAndPredictionStudio: React.FC<
  GenomicsNgsAndPredictionStudioProps
> = ({
  activeDoc,
  documents,
  selectedDocuments = [],
  proteinDocuments = [],
  selectedRange = null,
  initialSubTab,
  commandNonce,
  onSubTabChange,
  onCreateDocument,
  onUpdateActiveSequence,
  onComplementOnlyActiveDoc,
  onReverseOnlyActiveDoc,
  onAppendFeatures,
  onAppendFeaturesToDocument,
  onStatusBanner,
}) => {
  const availableTabs = genomicsTabsForDocument(activeDoc);
  const [selectedSubTab, setSubTab] = useState<GenomicsSuiteSubTab>(initialSubTab ?? availableTabs[0]);
  const subTab = availableTabs.includes(selectedSubTab) ? selectedSubTab : availableTabs[0];
  /** A sub-tab chosen on the studio's own bar: shown here, and reported to App (D0241). */
  const chooseSubTab = (next: GenomicsSuiteSubTab) => {
    setSubTab(next);
    onSubTabChange?.(next);
  };

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab, commandNonce]);

  // In the workbench each sub-tab's parameters are sections of App's shared inspector, titled
  // "Genomics Controls" ("3D Structure Controls" for a protein record), while the documents compared
  // and the GenBank submission fields stay in the cards. Every value stays this studio's state, so it
  // is kept across sub-tab switches and an inspector close. Drawn on its own, the studio keeps every
  // setting where it sits (US-01M6TAKR).
  const inWorkbench = useInWorkbench();
  /**
   * A setting drawn inline beside its card's buttons, label and box side by side, on its own; in the
   * workbench a labelled field of its section, as the inspector's other settings are.
   */
  const inlineSetting = (name: string, gap: number, fontSize: number, control: React.ReactElement) =>
    inWorkbench ? (
      <label className="form-field">
        <span>{name}</span>
        {control}
      </label>
    ) : (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap, fontSize }}>
        <span>{name}</span>
        {control}
      </label>
    );
  /** An inline box's fixed width on its own; in the inspector a field takes its section's width. */
  const inlineBoxWidth = (width: number) => (inWorkbench ? undefined : { width });

  // Accessible caption IDs for responsive sticky-header tables
  const contigTableId = useId();
  const lcbTableId = useId();
  const variantTableId = useId();
  const strTableId = useId();
  const glimmerTableId = useId();
  const cpgTableId = useId();
  const repeatTableId = useId();

  // 1. NGS Trim, Map & De Novo Assembly state
  const [bbdukKmer, setBbdukKmer] = useState<number>(11);
  const [bbdukMinQ, setBbdukMinQ] = useState<number>(20);
  const [ngsMapper, setNgsMapper] = useState<NgsMapperEngine>('seed-13');
  const [mapRefDocId, setMapRefDocId] = useState<string>(documents[0]?.id ?? activeDoc.id);
  const [mapReadDocId, setMapReadDocId] = useState<string>(
    documents.find((d) => d.chromatogram || d.sequence.length < 1500)?.id ?? activeDoc.id
  );
  const [assembler, setAssembler] = useState<DeNovoAssemblerEngine>('overlap');
  const [assemblyOverlap, setAssemblyOverlap] = useState<number>(19);

  // 2. Whole-Genome Synteny, FreeBayes Variants, Microsatellite STRs & 16S/ITS Taxonomy
  const [syntenyEngine, setSyntenyEngine] = useState<SyntenyEngine>('seed-13');
  const [genomePartnerId, setGenomePartnerId] = useState<string>(
    documents.find((d) => d.id !== activeDoc.id)?.id ?? activeDoc.id
  );
  const [minStrCopies, setMinStrCopies] = useState<number>(4);

  // 3. Glimmer Microbial Genes, CpG Islands, Genomic Repeats, Viterbi HMM & JASPAR PSSM Motifs
  const [glimmerMinAa, setGlimmerMinAa] = useState<number>(45);
  const [cpgMinLen, setCpgMinLen] = useState<number>(200);
  const [repeatMinArm, setRepeatMinArm] = useState<number>(10);
  // What the Min Repeat Arm box holds while it is typed in; the scan moves to it once it settles.
  const [repeatArmText, setRepeatArmText] = useState<string>('10');
  const [pssmMinRelScore, setPssmMinRelScore] = useState<number>(0.84);

  useEffect(() => {
    const arm = repeatArmOf(repeatArmText);
    if (arm === null || arm === repeatMinArm) return undefined;
    const timer = setTimeout(() => setRepeatMinArm(arm), REPEAT_ARM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [repeatArmText, repeatMinArm]);
  /** Enter or blur: scan at the box's arm now, or, when it holds no arm to scan at, show the one in use. */
  const settleRepeatArm = () => {
    const arm = repeatArmOf(repeatArmText);
    if (arm === null) setRepeatArmText(String(repeatMinArm));
    else setRepeatMinArm(arm);
  };

  // The synteny partner genome.
  const partnerDoc = useMemo(
    () => documents.find((d) => d.id === genomePartnerId) ?? documents[0] ?? activeDoc,
    [documents, genomePartnerId, activeDoc]
  );

  // 5. Transform, Mutate/Shuffle & NCBI GenBank Submission
  const [mutateMode, setMutateMode] =
    useState<MutateShuffleOptions['mode']>('shuffle-dinucleotide');
  const [mutationRatePct, setMutationRatePct] = useState<number>(2.5);
  const [mutateSeed, setMutateSeed] = useState<number>(20261030);
  const [gbMeta, setGbMeta] = useState<GenBankSubmissionMeta>({
    organism: 'Escherichia coli',
    strainOrIsolate: 'K-12 DH5alpha',
    molType: 'genomic DNA',
    geneticCodeId: 11,
  });

  // Memoized analytical reports
  const mapRefDoc = useMemo(
    () => documents.find((d) => d.id === mapRefDocId) ?? activeDoc,
    [documents, mapRefDocId, activeDoc]
  );
  const mapReadDoc = useMemo(
    () => documents.find((d) => d.id === mapReadDocId) ?? activeDoc,
    [documents, mapReadDocId, activeDoc]
  );

  const bbdukReport = useMemo(
    () => subTab === 'ngs-assembly' ?
      runBbdukReadTrimming(activeDoc.sequence, activeDoc.chromatogram?.phredScores, {
        kmerLen: bbdukKmer,
        minPhredQuality: bbdukMinQ,
      }) : null,
    [subTab, activeDoc, bbdukKmer, bbdukMinQ]
  );

  const ngsMapReport = useMemo(
    () => subTab === 'ngs-assembly' ? runNgsReferenceMapping(mapRefDoc.sequence, mapReadDoc.sequence, ngsMapper) : null,
    [subTab, mapRefDoc, mapReadDoc, ngsMapper]
  );

  // Assemble the reads the user ticked (2+ nucleotide documents). Without a
  // selection, fall back to the first 8 candidate documents and say so — it
  // previously always took the first 8 workspace documents, including trashed
  // and protein records.
  const assemblyInputDocs = useMemo(() => {
    const ticked = selectedDocuments.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
    return ticked.length >= 2 ? { docs: ticked, fromSelection: true } : { docs: documents.slice(0, 8), fromSelection: false };
  }, [selectedDocuments, documents]);
  const assemblyReport = useMemo(
    () => subTab === 'ngs-assembly' ?
      runDeNovoAssembly(
        assemblyInputDocs.docs.map((d) => ({ name: d.name, sequence: d.sequence })),
        assembler,
        assemblyOverlap
      ) : null,
    [subTab, assemblyInputDocs, assembler, assemblyOverlap]
  );

  // Synteny, gene prediction and the CpG island scan run after the frame showing 'Scanning…' has
  // been painted, never in render (BG-01M6T6HW); each result names the input it was computed for.
  const syntenyInput = useMemo(
    (): SyntenyInput | null => subTab === 'genome-variants'
      ? { genomeA: activeDoc.name, seqA: activeDoc.sequence, genomeB: partnerDoc.name, seqB: partnerDoc.sequence, engine: syntenyEngine }
      : null,
    [subTab, activeDoc.name, activeDoc.sequence, partnerDoc.name, partnerDoc.sequence, syntenyEngine]
  );
  const synteny = useScanAfterPaint(syntenyInput, syntenyScan);
  const syntenyReport = synteny?.result ?? null;

  const freeBayesReport = useMemo(
    () => subTab === 'genome-variants' ? callFreeBayesVariants(mapRefDoc.name, mapRefDoc.sequence, mapReadDoc.sequence) : null,
    [subTab, mapRefDoc, mapReadDoc]
  );
  const freeBayesWarnings: readonly string[] =
    (freeBayesReport as (typeof freeBayesReport & { warnings?: readonly string[] }) | null)?.warnings ?? [];

  // The chainer, the HMM segmentation and the TF scan are handed the whole sequence: the engine
  // covers it up to its own caps and says in `warnings` which bases it covered when it stopped
  // short (BG-01M6S1C1). They used to be handed the first 120, 100 and 60 kb, unannounced. The
  // chainer counts a chain only from `minChainAnchors` anchors, the fewest that chance seed matches
  // between genomes of these lengths are not expected to chain; its chains, coverage, identity and
  // inversion count are those chains alone.
  const minimizerChainReport = useMemo((): EngineCoverage<ReturnType<typeof alignLargeGenomesMinimizerChainRust>> & { totalChains?: number; minChainAnchors?: number } | null => {
    if (subTab !== 'genome-variants') return null;
    const seqA = activeDoc.moleculeType === 'Protein' ? '' : activeDoc.sequence;
    const seqB = partnerDoc.moleculeType === 'Protein' ? '' : partnerDoc.sequence;
    if (seqA.length < 25 || seqB.length < 25) return null;
    return alignLargeGenomesMinimizerChainRust(seqA, seqB, 8, 13, 64);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence, partnerDoc.moleculeType, partnerDoc.sequence]);

  const vcfConsequenceReport = useMemo(() => {
    if (subTab !== 'genome-variants') return null;
    if (mapRefDoc.moleculeType === 'Protein' || !freeBayesReport?.vcfText.trim()) return null;
    return annotateVcfCodingConsequencesNoodlesRust(
      mapRefDoc.sequence,
      mapRefDoc.features,
      freeBayesReport.vcfText,
      11
    );
  }, [subTab, mapRefDoc.moleculeType, mapRefDoc.sequence, mapRefDoc.features, freeBayesReport?.vcfText]);

  const hmmSegmentationReport = useMemo((): EngineCoverage<HmmGenomeSegmentationReport> | null => {
    if (subTab !== 'genes-cpg-repeats') return null;
    if (activeDoc.moleculeType === 'Protein' || activeDoc.sequence.length < 30) return null;
    return segmentGenomeHmmViterbiRust(activeDoc.sequence);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence]);

  const pssmMotifReport = useMemo((): EngineCoverage<PssmMotifScanReport> | null => {
    if (subTab !== 'genes-cpg-repeats') return null;
    if (activeDoc.moleculeType === 'Protein' || activeDoc.sequence.length < 12) return null;
    return scanJasparPssmMotifsRust(activeDoc.sequence, pssmMinRelScore);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence, pssmMinRelScore]);

  const strLoci = useMemo(
    () => subTab === 'genome-variants' ? scanMicrosatelliteStrs(activeDoc.sequence, minStrCopies) : null,
    [subTab, activeDoc.sequence, minStrCopies]
  );

  const taxonomyHits = useMemo(
    () => subTab === 'genome-variants' ? classifySequenceTaxonomy(activeDoc.sequence) : null,
    [subTab, activeDoc.sequence]
  );

  const geneInput = useMemo(
    (): GenomeScanInput | null => subTab === 'genes-cpg-repeats' ? { genome: activeDoc.name, seq: activeDoc.sequence, min: glimmerMinAa } : null,
    [subTab, activeDoc.name, activeDoc.sequence, glimmerMinAa]
  );
  const genes = useScanAfterPaint(geneInput, geneScan);
  const glimmerReport = genes?.result ?? null;

  const cpgInput = useMemo(
    (): GenomeScanInput | null => subTab === 'genes-cpg-repeats' ? { genome: activeDoc.name, seq: activeDoc.sequence, min: cpgMinLen } : null,
    [subTab, activeDoc.name, activeDoc.sequence, cpgMinLen]
  );
  const cpg = useScanAfterPaint(cpgInput, cpgScan);
  const cpgReport = cpg?.result ?? null;

  const repeatReport = useMemo(
    () => subTab === 'genes-cpg-repeats' ? findGenomicRepeats(activeDoc.sequence, repeatMinArm) : null,
    [subTab, activeDoc.sequence, repeatMinArm]
  );

  const mutateReport = useMemo(
    () => subTab === 'transform-submit' ?
      mutateAndShuffleSequence(activeDoc.sequence, {
        mode: mutateMode,
        mutationRatePercent: mutationRatePct,
        seed: mutateSeed,
      }) : null,
    [subTab, activeDoc.sequence, mutateMode, mutationRatePct, mutateSeed]
  );

  const genbankSubmission = useMemo(
    () => subTab === 'transform-submit' ? prepareGenBankSubmissionPackage(activeDoc, gbMeta) : null,
    [subTab, activeDoc, gbMeta]
  );

  const triggerTextDownload = (filename: string, content: string) => {
    const outcome = saveWorkbenchFile(filename, content);
    if (outcome === 'downloaded') onStatusBanner?.(`Exported ${filename}`);
    else if (!outcome) onStatusBanner?.(`Could not export ${filename}: no save path is available here.`);
  };

  return (
    <div className="hybrid-studio-wrapper">
      {/* Sub-navigation bar covering all built-in Genomics, NGS, Prediction & Structure tools */}
      <div className="studio-card-header" style={{ marginBottom: 8 }}>
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Genomics and Structure Modules"
          alwaysShowArrows={availableTabs.length > 1}
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide genomics modules left"
          nextAriaLabel="Slide genomics modules right"
        >
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('ngs-assembly')}
            tabIndex={subTab === 'ngs-assembly' ? 0 : -1}
            aria-selected={subTab === 'ngs-assembly'}
            className={`method-tab-btn ${subTab === 'ngs-assembly' ? 'active' : ''}`}
            onClick={() => chooseSubTab('ngs-assembly')}
          >
            <MolBioMenuGlyph glyph="map-to-ref" size={13} />
            <span>NGS Trim, Map &amp; Assemble</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('genome-variants')}
            tabIndex={subTab === 'genome-variants' ? 0 : -1}
            aria-selected={subTab === 'genome-variants'}
            className={`method-tab-btn ${subTab === 'genome-variants' ? 'active' : ''}`}
            onClick={() => chooseSubTab('genome-variants')}
          >
            <MolBioMenuGlyph glyph="synteny-genome" size={13} />
            <span>Whole-Genome, Variants, STR &amp; 16S</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('genes-cpg-repeats')}
            tabIndex={subTab === 'genes-cpg-repeats' ? 0 : -1}
            aria-selected={subTab === 'genes-cpg-repeats'}
            className={`method-tab-btn ${subTab === 'genes-cpg-repeats' ? 'active' : ''}`}
            onClick={() => chooseSubTab('genes-cpg-repeats')}
          >
            <MolBioMenuGlyph glyph="cpg-repeats" size={13} />
            <span>Glimmer Genes, CpG &amp; Repeats</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('transform-submit')}
            tabIndex={subTab === 'transform-submit' ? 0 : -1}
            aria-selected={subTab === 'transform-submit'}
            className={`method-tab-btn ${subTab === 'transform-submit' ? 'active' : ''}`}
            onClick={() => chooseSubTab('transform-submit')}
          >
            <MolBioMenuGlyph glyph="database-ncbi" size={13} />
            <span>Transform, Mutate/Shuffle &amp; GenBank Submit</span>
          </button>
        </ScrollableMenuStrip>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: NGS Read Trimming (BBDuk), Reference Mapping & De Novo Assembly */}
      {/* =================================================================== */}
      {subTab === 'ngs-assembly' && bbdukReport && ngsMapReport && assemblyReport && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>BBDuk Adapter/Quality Trimmer &amp; Reference Read Mapper</h3>
              <span className="badge-accent">BBDuk • Built-in Seed Mapper</span>
            </div>

            <InspectorSection title="Read Trimming" order={1}>
              <div className="form-grid-2col">
                <label className="form-field">
                  <span>BBDuk Adapter K-mer Length (k):</span>
                  <input
                    type="number"
                    min={8}
                    max={19}
                    value={bbdukKmer}
                    onChange={(e) => setBbdukKmer(Number(e.target.value) || 11)}
                  />
                </label>
                <label className="form-field">
                  <span>Min End Phred Quality (Q):</span>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    value={bbdukMinQ}
                    onChange={(e) => setBbdukMinQ(Number(e.target.value) || 20)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Trimmed Read ({activeDoc.name})</span>
                <strong className="kpi-val">
                  {bbdukReport.trimmedLengthBp.toLocaleString()} /{' '}
                  {bbdukReport.originalLengthBp.toLocaleString()} bp ({bbdukReport.retainedPercent}%)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">5&apos; / 3&apos; Bases Trimmed</span>
                <strong className="kpi-val">
                  {bbdukReport.basesRemoved5Prime} bp / {bbdukReport.basesRemoved3Prime} bp
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Adapter Hits Detected</span>
                <strong className="kpi-val">{bbdukReport.adapterMatches.length}</strong>
              </div>
            </div>

            <div className="cloning-action-row" style={{ marginTop: 8, marginBottom: 14 }}>
              <button
                className="btn-primary-sm"
                disabled={trimmedReadSaveBlockReason(bbdukReport) !== null}
                title={trimmedReadSaveBlockReason(bbdukReport) ?? undefined}
                onClick={() => {
                  if (trimmedReadSaveBlockReason(bbdukReport) !== null) return;
                  const now = new Date().toISOString().slice(0, 10);
                  onCreateDocument({
                    id: `trimmed-${Date.now()}`,
                    name: `${activeDoc.name}_BBDuk_Trimmed`,
                    accession: `TRIM_${activeDoc.accession}`,
                    folder: activeDoc.folder,
                    moleculeType: activeDoc.moleculeType,
                    topology: 'linear',
                    sequence: bbdukReport.trimmedSequence,
                    description: `BBDuk k=${bbdukKmer} Q>=${bbdukMinQ} trimmed sequence from ${activeDoc.name}`,
                    createdAt: now,
                    updatedAt: now,
                    features: [],
                    primers: [],
                    history: [],
                  });
                }}
              >
                + Save Trimmed Sequence to Workspace
              </button>
              {trimmedReadSaveBlockReason(bbdukReport) && (
                <span className="studio-panel-note" role="status">
                  {trimmedReadSaveBlockReason(bbdukReport)}
                </span>
              )}
            </div>

            <div className="form-grid-3col">
              {/* the mapper is a setting; the reference and the read it maps are the documents compared */}
              <InspectorSection title="Read Mapping" order={2}>
                <label className="form-field">
                  <span>Mapping Algorithm:</span>
                  <select
                    value={ngsMapper}
                    onChange={(e) => setNgsMapper(e.target.value as NgsMapperEngine)}
                  >
                    {(Object.keys(NGS_MAPPER_METHODS) as NgsMapperEngine[]).map((value) => (
                      <option key={value} value={value}>{NGS_MAPPER_METHODS[value]}</option>
                    ))}
                  </select>
                </label>
              </InspectorSection>
              <label className="form-field">
                <span>Reference Sequence:</span>
                <select value={mapRefDocId} onChange={(e) => setMapRefDocId(e.target.value)}>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Query Read / Amplicon:</span>
                <select value={mapReadDocId} onChange={(e) => setMapReadDocId(e.target.value)}>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ResultWarnings warnings={ngsMapReport.warnings} label="Read mapping warnings" />
            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Mapped Span &amp; Strand</span>
                <strong className="kpi-val">
                  {ngsMapReport.refStartBp}..{ngsMapReport.refEndBp} ({ngsMapReport.strand})
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Identity &amp; MAPQ</span>
                <strong className="kpi-val">
                  {ngsMapReport.identityPercent}% (MAPQ {ngsMapReport.mapqScore})
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">CIGAR &amp; Breadth</span>
                <strong className="kpi-val">
                  {ngsMapReport.cigar} ({ngsMapReport.coverageBreadthPercent}%)
                </strong>
              </div>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>De Novo &amp; Contig Assembler ({assemblyReport.assembler})</h3>
              <span className="badge-accent">Greedy Overlap • De Bruijn Graph</span>
            </div>

            <InspectorSection title="De Novo Assembly" order={3}>
              <div className="form-grid-2col">
                <label className="form-field">
                  <span>Built-In Assembly Engine:</span>
                  <select
                    value={assembler}
                    onChange={(e) => setAssembler(e.target.value as DeNovoAssemblerEngine)}
                  >
                    {(Object.keys(DE_NOVO_ASSEMBLER_METHODS) as DeNovoAssemblerEngine[]).map((value) => (
                      <option key={value} value={value}>{DE_NOVO_ASSEMBLER_METHODS[value]}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Min Overlap / K-mer Size (bp):</span>
                  <input
                    type="number"
                    min={12}
                    max={65}
                    value={assemblyOverlap}
                    onChange={(e) => setAssemblyOverlap(Number(e.target.value) || 19)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="info-callout" role="status" style={{ marginTop: 8 }}>
              {assemblyInputDocs.fromSelection
                ? `Assembling the ${assemblyInputDocs.docs.length} ticked documents.`
                : `No reads ticked: assembling the first ${assemblyInputDocs.docs.length} nucleotide documents. Tick 2 or more reads in the document table to choose the inputs.`}
            </div>
            <ResultWarnings warnings={assemblyReport.warnings} label="Assembly warnings" />
            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Contigs Assembled</span>
                <strong className="kpi-val">
                  {assemblyReport.contigCount} (from {assemblyReport.inputReadCount} inputs)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">N50 / L50</span>
                <strong className="kpi-val">
                  {assemblyReport.n50Bp.toLocaleString()} bp / L50={assemblyReport.l50Count}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Total Assembled</span>
                <strong className="kpi-val">
                  {assemblyReport.totalAssembledBp.toLocaleString()} bp
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div id={contigTableId} className="mbc-table-caption">
                Assembled Contigs ({assemblyReport.contigs.length})
              </div>
              <WorkbenchSmartTable
                tableId="ngs-assembled-contigs"
                tableLabel="Assembled Contigs"
                regionMaxHeight={230}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Contig</th>
                    <th scope="col">Length</th>
                    <th scope="col">%GC</th>
                    <th scope="col">Reads (Cov)</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblyReport.contigs.map((ctg) => (
                    <tr key={ctg.id}>
                      <th scope="row">{ctg.name}</th>
                      <td>{ctg.lengthBp.toLocaleString()} bp</td>
                      <td>{ctg.gcPercent}%</td>
                      <td>
                        {ctg.readCount} ({ctg.meanCoverageDepth}x)
                      </td>
                      <td>
                        <button
                          type="button"
                          className="mbc-copy-mini-btn"
                          onClick={() => {
                            const now = new Date().toISOString().slice(0, 10);
                            onCreateDocument({
                              id: `ctg-${Date.now()}`,
                              name: ctg.name,
                              accession: `ASM_${assembler}_${ctg.lengthBp}`,
                              folder: 'Contig Assembly',
                              moleculeType: 'DNA',
                              topology: 'linear',
                              sequence: ctg.sequence,
                              description: `De novo contig by ${assemblyReport.assembler} (${ctg.lengthBp} bp, N50=${assemblyReport.n50Bp} bp)`,
                              createdAt: now,
                              updatedAt: now,
                              features: [],
                              primers: [],
                              history: [],
                            });
                          }}
                        >
                          Add to Workspace
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: Whole-genome synteny, FreeBayes, STR & 16S/ITS Taxonomy */}
      {/* =================================================================== */}
      {subTab === 'genome-variants' && freeBayesReport && strLoci && taxonomyHits && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Whole-Genome Alignment ({SYNTENY_ENGINE_METHODS[syntenyEngine]}) &amp; 16S/ITS Classifier</h3>
              <span className="badge-accent">Collinear Blocks • {SYNTENY_SEED_MER[syntenyEngine]} Seed-and-Extend • 16S/ITS Taxonomy</span>
            </div>

            <div className="form-grid-2col">
              {/* the engine is a setting; the genome compared against stays with the result */}
              <InspectorSection title="Genome Alignment" order={1}>
                <label className="form-field">
                  <span>Genome Alignment Engine:</span>
                  <select
                    value={syntenyEngine}
                    onChange={(e) => setSyntenyEngine(e.target.value as SyntenyEngine)}
                  >
                    {(Object.keys(SYNTENY_ENGINE_METHODS) as SyntenyEngine[]).map((value) => (
                      <option key={value} value={value}>{SYNTENY_ENGINE_METHODS[value]}</option>
                    ))}
                  </select>
                </label>
              </InspectorSection>
              <label className="form-field">
                <span>Compare {activeDoc.name} Against:</span>
                <select
                  value={genomePartnerId}
                  onChange={(e) => setGenomePartnerId(e.target.value)}
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div data-mbc-scan="synteny" aria-busy={synteny ? undefined : true} style={{ marginTop: 8 }}>
              {synteny && syntenyReport ? (
                <>
                  <p className="studio-panel-note">
                    Computed for {synteny.input.genomeA} ({bp(synteny.input.seqA)}) against {synteny.input.genomeB} ({bp(synteny.input.seqB)}) with {syntenyReport.engine}
                  </p>
                  <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
                    <div className="kpi-box">
                      <span className="kpi-label">Collinear Blocks (LCBs)</span>
                      <strong className="kpi-val">{syntenyReport.blocks.length}</strong>
                    </div>
                    <div className="kpi-box">
                      <span className="kpi-label">Aligned Bases &amp; Coverage</span>
                      <strong className="kpi-val">
                        {syntenyReport.totalAlignedBp.toLocaleString()} bp ({syntenyReport.genomeACoverageIsLowerBound
                          ? `at least ${syntenyReport.genomeACoveragePct}% of ${synteny.input.genomeA}`
                          : `${syntenyReport.genomeACoveragePct}%`})
                      </strong>
                    </div>
                    <div className="kpi-box">
                      <span className="kpi-label">Inversions Detected</span>
                      <strong className="kpi-val">{syntenyReport.inversionCount}</strong>
                    </div>
                  </div>
                  <ResultWarnings warnings={syntenyReport.warnings} label="Synteny warnings" />

                  <div style={{ marginTop: 8 }}>
                    <div id={lcbTableId} className="mbc-table-caption">
                      Synteny Blocks ({listCountLabel(Math.min(syntenyReport.blocks.length, TABLE_ROWS_SHOWN), syntenyReport.blocks.length, 'first')})
                    </div>
                    <WorkbenchSmartTable
                      tableId="genomics-synteny-blocks"
                      tableLabel="Whole-Genome Synteny Blocks"
                      regionMaxHeight={165}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Block</th>
                          <th scope="col">Query Span</th>
                          <th scope="col">Target Span</th>
                          <th scope="col">Event Class</th>
                          <th scope="col">% Identity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syntenyReport.blocks.length === 0 ? (
                          <tr>
                            <td colSpan={5}>No shared k-mer synteny block detected between selected pair.</td>
                          </tr>
                        ) : (
                          syntenyReport.blocks.slice(0, TABLE_ROWS_SHOWN).map((blk) => (
                            <tr key={blk.blockId}>
                              <th scope="row">
                                {blk.blockId} ({blk.strand})
                              </th>
                              <td>
                                {blk.genomeAStart}..{blk.genomeAEnd}
                              </td>
                              <td>
                                {blk.genomeBStart}..{blk.genomeBEnd}
                              </td>
                              <td>{blk.eventClass}</td>
                              <td>{blk.identityPercent}%</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </WorkbenchSmartTable>
                  </div>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            {minimizerChainReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 10 }}>
                <div className="mbc-table-caption">
                  Large-Genome (w={minimizerChainReport.windowW}, k={minimizerChainReport.kmerK})-Minimizer Co-Linear Chainer ({minimizerChainReport.totalChains ?? minimizerChainReport.chains.length} chains • {minimizerChainReport.rawSeedMatches} seed anchors{minimizerChainReport.minChainAnchors !== undefined && <> • chains of at least {minimizerChainReport.minChainAnchors} anchors</>})
                </div>
                <ResultWarnings warnings={minimizerChainReport.warnings} label="Minimizer chaining warnings" />
                <WorkbenchSmartTable
                  tableId="genomics-minimizer-synteny-chains"
                  tableLabel="Minimizer Co-Linear Synteny Chains"
                  regionMaxHeight={145}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Chain</th>
                      <th scope="col">Target Span</th>
                      <th scope="col">Query Span</th>
                      <th scope="col">Anchors</th>
                      <th scope="col">Identity / Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minimizerChainReport.chains.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No co-linear minimizer anchor chains detected.</td>
                      </tr>
                    ) : (
                      // every chain the engine lists: its warning above says when that is fewer
                      // than the total the caption gives (it used to draw the first 16, unsaid)
                      minimizerChainReport.chains.map((ch) => (
                        <tr key={ch.chainId}>
                          <th scope="row">
                            #{ch.chainId} ({ch.strand >= 0 ? '+' : '-'})
                          </th>
                          <td>
                            {ch.targetStartBp}..{ch.targetEndBp}
                          </td>
                          <td>
                            {ch.queryStartBp}..{ch.queryEndBp}
                          </td>
                          <td>{ch.anchorCount}</td>
                          <td>
                            {ch.estimatedIdentityPct.toFixed(1)}% ({ch.structuralEvent})
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>
                Taxonomic Classification (16S rRNA / ITS / Replicon Signatures) — {activeDoc.name}:
              </strong>
              <div className="plugin-list-box" style={{ maxHeight: 135, marginTop: 6 }}>
                {taxonomyHits.length === 0 && (
                  <div className="plugin-row-item">
                    <div className="plugin-row-text">
                      No marker signature (16S / ITS / replicon) was found in this sequence, so no taxon is suggested.
                    </div>
                  </div>
                )}
                {taxonomyHits.map((hit) => (
                  <div key={hit.rank} className="plugin-row-item">
                    <div className="plugin-row-text">
                      <strong>
                        #{hit.rank} {hit.taxonName} (signature score {hit.confidencePct})
                      </strong>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>{hit.lineage}</div>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>
                        Evidence: {hit.matchedSignatures.length} marker signature
                        {hit.matchedSignatures.length === 1 ? '' : 's'} ({hit.matchedSignatures.slice(0, 3).join(', ')}
                        {hit.matchedSignatures.length > 3 ? ', …' : ''})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Sequence Variant Finder (vs. Reference) &amp; Microsatellite STR Genotyper</h3>
              <span className="badge-accent">Alignment-based VCF • STR Allele Caller</span>
            </div>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Polymorphisms ({mapReadDoc.name} vs {mapRefDoc.name})</span>
                <strong className="kpi-val">
                  {freeBayesReport.totalVariants} ({freeBayesReport.snpCount} SNPs,{' '}
                  {freeBayesReport.mnpOrIndelCount} MNP/Indel)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Ti / Tv Ratio</span>
                <strong className="kpi-val">{freeBayesReport.tiTvRatio}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">STR Loci in {activeDoc.name}</span>
                <strong className="kpi-val">{strLoci.length}</strong>
              </div>
            </div>
            {/* what the call did not compare: an empty input (BG-01M6TE8J), the part of a sample past
                the caller's alignment cap (BG-01M6S1ED), unknown bases and the indels beside them
                (BG-01M6T6GK). The engine's report carries `warnings` (D0005), which its shared type
                does not list yet */}
            <ResultWarnings warnings={freeBayesWarnings} label="Variant calling warnings" />

            <div className="cloning-action-row" style={{ marginTop: 8 }}>
              <button
                className="btn-primary-sm"
                disabled={
                  freeBayesReport.annotations.length === 0 ||
                  (!onAppendFeaturesToDocument && mapRefDoc.id !== activeDoc.id)
                }
                title={`Variant coordinates are relative to the reference "${mapRefDoc.name}"; they are added to that document.`}
                onClick={() => {
                  const summary = `Annotated ${freeBayesReport.annotations.length} variant(s) on reference "${mapRefDoc.name}"`;
                  // Variant positions are reference coordinates: annotate the reference.
                  if (onAppendFeaturesToDocument) {
                    onAppendFeaturesToDocument(mapRefDoc.id, freeBayesReport.annotations, summary);
                  } else {
                    onAppendFeatures(freeBayesReport.annotations, summary);
                  }
                }}
              >
                + Annotate Variants on Reference
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() =>
                  triggerTextDownload(`${mapRefDoc.name}_variants.vcf`, freeBayesReport.vcfText)
                }
              >
                Export VCF (.vcf)
              </button>
              <InspectorSection title="STR Genotyping" order={2}>
                {inlineSetting('Min STR Repeats:', 6, 11.5, (
                  <input
                    type="number"
                    min={3}
                    max={12}
                    value={minStrCopies}
                    onChange={(e) => setMinStrCopies(Number(e.target.value) || 4)}
                    style={inlineBoxWidth(56)}
                  />
                ))}
              </InspectorSection>
            </div>

            <div style={{ marginTop: 8 }}>
              <div id={variantTableId} className="mbc-table-caption">
                Variant Calls ({listCountLabel(Math.min(freeBayesReport.variants.length, VARIANT_ROWS_SHOWN), freeBayesReport.totalVariants, 'first')}; single sequence vs. reference, no read-depth QUAL)
              </div>
              <WorkbenchSmartTable
                tableId="genomics-freebayes-variants"
                tableLabel="Variant Calls"
                regionMaxHeight={155}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Pos (bp)</th>
                    <th scope="col">REF &gt; ALT</th>
                    <th scope="col">Type</th>
                    <th scope="col">Class</th>
                    <th scope="col">GT</th>
                  </tr>
                </thead>
                <tbody>
                  {freeBayesReport.variants.length === 0 ? (
                    <tr>
                      {/* identity is claimed only where the call compared everything: an empty
                          input, or bases it passed over, are said in the warnings instead */}
                      <td colSpan={5}>
                        {freeBayesWarnings.length
                          ? 'No variants called; the warnings above say what was not compared.'
                          : '100% identical across mapped interval (0 variants).'}
                      </td>
                    </tr>
                  ) : (
                    freeBayesReport.variants.slice(0, VARIANT_ROWS_SHOWN).map((v) => (
                      <tr key={v.id}>
                        <th scope="row">{v.positionBp}</th>
                        <td>
                          <code>
                            {v.refAllele} &gt; {v.altAllele}
                          </code>
                        </td>
                        <td>{v.variantType}</td>
                        <td>{v.mutationClass}</td>
                        <td>{v.genotype}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </WorkbenchSmartTable>
            </div>

            {vcfConsequenceReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 10 }}>
                <div className="mbc-table-caption">
                  VCF coding consequences, HGVS (HIGH: {vcfConsequenceReport.highImpactCount} • MODERATE: {vcfConsequenceReport.moderateImpactCount} • LOW: {vcfConsequenceReport.lowImpactCount})
                </div>
                {/* the caption counts impact tiers only, so the rows the table leaves out are said here */}
                <ResultWarnings
                  warnings={subsetNote(
                    'The table lists',
                    Math.min(vcfConsequenceReport.annotatedVariants.length, CONSEQUENCE_ROWS_SHOWN),
                    vcfConsequenceReport.totalVariants,
                    'records',
                    'first'
                  )}
                  label="HGVS consequence warnings"
                />
                <WorkbenchSmartTable
                  tableId="genomics-noodles-vcf-consequences"
                  tableLabel="VCF HGVS Coding Consequences"
                  regionMaxHeight={150}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Pos</th>
                      <th scope="col">Feature</th>
                      <th scope="col">Consequence</th>
                      <th scope="col">HGVS.c / HGVS.p</th>
                      <th scope="col">Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vcfConsequenceReport.annotatedVariants.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Zero VCF records requiring HGVS coding consequence annotation.</td>
                      </tr>
                    ) : (
                      vcfConsequenceReport.annotatedVariants.slice(0, CONSEQUENCE_ROWS_SHOWN).map((av, idx) => (
                        <tr key={`${av.positionBp}-${idx}`}>
                          <th scope="row">{av.positionBp}</th>
                          <td>{av.featureName ?? 'Intergenic'}</td>
                          <td>{av.consequenceTerm}</td>
                          <td className="mono-cell">
                            {av.hgvsCoding}
                            {av.hgvsProtein ? ` (${av.hgvsProtein})` : ''}
                          </td>
                          <td>
                            <strong>{av.impactTier}</strong>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div id={strTableId} className="mbc-table-caption">
                Microsatellite / STR Genotypes ({listCountLabel(Math.min(strLoci.length, TABLE_ROWS_SHOWN), strLoci.length, 'first')})
              </div>
              <WorkbenchSmartTable
                tableId="genomics-microsatellite-strs"
                tableLabel="Microsatellite STR Genotypes"
                regionMaxHeight={155}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Allele Call</th>
                    <th scope="col">Coordinates</th>
                    <th scope="col">Repeat Tract</th>
                    <th scope="col">Virtual Amplicon</th>
                  </tr>
                </thead>
                <tbody>
                  {strLoci.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No STR loci ≥ {minStrCopies} copies at current threshold.</td>
                    </tr>
                  ) : (
                    strLoci.slice(0, TABLE_ROWS_SHOWN).map((loc) => (
                      <tr key={loc.id}>
                        <th scope="row">{loc.alleleCall}</th>
                        <td>
                          {loc.startBp}..{loc.endBp}
                        </td>
                        <td>
                          {loc.repeatCopies}x ({loc.tractLengthBp} bp)
                        </td>
                        <td>{loc.virtualAmpliconBp} bp</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: Glimmer Microbial Gene Prediction, CpG Islands & Repeat Finder */}
      {/* =================================================================== */}
      {subTab === 'genes-cpg-repeats' && repeatReport && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Glimmer Microbial Gene Predictor (IMM + Shine-Dalgarno RBS)</h3>
              {glimmerReport && <span className="badge-accent">{glimmerReport.totalPredictedCds.toLocaleString('en-US')} Predicted CDS</span>}
            </div>

            <div className="cloning-action-row">
              <InspectorSection title="Gene Prediction" order={1}>
                {inlineSetting('Min Protein Length (aa):', 6, 12, (
                  <input
                    type="number"
                    min={20}
                    max={300}
                    value={glimmerMinAa}
                    onChange={(e) => setGlimmerMinAa(Number(e.target.value) || 45)}
                    style={inlineBoxWidth(70)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-primary-sm"
                disabled={!glimmerReport || glimmerReport.annotations.length === 0}
                onClick={() =>
                  glimmerReport && onAppendFeatures(
                    glimmerReport.annotations,
                    `Annotated ${glimmerReport.annotations.length} Glimmer predicted gene(s)`
                  )
                }
              >
                + Annotate Glimmer Genes onto {activeDoc.name}
              </button>
            </div>

            <div data-mbc-scan="genes" aria-busy={genes ? undefined : true} style={{ marginTop: 10 }}>
              {genes && glimmerReport ? (
                <>
                  <p className="studio-panel-note">Computed for {genes.input.genome} ({bp(genes.input.seq)}), proteins ≥ {genes.input.min} aa</p>
                    <div id={glimmerTableId} className="mbc-table-caption">
                      Glimmer Predicted Protein-Coding Genes ({listCountLabel(glimmerReport.genes.length, glimmerReport.totalPredictedCds, 'top')})
                    </div>
                    <ResultWarnings warnings={glimmerReport.warnings} label="Gene prediction warnings" />
                    <WorkbenchSmartTable
                      tableId="genomics-glimmer-predicted-genes"
                      tableLabel="Glimmer Predicted Protein-Coding Genes"
                      regionMaxHeight={250}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Gene</th>
                          <th scope="col">Coordinates</th>
                          <th scope="col">Size</th>
                          <th scope="col">Start / RBS</th>
                          <th scope="col">IMM Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {glimmerReport.genes.map((g) => (
                          <tr key={g.id}>
                            <th scope="row">
                              {g.geneName} ({g.strand === 1 ? '+' : '-'})
                            </th>
                            <td>
                              {g.startBp}..{g.endBp}
                            </td>
                            <td>{g.lengthAa} aa</td>
                            <td>
                              {g.startCodon} / {g.rbsMotif}
                            </td>
                            <td>
                              <strong>{g.codingScore}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </WorkbenchSmartTable>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            {/* rust-bio Viterbi 3-State Discrete-Emission HMM Compositional Genome Segmentation */}
            {hmmSegmentationReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
                <div className="studio-card-header" style={{ paddingTop: 2 }}>
                  <h4>
                    Genome segmentation, 3-state HMM (Viterbi path, ln P* = {hmmSegmentationReport.viterbiLogProb})
                  </h4>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    disabled={hmmSegmentationReport.segments.length === 0}
                    onClick={() => {
                      const feats: SequenceFeature[] = hmmSegmentationReport.segments
                        .slice(0, 25)
                        .map((seg, idx) => ({
                          id: `hmm-seg-${Date.now()}-${idx}`,
                          name: `HMM_${seg.stateLabel.replace(/[^A-Za-z0-9]+/g, '_')}`,
                          type: seg.stateIndex === 2 ? 'misc_feature' : 'regulatory',
                          start: seg.start,
                          end: seg.end,
                          strand: 1,
                          color:
                            seg.stateIndex === 2
                              ? '#0284c7'
                              : seg.stateIndex === 0
                              ? '#d97706'
                              : '#16a34a',
                          notes: `rust-bio Viterbi HMM ${seg.stateLabel} (${seg.lengthBp} bp, ${seg.gcPercent}% GC)`,
                        }));
                      onAppendFeatures(
                        feats,
                        `Annotated ${feats.length} HMM segment(s) (Viterbi path)`
                      );
                    }}
                  >
                    + Annotate HMM Segments
                  </button>
                </div>
                <ResultWarnings warnings={hmmSegmentationReport.warnings} label="HMM segmentation warnings" />
                <div className="thermo-kpi-grid">
                  <div className="kpi-box">
                    <span className="kpi-label">AT-Rich / Promoter</span>
                    <strong className="kpi-val">{hmmSegmentationReport.atRichFractionPct}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Balanced Coding</span>
                    <strong className="kpi-val">{hmmSegmentationReport.balancedCodingFractionPct}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">GC-Rich / CpG Island</span>
                    <strong className="kpi-val">{hmmSegmentationReport.gcIslandFractionPct}%</strong>
                  </div>
                </div>
                <div className="mbc-table-caption">
                  Viterbi path segments ({listCountLabel(Math.min(hmmSegmentationReport.segments.length, SEGMENT_ROWS_SHOWN), hmmSegmentationReport.segments.length, 'first')})
                </div>
                <WorkbenchSmartTable
                  tableId="genomics-viterbi-hmm-segments"
                  tableLabel="Viterbi HMM Compositional Segments"
                  regionMaxHeight={145}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">HMM State</th>
                      <th scope="col">Coordinates</th>
                      <th scope="col">Length</th>
                      <th scope="col">%GC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hmmSegmentationReport.segments.slice(0, SEGMENT_ROWS_SHOWN).map((seg, idx) => (
                      <tr key={`${seg.start}-${idx}`}>
                        <th scope="row">{seg.stateLabel}</th>
                        <td>
                          {seg.start}..{seg.end}
                        </td>
                        <td>{seg.lengthBp} bp</td>
                        <td>{seg.gcPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>CpG Islands &amp; Genomic Repeat Finder</h3>
              <span className="badge-accent">
                {cpgReport && <>{cpgReport.islands.length} CpG Islands • </>}{repeatReport.totalIsLowerBound ? 'at least ' : ''}{repeatReport.totalRepeats.toLocaleString('en-US')} Repeats
              </span>
            </div>

            <div className="cloning-action-row">
              <InspectorSection title="CpG Islands" order={2}>
                {inlineSetting('Min CpG Island (bp):', 6, 12, (
                  <input
                    type="number"
                    min={100}
                    max={1000}
                    value={cpgMinLen}
                    onChange={(e) => setCpgMinLen(Number(e.target.value) || 200)}
                    style={inlineBoxWidth(68)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-primary-sm"
                disabled={!cpgReport || cpgReport.annotations.length === 0}
                onClick={() =>
                  cpgReport && onAppendFeatures(
                    cpgReport.annotations,
                    `Annotated ${cpgReport.annotations.length} CpG island(s)`
                  )
                }
              >
                + Annotate CpG Islands
              </button>
              {/* BG-01M6SQ9T's box as it landed: the draft it holds and the settle timer are the
                  studio's, so a close of the inspector mid-typing loses neither */}
              <InspectorSection title="Genomic Repeats" order={3}>
                {inlineSetting('Min Repeat Arm:', 6, 12, (
                  <input
                    type="number"
                    min={MIN_REPEAT_ARM_BP}
                    max={MAX_REPEAT_ARM_BP}
                    step={1}
                    value={repeatArmText}
                    onChange={(e) => setRepeatArmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') settleRepeatArm();
                    }}
                    onBlur={settleRepeatArm}
                    style={inlineBoxWidth(56)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-secondary-sm"
                disabled={repeatReport.annotations.length === 0}
                onClick={() =>
                  onAppendFeatures(
                    repeatReport.annotations,
                    `Annotated ${repeatReport.annotations.length} genomic repeat(s)`
                  )
                }
              >
                + Annotate Repeats
              </button>
            </div>

            <div data-mbc-scan="cpg" aria-busy={cpg ? undefined : true} style={{ marginTop: 8 }}>
              {cpg && cpgReport ? (
                <>
                  <p className="studio-panel-note">Computed for {cpg.input.genome} ({bp(cpg.input.seq)}), islands ≥ {cpg.input.min} bp</p>
                    <div id={cpgTableId} className="mbc-table-caption">
                      Gardiner-Garden &amp; Frommer CpG Islands ({cpgReport.islands.length})
                    </div>
                    <WorkbenchSmartTable
                      tableId="genomics-cpg-islands"
                      tableLabel="CpG Islands"
                      regionMaxHeight={155}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Island</th>
                          <th scope="col">Coordinates</th>
                          <th scope="col">Length</th>
                          <th scope="col">%GC</th>
                          <th scope="col">Obs/Exp CpG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cpgReport.islands.length === 0 ? (
                          <tr>
                            <td colSpan={5}>No CpG islands ≥ {cpg.input.min} bp with Obs/Exp ≥ 0.60.</td>
                          </tr>
                        ) : (
                          cpgReport.islands.map((isl) => (
                            <tr key={isl.id}>
                              <th scope="row">{isl.id}</th>
                              <td>
                                {isl.startBp}..{isl.endBp}
                              </td>
                              <td>{isl.lengthBp} bp</td>
                              <td>{isl.gcPercent}%</td>
                              <td>{isl.obsExpRatio}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </WorkbenchSmartTable>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <div id={repeatTableId} className="mbc-table-caption">
                Direct, Inverted &amp; Palindromic Repeats ({repeatListLabel(repeatReport)})
              </div>
              <ResultWarnings warnings={repeatReport.warnings} label="Repeat scan warnings" />
              <WorkbenchSmartTable
                tableId="genomics-repeats-finder"
                tableLabel="Direct Inverted and Palindromic Repeats"
                regionMaxHeight={170}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Repeat Type</th>
                    <th scope="col">Arm 1</th>
                    <th scope="col">Arm 2</th>
                    <th scope="col">Length</th>
                    <th scope="col">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {repeatReport.repeats.map((rep) => (
                    <tr key={rep.id}>
                      <th scope="row">{rep.repeatType}</th>
                      <td>
                        {rep.arm1StartBp}..{rep.arm1EndBp}
                      </td>
                      <td>
                        {rep.arm2StartBp}..{rep.arm2EndBp}
                      </td>
                      <td>{rep.armLengthBp} bp</td>
                      <td>
                        <code>{rep.sequenceMotif}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>

            {/* rust-bio DNAMotif JASPAR PSSM / PWM Transcription Factor Motif Scanner */}
            {pssmMotifReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
                <div className="studio-card-header" style={{ paddingTop: 2 }}>
                  <h4>
                    Transcription-factor motif scan, JASPAR PWMs ({pssmMotifReport.totalHits} hits across {pssmMotifReport.motifsEvaluated} matrices)
                  </h4>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <InspectorSection title="TF Motif Scan" order={4}>
                      {inlineSetting('Min Score:', 5, 11.5, (
                        <select
                          value={String(pssmMinRelScore)}
                          onChange={(e) => setPssmMinRelScore(Number(e.target.value))}
                        >
                          <option value="0.8">0.80</option>
                          <option value="0.84">0.84</option>
                          <option value="0.88">0.88</option>
                          <option value="0.92">0.92</option>
                        </select>
                      ))}
                    </InspectorSection>
                    <button
                      type="button"
                      className="btn-primary-sm"
                      disabled={pssmMotifReport.hits.length === 0}
                      onClick={() => {
                        const feats: SequenceFeature[] = pssmMotifReport.hits
                          .slice(0, 30)
                          .map((hit, idx) => ({
                            id: `pssm-tf-${Date.now()}-${idx}`,
                            name: `${hit.tfName}_${hit.matrixId}`,
                            type: 'regulatory',
                            start: hit.start,
                            end: hit.end,
                            strand: hit.strand,
                            color: '#7c3aed',
                            notes: `JASPAR ${hit.matrixId} (${hit.family}) relScore=${hit.relativeScore}, logOdds=${hit.logOddsBits} bits`,
                          }));
                        onAppendFeatures(
                          feats,
                          `Annotated ${feats.length} JASPAR PSSM TF binding site(s)`
                        );
                      }}
                    >
                      + Annotate TF Sites
                    </button>
                  </div>
                </div>
                <div className="mbc-table-caption">
                  Best-scoring binding sites, every matrix ({listCountLabel(pssmMotifReport.hits.length, pssmMotifReport.totalHits, 'top')})
                </div>
                <ResultWarnings warnings={pssmMotifReport.warnings} label="TF motif scan warnings" />
                <WorkbenchSmartTable
                  tableId="genomics-jaspar-pssm-motifs"
                  tableLabel="JASPAR PSSM Transcription Factor Binding Sites"
                  regionMaxHeight={155}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">TF / Matrix</th>
                      <th scope="col">Coordinates</th>
                      <th scope="col">Matched Site</th>
                      <th scope="col">Rel. Score</th>
                      <th scope="col">Log-Odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pssmMotifReport.hits.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No JASPAR PSSM hits ≥ {(pssmMinRelScore * 100).toFixed(0)}% relative score.</td>
                      </tr>
                    ) : (
                      pssmMotifReport.hits.map((hit, idx) => (
                        <tr key={`${hit.matrixId}-${hit.start}-${idx}`}>
                          <th scope="row">
                            {hit.tfName} ({hit.matrixId})
                          </th>
                          <td>
                            {hit.start}..{hit.end} ({hit.strand === 1 ? '+' : '-'})
                          </td>
                          <td className="mono-cell">{hit.matchedSeq}</td>
                          <td>{(hit.relativeScore * 100).toFixed(1)}%</td>
                          <td>{hit.logOddsBits} bits</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: Complement/Reverse Only, Mutate & Shuffle, NCBI GenBank Submit */}
      {/* =================================================================== */}
      {subTab === 'transform-submit' && mutateReport && genbankSubmission && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Complement / Reverse Only &amp; Mutate / Shuffle Generator</h3>
              <span className="badge-accent">Dinucleotide-Preserving Shuffle</span>
            </div>

            <div className="cloning-action-row" style={{ marginBottom: 12 }}>
              <button
                className="btn-primary-sm"
                disabled={activeDoc.moleculeType === 'Protein' || !activeDoc.sequence}
                title={activeDoc.moleculeType === 'Protein' ? 'Strand operations apply to DNA or RNA documents.' : undefined}
                onClick={() =>
                  onComplementOnlyActiveDoc
                    ? onComplementOnlyActiveDoc()
                    : onUpdateActiveSequence(
                        complementOnlySequence(activeDoc.sequence, activeDoc.moleculeType === 'RNA'),
                        `Applied Complement-Only (5'→3') to ${activeDoc.name}`
                      )
                }
              >
                Complement Only (5&apos;→3&apos; In-Place)
              </button>
              <button
                className="btn-primary-sm"
                disabled={activeDoc.moleculeType === 'Protein' || !activeDoc.sequence}
                title={activeDoc.moleculeType === 'Protein' ? 'Strand operations apply to DNA or RNA documents.' : undefined}
                onClick={() =>
                  onReverseOnlyActiveDoc
                    ? onReverseOnlyActiveDoc()
                    : onUpdateActiveSequence(
                        reverseOnlySequence(activeDoc.sequence),
                        `Applied Reverse-Only (3'→5') to ${activeDoc.name}`
                      )
                }
              >
                Reverse Only (3&apos;→5&apos; In-Place)
              </button>
            </div>

            <InspectorSection title="Benchmark Generator" order={1}>
              <div className="form-grid-3col">
                <label className="form-field">
                  <span>Benchmark Generator Mode:</span>
                  <select
                    value={mutateMode}
                    onChange={(e) =>
                      setMutateMode(e.target.value as MutateShuffleOptions['mode'])
                    }
                  >
                    <option value="shuffle-dinucleotide">
                      Shuffle — Preserve Exact Dinucleotide Composition
                    </option>
                    <option value="shuffle-mononucleotide">
                      Shuffle — Uniform Mononucleotide Fisher-Yates
                    </option>
                    <option value="point-mutate">
                      Point Mutate — Ti/Tv Weighted Random Substitutions
                    </option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Mutation Rate (%):</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={40}
                    disabled={mutateMode !== 'point-mutate'}
                    value={mutationRatePct}
                    onChange={(e) => setMutationRatePct(Number(e.target.value) || 2.5)}
                  />
                </label>
                <label className="form-field">
                  <span>PRNG Seed:</span>
                  <input
                    type="number"
                    value={mutateSeed}
                    onChange={(e) => setMutateSeed(Number(e.target.value) || 1)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Positions Changed</span>
                <strong className="kpi-val">
                  {mutateReport.mutationsApplied.toLocaleString()} /{' '}
                  {mutateReport.originalLengthBp.toLocaleString()} bp
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">%GC (Original → Output)</span>
                <strong className="kpi-val">
                  {mutateReport.gcOriginalPct}% → {mutateReport.gcOutputPct}%
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Dinucleotide Conservation</span>
                <strong className="kpi-val">
                  {(mutateReport.dinucleotideCorrelation * 100).toFixed(1)}%
                </strong>
              </div>
            </div>

            <div className="cloning-action-row" style={{ marginTop: 10 }}>
              <button
                className="btn-primary-sm"
                onClick={() => {
                  const now = new Date().toISOString().slice(0, 10);
                  const suffix =
                    mutateMode === 'point-mutate'
                      ? 'Mutated'
                      : mutateMode === 'shuffle-dinucleotide'
                      ? 'DinucShuffled'
                      : 'Shuffled';
                  onCreateDocument({
                    id: `mut-${Date.now()}`,
                    name: `${activeDoc.name}_${suffix}`,
                    accession: `BENCH_${suffix.toUpperCase()}`,
                    folder: activeDoc.folder,
                    moleculeType: activeDoc.moleculeType,
                    topology: 'linear',
                    sequence: mutateReport.outputSequence,
                    description: `${suffix} benchmark derivative of ${activeDoc.name} (GC=${mutateReport.gcOutputPct}%)`,
                    createdAt: now,
                    updatedAt: now,
                    features: [],
                    primers: [],
                    history: [],
                  });
                }}
              >
                + Create Mutated / Shuffled Document in Workspace
              </button>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>NCBI GenBank Direct Submission Validator (.fsa + .tbl)</h3>
              <span className="badge-accent">
                {genbankSubmission.readyForSubmission ? 'SUBMISSION READY' : 'REVIEW REQUIRED'}
              </span>
            </div>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Source Organism:</span>
                <input
                  type="text"
                  value={gbMeta.organism}
                  onChange={(e) => setGbMeta((p) => ({ ...p, organism: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Strain / Isolate:</span>
                <input
                  type="text"
                  value={gbMeta.strainOrIsolate}
                  onChange={(e) =>
                    setGbMeta((p) => ({ ...p, strainOrIsolate: e.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Molecule Type ([moltype]):</span>
                <select
                  value={gbMeta.molType}
                  onChange={(e) =>
                    setGbMeta((p) => ({
                      ...p,
                      molType: e.target.value as GenBankSubmissionMeta['molType'],
                    }))
                  }
                >
                  <option value="genomic DNA">genomic DNA</option>
                  <option value="mRNA">mRNA</option>
                  <option value="other DNA">other DNA (Synthetic / Vector)</option>
                  <option value="viral cRNA">viral cRNA</option>
                </select>
              </label>
              <label className="form-field">
                <span>NCBI Genetic Code ([gcode]):</span>
                <select
                  value={gbMeta.geneticCodeId}
                  onChange={(e) =>
                    setGbMeta((p) => ({
                      ...p,
                      geneticCodeId: Number(e.target.value) as 1 | 11,
                    }))
                  }
                >
                  <option value={1}>Table 1 — Standard Eukaryotic</option>
                  <option value={11}>Table 11 — Bacterial, Archaeal &amp; Plant Plastid</option>
                </select>
              </label>
            </div>

            <div className="plugin-list-box" style={{ maxHeight: 115, marginTop: 8 }}>
              {genbankSubmission.issues.map((iss, idx) => (
                <div key={idx} className="plugin-row-item">
                  <div className="plugin-row-text">
                    <strong>[{iss.severity}] {iss.rule}:</strong> {iss.message}
                  </div>
                </div>
              ))}
            </div>

            <div className="cloning-action-row" style={{ marginTop: 8 }}>
              <button
                className="btn-primary-sm"
                onClick={() =>
                  triggerTextDownload(`${activeDoc.name}.fsa`, genbankSubmission.fastaFsaText)
                }
              >
                Export Submission FASTA (.fsa)
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() =>
                  triggerTextDownload(
                    `${activeDoc.name}.tbl`,
                    genbankSubmission.featureTableTblText
                  )
                }
              >
                Export 5-Column Feature Table (.tbl)
              </button>
            </div>

            <textarea
              className="js-code-editor"
              rows={4}
              readOnly
              style={{ marginTop: 8 }}
              value={`${genbankSubmission.fastaFsaText.slice(0, 260)}...\n\n${genbankSubmission.featureTableTblText}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};
